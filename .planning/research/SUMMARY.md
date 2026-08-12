# Project Research Summary

**Project:** SigmaScout v3 (FRC match prediction / analytics website)
**Domain:** Precompute-heavy sports-prediction SPA on Cloudflare free tier
**Researched:** 2026-08-12
**Confidence:** MEDIUM-HIGH overall

---

## Executive Summary

SigmaScout is a precompute-heavy sports-analytics site built around Cloudflare's **10ms CPU-time limit** on free-tier Workers. This is the single most load-bearing architectural constraint: no real prediction computation in live-update loop. Architecture splits into: (1) heavy offline compute (backtests, tuning, aggregations) in GitHub Actions, (2) lightweight incremental online compute (1-3 min Cron Worker) applying Kalman updates, (3) frontend reads precomputed JSON only.

Two foundational prerequisites cannot be skipped: (1) walk-forward evaluation harness (Brier score, per-algorithm per-season) before Sigma1 development—it proves "measurably better" is verifiable and provides tuning objective; (2) predict-before-update pattern structurally enforced via shared `packages/core` module so outcome leakage is impossible by construction. Prior failure log items map directly here.

Three major risks addressable only at design time: (1) 10ms CPU is hard ceiling—plan compute upfront; (2) KV 1,000 writes/day cap and eventual consistency require write batching; (3) per-season RP rules, TBA quirks (surrogates, offseason gaps, replays), score-breakdown schema changes must be handled with explicit per-season configuration, not generic parsing.

---

## Key Findings

### Recommended Stack

Fixed: React 19.2, Vite 8.2, Tailwind 4.3 on Cloudflare Pages (from PROJECT.md)

**Pipeline Runtime:** Node.js 24.x LTS, TypeScript 5.x, tsx 4.23.x, Zod 4.4.x, Wrangler 4.122.x
**Storage:** R2 (10GB, 1M writes/mo), KV (1,000 writes/day—manifest layer only), D1 (100K writes/day—state)
**Workers Cron:** 10ms CPU/invocation, 5 triggers/account, 1-min minimum
**Client:** TanStack Query 5.x, TanStack Router 1.x, Zustand 5.x, Recharts 3.x
**Testing:** Vitest 4.x, @testing-library/react, @playwright/test

**What NOT to use:** KV as artifact store, D1 for v1, Pages Functions for cron, Redux, Jest, client-side season recomputation

### Expected Features

**Table Stakes:** Teams page, Team page, Events page, Event tabs, match win probability with confidence, mobile pages, fast loads, ~1-3 min freshness

**Differentiators:** Compare page (algorithm accuracy), variance metrics (X ± Y), algorithm versioning as first-class, Event Simulation from chosen start match, RP prediction with variance

**Anti-Features:** Client-side recomputation, user accounts, stand scouting, interactive map, live in-match updates, custom models

### Architecture Approach

Hard split between heavy offline compute (GitHub Actions/local) and light online incremental compute (Cloudflare Cron Worker). Key patterns: (1) predict-before-update pure functions, (2) compute/serve split with versioned artifacts, (3) client-side simulation only (not rating computation), (4) offline heavy compute in CI, online light compute in Worker—never reverse.

### Critical Pitfalls

1. No evaluation harness before model work → Build backtest harness first with OPR baseline
2. Unidentifiable latent model (prior 4D) → Verify identifiability before adding dimensions
3. Outcome leakage / non-walk-forward → Structurally enforce predict-before-update
4. Recompute-per-request (Statbotics trap) → Every page from static precomputed JSON
5. TBA data quirks → Build ingestion normalization layer with per-season handling
6. Per-season RP rules → Explicit config reviewed against game manuals 2022–2026

---

## Implications for Roadmap

**Phase 0: Evaluation Harness & Ingestion** — Walk-forward backtest, OPR baseline, TBA normalization. Prerequisite for all algorithmic decisions.

**Phase 1: Compute Engine — Sigma1 + Pipeline** — Kalman filter design, OPR/EPA, per-season RP rules, GitHub Actions pipeline, Worker Cron updater, storage topology. Establishes ~1-3 min freshness loop.

**Phase 2: Frontend Scaffolding** — React/Vite setup, nav, Teams/Events pages, routing/state. Can parallel Phase 1 with mocks.

**Phase 3: Prediction Display** — Team page with plot, Event tabs, predictions, TBA links. Core value visible.

**Phase 4: Differentiators** — Event Simulation, Compare page, hyperparameter tuner, calibration curves. Headline features.

**Phase 5: Polish** — Freshness indicator, deep links, E2E tests, performance tuning.

**Ordering:** Phases 0-1 first and sequential (harness before Sigma1). Phase 2 parallels 1. Phase 3 needs 1+2. Phase 4 needs 1+3. Phase 5 after 1-4.

---

## Confidence Assessment

**Stack:** HIGH (verified vs official docs and npm registry)
**Features:** MEDIUM-HIGH (competitor analysis cross-checked; differentiators derived from value prop)
**Architecture:** MEDIUM (patterns well-established; specific Cloudflare combination needs measurement)
**Pitfalls:** MEDIUM-HIGH (grounded in prior failure log or established principles)

**Overall: MEDIUM-HIGH**

### Gaps to Address During Planning

1. Sigma1 CPU budget — Measure actual per-match cost vs 10ms early in Phase 1
2. Event Simulation UX — Decide historical ratings vs current-retroactive during Phase 4
3. Tune/holdout policy — Document strict vs evolving during Phase 1
4. Per-season RP verification — Checklist for 2022–2026 official criteria
5. TBA edge cases — Test ingestion vs offseason event, surrogate, schema anomaly in Phase 0

---

*Research completed: 2026-08-12*
*Ready for roadmap creation: yes*
