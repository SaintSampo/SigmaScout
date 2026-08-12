# SigmaScout Rebuild Spec (v3)

Input document for `/gsd-new-project`.

## Clean slate — read this first

This is a **from-scratch rebuild**. Previous implementations of SigmaScout
exist in this repo's git history (tagged `v2-poc`) but they are **not** to be
consulted, ported, or used as a starting point — not the code, not the model,
not its tuned parameter values. Design every part of v3 on its own merits. If
independent reasoning arrives at conclusions similar to a past version, that
is fine; inheriting them is not. The only thing carried forward is the failure
log at the bottom of this document.

## Vision

The absolute best FRC match-predicting website possible. Feel and information
density comparable to statbotics.io, but faster: pages must load fast, and
when new match data is available the site should update as fast as possible.
Statbotics recalculates a team's whole EPA in the browser on page load — do
not do that. Precompute everything possible and ship compact data to the
browser.

## Stack and constraints

- React + Vite + Tailwind CSS. Mobile and desktop.
- Hosted on Cloudflare Pages.
- Live updating: when new match results land, the site reflects them as fast
  as possible.
- Most modern web features. Compact and efficient. Top priority: page load
  speed.
- Match data source: The Blue Alliance API v3.

## App structure

Top ribbon with three pages: **Teams**, **Events**, **Compare**. Plus:

- A prominent dropdown selecting the **match prediction algorithm**.
- A dropdown selecting the **year**.
- A search bar for teams or events.

### Algorithms and metrics

Each algorithm produces "metrics" (e.g. OPR, EPA, Sigma ratings). OPR and EPA
have no variance. All Sigma-family metrics model variance and display as
`X ± Y` where Y is 1 standard deviation.

- **Sigma1** — the first Sigma algorithm of this rebuild: a Kalman-filter
  approach with hyperparameters that are **tuned and adjusted automatically**
  (an auto-tuning harness, not hand-picked constants).
- There will be multiple future iterations (Sigma2, Sigma3, …). The site must
  support viewing and comparing past algorithm versions side by side, so
  algorithm versioning is a first-class concept in the data model.

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

## What didn't work before (failure log)

These are the failures from prior attempts. They are constraints on v3, not
designs to copy.

- **No evaluation harness.** Model iteration happened with no Brier-scored
  backtests and no head-to-head comparison against Statbotics. v3's goal is to
  be *measurably* better than Statbotics — the measuring stick (walk-forward
  backtests, proper scoring rules, Statbotics comparison) must exist before
  model work begins, and it is also what automatic hyperparameter tuning
  needs as its objective.
- **Unidentifiable model.** A 4D per-team model (offense/defense/time
  allocation) collapsed because its only observable was the alliance score —
  the parameters could not be separately identified. Never give a model more
  latent structure than its observations can pin down.
- **Outcome leakage risk.** Prediction accuracy is only honest if every
  prediction is made strictly before the outcome is folded in
  (predict-before-update, walk-forward everywhere).
- **Recompute-per-request architecture.** Recomputing a whole season's
  statistics on page load (or per server request) made everything slow.
- **Documentation drift and zero tests.** The README described a model that
  had been deleted; nothing was tested. Docs must track the shipped model;
  tests are not optional.
- **Repo hygiene.** node_modules and cache directories were committed early
  on; keep generated artifacts out of git deliberately.
