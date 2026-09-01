# Deferred Items — Phase 08 (out-of-scope discoveries)

Logged per the executor's scope-boundary rule: only auto-fixed if directly caused by the current
task's own changes. Pre-existing issues in files this plan does not own are recorded here, not fixed.

## 08-15 Task 1 — pre-existing `tsc` failure in `RankDistributionTable.tsx` (08-14)

**Found:** running this plan's own required `npx tsc --noEmit -p tsconfig.json` pass.

**Confirmed pre-existing, not caused by 08-15:** `git stash`-ed every file this plan created/modified
and re-ran `tsc` against the unmodified `HEAD` (`b9b00e68`, 08-14's own completion commit) — the same
two errors reproduce identically on the unmodified tree.

```
src/components/event/RankDistributionTable.tsx(176,87): error TS2322: Type '{ year: number; tab: "overview"; }' is not assignable to type '{ year: unknown; algorithm: "opr" | "epa" | "vpr"; tab: "overview" | "history"; } | ...'.
  Property 'algorithm' is missing in type '{ year: number; tab: "overview"; }' but required in type '{ year: unknown; algorithm: "opr" | "epa" | "vpr"; tab: "overview" | "history"; }'.
src/components/event/RankDistributionTable.tsx(190,13): error TS2322: (identical shape, the Nickname column's Link)
```

**Cause:** both Team #/Nickname `Link`s in `RankDistributionTable.tsx` (08-14, Task 3) omit the
`algorithm` field from their `search={{ year: season, tab: "overview" }}` object, but
`TeamSearchSchema.algorithm` is required. Every sibling team-page link elsewhere in the app
(`InsightsTab.tsx`'s own `search={{ year: season, algorithm, tab: "overview" }}`) supplies it.

**Runtime impact:** none observed — `TeamSearchSchema.algorithm` carries a `.catch()` fallback, so a
reader clicking either link still lands on a valid team page (defaulting the algorithm) rather than
hitting a thrown validation error. This is a type-level gap, not a rendering or navigation defect.

**Why not fixed here:** `RankDistributionTable.tsx` is not in 08-15's declared `files_modified`, and
this plan's own acceptance criteria (Task 1) requires `git status --porcelain apps/web/src` to show
either zero modified production components or exactly one file carrying a single added `data-testid`
(PD-05) — a two-line `search` object fix fits neither shape. A first-draft fix was written, verified
to resolve the typecheck error, and then reverted specifically to honor that acceptance criterion
rather than silently widening this plan's declared scope.

**Recommended follow-up:** a one-line fix in 08-14's own file — add `algorithm: "vpr"` (the tab is
VPR-only by construction, D-04) to both `search={{ ... }}` objects in `RankDistributionTable.tsx`
(`buildRankTableColumns`'s `teamNumber` and `nickname` column cells).

## 08-15 Task 3 — `AccuracyTable.tsx`'s scroll wrapper is redundant; the testid'd region never itself overflows

**Found:** running this plan's own required C1 evidence (`compare-narrow-legibility.spec.ts`) — the
premise guard (`assertOverflows`) failed against `AccuracyTable.tsx`'s own `compare-accuracy-scroll`
testid'd div, measured live at 390px: `scrollWidth === clientWidth === 342`, never overflowing.

**Root cause, confirmed live.** `AccuracyTable.tsx` (08-01/08-06) wraps shadcn's `<Table>` primitive
(`apps/web/src/components/ui/table.tsx`) inside its OWN `overflow-x-auto` div
(`data-testid="compare-accuracy-scroll"`). `ui/table.tsx`'s `<Table>` ALREADY renders its own
`[data-slot="table-container"]` div carrying `overflow-x-auto` around the `<table>` element — so this
is a double (nested) horizontal-scroll wrapper. The INNER shadcn-provided div is the real scroll
boundary (measured: `scrollWidth: 929` against the same `342` `clientWidth`, and a real CDP touch
drag over the visible table DOES advance the inner div's own `scrollLeft` to `287`). The OUTER,
testid'd div never overflows BY CONSTRUCTION — its only child (the inner div) is capped at 100% width
by its own `overflow-x-auto`, so the outer div's box never needs to grow past its own width, and its
`scrollWidth` always equals its `clientWidth` regardless of how wide the table's real content is.

**Every other table-scroll region in this app is NOT affected** — Insights, Breakdown, Quals,
Alliances, Elims and the rank-distribution table (08-14) all build their own scroll-region div
directly around a raw `<table>` element rather than through the shadcn `<Table>` wrapper, so their own
testid'd `*-table-scroll` divs ARE the literal scrolling element. `AccuracyTable.tsx` is the one table
in the app that does not follow that pattern.

**User-facing impact: none observed.** A real touch/drag gesture naturally lands on whichever element
in the DOM actually has overflow at that point, so the table still visibly pans under a real finger —
confirmed live via a direct CDP touch-drag against the inner element. The defect is purely that the
app's own `compare-accuracy-scroll` testid does not identify the literal scrolling element, which is
surprising for anyone (a future spec author, this plan's own C1 evidence) who reasonably expects a
table-scroll testid to BE the scroller, matching every sibling table in the app.

**Why not fixed here:** `AccuracyTable.tsx` is not in 08-15's declared `files_modified` (it is
08-01/08-06's file), and this plan's own third prohibition forbids weakening or working around a
sibling plan's surface to make this plan's own evidence pass. C1's evidence was produced instead by
correctly targeting the REAL scrolling element (`[data-slot="table-container"]`, scoped inside
`compare-accuracy-scroll`) — not a weaker assertion, the same overflow/no-pan/no-intermediate-scroller
claims, against the DOM node that actually implements them.

**Recommended follow-up:** in `AccuracyTable.tsx`, either (a) remove the component's own redundant
`overflow-x-auto`/`touch-pan-xy`/`overscroll-x-contain` wrapper div and move `data-testid="compare-accuracy-scroll"`
directly onto shadcn's `<Table>`-rendered container (would need a `className`/prop threaded through, or
a raw `<div><table>...</table></div>` matching every sibling table's own convention instead of the
shadcn `Table`/`TableHeader`/`TableBody` primitives), or (b) move the testid onto the actual
`[data-slot="table-container"]` node directly. Either removes the double-wrapper and makes the testid
match the real scroller, as every sibling table in the app already does.
