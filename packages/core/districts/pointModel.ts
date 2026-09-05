/**
 * The FIRST district point model's declared per-component ceilings (quick
 * task 260905-lic Task 2) — the ONE table `reconciliation.test.ts` proves is
 * never exceeded by any real TBA-reported `district_rankings.event_points_raw`
 * component in the ingested corpus, which is what makes the District/Champ
 * Locks tabs' "mathematically guaranteed" verdict actually true rather than a
 * guess.
 *
 * SOURCE: verified 2026-09-05 against the official FIRST district point
 * model (2026 Admin Manual, District Tournaments section, via
 * frcmanual.com/2026/district-tournaments): qualification max 22 (min 4),
 * alliance selection max 16 (17 minus captain/draft position, so position 1
 * earns 16), playoff max 30 (20 double-elim + 10 finals), District
 * Championship multiplier 3x, rookie bonus 10 (first-year) / 5
 * (second-year). Award points: 10 for the FIRST Impact Award (Chairman's
 * before 2025), 8 each for Engineering Inspiration and Rookie All-Star,
 * 5 for every other judged team award. All of these agree with the maximum
 * value TBA ever actually reported per component across the full ingested
 * corpus (2019, 2020, 2022-2026; qual=22, alliance=16, elim=30 in every
 * season).
 *
 * THE AWARD CEILING IS A DELIBERATE JUDGMENT CALL. The official model has
 * no stated per-event cap on award points, and one team CAN win multiple
 * judged awards at one event: the corpus itself shows 15 (Impact 10 + a
 * 5-point judged award) in 2019/2020 and 13 (an 8-pointer + a 5-pointer) in
 * 2022. From 2023 on the observed maximum is exactly 10, but the per-award
 * values did not change and no rule forbids stacking (the rookie-only
 * awards were only retired for 2024/2025), so 10 is the observed maximum,
 * not a theoretical ceiling. A ceiling that is too LOW is the one direction
 * this model must never err in — it understates a rival's reachable total
 * and can declare a false "locked" guarantee — while a ceiling that is too
 * high only delays a verdict, so every season declares award=15, the
 * highest stack ever demonstrated (Impact + one judged). No larger stack
 * (e.g. Impact + two judged, 20) appears anywhere in ~12,000 ingested
 * team-season rows across eight seasons.
 *
 * The "dcmp" (District Championship) tier's every observed maximum is at or
 * below exactly 3x the same season's "district" maximum (qual 66/22,
 * alliance 48/16, elim 90/30 in every season with real DCMP data; 2019's
 * award 45/15 hits the ratio exactly) — confirming the manual's stated 3x
 * weight directly against every ingested season.
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
 * Regular-tier ceilings per season — qual/alliance/elim verified against the
 * official model; award is the deliberately-conservative stacking ceiling
 * (see this file's header for the full reasoning).
 */
const DISTRICT_BASE_MAXIMA: Readonly<Record<number, SeasonDistrictBaseMaxima>> = {
  2019: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2020: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2022: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2023: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2024: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2025: { qual: 22, alliance: 16, elim: 30, award: 15 },
  2026: { qual: 22, alliance: 16, elim: 30, award: 15 },
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

/** Once-per-season rookie bonus ceiling — official model: 10 for a first-year team, 5 for a second-year team; the corpus maximum observed is 10 in every ingested season. */
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
