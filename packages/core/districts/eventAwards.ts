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
 * ONE RULE, TWO VANTAGES. The rule reads these facts about one event:
 *   - `judgedAwardListed`: the awards list holds an award that is neither
 *     Winner (1) nor Finalist (2). Read from the award type alone, never from
 *     the name.
 *   - `awardPointsPresent`: some team's row at that event carries award points
 *     above zero in the district rankings.
 *   - `playoffPointsPresent` (quick task 261009-vp9): some team's row at
 *     that event carries playoff points above zero. Read at the live vantage
 *     only.
 *   - `expectedAwardsListed` (quick task 261009-vp9): the list holds EVERY
 *     consuming award an event of this kind gives. Impact at a district tier
 *     event. Impact, Winner, Engineering Inspiration and Rookie All Star at a
 *     District Championship that is not a division. None at a division,
 *     which gives no consuming award. Read at the live vantage only.
 *   - `listSettled` (quick task 261009-tx6): the awards list has not changed
 *     for `AWARDS_SETTLE_MS`, 60 minutes. Read at the live vantage only.
 *   - `listSettledLong` (quick task 261009-vp9): the same list has not
 *     changed for `AWARDS_SETTLE_WITHOUT_IMPACT_MS`, 12 hours. Read at the
 *     live vantage only.
 * Who is asking decides how they combine:
 *   - `"live"` (the Worker, during the event) needs a judged award AND award
 *     points AND playoff points AND, where every expected award is listed,
 *     the list settled for 60 minutes. Where one of them is NOT listed it
 *     needs the list settled for 12 hours instead. A judged award with no points yet means TBA is
 *     still filling the event in, and Winner and Finalist alone say nothing
 *     about the judged awards. Waiting keeps the reservations held, which is
 *     the side that can never revoke a Locked. Every absent fact reads as
 *     the waiting side: not listed, not settled.
 *   - `"hindsight"` (the offline publisher, after the fact) needs EITHER of
 *     the first two and reads none of the others. The corpus is ingested
 *     once an event is over, so either fact is proof the ceremony happened.
 *
 * WHY THE LIST HAS TO SETTLE. TBA can list an event's awards in batches. With
 * the first two facts alone the flag turned true at the first judged award
 * whose points were in the rankings, which releases the slot held for that
 * event's Impact award. An Impact award listed in a later batch was then
 * recorded after the held slot had already gone back to the points race, and
 * a team shown Locked on it could lose it. So the flag also waits until the
 * list has stood unchanged for an hour.
 *
 * WHY IT WAITS FOR PLAYOFF POINTS (quick task 261009-vp9). A true flag closes
 * every category of the event at once (`categoryCorroboration.ts`: only the
 * awards flag cascades down). The district rankings are one feed with four
 * layers, and nothing proves the award points never land before the playoff
 * points. Walked on `2026orore` with the award points and a settled list
 * arriving before the playoff points: the flag turned true, the Playoffs
 * read final with no playoff point on any row, and the playoff points
 * arriving took one lock back in the published district verdict, one in the
 * published champ verdict and one on each tab. With this fact the flag
 * stays false until some row at the event carries a playoff point.
 *
 * THE ASSUMPTION THAT REMAINS, NOT VERIFIED against a live event: TBA
 * computes an event's point categories together, so playoff points carried
 * by a payload that also carries award points include the deciding match.
 * The fact asks for ANY playoff point above zero, not the winner's value,
 * because at an event whose winners carry no row that value never appears.
 *
 * WHY IT ALSO WAITS FOR THE AWARDS BY NAME (quick task 261009-vp9). The hour
 * alone has a hole: a list that sits unchanged for an hour WITHOUT its Impact
 * award turns the flag true, and the Impact listed after that takes a held
 * place. Replayed on the 2026 PNW fixture with the award arriving two hours
 * after the rest of the list, a late Impact took `frc5920` from held to
 * eliminated at five district events (`2026wasam` and `2026wasno` among
 * them), and at `2026pncmp` a late Impact took three held places and a late
 * Engineering Inspiration or Rookie All Star two each. Waiting for Impact
 * alone at the championship still lost two places to a late Engineering
 * Inspiration and two to a late Rookie All Star, which is why a championship
 * waits for EVERY consuming award it gives. With the rule below, all twelve
 * walks lose nothing.
 *
 * WHY IMPACT BY NAME IS USABLE NOW. Measured over the 109 local district
 * artifacts: 12 of 951 district events record no Impact award at all (eleven
 * in 2022, and `2026isde2`), ten championships record no Engineering
 * Inspiration (all 2020) and sixteen no Rookie All Star. Under a rule that
 * waited for the award forever those events would hold their reservation
 * forever. The 12 hour wait resolves them: a list that has stood unchanged
 * for 12 hours without an expected award is read as an event that gave none.
 * No division records a consuming award, so a division keeps the 60 minute
 * rule.
 *
 * THE RULE'S LIMITS, stated and not hidden. Each is the flag turning true
 * before an award that then takes a held place:
 *   1. A FURTHER RECIPIENT of a consuming award type that is ALREADY listed,
 *      listed more than an hour after the list last changed: a second Impact
 *      at a championship (72 of 109 give more than one), a fourth member of
 *      a winning alliance. The list already holds the type, so the flag does
 *      not wait for the further recipient.
 *   2. An event that lists NONE of an expected award for 12 unchanged hours
 *      and then lists it.
 *   3. The 24 hour watch and the catch up of quick task 261009-tx6 are
 *      unchanged: awards or points that land after an event's watch has
 *      ended wait for the catch up, and the flag stays false until then.
 * In every case the award is still recorded on the tick its list changes.
 *
 * WHAT THE CORPUS SAYS (measured 2026-10-09 over 953 district events, 110
 * District Championships and 64 divisions). No district event lists Winner and
 * Finalist only: every event with any award listed also lists a judged one.
 *
 * BOTH PRODUCERS CALL THIS MODULE. `packages/harness/districtRankingsMerge.ts`
 * (the Worker's merge) and `scripts/publishDistricts.ts` (the offline
 * publisher) read the flag through `awardsPostedRule` and build every
 * `qualifyingAwards` entry through `qualifyingAwardRecord`, so the two cannot
 * drift apart.
 */
import { AWARD_TYPE_WINNER, awardDisplayName, consumingAwardTypesForTier, isAwardOnly, isQualificationRelevantAward, type AwardTier } from "./qualification.js";

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

/**
 * True when some team's `eventPoints` row at `eventKey` carries playoff
 * points above zero (quick task 261009-vp9). Narrowed structurally so this
 * module needs no artifact type.
 */
export function playoffPointsPresentAt(
  teams: readonly { readonly eventPoints: readonly { readonly eventKey: string; readonly elim: number }[] }[],
  eventKey: string
): boolean {
  for (const team of teams) {
    for (const row of team.eventPoints) if (row.eventKey === eventKey && row.elim > 0) return true;
  }
  return false;
}

/** How long an awards list must stand unchanged before the live rule reads it as settled: 60 minutes (quick task 261009-tx6). */
export const AWARDS_SETTLE_MS = 60 * 60 * 1000;

/**
 * How long an awards list that LACKS a consuming award its event gives must
 * stand unchanged before the live rule reads the event as having given none:
 * 12 hours (quick task 261009-vp9). Named for the Impact award, the one a
 * district tier event gives. At a District Championship it is the wait for
 * any of the four.
 */
export const AWARDS_SETTLE_WITHOUT_IMPACT_MS = 12 * 60 * 60 * 1000;

/**
 * What kind of event an awards list belongs to, for the awards it is expected
 * to hold: a district tier event, a District Championship that is not a
 * division (a single championship, or a divisioned one's finals event), or a
 * division.
 */
export type AwardsEventKind = "district" | "championship" | "division";

const NO_AWARD_TYPES: ReadonlySet<number> = new Set<number>();

/**
 * The consuming award types an event of `kind` gives, from the one table
 * (`consumingAwardTypesForTier`): Impact at a district tier event, Impact,
 * Winner, Engineering Inspiration and Rookie All Star at a championship, and
 * none at a division.
 */
export function expectedConsumingAwardTypes(kind: AwardsEventKind): ReadonlySet<number> {
  if (kind === "division") return NO_AWARD_TYPES;
  return consumingAwardTypesForTier(kind === "championship" ? "dcmp" : "district");
}

/** True when the list of award types holds EVERY consuming award an event of `kind` gives. Always true for a division. */
export function expectedAwardsListed(kind: AwardsEventKind, awardTypes: Iterable<number>): boolean {
  const listed = new Set(awardTypes);
  for (const expected of expectedConsumingAwardTypes(kind)) if (!listed.has(expected)) return false;
  return true;
}

/**
 * Whether the awards list in hand has stood unchanged for `thresholdMs`, by
 * default `AWARDS_SETTLE_MS` (quick task 261009-tx6; the threshold since
 * quick task 261009-vp9, which asks the same question at 12 hours). Pure: it
 * parses the stored time and reads no clock.
 *
 * `storedEtag` is the ETag of the last list the caller merged for the event
 * and `lastChangedAt` the ISO time that ETag last changed, both from the
 * caller's own record. `listEtag` is the ETag of the list in hand.
 *
 * TRUE ONLY when the list in hand IS the stored list (equal, non null ETags)
 * and the stored change time parses and is at least `thresholdMs` before
 * `nowMs`. EVERY UNKNOWN READS AS NOT SETTLED, at every threshold: no stored
 * ETag, a list whose response carried no ETag, a differing ETag, and a change
 * time that is absent, unparseable or in the future. Not settled keeps the
 * flag false, which keeps the reservations held.
 */
export function awardsListSettled(
  storedEtag: string | null | undefined,
  lastChangedAt: string | null | undefined,
  listEtag: string | null,
  nowMs: number,
  thresholdMs: number = AWARDS_SETTLE_MS
): boolean {
  if (listEtag === null || storedEtag === null || storedEtag === undefined || storedEtag !== listEtag) return false;
  if (lastChangedAt === null || lastChangedAt === undefined) return false;
  const changedAtMs = Date.parse(lastChangedAt);
  if (!Number.isFinite(changedAtMs)) return false;
  return nowMs - changedAtMs >= thresholdMs;
}

/** The facts the rule reads about one event. See the module header. */
export interface AwardsPostedFacts {
  readonly judgedAwardListed: boolean;
  readonly awardPointsPresent: boolean;
  /**
   * Some row at the event carries playoff points above zero (quick task
   * 261009-vp9, `playoffPointsPresentAt`). OPTIONAL: the live vantage reads
   * an absent value as NOT present, which is the waiting side, and the
   * hindsight vantage does not read it at all.
   */
  readonly playoffPointsPresent?: boolean;
  /**
   * The awards list has stood unchanged for `AWARDS_SETTLE_MS` (quick task
   * 261009-tx6). OPTIONAL: the live vantage reads an absent value as not
   * settled, and the hindsight vantage does not read it at all.
   */
  readonly listSettled?: boolean;
  /**
   * The list holds every consuming award an event of its kind gives (quick
   * task 261009-vp9, `expectedAwardsListed`). OPTIONAL: the live vantage
   * reads an absent value as NOT listed, which is the waiting side, and the
   * hindsight vantage does not read it at all.
   */
  readonly expectedAwardsListed?: boolean;
  /**
   * The awards list has stood unchanged for `AWARDS_SETTLE_WITHOUT_IMPACT_MS`
   * (quick task 261009-vp9). OPTIONAL: read at the live vantage only, and
   * only where an expected award is not listed. Absent reads as not settled.
   */
  readonly listSettledLong?: boolean;
}

/** Who is asking: the Worker during the event, or the publisher after it. */
export type AwardsPostedVantage = "live" | "hindsight";

/**
 * Whether an event's awards read as posted.
 *
 * Live: a judged award AND award points AND playoff points AND a settled
 * list. Which settle fact counts depends on the list: where every expected award is listed
 * (`expectedAwardsListed` exactly `true`) it is `listSettled`, 60 minutes;
 * otherwise it is `listSettledLong`, 12 hours. Each is read as true only when
 * it is exactly `true`.
 *
 * Hindsight: either of the first two, and nothing else is read.
 *
 * This function only answers for the facts it is handed. A flag that is
 * already published true stays true, and that is the caller's rule: awards do
 * not un post.
 */
export function awardsPostedRule(facts: AwardsPostedFacts, vantage: AwardsPostedVantage): boolean {
  if (vantage === "hindsight") return facts.judgedAwardListed || facts.awardPointsPresent;
  if (!facts.judgedAwardListed || !facts.awardPointsPresent || facts.playoffPointsPresent !== true) return false;
  return facts.expectedAwardsListed === true ? facts.listSettled === true : facts.listSettledLong === true;
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
