---
status: complete
quick_id: 260905-tll
date: 2026-09-06
commits: 73a0fd90, 9894dc8e, 6d25f140, 53beaadb, a1ac3057, bede79d3, 32f35ab9, c76f5a2d
---

# Quick Task 260905-tll — Pre-schedule rank simulation

## What shipped

The Simulation tab now opens on a pipeline-computed rank distribution for every covered event,
before any schedule exists and regardless of whether the event has started. The slider gained a
leftmost **"Before schedule release"** stop; the run button became **"Update simulation"**.

The pipeline prices K=20 seeded synthetic qualification schedules per event with the exact
Sigma1/VPR joint-covariance RP model, bakes a 1,000-draw rank distribution from them, and
publishes both as a lazily-fetched sidecar at `v1/presim/{eventKey}/{algorithmId}@{version}.json`.
The browser decodes the baked histograms — pure unpacking, no Worker, no Monte Carlo — so the
tab's first paint costs zero client compute. Picking any qualification match and pressing the
button runs the existing client engine from there; returning to the pre-schedule stop and
pressing it re-shows the baked result without starting a run.

Events whose schedule has not been posted now have event pages at all for the first time, with
rosters read from the corpus `event_teams` table.

## Origin — a challenged assumption

The task began with the assessment that a pre-schedule simulation could not be computed in the
browser. The user challenged that and asked how Statbotics does it. Reading their source
(`frontend/src/pagesContent/event/[event_id]/{simulation.tsx,worker.ts}`) showed they ship
exactly this feature — a slider whose `-1` position renders "Before Schedule Release" — computed
entirely client-side, by fetching Team 254 cheesy-arena schedule templates at runtime, reshuffling
team-to-slot assignment on all 1000 draws, and pricing each match from four scalars per team with
every ranking point treated as an independent coin flip.

So the browser is capable; **SigmaScout's model is what is not portable.** Its RP distributions
need per-team belief vectors plus covariance and cross-covariance blocks, pushed through a
Cholesky-factored 2000-draw joint Monte Carlo — state published nowhere, and two locked decisions
(Phase 7 D-11, Phase 8 D-01) keep that computation where the covariance lives. The user chose to
keep the exact model and move the computation to the pipeline rather than ship a cruder
independence approximation in the browser. Statbotics' design still shaped the result: their
schedule-template source and their per-draw shuffle are both adopted.

## Three structural properties worth carrying forward

*(Carried from the earlier summary written before the code review, so they are not rediscovered.)*

1. **The sidecar is deliberately not a `PageKind`** — own key function, own uploader array, own
   size-summary line, absent from `computeSizeStats` and from `payloadBudget.test.ts`'s
   `PAGE_KINDS` gate. That single choice is what structurally prevents the live Worker (whose
   artifact writer is keyed on `PageKind` and never deletes) from clobbering a sidecar mid-event,
   and it leaves the event artifact's reachable 350,000-byte ceiling untouched.
2. **The exact-model requirement is honoured structurally, not by convention** —
   `preSchedule.ts` never imports or touches a model. It only calls back into the caller's bound
   `predict()`, so no independence approximation can exist inside it even by accident.
3. **Determinism comes from a seeded hash** of event key, algorithm version, and schedule index.
   The platform RNG is never imported, and no clock reaches published bytes, so republishes are
   byte-stable.

## Decisions worth knowing

**PD-02 — "freeze once the schedule lands" is a source-of-state switch, not an R2
read-before-write.** An event with at least one qualification row in the corpus has had its
schedule land, so its sidecar is priced from walk-forward pre-event state — which is stable
across republishes because it is a function of the corpus prefix, not of the run. No `get`
before every `put`. **This was a deliberate reading of the stated requirement; reject it if the
literal do-not-overwrite mechanism was meant.**

**PD-03 — surrogates are priced but earn no ranking credit.** A surrogate is included in the
alliance handed to `predict()` (it plays, so it affects the alliance's RP) and excluded from the
team list handed to `simulateRanks`. Matches real FRC rules.

**Two research findings overrode earlier assumptions:**

1. **The cheesy-arena templates are not MIT-licensed** and their licence does not permit
   redistribution from a public repo. They are cached into gitignored `data/schedule-templates/`
   and fetched by `pnpm fetch:schedule-templates`, never committed — the same reason Statbotics
   fetches them at runtime. The earlier "vendor them with attribution" plan rested on a factual
   error about the licence.
2. **`event_teams` was district-only** — 150 of 310 2026 events, zero regionals or
   championships, because the fetch sat inside the `--districts-only` loop. Left alone, the
   scheduleless-page deliverable would have covered 2 events. The ingest was widened to every
   official event.

**Copywriting Contract deviations** (both recorded in the code, not left to read as drift):
`RUN_LABEL_IDLE` and `RUN_LABEL_RERUN` collapse into a single `RUN_LABEL_UPDATE` — both old rows
assumed the tab opens with nothing computed, which is no longer true. New minted strings:
`PRE_SCHEDULE_STOP_LABEL` ("Before schedule release", named verbatim in the requirements) and
`preScheduleScopeText()`, which carries no `±` glyph because Phase 7 D-01 reserves it for one
standard deviation of predictive variance and a rank distribution is a different quantity.

## Deviations from the plan

**The default selection is derived at render time, not captured in a lazy initializer** as the
plan specified. The initializer would have broken the primary requirement: the sidecar is fetched
lazily and lands *after* the tab first mounts (Radix keeps it mounted-but-hidden on every event
page), so the initializer would already have committed to a match selection, and the baked result
would only have been the opening view on a warm cache. PD-07's actual guarantee — a chosen start
match never moves under the reader — is preserved by keeping the captured default match key and
letting an explicit choice outrank it. An existing test caught the first attempt at this, which
also made the match default recompute.

Tasks 1–2 recorded three minor disclosed deviations of their own (a stricter surrogate-flag parse
check, a missing-template test coordinate outside the cached grid, and `toSimMatchInput` exported
as a testable seam).

## Review findings and fixes

A code review found 14 items; the three blockers were fixed and regression-tested before this
task closed (commit `c76f5a2d`). Four of the six areas flagged for scrutiny came back clean,
including the pre-event state capture's correctness and the absence of state aliasing.

- **CR-01** — a pending sidecar fetch suppressed *both* Simulation-tab guards on every event, and
  the route fetches a sidecar for every VPR event regardless of season. In that window an
  offseason event rendered an **enabled run button** over the exact inputs the unavailable state
  exists to refuse, and a qualification-less event rendered a picker with no controls in it. Now
  the tab renders its skeleton while a guard would otherwise fire, and an event that clears both
  guards still renders immediately.
- **CR-02** — pressing Run left the selection derived, so a sidecar resolving mid-run flipped the
  tab to the pre-schedule stop: the run control counted draws while the table showed baked data
  for a different start point. Pressing the button now commits the selection it computes.
- **CR-03** — an event whose schedule had just landed but which had not started was skipped
  entirely, leaving its previous sidecar serving unchanged through the whole pre-event window —
  precisely when the tab is most wanted. When no match has been played, the state before the event
  *is* the state now, so it is priced from current state and keeps regenerating; only the genuine
  cold-start first event is skipped.
- **WR-01** — the sidecar schema documented that it makes `MalformedRankHistogramError`
  unreachable but enforced no roster uniqueness; a duplicate key would have thrown in front of a
  reader. Now refined.

Remaining warnings are recorded in `260905-tll-REVIEW.md` and were not fixed here: notably
`matchesPerTeamFor`'s floor-of-1 (a single ingested qual row yields a near-uniform distribution),
the fetch script's moving-`main` pin and non-resumable truncated writes, and `event_teams` being
upsert-only so withdrawn teams keep receiving forecasts.

## Verification

- Repo-root test suite: **201 files, 3,665 tests passing** (4 skipped).
- Root and `apps/web` typechecks both clean. Note that root `tsc` does **not** cover `apps/web` —
  the web typecheck caught two real errors the root one missed, including deleted constants still
  imported by a test file whose assertions had been silently matching any button.
- Two failures observed during the final full run (`carryover.test.ts`,
  `seasonParamSets.test.ts`) belong to **another session's** in-progress experiment: quick task
  260906-6zc has working-tree-only scaffolding in `packages/core/algorithms/sigma1/carryover.ts`
  that hardcodes `carryMeanReversion`. Confirmed by stashing. That file was deliberately left
  untouched and excluded from every commit here.

## Follow-ups (orchestrator/user, all require network)

1. **Run `pnpm fetch:schedule-templates`** on any other machine that will publish — the cache is
   gitignored and exists only locally here.
2. **Run a season republish** to actually generate sidecars. Nothing exists in R2 yet; the feature
   ships as code, schemas, and tests only.
3. **Transcribe the real `presim:` size line** into `docs/publish-budget.md` after that run. The
   doc currently states plainly that its ~160 KB figure is a hand-computed projection, not a
   measurement, and carries no `presim` row in the machine-readable block.
4. **Run the widened `event_teams` ingest** so non-district events gain rosters.
5. **Verify against live origin** once published, then re-check the Simulation tab in a browser.
6. Decide whether to backfill sidecars for 2022–2025 (the season cutoff is a parameter,
   `--presim-from-season`, defaulting to 2026).
