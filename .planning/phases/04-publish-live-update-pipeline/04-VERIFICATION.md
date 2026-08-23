---
phase: 04-publish-live-update-pipeline
verified: 2026-08-23T14:00:00Z
status: passed
score: 4/5 must-haves verified; the 5th accepted as unverified by explicit user decision (see human_verification_disposition)
behavior_unverified: 1
overrides_applied: 0
human_verification_disposition:
  resolved: 2026-08-23
  resolved_by: user (Jacob)
  outcome: accepted-unverified
  detail: "The human verification item below was NOT performed. The user reviewed it as G1 in 04-UAT.md, was presented with both options (drive the live fold now, or close with the shape logged as unmeasured), and chose to close and revisit only if an event weekend shows strain. This is an accepted known gap, not a passed test — the advanced tick's cpuTime remains unmeasured. Recorded here explicitly so a future reader does not mistake this phase's `passed` status for evidence that every tick shape was measured. Basis for acceptance: `exceededCpu` has never appeared on any trace captured in this phase, including the live folds already performed in plan 04-07 and the quick task, and idle cpuTime measured median 7 ms (n=19) against a 10 ms limit."
human_verification:
  - test: "Drive one live fold through scripts/replayRig.ts for the 'advanced' tick shape (a real Phase A fold plus Phase B's seven sequential R2 read-then-writes) and read cpuTime off the eventsAdvanced:1 trace."
    expected: "cpuTime stays under the 10ms free-tier CPU limit, consistent with idle's measured 5-10ms range."
    why_human: "This requires a real production operation (temporarily pointing the deployed Worker at the fixture Worker via wrangler deploy --var, running a live fold, then restoring tracked config) — not something a static check can safely perform. This is G1 from 04-UAT.md, explicitly accepted by the user as a known-open, non-blocking gap because no exceededCpu outcome has ever been observed on any tick shape measured so far, including live folds already performed in plan 04-07 and the quick task."
---

# Phase 4: Publish & Live Update Pipeline Verification Report

**Phase Goal:** Every page's data exists as a precomputed versioned artifact in production storage and stays fresh during live events inside free-tier limits
**Verified:** 2026-08-23
**Status:** passed — with one truth accepted as unverified rather than measured (see below)
**Re-verification:** No — initial verification

> **Read this before treating `passed` as "everything was measured."** Four of five
> must-haves were verified against the codebase and deployed infrastructure. The fifth —
> the advanced (real fold) tick's `cpuTime` — was **not measured**. It was presented to
> the user as G1 in `04-UAT.md` with both options on the table, and the user chose to
> close the phase and revisit only if a real event weekend shows strain. The gap is open,
> disclosed, and deliberately accepted; it is not evidence of a test that passed.

## Goal Achievement

### Observable Truths

Roadmap Success Criteria (SC-1..SC-4), cross-checked against the orchestrator's UAT record and independently re-checked against the codebase:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: Every page kind exists as a precomputed, versioned artifact in R2, served with no compute in the read path, inside a committed and test-enforced payload budget | ✓ VERIFIED | `pnpm publish:seasons` published 54,671 page objects + 2 manifests across 2022-2026 × opr/epa/sigma1 (`docs/publish-budget.md`). `packages/harness/payloadBudget.test.ts` (read directly, 266 lines) parses the committed budget doc and asserts (a) every page kind is populated, (b) `median <= p95 <= max <= budgetMaxBytes`, (c) the two named at-risk artifacts (teams table, 292-match team page) stay under hard absolute ceilings independent of the committed doc, and (d) a *fresh* re-build of a real event/team artifact via `publish.ts`'s own `buildEventArtifact`/`buildTeamSeasonArtifact` stays inside budget — a genuine regression guard, not a decorative existence check. Ran this suite: 67/67 tests passed, including this file. Reads confirmed served from `https://sigmascout.org` with `Cache-Control: public, max-age=60` + ETag + 304 on conditional re-request (orchestrator UAT, Test 1). |
| 2 | SC-2: A new match result reaches published artifacts within ~1-3 minutes via the incremental path, for the algorithm the site displays live | ✓ VERIFIED (sigma1 scope — see requirements coverage note) | Replay rig against the deployed Worker, real historical event `2026cmptx`, real cron trigger: median 58,866ms / p95 60,875ms / max 60,875ms — inside the 180,000ms target (orchestrator UAT, Test 2, and independently confirmed in `docs/worker-operations.md`'s "Live folding tier" section: 49,586ms/60,083ms for the post-fix sigma1-only run). Prediction-stream digest matched offline for opr on the deployed Worker and for all three published algorithms in the fast CI equivalence test (`apps/worker/test/scheduled.replay.test.ts`, 67-test run above includes it, passing). |
| 3 | SC-3: Measured Worker `cpuTime` per cron invocation stays under the 10ms free-tier CPU limit | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED for the "advanced" (real fold) tick shape; ✓ VERIFIED for idle | Idle-tick `cpuTime`: median 7ms, range 5-10ms, one 14ms cold start, n=19 across two independent samples, zero `exceededCpu` outcomes (`docs/publish-budget.md`, orchestrator UAT Test 3). The "advanced" shape (a real fold: Phase A fold + Phase B's seven sequential R2 read-then-writes) — the only shape that does the expensive work — has never had a trustworthy `cpuTime` reading; its earlier "35 ms" figure was withdrawn as unattributable (matches neither `cpuTime`, `wallTime`, nor `durationMs` from the same traces). This is G1 in `04-UAT.md`, explicitly accepted by the user as non-blocking given no `exceededCpu` has ever appeared on any measured shape. Routed to human verification below per the ⚠️ PRESENT_BEHAVIOR_UNVERIFIED protocol rather than marked VERIFIED on reasoning alone. |
| 4 | SC-4: Write volume and TBA request counts stay inside free-tier quotas and are documented | ✓ VERIFIED (with one recorded measurement gap) | TBA: 0 requests idle, 1-2 per live tick, existing client's spacing/ETag/counter reused unchanged (D-22, confirmed in `apps/worker/src/tbaPoll.ts` which imports `packages/ingest/tbaClient.ts` wholesale). R2: ~54,671 Class-A ops per full publish against a 1,000,000/month allowance (≈5.47%). KV: 0 writes measured directly (a genuine, disclosed minor gap — the KV-primary/R2-fallback design is real but every observed read fell through to R2). A full live event-day extrapolation was not performed — recorded as unmeasured rather than estimated, consistent with the project's own "never fabricate a number" discipline. |
| 5 | DATA-04's published-vs-folded-live distinction: all three shipped algorithms (opr, epa, sigma1) remain fully PUBLISHED even though only sigma1 folds live | ✓ VERIFIED | `packages/harness/manifestSchemas.ts:75`: `PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "sigma1"] as const`, with `HARNESS_ONLY_ALGORITHM_IDS` (the four Phase-2/3 link-mode experiments) mechanically rejected by the manifest schema (tested in `manifests.test.ts`, "D-03 harness-only rejection", verified passing). `apps/worker/wrangler.toml:53`: `LIVE_ALGORITHM_IDS = "sigma1"` — a wholly separate, independently-controllable knob (`apps/worker/src/scheduled.ts`'s `parseLiveAlgorithmIds`/`DEFAULT_LIVE_ALGORITHM_IDS`/`UnknownLiveAlgorithmIdError`) that narrows only per-tick real-time folding, never the published set. `packages/harness/publish.ts`, `packages/harness/manifests.ts`, and `packages/core/` are confirmed untouched by the quick task that introduced this narrowing (`git diff --stat`, recorded in the quick-task SUMMARY). Post-narrowing, a real re-baseline plus R2 read-back confirmed `opr`/`epa`/`sigma1` event artifacts for `2026cmptx` are all still retrievable. |

**Score:** 4/5 truths verified (1 present + wired, behavior not exercised — SC-3's "advanced" tick shape)

### Required Artifacts

All must-have artifacts across the phase's 8 plans exist, are substantive (checked line counts and content, not just presence), and are wired (imports/exports confirmed against the plan's declared `exports` lists via grep and direct reads):

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/algorithms/leakProof.ts` | Worker-importable leak-proof upcoming-match Proxy | ✓ VERIFIED | 82 lines; exports `toLeakProofUpcoming`, `OUTCOME_KEYS`; mechanically kept Worker-importable by `packages/core/isomorphic.test.ts`, which scans every non-test file under `packages/core` (leakProof.ts included) for forbidden Node-only import specifiers |
| `packages/harness/pageArtifacts.ts` | All five page-artifact Zod schemas + D-02 key builder | ✓ VERIFIED | 444 lines; used by `payloadBudget.test.ts`, `publish.ts`, `artifactWriter.ts` |
| `packages/harness/rounding.ts` | D-06 per-field rounding + pmf renormalization | ✓ VERIFIED | 171 lines |
| `packages/corpus/db.ts` | `selectScheduledMatches` for leak-proof scheduled-match reads | ✓ VERIFIED | 609 lines |
| `packages/harness/manifests.ts` / `manifestSchemas.ts` | D-18 live-windows manifest, D-03 algorithms manifest | ✓ VERIFIED | 217 / 134 lines; `PUBLISHED_ALGORITHM_IDS`, `HARNESS_ONLY_ALGORITHM_IDS` confirmed present and enforced |
| `packages/harness/stateSnapshot.ts` | Serialize/deserialize live state, D1 seed emitter, D-13 reshape (plan 04-08) | ✓ VERIFIED | 633 lines; `MAX_LEAGUE_ROW_BYTES` present; round-trip losslessness tested |
| `apps/worker/migrations/0001_algorithm_state.sql` | D1 schema for live algorithm state | ✓ VERIFIED | 69 lines; `CREATE TABLE IF NOT EXISTS algorithm_state` present |
| `packages/harness/publish.ts` | Full-season publish orchestration | ✓ VERIFIED | 1,211 lines; produced the real 54,671-object publish run |
| `packages/harness/payloadBudget.test.ts` | D-05 failing-test payload guard | ✓ VERIFIED | 266 lines; read directly and confirmed it parses `docs/publish-budget.md`'s machine-readable block, asserts absolute ceilings independent of the committed numbers, and re-builds real artifacts fresh — genuinely fails on an oversized artifact, not merely present |
| `apps/worker/wrangler.toml` | Every-minute cron trigger, D1/R2/KV bindings, `LIVE_ALGORITHM_IDS` | ✓ VERIFIED | 102 lines; `[triggers]` present, `LIVE_ALGORITHM_IDS = "sigma1"` present |
| `apps/worker/src/stateStore.ts` | Batched D1 reads/writes, per-event cursor | ✓ VERIFIED | 303 lines; includes the quick-task's `readScopedState` SQL-precedence fix, itself covered by a real-SQLite-engine regression test (`readScopedStateSql.test.ts`) |
| `apps/worker/src/subrequestBudget.ts` | In-tick subrequest accounting, rotation | ✓ VERIFIED | 146 lines |
| `apps/worker/src/liveWindows.ts`, `tbaPoll.ts`, `artifactWriter.ts`, `scheduled.ts` | Live-tick orchestration | ✓ VERIFIED | 110 / 70 / 104 / 1,085 lines; `scheduled.ts` confirmed importing `PUBLISHED_ALGORITHM_IDS` and implementing the sigma1-only live tier |
| `scripts/replayRig.ts` | Freshness + equivalence proof rig | ✓ VERIFIED | 823 lines; produced the real deployed-Worker freshness measurements cited above |
| `docs/worker-operations.md` | D-27 deploy/secret/migration/rollback runbook | ✓ VERIFIED | 314 lines; read directly — contains deploy, secrets, migrations, re-baseline, live-folding-tier, watching, troubleshooting, and rollback sections, each with real commands |
| `docs/publish-budget.md` | D-23 committed budget doc | ✓ VERIFIED | Read directly — every figure cited above names its run, date, and command; includes the honestly-reported negative finding from plan 04-07 (three-algorithm live folding deferring forever) and its resolution by the quick task |

No stubs, no missing artifacts, no orphaned artifacts found among the phase's declared must-haves.

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/harness/pageArtifacts.ts` | `packages/harness/rounding.ts` | numeric fields pass through rounding helpers | ✓ WIRED | `roundTo`/`roundMetric`/`roundProbability`/`roundPmf` used in artifact construction |
| `apps/worker/src/tbaPoll.ts` | `packages/ingest/tbaClient.ts` | imports `fetchEventMatches`, `TbaRequestCounter`, throttle unchanged | ✓ WIRED | Confirmed by grep; one politeness policy, not two (D-22) |
| `apps/worker/src/artifactWriter.ts` | `packages/harness/pageArtifacts.ts` | validates against the same schemas the offline publisher uses | ✓ WIRED | Same `ArtifactSchema`/`artifactKey` imports on both sides |
| `apps/worker/src/stateStore.ts` | `apps/worker/migrations/0001_algorithm_state.sql` | column names match exactly | ✓ WIRED | Confirmed by the quick task's read-back query against remote D1 (all three algorithms' rows readable post-reshape) |
| `apps/worker/src/scheduled.ts` | `packages/harness/manifestSchemas.ts` | resolves the promoted Sigma1 version and the published/live algorithm sets from manifests, never re-derives | ✓ WIRED | `import { PUBLISHED_ALGORITHM_IDS, ... } from "../../../packages/harness/manifestSchemas.js"` confirmed at `scheduled.ts:87` |
| `scripts/replayRig.ts` | `packages/harness/replay.ts` | offline comparison half reuses `WalkForwardSimulator` | ✓ WIRED | Confirmed producing matching digests against the deployed Worker |
| `packages/harness/payloadBudget.test.ts` | `docs/publish-budget.md` | parses the embedded machine-readable budget block | ✓ WIRED | Confirmed: `BUDGET_DOC_PATH`/`BUDGET_BLOCK_PATTERN` read this exact file; test suite ran green |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Payload budget test suite genuinely enforces bounds (not just present) | `pnpm vitest run packages/harness/payloadBudget.test.ts ...` | 67/67 tests passed across 6 files (payloadBudget, manifests, stateSnapshot, liveAlgorithmTier, readScopedStateSql, scheduled.replay) | ✓ PASS |
| Manifest schema rejects harness-only algorithm ids | Read `manifests.test.ts` "D-03 harness-only rejection" describe block | Present and passing in the same run above | ✓ PASS |
| `packages/core` (including `leakProof.ts`) stays Worker-importable | Read `packages/core/isomorphic.test.ts` | Scans every non-test file under `packages/core` for forbidden Node-only specifiers; part of the standard `pnpm test` suite | ✓ PASS (existence + mechanism confirmed by reading; not independently re-run beyond the suite pass above) |
| Debt-marker scan on phase-04 key files | `grep -rnE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across `pageArtifacts.ts`, `rounding.ts`, `publish.ts`, `manifests.ts`, `manifestSchemas.ts`, `stateSnapshot.ts`, `apps/worker/src/*.ts`, `replayRig.ts` | Zero matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| DATA-03 | 04-01, 04-02, 04-04 | Full-season precompute runs offline and publishes compact, versioned artifacts the site reads — no server/client recomputation per request | ✓ SATISFIED | 54,671 real objects published; `payloadBudget.test.ts` genuinely enforces the budget; reads confirmed served with no compute in path (R2 custom domain) |
| DATA-04 | 04-03, 04-05, 04-06, 04-07, quick-260822-wqt | During active events, new match results reflected on site within ~1-3 minutes via an incremental path | ✓ SATISFIED — **with a recorded, disclosed scope note** | See "DATA-04 scope note" below. The freshness target is genuinely met (median 58.9s, well inside 180s) for the algorithm the deployed Worker actually folds live (sigma1). Plan 04-07's own SUMMARY recorded a negative finding — that no algorithm's live folding worked when all three published algorithms were folded simultaneously (subrequest budget exceeded, event deferred forever) — and the quick task `260822-wqt` closed that gap by narrowing live folding to sigma1 alone, not by fixing the underlying per-algorithm cost. `opr`/`epa` remain fully published but refresh only at the manual re-baseline, not on the cron, during a live event. This is a genuine, measured, user-approved scope narrowing from the phase's original plan-time intent (04-06's must-have literally read "the Worker advances only the three algorithms the published manifest names") and should be recorded against DATA-04's traceability entry as "satisfied for the live-displayed algorithm; opr/epa live-refresh deferred" rather than a clean, unqualified pass — see verdict note below |
| DATA-05 | 04-01, 04-03, 04-05, 04-06, 04-07, 04-08 | All compute/storage fits Cloudflare free tiers; TBA rate limits respected | ✓ SATISFIED | Idle CPU measured well inside budget (7ms median, n=19); subrequest cap enforced in code before the platform enforces it (`subrequestBudget.ts`); TBA polling reuses existing throttle/ETag/counter; R2 write volume ~5.5% of monthly allowance for a full publish. One measured gap disclosed, not a blocker: the "advanced" real-fold tick's CPU was never measured (G1) — routed to human verification above |

No orphaned requirement IDs found: REQUIREMENTS.md maps exactly DATA-03/DATA-04/DATA-05 to Phase 4, and every plan's `requirements:` frontmatter field collectively covers exactly those three IDs with no additions.

### DATA-04 scope note (verifier judgment, per the task's explicit ask)

The phase's original plan-time design (04-06's must-haves) intended all three published algorithms to fold live on the cron path. Real measurement (plan 04-07) found this structurally infeasible under the free-tier subrequest cap — a single ordinary 3v3 match across all three algorithms costs 50 subrequests against ~41 usable, so the event deferred every tick, forever, for as long as all three were live simultaneously. This was reported as a genuinely negative finding, not softened (`04-07-SUMMARY.md`'s own frontmatter comment: "the measured evidence itself is a NEGATIVE finding for DATA-04... Recorded honestly rather than declared closed on a technicality").

The quick task `260822-wqt` then narrowed live folding to sigma1 alone (measured cost 18 vs. 50, comfortably under budget), which does make DATA-04's literal text — "new match results are reflected on the site within ~1-3 minutes via an incremental update path" — true again, and it is genuinely, repeatedly measured true (median 58.9s). The requirement text does not say "for every published algorithm." But the site publishes and presumably still displays opr/epa metrics, which will visibly lag behind sigma1's live-updated numbers during an event, refreshing only at the next manual re-baseline (which is itself a manual, human-triggered operation per D-12/D-24's resolution — could be days).

This verifier's judgment: DATA-04 is honestly SATISFIED as literally worded (the site does reflect new results within the target window, for the algorithm it folds live), but this is a real, material scope reduction from what the phase originally set out to build, and it should be recorded explicitly in REQUIREMENTS.md's traceability (or a linked note) rather than checked off as an unqualified pass — exactly the "don't pass this silently" instruction this task was given. This is not a gap that blocks phase completion (it is disclosed everywhere: `docs/worker-operations.md`'s troubleshooting table has a dedicated row for it, `docs/publish-budget.md` has a full section, and the quick task's own SUMMARY names it explicitly), but it is a fact a future reader of REQUIREMENTS.md would not learn from a bare `[x]` checkbox.

### Anti-Patterns Found

None. Debt-marker scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) across all phase-04 key files returned zero matches.

### Human Verification Required

### 1. The "advanced" (real fold) tick's CPU time against the 10ms free-tier limit

**Test:** Drive one live fold through `scripts/replayRig.ts` (temporarily pointing the deployed Worker at the fixture Worker via `wrangler deploy --var TBA_BASE_URL:...`, per `docs/worker-operations.md`'s replay-rig procedure) and read `cpuTime` off the resulting `eventsAdvanced:1` trace via `wrangler tail --format json`.
**Expected:** `cpuTime` stays under the 10ms free-tier CPU limit — consistent with the idle path's measured 5-10ms range, since the fold itself is mostly awaited I/O (a sigma1 fold plus seven R2 round-trips), which typically does not accrue CPU time.
**Why human:** This requires a real, temporary production configuration change (redeploying against a fixture, running a live fold, then restoring tracked config) that cannot be safely or meaningfully simulated by a static check. This is `04-UAT.md`'s own G1, already explicitly accepted by the user as non-blocking — no `exceededCpu` outcome has ever been observed on any tick shape measured in this phase, including the live folds already performed in plan 04-07 and the quick task — but it remains the one behavior-dependent truth in this phase's success criteria that no test currently exercises.

### Gaps Summary

No blocking gaps. One behavior-dependent truth (SC-3's "advanced" tick CPU) is present-and-wired but not behaviorally measured, and is routed to human verification per protocol rather than marked VERIFIED on reasoning alone — this mirrors the phase's own explicit, already-accepted G1 gap, not a new finding. One requirement (DATA-04) is satisfied as literally worded but carries a real, disclosed scope narrowing (only sigma1 folds live; opr/epa refresh at manual re-baseline) that should be reflected in REQUIREMENTS.md's traceability note rather than left implicit in a bare checkbox — a documentation/traceability recommendation, not a code gap.

All three published algorithms (opr, epa, sigma1) were independently confirmed still fully published (manifest schema, R2 read-back post-narrowing) — the published-vs-folded-live distinction holds exactly as claimed. The payload budget test was independently confirmed to be a genuine regression guard (absolute ceilings independent of the committed numbers, plus a fresh artifact rebuild), not merely a presence check. All requirement IDs across the phase's 8 plans reconcile cleanly against REQUIREMENTS.md with no orphans.

---

_Verified: 2026-08-23_
_Verifier: Claude (gsd-verifier)_
