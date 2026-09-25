/**
 * The FIRST district point model's ALLIANCE SELECTION component: how many
 * district points a team earns for being picked onto a playoff alliance,
 * by which slot it filled and which seed the alliance is.
 *
 * The values, VERIFIED against `data/corpus.sqlite` on 2026-09-25:
 *
 *   captain (pick slot 0)      17 - allianceNumber   (955 of 955 exact)
 *   first pick (pick slot 1)   17 - allianceNumber   (959 of 959 exact)
 *   second pick (pick slot 2)  allianceNumber        (measured over 969 rows)
 *   backup robot (pick slot 3) 0
 *
 * THE SECOND-PICK FORM HAS ALREADY BEEN GOT WRONG ONCE. The first draft of
 * `10-CONTEXT.md` stated it as `9 - allianceNumber`, from the Admin
 * Manual's stated intent rather than from a corpus check; measured, that
 * form scored 0 of 969 rows. `10-CONTEXT.md`'s "Corrections from research"
 * block is the binding text and supersedes its own earlier prose. The
 * corpus, not the manual's prose and not memory, is the authority here —
 * which is why `pointFormulas.reconciliation.test.ts` reconciles this
 * module against 20,209 real pick slots rather than against a hand-typed
 * fixture (`10-RESEARCH.md` Pitfall 5 names the hand-typed fixture as the
 * warning sign).
 *
 * `pickSlot` is the zero-based index into TBA's own
 * `event_alliances.picks` array, and `allianceNumber` is TBA's 1-based
 * `event_alliances.alliance_number` (its seed order) — neither is a
 * re-derived quantity, both are read straight off the ingested row.
 *
 * SCOPE: eight-alliance events. A four-alliance event's alliance point
 * model is a different one — 2022's 26 COVID-era split-day district events
 * ran with four alliances and produce 209 mismatches against this formula
 * (measured while planning 10-01), which is why the reconciliation test
 * filters by measured alliance count and why `allianceNumber` is validated
 * to 1 through 8 here rather than left open.
 *
 * A browser-safe leaf module: its only imports are the `./pointModel.js`
 * and `./qualPoints.js` siblings, so no DOM and no Node built-in enters its
 * graph.
 */
import { maxEventPoints, type DistrictTier } from "./pointModel.js";
import { districtTierWeight } from "./qualPoints.js";

/**
 * Thrown for a pick slot or alliance number that cannot describe a real
 * eight-alliance selection. Thrown rather than returning 0: a silent 0 for
 * an out-of-range slot is a plausible-looking wrong point value, which is
 * exactly the failure this module's own history argues against.
 */
export class InvalidPickSlotError extends Error {
  constructor(message: string) {
    super(`selectionPoints: ${message}`);
    this.name = "InvalidPickSlotError";
  }
}

/** The highest pick slot TBA's `picks` array carries: slot 3 is the backup robot. */
const MAX_PICK_SLOT = 3;
/** This module's scope: the eight-alliance playoff field. */
const MAX_ALLIANCE_NUMBER = 8;
/**
 * The captain/second-pick pair's sum, at every alliance number. Written
 * once and used for both slot values rather than as two independent
 * literals, so the pair cannot drift apart: the captain gets
 * `PAIR_SUM - allianceNumber` and the second pick gets `allianceNumber`.
 */
const PAIR_SUM = 17;

/**
 * The base (regular district event, unweighted) alliance selection points
 * for the team that filled `pickSlot` on the alliance seeded
 * `allianceNumber`.
 */
export function selectionPoints(pickSlot: number, allianceNumber: number): number {
  if (!Number.isInteger(pickSlot)) throw new InvalidPickSlotError(`pickSlot must be an integer, got ${pickSlot}`);
  if (pickSlot < 0 || pickSlot > MAX_PICK_SLOT) {
    throw new InvalidPickSlotError(`pickSlot must be 0 through ${MAX_PICK_SLOT} (TBA's picks array), got ${pickSlot}`);
  }
  if (!Number.isInteger(allianceNumber)) {
    throw new InvalidPickSlotError(`allianceNumber must be an integer, got ${allianceNumber}`);
  }
  if (allianceNumber < 1 || allianceNumber > MAX_ALLIANCE_NUMBER) {
    throw new InvalidPickSlotError(
      `allianceNumber must be 1 through ${MAX_ALLIANCE_NUMBER} (this model is scoped to the eight-alliance field), got ${allianceNumber}`
    );
  }

  // Slots 0 and 1 (captain and first pick) share one value; slot 2 (second
  // pick) is the alliance number itself; slot 3 (a backup robot) earns
  // nothing.
  if (pickSlot === 0 || pickSlot === 1) return PAIR_SUM - allianceNumber;
  if (pickSlot === 2) return allianceNumber;
  return 0;
}

/**
 * `selectionPoints` at the tier's weight — the value TBA reports as an
 * `event_points_raw` entry's `alliance_points`.
 *
 * The weight comes from `districtTierWeight` in `./qualPoints.js`, phase
 * 10's single DCMP weight source; it is not re-derived here. The returned
 * value is checked against `pointModel.ts`'s declared ceiling for the
 * tier, so the 16-point base ceiling CONTEXT names is read from the shipped
 * model rather than restated as a literal.
 */
export function districtSelectionPoints(
  season: number,
  tier: DistrictTier,
  pickSlot: number,
  allianceNumber: number
): number {
  const value = selectionPoints(pickSlot, allianceNumber) * districtTierWeight(season, tier);
  const ceiling = maxEventPoints(season, tier).alliance;
  if (value > ceiling) {
    throw new InvalidPickSlotError(
      `season ${season} ${tier} slot ${pickSlot} alliance ${allianceNumber} yields ${value}, above pointModel.ts's declared alliance ceiling ${ceiling}`
    );
  }
  return value;
}
