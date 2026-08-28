# Requirements: SigmaScout

**Defined:** 2026-08-12
**Core Value:** Predictions that are *measurably* better than Statbotics — proven by walk-forward, Brier-scored backtests — delivered on pages that load fast.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Evaluation Harness

- [x] **EVAL-01**: Harness replays any 2022–2026 season walk-forward, with every prediction made strictly before that match's outcome is folded into the model (predict-before-update), for every algorithm
- [x] **EVAL-02**: Harness reports Brier score and winner accuracy per algorithm per season
- [x] **EVAL-03**: Harness produces calibration curves per algorithm (predicted probability vs observed frequency)
- [x] **EVAL-04**: Hyperparameter tuning uses an explicit tune/holdout season split; headline accuracy claims come from holdout seasons only
- [ ] **EVAL-05**: Harness results are published as a versioned artifact — the Compare page displays the same numbers the offline harness produced

### Data Pipeline

- [x] **DATA-01**: Pipeline ingests TBA API v3 teams, events, and matches for 2022–2026 using ETag conditional requests
- [x] **DATA-02**: Pipeline correctly handles TBA data quirks: surrogate matches, match replays, missing score breakdowns, and offseason events (excluded or flagged, never silently ingested)
- [x] **DATA-03**: Full-season precompute runs offline and publishes compact, versioned artifacts that the site reads — no server-side or client-side recomputation per request
- [x] **DATA-04**: During active events, new match results are reflected on the site within ~1–3 minutes via an incremental update path
  - **Scoped in Phase 4 to sigma1 only.** Measured median 58.9 s (p95 60.9 s) on the deployed Worker via real cron. `opr` and `epa` remain fully *published* but are **not folded live** — they refresh at the manual pre/post-event-weekend re-baseline. This narrows plan-time intent (04-06 originally folded all three live) and is a deliberate decision, not an oversight: measurement showed three live algorithms cost 50 subrequests against ~41 usable, deferring every ordinary match forever. Controlled by `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; see `.planning/quick/260822-wqt-restrict-live-folding-to-sigma1/` and `docs/publish-budget.md` § "Worker runtime budget". Promoting a second algorithm to the live tier requires the Phase B batching work named in that doc.
- [x] **DATA-05**: All compute and storage fits Cloudflare free tiers (Workers 10ms CPU per invocation, KV/R2 quotas) and respects TBA rate limits
  - Idle-tick `cpuTime` median 7 ms (range 5–10, n=19), zero invocations over 10 ms, `exceededCpu` never observed. **Open:** the advanced (real fold) tick's `cpuTime` is unmeasured — see G1 in `04-UAT.md`. A full live event-day TBA/write-volume extrapolation was also not performed; recorded as unmeasured rather than estimated.

### Algorithms

- [x] **ALGO-01**: OPR is computed per team per event over qualification matches only, as a no-variance baseline, matching TBA's definition
- [x] **ALGO-02**: EPA is reimplemented from TBA data and runs walk-forward at any point in a season
- [x] **ALGO-03**: Sigma1 (Kalman-filter family) produces a mean and variance for each team metric, displayed as X ± Y (1 standard deviation)
- [x] **ALGO-04**: Sigma1 hyperparameters are set by an offline optimizer searching against backtest score on tune seasons
- [x] **ALGO-05**: Sigma1 adapts online within a season; the harness validates adaptation improves holdout score (on vs off)
- [x] **ALGO-06**: Algorithm versions are first-class in the data model: the site can display metrics and predictions from any past algorithm version unchanged
- [x] **ALGO-07**: Every match gets a predicted winner, win probability, and predicted alliance scores; Sigma predictions carry variance
- [x] **ALGO-08**: Ranking points are predicted per match with variance, using each season's RP rules (2022–2026)

**Re-issued 2026-08-21 (Phase 3.2):** ALGO-01's text above was corrected from "OPR is computed per
team per season as a no-variance baseline" (no longer true) to the event-scoped, qualification-
matches-only definition the code now implements. This is a requirement-text correction, not a new
requirement — the `[x]` completion mark and ID are unchanged. See `docs/models/opr-baseline-change.md`
for the full baseline-change narrative.

### Teams

- [x] **TEAM-01**: User can view all teams for the selected year ranked by the selected algorithm's metric, with columns: team number, name, rank, metric(s), record, win rate
- [x] **TEAM-02**: User can open a team page showing team name, robot image for that year, and a link to the team's TBA page
- [x] **TEAM-03**: Team page shows current season stats: record, win rate, and metrics
- [x] **TEAM-04**: Team page shows a section per attended/upcoming event; finished events show metrics as captured at the moment the event ended
- [x] **TEAM-05**: Each event section lists that team's matches with both alliances' teams, predicted winner, confidence, predicted scores, predicted RP ± variance, actual scores, and actual RP
- [x] **TEAM-06**: Team page has a second tab plotting the team's metrics over the season with matches on the x-axis, including a variance band for Sigma metrics

### Events

- [x] **EVNT-01**: User can view all events for the selected year, sortable/filterable by week, country, state, and district
- [ ] **EVNT-02**: Event Insights tab ranks the event's teams with the same columns as the Teams page
- [x] **EVNT-03**: Event Breakdown tab shows score-component breakdowns for the event's teams
- [ ] **EVNT-04**: Event Quals tab lists qualification matches with predictions vs actuals
- [ ] **EVNT-05**: Event Alliances tab shows each alliance's combined metrics
- [ ] **EVNT-06**: Event Elims tab lists elimination matches with predictions vs actuals
- [ ] **EVNT-07**: Simulation tab: user picks a start match; the remaining qual matches are simulated 1000× using predicted winners, confidence, and RP ± variance, producing a predicted rank distribution per team

### Compare

- [ ] **COMP-01**: User can view a table of prediction accuracy (winner accuracy and Brier score) for each algorithm, per year

### Navigation & UI

- [x] **NAV-01**: Top ribbon navigates to Teams, Events, and Compare
- [x] **NAV-02**: Prominent global dropdowns select the prediction algorithm and the year, re-slicing every page
- [x] **NAV-03**: Search bar finds teams and events
- [x] **NAV-04**: All pages are usable on mobile and desktop
- [x] **NAV-05**: URLs are deep-linkable: year, algorithm, and current team/event view are encoded in the shareable URL
- [x] **NAV-06**: Pages render from precomputed artifacts with fast load as the top priority — no season statistics are recomputed in the browser

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhancements

- **ENH-01**: "Last updated X ago" freshness indicator, added once the live pipeline is proven during a real event
- **ENH-02**: Side-by-side UI comparison of Sigma algorithm versions (data model already supports it)
- **ENH-03**: Sigma2+ iterations, viewable and comparable alongside Sigma1
- **ENH-04**: Seasons before 2022

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Client-side / per-request season recomputation | Statbotics' known weak point and a logged prior failure; precompute-everything is a core architectural decision |
| User accounts / favorites / personalization | No connection to core value; deep-linkable URLs cover sharing/bookmarking without auth surface |
| Scouting data collection (pit/match scouting forms) | Different product category; would double scope and dilute the predictor focus |
| Interactive team map | Browsing novelty, off core value; geography served by event filters |
| In-match live telemetry / sub-minute tickers | TBA provides no sub-match data; beyond freshness target and free-tier budget |
| User-definable custom rating models | Massive validation surface; conflicts with versioned, harness-tuned algorithm design |
| Paid infrastructure | Cloudflare free tiers only — hobby project economics |
| Porting pre-v3 code, models, or tuned values | Clean-slate mandate (REBUILD_SPEC.md); only the failure log carries over |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVAL-01 | Phase 1 | Complete |
| EVAL-02 | Phase 1 | Complete |
| EVAL-03 | Phase 1 | Complete |
| EVAL-04 | Phase 1 | Complete |
| EVAL-05 | Phase 8 | Pending |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 4 | Complete |
| DATA-04 | Phase 4 | Complete (scoped: sigma1 only folds live — see note) |
| DATA-05 | Phase 4 | Complete (advanced-tick CPU unmeasured — see G1) |
| ALGO-01 | Phase 1 | Complete |
| ALGO-02 | Phase 2 | Complete |
| ALGO-03 | Phase 2 | Complete |
| ALGO-04 | Phase 3 | Complete |
| ALGO-05 | Phase 3 | Complete |
| ALGO-06 | Phase 3 | Complete |
| ALGO-07 | Phase 2 | Complete |
| ALGO-08 | Phase 3 | Complete |
| TEAM-01 | Phase 5 | Complete |
| TEAM-02 | Phase 6 | Complete |
| TEAM-03 | Phase 6 | Complete |
| TEAM-04 | Phase 6 | Complete |
| TEAM-05 | Phase 6 | Complete |
| TEAM-06 | Phase 6 | Complete |
| EVNT-01 | Phase 5 | Complete |
| EVNT-02 | Phase 7 | Pending |
| EVNT-03 | Phase 7 | Complete |
| EVNT-04 | Phase 7 | Pending |
| EVNT-05 | Phase 7 | Pending |
| EVNT-06 | Phase 7 | Pending |
| EVNT-07 | Phase 8 | Pending |
| COMP-01 | Phase 8 | Pending |
| NAV-01 | Phase 5 | Complete |
| NAV-02 | Phase 5 | Complete |
| NAV-03 | Phase 5 | Complete |
| NAV-04 | Phase 5 | Complete |
| NAV-05 | Phase 5 | Complete |
| NAV-06 | Phase 5 | Complete |

**Coverage:**

- v1 requirements: 38 total (corrected from 34 during roadmap creation — original count miscounted the ALGO and EVNT sections)
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-12*
*Last updated: 2026-08-12 after roadmap creation (traceability populated, coverage count corrected)*
