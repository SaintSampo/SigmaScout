---
phase: quick-260917-kem
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/AlliancesTab.test.tsx
autonomous: true
requirements: [QUICK-260917-kem]

estimate:
  tokens: 60000
  raw_tokens: 120000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "At a Championship division (TBA event_type 3) or Championship finals/Einstein (event_type 4), a fourth pick renders with NO (backup) suffix; at every other event type, and when the artifact carries no eventType, the suffix still renders (D-01)."
    - "An alliance member who never took the field at an event gets an as-of-event total and Sigma entry on a NEW optional artifact field, and the Alliances tab renders that pick's pill from it (D-02)."
    - "The event artifact's teams, matches and upcoming arrays are byte-identical with and without the new field — standings, Insights, Breakdown and the simulation are untouched (D-02)."
    - "A pick whose team the season's walk-forward never saw publishes no row at all — no invented value, no empty-metrics row (D-02)."
    - "The Combined Total still sums exactly the first three picks; ALLIANCE_COMBINED_PICK_COUNT is unchanged, and an Einstein alliance whose third member never played becomes combinable through the fallback (D-03)."
    - "An artifact published before this change (no allianceTeams key) renders exactly as it does today."
  artifacts:
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - apps/web/src/components/event/AlliancesTab.tsx
  key_links:
    - "publish.ts's per-event allianceTeams computation <-> EventArtifactSchema.allianceTeams <-> AlliancesTab's pickFromTeamKey fallback, pinned end to end by a publishSeasons fixture test and a component test."
    - "artifact.eventType (already published, optional) <-> BackupCell's suffix decision and backupColumnWidth's measured budget."
    - "The e2e column id pickBackup <-> external Playwright specs that key off it — unchanged by this plan."
---

<objective>
Two bugs on the Alliances tab at Championship events, fixed together.

1. `BackupCell` prints "(backup)" on every pick at index >= 3. At Championship division
   (event_type 3) and Championship finals/Einstein (event_type 4) alliances have four real
   members, so the label is wrong there. (D-01)
2. An alliance member who never took the field at the event has no `teams` row, so their pick
   renders as a bare team number and their alliance has no Combined Total. Verified live on
   `2026cmptx` (Einstein): `alliances[].picks` has 4 entries on all 8 alliances but `teams`
   has only the 24 robots that played Einstein matches, so `frc3006` (alliance 1's third
   member, replaced on the field by `frc7407`) and the seven other fourth members have no
   pill and alliance 1 has no Combined Total. (D-02)

Purpose: the only published account of who was on a Championship alliance currently mislabels
a real member as a reserve robot and cannot price a third of the Einstein field.
Output: one new additive optional event-artifact field, its publisher, the client fallback and
the conditional label — plus the comment sweep that keeps the surrounding prose truthful.

Decision ids used below: **D-01** the label fix, **D-02** as-of-event metrics for unplayed
alliance members on a separate additive field that never enters `teams`, **D-03** the Combined
Total stays the first three picks.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@packages/harness/pageArtifacts.ts
@packages/harness/publish.ts
@apps/web/src/components/event/AlliancesTab.tsx

Facts already established against HEAD and against the live artifact
`https://data.sigmascout.org/v1/event/2026cmptx/spr@4.0.0+baseline.json`. Do NOT re-derive
these; re-reading the cited line ranges to edit them is expected, re-investigating them is not.

- `EventArtifactSchema` is at `pageArtifacts.ts:1514`; `EventAllianceSchema` at 1459;
  `EventTeamSchema` at 697; `MetricsRecordSchema` at 226. `PAGE_ARTIFACT_SCHEMA_VERSION` is 1
  (line 63) and this file's own established precedent (lines 1477-1481, 1146, 1315, 1331, 1970,
  2356) is that an additive optional field does NOT bump it.
- `LiveEventArtifactSchema` (line 1597) `.extend()`s `EventArtifactSchema`, so a field added to
  the latter is inherited by the live/Worker/browser read path with no second edit.
- `EventPageArtifact` (`apps/web/src/lib/eventPricing.ts:36`) is
  `Omit<LiveEventArtifact, "state"> & {...}`, so the new field reaches the client's type with no
  edit there either.
- `apps/worker/src/artifactMerge.ts:231-263` documents and implements SPREAD-THEN-OVERRIDE, never
  an allow-list, precisely so "a key the publisher adds later survives a tick automatically".
  A live tick therefore carries `allianceTeams` forward unchanged (stale-but-true until the next
  republish), exactly as it already does for the Sigma entry and the teams-row record. **No
  `apps/worker` file is in this plan's scope.**
- `publish.ts:2136-2175` is the per-event loop. `eventTeamKeys` (2149) is the match-derived
  roster when non-empty, the registered roster only as fallback, with the stated intent that
  never-played teams are not added to standings. `metricsAsOfEvent` (1377) returns
  `algorithm.teamMetrics(state, keys)` from the event's captured walk-forward state, falling back
  to season-final metrics only when the event has no completed matches.
  `buildEventTeamsStanding` (1350) runs `withEventPercentiles` against the SEASON ranking pool
  and merges `sigmaMetricForAlgo` as the last key.
- `teamsThisSeason` (`publish.ts:1717`) is every team on a played or scheduled match this season
  with `isDemoTeamKey` already filtered out — the correct "the model saw this team, and it is not
  a demo key" gate.
- `buildEventArtifact` is at `publish.ts:489`; its `teams` row mapper is lines 504-510; the
  `alliances` mapper 528-536; the returned candidate object 560-576.
- `AlliancesTab.tsx`: `pickFromTeamKey` at 183, `buildAllianceRows` at 224, `BackupCell` at 415
  (the `{"(backup)"}` span at 436), `backupColumnWidth` at 364 with its measured derivation at
  350-362, `alliancesColumnHeaders` at 304 with the "Pick 3" header-label note at 293-303.
  `AlliancesTabProps` already carries the whole `artifact`, so `artifact.eventType` needs no new
  prop.
- The web client's existing idiom for "is this a Championship event" is an inline
  `eventType === 3 || eventType === 4` (`components/events-list/EventsList.tsx:171`,
  `components/events-list/filterModel.ts:66,96,171`). The harness's own names for those two
  numbers are in `packages/harness/teamRanks.ts:113-114`, module-private.
- Test fixtures: `makeEventArtifact(teams, overrides)` (`apps/web/src/test/helpers.ts:64`) parses
  through `EventArtifactSchema`, so `allianceTeams` and `eventType` ride in `overrides` with no
  helper change. `AlliancesTab.test.tsx` wraps it as `makeArtifact` (line 76). The harness's
  end-to-end pattern is `upsertEvent(db, seasonEvent({...}))` + `upsertMatch(db, seasonMatch({...}))`
  + `upsertEventAlliance(db, {...})` + `publishSeasons(db, {...})` + `findEventArtifact(key, spr.id)`
  (`publish.test.ts:1036-1123`).
- `docs/publish-budget.md` is rewritten by `pnpm publish:seasons --write-budget`, not by hand;
  `payloadBudget.test.ts` reads the recorded block, so it stays green without a republish.
- `sketch-findings-sigmascout` SKILL.md was read. Nothing in it changes here: no palette, tier,
  chart or interval-display rule is touched, the tier pills keep rendering through the existing
  `TotalSigmaValue`/`tierForPercentile` path, and the one live trap that applies — tailwind-merge's
  `cn()` eating `text-role-*` beside a `text-[var(...)]` — is already avoided because the label
  span uses a plain string className. Keep it a plain string.

**Working-tree hazard, read before touching anything.** Another live session holds uncommitted
edits. At plan time: modified `apps/worker/src/{artifactMerge,artifactWriter,scheduled}.ts`,
`apps/worker/test/{liveAlgorithmTier,scheduled.replay,scheduled.rowParity,scheduled.rp,scheduled}.test.ts`,
`packages/core/algorithms/spr.ts`, `packages/spr/softCredit.test.ts`; untracked
`apps/worker/test/scheduled.sidecar.test.ts`, `packages/harness/liveMetricSidecar{,.test}.ts`.
`packages/harness/publish.ts` and `pageArtifacts.ts` were CLEAN at plan time and are this plan's
to edit. Consequences, all mandatory:
- Stage by explicit path only. Never `git add -A`, `git add .`, `git commit -a`, `git checkout`,
  `git restore` or `git stash`.
- `git status --porcelain` and `git diff --cached --name-only` before every commit; the staged
  list must contain only this plan's files.
- If `packages/harness/publish.ts` carries foreign uncommitted hunks at execution time, STOP and
  report instead of committing that file.
- `packages/core/algorithms/spr.ts` is foreign and in flight. It backs `algorithm.teamMetrics`,
  so the full suite may be red for reasons that are not yours. Task 1 captures a baseline first.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Publish as-of-event metrics for unplayed alliance members, end to end</name>
  <files>packages/harness/pageArtifacts.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/pageArtifacts.test.ts</files>
  <precondition>`git status --porcelain` shows no foreign modification of `packages/harness/publish.ts` or `packages/harness/pageArtifacts.ts`; if either carries another session's hunks, halt and report.</precondition>
  <behavior>
    - A published event artifact for an event whose alliance picks include a team with no
      `teams` row carries that team on `allianceTeams`, with a total metric and (under SPR) a
      Sigma entry, percentiled against the same season pool the `teams` rows use.
    - That same artifact's `teams` array does NOT contain the team.
    - `JSON.stringify` of `teams`, `matches` and `upcoming` is byte-identical to the same
      fixture published without the new field in play.
    - An alliance pick the season's walk-forward never saw produces no `allianceTeams` row.
    - An event with nothing to add omits the key entirely, so a reader cannot tell this change
      happened.
    - `EventArtifactSchema` parses a body with the field and a body without it, and
      `PAGE_ARTIFACT_SCHEMA_VERSION` is still 1.
  </behavior>
  <action>
    FIRST, before any edit, capture the pre-existing baseline so the foreign in-flight edits
    named in `<context>` cannot be mistaken for your own breakage. Run the full root suite and
    both typechecks, and write the failing test names and the error lines to two files in the
    session scratchpad. Report both baselines verbatim in the SUMMARY. Do not try to fix a
    baseline failure; it is not yours.

    Then implement, in this order.

    (a) `pageArtifacts.ts` — add one field to `EventArtifactSchema`, immediately after
    `alliances` (line 1533), reusing `EventTeamSchema` unchanged so the two arrays carry exactly
    one row shape: `allianceTeams: z.array(EventTeamSchema).optional()`. Write its doc comment in
    this file's own register (the `alliances` and `eventType` comments directly above are the
    models). It must state: what it holds (a playoff alliance member who never took the field at
    this event, so has no standings row); that it exists BECAUSE such a team must not enter
    `teams`, since `teams` is the event's standings pool and a never-played team stays unranked
    at the event — standings, Insights, Breakdown and the rank simulation read `teams` and must
    be unaffected; that the Alliances tab is its only consumer, which reads it as a fallback
    only after `teams` misses; that a team the season's walk-forward never saw gets no row rather
    than an invented value, so absence is honest; that a live tick carries it forward unchanged
    through `artifactMerge.ts`'s spread-then-override, which makes it stale-but-true between
    republishes exactly as the Sigma entry and the teams-row record already are; and that
    `PAGE_ARTIFACT_SCHEMA_VERSION` is NOT bumped, citing this file's existing precedent for an
    additive optional field. Name `2026cmptx` as the live event that motivated it.

    (b) `publish.ts` `buildEventArtifact` — add
    `readonly allianceTeams?: readonly EventTeamStandingInput[]` to
    `BuildEventArtifactParams`, documented in the same register as the `teams` param above it,
    stating that an absent or empty array emits no key. Factor the existing `teams` row mapper
    (504-510) into one local function used by BOTH arrays, so there is exactly one event-team-row
    shape in this builder and the `teams` bytes cannot drift from the new array's. Keep
    `eventTeamRankingFields` in that shared mapper — an `allianceTeams` row carrying TBA's own
    rank/record/rp when one genuinely exists is honest, and a second mapper that omitted them
    would be a shape that can drift. Spread the new key into the candidate object immediately
    after `alliances` and only when the mapped array is non-empty, mirroring how `alliances`,
    `rpOutcomeRp` and `state` are already conditionally spread.

    (c) `publish.ts` per-event loop (2136-2175) — leave the existing `eventTeamKeys`,
    `asOfEventMetrics` and `teamsStanding` lines untouched. That is the byte-identity guarantee,
    and it is structural rather than tested-for: do not widen the existing `metricsAsOfEvent`
    call's key list, because `algorithm.teamMetrics` takes the key set as an argument and a wider
    set is not provably value-identical for the original keys.

    Hoist `alliancesForSeason.get(e.event_key) ?? []` into a local (it is currently inlined at
    2169) and reuse it for both the builder's `alliances` argument and the new computation. Build
    a season-scoped `Set` of `teamsThisSeason` once, outside the event loop. Then, for each
    event, derive the alliance-only key list: every distinct key across the event's
    `alliances[].picks`, minus the keys already in `eventTeamKeys`, kept only when the
    `teamsThisSeason` set has it (that one filter is both the "the walk-forward saw this team"
    gate and the demo-key exclusion, since `teamsThisSeason` already drops demo keys), sorted for
    determinism the way the registered-roster fallback beside it is.

    When that list is empty, do nothing further and pass no new argument — most events. When it
    is not, call `metricsAsOfEvent` a SECOND time with the same algorithm, the same
    `stateByEventForAlgo`, the same event key and `metricsByTeam` fallback, but scoped to the
    alliance-only keys; drop any key whose resulting metrics record has no entries (a team with
    no state publishes nothing, never an empty-metrics row); then call `buildEventTeamsStanding`
    a second time with those surviving keys, the same `teamInfo`, the same `rankingPools` and the
    same `sigmaMetricForAlgo`, and pass the result as `allianceTeams`. Reusing both helpers
    unchanged is what makes the fallback rows carry the same percentile basis and the same Sigma
    entry a standings row carries. Comment the block at the density of its neighbours, and say in
    it why the second call exists rather than a widened first one.

    (d) Tests. In `publish.test.ts`, add a `describe` beside the existing alliance ones. Builder
    level: one `buildEventArtifact` params object, invoked with and without `allianceTeams`, with
    `JSON.stringify` equality asserted separately on `teams`, on `matches` and on `upcoming`;
    plus no key when the argument is absent, no key when it is `[]`, and a present key whose row
    shape matches a `teams` row. End-to-end through `publishSeasons`: a two-event fixture where a
    team plays at the earlier event and is an alliance pick at the later one without playing a
    match there, asserting by LITERAL team key (never a loop over the fixture's own list) that
    the later event's `allianceTeams` carries that key with a rounded total, that its `teams`
    carries no row for it, and that a pick key which appears nowhere in the season yields no
    `allianceTeams` row. Add the publish-level byte-identity guard as a second `publishSeasons`
    run over the same corpus minus the later event's `event_alliances` row, comparing
    `JSON.stringify` of the three arrays across the two runs. In `pageArtifacts.test.ts`, pin
    both parse directions and that the schema version is still 1.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/pageArtifacts.test.ts</automated>
    <automated>grep -cF 'allianceTeams' packages/harness/pageArtifacts.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>Every new pin passes. The three byte-identity assertions pass at both builder and
  publish level. The root typecheck shows no error outside the captured baseline. Committed with
  only these four files staged, verified by `git diff --cached --name-only`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Read the fallback on the Alliances tab and stop mislabelling a real fourth member</name>
  <files>apps/web/src/components/event/AlliancesTab.test.tsx, apps/web/src/components/event/AlliancesTab.tsx</files>
  <behavior>
    - eventType 3 and eventType 4: a fourth pick renders in the `pickBackup` cell with its
      number and pill and NO "(backup)" text.
    - eventType 0/1/2 and eventType absent: the suffix still renders, unchanged.
    - The column id `pickBackup` and all seven header labels are unchanged in every case.
    - A pick with no `teams` row but an `allianceTeams` row renders that row's total pill and
      its Sigma half; the alliance becomes combinable, its Combined Total renders, and the
      incomplete notice no longer counts it.
    - A `teams` row WINS over an `allianceTeams` row for the same team key.
    - With `allianceTeams` absent the tab behaves exactly as it does today: bare number, no
      combined value, notice shown.
    - The Combined Total still sums exactly three picks, and a fourth pick's own values still
      never enter the value sum or the band.
  </behavior>
  <action>
    Write the pins first and watch them fail; the existing describe blocks for the seven-column
    anatomy, the combined band and the incomplete notice are the ones to extend, and `makeArtifact`
    already forwards `eventType`/`allianceTeams` through `overrides`. Model the fallback fixtures
    on the real `2026cmptx` shape — a four-pick alliance whose third member has no `teams` row —
    and assert with literal team keys, not with keys read back out of the fixture. Then change
    `AlliancesTab.tsx`.

    (a) D-02, the fallback. Give `pickFromTeamKey` a third parameter for the alliance-only rows
    and resolve `teams` FIRST, the fallback only on a miss, so a standings row always wins.
    `buildAllianceRows` passes `artifact.allianceTeams ?? []`. Nothing else changes: the pick's
    `total` and `sigma` keep coming off whichever row resolved, so the existing `TotalSigmaValue`
    tiering, `combineAlliancePicks` and `combinedSigmaBand` all pick the fallback up for free.
    Leave `buildTeamValuePercentilePoints(artifact.teams)` reading `artifact.teams` ALONE — the
    approximate combined tier is interpolated against this event's standings roster, which is
    what `ALLIANCE_APPROX_TIER_DISCLOSURE` already tells the reader, and widening the pool would
    make that sentence false. Say so in a comment there. `ALLIANCE_COMBINED_PICK_COUNT` stays 3
    (D-03).

    (b) D-01, the label. Add one named predicate for the two TBA event types whose alliances have
    four real members (Championship division 3, Championship finals/Einstein 4), taking the
    artifact's optional `eventType` and returning false when it is absent, since an artifact
    published before 260915-isq carries none and the safe reading of absence is "not a
    championship". Match the client's existing inline `3 || 4` idiom rather than reaching into
    the harness for `teamRanks.ts`'s module-private constants. `BackupCell` takes a boolean for
    whether to label, and renders the label span only when it is true — keep that span's
    className a plain string, never through `cn()`. `AlliancesTab` derives the boolean from
    `artifact.eventType` and passes it to `buildAllianceColumns`, alongside the existing
    `showBackupColumn`, and into the `pickBackup` cell renderer.

    (c) Widths. `backupColumnWidth` gains the same boolean. Labelled keeps the shipped
    `BACKUP_COLUMN_WIDTH_SIGMA_PX`/`BACKUP_COLUMN_WIDTH_PX` unchanged. Unlabelled returns
    `pickColumnWidth(algorithmId)`, because without the suffix the cell's content is exactly a
    `PickCell`'s content and the "PICK 3" header is the same 11px uppercase string the pick
    columns already carry at that width. Do not introduce a fourth width constant. Rewrite that
    doc comment so the arithmetic it states is the arithmetic that runs: the labelled numbers
    include the 8px gap plus the label's measured 52.11px, and dropping both lands on the pick
    width. Derive the expected table totals for your width tests from the shipped constants
    rather than pinning a number you did not compute — at plan time they come out as 1196 for an
    SPR championship row with a fourth pick and 1256 for the same row off-championship, against
    the 982 the existing no-backup test pins.

    (d) Comment truthfulness sweep, required by the constraints. Every place that describes the
    fourth position as a backup robot must now describe both cases. At minimum: the file header
    block; `alliancesColumnHeaders`'s note that "Backup" is labelled "Pick 3" (keep the fact that
    the label and the id are unchanged, add that the column holds a genuine fourth alliance
    member at the two Championship types and a called-in reserve everywhere else);
    `BackupCell`'s own doc block; `pickFromTeamKey`'s doc block (it currently says a key with no
    row keeps its number from the key's digits — still true, but the fallback comes first now);
    `EventAllianceSchema`-facing prose in `AlliancePick`/`AllianceRow`. Leave
    `alliancesIncompleteNotice`'s wording alone: "one of their first three picks has no published
    total" stays true. Use no decision id and no quick-task id in any source comment.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event/AlliancesTab.test.tsx</automated>
    <automated>grep -cF 'id: "pickBackup"' apps/web/src/components/event/AlliancesTab.tsx</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>Every pin in `<behavior>` passes. The `pickBackup` grep prints 1. The web typecheck shows
  no error outside the captured baseline. Committed with only these two files staged.</done>
</task>

<task type="auto">
  <name>Task 3: Dual-scope verification sweep against the captured baseline</name>
  <files>(no edits — verification only; fix in Task 1/Task 2 files if a real failure surfaces)</files>
  <action>
    Run the whole suite from the repo root, then the `apps/web` scope on its own, then both
    typechecks. Run each with `npx`, never `timeout pnpm ...`, and judge every one by its printed
    output rather than its exit code. Both scopes are required: the root run is ~167 files and the
    `apps/web` run is ~77, and an 8-day red CI has hidden in that difference before. Likewise both
    typechecks: the root `tsc --noEmit` returns clean over real `apps/web` errors.

    Diff each result against the baseline Task 1 captured. Triage every failure individually —
    never dismiss a set. A failure is out of scope only if it also appears in the baseline or its
    file is one of the foreign uncommitted paths listed in `<context>`. Anything else is yours:
    fix it in a Task 1 or Task 2 file and re-run. If a real failure can only be fixed by editing a
    foreign file, STOP and report rather than editing it.

    Report in the SUMMARY: both baselines, both post-change results, and the attribution for
    every remaining failure. Then confirm the working tree holds no unstaged change of your own
    and that the foreign modified/untracked set is exactly as `<context>` records it, growing only
    by the other session's own activity.
  </action>
  <verify>
    <automated>npx vitest run</automated>
    <automated>cd apps/web && npx vitest run</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>Both suites and both typechecks show no failure that is not in the captured baseline or
  attributable by path to the other session's uncommitted files, with the attribution written out
  per failure. No file outside this plan's six is modified by you.</done>
</task>

</tasks>

<verification>
- `allianceTeams` appears in `EventArtifactSchema`, is optional, reuses `EventTeamSchema`, and
  `PAGE_ARTIFACT_SCHEMA_VERSION` is still 1.
- A `publishSeasons` fixture proves an unplayed alliance member reaches `allianceTeams` with a
  total, is absent from `teams`, and that `teams`/`matches`/`upcoming` are byte-identical across
  a run with and a run without the alliance row.
- A pick the season never saw yields no row; an event with nothing to add emits no key.
- `AlliancesTab` renders a pill for a pick resolved only through `allianceTeams`, prefers a
  `teams` row when both exist, and degrades to today's behaviour when the key is absent.
- No "(backup)" text at eventType 3 or 4; the suffix intact at other types and when `eventType`
  is absent; `pickBackup` and every header label unchanged.
- `ALLIANCE_COMBINED_PICK_COUNT` is still 3 and a fourth pick still enters neither the value sum
  nor the band.
- No file under `apps/worker/`, `packages/core/` or `packages/spr/` is touched.
</verification>

<success_criteria>
The six files in `files_modified` are the only files changed; both suites and both typechecks are
clean against the captured baseline; every commit's staged list was verified by explicit path; and
no published number changes as a consequence of this plan, which is what makes it republishable
without an algorithm version bump.
</success_criteria>

<orchestrator_followups>
Not executor tasks — the executor subagent's sandbox denies network Bash. Run these from the main
context after Task 3 is clean.

1. `pnpm publish:seasons --write-budget` (the budget block rewrites itself and enforces ceilings
   pre-upload), then commit `docs/publish-budget.md`. This is what actually puts `allianceTeams`
   on `2026cmptx` and every other Championship artifact; until it runs, the client change is
   live-inert and the Einstein Alliances tab looks exactly as it does today.
2. Deploy the web app, then verify with an `Origin` header or a real browser — `curl` alone hides
   the Pages CORS-variant cache-poisoning failure mode.
3. Human check on live `2026cmptx`: all 8 alliances show four numbered members with no "(backup)"
   text, alliance 1 shows a Combined Total with its Sigma band, and the incomplete notice is
   either gone or reports a smaller count. Then spot-check one regional (event_type 0/1) with a
   real called-in backup and confirm its suffix survived.
4. Re-run the live-only Playwright specs after the deploy; they hit `sigmascout.org` and are not
   in CI, and the Alliances column set is exactly the kind of thing they drift on.
</orchestrator_followups>

<output>
Create `.planning/quick/260917-kem-fix-alliances-tab-at-championship-events/260917-kem-SUMMARY.md` when done.
Return the SUMMARY text to the orchestrator rather than writing it from a subagent if `Write` is
blocked on that path; do not fall back to a heredoc, which breaks on long markdown on this machine.
</output>
