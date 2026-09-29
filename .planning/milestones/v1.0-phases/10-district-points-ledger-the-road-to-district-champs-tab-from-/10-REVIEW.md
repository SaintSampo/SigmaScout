---
phase: 10-district-points-ledger-the-road-to-district-champs-tab-from-
reviewed: 2026-09-25T12:30:00Z
depth: quick
files_reviewed: 22
files_reviewed_list:
  - apps/worker/src/districtRefresh.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/districtEventState.ts
  - apps/worker/src/artifactWriter.ts
  - apps/worker/src/tbaPoll.ts
  - packages/harness/districtRankingsMerge.ts
  - packages/harness/stateBaseline.ts
  - packages/harness/publishBudget.ts
  - packages/core/districts/ledgerSimulation.ts
  - packages/core/districts/bracket.ts
  - packages/core/districts/pointSummary.ts
  - scripts/publishDistricts.ts
  - scripts/publishLiveWindows.ts
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/districtLedgerStatus.ts
  - apps/web/src/components/districts/districtTimeline.ts
  - apps/web/src/components/districts/districtHistGeometry.ts
  - apps/web/src/components/districts/useDistrictLedgerData.ts
  - apps/web/src/components/districts/useDistrictSimulationRun.ts
  - apps/web/src/workers/districtSimulationProtocol.ts
  - apps/web/src/workers/createDistrictSimulationWorker.ts
  - apps/web/src/lib/api/districts.ts
findings:
  critical: 1
  warning: 10
  info: 5
  total: 16
status: fixed_with_deferrals
---

# Phase 10: Code Review Report

**Reviewed:** 2026-09-25T12:30:00Z
**Depth:** quick (extended with targeted reads and two executable probes)
**Files Reviewed:** 22 source files of the ~104 changed
**Status:** fixed_with_deferrals

## Summary

Advisory review of the district points ledger. The submitted code is unusually
well-documented and the refusal discipline (`DistrictMergeError`,
`UnratedTeamError`, `InvalidAllianceSetError`, the zero-window and
schema-version gates in `publishLiveWindows.ts`) is genuine, not decorative. The
150 tests in the four core district suites pass.

The defects that survive review cluster in one place: **values that arrive from
outside the module are used as array indices, as alliance counts, or as sort
keys without being checked against the ranges those uses require.** One of them
(CR-01) is reproducible today and silently produces a wrong number on a rendered
cell rather than throwing. Two more (WR-06, WR-07) are staleness/misrouting
paths that only appear during a live event, which is exactly when nobody is
reading test output.

Two project conventions were checked and are clean: no `±` appears in
`components/districts/`, and no raw hex/`rgb()`/Tailwind palette class appears in
any district component (token-only colours hold).

Everything below cites a line. Nothing below is a style preference.

## Critical Issues

### CR-01: A known category value above its ceiling silently zeroes the whole histogram, and the cell then reports a 100% chance of points

**Severity:** BLOCKER
**Status:** fixed (76bd5d3c)
**File:** `packages/core/districts/ledgerSimulation.ts:895-902` (accumulator), reached via `:883` and `:889`
**Also:** `apps/web/src/components/districts/districtLedgerRows.ts:453-460` (`earnedPointsMap`, the producer of the offending values)

The accumulator writes the drawn point value straight in as an index:

```ts
qualByIndex[i]![qual[i]!]! += 1;
selectionByIndex[i]![selection[i]!]! += 1;
elimByIndex[i]![elim[i]!]! += 1;
awardByIndex[i]![award[i]!]! += 1;
totalByIndex[i]![sum]! += 1;
```

Each of those is an `Int32Array` sized to `maxEventPoints(season, tier)` plus
one. **An out-of-range write on a TypedArray is a silent no-op** — no throw, no
`undefined`, no `NaN`. So is a fractional index.

`elim[i]` and `award[i]` are not simulated on the known-stage paths; they are
copied verbatim from the caller:

```ts
for (let i = 0; i < teamCount; i++) elim[i] = known.get(baselines[i]!.teamKey) ?? 0;
...
for (let i = 0; i < teamCount; i++) award[i] = known.get(baselines[i]!.teamKey) ?? 0;
```

and the browser's caller fills those maps from TBA's own published component
values with no bound check at all:

```ts
const knownElimPoints = stage.elim ? earnedPointsMap(districtArtifact, eventKey, "elim") : undefined;
const knownAwardPoints = stage.award ? earnedPointsMap(districtArtifact, eventKey, "award") : undefined;
```

Reproduced (24-team district-tier event, `knownAwardPoints` of 20 for one team,
district award ceiling 15):

```
award hist len: 16   sum (expect 100): 0
eventTotal len: 84   sum (expect 100): 100
```

The award histogram loses **every one of the 100 draws**. The failure is then
laundered into a confident wrong number rather than surfacing:
`pointSummary.chanceOfAnyPoints` (`packages/core/districts/pointSummary.ts:111-115`)
computes `1 - histogram[0] / denominator` = `1 - 0/100` = **1.0**, so the cell
prints a 100% chance of earning points for a team whose distribution is empty,
and the module's own >0.995 rule then falls it back to the median form over
zero mass. Neither `pointSummary` nor `districtLedgerRows` carries a total-mass
guard. On the publisher side the same input reaches `encodeDistrictPointPmf`,
which *does* throw `EmptyHistogramError` — so the offline and live halves of one
module disagree about whether this input is fatal.

Reachability, stated honestly: I scanned all 16,345 `district_rankings` rows for
2023+ and found **zero** component values above their tier ceiling and zero
fractional values, so this is latent today. It is still a BLOCKER by this
project's own stated discipline — the input is third-party TBA data that
`awardBaseRates.pointsToSupportIndex` already treats as capable of exceeding 15
(`if (points >= 15) return AWARD_POINT_SUPPORT.length - 1`), and the module
everywhere else validates before computing. `pointMassDistribution`
(`districtLedgerRows.ts:143-148`) sizes its array to `value + 1` for exactly
this reason; the simulation does not.

**Fix:** validate in `simulateDistrictEvent`'s existing pre-loop pass, beside
the `UnratedTeamError`/`InvalidFieldSizeError` block, naming every offender:

```ts
if (input.knownElimPoints !== undefined) {
  const bad = [...input.knownElimPoints].filter(
    ([, v]) => !Number.isInteger(v) || v < 0 || v > ceilings.elim
  );
  if (bad.length > 0) {
    throw new InvalidKnownPointsError(
      `event ${eventKey}: ${bad.length} known elim value(s) outside 0..${ceilings.elim}: ` +
        bad.map(([k, v]) => `${k}=${v}`).join(", ")
    );
  }
}
// ...same for knownAwardPoints against ceilings.award
```

A typed throw is the right outcome: `districtSimulationProtocol.ts` already
converts a typed throw into a per-event `unavailable` entry, which renders as
honest "unavailable" copy instead of a fabricated 100%.

## Warnings

### WR-01: A payload-only team gets a zero ceiling, which is the exact failure the merge says it exists to prevent

**Severity:** WARNING
**Status:** fixed (41ffe5e8)
**File:** `packages/harness/districtRankingsMerge.ts:423-445`

For a team present in the TBA rankings payload but absent from the published
artifact, `existing` is `undefined`, so `remainingEvents` falls back to `[]` and
`maxRemainingDistrict` reduces to `0`. That team then enters
`computeLocksWithQualifiers` with a ceiling equal to its current point total.

The function's own header (`:363-365`) says dropping a team "would silently
remove a threat and manufacture a `locked` verdict". Zeroing its ceiling does
the same thing by a different route: it removes the team as a threat to
everyone above it and can mark the team itself `eliminated`. `dcmpStillAhead`
just above (`:137-139`) is deliberately biased toward *over*stating ceilings for
exactly this reason; this path is biased the other way.

**Fix:** refuse rather than guess, matching the module's other two refusals —
or seed the ceiling from the district's own maximum:

```ts
maxRemainingDistrict: existing === undefined ? districtEventMaxTotal : maxRemainingDistrict,
```

and record the substitution, so an unknown team overstates rather than
understates.

### WR-02: The two merge entry points disagree on `schemaVersion`

**Severity:** WARNING
**Status:** fixed (fd3d2bc7)
**File:** `packages/harness/districtRankingsMerge.ts:463` vs `:515-524`

`applyDistrictRankings` stamps `schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION` on
its output. `applyDistrictEventState` does not — it spreads the artifact and
re-parses. In `districtRefresh.ts:257-260` the choice between the two is made by
whether TBA answered 200 or 304, so **the published `schemaVersion` of a live
district depends on a TBA cache hit**. Two ticks over the same district can
write two different values.

**Fix:** stamp it in both, or in neither and let the publisher own it.

### WR-03: A district-key validator is the only check applied to an event key before it becomes a URL segment and a D1 row key

**Severity:** WARNING
**File:** `apps/worker/src/districtRefresh.ts:231`

```ts
} else if (matchDerived.playoffsDone && DISTRICT_KEY_PATTERN.test(eventKey)) {
```

`DISTRICT_KEY_PATTERN` is declared at `:66` with a doc comment that describes it
as "TBA's own year-prefixed **district** key shape" and justifies it by where a
*district* key travels. It is being used here as the sole validation of an
*event* key before that key is interpolated into `/event/{key}/awards` and into
`eventAwardsCursorKey`. It happens to pass because the two key shapes coincide
today; the coupling is invisible, and narrowing the district pattern (districts
are 2-4 char suffixes, events are not) would silently switch the entire awards
poll off with no test failure.

**Fix:** declare `EVENT_KEY_PATTERN` beside it, use it here, and note in each
doc comment that the other exists.

### WR-04: The Worker's only district-size signal undercounts UTF-8

**Severity:** WARNING
**Status:** fixed (8147cef1)
**File:** `apps/worker/src/artifactWriter.ts:167`

```ts
return serialized.length;
```

That is UTF-16 code units, logged as `bytes` in `district-refreshed`
(`districtRefresh.ts:291`). `scripts/publishDistricts.ts:1382` goes out of its
way to use `Buffer.byteLength` and states the reason: 30 of 3,155 teams carry a
non-ASCII nickname. The Worker cannot enforce `DISTRICT_DETAIL_MAX_BYTES`
(documented, correct — importing `publishBudget.ts` would pull `node:path` into
the bundle), so this log line is the *only* growth signal for a 1.3 MB-ceilinged
object, and it reads low.

**Fix:** `new TextEncoder().encode(serialized).length` — no Node built-in, works
in the Workers runtime.

### WR-05: The districts index object bypasses the publish budget gate entirely

**Severity:** WARNING
**Status:** fixed (da76dd5b)
**File:** `scripts/publishDistricts.ts:1465-1478`

`gateAndRecord` exists so the budget check "runs BEFORE the object is written
locally or uploaded" (`:1362-1365`). The detail artifacts and the sidecars go
through it. The index does not:

```ts
const indexBody = JSON.stringify(year.indexArtifact);
const indexBytes = Buffer.byteLength(indexBody);
totalBytes += indexBytes;
if (options.localOut !== undefined) { mkdirSync(...); writeFileSync(...); }
...
await putObject(options.bucket, year.indexKey, indexBody, {...});
```

No `assertWithinDistrictBudget` call, and the `--local-out` write is a second
hand-rolled copy of `gateAndRecord`'s. The index grows with the district count
per season and is on the page-load path.

**Fix:** add `indexAbsolute` to `DistrictBudgetCeilings` and route the index
through `gateAndRecord` like the other two kinds.

### WR-06: The Worker run signature cannot see a value change, only a presence change

**Severity:** WARNING
**Status:** fixed (48dba12b)
**File:** `apps/web/src/components/districts/useDistrictLedgerData.ts:165-172`

```ts
`${event.eventKey}|${String(event.input.remainingMatches.length)}|${String(event.input.baselines.length)}|${String(
  event.input.knownAlliances !== undefined
)}${String(event.input.knownElimPoints !== undefined)}${String(event.input.knownAwardPoints !== undefined)}`
```

`useDistrictSimulationRun` keys its effect on `signature` alone. So:

- `knownElimPoints` / `knownAwardPoints` **contents** changing (the district
  artifact refetches every 60 s while an event is live — `districts.ts`'s new
  `refetchInterval`) does not re-run the simulation;
- `knownAlliances` **rosters** changing does not re-run it;
- `allianceCount` is absent from the signature entirely;
- a score correction that revises `baselines` without changing the row count
  does not re-run it.

The displayed distributions silently go stale in precisely the live window the
phase was built for.

**Fix:** hash the values, not their presence — e.g. fold each known map's sorted
`key=value` pairs and `allianceCount` into the signature string.

### WR-07: A partially published alliance list routes a regular district event through the divisioned-DCMP fallback table

**Severity:** WARNING
**Status:** fixed (4022b8a3)
**File:** `apps/web/src/components/districts/districtLedgerRows.ts:433`

```ts
const allianceCount = stage.alliance && alliances !== undefined ? alliances.length : DEFAULT_DISTRICT_ALLIANCE_COUNT;
```

`allianceCount` is taken as whatever length TBA's `event_alliances` currently
has. If that array is 4 or 2 entries long — which is what it looks like while
selection is in progress — `simulateDistrictEvent` takes the
`!usesEightAllianceBracket` branch and prices elimination points from
`divisionedDcmpPlayoffPmf`. That table's own doc comment
(`packages/core/districts/bracket.ts:310-334`) scopes it to the **16 divisioned
district championship parent events** and to nothing else; its two- and
four-alliance populations are `micmp`/`necmp`/`oncmp`/`txcmp` only. A regular
district event would be priced from base values (0/10/20) that its own bracket
cannot produce.

`validateSuppliedAlliances` does not catch it: it only requires that alliance
numbers `1..allianceCount` are all present, which a truncated list satisfies.

**Fix:** treat a published alliance list whose length is not the expected
bracket size as not-yet-final — keep `DEFAULT_DISTRICT_ALLIANCE_COUNT` and omit
`knownAlliances` — or refuse in `validateSuppliedAlliances` when a
district-tier event supplies a count the eight-alliance bracket does not use.
Separately, `validateSuppliedAlliances` accepts an alliance with one or two
picks (`ledgerSimulation.ts:966-973` rejects only 0 and >4), so
`allianceWinProbability` can be asked to price a one-robot alliance against a
three-robot one.

### WR-08: An unloaded event's stage steps sort to the end of the season, dragging its jump chip with them

**Severity:** WARNING
**Status:** fixed (6d1cc881)
**File:** `apps/web/src/components/districts/districtTimeline.ts:145-185`, comparator at `:121-136`

When `eventArtifacts` has no entry for an event, `lastQualMs` stays `null` and
all four of that event's stage steps are pushed with `sortMs: null`.
`compareSteps` puts every untimed step **after** every timed one:

```ts
if (aTimed !== bTimed) return aTimed ? -1 : 1;
```

so a week-1 event whose artifact has not loaded has its alliance-selection,
playoff and awards steps positioned after the district championship. The `week`
tiebreak below never runs, because it is only reached when both sides are
untimed. The derived chips inherit it: `lastIndexByWeek` (`:196-200`) takes the
*highest* index carrying each week, so "After week 1" jumps to near the end of
the slider.

The event list is the fetch set, so this is the ordinary first-paint state
during loading, not a rare one.

**Fix:** when `lastQualMs` is `null`, fall back to a week-derived instant (or
sort untimed steps by `week` before the timed/untimed split rather than after
it), so a missing artifact shortens precision rather than reordering the season.

### WR-09: Two documented-as-throwing calls sit inside render-path `useMemo`s with no error boundary named

**Severity:** WARNING
**File:** `apps/web/src/components/districts/districtLedgerRows.ts:669-673`; `apps/web/src/components/districts/districtLedgerStatus.ts:111`

`convolveDistrictGrandTotal` is called with a comment that states
`NegativeDistrictShiftError` "is allowed to propagate rather than clamped", and
`computeDistrictLedgerStatuses` opens with `maxEventPoints(artifact.year, "district")`,
which throws `UnknownDistrictSeasonError` for an unregistered season. Both run
inside `useMemo` during `DistrictLedger`'s render. A throw there unmounts the
subtree — the whole Locks page goes blank, not just the tab.

Refusing to fabricate a value is right. Letting the refusal reach React's
renderer is not: the rest of the phase is careful to degrade per-event
(`DistrictSimulationEventUnavailable`) rather than per-page.

**Fix:** either wrap the tab in an error boundary that renders the
`districtLedgerCopy` unavailable text, or catch at the `useMemo` boundary and
return an `unavailable` row model.

### WR-10: `?district=` reaches an artifact URL path unvalidated

**Severity:** WARNING
**File:** `apps/web/src/lib/api/districts.ts` (`districtQueryOptions`) via `apps/web/src/routes/districts.tsx:140`; key builders at `packages/harness/pageArtifacts.ts:1917` and `:2263`

`DistrictsSearchSchema.district` is `z.string().optional()` with no shape check.
It flows to `districtDetailKey(districtKey)` → `` `v1/district/${districtKey}.json` ``
→ `artifactUrl` → `` `${ARTIFACT_ORIGIN}/${key}` `` → `fetch`, with no
encoding and no membership check against the loaded index. The same value also
becomes a path segment in `districtPreSimKey`.

Impact is bounded (the origin is a compile-time constant, React escapes the
value where it is rendered, and the response is Zod-parsed), so this is not a
Critical. It is still an asymmetry worth closing: the Worker validates the very
same value with `DISTRICT_KEY_PATTERN` before it becomes an R2 key, and the
browser does not.

**Fix:** reuse the pattern at the schema boundary —
`district: z.string().regex(/^\d{4}[a-z0-9]+$/).optional().catch(undefined)` — or
gate `enabled` on the key appearing in the loaded index.

## Info

### IN-01: `playoffPoints` reports a ceiling violation as an invalid placement

**File:** `packages/core/districts/bracket.ts:282-285`
`if (value > ceiling) throw new InvalidPlacementError(placement)` produces the
message "placement must be an integer 1 through 8" for a placement that is
valid. The real fault is a weight/ceiling disagreement. Give it its own error
class or message naming `value` and `ceiling`.

### IN-02: `routeBracket` awards an even-`bestOf` tie to the second alliance

**File:** `packages/core/districts/bracket.ts:249`
`const setWinner = winsA > winsB ? allianceA : allianceB;` — with `bestOf: 2`
and a 1-1 split, B wins silently. Unreachable with the current `BRACKET_SETS`
(all 1 or 3), but the table is data and the function is exported. Assert
`set.bestOf % 2 === 1` at the top of the loop.

### IN-03: The draft cursors walk off the end rather than throwing

**File:** `packages/core/districts/ledgerSimulation.ts:748-757`
`while (allied[orderBuffer[captainCursor]!] === 1) captainCursor++;` terminates
on `undefined !== 1` when every team is allied, then returns `undefined` as a
team index and corrupts the draw instead of failing. Guarded today only by the
`teamCount >= allianceCount * 3` check at `:556`. A `captainCursor < teamCount`
bound with a throw costs nothing per draw.

### IN-04: `safeTeamNumber` collapses every malformed key to 0

**File:** `apps/web/src/components/districts/districtLedgerRows.ts:725-731`
Two malformed team keys both become `teamNumber: 0`, which makes the final sort
tiebreak non-deterministic between them, makes them both match a `"0"` search
query, and makes `?drawerTeam=0` ambiguous. Prefer keeping the team key as the
drawer identity.

### IN-05: Small naming/labelling drift

- `apps/worker/src/districtRefresh.ts:113` — `emptyCursor(eventKey: string)` is
  always called with a *cursor* key, not an event key.
- `scripts/publishLiveWindows.ts:187` — the log says
  "carry an explicit null", but `nonDistrictWindowCount` is derived from
  `districtKey != null`, so it also counts entries where the field is absent
  (every pre-phase-10 manifest).
- `apps/web/src/lib/api/districtLedger.ts:74-79` — `districtPreSimQueryOptions`
  carries no generation in its query key, so a generation rollover mid-view can
  serve a cached sidecar against a newer artifact. The `bakedEvents` trim makes
  this mostly self-correcting, but the key is the place to state it.

## Deferred

Four findings and every Info item were left as they are by the 2026-09-25 fix
pass, and are recorded here rather than silently dropped.

| Finding | Why it was deferred |
|---|---|
| WR-03 | `DISTRICT_KEY_PATTERN` used as an event-key validator. A naming/coupling clean-up (declare `EVENT_KEY_PATTERN` beside it); the two key shapes coincide today, so nothing is wrong at runtime. |
| WR-09 | Two documented-as-throwing calls inside render-path `useMemo`s. The fix is an error boundary or an `unavailable` row model — a UI-behaviour change wider than a review fix, and it wants its own decision about what the blank tab should say. |
| WR-10 | `?district=` reaching an artifact URL path unvalidated. Impact is bounded by the reviewer's own account (compile-time origin, React escaping, a Zod-parsed response); closing it is a schema-boundary change to the route's search params. |
| IN-01 through IN-05 | Advisory: an error message naming the wrong fault, an even-`bestOf` tie rule that is unreachable with the current `BRACKET_SETS`, an unbounded draft cursor guarded by an existing roster check, `safeTeamNumber`'s zero collapse, and five small naming/labelling drifts. |

The eight findings above this section are fixed, each as its own commit, with
the hash on that finding's `**Status:**` line.


---

_Reviewed: 2026-09-25T12:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
