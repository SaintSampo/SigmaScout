# Sigma1 RP verification (SC-4)

SC-4 reads "verified against the official 2022–2026 game manuals." This document is where that
claim's verification status is answerable in one read, per bonus threshold, rather than
reconstructed from source comments and a summary file — the gap `03-VERIFICATION.md` raised and
`03-08-PLAN.md` closes. Every quantified figure below is reproduced from
`pnpm rp:conservative-branch` (`packages/harness/rpConservativeBranch.ts`) or from
`packages/core/algorithms/sigma1/rp/reconciliation.test.ts`'s own console output — nothing here is
estimated.

**2019 and 2020 are not covered by SC-4's manual-verification claim above, and that claim is not
being restated or re-scoped here.** The corpus was extended to include those two seasons on
2026-09-03/04 (quick tasks 260903-4fs, 260904-nt4), but their RP thresholds were DERIVED FROM
CORPUS DATA — swept and fit against observed TBA flags — rather than read from an official game
manual, because no live threshold-variable signal for either season's flagged bonuses existed to
verify against the manual text directly. See `docs/data/tba-rp-thresholds-2019-2020.md` for the
derivation and its measured agreement rates.

## Verification Method

D-12's two-way discharge: the official FRC Game Manual is the AUTHORING source for a threshold
(the value a rule module ships), and corpus-wide reconciliation
(`reconciliation.test.ts`, comparing every recomputed `bonusFlags` value against TBA's own
recorded flag over the full played-`qm`-match population per season) is the TEST that the
authored value actually reproduces real outcomes. Both halves matter and neither substitutes for
the other: a threshold can reconcile well against the corpus by coincidence of a nearby value, and
a threshold copied faithfully from the manual can still be wrongly *applied* (wrong tier, wrong
gating condition — exactly what 03-08's coopertition fix corrected, see `## Conservative-Branch
Understatement` below for the identical logic but different section, and the fix's own commit for
the RP-flag consequence).

Most thresholds in this codebase have BOTH forms of evidence: a manual section cited in the
rule module's file header, AND a 0-mismatch (or a small, named-tolerance) reconciliation result.
Two thresholds — 2025 Coral Bonus's Championship-tier per-level count, and 2026 Energized/
Supercharged's District-Championship/Championship tiers — were **corpus-converged first, in plan
03-02**, because RESEARCH.md had left them unpinned, and only had the reconciliation half of this
discharge until this plan. Task 2's human checkpoint (`03-08-PLAN.md`) added the manual half: a
human read the official manual sections named below and reported what they said. That report is
what `## Threshold Provenance`'s `manual-confirmed` rows are grounded in — not a citation the
executor produced unaided, which it has no way to verify (no web access) and would otherwise be a
fabricated verification, precisely the failure this document exists to prevent.

## Threshold Provenance

Every tiered threshold constant declared across `rp/2022.ts` through `rp/2026.ts`. Provenance
values: `manual` (cited from the official manual in the module's file header, at RESEARCH.md
authoring time, not converged from corpus data this phase); `corpus-converged, manual-confirmed`
(RESEARCH.md left the value unpinned, plan 03-02 converged it from corpus bracketing, and a human
subsequently read the cited manual section and confirmed the value — plan 03-08, Task 2/3).

| Season | Bonus | Constant | Tier values | Provenance | Evidence |
|---|---|---|---|---|---|
| 2022 | Cargo Bonus (non-quintet) | `CARGO_BONUS_THRESHOLD_NON_QUINTET` | 20 (flat) | manual | 2022 FRC Game Manual §6.4.1, Table 6-1; 0 mismatches at event_type 2/3/5/100 (base tier carries the named `cargoBonus` data-artifact tolerance, see below) |
| 2022 | Cargo Bonus (quintet) | `CARGO_BONUS_THRESHOLD_QUINTET` | 18 (flat) | manual | same citation |
| 2022 | Cargo Bonus quintet gate | `QUINTET_AUTO_CARGO_THRESHOLD` | 5 (flat) | manual | same citation |
| 2022 | Hangar Bonus | `HANGAR_BONUS_THRESHOLD` | 16 (flat) | manual | same citation; 0/1000 mismatches |
| 2023 | Activation Bonus | `ACTIVATION_BONUS_THRESHOLD` | 26 (flat) | manual | 2023 FRC Game Manual §6.4.3, Table 6-2; 0/1000 mismatches |
| 2023 | Sustainability Bonus (non-coop) | `SUSTAINABILITY_THRESHOLD_NON_COOP` | base 5, DC 5, champ 6 | manual | same citation; 0/27116 mismatches full season, both-alliances coopertition gate verified (`bothCoopMet`) |
| 2023 | Sustainability Bonus (coop) | `SUSTAINABILITY_THRESHOLD_COOP` | base 4, DC 4, champ 5 | manual | same citation |
| 2024 | Melody Bonus (non-coop) | `MELODY_BONUS_THRESHOLD_NON_COOP` | base 18, DC 21, champ 25 | manual | 2024 FRC Game Manual §6.5.6, Table 6-2 (not independently re-fetched this phase; `frcmanual.com`'s base-tier value matched); independently cross-checked against TBA's own shipped `melodyBonusThresholdNonCoop` per-match field, 0/28282 mismatches (`reconciliation.test.ts`'s "2024 threshold cross-check") |
| 2024 | Melody Bonus (coop) | `MELODY_BONUS_THRESHOLD_COOP` | base 15, DC 18, champ 21 | manual | same citation and cross-check, `melodyBonusThresholdCoop` field |
| 2024 | Ensemble Bonus stage points | `ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD` | 10 (flat) | manual | same citation. Not independently cross-checked against TBA's shipped `ensembleBonusStagePointsThreshold`/`ensembleBonusOnStageRobotsThreshold` diagnostic fields — those fields are read into `thresholdVariables` under `diagnosticKeys` but `reconciliation.test.ts`'s cross-check assertion only exercises the two Melody fields. Noted honestly in `## Open Items`, not fixed here (out of this plan's two-item scope). |
| 2024 | Ensemble Bonus robot count | `ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD` | 2 (flat) | manual | same citation, same cross-check gap |
| 2025 | Coral Bonus (strict/coop, shared table) | `CORAL_LEVEL_THRESHOLD_STRICT` / `CORAL_LEVEL_THRESHOLD_COOP` (`COOP` derived from `STRICT`, WR-02) | base 5, DC 5, champ **7** | **corpus-converged, manual-confirmed** | Base/DC: manual (RESEARCH.md citation). Championship (7, not the base tier's 5): corpus-converged in plan 03-02 (72/2004 mismatches at 7 vs. 257/2004 at 5, event_type 3); manual-confirmed 2026-08-18 — a human read **2025 FRC Game Manual §6.5.4, Table 6-2** and reported the Championship-tier per-reef-level count as 7, matching the shipped/converged value exactly |
| 2025 | Barge Bonus | `BARGE_BONUS_THRESHOLD` | base 14, DC 14, champ 16 | manual | RESEARCH.md citation; DC does NOT bump, verified (DC-tier mismatch rate minimized at the base value, not the championship value) |
| 2026 | Energized | `ENERGIZED_THRESHOLD` | base 100, DC **240**, champ **360** | **corpus-converged, manual-confirmed** | Base: already 0-mismatch high confidence pre-phase. DC/championship: corpus-converged in plan 03-02 via exact-boundary bracketing (min achieved count = max non-achieved count + 1, at every tier); manual-confirmed 2026-08-18 — a human read **2026 FRC Game Manual §6.5.3, Tables 6-4/6-5** and reported these values as correct as shipped |
| 2026 | Supercharged | `SUPERCHARGED_THRESHOLD` | base 360, DC 360 (no bump), champ **500** | **corpus-converged, manual-confirmed** | same convergence method and same manual confirmation as Energized |
| 2026 | Traversal | `TRAVERSAL_THRESHOLD` | 50 (flat) | manual | RESEARCH.md citation; 0/30382 mismatches at every event type |

**No corpus-converged threshold remains unconfirmed.** Both items `03-VERIFICATION.md` flagged
(2025 Coral championship tier, 2026 Energized/Supercharged tiers) were confirmed against the
official manual on 2026-08-18 (Decision A, option `A1-confirmed`) — see the human's report quoted
in `03-08-SUMMARY.md`.

## Conservative-Branch Understatement

**The claim being tested.** `RpRuleModule.predictThresholds`'s doc comment
(`rp/constants.ts`) states that a bonus whose real achievement condition depends on an untracked
alliance-level gating signal is evaluated at its LESS-likely-to-achieve branch, which
**understates** that bonus's predicted probability and **never overstates** it. Prior to this
plan, that second half — "never overstates" — was asserted, not measured. Reproduce with:

```
pnpm rp:conservative-branch
```

**Measured, post the 2025 Coral coopertition both-alliances fix** (plan 03-08's authorized
deviation — see below; `parse()`'s `coralBonus` computation changed, so this table supersedes any
pre-fix figure). Full season 2022-2026, every played non-offseason `qm` alliance-match:

| Season | Bonus | understatedRate | overstatedRate | meanRpUnderstatement | n |
|---|---|---|---|---|---|
| 2022 | cargoBonus | 0.0000% | 0.0000% | 0.000000 | 24128 |
| 2022 | hangarBonus | 0.0000% | 0.0000% | 0.000000 | 24128 |
| 2023 | activationBonus | 0.0000% | 0.0000% | 0.000000 | 27116 |
| 2023 | sustainabilityBonus | 10.5362% | 0.0000% | 0.105362 | 27116 |
| 2024 | melodyBonus | 12.3188% | 0.0000% | 0.123188 | 28282 |
| 2024 | ensembleBonus | 0.0000% | 0.0000% | 0.000000 | 28282 |
| 2025 | autoBonus | 62.5464% | 0.0000% | 0.625464 | 29642 |
| 2025 | coralBonus | 9.5405% | 0.0000% | 0.095405 | 29642 |
| 2025 | bargeBonus | 0.0000% | 0.0000% | 0.000000 | 29642 |
| 2026 | energized | 0.0000% | 0.0000% | 0.000000 | 30382 |
| 2026 | supercharged | 0.0000% | 0.0000% | 0.000000 | 30382 |
| 2026 | traversal | 0.0000% | 0.0000% | 0.000000 | 30382 |

**No bonus in any season showed a non-zero `overstatedRate`.** The "conservative, never
overstates" claim was tested against the full corpus, not repeated as an assumption, and it held
exactly. 2022 and 2026 correctly measure exactly 0.0000 everywhere — neither season has an
untracked alliance-level gating signal, and the measurement discriminates affected seasons from
unaffected ones rather than reporting a non-zero figure everywhere by construction. 2025
`autoBonus` is, as expected, by far the largest effect (0.625464 RP/alliance-match) — it has no
threshold-variable-only fallback at all (`predictThresholds` returns `false` for it
unconditionally), unlike the other three affected bonuses which fall back to a stricter-but-real
threshold comparison.

**Disposition: escalated to future work, NOT accepted as a limitation (Decision B, option
`B2-plan-fix`, `03-08-PLAN.md` Task 2).** The human reviewing Task 1's measured table declined to
accept the understatement as a permanent, shipped limitation. Their recorded design direction for
the fix, quoted verbatim:

> Draw a distinction between RPs that can be *derived* from predictions (e.g. 2026 Energized — a
> plain count threshold on a tracked variable) and those that cannot (e.g. 2025 autoBonus — a
> per-robot binary condition with no threshold-variable representation). Where an RP cannot be
> derived, predict it from the **teams' historical RP success rates** rather than emitting a
> near-zero prediction. Do not drastically under-predict an RP merely because it is not
> derivable. (Statbotics is understood to predict all of its RPs this way.)

**Why this sidesteps D-09's identifiability caution**, which the original `03-03-SUMMARY.md`
follow-up recommendation (extend `RpThresholdVariable` to estimate a gating signal as its own
Kalman-tracked quantity) did not: a per-team empirical RP-achievement rate is a **directly
observed** quantity computable from each team's own match history, not a new latent dimension an
optimizer has to separate from a shared alliance-sum observable. It carries none of the
unidentifiable-4D-model risk the failure log records and D-09's rationale is wary of — it is closer
in kind to how Sigma1 already estimates every scoring component (a per-team mean recovered from
alliance sums, replayed match by match) than to adding a new latent state dimension.

This design is recorded here as the fix's starting direction for a future phase; **this plan does
not implement it** — implementing it means a new estimation path (what population of matches to
average over, how to blend a team's own rate with a league-wide prior for cold-start teams, how it
interacts with the existing Monte Carlo joint draw in `rp/distribution.ts`), which is new-phase
scope, not a gap-closure-plan scope. The measured table above is what makes the decision to
escalate (rather than accept) a measured one rather than an assertion.

## Known Reconciliation Tolerances

The named, measured gaps in `reconciliation.test.ts`'s `KNOWN_TOLERANCES` — every entry MUST NEVER
be widened to cover a rule change (this project's Pitfall 5 discipline); a tightened value from
this plan reflects only a genuine fix that reduced the measured mismatch rate, never a loosened
assertion.

| Season | Bonus | Rate before this plan | Rate after this plan | Why |
|---|---|---|---|---|
| 2022 | cargoBonus | 0.005 (0.5%) | 0.005 (unchanged) | Data artifact (a handful of anomalous events), not touched by this plan |
| 2024 | ensembleBonus | 0.1 (10%) | **0.085 (8.5%)** | IN-02 (03-REVIEW.md): the prior margin was ~40% wider than the measured rate with no stated reason. Measured maximum across event types: 7.825% (event_type 1). Tightened to keep a small margin above the exact measured ceiling. |
| 2025 | autoBonus | 0.03 (3%) | 0.03 (unchanged) | Not touched by the coopertition fix (autoBonus has no coopertition gate at all) |
| 2025 | coralBonus | 0.05 (5%) | **0.005 (0.5%)** | The coopertition both-alliances fix (see `## Conservative-Branch Understatement` above and the fix's own commit) reduced the measured mismatch rate roughly 10x at every tier (championship: 72/2004 -> 5/2004). Measured maximum after the fix, across event types: 0.336% (event_type 5). Tightened to keep margin above that ceiling. |
| 2025 | bargeBonus | 0.05 (5%) | 0.05 (unchanged) | Not touched by this plan |

**Every residual mismatch, both before and after the coralBonus fix, is exclusively a false
positive (0 false negatives measured)** — `predictThresholds`'s SC-4-adjacent finding that the
model never over-predicts a bonus in the conservative-branch sense (see above) has a parallel here:
the parse-vs-recorded mismatch never runs in the direction of under-crediting an alliance either.

## Open Items

Genuinely remaining after this plan — named here rather than left implicit:

- **The historical-RP-success-rate redesign for conservative-branch bonuses** (Decision B,
  `B2-plan-fix`) is a recorded future-phase direction, not implemented here. See `##
  Conservative-Branch Understatement` above for the full disposition and the human's design
  direction quoted verbatim.
- **2024 Ensemble Bonus's own thresholds** (`ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD` /
  `ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD`) are read from TBA's shipped
  `ensembleBonusStagePointsThreshold`/`ensembleBonusOnStageRobotsThreshold` diagnostic fields into
  `thresholdVariables`, but — unlike Melody Bonus's own diagnostic cross-check —
  `reconciliation.test.ts` does not independently assert the hardcoded Ensemble constants agree
  with those shipped fields. Noticed while building the `## Threshold Provenance` table above;
  out of this plan's two-item scope (the flagged gaps were specifically the 2025 Coral and 2026
  Energized/Supercharged thresholds), so not added here — recorded honestly rather than silently
  left off this table.
- **2024 Ensemble Bonus's own ~7-7.8% reconciliation residual** (unrelated to the conservative
  branch or to the coopertition fix — `ensembleBonus` has no coopertition gate at all in this
  rule module) remains an unresolved, investigated-but-not-closed modeling gap, per
  `reconciliation.test.ts`'s own file header and `2024.ts`'s file header.
- **2025 Auto Bonus's ~2% and Barge Bonus's ~4% residuals** remain unresolved for the same
  reason — both were investigated in plan 03-02/03-03 and could not be resolved to 0 mismatches;
  neither is related to the coopertition-gate bug this plan fixed (Auto Bonus has no coopertition
  gate; Barge Bonus's residual is a base-tier-concentrated, always-false-negative pattern
  inconsistent with a coopertition mis-gate, which is always a false positive).

---
*Phase: 03-tuning-ranking-points-versioning (plan 03-08)*
*Figures quoted from `pnpm rp:conservative-branch` (`reports/rpConservativeBranch.json`, gitignored,
regenerate to reproduce) and `npx vitest run packages/core/algorithms/sigma1/rp/reconciliation.test.ts`'s
own console output, both against `data/corpus.sqlite`.*
