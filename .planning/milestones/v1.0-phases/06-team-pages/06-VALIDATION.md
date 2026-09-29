---
phase: 6
slug: team-pages
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-25
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase from `06-RESEARCH.md` § Validation Architecture (line 692).
> The Per-Task Verification Map is filled once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit/component — root `vitest.config.ts` + workspace packages); Playwright (`apps/web/playwright.config.ts`, e2e) |
| **Config file** | `vitest.config.ts` (root); `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter web test` (web unit + component) / `pnpm test` (all packages) |
| **Full suite command** | `pnpm test` + `pnpm --filter web test:e2e` |
| **Estimated runtime** | Vitest ~seconds; Playwright e2e requires a served build per existing specs' preconditions |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter web test` (web side) or `pnpm test` (pipeline side) — whichever side the task changed
- **After every plan wave:** Run `pnpm test` + `pnpm --filter web test:e2e`, plus a real `pnpm publish:seasons` re-run before trusting `packages/harness/payloadBudget.test.ts` numbers
- **Before `/gsd-verify-work`:** Full suite green, plus both manual measurements (first paint, D-10 real-device) recorded as dated entries
- **Max feedback latency:** 60 seconds for the per-task quick run

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(filled by /gsd-validate-phase once PLAN.md task IDs exist)* | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → test mapping (from RESEARCH.md, pre-task-breakdown)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEAM-02 | Robot image renders, or fallback tile shows for the ~25% no-photo case | component | `pnpm --filter web test -- SeasonHeader` | ❌ W0 |
| TEAM-03 | Season stats render from `seasonStats` | component | `pnpm --filter web test -- SeasonHeader` | ❌ W0 |
| TEAM-04 | Event section headings show real event names (`publish.ts:959` bug fix) | unit | `pnpm test -- publish.test` | Partial |
| TEAM-04 | D-09 replacement validation rule: played match must carry scores | unit | `pnpm test -- pageArtifacts.test` | Partial |
| TEAM-05 | `redScoreVarianceOwn`/`blueScoreVarianceOwn` published for a real Sigma1 match | unit | `pnpm test -- sigma1` | Partial |
| TEAM-05 | Actual RP round-trips from `MatchResult` to published artifact | unit | `pnpm test -- publish.test` | Partial |
| TEAM-06 | Chart x-axis uses array position, not raw `matchIndex` (D-12) | component | `pnpm --filter web test -- MetricHistoryChart` | ❌ W0 |
| D-10 | Horizontal drag scrolls only the event table; vertical drag scrolls the page; document never gains horizontal overflow across ≥2 event sections | e2e | `pnpm --filter web test:e2e -- touch-scroll` + extend `no-page-pan.spec.ts` | Partial |
| Budget | Team artifact stays under `budgetMaxBytes: 375000` after D-01…D-05 | automated | `pnpm test -- payloadBudget` (after real republish) | ✓ exists |

---

## Wave 0 Requirements

- [ ] `apps/web/src/lib/api/team.ts` + its test, mirroring `apps/web/src/lib/api/teams.ts`
- [ ] Component test files for `SeasonHeader`, `EventSection`, `MatchTable`, `MetricHistoryChart`
- [ ] Extend `packages/harness/publish.test.ts`: `eventName` regression case; own-variance round-trip; actual-RP round-trip
- [ ] Extend `packages/harness/pageArtifacts.test.ts` with the D-09 rule (played-without-scores fails; unplayed-without-scores passes)
- [ ] Extend `apps/web/e2e/no-page-pan.spec.ts` and `apps/web/e2e/touch-scroll.spec.ts` with a team-page route carrying ≥2 event sections
- [ ] Percentile-formula unit test over a synthetic team pool, sanity-bounded against `colour-and-tiers.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| iOS Safari gesture arbitration on nested horizontal scroll | D-10 | `touch-action: pan-x` has documented historical iOS Safari gaps; a passing Playwright/CDP test is not evidence of real-device behavior | Real iPhone, Safari, team page with ≥2 event sections: horizontal drag inside a match table must not pan the page; vertical drag anywhere must scroll the page |
| Congested-venue first paint clears the 2.5s NAV-06 threshold | static-shell-first-paint todo | Requires the dated A/B method, not a unit assertion | Reuse `docs/first-paint-measurement.md`'s **fourth entry's** method exactly (both builds, real CDP throttling, 4x CPU, median of three); record a fifth dated entry |
| Recharts dynamic import is a real deferral (not D-19's reverted route split) | D-14 | Must be measured, not assumed | Same real-network A/B method applied to the chart tab's `import()`; record a dated entry |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
