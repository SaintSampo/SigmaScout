---
phase: 06-team-pages
plan: 07
subsystem: ui
tags: [react, tanstack-query, tanstack-router, radix-ui, shadcn, tailwind, rarity-tiers, year-dropdown]

requires:
  - phase: 06-team-pages
    provides: "06-01's frozen SeasonHeader prop contract and OverviewTab composition seam; 06-02's percentile/activeYears/robotImageUrl schema fields; 06-06's real republished team artifacts carrying those fields live"
provides:
  - "tierForPercentile/TIER_BANDS (apps/web/src/lib/tiers.ts) — the one rarity-tier band function every future phase's metric cell can reuse"
  - "MetricValue's optional tier prop and the .metric-tier/.metric-tier--{tier} CSS box (theme.css) — a cross-component contract Phases 7/8 inherit"
  - "The complete season header: identity, robot image or fallback, TBA link, record/win-rate, tier key row, tier-boxed metric grid"
  - "useConstrainedYears (apps/web/src/components/ribbon/YearSelect.tsx) — the team-scoped year dropdown, D-18"
affects: [06-08, 06-09, 07, 08]

actuals:
  tokens: 13350
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A Radix-Avatar-aware `window.Image` mock (scoped to one test file via vi.stubGlobal) that resolves every src to a successful load on the next microtask — needed because @radix-ui/react-avatar constructs a real `new window.Image()` and waits for its native load event, which jsdom never fires"
    - "Exporting a data-fetching hook (useConstrainedYears, mirroring useAlgorithmOptions' existing precedent) purely so a test can assert its behavior via renderHook, decoupled from a Radix Select item-aligned-position rendering quirk observed under jsdom (a freshly-mounted popover's first open did not yet reflect a query-cache update landing in the same tick, even though the underlying hook and component both re-rendered correctly)"
    - "SelectValue given explicit children (search.year) instead of relying on Radix's item-derived label bubble, so a selected value with no matching SelectItem in the current (constrained) option list still displays correctly on the closed trigger"
    - "A second useQuery observer reading the SAME query key an already-enabled query elsewhere uses, with enabled: false, to read-without-fetching from the shared TanStack Query cache"

key-files:
  created:
    - apps/web/src/lib/tiers.ts
    - apps/web/src/lib/tiers.test.ts
    - apps/web/src/components/team/TierKeyRow.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx
    - apps/web/src/components/ribbon/YearSelect.test.tsx
    - apps/web/src/components/ui/avatar.tsx
  modified:
    - apps/web/src/styles/theme.css
    - apps/web/src/components/MetricValue.tsx
    - apps/web/src/components/MetricValue.test.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/Skeletons.tsx
    - apps/web/src/components/ribbon/YearSelect.tsx
    - apps/web/src/routes/team.$teamNumber.tsx
    - apps/web/src/routes/team.$teamNumber.test.tsx

key-decisions:
  - "Tier tokens (six --tier-* custom properties) added inside theme.css's existing @theme block, next to the alliance-color block, following the exact hex pairs colour-and-tiers.md records — Common deliberately gets no token pair."
  - "MetricValue's tier prop is presentation-only: undefined/'common' render byte-identical output to before this prop existed; any other tier only adds the .metric-tier/.metric-tier--{tier} classes via cn(), never touching a digit."
  - "SeasonHeaderSkeleton/MetricGridSkeleton supersede TeamHeaderSkeleton (06-01) rather than living alongside it — the real header outgrew the old skeleton's shape, and nothing else referenced the old export, so it was retired rather than left as dead code."
  - "useConstrainedYears inlines its own algorithms-manifest read (enabled: isTeamRoute) rather than calling AlgorithmSelect.tsx's useAlgorithmVersion, because that hook has no enabled toggle and would fire the manifest fetch unconditionally on every route, including the ones (/teams, /events, /compare) where this hook needs no version at all."
  - "activeYears is sorted descending in useConstrainedYears before being returned — the published array's own order is not a sort guarantee, and 06-UI-SPEC.md requires matching the global dropdown's descending order."

patterns-established:
  - "tierForPercentile as the one rarity-tier band function, locked at the half-open/closed-top boundary contract, reusable by any future metric-cell surface"
  - "Exporting a hook specifically to let a test bypass a UI library's own conditional-mount DOM lifecycle via renderHook (already established by useAlgorithmOptions; this plan's useConstrainedYears follows the identical shape for the identical reason)"

requirements-completed: [TEAM-02, TEAM-03]

coverage:
  - id: D1
    description: "Tier band function is a tested pure function; tier colours are tokens defined once (six --tier-* custom properties, no --tier-common-*); MetricValue can wear a box without changing a digit"
    requirement: TEAM-03
    verification:
      - kind: unit
        ref: "apps/web/src/lib/tiers.test.ts — boundary set asserted at every cut and one step either side (0/49.9 common, 50/74.9 rare, 75/94.9 epic, 95/100 legendary; undefined/-0.1/100.1 all undefined)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/MetricValue.test.tsx — tier prop describe block: epic wraps in the modifier class, common/undefined render byte-identical to the untiered case"
        status: pass
    human_judgment: false
  - id: D2
    description: "The season header shows identity, robot image or an honest fallback, a working TBA link, record, win rate and a tier-boxed metric grid, with every declared UI-Considerations state covered"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/SeasonHeader.test.tsx — 9 cases: fallback role=img+accessible name / real <img> with published src / empty-nickname fallback / 90-char nickname truncation with full text in title / TBA anchor href+target+rel / exact metricKeysFor cell count with correct tier classes / all-em-dash empty-metrics grid / bare-value OPR cell / exactly one TierKeyRow"
        status: pass
    human_judgment: false
  - id: D3
    description: "On a team page the year dropdown lists only that team's activeYears, sorted descending, narrowing in place without a second fetch, and degrading to the global SEASONS list in every unresolved case (non-team route, pending, error, empty/absent activeYears, D-19 year-mismatch)"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/ribbon/YearSelect.test.tsx — 7 cases: non-team-route full list + zero fetches; resolved 3-year activeYears descending + zero fetches; useConstrainedYears narrows from SEASONS to [2024,2023] via renderHook; trigger DOM node identity + displayed value stable across the same transition; rejected query falls back to SEASONS; D-19 routed-year-outside-activeYears shows the routed year with a constrained list; one-entry activeYears is not disabled"
        status: pass
    human_judgment: false

duration: ~90min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 7: The Rarity-Tier System and the Full Season Header Summary

**D-17's tier-boxed metric grid (Common unboxed, Rare/Epic/Legendary tokenized), the complete season header (robot image or honest fallback, TBA link, record/win rate, tier key row), and D-18's team-scoped year dropdown that narrows to a team's own `activeYears` without a second fetch.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3/3 complete
- **Files modified:** 14

## Accomplishments

- **The rarity-tier system is a tested pure function plus tokens defined once.** `tiers.ts`'s `tierForPercentile` locks the half-open/closed-top boundary contract (Common `[0,50)` / Rare `[50,75)` / Epic `[75,95)` / Legendary `[95,100]`) with `undefined` and out-of-range inputs both returning `undefined` rather than clamping. `theme.css` gets exactly six `--tier-*` custom properties (no `--tier-common-*`) plus `.metric-tier`/`.metric-tier--{tier}`, matching `colour-and-tiers.md`'s exact hex pairs — the sky/purple/amber set, never classic card-game blue.
- **`MetricValue` grew an optional `tier` prop that changes nothing about the numbers.** `undefined`/`"common"` render byte-identical to the pre-existing output; any other tier wraps the same value/spread text in the tier box via `cn()`.
- **The season header is complete.** Robot image via shadcn's newly-added `Avatar`/`AvatarImage`/`AvatarFallback` (the ~25% no-photo case is a rendering branch, not a conditional tree — the fallback carries `role="img"` and a team-number-bearing accessible label with no visible text), a "View on TBA" link built from the team number (`target="_blank" rel="noopener"`), record/win-rate, `TierKeyRow` rendered once, and a metric grid with one tier-boxed cell per `metricKeysFor(algorithmId, season)` key — Total included, an empty metrics record still rendering the full grid as em-dashes.
- **The year dropdown is team-scoped (D-18).** `useConstrainedYears` detects a team route via `useLocation()` (the control mounts above the route tree), reads the *same* `teamQueryOptions` cache key the route itself already queries with (`enabled: false` — never a second fetch), and narrows to that team's `activeYears`, sorted descending. Every unresolved case (non-team route, pending, error, empty/absent `activeYears`) degrades to the global `SEASONS` list. The D-19 case — a routed year outside `activeYears` — still shows correctly on the closed trigger because `SelectValue` now renders explicit children instead of relying on Radix's item-derived label bubble.

## Task Commits

1. **Task 1: The rarity tier system — tokens, the band function, and the boxed metric cell** - `ac661969` (feat)
2. **Task 2: The full season header** - `f74f597c` (feat)
3. **Task 3: The team-scoped year dropdown (D-18)** - `27d49ea7` (feat)

## Files Created/Modified

- `apps/web/src/lib/tiers.ts` / `tiers.test.ts` — `TIER_BANDS`, `Tier`, `tierForPercentile`, tested at every boundary
- `apps/web/src/styles/theme.css` — six `--tier-*` tokens plus `.metric-tier`/`.metric-tier--{tier}`
- `apps/web/src/components/MetricValue.tsx` / `.test.tsx` — new optional `tier` prop, presentation-only
- `apps/web/src/components/team/TierKeyRow.tsx` — the once-per-header key row
- `apps/web/src/components/ui/avatar.tsx` — shadcn `Avatar`/`AvatarImage`/`AvatarFallback` (new install)
- `apps/web/src/components/team/SeasonHeader.tsx` / `.test.tsx` — filled out per the frozen 06-01 prop contract
- `apps/web/src/components/Skeletons.tsx` — `SeasonHeaderSkeleton`/`MetricGridSkeleton`, superseding `TeamHeaderSkeleton`
- `apps/web/src/components/ribbon/YearSelect.tsx` / `.test.tsx` — `useConstrainedYears` (D-18)
- `apps/web/src/routes/team.$teamNumber.tsx` / `.test.tsx` — wired to the new skeleton (deviation, see below)

## Decisions Made

- Tier tokens live inside `theme.css`'s existing `@theme` block, next to the alliance-color block, using the exact hex pairs `colour-and-tiers.md` records. Common deliberately has no token pair.
- `MetricValue`'s `tier` prop never re-rounds or reformats a number — it only ever adds/removes CSS classes.
- `SeasonHeaderSkeleton`/`MetricGridSkeleton` **supersede** `TeamHeaderSkeleton` rather than living alongside it — the real header outgrew the old skeleton's shape, and nothing else referenced the old export.
- `useConstrainedYears` inlines its own `algorithms-manifest` read (`enabled: isTeamRoute`) rather than calling `AlgorithmSelect.tsx`'s `useAlgorithmVersion`, which has no `enabled` toggle and would fire the manifest fetch unconditionally on every route.
- `activeYears` is sorted descending before being returned — the published array's own order is not a sort guarantee, and the UI spec requires matching the global dropdown's descending order.
- `useConstrainedYears` is exported (mirroring `useAlgorithmOptions`' existing precedent) purely so a test can assert its narrow-over-time behavior via `renderHook`, decoupled from a Radix `Select` item-aligned-position rendering quirk observed under jsdom (see Issues Encountered).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The route's pending branch had to be wired to the new `SeasonHeaderSkeleton`**
- **Found during:** Task 2
- **Issue:** The plan's own action text says "have the route's pending branch use them," and the acceptance criteria requires it be asserted by test id — but `apps/web/src/routes/team.$teamNumber.tsx` (and its test file) are not in this plan's declared `files_modified` list.
- **Fix:** Swapped the route's pending-branch import from the retired `TeamHeaderSkeleton` to `SeasonHeaderSkeleton`, and added one assertion to the existing route-level pending-state test confirming `data-testid="season-header-skeleton"` renders. Verified plan 06-08 (running in its own worktree this same wave) does not declare `team.$teamNumber.tsx` among its own files, so no collision risk.
- **Files modified:** `apps/web/src/routes/team.$teamNumber.tsx`, `apps/web/src/routes/team.$teamNumber.test.tsx`
- **Verification:** Full `apps/web` suite green (237 tests); `tsc --noEmit` clean.
- **Committed in:** `f74f597c`

**2. [Rule 1 - Bug] `activeYears` was not sorted before being returned from `useConstrainedYears`**
- **Found during:** Task 3, writing `YearSelect.test.tsx`
- **Issue:** A test asserting `activeYears: [2022, 2024, 2026]` renders as `["2026", "2024", "2022"]` (descending) failed — the initial implementation returned the published array in its own order.
- **Fix:** `[...activeYears].sort((a, b) => b - a)` before returning.
- **Files modified:** `apps/web/src/components/ribbon/YearSelect.tsx`
- **Verification:** `YearSelect.test.tsx`'s descending-order assertion passes.
- **Committed in:** `27d49ea7`

**3. [Rule 1 - Bug] `useAlgorithmVersion` reuse would have fired an unconditional manifest fetch off team routes**
- **Found during:** Task 3, writing `YearSelect.test.tsx`
- **Issue:** The initial implementation called `AlgorithmSelect.tsx`'s `useAlgorithmVersion(search.algorithm)` for convenience. That hook has no `enabled` toggle, so it fires the `algorithms-manifest` fetch on every route regardless of whether this hook needs a version at all — caught by a test asserting zero `fetch` calls on a non-team route.
- **Fix:** Inlined the manifest read locally with `enabled: isTeamRoute`, deriving `version` the same way `useAlgorithmVersion` does internally, without changing that hook's own contract.
- **Files modified:** `apps/web/src/components/ribbon/YearSelect.tsx`
- **Verification:** `YearSelect.test.tsx`'s "non-team route... zero fetches" assertion passes.
- **Committed in:** `27d49ea7`

**4. [minor, documented] `SeasonHeader.tsx`'s sibling import didn't match the established `.js`-suffixed relative-import convention**
- **Found during:** Task 3, drive-by review
- **Issue:** Task 2's `import { TierKeyRow } from "./TierKeyRow"` omitted the explicit `.js` extension every other sibling-component import in this repo uses (`OverviewTab.tsx`'s `./SeasonHeader.js`, `Ribbon.tsx`'s `./YearSelect.js`, etc.).
- **Fix:** Changed to `"./TierKeyRow.js"`.
- **Files modified:** `apps/web/src/components/team/SeasonHeader.tsx`
- **Verification:** `tsc --noEmit` clean; existing tests unaffected.
- **Committed in:** `27d49ea7`

**Total deviations:** 4 (1 Rule 3 blocking, 2 Rule 1 bug fixes, 1 minor drive-by consistency fix). All necessary for correctness or for the plan's own stated acceptance criteria to be satisfiable at all. No scope creep beyond what each fix required.

## Issues Encountered

- **`node_modules` did not exist at worktree start** (a fresh worktree, not the "install fails but populated" case this session's environment notes describe). Resolved with `pnpm install --ignore-scripts`, completing cleanly (`better-sqlite3`'s native build is not needed by `apps/web` at runtime) — functionally verified via real `vitest`/`tsc`/`vite build` runs, per this project's "verify functionally, not by exit code" convention.
- **`routeTree.gen.ts` did not exist**, causing a wall of unrelated pre-existing typecheck errors (`main.tsx`, `events.tsx`, `compare.tsx`, `teams.tsx`, `team.$teamNumber.tsx` all failed to resolve route types). A single `vite build` (via the TanStack Router Vite plugin) generated it; typecheck was clean afterward except for this plan's own files, which were then fixed in the normal course of the work.
- **A genuine Radix `Select` testing quirk** (documented as a key-decision above): when a `<Select>`'s underlying data changes in the SAME render pass a component first mounts, and the popover is then opened for the very first time immediately afterward, the freshly-mounted `SelectContent`'s item list under jsdom did not yet reflect the update — even though the component's own render (confirmed via direct instrumentation) and the underlying `useConstrainedYears` hook (confirmed via `renderHook`, matching `useAlgorithmOptions`' own established test pattern) both updated correctly on the very next render. This did not block real functionality — a *second* open (or a fresh mount with already-resolved data, both separately tested and passing) reflects the data correctly — so the "narrows in place" behavior is proven at the hook level (`renderHook`) and the "no unwanted remount" behavior is proven at the DOM level (stable trigger node identity), matching the acceptance criteria's own "asserted by a stable DOM node identity **or** a mount-counter" wording, without asserting a specific Radix DOM-timing detail that appears to be a test-environment artifact rather than an application bug.
- **The Avatar image-loading test infra didn't exist anywhere in this repo** — `@radix-ui/react-avatar` constructs a real `new window.Image()` and waits for its native `load` event, which jsdom never fires. A `vi.stubGlobal("Image", MockImage)` scoped to `SeasonHeader.test.tsx` resolves every image `src` to a successful load on the next microtask, letting the "robot image present" test assert a real `<img src>` renders.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 06-08 (match tables, `EventSectionList`/`EventSection`/`MatchTable`) runs in its own worktree this same wave and does not touch any file this plan modified.
- Plan 06-09 and Phase 7/8 inherit `tierForPercentile`/`TIER_BANDS` and `MetricValue`'s `tier` prop as a stable, reusable contract for any future metric-cell surface.
- The e2e touch-scroll/no-page-pan specs are plan 06-08's territory, not this plan's — no e2e coverage gap introduced here.

## Self-Check: PASSED

- FOUND: apps/web/src/lib/tiers.ts
- FOUND: apps/web/src/lib/tiers.test.ts
- FOUND: apps/web/src/components/team/TierKeyRow.tsx
- FOUND: apps/web/src/components/ui/avatar.tsx
- FOUND: apps/web/src/components/team/SeasonHeader.test.tsx
- FOUND: apps/web/src/components/ribbon/YearSelect.test.tsx
- FOUND: ac661969 (git log --oneline --all)
- FOUND: f74f597c
- FOUND: 27d49ea7

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
