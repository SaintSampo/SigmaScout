---
phase: quick-260905-tll
plan: 01
subsystem: pipeline+ui
tags: [harness, publish, r2, zod, ingest, react, web-worker, rank-simulation]

requires:
  - phase: 08-simulation-compare
    provides: "rankSimulation.ts (draw/accumulate/rank core, mulberry32, SimMatchInput/SimTeamBaseline), the SimulationTab shell, StartMatchPicker and RunControl"
  - phase: quick-260905-jj8
    provides: "per-bonus RP arrays on event match rows — live as of generation f4f8f379"
provides:
  - "v1/presim/{eventKey}/{algorithmId}@{version}.json — the pre-schedule rank-simulation sidecar (K=20 seeded synthetic schedules + a baked 1,000-draw rank distribution)"
  - "buildPreScheduleArtifact in packages/harness/preSchedule.ts — the pure builder (no corpus, no R2, no filesystem beyond the template reader, no wall clock)"
  - "loadScheduleTemplate + scripts/fetchScheduleTemplates.ts — gitignored cheesy-arena template cache in data/schedule-templates/"
  - "event_teams ingest widened from district-only to every official event (C-16)"
  - "Scheduleless event pages: roster from event_teams, as-of-now metrics, live Simulation tab"
  - "Client: lazy sidecar fetch (404 → null, every other non-ok throws), baked-result decode, 'Before schedule release' picker stop, 'Update simulation' relabel"
affects: [event-page, simulation-tab, publish-pipeline, ingest, publish-budget]

actuals:
  tasks: 6
  commits: 7

tech-stack:
  added: []
  patterns:
    - "The sidecar is deliberately NOT a PageKind — own key fn, own uploader array, own size-summary line, absent from computeSizeStats and payloadBudget.test.ts's PAGE_KINDS gate"
    - "C-04 honoured structurally: preSchedule.ts never touches a model, only calls back into the caller's bound algorithm.predict(), so no independence approximation can exist there"
    - "Determinism by seeded hash of eventKey/algorithmVersion/schedule index — the platform's non-seedable random source never appears in the module"

key-files:
  created:
    - packages/harness/preSchedule.ts
    - packages/harness/scheduleTemplates.ts
    - scripts/fetchScheduleTemplates.ts
    - packages/ingest/eventTeams.ts
    - apps/web/src/lib/api/preSchedule.ts
    - apps/web/src/lib/preScheduleResult.ts
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - packages/ingest/cli.ts
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/StartMatchPicker.tsx
    - apps/web/src/components/event/RunControl.tsx
    - apps/web/src/routes/event.$eventKey.tsx
    - docs/publish-budget.md
---

# Quick task 260905-tll — pre-schedule rank simulation pipeline

## What shipped

An event's Simulation tab can now show a rank distribution **before that event's schedule
exists**. The pipeline bakes K=20 seeded synthetic qualification schedules per event, prices every
synthetic match through the same joint-covariance RP path real matches use, runs 20 × 50 = 1,000
draws, and publishes the result as a sidecar at
`v1/presim/{eventKey}/{algorithmId}@{version}.json`. The tab renders that baked result as its
default view with **zero client compute on first paint**; picking any later start match runs the
existing browser engine as before.

All six tasks are committed:

| Task | Commit | What |
|---|---|---|
| 1 | `73a0fd90` | Schedule-template cache reader, fetch script, presim key + Zod schema |
| 2 | `9894dc8e` (RED) → `6d25f140` | The pure sidecar builder |
| 3 | `53beaadb` | `event_teams` ingest widened to every official event (C-16) |
| 4 | `a1ac3057` | `publish.ts`: pre-event walk-forward state, scheduleless artifacts, sidecar upload |
| 5 | `bede79d3` | Client data layer — lazy fetch, baked-result decode |
| 6 | `32f35ab9` | Baked default view, "Before schedule release" stop, "Update simulation" |

## Decisions worth carrying forward

**The sidecar is deliberately not a `PageKind`.** It carries its own key function, its own uploader
array and its own size-summary line, and it is absent from both `computeSizeStats`' per-kind
accounting and `payloadBudget.test.ts`'s `PAGE_KINDS` gate. Three properties follow structurally
rather than by convention: the live Worker (whose artifact writer is keyed on `PageKind` and never
deletes) **cannot clobber a sidecar during an event** — C-18; the deliberately-reachable 350,000-byte
event-page ceiling is unaffected; and no `pages.presim` row belongs in the budget doc's
machine-readable block.

**C-04 is honoured structurally, not by promise.** `preSchedule.ts` never touches a model — it only
calls back into whatever `algorithm.predict(state, match)` the caller has already bound to the right
walk-forward state. Because no pricing math exists in the module, no browser-style independence
approximation *can* exist there. Every published pmf comes from the same joint-covariance path a
real match uses.

**Determinism is by construction.** Every value that varies between runs is either passed in
(`generation`, `computedAt`) or derived from a seed that is itself a pure hash of
`eventKey`/`algorithmVersion`/schedule index. The platform's non-seedable random source never
appears in the module, so republishing the same corpus twice produces byte-identical sidecars.

**Two different meanings for a missing pmf, deliberately not collapsed.** An absent pmf on the
*first-match probe* is the ordinary "this algorithm does not model ranking points here" answer and
returns `null`. An absent pmf *partway through* a schedule is genuine corruption — an algorithm
cannot change its mind between two structurally identical synthetic matches — and throws
`PreSchedulePricingError`.

**A 404 on the sidecar returns `null`, and every other non-ok status throws.** That is what makes
the client degrade to the existing pre-run placeholder for an event with no sidecar (including every
algorithm with no RP model at all) while still surfacing a real transport failure instead of
silently showing an empty tab.

## Honest limits

**No measured byte figures exist yet.** The only number available is a pre-implementation
projection from the research pass — roughly 160 KB raw at a 43-team, 86-qual event under
roster-index encoding, at a 2026 pmf length of 7. That is a hand computation from the schema, not a
reading off a publish run. `docs/publish-budget.md` deliberately carries no `presim` table and no
machine-readable row until the first sidecar-generating republish, at which point
`publish:seasons`' own `presim: count=… median=… p95=… max=…` line should be transcribed by hand.

**Nothing is live.** Verified 2026-09-06: every `v1/presim/...` key returns **404** against
`data.sigmascout.org`. The entire baked default view is dark until the next full republish. The
client's 404 fallback means the tab degrades to its pre-run placeholder rather than breaking, so
the deployed site is correct — just not yet showing the feature.

## Follow-ups

1. **A full republish** generates the sidecars and produces the first real byte figures. Same run
   should also pick up 260905-ttv/ldu's `country`/`stateProv`/`districtKey` teams-artifact fields,
   which are equally written-but-not-published.
2. **Transcribe the `presim` summary line** into `docs/publish-budget.md` by hand after that run —
   `publish:seasons` prints it but does not write the doc.
