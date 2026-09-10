---
phase: quick-260909-tiq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/lib/matchKey.ts
  - apps/web/src/lib/matchKey.test.ts
  - apps/web/src/lib/preMatchMetrics.ts
  - apps/web/src/lib/preMatchMetrics.test.ts
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/searchParams.test.ts
  - apps/web/src/routes/match.$matchKey.tsx
  - apps/web/src/routes/match.$matchKey.test.tsx
  - apps/web/src/components/match/MatchRobotGrid.tsx
  - apps/web/src/components/match/MatchRobotGrid.test.tsx
  - apps/web/src/components/event/EventMatchTable.tsx
  - apps/web/src/components/event/EventMatchTable.test.tsx
  - apps/web/src/components/team/MatchTable.tsx
  - apps/web/src/components/team/MatchTable.test.tsx
  - apps/web/src/test/routerHarness.tsx
autonomous: true
requirements: [QT-260909-tiq]

estimate:
  tokens: 100000
  raw_tokens: 200000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "`/match/{matchKey}` renders for any match published in an event artifact — played or upcoming — showing that match's identity label, prediction, Match Band, confidence, call, bonus-RP dots, actual result when played, and the TBA video when one is published."
    - "Every match row on an event page (Qualifications and Playoffs tabs) and on a team page is reachable: its Match-column label is a link to that match's own page, carrying the reader's current algorithm (D-01 scope: no new data needed for this)."
    - "Each of the six robots shows its own photo from the team-season artifact's `robotImageUrl`, rendered through the SeasonHeader Radix Avatar trio, with the fallback tile — never a broken image and never a placeholder implying a photo exists — for the measured ~25% of teams that have none (D-02)."
    - "Each robot's Auto/Teleop/Endgame/Total figures are the values AS OF IMMEDIATELY BEFORE this match, read from the team-season artifact's `metricHistory` row that PRECEDES this match's row — never the row FOR this match (whose values are post-update), never `seasonStats`, never the team's current or season-final values."
    - "A robot whose pre-match state cannot be resolved — this match is its first of the season, or no history row matches — renders its metric cells blank and says so in words. Absence renders as absence; a current-season figure is never substituted for a pre-match one."
    - "The page's season comes from the event key embedded in the match key, never from the `?year=` search param, so a hand-edited year cannot produce a mismatched render (the event page's own Decision 1, applied one level down)."
    - "The algorithm's own internal `spread` never reaches the screen anywhere on the match page, in any form, including as a fallback. The only `±` the page may draw is the Match Band `EventMatchTable` already draws from `redSwingBandVariance`/`blueSwingBandVariance`."
    - "The video is resolved ONLY through `apps/web/src/lib/matchVideo.ts`'s `parseMatchVideoKey`; a raw stored video key is never interpolated into an iframe `src`, and an unparseable key renders nothing at all (T-7eu-01 preserved by reuse)."
    - "No pipeline, ingest, schema, publish, or artifact change of any kind. No republish. No network Bash. The page is fully functional against the artifact set already live in R2 (D-01)."
    - "`npx vitest run` from the REPO ROOT is green (167+ test files, verified by reading the printed file count and summary, never by exit code), and `npx tsc --noEmit -p apps/web/tsconfig.json` is clean."
  artifacts:
    - apps/web/src/lib/matchKey.ts
    - apps/web/src/lib/preMatchMetrics.ts
    - apps/web/src/routes/match.$matchKey.tsx
    - apps/web/src/components/match/MatchRobotGrid.tsx
  key_links:
    - "`EventMatchTable.tsx` Match-column label -> `<Link to=\"/match/$matchKey\">` -> the new route (event page reachability)."
    - "`team/MatchTable.tsx` Match-column label -> `<Link to=\"/match/$matchKey\">` -> the new route (team page reachability)."
    - "`match.$matchKey.tsx` -> `eventKeyFromMatchKey()` -> `eventQueryOptions()` — a warm TanStack Query cache hit when the reader arrived from the event page (same query key)."
    - "`match.$matchKey.tsx` -> `useQueries` over the six roster keys -> `teamQueryOptions()` -> `preMatchMetrics()` -> `MatchRobotGrid`."
    - "`apps/web/src/test/routerHarness.tsx` must register `/match/$matchKey`, or every table test rendering the new Link fails to resolve a route."
---

<objective>
Add a `/match/{matchKey}` page and make every match row on the event page and the team
page a link to it. The page shows, for one match: the six robots with their photos, each
robot's metrics as they stood just before this match, the prediction, the actual result,
and the TBA video.

Purpose: a match is the unit an FRC scout actually reasons about, and today the site has
no page for one. Every fact this page needs is already published — this is a rendering
task, not a data task.

Output: one new route, one new component directory (`components/match/`), two new pure
lib modules, and a two-line change in each of the two match tables.

## Decision map (CONTEXT.md, LOCKED)

- **D-01 — Ship on already-published data.** Build strictly from artifacts already live
  in R2. No pipeline change, no schema change, no republish. Every task below reads only
  the event artifact and the team-season artifact through the EXISTING fetchers.
- **D-02 — Robot photos reuse the team page's mechanism.** `TeamSeasonArtifact.robotImageUrl`
  rendered through the Radix `Avatar`/`AvatarImage`/`AvatarFallback` trio exactly as
  `SeasonHeader.tsx` does, error-triggered fallback branch included. No TBA media
  ingestion, no TBA call from the browser.
- **D-03 — Breakdown-stat granularity.** DEFERRED BY THE DECISION'S OWN TERMS: raw TBA
  `score_breakdown` is not published to R2, so no task here implements it. D-03 records
  the granularity (alliance-level table per side; only the genuinely per-robot fields
  broken into robot columns) for whoever picks up the follow-up. This plan must not
  present alliance-level data as per-robot — it does not render alliance-level breakdown
  data at all.

What the page CAN show per robot, and therefore does: the team's own pre-match
Auto/Teleop/Endgame/Total from `metricHistory`. That is per-robot by construction.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.claude/skills/sketch-findings-sigmascout/SKILL.md
@.planning/quick/260909-tiq-add-a-match-page-reachable-from-event-an/260909-tiq-CONTEXT.md

@apps/web/src/routes/event.$eventKey.tsx
@apps/web/src/routes/event.$eventKey.test.tsx
@apps/web/src/lib/eventKey.ts
@apps/web/src/lib/api/event.ts
@apps/web/src/lib/api/team.ts
@apps/web/src/components/event/eventMatchAxis.ts
@apps/web/src/components/event/EventMatchTable.tsx
@apps/web/src/components/team/MatchTable.tsx
@apps/web/src/components/team/SeasonHeader.tsx
@apps/web/src/components/MetricValue.tsx
@apps/web/src/components/MatchVideoCell.tsx
@apps/web/src/components/StateViews.tsx
@apps/web/src/lib/metricGroups.ts
@apps/web/src/lib/tiers.ts
@apps/web/src/lib/officialSnapshot.ts
@apps/web/src/test/routerHarness.tsx
@packages/harness/metricHistorySchema.ts
</context>

<plan_wide_rules>
These hold for every task. Read once; they are not restated per task.

1. **Read the sketch-findings skill first.** It is mandatory before UI work on this repo.
   Three rules bite here: (a) every colour is a `--color-*`/`--tier-*` custom property,
   never a literal in component code; (b) the Pine redesign means dark green ribbon +
   white surfaces, green is ink not paint — do not tint this page green; (c) Swing Score,
   Match Band and spread are three different things and the algorithm's own spread must
   never render.

2. **Do not edit `apps/web/src/components/MetricValue.tsx` or
   `apps/web/src/styles/theme.css`.** Another session is actively editing both. Consume
   them as they are. If a style genuinely cannot be expressed with existing tokens and
   utility classes, say so in the SUMMARY rather than editing `theme.css`.

3. **Pass no `swingScore` to `MetricValue`.** The pre-match figures are as-of-then; the
   team artifact's `swingFactor` is season-final. Putting a season-final `±` beside an
   as-of-then value is the two-as-of-instants defect IN-01 already named on the team
   header. Call `MetricValue` with `metric` and `tier` only.

4. **Never read `.spread` in any file this plan creates.** `MetricValue` deliberately
   ignores it; so does this page.

5. **`metricHistory` rows are POST-match.** `MetricHistoryRowSchema.metrics` is
   documented as "that team's metric AFTER this match". The pre-match state is therefore
   the PRECEDING row, not the row for this match. This is the single most likely way to
   get this page quietly wrong.

6. **No network Bash, ever.** No `pnpm publish:*`, no live-origin fetch, no ingest. This
   is a pure `apps/web` change (executor sandboxes deny network Bash anyway).

7. **Verify tests by OUTPUT, not exit code.** Run `npx vitest run <paths>` from the REPO
   ROOT. Do not use `pnpm test`, and never wrap a pnpm command in `timeout` — that
   swallows all output and exits 0. Read the printed pass/fail counts. A run from
   `apps/web` sees only ~77 files; the repo root sees 167+.

8. **Stage by explicit path.** Another session is committing concurrently. `git add
   <explicit paths>`, never `git add -A` or `git add .`. `git status` after each commit
   to confirm nothing foreign was absorbed.

9. **`routeTree.gen.ts` is gitignored and generated** by the `tanstackRouter` Vite
   plugin from `src/routes/`. Creating `match.$matchKey.tsx` is all the registration the
   app needs. Route TESTS build their own small tree via `Route.update({...})` — copy
   `event.$eventKey.test.tsx`'s `renderEventRoute` helper exactly.
</plan_wide_rules>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end `/match/{matchKey}` — one match, one path, from the event artifact alone</name>
  <files>apps/web/src/lib/matchKey.ts, apps/web/src/lib/matchKey.test.ts, apps/web/src/lib/searchParams.ts, apps/web/src/lib/searchParams.test.ts, apps/web/src/routes/match.$matchKey.tsx, apps/web/src/routes/match.$matchKey.test.tsx</files>
  <read_first>
    - `apps/web/src/lib/eventKey.ts` — the module-shape and error-class convention this task's sibling follows verbatim (`EVENT_KEY_PATTERN`, `isValidEventKey`, `InvalidEventKeyError`, `seasonFromEventKey`).
    - `apps/web/src/routes/event.$eventKey.tsx` — the state-branch order (invalid key -> 404 EmptyState -> other-error ErrorState -> pending -> populated), the `useAlgorithmVersion` gate, and Decision 1 (season comes from the key, never `?year=`).
    - `apps/web/src/routes/event.$eventKey.test.tsx` — `renderEventRoute`, `manifestResponse`, and the `global.fetch` stubbing pattern.
    - `apps/web/src/components/event/eventMatchAxis.ts` — `mergeEventMatches`, `computeEventAxisDomain`, `EventMatchRow`.
    - `apps/web/src/components/event/EventMatchTable.tsx` — its exact props (`rows`, `domain`, `season`, `algorithm`).
    - `apps/web/src/components/MatchVideoCell.tsx` and `apps/web/src/lib/matchVideo.ts` — the existing video trigger and its security boundary.
  </read_first>
  <action>
Create `apps/web/src/lib/matchKey.ts`, the one place in `apps/web` that knows the match-key
convention, sibling to `eventKey.ts` and following its shape exactly.

Export `MATCH_KEY_SEPARATOR`-free helpers: `eventKeyFromMatchKey(matchKey: string): string`
and `isValidMatchKey(matchKey: string): boolean`, plus a named `InvalidMatchKeyError`
extending `Error` with `name` set (this repo's no-bare-error convention). A match key is
`{eventKey}_{suffix}`: split at the FIRST underscore (an event key matches
`^\d{4}[a-z0-9]+$` and therefore contains none), require a non-empty suffix, and validate
the prefix by delegating to `isValidEventKey` — never a second copy of the event-key regex.

DELIBERATELY do NOT validate the suffix's internal shape and do NOT parse `compLevel`,
`setNumber` or `matchNumber` out of it. Two reasons, both recorded in the file's doc
comment: the published row already carries those three fields and
`MatchTable.tsx`'s `matchLabel()` already renders them, so deriving a display string from
an opaque key is the `eventName: eventKey` class of mistake (06-RESEARCH.md Pitfall 1);
and the authoritative "is this a real match" check is whether the event artifact contains
a row with this key, which the route performs anyway. A suffix regex would only add a way
to reject a real key shape nobody enumerated.

Add a `MatchSearchSchema` to `apps/web/src/lib/searchParams.ts`: `RootSearchSchema` with
NO additional fields (no `tab` — the match page has no tabs), exported alongside a
`MatchSearch` type, placed beside `EventSearchSchema` with a doc comment saying `year` is
carried only so the root ribbon's year dropdown keeps working, and that the page's own
season comes from the match key's event key, so a hand-edited `?year=` cannot produce a
mismatched render. Extend `searchParams.test.ts` with the same coverage shape its
neighbours have.

Create `apps/web/src/routes/match.$matchKey.tsx` exporting
`createFileRoute("/match/$matchKey")({ validateSearch: MatchSearchSchema, component: MatchPage })`.

The page, in the same branch order the event page uses:
- `isValidMatchKey(matchKey)` false -> the event page's own inline invalid-key paragraph,
  reworded for a match key. No fetch fires.
- `const eventKey = eventKeyFromMatchKey(matchKey)`; `const season = seasonFromEventKey(eventKey)`.
- `const version = useAlgorithmVersion(algorithm)`; one `useQuery({ ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }), enabled: version !== undefined })`.
  Reuse `eventQueryOptions` unchanged so the query key matches the event page's and a
  reader arriving from there hits a warm cache (D-01: no new fetcher, no new artifact).
- 404 (`error instanceof ArtifactFetchError && error.status === 404`) -> `EmptyState`
  naming the match key. Any other `error` -> `ErrorState resource={`match ${matchKey}`} year={season}` with `onRetry`.
  Pending or `data === undefined` -> a skeleton.
- Populated: `const rows = mergeEventMatches(data.matches, data.upcoming, () => true)`
  (memoized); `const domain = computeEventAxisDomain(rows)` over ALL rows, not just the
  one — the site's one-shared-event-scale rule (sketch 003 variant C) means this match's
  bands must be drawn on the same scale as the event's other matches, and a domain
  computed from a single row would be degenerate. Then `rows.find(r => r.matchKey === matchKey)`;
  when undefined, render an `EmptyState` saying this event publishes no match with that
  key. When found, render:
  1. A heading block: `matchLabel(row)` (imported from `team/MatchTable.js`, already the
     shared label helper) plus the event's own `data.eventName`/`eventKey` as a `<Link to="/event/$eventKey">`
     back to the event page, and `formatScheduledTime(row.sortTime)` when `sortTime` is
     present (never synthesized when absent).
  2. `<EventMatchTable rows={[row]} domain={domain} season={data.season} algorithm={algorithm} />`.
     Reusing the table for one row is what gives this page the prediction, the Match Band,
     confidence, the call, the bonus-RP dots and the actual score with zero new chart code
     — and it draws the band from `redSwingBandVariance`/`blueSwingBandVariance`, because
     `mergeEventMatches` already maps those onto the fields the table reads. Pass
     `data.season`, the published field, not the search param.
  3. A video block: call `parseMatchVideoKey(row.video)` once; when it returns undefined
     render NOTHING for this block (an unparseable key is treated identically to a missing
     one); otherwise render a label and the existing `<MatchVideoCell matchKey={row.matchKey} matchLabel={matchLabel(row)} videoKey={row.video} />`.
     Reuse that component rather than building a second player: it already holds the
     validated-id-only iframe `src`, the no-`forceMount` rule that keeps zero iframes
     mounted until a reader activates one, and `referrerPolicy`. Do not construct any
     video URL in this file.

Wrap the page in the same `mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]` content
column the event and team pages use, so the three detail pages share one measure.

Write `apps/web/src/routes/match.$matchKey.test.tsx`, copying
`event.$eventKey.test.tsx`'s `renderMatchRoute`/`manifestResponse`/fetch-stub scaffolding.
Cover: an invalid match key fires no fetch and renders the explain-don't-redirect
paragraph; a 404 renders the EmptyState; a populated played match renders the label, the
single table row (`match-row-{matchKey}` testid) and the video trigger
(`match-video-trigger-{matchKey}`); a populated UPCOMING match renders with no video
trigger and no actual score; a match key that parses but is absent from the artifact
renders the not-published EmptyState; and `?year=` set to a different season than the
match key's does not change the rendered season.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/matchKey.test.ts apps/web/src/lib/searchParams.test.ts apps/web/src/routes/match.\$matchKey.test.tsx</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>`/match/2024casf_qm1` renders end-to-end from the event artifact alone: identity label, the one-row prediction/actual table on the event-wide scale, and the video trigger when a video is published. All six listed test cases pass, read from the printed vitest output. The web tsconfig typechecks clean. Committed.</done>
  <reversibility rating="reversible">A new route file plus two additive lib exports; deleting the file removes the feature with no other call site affected.</reversibility>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The six robots — photos and genuinely pre-match metrics</name>
  <files>apps/web/src/lib/preMatchMetrics.ts, apps/web/src/lib/preMatchMetrics.test.ts, apps/web/src/components/match/MatchRobotGrid.tsx, apps/web/src/components/match/MatchRobotGrid.test.tsx, apps/web/src/routes/match.$matchKey.tsx, apps/web/src/routes/match.$matchKey.test.tsx</files>
  <read_first>
    - `packages/harness/metricHistorySchema.ts` — `MetricHistoryRowSchema`; note its `metrics` doc comment says AFTER this match.
    - `apps/web/src/lib/officialSnapshot.ts` — the established shape for a pure "resolve one history row" module, including its return-`undefined`-rather-than-fall-back discipline.
    - `apps/web/src/components/team/SeasonHeader.tsx` (the Avatar block and the metric tiles) — the pattern D-02 names.
    - `apps/web/src/lib/metricGroups.ts` (`METRIC_GROUPS`), `apps/web/src/lib/metricKeys.ts` (`TOTAL_KEY`), `apps/web/src/lib/metricLabels.ts`, `apps/web/src/lib/tiers.ts` (`tierForPercentile`).
    - `apps/web/src/routes/index.tsx` lines around its `useQueries` call — the repo's parallel-queries precedent.
  </read_first>
  <behavior>
`preMatchMetrics(metricHistory, matchKey, { played })` — pure, no React:

- Played match, history row for `matchKey` found at index `i > 0` -> returns
  `{ metrics: rows[i-1].metrics, basis: "before-this-match", asOfMatchKey: rows[i-1].matchKey }`.
- Played match, row found at index `0` -> `undefined` (this is the team's first match of
  the season; there is no prior state and none may be invented).
- Played match, no row with `matchKey` -> `undefined` (e.g. a letter-suffixed second-robot
  key that matches no roster row).
- Unplayed match, `metricHistory` non-empty -> returns
  `{ metrics: lastRow.metrics, basis: "latest-played", asOfMatchKey: lastRow.matchKey }`
  — the team's state after its most recent played match IS its state going into a match
  that has not happened.
- Unplayed match, `metricHistory` empty -> `undefined`.
- A property test over a synthetic 5-row history: for every played row at index `i > 0`,
  the returned metrics are reference-equal to `rows[i-1].metrics` and NEVER to
  `rows[i].metrics`. This is the assertion that catches the off-by-one that would make the
  whole page silently wrong.
- The two bases are never conflated: the returned `basis` discriminant is asserted in
  every case.

`MatchRobotGrid` component:
- Renders six robot cards, three per alliance, red first, in roster order.
- A card with `robotImageUrl` present renders `AvatarImage`; a card without it renders
  only `AvatarFallback` with an `aria-label` naming the team — assert BOTH branches, and
  assert no `<img>` is emitted in the absent case.
- A card whose pre-match state resolved renders four `MetricValue`s (Auto, Teleop,
  Endgame, Total), tier-boxed where the history metric carries a `percentile`.
- A card whose pre-match state did NOT resolve renders blank metric cells plus a visible
  note saying there are no pre-match metrics for this team — assert the note's presence,
  and assert the card does NOT render any number.
- Given a metric carrying BOTH a value and a `spread`, the rendered card text contains the
  value and does NOT contain a `±` character anywhere. This is the spread-leak guard.
- `basis: "latest-played"` and `basis: "before-this-match"` render DIFFERENT as-of wording;
  assert each.
  </behavior>
  <action>
Create `apps/web/src/lib/preMatchMetrics.ts` implementing the `<behavior>` contract above.
Export `PreMatchBasis = "before-this-match" | "latest-played"`, an interface
`PreMatchMetrics { metrics; basis; asOfMatchKey }`, and the function. Take `played` as a
NAMED field in an options object, not a bare positional boolean — this function has two
branches whose only difference is that flag, and a named field makes a mistake at a call
site a compile error (the PD-01 precedent in `event.$eventKey.tsx`'s `resolveActiveTab`).

The file's header comment must state, in its own words, the fact the whole page rests on:
`MetricHistoryRowSchema.metrics` is the team's state AFTER that row's match, so the
pre-match state is the PRECEDING row — and that returning the row FOR this match would
print a post-update figure as a pre-match one. Also state why `seasonStats.metrics` is
never a fallback here: it is a different as-of instant, and substituting it would make a
stale number look like a pre-match number (the CONTEXT's load-bearing correctness point).

Create `apps/web/src/components/match/MatchRobotGrid.tsx`. Props: the two roster key
arrays, and a per-team-key record of `{ artifact?: TeamSeasonArtifact; preMatch?: PreMatchMetrics; isPending: boolean }`.
Keep the component a pure function of those props — no fetching inside it — so its test
needs no query client.

Per card: the team number (a `<Link to="/team/$teamNumber" search={{ year: season, algorithm, tab: "overview" }}>`,
matching the link both match tables already render), the nickname, the Avatar block copied
from `SeasonHeader.tsx`'s robot-image branch (same `rounded-[var(--radius)]` overrides,
same conditional `AvatarImage`, same labelled `AvatarFallback`; a smaller fixed size is
fine), and the four metric cells.

Metric cells: iterate `METRIC_GROUPS` then `TOTAL_KEY`, reading
`preMatch.metrics[group.metricKey]`. Pass `metric` and `tier={tierForPercentile(entry?.percentile)}`
to `MetricValue` and NOTHING ELSE — no `swingScore`, per plan-wide rule 3. Label each cell
through the existing `metricLabel`. Where `preMatch` is undefined, render the cells with
`metric={undefined}` (already the site's blank-cell rendering) plus the explicit
no-pre-match-metrics note. Where `isPending`, render a skeleton, not a blank — a pending
fetch is not an absence.

Above the grid, render one line naming the as-of instant, derived from the basis the six
cards agree on: for `before-this-match`, that these are each team's ratings going into
this match; for `latest-played`, that this match has not been played and these are each
team's ratings as of its most recent played match. Do not print a single combined line
when the six cards disagree on basis — in that case state it per card.

Colour: use existing `--color-*` tokens and the existing `.data-card` class for the card
surface. Write no colour literal, and do not tint the page green (plan-wide rule 1).

Wire into `apps/web/src/routes/match.$matchKey.tsx`:
- `const rosterKeys = useMemo(() => [...row.redTeams, ...row.blueTeams], [row])` — but this
  must be computed in a way that does not move any hook below an early return. Declare ONE
  `useQueries` at the top level of the component body, before every early return, with its
  `queries` array derived from whatever is currently known (an empty array before the event
  artifact resolves). `useQueries` is a single hook whose array length may change between
  renders; mapping `useQuery` over a roster would be a hooks-count violation, and this repo
  has already shipped a React #310 crash from hooks placed below an early return. Follow
  `routes/index.tsx`'s `useQueries` shape.
- Each query is `teamQueryOptions({ teamKey, year: season, algorithmId: algorithm, version: version ?? "" })`
  with `enabled: version !== undefined`, where `season` is the event-key-derived season —
  never the `?year=` param.
- Build the per-team record by zipping roster keys against results, calling
  `preMatchMetrics(artifact.metricHistory, matchKey, { played: row.played })` for each
  resolved artifact. A team artifact that 404s or fails is `{ isPending: false }` with no
  artifact — the card degrades to the fallback tile and the no-metrics note, never an
  error that takes down the page.
- The match row itself must paint WITHOUT waiting on the six team artifacts: render the
  Task 1 heading and table first, grid below with its own pending state.

Extend `match.$matchKey.test.tsx` with a route-level case proving the six team artifacts
are fetched for the resolved roster and that the table paints before they resolve.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/preMatchMetrics.test.ts apps/web/src/components/match/MatchRobotGrid.test.tsx apps/web/src/routes/match.\$matchKey.test.tsx</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>Every `<behavior>` bullet has a passing assertion, read from the printed vitest output — including the off-by-one property test, both Avatar branches, the absence-renders-as-absence case, and the no-`±` spread guard. The match page shows six robot cards with photos and pre-match figures, and the match row still paints before the team artifacts resolve. Committed.</done>
  <reversibility rating="reversible">Additive: one new lib module, one new component directory, and a `useQueries` block in the new route.</reversibility>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Make every match row on the event page and the team page a link to its match</name>
  <files>apps/web/src/components/event/EventMatchTable.tsx, apps/web/src/components/event/EventMatchTable.test.tsx, apps/web/src/components/team/MatchTable.tsx, apps/web/src/components/team/MatchTable.test.tsx, apps/web/src/test/routerHarness.tsx</files>
  <read_first>
    - `apps/web/src/components/event/EventMatchTable.tsx` around its Match-column cell — the `<span className="text-role-label ...">{matchLabel(row)}</span>` and the roster `<Link>` directly beneath it, which is the exact `to`/`params`/`search` shape to copy.
    - `apps/web/src/components/team/MatchTable.tsx` around its Match-column cell — the same `<span>` and the same roster `<Link>` pattern.
    - `apps/web/src/test/routerHarness.tsx` — `buildRouter`, and the comment explaining why a link target must be registered there.
    - `apps/web/src/components/event/StartMatchPicker.tsx` — renders `matchLabel(row)` too, and is explicitly OUT OF SCOPE.
  </read_first>
  <behavior>
- On `EventMatchTable`, the Match-column label for a row is a link whose `href` contains
  the row's match key; clicking it is a navigation, and the roster-number links beside it
  still resolve to their team pages unchanged.
- On `team/MatchTable`, the same, for both a played and an unplayed row.
- Both links carry the current algorithm and the season in their search, so the
  destination keeps the reader's algorithm selection — asserted by reading the rendered
  `href`.
- An unplayed row's label links exactly as a played row's does (a match page exists for
  both).
- Every pre-existing assertion in both test files still passes unmodified. In particular
  `EventMatchTable`'s "every team-number element inside one row's Match column carries an
  identical class list" test must stay green: the new match link must not join the
  `.match-alliance-num` class family.
- `StartMatchPicker` is unchanged: its label stays a plain span. A link inside a selection
  control would hijack the click that picks a start match.
  </behavior>
  <action>
Register the new route in the shared test harness FIRST: add a
`createRoute({ path: "/match/$matchKey", getParentRoute: () => rootRoute, validateSearch: MatchSearchSchema, component: () => null })`
to `apps/web/src/test/routerHarness.tsx`'s `buildRouter` and include it in
`addChildren`, following the comment already there explaining why the `/teams` route is
registered. Without this, every table test that renders the new link fails to resolve a
route.

In `apps/web/src/components/event/EventMatchTable.tsx`, replace the Match-column label
span with a `<Link to="/match/$matchKey" params={{ matchKey: row.matchKey }} search={{ year: season, algorithm }}>`
carrying the SAME `text-role-label text-[var(--color-text-primary)]` classes plus
`hover:underline` — the identical treatment the roster-number links already use, so the
affordance reads the same on both lines of the cell. Keep `matchLabel(row)` as the child;
do not change the label text. Do not add any `.match-alliance-num*` class to it.

Make the identical change in `apps/web/src/components/team/MatchTable.tsx`'s Match-column
label span. Both components already receive `season` and `algorithm` props for their
roster links, so no prop changes are needed in either file or at any call site.

Leave `StartMatchPicker.tsx` alone.

Add the `<behavior>` assertions to both test files, reading the rendered anchor's `href`
to prove the match key and the carried search. Then run the full repo-root suite to prove
nothing else regressed.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event/EventMatchTable.test.tsx apps/web/src/components/team/MatchTable.test.tsx</automated>
    <automated>npx vitest run</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>Both match tables' labels are links to `/match/{matchKey}` carrying year and algorithm, asserted by reading `href`. `StartMatchPicker` is untouched. The repo-root `npx vitest run` reports 167+ files and zero failures, read from the printed summary — not from an exit code. Both tsconfigs typecheck clean. Committed.</done>
  <reversibility rating="reversible">Two one-element swaps plus one harness route registration.</reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL -> route params | `$matchKey` is fully attacker-controlled and is the sole input from which an R2 artifact path is built. |
| R2 artifact -> browser | Published JSON is our own pipeline's output, but it is third-party-sourced (TBA) data flowing into an iframe `src` and an `<img>` `src`. |
| Browser -> youtube-nocookie.com | A cross-origin embed, reached only via an 11-char-validated video id. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tiq-01 | Tampering | `matchKey.ts` -> `artifactKey()` -> `fetch` | medium | mitigate | `eventKeyFromMatchKey` delegates the prefix check to `isValidEventKey` (`^\d{4}[a-z0-9]+$`) and the route fires NO fetch until `isValidMatchKey` passes, so a traversal or injection payload can never reach an artifact path. Asserted by the invalid-key no-fetch test in Task 1. |
| T-tiq-02 | Tampering | match page video block | high | mitigate | The page constructs no video URL. `parseMatchVideoKey` is the only resolver and `MatchVideoCell` the only renderer; an unparseable key renders nothing (T-7eu-01 preserved by reuse, never re-implemented). Task 1's action forbids constructing a video URL in the route file. |
| T-tiq-03 | Information disclosure | `MatchRobotGrid` metric cells | medium | mitigate | The algorithm's internal `spread` must never render. No file created by this plan reads `.spread`, no `swingScore` is passed to `MetricValue`, and Task 2's behavior contract includes a test asserting no `±` appears for a metric that carries a spread. |
| T-tiq-04 | Information disclosure | robot `<img>` src | low | accept | `robotImageUrl` is a `z.string().url()` resolved by our own pipeline from TBA media; loading it leaks a referrer to TBA's CDN exactly as the team page already does. Accepted: identical exposure to an existing shipped surface, and D-02 mandates reusing that mechanism. |
| T-tiq-05 | Denial of service | six parallel team-artifact fetches | low | accept | Six CDN-cached GETs per match page view, all `Cache-Control`-fronted and typically warm. Accepted: well inside free-tier read quotas, and the match row paints without waiting on them. |
| T-tiq-06 | Spoofing | `?year=` vs the match key's season | medium | mitigate | Every fetch and every rendered season derives from `seasonFromEventKey(eventKeyFromMatchKey(matchKey))`; `?year=` is never read for data. Asserted by Task 1's mismatched-year test. |

No package-manager installs of any kind occur in this plan, so the Package Legitimacy
Gate does not apply and no `T-tiq-SC` entry is required.
</threat_model>

<verification>
Automated (the gate):
1. `npx vitest run` from the REPO ROOT — 167+ files, zero failures, read from the printed
   summary. Never `pnpm test`, never wrapped in `timeout`.
2. `npx tsc --noEmit` at the root AND `npx tsc --noEmit -p apps/web/tsconfig.json` — the
   root invocation does not cover `apps/web`, so both are required.

Human visual check (recommended, not a blocker):
Per the recorded local-visual-verification recipe — start the dev server with
`VITE_ARTIFACT_ORIGIN` pointing at the local origin so the `/v1` proxy activates (R2's CORS
policy does not allow-list localhost), on a fresh port. Then:
- Open a 2025 or 2026 event page, Qualifications tab, and click a match label. The match
  page should show six robot cards, the one-row prediction table, and a video trigger.
- Confirm at least one card shows the fallback tile rather than a broken image (~25% of
  teams have no photo).
- Open an UPCOMING match and confirm the as-of wording changes and no actual score or
  video appears.
- Open a team page, click a match label there, and confirm the same page renders.
- Confirm no `±` appears anywhere on the six robot cards.
</verification>

<success_criteria>
- `/match/{matchKey}` renders for a played match and for an upcoming match, built only
  from already-published artifacts (D-01).
- Match labels on the event page (both match-table tabs) and the team page link to it.
- Six robot photos render via the SeasonHeader Avatar pattern, fallback tile included (D-02).
- Per-robot figures are the PRECEDING `metricHistory` row's, proven by a reference-equality
  property test; unresolvable pre-match state renders as absence with words, never as a
  substituted current-season figure.
- The algorithm's internal spread renders nowhere; the only `±` on the page is the Match
  Band `EventMatchTable` already draws.
- No pipeline/schema/publish change, no republish, no network Bash.
- Repo-root vitest and both tsc invocations are green, verified by output.
</success_criteria>

<output>
Return the SUMMARY text to the orchestrator for it to write to
`.planning/quick/260909-tiq-add-a-match-page-reachable-from-event-an/260909-tiq-SUMMARY.md`
— the Write tool blocks subagents from SUMMARY.md, so do not attempt to write it directly
and do not route around the block with Bash.

The SUMMARY must record: the exact vitest file/pass counts printed by the repo-root run;
the commit hashes; whether any robot card in the manual check rendered a fallback tile;
and anything about `theme.css` or `MetricValue.tsx` that could not be expressed without
editing them (plan-wide rule 2).
</output>
