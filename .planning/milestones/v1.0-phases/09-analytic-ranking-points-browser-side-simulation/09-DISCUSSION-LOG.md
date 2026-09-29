# Phase 9: Analytic Ranking Points & Browser-Side Simulation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-11
**Phase:** 9-analytic-ranking-points-browser-side-simulation
**Areas discussed:** Marginal family, Attribution toggles, Acceptance bar for bonus RP, Presim payload & template licence

---

## Marginal family

| Option | Description | Selected |
|--------|-------------|----------|
| Negative binomial | Count-native, right-skewed, exact discrete CDF at integer thresholds, handles overdispersion | ✓ |
| Gamma | Continuous right-skewed, closed-form CDF, keeps a discreteness error | |
| Continuity-corrected normal | One-line change, fixes discreteness only — not the skew | |
| Let research choose | Defer the family to RESEARCH.md | |

**User's choice:** Negative binomial.

| Option | Description | Selected |
|--------|-------------|----------|
| Continuous family for derived, discrete for raw | Two families, honest about which quantities are integer | |
| One continuous family everywhere | One code path, gives up the exact discrete CDF | |
| Rescale derived to integer units first | One discrete family covers everything | |

**User's choice:** Free text — *"as far as I know all point values should be integers. reasearch this one, and hopefully we can convert to integers and keep it simple."*
**Notes:** Became a research item. Preliminary analysis offered in support: the divisors (60/40, 5/15, 5) are unit conversions and point totals accumulate in fixed per-unit increments, so quotients should be integral. Two candidate approaches recorded in CONTEXT.md D-03, plus an empirical check for whether fouls/adjustments/corrections ever break integrality.

| Option | Description | Selected |
|--------|-------------|----------|
| Declared per variable in the season module | Explicit, diff-reviewable, allows exceptions | ✓ |
| Derive from the existing `unit` field | Zero data entry, but implicit and no exception path | |
| Global default with per-variable override | Least churn, invisible at the call site | |

**User's choice:** Declared per variable in the season module.

| Option | Description | Selected |
|--------|-------------|----------|
| One family globally, chosen by measurement | Fit candidates offline, ship the single winner | |
| Per-variable selection by measured Brier | Best raw calibration, 30+ selection surface | |
| Pick one a priori, measure to confirm | Zero bias, risks shipping a rejected family | |

**User's choice:** Free text — *"I want to think about this one carefully. If we measure every season and then use those measurements to predict, would that not be cheating? I would need to understand this more before making a call"*
**Notes:** Re-asked after an explanation distinguishing (a) the predictions, which stay walk-forward regardless because a distributional family is a structural choice rather than a fitted parameter, from (b) the *reported* accuracy, which is biased only if the same data both chooses and reports — with the bias scaling in the number of choices made against the sample size. Noted that 1-of-3 on 488k observations is negligible while per-variable or continuous-knob tuning is not. Re-ask options and result below.

| Option (re-ask) | Description | Selected |
|--------|-------------|----------|
| Choose on 2016-2022, report on 2023-2026 | Published number fully out-of-sample w.r.t. the choice | ✓ |
| Choose on everything, report on everything, disclose | Simplest, small but unquantified bias | |
| A priori on theory, measure to confirm | Zero selection bias, no measurement-driven choice | |
| Hold 2026 back as the only holdout | Maximises selection data; 2026 already spent once | |

**User's choice:** Choose on 2016-2022, report on 2023-2026.
**Notes:** Explicitly flagged as not BPR tuning and not touching BPR's sealed holdout — the RP layer is a separate level-2 model reusing the split boundary as a convention.

---

## Attribution toggles

| Option | Description | Selected |
|--------|-------------|----------|
| Named RP layer config, versioned like a param set | Self-describing in the artifact, harness can sweep combinations | ✓ |
| Publish-time CLI flags | Cheapest, but the shipped combination isn't recorded | |
| Separate exported functions | Clearest comparison, but keeps the MC path alive | |

**User's choice:** Named RP layer config, versioned like a param set.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep until the measurement is published, then collapse | No permanent config surface | ✓ |
| Keep permanently as supported config | Flexible, permanent maintenance burden | |
| Temporary and never committed | Smallest footprint, unreproducible attribution | |

**User's choice:** Keep until published, then collapse.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — one-time equivalence test against the MC, then delete | Strongest available correctness proof for the rewrite | |
| No — delete it and rely on unit tests | Less work, no dead-code window | ✓ |

**User's choice:** No — delete and rely on unit tests.
**Notes:** Against the recommendation. Consequence stated once and not relitigated; mitigation recorded as a hard requirement in CONTEXT.md D-07 — hand-computed expectations for each of the seven mechanisms plus a dedicated 2026 nested-threshold case.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — precondition for deliverable 8 | Zero-import leaf, browser runs the same pure function | ✓ |
| Yes, plus a bundle-size guard | Prevents silent regression | |
| Not in this phase | Reintroduces the duplicate-implementation risk | |

**User's choice:** Yes — precondition for deliverable 8.

---

## Acceptance bar for bonus RP

| Option | Description | Selected |
|--------|-------------|----------|
| Both Brier and calibration must improve | The RP analogue of Rule A | |
| Per-bonus: majority must improve, none may badly regress | Catches aggregate-helps-one-season-wrecked | ✓ |
| Pooled Brier only | One defensible number, but dominated by easy predictions | |

**User's choice:** Per-bonus majority with a floor.

| Option | Description | Selected |
|--------|-------------|----------|
| Ship the analytic form anyway, revert only what failed | Keeps exactness, cost, unblocks regardless | |
| All-or-nothing | Clean story, throws away unrelated gains | |
| Ship whatever subset clears the bar | Most rigorous use of the toggles | |

**User's choice:** Free text — *"I honestly want to ship simulation without monte carlo no matter what. If the new system is bad bad, we will just fix it"*
**Notes:** Stronger than the offered option — the closed form ships unconditionally and the bar governs only the modelling changes. The phrase "without monte carlo" was ambiguous about whether it included the rank step, so it was clarified in the next area.

| Option | Description | Selected |
|--------|-------------|----------|
| Must clear a paired bootstrap interval excluding zero | Guards against reading noise as signal | |
| Any improvement in the right direction counts | Simple; a real fix should move things enormously | ✓ |
| A stated absolute threshold | Unambiguous but arbitrary | |

**User's choice:** Any improvement counts.
**Notes:** Against the recommendation. Mitigation recorded in CONTEXT.md D-11 — both arms must run through the same published scorer, because a scorer mismatch previously manufactured a ~0.003 phantom regression in this project.

| Option | Description | Selected |
|--------|-------------|----------|
| Assert level-1 output byte-identical | Absolute guard, fails loudly on a cross-level leak | ✓ |
| Assert within a small tolerance | Safer against drift, lets a small leak hide | |
| Do not check | Trust the separation | |

**User's choice:** Assert byte-identical.

---

## Presim payload & template licence

| Option | Description | Selected |
|--------|-------------|----------|
| RP prediction only — keep MC for ranks | MC survives only where it is the right tool | ✓ |
| Both — analytic rank via Poisson-binomial | Deterministic, discards shared-match coupling | |
| Both, only if it measures as good or better | Determinism without an unmeasured approximation | |

**User's choice:** Free text — *"I dont mind MC for ranks prediction, my question is about pre-schedule predicitons. How are those going to work? I feel like there should be a better way than simulate X competitions Y times."*
**Notes:** Resolved the earlier ambiguity — rank MC stays. The real concern was pre-schedule, answered below.

| Option | Description | Selected |
|--------|-------------|----------|
| No bonus's Brier may get worse at all | Strict, unambiguous, no arbitrary number | ✓ |
| None by more than a small margin | Allows noise wobble, needs a number | |
| Occurrence-weighted regressions | Most faithful to impact, hardest to state | |

**User's choice:** No bonus may get worse at all.

| Option | Description | Selected |
|--------|-------------|----------|
| Ship roster-index schedules, price in the browser | ~265KB → ~20KB, keeps a schedule step | |
| Keep baked histograms, swap pricing only | Smallest change, forfeits the payload win | |
| Ship per-team beliefs instead of schedules | Smallest payload, needs templates client-side | |

**User's choice:** Free text — *"This question is super importnat I want your honest thoughts on this one."*
**Notes:** Answer given was **none of the three**. The 20 schedules are themselves a Monte Carlo approximation of an expectation over schedule randomness — the same insight as the RP pmf, one level up — so concrete schedules were never needed. Proposed a field-averaged analytic predictor from a team's own belief plus field-level summary statistics, giving ~2–3 KB and deleting schedule generation entirely. Caveats stated: near-independence of a team's matches, and coupling from shared matches washed out (as the 20-schedule approach also does by design).

| Option | Description | Selected |
|--------|-------------|----------|
| Spike field-averaged first, fall back down the ladder | Measure at each rung, stop at the first that holds | ✓ |
| Test self-generated schedules only | Answers the original question, keeps a schedule step | |
| Commit to field-averaged, no fallback | Fastest, no measured fallback | |

**User's choice:** Spike field-averaged first with the fallback ladder.
**Notes:** On rung 2 the user asked: *"lets do some testing. lets investigate if we can easily randomly generate schedules ourselves, that give similar final results as chesy arena?"* — the measurement question being whether balanced-grid structure matters to final rank bands or is just tradition.

| Option | Description | Selected |
|--------|-------------|----------|
| Split it into Phase 10 | Phase 9 stays well-specified; Phase 10 builds on the closed form | |
| Keep it all in Phase 9 | One phase, no hand-off, but larger and holds an open-ended spike | ✓ |
| Keep deliverable 8 minimal, redesign later | Smallest Phase 9, 265KB stays | |

**User's choice:** Keep it all in Phase 9.
**Notes:** The split was recommended and declined. Recorded in CONTEXT.md deferred ideas as the natural fault line if planning finds Phase 9 too large.

---

## Claude's Discretion

- Exact formulation of the discrete score-margin tie model (approach chosen, form not).
- Numerically stable Poisson-binomial convolution for 2016 `breach`; the `erf` implementation.
- What the RP scorecard shows beyond the already-settled sentence-first form.
- The `--presim-from-season` value on re-enable.

## Deferred Ideas

- Dependence between threshold variables (audit F4) — and the knowing acceptance that the analytic
  form makes it harder to add later.
- 2019 `completeRocket`'s always-false branch; 2022 `cargoBonus`'s auto-vs-match-cargo independence.
- Bonus dot 0.5 threshold (F10) — offered as a fifth gray area, not taken up.
- OPR and EPA's cold-start gate (fixed for BPR by Sigma Score only).
- Splitting the pre-schedule redesign into Phase 10.
