---
id: phase-group-toggle-redundant-for-2024
created: 2026-09-10
source: quick task 260910-5ym (epa@7.0.0 republish) — cosmetic consequence, handed to a separate agent by the developer
resolves_phase:
priority: low
reverified: 2026-09-13
---

# 2024's phase-group toggle expands to a single identical column

> **RESOLVED 2026-09-18.** A group with one member gets no toggle (`groupCanExpand` in
> `BreakdownTab.tsx`), and a season where no group can expand gets no band row at all, which is EPA
> 2024. Found while fixing it: 2025 is a MIXED season, its endgame group has one member, so there the
> band row stays and that group shows a plain label. Nothing published changed. The toggle tests moved
> to the 2026 fixture, where every group has at least two members.


> **RE-VERIFIED 2026-09-13 against HEAD `886fbe19`. Still real, EPA only.** Moved into `pending/`
> from the `todos/` root, where it was misfiled. The Breakdown tab now has three table shapes:
> OPR has no phase groups, and SPR shows the three phases with no toggles (260913-mgn `a013ca1e`),
> so neither can hit this. EPA still renders one toggle per group (`BreakdownTab.tsx:541-546`) with
> no single-member check, and 2024's groups still hold one component each (`groups.ts:143-147`).
> The suggested fix below still applies, scoped to EPA.

Cosmetic only. No data is wrong, nothing 404s, and no rating or prediction is affected.

## What happens

Quick task 260910-5ym collapsed 2024's component map to phase granularity, so
`componentMapForSeason(2024).components` is now `auto, teleop, endgame, adjust, foulsCommitted`
and `groups.ts`'s 2024 grouping holds exactly one component per group
(`auto: ["auto"]`, and so on).

Every other registered season has 2-5 components per group, so expanding a phase group on the
event Breakdown tab swaps the group column for several finer columns. For 2024 it swaps
`phaseAuto` for a single `auto` column carrying the identical number. Verified against the live
2024 artifact (generation `97342984`, `frc254`): `phaseAuto` 16 and `auto` 16, `phaseTeleop`
29.35 and `teleop` 29.35, `phaseEndgame` 6.57 and `endgame` 6.57.

The published payload carries both, which is correct and consistent — `phase*` metrics are
computed for every season by the same publish-time pass, and special-casing 2024 out of them
would make the artifact shape season-dependent for no gain.

## Suggested fix (UI only, not pipeline)

Suppress the expand affordance when a group has a single member, rather than changing what is
published. `componentsInGroup(season, group)` already exposes the member count on the client, so
the check is local to the Breakdown tab's column logic. Relevant files:

- `apps/web/src/components/event/BreakdownTab.tsx` — the toggle and column set
- `apps/web/src/components/event/BreakdownTab.test.tsx` — its 2024 fixtures were updated by
  260910-5ym and already assert the single-column expansion, so they will need to move with the
  behaviour

## What NOT to do

Do not "fix" this by reverting 2024's grouping or by dropping the `phase*` metrics for 2024.
The grouping was a measured accuracy change (+1.72 pp on 2024 winner accuracy; see
`packages/core/algorithms/breakdown/2024.ts`'s own comment for the four-partition sweep), and
the `phase*` metrics are what the Teams list and the collapsed Breakdown view render.
