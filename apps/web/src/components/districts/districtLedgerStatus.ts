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
import { consumingAwardTypesForTier } from "../../../../../packages/core/districts/qualification.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { reservedImpactSlots, type ReservedSlotEvent } from "../../../../../packages/core/districts/reservedSlots.js";
import { pooledLockInputs, type PooledTeamEntry } from "../../../../../packages/core/districts/pooledLockInputs.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DISTRICT_CATEGORIES, districtTierEvents, type DistrictLedgerTeam } from "./districtLedgerRows.js";

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
  /** The raw `locks.ts` verdict this status was mapped from, exposed so a test can compare the census against the artifact's own counts. */
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
  /** The raw six-status `locks.ts` census, which IS what `insights.districtLockedCount`/`districtEliminatedCount` count. */
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
   * verdicts identical with and without the pooled argument.
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
 * cancelled-event carve out; this function owns only the two lookups.
 */
export function reservedSlotsAtPosition(artifact: DistrictArtifact, teams: readonly DistrictLedgerTeam[]): number {
  const awardFinalByEvent = new Map<string, boolean>();
  for (const team of teams) {
    for (const row of team.rows) {
      if (!awardFinalByEvent.has(row.eventKey)) awardFinalByEvent.set(row.eventKey, row.stage.final.award);
    }
  }

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
 * Computes every team's status at the position the rows were built at.
 *
 * THE FLOOR IS DERIVED BY SUBTRACTION from `team.pointTotal`, never by
 * re-summing the four categories. `pointTotal` carries the rookie bonus, the
 * adjustments and TBA's own arithmetic; a re-sum would silently drop all three,
 * and the district-tier lock's own shipped input is that whole `pointTotal`.
 * At the "now" position nothing is reopened, so the floor is EXACTLY
 * `team.pointTotal` — which is the entire reason a finished district reproduces
 * the artifact's own counts.
 *
 * THE CEILING is the floor plus `maxEventPoints(season, "district")`'s value
 * for every OPEN district-tier category at this position. A wholly unstarted
 * event contributes all four, which equals its own `remainingEvents.maxPoints`.
 */
export function computeDistrictLedgerStatuses(options: ComputeDistrictLedgerStatusesOptions): DistrictLedgerStatusModel {
  const { artifact, teams } = options;
  const ceilings = maxEventPoints(artifact.year, "district");
  const categoryCeiling: Readonly<Record<(typeof DISTRICT_CATEGORIES)[number], number>> = {
    qual: ceilings.qual,
    alliance: ceilings.alliance,
    elim: ceilings.elim,
    award: ceilings.award,
  };

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const consuming = consumingAwardTypesForTier("district");

  const lockInputs: LockTeamInput[] = [];
  const projectionInputs: LockTeamInput[] = [];
  const pooledEntries: PooledTeamEntry[] = [];
  const awardQualified = new Set<string>();

  for (const team of teams) {
    const source = sourceByKey.get(team.teamKey);
    if (source === undefined) continue;

    let floor = source.pointTotal;
    let openCeiling = 0;
    const districtTierEventKeys = new Set<string>();
    const awardFinalByEvent = new Map<string, boolean>();

    for (const row of team.rows) {
      districtTierEventKeys.add(row.eventKey);
      awardFinalByEvent.set(row.eventKey, row.stage.final.award);
      for (const category of DISTRICT_CATEGORIES) {
        if (row.stage.final[category]) continue;
        // Reopened (or never earned): this category's earned points leave the
        // floor and its ceiling joins the ceiling.
        if (row.earned !== undefined) floor -= row.earned[category];
        openCeiling += categoryCeiling[category];
      }
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
      // An award's tier comes from the team's own event rows, exactly as
      // `DistrictQualifyingAwardSchema`'s doc comment requires — that schema
      // deliberately carries no `tier` field of its own.
      if (!districtTierEventKeys.has(award.eventKey)) continue;
      if (!consuming.has(award.awardType)) continue;
      // An award the slider has REOPENED has not been given out at this
      // position, so it cannot consume a slot here.
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
  const pooled = pooledLockInputs(pooledEntries);

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
