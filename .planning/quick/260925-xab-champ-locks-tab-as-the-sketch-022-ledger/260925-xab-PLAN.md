---
quick_id: 260925-xab
date: 2026-09-26
description: >-
  Champ Locks tab as the sketch 022 ledger: District points and DCMP points as
  the two rows per team, champ tier statuses from cmpSlots, the DCMP row
  conditional on the field chance (variant A), and the old ranked table deleted
status: planned
---

# Champ Locks as the sketch 022 ledger — plan

Sketch 022 variant A, in the shipped codebase. The Road to District Champs tab is
the sketch 021 ledger plus thirteen quick tasks of refinement; the Champ Locks tab
beside it is still the pre Phase 10 ranked table. This rebuilds it on the same
machinery, with two rows per team instead of one row per event: **District points**
(the team's district tier events summed per category) and **DCMP points** (the
District Championship's four categories at the 3x weight).

**Untouched, by instruction:** the lock math in `packages/core/districts/locks.ts`,
the tenets, the reservation, the pooled lock, and the Road to District Champs tab's
rendered output. `measure:ledger-tenets` runs at the end: both tenets zero, totals
identical to 260925-pl6.

**Worktrees are OFF** — work happens on the main tree. Run vitest from the **repo
root** (167 files; `apps/web` alone is 77 and an 8 day red CI hid in that gap). The
root `tsc --noEmit` misses `apps/web`, so the web tsconfig runs too. The executor's
sandbox has no network: anything needing the live origin is left for the
orchestrator, and the SUMMARY text is **returned to the orchestrator**, not written.

## What was measured before planning

Run against `data/fixtures/phase10/district-2026pnw.json` with the real
`computeLocksWithQualifiers`, so Task 2's acceptance is a recorded fact rather than
a hope:

- `cmpSlots` 21, 126 teams, one dcmp tier event `2026pncmp` with 51 `eventPoints`
  rows and 0 `remainingEvents` rows.
- Award qualifiers at the champ tier = the 8 teams holding a `qualifyingAwards`
  entry whose `eventKey` is `2026pncmp` and whose `awardType` is in
  `consumingAwardTypesForTier("dcmp")`: `frc2046`, `frc2910`, `frc2811` (awardType
  1, Winner), `frc4450`, `frc4125` (0, Impact), `frc9023`, `frc2635` (9, EI),
  `frc10991` (10, RAS).
- With `pointTotal` as the floor, `maxRemaining` 0, `slots = cmpSlots`, **no
  `reservedSlots` argument and no `pooled` argument**, the recompute reproduces the
  artifact with **zero disagreements**: `{locked: 12, lockedAward: 8, contending: 2,
  eliminated: 104}`, and `cutLinePointsWithQualifiers` returns **182**, the
  artifact's own `insights.cmpCutLinePoints`.
- `pointsSlots` = 21 − 8 = 13 over a 118 team pool. Ranked by point total then team
  number, rank 13 is `frc3674` (182) and rank 14 is `frc9450` (182) — the split the
  sketch shows.

**The fixture carries no `state` blocks and no `bakedEvents`.** Every test that
needs a finished position must pass an explicit all final `stageByEvent` for all
nine event keys; `deriveStageFromState(undefined)` reports every category OPEN, by
design.

## Two decisions this plan takes, both stated so they are visible

**1. In range / Out of range is decided by RANK at the champ tier, not by `>=` the
cut line.** The district tab reports the friendlier side for a team exactly at the
line (`projection >= projectionCutLine`), on `locks.ts`'s tie philosophy. At the
champ tier that would put both 182 point teams In range and 22 teams into 21 slots.
Sketch 022's own acceptance, and requirement 6, is one In range and one Out of
range. So the champ rule is: a pool team is In range when its 1-based position in
the champ ledger's own sorted order, restricted to the pool, is `<= pointsSlots`.
The district tab's rule is not touched. Today's line stays
`cutLinePointsWithQualifiers` semantics, which is the 182 above.

**2. The champ tier reserves nothing and passes no pooled argument.**
`reservedSlots.ts`'s own doc comment scopes the reservation to district tier events
("Pass ONLY district-tier events: the DCMP's own consuming awards are a different
tier with a different slot pool"), and `pooledLockInputs` models district event
point pools. Inventing a champ tier reservation would be a new guarantee rule the
sketch does not ask for and `measureLedgerTenets` does not measure. Both omissions
are what reproduce the artifact exactly above, and both are pinned by a test that
asserts `reservedSlots === 0` with a comment naming this decision. If a champ tier
reservation is ever wanted it is a separate measured task, not a guess here.

## Where the per run field membership would go, if it were needed

It is **not** needed. Requirement 2's "to be there" chance is the per team
**marginal**, which `advancementChances` already returns as `chanceByTeam` — that
map is literally the share of runs in which a team sits inside the points slots,
which is the chance of being in the DCMP field. Requirement 3 pins the DCMP's own
predictions to the shipped per event machinery on the DCMP event artifact's real
roster, so no run needs to be conditioned on a per run field.

If the honest per run conditioning of the DCMP field is ever wanted, the minimal
extension is in `packages/core/districts/advancementChance.ts`: add
`recordMembership?: boolean` to `AdvancementChanceInputs`, and when it is true fill
a `membershipByRun: Uint8Array` of length `draws * pool.length` (row major, 1 where
`atOrAbove[totals[i]] <= lockSlots`) inside the existing per run loop that already
increments `insideRuns`, returning it beside `poolOrder: readonly string[]` on
`AdvancementChanceResult`. Guarded by the flag so the shipped path allocates
nothing. **Do not build this in this task.**

---

## Task 1 — the shipped row builder takes a tier, and the champ ledger's two row model

**Files:** `apps/web/src/components/districts/districtLedgerRows.ts`,
`apps/web/src/components/districts/champLedgerRows.ts` (new),
`apps/web/src/components/districts/champLedgerRows.test.ts` (new)

**Action.**

`districtLedgerRows.ts`, additive and behaviour preserving:

- Extract `districtTierEvents(team)` into `tierEvents(team, tier: DistrictTier)`
  (the same union of `eventPoints` and `remainingEvents` filtered on `row.tier`,
  the same week ordering) and keep `districtTierEvents(team)` as
  `tierEvents(team, "district")`. Export `tierEvents` and the entry interface
  (today's module private `DistrictTierEventEntry`) as
  `DistrictTierEventEntry`.
- `BuildDistrictLedgerRowsOptions` gains `tier?: DistrictTier`, defaulting to
  `"district"`. It drives exactly three things inside `buildDistrictLedgerRows`:
  the event collection (`tierEvents(team, tier)`), the ceilings
  (`maxEventPoints(season, tier)`), and the tier handed to `playoffMilestoneFor`.
  Nothing else moves. `districtLedgerRows.test.ts` must stay green untouched,
  which is the proof the default path is byte for byte what it was.
- `buildDistrictEventSimulationInput` gains `tier?: DistrictTier` on its options,
  defaulting to `"district"`, forwarded to `DistrictLedgerEventInput.tier`.
  Generalise `alliancesAreFinal(alliances, expectedCount)` so the length check is
  against the expected bracket count rather than the literal 8, and pass
  `DEFAULT_DISTRICT_ALLIANCE_COUNT` for the district tier and the published list's
  own length (falling back to `DEFAULT_DISTRICT_ALLIANCE_COUNT`) for the dcmp tier.
  An undivisioned DCMP such as `2026pncmp` runs the eight alliance bracket and
  routes through `routeBracket`; a divisioned DCMP parent whose count
  `divisionedDcmpPlayoffPmf` carries no table for makes `simulateDistrictEvent`
  throw, which the existing per event refusal already renders as an unavailable
  event with the error class named. That degradation is the honest answer and is
  left as is.

`champLedgerRows.ts` (new, PURE — no React import, no call to
`simulateDistrictEvent`, following `districtLedgerRows.ts`'s own discipline):

- `CHAMP_LEDGER_ROWS = ["district", "dcmp"] as const`; `ChampLedgerRowKind`.
- `champCellId(row: ChampLedgerRowKind, cell: DistrictCellKind): string` →
  `"district-row:qual"`, `"dcmp-row:elim"`, `"district-row:subtotal"`,
  `"dcmp-row:subtotal"`. The grand total reuses the shipped `GRAND_TOTAL_CELL_ID`.
  These ids are deliberately disjoint from the district tab's `eventKey:cell` ids,
  so a shared `?drawerCell=` never resolves across tabs.
- `dcmpEventKeyFor(artifact): string | undefined` — the single dcmp tier event key
  in the artifact, from `tierEvents(team, "dcmp")` unioned over teams; `undefined`
  when the district publishes none, which renders the DCMP row's cells as
  `unavailable` rather than blank.
- `champFieldMembership(team, dcmpStarted): "in" | "out" | "open"` — `"in"` when
  the team has a dcmp tier `eventPoints` or `remainingEvents` entry, `"out"`
  otherwise, but only once `dcmpStarted`; before that, `"open"`.
- `mixFieldMembership(total: DistrictPointDistribution, chance: number):
  DistrictPointDistribution` — `chance * total + (1 - chance) * pointMass(0)`,
  normalised, returned in THE one distribution representation. `chance >= 1`
  returns `total` unchanged and `chance <= 0` returns `pointMassDistribution(0)`,
  so the two certain cases allocate nothing and cannot drift by a rounding step.
- `buildChampLedgerRows(options)` — calls the shipped `buildDistrictLedgerRows`
  TWICE over the same `distributions` map and `stageByEvent`, once at
  `tier: "district"` and once at `tier: "dcmp"`, then folds:
  - **District row.** Per category, grey (`kind: "final"`, `earned` = the sum of
    the per event `earned` values) only when that category is final at EVERY
    district tier event the team has; otherwise open, with the distribution
    `convolveDistrictGrandTotal(perEventParts, 0, 0)` over the per event parts,
    where a final part is `pointMassDistribution(earned)` and an open part is the
    cell's own distribution. Any per event cell that is `unavailable` makes the
    aggregate `unavailable`. Ceiling = `maxEventPoints(season, "district")[cat] *
    eventCount`. Subtotal is the same fold over the per event `eventTotal` cells.
  - **DCMP row.** The dcmp pass's single row, verbatim: its four cells (with
    `playoffMilestone` and `selection` carried through) and its `eventTotal` as the
    Subtotal, at `maxEventPoints(season, "dcmp")` ceilings. For a team whose
    membership is `"out"`, every DCMP cell becomes
    `{kind: "notInField"}` — a fourth `ChampLedgerCell` variant that renders the em
    dash. For `"open"`, the cells are the CONDITIONAL distributions exactly as the
    dcmp pass produced them; the chance is folded nowhere but the grand total
    (variant A).
  - **Grand total.** `convolveDistrictGrandTotal([districtSubtotal,
    mixFieldMembership(dcmpSubtotal, chance)], round(rookieBonus),
    round(adjustments))`, where `chance` is 1 for `"in"`, 0 for `"out"`, and the
    supplied field chance for `"open"` (absent chance, for instance while the run
    is in flight, is treated as 1 and DISCLOSED in the gaps as
    `teamsWithoutFieldChance`, never silently as 0 — a silent 0 would erase every
    DCMP point from a bubble team's grand total). `projection` is the continuous
    median, or the earned total for a team with no open category anywhere.
  - Sort descending by `projection`, then by the earned all tier total
    (`team.pointTotal` at a position with nothing reopened), then by team number;
    `position` is the 1-based index, which is the `#` the Team cell prints and what
    Task 2's In range rank rule reads.
  - `champContributions(team)` — the grand total drawer's TWO rows: District points
    and DCMP points, each with `earned | undefined` and `open: PointPercentiles |
    undefined` derived from the same subtotal cells the table renders, plus the
    DCMP row's `fieldChance: number | undefined`.
  - Gaps are the shipped `DistrictLedgerGaps` unioned from the two passes, plus
    `teamsWithoutFieldChance`.

**Verify.** `npx vitest run apps/web/src/components/districts/champLedgerRows.test.ts apps/web/src/components/districts/districtLedgerRows.test.ts`

`champLedgerRows.test.ts` pins, over synthetic artifacts parsed through the real
`DistrictArtifactSchema` plus one pass over `data/fixtures/phase10/district-2026pnw.json`:
the district row cell is grey only when the category is final at every district tier
event and blue with the convolved distribution otherwise; the district row's four
category sums plus the rookie bonus equal the district subtotal's own support;
`mixFieldMembership` at 1 and at 0 returns the total and the point mass unchanged
and at 0.5 puts exactly half the mass at zero; the mixture grand total's median sits
between the district only and the fully folded totals for a bubble team; membership
is `"in"` for all 51 `2026pncmp` teams and `"out"` for the other 75 once started,
and `"open"` for all 126 before.

**Done.** `buildDistrictLedgerRows` takes a tier with the district default
unchanged; `buildChampLedgerRows` returns two rows and one grand total per team with
every cell kind reachable; the district row builder's own suite is green untouched.

**Commit:** `feat(260925-xab): the champ ledger's two row model`

---

## Task 2 — champ tier statuses from cmpSlots and the DCMP award qualifiers

**Files:** `apps/web/src/components/districts/champLedgerStatus.ts` (new),
`apps/web/src/components/districts/champLedgerStatus.test.ts` (new)

**Action.** `computeChampLedgerStatuses({artifact, teams})`, mirroring
`districtLedgerStatus.ts`'s shape and defining no lock rule of its own:

- **Floor** is `source.pointTotal` minus the earned points of every category still
  OPEN at the position, across BOTH tiers — never a re-sum, for the reason
  `districtLedgerStatus.ts` states (the rookie bonus and adjustments live inside
  `pointTotal`). At a position where nothing is reopened the floor is exactly
  `pointTotal`, which is what reproduces the artifact.
- **Ceiling** is the floor plus each open category's own tier ceiling:
  `maxEventPoints(year, "district")` for the district row's open categories,
  counted once per district tier event, and `maxEventPoints(year, "dcmp")` for the
  DCMP row's. A team whose membership is `"out"` contributes NO dcmp ceiling.
- **Award qualifiers**: a team whose `qualifyingAwards` carries an entry whose
  `eventKey` is the dcmp event and whose `awardType` is in
  `consumingAwardTypesForTier("dcmp")`, gated on the category being final at the
  position — `awardType` 1 (Winner) requires the DCMP's `elim` final, and 0/9/10
  require its `award` final. A slider position that reopens either un-awards it in
  the same step, exactly as the district rule does.
- **`awardKind`**: `"winner"` when the entry's `awardType` is `AWARD_TYPE_WINNER`,
  else `"award"` — the chip reads `Locked · winner` or `Locked · award`.
- **Prequalified**: `source.champLock.status === "prequalified"`, per requirement 4.
- `computeLocksWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers)` — three
  arguments, no reservation and no pooled argument; see the decision above.
  `cutLinePointsWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers)` is
  **Today's line**.
- **In range / Out of range by rank**: build the pool order as the champ ledger's
  own sorted team order filtered to the pool (neither award qualified nor
  prequalified); a `contending` verdict at 1-based pool rank `<= pointsSlots` is In
  range, otherwise Out of range, where `pointsSlots` comes from
  `pointsRaceSlots(poolKeys, cmpSlots, qualifiers, 0).pointsSlots` — `locks.ts`'s
  own exported narrowing, never a hand rolled subtraction.
- The model exposes `byTeam`, `counts` (the five chip counts over the WHOLE
  district), `verdictCensus`, `todaysLine`, `awardQualified`, `prequalified`,
  `reservedSlots` (always 0, with the decision named in a comment), and
  `pointsSlots`. Reuse `DISTRICT_LEDGER_STATUS_KEYS` and the five shipped labels
  and definitions; the champ tier adds only the `Locked · winner` variant.

**Verify.** `npx vitest run apps/web/src/components/districts/champLedgerStatus.test.ts`

Pinned against `data/fixtures/phase10/district-2026pnw.json` at a position where
every category of all nine events is final (supply the all final `stageByEvent`
explicitly — the fixture has no `state` blocks):

- `verdictCensus` is `{locked: 12, lockedAward: 8, contending: 2, eliminated: 104,
  prequalified: 0, unknown: 0}`, equal to the artifact's own `champLock` census,
  with zero per team disagreements.
- Of the 8 `lockedAward`, exactly 3 carry `awardKind === "winner"` (`frc2046`,
  `frc2910`, `frc2811`) and 5 carry `"award"`.
- `counts.lockedOut` is 104; `counts.locked` is 20 (the chip merges `locked` and
  `lockedAward`) and is NOT `insights.champLockedCount` (12).
- `todaysLine` is 182, equal to `insights.cmpCutLinePoints`.
- `frc3674` (182) is `inRange` at pool rank 13 and `frc9450` (182) is `outOfRange`
  at pool rank 14 — the tie split, asserted by name.
- `reservedSlots` is 0 and `pointsSlots` is 13.

**Done.** The champ tier's five statuses, the award kind and Today's line all
recompute from `locks.ts` and reproduce the shipped artifact exactly.

**Commit:** `feat(260925-xab): champ tier statuses from cmpSlots and the DCMP award qualifiers`

---

## Task 3 — the DCMP joins the fetch, the timeline and the two chance runs

**Files:** `apps/web/src/components/districts/useDistrictLedgerData.ts`,
`apps/web/src/components/districts/champLedgerChances.ts` (new),
`apps/web/src/components/districts/champLedgerChances.test.ts` (new),
`apps/web/src/components/districts/useDistrictLedgerData.test.ts`

**Action.**

`useDistrictLedgerData.ts` — two additive options, both defaulting to today's
behaviour:

- `allowedEventKeys?: readonly string[]`, defaulting to
  `allDistrictTierEventKeys(artifact)`, used as the `bakedEvents` filter. The champ
  tab passes the district tier keys **plus** the dcmp event key, so an unstarted
  DCMP's baked sidecar is fetched. `scripts/publishDistricts.ts` already bakes dcmp
  tier candidates (`tier: districtTierForEventType(event.eventType)`), so the
  sidecar exists and `bakedEvents` already lists it — no publisher change.
- `tierByEvent?: ReadonlyMap<string, DistrictTier>`, consulted when assembling each
  event's `buildDistrictEventSimulationInput` call and defaulting to `"district"`.
  The dcmp event is therefore simulated with the 3x ceilings by the same code path
  as any district event, in the same Worker, in the same run, under one signature.

No timeline change is needed: `buildDistrictTimeline` is already tier agnostic and
takes an `events` list, and `districtStageAtPosition` seeds from whatever keys
`nowStageByEvent` carries. The champ tab passes district tier events **and** the
DCMP, so the rail's steps run through the DCMP's matches and its four stage steps
and every DCMP stage rewinds exactly as a district event's does. Pin that with one
test in `districtTimeline.test.ts` if the existing coverage does not already imply
it (a dcmp keyed event contributes its four stage steps in week order).

`champLedgerChances.ts` (new, pure):

- `districtFieldMembershipChances(rawChanceByTeam, districtStatuses)` — the "to be
  there" chance per team, widened from the district tier run's marginal by the
  district tier VERDICTS: 1 for `locked`/`prequalified`, 0 for `lockedOut`, the
  marginal for `inRange`/`outOfRange`, and `undefined` for a team the run did not
  rank (disclosed, never guessed). This is the one and only new consumer of the
  shipped run; no second estimator, no core change — see the note above.
- `buildChampAdvancementChanceRun(options)` — the SECOND
  `AdvancementChanceInputs`, over each team's CHAMP grand total (the mixture)
  against `artifact.cmpSlots`, with the champ status model's `awardQualified` and
  `prequalified` and `reservedSlots: 0`. It reuses
  `buildAdvancementChanceRun`'s own three refusals verbatim by importing them where
  it can and restating only the capacity it reads (`cmpSlots`, not `dcmpSlots`).
  Its signature composition mirrors `chanceSignature` and adds the dcmp event key
  and the per team field chance, so a moving field chance re-runs it.
- `reconcileChampAdvancementChances(chanceByTeam, champStatuses)` — the shipped
  narrowing: a chance prints under In range and Out of range alone, a disagreement
  with a guarantee is counted in `gaps` and never printed.

Both runs go through the shipped `useDistrictAdvancementChance` hook, called twice
in the tab (once per run). The hook is keyed on the run's signature and constructs
its own Worker per run, so no hook change is needed.

**Verify.** `npx vitest run apps/web/src/components/districts/champLedgerChances.test.ts apps/web/src/components/districts/useDistrictLedgerData.test.ts apps/web/src/components/districts/districtTimeline.test.ts`

Pin: a district `locked` team reads a field chance of exactly 1 and a `lockedOut`
team exactly 0, whatever the raw run said; a team absent from the raw run is
`undefined`, not 0; `buildChampAdvancementChanceRun` refuses a null `cmpSlots`, a
field with nothing open and a run still in flight; the champ signature moves when
the field chance moves and when the dcmp event key changes; and the default
`useDistrictLedgerData` path with neither new option is byte for byte today's
(assert the assembled `districtRunSignature` is unchanged for the shipped fixture).

**Done.** The DCMP event is fetched, baked or simulated at the dcmp tier alongside
the district ones under one run signature; the rewind rail runs through it; and both
chance runs are assembled and reconciled by pure, tested functions.

**Commit:** `feat(260925-xab): the DCMP joins the fetch, the timeline and the chance runs`

---

## Task 4 — extract the shipped ledger's presentational parts, unchanged

**Files:** `apps/web/src/components/districts/LedgerParts.tsx` (new),
`apps/web/src/components/districts/DistrictLedger.tsx`

**Action.** A mechanical extraction, no behaviour change. Move out of
`DistrictLedger.tsx` and into `LedgerParts.tsx`, exported: the class constants
(`FINAL_CELL_CLASS`, `OPEN_CELL_CLASS`, `OPEN_CELL_BOLD_CLASS`,
`OPEN_CELL_SMALL_CLASS`, `UNAVAILABLE_CELL_CLASS`, `TEAM_CELL_CLASS`,
`REWIND_INPUT_ID`, `REWIND_COMMIT_DELAY_MS`, `TICK_MIN_GAP_PERCENT`),
`statusChipClass`, `StatusCell`, `StatusChips`, `CellKey`, `stageWord`,
`likelyRangeText`, `chanceWordsFor`, `openCellLines`, `CellInteraction`,
`LedgerCell`, `TeamCell`, `prefersReducedMotion`, `bandLabel`, `DrawerCellPane`,
`GrandTotalPlot`, `RewindSlider`, `timelineTicks`, `ControlsCard`,
`DistrictLedgerNavigate` and `GrandTotalContent`. `DistrictLedger.tsx` imports
them; `DrawerRow`, `DistrictContributionList`, `EventCell` and
`DistrictLedgerContent` stay where they are.

Two parameterizations, both with the district default:

- `StatusCell` gains `awardLabel?: string`, used instead of
  `DISTRICT_LEDGER_LOCKED_AWARD_LABEL` when supplied. Absent keeps today's string.
- `DrawerCellPane` gains `tier?: DistrictTier` defaulting to `"district"`, passed
  through to `districtPlayoffOutcomes` and `districtAwardOutcomes` in place of
  today's two `"district"` literals.

Keep every `data-testid`, every class string and every text-role class as a plain
string (never through `cn()` — the recorded tailwind-merge trap eats
`text-role-label` beside a `text-[var(...)]`).

**Verify.** `npx vitest run apps/web/src/components/districts/DistrictLedger.test.tsx`
— the 1958 line suite passes **untouched**, which is the proof the Road to District
Champs tab's rendered output did not move. Then `npx tsc --noEmit -p apps/web/tsconfig.json`.

**Done.** `LedgerParts.tsx` holds the shared components; `DistrictLedger.tsx`
renders identically and its suite is green with no edits to the test file.

**Commit:** `feat(260925-xab): extract the ledger's shared presentational parts`

---

## Task 5 — the Champ Locks tab renders the two row ledger

**Files:** `apps/web/src/components/districts/ChampLocksLedger.tsx` (new),
`apps/web/src/components/districts/ChampLocksLedger.test.tsx` (new),
`apps/web/src/components/districts/districtLedgerCopy.ts`,
`apps/web/src/components/districts/districtLedgerCopy.test.ts`,
`apps/web/src/routes/districts.tsx`

**Action.**

New strings, all in `districtLedgerCopy.ts` (every string on this tab lives there,
and `districtLedgerCopy.test.ts` pins each one):

- `CHAMP_LEDGER_TAB_LABEL = "Champ Locks"`.
- `CHAMP_LEDGER_COLUMN_LABELS = ["Team", "Status", "Grand total", "Source",
  "Subtotal", "Qualification", "Alliance selection", "Playoffs", "Awards"]`.
- `CHAMP_LEDGER_ROW_LABELS = {district: "District points", dcmp: "DCMP points"}`.
- `CHAMP_LEDGER_LOCKED_WINNER_LABEL = "Locked · winner"` (the district tier's
  `DISTRICT_LEDGER_LOCKED_AWARD_LABEL` covers the judged case unchanged).
- `CHAMP_LEDGER_NOT_IN_FIELD_LINE = "not in the field"` and
  `CHAMP_LEDGER_NOT_IN_FIELD_CELL`, the em dash, built from its codepoint so the
  source file never types the glyph.
- `champLedgerFieldChanceLine(chance)` → `"~62% to be there"`, clamped by the SAME
  `DISTRICT_LEDGER_CHANCE_CEILING_PERCENT` / `DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT`
  pair, with `"<5% to be there"` below the floor. The tilde is mandatory: every
  blue figure on this site carries it.
- `champLedgerDistrictSourceLine(entries)` → the district row's small line, one
  `"{short name} Wk {week + 1} · {stage word}"` per event joined by `" · "`, using
  `districtLedgerShortEventName` and `DISTRICT_LEDGER_STAGE_WORDS` and one based
  weeks (260925-opv).
- `CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS` and
  `champLedgerContributionChanceNote(chance)` for the grand total drawer's two row
  list.

`ChampLocksLedger.tsx` — `DistrictLedger.tsx`'s `DistrictLedgerContent` structure,
with the row loop replaced:

- Same `ErrorBoundary` wrapper, same `useSearch({strict: false})` cast for
  `at`/`drawerTeam`/`drawerCell`, same navigate handlers (`replace: true`,
  `resetScroll: false` — scroll position is kept on navigation), same
  `ControlsCard` + `RewindSlider` + `StatusChips` + caveat and provenance
  paragraph, same `data-card` overflow wrapper and `Table`.
- Event list = district tier events **plus** the dcmp event; `activeEventKeys` and
  `startedKeys` derived over both tiers; `useDistrictEventArtifacts`,
  `buildDistrictTimeline`, `districtStageAtPosition`, `startMatchKeyAtPosition` and
  `useDistrictLedgerData` all as the district tab does, with Task 3's two new
  options supplied.
- `buildChampLedgerRows` → `computeDistrictLedgerStatuses` (district tier, for the
  field chance) → the district chance run → `districtFieldMembershipChances` → the
  champ rows rebuilt with the chances folded into the grand total →
  `computeChampLedgerStatuses` → `buildChampAdvancementChanceRun` → the champ chance
  line. Order the memos so each reads only what is already resolved; the field
  chance feeds the grand total and the grand total feeds the champ chance, never
  the reverse.
- Two `TableRow`s per team. The first carries `TeamCell`, `StatusCell`
  (`rowSpan={2}`, `awardLabel` = `CHAMP_LEDGER_LOCKED_WINNER_LABEL` when
  `awardKind === "winner"`), the grand total cell (`rowSpan={2}`, rendered with
  `GrandTotalContent`), then the Source cell, the Subtotal and the four categories.
  The second carries the DCMP row's Source cell, Subtotal and four categories.
  `data-testid="champ-ledger-row"`, `data-team`, `data-row={"district"|"dcmp"}`,
  and the shipped `district-ledger-row--team-start` / `--team-inner` classes so the
  solid rule between teams and the dashed rule between a team's two rows are the
  shipped hairlines.
- A `notInField` cell renders `CHAMP_LEDGER_NOT_IN_FIELD_CELL` inside the
  `UNAVAILABLE_CELL_CLASS` span with `data-cell="not-in-field"` — colour is never
  the only encoding, so the em dash and the `data-cell` value both say it.
- The stat line prints `DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLine` with the champ
  status model's `todaysLine` (not `districtLedgerStatLine`, which does not narrow
  the pool by award qualifiers and would print a different number from the
  artifact's own 182).

`routes/districts.tsx`: `renderChampLocksContent` renders `<ChampLocksLedger ... />`
in place of `<DistrictLocksTab ... />`; the `champ-locks` tab id, the
`champ-locks-panel` test id and the trigger label are unchanged.

**Verify.** `npx vitest run apps/web/src/components/districts/ChampLocksLedger.test.tsx apps/web/src/components/districts/districtLedgerCopy.test.ts`

`ChampLocksLedger.test.tsx` follows `DistrictLedger.test.tsx`'s harness exactly
(self contained router tree with a `/team/$teamNumber` route, a
`QueryClientProvider`, and `installMockWorker({script: runDistrictWorkerJob})` so
every message crosses a real `structuredClone`). It pins: the nine column labels in
order; two rows per team with the row labels and the district row's source line
carrying each event's short name, one based week and stage word; the Status and
Grand total cells spanning both rows; a `Locked · winner` chip for a DCMP winning
alliance team and `Locked · award` for a judged one; a team outside the field
rendering the em dash in all four DCMP cells with `not in the field` under the row
label; a conditional DCMP row carrying `~N% to be there` on the label while the
field is open; and the forbidden plus minus codepoint appearing nowhere in the
rendered tree.

**Done.** `?tab=champ-locks` renders the two row ledger with statuses, chips,
definitions, cell key, rewind slider and stat line; the old table is still on disk
but no longer reachable.

**Commit:** `feat(260925-xab): the Champ Locks tab renders the two row ledger`

---

## Task 6 — the drawer: DCMP outcome lists and the two row contribution list

**Files:** `apps/web/src/components/districts/ChampLocksLedger.tsx`,
`apps/web/src/components/districts/ChampLocksLedger.test.tsx`,
`apps/web/src/components/districts/districtLedgerOutcomes.ts`,
`apps/web/src/components/districts/districtLedgerOutcomes.test.ts`

**Action.** A `ChampDrawerRow` in `ChampLocksLedger.tsx`, built from Task 4's
extracted panes:

- **The DCMP row's cells get the outcome lists.** `DrawerCellPane` is called with
  `tier="dcmp"`, so `districtPlayoffOutcomes` and `districtAwardOutcomes` price
  Wins the event / Finalist / Third place / Fourth place and Impact / Rookie All
  Star / One judged award / No award at the 3x weight, and the Alliance selection
  list renders whenever the run reported its routes (Captain / First pick / Second
  pick / Not selected). A veteran's Rookie All Star row is omitted; a stacked award
  never appears. The thin 64px mark and the two column chance/points header come
  from the shipped `DistrictOutcomeList` unchanged.
- **The District points row's lumpy cells keep the histogram.** They are sums over
  more than one event, so no named outcome covers their support;
  `districtCellRendersOutcomeList` is not consulted for them and the shipped
  histogram pane renders instead. Add one sentence to that function's doc comment
  saying so, since it now has a second caller.
- **The grand total drawer** draws its plot ONCE (`GrandTotalPlot`, with Today's
  line dashed on it at the champ `todaysLine`) beside a two row contribution list —
  District points and DCMP points — where the DCMP row additionally prints
  `champLedgerContributionChanceNote(chance)`, the field chance it is weighted by.
  A `ChampContributionList` local to this file, shaped on
  `DistrictContributionList` (same `district-ledger-contributions` table classes,
  same `settled` / `none yet` cell forms, same `~median` plus `likely a–b` range
  with the en dash and never a plus minus).
- The drawer opens from the two typed search params exactly as the district tab's
  does; an unknown team or cell id resolves to CLOSED, never to a neighbouring cell.

**Verify.** `npx vitest run apps/web/src/components/districts/ChampLocksLedger.test.tsx apps/web/src/components/districts/districtLedgerOutcomes.test.ts`

Pin: clicking a DCMP Playoffs cell renders the four shipped playoff labels with the
dcmp point values (21/39/60/90 for 2026) and no histogram; clicking a DCMP Awards
cell renders the award labels at the dcmp weight with a veteran's Rookie All Star
row omitted; clicking a District points Playoffs cell renders the histogram and NOT
an outcome list; clicking the grand total renders exactly one
`district-ledger-drawer-grand-plot` plus a two row contribution list whose DCMP row
carries the field chance note.

**Done.** Every shipped drawer refinement is present at the champ tier, with the
outcome lists on the single event row and the histogram on the summed one.

**Commit:** `feat(260925-xab): the champ ledger drawer lists the DCMP outcomes`

---

## Task 7 — delete the pre Phase 10 champ table

**Files:** deleted — `apps/web/src/components/districts/DistrictLocksTab.tsx`,
`apps/web/src/components/districts/DistrictLocksTab.test.tsx`,
`apps/web/src/components/districts/districtLocksHeaderStats.ts`,
`apps/web/src/components/districts/districtLocksHeaderStats.test.ts`; edited —
`apps/web/src/routes/districts.test.tsx`,
`apps/web/e2e/districts-ledger.spec.ts`,
`apps/web/src/components/districts/districtLedgerCopy.ts`,
`apps/web/src/components/districts/DistrictLedger.test.tsx`

**Action.** Delete the four files. Then:

- `routes/districts.test.tsx`: the `?tab=champ-locks` deep link test currently
  asserts `champ-locks-header-stats` and `district-champ-locks-column-toggle`
  (lines ~181 to 198). Repoint it at the new tab's root test id and at a
  `champ-ledger-row`, keeping the deep link, the hidden sibling panel assertion and
  the `?tab=district-locks` pre rename fallback exactly as they are.
- `apps/web/e2e/districts-ledger.spec.ts`: drop `champHeaderStatRow`,
  `champColumnToggle` and `champTab` from `TEST_IDS` and rewrite the "the Champ
  Locks panel still renders the shipped champ table" test as a positive assertion
  on the new tab's root, its controls card, its status chips and a
  `champ-ledger-row`. Keep every transcribed test id comment naming the file and
  line it was grepped from, as that file's own convention requires. The e2e suite
  is live only and is NOT run by the executor (no network in the sandbox) — the
  orchestrator runs it after deploy.
- Two stale source comments now name a deleted file: `districtLedgerCopy.ts:397`
  ("Declared here rather than imported from `DistrictLocksTab.tsx`") and
  `DistrictLedger.test.tsx:6` (the `TestHarness` technique attribution). Reword
  both to name `ChampLocksLedger.tsx` / `LedgerParts.tsx`. Changing that one comment
  is the only edit `DistrictLedger.test.tsx` takes; its assertions stay untouched.
- `grep -rn "DistrictLocksTab\|districtLocksHeaderStats\|computeChampLocksHeaderStats\|DistrictEventTier" apps packages scripts` must come back empty except for this
  plan and the SUMMARY.

**Verify.** `npx vitest run` from the repo root, then
`npx tsc --noEmit -p apps/web/tsconfig.e2e.json`.

**Done.** The old ranked table, its header stats module and both test files are
gone; nothing imports them; the route test and the e2e spec target the new tab.

**Commit:** `feat(260925-xab): delete the pre phase 10 champ locks table`

---

## Task 8 — methodology, verification, screenshots

**Files:** `apps/web/src/components/methodology/districtLedgerContent.ts`

**Action.** One paragraph appended to the existing `how-district-points-work`
section's `paragraphs` array, stating what the Champ Locks tab predicts. **No new
section id** — `DISTRICT_LEDGER_SECTION_IDS` is pinned by equality against a hand
typed list and a new id would need both updated; a paragraph inside an existing
section needs neither.

Constraints the voice gate enforces at runtime over the string value: flat third
person, at most three sentences, and **no hyphen minus, no en dash, no em dash and
no plus minus character anywhere in it** (the gate bans all four, hyphen minus
included). Carry no numeral that is not already in `REQUIRED_FIGURES`, so the
figures pin does not need touching. Substance: the tab predicts each team's finish
in the race for the district's FIRST Championship slots, adding the District
Championship's own four categories to the district season total; before the
championship field is set, the championship row shows what a team would earn if it
is there and only the grand total folds in the chance of being there.

Jacob may want to edit the copy himself; name the file in the SUMMARY.

**Verify** (executor, in this order, all from the repo root):

1. `npx vitest run` — the whole suite, 167 files, green. Read the output, not the
   exit code (`timeout` plus `pnpm` swallows output and exits 0 on this machine).
2. `npx tsc --noEmit`
3. `npx tsc --noEmit -p apps/web/tsconfig.json`
4. `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`
5. `npx tsc --noEmit -p apps/worker/tsconfig.json`
6. `npx tsx scripts/measureLedgerTenets.ts` — both tenets zero and every total
   identical to 260925-pl6's recorded census. This task touches no district tier
   rule, so any movement here is a regression, not a result.

**Verify** (orchestrator, needs network and a browser): the local visual
verification recipe — kill any stale `:4173` listener, `VITE_ARTIFACT_ORIGIN=http://localhost:4173`,
verify the server by CONTENT and not by status — then a screenshot pass at 1440 and
390 on `?tab=champ-locks` at three positions: `now`, the position one step after the
DCMP's `qualsDone` step, and a district season position (a `week-2` or `week-3` jump
chip) where the DCMP row is conditional and carries its "to be there" line. If the
deployed artifact predates Phase 10's `state` blocks the grey numbers will be absent
and the cells will read open or not available; that is the honest render, and it
belongs in the SUMMARY as an observation rather than being treated as a defect.

**Done.** The methodology page states what the tab predicts and passes the voice
gate; the suite, the four typechecks and the tenets sweep are all green; the three
positions are captured at both widths.

**Commit:** `docs(260925-xab): the methodology page states what Champ Locks predicts`

---

## Requirement coverage

| Req | Where it lands |
|-----|----------------|
| R1 two rows, cell colours, source line, column order | Tasks 1 and 5 |
| R2 variant A, the mixture grand total, the field chance, membership as a fact | Tasks 1, 3 and 5 |
| R3 DCMP predictions from the shipped per event machinery, the rewind through the DCMP | Task 3 |
| R4 champ tier statuses, `cmpSlots`, the qualifier pool, `Locked · winner`, Today's line, the chance band, prequalified | Task 2 (rule) and Task 5 (chip) |
| R5 every shipped refinement copied, reuse by extraction, the Road tab unchanged | Tasks 4, 5 and 6 |
| R6 pure function tests, component tests, the route test, the deletions, the e2e ids | Tasks 1, 2, 3, 5, 6 and 7 |
| R7 root vitest, four typechecks, the tenets sweep, screenshots at three positions | Task 8 |
| R8 the methodology paragraph | Task 8 |
