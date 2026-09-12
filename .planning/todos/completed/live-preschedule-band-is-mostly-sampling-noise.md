---
id: live-preschedule-band-is-mostly-sampling-noise
created: 2026-09-12
source: live verification (2026-09-12) against the rung-2 Phase A binding floor
resolves_phase: 9
priority: high
---

# The pre-schedule rank band is live, and at the shipped count its position is mostly sampling noise

This is a **published** surface, which is the reason it is filed separately from
`preschedule-schedule-count-and-acceptance-bar`. That todo is about choosing a number. This one is
about what visitors are being shown right now, today, while the number is unchosen.

## What is live

Verified 2026-09-12 by CONTENT against `https://data.sigmascout.org` (response parsed as JSON, not
a status check). Pre-schedule sidecars are serving on **all three published algorithms** —
`opr@4.0.0+baseline`, `epa@10.0.0+baseline`, `bpr@3.0.0+baseline` — each 66-team `2026mrcmp` with
20 schedules and `baked.draws` 1000, all stamped `computedAt 2026-09-12T01:06:14.953Z`.

The Simulation tab renders a pre-schedule rank band from `baked.histograms` and captions it
(`StartMatchPicker.tsx:83`, rendered whenever the pre-schedule view is selected):

> "Before the schedule is released — how the field is likely to rank when nobody yet knows who
> plays whom. Computed ahead of time across 20 randomly generated schedules, 1000 draws in total."

## Why that is a problem

Rung-2 Phase A measured the **binding** noise floor at exactly this count — the same construction
built twice with independent shuffle-and-draw streams, which is what a re-publish is:

| | at the shipped n=20 |
|---|---|
| Teams whose median rank agrees within 0.5 ranks between two runs | **27.0%** pooled |
| Worst single team | **10.61 ranks** |
| Band edges (p10 / p90) agreeing within 1 rank | **54.5% / 52.9%** |
| `2025cur` (76 teams) / `2026joh` (75 teams) | **11.8% / 13.3%** |

The caption is **literally accurate** — it really is 20 schedules and 1000 draws. The problem is
that it reads as a statement of method rather than a statement of resolution, and a reader has no
way to know that re-running the identical computation would move a team's displayed rank by up to
ten places. The failure is worst on exactly the events people care most about: the large ones.

This is an **estimation-noise** problem, not a coverage problem. The band's *width* reflects real
outcome variability. What wobbles is the band's position and its edges, because 20 schedules is a
small sample of the schedule space the band claims to average over.

Against the project's own stated principle — honest uncertainty, and strict on anything published —
a confident-sounding provenance line under a mostly-noise estimate is the shape of thing the
failure log warns about.

## The options, none of them chosen

1. **Raise the count.** Settles it properly and is the reason
   `preschedule-schedule-count-and-acceptance-bar` exists. At n=1,000 the binding floor is 81.1%
   and the worst team moves 1.17 ranks; at n=4,000 it is 98.4% and 0.71. Cost is bounded: about
   23 min and 91 min respectively added to a publish, and the artifact gets *smaller* if
   `stop-baking-preschedule-schedules` lands with it.
2. **Caption the resolution honestly in the meantime.** Cheap, and it is the option most consistent
   with how the rest of the site already talks about uncertainty. It does mean publishing a line
   that says the estimate is coarse.
3. **Hide the pre-schedule view until the count is raised.** Most conservative. Costs a feature that
   just went live and that nothing else on the site provides.

Option 1 makes 2 and 3 unnecessary, so the only reason to reach for 2 or 3 is if the count decision
is going to sit for a while. **This is Jacob's call, not an agent's** — it trades a published
honesty concern against shipping speed, and the measurement needed to inform it is already done.

Related: [[preschedule-schedule-count-and-acceptance-bar]],
[[stop-baking-preschedule-schedules]], [[drop-licensed-schedule-templates]].

---

## CLOSED 2026-09-12 — option 1 was chosen; it discharges on the next publish

Closed by the 2026-09-12 backlog triage (`.planning/triage-2026-09-12.md` §3). **There is no
decision left in this file and no code left in it.**

**Option 1 — raise the count — is what Jacob chose,** on 2026-09-12, in
`preschedule-schedule-count-and-acceptance-bar` (now also closed): `PRESIM_SCHEDULE_COUNT` = 1,000,
`drawsPerSchedule` held at 50, the bar restated against the binding (resampling) floor measured at
n=4,000. At 1,000 the worst team moves about **1.2 ranks** between two runs of the identical
construction, against the **10.61 ranks** this file measured at n=20 — below what a reader can
perceive on an integer scale. Options 2 (caption the coarseness) and 3 (hide the view) are therefore
moot, exactly as this file said they would be if option 1 were taken.

**It is applied at HEAD** — `ea84a0da`, "feat(260912-5hs): PRESIM_SCHEDULE_COUNT 20 -> 1,000".

**What is left is one operational job, not a todo.** Every presim object on R2 still carries the old
shape — 20 schedules, `baked.draws: 1000`, no `scheduleCount` — so the caption this file objects to
is still true of the bytes a visitor gets today. **This discharges on the next
`pnpm publish:seasons`**, at which point the sidecars are rebuilt at 1,000 schedules and the
resolution concern goes away without any further code or copy change.

That republish is tracked as the project's single next action in `.planning/triage-2026-09-12.md`
§2, with its non-optional tail (manifest read-back by content, `verify:subset`, the D1 re-seed
before the deploy, `worker:deploy`, and a hand transcription of the budget summary into
`docs/publish-budget.md`). It must be run from a main context — executor subagents' sandbox denies
all network.

**One thing to check when it lands, since this file is the record of what was wrong:** re-fetch a
sidecar by CONTENT and confirm it carries `scheduleCount: 1000`. A 200 is not evidence — this file's
own figures came from parsing the JSON, and the previous generation returned 200 the whole time it
was serving a 20-schedule band.
