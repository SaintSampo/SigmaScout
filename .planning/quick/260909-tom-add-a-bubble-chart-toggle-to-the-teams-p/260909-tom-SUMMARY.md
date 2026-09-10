---
quick_id: 260909-tom
date: 2026-09-09
status: complete
commits: [4d0b845a, 8334d2db, d4109e49]
files_modified:
  - apps/web/src/components/teams-table/teamsBubbleModel.ts
  - apps/web/src/components/teams-table/teamsBubbleModel.test.ts
  - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
  - apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
  - apps/web/src/styles/theme.css
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/routes/teams.tsx
  - apps/web/src/routes/teams.test.tsx
requirements-completed: [QT-260909-tom]
---

# Quick Task 260909-tom — Summary

Added a `?chart=bubble` toggle to `/teams` that swaps the table for a hand-rolled SVG scatter of the
currently filtered teams — X = the Total metric, Y = Swing Score — plotted as at most four `<path>`
nodes regardless of team count, with uniform-radius dots colour-coded by the Total metric's rarity
tier (a computed neutral for the untiered case).

## Task 1 — `teamsBubbleModel.ts`, the pure projection

Created `teamsBubbleModel.ts`: `buildBubbleModel` (one point per row carrying BOTH a Total value and
a Swing Score, in input order, omission counters for the two miss cases), `niceAxis` (1/2/5×10^k tick
selection, never a degenerate `[v, v]` domain), `plotRectFor`, `projectX`/`projectY`, and
`tonePathData` (one arc-pair-circle subpath per point, concatenated per tone into a single `d`
string). No React/TanStack/DOM import. The module never references the algorithm's own confidence
field (`spread`) — verified by `grep -n spread teamsBubbleModel.ts` returning nothing.

**Verification:** `npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts` —
**10/10 tests passed.**

**Commit:** `4d0b845a`

## Task 2 — the four mark tokens and `TeamsBubbleChart.tsx`

**Palette, computed via the dataviz skill's `validate_palette.js`, per the plan's deterministic
rule:**

1. Candidate set A (identity hues sky `#0EA5E9` / purple `#9333EA` / amber `#F59E0B`) FAILED the 3:1
   non-text contrast floor as solid dots on white: sky 2.77:1, amber 2.15:1.
2. Per the rule, a failing set-A member means set B — the existing `--tier-*-fg` trio
   (`#0369A1`/`#7E22CE`/`#B45309`) — is used for all three. Set B: normal-vision ΔE 20.3, all three
   ≥3:1 (rare 5.93:1, epic 6.98:1, legendary 5.02:1), CVD separation 7.8 deutan / 13.0 tritan (inside
   the 6–8 WARN band, legal with secondary encoding — the key row's text labels supply it).
3. The neutral started at Tailwind slate-500 `#64748B` (failed: ΔE 9.7 against rare, below the 15
   floor) and moved along the slate ramp toward slate-400 `#94A3B8` (passed ΔE at 20.3 but dropped
   contrast to 2.56:1) — the landing point, interpolated between the two, is `#7D8DA3`: ΔE 16.1
   against rare, 3.38:1 contrast. Its own chroma (0.038) is below the validator's general categorical
   floor — expected, not a defect, for a deliberately desaturated neutral.

Final set — `--tier-neutral-mark: #7D8DA3`, `--tier-rare-mark: #0369A1`, `--tier-epic-mark: #7E22CE`,
`--tier-legendary-mark: #B45309` — recorded with these exact numbers in `theme.css`'s token comment.
`.bubble-tone`/`.bubble-tone--{tone}` classes set both `fill` (for the SVG `<path>` marks) and
`background-color` (for the HTML key-row `<span>` swatches) from one rule.

`TeamsBubbleChart.tsx`: a named, statically-imported component (no charting library, so nothing to
keep out of the eager bundle). No Recharts — rationale recorded in the header comment (thousands of
per-point components vs. at most four `<path>` nodes at the real ~3,700-team field size). No tooltip,
no per-point hover — clutter avoidance is D-01's own stated rationale, and the table is one click
away. Renders the key row (`Common / unranked` / `Rare` / `Epic` / `Legendary`, in draw order), the
svg (gridlines, tick labels, tone paths, axis titles — `role="img"` with an aria-label naming the
plotted count and both axes), and the omission notes.

**Verification:** `npx vitest run apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx` —
**11/11 tests passed.** `grep -nE "#[0-9A-Fa-f]{3,6}" TeamsBubbleChart.tsx` — no matches (no colour
literal in the component).

**Commit:** `8334d2db`

## Task 3 — `?chart=bubble`, the toggle, and the route swap

`searchParams.ts`: added `chart: z.literal("bubble").optional().catch(undefined)` to
`TeamsSearchSchema` — structurally incapable of holding anything but `"bubble"` or absent, and
untouched by `applyYearChange` (which only rewrites the literal key `sort`).

`routes/teams.tsx`: an always-visible `Bubble chart` toggle button (`aria-pressed` carries state, the
visible label stays stable so a screen reader is not told the state twice; a visible pressed style —
accent border + inset background — backs it up) swaps the table body for
`<TeamsBubbleChart rows={rows} />`, fed the SAME `rows` memo the table consumes — no second filtering
path. The `cols` toggle hides in chart mode (`canToggleView && !isChart`) since it would be a
no-op control there. The swap is gated on `status === "success"`, so `TeamsTable` still owns the
loading skeleton, the error/retry state, and the filtered-to-zero empty state in every other status —
chart mode inherits all three behaviours rather than re-implementing them.

`routes/teams.test.tsx` (new, following `districts.test.tsx`'s pattern): arrival with no `chart`
param renders the table; `?chart=bubble` renders the chart with no click; an unrecognised `?chart=`
value resolves to the table; clicking the toggle round-trips the URL and the view (`aria-pressed`
false→true→false, stable accessible name throughout); a `country=USA` filter combined with the
fixture's four teams (two USA+swing, one USA legendary with no swing, one Canada) plots exactly the
2 USA rows that carry both a Total and a Swing Score, proving the chart consumes the table's own
filtered array (D-03); `applyYearChange` preserves `chart: "bubble"` across a year change (pure-
function assertion, no rendering).

**Verification:**
- `npx vitest run apps/web/src/routes/teams.test.tsx` — **6/6 tests passed.**
- `npx tsc --noEmit -p apps/web/tsconfig.json` — clean for every file this task touched (see
  "Deviations" below for one unrelated pre-existing error in this same run).
- `npx tsc --noEmit` (root) — clean, no output.
- `npx vitest run` (full suite, repo root) — **234 test files passed, 4266 tests passed, 4 skipped,
  0 failed.** No previously-passing test broken.

**Commit:** `d4109e49`

## Deviations from Plan

None in the code delivered by this task — plan executed as written, including the three-step
deterministic palette rule and the D-01/D-02/D-03/D-04 decisions.

**One pre-existing, out-of-scope typecheck error observed (not fixed, not caused by this task):**
`npx tsc --noEmit -p apps/web/tsconfig.json` reports two `TS7053` errors in
`apps/web/src/routes/methodology.compare.test.tsx` (lines 709 and 734), about a `CoverageExclusionKey`
missing a `coldStart` property. This file was never read or touched by this task, and the error traces
to `packages/core/scoring/coldStart.ts`/`coldStart.test.ts` and `packages/harness/corpusColdStart.ts`
— untracked files already present in the working tree when this task started, evidently mid-flight
work from a separate, concurrent quick task (`260909-t5q-unify-cold-start-handling-predict-a-tie-`,
also present in `.planning/quick/` uncommitted). Per the scope-boundary rule this is out of scope:
not fixed, not touched. It did not affect `npx vitest run`, which is fully green (type-only errors do
not block Vitest's esbuild-based test execution).

**Concurrent-checkout hazard encountered and corrected:** this checkout had a large amount of
another session's work already staged in git's index (not yet committed) when this task began. The
first Task 1 commit was made with a bare `git commit -m ...` (no pathspec), which — because the
Bash tool's `git status --short` had already shown a mix of staged and unstaged foreign changes —
swept in 22 unrelated files from that other session's index alongside my own 2. Caught immediately
by inspecting `git show --stat HEAD`; corrected with `git reset --soft HEAD~1` (restores the index
to its pre-commit state, undoes only the commit) followed by `git commit -m ... -- <my two files>`
(pathspec-scoped commit, which commits only the named paths' staged content and leaves everything
else staged untouched). Verified via `git status --short` immediately after that the other session's
staged files were still staged and unmodified. Every commit after that point in this task used an
explicit trailing `-- <path> <path> ...` pathspec. No other session's work was lost or altered.

## What was deliberately left open

The developer-visual-check step in the plan's `<verification>` block (starting the dev server with
`VITE_ARTIFACT_ORIGIN=local`, opening `/teams?year=2026&algorithm=bpr` unfiltered at the real
~3,700-team field size, and eyeballing render speed / tier legibility / the omitted-teams note) was
not run — this executor has no network access and no ability to drive a browser. All automated
verification in the plan's `<verification>` block (six commands) ran and passed as recorded above.
