---
phase: quick-260911-gfe
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/breakdown/index.ts
  - docs/models/statbotics-breakdown-reference.md
  - scripts/measureEpaDeviations.ts
  - scripts/measureEpaDeviations.test.ts
  - data/diagnostics/epa-deviation-ablation.json
  - reports/epa-deviation-ablation.json
  - docs/models/epa-divergences.md
  - apps/web/src/components/methodology/epaComparisonContent.ts
  - .planning/quick/260911-gfe-add-the-epa-component-map-seam-and-settl/260911-gfe-SUMMARY.md
autonomous: true
requirements: [QUICK-260911-gfe]

estimate:
  tokens: 84000
  raw_tokens: 42000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "epa.ts's update() and carrySeason() accept an optional component map, and with the parameter absent every number the shipped module produces is unchanged — proven by a replay test, not asserted."
    - "epa's version string stays 8.0.0+baseline and no EpaState field is added, so STATE_SNAPSHOT_SHAPE_VERSION 12 and every published artifact shape are untouched."
    - "The repo carries a per-season answer to 'is a faithful Statbotics component partition constructible at all', each season labelled with the evidence it rests on."
    - "The component-map deviation's register entry no longer claims the blocker is a missing injection seam, because that is no longer true."
    - "No arm measures a partition this project constructed by picking a non-overlapping subset out of Statbotics' overlapping comp keys."
    - "The methodology page's component-maps entry states what was established, and the difference id set is still exactly three ids."
  artifacts:
    - packages/core/algorithms/epa.ts
    - docs/models/statbotics-breakdown-reference.md
    - scripts/measureEpaDeviations.ts
    - apps/web/src/components/methodology/epaComparisonContent.ts
  key_links:
    - "epa.update(state, result, map?) -> tryParseBreakdownPair(season, raw, map?) -> map.parse (one map value governs BOTH the component list AND the parse)"
    - "epa.carrySeason(state, boundary, toSeasonMap?) -> the INCOMING season's component list"
    - "componentMapArm -> the concrete epa import (never through the AlgorithmModule interface, which cannot see the optional parameter)"
    - "deviationRegister()'s component-map entry -> docs/models/epa-divergences.md §6 -> epaComparisonContent.ts's component-maps entry (three surfaces, one claim)"
---

<objective>
Answer the developer's question: **is SigmaScout's component-map divergence from Statbotics
actually still real?** Stage 1 (quick task 260910-x09) could not measure it and said so, naming
the exact missing seam. This task adds that seam, uses it to settle the question or to establish
in detail that it cannot be settled, and corrects the methodology page to match whatever is true.

Purpose: stage 3 of 4. The developer's standing directive is that SigmaScout's EPA should be as
faithful a copy of Statbotics' EPA as possible with exactly three accepted exceptions, and "how a
match score is split into pieces" is the second of those three. The methodology page currently
describes that exception in terms nobody has verified.

Output: an inert component-map seam in `epa.ts`, a transcribed Statbotics breakdown reference, a
per-season constructibility verdict, a corrected deviation register, and corrected prose on
`/methodology/epa-vs-statbotics` and in `docs/models/epa-divergences.md` §6.
</objective>

<hard_invariant>
THIS TASK CHANGES NO SHIPPED EPA BEHAVIOUR AND NO PUBLISHED NUMBER.

1. **The seam is inert at its default.** With the new parameter absent, `epa.update` and
   `epa.carrySeason` must be byte-identical to today. `epa.version` stays `8.0.0+baseline`.
   Task 1's test is the proof; an assertion in a comment is not.
2. **Do NOT bump `epa`'s version, and do NOT add a field to `EpaState`.** `STATE_SNAPSHOT_SHAPE_VERSION`
   stays 12. If you find yourself wanting to bump either, the seam is not inert and the design is wrong.
3. **Do NOT disturb quick task 260911-3kc's carry-rescale work** (`epaCarryScale.ts`,
   `EpaState.carrySeedMean`, `EpaState.carryPending`, `carryRescaleRatioFor`, `materializePendingTeams`).
   It landed hours ago. Read it, leave it alone.
4. **Do NOT invent an additive partition out of Statbotics' overlapping `comp_*` keys.** Selecting a
   non-overlapping subset and calling it "Statbotics' partition" measures this project's own
   construction. If no faithful partition exists, that IS the finding — report it, do not manufacture
   a number to fill the cell.
5. **Do NOT touch BPR** in any file, and do not replay, score, tune, or otherwise spend its sealed
   2016-2022/2023-2026 holdout. BPR is not part of this task at any layer.
6. **Do NOT run a republish.** No `publish:*` script, no R2 write, no manifest bump. Nothing this
   task produces goes to production.
7. **Do NOT tune, fit, sweep, or select any parameter against any season.**

GUARD NUMERIC OUTPUT: any number this task computes or prints must be checked finite and throw
naming its context if it is not. A plausible-looking wrong number is worse than a loud failure.
</hard_invariant>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/260910-x09-build-the-epa-deviation-ablation-harness/260910-x09-SUMMARY.md
@packages/core/algorithms/epa.ts
@packages/core/algorithms/breakdown/index.ts
@packages/core/algorithms/breakdown/constants.ts
@scripts/measureEpaDeviations.ts
@docs/models/epa-divergences.md
@apps/web/src/components/methodology/epaComparisonContent.ts
</context>

<environment>
- Worktree isolation is DISABLED and must stay disabled (`data/corpus.sqlite` is 582 MB and gitignored).
- **Another Claude session is active in this checkout** with untracked plans under `.planning/phases/09-*`.
  Never `git add -A`. Always `git commit -- <explicit pathspec>`. Stage only the files this plan lists.
- `data/diagnostics/epa-deviation-ablation.json` is currently UNTRACKED — stage 1's Task 3 was
  interrupted before it was committed. Task 2 regenerates and commits it.
- Run tests with `npx vitest run <paths>`. Verify by READING the output, not by the exit code
  (`timeout <n> pnpm <cmd>` swallows output and exits 0 — do not use it).
- Root `tsc --noEmit` does NOT cover `apps/web`. Task 3 touches `apps/web`, so run both:
  `npx tsc --noEmit` and `npx tsc -p apps/web/tsconfig.json --noEmit`.
- Long runs go in the BACKGROUND and are polled. Never time out a foreground call.
- Network Bash is denied inside an executor sandbox. The `WebFetch` tool may still work; Task 2
  has an explicit branch for the case where it does not.
</environment>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Thread an inert component-map parameter through update() and carrySeason()</name>
  <files>packages/core/algorithms/breakdown/index.ts, packages/core/algorithms/epa.ts, packages/core/algorithms/epa.test.ts</files>
  <read_first>
    `packages/core/algorithms/epa.ts` — `updateCore` (the `componentMapForSeason(season)` call and
    every downstream use of `seasonMap`: `componentCount`, `nonFoulsComponents`, and the separate
    `tryParseBreakdownPair(season, ...)` call which resolves the map a SECOND time internally),
    `carrySeason` (its `componentMapForSeason(boundary.toSeason)` call), and `update` (the thin
    carry-materialization wrapper around `updateCore` that 260911-3kc added).
    `packages/core/algorithms/breakdown/index.ts` — `componentMapForSeason` and
    `tryParseBreakdownPair`, noting that the map is deliberately resolved BEFORE the `try` so an
    unregistered season stays a loud throw (T-03-21).
    `packages/core/algorithms/epa.test.ts` — the existing `matchResult()`, `upcoming()` and
    `breakdown2024Json()` helpers, which the new test reuses rather than reinventing.
  </read_first>
  <behavior>
    - Replaying a multi-match synthetic 2024 stream with the parameter ABSENT produces a state
      identical, field for field, to replaying it with the parameter set explicitly to
      `componentMapForSeason(2024)`.
    - Crossing a season boundary with `carrySeason(state, boundary)` produces a state identical to
      `carrySeason(state, boundary, componentMapForSeason(2025))`.
    - The seam is LIVE, not dead: passing a map whose `components`/`parse` differ produces a
      DIFFERENT state than the default. A test that only proves inertness would also pass if the
      parameter were ignored entirely, so this case is required.
    - `epa.version` is exactly `8.0.0+baseline`.
    - Every component value in every compared state is finite.
  </behavior>
  <action>
    Add ONE optional `SeasonComponentMap` parameter to each of three functions, each defaulting to
    exactly what that function resolves today. No other behaviour changes anywhere.

    1. `tryParseBreakdownPair(season, scoreBreakdownRaw, map?)` in `breakdown/index.ts`: when `map`
       is supplied, use it instead of calling `componentMapForSeason(season)`. Keep the resolution
       ahead of the `try` exactly as it is now, so an unregistered season still throws loudly and is
       never folded into the guarded region. The parameter is optional, so `sigma1/index.ts`'s
       existing two-argument call site is unchanged and must not be edited.

    2. `epa.ts`'s `updateCore(state, result, componentMap?)`: replace the single
       `const seasonMap = componentMapForSeason(season)` with `componentMap ?? componentMapForSeason(season)`,
       and pass that SAME `seasonMap` value into `tryParseBreakdownPair`. This is the load-bearing
       half of the seam: `componentCount` and `nonFoulsComponents` read `seasonMap.components`, but
       the OBSERVED component vector comes from `map.parse`, and a component-map arm that changed
       the component list without changing the parse would silently measure a mismatched pair.
       Thread the parameter from `update(state, result, componentMap?)` through both of its
       `updateCore` call paths (the early return and the post-materialization one).

    3. `epa.ts`'s `carrySeason(state, boundary, toSeasonMap?)`: use
       `(toSeasonMap ?? componentMapForSeason(boundary.toSeason)).components` for
       `toSeasonComponents`. Nothing else in that function moves — `carrySeedMean` capture,
       `epaCarryover` delegation, `reseedFromPrior`, the `ADJUST_COMPONENT` divisor exclusion and
       the `carryPending` set are all untouched.

    Document, at each parameter, that the two parameters denote DIFFERENT seasons: `update`'s is the
    map for the match's own season, `carrySeason`'s is the INCOMING season's map. A reader who
    conflates them would wire an arm that rescales into the wrong units.

    Document the default's contract in one line at each site: absent means resolve exactly as before,
    and Task 1's replay test is what holds that true.

    Note in the `carrySeason` parameter's comment that `AlgorithmModule`'s declared signatures cannot
    see this optional parameter, so a caller that wants to pass a map must hold the concrete `epa`
    object rather than an `AlgorithmModule` reference. That is the constraint Task 2's arm is built to.

    Then write the test described in `<behavior>` into `epa.test.ts`, under its own `describe`.
    Build roughly 30-40 synthetic 2024 matches from the existing `matchResult()`/`breakdown2024Json()`
    helpers, across at least two event keys and including at least one elimination match and one
    match with a null breakdown (the D-05 fallback path, which reads `seasonMap.components` through
    `nonFoulsComponents` and would miss a threading bug otherwise). Compare states by a canonical
    serialization — sorted-key JSON over `teamComponents` entries, `teamMatchCounts`,
    `allianceScoreStats`, `carrySeedMean`, a sorted `carryPending` array, `priorSeasonRatings` and
    `breakdownParseFailureCount` — so the comparison cannot pass by omitting a field. Assert every
    compared component value finite before comparing.

    Do NOT bump `epa.version`. Do NOT add an `EpaState` field. Do NOT edit `epaCarryScale.ts`,
    `carryover.ts`, `sigma1/`, or any season file under `breakdown/`.
  </action>
  <verify>
    <automated>npx vitest run packages/core/algorithms/epa.test.ts packages/core/algorithms/epaCarryScale.test.ts packages/core/algorithms/carryover.test.ts packages/core/algorithms/breakdown/breakdown.test.ts packages/core/algorithms/breakdown/groups.test.ts packages/harness/stateSnapshot.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    All six suites pass, including the new inertness/liveness describe block and the existing
    `stateSnapshot` continuation-replay digest equality (the strongest independent check that the
    default path did not move). `npx tsc --noEmit` reports no errors. `epa.version` is still
    `8.0.0+baseline` and `git diff packages/core/algorithms/epa.ts` shows no change to the version
    line, to `EpaState`, or to any `epaCarryScale` call site.
  </done>
</task>

<task type="auto">
  <name>Task 2: Establish the Statbotics reference, then settle the component-map question or prove it cannot be settled</name>
  <files>docs/models/statbotics-breakdown-reference.md, scripts/measureEpaDeviations.ts, scripts/measureEpaDeviations.test.ts, data/diagnostics/epa-deviation-ablation.json, reports/epa-deviation-ablation.json</files>
  <precondition>`data/corpus.sqlite` exists and is readable (582 MB, gitignored). Step 6's regeneration run reads it.</precondition>
  <read_first>
    `scripts/measureEpaDeviations.ts` — `deviationRegister()`'s `component-map` entry (its
    `status`, `reason` and `priorMeasurement` block), `armRegister()`, `ARM_IDS`,
    `winProbabilityArm` (the wrapper pattern every arm follows), and `main()`'s per-season loop
    where the `algorithms` array is built and the boundary is threaded.
    `experiments/260910-4x0/granularity.ts` — the four partitions quick task 260910-5ym replayed,
    and specifically HOW its "Statbotics comp partition" arm was constructed.
    `docs/models/epa-divergences.md` §6.
  </read_first>
  <action>
    **Step 1 — establish what Statbotics actually rates, from a real source or not at all.**

    First check the repo. The claim that `02-RESEARCH.md` records Statbotics' `all_keys[year]`
    table verbatim for 2022-2026 is FALSE — verify this yourself and record the verification.
    `02-RESEARCH.md` says the table was fetched in its 2026-08-13 session and cross-referenced, but
    no transcription of it survives anywhere in this repo. The only surviving verified fact is in
    `epa-divergences.md` §6, for 2024 alone, fetched 2026-09-10. This is the same
    never-transcribed failure stage 1 filed against the 2018 sigmoid, hitting a second time.

    Then attempt ONE `WebFetch` each of:
      `https://raw.githubusercontent.com/avgupta456/statbotics/master/backend/src/breakdown.py`
      `https://raw.githubusercontent.com/avgupta456/statbotics/master/backend/src/models/epa/breakdown.py`

    If the fetches succeed: create `docs/models/statbotics-breakdown-reference.md` and transcribe,
    VERBATIM and in a fenced block, `get_score_from_breakdown`'s per-year branches and the
    `all_keys` construction, with the URL and today's date. Transcribing it here is the point: this
    task exists because the last three attempts to answer a Statbotics question died on a reference
    that was read once and never written down.

    If a fetch is blocked or fails: still create the file, record the attempt and its failure, carry
    only what the repo already verifies (2024), and mark every other season NOT ESTABLISHED. Do not
    reconstruct a key list from memory, from a season file's field names, or from a plausible
    reading of TBA's schema. A reconstructed reference is an invention.

    **Step 2 — the per-season verdict table.** In that same file, one row per season 2016-2026:

      | season | what Statbotics RATES (get_score_from_breakdown branch) | do its all_keys form a non-overlapping additive partition of that quantity? | partition-constructible | evidence |

    `partition-constructible` takes exactly one of: `yes`, `no-overlapping-keys`,
    `no-rates-a-single-quantity`, `not-established`. Every row cites its evidence (the transcript
    above, or `epa-divergences.md` §6's 2026-09-10 verification, or "not established").

    The most likely outcome, per what §6 already verifies for 2024, is that Statbotics rates ONE
    quantity per season (`breakdown["no_foul_points"]` in 2024) and its `comp_*` keys overlap
    (`speaker_points` re-counts notes already inside `auto_note_points`/`teleop_note_points`), so
    they are display/RP quantities rather than a partition. **If that is what you find, say it
    plainly and at length.** It means "SigmaScout built its own table instead of Statbotics'"
    compares two different KINDS of object — a vector of rated pieces against a single rated total —
    and that is a more interesting answer than a delta, not a failure to produce one.

    **Step 3 — correct the record on 260910-4x0's "Statbotics comp partition" arm.** Read
    `experiments/260910-4x0/granularity.ts`. Its `Statbotics comp partition (leave/auto/tele/eg)`
    arm is a four-way grouping this project assembled from `comp_*` NAMES, not a partition
    Statbotics rates. Its 0.7461 figure is therefore this project's own approximation. Relabel it
    as such wherever it is quoted: `deviationRegister()`'s `component-map` `priorMeasurement.values`
    label, and §6's prose in Task 3. Do not delete the number; correct what it is a number OF.

    **Step 4 — add the arm machinery on Task 1's seam.** Add `componentMapArm(id, mapForSeason)` to
    `scripts/measureEpaDeviations.ts`, spreading the concrete `epa` import (never an
    `AlgorithmModule`-typed reference, which cannot see the optional parameter) and overriding only
    `update` and `carrySeason` to forward the override map. Give it a unit test in
    `scripts/measureEpaDeviations.test.ts` proving that an arm handed `componentMapForSeason(season)`
    is state-identical to the baseline — the harness-level echo of Task 1's inertness proof, and the
    thing that makes a future season's arm a one-line addition.

    **Step 5 — register an arm ONLY where step 2 says `yes`.** If any season is
    `partition-constructible: yes`, add that arm to `ARM_IDS` and `armRegister()` with its
    `approximation` field stating exactly which seasons it is live for and that every other season
    runs the shipped map. If NO season is `yes`, leave `ARM_IDS` unchanged — the machinery exists and
    is unit-tested, and no arm runs. That is the correct outcome, not a shortfall.

    **Step 6 — flip the register entry.** `deviationRegister()`'s `component-map` entry currently
    gives its blocker as the absence of an injection point in `update()`/`carrySeason()`. After Task
    1 that statement is false and must not survive. Rewrite `reason` to the real blocker step 2
    established, and set `status` accordingly: `unmeasurable-no-reference` where no partition exists
    or none is established, `measured` where an arm ran. State in the new `reason` that the seam now
    exists and names the commit that added it, so a future reader does not re-derive it.

    **Step 7 — regenerate both artifacts.** Run `pnpm measure:epa-deviations` in the BACKGROUND and
    poll until it exits; never foreground it and never wrap it in `timeout`. Read the run's printed
    output to confirm it completed, then confirm both `reports/epa-deviation-ablation.json` and
    `data/diagnostics/epa-deviation-ablation.json` were rewritten and carry the corrected register.
    If the run fails, report the failure — do not hand-edit either JSON file to look finished.

    Do not modify any file under `packages/` in this task. Do not touch `experiments/260910-4x0/`.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureEpaDeviations.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>node -e "const a=require('./data/diagnostics/epa-deviation-ablation.json');const d=a.deviations.find(x=>x.id==='component-map');if(!d)throw new Error('component-map entry missing');if(/injection point|injection seam/i.test(d.reason||''))throw new Error('component-map reason still blames the missing seam');console.log('component-map status:',d.status);console.log('reason:',d.reason)"</automated>
  </verify>
  <done>
    `docs/models/statbotics-breakdown-reference.md` exists and carries a per-season verdict row for
    every season 2016-2026, each citing its evidence, with no row resting on a reconstructed key
    list. `componentMapArm` exists and its inertness test passes. `ARM_IDS` grew only for seasons
    verified `partition-constructible: yes`. The regenerated diagnostic's `component-map` entry no
    longer names a missing injection seam as the blocker, and the node check above prints its new
    status and reason. `npx tsc --noEmit` reports no errors.
  </done>
</task>

<task type="auto">
  <name>Task 3: Correct the methodology page and epa-divergences §6 to match what Task 2 established</name>
  <files>apps/web/src/components/methodology/epaComparisonContent.ts, docs/models/epa-divergences.md</files>
  <read_first>
    `apps/web/src/components/methodology/epaComparisonContent.ts` — the whole file, and especially
    the voice rules in its header comment, the locked `EPA_DIFFERENCE_IDS` decision, and the
    `win-probability-scale` and `no-per-year-tweaks` entries whose register the rewritten paragraphs
    must match (short declarative sentences, no jargon, a term explained the first time it appears,
    neutral between the two sites, concrete numbers where they exist).
    `apps/web/src/components/methodology/epaComparisonContent.test.ts` — the two gates that bind
    this edit: `EPA_DIFFERENCE_ENTRIES`' ids asserted by EQUALITY against the three locked ids, and
    the em dash voice gate asserted over every exported string value.
  </read_first>
  <action>
    Rewrite the `component-maps` entry's `paragraphs` to say what Task 2 established.

    The claim to remove is the unverified one: that Statbotics groups FIRST's raw scoring fields
    into pieces using its own table, and that in some seasons the two sites group those pieces
    differently. If Task 2 found Statbotics rates a single quantity per season, the honest
    replacement tells a student that SigmaScout rates several pieces and adds them up, while
    Statbotics rates one number for the whole alliance, and that this is a difference in kind rather
    than two different groupings of the same thing.

    Keep what is still true and measured: the thin-evidence argument for why slicing granularity
    matters, and the 73.5 / 75.2 / 74.0 percent 2024 figures. Correct the middle figure's LABEL per
    Task 2 step 3 if it is quoted as Statbotics' partition anywhere in the entry — on the page it
    currently is not quoted at all, so check rather than assume.

    Also revisit the entry's `heading`. If Statbotics does not split a score into pieces at all,
    "How a match score is split into pieces" may no longer name the difference correctly. Change it
    only if Task 2's finding makes it wrong; if you change it, say so in the SUMMARY, because the
    developer named this exception by that phrase.

    Hard constraints on this file:
      - `EPA_DIFFERENCE_IDS` stays exactly three ids, in order. Do NOT remove `component-maps` even
        if the divergence turns out to be narrower than the page claimed, and do NOT add a fourth.
        The header comment already records that 8.0.0's carryover fix was deliberately NOT added as
        a fourth entry for this reason — follow that precedent.
      - No em dash characters in any exported string. The test asserts this over every string value.
      - No hedging openers, no sentence that restates the previous one.

    Add a dated revision note to the file's header comment recording this task, what changed under
    the `component-maps` entry, and what evidence it now rests on.

    Then rewrite `docs/models/epa-divergences.md` §6 to match, in that document's maintainer
    register rather than the page's student register. §6 must end up carrying: the per-season
    constructibility verdict (or a pointer to `statbotics-breakdown-reference.md` for it), the
    corrected label on 260910-4x0's four-way arm, and the fact that the injection seam now exists so
    a future season with a real partition is measurable. Keep §6's existing 2024 narrowing note and
    the "curve turns over" caution — both are still true and both are load-bearing.

    In the SUMMARY (Task 3's own output, returned as text for the orchestrator to write):
    FLAG THE REMOVAL QUESTION as an explicit decision for the developer. State whether the
    `component-maps` difference is still a genuine exception under his three-exceptions directive,
    recommend keep or remove with your reasoning, and note that removing it would take
    `EPA_DIFFERENCE_IDS` to two and is a locked-decision change he alone makes.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/methodology/epaComparisonContent.test.ts apps/web/src/lib/api/epaComparison.test.ts</automated>
    <automated>npx tsc -p apps/web/tsconfig.json --noEmit</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    Both suites pass, including the three-id equality pin and the em dash voice gate. Both
    typechecks report no errors. The `component-maps` entry's paragraphs state Task 2's finding, the
    unverified two-tables claim is gone, `EPA_DIFFERENCE_IDS` still holds exactly three ids, and
    `docs/models/epa-divergences.md` §6 agrees with both the page and the deviation register.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WebFetch -> `docs/models/statbotics-breakdown-reference.md` | Third-party source text enters the repo as documentation |
| `data/corpus.sqlite` -> the regeneration run | Untrusted third-party TBA payloads already stored verbatim |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gfe-01 | Tampering | Task 2's transcribed reference | medium | mitigate | Transcribe verbatim into a fenced block with URL and fetch date; on fetch failure mark seasons NOT ESTABLISHED rather than reconstructing from memory |
| T-gfe-02 | Information disclosure | `.env` secrets | high | mitigate | No task reads `.env`. No script in this plan needs a credential; `measure:epa-deviations` runs without `--env-file` |
| T-gfe-03 | Tampering | The regenerated ablation JSON | medium | mitigate | Regenerate by running the script; hand-editing either JSON to look finished is forbidden by Task 2 step 7 |
| T-gfe-04 | Tampering | Foreign edits from the concurrent session | high | mitigate | Never `git add -A`; commit only the explicit pathspecs this plan lists; `git status` before each commit |
| T-gfe-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package installs in this plan. If one becomes necessary, halt and escalate rather than installing |
</threat_model>

<verification>
1. `npx vitest run packages/core/algorithms/epa.test.ts scripts/measureEpaDeviations.test.ts apps/web/src/components/methodology/epaComparisonContent.test.ts` — all green, read the output.
2. `npx tsc --noEmit` and `npx tsc -p apps/web/tsconfig.json --noEmit` — both clean.
3. `git diff packages/core/algorithms/epa.ts` shows no change to the `version` line and no new `EpaState` field.
4. The regenerated `data/diagnostics/epa-deviation-ablation.json`'s `component-map` entry names a real blocker, not the now-closed missing seam.
5. `docs/models/statbotics-breakdown-reference.md`, `docs/models/epa-divergences.md` §6, and the page's
   `component-maps` entry all state the same finding. Three surfaces, one claim.
</verification>

<success_criteria>
- The seam exists, is inert at default, and that inertness is proven by a replay test rather than asserted.
- `epa@8.0.0+baseline` produces the same numbers it did before this task.
- The developer's question is answered per season: is a faithful Statbotics partition constructible, and where it is, what does it cost in winner accuracy and Brier.
- Where it is not constructible, the reason is stated in detail with its evidence, and no number was manufactured to fill the gap.
- The methodology page no longer carries an unverified claim, and the `EPA_DIFFERENCE_IDS` removal question is surfaced to the developer as a decision rather than made silently.
</success_criteria>

<output>
Commit each task separately with an explicit pathspec (`git commit -- <paths>`), never `git add -A`.

Return the SUMMARY body as TEXT for the orchestrator to write to
`.planning/quick/260911-gfe-add-the-epa-component-map-seam-and-settl/260911-gfe-SUMMARY.md`
(the Write tool is blocked for subagents on SUMMARY.md; do not route around it via Bash).

The SUMMARY must carry:
- The per-season constructibility verdict table.
- Whether the component-map divergence is still real, stated plainly.
- The `EPA_DIFFERENCE_IDS` removal question, with a recommendation.
- Whether the WebFetch of Statbotics' source succeeded, since every season verdict other than 2024's depends on it.
</output>
