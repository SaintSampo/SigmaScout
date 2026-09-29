# Phase 4: Publish & Live Update Pipeline - Research

**Researched:** 2026-08-21
**Domain:** Cloudflare Workers free-tier publish/live-update pipeline (Cron Trigger + R2/D1/KV) for a precompute-heavy prediction site
**Confidence:** MEDIUM-HIGH (Cloudflare platform facts fetched directly from official docs this session; in-repo integration points read directly this session; a few numeric claims are cross-checked search synthesis rather than a single authoritative source — flagged where they occur)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Measured against the live 104,925-match corpus at HEAD on 2026-08-21:

| Fact | Value |
|---|---|
| Teams competing per season | 3,150 (2022) → 3,787 (2025) → 3,748 (2026) |
| Events per season | 288–350 |
| Matches per season | 18,215 (2022) – 23,884 (2025) |
| Matches per team per season | avg 32.5–37.8, **max 292** |
| **Peak concurrent events** | **38** (Sat 2026-03-21) |
| **Peak global match throughput** | **~3.5 matches/min** (207 in the busiest hour) |
| Busiest single day | 1,562 matches across 35 concurrent events |
| Sigma1 components per season | 6 (2022), 9 (2023), 13 (2024), 7 (2025), 11 (2026) |
| Sigma1 per-team state | ~2 KB JSON → **~7.5 MB per season** across 3,750 teams |
| OPR `IncrementalInverse` at 3,750 teams | capacity 4096 → **4096² × 8 B = 134 MB**; rank-1 update O(N²) ≈ 16.8M ops/match |
| Corpus on disk | 336 MB (`data/corpus.sqlite`, gitignored) |
| `reports/` on disk | 3.5 GB (gitignored) |
| Algorithms in `ALGORITHMS` registry today | 7 |
| Next live offseason events | `2026azscor` (2026-08-28), `2026scsc` (2026-08-29); 99 more historically in September |

Consequences the planner must honor:
- **OPR's season-pooled state exceeds a Cloudflare Worker's 128 MB isolate limit outright.** This is a shape problem, not a tuning problem — it is what forced D-09.
- **Sigma1's full-season state cannot be loaded per tick** (a 7.5 MB `JSON.parse` is tens of ms against a 10 ms CPU budget), but the ~21 team states a typical tick touches (~42 KB) can. Per-team granular reads are therefore a hard requirement, not a preference (D-13).
- **Per-tick compute is trivial**; at ~3.5 matches/min a 1-minute tick folds ~3–4 results. The pressure is artifact serialization and subrequest count, not model math.

**Artifact shape & publishing layout**

- **D-01:** The unit of a published artifact is **one file per page the site renders** — `teams/{year}`, `team/{teamKey}/{year}`, `events/{year}`, `event/{eventKey}`, `compare/{year}`. One page render = one fetch. — **Reversibility:** costly.
- **D-02:** **Algorithm version rides in the path**, one file per `(page, year, algorithm@version)`. — **Reversibility:** one-way.
- **D-03:** The **published set is the shipped set only**: event-scoped OPR (per D-09), EPA, and the promoted Sigma1 version. The three Phase 2 link-mode variants (`sigma1-seasonsd`, `sigma1-normalcdf`, `sigma1-defaults`) and `sigma1-adapt` stay harness-only.
- **D-04:** Artifacts live at **stable paths, overwritten in place, each carrying a `generation` / `computedAt` stamp inside**. Skew is accepted and visible.
- **D-05:** SC-1's payload budget is a **committed budget file plus a failing test** that measures real published artifacts. The two artifacts most at risk: the year-wide teams table and the 292-match team page.
- **D-06:** Published artifacts are **rounded at publish to display-relevant precision**, and the rounding rule is written down. Unrounded values remain in harness artifacts.
- **D-07:** A **team-season file carries everything the team page renders**: season stats, per-event sections, every match's prediction (winner, confidence, scores, RP ± variance) versus actual, and the metric-history series.
- **D-08:** **Phase 4 publishes scheduled-match simulation parameters** — per-match win probability *and* the full RP pmf for not-yet-played matches — not Phase 8.

**Baselines — OPR becomes event-scoped (requires Phase 3.2, now complete)**

- **D-09:** Season-pooled ridge OPR is retired as the project's baseline. OPR means event-scoped OPR everywhere.
- **D-10:** The swap was sequenced as inserted Phase 3.2, executed before Phase 4 plans. **Phase 3.2 is complete** — this blocker is cleared.
- **D-11:** The season-pooled results are kept as recorded history, not deleted. (Dated errata in the source CONTEXT.md corrects the cited figures and the ridge-term claim — see that file for the full correction; the promoted Sigma1 beats both baselines 8/8 on holdout, per `docs/models/sigma1-tuning-results.md`.)

**Live state & correctness**

- **D-12:** Live state is bootstrapped by an **offline-published state snapshot, with a scheduled re-baseline**. The offline pipeline replays history, publishes both artifacts and a state snapshot, and re-runs on a schedule to overwrite live state. The Worker only loads and advances.
- **D-13:** The state store choice is **deferred to research** (this document), but one requirement is **locked**: the store must support **per-team granular reads**; loading whole-league state per tick is structurally forbidden by the 10 ms budget. Research must resolve, against verified current limits: D1 vs R2-per-object vs a split, and the current Durable Objects free-tier story. **Standing conflict noted:** `.claude/CLAUDE.md` says "D1 — deliberately not used in v1" for reasons about the client read path, not Worker state — if research chooses D1, `CLAUDE.md` must be updated to say so.
- **D-14:** A **replay equivalence test** proves the live incremental path produces the same numbers the offline harness does.
- **D-15:** No live event may be systematically starved — degradation under load must be a bounded delay, never permanent omission.

**Refresh scope & cron design**

- **D-16:** A tick rewrites **the changed event's file and its ~6 affected team files only**. The year-wide Teams table and Events list rebuild on a slower cadence.
- **D-17:** The cron fires **every minute year-round and early-exits when nothing is live**.
- **D-18:** **Liveness comes from an offline-published live-windows manifest.**
- **D-19:** The **polling structure is deferred to research**, gated on: **do R2/D1 binding calls count toward the free plan's 50-subrequest-per-invocation cap?** If they do, a peak tick is ~38 TBA polls + ~21 state reads + ~21 state writes ≈ 80 and blows the cap; if they do not, 38 fits with 12 to spare. Candidate mechanisms: rotating start offset with a per-tick cap, sharding across staggered cron triggers (5 available), or both. A 304 costs the same subrequest as a 200; the 10 ms limit is CPU time, not wall-clock, so waiting on fetches is free.

**Measurement & proof**

- **D-20:** SC-2's freshness is proven by the **replay rig driving the deployed Worker**. A live offseason event remains available as optional later confirmation, not required to close SC-2.
- **D-21:** CPU is measured on a **deployed Worker under replayed load, read from Cloudflare's own reporting**. Must call out the worst-case tick.
- **D-22:** The Worker **reuses the existing TBA throttle and counter**: `THROTTLE_INTERVAL_MS = 100` and `TbaRequestCounter` from `packages/ingest/tbaClient.ts`.
- **D-23:** All measured numbers land in **one committed budget doc** — CPU per tick, R2/KV write volume per event-day, TBA request counts, and per-artifact payload sizes.

**Publish & serving**

- **D-24:** Artifacts are published by a **local CLI command** (`pnpm publish:artifacts`-shaped) running the precompute against the local corpus and uploading to R2. Cloudflare token lives in the same untracked `.env` as `TBA_API_KEY`.
- **D-25:** The browser reads artifacts from an **R2 custom domain with no compute in the path**.
- **D-26:** Caching is **short `max-age` (~60 s) plus ETag revalidation**.
- **D-27:** The Worker is **deployed manually via `wrangler deploy`**, with the TBA key set once through `wrangler secret put`.

**Tension the planner must resolve**

**D-12 schedules a re-baseline; D-24 makes publishing a local CLI command.** A scheduled re-baseline that only runs when a laptop is on is not really scheduled. The planner must either (a) define the re-baseline cadence as an explicitly manual pre/post-event-weekend operation and say so plainly in the budget doc, or (b) surface CI-based publishing (corpus snapshot in R2, GitHub Actions pulls it) as a follow-on. Do not silently assume automation D-24 does not provide.

### Claude's Discretion

- Per-field numeric precision under D-06, and whether probabilities/RP distributions keep more digits than display metrics.
- Whether D-08's RP distribution for scheduled matches is produced by Monte Carlo or by deterministic numerical integration — the 10 ms budget may decide it.
- The exact slower cadence for D-16's global-table rebuild (fixed interval, event-boundary triggered, or both).
- The state snapshot's serialization format and how it is keyed by algorithm version.
- Wave/plan decomposition across precompute, Worker, storage, serving, and the replay rig.
- Where the D-23 budget doc lives under `docs/` and its exact shape.
- Whether the D-05 budget test and the D-23 budget doc share a machine-readable source or stay separate.

### Deferred Ideas (OUT OF SCOPE)

- A thin read Worker or Pages Function in front of R2 — add only against a measured need.
- CI-based publishing (corpus snapshot in R2, GitHub Actions pulls and publishes) — deferred by D-24.
- Auto-deploy of the Worker on push to main — deferred by D-27.
- A slim search index split out of the year-wide Teams table.
- Cache policy split by liveness (long immutable cache for finished seasons, short for live events).
- Publishing all archived promoted versions indefinitely.
- Statbotics external-validation channel (`WINDOWS.md` #1/#2) — lands in Phase 8.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-03 | Full-season precompute runs offline and publishes compact, versioned artifacts that the site reads — no server-side or client-side recomputation per request | Publish/serving pattern below (D-24/D-25); artifact schema example under Code Examples; `pnpm publish:artifacts`-shaped CLI recommendation reusing `packages/harness/artifact.ts`'s validate-then-write discipline |
| DATA-04 | During active events, new match results are reflected on the site within ~1–3 minutes via an incremental update path | Cron Trigger mechanics, subrequest-budget resolution (D1 batching), replay-rig-against-`scheduled()` pattern, D-16's scoped-refresh design |
| DATA-05 | All compute and storage fits Cloudflare free tiers (Workers 10 ms CPU per invocation, KV/R2 quotas) and respects TBA rate limits | Verified free-tier numbers (Workers, KV, R2, D1, Durable Objects) below; measurement/observability section for D-21/D-23; TBA politeness discipline reused from `tbaClient.ts` |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./.claude/CLAUDE.md` pins a stack this phase must honor or explicitly reconcile:

- **Wrangler and `@cloudflare/workers-types` are date-versioned; always take latest, don't pin to the doc's example version.** Verified current: `wrangler@4.125.0`, `@cloudflare/workers-types@5.20260821.1` [VERIFIED: npm registry, checked live this session].
- **R2 is the primary artifact store; KV is a thin manifest layer only (1,000 writes/day cap).** This phase's design must not write per-tick bookkeeping to KV.
- **"D1 — deliberately not used in v1"** — CLAUDE.md's stated reason is client-side ad-hoc SQL, which is not what D-13 is asking. D-13 explicitly authorizes this research to resolve the state-store choice and requires `CLAUDE.md` to be updated if D1 is chosen. **This research recommends D1 for live per-team Worker state** (see Architecture Patterns below) — the planner's first task should update the "What NOT to Use" table in `CLAUDE.md` to scope the D1 prohibition correctly (client-facing ad-hoc queries stay off D1; Worker-internal per-team state store is a different concern D-13 opened for reconsideration).
- **A standalone Workers project with Cron Trigger (not Pages Functions) is required** — Pages Functions have no `scheduled()` handler. `apps/worker` is the correct home; `pnpm-workspace.yaml`'s `apps/*` glob was uncommented 2026-08-20 specifically for this [VERIFIED: pnpm-workspace.yaml:1-13, quoted below].
- **Deployment is manual (`wrangler deploy`), no GitHub Actions Cloudflare token** — matches D-27 exactly; no reconciliation needed.
- **Zod is the schema/validation layer** — already at `4.4.3` in the repo [VERIFIED: package.json, dependencies block, read this session] and CLAUDE.md's pinned `4.4.x`; no version drift.

## Summary

Phase 4 turns everything Phases 1–3.2 compute into two things: a **published, page-shaped R2 artifact set** the eventual frontend reads with zero compute, and a **Cloudflare Cron Trigger Worker** that keeps that set fresh within ~1–3 minutes during live events, without ever exceeding the Workers free plan's 10 ms CPU/invocation or 50-subrequests/invocation ceilings. The codebase is already structured for this: `packages/core/algorithms/*` is deliberately Worker-importable (no Node built-ins, enforced by a standing fitness test, `packages/core/isomorphic.test.ts`), and `packages/ingest/tbaClient.ts` already implements the ETag/throttle discipline the Worker's TBA polling reuses verbatim (D-22).

The single most consequential finding this research resolves is **D-19's gating question**: official Cloudflare docs confirm unambiguously that R2, KV, and D1 binding calls **do** count toward the Workers free plan's 50-subrequests-per-invocation cap [CITED: developers.cloudflare.com/workers/platform/limits/]. Under D-13's naive per-object-per-team design (one R2 object per team, ~21 teams touched per tick), a peak tick's subrequest math is TBA polls (up to 38, one per concurrent live event) + 21 R2 state reads + 21 R2 state writes ≈ 80 — over the cap by 30. **D1's batched multi-row API collapses this**: a single `db.batch([...])` call or a single `SELECT ... WHERE team_key IN (...)` prepared statement is one subrequest regardless of row count [CITED: developers.cloudflare.com/d1/worker-api/d1-database/]. Recommending **D1 as the live per-team state store** (not R2-per-object, not season-pooled) turns the state-read/write cost from ~42 subrequests to ~2, leaving comfortable headroom under the 50-subrequest cap even at the measured 38-concurrent-event peak. This directly resolves the standing CLAUDE.md/D-13 conflict — see Project Constraints above.

The second load-bearing finding is that **Durable Objects with SQLite storage are now available on the Workers Free plan** [CITED: developers.cloudflare.com/durable-objects/platform/pricing/], a materially different picture from the state of the platform when `.planning/research/STACK.md` was written (2026-08-12, which characterizes D1/DO topology in more general terms). DO is a viable D-13 alternative to D1 but adds actor-model complexity (per-instance addressing, single-threaded semantics) this project's data shape does not need — a plain D1 database with one `team_state` table, queried and written in batches, is simpler and matches the corpus's existing SQLite mental model (`better-sqlite3` is already a project dependency for the offline pipeline). This research recommends D1 over DO for that reason, while flagging DO as the documented fallback if D1's per-invocation query-count ceiling (50 queries/invocation) or import tooling proves insufficient in practice.

**Primary recommendation:** Build `apps/worker` as a standalone Workers project with a `scheduled()` handler; store live per-team algorithm state in a D1 database (`team_state` table, PK `(algorithmId, teamKey)`), read/written via batched multi-row D1 calls; store the offline-published, versioned page-shaped artifacts in R2 at `{page}/{year|teamKey}/{algorithmId}@{version}.json`-shaped paths served directly off an R2 custom domain with no Worker in the read path (D-25); drive both the offline precompute (`pnpm publish:artifacts`) and a wrangler-`d1 execute --file`-based state re-baseline from one local CLI command (D-24), explicitly documenting that D-12's "scheduled re-baseline" is manual-trigger-only in v1 per the D-12/D-24 tension the CONTEXT.md flags; and prove both the freshness and offline/online-equivalence claims with one replay rig that drives the deployed Worker's `scheduled()` handler via `/cdn-cgi/handler/scheduled` (reachable through `wrangler dev --test-scheduled` locally, or a direct authenticated call against the deployed Worker).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Full-season offline precompute (walk-forward replay, all algorithms) | Node.js pipeline (local, `pnpm publish:artifacts`) | — | No CPU ceiling; already how `packages/harness/cli.ts` operates; must never move into the Worker (ARCHITECTURE.md Anti-Pattern 3) |
| Page-shaped artifact serialization + R2 upload | Node.js pipeline (offline) | — | D-24: the corpus (336 MB) lives locally; publish reads it directly, writes go to R2 over the network |
| Live per-team algorithm state storage | D1 (Worker binding) | R2 (offline snapshot seed only) | D-13's per-team granular-read requirement; D1's batched multi-row API is the only option that keeps the peak-tick subrequest count under the free-plan cap |
| TBA incremental polling | Cloudflare Worker (Cron Trigger) | — | Pages Functions have no `scheduled()` handler (CLAUDE.md, confirmed still true) |
| Per-tick predict/update (Sigma1, EPA, event-OPR) | Cloudflare Worker (Cron Trigger), via `packages/core` | — | `packages/core/algorithms/*` is the shared, Worker-importable module both the harness and the Worker call — this identity is what makes D-14's equivalence claim provable |
| Per-tick artifact rewrite (changed event + ~6 team files) | Cloudflare Worker (Cron Trigger) → R2 | — | D-16's scoped refresh; never a full-season rewrite per tick |
| Slower-cadence global table rebuild (Teams/Events lists) | Cloudflare Worker (Cron Trigger), lower frequency | — | D-16; serializing ~3,750 rows every tick is close to the whole CPU budget by itself |
| Live-windows discovery ("which events are live right now") | Offline-published manifest (R2), read by the Worker | — | D-18: zero TBA subrequests spent on discovery; keeps calendar logic where CPU is cheap |
| Read/serving path (browser fetching artifacts) | R2 custom domain, no compute | — | D-25: keeps the 100k/day Worker request cap irrelevant to page traffic; R2 has zero egress fees |
| Replay rig (freshness proof, offline/online equivalence) | Node.js script driving the deployed Worker's `scheduled()` endpoint | Local `packages/harness/replay.ts` primitives for the offline half | D-20; reuses `WalkForwardSimulator`/`buildSeasonStream` for the "what the harness would have produced" comparison side |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| wrangler | 4.125.0 [VERIFIED: npm registry, checked live this session] | Cloudflare CLI: `apps/worker` scaffolding, local `scheduled()` testing, `d1`/`r2` management, `deploy` | Cloudflare's own tool; CLAUDE.md already pins this family, date-versioned — always take latest |
| `@cloudflare/workers-types` | 5.20260821.1 [VERIFIED: npm registry, checked live this session] | TypeScript types for `ScheduledController`, `R2Bucket`, `D1Database`, `Env` bindings | Needed for type-safe Worker code against the exact runtime this deploys to |
| zod | 4.4.3 [VERIFIED: package.json, dependencies block, read this session] | Schema for published artifacts (mirrors `HarnessArtifactSchema`'s validate-on-write discipline) and for D1 row shapes at the read boundary | Already the project's schema layer (`packages/harness/artifact.ts`); one validation discipline, not two |
| better-sqlite3 | 13.0.3 [VERIFIED: package.json, dependencies block, read this session] | Unchanged — offline pipeline only, never imported by `apps/worker` | Already forbidden from `packages/core` by the standing isomorphic fitness test [VERIFIED: packages/core/isomorphic.test.ts:29, quoted: `/^better-sqlite3$/,`] |
| ml-matrix | 6.15.0 [VERIFIED: package.json, devDependencies block, read this session] | Unchanged — already imported by `packages/core/algorithms/opr.ts` (SVD) and `sigma1/rp/distribution.ts` (Cholesky) | Pure-JS, no native bindings — already passes the isomorphic fitness test that forbids native-module imports from `packages/core`; **verify at first `wrangler deploy` that it bundles cleanly for the Workers runtime** (cheap to confirm, not yet exercised against an actual Worker bundle) [ASSUMED: no native code, based on the passing isomorphic test + training knowledge that ml-matrix is pure JS — not independently confirmed against the Workers bundler this session] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| D1 (binding, no npm package — part of `@cloudflare/workers-types`) | — | Live per-team algorithm state store (D-13) | Every tick's state read (batched `WHERE team_key IN (...)`) and write (`db.batch([...])`) |
| R2 (binding) | — | Published page-shaped artifacts + offline state-snapshot seed file | Every artifact write (offline publish and per-tick incremental rewrite) |
| KV (binding) | — | The live-windows manifest pointer only (D-18), and nothing else | One or a handful of keys, read every tick, written only when the offline manifest republishes — stays far under the 1,000 writes/day cap |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| D1 for live per-team state | Durable Objects (SQLite-backed, free-tier available) [CITED: developers.cloudflare.com/durable-objects/platform/pricing/] | DO gives the same "one RPC call, batched internal reads" subrequest profile, and a more generous per-request CPU budget (30 s default vs. Workers' 10 ms) [CITED: developers.cloudflare.com/durable-objects/platform/limits/], but adds actor-model addressing/instantiation complexity this project's flat per-team-row shape does not need. Revisit if D1's 50-queries-per-invocation ceiling or its import tooling (`wrangler d1 execute --file`, 5 GiB limit) proves insufficient. |
| D1 for live per-team state | R2, one object per team | Simplest mentally, matches D-01's "one file per page" pattern, but costs ~1 subrequest per team touched (no batch-get API on R2 — `get()` is per-key; `list()`/`delete()` batch, `get()` does not [CITED: developers.cloudflare.com/r2/api/workers/workers-api-reference/]). At the measured ~21 teams/tick this alone can consume 42 of the 50-subrequest budget before TBA polling starts — the reason this option is not recommended. |
| Local CLI publish (D-24, locked) | GitHub Actions CI publish | Explicitly deferred by D-24 (corpus is 336 MB, lives locally, expensive to rebuild in CI) — listed in Deferred Ideas, not this phase's job. |

**Installation:**
```bash
# apps/worker (new workspace member)
pnpm add -D wrangler @cloudflare/workers-types --filter worker
pnpm add zod --filter worker

# apps/worker/wrangler.toml — D1 + R2 + KV bindings, one Cron Trigger
```

**Version verification:** `npm view wrangler version` → `4.125.0`; `npm view @cloudflare/workers-types version` → `5.20260821.1`; both checked live this session against the npm registry (see Package Legitimacy Audit below for the "too-new" flag both raise and why it is a false-positive class for these two packages specifically).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| wrangler | npm | published 2026-08-20 (1 day old at research time) | 16,297,434/wk | github.com/cloudflare/workers-sdk | `SUS` (reason: `too-new`) | **Flagged — planner must add `checkpoint:human-verify` before install**, but see note below |
| @cloudflare/workers-types | npm | published 2026-08-21 (same day as research) | 6,971,264/wk | github.com/cloudflare/workerd | `SUS` (reason: `too-new`) | **Flagged — planner must add `checkpoint:human-verify` before install**, but see note below |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** wrangler, @cloudflare/workers-types — both flagged solely on the automated "too-new" heuristic (published within the last 24–48 hours of this research run). Both are officially-maintained Cloudflare packages with an established, high-volume weekly-dated release cadence (Cloudflare ships `@cloudflare/workers-types` roughly daily, keyed to Workers runtime compatibility dates, exactly as CLAUDE.md's own Version Compatibility table already documents: "Always take the latest dated `@cloudflare/workers-types` release rather than pinning"), 16M+ and 7M+ weekly downloads respectively, and legitimate `cloudflare/*` GitHub source repos with no `postinstall` script. This is very likely a **false positive of the "too-new" heuristic against a legitimately fast-shipping first-party package family**, not a supply-chain risk — but per protocol the flag is preserved and the planner should still gate the `pnpm add` behind a cheap `checkpoint:human-verify` (confirm the installed version's repo/publisher match what is shown here) rather than silently overriding the automated verdict.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│ OFFLINE (local machine, D-24) — no CPU ceiling, corpus lives here          │
│                                                                              │
│  data/corpus.sqlite (336 MB)                                               │
│        │                                                                    │
│        ▼                                                                    │
│  pnpm publish:artifacts  (new CLI, reuses packages/harness primitives)     │
│    ├─ walk-forward replay per season/algorithm (WalkForwardSimulator)      │
│    ├─ page-shaped serialization (teams/{y}, team/{k}/{y}, events/{y},      │
│    │    event/{k}, compare/{y}) × algorithm@version (D-01/D-02)           │
│    ├─ rounding to display precision (D-06)                                 │
│    ├─ live-windows manifest (event calendar → active windows, D-18)       │
│    └─ live-state snapshot (per-team Sigma1/EPA/OPR state, D-12)           │
│        │                                       │                           │
│        ▼ R2 PUT (artifacts + manifest)         ▼ D1 bulk import (state)    │
└────────┼───────────────────────────────────────┼───────────────────────────┘
         │                                        │  wrangler d1 execute
         ▼                                        ▼  --remote --file=...
┌──────────────────────────────────────────────────────────────────────────┐
│ ONLINE — apps/worker, Cron Trigger, fires every 1 min (D-17)                │
│                                                                              │
│  scheduled(controller, env, ctx)                                           │
│    │                                                                        │
│    ▼                                                                        │
│  1. Read live-windows manifest from KV (1 op)  ──▶ nothing live? exit early │
│    │ (live)                                                                 │
│    ▼                                                                        │
│  2. For each live event (bounded, capped, rotated — D-15/D-19):            │
│       TBA GET .../event/{key}/matches, If-None-Match: <etag>  (subrequest) │
│       304 → skip; 200 → diff against last-seen match set                   │
│    │                                                                        │
│    ▼ (new/changed matches found)                                           │
│  3. D1: SELECT team_state WHERE team_key IN (touched teams)  (1 subrequest)│
│    │                                                                        │
│    ▼                                                                        │
│  4. packages/core: predict() [leak-proof] → new prediction artifacts       │
│                     update()  → new per-team state                        │
│    │                                                                        │
│    ▼                                                                        │
│  5. D1: batch() INSERT OR REPLACE touched team_state rows  (1 subrequest)  │
│    │                                                                        │
│    ▼                                                                        │
│  6. R2 PUT: changed event file + ~6 affected team files (D-16)             │
│             (each PUT = 1 subrequest, Class A)                             │
│    │                                                                        │
│    ▼                                                                        │
│  7. (slower cadence) rebuild teams/{year}, events/{year} global tables     │
└──────────────────────────────────────────────────────────────────────────┘
         │
         ▼ R2 custom domain, no Worker (D-25)
┌──────────────────────────────────────────────────────────────────────────┐
│ SERVING — Cloudflare-cached static reads, Cache-Control ~60s + ETag (D-26) │
│   Phases 5-8's React pages fetch directly; zero compute per read           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/
└── worker/
    ├── wrangler.toml            # [triggers] crons = ["* * * * *"]; D1/R2/KV bindings
    ├── src/
    │   ├── scheduled.ts         # scheduled() entrypoint — orchestration only
    │   ├── liveWindows.ts       # reads the D-18 manifest from KV, decides what's live
    │   ├── tbaPoll.ts           # thin wrapper around packages/ingest/tbaClient.ts (D-22 reuse)
    │   ├── stateStore.ts        # D1 read/write helpers — batched multi-team get/put
    │   ├── artifactWriter.ts    # R2 read/write helpers, page-path builders (D-01/D-02)
    │   └── subrequestBudget.ts  # D-15/D-19: rotation/cap bookkeeping, never starves
    ├── migrations/              # D1 schema (wrangler d1 migrations)
    │   └── 0001_team_state.sql
    └── test/
        └── scheduled.replay.test.ts  # drives scheduled() against replayed history (D-20)

packages/
├── core/                        # UNCHANGED — already Worker-importable (isomorphic.test.ts)
├── harness/
│   └── publish.ts               # NEW: pnpm publish:artifacts — offline precompute → R2 + D1 seed
└── ...
```

### Structure Rationale

`apps/worker` never imports `better-sqlite3` or the corpus directly — it only ever sees D1/R2/KV bindings and `packages/core`'s pure `predict`/`update` functions, exactly the boundary `packages/core/isomorphic.test.ts` already enforces [VERIFIED: packages/core/isomorphic.test.ts:22-30, quoted: `const FORBIDDEN_SPECIFIERS: readonly RegExp[] = [` … `/^better-sqlite3$/,` … `];`]. `packages/harness/publish.ts` is the new offline-side module — it is free to import the corpus (`openCorpusReadOnly`) and reuse `buildSeasonStream`/`WalkForwardSimulator` exactly as `packages/harness/cli.ts` already does, just serializing page-shaped output instead of (or alongside) the existing scoring artifact.

### Pattern 1: D1 as the per-team live-state store (resolves D-13/D-19)

**What:** One D1 database, one `team_state` table keyed `(algorithm_id, team_key)`, storing each team's serialized JSON state blob (Sigma1: beliefs/covariance/consistency/innovationStats/RP state; EPA/OPR: their own smaller shapes). Every tick reads and writes via **batched** multi-row operations, never one query per team.

**When to use:** The live incremental Worker path, always — this is what makes D-13's "per-team granular reads" requirement compatible with D-19's subrequest cap.

**Why this resolves D-19:** Official Cloudflare docs confirm R2/KV/D1 binding calls count as subrequests against the free plan's 50/invocation cap [CITED: developers.cloudflare.com/workers/platform/limits/, quoted: "A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1."]. R2's `get()`/`put()` are per-object, no multi-key batch-get exists [CITED: developers.cloudflare.com/r2/api/workers/workers-api-reference/] — so 21 teams touched in one tick costs 21 R2 reads + 21 R2 writes = 42 subrequests before a single TBA poll happens. D1's `batch()` sends "multiple SQL statements inside a single call to the database" [CITED: developers.cloudflare.com/d1/worker-api/d1-database/, quoted: "This can have a huge performance impact as it reduces latency from network round trips to D1."] — one `db.batch([...])` invocation is one subrequest regardless of statement count, and a single `SELECT * FROM team_state WHERE team_key IN (?, ?, ...)` prepared statement reads an arbitrary number of rows in one call. This collapses the per-tick state cost from ~42 subrequests to ~2 (one batched read, one batched write).

**Worked subrequest budget at the measured 38-concurrent-event peak (D-15/D-19):**

| Item | Count | Notes |
|---|---|---|
| TBA polls (one per live event this tick attempts) | up to 38 | D-22's ETag-conditional `tbaFetch`; a 304 still costs one subrequest |
| D1 state read (batched) | 1 | `SELECT ... WHERE team_key IN (...)` across every touched team this tick |
| D1 state write (batched) | 1 | `db.batch([...])` — one INSERT/UPSERT per touched team, one round trip |
| R2 artifact writes | ~6–8 per changed event (D-16: 1 event file + ~6 team files) | Not batchable — each PUT is its own subrequest |
| **Total, worst realistic case** | **~46–49** | Under the 50 cap, but with little slack if every one of 38 events also changes in the same tick — D-15's rotation/cap mechanism is still needed for the true worst case (see Pitfall 1 below) |

**Trade-offs:** D1 adds a second storage system to the deploy (alongside R2/KV), and its 50-queries-per-invocation cap [CITED: developers.cloudflare.com/d1/platform/limits/] means a single `scheduled()` invocation cannot issue more than 50 separate D1 calls — irrelevant at this project's ~2-calls-per-tick design, but worth stating as a ceiling if the design changes later.

```typescript
// Illustrative shape, not verified against a real D1 schema this session —
// the planner designs the actual migration.
const touchedTeams = ["frc254", "frc971", /* ...~21 total */];
const placeholders = touchedTeams.map(() => "?").join(",");
const { results } = await env.DB.prepare(
  `SELECT team_key, state_json FROM team_state WHERE algorithm_id = ? AND team_key IN (${placeholders})`
).bind("sigma1", ...touchedTeams).all(); // 1 subrequest

// ...run predict()/update() from packages/core...

await env.DB.batch(
  updatedTeams.map((t) =>
    env.DB.prepare(
      `INSERT INTO team_state (algorithm_id, team_key, state_json) VALUES (?, ?, ?)
       ON CONFLICT(algorithm_id, team_key) DO UPDATE SET state_json = excluded.state_json`
    ).bind("sigma1", t.teamKey, JSON.stringify(t.state))
  )
); // 1 subrequest for the whole batch
```

### Pattern 2: Live-windows manifest as the sole liveness source (D-18)

**What:** The offline publish step writes one small KV value (or R2 object read once per tick and cached in KV) listing currently-active event windows, derived from the full calendar the offline pipeline already holds. The Worker's first action every tick is reading this one object; if nothing is live, it exits before spending any TBA subrequest.

**When to use:** Every tick, unconditionally, as step 1.

**Trade-offs:** The manifest is only as fresh as the last offline publish — an event whose start/end time is genuinely unknown until the pipeline republishes will not be picked up until that republish happens. Acceptable per D-18's own reasoning (a hardcoded calendar goes stale; this manifest is refreshed by the same publish step that already runs).

### Pattern 3: Replay rig driving the real `scheduled()` handler (D-20)

**What:** A local test/script pushes recorded historical match data through the deployed Worker's actual `scheduled()` entrypoint via the `/cdn-cgi/handler/scheduled` HTTP-triggerable route [CITED: developers.cloudflare.com/workers/configuration/cron-triggers/], measuring wall-clock latency from "result available" to "artifact updated," and separately asserts the resulting D1 state / R2 artifacts match what `packages/harness`'s offline replay of the same slice produces (the equivalence half, D-14).

**When to use:** Both the freshness proof (SC-2) and the offline/online equivalence proof (D-14) — this is the "dual-purpose" rig D-20 names.

**Local testing mechanics, verified this session:**
- `wrangler dev --test-scheduled` exposes a local HTTP route to trigger the `scheduled()` handler without waiting for a real cron tick; the cron pattern is passed as a query parameter (e.g. `?cron=*+*+*+*+*`, spaces URL-encoded as `+`) [CITED: developers.cloudflare.com/workers/configuration/cron-triggers/].
- Against a **deployed** Worker (not local dev), the same `/cdn-cgi/handler/scheduled` route is reachable over HTTPS and can be driven by an authenticated script — this is what D-20/D-21 actually require, since D-21 explicitly rejects local `wrangler dev` timing as evidence ("Local `wrangler dev` timing is not evidence").
- Miniflare/local dev does **not** auto-fire cron schedules — a job must trigger the route manually or via the `s` keyboard shortcut while `wrangler dev` is running [CITED: cross-referenced community/third-party sources, MEDIUM confidence — the official Cloudflare page does not itself say this explicitly].

```typescript
// Illustrative replay-rig driver shape (Node, offline side)
for (const match of recordedHistoricalMatches) {
  const start = Date.now();
  // ... feed `match` into whatever fixture/mock TBA endpoint the deployed
  // Worker's TBA client reads from during this replay run ...
  await fetch(`https://${WORKER_URL}/cdn-cgi/handler/scheduled`, { method: "POST" });
  // poll the published R2 artifact until it reflects `match`, record elapsed time
}
```

### Anti-Patterns to Avoid

- **R2-per-team-object as the live state store:** costs ~1 subrequest per team touched with no batch-get available, directly recreating D-19's blown-budget scenario. Use D1's batched multi-row API instead (Pattern 1).
- **Loading whole-season state per tick (season-pooled JSON.parse):** explicitly forbidden by D-13's own reasoning — a 7.5 MB parse is tens of ms against a 10 ms CPU budget. Always read/write only the teams a tick actually touches.
- **Treating a 304 as free:** ETags save R2/D1 bandwidth and CPU, but a 304 response still consumes one TBA subrequest — D-19 already states this; don't budget as if conditional requests are subrequest-free.
- **Writing per-tick bookkeeping (ETag cache, last-seen match set) to KV:** KV's 1,000 writes/day free cap is easily exceeded by a naive per-event-per-tick write pattern during a multi-event event day (STACK.md/PITFALLS.md both flag this explicitly). Keep KV to the D-18 manifest pointer only; per-tick ETag/cursor bookkeeping belongs in D1 alongside team state.
- **Assuming the Worker's own I/O wait (fetch/D1/R2 round trips) counts against the 10 ms CPU budget:** it does not — CPU time excludes network wait [CITED: developers.cloudflare.com/workers/platform/limits/]. Design the budget conversation around actual JS compute (JSON serialize/parse, predict/update math), not wall-clock latency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TBA conditional-request politeness | A second ETag/throttle client inside `apps/worker` | `packages/ingest/tbaClient.ts`'s `tbaFetch`/`THROTTLE_INTERVAL_MS`/`TbaRequestCounter`, imported unchanged (D-22) | Two TBA clients drifting is exactly ARCHITECTURE.md Anti-Pattern 2; one already exists, already tested, already exposes a request counter for D-23's measurement |
| Predict/update math for OPR/EPA/Sigma1 | A Worker-specific reimplementation "for speed" | `packages/core/algorithms/*` unchanged | This is the whole point of the isomorphic boundary — D-14's equivalence claim is only true if the Worker imports the SAME functions the harness does |
| Multi-row D1 reads/writes | A hand-rolled loop issuing one `db.prepare(...).bind(...).run()` per team | `db.batch([...])` / a single `WHERE ... IN (...)` prepared statement | The whole reason D1 was chosen over R2-per-object is the batching; a per-team loop reproduces the exact subrequest-blowup this pattern exists to avoid |
| JSON schema validation for published artifacts | Ad-hoc `if`-checks on artifact shape before writing to R2 | Zod schemas following `packages/harness/artifact.ts`'s `HarnessArtifactSchema` pattern (validate-on-write, throw rather than publish malformed data) | Already the project's established discipline; D-05's budget test needs a stable, parseable artifact shape to measure against |
| Cron-trigger scheduling logic ("is it a live event right now") | Hardcoded per-season date ranges or an ad-hoc calendar check inside the Worker | D-18's offline-published live-windows manifest | A hardcoded calendar is exactly the kind of silent-staleness risk D-18 was written to prevent (offseason events, shifting championship dates) |

**Key insight:** Every "don't hand-roll" item above already has a working, tested implementation sitting in the repo from Phases 1–3 — this phase's job is almost entirely *reuse and orchestrate*, not build new algorithmic logic. The one genuinely new piece of engineering is the D1 batching layer and the subrequest-budget bookkeeping (Pattern 1/D-15), which has no existing analog to reuse.

## Common Pitfalls

### Pitfall 1: Treating the worked subrequest budget (~46–49) as a hard guarantee rather than a typical case

**What goes wrong:** The Pattern 1 budget table above assumes one changed event's ~6 team files per changed event, applied once. If an elimination-bracket flurry resolves several matches across several DIFFERENT events in the same 1-minute tick — a scenario the CONTEXT.md's D-21 explicitly calls out ("an elimination-bracket flurry resolving at once") — the R2 write count (D-16's ~6-8 per changed event) multiplies per event, and the budget can exceed 50 well before reaching the theoretical 38-event ceiling.

**Why it happens:** The worked budget above is a per-event average, not a per-tick worst case across multiple simultaneously-resolving events.

**How to avoid:** D-15's own requirement — bounded delay, never permanent omission — is the intended mitigation. The planner must design `subrequestBudget.ts` (recommended project structure) to track a running subrequest count within the tick and defer any event's artifact writes past the cap to the NEXT tick (a rotating start offset, per D-19's candidate mechanisms), rather than attempting all changed events in one invocation and throwing when the 50th subrequest is exceeded.

**Warning signs:** A `scheduled()` invocation error correlated with high concurrent-event days in Cloudflare's Workers Logs; artifacts for some events staying stale for more than the ~1-3 min target on exactly the busiest days.

### Pitfall 2: Assuming D1's "eventually consistent" read model matches R2/KV's

**What goes wrong:** D1 is a real transactional SQL database (SQLite-based) — `batch()` calls are wrapped in a transaction and roll back atomically on failure [CITED: developers.cloudflare.com/d1/worker-api/d1-database/, quoted: "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."]. This is a materially different failure model from R2 (each `put()` succeeds or fails independently) or KV (eventually consistent, ~60s global propagation, per PITFALLS.md Pitfall 9). Code that assumes a partial D1 batch write can "partially succeed" (e.g. assuming 15 of 21 team writes landed) will be wrong.

**How to avoid:** Treat a failed `db.batch()` write as "none of these teams' state advanced this tick" — retry the whole batch or defer to the next tick, never assume partial application.

### Pitfall 3: Publishing the artifact write before the state write succeeds (or vice versa)

**What goes wrong:** If the Worker writes R2 artifacts reflecting a match result before D1's state write for that match's teams commits, a crash between the two steps leaves a published page showing a result the live state has not actually folded in yet — the next tick's `predict()` would then be computed from stale state while the page already shows the newer outcome.

**How to avoid:** Order matters: `update()` → D1 write → R2 artifact write (state is the source of truth; the artifact is a projection of it). If the D1 write fails, do not proceed to the R2 write for that event this tick.

### Pitfall 4: Forgetting that the `10 ms` CPU-time figure is per-invocation, not per-tick-of-work

**What goes wrong:** If a single `scheduled()` invocation attempts to process all 38 concurrent events' worth of predict/update/serialize work in one pass, even though each event's work is individually cheap, the SUM across 38 events could plausibly approach or exceed 10 ms of actual JS execution — this is exactly ARCHITECTURE.md's Anti-Pattern 3 ("probably fine, we'll optimize if needed").

**How to avoid:** D-21 already mandates measuring the worst-case tick on a deployed Worker under replayed load, not assuming headroom. Build the replay rig (Pattern 3) to specifically construct a worst-case scenario (peak concurrency + simultaneous match completions) before considering SC-3 satisfied, not just an average-case tick.

### Pitfall 5: Assuming ml-matrix (SVD/Cholesky) bundles into the Worker without friction

**What goes wrong:** `packages/core/algorithms/opr.ts` and `sigma1/rp/distribution.ts` both import `ml-matrix` for numerical linear algebra. It passes the project's own isomorphic fitness test (no forbidden Node-only imports), but that test only scans direct import specifiers in `packages/core` source files — it does not scan `ml-matrix`'s own dependency tree, and Wrangler's bundler (esbuild-based) can still surface issues (large bundle size against Workers' script-size limits, or an unexpected transitive dependency) that only show up at actual `wrangler deploy`/`wrangler dev` time.

**How to avoid:** Run a real `wrangler dev` build of `apps/worker` importing `packages/core` early in the phase (not as a late integration surprise) and confirm the bundle builds and the OPR/Sigma1 predict/update path executes correctly inside the Workers runtime, not just under Node/Vitest.

## Code Examples

### Page-shaped artifact schema, following the project's established validate-on-write pattern

```typescript
// Source: pattern established in packages/harness/artifact.ts's HarnessArtifactSchema
// (VERIFIED: packages/harness/artifact.ts:100-109, quoted below), extended for a
// per-page artifact rather than the harness scoring artifact. Illustrative shape —
// exact fields are the planner's job, informed by D-07's team-season contract.
import { z } from "zod";

const TeamSeasonArtifactSchema = z.object({
  schemaVersion: z.number().int(),
  generation: z.string().min(1), // D-04: computedAt/generation stamp
  computedAt: z.string().min(1),
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1), // D-02: rides in the path too
  teamKey: z.string().min(1),
  season: z.number().int(),
  seasonStats: z.object({ record: z.string(), winRate: z.number(), metrics: z.record(z.string(), z.object({ value: z.number(), spread: z.number().optional() })) }),
  events: z.array(z.object({ eventKey: z.string(), matches: z.array(z.unknown()) })), // D-07
  metricHistory: z.array(z.unknown()), // D-07's per-match series
});
```

Quoted source this pattern is modeled on — `HarnessArtifactSchema`'s top-level shape:
```typescript
// packages/harness/artifact.ts:100-107 (VERIFIED, read this session)
export const HarnessArtifactSchema = z.object({
  schemaVersion: z.number().int(),
  provenance: ProvenanceSchema,
  algorithms: z.array(AlgorithmDescriptorSchema).min(1),
  slices: z.array(ScoreSliceSchema),
  statboticsReferences: z.array(StatboticsReferenceSchema),
});
```

### D1 wrangler.toml binding shape (illustrative, standard Cloudflare pattern)

```toml
# apps/worker/wrangler.toml
name = "sigmascout-worker"
main = "src/scheduled.ts"
compatibility_date = "2026-08-21"

[triggers]
crons = ["* * * * *"]  # D-17: every minute, year-round

[[d1_databases]]
binding = "DB"
database_name = "sigmascout-state"
database_id = "<uuid>"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "sigmascout-artifacts"

[[kv_namespaces]]
binding = "MANIFEST"
id = "<uuid>"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `.planning/research/STACK.md`'s Aug-12 framing: "D1 — deliberately not used in v1," topology built around R2 (artifacts) + KV (thin manifest) only | Durable Objects with SQLite storage are now confirmed available on the Workers **Free** plan, and D1's batching API is confirmed the right tool for D-13's per-team-granular-read requirement specifically | This research session (2026-08-21) — the D1-not-used decision in STACK.md was scoped to "the client read path doesn't need ad-hoc SQL," which is still true and unaffected; it never evaluated D1 as a *Worker-internal state store*, which is the new question D-13 opened | The planner should update `CLAUDE.md`'s "What NOT to Use" table to scope the D1 exclusion correctly (client-facing queries only), not remove it outright — R2-as-primary-artifact-store and KV-as-thin-manifest both remain correct and unchanged |
| CLAUDE.md's stated "5 Cron Triggers per account... 1-minute minimum interval" | Confirmed structurally unchanged: standard 5-field cron syntax only supports minute-level granularity (no sub-minute field), so "1 minute minimum" is an accurate practical description even though the current docs page does not state a numeric minimum explicitly [CITED: developers.cloudflare.com/workers/configuration/cron-triggers/] | — | No planning impact; D-17's "every minute" design is confirmed achievable |

**Deprecated/outdated:** Nothing in this phase's stack is deprecated. `wrangler`/`@cloudflare/workers-types` are both actively, frequently released (see Package Legitimacy Audit) — always re-check `npm view` immediately before `pnpm add` at execution time, since both ship dated releases faster than this research can stay current.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ml-matrix` has no native/Node-only dependencies and will bundle cleanly into a Workers build | Standard Stack (Core table) | If wrong, `opr.ts`/`sigma1/rp/distribution.ts` cannot run inside the Worker unchanged, breaking D-14's shared-code equivalence claim outright — would force either a pure-JS reimplementation of SVD/Cholesky inside the Worker (a second implementation, violating ARCHITECTURE.md Anti-Pattern 2) or moving the RP pmf computation entirely offline (conflicts with D-08's "Phase 4 publishes scheduled-match parameters" requirement). **Mitigation already named in Pitfall 5: verify via a real `wrangler dev` build early, not late.** |
| A2 | Miniflare/local `wrangler dev` does not auto-fire cron schedules (must be manually triggered) | Architecture Patterns, Pattern 3 | LOW risk — this affects only the convenience of local iteration, not correctness; D-20/D-21 already mandate testing against a deployed Worker regardless, so this claim does not gate any decision |
| A3 | The 46–49-subrequest worked budget (Pattern 1) is representative of a typical, not worst-case, peak tick | Architecture Patterns, Pattern 1 / Common Pitfalls, Pitfall 1 | Already flagged explicitly as a pitfall with a named mitigation (D-15's rotation/deferral); not a silent risk |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Does the D1 free tier's "50 queries per Worker invocation" cap interact with `batch()` differently than a plain loop of `prepare().run()` calls?**
   - What we know: `batch()` is documented as reducing "network round trips," strongly implying it is one round trip (and likely one query-count unit) regardless of statement count [CITED: developers.cloudflare.com/d1/worker-api/d1-database/].
   - What's unclear: the fetched docs did not give an explicit statement about whether a 21-statement `batch()` call counts as 1 or 21 against the "50 queries per invocation" limit.
   - Recommendation: cheap to resolve empirically — the planner's first D1 integration task should log/inspect the actual subrequest count Cloudflare reports for a real `batch()` call of realistic size (e.g. via Workers Observability's per-invocation subrequest count) before finalizing the budget math in Pattern 1's table.

2. **Exact current wording of the Cron Trigger minimum interval.**
   - What we know: standard cron syntax supports only minute-level granularity, so `* * * * *` (every minute) is the practical floor; CLAUDE.md's prior research stated "1-minute minimum interval" explicitly.
   - What's unclear: the current `developers.cloudflare.com/workers/configuration/cron-triggers/` page, fetched directly this session, does not itself state a numeric minimum — it only documents the 5-field syntax.
   - Recommendation: not blocking — D-17 already designs for exactly 1-minute ticks, which is achievable either way; no different design would follow from a different answer here.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Cloudflare account with Workers/R2/D1/KV enabled | Entire phase | Unverified this session — no Cloudflare credentials/CLI auth check was run | — | Blocking if absent; D-27 already requires a manual `wrangler deploy` + `wrangler secret put` step, so account setup is an explicit prerequisite the planner should surface as an early checkpoint task |
| `wrangler` CLI installed/authenticated locally | Local dev, D1 migrations, deploy | Not yet installed (no `apps/worker` package.json exists yet — confirmed via `ls apps` returning empty this session) | — (would install `4.125.0` per Standard Stack) | None needed — this is exactly what the phase's first plan installs |
| TBA API key (`TBA_API_KEY`) | Worker's TBA polling, reused via D-22 | Already configured for the offline pipeline (`.env`, referenced by `packages/ingest/tbaClient.ts` and covered by `scripts/secrets-boundary.test.ts`) [VERIFIED: scripts/secrets-boundary.test.ts:92-119, read this session] | — | The Worker needs its OWN copy set via `wrangler secret put` (D-27) — the existing `.env` value is not automatically available to the deployed Worker; this is a distinct provisioning step, not a re-use of the same secret storage |

**Missing dependencies with no fallback:**
- Cloudflare account/credentials — must be confirmed available before any `wrangler deploy` work begins; recommend the planner's first plan include a checkpoint verifying this rather than discovering it mid-phase.

**Missing dependencies with fallback:**
- None — `wrangler`/`@cloudflare/workers-types`/D1/R2/KV are all provisioned by this phase's own work, not pre-existing gaps.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 [VERIFIED: package.json, devDependencies block, read this session] |
| Config file | `vitest.config.ts` (repo root) [VERIFIED: file exists, confirmed via directory listing this session] |
| Quick run command | `pnpm test -- <path-to-new-test-file>` |
| Full suite command | `pnpm test` (root script: `"test": "vitest run"`, 45 existing `*.test.ts` files across the repo as of this research) [VERIFIED: package.json scripts block + directory listing, this session] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-03 | Full-season offline precompute publishes page-shaped, schema-valid artifacts covering every page | unit/integration | `pnpm test -- packages/harness/publish.test.ts` | ❌ Wave 0 — new `publish.ts` + schema |
| DATA-03 | Published artifact payload sizes stay within the D-05 committed budget | unit (budget test reading real published output) | `pnpm test -- packages/harness/payloadBudget.test.ts` | ❌ Wave 0 |
| DATA-04 | A replayed historical match result is reflected in a published artifact within the freshness target, via the deployed `scheduled()` handler | integration (replay rig against deployed Worker, not local `wrangler dev`) | new script under `apps/worker/test/scheduled.replay.test.ts` or a standalone `scripts/replayRig.ts`, run manually/CI-gated | ❌ Wave 0 |
| DATA-04 | Live incremental path produces identical numbers to the offline harness for the same historical slice (D-14) | integration (equivalence assertion) | reuses the same replay rig as above, asserting D1/R2 state == offline harness state | ❌ Wave 0 — shares fixture data with the freshness test |
| DATA-05 | Peak-tick subrequest count stays under 50 | integration, measured against a deployed Worker (not simulated) | Workers Observability / Logpush inspection during a replay-rig run, recorded into the D-23 budget doc | ❌ Wave 0 — no automated assertion possible without a live deploy; this is inherently a measured-and-recorded item, not a green/red test |
| DATA-05 | Peak-tick CPU time stays under 10 ms | same as above | same as above | ❌ Wave 0, same caveat |
| DATA-05 | TBA request counts stay within a documented, considerate bound | unit (reuses existing `TbaRequestCounter`) | extends existing `packages/ingest/tbaClient.test.ts` coverage | ✅ pattern exists — `TbaRequestCounter` is already tested; a Worker-specific assertion is new but the primitive is proven |

### Sampling Rate

- **Per task commit:** `pnpm test -- <touched-file>.test.ts` (fast, scoped)
- **Per wave merge:** `pnpm test` (full 45+ file suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`, **plus** the D-21/D-23 measured-numbers-in-the-budget-doc requirement, which is not a pass/fail unit test by nature (it is "a number was measured against a deployed Worker and recorded") — the planner must make this an explicit, separately-tracked verification item, not assume the automated test suite covers it.

### Wave 0 Gaps

- [ ] `packages/harness/publish.ts` + `publish.test.ts` — the new offline page-shaped-artifact publisher (DATA-03)
- [ ] `packages/harness/payloadBudget.test.ts` — D-05's committed budget file + failing test
- [ ] `apps/worker/` package scaffold (no `package.json` exists yet — confirmed empty `apps/` directory this session) — framework install: `pnpm add -D wrangler @cloudflare/workers-types --filter worker`
- [ ] `apps/worker/migrations/0001_team_state.sql` — D1 schema (D-13)
- [ ] A replay-rig driver script/test (D-20/D-14) — no existing analog; closest precedent is `packages/harness/replay.ts`'s `WalkForwardSimulator`, which this rig's OFFLINE half reuses directly

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This phase has no user-facing auth surface (NAV-level auth is explicitly out of scope per PROJECT.md) |
| V3 Session Management | no | No sessions in scope |
| V4 Access Control | yes | Cloudflare API tokens (Worker's TBA key via `wrangler secret put`, D-27; the deploy-time Cloudflare account token, D-24) must carry least-privilege scopes, not account-wide access — standard Cloudflare API token scoping, not a custom control |
| V5 Input Validation | yes | Zod schemas at every artifact-write and D1-row boundary, following `HarnessArtifactSchema`'s established validate-on-write discipline — never publish/store a value that failed its schema |
| V6 Cryptography | no | No new cryptographic surface in this phase — TBA auth is an opaque API key header (`X-TBA-Auth-Key`), unchanged from Phase 1 [VERIFIED: packages/ingest/tbaClient.ts:79-84, read this session] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| TBA API key committed to git or exposed in a published artifact | Information Disclosure | Same discipline `scripts/secrets-boundary.test.ts` already enforces for the offline pipeline (`.env` gitignored, hash-compared against `.env.example`) [VERIFIED: scripts/secrets-boundary.test.ts:1-21, read this session] must extend to the Worker's own secret, set via `wrangler secret put` (D-27) rather than committed to `wrangler.toml` |
| A malformed/partial pipeline run publishes broken artifacts the site then serves as valid | Tampering / Denial of Service (of correctness) | `writeArtifact`'s existing pattern — validate via Zod, throw rather than write a malformed object [VERIFIED: packages/harness/artifact.ts:179-189, read this session] — extended to the new page-shaped artifacts and to D1 state writes |
| A failed/partial D1 `batch()` write leaves live state and published artifacts inconsistent (Pitfall 3 above) | Tampering (data integrity) | Sequence state-write-then-artifact-write, never the reverse; treat a failed batch as "nothing advanced this tick," never partially applied |
| Overloaded tick starves a live event's freshness indefinitely (D-15) | Denial of Service | D-15's own requirement — bounded delay via rotation/deferral (Pitfall 1), never permanent omission |

## Sources

### Primary (HIGH confidence)
- `developers.cloudflare.com/workers/platform/limits/` — fetched directly this session; Workers Free plan CPU time (10 ms/invocation), subrequest cap (50/invocation, confirmed to include R2/KV/D1 binding calls), 5 Cron Triggers/account, 100,000 requests/day, CPU-time-excludes-I/O-wait
- `developers.cloudflare.com/kv/platform/pricing/` — fetched directly this session; KV free tier (100k reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 list ops/day, 1 GB storage)
- `developers.cloudflare.com/r2/pricing/` — fetched directly this session; R2 free tier (10 GB storage, 1M Class A ops/month, 10M Class B ops/month, zero egress) and Class A/B operation definitions
- `developers.cloudflare.com/durable-objects/platform/pricing/` and `.../platform/limits/` — fetched directly this session; SQLite-backed DO available on Free plan, 100k compute requests/day, 13,000 GB-s/day compute duration, 5M SQLite reads/day, 100k SQLite writes/day, 5 GB total storage, 30s default CPU/request
- `developers.cloudflare.com/d1/platform/limits/` and `.../platform/pricing/` — fetched directly this session; D1 free tier (5M rows read/day, 100k rows written/day, 5 GB total storage, 500 MB/database, 10 databases/account, 50 queries/invocation)
- `developers.cloudflare.com/d1/worker-api/d1-database/` — fetched directly this session; `batch()`/`prepare()`/`exec()` semantics, batch-as-transaction behavior
- `developers.cloudflare.com/r2/api/workers/workers-api-reference/` — fetched directly this session; `get()`/`put()`/`head()`/`list()`/`delete()` semantics, conditional `onlyIf` support, no batch-get, `httpMetadata.cacheControl` support at write time
- `developers.cloudflare.com/workers/configuration/cron-triggers/` — fetched directly this session; wrangler.toml/jsonc cron syntax, `scheduled()` handler signature, `/cdn-cgi/handler/scheduled` local test route
- `developers.cloudflare.com/d1/best-practices/import-export-data/` — fetched directly this session; `wrangler d1 execute --file` bulk import, 5 GiB file limit, statement-length constraints
- In-repo source files read directly this session: `packages/ingest/tbaClient.ts`, `packages/core/algorithms/types.ts`, `packages/core/algorithms/sigma1/index.ts`, `packages/core/algorithms/opr.ts`, `packages/core/algorithms/sigma1/rp/distribution.ts`, `packages/core/isomorphic.test.ts`, `packages/harness/artifact.ts`, `packages/harness/replay.ts`, `packages/harness/cli.ts`, `packages/harness/predictions.ts`, `packages/harness/metricHistory.ts`, `packages/corpus/schema.sql`, `pnpm-workspace.yaml`, `package.json`, `scripts/secrets-boundary.test.ts`, `.planning/config.json`

### Secondary (MEDIUM confidence)
- WebSearch synthesis (cross-checked 2+ sources): TBA API v3 has no publicly documented numeric rate limit as of the sources found (2017 TBA blog post is the most explicit statement, "no current rate limit... may be imposed if things ever get out of hand") — this justifies D-22's considerate-politeness-by-convention approach rather than a documented hard limit to engineer against
- WebSearch synthesis: `wrangler dev --test-scheduled` / Miniflare local cron-testing mechanics (official docs describe the `/cdn-cgi/handler/scheduled` route; the "Miniflare does not auto-fire schedules" detail comes from community/third-party sources, not the official page directly)
- WebSearch synthesis: Cloudflare Workers Observability now surfaces per-invocation CPU time and Wall time directly (Workers Logs Invocation Log, Tail Workers Trace Events) — supports D-21's measurement requirement being satisfiable without custom instrumentation

### Tertiary (LOW confidence)
- None used as load-bearing claims in this document — all Cloudflare platform facts were confirmed via direct official-docs fetch this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package versions verified live against npm registry this session; Cloudflare binding APIs fetched directly from official docs this session
- Architecture (D1-for-state recommendation): HIGH — the subrequest-cap-includes-bindings fact and D1's batch-API behavior are both confirmed directly from official Cloudflare docs, and the arithmetic resolving D-19 follows directly from CONTEXT.md's own measured numbers
- Pitfalls: MEDIUM — pitfalls 1-4 are derived directly from verified platform facts + CONTEXT.md's own stated measurements (high confidence in the reasoning); pitfall 5 (ml-matrix bundling) is flagged explicitly as unverified (Assumption A1) since no actual `wrangler dev` build was run this session

**Research date:** 2026-08-21
**Valid until:** ~14 days for the Cloudflare-specific numeric limits (a fast-moving platform whose free-tier quotas can change without notice — STACK.md/PITFALLS.md already carry this same caveat); ~30 days for the architectural recommendations (D1-for-state, batching pattern), which are structural and less likely to be invalidated by a quota change
