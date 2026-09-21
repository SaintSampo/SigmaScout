---
quick_id: 260920-qgg
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: false
requirements: [Q-1-absent-default, Q-2-blast-radius, Q-3-version-bump, Q-4-remeasure, Q-5-regression-guard, Q-6-foldphases-fallback, Q-7-shape-version]
files_modified:
  - packages/core/algorithms/breakdown/constants.ts
  - packages/core/algorithms/breakdown/2016.ts
  - packages/core/algorithms/breakdown/2017.ts
  - packages/core/algorithms/breakdown/2018.ts
  - packages/core/algorithms/breakdown/2019.ts
  - packages/core/algorithms/breakdown/2020.ts
  - packages/core/algorithms/breakdown/2022.ts
  - packages/core/algorithms/breakdown/2023.ts
  - packages/core/algorithms/breakdown/2024.ts
  - packages/core/algorithms/breakdown/2025.ts
  - packages/core/algorithms/breakdown/2026.ts
  - packages/core/algorithms/breakdown/breakdown.test.ts
  - packages/core/algorithms/breakdown/reconciliation.test.ts
  - packages/core/algorithms/spr.ts
  - packages/core/algorithms/spr.test.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epa.test.ts
  - packages/spr/softCredit.test.ts
  - data/baselines/level1-digest-2026-09.json
estimate:
  tokens: 80000
  raw_tokens: 160000
  tasks: 3
  confidence: high
must_haves:
  truths:
    - "A season breakdown whose only defect is an ABSENT adjustPoints parses, with the adjust component equal to 0; a breakdown carrying adjustPoints as null, a string, or a non-finite number still fails its schema (Q-1)."
    - "A real 2026 offseason match whose breakdown lacks only adjustPoints advances SPR's three phase filters, so published phases track total through an offseason event instead of freezing (Q-5)."
    - "No published winner probability or predicted score moves, for any algorithm, on any OFFICIAL match, in any season — measured, not assumed (Q-2, Q-4)."
    - "SPR and EPA each ship under a new MAJOR version because their published values move; OPR's version does not move because OPR never reads a score breakdown (Q-3)."
    - "A future season module that defaults a real SCORING field to zero fails a source gate; only the one shared adjust symbol is allowed to carry a default (Q-5)."
    - "STATE_SNAPSHOT_SHAPE_VERSION stays 16 — no state field is added, removed or retyped (Q-7)."
  artifacts:
    - packages/core/algorithms/breakdown/constants.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
    - data/baselines/level1-digest-2026-09.json
  key_links:
    - "constants.ts owns the single adjust schema symbol; all ten season modules spell the field through it, never with their own inline default."
    - "tryParseBreakdownPair's `parsed` outcome is the gate foldPhases (spr.ts) and the component observation (epa.ts) both stand behind — flipping a match to `parsed` moves both algorithms' published values at once."
    - "level1-digest-2026-09.json's per-entry algorithmVersion is checked against the live module BEFORE the stream SHA, so the version strings must move while the SHA256 values must not."
---

# 260920-qgg: SPR phases freeze at offseason events because TBA omits adjustPoints

<objective>
Every season's `SideBreakdownSchema` requires `adjustPoints`. TBA omits it on both
alliances at many offseason events, so the whole pair degrades to
`kind: "malformed"`. SPR's `foldPhases` then skips the match entirely (no phase
rating step, no `phaseScale` step) while `update` keeps folding `total` through the
lenient `correctionsOf`. Published `phaseAuto`/`phaseTeleop`/`phaseEndgame` freeze
while `total` moves — `frc4414` after `2026cc_qm69` shows total 316.31 against
phases summing to 141.4.

Purpose: make an ABSENT correction field mean "no correction" instead of
"unparseable match", without loosening anything else, and ship the moved published
numbers under new algorithm versions.

Output: a shared adjust schema symbol in `constants.ts` wired through all ten season
modules, three regression gates, and MAJOR version bumps for SPR and EPA.

## The measurements this plan is built on (done at plan time, read-only, against `data/corpus.sqlite`)

All figures below were measured, not assumed. The executor does not need to re-derive
them; they are recorded here because several tasks assert against them.

**Population.** Across every played match carrying a breakdown, `adjustPoints` appears
as a number on 345,464 alliance-sides and is **ABSENT** on 12,210 (= 6,105 matches x 2
sides). It is **never** present-but-invalid — not `null`, not a string, not non-finite,
not once, anywhere in the corpus. So "default on absent only" masks nothing that exists
today, and the present-but-invalid path stays a loud failure with no live traffic on it.

**Zero official matches are affected.** Every OFFICIAL match in every registered season
already parses. The entire malformed population is offseason (event type 99).

**The fix does not flip every malformed offseason match — and must not.** Of 6,230
currently-malformed offseason matches, **5,066 flip to `parsed`** and **1,164 stay
malformed**, because those 1,164 are missing real SCORING components too:

| season | flips to parsed | stays malformed | why it stays |
|--------|-----------------|-----------------|--------------|
| 2016 | 445 | 0 | — |
| 2017 | 378 | 0 | — |
| 2018 | 420 | 0 | — |
| 2019 | 454 | 0 | — |
| 2020 | 0 | 0 | — |
| 2022 | 866 | 76 | cargo/foul/taxi/endgame fields absent |
| 2023 | 0 | 1,039 | the 1,008 adjust-missing rows ALSO lack `autoChargeStationPoints`, `endGameChargeStationPoints`, `endGameParkPoints` |
| 2024 | 955 | 49 | note/stage/park fields absent |
| 2025 | 1,317 | 0 | — |
| 2026 | 231 | 0 | — |

2023 gains nothing from this fix. That is the correct outcome: an absent
charge-station points field is an absent OBSERVATION, and defaulting it to 0 would
publish "this alliance scored nothing on the charge station" as though it were
measured. Only `adjust` — a scorekeeper correction, not robot performance — is safe
to read as 0 when absent.

**Blast radius, measured by replaying both arms (Q-2).**

- **OPR: untouched.** `opr.ts` contains no reference to `breakdown`, `scoreBreakdown`
  or any season component map. It cannot move. Its version does not bump.
- **SPR predictions: untouched, everywhere.** `update`'s scoring target is
  `result.redScore - redFoul - redAdjust` via `correctionsOf`, which reads
  `adjustPoints` leniently already (absent -> 0). A full 2026 two-arm replay diffed
  **0 / 18,372 official and 0 / 2,502 non-official** `pRedWin`/`redScore` values.
  `phaseTeams`/`phaseScale` are read in exactly one place — `teamMetrics` — and
  `predict` never touches them.
- **SPR published PHASE metrics: they move.** Full ten-season chained replay
  (carry threaded exactly as `publishSeasons` threads it), counting metric rows whose
  emitted `teamMetrics` differ:

  | season | official rows changed | non-official rows changed |
  |--------|----------------------|---------------------------|
  | 2016 | 0 / 13,286 | 0 / 2,286 (cold-start season: `state.season` is null all season, so phases never fold in 2016 at all) |
  | 2017 | 0 / 15,429 | 1,876 / 2,902 |
  | 2018 | 0 / 16,930 | 1,725 / 3,594 |
  | 2019 | 0 / 18,022 | 1,619 / 3,605 |
  | 2020 | 0 / 4,634 | 0 / 103 |
  | 2022 | 0 / 14,645 | 2,643 / 3,367 |
  | 2023 | 0 / 16,316 | 0 / 3,878 |
  | 2024 | 0 / 16,977 | 4,739 / 5,122 |
  | 2025 | 0 / 17,846 | 5,783 / 5,963 |
  | 2026 | **208** / 18,372 | 1,742 / 2,502 |

  The 2026 official 208 are real and are the one cross-over case: `2026wima`
  (Synthwave Showdown, offseason, 2026-06-26) is the only offseason event in the
  corpus that PRECEDES official play in its own season — the Israel district events
  `2026isde1` / `2026isde2` / `2026iscmp` run 2026-06-28 through 2026-07-06 after it.
  No `2026wima` team appears in any of those 208 matches; they move anyway because
  `phaseScale` is a LEAGUE-scoped quantity and now steps on 29 extra matches.
- **Cross-season carry: unaffected except 2026.** Both `spr` and `epa` declare
  `carryFrom: "last-official-match"`, and `replay.ts` snapshots `carryStates` at the
  last official match. In every season except 2026 the flipped matches come strictly
  after that instant, so the carried state is byte-identical (verified per season).
  2026's carry differs, which matters only for a future 2027 publish.
- **EPA: published component values move; predictions do not.** EPA currently routes
  these matches through `fallbackObserved` -> `distributeResidual`, a proportional
  split; once parsed it uses the real components. Two-arm replay:
  **0 / 18,372 official predictions changed in 2026** (the strictest case, the one
  season with an offseason event ahead of official play), and **0 / 18,372 official
  metric rows changed**; 1,516 / 2,502 non-official prediction rows and 1,516
  non-official metric rows changed in 2026, 5,079 / 5,963 in 2025.
- **Ranking points: untouched.** `packages/core/rankingPoints/meanShift.ts` reads
  `scoreBreakdownRaw` with a bare `JSON.parse`, never through a season map.
- **Published accuracy / Brier / calibration: byte-identical.** `score.ts` excludes
  every offseason candidate before scoring (`exclusionCounts.offseason`), and no
  official prediction moves. So the headline published numbers do not move at all.

## Answers to the questions this plan was asked (Q-1 .. Q-7)

- **Q-1.** Default `adjustPoints` to 0 on ABSENT only, via one shared exported schema
  symbol in `constants.ts` that all ten season modules use. Zod's default applies to
  `undefined` alone, so `null`, `"12"` and `NaN` still fail — which is exactly the
  present-but-invalid case the corpus proves does not exist and which must keep failing
  if it ever appears.
- **Q-2.** Answered in full above. SPR published phase values and EPA published
  component/total/phase values move; no winner probability or predicted score moves on
  any official match; OPR does not move at all.
- **Q-3.** `SPR_VERSION` 6.0.0+baseline -> **7.0.0+baseline**; `epa.version`
  11.0.0+baseline -> **12.0.0+baseline**; OPR stays 5.0.0+baseline. Five files carry a
  string that must move — enumerated in Task 3, with the list of look-alike hits that
  must NOT move.
- **Q-4.** No official prediction moves and offseason candidates are excluded from
  every published score, so accuracy and Brier cannot move. The re-measure therefore
  collapses to a cheap IDENTITY PROOF rather than an open measurement: capture
  `captureCompareSlices` before and after and assert every slice is unchanged. That is
  in Task 3.
- **Q-5.** Three gates, in Task 1 and Task 2: an offseason-shape reconciliation block
  (so a future missing REQUIRED key at offseason fails loudly instead of silently
  degrading), an SPR test that a breakdown lacking only `adjustPoints` advances phases
  and that phases track total across an offseason event, and a comment-stripped source
  gate forbidding any season module from defaulting any field other than the shared
  adjust symbol.
- **Q-6. Recommend NO, and keep it out of scope.** `foldPhases` should not get an
  EPA-style residual fallback. EPA's fallback exists because EPA's components ARE its
  rating and a dropped match is a dropped observation; SPR's phases are display-only
  and an absent key already renders as "not measured", which is the honest claim. After
  this fix the remaining 1,164 malformed matches are missing real scoring components,
  so a proportional split would publish an imputed auto/teleop/endgame value as though
  it had been observed — a worse defect than the frozen value this plan fixes. It would
  also add a noise/weighting knob the project has repeatedly declined. Record the
  recommendation in the `foldPhases` doc comment; add no code.
- **Q-7. Confirmed: `STATE_SNAPSHOT_SHAPE_VERSION` must stay 16.** No field is added,
  removed or retyped on `SprState` or `EpaState`; only values move. `apps/worker` picks
  the fix up from `packages/core` on deploy with no Worker-side edit. The D1 seed must
  still be re-run because the VALUES change and because `localPricingFixture.ts`
  refuses a seed whose version string differs from the bundled `SPR_VERSION`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@packages/core/algorithms/breakdown/constants.ts
@packages/core/algorithms/breakdown/index.ts
@packages/core/algorithms/breakdown/2026.ts
@packages/core/algorithms/breakdown/reconciliation.test.ts
@packages/core/algorithms/breakdown/breakdown.test.ts
</context>

<environment>
- Another agent is editing this same checkout. Do NOT touch
  `apps/worker/src/scheduled.ts`, `apps/worker/src/stateStore.ts`,
  `packages/harness/seedSql.ts`, `packages/harness/publish.ts`,
  `packages/ingest/normalize.ts`, or `docs/worker-operations.md`. This plan needs none
  of them. Stage by explicit path, never `git add -A`.
- Run tests as `npx vitest run <paths>` from the REPO ROOT. Never
  `timeout <n> pnpm <cmd>` — it swallows output and exits 0. Judge by the printed
  pass/fail counts, not by exit code.
- Root `tsc --noEmit` does not cover `apps/web`. This plan touches no `apps/web`
  source, so the root typecheck is sufficient here.
- You have no network. Never read `.env`.
</environment>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: one shared adjust schema, wired through 2026, proven end to end on the reported match</name>
  <precondition>`data/corpus.sqlite` exists and contains the 2026 season; the corpus-backed assertions below skip explicitly rather than pass silently if it does not.</precondition>
  <files>packages/core/algorithms/breakdown/constants.ts, packages/core/algorithms/breakdown/2026.ts, packages/core/algorithms/breakdown/reconciliation.test.ts, packages/core/algorithms/spr.test.ts</files>
  <read_first>packages/core/algorithms/breakdown/constants.ts, packages/core/algorithms/breakdown/2026.ts (lines 31-53), packages/core/algorithms/breakdown/index.ts (lines 155-171), packages/core/algorithms/spr.ts (lines 695-751, 883-923)</read_first>
  <behavior>
    Write these first; they fail before the change and pass after.
    - `tryParseBreakdownPair(2026, raw)` where `raw` is a real 2026 offseason
      breakdown with no `adjustPoints` key on either side returns
      `kind: "parsed"`, and `red.adjust === 0` and `blue.adjust === 0`.
    - The same payload with `adjustPoints: null` on one side returns
      `kind: "malformed"`; with `adjustPoints: "12"` returns `kind: "malformed"`;
      with `adjustPoints: NaN` returns `kind: "malformed"`. Absent is the ONLY
      admitted shape.
    - Reconciliation still holds for the repaired payload: sum(offensive
      components) + foulsCommitted(opponent) === that alliance's `totalPoints`,
      within 1e-6, for every 2026 offseason match that flips.
    - SPR: replaying 2026 from a non-cold-start state (season set via
      `carrySeason` with `isColdStart: false`) up to and including `2026cc_qm69`,
      `teamMetrics(state, ["frc4414"])["frc4414"]` emits all three of
      `phaseAuto`, `phaseTeleop`, `phaseEndgame`, and their values sum to the
      `total` value within a stated tolerance. Before the change the three keys
      are absent, which is itself worth asserting as the "before" half if you
      write the red step as a temporary local arm.
  </behavior>
  <action>
Add one exported schema symbol to `constants.ts` — name it for what it is (TBA's
scorekeeper-correction field), not for the mechanism. It is `z.number().finite()`
with a zero applied when the input is `undefined`. Give it a doc comment in this
package's established voice recording: the measurement (345,464 sides carry a
number, 12,210 have the key missing, zero sides carry it as any other shape); that
absent means no scorekeeper correction was applied, which is a real and knowable
value rather than an imputation; that a present-but-unreadable value must keep
failing because it means the opposite — the field exists and we cannot trust it;
and that no SCORING field may ever be given the same treatment, because an absent
scoring field is an absent observation and zero would be a false claim.
`constants.ts` is currently a dependency-free leaf; importing `zod` there is fine
since zod is external and creates no package-internal cycle — say so in the header
so the next reader does not "restore" the leaf by moving the symbol back out.

Wire `2026.ts` to spell `adjustPoints` through the shared symbol instead of its own
inline `z.number().finite()`. Leave every other field in that file exactly as it is.

Add the corpus-backed assertions from `<behavior>` to
`reconciliation.test.ts` as a new describe block. Follow the file's existing
discipline exactly: `openCorpusReadOnly`, explicit `it.skip` with both paths named
when the corpus is absent, never a silent pass. Select the fixture row by querying
for a 2026 offseason match whose stored breakdown has no `adjustPoints` key rather
than hardcoding a match key, so the block keeps working if the corpus is re-ingested.

Add the SPR phase assertions from `<behavior>` to `spr.test.ts`. Build the stream
with `buildSeasonStream(db, 2026, { includeOffseason: true })` and seed the state
through `spr.carrySeason(spr.initState(teams), { fromSeason: 2025, toSeason: 2026,
isColdStart: false })` — a state straight from `initState` has a null season and
`foldPhases` returns unchanged for it, so a test written without the carry proves
nothing and passes vacuously either way. Assert the non-vacuousness explicitly:
the three phase keys must be PRESENT, not merely equal to something.

Do not touch the other nine season modules in this task.
  </action>
  <verify>
    <automated>npx vitest run packages/core/algorithms/breakdown/reconciliation.test.ts packages/core/algorithms/spr.test.ts</automated>
  </verify>
  <done>The four `<behavior>` groups pass with non-zero assertion counts printed. `frc4414` at `2026cc_qm69` emits three phase values summing to its total. A 2026 payload carrying `adjustPoints` as null, a string or NaN still yields `kind: "malformed"`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: roll the shared symbol through the other nine seasons and add the anti-masking gates</name>
  <files>packages/core/algorithms/breakdown/2016.ts, packages/core/algorithms/breakdown/2017.ts, packages/core/algorithms/breakdown/2018.ts, packages/core/algorithms/breakdown/2019.ts, packages/core/algorithms/breakdown/2020.ts, packages/core/algorithms/breakdown/2022.ts, packages/core/algorithms/breakdown/2023.ts, packages/core/algorithms/breakdown/2024.ts, packages/core/algorithms/breakdown/2025.ts, packages/core/algorithms/breakdown/breakdown.test.ts, packages/core/algorithms/breakdown/reconciliation.test.ts</files>
  <read_first>packages/core/algorithms/breakdown/2022.ts, packages/core/algorithms/breakdown/2023.ts, packages/core/algorithms/breakdown/breakdown.test.ts (lines 120-175), packages/core/algorithms/breakdown/reconciliation.test.ts (lines 413-469, the 2018 source-gate block, as the pattern to copy)</read_first>
  <behavior>
    - `breakdown.test.ts`'s existing expectation that a 2024 payload missing
      `adjustPoints` on both sides is `{ kind: "malformed", issueCount: 2 }` is now
      WRONG and must be inverted: that payload parses, and both sides carry
      `adjust === 0`. Keep the real-shape citation in the test name — that shape is
      the reason this fix exists, so the test should read as the fix's own
      regression pin, not as a deleted assertion.
    - The neighbouring "only `autoLeavePoints` per side" test must still be
      malformed with an issueCount of at least 10. Confirm by running it, not by
      arithmetic.
    - New: an offseason-shape block in `reconciliation.test.ts`, iterating
      `BREAKDOWN_REGISTERED_SEASONS` (never a hand-written season list — an
      iteration over a literal list silently skips a newly registered season), that
      for each season samples offseason matches and asserts the COUNT of
      still-malformed rows equals a named, committed per-season expectation:
      2016:0, 2017:0, 2018:0, 2019:0, 2020:0, 2022:76, 2023:1039, 2024:49, 2025:0,
      2026:0. Each non-zero entry carries a one-line comment naming the missing
      SCORING fields that keep it malformed. A season whose count RISES fails — that
      is the "a future missing required key at offseason fails loudly" guard.
    - New: a comment-stripped source gate over all ten season modules asserting
      that the literal `.default(` appears in NONE of them, paired with a POSITIVE
      assertion that every one of the ten imports the shared adjust symbol by name
      from `./constants.js`. Copy the comment-stripping mechanics from the existing
      "2018 Scale/Switch split source gate" block verbatim.
  </behavior>
  <action>
Change `adjustPoints` in each of the nine remaining season modules to spell the
field through the shared symbol from `./constants.js`, exactly as Task 1 did for
2026. Nine identical one-line edits plus nine import additions. Change nothing else
in any of those files — no other field, no component list, no diagnostic key.

Update the two `breakdown.test.ts` expectations and add the two new gate blocks to
`reconciliation.test.ts` per `<behavior>`.

The per-season still-malformed counts in the new block are measurements, not
guesses; they are recorded in this plan's objective and were taken against
`data/corpus.sqlite` at plan time. If your run disagrees with any of them, that is a
finding — report it, do not edit the expectation to match. Note in the block's doc
comment that 2023 gains nothing from this change because its 1,008 adjust-missing
rows also lack three charge-station scoring fields, and that this is the correct
outcome rather than an unfinished fix.

In the source gate's own doc comment, say plainly why the negative half exists: the
corpus proof cannot catch a season module that quietly supplies a zero for a
SCORING field it failed to read, because a zeroed component still reconciles
whenever the alliance genuinely scored nothing there. Only a source scan catches it.

Also add the Q-6 recommendation to `foldPhases`'s doc comment in `spr.ts` if you
have not already: no residual fallback for phases, and the reason (the surviving
malformed population is missing real observations, and imputing them would publish
an unmeasured auto/teleop/endgame value as measured). Comment only; no code.
  </action>
  <verify>
    <automated>npx vitest run packages/core/algorithms/breakdown/</automated>
  </verify>
  <done>Every test under `packages/core/algorithms/breakdown/` passes. The source gate fails if a default is introduced into any season module, demonstrated once by temporary local mutation before you revert it. The per-season still-malformed counts match the committed table exactly.</done>
</task>

<task type="auto">
  <name>Task 3: version bumps, the guarded level-1 baseline, and the published-number identity proof</name>
  <precondition>The owner has explicitly approved this bump including the edit to `data/baselines/level1-digest-2026-09.json`; do not open a checkpoint for it.</precondition>
  <files>packages/core/algorithms/spr.ts, packages/core/algorithms/epa.ts, packages/core/algorithms/epa.test.ts, packages/spr/softCredit.test.ts, data/baselines/level1-digest-2026-09.json</files>
  <read_first>packages/core/algorithms/spr.ts (lines 240-272), packages/core/algorithms/epa.ts (lines 1140-1170), packages/harness/level1Digest.test.ts (lines 30-38, 146-190, 242-290)</read_first>
  <action>
Move `SPR_VERSION` from 6.0.0+baseline to 7.0.0+baseline and `epa.version` from
11.0.0+baseline to 12.0.0+baseline. MAJOR on both, for the reason the project rule
names: published numbers move. Extend each module's existing version-history comment
block in its established voice with a new paragraph citing this quick task id,
stating what moved and what did not — for SPR, that phase values move at 5,066
offseason matches and at 208 official 2026 rows via the league-scoped phase scale,
and that `predict`, `pRedWin`, `redScore`, `blueScore` and the match band are
untouched; for EPA, that component values move at offseason rows only and that a
two-arm replay measured zero changed official predictions in 2026, the one season
with an offseason event ahead of official play. Say in both that this is a data-shape
correction, not an accuracy claim.

Then move the version strings in exactly these places and nowhere else:

  1. `packages/core/algorithms/spr.ts` — `SPR_VERSION`
  2. `packages/spr/softCredit.test.ts` — the equality pin near line 107
  3. `packages/core/algorithms/epa.ts` — the `version` field near line 1157
  4. `packages/core/algorithms/epa.test.ts` — the equality pin near line 1677
  5. `data/baselines/level1-digest-2026-09.json` — the `algorithmVersion` field on
     the `epa` entry and on the `bpr` entry (`bpr` is SPR's frozen pre-rename wire
     id; the test resolves it through a one-entry alias). The three
     `predictionStreamSha256` values MUST NOT change: that baseline's slice is three
     2022 OFFICIAL events selected with offseason excluded, so this fix cannot reach
     it. If a SHA moves, stop and report — that is a real finding, not a baseline to
     refresh.

Leave these look-alike hits alone; each was checked at plan time and none is a pin
on the live version:
  - `scripts/measureRpCalibration.test.ts` and
    `data/baselines/rp-calibration-2026-09f.json` — a frozen measurement record
    pinned against the committed FILE, measured on official play only, which this
    fix does not move.
  - `apps/web/src/lib/api/epaComparison.test.ts`,
    `scripts/publishEpaComparison.test.ts`,
    `apps/web/src/components/ribbon/AlgorithmSelect.test.tsx`,
    `apps/web/src/components/event/InsightsTab.test.tsx`,
    `apps/web/src/routes/__fixtures__/*.json` — arbitrary fixture strings.
  - `docs/models/epa-divergences.md`, `docs/models/epa-vs-statbotics.md` — historical
    citations of an OLDER epa@6.0.0, unrelated to today's spr@6.0.0.
  - `docs/publish-budget.md` — rewritten automatically by the owed
    `publish:seasons --write-budget` run.
  - `packages/core/algorithms/opr.ts` and `opr.test.ts` — OPR reads no breakdown and
    does not bump.

Confirm, and state in the SUMMARY, that `STATE_SNAPSHOT_SHAPE_VERSION` is still 16
and that no `SprState` or `EpaState` field was added, removed or retyped.

Finally, run the published-number identity proof. Capture compare slices before and
after the change and diff them:

  git stash push -- (only the source files this plan changed)
  npx tsx scripts/captureCompareSlices.ts --out <scratch>/before.json
  git stash pop
  npx tsx scripts/captureCompareSlices.ts --out <scratch>/after.json
  npx tsx scripts/captureCompareSlices.ts --diff <scratch>/before.json <scratch>/after.json

Every season and the pooled row must show a delta of exactly 0.00000 on both
accuracy and Brier, and an unchanged scored count, for every algorithm. Any non-zero
delta contradicts the measurement this plan is built on and is a finding to report
rather than a number to accept. The script publishes with `dryRun`, so it needs no
network and no credentials; if it demands credentials, stop and report — do not read
`.env`. Write the capture files to the scratch directory, never into the repo.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run</automated>
  </verify>
  <done>Root typecheck clean. The full root suite passes — note the printed file count is ~167 from the repo root against ~77 from `apps/web`; you must be at the root. `level1Digest.test.ts` passes with the two version strings moved and all three SHA256 values unchanged. The compare-slice diff prints 0.00000 on accuracy and Brier for every algorithm, every season, and pooled.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA JSON -> season Zod schema | Third-party, self-reported offseason payloads cross into rating and display state here. This change LOOSENS that boundary, so the gates below exist to bound exactly how far. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qgg-01 | Tampering | `constants.ts` shared adjust schema | medium | mitigate | Default applies to `undefined` only. A present-but-unreadable `adjustPoints` (null, string, non-finite) still fails the schema — asserted three ways in Task 1. |
| T-qgg-02 | Tampering | the nine other season modules | high | mitigate | Comment-stripped source gate (Task 2) forbids any default in any season module, paired with a positive assertion that all ten import the one shared symbol. Prevents the fix being copied onto a SCORING field, where a zero would be a fabricated observation. |
| T-qgg-03 | Information disclosure | published phase/component values | medium | mitigate | Per-season still-malformed count expectations (Task 2) fail if a future season starts silently degrading, so "not measured" can never quietly become "measured as zero". |
| T-qgg-04 | Tampering | `data/baselines/level1-digest-2026-09.json` | high | mitigate | Only the two `algorithmVersion` strings move; the three `predictionStreamSha256` values are asserted unchanged by the test itself, and the independent `FROZEN_AT_09_01_STREAM_SHA256` pin re-derives opr and bpr from source. A moved SHA is escalated, never refreshed. |
| T-qgg-SC | Tampering | npm/pip/cargo installs | high | n/a | No package is installed by this plan. No legitimacy gate required. |
</threat_model>

<verification>
- `npx vitest run` from the repo root: full suite green (~167 files).
- `npx tsc --noEmit` from the repo root: clean.
- `scripts/captureCompareSlices.ts --diff`: 0.00000 accuracy and Brier delta on every
  algorithm, every season, pooled, with unchanged scored counts.
- `data/baselines/level1-digest-2026-09.json`: exactly two changed fields
  (`entries[epa].algorithmVersion`, `entries[bpr].algorithmVersion`); `git diff` on
  that file shows no other line.
- `STATE_SNAPSHOT_SHAPE_VERSION` still 16.
- `git status`: nothing staged outside this plan's `files_modified`, and none of the
  six files the concurrent agent owns is touched.
</verification>

<success_criteria>
- An offseason breakdown whose only defect is an absent `adjustPoints` parses, with
  `adjust` equal to 0, in all ten registered seasons.
- `frc4414` at `2026cc_qm69` publishes three phase values that sum to its total.
- No official prediction, on any algorithm, in any season, changes — proven by the
  compare-slice identity diff and by the unchanged level-1 digest SHAs.
- SPR ships as 7.0.0+baseline and EPA as 12.0.0+baseline; OPR is untouched.
- A future season module that defaults any field fails a committed source gate.
</success_criteria>

<output>
Create `.planning/quick/260920-qgg-spr-phases-freeze-at-offseason-events-be/260920-qgg-SUMMARY.md` when done.

Return the SUMMARY text to the orchestrator rather than writing it yourself if the
Write tool blocks you on that path; do not route around it with a heredoc.

## Owed after the code lands — ORCHESTRATOR, not the executor

The executor has no network. Every item below must be run from the main context:

1. `pnpm publish:seasons` (full run, all seasons, `--write-budget`) — republishes every
   artifact under `spr@7.0.0+baseline` and `epa@12.0.0+baseline`. Commit the rewritten
   `docs/publish-budget.md` afterwards.
2. D1 seed import from the new generation's seed files. Required even though the state
   SHAPE is unchanged, because the VALUES move and because `localPricingFixture.ts`
   refuses a seed whose version differs from the bundled `SPR_VERSION`. Watch the
   ~100k row-write daily cap; roughly four seed passes exhaust it.
3. Worker deploy — `npx wrangler deploy` on a clean tree (not
   `pnpm --filter worker deploy`, which hits pnpm's built-in and deploys nothing).
   `apps/worker` needs no source edit; it picks the fix up from `packages/core`.
4. R2 cleanup of the superseded generation and of the now-orphaned
   `spr@6.0.0+baseline` / `epa@11.0.0+baseline` objects, via the list-driven
   `pnpm cleanup:r2-generations`. Never a sampled census.
5. Docs/methodology copy: grep the shipped site copy for a named algorithm version
   before deploying. At plan time no `apps/web` copy file names a version string, so
   this is expected to be a no-op — confirm rather than assume.
6. After pushing, `gh run list` — a Windows-local green has hidden a red Linux CI for
   days before.
</output>
