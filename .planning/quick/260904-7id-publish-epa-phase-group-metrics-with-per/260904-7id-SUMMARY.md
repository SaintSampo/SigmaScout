---
phase: quick-260904-7id
plan: "01"
subsystem: pipeline
tags: [epa, phase-groups, percentiles, rarity-tiers, publish, held-republish]
status: complete
dependency-graph:
  requires:
    - packages/core/algorithms/breakdown/groups.ts (COMPONENT_GROUP_IDS/COMPONENT_GROUP_METRIC_KEYS/componentGroupsForSeason/componentsInGroup — the single grouping source)
    - packages/core/algorithms/sigma1/index.ts's own group block (structural precedent this task mirrors, minus the spread lookup)
    - quick task 260904-5zg's withDerivedGroupMetrics (apps/web/src/lib/metricGroups.ts) — narrowed to a stale-artifact fallback by this task
  provides:
    - "epa.teamMetrics() publishes phaseAuto/phaseTeleop/phaseEndgame, value-only, summed from componentsInGroup"
    - "publishesGroupMetrics('epa') === true"
    - "A metricGroups <-> epa.teamMetrics parity test proving derived-vs-published agreement by construction"
  affects:
    - "packages/harness/pageArtifacts.ts's PositionalMetricEntrySchema doc comment (OPR/EPA no-longer-always-length-1 correction)"
    - "The next production republish (deferred — see 260904-7id-deferred-items.md)"
tech-stack:
  added: []
  patterns:
    - "Mirror an existing sibling algorithm's structure (sigma1/index.ts's group block) rather than inventing a parallel shape, minus only the fields that genuinely don't apply (spread, since EPA carries none)."
    - "A predicate's narrowed role documented in place rather than deleted: withDerivedGroupMetrics's tests/comments were retitled to 'stale-artifact fallback' instead of removed, since the code path itself still runs for a cached pre-republish browser."
key-files:
  created: []
  modified:
    - packages/core/algorithms/epa.ts (absorbed into a concurrent session's commit f0c7af48 — see Deviations)
    - packages/core/algorithms/epa.test.ts
    - packages/harness/pageArtifacts.ts
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/lib/metricKeys.test.ts
    - apps/web/src/lib/metricGroups.ts
    - apps/web/src/lib/metricGroups.test.ts
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx
    - apps/web/src/components/event/InsightsTab.test.tsx
decisions:
  - "D-1/D-2: EPA's teamMetrics() publishes phaseAuto/phaseTeleop/phaseEndgame as value-only entries; EPA's version stays 5.0.0+baseline (not bumped) — team metrics never feed the prediction-stream digest, proven by baselineFingerprint.test.ts staying bitwise unchanged."
  - "D-3: publishesGroupMetrics('epa') flipped to true; withDerivedGroupMetrics survives narrowed to the stale-artifact fallback for a browser holding a cached pre-republish EPA artifact, never invents a tier client-side."
  - "Task 3 (D-4/D-5) executed in its MODIFIED, local-only form: the user held the production republish. No publish, no Worker deploy, no .env use anywhere in this task. A local, credential-free preview (r2Client mocked, real publishSeasons pipeline, real corpus) proved the mechanism end-to-end and produced two screenshots; see 260904-7id-deferred-items.md for the parked production ship checklist."
  - "The checkpoint's original stated reason (‘5px is unfinished’) is now STALE — 260904-5px fully landed (all 3 tasks) DURING this quick task's execution window, before Task 3 even started. The user's HOLD instruction was honored anyway, since it was explicit and unconditional, not conditional on 5px's status. Recorded explicitly in the deferred-items file so a future reader does not re-derive a stale blocking reason from the plan text alone."
metrics:
  duration: "~1.5 hours, across a session-limit interruption and reconciliation against concurrent-session drift (5px's f0c7af48 absorbed this task's uncommitted epa.ts edits into its own commit mid-run)"
  completed: 2026-09-04
actuals:
  tokens: 8300
  tasks: 2
  commits: 2
---

# Quick Task 260904-7id: Publish EPA Phase-Group Metrics With Percentile Tiers Summary

EPA's Auto/Teleop/Endgame now carry rarity-tier highlights everywhere they render — but
**nothing is live yet**: the user held the production republish, so this ships as committed,
tested, LOCAL-branch code only. Live EPA artifacts still carry no group entries at all
(`epa@2.0.0+baseline`, checked read-only at execution time).

## What Was Built

**Task 1 (D-1, D-2):** `epa.ts`'s `teamMetrics()` publishes `phaseAuto`/`phaseTeleop`/
`phaseEndgame`, summed from `componentsInGroup` over each team's present components,
mirroring `sigma1/index.ts`'s own group block minus its spread lookup (EPA carries a mean
only, everywhere). EPA's version stays `5.0.0+baseline` — never bumped for this, since team
metrics do not feed the prediction-stream digest (the same precedent `06f468ad` set for
Sigma1's identical addition). Five new tests in `epa.test.ts` pin: group values reconcile
against `componentsInGroup` (never a hand-typed number); a group entry carries `value` and
nothing else; an all-absent group publishes no entry; a `season: null` state publishes no
group entries without throwing; and `phaseAuto + phaseTeleop + phaseEndgame + adjust`
equals `total` exactly (EPA-specific — `adjust` is pinned at 0, `total` already excludes
`foulsCommitted` — NOT a general property; VPR's total still spans every component).
`pageArtifacts.ts`'s doc comment corrected: OPR and MOST EPA rows are length-1, but EPA's
three group metrics now occupy the three-element tiered form.

**Task 2 (D-3):** `metricKeys.ts`'s `publishesGroupMetrics("epa")` flipped to `true`.
`metricGroups.ts`'s module header rewritten: EPA's groups are now published with a
season-wide percentile/tier from the same publish-time pass every other metric goes
through; `withDerivedGroupMetrics` survives as the STALE-ARTIFACT fallback (a browser
holding a cached pre-republish EPA artifact), never fabricating a tier client-side because
the client has no season-wide pool to rank against. New coverage: `SeasonHeader` renders a
tiered, no-spread EPA Teleop tile from a published percentile; `InsightsTab` renders a
tiered EPA Endgame cell from a published `{ value, percentile }`; a new
`metricGroups <-> epa.teamMetrics` parity test proves `withDerivedGroupMetrics`'s value and
`epa.teamMetrics`'s published value agree for the same component set, both computed from
`packages/core`, never two hand-typed numbers — the property that makes "identical by
construction" checkable rather than asserted. All retained 260904-5zg tests were retitled
to name the stale-artifact framing explicitly rather than reading as a permanent EPA
property.

**Task 3, MODIFIED (D-4/D-5 held, local proof substituted):** The plan's blocking checkpoint
(republish now vs. hold for 5px) was pre-answered: **HOLD.** No publish, no Worker deploy,
no `.env` use anywhere in this task's execution. Instead:

1. A throwaway vitest file mocked `r2Client.js` exactly the way `publish.test.ts` already
   does, ran the REAL `publishSeasons` pipeline (season 2026, EPA only) against the real
   local corpus, and wrote every captured `putObject` call to a local directory outside the
   repo — 3,976 real artifact objects including a real `v1/manifest/algorithms.json`
   (`epa@5.0.0+baseline`, read straight from the module, never hand-typed).
2. A throwaway static file server (CORS-enabled) served that directory on a fixed port.
3. `vite` ran on a second fixed high port with `VITE_ARTIFACT_ORIGIN` pointed at the static
   server — verified by page content (`<title>SigmaScout</title>`), never status code alone.
4. Playwright navigated to `/teams?year=2026&algorithm=epa` and `/team/88?year=2026&algorithm=epa`,
   confirmed real `.metric-tier--*` boxes rendered (100 tiered cells on the Teams grouped
   view; 36 on the team page), and saved two screenshots to this task's `shots/`.
5. Every throwaway script was deleted before commit (the 260904-5zg precedent); only the
   two PNGs remain, uncommitted, for the orchestrator.

Full parked ship checklist (pre-flight, the republish command, verification, Worker
redeploy, budget transcription, todo update) recorded in
`260904-7id-deferred-items.md`, including the honest note that the checklist's original
"blocked on 5px" reasoning is now stale — 5px fully landed mid-task, but the user's HOLD
was unconditional and is honored regardless.

## Deviations from Plan

### 1. [Cross-session absorption, not a code defect] `epa.ts`'s Task 1 implementation was
committed by a CONCURRENT session, not this one.

- **What happened:** This session was cut off mid-run by a harness session-limit reset
  after having made the `epa.ts` edits (imports, doc comment, `teamMetrics()`'s group
  block) but before committing them. During the gap, a concurrent session (quick task
  260904-5px, adopting Statbotics' elimination discount) committed its own changes to the
  same file and, in doing so, swept up this task's uncommitted working-tree edits into ITS
  commit (`f0c7af48`, verified: `git show f0c7af48 -- packages/core/algorithms/epa.ts`
  contains this task's group block verbatim, including its "260904-7id" doc-comment
  citations).
- **Resolution:** Per the coordinator's explicit instruction, `f0c7af48` was left
  untouched (it is legitimately 5px's commit; reverting or amending it would destroy 5px's
  own work). This session verified piece-by-piece which parts of Task 1 existed on current
  HEAD (the full `epa.ts` implementation — present) and which were still missing (the
  `epa.test.ts` coverage and the `pageArtifacts.ts` doc-comment correction — both still
  only in the uncommitted working tree), then committed only the missing pieces under this
  task's own commit (`c96241df`).
- **Verification the absorbed code is correct and unmoved by 5px's concurrent changes:**
  `baselineFingerprint.test.ts`, `replay*.test.ts`, and `seasonParamSets.test.ts` all green
  on current HEAD — proving D-2's "no version bump needed" premise still holds even after
  5px's elimination-discount change landed in the same function this task also touches.
- **Files/commits:** `packages/core/algorithms/epa.test.ts`, `packages/harness/pageArtifacts.ts`,
  commit `c96241df`.

### 2. [Environmental] EPA's version at plan time (`4.0.0+baseline`) had already moved to
`5.0.0+baseline` by execution time.

- **Cause:** Quick task 260904-5px's Task 2 (elimination discount) landed between this
  plan's writing and its execution, bumping EPA's version.
- **Resolution:** No test in this task pins EPA's version as a literal — the new
  `epa.test.ts` coverage uses synthetic `EpaState` fixtures and asserts against
  `componentsInGroup`-computed values, not corpus-derived constants, so it is unaffected by
  which version string EPA currently carries. Verified: all new and existing tests green
  against current HEAD (`epa@5.0.0+baseline`).

### 3. [Coordinator decision, per plan's own pre-answered checkpoint] Task 3 executed in its
modified, local-only form — see "What Was Built" above and `260904-7id-deferred-items.md`
for the full parked-item record. Not a deviation from instructions, but recorded here
because it is the reason `docs/publish-budget.md`, the pending republish todo, and
production itself are all UNCHANGED by this task.

No other deviations.

## Known Stubs

None — this task adds no placeholder data. The published group metrics are real,
pipeline-computed values; they are simply not yet reachable by a live visitor because the
republish that would ship them is deliberately held (see Deviations #3).

## Threat Flags

None beyond what the plan's own threat model already covered — this task introduced no new
network endpoint, auth path, or trust-boundary change. The one credential-adjacent surface
(Task 3's original plan called for `.env`-gated production access) was never exercised: the
modified Task 3 used a mocked `r2Client.js` and touched no credentials at all.

## Self-Check: PASSED

- `packages/core/algorithms/epa.ts` carries the phase-group `teamMetrics()` block and
  `version: "5.0.0+baseline"` — verified via grep against current HEAD.
- `packages/core/algorithms/epa.test.ts` carries the five new phase-group tests — verified
  via grep.
- `apps/web/src/lib/metricKeys.ts`'s `publishesGroupMetrics` returns `true` for `"epa"` —
  verified via grep and by the passing `metricKeys.test.ts` assertion.
- Both commits (`c96241df`, `ad3e0a12`) verified present in `git log --oneline`.
- Both screenshots (`shots/teams-grouped-epa.png`, `shots/team-88-phase-tiles.png`) verified
  present on disk.
- `npx vitest run packages/core/algorithms/epa.test.ts packages/core/algorithms/breakdown/groups.test.ts packages/core/isomorphic.test.ts packages/harness/publish.test.ts packages/harness/percentiles.test.ts packages/harness/pageArtifacts.test.ts` — 320/320 passed.
- `npx vitest run packages/harness/seasonParamSets.test.ts packages/harness/baselineFingerprint.test.ts packages/harness/replay.test.ts packages/harness/replay.multiAlgorithm.test.ts packages/harness/replay.season.test.ts` — 82/82 passed (digest-premise proof for D-2).
- `npx vitest run apps/web` (repo root and `apps/web`-local scopes, both 79 files) — 1240/1240 passed.
- `npx tsc --noEmit` — clean, both before and after Task 2.
- Live production manifest read-only-checked at execution time: `generation
  4ba99e89-b196-4f88-90c7-3bc1ffae3de9`, `epa@2.0.0+baseline` — confirms nothing this task
  built has reached production.
