/**
 * The five statuses at one position, in Jacob's own words.
 *
 * ONE PURE MODULE, no React. It imports `packages/core/districts/locks.ts`,
 * `qualification.ts` and `reservedSlots.ts` and defines no status rule of its
 * own. (10-07's original "no file under `packages/` is touched" note no longer
 * holds: quick task 260925-ms7 added the `reservedSlots` argument to
 * `locks.ts` and the counting rule to `reservedSlots.ts`, because the offline
 * publisher and the Worker need the same reservation this tab needs.)
 *
 * ONE SLOT IS HELD BACK PER IMPACT AWARD STILL TO COME. See
 * `reservedSlotsAtPosition` below and `packages/core/districts/reservedSlots.ts`
 * for the rule; the short version is that until an event's Impact award is
 * posted, its slot must not sit in the points pool, or a team on the knife
 * edge reads `Locked` one step before the award takes the slot away.
 *
 * THERE ARE TWO WAYS TO READ `Locked`, and this module asks for both at every
 * position (quick task 260925-pl6). The shipped ceiling test locks a team no
 * single rival can reach. The POOLED test locks a team no achievable
 * distribution of the district's remaining points can unseat: points are
 * conserved inside an event, so what the whole district still has to hand out
 * is far less than the sum of every rival's ceiling.
 * `packages/core/districts/pooledLockInputs.ts` turns the SAME per-row
 * finalities the floor and ceiling below are derived from into that pool, so
 * the two halves of a position can never describe different positions, and
 * `locks.ts` ORs the two tests. Nothing else moves: `Locked out` and the In
 * range line are untouched, and at a position where every category is final the
 * pool is zero and the pooled test locks exactly whom the ceiling test already
 * did.
 *
 * WHERE EACH STATUS COMES FROM:
 *
 * - Prequalified, Locked, Locked out and the capacity-not-published state come
 *   from the SHIPPED `computeLocksWithQualifiers`, recomputed at the position.
 * - In range and Out of range come from a SECOND call to the shipped
 *   `cutLinePointsWithQualifiers`, on inputs whose `pointTotal` is each team's
 *   median projected grand total and whose `maxRemaining` is 0.
 *
 * WHY THAT SECOND CALL IS THE RIGHT INSTRUMENT AND NOT A TRICK, stated in full
 * because a reader will otherwise wonder: `cutLinePointsWithQualifiers` is the
 * shipped, exported function whose own doc comment says it shares
 * `qualifierPool`'s exact pool and slot derivation with
 * `computeLocksWithQualifiers` so the two can never disagree — and the past bug
 * that comment names (a published cut line naming a team the verdicts had
 * already marked eliminated) is precisely the class of bug a hand-rolled slot
 * subtraction in the browser would reintroduce. Passing a median projection as
 * a `pointTotal` with a zero `maxRemaining` asks that function "what is the
 * slot-th highest value in the narrowed pool" over a DIFFERENT quantity, which
 * is exactly the projection cut line CONTEXT's In range definition needs.
 *
 * THAT IS THE VERDICT LEVEL RULE, AND NOT ALWAYS WHAT THE TAB SHOWS (quick
 * task 261004-uw4; the same split `champLedgerStatus.ts` documents as its
 * decision 3). The In range and Out of range this module returns are what the
 * rest of the tab and the advancement chance run read. What the District tab
 * SHOWS while anything is still open is cut at the simulated line by
 * `applyLedgerRangeState` in `ledgerRangeState.ts`: at or above the median of
 * the per run line is In range, and while that line is pending or cannot be
 * drawn the two chips read Pending or No call. The median rule above stands,
 * as shown, where every pool team is settled, and where a chance run landed
 * but left a team out. Prequalified, Locked and Locked out are never touched
 * by any of that.
 *
 * A TEAM KNOCKED OUT OF THE PLAYOFFS HAS ITS PLAYOFF POINTS SETTLED AT ONCE
 * (quick task 261008-26o). The settled set comes from the row builder
 * (`row.settledElim`, from `settledPlayoffPoints`), never from a second reading
 * of the bracket here; `districtLockBounds` puts TBA's exact number in the
 * floor and a placement table value in the ceiling only, in place of the
 * whole Playoffs ceiling. The award ceiling and the Impact reservation are
 * unchanged. The exact settled points this module puts in floors are summed
 * per event and handed to `pooledLockInputs`, which takes them off that
 * event's playoff pool (quick task 261009-uhb). Counting them in floors and
 * in the pool at once withdrew pooled locks at later playoff rounds: a team
 * shown Locked at Alliances final read In range at Round 4 or Round 5. A
 * settled value that is not exact is in no floor and nets nothing.
 *
 * THE SECURED PLAYOFF MINIMUM (quick task 261012-mw2). Jacob, 2026-10-12:
 * "any team in the bracket should be credited with the points that they
 * essentially have already earned, given the matches they have played."
 * Until this task a team's playoffs counted for nothing in its floor until
 * its alliance was knocked out: being knocked out raised a floor and staying
 * in the bracket did not.
 *
 * WHAT JOINS A FLOOR. A row may carry `securedElim`, the least playoff points
 * TBA's pay rule can still pay that robot at that event
 * (`packages/core/districts/securedPlayoffPoints.ts` states the rule, where
 * it was read and what it was measured against). `districtLockBounds` sends
 * every OPEN Playoffs category through the rows module's `openPlayoffBounds`:
 * the secured minimum is the floor and the rest of the most the category can
 * pay is the open ceiling. NO CEILING MOVES while the category is open: what
 * joins the floor leaves the open ceiling, so floor plus open ceiling is what
 * it was. An exact settled value reads the larger of TBA's number and the
 * secured minimum; a settled value that is not exact keeps its placement's
 * ceiling, with the secured minimum taken out of it and put in the floor.
 *
 * THE POOL IS NETTED BY THE SAME AMOUNT. Every point an event's rows hold in
 * floors while its Playoffs are open, settled or secured, is summed per event
 * and handed to `pooledLockInputs`, which takes it off that event's playoff
 * pool, exactly as quick task 261009-uhb did for the settled points alone.
 * The reason is the same: a point that sits in a rival's floor is not also
 * still to be handed out, and counting it twice would let the pooled test
 * lock a team at one stop and lose it at the next. It is netted once: where
 * an exact settled value and a secured minimum stand on one row, the larger
 * of the two is what the floor holds and what leaves the pool.
 *
 * THE LARGER OF THE TWO at a FINAL category. Where a Playoffs category reads
 * final at the position, the floor is the larger of TBA's posted number and
 * the secured minimum (`securedBeyondPosted` is the part above the number).
 * The orchestrator's decision of 2026-10-12: the credit already claims TBA
 * will pay at least that much, so keeping it beside the number adds no
 * assumption, and it removes the reliance on WHEN the playoff points post.
 * Wherever the number is the real final number it is at or above the secured
 * minimum (the corpus gate: 0 of 222,863 secured minimums above the final
 * payment) and nothing moves. The open ceiling does not move there either.
 * WHERE IT STOPS: it applies wherever a row carries a secured minimum, and a
 * row carries one only where the caller of the rows builder holds that
 * event's played rows. For an event whose rows the caller does not hold, the
 * floor of a final Playoffs category is TBA's number alone, as before.
 *
 * IT IS A BOUNDED USE OF THE FIELD, READ THROUGH THE ROWS MODULE. This module
 * reads no match row: it reads `securedElim` off a row and nothing else, and
 * a caller of the rows builder supplies it from an event's played rows
 * (`districtLedgerRows.ts`, THE SECURED PLAYOFF MINIMUM). At this commit the
 * sweep `scripts/measureLedgerSettledTenets.ts` supplies it and the Locks
 * tabs' hook does not yet. WHAT IT RESTS ON: the pay rule is TBA's and not
 * ours, read from TBA's public source and fitted to four seasons of paid
 * values, and this code does not control it; the rows are read as posted, so
 * if a playoff result is corrected after it was posted a secured minimum can
 * fall, and a Locked that rested on it could be withdrawn.
 *
 * WHAT IT MOVED, as this task executed it. Over the 418 district tier events
 * and 2,926 stops of 2023 to 2026, against the code of before this task:
 * Locked on points 37,484 to 38,771, which is 1,287 team stops gained (637 by
 * the pooled test alone, 650 by the ceiling test) and 0 LOST, at Round 2 to
 * Round 5 (226, 325, 389 and 347). Locked out 83,235 to 83,667, 0 lost. The
 * earned figure a row prints, with the rookie bonus and the adjustments, is
 * this module's floor at 676,354 of 676,354 team stops (it differed at
 * 3,735, the settled playoff points the header used to leave out).
 *
 * THE DATA WORD `eliminated` IS NEVER PRINTED (the sketch's language rules),
 * and neither is the champ tab's sixth verdict word for `contending`. Note
 * carefully that the shipped champ tab's own label for `eliminated` reads as
 * this tab's "Out of range" — a DIFFERENT status entirely, which is exactly why
 * the district tier needed its own vocabulary.
 */
import {
  computeLocksWithQualifiers,
  cutLinePointsWithQualifiers,
  type LockResult,
  type LockStatus,
  type LockTeamInput,
  type QualifierSets,
} from "../../../../../packages/core/districts/locks.js";
import { consumingAwardTypesForTier, eventTierByKey } from "../../../../../packages/core/districts/qualification.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { reservedImpactSlots, type ReservedSlotEvent } from "../../../../../packages/core/districts/reservedSlots.js";
import { pooledLockInputs, type PooledTeamEntry } from "../../../../../packages/core/districts/pooledLockInputs.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  DISTRICT_CATEGORIES,
  districtTierEvents,
  openPlayoffBounds,
  securedBeyondPosted,
  type DistrictLedgerEventRow,
  type DistrictLedgerTeam,
} from "./districtLedgerRows.js";

/** The five chip keys, plus the honest capacity-not-published state that renders as plain text with NO chip. */
export const DISTRICT_LEDGER_STATUS_KEYS = ["prequalified", "locked", "inRange", "outOfRange", "lockedOut"] as const;

export type DistrictLedgerStatusKey = (typeof DISTRICT_LEDGER_STATUS_KEYS)[number];

/** Every state a team can render in, including the one that carries no chip. */
export type DistrictLedgerStatusState = DistrictLedgerStatusKey | "capacityUnknown";

export interface DistrictLedgerStatusResult {
  readonly teamKey: string;
  readonly status: DistrictLedgerStatusState;
  /** True when an AWARD is the reason a team is Locked — the "Locked · award" variant, a note on one status rather than a second status. */
  readonly byAward: boolean;
  /**
   * The raw `locks.ts` verdict this status was mapped from: the GUARANTEE, on
   * the district tier floor (`districtLockBounds`). Since quick task
   * 261007-il9 the artifact's own `districtLock.status` ranks the same
   * district tier total, and since quick task 261007-jvz both resolve an
   * award's tier from the same artifact derived map (`eventTierByKey`). The
   * two differ only where the publisher's corpus tier names an event no team
   * carries a row for; measured 2026-10-07 over the 109 local seasons, no such
   * team exists.
   */
  readonly verdict: LockStatus;
  /**
   * Which of the two points arguments proved a `Locked` verdict, straight off
   * `locks.ts`. `"pooled"` means the ceiling test did NOT reach this team and
   * the district's conserved remaining points did — the population quick task
   * 260925-pl6 exists to create, and what `scripts/measureLedgerTenets.ts`
   * counts. `null` for every status that is not `Locked` on points.
   */
  readonly lockedBy: LockResult["lockedBy"];
}

export interface DistrictLedgerStatusModel {
  readonly byTeam: ReadonlyMap<string, DistrictLedgerStatusResult>;
  /**
   * The CHIP counts, computed over the WHOLE district and never over the
   * filtered view. `locked` is `locked` PLUS `lockedAward`, because the chip
   * says "Locked" for both — a test that compares this number against
   * `insights.districtLockedCount` is testing the wrong number, since that
   * field counts the `locked` verdict alone.
   */
  readonly counts: Readonly<Record<DistrictLedgerStatusKey, number>>;
  /**
   * The raw six-status `locks.ts` census on the district tier floor. It is the
   * same COUNT `insights.districtLockedCount`/`districtEliminatedCount` take.
   * Since quick task 261007-il9 the publisher's census ranks the same district
   * tier total, and since quick task 261007-jvz both read one award rule. The
   * two differ only where the publisher's corpus tier names an event no team
   * carries a row for; measured 2026-10-07 over the 109 local seasons, no such
   * team exists.
   */
  readonly verdictCensus: Readonly<Record<LockStatus, number>>;
  /** The slot-th highest MEDIAN PROJECTION in the narrowed pool — the In range boundary. `null` for an unpublished capacity. */
  readonly projectionCutLine: number | null;
  /**
   * The CONSUMING award qualifiers at this position, sorted — the exact set
   * handed to `computeLocksWithQualifiers` above.
   *
   * Exposed for the advancement chance (quick task 260925-rpj), which ranks
   * drawn season totals against `locks.ts`'s own narrowed pool and slot count
   * and must be handed the same set the verdicts were. Deriving it a second
   * time from the artifact is exactly how a printed chance would come to
   * contradict the chip beside it.
   */
  readonly awardQualified: readonly string[];
  /**
   * Always EMPTY at this tier — there is no prequalification concept at the
   * district/DCMP tier at all. Exposed anyway, so a consumer never has to
   * assume that rule holds and never has to hardcode an empty set of its own.
   */
  readonly prequalified: readonly string[];
  /** How many slots were HELD BACK at this position for Impact awards still to come — see `reservedSlotsAtPosition`. Zero at a position where every district-tier event has posted its awards. */
  readonly reservedSlots: number;
  /**
   * How many district points the whole district still has to hand out at this
   * position — the pooled lock's own input. Zero at a position where every
   * district-tier category is final, which is what makes a finished season's
   * verdicts identical with and without the pooled argument. At a playoff
   * round stop it is already net of the exact settled playoff points counted
   * in team floors (quick task 261009-uhb).
   */
  readonly pooledRemainingPoints: number;
}

export interface ComputeDistrictLedgerStatusesOptions {
  readonly artifact: DistrictArtifact;
  /** The rows `districtLedgerRows.ts` produced AT THIS POSITION, in its own sorted order — this module computes no second ordering. */
  readonly teams: readonly DistrictLedgerTeam[];
}

const EMPTY_CENSUS: Record<LockStatus, number> = {
  locked: 0,
  lockedAward: 0,
  prequalified: 0,
  eliminated: 0,
  contending: 0,
  unknown: 0,
};

/**
 * How many points slots are HELD BACK at this position, one per district-tier
 * event whose Impact award is still to come.
 *
 * TWO SOURCES, DELIBERATELY. The award's finality is read at the POSITION,
 * from the rows `districtLedgerRows.ts` already built (so the rewind slider
 * moving an event's awards back to open turns that event from consuming a
 * slot into reserving one, in the same step). Whether the event can still hand
 * an award out is read at `now`, from the artifact's own `state` blocks: an
 * event that will never happen is a fact about the world, not about the
 * slider.
 *
 * FIRST ROW SEEN WINS per event, matching `DistrictLedger.tsx`'s own
 * `nowStageByEvent` memo — every team's row for one event carries the same
 * event state and the same position override, so the choice cannot matter
 * except for an artifact whose rows disagree, and then the component's answer
 * is the one to reproduce.
 *
 * `packages/core/districts/reservedSlots.ts` owns the rule, including the
 * cancelled-event carve out; this function owns only the two lookups, and the
 * award finality lookup is `awardFinalByEventAtPosition` below, which the
 * consuming award set reads too.
 */
export function reservedSlotsAtPosition(artifact: DistrictArtifact, teams: readonly DistrictLedgerTeam[]): number {
  const awardFinalByEvent = awardFinalByEventAtPosition(artifact, teams);

  const events: ReservedSlotEvent[] = [];
  const seen = new Set<string>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (seen.has(entry.eventKey)) continue;
      seen.add(entry.eventKey);
      events.push({
        eventKey: entry.eventKey,
        stateAtNow: entry.state,
        // An event no row was built for cannot be reasoned about from the
        // rows, so its own `state` answers at `now` — which is what every
        // position outside the rewind reads anyway.
        awardFinalAtPosition: awardFinalByEvent.get(entry.eventKey) ?? entry.state?.awardsPosted === true,
      });
    }
  }

  return reservedImpactSlots(events);
}

/**
 * Whether each district-tier event's AWARD category is final at this position,
 * DISTRICT WIDE: one map both the slot reservation above and the consuming
 * award set in `computeDistrictLedgerStatuses` read, so an event either
 * consumes a slot (its award final, the winner award qualified) or reserves one
 * (its award open), never both (quick task 261007-jvz).
 *
 * The two lookups are the ones `reservedSlotsAtPosition` has always made. FIRST
 * ROW SEEN WINS across every team's built rows, which carry the stage at the
 * position (the rewind slider reopening an event's awards reaches here). An
 * event no built row names answers from the first artifact entry's own
 * `state.awardsPosted`, which is what every position outside the rewind reads.
 */
export function awardFinalByEventAtPosition(artifact: DistrictArtifact, teams: readonly DistrictLedgerTeam[]): Map<string, boolean> {
  const awardFinalByEvent = new Map<string, boolean>();
  for (const team of teams) {
    for (const row of team.rows) {
      if (!awardFinalByEvent.has(row.eventKey)) awardFinalByEvent.set(row.eventKey, row.stage.final.award);
    }
  }
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (!awardFinalByEvent.has(entry.eventKey)) awardFinalByEvent.set(entry.eventKey, entry.state?.awardsPosted === true);
    }
  }
  return awardFinalByEvent;
}

/** One district-tier category's ceiling per event, as `maxEventPoints(season, "district")` publishes it. */
export type DistrictCategoryCeilings = Readonly<Record<(typeof DISTRICT_CATEGORIES)[number], number>>;

/** One team's two lock inputs at a position: what it is certain to hold, and how much more its open categories could add. */
export interface DistrictLockBounds {
  readonly floor: number;
  readonly openCeiling: number;
}

/**
 * THE ONE PLACE THE DISTRICT TAB'S FLOOR AND OPEN CEILING ARE DERIVED (quick
 * task 261005-04t, D-01).
 *
 * THE FLOOR HOLDS DISTRICT TIER POINTS ONLY. `pointTotal` is TBA's ALL TIER
 * total, so a team's District Championship points sit inside it once the
 * championship has been played. The road to the championship cannot be paved
 * with points earned AT the championship, so every `eventPoints` entry whose
 * tier is not `"district"` leaves the floor first. Before that subtraction
 * existed, a rewound week one view called a team Locked on points it earned two
 * months later.
 *
 * STILL DERIVED BY SUBTRACTION from `pointTotal`, never by re-summing the four
 * categories: `pointTotal` carries the rookie bonus, the adjustments and TBA's
 * own arithmetic, and a re-sum would silently drop all three.
 *
 * Then the position: every category that is NOT final in a row's stage takes
 * its earned points out of the floor and puts its ceiling into `openCeiling`.
 * A wholly unstarted event contributes all four ceilings, which equals its own
 * `remainingEvents.maxPoints`. With no rows the floor is the team's whole
 * district tier total and the ceiling is zero.
 *
 * ONE EXCEPTION, A SETTLED PLAYOFFS CATEGORY (quick task 261008-26o). A row
 * carrying `settledElim` has its Playoffs category open in its stage but its
 * alliance's placement decided. Its earned `elim` (0 where TBA has no row)
 * still leaves the floor, and `settledElimBounds` replaces the whole Playoffs
 * ceiling. Rewound over a finished event the settled value IS TBA's `elim`, so
 * it rejoins the floor, the two cancel, and no ceiling is added. Live mid
 * playoffs it is the decided placement's value, which TBA can prorate down
 * for a team that sat out part of the playoffs, so it is added to the CEILING
 * only: the team's floor gains nothing, and its ceiling falls from the whole
 * Playoffs ceiling to the most it can still be paid.
 *
 * AND THE SECURED MINIMUM (quick task 261012-mw2). Every open Playoffs
 * category, settled or not, now goes through the rows module's
 * `openPlayoffBounds`, which is the rule of before wherever the row carries
 * no `securedElim`. Where it carries one, that much of the most the category
 * can pay is in the floor and the rest is the open ceiling, so floor plus
 * open ceiling does not move; beside an exact settled value the larger of
 * the two is the floor. A Playoffs category that is FINAL adds
 * `securedBeyondPosted`: what the secured minimum holds beyond TBA's number,
 * which is 0 wherever that number is the real final number.
 */
export function districtLockBounds(
  source: DistrictArtifact["teams"][number],
  rows: readonly DistrictLedgerEventRow[],
  ceilings: DistrictCategoryCeilings
): DistrictLockBounds {
  let floor = source.pointTotal;
  for (const entry of source.eventPoints) {
    if (entry.tier !== "district") floor -= entry.total;
  }

  let openCeiling = 0;
  for (const row of rows) {
    for (const category of DISTRICT_CATEGORIES) {
      if (row.stage.final[category]) {
        // THE LARGER OF THE TWO (quick task 261012-mw2): a final Playoffs category counts TBA's number, which is
        // already in the floor, and what the secured minimum holds beyond it.
        if (category === "elim") floor += securedBeyondPosted(row);
        continue;
      }
      // Reopened (or never earned): this category's earned points leave the
      // floor and its ceiling joins the ceiling.
      if (row.earned !== undefined) floor -= row.earned[category];
      if (category === "elim") {
        // An open Playoffs category, by the one rule: settled, secured, or the whole ceiling.
        const bounds = openPlayoffBounds(row, ceilings.elim);
        floor += bounds.floor;
        openCeiling += bounds.ceiling;
        continue;
      }
      openCeiling += ceilings[category];
    }
  }

  return { floor, openCeiling };
}

/**
 * Computes every team's status at the position the rows were built at.
 *
 * THE FLOOR AND THE CEILING come from `districtLockBounds` above and from
 * nowhere else. At the "now" position nothing is reopened, so the floor is the
 * team's DISTRICT TIER total: `pointTotal` minus every point it earned at the
 * District Championship.
 *
 * THE PUBLISHED VERDICTS RANK THE SAME TOTAL. Since quick task 261007-il9 the
 * publisher's (and the Worker's) `districtLock` verdicts and
 * `insights.districtLockedCount` rank the district tier total too
 * (`districtTierPointTotal` in packages/harness/districtRankingsMerge.ts).
 * Before it they ranked the all tier `pointTotal` and disagreed with this
 * floor over declined places, teams that played from below the line and ties.
 * Since quick task 261007-jvz this tab counts a consuming award at ANY event
 * some team's rows resolve to the district tier, as the publisher does, from
 * the same artifact derived map (`eventTierByKey`). The two differ only where
 * the publisher's corpus tier names an event no team carries a row for;
 * measured 2026-10-07 over the 109 local seasons, no such team exists. Nothing
 * on the site displays the published verdicts.
 */
export function computeDistrictLedgerStatuses(options: ComputeDistrictLedgerStatusesOptions): DistrictLedgerStatusModel {
  const { artifact, teams } = options;
  const ceilings = maxEventPoints(artifact.year, "district");
  const categoryCeiling: DistrictCategoryCeilings = {
    qual: ceilings.qual,
    alliance: ceilings.alliance,
    elim: ceilings.elim,
    award: ceilings.award,
  };

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const consuming = consumingAwardTypesForTier("district");
  // DISTRICT WIDE, built once (quick task 261007-jvz): the tier from every
  // team's rows, as the publisher's artifact derived map reads it, and the
  // award finality from the same map the slot reservation reads.
  const tierByEvent = eventTierByKey(artifact.teams);
  const awardFinalByEvent = awardFinalByEventAtPosition(artifact, teams);

  const lockInputs: LockTeamInput[] = [];
  const projectionInputs: LockTeamInput[] = [];
  const pooledEntries: PooledTeamEntry[] = [];
  // `eventKey -> the playoff points counted in team floors at this position
  // while that event's Playoffs are open`: the exact settled points (quick
  // task 261009-uhb) and the secured minimums (quick task 261012-mw2), for
  // `pooledLockInputs` to take off that event's playoff pool.
  const playoffPointsInFloors = new Map<string, number>();
  const awardQualified = new Set<string>();

  for (const team of teams) {
    const source = sourceByKey.get(team.teamKey);
    if (source === undefined) continue;

    const { floor, openCeiling } = districtLockBounds(source, team.rows, categoryCeiling);
    // The playoff points `districtLockBounds` just put in this team's floor:
    // the same rows, the same open Playoffs category and the very same
    // `openPlayoffBounds` call, so the pool can only lose what a floor gained,
    // and loses it once. A settled value that is not exact, on a row with no
    // secured minimum, returns a floor of 0 and adds no key.
    for (const row of team.rows) {
      if (row.stage.final.elim) continue;
      const inFloor = openPlayoffBounds(row, categoryCeiling.elim).floor;
      if (inFloor > 0) playoffPointsInFloors.set(row.eventKey, (playoffPointsInFloors.get(row.eventKey) ?? 0) + inFloor);
    }

    lockInputs.push({ teamKey: team.teamKey, pointTotal: floor, maxRemaining: openCeiling });
    // `maxRemaining: 0` asks the cut-line function for the slot-th highest
    // PROJECTION rather than the slot-th highest reachable ceiling.
    projectionInputs.push({ teamKey: team.teamKey, pointTotal: team.projection, maxRemaining: 0 });
    // The pooled lock reads the SAME per-row finalities the floor and the
    // ceiling above were derived from, so its pool and this team's ceiling can
    // never describe different positions. A team with no published
    // `awardProfile` is passed as a rookie: that widens the award pool, and a
    // wider pool is the conservative side of a guarantee.
    pooledEntries.push({
      teamKey: team.teamKey,
      rookie: source.awardProfile?.rookie ?? true,
      events: team.rows.map((row) => ({ eventKey: row.eventKey, final: row.stage.final })),
    });

    for (const award of source.qualifyingAwards) {
      // An award's tier comes from EVERY team's event rows, district wide, as
      // the publisher's artifact derived map reads it
      // (`DistrictQualifyingAwardSchema` deliberately carries no `tier` field
      // of its own). FIRST's district rules qualify a district event Impact
      // winner for the DCMP whichever of its events it won at, so an award at
      // the team's third, uncounted event still consumes (frc1391 at
      // 2019paben). An award at an event no row names stays uncounted.
      if (tierByEvent.get(award.eventKey) !== "district") continue;
      if (!consuming.has(award.awardType)) continue;
      // An award the slider has REOPENED has not been given out at this
      // position, so it cannot consume a slot here. The finality comes from
      // the map the reservation reads, so the event consumes or reserves and
      // never both.
      if (awardFinalByEvent.get(award.eventKey) !== true) continue;
      awardQualified.add(team.teamKey);
    }
  }

  // THE PREQUALIFIED SET IS EMPTY AT THIS TIER. There is no prequalification
  // concept at the district/DCMP tier at all, which is exactly what
  // `scripts/publishDistricts.ts`'s own pass 1 states.
  const qualifiers: QualifierSets = { awardQualified, prequalified: new Set<string>() };

  // ONE SLOT HELD BACK PER AWARD STILL TO COME. It reaches the `Locked` test
  // alone: `locks.ts` subtracts it from `lockSlots` and leaves both the
  // elimination test and the cut line on the unreserved count, so `Locked out`
  // and the In range line are untouched by the reservation. That asymmetry is
  // measured rather than assumed — see `computeLocksSplit`.
  const reservedSlots = reservedSlotsAtPosition(artifact, teams);

  // THE SECOND PROOF OF `Locked`. Points are conserved inside an event, so the
  // district's total remaining points are far smaller than the sum of every
  // rival's ceiling. A team also locks when no achievable distribution of what
  // is left can lift enough rivals past it — see `locks.ts`'s header for the
  // rule and `packages/core/districts/pointPool.ts` for how big the pool is.
  //
  // A knocked out alliance's exact playoff points are already in its teams'
  // floors, so they are no longer the event's to hand out: the second
  // argument takes them off that event's playoff pool (quick task
  // 261009-uhb). Without it the same points sat on both sides of the test and
  // a pooled lock shown at Alliances final was withdrawn at a later round.
  const pooled = pooledLockInputs(pooledEntries, playoffPointsInFloors);

  const verdicts = computeLocksWithQualifiers(lockInputs, artifact.dcmpSlots, qualifiers, reservedSlots, pooled);
  const projectionCutLine = cutLinePointsWithQualifiers(projectionInputs, artifact.dcmpSlots, qualifiers);
  const projectionByTeam = new Map(projectionInputs.map((input) => [input.teamKey, input.pointTotal] as const));

  const byTeam = new Map<string, DistrictLedgerStatusResult>();
  const counts: Record<DistrictLedgerStatusKey, number> = { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 };
  const verdictCensus: Record<LockStatus, number> = { ...EMPTY_CENSUS };

  for (const verdict of verdicts) {
    verdictCensus[verdict.status] += 1;
    let status: DistrictLedgerStatusState;
    let byAward = false;
    if (verdict.status === "prequalified") {
      status = "prequalified";
    } else if (verdict.status === "locked") {
      status = "locked";
    } else if (verdict.status === "lockedAward") {
      status = "locked";
      byAward = true;
    } else if (verdict.status === "eliminated") {
      status = "lockedOut";
    } else if (verdict.status === "unknown" || projectionCutLine === null) {
      status = "capacityUnknown";
    } else {
      // `>=`, not `>`: `locks.ts`'s own tie philosophy is that a tie is settled
      // by a tiebreaker this model does not carry, so every team exactly at the
      // line reports the friendlier side rather than being told it is out.
      const projection = projectionByTeam.get(verdict.teamKey) ?? 0;
      status = projection >= projectionCutLine ? "inRange" : "outOfRange";
    }
    if (status !== "capacityUnknown") counts[status] += 1;
    byTeam.set(verdict.teamKey, { teamKey: verdict.teamKey, status, byAward, verdict: verdict.status, lockedBy: verdict.lockedBy });
  }

  return {
    byTeam,
    counts,
    verdictCensus,
    projectionCutLine,
    awardQualified: [...qualifiers.awardQualified].sort(),
    prequalified: [...qualifiers.prequalified].sort(),
    reservedSlots,
    pooledRemainingPoints: pooled.remainingPoints,
  };
}
