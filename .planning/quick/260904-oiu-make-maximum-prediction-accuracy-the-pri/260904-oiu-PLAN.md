---
quick_id: 260904-oiu
phase: quick-260904-oiu
slug: make-maximum-prediction-accuracy-the-pri
date: 2026-09-04
type: execute
mode: quick
plan: "01"
wave: 1
worktree: false
autonomous: true
depends_on: []
requirements: [OBJ-RANK, OBJ-BAR, OBJ-DOCS]
files_modified:
  - packages/core/scoring/brier.ts
  - packages/harness/objectiveDefinition.ts
  - packages/harness/tune.ts
  - packages/harness/tune.test.ts
  - packages/harness/acceptance.ts
  - packages/harness/acceptance.test.ts
  - packages/harness/promote.ts
  - .planning/PROJECT.md
  - .planning/STATE.md
  - .claude/CLAUDE.md
  - docs/models/sigma1-sensitivity-screen.md
  - docs/models/sigma1-tuning-results.md

estimate:
  tokens: 70000
  raw_tokens: 140000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "OBJ-RANK: the search comparator MAXIMIZES winner accuracy first. Brier decides only when the two candidates' accuracy difference is inside the noise band; a candidate that is clearly more accurate wins even if its Brier is worse."
    - "OBJ-RANK: the noise band is ONE event-blocked PAIRED-difference standard error of the accuracy delta, produced by `eventBootstrap.ts`'s existing `eventBlockedBootstrap` — not a match-level SE, not a level SE, and not a hand-rolled resampler."
    - "OBJ-RANK: the correctness rule the tuner counts is the SAME exported function `scoreSet` uses, so the tuner's accuracy and the published `winnerAccuracy` cannot drift. Ties are excluded from the denominator and a 0.5 no-call is counted incorrect, exactly as `scoreSet` already does."
    - "OBJ-RANK: `determineWinner` still moves the winner only on a STRICT improvement under the comparator, is deterministic across repeated runs on identical input (fixed bootstrap seed), and still records every exact tie with BOTH candidates' full parameter sets."
    - "OBJ-RANK: how often Brier actually decided a comparison is VISIBLE — the count of noise-band-resolved comparisons is returned by `determineWinner` and recorded in the search artifact, rather than being invisible inside the comparator."
    - "OBJ-BAR: D-T7's ship/don't-ship bar is on out-of-sample ACCURACY — the challenger must beat the incumbent by `sqrt(2 ln N) x SE_paired(accuracy delta)`."
    - "OBJ-BAR: Brier is a GUARDRAIL VETO with the MAE veto's two-half structure (distinguishable from noise AND materially worse), with its own named, justified tolerance constants, reported as a distinct `brier-veto` reason."
    - "OBJ-BAR: the MAE veto's logic, constants and reported reason string are unchanged, and a candidate that trips both vetoes still reports `mae-veto` — the ten already-recorded verdicts' vocabulary does not shift underneath them."
    - "OBJ-BAR: `keep-incumbent` is still a calmly-reported SUCCESS. `decideAcceptance` never throws for a non-accepting comparison, the joint stage still exits 0 for every outcome, and the shared verdict prefix stays SIGN-NEUTRAL (carrying forward quick task 260904-4ik's fix)."
    - "OBJ-DOCS: the sensitivity screen's survival test stays Brier-based, and the reason (Brier is strictly more sensitive, so it catches every accuracy-relevant knob) is stated where the screen objective is described — in the code and in `docs/models/sigma1-sensitivity-screen.md`."
    - "OBJ-DOCS: no stale objective prose survives in `packages/`. Every doc comment, artifact string and provenance string that described the search objective as Brier-minimized now describes the accuracy-primary rule."
    - "OBJ-DOCS: `.planning/PROJECT.md`'s Core Value states the accuracy-primary / Brier-secondary rule, and the two places that mirror that sentence agree with it."
    - "SCOPE: NO tuning run is executed. No promoted version file, no prediction digest, no baseline fingerprint, and no `reports/` artifact is regenerated or edited by this task."
    - "SCOPE: historical measurement records are NOT retro-edited. Where an existing document's figures were produced under the retired Brier bar, a dated forward note is ADDED saying so."
  artifacts:
    - "packages/core/scoring/brier.ts — one exported correctness predicate, used by `scoreSet` and by the tuner"
    - "packages/harness/objectiveDefinition.ts — the shared search/screen objective sentences, imported by both `tune.ts` and `promote.ts`"
    - "packages/harness/tune.ts — structured objective, per-event accuracy blocks, paired accuracy-delta SE, noise-band comparator, rewired `determineWinner` / refinement / screen / artifacts / acceptance path"
    - "packages/harness/acceptance.ts — accuracy bar, Brier guardrail veto, `brier-veto` reason, unchanged MAE veto"
    - "packages/harness/tune.test.ts and packages/harness/acceptance.test.ts — coverage for the comparator, the band, and all four acceptance outcomes"
    - ".planning/PROJECT.md — Core Value rewritten"
    - "docs/models/sigma1-sensitivity-screen.md and docs/models/sigma1-tuning-results.md — dated notes"
  key_links:
    - "`scoreSet`'s correctness predicate -> the tuner's accuracy blocks. This is where objective drift between the published number and the searched number is structurally closed; a private re-derivation in `tune.ts` re-opens it."
    - "accuracy blocks -> `eventBlockedBootstrap` -> noise band -> `compareCandidates` -> `determineWinner`. Break any link and the search silently reverts to chasing unmeasurable accuracy blips."
    - "`buildPairedOriginUnits` -> paired accuracy-delta SE -> `decideAcceptance`'s bar. An unpaired or mismatched-denominator comparison produces a meaningless SE that the ship/don't-ship bar would then be built on."
    - "`objectiveDefinition.ts`'s exported sentence -> `tune.ts`'s artifact `objective:` field AND `promote.ts`'s `provenance.objectiveDefinition`. One string, two writers — a second literal is how a promoted file starts describing a rule that no longer exists."
---

<objective>
Flip the VPR (Sigma1) tuning objective so that WINNER ACCURACY is primary and Brier is
secondary, at both stages where the objective is applied: the search ranking
(`tune.ts`) and D-T7's ship/don't-ship bar (`acceptance.ts`).

Purpose: the project's stated goal is the best FRC match predictor, and accuracy is the
number a user judges that by. Today the tuner minimizes mean tune-season Brier and records
`winnerAccuracy` without ever reading it, so the search optimizes a proxy. The user's locked
decision is a NOISE-BAND LEXICOGRAPHIC rule: maximize accuracy, and when two candidates'
accuracy cannot be separated from statistical noise, let lower Brier decide. That prevents
chasing a two-matches-out-of-48,000 blip while calibration quietly worsens.

Output: a comparator-based search ranking, an accuracy-based D-T7 bar with a new Brier
guardrail veto, updated tests for both, and docs that say what the code does.

NOT in scope: running any tuning. This changes the machinery only. A re-tune under the new
objective is a separate, deliberately-scheduled run measured in hours of compute.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260904-oiu-make-maximum-prediction-accuracy-the-pri/260904-oiu-CONTEXT.md
@.claude/CLAUDE.md

Read these BEFORE editing. They are the load-bearing prior art:

- `packages/harness/eventBootstrap.ts` — read the whole header. The LEVEL vs PAIRED-DIFFERENCE
  distinction in that header is the single idea this task reuses; `eventBlockedBootstrap` is
  taken as-is and is NOT modified.
- `packages/harness/acceptance.ts` — the whole file. Its header states the `keep-incumbent`-is-a-
  success contract and the MAE veto's two-half rationale; both survive this change verbatim in
  spirit.
- `packages/core/scoring/brier.ts` lines 92-133 — `scoreSet`. The exact accuracy rule (ties out
  of the denominator, 0.5 no-call counted incorrect) lives here and must not be re-derived.
- `packages/harness/score.ts` lines 340-400 — `aggregateScores`' four exclusions, in order:
  offseason, surrogate-affected, null winner, `!isValidPRedWin`. The tuner's accuracy blocks
  must apply exactly these and no others.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The noise-band comparator, wired end to end through the search</name>
  <files>packages/core/scoring/brier.ts, packages/harness/objectiveDefinition.ts, packages/harness/tune.ts, packages/harness/tune.test.ts, packages/harness/promote.ts</files>
  <read_first>
    - `packages/core/scoring/brier.ts` lines 92-133 (`scoreSet`) and `packages/core/scoring/brier.test.ts`
    - `packages/harness/tune.ts` lines 480-560 (prediction shape, `PerSeasonScore`, `EvaluatedCandidate`, `objectiveForCandidate`), 596-672 (`evaluateCandidateBatch`, `evaluateAll`, `TieRecord`, `determineWinner`), 703-740 (tracer stage + its artifact), 855-915 (screen stage + its artifact), 1195-1250 (joint search, refinement pass, winner logging), 1322-1372 (`buildJointArtifact`)
    - `packages/harness/eventBootstrap.ts` in full
    - `packages/harness/promote.ts` lines 150-210 (provenance schema, incl. `objective` and `objectiveDefinition`), 320-340 (`TuneSearchOutputMinimalSchema`), 660-690 and 800-835 (both sites that copy a search winner's `objective` into a promoted file)
  </read_first>
  <behavior>
    Tests to write in `tune.test.ts` BEFORE the wiring, replacing the retired
    "the objective ignores winner accuracy" describe block:
    - A candidate whose accuracy is higher by clearly more than the band beats a candidate with
      better (lower) Brier. Accuracy is primary.
    - Two candidates whose accuracy differs by clearly less than the band are accuracy-tied, and
      the LOWER-Brier one wins. `decidedBy` reports `brier`.
    - The sign is right in both directions: swapping the two candidates swaps the answer.
    - Identical accuracy AND identical Brier is an exact tie: the earlier-generated candidate
      keeps the win and the tie is recorded with both full parameter sets.
    - `determineWinner` is deterministic — the same input array compared twice gives the same
      winner index, the same tie list, and the same noise-band-resolved count.
    - Accuracy derived from the per-event blocks equals `scoreSet`'s `winnerAccuracy` on the same
      fixture, including a fixture containing a tie match and a 0.5 no-call. This is the
      anti-drift test; it must fail if the tuner ever re-derives the correctness rule locally.
    - The band computed for two block sets equals `eventBlockedBootstrap`'s standard error for the
      same paired statistic at the same seed — i.e. the band IS the paired SE, not a rescaling.
    - `brier.test.ts` passes UNCHANGED after the predicate extraction.
  </behavior>
  <action>
    Five moves, in this order.

    **1. Extract the correctness rule so it cannot be re-derived.** In
    `packages/core/scoring/brier.ts`, export a pure predicate that answers, for one prediction,
    whether it is in the accuracy denominator at all and whether the call was right — return
    `null` for a match excluded from the denominator (an actual tie), `true` for a correct strict
    call, `false` otherwise (including a 0.5 no-call, which is counted wrong today and stays
    counted wrong). Refactor `scoreSet`'s accuracy branch to call it, keeping its existing
    behavior byte-identical and its existing explanatory comment about not silently crediting an
    abstention. Do not change `scoreSet`'s signature or return shape.

    **2. Give the tuner a structured objective and per-event accuracy blocks.** In `tune.ts`:
    - Replace `EvaluatedCandidate.objective: number` with two named numbers,
      `accuracyObjective` (mean per-season winner accuracy over the run's seasons, MAXIMIZED,
      `Number.NEGATIVE_INFINITY` when no season scored) and `brierObjective` (the existing mean
      per-season Brier, MINIMIZED, `Number.POSITIVE_INFINITY` when no season scored). Rewrite the
      field's doc comment: the retired one asserts accuracy is recorded but never read, and
      leaving that sentence in place is exactly the stale-comment pattern this project's failure
      log names. `objectiveForCandidate` returns both, derived from the same `combined`-view
      slices it reads today.
    - Add an exported per-event block record carrying `eventKey`, `season`, the count of correct
      calls and the accuracy DENOMINATOR (non-tie scorable matches) — the minimum sufficient
      statistic for a paired accuracy-delta bootstrap, since the per-event difference of two
      candidates' correct-counts over the shared denominator is exactly the block sum of the
      per-match paired difference. Add an exported builder that produces it from the replayed
      predictions for one candidate id.
    - The builder must apply the FOUR exclusions `aggregateScores` applies, in that order. Extract
      that filter into one exported predicate in `tune.ts` and make `scoreOriginRows` use it too,
      so the two populations cannot diverge.
    - Carry the blocks on `EvaluatedCandidate`. Build them in `evaluateCandidateBatch`, which
      already holds the raw predictions.

    **3. Compute the band and compare.** Add an exported function returning the event-blocked
    PAIRED-difference standard error of the accuracy delta between two block sets, by calling
    `eventBlockedBootstrap` on units that are one-per-event aggregates. Pair the two sets by
    `eventKey` and refuse a mismatch by name, for the reason `buildPairedOriginUnits` already
    gives. The resampled statistic must mirror the accuracy objective's own shape — per-season
    accuracy from the drawn blocks, then the mean over seasons that have a positive denominator
    in that draw — so the SE is an SE OF THE OBJECTIVE rather than of a differently-defined
    quantity. Note in a doc comment that because each unit is already an event aggregate, the
    returned result's `matchCount` equals its block count and ONLY `standardError` is consumed.
    Then add an exported comparator taking two candidates and returning which one wins plus the
    accuracy delta, the band, and which axis decided (`accuracy`, `brier`, or `exact-tie`).
    The rule: when the absolute accuracy delta EXCEEDS the band, the higher-accuracy candidate
    wins; otherwise the lower `brierObjective` wins; otherwise exact tie. Leave
    `eventBlockedBootstrap`'s default seed in place so repeated comparisons are reproducible —
    a seed derived from a candidate index or a clock would make `determineWinner` non-deterministic
    and is forbidden.

    **4. Rewire every ranking site.** `determineWinner` compares in generation order and moves the
    winner ONLY when the comparator says the current candidate strictly wins, preserving today's
    earlier-generation-wins-on-ties discipline; it records exact ties as it does today (extend
    `TieRecord` to carry both objectives instead of the single retired number) and additionally
    returns how many comparisons were resolved inside the band by Brier. The joint stage's
    coordinate-descent refinement pass currently advances its anchor on a raw numeric comparison —
    route it through the comparator so the refinement and the ranking cannot disagree. The screen
    stage reads the Brier component explicitly. Update the per-candidate console lines to print
    both objectives.

    **5. One objective sentence, two writers.** Create `packages/harness/objectiveDefinition.ts`
    as a leaf module (no imports) exporting the search objective sentence and the screen objective
    sentence. The search sentence states the accuracy-primary rule, names the noise band as one
    event-blocked paired-difference SE, and says Brier is the within-band tie-break. The screen
    sentence states that the screen deliberately keeps the Brier objective, and why: Brier is
    strictly more sensitive than accuracy, so it catches every accuracy-relevant knob — a screen
    re-based on accuracy would see FEWER parameters, not more. Import that module from `tune.ts`
    (tracer, screen and joint artifacts all use it) and from `promote.ts`, whose hardcoded
    `objectiveDefinition` literal must become the imported constant. `tune.ts` already imports
    `promote.ts`, so the constants must NOT live in `tune.ts` — that direction is a cycle.

    Keep the search artifact's per-candidate rows carrying a numeric `objective` key set to the
    PRIMARY objective's value, because `promote.ts` copies it into `provenance.objective`, which
    its schema types as a number and which existing committed version files already carry. Add a
    doc comment at that schema field recording that the quantity it holds changed with this task
    and that `objectiveDefinition` is the field that says which quantity a given file's number is.
    Explicitly destructure the accuracy blocks OUT of the artifact rows — they are per-event
    arrays and would bloat every search artifact for no reader.
  </action>
  <verify>
    <automated>cd "c:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run packages/harness packages/core/scoring && npx tsc --noEmit</automated>
  </verify>
  <done>
    The comparator ranks accuracy first and falls back to Brier only inside the band; the band is
    `eventBlockedBootstrap`'s paired SE; the tuner's correctness rule is `scoreSet`'s own; every
    ranking site in `tune.ts` routes through the comparator; the objective sentence has exactly one
    definition site imported by both writers; `packages/harness` and `packages/core/scoring` tests
    pass and `tsc --noEmit` is clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: D-T7 — accuracy bar, Brier guardrail veto</name>
  <files>packages/harness/acceptance.ts, packages/harness/acceptance.test.ts, packages/harness/tune.ts, packages/harness/tune.test.ts</files>
  <read_first>
    - `packages/harness/acceptance.ts` in full (176 lines) — especially the header's two-condition
      asymmetry section and the evaluation-order/precedence section
    - `packages/harness/acceptance.test.ts` in full (132 lines)
    - `packages/harness/tune.ts` lines 1400-1441 (`PairedOriginUnit`, `OriginScoredRow`,
      `scoreOriginRows`), 1442-1485 (`buildPairedOriginUnits`), 1512-1620
      (`OriginAcceptanceReport`, `buildAcceptanceReport` and its three verdict branches),
      1673-1741 (`evaluateOriginSeason` and its three bootstrap calls)
    - `packages/harness/tune.test.ts` lines 359-483 (the paired-units and acceptance-report suites)
    - `.planning/quick/260904-4ik-fix-the-acceptance-report-wording-bug-an/260904-4ik-SUMMARY.md`
      — the sign-neutral-prefix fix this task must not regress
  </read_first>
  <behavior>
    Tests in `acceptance.test.ts`, extending the existing base-input pattern:
    - Accepts a challenger whose accuracy beats the incumbent by comfortably more than the bar,
      with Brier and MAE unchanged.
    - Accepts a challenger that is clearly more accurate even though its Brier is slightly WORSE —
      inside the guardrail. This is the whole point of the change and must be an explicit test.
    - Returns `keep-incumbent` / `below-threshold`, without throwing, for a positive but sub-bar
      accuracy margin.
    - Returns `keep-incumbent` / `brier-veto` for an accuracy win that ships a Brier regression
      clearing BOTH halves of the guardrail.
    - Does NOT veto a Brier move that fails the noise half only, and does NOT veto one that fails
      the materiality half only — two tests, proving both halves are load-bearing, mirroring the
      pair that already exists for MAE.
    - Never vetoes a challenger that IMPROVES Brier.
    - Precedence: a challenger that fails the bar AND regresses Brier reports `below-threshold`.
    - Precedence: a challenger that clears the bar and trips BOTH vetoes reports `mae-veto`.
    - The MAE tests already in the file still pass with only their new required input fields added.
    In `tune.test.ts`: `buildAcceptanceReport` emits all FOUR outcomes with a grammatical verdict
    sentence, and the shared prefix reports a NEGATIVE accuracy margin without claiming a win.
  </behavior>
  <action>
    **`acceptance.ts`.** `AcceptanceInput` gains `incumbentAccuracy`, `candidateAccuracy` and
    `accuracyStandardError` (the event-blocked PAIRED-difference SE of the accuracy delta) and
    keeps everything it has. `acceptanceThreshold` is unchanged — the union bound is the same
    formula applied to a different SE.

    The bar becomes accuracy: rename the evidence field to `accuracyMargin`, defined as
    `candidateAccuracy - incumbentAccuracy`, POSITIVE meaning better, and note the sign flip
    relative to the retired Brier margin explicitly in its doc comment, since the retired field
    was `incumbent - candidate`. Renaming rather than redefining in place is deliberate: it forces
    every reader of the old field to be revisited by the compiler instead of silently reading a
    number whose meaning inverted.

    Add the Brier guardrail with the MAE veto's exact two-half shape: two named exported
    constants, a relative tolerance and a noise multiple, each carrying a doc comment that states
    and justifies its value the way `ACCEPTANCE_MAE_RELATIVE_TOLERANCE` does. Mirror MAE's values
    (1% relative, 2 SEs) and justify the relative half concretely: on a Brier around 0.17 that is
    about 0.0017, roughly half the N=60 acceptance bar — so a challenger may pay up to about half
    a bar's worth of calibration for its accuracy win, and no more. The veto fires when the Brier
    delta (`candidateBrier - incumbentBrier`, POSITIVE meaning worse) exceeds the noise bound AND
    reaches the relative bound, keeping both halves as separately-named booleans exactly as the
    MAE code does. Evidence gains `brierDelta` and `brierVetoBound`.

    Extend `KeepIncumbentReason` with a third value for the Brier veto. Precedence: the bar first
    (an ineligible challenger reports `below-threshold`, because the vetoes were moot for it),
    then the MAE veto, then the Brier veto — MAE first so a challenger that trips both still
    reports what it reports today and the recorded verdict vocabulary does not shift underneath
    results already written down. State that ordering and its reason in the header's precedence
    section, and rewrite the header's "two conditions" section into three, with Brier moved from
    single objective to guardrail. The `keep-incumbent`-is-a-success contract at the top of the
    file is unchanged and must survive the rewrite intact.

    **`tune.ts` acceptance path.** `PairedOriginUnit` gains, per match, both models' correct-call
    indicators and the shared accuracy denominator (0 for a tie, 1 otherwise) — computed with the
    predicate Task 1 exported from `brier.ts`, never a local re-derivation. `scoreOriginRows`
    produces them. `buildPairedOriginUnits` carries them and asserts the two rows' denominators
    agree for each paired match, refusing a mismatch by name for the same reason it already
    refuses a match-set mismatch. `evaluateOriginSeason` adds a fourth `eventBlockedBootstrap`
    call for the paired accuracy delta — resampled statistic is the difference of the two summed
    correct-counts over the summed denominator; throw by name if a resample's denominator is zero
    rather than returning `NaN`. `OriginAcceptanceReport` gains the two accuracy levels and the
    accuracy-delta SE, keeping both existing Brier SEs under their current unconfusable names.

    Rewrite `buildAcceptanceReport`'s verdict for four branches. Carry forward 260904-4ik's two
    hard-won constraints: the shared prefix stays SIGN-NEUTRAL — it reports the signed accuracy
    margin and claims no side, because the margin is negative for a genuinely worse candidate —
    and the prefix's trailing clause about the bar remains load-bearing grammar for the veto
    branches that concatenate onto it. After editing, read all four concatenations end to end as
    English. The Brier-veto sentence must name the number, the bound and the fact that the bar was
    cleared, and must say plainly that a challenger more accurate but materially worse-calibrated
    is not shipped.

    Do NOT touch: the MAE veto's logic or constants, `acceptanceThreshold`, `evaluationCountForBar`,
    `loadIncumbent`, `INCUMBENT_VERSION_PATH` and its do-not-move comment, the four D-T5 leak
    gates, gate 4's write-before-origin-evaluation ordering, or the exit-0-for-every-outcome
    comment block.
  </action>
  <verify>
    <automated>cd "c:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run packages/harness packages/core/scoring && npx tsc --noEmit</automated>
  </verify>
  <done>
    `decideAcceptance` gates on accuracy with a two-half Brier guardrail and a distinct third
    keep-incumbent reason; MAE behavior and reason string are unchanged; all four outcomes are
    covered by tests including the accept-despite-slightly-worse-Brier case; the verdict prefix is
    still sign-neutral and all four branches read as English; `packages/harness` and
    `packages/core/scoring` tests pass and `tsc --noEmit` is clean.
  </done>
</task>

<task type="auto">
  <name>Task 3: Docs, the stale-objective sweep, and a full-scope test run</name>
  <files>.planning/PROJECT.md, .planning/STATE.md, .claude/CLAUDE.md, docs/models/sigma1-sensitivity-screen.md, docs/models/sigma1-tuning-results.md</files>
  <read_first>
    - `.planning/PROJECT.md` lines 1-20 (What This Is, Core Value)
    - `.planning/STATE.md` lines 19-35 (Project Reference block, which mirrors the Core Value line)
    - `.claude/CLAUDE.md` Project section (which mirrors it again)
    - `docs/models/sigma1-sensitivity-screen.md` lines 20-35 and 110-135 (the screen's stated
      objective and its structurally-invisible-parameters discussion)
    - `docs/models/sigma1-tuning-results.md` lines 1-40 (the existing dated retirement notes —
      copy their form)
  </read_first>
  <action>
    **Core Value.** Rewrite the one sentence in `.planning/PROJECT.md` so the proving instrument
    it names matches the code: walk-forward backtests scored on winner accuracy first, with Brier
    as the secondary tie-break and calibration guardrail. Recommended text, adjustable for flow:
    "Predictions that are *measurably* better than Statbotics — proven by walk-forward backtests
    scored on winner accuracy first and Brier second — delivered on pages that load fast."
    Apply the identical sentence to the two places that mirror it: `.planning/STATE.md`'s Project
    Reference block and `.claude/CLAUDE.md`'s Project section. Three copies of one sentence is the
    pre-existing shape; the requirement here is that all three AGREE, not that they be deduplicated.

    **The screen doc.** In `docs/models/sigma1-sensitivity-screen.md`, add a dated
    (2026-09-04) note at the top of the objective discussion: the search objective has moved to
    accuracy-primary, the SCREEN deliberately keeps the Brier objective, and the reason — Brier is
    strictly more sensitive than accuracy, so a Brier-based screen catches every accuracy-relevant
    knob while an accuracy-based one would surface fewer. Say plainly that the screen's stated
    objective and the joint search's are, from this date, deliberately DIFFERENT, since that
    document currently asserts they are identical and a reader who finds them different without
    explanation would reasonably read it as a bug. Do not restate the objective sentence by hand —
    quote the exported constant by name so a future reader knows where the authoritative wording
    lives.

    **The tuning-results doc.** In `docs/models/sigma1-tuning-results.md`, add one more dated
    (2026-09-04) note in the same form as the two retirement notes already at its head: every
    D-T7 acceptance verdict recorded to date was decided under the retired Brier bar, those
    figures are left exactly as measured, and any future verdict is decided under the accuracy bar
    with the Brier guardrail. Edit NOTHING below the note — that document's convention is that
    measured figures are never retro-fitted to a later scheme, and this task must not be the
    exception.

    **The sweep.** Search `packages/` for any surviving prose that still describes the SEARCH
    objective as a minimized Brier — doc comments, artifact strings, provenance strings, test
    names — and rewrite each to describe the accuracy-primary rule. Legitimate remaining mentions
    of Brier are fine and expected: the screen's objective, the guardrail veto, published scores,
    and historical references that explicitly name themselves as retired. What must not survive is
    a present-tense claim that the search minimizes Brier.

    Record in the SUMMARY that no tuning was run, no promoted version file or fingerprint changed,
    and that a re-tune under the new objective remains an open, deliberately-scheduled item.
  </action>
  <verify>
    <automated>cd "c:/Users/Jacob/Documents/GitHub/SigmaScout" && ! grep -rn "minimized (D-01)" packages/ && ! grep -rn "Brier-scored backtests" .planning/PROJECT.md .planning/STATE.md .claude/CLAUDE.md && grep -c "2026-09-04" docs/models/sigma1-sensitivity-screen.md && npx vitest run && npx tsc --noEmit</automated>
  </verify>
  <done>
    All three copies of the Core Value sentence name accuracy first; both model docs carry a dated
    2026-09-04 note and no historical figure was edited; no present-tense Brier-minimized search
    claim survives in `packages/`; the FULL repo-scope test run and `tsc --noEmit` are both green.
  </done>
  <reversibility rating="costly">
    Redefining the ship/don't-ship bar changes what a future search is allowed to promote, and the
    ten already-recorded D-T7 verdicts were decided under the retired rule. Reverting the code is
    a clean git revert; re-establishing a comparable verdict history is not, which is why the
    docs note is part of this task rather than a follow-up.
  </reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| corpus SQLite -> tuner | Local, read-only (`openCorpusReadOnly`), already-ingested and Zod-validated data. Not crossed by this task — no new read path is added. |
| tuner -> committed artifacts | This task changes what a search artifact and a promoted file's provenance MEAN. No new external input crosses here. |

No network calls, no credentials, no package-manager installs, and no user-supplied input are
introduced. `.env` is not read by any file in scope; the CLAUDE.md secrets-handling rule applies
unchanged and nothing in this task has cause to touch it.

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-oiu-01 | Tampering | `provenance.objective` in promoted version files | medium | mitigate | The number's units change with this task while old committed files keep the retired units. Mitigated by importing one `objectiveDefinition` constant into both writers and documenting the units change at the schema field, so a reader can always tell which quantity a given file holds. |
| T-oiu-02 | Information disclosure | `.env` / credentials | low | accept | No file in scope reads `.env`; the repo-wide secrets-boundary rules and `scripts/secrets-boundary.test.ts` remain in force and are untouched. |
| T-oiu-SC | Tampering | npm/pip/cargo installs | low | accept | This task installs NO packages. Every symbol used already exists in the repo. If an install becomes necessary, stop and route through the package legitimacy gate rather than adding it inline. |
</threat_model>

<verification>
- `npx vitest run` at repo root scope is green (full 167-file scope, not the `apps/web` subset —
  a red suite has hidden in that gap before).
- `npx tsc --noEmit` is clean.
- The comparator's determinism test passes on repeated invocation, proving the bootstrap seed is
  fixed and not derived from candidate order or a clock.
- No file under `data/algorithm-versions/`, `data/baselines/` or `reports/` is modified —
  `git status` shows changes only in the twelve files this plan names.
</verification>

<success_criteria>
- Winner accuracy is the primary tuning objective at BOTH stages: search ranking and the D-T7
  ship/don't-ship bar.
- Brier is secondary at both: the within-band tie-break in the search, a two-half guardrail veto
  at the bar.
- The noise band is a real event-blocked paired-difference standard error from the existing
  bootstrap, not an invented constant.
- The tuner's accuracy definition is structurally identical to the published one.
- The screen stays Brier-based and says why, in the code and in its document.
- Docs and code agree; no stale objective prose survives in `packages/`.
- No tuning was run and no measurement artifact changed.
</success_criteria>

<output>
Create `.planning/quick/260904-oiu-make-maximum-prediction-accuracy-the-pri/260904-oiu-SUMMARY.md` when done.
</output>
</content>
</invoke>
