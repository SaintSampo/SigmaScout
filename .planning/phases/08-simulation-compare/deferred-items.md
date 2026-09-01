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
