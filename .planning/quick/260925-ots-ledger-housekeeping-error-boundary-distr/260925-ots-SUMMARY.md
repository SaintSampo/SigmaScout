---
id: 260925-ots
slug: ledger-housekeeping-error-boundary-distr
kind: quick
status: complete
completed: 2026-09-25
subsystem: apps/web, apps/worker, packages/core, docs
key-files:
  created:
    - apps/web/src/components/ErrorBoundary.tsx
    - apps/web/src/components/ErrorBoundary.test.tsx
    - apps/web/tsconfig.e2e.json
    - packages/core/districts/keys.ts
    - packages/core/districts/keys.test.ts
  modified:
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/DistrictLocksTab.tsx
    - apps/web/src/components/districts/DistrictLocksTab.test.tsx
    - apps/web/src/components/districts/districtLocksHeaderStats.ts
    - apps/web/src/components/districts/districtLocksHeaderStats.test.ts
    - apps/web/src/components/team/MetricHistoryTab.test.tsx
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/lib/eventKey.ts
    - apps/web/src/routes/districts.tsx
    - apps/web/src/routes/districts.test.tsx
    - apps/web/e2e/support/touchDrag.ts
    - apps/web/e2e/districts-ledger.spec.ts
    - apps/worker/src/districtRefresh.ts
    - docs/publish-budget.md
    - package.json
decisions:
  - "The ledger's error boundary wraps the implementation INSIDE `DistrictLedger`, not at the route call site, so every caller gets the containment rather than whichever one remembered to ask. It renders a keyed Fragment, never a wrapper element, so no rendered DOM changes on the ordinary path."
  - "The row builder degrades per team for refusals attributable to one team (a negative combined shift, an empty distribution) and deliberately does NOT for an unregistered season, which is the same fact for every row and reads better as one honest message than as a whole table of `not available`."
  - "Both TBA key shapes live in `packages/core/districts/keys.ts`, imported by the Worker and the browser. They are equal literals today and are kept as two separate declarations, which is the point of WR-03: narrowing one must be a decision about that one."
  - "`DistrictLocksTab` lost its `which` prop entirely rather than keeping a champ-only default. Test ids are hardcoded champ literals, so every id the live e2e spec reads is unchanged."
  - "The MetricHistoryTab flake was fixed by moving the Recharts import out of the test body, not by raising a timeout. The project-wide 5 s default is untouched."
---

# Quick task 260925-ots: seven ledger housekeeping items

Three deferred phase 10 review findings (WR-03, WR-09, WR-10), two follow ups named by plans
10-07 and 10-08, and two defects found by running the suite. One atomic commit each.

## What changed

**1. WR-09 error boundary (`8a60e397`).** `convolveDistrictGrandTotal`, `maxEventPoints` and
`pointCellSummary` each document themselves as refusing rather than fabricating, and all three
ran inside a render-path `useMemo`. An uncaught throw there unmounted the route subtree, so the
whole Locks page went blank. Two containments now: a reusable class `ErrorBoundary` rendering the
site's own `ErrorState` with a retry, wrapped around `DistrictLedger`'s implementation; and a
per-team catch in `buildDistrictLedgerRows`, so a team whose grand total cannot be built keeps its
rows and earned points, renders every predicted number as unavailable, and is named in
`gaps.teamsWithUnavailableGrandTotal`.

**2. WR-10 `?district=` validation (`1acb401c`).** The search param was an unchecked `z.string()`
reaching `districtDetailKey` and then a fetch URL as an unencoded path segment, while the Worker
refused the same value before it could become an R2 key. Now validated at the schema boundary
with the shared pattern and `.catch(undefined)`, so a malformed key renders "Pick a district" and
fires no fetch at all.

**3. WR-03 event key check (`addc1d7b`).** The awards poll gated on
`DISTRICT_KEY_PATTERN.test(eventKey)`. `EVENT_KEY_PATTERN` now sits beside it in the shared
module and the gate uses it. `apps/web/src/lib/eventKey.ts` re-exports the shared declaration
rather than keeping a third copy.

**4. e2e typecheck (`80346bc3`).** `apps/web/e2e/**` was in neither tsconfig. `tsconfig.e2e.json`
extends the web project with `types: ["node"]`; the root `typecheck` script chains
`typecheck:e2e`, so CI runs it. **Two errors surfaced** across the twenty specs, both the same
`noUncheckedIndexedAccess` read of `points[0]` in the shared CDP touch drag helper; fixed by using
`from` directly, which is the same coordinate. No spec was weakened.

**5. MetricHistoryTab flake (`a75d8ebf`).** Measured rather than guessed: the block's second test
opened with `await import("./MetricHistoryChart.js")`, and a probe split the cost at 434 ms import
against 137 ms render. Hoisting to a static top-level import moves that work into the file's
import phase, which `testTimeout` does not govern. That test dropped from ~450 ms to ~76 ms.

**6. Champ-only `DistrictLocksTab` (`787b121b`).** The `which="district"` arm and
`computeDistrictLocksHeaderStats` (schedule strip, points pool, per-tier accumulator) are deleted.
`computeChampLocksHeaderStats` computes its pre-DCMP ceiling directly — the same number by a
shorter route, since that ceiling depended on no team field. Champ output is byte for byte
unchanged, every e2e test id included. Six district-tier test cases deleted; every other case now
drives the champ arm with its assertions intact.

**7. Bake verification (`d95d4332`).** `pnpm verify:district-bake` names 10-06's `--as-of` run, and
`docs/publish-budget.md` explains why it exists: no district event is still ahead, so a republish
composing zero sidecars proves the bake path was never entered. Run here:

```
publishDistricts: season 2026 bake census — considered 150, baked 2; ineligible:
already-in-progress=8, not-a-remaining-event=131, divisioned-dcmp-parent=8;
skipped: no-ranking-point-filler=1
```

14 district objects, 2 sidecars, largest `2026fim/2026miken` at 31,828 bytes, 2,667,757 bytes
total, replay of 177,942 matches in 156 s, bake 589 ms — every figure matching 10-06's own run.

## Verification

Full suite from the repo root: **285 files, 6,361 passed, 1 skipped, 0 failed.** All four
typechecks clean: root, `apps/web/tsconfig.json`, `apps/worker/tsconfig.json` and the new
`apps/web/tsconfig.e2e.json`. `package.json` gained exactly two script entries and one chained
`typecheck`; no lockfile change. No network, no publish, no deploy; the bake verification is a
corpus-only dry run.
