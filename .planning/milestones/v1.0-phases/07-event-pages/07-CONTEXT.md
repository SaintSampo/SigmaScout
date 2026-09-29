# Phase 7: Event Pages - Context

**Gathered:** 2026-08-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The event detail page — the destination Phase 5's Events list points at but cannot
reach, because `/event/{eventKey}` does not exist. Five tabs: Insights (the event's
teams in official rank order), Breakdown (every metric component per team), Quals and
Elims (match predictions beside actuals), and Alliances (each playoff alliance's
combined metrics).

**Requirements:** EVNT-02 … EVNT-06

**In scope:** the `/event/{eventKey}` route and its five tabs; the pipeline work those
tabs require (D-11 … D-18); a site-wide redefinition of what `±` means (D-01 … D-03);
renaming Sigma1 to VPR everywhere including the algorithm ID (D-04 … D-06); and the one
republish that carries all of it.

**Out of scope:** the Simulation tab and the 1000-run rank simulation (EVNT-07, Phase 8);
the Compare accuracy table (Phase 8). Phase 8's simulation reads the event artifact's
`upcoming[]` array — D-15 deliberately leaves that array's shape untouched.

**Starting state.** `apps/web` has the Phase 5 shell and the Phase 6 team page.
`routes/events.tsx` (the list) exists; there is no event detail route.
`EventArtifactSchema` already publishes `matches[]` (played, prediction vs actual, with
`compLevel`), `upcoming[]` (full predicted parameters including RP pmf), and `teams[]`
(teamKey, teamNumber, nickname, metrics). It carries **no** event name/date/location,
**no** per-alliance predicted-score variance, **no** team record, and **no** alliance
data of any kind — TBA's `/event/{key}/alliances` has never been ingested and
`packages/corpus/schema.sql` has no table for it.

**This phase is unusually pipeline-heavy** and was knowingly planned whole rather than
split (user decision, 2026-08-27). Nine pipeline items ride one republish. For scale:
Phase 6 was 9 plans, Phase 06.1 was 8. The planner should expect this to be larger than
both and should raise `## PHASE SPLIT RECOMMENDED` if it genuinely cannot plan it at full
fidelity — the user's "plan it whole" preference is a preference, not a gag order.

</domain>

<decisions>
## Implementation Decisions

### The site-wide ± rule (cross-cutting — supersedes prior guidance)

- **D-01: A user must NEVER see a D-09 consistency value. Every `±` on the site, in every table and every plot, is 1 SD of the full predictive variance `√(P + R)`.**

  This overrides `uncertainty-display.md`'s standing rule that the team-page `±` is D-09
  consistency and the match-prediction `±` is D-10 predictive variance. That two-quantity
  design is rejected outright.

  **The problem it fixes is already shipped, not hypothetical.**
  `apps/web/src/components/MetricValue.tsx:49` prints `± {metric.spread}` (D-09) and
  `apps/web/src/components/team/MatchTable.tsx:205` prints `± {sd}` where
  `sd = √redScoreVarianceOwn` (D-10) — the same glyph, the same
  `text-role-spread-suffix` class, the same secondary weight, both on the team page. A
  reader has no way to tell those apart.

  **Accepted consequence, stated explicitly at decision time:** under `P + R`, a team we
  have seen four matches of shows a wide `±` because *we are unsure*, not because it is
  streaky. For established teams mid-season P is small and the two quantities nearly
  coincide; for rookies and week-1 teams they diverge visibly. The user confirmed this
  knowing it changes what `±` answers relative to the "compare which robots are more
  consistent" framing that originally motivated the display.

  **Why it is coherent rather than a compromise:** `Σⱼ(Pⱼ + Rⱼ)` *is* exactly
  `redScoreVarianceOwn` (`packages/core/algorithms/sigma1/index.ts:688`). So an alliance's
  `±` becomes `√(sum of its members' published variances)` and that number is identical to
  the band drawn on its match row. The site becomes internally consistent by construction
  rather than by discipline.
  — **Reversibility:** one-way — this redefines the semantics of a published field
  (`TeamMetric.spread`) that Phases 5 and 6 already ship to browsers. Reverting means
  another full republish plus re-reverting every component that reads it, and any client
  holding a cached artifact would be reading the other definition under the same name.

- **D-02: `TeamMetric.spread` is redefined in place** — same field name, new definition,
  doc comment rewritten, carried by the republish already in scope. Rejected: a new field
  name (wider diff across schema, publisher and every consumer) and a
  `PAGE_ARTIFACT_SCHEMA_VERSION` bump. **Accepted risk:** a browser holding a
  pre-republish artifact renders the old quantity under the new label. The window is
  bounded by Phase 4 D-26's `max-age=60`.
  — **Reversibility:** one-way — see D-01.

- **D-03: D-09 keeps being computed; it is simply never displayed and never published.**
  R remains in the model — it is half of `P + R` and the Kalman update needs it. The
  binding documents that currently assert the opposite MUST be rewritten in this phase:
  `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md`,
  `packages/harness/pageArtifacts.ts:152`, and that file's header rule at line 30.
  Leaving them stale would recreate the failure log's own pattern — documentation
  describing a model that no longer exists.
  — **Reversibility:** costly — reintroducing a labelled consistency column later needs a
  republish, since R is not published under this decision.

### Renaming Sigma1 → VPR (cross-cutting)

- **D-04: Sigma1's display name is VPR — Variance Power Rating.** Chosen by the user over
  KPA/VPA/CPA, and deliberately without "Sigma" in it. Sits in the OPR / DPR / CCWM
  naming family FRC already uses, so the Compare page reads OPR / EPA / VPR.

- **D-05: The rename reaches everywhere, including the algorithm ID.** `sigma1` becomes
  `vpr` in the registry, in `PUBLISHED_ALGORITHM_IDS`, in `apps/worker/src/scheduled.ts`,
  in the two committed files under `data/algorithm-versions/`, in docs, and in every
  published artifact path (`v1/{page}/…/{algorithmId}@{version}.json`).

  **Verified cheaper than first warned** — this correction is on the record because the
  user chose the option under the more pessimistic framing:
  - The reproducibility digest hashes `[matchKey, pRedWin, redScore, blueScore]`
    (`packages/harness/promote.ts:96`). **`algorithmId` is not in it**, so Phase 3's
    bitwise CI gate is unaffected by a rename.
  - `apps/web/src/lib/searchParams.ts:49` is
    `z.enum(PUBLISHED_ALGORITHM_IDS).catch(DEFAULT_ALGORITHM)`. An old
    `?algorithm=sigma1` link does not 404 — it falls back to the default, which will be
    `vpr`. Old shared links land on the right algorithm.
  — **Reversibility:** one-way — Phase 4 D-02 marks the path-embedded algorithm ID as
  one-way. Reverting means republishing every artifact again under the old key.

- **D-06: The old `sigma1@…` R2 objects are deleted in the same pass**, ordered
  write-then-verify-then-delete. Rejected: leaving them as a rollback path (dead storage,
  two naming schemes in the bucket).
  — **Reversibility:** one-way — deleted objects are gone; recovery means a third
  republish.

### Insights tab (EVNT-02)

- **D-07: Insights orders teams by TBA's official event rank** and shows a limited stat
  set: rank, record, RPs, and the three phase groups (auto / teleop / endgame). It is
  **not** a Teams-page clone. Rank comes from `event_rankings`, ingested in 06.1.

- **D-08: On an event with no official ranking, Insights falls back to VPR order and says so.** Measured, not assumed: **259 of 1,581 corpus events have no ranking rows** — 185
  offseason (type 99), 46 preseason (type 100), ~23 scattered district/regional, and 5
  Championship Finals (type 4, one per year — Einstein is playoff-only, so a
  qualification ranking cannot exist). These are not marginal events: `2025isios` (FIRST
  Israel Off Season) has 68 matches, `2023cnsh` (FRC Off-season China) 62, `2024auwarp` 62.
  Rejected: falling back silently (a reader cannot tell official standings from the
  model's opinion) and showing an empty tab (kills Insights on 259 real events).

- **D-09: Tier boxes appear on every metric cell on this tab, including the sorted column.** Knowingly accepts the redundancy Phase 6 D-17 identified (adjacent rows in a
  sorted column share a tier by construction) in exchange for one simple rule and more
  colour — the direction `ui-polish-pass.md` asked for.

- **D-10: The metric values shown are as-of-event — the walk-forward state at that event's end — while percentiles still rank against the season-FINAL field.** The value
  says "this is what the model knew at this event"; the tier says "and that stood here
  against the final field." This is exactly the split 06.1 already locked for team-page
  history rows, so nothing is re-litigated. Rejected: percentiles also as-of-event, which
  would reopen 06.1's decision and make two events' tier colours incomparable across a
  season.
  — **Reversibility:** costly — the publisher currently computes metrics **once per
  algorithm per season** and reuses them for every event
  (`packages/harness/publish.ts:861`). As-of-event requires a per-event snapshot of the
  walk-forward state, which is a structural change to `publishSeasons`, not a field
  addition.

### Breakdown tab (EVNT-03)

- **D-11: Breakdown shows per-team model estimates, every raw component for that season, as a table of values with tier boxes, sorted by VPR rank, carrying no event rank at all.** Insights is the standings summary; Breakdown is the full detail.

  **Constraint that forces the "model estimates" framing:** TBA's `score_breakdown`
  (102,877 matches in the corpus) is per **alliance**, never per team. Actual per-team
  component scoring does not exist anywhere — estimating it is precisely what VPR does.
  A Breakdown tab is necessarily estimates, and must not imply otherwise.

  **Note for the planner:** `phaseAuto` / `phaseTeleop` / `phaseEndgame` are already
  published as first-class metrics with their own value, spread and percentile.
  `apps/web/src/lib/metricGroups.ts` records why: summing components in the client gets
  the value right (expectation is linear) but **cannot** produce an honest spread — a
  group's variance is a quadratic form over the per-team component covariance and the
  off-diagonal terms are not published — nor a percentile, since a sum's rank is not a
  function of its parts' ranks. Any new grouped or combined figure must be computed where
  the covariance lives, never in the browser.

### Quals and Elims tabs (EVNT-04, EVNT-06)

- **D-12: Each tab gets its own shared axis domain, computed over that tab's played AND scheduled matches.** Per-tab follows `uncertainty-display.md`'s "one shared scale per
  view, never per row" rule (quals and elims are separate views, and elim alliances
  outscore quals teams, so one axis would squash every quals row into the left half). The
  played-and-scheduled computation is carried forward from Phase 6 D-06 rather than
  re-asked — it is the same live-event axis-creep problem with a decided answer.
  **Accepted tradeoff:** comparing bar position between the Quals and Elims tabs is not
  valid.

- **D-13: Played and upcoming matches merge client-side into one chronological list.**
  The artifact keeps `matches[]` and `upcoming[]` separate exactly as published, so
  **Phase 8's simulation input is untouched**; the browser interleaves them. An unplayed
  row draws both bands and the tick with no actual dot — Phase 6 D-08's shipped
  treatment. Rejected: two sections on the tab, and merging in the schema (which would
  mean reworking Phase 8's input before Phase 8 starts).

- **D-14: The Elims tab is a flat chronological list with the round labelled per row; a true bracket is deferred.** Measured across the corpus, this is a real structural fork:

  | Season | Elim structure |
  |---|---|
  | 2022 | `ef` sets 1–20, `qf` 1–4, `sf` 1–3, `f` 1–2 — a classic bracket |
  | 2024 | `sf` sets 1–17, `f` 1, plus 5 `ef` and 16 `qf` stragglers |
  | 2026 | `sf` sets 1–21, `f` 1 |

  From 2023 on, `compLevel` stops identifying the round — nearly every playoff match is
  `sf`. Grouping by comp level would show one 13-plus-match lump labelled "Semifinal" for
  the modern seasons and a real bracket for 2022. A flat list works identically across all
  five seasons with no per-season branching.

### Alliances tab (EVNT-05)

- **D-15: An alliance's combined metric sums the first three picks' means; the combined variance sums their variances and the display shows `√` of it.** Explicitly:
  `σ_alliance = √(σ₁² + σ₂² + σ₃²)` — standard deviations are never added. Three robots
  at ±10 give ±17.3, not ±30.

  This is the same construction `sigma1/index.ts:688` already uses for a match, so the
  Alliances tab and the Elims tab can never disagree. Under D-01 they are the same
  quantity, so no reconciliation is needed anywhere.

  **Stated limitation, to be recorded in the phase's own output and not buried:** the
  arithmetic assumes the three teams' deviations are independent. That is what D-06 of
  Phase 2 already assumes — `packages/core/algorithms/sigma1/covariance.ts`'s header says
  the covariance is between a single team's own components, "never between teams." Real
  alliances are not independent (shared field conditions, a defender suppressing the
  opponent, a partner breaking down), and every such effect induces positive correlation,
  which would make the true σ **larger**. The published number is therefore a floor. The
  Alliances tab inherits this assumption from every match prediction rather than
  introducing it.

- **D-16: Only the first three picks enter the combined value.** A 4th/backup team, where
  TBA lists one, is displayed on the row but excluded from the arithmetic — so the column
  stays comparable across rows. Matches Statbotics' event alliance table.

- **D-17: When an event has no alliance data, the tab is plain-disabled** — visible,
  greyed, unclickable, with no explanation. Chosen over an explained empty state and over
  hiding the tab. **Known cost, chosen anyway:** this cannot distinguish "alliance
  selection has not happened yet" from "this event has no recorded alliances."

### Published-data additions (all ride one republish)

- **D-18: The pipeline work this phase requires, as one batch.** Each item is a Phase 4
  publisher and/or `packages/ingest` change; together they are paid for by a single full
  republish. Grouping them is the point — `docs/publish-budget.md` measures a full
  republish at roughly 23–25 minutes and 54,671 PUTs, about 5.5% of one month's free-tier
  Class-A allowance.

  1. **VPR rename** in every artifact path, plus deletion of the orphaned `sigma1@…`
     objects (D-05, D-06).
  2. **`TeamMetric.spread` redefined** to `√(P + R)` (D-01, D-02) — a change in
     `sigma1`'s `teamMetrics` assembly, not just the publisher.
  3. **Per-alliance own predicted-score variance on `EventMatchSchema`** — the folded
     todo `publish-match-predictive-variance.md`. `EventMatchSchema` today carries only
     scores, `pRedWin` and per-component mean/variance, so **any interval display of a
     match prediction on an event page is wrong until this ships**. The team artifact
     already got this in Phase 6 D-01; the event artifact did not.
  4. **Playoff bonus-RP array cleanup** — the folded todo
     `republish-playoff-bonus-arrays.md`. The pipeline gate was fixed by plan 06.1-08;
     this is the republish that finally updates the ~54,671 objects still carrying the
     stale keys.
  5. **As-of-event metric snapshots** (D-10) — breaks the publisher's once-per-season
     computation.
  6. **`event_rankings` extended** with TBA's `sort_orders` (for RPs) and its authoritative
     `record: {wins, losses, ties}`, then the rankings ingest re-run for 2022–2026. Both
     fields are fetched today and discarded — `packages/ingest/schemas.ts:120` models them
     but the doc comment states only `rank`/`team_key` are ever read. TBA's record is the
     right source because it handles DQs and surrogate appearances, which counting
     `matches[]` in the browser would not.
  7. **A new `/event/{key}/alliances` ingest**, a new corpus table, and a new artifact
     field (D-15, D-16). Nothing for playoff alliance selection exists today: the
     `tbaAllianceSchema` in `packages/ingest/schemas.ts:57` is the per-*match* red/blue
     roster, a different thing entirely.
  8. **Event identity on the event artifact** — name, dates, location, week. The event
     artifact carries none of it; only the events-*list* artifact does, so the page header
     has nothing to render from its own fetch.
  9. **One republish** carrying items 1–8.

  — **Reversibility:** costly for items 3, 6, 7 and 8 (published-schema fields — removing
  one means another full republish and breaks any client already reading it); one-way for
  items 1, 2 and 4 per D-01/D-05/D-06.

### Roadmap amendment

- **D-19: ROADMAP.md Success Criterion 1 for Phase 7 is amended to match D-07.** It
  currently reads *"The Insights tab ranks the event's teams using the same columns as the
  Teams page for the selected algorithm,"* which the design deliberately no longer does.
  Amending now beats failing verification against a criterion written before this
  discussion. **The planner must confirm this edit landed** — an unamended SC-1 will fail
  `/gsd-verify-phase`.

- **D-20: The Teams page Rank column is renamed per-algorithm** — "VPR Rank", "EPA Rank",
  "OPR Rank". Verified accurate rather than assumed:
  `apps/web/src/components/teams-table/rowModel.ts:98-110` always ranks by the selected
  algorithm's Total **regardless of which column the user sorts by**, so the column
  already *is* an algorithm rank and the current label simply fails to say so.

- **D-21: Phase 7 knowingly reaches outside its roadmap fence.** D-01/D-02/D-03 change
  the shipped team page and the sketch-findings design contract; D-20 changes the shipped
  Teams page; D-04/D-05 change every page's algorithm label. Recorded here as a deliberate
  cross-cutting change (user decision: "fix it in Phase 7, record as cross-cutting")
  rather than allowed to look like scope drift at review time.

### Claude's Discretion

- Where the event page header sources its identity from — the new artifact fields of
  D-18 item 8, versus reading the already-published events-list artifact.
- How the predicted winner and confidence render on a match row. Established pattern to
  carry forward: the team page's match table already wraps the predicted winner in an
  `.alliance-chip` (06-09-PLAN.md Task 3).
- Which tab is the default, and the tab strip's behaviour on a phone with five tabs
  (six once Phase 8 adds Simulation).
- The visual treatment of the disabled Alliances tab (D-17).
- The fallback treatment for teams or events with missing data on any tab.
- Where D-08's "official rankings unavailable" notice sits and how it is worded.
- Depth-within-the-current-system polish on the new surfaces — row tints, elevation,
  spacing rhythm, chips — per `ui-polish-pass.md` question 1. **The base-palette question
  (that todo's question 2) stays deferred**; no `--color-*`, `--accent`, `--alliance-*` or
  `--tier-*` value changes in this phase.

### Folded Todos

- **`publish-match-predictive-variance.md`** (repointed to Phase 7, priority high) — the
  harness computes D-10's full predictive variance and never publishes it on the event
  artifact. Implemented by D-18 item 3. Its acceptance criteria carry over unchanged:
  assert the published value against what `linkFunctions.ts` consumed rather than
  recomputing it independently; spot-check ±1σ coverage across a season; re-measure
  `docs/publish-budget.md`.
- **`republish-playoff-bonus-arrays.md`** (`resolves_phase: 07`, priority low) — folded
  and **combined** with the above so R2 is rewritten once, not twice. This supersedes that
  todo's own "no dedicated run needed" resolution. Its acceptance criterion is binding: a
  fresh `team/{teamKey}/{year}` artifact's playoff rows must carry neither
  `actualRedBonusRp`/`actualBlueBonusRp` nor `redBonusRp`/`blueBonusRp` as properties
  (`not.toHaveProperty`, not merely `undefined`).
- **`ui-polish-pass.md`** (priority high) — folded at question-1 depth only; see Claude's
  Discretion above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contracts (binding — but see D-01/D-03)

- `.claude/skills/sketch-findings-sigmascout/SKILL.md` — index; load before any UI work
- `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` — the
  match-table anatomy (sketch 003 variant C), the CSS/geometry patterns, the alliance
  colour tokens, and the "grey the loser's number, never its mark" rule. **Its D-09/D-10
  two-quantity rule is SUPERSEDED by D-01 and this file must be rewritten in this phase
  (D-03).** Everything else in it still binds.
- `.claude/skills/sketch-findings-sigmascout/references/chart-craft.md` — derive coupled
  geometry, grouping is proximity, render-and-look
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — tier cuts
  and hex values; **the tier blue must stay sky `#0EA5E9`** (ΔE 1.3 deutan against rarity
  purple)
- `.claude/skills/sketch-findings-sigmascout/sources/003-alliance-axes/` — the winning
  variant running against real data; designed for *this* page
- `.planning/phases/05-site-shell-navigation-browsing/05-UI-SPEC.md` — the Phase 5 design
  contract this phase inherits

### Prior-phase decisions this phase is bound by

- `.planning/phases/06-team-pages/06-CONTEXT.md` — D-06 (per-view axis domain over played
  AND scheduled, inherited by D-12), D-07 (red on top), D-08 (scheduled-match row
  treatment, inherited by D-13), D-09 (single match list with optional actuals), D-10
  (mobile horizontal-scroll gesture risk), D-16 (`?tab=` search param), D-17 (tier
  placement, knowingly overridden by D-09 here)
- `.planning/phases/05-site-shell-navigation-browsing/05-CONTEXT.md` — D-04 (mobile
  horizontal scroll), D-05/D-06 (visual direction, token discipline), D-07 (uncertainty
  always visible at secondary weight), D-11/D-12/D-13 (year and algorithm switching),
  D-14 (URL carries shareable state), D-17a (hostname split), D-18 (R2 CORS), D-19 and its
  NOT-ACHIEVED outcome (**route-level code splitting is forbidden as a first-paint fix** —
  it was tried, measured slower on every network profile, and reverted)
- `.planning/phases/04-publish-live-update-pipeline/04-CONTEXT.md` — D-01 (one file per
  page), **D-02 (algorithm version rides in the path — one-way; this is what D-05 is
  breaking deliberately)**, D-05 (payload budget), D-25 (browser reads artifacts from the
  R2 domain, no compute in the path), D-26 (`max-age=60` + ETag — the bound on D-02's
  accepted cache risk)
- `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md` — D-06 (no cross-team
  latent — the assumption D-15's independence caveat rests on), D-09 and D-10 (the two ±
  definitions D-01 collapses), D-12 (link function modes), D-21 (raw numbers only)
- `.planning/phases/06.1-match-and-event-data-enrichment/06.1-LEARNINGS.md` — the
  season-final percentile decision D-10 preserves, and PD-02 (a null TBA body and an empty
  rankings array both store zero rows — why D-08 and D-17 cannot distinguish their two
  absent cases)

### Folded todos (acceptance criteria are binding)

- `.planning/todos/pending/publish-match-predictive-variance.md`
- `.planning/todos/pending/republish-playoff-bonus-arrays.md`
- `.planning/todos/pending/ui-polish-pass.md`

### Measurement baselines

- `docs/publish-budget.md` — the republish cost model and the machine-readable budget
  block read by `packages/harness/payloadBudget.test.ts`. **Every schema change in D-18
  must re-measure this.**
- `docs/first-paint-measurement.md` — the methodology any load-time claim must reuse
- `.planning/WINDOWS.md` — ledger #11 (`teams/{year}` payload ceiling, accepted override)

### Code contracts

- `packages/harness/pageArtifacts.ts` — `EventArtifactSchema`, `EventMatchSchema`,
  `EventUpcomingMatchSchema`, `EventTeamSchema`, `TeamMetricSchema`, `artifactKey`.
  **Line 152 and the file header at line 30 assert the D-09/D-10 separation D-01 removes
  — both must be rewritten (D-03).**
- `packages/harness/publish.ts` — `buildEventArtifact` (line 262),
  `buildEventTeamsStanding` (line 861, the once-per-season computation D-10 breaks), and
  the rounding boundary
- `packages/core/algorithms/sigma1/index.ts` — **line 688 is where D-01's `P + R` already
  exists** as `redScoreVarianceOwn`; line 1002 is where `spread` is currently assembled as
  `√R` and must change
- `packages/core/algorithms/sigma1/covariance.ts` — the per-team covariance model and its
  no-cross-team-covariance rule, which D-15's independence caveat rests on
- `packages/harness/promote.ts` — `computePredictionStreamDigest` (line 96); **confirms
  `algorithmId` is not in the digest**, so D-05 does not disturb Phase 3's CI gate
- `packages/ingest/schemas.ts` — `tbaEventRankingSchema` (line 120, carries the
  `sort_orders` and `record` D-18 item 6 wants) and `tbaAllianceSchema` (line 57, the
  per-match roster that is **not** what D-18 item 7 needs)
- `packages/corpus/schema.sql` — `event_rankings` (line 101) and the absence of any
  alliance table

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `apps/web/src/components/team/MatchTable.tsx` — the shipped sketch-003 variant C match
  table: shared axis, soft bands, ticks, donut dots, alliance chips. The Quals and Elims
  tabs are this component generalised from a team-season domain to a per-tab event domain.
  `matchAxis.ts` beside it holds the domain math.
- `apps/web/src/components/MetricValue.tsx` — the `X ± Y` primitive. D-01 changes what the
  `± Y` means, not this component's shape.
- `apps/web/src/components/teams-table/` — `columns.tsx` (column construction per
  algorithm-season), `rowModel.ts` (ranking and sorting). The Insights and Breakdown
  tables are close relatives; `rowModel.ts:98-110` is what D-20 renames.
- `apps/web/src/lib/api/events.ts`, `team.ts` — the fetch + Zod-validate + TanStack Query
  pattern the event-artifact fetcher should mirror exactly.
- `apps/web/src/lib/metricKeys.ts` / `metricGroups.ts` / `tiers.ts` — column sets per
  algorithm-season, the published phase groups, and the tier cuts (which delegate to
  `publishedTierForPercentile` rather than restating thresholds).
- `apps/web/src/components/Skeletons.tsx`, `StateViews.tsx` — first-load skeleton and
  error/empty states; D-08's fallback notice is a new member of this family.
- `apps/web/src/lib/searchParams.ts` + `resolveSortKey.ts` — typed search params and the
  algorithm-switch sort fallback; the `?tab=` param joins them.

### Established Patterns

- **Deep relative imports with explicit `.js`** into `packages/core/...` — there is no
  `@sigmascout/*` workspace alias anywhere.
- **Browser-safe schema leaves** — `metricHistorySchema.ts` exists because importing from
  a module with top-level `node:fs` drags Node built-ins into the browser bundle;
  `browserSafeSchemas.test.ts` enforces it.
- **Assembly functions parse through their Zod schema before returning**, so an invalid
  artifact can never be uploaded.
- **Rounding happens only at the publish boundary** (`rounding.ts`) — every new numeric
  field in D-18 needs a `ROUNDING_RULE` entry.
- **Additive `CREATE TABLE IF NOT EXISTS`** is the corpus's migration story
  (`team_media`, `event_rankings` both set the precedent); D-18 item 7's alliance table
  follows it.
- **Secrets discipline** (`.claude/CLAUDE.md`) — the TBA key needed by D-18 items 6 and 7
  is reached via `tsx --env-file=.env`, never read or echoed.

### Integration Points

- `apps/web/src/routes/` — a new `event.$eventKey` module joins `teams`, `events`,
  `team.$teamNumber`, `compare`.
- `apps/web/src/components/events-list/EventsList.tsx` — event rows become links to the
  new route.
- `apps/web/src/components/search/SearchBox.tsx` — its `SearchNavigate` union widened for
  team routes in Phase 6 and widens again here for event routes.
- `packages/ingest/cli.ts` — gains the alliances fetch (D-18 item 7) and the extended
  rankings write (item 6), alongside the existing `ingestSeasonRankingsOnly`.
- `packages/harness/publish.ts` `buildEventArtifact` — the single funnel for D-18 items 3,
  5, 7 and 8.
- `apps/worker/src/scheduled.ts` — references `sigma1` and must move to `vpr` (D-05).

</code_context>

<specifics>
## Specific Ideas

- **The user's framing that produced D-01, verbatim:** *"I've decided I don't want the
  user to EVER see a D-09 consistency value. ± should always represent 1 SD. Every plot
  should use this value too, never D-09."* This arrived after seeing that the two ±
  already collide on the shipped team page, and it is the single most consequential
  decision in this phase.

- **The user's reaction that surfaced it:** shown a design where the same alliance would
  carry a narrower ± on the Alliances tab than on the Elims tab, the response was *"I
  think this is terrible. I really want to explore this question."* The two-quantity
  design was not rejected on aesthetics — it was rejected because a reader cannot
  reconcile two numbers that look identical and mean different things.

- **The user's Insights sketch, verbatim:** *"Insights is the summary. It has teams in
  their actual rank order and shows a limited amount of statistics — auto, teleop,
  endgame, record, rank, RPs, that kind of stuff. Breakdown has nothing about real event
  rank, it is sorted based on VPR rank and has the breakdown of every metric."* This is
  D-07 and D-11, and it is what D-19 amends the roadmap to match.

- **VPR is the user's own coinage**, offered after asking for a plain-language account of
  how Sigma1 works and rejecting every option containing "Sigma".

- **Statbotics and TBA remain the yardstick.** The OPR/DPR naming family (D-04), the
  three-pick alliance combination (D-16), and official rank order on an event page (D-07)
  were all chosen because those two sites already do it.

</specifics>

<deferred>
## Deferred Ideas

- **A true double-elimination bracket view for the Elims tab** — deferred by D-14. The
  known hard part is recorded: from 2023 on, `compLevel` is `sf` for nearly every playoff
  match, so the bracket structure has to come from `setNumber` ordering, and 2022 needs a
  different path entirely.
- **Distinguishing "no qualification rounds exist" (Einstein) from "no ranking data was
  published" (offseason)** in D-08's fallback notice — needs the event type consulted, or
  06.1's ingest counters revisited. 06.1 deliberately made the corpus unable to tell them
  apart.
- **The base-palette question** (`ui-polish-pass.md` question 2 — whether 60/30/10
  near-monochrome suits this audience at all) — still deferred, now across six phases'
  worth of components. Token discipline is what keeps it cheap.
- **Bringing back a labelled consistency column** — possible but needs a republish, since
  D-03 stops publishing R.
- **Cross-tab comparison of match-plot bar positions** — foreclosed by D-12's per-tab
  domains, noted so a later reader does not assume it works.
- **Per-component metric trajectories on the team page chart** — carried forward from
  Phase 6, still not this phase.
- **Surfacing per-algorithm freshness** — carried forward from Phases 5 and 6, still not
  this phase.

### Reviewed Todos (not folded)

- **`static-shell-first-paint.md`** — not folded because it is already **resolved**
  (`status: resolved`, 2026-08-25, by 06-09-PLAN.md Task 2). It is stale in
  `.planning/todos/pending/` and should be moved to `completed/`.

</deferred>

<open_questions>
## Open Questions for Research

1. **Is TBA's `sort_orders` actually populated across 2022–2026, and which index carries
   ranking points?** D-18 item 6 depends on it. `packages/ingest/schemas.ts:113` says
   `sort_orders` "genuinely vary by season" and models it `.nullable()`; the response's own
   `sort_order_info[i].name` should identify the RP entry. This must be confirmed against
   real responses per season before RPs are promised on the Insights tab — if it is null
   for some seasons, D-07's RP column needs a stated per-season absence rule.
2. **What does `/event/{key}/alliances` actually return, and for how many of the 1,581
   corpus events?** D-15/D-16/D-17 all rest on it, and nothing in the repo has ever called
   it. Needs the real shape (`picks[]` ordering, `declines[]`, `status`, `backup`), the
   coverage across 2022–2026, and the behaviour for offseason events — mirroring exactly
   the live-sampling discipline 06.1 applied to `/event/{key}/rankings`.
3. **What does as-of-event metric snapshotting cost?** D-10 breaks
   `publish.ts`'s once-per-algorithm-per-season computation. Establish the wall-clock and
   memory cost of snapshotting walk-forward state per event before the publisher is
   restructured, and how it interacts with the existing republish budget.
4. **Republish sequencing.** D-18 puts nine changes through one pass that also renames
   every key and deletes the old ones. Establish the safe order (write-verify-delete),
   what a partial failure leaves behind, and whether the ~23–25 minute measured cost still
   holds when the object count roughly doubles mid-run.
5. **Mobile with five tabs.** Phase 5 D-04 and Phase 6 D-10 both flagged nested
   horizontal-scroll-inside-vertical-list as "a known implementation risk for research to
   solve, not discover." This phase repeats that pattern on four wide tables instead of
   one, and adds a five-tab strip on a ~390px screen.

</open_questions>

---

*Phase: 7-event-pages*
*Context gathered: 2026-08-27*
