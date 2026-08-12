# Stack Research

**Domain:** Precompute-heavy, statically-hosted sports-prediction website (FRC match predictions) on Cloudflare's free tier
**Researched:** 2026-08-12
**Confidence:** HIGH on Cloudflare platform limits and package versions (verified against official docs / npm registry); MEDIUM on library-choice opinions (cross-checked web sources, no single canonical authority)

## Framing

React + Vite + Tailwind CSS on Cloudflare Pages, free tiers only, are already fixed (see PROJECT.md). This document covers what goes **around** that core: the data pipeline runtime, the Cloudflare storage/compute topology for ~1–3 min freshness, and the client-side data-loading/routing/state/chart/test stack. The single most load-bearing finding from this research is a **Cloudflare Workers free-plan constraint that must shape the architecture**, so it's stated up front:

> **Workers free plan: 10ms of CPU time per invocation — for both HTTP requests and Cron Trigger (`scheduled()`) invocations.** Time spent waiting on `fetch()`, KV, or R2 does *not* count, but actual JS computation does. This is confirmed directly from Cloudflare's own limits documentation (HIGH confidence). It means: incremental per-match updates (a handful of Kalman-filter/EPA updates when 2–6 new matches land) are very plausibly cheap enough to fit; a full-season recompute or a 1000-run Monte Carlo rank simulation is **not**. The recommendations below are built around this constraint rather than around it becoming a Phase 1 surprise.

## Recommended Stack

### Core Technologies (already fixed by the project; versions verified current)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.2.x | UI library | Fixed by project constraint |
| Vite | 8.2.x | Build tool / dev server | Fixed by project constraint |
| Tailwind CSS | 4.3.x | Styling | Fixed by project constraint; v4's CSS-first config (no `tailwind.config.js` needed) and Lightning CSS engine keep build times low, which matters for a precompute-heavy site that also rebuilds often |
| Cloudflare Pages | — | Static hosting | Fixed by project constraint; git-integrated auto-deploy, free, global CDN |

### Data Pipeline & Compute Runtime

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x LTS ("Krypton") | Runtime for the offline/bulk pipeline (historical precompute, backtests, hyperparameter tuning) | Current LTS as of Aug 2026 (nodejs.org). This code runs *outside* the Workers CPU-time budget — it's the right home for anything that touches a full season's data (walk-forward backtests over 2022–2026, offline Sigma1 hyperparameter search, the 1000-run simulation's *parameter* precomputation) |
| TypeScript | 5.x, `strict: true` | Language for pipeline, Worker, and client code | One language across the whole system; shared types between pipeline output and client consumption close the "docs describe a deleted model" failure mode from the failure log |
| tsx | 4.23.x | Run TypeScript pipeline scripts directly, no separate build step | Current standard TS executor for Node scripts in 2025/2026 (has effectively replaced `ts-node` for new projects) — MEDIUM confidence, cross-checked |
| Zod | 4.4.x | Runtime schema validation for TBA API responses + precomputed-artifact schemas | TBA's JSON is third-party and can drift/surprise you across seasons; validating at the fetch boundary turns a silent bad-parse into a loud, testable failure. The *same* Zod schema doubles as the executable spec for each precomputed artifact shape — directly counters the failure log's "README described a model that had been deleted" pattern, since the schema can't drift from the shipped shape without a test failing |
| Wrangler | 4.122.x | Cloudflare CLI: local Worker dev, KV/R2/D1 management, deploy | Cloudflare's own tool; required regardless of framework choice |
| `@cloudflare/workers-types` | 5.20260812.x (dated releases, always take latest) | TypeScript types for the Workers runtime (KV/R2/D1/ScheduledEvent bindings) | Needed for type-safe Worker code; version string is a date, always pull latest rather than pinning |

### Cloudflare Storage & Compute Topology

| Technology | Purpose | Why Recommended |
|------------|---------|------------------|
| **R2** (primary data store) | Store precomputed JSON artifacts: per-team season files, per-event files, per-year manifests, historical backtest results | Free tier: 10GB storage, 1M Class-A (write) ops/month, 10M Class-B (read) ops/month, **zero egress fees**. Verified against Cloudflare's official limits page (HIGH confidence). This headroom comfortably covers a cron job writing several JSON files every 1–3 minutes during a live event, which KV's daily write cap would not (see "What NOT to Use") |
| **KV** (thin manifest layer only) | A handful of small, hot keys: `event:{key}:last-updated`, `event:{key}:live` flag, `data-version` | KV free tier: 100k reads/day (very fast, edge-local), but only **1,000 writes/day** and 1GB storage. Use it only for small pointer/flag values read very frequently and written rarely — not as the artifact store itself. Eventual consistency (~60s global propagation) is a non-issue for values updated once per minute, since it's below the propagation window's effect on freshness perception |
| A standalone **Workers project with Cron Trigger** (not Pages Functions) | Poll TBA on a schedule (1-min interval during live events), apply *incremental* per-team updates, write to R2, bump the KV manifest | Pages Functions do **not** support `scheduled()` handlers/Cron Triggers — this requires a dedicated Workers deployment with `[triggers] crons` in `wrangler.toml`/`wrangler.jsonc` (MEDIUM confidence, cross-checked, consistent with official docs' framing of Cron Triggers as a Workers-project feature). Free plan allows **5 Cron Triggers per account** (not per Worker) and a 1-minute minimum interval — both confirmed against Cloudflare's official limits page (HIGH confidence). Design **one** Worker that internally decides which events are currently live, rather than one trigger per event, to stay under the 5-trigger cap regardless of how many events run concurrently |
| A lightweight **Worker or Pages Function as the read/serving layer** | Serve precomputed JSON from R2 to the client with `Cache-Control` + `ETag` headers | Puts Cloudflare's edge CDN cache in front of R2/KV, so the vast majority of client reads never touch R2 at all — keeps you inside free-tier read quotas regardless of traffic. This *can* live in Pages Functions (it's just HTTP-triggered, no scheduling needed) |
| **D1 — deliberately not used in v1** | (n/a) | See "What NOT to Use" |

**Why this split works within the CPU-time constraint:** the Sigma1 Kalman filter is inherently an *incremental* update — feed it the new match, update state, done — which is a small, bounded amount of computation regardless of season length. Structuring the cron Worker to process only the delta since the last poll (a handful of matches) keeps each invocation's actual CPU-bound work small, even though the 10ms budget is tight. Full-season backtests and the 1000-run Monte Carlo simulation are categorically different — they scale with season/match count, not with "what changed" — so they don't belong in the Worker at all:
- **Backtests / hyperparameter tuning / historical bulk precompute** → run in the Node.js pipeline, offline, on your machine or in CI, output uploaded to R2.
- **The 1000-run remaining-quals rank simulation** → run **client-side**, in the browser, on demand when the user picks a start match. The Worker precomputes and ships the small set of parameters the simulation needs (predicted win probability + RP mean/variance per remaining match); the 1000 draws themselves are cheap, unconstrained JS in the visitor's browser (ideally inside a browser Web Worker so it doesn't block the UI thread) — not a Cloudflare Workers CPU-budget problem at all, and it matches the "precompute what's shared, compute-on-view what's parameterized by the user's own click" philosophy the spec already calls for.

### Client: Data Loading

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TanStack Query (`@tanstack/react-query`) | 5.101.x | Fetch/cache/revalidate precomputed JSON from the Worker/Pages Function endpoint | 2025/2026 comparisons show it pulling ahead of SWR in adoption (~12.3M vs ~7.7M weekly downloads) with materially richer `refetchInterval`/mutation primitives (MEDIUM confidence, cross-checked). This app needs exactly that: static `staleTime` for finished-event data, but `refetchInterval` polling on a team/event page during a live event so the ~1–3 min freshness target is visible without a manual reload |

### Client: Routing

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TanStack Router (`@tanstack/react-router`) | 1.170.x | Client-side routing with typed URL search params | Recommended over React Router for this specific app shape: SigmaScout is a pure client-rendered SPA (no SSR need — everything is precomputed JSON) with a *lot* of shareable, bookmarkable filter state living in the URL (year dropdown, algorithm dropdown, team/event search, event filters by week/country/state/district, simulation start-match). TanStack Router's first-class typed search-params are built for exactly this, catching "the algorithm dropdown and the URL disagree" bugs at compile time (MEDIUM confidence — opinionated but well-justified for this app's shape, not a universal "always pick this" claim) |

### Client: State Management

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zustand | 5.0.x | Small amount of non-URL, non-server global UI state (e.g., simulation-panel open/closed, table sort-while-typing) | Recommended default starting point per 2025/2026 comparisons: 1.1KB, now the most-downloaded dedicated state library (having overtaken Redux), minimal boilerplate (MEDIUM confidence). **Push everything URL-shareable (algorithm, year, search, filters) into router search params instead of a store** — that's the correct home for it and keeps Zustand's footprint genuinely small |

### Client: Charting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Recharts | 3.10.x | Team metric-history plot (line + shaded variance band, matches on x-axis) | Practical 2025/2026 default (highest weekly downloads of any React chart library) with a composable `ComposedChart` (`Area` + `Line`) that directly supports the `X ± Y` variance-band visualization the spec calls for, without hand-rolling D3. At SigmaScout's realistic data volume (one season's worth of matches per team — tens to low hundreds of points, not thousands of live-streaming points), Recharts' rendering cost is a non-issue (MEDIUM confidence, cross-checked) |

### Testing

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Vitest | 4.1.x | Unit/integration tests: prediction math, walk-forward harness, Zod schema round-trips, Worker logic | Unanimous 2025/2026 recommendation for Vite-based projects — reuses Vite's transform pipeline (no separate config for TS/JSX), 2–10x faster than Jest, native ESM (MEDIUM confidence). Directly answers the failure log's "tests are not optional" — put the walk-forward evaluation harness and the incremental Kalman update under test first, since those are exactly what failed silently last time |
| `@testing-library/react` | 16.3.x | Component-level tests for Teams/Events/Team/Event pages | Standard pairing with Vitest for React component behavior tests |
| `@playwright/test` | 1.62.x | Optional end-to-end smoke tests (page loads, dropdown changes propagate to URL, simulation runs) | Add once the core pages exist; not needed for Phase 1 scaffolding |

### Supporting / Repo Tooling

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pnpm | 11.21.x | Package manager / workspaces | This project naturally splits into an app, one-or-two Workers, a Node pipeline, and shared types — pnpm workspaces keep that as one repo with strict, phantom-dependency-free installs and fast, disk-efficient installs. Cloudflare Pages auto-detects and supports pnpm lockfiles natively |
| date-fns | 4.4.x | FRC "competition week" date math, event date formatting | Use only if/when date arithmetic beyond `Intl`/native `Date` is actually needed (week-of-season calculations) — don't reach for it preemptively |
| Hono | 4.13.x | (Optional) routing/middleware helper inside the serving Worker | Only worth adding if the serving Worker's routing logic (multiple JSON endpoint shapes, per-route caching) gets non-trivial; a single Worker with a few `if`/`switch` branches on `url.pathname` needs no framework at all — don't add Hono on day one just because it's a common pairing |

## Installation

```bash
# Client app (apps/web)
npm install react@19 react-dom@19 @tanstack/react-query @tanstack/react-router zustand recharts

# Worker(s) (apps/worker) — dev dependencies
npm install -D wrangler @cloudflare/workers-types

# Shared pipeline / schema package (packages/shared)
npm install zod

# Data pipeline (pipeline/)
npm install -D tsx typescript

# Testing (repo root or per-package)
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test   # optional, add when pages exist

# Repo-wide dev tooling
npm install -D typescript
```

(Shown as `npm install` for portability; the actual recommendation is to run all of this through **pnpm** workspaces — `pnpm add ...` — once the monorepo is scaffolded.)

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|--------------|-------------|--------------------------|
| TanStack Router | React Router v8 | If the app ever needs SSR/framework mode (it currently doesn't — everything is precomputed JSON fetched client-side), or if minimizing a new-to-the-team learning curve matters more than compile-time-typed search params |
| TanStack Query | SWR | If the data-fetching needs stay simple (fetch-once, no polling/refetch-interval requirements) and a smaller bundle matters more than DX — unlikely here given the live-event polling requirement |
| Zustand | Jotai | If team/event/algorithm/year state grows genuinely complex with many *derived* values that need fine-grained reactivity — Jotai's atomic model scales better for that shape. Not expected to be needed given most shareable state should live in the URL, not a store |
| Recharts | uPlot | If profiling later shows Recharts' render cost is a real problem — e.g., a future chart needs thousands of live-updating points. uPlot is meaningfully faster for that case via incremental `setData`, at the cost of building variance-band rendering by hand and sparser docs |
| Recharts | visx | If you want maximum control over a truly custom chart and are willing to compose low-level D3 primitives yourself. Not worth the extra effort for a standard line + band chart |
| R2-as-primary-store | D1 | If the Compare page or future features need genuine ad-hoc SQL-style aggregation across many rows at read time rather than serving pre-flattened JSON. Revisit if that need materializes — see "What NOT to Use" |
| Plain JSON over the wire | MessagePack / CBOR | Only after profiling shows a specific artifact (e.g. a large season-history file) is a real bundle-size problem *after* Cloudflare's automatic gzip/brotli compression. Binary formats save 20–50% over *raw* JSON, but JSON+gzip is often competitive since text compresses very well — don't add a binary-format dependency preemptively |
| GitHub-Actions/local Node pipeline for bulk compute | Doing all compute inside the Workers Cron Trigger | Only viable if you're certain every single computation — including hyperparameter tuning and simulations — will always fit in 10ms CPU time per invocation. Given the failure log's "unidentifiable 4D model" and "no evaluation harness" history, don't bet the whole pipeline on a tight CPU budget you haven't measured against yet |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| KV as the primary artifact store | Free tier write cap is 1,000/day; a cron job firing every 1 minute across a full ~10-hour event day is already ~600 writes on its own, and multiple concurrent events (regional season) would blow past the cap fast. KV is meant for small, hot values, not the bulk JSON payload store | R2 for artifacts; KV for a small manifest/pointer layer only |
| D1 for v1 | Nothing in the current spec needs ad-hoc SQL query access from the client — every page reads a known, precomputed JSON path. Adding a relational database is complexity with no corresponding requirement yet, and it's one more thing the "no evaluation harness" failure mode could hide inside | R2 JSON files, organized by year/event/team; revisit D1 only if a genuine cross-cutting query need appears |
| Cron Trigger doing full-season recompute or the 1000-run simulation | 10ms CPU time per invocation on the free plan will not cover it; this is exactly the kind of "recompute-per-request" trap the failure log already names as a past failure mode, just moved from "per HTTP request" to "per cron tick" | Incremental per-match updates in the Worker; full recomputes in the offline Node pipeline; simulation client-side |
| Pages Functions for the cron/polling job | Pages Functions have no `scheduled()` handler — Cron Triggers are a Workers-project feature | A standalone Workers project (deployed alongside Pages) for the cron/polling job; Pages Functions (or that same Worker) is fine for the read-serving HTTP layer |
| Redux / Redux Toolkit | Heavier boilerplate than this app's state shape needs — most "global" state here is either server data (TanStack Query's job) or URL-shareable filters (the router's job), leaving very little for a store at all | Zustand for the small remainder |
| Jest | Slower, CJS-first, needs extra config to work smoothly with Vite's ESM/TS pipeline that Vitest gets for free | Vitest |
| Axios / other HTTP client libraries | Both Node 24 and the Workers runtime have native `fetch()`; TBA's ETag-based conditional requests work directly against it with no extra dependency | Native `fetch()` |
| Client-side season recomputation (Statbotics' pattern) | Explicitly rejected by the project spec — "do not do that" | Precompute everything server-side/pipeline-side; ship compact finished JSON |
| Binary serialization (MessagePack/CBOR) by default | Adds a dependency and a non-human-readable debugging story for a savings that's often marginal once Cloudflare's automatic compression is factored in | Plain JSON; revisit only after profiling a specific oversized artifact |
| Moment.js | Legacy, large, effectively unmaintained in favor of newer date libraries | Native `Date`/`Intl`, or `date-fns` if genuinely needed |

## Stack Patterns by Variant

**If TBA rate limits ever do tighten (they currently document none, per TBA's own guidance):**
- Lean harder on ETag/If-None-Match conditional requests (already the recommended pattern) so most polls cost a cheap 304 rather than a full payload
- Widen the cron interval automatically when no event is currently live, rather than always polling every minute

**If a future Sigma-version's per-match update genuinely can't fit in 10ms CPU:**
- Split the incremental update itself across more, smaller invocations (multiple staggered Cron Triggers, still under the 5-trigger free cap) rather than reaching for the Workers paid plan, which is out of scope per the project's budget constraint

**If the Compare page's per-algorithm-per-year accuracy table grows into something that needs real cross-event aggregation queries:**
- Reconsider D1 at that point — it's a reasonable escape hatch, just not a Phase 1 default

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| React 19.2.x | Vite 8.2.x, `@tanstack/react-query` 5.x, `@tanstack/react-router` 1.x, Zustand 5.x, Recharts 3.x | All current majors as of Aug 2026 npm registry; no known incompatibilities |
| Vitest 4.1.x | Vite 8.2.x | Vitest tracks Vite's major versions closely by design; keep them upgraded together |
| Wrangler 4.122.x | `@cloudflare/workers-types` (date-versioned) | Always take the latest dated `@cloudflare/workers-types` release rather than pinning — it tracks the Workers runtime's compatibility date, not semver |
| Tailwind CSS 4.3.x | Vite 8.2.x | Tailwind v4's Vite plugin is the supported integration path (no PostCSS config needed) |

## Sources

- Cloudflare official docs, fetched directly (HIGH confidence): `developers.cloudflare.com/workers/platform/pricing/`, `/workers/platform/limits/`, `/kv/platform/limits/` — CPU time, Cron Trigger count/interval, subrequest limits, KV/R2/D1 free-tier quotas
- npm registry API, fetched directly (HIGH confidence): current `latest` versions for react, react-dom, vite, tailwindcss, @tanstack/react-query, react-router, @tanstack/react-router, zustand, jotai, recharts, uplot, vitest, zod, tsx, wrangler, @cloudflare/workers-types, pnpm, date-fns, @playwright/test, @testing-library/react, hono
- nodejs.org release index, fetched directly (HIGH confidence): current Node.js LTS
- Web search synthesis across multiple independent sources, cross-checked (MEDIUM confidence): TanStack Query vs SWR, TanStack Router vs React Router, Zustand vs Jotai, React charting library comparisons, Vitest vs Jest, Pages Functions vs Workers cron support, MessagePack/CBOR vs JSON, Node/TypeScript pipeline tooling conventions
- The Blue Alliance's own "Efficiently Querying the TBA API" blog post (MEDIUM confidence — official source but dated 2017; ETag/conditional-request guidance is architectural and has not been superseded)

---
*Stack research for: FRC match-prediction site (SigmaScout v3), precompute-heavy on Cloudflare free tier*
*Researched: 2026-08-12*
