---
phase: 05-site-shell-navigation-browsing
plan: 05
subsystem: ui
tags: [tanstack-router, tanstack-query, zod, shadcn, radix, react, url-state, navigation]

requires:
  - phase: 05-site-shell-navigation-browsing
    provides: "apps/web scaffold, TeamsArtifactSchema fetch boundary (plan 05-01); shadcn primitives, design tokens, MetricValue/Skeletons/StateViews/useIsMobile (plan 05-03)"
provides:
  - "apps/web/src/lib/seasons.ts, metricKeys.ts, resolveSortKey.ts — the season list, the algorithm/season-derived metric-key set, and the ONE sort-key fallback both the year-change and algorithm-change paths call"
  - "apps/web/src/lib/searchParams.ts — RootSearchSchema/TeamsSearchSchema (the URL contract, D-14), applyYearChange (the shared D-11 handler)"
  - "apps/web/src/routes/__root.tsx (validateSearch + the real Ribbon), teams.tsx (URL-driven, manifest-resolved version), events.tsx and compare.tsx (placeholders)"
  - "apps/web/src/components/ribbon/{Ribbon,YearSelect,AlgorithmSelect}.tsx — the persistent top ribbon and both global dropdowns, wired to the URL"
  - "apps/web/src/lib/api/manifests.ts — the narrow client-side algorithms-manifest fetcher (never imports the harness's full manifest schema)"
  - "packages/harness/browserSafeSchemas.test.ts extended with a third entry point (packages/core/algorithms/breakdown/index.ts), Node-built-in-only checked"
  - "apps/web/src/styles/theme.css's --font-sans override — Inter Variable actually applied, closing a gap open since plan 05-01"
affects: [05-06, 05-07, 05-08, phase-06, phase-07, phase-08]

actuals:
  tokens: 19000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One shared sort-key resolver (resolveSortKey.ts) consumed by both the D-11 year-change path (via searchParams.ts's applyYearChange) and the D-13 algorithm-change path (AlgorithmSelect.tsx directly) — never two independent fallback implementations."
    - "Client-side narrow manifest schemas: a page-specific Zod schema declares only the fields the browser needs and silently strips the rest, rather than importing the harness's full schema (which would drag Sigma1's implementation into the bundle) — mirrors 05-01's browser-safe-schema-leaf precedent, now applied to packages/core/algorithms/breakdown/index.ts too (metricKeys.ts's real, verified-Node-free dependency)."
    - "Cross-route global components (Ribbon's YearSelect/AlgorithmSelect, mounted once at the root layout) read search via useSearch({ strict: false }) and navigate via a narrow, documented CrossRouteNavigate type cast — TanStack Router's typed search params have no single type expressing \"any route in the tree,\" so a route-agnostic component needs this escape hatch; the underlying runtime behavior (spread prev, override specific fields) is unaffected."
    - "jsdom test polyfills for Radix Select (hasPointerCapture/releasePointerCapture/scrollIntoView/ResizeObserver) in apps/web/src/test/setup.ts — enables real fireEvent-driven Select interaction tests (open, pick an item) rather than only testing the underlying data hook."

key-files:
  created:
    - apps/web/src/lib/seasons.ts
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/lib/metricKeys.test.ts
    - apps/web/src/lib/resolveSortKey.ts
    - apps/web/src/lib/resolveSortKey.test.ts
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/routes/__root.test.tsx
    - apps/web/src/routes/events.tsx
    - apps/web/src/routes/compare.tsx
    - apps/web/src/lib/api/manifests.ts
    - apps/web/src/lib/api/manifests.test.ts
    - apps/web/src/components/ribbon/Ribbon.tsx
    - apps/web/src/components/ribbon/YearSelect.tsx
    - apps/web/src/components/ribbon/AlgorithmSelect.tsx
    - apps/web/src/components/ribbon/Ribbon.test.tsx
    - apps/web/src/components/ribbon/AlgorithmSelect.test.tsx
  modified:
    - packages/harness/browserSafeSchemas.test.ts
    - apps/web/src/routes/__root.tsx
    - apps/web/src/routes/teams.tsx
    - apps/web/src/styles/theme.css
    - apps/web/src/test/setup.ts

key-decisions:
  - "resolveSortKey(currentSort, validKeys) takes the valid-key SET, not an algorithm id or season — the promotion this plan's <assumption_delta_decision> records. metricKeysFor(algorithmId, season) is the one function that derives that set (OPR: total only; EPA/Sigma1: componentMapForSeason(season).components + total), so a plain year change and an algorithm change share one fallback path."
  - "applyYearChange (searchParams.ts) is generic over YearChangeableSearch (RootSearch plus OPTIONAL sort/sortDir) rather than requiring TeamsSearch specifically — Ribbon mounts once at the root layout and is visible on every route, including Events/Compare, whose search shape carries no sort/sortDir at all in this plan."
  - "manifests.ts declares its own AlgorithmsManifestClientSchema (preamble + id/version/codeVersion/paramSetName only) rather than importing packages/harness/manifestSchemas.ts's AlgorithmsManifestSchema, which imports Sigma1ParamsSchema and transitively reaches the whole Sigma1 implementation — this plan's own <prohibitions> entry and threat T-05-04's mitigation."
  - "__root.tsx and teams.tsx were edited again during Task 3 to actually wire in Ribbon and the real manifest-based version hook, even though neither file is in Task 3's own declared <files> list. Ribbon/manifests.ts did not exist yet at Task 2's point in this plan's sequential execution, so Task 2 could only leave a documented seam (a static placeholder header; a permanently-disabled teams query). Rule 2 (auto-add missing critical functionality): without this follow-up, this plan's own must-have truths — a ribbon on every route, a version-resolved Teams fetch — would be unmet at plan completion."
  - "The font-family gap flagged in this plan's <upstream_context> (Inter imported since 05-01, never applied) is fixed by overriding Tailwind's --font-sans TOKEN inside @theme, not a plain body { font-family } rule. A plain rule using the unquoted two-word family name 'Inter Variable' was silently DROPPED by Vite's production CSS minifier — confirmed by diffing minified vs. unminified build output, the property survived unminified and vanished only after minification. Redeclaring --font-sans (a custom-property VALUE, never touched by the same minifier defect) reaches the identical html/body result through Tailwind's own Preflight mechanism, confirmed with a real headless-Chromium getComputedStyle check: body's computed font-family is now '\"Inter Variable\", ui-sans-serif, system-ui, sans-serif'."
  - "AlgorithmSelect.tsx exports useAlgorithmOptions (not module-private) so AlgorithmSelect.test.tsx can assert the manifest-merge behavior (pending/failure/unknown-id/missing-id/order) directly via renderHook, decoupled from Radix Select's conditional (open-only) content mounting — the component-level tests then focus on the two behaviors that genuinely need real DOM interaction: the reselect-same-value no-op and its contrast case."
  - "Three explicit <Link> elements in Ribbon.tsx's NavLinks, not a .map() over the NAV_LINKS constant — TanStack Router's typed search={...} prop loses its per-route overload resolution when to is a mapped union type; NAV_LINKS still names the one canonical Teams/Events/Compare order both the mobile and desktop branches render from the same JSX-returning function, so there is no risk of the two branches disagreeing on link order."

patterns-established:
  - "The URL is the single source of truth for year/algorithm/sort/sortDir (D-14): every read goes through RootSearchSchema/TeamsSearchSchema's validateSearch output, never a raw search param; every write goes through the updater form (prev) => ({ ...prev, ... }), never an object literal, per this plan's own <prohibitions>."
  - "A cross-route global component reads search via useSearch({ strict: false }) and writes via a narrow, locally-scoped CrossRouteNavigate type cast, documented inline — the pattern any future global (non-route-scoped) component in this app should follow."

requirements-completed: [NAV-01, NAV-02, NAV-04, NAV-05]

coverage:
  - id: D1
    description: "metricKeysFor(algorithmId, season) derives the declared column set per algorithm/season pair, and resolveSortKey(currentSort, validKeys) is the ONE fallback both the year-change and algorithm-change paths call — never two implementations."
    requirement: NAV-02
    verification:
      - kind: unit
        ref: "apps/web/src/lib/metricKeys.test.ts (7 tests), resolveSortKey.test.ts (6 tests) — all pass"
        status: pass
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts (4 tests, including the new breakdown/index.ts Node-built-in-only entry point) — all pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "RootSearchSchema/TeamsSearchSchema validate year/algorithm/sort/sortDir once at the router boundary; every field coerces to a declared-valid default rather than reaching a component as a raw string (T-05-02); the navigation updater form preserves untouched params across a route change."
    requirement: NAV-05
    verification:
      - kind: unit
        ref: "apps/web/src/routes/__root.test.tsx (8 tests: round trip on all four params, out-of-range year/unknown algorithm coercion, missing-param defaults, adversarial-string handling, cross-route updater-form preservation) — all pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "The persistent Ribbon renders on every route with the wordmark, three nav links in a fixed Teams/Events/Compare order (reflows, never reorders, at mobile), the active-link accent indicator, and a 44x44 accessible search trigger — never gated on any fetch."
    requirement: NAV-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/ribbon/Ribbon.test.tsx (7 tests: not fetch-gated, fixed order at desktop and with the mobile hook forced true, active-link data-status, search trigger accessible name + tap-target class, year reselect no-op + contrast case) — all pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "YearSelect and AlgorithmSelect re-slice the current page via the URL; reselecting the already-selected value is a no-op (no navigation); an algorithm change resolves the sort key through resolveSortKey against the new pair's key set, preserving direction; the algorithm dropdown is never empty, merges the manifest over the build-time id list in the constant's own order, and shows no freshness color/dot/badge."
    requirement: NAV-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/ribbon/AlgorithmSelect.test.tsx (8 tests: manifest-pending/failure options via renderHook, unknown-id ignored, missing-id no-suffix, PUBLISHED_ALGORITHM_IDS order independent of manifest order, no error banner on failure, reselect no-op, contrast case) — all pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "The client-side algorithms-manifest fetcher declares its own narrow schema and never imports the harness's full manifest-schema module (T-05-04) — the manifest key literal matches the Worker's own constant."
    requirement: NAV-02
    verification:
      - kind: unit
        ref: "apps/web/src/lib/api/manifests.test.ts (5 tests: happy path, extra-key stripping, fetch/validation errors, exact key literal) — all pass"
        status: pass
      - kind: other
        ref: "grep -rn manifestSchemas apps/web/src -> no match"
        status: pass
    human_judgment: false
  - id: D6
    description: "Inter is actually applied site-wide (documented deviation, closing the gap open since plan 05-01) — theme.css's --font-sans override, verified in a real headless-Chromium getComputedStyle check, not just declared."
    verification:
      - kind: e2e
        ref: "Headless Chromium against a built+preview-served /teams page: window.getComputedStyle(document.body).fontFamily === '\"Inter Variable\", ui-sans-serif, system-ui, sans-serif' (checked and re-confirmed after the --font-sans fix; a plain body{font-family} rule was verified DROPPED by the production minifier first, via a minified-vs-unminified build diff)"
        status: pass
    human_judgment: false

duration: ~2h15m
completed: 2026-08-24
status: complete
---

# Phase 5 Plan 05: Site Shell — URL Contract, Ribbon & Global Dropdowns Summary

**A validated root search schema (year/algorithm/sort/sortDir, coerce-or-catch to a declared default, never a raw hand-edited value), a responsive persistent ribbon with both global dropdowns wired to the URL, and the one shared sort-key resolver that both a year change and an algorithm change fall back through — the shell every Phase 5-8 page hangs off.**

## Performance

- **Duration:** ~2h15m
- **Completed:** 2026-08-24
- **Tasks:** 3
- **Files modified:** 21 (16 created, 5 modified)

## Accomplishments

- `metricKeysFor(algorithmId, season)` and the ONE `resolveSortKey(currentSort, validKeys)` fallback — the promotion this plan's assumption-delta block records: the valid metric-key set is season-dependent as well as algorithm-dependent, so a plain year change (2026→2022, dropping `hubShift1`) invalidates a sort exactly like an algorithm change (EPA→OPR) does, through the same function.
- `RootSearchSchema`/`TeamsSearchSchema` (D-14): year, algorithm, sort and sort direction all live in the URL, every field either coerces to a declared-valid default or lands there via `.catch()` — a hand-edited or adversarial-shaped param can only ever reach render logic in one of this schema's own valid states (T-05-02).
- The real `Ribbon`: wordmark, three nav links in a fixed Teams/Events/Compare order at both breakpoints (CSS/DOM reflow via `useIsMobile`, never a reorder), both global dropdowns, and the settled 44×44 search-trigger slot for plan 05-08. Renders on every route, gated on no fetch.
- `YearSelect`/`AlgorithmSelect`: both dropdowns re-slice the current page through the URL's updater form; reselecting the already-selected value is a no-op; an algorithm change re-resolves the sort key through `resolveSortKey`, preserving direction (D-13); the algorithm dropdown is present and complete from the first paint (build-time `PUBLISHED_ALGORITHM_IDS`), gains version suffixes as the manifest resolves, and shows no freshness color/dot/badge anywhere.
- `manifests.ts`: a narrow, browser-safe algorithms-manifest fetcher — never imports the harness's full manifest schema, which would drag the entire Sigma1 implementation into the client bundle (T-05-04).
- `events.tsx`/`compare.tsx` placeholders so the ribbon's links never 404 ahead of plan 05-07/Phase 8.
- Extended `browserSafeSchemas.test.ts` with a third entry point (`packages/core/algorithms/breakdown/index.ts`, now a real, purposeful client dependency via `metricKeys.ts`), checked for Node built-ins only.
- Fixed the font-family gap flagged in this plan's `<upstream_context>` — Inter is now actually applied, verified in a real headless browser, not just declared (see Deviations).

## Task Commits

Each task was committed atomically:

1. **Task 1: The metric-key set and the one sort-key resolver both triggers share** - `ba8056cb` (feat)
2. **Task 2: Typed URL state and the four routes** - `7a3acd97` (feat)
3. **Task 3: The ribbon and the two global dropdowns** - `636475f8` (feat)

**Plan metadata:** (this commit, immediately following)

## Files Created/Modified

- `apps/web/src/lib/seasons.ts` - `SEASONS`/`CURRENT_SEASON`/`FIRST_SEASON`, built from two bounds, tested against the algorithms' own season registry
- `apps/web/src/lib/metricKeys.ts` - `metricKeysFor`, `TOTAL_KEY` (re-exported, never re-declared)
- `apps/web/src/lib/resolveSortKey.ts` - the one sort-key fallback, `(currentSort, validKeys) -> string`
- `apps/web/src/lib/searchParams.ts` - `RootSearchSchema`, `TeamsSearchSchema`, `applyYearChange` (the shared D-11 handler)
- `apps/web/src/routes/__root.tsx` - `validateSearch` + the real `Ribbon`
- `apps/web/src/routes/teams.tsx` - reads year/algorithm from search; version resolved via `useAlgorithmVersion`
- `apps/web/src/routes/events.tsx`, `compare.tsx` - placeholder routes
- `apps/web/src/lib/api/manifests.ts` - the narrow client-side algorithms-manifest fetcher
- `apps/web/src/components/ribbon/Ribbon.tsx`, `YearSelect.tsx`, `AlgorithmSelect.tsx` - the shell's visible half
- `apps/web/src/styles/theme.css` - `--font-sans` override (Inter actually applied)
- `apps/web/src/test/setup.ts` - jsdom polyfills for Radix `Select` interaction
- `packages/harness/browserSafeSchemas.test.ts` - third entry point (`breakdown/index.ts`)

## Decisions Made

See frontmatter `key-decisions` for the full list with rationale. Highlights: `resolveSortKey` takes a key SET not an algorithm/season; `applyYearChange` is generic over any route's search shape since Ribbon mounts globally; `manifests.ts` never imports the harness's full manifest schema; `__root.tsx`/`teams.tsx` needed a Task 3 follow-up edit outside Task 3's own declared files (documented below); the font-family fix targets Tailwind's `--font-sans` token, not a plain rule, because of a real production-minifier defect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `__root.tsx` and `teams.tsx` edited again during Task 3 to wire in `Ribbon` and the real manifest-based version hook**
- **Found during:** Task 3, after `Ribbon.tsx`/`manifests.ts` existed
- **Issue:** This plan's Task 2 text says the root route should "render the ribbon above the outlet" and Task 2's `teams.tsx` should resolve its artifact version from the algorithms manifest — but `Ribbon`/`manifests.ts` are Task 3 deliverables that did not exist yet at Task 2's point in this plan's sequential execution. Task 2 could only wire `validateSearch` and leave the tracer's placeholder header, and leave `teams.tsx`'s query permanently disabled (`version` hard-coded `undefined`). Neither `__root.tsx` nor `teams.tsx` is in Task 3's own declared `<files>` list, so without a follow-up edit this plan's own must-have truths ("a persistent top ribbon carries the wordmark and links... on every route"; the algorithm dropdown's version-suffix behavior) would be unmet at plan completion.
- **Fix:** `__root.tsx`'s `RootLayout` now renders `<Ribbon />` instead of the placeholder header. `teams.tsx` now calls `useAlgorithmVersion(algorithm)` (exported from `AlgorithmSelect.tsx`) instead of a hard-coded `undefined`, enabling the query once the manifest resolves a real version.
- **Files modified:** `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/teams.tsx`
- **Verification:** `pnpm --filter web build`/`typecheck` exit 0; `Ribbon.test.tsx` proves the ribbon renders on every route; `teams.tsx`'s query is `enabled: version !== undefined`, now backed by a real, testable hook.
- **Committed in:** `636475f8` (Task 3 commit)

**2. [Rule 1 - Bug] `theme.css`'s font-family fix required overriding `--font-sans`, not a plain `body { font-family }` rule**
- **Found during:** Fixing the font-family gap flagged in this plan's `<upstream_context>`
- **Issue:** A plain `body { font-family: "Inter Variable", sans-serif; }` rule compiled correctly in an unminified build but was silently DROPPED entirely by Vite's production CSS minifier — confirmed by diffing `vite build` (minified) vs. `vite build --mode development --minify false` (unminified) output for the exact same source. The unquoted two-word family name Lightning CSS produces internally (`Inter Variable, sans-serif`, quotes stripped during normalization) appears to trigger a minifier defect that drops the whole declaration, not just the quoting.
- **Fix:** Overrode Tailwind's own `--font-sans` custom property inside the `@theme` block instead (`--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;`). Tailwind's Preflight already sets `html`'s `font-family` to `var(--default-font-family, ...)`, which resolves through `var(--font-sans)` — redeclaring the custom-property VALUE (never touched by the same minifier defect, since it survives as a `--font-sans:` declaration rather than a `font-family:` property value) reaches the identical `html`/inherited-`body` result.
- **Files modified:** `apps/web/src/styles/theme.css`
- **Verification:** Real headless-Chromium check against the production-built, `vite preview`-served `/teams` page: `window.getComputedStyle(document.body).fontFamily` returns `'"Inter Variable", ui-sans-serif, system-ui, sans-serif'` — confirmed BOTH before the fix (returned the system fallback stack, proving the bug was real) and after (returned Inter, proving the fix works in the actual minified production artifact, not just source).
- **Committed in:** `636475f8` (Task 3 commit)

**3. [Rule 3 - Blocking] `browserSafeSchemas.test.ts`'s new third entry point could not reuse the existing `algorithmDirViolations` assertion**
- **Found during:** Task 1
- **Issue:** The plan's own text says the new `packages/core/algorithms/breakdown/index.ts` entry point is "checked only for Node built-ins," but the existing `scan()` function's `algorithmDirViolations` check would trivially fail for this entry point — it literally lives inside `packages/core/algorithms/`, which is exactly what that check flags.
- **Fix:** Added a separate `it()` block that calls `scan([BREAKDOWN_ENTRY_POINT])` and asserts only on `nodeBuiltinViolations` (plus a non-vacuousness sanity check that the scan actually visits a real per-season module), never touching `algorithmDirViolations` for this run — the original two-entry-point test and its `algorithmDirViolations` assertion are completely unchanged.
- **Files modified:** `packages/harness/browserSafeSchemas.test.ts`
- **Verification:** `vitest run packages/harness/browserSafeSchemas.test.ts` — 4 tests, all pass.
- **Committed in:** `ba8056cb` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 2 — missing critical cross-task wiring; 1 Rule 1 — a genuine CSS minifier bug worked around; 1 Rule 3 — blocking test-structure issue)
**Impact on plan:** All three were necessary for this plan's own stated must-haves and `<upstream_context>` instruction to actually hold at plan completion. No scope creep beyond what the plan itself specified.

## Issues Encountered

- **Vitest's default CSS handling stubs out CSS imports** (no `test.css: true` configured), so a jsdom `getComputedStyle` assertion against an imported stylesheet reports nothing meaningful (`document.styleSheets.length === 0`) — this is why the font-family fix's real proof is a headless-Chromium check against a real production build, not a unit test. No jsdom-level regression test for the font-family fix exists; a future plan touching `theme.css` should re-verify with the same headless-browser method if it changes `--font-sans` again.
- **TanStack Router's typed `search` prop for `<Link>`/`navigate()` has no single type expressing "any route in the tree"** for a cross-route global component (this ribbon is exactly that shape). Worked around with narrow, documented, local type casts (`CrossRouteNavigate` in `YearSelect.tsx`/`AlgorithmSelect.tsx`, `preserveSearch` in `Ribbon.tsx`) rather than a broad `any` — every cast is scoped to one function signature and commented with the reasoning.
- **The repo's `WINDOWS.md` broken-windows ledger tool (`gsd-tools windows append`) errored** on this repo's current `WINDOWS.md` frontmatter (`Ledger frontmatter line is not key: value`) rather than the documented `windows_ledger_missing`/`windows_ok` skip paths — not fixed (out of this plan's scope; a pre-existing tool/file issue). Per the tool's own optionality contract, this did not block execution; the two placeholder routes and the render-only search trigger are instead documented below under Known Stubs.

## Known Stubs

Both are explicitly named as this PLAN's own intentional scope boundary (not a corner cut during execution):

| File | Stub | Reason | Resolved by |
|------|------|--------|-------------|
| `apps/web/src/routes/events.tsx` | Heading + skeleton placeholder, no fetch | 05-CONTEXT.md's phase boundary: "team detail pages (Phase 6), event detail pages (Phase 7)... The ribbon links to Compare, but the page itself is Phase 8's" — Events' real EVNT-01 list/filters are plan 05-07's | Plan 05-07 |
| `apps/web/src/routes/compare.tsx` | Static text placeholder, no fetch | Same phase boundary — the Compare page (prediction accuracy per algorithm per year) is Phase 8's | Phase 8 |
| `apps/web/src/components/ribbon/Ribbon.tsx`'s search trigger | Renders the 44×44 `aria-label="Open search"` button with no `onClick`/results dropdown behavior | This plan's own Task 3 text: "render the 44 by 44 pixel icon trigger with its accessible label now so the layout is settled" — the search box itself is plan 05-08's | Plan 05-08 |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Every later Phase 5-8 page can compose from `RootSearchSchema`/`TeamsSearchSchema`'s pattern (extend, never restate), `resolveSortKey`/`metricKeysFor` for any future algorithm-or-season-aware column set, and the ribbon's `useSearch({ strict: false })` + narrow-cast `navigate` pattern for any other globally-mounted control.
- Plan 05-06 (the real Teams table) can now read `year`/`algorithm`/`sort`/`sortDir` straight from `Route.useSearch()` and resolve the artifact version via `useAlgorithmVersion` — the disabled-until-resolved query seam from Task 2 is now fully wired end to end.
- Plan 05-07 (Events) replaces `events.tsx`'s placeholder with the real EVNT-01 list; it inherits `RootSearchSchema` for year/algorithm and will extend it with its own filter search params the same way `TeamsSearchSchema` extends it with sort/sortDir.
- Plan 05-08 (search) fills the ribbon's search-trigger slot; the 44×44 tap-target and accessible label are already settled, so 05-08 only needs to wire behavior in, not touch layout.
- The `WINDOWS.md` ledger tool error (Issues Encountered) is unrelated to this plan's own scope and was not fixed — flagged for whoever next touches that tooling.

---
*Phase: 05-site-shell-navigation-browsing*
*Completed: 2026-08-24*

## Self-Check: PASSED

All 21 files listed in `key-files` confirmed tracked via `git ls-files`; all three task
commit hashes (`ba8056cb`, `7a3acd97`, `636475f8`) confirmed present in `git log --oneline --all`.
