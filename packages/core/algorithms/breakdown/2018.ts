/**
 * 2018 (FIRST POWER UP) component map. Field inventory confirmed directly
 * against `data/corpus.sqlite` (2026-09-07, `2018abca_qm1`, 37 keys per
 * side). Corpus-wide reconciliation figures below are measured over the
 * FULL official (non-offseason) qualification population, **n = 28,312
 * alliance-sides** (2026-09-06/07).
 *
 * **Why Scale is SPLIT from Switch (D-1, a locked user decision, 2026-09-07,
 * not an implementation preference).** The Scale is a single SHARED field
 * element — only one alliance can physically own it at a time — while each
 * alliance's own Switch is independent. Measured red-vs-blue correlation:
 * `teleopScaleOwnershipSec` **-0.9109** (near-perfectly zero-sum) against
 * `teleopSwitchOwnershipSec` **-0.1362** (mildly negative, ordinary
 * alliance-vs-alliance variance, not a shared-resource signature). Splitting
 * the two into separate components is what keeps a future additivity
 * treatment of the zero-sum Scale possible at all — collapsing them into one
 * fused "ownership" component the way a naive port of 2019's shape would do
 * throws away exactly the distinction that treatment would need.
 *
 * **The split reconstructs TBA's own fused halves EXACTLY — 0 mismatches in
 * 28,312 official qual alliance-sides, BOTH halves:**
 *
 * - auto: `autoOwnershipPoints === 2 * (autoSwitchOwnershipSec + autoScaleOwnershipSec)`
 * - teleop: `teleopOwnershipPoints === teleopSwitchOwnershipSec + teleopScaleOwnershipSec + teleopSwitchBoostSec + teleopScaleBoostSec`
 *
 * Scoring rates: auto ownership seconds score 2 pts/sec; teleop ownership
 * seconds score 1 pt/sec; a Boost second adds one EXTRA point on top of the
 * ownership second it accompanies. **Force seconds
 * (`teleopSwitchForceSec`/`teleopScaleForceSec`) are already counted inside
 * the ownership seconds above and must NOT be added again** — see the named
 * hazard below.
 *
 * **The Force hazard.** `teleopSwitchForceSec` and `teleopScaleForceSec`
 * exist in the raw payload and are DELIBERATELY never read. A Force second
 * is a mode of already-being-owned (forcing the mechanism open), not an
 * additional quantity of ownership — it is already folded into the
 * corresponding `*OwnershipSec` field. Reading it alongside the ownership
 * field would double-count. This is the one field pair whose omission looks
 * most like an oversight; it is not.
 *
 * **The roll-up hazards.** TBA's three total-shaped fields (`autoPoints`,
 * `teleopPoints`, `totalPoints`) and its two FUSED ownership fields
 * (`autoOwnershipPoints`, `teleopOwnershipPoints`) are never read. Reading
 * the fused pair INSTEAD of the four split components here would still
 * reconcile perfectly against the alliance total — the corpus proof alone
 * cannot catch that substitution, because the fused form is numerically
 * identical. The source gate in `reconciliation.test.ts` (a comment-stripped
 * text scan for these field names, plus a positive assertion that both
 * ownership pairs are split in `components`) is what catches it instead —
 * the identical hazard-and-remedy shape `2019.ts`'s header documents for its
 * own numerically-identical `autoPoints`/`sandStormBonusPoints` roll-up.
 *
 * **Per-robot fields never read** (Pitfall Sigma1-2 / Assumption A1):
 * `autoRobot1/2/3`, `endgameRobot1/2/3` — positional correspondence to
 * `red_teams`/`blue_teams` array order is unverified, same discipline every
 * other component map in this package applies. Also never read: the
 * `tba_gameData` field-randomization string, and the `vaultBoostPlayed/Total`,
 * `vaultForcePlayed/Total`, `vaultLevitatePlayed/Total` detail fields — only
 * `vaultPoints` (the point total) is read.
 *
 * **The measured residual (D-2) — TBA's own arithmetic, not ours.** The
 * roll-up identity `sum(offensive components) + foulsCommitted(opponent) ===
 * totalPoints` fails on **196 / 28,312 sides (0.692%)** — 188 at magnitude 1,
 * 8 at magnitude 2. Proven not to be a component-map defect three ways: (1)
 * TBA's own auto half reconciles 0/28,312 against our auto components; (2)
 * TBA's own teleop half reconciles 0/28,312 against our teleop components;
 * (3) **all 196 of 196** mismatching sides also fail *TBA's own* identity
 * `totalPoints == autoPoints + teleopPoints + foulPoints + adjustPoints`.
 * Same class as `2019.ts`'s documented clamp-at-zero artifact — recorded
 * here and in `reconciliation.test.ts`'s named tolerance, never tuned away.
 *
 * **The offseason null note.** 140 alliance-sides (all from one offseason
 * event) carry null `adjustPoints` and null `autoSwitchAtZero`. The existing
 * `tryParseBreakdownPair` malformed-degradation path already covers that
 * class, and this reconciliation is scoped to official (non-offseason) data
 * anyway.
 *
 * Validated at the parse boundary with Zod (T-02-01, ASVS V5): every read
 * field must be a finite number, or `parse` throws rather than coercing an
 * absent/malformed field to 0.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `autoOwnershipPoints`, `teleopOwnershipPoints`, `teleopSwitchForceSec`,
 * `teleopScaleForceSec`, `autoRobot1/2/3`, `endgameRobot1/2/3`,
 * `tba_gameData`, `vaultBoostPlayed/Total`, `vaultForcePlayed/Total`,
 * `vaultLevitatePlayed/Total`, `rp`, etc.) are ignored, not rejected — zod's
 * default "strip" mode drops them without erroring. Deliberately NOT
 * `.passthrough()`/`.loose()`, matching every other season map's discipline.
 */
const SideBreakdownSchema = z.object({
  autoRunPoints: z.number().finite(),
  autoSwitchOwnershipSec: z.number().finite(),
  autoScaleOwnershipSec: z.number().finite(),
  teleopSwitchOwnershipSec: z.number().finite(),
  teleopScaleOwnershipSec: z.number().finite(),
  teleopSwitchBoostSec: z.number().finite(),
  teleopScaleBoostSec: z.number().finite(),
  vaultPoints: z.number().finite(),
  endgamePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2018Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

type Side2018 = z.infer<typeof SideBreakdownSchema>;

/**
 * canonical component name -> extractor over one alliance's validated 2018
 * breakdown. Derived (not key-lookup) components — copying `2026.ts`'s
 * extractor-function shape, not `2019.ts`'s plain key-lookup shape — because
 * D-1's split requires arithmetic (the `2 *` auto multiplier, the
 * Boost-second addition), not a bare field rename.
 */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, (side: Side2018) => number>> = {
  autoRun: (side) => side.autoRunPoints,
  autoSwitchOwnership: (side) => 2 * side.autoSwitchOwnershipSec,
  autoScaleOwnership: (side) => 2 * side.autoScaleOwnershipSec,
  teleopSwitchOwnership: (side) => side.teleopSwitchOwnershipSec + side.teleopSwitchBoostSec,
  teleopScaleOwnership: (side) => side.teleopScaleOwnershipSec + side.teleopScaleBoostSec,
  vault: (side) => side.vaultPoints,
  endgame: (side) => side.endgamePoints,
  [ADJUST_COMPONENT]: (side) => side.adjustPoints,
};

export const breakdown2018: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1).
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2018Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, extract] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = extract(own);
    }

    // Same D-04 derivation every other season module uses: the opposing
    // alliance's own `foulPoints` (points IT received) is exactly what THIS
    // alliance's fouls cost the opponent.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
