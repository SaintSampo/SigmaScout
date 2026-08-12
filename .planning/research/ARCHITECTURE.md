# Architecture Research

**Domain:** Precompute-heavy sports/competition prediction website (FRC match prediction, statbotics.io-class), on Cloudflare free tier
**Researched:** 2026-08-12
**Confidence:** MEDIUM (Cloudflare platform limits verified against official docs; domain-analog patterns are well-established but no direct open-source reference architecture combines all these pieces on Cloudflare specifically)

## Standard Architecture

### System Overview

The dominant pattern for this class of system (rating/prediction sites — Statbotics, chess/Elo-family sites, sports-analytics dashboards) is a **hard split between compute and serving**: a scheduled ingestion+compute pipeline owns all statefulness and produces small immutable data artifacts; the website is a thin, mostly-static reader of those artifacts. SigmaScout's own constraint ("no client-side season recomputation") is this pattern stated as a requirement, not a novel idea — it's how every serious implementation of this pattern works.

The distinctive wrinkle here is the **Cloudflare free-tier CPU ceiling**: a Cron Trigger Worker gets only **10ms of CPU time per invocation** (verified, official Cloudflare docs, Free plan). That is nowhere near enough to run a full OPR least-squares solve + Kalman filter pass + Monte Carlo simulation across an active event's teams in one shot. This forces a second split, *within* compute, between:

- **Heavy/offline compute** — walk-forward backtests across 2022–2026, hyperparameter auto-tuning, full-season bootstraps. No freshness requirement. Must run somewhere with real CPU budget (a dev machine, or CI such as GitHub Actions) and its *only* output is small versioned artifacts (tuned hyperparameters, accuracy reports) that the live path consumes.
- **Light/online incremental compute** — the ~1-3 min freshness loop. Must do the least possible work per tick: check TBA via ETag, and if (and only if) something changed, update algorithm state for just the affected event/teams (an O(matches-since-last-poll) operation, not an O(season) one), then write compact artifacts.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  OFFLINE / HEAVY (no freshness requirement — CI or local, real CPU budget)  │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐   ┌──────────────────────┐   ┌────────────────────┐   │
│  │ TBA bulk fetch  │→→│ Walk-forward backtest │→→│ Hyperparameter      │   │
│  │ (season replay) │   │ harness (Brier, etc.) │   │ auto-tuner          │   │
│  └────────────────┘   └───────────┬──────────┘   └──────────┬──────────┘   │
│                                    │  accuracy reports        │ tuned config │
│                                    ▼                          ▼             │
│                       ┌─────────────────────────────────────────┐          │
│                       │  Versioned algorithm config + eval store │          │
│                       └───────────────────┬───────────────────────┘        │
└────────────────────────────────────────────┼───────────────────────────────┘
                                              │ read at deploy / at boot
┌─────────────────────────────────────────────┼───────────────────────────────┐
│  ONLINE / INCREMENTAL (Cloudflare Worker Cron Trigger, ~1-3 min)             │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌───────────┐   ┌──────────────┐   ┌───────────────────┐   ┌───────────┐   │
│  │ TBA ETag  │→→│ Incremental   │→→│ Algorithm update    │→→│ Artifact  │   │
│  │ poller    │   │ diff (what   │   │ engine (pure,       │   │ writer    │   │
│  │           │   │ changed?)    │   │ predict-before-     │   │ (compact  │   │
│  │           │   │              │   │ update fn, shared   │   │ JSON →    │   │
│  │           │   │              │   │ w/ backtest harness)│   │ R2/D1)    │   │
│  └───────────┘   └──────────────┘   └───────────────────┘   └───────────┘   │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                  │ compact precomputed JSON
┌─────────────────────────────────────────────────┼───────────────────────────┐
│  SERVING (Cloudflare Pages, static — no compute at read time)                │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │  Teams   │  │  Team    │  │  Events  │  │  Event   │  │  Compare   │    │
│  │  page    │  │  page    │  │  page    │  │  page    │  │  page      │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────┘    │
│       (React reads precomputed JSON; client-side Monte Carlo simulation      │
│        loop runs on already-precomputed win-probabilities — see below)      │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| Backtest/eval harness | Replay 2022–2026 chronologically, predict-then-fold for every algorithm version, score with Brier/log-loss/accuracy, emit per-algorithm-per-season reports | Node/TS or Python script, run locally or in CI (GitHub Actions), no freshness constraint |
| Hyperparameter tuner | Search Sigma1 hyperparameter space against backtest score as objective | Offline optimizer (grid/Bayesian/CMA-ES) invoking the harness repeatedly; output = a versioned config artifact, not code |
| Algorithm registry | First-class record of algorithm name + version + hyperparameters + creation date; every precomputed metric is tagged with the version that produced it | Small JSON/D1 table; keys precomputed artifacts by `{algorithm}/{version}/...` |
| TBA ingestion (incremental) | Poll TBA v3 with If-None-Match/If-Modified-Since; on 200 (changed), extract only the delta (new/updated matches, new events, rank changes) | Cloudflare Worker Cron Trigger; ETag cache kept in KV or D1 (small, low write volume) |
| Algorithm update engine | Pure `predict(state, upcomingMatch) → prediction` then `update(state, matchResult) → newState` functions, one implementation per algorithm (OPR, EPA, Sigma1); **the same functions are called by both the live incremental path and the backtest harness** | Shared library module imported by both the Worker and the offline harness — this is what makes predict-before-update structurally enforced rather than a discipline |
| RP predictor + rank simulator | Per-season RP rule table; Monte Carlo simulation of remaining quals from a chosen start match | Season-specific rule modules; simulation core is a pure function over (remaining schedule, per-match win-prob, RP distributions) → rank distribution |
| Artifact writer | Serialize compact JSON per team/event/year/algorithm-version; write with content-addressed or version-stamped keys so stale reads are impossible | R2 (primary, generous free-tier write budget) for bulk JSON blobs; D1 for structured/queryable state (current standings, team roster) with 100K writes/day headroom; KV reserved for small high-read low-write items (ETag cache, "latest pointer" per resource) given its 1K writes/day free-tier ceiling |
| Frontend (React/Vite) | Fetch precomputed JSON (directly from R2 via a public route, or via a thin Pages Function), render; run the *simulation loop only* client-side using already-precomputed win-probabilities as fixed inputs | Cloudflare Pages static hosting; no server-side rendering compute needed |

## Recommended Project Structure

```
sigmascout/
├── packages/
│   ├── core/                    # Shared, isomorphic — used by BOTH the offline harness and the live Worker
│   │   ├── algorithms/
│   │   │   ├── opr.ts           # predict()/update() pair, no variance
│   │   │   ├── epa.ts           # reimplemented EPA, predict()/update()
│   │   │   └── sigma1/
│   │   │       ├── kalman.ts    # filter core (state, covariance)
│   │   │       └── index.ts     # predict()/update(), variance output
│   │   ├── rp-rules/
│   │   │   ├── 2022.ts … 2026.ts
│   │   │   └── index.ts         # season → ruleset dispatch
│   │   ├── simulation/
│   │   │   └── monteCarlo.ts    # pure fn: (schedule, winProbs, rpDist) → rank distribution
│   │   └── scoring/
│   │       └── brier.ts         # Brier score, log-loss, winner-accuracy
│   ├── ingest/                  # TBA client — ETag-aware fetch, delta extraction
│   │   └── tbaClient.ts
│   ├── harness/                 # OFFLINE — walk-forward backtest + tuner, run via CI or locally
│   │   ├── replay.ts            # chronological replay driver over 2022–2026
│   │   └── tune.ts              # hyperparameter search against replay.ts
│   └── worker/                  # ONLINE — Cloudflare Worker Cron Trigger entrypoint
│       ├── scheduled.ts         # 1-3 min tick: poll → diff → core.update() → write artifacts
│       └── artifacts.ts         # R2/D1/KV read-write helpers, versioned key scheme
├── apps/
│   └── web/                     # React + Vite + Tailwind, Cloudflare Pages
│       ├── src/pages/{Teams,Team,Events,Event,Compare}.tsx
│       └── src/lib/fetchArtifact.ts
├── config/
│   └── algorithm-versions.json  # registry: {algorithm, version, hyperparameters, createdAt}
└── .github/workflows/
    └── backtest.yml             # scheduled/manual CI run of packages/harness
```

### Structure Rationale

- **`packages/core/` is the load-bearing boundary.** Because the harness and the live Worker both import the exact same `predict()`/`update()` functions, "predict strictly before update" becomes impossible to violate by construction — the harness literally cannot call `update()` before `predict()` without producing a compile-time-visible bug, closing the failure-log's outcome-leakage risk at the architecture level rather than relying on process discipline.
- **`packages/harness/` never runs in a Worker.** It has no CPU ceiling to respect, so it's free to do full-season replays and exhaustive hyperparameter search. Keeping it physically separate (its own package, own CI job) prevents anyone from accidentally wiring a heavy operation into the 10ms cron path.
- **`packages/worker/` is deliberately thin.** Its job is orchestration (fetch → diff → call core → write), not computation. Every tick should touch only the events/teams that changed since the last ETag-valid poll.
- **`config/algorithm-versions.json`** is the join point between the offline and online worlds: the tuner writes to it (as a PR or a CI-committed file), the Worker and harness both read from it at start, and the frontend's algorithm dropdown is driven by its contents.

## Architectural Patterns

### Pattern 1: Predict-before-update as a pure-function contract

**What:** Every algorithm exposes exactly two functions: `predict(state, match) → prediction` (read-only) and `update(state, matchResult) → newState` (the only place state changes). No other function may read a match's outcome.
**When to use:** Any algorithm SigmaScout ships (OPR, EPA, Sigma1, future SigmaN).
**Trade-offs:** Slightly more ceremony than a single "processMatch" function, but it's the difference between leakage being *possible-but-forbidden* and *impossible*. This directly answers the failure log's "no evaluation harness / outcome leakage" item.

```typescript
interface AlgorithmModule<S> {
  initState(teams: TeamId[]): S;
  predict(state: S, match: UpcomingMatch): Prediction; // never touches match.result
  update(state: S, result: MatchResult): S;             // only place result is read
}
```

### Pattern 2: Compute/serve split with versioned, content-addressed artifacts

**What:** All pages read precomputed JSON keyed by `{year}/{eventKey|teamKey}/{algorithm}/{version}.json` (or similar), written by the incremental Worker. The frontend never computes ratings.
**When to use:** Always, for this project — it's an explicit constraint ("no client-side season recomputation"), not just a nice-to-have.
**Trade-offs:** Requires discipline about what's "compact enough" to ship (don't serialize full covariance matrices to the browser, just the derived `X ± Y`). Slight staleness window (bounded by the 1-3 min poll cadence) is an accepted trade for zero recompute-per-request cost.

### Pattern 3: Client-side simulation loop over server-precomputed probabilities (not client-side rating recomputation)

**What:** The Simulation tab needs to run 1000 random draws over the remaining qual schedule for a user-chosen start match. Precomputing every possible `(start match, algorithm version)` combination server-side is unnecessary — but running the actual *rating computation* in the browser is exactly the anti-pattern the project explicitly rejects (Statbotics' recalculate-on-load approach). The resolution: precompute per-match win-probability, confidence, and RP distribution for every *scheduled* match at the current point in time (cheap, already part of the normal Event-page precompute); ship those numbers to the browser; run only the Monte Carlo *sampling loop* client-side using those fixed inputs. No ratings are recomputed in the browser — only random outcomes are drawn from already-known distributions.
**When to use:** The Event page Simulation tab specifically.
**Trade-offs:** If a user picks a start match whose "current" predictions were computed with an older algorithm/team state (e.g., picking a start point mid-event after ratings have since moved on), the simulation reflects live-at-request-time ratings applied retroactively to a historical starting point — flag this as a UX/semantics decision to confirm in phase-specific research (do we want "current ratings, any start point" or "ratings as-of that historical moment"?). Either is implementable; the former is far cheaper.

```typescript
// Client-side — no rating computation, only sampling
function simulateRemaining(
  remainingMatches: PrecomputedMatchPrediction[], // fetched, not computed
  runs = 1000
): RankDistribution {
  // for each run: draw match outcomes from remainingMatches' probabilities, tally RP → rank
}
```

### Pattern 4: Offline heavy compute in CI, online light compute in a Worker Cron Trigger — never the reverse

**What:** Backtests, hyperparameter tuning, and full-season bootstraps run in GitHub Actions (or locally); only small, already-scoped incremental updates run in the Cloudflare Worker Cron Trigger.
**When to use:** Always, given the verified 10ms CPU/invocation ceiling on Cloudflare's free plan.
**Trade-offs:** GitHub Actions' own scheduled-workflow cron is *not* reliable enough (5-30+ min delays common at peak load, verified) to be the *live-freshness* trigger — so this pattern only works if GitHub Actions is used exclusively for the freshness-insensitive heavy jobs, while Cloudflare's own Cron Trigger (reliable down to ~1 min intervals) drives the live polling loop. Conflating the two — e.g. trying to use GitHub Actions cron for the 1-3 min freshness target — would violate the freshness requirement outright.

## Data Flow

### Live freshness flow (the ~1-3 min loop)

```
Cloudflare Cron Trigger (every 1-2 min)
    ↓
TBA client: GET .../event/{key}/matches with If-None-Match: <cached ETag>
    ↓ (304 → stop here, no further work, minimal CPU spent)
    ↓ (200 → new/changed data)
Diff: which matches are new or updated since last successful poll?
    ↓
For each affected event (bounded, not O(season)):
    core.predict(state, upcomingMatches)   // BEFORE folding in new results
    → prediction artifacts (winner, confidence, score, RP ± σ)
    core.update(state, newResults)          // AFTER predictions recorded
    → new algorithm state persisted (D1)
    ↓
Artifact writer: serialize compact per-team/per-event JSON → R2
    ↓
Frontend (already-open tab or next page load) reads updated R2 JSON — no push needed,
polling/staleness at the fetch layer is enough given the freshness target
```

### Offline evaluation flow (no live component)

```
packages/harness/replay.ts
    ↓ chronologically, event-by-event, match-by-match, 2022→2026
    for each match: core.predict() → record prediction; core.update() → fold in result
    ↓
packages/core/scoring: Brier score, log-loss, winner accuracy — aggregated per
algorithm version, per season
    ↓
Written as versioned "evaluation report" artifacts, consumed by the Compare page
(itself just another precomputed-JSON reader, same as Team/Event pages)
    ↓
Hyperparameter tuner wraps replay.ts as its objective function, writes tuned
Sigma1 config back into config/algorithm-versions.json
```

### Key Data Flows

1. **Ingestion → state → artifacts:** TBA is the only external write source; everything else derives from it. State (per-algorithm-version, per-team, per-season) lives in D1; the JSON the frontend consumes is a *projection* of that state, not the state itself — this lets the artifact schema evolve without migrating the algorithm state store.
2. **Backtest and live share code, not data:** the harness replays TBA history independently (it doesn't read the live D1 state) but calls the identical `packages/core` functions, so an accuracy number produced by the harness is a true predictor of what the live path will do once that algorithm version is deployed.
3. **Algorithm version is a routing key everywhere:** every artifact path, every D1 row, every UI fetch includes `{algorithm}/{version}` — this is what makes "past Sigma versions remain viewable and comparable" fall out of the storage scheme rather than needing special-case code.

## Scaling Considerations

FRC's data volume is small and bounded (a few thousand teams, a few hundred events/year, tens of thousands of matches/season) — this is not a "scale to millions of users" problem, it's a "stay inside a hobbyist free tier while handling bursty read traffic during live events" problem.

| Concern | Normal (offseason, low traffic) | Live event traffic spike | Multiple concurrent events (regional season peak) |
|---------|----------------------------------|---------------------------|------------------------------------------------------|
| Read load | Trivial — R2/Pages CDN cache absorbs it | Cloudflare's CDN in front of R2/Pages handles read fan-out without touching compute; reads never hit the Worker's 10ms budget | Same — reads are still just static JSON fetches |
| Write load (incremental updater) | Near-zero (no live matches) | Bounded by TBA's own update cadence (~1-2 min) and the events actually live that day, not by SigmaScout's user traffic | Scope the cron tick to "events currently live" (query TBA's simple "events happening today" list) rather than polling every event in the season — keeps subrequest/CPU budget proportional to concurrent live events, not total season size |
| KV write budget (1K/day free) | Non-issue | Could be tight if ETag cache is written per-poll per-event with several concurrent events; mitigate by batching multiple events' ETags into one KV value, or storing ETag cache in D1 instead (100K writes/day) | Same mitigation |
| Backtest/tuning compute | No constraint (offline) | N/A — decoupled from live traffic entirely | N/A |

### Scaling Priorities

1. **First likely constraint: KV's 1,000 writes/day free-tier ceiling**, if the incremental updater is naively designed to write one KV key per event per poll. Fix: batch ETag/cursor state into few keys, or move that bookkeeping to D1 (100K writes/day) and reserve KV for read-heavy small lookups only.
2. **Second: Worker CPU time on the heaviest possible single tick** (e.g., an event's semifinal/final flurry producing several match updates at once, or an event boundary triggering a full-event insights recompute). Fix: keep per-tick work strictly scoped to "what changed since last poll," and if any single operation risks the 10ms ceiling, split it across multiple scheduled ticks or move it off the cron path entirely (e.g., trigger it via a Queue consumer with a higher CPU allowance if that becomes necessary — not needed at v1 scale).

## Anti-Patterns

### Anti-Pattern 1: Recompute-per-request (the project's own documented past failure)

**What people do:** Recalculate a team's or season's whole metric set on every page load or API request.
**Why it's wrong:** Directly named in the failure log as what made the prior version slow; also reintroduces the exact "recalculate EPA in the browser" pattern the spec explicitly rejects for Statbotics-style sites.
**Do this instead:** Compute once per data change (incrementally, in the Worker), write a compact artifact, serve that artifact unchanged until the next real change.

### Anti-Pattern 2: One algorithm implementation shared loosely between backtest and live path via copy-paste or re-derivation

**What people do:** Write the rating update logic once "for the backtest" and again "for production," believing they're equivalent.
**Why it's wrong:** This is exactly how outcome leakage or subtle drift creeps in — the two implementations silently diverge, and the backtest's accuracy numbers stop being a true predictor of live behavior. This is also how "the docs described a model that no longer existed" (failure log) tends to happen: two code paths, one gets updated, the other doesn't.
**Do this instead:** One `packages/core` module, imported (not re-implemented) by both `packages/harness` and `packages/worker`.

### Anti-Pattern 3: Treating Cloudflare's 10ms free-tier CPU limit as "probably fine, we'll optimize if needed"

**What people do:** Build the incremental updater assuming Worker compute has "enough" headroom, discovering only in production (during a live event, the worst possible time) that a burst of matches blows the CPU budget and the Worker fails or gets throttled.
**Why it's wrong:** The failure mode surfaces exactly when freshness matters most (live events), and Cloudflare's CPU limit is a hard platform ceiling on the free plan, not a soft one.
**Do this instead:** Design the incremental path from day one to be strictly proportional to "matches changed since last poll," verify against worst-case bursts (e.g., a full elimination bracket round resolving in one tick) during planning, and keep all genuinely heavy computation (bootstraps, full backtests, tuning) structurally outside the Worker.

### Anti-Pattern 4: An unidentifiable model (the project's own documented past failure)

**What people do:** Give a model more latent per-team structure (e.g., separate offense/defense/time-allocation parameters) than the available observations (alliance-level scores) can distinguish.
**Why it's wrong:** Named directly in the failure log — the 4D model collapsed because its parameters weren't separately identifiable from the only observable (alliance score).
**Do this instead:** Before adding latent structure to Sigma1 or any future SigmaN, check identifiability against what TBA actually exposes as observables (alliance scores, score breakdowns where available, RP flags) — prefer models whose parameter count is visibly justified by the number of independent observations per team per event.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| The Blue Alliance API v3 | ETag/If-None-Match polling from the Worker's scheduled handler; bulk/season endpoints used only by the offline harness | TBA sends ETag + Last-Modified on every response and expects conditional requests back; TBA's own live-event data refresh cadence is ~1-2 min, which is the practical ceiling on how much fresher SigmaScout's ~1-3 min target can usefully be |
| Cloudflare Pages | Static hosting for the React/Vite build; reads artifacts from R2 (directly, or via a lightweight Pages Function proxy) | No SSR compute needed if artifacts are fetched client-side; keeps the read path outside any CPU-limited Worker |
| Cloudflare Workers (Cron Triggers) | `scheduled()` handler runs the incremental ingestion+update+write cycle | Free plan: 10ms CPU/invocation, 5 cron triggers/account, 50 subrequests/invocation — all verified; design the tick to stay well under these |
| Cloudflare R2 | Primary store for precomputed JSON artifacts | 10GB storage, 1M Class A (write-ish) ops/month, 10M Class B (read-ish) ops/month, zero egress — free tier is generous relative to KV |
| Cloudflare D1 | Structured algorithm state (per-team-per-version Kalman state, standings) and ETag/cursor bookkeeping | 5GB storage, 5M reads/day, 100K writes/day free tier — far more write headroom than KV |
| Cloudflare KV | Small, high-read/low-write lookups only (e.g., a handful of "latest artifact version" pointers) | Free tier is only 1K writes/day — do not use for per-event or per-match bookkeeping |
| GitHub Actions | Runs the offline backtest harness and hyperparameter tuner on a schedule or manual trigger; commits/publishes the resulting versioned config | Free tier scheduled workflows have unreliable timing (5-30+ min delays common) — acceptable here because this path has no freshness requirement, but it must never be relied on for the live 1-3 min loop |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| `packages/core` ↔ `packages/harness` | Direct function import (same process) | Backtest calls `predict()`/`update()` exactly as the live Worker does — this identity is the anti-leakage guarantee |
| `packages/core` ↔ `packages/worker` | Direct function import (same process, inside the Worker bundle) | Keep `packages/core` free of any Cloudflare-specific APIs so it stays testable outside the Workers runtime and reusable by the harness |
| `packages/worker` ↔ storage (R2/D1/KV) | Cloudflare bindings (`env.MY_BUCKET`, `env.MY_DB`, `env.MY_KV`) | Version every artifact key so a slow/failed write can never leave a reader looking at a half-updated, internally-inconsistent set of files |
| `apps/web` ↔ storage | Fetch precomputed JSON (via R2 public access, a Pages Function proxy, or a thin read-only Worker route) | Never call into `packages/core` from the frontend — that boundary is what "no client-side recomputation" means architecturally |
| Algorithm registry ↔ everything | Shared config file/table, read (not computed) by harness, worker, and frontend | Adding SigmaN later means adding a module to `packages/core/algorithms` + an entry in the registry — no other component needs to change |

## Sources

- [Cron Triggers · Cloudflare Workers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — MEDIUM
- [Scheduled Handler · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) — MEDIUM
- [Limits · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/limits/) (fetched directly; confirms Free plan 10ms CPU/invocation, 5 cron triggers/account, 50 subrequests/request) — MEDIUM (official docs, single-source fetch)
- [Pricing · Cloudflare D1 docs](https://developers.cloudflare.com/d1/platform/pricing/) — LOW/MEDIUM (via search synthesis, not directly fetched)
- [Pricing · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/pricing/) — LOW/MEDIUM
- [Tech Talk: Efficiently Querying the TBA API – The Blue Alliance Blog](https://blog.thebluealliance.com/2017/11/10/tech-talk-efficiently-querying-the-tba-api/) — MEDIUM (official TBA source, describes ETag/conditional-request pattern and live-event update cadence)
- [The Blue Alliance API docs](https://www.thebluealliance.com/apidocs/v3) — MEDIUM
- [statbotics GitHub repo](https://github.com/avgupta456/statbotics) and [Evaluating FRC Rating Models](https://www.statbotics.io/blog/models) — MEDIUM (confirms EPA/Elo-family lineage, NextJS/TS/Tailwind frontend, live simulation feature, large-match-count evaluation approach; blog content itself returned 403 on direct fetch, findings are from search-result synthesis only)
- [Understanding Walk Forward Validation in Time Series Analysis](https://medium.com/@ahmedfahad04/understanding-walk-forward-validation-in-time-series-analysis-a-practical-guide-ea3814015abf) — LOW
- [GitHub Actions scheduled workflow delay discussions](https://github.com/orgs/community/discussions/201738) and [GitHub Actions Cron Schedule guide](https://cronbuilder.dev/blog/github-actions-cron-schedule.html) — LOW/MEDIUM (community reports + third-party guides, consistent across multiple independent sources)
- [Glicko-2 Rating System overview](https://www.emergentmind.com/topics/glicko-2-rating-system) — LOW (confirms rating-deviation/volatility pattern as the standard prior art for variance-carrying rating systems, relevant precedent for Sigma1's design)
- Data pipeline idempotency/incremental-ETL pattern sources (Airbyte, ml4devs, various) — LOW, general software-engineering consensus rather than domain-specific

---
*Architecture research for: precompute-heavy sports/competition prediction website on Cloudflare free tier*
*Researched: 2026-08-12*
