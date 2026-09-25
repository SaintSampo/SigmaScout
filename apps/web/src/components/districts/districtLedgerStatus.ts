/**
 * The five statuses at one position, in Jacob's own words.
 *
 * ONE PURE MODULE, no React. It imports `packages/core/districts/locks.ts` and
 * `qualification.ts` and EDITS NEITHER — no file under `packages/` is touched
 * by this plan at all.
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
  type LockStatus,
  type LockTeamInput,
  type QualifierSets,
} from "../../../../../packages/core/districts/locks.js";
import { consumingAwardTypesForTier } from "../../../../../packages/core/districts/qualification.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DISTRICT_CATEGORIES, type DistrictLedgerTeam } from "./districtLedgerRows.js";

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

  const verdicts = computeLocksWithQualifiers(lockInputs, artifact.dcmpSlots, qualifiers);
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
    byTeam.set(verdict.teamKey, { teamKey: verdict.teamKey, status, byAward, verdict: verdict.status });
  }

  return { byTeam, counts, verdictCensus, projectionCutLine };
}
