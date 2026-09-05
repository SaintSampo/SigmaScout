/**
 * Curated FIRST Championship pre-qualified team lists, per season (quick task
 * 260905-lic revision R2a) -- copied VERBATIM from
 * `260905-lic-RESEARCH-awards.md` §Q3 ("Curated pre-qualified lists") and its
 * prior-year enumerations, each cited by team-number list below. Applies
 * ONLY to the "cmp" (Championship) tier -- research Q3 confirms the
 * district-event and DCMP tiers have no pre-qualification concept at all,
 * only points and award-based slots.
 *
 * `prequalifiedTeams(season)` feeds `locks.ts`'s `computeLocksWithQualifiers`
 * as the NON-CONSUMING set (research Q5: `HALL_OF_FAME` /
 * `PRIOR_YEAR_CMP_*` all carry `eats_district_slot: False`): these teams are
 * removed from the champ points pool entirely (they need no points and are
 * never a "threat" to anyone else's cut line) but do NOT reduce the
 * district's champ slot allocation the way an award-qualifier does.
 *
 * 2019/2020 GAP, DOCUMENTED NOT GUESSED: the research could not enumerate
 * the full Hall-of-Fame roster for these two seasons (no year window stated
 * in either manual, "not checked" against a full HoF roster) or the
 * prior-year (2018) Championship winner/EI/Chairman's-Finalist teams --
 * 2018 predates this corpus entirely, so there is no ingested award data to
 * derive them from either (research Q3: "For 2019/2020 the equivalent lists
 * are not enumerated in the manual... Derive them from TBA awards data...
 * exactly as TBA's prior_year_cmp_teams() does" -- infeasible here without a
 * 2018 corpus). Per this pipeline's "never guess a value" rule, 2019 below
 * carries ONLY the one fully-enumerable category (original & sustaining
 * teams, cited verbatim) and 2020 carries NO list at all (research Q3 note
 * 3: TBA's own `ORIGINAL_AND_SUSTAINING` rule ends at `year_end=2019`, and
 * the research's own recommendation is to follow TBA so the slot arithmetic
 * reconciles against `official_advancement_counts` — the disputed 2020
 * manual text is flagged, not silently picked).
 *
 * This under-population is the SAFE direction, not a correctness gap in the
 * lock math itself: an unlisted prequalified team is simply treated as a
 * normal points-competing team in the pool, which can only ever make that
 * one team's OWN status less favorable (never "locked"/"prequalified" when
 * it should be "contending") and can only ever make a genuine rival's status
 * MORE conservative (an extra competitor in the pool, never fewer) -- it can
 * never fabricate a false "locked" guarantee for anyone.
 */

/** `frcN` team-key strings for a list of bare team numbers -- the corpus's own team_key convention (`packages/corpus/schema.sql`'s `teams.team_key`). */
function teamKeys(numbers: readonly number[]): string[] {
  return numbers.map((n) => `frc${n}`);
}

/**
 * Original & sustaining teams (research Q3, `TBA cmp_qualification.py
 * ORIGINAL_AND_SUSTAINING_TEAMS`) -- applies 2019 ONLY per TBA's own
 * `year_end=2019` rule (research Q3 note 3's disputed-2020 resolution).
 */
const ORIGINAL_AND_SUSTAINING_2019: readonly number[] = [20, 45, 126, 148, 151, 157, 190, 191, 250];

/** Hall of Fame teams, per season (research Q3's "Curated pre-qualified lists" table) -- TBA's own list is preferred over the FIRST eligibility page's one-team-shorter list, per research Q3 note 5, "same provenance as the slot counts". */
const HALL_OF_FAME_BY_SEASON: Readonly<Record<number, readonly number[]>> = {
  2022: [27, 503, 597, 987, 1114, 1311, 1538, 1816, 1902, 2614, 2834, 3132, 4613],
  2023: [27, 359, 503, 597, 987, 1114, 1311, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613],
  2024: [27, 321, 359, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2614, 2834, 3132, 4613],
  2025: [27, 321, 503, 597, 987, 1114, 1538, 1629, 1816, 1902, 2486, 2614, 2834, 3132, 4613],
  2026: [5985, 2486, 321, 1629, 503, 4613, 1816, 1902, 1311, 2834],
};

/**
 * Prior-year (season-1) FIRST Championship pre-qualifiers, verbatim from the
 * eligibility pages (research Q3): CMP Winners, Impact/Chairman's Finalists,
 * EI Winners, and the single prior-year Impact/Chairman's Winner (who also
 * appears in that season's own Hall of Fame list -- deduplicated by the Set
 * `prequalifiedTeams` builds below, never double-counted).
 *
 * 2025 additionally carries a one-off, named exception (research Q3):
 * team 9739, "Due to extreme outside factors that impacted their ability to
 * attend the 2024 FIRST Championship."
 */
const PRIOR_YEAR_CMP_PREQUALIFIERS_BY_SEASON: Readonly<Record<number, readonly number[]>> = {
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
 * Every FIRST Championship pre-qualified team for `season` (research Q3),
 * as a `frcN`-keyed set. `season >= 2026` carries NO prior-year category at
 * all (research Q3: "For 2026 and beyond, all non-Hall of Fame
 * pre-qualifications slots are being removed") -- Hall of Fame only.
 */
export function prequalifiedTeams(season: number): ReadonlySet<string> {
  const numbers = new Set<number>();

  if (season === 2019) {
    for (const n of ORIGINAL_AND_SUSTAINING_2019) numbers.add(n);
  }
  // 2020: no list at all -- see this module's header comment (disputed
  // original & sustaining category, TBA's year_end=2019 followed).

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
