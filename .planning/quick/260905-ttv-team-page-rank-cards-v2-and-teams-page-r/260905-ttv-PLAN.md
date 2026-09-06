---
phase: quick-260905-ttv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/teamRanks.ts
  - packages/harness/teamRanks.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/components/teams-table/teamFilterModel.ts
  - apps/web/src/components/teams-table/teamFilterModel.test.ts
  - apps/web/src/components/teams-table/TeamsFilters.tsx
  - apps/web/src/components/teams-table/TeamsFilters.test.tsx
  - apps/web/src/components/teams-table/TeamsTable.tsx
  - apps/web/src/components/teams-table/TeamsTable.test.tsx
  - apps/web/src/routes/teams.tsx
  - apps/web/src/components/team/RankCards.tsx
  - apps/web/src/components/team/RankCards.test.tsx
  - apps/web/src/components/team/SeasonHeader.tsx
  - apps/web/src/components/team/SeasonHeader.test.tsx
  - apps/web/src/components/team/OverviewTab.tsx
  - apps/web/src/styles/theme.css
autonomous: true
requirements: []

estimate:
  tokens: 115000
  raw_tokens: 77000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The rank cards render INSIDE the same white card as the team identity block, right-aligned beside it, and wrap below the identity block at narrow widths rather than overflowing."
    - "No basis caption renders under the rank cards anywhere on the team page."
    - "Every rank card on a page has the SAME width regardless of its label's length; a label too long for that width truncates with the full text available on a `title` attribute."
    - "Each rank card is coloured by the rarity tier its own rank-within-its-own-pool falls in — rank 1 of a large pool renders Legendary, last of a large pool renders Common."
    - "The Teams page carries Country / State / District dropdowns whose selections live in the URL and survive a year change and an algorithm change."
    - "A teams artifact carrying NO region fields (a pre-republish artifact) renders the three dropdowns disabled and empty — no error, no phantom option, no crash."
    - "Clicking a rank card lands on the Teams page filtered to that card's own scope with the SAME year and algorithm, and the rank the Teams table then shows for that team equals the number that was printed on the card."
    - "Every row of the published teams/{year} artifact carries that team's derived country/stateProv/districtKey when they are derivable, and omits them when they are not."
  artifacts:
    - apps/web/src/components/teams-table/teamFilterModel.ts
    - apps/web/src/components/teams-table/teamFilterModel.test.ts
    - apps/web/src/components/teams-table/TeamsFilters.tsx
    - apps/web/src/components/teams-table/TeamsFilters.test.tsx
  key_links:
    - "teamRanks.ts `percentileForRank` -> lib/tiers.ts `tierForPercentile` -> theme.css `.rank-card--{tier}` (one percentile convention, one palette, no second set of cuts)"
    - "publish.ts `teamRegions` -> teamsRows region fields -> TeamsTableRowRawSchema -> teamFilterModel option lists (the filters cannot exist without the pipeline half)"
    - "RankCards `<Link>` search preset -> TeamsSearchSchema country/state/district -> applyTeamFilters pool -> buildTeamRows rank (the card's number and the destination table's number are the same computation over the same pool)"
---

<objective>
Rank cards v2 on the team page, and region filters on the Teams page — six user-requested
changes that are really one feature: make a rank card a *place you can go*, not just a number
you can read.

Purpose: quick task 260905-ldu shipped the four rank cards as an inert row of white boxes below
the season header. They read as an afterthought, they are all different widths, they carry no
sense of how good the number actually is, and clicking one does nothing. This task moves them
into the identity card where the eye already is, colours them with the rarity palette the rest
of the site already speaks, and wires each one to the Teams page filtered to that exact pool —
which requires the Teams page to *have* region filters, which requires the teams artifact to
carry region fields.

Output: region fields published on every teams-artifact row; Country/State/District filters on
the Teams page backed by typed URL search params; and four fixed-width, tier-coloured, clickable
rank cards laid out at the top-right of the season-header card.
</objective>

<the_invariant_this_task_rests_on>
Item 6 ("each rank card links to the Teams page with the matching filter preset") is only
honest if the destination agrees with the card. A District card reading `#3 of 60` that lands
on a table where the team shows `#250` is a broken promise, not a link.

The agreement is achievable by construction, and this plan requires it:

- `buildTeamRankScopes` computes the district card's rank as the target's position within
  "every real team whose `districtKey` equals the target's", sorted by `compareTeamsByTotal`.
- The Teams page, filtered to `?district=fim`, will filter the artifact's rows to exactly that
  same set and hand the result to `buildTeamRows`, which ranks with the SAME
  `compareTeamsByTotal`.

Same pool, same comparator, same number. This is why Task 2 filters rows BEFORE `buildTeamRows`
rather than after — filtering after would leave a World rank in the column while the card
promised a district rank. It is also why the State card's link must set BOTH `country=USA` and
`state=MI`: `buildTeamRankScopes`'s state pool is gated on country too, and a `state=MI`-only
filter would pool in any non-US region that also abbreviates to MI.

Task 3 asserts this agreement as a test, not as a comment.
</the_invariant_this_task_rests_on>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Prior task this builds directly on:
@.planning/quick/260905-ldu-on-every-team-page-add-rank-cards-for-th/260905-ldu-SUMMARY.md

Read before Task 1:
@packages/harness/teamRanks.ts   (the module being extended — `buildTeamRankScopes`, `deriveTeamRegions`, `USA_COUNTRY_VALUE`)
@packages/harness/percentiles.ts   (lines 45-80 — `percentileRanks`'s mid-rank formula, the convention Task 1 must reproduce)

Read before Task 2:
@apps/web/src/components/events-list/filterModel.ts   (the pattern to mirror: option-list derivation, the null-vs-Unknown rule, the two-letter state-code filter and its recorded reason)
@apps/web/src/components/events-list/EventFilters.tsx   (`StringDimensionSelect`, `ActiveFilterChips`, the disabled-when-empty rule)
@apps/web/src/routes/events.tsx   (the route-side URL wiring these filters mirror)

Read before Task 3:
@apps/web/src/components/team/SeasonHeader.tsx   (the card the cards move into)
@apps/web/src/lib/tiers.ts   (`tierForPercentile` — the ONLY tier-cut implementation; do not write a second one)
@apps/web/src/styles/theme.css   (lines 659-715 — `.metric-tier` and its modifiers, and the `--tier-*` tokens they consume)
</context>

<constraints>
**Concurrency (hard).** Other sessions share this checkout.

1. **Do not modify any file under `packages/core/`.** Importing from it is expected; editing it
   is not.
2. **Stage every commit by explicit path.** `git add <path> <path>` only — never `git add -A`,
   never `git add -u`, never `git commit -a`. Commit `f0c7af48` in this repo absorbed a
   concurrent session's edits exactly that way.
3. Run `git status --short` after each commit and confirm only your own paths moved.

**Test invocation.** Run `npx vitest run <explicit paths>` from the repo root. Do NOT use
`timeout <n> pnpm test` — that combination has produced a silent exit-0 with no output in this
repo before, and `pnpm test` run from `apps/web` sees only 77 of the repo's 167 test files.

**Typecheck.** `apps/worker` carries four pre-existing `tsc` errors (redDqs/blueDqs drift) that
predate 2026-09-05. If `npx tsc --noEmit` reports exactly those four and nothing else, that is
the known baseline, not a regression from this work.

**No network.** Do not run `pnpm publish:seasons` or any other network command — the executor
sandbox denies it, and the republish is a main-session step (see `<post_plan_note>`).
</constraints>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Region fields on the teams artifact, and the rank-to-percentile rule — pipeline end to end</name>
  <files>packages/harness/teamRanks.ts, packages/harness/teamRanks.test.ts, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts, packages/harness/publish.ts, packages/harness/publish.test.ts</files>
  <read_first>
    `packages/harness/teamRanks.ts` in full (the module being extended).
    `packages/harness/percentiles.ts` lines 45-80 — `percentileRanks`'s mid-rank formula
    `((countStrictlyBelow + 0.5 * countEqual) / n) * 100`, which the new `percentileForRank`
    must reproduce rather than invent a second convention beside.
    `packages/harness/pageArtifacts.ts` lines 978-1051 — `TeamsTableRowRawSchema`,
    `TeamsArtifactWireSchema`'s positional-metrics `.refine()`, and the decoding transform.
    `packages/harness/publish.ts` lines 757-816 (`TeamsArtifactTeamInput`,
    `buildTeamsArtifact`, `roundTeamMetricRecord`'s call site) and lines 1822-1996 (the
    once-per-season `deriveTeamRegions` call, `teamsRows` construction, `rankableTeamRows`).
    `packages/harness/publish.test.ts` lines 2623-2712 — the ldu cross-artifact agreement test
    and its `seasonEvent({ country, stateProv, districtKey })` fixture helper.
  </read_first>
  <behavior>
    `percentileForRank(rank, total)`:
    - Rank 1 of 3481 yields a value at or above 95 (the Legendary cut) — being first in a large
      pool is the top tier, which is the whole point of colouring the card.
    - Rank 3481 of 3481 yields a value below 50 (the Common band).
    - The value it returns for rank r in a pool of n equals what `percentileRanks` would return
      for the r-th-best member of a strictly-ordered pool of n — asserted directly against
      `percentileRanks` for at least one non-trivial pool, so the two conventions cannot drift.
    - Rank 1 of 1 yields exactly 50. This is a DELIBERATE, tested outcome, not an edge case that
      slipped through: under the mid-rank convention a pool of one carries no information about
      whether its single member is good, so it lands mid-band rather than Legendary. Asserted
      explicitly so a later reader knows it was decided.
    - Monotonic: for a fixed `total`, a better (lower) rank never returns a lower percentile.
    - The result is always within the closed interval [0, 100], so `tierForPercentile`'s
      out-of-range guard (which returns `undefined`) can never be reached from this function.

    `TeamsTableRowRawSchema`:
    - Parses a row with none of `country`/`stateProv`/`districtKey` — the pre-republish
      back-compat case — and yields all three as `undefined`.
    - Parses a row carrying all three as strings.
    - Rejects a non-string value in any of the three.
    - The positional-metrics encoding is unaffected: an artifact whose rows carry both region
      fields and positional `metrics` still parses and still decodes `metrics` to record form.

    `buildTeamsArtifact`:
    - Given a team input with region fields, emits them on that row.
    - Given a team input with none, omits the keys entirely rather than emitting `null` or `""`
      — absence means "not derivable", the same contract `deriveTeamRegions` already states.

    `publishSeasons`, end to end against a seeded corpus (extend the ldu describe block's
    fixture shape — a Michigan `fim` event already exists there):
    - Every real team that played only at a `USA`/`MI`/`fim` event has exactly
      `country: "USA"`, `stateProv: "MI"`, `districtKey: "fim"` on its row of the published
      teams/{year} artifact, read back through `TeamsArtifactSchema.parse`.
    - The ldu World-rank cross-artifact agreement test still passes unchanged.
    - NEW, and the reason the rounding change below exists: for every real team, the World rank
      published on its own artifact equals its index+1 in the teams artifact's rows sorted by
      `compareTeamsByTotal` **after those rows have been through the wire round-trip** — i.e.
      asserted against the parsed artifact's ROUNDED metrics, which is the only thing a browser
      ever sees.
  </behavior>
  <action>
    **`packages/harness/teamRanks.ts`** — add one exported function,
    `percentileForRank(rank: number, total: number): number`, returning
    `((total - rank) + 0.5) / total * 100`.

    Document in its header WHY that expression and not something simpler: it is
    `percentiles.ts`'s `percentileRanks` mid-rank formula
    (`((countStrictlyBelow + 0.5 * countEqual) / n) * 100`) specialised to a strict total order,
    where a member at 1-based rank r has exactly `total - r` members strictly below it and
    exactly one member equal to it (itself). `compareTeamsByTotal` produces a strict total order
    by construction (its team-number tie-break guarantees it), so that specialisation is exact,
    not approximate. State plainly that the site already has exactly one percentile convention
    and this function joins it rather than opening a second one — a rank card tinted by a
    different convention than the metric tile beside it would be the same class of drift this
    project's failure log names.

    Do NOT round the result. `roundTo`/`ROUNDING_RULE` are not imported here (this module is
    dependency-free by contract and `browserSafeSchemas.test.ts` enforces it), and rounding
    would serve no reader: the value is never displayed, only compared against
    `tierForPercentile`'s cuts, where rounding could only ever move a borderline card into a
    tier its exact position does not occupy. Say so in the doc comment.

    **`packages/harness/pageArtifacts.ts`** — add three optional string fields to
    `TeamsTableRowRawSchema`: `country`, `stateProv`, `districtKey`. Document them with the same
    argument `EventsListRowSchema` and `TeamSeasonArtifactSchema.ranks` already record: additive
    optional fields on one page kind are backward-compatible for every reader, so
    `PAGE_ARTIFACT_SCHEMA_VERSION` is deliberately NOT bumped — the same precedent quick task
    260905-ldu set one day earlier for the same artifact family. Note that these are the
    *inferred* home region (`deriveTeamRegions`'s own honesty note applies verbatim — the corpus
    has no team addresses), so a consumer must never present them as TBA ground truth.

    **`packages/harness/publish.ts`** — three changes:

    1. Widen `TeamsArtifactTeamInput` with the same three optional fields, and thread them
       through `buildTeamsArtifact`'s `roundedTeams` mapping, spreading only the keys that are
       present so an underivable field never becomes a key on the wire.
    2. In the `teamsRows` construction, spread `teamRegions.get(teamKey)` onto each row. The map
       is already computed once per season, before the per-algorithm loop, by the ldu change
       directly above — reuse it, do not call `deriveTeamRegions` a second time.
    3. Build `rankableTeamRows`' `metrics` from `roundTeamMetricRecord(row.metrics)` rather than
       the raw `row.metrics`. Attach the reason at the call site: `buildTeamsArtifact` rounds
       every metric to `ROUNDING_RULE.metric` before writing, so the browser sorts ROUNDED
       values. Rounding can collapse two distinct totals into one, and a collapsed pair is
       re-ordered by the team-number tie-break — meaning the rank computed here from unrounded
       values could differ by one place from the rank a client computes from the published
       artifact. That gap was invisible while the rank was only a decorative number; the moment
       a rank card LINKS to a table that recomputes the same rank (this task's item 6), the two
       must agree on real data and not merely on fixtures.

    Add the schema and builder cases to `pageArtifacts.test.ts`/`publish.test.ts`, and extend
    the ldu seeded-corpus describe block in `publish.test.ts` with the end-to-end region-field
    and post-round-trip agreement assertions from the behavior block.

    Commit with explicit paths only.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/teamRanks.test.ts packages/harness/pageArtifacts.test.ts packages/harness/publish.test.ts packages/harness/browserSafeSchemas.test.ts</automated>
  </verify>
  <done>
    `percentileForRank` exists, agrees with `percentileRanks` on a shared fixture, and maps rank
    1 of a large pool above the Legendary cut; `TeamsTableRowRawSchema` parses rows both with
    and without region fields; a seeded `publishSeasons` run puts `USA`/`MI`/`fim` on the
    published teams rows; World rank agrees with the artifact after the wire round-trip;
    `git status --short` shows only this task's six files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Country / State / District filters on the Teams page</name>
  <files>apps/web/src/lib/searchParams.ts, apps/web/src/components/teams-table/teamFilterModel.ts, apps/web/src/components/teams-table/teamFilterModel.test.ts, apps/web/src/components/teams-table/TeamsFilters.tsx, apps/web/src/components/teams-table/TeamsFilters.test.tsx, apps/web/src/components/teams-table/TeamsTable.tsx, apps/web/src/components/teams-table/TeamsTable.test.tsx, apps/web/src/routes/teams.tsx</files>
  <read_first>
    `apps/web/src/components/events-list/filterModel.ts` in full — the pattern being mirrored,
    including its null-vs-Unknown header rule and the recorded reason the state dimension keeps
    only two-letter alpha codes.
    `apps/web/src/components/events-list/EventFilters.tsx` — `StringDimensionSelect`,
    `ActiveFilterChips`, `countActive`, and the disabled-when-no-values rule.
    `apps/web/src/components/events-list/EventFilters.test.tsx` lines 1-60 — this repo's
    filter-component testing conventions.
    `apps/web/src/routes/events.tsx` — the route-side URL wiring (`handleFiltersChange`,
    `handleClearFilters`, options derived from UNFILTERED rows).
    `apps/web/src/lib/searchParams.ts` — `TeamsSearchSchema` and `EventsSearchSchema`'s
    `country`/`state`/`district` fields with their `.catch(undefined)` discipline.
    `apps/web/src/routes/teams.tsx` and `apps/web/src/components/teams-table/rowModel.ts`.
    `apps/web/src/components/teams-table/TeamsTable.tsx` lines 40-120 (props and the `empty`
    branch) and `apps/web/src/components/StateViews.tsx` (`EmptyState`'s `onClearFilters`).
  </read_first>
  <behavior>
    `teamFilterOptions(rows)`:
    - Returns the distinct non-absent `country`, `stateProv` and `districtKey` values present in
      `rows`, each sorted with `localeCompare`.
    - A dimension where no row carries a value yields an EMPTY list — the signal the control
      uses to render itself disabled. A pre-republish artifact (no region fields on any row)
      therefore yields three empty lists.
    - Only rows whose `teamKey` passes `isRealTeamKey` contribute options, matching the pool
      every ranking surface on this site already uses.
    - The state dimension keeps only values matching `/^[A-Za-z]{2}$/`, for the identical
      recorded reason `filterModel.ts` gives (TBA's `state_prov` mixes real codes with numerics
      and long region names). A value dropped here stays reachable through its country.
    - Absence is never coerced into a bucket: no "Unknown" or "" option is ever offered.

    `applyTeamFilters(rows, filters)`:
    - An unset dimension does not filter.
    - Each set dimension is strict equality; a row whose value on that dimension is absent can
      never match a set filter.
    - Two set dimensions intersect (`country: "USA"` + `state: "MI"` yields only US Michigan
      rows).
    - A filter value matching nothing yields an empty array, not an error.

    `TeamsFilters` component:
    - Renders three labelled selects — Country, State, District — with an "All ..." option each.
    - Choosing a value invokes `onFiltersChange` with that dimension patched onto the current
      filters; choosing "All" patches it to `undefined`.
    - District options display through `districtDisplayName` (a `fim` option reads its
      reader-facing name, never the raw key), the other two display their raw published value.
    - A dimension with zero options renders its control DISABLED — the pre-republish state
      renders three disabled controls, no error, no crash.
    - "Clear filters" renders only when at least one dimension is set, and invokes
      `onClearFilters`.
    - Active dimensions render as chips, district chips again through `districtDisplayName`.

    `TeamsTable` empty state:
    - With no active filter, the existing year-gap copy is unchanged.
    - With an active filter and zero rows, the empty state names the filters as the cause and
      offers a Clear-filters action.

    Route wiring (`routes/teams.tsx`) — verified through the component/model tests plus
    `tsc`, following this repo's existing practice of not unit-testing route files:
    - `country`/`state`/`district` are read from the validated search and passed down.
    - Option lists derive from the UNFILTERED rows, so selecting a country does not empty the
      district list.
    - Rows are filtered BEFORE `buildTeamRows`, so the rank column is the rank within the
      current filter — see this plan's `<the_invariant_this_task_rests_on>`.
  </behavior>
  <action>
    **`apps/web/src/lib/searchParams.ts`** — extend `TeamsSearchSchema` with `country`, `state`
    and `district`, each `z.string().optional().catch(undefined)`, copying
    `EventsSearchSchema`'s own doc-comment reasoning for why these stay plain optional strings
    rather than a closed enum (their valid value set is data-dependent, and a value matching no
    real option is not an error — it is an ordinary filter that matches nothing, yielding the
    table's empty state rather than an undefined page state). Note explicitly that these three
    names are safe to share with `EventsSearchSchema` — unlike `sort`, which `applyYearChange`
    rewrites and which is exactly why the Events page had to name its own field `eventSort` —
    because `applyYearChange` touches only the literal key `sort` and passes everything else
    through its `...current` spread untouched. That is what makes a year change preserve these
    filters for free.

    **`apps/web/src/components/teams-table/teamFilterModel.ts`** (new) — a React-free pure
    module mirroring `events-list/filterModel.ts`. Export `TeamFilterRow` (aliased from
    `TeamsArtifact["teams"][number]`), a `TeamFilters` interface with the three optional
    dimensions, `teamFilterOptions`, and `applyTeamFilters`, all per the behavior block.

    Carry the null-vs-absent rule across in the module header, adjusted for the one real
    difference from the Events model: an event's geo fields are NULLABLE (`null` means "TBA
    published no value"), while a team's are OPTIONAL (absent means "not derivable from where
    this team competed, or this artifact predates the field existing"). Both resolve to the same
    filtering behavior — a row with no value on a dimension can never match a set filter on it —
    but a reader comparing the two files should find the difference named rather than have to
    infer it. Also state that these values are INFERRED from attended events
    (`deriveTeamRegions`), not a team's registered address.

    Do not import from `events-list/` — that is the same cross-module boundary
    `SeasonHeader.tsx` already refuses to cross (it copies `formatRecord` rather than importing
    it from `teams-table/`). Where a helper is genuinely the same twenty lines, copy it with a
    doc comment naming the source file, exactly as that precedent does.

    **`apps/web/src/components/teams-table/TeamsFilters.tsx`** (new) — the control row, with the
    same props shape `EventFilters` uses (`rows`, `filters`, `onFiltersChange`,
    `onClearFilters`) and the same discipline: filter state never lives here, the route owns
    reading and writing the URL. Copy `StringDimensionSelect` and `ActiveFilterChips` across the
    module boundary per the rule above, dropping the week dimension.

    Render ONE wrapping control row for both viewports — deliberately no mobile sheet. Record
    the reason in the component header so it does not read as an oversight: the Events page's
    sheet exists because of D-15's staged "Apply filters" decision over four dimensions; this
    page has three dimensions and no staged-apply decision, and three controls sized as the
    Events row already sizes them (`w-full max-w-[10rem] sm:w-auto`) wrap cleanly at phone width
    inside a `flex flex-wrap` row. If a fourth dimension is ever added here, revisit.

    **`apps/web/src/components/teams-table/TeamsTable.tsx`** — add two optional props,
    `hasActiveFilter` and `onClearFilters`, and branch the `empty` return: with an active filter
    the heading and body name the filters as the cause and `onClearFilters` is passed to
    `EmptyState` (which renders its Clear-filters button only when supplied); with no active
    filter the existing year-gap copy is untouched. Mirror `EventsList.tsx`'s own empty branch.
    This is not scope creep: without it, this task ships a filter whose zero-result state tells
    the reader to check a different year, which is the wrong diagnosis and an unrecoverable dead
    end on a phone.

    **`apps/web/src/routes/teams.tsx`** — read the three params from `Route.useSearch()`, build
    a `TeamFilters` object, render `<TeamsFilters>` above the table (inside the existing centred
    `w-fit` column, `mb-[var(--spacing-md)]`, only when `status === "success"`, matching the
    Events page's own placement and its recorded reason for gating on success). Derive the
    component's option lists from `data.teams` UNFILTERED. Add `handleFiltersChange` and
    `handleClearFilters` using the `search: (prev) => ({ ...prev, ... })` updater form so year,
    algorithm, sort and `cols` all survive.

    In the `rows` memo, apply `applyTeamFilters` to `data.teams` and pass
    `{ ...data, teams: filtered }` into `buildTeamRows`, so the rank column is the rank within
    the active filter. Attach the reasoning from this plan's `<the_invariant_this_task_rests_on>`
    section as a comment at that call site, naming both halves: the rank cards' links depend on
    it, and it is also what a reader coming from Statbotics expects a filtered ranking to mean.
    Add `filters` to the memo's dependency array.

    Write `teamFilterModel.test.ts` and `TeamsFilters.test.tsx` covering every behavior case,
    following `filterModel.test.ts`/`EventFilters.test.tsx`'s fixture and render conventions,
    and extend `TeamsTable.test.tsx` with the two empty-state branches. Commit with explicit
    paths only.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table apps/web/src/lib</automated>
  </verify>
  <done>
    Three dropdowns render on the Teams page and write their selections to the URL; a
    region-less artifact renders them disabled with no error; filtered rows are ranked within
    the filter; the filtered-to-zero empty state offers Clear filters; `npx tsc --noEmit`
    reports only the four known `apps/worker` baseline errors; `git status --short` shows only
    this task's eight files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Rank cards v2 — into the header card, fixed width, tier-coloured, clickable</name>
  <files>apps/web/src/components/team/RankCards.tsx, apps/web/src/components/team/RankCards.test.tsx, apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/components/team/SeasonHeader.test.tsx, apps/web/src/components/team/OverviewTab.tsx, apps/web/src/styles/theme.css</files>
  <read_first>
    **Load `Skill("sketch-findings-sigmascout")` BEFORE writing any JSX or CSS in this task.** It
    carries the decided rarity-tier palette, the rule that green is ink rather than paint, and
    the accessibility/contrast constraints the tier colours were validated under — item 4 of
    this task is exactly the case that skill exists for. Do not introduce a colour value that is
    not already a `--tier-*` token.

    Then read: `apps/web/src/components/team/SeasonHeader.tsx` (the identity row the cards move
    into, and its `data-testid="season-header-as-of"` line);
    `apps/web/src/components/team/OverviewTab.tsx` (the `.data-card` wrapper and the current
    mount point being removed); `apps/web/src/lib/tiers.ts` (`tierForPercentile` — the only tier
    cuts on this site); `apps/web/src/styles/theme.css` lines 659-715 (`.metric-tier` and its
    modifiers, and the `--tier-*` tokens); `apps/web/src/lib/districtNames.ts`;
    `apps/web/src/components/teams-table/TeamsTable.test.tsx` and/or
    `apps/web/src/components/events-list/EventsList.test.tsx` — find the router harness this
    repo already uses to render TanStack `Link`s under test and REUSE it; do not hand-roll a
    second one.
  </read_first>
  <behavior>
    Layout and placement:
    - The rank cards render inside the season-header identity row, after the identity block, in
      a container that pushes them to the row's right edge.
    - The row wraps: at narrow widths the cards fall below the identity block rather than
      overflowing or shrinking the team name.
    - `OverviewTab` no longer renders `RankCards` itself; a test asserts the cards appear when
      the header is rendered.
    - The metric grid still spans the full card width below, unchanged.

    Caption:
    - No element with `data-testid="rank-cards-basis"` exists anywhere in the rendered team
      page — asserted by testid, in both the four-card and single-card cases.

    Width:
    - All four cards report the same shared CSS class carrying the fixed width; no card's width
      is a function of its label.
    - A long district label (`fma` renders as `FIRST Mid-Atlantic`) truncates rather than
      widening the card, and the full label is available on a `title` attribute.

    Tier colour:
    - A card at rank 1 of 3481 carries the Legendary modifier class; rank 3481 of 3481 carries
      the Common modifier; a mid-pool rank carries the band `tierForPercentile` puts its
      `percentileForRank` value in.
    - The tier is derived per card from that card's OWN rank and total, so the four cards on one
      team page can and do carry different tiers (a team can be Common in the world and
      Legendary in its district) — asserted with a fixture that produces at least two different
      tiers on one render.
    - No card ever carries `.metric-tier` itself.

    Links:
    - The World card links to `/teams` with the page's current `year` and `algorithm` and no
      region params.
    - The Country card adds `country={value}`; the District card adds `district={value}`; the
      State card adds BOTH `country=USA` (from `USA_COUNTRY_VALUE`, never a re-typed literal)
      and `state={value}`.
    - Every card's href carries the year and algorithm the page is currently showing — asserted
      against a non-default algorithm and a non-current year, so a hardcoded default would fail.
    - **The agreement test:** for a fixture set of team rows, a district scope computed by
      `buildTeamRankScopes` and the rank `buildTeamRows` computes after `applyTeamFilters` with
      that card's own link preset produce the SAME rank and the SAME total. Assert this for the
      district and the state scope (the two whose pools are non-trivial). This is the test that
      makes item 6 a promise rather than a hope.
    - Each card remains a single accessible unit: its scope label and its numbers are announced
      together, and the link's accessible name identifies where it goes.
    - `ranks` absent or empty still renders nothing at all.
  </behavior>
  <action>
    **`apps/web/src/styles/theme.css`** — add a `.rank-card` block and four
    `.rank-card--{tier}` modifiers, placed AFTER the existing `.data-card` rule so the tier
    background wins at equal specificity (note that ordering dependency in the comment — it is
    load-bearing, not incidental).

    `.rank-card` carries the ONE fixed width every card shares plus the card's own geometry.
    Do not reuse `.metric-tier` for this: its `min-width: 58px`, `display: inline-block` and
    `text-align: right` are tuned for a numeric cell in an aligned column, and a card is neither.
    Say that in the comment so a later reader does not "simplify" the two together.

    Each `.rank-card--{tier}` sets background and foreground from the existing
    `--tier-{tier}-bg`/`--tier-{tier}-fg` tokens, and Common uses the same hairline
    `box-shadow: inset 0 0 0 1px var(--tier-common-edge)` treatment `.metric-tier--common`
    already uses, for the reason recorded there (an inset shadow paints inside the box and
    contributes nothing to layout, so a Common card's bounding box stays identical to a filled
    one's). Introduce no new colour values — the palette is the skill's, already validated for
    contrast.

    **`apps/web/src/components/team/RankCards.tsx`** — rewrite:

    - Props gain `season: number` and `algorithmId` (the value the page is currently showing),
      needed to build the links. Keep the absent/empty early return exactly as it is.
    - Each card becomes a TanStack Router `<Link to="/teams" search={...}>`. Build the search
      object per scope: `{ year: season, algorithm: algorithmId }` for World, plus
      `country: entry.value` / `district: entry.value` / `{ country: USA_COUNTRY_VALUE, state: entry.value }`
      for the other three. Import `USA_COUNTRY_VALUE` from
      `packages/harness/teamRanks.js` rather than re-typing the string — that constant exists
      precisely so the pipeline's state-pool gate and every UI that reproduces it spell it
      identically. Comment the State case with the reason it sets country too (the pool
      `buildTeamRankScopes` ranked within is gated on country as well as state, so a
      state-only link would land on a different, larger pool than the card's number describes).
    - Derive each card's tier with `tierForPercentile(percentileForRank(entry.rank, entry.total))`
      and apply `.rank-card`, `.rank-card--{tier}` via `cn()`. Do not write a second set of tier
      cuts here — `lib/tiers.ts` is the only implementation, and `percentileForRank` (Task 1) is
      the only rank-to-percentile rule.
    - Apply `.rank-card`'s shared class to every card and `truncate` + `title={label}` to the
      scope label so a long district name shortens instead of stretching its card.
    - **Delete the basis caption** — the `data-testid="rank-cards-basis"` span reading
      "Ranked by total, official play only" and the wrapping `flex-col` container it needed.
      What remains is the wrapping card row alone. Record in the module header why removing it
      does not reopen IN-01: the cards now sit inside the same card as
      `data-testid="season-header-as-of"`, and the ranks are computed from the same
      last-official-match snapshot pool that as-of line already labels (publish.ts ranks
      `teamsRows`, whose metrics are `officialMetricsByTeamWithPercentiles`). Also record the
      one residual, honestly, rather than leaving it for someone to rediscover: when no snapshot
      is derivable the as-of line reads season-final while the ranks remain official-only, so
      that branch is now unlabelled for the ranks specifically. Accepted per the user's explicit
      request to remove the caption; noted here so a future reader knows it was weighed.

    **`apps/web/src/components/team/SeasonHeader.tsx`** — accept `ranks` (typed
    `TeamSeasonArtifact["ranks"]`) and render `<RankCards>` inside the top identity row.

    Restructure that row's outer div to `flex flex-wrap items-start justify-between` with the
    existing avatar-plus-identity block as the first child (keeping its own `min-w-0` so the
    nickname still truncates rather than pushing the cards off) and `<RankCards>` as the second.
    That yields the mockup exactly: cards right-aligned beside the identity block at wide
    widths, wrapping below it at narrow ones. Leave the metric-grid section below untouched and
    full-width.

    For the link's `algorithm` search param to typecheck against `TeamsSearchSchema`, thread a
    properly-narrowed algorithm id: change `SeasonHeaderProps.algorithmId` and
    `OverviewTabProps.algorithmId` from `string` to `PublishedAlgorithmId` (imported from
    `packages/harness/publishedAlgorithms.js`). Every real caller already passes
    `Route.useSearch().algorithm`, which has exactly that type, so this narrows a prop rather
    than changing any runtime value, and `tsc` proves it. **Bound on this change:** if narrowing
    turns out to cascade beyond these two components, their tests, and
    `routes/team.$teamNumber.tsx`, STOP — revert the narrowing, leave both props as `string`,
    and thread a separately-typed `algorithm` prop from the route to `RankCards` instead. Do not
    reach for a type assertion in either case.

    **`apps/web/src/components/team/OverviewTab.tsx`** — remove the standalone `<RankCards>`
    render and its comment, and pass `artifact.ranks` down to `SeasonHeader` instead.

    Update `RankCards.test.tsx` for the new props, the deleted caption, the tier classes, the
    fixed-width class, and the link hrefs, and add the agreement test from the behavior block.
    Add a `SeasonHeader.test.tsx` case asserting the cards render inside the header. Commit with
    explicit paths only.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/team apps/web/src/components/teams-table</automated>
  </verify>
  <done>
    The cards render inside the season-header identity row, right-aligned, wrapping below at
    narrow widths; no `rank-cards-basis` element exists; all cards share one width class and
    truncate long labels with a `title`; each card carries the `.rank-card--{tier}` modifier its
    own rank/total percentile selects; each card is a `/teams` link carrying the current year
    and algorithm plus its scope preset; the district and state agreement tests pass;
    `npx tsc --noEmit` reports only the four known `apps/worker` baseline errors;
    `git status --short` shows only this task's files.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA API → corpus | Third-party event geo (`country`, `state_prov`, `district.abbreviation`) already crosses here and is already Zod-validated at ingest. This task adds a second consumer of it (the teams artifact), not a new boundary. |
| pipeline → R2 artifact → browser | The three new teams-row region fields cross here and are Zod-validated on read by `TeamsTableRowRawSchema`. |
| URL → browser | `?country=`/`?state=`/`?district=` are attacker-controllable via a shared link, validated by `TeamsSearchSchema` before any component reads them. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ttv-01 | Tampering | `TeamsTableRowRawSchema` region fields | low | mitigate | All three are `z.string().optional()`; a non-string fails the existing parse-or-throw path in `lib/api/teams.ts` before any row renders. A hostile *string* can only ever add one filter option that matches the rows already carrying it — it cannot reach a query, a selector, or a fetch URL. |
| T-ttv-02 | Tampering | `TeamsSearchSchema` `country`/`state`/`district` | low | mitigate | Validated to plain optional strings with `.catch(undefined)`, then used only for `===` comparison in `applyTeamFilters` and as React text children (auto-escaped). A hand-edited value matching nothing yields the table's own filtered-to-zero empty state, never an undefined page state — the same T-05-02 argument `EventsSearchSchema` already records. |
| T-ttv-03 | Spoofing | `RankCards` `<Link>` targets | low | mitigate | Every link is a same-app `<Link to="/teams">` with a search object built from closed, per-scope code paths — no href is ever assembled from a raw artifact string, so a hostile `value` cannot redirect off-site. |
| T-ttv-04 | Repudiation | rank-card tier colour | medium | mitigate | A tier colour is a strong claim about how good a number is. It is derived through exactly one percentile convention (`percentileForRank`, asserted equal to `percentileRanks`) and exactly one set of cuts (`tierForPercentile`), so a card's colour cannot disagree with the metric tile beside it. The rank-1-of-1 → mid-band outcome is asserted as a deliberate decision rather than left to emerge. |
| T-ttv-05 | Information disclosure | Teams-page region filters | low | accept | Every value exposed is public FRC competition geography already published on the Events page. |
| T-ttv-SC | Tampering | npm/pip/cargo installs | n/a | n/a | This plan installs no packages. No `## Package Legitimacy Audit` is required. |
</threat_model>

<verification>
After all three tasks:

1. `npx vitest run packages/harness apps/web/src/components/team apps/web/src/components/teams-table apps/web/src/lib` — the harness and every touched web surface green.
2. `npx tsc --noEmit` — clean apart from the four known pre-existing `apps/worker`
   redDqs/blueDqs errors that predate 2026-09-05. Any error naming a file this plan touched is
   a real regression.
3. `git log --oneline -3` and `git status --short` — three commits, each staged by explicit
   path, nothing from `packages/core/` in any of them.
</verification>

<success_criteria>
- Every `must_haves.truths` entry holds.
- The rank a rank card prints and the rank the Teams table shows under that card's own link
  preset are the same number, proven by a test and not by a comment.
- Exactly one percentile convention and one set of tier cuts exist on this site after this task,
  as before it.
- No file under `packages/core/` was modified; no commit was staged with `git add -A`,
  `git add -u`, or `git commit -a`.
</success_criteria>

<post_plan_note>
**The Teams-page filters stay disabled on the live site until a republish.** The three region
fields are new optional fields, so every teams artifact currently in R2 lacks them and all three
dropdowns will render disabled-and-empty until `pnpm publish:seasons` runs. That is the designed
degradation, not a defect — but it means this task is not *done* on the live site until the
republish lands, and item 6's links will land on a table that cannot honour their filters until
then.

Three operational facts govern that step, all recorded from prior runs in this repo:

1. **Run the publish from the main session, not from an executor subagent.** Executor sandboxes
   deny all network Bash, including `pnpm publish:seasons`.
2. **`docs/publish-budget.md` is a manual step.** `publish:seasons` prints its summary but does
   not write the document; the new numbers must be transcribed into the machine-readable block
   or `packages/harness/payloadBudget.test.ts` goes red.
3. **Budget headroom for this change is comfortable, and here is the arithmetic so the next run
   can confirm rather than assume.** The `teams` page kind currently measures
   `maxBytes: 1,486,941` against `budgetMaxBytes: 3,500,000` — 2,013,059 bytes of headroom, the
   largest of any page kind. Three short string fields per row across roughly 3,700 rows is on
   the order of 130–190 KB, well inside that. The kind to watch after this run is still `team`
   (376,339 against 400,000), which this task does not add to.

A republish is already pending on user signal from quick tasks 260905-jj8 and 260905-ldu; this
change can ride along with that run rather than triggering a separate one. When it lands, spot
check one team page's rank cards (colours differ across the four scopes) and one rank-card click
(the destination table's rank for that team matches the card).
</post_plan_note>

<output>
Create `.planning/quick/260905-ttv-team-page-rank-cards-v2-and-teams-page-r/260905-ttv-SUMMARY.md` when done.
</output>
</content>
</invoke>
