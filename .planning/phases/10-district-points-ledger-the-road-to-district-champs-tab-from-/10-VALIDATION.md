---
phase: 10
slug: district-points-ledger
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-25
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from
> `10-RESEARCH.md` "Validation Architecture"; the planner fills the per-task map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x |
| **Config file** | repo-root vitest config. Run from the REPO ROOT, never from `apps/web` (77 files there vs 167 at root; an 8-day red CI hid in that gap) |
| **Quick run command** | `npx vitest run <path of the package or file touched>` |
| **Full suite command** | `npx vitest run` from the repo root, then `npx tsc --noEmit` at root AND `npx tsc --noEmit -p apps/web/tsconfig.json` |
| **Estimated runtime** | ~90 seconds full suite |

Never wrap a test run in `timeout <n> pnpm ...` (it swallows output and exits 0). Fresh worktrees
are CRLF: the rpSeed/sigmaSeed structural tests fail there only.

---

## Sampling Rate

- **After every task commit:** Run the touched package's `npx vitest run <path>`
- **After every plan wave:** Run the full suite command from the repo root plus both tsconfigs
- **Before `/gsd-verify-work`:** Full suite must be green; CI green after the push (`gh run list`)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by the planner per plan) | | | | | | | | | ⬜ pending |

Success criteria to cover (from ROADMAP Phase 10):

| SC | Behavior | Test type | Command | File |
|----|----------|-----------|---------|------|
| SC-1 | Worker republishes the district artifact on a live rankings change, merging TBA rankings into the artifact read back from R2 and recomputing `locks.ts` verdicts | unit, mocked TBA fetch and R2 | `npx vitest run apps/worker/test/scheduled.district.test.ts` | ❌ Wave 0 |
| SC-2 | One joint run yields correlated (qual, selection, playoff) per team; marginals are the histograms; event total is the per-run sum | unit, seeded RNG | `npx vitest run packages/core/algorithms/simulation` | extend existing + new |
| SC-2 | Browser win probability from per-team published SPR numbers matches the artifact's `pRedWin` within a stated gap | measurement script with a pinned test | `npx vitest run scripts/measureAllianceWinProbability.test.ts` | ❌ Wave 0 |
| SC-3 | Five statuses: Locked and Locked out from `locks.ts`, In range and Out of range from the median projection; a finished district reproduces the artifact's counts | unit | `npx vitest run apps/web/src/components/districts` | ❌ Wave 0 |
| SC-4 | Slider reopens a finished event's later categories | component | `npx vitest run apps/web/src/components/districts/DistrictLedger.test.tsx` | ❌ Wave 0 |
| SC-5 | No Worker message posted for an all-finished or all-unstarted district | component, asserts no `postMessage` | same file as SC-4 | ❌ Wave 0 |
| SC-6 | Point formulas (qual erfinv, selection 17-N / N / 0, playoff exit points) reconcile with the corpus exactly | corpus reconciliation, mirrors `reconciliation.test.ts` | `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts` | ❌ Wave 0 |
| SC-6 | Award base-rate tables are walk-forward (leak test) and the selection agreement measurement is pinned | unit | `npx vitest run scripts/measureDistrictAwardBaseRates.test.ts scripts/measureSelectionAgreement.test.ts` | ❌ Wave 0 |
| SC-7 | Suite green, both tsconfigs clean, CI green, Worker deployed before the republish, e2e covers the tab | existing gates + live e2e from main context | `npx vitest run`; `gh run list`; `npx playwright test e2e/districts*` | existing |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/districts/pointFormulas.reconciliation.test.ts` — corpus-backed proof of the qual, selection and playoff formulas, before the formulas ship
- [ ] `apps/worker/test/scheduled.district.test.ts` — the Worker district refresh pass
- [ ] `apps/web/src/components/districts/DistrictLedger.test.tsx` and `districtLedgerRows.test.ts` — table, status rule, slider, no-Worker-message case
- [ ] `apps/web/src/workers/districtSimulationProtocol.test.ts` — protocol module tested directly (jsdom has no Worker API)
- [ ] `scripts/measureDistrictAwardBaseRates.test.ts` — walk-forward leak test mirroring `measureAwardPredictability.test.ts`
- [ ] `scripts/measureAllianceWinProbability.test.ts` — the browser win-probability formula against published `pRedWin`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Earned points move during a live weekend | SC-1 | needs a real live district | During the next live district event, open the district page, wait one poll after quals end, confirm the Qualification cell turned grey |
| Drawer opens without animation under reduced motion | UI-SPEC backstop | OS setting | Toggle reduce motion, click a blue cell |
| Phone width scroll arbitration | UI-SPEC backstop | live e2e at 390px | `npx playwright test e2e/districts*` after deploy, from the main context |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
