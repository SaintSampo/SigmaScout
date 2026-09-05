---
phase: quick-260905-ldu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/teamRanks.ts
  - packages/harness/teamRanks.test.ts
  - packages/harness/browserSafeSchemas.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - apps/web/src/components/teams-table/rowModel.ts
  - apps/web/src/lib/teamKey.ts
  - apps/web/src/components/team/RankCards.tsx
  - apps/web/src/components/team/RankCards.test.tsx
  - apps/web/src/components/team/OverviewTab.tsx
autonomous: true
requirements: []

estimate:
  tokens: 95000
  raw_tokens: 63000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A team page whose artifact carries ranks shows a World rank card reading `#{rank} of {total}` for the selected algorithm and year."
    - "A team whose home district is derivable additionally shows a district rank card, labelled with the district's reader-facing name (FIRST MI), never the raw key (fim)."
    - "A US team additionally shows a US-state rank card; a non-US team shows no state card."
    - "At most four rank cards ever render, in the order World, Country, District, State."
    - "A team page reading a pre-republish artifact (no `ranks` field) renders no rank cards, no error, and no placeholder numbers."
    - "The World rank published on a team's artifact equals the rank the Teams table computes for that same team from the same season/algorithm, because both read one shared comparator."
  artifacts:
    - packages/harness/teamRanks.ts
    - packages/harness/teamRanks.test.ts
    - apps/web/src/components/team/RankCards.tsx
    - apps/web/src/components/team/RankCards.test.tsx
  key_links:
    - "publish.ts -> teamRanks.ts: home region derived once per season from attended events, before the per-algorithm loop"
    - "publish.ts -> buildTeamSeasonArtifact -> TeamSeasonArtifactSchema.ranks (new optional field)"
    - "OverviewTab.tsx -> RankCards.tsx, reading artifact.ranks"
    - "teams-table/rowModel.ts -> teamRanks.ts comparator (single implementation, no drift with the published rank)"
---

<objective>
Add up to four rank cards to every team page — World, Country, District, US State — for the
currently selected algorithm (VPR / EPA / OPR) and year.

Purpose: a team's number on its own page currently has no positional context. "37.2 ± 3.1" does
not tell a student whether that is top ten in the world or middle of their district. Rank does.

Output: the four ranks are computed and published on the per-team artifact by the offline
pipeline (not fetched client-side — see the sizing note below), a shared comparator guarantees the
World rank cannot disagree with the Teams table, and the team page renders the cards under the
season header.
</objective>

<why_the_pipeline_computes_this>
The obvious client-side design — fetch the teams artifact on the team page and rank in the browser
— was rejected on measurement, not taste. `docs/publish-budget.md`'s machine-readable block records
the teams artifact at `maxBytes: 1,486,941` (2026/vpr), roughly 400KB gzipped, against a team
artifact whose median is 29,776 bytes. That design would multiply the team page's payload by
roughly ten to render four numbers, on a project whose top stated UX constraint is page-load speed.
`SearchBox.tsx` already refuses to fetch that artifact eagerly for exactly this reason (its "D-10's
lazy fetch" comment).

Publishing four numbers on the per-team artifact costs on the order of 200 bytes against a 400KB
budget ceiling and zero additional client requests.

The cost of that choice, stated plainly: **nothing renders until the next republish.** The cards
are gated on `artifact.ranks` being present, and a browser holding a pre-republish artifact shows
no cards at all. That is the same optional-field, graceful-absence contract `robotImageUrl`,
`activeYears`, and `TeamSeasonEventSchema.rank`/`totalTeams` already use in this file.
</why_the_pipeline_computes_this>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Read before Task 1:
@packages/harness/pageArtifacts.ts   (lines 1053-1155 — TeamSeasonArtifactSchema and EventsListRowSchema's nullable-geo precedent)
@packages/core/algorithms/eventTypes.ts   (READ ONLY — isOfficialEventType; see the concurrency constraint below)
@apps/web/src/lib/teamKey.ts   (isRealTeamKey — the rule the pipeline must share, not re-derive)
@apps/web/src/components/teams-table/rowModel.ts   (buildTeamRows — the exact ranking rule the published World rank must reproduce)

Read before Task 3:
@apps/web/src/components/team/SeasonHeader.tsx   (the card this sits under; its as-of labelling discipline)
@apps/web/src/components/team/OverviewTab.tsx
@apps/web/src/lib/districtNames.ts   (districtDisplayName — the client formats district labels, the pipeline publishes raw keys)
</context>

<constraints>
**Concurrency (hard).** Another session is editing `packages/core/algorithms/sigma1/` in this same
checkout right now.

1. **Do not modify any file under `packages/core/`.** Importing from it (`eventTypes.ts`,
   `types.ts`) is expected and fine; editing it is not.
2. **Stage every commit by explicit path.** `git add packages/harness/teamRanks.ts packages/harness/teamRanks.test.ts`,
   never `git add -A`, never `git add -u`, never `git commit -a`. A prior task in this repo
   (f0c7af48) absorbed a concurrent session's edits exactly this way.
3. Run `git status --short` after each commit and confirm only your own paths moved.

**Test invocation.** Run `npx vitest run <explicit paths>` from the repo root. Do NOT use
`timeout <n> pnpm test` — that combination has produced a silent exit-0 with no output in this repo
before, and `pnpm test` from `apps/web` sees only 77 of the repo's 167 test files.

**Typecheck.** `apps/worker` carries four pre-existing `tsc` errors (redDqs/blueDqs drift) that
predate 2026-09-05. If `npx tsc --noEmit` reports exactly those four and nothing else, that is the
known baseline, not a regression from this work.
</constraints>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Shared home-region derivation and scoped ranking — one pure module, end to end</name>
  <files>packages/harness/teamRanks.ts, packages/harness/teamRanks.test.ts, packages/harness/browserSafeSchemas.test.ts</files>
  <read_first>
    apps/web/src/components/teams-table/rowModel.ts (the `buildTeamRows` ranking rule this module
    must become the single home of), apps/web/src/lib/teamKey.ts (`isRealTeamKey`),
    packages/core/algorithms/eventTypes.ts (`isOfficialEventType`, `OFFSEASON_EVENT_TYPE`,
    `PRESEASON_EVENT_TYPE`), packages/core/algorithms/types.ts (`TOTAL_METRIC_KEY`).
  </read_first>
  <behavior>
    `deriveTeamRegions`:
    - A team playing three events in Michigan, all `districtKey: "fim"` — resolves country "USA",
      stateProv "MI", districtKey "fim".
    - A team playing two `fim` district events plus the FIRST Championship in Houston (eventType 4,
      `districtKey: null`, stateProv "TX") — still resolves "USA"/"MI"/"fim". A neutral-site
      championship must not relocate a team.
    - A team playing one Ontario district event and one New York regional — country and stateProv
      resolve to the value from the EARLIEST-starting event (the documented tie-break), and the
      result is identical whichever order the events arrive in.
    - A team whose only events are offseason (eventType 99) or preseason (100) — every field
      absent. An exhibition event says nothing about where a team is from.
    - A team with zero events, and a team whose events all carry null geo — every field absent.
    - Absence means "not derivable", never "none" — this is asserted as a distinct case, not folded
      into an empty string.

    `compareTeamsByTotal`:
    - Higher `metrics.total.value` sorts first.
    - Equal totals break by ascending `teamNumber`, producing a strict total order (no shared
      ranks, no reliance on engine sort stability).
    - A row with no `total` entry sorts last, and two such rows still order by team number.
    - This reproduces `rowModel.ts`'s existing comparator exactly; a test asserts the three cases
      above against the same fixtures shape `rowModel.test.ts` uses.

    `isRealPublishedTeamKey`: `frc1114` true, `frc5199B` false, `frc0` false, `frc9970` true.

    `buildTeamRankScopes`:
    - A US district team resolves four scopes in the order world, country, district, state.
    - A Canadian team in the `ont` district resolves three (world, country, district) — no state
      card outside the USA.
    - A US non-district team resolves three (world, country, state).
    - An Israeli team in the `isr` district resolves three (world, country, district).
    - Every scope's `rank` is the target's 1-based position within its own pool, and `total` is
      that pool's size.
    - The World scope's rank for a given team equals its index+1 in the real-team pool sorted by
      `compareTeamsByTotal` — asserted directly.
    - A target with no `total` metric, or a `teamKey` absent from the input, yields an EMPTY array.
      A team with no published value has no honest rank; it does not get placed last and shown.
    - Non-real team keys are excluded from every pool before ranking, so an offseason B-team
      cannot push a real team down a place.
  </behavior>
  <action>
    Create `packages/harness/teamRanks.ts` as a dependency-free module (no Node built-ins, no
    `better-sqlite3`, no `zod`) so both the offline pipeline and the browser bundle can import it.
    It imports only `isOfficialEventType`/`OFFSEASON_EVENT_TYPE`/`PRESEASON_EVENT_TYPE` from
    `../core/algorithms/eventTypes.js` and `TOTAL_METRIC_KEY` from `../core/algorithms/types.js`,
    using the same explicit-`.js`-extension relative-path convention every other cross-package
    import in this repo uses.

    Export, with a module header explaining each rule and why it exists:

    `isRealPublishedTeamKey(teamKey: string): boolean` — the `frc{digits}` + positive-number rule
    currently living in `apps/web/src/lib/teamKey.ts`'s `isRealTeamKey`. Carry that function's
    doc-comment reasoning across (letter-suffixed B-teams, `frc0`) so the rule keeps its recorded
    justification. Task 2 makes `teamKey.ts` re-export this rather than keep a second copy.

    `compareTeamsByTotal(a, b)` — a structurally typed comparator over
    `{ teamNumber: number; metrics: Readonly<Record<string, { value: number } | undefined>> }`,
    reproducing `rowModel.ts`'s existing rule. Structural typing is what lets both the pipeline's
    input rows and the web app's `TeamRow` (which has been widened by `withDerivedGroupMetrics`)
    pass through one implementation. Note in the doc comment that group-metric derivation never
    touches `TOTAL_METRIC_KEY`, so the widening is invisible to this comparator.

    `deriveTeamRegions(params)` — takes the per-team attended-event-key sets and the season's event
    rows (`{ eventKey, eventType, startDate, country, stateProv, districtKey }`), returns
    `Map<teamKey, { country?: string; stateProv?: string; districtKey?: string }>`.

    Derivation rule, stated in the doc comment as an explicit honesty note: the corpus's `teams`
    table carries only key, number and nickname — it has NO home address — so a team's region is
    INFERRED from where it competed, and this function is the one place that inference lives.
    Eligible events are those where `isOfficialEventType(eventType)` holds AND the type is not one
    of the three neutral-site championship types (3 Championship Division, 4 Championship Finals,
    6 Festival of Champions); name those three as local constants with the reason attached. Each
    field independently takes the most frequent non-null value across eligible events, breaking a
    frequency tie by the earliest `startDate` and then by ascending `eventKey`, so the result never
    depends on input ordering. A field with no non-null value anywhere is omitted from the result
    object entirely.

    `buildTeamRankScopes(params)` — takes the season's rankable team rows (each carrying `teamKey`,
    `teamNumber`, `metrics`, and the optional region fields) plus a target `teamKey`; returns an
    ordered array of at most four `{ scope, value?, rank, total }` entries. `scope` is one of
    `world` / `country` / `district` / `state`. `value` is the RAW published scope value (the
    country string, the district abbreviation, the state-prov abbreviation) and is omitted for
    `world`; reader-facing formatting is the client's job (`districtNames.ts` already owns district
    naming and must not be duplicated here).

    Pool membership: world is every real team; country is every real team with the same `country`;
    district is every real team with the same `districtKey`; state is every real team with the same
    `country` AND the same `stateProv`, and is emitted only when the target's country is the
    literal `"USA"` (the value TBA publishes and this repo already tests against in
    `EventFilters.test.tsx`) — express that literal as a named exported constant so the UI test and
    this module agree on one spelling. A scope whose gating field is absent on the target is not
    emitted; the array shrinks rather than carrying a placeholder.

    Write `packages/harness/teamRanks.test.ts` covering every case in the behavior block above.
    Then extend `packages/harness/browserSafeSchemas.test.ts` to include `teamRanks.ts` in its
    entry-point list, so the browser-safety guarantee this module's design depends on is enforced
    rather than assumed.

    Commit with explicit paths only.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/teamRanks.test.ts packages/harness/browserSafeSchemas.test.ts</automated>
  </verify>
  <done>
    `packages/harness/teamRanks.ts` exports the four functions and the USA constant; every behavior
    case above has a passing assertion; `browserSafeSchemas.test.ts` covers the new module and
    passes; `git status --short` shows only the three files from this task.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Publish the four ranks on the team artifact, and put the Teams table on the same comparator</name>
  <files>packages/harness/pageArtifacts.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, apps/web/src/components/teams-table/rowModel.ts, apps/web/src/lib/teamKey.ts</files>
  <read_first>
    packages/harness/pageArtifacts.ts lines 1053-1118 (`TeamSeasonEventSchema`,
    `TeamSeasonArtifactSchema`, and the `robotImageUrl`/`activeYears` optional-field precedent),
    packages/harness/publish.ts lines 1800-1830 (`computeTeamSeasonStats`, the seam before the
    per-algorithm loop), lines 1900-1950 (`teamsRows` construction), lines 2050-2090 (the per-team
    `buildTeamSeasonArtifact` loop), and lines 1650-1670 (`selectEventMeta`/`eventMeta`'s row shape).
  </read_first>
  <behavior>
    - `TeamSeasonArtifactSchema.parse` accepts an artifact with NO `ranks` key — the pre-republish
      back-compat case — and yields `ranks: undefined`.
    - It accepts an artifact with four rank entries and rejects one with five.
    - It rejects a `rank` or `total` of zero or a negative number, and rejects an unknown `scope`
      string.
    - A `world` entry parses with no `value`; a `district` entry parses with `value: "fim"`.
    - `buildTeamSeasonArtifact` given rank scopes emits them; given none, omits the key entirely
      rather than emitting an empty array (absence and "computed, found nothing" must not become
      the same wire shape).
    - In `publish.test.ts`: for one fixture season, the World rank published on a given team's
      artifact equals that team's index+1 in the published teams artifact's rows after filtering
      with `isRealPublishedTeamKey` and sorting with `compareTeamsByTotal`. This is the
      cross-artifact agreement the whole feature rests on.
    - `rowModel.test.ts` continues to pass unchanged after `buildTeamRows` is rewired to the shared
      comparator — the refactor is behavior-preserving by construction, and the existing suite is
      the proof.
  </behavior>
  <action>
    In `packages/harness/pageArtifacts.ts`, add a `TeamSeasonRankSchema`
    (`scope` as a `z.enum` of the four ids, optional `value` string, positive-int `rank` and
    `total`) and hang an optional, max-4 array of it off `TeamSeasonArtifactSchema` as `ranks`.
    Document the optionality with the same argument `activeYears` uses: absence is a valid state a
    client must handle, because a browser can hold an artifact published before this change. Do NOT
    bump `PAGE_ARTIFACT_SCHEMA_VERSION` — an additive optional field on one page kind is
    backward-compatible for every reader, which is the precedent `EventsListRowSchema`'s own
    comment already records for exactly this situation.

    In `packages/harness/publish.ts`:
    - Immediately after `const teamStats = computeTeamSeasonStats(stream);` and BEFORE the
      `for (const algorithm of options.algorithms)` loop, call `deriveTeamRegions` once per season
      using each team's `eventKeys` set and the `eventMeta` rows. Regions do not depend on the
      algorithm, so computing them inside the loop would run the same work three times for an
      identical answer — the same argument `actualBonusFlagsForSeason` already makes in this file.
      Attach that reasoning as a comment at the call site.
    - After `teamsRows` is built (it already carries each team's official-snapshot metrics via
      `officialMetricsByTeamWithPercentiles`), compute the per-team rank scopes from those SAME
      rows joined to the derived regions. Ranking the rows the pipeline is about to publish, rather
      than a separately assembled set, is what makes the published World rank and the Teams table's
      client-side rank the same number by construction.
    - Thread each team's scopes into its `buildTeamSeasonArtifact` call in the per-team loop, and
      widen that function's params to accept them, omitting the field when the scope array is
      empty.

    In `apps/web/src/lib/teamKey.ts`, replace the local `isRealTeamKey` body with a re-export of
    `isRealPublishedTeamKey` from `packages/harness/teamRanks.js` under the existing exported name,
    so every current call site is untouched and one rule has one home. Leave the existing doc
    comment in place, updated to point at the new home.

    In `apps/web/src/components/teams-table/rowModel.ts`, delete the local total-descending sort
    body inside `buildTeamRows` and call the shared `compareTeamsByTotal` instead. Keep
    `byTeamNumberAscending` for `sortTeamRows`, which is a different concern. Update the file
    header note so a later reader knows the ranking rule now lives in `packages/harness/teamRanks.ts`
    and why (the published per-team rank and this table's rank must not be able to disagree).

    Add the `publish.test.ts` cases from the behavior block. Commit with explicit paths only.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/pageArtifacts.test.ts apps/web/src/components/teams-table/rowModel.test.ts apps/web/src/lib/teamKey.test.ts apps/web/src/lib/teamKey.realTeams.test.ts</automated>
  </verify>
  <done>
    The schema accepts both the pre-republish (no `ranks`) and the four-scope shapes; `publish.ts`
    derives regions once per season and publishes rank scopes per team per algorithm; the
    cross-artifact agreement test passes; `rowModel.test.ts` and both `teamKey` suites pass
    unchanged; `git status --short` shows only this task's five files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: RankCards on the team page Overview</name>
  <files>apps/web/src/components/team/RankCards.tsx, apps/web/src/components/team/RankCards.test.tsx, apps/web/src/components/team/OverviewTab.tsx</files>
  <read_first>
    **Load `Skill("sketch-findings-sigmascout")` BEFORE writing any JSX or CSS in this task.** It
    carries the decided palette (green is ink, not paint), the uncertainty/interval display rules,
    and the accessibility constraints this card row has to sit inside. Then read
    `apps/web/src/components/team/SeasonHeader.tsx` (the `data-card` shell, the `text-role-*` and
    `numeric-cell` classes, the spacing tokens, and its as-of labelling discipline),
    `apps/web/src/components/team/TierKeyRow.tsx`, `apps/web/src/lib/districtNames.ts`, and
    `apps/web/src/components/team/SeasonHeader.test.tsx` for this directory's testing conventions.
  </read_first>
  <behavior>
    - An artifact with four scopes renders four cards, in the order world, country, district,
      state.
    - Each card shows its rank as `#12` and its denominator as `of 3,481` — the denominator is
      grouped with a locale thousands separator, and it is always visible, because a rank without
      its pool size is not a claim a reader can check.
    - District cards label with `districtDisplayName(value)` — a `fim` scope renders `FIRST MI`,
      and the test asserts the reader-facing name, not the raw key.
    - The country card labels with the raw country string; the state card labels with the raw
      state-prov abbreviation.
    - An artifact with `ranks: undefined` renders nothing at all — no heading, no empty row, no
      skeleton that never resolves.
    - An artifact with `ranks: []` also renders nothing.
    - Exactly one basis caption renders whenever any card renders, naming that the ranking is by
      total and that the pool is official play only.
    - The component is keyboard- and screen-reader-legible: each card's scope label is associated
      with its number rather than floating as a bare adjacent string.
  </behavior>
  <action>
    Create `apps/web/src/components/team/RankCards.tsx` exporting a presentational
    `RankCards({ ranks })` that takes `TeamSeasonArtifact["ranks"]` and renders nothing when that
    value is absent or empty. Reuse this directory's existing visual vocabulary rather than
    inventing one: the `data-card` shell with `p-[var(--spacing-md)]`, `text-role-label
    text-[var(--color-text-muted)]` for the scope label, `numeric-cell` for the rank number, and
    the spacing tokens `SeasonHeader.tsx` already uses. Lay the cards out as a wrapping row that
    reflows to fewer columns at narrow widths rather than becoming a scroll region — every value is
    a bounded numeric, so nothing can force horizontal overflow.

    Resolve scope labels in the component: `world` gets a fixed reader-facing label, `district`
    goes through `districtDisplayName`, and `country`/`state` render their raw published value.
    Give the block a `data-testid` and each card a stable `data-testid` so the tests target
    structure rather than copy.

    Render the single basis caption in the same muted label style `SeasonHeader.tsx` uses for its
    own as-of line. This matters for the same reason IN-01 forced that line to exist: the ranks are
    computed from each team's last-official-match snapshot, which is a different as-of instant from
    the season-final record shown a few lines above, and an unlabelled number here would be a new
    unmarked claim.

    Mount it in `OverviewTab.tsx` directly after the `SeasonHeader` card and before
    `EventSectionList`, passing `artifact.ranks`. Do not thread a new prop through the route —
    `ranks` already arrives on the artifact `OverviewTab` holds, so no route change is needed. Do
    not add it to the zero-events branch in `team.$teamNumber.tsx`: a team with no events has no
    rank worth showing.

    Write `RankCards.test.tsx` covering every behavior case above, following
    `SeasonHeader.test.tsx`'s fixture and render conventions. Commit with explicit paths only.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/team/RankCards.test.tsx apps/web/src/components/team/SeasonHeader.test.tsx</automated>
  </verify>
  <done>
    Four cards render in scope order with `#N` and a grouped `of N` denominator; `fim` renders as
    `FIRST MI`; absent and empty `ranks` both render nothing; one basis caption renders alongside
    any cards; `git status --short` shows only this task's three files.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA API → corpus | Third-party event geo (`country`, `state_prov`, `district.abbreviation`) already crosses here and is already Zod-validated at ingest; this task adds a new consumer of it, not a new boundary. |
| pipeline → R2 artifact → browser | The new `ranks` array crosses here and is Zod-validated on read by `TeamSeasonArtifactSchema`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ldu-01 | Tampering | `TeamSeasonArtifactSchema.ranks` | low | mitigate | `rank`/`total` are `z.number().int().positive()` and `scope` is a closed `z.enum`; a malformed or hostile artifact fails the existing parse-or-throw path in `lib/api/team.ts` rather than rendering a bogus rank. |
| T-ldu-02 | Information disclosure | `RankCards.tsx` | low | accept | Every value rendered is already public FRC competition data published on the Teams page; no new information is exposed. |
| T-ldu-03 | Repudiation | `deriveTeamRegions` | medium | mitigate | A team's region is INFERRED from attended events, not read from an authoritative address, and could be wrong for a team that only travels. Mitigated by excluding neutral-site championship events from the geo vote, by the deterministic earliest-start tie-break, and by the module header stating the inference explicitly so a later reader cannot mistake it for TBA ground truth. |
| T-ldu-SC | Tampering | npm/pip/cargo installs | n/a | n/a | This plan installs no packages. No `## Package Legitimacy Audit` is required. |
</threat_model>

<verification>
After all three tasks:

1. `npx vitest run packages/harness apps/web/src/components/team apps/web/src/components/teams-table apps/web/src/lib` — the harness and the touched web surfaces are green.
2. `npx tsc --noEmit` — clean apart from the four known pre-existing `apps/worker` redDqs/blueDqs
   errors that predate 2026-09-05. Any error naming a file this plan touched is a real regression.
3. `git log --oneline -3` and `git status --short` — three commits, each staged by explicit path,
   and nothing from `packages/core/algorithms/sigma1/` in any of them.
</verification>

<success_criteria>
- Every `must_haves.truths` entry holds.
- No file under `packages/core/` was modified.
- No commit was staged with `git add -A`, `git add -u`, or `git commit -a`.
- The World rank has exactly one implementation, shared by the pipeline and the Teams table.
</success_criteria>

<post_plan_note>
**The cards do not appear on the live site until a republish.** `ranks` is a new optional field, so
every artifact currently in R2 lacks it and every team page will render zero cards until
`pnpm publish:seasons` runs and rewrites the per-team artifacts.

Two operational facts govern that step, both recorded from prior runs in this repo:

1. **Run the publish from the main session, not from an executor subagent.** Executor sandboxes deny
   all network Bash, including `pnpm publish:seasons`.
2. **`docs/publish-budget.md` is a manual step.** `publish:seasons` prints its summary but does not
   write the document; the new numbers must be transcribed into the machine-readable block or
   `packages/harness/payloadBudget.test.ts` goes red. The `team` page kind's `budgetMaxBytes` is
   400,000 against a current `maxBytes` of 376,339 — the smallest headroom of any page kind — so
   check the `team` maximum specifically after the run. Four rank entries are on the order of 200
   bytes, which fits, but that margin is thin enough to confirm rather than assume.

A republish is already pending on user signal from quick task 260905-jj8; this change can ride
along with it rather than triggering a separate run.
</post_plan_note>

<output>
Create `.planning/quick/260905-ldu-on-every-team-page-add-rank-cards-for-th/260905-ldu-SUMMARY.md` when done.
</output>
