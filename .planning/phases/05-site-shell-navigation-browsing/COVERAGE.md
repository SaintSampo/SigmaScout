# Phase 5 — API Coverage Declaration

No external API integration: this phase consumes SigmaScout's own already-published static JSON
artifacts over plain `fetch()` from an R2 custom domain, and integrates no third-party API, SDK, or
service.

## Why this is a declaration rather than a matrix

The phase scope was re-read against the detector's signal before writing this file. Every network call
`apps/web` makes in Phase 5 is a `GET` for an object this project's own Phase 4 pipeline published:

| Read | Producer | Nature |
|---|---|---|
| `v1/teams/{year}/{algorithmId}@{version}.json` | `packages/harness/publish.ts` (Phase 4) | Static JSON, own artifact |
| `v1/events/{year}/{algorithmId}@{version}.json` | `packages/harness/publish.ts` (Phase 4) | Static JSON, own artifact |
| `v1/manifest/algorithms.json` | `packages/harness/manifests.ts` (Phase 4) | Static JSON, own manifest |

There is no third-party endpoint, no SDK client, no authentication handshake, and no capability surface
to enumerate — the "API" is a bucket of files this repository writes and validates with the same Zod
schemas on both sides.

## The one third-party API in scope, and where it is decided

Plan 05-02 touches The Blue Alliance's API, but only through the ingest layer that Phase 1 already
integrated (`packages/ingest/tbaClient.ts`, `packages/ingest/schemas.ts`). It adds five fields to the
already-integrated `event` object's schema; it introduces no new endpoint and no new capability. TBA's
coverage decisions belong to the phase that integrated it, not to this one.

## Cloudflare configuration is configuration, not integration

Plan 05-01 provisions a Cloudflare Pages project and applies an R2 CORS policy via `wrangler`. These are
one-time infrastructure operations against an account this project already uses (Phase 4 deploys the
Worker, the D1 database and the R2 bucket from it). No Cloudflare API client ships in any artifact this
phase produces.
