---
quick_id: 260905-jj8
status: complete
date: 2026-09-05
commit: aa40215f
---

# Summary: per-bonus RP on event match rows + Quals-tab dot wiring

## What changed

- **Schema** (`packages/harness/pageArtifacts.ts`): `EventMatchSchema` carries
  `redBonusRp`/`blueBonusRp` (predicted per-bonus marginals) and
  `actualRedBonusRp`/`actualBlueBonusRp` (three-state actual flags);
  `EventUpcomingMatchSchema` carries the predicted pair — contracts and refines
  (non-empty, equal-length pairs) mirrored verbatim from `TeamSeasonMatchSchema`.
- **Publisher** (`packages/harness/publish.ts`): new `eventMatchBonusRpFields` helper
  (factored outside `buildEventArtifact`, preserving its T-07-08-02 single-return
  discipline) applies the team builder's exact gates: `isBonusRpCompLevel` + presence
  for the marginals (rounded per `ROUNDING_RULE.probability`), three-state flags for the
  actuals (`null` never coerced). The seasons path passes the per-season
  `actualBonusFlagsByMatchKey` map it already computes; the single-event mode derives
  its own from the same stream.
- **Worker** (`apps/worker/src/scheduled.ts`): live-merge event rows emit the predicted
  pair via `liveBonusRpFields`. The actual side is deliberately absent there — the
  Worker parses no score breakdowns; the offline republish fills played rows.
- **Client** (`apps/web`): `EventMatchRow` threads all four fields; `EventMatchTable`'s
  score lines map them through `bonusStatesFromProbabilities`/`bonusStatesFromFlags` —
  the identical calls `team/MatchTable.tsx` uses — keeping the `applicable` playoff
  gate. Artifacts predating the fields render `unknown` dots unchanged.

## Verification

- Harness: 153/153 (publish, tracer, payload budget, browser-safe schemas), including
  the flipped Test 8: qm event rows now carry all four keys, playoff rows never do,
  against a real qualification-side bonus set.
- Web: 434/434 across the event suite, with new cases: real dot states from published
  fields (0.5 threshold resolves earned), `null` actuals render unknown (never
  all-missed), populated playoff arrays still render unknown via the applicable gate,
  and the missing-fields fallback unchanged. Typecheck clean.
- Worker: 111/111. The worker typecheck carries 4 PRE-EXISTING errors in files this
  task did not touch (`bundleSmoke.ts`, a `MatchResult` literal at `scheduled.ts:353`,
  `test/scheduled.replay.test.ts` — all `redDqs`/`blueDqs`/`Sigma1ResolvedParams`
  drift from an earlier change); none are at lines this task added.

## Deliberately NOT done

**No republish.** Live artifacts gain the fields only when the user signals the
republish (todo `event-per-bonus-rp-publish` step 3). The real payload-budget check
against the 350,000-byte event cap happens in that run's own summary.
