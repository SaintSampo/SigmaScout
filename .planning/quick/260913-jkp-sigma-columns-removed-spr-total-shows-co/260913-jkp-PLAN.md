---
phase: 260913-jkp-sigma-columns-removed-spr-total-shows-co
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/scheduled.test.ts
  - apps/web/src/components/TotalSigmaValue.tsx
  - apps/web/src/components/TotalSigmaValue.test.tsx
  - apps/web/src/styles/theme.css
  - apps/web/src/components/MetricValue.tsx
  - apps/web/src/components/event/InsightsTab.tsx
  - apps/web/src/components/event/InsightsTab.test.tsx
  - apps/web/src/components/event/BreakdownTab.tsx
  - apps/web/src/components/event/BreakdownTab.test.tsx
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/AlliancesTab.test.tsx
  - apps/web/src/components/teams-table/columns.tsx
  - apps/web/src/components/teams-table/columns.test.tsx
  - apps/web/src/components/teams-table/rowModel.ts
  - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
  - apps/web/src/components/team/SeasonHeader.tsx
  - apps/web/src/components/team/SeasonHeader.test.tsx
  - apps/web/src/components/methodology/sigmaContent.ts
autonomous: true
requirements: [QUICK-260913-jkp]

estimate:
  tokens: 190000
  raw_tokens: 380000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Under SPR, no Sigma column exists in the Teams list and no separate Sigma tile exists on a team page; the Bubble chart's Sigma axis is unchanged"
    - "Under SPR, the Teams list Total column, the team page Total tile, and the event Insights Total column, Breakdown Total column and Alliances pick cells each show one split pill: Total in Total's tier, then a ± glyph and Sigma (2 decimals) in Sigma's own tier"
    - "Every SPR event artifact's teams[].metrics.sigma equals that team's teams-row sigma value and its team-season seasonStats.metrics.sigma entry (one season-final value, three artifacts); OPR and EPA event artifacts carry no sigma key"
    - "The Alliances Combined Total shows ± sqrt(3 x sum of the three picks' Sigma squared) in an untiered neutral half, only when all three first picks carry Sigma; otherwise it is the bare combined total as today"
    - "Wherever no Sigma is available (OPR, EPA, a team with no sigma entry, or an event artifact published before the republish) the cell renders exactly today's single Total box, never an empty right half"
    - "The team page pill reads Sigma from seasonStats directly, so it stays visible when the header shows the last-official-match snapshot (history rows carry no sigma)"
    - "A live Worker tick keeps the prior published sigma entry for touched teams in both the event artifact and the team-season artifact"
    - "spread never renders anywhere, including inside the pill"
    - "A stale Teams URL carrying sort=sigmaScore resolves to Total"
  artifacts:
    - path: "apps/web/src/components/TotalSigmaValue.tsx"
      provides: "The shared split-pill component, TOTAL_SIGMA_COLUMN_WIDTH_PX, totalColumnHeader, totalColumnWidth"
    - path: "apps/web/src/styles/theme.css"
      provides: "metric-pill rules built only from existing tokens"
    - path: "packages/harness/publish.ts"
      provides: "buildEventTeamsStanding publishes the season-final sigma entry on both publish paths"
    - path: "apps/worker/src/scheduled.ts"
      provides: "touchedEventTeamMetrics carry-forward used by mergeEventArtifact and mergeTeamSeasonArtifact"
  key_links:
    - from: "packages/harness/publish.ts publishSeasons event loop"
      to: "buildEventTeamsStanding"
      via: "the existing sigmaMetricForAlgo object, the same one the teams row and team-season artifact consume"
    - from: "apps/worker/src/scheduled.ts mergeEventArtifact"
      to: "prior event artifact teams[].metrics.sigma"
      via: "touchedEventTeamMetrics"
    - from: "apps/web InsightsTab / BreakdownTab / AlliancesTab"
      to: "event artifact teams[].metrics.sigma"
      via: "SIGMA_METRIC_KEY lookup, tier from tierForPercentile(percentile)"
    - from: "apps/web SeasonHeader Total tile"
      to: "artifact.seasonStats.metrics.sigma"
      via: "direct read, never the metricsOverride history row"
---

<objective>
Delete every per-team Sigma Score column and tile, and render SPR's Total everywhere the developer named
(Teams list, team page Total tile, event Insights, Breakdown and Alliances tabs) as one joined split pill:
Total in its own tier box, then "± Sigma" in Sigma's own tier box, no gap (sketch 011 winner A). Event tabs
get Sigma from the event artifact itself, so the pipeline and the live Worker must publish and preserve it.

Developer request, verbatim: "delete all sigma columns. now, anywhere total is displayed for SPR, display a
combined box with sigma after total, seperated by a +/- glyph. do this for the teams list, the total on every
team page, and the insight, breakdown, and alliance tabs on every event page."

Locked decisions honoured (260913-jkp-CONTEXT.md; the file numbers none, so they are cited by heading):
- CONTEXT "Event-tab Sigma source": pipeline route. Sigma is published inside event standings (publish.ts)
  and preserved by the Worker's live event path. Event pages never fetch the Teams artifact.
- CONTEXT "Box design": split pill, each half in its own tier, ± leads the Sigma half, shipped tier tokens,
  008-C inset ring Common, plain single Total box when no Sigma exists.
- CONTEXT "Alliances Combined Total": ± sqrt(3 x sum Sigma^2), the Match Band formula; untiered half.
- CONTEXT "Claude's Discretion": header copy "Total ± Sigma"; stale sort=sigmaScore resolves to Total; the
  Bubble chart's Sigma axis stays.

Purpose: Sigma stops competing with Total as a separate number and becomes Total's honest ± on every surface.
Output: pipeline + Worker change (needs a republish, run by the orchestrator), one shared web component,
five surfaces converted, widths re-measured, Sigma page copy corrected.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/260913-jkp-sigma-columns-removed-spr-total-shows-co/260913-jkp-CONTEXT.md
@.planning/sketches/011-total-sigma-joined-box/README.md
@.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md
@.planning/quick/260913-g66-match-band-correction-win-odds-separatio/260913-g66-SUMMARY.md

## Facts re-verified at HEAD d52e5ced (after 260913-it4 landed), 2026-09-13

- publish.ts: `buildEventTeamsStanding(metricsByTeam, teamKeys, teamInfo, rankingPools)` near line 2098;
  seasons call site near 3104 (inside `for (const e of eventMeta)`); `--event` call site near 3711.
  `sigmaMetricForAlgo` is computed near 2900 with `consistencyMetricByTeam` (packages/harness/consistencyMetric.ts,
  type `ConsistencyMetricEntry {value, percentile}`) and is in scope at the seasons event loop. The `--event`
  path has `layer` (a SigmaScoutLayer with `consistencyByTeam()`), `seasonFinalMetrics` and `teamsThisSeason`
  in scope. consistencyMetric.ts replaced swingMetric.ts; there is no `swingMetricForAlgo` any more.
- `buildEventArtifact`'s `roundTeamMetricRecord` (publish.ts ~231) keeps `percentile` and rounds `value`,
  so a `{value, percentile}` sigma entry survives the builder. `EventTeamSchema.metrics` is
  `MetricsRecordSchema` (record of TeamMetricSchema, optional percentile): no schema change needed, and
  `PAGE_ARTIFACT_SCHEMA_VERSION` stays 1.
- Live 2026alhu spr event artifact: teams[].metrics keys are exactly total, phaseAuto, phaseTeleop,
  phaseEndgame. Live frc2481 2026 spr team-season artifact: seasonStats.metrics.sigma = {value 72.97,
  percentile 1}; its 66 metricHistory rows carry NO sigma.
- apps/worker/src/scheduled.ts: `mergeEventArtifact` (~657) rebuilds each TOUCHED team row as
  `roundTeamMetricRecord(touchedMetrics[teamKey] ?? {})`, which drops sigma (and every percentile);
  `mergeTeamSeasonArtifact` (~784) writes `seasonStats: { record, metrics: roundTeamMetricRecord(metrics) }`,
  which drops seasonStats sigma too. `touchedTeamsRowMetrics` (~1474) is the existing teams-row carry-forward
  and the pattern to copy. `SIGMA_METRIC_KEY` is already imported there.
- Web: Teams list Sigma column in teams-table/columns.tsx (~437, header "Sigma", size 84); team page Sigma
  tile in team/SeasonHeader.tsx (~76 and ~306). No other Sigma column/tile exists in apps/web/src.
  `metricKeysFor` never includes sigma and the Sigma column was never in `sortableColumnIds`, so a stale
  sort=sigmaScore already falls through `resolveSortKey` to Total: it needs a pinning test, not a fix.
- `withDerivedGroupMetrics` returns `{ ...derived, ...metrics }`, so a sigma entry passes through the
  Insights/Breakdown row models untouched.
- Tokens available in theme.css: `--color-bg-inset` #f1f5f9 and `--color-text-muted` #475569, exactly the
  sketch's untiered `t-none` fill and ink. Tier tokens `--tier-*` unchanged.
- sigmaScore.ts exports `SIGMA_METRIC_KEY`, `usesSigmaScore`, `allianceSigmaBandVariance(roster, map)`
  (sum of squares, all-or-nothing) and `sigmaMatchBandVariance(rosterSize, variance)` (rosterSize x variance).
  The web already imports from `../../../../../packages/harness/sigmaScore.js`.

## Width measurement (planner, 2026-09-13) — the source for every width constant below

Rig: Playwright Chromium, `@fontsource-variable/inter` latin wght woff2 from apps/web/node_modules, the
shipped `.metric-tier` / `.text-role-body` / `.numeric-cell` / `.th-cell-label` rules, and the sketch 011
`.jA` split-pill geometry. Rig check: a single boxed "415.98" measured 65.16px, identical to the committed
METRIC_COLUMN_WIDTH_SPREADLESS_PX measurement, so this rig agrees with the prior one.

Worst-case strings, swept from the LIVE spr@3.0.0+baseline artifacts (teams artifacts 2016-2020 and
2022-2026, plus every event artifact in those seasons, 2,825 events):
- Total: 6 characters (event "425.67" at 2026dal; season "400.21", "-41.67").
- Sigma: 5 characters (max 92.00, 2026).
- Combined total: 7 characters ("1024.22" at 2026dal). Combined band with season-final Sigma: 6 characters
  (max 235.26 at 2026cmptx).
- Largest SPR event artifact: 223,178 bytes (2016micmp, 102 teams).

Measured:
- Pill "425.67" | "±92.00": 130.31px (halves 64.16 + 66.16).
- Pill "1024.22" | "±235.26": 148.47px (halves 73.23 + 75.23).
- Header "TOTAL ± SIGMA" (th-cell-label): 93.67px, 109.67 with the 16px header padding.
- Header "COMBINED TOTAL ± SIGMA": 162.34px, 178.34 with padding.
- "(backup)" label, 12px/600: 52.11px. Team number "10428": the committed 51.88px (kept, conservative).

Derived (content + 16px TableCell p-2 padding + the repo's 6px hinting buffer, rounded up to an even px):
- TOTAL_SIGMA_COLUMN_WIDTH_PX = 154 (130.31 + 16 + 6 = 152.31). Header 109.67 fits.
- Alliances SPR pick column = 214 (51.88 + 8 gap + 130.31 + 16 + 6 = 212.19).
- Alliances SPR backup column = 274 (51.88 + 8 + 130.31 + 8 + 52.11 + 16 + 6 = 272.30); one backup per row
  is the width case, more wrap as today.
- Alliances SPR Combined column = 180: the value needs 170.47 (148.47 + 22), the header needs 178.34 and binds.
- Phone-390 consequence, stated rather than hidden: Teams list and Insights keep the shared
  NICKNAME_COLUMN_WIDTH_NARROW_PX = 90. The pill starts at 128 (pinned) + 90 + 8 = 226px, its Total half ends
  at 290.16px (fully visible at scroll 0, so ui-polish F3's "a tiered value on the first screenful" holds),
  and its Sigma half ends at 356.31px, about 14px past the 342px scroller until the reader scrolls. Nickname
  is deliberately NOT narrowed for SPR only (that would add an algorithm-conditional layout and cost OPR/EPA
  nothing but SPR readability). The orchestrator shows Jacob the phone screenshot; see the post-execution section.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): Sigma rides the event artifact into the Insights Total pill, one path end to end</name>
  <files>packages/harness/publish.ts, packages/harness/publish.test.ts, apps/web/src/components/TotalSigmaValue.tsx, apps/web/src/components/TotalSigmaValue.test.tsx, apps/web/src/styles/theme.css, apps/web/src/components/event/InsightsTab.tsx, apps/web/src/components/event/InsightsTab.test.tsx</files>
  <read_first>
    - packages/harness/publish.ts lines 2060-2125 (withPublishedTiers, buildEventTeamsStanding), 2880-2990 (sigmaMetricForAlgo and the teams-row merge comment), 3076-3110 (seasons event loop), 3600-3720 (--event replay and its standings call)
    - packages/harness/consistencyMetric.ts lines 95-160
    - packages/harness/publish.test.ts: the describe "publishSeasons — D-10 as-of-event value + season-pool percentile on published event artifacts" (~3709), "publishSeasons and --event agree on the SigmaScout layer" (~4806), and the helpers findEventArtifact (~174) and findTeamArtifact (~228)
    - apps/web/src/components/MetricValue.tsx (whole file; the DisplayMetric spread rule)
    - apps/web/src/styles/theme.css lines 795-850 (.metric-tier and modifiers)
    - apps/web/src/components/event/InsightsTab.tsx lines 225-300 and 360-440 (columns, narrow order, skeleton)
    - .planning/sketches/011-total-sigma-joined-box/index.html lines 39-54 (the .jA rules: the visual spec)
  </read_first>
  <behavior>
    - publishSeasons with spr: every team row of a published event artifact that has a published team-season artifact carries metrics.sigma deep-equal to that team-season artifact's seasonStats.metrics.sigma, and sigma is the LAST key of that metrics record.
    - publishSeasons with opr: no event artifact team row has a sigma key.
    - The --event path publishes the same teams[].metrics.sigma entries as the seasons path for the same event.
    - TotalSigmaValue with no sigma renders innerHTML identical to MetricValue given the same total and tier.
    - TotalSigmaValue with no total renders the blank MetricValue cell and no ± text, even when sigma is given.
    - TotalSigmaValue with both renders one pill: left half text "425.67" carrying only Total's tier modifier, right half text "±92.00" carrying only Sigma's tier modifier (for example rare Total with epic Sigma).
    - An undefined totalTier or sigma tier leaves that half with no metric-tier modifier; a neutral sigma gives the right half the neutral class and no tier modifier.
    - A total carrying spread 33 never prints "33.00".
    - Insights under spr with sigma on the rows: Total header "Total ± Sigma", Total cells are pills; the same fixture with sigma stripped renders exactly one metric-tier box per Total cell and no pill; opr renders header "Total" and no pill.
  </behavior>
  <action>
Write the failing tests from the behavior list first (publish.test.ts, TotalSigmaValue.test.tsx, InsightsTab.test.tsx), run them red, then implement. Commit test and implementation separately by explicit path.

PIPELINE (publish.ts), per CONTEXT "Event-tab Sigma source":
1. Give buildEventTeamsStanding a fifth REQUIRED parameter, sigmaByTeam, typed as a readonly record of team key to ConsistencyMetricEntry (import the type from ./consistencyMetric.js). For each team, build the record with withEventPercentiles exactly as today, THEN append the SIGMA_METRIC_KEY entry only when sigmaByTeam has one for that team, as the last key. Merging after the pool pass means the season ranking pool never sees or re-ranks Sigma: its percentile is the inverted residual percentile consistencyMetricByTeam already produced, so do not re-invert or recompute it. A team with no entry gets no key at all (never present-and-undefined). Required, not optional, for the reason the function's doc already gives (PD-02: an optional input is an opt-out); non-Sigma algorithms pass an empty object.
2. Seasons call site: pass the existing sigmaMetricForAlgo. Do not compute a second one. That single object already feeds the teams row and the team-season artifact, so all three artifacts publish one season-final value per team by construction.
3. --event call site: after the fold loop (so consistencyByTeam is season-final), compute the entry the way the seasons path does: when usesSigmaScore(algorithm.id), consistencyMetricByTeam with valueByTeam from layer.consistencyByTeam(), metricsByTeam seasonFinalMetrics, teamKeys teamsThisSeason, metricKey SIGMA_METRIC_KEY; otherwise an empty object. Pass it. This is code parity for the existing two-path agreement tests only; the --event mode must never be run against a real event (it publishes cold).
4. Update the doc comments on buildEventTeamsStanding and EventTeamStandingInput to say SPR standings now also carry the season-final sigma entry beside the AS-OF-EVENT Total and phase values, and why it is season-final (same value as the teams row and team page by construction). Mirror the plain wording of the teams-row merge comment near withPublishedTiers.
5. Byte cost, for the SUMMARY: about 40 bytes per rostered SPR team; the largest live SPR event artifact is 223,178 bytes (2016micmp, 102 teams), so about +4.3 KB and still roughly 118 KB under the 350,000-byte event ceiling. The committed largest event artifact (256,899 bytes, an EPA key) does not change because EPA publishes no sigma. Do not edit docs/publish-budget.md: the orchestrator transcribes the real post-republish figure.
6. Existing tests that pin an exact SPR event metrics key set will now fail. Update them to the new exact set including sigma (equality), never loosen them to a containment check. New tests compare against the team-season artifact by equality and assert the compared-team count is greater than zero and equals the event roster size, so the comparison cannot pass vacuously.

SHARED COMPONENT (apps/web/src/components/TotalSigmaValue.tsx), per CONTEXT "Box design":
7. Export a TotalSigmaValue component with props total (DisplayMetric, optional), totalTier (Tier, optional), sigma (optional; either value plus optional tier, or value plus neutral true), className. Rules: no total means return MetricValue with no metric (blank cell; a Sigma never renders without its Total). No sigma means return MetricValue with the same total, tier and className, unchanged, so every no-Sigma surface is byte-identical to today. Both present means one outer span with classes numeric-cell, whitespace-nowrap, metric-pill (plus className) and data-testid total-sigma-pill, holding a left span metric-pill__total (plus metric-tier--TIER only when totalTier is defined) that wraps a text-role-body span with total.value.toFixed(2), and a right span metric-pill__sigma (plus metric-tier--TIER when a tier is given, or metric-pill__sigma--neutral when neutral, or no modifier) that wraps a text-role-body span holding a metric-pill__pm span containing the ± character followed by sigma.value.toFixed(2). Never read total.spread (developer rule 2026-09-09, see DisplayMetric's doc). Put no aria-label on these spans: a generic span drops it (the CR-02 lesson recorded in AlliancesTab.tsx); the visible text is the accessible text. toFixed restores trailing zeros only; add no rounding option.
8. In the same module export TOTAL_SIGMA_COLUMN_WIDTH_PX = 154 with a doc comment carrying the measurement block from this plan's context (rig, worst-case strings, 130.31 + 16 + 6), totalColumnHeader(algorithmId) returning "Total ± Sigma" when usesSigmaScore(algorithmId) and "Total" otherwise, and totalColumnWidth(algorithmId, otherwiseWidth) returning 154 for Sigma algorithms and otherwiseWidth for the rest.
9. theme.css, directly after the .metric-tier--common rule, with a comment citing sketch 011 winner A and quick task 260913-jkp. metric-pill: display inline-flex, align-items stretch, white-space nowrap, font-variant-numeric tabular-nums, vertical-align middle. metric-pill__total: display inline-flex, justify-content flex-end, padding 3px 7px 3px 8px, border-radius 5px 0 0 5px, min-width 58px. metric-pill__sigma: display inline-flex, justify-content flex-end, padding 3px 8px 3px 6px, border-radius 0 5px 5px 0, min-width 54px. metric-pill__pm: opacity 0.7, margin-right 3px. metric-pill__sigma--neutral: background var(--color-bg-inset), color var(--color-text-muted). Tier colour comes from the existing metric-tier--* modifier classes, which set only background, color or box-shadow and no geometry, so they apply to each half unchanged. Common stays the inset box-shadow ring, never a border (colour-and-tiers.md), and two Common halves meeting at the seam is the accepted look. No colour literal anywhere (D-06).

INSIGHTS (the tracer's web end):
10. The Total column cell reads the row's SIGMA_METRIC_KEY entry and renders TotalSigmaValue with total = the Total entry, totalTier = tierForPercentile(total percentile), sigma = the entry's value with tier tierForPercentile(entry percentile) when the entry exists. Header totalColumnHeader(algorithmId); size totalColumnWidth(algorithmId, 120) in wide and narrow modes alike (the F3 narrow column ORDER is unchanged). The skeleton's header row uses the same label and width, so nothing shifts when data lands. Build test fixtures through EventArtifactSchema the way the existing Insights tests do, so a schema that dropped sigma would fail the test.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts</automated>
    <automated>cd apps/web && npx vitest run src/components/TotalSigmaValue.test.tsx src/components/event/InsightsTab.test.tsx</automated>
    <automated>npx tsc --noEmit && npx tsc --noEmit -p apps/web</automated>
  </verify>
  <done>An SPR publish writes sigma onto every event standings row with a Sigma Score, equal to the team page's entry, and none for OPR. The Insights tab renders that entry as the split pill and falls back to today's single box when it is absent. Both publish paths agree. Tests and typechecks pass by their printed output, and the commits are made by explicit path with git status checked after each.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The live Worker keeps the published Sigma entry on touched teams (event and team-season artifacts)</name>
  <files>apps/worker/src/scheduled.ts, apps/worker/test/scheduled.test.ts</files>
  <read_first>
    - apps/worker/src/scheduled.ts lines 470-482 (roundTeamMetricRecord), 636-706 (mergeEventArtifact), 772-844 (mergeTeamSeasonArtifact), 1346-1400 (runPhaseBAndReport call sites), 1436-1490 (touchedTeamsRowMetrics, the pattern to copy)
    - apps/worker/test/scheduled.test.ts: the describes "runTick — one live event, one new match" (~402) and "260912-tnk: live Teams-row tiers" (~942), including how they seed existing R2 artifacts
  </read_first>
  <behavior>
    - touchedEventTeamMetrics with prior {total {value 10, percentile 40}, sigma {value 27.8, percentile 83.2}} and fresh {total {value 12.34}} deep-equals {total {value 12.34}, sigma {value 27.8, percentile 83.2}}, with sigma as the last key.
    - When fresh already has a sigma key, the fresh entry wins and nothing is carried.
    - With prior undefined, the result equals the rounded fresh record.
    - No key other than sigma is ever carried from prior.
    - runTick end to end: an existing event artifact and team-season artifact seeded with a sigma entry for a team that plays the new match come back from the tick with that team's event metrics.sigma and seasonStats.metrics.sigma deep-equal to the seeded entries.
  </behavior>
  <action>
Tests first (red), then implementation; commit by explicit path.

This is verified fact 5 from the orchestrator, and its same failure class on the team page: a live tick rebuilds a touched team's metrics from what the Worker computes, and the Worker never computes the season-final Sigma. So one match played during an event would strip Sigma from that team's event pill, and from its team page pill, until the next offline publish.

1. Export touchedEventTeamMetrics(priorMetrics, freshMetrics) next to touchedTeamsRowMetrics, with a doc comment in the same style. It returns roundTeamMetricRecord(freshMetrics) with the prior record's SIGMA_METRIC_KEY entry appended last. The appended entry keeps its value and percentile exactly as published: already rounded, so it is not re-rounded. It is appended only when the prior record has that entry and the fresh record lacks the key. The prior parameter's type accepts value, optional spread and optional percentile. Widen the return type just enough to carry percentile; do not change roundTeamMetricRecord. State in the doc comment, as a known limitation left alone here, that a touched team's OTHER metrics already lose their percentile on a live tick (the Worker computes none). That loss is out of scope for this task.
2. mergeEventArtifact: build each touched team row's metrics with touchedEventTeamMetrics, passing the prior row's metrics (the existing prior lookup) and the fresh record. Untouched rows are already copied wholesale and keep their sigma.
3. mergeTeamSeasonArtifact: seasonStats.metrics becomes touchedEventTeamMetrics(existing seasonStats metrics, metrics). Everything else in that return object stays exactly as it is, including the leading existing-spread and its comment. Task 3 reads the team page pill's Sigma from seasonStats, so this is what keeps it visible during a live event.
4. Cost, for the SUMMARY: zero added subrequests, and one property lookup and one object per touched team per algorithm.
5. Tests: unit tests for the helper, in a new describe "260913-jkp: live ticks keep the published Sigma entry". Add one runTick-level test that seeds the existing event and team-season artifacts (reuse the seeding the neighbouring runTick describes use), runs one tick, and reads both written artifacts back. If scheduled.replay.test.ts or scheduled.officialRecord.test.ts pin exact seasonStats or event metrics key sets, update them to the new exact sets. Never loosen them.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/scheduled.test.ts apps/worker/test/scheduled.replay.test.ts apps/worker/test/scheduled.officialRecord.test.ts apps/worker/test/scheduled.rp.test.ts</automated>
    <automated>npx tsc --noEmit -p apps/worker</automated>
  </verify>
  <done>A live tick that folds a match for a team keeps that team's published sigma entry on both the event artifact and its team-season artifact, pinned by a unit test and a runTick test. The Worker typecheck is clean and existing Worker tests pass, read from output.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Delete the Sigma column and tile; split pill on the Teams list, team page, Breakdown and Alliances; widths, headers, copy</name>
  <files>apps/web/src/components/teams-table/columns.tsx, apps/web/src/components/teams-table/columns.test.tsx, apps/web/src/components/teams-table/rowModel.ts, apps/web/src/components/teams-table/TeamsBubbleChart.tsx, apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/components/team/SeasonHeader.test.tsx, apps/web/src/components/event/BreakdownTab.tsx, apps/web/src/components/event/BreakdownTab.test.tsx, apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/event/AlliancesTab.test.tsx, apps/web/src/components/MetricValue.tsx, apps/web/src/components/methodology/sigmaContent.ts</files>
  <read_first>
    - apps/web/src/components/TotalSigmaValue.tsx (from Task 1)
    - apps/web/src/components/teams-table/columns.tsx lines 200-300 and 330-549
    - apps/web/src/components/teams-table/rowModel.ts lines 60-190
    - apps/web/src/lib/resolveSortKey.ts and apps/web/src/routes/teams.tsx lines 60-80
    - apps/web/src/components/team/SeasonHeader.tsx (whole file)
    - apps/web/src/routes/team.$teamNumber.tsx lines 70-105 (headerMetrics is the history row)
    - apps/web/src/components/event/BreakdownTab.tsx lines 238-330 and 470-520
    - apps/web/src/components/event/AlliancesTab.tsx lines 40-260 and 318-620
    - packages/harness/sigmaScore.ts lines 200-280 (allianceSigmaBandVariance, sigmaMatchBandVariance)
    - apps/web/src/components/methodology/sigmaContent.ts lines 190-215 and sigmaContent.test.ts (dash ban and copy rules)
  </read_first>
  <behavior>
    - Teams list, spr 2026 grouped and components views: the column id list deep-equals today's list minus the Sigma column id; the Total header reads "Total ± Sigma" and its size is 154 in wide and narrow modes; a row with a Sigma Score renders the pill in Total; a row without one renders one metric-tier box.
    - Teams list, epa and opr: the column id lists, Total header "Total", and Total sizes are unchanged from today.
    - resolveSortKey("sigmaScore", sortableColumnIds("spr", 2026, view)) equals TOTAL_KEY for both views.
    - Team page, spr artifact rendered WITH a metricsOverride history row that has no sigma: the Total tile shows the pill with seasonStats sigma 72.97 and its label reads "Total ± Sigma"; no separate Sigma tile exists.
    - Team page, opr artifact: the Total tile label reads "Total" and the tile is a single box.
    - Breakdown, spr: only the Total column holds pills, component columns stay single boxes, the Total header reads "Total ± Sigma", and sorting by total gives the same row order as before.
    - Breakdown, sigma-stripped artifact: plain Total boxes.
    - Alliances, spr with Sigma on every pick: each pick cell and backup cell shows its own pill with its own tiers, and the Combined Total pill's neutral right half reads "±" plus sqrt(3 x (a^2 + b^2 + c^2)).toFixed(2), computed in the test from the fixture's three Sigmas.
    - Alliances, one first-three pick without Sigma: that alliance's Combined Total is a bare box, while the other picks still show pills.
    - Alliances, sigma-stripped artifact: single boxes everywhere.
    - Alliances headers and widths: spr reads "Combined Total ± Sigma" with pick 214, combined 180, backup 274; opr and epa read "Combined Total" with pick 150, combined 128, backup 240.
  </behavior>
  <action>
Tests first (red), then implementation; commit in logical slices by explicit path, git status after each commit.

TEAMS LIST (columns.tsx), per the developer's "delete all sigma columns":
1. Delete the Sigma column definition, its doc comment and its entry in the returned column list. Keep rowModel's sigmaScore and sigmaTier fields: the Bubble chart's Sigma axis reads them and stays (CONTEXT "Claude's Discretion"). Only fix the doc comments in rowModel.ts and TeamsBubbleChart.tsx that describe "the Sigma column".
2. The metric column whose key is TOTAL_KEY renders TotalSigmaValue with total = the entry, totalTier = the entry tier coalesced to "common" (unchanged), and sigma = the row's sigmaScore with the row's sigmaTier passed through as-is when sigmaScore is defined. Do not coalesce that tier: rowModel already decided present-entry Common versus stale-row no-tier. Its header is totalColumnHeader(algorithmId). Its size is TOTAL_SIGMA_COLUMN_WIDTH_PX in both modes when usesSigmaScore(algorithmId), else today's expression (120 narrow, metricColumnWidth wide). Other metric columns are untouched. Rewrite the narrow-width comments near leadMetricIndex and the narrow ordering to record the phone-390 arithmetic from this plan's context (Total half fully visible at 290.16px, Sigma half ends 356.31px against a 342px scroller). NICKNAME_COLUMN_WIDTH_NARROW_PX stays 90.
3. Stale sort=sigmaScore: nothing to change in code. The Sigma column was never sortable, so resolveSortKey already returns Total. Pin that with the equality test in the behavior list.

TEAM PAGE (SeasonHeader.tsx):
4. Delete the separate Sigma tile component, its render block, its comments and its now-unused imports and variables.
5. The Total tile renders TotalSigmaValue. Its Sigma comes from artifact.seasonStats.metrics[SIGMA_METRIC_KEY] read DIRECTLY, never from the resolved metrics record. When the route passes metricsOverride, that record is the last-official-match metricHistory row, and history rows carry no sigma (verified live 2026-09-13: frc2481 2026 spr, 66 history rows, none with sigma). That is why today's tile silently vanishes once the events query resolves; the pill must not. Say so in a comment, and note that Sigma is season-final while the tiles are the official snapshot, the same pairing the Teams row publishes. Sigma tier = tierForPercentile(entry percentile). The tile label reads "Total ± Sigma" when the pill renders, else "Total". Total's own value and tier derivation are unchanged.

BREAKDOWN (BreakdownTab.tsx):
6. The TOTAL_KEY column cell renders TotalSigmaValue from the row's total and SIGMA_METRIC_KEY entries (tiers via tierForPercentile). Its header is totalColumnHeader(algorithmId); other keys keep metricLabel. Replace the key-only width helper with an algorithm-aware one: Total gets totalColumnWidth(algorithmId, BREAKDOWN_TOTAL_COLUMN_WIDTH_PX), components keep BREAKDOWN_METRIC_COLUMN_WIDTH_PX. The group-header spacer cell that currently sizes itself with BREAKDOWN_TOTAL_COLUMN_WIDTH_PX must use the same algorithm-aware Total width, or the two header rows misalign. The skeleton also uses it. Sorting stays keyed on the total value; component columns stay single boxes.

ALLIANCES (AlliancesTab.tsx), per CONTEXT "Alliances Combined Total":
7. AlliancePick gains sigma (value plus optional percentile, or undefined), read from the team row's SIGMA_METRIC_KEY entry in pickFromTeamKey. PickCell and BackupCell render TotalSigmaValue with the pick's total and sigma, each tiered by tierForPercentile on its own percentile.
8. AllianceRow gains combinedSigma (number or undefined). In buildAllianceRows it is defined only when combined is defined AND each of the first ALLIANCE_COMBINED_PICK_COUNT picks carries sigma. Compute it with the shipping helpers, never re-typed arithmetic: build a map from those three pick keys to their Sigma values, then take the square root of sigmaMatchBandVariance(ALLIANCE_COMBINED_PICK_COUNT, allianceSigmaBandVariance(those three keys, map)). That is sqrt(3 x sum Sigma^2), the Match Band formula. It is all-or-nothing, like combineAlliancePicks and allianceSigmaBandVariance: never a partial sum over the picks that happen to have Sigma.
9. CombinedCell renders TotalSigmaValue with total = combined, totalTier = the approximate tier (unchanged), and sigma = combinedSigma with neutral true when defined. Keep the approximate-tier disclosure wrapper exactly as it is (role group, title, aria-label, only when boxed). The band half is neutral because no percentile exists for a three-team band, so no tier is invented. combineAlliancePicks keeps returning the bare value; rewrite only its doc paragraph that says the Sigma replacement is not wired yet, so it points at buildAllianceRows.
10. Widths: gate pick and combined widths with usesSigmaScore instead of algorithmPublishesSpread in this file, and add the same gate for the backup column. Replace the obsolete VPR-era PICK_COLUMN_WIDTH_PX (190) and COMBINED_COLUMN_WIDTH_PX (130) with PICK_COLUMN_WIDTH_SIGMA_PX = 214 and COMBINED_COLUMN_WIDTH_SIGMA_PX = 180, and add BACKUP_COLUMN_WIDTH_SIGMA_PX = 274. Rewrite their doc comments with this plan's measurement lines. Keep the SPREADLESS constants (150, 128) and the other algorithms' backup width of 240 unchanged. The Combined header reads "Combined Total ± Sigma" under a Sigma algorithm and "Combined Total" otherwise; turn the headers constant into a function of the algorithm used by both the table and the skeleton.

COPY:
11. sigmaContent.ts: replace the sentence that says Sigma has its own column in the Teams list and its own tile on a team page with one naming the new placement. Sigma now follows Total as "Total ± Sigma", to two decimals and in its own colour, in the Teams list, on a team page, and on an event's Insights, Breakdown and Alliances tabs. Replace "Under OPR and EPA the column is simply empty and no match band is drawn." with a sentence saying that under OPR and EPA, Total shows on its own and no match band is drawn. Add one sentence saying an alliance's Combined Total on the Alliances tab carries a ± built the same way as the band below. Obey every sigmaContent.test.ts rule (no hyphen-minus, en dash or em dash; no hedging opener; no "not only"). MetricValue.tsx: its last doc paragraph now says Sigma renders as the right half of TotalSigmaValue's pill, never through MetricValue's props. Grep apps/web/src for any other user-visible string or doc comment still describing a Sigma column or Sigma tile, and correct it.
12. Out of scope, stated so it is not mistaken for a gap: the match page's robot grid and every non-Total metric keep single boxes. The request named five surfaces.
  </action>
  <verify>
    <automated>cd apps/web && npx vitest run src/components/TotalSigmaValue.test.tsx src/components/teams-table src/components/team src/components/event src/components/methodology</automated>
    <automated>npx tsc --noEmit -p apps/web</automated>
    <automated>git grep -n "sigma-score-tile" -- apps/web/src ; test -z "$(git grep -n 'sigma-score-tile' -- apps/web/src)" && echo "OLD TILE GONE"</automated>
    <automated>npx vitest run && npx tsc --noEmit && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/worker</automated>
  </verify>
  <done>No Sigma column or tile remains. All five surfaces render the split pill under SPR with measured widths and "± Sigma" headers, and degrade to today's single box without Sigma. The Alliances Combined Total carries the neutral ± sqrt(3 x sum Sigma^2) band only when all three picks have Sigma. Sigma page copy describes the new placement. The FULL root vitest run (not apps/web alone) and all three typechecks pass, read from their printed output, and "OLD TILE GONE" prints.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Offline pipeline -> R2 artifact | publish.ts writes the published sigma entry that three pages trust |
| Worker read-modify-write -> R2 artifact | a live tick rewrites event and team-season artifacts from partial live state |
| R2 artifact -> browser | the web parses published JSON through the harness Zod schemas and renders a numeric claim |
| Orchestrator republish -> .env secrets | the republish needs the R2 token pair |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jkp-01 | Tampering (integrity of a displayed claim) | apps/worker/src/scheduled.ts mergeEventArtifact / mergeTeamSeasonArtifact | medium | mitigate | touchedEventTeamMetrics carries the prior sigma entry forward; unit test plus a runTick test pin it (Task 2) |
| T-jkp-02 | Tampering (integrity) | TotalSigmaValue, all five surfaces | medium | mitigate | an absent sigma renders exactly MetricValue's single box (innerHTML equality test); the combined band is all-or-nothing and never tiered (Task 1, Task 3) |
| T-jkp-03 | Information disclosure (a forbidden quantity reaching the screen) | TotalSigmaValue | low | mitigate | the component never reads total.spread; a test renders a total carrying spread 33 and asserts "33.00" is absent |
| T-jkp-04 | Tampering (drift between artifacts) | publish.ts buildEventTeamsStanding | medium | mitigate | the event entry reuses sigmaMetricForAlgo, the single object feeding the teams row and team-season artifact; the equality test against the team-season artifact asserts a non-zero compared count equal to the roster size |
| T-jkp-05 | Information disclosure (secrets into a transcript) | orchestrator republish | high | mitigate | publish:seasons already loads secrets via tsx --env-file=.env; never Read, cat or echo .env (CLAUDE.md secrets rule) |
| T-jkp-06 | Denial of service (event byte ceiling) | event artifacts | low | accept | about +4.3 KB on the largest SPR event artifact (223,178 bytes) against a 350,000-byte ceiling; the orchestrator confirms the real figure in docs/publish-budget.md after the republish |
</threat_model>

<verification>
Executor (no network): Task 3's last verify line is the whole-repo gate. Run `npx vitest run` from the REPO ROOT, never apps/web alone. Do not wrap it in `timeout <n> pnpm`. Read pass/fail counts from the output; do not trust the exit code. Run all three tsc invocations.

POST-EXECUTION — ORCHESTRATOR ONLY. The executor must not attempt any step below: executor subagents have no network, and a push deploys other sessions' commits.

O-1 Review. `git log --oneline` for this task's commits. `git status` must show nothing staged or modified on this plan's files_modified. Re-run the root vitest and the three typechecks and read the counts. Write `.planning/quick/260913-jkp-sigma-columns-removed-spr-total-shows-co/260913-jkp-SUMMARY.md` from the text the executor returned (subagents cannot write SUMMARY.md).

O-2 Local visual check before shipping, using the local verification recipe: VITE_ARTIFACT_ORIGIN pointed at the local origin so the /v1 proxy is active, on a fresh port. Take desktop and phone-390 screenshots of /teams (spr, 2026), /team/2481 (spr, 2026), and the Insights, Breakdown and Alliances tabs of /event/2026alhu (spr). Before the republish, the Teams list and team page must show pills (Sigma is already live on those artifacts). The event tabs must show "Total ± Sigma" headers over plain Total boxes: that is the honest pre-republish degrade. Compare the pill with sketch 011 variant A. Show Jacob the phone-390 Teams screenshot: the Total half is visible at scroll 0 and about 14px of the Sigma half runs past the edge. The follow-up, if he wants the whole pill visible, is a nickname-width change that is not part of this task.

O-3 Ship, only with Jacob's go-ahead, in this order:
  1. `git log origin/main..main`. Several sessions share this checkout, so confirm exactly which commits a push would carry.
  2. Deploy the Worker FIRST (`pnpm --filter worker deploy`, as 260913-g66 did). Worker first means no live tick running the old merge can strip a freshly republished sigma entry. No D1 reseed: the state shape is unchanged.
  3. Republish with `pnpm publish:seasons`, DETACHED: PowerShell Start-Process with a PID file and a log file, plus a Monitor until-loop. Not Bash run_in_background, which has killed long R2 runs silently. Never use `publish.ts --event`. There is no version bump, so the same keys are overwritten and no orphan generation is left.
  4. publish:seasons prints its budget summary but does NOT write docs/publish-budget.md. Transcribe it (prose plus the json budget block), run `npx vitest run packages/harness/payloadBudget.test.ts`, and commit by explicit path.
  5. `pnpm verify:subset`, then check the live artifacts by CONTENT. The manifest generation changed. In `v1/event/2026alhu/spr@3.0.0+baseline.json`, every team row has metrics.sigma equal to its `teams/2026` spr row's sigma value and to its team-season seasonStats.metrics.sigma (spot-check frc2481). The opr and epa artifacts for 2026alhu carry no sigma key. `v1/event/2016micmp/spr@3.0.0+baseline.json` is under 350,000 bytes.
  6. Re-check `git log origin/main..main`, push the web, and verify the deployed bundle by content: it contains "Total ± Sigma" and metric-pill, and not sigma-score-tile. Re-take the O-2 event-tab screenshots and confirm the pills now appear.
  7. Append the STATE.md Quick Tasks row with a small script, never the banned helper. Put no pipe character in the description. Before committing, verify: frontmatter parses, both frontmatter delimiters are present, no row number is duplicated, and every numbered row has exactly 5 cells. Commit by explicit path.
</verification>

<success_criteria>
- No per-team Sigma column or tile renders anywhere in apps/web.
- SPR Total renders as the split pill on the Teams list, team page Total tile, and event Insights, Breakdown and Alliances tabs; OPR and EPA are visually unchanged.
- SPR event artifacts publish sigma equal to the team-season artifact's entry on both publish paths; OPR and EPA event artifacts carry none.
- The live Worker preserves the sigma entry on touched teams in event and team-season artifacts.
- The Alliances Combined Total carries the neutral all-or-nothing ± sqrt(3 x sum Sigma^2).
- Width constants trace to this plan's measurement block; header copy reads "Total ± Sigma" and "Combined Total ± Sigma".
- The root vitest suite and the root, web and worker typechecks pass, read from output.
- After O-3: the republished live artifacts are verified by content and the budget doc is transcribed.
</success_criteria>

<output>
The executor returns the full SUMMARY body as its final message and does NOT write the file (Write blocks subagents from SUMMARY.md, and heredocs break on long markdown here). The SUMMARY must include: commits, verify-command output counts, the byte-cost arithmetic, the width measurement block, and any deviation. The orchestrator writes `.planning/quick/260913-jkp-sigma-columns-removed-spr-total-shows-co/260913-jkp-SUMMARY.md`.
</output>
