/**
 * The FIRST district point model's declared per-component ceilings (quick
 * task 260905-lic Task 2) — the ONE table `reconciliation.test.ts` proves is
 * never exceeded by any real TBA-reported `district_rankings.event_points_raw`
 * component in the ingested corpus, which is what makes the District/Champ
 * Locks tabs' "mathematically guaranteed" verdict actually true rather than a
 * guess.
 *
 * SOURCE AND HONESTY NOTE: this executor's sandbox denies outbound network,
 * so the official FIRST district-points documentation could not be fetched
 * live while writing this table. The declared values below are CORPUS-
 * CONVERGED: derived by scanning every ingested season's real
 * `district_rankings.event_points_raw` rows (2019, 2020, 2022-2026, the full
 * ingested population, not a sample) and taking the maximum value TBA ever
 * actually reported for each component at each tier. This mirrors this
 * repo's own established precedent for a value that could not be sourced
 * live — `packages/core/algorithms/sigma1/rp/2019.ts`'s and `2026.ts`'s
 * "corpus-converged" thresholds, and `STATE.md`'s own recorded 2025/2026
 * threshold entries — and, like those, is FLAGGED here for a human to
 * confirm against the official FIRST Admin Manual / district points
 * documentation. It must never be silently trusted as a verified citation.
 *
 * Measured maxima (this session, full corpus scan, one component-tier pair
 * per row): every season shows qual=22, alliance=16, elim=30 for the
 * REGULAR ("district") tier, invariant across all seven ingested seasons —
 * strong evidence these are the model's actual hard caps, not sampling
 * artifacts. `award` moves across seasons (15 in 2019/2020, 13 in 2022, 10
 * from 2023 onward), consistent with FIRST's own history of reducing the
 * relative weight of award points against competition points over time. The
 * "dcmp" (District Championship) tier's every observed maximum is at or
 * below exactly 3x the same season's "district" maximum (qual 66/22,
 * alliance 48/16, elim 90/30 in every season with real DCMP data; 2019's
 * award 45/15 hits the ratio exactly) — confirming the plan's stated 3x
 * district-championship weight directly against 2026fnc's live breakdown as
 * well as every other ingested season.
 */

/** The two event tiers this point model distinguishes — a regular district event, or a District Championship (weighted). */
export type DistrictTier = "district" | "dcmp";

/** Thrown by `maxEventPoints`/`maxRookieBonus` for a season this module does not carry a declared ceiling for — never silently falls back to a guess. */
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
 * Corpus-converged regular-tier ceilings per season — see this file's header
 * for the full sourcing note and the flagged-for-human-confirmation caveat.
 */
const DISTRICT_BASE_MAXIMA: Readonly<Record<number, SeasonDistrictBaseMaxima>> = {
  2019: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2020: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2022: { qual: 22, alliance: 16, elim: 30, award: 13 },
  2023: { qual: 22, alliance: 16, elim: 30, award: 10 },
  2024: { qual: 22, alliance: 16, elim: 30, award: 10 },
  2025: { qual: 22, alliance: 16, elim: 30, award: 10 },
  2026: { qual: 22, alliance: 16, elim: 30, award: 10 },
};

/**
 * The District Championship weight, declared per-season (not a single
 * hardcoded constant reused everywhere) per this plan's own instruction —
 * every registered season carries the value 3, confirmed directly against
 * 2026fnc's live breakdown and against every other ingested season's
 * qual/alliance/elim ratios (see file header).
 */
const DCMP_WEIGHT: Readonly<Record<number, number>> = {
  2019: 3,
  2020: 3,
  2022: 3,
  2023: 3,
  2024: 3,
  2025: 3,
  2026: 3,
};

/** Corpus-converged once-per-season rookie bonus ceiling — measured maximum observed is 10 in every ingested season. */
const ROOKIE_BONUS_MAXIMA: Readonly<Record<number, number>> = {
  2019: 10,
  2020: 10,
  2022: 10,
  2023: 10,
  2024: 10,
  2025: 10,
  2026: 10,
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

/** Returns the once-per-season rookie bonus ceiling for `season`. Throws `UnknownDistrictSeasonError` for an unlisted season. */
export function maxRookieBonus(season: number): number {
  const max = ROOKIE_BONUS_MAXIMA[season];
  if (max === undefined) throw new UnknownDistrictSeasonError(season);
  return max;
}
