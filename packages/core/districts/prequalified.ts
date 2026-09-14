/**
 * Curated FIRST Championship pre-qualified team lists, per season. Applies
 * only to the "cmp" (Championship) tier — the district-event and DCMP tiers
 * have no pre-qualification concept at all, only points and award-based
 * slots.
 *
 * `prequalifiedTeams(season)` feeds `locks.ts`'s `computeLocksWithQualifiers`
 * as the NON-CONSUMING set: these teams are removed from the champ points
 * pool entirely but do not reduce the district's champ slot allocation the
 * way an award-qualifier does.
 *
 * 2016-2020's category list is each season's own manual, read verbatim:
 * 2016/2017 carry Hall of Fame, original & sustaining, prior-year CMP
 * winners and EI winners (no Chairman's Finalist category); 2018-2020 add
 * prior-year Chairman's Finalists. Every one of those manuals says "member
 * of the FIRST Hall of Fame" with no year window, so 2016-2020 take the
 * whole roster inducted before the season (`HALL_OF_FAME_INDUCTIONS`); the
 * windowed lists begin in 2022. 2020 omits original & sustaining — TBA's own
 * rule ends at `year_end=2019` and the 2020 manual text is disputed, so the
 * disputed category is omitted rather than silently picked (the safe
 * direction, see below).
 *
 * This file errs only toward UNDER-population, the safe direction, never a
 * correctness gap in the lock math itself: an unlisted prequalified team is
 * simply treated as a normal points-competing team, which can only make
 * that team's own status less favorable and a genuine rival's status more
 * conservative — never a false "locked" guarantee for anyone. The reverse
 * error is unsafe, so every category and team above is read from a source,
 * never assumed.
 */

/** `frcN` team-key strings for a list of bare team numbers, the corpus's own team_key convention. */
function teamKeys(numbers: readonly number[]): string[] {
  return numbers.map((n) => `frc${n}`);
}

/**
 * Original & sustaining teams (TBA's `ORIGINAL_AND_SUSTAINING_TEAMS`). TBA's
 * rule applies one static set from 1992 through `year_end=2019`; this file
 * uses it for 2016-2019, the seasons it covers. 2020 is excluded (see file
 * header's disputed-2020 note).
 */
const ORIGINAL_AND_SUSTAINING: readonly number[] = [20, 45, 126, 148, 151, 157, 190, 191, 250];
const ORIGINAL_AND_SUSTAINING_FIRST_SEASON = 2016;
const ORIGINAL_AND_SUSTAINING_LAST_SEASON = 2019;

/**
 * Every FIRST Hall of Fame team through 2019, keyed by the season it won the
 * Championship Chairman's Award. Transcribed from firsthalloffame.org's
 * roster, cross-checked against TBA's own `hall_of_fame_teams()` derivation
 * (the two agree 1995-2019). TBA's award data also credits team 191 with
 * 1992/1994 wins the official roster does not list, and lacks the 1993
 * winner (team 7); the official roster is followed on both counts.
 */
const HALL_OF_FAME_INDUCTIONS: Readonly<Record<number, readonly number[]>> = {
  1993: [7],
  1995: [151],
  1996: [144],
  1997: [47],
  1998: [23],
  1999: [120],
  2000: [16],
  2001: [22],
  2002: [175],
  2003: [103],
  2004: [254],
  2005: [67],
  2006: [111],
  2007: [365],
  2008: [842],
  2009: [236],
  2010: [341],
  2011: [359],
  2012: [1114],
  2013: [1538],
  2014: [27],
  2015: [597],
  2016: [987],
  2017: [2614, 3132],
  2018: [2834, 1311],
  2019: [1816, 1902],
};

/** Seasons whose manual pre-qualifies EVERY Hall of Fame member, with no year window (see this module's header). */
const WHOLE_HALL_OF_FAME_SEASONS: ReadonlySet<number> = new Set([2016, 2017, 2018, 2019, 2020]);

/** Hall of Fame teams, per season. TBA's own list is preferred over the FIRST eligibility page's one-team-shorter list, for consistency with the slot counts' provenance. */
const HALL_OF_FAME_BY_SEASON: Readonly<Record<number, readonly number[]>> = {
  2022: [27, 503, 597, 987, 1114, 1311, 1538, 1816, 1902, 2614, 2834, 3132, 4613],
  2023: [27, 359, 503, 597, 987, 1114, 1311, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613],
  2024: [27, 321, 359, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613],
  2025: [27, 321, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2486, 2614, 2834, 3132, 4613],
  2026: [5985, 2486, 321, 1629, 503, 4613, 1816, 1902, 1311, 2834],
};

/**
 * Prior-year (season-1) FIRST Championship pre-qualifiers. 2016-2020 come
 * from TBA award rows (see file header). 2023-2025 are verbatim from the
 * eligibility pages: CMP Winners, Impact/Chairman's Finalists, EI Winners,
 * and the single prior-year Impact/Chairman's Winner (who also appears in
 * that season's own Hall of Fame list — deduplicated by the Set
 * `prequalifiedTeams` builds below, never double-counted).
 *
 * 2017-2019 each held two Championships, so those seasons' winner and
 * finalist rows name both sites.
 *
 * 2025 additionally carries a one-off, named exception: team 9739, "due to
 * extreme outside factors that impacted their ability to attend the 2024
 * FIRST Championship."
 */
const PRIOR_YEAR_CMP_PREQUALIFIERS_BY_SEASON: Readonly<Record<number, readonly number[]>> = {
  2016: [
    // 2015 CMP Winners (2015cmp)
    118, 1678, 1671, 5012,
    // 2015 EI Winners (2015cars, 2015carv, 2015new, 2015tes)
    3478, 771, 195, 3132,
  ],
  2017: [
    // 2016 CMP Winners (2016cmp)
    330, 2481, 120, 1086,
    // 2016 EI Winners (2016arc, 2016cur, 2016gal, 2016new)
    3211, 3990, 2468, 1676,
  ],
  2018: [
    // 2017 CMP Winners (2017cmpmo, 2017cmptx)
    2767, 254, 862, 1676, 973, 1011, 2928, 5499,
    // 2017 EI Winners (2017dal, 2017dar, 2017gal, 2017new, 2017tes, 2017tur)
    27, 3324, 5437, 2096, 1023, 1540,
    // 2017 Chairman's Finalists (2017cmpmo, 2017cmptx)
    2169, 1885, 2614, 1902, 3646, 3132,
  ],
  2019: [
    // 2018 CMP Winners (2018cmpmi, 2018cmptx)
    2767, 27, 2708, 4027, 254, 148, 2976, 3075,
    // 2018 EI Winners (2018cars, 2018carv, 2018dal, 2018dar, 2018roe, 2018tur)
    2137, 5987, 4481, 772, 6348, 3847,
    // 2018 Chairman's Finalists (2018cmpmi, 2018cmptx)
    1816, 2220, 2834, 1311, 2096, 2468,
  ],
  2020: [
    // 2019 CMP Winners (2019cmpmi, 2019cmptx)
    3707, 217, 4481, 1218, 973, 1323, 5026, 4201,
    // 2019 EI Winners (2019arc, 2019cars, 2019carv, 2019cur, 2019roe, 2019tur)
    1325, 2096, 2905, 2834, 2557, 3284,
    // 2019 Chairman's Finalists (2019cmpmi, 2019cmptx)
    1629, 1816, 5672, 1902, 2682, 3646,
  ],
  2023: [
    // 2022 CMP Winners
    1619, 254, 3175, 6672,
    // 2022 Chairman's Finalists
    1511, 2438, 2468, 6429, 6652,
    // 2022 EI Winners
    2096, 2341, 2905, 3928, 4329, 5985,
    // 2022 Chairman's Winner
    1629,
  ],
  2024: [
    // 2023 CMP Winners
    1323, 2609, 4096, 4414,
    // 2023 Impact Finalists
    118, 3284, 5665, 5985, 6865,
    // 2023 EI Winners
    4, 1156, 1676, 2096, 2486, 3937, 5166, 7565,
    // 2023 Impact Winner
    321,
  ],
  2025: [
    // 2024 CMP Winners
    1690, 4522, 9432, 321,
    // 2024 Impact Finalists
    2438, 3990, 5614, 5985, 6429,
    // 2024 EI Winners
    2638, 2642, 3478, 4091, 4403, 6413, 8159, 9008,
    // 2024 Impact Winner
    2486,
    // one-off exception, research Q3: "extreme outside factors"
    9739,
  ],
};

/**
 * Every FIRST Championship pre-qualified team for `season`, as a
 * `frcN`-keyed set. `season >= 2026` carries no prior-year category at
 * all — non-Hall-of-Fame pre-qualification slots were removed for 2026 on.
 */
export function prequalifiedTeams(season: number): ReadonlySet<string> {
  const numbers = new Set<number>();

  if (season >= ORIGINAL_AND_SUSTAINING_FIRST_SEASON && season <= ORIGINAL_AND_SUSTAINING_LAST_SEASON) {
    for (const n of ORIGINAL_AND_SUSTAINING) numbers.add(n);
  }

  if (WHOLE_HALL_OF_FAME_SEASONS.has(season)) {
    for (const [inducted, teams] of Object.entries(HALL_OF_FAME_INDUCTIONS)) {
      if (Number(inducted) < season) for (const n of teams) numbers.add(n);
    }
  }

  const hof = HALL_OF_FAME_BY_SEASON[season];
  if (hof !== undefined) {
    for (const n of hof) numbers.add(n);
  }

  const priorYear = PRIOR_YEAR_CMP_PREQUALIFIERS_BY_SEASON[season];
  if (priorYear !== undefined) {
    for (const n of priorYear) numbers.add(n);
  }

  return new Set(teamKeys([...numbers]));
}
