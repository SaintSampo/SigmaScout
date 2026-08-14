/**
 * 2025 (Reefscape) component map (D-02). Field inventory verified directly
 * against `data/corpus.sqlite` this session (2026-08-13, live query): every
 * key below was present in a real ingested 2025
 * `score_breakdown.red`/`.blue` object. All alliance-level — the per-robot
 * `autoLineRobot1/2/3`/`endGameRobot1/2/3` fields exist in the raw JSON but
 * are deliberately never read (RESEARCH.md Pitfall Sigma1-2 / Assumption A1).
 *
 * Roll-up avoidance: `autoPoints` and `teleopPoints` are roll-ups of the
 * fields below (plus mobility/algae/coral splits) — reading them alongside
 * their parts would double-count and break the reconciliation invariant.
 * `autoReef`/`teleopReef` are nested structural objects (per-node booleans
 * plus `tba_*Count` fields) carrying no point value and are never read.
 */
import { z } from "zod";
import type { ParsedComponents, SeasonComponentMap } from "./index.js";
import { ADJUST_COMPONENT, FOULS_COMMITTED_COMPONENT } from "./index.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this map reads.
 * Unknown extra fields (`autoReef`, `teleopReef`, `netAlgaeCount`,
 * `wallAlgaeCount`, the `g4xxPenalty` fields, the `RobotN` per-robot
 * fields, etc.) are ignored, not rejected — zod's default "strip" mode for
 * `.object()` drops them without erroring. Deliberately NOT
 * `.passthrough()`/`.loose()`, for the same typing reason `2024.ts`
 * documents.
 */
const SideBreakdownSchema = z.object({
  autoMobilityPoints: z.number().finite(),
  autoCoralPoints: z.number().finite(),
  teleopCoralPoints: z.number().finite(),
  algaePoints: z.number().finite(),
  endGameBargePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2025Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoMobility: "autoMobilityPoints",
  autoCoral: "autoCoralPoints",
  teleopCoral: "teleopCoralPoints",
  algae: "algaePoints",
  endGameBarge: "endGameBargePoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2025: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1). Recorded for plan 02-06's identifiability report.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2025Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;

    // Object.create(null) + a fixed allowlist loop (T-02-04): third-party
    // TBA JSON is never spread onto the result, so a `__proto__` key in the
    // raw payload cannot reach Object.prototype via this map.
    const result: ParsedComponents = Object.create(null) as ParsedComponents;
    for (const [canonical, tbaKey] of Object.entries(OWN_FIELD_COMPONENT_MAP)) {
      result[canonical] = own[tbaKey];
    }

    // Same D-04 derivation every other season module uses: the opposing
    // alliance's own `foulPoints` (points IT received) is exactly what THIS
    // alliance's fouls cost the opponent — season-agnostic, no per-season
    // foul point-value table needed.
    result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints;

    return result;
  },
};
