---
id: codify-rule-a-acceptance
created: 2026-09-05
source: Rule-A policy decision, 2026-09-05 session — adopted by operator after the 36-verdict retroactive bar analysis; first applied manually to promote rolling-2026-09c
priority: high
---

# Codify Rule A in decideAcceptance so future tunes gate on the adopted policy

## What was decided

2026-09-05, after three accuracy-primary tunes went 30/30 keep-incumbent under the
D-T7 noise bar while posting repeated near-accepts (2025 at 90% of the bar twice, with
better Brier both times), the operator adopted **Rule A**: a search winner SHIPS when it
improves BOTH out-of-sample winner accuracy AND Brier over the live incumbent. The
retroactive analysis over all 36 recorded accuracy-primary verdicts (4 runs: retune-0905,
elim-R v9n, Stage 2 CVF, Stage 3 CER) showed Rule A ships exactly the season-clustered,
autopsy-predicted improvements (2025 twice, 2026 once) and rejects every Brier-worse
positive (all of which pattern as noise, e.g. every 2022 positive).

The first Rule-A promotion (`vpr@9.0.0+rolling-2026-09c`, 2025+2026) was applied
MANUALLY. `decideAcceptance` still implements only the D-T7 noise bar, so the next tune's
`keep-incumbent` verdicts must be re-read by hand under Rule A — that is drift waiting to
happen.

## What to do

- Add Rule A to the acceptance decision in `packages/harness/acceptance.ts` /
  `decideAcceptance` as the shipping gate: `accept` when `accuracyMargin > 0 AND
  candidateBrier < incumbentBrier`; keep the existing noise-bar computation REPORTED
  (it is diagnostic context — "cleared the old bar too" is worth knowing) but no longer
  the gate.
- Keep the MAE veto and any other guardrails as-is unless they conflict.
- Update the D-T7 ship-bar prose (objectiveDefinition.ts / docs) to record Rule A and
  the 2026-09-05 decision, with the pre-committed rationale: the bar's winner's-curse
  correction demands margins (~3 SE) that a single season's ~16k matches cannot supply
  for real effects of ~0.2-0.4pt; the Brier guardrail addresses selection-overfit a
  different way (an overfit winner buys selection accuracy by paying calibration).
- Pin with tests: a fixture where accuracy improves but Brier worsens must
  keep-incumbent; both-improve must accept; both-worse must keep-incumbent.
- IMPORTANT pre-commitment (recorded to prevent policy-tuning drift): Rule A was chosen
  looking at this data. It must now run UNCHANGED on future tunes — do not add margins,
  SE minimums, or per-season exceptions in reaction to any single future result.

## CLOSED 2026-09-05, same session — codified as quick task 260905-t88

Commits 42f59bf3 / 0e227f21 / 58d185fe: decideAcceptance now gates on Rule A
(strict accuracy improvement AND strict Brier improvement), the retired noise bar stays
computed and reported as diagnostics (`clearedNoiseBar`), reasons renamed so historical
artifacts stay readable, verdict prose names Rule A, and the pre-commitment note lives in
decideAcceptance's own doc comment. acceptance.test.ts 20/20, tune.test.ts 90/90, digests
bitwise unchanged. Future tunes now print Rule-A verdicts directly.
