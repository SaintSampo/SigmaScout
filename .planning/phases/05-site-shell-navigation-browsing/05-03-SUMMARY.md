---
phase: 05-site-shell-navigation-browsing
plan: 03
subsystem: ui
tags: [shadcn, radix, tailwindcss, react, design-tokens, vitest, testing-library]

requires:
  - phase: 05-site-shell-navigation-browsing
    provides: "apps/web scaffold (Vite + React 19 + Tailwind v4 + TanStack Router/Query), src/styles/theme.css's initial four contract tokens (plan 05-01)"
provides:
  - "apps/web/components.json — shadcn project config, official registry only, preset neutral/CSS-variables-on/radius 0.375rem"
  - "apps/web/src/components/ui/* — select, command, sheet, badge, skeleton, button, separator, table, plus dialog/input/input-group/textarea pulled in as registry-declared dependencies of sheet/command"
  - "apps/web/src/lib/utils.ts — cn (clsx + tailwind-merge)"
  - "apps/web/src/styles/theme.css — shadcn's semantic variables aliased onto the D-06 contract tokens; four typography role classes; the spread-suffix exception class; the 44px tap-target class"
  - "apps/web/src/lib/breakpoints.ts — MOBILE_BREAKPOINT_PX, useIsMobile()"
  - "apps/web/src/components/Skeletons.tsx — SkeletonRows(rows, columns), the D-16 first-load primitive"
  - "apps/web/src/components/StateViews.tsx — EmptyState, ErrorState"
  - "apps/web/src/components/MetricValue.tsx — the D-07 value-and-spread display primitive, TDD'd against all 8 named behaviours"
affects: [05-04, 05-05, 05-06, 05-07, 05-08]

actuals:
  tokens: 16700
  tasks: 3
  commits: 4

tech-stack:
  added: ["radix-ui@1.6.7", "shadcn@4.19.0", "tw-animate-css@1.4.0", "@fontsource-variable/geist@5.3.0 (installed by shadcn's Nova preset, unused — Inter remains the only font actually imported)"]
  patterns:
    - "Token derivation direction: theme.css's own D-06 contract tokens (--color-bg-page, --color-bg-surface, --color-accent, --color-destructive, --color-text-muted, --color-text-primary) are the single source of truth; every shadcn semantic variable a generated src/components/ui/* primitive references (--color-background, --color-primary, --color-secondary, --color-muted, --color-border, --color-ring, --color-popover, --color-accent-foreground) is declared as a var(--color-*) alias of a contract token, never an independent value."
    - "Accent reuse without a second baked color: --color-accent (indigo-600) is used at full strength for --color-primary/--color-ring (CTA buttons, focus rings) and at 10% opacity via Tailwind's own /10 modifier — not a separate lighter CSS variable — for the one reserved-for case (a keyboard-highlighted dropdown row) that wants a tint. Applied identically in the generated select.tsx (focus:bg-accent/10)."
    - "vitest.config.ts restates vite.config.ts's \"@/*\" -> \"./src/*\" alias (the two configs don't share resolve config) — any future apps/web *.test.tsx importing a \"@/...\" path needs this present."

key-files:
  created:
    - apps/web/components.json
    - apps/web/src/lib/utils.ts
    - apps/web/src/components/ui/select.tsx
    - apps/web/src/components/ui/command.tsx
    - apps/web/src/components/ui/sheet.tsx
    - apps/web/src/components/ui/badge.tsx
    - apps/web/src/components/ui/skeleton.tsx
    - apps/web/src/components/ui/button.tsx
    - apps/web/src/components/ui/separator.tsx
    - apps/web/src/components/ui/table.tsx
    - apps/web/src/components/ui/dialog.tsx
    - apps/web/src/components/ui/input.tsx
    - apps/web/src/components/ui/input-group.tsx
    - apps/web/src/components/ui/textarea.tsx
    - apps/web/src/lib/breakpoints.ts
    - apps/web/src/components/Skeletons.tsx
    - apps/web/src/components/StateViews.tsx
    - apps/web/src/components/StateViews.test.tsx
    - apps/web/src/components/MetricValue.tsx
    - apps/web/src/components/MetricValue.test.tsx
  modified:
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/vite.config.ts
    - apps/web/vitest.config.ts
    - apps/web/src/styles/theme.css
    - apps/web/src/test/setup.ts
    - pnpm-lock.yaml

key-decisions:
  - "The installed shadcn CLI (4.19.0) is a materially different major than the UI-SPEC anticipated: no --base-color flag, no literal 'neutral' preset name — instead a --preset picker of named identities (nova/vega/maia/lyra/mira/luma/sera/rhea). Chose preset 'nova' (Lucide/Geist) with --base radix: Lucide matches the project's already-fixed icon library, and 'radix' matches the UI-SPEC's stated 'Component library: Radix primitives via shadcn'. The resulting components.json's baseColor field still reads 'neutral' and cssVariables: true, radius 0.375rem — the UI-SPEC's actual constraints are all satisfied even though the CLI's own vocabulary for reaching them changed."
  - "npx shadcn init could not complete in this environment: its dependency-install step shells out to a workspace-wide `pnpm add`, which triggers the pre-existing, expected, non-blocking better-sqlite3 postinstall failure (worktree bootstrap note) elsewhere in the monorepo — and this shadcn version treats any nonzero exit from that subprocess as fatal, aborting before it writes theme.css or lib/utils.ts. Worked around by using `npx shadcn add <block>` per-component instead (which skips the install step entirely once a component's dependencies are already resolved) plus one explicit `npx shadcn add utils` for the cn helper. components.json itself DID get written by the first (aborted) init run with the correct preset, so it did not need to be hand-authored."
  - "That same aborted init run left apps/web's dependency lockfile out of sync with its package.json: pnpm resolved and linked radix-ui/shadcn/tw-animate-css/@fontsource-variable/geist into pnpm-lock.yaml and apps/web/node_modules before the postinstall failure aborted the write to package.json. Manually added the four packages to apps/web/package.json's dependencies at the versions the lockfile already resolved, restoring manifest/lockfile consistency without a fresh install."
  - "Added the '@/*' -> './src/*' path alias to tsconfig.json and vite.config.ts (Task 1's own acceptance criteria anticipates and permits exactly this: 'accept only additions that are genuinely required for the alias to resolve') — shadcn's initializer hard-requires a resolvable import alias before it will even write components.json."
  - "vitest.config.ts also needed the same alias (it does not inherit vite.config.ts's resolve config) — without it, every generated src/components/ui/* file's '@/lib/utils' import fails to resolve under Vitest specifically, surfacing only when a component test imports one, not at build or typecheck time."
  - "select.tsx's SelectItem highlight changed from focus:bg-accent (solid fill) to focus:bg-accent/10, and the same rule is documented as generalized to any keyboard-highlighted row in a listbox, not literally scoped to the search Command dropdown the UI-SPEC's reserved-for list names verbatim — Select's own option highlighting is the structurally identical interaction and no separate accent value exists to differ between them."
  - "--color-border/--color-input (#cbd5e1, slate-300) and --color-primary-foreground (#ffffff) are new literals not named by the UI-SPEC's four colour roles — same class of open-gap discretion as 05-01's --color-text-muted precedent, documented inline in theme.css rather than left unresolved, since every generated primitive needs a border color and CTA text color to render at all."
  - "NAV-04/TEAM-01 (this plan's frontmatter requirements) intentionally NOT marked complete — both IDs also appear in 05-01, 05-04 through 05-08's requirements lists (grep-confirmed). This plan ships the design-system foundation (tokens, primitives, MetricValue) every later plan composes from, not the ribbon/search (NAV-04) or the full Teams page (TEAM-01) themselves. Matches this project's established ALGO-03/ALGO-05/ALGO-08 precedent for foundation-only plans."

patterns-established:
  - "Generated shadcn primitives live in apps/web/src/components/ui/ as editable source, not node_modules content — any styling adjustment needed to satisfy a UI-SPEC rule (see the select.tsx accent-tint fix) is a normal in-repo edit, not an override layer."
  - "Typography role classes (.text-role-body/.text-role-label/.text-role-heading/.text-role-display/.text-role-spread-suffix) and .tap-target/.numeric-cell live in theme.css as plain CSS classes, not Tailwind @apply macros — kept simple since Tailwind v4's @theme block already handles the color/spacing token layer."

requirements-completed: []

coverage:
  - id: D1
    description: "shadcn initialized with the official registry only (components.json's registries field is empty) and the eight named blocks (select, command, sheet, badge, skeleton, button, separator, table) generated as editable source"
    requirement: NAV-04
    verification:
      - kind: unit
        ref: "grep -rn 'registries' apps/web/components.json -> {} (empty, no third-party registry)"
        status: pass
      - kind: other
        ref: "ls apps/web/src/components/ui/ lists select.tsx, command.tsx, sheet.tsx, badge.tsx, skeleton.tsx, button.tsx, separator.tsx, table.tsx (plus dialog/input/input-group/textarea, registry-declared dependencies of sheet/command)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every generated and hand-written component under src/components/ resolves colour through a theme.css token, never a literal (D-06/NAV-04)"
    requirement: NAV-04
    verification:
      - kind: unit
        ref: "grep -rnE '#[0-9A-Fa-f]{3,8}\\b' apps/web/src/components/ -> no matches"
        status: pass
      - kind: integration
        ref: "pnpm --filter web build exits 0 (Tailwind v4 resolves every bg-*/text-* utility against theme.css's @theme block with no unresolved custom property)"
        status: pass
    human_judgment: false
  - id: D3
    description: "MetricValue renders the D-07 value/spread contract for all 8 named cases: value+spread, no-spread (no separator), absent metric (em-dash), real zero, digit-restoring toFixed(2) (no re-rounding), zero spread, non-wrapping container, muted-token suffix colour"
    requirement: TEAM-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/MetricValue.test.tsx (8 tests, all pass)"
        status: pass
      - kind: unit
        ref: "grep -cE '#[0-9A-Fa-f]{3,8}\\b' MetricValue.tsx -> 0; grep -c toFixed(2) MetricValue.tsx -> 3; no Math.round/Math.floor/multiplication/division applied to metric.value or metric.spread"
        status: pass
    human_judgment: false
  - id: D4
    description: "Token layer reconciled: shadcn's semantic variables alias the D-06 contract tokens (documented derivation direction), only weights 400/600 declared, tnum + 44px tap-target rules present"
    requirement: NAV-04
    verification:
      - kind: unit
        ref: "grep -cE 'font-weight:\\s*(500|700|800|900)' theme.css -> 0; grep -c tnum theme.css -> 1; grep min-width/min-height 44px -> present"
        status: pass
    human_judgment: false
  - id: D5
    description: "SkeletonRows(rows, columns) and EmptyState/ErrorState exist as the shared D-16/Copywriting-Contract primitives wave-4 tables will consume"
    requirement: NAV-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/StateViews.test.tsx (7 tests: exact copy for both Events and D-11 year-substituted Teams headings, Clear-filters absence/presence/callback, exact error-copy interpolation for two resources, Retry callback) — all pass"
        status: pass
    human_judgment: false

duration: ~2h
completed: 2026-08-24
status: complete
---

# Phase 5 Plan 03: Design System — shadcn Primitives, Token Layer, MetricValue Summary

**Eight shadcn primitives (select, command, sheet, badge, skeleton, button, separator, table) generated from the official registry only, a reconciled `theme.css` where every shadcn semantic variable aliases the D-06 contract's own tokens, and a TDD'd `MetricValue` component proving all 8 D-07 value/spread display cases — the foundation every later Phase 5-8 component composes from.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-08-24
- **Tasks:** 3 (Task 3 ran RED then GREEN — 4 commits total)
- **Files modified:** 26 (excluding `pnpm-lock.yaml`)

## Accomplishments

- Initialized shadcn (v4.19.0, a materially newer CLI than the UI-SPEC anticipated) with `components.json` pinned to the official registry only, `baseColor: neutral`, `cssVariables: true`, `radius: 0.375rem` — the UI-SPEC's exact preset, reached through the new CLI's `--preset nova --base radix` vocabulary.
- Generated the eight named registry blocks (plus four registry-declared dependencies of `sheet`/`command`: `dialog`, `input`, `input-group`, `textarea`) as editable source under `src/components/ui/`, worked around a real environment blocker in the CLI's own dependency-install step (see Deviations).
- Reconciled `theme.css` into a single source of truth: shadcn's `--color-primary`/`--color-secondary`/`--color-muted`/`--color-border`/`--color-ring`/`--color-popover`/`--color-accent-foreground` all alias the pre-existing D-06 contract tokens, with the reserved-for accent color reused at both full strength and a `/10` Tailwind opacity tint rather than duplicated as a second baked color.
- Added the four typography role classes, the spread-suffix exception class, the `.tap-target` (44×44px minimum) class, `MOBILE_BREAKPOINT_PX`/`useIsMobile()`, `SkeletonRows`, and `EmptyState`/`ErrorState`.
- TDD'd `MetricValue` against all 8 named D-07 behaviours: value+spread, no-spread (no stray separator), absent metric (single em-dash), real zero (not an em-dash), digit-restoring `toFixed(2)` (not re-rounding), zero spread (still renders), non-wrapping container, muted-token suffix colour.
- Confirmed root `pnpm typecheck` (0 errors) and root `pnpm test` (66 test files, 872 passed, 23 skipped, 0 failed) both stay green with this plan's changes applied.

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize shadcn and generate the eight primitives** - `836e05f5` (feat)
2. **Task 2: Reconcile the token layer and add the shared responsive utilities** - `3bd5e093` (feat)
3. **Task 3: MetricValue — the value-and-spread display primitive (D-07)** - RED `a7ffad89` (test), GREEN `9bdbc4ce` (feat)

**Plan metadata:** (this commit, immediately following)

## Files Created/Modified

- `apps/web/components.json` - shadcn project config, official registry only
- `apps/web/src/lib/utils.ts` - `cn` (clsx + tailwind-merge)
- `apps/web/src/components/ui/{select,command,sheet,badge,skeleton,button,separator,table}.tsx` - the eight named registry primitives
- `apps/web/src/components/ui/{dialog,input,input-group,textarea}.tsx` - registry-declared dependencies of sheet/command
- `apps/web/src/styles/theme.css` - shadcn variable aliases, typography roles, tap-target class
- `apps/web/src/lib/breakpoints.ts` - `MOBILE_BREAKPOINT_PX`, `useIsMobile`
- `apps/web/src/components/Skeletons.tsx` - `SkeletonRows`
- `apps/web/src/components/StateViews.tsx` + `.test.tsx` - `EmptyState`, `ErrorState`
- `apps/web/src/components/MetricValue.tsx` + `.test.tsx` - the D-07 display primitive
- `apps/web/tsconfig.json`, `vite.config.ts`, `vitest.config.ts` - the `"@/*"` import alias shadcn requires, restated in both Vite configs
- `apps/web/src/test/setup.ts` - callable `window.matchMedia` stub for jsdom
- `apps/web/package.json`, `pnpm-lock.yaml` - four packages shadcn's initializer resolved (`radix-ui`, `shadcn`, `tw-animate-css`, `@fontsource-variable/geist`)

## Decisions Made

See frontmatter `key-decisions` for the full list with rationale. Summary:
- shadcn CLI major-version mismatch resolved via `--preset nova --base radix`, which reaches the UI-SPEC's actual constraints (neutral/CSS-variables/0.375rem) through different flag vocabulary.
- Worked around the CLI's `init` step being unable to complete in this environment (see Deviations) by using per-component `add` instead.
- Manually reconciled `apps/web/package.json` with the lockfile after the aborted `init` left them out of sync.
- Generalized the UI-SPEC's "search dropdown 10% tint" rule to `select.tsx`'s own keyboard-highlighted row, since no separate accent value exists to differ between the two structurally identical interactions.
- `--color-border`/`--color-input`/`--color-primary-foreground` are new literals filling an open UI-SPEC gap, same discretion class as 05-01's `--color-text-muted` precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npx shadcn init`'s dependency-install step could not complete in this environment**
- **Found during:** Task 1
- **Issue:** The installed shadcn CLI (4.19.0) shells out to a workspace-wide `pnpm add` when installing dependencies. This monorepo's `better-sqlite3` postinstall reproducibly fails (`node-gyp rebuild`, no Visual Studio Build Tools — the exact pre-existing, expected, non-blocking condition the worktree bootstrap note describes). This shadcn version treats any nonzero exit from that subprocess as fatal and aborts the whole `init` flow BEFORE writing `theme.css`'s CSS variable block or `src/lib/utils.ts`, even though the actual package being added resolves and links successfully.
- **Fix:** Used `npx shadcn add <block> --yes` per component instead of `init` for everything after `components.json` — `add` skips the install subprocess entirely once a component's dependencies are already resolvable, and a separate explicit `npx shadcn add utils --yes` produced `src/lib/utils.ts`. `components.json` itself was already correctly written by the first (aborted) `init` invocation before the abort point, so no re-authoring was needed there. This plan's own Task 2 (reconcile the token layer) already had to hand-write `theme.css`'s CSS-variable block regardless of whether `init` had written its own version first, so no additional scope was added by this workaround.
- **Files modified:** none beyond what Task 1/2 already produced.
- **Verification:** `pnpm --filter web build` and `pnpm --filter web typecheck` both exit 0; all eight named blocks plus their registry-declared dependencies exist under `src/components/ui/`.
- **Committed in:** `836e05f5` (Task 1 commit)

**2. [Rule 3 - Blocking] `apps/web/package.json` left out of sync with `pnpm-lock.yaml` by the aborted init run**
- **Found during:** Task 1, immediately after the deviation above
- **Issue:** Before aborting, the first `init` attempt had already resolved `radix-ui`, `shadcn`, `tw-animate-css`, and `@fontsource-variable/geist` into `pnpm-lock.yaml` and linked them into `apps/web/node_modules` — but the abort happened before the write to `apps/web/package.json`, leaving the manifest and lockfile inconsistent.
- **Fix:** Manually added all four packages to `apps/web/package.json`'s `dependencies` at the exact versions the lockfile had already resolved (confirmed via `pnpm-lock.yaml`'s `apps/web:` importer block), restoring manifest/lockfile consistency without triggering a fresh install.
- **Files modified:** `apps/web/package.json`
- **Verification:** `pnpm --filter web build`/`typecheck` both exit 0 with the packages present; a direct `grep` confirmed no other package.json in the repo gained these entries.
- **Committed in:** `836e05f5` (Task 1 commit)

**3. [Rule 3 - Blocking] `vitest.config.ts` needed its own `"@/*"` alias**
- **Found during:** Task 2, running `pnpm --filter web test` for the new `StateViews.test.tsx`
- **Issue:** `apps/web/vitest.config.ts` is a separate config from `vite.config.ts` and does not inherit its `resolve.alias`. Every generated `src/components/ui/*` file imports `@/lib/utils`; under Vitest specifically (not under `vite build`, which uses `vite.config.ts` directly) that import failed to resolve, surfacing only once a component test actually imported one of these files.
- **Fix:** Added the identical `"@": fileURLToPath(new URL("./src", import.meta.url))` alias to `vitest.config.ts`.
- **Files modified:** `apps/web/vitest.config.ts`
- **Verification:** `pnpm --filter web test` (and the root `pnpm test`) both pass with `StateViews.test.tsx`/`MetricValue.test.tsx` importing components that transitively import `@/components/ui/button`.
- **Committed in:** `3bd5e093` (Task 2 commit)

**4. [Rule 2 - Missing Critical] `select.tsx`'s keyboard-highlighted row used a solid accent fill, not the UI-SPEC's 10% tint**
- **Found during:** Task 2, reconciling the token layer against the generated `select.tsx`
- **Issue:** shadcn's generated `SelectItem` used `focus:bg-accent focus:text-accent-foreground`. Aliasing `--color-accent`'s Tailwind utility straight onto the D-06 contract's full-strength indigo-600 (needed for the primary CTA button) would have made every keyboard-highlighted Select option render as a solid indigo block — directly contradicting the UI-SPEC's explicit "the search dropdown's keyboard-highlighted row background (at 10% opacity tint, not solid fill)" rule.
- **Fix:** Changed `select.tsx`'s `SelectItem` class to `focus:bg-accent/10`, applying Tailwind's own opacity modifier to the SAME `--color-accent` token rather than introducing a second, separately baked "light accent" CSS variable. Documented as a generalization of the UI-SPEC's literal "search dropdown" wording to the structurally identical "keyboard-highlighted row in a listbox" case, since no accent value exists that could differ between the two.
- **Files modified:** `apps/web/src/components/ui/select.tsx`
- **Verification:** `grep -rnE "#[0-9A-Fa-f]{3,8}\b" apps/web/src/components/` returns no matches; `pnpm --filter web build` exits 0.
- **Committed in:** `3bd5e093` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (3 Rule 3 — blocking issues preventing task completion; 1 Rule 2 — missing critical UI-SPEC compliance)
**Impact on plan:** All four were necessary for the plan's own stated tasks to actually complete and for the acceptance criteria (no colour literal, build/typecheck/test all exit 0) to hold. No scope creep — no additional component, page, or feature was added beyond what Tasks 1-3 specify.

## Issues Encountered

- **`pnpm install`/`pnpm add` reproducibly exit 1 in this worktree** due to `better-sqlite3`'s `node-gyp rebuild` postinstall (no Visual Studio Build Tools) — the exact, expected, non-blocking condition the worktree bootstrap instructions describe. Judged dependency health functionally throughout (confirmed packages actually linked into `node_modules` and resolvable at build/typecheck/test time) rather than by any single command's exit code, and never edited `pnpm-workspace.yaml` or any tracked config to chase a clean exit.
- **No local `node_modules/.bin` exists under `apps/web`** as a result of the above — every tool invocation in this plan (`tsc`, `vite`, `vitest`) was run via a direct `node <path-to-package>/bin/...` invocation rather than the usual `pnpm --filter web <script>` wrapper, since that wrapper itself re-triggers the same failing workspace-wide install as a pre-flight check. Functionally identical to what the `pnpm` scripts would run; confirmed by inspecting each script's `package.json` definition before substituting the direct invocation.
- **Pre-existing gap, out of scope, not fixed:** no `font-family` is applied anywhere in `apps/web` (not in `theme.css`, not on `body`, not in `__root.tsx`) despite `@fontsource-variable/inter` being imported in `main.tsx` since plan 05-01 — the `@font-face` rules register but nothing selects the font, so the page currently renders in the browser's default sans-serif. This predates this plan (05-01's scope, not this plan's `files_modified`, and not named in this plan's must_haves/prohibitions), so per the scope-boundary rule it is logged here rather than fixed. A future plan applying `font-family: "Inter Variable", sans-serif` at the `body` level (already declared in `theme.css`) would close this in one line.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Every later Phase 5 plan (05-04 Teams table, 05-05 ribbon/search, 05-06/05-07/05-08) can now compose directly from `src/components/ui/*`, `MetricValue`, `SkeletonRows`, `EmptyState`/`ErrorState`, `useIsMobile`, and the typography/tap-target CSS classes without re-deriving any token or primitive work.
- `pnpm-lock.yaml` carries a real, substantial diff from this plan (four new `apps/web` dependencies resolved). Flagged prominently per the parallel-execution briefing: two sibling executors (05-02, 05-04) are running concurrently this wave — this is the one file in this plan's changes with realistic merge-conflict exposure at wave-merge time, since any of them touching `pnpm-lock.yaml` for an unrelated reason would collide here. No other file in this plan's `files_modified` overlaps a sibling's declared ownership.
- The font-family gap noted above (Issues Encountered) is a one-line fix a future plan touching `theme.css`'s `body` rule can pick up; not blocking for any Phase 5 plan since Inter not being applied doesn't break any layout or test.

---
*Phase: 05-site-shell-navigation-browsing*
*Completed: 2026-08-24*

## Self-Check: PASSED

All key-files (created) confirmed present on disk; all four task commit hashes
(`836e05f5`, `3bd5e093`, `a7ffad89`, `9bdbc4ce`) confirmed present in `git log --oneline --all`.
