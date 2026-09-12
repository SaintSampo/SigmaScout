---
id: worker-state-shape-unexercised-since-seed
created: 2026-09-12
source: session audit 2026-09-12 — carried verbally across several sessions without ever being filed
resolves_phase: 9
priority: high
---

# Nothing has proven the deployed Worker can read the state rows now in D1

This has been named as an open item repeatedly and was never written down. Filing it so it stops
depending on someone remembering.

## The risk

`STATE_SNAPSHOT_SHAPE_VERSION` is **15** at HEAD (`packages/harness/stateSnapshot.ts:389`). The
Worker does **not** hardcode a version — `apps/worker/src/scheduled.ts:130` imports the shared
`deserializeState`, so the deployed bundle carries whatever version it was **built** with. That is
the whole exposure: a version mismatch is not a code bug, it is a **deploy-ordering** bug.

`deserializeState` throws `LeagueRowShapeVersionError` on mismatch and there is no fallback. If the
rows in D1 are shape 15 and the running bundle was built at 14, **every live tick fails** — during
an event, which is the only time it matters.

The rule the codebase already states for this is `SEED FIRST, DEPLOY SECOND`
(`packages/core/algorithms/epa.ts:1601`). Note that comment still says the shape "is 14", which is
stale — the constant has since moved to 15. The rule is right; the number in the comment is not.

## Why it is unproven right now

The 2026-09-12 publish wrote fresh seed SQL. No live event has run since. So the shape-15 path has
never executed against a real tick, and a green publish says nothing about it — the publish writes
the rows, it does not read them back through the Worker.

**And the cron ticking is not evidence either.** The live-windows manifest currently reads
`"windows":[]` (verified against the live origin 2026-09-12, generation `b23d214d`, same
`computedAt` as the publish). With no window open the tick returns **before it ever reads a league
row**, so it exercises none of this. Every minute of green cron history since the seed is green for
a reason that has nothing to do with the question. That is precisely why this cannot close on
observation alone and needs either a deliberate probe or a real event.

## The second, separate question

The Worker's CPU budget is **10 ms sustained**, and the RP work added in Phase 9 has never been
measured on a live tick. Per the stack notes, termination follows from hitting the limit
*consistently*, not from one expensive tick — and production has already shown the same bundle
returning `ok` at `cpuTime:38` and then being killed pinned at `10` sixty seconds later. So a
single healthy over-budget tick is not evidence the budget is safe, and neither is a single
cheap one.

## What would actually settle it

Either is fine; the first is cheaper.

1. **A deliberate test tick** against the live D1 before the next event — confirm `deserializeState`
   succeeds on a real row and record the observed `cpuTime` across several consecutive ticks, not
   one.
2. **Watch the first live event closely**, with the understanding that a failure there is visible to
   users rather than to us.

Blocked on neither a decision nor a measurement — just on someone doing it before an event starts.

Related: [[live-match-updates-swing-and-lossy-merge]], [[00-sigmascout-layer-roadmap]].

## CLOSED — 2026-09-12

Settled by deliberate probe (option 1 above), not by waiting for an event. Both questions this item
raised now have answers; they are different answers, which is why only one of them closes here.

### The shape question: answered, clean

Four independent facts, in increasing order of strength:

1. Live D1's three league rows (`opr`, `epa`, `bpr`) are all at `snapshotShapeVersion` **15**,
   generation `b23d214d`, `computedAt 2026-09-12T01:06:14Z` — the same generation the published
   live-windows manifest carries, so seed and publish came from one run.
2. The Worker deploy at `2026-09-12T01:54:28Z` came **after** that seed and after the shape-15 commit
   `dc30636e` (2026-09-11T23:40Z). Seed-first-deploy-second held.
3. `packages/harness/stateSnapshot.ts` and `apps/worker/src` were untouched in git between that
   deploy and HEAD, and a build of HEAD carries `STATE_SNAPSHOT_SHAPE_VERSION = 15`. The Worker was
   then **redeployed from a clean HEAD** as version `267a226b`, so "the running bundle is shape 15" is
   now true by construction rather than by inference from a timestamp.
4. **The real `deserializeState` actually ran, in the deployed Workers runtime, against live rows.**
   Probe `318caa2f` (same commit as the Worker) reported `ok: true` for all three algorithms,
   `snapshotShapeVersionObserved: 15`, `warnings: []`, across 60+ invocations.

Point 4 is the one this item was asking for. The note above that the `SEED FIRST, DEPLOY SECOND`
comment in `packages/core/algorithms/epa.ts:1601` still says "shape 14" remains accurate and
uncorrected — the rule is right, the number in the comment is not.

Also corrected for the record: this item said the 2026-09-12 publish "wrote fresh seed SQL" and
implied the seed might not have been applied. It was applied — live D1 carries it.

### The CPU question: answered, and the answer is a problem

Measured, same probe, 60 invocations at 15 per load level: a realistic mid-event tick (2 newly-folded
matches, 60 still upcoming) costs **p50 13 ms, p90 28 ms** in **Phase A alone**, against a 10 ms
sustained budget — before Phase B, TBA polling, the manifest read, the global rebuild, or a second
concurrent event. The upcoming-match repricing loop is the dominant term.

That does not belong in this item's scope and is filed as its own:
[[rp-fold-exceeds-worker-cpu-budget]]. **Closing this item is not a statement that live folding is
safe.** It is a statement that the shape mismatch this item was about cannot happen, and that the
instrument to ask both questions before every event now exists and has been used once.

### What exists now

- `apps/worker/src/stateProbe.ts` + `apps/worker/wrangler.probe.toml` — a separate, write-binding-free
  Worker, deployed and left deployed as `sigmascout-state-probe`.
- `apps/worker/test/stateProbe.test.ts` — 26 tests holding the no-write property.
- `docs/worker-operations.md`'s "Pre-event probe" section, carrying the procedure, the rule that it is
  run before every event, and this run's numbers.

Built and measured under quick task `260912-3e6`.
