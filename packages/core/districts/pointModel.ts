/**
 * The FIRST district point model's declared per-component ceilings — the
 * one table `reconciliation.test.ts` proves is never exceeded by any real
 * TBA-reported `district_rankings.event_points_raw` component in the
 * ingested corpus, which is what makes the District/Champ Locks tabs'
 * "mathematically guaranteed" verdict actually true rather than a guess.
 *
 * qual/alliance/elim are verified against the official FIRST district point
 * model (Admin Manual, District Tournaments section) and agree with the
 * maximum TBA ever actually reported per component across every ingested
 * season (2016-2020, 2022-2026; 2021 excluded).
 *
 * THE MEASUREMENT TRAP: an `event_points_raw` entry's tier must be read
 * from that entry's own `district_cmp` boolean, never inferred by joining
 * to `events` and testing `event_type == 2` — that misclassification yields
 * a bogus district-tier qual maximum of 66 (the dcmp-tier figure wearing
 * the district tier's name).
 *
 * THE AWARD CEILING IS A DELIBERATE JUDGMENT CALL. The official model has
 * no stated per-event cap on award points, and a team can win multiple
 * judged awards at one event. A ceiling too LOW is the one direction this
 * model must never err in — it would understate a rival's reachable total
 * and could declare a false "locked" guarantee — while too high only
 * delays a verdict. Every season declares award=15, the highest stack ever
 * observed in the corpus (Impact + one judged award).
 *
 * The "dcmp" tier's every observed maximum is at or below exactly 3x the
 * same season's "district" maximum, confirming the manual's stated 3x
 * weight. Award is the one component where the ratio does not always close
 * — 2016-2018's observed dcmp award maximum is 30, not 45, because no team
 * in those seasons collected the full award stack at a DCMP — but the
 * declared ceiling stays 15 regardless, for the same never-err-low reason.
 *
 * Inert on the site today: 2016-2018 artifacts don't exist in R2, so those
 * rows are consumed only by the harness and by `reconciliation.test.ts`'s
 * corpus proof until a publish for those seasons lands.
 */

/** The two event tiers this point model distinguishes — a regular district event, or a District Championship (weighted). */
export type DistrictTier = "district" | "dcmp";

/** Thrown by `maxEventPoints` for a season this module does not carry a declared ceiling for — never silently falls back to a guess. */
export class UnknownDistrictSeasonError extends Error {
  constructor(season: number) {
    super(
      `pointModel: no declared district point ceiling for season ${season} (registered: ${DISTRICT_REGISTERED_SEASONS.join(", ")}) — refusing to guess a maximum for an unlisted season`
    );
    this.name = "UnknownDistrictSeasonError";
  }
}

/** One season's regular ("district") tier per-component ceiling, before the DCMP weight is applied. */
interface SeasonDistrictBaseMaxima {
  readonly qual: number;
  readonly alliance: number;
  readonly elim: number;
  readonly award: number;
}

/** The per-component ceiling `maxEventPoints` returns for one event at one tier. */
export interface EventPointMaxima {
  readonly qual: number;
  readonly alliance: number;
  readonly elim: number;
  readonly award: number;
}

/**
 * Regular-tier ceilings per season — qual/alliance/elim verified against the
 * official model; award is the deliberately-conservative stacking ceiling
 * (see this file's header for the full reasoning).
 */
const DISTRICT_BASE_MAXIMA: Readonly<Record<number, SeasonDistrictBaseMaxima>> = {
  2016: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2017: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2018: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2019: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2020: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2022: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2023: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2024: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2025: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2026: { qual: 22, alliance: 16, elim: 30, award: 15 },
};

/**
 * The District Championship weight, declared per-season rather than one
 * hardcoded constant — every registered season carries the value 3,
 * confirmed against every ingested season's qual/alliance/elim ratios (see
 * file header).
 */
const DCMP_WEIGHT: Readonly<Record<number, number>> = {
  2016: 3,
  2017: 3,
  2018: 3,
  2019: 3,
  2020: 3,
  2022: 3,
  2023: 3,
  2024: 3,
  2025: 3,
  2026: 3,
};

/** Every season this module carries a declared ceiling for — the exact set `UnknownDistrictSeasonError` names. */
export const DISTRICT_REGISTERED_SEASONS: readonly number[] = Object.keys(DISTRICT_BASE_MAXIMA)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Returns the per-component point ceiling for one event at `tier`, for
 * `season`. `"dcmp"` is the `"district"` tier's own ceiling multiplied by
 * that season's declared DCMP weight — never a second, independently
 * hardcoded set of numbers that could drift from the base table. Throws
 * `UnknownDistrictSeasonError` for a season this module does not carry a
 * declared ceiling for, rather than returning a guess.
 */
export function maxEventPoints(season: number, tier: DistrictTier): EventPointMaxima {
  const base = DISTRICT_BASE_MAXIMA[season];
  if (base === undefined) throw new UnknownDistrictSeasonError(season);
  if (tier === "district") return { ...base };
  const weight = DCMP_WEIGHT[season];
  if (weight === undefined) throw new UnknownDistrictSeasonError(season);
  return {
    qual: base.qual * weight,
    alliance: base.alliance * weight,
    elim: base.elim * weight,
    award: base.award * weight,
  };
}

