# Feature Research

**Domain:** FRC (FIRST Robotics Competition) match-prediction / analytics website
**Researched:** 2026-08-12
**Confidence:** MEDIUM (cross-checked web sources across multiple competitor products; no single-vendor internal docs consulted)

## Competitive Landscape Surveyed

| Product | What it is | Relevance |
|---------|-----------|------------|
| **Statbotics.io** | EPA-based prediction/analytics site; open source | Closest direct competitor — REBUILD_SPEC explicitly targets its feel/density and aims to beat it on accuracy and speed |
| **The Blue Alliance (TBA)** | Canonical FRC data-of-record site + API v3 (SigmaScout's data source); has its own basic match predictions | Baseline for "what every FRC fan already expects to find" |
| **Peekorobo** | Community analytics site with its own rating (ACE model), team/event pages, map view, game-history wiki | Shows a second independent take on the same product category — validates which features are category-standard vs one-vendor quirks |
| **frc.link** | Turns out to be FIRST's own URL-shortener for firstinspires.org pages, *not* a prediction/analytics product | Not a competitor — dropped from feature analysis; noted here so the gap is explicit rather than silent |
| **PitRadar** | Free live event dashboard (pit displays / stands) pulling TBA + Statbotics + FRC Nexus data, refreshed every ~15s | Best available signal for "mobile/stands live-viewing" expectations — a different product shape (dashboard, not predictor) but shows what "live" means to this audience |
| **Team-built scouting apps** (CyberapK, Open Scouting, FRC930, Simbotics, ScoutingPASS, etc.) | Dozens of independent, mostly open-source, team-specific scouting apps | These collect data (pit/match scouting) rather than predict — different product category from SigmaScout, but their "live during competition weekend" UX patterns are relevant table stakes for what FRC people expect from any FRC-adjacent site in the stands |

**Category clarification:** SigmaScout is a *prediction/analytics* site (Statbotics/Peekorobo/TBA category), not a *data-collection* scouting app (CyberapK/Open Scouting category). Scouting apps are included here only for stands/live-use UX patterns, not as feature-parity targets.

## Feature Landscape

### Table Stakes (Users Expect These)

Features every FRC analytics product in this category has. Missing these makes SigmaScout feel broken or amateurish to a community that already has Statbotics and TBA as the baseline.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Team browsing (ranked list, search) | TBA, Statbotics, and Peekorobo all lead with a sortable/searchable team list; it's the primary entry point for "look up team 254" | LOW | Already scoped: Teams page with number/name/rank/metric/record/win-rate + search |
| Team detail page (season stats, per-event match history, TBA link) | Universal pattern across all three competitors; users click through from a list to a team's story | MEDIUM | Scoped in spec; robot image + TBA link is Statbotics/Peekorobo parity |
| Event browsing (filter by week/state/district) | TBA and Statbotics both support this; FRC has hundreds of events/year across districts — unfilterable lists are unusable | LOW | Scoped: Events page sortable/filterable by week, country, state, district |
| Event detail page with quals/elims match lists | Baseline TBA feature; every competitor shows match schedule + results per event | MEDIUM | Scoped: Quals, Elims tabs |
| Alliance/ranking table at event level | Statbotics bolts EPA onto the official TBA ranking table; this pattern (official ranks + your metric) is now the expected view | LOW-MEDIUM | Scoped: Insights tab, Alliances tab |
| Match win probability display | Statbotics shows a calibrated win-probability percentage per match; this is the single most-referenced Statbotics feature in community discussion | MEDIUM | Scoped: predicted winner + confidence per match |
| Predicted vs. actual score/outcome comparison | Statbotics' match-by-match predicted-vs-actual history is a core trust-building device — lets users audit the model themselves | MEDIUM | Scoped: predicted scores vs actual scores per match |
| Metric-history plot over a team's season | Statbotics' "bubble plots" / metric trend views are a known differentiator-turned-expectation; competitors without a trend view feel static | MEDIUM | Scoped: team page metric-history plot with matches on x-axis |
| Link out to TBA / official data | Every analytics site defers to TBA as source of truth and links to it — users expect to verify against the canonical source | LOW | Scoped |
| Mobile-usable pages | PitRadar's entire value proposition is being usable on a phone in the stands/pits; FRC audiences are overwhelmingly on phones at events | MEDIUM | Scoped ("mobile and desktop"); test on-device, not just responsive breakpoints |
| Fast page loads | Explicitly named as the #1 UX priority in REBUILD_SPEC, and implicitly table stakes — Statbotics' recompute-on-load approach is a known pain point in the community that SigmaScout is deliberately avoiding | MEDIUM-HIGH | Precomputed data pipeline is the direct answer to this; see PITFALLS.md / ARCHITECTURE.md |
| Data freshness during live events | PitRadar's whole pitch is ~15s refresh; Statbotics/TBA both update during events; a predictor that's stale mid-event is useless to someone in the stands | HIGH | Scoped as ~1–3 min freshness target; architecturally the hardest table-stakes item (see PITFALLS.md) |

### Differentiators (Competitive Advantage)

Features that set SigmaScout apart from Statbotics/Peekorobo/TBA. These map directly to REBUILD_SPEC's stated core value ("measurably better than Statbotics, delivered fast").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Published, in-app algorithm accuracy comparison (Compare page) | Statbotics' only public accuracy comparison is a static blog post ("Evaluating FRC Rating Models") comparing Wins/OPR/Elo/EPA by year — not a live in-app feature. No competitor has an interactive, always-current, per-algorithm-per-year accuracy table baked into the site itself. This is a genuine gap SigmaScout can own. | MEDIUM | Directly requires the walk-forward evaluation harness (REBUILD_SPEC failure-log item #1) — this is the feature that makes "measurably better" a checkable claim, not a slogan |
| Variance-aware metrics (`X ± Y`) everywhere a metric appears | Neither Statbotics (EPA) nor Peekorobo (ACE) publish uncertainty on their point-estimate ratings; presenting confidence intervals is a stated Sigma-family design goal and a visible point of difference on every team/event page | MEDIUM-HIGH | Requires the Kalman-filter-family Sigma1 model to actually produce calibrated variance, not just a display change |
| Algorithm versioning as a browsable, comparable concept | Statbotics has iterated its EPA model over time but does not expose "view this event as Sigma1 v1 vs v2 saw it" as a user-facing feature; competitors treat model iteration as an internal implementation detail | MEDIUM-HIGH | Data-model-level decision (already captured as a Key Decision in PROJECT.md); mostly a backend/schema cost, moderate UI cost |
| Auto-tuned algorithm with a documented harness (vs. hand-picked constants) | Community skepticism exists around opaque rating tweaks; a documented, harness-driven tuning process is a trust/credibility differentiator even though the tuning process itself isn't user-facing | LOW UI cost / HIGH backend cost | The differentiator is really "backed by the Compare page," not a standalone UI feature |
| RP prediction with variance, at the per-match level, shown alongside win probability | Statbotics predicts RP via an ILS model but doesn't consistently expose RP uncertainty at the match level the way SigmaScout's spec does; explicit RP ± variance next to actual RP is a step beyond current competitor norms | MEDIUM | Requires per-season RP rule implementations (2022–2026) — real scope driver, not just a UI flourish |
| Event rank simulation from a user-chosen start match | Statbotics *has* Monte Carlo event simulation (1000 runs) — this is not a novel feature — but it doesn't let a user pick an arbitrary "start from this match" checkpoint; SigmaScout's spec adds that interactive control | MEDIUM (builds on already-planned simulation engine) | Not a from-scratch differentiator — treat as "match Statbotics' simulation, then add the pick-a-start-match control" |
| Sub-3-minute freshness as a marketed/visible property (e.g. "last updated Xs ago") | PitRadar proves ~15s refresh is achievable and valued by this audience for live dashboards; no analytics/*prediction* site currently markets its own freshness. Surfacing "how fresh is this prediction" turns an architectural choice into a trust signal | LOW (once the freshness pipeline exists) | Cheap addition once the ~1-3 min pipeline (table stakes item above) is built — pure UI/copy work |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Client-side / on-page-load recomputation of season stats | Statbotics does this today, so it looks like the "normal" pattern to copy | This is the single most-cited Statbotics pain point (slow page loads) and is explicitly rejected in REBUILD_SPEC; also reintroduces the "recompute-per-request" failure-log item from the prior SigmaScout attempt | Precompute everything server/worker-side on a schedule; ship compact static/precomputed JSON to the browser |
| User accounts / favorites / personalization (Peekorobo has this) | Peekorobo offers login + favorite teams/events, which feels like a natural "nice to have" | Explicitly out of scope per PROJECT.md ("not part of the product vision"); adds auth, storage, and privacy surface area with no connection to the core value (prediction accuracy) | Deep-linkable URLs (team/event/year in the URL) so people can bookmark or share without accounts |
| Data-collection stand scouting (pit scouting forms, custom scouting schedules, alliance-selection tools) | The scouting-app category (CyberapK, Open Scouting, etc.) is huge and adjacent, and it's tempting to fold "be everything for competition weekend" into one product | Completely different problem (primary human data collection vs. secondary TBA-derived prediction); would roughly double scope and dilute the "best predictor" focus | Stay a pure consumer of TBA match results; let dedicated scouting apps own primary data collection |
| Interactive map / geographic visualization (Peekorobo has this) | Looks like an easy visual differentiator since a competitor already has it | Doesn't serve the "best predictor" core value at all — it's a browsing novelty, not a prediction feature; scope creep risk given the free-tier/solo-maintainer constraints | Skip; if geography matters, expose country/state/district as event *filters* only (already scoped) |
| Live win-probability "ticker" / second-by-second in-match updates (PitRadar-style live field status) | PitRadar's 15-second field-status refresh is impressive and sets a "live" bar | FRC matches are ~2.5 minutes and TBA doesn't provide sub-match telemetry; chasing PitRadar's refresh cadence would mean polling infrastructure far beyond the stated ~1-3 min freshness target and free-tier budget, for a feature (in-match live score) that isn't a prediction at all | Keep freshness target at ~1-3 min for *match-result-driven* prediction updates; do not attempt to compete with live-dashboard products on in-match refresh cadence |
| Custom/pluggable rating models for end users (let users define their own formula) | Power users on Chief Delphi sometimes want to tweak weightings themselves | Massive complexity and validation surface (every user config becomes a thing that must remain walk-forward-safe and correctly evaluated); conflicts with "algorithm versioning as first-class, harness-tuned" design | Ship a fixed, versioned set of algorithms (Sigma1, OPR, EPA) selectable via the existing algorithm dropdown; let the Compare page carry the "which is best" conversation instead |

## Feature Dependencies

```
Walk-forward evaluation harness (Brier scoring, predict-before-update)
    └──requires──> Sigma1 algorithm + OPR + reimplemented EPA (things to score)
                       └──enables──> Compare page (accuracy per algorithm per year)
                       └──enables──> Auto-tuning harness (needs an objective to optimize against)

Data pipeline (TBA fetch, precompute, ~1-3 min refresh)
    └──requires──> Algorithm versioning as first-class data model
                       └──enables──> Team page (finished events show metrics "as captured at that moment")
                       └──enables──> Compare page (needs past algorithm versions' historical predictions, not just current)

Sigma1 variance-carrying metrics
    └──enables──> "X ± Y" display everywhere (team page, event Insights, match predictions)
    └──enables──> RP prediction with variance
                       └──enables──> Event Simulation tab (RP variance feeds the 1000-run Monte Carlo)

Teams page (ranked list) ──shares-columns-with──> Event Insights tab (same table, scoped to attendees)

Event Simulation tab
    └──requires──> Match win probability + confidence (per match)
    └──requires──> RP prediction with variance
    └──requires──> A chosen start-match control (differentiator beyond Statbotics' simulator)

Global algorithm dropdown + year dropdown
    └──enables──> All prediction displays (team page, event tabs, Compare page) to be re-sliced without separate pages per algorithm/year
```

### Dependency Notes

- **Compare page requires the evaluation harness:** the harness (walk-forward, Brier-scored, predict-before-update) isn't just a dev tool — it *is* the data source for the Compare page. Build order matters: harness before Compare page is user-facing, and ideally harness before Sigma1 model iteration begins (per REBUILD_SPEC failure log).
- **Algorithm versioning enables historical accuracy honesty:** without treating algorithm versions as first-class, "finished events show metrics as captured at that moment" (spec requirement) and a meaningful year-over-year Compare page are both impossible — you'd be silently reapplying today's model to yesterday's events, which is a subtler form of the outcome-leakage failure already logged.
- **Variance-carrying metrics enable three downstream features at once:** the `X ± Y` display convention, RP-with-variance, and the rank simulation all depend on Sigma1 actually producing calibrated uncertainty (not a cosmetic ± slapped on afterward). This is the highest-complexity dependency chain in the product.
- **Data freshness pipeline conflicts with (rules out) client-side recomputation:** these two approaches to "keeping stats current" are mutually exclusive by design; REBUILD_SPEC already resolved this in favor of precompute + fast refresh, which should not be revisited mid-project.
- **Scouting-app-style features conflict with the core value:** any pull toward primary data collection (pit scouting, alliance-selection tools) competes for the same limited (solo/free-tier) build budget as the prediction/evaluation work that actually differentiates SigmaScout — treat as a hard boundary, not a backlog item.

## MVP Definition

### Launch With (v1)

Minimum viable product — matches REBUILD_SPEC's Active requirements almost exactly; nothing here is optional given the stated core value.

- [ ] Walk-forward evaluation harness (Brier score, winner accuracy) — the core value ("measurably better") is unverifiable without it
- [ ] Data pipeline: TBA fetch, precompute, ~1-3 min refresh — table stakes for a live-feeling site, and the direct fix for the logged recompute-per-request failure
- [ ] Sigma1 + OPR + reimplemented EPA, algorithm-selectable — Compare page and "measurably better" claim need real baselines, not a strawman
- [ ] Algorithm versioning in the data model — required for honest historical display and a meaningful Compare page
- [ ] Teams page (ranked, searchable) — table stakes, primary navigation entry point
- [ ] Team page (season stats, per-event matches with predictions vs actuals, metric-history plot) — table stakes, parity with Statbotics
- [ ] Events page (filterable) — table stakes
- [ ] Event page tabs: Insights, Breakdown, Quals, Alliances, Elims, Simulation — table stakes (Insights/Breakdown/Quals/Alliances/Elims) plus a genuine differentiator (Simulation with chosen start match)
- [ ] Compare page (accuracy per algorithm per year) — the headline differentiator; depends on the harness existing first
- [ ] RP prediction with per-season rules (2022-2026) — named as a headline feature in PROJECT.md Key Decisions
- [ ] Global nav: Teams/Events/Compare ribbon, algorithm dropdown, year dropdown, search, mobile+desktop — table stakes navigation shell

### Add After Validation (v1.x)

- [ ] "Last updated Xs ago" freshness indicator — cheap once the pipeline exists; add once the freshness pipeline is proven reliable in a live event, not before (don't market a number you haven't confidence-tested live)
- [ ] Sigma2/Sigma3 iterations, viewable side-by-side with Sigma1 — trigger: once Sigma1 has a full season of walk-forward backtest results validating the auto-tuning approach works at all
- [ ] Deep-linkable/shareable URLs for specific team/event/algorithm/year views — trigger: once core pages are stable; low cost, high goodwill, natural v1.x add given the explicit no-user-accounts stance

### Future Consideration (v2+)

- [ ] Additional algorithm families beyond the Kalman-filter approach — defer until Sigma1's harness-validated results show where a fundamentally different model would help (avoid the previously-logged "give the model more latent structure than observations can pin down" failure by not speculatively adding models)
- [ ] Seasons before 2022 — explicitly deferred in PROJECT.md; revisit only after 2022-2026 backtest coverage and live 2027 usage are solid
- [ ] Any live in-match dashboard features (à la PitRadar) — explicitly not this product's category; revisit only if the prediction product's core value is fully validated and there's separate appetite for a second product

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Walk-forward evaluation harness | HIGH (invisible but foundational) | MEDIUM | P1 |
| Data pipeline (~1-3 min refresh) | HIGH | HIGH | P1 |
| Sigma1 + OPR + EPA algorithms | HIGH | HIGH | P1 |
| Algorithm versioning data model | MEDIUM (invisible, enables trust) | MEDIUM | P1 |
| Teams page | HIGH | LOW | P1 |
| Team page (matches, plot) | HIGH | MEDIUM | P1 |
| Events page | MEDIUM | LOW | P1 |
| Event page tabs (Insights/Breakdown/Quals/Alliances/Elims) | HIGH | MEDIUM | P1 |
| Event Simulation tab (with start-match picker) | HIGH (headline feature) | MEDIUM-HIGH | P1 |
| RP prediction with variance | HIGH (headline feature) | MEDIUM-HIGH | P1 |
| Compare page | HIGH (core differentiator) | MEDIUM | P1 |
| Global nav/dropdowns/search | HIGH | LOW | P1 |
| Freshness indicator UI | LOW-MEDIUM | LOW | P2 |
| Deep-linkable URLs | MEDIUM | LOW | P2 |
| Algorithm versioning UI (compare Sigma1 vs Sigma2 side by side) | MEDIUM | MEDIUM | P2 |
| Additional algorithm families | LOW (unproven need) | HIGH | P3 |
| Pre-2022 seasons | LOW (explicitly deferred) | HIGH | P3 |
| User accounts / favorites | LOW (explicitly out of scope) | MEDIUM | P3 (reject) |
| Interactive team map | LOW (novelty, off-core-value) | MEDIUM | P3 (reject) |

**Priority key:**
- P1: Must have for launch (matches REBUILD_SPEC Active requirements)
- P2: Should have, add when possible
- P3: Nice to have / explicitly rejected — see Anti-Features

## Competitor Feature Analysis

| Feature | Statbotics | Peekorobo | TBA | SigmaScout Approach |
|---------|-----------|-----------|-----|----------------------|
| Rating metric | EPA (point estimate, no variance) | ACE (point estimate, unvalidated accuracy) | none (raw stats only) | Sigma1 with `X ± Y` variance; OPR/EPA as no-variance baselines for comparison |
| Win probability | Calibrated logistic-difference %, shown per match | Present (accuracy not formally benchmarked) | Basic predictions, explicitly labeled "just for fun" | Calibrated, harness-validated, with confidence shown alongside |
| Event simulation | Monte Carlo, 1000 runs, fixed to "current" snapshot | Not confirmed | None | Monte Carlo, 1000 runs, from a *user-chosen* start match |
| Algorithm accuracy transparency | Static blog post, not in-app, not per-year interactive | Not published | None | In-app Compare page, per algorithm per year, backed by the same walk-forward harness used for model tuning |
| Algorithm versioning | Not user-facing | Not user-facing | N/A | First-class: browsable/comparable past Sigma versions |
| RP prediction | Yes (ILS model, 2023-era) | Not confirmed | No | Yes, per-season rules for 2022-2026, with variance |
| Team/event browsing | Yes, mature | Yes, mature + map | Yes, canonical source | Match table-stakes parity; no map (deliberately, see Anti-Features) |
| Freshness during events | Updates during events (no published SLA) | Not confirmed | Updates during events | ~1-3 min target, precomputed (not recompute-on-load) |
| User accounts | No | Yes (favorites) | Account for some features | Deliberately excluded (see Anti-Features) |
| Page load speed | Known pain point (recomputes EPA client-side) | Not benchmarked | Generally fast (mature, established) | Precompute-everything architecture is the explicit fix for Statbotics' weakest point |

## Sources

- [Statbotics — Statbotics 3.0.0 documentation](https://statbotics.readthedocs.io/en/latest/)
- [Statbotics V2 blog post](https://www.statbotics.io/blog/v2)
- [Statbotics — Evaluating FRC Rating Models](https://www.statbotics.io/blog/models)
- [Statbotics — The EPA Model](https://www.statbotics.io/blog/epa)
- [GitHub - avgupta456/statbotics](https://github.com/avgupta456/statbotics)
- [What Is Statbotics? FRC EPA Explained · LearnFRC](https://learnfrc.com/blog/what-is-statbotics-frc-epa)
- [Statbotics and the EPA Model · LearnFRC](https://learnfrc.com/guides/scouting-strategy/data-analysis-tba-statbotics/statbotics-epa)
- [The Blue Alliance — About](https://www.thebluealliance.com/about)
- [Tech Talk: How TBA Predicts Match Times – The Blue Alliance Blog](https://blog.thebluealliance.com/2017/05/11/tech-talk-how-tba-predicts-match-times/)
- [Predictions – The Blue Alliance Blog](https://blog.thebluealliance.com/category/predictions/)
- [Peekorobo UI Update and Feature List - Chief Delphi](https://www.chiefdelphi.com/t/peekorobo-ui-update-and-feature-list/502118)
- [GitHub - rhettadam/peekorobo](https://github.com/rhettadam/peekorobo)
- [Peekorobo - A new website for exploring teams and events - Chief Delphi](https://www.chiefdelphi.com/t/peekorobo-a-new-website-for-exploring-teams-and-events-built-with-tba/490943)
- [PitRadar — How to Use](https://pitradar.app/?page=help)
- [Introducing PitRadar - Chief Delphi](https://www.chiefdelphi.com/t/introducing-pitradar-a-free-live-competition-dashboard-for-pit-displays-spectators/517920)
- [Resource Hub - Jared Hasen-Klein (frc.link explanation)](https://hub.jaredhk.com/frc)
- [GitHub - FRC930/scouting_app](https://github.com/FRC930/scouting_app)
- [Open Scouting | FRC 2026 Rebuilt - Chief Delphi](https://www.chiefdelphi.com/t/open-scouting-frc-2026-rebuilt/510619)
- [GitHub - Simbotics/Scouting-Platform-Mobile](https://github.com/Simbotics/Scouting-Platform-Mobile)
- [FRC Scouting Apps and Resources - Chief Delphi](https://www.chiefdelphi.com/t/frc-scouting-apps-and-resources/424829)

---
*Feature research for: FRC match-prediction / analytics website*
*Researched: 2026-08-12*
