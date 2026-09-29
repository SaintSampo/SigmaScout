---
phase: 05-site-shell-navigation-browsing
verified: 2026-08-25T02:09:55Z
status: passed
score: 4/5 roadmap success criteria verified (1 partial — locked NAV-06 fast-load gate not met)
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "NAV-06: pages render from precomputed artifacts with fast load as the top priority (05-VALIDATION.md's locked 2.5s median-LCP gate)"
    reason: "Root-caused to JS-bundle weight in a pure client-rendered SPA where nothing paints until ~600KB of JS executes. The standard fix (route-level code splitting) was implemented, measured with a real-network A/B against an identical no-split build, found to make every network profile slower (+80ms congested venue, +44ms LTE, +12ms wifi), and reverted rather than kept for a better Lighthouse number. The real fix (static shell markup in index.html) is filed with an acceptance test at .planning/todos/pending/static-shell-first-paint.md for a dedicated follow-up. Accepted as a tracked deferral, not a silent pass: the gap, its four dated measurements, and the failed remedy all remain on the record."
    accepted_by: "Jacob Williams (at execution checkpoint, 2026-08-24)"
    accepted_at: "2026-08-25T02:49:51Z"
gaps:
  - truth: "NAV-06 / phase goal 'fast, on phone or desktop': pages render from precomputed artifacts with fast load as the top priority, against 05-VALIDATION.md's locked ≤2.5s median-LCP Measurement Gate."
    status: failed
    reason: >
      The gate is measurably not met. docs/first-paint-measurement.md's four dated entries show a
      worsening-then-diagnosed trend: tracer 2448ms (pass) -> shipped table 2851ms (fail, +14%) ->
      with search box 3099ms (fail) -> after D-19's route-level code split, re-measured at 3232ms
      (fail, WORSE than before the fix). A real-network A/B (no simulator) confirmed the split is
      slower on every profile tested and was reverted (51ad41d6 reverted by 29364417 — confirmed
      current in apps/web/vite.config.ts, which carries no autoCodeSplitting flag). Real-CDP-throttled
      measurement of the reverted build: congested venue ~4064ms, decent LTE ~1100ms, good wifi
      ~656ms — the congested-venue profile (closest to a real competition venue) misses the 2.5s
      threshold by ~62%.
      This is a known, thoroughly diagnosed, already-escalated item — not a newly discovered gap.
      The root cause (a pure client-rendered SPA where nothing paints until ~600KB of JS executes)
      is correctly identified, the wrong fix (code splitting) was tried, measured, and honestly
      reverted rather than kept for a better-looking number, and the real fix (static shell markup
      in index.html) is filed as .planning/todos/pending/static-shell-first-paint.md with a
      before/after acceptance test already specified. A human decision to close D-19 as NOT ACHIEVED
      and proceed was made at an execution checkpoint (05-CONTEXT.md D-19 OUTCOME section).
    artifacts:
      - path: "docs/first-paint-measurement.md"
        issue: "Fourth dated entry documents the gate still failing after the one fix attempt"
      - path: ".planning/todos/pending/static-shell-first-paint.md"
        issue: "Tracks the real fix — not yet implemented"
    missing:
      - "Either: a formal VERIFICATION.md override accepting this as a tracked, human-decided deferral (see suggestion below), or the static-shell-first-paint.md fix implemented and re-measured before Phase 5 is considered fully closed on NAV-06."
---

# Phase 5: Site Shell — Navigation & Browsing Verification Report

**Phase Goal:** Users can browse ranked teams and filterable events for any year and algorithm, fast, on phone or desktop
**Verified:** 2026-08-25T02:09:55Z
**Status:** passed with 1 override (NAV-06's fast-load threshold not met — accepted as a tracked deferral by the user at an execution checkpoint; everything else verified)
**Re-verification:** No — initial verification

## Summary

This is an exceptionally well-documented phase (8 plans, ~150 must-haves across their frontmatter,
four dated performance-measurement entries, a real-device human sign-off with four fixed issues and
re-verification). I read all 8 PLAN/SUMMARY pairs, 05-CONTEXT.md (all 19 decisions plus the D-17→D-17a
amendment and D-19 close-out), 05-VALIDATION.md, 05-UI-SPEC.md, docs/first-paint-measurement.md (all
four entries), both open todos, and REQUIREMENTS.md — then independently verified against the actual
codebase and the live deployed site rather than trusting the SUMMARY narratives:

- Ran the full workspace test suite fresh: **1095/1095 tests pass** (81 files), including 153 in `apps/web`.
- Ran `apps/web`'s typecheck fresh: **exits 0**.
- Confirmed all ~27 artifacts this phase's plans claim to have created actually exist on disk.
- Confirmed **zero color literals** anywhere under `apps/web/src/components/` outside the shadcn-generated `ui/` primitives (D-06 token discipline holds).
- Hit the live site directly: `https://sigmascout.org/teams` and `https://www.sigmascout.org/teams` both return `200`; `/spike` no longer serves spike content; the live `events/2025` artifact carries all five EVNT-01 fields (`country`, `stateProv`, `districtKey`, `week`, real `name`); R2 CORS answers `https://www.sigmascout.org` by exact name and answers nothing for an unlisted origin (no wildcard) — confirmed against the real bucket, not `infra/r2-cors.json`'s text alone.
- Confirmed `apps/web/vite.config.ts` currently carries **no** `autoCodeSplitting` flag — i.e., the D-19 revert (`29364417` reverting `51ad41d6`) is the actual shipped state, matching `docs/first-paint-measurement.md`'s fourth entry and `05-CONTEXT.md`'s D-19 OUTCOME section.
- Confirmed the three items flagged in the verification brief as "already known, verify documentation matches reality" all check out: (1) NAV-06's LCP miss is honestly documented in four dated, reproducible entries and a filed todo, not hidden; (2) the "too minimal" UI feedback is correctly logged as a non-defect product-decision-review todo, not silently ignored; (3) `.text-role-nav` (14px/600) exists exactly as described, resolving the ribbon typography spec/implementation divergence in the implementation's favor with the user's own sign-off as authority.

The one finding below is a real, locked, measured gate miss — not fabricated, not overlooked by the
phase's own process, but also not yet formally accepted via a VERIFICATION.md override. See "Gaps
Summary."

## Goal Achievement — Roadmap Success Criteria

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A persistent top ribbon navigates to Teams, Events, and Compare, and every page is usable at phone width and desktop width. | ✓ VERIFIED | `apps/web/src/components/ribbon/Ribbon.tsx` renders wordmark + 3 links in fixed order at both widths (`Ribbon.test.tsx`, 7 tests); `compare.tsx`/`events.tsx`/`teams.tsx` all exist and route correctly (curl 200 on all three live). Real-device sign-off (05-08-SUMMARY Task 4) passed touch/drag/pinning/algorithm-switching/filter-sheet, and 4 real layout defects found on the phone (nav text too small, table not filling the viewport, page pan on 390px width, filter sheet clipping) were fixed and **re-verified against the deployed build**, not just claimed — `apps/web/e2e/no-page-pan.spec.ts` now pins the no-horizontal-pan invariant permanently. |
| 2 | Prominent global dropdowns select the prediction algorithm and the year, and changing either re-slices the current page immediately. | ✓ VERIFIED | `YearSelect.tsx`/`AlgorithmSelect.tsx` write to the URL via the shared updater form; `resolveSortKey`/`metricKeysFor` (05-05) are the single sort-fallback implementation, tested for both the algorithm-change and the year-change trigger (18+ tests across `resolveSortKey.test.ts`/`metricKeys.test.ts`); live smoke-test in 05-06-SUMMARY confirms an algorithm switch on the deployed page reduces the column count (19→6 for OPR) and preserves scroll position after the `keepPreviousData` fix. |
| 3 | A search bar finds teams and events by number or name and navigates to them; the resulting URL encodes year, algorithm, and current view, and pasting it into a fresh browser restores the same screen. | ✓ VERIFIED | `search-index.ts` (`matchTeams`/`matchEvents`/`buildSearchResults`, 19 tests, plain `.startsWith()`/`.includes()`, no `RegExp` — confirmed via `grep -c RegExp` = 0) and `SearchBox.tsx` (9 tests, both D-10 lazy-fetch degraded states covered) are real, tested, and wired into `Ribbon.tsx`. `apps/web/e2e/deep-link.spec.ts` proves the deep-link round trip end to end against the **deployed production origin** (not localhost), forward and reverse, for both Teams (sort) and Events (filter) — 4 passing tests per 05-08-SUMMARY. Note: search results navigate to an *interim* destination (the filtered/highlighted list page, not a per-team/per-event detail page) — correctly documented as an intentional interim decision pending Phase 6/7's detail pages, not a gap. |
| 4 | The Teams page lists all teams for the selected year ranked by the selected algorithm's metric with team number, name, rank, metric(s), record, and win rate — rendered straight from precomputed artifacts with no season statistics computed in the browser. | ✓ VERIFIED | `rowModel.ts` (18 tests: rank tie-breaking, win-rate null-vs-zero, deterministic sort) + `TeamsTable.tsx`/`columns.tsx` (algorithm-and-season-derived columns via `metricKeysFor`, never row-inspection; pinned rank/team#/nickname; virtualized body over ~3,750 rows) + `teams.tsx` (single artifact fetch, URL-driven sort). Win rate is arithmetic over three *published* integers (NAV-06-compliant presentation, not recomputation). Live smoke-test confirms the shipped page renders real rows and self-corrects an unpublishable sort key. |
| 5 | The Events page lists all events for the selected year and can be sorted and filtered by week, country, state, and district. | ✓ VERIFIED | Plan 05-02 added and republished all five fields (confirmed live: `curl https://data.sigmascout.org/v1/events/2025/...` returns `country`/`stateProv`/`districtKey`/`week`/real `name` on every row). `filterModel.ts` (16 tests) enforces the null-vs-Unknown rule with no coercion (`grep` for `"unknown"`/`"n/a"` literals returns 0). `EventFilters.tsx` gives desktop an inline row and phone a Sheet with a staged-apply pattern and a folded-in active-count accessible name. |

**Note on the phase Goal's "fast" clause:** SC1–5 above are the phase's own five *enumerated* contract
items and all five are met. The Goal line's word "fast" and the separate requirement NAV-06 ("...with
fast load as the top priority") are operationalized by 05-VALIDATION.md's own locked 2.5s median-LCP
gate, which is **not met** on the congested-venue profile. This is not one of the five numbered SCs,
but it is a real, named requirement (NAV-06) and is treated as a genuine gap below rather than folded
silently into SC4's "VERIFIED".

## Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| NAV-01 | 05-05 | ✓ SATISFIED | Ribbon, fixed link order, active indicator — see SC1 |
| NAV-02 | 05-05 | ✓ SATISFIED | Year/Algorithm dropdowns re-slice via URL — see SC2 |
| NAV-03 | 05-08 | ✓ SATISFIED | Search — see SC3 |
| NAV-04 | 05-01, 05-03, 05-04, 05-06, 05-07, 05-08 | ✓ SATISFIED | Mobile/desktop usability, 44px tap targets (`grep` confirms `.tap-target` class present and applied), real-device touch proof both emulated (05-04) and on real hardware (05-08 Task 4), collapsible filter sheet (05-07) |
| NAV-05 | 05-05, 05-07, 05-08 | ✓ SATISFIED | `RootSearchSchema`/`TeamsSearchSchema`/`EventsSearchSchema` validate at router boundary; `deep-link.spec.ts` proves the round trip on the deployed origin |
| NAV-06 | all 8 plans, gate in 05-04/05-06/05-08 | ⚠ PARTIALLY SATISFIED | "No recomputation in the browser" confirmed (win rate is arithmetic over published counts; artifact fetched once; sort/filter are presentation). "Fast load as top priority" — the locked 2.5s LCP gate is **not met** on the congested-venue profile after one documented, reverted fix attempt. See Gaps Summary. |
| TEAM-01 | 05-01, 05-03, 05-04, 05-06 | ✓ SATISFIED | See SC4 |
| EVNT-01 | 05-02, 05-05, 05-07 | ✓ SATISFIED | See SC5 |

**Orphaned requirements:** none — all 8 requirement IDs declared in this phase's plan frontmatters
match the 8 IDs `REQUIREMENTS.md` maps to Phase 5.

**REQUIREMENTS.md staleness (informational, not a gap):** `REQUIREMENTS.md`'s traceability table still
marks all 8 of this phase's requirements `Pending` (unchecked `- [ ]` boxes) as of this verification.
Every other completed phase in this file (1–4) carries `Complete` in that column. This file is not
normally owned by an execute-plan and appears to be a phase-completion/ship-time update this project's
workflow has not yet run for Phase 5 — flagging so it isn't missed at ship time, not scoring it against
the phase.

## Required Artifacts (spot-checked)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/web/src/lib/artifactOrigin.ts` | Single origin definition, `data.sigmascout.org` per D-17a | ✓ VERIFIED | Matches exactly; only file naming a host string |
| `apps/web/src/components/ribbon/Ribbon.tsx` | Persistent ribbon | ✓ VERIFIED | Present, tested, deployed |
| `apps/web/src/components/teams-table/{rowModel,columns,TeamsTable}.{ts,tsx}` | Real Teams table | ✓ VERIFIED | Present, 28 tests total, no color literals |
| `apps/web/src/components/events-list/{EventsList,EventFilters,filterModel}.{ts,tsx}` | Real Events page | ✓ VERIFIED | Present, 32 tests total |
| `apps/web/src/components/search/SearchBox.tsx` + `lib/search-index.ts` | Search | ✓ VERIFIED | Present, 28 tests total, no `RegExp` |
| `apps/web/e2e/{touch-scroll,deep-link,no-page-pan}.spec.ts` | E2E proofs | ✓ VERIFIED (existence + content); not re-run live in this pass | All three exist; `touch-scroll.spec.ts` retargeted at real `TeamsTable`, no live reference to the deleted spike (one historical doc-comment only) |
| `apps/web/src/spike/TableSpike.tsx`, `apps/web/src/routes/spike.tsx` | Deleted per 05-08 | ✓ VERIFIED | Confirmed absent on disk; `/spike` on the live site returns 200 (SPA fallback) with zero spike-content matches |
| `infra/r2-cors.json` | Scoped CORS, no wildcard | ✓ VERIFIED | Three named origins only; live `curl` with an unlisted `Origin` returns no CORS header, live `curl` with `www.sigmascout.org` returns the exact-match header |
| `docs/first-paint-measurement.md` | 4 dated measurement entries | ✓ VERIFIED | All 4 present, honest, internally consistent with the current `vite.config.ts` state |
| `.planning/todos/pending/{static-shell-first-paint,ui-polish-pass}.md` | Filed follow-ups | ✓ VERIFIED | Both exist, both accurately describe the deferred item and cite real measurement/quote evidence |

## Data-Flow Trace (spot-check)

Teams page: `year`/`algorithm`/`sort`/`sortDir` (URL) → `teamsQueryOptions` → `fetchTeamsArtifact` (real
`fetch` against `https://data.sigmascout.org`, schema-validated) → `buildTeamRows`/`sortTeamRows` (pure) →
`TeamsTable`. Live-checked: the artifact fetch is real (confirmed via `curl` against the exact origin the
code uses), not a stub or static fallback — flowing status: **FLOWING**.

Events page: same shape via `eventsQueryOptions`/`fetchEventsArtifact`/`filterModel.ts`. Live-checked:
the `events/2025` artifact genuinely carries populated `country`/`stateProv`/`districtKey`/`week` values
on real rows (spot-checked the raw JSON directly, not through the UI) — **FLOWING**.

## Behavioral Spot-Checks (this pass)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full web test suite | `npx vitest run --project web` | 153/153 pass | ✓ PASS |
| Full workspace test suite | `npx vitest run` | 1095/1095 pass (81 files) | ✓ PASS |
| `apps/web` typecheck | `npx tsc --noEmit -p apps/web/tsconfig.json` | exits 0 | ✓ PASS |
| No color literals outside shadcn `ui/` | `grep -rlE "#[0-9A-Fa-f]{3,8}\b" apps/web/src/components/` (excl. `ui/`) | 0 files | ✓ PASS |
| No debt markers (TBD/FIXME/XXX/HACK) | `grep -rniE` over `apps/web/src` | 0 matches (all "placeholder" hits are legitimate copy/API names/documented interim routes) | ✓ PASS |
| Live apex + www return 200 | `curl` | both 200 | ✓ PASS |
| Live `/spike` serves no spike content | `curl \| grep -ci` | 0 | ✓ PASS |
| CORS scoped, no wildcard | `curl -H Origin:` (listed vs. unlisted) | exact-match header for listed origin; no header for unlisted | ✓ PASS |
| Live events artifact carries all 5 EVNT-01 fields | `curl` + inline JS | all 5 keys present on a real row | ✓ PASS |
| D-19 revert reflected in current build | `grep autoCodeSplitting apps/web/vite.config.ts` | no match (flag absent) | ✓ PASS — matches `docs/first-paint-measurement.md`'s 4th entry and `05-CONTEXT.md`'s D-19 OUTCOME |

Did not re-run: Playwright e2e suite live (requires local browser binaries / deployed-origin network
access this verification pass didn't re-drive), and Lighthouse. Relying on the SUMMARYs' own recorded
runs for those, cross-checked against `docs/first-paint-measurement.md`'s raw numbers and against the
live `vite.config.ts` state, which is independently consistent with the claimed revert.

## Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX` markers in any file this phase touched. All "placeholder" string
matches are legitimate (UI copy text, TanStack Query's `placeholderData` option, and the two
intentionally-scoped placeholder routes — `compare.tsx` for Phase 8, and `events.tsx`'s brief
placeholder-era comment describing its own now-resolved history).

## Gaps Summary

**One real gap, already known and heavily documented by the phase's own process — not newly discovered:**

NAV-06's locked fast-load gate (≤2.5s median LCP, `05-VALIDATION.md`) is not met on the congested-venue
profile (measured ~4.06s with real CDP network+CPU throttling, no simulator). The phase's own process
diagnosed this correctly (JS-bundle weight blocking the ribbon wordmark's paint on a pure client-rendered
SPA), attempted the standard fix (route-level code splitting), measured it honestly with a real-network
A/B, found it made things *worse* on every profile, and reverted it (`29364417` reverting `51ad41d6` —
confirmed as the current shipped state in `apps/web/vite.config.ts`). The correct fix (static shell
markup in `index.html`) is filed with a concrete acceptance test at
`.planning/todos/pending/static-shell-first-paint.md`. A human already made an explicit decision at an
execution checkpoint to close D-19 as NOT ACHIEVED and proceed (`05-CONTEXT.md`).

**This looks intentional and already decided.** Per the escalation-gate pattern, I am not self-applying
an override — no `overrides:` entry exists in this file yet. To formally accept this deviation (which
would flip this item from FAILED to `PASSED (override)` and the overall status to `passed` on
re-verification), add to this file's frontmatter:

```yaml
overrides:
  - must_have: "NAV-06: pages render from precomputed artifacts with fast load as the top priority (05-VALIDATION.md's locked 2.5s median-LCP gate)"
    reason: "Root-caused to JS-bundle weight in a pure client-rendered SPA; the standard fix (route-level code splitting) was implemented, measured with a real-network A/B, found to make every profile slower, and honestly reverted rather than kept for a better Lighthouse number. The real fix (static shell markup in index.html) is filed with an acceptance test at .planning/todos/pending/static-shell-first-paint.md for a dedicated follow-up phase/plan."
    accepted_by: "{your name}"
    accepted_at: "{ISO timestamp}"
```

No other must-have across the ~150 declared in this phase's 8 plans failed verification.

---

_Verified: 2026-08-25T02:09:55Z_
_Verifier: Claude (gsd-verifier)_
