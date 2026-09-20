/**
 * 2018 (FIRST POWER UP) component map.
 *
 * Scale is split from Switch as separate components: the Scale is a single
 * shared field element (only one alliance can own it at a time — measured
 * red-vs-blue correlation near-perfectly zero-sum), while each alliance's
 * own Switch is independent (ordinary alliance-vs-alliance variance).
 * Splitting the two keeps a future additivity treatment of the zero-sum
 * Scale possible; a fused "ownership" component would throw that away.
 *
 * The split reconstructs TBA's own fused halves exactly, 0 mismatches:
 * `autoOwnershipPoints === 2 * (autoSwitchOwnershipSec + autoScaleOwnershipSec)`,
 * `teleopOwnershipPoints === teleopSwitchOwnershipSec + teleopScaleOwnershipSec + teleopSwitchBoostSec + teleopScaleBoostSec`.
 * Auto ownership seconds score 2 pts/sec; teleop ownership seconds score
 * 1 pt/sec; a Boost second adds one extra point on top of the ownership
 * second it accompanies.
 *
 * `teleopSwitchForceSec`/`teleopScaleForceSec` are deliberately never read:
 * a Force second is a mode of already-being-owned, already folded into the
 * corresponding `*OwnershipSec` field — reading it too would double-count.
 * This is the one field pair whose omission looks most like an oversight;
 * it is not.
 *
 * TBA's roll-up totals and its two fused ownership fields are never read.
 * Reading the fused pair instead of the four split components here would
 * still reconcile perfectly against the alliance total — the corpus proof
 * alone cannot catch that substitution, since the fused form is numerically
 * identical — so `reconciliation.test.ts` also runs a source-text scan
 * asserting both ownership pairs are split in `components`.
 *
 * Also never read: the per-robot fields (positional correspondence to the
 * teams array is unverified), the `tba_gameData` randomization string, and
 * the vault detail fields (only `vaultPoints`, the total, is read).
 *
 * The roll-up identity `sum(offensive components) + foulsCommitted(opponent)
 * === totalPoints` fails on a small measured fraction of sides — proven to
 * be TBA's own arithmetic, not a mapping defect (both our auto and teleop
 * halves reconcile independently; every mismatching side also fails TBA's
 * own total identity). Recorded in `reconciliation.test.ts`'s named
 * tolerance, never tuned away.
 *
 * Validated at the parse boundary with Zod: every read field must be a
 * finite number, or `parse` throws rather than coercing a malformed field.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, ADJUST_POINTS_SCHEMA, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields are ignored, not rejected — zod's default "strip"
 * mode drops them without erroring. Deliberately not `.passthrough()`.
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
  adjustPoints: ADJUST_POINTS_SCHEMA,
  /** Points this alliance RECEIVED from the opponent's fouls, not points it committed. */
  foulPoints: z.number().finite(),
});

const Breakdown2018Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

type Side2018 = z.infer<typeof SideBreakdownSchema>;

/**
 * canonical component name -> extractor over one alliance's validated 2018
 * breakdown. Derived (not key-lookup) components, because the Scale/Switch
 * split requires arithmetic (the `2 *` auto multiplier, the Boost-second
 * addition), not a bare field rename.
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

    // Object.create(null) + a fixed allowlist loop: raw TBA JSON is never
    // spread onto the result, so a `__proto__` key cannot reach Object.prototype.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, extract] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = extract(own);
    }

    // Fouls committed by this alliance = points the OPPONENT received.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
