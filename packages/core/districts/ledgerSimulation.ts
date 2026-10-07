/**
 * THE JOINT DISTRICT LEDGER SIMULATION — one Monte Carlo run over ONE district
 * event that yields a CORRELATED (qualification, alliance selection, playoff,
 * award) quadruple for every team on every draw, plus that draw's event total.
 *
 * THIS MODULE OWNS NO FORMULA. Every number it produces comes from a module
 * that measured it:
 *   - qualification points    -> `districtQualPoints` (`./qualPoints.js`)
 *   - the DCMP weight         -> `districtTierWeight` (`./qualPoints.js`), the
 *                                phase's single weight source
 *   - selection points        -> `districtSelectionPoints` (`./selectionPoints.js`)
 *   - the bracket topology    -> `routeBracket` / `BRACKET_SETS` (`./bracket.js`)
 *   - placement points        -> `playoffPoints` (`./bracket.js`)
 *   - the non-eight fallback  -> `divisionedDcmpPlayoffPmf` (`./bracket.js`)
 *   - award point rates       -> `awardBaseRate` (`./awardBaseRates.js`)
 *   - the award orderings     -> `impactOrderingProbability` /
 *                                `rookieAllStarOrderingProbability` /
 *                                `awardResidualRate` / `orderFieldByImpactHistory`
 *                                / `orderFieldByDecoration`
 *                                (`./awardOrderingTables.js`)
 *   - the alliance win odds   -> `allianceWinProbability`
 *                                (`../algorithms/simulation/allianceWinProbability.js`)
 *   - the ranking itself      -> `simulateRanks`
 *                                (`../algorithms/simulation/rankSimulation.js`)
 *   - every point ceiling     -> `maxEventPoints` (`./pointModel.js`)
 * What lands HERE is the composition, which is where a plausible-but-wrong
 * number gets made. There is no second bracket, no second pricer, no second
 * weight, no second ceiling table and no numeric literal standing in for any
 * of them.
 *
 * TWO CALLERS, ONE IMPLEMENTATION: a browser Web Worker (10-07, every event in
 * progress and every slider move) and the offline publisher (10-06, the baked
 * pmfs for unstarted events). One implementation is what makes a published
 * baked pmf and a live browser run the same quantity rather than two numbers
 * that happen to look alike.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE JOINT DRAW
 * ---------------------------------------------------------------------------
 *
 * A team's qualification points, alliance-selection points and playoff points
 * are all functions of ONE simulated event's finishing order. They are
 * strongly coupled through it. `simulateRanks`'s returned `rankHistograms` are
 * aggregates and carry NO correlation whatsoever: nothing in them says "this
 * team finished first on the same draw that team finished eighth". Convolving
 * four independently-produced marginals therefore overstates the spread AND
 * puts mass on combinations the sport cannot produce — a team ranked 20th
 * holding a first pick's 16 points. There is no way to reconstruct the
 * correlation after the fact; it has to be produced inside the draw. That is
 * what `simulateRanks`'s `onDraw` hook exists for and what this module does
 * with it. `ledgerSimulation.test.ts`'s correlation proof asserts it PER DRAW,
 * because a comparison of marginals cannot detect a broken join.
 *
 * ---------------------------------------------------------------------------
 * CAPTAINS FOLLOW THE PROGRESSIVE RULE, MEASURED
 * ---------------------------------------------------------------------------
 *
 * Captains are NOT the top eight by qualification ranking. Measured against
 * every 2023-plus eight-alliance district event in `data/corpus.sqlite` while
 * planning 10-04: the captain set equals ranks 1 through 8 at only 3 of 491
 * events, and the worst captain's qualification rank is typically 12 or 13.
 * The reason is the real mechanic — a top seed accepted as a higher alliance's
 * FIRST PICK is removed from the captain pool, and the next-highest unallied
 * seed moves up into the vacated slot.
 *
 * The PROGRESSIVE rule — at alliance n's turn, the captain is the highest-
 * ranked team not yet allied — reproduces the real captain at 3,879 of 3,880
 * slots across 485 usable events, with 484 of 485 events perfect. The single
 * miss is `2026milac` alliance 8, where the rule expected `frc6087` (rank 13)
 * and the real captain was `frc7768` (rank 14) — one decline, one event.
 * `selectionModel.reconciliation.test.ts` is the proof and it scores the naive
 * top-eight rule beside it, so a future "simplify the walk into a slice" edit
 * turns the suite red rather than silently shipping the wrong rule.
 *
 * DECLINES ARE NOT MODELLED. That single miss is the measured size of the
 * resulting error: one captain slot in 3,880.
 *
 * ---------------------------------------------------------------------------
 * THE DRAFT ORDER IS SERPENTINE, AND IT WAS MEASURED
 * ---------------------------------------------------------------------------
 *
 * Round one runs alliance 1 through N; round two runs N back down to 1. The
 * evidence is a gradient, not the game manual: the mean qualification rank of
 * the real SECOND pick falls monotonically from 24.83 at alliance 1 to 20.10
 * at alliance 8 across all 491 events. Alliance 8's second pick is the
 * STRONGER one, which is only possible if alliance 8 picks first in round two.
 * A straight 1-through-N round two would run the gradient the other way.
 *
 * ---------------------------------------------------------------------------
 * SHORT ROSTERS: WHOLE FILLER ALLIANCES, MEASURED
 * ---------------------------------------------------------------------------
 *
 * An eight-alliance district event can have fewer than 24 real teams on its
 * qualification rows. The sport's own convention there is measured, not
 * assumed (quick task 261007-4qr, `data/corpus.sqlite`, 2026-10-07): every
 * 2023-plus district event under 24 real teams seats WHOLE real alliances at
 * the top seeds and WHOLE demo alliances at the bottom seeds. Five events
 * (2026txmca 18, 2026mefal 20, 2023gaalb 21, 2025ncash 22, 2024vapor 23) seat
 * `floor((N - 1) / 3)` real alliances, 5 of 5; no such event ever put a demo
 * robot beside a real one; and fully demo alliances played 19 playoff sets
 * against real alliances and won none, mostly scoring zero (forfeits).
 *
 * So a SIMULATED draft runs the progressive captain rule and the serpentine
 * order over alliances 1 to k (`draftedAllianceCount`), and the seeds after k
 * are FILLER alliances with no members. Real teams left over earn no selection
 * points, which is what the two or three unpicked real teams at those events
 * actually earned. A SUPPLIED pick that is off the roster and is a demo key is
 * filler too, and every real member keeps its own TBA slot.
 *
 * In the bracket a filler alliance FORFEITS: against a real alliance it loses
 * with no randomness consumed, and filler against filler goes to the lower
 * alliance number, also with none. That fabricates no rating and no number: a
 * forfeit is the measured outcome, and the filler-against-filler choice cannot
 * reach a real team's points, because a real alliance beats whichever filler
 * reaches it. Filler appears in no output map, no baseline and no award draw;
 * `fieldSize` and the qualification points use the real roster.
 *
 * LIMITATION: a MIXED alliance (real robots beside a demo key) is priced from
 * its real members only. It has never occurred at a district event.
 *
 * At 24 teams or more none of this applies: k is every alliance, the forfeit
 * branch is unreachable and every seeded output is unchanged, which the
 * pre-existing seeded pins in `ledgerSimulation.test.ts` prove unedited.
 *
 * ---------------------------------------------------------------------------
 * EVERY STAGE IS AN INPUT, NOT A BRANCH THAT GUESSES
 * ---------------------------------------------------------------------------
 *
 * Alliances announced, playoffs done and awards posted are each an OPTIONAL
 * input meaning "this stage's outcome is already known; simulate only what is
 * left". There is deliberately NO "quals known" flag: a finished qualification
 * stage is expressed by handing this function zero remaining matches, which
 * `simulateRanks` documents as a valid input in which every team keeps its
 * baseline average and ranks identically in every draw. A fifth flag would be
 * a second way to express one state, and two ways to express one state is how
 * the two drift apart. The near-certain captain floor CONTEXT calls for
 * therefore falls out of the same code path the fully-open case takes.
 *
 * A known stage's work is SKIPPED, not routed and discarded. Routing a bracket
 * whose result is then thrown away would consume the ledger stream and
 * silently change every subsequent draw, so the skip is a correctness
 * requirement rather than an optimisation — which is why the ledger stream's
 * consumed count is stage-dependent BY DESIGN and why the determinism tests
 * pin that count per stage rather than once.
 *
 * A SUPPLIED ALLIANCE SET IS VALIDATED, NOT TRUSTED. See
 * `InvalidAllianceSetError`.
 *
 * THE SLIDER'S REWIND NEEDS NO INPUT OF ITS OWN EITHER. Rewinding is the
 * CALLER handing back played rows as remaining, exactly as
 * `apps/web/src/lib/simulationInputs.ts` already does per event through
 * `findStartIndex` and `isRewindStart`. This module simulates every row it is
 * handed and owns no row-selection rule, mirroring `simulateRanks`'s own
 * stated division of responsibility. 10-07 builds the district assembly the
 * same way rather than inventing a second rewind concept.
 *
 * ---------------------------------------------------------------------------
 * THE NON-EIGHT-ALLIANCE FALLBACK, AND ITS SCOPE
 * ---------------------------------------------------------------------------
 *
 * Every regular district event since 2023 runs the eight-alliance bracket,
 * without exception. The only non-eight 2023-plus district rows are the
 * DIVISIONED DISTRICT CHAMPIONSHIP PARENTS — `micmp` at four alliances and
 * `necmp`/`oncmp`/`txcmp` at two, sixteen events in all. Their own playoff
 * points come from a different table than the eight-alliance one: base 0, 10
 * and 20, values absent from the eight-alliance set. That is exactly why a
 * fabricated bracket for these events would be wrong, and why this module
 * draws their elim points from `divisionedDcmpPlayoffPmf` and never calls
 * `routeBracket` for them. The DRAFT still runs over that many alliances —
 * round one 1 through N, round two N down to 1 — so the fallback pmf is keyed
 * by an alliance number the model actually assigned rather than a guess.
 *
 * The whole module is scoped to 2023 and later: `assertBracketSeason` runs in
 * the up-front validation, so an earlier season is refused rather than having
 * the 2023-plus topology routed over a format it did not use.
 *
 * ---------------------------------------------------------------------------
 * THE TIE CAVEAT — WHERE THIS MODULE CAN HONESTLY DISAGREE WITH A PUBLISHED
 * NUMBER, AND A NAMED HANDOFF TO 10-07
 * ---------------------------------------------------------------------------
 *
 * `simulateRanks`'s comparator breaks a tie on average ranking points by team
 * key, because TBA's own season-specific tiebreakers are discarded at ingest
 * and no data exists in this pipeline to back a real secondary ordering. For a
 * FINISHED event that means the qualification points DERIVED here can differ
 * from the value the team actually earned, for teams tied on average ranking
 * points. 10-07 must print the EARNED grey number for a finished event; this
 * module's output is for OPEN cells only.
 *
 * The second named handoff: 10-07 catches `UnratedTeamError` and renders that
 * event's open cells as unavailable. This module deliberately does not make
 * that decision — see that error's own doc comment.
 *
 * ---------------------------------------------------------------------------
 * BROWSER-SAFE LEAF
 * ---------------------------------------------------------------------------
 *
 * Every runtime import resolves to a sibling under `packages/core/`. No
 * `packages/harness`, no `apps/`, no `node:` built-in and no npm package.
 * Registered as an entry point in `packages/harness/browserSafeSchemas.test.ts`
 * so that is a machine-checked fact rather than a claim in a comment. Nothing
 * here imports `locks.ts`, computes a status or exports a verdict: a Locked
 * verdict stays a guarantee and no simulated number may reach it. That guard
 * is structural — read the import list.
 */
import {
  allianceWinProbability,
  type AllianceMemberRating,
} from "../algorithms/simulation/allianceWinProbability.js";
import {
  drawCategorical,
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimTeamBaseline,
} from "../algorithms/simulation/rankSimulation.js";
import {
  AWARD_POINT_SUPPORT,
  awardBaseRate,
  type AwardBaseRateSource,
  type DecorationBucket,
  type RookieState,
} from "./awardBaseRates.js";
import {
  awardResidualRate,
  foldStackedAwardPmf,
  foldStackedAwardPoints,
  hasAwardOrderingTables,
  IMPACT_AWARD_POINTS,
  impactOrderingProbability,
  orderFieldByDecoration,
  orderFieldByImpactHistory,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  rookieAllStarOrderingProbability,
} from "./awardOrderingTables.js";
import {
  allianceBracketMilestones,
  assertBracketSeason,
  bracketDecisionKey,
  bracketDecisionsFromPlayedMatches,
  divisionedDcmpPlayoffPmf,
  playoffPoints,
  routeBracket,
  routePlayedBracket,
  type AllianceBracketMilestone,
  type PlayedBracketMatch,
} from "./bracket.js";
import { isDemoTeamKey } from "../algorithms/demoTeams.js";
import { maxEventPoints, type DistrictTier } from "./pointModel.js";
import { districtQualPoints, districtTierWeight } from "./qualPoints.js";
import { districtSelectionPoints } from "./selectionPoints.js";

// ---------------------------------------------------------------------------
// The two random streams
// ---------------------------------------------------------------------------

/**
 * XORed into the caller's seed to build the LEDGER stage generator, which is a
 * second, independent `mulberry32` stream beside the rank simulation's own.
 *
 * THIS IS A REAL DECISION, NOT A DETAIL. `simulateRanks`'s `onDraw` hook runs
 * inside the draw loop; a hook drawing from the RANK stream would advance it
 * and change the rank histograms relative to an unhooked run under the same
 * seed. With two streams, this tab's qualification marginal reproduces the
 * event page's Simulation tab for the same seed EXACTLY, so a disagreement
 * between the two surfaces is a real bug rather than an artifact of two
 * interleaved consumers of one generator. `ledgerSimulation.test.ts`'s
 * non-perturbation pin — exact integer equality against a bare four-argument
 * `simulateRanks` run pushed through `districtQualPoints` — is what enforces
 * it.
 *
 * The two streams must never be interleaved into one. Changing this salt
 * changes every seeded output of this module.
 */
export const LEDGER_STREAM_SALT = 0x5d15_7c17;

// ---------------------------------------------------------------------------
// Input and output shapes
//
// BOTH CROSS A `postMessage` STRUCTURED-CLONE BOUNDARY in 10-07, so every
// field is a structured-cloneable value and NOTHING is a function, a class
// instance or a closure. A callback in the input shape would fail at runtime
// in the one place it matters — inside the Worker — and pass every test on the
// UI thread, which is the worst possible combination.
// ---------------------------------------------------------------------------

/**
 * One team's award-profile selector: the two keys `awardBaseRate` looks a rate
 * up by, plus the two raw counts `awardOrderingTables` orders a whole field on.
 *
 * `priorJudgedAwards` and `priorImpactWins` are OPTIONAL and their absence is
 * meaningful rather than a zero: every artifact published before a field
 * existed carries none, and a team treated as undecorated because its count
 * was missing would be sorted to the BOTTOM of its field and priced at the
 * tail. The rule is therefore all-or-nothing per event, for EACH count — see
 * `awardOrderingAssignments`. A field that carries `priorJudgedAwards` but not
 * `priorImpactWins` (an artifact published between 10-06 and 260929-imp)
 * cannot be put in the Impact ordering the committed tables were measured
 * under, and pricing it under the older one-number ordering against those
 * tables would misprice position 1.
 */
export interface DistrictAwardProfile {
  readonly bucket: DecorationBucket;
  readonly rookieState: RookieState;
  /** Judged awards won in seasons strictly before this event's own. Absent means this field cannot be ordered. */
  readonly priorJudgedAwards?: number;
  /** Impact wins in seasons strictly before this event's own, distinct on `(year, event)`. Absent means this field cannot be ordered. */
  readonly priorImpactWins?: number;
}

/**
 * THE ZERO AWARD PROFILE (Jacob, 2026-09-27, quick tasks 260927-6bf and
 * 260927-syh): a roster team with no profile at all counts as having NO
 * DECORATIONS. It is a veteran in the `none` bucket with no prior judged award,
 * so it sorts to the tail of any decoration ordering and is never eligible for
 * Rookie All Star.
 *
 * ONE CONSTANT FOR BOTH PRICERS. The browser's event input builder and the
 * publisher's bake both read this, so a baked sidecar and the browser's own
 * run price an unprofiled team the same way. Before it, one such team refused
 * its WHOLE EVENT in both places.
 *
 * It carries BOTH ordering counts at zero (`priorImpactWins` since 260929-imp),
 * so a zero-profile team never takes its whole field off the ordering path.
 *
 * A PUBLISHED profile that only lacks `priorJudgedAwards` or `priorImpactWins`
 * is NOT this case and still passes through unchanged; see
 * `DistrictAwardProfile` above.
 */
export const ZERO_AWARD_PROFILE: DistrictAwardProfile = Object.freeze({
  bucket: "none",
  rookieState: "veteran",
  priorJudgedAwards: 0,
  priorImpactWins: 0,
});

/**
 * Which award pricing one run used.
 *
 *   `"posted"`                — the awards are already known, so nothing was
 *                               drawn and no table was consulted at all.
 *   `"applied"`               — the ordering tables priced every team: Impact
 *                               from its position in the field's
 *                               Impact ordering, Rookie All Star from
 *                               its position among the rookies, and the rest
 *                               from the residual table.
 *   `"no-table"`              — the season has no ordering table, so the run
 *                               kept the `awardBaseRate` path unchanged.
 *   `"incomplete-profiles"`   — at least one roster team carries no
 *                               `priorJudgedAwards` or no `priorImpactWins`,
 *                               so the field cannot be ordered and the run
 *                               kept the base-rate path.
 *
 * THE LAST ONE IS ALL-OR-NOTHING BY DESIGN. A team with no count treated as
 * zero would sort to the BOTTOM of its field and be priced at the tail, which
 * is a confident, plausible-looking, wrong number — the same reason
 * `UnratedTeamError` refuses to price the teams it can and drop the rest. So
 * one missing count takes the WHOLE event back to the base rate, which is
 * exactly the price the artifact was published at before the ordering existed.
 */
export type AwardOrderingDisposition = "posted" | "applied" | "no-table" | "incomplete-profiles";

/**
 * One team's ordering-derived award parameters. A TEST SEAM AND A CONTRACT:
 * exported so `ledgerSimulation.test.ts` can assert that the most decorated
 * team's Impact chance IS the table's position-1 value, exactly, rather than
 * inferring it from a Monte Carlo frequency.
 */
export interface AwardOrderingAssignment {
  readonly teamKey: string;
  /** 1-based position in the whole field's Impact ordering (`orderFieldByImpactHistory`). */
  readonly impactPosition: number;
  /** 1-based position among the field's ROOKIES, or 0 for a team that is not one. */
  readonly rookieAllStarPosition: number;
  readonly impactProbability: number;
  /** 0 for a non-rookie — a veteran cannot win Rookie All Star, and no randomness is consumed for it. */
  readonly rookieAllStarProbability: number;
  /** The residual pmf over `AWARD_POINT_SUPPORT` this team's remaining judged awards are drawn from. */
  readonly residualPmf: readonly number[];
  /** Which rung of the residual table's fallback hierarchy this team's pmf came from. */
  readonly residualSource: AwardBaseRateSource;
}

/**
 * Every team's ordering-derived award parameters, or `undefined` when the
 * ordering does not apply to this event at all.
 *
 * `undefined` has exactly two causes and they are both stated in
 * `AwardOrderingDisposition`: no table for the season, or any roster team
 * missing `priorJudgedAwards` or `priorImpactWins`. The caller keeps the
 * base-rate path in both cases, and the result reports which one it was.
 *
 * The orderings themselves come from `orderFieldByImpactHistory` (Impact, the
 * whole field) and `orderFieldByDecoration` (Rookie All Star, the rookie
 * block), imported rather than restated, so the field the ledger prices is
 * ordered by the same rules the tables were measured under. A second
 * comparator here would be a second rule.
 */
export function awardOrderingAssignments(
  season: number,
  // Only `teamKey` is read, so the award field (roster plus award only teams,
  // quick task 260927-vmb) passes here as readily as a baseline list.
  baselines: readonly { readonly teamKey: string }[],
  awardProfiles: ReadonlyMap<string, DistrictAwardProfile>
): readonly AwardOrderingAssignment[] | undefined {
  if (!hasAwardOrderingTables(season)) return undefined;

  const entries: { teamKey: string; priorJudgedAwards: number; priorImpactWins: number }[] = [];
  for (const baseline of baselines) {
    const profile = awardProfiles.get(baseline.teamKey);
    // BOTH counts or neither: the committed Impact tables were measured under
    // the award-type-first ordering, and ordering a field without its Impact
    // counts would pair those tables with a different ordering.
    if (profile?.priorJudgedAwards === undefined || profile.priorImpactWins === undefined) return undefined;
    entries.push({
      teamKey: baseline.teamKey,
      priorJudgedAwards: profile.priorJudgedAwards,
      priorImpactWins: profile.priorImpactWins,
    });
  }

  const positionByTeam = new Map<string, number>();
  orderFieldByImpactHistory(entries).forEach((teamKey, index) => positionByTeam.set(teamKey, index + 1));

  // The rookie block is ranked on its OWN length. No tail of veterans is
  // invented below it, matching how the table was measured.
  const rookiePositionByTeam = new Map<string, number>();
  orderFieldByDecoration(
    entries.filter((entry) => awardProfiles.get(entry.teamKey)!.rookieState === "rookie")
  ).forEach((teamKey, index) => rookiePositionByTeam.set(teamKey, index + 1));

  return baselines.map((baseline) => {
    const profile = awardProfiles.get(baseline.teamKey)!;
    const impactPosition = positionByTeam.get(baseline.teamKey)!;
    const rookieAllStarPosition = rookiePositionByTeam.get(baseline.teamKey) ?? 0;
    const residual = awardResidualRate(season, profile.bucket, profile.rookieState);
    return {
      teamKey: baseline.teamKey,
      impactPosition,
      rookieAllStarPosition,
      impactProbability: impactOrderingProbability(season, impactPosition).p,
      rookieAllStarProbability:
        rookieAllStarPosition === 0 ? 0 : rookieAllStarOrderingProbability(season, rookieAllStarPosition).p,
      residualPmf: residual.pmf,
      residualSource: residual.source,
    };
  });
}

/**
 * One AWARD-ORDERING draw's point value, at BASE scale: the HIGHEST SINGLE
 * AWARD the draw produced, never a sum of two.
 *
 * REPLACES the shipped `composeOrderedAwardPoints`, which added the three
 * together. Impact and Rookie All Star are still drawn INDEPENDENTLY — a rookie
 * winning Impact is rare but not impossible, and refusing that pair would be a
 * rule the corpus does not support — so a draw genuinely can produce two awards
 * at once. What changed is what the site PREDICTS: Jacob's rule (2026-09-25) is
 * that two awards are never a predicted possibility, so the pair collapses onto
 * the better of the two rather than being priced as a 18-point outcome no cell
 * should invite a reader to plan around.
 *
 * The residual is folded too, by `foldStackedAwardPoints`, because the residual
 * table's own top bins are themselves stacks. There is therefore exactly one
 * fold rule and it lives in `awardOrderingTables.ts` beside the tables it is a
 * claim about.
 */
export function singleAwardPoints(impactWon: boolean, rookieAllStarWon: boolean, residualPoints: number): number {
  if (impactWon) return IMPACT_AWARD_POINTS;
  if (rookieAllStarWon) return ROOKIE_ALL_STAR_AWARD_POINTS;
  return foldStackedAwardPoints(residualPoints);
}

/**
 * One alliance as TBA reports it, for the stage where alliances are already
 * announced. `picks` is TBA's own `event_alliances.picks` array: index 0 is
 * the captain, 1 the first pick, 2 the second pick and 3 a backup robot where
 * one exists. A backup robot REPLACES a robot rather than adding one, so the
 * roster the bracket is priced from is the first three picks; the backup still
 * receives the alliance's placement points and its own slot-3 selection value
 * of zero.
 */
export interface SuppliedAlliance {
  readonly allianceNumber: number;
  readonly picks: readonly string[];
}

/** The per-event input to one joint district ledger run. */
export interface DistrictLedgerEventInput {
  readonly eventKey: string;
  readonly season: number;
  readonly tier: DistrictTier;
  /**
   * The OFFICIAL qualification field size the qualification formula divides
   * by — `event_rankings.total_teams`, passed explicitly rather than inferred
   * from `baselines.length`, because an event artifact's team count and TBA's
   * reported field size are two different facts that can legitimately differ
   * (a team that registered and never played appears in one and not the
   * other). The offline publisher (10-06) should pass
   * `event_rankings.total_teams`; the browser (10-07) should pass the event
   * artifact's own reported field size where it has one and its roster size
   * otherwise. Resolving a discrepancy between the two is the CALLER's
   * decision, not this module's — this module only rejects a field size
   * smaller than the roster it was handed, which cannot describe a real
   * ranking.
   */
  readonly fieldSize: number;
  readonly allianceCount: number;
  readonly remainingMatches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  /**
   * Team key -> the published SPR pair the bracket is priced from. The value
   * type is `allianceWinProbability`'s OWN roster-member input type, imported
   * rather than restated, so no second shape can drift from the pricer's.
   */
  readonly ratings: ReadonlyMap<string, AllianceMemberRating>;
  /** Team key -> the award base-rate lookup's two keys. Not required when `knownAwardPoints` is supplied. */
  readonly awardProfiles: ReadonlyMap<string, DistrictAwardProfile>;
  /**
   * STAGE INPUT — alliances announced. Present means the draft is NOT
   * simulated: selection points come from each team's real slot and the
   * bracket is seeded from these rosters. Validated, never trusted.
   */
  readonly knownAlliances?: readonly SuppliedAlliance[];
  /**
   * STAGE INPUT — playoffs done. Present means the bracket is NOT routed at
   * all. Routing and discarding would consume the ledger stream and silently
   * change every subsequent draw, so this skip is a correctness requirement
   * rather than an optimisation. A team absent from the map scores 0.
   */
  readonly knownElimPoints?: ReadonlyMap<string, number>;
  /**
   * STAGE INPUT — awards posted. Present means no award is drawn, no
   * randomness is consumed for awards, and an award PROFILE is not required:
   * a posted award needs no base rate. A team absent from the map scores 0.
   */
  readonly knownAwardPoints?: ReadonlyMap<string, number>;
  /**
   * PARTIAL STAGE INPUT — the elimination matches ALREADY PLAYED while the
   * playoffs are still running. The bracket is still routed; every set the
   * played rows decide takes its real result and consumes NO randomness, and
   * every set still open is priced as before (quick task 260925-uf8).
   *
   * WHY THIS IS NOT A FIFTH FLAG. `knownElimPoints` says "the playoffs are
   * OVER, here are the points", which skips the routing entirely; this says
   * "the playoffs are UNDER WAY, here is how far", which routes the same
   * bracket from a real starting position. The two are different facts about
   * different stages and neither can express the other: an all-or-nothing
   * playoff stage is exactly what made the cell print a chance of reaching the
   * top four while the alliance was already in the final.
   *
   * THE LEDGER STREAM'S CONSUMED COUNT IS LOWER when this is supplied, by one
   * draw per played match, BY DESIGN — the same stage-dependence the header
   * already states for a skipped stage. A seeded output therefore changes when
   * a match is played, which is the point.
   *
   * Only consulted for an EIGHT-ALLIANCE bracket with `knownElimPoints` absent.
   * A divisioned district championship parent draws from the measured fallback
   * table and has no bracket to condition, and a finished playoff has nothing
   * left to condition.
   */
  readonly playedElimMatches?: readonly PlayedBracketMatch[];
  /**
   * AWARD ONLY TEAMS (quick task 260927-vmb): registered teams that are NOT on
   * the posted qualification schedule. They earn no qualification, selection
   * or playoff points, but they are still in the event's award field: they
   * join the decoration ordering and the posted / ordering / base-rate path
   * choice exactly as a roster team does, and each is drawn by the SAME
   * per-team award draw, after every roster team in each draw.
   *
   * Absent or empty is byte for byte the shipped run; `ledgerSimulation.test.ts`
   * pins the two as deep equal. WHO these teams are is the caller's decision:
   * this module only refuses an empty key, a duplicate, or a key that is also
   * in `baselines` (`InvalidAwardOnlyTeamsError`), and needs an award profile
   * for each unless `knownAwardPoints` is supplied.
   */
  readonly awardOnlyTeams?: readonly string[];
}

/**
 * The complete output of one joint run.
 *
 * THE INDEXING CONTRACT, stated once and in one place: in EVERY histogram
 * below, **index `i` holds the DRAW COUNT for exactly `i` points**. Offset
 * zero, value equals index, never a probability. This differs by one from the
 * rank convention `continuousQuantile` was written for (there index `i` holds
 * the count for rank `i + 1`), and that difference is handled in exactly ONE
 * place — `pointSummary.ts`'s points-axis wrapper, which delegates to the
 * estimator and subtracts one. Offset zero was chosen over an offset encoding
 * because it removes a whole class of off-by-one, at the cost of a few leading
 * zeros that the publish-boundary encoder trims anyway.
 *
 * Every array's length is `maxEventPoints(season, tier)`'s value for that
 * category plus one; the event total's length is the sum of all four plus one.
 * `Map` and `Int32Array` are both structured-cloneable, so a Web Worker can
 * `postMessage` this as-is.
 */
export interface DistrictLedgerResult {
  readonly eventKey: string;
  readonly draws: number;
  readonly qualPoints: ReadonlyMap<string, Int32Array>;
  readonly selectionPoints: ReadonlyMap<string, Int32Array>;
  readonly elimPoints: ReadonlyMap<string, Int32Array>;
  readonly awardPoints: ReadonlyMap<string, Int32Array>;
  readonly eventTotal: ReadonlyMap<string, Int32Array>;
  /**
   * Team key -> which rung of `awardBaseRate`'s fallback hierarchy that team's
   * lookup landed on, so 10-07's drawer can say whether a cell rests on its
   * own cell, a pooled bucket or the whole season. EMPTY when
   * `knownAwardPoints` was supplied, because no lookup ran.
   */
  readonly awardSources: ReadonlyMap<string, AwardBaseRateSource>;
  /**
   * Which award pricing this run actually used, so a caller never has to infer
   * it from the numbers. See `AwardOrderingDisposition`.
   */
  readonly awardOrdering: AwardOrderingDisposition;
  /**
   * Team key -> how far that team's alliance has already got in the bracket, so
   * the Playoffs cell can print the milestone it is actually chasing rather
   * than always printing the chance of reaching the top four.
   *
   * EMPTY unless the alliances are KNOWN and the bracket was routed from played
   * matches. A milestone names an ALLIANCE's progress, and when the draft is
   * simulated a team is on a different alliance on every draw, so there is no
   * alliance whose progress could be reported. Elimination matches cannot be
   * played before alliances are announced, so the two conditions coincide in
   * practice and neither is a restriction the sport can violate.
   *
   * DERIVED ONCE, OUTSIDE THE DRAW LOOP, and not a marginal of the draws: it is
   * a function of the played matches and the supplied rosters alone, so it
   * carries no Monte Carlo error at all.
   */
  readonly playoffMilestones: ReadonlyMap<string, AllianceBracketMilestone>;
  /**
   * Team key -> WHICH ROUTE onto a playoff alliance that team took, per route,
   * across the same runs the `selectionPoints` histogram is a marginal of.
   *
   * WHY THE HISTOGRAM IS NOT ENOUGH, which is the whole reason this field
   * exists. A captain and a first pick earn the SAME points at one alliance
   * number (`selectionPoints.ts`: both are `17 - allianceNumber`), so the
   * points histogram cannot tell the two apart, and 1 - the mass at zero is the
   * chance of ANY selection points rather than the chance of being picked. The
   * shipped cell therefore printed "picked" over a number that counted captains
   * too. The route is already known inside the draw — it is how
   * `selection[teamI]` got its value — and it was thrown away.
   *
   * CONSUMES NO RANDOMNESS AND CHANGES NO SEEDED OUTPUT. The draft is
   * deterministic given the ranking and the ratings, so recording which slot a
   * team filled adds observation and nothing else;
   * `ledgerSimulation.test.ts` pins every marginal and every ledger-stream
   * count as unchanged.
   *
   * Always populated, including when `knownAlliances` was supplied — that run's
   * routes are the real ones, taken from the supplied slots.
   */
  readonly selectionRoutes: ReadonlyMap<string, DistrictSelectionRoutes>;
  /**
   * Whether the QUALIFICATION RANKING was the same in every draw: true exactly
   * when the run was handed no remaining matches.
   *
   * Reported rather than left to be inferred, because it changes what an absent
   * route MEANS. With a fixed ranking the draft is deterministic, so a route no
   * run took is IMPOSSIBLE and the alliance number a route landed on is a fact;
   * with matches still to play the same absence is merely "none of these 1,000
   * runs", and the alliance number is a prediction. 10-07's drawer omits a
   * ruled-out route on exactly this basis and keeps a merely-unobserved one.
   *
   * `remainingMatches.length === 0` is this module's own expression of a
   * finished qualification stage — see the header's "every stage is an input"
   * section — so this is that same fact forwarded, never a fifth flag.
   */
  readonly rankingFixed: boolean;
  /**
   * The input's `awardOnlyTeams`, in their given order, present ONLY when that
   * list was non-empty. These keys appear in `awardPoints`, `eventTotal` and
   * `awardSources` and nowhere else, and their `eventTotal` equals their award
   * draw by construction: the three on-field categories are zero for a team
   * with no match to play.
   */
  readonly awardOnlyTeams?: readonly string[];
}

/**
 * ONE team's routes onto (or off) a playoff alliance, over one run's draws.
 *
 * `bySlot` is indexed by TBA's OWN pick slot, exactly as `selectionPoints.ts`
 * defines it: 0 captain, 1 first pick, 2 second pick, 3 backup robot. Reusing
 * TBA's index rather than inventing a route enum keeps the point values, the
 * corpus reconciliation and this observation on one vocabulary.
 *
 * `bySlot[i].draws` summed with `notSelectedDraws` equals the run's draw count
 * exactly, for every team, which is what makes 10-07's outcome list add to a
 * hundred. `ledgerSimulation.test.ts` asserts that sum rather than trusting it.
 *
 * Every field is a plain number or `undefined`, so the whole object is
 * structured cloneable and crosses the Worker boundary unreshaped.
 */
export interface DistrictSelectionRoutes {
  /** One entry per pick slot, length `MAX_PICK_SLOTS`, indexed by TBA's own slot. */
  readonly bySlot: readonly DistrictSelectionRouteObservation[];
  /** Draws in which no alliance took this team at all. Its selection points are zero in those draws. */
  readonly notSelectedDraws: number;
}

/** What one pick slot did for one team across the draws. */
export interface DistrictSelectionRouteObservation {
  readonly draws: number;
  /**
   * The lowest and highest selection points this slot PRODUCED for this team,
   * and `undefined` when no draw took this route.
   *
   * `undefined` rather than zero, on the same terms
   * `conditionalMedianGivenPoints` states for its own absence: a route no run
   * took paid nothing at all, and a zero here would read as "this route pays
   * zero points", which for a captain is false.
   */
  readonly minPoints: number | undefined;
  readonly maxPoints: number | undefined;
  /**
   * The alliance number every draw that took this route agreed on, and
   * `undefined` where they disagree or where no draw took it. A single value
   * here plus `rankingFixed` is what lets a cell print "captain, alliance 5"
   * as a statement rather than a prediction.
   */
  readonly allianceNumber: number | undefined;
  /**
   * The lowest and highest points this slot CAN pay at this event's alliance
   * count and tier, from `districtSelectionPoints` and never a literal.
   *
   * Reported for every slot whether or not a draw took it, so a caller
   * rendering a route that none of the runs produced still has an honest point
   * range to print instead of a fabricated zero.
   *
   * When the draft is SIMULATED the range spans the drafted alliances only
   * (`draftedAllianceCount`), because a filler seed pays no real team; with
   * supplied alliances it spans every alliance. At 24 teams or more the two
   * are the same (quick task 261007-4qr).
   */
  readonly possibleMinPoints: number;
  readonly possibleMaxPoints: number;
}

/**
 * ONE draw's complete state, handed to the optional observer.
 *
 * A TEST SEAM. It must not be sent across a Worker boundary, it is not part of
 * the structured-cloneable input object, it consumes no randomness and it
 * changes no output. Every array on it is an INTERNAL BUFFER, reused and
 * overwritten on the next draw — an observer that needs to keep one must copy
 * it, exactly as `SimDrawHook`'s own contract states for `order`.
 *
 * Per-team arrays are indexed by position in `baselines` and stay ROSTER
 * INDEXED when `awardOnlyTeams` is supplied: an award only team has no entry in
 * `award` or `total` here, though `ledgerDraws` does count the stream its award
 * draw consumed (quick task 260927-vmb). `alliances`'s entry
 * at index `n - 1` is alliance `n`'s roster in pick-slot order. A FILLER
 * alliance (a short roster's undrafted seed, or a whole demo alliance) has an
 * EMPTY entry, and a filler pick never appears in any entry (quick task
 * 261007-4qr).
 */
export interface DistrictDrawObservation {
  readonly draw: number;
  readonly order: readonly number[];
  readonly alliances: readonly (readonly string[])[];
  readonly qual: readonly number[];
  readonly selection: readonly number[];
  readonly elim: readonly number[];
  readonly award: readonly number[];
  readonly total: readonly number[];
  /** The bracket set identifiers the decider was asked about, in request order. Empty when no bracket was routed. */
  readonly bracketSetIds: readonly string[];
  /** How many values this draw consumed from the LEDGER stream. */
  readonly ledgerDraws: number;
}

/** See `DistrictDrawObservation` — a test seam, never a Worker-crossing value. */
export type DistrictDrawObserver = (observation: DistrictDrawObservation) => void;

// ---------------------------------------------------------------------------
// Typed errors. Every one names EVERY offender, not the first.
// ---------------------------------------------------------------------------

/**
 * Raised before any draw when a roster member's published SPR pair cannot
 * price an alliance: an absent or non-finite `total`, or an absent,
 * non-finite or non-positive `sigma`.
 *
 * A ZERO-SPREAD ROSTER IS AN ABSENCE OF INFORMATION ABOUT SPREAD, NOT A
 * CERTAINTY — the same rule `allianceSigmaBandVariance` states as "better no
 * band than a tight one", and the reason `allianceWinProbability` returns
 * `undefined` for a non-positive combined variance. Requiring a strictly
 * positive sigma here is what makes that `undefined` branch unreachable
 * downstream.
 *
 * THE HANDOFF, stated rather than left to be found: the CALLER (10-07)
 * catches this and renders that event's open cells as unavailable. This module
 * deliberately does not decide that, and deliberately does not price the teams
 * it can and drop the rest — a partial result is a complete,
 * plausible-looking, WRONG distribution, which is the same reason
 * `UnknownTeamKeyError` throws rather than dropping.
 */
export class UnratedTeamError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "UnratedTeamError";
  }
}

/**
 * Raised before any draw when `awardOnlyTeams` holds an empty key, a
 * duplicate, or a key that is also in `baselines`. A team cannot be both on
 * the schedule and off it, and a duplicate would be drawn twice into one
 * histogram. Every offender is named, not the first.
 */
export class InvalidAwardOnlyTeamsError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidAwardOnlyTeamsError";
  }
}

/** Raised before any draw when a roster member (or an award only team) has no award profile and no known award points were supplied. */
export class MissingAwardProfileError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "MissingAwardProfileError";
  }
}

/**
 * Raised when `fieldSize` is not an integer at least as large as the roster.
 * The qualification formula rejects a rank above its field size, and a
 * silently clamped rank would publish a wrong point value.
 */
export class InvalidFieldSizeError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidFieldSizeError";
  }
}

/**
 * Raised before any draw for the two rosters this module cannot seat: one with
 * FEWER TEAMS THAN ALLIANCES, and, at a non-eight alliance count (the
 * divisioned DCMP parents), one that cannot fill `allianceCount` three-team
 * alliances. An eight-alliance roster under 24 teams is NOT refused: it prices
 * under the short-roster rule, whole real alliances at the top seeds and
 * filler alliances that forfeit below them (quick task 261007-4qr, see
 * `draftedAllianceCount` and this file's header).
 */
export class InsufficientRosterError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InsufficientRosterError";
  }
}

/**
 * Raised when a SUPPLIED alliance set is malformed: a team on two alliances,
 * an alliance number outside the range, a duplicate or missing alliance
 * number, an empty pick list, a pick list longer than TBA's own maximum of
 * four, or a pick naming a team absent from the roster. A demo key absent
 * from the roster is NOT an error: it is filler (quick task 261007-4qr, see
 * this file's header).
 *
 * A malformed set that reached the draw loop would produce a complete,
 * plausible-looking, WRONG selection distribution — the same failure
 * `UnknownTeamKeyError` exists to prevent, which is why a supplied set is
 * validated rather than trusted. Every offending alliance and team is named,
 * not the first.
 */
export class InvalidAllianceSetError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidAllianceSetError";
  }
}

/**
 * Raised when `allianceWinProbability` returns `undefined` for a pair the
 * up-front validation should have made impossible. Thrown rather than coerced
 * to a coin: a coin flip here is a fabricated number wearing a measured
 * function's name.
 */
export class AlliancePricingError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "AlliancePricingError";
  }
}

/**
 * Raised before any draw when a KNOWN-STAGE point value cannot be a histogram
 * index for this event: not an integer, below zero, or above that category's
 * own ceiling from `maxEventPoints(season, tier)`.
 *
 * WHY THIS IS FATAL RATHER THAN CLAMPED. Each accumulator is an `Int32Array`
 * sized to the category ceiling plus one, and a TypedArray write outside its
 * range — or at a fractional index — is a SILENT NO-OP. No throw, no
 * `undefined`, no `NaN`: the draw simply vanishes. A single out-of-range value
 * therefore empties that team's whole category histogram, and
 * `pointSummary.chanceOfAnyPoints` then computes `1 - 0/draws` and reports a
 * 100% chance of earning points over a distribution with no mass in it. A
 * clamp would be worse, not better: it would publish a point value the event
 * cannot produce while looking entirely healthy.
 *
 * The values come from TBA's own published `event_points` components, which
 * this module does not control — `awardBaseRates.pointsToSupportIndex` already
 * treats an award value above 15 as possible. The refusal matches the publish
 * boundary's: `encodeDistrictPointPmf` throws `EmptyHistogramError` on the same
 * input, so the offline and live halves of one module agree.
 *
 * THE HANDOFF: `apps/web/src/workers/districtSimulationProtocol.ts` converts
 * any typed throw from this function into a per-event `unavailable` entry, the
 * same path `UnratedTeamError` takes, so that event's cells render as
 * unavailable rather than as a fabricated number. Every offender is named, not
 * the first.
 */
export class InvalidKnownPointsError extends Error {
  constructor(message: string) {
    super(`simulateDistrictEvent: ${message}`);
    this.name = "InvalidKnownPointsError";
  }
}

/** Raised by the grand-total convolution for a non-integer addend, a non-positive denominator, or a combined shift below zero. */
export class NegativeDistrictShiftError extends Error {
  constructor(message: string) {
    super(`convolveDistrictGrandTotal: ${message}`);
    this.name = "NegativeDistrictShiftError";
  }
}

/** Raised by the publish-boundary encoder for an all-zero histogram or a non-positive draw count. */
export class EmptyHistogramError extends Error {
  constructor(message: string) {
    super(`encodeDistrictPointPmf: ${message}`);
    this.name = "EmptyHistogramError";
  }
}

// ---------------------------------------------------------------------------
// The bracket decider's pricing step, exported so its refusal branch is
// directly testable.
// ---------------------------------------------------------------------------

/**
 * Prices one bracket match and turns the probability into a winner with ONE
 * `rng()` draw and nothing else.
 *
 * The FIRST-named alliance is treated as red. The assignment is immaterial to
 * the distribution — `allianceWinProbability`'s exact symmetry is pinned by
 * 10-02's own tests — and is fixed here only so a seed reproduces.
 *
 * Throws `AlliancePricingError` rather than coercing when the measured pricer
 * declines to answer. `simulateDistrictEvent`'s up-front validation makes that
 * branch unreachable through the public entry point; this function is exported
 * so a test can reach it anyway and prove the refusal exists.
 */
export function decideBracketMatch(
  allianceA: number,
  allianceB: number,
  rosterA: readonly AllianceMemberRating[],
  rosterB: readonly AllianceMemberRating[],
  setId: string,
  rng: () => number
): number {
  const pWinsA = allianceWinProbability(rosterA, rosterB);
  if (pWinsA === undefined) {
    throw new AlliancePricingError(
      `set ${setId}: allianceWinProbability declined to price alliance ${allianceA} against alliance ${allianceB} — refusing to coerce an unpriceable pair into a coin flip`
    );
  }
  return rng() < pWinsA ? allianceA : allianceB;
}

// ---------------------------------------------------------------------------
// The joint run
// ---------------------------------------------------------------------------

/** The number of robots a simulated alliance drafts: a captain, a first pick and a second pick. */
/** A route accumulator entry no draw has written yet. Negative, so it cannot collide with a real point value or alliance number. */
const ROUTE_UNSET = -1;
/** A route accumulator's alliance-number entry two draws disagreed on. See `DistrictSelectionRouteObservation.allianceNumber`. */
const ROUTE_MIXED = -2;

const DRAFTED_ALLIANCE_SIZE = 3;
/** TBA's `picks` array never holds more than four entries; index 3 is a backup robot. */
const MAX_PICK_SLOTS = 4;
/** The playoff field this module routes a bracket for. */
const BRACKET_ALLIANCE_COUNT = 8;

/**
 * How many alliances a SIMULATED draft seats with real teams (quick task
 * 261007-4qr). At `allianceCount * 3` teams or more it is every alliance, so
 * every event that simulated before this function existed simulates
 * identically. Below that it is `floor((teamCount - 1) / 3)`: whole real
 * alliances at the top seeds, and the remaining seeds left as FILLER alliances
 * with no members, which forfeit. For eight alliances: 24 or more gives 8, 23
 * and 22 give 7, 21 and 20 give 6, 18 gives 5, 8 gives 2.
 *
 * MEASURED, NOT CHOSEN. Every 2023-plus district event (event_type 1) in
 * `data/corpus.sqlite` under 24 real teams on a qualification row, re-checked
 * 2026-10-07:
 *
 *   event       real teams   real alliances   demo alliances
 *   2026txmca   18           1 to 5           6, 7, 8
 *   2026mefal   20           1 to 6           7, 8
 *   2023gaalb   21           1 to 6           7, 8
 *   2025ncash   22           1 to 7           8
 *   2024vapor   23           1 to 7           8
 *
 * `floor((N - 1) / 3)` matches 5 of 5. `floor(N / 3)` matches 3 of 5, and both
 * of its misses are the N divisible by three. No such event ever seated a demo
 * robot beside a real one on an alliance.
 *
 * AT EXACTLY 24 the corpus splits (2026isde2 seated eight real alliances,
 * 2026txfor seven plus one demo alliance), and 24 or more stays OUTSIDE this
 * rule: the eight-real-alliance draft is kept unchanged there.
 */
export function draftedAllianceCount(teamCount: number, allianceCount: number): number {
  if (teamCount >= allianceCount * DRAFTED_ALLIANCE_SIZE) return allianceCount;
  return Math.floor((teamCount - 1) / DRAFTED_ALLIANCE_SIZE);
}

/**
 * Why a `teamCount` roster cannot be simulated with `allianceCount` alliances,
 * or `null` when it can. THE ONE REFUSAL PREDICATE: `simulateDistrictEvent`
 * throws exactly this reason (prefixed with its event key) and
 * `packages/harness/districtBake.ts` skips on it up front, so the two can
 * never disagree about which roster is priceable (quick task 261007-il9).
 *
 * Checked in the simulation's own order: fewer teams than alliances first
 * (no captain for every alliance the bracket needs), then a non eight alliance
 * count under three teams per alliance (the divisioned DCMP parents have no
 * measured short roster convention). An eight alliance roster of at least
 * eight teams is never refused, because the short roster rule applies
 * (`draftedAllianceCount`).
 */
export function insufficientRosterReason(teamCount: number, allianceCount: number): string | null {
  if (teamCount < allianceCount) {
    return `a ${teamCount}-team roster is smaller than its ${allianceCount} alliances`;
  }
  if (allianceCount !== BRACKET_ALLIANCE_COUNT && teamCount < allianceCount * DRAFTED_ALLIANCE_SIZE) {
    return `a ${teamCount}-team roster cannot fill ${allianceCount} ${DRAFTED_ALLIANCE_SIZE}-team alliances`;
  }
  return null;
}

/**
 * Validates one known-stage map against the category ceiling its histogram is
 * sized to, naming EVERY offender rather than the first — the same discipline
 * the unrated-team and alliance-set passes follow, so one run tells a caller
 * everything that is wrong. An absent map is a valid input and passes.
 *
 * See `InvalidKnownPointsError` for why an out-of-range value is fatal here
 * rather than clamped or absorbed.
 */
function assertKnownPointsInRange(
  eventKey: string,
  category: "elim" | "award",
  known: ReadonlyMap<string, number> | undefined,
  ceiling: number
): void {
  if (known === undefined) return;
  const offenders: string[] = [];
  for (const [teamKey, value] of known) {
    if (!Number.isInteger(value) || value < 0 || value > ceiling) offenders.push(`${teamKey}=${String(value)}`);
  }
  if (offenders.length > 0) {
    throw new InvalidKnownPointsError(
      `event ${eventKey}: ${String(offenders.length)} known ${category} value(s) are not whole point counts within 0 through ${String(ceiling)}, ` +
        `which is this event's own ${category} ceiling from maxEventPoints — refusing to index a histogram with them: ${offenders.join(", ")}`
    );
  }
}

/**
 * Runs `draws` joint simulations of one district event and returns the five
 * per-team marginal histograms, every one a marginal of the SAME runs.
 *
 * Determinism: `seed` fixes both streams. Two runs at one seed are
 * byte-identical.
 *
 * `observer` is a test seam — see `DistrictDrawObservation`.
 */
export function simulateDistrictEvent(
  input: DistrictLedgerEventInput,
  draws: number,
  seed: number,
  observer?: DistrictDrawObserver
): DistrictLedgerResult {
  const { eventKey, season, tier, fieldSize, allianceCount, baselines, ratings, awardProfiles } = input;

  // -------------------------------------------------------------------------
  // VALIDATE BEFORE THE LOOP, once, the way `simulateRanks` does — O(teams)
  // rather than O(draws x teams), and every offender named rather than the
  // first, so one run tells a caller everything that is wrong.
  // -------------------------------------------------------------------------

  // `maxEventPoints` raises `UnknownDistrictSeasonError` for an unregistered
  // season; it is allowed to propagate untouched rather than wrapped.
  const ceilings = maxEventPoints(season, tier);
  const weight = districtTierWeight(season, tier);
  // The whole module is scoped to the 2023-plus format — see the header.
  assertBracketSeason(season);

  const teamCount = baselines.length;

  if (!Number.isInteger(fieldSize) || fieldSize < teamCount) {
    throw new InvalidFieldSizeError(
      `event ${eventKey}: fieldSize must be an integer at least as large as the ${teamCount}-team roster, got ${fieldSize}`
    );
  }
  if (!Number.isInteger(allianceCount) || allianceCount < 1) {
    throw new InsufficientRosterError(`event ${eventKey}: allianceCount must be a positive integer, got ${allianceCount}`);
  }
  const usesEightAllianceBracket = allianceCount === BRACKET_ALLIANCE_COUNT;
  const elimIsKnown = input.knownElimPoints !== undefined;
  if (!usesEightAllianceBracket && !elimIsKnown) {
    // An alliance count the measured fallback table has no population for
    // raises `UnsupportedAllianceCountError` from `bracket.ts`, HERE, before
    // any draw — never a fabricated bracket and never a smoothed guess.
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
    }
  }
  // THE TWO REFUSALS LEFT (quick task 261007-4qr). An eight-alliance roster
  // under 24 teams now prices under the short-roster rule (see
  // `draftedAllianceCount`); fewer teams than alliances cannot seat a captain on
  // every alliance the bracket needs, and a non-eight alliance count (the
  // divisioned DCMP parents) has no measured short-roster convention at all.
  // Both live in `insufficientRosterReason`, the predicate the bake also reads
  // (quick task 261007-il9).
  const rosterRefusal = insufficientRosterReason(teamCount, allianceCount);
  if (rosterRefusal !== null) {
    throw new InsufficientRosterError(`event ${eventKey}: ${rosterRefusal}`);
  }

  // A KNOWN STAGE'S VALUES ARE HISTOGRAM INDICES, so they are validated here
  // and never trusted. Every accumulator below is an `Int32Array` sized to this
  // event's own ceiling, and an out-of-range or fractional write on a TypedArray
  // is a SILENT NO-OP — one third-party value of 20 against a district award
  // ceiling of 15 drops all of that category's mass, after which
  // `pointSummary.chanceOfAnyPoints` reads `1 - 0/draws` and a cell prints a
  // confident 100% over an empty distribution. Refusing matches the publish
  // boundary: `encodeDistrictPointPmf` already throws `EmptyHistogramError` on
  // the same input, and the two halves of this module must not disagree about
  // whether an input is fatal. `districtSimulationProtocol.ts` turns this typed
  // throw into a per-event `unavailable` entry, exactly as it does
  // `UnratedTeamError`, so the cell reads "unavailable" rather than wrong.
  assertKnownPointsInRange(eventKey, "elim", input.knownElimPoints, ceilings.elim);
  assertKnownPointsInRange(eventKey, "award", input.knownAwardPoints, ceilings.award);

  const unrated: string[] = [];
  const roster: AllianceMemberRating[] = [];
  for (const baseline of baselines) {
    const rating = ratings.get(baseline.teamKey);
    const total = rating?.total;
    const sigma = rating?.sigma;
    if (
      typeof total !== "number" ||
      !Number.isFinite(total) ||
      typeof sigma !== "number" ||
      !Number.isFinite(sigma) ||
      sigma <= 0
    ) {
      unrated.push(baseline.teamKey);
      roster.push({ teamKey: baseline.teamKey, total: undefined, sigma: undefined });
      continue;
    }
    roster.push({ teamKey: baseline.teamKey, total, sigma });
  }
  if (unrated.length > 0) {
    throw new UnratedTeamError(
      `event ${eventKey}: ${unrated.length} roster team(s) carry an absent, non-finite or non-positive published SPR pair and cannot be priced: ${unrated.join(", ")}`
    );
  }

  // THE AWARD ONLY TEAMS, validated before any draw and every offender named.
  const awardOnlyKeys: readonly string[] = input.awardOnlyTeams ?? [];
  if (awardOnlyKeys.length > 0) {
    const rosterKeySet = new Set(baselines.map((baseline) => baseline.teamKey));
    const seen = new Set<string>();
    const offenders: string[] = [];
    for (const key of awardOnlyKeys) {
      if (key.length === 0) offenders.push(`${JSON.stringify(key)} (empty)`);
      else if (seen.has(key)) offenders.push(`${key} (duplicate)`);
      else if (rosterKeySet.has(key)) offenders.push(`${key} (also on the roster)`);
      seen.add(key);
    }
    if (offenders.length > 0) {
      throw new InvalidAwardOnlyTeamsError(
        `event ${eventKey}: ${String(offenders.length)} award only key(s) are empty, duplicated or also in baselines: ${offenders.join(", ")}`
      );
    }
  }
  // THE AWARD FIELD: the roster in `baselines` order, then the award only teams
  // in their given order. Index `i < teamCount` is roster team `i`, so every
  // roster-indexed structure below keeps its meaning, and with no award only
  // team this list is the roster exactly.
  const awardField: readonly { readonly teamKey: string }[] =
    awardOnlyKeys.length === 0 ? baselines : [...baselines, ...awardOnlyKeys.map((teamKey) => ({ teamKey }))];
  const awardFieldCount = awardField.length;

  const awardIsKnown = input.knownAwardPoints !== undefined;
  const awardSources = new Map<string, AwardBaseRateSource>();
  const awardPmfByTeam: (readonly number[])[] = [];
  let orderingAssignments: readonly AwardOrderingAssignment[] | undefined;
  let awardOrdering: AwardOrderingDisposition = "posted";
  if (!awardIsKnown) {
    // A POSTED award needs no base rate, which is why this whole block — the
    // lookup and its missing-profile refusal alike — is skipped when the award
    // outcome is already known. That is what genuinely distinguishes the two
    // stages rather than merely short-circuiting one of them.
    const missingProfiles: string[] = [];
    for (const baseline of awardField) {
      const profile = awardProfiles.get(baseline.teamKey);
      if (profile === undefined) {
        missingProfiles.push(baseline.teamKey);
        awardPmfByTeam.push([]);
        continue;
      }
      // Looked up ONCE per team, outside the draw loop. The rung travels back
      // on the result so 10-07's drawer can say which one a cell rests on.
      const rate = awardBaseRate(season, profile.bucket, profile.rookieState);
      awardSources.set(baseline.teamKey, rate.source);
      // FOLDED ONCE, HERE, rather than per draw: the measured table's top two
      // bins are stacks of two awards, and two awards are never a predicted
      // possibility. The mass is moved onto the highest single award of each
      // stack, so the pmf still sums to one and the draw below can index
      // `AWARD_POINT_SUPPORT` unchanged. See `foldStackedAwardPmf`.
      awardPmfByTeam.push(foldStackedAwardPmf(rate.pmf));
    }
    if (missingProfiles.length > 0) {
      throw new MissingAwardProfileError(
        `event ${eventKey}: ${missingProfiles.length} roster team(s) have no award profile and no known award points were supplied: ${missingProfiles.join(", ")}`
      );
    }

    // THE ORDERING LAYER, resolved ONCE per event outside the draw loop. When it
    // applies it REPLACES the base-rate pmf rather than adding to it: the
    // residual table is the same population with the Impact and Rookie All Star
    // mass carved out, so drawing from both would count those two awards twice.
    // Over the whole AWARD FIELD, so an award only team takes a real position
    // in the ordering and a missing count on one sends the event back to the
    // base rate exactly as a roster team's would.
    orderingAssignments = awardOrderingAssignments(season, awardField, awardProfiles);
    if (orderingAssignments !== undefined) {
      awardOrdering = "applied";
      // The reported rung becomes the RESIDUAL table's, because that is the
      // table this run's points were actually drawn from. Reporting the
      // base-rate rung would name a table the run did not use.
      for (const assignment of orderingAssignments) awardSources.set(assignment.teamKey, assignment.residualSource);
    } else {
      awardOrdering = hasAwardOrderingTables(season) ? "incomplete-profiles" : "no-table";
    }
  }

  const teamIndex = new Map<string, number>(baselines.map((baseline, i) => [baseline.teamKey, i]));
  const suppliedAlliances = validateSuppliedAlliances(input, teamIndex, allianceCount);

  // THE PARTIALLY-PLAYED BRACKET, resolved ONCE before any draw. `routePlayedBracket`
  // raises `InvalidBracketDecisionError` for a match whose winner was not one of
  // the two alliances in its set, which is a mis-mapped match — and it raises it
  // HERE, before a single draw, so `districtSimulationProtocol.ts` turns it into
  // a per-event unavailable entry rather than a table of confident wrong numbers.
  const playedDecisions =
    input.playedElimMatches === undefined || !usesEightAllianceBracket || elimIsKnown
      ? undefined
      : bracketDecisionsFromPlayedMatches(input.playedElimMatches);
  const playoffMilestones = new Map<string, AllianceBracketMilestone>();
  if (playedDecisions !== undefined && suppliedAlliances !== undefined) {
    const milestoneByAlliance = allianceBracketMilestones(routePlayedBracket(playedDecisions));
    for (const alliance of suppliedAlliances) {
      const milestone = milestoneByAlliance.get(alliance.allianceNumber);
      if (milestone === undefined) continue;
      for (const teamI of alliance.memberIndices) playoffMilestones.set(baselines[teamI]!.teamKey, milestone);
    }
  } else if (playedDecisions !== undefined) {
    // A played bracket with a SIMULATED draft still conditions the routing — the
    // real results are real — but reports no milestone, because the alliance a
    // team sits on changes from draw to draw. See `playoffMilestones`.
    routePlayedBracket(playedDecisions);
  }

  // -------------------------------------------------------------------------
  // Accumulators, buffers and every per-rank/per-team constant: allocated ONCE
  // outside the draw loop and reset in place, following `rankSimulation.ts`'s
  // accumulator discipline. 1,000 draws must stay comfortably inside a Web
  // Worker frame budget, and per-draw allocation is what makes that untrue.
  // -------------------------------------------------------------------------

  const qualLength = ceilings.qual + 1;
  const allianceLength = ceilings.alliance + 1;
  const elimLength = ceilings.elim + 1;
  const awardLength = ceilings.award + 1;
  const totalLength = ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award + 1;

  const qualHistograms = new Map<string, Int32Array>();
  const selectionHistograms = new Map<string, Int32Array>();
  const elimHistograms = new Map<string, Int32Array>();
  const awardHistograms = new Map<string, Int32Array>();
  const totalHistograms = new Map<string, Int32Array>();
  for (const baseline of baselines) {
    qualHistograms.set(baseline.teamKey, new Int32Array(qualLength));
    selectionHistograms.set(baseline.teamKey, new Int32Array(allianceLength));
    elimHistograms.set(baseline.teamKey, new Int32Array(elimLength));
    awardHistograms.set(baseline.teamKey, new Int32Array(awardLength));
    totalHistograms.set(baseline.teamKey, new Int32Array(totalLength));
  }
  // Histogram references in baseline order, so the draw body indexes rather
  // than hashes a team key five times per team per draw.
  const qualByIndex = baselines.map((b) => qualHistograms.get(b.teamKey)!);
  const selectionByIndex = baselines.map((b) => selectionHistograms.get(b.teamKey)!);
  const elimByIndex = baselines.map((b) => elimHistograms.get(b.teamKey)!);
  const awardByIndex = baselines.map((b) => awardHistograms.get(b.teamKey)!);
  const totalByIndex = baselines.map((b) => totalHistograms.get(b.teamKey)!);
  // THE AWARD ONLY TEAMS' two histograms, sized from the same ceilings and
  // inserted AFTER every roster team, so iterating either map visits the roster
  // first and in the order it always did. Award and event total only: a team
  // with no match to play has no qualification, selection or playoff marginal.
  const awardOnlyAwardByIndex: Int32Array[] = [];
  const awardOnlyTotalByIndex: Int32Array[] = [];
  for (const teamKey of awardOnlyKeys) {
    const awardHistogram = new Int32Array(awardLength);
    const totalHistogram = new Int32Array(totalLength);
    awardHistograms.set(teamKey, awardHistogram);
    totalHistograms.set(teamKey, totalHistogram);
    awardOnlyAwardByIndex.push(awardHistogram);
    awardOnlyTotalByIndex.push(totalHistogram);
  }

  // Qualification points are a pure function of rank, so the whole rank-to-
  // points table is computed once rather than `teamCount x draws` times.
  const qualPointsByRank = new Array<number>(teamCount);
  for (let rank = 1; rank <= teamCount; rank++) {
    qualPointsByRank[rank - 1] = districtQualPoints(season, tier, rank, fieldSize);
  }

  // Selection points are a pure function of (pick slot, alliance number).
  const selectionPointsBySlotAndAlliance: number[][] = [];
  for (let slot = 0; slot < MAX_PICK_SLOTS; slot++) {
    const row = new Array<number>(allianceCount + 1).fill(0);
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      row[allianceNumber] = districtSelectionPoints(season, tier, slot, allianceNumber);
    }
    selectionPointsBySlotAndAlliance.push(row);
  }

  // HOW MANY ALLIANCES A SIMULATED DRAFT SEATS (quick task 261007-4qr): every
  // one at 24 teams or more, whole real alliances 1 to k below that, and the
  // seeds after k left as filler. Computed once. A supplied alliance set is
  // read as published and never consults it.
  const draftedCount = draftedAllianceCount(teamCount, allianceCount);

  // The range each slot CAN pay at this event's alliance count and tier, read
  // off the table just built rather than restated: no slot's point range is a
  // literal anywhere in this module. When the draft is SIMULATED it spans the
  // drafted alliances only, because a filler seed pays no real team; with
  // supplied alliances it spans them all. At 24 teams or more the two agree.
  const possibleAllianceCount = suppliedAlliances === undefined ? draftedCount : allianceCount;
  const possiblePointsBySlot = selectionPointsBySlotAndAlliance.map((row) => {
    let low = row[1]!;
    let high = row[1]!;
    for (let allianceNumber = 1; allianceNumber <= possibleAllianceCount; allianceNumber++) {
      const value = row[allianceNumber]!;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return { low, high };
  });

  // THE ROUTE ACCUMULATORS — see `DistrictSelectionRoutes`. Flat typed arrays
  // with one row of `MAX_PICK_SLOTS` per team, allocated once and folded in the
  // same per-team pass the histograms are, so recording the route costs no
  // second loop over the roster and no per-draw allocation.
  //
  // `ROUTE_UNSET` and `ROUTE_MIXED` are sentinels rather than a parallel
  // occupancy array: every point value and every alliance number is
  // non-negative, so a negative entry cannot collide with a real one.
  const routeDraws = new Int32Array(teamCount * MAX_PICK_SLOTS);
  const routeMinPoints = new Int32Array(teamCount * MAX_PICK_SLOTS).fill(ROUTE_UNSET);
  const routeMaxPoints = new Int32Array(teamCount * MAX_PICK_SLOTS).fill(ROUTE_UNSET);
  const routeAlliance = new Int32Array(teamCount * MAX_PICK_SLOTS).fill(ROUTE_UNSET);
  const routeNotSelected = new Int32Array(teamCount);

  // The greedy-by-SPR pick order, computed ONCE: the draft consumes no
  // randomness and the ratings do not change between draws, so the order teams
  // are picked in is fixed. Ties on `total` break by team key, for the same
  // reproducibility reason `compareByAvgRpDesc` breaks its own.
  //
  // GREEDY BY PUBLISHED SPR MEAN is the selection model CONTEXT settles on.
  // `total` is the published SPR mean, never a band or a spread. The model's
  // agreement with real pick order is measured in 10-02 and stated on the
  // methodology page in 10-08.
  const pickOrder = baselines.map((_, i) => i);
  pickOrder.sort((a, b) => {
    const totalA = roster[a]!.total!;
    const totalB = roster[b]!.total!;
    if (totalA !== totalB) return totalB - totalA;
    const keyA = baselines[a]!.teamKey;
    const keyB = baselines[b]!.teamKey;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // The measured non-eight fallback's pmfs and point values, resolved once per
  // alliance number. `drawCategorical` takes a bare probability array, so the
  // two halves of each entry are split here rather than inside the draw loop.
  const fallbackProbabilities: number[][] = [];
  const fallbackPointValues: number[][] = [];
  if (!usesEightAllianceBracket && !elimIsKnown) {
    for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
      const pmf = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
      fallbackProbabilities.push(pmf.map((entry) => entry.probability));
      // The table stores BASE point values; the tier weight is applied here,
      // from the phase's single weight source.
      fallbackPointValues.push(pmf.map((entry) => entry.points * weight));
    }
  }

  const allied = new Uint8Array(teamCount);
  const allianceMemberIndices: number[][] = [];
  // Parallel to `allianceMemberIndices`: each member's PICK SLOT, which the
  // pricing roster reads to leave a backup robot out. Carried rather than read
  // off the array position, because a supplied alliance with a filler pick
  // skipped has real members whose array position is not their slot (quick
  // task 261007-4qr).
  const allianceMemberSlots: number[][] = [];
  const allianceRosters: AllianceMemberRating[][] = [];
  const allianceTeamKeys: string[][] = [];
  for (let n = 0; n < allianceCount; n++) {
    allianceMemberIndices.push([]);
    allianceMemberSlots.push([]);
    allianceRosters.push([]);
    allianceTeamKeys.push([]);
  }

  const qual = new Array<number>(teamCount).fill(0);
  const selection = new Array<number>(teamCount).fill(0);
  // THIS DRAW's route per team, beside the points: the pick slot the team
  // filled (`ROUTE_UNSET` for a team nobody took) and the alliance number that
  // took it (0 for a team nobody took). Written wherever `selection[teamI]` is
  // written and nowhere else, so the points and the route can never describe
  // two different drafts.
  const selectionSlot = new Int32Array(teamCount);
  const selectionAlliance = new Int32Array(teamCount);
  const elim = new Array<number>(teamCount).fill(0);
  const award = new Array<number>(teamCount).fill(0);
  const total = new Array<number>(teamCount).fill(0);
  const bracketSetIds: string[] = [];

  // The two draft cursors and their claim helpers live OUTSIDE the draw loop
  // and are reset in place at the top of each draw, so no closure is allocated
  // per draw. See the draft step for what each cursor means.
  let captainCursor = 0;
  let pickCursor = 0;
  let orderBuffer: readonly number[] = [];
  const claimNextByRank = (): number => {
    while (allied[orderBuffer[captainCursor]!] === 1) captainCursor++;
    const teamI = orderBuffer[captainCursor]!;
    allied[teamI] = 1;
    return teamI;
  };
  const claimNextByTotal = (): number => {
    while (allied[pickOrder[pickCursor]!] === 1) pickCursor++;
    const teamI = pickOrder[pickCursor]!;
    allied[teamI] = 1;
    return teamI;
  };

  // Two streams from one seed — see `LEDGER_STREAM_SALT`.
  const rankRng = mulberry32(seed);
  const rawLedgerRng = mulberry32(seed ^ LEDGER_STREAM_SALT);
  let ledgerDrawCount = 0;
  const ledgerRng = (): number => {
    ledgerDrawCount++;
    return rawLedgerRng();
  };

  /**
   * ONE award-field member's award points for one draw, at event scale: the
   * ONE copy of the three award paths, indexed over the AWARD FIELD (roster
   * index `i < teamCount`, then the award only teams). Every team, on the
   * schedule or not, is drawn by this function and no other.
   *
   * The path is chosen once per event before the loop — see
   * `AwardOrderingDisposition` for when and why — so every call in one run
   * takes the same branch.
   */
  const knownAwardPoints = input.knownAwardPoints;
  const assignments = orderingAssignments;
  const drawAwardPoints = (i: number): number => {
    if (knownAwardPoints !== undefined) {
      // AWARDS POSTED: nothing is drawn and no randomness is consumed. A team
      // absent from the map scores 0.
      return knownAwardPoints.get(awardField[i]!.teamKey) ?? 0;
    }
    if (assignments !== undefined) {
      // THE ORDERING PATH. Three consumptions per team, in this pinned order:
      // Impact, then Rookie All Star (only for a team that can win it), then the
      // residual. This path consumes MORE of the ledger stream per team than the
      // base-rate path below, so an event that switches between them produces a
      // different seeded output BY DESIGN — the two are different models, not
      // two spellings of one.
      const assignment = assignments[i]!;
      const impactWon = ledgerRng() < assignment.impactProbability;
      // No randomness for a team whose Rookie All Star chance is structurally
      // zero: a veteran cannot win it, and drawing-then-discarding would make
      // every later draw depend on the roster's rookie count for no reason.
      const rookieAllStarWon =
        assignment.rookieAllStarProbability > 0 ? ledgerRng() < assignment.rookieAllStarProbability : false;
      const residualIndex = drawCategorical(assignment.residualPmf, ledgerRng);
      // NEVER A STACK: the highest single award this draw produced, never the
      // sum of two. See `singleAwardPoints`.
      const composed = singleAwardPoints(impactWon, rookieAllStarWon, AWARD_POINT_SUPPORT[residualIndex]!) * weight;
      // THE CLAMP IS A BACKSTOP, kept rather than removed. `singleAwardPoints`
      // now bounds a base-scale draw at Impact's own 10, which is inside every
      // registered tier's award ceiling, so this branch is unreachable today —
      // and it is exactly the kind of unreachable that a later change to the
      // fold would quietly make reachable again. An out-of-range write to the
      // Int32Array accumulator below is a SILENT NO-OP that would drop that
      // draw's mass entirely, after which `chanceOfAnyPoints` reads a
      // confident percentage over an incomplete distribution. The ceiling is
      // `maxEventPoints`' own value for this event, never a literal.
      return composed > ceilings.award ? ceilings.award : composed;
    }
    const index = drawCategorical(awardPmfByTeam[i]!, ledgerRng);
    // The pmf was FOLDED once at lookup, so the two stacked bins carry no
    // mass at all and this draw can never land on one. `foldStackedAwardPoints`
    // is applied anyway, as the same backstop the clamp above is: a pmf that
    // stopped being folded would otherwise print a stacked award silently.
    return foldStackedAwardPoints(AWARD_POINT_SUPPORT[index]!) * weight;
  };

  let drawIndex = 0;

  simulateRanks(input.remainingMatches, baselines, draws, rankRng, (order) => {
    // THE DRAW BODY. The order below is pinned because it DEFINES the ledger
    // stream: the draft (no randomness), then the bracket, then the awards.
    // Changing it silently changes every seeded output.
    const ledgerDrawsBefore = ledgerDrawCount;
    bracketSetIds.length = 0;

    // 1. The finishing order, read IN PLACE from `simulateRanks`'s own reused
    //    buffer. Nothing is copied: every step below consumes it before this
    //    callback returns, which is exactly the contract `SimDrawHook` states.
    for (let rank = 0; rank < teamCount; rank++) {
      qual[order[rank]!] = qualPointsByRank[rank]!;
    }

    // 2. The draft. DETERMINISTIC given the ranking and the ratings — it
    //    consumes no randomness at all, because declines are not modelled.
    //    A reader will look for a decline draw; there is none, and the
    //    measured size of that omission is one captain slot in 3,880.
    for (let n = 0; n < allianceCount; n++) {
      allianceMemberIndices[n]!.length = 0;
      allianceMemberSlots[n]!.length = 0;
      allianceRosters[n]!.length = 0;
      allianceTeamKeys[n]!.length = 0;
    }
    for (let i = 0; i < teamCount; i++) {
      allied[i] = 0;
      selection[i] = 0;
      selectionSlot[i] = ROUTE_UNSET;
      selectionAlliance[i] = 0;
    }

    if (suppliedAlliances !== undefined) {
      // ALLIANCES ANNOUNCED: the draft does not run. Selection points come
      // from each team's REAL slot, and the bracket is seeded from the
      // supplied rosters rather than from a simulated draft.
      for (const alliance of suppliedAlliances) {
        const n = alliance.allianceNumber - 1;
        alliance.memberIndices.forEach((teamI, member) => {
          // TBA's OWN slot, never the member's position in the filtered list:
          // a filler pick skipped before it must not move it up a slot.
          const slot = alliance.memberSlots[member]!;
          allied[teamI] = 1;
          allianceMemberIndices[n]!.push(teamI);
          allianceMemberSlots[n]!.push(slot);
          selection[teamI] = selectionPointsBySlotAndAlliance[slot]![alliance.allianceNumber]!;
          selectionSlot[teamI] = slot;
          selectionAlliance[teamI] = alliance.allianceNumber;
        });
      }
    } else {
      // THE PROGRESSIVE CAPTAIN RULE. `captainCursor` walks the finishing order
      // and never rewinds, which is exactly the rule: at alliance n's turn the
      // captain is the highest-ranked team NOT YET ALLIED, and a team before the
      // cursor is always already allied. A precomputed top-eight captain list is
      // the WRONG rule — measured correct at 3 of 491 events.
      orderBuffer = order;
      captainCursor = 0;
      pickCursor = 0;

      // Both rounds run over the DRAFTED alliances only, 1 to k, where k is
      // every alliance at 24 teams or more. The seeds after k stay empty
      // filler alliances (quick task 261007-4qr; see `draftedAllianceCount`).
      // Round one: alliance 1 through k, captain then first pick.
      for (let allianceNumber = 1; allianceNumber <= draftedCount; allianceNumber++) {
        const n = allianceNumber - 1;
        const captain = claimNextByRank();
        allianceMemberIndices[n]!.push(captain);
        allianceMemberSlots[n]!.push(0);
        selection[captain] = selectionPointsBySlotAndAlliance[0]![allianceNumber]!;
        selectionSlot[captain] = 0;
        selectionAlliance[captain] = allianceNumber;
        const firstPick = claimNextByTotal();
        allianceMemberIndices[n]!.push(firstPick);
        allianceMemberSlots[n]!.push(1);
        selection[firstPick] = selectionPointsBySlotAndAlliance[1]![allianceNumber]!;
        selectionSlot[firstPick] = 1;
        selectionAlliance[firstPick] = allianceNumber;
      }
      // Round two: alliance k back down to 1. SERPENTINE, measured — see this
      // file's header for the second-pick rank gradient that proves it.
      for (let allianceNumber = draftedCount; allianceNumber >= 1; allianceNumber--) {
        const n = allianceNumber - 1;
        const secondPick = claimNextByTotal();
        allianceMemberIndices[n]!.push(secondPick);
        allianceMemberSlots[n]!.push(2);
        selection[secondPick] = selectionPointsBySlotAndAlliance[2]![allianceNumber]!;
        selectionSlot[secondPick] = 2;
        selectionAlliance[secondPick] = allianceNumber;
      }
    }

    for (let n = 0; n < allianceCount; n++) {
      const members = allianceMemberIndices[n]!;
      const slotsN = allianceMemberSlots[n]!;
      const rosterN = allianceRosters[n]!;
      const keysN = allianceTeamKeys[n]!;
      members.forEach((teamI, member) => {
        // A backup robot REPLACES a robot rather than adding one, so only the
        // first three picks enter the roster the pricer sees. Including a
        // fourth would inflate the alliance mean by a whole robot. The test
        // reads the member's PICK SLOT, not its array position, so a filler
        // pick skipped ahead of it cannot pull a backup into the roster.
        if (slotsN[member]! < DRAFTED_ALLIANCE_SIZE) rosterN.push(roster[teamI]!);
        keysN.push(baselines[teamI]!.teamKey);
      });
    }

    // 3. The playoffs.
    for (let i = 0; i < teamCount; i++) elim[i] = 0;
    if (input.knownElimPoints !== undefined) {
      // PLAYOFFS DONE: the bracket is NOT routed. Routing and discarding would
      // consume the ledger stream and silently change every later draw.
      const known = input.knownElimPoints;
      for (let i = 0; i < teamCount; i++) elim[i] = known.get(baselines[i]!.teamKey) ?? 0;
    } else if (usesEightAllianceBracket) {
      const routed = routeBracket((allianceA, allianceB, setId, matchNumber) => {
        bracketSetIds.push(setId);
        // A MATCH ALREADY PLAYED IS NOT PRICED. Its real winner is returned and
        // no randomness is consumed for it, which is what makes the cell's
        // milestone and its chance describe the same bracket. `routeBracket`
        // still checks the returned alliance is one of the set's two, so a
        // mis-mapped decision cannot slip through here either.
        const played = playedDecisions?.get(bracketDecisionKey(setId, matchNumber));
        if (played !== undefined) return played;
        // A FILLER ALLIANCE FORFEITS (quick task 261007-4qr). An alliance with
        // an empty pricing roster is filler, a short event's bottom seed or a
        // whole demo alliance. Against a real alliance it loses, which is the
        // measured outcome (real against whole demo alliances: 19 sets, 0 demo
        // wins); filler against filler goes to the lower alliance number, which
        // no real team's points can depend on, because a real alliance beats
        // whichever filler reaches it. Neither branch consumes randomness and
        // neither gives filler a rating.
        const fillerA = allianceRosters[allianceA - 1]!.length === 0;
        const fillerB = allianceRosters[allianceB - 1]!.length === 0;
        if (fillerA && fillerB) return allianceA < allianceB ? allianceA : allianceB;
        if (fillerA) return allianceB;
        if (fillerB) return allianceA;
        // The measured pricer is called with the ROSTER ARRAYS rather than a
        // cached mean-and-variance pair. The redundant additions are a few dozen
        // per draw, and reusing the ONE measured pricer is worth more than the
        // arithmetic. The final's matches are independent draws: there is no
        // within-series momentum in this model.
        return decideBracketMatch(
          allianceA,
          allianceB,
          allianceRosters[allianceA - 1]!,
          allianceRosters[allianceB - 1]!,
          setId,
          ledgerRng
        );
      });
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const placement = routed.placementByAlliance.get(allianceNumber)!;
        const points = playoffPoints(season, tier, placement);
        for (const teamI of allianceMemberIndices[allianceNumber - 1]!) elim[teamI] = points;
      }
    } else {
      // THE MEASURED NON-EIGHT FALLBACK — the divisioned district championship
      // parent, and never a fabricated bracket. See this file's header.
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const n = allianceNumber - 1;
        const index = drawCategorical(fallbackProbabilities[n]!, ledgerRng);
        const points = fallbackPointValues[n]![index]!;
        for (const teamI of allianceMemberIndices[n]!) elim[teamI] = points;
      }
    }

    // 4. The awards, drawn per team in `baselines` order so the stream is
    //    pinned. INDEPENDENT of the on-field outcome: `awardBaseRates.ts`
    //    covers JUDGED awards only (Winner, Finalist and Highest Rookie Seed
    //    are excluded there), which makes independence a defensible modelling
    //    choice rather than a convenience — and a stated limitation for 10-08.
    //
    //    THREE PATHS, and exactly one runs: posted (nothing drawn), the
    //    ORDERING path, or the base-rate path. See `drawAwardPoints` above.
    for (let i = 0; i < teamCount; i++) award[i] = drawAwardPoints(i);

    // 4b. The AWARD ONLY TEAMS, drawn AFTER every roster team so the roster's
    //     stream consumption is exactly what it is with none (quick task
    //     260927-vmb). Their event total IS their award: they have no match to
    //     play, so the other three categories are zero by construction.
    for (let j = teamCount; j < awardFieldCount; j++) {
      const points = drawAwardPoints(j);
      awardOnlyAwardByIndex[j - teamCount]![points]! += 1;
      awardOnlyTotalByIndex[j - teamCount]![points]! += 1;
    }

    // 5. Accumulate. Every histogram is a marginal of THESE runs, and the
    //    per-draw quadruple sums to this draw's event total by construction.
    for (let i = 0; i < teamCount; i++) {
      const sum = qual[i]! + selection[i]! + elim[i]! + award[i]!;
      total[i] = sum;
      qualByIndex[i]![qual[i]!]! += 1;
      selectionByIndex[i]![selection[i]!]! += 1;
      elimByIndex[i]![elim[i]!]! += 1;
      awardByIndex[i]![award[i]!]! += 1;
      totalByIndex[i]![sum]! += 1;

      // The route, folded in the same pass and from the same draw's buffers, so
      // a team's route counts and its selection histogram are marginals of one
      // set of runs by construction rather than by agreement.
      const slot = selectionSlot[i]!;
      if (slot === ROUTE_UNSET) {
        routeNotSelected[i]! += 1;
      } else {
        const at = i * MAX_PICK_SLOTS + slot;
        routeDraws[at]! += 1;
        const points = selection[i]!;
        if (routeMinPoints[at]! === ROUTE_UNSET || points < routeMinPoints[at]!) routeMinPoints[at] = points;
        if (routeMaxPoints[at]! === ROUTE_UNSET || points > routeMaxPoints[at]!) routeMaxPoints[at] = points;
        const allianceNumber = selectionAlliance[i]!;
        if (routeAlliance[at]! === ROUTE_UNSET) routeAlliance[at] = allianceNumber;
        else if (routeAlliance[at]! !== allianceNumber) routeAlliance[at] = ROUTE_MIXED;
      }
    }

    if (observer !== undefined) {
      observer({
        draw: drawIndex,
        order,
        alliances: allianceTeamKeys,
        qual,
        selection,
        elim,
        award,
        total,
        bracketSetIds,
        ledgerDraws: ledgerDrawCount - ledgerDrawsBefore,
      });
    }
    drawIndex++;
  });

  // The route accumulators, turned into the per-team observation objects ONCE,
  // after the last draw. A slot no draw took still reports its possible range,
  // so a caller never has to know this module's point model to render a route
  // the runs did not produce.
  const selectionRoutes = new Map<string, DistrictSelectionRoutes>();
  for (let i = 0; i < teamCount; i++) {
    const bySlot: DistrictSelectionRouteObservation[] = [];
    for (let slot = 0; slot < MAX_PICK_SLOTS; slot++) {
      const at = i * MAX_PICK_SLOTS + slot;
      const possible = possiblePointsBySlot[slot]!;
      const alliance = routeAlliance[at]!;
      bySlot.push({
        draws: routeDraws[at]!,
        minPoints: routeMinPoints[at]! === ROUTE_UNSET ? undefined : routeMinPoints[at]!,
        maxPoints: routeMaxPoints[at]! === ROUTE_UNSET ? undefined : routeMaxPoints[at]!,
        allianceNumber: alliance === ROUTE_UNSET || alliance === ROUTE_MIXED ? undefined : alliance,
        possibleMinPoints: possible.low,
        possibleMaxPoints: possible.high,
      });
    }
    selectionRoutes.set(baselines[i]!.teamKey, { bySlot, notSelectedDraws: routeNotSelected[i]! });
  }

  return {
    eventKey,
    draws,
    qualPoints: qualHistograms,
    selectionPoints: selectionHistograms,
    elimPoints: elimHistograms,
    awardPoints: awardHistograms,
    eventTotal: totalHistograms,
    awardSources,
    awardOrdering,
    playoffMilestones,
    selectionRoutes,
    // `remainingMatches.length === 0` is this module's own expression of a
    // finished qualification stage; forwarded, never re-derived.
    rankingFixed: input.remainingMatches.length === 0,
    // Present ONLY for a non-empty list, so a run without one is deep equal to
    // the shipped result.
    ...(awardOnlyKeys.length > 0 ? { awardOnlyTeams: [...awardOnlyKeys] } : {}),
  };
}

interface ResolvedSuppliedAlliance {
  readonly allianceNumber: number;
  /** The REAL members' roster indices, in pick order. A filler pick is skipped, so this can be shorter than TBA's `picks`. */
  readonly memberIndices: readonly number[];
  /**
   * Parallel to `memberIndices`: each real member's index in TBA's `picks`
   * array, which is its pick slot (0 captain, 1 first, 2 second, 3 backup).
   * Carried rather than re-derived from the array position, so a demo key
   * skipped as filler never shifts a later real member onto the wrong slot
   * (quick task 261007-4qr).
   */
  readonly memberSlots: readonly number[];
}

/**
 * Validates a SUPPLIED alliance set rather than trusting it, collecting EVERY
 * problem before throwing so one run tells a caller everything that is wrong.
 * See `InvalidAllianceSetError` for why this exists at all.
 */
function validateSuppliedAlliances(
  input: DistrictLedgerEventInput,
  teamIndex: ReadonlyMap<string, number>,
  allianceCount: number
): readonly ResolvedSuppliedAlliance[] | undefined {
  const supplied = input.knownAlliances;
  if (supplied === undefined) return undefined;

  const problems: string[] = [];
  const seenNumbers = new Set<number>();
  const allianceOfTeam = new Map<string, number>();
  const resolved: ResolvedSuppliedAlliance[] = [];

  for (const alliance of supplied) {
    const n = alliance.allianceNumber;
    if (!Number.isInteger(n) || n < 1 || n > allianceCount) {
      problems.push(`alliance number ${n} is outside 1 through ${allianceCount}`);
      continue;
    }
    if (seenNumbers.has(n)) {
      problems.push(`alliance number ${n} appears more than once`);
      continue;
    }
    seenNumbers.add(n);
    if (alliance.picks.length === 0) {
      problems.push(`alliance ${n} carries an empty pick list`);
      continue;
    }
    if (alliance.picks.length > MAX_PICK_SLOTS) {
      problems.push(`alliance ${n} carries ${alliance.picks.length} picks, above TBA's own maximum of ${MAX_PICK_SLOTS}`);
      continue;
    }
    const memberIndices: number[] = [];
    const memberSlots: number[] = [];
    for (let slot = 0; slot < alliance.picks.length; slot++) {
      const key = alliance.picks[slot]!;
      const index = teamIndex.get(key);
      if (index === undefined) {
        // A DEMO ROBOT OFF THE ROSTER IS FILLER (quick task 261007-4qr): a short
        // event seats whole demo alliances at its bottom seeds, and those robots
        // played no qualification match. It is skipped as a member, earns
        // nothing and reaches no output. Any OTHER absent key is still a named
        // problem, so a mis-keyed real team is never silently absorbed.
        if (isDemoTeamKey(key)) continue;
        problems.push(`alliance ${n} names team ${key}, which is absent from the roster`);
        continue;
      }
      const priorAlliance = allianceOfTeam.get(key);
      if (priorAlliance !== undefined) {
        problems.push(`team ${key} appears on alliance ${priorAlliance} and alliance ${n}`);
        continue;
      }
      allianceOfTeam.set(key, n);
      memberIndices.push(index);
      memberSlots.push(slot);
    }
    resolved.push({ allianceNumber: n, memberIndices, memberSlots });
  }

  for (let n = 1; n <= allianceCount; n++) {
    if (!seenNumbers.has(n)) problems.push(`alliance number ${n} is missing from the supplied set`);
  }

  if (problems.length > 0) {
    throw new InvalidAllianceSetError(
      `event ${input.eventKey}: the supplied alliance set is malformed — ${problems.join("; ")}`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// The grand total, and the publish-boundary encoder
// ---------------------------------------------------------------------------

/** One event's total-point distribution as an input to the grand-total convolution. */
export interface DistrictEventTotalInput {
  /** Index `i` is the count, or probability, of exactly `i` points — the same offset-zero contract `DistrictLedgerResult` states. */
  readonly counts: ArrayLike<number>;
  /** What `counts` sums to: the draw count for a live histogram, or 1 for a baked pmf. */
  readonly denominator: number;
}

/**
 * The EXACT convolution of a team's event totals plus its rookie bonus and
 * adjustments, returned as a `Float64Array` whose index is again the point
 * value at offset zero.
 *
 * EXACT, AND THE PRECISE SCOPE OF THAT CLAIM. The convolution is exact because
 * a team's events share no matches, so no match's outcome appears in two of
 * the distributions — the sketch README's own reasoning. The half the README
 * does NOT say, and the half a later reader has to be told rather than left to
 * discover: the model holds the team's SPR rating FIXED across its events
 * rather than resampling it, so the events are independent CONDITIONAL on that
 * rating. A team whose true strength is genuinely uncertain has correlated
 * event totals in reality, and this convolution does not carry that
 * correlation. An honest limitation stated here is worth more than an
 * unqualified "exact" a reader has to find the edge of.
 *
 * A team plays 0 TO 4 district events, not two: counting `event_points_raw`
 * array lengths over all 16,345 corpus `district_rankings` rows gives 708 rows
 * at zero events, 1,334 at one, 7,858 at two, 6,200 at three and 245 at four.
 * ZERO EVENTS IS A REAL STATE, not an error — it returns a point mass at the
 * combined shift.
 *
 * THERE IS DELIBERATELY NO PUBLISH-BOUNDARY ENCODER FOR THIS VALUE.
 * `district_rankings.point_total` reaches 445 in the corpus while 10-03's
 * `DistrictPointPmfSchema` caps a pmf at 256 entries, on the stated basis that
 * a dcmp-tier EVENT total spans 0 to 249. The grand total is computed in the
 * browser and is never a published field, so the absence is the mitigation.
 */
export function convolveDistrictGrandTotal(
  eventTotals: readonly DistrictEventTotalInput[],
  rookieBonus: number,
  adjustments: number
): Float64Array {
  if (!Number.isInteger(rookieBonus)) {
    throw new NegativeDistrictShiftError(`rookieBonus must be an integer, got ${rookieBonus}`);
  }
  if (!Number.isInteger(adjustments)) {
    throw new NegativeDistrictShiftError(`adjustments must be an integer, got ${adjustments}`);
  }
  const shift = rookieBonus + adjustments;
  if (shift < 0) {
    // `adjustments` is 0 in every one of the 16,345 corpus `district_rankings`
    // rows — minimum 0, maximum 0, zero negative rows — so a negative shift has
    // never been observed. Clamping one to zero would be a FABRICATED value
    // rather than a fallback, which is why this throws.
    throw new NegativeDistrictShiftError(
      `rookieBonus ${rookieBonus} plus adjustments ${adjustments} gives a combined shift of ${shift}, below zero — refusing to clamp a never-observed negative shift into a fabricated value`
    );
  }

  let current = new Float64Array(1);
  current[0] = 1;
  for (const eventTotal of eventTotals) {
    const { counts, denominator } = eventTotal;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      throw new NegativeDistrictShiftError(`an event total carries a non-positive or non-finite denominator (${denominator})`);
    }
    if (counts.length === 0) {
      throw new NegativeDistrictShiftError("an event total carries an empty distribution");
    }
    const next = new Float64Array(current.length + counts.length - 1);
    for (let i = 0; i < current.length; i++) {
      const left = current[i]!;
      if (left === 0) continue;
      for (let j = 0; j < counts.length; j++) {
        const right = counts[j]!;
        if (right === 0) continue;
        next[i + j]! += left * (right / denominator);
      }
    }
    current = next;
  }

  if (shift === 0) return current;
  const shifted = new Float64Array(current.length + shift);
  shifted.set(current, shift);
  return shifted;
}

/** 10-03's offset encoding: `p[i]` is the probability of exactly `offset + i` points. */
export interface DistrictPointPmfEncoding {
  readonly offset: number;
  readonly p: readonly number[];
}

/**
 * Encodes ONE EVENT-LEVEL histogram into 10-03's offset encoding: leading
 * zeros become the offset, trailing zeros are trimmed off the array, and entry
 * `i` is the probability of exactly `offset + i` points — matching
 * `DistrictPointPmfSchema`'s own contract.
 *
 * THE PRODUCER MUST PASS `p` THROUGH `packages/harness/rounding.ts`'s
 * `roundPmf` at the publish boundary. This module deliberately does not import
 * it: this is a `packages/core` leaf and `rounding.ts` is a `packages/harness`
 * module, and the sum-to-1 tolerance belongs to the schema rather than to a
 * producer. That is exactly the division of responsibility `rankSimulation.ts`
 * states for `isValidPmf` — duplicating a numeric tolerance in two places is
 * how two tolerances drift apart.
 *
 * EVENT LEVEL ONLY. See `convolveDistrictGrandTotal` for why no grand-total
 * encoder exists.
 */
export function encodeDistrictPointPmf(histogram: ArrayLike<number>, draws: number): DistrictPointPmfEncoding {
  if (!Number.isFinite(draws) || draws <= 0) {
    throw new EmptyHistogramError(`draws must be a positive finite number, got ${draws}`);
  }
  let first = -1;
  let last = -1;
  for (let i = 0; i < histogram.length; i++) {
    const value = histogram[i]!;
    if (value === 0) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) {
    throw new EmptyHistogramError("the histogram carries no mass at all — refusing to encode an empty distribution");
  }
  const p: number[] = [];
  for (let i = first; i <= last; i++) p.push(histogram[i]! / draws);
  return { offset: first, p };
}
