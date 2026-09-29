---
phase: 04-publish-live-update-pipeline
plan: 01
subsystem: infra
tags: [cloudflare, r2, wrangler, sigv4, zod, publish-pipeline, secrets]

# Dependency graph
requires:
  - phase: 03.2-swap-opr-to-event-scoped-and-re-issue-affected-figures
    provides: event-scoped opr.ts (3.0.0+baseline) and the corpus WalkForwardSimulator/replay.ts
      primitives this plan's publisher reuses unchanged
provides:
  - "packages/core/algorithms/leakProof.ts: the Worker-importable toLeakProofUpcoming/OUTCOME_KEYS
    guard, mechanically proven importable by packages/core/isomorphic.test.ts"
  - "packages/harness/pageArtifacts.ts: artifactKey (v1/ key builder for all 5 page kinds) and
    EventArtifactSchema, the published-page contract"
  - "packages/harness/r2Client.ts: hand-rolled SigV4 putObject/getObject against R2's
    S3-compatible endpoint, no new dependency"
  - "packages/harness/publish.ts: pnpm publish:artifacts CLI + pure buildEventArtifact assembly"
  - "apps/worker/package.json: first per-package manifest in the repo, wrangler +
    @cloudflare/workers-types installed"
  - "A real published artifact in production R2 at v1/event/2026azfg/opr@3.0.0+baseline.json,
    proven byte-identical over a public HTTPS fetch"
  - "Cloudflare credentials under the same never-print, hash-compare secrets discipline as TBA_API_KEY"
  - ".claude/CLAUDE.md's D1 stance reconciled with D-13 (Worker-internal state vs. client-facing SQL)"
affects: [04-02-precompute-upcoming-and-team-metrics, 04-03-multi-page-multi-algorithm-publish,
  04-05-cron-worker-scaffold, 04-06-worker-read-path, phase-05-teams-events-ui, phase-08-compare-page]

# Actuals (#2632)
actuals:
  tokens: 11800
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: ["wrangler@4.125.0 (apps/worker devDependency)", "@cloudflare/workers-types@5.20260822.1 (apps/worker devDependency)"]
  patterns:
    - "Worker-importable core modules live under packages/core/ and are mechanically enforced by
      packages/core/isomorphic.test.ts's forbidden-import scan; a Node-only module (replay.ts,
      cli.ts) re-exports from the core module rather than owning the Worker-facing logic"
    - "Published page artifacts (packages/harness/pageArtifacts.ts) are a schema family
      independent from the harness's internal scoring artifact (packages/harness/artifact.ts) —
      separate schema versions, separate consumers, never coupled"
    - "R2 writes: validate-then-persist. buildEventArtifact assembles a candidate,
      EventArtifactSchema.parse() gates it, and only a successful parse reaches putObject — a
      validation failure performs zero uploads (T-04-04)"
    - "SigV4 signing lives in one private helper (r2Client.ts's signRequest) so the whole
      Cloudflare credential surface is one place; RFC3986 path encoding (encodePath/uriEncode)
      keeps the signed path and the requested path from ever drifting apart"

key-files:
  created:
    - packages/core/algorithms/leakProof.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/r2Client.ts
    - packages/harness/publish.ts
    - packages/harness/publish.tracer.test.ts
    - apps/worker/package.json
  modified:
    - packages/harness/replay.ts
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - scripts/secrets-boundary.test.ts
    - .env.example
    - .claude/CLAUDE.md

key-decisions:
  - "toLeakProofUpcoming/OUTCOME_KEYS moved verbatim from packages/harness/replay.ts into
    packages/core/algorithms/leakProof.ts, byte-identical behavior; replay.ts re-exports both so
    all 45 pre-existing test files kept their import paths unchanged"
  - "packages/harness/cli.ts's applyPromotedOverrides (promoted-version resolution) is NOT
    re-derived in the Worker — that rule stays offline-only; the promoted version's identity and
    params will ride in an offline-published manifest (plan 04-03) the Worker rebuilds via
    makeSigma1, per D-12's offline-pipeline-is-the-authority principle. Recorded here, implemented
    in 04-03."
  - "R2 key separators (@ for algorithm@version, + inside {codeVersion}+{paramSetName}) needed NO
    substitution — both survived the real HTTPS round trip against R2's public r2.dev endpoint
    byte-identical. artifactKey's documented -- fallback was not exercised."
  - ".claude/CLAUDE.md's D1 exclusion narrowed (not deleted): client-facing ad-hoc SQL stays
    excluded; Worker-internal per-team live state is now a stated D1 use case, with the
    subrequest-budget reasoning (~42 of 50 subrequests via R2 vs. ~2 via D1 batch()) that D-13
    reopened and 04-RESEARCH.md answered"
  - "Cloudflare packages (wrangler, @cloudflare/workers-types) confirmed legitimate first-party
    Cloudflare packages by direct npmjs.com inspection (publisher, repo, download counts) before
    install — the RESEARCH.md 'too-new' SUS flag was a false positive against a fast-shipping
    first-party package family, exactly as RESEARCH.md's own assessment predicted"

requirements-completed: []

coverage:
  - id: D1
    description: "Cloudflare account/bindings confirmed available, package legitimacy verified,
      credentials provisioned into .env (Task 1 — human-resolved before this executor's dispatch;
      see Task 1 note below)"
    verification:
      - kind: manual_procedural
        ref: "Human-verified 2026-08-22 per orchestrator-supplied evidence block; not re-run by
          this executor per explicit instruction"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cloudflare credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL) carry the same never-print, hash-compare secrets
      discipline as TBA_API_KEY, and .claude/CLAUDE.md no longer contradicts the D1 design"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "scripts/secrets-boundary.test.ts#cloudflare credentials boundary (D-24)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worker-importable leak-proof guard extracted to packages/core, mechanically
      proven importable and behaviorally unchanged"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/core/isomorphic.test.ts#imports no Node built-in modules and no
          better-sqlite3 anywhere under packages/core"
        status: pass
      - kind: unit
        ref: "packages/harness/replay.test.ts (full suite, same test count as before the move)"
        status: pass
    human_judgment: false
  - id: D4
    description: "One real event's page artifact, computed offline by event-scoped OPR, published
      to production R2 at a stable v1/ versioned key, and fetched back byte-identical over plain
      HTTPS with cache-control (max-age=60) and etag set"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "packages/harness/publish.tracer.test.ts#buildEventArtifact / artifactKey / EventArtifactSchema validation gate"
        status: pass
      - kind: manual_procedural
        ref: "Real pnpm publish:artifacts run against 2026azfg + curl round-trip diff, see
          Deviations/notes below for the transcript summary"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 1: Cloudflare Bootstrap & Publish Tracer Summary

**Hand-rolled SigV4 R2 client, a Worker-importable leak-proof guard extracted to packages/core, and a real event artifact (opr@3.0.0+baseline for 2026azfg) published to production R2 and fetched back byte-identical over HTTPS.**

## Performance

- **Duration:** ~25 min (Tasks 2-3; Task 1 was a human-resolved checkpoint before this executor's dispatch)
- **Tasks:** 3 (1 human-resolved checkpoint, 2 executed)
- **Files modified:** 13 (6 created, 7 modified)

## Accomplishments

- Extracted `toLeakProofUpcoming`/`OUTCOME_KEYS` from `packages/harness/replay.ts` into
  `packages/core/algorithms/leakProof.ts` — now mechanically proven Worker-importable by
  `packages/core/isomorphic.test.ts`'s forbidden-import scan, closing the phase's Design
  Question 1 (`replay.ts` itself pulls in `better-sqlite3` via `packages/corpus/db.ts` and can
  never be imported by a Worker directly).
- Built the D-01/D-02 published-artifact key scheme (`packages/harness/pageArtifacts.ts`'s
  `artifactKey`, all five page shapes under a `v1/` prefix) and the first page schema
  (`EventArtifactSchema`, D-04's `generation`/`computedAt` stamp required, not optional).
- Hand-rolled AWS SigV4 request signing over `node:crypto` (`packages/harness/r2Client.ts`) — no
  new dependency, matching the standing native-`fetch` preference. One private `signRequest`
  helper owns the whole credential surface; RFC 3986 path encoding keeps the signed path and the
  requested path in lockstep.
- Built `pnpm publish:artifacts` (`packages/harness/publish.ts`), single-event mode: reads the
  corpus read-only, replays one event through `opr` via the existing `WalkForwardSimulator`, and
  only uploads after `EventArtifactSchema.parse()` succeeds (T-04-04 — a validation failure
  performs zero uploads).
- Created `apps/worker/package.json`, the repo's first per-package manifest, installing
  `wrangler@4.125.0` and `@cloudflare/workers-types@5.20260822.1` (the exact versions confirmed
  legitimate in Task 1's checkpoint).
- **Ran the tracer for real**: `pnpm publish:artifacts --event 2026azfg --algorithm opr` published
  `v1/event/2026azfg/opr@3.0.0+baseline.json` (35,054 bytes) to the production `sigmascout-artifacts`
  bucket. Fetched back over `curl` against the public `r2.dev` URL: **HTTP 200**, `Cache-Control:
  public, max-age=60`, a non-empty `ETag`, and the response body byte-identical to the uploaded
  body (`diff` produced no output). The `+`/`@` characters in the key survived the round trip with
  no separator substitution needed — `artifactKey`'s documented `--` fallback was not exercised.
- Extended `scripts/secrets-boundary.test.ts` with a `cloudflare credentials boundary (D-24)`
  block mirroring the TBA key's hash-compare discipline exactly, added the four Cloudflare
  placeholders to `.env.example`, and narrowed `.claude/CLAUDE.md`'s D1 exclusion to the
  client-facing ad-hoc-SQL read path (adding a separate Worker-internal D1 row with the
  subrequest-budget reasoning D-13 reopened).

## Task Commits

Task 1 (`checkpoint:human-verify`, `gate="blocking-human"`) was resolved by the human before this
executor's dispatch — see the orchestrator-supplied evidence block for the wrangler
version/account/bucket confirmation. No commit corresponds to it; it produced no code changes.

1. **Task 2: Cloudflare credentials under the TBA key's secrets discipline; CLAUDE.md
   reconciliation** - `dfd68f3c` (feat)
2. **Task 3: One real event's page artifact, published and fetched back byte-identical** -
   `d6694219` (feat)

## Files Created/Modified

- `packages/core/algorithms/leakProof.ts` - `toLeakProofUpcoming`/`OUTCOME_KEYS`, moved verbatim, Worker-importable
- `packages/harness/replay.ts` - re-exports the moved guard; all other exports unchanged
- `packages/harness/pageArtifacts.ts` - `artifactKey`, `EventArtifactSchema`, `PAGE_ARTIFACT_SCHEMA_VERSION`
- `packages/harness/r2Client.ts` - `putObject`/`getObject`, hand-rolled SigV4 signing
- `packages/harness/publish.ts` - `pnpm publish:artifacts` CLI, pure `buildEventArtifact`
- `packages/harness/publish.tracer.test.ts` - assembly/key-scheme/validation-gate test suite
- `apps/worker/package.json` - first per-package manifest; `wrangler` + `@cloudflare/workers-types`
- `package.json` - `publish:artifacts` script
- `pnpm-workspace.yaml` - `workerd: true` build approval, `minimumReleaseAgeExclude` entry for the freshly-dated `@cloudflare/workers-types` release
- `pnpm-lock.yaml` - lockfile update for the two new devDependencies
- `scripts/secrets-boundary.test.ts` - `cloudflare credentials boundary (D-24)` describe block
- `.env.example` - four Cloudflare placeholder lines
- `.claude/CLAUDE.md` - D1 stance narrowed per D-13

## Decisions Made

- `toLeakProofUpcoming`/`OUTCOME_KEYS` moved, not duplicated — one definition, re-exported, so the
  Worker and the offline harness can never drift onto two different leak-proof implementations.
- `applyPromotedOverrides` (promoted-version resolution) deliberately NOT re-derived in the
  Worker; the promoted version's identity/params will ride in an offline-published manifest
  (plan 04-03 owns this) that the Worker rebuilds via `makeSigma1`. This plan only records the
  decision, per the plan's own objective text.
- No separator substitution was needed for the `@`/`+` characters in a published key — recorded
  as a decision (not a deviation) since the plan explicitly anticipated this could go either way
  and instructed recording the outcome regardless.
- `.claude/CLAUDE.md`'s D1 "What NOT to Use" row was narrowed in place (not deleted), with a
  dated note pointing at this plan and D-13 — the repo's own documents now state present fact
  rather than a stale blanket exclusion.

## Deviations from Plan

None - plan executed exactly as written. The one documented "if X, do Y" branch (Task 3's
`+`-separator fallback) was not triggered — the round trip succeeded on the first real attempt
with the literal `+`/`@` characters intact, so `artifactKey`'s key scheme ships as originally
planned.

## Known Stubs

- `EventArtifactSchema.upcoming` is always an empty array in this plan's output — explicitly
  planned (D-08), filled by plan 04-02, not a defect. No `WINDOWS.md` entry needed: the plan's own
  `<action>` text and this schema's doc comment both name plan 04-02 as the resolution.

## Issues Encountered

- **Windows dev environment gap:** `better-sqlite3`'s `pnpm install` postinstall script attempts
  `node-gyp rebuild`, which fails in this worktree (no Visual Studio Build Tools installed) even
  though the package ships a working `prebuilds/win32-x64.node` binary that `lib/win32-x64.js`
  loads directly at runtime, with no build step required. Worked around locally with
  `pnpm install --ignore-scripts` (a workaround, not a code change — nothing in the repo needed to
  change; the same install succeeds cleanly on the main checkout's machine state). Verified the
  native module loads and reads the real corpus correctly (`SELECT COUNT(*) FROM matches` →
  104,925) before proceeding. No commit reflects this — it is local environment state, not a
  repo change.
- This worktree had no local `.env` or `data/corpus.sqlite` (both gitignored, absent from a fresh
  checkout per this plan's own `<worktree_env_note>`). Both were copied in from the orchestrator's
  main checkout for the duration of this run; `.env` was deleted before the final commit and
  confirmed absent from `git status --porcelain`.

## User Setup Required

None for this plan specifically — Task 1's Cloudflare account/credential setup was already
completed by the human before this executor's dispatch (see orchestrator-supplied evidence).

## Next Phase Readiness

- The key scheme, schema conventions, upload path, and shared leak-proof module all exist and are
  proven end-to-end on real infrastructure — plans 04-02 and 04-03 (which widen this to upcoming
  matches, teams/events pages, and multi-algorithm publish) are unblocked.
- `apps/worker`'s manifest exists with `wrangler`/`@cloudflare/workers-types` installed; plan 04-05
  (cron Worker scaffold) can add `src/`/`wrangler.toml` without a fresh package-setup step.
- The promoted-version-resolution manifest question (Design Question 2) is recorded, not yet
  implemented — plan 04-03 owns building the offline-published manifest the Worker will read.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All six created files confirmed present on disk (`packages/core/algorithms/leakProof.ts`,
`packages/harness/pageArtifacts.ts`, `packages/harness/r2Client.ts`, `packages/harness/publish.ts`,
`packages/harness/publish.tracer.test.ts`, `apps/worker/package.json`). Both task commits
(`dfd68f3c`, `d6694219`) confirmed present in `git log --oneline --all`.
