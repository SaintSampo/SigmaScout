# SigmaScout Rebuild Spec (v3)

Input document for `/gsd-new-project`. The current repo contents are the v2
proof of concept — the algorithm works (beats Statbotics EPA on winner
accuracy) but the site has too much technical debt. Tear it down and rebuild.

## Vision

The absolute best FRC match-predicting website possible. Feel and information
density comparable to statbotics.io, but faster: pages must load fast, and
when new match data is available the site should update as fast as possible.
Statbotics recalculates a team's whole EPA in the browser on page load — we
precompute instead and ship compact static data (this is the one thing v2 got
right; keep the pipeline → static JSON → Cloudflare Pages architecture).

## Stack and constraints

- React + Vite + Tailwind CSS. Mobile and desktop.
- Hosted on Cloudflare Pages.
- Live updating (v2 has an incremental updater in `pipeline/incremental.ts`;
  v3 needs live updates surfaced in the UI).
- Most modern web features. Compact and efficient. Top priority: page load speed.

## App structure

Top ribbon with three pages: **Teams**, **Events**, **Compare**. Plus:

- A prominent dropdown selecting the **match prediction algorithm**.
- A dropdown selecting the **year**.
- A search bar for teams or events.

### Algorithms and metrics

Each algorithm produces "metrics" (e.g. OPR, EPA, Sigma ratings). OPR and EPA
have no variance. All Sigma-family metrics model variance and display as
`X ± Y` where Y is 1 standard deviation.

There will be multiple iterations of the Sigma algorithm and the site must
support viewing and comparing past versions side by side:

- **Sigma0** — the v2 algorithm, kept as a frozen baseline. Per-team,
  per-component Kalman filter over alliance score observations
  (`pipeline/kalman.ts`), walk-forward (predict-before-update), with
  cross-season carryover priors. Frozen hyperparameters (from
  `pipeline/season-fit.ts`):
  - `ALPHA = 0.01` — process noise Q = ALPHA × measurement noise R, per component
  - `KAPPA = 0` — adaptive-gain strength (off)
  - `RHO = 0.6` — cross-season carryover strength
  - `eventGapInflation = 3.0` — extra variance kick at event boundaries
  - `adaptDecay = 0.7` — EWMA decay for the drift tracker
  - Prior mean/variance and measurement noise estimated per season from data
    (`pipeline/priors.ts`)
- **Sigma1** — first v3 iteration. Same model family, but hyperparameters are
  **tuned and adjusted automatically** (auto-tuning harness), starting from
  the Sigma0 values above.

### Teams page

All teams, ranked. Columns: team number, name, rank, metric(s), record, win
rate. Click through to a team page.

### Team page

- Team name, robot image for the selected year, link to The Blue Alliance page.
- Current season stats: record, win rate, metrics, etc.
- A section per event (attended or upcoming). Finished events show metrics as
  captured at the moment the event ended. Every event lists that team's
  matches: teams on both alliances, predicted winner, prediction confidence,
  predicted rank points (with variance), predicted scores, actual scores,
  actual rank points.
- Second tab: plot of the team's metrics with matches on the x-axis.

### Events page

All events for the selected year. Sortable/filterable by week, country, state,
and district.

### Event page

Tabs: **Insights**, **Breakdown**, **Quals matches**, **Alliances**,
**Elimination matches**, **Simulation**.

- Insights: teams ranked at that event (same columns as the Teams page,
  scoped to event attendees).
- Alliances: combined metrics of each alliance's teams.
- Simulation: user picks a start match; simulate the remaining qual matches
  1000× using predicted winner, confidence, predicted rank points, and RP
  variance to produce a rank distribution.

### Compare page

Table of prediction accuracy per algorithm, per year.

## Lessons carried forward (v1 + v2 retrospectives)

- Evaluation first: Brier-scored, walk-forward backtests with a Statbotics
  comparison must exist before model iteration ("measurably better than
  Statbotics").
- Predict-before-update sequencing everywhere; never leak the outcome.
- Precompute; never recompute a season per page load.
- Don't build unidentifiable models (v1's 4D EPA/defense/time model collapsed
  because its only observable was allianceScore/3).
- TBA API v3 with ETag caching worked well; keep it.
- Keep README and docs in sync with the shipped model; write tests.
