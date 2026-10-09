import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  AnchorNotConfiguredError,
  attestationManifest,
  createAnchorClient,
  evidenceManifest,
  httpAnchorClient,
  manifestHash,
  sorobanAnchorClient,
  submitterRef,
  type SorobanServer,
} from '../src/anchor';
import { sha256 } from '../src/domain';

const REF = 'a'.repeat(64);
const HASH = 'b'.repeat(64);
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));

/* -------------------------------------------------------------------------- */
/* Manifests                                                                   */
/* -------------------------------------------------------------------------- */

const evidenceInput = () => ({
  caseId: 'case-1',
  evidenceId: 'ev-1',
  sha256: 'c'.repeat(64),
  size: 1024,
  mimeType: 'video/mp4',
  importedAt: new Date('2026-09-14T10:00:00.000Z'),
  source: 'Body camera, unit 12',
  custodyHeadHash: 'd'.repeat(64),
});

test('evidence manifest holds digests and references, never raw identifiers or the source text', () => {
  const manifest = evidenceManifest(evidenceInput());
  const text = JSON.stringify(manifest);

  assert.equal(manifest.schemaVersion, '1.0');
  assert.equal(manifest.caseRef, sha256('case-1'));
  assert.equal(manifest.evidenceRef, sha256('ev-1'));
  assert.equal(manifest.sourceMetadataHash, sha256('Body camera, unit 12'));
  assert.equal(manifest.importedAt, '2026-09-14T10:00:00.000Z');
  assert.ok(!text.includes('case-1'), 'case id must not appear in the clear');
  assert.ok(!text.includes('ev-1'), 'evidence id must not appear in the clear');
  assert.ok(!text.includes('Body camera'), 'source text must not appear in the clear');
});

test('manifest hash is a 64 character hex digest', () => {
  assert.match(manifestHash(evidenceManifest(evidenceInput())), /^[0-9a-f]{64}$/);
});

test('manifest hash does not depend on property order', () => {
  assert.equal(
    manifestHash({ a: 1, b: { d: 4, c: 3 } }),
    manifestHash({ b: { c: 3, d: 4 }, a: 1 }),
  );
});

test('changing any single evidence field changes the manifest hash', () => {
  const base = manifestHash(evidenceManifest(evidenceInput()));
  const variants: Array<Partial<ReturnType<typeof evidenceInput>>> = [
    { caseId: 'case-2' },
    { evidenceId: 'ev-2' },
    { sha256: 'e'.repeat(64) },
    { size: 1025 },
    { mimeType: 'video/webm' },
    { importedAt: new Date('2026-09-14T10:00:01.000Z') },
    { source: 'Body camera, unit 13' },
    { custodyHeadHash: 'f'.repeat(64) },
  ];
  for (const change of variants) {
    const changed = manifestHash(evidenceManifest({ ...evidenceInput(), ...change }));
    assert.notEqual(changed, base, `changing ${Object.keys(change)[0]} must change the hash`);
  }
});

test('attestation manifest commits to the case, attestation, subject, and statement', () => {
  const input = {
    caseId: 'case-1',
    attestationId: 'att-1',
    versionId: 'v-1',
    statementHash: 'a'.repeat(64),
  };
  const base = manifestHash(attestationManifest(input));
  assert.equal(attestationManifest(input).subjectRef, sha256('v-1'));
  for (const change of [
    { caseId: 'case-2' },
    { attestationId: 'att-2' },
    { versionId: 'v-2' },
    { statementHash: 'b'.repeat(64) },
  ]) {
    assert.notEqual(manifestHash(attestationManifest({ ...input, ...change })), base);
  }
});

/* -------------------------------------------------------------------------- */
/* Sidecar client                                                              */
/* -------------------------------------------------------------------------- */

function fakeFetch(response: { ok: boolean; body?: unknown }) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: response.ok, json: async () => response.body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const request = { evidenceVersionRef: REF, manifestHash: HASH, idempotencyKey: 'version-1' };

test('sidecar client posts the refs with the token and the idempotency key', async () => {
  const f = fakeFetch({ ok: true, body: { transactionHash: 'tx1', status: 'CONFIRMED' } });
  const client = httpAnchorClient({
    url: 'https://signer.test/anchor',
    token: 'secret',
    fetchImpl: f.impl,
  });

  const result = await client.anchor(request);

  assert.deepEqual(result, { transactionHash: 'tx1', status: 'CONFIRMED' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://signer.test/anchor');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'version-1');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    evidenceVersionRef: REF,
    manifestHash: HASH,
  });
});

test('sidecar client fails when the service rejects the request', async () => {
  const f = fakeFetch({ ok: false });
  const client = httpAnchorClient({ url: 'https://s.test', token: 't', fetchImpl: f.impl });
  await assert.rejects(client.anchor(request), /rejected request/);
});

test('sidecar client refuses an unconfirmed or hash-less answer', async () => {
  for (const body of [{ transactionHash: 'tx1', status: 'PENDING' }, { status: 'CONFIRMED' }, {}]) {
    const f = fakeFetch({ ok: true, body });
    const client = httpAnchorClient({ url: 'https://s.test', token: 't', fetchImpl: f.impl });
    await assert.rejects(client.anchor(request), /not confirmed/);
  }
});

test('both clients reject malformed references before touching the network', async () => {
  const f = fakeFetch({ ok: true, body: {} });
  const client = httpAnchorClient({ url: 'https://s.test', token: 't', fetchImpl: f.impl });
  for (const bad of ['', 'xyz', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    await assert.rejects(
      client.anchor({ ...request, evidenceVersionRef: bad }),
      /64 lowercase hex/,
    );
    await assert.rejects(client.anchor({ ...request, manifestHash: bad }), /64 lowercase hex/);
  }
  assert.equal(f.calls.length, 0);
});

/* -------------------------------------------------------------------------- */
/* In-process Soroban signer                                                   */
/* -------------------------------------------------------------------------- */

function setup(overrides: Partial<SorobanServer> = {}, outcomes: string[] = ['SUCCESS']) {
  const signer = Keypair.random();
  const sent: any[] = [];
  const polls: string[] = [];
  const queue = [...outcomes];
  let clock = 0;
  const server: SorobanServer = {
    getAccount: async () => new Account(signer.publicKey(), '100'),
    simulateTransaction: async () => ({}),
    sendTransaction: async tx => {
      sent.push(tx);
      return { status: 'PENDING', hash: 'TXHASH' };
    },
    getTransaction: async hash => {
      polls.push(hash);
      return { status: queue.length > 1 ? queue.shift()! : queue[0] };
    },
    ...overrides,
  };
  const client = sorobanAnchorClient({
    contractId: CONTRACT,
    signer,
    server,
    assemble: tx => ({ build: () => tx }),
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
    confirmTimeoutMs: 10_000,
    pollIntervalMs: 1_000,
  });
  return { signer, sent, polls, client };
}

test('signer calls anchor on the right contract with the three 32-byte arguments', async () => {
  const { signer, sent, client } = setup();

  const result = await client.anchor(request);

  assert.deepEqual(result, { transactionHash: 'TXHASH', status: 'CONFIRMED' });
  assert.equal(sent.length, 1);
  const operation = sent[0].operations[0];
  assert.equal(operation.type, 'invokeHostFunction');
  // SDK 17 exposes the decoded XDR as plain tagged objects.
  const invoke = operation.func.invokeContract;
  assert.equal(
    Buffer.from(invoke.contractAddress.contractId.value).toString('hex'),
    Buffer.from(StrKey.decodeContract(CONTRACT)).toString('hex'),
  );
  assert.equal(Buffer.from(invoke.functionName.bytes).toString('utf8'), 'anchor');
  const args = invoke.args.map((a: any) => Buffer.from(a.bytes.value).toString('hex'));
  assert.deepEqual(args, [REF, HASH, submitterRef(signer)]);
});

test('signer signs the transaction with its own key', async () => {
  const { signer, sent, client } = setup();
  await client.anchor(request);

  const tx = sent[0];
  assert.equal(tx.signatures.length, 1);
  const signature: any = tx.signatures[0].signature;
  assert.ok(signer.verify(tx.hash(), Buffer.from(signature.value ?? signature)));
  assert.equal(tx.source, signer.publicKey());
});

test('submitter ref is the hash of the public key, not the key itself', () => {
  const signer = Keypair.random();
  assert.equal(submitterRef(signer), sha256(signer.publicKey()));
  assert.match(submitterRef(signer), /^[0-9a-f]{64}$/);
});

test('signer waits while the transaction is not yet found', async () => {
  const { polls, client } = setup({}, ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS']);
  const result = await client.anchor(request);
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(polls.length, 3);
});

test('signer fails without sending when simulation fails', async () => {
  const { sent, client } = setup({
    simulateTransaction: async () => ({ error: 'HostError: auth' }),
  });
  await assert.rejects(client.anchor(request), /simulation failed: HostError: auth/);
  assert.equal(sent.length, 0);
});

test('signer fails when the network rejects the submission', async () => {
  const { client } = setup({ sendTransaction: async () => ({ status: 'ERROR', hash: 'X' }) });
  await assert.rejects(client.anchor(request), /rejected by the network/);
});

test('signer fails when the transaction fails on-chain', async () => {
  const { client } = setup({}, ['FAILED']);
  await assert.rejects(client.anchor(request), /failed on-chain/);
});

test('signer gives up after the timeout and says a retry is safe', async () => {
  const { polls, client } = setup({}, ['NOT_FOUND']);
  await assert.rejects(client.anchor(request), /not confirmed in time; retry is safe/);
  assert.ok(polls.length >= 2 && polls.length <= 12, `polled ${polls.length} times`);
});

test('signer rejects malformed references before contacting the network', async () => {
  let touched = false;
  const { client } = setup({
    getAccount: async () => {
      touched = true;
      throw new Error('should not be called');
    },
  });
  await assert.rejects(client.anchor({ ...request, manifestHash: 'nothex' }), /64 lowercase hex/);
  assert.equal(touched, false);
});

/* -------------------------------------------------------------------------- */
/* Selecting a client from the environment                                     */
/* -------------------------------------------------------------------------- */

test('with nothing configured the job stays pending', () => {
  assert.throws(() => createAnchorClient({}), AnchorNotConfiguredError);
  assert.throws(() => createAnchorClient({}), /anchor remains pending/);
});

test('a secret without a contract, or a contract without a secret, is not enough', () => {
  const secret = Keypair.random().secret();
  assert.throws(
    () => createAnchorClient({ STELLAR_SIGNER_SECRET: secret }),
    AnchorNotConfiguredError,
  );
  assert.throws(
    () => createAnchorClient({ STELLAR_EVIDENCE_ANCHOR_CONTRACT: CONTRACT }),
    AnchorNotConfiguredError,
  );
});

test('the sidecar needs its token', () => {
  assert.throws(
    () => createAnchorClient({ STELLAR_ANCHOR_SERVICE_URL: 'https://s.test' }),
    /STELLAR_SIGNER_TOKEN is required/,
  );
  assert.ok(
    createAnchorClient({ STELLAR_ANCHOR_SERVICE_URL: 'https://s.test', STELLAR_SIGNER_TOKEN: 't' }),
  );
});

test('the in-process signer is built from a secret and a contract', () => {
  const client = createAnchorClient({
    STELLAR_SIGNER_SECRET: Keypair.random().secret(),
    STELLAR_EVIDENCE_ANCHOR_CONTRACT: CONTRACT,
  });
  assert.equal(typeof client.anchor, 'function');
});

test('an invalid secret is reported without echoing it', () => {
  const bad = 'SNOTAREALSECRETKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  try {
    createAnchorClient({ STELLAR_SIGNER_SECRET: bad, STELLAR_EVIDENCE_ANCHOR_CONTRACT: CONTRACT });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof AnchorNotConfiguredError);
    assert.ok(!(error as Error).message.includes(bad), 'the secret must not appear in the error');
  }
});

test('only testnet is allowed for now', () => {
  assert.throws(
    () =>
      createAnchorClient({
        STELLAR_SIGNER_SECRET: Keypair.random().secret(),
        STELLAR_EVIDENCE_ANCHOR_CONTRACT: CONTRACT,
        STELLAR_NETWORK: 'public',
      }),
    /Only STELLAR_NETWORK=testnet is supported/,
  );
});

test('the sidecar takes priority when both are configured', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ transactionHash: 'via-sidecar', status: 'CONFIRMED' }),
    };
  }) as unknown as typeof fetch;
  try {
    const client = createAnchorClient({
      STELLAR_ANCHOR_SERVICE_URL: 'https://sidecar.test/anchor',
      STELLAR_SIGNER_TOKEN: 't',
      STELLAR_SIGNER_SECRET: Keypair.random().secret(),
      STELLAR_EVIDENCE_ANCHOR_CONTRACT: CONTRACT,
    });
    const result = await client.anchor(request);
    assert.equal(result.transactionHash, 'via-sidecar');
    assert.deepEqual(calls, ['https://sidecar.test/anchor']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
