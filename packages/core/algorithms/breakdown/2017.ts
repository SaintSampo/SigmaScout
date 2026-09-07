/**
 * 2017 (FIRST STEAMWORKS) component map. Field inventory confirmed directly
 * against `data/corpus.sqlite` (2026-09-07, `2017abca_qm1`, 34 keys per
 * side). Every component here is a BARE FIELD READ with no arithmetic, so
 * this file takes `2019.ts`'s plain key-lookup shape rather than `2018.ts`'s
 * extractor-function shape — only `2018.ts`'s header discipline (named
 * hazards, measured figures, an explicit never-read list) is carried over.
 *
 * **Inert until a publish lands.** `FIRST_SEASON` in
 * `apps/web/src/lib/seasons.ts` is still 2019 and no 2017 artifacts exist in
 * R2, so registering this map makes 2017 computable by the harness and the
 * corpus suites — it does NOT make 2017 visible on the site. Publish, then
 * reveal.
 *
 * **THE CENTRAL FACT — the two playoff-only bonus fields.**
 * `kPaBonusPoints` and `rotorBonusPoints` are **always 0 in qualification
 * matches** and are **real points in playoff matches**, where TBA counts
 * them INSIDE its own `teleopPoints` roll-up and therefore inside
 * `totalPoints`. They are read here as first-class components (`kPaBonus`,
 * `rotorBonus`) for exactly that reason. Measured 2026-09-07 over official
 * playoff matches: including them gives **0 mismatches** against TBA's own
 * `teleopPoints`; omitting them gives **1,195 / 5,500 mismatching sides**.
 *
 * **This suite PROVES that inclusion rather than trusting it.**
 * `reconciliation.test.ts`'s 2,000-row window is ordered by `match_key`
 * ascending with **no `comp_level` filter**, and within an event `f` < `qf`
 * < `qm` < `sf`, so finals and quarterfinals sort BEFORE quals. The 2017
 * window spans `2017abca_f1m1` .. `2017code_qm15` and contains **51 `f` +
 * 185 `qf` + 123 `sf` + 1,641 `qm`** — it is playoff-inclusive, so dropping
 * either bonus component turns the suite red on a playoff match key. The
 * **RP** suite (`sigma1/rp/reconciliation.test.ts`), by contrast, genuinely
 * IS qual-scoped, which is why the hazard still deserves naming here: a
 * reader who generalises "the reconciliations are qual-scoped" from the RP
 * side to this side would conclude these two fields are optional detail.
 * They are not.
 *
 * **The measured residual: there is none.** The roll-up identity
 * `sum(own components) + adjust + foulPoints === totalPoints` holds with
 * **0 mismatches over 30,880 official non-offseason alliance-sides, ALL comp
 * levels** (measured 2026-09-07). 2017 therefore takes **no
 * `KNOWN_BREAKDOWN_TOLERANCES` entry of any kind** — stated explicitly so a
 * future reader knows the absence is a measured result rather than an
 * oversight, and so that any exception appearing later is treated as a
 * component-map error rather than as an occasion to add a tolerance.
 *
 * **Additivity.** corr(red, blue) on `totalPoints` = **+0.3293**, inside the
 * normal +0.24..+0.52 band observed across seasons, so 2017 needs no
 * normalization treatment. 2018 (**-0.4567**) remains the only
 * anti-additive season.
 *
 * **Never read**, and deliberately so:
 *  - The roll-ups `autoPoints`, `teleopPoints`, `totalPoints` (BD-1) —
 *    reading any of them alongside their parts would double-count.
 *  - The per-robot fields `robot1Auto`/`robot2Auto`/`robot3Auto` and
 *    `touchpadFar`/`touchpadMiddle`/`touchpadNear` (Pitfall Sigma1-2 /
 *    Assumption A1) — positional correspondence to `red_teams`/`blue_teams`
 *    array order is unverified, the same discipline every other component
 *    map in this package applies.
 *  - `tba_rpEarned`.
 *  - The `rotor1Auto`/`rotor2Auto` and `rotor1Engaged`..`rotor4Engaged`
 *    booleans and the `kPaRankingPointAchieved`/`rotorRankingPointAchieved`
 *    booleans — these belong to the RP module (`sigma1/rp/2017.ts`), which
 *    reads the latter two as recorded bonus flags. None is a point value and
 *    none is ever emitted as a component.
 *  - The raw fuel counts `autoFuelHigh`/`autoFuelLow`/`teleopFuelHigh`/
 *    `teleopFuelLow` — counts, not point values (Pitfall Sigma1-1). The
 *    scored value of that fuel is already in
 *    `autoFuelPoints`/`teleopFuelPoints`.
 *
 * `diagnosticKeys` lists ONLY `foulCount` and `techFoulCount`. Its single
 * consumer (`packages/harness/identifiability.ts:253`) treats every listed
 * name as a FOUL field and increments `matchesWithAnyFoulRecorded` when any
 * one of them exceeds zero, so listing any other raw count here would
 * publish a bogus foul rate in `reports/identifiability.json`.
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
 * `autoFuelHigh`/`autoFuelLow`/`teleopFuelHigh`/`teleopFuelLow`,
 * `robot1Auto`/`robot2Auto`/`robot3Auto`,
 * `touchpadFar`/`touchpadMiddle`/`touchpadNear`, `rotor1Auto`/`rotor2Auto`,
 * `rotor1Engaged`..`rotor4Engaged`, `kPaRankingPointAchieved`,
 * `rotorRankingPointAchieved`, `tba_rpEarned`, `rp`, etc.) are ignored, not
 * rejected — zod's default "strip" mode drops them without erroring.
 * Deliberately NOT `.passthrough()`/`.loose()`, matching every other season
 * map's discipline.
 */
const SideBreakdownSchema = z.object({
  autoMobilityPoints: z.number().finite(),
  autoFuelPoints: z.number().finite(),
  autoRotorPoints: z.number().finite(),
  teleopFuelPoints: z.number().finite(),
  teleopRotorPoints: z.number().finite(),
  teleopTakeoffPoints: z.number().finite(),
  /**
   * Always 0 in quals, real points in playoffs, counted by TBA inside its
   * own `teleopPoints`. See "THE CENTRAL FACT" in the file header — these
   * two are load-bearing, not optional detail.
   */
  kPaBonusPoints: z.number().finite(),
  rotorBonusPoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2017Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoMobility: "autoMobilityPoints",
  autoFuel: "autoFuelPoints",
  autoRotor: "autoRotorPoints",
  teleopFuel: "teleopFuelPoints",
  teleopRotor: "teleopRotorPoints",
  teleopTakeoff: "teleopTakeoffPoints",
  kPaBonus: "kPaBonusPoints",
  rotorBonus: "rotorBonusPoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2017: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1). Held to exactly these two: this list's single
  // consumer treats every name in it as a foul field.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2017Schema.parse(rawBreakdownJson);
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
