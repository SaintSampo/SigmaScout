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
 * ONE RULE, TWO VANTAGES. The rule reads three facts about one event:
 *   - `judgedAwardListed`: the awards list holds an award that is neither
 *     Winner (1) nor Finalist (2). Read from the award type alone, never from
 *     the name.
 *   - `awardPointsPresent`: some team's row at that event carries award points
 *     above zero in the district rankings.
 *   - `listSettled` (quick task 261009-tx6): the awards list has not changed
 *     for `AWARDS_SETTLE_MS`, 60 minutes. Optional, and read at the live
 *     vantage only.
 * Who is asking decides how they combine:
 *   - `"live"` (the Worker, during the event) needs ALL THREE. A judged award
 *     with no points yet means TBA is still filling the event in, and Winner
 *     and Finalist alone say nothing about the judged awards. Waiting keeps
 *     the reservations held, which is the side that can never revoke a
 *     Locked. An absent `listSettled` reads as not settled.
 *   - `"hindsight"` (the offline publisher, after the fact) needs EITHER of
 *     the first two and does not read the third. The corpus is ingested once
 *     an event is over, so either fact is proof the ceremony happened.
 *
 * WHY THE LIST HAS TO SETTLE. TBA can list an event's awards in batches. With
 * the first two facts alone the flag turned true at the first judged award
 * whose points were in the rankings, which releases the slot held for that
 * event's Impact award. An Impact award listed in a later batch was then
 * recorded after the held slot had already gone back to the points race, and
 * a team shown Locked on it could lose it. So the flag also waits until the
 * list has stood unchanged for an hour.
 *
 * THE RULE'S LIMIT, stated and not hidden: an award listed MORE than an hour
 * after the list last changed lands after the flag is true. It is still
 * recorded on the tick its list changes, but the held slot was released an
 * hour after the batch before it.
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

/** How long an awards list must stand unchanged before the live rule reads it as settled: 60 minutes (quick task 261009-tx6). */
export const AWARDS_SETTLE_MS = 60 * 60 * 1000;

/**
 * Whether the awards list in hand has stood unchanged for `AWARDS_SETTLE_MS`
 * (quick task 261009-tx6). Pure: it parses the stored time and reads no clock.
 *
 * `storedEtag` is the ETag of the last list the caller merged for the event
 * and `lastChangedAt` the ISO time that ETag last changed, both from the
 * caller's own record. `listEtag` is the ETag of the list in hand.
 *
 * TRUE ONLY when the list in hand IS the stored list (equal, non null ETags)
 * and the stored change time parses and is at least `AWARDS_SETTLE_MS` before
 * `nowMs`. EVERY UNKNOWN READS AS NOT SETTLED: no stored ETag, a list whose
 * response carried no ETag, a differing ETag, and a change time that is
 * absent, unparseable or in the future. Not settled keeps the flag false,
 * which keeps the reservations held.
 */
export function awardsListSettled(storedEtag: string | null | undefined, lastChangedAt: string | null | undefined, listEtag: string | null, nowMs: number): boolean {
  if (listEtag === null || storedEtag === null || storedEtag === undefined || storedEtag !== listEtag) return false;
  if (lastChangedAt === null || lastChangedAt === undefined) return false;
  const changedAtMs = Date.parse(lastChangedAt);
  if (!Number.isFinite(changedAtMs)) return false;
  return nowMs - changedAtMs >= AWARDS_SETTLE_MS;
}

/** The facts the rule reads about one event. See the module header. */
export interface AwardsPostedFacts {
  readonly judgedAwardListed: boolean;
  readonly awardPointsPresent: boolean;
  /**
   * The awards list has stood unchanged for `AWARDS_SETTLE_MS` (quick task
   * 261009-tx6). OPTIONAL: the live vantage reads an absent value as not
   * settled, and the hindsight vantage does not read it at all.
   */
  readonly listSettled?: boolean;
}

/** Who is asking: the Worker during the event, or the publisher after it. */
export type AwardsPostedVantage = "live" | "hindsight";

/**
 * Whether an event's awards read as posted. Live: all three facts, with
 * `listSettled` read as true only when it is exactly `true`. Hindsight:
 * either of the first two. This function only answers for the facts it is
 * handed. A flag that is already published true stays true, and that is the
 * caller's rule: awards do not un post.
 */
export function awardsPostedRule(facts: AwardsPostedFacts, vantage: AwardsPostedVantage): boolean {
  if (vantage === "hindsight") return facts.judgedAwardListed || facts.awardPointsPresent;
  return facts.judgedAwardListed && facts.awardPointsPresent && facts.listSettled === true;
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
