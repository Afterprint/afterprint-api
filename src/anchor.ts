/**
 * Stellar anchoring.
 *
 * Turns an evidence version (or an attestation) into a manifest, hashes it, and
 * records the hash in the `evidence_anchor_registry` contract so anyone can
 * verify it independently of Afterprint's servers.
 *
 * Two ways to sign and submit are supported, chosen from the environment:
 *
 *  - **Sidecar**: `STELLAR_ANCHOR_SERVICE_URL` points at an external signing
 *    service. This is the original behavior.
 *  - **In-process**: `STELLAR_SIGNER_SECRET` and `STELLAR_EVIDENCE_ANCHOR_CONTRACT`
 *    let the worker build, sign, and submit the Soroban transaction itself.
 *
 * Retrying is always safe. The registry treats an identical repeat as a no-op
 * and rejects a conflicting one, so a timed-out submission can simply be sent
 * again with the same values.
 */

import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { canonical, sha256 } from './domain';

/* -------------------------------------------------------------------------- */
/* Manifests                                                                   */
/* -------------------------------------------------------------------------- */

export interface EvidenceManifestInput {
  caseId: string;
  evidenceId: string;
  sha256: string;
  size: number;
  mimeType: string;
  importedAt: Date;
  /** The evidence source description. Only its hash is anchored. */
  source: string;
  /** Hash of the latest custody event, or empty if there is none yet. */
  custodyHeadHash: string;
}

/**
 * The document whose hash is anchored for an evidence version. It contains
 * digests and opaque references only, never evidence content or case names.
 */
export function evidenceManifest(input: EvidenceManifestInput) {
  return {
    schemaVersion: '1.0',
    caseRef: sha256(input.caseId),
    evidenceRef: sha256(input.evidenceId),
    version: 1,
    sha256: input.sha256,
    sizeBytes: input.size,
    mimeType: input.mimeType,
    importedAt: input.importedAt.toISOString(),
    sourceMetadataHash: sha256(input.source),
    custodyHeadHash: input.custodyHeadHash,
  };
}

export interface AttestationManifestInput {
  caseId: string;
  attestationId: string;
  versionId: string;
  statementHash: string;
}

/** The document whose hash is anchored for an attestation. */
export function attestationManifest(input: AttestationManifestInput) {
  return {
    schemaVersion: '1.0',
    caseRef: sha256(input.caseId),
    attestationRef: sha256(input.attestationId),
    subjectRef: sha256(input.versionId),
    statementHash: input.statementHash,
  };
}

/** SHA-256 of the canonical (sorted-key) JSON form of a manifest. */
export function manifestHash(manifest: object): string {
  return sha256(canonical(manifest));
}

/* -------------------------------------------------------------------------- */
/* Anchor clients                                                              */
/* -------------------------------------------------------------------------- */

export interface AnchorRequest {
  /** 64 hex characters: the reference the anchor is stored under. */
  evidenceVersionRef: string;
  /** 64 hex characters: SHA-256 of the manifest. */
  manifestHash: string;
  /** Stable per logical anchor, so a sidecar can de-duplicate retries. */
  idempotencyKey: string;
}

export interface AnchorResult {
  transactionHash: string;
  status: 'CONFIRMED';
}

export interface AnchorClient {
  anchor(request: AnchorRequest): Promise<AnchorResult>;
}

/** Thrown when no signing method is configured. The job stays pending. */
export class AnchorNotConfiguredError extends Error {
  constructor(message = 'Stellar signing is not configured; anchor remains pending') {
    super(message);
    this.name = 'AnchorNotConfiguredError';
  }
}

const HEX_32_BYTES = /^[0-9a-f]{64}$/;

function assertHash32(name: string, value: string) {
  if (!HEX_32_BYTES.test(value)) {
    throw new Error(`${name} must be 64 lowercase hex characters`);
  }
}

/* ---- Sidecar ---------------------------------------------------------------- */

export interface HttpAnchorOptions {
  url: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Sends the anchor to an external signing service. */
export function httpAnchorClient(options: HttpAnchorOptions): AnchorClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async anchor(request) {
      assertHash32('evidenceVersionRef', request.evidenceVersionRef);
      assertHash32('manifestHash', request.manifestHash);

      const response = await doFetch(options.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({
          evidenceVersionRef: request.evidenceVersionRef,
          manifestHash: request.manifestHash,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok) throw new Error('Anchor service rejected request');

      const result = (await response.json()) as { transactionHash?: string; status?: string };
      if (!result.transactionHash || result.status !== 'CONFIRMED') {
        throw new Error('Anchor is not confirmed');
      }
      return { transactionHash: result.transactionHash, status: 'CONFIRMED' };
    },
  };
}

/* ---- In-process Soroban signer ---------------------------------------------- */

/** The slice of the Soroban RPC server this module uses, so tests can fake it. */
export interface SorobanServer {
  getAccount(address: string): Promise<any>;
  simulateTransaction(tx: any): Promise<any>;
  sendTransaction(tx: any): Promise<{ status: string; hash: string; errorResult?: unknown }>;
  getTransaction(hash: string): Promise<{ status: string }>;
}

export interface SorobanAnchorOptions {
  contractId: string;
  signer: Keypair;
  server: SorobanServer;
  networkPassphrase?: string;
  /** How long to wait for the transaction to be included. Default 60 seconds. */
  confirmTimeoutMs?: number;
  /** How often to ask. Default 2 seconds. */
  pollIntervalMs?: number;
  /** Replaceable in tests. */
  assemble?: (tx: any, simulation: any) => { build(): any };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * The reference stored alongside each anchor to say who submitted it: the
 * SHA-256 of the signer's public key, so the key itself is not repeated.
 */
export function submitterRef(signer: Keypair): string {
  return sha256(signer.publicKey());
}

const bytes32 = (hex: string) => nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });

/**
 * Builds, signs, and submits `anchor(evidence_version_ref, manifest_hash,
 * submitter_ref)` on the registry, then waits for the result. The signer must be
 * the registry's controller or the call is rejected on-chain.
 */
export function sorobanAnchorClient(options: SorobanAnchorOptions): AnchorClient {
  const passphrase = options.networkPassphrase ?? Networks.TESTNET;
  const assemble = options.assemble ?? ((tx, sim) => rpc.assembleTransaction(tx, sim));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.confirmTimeoutMs ?? 60_000;
  const pollMs = options.pollIntervalMs ?? 2_000;
  const contract = new Contract(options.contractId);

  return {
    async anchor(request) {
      assertHash32('evidenceVersionRef', request.evidenceVersionRef);
      assertHash32('manifestHash', request.manifestHash);

      const account = await options.server.getAccount(options.signer.publicKey());
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addOperation(
          contract.call(
            'anchor',
            bytes32(request.evidenceVersionRef),
            bytes32(request.manifestHash),
            bytes32(submitterRef(options.signer)),
          ),
        )
        .setTimeout(60)
        .build();

      const simulation = await options.server.simulateTransaction(transaction);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Anchor simulation failed: ${simulation.error}`);
      }

      const prepared = assemble(transaction, simulation).build();
      prepared.sign(options.signer);

      const sent = await options.server.sendTransaction(prepared);
      if (sent.status === 'ERROR')
        throw new Error('Anchor transaction was rejected by the network');

      // PENDING and DUPLICATE both mean "in flight"; wait for the outcome.
      const deadline = now() + timeoutMs;
      for (;;) {
        const outcome = await options.server.getTransaction(sent.hash);
        if (outcome.status === 'SUCCESS') {
          return { transactionHash: sent.hash, status: 'CONFIRMED' };
        }
        if (outcome.status === 'FAILED') throw new Error('Anchor transaction failed on-chain');
        if (now() >= deadline) {
          throw new Error(`Anchor transaction ${sent.hash} not confirmed in time; retry is safe`);
        }
        await sleep(pollMs);
      }
    },
  };
}

/* ---- Selection from the environment ---------------------------------------- */

type Env = Record<string, string | undefined>;

/**
 * Pick a signing method from configuration. Throws `AnchorNotConfiguredError`
 * when neither is set, so the queue keeps the job and retries later.
 */
export function createAnchorClient(env: Env = process.env): AnchorClient {
  if (env.STELLAR_ANCHOR_SERVICE_URL) {
    if (!env.STELLAR_SIGNER_TOKEN) {
      throw new AnchorNotConfiguredError(
        'STELLAR_SIGNER_TOKEN is required with STELLAR_ANCHOR_SERVICE_URL',
      );
    }
    return httpAnchorClient({
      url: env.STELLAR_ANCHOR_SERVICE_URL,
      token: env.STELLAR_SIGNER_TOKEN,
    });
  }

  if (env.STELLAR_SIGNER_SECRET && env.STELLAR_EVIDENCE_ANCHOR_CONTRACT) {
    const network = env.STELLAR_NETWORK ?? 'testnet';
    if (network !== 'testnet') {
      throw new AnchorNotConfiguredError(
        'Only STELLAR_NETWORK=testnet is supported until custody and asset decisions are made',
      );
    }
    let signer: Keypair;
    try {
      signer = Keypair.fromSecret(env.STELLAR_SIGNER_SECRET);
    } catch {
      // Never echo the value: it is a secret key.
      throw new AnchorNotConfiguredError('STELLAR_SIGNER_SECRET is not a valid secret key');
    }
    const server = new rpc.Server(env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org');
    return sorobanAnchorClient({
      contractId: env.STELLAR_EVIDENCE_ANCHOR_CONTRACT,
      signer,
      server: server as unknown as SorobanServer,
      networkPassphrase: Networks.TESTNET,
    });
  }

  throw new AnchorNotConfiguredError();
}
