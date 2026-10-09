import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import {
  canonical,
  capabilities,
  categories,
  generateNonce,
  mediaType,
  permitted,
  roles,
  sha256,
  validateClaims,
  verifyStellarSignature,
} from '../src/domain';

/** Sign the way a SEP-53 wallet (Freighter) does. */
function signSep53(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([
    Buffer.from('Stellar Signed Message:\n', 'utf8'),
    Buffer.from(message, 'utf8'),
  ]);
  // Buffer.from: SDK 17 returns a Uint8Array, whose toString() is not base64.
  return Buffer.from(keypair.sign(createHash('sha256').update(payload).digest())).toString(
    'base64',
  );
}

/* -------------------------------------------------------------------------- */
/* Wallet signatures                                                           */
/* -------------------------------------------------------------------------- */

test('a real SEP-53 signature from the wallet verifies', () => {
  const wallet = Keypair.random();
  const message = 'Afterprint authentication challenge: abc123';
  assert.equal(
    verifyStellarSignature(wallet.publicKey(), message, signSep53(wallet, message)),
    true,
  );
});

test('a signature over a different message is rejected', () => {
  const wallet = Keypair.random();
  const signature = signSep53(wallet, 'message one');
  assert.equal(verifyStellarSignature(wallet.publicKey(), 'message two', signature), false);
});

test("another wallet's signature is rejected", () => {
  const wallet = Keypair.random();
  const impostor = Keypair.random();
  const message = 'challenge';
  assert.equal(
    verifyStellarSignature(wallet.publicKey(), message, signSep53(impostor, message)),
    false,
  );
});

test('a signature over the raw message, without the SEP-53 prefix, is rejected', () => {
  // The login must only accept what a real wallet produces.
  const wallet = Keypair.random();
  const message = 'challenge';
  const raw = Buffer.from(wallet.sign(Buffer.from(message, 'utf8'))).toString('base64');
  assert.equal(verifyStellarSignature(wallet.publicKey(), message, raw), false);
});

test('malformed signatures and keys fail closed instead of throwing', () => {
  const wallet = Keypair.random();
  const good = signSep53(wallet, 'm');
  assert.equal(verifyStellarSignature(wallet.publicKey(), 'm', ''), false);
  assert.equal(verifyStellarSignature(wallet.publicKey(), 'm', 'not base64!!'), false);
  assert.equal(
    verifyStellarSignature(wallet.publicKey(), 'm', Buffer.alloc(63).toString('base64')),
    false,
  );
  assert.equal(
    verifyStellarSignature(wallet.publicKey(), 'm', Buffer.alloc(65).toString('base64')),
    false,
  );
  assert.equal(verifyStellarSignature('not-a-public-key', 'm', good), false);
  assert.equal(verifyStellarSignature('', 'm', good), false);
});

test('flipping one bit of a valid signature makes it invalid', () => {
  const wallet = Keypair.random();
  const bytes = Buffer.from(signSep53(wallet, 'm'), 'base64');
  bytes[10] ^= 1;
  assert.equal(verifyStellarSignature(wallet.publicKey(), 'm', bytes.toString('base64')), false);
});

/* -------------------------------------------------------------------------- */
/* Roles and capabilities                                                      */
/* -------------------------------------------------------------------------- */

test('every role can at least view the case and evidence', () => {
  for (const role of roles) {
    assert.equal(permitted(role, 'CASE_VIEW'), true, `${role} should view cases`);
    assert.equal(permitted(role, 'EVIDENCE_VIEW'), true, `${role} should view evidence`);
  }
});

test('only the case admin can administer the case', () => {
  for (const role of roles) {
    assert.equal(permitted(role, 'CASE_ADMIN'), role === 'CASE_ADMIN', role);
  }
});

test('only roles that can upload evidence may upload it', () => {
  const uploaders = roles.filter(role => permitted(role, 'EVIDENCE_UPLOAD'));
  assert.deepEqual([...uploaders].sort(), ['CASE_ADMIN', 'FORENSIC_ANALYST', 'INVESTIGATOR']);
});

test('only admins and legal reviewers can export or attest', () => {
  for (const capability of ['EVIDENCE_EXPORT', 'ATTEST']) {
    const allowed = roles.filter(role => permitted(role, capability));
    assert.deepEqual([...allowed].sort(), ['CASE_ADMIN', 'LEGAL_REVIEWER'], capability);
  }
});

test('external reviewers and read-only users have no capability beyond viewing', () => {
  assert.deepEqual(capabilities.EXTERNAL_REVIEWER, ['CASE_VIEW', 'EVIDENCE_VIEW']);
  assert.deepEqual(capabilities.READ_ONLY, ['CASE_VIEW', 'EVIDENCE_VIEW']);
});

test('unknown roles and unknown capabilities are denied', () => {
  assert.equal(permitted('SUPERUSER', 'CASE_VIEW'), false);
  assert.equal(permitted('', 'CASE_VIEW'), false);
  assert.equal(permitted('CASE_ADMIN', 'DELETE_EVERYTHING'), false);
  assert.equal(permitted('__proto__', 'CASE_VIEW'), false);
  assert.equal(permitted('constructor', 'CASE_VIEW'), false);
  assert.equal(permitted('toString', 'CASE_VIEW'), false);
});

/* -------------------------------------------------------------------------- */
/* Hashing and canonical form                                                  */
/* -------------------------------------------------------------------------- */

test('sha256 matches a known vector', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(Buffer.from('abc')), sha256('abc'));
});

test('canonical form is stable for nested values, nulls, and arrays', () => {
  assert.equal(
    canonical({ b: [1, { z: null, a: 'x' }], a: true }),
    '{"a":true,"b":[1,{"a":"x","z":null}]}',
  );
  assert.equal(canonical(null), 'null');
  assert.equal(canonical('text'), '"text"');
  assert.equal(canonical([]), '[]');
  assert.equal(canonical({}), '{}');
});

test('canonical form keeps array order, so reordering is detectable', () => {
  assert.notEqual(canonical([1, 2, 3]), canonical([3, 2, 1]));
});

test('nonces are 64 hex characters and do not repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const nonce = generateNonce();
    assert.match(nonce, /^[0-9a-f]{64}$/);
    seen.add(nonce);
  }
  assert.equal(seen.size, 200);
});

/* -------------------------------------------------------------------------- */
/* Media types                                                                 */
/* -------------------------------------------------------------------------- */

test('mime types map to the evidence media type', () => {
  assert.equal(mediaType('video/mp4'), 'VIDEO');
  assert.equal(mediaType('audio/wav'), 'AUDIO');
  assert.equal(mediaType('image/png'), 'IMAGE');
  assert.equal(mediaType('application/pdf'), 'DOCUMENT');
  assert.equal(mediaType('text/plain'), 'DOCUMENT');
  assert.equal(mediaType('anything/else'), 'DOCUMENT');
});

/* -------------------------------------------------------------------------- */
/* Claim validation                                                            */
/* -------------------------------------------------------------------------- */

const known = new Set(['v1', 'v2']);
const cite = (versionId: string) => ({ versionId, span: 'p1' });

test('an unknown claim category is rejected', () => {
  assert.throws(
    () => validateClaims([{ category: 'GUESS', citations: [] }], known),
    /Invalid claim category/,
  );
});

test('every grounded category needs at least one citation', () => {
  for (const category of ['VERIFIED_FACT', 'CORROBORATED_CLAIM', 'CONFLICT']) {
    assert.throws(() => validateClaims([{ category }], known), /missing citation/, category);
  }
});

test('inference and unknown claims may stand without citations', () => {
  assert.doesNotThrow(() =>
    validateClaims([{ category: 'INFERENCE' }, { category: 'UNKNOWN' }], known),
  );
});

test('a citation must point at a version in this case and carry a span', () => {
  assert.throws(
    () => validateClaims([{ category: 'VERIFIED_FACT', citations: [cite('other-case')] }], known),
    /Invalid citation/,
  );
  assert.throws(
    () =>
      validateClaims(
        [{ category: 'VERIFIED_FACT', citations: [{ versionId: 'v1', span: '' }] }],
        known,
      ),
    /Invalid citation/,
  );
  assert.throws(
    () => validateClaims([{ category: 'INFERENCE', citations: [{ versionId: 'v1' }] }], known),
    /Invalid citation/,
  );
});

test('corroboration needs two distinct sources, not two spans of one', () => {
  assert.throws(
    () =>
      validateClaims(
        [{ category: 'CORROBORATED_CLAIM', citations: [cite('v1'), cite('v1')] }],
        known,
      ),
    /distinct sources/,
  );
  assert.doesNotThrow(() =>
    validateClaims(
      [{ category: 'CORROBORATED_CLAIM', citations: [cite('v1'), cite('v2')] }],
      known,
    ),
  );
});

test('one bad claim rejects the whole batch', () => {
  assert.throws(() =>
    validateClaims(
      [
        { category: 'VERIFIED_FACT', citations: [cite('v1')] },
        { category: 'VERIFIED_FACT', citations: [] },
      ],
      known,
    ),
  );
});

test('the five claim categories are exactly the documented ones', () => {
  assert.deepEqual(
    [...categories],
    ['VERIFIED_FACT', 'CORROBORATED_CLAIM', 'INFERENCE', 'CONFLICT', 'UNKNOWN'],
  );
});
