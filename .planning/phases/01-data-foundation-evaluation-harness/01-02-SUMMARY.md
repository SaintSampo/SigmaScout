---
phase: 01-data-foundation-evaluation-harness
plan: 02
subsystem: data-pipeline
tags: [tba-api, zod, better-sqlite3, ml-matrix, opr, walk-forward, vitest]

# Dependency graph
requires:
  - phase: 01-data-foundation-evaluation-harness (Plan 01)
    provides: Pinned Node/TypeScript/Vitest toolchain, verified better-sqlite3 native binding, docs/data/tba-field-recon.md (rp field name, Statbotics endpoint status)
provides:
  - "AlgorithmModule<S> contract (packages/core/algorithms/types.ts) — the shape every later algorithm (EPA, Sigma1) implements"
  - "A real, non-placeholder OPR baseline computing genuine ratings via ridge-regularized least squares"
  - "SQLite corpus schema (events/matches/http_cache) — the shape every later ingestion query targets"
  - "The canonical JSON harness artifact shape — the contract the Phase 8 Compare page will consume"
  - "toLeakProofUpcoming / WalkForwardSimulator — the structural (Proxy-enforced) predict-before-update guarantee, reused by every future algorithm's evaluation"
  - "Working `pnpm harness --event <key> --algorithm opr [--out <dir>]` CLI, end-to-end proven against a real event"
affects: ["01-03", "01-04", "01-05", "01-06"]

# Actuals (#2632)
actuals:
  tokens: 10100
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "packages/core/** stays free of Node built-ins and better-sqlite3 so it is reusable unchanged by the Phase 4 Cloudflare Worker (ARCHITECTURE.md Pattern 1)"
    - "Proxy-based runtime leak guard (toLeakProofUpcoming) rather than a type-only convention — outcome leakage fails at runtime, not just at the type checker"
    - "JSON artifact is the canonical source of truth; the HTML report renders from it, never the reverse (D-02)"
    - "Diff-on-upsert replay detection in packages/corpus/db.ts — TBA exposes no replay flag, so the corpus synthesizes one by comparing a match's previously-stored score-bearing fields against the incoming upsert"
    - "Missing score_breakdown is stored as has_score_breakdown=0 with a null raw column, never a zero-valued breakdown"

key-files:
  created:
    - packages/core/algorithms/types.ts
    - packages/core/algorithms/opr.ts
    - packages/core/scoring/brier.ts
    - packages/ingest/tbaClient.ts
    - packages/ingest/schemas.ts
    - packages/ingest/normalize.ts
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/harness/replay.ts
    - packages/harness/report.ts
    - packages/harness/cli.ts
    - packages/harness/replay.test.ts
  modified:
    - .gitignore
    - package.json

key-decisions:
  - "packages/corpus/schema.sql covers only events, matches, and http_cache (not a teams table) — the plan's must_haves artifact list names exactly these three tables even though RESEARCH.md's broader sketch included teams; the narrower, explicitly-scoped list is authoritative for this tracer."
  - "The replayed flag is computed in packages/corpus/db.ts's upsertMatch (diff-on-upsert against the previously-stored row), not in packages/ingest/normalize.ts — normalize.ts has no visibility into prior corpus state, so this is the only correct layer for Pitfall 1's synthesized-flag detector."
  - "TBA's alliance.score is schema'd as nullable (z.number().nullable()) rather than just z.number() — TBA reports either null or -1 for an unplayed match's alliance score depending on API version; isPlayed() treats both null and negative scores as 'not played'."
  - "report.ts exports only writeArtifact, renderHtmlReport, and escapeHtml (not a separate writeHtmlReport) to match the plan's explicit 'Artifacts this phase produces' function list; cli.ts writes the rendered HTML string to disk directly via node:fs."
  - "package.json's harness script now runs via `tsx --env-file=.env` (previously missing) — without it, TBA_API_KEY would never reach process.env when invoked via `pnpm harness`, failing Task 1's own precondition for no reason related to the key's actual presence."

requirements-completed: [DATA-01, EVAL-01, EVAL-02, ALGO-01]

coverage:
  - id: D1
    description: "packages/core/algorithms/types.ts defines the AlgorithmModule<S>/UpcomingMatch/MatchResult/Prediction contract exactly as specified in the plan's <interfaces> block"
    requirement: ALGO-01
    verification:
      - kind: other
        ref: "pnpm typecheck (all downstream modules compile against these exact shapes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "OPR baseline (packages/core/algorithms/opr.ts) computes real, non-placeholder ratings via ridge-regularized least squares (ml-matrix SVD) and produces a calibrated win probability"
    requirement: ALGO-01
    verification:
      - kind: other
        ref: "pnpm harness --event 2024casj --algorithm opr --out data/tracer: 93 predictions, all pRedWin in [0,1], Brier 0.2246, winner accuracy 64.5%"
        status: pass
    human_judgment: false
  - id: D3
    description: "TBA ingestion (tbaClient.ts + schemas.ts + normalize.ts + db.ts) fetches an event and its matches with ETag-conditional requests, Zod-validates at the boundary, and stores quirk-aware rows (replay flag, has_score_breakdown never coerced to zero)"
    requirement: DATA-01
    verification:
      - kind: other
        ref: "First run: two 200 OK fetches, 93 matches stored. Second run: both /event/2024casj and /event/2024casj/matches logged '304 Not Modified'."
        status: pass
    human_judgment: false
  - id: D4
    description: "WalkForwardSimulator + toLeakProofUpcoming structurally enforce predict-before-update; reading an outcome field before update() throws"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "packages/harness/replay.test.ts (12 tests, all passing) — outcome-field-throws, non-outcome-passthrough, leaky-algorithm-throws, predict/update alternation, deterministic ordering"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both the canonical JSON artifact and a self-contained, escaped HTML report are produced from one harness run; no TBA API key value appears in either output"
    requirement: EVAL-02
    verification:
      - kind: other
        ref: "test -s data/tracer/artifact.json && test -s data/tracer/report.html; grep -c <api-key-value> against both files returned 0; grep for src=\"http/href=\"http/<script src=/<link found 0 off-disk references"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 2: Tracer — TBA Ingestion Through Corpus, Walk-Forward OPR, Both Artifacts Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**One real event (2024casj) flows end-to-end through ETag-cached TBA ingestion, Zod validation, quirk-aware normalization, a SQLite corpus, a Proxy-enforced walk-forward replay, a ridge-regularized OPR baseline, and both a canonical JSON artifact and a self-contained escaped HTML report — producing 93 predictions (Brier 0.2246, winner accuracy 64.5%) and proving outcome leakage is structurally impossible by 12 passing tests, not by design intent.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-13T04:04:04Z (continuation from Plan 01's completion)
- **Completed:** 2026-08-13T04:16:58Z
- **Tasks:** 2
- **Files modified:** 14 (12 new + 2 modified)

## Accomplishments
- `packages/core/algorithms/types.ts` defines the exact `AlgorithmModule<S>`/`UpcomingMatch`/`MatchResult`/`Prediction` contract every later algorithm (EPA, Sigma1) will implement, with `packages/core/**` provably free of Node built-ins and better-sqlite3 (reusable unchanged by the Phase 4 Worker)
- OPR baseline (`packages/core/algorithms/opr.ts`) computes real per-team ratings via a ridge-regularized least-squares solve (`ml-matrix`'s `SingularValueDecomposition`), producing genuine (non-placeholder) win probabilities via a logistic score-margin transform
- ETag-conditional TBA ingestion (`packages/ingest/tbaClient.ts` + `schemas.ts` + `normalize.ts`) validates every response at the fetch boundary with Zod, normalizes totals/winner/RP per D-05, and never coerces a missing `score_breakdown` to a zero-valued one
- SQLite corpus (`packages/corpus/schema.sql` + `db.ts`) with WAL, idempotent DDL, and a diff-on-upsert replay detector that synthesizes the `replayed` flag TBA's API itself never exposes (RESEARCH.md Pitfall 1)
- `WalkForwardSimulator` + `toLeakProofUpcoming` (`packages/harness/replay.ts`) make predict-before-update a runtime fact: a Proxy `get` trap throws for every outcome-bearing property name, proven by 12 passing tests in `replay.test.ts`
- `pnpm harness --event <key> --algorithm opr --out <dir>` (`packages/harness/cli.ts`) wires the whole path and was run twice against the real event `2024casj`: first run fetched and stored 93 matches (two 200s), second run took the 304 path on both requests
- Canonical JSON artifact + self-contained HTML report (`packages/harness/report.ts`), every TBA-sourced string routed through `escapeHtml`, with a runtime assertion refusing to write either file if the serialized output contains the TBA API key value

## Task Commits

Each task was committed atomically:

1. **Task 1: One event, end to end — TBA fetch through corpus, replay, OPR, scoring, both artifacts** - `f0780499` (feat)
2. **Task 2: Prove outcome leakage is structurally impossible and replay order is deterministic** - `3be51f33` (test)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/core/algorithms/types.ts` - `AlgorithmModule<S>`, `UpcomingMatch`, `MatchResult`, `Prediction` contracts
- `packages/core/algorithms/opr.ts` - Ridge-regularized OPR baseline, exported as `opr`
- `packages/core/scoring/brier.ts` - `brierScore`, `winnerAccuracy`
- `packages/ingest/tbaClient.ts` - `tbaFetch`, ETag-conditional TBA v3 requests
- `packages/ingest/schemas.ts` - Zod schemas for TBA event/match shapes
- `packages/ingest/normalize.ts` - `normalizeEvent`, `normalizeMatch` (TBA -> corpus row)
- `packages/corpus/schema.sql` - SQLite DDL: events, matches, http_cache
- `packages/corpus/db.ts` - `openCorpus`, `upsertEvent`, `upsertMatch` (with diff-on-upsert replay detection), `selectMatchesChronological`, `readEtag`, `writeEtag`
- `packages/harness/replay.ts` - `toLeakProofUpcoming`, `WalkForwardSimulator`
- `packages/harness/report.ts` - `HarnessArtifact`/`PredictionArtifactRecord` types, `writeArtifact`, `renderHtmlReport`, `escapeHtml`
- `packages/harness/cli.ts` - Harness entry point (`--event`, `--algorithm`, `--out`)
- `packages/harness/replay.test.ts` - Leakage and replay-ordering regression tests (12 tests)
- `.gitignore` - Added `data/` (corpus + harness output directory)
- `package.json` - `harness` script now runs via `tsx --env-file=.env`

## Decisions Made
- Scoped `schema.sql` to exactly the three tables the plan's `must_haves.artifacts` names (events, matches, http_cache) rather than RESEARCH.md's broader sketch that also included a `teams` table — the plan's explicit artifact list is authoritative for this tracer; a teams table can be added without migration pain in a later plan if needed
- Placed replay-flag synthesis in `db.ts`'s `upsertMatch` (diff-on-upsert), not in `normalize.ts` — only the corpus layer has visibility into a match's previously-stored score-bearing fields, which is what Pitfall 1's detector needs to compare against
- Schema'd `alliances.{color}.score` as nullable to cover both TBA API behaviors (null or -1) for an unplayed match's score, rather than assuming one sentinel value
- `report.ts` exports only `writeArtifact`/`renderHtmlReport`/`escapeHtml` (matching the plan's explicit function list) rather than adding an unlisted `writeHtmlReport`; `cli.ts` writes the rendered HTML string to disk directly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm harness` script did not load `.env`, so `TBA_API_KEY` was never in `process.env` when invoked via the package script**
- **Found during:** Task 1, first `pnpm harness` dry-run attempt
- **Issue:** `package.json`'s `harness` script was `tsx packages/harness/cli.ts` (no `--env-file`), unlike the sibling `recon:tba` script from Plan 01 which already had `--env-file=.env`. Task 1's own precondition ("TBA_API_KEY is present in the environment") would fail for a packaging reason unrelated to whether the key actually exists in `.env`.
- **Fix:** Changed the script to `tsx --env-file=.env packages/harness/cli.ts`.
- **Files modified:** `package.json`
- **Verification:** `pnpm harness --event 2024casj --algorithm opr --out data/tracer` ran successfully, reading the key from `.env`
- **Committed in:** `f0780499` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Runtime assertion that neither output file contains the TBA API key value**
- **Found during:** Task 1, while implementing `writeArtifact`/the HTML write path (T-01-02 in the plan's own threat model requires this)
- **Issue:** The plan's acceptance criteria and threat register (T-01-02) require an automated assertion that the serialized artifact never contains the API key — this needed to be built into the writers, not left as an unenforced convention.
- **Fix:** `writeArtifact` takes an optional `secretToScrub` parameter and throws before writing if the serialized JSON contains it; `cli.ts` performs the same check on the rendered HTML string before writing `report.html`. Both are called with the actual `apiKey` value read from `process.env`.
- **Files modified:** `packages/harness/report.ts`, `packages/harness/cli.ts`
- **Verification:** `grep -c <key-value>` against both `data/tracer/artifact.json` and `data/tracer/report.html` returned 0 matches
- **Committed in:** `f0780499` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking-issue fix, 1 Rule 2 missing-critical addition). No Rule 4 architectural changes were needed.
**Impact on plan:** Both fixes were necessary for the plan's own stated acceptance criteria and threat-model mitigations to be satisfiable at all. No scope creep — no plan file was edited, no new artifacts were added beyond what the plan specified.

## TDD Gate Compliance

Task 2 (`tdd="true"`) does not follow a literal RED-GREEN-REFACTOR cycle: the implementation under test (`packages/harness/replay.ts`'s `toLeakProofUpcoming`/`WalkForwardSimulator`) was already built as part of Task 1's tracer, which had to include a real, working leak guard to satisfy Task 1's own acceptance criteria (the harness had to run end-to-end). Task 2's job — per its own `<done>` criterion, "proven by an automated test, not asserted by design intent" — is to add formal test coverage over that already-correct behavior, not to drive a fresh implementation into existence. When `packages/harness/replay.test.ts` was first written and run, all 12 tests passed immediately (no RED phase), because the guard it exercises was already correct. This is the expected outcome for this specific task shape (test-after on an already-tracer-built mechanism), not a violation of TDD discipline — there was no missing implementation for a RED phase to reveal. Only a single `test(01-02): ...` commit was produced for this task; no `feat(01-02): ...` commit followed it because no implementation change was required.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required beyond the existing `.env` (already present from Plan 01).

## Next Phase Readiness
- The corpus schema (`events`/`matches`/`http_cache`) and the JSON artifact shape are fixed and committed — Plans 03-06 build directly on both
- `AlgorithmModule<S>` is proven end-to-end with a real algorithm (OPR); Plan 04's expansion (season-scope pooling, surrogate exclusion per D-07, solver tuning) has a working foundation to extend rather than replace
- The leak guard and its test suite are the literal proof of Phase 1 success criterion 4 — later algorithms (EPA, Sigma1) reuse the same `WalkForwardSimulator` call site, so the guarantee automatically extends to them
- No blockers identified for Plan 03 (season-scale ingestion + quirk handling expansion), which depends on this plan's corpus schema and ingestion modules

---
*Phase: 01-data-foundation-evaluation-harness*
*Completed: 2026-08-13*

## Self-Check: PASSED

All 12 created artifacts confirmed present on disk (types.ts, opr.ts, brier.ts, tbaClient.ts, schemas.ts, normalize.ts, schema.sql, db.ts, replay.ts, report.ts, cli.ts, replay.test.ts). Both referenced commit hashes (`f0780499`, `3be51f33`) confirmed present in `git log`.
