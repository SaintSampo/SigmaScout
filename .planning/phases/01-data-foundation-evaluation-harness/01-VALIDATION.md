---
phase: 1
slug: data-foundation-evaluation-harness
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-12
validated: 2026-08-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed retroactively on 2026-08-19.** This file was left as the unfilled
> `plan-phase` template through all six plans' execution. The map below was rebuilt from
> the six PLAN files' verify blocks, the six SUMMARY files, `01-SECURITY.md`'s threat
> register, and the test suite as it actually exists on disk — then re-run to confirm
> every listed command is genuinely green, not merely present.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (`globals: false` — explicit `import { describe, it, expect } from "vitest"` required) |
| **Config file** | `vitest.config.ts` (include: `packages/**/*.test.ts`, `scripts/**/*.test.ts`) |
| **Quick run command** | `pnpm vitest run <path>` (per-task, see map below) |
| **Full suite command** | `pnpm test && pnpm typecheck` |
| **Estimated runtime** | ~8s full suite (38 files, 534 tests); ~2.4s for the 13 Phase-1 files; ~0.25s for a single file |

Package manager is pnpm 11.21.0 via corepack. `pnpm typecheck` is `tsc --noEmit` under `strict: true`
and is paired with every task command below, because a type error in this codebase is a
silent-wrong-answer risk (the shared `AlgorithmModule<S>` contract is enforced only by the compiler).

---

## Sampling Rate

- **After every task commit:** Run that task's `Automated Command` from the map below
- **After every plan wave:** Run `pnpm test && pnpm typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds (full suite) — well inside the sampling budget; no
  task in this phase is separated from automated feedback by more than one commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | DATA-01, DATA-02 | T-01-SC | Three `[SUS]`-flagged packages (`better-sqlite3`, `@types/better-sqlite3`, `ml-matrix`) confirmed legitimate *before* any install/postinstall script runs | checkpoint:human-verify | — (see Manual-Only MO-1) | — | ✅ green (approved) |
| 01-01-02 | 01 | 1 | DATA-01 | **T-01-02**, T-01-11 | TBA API key never becomes committable: `.env` git-ignored **and** untracked, `.env.example` placeholder ≠ real key | unit | `pnpm vitest run scripts/secrets-boundary.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | DATA-01 | — | Field recon records *observed* TBA/Statbotics shapes, not assumed ones | manual | — (see Manual-Only MO-2) | — | ✅ green (recorded) |
| 01-02-01 | 02 | 2 | DATA-01, EVAL-01, EVAL-02, ALGO-01 | T-01-01, T-01-03, T-01-11 | Tracer path emits both artifacts with every `pRedWin ∈ [0,1]`; no key in either artifact | integration | `pnpm vitest run packages/harness/artifact.test.ts packages/harness/report.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | **EVAL-01** | — | Outcome leakage structurally impossible — a `predict()` reading any outcome field throws rather than returning data | unit | `pnpm vitest run packages/harness/replay.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-03-01 | 03 | 3 | DATA-01, DATA-02 | T-01-08 | Chronological read is a *total* order; concurrent writers fail fast rather than corrupting the corpus | unit | `pnpm vitest run packages/corpus/db.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-03-02 | 03 | 3 | **DATA-01** | T-01-04 | ETag conditional requests + a 100ms throttle enforced *inside* `tbaFetch` so no call site can bypass it; exactly the 8 COVERAGE.md INTEGRATE capabilities exposed | unit | `pnpm vitest run packages/ingest/tbaClient.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-03-03 | 03 | 3 | **DATA-02** | T-01-01 | Each of surrogate / replay / missing-breakdown / offseason is an explicit queryable flag — none silently ingested, none silently dropped, no zero-defaulted RP | unit | `pnpm vitest run packages/ingest/normalize.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-04-01 | 04 | 3 | **ALGO-01** | T-01-09 | Season-pooled ridge OPR stays finite in the under-determined cold start; incremental RLS solve is *exact*, not an approximation | unit | `pnpm vitest run packages/core/algorithms/opr.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-04-02 | 04 | 3 | ALGO-01, DATA-02 | T-01-10 | Surrogate column never enters the design matrix (rating untouched); dq'd team keeps its column; `packages/core` imports no Node built-in or `better-sqlite3` | unit | `pnpm vitest run packages/core/isomorphic.test.ts packages/core/algorithms/opr.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-05-01 | 05 | 3 | **EVAL-02**, **EVAL-03**, EVAL-04 | — | Brier/accuracy against hand-computed fixtures; tie and no-call excluded from the accuracy denominator; empty calibration bin reports `null`, never `0`/`NaN`; `scoredCount + exclusions === candidateCount` for every slice | unit | `pnpm vitest run packages/core/scoring packages/harness/score.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-05-02 | 05 | 3 | EVAL-02, EVAL-04 | T-01-05, T-01-06, **T-01-11**, T-01-12 | Artifact is a validated versioned contract — a missing field never reaches disk; metrics stored unrounded; serialized artifact provably free of `TBA_API_KEY`; Statbotics failure falls back without throwing | unit | `pnpm vitest run packages/harness/artifact.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-05-03 | 05 | 3 | EVAL-03, **EVAL-04** | **T-01-03**, T-01-14 | Report renders from the artifact alone; every interpolated string escaped; no off-disk `src`/`href`; holdout rows visually distinguished from tune rows | unit | `pnpm vitest run packages/harness/report.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-06-01 | 06 | 4 | **EVAL-01**, EVAL-02 | **T-01-13** | Whole-season stream interleaves concurrent events by time, holds predict-before-update across event boundaries, is a stable total order, and holds a *read-only* corpus handle — a write through it fails at the SQLite layer | unit | `pnpm vitest run packages/harness/replay.season.test.ts && pnpm typecheck` | ✅ | ✅ green |
| 01-06-02 | 06 | 4 | EVAL-02, EVAL-04 | T-01-14, T-01-15 | Full 2022–2026 replay is idempotent (byte-identical artifacts modulo `runTimestamp`); only 2025/2026 marked `headlineEligible` | manual | — (see Manual-Only MO-4) | — | ✅ green (run 2026-08-13) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Requirement coverage roll-up — all 7 requirements have automated verification:**

| Requirement | Covering test file(s) | Status |
|-------------|-----------------------|--------|
| DATA-01 | `packages/ingest/tbaClient.test.ts`, `scripts/secrets-boundary.test.ts` | ✅ COVERED |
| DATA-02 | `packages/ingest/normalize.test.ts`, `packages/corpus/db.test.ts` | ✅ COVERED |
| EVAL-01 | `packages/harness/replay.test.ts`, `packages/harness/replay.season.test.ts` | ✅ COVERED |
| EVAL-02 | `packages/core/scoring/brier.test.ts`, `packages/harness/score.test.ts` | ✅ COVERED |
| EVAL-03 | `packages/core/scoring/calibration.test.ts`, `packages/harness/report.test.ts` | ✅ COVERED |
| EVAL-04 | `packages/harness/score.test.ts`, `packages/harness/artifact.test.ts` | ✅ COVERED |
| ALGO-01 | `packages/core/algorithms/opr.test.ts`, `packages/core/isomorphic.test.ts` | ✅ COVERED |

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. `vitest.config.ts` already globs
`scripts/**/*.test.ts`, so the one test added by this audit needed no config change.

---

## Manual-Only Verifications

| ID | Behavior | Requirement | Why Manual | Test Instructions |
|----|----------|-------------|------------|-------------------|
| MO-1 | Legitimacy of the three `[SUS]`-flagged packages before first install | DATA-01 (T-01-SC) | A supply-chain judgement call, not a property of the code. It must be made *before* any `postinstall` script executes, so no test that runs after `pnpm install` can gate it | Review `better-sqlite3`, `@types/better-sqlite3`, `ml-matrix` on npmjs.com (publisher, download volume, repo linkage) before approving the install. Re-run only when a new native/matrix dependency is added |
| MO-2 | TBA and Statbotics live field shapes match what `docs/data/tba-field-recon.md` records | DATA-01 | Requires live network and a real `TBA_API_KEY`; the answers are one-shot facts consumed at plan time by Plans 03 and 05, not an invariant of our code | `pnpm recon:tba`, then diff the regenerated `docs/data/tba-field-recon.md` against the committed one. Re-run at the start of each new FRC season |
| MO-3 | Full 2022–2026 backfill re-runs at 304 cost rather than re-downloading | DATA-01 | Requires live network, a real API key, and ~1,700 upstream requests. The *mechanism* is unit-tested in `tbaClient.test.ts`; only the end-to-end request tally needs the real service | `pnpm ingest --years 2022-2026` twice; the second run must report a large 304 tally. Last measured 2026-08-13: 1,585/1,699 cache hits, remaining 114 accounted for by un-conditional teams-list pagination plus the status check |
| MO-4 | Full-corpus replay is idempotent and reports headline figures from holdout seasons only | EVAL-02, EVAL-04 | ~78–82 minutes of wall clock per run — far outside any sampling loop's feedback budget. The *logic* is unit-tested (`replay.season.test.ts`, `score.test.ts`); only the full-scale run needs the real corpus | `pnpm harness --seasons 2022-2026 --algorithm opr --out reports/full`, repeat to `reports/rerun`, then compare the two `artifact.json` files with `provenance.runTimestamp` stripped. Last run 2026-08-13: byte-identical; 2026 holdout combined Brier 0.1773, winner accuracy 78.25% |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a recorded Manual-Only entry with instructions
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infrastructure sufficed)
- [x] No watch-mode flags (every command is `vitest run`)
- [x] Feedback latency < 8s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-19

---

## Validation Audit 2026-08-19

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap G-1 (resolved).** No automated regression test asserted the secrets boundary.
`01-SECURITY.md` closes **T-01-02 (Information Disclosure, HIGH)** on evidence of a one-time
manual `git check-ignore .env` at plan time. Removing `.env` from `.gitignore`, committing it,
or pasting a real key into the tracked `.env.example` would each reopen a high-severity threat
with the entire suite still green — `artifact.test.ts` catches the key leaking into *artifacts*,
but nothing caught it leaking into *git*.

Resolved by `scripts/secrets-boundary.test.ts` (3 tests), which asserts on every run that
`.env` is git-ignored, that `.env` is not tracked, and that `.env.example`'s `TBA_API_KEY`
differs from the real one — compared by SHA-256 hash so that a *failure message* can never
print the secret it exists to protect.

**Verification performed for this audit (not merely asserted):**

| Check | Result |
|-------|--------|
| `pnpm vitest run scripts/secrets-boundary.test.ts` | 3 passed |
| 13 Phase-1 test files | 160 passed |
| `pnpm test` (full suite) | 38 files, 534 tests passed, 7.88s |
| `pnpm typecheck` | clean |
| Implementation files modified by this audit | none (`git status` showed only the new test file) |
