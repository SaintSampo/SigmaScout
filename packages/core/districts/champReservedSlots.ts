/**
 * How many FIRST Championship slots are held back at the champ tier for
 * qualifications the District Championship can still hand out regardless of
 * points. Pure, no I/O, no zod, no React — the browser's champ status module
 * and the publisher's verdict pass call the SAME rule, exactly as
 * `reservedSlots.ts` beside it serves the district tier.
 *
 * ---------------------------------------------------------------------------
 * WHY A CHAMP-TIER RESERVATION EXISTS (quick task 261006-3gg)
 * ---------------------------------------------------------------------------
 *
 * Jacob, 2026-10-06: "at any point a team is only locked if it is impossible
 * for them to not qualify." `locks.ts`'s ceiling test proves a lock by counting
 * the rivals whose CEILING can reach a team's FLOOR. A DCMP consuming award
 * breaks that proof: it hands a slot to its winner whatever the winner's points
 * are, so a rival whose ceiling sits below the team's floor — never counted as a
 * threat — can still take a slot out of the pool. Two kinds of qualification
 * do this at a DCMP:
 *
 *   - THE WINNING ALLIANCE, every member, while the playoffs are open. A fourth
 *     pick with a ceiling below a locked team's floor can still win.
 *   - THE JUDGED CONSUMING AWARDS, Impact, Engineering Inspiration and Rookie
 *     All Star, while the awards are open. Rookie All Star in particular goes
 *     to a rookie, almost always far down the standings.
 *
 * FNC 2026 is the measured case. At the "DCMP playoffs done, awards open" stop
 * frc7890 read `Locked` with 10 threats against 11 slots. Four of the five
 * judged consuming awards (two EI, two RAS) then went to teams whose ceilings
 * sat below 7890's floor, cutting the slots to 7 without removing a threat.
 * 7890 qualified only because it won a judged award itself.
 *
 * So one slot is HELD BACK per qualification still to come, and the
 * reservation feeds `lockSlots` alone: `"eliminated"`, the published cut line
 * and the In range rank rule stay on the unreserved count, for the reason
 * `locks.ts`'s `computeLocksSplit` states.
 *
 * ---------------------------------------------------------------------------
 * THE COUNTS ARE CEILINGS, NOT ANCHORS
 * ---------------------------------------------------------------------------
 *
 * The champ cutoff model reads `dcmpAwardCounts`, the district's previous
 * season, because it is predicting. A guarantee reads
 * `dcmpAwardCountCeilings`, the most the district's own past OR its size band
 * has ever given out, because a count that grew between seasons (FNC's Rookie
 * All Star, 1 to 2 for 2023) would otherwise under-reserve by exactly the slot
 * the guarantee is about. The alliance size is TBA's own maximum of four picks.
 *
 * ---------------------------------------------------------------------------
 * WHEN NOTHING IS RESERVED
 * ---------------------------------------------------------------------------
 *
 *   1. AWARDS FINAL. The event is over: posted winners already consume their
 *      slots in `qualifierPool`, and no playoff can follow an awards ceremony.
 *      So awards final zeroes the winner reservation too — the 2020 District
 *      Championships posted their Chairman's awards without playing a match.
 *   2. THE DCMP IS NEVER HAPPENING. A past season whose championship never
 *      started and never published a schedule (2020isr) must reserve nothing,
 *      or no team in that season would ever lock. The year clause is what keeps
 *      the current season conservative: between a district's last event and
 *      the DCMP's registration list a current season looks exactly like a
 *      cancelled one, and that window is one the guarantee has to cover.
 */
import type { DistrictEventStateFacts } from "./reservedSlots.js";
import { districtEventStateStarted } from "./reservedSlots.js";
import { DCMP_DRAWN_AWARD_TYPES, type DcmpDrawnAwardType } from "./hypotheticalDcmp.js";

/** TBA's own maximum alliance size: a captain and three picks. Every member of the winning alliance qualifies. */
export const MAX_WINNING_ALLIANCE_SIZE = 4;

export interface ChampReservationInput {
  /** Whether the DCMP's playoffs category is final at the position. */
  readonly elimFinal: boolean;
  /** Whether the DCMP's awards category is final at the position. */
  readonly awardFinal: boolean;
  /** Per judged consuming type, the most the DCMP could give out — `dcmpAwardCountCeilings(...).counts`. */
  readonly awardCeilings: Readonly<Record<DcmpDrawnAwardType, number>>;
  /** True for a championship that will never be played — see `dcmpNeverHappening`. */
  readonly neverHappening: boolean;
}

/** The slots held back for the judged consuming awards alone. */
export function pendingAwardSlots(awardCeilings: Readonly<Record<DcmpDrawnAwardType, number>>): number {
  let total = 0;
  for (const type of DCMP_DRAWN_AWARD_TYPES) total += Math.max(awardCeilings[type], 0);
  return total;
}

/**
 * The champ-tier reservation at one position. Zero once the awards are final
 * or for a championship that is never happening; otherwise the winning
 * alliance while the playoffs are open, plus every judged consuming award
 * while the awards are open.
 */
export function reservedChampSlots(input: ChampReservationInput): number {
  if (input.neverHappening || input.awardFinal) return 0;
  const winners = input.elimFinal ? 0 : MAX_WINNING_ALLIANCE_SIZE;
  return winners + pendingAwardSlots(input.awardCeilings);
}

/**
 * A dcmp-tier event key's CHAMPIONSHIP STEM: the key with any trailing
 * division digits removed. `2026micmp1` and `2026micmp` are one championship
 * (FIM plays four divisions into one finals event, and TBA publishes all five
 * as dcmp-tier events); `2026cascmp` and `2026cancmp` are two (2026 California
 * ran two championships the same week). Quick task 261006-lwo.
 */
export function championshipStemOf(eventKey: string): string {
  return eventKey.replace(/\d+$/, "");
}

/**
 * One value per CHAMPIONSHIP from a value per dcmp-tier event: the parent
 * event's (the key equal to the stem) where the artifact carries it, the lone
 * member's for a championship published as a single event, and `fallback`
 * for a championship whose divisions are on the artifact but whose parent is
 * not yet — the finals have not been reached, so nothing about them is final.
 */
export function perChampionship<T>(byEvent: ReadonlyMap<string, T>, fallback: T): Map<string, T> {
  const members = new Map<string, string[]>();
  for (const key of byEvent.keys()) {
    const stem = championshipStemOf(key);
    const list = members.get(stem) ?? [];
    list.push(key);
    members.set(stem, list);
  }
  const out = new Map<string, T>();
  for (const [stem, keys] of members) {
    if (byEvent.has(stem)) out.set(stem, byEvent.get(stem)!);
    else if (keys.length === 1) out.set(stem, byEvent.get(keys[0]!)!);
    else out.set(stem, fallback);
  }
  return out;
}

export interface DcmpNeverHappeningInput {
  /** Every (team, event) state block observed for the DCMP at "now", `undefined` entries included. */
  readonly dcmpStates: readonly (DistrictEventStateFacts | undefined)[];
  readonly artifactYear: number;
  /** The calendar year at the time of the call — never the rewound position's. */
  readonly nowYear: number;
}

/**
 * True when the District Championship will never be played: a PAST season
 * whose championship has not started on any observed state block and has no
 * published qualification schedule on any of them. A current season never
 * reports true, which is the conservative answer for the registration window.
 */
export function dcmpNeverHappening(input: DcmpNeverHappeningInput): boolean {
  if (input.artifactYear >= input.nowYear) return false;
  for (const state of input.dcmpStates) {
    if (state === undefined) continue;
    if (districtEventStateStarted(state)) return false;
    if (state.qualMatchesTotal !== null) return false;
  }
  return true;
}
