---
id: worker-tick-exceeds-cpu-budget
created: 2026-08-29
source: 07-19 Task 4 (re-verifying the Live folding tier record)
resolves_phase:
priority: high
---

# Deployed Worker cron ticks are consistently exceeding the free-tier CPU budget

## What

The deployed `sigmascout-worker` (version `638da16c-d538-4551-b3a0-a2757a77061f`, deployed
2026-08-29 by plan 07-19 Task 3) is currently failing **every** observed scheduled invocation with
`outcome: "exceededCpu"` — not an occasional cold-start spike, a 100% failure rate across every
tick captured.

## Measured

Two independent `wrangler tail --format json` capture windows, 2026-08-29, ~13:57-20:00 (several
hours after the deploy, i.e. the isolate had gone idle/cold between events):

| Window | Ticks captured | `outcome` | `cpuTime` | `logs` |
|---|---:|---|---:|---|
| 1 | 3 | `exceededCpu` (3/3) | `10` (pinned at the free-plan cap) | `[]` (empty, every tick) |
| 2 | 4 | `exceededCpu` (4/4) | `10` (pinned at the free-plan cap) | `[]` (empty, every tick) |

**7 of 7 ticks observed failed.** The empty `logs` array on every failure means the tick's own
`console.log(JSON.stringify({msg:"tick",ok:true,...}))` line (`apps/worker/src/scheduled.ts`'s
`scheduled()` handler) never executed — the isolate was killed by the CPU limit before reaching it,
which for an IDLE tick (no event live, `runTick`'s very first branch: one live-windows manifest
read, then an early return) should be an almost-trivial amount of work.

This directly contradicts the healthy-tick evidence recorded for the SAME deployed version
immediately after the redeploy (4 ticks `"ok":true, eventsConsidered:0`, then 3 more after the
manifest collapse — see `docs/worker-operations.md`'s "Live-fold deploy — 2026-08-29" record).
Nothing about R2 or D1's post-cleanup state should affect an idle tick's cost — the idle path never
touches D1 or any algorithm state at all.

## Why this matters

If this persists into a real live event, the cron cannot even complete its "is anything live"
check — every tick fails before reaching `processEvent`, meaning the site's core freshness promise
(predictions updating within 1-3 minutes of new results) would completely fail, silently, with no
alert (Cloudflare's cron dashboard records failed invocations, but nothing in this project currently
pages a human about it).

## Unconfirmed hypothesis, offered but not verified

`apps/worker/src/scheduled.ts` statically imports all of `packages/core/algorithms/sigma1`
(several thousand lines across `sigma1/`, `breakdown/`, and `rp/`, grown substantially across
Phase 3's tuning work and Phase 7's RP/variance changes) plus `packages/harness`'s page-artifact and
rounding helpers. The 2026-08-22 baseline (`docs/worker-operations.md`'s "Watching it" section)
already measured a 14 ms cold start against the (apparently non-strict, at the time) 10 ms budget,
flagging as an OPEN QUESTION "whether the platform actually enforces that budget, and against
what." This finding may simply be that question resolving itself the hard way: cold-start cost has
crept upward with the bundle's growth, and an isolate cold-starting after several idle hours (rather
than the continuous-traffic warm-reuse case most of this project's prior measurements captured) now
lands consistently over the limit. **Not verified** — no bundle-size measurement, no bisection
across commits, and no isolated cold-start-only reproduction was performed to confirm this.

## Acceptance

- Root-cause the CPU exceedance (bundle size / cold-start profiling, or another cause entirely).
- Either reduce the idle-path's cold-start cost (e.g., lazy-import algorithm modules only when
  something is actually live, deferring the expensive `packages/core/algorithms/sigma1` import past
  the "nothing live" early-return) or confirm and document the platform's actual enforced CPU budget
  if it differs from the assumed 10 ms.
- Re-verify with a fresh multi-hour-idle cold-start capture (not just immediately post-deploy, which
  this finding shows is not representative) before calling the tick healthy again.
- Update `docs/worker-operations.md`'s idle-tick baseline once a real fix lands, dated, beside (not
  over) the existing 2026-08-22/2026-08-29 records.

## Related

- `docs/worker-operations.md` § "Live-fold deploy — 2026-08-29" (records this finding) and § "Watching
  it" (the 2026-08-22 baseline this finding contradicts)
- `docs/publish-budget.md` § "Worker deploy and re-measured idle-tick CPU (D-21)" — the historical
  13 ms/14 ms first-invocation figures already flagged this as an open question
- Out of scope for plan 07-19, which is explicitly prohibited from any `apps/worker` source change

---

## RESOLVED 2026-08-29

Fixed, deployed as version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`, and verified on three
consecutive live ticks (`outcome:"ok"`, cpuTime 17/21/30 ms) captured while the data trigger was
still fully active — so the fix is distinguishable from the calendar self-heal that would have
arrived on 2026-09-01/09-02.

Root cause was an AND-gate: (A) the tick Zod-validated all 1,581 live-windows before asking whether
any was live, consuming 50–90% of the budget on a do-nothing tick; (B) a republish opened two
phantom `inferred` windows for zero-match offseason events, pushing every tick onto a 38 ms live
path. The premise in "Measured" below that the free plan enforces a flat 10 ms per-invocation
ceiling is also **wrong** — 10 ms is the configured limit, but each isolate absorbs *infrequent*
overruns and terminates only when the Worker runs over *consistently*.

Full investigation, evidence and blameless postmortem:
`.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`.
Enforcement model and the fix-deploy record: `docs/worker-operations.md`.
Ledger: `.planning/WINDOWS.md` #16 (status `fixed`).
