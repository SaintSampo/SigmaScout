---
id: drop-licensed-schedule-templates
created: 2026-09-12
source: rung-2 experiment (rung2-generated-schedules.md, random-vs-generated-schedules.md)
resolves_phase: 9
priority: high
---

# A generated schedule structure matches the licensed grid — the template dependency can go

Measured by two independent sessions, different routes, agreeing floors (73.7% vs 74.2% at
`2025cur` / n=1000).

Compared at the **same** schedule count (n=4000), a rules-based generated structure agrees with the
licensed cheesy-arena grid on **97.1%** of teams within half a median rank (clause 1 needs 95%),
**every** team within 1.0 rank, **100.0% / 99.6%** at the band edges, mean signed shift -0.0018.
All three clauses pass. That 97.1% sits **1.2pp** under the 98.4% same-construction ceiling, so the
residual is not distinguishable from resampling noise.

The arms are genuinely different, so this is not vacuous: at `2025cur` the licensed grid has 0.0%
repeat partners against the generator's 0.1%, 0.1% vs 3.3% repeat opponents, and the generator has
a *shorter* worst idle gap (19.3 vs 24.0). Credited appearances and surrogate counts match exactly.

## What this closes

**D-19 (schedule-template redistribution licensing) evaporates.** It was conditional on the ladder
reaching rung 2 with licensed templates. It no longer is. No licence file has been read or reasoned
about by any agent, and none now needs to be.

> **CORRECTION 2026-09-12 — the paragraph immediately above is WRONG. D-19 is LIVE.**
>
> `09-CONTEXT.md:156-158` makes D-19 conditional in the opposite direction from what that paragraph
> assumes: *"It only needs answering if rung 1 fails and rung 2 is chosen. If rung 1 holds, the
> question evaporates because nothing template-derived is published."* **Rung 1 failed**
> (`260912-0v3`, 41.4% against a 98.4% binding floor), so rung 2 is the path, and
> `09-CONTEXT.md:402` states the consequence directly: *"D-19 is LIVE. Advancing the ladder to rung
> 2 makes the schedule-template redistribution licensing question live for the first time."*
>
> **Why "delete the templates" does not moot it.** The generator's rules were derived by reading the
> licensed grid structurally — its own Rule 1 describes the appearance-count convention as *"the
> licensed grid's own convention, read off it structurally rather than re-invented."* Whether
> something derived that way may be published is exactly the judgement D-19 names, and deleting the
> source files afterwards does not answer it. That judgement is **the developer's and was never
> delegated to an agent**; no agent on this phase has read or reasoned about the licence, and none
> should.
>
> This correction also supersedes the "One wording caution" note below, which claimed
> `09-CONTEXT.md`'s line was narrowly scoped to the rung-1 re-run. It is not — line 402 is scoped to
> rung 2 being chosen, which is what happened. Caught by Phase 9 verification (`3b0d248c`).

## The work

Wire the generator into `buildPreScheduleArtifact` in place of `loadScheduleTemplate`, retire
`packages/harness/scheduleTemplates.ts` and `data/schedule-templates/` (1,331 files), and drop the
`ScheduleTemplateUnavailableError` / `ScheduleTemplateMissingError` skip branches.

**Do not do this before `preschedule-schedule-count-and-acceptance-bar` is settled.** The generator
is only proven at n=4000; at the shipped n=20 nothing is distinguishable from anything, so wiring it
in at the current count would ship an unproven change under a passing-looking test.

`buildPreScheduleArtifact` already gained an optional `scheduleStructure` field, inert at default,
during the experiment — that is the seam.

## STATUS 2026-09-12: the generator is now the only path, not one of two

Quick task `260912-0v3` re-ran rung 1 — the field-averaged predictor, which needs no schedule
structure at all and would have made this todo moot — at a count where the bar resolves. It
**failed on evidence**: 41.4% against a binding floor of 98.4%, worst team 3.33 ranks against a
floor of 0.71, with the gap scaling with roster size rather than shrinking with resolution. So the
cheaper escape from the licensed templates does not exist, and this work is required rather than
optional.

**~~One wording caution.~~ RETRACTED 2026-09-12 — see the correction block above.** This paragraph
claimed the rung-2 result moots D-19 and that `09-CONTEXT.md`'s line was scoped only to the rung-1
re-run. Both halves are false. `09-CONTEXT.md:402` is scoped to rung 2 being chosen, which is
exactly what happened, and it says D-19 is live. **This work is blocked on that judgement**, not
merely on the schedule count.

## MUST FIX BEFORE WIRING — the corroboration sentence cites a figure that does not exist

Moved here 2026-09-12 when `reconcile-the-two-rung2-documents` was closed. It is that todo's only
real residue, and it belongs to this work because it over-credits the generator **in exactly the
change that moves visitor-facing rank bands.**

**The claim.** Lines 11-12 of this file open with "Measured by two independent sessions, different
routes, agreeing floors (73.7% vs 74.2% at `2025cur` / n=1000)." The same claim is rendered into
`docs/models/rung2-generated-schedules.md:31` as "Its n=1000 value independently reproduces that
session's separately-built **74.2%** at `2025cur`."

**Verified at HEAD: `74.2` appears nowhere in `docs/models/random-vs-generated-schedules.md`** — the
document that sentence names as the source of the 74.2% figure. The 73.7% half checks out (it is in
`rung2-generated-schedules.md:40`, the `2025cur` row, resampling column at n=1000). The 74.2% half
does not resolve against the document it cites.

**It is hardcoded, not computed.** The sentence is a string literal in
`scripts/measureGeneratedSchedules.ts:1170-1173`, inside the `L.push(...)` block that `--render-doc`
emits. So it is **not** a stale transcription that a re-run would correct — every re-render
faithfully reproduces it, and it will keep agreeing with itself forever. The one number in these
documents that is asserted rather than measured is the number claiming two independent measurements
agree.

**Why it is load-bearing here.** Independent corroboration is the strongest evidence either rung-2
document has, and this todo's whole case for retiring 1,331 licensed template files opens by
invoking it. If the agreement is narrower or differently-shaped than the sentence says, the case is
weaker than it reads.

**What to do, before the generator is wired in:**

1. Re-derive `random-vs-generated-schedules.md`'s own binding floor at `2025cur` / n=1000 from
   `scripts/measureRandomSchedules.ts`, and find out what the figure actually is.
2. Correct the string literal at `measureGeneratedSchedules.ts:1170-1173` to the real figure, or —
   better — stop hardcoding it and have the script read the comparand, so it cannot go stale again.
3. Re-render `rung2-generated-schedules.md` with `--render-doc`, and correct lines 11-12 of this
   file by hand to match.

**Do not simply delete the sentence.** If the two harnesses do corroborate each other, that is the
evidence worth keeping; it just has to be stated in a number that exists.

> **This is a source-file change (`scripts/`) and was deliberately NOT made when this note was
> filed** — the 2026-09-12 sweep was scoped to documentation and planning records only. It is
> recorded, not fixed.

## The "neither document should be acted on" gate is VOID (2026-09-12)

`reconcile-the-two-rung2-documents` carried a line saying neither rung-2 document should be acted on
until they were merged into one. **That gate is deleted.** The merge it was waiting on has been
refused outright — both documents are machine-rendered by `--render-doc`/`--write-doc` and advertise
that as their anti-drift guarantee, so a hand-merged third document would drift by construction —
which means the gate could never have lifted on its own terms.

**This does not unblock the work.** D-19 does that, and D-19 is live, unanswered, and Jacob's — see
the correction block at the top of this file. What is removed is one *spurious* blocker sitting in
front of a real one, which is worth removing precisely because it made the real one harder to see.
