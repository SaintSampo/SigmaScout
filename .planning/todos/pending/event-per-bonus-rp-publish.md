---
id: event-per-bonus-rp-publish
created: 2026-09-05
source: user bug report 2026-09-05 — "RPs on all event qualification tabs are broken"; diagnosed in-session, deferred because a retune/republish was in flight and the fix ends in a republish
resolves_phase:
priority: high
---

# Publish per-bonus RP arrays on event match rows, then wire the Quals-tab dots

## The symptom

Every bonus-RP dot on every event page's Qualifications tab renders as the dashed
"unknown" placeholder — both the predicted group and the actual group, on every match.
A user reads this as "RPs are broken". The dots DO work on team pages.

## Root cause (verified 2026-09-05)

`EventMatchTable.tsx` renders `BonusRpDots` with no `states`/`probabilities` at all —
deliberately (its own doc comment): `EventMatchSchema`/`EventUpcomingMatchSchema` publish
only RP-TOTAL quantities (`redRpPmf`/`blueRpPmf` distributions, `actualRedRp`/
`actualBlueRp` integer totals). Neither schema carries the per-bonus arrays the dots
need. The TEAM artifact publishes both per-bonus quantities per match —
`TeamSeasonMatchSchema.redBonusRp`/`blueBonusRp` (predicted per-bonus marginals) and
`actualRedBonusRp`/`actualBlueBonusRp` (actual per-bonus booleans) — so this is
publisher plumbing, the same shape as Phase 8's rpPmf gap (D-03), not new computation.

A client-only fix is impossible without dishonesty: `actualRedRp` gives the COUNT of
bonuses earned (total minus win/tie RP) but not WHICH — attributing named dots from it
would put a false claim behind the identical glyph a real one uses.

## Status (2026-09-05, quick 260905-jj8, commit aa40215f)

Steps 1, 2 and 4 below are DONE (schema + publisher + client, plus the Worker's
predicted side). **Only step 3 — the republish — remains, and it waits for the user's
explicit signal.** Until it runs, live Quals tabs keep rendering `unknown` dots (the
designed degradation for artifacts predating the fields).

## The fix, in order

1. Add optional `redBonusRp`/`blueBonusRp` (predicted marginals, upcoming + played) and
   `actualRedBonusRp`/`actualBlueBonusRp` (played) to `EventMatchSchema` and
   `EventUpcomingMatchSchema` in `packages/harness/pageArtifacts.ts`, with the same
   positional-alignment and null-vs-absent contracts `TeamSeasonMatchSchema` documents.
2. Publisher: populate them in the event-artifact builder from the same source the team
   artifact already reads. Check the 350,000-byte event-artifact budget
   (`docs/publish-budget.md`) — order ~4 numbers + 3-4 booleans per side per qm row.
3. Republish (artifacts before manifest, per the retune-republish skill's ordering).
4. Client: `EventMatchTable.tsx` passes `states` (via `bonusStatesFromProbabilities` /
   the actual booleans, same mapping `components/team/MatchTable` uses) and
   `probabilities` to `BonusRpDots`; keep `applicable` gating (PD-18) exactly as is.
   Stale artifacts without the new keys keep rendering `unknown` — already the
   designed degradation.

## Why deferred on 2026-09-05

A retune/republish agent was mid-run in this checkout: steps 1–3 touch the harness and
end in a republish, which must not race it. Pick this up after that run completes.
