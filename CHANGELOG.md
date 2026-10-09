# Changelog

## 0.2.0 — 2026-10-09

### Added
- **Stellar anchor signer** (`src/anchor.ts`). The worker can now build, sign,
  and submit the `anchor` call on the evidence anchor registry itself, using
  `STELLAR_SIGNER_SECRET` and `STELLAR_EVIDENCE_ANCHOR_CONTRACT`. Previously
  anchoring required an external signing service that did not exist, so the
  `stellar-anchor` job could never complete. The external service is still
  supported and takes priority when configured. Retries are safe because the
  contract treats an identical anchor as a no-op.
- 49 new tests (10 to 59): manifests, both anchor clients, environment
  selection, wallet-signature verification, role permissions, hashing, and
  claim validation.
- Prettier, with `format`, `format:check`, and a CI step.

### Fixed
- `permitted()` threw a `TypeError` for role names such as `__proto__` or
  `constructor`, which resolved through `Object.prototype`. It now denies them.
- The security contact address in the README and SECURITY.md had a typo
  (`gmaill.com`), so vulnerability reports could not be delivered.

### Changed
- Reformatted all source. The worker and API were written as single very long
  lines (up to 800 characters), which made review impractical. No behavior
  change: the same tests passed before and after.
- The duplicated evidence and attestation anchor code in the worker now shares
  one implementation.
