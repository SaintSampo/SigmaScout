---
phase: 7
slug: event-pages
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-27
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 7` from `07-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x — already configured, no install needed |
| **Config file** | `vitest.config.ts` (repo root: pipeline/harness) + `apps/web/vitest.config.ts` (client) |
| **Quick run command** | `pnpm vitest run <path-to-file>` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | quick: ~2–10s per file; full suite: measure at Wave 0 |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <file(s) touched>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite green, plus the one authorized live republish
- **Max feedback latency:** targeted run < 30s

---

## Per-Task Verification Map

> Seeded as pending — task IDs are assigned when PLAN.md files are written.
> `/gsd-validate-phase 7` fills the Task ID / Plan / Wave / Threat Ref columns after planning.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | EVNT-02 | — | Insights tab orders by official TBA rank; falls back to VPR order with an on-page notice | unit + component | `pnpm vitest run apps/web/src/components/event/InsightsTab.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVNT-03 | — | Breakdown tab shows every raw component, VPR-rank-ordered, carrying no official event rank | component | `pnpm vitest run apps/web/src/components/event/BreakdownTab.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVNT-04 | — | Quals tab merges played + upcoming; per-tab axis domain | unit + component | `pnpm vitest run apps/web/src/components/event/eventMatchAxis.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVNT-05 | — | Alliances tab computes `√(σ₁²+σ₂²+σ₃²)` over the first 3 picks only | unit | `pnpm vitest run apps/web/src/components/event/AlliancesTab.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVNT-06 | — | Elims tab flat chronological list with its own axis domain | component | `pnpm vitest run apps/web/src/components/event/ElimsTab.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-18.6 | — | `sort_order_info[0].name === "Ranking Score"` holds against live TBA per season | integration (live TBA) | mirrors `packages/ingest/rankings.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-18.7 | — | Alliances ingest handles null / empty / populated exactly as rankings does | unit | `pnpm vitest run packages/ingest/alliances.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-10 | — | As-of-event snapshot differs from season-final value for an early-season event | unit | `pnpm vitest run packages/harness/publish.test.ts` | ⚠️ extend | ⬜ pending |
| TBD | TBD | TBD | D-01/D-02 | — | `TeamMetric.spread` equals `√(P+R)` everywhere it is published | unit | `pnpm vitest run packages/core/algorithms/sigma1/` | ⚠️ extend | ⬜ pending |
| TBD | TBD | TBD | D-05 | — | No `sigma1` string reachable from a published artifact path or D1 row after rename | integration | new post-republish assertion (zero `sigma1@` keys) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/src/components/event/*.test.tsx` — new component test files for all 5 tabs (route and components are new this phase; no existing coverage)
- [ ] `packages/ingest/alliances.test.ts` — new alliances-ingest unit tests, mirroring `rankings.test.ts`'s structure
- [ ] `apps/web/src/components/event/eventMatchAxis.test.ts` — event-scoped axis-domain tests, mirroring `matchAxis.test.ts`
- [ ] Framework install: **none** — Vitest is already configured and used identically by every prior phase

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Five-tab strip and four wide tables on a ~390px viewport | EVNT-02…06 | Nested horizontal-scroll-inside-vertical-list behavior is a real-device concern; `07-UI-SPEC.md` fixes the approach but touch behavior needs eyes | Load an event page at 390px width; confirm the tab strip scrolls independently of each table, and that no table traps vertical page scroll |
| Live republish correctness | D-18 | The republish is a one-shot destructive rename (write→verify→delete) against production R2 | After the authorized republish, confirm zero `sigma1@` keys remain and every new VPR key resolves |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
