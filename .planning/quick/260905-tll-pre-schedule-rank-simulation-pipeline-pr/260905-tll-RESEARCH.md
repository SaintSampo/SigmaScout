# Quick Task 260905-tll: Pre-schedule rank simulation — Research

**Researched:** 2026-09-05
**Domain:** publish pipeline (walk-forward state capture, new sidecar artifact), corpus coverage, client simulation tab
**Confidence:** HIGH on codebase integration points (all read this session); HIGH on the cheesy-arena inventory and license (fetched via `gh` this session); MEDIUM on byte projections (extrapolated from one measured live artifact)

---

<user_constraints>
## User Constraints (from `260905-tll-CONTEXT.md`)

### Locked Decisions

**Product reframe (user-specified, locked)**
- The baked pre-schedule simulation result is **the default view of the Simulation tab for every covered event, always** — including events with schedules, live events, and completed events. First paint requires zero client compute.
- The slider's leftmost stop is **"Before schedule release"** (before the Qual 1 stop). Selecting it and hitting the button re-displays the baked result — the client engine does NOT run for this stop.
- All other slider stops (Qual 1 … Qual N) run the existing client-side engine on demand. The button label changes from "Run simulation" to **"Update simulation"**.

**Pricing home (user-decided earlier this session)**
- All match pricing happens pipeline-side with the exact joint-covariance RP model. Phase 7 D-11 ("combined figures are computed where the covariance lives, never client-side") remains fully respected. No Statbotics-style browser approximation.

**Coverage**
- **Current season (2026) onward now; architecture must support backfilling all seasons later** (user: "eventually I want all seasons"). Do not hardcode the season cutoff deep in the pipeline — make it a parameter.
- Sidecars for events that already have schedules/results are priced with **walk-forward pre-event state** (state as of just before the event's first qual match), not current state.
- For events with no schedule yet, price with current (latest) state; regenerate on each full publish while no real schedule exists; **freeze the sidecar once the real schedule lands in the corpus**.

**Sidecar contents**
- K = 20 synthetic schedules, each: match list of `{red trio, blue trio, redRpPmf, blueRpPmf}` in the same pmf encoding real matches already use.
- Plus the **baked default result**: the precomputed rank distribution per team (the same shape the client engine outputs).
- Lazy-loaded: fetched when the Simulation tab opens, not with the main event artifact.

**Schedule templates (Claude's discretion, announced to user)**
- Vendor Team 254 cheesy-arena schedule CSV templates into the repo (MIT license, with attribution), pinned — no network dependency at publish time. NOTE: executor subagents have no network access; the orchestrator downloads the CSVs in the main context.
- Matches-per-team: use the actual value (`round(6 * qualMatches / teams)`) when the real schedule is known; otherwise 12 (10 for championship divisions).
- Team counts without an exact template: use the nearest template / split trick.
- Per-simulated-schedule team-to-slot assignment is a seeded shuffle (deterministic republishes).

**Scheduleless event pages**
- Full pre-schedule page: once TBA lists registered teams (corpus `event_teams`), publish an event artifact with roster + as-of-now team metrics, live Simulation tab (baked default), and "schedule not yet released" empty states on the other tabs.
- `publish.ts` today skips events with zero predictions and zero upcoming matches and derives rosters only from match rosters; both change. The single-event mode's "No completed matches" throw also needs the scheduleless branch.

**Worker (live cron) — explicitly out of scope for compute**
- The Worker never generates or regenerates sidecars and never runs simulations. It must simply not clobber or delete existing sidecars.

### Claude's Discretion
- Sidecar artifact key naming/versioning, Zod schema shape, and byte-format details.
- Exact draw split for the baked result (e.g. 1000 draws spread 50 per schedule).
- UI copy for pre-schedule states, subject to `sketch-findings-sigmascout` rules.
- Client draw counts when "Update simulation" runs from a qual-match stop (unchanged behavior).

### Deferred Ideas
None recorded.
</user_constraints>

---

## Summary

Every integration point this task needs already exists and was read this session. The publish
pipeline's per-event loop, the per-match walk-forward completion hook, the corpus `event_teams`
helper, the artifact-key conventions, the Worker's write surface, and the client simulation stack
are all in place and well-commented. Three things are **not** in place and are the real work:

1. **Pre-event walk-forward state is not captured.** `publish.ts`'s `onMatchComplete` hook stores
   state *after* each match, so `stateByAlgoEvent` holds each event's **post-event** state. A
   pre-event snapshot is a ~4-line addition inside the same hook (no second replay pass).
2. **`event_teams` is district-only.** It is populated for 150 of 310 2026 events — every district
   event, **zero** regionals, championships, or offseason events. Only **2** scheduleless 2026 events
   have a roster today. The scheduleless-page half of this task is nearly inert unless the ingest is
   widened.
3. **The cheesy-arena license is not MIT.** It is a custom Team 254 licence that does not grant
   redistribution. SigmaScout is a **public** repo. The locked decision to vendor the CSVs rests on a
   factual error and needs a user decision before execution.

**Primary recommendation:** build the sidecar as a standalone R2 key with its own exported key
function and Zod schema, following the `districtsIndexKey`/`districtDetailKey` precedent —
deliberately **not** added to `PageKind`. That single choice buys three things at once: the Worker
structurally cannot clobber it (its writer is keyed on `PageKind`), the `payloadBudget` PAGE_KINDS
gate stays untouched, and the event artifact's reachable 350,000-byte ceiling is never approached.

---

## Finding 1 — Publish pipeline integration points

All line numbers verified by reading `packages/harness/publish.ts` this session.

| What | Where | Notes |
|------|-------|-------|
| Per-event artifact loop | `publish.ts:2036-2088` | Iterates `eventMeta`; builds + uploads one `event` artifact per event |
| **The scheduleless skip** | `publish.ts:2046` | `if (predictions.length === 0 && upcoming.length === 0) continue; // no data for this event under this run's scope` [VERIFIED: packages/harness/publish.ts:2046] |
| Roster derivation (match-only) | `publish.ts:2043-2045` | `eventTeamKeys` = union of `predictions[].match.{red,blue}Teams` and `scheduledForEvent[].{red,blue}Teams`. No `event_teams` read anywhere in this file. |
| `algorithm.predict(state, match)` for upcoming | `publish.ts:1912-1920` | One shared season-final `state`, one call per scheduled match: `matchesForEvent.map((match) => ({ match, prediction: algorithm.predict(state, match) }))` [VERIFIED: packages/harness/publish.ts:1913-1917] |
| Event metadata source | `publish.ts:1543-1549` | `SELECT ... FROM events WHERE year = ? ORDER BY event_key ASC` — **every** event in the season, including scheduleless ones. They already reach the loop; only line 2046 drops them. [VERIFIED: packages/harness/publish.ts:1543-1549] |
| Single-event mode throw | `publish.ts:2383` | `throw new Error(\`No completed matches found in corpus for event ${eventKey}\`)` [VERIFIED: packages/harness/publish.ts:2383] |
| `metricsAsOfEvent` | `publish.ts:1370-1383` | Falls back to season-final metrics when `stateByEventKey` has no entry for the key — which is exactly the scheduleless case (PD-04) |
| Uploader | `publish.ts:1243-1269` | `BoundedUploader.publish(pageKind: PageKind, key, body)` — a new sidecar kind cannot use this without widening `PageKind` (see Finding 4) |

**What a hypothetical match input must look like.** `algorithm.predict` takes an `UpcomingMatch`
[VERIFIED: packages/core/algorithms/types.ts:18-43]:

```ts
export interface UpcomingMatch {
  matchKey: string;
  eventKey: string;
  compLevel: CompLevel;
  setNumber: number;
  matchNumber: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redSurrogates: readonly string[];
  readonly blueSurrogates: readonly string[];
  eventType: number;
}
```

`eventType` is **required and load-bearing**: `sigma1`'s RP fold gates pmf production on
`isRpEligibleEventType(match.eventType)`, and `eventTierFor` *throws* for an unmapped type — offseason
(`99`) is deliberately absent from `EVENT_TYPE_TIERS`, whose registered keys are exactly
`0, 1, 100, 2, 5, 3, 4` [VERIFIED: packages/core/algorithms/sigma1/rp/constants.ts:56-63]. A synthetic
match must carry the real event's own `event_type`, and **offseason events must be skipped entirely**
for sidecar generation or the pipeline throws.

Synthetic `matchKey` must be unique but never collide with a real key. Suggested shape:
`{eventKey}_presim{scheduleIndex}_qm{n}`. `compLevel` must be `"qm"`.

---

## Finding 2 — Walk-forward pre-event state

**It does not exist today.** `publish.ts:1759-1783` captures state through the per-match completion
hook the metric-history pass already pays for:

```ts
const stateByAlgoEvent = new Map<string, Map<string, unknown>>();
for (const algorithm of options.algorithms) stateByAlgoEvent.set(algorithm.id, new Map());
const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
  const algorithm = algorithmById.get(algorithmId);
  if (!algorithm) return;
  stateByAlgoEvent.get(algorithmId)!.set(match.eventKey, state);
  ...
```
[VERIFIED: packages/harness/publish.ts:1759-1766]

The hook receives state **after** `update`, and the stream is chronological, so the last write for an
event key is that event's **last** match — i.e. post-event state. The file's own comment says so
explicitly ("what is stored below is the state as of THAT match's completion").

**Minimal honest addition (no second replay pass, no new corpus read):** keep a per-algorithm
`lastState` local. Inside the same hook, *before* the existing `.set(...)`, if the pre-event map does
not yet have `match.eventKey`, write `lastState` into it — that is the state after the previous
chronological match, i.e. immediately before this event's first match. Then update `lastState`.

Three correctness notes for the planner:

- For the season's very first match, `lastState` is `undefined`; the honest pre-event state there is
  the `initialStates` value (`publish.ts:1720-1734` — the carried or cold-start state), not a throw.
- Events run concurrently. "State before event X's first match" is genuinely the **global** state at
  that instant, which is the correct walk-forward answer, not a defect.
- `WalkForwardSimulator.runAll`'s hook signature is `(match, algorithmId, state) => void`
  [VERIFIED: packages/harness/replay.ts:136-140]. No signature change is needed; `runEventMode` has its
  own smaller copy of the same hook at `publish.ts:2394-2397` that needs the same treatment.

Every algorithm's `update` returns a **new** state object (documented at `publish.ts:1770-1776`), so
storing the reference is a genuine snapshot, not an alias.

---

## Finding 3 — Corpus `event_teams` coverage (blocking for the scheduleless half)

Schema [VERIFIED: packages/corpus/schema.sql:235-240]:

```sql
CREATE TABLE IF NOT EXISTS event_teams (
  event_key TEXT NOT NULL REFERENCES events(event_key),
  team_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (event_key, team_key)
);
```

Read helper `selectEventTeamsForEvents(db, eventKeys): Map<string, string[]>`
[VERIFIED: packages/corpus/db.ts:1357-1370]. Absence discipline: an event with no rows is **absent from
the map entirely** — no key, no empty-array placeholder.

**Measured coverage (queried against `data/corpus.sqlite` this session):**

| Year | Events with `event_teams` | Rows |
|------|---------------------------|------|
| 2019 | 117 | 4,405 |
| 2020 | 117 | 3,834 |
| 2022 | 116 | 3,690 |
| 2023 | 115 | 4,049 |
| 2024 | 119 | 4,235 |
| 2025 | 125 | 4,424 |
| 2026 | **150** | 5,299 |

**2026 breakdown by event type** (`n` = events of that type, `with_teams` = have `event_teams` rows):

| `event_type` | Meaning | n | with_teams | with_matches |
|---|---|---|---|---|
| 0 | Regional | 56 | **0** | 56 |
| 1 | District | 125 | 125 | 123 |
| 2 | District Champ | 15 | 15 | 15 |
| 3 | Champ Division | 8 | **0** | 8 |
| 4 | Champ Finals | 1 | **0** | 1 |
| 5 | District Champ Division | 10 | 10 | 10 |
| 99 | Offseason | 83 | **0** | 39 |
| 100 | Preseason | 12 | **0** | 1 |

**2026 events that are scheduleless AND have a roster: 2.**

**Cause.** `event_teams` is populated only inside the districts ingest loop —
`packages/ingest/cli.ts:736` fetches `` `/event/${eventKey}/teams/keys` `` and `:754` upserts, and that
loop is reached only via `--districts-only` (`pnpm ingest:districts`). Regionals and championships are
never enumerated by it.

**Implication for the planner.** The "scheduleless events get full event pages" deliverable covers
**2 events** as things stand. Either (a) widen the ingest to fetch `/event/{key}/teams/keys` for every
official event in a season (a new `--event-teams-only` mode or an unconditional pass in the events
ingest), or (b) explicitly scope this deliverable to district events and say so. This should be a plan
task either way, not a discovery during execution.

---

## Finding 4 — Artifact schema and key conventions

### The precedent to follow: districts, not `PageKind`

`pageArtifacts.ts` states the rule directly [VERIFIED: packages/harness/pageArtifacts.ts:1405-1418]:

> `districtsIndexKey`/`districtDetailKey` are declared as their OWN exported functions and
> deliberately NOT added to `PageKind`/`ArtifactKeyParams` above. `PageKind` is the union
> `apps/worker/src/artifactWriter.ts`'s exhaustive `SCHEMA_BY_PAGE` record and `publish.ts`'s
> per-season size budget are both keyed on … Widening `PageKind` here would force a Worker change
> that buys nothing.

```ts
export function districtsIndexKey(year: number): string {
  return `v1/districts/${year}.json`;
}
export function districtDetailKey(districtKey: string): string {
  return `v1/district/${districtKey}.json`;
}
```
[VERIFIED: packages/harness/pageArtifacts.ts:1419-1426]

**Recommended sidecar key:** `v1/presim/{eventKey}/{algorithmId}@{version}.json`, via a new exported
`preScheduleKey({ eventKey, algorithmId, version })` that calls the existing `assertVersionShape`.
Algorithm-scoped and version-scoped for the same reason the event artifact is
(`v1/event/${eventKey}/${algorithmId}@${version}.json`, `pageArtifacts.ts:150-152`): a re-tune must not
serve a stale sidecar under a fresh version.

### Preamble

Extend `AlgorithmScopedPreambleSchema` (`schemaVersion` / `generation` / `computedAt` / `algorithmId` /
`algorithmVersion`) [VERIFIED: packages/harness/pageArtifacts.ts:163-176]. `PAGE_ARTIFACT_SCHEMA_VERSION = 1`
[VERIFIED: packages/harness/pageArtifacts.ts:68] — do **not** bump it. This file's own repeated precedent
is that additive new artifact kinds and additive optional fields never bump it.

### pmf encoding — reuse verbatim

Real matches already carry `redRpPmf: z.array(z.number()).optional()` guarded by
`.refine((row) => isValidPmf(row.redRpPmf), { message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9", ... })`
[VERIFIED: packages/harness/pageArtifacts.ts:397-399, 457-463]. Reuse `isValidPmf` and `roundPmf`
(`ROUNDING_RULE.pmf` is `5` decimals, then renormalize) [VERIFIED: packages/harness/rounding.ts:113, 205-216].

### Baked result shape — what the client's row builder demands

`buildRankDistributionRows(result: SimResult, teams: readonly EventTeam[])`
[VERIFIED: apps/web/src/components/event/rankRows.ts:137] throws `MalformedRankHistogramError` unless,
for every team: `histogram.length === result.rankHistograms.size` **and** the histogram sums exactly to
`result.draws` [VERIFIED: apps/web/src/components/event/rankRows.ts:144-161]. So the baked payload must
be a per-team array of integer draw counts, length = roster size, summing to the published draw count.
No worker involvement is needed to display it — the client reconstitutes
`{ rankHistograms: Map<string, Int32Array>, draws }` and calls the same builder.

`SimResult` is `{ rankHistograms: ReadonlyMap<string, Int32Array>; draws: number }`
[VERIFIED: packages/core/algorithms/simulation/rankSimulation.ts:133-144].

### Byte cost — measured, not guessed

Measured against the live `v1/event/2026mitry/vpr@9.0.0+rolling-2026-09c.json` this session
(86 quals, 43 teams, 108,377 bytes total):

- 2026 pmf length is **7**; a sample row is `[0,0.004,0,0,0.996,0,0]`.
- One synthetic match serialized with **team keys**: **169 bytes**.
- The same match with **roster indices** (`{r:[i,i,i],b:[i,i,i],rp:[…],bp:[…]}`): **93 bytes**.

Projection for K=20 at this event: **~291 KB** with team keys, **~160 KB** with indices. The baked
result adds ~43×43 integers ≈ 7 KB. Both compress well (pmfs are mostly zeros), but the raw figure
matters for the budget doc.

**Recommendation:** positional/roster-index encoding for the schedules, matching the existing
positional-encoding convention (`encodeTeamsRowMetrics` / `PositionalMetricEntry`,
`pageArtifacts.ts:910-963`), with the roster array published once at the top of the sidecar. Add a
`presim` row to `docs/publish-budget.md` with its own ceiling; see Finding 7 for why that is safe.

---

## Finding 5 — Client integration

### The three-state branch is the main obstacle

`SimulationTab` returns early twice before the layout stack
[VERIFIED: apps/web/src/components/event/SimulationTab.tsx:286-294]:

```tsx
if (qualRows.length === 0) {
  return <EmptyState heading={SIMULATION_EMPTY_STATE_HEADING} body={SIMULATION_EMPTY_STATE_BODY} />;
}
if (!hasSimulatableRankInputs(artifact)) {
  return <EmptyState heading={SIMULATION_UNAVAILABLE_HEADING} body={SIMULATION_UNAVAILABLE_BODY} />;
}
```

A scheduleless event trips **both** (zero `qm` rows, no pmfs). Both guards must become
"…**and** no pre-schedule sidecar is available". The `SIMULATION_UNAVAILABLE_*` state must still fire
for offseason events, which genuinely have no RP model — the sidecar cannot exist for them either
(`eventTierFor` throws on type 99), so the two conditions coincide cleanly.

### The worker cap is a non-issue

`MAX_SIMULATION_MATCHES = 500` [VERIFIED: apps/web/src/workers/simulationProtocol.ts:29]. K=20 × ~86 =
1,720 hypothetical matches never crosses the boundary: the client posts **one** schedule's remaining
matches at most (≤ ~86), and the "Before schedule release" stop posts nothing at all — it renders the
baked histograms directly. **The baked display path needs no Web Worker.**

### Slider / picker

`StartMatchPicker` has been a slider + typed number input + one selected-match summary since
2026-09-01 (`START_MATCH_SLIDER_TESTID`, `START_MATCH_NUMBER_INPUT_TESTID`,
`START_MATCH_PICKER_MAX_H_PX = 132`) [VERIFIED: apps/web/src/components/event/StartMatchPicker.tsx:36-47].
Adding a leftmost stop requires a sentinel, because the tab's selection state is a `matchKey` string:

- `SimulationTab` holds `useState<string | null>(() => defaultStartMatchKey(qualRows))` and resolves it
  against current rows every render, falling back to `null` on a miss
  [VERIFIED: apps/web/src/components/event/SimulationTab.tsx:196-205].
- `simulationSignature` is `` `${artifact.algorithmVersion}|${resolvedMatchKey ?? "none"}|${remainingCount}|${baselineCount}` ``
  [VERIFIED: apps/web/src/components/event/SimulationTab.tsx:225-229]. A sentinel stop must be
  distinguishable from `null` here, or a pre-schedule selection will read as "no selection".

Use an explicit discriminated selection (`{ kind: "preSchedule" } | { kind: "match"; matchKey: string }`)
rather than overloading `null` or a magic string.

### Button label

`RUN_LABEL_IDLE = "Run simulation"` and `RUN_LABEL_RERUN = "Re-run simulation"`
[VERIFIED: apps/web/src/components/event/RunControl.tsx:24-26]. Both are Copywriting-Contract rows with
guarding tests. Renaming to "Update simulation" means editing the constants **and** the tests that pin
them, and noting the contract deviation in the SUMMARY.

### Lazy loading — the Radix trap

Every event tab is a Radix `TabsContent` that stays **mounted with `hidden`**, so `SimulationTab`
renders on every event-page view regardless of the active tab — the file's own header says so and is
the stated reason `useSimulationRun` constructs nothing until `start()` is called
[VERIFIED: apps/web/src/components/event/SimulationTab.tsx:26-36]. A `useQuery` placed inside
`SimulationTab` would therefore fetch the sidecar on **every** event page load, defeating the lazy
requirement.

**Do this instead:** put the sidecar query in the route (`event.$eventKey.tsx`), gated on the already
resolved `activeTab`:

```ts
enabled: isValidKey && version !== undefined && activeTab === "simulation"
```

Follow `eventQueryOptions`'s shape exactly [VERIFIED: apps/web/src/lib/api/event.ts:52-57]:
`queryKey: ["event", eventKey, algorithmId, version]`, `queryFn` = fetch → `!res.ok` throws
`ArtifactFetchError` → `Schema.parse` → throws `ArtifactValidationError`. A missing sidecar is a
**404**, and for this artifact 404 must be an ordinary, non-error absence (fall back to the existing
pre-run placeholder), not a rendered error state.

### 404 empty state

The route's `is404` branch renders
`` heading={`No published results for ${eventKey} yet`} `` [VERIFIED: apps/web/src/routes/event.$eventKey.tsx:121-127],
driven by `error instanceof ArtifactFetchError && error.status === 404` (`:206`). Once scheduleless
events get an event artifact this branch stops firing for them — which is the intended outcome. It must
keep firing for genuinely unpublished events, so do **not** convert it into a sidecar-aware branch.

---

## Finding 6 — Cheesy-arena schedule templates

### Inventory (fetched via `gh api` this session — HIGH confidence)

- `github.com/Team254/cheesy-arena`, path `schedules/`, **1,330 files**, total **1,614,883 bytes**.
- Naming: `{numTeams}_{matchesPerTeam}.csv`.
- `numTeams` ∈ **6…100 inclusive, no gaps** (95 values). `matchesPerTeam` ∈ **1…14** (14 values).
  95 × 14 = 1,330 — the grid is complete.
- The directory listing API paginates at 1,000 entries; use
  `gh api "repos/Team254/cheesy-arena/git/trees/main?recursive=1"` for the full list.

### CSV format (from `tournament/schedule.go`, fetched this session)

12 integer columns per row, no header. Read as
`[red1, red1Surrogate, red2, red2Surrogate, red3, red3Surrogate, blue1, blue1Surrogate, blue2, blue2Surrogate, blue3, blue3Surrogate]`
— team values are **1-based indices** into a shuffled team list (`teams[teamShuffle[anonMatch[0]-1]]`),
surrogate flags are `1`/`0`. Sample first line of `34_12.csv`: `21,0,22,0,1,0,4,0,11,0,32,0`.

Cheesy-arena's own derivations, which the CONTEXT's formula differs from:

```go
matchesPerTeam := int(float32(numMatches*TeamsPerMatch) / float32(numTeams))   // TRUNCATES
numMatches = int(math.Ceil(float64(numTeams) * float64(matchesPerTeam) / 6))
```

CONTEXT says `round(6 * qualMatches / teams)`; cheesy-arena **truncates**. Use `floor` to match the
upstream convention, then expect the template row count `ceil(teams × mpt / 6)` to differ from the real
qual count by 0–1 rows at some events (e.g. 26 teams / 40 quals → mpt 9 → 39 template rows). Harmless
for a synthetic schedule; worth one sentence in the sidecar's doc comment.

### Which files are actually needed

Computed over the 2026 corpus this session: **247 events with quals produce 96 distinct
`(teams, matchesPerTeam)` pairs**, spanning `12_8` … `75_10`. Two fall outside the template grid
(`16_15`, `30_25` — both offseason oddities with `mpt > 14`) and need clamping to 14 or exclusion.
Backfilling all seasons will push the distinct-pair count higher. Given 1.6 MB for the complete grid,
**taking all 1,330 files is simpler and more future-proof than curating a subset.**

### ⚠️ LICENSE — the CONTEXT's premise is wrong

`gh api repos/Team254/cheesy-arena --jq '.license.spdx_id'` returns **`NOASSERTION`** ("Other"), **not
MIT**. The `LICENSE` file reads, verbatim:

```
Copyright (c) 2014, Team 254
All rights reserved.

This software may be used and redistributed subject to the following conditions:

1. The software may be used without restriction for testing, scrimmages,
   off-season events, and for evaluation purposes.
2. The software may be modified for such use, but the modifications may not be
   redistributed without permission from Team 254.
3. Redistribution for the purpose of contributing to the original project (e.g.
   forking on GitHub and submitting pull requests) is permitted.
```

SigmaScout is a **public** repo (`github.com/SaintSampo/SigmaScout`, visibility `PUBLIC`). Committing
1,330 upstream CSVs into it is redistribution, and clause 3 grants redistribution only for contributing
back upstream. There is also **no vendored-data precedent in this repo** — `git ls-files` matches zero
`.csv` files and nothing under a `vendor/` or `third-party/` path.

For reference, Statbotics does **not** vendor them either — its worker fetches at runtime:
`fetch(\`https://raw.githubusercontent.com/Team254/cheesy-arena/main/schedules/${numTeams}_${numMatches}.csv\`)`
[VERIFIED: github.com/avgupta456/statbotics frontend/src/pagesContent/event/[event_id]/worker.ts, fetched this session].
That same file also confirms the `>100` split trick the CONTEXT describes: fetch `100_{n}`, fetch
`{numTeams-100}_{n}`, offset the second block's indices by 100, concatenate.

**Options for the planner (this needs a user decision — it contradicts a locked decision):**

| Option | Redistribution? | Publish-time network? | Notes |
|---|---|---|---|
| **A. Cache into `data/schedule-templates/`, gitignored** | No | Yes, once (cacheable) | `.gitignore` already has `data/*` with `!data/…` allowlist entries — this is the established home for large, regenerable local data. Executors have no network, but publishes already run from the main context (see Pitfalls). **Recommended.** |
| B. Vendor as locked | **Yes** | No | Contradicts the licence as written. Only viable with Team 254's written permission. |
| C. Generate schedules in-house | No | No | Real work: FRC-quality schedules need pairing/partner-repeat balance. Out of proportion for this task. |
| D. Fetch in the browser like Statbotics | No | Client-side | Rejected by the locked "price pipeline-side" decision. |

---

## Finding 7 — Worker safety and budget tests

**The Worker cannot clobber a sidecar.** `apps/worker/src/artifactWriter.ts` exposes
`writeArtifactObject(env, budget, page: PageKind, params: ArtifactKeyParams, artifact)`, which looks the
schema up in `const SCHEMA_BY_PAGE: Record<PageKind, {...}>` and puts at `artifactKey(params)`
[VERIFIED: apps/worker/src/artifactWriter.ts:44, 81-95]. It writes only `PageKind` keys and issues no
deletes. Keeping the sidecar out of `PageKind` makes non-clobbering structural rather than a rule
someone has to remember.

**Budget tests.** `payloadBudget.test.ts` declares its own
`const PAGE_KINDS = ["teams", "team", "events", "event", "compare"] as const;`
[VERIFIED: packages/harness/payloadBudget.test.ts:80] and asserts every one has a well-formed entry in
`docs/publish-budget.md`. A new *unlisted* kind adds nothing to that gate; adding a `presim` entry to
the doc is optional and safe (the loop only iterates its own list).

**The one reachable hard ceiling:** `const EVENT_PAGE_ABSOLUTE_MAX_BYTES = 350_000;`
[VERIFIED: packages/harness/payloadBudget.test.ts:123], a dedicated `it(...)` specifically so it stays
reachable past the open `teams` breach. Current committed `event` stats: `maxBytes` 163,490,
`budgetMaxBytes` 350,000 (`docs/publish-budget.md`). **Do not put sidecar bytes on the event artifact** —
a K=20 schedule block would blow this immediately.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead |
|---|---|---|
| RP pmf validation | A bespoke sum check | `isValidPmf` + the existing `.refine` message text (`pageArtifacts.ts:457-463`) |
| pmf rounding | `toFixed` | `roundPmf` / `ROUNDING_RULE.pmf` (`rounding.ts:205-216`) — rounds then renormalizes |
| Rank quantiles / row assembly | A second quantile implementation | `buildRankDistributionRows` + `continuousQuantile` (`rankRows.ts`, `simQuantile.ts`) |
| Artifact fetch/parse/error plumbing | A new fetch helper | Copy `apps/web/src/lib/api/event.ts` verbatim (it is itself a verbatim copy of `team.ts` per 07-PATTERNS.md) |
| A new R2 upload path | A new client | `putObject` from `packages/harness/r2Client.js`, as `scripts/publishDistricts.ts` does |
| Standalone publish script scaffolding | From scratch | `scripts/publishDistricts.ts` — `parseArgs`, deep relative imports with `.js`, `main()` guarded on entry point, `--dry-run` that composes + validates + prints bytes without `putObject` |
| Schedule generation | A pairing algorithm | cheesy-arena templates (subject to Finding 6's licence question) |

---

## Common Pitfalls

1. **Publishes and network calls must run from the main context.** Executor subagents' sandbox denies
   all network Bash, including `pnpm publish:seasons` and any live-origin read-back
   [ASSUMED — from MEMORY.md `project_subagent_network_block`, not re-verified this session]. Plan the
   template download and every publish/verify step as orchestrator work.
2. **`docs/publish-budget.md` is transcribed by hand.** `publish:seasons` prints its summary but does
   not write the doc; a stale doc keeps `payloadBudget.test.ts` red
   [ASSUMED — MEMORY.md `project_publish_budget_manual_step`]. The committed block currently names
   `vpr@8.0.0+rolling-2026-09b` while the live manifest serves `vpr 9.0.0+rolling-2026-09c` — expect it
   to need a re-transcription after any republish this task triggers.
3. **Test scope.** `vitest` from `apps/web` sees 77 files; from the repo root, 167. And the root
   `pnpm typecheck` (`tsc --noEmit`) does **not** cover `apps/web` — the authoritative command for web
   code is `pnpm --filter web typecheck`. This exact gap hid a real regression across three consecutive
   Phase 8 wave gates [VERIFIED: .planning/phases/08-simulation-compare/deferred-items.md, "08-15 Task 1"].
4. **Worktrees do not carry `data/` or `.env`.** Both are gitignored, so a plan that touches the corpus
   or runs a publish must disable worktrees up front [ASSUMED — MEMORY.md `project_worktree_gitignored_state`].
5. **Artifacts before manifest/index.** `scripts/publishDistricts.ts`'s header states the rule: "every
   `v1/district/{key}.json` is written before `v1/districts/{year}.json` is overwritten, so the index
   never points at a detail object that is not there yet" [VERIFIED: scripts/publishDistricts.ts:37-41].
   For this task: write each sidecar **before** the event artifact that will advertise it.
6. **Freezing the sidecar.** "Freeze once the real schedule lands" needs a positive check, not an
   inference from absence. The natural predicate is "the corpus has ≥1 `qm` row for this event"
   (`selectScheduledMatches` / the season stream); an R2 `get`-before-`put` on every event would be
   expensive. Prefer deriving the freeze decision from the corpus, then simply not writing.
7. **`event_teams` absence is not emptiness.** `selectEventTeamsForEvents` omits the key entirely for
   an unregistered event. Do not `?? []` it into "this event has zero teams" and publish an empty roster.
8. **Offseason events must be excluded from sidecar generation** — `eventTierFor` throws on
   `event_type` 99, so a synthetic match at an offseason event crashes the publish rather than
   degrading. The existing `hasSimulatableRankInputs` unavailable state already covers those events on
   the client.
9. **`publish.test.ts` pins `runEventMode`'s structure** — a structural stand-in test asserts
   `runEventMode`'s own line range contains **exactly one** `buildSeasonStream(`, one
   `sortedPoolsByMetric(`, and one `metricsAsOfEvent(` call
   [VERIFIED: packages/harness/publish.test.ts:3010-3017]. Adding a second call of any of those three
   inside that function will fail it.
10. **Surrogates.** Cheesy-arena templates carry per-slot surrogate flags, and a surrogate appearance
    does not count toward that team's ranking. `SimMatchInput` has no surrogate field, and
    `simulateRanks` deliberately owns no exclusion rule ("The corpus-level exclusion categories
    (offseason, surrogate-affected, quarantined) are not representable on the event artifact")
    [VERIFIED: packages/core/algorithms/simulation/rankSimulation.ts:155-159]. Decide explicitly whether
    the pre-schedule sidecar honours surrogate flags when accumulating RP, and record the choice —
    silently ignoring them slightly inflates the RP totals of teams in surrogate slots.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Subagent sandboxes deny network Bash | Pitfall 1 | Plan over-constrains where publish steps run — low cost |
| A2 | `docs/publish-budget.md` is transcribed manually | Pitfall 2 | A red test after republish surprises the executor |
| A3 | Worktrees do not carry `data/`/`.env` | Pitfall 4 | A publish task inside a worktree fails to find the corpus |
| A4 | K=20 byte projection (~160 KB indexed) | Finding 4 | Extrapolated from one event; a 100-team champ division will be ~2.5× larger. Measure before committing a ceiling. |
| A5 | 1,000 draws split 50-per-schedule is adequate for the baked result | — (CONTEXT discretion) | Under-sampling widens the baked distribution vs. what the client would produce from Qual 1 |

---

## Open Questions

1. **Cheesy-arena licence vs. the locked "vendor the CSVs" decision.**
   - Known: the licence is not MIT; it grants no general redistribution; the repo is public; there is no
     vendored-data precedent here; Statbotics fetches at runtime.
   - Unclear: whether the user wants to seek Team 254's permission, or switch to a gitignored local cache.
   - Recommendation: **Option A** (cache into `data/schedule-templates/`, gitignored, downloaded once by
     the orchestrator). Preserves "no network at publish time" after the first fetch, needs no licence
     question answered, and matches the repo's existing treatment of `data/`.

2. **`event_teams` coverage — widen the ingest, or narrow the deliverable?**
   - Known: district-only, 2 usable scheduleless 2026 events.
   - Recommendation: add an ingest task fetching `/event/{key}/teams/keys` for every official event in a
     season. `tbaClient.ts:266-276` already has the fetcher; the work is a new CLI mode and a loop.

3. **Where does the sidecar builder live?**
   - `publish.ts` is 2,542 lines and already carries a structural pin test. The pre-event state it needs
     exists only inside `publishSeasons`' replay.
   - Recommendation: pure builders in a new `packages/harness/preSchedule.ts` (template loading, seeded
     shuffle, synthetic-match construction, baked-result computation), called from `publish.ts`'s
     per-algorithm event loop with the pre-event state map passed in. Keeps `publish.ts`'s growth to the
     hook addition plus one call site.

---

## Sources

### Primary (HIGH confidence — read/queried this session)
- `packages/harness/publish.ts` (lines 1370-1383, 1520-1580, 1688, 1700-1800, 1888-1920, 2036-2088, 2340-2470)
- `packages/harness/pageArtifacts.ts` (68, 110-176, 323-560, 1190-1310, 1400-1426)
- `packages/harness/payloadBudget.test.ts` (80-190), `packages/harness/rounding.ts` (113, 205-216)
- `packages/harness/replay.ts` (136-155), `packages/harness/stateSnapshot.ts` (header)
- `packages/corpus/schema.sql` (225-241), `packages/corpus/db.ts` (575-640, 1332-1370)
- `packages/core/algorithms/types.ts` (18-43, 252), `.../sigma1/rp/constants.ts` (28-80),
  `.../simulation/rankSimulation.ts` (108-205)
- `apps/web/src/components/event/{SimulationTab,StartMatchPicker,RunControl,rankRows,useSimulationRun}.tsx|ts`
- `apps/web/src/workers/simulationProtocol.ts`, `apps/web/src/lib/api/event.ts`,
  `apps/web/src/lib/artifactOrigin.ts`, `apps/web/src/routes/event.$eventKey.tsx`
- `apps/worker/src/artifactWriter.ts`, `scripts/publishDistricts.ts`, `docs/publish-budget.md`
- `.planning/phases/08-simulation-compare/{08-CONTEXT.md, deferred-items.md}`
- `data/corpus.sqlite` — direct SQL queries for `event_teams` coverage and the 2026 `(teams, mpt)` distribution
- Live R2: `https://data.sigmascout.org/v1/manifest/algorithms.json`,
  `.../v1/event/2026mitry/vpr@9.0.0+rolling-2026-09c.json`
- GitHub API: `Team254/cheesy-arena` tree listing, `LICENSE`, `tournament/schedule.go`;
  `avgupta456/statbotics` simulation worker

### Tertiary (LOW confidence)
- MEMORY.md entries cited inline as `[ASSUMED]` in Pitfalls 1, 2, 4

---

## Metadata

**Confidence breakdown:**
- Pipeline integration points: HIGH — every line cited was opened this session
- Corpus coverage: HIGH — direct SQL against the live corpus
- Cheesy-arena inventory + licence: HIGH — `gh api` this session; the licence text is quoted verbatim
- Byte projections: MEDIUM — extrapolated from one measured event

**Research date:** 2026-09-05
**Valid until:** ~30 days (stable in-repo internals); the `event_teams` coverage figure changes the
moment an ingest widening lands.
