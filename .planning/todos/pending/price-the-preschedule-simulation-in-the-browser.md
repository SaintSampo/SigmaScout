---
id: price-the-preschedule-simulation-in-the-browser
created: 2026-09-12
source: Phase 9 verification (3b0d248c) — clause 4 failed; this is the part that was amended out of the goal
resolves_phase: 9
priority: medium
---

# The pre-schedule simulation is still not priced in the browser

This is the remainder of Phase 9's original fourth goal clause, carried forward when that clause was
amended on 2026-09-12 rather than left to quietly disappear. See the amendment note under
`### Phase 9` in `.planning/ROADMAP.md` for the full record.

## What verification actually found

Not a matter of degree. `grep -c "analyticRpPmf|negativeBinomial"` against the deployed bundle
returns **0**. `apps/web/src/lib/preScheduleResult.ts` is still the baked decoder — its own header
says "no fetch, no Worker, no Monte Carlo" — and rebuilds `{rankHistograms, draws}` from
`artifact.baked` alone. The browser does **zero** compute on this stop. It renders a histogram that
was computed offline.

## The three routes, and where each stands

From `docs/simulation-architecture.md` §5:

- **Route A — ship the priced schedules, let the browser draw.** **FORECLOSED BY LICENCE.**
  `data/schedule-templates/LICENSE` (Team 254, 2014) permits redistribution only for contributing
  upstream and forbids redistributing modifications without permission. Shipping the grids, or
  anything containing them, to visitors is not permitted. This was established 2026-09-12 and is the
  reason route A can never be the answer, independent of effort.
  **Note this is narrower than it sounds** — it forecloses shipping *the licensed grids*. It does
  not foreclose shipping a *generated* structure, which contains nothing of theirs.
- **Route B — ship a generated structure and let the browser draw.** Open, and now the most likely
  path. D-19 was answered **no** on 2026-09-12 (a generated schedule does not violate the licence:
  nothing is copied, and the appearance-count convention it follows is FRC game-manual behaviour,
  not Team 254's expression), so `drop-licensed-schedule-templates` is unblocked. Once the generator
  is wired in, the structure being shipped is ours.
- **Route C — ship per-team pmfs and let the browser convolve.** Open. Smallest payload of the
  three. Would need the pmfs back on the wire.

## The obstacle this phase created for itself

`260912-2ur` stopped publishing the priced `schedules` block, taking the sidecar from ~388 KB to
~12 KB. That was the right trade — 96.8% of what a visitor downloaded was never read — but it means
**routes B and C now require publishing something the sidecar deliberately stopped publishing.**
The per-match pmfs still exist in the in-memory builder shape; they are simply no longer on the
wire. Re-adding them for the browser is a real cost, not a free reuse, and it should be priced
against what browser-side pricing actually buys before anyone builds it.

## What browser-side pricing would buy

Worth stating plainly, because it may not be worth the bytes:

- reader-chosen draw counts instead of a fixed 1,000
- visible schedule-to-schedule spread, which the pooled `baked` histogram averages away
- the ability to re-rank from a reader-chosen starting point without a republish

Against that: the baked path renders a full rank table with **no compute at all**, which is the
fastest possible first paint on the page whose stated top priority is load speed.

**So this is not obviously worth doing.** It is filed because it was promised, and because the
decision to not do it should be made on its merits and recorded, rather than by it being forgotten.

Related: [[drop-licensed-schedule-templates]], [[preschedule-schedule-count-and-acceptance-bar]].
