/**
 * THE SIGMA CARRY (Decision 1 of debug session `presim-bake-rp-filler-refuses`,
 * Jacob 2026-09-28), the production model since SPR 9.0.0. The layer carry
 * runs in both production season loops, `publishSeasons` and the district
 * bake's `buildDistrictPricingState`; the rookie rule prices the presim
 * sidecars (`rookieRuleRatings` in `publish.ts`) and the district bake, and
 * never an upcoming row (`SigmaScoutLayer.enrichUpcoming`,
 * `upcomingPricing.ts` and the Worker keep per-alliance Sigma gating).
 * `sigmaCarry: false` rebuilds the pre-9.0.0 model, for instruments only.
 *
 * WHAT IT CHANGES. Two things, and only these two:
 *
 *   1. CARRY. A season's SPR Sigma accumulator starts from the previous
 *      season's, as it stood right after that season's LAST OFFICIAL match
 *      (`isOfficialEventType`, the instant SPR's own `carryFrom:
 *      "last-official-match"` carries from), instead of starting empty. Per
 *      team, the volatility evidence (`varWeight`, `sumSquares`) and the last
 *      observed `talent` carry unchanged: the accumulator ages evidence by the
 *      team's OWN matches (`varHalfLife`), not by the calendar, so an offseason
 *      is no time at all to it, exactly as a three-week gap between events is
 *      no time at all inside a season. The bias term (`mean`, `meanWeight`)
 *      resets to zero, as SPR resets its fast component at a boundary: it
 *      measures a lag against a rating that has just been re-baselined. The
 *      talent prior's population starts from the previous season's OWN
 *      population (`seasonOwnPopulation`), so no season's residuals reach
 *      further than the next season.
 *
 *   2. THE ROOKIE RULE (`candidateRosterRatings`). A roster team the algorithm
 *      has never seen is rated with what the algorithm's own `predict` already
 *      assigns it (`AlgorithmModule.unseenTeamMetrics`), and a roster team with
 *      no Sigma belief gets the accumulator's own prior-only Sigma at that
 *      total (`SigmaScoreAccumulator.priorSigmaAtTalent`), read at the same
 *      instant as the pricing state. Used by the presim sidecars, the district
 *      bake's pricing state and `scripts/measureSigmaCarry.ts`.
 *
 * NO NUMERIC PARAMETER. The carry is one configuration, on or off.
 *
 * WHAT IT CANNOT CHANGE. SPR's `pRedWin` is computed from SPR state alone
 * before any `SigmaScoutLayer` runs, and the published winner accuracy and
 * Brier read `pRedWin` alone, so neither can move. What can move: Sigma Score,
 * the Match Band, ranking-point pmfs (through the score variance), and which
 * rosters the Sigma gates price: upcoming rows through the carried beliefs
 * alone, presim sidecars and district bakes through the carry and the rookie
 * rule.
 *
 * WALK-FORWARD. The carry into season S holds only what the layer folded in
 * earlier seasons (up to their last official match); inside S the layer still
 * reads each match before folding it. The rookie rating reads frozen
 * parameters and the online scale at the pricing instant.
 *
 * The acceptance bar it passed is pre-registered in
 * `.planning/debug/presim-bake-rp-filler-refuses.md` ("Pre-registered
 * Acceptance Bar (Decision 1)"), and the retry with the RP cold-team prior in
 * `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`.
 * It shipped as SPR 9.0.0 (quick task 260928-p8i).
 */
import type { SigmaBelief, SigmaPopulation } from "./sigmaScore.js";

/** What one season hands the next when the carry is on: the Sigma beliefs and the population the next season's accumulator starts from. */
export interface SigmaSeasonCarry {
  readonly beliefs: ReadonlyMap<string, SigmaBelief>;
  readonly population: SigmaPopulation;
}

/** The population a season with nothing carried in starts from. */
export const ZERO_SIGMA_POPULATION: SigmaPopulation = Object.freeze({ sumSquares: 0, talentSquares: 0, count: 0 });

/**
 * The beliefs as they cross a season boundary: bias reset, volatility evidence
 * and talent unchanged. Fresh copies, so the caller's map is never mutated.
 */
export function acrossSigmaBoundary(beliefs: ReadonlyMap<string, SigmaBelief>): Map<string, SigmaBelief> {
  const out = new Map<string, SigmaBelief>();
  for (const [teamKey, belief] of beliefs) {
    out.set(teamKey, {
      meanWeight: 0,
      mean: 0,
      varWeight: belief.varWeight,
      sumSquares: belief.sumSquares,
      talent: belief.talent,
    });
  }
  return out;
}

/**
 * The population a season folded ITSELF: its accumulator's population at the
 * carry instant minus what it was started with. A season that folded nothing
 * (an empty stream, like 2021) passes its carried-in population through, so a
 * gap in the season list never throws the prior back to its flat fallback.
 */
export function seasonOwnPopulation(atCarry: SigmaPopulation, carriedIn: SigmaPopulation): SigmaPopulation {
  const count = atCarry.count - carriedIn.count;
  if (count <= 0) return { ...carriedIn };
  return {
    sumSquares: atCarry.sumSquares - carriedIn.sumSquares,
    talentSquares: atCarry.talentSquares - carriedIn.talentSquares,
    count,
  };
}

/** One roster team under the rookie rule. */
export interface CandidateRosterRating {
  /** The algorithm's published total, or its unseen-team total when it holds no state for this team. `undefined` only when neither exists. */
  readonly total: number | undefined;
  /** The layer's Sigma Score, or the prior-only Sigma at `total` when the layer holds no belief. `undefined` only when neither exists. */
  readonly sigma: number | undefined;
  /** True when `total` is the unseen-team total (a rookie, to the algorithm). */
  readonly unseenByAlgorithm: boolean;
  /** True when `sigma` is the prior-only reading rather than a belief. */
  readonly priorOnlySigma: boolean;
}

export interface CandidateRosterRatingsInput {
  readonly roster: readonly string[];
  /** The algorithm's published totals for the roster (`teamMetrics`); a team it holds no state for is absent. */
  readonly totalByTeam: ReadonlyMap<string, number>;
  /** `unseenTeamMetrics`' total at the same instant, or `undefined` when the algorithm exposes none. */
  readonly unseenTotal: number | undefined;
  /** The layer's Sigma Scores (`sigmaScoreByTeam()`). */
  readonly sigmaByTeam: ReadonlyMap<string, number>;
  /** The layer's prior-only Sigma at a talent (`sigmaPriorAtTalent`). */
  readonly priorSigmaAtTalent: (talent: number) => number | undefined;
}

/**
 * The rookie rule's rating for every roster team. A non-finite total is
 * treated as absent, so it can never become a talent that reads as a Sigma.
 */
export function candidateRosterRatings(input: CandidateRosterRatingsInput): ReadonlyMap<string, CandidateRosterRating> {
  const out = new Map<string, CandidateRosterRating>();
  for (const teamKey of input.roster) {
    const published = input.totalByTeam.get(teamKey);
    const hasPublished = published !== undefined && Number.isFinite(published);
    const unseen = input.unseenTotal !== undefined && Number.isFinite(input.unseenTotal) ? input.unseenTotal : undefined;
    const total = hasPublished ? published : unseen;
    const belief = input.sigmaByTeam.get(teamKey);
    let sigma: number | undefined = belief;
    let priorOnlySigma = false;
    if (belief === undefined && total !== undefined) {
      const prior = input.priorSigmaAtTalent(total);
      if (prior !== undefined && Number.isFinite(prior)) {
        sigma = prior;
        priorOnlySigma = true;
      }
    }
    out.set(teamKey, { total, sigma, unseenByAlgorithm: !hasPublished && total !== undefined, priorOnlySigma });
  }
  return out;
}

/**
 * The Sigma map a roster-scoped pricing closure (`makeRankingPointFiller`)
 * reads under the rookie rule: every roster team with a defined rookie-rule
 * Sigma, and nothing else. The filler only ever reads roster teams.
 */
export function candidateSigmaMap(ratings: ReadonlyMap<string, CandidateRosterRating>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [teamKey, rating] of ratings) if (rating.sigma !== undefined) map.set(teamKey, rating.sigma);
  return map;
}
