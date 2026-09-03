/**
 * 2019 (Destination: Deep Space) component map. Field inventory verified
 * against `data/corpus.sqlite` this session (2026-09-03) via
 * `docs/data/tba-field-recon-2019-2020.md`'s live-query field recon
 * (51 distinct `score_breakdown` keys sampled from `2019caoc`) and
 * corpus-wide roll-up-identity reconciliation over the full non-offseason
 * breakdown-bearing population (18,051 sides).
 *
 * Never read (Pitfall Sigma1-2 / Assumption A1): `endgameRobot1/2/3`,
 * `habLineRobot1/2/3`, `preMatchLevelRobot1/2/3` — per-robot fields,
 * positional correspondence to `red_teams`/`blue_teams` array order is
 * unverified, same discipline every other component map in this package
 * applies.
 *
 * Validated at the parse boundary with Zod (T-02-01, ASVS V5): every read
 * field must be a finite number, or `parse` throws rather than coercing an
 * absent/malformed field to 0.
 *
 * Roll-up avoidance (BD-1) — TWO hazards specific to 2019, both stated here
 * because a naive substitution would still reconcile:
 *
 * - `autoPoints` is NUMERICALLY IDENTICAL to `sandStormBonusPoints` in
 *   every observed row. Reading `autoPoints` instead of the sandstorm field
 *   would be a duplicate, not an independent component — AND
 *   reconciliation would still PASS, because the two values are equal. The
 *   comment-stripped source gate in `reconciliation.test.ts` (asserting
 *   `autoPoints`/`teleopPoints`/`totalPoints` appear nowhere outside a
 *   comment in this file) is the only thing that can catch this particular
 *   substitution — the corpus proof alone cannot.
 * - `teleopPoints` equals `hatchPanelPoints + cargoPoints + habClimbPoints`.
 *   Reading it alongside the three parts would double-count.
 *
 * Verified against the corpus rather than trusted: **1 mismatch / 18,051
 * sides** in the roll-up identity check over the FULL population — two
 * distinct matches, one bad side each, both ELIMINATION matches:
 * `2019lake_qf4m1` (red) and `2019nccmp_f1m2` (blue). Both carry a large
 * negative scorekeeper `adjustPoints` (-74 and -85 respectively) that
 * drives the component sum below zero (to -10 and -1) while TBA floors the
 * reported `totalPoints` at 0 — TBA's own clamp-at-zero behaviour, not a
 * component-map defect. Both sit outside `reconciliation.test.ts`'s
 * 2,000-row sampling window (ordered by `match_key` ascending, ending at
 * `2019casd_qm79`; these two rank 5,620 and 10,729), so the suite passes at
 * 0 today — for a sampling reason. Recorded here so a future sample-size
 * increase meets a documented artifact instead of a mystery.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./constants.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `bay1`..`bay8`, `preMatchBay*`, `*RocketFar`/`*RocketNear` per-bay detail,
 * `endgameRobot1/2/3`, `habLineRobot1/2/3`, `preMatchLevelRobot1/2/3`,
 * `completedRocketFar`/`completedRocketNear`,
 * `habDockingRankingPoint`/`completeRocketRankingPoint`, `rp`, etc.) are
 * ignored, not rejected — zod's default "strip" mode drops them without
 * erroring. Deliberately NOT `.passthrough()`/`.loose()`, matching every
 * other season map's discipline.
 */
const SideBreakdownSchema = z.object({
  sandStormBonusPoints: z.number().finite(),
  hatchPanelPoints: z.number().finite(),
  cargoPoints: z.number().finite(),
  habClimbPoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2019Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  sandstormBonus: "sandStormBonusPoints",
  hatchPanel: "hatchPanelPoints",
  cargo: "cargoPoints",
  habClimb: "habClimbPoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2019: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1).
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2019Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Same D-04 derivation every existing map uses: the quantity a per-team
    // "fouls committed" component must represent is what THIS alliance cost
    // the OPPONENT, which is the opposing alliance's own `foulPoints`
    // (points IT received) for the same match — season-agnostic, no
    // per-season foul point-value table needed. `foulCount`/`techFoulCount`
    // are raw counts, not point values, and are never read here; they are
    // aliased above in `diagnosticKeys` only.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
