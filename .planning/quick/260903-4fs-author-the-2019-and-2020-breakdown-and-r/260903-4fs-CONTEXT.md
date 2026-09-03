# Quick Task 260903-4fs: 2019/2020 breakdown + RP rule modules - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Task Boundary

Author and register four season modules so the corpus backfill
(`.planning/todos/pending/extend-corpus-2019-2020.md`) can replay 2019 and 2020:

1. `packages/core/algorithms/breakdown/2019.ts`
2. `packages/core/algorithms/breakdown/2020.ts`
3. `packages/core/algorithms/sigma1/rp/2019.ts`
4. `packages/core/algorithms/sigma1/rp/2020.ts`

plus their registry entries in `breakdown/index.ts`'s `SEASON_COMPONENT_MAPS` and
`rp/rules.ts`'s `RP_RULE_MODULES`.

**Both kinds are needed or neither works.** `carrySeason` calls `componentMapForSeason(toSeason)`
AND `rpRuleModuleForSeason(toSeason)` unconditionally, and `predict`/`update` both call
`rpRuleModuleForSeason`. Each throws for an unregistered season, so a season is either fully
registered or unusable.

**The corpus already has the data** (ingested 2026-09-03, verified): 2019 = 21,899 matches /
14,929 official quals with breakdown; 2020 = 4,763 / 3,820. Both reconciliation suites
(`breakdown/reconciliation.test.ts`, `rp/reconciliation.test.ts`) iterate the registry and read
`data/corpus.sqlite`, so registering these seasons puts them under test automatically.

</domain>

<decisions>
## Implementation Decisions — LOCKED, all four DERIVED FROM DATA

Every rule below was measured over every in-season qualification alliance-side, not cited from a
game manual. Full method and tables live in `docs/data/tba-rp-thresholds-2019-2020.md`,
`docs/data/tba-rocket-rp-2019.md`, `docs/data/tba-rp-rates-2019-2020.md` and
`docs/data/tba-field-recon-2019-2020.md`. **Cite those documents in the module doc comments as the
verification method**, the way `rp/2022.ts` cites its manual plus reconciliation.

### RP-1 - 2019 HAB Docking: `habClimbPoints >= 15`

**100.00% agreement at ALL THREE event tiers** (base n=24,340; districtChampionship n=2,802;
championship n=2,716). Not one disagreement across 29,858 sides. **Not tiered** - encode 15 at all
three tiers and note in a comment that the flatness was measured, not assumed.

Threshold variable: `habClimbPoints`, unit `"points"`.

### RP-2 - 2019 Complete Rocket: `completedRocketNear || completedRocketFar`

98.19% agreement overall; **0.00% false positives at every tier**; 1.81% false negatives. It
under-fires and never over-fires - the conservative direction this codebase already prefers.

**CRITICAL asymmetry - `parse` and `predictThresholds` differ for this bonus:**

- **`parse`** recomputes from `completedRocketNear || completedRocketFar`. Both are booleans in the
  raw breakdown and are available at parse time.
- **`predictThresholds` CANNOT use them** - it receives only numeric threshold-variable values (the
  Monte Carlo draw in `rp/distribution.ts` samples threshold variables, never a breakdown). So the
  rocket bonus takes the **CONSERVATIVE BRANCH: always `false`**, following 2025's `autoBonus`
  precedent, which `RpRuleModule.predictThresholds`'s own doc comment already documents as the
  established pattern for a bonus with no threshold-variable-only fallback.

  Measured understatement is ~0.0654 RP per alliance-match - roughly 10x SMALLER than the 0.625464
  already shipped for 2025 `autoBonus`. Cite that comparison in the comment so the choice reads as
  precedent-following rather than a shortcut.

Rejected: a joint `hatchPanelPoints`/`cargoPoints` threshold. The best variant scored 94.49% -
worse than `near || far` - and introduced 0.51% FALSE POSITIVES, violating never-overstate.

### RP-3 - 2020 Shield Operational: `endgamePoints >= 65`

**100.00% agreement** (n=7,640).

**Record this prominently; it is the reason these rules were derived rather than cited.** The
intuitive control-panel rule (`stage2Activated`) scores **85.21%**, which is BELOW the **85.35%**
obtained by always guessing false. It would key on a field true 0.5% of the time to predict an
event that happens 14.7% of the time. This RP is an ENDGAME bonus, not a control-panel bonus.

**Tier caveat, must be stated in the module:** 2020 was cancelled before any district championship
or championship, so **only `base` tier exists in the data**. The other two tiers carry 65 as an
ASSUMPTION, not a measurement. Say so explicitly rather than letting the uniform triple imply it
was verified.

Threshold variable: `endgamePoints`, unit `"points"`.

### RP-4 - 2020 Shield Energized: NOT MODELLED

It fired **0 times in 7,640 alliance-sides**; `stage3Activated` is likewise exactly 0. The observed
`rp` total maxes at 3 and never reaches 4, independently confirming it.

It is **not** in `bonusNames` and gets no threshold variable. Therefore 2020's `maxRp` is
`2 + 1 = 3` and 2019's is `2 + 2 = 4`. (`rules.test.ts` asserts `maxRp === winRp +
bonusNames.length`, so this follows structurally - do not hand-write a different number.)

Do NOT read `shieldEnergizedRankingPoint` into `recordedBonusFlags`: a recorded flag with no
matching recomputed flag breaks the paired shape the reconciliation test relies on. Put it in
`diagnosticKeys` instead, with a comment noting it is always false in this corpus.

### BD-1 - Component maps: roll-up avoidance is the main hazard

`reconciliation.test.ts` checks that components sum to the alliance total, so emitting BOTH a part
and its sum double-counts and fails. Derived from `docs/data/tba-field-recon-2019-2020.md`:

**2019** - read `sandStormBonusPoints`, `hatchPanelPoints`, `cargoPoints`, `habClimbPoints`,
`adjustPoints`, plus `FOULS_COMMITTED_COMPONENT` from the OPPONENT's `foulPoints` (the D-04
derivation every existing map already uses).
NEVER read: `autoPoints` (numerically identical to `sandStormBonusPoints` in every observed row -
a duplicate, not an independent component), `teleopPoints` (= hatch + cargo + habClimb),
`totalPoints`.

**2020** - read `autoInitLinePoints`, `autoCellPoints`, `teleopCellPoints`, `controlPanelPoints`,
`endgamePoints`, `adjustPoints`, plus `FOULS_COMMITTED_COMPONENT` from the opponent's `foulPoints`.
NEVER read: `autoPoints` (= autoInitLine + autoCell), `teleopPoints` (= teleopCell + controlPanel
+ endgame), `totalPoints`.

**Verify these roll-up identities against the corpus rather than trusting this note.** The
arithmetic above was spot-checked on sampled rows, not proven exhaustively - proving it is exactly
what the reconciliation test is for.

### BD-2 - Per-robot fields are NEVER read

`endgameRobot1/2/3`, `habLineRobot1/2/3`, `preMatchLevelRobot1/2/3`, `initLineRobot1/2/3`. Pitfall
Sigma1-2 / Assumption A1: the positional correspondence between `RobotN` fields and the team array
is unverified. Every existing map applies this discipline and these two must too. They may appear
in `diagnosticKeys`.

### Claude's Discretion

- Canonical component names (follow the 2022/2026 naming style).
- Which extra fields land in `diagnosticKeys`.
- Whether `KNOWN_TOLERANCES` entries are needed and their exact values - DERIVE these from an
  actual test run, never guess a tolerance to make a test pass.

</decisions>

<specifics>
## Specific Ideas

**Expected reconciliation outcomes, so a real failure is distinguishable from an expected gap:**

- 2019 `habDocking` and 2020 `shieldOperational` should reconcile at or very near 100%. If either
  does not, something is wrong with the MODULE - investigate it, do not paper over it with a
  tolerance.
- 2019 `completeRocket` is expected to under-fire on ~1.8% of alliance-sides with ZERO over-fires.
  A tolerance entry is legitimate there. An over-fire is not, and means a bug.

**Follow `rp/2022.ts` and `breakdown/2022.ts` as the structural templates:** a Zod `SideSchema`
using `.finite()`/`.boolean()` in default strip mode (never `.passthrough()`/`.loose()`),
`Object.create(null)` plus a fixed allowlist loop (T-02-04 - never spread third-party JSON onto a
result), `assertFiniteThresholdVariables`, and `RpTieredThreshold` triples even where untiered.

**Do NOT run** a tuning search, a publish, a promote, or a full harness replay. Modules, registry
entries and tests only. The corpus is already ingested; nothing needs re-fetching.

**A backup exists** at `data/corpus.sqlite.bak-pre-2019-2020` if the corpus ever needs restoring.
Do not delete it.

</specifics>

<canonical_refs>
## Canonical References

- `docs/data/tba-field-recon-2019-2020.md` - complete observed `score_breakdown` key sets
- `docs/data/tba-rp-thresholds-2019-2020.md` - the threshold sweeps
- `docs/data/tba-rocket-rp-2019.md` - the rocket-rule comparison
- `docs/data/tba-rp-rates-2019-2020.md` - base rates and season sizes
- `packages/core/algorithms/breakdown/2022.ts` and `.../2026.ts` - component-map templates
- `packages/core/algorithms/sigma1/rp/2022.ts` - RP module template
- `packages/core/algorithms/sigma1/rp/constants.ts:95-224` - `RpThresholdVariable`,
  `RpParsedResult`, `RpRuleModule`, and the conservative-branch contract
- `.planning/todos/pending/extend-corpus-2019-2020.md` - the parent job

</canonical_refs>
