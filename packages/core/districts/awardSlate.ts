/**
 * THE ONE AWARD SLATE (quick task 261014-qje): how every event whose awards
 * are not posted prices its awards, at the district tier and the District
 * Championship tier alike (Q-01). One module holds the slot map, the declared
 * season award lists, the measured tables for both tiers, the district
 * eligibility, the district slate builder, the assignments, the odds and the
 * class weights. `dcmpAwardSlate.ts` keeps only what is DCMP specific (its
 * roles and `buildDcmpAwardSlate`) and imports the rest.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SLATE IS
 * ---------------------------------------------------------------------------
 *
 * Per event, an EXPECTED COUNT of each award slot given AT THIS EVENT and each
 * team's chance of being allowed to win Impact, Engineering Inspiration and
 * Rookie All Star there. Five slots, in pricing order (Q-02):
 *
 *  - `impact`: 10 points, any team;
 *  - `engineeringInspiration`: 8 points, veterans only;
 *  - `rookieAllStar`: 8 points, rookies only;
 *  - `judgedRookie`: 5 points, rookies only (type 15, Rookie Inspiration);
 *  - `judged`: 5 points, any team (every other point paying team award).
 *
 * "Veteran" means not a rookie: the unknown rookie state counts as a veteran
 * for audiences. `TYPE_SLOT` maps every point paying type to its slot.
 *
 * HOW MANY (Q-03, Q-04, Q-10). A slot's count is the sum, over the award types
 * the PRICED season declares (`SEASON_AWARD_TYPES`), of each type's measured
 * count at the tier and role. A retired award adds nothing; a season with no
 * declared list is refused. A type no earlier season declared takes the mean
 * count of the season's other declared types with the same points
 * (`new-award`). At the DCMP the three qualifying awards' counts come from the
 * champ draws' count model instead (`buildDcmpAwardSlate`).
 *
 * WHO CAN WIN (Q-05). At a district event, a team that already won Impact,
 * Engineering Inspiration or Rookie All Star at an EARLIER district event that
 * season (a strictly smaller TBA week) cannot win that same award there:
 * `districtAwardEligibility`. At the DCMP, the qualifying awards follow
 * `dcmpAwardEligibility`.
 *
 * WHO GETS THEM (Q-06). A team's weight in a slot is the measured lift of its
 * class: Impact by `${bucket(prior Impact wins)}|${bucket(decorations)}`,
 * every other slot by `cellKey(bucket(decorations), rookie state)`. A class
 * below 100 observations falls to its primary rung (the first key pooled),
 * then to the slot pooled at lift 1. A field in which any profile lacks either
 * count prices every team at lift 1.
 *
 * THE PRICE (Q-08). Per slot in order, a capped water fill: cap = q times the
 * room the team has left, weight = lift times cap, the slot's count shared. The
 * team keeps its single highest award; never a stack.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every literal between the GENERATED markers was written by a transform
 * script from the printed output of
 *
 *     npx tsx scripts/measureAwardSlate.ts
 *
 * Not hand typed. The corpus guarded describe in
 * `scripts/measureAwardSlate.test.ts` re measures every registered season and
 * tier and asserts each count and lift within 1e-9 and each n exactly.
 *
 * NO AWARD PREDICTION REACHES `locks.ts`. A source test pins that this module
 * imports nothing from it: the slate prices cells only.
 */
import { cellKey, decorationBucket, type AwardBaseRateSource, type RookieState } from "./awardBaseRates.js";
import { dcmpAwardEligibility, dcmpEligibilityChance, type DcmpEligibilityTeam } from "./dcmpAwardEligibility.js";
import type { DcmpAwardCountAnchor, DcmpDrawnAwardType } from "./hypotheticalDcmp.js";
import type { DistrictAwardProfile } from "./ledgerSimulation.js";

/**
 * The award model a published district artifact's `awardProfile` counts were
 * derived for (quick task 261014-qje, Q-13). The publisher stamps it as the
 * artifact's top level `awardModelVersion` whenever it writes any profile. An
 * artifact WITHOUT the stamp carries the retired per team model (1.x): base
 * rate and ordering tables, and a prior judged award count that also counted
 * individual awards.
 *
 * Bump it with EVERY change to the slot map (`TYPE_SLOT`), a declared season
 * list (`SEASON_AWARD_TYPES`), the point values (`DISTRICT_POINT_AWARD_VALUES`)
 * or a measured table (`AWARD_SLATE_TABLES`), and re pin the digest in
 * `awardModelVersion.test.ts` in the same commit. The digest test fails on a
 * table change that leaves the version alone.
 */
export const DISTRICT_AWARD_MODEL_VERSION = "2.0.0";

// ---------------------------------------------------------------------------
// Slots (Q-02)
// ---------------------------------------------------------------------------

/** One award slot. See the module header. */
export type AwardSlot = "impact" | "engineeringInspiration" | "rookieAllStar" | "judgedRookie" | "judged";

/** The slots in pricing order. */
export const AWARD_SLOTS: readonly AwardSlot[] = Object.freeze(["impact", "engineeringInspiration", "rookieAllStar", "judgedRookie", "judged"] as const);

/** Who a slot is open to. `veteran` means not a rookie: the unknown rookie state counts as a veteran. */
export type SlotAudience = "any" | "veteran" | "rookie";

export const SLOT_AUDIENCE: Readonly<Record<AwardSlot, SlotAudience>> = Object.freeze({
  impact: "any",
  engineeringInspiration: "veteran",
  rookieAllStar: "rookie",
  judgedRookie: "rookie",
  judged: "any",
});

/** Each slot's points before the tier weight. Equal to each of its types' `DISTRICT_POINT_AWARD_VALUES` entry, pinned by a test. */
export const SLOT_POINTS: Readonly<Record<AwardSlot, number>> = Object.freeze({
  impact: 10,
  engineeringInspiration: 8,
  rookieAllStar: 8,
  judgedRookie: 5,
  judged: 5,
});

/** The three slots whose award carries an eligibility chance, with their award type. */
export const QUALIFYING_SLOT_TYPE: Readonly<Partial<Record<AwardSlot, DcmpDrawnAwardType>>> = Object.freeze({
  impact: 0,
  engineeringInspiration: 9,
  rookieAllStar: 10,
});

/**
 * THE SLOT OF EVERY POINT PAYING TEAM AWARD TYPE (Q-02). Its keys equal
 * `DISTRICT_POINT_AWARD_VALUES`' keys and each slot's points equal each type's
 * value, pinned by equality in the test.
 */
export const TYPE_SLOT: ReadonlyMap<number, AwardSlot> = new Map<number, AwardSlot>([
  [0, "impact"],
  [9, "engineeringInspiration"],
  [10, "rookieAllStar"],
  [11, "judged"],
  [13, "judged"],
  [15, "judgedRookie"],
  [16, "judged"],
  [17, "judged"],
  [18, "judged"],
  [20, "judged"],
  [21, "judged"],
  [22, "judged"],
  [27, "judged"],
  [29, "judged"],
  [30, "judged"],
  [71, "judged"],
  [82, "judged"],
  [83, "judged"],
]);

/** Whether a team of `rookieState` is in a slot's audience. */
export function inSlotAudience(slot: AwardSlot, rookieState: RookieState): boolean {
  const audience = SLOT_AUDIENCE[slot];
  if (audience === "any") return true;
  if (audience === "rookie") return rookieState === "rookie";
  return rookieState !== "rookie";
}

/** The slot of a team's single highest award among `awardTypes`, in pricing order, or undefined for none. */
export function highestAwardSlot(awardTypes: Iterable<number>): AwardSlot | undefined {
  let best: number | undefined;
  for (const type of awardTypes) {
    const slot = TYPE_SLOT.get(type);
    if (slot === undefined) continue;
    const index = AWARD_SLOTS.indexOf(slot);
    if (best === undefined || index < best) best = index;
  }
  return best === undefined ? undefined : AWARD_SLOTS[best];
}

// ---------------------------------------------------------------------------
// Measured table shapes
// ---------------------------------------------------------------------------

export type AwardSlateTier = "district" | "dcmp";

/** The role of a measured count: the district tier's own, or a DCMP tier event's. */
export type AwardSlateCountRole = "district" | "single" | "division" | "finals";

/** Where a type's count came from (Q-04, Q-10). */
export type SlateCountRule = "role" | "pooled" | "new-award";

/** One type's expected count at one role. */
export interface AwardTypeCount {
  readonly count: number;
  readonly source: SlateCountRule;
  /** `role` and `pooled`: the season the mean is over. `new-award`: the most recent such season among the averaged types. */
  readonly fromSeason: number;
  /** `role` and `pooled`: events the mean is over. `new-award`: the number of same point types averaged. */
  readonly events: number;
}

/** One measured lift: won over expected, over `n` observations. */
export interface SlateLift {
  readonly lift: number;
  readonly n: number;
}

/** One slot's lifts: by cell, and by the primary key pooled. A class absent from both falls to lift 1. */
export interface SlateSlotLifts {
  readonly cells: Readonly<Record<string, SlateLift>>;
  readonly primary: Readonly<Record<string, SlateLift>>;
}

/** One season's tables at one tier. */
export interface AwardSlateSeasonTables {
  /** The seasons the lifts were measured on (Q-07). */
  readonly trainingSeasons: readonly number[];
  /** Per role, per declared award type, its expected count. The DCMP tier carries no qualifying award counts. */
  readonly counts: Readonly<Partial<Record<AwardSlateCountRole, Readonly<Record<number, AwardTypeCount>>>>>;
  readonly lifts: Readonly<Record<AwardSlot, SlateSlotLifts>>;
}

export interface AwardSlateTables {
  readonly district: Readonly<Record<number, AwardSlateSeasonTables>>;
  readonly dcmp: Readonly<Record<number, AwardSlateSeasonTables>>;
}

// prettier-ignore
// BEGIN GENERATED: measureAwardSlate
export const SEASON_AWARD_TYPES: Readonly<Record<number, readonly number[]>> = {
  2016: [0, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 27, 29, 30],
  2017: [0, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 27, 29, 30],
  2018: [0, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 27, 29, 30],
  2019: [0, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 27, 29, 30, 71],
  2020: [0, 9, 10, 11, 13, 15, 16, 17, 18, 20, 21, 22, 27, 29, 30, 71],
  2022: [0, 9, 10, 11, 13, 15, 16, 17, 20, 21, 22, 27, 29, 30, 71],
  2023: [0, 9, 10, 11, 13, 15, 16, 17, 20, 21, 27, 29, 30, 71, 82],
  2024: [0, 9, 10, 11, 13, 15, 16, 17, 20, 21, 27, 29, 30, 71, 82],
  2025: [0, 9, 10, 11, 13, 16, 17, 20, 21, 27, 29, 30, 71, 82, 83],
  2026: [0, 9, 10, 11, 13, 16, 17, 20, 21, 27, 29, 30, 71, 82, 83],
};

export const AWARD_SLATE_TABLES: AwardSlateTables = {
  district: {
    2023: {
      trainingSeasons: [2019, 2020, 2022],
      counts: {
        district: {
          0: { count: 0.8541666666666666, source: "role", fromSeason: 2022, events: 96 },
          9: { count: 0.875, source: "role", fromSeason: 2022, events: 96 },
          10: { count: 0.5833333333333334, source: "role", fromSeason: 2022, events: 48 },
          11: { count: 0.8854166666666666, source: "role", fromSeason: 2022, events: 96 },
          13: { count: 0.8333333333333334, source: "role", fromSeason: 2022, events: 96 },
          15: { count: 0.6153846153846154, source: "role", fromSeason: 2022, events: 52 },
          16: { count: 0.875, source: "role", fromSeason: 2022, events: 96 },
          17: { count: 0.8541666666666666, source: "role", fromSeason: 2022, events: 96 },
          20: { count: 0.875, source: "role", fromSeason: 2022, events: 96 },
          21: { count: 0.8333333333333334, source: "role", fromSeason: 2022, events: 96 },
          27: { count: 0.8645833333333334, source: "role", fromSeason: 2022, events: 96 },
          29: { count: 0.8541666666666666, source: "role", fromSeason: 2022, events: 96 },
          30: { count: 0.875, source: "role", fromSeason: 2022, events: 96 },
          71: { count: 0.8020833333333334, source: "role", fromSeason: 2022, events: 96 },
          82: { count: 0.8334061771561772, source: "new-award", fromSeason: 2022, events: 11 },
        },
      },
      lifts: {
        impact: {
          cells: { "none|none": { lift: 0.015451048537815313, n: 2306 }, "none|one-or-two": { lift: 0.15432759629319878, n: 2066 }, "none|three-or-more": { lift: 0.8319926415232728, n: 2286 }, "one-or-two|three-or-more": { lift: 5.0477589786931905, n: 521 }, "three-or-more|three-or-more": { lift: 8.591477784647761, n: 280 } },
          primary: { "none": { lift: 0.3436528163543275, n: 6658 }, "one-or-two": { lift: 4.938552368977327, n: 532 }, "three-or-more": { lift: 8.591477784647761, n: 280 } },
        },
        engineeringInspiration: {
          cells: { "none|veteran": { lift: 0.01754657794371736, n: 1819 }, "one-or-two|veteran": { lift: 0.4715477563748964, n: 2059 }, "three-or-more|veteran": { lift: 1.9699410591604432, n: 2922 } },
          primary: { "none": { lift: 0.01754657794371736, n: 1819 }, "one-or-two": { lift: 0.4715477563748964, n: 2059 }, "three-or-more": { lift: 1.9699410591604432, n: 2922 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1.0000000000000016, n: 424 } },
          primary: { "none": { lift: 1.0000000000000016, n: 424 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.9999999999999993, n: 356 } },
          primary: { "none": { lift: 0.9999999999999993, n: 356 } },
        },
        judged: {
          cells: { "none|rookie": { lift: 0.30614838636334163, n: 219 }, "none|veteran": { lift: 0.3780171885391755, n: 1782 }, "one-or-two|veteran": { lift: 0.7057556033229757, n: 2041 }, "three-or-more|veteran": { lift: 1.6575779842134433, n: 2790 } },
          primary: { "none": { lift: 0.3702091235396519, n: 2001 }, "one-or-two": { lift: 0.7057556033229757, n: 2041 }, "three-or-more": { lift: 1.6575779842134433, n: 2790 } },
        },
      },
    },
    2024: {
      trainingSeasons: [2019, 2020, 2022, 2023],
      counts: {
        district: {
          0: { count: 0.9680851063829787, source: "role", fromSeason: 2023, events: 94 },
          9: { count: 0.9574468085106383, source: "role", fromSeason: 2023, events: 94 },
          10: { count: 0.8767123287671232, source: "role", fromSeason: 2023, events: 73 },
          11: { count: 0.9787234042553191, source: "role", fromSeason: 2023, events: 94 },
          13: { count: 0.9574468085106383, source: "role", fromSeason: 2023, events: 94 },
          15: { count: 0.8076923076923077, source: "role", fromSeason: 2023, events: 78 },
          16: { count: 0.9787234042553191, source: "role", fromSeason: 2023, events: 94 },
          17: { count: 0.9680851063829787, source: "role", fromSeason: 2023, events: 94 },
          20: { count: 0.9893617021276596, source: "role", fromSeason: 2023, events: 94 },
          21: { count: 0.9574468085106383, source: "role", fromSeason: 2023, events: 94 },
          27: { count: 0.9893617021276596, source: "role", fromSeason: 2023, events: 94 },
          29: { count: 0.9361702127659575, source: "role", fromSeason: 2023, events: 94 },
          30: { count: 1, source: "role", fromSeason: 2023, events: 94 },
          71: { count: 0.9468085106382979, source: "role", fromSeason: 2023, events: 94 },
          82: { count: 0.9680851063829787, source: "role", fromSeason: 2023, events: 94 },
        },
      },
      lifts: {
        impact: {
          cells: { "none|none": { lift: 0.011864073278890074, n: 2984 }, "none|one-or-two": { lift: 0.13353871020327013, n: 2892 }, "none|three-or-more": { lift: 0.7939819013564257, n: 3454 }, "one-or-two|three-or-more": { lift: 4.713051848323938, n: 771 }, "three-or-more|three-or-more": { lift: 7.782948560080805, n: 456 } },
          primary: { "none": { lift: 0.34402919312035024, n: 9330 }, "one-or-two": { lift: 4.634080295904827, n: 784 }, "three-or-more": { lift: 7.782948560080805, n: 456 } },
        },
        engineeringInspiration: {
          cells: { "none|veteran": { lift: 0.013903233875029803, n: 2294 }, "one-or-two|veteran": { lift: 0.42393942225822473, n: 2882 }, "three-or-more|veteran": { lift: 1.8665311481904463, n: 4437 } },
          primary: { "none": { lift: 0.013903233875029803, n: 2294 }, "one-or-two": { lift: 0.42393942225822473, n: 2882 }, "three-or-more": { lift: 1.8665311481904463, n: 4437 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1.0000000000000004, n: 592 } },
          primary: { "none": { lift: 1.0000000000000004, n: 592 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.9999999999999986, n: 495 } },
          primary: { "none": { lift: 0.9999999999999986, n: 495 } },
        },
        judged: {
          cells: { "none|rookie": { lift: 0.325329430114953, n: 295 }, "none|veteran": { lift: 0.3522706595980855, n: 2257 }, "one-or-two|veteran": { lift: 0.6492571812291102, n: 2859 }, "three-or-more|veteran": { lift: 1.6158813651496027, n: 4259 } },
          primary: { "none": { lift: 0.34918248412429875, n: 2552 }, "one-or-two": { lift: 0.6492571812291102, n: 2859 }, "three-or-more": { lift: 1.6158813651496027, n: 4259 } },
        },
      },
    },
    2025: {
      trainingSeasons: [2019, 2020, 2022, 2023, 2024],
      counts: {
        district: {
          0: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          9: { count: 0.9897959183673469, source: "role", fromSeason: 2024, events: 98 },
          10: { count: 0.8846153846153846, source: "role", fromSeason: 2024, events: 78 },
          11: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          13: { count: 1, source: "role", fromSeason: 2024, events: 98 },
          16: { count: 0.9387755102040817, source: "role", fromSeason: 2024, events: 98 },
          17: { count: 0.9897959183673469, source: "role", fromSeason: 2024, events: 98 },
          20: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          21: { count: 0.9693877551020408, source: "role", fromSeason: 2024, events: 98 },
          27: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          29: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          30: { count: 1, source: "role", fromSeason: 2024, events: 98 },
          71: { count: 0.9795918367346939, source: "role", fromSeason: 2024, events: 98 },
          82: { count: 1, source: "role", fromSeason: 2024, events: 98 },
          83: { count: 0.9814471243042671, source: "new-award", fromSeason: 2024, events: 11 },
        },
      },
      lifts: {
        impact: {
          cells: { "none|none": { lift: 0.00965016488737904, n: 3659 }, "none|one-or-two": { lift: 0.13187185160286385, n: 3704 }, "none|three-or-more": { lift: 0.7534843841856986, n: 4761 }, "one-or-two|three-or-more": { lift: 4.299626241133124, n: 1039 }, "three-or-more|three-or-more": { lift: 7.494831344548263, n: 667 } },
          primary: { "none": { lift: 0.34370025551531247, n: 12124 }, "one-or-two": { lift: 4.242787169552317, n: 1053 }, "three-or-more": { lift: 7.494831344548263, n: 667 } },
        },
        engineeringInspiration: {
          cells: { "none|veteran": { lift: 0.011700797191025594, n: 2709 }, "one-or-two|veteran": { lift: 0.3431153446752972, n: 3693 }, "three-or-more|veteran": { lift: 1.8135263937120707, n: 6138 } },
          primary: { "none": { lift: 0.011700797191025594, n: 2709 }, "one-or-two": { lift: 0.3431153446752972, n: 3693 }, "three-or-more": { lift: 1.8135263937120707, n: 6138 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1.0000000000000013, n: 813 } },
          primary: { "none": { lift: 1.0000000000000013, n: 813 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.999999999999999, n: 686 } },
          primary: { "none": { lift: 0.999999999999999, n: 686 } },
        },
        judged: {
          cells: { "none|rookie": { lift: 0.280239448995635, n: 415 }, "none|veteran": { lift: 0.34803096934164984, n: 2672 }, "one-or-two|veteran": { lift: 0.6099784349741962, n: 3669 }, "three-or-more|veteran": { lift: 1.5776568734273306, n: 5902 } },
          primary: { "none": { lift: 0.3389946349301285, n: 3087 }, "one-or-two": { lift: 0.6099784349741962, n: 3669 }, "three-or-more": { lift: 1.5776568734273306, n: 5902 } },
        },
      },
    },
    2026: {
      trainingSeasons: [2019, 2020, 2022, 2023, 2024, 2025],
      counts: {
        district: {
          0: { count: 0.970873786407767, source: "role", fromSeason: 2025, events: 103 },
          9: { count: 0.9805825242718447, source: "role", fromSeason: 2025, events: 103 },
          10: { count: 0.9090909090909091, source: "role", fromSeason: 2025, events: 88 },
          11: { count: 1, source: "role", fromSeason: 2025, events: 103 },
          13: { count: 0.9805825242718447, source: "role", fromSeason: 2025, events: 103 },
          16: { count: 0.9611650485436893, source: "role", fromSeason: 2025, events: 103 },
          17: { count: 0.970873786407767, source: "role", fromSeason: 2025, events: 103 },
          20: { count: 0.9611650485436893, source: "role", fromSeason: 2025, events: 103 },
          21: { count: 0.9611650485436893, source: "role", fromSeason: 2025, events: 103 },
          27: { count: 0.9902912621359223, source: "role", fromSeason: 2025, events: 103 },
          29: { count: 0.970873786407767, source: "role", fromSeason: 2025, events: 103 },
          30: { count: 0.9805825242718447, source: "role", fromSeason: 2025, events: 103 },
          71: { count: 0.9611650485436893, source: "role", fromSeason: 2025, events: 103 },
          82: { count: 0.9805825242718447, source: "role", fromSeason: 2025, events: 103 },
          83: { count: 0.9902912621359223, source: "role", fromSeason: 2025, events: 103 },
        },
      },
      lifts: {
        impact: {
          cells: { "none|none": { lift: 0.008184940907520283, n: 4301 }, "none|one-or-two": { lift: 0.1225811967104346, n: 4542 }, "none|three-or-more": { lift: 0.6857269089174161, n: 6172 }, "one-or-two|three-or-more": { lift: 4.01297968455793, n: 1331 }, "three-or-more|three-or-more": { lift: 7.532278152191895, n: 897 } },
          primary: { "none": { lift: 0.32523601391195306, n: 15015 }, "one-or-two": { lift: 3.971493576547136, n: 1345 }, "three-or-more": { lift: 7.532278152191895, n: 897 } },
        },
        engineeringInspiration: {
          cells: { "none|veteran": { lift: 0.020360284082158505, n: 3107 }, "one-or-two|veteran": { lift: 0.2921169526409487, n: 4529 }, "three-or-more|veteran": { lift: 1.7645365825123989, n: 7985 } },
          primary: { "none": { lift: 0.020360284082158505, n: 3107 }, "one-or-two": { lift: 0.2921169526409487, n: 4529 }, "three-or-more": { lift: 1.7645365825123989, n: 7985 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1.0000000000000024, n: 1013 } },
          primary: { "none": { lift: 1.0000000000000024, n: 1013 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.999999999999999, n: 850 } },
          primary: { "none": { lift: 0.999999999999999, n: 850 } },
        },
        judged: {
          cells: { "none|rookie": { lift: 0.3052512759703797, n: 579 }, "none|veteran": { lift: 0.353398217558482, n: 3069 }, "one-or-two|veteran": { lift: 0.5911430316625148, n: 4503 }, "three-or-more|veteran": { lift: 1.537443156108502, n: 7690 } },
          primary: { "none": { lift: 0.34564506375988174, n: 3648 }, "one-or-two": { lift: 0.5911430316625148, n: 4503 }, "three-or-more": { lift: 1.537443156108502, n: 7690 } },
        },
      },
    },
  },
  dcmp: {
    2023: {
      trainingSeasons: [2019, 2022],
      counts: {
        single: {
          11: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          13: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          15: { count: 0.6, source: "role", fromSeason: 2022, events: 5 },
          16: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          17: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          20: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          21: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          27: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          29: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          30: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          71: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          82: { count: 0.9636363636363636, source: "new-award", fromSeason: 2022, events: 11 },
        },
        division: {
          11: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          13: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          15: { count: 0.8333333333333334, source: "role", fromSeason: 2022, events: 6 },
          16: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          17: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          20: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          21: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          27: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          29: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          30: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          71: { count: 1, source: "role", fromSeason: 2022, events: 8 },
          82: { count: 0.9848484848484849, source: "new-award", fromSeason: 2022, events: 11 },
        },
        finals: {
          11: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          13: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          15: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          16: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          17: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          20: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          21: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          27: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          29: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          30: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          71: { count: 0, source: "role", fromSeason: 2022, events: 3 },
          82: { count: 0, source: "new-award", fromSeason: 2022, events: 11 },
        },
      },
      lifts: {
        impact: {
          cells: {},
          primary: {},
        },
        engineeringInspiration: {
          cells: { "three-or-more|veteran": { lift: 1.0381257391928345, n: 126 } },
          primary: { "three-or-more": { lift: 1.0381257391928345, n: 126 } },
        },
        rookieAllStar: {
          cells: {},
          primary: {},
        },
        judgedRookie: {
          cells: {},
          primary: {},
        },
        judged: {
          cells: { "none|veteran": { lift: 0.20539177723206622, n: 150 }, "one-or-two|veteran": { lift: 0.5321965207557237, n: 254 }, "three-or-more|veteran": { lift: 1.295937321940917, n: 861 } },
          primary: { "none": { lift: 0.2571802196934532, n: 192 }, "one-or-two": { lift: 0.5321965207557237, n: 254 }, "three-or-more": { lift: 1.295937321940917, n: 861 } },
        },
      },
    },
    2024: {
      trainingSeasons: [2019, 2022, 2023],
      counts: {
        single: {
          11: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          13: { count: 0.8571428571428571, source: "role", fromSeason: 2023, events: 7 },
          15: { count: 0.8571428571428571, source: "role", fromSeason: 2023, events: 7 },
          16: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          17: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          20: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          21: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          27: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          29: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          30: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          71: { count: 1, source: "role", fromSeason: 2023, events: 7 },
          82: { count: 1, source: "role", fromSeason: 2023, events: 7 },
        },
        division: {
          11: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          13: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          15: { count: 0.9, source: "role", fromSeason: 2023, events: 10 },
          16: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          17: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          20: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          21: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          27: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          29: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          30: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          71: { count: 1, source: "role", fromSeason: 2023, events: 10 },
          82: { count: 1, source: "role", fromSeason: 2023, events: 10 },
        },
        finals: {
          11: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          13: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          15: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          16: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          17: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          20: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          21: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          27: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          29: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          30: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          71: { count: 0, source: "role", fromSeason: 2023, events: 4 },
          82: { count: 0, source: "role", fromSeason: 2023, events: 4 },
        },
      },
      lifts: {
        impact: {
          cells: {},
          primary: {},
        },
        engineeringInspiration: {
          cells: { "three-or-more|veteran": { lift: 1.0123466287164895, n: 193 } },
          primary: { "three-or-more": { lift: 1.0123466287164895, n: 193 } },
        },
        rookieAllStar: {
          cells: {},
          primary: {},
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.9999999999999998, n: 105 } },
          primary: { "none": { lift: 0.9999999999999998, n: 105 } },
        },
        judged: {
          cells: { "none|veteran": { lift: 0.22928305463363402, n: 184 }, "one-or-two|veteran": { lift: 0.5627409738570165, n: 369 }, "three-or-more|veteran": { lift: 1.2466063962286367, n: 1394 } },
          primary: { "none": { lift: 0.25583442266418316, n: 251 }, "one-or-two": { lift: 0.5627409738570165, n: 369 }, "three-or-more": { lift: 1.2466063962286367, n: 1394 } },
        },
      },
    },
    2025: {
      trainingSeasons: [2019, 2022, 2023, 2024],
      counts: {
        single: {
          11: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          13: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          16: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          17: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          20: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          21: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          27: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          29: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          30: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          71: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          82: { count: 1, source: "role", fromSeason: 2024, events: 7 },
          83: { count: 1, source: "new-award", fromSeason: 2024, events: 11 },
        },
        division: {
          11: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          13: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          16: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          17: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          20: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          21: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          27: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          29: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          30: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          71: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          82: { count: 1, source: "role", fromSeason: 2024, events: 10 },
          83: { count: 1, source: "new-award", fromSeason: 2024, events: 11 },
        },
        finals: {
          11: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          13: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          16: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          17: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          20: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          21: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          27: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          29: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          30: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          71: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          82: { count: 0, source: "role", fromSeason: 2024, events: 4 },
          83: { count: 0, source: "new-award", fromSeason: 2024, events: 11 },
        },
      },
      lifts: {
        impact: {
          cells: { "one-or-two|three-or-more": { lift: 0.8379345072157802, n: 125 }, "three-or-more|three-or-more": { lift: 1.2520606450012401, n: 138 } },
          primary: { "none": { lift: 0.8552304380395562, n: 113 }, "one-or-two": { lift: 0.8379345072157802, n: 125 }, "three-or-more": { lift: 1.2520606450012401, n: 138 } },
        },
        engineeringInspiration: {
          cells: { "three-or-more|veteran": { lift: 1.009182184845104, n: 267 } },
          primary: { "three-or-more": { lift: 1.009182184845104, n: 267 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1, n: 131 } },
          primary: { "none": { lift: 1, n: 131 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.9999999999999993, n: 137 } },
          primary: { "none": { lift: 0.9999999999999993, n: 137 } },
        },
        judged: {
          cells: { "none|veteran": { lift: 0.25980427486434393, n: 223 }, "one-or-two|veteran": { lift: 0.5049582092523958, n: 479 }, "three-or-more|veteran": { lift: 1.2317462308448335, n: 1966 } },
          primary: { "none": { lift: 0.2727847990156059, n: 308 }, "one-or-two": { lift: 0.5049582092523958, n: 479 }, "three-or-more": { lift: 1.2317462308448335, n: 1966 } },
        },
      },
    },
    2026: {
      trainingSeasons: [2019, 2022, 2023, 2024, 2025],
      counts: {
        single: {
          11: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          13: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          16: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          17: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          20: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          21: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          27: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          29: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          30: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          71: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          82: { count: 1, source: "role", fromSeason: 2025, events: 8 },
          83: { count: 1, source: "role", fromSeason: 2025, events: 8 },
        },
        division: {
          11: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          13: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          16: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          17: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          20: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          21: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          27: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          29: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          30: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          71: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          82: { count: 1, source: "role", fromSeason: 2025, events: 10 },
          83: { count: 1, source: "role", fromSeason: 2025, events: 10 },
        },
        finals: {
          11: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          13: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          16: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          17: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          20: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          21: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          27: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          29: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          30: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          71: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          82: { count: 0, source: "role", fromSeason: 2025, events: 4 },
          83: { count: 0, source: "role", fromSeason: 2025, events: 4 },
        },
      },
      lifts: {
        impact: {
          cells: { "none|three-or-more": { lift: 0.7083891487967995, n: 118 }, "one-or-two|three-or-more": { lift: 0.8715956557396712, n: 151 }, "three-or-more|three-or-more": { lift: 1.2548896227746533, n: 194 } },
          primary: { "none": { lift: 0.7720660550236957, n: 134 }, "one-or-two": { lift: 0.8715956557396712, n: 151 }, "three-or-more": { lift: 1.2548896227746533, n: 194 } },
        },
        engineeringInspiration: {
          cells: { "three-or-more|veteran": { lift: 1.012740117770734, n: 350 } },
          primary: { "three-or-more": { lift: 1.012740117770734, n: 350 } },
        },
        rookieAllStar: {
          cells: { "none|rookie": { lift: 1.0000000000000004, n: 166 } },
          primary: { "none": { lift: 1.0000000000000004, n: 166 } },
        },
        judgedRookie: {
          cells: { "none|rookie": { lift: 0.9999999999999993, n: 168 } },
          primary: { "none": { lift: 0.9999999999999993, n: 168 } },
        },
        judged: {
          cells: { "none|rookie": { lift: 0.33892762440956725, n: 116 }, "none|veteran": { lift: 0.3166288523003322, n: 264 }, "one-or-two|veteran": { lift: 0.47549944677112516, n: 582 }, "three-or-more|veteran": { lift: 1.2180180451089524, n: 2567 } },
          primary: { "none": { lift: 0.3237284475705888, n: 380 }, "one-or-two": { lift: 0.47549944677112516, n: 582 }, "three-or-more": { lift: 1.2180180451089524, n: 2567 } },
        },
      },
    },
  },
};
// END GENERATED: measureAwardSlate

// ---------------------------------------------------------------------------
// The declared season award lists (Q-03)
// ---------------------------------------------------------------------------

/** Thrown for a season with no declared award list: refused, never defaulted. */
export class UnknownSeasonAwardListError extends Error {
  constructor(season: number) {
    super(
      `awardSlate: no declared award list for season ${String(season)} (declared: ${Object.keys(SEASON_AWARD_TYPES).join(", ") || "none"}); declare it from FIRST's published list`
    );
    this.name = "UnknownSeasonAwardListError";
  }
}

/** Thrown when a declared list names a type `TYPE_SLOT` does not map. */
export class UnslottedAwardTypeError extends Error {
  constructor(season: number, awardType: number) {
    super(`awardSlate: season ${String(season)} declares award type ${String(awardType)}, which TYPE_SLOT does not map to a slot`);
    this.name = "UnslottedAwardTypeError";
  }
}

/** The point paying award types FIRST gave in `season`. Throws for an undeclared season or an unslotted type. */
export function seasonAwardTypes(season: number, lists: Readonly<Record<number, readonly number[]>> = SEASON_AWARD_TYPES): readonly number[] {
  const list = lists[season];
  if (list === undefined) throw new UnknownSeasonAwardListError(season);
  for (const type of list) if (!TYPE_SLOT.has(type)) throw new UnslottedAwardTypeError(season, type);
  return list;
}

// ---------------------------------------------------------------------------
// The registered seasons
// ---------------------------------------------------------------------------

function seasonsOf(record: Readonly<Record<number, unknown>>): readonly number[] {
  return Object.keys(record)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The seasons each tier is registered for, from the table's own keys. */
export const DISTRICT_AWARD_SLATE_SEASONS: readonly number[] = seasonsOf(AWARD_SLATE_TABLES.district);
export const DCMP_TIER_AWARD_SLATE_SEASONS: readonly number[] = seasonsOf(AWARD_SLATE_TABLES.dcmp);

/** Thrown for a season a tier has no slate table for: never a borrowed season. */
export class UnknownAwardSlateSeasonError extends Error {
  readonly tier: AwardSlateTier;
  constructor(season: number, tier: AwardSlateTier = "dcmp") {
    const registered = tier === "district" ? DISTRICT_AWARD_SLATE_SEASONS : DCMP_TIER_AWARD_SLATE_SEASONS;
    super(`awardSlate: no ${tier} tier award slate table for season ${String(season)} (registered: ${registered.join(", ") || "none"})`);
    this.name = "UnknownAwardSlateSeasonError";
    this.tier = tier;
  }
}

export function hasAwardSlateTables(season: number, tier: AwardSlateTier): boolean {
  return AWARD_SLATE_TABLES[tier][season] !== undefined;
}

export function awardSlateTables(season: number, tier: AwardSlateTier): AwardSlateSeasonTables {
  const tables = AWARD_SLATE_TABLES[tier][season];
  if (tables === undefined) throw new UnknownAwardSlateSeasonError(season, tier);
  return tables;
}

// ---------------------------------------------------------------------------
// The water fill
// ---------------------------------------------------------------------------

/**
 * Distributes `total` over teams in proportion to `weights`, never above each
 * team's cap: `t_j = min(cap_j, lambda weight_j)` with lambda chosen so the
 * sum is `total`. When the reachable caps sum to no more than `total`, every
 * team gets its cap. A zero weight or a zero cap never receives mass. A total
 * of 0 is all zeros.
 */
export function waterFill(weights: readonly number[], caps: readonly number[], total: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (!(total > 0)) return out;
  const active: number[] = [];
  let capSum = 0;
  for (let j = 0; j < n; j++) {
    if (weights[j]! > 0 && caps[j]! > 0) {
      active.push(j);
      capSum += caps[j]!;
    }
  }
  if (capSum <= total) {
    for (const j of active) out[j] = caps[j]!;
    return out;
  }
  // Teams saturate in order of cap over weight. Walk them, capping each whose
  // proportional share would exceed its cap, then share what is left.
  active.sort((a, b) => caps[a]! / weights[a]! - caps[b]! / weights[b]!);
  let remaining = total;
  let weightLeft = active.reduce((sum, j) => sum + weights[j]!, 0);
  let k = 0;
  for (; k < active.length; k++) {
    const j = active[k]!;
    const lambda = remaining / weightLeft;
    if (lambda * weights[j]! < caps[j]!) break;
    out[j] = caps[j]!;
    remaining -= caps[j]!;
    weightLeft -= weights[j]!;
  }
  const lambda = remaining / weightLeft;
  for (; k < active.length; k++) {
    const j = active[k]!;
    out[j] = lambda * weights[j]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classes and lifts (Q-06)
// ---------------------------------------------------------------------------

/** The counts a class key reads. */
export interface SlateClassCounts {
  readonly priorJudgedAwards: number;
  readonly priorImpactWins: number;
  readonly rookieState: RookieState;
}

/** A team's class keys in one slot: the cell, and the primary rung's key. */
export function slateClassKeys(slot: AwardSlot, counts: SlateClassCounts): { readonly cell: string; readonly primary: string } {
  if (slot === "impact") {
    const impactBucket = decorationBucket(counts.priorImpactWins);
    return { cell: `${impactBucket}|${decorationBucket(counts.priorJudgedAwards)}`, primary: impactBucket };
  }
  const bucket = decorationBucket(counts.priorJudgedAwards);
  return { cell: cellKey(bucket, counts.rookieState), primary: bucket };
}

/** One team's lift in one slot, and the rung it came from: cell, then primary pooled (`bucket-pooled`), then lift 1 (`season-pooled`). */
export function slateLift(tables: AwardSlateSeasonTables, slot: AwardSlot, counts: SlateClassCounts): { readonly lift: number; readonly source: AwardBaseRateSource } {
  const keys = slateClassKeys(slot, counts);
  const lifts = tables.lifts[slot];
  const cell = lifts.cells[keys.cell];
  if (cell !== undefined) return { lift: cell.lift, source: "cell" };
  const primary = lifts.primary[keys.primary];
  if (primary !== undefined) return { lift: primary.lift, source: "bucket-pooled" };
  return { lift: 1, source: "season-pooled" };
}

function completeCounts(profile: DistrictAwardProfile): SlateClassCounts | undefined {
  if (profile.priorJudgedAwards === undefined || profile.priorImpactWins === undefined) return undefined;
  return { priorJudgedAwards: profile.priorJudgedAwards, priorImpactWins: profile.priorImpactWins, rookieState: profile.rookieState };
}

/**
 * One team's weight for one of the three qualifying awards at one tier: 0
 * outside the award's audience, else the class lift of the award's slot (lift
 * 1 for a profile lacking either count). Field free, so an eligibility helper
 * can call it per team. Throws `UnknownAwardSlateSeasonError` for a season the
 * tier has no table for.
 */
export function slateEntrantWeight(season: number, tier: AwardSlateTier, awardType: DcmpDrawnAwardType, profile: DistrictAwardProfile): number {
  const slot = TYPE_SLOT.get(awardType)!;
  if (!inSlotAudience(slot, profile.rookieState)) return 0;
  const tables = awardSlateTables(season, tier);
  const counts = completeCounts(profile);
  return counts === undefined ? 1 : slateLift(tables, slot, counts).lift;
}

// ---------------------------------------------------------------------------
// The slate one event carries
// ---------------------------------------------------------------------------

/** What one event gives: the district tier's own role, or a DCMP tier role (see `dcmpAwardSlate.ts`). */
export type AwardSlateRole = "district" | "single" | "division" | "finals" | "wholeChampionship";

/** One team's chances of being allowed to win the three qualifying awards. */
export interface SlateEligibility {
  readonly teamKey: string;
  readonly impact: number;
  readonly engineeringInspiration: number;
  readonly rookieAllStar: number;
}

/** Expected count of each slot given AT THIS EVENT. */
export interface AwardSlateExpected {
  readonly impact: number;
  readonly engineeringInspiration: number;
  readonly rookieAllStar: number;
  readonly judgedRookie: number;
  readonly judged: number;
}

/**
 * THE SLATE one event's run carries. Plain data: it crosses a `postMessage`
 * structured clone boundary.
 */
export interface AwardSlateInput {
  readonly role: AwardSlateRole;
  readonly expected: AwardSlateExpected;
  readonly sources: {
    /** The qualifying counts' source: `dcmpAwardCounts`' own at a DCMP role, the measured rule at the district role. */
    readonly counts: DcmpAwardCountAnchor["source"] | SlateCountRule;
    /** The weakest rule among the 5 point types' counts. */
    readonly judged: SlateCountRule;
    /** Declared types priced by the new award prior (Q-10), sorted. */
    readonly newAwardTypes?: readonly number[];
  };
  /**
   * At a DCMP role, only teams with a chance above 0 for at least one of the
   * three, sorted by key (absent means 0). At the district role, every award
   * field member, sorted by key (absent is refused).
   */
  readonly eligibility: readonly SlateEligibility[];
}

const RULE_ORDER: readonly SlateCountRule[] = ["role", "pooled", "new-award"];

/** The weakest of several count rules: new-award, then pooled, then role. */
export function weakestRule(rules: readonly SlateCountRule[]): SlateCountRule {
  let worst = 0;
  for (const rule of rules) worst = Math.max(worst, RULE_ORDER.indexOf(rule));
  return RULE_ORDER[worst]!;
}

/** Thrown when a declared type has no measured count at the role: the table and the list disagree. */
export class MissingAwardTypeCountError extends Error {
  constructor(season: number, tier: AwardSlateTier, role: AwardSlateCountRole, awardType: number) {
    super(`awardSlate: season ${String(season)} declares award type ${String(awardType)} but the ${tier} tier table has no ${role} count for it`);
    this.name = "MissingAwardTypeCountError";
  }
}

/**
 * The sum of the declared types' counts in each slot at one role (Q-04).
 * `skipQualifying` leaves the three qualifying slots at 0 (the DCMP takes them
 * from the champ count model). Returns the rules the sums rest on.
 */
export function declaredSlotCounts(
  season: number,
  tier: AwardSlateTier,
  role: AwardSlateCountRole,
  options: { readonly skipQualifying: boolean }
): { readonly expected: AwardSlateExpected; readonly qualifyingRules: SlateCountRule[]; readonly judgedRules: SlateCountRule[]; readonly newAwardTypes: number[] } {
  const tables = awardSlateTables(season, tier);
  const declared = seasonAwardTypes(season);
  const counts = tables.counts[role] ?? {};
  const sums: Record<AwardSlot, number> = { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judgedRookie: 0, judged: 0 };
  const qualifyingRules: SlateCountRule[] = [];
  const judgedRules: SlateCountRule[] = [];
  const newAwardTypes: number[] = [];
  for (const type of declared) {
    const slot = TYPE_SLOT.get(type)!;
    const qualifying = QUALIFYING_SLOT_TYPE[slot] !== undefined;
    if (qualifying && options.skipQualifying) continue;
    const entry = counts[type];
    if (entry === undefined) throw new MissingAwardTypeCountError(season, tier, role, type);
    sums[slot] += entry.count;
    (qualifying ? qualifyingRules : judgedRules).push(entry.source);
    if (entry.source === "new-award") newAwardTypes.push(type);
  }
  return { expected: sums, qualifyingRules, judgedRules, newAwardTypes: newAwardTypes.sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------
// District eligibility (Q-05)
// ---------------------------------------------------------------------------

export interface DistrictAwardEligibilityInput {
  /** The season priced. */
  readonly season: number;
  /** The district event being priced. */
  readonly eventKey: string;
  /** The district's teams, each with its district tier events this season and its held awards. */
  readonly teams: readonly DcmpEligibilityTeam[];
  /** An event's TBA competition week; null or undefined is never earlier. */
  readonly weekOf: (eventKey: string) => number | null | undefined;
  /** Whether an event's awards are final at the position. */
  readonly awardFinal: (eventKey: string) => boolean;
  /** One team's award profile (the zero profile for a team with none): an open earlier event weighs its entrants by `slateEntrantWeight` at the district tier (Q-11). */
  readonly profileOf: (teamKey: string) => DistrictAwardProfile;
}

/**
 * WHO CAN WIN AT DISTRICT EVENT E (Q-05): a team that already won Impact,
 * Engineering Inspiration or Rookie All Star at an EARLIER district event that
 * season (a strictly smaller TBA week; a null week on either event is never
 * earlier) cannot win that same award at E. Cross awards stay open. An earlier
 * event whose awards are still open contributes the pending chance
 * `dcmpAwardEligibility` uses. Implemented as `dcmpAwardEligibility` over the
 * earlier events only, then 1 minus its chance per award type. Sorted by team
 * key.
 */
export function districtAwardEligibility(input: DistrictAwardEligibilityInput): SlateEligibility[] {
  const week = input.weekOf(input.eventKey);
  const isEarlier = (eventKey: string): boolean => {
    if (eventKey === input.eventKey) return false;
    if (week === null || week === undefined) return false;
    const other = input.weekOf(eventKey);
    return other !== null && other !== undefined && other < week;
  };
  const teams = input.teams.map((team) => ({ ...team, districtEventKeys: team.districtEventKeys.filter(isEarlier) }));
  const eligibility = dcmpAwardEligibility({ season: input.season, teams, awardFinal: input.awardFinal, profileOf: input.profileOf });
  return [...teams]
    .map((team) => ({
      teamKey: team.teamKey,
      impact: 1 - dcmpEligibilityChance(eligibility, team.teamKey, 0),
      engineeringInspiration: 1 - dcmpEligibilityChance(eligibility, team.teamKey, 9),
      rookieAllStar: 1 - dcmpEligibilityChance(eligibility, team.teamKey, 10),
    }))
    .sort((a, b) => (a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The district slate builder
// ---------------------------------------------------------------------------

export interface BuildDistrictAwardSlateInput {
  readonly season: number;
  /** The event's award field. */
  readonly awardField: readonly { readonly teamKey: string }[];
  /** `districtAwardEligibility`'s output at the position. A field member it does not list held nothing earlier: chance 1 for all three. */
  readonly eligibility: readonly SlateEligibility[];
}

/**
 * A district role eligibility list fitted to one award field (quick task
 * 261014-qje): exactly the field's members, sorted by key, each from
 * `eligibility` or, where it lists none, chance 1 for all three (it held
 * nothing at an earlier district event the caller knows of: a guest from
 * outside the district, or a team the district list does not carry).
 */
export function districtEligibilityForField(
  eligibility: readonly SlateEligibility[],
  awardField: readonly { readonly teamKey: string }[]
): SlateEligibility[] {
  const byTeam = new Map(eligibility.map((entry) => [entry.teamKey, entry] as const));
  return [...new Set(awardField.map((member) => member.teamKey))].sort().map((teamKey) => {
    const entry = byTeam.get(teamKey);
    return entry === undefined ? { teamKey, impact: 1, engineeringInspiration: 1, rookieAllStar: 1 } : { ...entry };
  });
}

/** Builds one district event's slate (Q-04, Q-05, Q-10). Throws for an unregistered season or an undeclared season list. */
export function buildDistrictAwardSlate(input: BuildDistrictAwardSlateInput): AwardSlateInput {
  const sums = declaredSlotCounts(input.season, "district", "district", { skipQualifying: false });
  return {
    role: "district",
    expected: sums.expected,
    sources: {
      counts: weakestRule(sums.qualifyingRules),
      judged: weakestRule(sums.judgedRules),
      ...(sums.newAwardTypes.length > 0 ? { newAwardTypes: sums.newAwardTypes } : {}),
    },
    eligibility: districtEligibilityForField(input.eligibility, input.awardField),
  };
}

// ---------------------------------------------------------------------------
// Who: the per team chances (Q-08)
// ---------------------------------------------------------------------------

/** One award field team's slate chances. `eight` is Engineering Inspiration for a veteran and Rookie All Star for a rookie. */
export interface SlateAssignment {
  readonly teamKey: string;
  /** p10. */
  readonly impact: number;
  /** p8 over (1 minus p10). */
  readonly eight: number;
  /** p5 over (1 minus p10 minus p8). */
  readonly judged: number;
  /** The judged slot's lift rung. */
  readonly judgedSource: AwardBaseRateSource;
}

/** Thrown when a slate is priced for a field member with no award profile. */
export class MissingSlateProfileError extends Error {
  constructor(teamKey: string) {
    super(`slateAssignments: ${teamKey} has no award profile`);
    this.name = "MissingSlateProfileError";
  }
}

/** Thrown when a district role slate does not list a field member's eligibility. */
export class MissingSlateEligibilityError extends Error {
  constructor(teamKey: string) {
    super(`slateAssignments: the district slate lists no eligibility for award field member ${teamKey}`);
    this.name = "MissingSlateEligibilityError";
  }
}

/** The tier a slate role prices at. */
export function slateRoleTier(role: AwardSlateRole): AwardSlateTier {
  return role === "district" ? "district" : "dcmp";
}

/**
 * Every award field team's chances under one slate, in award field order
 * (Q-08). For each slot in order: cap = q times room (q is 0 outside the
 * audience, the eligibility chance for the three qualifying awards, 1 for the
 * 5 point slots), weight = lift times cap, the slot's count water filled, room
 * reduced by what was filled. Then p10 = impact, p8 = EI plus RAS, p5 =
 * judgedRookie plus judged, p0 = the room left, kept in the assignment shape
 * `slateAwardOutcomeOdds` reads.
 */
export function slateAssignments(
  season: number,
  awardField: readonly { readonly teamKey: string }[],
  awardProfiles: ReadonlyMap<string, DistrictAwardProfile>,
  slate: AwardSlateInput
): readonly SlateAssignment[] {
  const tables = awardSlateTables(season, slateRoleTier(slate.role));
  const profiles = awardField.map((member) => {
    const profile = awardProfiles.get(member.teamKey);
    if (profile === undefined) throw new MissingSlateProfileError(member.teamKey);
    return profile;
  });
  const eligibilityByTeam = new Map(slate.eligibility.map((entry) => [entry.teamKey, entry] as const));
  if (slate.role === "district") {
    for (const member of awardField) if (!eligibilityByTeam.has(member.teamKey)) throw new MissingSlateEligibilityError(member.teamKey);
  }
  // ALL OR NOTHING per field: one profile without both counts prices every
  // team at lift 1, never from a fabricated class.
  const counts = profiles.map(completeCounts);
  const complete = counts.every((entry) => entry !== undefined);

  const n = awardField.length;
  const room = new Array<number>(n).fill(1);
  const filledBySlot = new Map<AwardSlot, number[]>();
  const judgedSources: AwardBaseRateSource[] = new Array<AwardBaseRateSource>(n).fill("season-pooled");
  for (const slot of AWARD_SLOTS) {
    const caps = new Array<number>(n).fill(0);
    const weights = new Array<number>(n).fill(0);
    const awardType = QUALIFYING_SLOT_TYPE[slot];
    for (let j = 0; j < n; j++) {
      const profile = profiles[j]!;
      const lift = complete ? slateLift(tables, slot, counts[j]!) : { lift: 1, source: "season-pooled" as const };
      if (slot === "judged") judgedSources[j] = lift.source;
      if (!inSlotAudience(slot, profile.rookieState)) continue;
      let q = 1;
      if (awardType !== undefined) {
        const entry = eligibilityByTeam.get(awardField[j]!.teamKey);
        q = entry === undefined ? 0 : awardType === 0 ? entry.impact : awardType === 9 ? entry.engineeringInspiration : entry.rookieAllStar;
      }
      caps[j] = q * room[j]!;
      weights[j] = lift.lift * caps[j]!;
    }
    const filled = waterFill(weights, caps, slate.expected[slot]);
    for (let j = 0; j < n; j++) room[j] = Math.max(0, room[j]! - filled[j]!);
    filledBySlot.set(slot, filled);
  }
  const t = (slot: AwardSlot, j: number): number => filledBySlot.get(slot)![j]!;
  return awardField.map((member, j) => {
    const p10 = t("impact", j);
    const p8 = t("engineeringInspiration", j) + t("rookieAllStar", j);
    const p5 = t("judgedRookie", j) + t("judged", j);
    const afterImpact = 1 - p10;
    const afterEight = 1 - p10 - p8;
    return {
      teamKey: member.teamKey,
      impact: p10,
      eight: p8 > 0 && afterImpact > 0 ? Math.min(1, p8 / afterImpact) : 0,
      judged: p5 > 0 && afterEight > 0 ? Math.min(1, p5 / afterEight) : 0,
      judgedSource: judgedSources[j]!,
    };
  });
}

/** One slate assignment's exact base scale outcome odds: the highest single award of Impact, then the 8 point award, then one 5 point award. */
export function slateAwardOutcomeOdds(assignment: SlateAssignment): { p10: number; p8: number; p5: number; p0: number; impact: number } {
  const pI = assignment.impact;
  const p8 = (1 - pI) * assignment.eight;
  const p5 = (1 - pI) * (1 - assignment.eight) * assignment.judged;
  return { p10: pI, p8, p5, p0: (1 - pI) * (1 - assignment.eight) * (1 - assignment.judged), impact: pI };
}
