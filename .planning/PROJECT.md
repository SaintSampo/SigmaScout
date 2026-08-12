# SigmaScout

## What This Is

SigmaScout is an FRC (FIRST Robotics Competition) match-prediction website — the goal is to be the absolute best FRC match predictor available. It presents teams, events, and predictions the way statbotics.io does, but faster and with honest uncertainty: Sigma-family metrics are displayed as `X ± Y` (1 standard deviation), predictions update within minutes of new match results, and every algorithm's accuracy is measured and published. Built for the FRC community: students, mentors, and scouts.

This is a clean-slate rebuild (v3). Prior implementations exist only in git history (tag `v2-poc`) and must not be consulted or ported — see REBUILD_SPEC.md "Clean slate" section. The only inheritance is the failure log.

## Core Value

Predictions that are *measurably* better than Statbotics — proven by walk-forward, Brier-scored backtests — delivered on pages that load fast.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Evaluation harness: walk-forward (predict-before-update) backtests over 2022–2026 with Brier score and winner accuracy, comparing all algorithms head-to-head
- [ ] Data pipeline: fetch from The Blue Alliance API v3, precompute all site data, refresh within ~1–3 minutes during active events
- [ ] Sigma1 algorithm: Kalman-filter family, variance-carrying metrics, hyperparameters tuned automatically (offline optimizer against backtest score + validated online within-season adaptation)
- [ ] Baseline algorithms: OPR and reimplemented EPA, selectable in the UI and scored in the harness
- [ ] Algorithm versioning as a first-class concept: past Sigma versions remain viewable and comparable
- [ ] Teams page: ranked table (number, name, rank, metrics, record, win rate) with search
- [ ] Team page: robot image, TBA link, season stats, per-event sections with match-level predictions (winner, confidence, scores, RP ± variance) vs actuals, metric-history plot
- [ ] Events page: all events for the selected year, sortable/filterable by week, country, state, district
- [ ] Event page tabs: Insights, Breakdown, Quals, Alliances, Elims, Simulation (1000-run remaining-quals rank simulation from a chosen start match)
- [ ] Compare page: prediction accuracy per algorithm per year
- [ ] Global UI: top ribbon (Teams / Events / Compare), algorithm dropdown, year dropdown, team/event search; mobile and desktop
- [ ] Rank-point prediction with per-season RP rules for all covered seasons (2022–2026)

### Out of Scope

- Porting any pre-v3 code, models, or tuned values — clean-slate mandate; independent re-derivation only (REBUILD_SPEC.md)
- Seasons before 2022 — modern-era focus keeps data volume and per-season game logic manageable; may extend later
- Paid infrastructure — must fit Cloudflare free tiers (Pages, Workers cron, KV/R2 quotas) and TBA rate limits
- Client-side season recomputation — Statbotics' recalculate-in-browser approach is explicitly rejected; everything precomputed
- User accounts / personalization — not part of the product vision

## Context

- **Data source:** The Blue Alliance API v3 (a TBA API key exists in the repo's untracked `.env`). ETag-aware caching is recommended by TBA and counts as independent best practice, not a port.
- **EPA baseline is reimplemented** from TBA data (walk-forward capable at any point in time) rather than pulled from the Statbotics API, accepting reimplementation-drift risk; spot-checks against published Statbotics numbers are a sensible guard.
- **Failure log from prior attempts** (constraints, not designs — full text in REBUILD_SPEC.md): no evaluation harness existed; an unidentifiable 4D model collapsed; outcome leakage must be structurally impossible (predict strictly before update); never recompute per request; docs must track the shipped model; tests are not optional; keep generated artifacts out of git.
- **Live updating:** the ~1–3 min freshness target implies a scheduled compute component (e.g. Cloudflare Worker cron polling TBA) feeding storage the site reads — final architecture to be settled in research/planning within free-tier limits.
- **The 2026 season is complete** (today: 2026-08-12); offseason events run in fall 2026. Backtests over 2022–2026 are the proving ground; the 2027 season is the first live target.

## Constraints

- **Tech stack**: React + Vite + Tailwind CSS, hosted on Cloudflare Pages — user-specified
- **Budget**: Cloudflare free tiers only; respect TBA API rate limits — hobby project economics
- **Performance**: page load speed is the top UX priority; ship compact precomputed data; modern web features — user-specified
- **Freshness**: new match results reflected on-site within ~1–3 minutes during events
- **Methodology**: all prediction evaluation must be walk-forward with predict-before-update sequencing — failure log
- **Provenance**: no consultation or porting of pre-v3 implementations — clean-slate mandate

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Freshness target ~1–3 min via scheduled TBA polling | Fast enough to feel live during events without webhook/server complexity | — Pending |
| v1 covers seasons 2022–2026 | Modern era, rich score breakdowns, enough backtest history without ballooning scope | — Pending |
| v1 algorithms: Sigma1 + OPR + reimplemented EPA | Compare page needs real baselines; reimplemented EPA works walk-forward and substantiates the Statbotics comparison | — Pending |
| RP prediction + simulation for all covered seasons | Headline features; per-season RP rules accepted as v1 scope | — Pending |
| Sigma1 tuning: offline optimizer + online within-season adaptation ("Both") | Online-only hides hand-picked meta-parameters and is unfalsifiable; the harness validates the adaptation itself | — Pending |
| EPA reimplemented, not pulled from Statbotics API | Walk-forward at any time point, self-contained pipeline; drift risk mitigated by spot-checks | — Pending |
| Clean-slate rebuild; only the failure log carries over | Prior tech debt; independent re-derivation allowed, inheritance not | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-12 after initialization*
