---
phase: quick-260911-pon
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/models/epa-statbotics-gap.md
  - scripts/statboticsComponentMaps.ts
  - scripts/statboticsComponentMaps.test.ts
  - .planning/quick/260911-pon-mechanism-1-foundation-transcribe-cleani/260911-pon-SUMMARY.md
  - .planning/STATE.md
autonomous: true
requirements: [QUICK-260911-pon]

estimate:
  tokens: 30000
  raw_tokens: 60000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Mechanism 8's body no longer calls `score_sd` a season-final constant, no longer describes SigmaScout's denominator as an expanding-window Welford SD in the general case, and no longer argues that adopting Statbotics' constant leaks season-end variance."
    - "Mechanism 8's verdict is re-derived under the same rule mechanism 5 was re-derived under, and whichever label results, the matrix row, the tally line and the body all state the same thing."
    - "The algebraic-identity paragraph in mechanism 8 (the `10**(k*x)` versus `exp()` substitution) survives verbatim in substance — sign, base and coefficient still shown to agree."
    - "Mechanism 1's body states, with a per-season column, that Statbotics' RATED vector and the subset `get_score_from_breakdown` actually READS are different objects, and that SigmaScout's `predictCore` sums every non-foul component into the score and therefore conflates them."
    - "Mechanism 1 is split into two separable sub-gaps — 1a the score-read set, buildable today through the existing `componentMapArm` seam, and 1b the full rated vector including entries the score never reads, which has no channel in SigmaScout at all."
    - "The plan's one tracer season is 2024, landed as a MEASURED ARM behind the `componentMapArm` seam and never as the shipped default, with the reason recorded."
    - "The eight non-tracer seasons are named as deferred, grouped onto the gap document's own existing stages 4-7, with no partial season map left half-built."
    - "The 2024 Statbotics-faithful score-read map is unit-tested against real corpus breakdowns and proven to emit exactly `no_foul_points` plus `foulsCommitted`, not a re-grouping this project invented."
    - "The winner-accuracy and Brier change of the 2024 arm against the shipped baseline is reported plainly as measured, including a loss, with no tuning, sweeping or arm selection applied to improve it."
    - "No republish is run, no BPR/SPR code or sealed holdout is touched, `EPA_DIFFERENCE_IDS` is unchanged, `ARM_IDS` is unchanged, and the shipped `epa.version` is unchanged."
  artifacts:
    - "docs/models/epa-statbotics-gap.md with a corrected mechanism 8 and a re-derived mechanism 1"
    - "scripts/statboticsComponentMaps.ts — the 2024 faithful score-read map, exported, unregistered in SEASON_COMPONENT_MAPS"
    - "scripts/statboticsComponentMaps.test.ts — its proof"
    - "experiments/260911-pon/ — throwaway replay driver and captured output (gitignored, NOT committed)"
  key_links:
    - "scripts/statboticsComponentMaps.ts -> packages/core/algorithms/breakdown/2024.ts (wraps the shipped Zod-validated parse; never re-declares the field list)"
    - "the throwaway replay -> scripts/measureEpaDeviations.ts:componentMapArm (the seam commit b62c3655 exists for exactly this; do not monkey-patch breakdown2024 the way experiments/260910-4x0/granularity.ts did)"
    - "mechanism 1's new score-read column -> docs/models/statbotics-breakdown-reference.md section 18"
---

<objective>
Two separable jobs on `docs/models/epa-statbotics-gap.md`, plus the first real step toward closing
mechanism 1.

**Part A** repairs mechanism 8's body, which went stale when quick task 260911-j2w shipped
`epa@9.0.0+baseline`. It is wrong in three substantive ways, not merely in prose, and its
nine-season `DELIBERATE DIFFERENCE` verdict must be re-derived rather than assumed.

**Part B** gives mechanism 1 a foundation and ONE tracer season. Mechanism 1 is `GAP` in all nine
seasons. Closing it everywhere is far beyond a quick task, and a half-ported set of season maps
would be materially worse than a clean foundation — so this plan deliberately builds the
foundation and lands 2024 only, as a measured arm, and names the deferral grouping for the other
eight.

Purpose: the developer's locked requirement is *"I NEED to be able to reproduce statbotics EPA
perfectly."* Whether SigmaScout's EPA gets better or worse is explicitly not a consideration.
Output: a self-consistent gap document, a committed and tested 2024 faithful score-read map behind
the existing seam, and a plainly-reported measurement of what adopting it costs.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./.claude/CLAUDE.md

Read during execution, not up front:
- `docs/models/epa-statbotics-gap.md` — the correction block at the top, the verdict matrix and
  tally, mechanism 1, mechanism 5's heading and body (the PRECEDENT for part A), mechanism 8,
  register R3, and the "Recommended stage sequence" section's stages 4-7.
- `docs/models/statbotics-breakdown-reference.md` — section 2 (the additive identity and the
  shared `foul_points = foulPoints + adjustPoints` definition), section 4 (`key_to_name`),
  section 17 (the per-season cleaners), section 18 (which vector entries the score reads),
  section 20 (`avg.py`).
- `packages/core/algorithms/epa.ts` — `predictCore` (roughly lines 672-760) and the
  `componentMap` seam on `update`/`carrySeason`.
- `packages/core/algorithms/epaWeekOne.ts` — which alliance scores the week-1 accumulator folds,
  needed for part A's population question.
- `packages/core/algorithms/breakdown/2024.ts` and `breakdown/constants.ts`.
- `scripts/measureEpaDeviations.ts` — `componentMapArm` (roughly lines 1290-1365) and the
  mechanism-1 deviation-register entry (roughly lines 690-730).
- `experiments/260910-4x0/granularity.ts` — the replay-driver TEMPLATE (gitignored, present on
  disk). Copy its replay/scoring structure; do NOT copy its monkey-patching of `breakdown2024`.

**The Statbotics source is on disk and there is NO network.** All twelve files, curl'd verbatim:
`C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/a6c4c664-07f1-4630-9f25-d553556258fb/scratchpad/statbotics/`
Never re-fetch and never reconstruct anything from memory.
</context>

<preflight>

**A FINDING FROM PLANNING THAT CHANGES THE TASK — read before starting.**

The task description says the per-season cleaning derivations are *"not yet transcribed"* into
`docs/models/statbotics-breakdown-reference.md`. **That is false as of HEAD.** Section 17 of the
reference already carries **all eleven** `clean_breakdown_{year}` functions verbatim, 2016 through
2026, plus `post_clean_breakdown`, and the file's Provenance block A states that a checker slices
every python fence and requires each to be a byte-identical substring of one of the eight fetched
sources. Stage 4 of the gap document's own stage sequence already says so: *"Reference section 17
carries each cleaner verbatim."*

**Consequence: do not spend any task transcribing cleaning functions.** That budget goes to the
foundation and the tracer instead. If, while working, you find a specific cleaner is NOT in section
17, record that as a named residual rather than transcribing all eleven.

**Verify this cheaply before relying on it** (part of Task 2): pick two seasons, slice their
`def clean_breakdown_{year}` block out of section 17, and confirm each is a contiguous substring of
the scratchpad's `tba_breakdown.py`. Do this in the scratchpad with a throwaway script. If either
fails, STOP and report — do not repair the reference in this task.

</preflight>

<forbidden>

These are hard prohibitions. Violating any of them fails the task regardless of what else works.

1. **Do NOT attempt all nine seasons of mechanism 1.** ONE tracer season (2024). Eight deferred,
   named, and left completely untouched — not half-built, not stubbed.
2. **Do NOT touch BPR/SPR** in any form, and do not spend or reference its sealed 2016-2022 /
   2023-2026 holdout. Jacob, 2026-09-09: do not raise BPR tuning again in any form.
3. **Do NOT run a republish.** No `publish:seasons`, no `--event`, no R2 write of any kind. A
   republish is already owed for `9.0.0` and `10.0.0`; this task does not discharge it and does not
   add to it either, because nothing shipped changes.
4. **Do NOT change `EPA_DIFFERENCE_IDS`** (`apps/web/src/components/methodology/epaComparisonContent.ts`).
   Nothing user-facing changes in this task.
5. **Do NOT tune, sweep, grid-search, or SELECT anything to improve an accuracy number.** Exactly
   one arm is built, on exactly one season, with exactly the entry set section 18 dictates. If it
   loses, report the loss as found. "Adopting Statbotics' entry set is a FIDELITY move, not an
   accuracy move" is already recorded in the doc; do not re-litigate it as a bug and do not go
   looking for a flattering variant.
6. **Do NOT ship the tracer map as the default.** It is an arm. `SEASON_COMPONENT_MAPS` in
   `packages/core/algorithms/breakdown/index.ts` is unchanged; `packages/core/algorithms/breakdown/2024.ts`
   is unchanged; `epa.version` is unchanged; `ARM_IDS` in `scripts/measureEpaDeviations.ts` is
   unchanged and `data/diagnostics/epa-deviation-ablation.json` is NOT regenerated.
7. **Do NOT read `.env`** with any tool, and never render a secret into any output stream (project
   CLAUDE.md, "Secrets handling"). Nothing here needs a credential.
8. **Do NOT re-fetch anything.** No network. The scratchpad path in `<context>` is the only source.
9. **Do NOT enable worktrees.** The corpus is 582 MB and gitignored; worktrees stay disabled.
10. **Do NOT renumber sections in `docs/models/statbotics-breakdown-reference.md`.** That file has
    two sections both numbered 20 (the residual-gaps one and the `avg.py` one). It is a real
    defect, it is OUT OF SCOPE here because the gap document and `measureEpaDeviations.ts` both
    cite section numbers by hand, and renumbering would silently break those citations. Note it in
    the SUMMARY as a follow-up; do not fix it.

**A concurrent Claude session is committing Phase 9 work into the shared index.** Never
`git add -A` and never `git add .`. Stage only your own files by explicit path, and always
`git commit -- <pathspec>`. After each commit, `git status` and confirm nothing foreign was
absorbed.

</forbidden>

<tasks>

<task type="auto">
  <name>Task 1: PART A — repair mechanism 8's body and re-derive its verdict</name>
  <files>docs/models/epa-statbotics-gap.md</files>
  <read_first>
    In `docs/models/epa-statbotics-gap.md`: the correction block at the top, the "How to read a
    verdict" table, the verdict matrix and the tally line beneath it, mechanism 5's HEADING and
    body, mechanism 8's body, and register R3's row 1.
    In `packages/core/algorithms/epa.ts`: `predictCore`'s `seasonScoreSd` selection.
    In `packages/core/algorithms/epaWeekOne.ts`: exactly which alliance scores the week-1
    accumulator folds and what the seal rule is.
    In `docs/models/statbotics-breakdown-reference.md`: section 20 (`avg.py`) and section 14's
    `k_func`.
  </read_first>
  <action>
Mechanism 8's body went stale when `epa@9.0.0+baseline` shipped. Register R3 row 1 was updated;
mechanism 8's own prose was not. Repair it, in place, without touching any other mechanism.

Three substantive errors to fix, each a claim of fact and not a wording preference:

1. It calls `self.year_obj.score_sd` *"a season-final constant"*. It is not season-final.
   `data/avg.py`'s `process_year` filters to `week_one_matches` and derives every `Year` aggregate
   from week 1 alone (reference section 20). State it as the WEEK-1 alliance-score SD, fouls
   included.
2. It says SigmaScout divides by *"an EXPANDING-WINDOW Welford SD over alliance scores already
   replayed"*. That was true before `9.0.0`. Since `9.0.0` the denominator is the FROZEN week-1 SD
   from week 2 onward, and the expanding estimate applies during week 1 only, with
   `EPA_FALLBACK_SCORE_SD = 25` before two observations exist. Describe both branches and say which
   applies when.
3. It argues *"adopting Statbotics' constant would leak season-end variance into a Week 1
   prediction."* That framing is wrong: the constant is week-1 data, so reading it is a walk-forward
   violation DURING week 1 only. Replace the argument, do not merely soften it.

**PRESERVE the algebraic-identity paragraph.** The `1 / (1 + 10 ** (k * norm_diff))` versus
`1 / (1 + exp(-margin / scale))` substitution is correct and load-bearing — sign, base and
coefficient all agree. It may be reflowed; its content must survive intact.

**RE-DERIVE the verdict rather than assuming it.** The body currently ends `DELIBERATE DIFFERENCE`
in all nine seasons, justified by an argument that is now wrong. Apply the SAME rule mechanism 5
was re-derived under by quick task 260911-l2k — read mechanism 5's heading and body and follow its
precedent, because two mechanisms in the same state must not carry different labels. In deciding,
account for BOTH remaining differences, not just the week-1 one:

- the week-1 window itself, where SigmaScout live-estimates and Statbotics reads a constant, and
- the POPULATION difference recorded as register R3 residual gap 4 — Statbotics filters an offline
  `week_one_matches` list, SigmaScout seals a streaming accumulator that can exclude a late week-0
  arrival and that skips ruling-zero alliances. Check `epaWeekOne.ts` for what is actually folded
  rather than asserting it.

Then make the document self-consistent:
- If the verdict CHANGES, update mechanism 8's row in the verdict matrix (all nine cells) AND
  recompute the tally line beneath the matrix by counting the table, not by adjusting the old
  numbers by hand. Confirm the three counts still sum to 99.
- If the verdict does NOT change, say so EXPLICITLY in the body — one sentence naming the residual
  that keeps it, and naming mechanism 5 as the precedent — so the next reader can see the label was
  re-derived and not merely left alone.

Also update mechanism 8's heading if the label changes, in mechanism 5's heading style (it reads
`PLACEMENT CLOSED, RATE ADOPTED FROM WEEK 2 (L-01 remainder)`).

Commit this on its own, before any Part B work, so a doc-only correction is separable from the
mechanism 1 work.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -n "season-final" docs/models/epa-statbotics-gap.md | sed -n '1,20p'</automated>
    Every surviving occurrence of `season-final` must be inside the top correction block or a
    register entry that is explicitly quoting-and-retracting the old wording — NOT inside
    mechanism 8's body. Read the output and confirm per line; do not treat a count of zero as the
    goal, because the correction block legitimately contains the phrase.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && awk '/^## The verdict matrix/,/^---$/' docs/models/epa-statbotics-gap.md | grep -c "DELIBERATE DIFFERENCE\|ALREADY MATCHES\|GAP"</automated>
    Then count the three labels across the matrix body rows by hand from that same slice and check
    the tally line states those three numbers and that they sum to 99.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -n "10 \*\* (k \* norm_diff)\|Math.LN10\|EPA_K" docs/models/epa-statbotics-gap.md</automated>
    The algebraic-identity paragraph must still be present.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain</automated>
    Only `docs/models/epa-statbotics-gap.md` may be staged by this task. If a foreign file appears,
    stop and stage by explicit path only.
  </verify>
  <done>
    Mechanism 8's body describes the week-1 aggregate correctly, describes both branches of
    SigmaScout's denominator correctly, carries a correct walk-forward argument scoped to week 1,
    retains the algebraic-identity paragraph, and carries a verdict that was re-derived under
    mechanism 5's precedent. The matrix row, the tally and the body agree. Committed alone, with
    only that one file in the commit.
  </done>
</task>

<task type="auto">
  <name>Task 2: PART B foundation — re-derive mechanism 1 into the score-read split, and name the deferral</name>
  <files>docs/models/epa-statbotics-gap.md</files>
  <read_first>
    `docs/models/statbotics-breakdown-reference.md` sections 2, 4, 17 (skim the structure only —
    do not read all 900 lines), 18 in full, and section 10.
    `packages/core/algorithms/epa.ts`'s `predictCore` — specifically the two
    `redOffensiveTotal`/`blueOffensiveTotal` reducers.
    `scripts/measureEpaDeviations.ts`'s `componentMapArm` and its mechanism-1 deviation-register
    entry.
    `docs/models/epa-statbotics-gap.md`'s mechanism 1, mechanism 11, and stages 4-7 of the
    recommended stage sequence.
  </read_first>
  <action>
Mechanism 1's body currently frames the gap as *"which entries and how many"* — a difference of
degree — and its per-season table's "what closing it requires" column reads as data entry. That
framing hides the structural reason it is not data entry, and the next agent will walk into it.
Re-derive the body so it carries the finding.

**The finding, verified during planning against both sides:**

- Statbotics rates an 18-slot vector, but `get_score_from_breakdown` READS only a per-season subset
  of it (reference section 18). For 2024 that subset is exactly one entry: `no_foul_points`.
- That vector DOUBLE-COUNTS by construction. Reference section 2's cleaner enforces
  `no_foul_points == auto_points + teleop_points + endgame_points`, and `comp_0..comp_9` are
  sub-elements within those same phases. So the rated vector is not an additive partition and never
  was — this is the same fact the mechanism-1 deviation-register entry in
  `scripts/measureEpaDeviations.ts` already records, and the two must not drift.
- SigmaScout's `predictCore` sums EVERY rated component except `FOULS_COMMITTED_COMPONENT` into the
  alliance's offensive total. **So in SigmaScout the rated set IS the score-read set.** There is no
  channel for a component that is rated but not scored.

Rewrite mechanism 1's body to state that, and to split the gap into two separable sub-gaps that
should never again be conflated:

- **1a — the SCORE-READ set.** What `get_score_from_breakdown` reads for that season. Buildable
  TODAY through the existing `componentMapArm` seam (commit b62c3655), with no interface change,
  for every season whose read is a linear sum of own-alliance entries.
- **1b — the FULL RATED vector**, including the entries the score never reads (they are display,
  API and RP quantities upstream). SigmaScout has no rated-but-not-scored channel at all, so 1b is
  not reachable without one. Say that plainly; do not design the channel here.

Add a **score-read column** to mechanism 1's per-season table, sourced from reference section 18,
so the next agent can see at a glance which seasons are 1a-cheap and which are not:
- one own entry (`no_foul_points`): 2016, 2017, 2019, 2022, 2024, 2025, 2026
- seven own entries: 2023
- seven own plus three OPPONENT entries, with the double-`zero_sigmoid` asymmetry: 2018
Carry section 18's three "must not miss" observations by reference, not by re-quoting them.

Also fold in these corrections, each one line, each because the document currently contradicts
itself:

- **The transcription blocker is already closed.** Reference section 17 carries all eleven
  cleaners verbatim plus `post_clean_breakdown`, mechanically checked. Mechanism 1 must not imply a
  fetch or a transcription is still owed. (Confirm this first — see `<preflight>`'s two-season
  spot-check, which is part of this task.)
- **The "Stages that are blocked on a fetch" section is stale.** It calls residual gap 1 — how the
  21 `Year` aggregate columns are computed — *"the single most valuable remaining fetch"*. That gap
  was closed by `avg.py` (reference section 20), and the correction block at the top of this very
  document already says so. Retract that bullet in place; leave residual gap 3
  (`models/template.py`) standing.

**Record the two decisions this plan makes, in the body, with their reasons:**

1. **The tracer season is 2024.** Reasons to record: mechanisms 2 and 11 already read
   `ALREADY MATCHES` for 2024, so a 2024 arm isolates mechanism 1 with nothing else moving;
   its score read is a single entry, so 1a is expressible in today's interface; and its cost is
   already approximately known (reference section 10 measured 0.7403 for a single no-foul total
   against 0.7520 for the shipped three phase groups — about 1.2 points of winner accuracy).
   **Record the 1.2-point figure, not the 1.7-point one**, and say why they differ: 1.7 points is
   the gap between the retired ELEVEN-component map and the shipped phase groups, which is a
   granularity measurement of this project's own maps and is NOT what adopting Statbotics' score
   read costs. Conflating them would overstate the price by half.
2. **The tracer lands as a measured ARM, not as the shipped default.** Reasons to record:
   mechanism 1 is only coherent when all nine seasons are done, and one season adopted alone leaves
   the model inconsistent across seasons; a faithful 2024 map collapses to two components, which
   would disturb `groups.ts`'s published phase metrics and `UNGROUPED_COMPONENTS` for a fidelity
   move that is not yet complete; and shipping it would incur republish debt on top of the debt
   already owed for `9.0.0` and `10.0.0`.

**Name the deferral explicitly, and key it to the stages this document already has** rather than
inventing a second grouping:
- 2019, 2022, 2025, 2026 — stage 5's remaining linear seasons, one quick task each, same shape as
  the 2024 tracer.
- 2023 — stage 6, first: seven entries, the 9-piece cascade, the cube/cone regrade, two `min()`
  caps. No opponent coupling.
- 2018 — stage 6, last: `zero_sigmoid`, the double-sigmoid asymmetry, opponent coupling,
  `post_clean_breakdown`'s four `*_power` ratios, and a dependency on register R4's three
  2018-only season aggregates.
- 2016, 2017 — stage 7, BLOCKED on the developer decision already recorded there (registers R1/R2,
  elimination matches folding RP predictions into the SCORE).

Do not change mechanism 1's nine `GAP` cells in the verdict matrix and do not change the tally —
this task closes nothing, it re-derives what closing would mean. Say so in the body.

Commit doc-only, separate from Task 1 and from Task 3.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && node -e "const fs=require('fs');const F=String.fromCharCode(10,96,96,96);const ref=fs.readFileSync('docs/models/statbotics-breakdown-reference.md','utf8');const src=fs.readFileSync(process.argv[1],'utf8');for(const y of [2024,2023]){const i=ref.indexOf('def clean_breakdown_'+y+'(');if(i<0){console.log(y,'MISSING from reference');continue;}const j=ref.indexOf(F,i);const block=ref.slice(i,j);console.log(y, src.includes(block)?'VERBATIM OK ('+block.length+' chars)':'MISMATCH');}" "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/a6c4c664-07f1-4630-9f25-d553556258fb/scratchpad/statbotics/tba_breakdown.py"</automated>
    Both seasons must print `VERBATIM OK`. Read the printed lines; do not infer from the exit code.
    A `MISSING` or `MISMATCH` means STOP and report — do not repair the reference here.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && awk '/^## Mechanism 1 /,/^## Mechanism 2 /' docs/models/epa-statbotics-gap.md | grep -c "score-read\|section 18"</automated>
    Must be non-zero — mechanism 1's body now cites the score-read distinction and section 18.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -n "single most valuable remaining fetch" docs/models/epa-statbotics-gap.md</automated>
    Any surviving occurrence must be inside an explicit retraction sentence. Read the line; an
    unqualified occurrence is a failure.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && awk '/^\| 1\. Rated component vector/' docs/models/epa-statbotics-gap.md</automated>
    The matrix row must still read `GAP` in all nine seasons.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain</automated>
    Only `docs/models/epa-statbotics-gap.md` staged.
  </verify>
  <done>
    Mechanism 1's body carries the rated-vector-versus-score-read finding, the per-season score-read
    column, the 1a/1b split, the two recorded decisions with their reasons, the corrected 1.2-point
    cost figure with the 1.7-point figure explained away, and the named deferral keyed to stages
    5-7. The stale "blocked on a fetch" bullet is retracted. The transcription spot-check passed on
    two seasons. Mechanism 1's nine `GAP` cells and the tally are unchanged. Committed alone.
  </done>
</task>

<task type="auto">
  <name>Task 3: PART B tracer — the 2024 faithful score-read map, measured as an arm, loss reported as found</name>
  <files>scripts/statboticsComponentMaps.ts, scripts/statboticsComponentMaps.test.ts, docs/models/epa-statbotics-gap.md, experiments/260911-pon/statboticsComps2024.ts</files>
  <read_first>
    `packages/core/algorithms/breakdown/2024.ts` in full, `packages/core/algorithms/breakdown/constants.ts`,
    `scripts/measureEpaDeviations.ts`'s `componentMapArm` and `armSeasonFor`,
    `experiments/260910-4x0/granularity.ts` in full (it is the replay-driver template),
    and `packages/core/algorithms/epa.ts`'s `carrySeason` signature.
  </read_first>
  <action>
Build the 2024 Statbotics-faithful SCORE-READ map, prove it, measure it, and record what it costs.

**Create `scripts/statboticsComponentMaps.ts`** exporting a `SeasonComponentMap` for 2024 that
emits exactly two components:
- one no-foul total — Statbotics' `no_foul_points`, the single entry `get_score_from_breakdown`
  reads for 2024 (reference section 18)
- `FOULS_COMMITTED_COMPONENT`, carried through unchanged from the shipped map

Build it by WRAPPING `breakdown2024.parse`, summing the shipped map's `auto`, `teleop` and
`endgame` outputs into the one total. Do not re-declare the TBA field list and do not write a
second Zod schema — the shipped parse is the proven boundary and a second copy would drift.
`no_foul_points == auto_points + teleop_points + endgame_points` is the identity Statbotics itself
enforces and prints `ERROR` when it fails (reference section 2), so this sum IS the quantity.

`adjust` is DROPPED, not relocated: reference section 2's shared cleaner puts `adjustPoints` on the
FOUL side, and since quick task 260911-l2k the foul side is a season scalar applied after the win
probability, not a per-team component. Record in the file header that `adjust` is pinned at exactly
0 per team (D-5), so this is expected to be numerically inert and any observed difference comes
from the granularity collapse, not from `adjust`.

The module is **not registered** in `SEASON_COMPONENT_MAPS` and `breakdown/2024.ts` is not edited.
Put it in `scripts/` so it cannot be mistaken for a shipped map. Its file header must state, in
one paragraph, that it exists to be driven through `componentMapArm` and is not a shipped default.

**Create `scripts/statboticsComponentMaps.test.ts`** proving, against real 2024 corpus breakdowns
(open the corpus read-only; if the corpus is unavailable, use fixtures already present in the repo's
existing breakdown tests rather than inventing numbers):
- `components` is exactly the two names, in a pinned equality assertion — an equality pin, never a
  loop over a list, because a test that ITERATES a hardcoded list silently skips a new entry.
- for a sample of real matches, the faithful map's no-foul total equals the shipped map's
  `auto + teleop + endgame` exactly, and equals the alliance's score minus `foulPoints` minus
  `adjustPoints` from the same raw payload (this is the additive identity, checked against data
  rather than assumed — if it fails on some matches, report the count and the event keys, do not
  paper over it).
- `foulsCommitted` is bit-identical to the shipped map's.
- the shipped `breakdown2024` is untouched: after calling the faithful map, `breakdown2024.components`
  still equals its five shipped names. This is the anti-monkey-patch guard — `granularity.ts`
  mutated the shipped object and this test exists so that cannot recur silently.

**Create `experiments/260911-pon/statboticsComps2024.ts`** — the replay driver. `experiments/` is
gitignored and throwaway; nothing in it is committed, and it exists so that `ARM_IDS` and
`data/diagnostics/epa-deviation-ablation.json` are not touched.
- Structure it on `experiments/260910-4x0/granularity.ts`: replay 2016 through 2023 ONCE off one
  shared carry, then score 2024 twice — once with the shipped map (baseline), once with the
  faithful map.
- Drive the arm through the SEAM, not by mutation: pass the faithful map as the third argument to
  `epa.update(...)` and to `epa.carrySeason(state, boundary2024, faithfulMap)`. Both, not one —
  `update` takes the match's own season's map and `carrySeason` takes the INCOMING season's, and
  passing one where the other belongs would express carried ratings in the wrong units and measure
  that mistake instead of the map.
- Score 2024's decided OFFICIAL matches only (exclude `OFFSEASON_EVENT_TYPE`, as the template does).
  Print, for each arm: scored count, winner accuracy, Brier. Print the difference both ways round
  with an explicit sign convention in the output text so it cannot be misread.
- **Run it in the background, redirect stdout and stderr to files under `experiments/260911-pon/`,
  and poll.** Verify by READING the output file, never by an exit code — `timeout <n> pnpm <cmd>`
  swallows output and exits 0 on this machine. Use `npx tsx`, not a `pnpm` wrapper.

**Report the result plainly in `docs/models/epa-statbotics-gap.md`**, in mechanism 1's 2024 row and
in one short paragraph beneath the table:
- the two arms' winner accuracy and Brier, the scored count, and the season and population
- the delta, stated as a LOSS if it is one, with no hedging and no search for a better variant
- that this is the measured cost of mechanism 1's sub-gap **1a for 2024 only**, that sub-gap 1b is
  untouched, and that 2024's matrix cell therefore stays `GAP`
- a comparison line against reference section 10's prior 0.7403/0.7520 figures, noting that this
  measurement runs on top of `epa@10.0.0+baseline` whereas that one predates it, so the two are not
  the same experiment even where the numbers are close

**On scorer comparability:** published Brier counts ties and scratch scripts usually do not. State
in the output and in the doc paragraph which convention this driver uses, and compare the two arms
only against EACH OTHER — never against a published Brier from a different scorer, or a ~0.003
shift will invent a regression that is not there.

**If the replay does not finish in a reasonable window**, report exactly which seasons completed
and record in the doc that the 2024 measurement is OUTSTANDING, with the driver path. Never
estimate, interpolate or carry forward a number from section 10 as if it were this run's result.

Commit `scripts/statboticsComponentMaps.ts`, its test, and the doc update together, by explicit
pathspec. `experiments/` is gitignored and must not appear in the commit.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run scripts/statboticsComponentMaps.test.ts 2>&1 | tail -30</automated>
    Run from the REPO ROOT, not from `apps/web` — root sees 167 test files, `apps/web` sees 77, and
    an 8-day red CI has hidden in that gap before. Read the printed pass/fail lines.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit 2>&1 | tail -20</automated>
    Root `tsc --noEmit` does NOT cover `apps/web`. This task does not touch `apps/web`, so the root
    run is sufficient — but confirm `git status` shows no `apps/web` file changed. If one did,
    run the web tsconfig too.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git diff --stat HEAD -- packages/core/algorithms/breakdown/ packages/core/algorithms/epa.ts apps/web/src/components/methodology/epaComparisonContent.ts data/diagnostics/epa-deviation-ablation.json | cat</automated>
    Must print NOTHING. Any output means a forbidden file was modified: the shipped 2024 map,
    `epa.ts`, `EPA_DIFFERENCE_IDS`, or the committed ablation artifact.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -c "ARM_IDS = \[BASELINE_ARM_ID, WINPROB_SEASON_SD_ARM_ID, WINPROB_FIXED_SD_ARM_ID\]" scripts/measureEpaDeviations.ts</automated>
    Must print `1` — `ARM_IDS` is unchanged.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && cat experiments/260911-pon/*.out 2>/dev/null | tail -40</automated>
    Read the two arms' accuracy, Brier and scored counts directly from the captured output. This is
    the measurement of record; do not restate a number that is not visible in this output.

    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain</automated>
    Only `scripts/statboticsComponentMaps.ts`, `scripts/statboticsComponentMaps.test.ts` and
    `docs/models/epa-statbotics-gap.md` may be staged. `experiments/` must not appear at all.
    A file staged by the concurrent session must not be absorbed — commit with an explicit pathspec.
  </verify>
  <done>
    `scripts/statboticsComponentMaps.ts` exists, exports a two-component 2024 map built by wrapping
    the shipped parse, is not registered anywhere, and is proven by a passing test that includes the
    shipped-map-untouched guard. The throwaway replay ran, its output is on disk, and mechanism 1's
    2024 row plus one paragraph report the two arms' accuracy and Brier as measured — including a
    loss, stated as a loss. The shipped 2024 map, `epa.ts`, `epa.version`, `ARM_IDS`,
    `EPA_DIFFERENCE_IDS` and the committed ablation artifact are all byte-unchanged. Committed by
    explicit pathspec with nothing foreign absorbed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| scratchpad Python source → reference doc claims | third-party bytes already on disk; no network, so the only risk is misreading, not injection |
| corpus `score_breakdown` JSON → the new map's parse | untrusted self-reported third-party payload, already gated by `breakdown2024`'s Zod schema, which this map wraps rather than bypasses |
| concurrent session's git index → this task's commits | another agent's staged files can be absorbed by a careless `git add` |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-pon-01 | Tampering | `scripts/statboticsComponentMaps.ts` parse path | medium | mitigate | Wrap `breakdown2024.parse`; never re-declare the field list or add a second Zod schema, so the proven finite-value boundary cannot be bypassed |
| T-pon-02 | Tampering | shipped `breakdown2024` object | high | mitigate | Drive the arm through `epa.update`/`carrySeason`'s third parameter; the test asserts `breakdown2024.components` is unchanged after use, closing the monkey-patch path `granularity.ts` used |
| T-pon-03 | Tampering | shared git index | high | mitigate | Never `git add -A`; stage by explicit path; `git commit -- <pathspec>`; `git status` after every commit |
| T-pon-04 | Information disclosure | `.env` | high | mitigate | No credential is needed; reading `.env` with any tool is forbidden outright by `<forbidden>` item 7 |
| T-pon-05 | Repudiation | the measured accuracy number | high | mitigate | The number of record is the one visible in `experiments/260911-pon/*.out`; carrying forward a prior figure as if it were this run's result is forbidden, and an unfinished run is reported as OUTSTANDING |
| T-pon-06 | Denial of service | free-tier R2 / published artifacts | low | accept | No republish and no R2 write is performed; nothing shipped changes, so no artifact is invalidated |
| T-pon-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package installs in this plan; if one becomes necessary, STOP — a legitimacy audit and blocking human checkpoint are required first |
</threat_model>

<verification>
Run at the end, before writing the SUMMARY:

1. `git log --oneline -4` — three commits, one per task, in order, each scoped to its own files.
2. `git status --porcelain` — clean, with nothing from the concurrent session absorbed.
3. `npx vitest run scripts/statboticsComponentMaps.test.ts` from the repo root — passing, read the
   output lines rather than the exit code.
4. `npx tsc --noEmit` from the repo root — clean. Triage any type error; do not batch-dismiss one
   as cosmetic (a "cosmetic" Worker type error on 2026-09-06 was a real live/offline divergence).
5. `git diff --stat HEAD~3 -- packages/ apps/ data/` prints nothing — no shipped code, no web
   surface and no committed artifact changed.
6. The gap document reads consistently end to end: the matrix, the tally and every mechanism body
   agree, and mechanism 1's nine cells are still `GAP`.
</verification>

<success_criteria>
- Mechanism 8's body is factually correct on all three points and its verdict was re-derived, not
  assumed; matrix, tally and body agree.
- Mechanism 1 carries the rated-vector-versus-score-read finding, the 1a/1b split, the per-season
  score-read column, both recorded decisions with reasons, and an explicit deferral of the eight
  non-tracer seasons keyed to stages 5-7.
- Exactly ONE season (2024) was built, behind the seam, as an arm — never shipped.
- The measured accuracy and Brier change is reported as found, including a loss, with no tuning,
  sweeping or arm selection anywhere in the work.
- Nothing shipped changed: no `epa.version` bump, no `ARM_IDS` change, no `EPA_DIFFERENCE_IDS`
  change, no republish, no BPR/SPR contact, no sealed-holdout spend.
</success_criteria>

<output>
Create `.planning/quick/260911-pon-mechanism-1-foundation-transcribe-cleani/260911-pon-SUMMARY.md` when done.

The SUMMARY must state, plainly and without softening:
- mechanism 8's re-derived verdict and whether it changed
- the two arms' measured numbers and the sign of the difference
- that eight seasons of mechanism 1 remain open, and in which grouping
- the duplicate section-20 numbering defect in `docs/models/statbotics-breakdown-reference.md`,
  recorded as a follow-up and deliberately not fixed here

**Write the SUMMARY yourself if you are the main context. A subagent is blocked from writing to
`SUMMARY.md` and must return the text instead of routing around the block via Bash.**
</output>
