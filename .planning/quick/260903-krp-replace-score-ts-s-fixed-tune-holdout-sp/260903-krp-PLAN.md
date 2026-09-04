---
quick_id: 260903-krp
phase: quick-260903-krp
slug: replace-score-ts-s-fixed-tune-holdout-sp
date: 2026-09-03
type: execute
mode: quick
plan: "01"
wave: 1
worktree: false
autonomous: true
depends_on: []
source: .planning/quick/260903-krp-replace-score-ts-s-fixed-tune-holdout-sp/260903-krp-CONTEXT.md
requirements: [D-1, D-2, D-3, D-4]
files_modified:
  - packages/harness/score.ts
  - packages/harness/score.test.ts
  - packages/harness/artifact.ts
  - packages/harness/artifact.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/report.ts
  - packages/harness/report.test.ts
  - packages/harness/tune.ts
  - packages/harness/tune.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/promote.ts
  - packages/harness/cli.ts
  - packages/harness/eventScopeDiagnostic.ts
  - packages/harness/eventScopeDiagnostic.test.ts
  - packages/harness/digest.test.ts
  - scripts/reparamEquivalence.ts
  - apps/web/src/lib/api/compare.compat.test.ts
  - apps/web/src/components/compare/MethodologyNote.tsx
  - apps/web/src/components/compare/MethodologyNote.test.tsx

estimate:
  tokens: 55000
  raw_tokens: 110000
  tasks: 4
  confidence: high

must_haves:
  truths:
    - "`aggregateScores` scores a prediction stream containing 2019 and 2020 without throwing. This is the single blocking item the whole task exists to remove (D-1 domain)."
    - "A season's `headlineEligible` is computed from the season set the RUN has in play, counting how many distinct seasons in that set fall strictly before it, against a threshold of two (D-2). No year literal appears in the rule."
    - "On the seven-season corpus (2019, 2020, 2022-2026) the eligible set is exactly {2022, 2023, 2024, 2025, 2026} and the ineligible set is exactly {2019, 2020} (D-3). These are ASSERTED OUTPUTS of the rule, never inputs to it."
    - "`packages/harness/score.ts` exports no `seasonSplit`, no `TUNE_SEASONS`, no `HOLDOUT_SEASONS` and no `SeasonLabel` (D-1). `headlineEligible` survives as the single honest flag."
    - "`CompareArtifactSchema` parses BOTH a committed 5.0.0 fixture that carries `seasonLabel` AND an otherwise-identical object with the key absent (D-4). The live site keeps rendering against today's published artifacts; nothing is republished by this task."
    - "`apps/web/src/routes/__fixtures__/compare-*.json` are byte-identical to their committed state at the end of this task."
    - "`MethodologyNote` reads no `seasonLabel` and renders correct, non-nonsense prose against the five committed 5.0.0 fixtures."
  artifacts:
    - "packages/harness/score.ts — `isHeadlineEligible`, `MIN_PRIOR_SEASONS_FOR_HEADLINE`, `AggregateScoresOptions`"
    - "apps/web/src/lib/api/compare.compat.test.ts — the bidirectional D-4 schema-compatibility guard"
    - "apps/web/src/components/compare/MethodologyNote.tsx — rolling-origin prose with no tune/holdout subject"
  key_links:
    - "`publish.ts:1974` — `aggregateScores` is called INSIDE a per-season loop. It MUST receive `seasonsSorted` (the run's whole season set), not the loop's own `season`. Getting this wrong silently flips every published slice to `headlineEligible: false`."
    - "`apps/web/src/lib/api/compare.ts` imports `CompareArtifactSchema` DIRECTLY from `packages/harness/pageArtifacts.ts` — there is no separate client schema. A required-field change to `CompareSliceSchema` is a live-site change the same commit."
    - "`aggregateScores`' internal guard: every season present in `predictions` must also appear in `corpusSeasons`, or throw. This is what stops a caller narrowing the set it scores against."
---

<!-- planner-discipline-allow: seasonSplit, TUNE_SEASONS, HOLDOUT_SEASONS, SeasonLabel, seasonLabel, holdout, tune -->

<objective>
Replace `score.ts`'s retired fixed tune/holdout split — and the 2022-2026 guard that throws with it —
with origin-based labelling derived from the seasons actually in play, unblocking every scoring path
for 2019 and 2020.

Purpose: `seasonSplit` throws on any season outside 2022-2026, and it is called unconditionally from
`aggregateScores`, which `tune.ts`, `cli.ts`, `promote.ts`, `publish.ts`, `eventScopeDiagnostic.ts`
and `scripts/reparamEquivalence.ts` all depend on. The corpus now holds seven seasons with registered
breakdown and RP modules (quick task 260903-4fs); this guard is the only thing stopping them being
scored, and therefore the only thing blocking `retune-sigma1-rolling-origin` and the whole
promote -> republish -> re-measure chain.

Output: the tune/holdout vocabulary deleted (D-1), `headlineEligible` derived by a corpus-relative
rule (D-2/D-3), and a client that renders correctly against BOTH today's published 5.0.0 artifacts
and the post-republish shape (D-4).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260903-krp-replace-score-ts-s-fixed-tune-holdout-sp/260903-krp-CONTEXT.md
@.claude/CLAUDE.md

@packages/harness/score.ts
@packages/harness/tune.ts
@packages/harness/report.ts
@apps/web/src/components/compare/MethodologyNote.tsx
</context>

<planner_findings>

Read this before Task 1. Every line here was verified against the working tree this session; three of
these findings change what a naive reading of the CONTEXT would produce.

## Finding 1 — THE TRAP. `aggregateScores` cannot derive the rule from its own argument.

`aggregateScores` already computes `const seasons = ...` from `predictions` at `score.ts:174`, which
makes "derive eligibility from the seasons in `predictions`" look free. **It is wrong, and wrong
silently.**

`publish.ts:1974` calls `aggregateScores(harnessPredictions)` from inside
`for (const [seasonIdx, season] of seasonsSorted.entries())` (`publish.ts:1545`), and
`harnessPredictions` is built at `publish.ts:1711` with that loop's `season` hardcoded into every
record. **That call sees exactly one season.** Under a self-derived rule, every season would find
zero priors, every published Compare slice would come out `headlineEligible: false`, every test
would pass, and nothing would announce the regression.

So the season set has to be threaded in. It is available at every call site — see Finding 2.

## Finding 2 — the season set in scope at all eight call sites (verified individually)

| call site | pass as `corpusSeasons` | note |
|---|---|---|
| `publish.ts:1974` | `seasonsSorted` | defined `publish.ts:1508` from `options.seasons`, enclosing the loop. **This is the load-bearing one.** |
| `cli.ts:764` | `seasons` | the enclosing function's own parameter |
| `cli.ts:866` | seasons present in `predictions` | inside `runEventMode(eventKey, algorithms, outDir)` (`cli.ts` ~line 795) — a single-event smoke path with no `seasons` parameter at all. One season by construction. |
| `promote.ts:728` | `[sliceSeason]` | a deliberately bounded single-season slice; the call reads `brierScore`/`winnerAccuracy` only (`promote.ts:729-731`) |
| `tune.ts:562` | `seasons` | `evaluateCandidateBatch`'s own parameter — the batch's replay seasons |
| `tune.ts:1596` | `replaySeasons` | defined `tune.ts:1593` |
| `eventScopeDiagnostic.ts:215` | seasons present in `predictions` | `poolPredictions` pools slices and discards the flag entirely |
| `scripts/reparamEquivalence.ts:310` | `seasons` | in scope; the script loops it again at :311 |

Three of these (`cli.ts:866`, `promote.ts:728`, `eventScopeDiagnostic.ts:215`) genuinely never read
`headlineEligible`. They still have to state a set — that is the point of a required parameter — and
each gets a one-line comment saying the flag is not meaningful on that path, so a later reader does
not mistake the narrow set for a claim.

## Finding 3 — nobody passes `binCount` today

`grep` across the repo found zero callers supplying `aggregateScores`' second positional argument.
The signature is therefore free to change shape without breaking a single existing call.

## Finding 4 — the client has NO separate read schema

`apps/web/src/lib/api/compare.ts:23` imports `CompareArtifactSchema` straight out of
`packages/harness/pageArtifacts.ts`. The harness publish schema **is** the client read schema. A
change to `CompareSliceSchema` reaches the live site in the same commit — this is exactly where D-4
binds.

Two properties make the safe move available: neither `CompareSliceSchema` nor `ScoreSliceSchema` is
`.strict()` (confirmed by grep; `pageArtifacts.ts:56` documents the convention), and Zod strips
unlisted keys rather than rejecting them. So:

- Making `seasonLabel` **optional** keeps both shapes parsing AND keeps the key readable when present.
- **Deleting** it also keeps both shapes parsing, but silently strips the key from the parsed object.

D-4 asks for tolerance, so `CompareSliceSchema` takes `.optional()`. `ScoreSliceSchema` in
`artifact.ts` is internal to the harness report path with no live reader, so it drops the field
outright.

## Finding 5 — the fixtures do not need to move, and must not

`compare-*.json` carry `seasonLabel` and the OLD `headlineEligible` values (2022-2024 false,
2025-2026 true). With `CompareSliceSchema.seasonLabel` optional they keep parsing unchanged, and once
`MethodologyNote` stops reading the field, nothing consumes either value. **No fixture is
regenerated.** Task 3 pins that with `git diff --exit-code`.

## Finding 6 — the surviving consumers, counted

`SEASON_LABEL_TEXT` (`report.ts:32`) and its two-tone styling (`report.ts:81-82`, `:188`, `:264`)
are the only production readers of `seasonLabel` outside the client. `tune.ts:62` and `:340` mention
the retired predicate in PROSE only — there is no live call there, just stale narration to correct.

</planner_findings>

<source_audit>

## Multi-Source Coverage Audit

| # | Source | Item | Covered by |
|---|--------|------|------------|
| 1 | CONTEXT D-1 | Delete `SeasonLabel` / `TUNE_SEASONS` / `HOLDOUT_SEASONS` / `seasonSplit`; keep `headlineEligible` | Task 1 |
| 2 | CONTEXT D-2 | Eligibility = at least two prior seasons among the seasons being scored, never a year list | Task 1 (rule), Task 2 (tests) |
| 3 | CONTEXT D-3 | 2023 becomes eligible; five headline seasons, not two; recorded in a code comment | Task 1 (comment), Task 2 (asserted) |
| 4 | CONTEXT D-4 | Client renders against 5.0.0 AND post-republish shapes | Task 3 (schema + guard), Task 4 (prose) |
| 5 | CONTEXT specifics | `artifact.ts` `ScoreSliceSchema` | Task 1 |
| 6 | CONTEXT specifics | `pageArtifacts.ts` `CompareSliceSchema` | Task 3 |
| 7 | CONTEXT specifics | `report.ts` two-tone styling re-keyed on `headlineEligible` | Task 1 |
| 8 | CONTEXT specifics | `tune.ts:62`/`:340` stale prose corrected | Task 1 |
| 9 | CONTEXT specifics | Fixtures NOT regenerated | Task 3 (`git diff --exit-code` gate) |
| 10 | CONTEXT specifics | No tuning search, publish, promote or full replay | Enforced in `<verification>` |

No MISSING items. No item is deferred.

</source_audit>

<tasks>

<task type="tracer">
  <name>Task 1: Origin-based eligibility, wired through every scoring path end-to-end</name>
  <files>packages/harness/score.ts, packages/harness/score.test.ts, packages/harness/artifact.ts, packages/harness/report.ts, packages/harness/publish.ts, packages/harness/promote.ts, packages/harness/cli.ts, packages/harness/tune.ts, packages/harness/eventScopeDiagnostic.ts, scripts/reparamEquivalence.ts</files>
  <read_first>
    `<planner_findings>` above — Findings 1, 2, 3 and 6 in particular. Finding 1 describes the one
    mistake that would pass every gate in this plan while being wrong.

    `packages/harness/score.ts:14-30` (the definitions being removed) and `:169-247` (`aggregateScores`).
    `packages/harness/tune.ts:289-306` (`deriveSelectionSeasons`) for the house style this rule should
    match: filter, then re-assert the filter's own invariant explicitly, then throw with the offending
    values named.
  </read_first>
  <action>
    This is one atomic compile unit. Removing the `seasonLabel` field from `ScoreSlice` breaks
    `artifact.ts` and `report.ts` at the type level, and changing `aggregateScores`' signature breaks
    all eight call sites, so TypeScript will not let these be separated. Do them together.

    **1a. `score.ts` — remove the retired vocabulary (D-1).** Delete the `SeasonLabel` type alias,
    the `TUNE_SEASONS` constant, the `HOLDOUT_SEASONS` constant and the `seasonSplit` function
    outright. Delete rather than alias, for the reason `tune.ts:340-346` already gives about
    `assertNoHoldoutLeak`: an alias lets a call site keep the retired behaviour by accident. Remove
    the `seasonLabel` field from the `ScoreSlice` interface. Keep `headlineEligible` and rewrite its
    doc comment — it is no longer "derived from the season label", it is the single honest flag, and
    it stays meaningful at slice level precisely because `aggregateScores` also scores
    selection-only seasons the Compare page never displays. Update the module's file header, whose
    first line still advertises the retired split.

    **1b. `score.ts` — the rule (D-2).** Add an exported constant for the prior-season threshold,
    valued 2, whose doc comment cites `rolling-origin-hyperparameter-tuning` D-4: one prior season is
    too thin to carry a headline claim, and that ruling is preserved here with only its inputs
    changed. Add an exported predicate taking a season and the run's season set, returning whether the
    count of DISTINCT seasons in that set strictly less than the given season meets the threshold.
    Count distinct values — a duplicated season in the input must not buy eligibility. **No year
    literal may appear anywhere in this rule or its constant.** A hardcoded set here would be the
    retired guard wearing a new name, and D-2 names that as the failure it exists to prevent.

    Add a comment recording D-3's payoff: this is what the 2019/2020 corpus backfill bought. On the
    seven-season corpus the eligible set grows from the two retired holdout seasons to five, and to
    six when 2027 plays. Write the consequence, not a lookup table — the numbers are the rule's
    output, not its input. State plainly that D-4's specific verdict on 2023 is superseded because
    the corpus changed underneath it, not because the rule did.

    **1c. `score.ts` — the signature.** Introduce an exported options interface carrying a required
    readonly season-set field and an optional bin-count field, and change `aggregateScores` to take
    `(predictions, options)`. Required, with no default and no fallback: a defaulted set is precisely
    Finding 1's silent regression. Finding 3 confirms nobody passes a bin count today, so nothing
    breaks on the positional change.

    Inside `aggregateScores`, before any slice is built, assert that every season appearing in
    `predictions` also appears in the supplied set, and throw naming the offenders if not — a caller
    that scores a season it did not declare is narrowing the population the rule is measured against,
    and that must be loud. Derive each slice's `headlineEligible` from the predicate in 1b using the
    supplied set. Delete the `const label = ...` line and the `label === "holdout"` derivation.

    **1d. Call sites.** Update all eight per Finding 2's table, passing what that row names. At
    `publish.ts:1974` pass `seasonsSorted`, never the loop's `season` — add a comment at that call
    site saying why, because a future reader looking at a per-season loop will otherwise "fix" it.
    At `cli.ts:866`, `promote.ts:728` and `eventScopeDiagnostic.ts:215`, add a one-line comment that
    the path never reads the flag, so the narrow set is not mistaken for a headline claim.

    **1e. `artifact.ts`.** Remove `seasonLabel` from `ScoreSliceSchema` and fix the `headlineEligible`
    doc comment, which currently says the value is derived from `seasonLabel`.

    **1f. `report.ts`.** Delete `SEASON_LABEL_TEXT` (`:32-35`) and its import of the retired type.
    Re-key the row class (`:81`), the badge (`:82-84`), the label cell (`:89`), the bar class (`:188`)
    and the calibration figcaption (`:264`) on `headlineEligible` alone. Pick class names and badge
    text that describe eligibility rather than the retired split, and update the corresponding CSS
    selectors in `REPORT_STYLE` so the two-tone rendering survives the rename.

    **1g. `tune.ts` prose.** At `:62` and `:340` correct the narration that describes the retired
    predicate as a live thing. There is no call to change at either site — only the sentence.

    **1h. The tracer's own test.** Add ONE test to `score.test.ts` that feeds `aggregateScores` a
    synthetic stream spanning 2019, 2020 and 2022, declaring all three, and asserts: the call does not
    throw (this is the blocker being removed), 2019 and 2020 come back ineligible, and 2022 comes back
    eligible. Delete the `seasonSplit` describe block at `score.test.ts:13-33` and repair the two
    assertions at `:147-150`, which read the removed field. The remaining test churn is Task 2's.
  </action>
  <reversibility rating="reversible">Code-only; no published artifact changes shape in this task, and nothing is republished.</reversibility>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run packages/harness/score.test.ts</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; npx tsx -e "import('./packages/harness/score.js').then(m=>{const gone=['seasonSplit','TUNE_SEASONS','HOLDOUT_SEASONS'].filter(k=>k in m);if(gone.length)throw new Error('still exported: '+gone.join(', '));const want=['aggregateScores'].filter(k=>!(k in m));if(want.length)throw new Error('missing export: '+want.join(', '));console.log('OK exports');})"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; test "$(grep -vE '^\s*(\*|//|/\*)' packages/harness/score.ts | grep -cE '\b(19|20)[0-9]{2}\b')" = "0" &amp;&amp; echo "OK no year literal in score.ts code"</automated>
  </verify>
  <done>
    `tsc --noEmit` is clean repo-wide. `score.test.ts` is green including the new 2019/2020/2022 test.
    The runtime-export probe confirms the three retired exports are gone. No four-digit year literal
    appears in any non-comment line of `score.ts` — the rule is corpus-relative, not a second
    hardcoded list.
  </done>
</task>

<task type="auto">
  <name>Task 2: Repair and extend the harness suite around the new rule</name>
  <files>packages/harness/score.test.ts, packages/harness/artifact.test.ts, packages/harness/tune.test.ts, packages/harness/report.test.ts, packages/harness/publish.test.ts, packages/harness/eventScopeDiagnostic.test.ts, packages/harness/digest.test.ts, packages/harness/pageArtifacts.test.ts</files>
  <read_first>
    Task 1's finished `score.ts`. `packages/harness/score.test.ts:135-150` and `:214-399` for the
    existing `aggregateScores` call shapes that now need the options argument.
  </read_first>
  <behavior>
    - Given a declared season set of 2019, 2020, 2022, 2023, 2024, 2025 and 2026: exactly 2022 through
      2026 come back `headlineEligible: true`, and exactly 2019 and 2020 come back false. This is
      D-3's table asserted as an OUTPUT of the rule — build the expectation by filtering the declared
      set, never by writing the two lists out by hand.
    - Given a season set of exactly two seasons: the later one has one prior and is therefore NOT
      eligible. This is D-2's "two, not one" threshold, and it is the assertion that fails if someone
      relaxes the constant to 1.
    - Given a set containing a duplicated prior season: that duplicate does not buy eligibility.
    - Given predictions carrying a season absent from the declared set: `aggregateScores` throws, and
      the message names the undeclared season.
    - Given a stream spanning all seven corpus seasons: no throw, and a slice is produced for each.
  </behavior>
  <action>
    Update every `aggregateScores` call in the harness suite to pass the options argument, supplying
    the season set that call's own fixture actually spans. Files with live calls, from this session's
    grep: `artifact.test.ts` (:66, :120, :133, :174), `digest.test.ts` (:166), `score.test.ts`
    (:135, :247, :262, :306, :321, :334, :358-359, :369-370, :385, :399).

    Add the five behaviours above as tests in `score.test.ts`. For the seven-season case, derive both
    expected lists by filtering the declared set through the same distinct-prior-count reasoning the
    rule states — if the test restates 2022-2026 as a literal array, it stops being a test of the rule
    and becomes a second copy of the hardcoded list D-2 forbids.

    Repair the remaining files that assert on the removed field or the retired vocabulary:
    `report.test.ts` (11 touches — retarget onto whatever class and badge names Task 1's 1f chose),
    `tune.test.ts` (19 touches — most are narration about the retired split; correct the prose and the
    few live assertions), `publish.test.ts`, `eventScopeDiagnostic.test.ts` and `pageArtifacts.test.ts`
    (one touch each).

    Do NOT weaken an assertion to make it pass. If a test's claim no longer has a subject, delete the
    test and say so in the SUMMARY; if it still has one, retarget it.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; npx vitest run packages/harness scripts</automated>
  </verify>
  <done>
    The whole harness suite is green. `score.test.ts` proves the seven-season corpus yields exactly
    five eligible seasons and two ineligible ones, and proves a two-season set leaves its later season
    ineligible. No test hardcodes the eligible list.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Make the published Compare schema tolerant in both directions, and pin the fixtures</name>
  <files>packages/harness/pageArtifacts.ts, apps/web/src/lib/api/compare.compat.test.ts</files>
  <read_first>
    Finding 4 and Finding 5 in `<planner_findings>`. `packages/harness/pageArtifacts.ts:1215-1230`
    (`CompareSliceSchema`) and `:44-68` (the documented convention for a shape change that does not
    bump `PAGE_ARTIFACT_SCHEMA_VERSION`, and the reasoning that convention rests on).
    `apps/web/src/lib/api/compare.ts:23` — the import that makes this a live-site change.
  </read_first>
  <behavior>
    - `CompareArtifactSchema` parses a committed `compare-*.json` fixture, which carries `seasonLabel`,
      without error. This is TODAY's live shape; the deploy in flight must keep working.
    - `CompareArtifactSchema` parses the same object with `seasonLabel` deleted from every slice,
      without error. This is the post-republish shape.
    - When `seasonLabel` IS present, the parsed result still carries it — tolerance means optional,
      not stripped.
    - `headlineEligible` remains REQUIRED and is unaffected: it is present in the 5.0.0 artifacts and
      will be present after republish. Only its computed value moves, and no client reads it.
  </behavior>
  <action>
    Change `CompareSliceSchema.seasonLabel` from a required enum to an **optional** one. Do not delete
    it. Finding 4 records why: deleting keeps old artifacts parsing but strips the key, whereas D-4
    asks for a read that tolerates both shapes rather than assuming either.

    Write its doc comment to say what the field now is: a vestige of the retired fixed split, still
    present in every 5.0.0 artifact in production, absent from everything published after this change,
    and read by nothing. Note that `PAGE_ARTIFACT_SCHEMA_VERSION` is deliberately NOT bumped, and give
    the reason in the same terms `:50-68` already uses for the `redComponents` removal — required-to-
    optional is safety-compatible in both directions, and after Task 4 there is no reader left to
    mislead.

    Create `apps/web/src/lib/api/compare.compat.test.ts` covering the four behaviours above. Import a
    real committed fixture for the first case — a hand-built object would not prove anything about the
    bytes actually in production. Build the second case by structurally cloning that same fixture and
    deleting the key, so the two cases can never drift apart.

    **Do not regenerate any fixture.** If a fixture fails to parse, that is a real signal about the
    live artifacts and the schema change is wrong — stop and report it rather than moving the bytes.
  </action>
  <reversibility rating="costly">Touches the schema the live client parses with. Reverting after a republish would leave post-republish artifacts failing a required-field check, so the optional-not-deleted choice is the one that keeps both directions open.</reversibility>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; npx vitest run apps/web/src/lib/api/compare.compat.test.ts</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; git diff --exit-code -- apps/web/src/routes/__fixtures__/ &amp;&amp; echo "OK fixtures byte-identical"</automated>
  </verify>
  <done>
    Both shapes parse, the present-key case round-trips the key, and `git diff --exit-code` proves
    every `compare-*.json` fixture is byte-identical to its committed state.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Rewrite MethodologyNote off the retired split, and verify the whole repo</name>
  <files>apps/web/src/components/compare/MethodologyNote.tsx, apps/web/src/components/compare/MethodologyNote.test.tsx</files>
  <read_first>
    `apps/web/src/components/compare/MethodologyNote.tsx` in full — its header, `MethodologyFigures`
    union, `buildMethodologyFigures`, `buildSplitDisclosureSentence` and `buildMethodologySentence`
    are all built on the partition being removed.
    `apps/web/src/components/compare/MethodologyNote.test.tsx:1-130` for the fixture harness and the
    `makeMinimalArtifact` helper.
    `packages/harness/tune.ts:20-52` for the rolling-origin selection the new prose describes — the
    scored-versus-selected-on table there is the honest subject matter.
  </read_first>
  <behavior>
    - Rendered against the five committed 5.0.0 fixtures, the note produces prose with no dangling
      subject: no sentence refers to a category of season the artifact no longer distinguishes.
    - `NEAR_TIE_CAPTION` renders byte-identical to its exported constant. It is a Copywriting Contract
      item and is never reworded.
    - Every Brier figure printed is derived from the fetched artifacts through `formatBrierDisplay`,
      never transcribed — the existing derivation discipline survives the rewrite.
    - The component reads no `seasonLabel`, and renders identically whether the field is present or
      absent from every slice.
    - The incomplete form still degrades: with fewer than the full season count carrying a Brier, the
      figure-bearing clauses do not render.
  </behavior>
  <action>
    Rewrite the note's prose around rolling-origin selection. The honest claim is now the one
    `tune.ts:20-52` describes: each season's hyperparameters were chosen using only seasons strictly
    before it, so no displayed season was scored using hyperparameters picked by looking at it. That
    is a stronger claim than the retired fixed split made, and it applies uniformly to every displayed
    season — which is why the tune-versus-holdout partition has nothing left to say.

    Delete `buildSplitDisclosureSentence`, the `tuneSeasons`/`holdoutSeasons` fields, the
    `tuneBriers`/`holdoutBriers` fields and `bestSeasonLabel` from the figures union. Delete the
    evidential clause — it asserts holdout years do not score worse than tune years, and with the
    partition gone the sentence has no subject to compare. Delete its guard test with it rather than
    retargeting it onto something it was not written to guard.

    Keep what still holds: `NEAR_TIE_CAPTION` verbatim; `formatSeasonList` and its four shapes (the
    season list it formats is now simply the displayed set); the VPR-combined-view selection rule and
    its Decision 5 rationale; the best-season clause, minus its label word; the complete/incomplete
    split; and the derived, never-transcribed figure discipline. Rewrite the module header, which
    currently states this module deliberately reads `seasonLabel` — that instruction is now inverted,
    and the header should say so and say why, so a future reader does not add the read back.

    Rewrite `MethodologyNote.test.tsx` to match. Change `makeMinimalArtifact` to stop taking a label
    parameter. Add a case proving the component renders identically with and without `seasonLabel`
    present on every slice — that is D-4's tolerance requirement asserted at the component, not just
    at the schema. Keep the fixture-driven tests: they are what proves the live site still works.

    Then run the full repo suite from the REPO ROOT. Project memory: running vitest from `apps/web`
    collects a much smaller file set and has hidden a red suite for eight days. Never wrap a test
    command in `timeout` — it swallows output and exits 0.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; test "$(grep -vE '^\s*(\*|//|/\*)' apps/web/src/components/compare/MethodologyNote.tsx | grep -c 'seasonLabel')" = "0" &amp;&amp; echo "OK no seasonLabel read"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" &amp;&amp; git diff --exit-code -- apps/web/src/routes/__fixtures__/ &amp;&amp; echo "OK fixtures still byte-identical"</automated>
  </verify>
  <verify>
    <human-check>
      Read the rendered methodology sentence produced against the five committed fixtures (the test
      output prints it). Confirm it reads as true English about rolling-origin selection and makes no
      claim the artifacts cannot support.
    </human-check>
  </verify>
  <done>
    The full repo suite is green from the repo root and `tsc --noEmit` is clean. `MethodologyNote.tsx`
    contains no non-comment reference to `seasonLabel`. The fixtures are still byte-identical. The
    note renders the same prose whether or not slices carry the vestigial field.
  </done>
</task>

</tasks>

<verification>

Run from the repo root, never from `apps/web`, and never wrapped in `timeout`:

```
npx tsc --noEmit
npx vitest run
git diff --exit-code -- apps/web/src/routes/__fixtures__/
```

**Out of scope, and a failure if it happens.** This task removes a blocker; it does not exercise what
the blocker was holding back. Do NOT run `pnpm tune`, `pnpm promote`, `pnpm publish:seasons`,
`pnpm publish:artifacts`, `pnpm harness` over a full corpus, or any hyperparameter search. Do not
regenerate a fixture. Do not push.

**The one gate that cannot be automated away.** Finding 1's regression — passing `publish.ts`'s
loop-local `season` instead of `seasonsSorted` — makes every published slice ineligible and breaks no
test. Before committing Task 1, re-read `publish.ts:1974` and confirm by eye that the set being passed
is the run's whole season list.

</verification>

<success_criteria>

- [ ] `aggregateScores` scores a stream containing 2019 and 2020 without throwing (D-1 domain)
- [ ] `score.ts` exports no `seasonSplit`, no `TUNE_SEASONS`, no `HOLDOUT_SEASONS`, no `SeasonLabel` (D-1)
- [ ] `headlineEligible` survives as the single flag, derived from the run's own season set (D-1, D-2)
- [ ] The threshold is two prior seasons, and a two-season set leaves its later season ineligible (D-2)
- [ ] No non-comment year literal in `score.ts`; no test hardcodes the eligible list (D-2)
- [ ] On the seven-season corpus the rule yields exactly five eligible and two ineligible seasons, asserted as an output (D-3)
- [ ] D-3's payoff and the superseding of D-4's 2023 verdict are recorded in a code comment (D-3)
- [ ] `CompareArtifactSchema` parses committed 5.0.0 fixtures AND the key-absent shape (D-4)
- [ ] `MethodologyNote` reads no `seasonLabel` and renders identically with or without it (D-4)
- [ ] `apps/web/src/routes/__fixtures__/compare-*.json` byte-identical to committed state
- [ ] `npx tsc --noEmit` clean and `npx vitest run` green from the repo root
- [ ] No tune, publish, promote or full replay was run

</success_criteria>

<output>
Create `.planning/quick/260903-krp-replace-score-ts-s-fixed-tune-holdout-sp/260903-krp-SUMMARY.md` when done.

Record in it: the exact value passed as the season set at each of the eight call sites; the eligible
and ineligible season lists the rule actually produced on the seven-season corpus; any test deleted
rather than retargeted, with the reason its claim lost its subject; and confirmation that no fixture,
publish, promote or tuning run was touched.
</output>
</content>
</invoke>
