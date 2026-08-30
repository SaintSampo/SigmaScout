---
phase: 07-event-pages
reviewed: 2026-08-29T00:00:00Z
depth: standard
files_reviewed: 60
files_reviewed_list:
  - packages/core/algorithms/demoTeams.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/opr.ts
  - packages/core/algorithms/types.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/adaptation.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/rp/state.ts
  - packages/harness/publish.ts
  - packages/harness/manifests.ts
  - packages/harness/manifestSchemas.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/percentiles.ts
  - packages/harness/rounding.ts
  - packages/harness/promote.ts
  - packages/harness/stateSnapshot.ts
  - packages/harness/publishedAlgorithms.ts
  - packages/harness/cli.ts
  - packages/ingest/normalize.ts
  - packages/ingest/schemas.ts
  - packages/ingest/rankings.ts
  - packages/ingest/alliances.ts
  - packages/ingest/tbaClient.ts
  - packages/ingest/cli.ts
  - packages/corpus/db.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/liveWindows.ts
  - apps/worker/src/stateStore.ts
  - apps/worker/src/env.ts
  - scripts/deleteOrphanedDemoTeamObjects.ts
  - scripts/deleteRetiredAlgorithmObjects.ts
  - scripts/publishAlgorithmsManifest.ts
  - scripts/verifySubsetPublish.ts
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/BreakdownTab.tsx
  - apps/web/src/components/event/ElimsTab.tsx
  - apps/web/src/components/event/EventHeader.tsx
  - apps/web/src/components/event/EventMatchTable.tsx
  - apps/web/src/components/event/InsightsTab.tsx
  - apps/web/src/components/event/QualsTab.tsx
  - apps/web/src/components/event/eventMatchAxis.ts
  - apps/web/src/components/events-list/EventsList.tsx
  - apps/web/src/components/ribbon/AlgorithmSelect.tsx
  - apps/web/src/components/ribbon/YearSelect.tsx
  - apps/web/src/components/search/SearchBox.tsx
  - apps/web/src/components/team/MatchTable.tsx
  - apps/web/src/components/teams-table/columns.tsx
  - apps/web/src/components/team/matchAxis.ts
  - apps/web/src/lib/eventKey.ts
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/bonusRp.ts
  - apps/web/src/lib/metricGroups.ts
  - apps/web/src/lib/metricKeys.ts
  - apps/web/src/lib/query-client.ts
  - apps/web/src/lib/api/event.ts
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/routes/events.tsx
  - apps/web/playwright.config.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-08-29
**Depth:** standard
**Files Reviewed:** 60
**Status:** issues_found

## Summary

This phase's pipeline-heavy core — the D-01/D-02/D-03 `√(P+R)` spread
redefinition, the OPR repeated-column accumulation fix, the demo-team
remap/exclusion machinery, the D-18 event-artifact publish additions, the
D-18.6 rankings widening, and the D-18.7 alliances ingest — is unusually
well-proven: every numerically load-bearing function carries an inline
argument for why it is correct, cross-references the test that pins it, and
names the specific real-corpus measurement that motivated it. I traced the
`P + R` construction from `sigma1/index.ts`'s `teamMetrics`/`predict` through
`consistency.ts`/`covariance.ts` and the publish boundary in `publish.ts`/
`pageArtifacts.ts`, and it is internally consistent: the additivity identity
(`redScoreVarianceOwn` = sum of squared per-team `spread`s) holds by
construction, not by luck. The `liveWindows.ts`/`manifests.ts` fix for the
2026-08-29 Worker CPU outage is sound and well-guarded (hard failure on a
non-finite bound, never a silent skip of a live-relevant entry). The
demo-team exclusion in `opr.ts`/`epa.ts`/`sigma1/index.ts` correctly
accumulates (not overwrites) repeated pseudo-team columns and correctly
skips a fully-demo alliance as a whole-match no-op.

Two real gaps surfaced during this review, both in the **destructive-script**
and **manifest-write** tooling this phase's scope explicitly flags as
high-risk: one script's default CLI behavior deletes production R2 objects
without requiring an explicit "yes, do it" flag (unlike its sibling script in
the same phase, which does), and a second script overwrites the single
shared, Worker-and-browser-critical algorithms manifest with no read-back
verification. A third finding is a real (if explicitly documented) surface
leak: off-season demo teams can still appear as rows on the Insights/
Breakdown tabs of real events, which sits uneasily against the accepted
todo's own stated goal of excluding them from "every published surface."

## Critical Issues

### CR-01: `deleteRetiredAlgorithmObjects.ts` deletes production R2 objects by default — no explicit "execute" flag required

**File:** `scripts/deleteRetiredAlgorithmObjects.ts:386-434, 452-504`
**Issue:** `parseCliOptions` only recognizes `--dry-run`/`--census-only` as
opt-OUT flags; there is no opt-IN flag equivalent to `--execute`. `runDeletePass`
runs `deleteKeys` — a real, bounded-concurrency delete pass over every
enumerated key (RESEARCH.md's own estimate: ~19,261 objects) — whenever
`dryRun` and `censusOnly` are both false, which is the **default** state of a
freshly-parsed CLI invocation:

```ts
if (options.dryRun || options.censusOnly) {
  // ...census only, return
}
await deleteKeys(options.bucket, keys, options.concurrency, "reports/publish/07-19-delete.log");
```

This is the *opposite* safety convention from this phase's own sibling
script, `scripts/deleteOrphanedDemoTeamObjects.ts`, whose own header states
the design principle explicitly: *"a dry-run-by-default CLI (`--execute` is
required to actually delete anything — the destructive target here has no
operator-supplied name to force explicit intent through, unlike
`--retired-id`, so the intent gate is this flag instead)."* That comment's
own parenthetical acknowledges `--retired-id` as *a* form of intent-forcing,
but `--retired-id`/`--version` only gate *which* keys are targeted, not
*whether* the destructive action runs at all — an operator who runs
`pnpm cleanup:retired-objects --retired-id sigma1 --version 2.0.0+tuned-2026-08`
to get a first look at the enumerated count (a completely reasonable thing to
try first, since `--dry-run` is easy to forget when it isn't the default)
deletes ~19,261 objects on that first invocation. Per D-06's own
reversibility note, a wrong delete here is one-way: "deleted objects are
gone; recovery means a third republish."

The `RefusedLiveAlgorithmIdError`/`EnumerationOutOfBoundsError` guards this
file already has are real and valuable, but they guard *scope* (which keys,
how many), not *intent* (whether to delete at all) — they do not close this
gap.

**Fix:** Add an explicit, no-default opt-in flag (`--execute`, matching the
sibling script's own convention) and require it before `deleteKeys` runs,
independent of whether `--dry-run` was passed:

```ts
if (!options.execute || options.dryRun || options.censusOnly) {
  // census-only path, print "pass --execute to actually delete"
  return;
}
await deleteKeys(...);
```

## Warnings

### WR-01: `publishAlgorithmsManifest.ts` writes the shared, Worker-critical manifest with no post-write read-back verification

**File:** `scripts/publishAlgorithmsManifest.ts:216-245`
**Issue:** `run()` composes the manifest and, unless `--dry-run` is passed
(here too, `dryRun` defaults to `false`, i.e. `run()` publishes by default),
calls `putObject` once and returns — there is no fetch-back-and-compare step
verifying the object actually landed as composed. This is the *single*
`v1/manifest/algorithms.json` object every Worker cron tick reads to decide
which algorithms to fold live (`apps/worker/src/liveWindows.ts`'s
`loadAlgorithmsManifest`) and every browser reads to populate the algorithm
dropdown and resolve artifact versions — a bad write here (a stale KV
propagation racing the R2 write, a truncated body, a transient 5xx treated
as success) degrades the *whole site* silently, not just one page. Contrast
this with `deleteOrphanedDemoTeamObjects.ts` and `deleteRetiredAlgorithmObjects.ts`'s
`runProbe`, both of which fetch fresh after every mutating call and hard-fail
if the read-back disagrees with what was intended.
**Fix:** After `putObject` succeeds, `fetch` the object back through the
public origin (cache-busted, matching this file's own `fetchLiveManifest`
helper) and assert the parsed body's `algorithms` array matches `composed.algorithms`
before declaring success.

### WR-02: Off-season demo teams remain visible as rows on the Insights/Breakdown tabs, in tension with the accepted exclusion todo's stated scope

**File:** `packages/harness/publish.ts:1817-1819` (offline), `apps/worker/src/scheduled.ts:728-734, 840-846` (online)
**Issue:** `.planning/todos/completed/exclude-offseason-demo-teams.md`'s
own title and opening line state the teams "must be excluded from both the
model and **every published surface**." `publish.ts`'s `teamsThisSeason`
(feeding `teams/{year}`, search, and the team-detail page) and
`scheduled.ts`'s `realTouchedTeams` (feeding `team/{teamKey}/{year}`) both
correctly filter `isDemoTeamKey`. However, the event artifact's own
`teams[]` array — which is exactly what this phase's new Insights and
Breakdown tabs render as their team list — is built from each event's raw
match roster (`eventTeamKeys` in `publish.ts`, `touchedTeams` in
`scheduled.ts`) and is **not** filtered. Both files carry an explicit,
matching comment stating this is deliberate ("event pages are deliberately
untouched by this exclusion — a demo robot's real historical presence in an
event's own match/alliance record stays visible"), and the client renders
the resulting empty-metrics row gracefully (an em-dash, not a crash — traced
through `InsightsTab.tsx`/`BreakdownTab.tsx`'s `MetricValue` usage). So this
is not a crash risk, and it is not an unconsidered oversight — but it is a
real, user-visible surface (a row literally named "Off-Season Demo Team 4"
in a real regional's Insights standings) that a plain reading of the
accepted todo's own header would say should not exist. This is worth an
explicit developer decision/acknowledgment rather than being settled only by
a code comment, since the todo it traces to was written with a stronger
claim than what shipped.
**Fix:** Either (a) narrow the todo's own acceptance criteria in
`.planning/todos/completed/exclude-offseason-demo-teams.md` to state the
event-page carve-out explicitly (so a future reader doesn't rediscover this
gap and treat it as a regression), or (b) filter `isDemoTeamKey` out of the
event artifact's own `teams[]` build site in both files, consistent with the
team/teams-list/search treatment.

## Info

### IN-01: Sigma1 implementation naming left un-renamed by deliberate, documented choice

**File:** `packages/core/algorithms/sigma1/index.ts:1252-1268` and throughout `packages/harness/{cli,manifests,promote,stateSnapshot}.ts`
**Issue:** The published algorithm identity is fully renamed to `vpr`
everywhere it is written to disk or the wire, but the implementation module
(`sigma1/` directory, `Sigma1State`, `Sigma1Params`, `makeSigma1`,
`SIGMA1_CODE_VERSION`) keeps its pre-rename name, per an explicit, well-argued
comment (PD-02, plan 07-16) that this is a deliberate scope boundary, not an
oversight — "the rename follows the identity a value IS, PRODUCES, or
RESOLVES, not the machinery that builds it." The two-tier transitional
constant split the phase context flagged as a possible leftover
(`PIPELINE_ALGORITHM_IDS` vs `PUBLISHED_ALGORITHM_IDS`) was confirmed absent
from the tree — that transition was fully collapsed back to one tier by
07-18 as intended, with nothing left behind.
**Fix:** None required. Recorded here only because the phase's own context
called this out as a legitimate Info-level item to confirm rather than
assume; a future full implementation-side rename (`sigma1/` → some other
directory name) is explicitly out of this phase's scope and would be a
separate, later refactor.

---

_Reviewed: 2026-08-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
