# Security Policy

## Audit status

This service has **not** undergone an independent security audit. It's deployed against Stellar Testnet and demo infrastructure. Do not point it at real evidence, real personal data, or Stellar Mainnet without an audit first.

## Reporting a vulnerability

Email **chijiokejoseph20242@gmaill.com** with a description of the issue and reproduction steps. Do not open a public GitHub issue for security vulnerabilities.

You should get an acknowledgement within 5 business days. Once a fix is available, we'll coordinate disclosure timing with you.

## Scope

In scope: this API service, its authentication and authorization logic, evidence handling, and job orchestration. Out of scope: the Soroban contracts (report those in [afterprint-contracts](https://github.com/Afterprint/afterprint-contracts)), the AI service (report those in [afterprint-ai](https://github.com/Afterprint/afterprint-ai)), and third-party infrastructure (Supabase, Upstash, Render).
