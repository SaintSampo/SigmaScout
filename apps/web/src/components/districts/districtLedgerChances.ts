/**
 * The advancement chance's two PURE halves: what gets posted to the Worker, and
 * what comes back gets to print.
 *
 * No React, no `Worker`, no arithmetic of its own — `advancementChances` owns
 * the draws and `locks.ts` owns the slots. This module owns exactly two
 * decisions, and both are refusals:
 *
 * 1. WHEN THERE IS NO CHANCE TO COMPUTE AT ALL (`buildAdvancementChanceRun`
 *    returns `undefined`). An unpublished capacity, a district with nothing
 *    left to play, a run still in flight, or a hole in the field too big to
 *    rank around.
 *
 *    THAT LAST ONE WAS NARROWED ON 2026-09-25 (quick task 260925-uf8), and the
 *    narrowing is worth the space it takes. The shipped rule refused the WHOLE
 *    district on the first team whose grand total could not be built, which is
 *    how `?year=2026&district=2026pnw&tab=road-to-district-champs&at=2026wasam:awards`
 *    came to render sixty-six status chips and not one chance line: production's
 *    district artifact predates phase 10's `state`, `awardProfile` and
 *    `bakedEvents` fields, so at a rewound position the tab holds no
 *    distribution for any event at all and 90 of its 126 grand totals are
 *    unavailable. One bad team silencing a hundred and twenty-five good ones is
 *    the wrong trade.
 *
 *    So an unavailable grand total now EXCLUDES that team, and the excluded set
 *    is reported in `excludedTeams`. The original argument still holds and is
 *    exactly why there is still a bound: a chance is a RANKING, so an excluded
 *    rival can only INFLATE every remaining chance, by at most one slot each.
 *    The exclusion is therefore allowed only while the excluded set could not
 *    fill the capacity on its own, and only while something is still open among
 *    the teams that remain. A 90-of-126 hole against 50 slots still refuses,
 *    correctly; a handful of teams whose own row refused no longer does.
 *
 *    THE DISCLOSURE IS ALREADY ON THE SCREEN. An excluded team is exactly a team
 *    `districtLedgerRows.ts` names in `gaps.teamsWithUnavailableGrandTotal` and
 *    renders every predicted number of as "not available", including its grand
 *    total — so a reader sees, in that team's own row, that its prediction could
 *    not be built. `excludedTeams` carries the same list for a test and for any
 *    future surface that wants to count it.
 *
 * 2. WHEN A RUN SET DISAGREES WITH A VERDICT (`reconcileAdvancementChances`).
 *    The chip wins, always. A Locked team reading below 1 is reachable through
 *    the POOLED lock, whose whole argument is that points are conserved inside
 *    an event — which independent draws do not honour. The disagreement is
 *    counted in `gaps` and never printed, because a "93% chance" under a chip
 *    saying "Locked" is the site contradicting itself in one table cell.
 *
 * A CHANCE IS ONLY EVER PRINTED FOR `In range` AND `Out of range`. Locked,
 * Locked · award and Prequalified are guarantees and a number beside them can
 * only weaken one; Locked out is the mirror image. The award probe's standing
 * rule — no prediction feeds the `locks.ts` guarantee — is unchanged here: the
 * chance reads the verdicts, never the other way round.
 */
import type { AdvancementChanceInputs, AdvancementChanceTeam } from "../../../../../packages/core/districts/advancementChance.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { pointMassDistribution, type DistrictLedgerTeam } from "./districtLedgerRows.js";
import type { DistrictLedgerStatusModel } from "./districtLedgerStatus.js";

/** One posted chance run: the inputs, the string the hook's effect keys on, and what the ranking had to leave out. */
export interface DistrictAdvancementChanceRun {
  readonly inputs: AdvancementChanceInputs;
  readonly signature: string;
  /**
   * The teams left OUT of the ranking because their grand total could not be
   * built, sorted. Empty on a healthy district.
   *
   * Every one of them already renders every predicted number as "not available"
   * in its own row, which is where the reader sees it; this array is the same
   * fact in a form a test can assert and a future surface could count.
   */
  readonly excludedTeams: readonly string[];
}

export interface BuildAdvancementChanceRunOptions {
  readonly artifact: DistrictArtifact;
  /** The rows built AT THIS POSITION, in `districtLedgerRows.ts`'s own sorted order. */
  readonly teams: readonly DistrictLedgerTeam[];
  /** The verdicts at the SAME position — the source of the qualifier sets and the reservation. */
  readonly statuses: DistrictLedgerStatusModel;
  /**
   * The per-event run's own signature when its result is in hand, or `null`
   * while a run is in flight. `null` suppresses the request entirely: the
   * distributions the grand totals are built from are still changing, and a
   * chance over a half-built field would be posted, rendered and replaced
   * inside a second.
   */
  readonly runSignature: string | null;
  /** The rewind position id, so moving the slider always re-runs. */
  readonly positionId: string;
}

/**
 * The string the chance effect keys on.
 *
 * COMPOSED FROM WHAT PRODUCES THE GRAND TOTALS rather than folded from the
 * totals themselves, which is the one place this differs from
 * `districtRunSignature`. That function folds its inputs by VALUE because they
 * are small; a district's grand totals are hundreds of teams by hundreds of
 * point values, and folding half a million floats into a string on every render
 * would cost more than the run it guards.
 *
 * What it carries instead is every input those totals are a function of: the
 * artifact's own identity and publish timestamp (which moves whenever a live
 * refetch changes anything at all), the capacity, the position, the per-event
 * run's exact signature, the qualifier sets and the reservation, and each
 * team's own grand-total shape. A change the composition could miss would have
 * to leave all of those fixed, which no path in `districtLedgerRows.ts` does.
 */
function chanceSignature(
  options: BuildAdvancementChanceRunOptions,
  teams: readonly AdvancementChanceTeam[],
  excludedTeams: readonly string[]
): string {
  const { artifact, statuses, runSignature, positionId } = options;
  return [
    // The EXCLUDED set by name, not just by count. A team going from unavailable
    // to available shortens this list and lengthens the team fold below, so
    // either alone would do; naming them makes the re-run obvious to a reader
    // rather than an emergent property of two lists moving together.
    excludedTeams.join("+"),
    artifact.districtKey,
    artifact.generation,
    artifact.computedAt,
    String(artifact.dcmpSlots),
    positionId,
    runSignature ?? "",
    String(statuses.reservedSlots),
    statuses.awardQualified.join("+"),
    statuses.prequalified.join("+"),
    teams.map((team) => `${team.teamKey}=${String(team.counts.length)}/${String(team.denominator)}`).join(","),
  ].join("|");
}

/**
 * Assembles one chance run, or refuses.
 *
 * A FINISHED DISTRICT REFUSES, which is what keeps SC-5's no-Worker promise
 * true where it was made: nothing is open, every grand total is the earned
 * number, and a "chance" over a settled season would be 100% or 0% dressed up
 * as a prediction.
 */
export function buildAdvancementChanceRun(options: BuildAdvancementChanceRunOptions): DistrictAdvancementChanceRun | undefined {
  const { artifact, teams, statuses, runSignature } = options;
  if (artifact.dcmpSlots === null) return undefined;
  if (runSignature === null) return undefined;
  if (teams.length === 0) return undefined;
  if (!teams.some((team) => team.hasOpenCategory)) return undefined;

  const chanceTeams: AdvancementChanceTeam[] = [];
  const excludedTeams: string[] = [];
  let openAmongIncluded = false;
  for (const team of teams) {
    const cell = team.grandTotal;
    if (cell.kind === "unavailable") {
      excludedTeams.push(team.teamKey);
      continue;
    }
    if (team.hasOpenCategory) openAmongIncluded = true;
    const distribution = cell.kind === "final" ? pointMassDistribution(cell.earned) : cell.distribution;
    chanceTeams.push({ teamKey: team.teamKey, counts: distribution.counts, denominator: distribution.denominator });
  }

  // THE TWO BOUNDS ON THE EXCLUSION, both stated in this module's header.
  //
  // An excluded rival can only inflate every remaining chance, and by at most
  // one slot each, so once the excluded set alone could fill the capacity the
  // ranking has stopped being a ranking of this district. `>=` rather than `>`:
  // a set that could take every slot leaves nothing for the printed field to be
  // competing for.
  if (excludedTeams.length >= artifact.dcmpSlots) return undefined;
  // And a field with nothing open left in it is a settled season, where a
  // "chance" is a 1 or a 0 dressed up as a prediction — the same refusal the
  // whole-district check above makes, re-applied to what survived the exclusion.
  if (!openAmongIncluded) return undefined;
  if (chanceTeams.length === 0) return undefined;

  const inputs: AdvancementChanceInputs = {
    teams: chanceTeams,
    slots: artifact.dcmpSlots,
    awardQualified: statuses.awardQualified,
    prequalified: statuses.prequalified,
    reservedSlots: statuses.reservedSlots,
  };
  const sortedExcluded = [...excludedTeams].sort();
  return { inputs, signature: chanceSignature(options, chanceTeams, sortedExcluded), excludedTeams: sortedExcluded };
}

export interface DistrictLedgerChanceModel {
  /** `teamKey -> chance in [0, 1]`, for the teams whose chip actually prints one. */
  readonly byTeam: ReadonlyMap<string, number>;
  /**
   * The team keys whose run set disagreed with their own verdict, sorted.
   * COUNTED, never printed — see this module's header. An empty array is the
   * expected reading whenever no team is locked by the pooled argument alone.
   */
  readonly gaps: readonly string[];
}

const PRINTS_A_CHANCE = new Set(["inRange", "outOfRange"]);

/**
 * Narrows a raw run set to what the chips allow, and counts what they refuse.
 *
 * A team absent from `chanceByTeam` is not a gap: award qualifiers and
 * prequalified teams are removed from the points race by `locks.ts` itself, so
 * having no chance at all is the correct reading for them.
 */
export function reconcileAdvancementChances(
  chanceByTeam: ReadonlyMap<string, number>,
  statuses: DistrictLedgerStatusModel
): DistrictLedgerChanceModel {
  const byTeam = new Map<string, number>();
  const gaps: string[] = [];

  for (const [teamKey, chance] of chanceByTeam) {
    const status = statuses.byTeam.get(teamKey)?.status;
    if (status === undefined) continue;
    if (PRINTS_A_CHANCE.has(status)) {
      byTeam.set(teamKey, chance);
      continue;
    }
    // The verdict wins. A Locked team below certainty and a Locked out team
    // above zero are both real possibilities — the first through the pooled
    // lock, the second only through a bug — and neither may reach a screen.
    if ((status === "locked" || status === "prequalified") && chance < 1) gaps.push(teamKey);
    if (status === "lockedOut" && chance > 0) gaps.push(teamKey);
  }

  return { byTeam, gaps: gaps.sort() };
}
