# Quick Task 260911-pon — Context Addendum

**Gathered:** 2026-09-11 (at resume, after the plan was committed at `78a64490`)
**Status:** Locked. Supersedes the PLAN where they disagree.

The plan at `260911-pon-PLAN.md` was written and committed BEFORE these three decisions
existed. Where the plan assumes an open question that is settled below, the decision wins.

<decisions>

## D-1 — `EPA_DIFFERENCE_IDS` keeps `component-maps`

Developer, verbatim: *"keep component-maps"*.

`apps/web/src/components/methodology/epaComparisonContent.ts` exports
`EPA_DIFFERENCE_IDS = ["win-probability-scale", "component-maps", "no-per-year-tweaks"]`.
The `component-maps` id stays in that array.

**Effect on this task: none, and that is the point.** The plan's must_have already reads
*"`EPA_DIFFERENCE_IDS` is unchanged"*. This decision confirms that constraint rather than
relaxing it. Do not add, remove, or reorder ids. Do not edit
`epaComparisonContent.ts` at all in this task.

**What it does NOT mean.** It does not mean mechanism 1 is closed, withdrawn, or reclassified.
Mechanism 1 stays `GAP` in all nine seasons and part B still builds its foundation and the 2024
tracer. `component-maps` remains a *published, user-visible* difference on the methodology page;
mechanism 1 remains an *internal, measured* gap in the matrix. Those are two different registers
and this decision touches only the first.

## D-2 — 2016/2017 ranking-point terms: do whatever Statbotics does

Developer, verbatim: *"for 2016/2017 RP do whatever statbotics does"*.

**This unblocks stage 7.** The gap document's stage 7 (seasons 2016 and 2017, ~4,964 elim-exposed
matches) was recorded as blocked pending this decision. It is no longer blocked. Re-label it in
the stage sequence and strike the blocker note.

**What Statbotics actually does** — `models_epa_breakdown.py:94-115`, on disk in the scratchpad,
verbatim:

```python
if year == 2016:
    score = breakdown[keys.index("no_foul_points")]
    if elim:
        score += rp_1_pred * 20
        score += rp_2_pred * 25
elif year == 2017:
    score = breakdown[keys.index("no_foul_points")]
    if elim:
        score += rp_1_pred * 100
        score += rp_2_pred * 20
```

and `models_epa_main.py:104-110` shows where those two numbers come from — they are not a
separate model, they are **two ordinary slots of the same 18-entry rated vector**, read straight
off `post_process_breakdown`'s output:

```python
rp_1 = pred_mean[keys.index("rp_1")]
rp_2 = pred_mean[keys.index("rp_2")]
```

So the requirement is: `rp_1` and `rp_2` are rated components like any other, and in
**elimination matches only**, in **2016 and 2017 only**, the score formula adds them back at
their playoff bonus-point values. In quals those years, and in every other season, the terms are
multiplied by nothing and contribute zero to the score.

**Relationship to the standing decision "I do not want EPA predicting RP at all ever" (L-02).**
These do not conflict, and the distinction is worth stating so a later session does not "fix" one
into the other:

- **L-02 governs OUTPUT.** EPA must not publish a bonus-RP probability, must not feed the rank
  simulation an RP pmf, and must not appear anywhere on the site as an RP predictor. That stands,
  unchanged, in all seasons including 2016 and 2017.
- **D-2 governs an INTERNAL TERM of the 2016/2017 score formula.** In those two seasons the
  achievements in question (2016 Defenses Breached / Tower Captured, 2017 Rotor and kPa bonuses)
  were worth *actual points on the scoreboard* in playoffs. Reproducing the score means carrying
  the term. It is a score component that happens to share a name with an RP, not an RP prediction.

If a future reader believes D-2 licenses publishing an RP number, they have misread it. It does
not. `rp_1`/`rp_2` stay internal to `predictCore`'s score arithmetic and reach no artifact, no
API surface, and no page.

**Scope for THIS task: documentation only.** D-2 removes a blocker from the stage sequence and
changes how mechanism 1's deferral grouping is written. It does **not** authorize implementing
2016 or 2017 here. The tracer season remains 2024 and only 2024, as the plan specifies.

## D-3 — the two obsolete `260911-l2k` stashes are dropped

Developer, verbatim: *"clean obsolete stashes"*.

Done in the orchestrator before dispatch — this is recorded for provenance, not as work.

The `l2k` WIP was superseded by a clean reimplementation that shipped as `epa@10.0.0+baseline`.
Verified before dropping: `packages/core/algorithms/epaWeekOne.ts` carries the foul/no-foul
accumulator at HEAD, `epaWeekOne.test.ts` exists, and `epa.ts:1645` reads `10.0.0+baseline`.

Dropped, recoverable from these SHAs until git gc reaps them:

| was | SHA | description |
|---|---|---|
| `stash@{0}` | `7a59ded3f9172fe00a267b754ea4dfae472a7e94` | l2k WIP part 2: test fixtures carrying the new foul state fields |
| `stash@{1}` | `ba4225a281863f0b5367635aec182ace8972b51a` | l2k WIP: week-1 foul/no-foul accumulator, incomplete |

**One stash deliberately survives** and must not be dropped:
`909d1f5219940c5a468367f6d338b2955c51056c`, now `stash@{0}`, `WIP on main: f103efa1
feat(quick-260905-lic)`. It is older and unrelated — apps/web work splitting the compare route
into `methodology.compare`. It was never assessed as obsolete. Leave it alone.

</decisions>

<claudes_discretion>

Everything the plan already left to the executor stays with the executor. In particular the
plan's <preflight> finding stands: the `clean_breakdown_{year}` functions ARE already transcribed
in reference section 17, so no task spends budget re-transcribing them.

</claudes_discretion>
