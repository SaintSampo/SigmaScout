# Quick Task 260904-oiu: make maximum prediction accuracy the primary VPR tuning goal with brier score secondary - Context

**Gathered:** 2026-09-04
**Status:** Ready for planning

<domain>
## Task Boundary

Flip the VPR (Sigma1) tuning objective: winner accuracy (prediction accuracy rate) becomes
the PRIMARY objective, Brier score becomes SECONDARY. Today `objectiveForCandidate` in
`packages/harness/tune.ts` minimizes mean tune-season Brier (D-01) and records winnerAccuracy
without ever reading it; `acceptance.ts`'s D-T7 promotion bar is measured on Brier delta.

</domain>

<decisions>
## Implementation Decisions

### Objective combination (search ranking)
- **Noise-band lexicographic.** Maximize winner accuracy. When two candidates' accuracy
  differs by less than statistical noise (1 event-blocked PAIRED-difference SE of the
  accuracy delta), treat them as accuracy-tied and let LOWER Brier decide.
- Rationale the user accepted: prevents chasing a 2-matches-out-of-48,000 accuracy blip
  while Brier quietly worsens; Brier is the refinement when accuracy cannot separate.
- The deterministic tie-break discipline in `determineWinner` (earlier generation index
  wins on exact ties, ties recorded) must be preserved in spirit for the new comparator.

### D-T7 acceptance (ship/don't-ship bar)
- **Accuracy bar, Brier guardrail.** The challenger ships when its out-of-sample ACCURACY
  beats the incumbent by `sqrt(2·ln N) × SE_paired(accuracy delta)`.
- Brier becomes a GUARDRAIL VETO alongside the existing MAE veto: a challenger whose Brier
  is significantly WORSE than the incumbent's is rejected even if more accurate. Mirror the
  MAE veto's two-half structure (distinguishable from noise AND materially worse) with its
  own stated tolerances.
- The MAE veto is unchanged. `keep-incumbent` remains a successful, calmly-reported outcome.
- New keep-incumbent reason (e.g. `brier-veto`) must be a distinct reportable value.

### Scope
- **Tuner + docs.** Update `tune.ts` objective machinery, `acceptance.ts`, their tests, and
  artifact metadata strings (the `objective:` field written into tune output JSON).
- Update PROJECT.md's core-value wording ("proven by walk-forward, Brier-scored backtests")
  and `docs/models/` tuning docs so the stated goal matches the code — the failure log's
  "docs describe a deleted model" pattern must stay closed.
- **Screen stays Brier-based.** The sensitivity screen's survival test
  (`SCREEN_SURVIVAL_THRESHOLD`, Brier range > 1e-4) is NOT re-based on accuracy. Brier is
  strictly more sensitive, so it catches every accuracy-relevant knob. Document this
  explicitly where the screen objective is described.

### Claude's Discretion
- Exact field names, SE computation reuse (`eventBootstrap.ts` already computes
  event-blocked paired SEs), and how the noise-band comparator is structured/tested.
- Brier-veto tolerance constants: mirror the MAE veto's shape; choose and justify values
  in doc comments the way `ACCEPTANCE_MAE_RELATIVE_TOLERANCE` does.
- Whether `EvaluatedCandidate.objective` stays a single number or becomes a structured
  comparison — preserve the "objective definition cannot drift between stages" property.

</decisions>

<specifics>
## Specific Ideas

- D-01's doc-comment trail ("minimized... NEVER read here") must be rewritten, not left
  stale — stale objective comments are exactly the failure-log pattern this project names.
- Do NOT re-run any tuning as part of this task; this changes the machinery only. A re-tune
  under the new objective is a separate, deliberately-scheduled run (~hours of compute).
- Walk-forward / predict-before-update discipline and all four D-T5 leak gates are untouched.

</specifics>

<canonical_refs>
## Canonical References

- `packages/harness/tune.ts` — `objectiveForCandidate` (D-01), `determineWinner`, artifact
  `objective:` strings
- `packages/harness/acceptance.ts` — D-T7 `decideAcceptance`, `acceptanceThreshold`, MAE veto
- `packages/harness/eventBootstrap.ts` — event-blocked paired SE machinery
- `packages/harness/tune.test.ts`, `packages/harness/acceptance.test.ts`
- `.planning/PROJECT.md` core value line; `docs/models/sigma1-tuning-results.md`

</canonical_refs>
