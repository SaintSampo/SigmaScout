---
id: 260912-5hs
slug: raise-presim-schedule-count-to-1000
kind: quick
status: complete
completed: 2026-09-12
subsystem: packages/harness
key-files:
  modified:
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
decisions:
  - "pageArtifacts.test.ts:1665 and preSchedule.test.ts:360 were CHECKED and left unchanged — both are local fixtures, not pins on the shipped constant."
  - "The SIMULATION_DRAWS-matching rationale on PRESIM_DRAWS_PER_SCHEDULE was abandoned deliberately and the comment rewritten to say so, rather than renumbered."
owed:
  - "A republish. This changes what a publish would write; nothing on R2 changes until one runs."
---

# Quick task 260912-5hs: `PRESIM_SCHEDULE_COUNT` 20 → 1,000

The pre-schedule rank band was published at a count where its position was mostly sampling noise.
At 20, two runs of the *identical* construction disagreed on 73% of teams and moved the worst team
**10.61 ranks**. At 1,000 the worst team moves **1.17** and the pooled mean is **0.275** — below what
a reader can perceive, since ranks are integers.

Jacob's decision, recorded in `preschedule-schedule-count-and-acceptance-bar`. 4,000 was priced and
declined: 1.17 → 0.71 is invisible on an integer scale and costs ~68 more minutes per republish.

## What changed

**`publish.ts` — the constant, and the comment that justified its neighbour.** `PRESIM_SCHEDULE_COUNT`
is 1,000. `PRESIM_DRAWS_PER_SCHEDULE` stays at **50**, and its comment was *rewritten rather than
renumbered*, because its stated reason stopped being true: it used to justify 1,000 baked draws by
matching the client engine's `SIMULATION_DRAWS`. The baked total is now 50,000 and that match is
**deliberately abandoned** — the two were never the same quantity. The baked path estimates a
distribution over *all* schedules a team might get; the live path simulates the *one* that exists.
The replacement comment gives the real reason 50 survives: pricing dominates drawing about 4:1
(drawing is 23.5% of per-schedule cost at 75 teams, 20.9% at 18), so cutting draws to fund schedules
buys ~1.11× on the binding floor and costs draw-side resolution.

**`publish.test.ts` — the two assertions that track the shipped constant.** `scheduleCount` → 1000
and `baked.draws` → 50000, plus the comment the previous task left naming this task as the one that
moves them together.

## What was checked and deliberately not changed

`pageArtifacts.test.ts:1665` and `preSchedule.test.ts:360` both mention 20 and 1000 and both were
read rather than assumed. Neither pins the shipped constant: the first builds its own fixture with a
literal `scheduleCount: 20` to test schema round-tripping, and the second asserts `draws` on
`buildFieldAveragedPreScheduleArtifact`, the rung-1 builder, which `PRESIM_SCHEDULE_COUNT` does not
feed. Changing either would have coupled an unrelated test to a value it does not track.

## Why this was only affordable now

`260912-2ur` stopped publishing the priced `schedules` block. With it, a sidecar at 1,000 would be
~18 MB — roughly **11.5 GB** across the 641 sidecars a publish writes, against a **10 GB** R2 free
tier. Aggregate-only the same object is ~24 KB, so raising the count 50× still ships **smaller than
the shipped 20 did**.

## Verification

- Full suite, repo root: **263 files, 5,462 passed, 4 skipped, 50.17s.** No time regression — the
  50× concern was real enough to measure and came to nothing, because the publish test's fixture is
  a 6-team roster priced by a fake algorithm (`publish.test.ts` alone: 193 tests, 1.48s of test time).
- Root `tsc --noEmit`: clean. `apps/web` `tsc --noEmit`: clean.

## Owed, not done here

**A republish.** Every presim object on R2 still carries the old count and the pre-`2ur` shape. The
published schema tolerates both, so there is no deploy/republish ordering constraint — but until a
publish runs, visitors still see the n=20 band and the caption still reads "across 20 randomly
generated schedules".
