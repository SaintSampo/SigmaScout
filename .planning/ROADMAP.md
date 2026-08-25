# Roadmap: SigmaScout

## Overview

SigmaScout gets built measurement-first. Before any model exists, a normalized 2022–2026 TBA corpus and a walk-forward evaluation harness make "measurably better than Statbotics" a number rather than a claim — with predict-before-update enforced structurally so the prior failure can't repeat. On that foundation, EPA and Sigma1 are built and scored head-to-head against an OPR baseline, then tuned, versioned, and extended to ranking-point prediction. Only once the numbers are real does compute get published: a precompute pipeline writes compact versioned artifacts and a cron updater keeps them fresh within ~1–3 minutes inside Cloudflare free tiers. The site then reads those artifacts — first a fast shell with Teams and Events browsing, then Team and Event detail pages where predictions sit beside actuals, and finally the two headline differentiators, rank simulation and the Compare accuracy table that publishes exactly what the harness produced.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Data Foundation & Evaluation Harness** - Normalized TBA corpus plus walk-forward backtesting with an OPR baseline (completed 2026-08-19)
- [x] **Phase 2: Prediction Models — EPA & Sigma1** - Reimplemented EPA and the Sigma1 Kalman filter, scored head-to-head (completed 2026-08-14)
- [x] **Phase 3: Tuning, Ranking Points & Versioning** - Offline optimizer, online adaptation, per-season RP prediction, versioned algorithms (completed 2026-08-18)
- [x] **Phase 3.1: Address Phase 1-3 review warnings and doc drift** (INSERTED) - Resolve outstanding review warnings from Phases 1-3 and reconcile documentation drift (completed 2026-08-20)
- [x] **Phase 3.2: Swap OPR to event-scoped and re-issue affected figures** (INSERTED) - OPR becomes event-scoped everywhere, matching TBA and Statbotics; affected figures re-run and the retired baseline preserved in the record (completed 2026-08-21)
- [x] **Phase 4: Publish & Live Update Pipeline** - Precomputed artifacts published and refreshed within ~1–3 minutes on free tiers (completed 2026-08-23)
- [x] **Phase 5: Site Shell — Navigation & Browsing** - Ribbon, global year/algorithm selectors, search, Teams and Events listings (completed 2026-08-24)
- [ ] **Phase 6: Team Pages** - Per-team season view with per-event match predictions vs actuals and a metric-history plot
- [ ] **Phase 7: Event Pages** - Insights, Breakdown, Quals, Alliances, and Elims tabs
- [ ] **Phase 8: Simulation & Compare** - 1000-run rank simulation and the published per-algorithm accuracy table

## Phase Details

### Phase 1: Data Foundation & Evaluation Harness

**Goal**: Any prediction method can be scored honestly against 2022–2026 history, on data whose quirks are handled explicitly rather than silently
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, EVAL-01, EVAL-02, EVAL-03, EVAL-04, ALGO-01
**Success Criteria** (what must be TRUE):

  1. One command ingests TBA teams, events, and matches for 2022–2026 into a local normalized corpus; re-running against unchanged upstream data returns 304s instead of re-downloading.
  2. Surrogate matches, replays, missing score breakdowns, and offseason events each appear as explicit flags in the normalized data — none is silently ingested and none is silently dropped.
  3. Running the harness on any 2022–2026 season reports OPR's Brier score and winner accuracy, with every prediction produced strictly before that match's result is folded into the model.
  4. A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data.
  5. The harness emits a calibration curve (predicted probability vs observed frequency) per algorithm per season, and reports headline accuracy only from seasons declared as holdout.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Toolchain foundation, package-legitimacy gate, and TBA/Statbotics field reconnaissance

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Tracer: one event end-to-end from TBA through corpus, walk-forward OPR, and both artifacts

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Full 2022–2026 corpus ingestion with explicit surrogate, replay, breakdown and offseason flags
- [x] 01-04-PLAN.md — Season-pooled ridge OPR baseline plus surrogate and disqualification rating policy
- [x] 01-05-PLAN.md — Scoring, calibration curves, tune/holdout split, versioned JSON artifact and HTML report

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-06-PLAN.md — Season-spanning walk-forward run across 2022–2026 and the published report

### Phase 2: Prediction Models — EPA & Sigma1

**Goal**: Three algorithms produce match-level predictions on the same corpus, with Sigma1 carrying honest uncertainty
**Depends on**: Phase 1
**Requirements**: ALGO-02, ALGO-03, ALGO-07
**Success Criteria** (what must be TRUE):

  1. A single harness run scores OPR, EPA, and Sigma1 head-to-head across the same seasons, producing one comparable table.
  2. EPA runs walk-forward at any point in a season, and spot-checked teams land within a documented tolerance of published Statbotics numbers.
  3. Sigma1 reports every team metric as a mean and variance renderable as `X ± Y` (1 standard deviation), backed by a documented identifiability check for the state dimensions it estimates.
  4. Every match in the corpus has a predicted winner, a win probability, and predicted alliance scores for each algorithm; Sigma1's predictions additionally carry variance.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Tracer: score_breakdown reaches an algorithm and two algorithms score one season head-to-head into a v2 artifact

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Per-season component maps for 2022, 2023, 2025, 2026 plus the missing-breakdown fallback

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — EPA cross-season carryover, parameterized cold start, and the head-to-head report table
- [x] 02-04-PLAN.md — Sigma1: Kalman core, covariance, consistency shrinkage, and three win-probability link modes

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-05-PLAN.md — Per-match prediction JSONL and team metric-history sidecars, Sigma1 registered in the harness

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-06-PLAN.md — Identifiability check, full 2022–2026 five-algorithm run, and the divergence record

### Phase 3: Tuning, Ranking Points & Versioning

**Goal**: Sigma1 is tuned reproducibly, proven against baselines on holdout seasons, versioned, and predicting ranking points under each season's rules
**Depends on**: Phase 2
**Requirements**: ALGO-04, ALGO-05, ALGO-06, ALGO-08
**Success Criteria** (what must be TRUE):

  1. An offline optimizer searches Sigma1's hyperparameters against backtest score on tune seasons and writes the winning configuration as a named, reproducible algorithm version.
  2. The harness reports adaptation-on vs adaptation-off holdout scores side by side, showing whether within-season adaptation actually improves predictions.
  3. Sigma1's holdout Brier score and winner accuracy beat both OPR and EPA — or the shortfall is recorded with an explicit decision about what to change.
  4. Every match has predicted ranking points with variance for both alliances, using the correct RP rules for its season, verified against the official 2022–2026 game manuals.
  5. Re-running any past algorithm version reproduces that version's metrics and predictions unchanged.

**Plans**: 8/8 plans executed

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Tracer: parameterized Sigma1 tuned, promoted, and reproduced end to end; carryover split (D-04)
- [x] 03-02-PLAN.md — Per-season RP rule modules with event-tier thresholds and corpus-wide reconciliation (D-12)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — RP threshold-variable state, correlated joint pmf, schema evolution (D-09/D-10/D-11)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04-PLAN.md — Innovation-driven online adaptation and the on/off registry pair (D-05/D-07/D-08)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-05-PLAN.md — Sensitivity screen, joint search over survivors, two equal-budget runs, promotion (D-03/D-06/D-14)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-06-PLAN.md — CI reproducibility gate, holdout head-to-head, SC-3 verdict and adaptation finding (D-02/D-15)

**Wave 6** *(gap closure — SC-4 / ALGO-08, from 03-VERIFICATION.md)*

- [x] 03-07-PLAN.md — CR-01: guard Sigma1's RP path against unmapped event types, proven a bitwise no-op (ALGO-08)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-08-PLAN.md — Threshold provenance decision and the quantified conservative-branch limitation (ALGO-08)

### Phase 03.1: Address Phase 1-3 review warnings and doc drift (INSERTED)

**Goal**: Every open code-review warning from Phases 1-3 is fixed under a recorded policy, and every Phase 1-3 planning artifact's stated status matches the tree it describes
**Requirements**: TBD (remediation phase — hardens DATA-02, EVAL-02, EVAL-03, ALGO-01, ALGO-04 and ALGO-06 without widening their scope)
**Depends on**: Phase 3
**Scope source**: `.planning/v1.0-MILESTONE-AUDIT.md` `tech_debt:` block (audited 2026-08-19, status `tech_debt`) — the "review warnings" and "doc drift" categories only. Info-level findings, Phase 2's missing SECURITY.md/VALIDATION.md, the adaptation-on decision, and the dead Statbotics validation channel are deliberately OUT of scope.
**Success Criteria** (what must be TRUE):

  1. All nine open review warnings — six in `01-REVIEW.md` (WR-01 through WR-06) and three in `03-REVIEW.md` (WR-01 through WR-03) — are resolved in the tree, each carrying a regression test that fails against the pre-fix source, and each review file records the resolution with its commit.
  2. No match TBA reports as played leaves the scored population silently: foreign-key enforcement is on at corpus open, and a played non-tied match with an empty `winning_alliance` is resolved or counted under a recorded policy rather than dropped by a `WHERE` clause.
  3. A malformed prediction cannot reach a published number: a non-finite or out-of-`[0, 1]` `pRedWin` fails loudly at the scoring boundary instead of yielding a `NaN` Brier score or a silently-defaulted winner.
  4. Neither long-running numerical guarantee rests on coincidence: a season-scale run of the incremental OPR solve is proven to stay finite and within a documented tolerance of a fresh batch solve, and `isValidParamSet` is enforced at every Sigma1 candidate-generation and promotion boundary.
  5. Every Phase 1-3 planning artifact's recorded status matches HEAD — no artifact claims an open finding that is closed, or a closed finding that is open — covering the three REVIEW.md frontmatter blocks, `01-VERIFICATION.md`'s human-verification item, and STATE.md's Blockers/Concerns section.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 03.1-01-PLAN.md — Corpus silent-drops: winner imputation, foreign-key enforcement, atomic lock, workspace glob (01-REVIEW WR-02/03/04/06)
- [x] 03.1-02-PLAN.md — Prediction validity at emission plus bounded quarantine at scoring (01-REVIEW WR-05)
- [x] 03.1-04-PLAN.md — Unconstructible invalid Sigma1 params, aborting screen stage, promoted-version staleness warning (03-REVIEW WR-01/02/03)

**Wave 2** *(blocked on Wave 1 — shares `opr.ts` with 03.1-02)*

- [x] 03.1-03-PLAN.md — OPR incremental-solve runtime guard and season-scale drift property test (01-REVIEW WR-01)

**Wave 3** *(blocked on Waves 1-2 — resolution blocks must name real fix commits)*

- [x] 03.1-05-PLAN.md — Review-frontmatter linter and reconciliation of the four stale planning artifacts

### Phase 03.2: Swap OPR to event-scoped and re-issue affected figures (INSERTED)

**Goal**: OPR means event-scoped OPR everywhere in this project — harness, published figures, and the record — matching what TBA and Statbotics publish, with the season-pooled baseline it replaces preserved as recorded history rather than deleted
**Requirements**: TBD (baseline correction — re-establishes ALGO-01 and the EVAL-01/EVAL-03 comparison surface against a new baseline without widening their scope)
**Depends on**: Phase 3.1
**Scope source**: `.planning/phases/04-publish-live-update-pipeline/04-CONTEXT.md` D-09, D-10, D-11 — the decision, its sequencing, and the honesty requirement on the record. Phase 4 consumes this phase's output and is blocked until it lands.
**Success Criteria** (what must be TRUE):

  1. `packages/core/algorithms/opr.ts` computes OPR at event scope, and no season-pooled ridge OPR path remains reachable from the harness registry or the published set.
  2. The full 2022–2026 walk-forward harness has been re-run against the new baseline; every OPR figure in `docs/models/` and `PROJECT.md` reflects that run rather than the retired one, and every Phase 1–3 SUMMARY carrying a retired OPR figure has a dated superseded-by note pointing at the new record, with its original measured numbers left intact as the execution record.
  3. `docs/models/` records both baselines side by side — the retired season-pooled numbers, the new event-scoped numbers, and the reason for the switch — so a reader can see that the baseline moved and judge the SC-3 claim against either.
  4. Phase 3's SC-3 verdict is re-stated against the new baseline as an explicit measured result, with any change in whether Sigma1 beats OPR on holdout Brier and holdout winner accuracy named outright — never presented as an improvement Sigma1 did not make.
  5. Event-scoped OPR's behavior early in an event, where the design matrix is rank-deficient, is measured and documented rather than assumed benign.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 03.2-01-PLAN.md — Capture the retired season-pooled OPR baseline as two committed, reproducible fingerprints before its code is deleted (D-13)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03.2-02-PLAN.md — Rewrite `opr.ts` as event-scoped, quals-only, no-ridge, proven end-to-end through the real replay path (SC-1)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03.2-03-PLAN.md — Full 2022–2026 five-algorithm re-run against the new baseline, with its figures committed (SC-2 data)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03.2-04-PLAN.md — Measure early-event rank deficiency: accuracy-by-checkpoint curve plus rank-vs-team-count diagnostic (SC-5)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03.2-05-PLAN.md — Create `docs/models/opr-baseline-change.md`, restate SC-3 honestly, re-issue every live OPR figure (SC-2/SC-3/SC-4)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03.2-06-PLAN.md — Annotate the Phase 1–3 execution record, correct 04-CONTEXT D-11's errata, close the phase gate (SC-2, D-17)

### Phase 4: Publish & Live Update Pipeline

**Goal**: Every page's data exists as a precomputed versioned artifact in production storage and stays fresh during live events inside free-tier limits
**Depends on**: Phase 3.2 (its published set includes event-scoped OPR — see `04-CONTEXT.md` D-03/D-09)
**Requirements**: DATA-03, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):

  1. A full-season precompute runs offline and publishes compact versioned artifacts covering every page the site will render, with per-page payload sizes measured and recorded as a budget; nothing is recomputed per request.
  2. During an active event (replayed from history or a live offseason event), a new TBA match result is reflected in published artifacts within ~1–3 minutes via the incremental update path.
  3. Measured Worker CPU per cron invocation stays under the 10 ms free-tier limit, and daily write volume stays inside KV/R2 free-tier quotas.
  4. Ingestion and cron polling stay within TBA rate limits, with measured request counts documented.

**Plans**: 8/8 plans executed

Plans:

- [x] 04-08-PLAN.md

**Wave 1**

- [x] 04-01-PLAN.md — Provision Cloudflare, prove one real page artifact end to end (offline → R2 → HTTPS), and put the credentials under the TBA key's secrets discipline

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — The five page-artifact schemas, the D-06 rounding rule, and the not-yet-played match reader D-08 needs
- [x] 04-03-PLAN.md — The live-windows and algorithms manifests, the lossless live-state snapshot, and the D1 schema

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-04-PLAN.md — Full-season publish of every page for 2022–2026, the committed payload budget, and the test that guards it
- [x] 04-05-PLAN.md — Worker scaffold with real D1 tables, the batched state store, and the subrequest budget that defers instead of throwing

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-06-PLAN.md — The cron tick: liveness, polite TBA polling, scoped artifact refresh, and per-event failure confinement

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-07-PLAN.md — Deploy by hand, the dual-purpose replay rig (freshness + offline/online equivalence), and the measured Worker budget

**Cross-cutting constraints:**

- Measured peak-tick subrequest count on the deployed Worker stays under the free plan's 50-per-invocation limit.

### Phase 5: Site Shell — Navigation & Browsing

**Goal**: Users can browse ranked teams and filterable events for any year and algorithm, fast, on phone or desktop
**Depends on**: Phase 4
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, TEAM-01, EVNT-01
**Success Criteria** (what must be TRUE):

  1. A persistent top ribbon navigates to Teams, Events, and Compare, and every page is usable at phone width and desktop width.
  2. Prominent global dropdowns select the prediction algorithm and the year, and changing either re-slices the current page immediately.
  3. A search bar finds teams and events by number or name and navigates to them; the resulting URL encodes year, algorithm, and current view, and pasting it into a fresh browser restores the same screen.
  4. The Teams page lists all teams for the selected year ranked by the selected algorithm's metric with team number, name, rank, metric(s), record, and win rate — rendered straight from precomputed artifacts with no season statistics computed in the browser.
  5. The Events page lists all events for the selected year and can be sorted and filtered by week, country, state, and district.

**Plans**: 8/8 plans executed

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Tracer: provision Pages and R2 CORS, scaffold `apps/web`, render real published team rows end to end on the live origin

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Amend the Phase 4 events artifact with name, week, country, state and district, then re-ingest and republish
- [x] 05-03-PLAN.md — Design system: shadcn primitives, the D-06 token layer, shared state views, and the `MetricValue` display primitive
- [x] 05-04-PLAN.md — Retire the two empirical risks: the two-axis touch spike and the NAV-06 first-paint measurement

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-05-PLAN.md — Site shell: ribbon, year and algorithm dropdowns, typed URL search params, and the shared sort-key resolver

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-06-PLAN.md — Teams page: virtualized pinned table with algorithm-derived columns, rank, record and win rate (TEAM-01)
- [x] 05-07-PLAN.md — Events page: list plus week, country, state and district filters, inline on desktop and in a sheet on phone (EVNT-01)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 05-08-PLAN.md — Search across teams and events, deep-link end-to-end proof, deferred measurements, spike removal, human sign-off

**UI hint**: yes

### Phase 6: Team Pages

**Goal**: Users can see a team's season at a glance and every one of its matches with predictions sitting beside actuals
**Depends on**: Phase 5
**Requirements**: TEAM-02, TEAM-03, TEAM-04, TEAM-05, TEAM-06
**Success Criteria** (what must be TRUE):

  1. A team page shows the team's name, its robot image for the selected year, a working link to its TBA page, and its season record, win rate, and metrics.
  2. The team page has one section per attended or upcoming event; a finished event shows that team's metrics as captured at the moment the event ended, not today's values.
  3. Each event section lists that team's matches with both alliances' teams, predicted winner, confidence, predicted scores, and predicted RP ± variance, alongside actual scores and actual RP.
  4. A second tab plots the team's metrics across the season with matches on the x-axis, including a variance band for Sigma metrics.

**Plans**: 3/9 plans executed

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Tracer: `/team/{number}` end to end against live data, tab shell, page states
- [x] 06-02-PLAN.md — Published schema for D-01…D-05 and D-09; Sigma1 returns per-alliance own variance
- [x] 06-03-PLAN.md — Robot-photo ingest: `team_media` corpus table, TBA media call, photo-type allowlist

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 06-04-PLAN.md — Publisher wiring: event-name fix, own variance, actual RP, scheduled rows, percentiles, activeYears, robot image
- [ ] 06-05-PLAN.md — Metric-history chart tab (Recharts, measured dynamic import) + search box and Teams table integration

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 06-06-PLAN.md — The single full republish and the payload-budget re-measure

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 06-07-PLAN.md — Season header, rarity tiers, team-scoped year dropdown
- [ ] 06-08-PLAN.md — Event sections and the predicted-vs-actual match table on one shared axis

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 06-09-PLAN.md — Static-shell first paint (re-measured) and the UI polish pass

**UI hint**: yes

### Phase 7: Event Pages

**Goal**: Users can inspect any event's teams, scoring composition, and full match slate with predictions versus actuals
**Depends on**: Phase 5
**Requirements**: EVNT-02, EVNT-03, EVNT-04, EVNT-05, EVNT-06
**Success Criteria** (what must be TRUE):

  1. The Insights tab ranks the event's teams using the same columns as the Teams page for the selected algorithm.
  2. The Breakdown tab shows score-component breakdowns for the event's teams.
  3. The Quals tab lists every qualification match with predicted winner, confidence, and predicted scores next to actual results.
  4. The Alliances tab shows each alliance's combined metrics.
  5. The Elims tab lists every elimination match with predictions next to actual results.

**Plans**: TBD
**UI hint**: yes

### Phase 8: Simulation & Compare

**Goal**: The two headline differentiators ship — rank simulation from a chosen match, and a public accuracy table that matches the harness exactly
**Depends on**: Phase 7
**Requirements**: EVNT-07, COMP-01, EVAL-05
**Success Criteria** (what must be TRUE):

  1. On an event's Simulation tab a user picks a start match, and the remaining qualification matches are simulated 1000× from predicted winners, confidence, and RP ± variance, producing a predicted rank distribution per team.
  2. The simulation runs in the browser from precomputed inputs without blocking the page, with its runtime measured and recorded.
  3. The Compare page shows winner accuracy and Brier score for every algorithm for every year 2022–2026.
  4. The numbers rendered on the Compare page are identical to the versioned artifact the offline harness produced for that algorithm version — verified by an automated check, not by eye.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 3.1 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Foundation & Evaluation Harness | 6/6 | Complete    | 2026-08-19 |
| 2. Prediction Models — EPA & Sigma1 | 6/6 | Complete    | 2026-08-14 |
| 3. Tuning, Ranking Points & Versioning | 8/8 | Complete    | 2026-08-18 |
| 3.1 Address Phase 1-3 review warnings and doc drift (INSERTED) | 5/5 | Complete    | 2026-08-20 |
| 4. Publish & Live Update Pipeline | 8/8 | Complete    | 2026-08-23 |
| 5. Site Shell — Navigation & Browsing | 8/8 | Complete    | 2026-08-24 |
| 6. Team Pages | 3/9 | In Progress|  |
| 7. Event Pages | 0/TBD | Not started | - |
| 8. Simulation & Compare | 0/TBD | Not started | - |

## Coverage

All 38 v1 requirements map to exactly one phase. No orphans, no duplicates.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1 | DATA-01, DATA-02, EVAL-01, EVAL-02, EVAL-03, EVAL-04, ALGO-01 | 7 |
| 2 | ALGO-02, ALGO-03, ALGO-07 | 3 |
| 3 | ALGO-04, ALGO-05, ALGO-06, ALGO-08 | 4 |
| 4 | DATA-03, DATA-04, DATA-05 | 3 |
| 5 | NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, TEAM-01, EVNT-01 | 8 |
| 6 | TEAM-02, TEAM-03, TEAM-04, TEAM-05, TEAM-06 | 5 |
| 7 | EVNT-02, EVNT-03, EVNT-04, EVNT-05, EVNT-06 | 5 |
| 8 | EVNT-07, COMP-01, EVAL-05 | 3 |

**Notes:**

- The Compare ribbon link exists from Phase 5 but lands on a placeholder until Phase 8 fills it.
- Phase 5 can begin against fixture artifacts as soon as Phase 4 fixes the artifact schema; the dependency is on the schema, not on production data.
- No standalone "polish" phase exists — deep links (NAV-05), mobile (NAV-04), and load performance (NAV-06, DATA-03) are success criteria inside the phases that build the pages, not deferred cleanup. The freshness indicator is v2 (ENH-01).

---
*Roadmap created: 2026-08-12*
