---
id: 260925-ots
slug: ledger-housekeeping-error-boundary-distr
kind: quick
mode: subagent
created: 2026-09-25
description: "Ledger housekeeping: error boundary, district param validation, event key check, e2e typecheck, flaky timeout, champ only DistrictLocksTab, bake verify script"
files_modified:
  - apps/web/src/components/ErrorBoundary.tsx
  - apps/web/src/components/ErrorBoundary.test.tsx
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/districtLedgerRows.test.ts
  - apps/web/src/components/districts/DistrictLedger.tsx
  - apps/web/src/components/districts/DistrictLedger.test.tsx
  - apps/web/src/components/districts/DistrictLocksTab.tsx
  - apps/web/src/components/districts/DistrictLocksTab.test.tsx
  - apps/web/src/components/districts/districtLocksHeaderStats.ts
  - apps/web/src/components/districts/districtLocksHeaderStats.test.ts
  - apps/web/src/components/team/MetricHistoryTab.test.tsx
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/routes/districts.tsx
  - apps/web/src/routes/districts.test.tsx
  - apps/web/tsconfig.e2e.json
  - apps/worker/src/districtRefresh.ts
  - packages/core/districts/keys.ts
  - packages/core/districts/keys.test.ts
  - apps/web/src/lib/eventKey.ts
  - apps/web/src/lib/searchParams.test.ts
  - apps/web/e2e/support/touchDrag.ts
  - apps/web/e2e/districts-ledger.spec.ts
  - docs/publish-budget.md
  - package.json
autonomous: true
---

# Quick task 260925-ots: seven ledger housekeeping items, one commit each

The phase 10 review (`10-REVIEW.md`) deferred three findings, plans 10-07 and 10-08 named two
follow ups, and two more items came out of running the suite. All seven are small, independent
and were batched into one quick task so the ledger's loose ends close together.

## The seven items

1. **WR-09 error boundary.** `convolveDistrictGrandTotal`, `maxEventPoints` and
   `pointCellSummary` all document themselves as throwing, and all three run inside a render path
   `useMemo` in `DistrictLedger`. A throw there unmounts the subtree and the whole Locks page goes
   blank. Add a class error boundary rendering the site's `ErrorState` with a retry, wrap the
   ledger tab in it, and degrade the row builder per team so one bad team costs its own grand
   total rather than the table.

2. **WR-10 `?district=` validation.** `DistrictsSearchSchema.district` is an unchecked
   `z.string()` that reaches `districtDetailKey` and then a fetch URL. Validate it at the schema
   boundary with the same regex the Worker uses, `.catch(undefined)` on a malformed value.

3. **WR-03 event key check.** `districtRefresh.ts` validates an EVENT key with
   `DISTRICT_KEY_PATTERN`. The two shapes coincide today, so narrowing the district pattern would
   silently switch the awards poll off with no test failure. Declare both patterns once in
   `packages/core/districts/keys.ts` and import them in the Worker and the web schema.

4. **e2e typecheck.** `apps/web/e2e/**` is in neither tsconfig's `include`. Add
   `apps/web/tsconfig.e2e.json` and a root `typecheck:e2e` script chained into `typecheck`.

5. **MetricHistoryTab flake.** The `skeleton legend spacer` test times out at the web project's
   5 s default under full suite load. Find the cost and either remove it or give that one test a
   stated longer timeout.

6. **Narrow `DistrictLocksTab` to the champ tier.** After phase 10 the `which="district"` arm has
   no production call site. Remove it and the district only header stats, keeping the champ
   output byte for byte and every test id the live e2e spec reads.

7. **Bake verification script.** Every published district event is in the past, so
   `pnpm publish:districts` bakes nothing until 2027 events are scheduled. Add a root
   `verify:district-bake` script that exercises the bake path with `--as-of`, and name it in
   `docs/publish-budget.md`.

## Constraints

One atomic commit per item, in this order. Tests from the repo root. No network, no publish, no
deploy. `package.json` gains two script entries and nothing else.
