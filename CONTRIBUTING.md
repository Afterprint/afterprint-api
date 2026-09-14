# Contributing to afterprint-api

## Setup

```bash
pnpm install
cp .env.example .env   # needs a Postgres DB, Redis, and a running afterprint-ai instance
pnpm prisma generate
pnpm prisma migrate deploy
pnpm dev
```

## Workflow

1. Pick an issue from the [tracker](https://github.com/Afterprint/afterprint-api/issues).
2. Branch from `main`: `git checkout -b feat/short-description`.
3. One logical change per commit, [Conventional Commits](https://www.conventionalcommits.org/) format: `type(scope): description`.
4. `pnpm build`, `pnpm typecheck`, and `pnpm test` must all pass before opening a PR.
5. If you touch `prisma/schema.prisma`, generate a real migration (`pnpm prisma migrate dev`) — don't hand-edit `migration.sql` and don't let the schema drift from what's actually applied to the database.
6. Open a PR against `main`. CI must pass.

## Code standards

- Every route that mutates state checks the caller's role via `permitted()` before touching the database — never rely on the frontend to enforce access control.
- Evidence and custody records are append-only by design (enforced by Postgres triggers, not just application code) — don't add code paths that update or delete them.
- Background work goes through the `Outbox` table + BullMQ queues, not direct fire-and-forget calls — this is what makes job processing retryable and observable.
- No secrets or credentials in code, tests, or commit messages — use environment variables.

## Reporting a security issue

See [SECURITY.md](./SECURITY.md) — do not open a public issue for a vulnerability.
