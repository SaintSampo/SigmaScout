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
