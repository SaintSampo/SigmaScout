/**
 * The one rule for "this event's awards are posted", and the one builder of a
 * qualifying award record (quick task 261009-r9x). Pure: no I/O, no schema
 * library, and nothing imported beyond `./qualification.js`.
 *
 * WHY THIS MODULE EXISTS. The Locks guarantee on both tabs holds slots back
 * until an event's awards are done (`./reservedSlots.ts`,
 * `./champReservedSlots.ts`), because an Impact award, and at a District
 * Championship also Engineering Inspiration, Rookie All Star and the winning
 * alliance, takes a slot whatever the winner's points are. The flag that ends
 * that reservation is `state.awardsPosted`. Before this task the live Worker
 * turned it true on the first award of any kind, so a list holding only Winner
 * and Finalist read as "awards final" while Impact was still due, and a team
 * could be shown Locked on a slot an Impact winner then took.
 *
 * ONE RULE, TWO VANTAGES. The rule reads two facts about one event:
 *   - `judgedAwardListed`: the awards list holds an award that is neither
 *     Winner (1) nor Finalist (2). Read from the award type alone, never from
 *     the name.
 *   - `awardPointsPresent`: some team's row at that event carries award points
 *     above zero in the district rankings.
 * Who is asking decides how they combine:
 *   - `"live"` (the Worker, during the event) needs BOTH. A judged award with
 *     no points yet means TBA is still filling the event in, and Winner and
 *     Finalist alone say nothing about the judged awards. Waiting keeps the
 *     reservations held, which is the side that can never revoke a Locked.
 *   - `"hindsight"` (the offline publisher, after the fact) needs EITHER. The
 *     corpus is ingested once an event is over, so either fact is proof the
 *     ceremony happened.
 *
 * WHAT THE CORPUS SAYS (measured 2026-10-09 over 953 district events, 110
 * District Championships and 64 divisions). No district event lists Winner and
 * Finalist only: every event with any award listed also lists a judged one.
 * Twelve events since 2022 list judged awards and no Impact award at all
 * (eleven in 2022, and `2026isde2`), so "wait until Impact is listed" is not a
 * usable rule: those events would hold their reservation forever. That is why
 * the rule asks for any judged award and not for Impact by name.
 *
 * BOTH PRODUCERS CALL THIS MODULE. `packages/harness/districtRankingsMerge.ts`
 * (the Worker's merge) and `scripts/publishDistricts.ts` (the offline
 * publisher) read the flag through `awardsPostedRule` and build every
 * `qualifyingAwards` entry through `qualifyingAwardRecord`, so the two cannot
 * drift apart.
 */
import { AWARD_TYPE_WINNER, awardDisplayName, isAwardOnly, isQualificationRelevantAward, type AwardTier } from "./qualification.js";

/** TBA's enumerated award_type for a Finalist. With Winner (1) it is decided on the field, not by the judges. */
export const AWARD_TYPE_FINALIST = 2;

/** True for every award type the judges hand out: anything other than Winner (1) and Finalist (2). */
export function isJudgedAwardType(awardType: number): boolean {
  return awardType !== AWARD_TYPE_WINNER && awardType !== AWARD_TYPE_FINALIST;
}

/** True when the list of award types holds at least one judged award. An empty list is false. */
export function judgedAwardListed(awardTypes: Iterable<number>): boolean {
  for (const awardType of awardTypes) if (isJudgedAwardType(awardType)) return true;
  return false;
}

/**
 * True when some team's `eventPoints` row at `eventKey` carries award points
 * above zero. Narrowed structurally so this module needs no artifact type.
 */
export function awardPointsPresentAt(
  teams: readonly { readonly eventPoints: readonly { readonly eventKey: string; readonly award: number }[] }[],
  eventKey: string
): boolean {
  for (const team of teams) {
    for (const row of team.eventPoints) if (row.eventKey === eventKey && row.award > 0) return true;
  }
  return false;
}

/** The two facts the rule reads about one event. See the module header. */
export interface AwardsPostedFacts {
  readonly judgedAwardListed: boolean;
  readonly awardPointsPresent: boolean;
}

/** Who is asking: the Worker during the event, or the publisher after it. */
export type AwardsPostedVantage = "live" | "hindsight";

/**
 * Whether an event's awards read as posted. Live: both facts. Hindsight:
 * either fact. This function only answers for the facts it is handed. A flag
 * that is already published true stays true, and that is the caller's rule:
 * awards do not un post.
 */
export function awardsPostedRule(facts: AwardsPostedFacts, vantage: AwardsPostedVantage): boolean {
  return vantage === "live" ? facts.judgedAwardListed && facts.awardPointsPresent : facts.judgedAwardListed || facts.awardPointsPresent;
}

/** One `qualifyingAwards` entry of a district artifact team row, field for field. */
export interface QualifyingAwardRecord {
  readonly eventKey: string;
  readonly awardType: number;
  readonly label: string;
  readonly awardOnly: boolean;
}

/**
 * The record one award at one event contributes to a recipient's
 * `qualifyingAwards`, or `null` when the award is not qualification relevant
 * at that tier (Winner at a district event, Finalist anywhere, every award
 * this pipeline carries no label for).
 *
 * Relevance is tested BEFORE the label is asked for, so a type with no
 * declared label returns `null` and never reaches `awardDisplayName`, which
 * throws for one.
 */
export function qualifyingAwardRecord(input: {
  readonly eventKey: string;
  readonly awardType: number;
  readonly tier: AwardTier;
  readonly season: number;
}): QualifyingAwardRecord | null {
  if (!isQualificationRelevantAward(input.awardType, input.tier)) return null;
  return {
    eventKey: input.eventKey,
    awardType: input.awardType,
    label: awardDisplayName(input.awardType, input.season),
    awardOnly: isAwardOnly(input.awardType, input.tier),
  };
}
