---
id: 260912-iur
slug: add-an-rp-ablation-flag-to-the-state-pro
created: 2026-09-12
completed: 2026-09-12
kind: quick
status: complete
commits:
  - e57bd2fd
---

# Add an RP-ablation flag to the state probe — Summary

`apps/worker/src/stateProbe.ts` now takes `?rp=0`, which ablates exactly the operations plan 09-08
added to the live tick's Phase A. Phase 9's share of the `rp-fold-exceeds-worker-cpu-budget`
overrun is now a subtraction between two probe runs rather than an inference.

## Task 1 — what Phase 9 actually added, from git

**Phase 9's first commit is 2026-09-11.** Everything below is dated against that boundary.

### These operations are Phase 9's

All four are `+` lines in **`dc30636e`** — *feat(09-08): TRACER — ranking points on live rows,
resumed from D1 (D-21, F5)*, 2026-09-11. `git log -S analyticRpPmf -- apps/worker/src/scheduled.ts`
and `git log -S RpMomentsAccumulator -- apps/worker/src/scheduled.ts` each return `dc30636e` and
nothing else; `git log -S foldObservedRp` returns `dc30636e` plus only the probe's own commits.

1. **The `RpMomentsAccumulator` resume** — `RP_RULE_MODULES[season]` lookup, `readRpBeliefs(rows)`,
   `RpMomentsAccumulator.fromBeliefs(...)`, and the `rpKnownTeams` set.
2. **`rpFieldsFor`** — the `analyticRpPmf` call, its four gates (rule module, event eligibility,
   band presence, partial roster), and 09-07's five decomposition fields — invoked in **both** the
   played loop and the upcoming loop.
3. **`foldObservedRp`** — the per-side `rpRuleModule.parse` + `rp.fold`, with its
   degrade-to-a-counted-skip `try/catch`.
4. **`withRpBeliefs`** on the serialize-and-discard path.

### These predate Phase 9

- **The upcoming-repricing loop itself** — `dabe9acd`, *feat(04-06): Task 3 - the cron tick
  (scheduled.ts)*, **2026-08-22**. `git show dabe9acd` adds `stillUpcoming`, `upcomingPredictions`,
  and `for (const match of stillUpcomingViews) { ... algorithm.predict(...) }` as new lines. This
  confirms the plan's framing: Phase 9 added `analyticRpPmf` *into* an already-costly loop; it did
  not create the loop.
- **Every `bandFor` call, in both loops** — `63596da3`, *feat(worker): live matches carry the Match
  Band (state shape 9 -> 10)*, **2026-09-09**, which introduced `swing.bandVarianceFor` into both
  loops; then `447395a1`, *feat(worker): live ticks compute Sigma Score bands for BPR*,
  **2026-09-10**, which renamed those calls to the Sigma-dispatching `bandFor` closure. Both land
  **before** Phase 9's first commit.
- `bpr.predict` / `bpr.update`, the Swing and Sigma folds, the post-fold talent read,
  `serializeState`, and the Swing/Sigma passengers — all context lines in `dc30636e`'s diff.

### Where the evidence contradicted the framing

The plan asked which of four things are Phase 9's: **`bandFor`, `rpFieldsFor`, `foldObservedRp`,
the `RpMomentsAccumulator` resume.** Three are. **`bandFor` is not** — it predates Phase 9 by two
days and one day respectively. Grouping it with the RP work because it sits beside `rpFieldsFor`
and feeds its band-presence gate would have been the plausible reading; it is the wrong one.

A second finding, not anticipated by the plan and pointing the other way:

> **`dc30636e` also made Phase A cheaper.** It hoisted the band calls, replacing
> `...(bandFor(result.redTeams) !== undefined ? { red: bandFor(result.redTeams) } : {})` with a
> single `redBandVariance` local per alliance — **halving band evaluations from four per match to
> two**, in both loops.

So Phase 9's net effect on Phase A is **not purely additive**: it added the four RP operations and
simultaneously removed half the band work. Any arithmetic that treats "Phase 9's cost" as a sum of
added operations is wrong in an unknown direction. This is the strongest argument yet for measuring
the arm difference instead of reasoning about it — which is the point of this change.

**Consequence for the ablation design:** `bandFor` must run in **both** arms. Ablating it would
credit Phase 9 with pre-existing work and overstate its share of the overrun. This is now pinned by
a test (`bandsProduced` equal across arms), not by a comment.

## Task 2 — the flag

`?rp=` is parsed in `parseParams` alongside `folded`/`upcoming`. Off values: `0`, `off`, `false`,
`no` (case-insensitive). On values: `1`, `on`, `true`, `yes`, and absent/empty.

**An unrecognized value runs ENABLED and emits a warning naming it** — so `rp=fasle` cannot silently
measure the on-arm while the operator believes they ablated. The arm is also echoed as `params.rp`
in the response body, so a `cpuTime` read off `wrangler tail` can never be attributed to the wrong
run.

**The gating is one place, not four.** Setting `rpRuleModule` and `rpBeliefs` to `undefined` when
ablated makes operations 2-4 fall out on their own: `rpFieldsFor`, `foldObservedRp` and the
`withRpBeliefs` call are *already* guarded on `rp === undefined`, the same guard an unregistered
season (2021) trips. The off arm therefore also skips the `readRpBeliefs` JSON walk and the
`fromBeliefs` reconstruction, not merely the pmf call.

**Warnings.** The off arm emits one warning naming the ablation and listing the four skipped
operations. The pre-existing `rpPmfsProduced is 0` warning is now gated on `rpEnabled`, because in
the ablated arm a 0 is the requested outcome and that warning's three named causes (partial-roster
gate, ineligible event type, no rule module) would all be things that did not happen.

### The counter, both arms

Group 3 of `stateProbe.test.ts` is **left completely untouched**. It was written before the flag,
passes no `rp` param, and still asserts `rpPmfsProduced === 7` and `warnings === []` verbatim. That
it still passes *is* the default-ON regression proof that keeps the 13 ms p50 / 28 ms p90 numbers
comparable.

A new **Group 5** pins the arms:

| Assertion | On arm | Off arm |
| --- | --- | --- |
| `rpPmfsProduced` | `=== folded + upcoming` (7) | `=== 0` |
| `rpObservedFolds` | `> 0` | `=== 0` |
| `bandsProduced` | `=== 14` | `===` on arm |
| `matchesFolded` / `upcomingPriced` | 2 / 5 | `===` on arm |
| `params.rp` | `true` | `false` |
| `warnings` | `[]` | 1, naming the arm |
| D1 writes | 0 | 0 |

Both arms are pinned as **equalities**. `>= 0` would pass vacuously in both and destroy the
one-increment-per-match guarantee that makes the counter meaningful. A non-vacuity assertion
(`on !== off`) catches the bug where both arms produce 0.

Also pinned: absent `rp=` and `rp=1` produce **byte-identical response text**, not merely
deep-equal bodies.

### Non-vacuity, observed failing by hand

Both new assertions were confirmed to bite before being recorded as passing:

1. **Flag ignored** (gating reverted so `rpEnabled` has no effect) — 2 tests fail, including both
   arm equalities.
2. **Wrongly ablating `bandFor` too**, i.e. the design Task 1's evidence rules out —
   `AssertionError: expected +0 to be 14`. The Task 1 finding is genuinely load-bearing in the
   test suite, not decoration.

Source was restored and re-verified after each mutation.

## Task 3 — the probe's guarantees

All hold; none were weakened.

- **Import graph:** zero import lines changed (the diff's `^[+-]import` set is empty).
  `scheduled.ts` appears in `stateProbe.ts` only inside comments. **The stop-and-report condition
  did not trigger** — the flag needed nothing from `scheduled.ts`.
- **Banned identifiers:** unchanged; the new code uses none of `writeScopedState`,
  `writeEventCursor`, `.put(`, `.batch(`, `Date.now(`, `performance.now(`. Group 1's
  comment-stripped scan passes.
- **`wrangler.probe.toml`:** **not touched at all** — the flag is a query parameter and needed no
  binding, trigger, or config change.
- **`probeSelectionsFor`:** untouched; Group 2's deep-equality against the real `selectionsFor`
  passes.
- **Zero D1 writes** asserted in the ablated arm too, not only the default one.

## Verification

| Check | Result |
| --- | --- |
| Full suite, **repo root** (`npx vitest run`) | **266 files, 5645 passed, 4 skipped** |
| `stateProbe.test.ts` alone | 31 passed (26 pre-existing + 5 new) |
| Root `tsc --noEmit` | clean (exit 0) |
| `tsc -p apps/web/tsconfig.json` | clean (exit 0) |
| `tsc -p apps/worker/tsconfig.json` | 1 error — **pre-existing, see below** |

No command was wrapped as `timeout <n> pnpm <cmd>`.

## Deferred / out of scope

**`apps/worker`'s typecheck carries one pre-existing error**, triaged rather than batch-dismissed
(per the 2026-09-06 lesson that a "cosmetic" worker type error was a real bug):

    packages/corpus/db.ts(28,35): error TS2345: Argument of type 'URL' is not assignable to
    parameter of type 'string | URL'. ... Property '[Symbol.dispose]' is missing in type
    'IterableIterator<[key, value]>' but required in type 'URLSearchParamsIterator<...>'

Verified **byte-identical at HEAD** with this task's two files reverted, then restored. It is a
Node-`URL` vs DOM-`URL` collision arising because `packages/corpus/db.ts` lands inside
`apps/worker`'s Cloudflare-typed program — the same cross-boundary situation `dc30636e`'s own commit
message documents when explaining why `publish.ts` cannot be imported into the Worker. Neither
`stateProbe.ts` nor its test touches or imports that file. Fixing it is a separate task.

## How to run the two arms

Network work, deliberately **not** done here — the probe was not deployed, not run, and live D1 was
not touched. From the main context, with the probe deployed at the **same commit** as the bundle
under test:

    ON  (as deployed):      ?season=2026&teamCount=21&folded=2&upcoming=60&rp=1
    OFF (Phase 9 ablated):  ?season=2026&teamCount=21&folded=2&upcoming=60&rp=0

Those reproduce the realistic mid-quals tick the 13 ms / 28 ms figures came from (`teamCount=21` is
04-RESEARCH.md Pattern 1's peak; `upcoming=60` is the probe's own default). Read `cpuTime` off
`wrangler tail`, not from the response — the probe cannot time itself.

Before believing either number, check the response body: `params.rp` states the arm, `warnings` must
be `[]` in the on arm, and `bandsProduced` must match between the two runs. If `bandsProduced`
differs, the two runs are not comparable and the difference is not Phase 9's share.

Phase 9's share of Phase A = **on − off**. Per Task 1 this is a *net* figure: the band-hoist saving
is already baked into it.

## Files

- `apps/worker/src/stateProbe.ts` — `rp` param, arm gating, response field, warnings
- `apps/worker/test/stateProbe.test.ts` — Group 5 (5 tests); Groups 1-4 untouched

## Self-Check: PASSED

- `apps/worker/src/stateProbe.ts` — FOUND
- `apps/worker/test/stateProbe.test.ts` — FOUND
- commit `e57bd2fd` — FOUND in `git log`
- no file deletions in the commit
