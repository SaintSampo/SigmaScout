# Phase 10: District points ledger - Research

**Researched:** 2026-09-25
**Domain:** FRC district point simulation (browser Web Worker + offline pipeline + live Worker refresh), React/TanStack table UI
**Confidence:** MEDIUM-HIGH — the artifact/data model and the point-formula math are directly verified against code and the real corpus; the browser win-probability mechanism for arbitrary alliances is a genuinely new build with no existing implementation to copy.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Freshness (Jacob, 2026-09-25): live, like the rest of the site**
- The live Worker tick fetches TBA `/district/{key}/rankings` for every district with a live
  window and republishes `v1/district/{key}.json` when the rankings changed (ETag conditional
  request like every other TBA poll). One request per live district per tick.
- The district artifact gains, per team per event, the state the page needs to decide grey vs
  blue: qualification matches played and total, whether alliances are picked, whether playoffs
  are done, whether awards are posted. The Worker knows all four at fold time; the offline
  publisher derives them from the corpus.
- The browser polls the district artifact on the same 60 s floor as event artifacts while any
  of the district's events is current (`liveEvent.ts` rules).

**What the page computes where**
- **Pipeline (publish time):** per season, the award base-rate tables; per team per unstarted
  event, baked pmfs for the four categories and the event total (about 60 numbers per
  team-event, on the district artifact or a sidecar next to it, planner's call by byte budget);
  for finished events, actual points only.
- **Browser (Web Worker):** every event in progress and every slider move. One joint run:
  the existing rank simulation (`simulateRanks` over the event artifact's remaining matches and
  their RP pmfs) produces a ranking; the top eight are captains; picks are greedy by SPR among
  non-captains; the double elimination bracket is priced from SPR alliance means and variances
  using the same win-probability form the rank simulation uses; each run yields (qual,
  selection, playoff) per team. Histograms are marginals of the same runs. The event total is
  the per-run sum. The grand total is the convolution of the two event totals plus rookie bonus
  and adjustments.
- **Cloudflare Worker:** never simulates. Its only new job is the district rankings refresh
  above.

**Awards (Jacob): base rates by decoration bucket**
- A walk-forward table per season: for buckets of prior judged awards (none, one or two, three
  or more) crossed with rookie status, the chance of any award points at a district event and
  the distribution over point values (0, 5, 8, 10, 13, 15+). Measured from the corpus using only
  seasons before the scored season, pinned by a test, stated on the methodology awards page in
  its voice (flat third person, no dash characters, see `feedback_methodology_copy_voice`).
- Impact and Rookie All Star ordering tables are NOT in this phase.
- No award prediction ever feeds the `locks.ts` guarantee. A Locked verdict stays a guarantee.

**Status: Jacob's five definitions (chips, with the definition as tooltip and in a legend row)**
- **Prequalified**: prequalified by FIRST. Purple chip.
- **Locked**: mathematically qualified no matter what, on district points or an award
  (`locks.ts`; an Impact winner consumes a slot only when it would not qualify on points).
  Green chip, "Locked · award" when an award is the reason.
- **In range**: if every team earned the median of its own predicted grand total, this team
  would qualify. Outlined chip.
- **Out of range**: under that same median projection, this team would not qualify. Muted
  outlined chip.
- **Locked out**: cannot earn enough district points to qualify (the `locks.ts` elimination
  case). RED chip, Jacob's explicit choice; the data status `eliminated` is never printed.
- Chips double as filters with live counts.

**What a blue cell prints (round four)**
- Qualification, event total, grand total: the median in bold, "likely a to b" beneath, where
  likely is the 10th to 90th percentile with continuous edges (sketch 005).
- Alliance selection, playoffs, awards: the chance of any points in bold ("80% picked",
  "66% play", "44% award") and the typical amount when it happens beneath ("~12 if picked", a
  conditional median). Above a 99.5% chance the cell falls back to the median form.
- Never a ± on any of these. The drawer under the team shows the histogram with the exact
  percentiles, beside the grand total histogram with today's line (the 50th team's earned
  points, labelled as a floor).
- A grey cell is a single earned number. Grey and blue never rely on hue alone.

**Table shape (variant A, after rounds two and three)**
- Two rows per team, one per district event, in week order. Columns: Team (number, nickname,
  position, earned, median when open), Status, Event (name, week, stage word), Qualification,
  Alliance selection, Playoffs, Awards, Event total, Grand total (spans both rows).
- Rows sorted by the median of each team's predicted grand total; a finished team sorts by its
  actual total. The position number is that order.
- Hairline separators only. Jacob tried heavy rules between team blocks and dropped them.
- Sticky first column, horizontal scroll inside the card at phone width (the shipped table
  pattern with its scroll arbitration).
- Team number search, status filter chips, a stat line (today's line, open cells).
- The tab label is "Road to District Champs". The old District Locks table is removed.

**The slider**
- Label "Rewind to". Steps by match across the district's interleaved timeline (sort by
  `sortTime`), with alliance selection, playoffs and awards as stages after each event's last
  qual match. Jump chips for season start, after each week, and now.
- Rewinding into a finished event reopens its later categories (the rank simulation already
  rewinds into played matches because played rows carry `redRpPmf`/`blueRpPmf`), and statuses
  recompute at every position.

**Alliance selection and captains**
- Once quals are done the top eight hold a captain floor of 17 minus their alliance number;
  the cell must read as a near-certain number then, not a chance. Once alliances are announced
  the cell is grey.
- Points: captain and first pick 17 minus alliance number, second pick 9 minus alliance
  number (the district point model; ceilings 22 / 16 / 30 / 15 from
  `packages/core/districts/pointModel.ts`). Playoff points per bracket exit (0, 7, 13, 20, 30).
  Qualification points from the manual's inverse error function formula on rank and field size.
  **See Section 5 below — the "second pick 9 minus alliance number" half of this locked
  decision is directly contradicted by the real corpus; see the flagged correction.**
- The selection model's agreement with actual pick order is measured on `event_alliances` in
  the corpus before it ships and stated on the methodology page.
- Only the 2023+ double elimination bracket is simulated; earlier seasons have no open
  categories and need no bracket.

**Process rules that apply (from memory, binding)**
- Deploy the Worker BEFORE the republish. `npx wrangler deploy` from a clean tree; Jacob grants
  the deploy in-message. Publishes, live-origin checks and pushes run from the main context;
  executor subagents have no network.
- Run vitest from the repo root, and check both tsconfigs. After the push, watch `gh run list`.
- Additive artifact fields do not bump `PAGE_ARTIFACT_SCHEMA_VERSION`; changed published numbers
  ship under a new version. Zod schemas are the executable spec of every new field.
- Every colour is a token; no literals in component code. Run the dataviz palette validator
  before any new palette entry (the red Locked out chip is a status colour, not a series).
- Never render a partial variance; never print a ± for a percentile range.
- A `|` in a STATE.md quick-task description breaks the helper; keep pipes out of descriptions.

### Claude's Discretion
- Whether baked pmfs live on the district artifact or a sidecar (decide by measured bytes
  against the page's budget).
- The exact selection model details beyond greedy-by-SPR (a small decline rate is fine if
  measured), the bracket seeding table, and the RNG seeding for determinism.
- Web Worker protocol shape for the district run, and how the district page loads only the
  event artifacts it needs.
- Copy for the drawer and the definitions row, within the methodology voice rules.

### Deferred Ideas (OUT OF SCOPE)
- The Champ Locks tab (unchanged).
- An advancement chance number (needs the line's own distribution, a later phase).
- Impact and Rookie All Star ordering tables (later).
- A per-team page for district points.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| Roadmap SC-1 | Live category completion turns grey within freshness window via Worker refresh | Section 2 — the Worker currently has NO district capability at all; PageKind excludes districts; exact fetch/merge/write design given |
| Roadmap SC-2 | One joint per-run browser simulation (rank → captains/picks → bracket), award pmf from base-rate tables, event/grand total as exact sums/convolution | Section 3 — `simulateRanks` only returns aggregated histograms today (per-run correlation is discarded); a same-draw hook is required; no existing browser formula prices an arbitrary alliance pair |
| Roadmap SC-3 | Five-status model from `locks.ts` plus a median-projection In range/Out of range | Section 1 (locks.ts, pointModel.ts, qualification.ts read in full) — reusable as-is |
| Roadmap SC-4 | Slider rewinds by match across the interleaved district timeline; finished-event categories reopen | Section 3/8 — `simulationInputs.ts`/`isRewindStart` pattern is directly reusable |
| Roadmap SC-5 | Zero simulation compute for finished/unstarted events; browser simulates only events in progress and on slider moves | Section 4 — presim sidecar pattern (`preSchedule.ts`) is the offline-bake precedent |
| Roadmap SC-6 | Selection model measured against `event_alliances`; award base rates measured walk-forward, both pinned by tests and stated on methodology page | Section 5, 6, 9 — exact corpus columns, existing walk-forward script pattern, and the methodology content module to extend |
| Roadmap SC-7 | Repo-root vitest green, both tsconfigs clean, CI green, district artifacts republished, Worker deployed before republish, live e2e covers the new tab | Section 10 |
| sketch 021 README feasibility section | Every claim in the "Feasibility" section evaluated against current code | Section 3 — one central feasibility claim ("SPR prices any three-robot alliance against any other in the browser today") is **stale/false as of 2026-09-25**; flagged prominently |
</phase_requirements>

## Summary

This phase turns the District Locks tab into a live-simulated ledger. The point-model math
(qualification formula, alliance-selection formula, playoff-bracket routing and its points) was
independently verified against the real corpus in this session — three concrete, high-value
corrections came out of that verification, most importantly that CONTEXT.md's stated
second-pick alliance formula ("9 minus alliance number") is **empirically wrong**; the real
value is the alliance number itself, with zero exceptions across four seasons of corpus data.
The full 13-match, 8-alliance double-elimination bracket routing was reconstructed exactly from
two independent real events (2025, 2026) and matches perfectly; the round-to-points mapping
(0/0/7/13/20/30) was independently confirmed against ~20,000 corpus rows.

The bigger risk in this phase is architectural, not mathematical. Two of the sketch README's
central feasibility claims do not hold against the code as it exists today:

1. **District artifacts are not live-Worker-writable today.** `packages/harness/pageArtifacts.ts`
   explicitly and deliberately excludes `district`/`districtsIndex` from `PageKind` — "district
   artifacts are neither live-written by the Worker... nor part of a per-season replay. Widening
   `PageKind` here would force a Worker change that buys nothing." That "nothing" is now this
   phase's SC-1. The Worker also has zero district-awareness anywhere in its source (no
   `districtKey`, no district live-windows manifest) — this has to be built from scratch, and the
   Worker cannot rebuild a full district artifact the way the offline publisher does, because it
   has no corpus access (no team registrations, no award ingest, no team nicknames beyond what a
   prior artifact already carries).

2. **The browser cannot currently price an arbitrary 3-robot alliance against another.** The
   README's Feasibility section states this capability "already exists" via "the embedded state
   block that prices upcoming matches." That mechanism (quick task 260915-isq) was **built and then
   deleted** eight days before this sketch session, by quick task 260923-3w6 (2026-09-23), which
   moved upcoming-match pricing back to the Worker specifically because Workers Paid made that
   affordable again. `apps/web/src/lib/simulationInputs.ts` and `simulation.worker.ts` only ever
   consume **precomputed per-scheduled-match pmfs** published by the pipeline/Worker; there is no
   code path today that takes two arbitrary team rosters and produces a win probability in the
   browser. This has to be built new, from `EventTeamSchema.metrics["total"].value` (mean score)
   and `metrics["sigma"].value` (Sigma Score), and it will NOT be the same quantity SPR's own
   `predict()` produces (that function uses internal, unpublished `mu`/`pv`/`tau`/`obsSd` state) —
   this is exactly the kind of "band from only part of the variance" trap
   `uncertainty-display.md` warns about, applied to a genuinely new formula rather than a display
   choice.

**Primary recommendation:** treat Worker district-refresh and browser arbitrary-alliance-pricing
as the two hardest, highest-risk sub-problems in this phase and plan them first, with explicit
verification tasks (a corpus-backed test for the point formulas, following
`reconciliation.test.ts`'s exact pattern; a measured-calibration check for the new alliance win
probability, following the Compare page's own "state the honest limit" discipline). Everything
else — the table UI, the slider, the status chips, the drawer — has a directly reusable
precedent already shipped in this codebase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Qual/selection/playoff point formulas (pure math) | packages/core (shared) | — | Already the pattern: `packages/core/districts/*` is pure, no I/O, importable by both the Node pipeline and the Worker |
| District rankings live refresh | Cloudflare Worker | — | TBA polling with ETag is a Worker-only capability today (`tbaPoll.ts`); locked decision requires it live |
| Baked category pmfs for unstarted events | Node pipeline (offline) | R2 artifact/sidecar | Mirrors `preSchedule.ts`'s existing pattern exactly; has full corpus + real algorithm state, unlike the Worker or browser |
| Joint (qual, selection, playoff) simulation for live events | Browser Web Worker | — | Locked decision; needs a NEW same-draw hook into `simulateRanks` and a NEW alliance-pricing formula (neither exists yet) |
| Award base-rate tables | Node pipeline (offline) | Methodology page (display) | `event_awards_all` + `measureAwardPredictability.ts`'s walk-forward pattern is the direct precedent |
| Status chips / locks verdicts | Browser (client-side recompute) | packages/core/districts/locks.ts | `locks.ts` is pure and already Worker/browser-importable; In range/Out of range is a NEW median-projection variant of the same math |
| Table UI, drawer, slider | Frontend (React) | — | Directly extends `RankDistributionTable.tsx`/`rankRows.ts` (continuous quantile) and the Simulation tab's Web Worker lifecycle pattern |
| District artifact schema | packages/harness (shared) | R2 storage | `pageArtifacts.ts` is the single schema source for both the offline publisher and (new) Worker writer |

## Standard Stack

No new external packages are required. Every piece of this phase composes existing in-repo
modules (React, TanStack Router/Query, Zod, Vitest — already fixed by the project). See
`Package Legitimacy Audit` below: N/A, no new packages recommended.

### Installation
Not applicable — no new dependencies.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new external packages; the design is built entirely
from packages already present in `package.json` (react, zod, vitest, @tanstack/react-query,
@tanstack/react-router — all already verified current by the project's own Technology Stack
doc, re-verification not repeated here). If a planner later decides a numerical/statistics
helper is warranted (e.g. for the erf/erfinv implementation — see Section 5), note that
`packages/core/algorithms/spr.ts:360` already carries a hand-rolled `erf()` (Abramowitz–Stegun
approximation) that should be reused/extended rather than adding a new dependency for this.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              TBA API (external)              │
                    └───────┬───────────────────────┬───────────────┘
                            │ /district/{key}/rankings │ /event/{key}/matches (existing)
                            ▼                       ▼
   ┌────────────────────────────────┐   ┌──────────────────────────────────┐
   │  Cloudflare Worker (cron tick)  │   │  Node pipeline (offline, manual)  │
   │  NEW: per-live-district poll    │   │  publishDistricts.ts (existing)   │
   │  merge into existing R2 object  │   │  + NEW: bake per-team-event pmfs  │
   │  recompute locks.ts verdicts    │   │  for unstarted events, per-season │
   │  (pure, packages/core/districts)│   │  award base-rate tables            │
   └───────────────┬─────────────────┘   └──────────────┬────────────────────┘
                    │ write                               │ write
                    ▼                                     ▼
            ┌──────────────────────────────────────────────────┐
            │        R2: v1/district/{districtKey}.json          │
            │  (existing DistrictArtifactSchema + NEW fields:     │
            │   per-team-event state booleans, baked pmfs/sidecar) │
            └───────────────────────┬──────────────────────────┘
                                     │ fetch (TanStack Query, 60s poll while any event current)
                                     ▼
                    ┌───────────────────────────────────────┐
                    │   Browser: Road to District Champs tab  │
                    │  - finished/unstarted events: paint      │
                    │    directly from artifact, zero compute  │
                    │  - events IN PROGRESS: fetch that event's │
                    │    EventArtifact + presim sidecar,        │
                    │    dispatch to district Web Worker        │
                    └───────────────────┬─────────────────────┘
                                         │ postMessage
                                         ▼
                    ┌───────────────────────────────────────┐
                    │  NEW district simulation Web Worker      │
                    │  1. simulateRanks-derived joint draw     │
                    │     (needs new per-draw hook — see §3)   │
                    │  2. captains = top 8; greedy-by-SPR picks │
                    │  3. NEW alliance-vs-alliance win prob     │
                    │     from published Total + Sigma (§3)    │
                    │  4. price the verified 13-match bracket   │
                    │     (§7) through that win-prob formula    │
                    │  5. per-run (qual, selection, playoff)    │
                    │     → marginals = histograms, sum = total │
                    └───────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/core/districts/
├── pointModel.ts          # EXISTS: ceilings only
├── qualification.ts       # EXISTS: award-slot rules
├── locks.ts                # EXISTS: pure lock verdict math — reuse as-is
├── qualPoints.ts           # NEW: the erfinv formula, VERIFIED in this session
├── selectionPoints.ts      # NEW: captain/pick point formula, CORRECTED in this session
└── bracket.ts               # NEW: the 13-match routing table, VERIFIED in this session

packages/harness/
├── preSchedule.ts          # EXISTS: pattern to extend for baked category pmfs
└── pageArtifacts.ts        # EXISTS: DistrictArtifactSchema — extend with new fields

packages/core/algorithms/simulation/
└── rankSimulation.ts       # EXISTS: needs a same-draw hook (see §3) — do not fork it

apps/worker/src/
├── liveWindows.ts          # EXISTS: no district concept — needs a parallel district-liveness path
├── tbaPoll.ts               # EXISTS: pollEventMatches pattern to mirror for pollDistrictRankings
├── artifactWriter.ts        # EXISTS: PageKind-based; district needs its OWN writer (bypasses PageKind, like the offline publisher already does)
└── scheduled.ts              # EXISTS: runTick — needs a new per-live-district pass, structurally parallel to runProbes/processEvent but NOT reusing them (no event_cursor concept for districts)

apps/web/src/
├── workers/
│   ├── districtSimulation.worker.ts   # NEW, parallel to simulation.worker.ts
│   └── districtSimulationProtocol.ts  # NEW
├── components/districts/
│   ├── DistrictLedger.tsx              # NEW — replaces DistrictLocksTab.tsx's "district-locks" tab content
│   └── districtLedgerRows.ts           # NEW — sort-by-median-grand-total, status computation
└── lib/api/districts.ts     # EXISTS — needs live-polling (refetchInterval) added; currently a one-shot fetch
```

### Pattern 1: Pure math lives in packages/core, importable by pipeline, Worker AND browser
**What:** `packages/core/districts/locks.ts`, `pointModel.ts`, `qualification.ts` have zero I/O
and zero corpus import. `apps/worker/src/scheduled.ts` already imports `packages/core/algorithms/*`
directly (opr, spr, epa) — the same import discipline applies to any new point-formula module.
**When to use:** every one of the new point-formula functions (qual points, selection points,
bracket points) belongs here, not duplicated in the Worker or the browser.
**Example:**
```typescript
// Source: packages/core/districts/locks.ts (existing, read in full this session)
export function computeLocksWithQualifiers(
  teams: readonly LockTeamInput[],
  slots: number | null,
  qualifiers: QualifierSets
): LockResult[] { /* ... */ }
```

### Pattern 2: The offline publisher's `districtDetailKey`/`districtsIndexKey` bypass `PageKind`
**What:** `packages/harness/pageArtifacts.ts:1889-1901` states explicitly that district keys are
"deliberately NOT added to `PageKind`/`ArtifactKeyParams`," because district artifacts were
"neither live-written by the Worker... nor part of a per-season replay." A live Worker writer for
districts should follow the SAME bypass pattern the offline publisher already uses
(`putObject` directly with its own explicit schema parse), not force district into
`SCHEMA_BY_PAGE`/`ArtifactKeyParams`, which are typed as an exhaustive union other call sites
(`publish.ts`'s per-season budget) rely on staying closed.
**Example:**
```typescript
// Source: apps/worker/src/artifactWriter.ts (existing) — the read side is already generic:
export async function readArtifactObject(env: Env, counter: SubrequestCounter, key: string): Promise<string | undefined> {
  counter.spend(1);
  const object = await env.ARTIFACTS.get(key);
  if (object === null) return undefined;
  return object.text();
}
// A NEW writeDistrictArtifactObject should mirror writeArtifactObject's body (validate,
// secret-scrub, counter.spend, env.ARTIFACTS.put) but take DistrictArtifactSchema directly,
// keyed by districtDetailKey(districtKey) — never widen PageKind for this.
```

### Pattern 3: `simulationInputs.ts` — the exact "pure assembly, no simulate call" pattern to copy
**What:** `apps/web/src/lib/simulationInputs.ts` is a pure module that turns a parsed
`EventArtifact` + a chosen start match into `simulateRanks`'s arguments, with explicit,
disclosed honesty gaps (`excludedMatchKeys`, `incompleteBaselineTeamKeys`,
`baselineSources: ReadonlyMap<string, BaselineSource>`). The district joint-run assembly should
follow this exact discipline: a pure "gather inputs, disclose every gap" module, separate from
the Web Worker that runs the draw loop.
**When to use:** building the district Web Worker's request payload from an `EventArtifact`.

### Pattern 4: The Web Worker lifecycle (`useSimulationRun.ts` + `createSimulationWorker.ts`)
**What:** one-Worker-at-a-time; construct lazily inside the click/effect handler, never at module
scope; `terminate()` on every terminal message and on unmount; a locally-typed `self` scope
(`SimulationWorkerScope`) rather than adding `"WebWorker"` to `apps/web/tsconfig.json`'s `lib`
array (that conflicts with `"DOM"`, already required by every component — this is a **known,
documented pitfall**, not a hypothetical one).
**Example:**
```typescript
// Source: apps/web/src/workers/createSimulationWorker.ts (existing, verbatim pattern to copy)
export function createSimulationWorker(): Worker {
  return new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
}
// The inline new URL(...) shape inside new Worker(...) is LOAD-BEARING for Vite's worker
// detection — hoisting it to a const silently produces a dead worker chunk.
```

### Anti-Patterns to Avoid
- **Forking `simulateRanks` instead of extending it.** The function is explicitly documented as
  having "exactly two callers" whose parity is load-bearing for a measured regression figure
  ("the measured rewind-overconfidence figure"). A district-specific copy would silently drift
  from that oracle. Add an optional per-draw callback/hook instead (see Section 3).
- **Rebuilding an alliance win-probability band from `spread` or from summed Sigma without
  re-deriving the exact display-vs-model split.** `uncertainty-display.md` documents this exact
  failure mode happening twice already on this project (sketch 003's original bug, and the
  2026-09-13 Match Band √3 correction). The new alliance-pricing formula this phase needs is a
  THIRD instance of "which variance quantity am I actually using" and must be treated with the
  same rigor: state explicitly which quantity is used (uncorrected `Σ Sigma²`, matching the rank
  simulation's own win/tie/loss spread rule) and measure it before shipping.
- **Widening `PageKind` "for consistency."** It is deliberately closed; District's own key
  functions already establish the precedent for staying outside it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Continuous rank-band / percentile-interval math | A new percentile interpolator for the blue-cell "likely a to b" range | `continuousQuantile()` in `apps/web/src/components/event/rankRows.ts` (per sketch-findings, winner of sketch 005) | Already validated against real data with the exact bounded-by-construction edges this phase's UI-SPEC also requires |
| Web Worker construction/lifecycle | A second worker factory pattern | `createSimulationWorker.ts` + `useSimulationRun.ts`'s exact lifecycle | The `"WebWorker"` lib-conflict pitfall and the lazy-construct-on-click rule are both already solved and documented here |
| erf/normal-CDF math | A new statistics dependency | `packages/core/algorithms/spr.ts`'s existing hand-rolled `erf()`/`normCdf()` (Abramowitz–Stegun) | Already shipped, already tested, zero new dependency |
| Table scroll-arbitration at phone width | New sticky-column/scroll logic | The "shipped table pattern" `sketch-findings-sigmascout` and the Compare table (sketch 007 winner) already reference, with its Phase 7 e2e suite | Explicitly named in CONTEXT.md as the pattern to inherit, not rebuild |

**Key insight:** almost everything this phase's UI needs (percentile bands, ±-free copy, status
chips, scroll arbitration) already has a shipped, tested implementation elsewhere on the site.
The genuinely new work is entirely in the simulation/data layer (Sections 2, 3, 5, 6, 7 below).

## Common Pitfalls

### Pitfall 1: Believing the sketch README's "browser already prices arbitrary alliances" claim
**What goes wrong:** planning the browser bracket-pricing task as "wire up the existing
mechanism" instead of "build a new win-probability formula from scratch."
**Why it happens:** the README was written 2026-09-25, ten days after the "embedded state block"
mechanism it references was deleted (260923-3w6, 2026-09-23) — a stale claim from training
memory or an out-of-date mental model, not verified against the code at write time.
**How to avoid:** treat "price alliance A vs alliance B in the browser" as a net-new deliverable
with its own design decision (which variance quantity, what formula) and its own verification
task, not a reuse task.
**Warning signs:** any plan task phrased as "call the existing alliance pricer."

### Pitfall 2: `simulateRanks` histograms cannot be post-hoc joined into (qual, selection, playoff) triples
**What goes wrong:** calling `simulateRanks` once to get rank histograms, then trying to derive
"P(this team is captain of alliance N AND wins the bracket)" from the aggregated
`rankHistograms: Map<teamKey, Int32Array>` output.
**Why it happens:** the aggregated histogram discards per-draw correlation entirely — it is a
draw-count array, not a list of per-draw rank assignments. The README's own "why one joint draw"
section is correct about needing joint draws; the risk is in the *implementation*, where
`simulateRanks` as it stands cannot produce that without modification.
**How to avoid:** add an optional callback parameter (e.g. `onDraw(order: readonly number[]) =>
void`, called once per draw with the resolved rank order — the `order` array the function
already builds internally at line ~331-336 of `rankSimulation.ts`, currently discarded after use)
so a caller can run selection + bracket pricing inline, per draw, before the next draw overwrites
`order`. This keeps the existing function's regression-oracle contract (Tests 1-14) completely
untouched for its two existing callers.
**Warning signs:** any design that calls `simulateRanks` and then tries to reconstruct
correlation from its return value.

### Pitfall 3: The Worker cannot rebuild a full district artifact — it has no corpus
**What goes wrong:** planning the Worker's district-refresh task as "call `buildDistrictArtifact`
like the offline publisher does."
**Why it happens:** `buildDistrictArtifact` (in `scripts/publishDistricts.ts`) takes `events`,
`registrations`, `awards`, and `teamMeta` — all sourced from corpus tables (`event_teams`,
`event_awards`, `teams`) the Worker has no access to at all (it only has D1 for algorithm state
and R2 for artifacts, never the SQLite corpus).
**How to avoid:** the Worker must READ the existing published `v1/district/{key}.json`, MERGE in
only what `/district/{key}/rankings` can supply (rank, pointTotal, rookieBonus, adjustments,
per-event `eventPoints` — see Section 2's exact TBA field list), and recompute `locks.ts`
verdicts from the merged totals. `remainingEvents`, `teamMeta` (nickname/teamNumber), and
`qualifyingAwards` should be carried over from the existing artifact rather than rebuilt, with
`remainingEvents` trimmed of any event that now has a matching `eventPoints` entry.
**Warning signs:** a Worker-side task that imports `packages/corpus/db.ts` (that package pulls in
`better-sqlite3`, a Node-only native module — importing it into the Worker bundle would not even
build).

### Pitfall 4: TBA's `/district/{key}/rankings` carries no award-recipient detail
**What goes wrong:** assuming the Worker can update `qualifyingAwards`/the award-qualified sets
from the rankings poll alone.
**Why it happens:** the rankings response gives `award_points` (a number) per event per team, but
never *which* award — that only comes from `/event/{key}/awards`, a separate endpoint.
**How to avoid:** the Worker can additionally call `fetchEventAwards` (already exported from
`packages/ingest/tbaClient.ts`, importable) for an event whose `eventPoints` entry just appeared
this tick, if award-based qualification needs to update live. If that is out of scope for this
phase's first cut, state explicitly that `qualifyingAwards`/award-locked status only refreshes at
the next offline republish, and the "whether awards are posted" boolean should be derived from
whether that event now has an `eventPoints` entry (TBA does not add `award_points` to a team's
`event_points` array until judging is final) rather than from a separate signal.
**Warning signs:** a district ledger showing "Locked · award" status for an award that was
announced mid-tick but the Worker never fetched.

### Pitfall 5: The corrected alliance-selection point formula (see Section 5) shipping as stated in CONTEXT.md
**What goes wrong:** implementing "second pick = 9 minus alliance number" as CONTEXT.md states it.
**Why it happens:** CONTEXT.md's authors (Jacob + the sketch session) stated the formula from
memory/the Admin Manual's stated intent, not from a corpus check — exactly the kind of thing the
CONTEXT.md itself asks be "measured on `event_alliances` in the corpus before it ships."
**How to avoid:** use the corrected formula verified in this session (Section 5): second pick =
the alliance number itself, not `9 - allianceNumber`. Write the reconciliation test BEFORE the
feature, following `reconciliation.test.ts`'s exact pattern.
**Warning signs:** any selection-points test whose fixture data was hand-typed rather than pulled
from a real event.

### Pitfall 6: District artifacts have no payload-budget test coverage today
**What goes wrong:** assuming `docs/publish-budget.md`'s ceilings apply to `v1/district/*.json`,
or that a payload-budget CI gate will catch an oversized district artifact.
**Why it happens:** `packages/harness/payloadBudget.test.ts`'s `PAGE_KINDS` constant is
`["teams", "team", "events", "event", "compare"]` — district is absent, and always has been.
**How to avoid:** the "about 60 numbers per team-event" byte decision (Claude's Discretion in
CONTEXT.md) has no existing budget line to check against. Measure the actual serialized size for
a real district (e.g. `2026pnw`, cited in the sketch as the reference district) with and without
the new fields, and either add a new budget line to `docs/publish-budget.md` (following that
doc's existing pattern) or document the measured number directly in this phase's plan.

## Runtime State Inventory

> N/A — this is not a rename/refactor/migration phase.

## Code Examples

### 1. `simulateRanks`'s per-draw order (Pitfall 2's fix point)
```typescript
// Source: packages/core/algorithms/simulation/rankSimulation.ts:331-336 (existing, read in full)
for (let i = 0; i < teamCount; i++) order[i] = i;
order.sort(compareByAvgRpDesc);
for (let rank = 0; rank < teamCount; rank++) {
  const teamI = order[rank]!;
  rankHistograms.get(baselines[teamI]!.teamKey)![rank]! += 1;
}
// `order` (team indices, sorted by resolved rank) is exactly the per-draw value a district
// joint-run needs, and it already exists here — it is simply discarded today. An optional
// `onDraw?: (order: readonly number[], baselines: readonly SimTeamBaseline[]) => void` parameter,
// called at this exact point, is the minimal, non-breaking extension.
```

### 2. The captain/first-pick formula (VERIFIED, keep as CONTEXT.md states)
```typescript
// Verified 2026-09-25 against data/corpus.sqlite: 2026 season, district-tier events only,
// captain (pick index 0) and first pick (pick index 1): 955/955 and 959/959 exact matches,
// zero mismatches, formula = 17 - allianceNumber.
function captainOrFirstPickPoints(allianceNumber: number): number {
  return 17 - allianceNumber;
}
```

### 3. The CORRECTED second-pick formula
```typescript
// CORRECTED 2026-09-25 against data/corpus.sqlite: CONTEXT.md's "9 - allianceNumber" scored
// 0/969 across the full 2026 season (district-tier events); the actual value, verified with
// zero exceptions, is the alliance number itself.
function secondPickPoints(allianceNumber: number): number {
  return allianceNumber; // NOT `9 - allianceNumber`
}
```

### 4. The qualification-points formula (VERIFIED exactly, 20,389 rows, 6 seasons, 0 mismatches)
```typescript
// Verified 2026-09-25 against data/corpus.sqlite across 2019, 2022, 2023, 2024, 2025, 2026
// (district-tier events only): 20,389/20,389 exact matches using this erfinv formula and the
// Winitzki approximation for erfinv (no existing erfinv in the repo — this is new code).
function erfinv(x: number): number {
  const a = 0.147;
  const ln1mx2 = Math.log(1 - x * x);
  const term1 = 2 / (Math.PI * a) + ln1mx2 / 2;
  const term2 = ln1mx2 / a;
  const sign = x < 0 ? -1 : 1;
  return sign * Math.sqrt(Math.sqrt(term1 * term1 - term2) - term1);
}

function qualPoints(rank: number, fieldSize: number): number {
  const val = (fieldSize - 2 * rank + 2) / (1.07 * fieldSize);
  const num = erfinv(val) * 10;
  const den = erfinv(1 / 1.07);
  return Math.ceil(num / den + 12);
}
```

### 5. The 8-alliance double-elimination bracket routing (VERIFIED against two independent real events)
```typescript
// Reconstructed 2026-09-25 from data/corpus.sqlite's real match_key/comp_level/set_number/
// red_teams/blue_teams rows, cross-referenced against event_alliances.picks, for TWO
// independent real events (2025flta, 2026casnv) — identical topology both times.
// Match numbering below follows TBA's set_number for comp_level "sf" (1-13) then "f".
//
// M1: A1 v A8   M2: A4 v A5   M3: A2 v A7   M4: A3 v A6         (Upper Round 1)
// M5: L(M1) v L(M2)   M6: L(M3) v L(M4)                         (Lower Round 1 — loser OUT, 0 pts)
// M7: W(M1) v W(M2)   M8: W(M3) v W(M4)                         (Upper Round 2)
// M9: L(M7) v W(M6)   M10: L(M8) v W(M5)                        (Lower Round 2 — loser OUT, 7 pts)
// M11: W(M7) v W(M8)                                            (Upper Final)
// M12: W(M9) v W(M10)                                           (Lower Round 3 — loser OUT, 13 pts)
// M13: L(M11) v W(M12)                                          (Lower Final — loser OUT, 13 pts)
// Finals (best of 3): W(M11) v W(M13)                           (winner 30 pts, finalist 20 pts)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Upcoming matches priced in the browser from an embedded state block | Upcoming matches priced by the Worker again (`priceUpcomingRows`) | 260923-3w6, 2026-09-23 | The sketch README's central browser-pricing feasibility claim is stale by 2 days before it was written; this phase must build a NEW browser pricing path, it cannot reuse the deleted one |
| Worker subrequest budget (50/tick free plan) gated every design decision | Workers Paid (10,000/invocation) since 2026-09-22; budget arguments in the codebase are explicitly retired | 2026-09-22/23 | The district live-refresh is now affordable (one extra TBA poll per live district per tick is cheap), but CPU-time discipline (never recompute a full corpus-scale thing inside a cron tick) still applies per the "What NOT to Use" table |
| District artifacts published offline-only, `PageKind`-excluded by design | This phase requires live refresh — the exclusion's stated reason no longer applies, but the code has not been changed yet | Not yet changed — this phase's job | The Worker writer needs new code, not a PageKind toggle |

**Deprecated/outdated:**
- The sketch 021 README's Feasibility section's claim that "SPR prices any three-robot alliance
  against any other in the browser today" — false as of the code at HEAD on 2026-09-25 (see
  Pitfall 1 and the summary above).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The standard FRC 2023+ bracket structure generalizes identically to every 8-alliance district event (not just the two events checked) | Section 7 / Code Example 5 | Low — two independent events across two seasons matched exactly; FRC's tournament rules are centrally administered and this format has been stable since 2023 |
| A2 | Smaller (4- or 6-alliance) double-elimination events use a shorter bracket with a DIFFERENT round-to-points mapping than the 8-alliance one verified here | Section 7 | Medium — the broad multi-season query found real corpus rows at "eliminated, Round 3, 0 pts" that the 8-alliance topology traced above never produces (no true elimination happens at Round 3 in the 8-alliance case) — some district events plainly use a smaller bracket and this phase's bracket-pricer must detect alliance count and branch, or explicitly scope to 8-alliance events only and document the gap |
| A3 | Award qualification (`qualifyingAwards`) can be safely left stale between offline republishes if the Worker does not also fetch `/event/{key}/awards` | Section 2, Pitfall 4 | Medium — a "Locked · award" status could lag reality for the freshness window between a live award ceremony and the next manual republish; needs an explicit scoping decision |
| A4 | The new browser alliance-pricing formula (`normCdf((meanA - meanB) / sqrt(varA + varB))` from published Total + uncorrected Σ Sigma²) is close enough to SPR's real internal `predict()` output to be an honest approximation | Section 3 | High — this is genuinely unmeasured; `uncertainty-display.md` explicitly warns against assuming any two of these quantities are interchangeable. Needs a calibration check (compare this formula's output against SPR's real predicted win probability for every ACTUAL scheduled match in a season, where both can be computed) before shipping |
| A5 | The `event_awards_all` corpus table (needed for the award base-rate script) is present and current in whatever environment executes this phase's pipeline work | Section 6 | Medium — that table is gitignored/local-only (`measureAwardPredictability.ts`'s own header: "does not travel via git — any other checkout must run its own backfill first") and this session confirmed it is populated locally, but a fresh worktree or CI environment will NOT have it |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Does this phase need to handle non-8-alliance double-elimination district events?**
   - What we know: the verified 8-alliance, 13-match bracket (Code Example 5) is exact for two
     real 8-alliance events across two seasons. The broader corpus query found real
     "eliminated, Round 3, 0 points" rows the 8-alliance topology never produces.
   - What's unclear: whether those come from 4/6-alliance district events (a shorter bracket) or
     from some other structural variant this session did not isolate.
   - Recommendation: query `event_alliances` row counts per event to find every district event
     with fewer than 8 alliances in the 2023+ corpus window, and either (a) build the smaller
     bracket topology from one of those events using the exact same reconstruction method this
     session used, or (b) explicitly scope this phase's bracket simulation to 8-alliance events
     only, falling back to "not simulated" for smaller events, and state that scoping decision to
     Jacob.

2. **How should the Worker discover "which districts are live"?**
   - What we know: the live-windows manifest (`v1/manifest/live-windows.json`,
     `LiveWindowEntrySchema`) is entirely event-keyed with no `districtKey` field anywhere in the
     Worker or `manifests.ts`. Events map to districts only via the corpus's
     `events.district_key` column, which the Worker cannot read.
   - What's unclear: whether the offline publisher should start emitting a
     event-key-to-district-key (or district-key-to-live-window) mapping as part of the manifest
     it already writes, so the Worker's district pass can reuse the SAME live-windows manifest it
     already loads every tick without a new R2 object.
   - Recommendation: extend `LiveWindowEntrySchema` (or a small sibling manifest) with a
     `districtKey: string | null` field, populated by the offline publisher from
     `events.district_key`, bumping `MANIFEST_SCHEMA_VERSION`. This keeps the Worker's "what's
     live" logic in one place and avoids a second R2 read every tick.

3. **What exactly triggers the Worker's district republish — the district's own live window, or
   any one of its member events' live windows?**
   - What we know: CONTEXT.md says "every district with a live window," but no such concept
     exists yet (see Open Question 2).
   - What's unclear: whether "live" for a district should mean "at least one member event is
     inside its live window" (derivable once Open Question 2 is resolved) or a separately
     computed district-level window.
   - Recommendation: derive district liveness from member-event liveness (simpler, one source of
     truth, matches how the district's own point totals only change when a member event's
     rankings change).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `data/corpus.sqlite` | Point-formula verification, award base-rate script, bracket-routing verification | ✓ (local, this session) | 592 MB, includes district/event_alliances/event_awards_all tables | Gitignored/local-only — a fresh checkout or CI must run `pnpm ingest:districts`/`ingest:awards-all` first (see Assumption A5) |
| `better-sqlite3` (native module) | Any corpus-reading script/test | ✓ (works in this repo's main checkout, per this session's direct query) | — | Per project memory, a FRESH worktree's `node-gyp` build fails on this machine — verify functionally, not by exit code, if this phase's work happens in a worktree |
| TBA API (`/district/{key}/rankings`, `/event/{key}/awards`) | Worker live refresh | Not tested this session (no network fetch performed, per instructions) | v3 | N/A — required; both endpoints are already used elsewhere in `packages/ingest/tbaClient.ts` |

**Missing dependencies with no fallback:** none blocking planning; `data/corpus.sqlite` presence
in CI is a real gap noted as Assumption A5.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x |
| Config file | repo-root vitest config (run `vitest run` from repo root — **not** `apps/web`; the project's own memory notes a documented CI trap where `apps/web` alone sees 77 files vs. 167 at repo root) |
| Quick run command | `npx vitest run packages/core/districts` (and equivalents per new module) |
| Full suite command | `npm run test` / `vitest run` from repo root |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| SC-1 | Worker republishes district artifact on a live rankings change | unit (mocked TBA fetch + D1/R2) | `npx vitest run apps/worker/src/scheduled.district.test.ts` | ❌ Wave 0 |
| SC-2 | Joint simulation produces correlated (qual, selection, playoff) per run | unit, seeded RNG | `npx vitest run packages/core/algorithms/simulation/rankSimulation.test.ts` (extend) | Existing file to extend, new cases needed |
| SC-3 | Status chips match `locks.ts` verdicts plus median-projection In range/Out of range | unit | `npx vitest run apps/web/src/components/districts/districtLedgerRows.test.ts` | ❌ Wave 0 |
| SC-4 | Slider reopens a finished event's later categories | component test | `npx vitest run apps/web/src/components/districts/DistrictLedger.test.tsx` | ❌ Wave 0 |
| SC-5 | Zero Worker messages posted for an all-finished/all-unstarted district | component test, asserts no `postMessage` | same file as SC-4 | ❌ Wave 0 |
| SC-6 (selection formula) | Corrected point formulas match corpus exactly | corpus reconciliation test, mirrors `reconciliation.test.ts` | `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts` | ❌ Wave 0 |
| SC-6 (award base rates) | Walk-forward leak test | unit | `npx vitest run scripts/measureDistrictAwardBaseRates.test.ts` | ❌ Wave 0 |
| SC-7 | CI green, both tsconfigs clean | CI (existing) | `npx tsc --noEmit` (root) + `npx tsc --noEmit -p apps/web/tsconfig.json` | Existing gate, no new file |

### Sampling Rate
- **Per task commit:** the relevant package's `npx vitest run <path>`.
- **Per wave merge:** repo-root `vitest run` (full suite) — required given the test-scope trap
  noted above.
- **Phase gate:** full suite green, both tsconfigs clean, before `/gsd-verify-work`; live e2e
  spec run from the main context after deploy (per the project's e2e-is-live-only memory note).

### Wave 0 Gaps
- [ ] `packages/core/districts/pointFormulas.reconciliation.test.ts` — corpus-backed proof of the
  corrected qual/selection/playoff formulas (must exist BEFORE the formulas ship, per Pitfall 5)
- [ ] `apps/worker/src/scheduled.district.test.ts` — the new Worker district pass
- [ ] `apps/web/src/components/districts/DistrictLedger.test.tsx` and
  `districtLedgerRows.test.ts` — the new table/status component
- [ ] `apps/web/src/workers/districtSimulationProtocol.test.ts` — the new Web Worker protocol,
  following `simulationProtocol.test.ts`'s pattern of testing the protocol module directly
  (jsdom has no `Worker` API, so `districtSimulation.worker.ts` itself is untestable, exactly as
  `simulation.worker.ts` is today)
- [ ] `scripts/measureDistrictAwardBaseRates.test.ts` — walk-forward leak test, mirroring
  `measureAwardPredictability.test.ts`'s existing leak-boundary assertions

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface in this phase |
| V3 Session Management | No | — |
| V4 Access Control | No | Public read-only data |
| V5 Input Validation | Yes | Zod schemas at every artifact boundary (`DistrictArtifactSchema` extension), exactly the existing pattern |
| V6 Cryptography | No | — |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Secret leak into a published artifact (TBA API key) | Information Disclosure | `ArtifactSecretLeakError`/the `env.TBA_API_KEY` substring check already in `artifactWriter.ts` — the new district writer MUST perform the same check, not skip it because it bypasses `SCHEMA_BY_PAGE` |
| `.env` read into a transcript | Information Disclosure | Project-standing rule (CLAUDE.md): never `Read`/`cat` `.env`; this research session complied — used `--env-file=.env` invocation patterns only, never inspected content |
| Malformed TBA response crashing the tick | Denial of Service (self) | Existing pattern: validate-then-persist, catch-and-degrade-to-bootstrap on a corrupt read, per-event try/catch isolation (`processEvent`) — the new district pass should follow the identical per-district try/catch isolation `runProbes` already demonstrates |

## Sources

### Primary (HIGH confidence — direct file reads this session)
- `packages/core/districts/{locks,pointModel,qualification}.ts` — read in full
- `packages/harness/pageArtifacts.ts` (district schema section, lines ~1880-2044) — read in full
- `scripts/publishDistricts.ts` — read in full
- `packages/corpus/schema.sql` (districts/district_rankings/event_teams/event_awards/event_awards_all/event_alliances tables) — read in full
- `packages/corpus/db.ts` (district/award/alliance accessor functions) — read in full
- `apps/worker/src/scheduled.ts`, `liveWindows.ts`, `tbaPoll.ts`, `artifactWriter.ts` — read in full or substantially
- `packages/harness/manifestSchemas.ts` — read in full
- `packages/ingest/schemas.ts` (TBA district/awards response shapes) — read
- `packages/ingest/tbaClient.ts` (fetchDistrictRankings/fetchEventAwards signatures) — read
- `packages/core/algorithms/simulation/rankSimulation.ts` — read in full
- `apps/web/src/lib/simulationInputs.ts`, `workers/simulation.worker.ts`,
  `workers/createSimulationWorker.ts`, `components/event/useSimulationRun.ts` — read in full
- `packages/harness/sigmaScore.ts`, `packages/core/algorithms/spr.ts` (predict/erf/normCdf) — read
- `packages/harness/preSchedule.ts` (header + build function) — read
- `apps/web/src/components/districts/DistrictLocksTab.tsx`, `apps/web/src/lib/api/districts.ts`,
  `apps/web/src/lib/searchParams.ts`, `apps/web/src/lib/liveEvent.ts` — read
- `packages/harness/payloadBudget.test.ts` — read (confirms district absence from PAGE_KINDS)
- `.planning/ROADMAP.md` Phase 10 section — read
- `data/corpus.sqlite` — direct read-only queries this session (see below)

### Verified via direct corpus query (HIGH confidence — node + better-sqlite3, this session)
- Qualification points erfinv formula: 20,389/20,389 exact matches, seasons 2019/2022/2023/2024/2025/2026, district-tier events
- Captain/first-pick formula (`17 - allianceNumber`): 955/955 and 959/959 exact matches, 2026 season
- Second-pick formula: CONTEXT.md's stated `9 - allianceNumber` scored 0/969; corrected formula (`allianceNumber` itself) verified with zero counter-examples
- Playoff bracket routing and round-to-points mapping: reconstructed exactly from real match data at two independent events (`2025flta`, `2026casnv`), cross-validated against the aggregate round→points distribution across 2023-2026

### Secondary (MEDIUM confidence)
- Nexus playoff-bracket guide (`guides.frc.nexus/guides/playoff-brackets`) — confirmed "13 + finals" match count for the 8-alliance format, consistent with this session's corpus reconstruction
- `.claude/skills/sketch-findings-sigmascout/references/{uncertainty-display,simulation-and-compare}.md` — read in full, both directly load-bearing for Section 3's warnings

### Tertiary (LOW confidence)
- The general claim that 4/6-alliance district events use a shorter double-elimination bracket
  (Open Question 1 / Assumption A2) — inferred from an anomaly in the aggregate round→points
  query, not independently reconstructed from a specific smaller event's match data this session

## Metadata

**Confidence breakdown:**
- Point-formula math (qual/selection/bracket): HIGH — directly and repeatedly verified against real corpus data in this session, with exact-match counts reported
- Worker/artifact architecture gap (PageKind exclusion, no corpus access): HIGH — read directly from the code's own explicit doc comments
- Browser alliance-pricing feasibility: MEDIUM — the absence of an existing mechanism is HIGH confidence (verified via git history/code state); the proposed replacement formula's accuracy is UNMEASURED (flagged as Assumption A4)
- Smaller-bracket handling: LOW — flagged as an open question, not resolved this session

**Research date:** 2026-09-25
**Valid until:** 30 days (stable domain — FRC's point model and bracket format do not change mid-season; the Workers Paid/subrequest-budget context is unlikely to change again soon)
