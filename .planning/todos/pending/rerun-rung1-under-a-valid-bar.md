---
id: rerun-rung1-under-a-valid-bar
created: 2026-09-12
source: rung-2 Phase A — rung 1 was failed by a bar nothing could pass at that count
resolves_phase: 9
priority: medium
---

# Rung 1's no-ship verdict is unreliable — it was judged against an unreachable bar

Plan 09-09 measured the field-averaged pre-schedule predictor, scored it at **32.8%** of teams
within 0.5 median ranks against a 95% bar, and the developer decided **no-ship** on 2026-09-11.

The rung-2 experiment then measured the **binding** noise floor at the shipped count: **27.0%**,
with a worst team moving **10.61 ranks between two runs of the identical construction**. Rung 1 was
failed for a worst team of **7.59 ranks** — smaller than the noise it was measured against.

**This is not a claim that rung 1 passes.** It may still lose, and it was worse than the seed-noise
floor on all six events on the looser draw-only control. But its verdict currently carries no
information, while the recorded decision reads as though it does.

## The work

Re-run rung 1 against the **binding** floor at a count where clause 1 is usable (~4,000 — see
`preschedule-schedule-count-and-acceptance-bar`), then either confirm no-ship on evidence or reopen
it.

The predictor, its schema, its builders and `docs/models/field-averaged-presim.md` are all committed
and unwired — 09-09 deliberately kept them as the baseline rung 2 is scored against, so nothing
needs rebuilding.

**If rung 1 passes at a valid count it beats rung 2 on cost**: no schedule generation at all, a
roster plus per-team pmf artifact at ~1-5 KB. Worth knowing before wiring the generator in.

Update the `### Checkpoint resolution — 09-09 rung 1: NO-SHIP` block in `09-CONTEXT.md` with
whatever the re-run shows, rather than leaving a decision standing on a void measurement.
