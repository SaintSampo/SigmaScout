---
id: republish-playoff-bonus-arrays
created: 2026-08-27
source: 06.1-08-PLAN.md PD-16
resolves_phase: 07
priority: low
---

# Republish to drop stale actual per-bonus arrays from playoff match rows

## What

The published 2022-2026 `team/{teamKey}/{year}` artifacts (~54,671 objects in R2)
still carry `actualRedBonusRp`/`actualBlueBonusRp` (and, where a caller's
`Prediction` happened to populate them, `redBonusRp`/`blueBonusRp`) on played
PLAYOFF match rows — a ranking point FRC awards in qualification play only
(G-06.1-26). Plan 06.1-08 fixed the pipeline gate
(`packages/harness/publish.ts`'s `actualBonusFlagsForSeason`, plus a defensive
gate in `buildTeamSeasonArtifact` itself) so every artifact produced from this
point forward omits those keys on a playoff row. It did NOT re-run a republish
to update the artifacts already sitting in R2.

## Why deferred (PD-16)

A full republish costs ~23 min wall clock and rewrites all 54,671 objects
(measured, plan 06.1-07). More importantly, the "one authorized republish per
phase" discipline exists because 06.1-07's run swept in two unrelated
committed-but-unpublished Phase-6 commits and blew a payload ceiling (see
WINDOWS.md ledger #11) — spending an unplanned republish now would repeat that
exact risk for a defect the client already can't render.

## Why this is safe to defer

`apps/web/src/components/team/BonusRpDots.tsx`'s `applicable` prop (a
REQUIRED prop, plan 06.1-08 PD-18) structurally forces every bonus dot to the
muted `unknown` state for a non-qualification `compLevel`, regardless of what
the artifact's own JSON carries. No surface reads the stale playoff bonus
arrays even though they are still present in the published bytes — this is
stale, unread data, not a live defect.

## Resolution

No dedicated run needed. Verify the shape after the next scheduled republish
(Phase 7 work, or the live cron once it is running): a fresh
`team/{teamKey}/{year}` artifact's playoff match rows should carry neither
`actualRedBonusRp`/`actualBlueBonusRp` nor `redBonusRp`/`blueBonusRp` as
properties (`not.toHaveProperty`, not merely `undefined`).

Small expected side benefit: dropping these arrays from every playoff row
shrinks every `team/{teamKey}/{year}` artifact slightly (fewer bytes per
playoff match). This is NOT offered as a fix for WINDOWS.md ledger #11 — that
ledger entry is about the `teams/{year}` artifact (the standings/roster page,
built from per-team metric summaries), which carries no per-bonus fields at
all and is unaffected by this change.

## Related

- G-06.1-26 / plan 06.1-08 (this fix)
- `.planning/WINDOWS.md` ledger #11 (`teams/{year}` payload ceiling — a
  separate, already-accepted override, unrelated to this todo)
- `06.1-07-SUMMARY.md` (the prior republish, whose scope-creep is why an
  unplanned republish is avoided here)
