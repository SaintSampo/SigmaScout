---
review: 260902-post-phase08-ungoverned-ui
reviewed: 2026-09-02T00:00:00Z
depth: quick
scope: ungoverned UI work outside the phase structure
range: 84c17751..HEAD
waiver: 09a81d1f (UI reviews 05/06/08 waived by user decision)
files_in_range: 62
files_reviewed: 26
files_reviewed_list:
  - apps/web/src/routes/index.tsx
  - apps/web/src/routes/__root.tsx
  - apps/web/src/routes/events.tsx
  - apps/web/src/routes/teams.tsx
  - apps/web/src/lib/homePodium.ts
  - apps/web/src/lib/breakpoints.ts
  - apps/web/src/lib/compareTie.ts
  - apps/web/src/lib/districtNames.ts
  - apps/web/src/lib/eventDates.ts
  - apps/web/src/lib/officialSnapshot.ts
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/simAxis.ts
  - apps/web/src/lib/teamKey.ts
  - apps/web/src/lib/metricKeys.ts
  - apps/web/src/components/MetricValue.tsx
  - apps/web/src/components/compare/calibrationSeries.ts
  - apps/web/src/components/compare/calibrationCards.ts
  - apps/web/src/components/compare/CalibrationSection.tsx
  - apps/web/src/components/events-list/filterModel.ts
  - apps/web/src/components/events-list/EventFilters.tsx
  - apps/web/src/components/events-list/EventsList.tsx
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/StartMatchPicker.tsx
  - apps/web/src/components/team/MatchTable.tsx
  - apps/web/src/components/team/SeasonHeader.tsx
  - apps/web/src/components/team/MetricHistoryChart.tsx
  - apps/web/src/components/teams-table/rowModel.ts
  - apps/web/src/components/teams-table/columns.tsx
  - apps/web/src/components/search/SearchBox.tsx
findings:
  critical: 2
  warning: 8
  info: 5
  total: 15
status: issues_found
---

# Post-Phase-08 Ungoverned UI: Code Review Report

**Reviewed:** 2026-09-02
**Depth:** quick
**Range:** `84c17751..HEAD` (everything after Phase 08 closed its UAT on 2026-08-31)
**Status:** issues_found

## What this reviews, and why it exists

This report covers UI work that shipped **outside the GSD phase structure** — no plan, no
UI-SPEC, no code review. Commit `09a81d1f` records the user's explicit waiver of UI reviews
05/06/08; everything reviewed here landed after that waiver and after Phase 08's own
`08-REVIEW.md` was closed in `5c0487c6`. This document does not touch, supersede, or restate
Phase 08's review record.

**In scope:** the Pine redesign, the new home page (`homePodium.ts` + proof-first hero +
podium + footer), the Calibration rebuild to sketch 006-C, the filter corrections, cross-page
links, W/L/T chips, and `breakpoints.ts`.

**Out of scope and not reported on:** `packages/core/algorithms/**`, `packages/harness/**`,
`packages/corpus/**`, and everything from quick tasks `260901-is2`, `260901-trz`,
`260902-varopr` (which accounts for `apps/worker/src/scheduled.ts`, `docs/models/*`, and all
four `scripts/*.ts` files in the range). The `2bd90304` responsive revert is treated as
intentional, per instruction.

## Summary

The pure model modules are in better shape than the components that consume them.
`rowModel.ts`, `compareTie.ts`, `teamKey.ts`, `eventDates.ts`, `calibrationCards.ts`,
`MetricValue.tsx` and `breakpoints.ts` are **clean** — I traced their boundary cases (zero-match
records, missing metric keys, null spreads, degenerate rosters, timezone shift) and found
nothing to report. `districtNames.ts` is also clean: I enumerated the live district keys across
2022–2026 and all fifteen map correctly, including the `chs`/`fch` pair that looks like a
duplicate but is two genuine TBA keys.

The defects cluster in three places:

1. **The home page** — the single most user-facing artifact in the project, built entirely
   ungoverned — has a render-time throw that its own doc comment promises cannot happen, and a
   caption that asserts a fact the pooling arithmetic does not guarantee.
2. **Disclosure of approximation.** `a72b22f6` removed the visible `≈` marker and left the
   disclosure on `title`/`aria-label`. The `aria-label` is on a bare `<span>`, where ARIA
   prohibits it — so on the honest-uncertainty site, the one remaining disclosure of a knowingly
   approximate tier reaches no assistive-technology user and no touch user at all.
3. **The week 1-indexing correction**, which is right for real season weeks and wrong for TBA's
   out-of-band ones. Verified against live 2026 data: three real, official, 200-match Israeli
   district events render as "Week 17/18/19".

Two findings I checked and am **not** reporting, so the absence is on record: the grouped
Teams view's `hasGroupedTeamsView` predicate is algorithm-only for a fact that is
per-season, but I fetched all five published VPR teams artifacts and `phaseAuto`/`phaseTeleop`/
`phaseEndgame` are present in every one, so the assumption currently holds. And `weekMatches`'s
numeric branch can in principle admit a Championship event; I checked live 2024–2026 events and
every champs and offseason row carries `week: null`, so it cannot fire today.

---

## Critical Issues

### CR-01: The home page throws during render on a data condition its own helper is written to throw on

**File:** `apps/web/src/routes/index.tsx:62-64`, `apps/web/src/lib/homePodium.ts:44,49`

**Issue:** `Podium()` guards only the *query* failure path:

```tsx
if (failed) return null;
const podium = pooledAccuracyPodium(results.map((r) => r.data!));
```

`pooledAccuracyPodium` is deliberately written to `throw` — twice, on a missing `combined`
slice and on a zero `scoredCount` — with the stated rationale "a malformed input must fail
loudly, not render a silently wrong podium." That throw happens **inside a React render**,
downstream of the only guard. There is no error boundary anywhere above it: the sole
`ErrorBoundary` in the whole app wraps the metric-history chart (`MetricHistoryTab.tsx:65`),
and neither `__root.tsx` nor `/` declares an `errorComponent`.

The file's own header comment (lines 10-13) states the opposite contract: *"the podium area
holds a fixed-height skeleton while pending and simply hides on error (the front door never
shows a page-level failure for a decorative proof block)."* That contract is only honoured for
fetch errors. A well-formed HTTP 200 carrying an artifact whose combined slice is absent for one
algorithm — exactly the drift a republish can introduce — takes the throw path instead.

**What a user sees:** the site's front door replaced by a router-level error surface (or a blank
tree) instead of the hero, search box and CTAs, because a *decorative* proof block could not be
computed. The lower-severity related case is `podium[1]!`/`podium[2]!` on lines 67-69, which
index positions 1 and 2 unconditionally while the source array's length is
`PUBLISHED_ALGORITHM_IDS.length`; a fourth or second algorithm changes that from a crash-free
render to a crash or a dropped entry with no compile error.

**Fix:** derive inside a `try`, and honour the stated contract:

```tsx
if (failed) return null;

let podium: PodiumEntry[];
try {
  podium = pooledAccuracyPodium(results.map((r) => r.data!));
} catch {
  // The stated contract: the front door never shows a page-level failure for
  // a decorative proof block. Compare is the canonical home of these numbers.
  return null;
}
if (podium.length < 3) return null;
```

Keep the throws in `homePodium.ts` — they are correct for the Compare page and for tests. The
bug is the unguarded call site, not the loud helper.

---

### CR-02: The alliance approximate-tier disclosure reaches no screen-reader user

**File:** `apps/web/src/components/event/AlliancesTab.tsx:400-408`

**Issue:** `a72b22f6` removed the visible `≈` marker, leaving `title` + `aria-label` as the only
disclosure that a Combined Total's rarity tier is a 3x heuristic estimate rather than a
published percentile. The attributes are placed on a bare `<span>`:

```tsx
<span
  className="flex items-center gap-[var(--spacing-xs)]"
  title={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
  aria-label={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
>
  <MetricValue metric={metric} tier={approx?.tier} />
</span>
```

A `<span>` with no `role` maps to `role="generic"`, and `aria-label` is a **prohibited**
attribute on `generic` under ARIA 1.2 / ARIA-in-HTML. Browsers do not expose it in the
accessibility tree. The `title` fallback covers mouse hover only — it is unreachable on touch,
which is the dominant device at an FRC event.

The code comment claims this "mirrors `BonusRpDots.tsx`'s own title+aria-label pairing." It does
not: `BonusRpDots.tsx:58` supplies `role="group"` alongside its `aria-label`, which is precisely
what makes that label expose. This one omits the role.

**What a user sees:** a tier box — Rare / Epic / Legendary, the site's loudest visual claim
about a number — rendered over a value whose tier is knowingly approximate, with **no** disclosure
of that approximation on any touch device and none at all in a screen reader. On a project whose
core value is honest uncertainty, this is the approximation shipping undisclosed.

**Fix:** give the wrapper a role so the label is legal and exposed.

```tsx
<span
  role={boxed ? "group" : undefined}
  className="flex items-center gap-[var(--spacing-xs)]"
  title={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
  aria-label={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
>
```

Because `title` is still hover-only, also consider a visually-hidden text node inside the cell
(`<span className="sr-only">{ALLIANCE_APPROX_TIER_DISCLOSURE}</span>`) so the disclosure survives
independently of ARIA labelling rules — the same "unconditional page content, never behind a
disclosure" discipline `ALLIANCES_INDEPENDENCE_CAVEAT` already applies two elements below.

---

## Warnings

### WR-01: The week +1 is applied to TBA's out-of-band week values, mislabelling real official events

**Files:** `apps/web/src/components/events-list/filterModel.ts:71-87`,
`apps/web/src/components/events-list/EventFilters.tsx:40`,
`apps/web/src/components/events-list/EventsList.tsx:128`

**Issue:** `weekFilterLabel` and `TypeChip` both render `Week ${week + 1}` for any numeric week.
`filterOptions` sorts weeks above 8 to the bottom of the dropdown rather than excluding them.
TBA does not use `week` purely as a 0-indexed season week — it also carries out-of-band values
for districts running their own calendar.

Verified against the live `v1/events/2026/vpr@2.1.0+tuned-2026-08.json`:

| eventKey    | raw `week` | eventType | played | rendered label | actual event |
|-------------|-----------|-----------|--------|----------------|--------------|
| `2026isde1` | 16        | 1         | 69     | **Week 17**    | ISR District Event #1 |
| `2026isde2` | 17        | 1         | 64     | **Week 18**    | ISR District Event #2 |
| `2026iscmp` | 18        | 2         | 75     | **Week 19**    | FIRST Israel District Championship |

These are official, non-offseason, non-preseason events with 208 played matches between them.
There is no week 17 of an FRC season.

**What a user sees:** the Week dropdown ends with three nonsense options ("Week 17", "Week 18",
"Week 19"); the Israeli district's rows carry those as their only visible type label; and a
reader filtering for early-season events never finds Israel District Event #1 under any real
week. `filterModel.ts:74-75` acknowledges the behaviour in a comment but ships it as accepted.

**Fix:** stop presenting out-of-band weeks as season weeks. Treat `week >= 9` (raw) as a fourth
special bucket rather than a numeric week:

```ts
// filterModel.ts — drop postSeasonWeeks from the numeric list entirely
const sortedWeeks = Array.from(weeks).sort((a, b) => a - b);
const seasonWeeks = sortedWeeks.filter((week) => week <= 8);
const hasOutOfBandWeek = sortedWeeks.some((week) => week > 8);
// ...
weeks: [
  ...(hasWeek0 ? ["week0" as const] : []),
  ...seasonWeeks,
  ...(hasChamps ? ["champs" as const] : []),
  ...(hasOffseason ? ["offseason" as const] : []),
  ...(hasOutOfBandWeek ? ["other" as const] : []),
],
```

and in `TypeChip`, fall back to the district chip or a neutral "District" label rather than
`Week ${week + 1}` when `event.week > 8`. Add `"other"` to `WEEK_SPECIAL_VALUES` and to
`EventsSearchSchema`'s enum arm (see IN-03 — those two lists are already drifting).

### WR-02: The Result chip renders "Loss" for a team on neither alliance

**File:** `apps/web/src/components/team/MatchTable.tsx:274-282`

**Issue:** the chip is a three-way chain whose final arm is an unguarded fallthrough:

```tsx
match.actualWinner === "tie" ? <Tie/>
: (match.actualWinner === "red" && teamIsRed) || (match.actualWinner === "blue" && teamIsBlue) ? <Win/>
: <Loss/>
```

`teamIsRed`/`teamIsBlue` come from `redTeams.includes(teamKey)` / `blueTeams.includes(teamKey)`.
When **both** are false — a roster key that does not match the page's `frc{n}` key, e.g. a
letter-suffixed offseason B-team entry (`frc5199B`) that `teamKey.ts:55` documents as a real
published shape — the expression falls through to a confident "Loss".

This is the one place in the redesign that fabricates a fact instead of rendering blank.
`formatAllianceRecord`, `MetricValue`, `TypeChip`, `cellText` and `combineAlliancePicks` all go
out of their way not to; this chip asserts a defeat the data never states.

**Fix:** make the participation check explicit, and render nothing when the team is not on a
roster.

```tsx
const teamOnRoster = teamIsRed || teamIsBlue;
{played && teamOnRoster && (
  match.actualWinner === "tie" ? <span className="result-chip result-chip--tie">Tie</span>
  : (match.actualWinner === "red" && teamIsRed) || (match.actualWinner === "blue" && teamIsBlue)
    ? <span className="result-chip result-chip--win">Win</span>
    : <span className="result-chip result-chip--loss">Loss</span>
)}
```

### WR-03: The podium caption asserts a per-algorithm match count the pooling does not guarantee

**Files:** `apps/web/src/lib/homePodium.ts:43-50`, `apps/web/src/routes/index.tsx:71,81`

**Issue:** two coupled problems in the pooling.

First, `homePodium.ts:45` skips a season for one algorithm when its `winnerAccuracy` is `null`:

```ts
if (slice.winnerAccuracy === null) continue;
correct += slice.winnerAccuracy * slice.scoredCount;
scored += slice.scoredCount;
```

so each algorithm's `scoredCount` is independently accumulated and can differ. `index.tsx:71`
then takes `podium[0]!.scoredCount` — the **leader's** figure alone — and captions the whole
podium `"{n} matches each, scored walk-forward"`. If any algorithm skipped a season, the caption
is wrong for it, and worse, the three accuracies would be pooled over different populations
while the podium presents them as directly comparable. The null slice is schema-permitted
(`winnerAccuracy: number | null`) and nulls demonstrably occur in this data — `calibrationSeries.ts:10-13`
documents six null published bins.

Second, `homePodium.ts:43` finds the slice by `algorithmId` and `compLevelView` only, never by
`season`. Every sibling consumer filters on season — `CalibrationSection.tsx:176` does
`s.season === year`. Nothing here asserts that the artifact fetched for 2024 actually carries
2024's slices, so a mis-keyed or multi-season artifact would silently pool the same season twice.

I verified against the live `v1/compare/{2024,2025,2026}.json`: no nulls today, and
`scoredCount` is identical across all three algorithms per season, so **neither problem is
currently reachable**. Both are latent, and the caption is the kind of unverifiable claim this
project's failure log names.

**Fix:** make the caption honest and the lookup explicit.

```ts
// homePodium.ts — assert season, and report per-entry coverage
const slice = artifact.slices.find(
  (s) => s.algorithmId === algorithmId && s.compLevelView === "combined" && s.season === artifact.season,
);
```

```tsx
// index.tsx — only claim "each" when it is true
const counts = new Set(podium.map((e) => e.scoredCount));
const countText = counts.size === 1
  ? `${podium[0]!.scoredCount.toLocaleString("en-US")} matches each`
  : `${Math.min(...counts).toLocaleString("en-US")}–${Math.max(...counts).toLocaleString("en-US")} matches`;
```

### WR-04: Two Events columns sort by a different quantity than they display

**File:** `apps/web/src/components/events-list/EventsList.tsx:39-49,168-179`

**Issue:** the redesign renamed the week column to "Type" and turned its cell into an
officialness chip, but left `key: "week"`:

```ts
{ key: "week", label: "Type", numeric: true },
```

The comment claims "the chip is a presentation of the same axis" — it is not. The chip encodes
`isOffseason` / `eventType`; the sort orders by raw `week`, with nulls last. Every Championship
and offseason row carries `week: null` (verified live), so clicking "Type" ascending sorts
official rows by numeric week and dumps every Champs row at the end regardless of direction —
which is *not* type order, and reverses inconsistently.

Separately, the "Matches" header sorts by `matchCount` while its cell renders
`{playedMatchCount}/{matchCount}` (line 179). A reader sorting by the column reads the leading
number and gets an order keyed to the trailing one. `playedMatchCount` is declared in both
`EVENT_SORT_KEYS` (`searchParams.ts:161`) and `EventSortKey` but no column exposes it — a
reachable-by-URL-only sort key.

**Fix:** either restore an honest label for the sort axis, or sort by what the chip encodes.
The smaller change is to make the sort match the display:

```ts
// EventsList.tsx
{ key: "week", label: "Week", numeric: true },       // label names the axis it sorts
// ...
{ key: "playedMatchCount", label: "Matches", numeric: true },  // matches the leading number
```

If "Type" is the wanted label, add a real `eventType` sort key to `EventSortKey`,
`EVENT_SORT_KEYS` and `compareSortValues`, and order by the chip's own vocabulary.

### WR-05: The start-match picker shows a selected match before anything is selected

**File:** `apps/web/src/components/event/StartMatchPicker.tsx:169-174,209-238`

**Issue:** when `selectedMatchKey === null`, `selectedIndex` is `-1`, so `activeIndex` falls
back to `0` and `activeRow = rows[0]`. `StartMatchSummary` then renders that row with
`data-selected="true"` and the accent left-border selection treatment (line 116-117), and the
slider sits at position 1 — while `disclosureText` simultaneously renders
`START_MATCH_PICKER_HINT` ("Pick a match to simulate from").

**What a user sees:** Qual 1 highlighted as though chosen, the slider parked on it, and a line
above telling them to pick a match. Nothing downstream will run, because `SimulationTab`'s
`selectedMatchKey` is still `null`. The `data-selected="true"` attribute is also unconditionally
`"true"`, so it carries no information for any test asserting selection.

**Fix:** distinguish the two states.

```tsx
const hasSelection = selectedIndex >= 0;
const activeIndex = hasSelection ? selectedIndex : 0;
// ...
<StartMatchSummary row={activeRow} selected={hasSelection} />
```

and inside `StartMatchSummary`, carry `data-selected={selected ? "true" : "false"}` and apply
the accent border only when `selected`.

### WR-06: Match times render in the viewer's timezone with no label, while event dates were deliberately pinned to UTC

**File:** `apps/web/src/components/team/MatchTable.tsx:69-82`

**Issue:** the ms/seconds unit heuristic (`sortTime > 1e11`) is correct and well-reasoned. The
formatting that follows is not:

```ts
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
```

`undefined` locale means the **viewer's** timezone. A 9:00 AM match at a Michigan event renders
as "6:00 AM" to a viewer in California, and near midnight the weekday flips too — with no
timezone shown anywhere to signal it.

This is the same hazard `eventDates.ts:5-10` was written specifically to avoid, in the same
redesign, three days apart: *"Parsed and formatted in UTC on both sides so the calendar date can
never shift across the viewer's timezone."* The two surfaces treat the identical risk in
opposite ways.

**What a user sees:** a scout checking the schedule for an event in another timezone reads the
wrong time for every upcoming match, and the picker summary (`StartMatchPicker.tsx:141`, same
function) repeats it.

**Fix:** the published artifact carries no event timezone, so the honest interim options are to
label the zone rather than silently localise it:

```ts
const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const time = new Intl.DateTimeFormat(undefined, {
  hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
}).format(date);
```

The durable fix is to publish the event's `timezone` (TBA exposes it on the event object) and
format in it — file that as a pipeline follow-up.

### WR-07: `calibrationSeries.ts` is mostly dead after `CalibrationChart.tsx` was deleted

**File:** `apps/web/src/components/compare/calibrationSeries.ts:80-212`

**Issue:** `f8518805` deleted `CalibrationChart.tsx` and rebuilt the section around
`calibrationCards.ts`, which consumes exactly one export from this module
(`validCalibrationPoints`). I traced every other export across `apps/`, `packages/` and
`scripts/`:

| Export | Consumers outside its own test file |
|---|---|
| `selectHeadlinePoint` | none |
| `formatCalibrationSentence` | none |
| `countStats`, `CountStats` | none |
| `calibrationPointRadius`, `MIN_POINT_R`, `MAX_POINT_R` | none |
| `buildCalibrationRows` | none |
| `CalibrationChartRow`, `CalibrationChartCell` | none |
| `NO_USABLE_BINS_SENTENCE` | **none at all — not even a test** |

`NO_USABLE_BINS_SENTENCE` is the sharp one: it is the module's declared empty-state copy, and
`CalibrationSection.tsx:130` inlines a *different* string ("No usable bins in this view.")
instead of importing it. That is exactly the copy-drift the constant exists to prevent.

Roughly 130 of the file's 212 lines, plus the ~110 lines of tests exercising only themselves,
now describe a renderer that does not exist — including three doc comments that still name
`CalibrationChart.tsx` as their consumer (lines 6-8, 168, 180). `08-REVIEW`'s WR-02 fix
(the `point` field on `CalibrationChartCell`, line 156-162) is preserved in dead code.

The e2e file has the same residue: `apps/web/e2e/compare-narrow-legibility.spec.ts:19` still
cites "`CalibrationChart.tsx`'s own exported testid constants" as a source, and its C3
describe-block header still promises "legend, axis-label and sparse-bin-radius evidence" for
marks the plain-SVG rebuild does not draw. The test *body* was correctly rewritten to card
assertions; only the prose lies.

**Fix:** delete `selectHeadlinePoint`, `formatCalibrationSentence`, `countStats`, `CountStats`,
`calibrationPointRadius`, `MIN_POINT_R`, `MAX_POINT_R`, `buildCalibrationRows`,
`CalibrationChartRow`, `CalibrationChartCell` and their tests. Keep `NO_USABLE_BINS_SENTENCE`
and have `CalibrationSection.tsx:130` import it instead of inlining a second string (or delete
it and drop the pretence of a single copy source). Update the module header and the e2e file's
header to describe the section that actually ships.

### WR-08: The Y-axis width is sized from the data, not the headroom-extended domain the axis renders

**File:** `apps/web/src/components/team/MetricHistoryChart.tsx:173-193`

**Issue:** `yAxisWidth` is computed from `yAxisDomainValues` — the raw values and band edges —
under a comment asserting the width and the tick formatter "can never disagree" (lines 169-172).
Commit `25c0fb4e` then added 12% headroom *after* that computation:

```ts
const yAxisWidth = computeYAxisWidth(yAxisDomainValues);   // sized from data
// ...
yDomain = [yMin, yMax + headroom];                          // axis renders a larger range
```

The axis's top ticks are now drawn from a domain that extends past every value the width was
measured against. Whenever the headroom crosses a digit boundary — `yMax` near 98 extending past
100, or near 9.5 extending past 10 — the top tick label is one character wider than the reserved
width and clips or overlaps the plot. The invariant the comment promises is no longer true, which
is worse than not having stated it: a future reader will trust it.

**Fix:** size the axis from the domain it actually renders.

```ts
let yDomain: [number, number] | undefined;
let yAxisWidth = computeYAxisWidth(yAxisDomainValues);
if (yAxisDomainValues.length > 0) {
  const yMin = Math.min(...yAxisDomainValues);
  const yMax = Math.max(...yAxisDomainValues);
  const headroom = yMax > yMin ? (yMax - yMin) * 0.12 : 1;
  yDomain = [yMin, yMax + headroom];
  yAxisWidth = computeYAxisWidth([...yAxisDomainValues, yDomain[1]]);
}
```

and correct the comment on lines 169-172 to name the domain, not the data, as the shared source.

---

## Info

### IN-01: The team header mixes two as-of dates in one block with no label

**Files:** `apps/web/src/components/team/SeasonHeader.tsx:56-64`,
`apps/web/src/routes/team.$teamNumber.tsx:79-86`

The metric tiles show the last-**official**-match snapshot (`officialSnapshotMetrics`), while
the record and win rate directly beside them are `artifact.seasonStats.record` — season-final,
including offseason and preseason play. Nothing on the page states either fact. For a team that
played offseason events, the header reads as one coherent snapshot but is two different
as-of instants side by side.

Two related behaviours follow from the same seam: `metricsOverride` is `undefined` until the
parallel events query resolves, so the tiles render season-final values and then **silently
change** once it lands; and if that query errors permanently, they stay on season-final values
with no indication that the intended official-only snapshot was unavailable. Both are documented
choices in the route comment (lines 75-78), but neither is disclosed to the reader.

**Fix:** label the tiles ("As of last official match") when `metricsOverride` is present, and
either derive the record over official events too or label it separately.

### IN-02: The calibration mini-chart hardcodes ten bins and suppresses its own bar tooltips

**File:** `apps/web/src/components/compare/CalibrationSection.tsx:74,78-83,101`

`slotW = (x1 - x0) / 10` assumes exactly ten bins while the render iterates `card.rows`, whose
length is `slice.calibrationBins.length`. All five published artifacts carry ten bins today, so
nothing is wrong on screen — but a schema change to bin count silently overflows the SVG on one
side and leaves dead space on the other. Derive it: `const slotW = (x1 - x0) / Math.max(1, card.rows.length)`.

Separately, the `<svg>` carries `role="img"` with an `aria-label`, which makes its subtree
inaccessible — so each bar's `<title>` (line 101, carrying predicted/actual/count) is never
announced. That detail is duplicated in the bin rows below, so nothing is lost; the `<title>`
elements are simply dead weight for assistive tech and worth noting so nobody later relies on them.

### IN-03: The week special tokens are restated instead of imported, and the exported constant has no consumer

**Files:** `apps/web/src/lib/searchParams.ts:203`,
`apps/web/src/components/events-list/filterModel.ts:25`

`WEEK_SPECIAL_VALUES` is exported specifically so the token list has one home, and it is used
only to derive its own type — `EventsSearchSchema` restates
`z.enum(["week0", "champs", "offseason"])` as a literal. `searchParams.ts` documents this
mirror-not-import convention explicitly for `EVENT_SORT_KEYS` (lines 154-159) but not here, so
the drift is undeclared. Adding the `"other"` bucket WR-01 needs will require editing both.
Either import `WEEK_SPECIAL_VALUES` into the schema (`z.enum(WEEK_SPECIAL_VALUES)`) or add the
same explicit paired-edit note the sort-key list carries.

Minor adjacent edge: `z.coerce.number()` coerces `""` to `0`, so a bare `?week=` in the URL
resolves to week 0 (displayed "Week 1") rather than falling through `.catch(undefined)` to
no filter.

### IN-04: `simAxis.ts`'s slot-width comment describes the pre-fix mapping

**File:** `apps/web/src/lib/simAxis.ts:118-124`

`rankSlotWidth`'s doc comment states: *"The denominator here is deliberately the team count
itself, while `x()`'s denominator is one less... so the two are not mistaken for a typo and
silently unified by a later reader."* The 2026-09-01 slot-centred fix changed `x()` to
`((rank - 0.5) / teamCount)` — both denominators are now `teamCount`. The comment now warns a
reader against unifying two values that are already identical, and misdescribes the live
mapping. Update it to state the current convention (both denominators are `teamCount`; the
half-slot offset in `x()` is what centres a rank in its slot).

### IN-05: Doc/code drift left by the em-dash removal

The 2026-09-01 "no visible em-dashes" pass changed the renders but not the comments that
describe them. Each of these now documents behaviour the code does not have:

- `apps/web/src/components/event/AlliancesTab.tsx:299` — `formatAllianceRecord`'s comment says
  "`undefined` renders a single em-dash"; the function returns `""`.
- `apps/web/src/components/event/AlliancesTab.tsx:168` — `combineAlliancePicks`'s comment refers
  to "the em-dash this function returns above"; it returns `undefined`.
- `apps/web/src/components/events-list/EventsList.tsx:120-121` — `TypeChip`'s comment says a
  null week "renders an em-dash, never a guessed label"; it returns `null`.

These are one-line comment corrections. They matter here only because this codebase's comments
are load-bearing — several of them are the *only* record of a decision — so a comment that
contradicts its own function is a real maintenance hazard, not a formatting nit.

---

## Areas reviewed and found clean

Stated plainly rather than padded with Info items:

- **`rowModel.ts`** — ranking, win-rate nullability, missing-key ordering and the total-order
  tie-break are all correct; `isRealTeamKey` is applied before ranking, which is the right place.
- **`compareTie.ts`** — the non-finite guard, the strict threshold comparison, the
  display-string tie test and the deterministic leader/runner-up ordering all hold under the
  degenerate inputs they claim to handle.
- **`MetricValue.tsx`** — no re-rounding, absent spread renders bare (never `0`), absent metric
  renders an empty box that preserves the column. `TeamMetricSchema.spread` is
  `.optional()` and not nullable, so the `!== undefined` check is exactly right.
- **`teamKey.ts`, `eventDates.ts`, `breakpoints.ts`, `calibrationCards.ts`** — no defects found.
- **`districtNames.ts`** — I enumerated live district keys across 2022–2026 and all fifteen
  (`ca, chs, fch, fim, fin, fit, fma, fnc, fsc, isr, ne, ont, pch, pnw, win`) are real and
  correctly mapped. The `chs`/`fch` pair mapping to the same name is correct, not a duplicate bug.
- **Security sweep** — no injection sinks, no `dangerouslySetInnerHTML`, no `eval`, no `as any`,
  no `@ts-ignore`, no hardcoded credentials anywhere in the 62 changed files.

---

_Reviewed: 2026-09-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
_Range: 84c17751..HEAD, restricted to ungoverned UI work; waiver commit 09a81d1f_
