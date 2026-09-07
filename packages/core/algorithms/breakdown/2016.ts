/**
 * 2016 (FIRST STRONGHOLD) component map. Field inventory confirmed directly
 * against `data/corpus.sqlite` (2026-09-07, `2016abca_qm1`, 39 keys per
 * side). Every component here is a BARE FIELD READ with no arithmetic, so
 * this file takes `2019.ts`'s plain key-lookup shape rather than `2018.ts`'s
 * extractor-function shape — only `2018.ts`'s header discipline (named
 * hazards, measured figures, an explicit never-read list) is carried over.
 *
 * **Inert until a publish lands.** `FIRST_SEASON` in
 * `apps/web/src/lib/seasons.ts` is still 2019 and no 2016 artifacts exist in
 * R2, so registering this map makes 2016 computable by the harness and the
 * corpus suites — it does NOT make 2016 visible on the site. Publish, then
 * reveal.
 *
 * **THE CENTRAL FACT — the two playoff-only bonus fields.**
 * `breachPoints` and `capturePoints` are **always 0 in qualification
 * matches** and are **real points in playoff matches**, where TBA counts
 * them INSIDE its own `teleopPoints` roll-up and therefore inside
 * `totalPoints`. They are read here as first-class components (`breach`,
 * `capture`) for exactly that reason. Measured 2026-09-07 over official
 * playoff matches: including them gives **0 mismatches** against TBA's own
 * `teleopPoints`; omitting them gives **3,974 / 4,446 mismatching sides**.
 *
 * **This suite PROVES that inclusion rather than trusting it.**
 * `reconciliation.test.ts`'s 2,000-row window is ordered by `match_key`
 * ascending with **no `comp_level` filter**, and within an event `f` < `qf`
 * < `qm` < `sf`, so finals and quarterfinals sort BEFORE quals. The 2016
 * window contains **47 `f` + 189 `qf` + 84 `sf` + 1,680 `qm`** — it is
 * playoff-inclusive, so dropping either bonus component turns the suite red
 * on a playoff match key. The **RP** suite
 * (`sigma1/rp/reconciliation.test.ts`), by contrast, genuinely IS
 * qual-scoped, which is why the hazard still deserves naming here: a reader
 * who generalises "the reconciliations are qual-scoped" from the RP side to
 * this side would conclude these two fields are optional detail. They are
 * not.
 *
 * **The measured residual: three sides, all eliminations, all +/-25.** The
 * roll-up identity `sum(own components) + adjust + foulPoints ===
 * totalPoints` fails on **3 / 26,604 official non-offseason alliance-sides
 * (0.01128%), ALL comp levels** (measured 2026-09-07):
 *
 * | match | side gap |
 * |---|---|
 * | `2016capl_f1m1` | **+25** |
 * | `2016milsu_qf4m1` | **+25** |
 * | `2016mndu2_f1m2` | **-25** |
 *
 * **This is TBA's own arithmetic, not a mapping defect**, proven the same
 * three ways `2018.ts`'s header uses: our auto half reconciles **0/3**
 * against TBA's own `autoPoints`; our teleop half reconciles **0/3** against
 * TBA's own `teleopPoints`; and **all 3 of 3** also fail TBA's OWN
 * `totalPoints == autoPoints + teleopPoints + foulPoints + adjustPoints`
 * identity with the exact OPPOSITE-signed gap. Exactly one of the three —
 * `2016capl_f1m1`, blue side, +25 — falls inside the suite's current
 * `SAMPLE_SIZE=2000` window, giving **red 0/2000 and blue 1/2000**. 2016
 * therefore carries a named `KNOWN_BREAKDOWN_TOLERANCES` entry in
 * `reconciliation.test.ts`; see that entry's own comment for its sizing and
 * for why it deliberately records NO `direction` (the three signs are
 * mixed).
 *
 * **Additivity.** corr(red, blue) on `totalPoints` = **+0.3416**, inside the
 * normal +0.24..+0.52 band observed across seasons, so 2016 needs no
 * normalization treatment. 2018 (**-0.4567**) remains the only
 * anti-additive season.
 *
 * **THE 2016 NAMING TRAP.** `position2`/`position3`/`position4`/`position5`
 * are **STRINGS** — the defense NAMES ("A_ChevalDeFrise", "B_Ramparts", ...)
 * — while `position1crossings`..`position5crossings` are the **NUMBERS**.
 * There is deliberately no `position1` string: the low bar sits in position
 * 1 every match and is not chosen, so TBA ships a crossings count for it but
 * no name. Reading `position2` where `position2crossings` was meant is a
 * plausible mistake, and `z.number().finite()` catches it LOUDLY rather than
 * coercing — said here rather than left to luck. None of those fields is
 * read by THIS module in either form; the crossings are read by the **RP**
 * module (`sigma1/rp/2016.ts`) as threshold variables for the Breach bonus.
 *
 * **Never read**, and deliberately so:
 *  - The roll-ups `autoPoints`, `teleopPoints`, `totalPoints` (BD-1) —
 *    reading any of them alongside their parts would double-count.
 *  - The per-robot fields `robot1Auto`/`robot2Auto`/`robot3Auto` and
 *    `towerFaceA`/`towerFaceB`/`towerFaceC` (Pitfall Sigma1-2 / Assumption
 *    A1) — positional correspondence to `red_teams`/`blue_teams` array order
 *    is unverified, the same discipline every other component map in this
 *    package applies.
 *  - `tba_rpEarned`.
 *  - The `teleopDefensesBreached`/`teleopTowerCaptured` booleans — these
 *    belong to the RP module (`sigma1/rp/2016.ts`), which reads both as
 *    recorded bonus flags. Neither is a point value and neither is ever
 *    emitted as a component; the SCORED value of a breach or a capture is
 *    already in `breachPoints`/`capturePoints` above.
 *  - The raw counts `autoBouldersLow`/`autoBouldersHigh`/
 *    `teleopBouldersLow`/`teleopBouldersHigh`,
 *    `position1crossings`..`position5crossings` and `towerEndStrength` —
 *    counts, not point values (Pitfall Sigma1-1). Their scored value is
 *    already in the boulder and crossing point fields. The crossings and the
 *    tower ARE read, but by the RP module as threshold variables.
 *
 * `diagnosticKeys` lists ONLY `foulCount` and `techFoulCount`. Its single
 * consumer (`packages/harness/identifiability.ts:253`) treats every listed
 * name as a FOUL field and increments `matchesWithAnyFoulRecorded` when any
 * one of them exceeds zero. Listing `towerEndStrength` or the five
 * `position{i}crossings` here — as would be natural, since 2016 has more
 * unread raw counts than any other season — would make that predicate true
 * for essentially every 2016 match in which any defense was crossed, and so
 * publish a near-100% 2016 foul rate in `reports/identifiability.json` and
 * in that harness's printed summary line. Those six fields are not
 * "unread": they are read by the RP module, which is the correct home for
 * them.
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
 * `autoBouldersLow`/`autoBouldersHigh`/`teleopBouldersLow`/
 * `teleopBouldersHigh`, `position1crossings`..`position5crossings`,
 * `position2`..`position5`, `towerEndStrength`,
 * `robot1Auto`/`robot2Auto`/`robot3Auto`,
 * `towerFaceA`/`towerFaceB`/`towerFaceC`, `teleopDefensesBreached`,
 * `teleopTowerCaptured`, `tba_rpEarned`, `rp`, etc.) are ignored, not
 * rejected — zod's default "strip" mode drops them without erroring.
 * Deliberately NOT `.passthrough()`/`.loose()`, matching every other season
 * map's discipline.
 */
const SideBreakdownSchema = z.object({
  autoReachPoints: z.number().finite(),
  autoCrossingPoints: z.number().finite(),
  autoBoulderPoints: z.number().finite(),
  teleopCrossingPoints: z.number().finite(),
  teleopBoulderPoints: z.number().finite(),
  teleopChallengePoints: z.number().finite(),
  teleopScalePoints: z.number().finite(),
  /**
   * Always 0 in quals, real points in playoffs, counted by TBA inside its
   * own `teleopPoints`. See "THE CENTRAL FACT" in the file header — these
   * two are load-bearing, not optional detail.
   */
  breachPoints: z.number().finite(),
  capturePoints: z.number().finite(),
  adjustPoints: z.number().finite(),
  /**
   * Points this alliance RECEIVED from the opponent's fouls — NOT points
   * this alliance committed. See `foulsCommitted`'s comment below.
   */
  foulPoints: z.number().finite(),
});

const Breakdown2016Schema = z.object({
  red: SideBreakdownSchema,
  blue: SideBreakdownSchema,
});

/** canonical component name -> TBA `score_breakdown` key, for this alliance's own fields. */
const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {
  autoReach: "autoReachPoints",
  autoCrossing: "autoCrossingPoints",
  autoBoulder: "autoBoulderPoints",
  teleopCrossing: "teleopCrossingPoints",
  teleopBoulder: "teleopBoulderPoints",
  teleopChallenge: "teleopChallengePoints",
  teleopScale: "teleopScalePoints",
  breach: "breachPoints",
  capture: "capturePoints",
  [ADJUST_COMPONENT]: "adjustPoints",
};

export const breakdown2016: SeasonComponentMap = {
  components: [...Object.keys(OWN_FIELD_COMPONENT_MAP), FOULS_COMMITTED_COMPONENT],

  // Raw count fields — not point values, never emitted as a component
  // (Pitfall Sigma1-1). Held to exactly these two: this list's single
  // consumer treats every name in it as a foul field, so 2016's six other
  // raw counts (the five crossings and the tower) must NOT be listed here.
  // See the file header.
  diagnosticKeys: ["foulCount", "techFoulCount"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents {
    const parsed = Breakdown2016Schema.parse(rawBreakdownJson);
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
