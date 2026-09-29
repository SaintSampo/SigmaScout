---
phase: 5
slug: site-shell-navigation-browsing
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` § Validation Architecture. Task IDs are filled in
> by the planner/executor; the requirement rows below are the fixed contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x (unit/logic) · `@testing-library/react` 16.3.x (component behavior) · `@playwright/test` 1.62.x (touch spike + deep-link E2E) |
| **Config file** | `apps/web/vitest.config.ts` — **does not exist yet; Wave 0 creates it** (`environment: "jsdom"`) |
| **Quick run command** | `pnpm --filter web test -- --run <file>` |
| **Full suite command** | `pnpm test` (root script, `vitest run` across the workspace glob) |
| **Estimated runtime** | ~15s quick / ~90s full suite (existing workspace suite plus new `apps/web` tests) |

---

## Sampling Rate

- **After every task commit:** Run the relevant `vitest run <file>` from the map below
- **After every plan wave:** Run `pnpm test` (full workspace suite)
- **Before `/gsd-verify-work`:** Full suite green **plus** the Lighthouse measurement run at least once against a real deployed Pages preview
- **Max feedback latency:** 15 seconds (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | Infra | — | N/A | setup | `pnpm --filter web test -- --run` exits 0 on an empty suite | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-05 | T-05-02 | Zod `validateSearch` rejects or coerces a hand-edited URL before it reaches any component | unit | `vitest run src/routes/__root.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-01 | — | N/A | integration | `vitest run src/components/ribbon/*.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-02 | — | N/A | integration | `vitest run src/components/ribbon/*.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-03 · NAV-04 (D-09 search) | T-05-01 | Plain `String.includes()`/`.startsWith()` — never `new RegExp(userInput)`; adversarial regex-metacharacter case included | unit | `vitest run src/lib/search-index.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TEAM-01 (D-13 algorithm-switch fallback) | — | N/A | unit | `vitest run src/lib/resolveSortKey.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TEAM-01 (D-11 year-switch component drift) | — | N/A | unit | `vitest run src/lib/resolveSortKey.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TEAM-01 (artifact render) | T-05-04 | Client-side `TeamsArtifactSchema.parse()` turns a malformed artifact into a visible error state, never a silent `NaN` render | integration | `vitest run src/components/teams-table/*.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EVNT-01 (filters) | — | A null field is excluded from the option list, never bucketed as "Unknown" | unit | `vitest run src/components/events-list/filters.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-06 (D-04 touch scroll) | — | N/A | E2E (spike first) | Playwright `devices['iPhone 13']` / `devices['Pixel 7']` scripted drag sequences | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-06 (first paint) | — | N/A | **measurement** | `npx lighthouse <preview-url>/teams?year=2024&algorithm=sigma1 --preset=perf --emulated-form-factor=mobile --throttling-method=simulate --output=json` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NAV-05 (deep link) | — | N/A | E2E | Playwright: paste a full URL into a fresh context, assert the same screen is restored | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/vitest.config.ts` — `environment: "jsdom"` (RESEARCH.md Pitfall 5)
- [ ] `apps/web/tsconfig.json` — extends root, mirrors `apps/worker/tsconfig.json`'s pattern
- [ ] `apps/web/package.json` — `test` script matching the worker package's pattern, so `pnpm --filter web test` resolves
- [ ] `src/lib/resolveSortKey.ts` plus `src/lib/resolveSortKey.test.ts` — the **shared** D-11/D-13 fallback function (one function, both triggers — RESEARCH.md Pattern 3)
- [ ] `src/lib/search-index.test.ts` — includes the adversarial regex-metacharacter input case
- [ ] `src/routes/__root.test.ts` — URL to state round-trip stubs for NAV-05
- [ ] A deployed Cloudflare Pages preview environment — the NAV-06 Lighthouse measurement cannot run at all without it
- [ ] **Domain-topology decision resolved** (Pages origin vs. `sigmascout.org` plus R2 CORS) — blocks the first real `fetch()` call

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Touch-gesture arbitration between vertical virtualized scroll and horizontal pinned-column scroll | NAV-06 / D-04 | No official example proves the TanStack Table pinning + TanStack Virtual + sticky-header three-way combination under real touch; emulation is a stand-in, not proof | Spike first (Playwright device emulation). Then spot-check on a real mid-range Android and a real iPhone: drag vertically inside the table body, drag horizontally across pinned columns, confirm neither gesture steals the other and the header stays stuck |
| First paint against real venue-grade wifi | NAV-06 | Lighthouse's simulated Slow-4G is the reproducible gate; real venue wifi is a different, unmodellable shape | Optional secondary data point — load the deployed Teams page on a real mid-range phone on real event wifi, compare against the Lighthouse median |
| Visual conformance to `05-UI-SPEC.md` (spacing scale, type scale, color tokens) | NAV-01 | Token *presence* is source-assertable; whether the applied tokens read correctly is a judgment call | Load Teams and Events at 375px and 1440px, compare against the UI-SPEC's Design System section |

---

## Measurement Gate (NAV-06) — threshold locked before measuring

**Metric:** LCP (Largest Contentful Paint), median of 3 runs.
**Threshold:** **≤ 2.5 s** (Google Core Web Vitals "good" boundary).
**Target:** deployed Cloudflare Pages preview (not `localhost`), Teams page pointed at the measured-max real artifact — `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`, 2,721,887 bytes (`docs/publish-budget.md`).
**Profile:** Lighthouse default mobile — 4× CPU slowdown plus Slow-4G (150 ms RTT, 1.6 Mbps down), `--throttling-method=simulate` for CI repeatability.
**Supplementary marks:** `performance.mark("artifact-parsed")` after `TeamsArtifactSchema.parse()` resolves and `performance.mark("first-rows-rendered")` after the virtualizer's first paint — the `performance.measure()` between them separates a *network* problem from a *render* problem.

**Decision rule (D-03):**
- Median LCP ≤ 2.5 s → the deferred search-index split **stays deferred**.
- Median LCP > 2.5 s → first confirm `Content-Encoding` is present and the body is materially smaller than 2.7 MB (a missing-compression misconfiguration is a one-line fix, not a new artifact kind). Only if compression is confirmed active and LCP still exceeds 2.5 s does D-03's split become justified — and it files as a **Phase-4-touching follow-up**, not speculative work inside this phase.

**Secondary gate — search responsiveness (D-10):** keystroke to updated results **< 100 ms** (RAIL model), measured with `performance.mark`/`measure` around the `onChange` to re-render path on the same throttled-CPU profile. Exceeding it signals debouncing or the D-03 split is needed for search specifically, independent of the Teams LCP verdict.

**Run it early.** RESEARCH.md Open Question 2 is explicit: run this as soon as a real Teams page exists against real or fixture data — not at phase end, so a "build the split" verdict cannot arrive after everything else was built assuming it was not needed.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] NAV-06 measurement gate run against a real Pages preview, median LCP recorded
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
