# Phase 9: Analytic Ranking Points & Browser-Side Simulation - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Ranking points are predicted by an exact closed form instead of a 4000-draw Monte Carlo, their
accuracy is published rather than merely computed, the live Worker stops stripping them, and
pre-schedule simulation is redesigned to need no schedule generation at all.

The enabling fact, verified against HEAD: `empiricalMoments.momentsFor` returns a **diagonal**
variance block and **all-zero** cross-covariance, and `buildJointModel` zeroes the cross-alliance
blocks — so every one of the 2+2T variables in the RP joint is already mutually independent. The
Cholesky factor is a diagonal of standard deviations and the 4000 draws are sampling independent
normals. The closed form is therefore **exact, not an approximation**, and the Monte Carlo is
adding ±0.008 of sampling noise for nothing.

All seven bonus-prediction mechanisms across 2016–2026 were verified to have closed forms. See
`<code_context>` for the taxonomy.

**Not in scope:** modelling dependence *between* threshold variables (the diagonal block discards
a measured +0.0391 of real dependence — bivariate has a closed form but 2025 `coralBonus`'s four
levels would need Genz quadrature); 2019 `completeRocket`'s always-false branch; 2022
`cargoBonus`'s auto-vs-match-cargo independence flaw; the BPR→SPR rename.

</domain>

<decisions>
## Implementation Decisions

### Marginal family
- **D-01:** Count-valued threshold variables use a **negative binomial** marginal, fitted from the
  existing alliance mean and variance by method of moments. Chosen because it is count-native and
  right-skewed (a symmetric Gaussian under-predicts `P(X ≥ t)` exactly where bonus thresholds sit),
  has an exact discrete CDF at integer thresholds, has support `[0, ∞)`, and handles the
  overdispersion alliance totals plainly have. No closure-under-convolution problem arises because
  the fit is at alliance level, not per team. — **Reversibility:** costly — the family is read at
  every threshold evaluation and the published pmfs change, so reverting means a full republish.
- **D-02:** A variable's marginal family is **declared per variable in the season module**,
  alongside the existing `unit` field (`"count"` / `"points"`). Explicit and reviewable in a diff,
  and it matches the established data-entry-not-branches discipline; a variable needing an
  exception has somewhere to say so. Rejected deriving it implicitly from `unit`.
- **D-03: RESEARCH ITEM — derived linear combinations.** Three seasons compute a bonus from a
  derived quantity: 2017 `rotorCount` (`autoRotorPoints/60 + teleopRotorPoints/40`), 2016
  `towerRobotCount` (`teleopChallengePoints/5 + teleopScalePoints/15`), 2023 `links`
  (`linkPoints/5`). The developer's position: *"as far as I know all point values should be
  integers… hopefully we can convert to integers and keep it simple."* Preliminary analysis agrees
  — those divisors are unit conversions and the point totals accumulate in fixed per-unit
  increments, so the quotients should be integral. **Research must decide between two candidate
  approaches and confirm empirically:**
  1. Clear the denominators so the clause stays integer — `rotorCount ≥ T` becomes
     `2·autoRotorPoints + 3·teleopRotorPoints ≥ 120·T`.
  2. Track the derived count *as* a threshold variable, so the belief is learned on the integer
     count directly and one discrete family covers everything.
  Research must also check whether these are **ever** non-integral in the corpus (fouls,
  adjustments, scorekeeper corrections). Goal: one discrete family everywhere.

### Selection and reporting
- **D-04:** The marginal family is chosen on **2016–2020 + 2022 only**, and calibration is
  published from **2023–2026**, which had no say in the choice. The published number is then fully
  out-of-sample with respect to the family choice and needs no disclosure caveat — which matters
  because deliverable 5 publishes it to the FRC community. This arose from the developer asking
  whether measuring every season and then predicting from those measurements "would not be
  cheating"; the answer distinguished the predictions (walk-forward regardless — a family is a
  structural choice, not a fitted parameter) from the *reported* accuracy (biased only if chosen
  and reported on the same data), with the bias scaling in how many choices are made.
  **Explicitly NOT BPR tuning and does not touch BPR's sealed holdout** — this is the level-2 RP
  layer reusing the split boundary as a convention. — **Reversibility:** one-way — once the
  2023–2026 slice informs a choice it stops being a clean reporting slice, and no replacement
  exists (the 2026 holdout was already spent once).

### Attribution and toggles
- **D-05:** The four changes ship together (developer's choice; the attribution risk was raised and
  accepted) behind a **named, versioned RP layer config** — `{winSource, tieModel, marginal}` —
  read by the RP layer and recorded in the published artifact, mirroring how algorithm param sets
  are already versioned. The offline harness can instantiate any combination; production ships
  exactly one named config, so the shipped combination is self-describing after the fact.
- **D-06:** Toggles live **only until the attribution measurement is published**, then collapse:
  losing branches are deleted and one path remains. No permanent combinatorial config surface.
- **D-07:** **No Monte Carlo equivalence check.** The MC path is deleted and unit tests carry the
  correctness burden. *Developer decision against the recommendation* — a one-time cross-check was
  offered as the strongest available correctness evidence (the two must agree today, since the
  joint is fully diagonal) and declined. **Required mitigation:** the unit tests must carry that
  burden explicitly — hand-computed expected values for **each of the seven mechanisms**, plus a
  dedicated case for the **2026 nested-threshold trap** (`energized` and `supercharged` both
  threshold `hubTotalCount`, so `P(both) = P(supercharged)`; treating them as independent is the
  single easiest thing to get silently wrong).
- **D-08:** The RP module becomes **browser-safe** in this phase — a precondition for deliverable
  8. Drop `ml-matrix` (needed only for the Cholesky being deleted) and add a small `erf`, making it
  a zero-import leaf like `rankSimulation.ts`, so the browser runs the *same pure function* real
  matches use. This keeps the simulation audit's C-04 a structural fact rather than a promise.

### Acceptance
- **D-09:** The bar is **per-bonus, not pooled**: a **majority** of individual bonuses must improve
  on Brier, and **no single bonus may get worse at all**. Measured on the 2023–2026 reporting
  slice. Pooled Brier was rejected because it is dominated by confident-and-correct
  low-probability predictions and can improve while the 2.06× under-prediction barely moves.
- **D-10:** **The closed form ships unconditionally.** Developer: *"I honestly want to ship
  simulation without monte carlo no matter what. If the new system is bad bad, we will just fix
  it."* The acceptance bar therefore governs **only** the modelling changes (marginal family, tie
  model, win source). A failed marginal swap reverts to Gaussian while everything else lands.
- **D-11:** **Any improvement in the right direction counts** — no minimum effect size.
  *Developer decision against the recommended paired-bootstrap interval.* **Required mitigation:**
  both arms must be measured through the **same published scorer**
  (`scripts/measureRpCalibration.ts`, driving the real `SigmaScoutLayer`), because a scorer
  mismatch has previously manufactured a ~0.003 phantom regression in this project. Same-scorer
  comparison is required regardless of the absence of confidence intervals.
- **D-12:** Assert **level-1 output is byte-identical** across a corpus slice, before and after the
  whole phase: `pRedWin`, `redScore`, `blueScore` unchanged. The RP layer does not feed back into
  level 1, so any difference is a real cross-level leak, not a tolerance question.

### Win and tie RP
- **D-13:** Win RP comes from the **published `pRedWin`**, closing the coherence gap where the
  pmf-implied win probability differs from the displayed one by 0.12 at p90 (max 0.34, never
  flipping the favourite). — **Reversibility:** costly — changes every published pmf.
- **D-14:** Tie RP uses a **discrete score-margin model**, replacing a branch that can never fire
  (today `tied` requires exact float equality of two continuous draws, while 1.09% of quals
  actually tie).

### Rank simulation
- **D-15:** **Monte Carlo stays for the rank step.** The developer confirmed: *"I dont mind MC for
  ranks prediction."* The trade reverses between the two uses — the RP pmf has an exact closed form
  so MC there is waste, while rank has no tractable exact form and MC captures for free the
  coupling where teammates on an alliance receive the *same* draw. Deliverable 7 is therefore only
  the red/blue independence fix: draw each match outcome **once**, then bonuses per alliance,
  instead of drawing red and blue independently from marginals (where both alliances can currently
  "win" the same draw).

### Pre-schedule prediction — laddered spike
- **D-16:** The 20 synthetic schedules are themselves a **Monte Carlo approximation of an
  expectation over schedule randomness** — the same insight as the RP pmf, one level up. If schedule
  randomness is averaged away anyway, concrete schedules were never needed; what is needed is the
  distribution a random schedule induces. Target: a **field-averaged analytic predictor** built from
  a team's own belief plus field-level summary statistics (mean and variance of per-team
  contributions across the roster, capturing both match-to-match noise and partner-quality spread).
  A team's season total is then an exact convolution of N copies of its field-averaged per-match
  pmf. **Target artifact: one ~7-entry pmf per team plus `matchesPerTeam` — ~2–3 KB versus ~265 KB
  today — with schedule generation deleted entirely.**
  **Honest caveats, to be stated wherever this ships:** it assumes a team's matches are
  near-independent (partners differ each match), and it washes out coupling from teams sharing
  specific matches — though the 20-schedule approach washes that out by design too. The
  composition-induced spread would be treated as Gaussian, the same approximation class used
  elsewhere. — **Reversibility:** one-way — deleting schedule generation and the template
  dependency breaks the published sidecar shape; restoring it means a schema change and a
  republish.
- **D-17:** Build it as a **ladder, measuring at each rung and stopping at the first that holds**:
  1. **Field-averaged analytic**, no schedules, ~2–3 KB — ship if rank bands match the current
     baked output on real events.
  2. **Self-generated random schedules**, ~20 KB — test whether they reproduce cheesy-arena
     balanced-grid results, which answers whether the balanced structure actually matters to final
     rank bands or is just tradition.
  3. **Licensed templates** as today.
- **D-18:** **Kept in Phase 9** — the developer chose not to split the redesign into Phase 10.
- **D-19:** The **template licence question is conditional, not blocking.** It only needs answering
  if rung 1 fails and rung 2 is chosen. If rung 1 holds, the question evaporates because nothing
  template-derived is published. The licence judgement is the developer's, not an agent's.

### Housekeeping (from the roadmap, unchanged by discussion)
- **D-20:** Presim sidecars must be re-keyed/regenerated — every one in R2 belongs to retired `vpr`
  — and presim generation re-enabled (currently off via `--presim-from-season 9999`), or the
  pre-schedule stop stays dark regardless of which rung ships.
- **D-21:** Live Worker RP: add `redRpPmf`/`blueRpPmf` to `buildEventMatchRow` (it omits them
  entirely today while the offline builder emits them and the schema states the field must survive
  on played rows), resume an RP accumulator from D1 behind a **new state shape** (the existing
  `rpBeliefs` field belongs to retired VPR and must **not** be reused), and add a live/offline
  row-shape parity test. — **Reversibility:** one-way — a state-shape bump requires seeding D1
  before deploying the new Worker, per the established seed-first-deploy-second ordering.

### Claude's Discretion
- The exact form of the discrete score-margin tie model (D-14) — the developer chose the approach,
  not the formulation.
- Numerically stable Poisson-binomial convolution for 2016 `breach`, and the `erf` implementation
  for D-08.
- What the RP scorecard displays beyond the already-decided form (see `<canonical_refs>`).
- The `--presim-from-season` value on re-enable.

### Folded Todos
All six RP-related todos fold into this phase. The developer selected all three cumulative options,
so the union applies and Phase 9 inherits closing them out.

1. **`ranking-points-audit.md`** — this phase's scope source; 13 findings (F1–F13). Phase 9 closes
   F1, F2/F3, F5, F6, F7, and F10's upstream cause; F4, F12 and 2022's cargo flaw are explicitly
   deferred.
2. **`rp-bonus-probabilities-are-severely-under-predicted.md`** — the F2 write-up. Two of its three
   causes are already fixed (even-split variance shrinkage; 2025 `autoBonus`'s hardcoded `false`);
   the remaining one is deliverable 4.
3. **`00-sigmascout-layer-roadmap.md`** — the two-level framing and what VPR's retirement left open.
4. **`cold-start-chain-gates-rp-pmfs-measured.md`** — the F8 measurement. **Now partly superseded:**
   the gate is already fixed for BPR by the Sigma Score work committed 2026-09-10 22:43
   (`sigmaScore.ts`'s `bandVarianceFor` never returns `undefined` for a non-empty roster), but
   remains live for OPR and EPA, which still use Swing's two-observation rule.
5. **`live-match-updates-swing-and-lossy-merge.md`** — **stale as written.** It says its "defect 2"
   (Worker swing accumulator, shape 9→10) is the only part left, but that shipped;
   `scheduled.ts` resumes from `readSwingBeliefs` and the shape is at 10. The open live gap is RP,
   which is D-21.
6. **`vpr-retirement-make-features-algorithm-agnostic.md`** — mostly shipped; Phase 9 verifies and
   closes it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The two audits this phase derives from
- `.planning/todos/pending/ranking-points-audit.md` — 13 findings with measurements; the scope
  source. Read F1–F13 before planning.
- `docs/simulation-architecture.md` — the two simulation engines, the sidecar anatomy (95.4% of
  ~265 KB is priced schedules the client never reads), and the four blockers to browser-side
  pricing. The analytic form removes three; the fourth is the template licence.

### Measurement and prior RP work
- `.planning/todos/pending/rp-bonus-probabilities-are-severely-under-predicted.md` — the three
  measured causes, two now fixed.
- `.planning/todos/pending/00-sigmascout-layer-roadmap.md` — the level-1 / level-2 framing.
- `.planning/todos/pending/cold-start-chain-gates-rp-pmfs-measured.md` — the cold-start chain
  measurement (partly superseded, see D-folded-todos item 4).
- `.planning/todos/pending/live-match-updates-swing-and-lossy-merge.md` — the live-merge defect
  family (stale, see item 5).
- `.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md` — how RP became a
  level-2 feature.
- `scripts/measureRpCalibration.ts` — already computes everything deliverable 5 needs. **Both arms
  of any comparison must run through this** (D-11).

### Display decisions already made — do not re-decide
- `.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md` — **the
  calibration display form is settled** (sketch 006, winner C): lead with a sentence, chart is
  supporting evidence, sample count is mandatory, small samples must be flagged. Also: rank-band
  edges are continuous not integer, and mean ± SD was rejected for rank outright.
- `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` — `±` is reserved
  for exactly one SD of full predictive variance; one scale per view, never per row.

### Code the phase rewrites
- `packages/core/rankingPoints/distribution.ts` — `rpPmfForMatch`, the Monte Carlo being replaced.
- `packages/core/rankingPoints/empiricalMoments.ts` — the diagonal block and zero cross-covariance
  that make the closed form exact.
- `packages/core/rankingPoints/moments.ts` — the `AllianceRpMoments` contract.
- `packages/core/rankingPoints/{2016..2026}.ts` + `rules.ts` + `constants.ts` — the ten season
  modules and their dispatch.
- `packages/harness/sigmaScoutLayer.ts` — where RP is attached; note it now also hosts Sigma Score.
- `packages/harness/preSchedule.ts`, `packages/harness/scheduleTemplates.ts` — sidecar builder and
  the licensed template reader.
- `apps/worker/src/scheduled.ts` — `buildEventMatchRow` (D-21).
- `packages/harness/stateSnapshot.ts` — state shapes; `rpBeliefs` at line 357 is retired VPR's.
- `packages/core/algorithms/simulation/rankSimulation.ts` — the rank MC (D-15).
- `packages/harness/rpConservativeBranch.ts` — must keep working against the new declarative
  contract.

</canonical_refs>

<code_context>
## Existing Code Insights

### The seven bonus mechanisms — all verified closed-form
Every bonus 2016–2026 reduces to conjunctions of one-sided comparisons over independent variables:

| Mechanism | Seasons | Closed form |
|---|---|---|
| Single variable `≥`/`≤` T | most | One CDF evaluation |
| Linear combination `≥` T | 2016 `capture`, 2017 both, 2023 `sustainability` | One CDF (sum of independents) |
| Conjunction across *distinct* variables | 2018 `autoQuest`, 2024 `ensemble`, 2025 `auto`/`coral` | Product |
| **Nested thresholds on the SAME variable** | 2026 `energized`/`supercharged` | Interval probabilities — **must not be treated as independent** |
| Count-of-indicators `≥ k` | 2016 `breach` | Poisson-binomial convolution |
| Data-dependent threshold | 2022 `cargoBonus` (quintet switches the bar) | Two-branch mixture |
| Always-false / omitted | 2019 `completeRocket`, 2020 `shieldEnergized` | Constant |

`maxRp === winRp + bonusCount` in **every** season and each bonus is worth exactly 1 RP, so the
`Math.min(maxRp, …)` cap is a no-op and the convolution needs no mass folding.

### Reusable assets
- `scripts/measureRpCalibration.ts` — the scorecard's whole computation already exists; deliverable
  5 is wiring, not new measurement.
- `RpThresholdVariable.unit` (`"count"` / `"points"`) — the natural neighbour for D-02's family
  declaration.
- `predictThresholds` — stays as the public surface, reimplemented *from* the declarations, so
  `rpConservativeBranch.ts` and existing equivalence tests keep working unchanged.
- Bootstrap machinery (`paired-contrast`, `recount-and-bootstrap` under `.planning/quick/`) —
  available if the effect-size bar is ever revisited.

### Established patterns that constrain this phase
- **Predict-before-update**, enforced at both levels (`replay.ts:150-159`;
  `SigmaScoutLayer.foldPlayed` reads then folds). Must survive.
- **Season rules are data entry, not branches** — `rules.ts` dispatches with no conditionals.
  D-02's declaration must follow that.
- **One write path for level-2 fields.** `sigmaScoutLayer.ts` exists because bands and RP were once
  added to `publishSeasons`'s loop only and `--event` silently stripped them. Adding a field in a
  caller's loop is the bug the module was extracted to prevent — and D-21 is the third instance of
  that same shape, in the Worker.
- **Seed first, deploy second** for state-shape bumps (D-21).
- **Artifacts before manifest** on publish.

### Integration points
- `analyticRpPmf` replaces `rpPmfForMatch` behind the same call site in `#rpFieldsFor`.
- The RP layer config (D-05) must reach both `publishSeasons` and `runEventMode`.
- Browser: `preSchedule.ts`'s pricing moves client-side (D-08 makes it importable).

</code_context>

<specifics>
## Specific Ideas

- The developer's framing of the pre-schedule problem, which drove D-16: *"I feel like there should
  be a better way than simulate X competitions Y times."*
- On self-generated schedules (D-17 rung 2): *"lets investigate if we can easily randomly generate
  schedules ourselves, that give similar final results as chesy arena?"* — the measurement question
  is whether the balanced-grid structure matters to final rank bands or is merely tradition.
- **BPR/SPR rename in flight.** Some spots now read `SPR`. The developer's instruction: treat every
  `SPR` as `BPR` and continue; another agent finishes the rename separately. **This phase must not
  touch the rename**, and must not be confused by encountering either name.

</specifics>

<deferred>
## Deferred Ideas

- **Dependence between threshold variables** (audit F4). The diagonal block discards a measured
  +0.0391 of real dependence; the model's implied `P(both)` is 0.0222 against an observed 0.1179.
  Bivariate dependence has a closed form, but 2025 `coralBonus`'s four levels would need Genz
  quadrature. Deliberately out of scope — and note the analytic form makes this *harder* to add
  later, which is a cost accepted knowingly.
- **2019 `completeRocket`** (F12) — still hardcoded `false` at `2019.ts:162`, predicted 0.0000
  against an observed 5.15%. Old season, low priority.
- **2022 `cargoBonus`'s independence flaw** — `autoCargoTotal` and `matchCargoTotal` are treated as
  independent when auto cargo is presumably *part of* match cargo.
- **Bonus dot threshold** (F10) — `PREDICTED_BONUS_THRESHOLD = 0.5` means under 2.6% of 2025
  `autoBonus` dots can render solid for a bonus earned 65.94% of the time. Deliverable 4 fixes the
  upstream probabilities; whether the dot *display* should change is a separate UI decision and was
  offered but not taken up.
- **OPR and EPA's cold-start gate** — fixed for BPR by Sigma Score, still live for the other two.
- **Splitting the pre-schedule redesign into its own phase** — offered and declined (D-18). If
  Phase 9 proves too large in planning, this is the natural fault line.

### Reviewed Todos (not folded)
- `swing-score-audit.md` — its own body of work; F6 and F8 depend on the Swing/Sigma band but this
  phase does not change it.
- `match-band-calibration-and-the-broken-additivity-identity.md` — band calibration. D-13 reduces
  RP's dependence on the band, but the band's own identity problem is separate.
- `republish-for-swing-factor-and-band.md` — already DONE (generation `40e7277d`).
- The remaining pending todos (`2017-2019-deficit-diagnosis`, `2018-anti-additivity-treatment`,
  `algorithm-identity-sweep-reads-all-of-data`, `event-mode-replays-cold-and-writes-different-numbers`,
  `flaky-seasonparamsets-equivalence-gate`, `prequalified-backfill-2016-2019`,
  `remove-swing-from-sigma1-core`, `season-final-metric-is-not-what-any-page-shows`) matched only on
  generic keywords and are unrelated to RP.

</deferred>

<approvals>

## Standing authorization for the four one-way checkpoints

**Granted by Jacob (the developer), 2026-09-11, in response to the post-planning status summary.**
Verbatim: *"spending through 2026, Approved! D1 work approved, deleting schedule generation approved,
R2 delete approved"*.

This is durable, pre-measurement authorization. The four `checkpoint:decision` tasks below are
**pre-authorized to proceed without re-asking**. They still run — each presents its measured briefing
for the record — but an approved branch does not block on a human.

| Plan | Task | Authorized act |
|---|---|---|
| 09-06 | Task 3 | Spending the 2023-2026 reporting slice (D-04). The accept/revert verdict itself remains the **pre-committed** `evaluateD09Bar` / `decideRpShipConfig` rule, which was frozen in its own commit before any measurement code existed. Authorization covers the spend, not the verdict — the rule decides the verdict. |
| 09-08 | Task 4 | The D1 seed-then-deploy pair at state shape 12 to 13, seed-first and deploy-second (D-21). |
| 09-09 | Task 4 | The **SHIP branch only** — deleting schedule generation and promoting the field-averaged sidecar (D-16, Delta B to `promote`). |
| 09-10 | Task 4 | Overwriting and deleting published R2 presim sidecars, including the orphaned `vpr`-keyed objects (D-20, Delta A to `promote`). |

### Two branches this authorization does NOT cover — still stop and ask

1. **09-09 NO-SHIP.** The approval is for deleting schedule generation, which is the SHIP branch and is
   conditional on rung 1 **meeting** the acceptance criterion. If the measurement **fails** the
   criterion, deleting is the wrong act: Delta B degrades to `no-change`, concrete schedules stay
   primary, the ladder advances to rung 2, and **D-19's schedule-template redistribution licensing
   becomes live**. That licensing judgement is explicitly the developer's and was never delegated.
   **Stop and report the measured table.**
2. **09-10 payload-budget overrun.** The `compare` page kind's 20,000-byte ceiling has a pre-committed
   disposition (shrink the block, never raise the budget) and needs no ask. The `event` kind's
   350,000-byte ceiling is **stop-and-report** in `payloadBudget.test.ts`'s own words. If the
   pre-write `--dry-run` rehearsal shows an event-kind overrun, **stop before the R2 write.**

Nothing here authorizes work outside Phase 9's scope fence, and the out-of-scope list (F4, F12, 2022
`cargoBonus`, F13, F8/F9's cold-start gate, the F10 display threshold) is unchanged.


### Checkpoint resolution — 09-09 rung 1: NO-SHIP

**Decided by Jacob, 2026-09-11**, on the measured table, not a projection.

Rung 1 **failed** the pre-committed acceptance criterion: 32.8% of 244 teams within 0.5 median
ranks against a bar of >= 95%, and band edges at 55.7% (p10) / 52.0% (p90) against >= 90%. Clause 3
(no systematic shift) passed at -0.0465 ranks. Worst single team `frc11269` at `2026joh`, 7.59 ranks.

**Decision: `no-ship`.** Concrete schedules remain primary. Delta B is recorded `no-change`. The
field-averaged predictor, its schema, its builders and `docs/models/field-averaged-presim.md` stay
committed but **unwired** — they are the baseline rung 2 is scored against, not discarded work.
Rung 1's measured size win (51.6x-79.5x smaller; 1,014-5,393 bytes against 52,351-410,707) was real
and is not what failed.

**Two consequences, both now open:**

1. **D-19 is LIVE.** Advancing the ladder to rung 2 (self-generated random schedules) makes the
   schedule-template redistribution **licensing** question live for the first time. `09-CONTEXT.md`
   is explicit that this judgement is the developer's, not an agent's. No licence file has been read,
   quoted, or reasoned about by any agent in this phase. **This is Jacob's to decide before rung 2
   is planned.**
2. **The acceptance criterion must be restated together with the draw count — decided 2026-09-11.**
   The executor's same-arm seed-noise control found the **incumbent baked path agrees with itself
   only 68.4% of the time within half a rank** across two seeds at 1,000 draws. The bar as written is
   therefore unreachable by **any** method at that draw count, including the method currently
   shipping. A tolerance expressed in rank units is only meaningful relative to the simulation's own
   noise floor, so **rung 2's bar and its draw count must be fixed together**, before rung 2 runs.
   Rung 1 was nonetheless worse than pure seed noise on all six events, so the no-ship decision does
   not rest on the mis-specified bar.

Named suspect for rung 2, measured not assumed: assumption A-FA1's residual is exactly **zero** on
`2023gaalb` (where rung 1 does best) and mean **40.14** / sd **24.74** / max **148.21** on `2026joh`
(where it does worst). The additive constant cancels as A-FA1 says; its standard deviation does not.


### Production window — EXECUTED 2026-09-11, generation `b23d214d-9af0-48f5-a907-3903c2d06f44`

**The hold below was lifted by the developer once the EPA workstream settled** (its gap was priced
at −0.26 pp and its backlog closed negative). The window ran end to end.

| Step | Result |
|---|---|
| Publish (~41 min) | 108,820 objects, **641 presim sidecars** (first run with presim on since the `9999` sentinel), all five page kinds under ceiling, no ceiling moved |
| Manifest | opr 4.0.0 / **epa 10.0.0** / bpr 3.0.0, read-back verified |
| Content verification | `rpCalibration` live in compare slices; a 2026 event row carries all five RP fields plus top-level `rpOutcomeRp` — **09-07's window is closed** |
| `verify:subset` | 50 entries, **0 failing**, uniformity 1 |
| Budget | transcribed by hand; `payloadBudget.test.ts` green |
| D1 seed → Worker deploy | 66,284 rows; Worker `404d2fec`; **four shape bumps closed at once (11→15)** |
| `vpr` sidecar delete | 318 keys, post-census **0 of 60**, orphan 404s and replacement 200s |
| Methodology page | republished warm; 2022 −2.39 pp → **−0.18 pp** |
| D-12 | **green** — level-1 output byte-identical across the whole phase |

**Two things deliberately NOT done, both recorded rather than silently skipped:**

1. **`epa@7.0.0+baseline` is orphaned and was not deleted.** The 2026-09-11 approval covered
   Phase 9's presim sidecars; retiring an EPA generation was a separate question and was never
   authorized. ~36,000 objects remain, costing only storage against the 10 GB free tier. R2 now
   holds exactly one orphaned generation.
2. **The Worker's shape-15 path is not yet exercised.** `live-windows.json` reads `windows: []` —
   no live events in September — so the tick returns before reading a league row, and `wrangler
   tail` logged nothing across several cron ticks. A `LeagueRowShapeVersionError` could not have
   surfaced either way. This and the sustained `cpuTime` budget remain `09-VALIDATION.md`'s
   manual-only verification and **close during a real event, not here.**

The Sigma-seed fix is proven in production data, not only in tests: D1 read-back shows `bpr`
carrying `sigmascoutSigma` ×3,751 and `sigmascoutSigmaPopulation` ×1, with `epa`/`opr` carrying
neither (correctly absent, not empty — only `bpr` is a `SIGMA_SCORE_ALGORITHM_IDS` member) and the
retired VPR `rpBeliefs` key on none.

---

### Production window — HELD, 2026-09-11

**Decided by Jacob after the 09-10 dry run.** All ten plans' code is complete, committed and green.
**Nothing has been published.** Phase 9 is code-complete and deliberately unpublished.

**Why the hold.** The dry run found the republish is no longer an overwrite-in-place. A concurrent
session's quick tasks moved EPA **7.0.0 -> 10.0.0** in this shared checkout (`3f36e582`,
`57cef7a7`), so a republish today would:

1. **ship that other workstream's EPA model change to production** alongside Phase 9's RP layer, and
2. **write-new roughly 36,000 objects**, orphaning the live `epa@7.0.0+baseline` generation.

The 2026-09-11 approval covers Phase 9's presim sidecars and says nothing about an EPA generation,
which was not a question when it was given. **Decision: hold the republish until the EPA workstream
is at a version Jacob actually wants live**, then do one deliberate pass that ships both.

**What the dry run measured (no projections):** `compare` **15,264 / 20,000** (the 189-byte headroom
warning from 09-06 does NOT reproduce), `event` **272,530 / 350,000** (+26,476 from 09-07's pmf
arrays) — **no ceiling moved and no event-kind overrun**, so the stop-and-report branch on payload
budget did not fire. `presim: count=641` across all three published ids.

**Still outstanding, all network-bound, none started:**

- The republish itself (~45 min, **artifacts before manifest, always** — for `epa` a premature
  manifest would advertise 10.0.0 while no 10.0.0 object exists: a 404 on every EPA page site-wide)
- The D1 seed and Worker deploy (**seed first, deploy second**). Live D1 and the deployed Worker are
  at **shape 11**; HEAD is at **shape 15** — four bumps outstanding, all closing in one pass.
- `docs/publish-budget.md` must be transcribed **by hand** after any republish — `publish:seasons`
  prints the summary but does not write it, and the budget tests stay red until it is transcribed.
- The orphaned `vpr` presim sidecar delete (pre-authorized)
- The orphaned `epa@7.0.0+baseline` generation delete (**separately authorized — Jacob's, not covered
  by the 2026-09-11 approval**)

Runbooks with exact commands, expected output and content-based verification are in
`09-08-SUMMARY.md` and `09-10-SUMMARY.md` under `## Operational steps for the orchestrator`.
**Verify live surfaces by CONTENT, never by HTTP status.**

**Seed prerequisite — now CLOSED.** Jacob directed that the Sigma Score seed gap be fixed before any
D1 seed. Done: `af09b23d` + `062bb36e` wire `withSigmaBeliefs`/`withSigmaPopulation` into the seed
path (the gap 09-08 filed), proven non-vacuous by three mutations. Without it a seeded Worker would
have cold-started BPR's bands from the flat prior while serving fully-warmed artifacts, with both
sides looking healthy.

</approvals>

---

*Phase: 9-analytic-ranking-points-browser-side-simulation*
*Context gathered: 2026-09-11*
