<p align="center">
  <img src="https://raw.githubusercontent.com/Afterprint/afterprint-web/main/public/afterprint-logo.png" width="72" alt="Afterprint logo" />
</p>

<h1 align="center">Afterprint — API</h1>

<p align="center">
  Authorization boundary, immutable evidence ingest, custody chain, and job orchestration for the Afterprint evidence-intelligence platform.
</p>

<p align="center">
  <a href="https://github.com/Afterprint/afterprint-api/actions/workflows/ci.yml"><img src="https://github.com/Afterprint/afterprint-api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/runtime-Node%2022-339933" alt="Node 22">
  <img src="https://img.shields.io/badge/network-Stellar%20Testnet-blue" alt="Stellar Testnet">
  <img src="https://img.shields.io/github/license/Afterprint/afterprint-api" alt="License">
</p>

---

## What this service does

`afterprint-api` is the boundary every request to Afterprint crosses. It:

- Authenticates users via Freighter wallet signature (Stellar keypair, no passwords) — see [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md)
- Enforces role-based permissions per case (`CASE_ADMIN`, `INVESTIGATOR`, `LEGAL_REVIEWER`, etc.)
- Issues presigned S3 upload URLs and records evidence as immutable, versioned objects with an append-only custody chain (enforced at the Postgres trigger level, not just in application code)
- Orchestrates background jobs (via BullMQ/Redis) that hand evidence to [`afterprint-ai`](https://github.com/Afterprint/afterprint-ai) for processing and queue Stellar anchoring for custody events and attestations
- Anchors integrity proofs on Stellar via the [`afterprint-contracts`](https://github.com/Afterprint/afterprint-contracts) registries

## Architecture

```
afterprint-web  →  afterprint-api  →  Postgres (Supabase)
                         │         →  S3-compatible storage (Supabase Storage)
                         │         →  Redis (Upstash) — job queues
                         ├────────→  afterprint-ai (evidence processing, AI analysis)
                         └────────→  Stellar Testnet (custody/attestation anchoring)
```

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, AI_URL, S3_*, etc.
pnpm prisma generate
pnpm prisma migrate deploy
pnpm dev                # API on :4000, hot reload
pnpm worker              # background job worker, separate process
```

```bash
pnpm build      # tsc
pnpm test       # unit tests (node:test)
pnpm typecheck
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and coding standards, and [SECURITY.md](./SECURITY.md) to report a vulnerability privately.

## Maintainer

| | |
|---|---|
| **GitHub** | [@helloworld1-star](https://github.com/helloworld1-star) |
| **Email** | chijiokejoseph20242@gmaill.com |

---

<p align="center">
  <a href="https://github.com/Afterprint/afterprint-api/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=Afterprint/afterprint-api" alt="Contributors" />
  </a>
</p>
