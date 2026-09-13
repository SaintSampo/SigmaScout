---
phase: 260913-mgn-event-breakdown-spr-table-remove-fouls-c
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/lib/metricKeys.ts
  - apps/web/src/lib/metricKeys.test.ts
  - apps/web/src/components/event/BreakdownTab.tsx
  - apps/web/src/components/event/BreakdownTab.test.tsx
autonomous: true
requirements: [QUICK-260913-mgn]

estimate:
  tokens: 35000
  raw_tokens: 70000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "Under SPR, the event Breakdown tab's columns are exactly Team #, Team Name, Total, Auto, Teleop, Endgame (header ids teamNumber, nickname, total, phaseAuto, phaseTeleop, phaseEndgame); there is no Fouls Committed column"
    - "Under SPR, no group band row and no Auto, Teleop or Endgame expand buttons render; the column-label row is the first row of the table header"
    - "Under SPR, the four metric headers are still sort buttons carrying aria-sort, landing on Total descending"
    - "Under SPR on desktop, the table's declared width is exactly its six column widths summed (88 + 220 + TOTAL_SIGMA_COLUMN_WIDTH_PX + 3 x BREAKDOWN_METRIC_COLUMN_WIDTH_PX), with no spacer header cells"
    - "Switching the algorithm in place from an expanded, component-sorted EPA Breakdown to SPR shows the six SPR columns sorted by Total descending, never component columns and never a sort on a column that is not visible"
    - "The Breakdown skeleton under SPR shows the same six headers the populated SPR table shows"
    - "EPA is unchanged: phase toggles, in-place expansion, the trailing Fouls Committed column, and collapse-resets-sort all behave exactly as before; OPR is unchanged: flat Team #, Team Name, Total with no sort buttons"
  artifacts:
    - path: "apps/web/src/lib/metricKeys.ts"
      provides: "publishesComponentMetrics(algorithmId): true for epa only, with a doc comment stating the verified per-algorithm event-artifact fact"
      contains: "export function publishesComponentMetrics"
    - path: "apps/web/src/components/event/BreakdownTab.tsx"
      provides: "visibleMetricKeys with three shapes (OPR flat, SPR phases without expansion, EPA phases with expansion plus trailing ungrouped components); band row gated on publishesComponentMetrics; stale-sort fallback to DEFAULT_BREAKDOWN_SORT"
    - path: "apps/web/src/components/event/BreakdownTab.test.tsx"
      provides: "Equality pins for the SPR six-column set, the EPA seven-column set, SPR geometry, the in-place EPA-to-SPR switch, skeleton headers; expansion tests retargeted to epa"
    - path: "apps/web/src/lib/metricKeys.test.ts"
      provides: "publishesComponentMetrics equality pins for epa, spr, opr"
  key_links:
    - from: "BreakdownTab.tsx visibleMetricKeys"
      to: "lib/metricKeys.ts publishesComponentMetrics"
      via: "the SPR branch returns TOTAL_KEY plus the three METRIC_GROUPS metric keys and ignores the expanded argument"
    - from: "BreakdownTab.tsx group band row (breakdown-group-row)"
      to: "lib/metricKeys.ts publishesComponentMetrics"
      via: "render gate, replacing the hasGroupedTeamsView gate for the band row only; header sort buttons stay on hasGroupedTeamsView"
    - from: "BreakdownTabSkeleton (routes/event.$eventKey.tsx renderPending)"
      to: "visibleMetricKeys(algorithmId, season, NO_GROUPS_EXPANDED)"
      via: "existing call, so the SPR skeleton follows the SPR column set with no skeleton code change"
---

<objective>
On the event Breakdown tab under SPR, remove the always-blank Fouls Committed column and the Auto, Teleop and Endgame expand buttons (and the band row that holds them), leaving a clean six-column sortable table. EPA keeps its expansion and trailing Fouls Committed column exactly as today; OPR is untouched.

Purpose: SPR's phase components are display-only. Its event artifacts publish exactly total, phaseAuto, phaseTeleop, phaseEndgame (plus sigma), so under SPR the Fouls Committed column is always empty and every expansion reveals only empty columns. The developer called the buttons nonsense for SPR and asked that the table look clean afterward.

Output: a new publishesComponentMetrics predicate in lib/metricKeys.ts; BreakdownTab.tsx rendering three distinct shapes; equality-pinned tests.

Developer request, verbatim: "on an event breakdown page, for SPR, remove the fouls committed column. Remove the Auto ▸ Teleop ▸ Endgame ▸ buttons, they make no sense, SPR does not expand. make sure the table looks clean after you remove those things."
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/web/src/components/event/BreakdownTab.tsx
@apps/web/src/components/event/BreakdownTab.test.tsx
@apps/web/src/lib/metricKeys.ts
@apps/web/src/lib/metricKeys.test.ts

Interfaces the executor needs (verified 2026-09-13, do not re-derive):

- lib/metricKeys.ts: metricKeysFor(algorithmId, season) returns [TOTAL_KEY] for opr, else TOTAL_KEY plus every season component except adjust (so spr and epa return the SAME list, including foulsCommitted). publishesGroupMetrics(id) is true for spr and epa. hasGroupedTeamsView(id) is true for everything except opr. Also consumed by teams-table/columns.tsx and routes/teams.tsx, so hasGroupedTeamsView itself must NOT change.
- lib/metricGroups.ts: METRIC_GROUPS is the Auto, Teleop, Endgame list of { id, metricKey, label } with metricKey phaseAuto, phaseTeleop, phaseEndgame.
- packages/core/algorithms/breakdown/index.js: componentsInGroup(season, groupId). For 2024 each group holds exactly one component named auto, teleop, endgame; foulsCommitted belongs to no group.
- components/TotalSigmaValue.tsx (committed by quick task 260913-jkp): TOTAL_SIGMA_COLUMN_WIDTH_PX = 154; totalColumnHeader(id) returns "Total ± Sigma" for spr, "Total" otherwise; totalColumnWidth(id, otherwiseWidth).
- BreakdownTab.tsx exports used by tests: BreakdownTab, BreakdownTabSkeleton, buildBreakdownRows, metricLabel, NO_GROUPS_EXPANDED, sortBreakdownRows, visibleMetricKeys, BREAKDOWN_METRIC_COLUMN_WIDTH_PX (110), BREAKDOWN_TOTAL_COLUMN_WIDTH_PX (118), DEFAULT_BREAKDOWN_SORT. Pinned column widths are literals in the component: teamNumber 88, nickname 220 on desktop.
- apps/web/src/test/setup.ts stubs window.matchMedia to matches false, so useIsMobile is false (desktop widths) in every test.
- routes/event.$eventKey.tsx queries the event artifact with placeholderData keepPreviousData, so an algorithm switch in the ribbon can keep BreakdownTab MOUNTED with its expanded and sort state intact. That is why Task 2 guards stale state.

CONCURRENT SESSIONS (read before touching any file):
- Quick task 260913-jkp (another session) had UNCOMMITTED hunks in BreakdownTab.tsx and BreakdownTab.test.tsx while this plan was written: the TotalSigmaValue Total cell, metricColumnWidth(key, algorithmId), breakdownColumnHeader, and the describe block titled "Total renders the split pill under Sigma-enabled algorithms (quick task 260913-jkp)". Build ON TOP of them. Never revert, rewrite, reformat or restage them, and never change Total's width or header.
- Quick task 260913-m9m ("remove sticky columns from every event page", another session) was created at planning time with no plan yet. It may edit BreakdownTab.tsx pinning (BREAKDOWN_PINNED_COLUMN_IDS, sticky styles, the band row's sticky spacer cells, the pinning test). All instructions below reference symbols, not line numbers, so they apply to either version of the file. If pinning code has already been removed when you start, keep it removed; if it is removed underneath you mid-task, STOP and report.
- ORCHESTRATOR UPDATE (after planning): the orchestrator holds this plan until 260913-m9m's BreakdownTab commit has landed, so expect the pinning removal to be COMMITTED when you start. m9m replaced the "pinning" describe in BreakdownTab.test.tsx with a no-sticky-columns (2026-09-13) describe holding wide and narrow tests that render spr/2024 "so the group-band header row renders", reusing fullVPRMetrics2024. After this plan SPR has no band row, so: (a) the fixture rename to fullEpaMetrics2024 covers those call sites too; (b) retarget those no-sticky tests to epa (artifact override plus the renderBreakdown argument) with every assertion kept verbatim, so they still exercise the band row's spacer cells, and update any test comment that says spr renders the band row. That describe is otherwise NOT in the do-not-touch list below. Never reintroduce sticky styles, data-pinned or column pinning anywhere; any "pinned" wording in this plan (for example "Pinned column widths are literals") just means the two leading identity columns. Before editing, `git log --oneline -3 -- apps/web/src/components/event/BreakdownTab.tsx` and read the file fresh; it will differ from the planner's snapshot.
</context>

## Source Coverage Audit

| Source | Item | Covered by |
|--------|------|------------|
| GOAL (request) | Under SPR, remove the Fouls Committed column | Task 1 |
| GOAL (request) | Under SPR, remove the Auto, Teleop, Endgame expand buttons | Task 1 |
| GOAL (request) | Table looks clean after removal | Task 2 (geometry pins, stale-state guard, skeleton pins, docs) plus the orchestrator visual check below |
| Orchestrator fact 1 | EPA keeps toggles and Fouls Committed; OPR unchanged | Task 1 (EPA pin, OPR tests untouched), Task 2 (EPA width pin) |
| Orchestrator fact 2 | New predicate distinct from hasGroupedTeamsView, derived from algorithm id, in lib/metricKeys.ts | Task 1 |
| Orchestrator fact 3 | Exact SPR header ids, no band row, sort stays, skeleton matches | Tasks 1 and 2 |
| Orchestrator fact 4 | No dead spacer or ungroupedCount logic under SPR; expanded cannot affect SPR; doc comments describe three shapes | Tasks 1 and 2 |
| Orchestrator fact 5 | Build on 260913-jkp's hunks, never touch them | Precondition and commit gates in both tasks |
| Orchestrator fact 6 | Expansion tests retargeted to epa as equality pins; vpr-named collapsed test becomes SPR and EPA pins; fixture sanity | Task 1 |
| Orchestrator fact 7 | Teams list components view out of scope | Not planned (excluded by the request) |

No REQUIREMENTS.md IDs, RESEARCH.md or CONTEXT.md decisions exist for this quick task.

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: SPR Breakdown drops Fouls Committed and the phase toggles, end to end (predicate, column set, band-row gate)</name>
  <files>apps/web/src/lib/metricKeys.ts, apps/web/src/lib/metricKeys.test.ts, apps/web/src/components/event/BreakdownTab.tsx, apps/web/src/components/event/BreakdownTab.test.tsx</files>
  <read_first>
    - apps/web/src/components/event/BreakdownTab.tsx (whole file, once)
    - apps/web/src/components/event/BreakdownTab.test.tsx (whole file, once)
    - apps/web/src/lib/metricKeys.ts (publishesGroupMetrics and hasGroupedTeamsView region)
    - apps/web/src/lib/metricKeys.test.ts (the "publishesGroupMetrics / hasGroupedTeamsView" describe)
  </read_first>
  <precondition>From the repo root, `git status --short -- apps/web/src/lib/metricKeys.ts apps/web/src/lib/metricKeys.test.ts apps/web/src/components/event/BreakdownTab.tsx apps/web/src/components/event/BreakdownTab.test.tsx` prints nothing (quick task 260913-jkp has committed its BreakdownTab hunks and no other session has uncommitted edits there), and `git grep -n "totalColumnWidth" -- apps/web/src/components/event/BreakdownTab.tsx` finds the committed jkp code. If either check fails, STOP and report; do not start editing.</precondition>
  <behavior>
    - metricKeys.test.ts: publishesComponentMetrics("epa") is true; publishesComponentMetrics("spr") is false; publishesComponentMetrics("opr") is false (each asserted with toBe).
    - SPR render (algorithmId "spr", season 2024, SPR-shaped fixture): headerIds() toEqual exactly ["teamNumber", "nickname", TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame"]; also toEqual ["teamNumber", "nickname", ...visibleMetricKeys("spr", 2024, NO_GROUPS_EXPANDED)]; queryByTestId("breakdown-group-row") is null; queryAllByTestId(/^breakdown-group-toggle-/) has length 0; no "Rank" columnheader; the Total header's aria-sort is "descending"; the phaseAuto header contains a button (within(...).getByRole("button")) and its aria-sort is "none"; the phaseAuto header text contains metricLabel("phaseAuto").
    - EPA render (artifact algorithmId "epa", renderBreakdown(..., "epa", 2024), full EPA fixture): headerIds() toEqual exactly ["teamNumber", "nickname", TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame", "foulsCommitted"]; breakdown-group-row is present; each of breakdown-group-toggle-auto, -teleop, -endgame exists with aria-expanded "false".
    - visibleMetricKeys unit pins (no rendering): visibleMetricKeys("spr", 2024, { auto: true, teleop: true, endgame: true }) toEqual [TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame"]; the same four-key list for ("spr", 2026, all expanded) and ("spr", 2026, NO_GROUPS_EXPANDED); visibleMetricKeys("opr", 2024, all expanded) toEqual [TOTAL_KEY]; visibleMetricKeys("epa", 2024, NO_GROUPS_EXPANDED) toEqual [TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame", "foulsCommitted"].
    - Retargeted to epa with every existing equality list kept verbatim (never loosened to containment): the "clicking a phase toggle swaps that phase's column..." test; the partial-data "renders a blank cell once its group is expanded" test; the sorting "collapsing the group that owns the active sort key resets the sort" test; BOTH tests in the "derived phase fallback" describe (their fixture carries components and no published phase entries, which is the stale cached EPA artifact shape the derivation exists for).
  </behavior>
  <action>
    RED (tests first):
    1. metricKeys.test.ts: add publishesComponentMetrics to the existing import from "./metricKeys.js" and add one `it` inside the "publishesGroupMetrics / hasGroupedTeamsView" describe implementing the predicate behavior above. Leave every existing assertion untouched (hasGroupedTeamsView("spr") stays true).
    2. BreakdownTab.test.tsx, fixtures: rename the helper fullVPRMetrics2024 to fullEpaMetrics2024, build it from metricKeysFor("epa", 2024) with the same { value: 10, spread: 1 } entries (so existing expected strings like "10.00" still hold), rename every call site, and rewrite its doc comment to say it carries every EPA 2024 declared key, the shape EPA's event artifacts publish. Add a sibling helper sprMetrics2024() returning exactly TOTAL_KEY, phaseAuto, phaseTeleop and phaseEndgame entries ({ value: 10, spread: 1 }), with a doc comment saying this is the per-team metric set SPR's event artifacts publish (sigma omitted here; the 260913-jkp describe covers it). EPA-rendering tests pass { algorithmId: "epa" } as makeArtifact's overrides argument.
    3. BreakdownTab.test.tsx, column-set describe: replace the test whose name begins "vpr/2024 lands collapsed" with two tests implementing the SPR render and EPA render behaviors above (SPR uses sprMetrics2024; EPA uses fullEpaMetrics2024). Name them for what they pin, for example "spr/2024: Team #, Team Name, Total and the three phase columns only, with no group band row and no phase toggles, still sortable" and "epa/2024 lands collapsed: Team #, Team Name, Total, the three phase columns, then Fouls Committed, with one toggle per phase". Add a new describe "visibleMetricKeys: three shapes (unit)" with the unit pins above.
    4. Retarget the five tests listed in the behavior block to epa (artifact override plus the renderBreakdown algorithm argument). Do not touch: the OPR tests, the reversed-metrics test, tier boundaries, caption, empty and zero-one-many, long text, pinning, sortBreakdownRows, buildBreakdownRows, or anything inside the 260913-jkp describe block.
    5. Run `cd apps/web && npx vitest run src/components/event/BreakdownTab.test.tsx src/lib/metricKeys.test.ts` and read the printed counts. Confirm the NEW SPR render pin, the SPR visibleMetricKeys unit pins and the predicate test FAIL for the expected reasons (seven ids instead of six, a band row present, publishesComponentMetrics not a function), and that the retargeted EPA tests and the EPA pins already PASS (they describe unchanged EPA behavior). If a retargeted EPA test fails, the retarget is wrong; fix the test, not the component.
    6. Commit gate (see the Commit discipline block in verification). Commit only the two test files with message "test(260913-mgn): failing pins for the SPR Breakdown six-column shape" plus the attribution line.

    GREEN (implementation):
    7. lib/metricKeys.ts: add exported publishesComponentMetrics(algorithmId: string): boolean directly below publishesGroupMetrics, returning true only for "epa". Its doc comment states: whether this algorithm's EVENT artifacts publish per-team component metrics (the season components, including foulsCommitted) that the event Breakdown tab can expand a phase into; true for EPA; false for SPR, whose phase components are display-only and whose event artifacts publish exactly total, phaseAuto, phaseTeleop and phaseEndgame (plus sigma), verified 2026-09-13, so expansion there would reveal only empty columns; false for OPR, which publishes Total alone. Derived from the algorithm id, never from inspecting fetched rows (the same column-set discipline metricKeysFor states). Distinct from hasGroupedTeamsView, which still answers whether the phase columns and sort buttons show; consumed by the event Breakdown tab only, and the Teams list components view does not read it (quick task 260913-mgn scoped the change to the event Breakdown page).
    8. BreakdownTab.tsx: add publishesComponentMetrics to the existing "@/lib/metricKeys" import. In visibleMetricKeys, keep the OPR early return exactly as is; add a second early return for an algorithm where publishesComponentMetrics is false, returning TOTAL_KEY followed by METRIC_GROUPS mapped to each group's metricKey, reading neither `expanded` nor the declared ungrouped components; leave the EPA branch (the existing grouped, expanded, ungrouped construction) unchanged.
    9. BreakdownTab.tsx component body: add `const isExpandable = publishesComponentMetrics(algorithmId);` beside isGrouped. Gate the group band TableRow (data-testid breakdown-group-row) on isExpandable instead of isGrouped. Make the ungroupedCount memo return 0 when isExpandable is false (swap its isGrouped guard for isExpandable and update the dependency array). Leave isSortable keyed on isGrouped so SPR keeps its sort buttons. Do not touch the Total cell, metricColumnWidth, breakdownColumnHeader or any pinning code.
    10. Run the step 5 command again: all tests in both files pass, read from the printed counts. Run `npx tsc --noEmit -p apps/web` from the repo root: no errors.
    11. Commit gate again, then commit the files touched in GREEN (metricKeys.ts and BreakdownTab.tsx, plus a test file only if GREEN required a test edit) with message "feat(260913-mgn): SPR Breakdown shows Total and the three phases only, no Fouls Committed column and no phase toggles" plus the attribution line.
  </action>
  <verify>
    <automated>cd apps/web && npx vitest run src/components/event/BreakdownTab.test.tsx src/lib/metricKeys.test.ts</automated>
    <automated>npx tsc --noEmit -p apps/web</automated>
    <automated>grep -c "publishesComponentMetrics" apps/web/src/components/event/BreakdownTab.tsx</automated>
  </verify>
  <done>Both test files pass (counts read from output, including the new SPR and EPA pins, the predicate pins and the five retargeted EPA tests); the web typecheck prints no errors; the grep count for publishesComponentMetrics in BreakdownTab.tsx is at least 3 (import, visibleMetricKeys, component gate); the RED and GREEN commits exist and contain only this task's hunks; `git status --short` shows the four files clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Keep the SPR table clean: geometry pins, in-place algorithm switch, skeleton headers, three-shape docs</name>
  <files>apps/web/src/components/event/BreakdownTab.tsx, apps/web/src/components/event/BreakdownTab.test.tsx</files>
  <read_first>
    - apps/web/src/components/event/BreakdownTab.tsx (already in context from Task 1; re-read only the regions you edit if the file changed on disk)
    - apps/web/src/components/TotalSigmaValue.tsx (only the TOTAL_SIGMA_COLUMN_WIDTH_PX, totalColumnHeader, totalColumnWidth exports, near line 80-96)
  </read_first>
  <behavior>
    - SPR geometry (desktop, spr/2024, sprMetrics2024): the first TableRow inside thead is the label row (its first th has data-testid breakdown-header-teamNumber); document.querySelectorAll("thead th") has length 6 (no spacer or band cells); the Total header's style.width is `${TOTAL_SIGMA_COLUMN_WIDTH_PX}px`; each of the three phase headers' style.width is `${BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px`; the table element's style.width equals the sum of the six header widths AND equals `${88 + 220 + TOTAL_SIGMA_COLUMN_WIDTH_PX + 3 * BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px`.
    - EPA geometry regression pin (epa/2024, fullEpaMetrics2024): the first thead row is breakdown-group-row, and the table's style.width equals `${88 + 220 + BREAKDOWN_TOTAL_COLUMN_WIDTH_PX + 4 * BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px` (three phases plus Fouls Committed).
    - In-place switch: a test-local stateful switcher component rendered inside TestHarness holds algorithmId in useState (starting "epa") and renders a plain button (data-testid "switch-to-spr") plus BreakdownTab with that algorithmId, an epa artifact, season 2024. Two teams whose teleop order is the reverse of their Total order. Expand teleop, click the teleop header's sort button, confirm rows follow teleop; click switch-to-spr. Then: headerIds() toEqual the exact six SPR ids; breakdown-group-row is absent; rows follow Total descending; the Total header's aria-sort is "descending". Then clicking the Total header's sort button once flips it to "ascending" (proves the click handler reads the effective sort, not the stale one).
    - Skeleton pins (render BreakdownTabSkeleton inside TestHarness, waitFor columnheaders): spr/2024 columnheader textContents toEqual ["Team #", "Team Name", totalColumnHeader("spr"), metricLabel("phaseAuto"), metricLabel("phaseTeleop"), metricLabel("phaseEndgame")]; epa/2024 toEqual ["Team #", "Team Name", totalColumnHeader("epa"), metricLabel("phaseAuto"), metricLabel("phaseTeleop"), metricLabel("phaseEndgame"), metricLabel("foulsCommitted")].
  </behavior>
  <action>
    RED:
    1. BreakdownTab.test.tsx: add BreakdownTabSkeleton, BREAKDOWN_METRIC_COLUMN_WIDTH_PX and BREAKDOWN_TOTAL_COLUMN_WIDTH_PX to the "./BreakdownTab" import and TOTAL_SIGMA_COLUMN_WIDTH_PX to the existing "@/components/TotalSigmaValue" import. Add a describe "BreakdownTab: clean SPR table (quick task 260913-mgn)" holding the SPR geometry, EPA geometry, in-place switch and skeleton tests from the behavior block. Keep every assertion an equality pin.
    2. Run `cd apps/web && npx vitest run src/components/event/BreakdownTab.test.tsx`. The in-place switch test must FAIL on its row-order or aria-sort assertion (the stale "teleop" sort survives the switch today). If instead it passes, state was not preserved across the switch, so the test proves nothing: fix the switcher so BreakdownTab stays mounted, and re-run until it fails for the stale-sort reason. The geometry and skeleton pins may already pass after Task 1; that is expected, they are regression pins, and the SUMMARY must say so rather than claim them as RED.
    3. Commit gate, then commit the test file only: "test(260913-mgn): pin SPR Breakdown geometry, skeleton headers and the in-place algorithm switch" plus the attribution line.

    GREEN:
    4. BreakdownTab.tsx component body: derive the visible key list once with a useMemo over visibleMetricKeys(algorithmId, season, expanded). Derive activeSort as `sort` when that list includes sort.key, otherwise DEFAULT_BREAKDOWN_SORT. Use activeSort (not sort) in the sortedRows memo, in isActive and ariaSort, in toggleGroup's reset check, and in handleSortClick, which computes the next sort from activeSort (same key flips direction, a different key starts descending) instead of the functional updater's stale prev. Leave buildBreakdownColumns' signature alone. This is the discretionary guard for the keepPreviousData remount-free algorithm switch; it changes no landing state for any algorithm.
    5. BreakdownTab.tsx doc comments (comment-only edits, never touching 260913-jkp's comment blocks on metricColumnWidth, breakdownColumnHeader or the Total cell):
       - File header: replace the "Post-009-A shape" paragraph, which still names the retired algorithm beside EPA, with a description of three shapes: OPR flat (Total only, no band row, no sort); SPR as Total plus the three published phase columns, sortable, with no band row and no expansion because its event artifacts publish no per-team components (publishesComponentMetrics false, quick task 260913-mgn); EPA as Total plus the three phase columns plus trailing ungrouped components such as Fouls Committed, with the band row whose toggles expand a phase in place. Keep the sorting paragraph and add one sentence that a sort key no longer visible (after an in-place algorithm switch or a collapse) falls back to Total descending.
       - visibleMetricKeys doc: describe the same three branches in the order the function checks them.
       - buildBreakdownRows doc: the sentence saying two algorithms both publish the phase metrics names SPR and EPA.
       - The table style comment about the group band being the first rendered row: say the band row is the first row only under EPA; under OPR and SPR the label row is first and its cells already carry header.getSize() widths, so fixed layout reads the same geometry.
       - ungroupedCount doc: note it is EPA-only (0 whenever publishesComponentMetrics is false), since only the band row consumes it.
       - BreakdownTabSkeleton doc: add that under SPR it renders the same six headers the populated table shows, because both read visibleMetricKeys.
    6. Run `cd apps/web && npx vitest run src/components/event src/lib/metricKeys.test.ts` and read the counts: everything passes. Run `npx tsc --noEmit -p apps/web` from the repo root: no errors. Then run the root `npx vitest run` once from the repo root and read its file and test counts; if any failure is outside the four files this plan touches, do not fix it, record the failing file names in the SUMMARY as pre-existing or foreign.
    7. Commit gate, then commit BreakdownTab.tsx (plus the test file only if GREEN required a test edit): "fix(260913-mgn): Breakdown falls back to Total when the sort column is no longer visible, docs describe the three table shapes" plus the attribution line. Run `git status --short` afterward.
  </action>
  <verify>
    <automated>cd apps/web && npx vitest run src/components/event src/lib/metricKeys.test.ts</automated>
    <automated>npx tsc --noEmit -p apps/web</automated>
    <automated>npx vitest run</automated>
  </verify>
  <done>The event component tests and metricKeys tests all pass, read from printed counts, including the SPR and EPA geometry pins, the in-place switch test (which was observed failing before step 4) and both skeleton pins; the web typecheck prints no errors; the root vitest counts are recorded with any failures attributed to files outside this plan; doc comments describe OPR, SPR and EPA shapes and no longer describe the band row as always first; the commits contain only this task's hunks and `git status --short` shows both files clean.</done>
</task>

</tasks>

<threat_model>
security_enforcement is disabled for this project and this change crosses no trust boundary: it narrows which already-published, schema-validated artifact fields the Breakdown tab renders. No new input, fetch, storage or secret handling.

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260913-mgn-01 | Tampering | Shared checkout with concurrent sessions (260913-jkp, 260913-m9m) | medium | mitigate | Precondition halts on uncommitted foreign edits; every commit is by explicit path after a git diff review that halts on foreign hunks |
</threat_model>

<verification>
Commit discipline (applies to every commit in both tasks):
- Before each commit, run `git diff --stat -- <the paths being committed>` and `git diff -- <the paths being committed>` and confirm every hunk is this task's. If any hunk belongs to another session (Total pill, metricColumnWidth, breakdownColumnHeader, sticky or pinning removal, anything not described in this plan), STOP and report instead of committing.
- Stage with `git add <explicit path>` only. Never `git add -A`, `git add .`, or `git commit -a`.
- Write the commit message with multiple `-m` flags (no heredoc). The last paragraph is: Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
- Run `git status --short` after each commit and confirm the committed files are clean.
- Never wrap vitest in `timeout <n> pnpm`; read pass and fail counts from the printed output, never from the exit code alone.
- Do not push. Do not start a dev server. The executor has no network.

Phase-level checks:
- `cd apps/web && npx vitest run src/components/event src/lib/metricKeys.test.ts` passes.
- `npx tsc --noEmit -p apps/web` is clean (the root tsc does not cover apps/web).
- Root `npx vitest run` counts recorded.
- EPA and OPR tests that existed before this plan still pass with their equality lists unchanged (the only EPA edits are the algorithm retargets).
</verification>

<success_criteria>
- Under SPR the Breakdown tab renders exactly six columns (Team #, Team Name, Total ± Sigma, Auto, Teleop, Endgame), no band row, no phase toggles, sortable metric headers landing on Total descending, and a table width equal to its six column widths.
- EPA's Breakdown is behaviorally identical to before (toggles, expansion, trailing Fouls Committed, collapse-resets-sort); OPR's is identical.
- An in-place EPA-to-SPR switch never leaves component columns or a sort on an invisible column.
- The SPR skeleton matches the SPR populated headers.
- All commits contain only this task's hunks; 260913-jkp's code is untouched.
</success_criteria>

<output>
Do NOT write SUMMARY.md (Write blocks subagents from it, and heredocs are not a fallback). Return the full SUMMARY body as the final message; the orchestrator writes `.planning/quick/260913-mgn-event-breakdown-spr-table-remove-fouls-c/260913-mgn-SUMMARY.md`.

The SUMMARY must include: commit hashes; RED evidence per task (which tests failed and why, and which pins were regression pins that already passed); the printed pass and fail counts for the scoped web run, the web typecheck and the root vitest run; and a one-line description suitable for a STATE.md Quick Tasks row that contains no pipe character.
</output>

## ORCHESTRATOR-ONLY: post-execution visual check

The executor cannot run this (no network). After the executor returns and its commits are verified:

1. Start a local dev server with live data per the local visual verification recipe memory: from apps/web run `VITE_ARTIFACT_ORIGIN= npx vite --port <fresh port> --strictPort` (the env var must be EMPTY, never a hostname and never the literal word local). Use a fresh port on every restart and verify the server by page CONTENT, not HTTP status.
2. Open a 2026 event Breakdown tab (for example `/event/2026alhu?tab=breakdown&algorithm=spr`, adjusting the search params to whatever the ribbon produces) and screenshot at desktop width (about 1440 wide) and phone width 390, under SPR and under EPA (four screenshots).
3. SPR must show: no band row above the column labels, no Auto, Teleop or Endgame buttons, no Fouls Committed column, the "Total ± Sigma" header and phase headers top-aligned with no empty strip above them, the data card hugging the table width with no trailing blank column, and at 390 the Team # column pinned (unless 260913-m9m has shipped by then) with a horizontal scroll that ends exactly at Endgame.
4. EPA must still show the Auto, Teleop, Endgame toggle row and the trailing Fouls Committed column; expand one phase to confirm expansion still works.
5. Switch the ribbon from EPA (with a phase expanded and a component column sorted) to SPR without reloading, and confirm the table lands on six columns sorted by Total descending.
6. Do not push from the orchestrator without checking `git log origin/main..main` first: a push deploys every other session's commits on main too.
