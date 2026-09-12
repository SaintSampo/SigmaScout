---
id: rerun-rung1-under-a-valid-bar
created: 2026-09-12
source: rung-2 Phase A — rung 1 was failed by a bar nothing could pass at that count
resolves_phase: 9
priority: medium
completed: 2026-09-12
outcome: no-ship confirmed on evidence
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

---

## Outcome — 2026-09-12: re-run at n=4,000, **NO-SHIP CONFIRMED**

Done as quick task `260912-0v3`. The verdict did not change; what changed is that it now carries
information.

`scripts/measureFieldAveragedRanks.ts` gained a `--schedules` flag (default 20, pinned
byte-identical by a regression table *and* by a real default-flag run that reproduced every figure
of the committed n=20 record exactly), and it now scores the candidate against the **binding**
resampling floor — `measureResamplingFloor` and `measureEdgeNoiseFloor` imported from
`measureGeneratedSchedules.ts`, never re-implemented — printed and written beside the candidate's
own rate at the same count. The draw-only `measureSeedNoiseFloor` survives as a labelled
non-binding diagnostic.

At **4,000 schedules × 50 draws**:

| | Candidate | Binding floor | Bar |
|---|---|---|---|
| Clause 1 — within 0.5 median ranks | **41.4%** | **98.4%** | ≥ 95% |
| Clause 1 — worst team | **3.33** (`frc9609` at `2025cur`) | **0.71** | ≤ 1.0 every team |
| Clause 2 — p10 / p90 | **62.3% / 63.5%** | **100.0% / 100.0%** | ≥ 90% both |
| Clause 3 — mean signed shift | **−0.034** | — | ±0.25 |

**The concern this todo raised was legitimate and is now resolved against rung 1.** Raising the
count moved the floor 27.0% → 98.4% while moving the candidate only 32.8% → 41.4%; the 5.8-point
gap that made the original verdict unreadable is now a **57-point** gap. The candidate's worst team
fell 7.59 → 3.33, confirming most of the old worst-team figure *was* noise — and 3.33 is still more
than three times the criterion's hard per-team bound.

It fails where it always failed and the failure scales with roster size, not with resolution:
`2025cur` 13.2% against a 97.4% floor and `2026joh` 21.3% against 97.3%, while `2023gaalb` (100.0%)
and `2026txmca` (94.4%) sit at their floors. Consistent with the A-FA1 residual **standard
deviation** already named as the suspect — the additive constant cancels, its spread does not.

**Rung 1 does not beat rung 2 on cost, because it does not reach the bar to trade against.** The
generator is the path. D-19 (schedule-template redistribution licensing) is untouched by this and
is still Jacob's call before rung 2 is planned.

Recorded in `09-CONTEXT.md` as a dated sub-block under the original checkpoint resolution, with the
2026-09-11 decision text left intact. The record is `docs/models/field-averaged-presim.md`, rewritten
by the script and self-labelling with its schedule count.

Nothing shipped: `PRESIM_SCHEDULE_COUNT` and `PRESIM_DRAWS_PER_SCHEDULE` untouched, predictor still
unwired, no publish, R2 write, D1 write, manifest bump or deploy.
