/**
 * The FIRST district point model's PLAYOFF component: the 2023-plus
 * eight-alliance double-elimination bracket, the placement-to-points table
 * it feeds, and the measured fallback for the handful of district events
 * that do not run an eight-alliance bracket at all.
 *
 * TWO CORRECTIONS THIS MODULE EXISTS TO CARRY, both measured against
 * `data/corpus.sqlite` while planning 10-01 (2026-09-25):
 *
 * 1. PLAYOFF POINTS ARE A FINAL-PLACEMENT TABLE, NOT A PER-ROUND EXIT
 *    TABLE. `10-RESEARCH.md` Code Example 5's routing topology is correct
 *    and is reproduced verbatim below, but its round-to-points annotation
 *    ("M12 loser OUT, 13 pts" and "M13 loser OUT, 13 pts") is wrong: it
 *    implies two alliances at 13 and two at 7. Across all 418 district-tier
 *    eight-alliance events in 2023 through 2026, 408 show the exact
 *    placement multiset {30, 20, 13, 7, 0, 0, 0, 0} — one alliance at each
 *    nonzero value and four at zero. The ten non-matching events are all
 *    explained: seven have an alliance whose every pick is a non-district
 *    team absent from `district_rankings`, and three (`2026njtab`,
 *    `2026mawor`, `2026waahs`) carry a backup robot whose proration puts a
 *    partial value in a pick slot. The correct mapping is by final
 *    placement: first 30, second 20, third 13, fourth 7, fifth through
 *    eighth 0.
 *
 * 2. THE NON-EIGHT-ALLIANCE POPULATION IS EXCLUSIVELY THE DIVISIONED
 *    DISTRICT CHAMPIONSHIP PARENT EVENT. Every regular district event since
 *    2023 uses the eight-alliance bracket, without exception. Grouping
 *    `event_alliances` over every 2023-plus event with a non-null
 *    `events.district_key` yields exactly three alliance counts: 8 (491
 *    events), 4 (`micmp`, one per season) and 2 (`necmp`/`oncmp`/`txcmp`,
 *    three per season) — 16 parent events in total, every one an
 *    `event_type = 2` championship with divisions. `10-RESEARCH.md`'s
 *    hypothesis of "4- or 6-alliance district events with a shorter
 *    bracket" was wrong about the cause. A parent's own playoff points come
 *    from a different table than the eight-alliance one: the raw values
 *    observed are 0, 30 and 60, which at the 3x DCMP weight is base 0, 10
 *    and 20 — values absent from the eight-alliance set. That is exactly
 *    why a fabricated bracket for these events would be wrong and why
 *    `10-CONTEXT.md` calls for a measured table.
 *
 * PROVEN, not asserted: routing every complete 2023-plus eight-alliance
 * district bracket in the corpus from its REAL match results and mapping
 * placement to points reproduces TBA's own reported `elim_points` exactly —
 * 491 events (111 / 115 / 121 / 144 by season), 10,547 team-level values,
 * zero mismatches, measured 2026-10-09 (quick task 261009-tx8). No complete
 * bracket is left unresolved: the thirteen that a tied match used to strand
 * route through `bracketDecisionsFromPlayedMatches`, which numbers a set's
 * decided rows in order so a tie's replay decides the set.
 *
 * ONE TOPOLOGY, TWO CALLERS. `routeBracket` takes a decider callback, so
 * `pointFormulas.reconciliation.test.ts` can route real `matches` rows
 * through exactly the same table that 10-04's Monte Carlo decider will
 * route simulated outcomes through. There is deliberately no second routing
 * path for either caller: the corpus test proves the exact code the
 * browser runs.
 *
 * A browser-safe leaf module: its only imports are the `./pointModel.js`
 * and `./qualPoints.js` siblings, so no DOM and no Node built-in enters its
 * graph.
 */
import { maxEventPoints, type DistrictTier } from "./pointModel.js";
import { districtTierWeight } from "./qualPoints.js";

// ---------------------------------------------------------------------------
// The eight-alliance bracket
// ---------------------------------------------------------------------------

/** Where one side of a bracket set comes from: a seed, or a prior set's winner or loser. */
export type BracketFeed =
  | { readonly kind: "seed"; readonly seed: number }
  | { readonly kind: "winner"; readonly setId: string }
  | { readonly kind: "loser"; readonly setId: string };

/** One set of the bracket: its two feeds and how many matches decide it. */
export interface BracketSet {
  readonly id: string;
  readonly feedA: BracketFeed;
  readonly feedB: BracketFeed;
  /** 1 for every `sf` set; 3 for the final, which is a best-of-three series. */
  readonly bestOf: number;
}

/**
 * Decides one match. Returns the WINNING alliance number, which must be one
 * of the two it was handed — `routeBracket` rejects anything else rather
 * than coercing it, because a wrong answer here silently corrupts the
 * placement of every downstream set.
 *
 * `setId` and `matchNumber` are passed so a decider can price a specific
 * match (10-04 prices from alliance means and variances) or look one up
 * (the reconciliation test reads the real `matches` row for the set).
 */
export type BracketDecider = (allianceA: number, allianceB: number, setId: string, matchNumber: number) => number;

/** What one routed bracket produced. */
export interface BracketResult {
  /** Alliance number -> final placement, 1 through 8. Always a bijection. */
  readonly placementByAlliance: ReadonlyMap<number, number>;
  readonly winnerBySet: ReadonlyMap<string, number>;
  readonly loserBySet: ReadonlyMap<string, number>;
}

function seed(n: number): BracketFeed {
  return { kind: "seed", seed: n };
}
function winnerOf(setId: string): BracketFeed {
  return { kind: "winner", setId };
}
function loserOf(setId: string): BracketFeed {
  return { kind: "loser", setId };
}

/**
 * The 2023-plus eight-alliance double-elimination topology, in TBA's own
 * `set_number` order for `comp_level = 'sf'` (1 through 13) and then the
 * final. Reconstructed from real `matches` rows cross-referenced against
 * `event_alliances.picks` at two independent events (`2025flta`,
 * `2026casnv`) in `10-RESEARCH.md` and re-proved here against every
 * complete 2023-plus district bracket in the corpus.
 *
 * THIS IS THE ONLY TOPOLOGY TABLE IN PHASE 10. Both deciders route through
 * it.
 */
export const BRACKET_SETS: readonly BracketSet[] = [
  // Upper round 1.
  { id: "sf1", feedA: seed(1), feedB: seed(8), bestOf: 1 },
  { id: "sf2", feedA: seed(4), feedB: seed(5), bestOf: 1 },
  { id: "sf3", feedA: seed(2), feedB: seed(7), bestOf: 1 },
  { id: "sf4", feedA: seed(3), feedB: seed(6), bestOf: 1 },
  // Lower round 1 — the loser is eliminated at 0-2.
  { id: "sf5", feedA: loserOf("sf1"), feedB: loserOf("sf2"), bestOf: 1 },
  { id: "sf6", feedA: loserOf("sf3"), feedB: loserOf("sf4"), bestOf: 1 },
  // Upper round 2.
  { id: "sf7", feedA: winnerOf("sf1"), feedB: winnerOf("sf2"), bestOf: 1 },
  { id: "sf8", feedA: winnerOf("sf3"), feedB: winnerOf("sf4"), bestOf: 1 },
  // Lower round 2.
  { id: "sf9", feedA: loserOf("sf7"), feedB: winnerOf("sf6"), bestOf: 1 },
  { id: "sf10", feedA: loserOf("sf8"), feedB: winnerOf("sf5"), bestOf: 1 },
  // Upper final.
  { id: "sf11", feedA: winnerOf("sf7"), feedB: winnerOf("sf8"), bestOf: 1 },
  // Lower round 3.
  { id: "sf12", feedA: winnerOf("sf9"), feedB: winnerOf("sf10"), bestOf: 1 },
  // Lower final.
  { id: "sf13", feedA: loserOf("sf11"), feedB: winnerOf("sf12"), bestOf: 1 },
  // The final, best of three.
  { id: "f", feedA: winnerOf("sf11"), feedB: winnerOf("sf13"), bestOf: 3 },
];

/**
 * FIRST's own five playoff rounds over the `sf` sets of `BRACKET_SETS`, in
 * play order. The final (`f`) is not a round here: it is the Finals stop, the
 * old Playoffs stop renamed, and keeps that stop's own fact.
 *
 * DECLARED, NOT DERIVED from the feeds' depth. sf11 (the upper final) is fed by
 * two Round 2 winners, so a depth count would put it in Round 3, yet FIRST
 * plays it in Round 4 alongside sf12. The round names are FIRST's schedule, not
 * a property of the topology, so they are written down here and
 * `bracket.test.ts` proves every set's feeds come from strictly earlier rounds.
 *
 * What each round locks, read off the 30/20/13/7/0 placement table:
 *
 *   Round 1 (sf1 to sf4)    moves no lock; it only reprices the bracket.
 *   Round 2 (sf5 to sf8)    the sf5 and sf6 losers lock at 0; the sf7 and sf8
 *                           winners floor at 13.
 *   Round 3 (sf9, sf10)     the sf9 and sf10 losers lock at 0; their winners
 *                           floor at 7.
 *   Round 4 (sf11, sf12)    the sf12 loser locks at 7; the sf11 winner floors
 *                           at 20 and the sf12 winner at 13.
 *   Round 5 (sf13)          the sf13 loser locks at 13; its winner floors at 20.
 *   Finals (f)              30 and 20 lock.
 */
export const BRACKET_ROUNDS: readonly (readonly string[])[] = [
  ["sf1", "sf2", "sf3", "sf4"],
  ["sf5", "sf6", "sf7", "sf8"],
  ["sf9", "sf10"],
  ["sf11", "sf12"],
  ["sf13"],
];

const ROUND_BY_SET_ID: ReadonlyMap<string, number> = new Map(
  BRACKET_ROUNDS.flatMap((setIds, index) => setIds.map((setId) => [setId, index + 1] as const))
);

/**
 * The 1-based FIRST round a set id is played in, or `undefined` for the final
 * (`f`, which is the Finals stop rather than a round) and for any id this
 * topology does not carry.
 */
export function bracketRoundOfSet(setId: string): number | undefined {
  return ROUND_BY_SET_ID.get(setId);
}

/**
 * Which set's loser takes each placement from third downward. First and
 * second come from the final itself. Derived from the routing rather than
 * declared alongside it, so a topology change cannot leave a stale
 * placement map behind.
 *
 * Fifth through eighth all pay zero, so their relative order carries no
 * point consequence — what matters, and what the unit tests assert, is that
 * the eight placements are a bijection onto the eight alliance numbers.
 */
const PLACEMENT_FROM_LOSER_OF: readonly string[] = ["sf13", "sf12", "sf9", "sf10", "sf5", "sf6"];

/** Thrown when a decider returns an alliance number that was not one of the two it was asked about. */
export class InvalidBracketDecisionError extends Error {
  constructor(message: string) {
    super(`routeBracket: ${message}`);
    this.name = "InvalidBracketDecisionError";
  }
}

/** Thrown by `playoffPoints` for a placement outside 1 through 8. */
export class InvalidPlacementError extends Error {
  constructor(placement: number) {
    super(`bracket: placement must be an integer 1 through 8, got ${placement}`);
    this.name = "InvalidPlacementError";
  }
}

/**
 * Thrown for a season this module does not carry a bracket for. Mirrors
 * `UnknownDistrictSeasonError`'s refuse-to-guess shape: the 2023-plus
 * double-elimination format is not what 2016-2022 played, and routing this
 * topology over an earlier season would produce a confident wrong answer.
 */
export class UnsupportedBracketSeasonError extends Error {
  constructor(season: number) {
    super(
      `bracket: no playoff bracket declared for season ${season} (registered: ${BRACKET_REGISTERED_SEASONS.join(", ")}) — the 2023-plus eight-alliance double-elimination format does not describe earlier seasons`
    );
    this.name = "UnsupportedBracketSeasonError";
  }
}

/** Thrown for an alliance count, or an alliance number within a count, the measured fallback table has no population for. */
export class UnsupportedAllianceCountError extends Error {
  constructor(message: string) {
    super(`bracket: ${message}`);
    this.name = "UnsupportedAllianceCountError";
  }
}

/** The seasons this module's bracket describes. 2023 is when the double-elimination format arrived. */
export const BRACKET_REGISTERED_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

/** Throws `UnsupportedBracketSeasonError` unless `season` is one this module carries a bracket for. */
export function assertBracketSeason(season: number): void {
  if (!BRACKET_REGISTERED_SEASONS.includes(season)) throw new UnsupportedBracketSeasonError(season);
}

/**
 * Routes the eight-alliance bracket, asking `decide` for every match, and
 * returns a final placement for each of the eight alliance numbers.
 *
 * The final is resolved by calling `decide` per match until one alliance
 * has two wins, so a swept series costs two calls rather than three.
 */
export function routeBracket(decide: BracketDecider): BracketResult {
  const winnerBySet = new Map<string, number>();
  const loserBySet = new Map<string, number>();

  function resolveFeed(feed: BracketFeed, setId: string): number {
    if (feed.kind === "seed") return feed.seed;
    const source = feed.kind === "winner" ? winnerBySet : loserBySet;
    const alliance = source.get(feed.setId);
    if (alliance === undefined) {
      throw new InvalidBracketDecisionError(
        `set ${setId} feeds from the ${feed.kind} of ${feed.setId}, which has not been decided yet — BRACKET_SETS is out of dependency order`
      );
    }
    return alliance;
  }

  for (const set of BRACKET_SETS) {
    const allianceA = resolveFeed(set.feedA, set.id);
    const allianceB = resolveFeed(set.feedB, set.id);
    const winsNeeded = Math.floor(set.bestOf / 2) + 1;
    let winsA = 0;
    let winsB = 0;

    for (let matchNumber = 1; matchNumber <= set.bestOf; matchNumber++) {
      const winner = decide(allianceA, allianceB, set.id, matchNumber);
      if (winner !== allianceA && winner !== allianceB) {
        throw new InvalidBracketDecisionError(
          `decider returned alliance ${winner} for set ${set.id} match ${matchNumber}, which is neither ${allianceA} nor ${allianceB}`
        );
      }
      if (winner === allianceA) winsA++;
      else winsB++;
      if (winsA === winsNeeded || winsB === winsNeeded) break;
    }

    const setWinner = winsA > winsB ? allianceA : allianceB;
    winnerBySet.set(set.id, setWinner);
    loserBySet.set(set.id, setWinner === allianceA ? allianceB : allianceA);
  }

  const placementByAlliance = new Map<number, number>();
  placementByAlliance.set(winnerBySet.get("f")!, 1);
  placementByAlliance.set(loserBySet.get("f")!, 2);
  PLACEMENT_FROM_LOSER_OF.forEach((setId, index) => {
    placementByAlliance.set(loserBySet.get(setId)!, index + 3);
  });

  return { placementByAlliance, winnerBySet, loserBySet };
}

/**
 * The base (regular district event, unweighted) playoff points by final
 * placement, indexed `placement - 1`. Correction 1 in this file's header is
 * the whole story of this array.
 */
export const PLAYOFF_PLACEMENT_POINTS: readonly number[] = [30, 20, 13, 7, 0, 0, 0, 0];

/**
 * Playoff points for an alliance that finished `placement` at a `tier`
 * event in `season`. The DCMP weight comes from `districtTierWeight` in
 * `./qualPoints.js`, phase 10's single weight source.
 */
export function playoffPoints(season: number, tier: DistrictTier, placement: number): number {
  assertBracketSeason(season);
  if (!Number.isInteger(placement) || placement < 1 || placement > PLAYOFF_PLACEMENT_POINTS.length) {
    throw new InvalidPlacementError(placement);
  }
  const value = PLAYOFF_PLACEMENT_POINTS[placement - 1]! * districtTierWeight(season, tier);
  const ceiling = maxEventPoints(season, tier).elim;
  if (value > ceiling) {
    throw new InvalidPlacementError(placement);
  }
  return value;
}

/**
 * The MOST a final placement can pay (base, regular district event,
 * unweighted), indexed `placement - 1`. Quick task 261009-2tr.
 *
 * The 2026 game manual, section 11.1.3, pays base points by placement (first
 * 20, second 20, third 13, fourth 7) PLUS 5 for each Finals match won in which
 * the team played, up to 10. So the winner reaches 30, and the manual's wording
 * would allow a losing finalist that won one Finals match 25, above
 * `PLAYOFF_PLACEMENT_POINTS`' 20.
 *
 * TBA DOES NOT PAY A LOSING FINALIST THAT 25. Measured 2026-10-09 in quick task
 * 261009-tx8 over the 491 routed eight alliance brackets of 2023 to 2026, and
 * held by `pointFormulas.reconciliation.test.ts`: every one of the 329 first
 * three picks of a losing finalist that won one Finals match is paid exactly
 * the base second place value (261 district tier rows at 20, 68 DCMP tier rows
 * at 60), and none is paid above it. TBA's district tier rows do show 25
 * thirteen times (4, 1, 4 and 4 by season), and all 13 are members of the
 * WINNING alliance that played in only one of its two Finals wins. No row sits
 * above these maxima; every other value off the table is a proration below
 * one.
 *
 * THE 25 (75 at a District Championship) IS KEPT, as a ceiling for the lock
 * math only. It is the safe side of the manual's wording: a ceiling that is
 * too high only delays a lock, and a ceiling that is too low could grant one
 * that fails.
 */
export const PLAYOFF_PLACEMENT_MAX_POINTS: readonly number[] = [30, 25, 13, 7, 0, 0, 0, 0];

/**
 * The most an alliance that finished `placement` at a `tier` event in `season`
 * can be paid: `PLAYOFF_PLACEMENT_MAX_POINTS` times the tier weight, behind
 * exactly `playoffPoints`' guards. This is the bound a guarantee needs (the
 * Champ Locks joint proof, and a decided placement's settled ceiling).
 * `playoffPoints` stays the measured placement multiset, which is what the
 * simulation draws and what a settled Playoffs cell prints.
 *
 * For second place the bound is 25 times the tier weight (75 at a District
 * Championship). That is what the manual's wording would allow a losing
 * finalist that won one Finals match, and not what TBA pays one: all 329
 * measured rows sit at the base value and the 13 rows at base 25 are on the
 * winning alliance (see `PLAYOFF_PLACEMENT_MAX_POINTS`, quick task
 * 261009-tx8). The bound is kept on the safe side, since a ceiling that is too
 * high only delays a lock.
 */
export function maxPlayoffPointsByPlacement(season: number, tier: DistrictTier, placement: number): number {
  assertBracketSeason(season);
  if (!Number.isInteger(placement) || placement < 1 || placement > PLAYOFF_PLACEMENT_MAX_POINTS.length) {
    throw new InvalidPlacementError(placement);
  }
  const value = PLAYOFF_PLACEMENT_MAX_POINTS[placement - 1]! * districtTierWeight(season, tier);
  const ceiling = maxEventPoints(season, tier).elim;
  if (value > ceiling) {
    throw new InvalidPlacementError(placement);
  }
  return value;
}

/**
 * The MOST a finals placement of a DIVISIONED District Championship can pay
 * (base, unweighted), by division count, indexed `placement - 1`. Quick task
 * 261009-kt3.
 *
 * The 2026 game manual, section 11.1.3: "Each team on a Champion Alliance of a
 * 2-Division District Championship Playoff tournament earns 10 points", and
 * "For a 4-Division District Championship Playoff tournament, each team on a
 * Champion Alliance earns 20 points and each team on a Finalist Alliance
 * receives 10 points". Points earned at a District Championship are multiplied
 * by 3, and a backup robot is prorated, which only lowers a value. Measured
 * 2023 to 2026 (`data/local-publish/districts`): the finals rows pay exactly 60
 * and 30 at FIM and exactly 30 at NE, ON and TX, a semifinal loser and a two
 * division finalist 0, and a 2026 NE finalist that won a Finals match was paid
 * 0, so the finals pay by placement only, with no per match bonus.
 */
export const FINALS_PLACEMENT_MAX_POINTS: Readonly<Record<2 | 4, readonly number[]>> = {
  2: [10, 0],
  4: [20, 10, 0, 0],
};

/**
 * The most a team on the alliance that finished `placement` in the finals of a
 * `divisions` division District Championship in `season` can be paid:
 * `FINALS_PLACEMENT_MAX_POINTS` times the DCMP tier weight, behind
 * `assertBracketSeason`, a typed error for a division count other than 2 or 4
 * or a placement outside 1 to `divisions`, and the DCMP Playoffs ceiling.
 */
export function maxFinalsPointsByPlacement(season: number, divisions: number, placement: number): number {
  assertBracketSeason(season);
  if (divisions !== 2 && divisions !== 4) {
    throw new UnsupportedAllianceCountError(`a divisioned District Championship's finals has 2 or 4 alliances, got ${String(divisions)}`);
  }
  const table = FINALS_PLACEMENT_MAX_POINTS[divisions];
  if (!Number.isInteger(placement) || placement < 1 || placement > table.length) {
    throw new InvalidPlacementError(placement);
  }
  const value = table[placement - 1]! * districtTierWeight(season, "dcmp");
  if (value > maxEventPoints(season, "dcmp").elim) {
    throw new InvalidPlacementError(placement);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The non-eight-alliance fallback: divisioned district championship parents
// ---------------------------------------------------------------------------

/** One measured observation: a base point value and how many times it was seen at that alliance number. */
export interface DivisionedDcmpObservation {
  readonly points: number;
  readonly count: number;
}

/** One entry of a normalized playoff-points pmf. */
export interface PlayoffPointsPmfEntry {
  readonly points: number;
  readonly probability: number;
}

interface DivisionedDcmpTable<T> {
  readonly 2: Readonly<Record<number, readonly T[]>>;
  readonly 4: Readonly<Record<number, readonly T[]>>;
}

/**
 * THE MEASURED TABLE, NOT AN INVENTED ONE. Every count below was read from
 * `data/corpus.sqlite` and is re-derived and asserted equal by
 * `pointFormulas.reconciliation.test.ts` on every run that has the corpus.
 *
 * Population: the 16 divisioned district championship parent events of
 * 2023 through 2026 — `micmp` (four alliances) and `necmp`/`oncmp`/`txcmp`
 * (two alliances each), one set per season. For each alliance, the base
 * point value is that alliance's `elim_points` from `district_rankings`
 * divided by the season's DCMP weight, agreed across every one of its
 * picks that has an entry. Seven alliances across the 16 events resolve to
 * no entry at all (every pick absent from `district_rankings`) and are
 * excluded; zero alliances showed a prorated disagreement.
 *
 * Counts, not probabilities, are what is committed: a count is an exact
 * integer that the test can reproduce bit for bit, while 1/3 has no exact
 * decimal literal. `DIVISIONED_DCMP_PLAYOFF_PMF` normalizes them once at
 * module load.
 *
 * THE SAMPLE IS SMALL — ten observations per two-alliance seed, three or
 * four per four-alliance seed. It is the entire population that exists, so
 * it is the honest answer; it is not a large one. Where a cell has no
 * observation at all, `divisionedDcmpPlayoffPmf` throws rather than
 * smoothing a guess.
 */
export const DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS: DivisionedDcmpTable<DivisionedDcmpObservation> = {
  2: {
    1: [
      { points: 0, count: 3 },
      { points: 10, count: 7 },
    ],
    2: [
      { points: 0, count: 5 },
      { points: 10, count: 5 },
    ],
  },
  4: {
    1: [
      { points: 0, count: 1 },
      { points: 10, count: 1 },
      { points: 20, count: 1 },
    ],
    2: [
      { points: 10, count: 1 },
      { points: 20, count: 2 },
    ],
    3: [
      { points: 0, count: 2 },
      { points: 20, count: 1 },
    ],
    4: [
      { points: 0, count: 2 },
      { points: 10, count: 2 },
    ],
  },
};

function normalize(
  byNumber: Readonly<Record<number, readonly DivisionedDcmpObservation[]>>
): Readonly<Record<number, readonly PlayoffPointsPmfEntry[]>> {
  const out: Record<number, readonly PlayoffPointsPmfEntry[]> = {};
  for (const [allianceNumber, observations] of Object.entries(byNumber)) {
    const total = observations.reduce((sum, observation) => sum + observation.count, 0);
    out[Number(allianceNumber)] = observations.map((observation) => ({
      points: observation.points,
      probability: observation.count / total,
    }));
  }
  return out;
}

/** `DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS` normalized to probabilities, computed once at module load. */
export const DIVISIONED_DCMP_PLAYOFF_PMF: DivisionedDcmpTable<PlayoffPointsPmfEntry> = {
  2: normalize(DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS[2]),
  4: normalize(DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS[4]),
};

/**
 * The measured playoff-points pmf for an alliance at a divisioned district
 * championship parent, which is the only kind of 2023-plus district event
 * that does not run the eight-alliance bracket.
 *
 * An alliance count of 8 throws: eight alliances ROUTE through
 * `routeBracket`, they never read this table. Any other unregistered count,
 * or an alliance number with no measured population, throws too — the
 * alternative is a fabricated bracket or a smoothed guess, and
 * `10-CONTEXT.md` rules both out.
 */
export function divisionedDcmpPlayoffPmf(allianceCount: number, allianceNumber: number): readonly PlayoffPointsPmfEntry[] {
  if (allianceCount !== 2 && allianceCount !== 4) {
    throw new UnsupportedAllianceCountError(
      allianceCount === 8
        ? "an eight-alliance event routes through routeBracket and never reads the divisioned-dcmp fallback table"
        : `no measured playoff-points population for an alliance count of ${allianceCount} (registered: 2, 4)`
    );
  }
  const pmf = DIVISIONED_DCMP_PLAYOFF_PMF[allianceCount][allianceNumber];
  if (pmf === undefined) {
    throw new UnsupportedAllianceCountError(
      `no measured playoff-points population for alliance ${allianceNumber} at a ${allianceCount}-alliance event — refusing to smooth a guess for an unobserved cell`
    );
  }
  return pmf;
}

// ---------------------------------------------------------------------------
// WHAT THE PLAYED MATCHES ALONE DETERMINE, and the per-alliance milestone that
// follows from it (quick task 260925-uf8)
// ---------------------------------------------------------------------------

/** The eight-alliance field this module's milestones are declared over — the same count `BRACKET_SETS`' seeds span. */
const BRACKET_ALLIANCE_FIELD = 8;

/**
 * One elimination match that has ALREADY BEEN PLAYED, in TBA's own match
 * coordinates plus the alliance number that won it.
 *
 * TBA's coordinates rather than this module's set id, because the caller reads
 * TBA's own published rows and a caller-side translation would be a second
 * mapping. `bracketSetIdFor` below is the only one.
 *
 * `winningAllianceNumber` is an ALLIANCE NUMBER, never "red" or "blue": which
 * colour an alliance wore is a property of the match and carries no bracket
 * meaning, and resolving a colour to an alliance needs the event's own pick
 * lists, which are the CALLER's data and not this leaf's.
 */
export interface PlayedBracketMatch {
  /** TBA's `comp_level`. Anything other than `sf` or `f` is not part of this topology and is ignored. */
  readonly compLevel: string;
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly winningAllianceNumber: number;
}

/** Every set id in `BRACKET_SETS`, derived from the table so the two cannot disagree. */
const BRACKET_SET_IDS: ReadonlySet<string> = new Set(BRACKET_SETS.map((set) => set.id));

/**
 * TBA's `(comp_level, set_number)` onto this topology's own set id, or
 * `undefined` for a row this bracket does not carry.
 *
 * The mapping is TBA's own numbering and nothing more: `sf` sets 1 through 13
 * are `sf1` through `sf13` — the order `BRACKET_SETS` is declared in, which is
 * that table's own stated contract — and `f` set 1 is the best-of-three final.
 * A `qf` or `ef` row, or an `sf` set number outside the thirteen, belongs to a
 * format this topology does not describe and returns `undefined` rather than
 * being coerced into a neighbouring set.
 */
export function bracketSetIdFor(compLevel: string, setNumber: number): string | undefined {
  if (compLevel === "sf") {
    const id = `sf${String(setNumber)}`;
    return BRACKET_SET_IDS.has(id) ? id : undefined;
  }
  if (compLevel === "f") return setNumber === 1 ? "f" : undefined;
  return undefined;
}

/**
 * The key one played decision is stored under: the set id and the WITHIN-SET
 * match number, which is what `routeBracket` passes its decider. A set id alone
 * would collapse the final's three matches into one.
 */
export function bracketDecisionKey(setId: string, matchNumber: number): string {
  return `${setId}:${String(matchNumber)}`;
}

/**
 * The played rows as the decision map `routePlayedBracket`, the draw-loop
 * decider and the corpus reconciliation all read.
 *
 * THREE STEPS, in this order:
 *
 * 1. A row this topology does not carry is DROPPED rather than guessed at.
 * 2. A later row for the same ORIGINAL pair of set id and match number wins,
 *    because TBA republishes a corrected match under its own key.
 * 3. PER SET, the surviving rows are ordered by their original match number
 *    and stored under `bracketDecisionKey(setId, n)` with n running 1 upward
 *    (quick task 261009-tx8, B4). So the map's match number is the ORDINAL
 *    AMONG THE SET'S DECIDED ROWS, which is exactly what `routeBracket` passes
 *    its decider and what `routePlayedBracket` asks for, and the map never has
 *    a gap inside a set.
 *
 * WHY STEP 3. A tied playoff match is replayed under the NEXT match number, and
 * the caller hands over no row for a tie (a tie has no winning alliance). Keyed
 * by the original number, the tie left a gap and the set was never decided.
 * Measured over `data/corpus.sqlite`, eight alliance district points events of
 * 2023 to 2026: 12 finals and one semifinal (`2023ncash` sf12, tie then
 * alliance 2) carry a tie, and a final runs to as many as four matches
 * (`2023mabri`: tie, then 3, 2, 3).
 *
 * WHY IT IS SOUND. A row is a real result. In a best of three a side with two
 * real wins has won the set whatever was tied in between, and in a single match
 * set the first real result is the result. A set with too few decided rows
 * stays open exactly as before: one decided row and a later tie is one
 * decision, not two.
 */
export function bracketDecisionsFromPlayedMatches(matches: readonly PlayedBracketMatch[]): ReadonlyMap<string, number> {
  // Set id -> original match number -> winner. The inner `set` is the "later
  // row wins" rule, applied BEFORE any numbering.
  const decidedBySet = new Map<string, Map<number, number>>();
  for (const match of matches) {
    const setId = bracketSetIdFor(match.compLevel, match.setNumber);
    if (setId === undefined) continue;
    let decided = decidedBySet.get(setId);
    if (decided === undefined) {
      decided = new Map<number, number>();
      decidedBySet.set(setId, decided);
    }
    decided.set(match.matchNumber, match.winningAllianceNumber);
  }
  const decisions = new Map<string, number>();
  for (const [setId, decided] of decidedBySet) {
    const originalNumbers = [...decided.keys()].sort((x, y) => x - y);
    originalNumbers.forEach((originalNumber, index) => {
      decisions.set(bracketDecisionKey(setId, index + 1), decided.get(originalNumber)!);
    });
  }
  return decisions;
}

/**
 * A PARTIALLY routed bracket: exactly what the played matches determine, and
 * nothing beyond it.
 *
 * Deliberately NOT a `BracketResult`: that type's `placementByAlliance` is
 * always a bijection onto all eight alliances, which a half-played bracket
 * cannot honestly produce. A set absent from every map here is a set whose
 * outcome is genuinely still open.
 */
export interface PartialBracketRouting {
  readonly winnerBySet: ReadonlyMap<string, number>;
  readonly loserBySet: ReadonlyMap<string, number>;
  /** Set id -> its two alliance numbers, for every set whose feeds are BOTH resolved — including a set that has not been played yet. */
  readonly participantsBySet: ReadonlyMap<string, readonly [number, number]>;
  /** Alliance number -> final placement, for the alliances whose placement the played matches already fix. Never padded. */
  readonly placementByAlliance: ReadonlyMap<number, number>;
}

/**
 * Routes as much of the eight-alliance bracket as the PLAYED matches decide.
 *
 * Walks `BRACKET_SETS` in its declared dependency order — the same table
 * `routeBracket` walks, because a second topology here is exactly the drift
 * this file's header forbids. A set whose feeds are not both resolved is
 * skipped, and so is everything downstream of it, by construction.
 *
 * REFUSES rather than coerces, on the same terms as `routeBracket`: a decision
 * naming an alliance that is not one of the set's two participants raises
 * `InvalidBracketDecisionError`. That is a mis-mapped match, and a mis-mapped
 * match silently rewrites the placement of every set below it.
 */
export function routePlayedBracket(decisions: ReadonlyMap<string, number>): PartialBracketRouting {
  const winnerBySet = new Map<string, number>();
  const loserBySet = new Map<string, number>();
  const participantsBySet = new Map<string, readonly [number, number]>();

  const resolveFeed = (feed: BracketFeed): number | undefined => {
    if (feed.kind === "seed") return feed.seed;
    return (feed.kind === "winner" ? winnerBySet : loserBySet).get(feed.setId);
  };

  for (const set of BRACKET_SETS) {
    const allianceA = resolveFeed(set.feedA);
    const allianceB = resolveFeed(set.feedB);
    if (allianceA === undefined || allianceB === undefined) continue;
    participantsBySet.set(set.id, [allianceA, allianceB]);

    const winsNeeded = Math.floor(set.bestOf / 2) + 1;
    let winsA = 0;
    let winsB = 0;
    for (let matchNumber = 1; matchNumber <= set.bestOf; matchNumber++) {
      const winner = decisions.get(bracketDecisionKey(set.id, matchNumber));
      // A GAP ENDS THE SET rather than being skipped past: match 3 of a final
      // cannot be read while match 2 is missing, because whether match 3 was
      // played at all depends on match 2's result. A map built from played
      // rows by `bracketDecisionsFromPlayedMatches` carries no gap (it numbers
      // a set's decided rows 1 to n), so this rule now guards a hand built map
      // only; in a built map the first missing number is simply the end of
      // what was played.
      if (winner === undefined) break;
      if (winner !== allianceA && winner !== allianceB) {
        throw new InvalidBracketDecisionError(
          `played match ${bracketDecisionKey(set.id, matchNumber)} names alliance ${String(winner)} as the winner, which is neither ${String(allianceA)} nor ${String(allianceB)} — refusing to route a mis-mapped match`
        );
      }
      if (winner === allianceA) winsA++;
      else winsB++;
      if (winsA === winsNeeded || winsB === winsNeeded) break;
    }
    if (winsA < winsNeeded && winsB < winsNeeded) continue;
    const setWinner = winsA > winsB ? allianceA : allianceB;
    winnerBySet.set(set.id, setWinner);
    loserBySet.set(set.id, setWinner === allianceA ? allianceB : allianceA);
  }

  const placementByAlliance = new Map<number, number>();
  const finalWinner = winnerBySet.get("f");
  if (finalWinner !== undefined) {
    placementByAlliance.set(finalWinner, 1);
    placementByAlliance.set(loserBySet.get("f")!, 2);
  }
  // The SAME placement table `routeBracket` reads, so a placement fixed here
  // and the same placement drawn there can never disagree.
  PLACEMENT_FROM_LOSER_OF.forEach((setId, index) => {
    const loser = loserBySet.get(setId);
    if (loser !== undefined) placementByAlliance.set(loser, index + 3);
  });

  return { winnerBySet, loserBySet, participantsBySet, placementByAlliance };
}

/**
 * How far one alliance has got, in the four words the Playoffs cell prints.
 *
 *   `alive`    — still in the bracket, a top-four finish not yet secured.
 *   `topFour`  — it can no longer finish worse than fourth.
 *   `finals`   — it is in the final, so it is the winner or the finalist.
 *   `decided`  — its placement is already fixed by the matches played.
 */
export type AllianceBracketMilestone =
  | { readonly kind: "alive" }
  | { readonly kind: "topFour" }
  | { readonly kind: "finals" }
  | { readonly kind: "decided"; readonly placement: number };

/**
 * The sets whose WINNER can no longer finish worse than fourth.
 *
 * DERIVED FROM THE TOPOLOGY'S OWN SHAPE, and the argument is short enough to
 * state in full. The four placements that pay nothing are fifth through eighth,
 * and `PLACEMENT_FROM_LOSER_OF` says they are the losers of sf9, sf10, sf5 and
 * sf6 — so an alliance finishes outside the top four exactly when it loses one
 * of those four sets. Winning sf9 or sf10 sends an alliance to sf12, whose
 * loser is FOURTH; winning sf7 or sf8 sends it to sf11, whose loser drops to
 * sf13, whose loser is THIRD. Either way every remaining path ends at fourth or
 * better, which is what "secured" means here.
 *
 * A table rather than a chain of conditionals, so a topology change shows up as
 * a table that no longer matches — and `bracket.test.ts` re-derives the claim by
 * routing every completion of the bracket rather than taking it on trust.
 */
const TOP_FOUR_SECURED_BY_WINNING: readonly string[] = ["sf7", "sf8", "sf9", "sf10"];

/**
 * Each alliance's milestone, from a partial routing.
 *
 * Precedence is `decided` over `finals` over `topFour` over `alive`, because
 * each is strictly more informative than the next and a cell prints one line.
 * An alliance the routing has not reached at all is `alive`: before any
 * elimination match is played every alliance is alive and nothing is secured,
 * which is the honest reading and the one the Playoffs cell already printed.
 */
export function allianceBracketMilestones(routing: PartialBracketRouting): ReadonlyMap<number, AllianceBracketMilestone> {
  const milestones = new Map<number, AllianceBracketMilestone>();
  for (let allianceNumber = 1; allianceNumber <= BRACKET_ALLIANCE_FIELD; allianceNumber++) {
    milestones.set(allianceNumber, { kind: "alive" });
  }
  for (const setId of TOP_FOUR_SECURED_BY_WINNING) {
    const winner = routing.winnerBySet.get(setId);
    if (winner !== undefined) milestones.set(winner, { kind: "topFour" });
  }
  // The final's two participants are in the final whether or not it has started.
  const finalists = routing.participantsBySet.get("f");
  if (finalists !== undefined) {
    for (const allianceNumber of finalists) milestones.set(allianceNumber, { kind: "finals" });
  }
  for (const [allianceNumber, placement] of routing.placementByAlliance) {
    milestones.set(allianceNumber, { kind: "decided", placement });
  }
  return milestones;
}
