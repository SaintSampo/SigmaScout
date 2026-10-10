/**
 * THE FINALS OF A DIVISIONED DISTRICT CHAMPIONSHIP, and the shape of a
 * district's championships (quick task 261009-kt3). Pure, no I/O, no zod, no
 * React.
 *
 * FIM plays four divisions (`2026micmp1` to `2026micmp4`) and NE, ON and TX
 * two (`2026necmp1`, `2026necmp2`), each an ordinary eight alliance double
 * elimination event. Each division's winning alliance then plays the FINALS,
 * a separate dcmp tier event keyed by the championship stem (`2026micmp`,
 * `2026necmp`) with no qualification matches:
 *
 *   - Four divisions (TBA playoff type 11, confirmed on 2024 to 2026 micmp):
 *     sf1 is alliance 1 against 4 and sf2 is 2 against 3; sf3 sends the winners
 *     of sf1 and sf2 against each other and its winner to the final; sf4 sends
 *     their losers against each other and its loser is fourth; sf5 sends the
 *     loser of sf3 against the winner of sf4, its winner to the final and its
 *     loser third; the final is best of three.
 *   - Two divisions (TBA playoff type 9): the final alone, best of three.
 *
 * A finals alliance number follows no division number (2023micmp alliance 2
 * was micmp4's winner); the caller maps a finals alliance to its division by
 * roster.
 *
 * WHY THE ROUTING COUNTS EVERY PLAYED DECISION OF A SET rather than stopping at
 * a gap, as `routePlayedBracket` does for the eight alliance bracket: TBA
 * replays a tied finals match under a new match number. 2024necmp shows
 * `f1m1` tied, then `f1m2`, `f1m3` and `f1m4`; the champion is the first
 * alliance to two wins among the played rows. A tie carries no winner and is
 * no decision. An alliance at the needed wins decides the set; both alliances
 * at the needed wins is a mis-mapped series and is refused.
 *
 * A LONE DIVISION KEY IS NOT A SINGLE CHAMPIONSHIP (quick task 261010-66y,
 * D2). At a live championship TBA can post one division's rows before any
 * other row of that championship, and the artifact learns a key only from
 * rows. `championshipShape` calls such a key set unsupported, so the single
 * event proof never runs on one division as if it were the whole
 * championship.
 *
 * THE FINALS EVENT NOT YET ON THE WIRE (quick task 261010-d7r, D2; first
 * built as D3 of quick task 261010-66y and refused there). TBA writes a
 * finals row only for a team it pays there, so at a LIVE divisioned
 * championship the finals key is on no row for the whole of the division
 * playoffs, and the artifact learns a key only from rows. Read plainly, the
 * division keys alone are "divisions without their finals event", which is
 * unsupported, so the joint proof could not run during the division playoffs
 * at all. `championshipShape` therefore takes a second argument,
 * `finalsMayBeAbsent`: with it, one stem holding exactly 2 or 4 digit
 * suffixed keys and no parent is DIVISIONED, the stem its finals key. The
 * finals then read as not started and wholly open: no row, no stage, no
 * facts, no Winner, every finals category open.
 *
 * WHO MAY PASS IT. Only a caller at the live position whose field is proven
 * complete BY CAPACITY (`dcmpFieldProof`, `completeBy === "capacity"`).
 * Without that the keys on the rows say nothing about how many divisions
 * there are: two of FIM's four divisions on the rows would read as a complete
 * two division championship, and the other two divisions' winners, alliances
 * and awards would be unmodelled. With the field at capacity every division
 * is on the rows. It defaults to false, so every rewound stop and every sweep
 * over finished seasons, where the parent key is always on the rows, reads
 * exactly as before.
 *
 * WHY THE REFUSAL OF QUICK TASK 261010-66y IS LIFTED. That task built this
 * reading and did not ship it: on the live walk of the real 2026 artifacts
 * the proof, running during the division playoffs, took its own Locked back
 * at the tick the divisions' Awards read final (2026 FIM 1 team, frc5675; NE
 * 2, frc4909 and frc2713; TX 2, frc624 and frc9140; ONT 0). The cause was
 * never the shape. It was the proof's judged award budget going to a rival
 * that already held a posted award, which quick task 261010-d7r closed (its
 * rule D1, in `champJointLock.ts`: "A RIVAL THAT HOLDS A POSTED AWARD TAKES
 * NO FURTHER JUDGED AWARD").
 *
 * TWO SEPARATE PROOFS HOLD IT (`scripts/champFieldStagedWalk.test.ts`,
 * measured 2026-10-10), and neither stands in for the other:
 *
 *   - THE READING IS THE SAME ONE (group 13). Over the 16 divisioned
 *     championships of 2023 to 2026 and the 112 stops before the finals have
 *     a played row, the proof on the artifact with the finals key's rows
 *     removed equals the proof with them present: the same applied flag, the
 *     same input, every pool team's bound (28,140 compared), the same locked
 *     set, the same reservation, every floor and ceiling, the same teams
 *     shown Locked and the same `lockedBy`. No difference in any column.
 *   - THE READING IS HELD LIVE (group 10, and group D of
 *     `scripts/champJointMonotone.test.ts`). On the live walks of 2026 FIM,
 *     NE, ONT and TX the proof runs from the tick the alliance points land,
 *     through the window between the divisions and the finals and the tick
 *     the finals rows post, and no team shown Locked is later not Locked.
 *     Walked one fact at a time, in every order of the division flags and
 *     the finals facts (the 12 two division championships of 2023 to 2026
 *     and 2026 FIM): no Locked lost and no margin dropped, the tick the
 *     field proof turns true mid playoffs (which switches this reading on)
 *     included.
 *
 * WHAT IT RESTS ON, STATED. The reading is as sound as the capacity proof of
 * the field. If a field proven by capacity were read unproven again (the
 * published capacity raised, or rows withdrawn, during a championship) the
 * proof would refuse and what it alone held would be lost. Forced in
 * `scripts/champJointMonotone.test.ts` over every walk of its group D, under
 * a title that says FORCED and NOT REQUIRED, that is 765 Locked lost at 85
 * readings; it was 596 before this reading, which holds more and holds it
 * earlier. No walked path does it: the field proof's count never rises while
 * rows are only added (`dcmpFieldProof.ts`). The same was already true of a
 * championship whose finals key is on the rows.
 */
import {
  bracketDecisionKey,
  InvalidBracketDecisionError,
  UnsupportedAllianceCountError,
  type BracketFeed,
  type PlayedBracketMatch,
} from "./bracket.js";
import { championshipStemOf } from "./champReservedSlots.js";

/** One set of the finals: its two feeds and how many wins decide it. */
export interface FinalsSet {
  readonly id: string;
  readonly feedA: BracketFeed;
  readonly feedB: BracketFeed;
  readonly winsNeeded: number;
}

const seed = (n: number): BracketFeed => ({ kind: "seed", seed: n });
const winnerOf = (setId: string): BracketFeed => ({ kind: "winner", setId });
const loserOf = (setId: string): BracketFeed => ({ kind: "loser", setId });

/** The finals topology by alliance count, in dependency order. */
export const FINALS_SETS: Readonly<Record<2 | 4, readonly FinalsSet[]>> = {
  2: [{ id: "f", feedA: seed(1), feedB: seed(2), winsNeeded: 2 }],
  4: [
    { id: "sf1", feedA: seed(1), feedB: seed(4), winsNeeded: 1 },
    { id: "sf2", feedA: seed(2), feedB: seed(3), winsNeeded: 1 },
    { id: "sf3", feedA: winnerOf("sf1"), feedB: winnerOf("sf2"), winsNeeded: 1 },
    { id: "sf4", feedA: loserOf("sf1"), feedB: loserOf("sf2"), winsNeeded: 1 },
    { id: "sf5", feedA: loserOf("sf3"), feedB: winnerOf("sf4"), winsNeeded: 1 },
    { id: "f", feedA: winnerOf("sf3"), feedB: winnerOf("sf5"), winsNeeded: 2 },
  ],
};

/** The sets whose LOSER takes a fixed placement below second, by alliance count: index 0 is third. */
const PLACEMENT_FROM_LOSER_OF: Readonly<Record<2 | 4, readonly string[]>> = {
  2: [],
  4: ["sf5", "sf4"],
};

function assertFinalsAllianceCount(allianceCount: number): asserts allianceCount is 2 | 4 {
  if (allianceCount !== 2 && allianceCount !== 4) {
    throw new UnsupportedAllianceCountError(`a divisioned District Championship's finals has 2 or 4 alliances, got ${String(allianceCount)}`);
  }
}

/**
 * TBA's `(comp_level, set_number)` onto the finals topology's set id: `sf` 1 to
 * 5 and `f` 1 at four alliances, `f` 1 alone at two, anything else `undefined`.
 */
export function finalsSetIdFor(compLevel: string, setNumber: number, allianceCount: number): string | undefined {
  if (allianceCount !== 2 && allianceCount !== 4) return undefined;
  if (compLevel === "f") return setNumber === 1 ? "f" : undefined;
  if (compLevel === "sf" && allianceCount === 4 && Number.isInteger(setNumber) && setNumber >= 1 && setNumber <= 5) return `sf${String(setNumber)}`;
  return undefined;
}

/** The played finals rows as decisions keyed by `bracketDecisionKey`. A row this topology does not carry is dropped. */
export function finalsDecisionsFromPlayedMatches(matches: readonly PlayedBracketMatch[], allianceCount: number): ReadonlyMap<string, number> {
  const decisions = new Map<string, number>();
  for (const match of matches) {
    const setId = finalsSetIdFor(match.compLevel, match.setNumber, allianceCount);
    if (setId === undefined) continue;
    decisions.set(bracketDecisionKey(setId, match.matchNumber), match.winningAllianceNumber);
  }
  return decisions;
}

/** What the played finals rows decide, and nothing beyond it. */
export interface FinalsRouting {
  readonly winnerBySet: ReadonlyMap<string, number>;
  readonly loserBySet: ReadonlyMap<string, number>;
  /** Set id -> its two alliances, for every set whose feeds are both resolved. */
  readonly participantsBySet: ReadonlyMap<string, readonly [number, number]>;
  /** Alliance number -> final finals placement, for the alliances the played rows place. Never padded. */
  readonly placementByAlliance: ReadonlyMap<number, number>;
  /** The placement 1 alliance, once the final is decided. */
  readonly champion: number | undefined;
}

/**
 * Routes as much of the finals as the played decisions determine. Every
 * played decision of a set counts (this module's header); a decision naming an
 * alliance that is not one of the set's two participants, or a set where both
 * reach the needed wins, throws `InvalidBracketDecisionError`.
 */
export function routeFinals(decisions: ReadonlyMap<string, number>, allianceCount: number): FinalsRouting {
  assertFinalsAllianceCount(allianceCount);
  const winnerBySet = new Map<string, number>();
  const loserBySet = new Map<string, number>();
  const participantsBySet = new Map<string, readonly [number, number]>();
  const winnersBySetId = new Map<string, number[]>();
  for (const [key, winner] of decisions) {
    const setId = key.slice(0, key.lastIndexOf(":"));
    const list = winnersBySetId.get(setId) ?? [];
    list.push(winner);
    winnersBySetId.set(setId, list);
  }
  const resolveFeed = (feed: BracketFeed): number | undefined => {
    if (feed.kind === "seed") return feed.seed;
    return (feed.kind === "winner" ? winnerBySet : loserBySet).get(feed.setId);
  };

  for (const set of FINALS_SETS[allianceCount]) {
    const allianceA = resolveFeed(set.feedA);
    const allianceB = resolveFeed(set.feedB);
    const played = winnersBySetId.get(set.id) ?? [];
    if (allianceA === undefined || allianceB === undefined) {
      if (played.length > 0) {
        throw new InvalidBracketDecisionError(`finals set ${set.id} has a played decision while its participants are not both decided — refusing to route a mis-mapped series`);
      }
      continue;
    }
    participantsBySet.set(set.id, [allianceA, allianceB]);
    let winsA = 0;
    let winsB = 0;
    for (const winner of played) {
      if (winner === allianceA) winsA++;
      else if (winner === allianceB) winsB++;
      else {
        throw new InvalidBracketDecisionError(
          `finals set ${set.id} names alliance ${String(winner)} as a winner, which is neither ${String(allianceA)} nor ${String(allianceB)} — refusing to route a mis-mapped match`
        );
      }
    }
    if (winsA >= set.winsNeeded && winsB >= set.winsNeeded) {
      throw new InvalidBracketDecisionError(`finals set ${set.id} has both alliances at ${String(set.winsNeeded)} wins — refusing to route a mis-mapped series`);
    }
    if (winsA < set.winsNeeded && winsB < set.winsNeeded) continue;
    const setWinner = winsA >= set.winsNeeded ? allianceA : allianceB;
    winnerBySet.set(set.id, setWinner);
    loserBySet.set(set.id, setWinner === allianceA ? allianceB : allianceA);
  }

  const placementByAlliance = new Map<number, number>();
  const champion = winnerBySet.get("f");
  if (champion !== undefined) {
    placementByAlliance.set(champion, 1);
    placementByAlliance.set(loserBySet.get("f")!, 2);
  }
  PLACEMENT_FROM_LOSER_OF[allianceCount].forEach((setId, index) => {
    const loser = loserBySet.get(setId);
    if (loser !== undefined) placementByAlliance.set(loser, index + 3);
  });
  return { winnerBySet, loserBySet, participantsBySet, placementByAlliance, champion };
}

/** A district's championships, read from its dcmp tier event keys (CONTEXT D1). */
export type ChampionshipShape =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly key: string }
  | { readonly kind: "divisioned"; readonly stem: string; readonly finalsKey: string; readonly divisionKeys: readonly string[] }
  | { readonly kind: "multiple"; readonly keys: readonly string[] }
  | { readonly kind: "unsupported"; readonly detail: string };

/**
 * Groups the dcmp tier keys by `championshipStemOf`. One stem with one key is
 * SINGLE; one stem holding its parent key plus 2 or 4 digit suffixed division
 * keys is DIVISIONED (the parent is the finals); several stems each holding
 * exactly one key is MULTIPLE (2026 California); no key is `none`; anything
 * else is unsupported and the caller keeps the shipped path.
 *
 * A stem whose ONLY member is a digit suffixed key (a division without its
 * siblings or its finals event) is unsupported, not single (quick task
 * 261010-66y, D2). No published district holds such a key set: over the 109
 * local district artifacts every digit suffixed dcmp key sits beside its
 * parent.
 *
 * `finalsMayBeAbsent` (quick task 261010-d7r, D2; this module's header, "THE
 * FINALS EVENT NOT YET ON THE WIRE"): with it, one stem holding exactly 2 or
 * 4 digit suffixed keys and NO parent is divisioned with the stem as
 * `finalsKey`. Where the parent is on the rows, and at every other key set,
 * it changes nothing. It defaults to false.
 */
export function championshipShape(dcmpEventKeys: readonly string[], finalsMayBeAbsent = false): ChampionshipShape {
  const keys = [...new Set(dcmpEventKeys)].sort();
  if (keys.length === 0) return { kind: "none" };
  const byStem = new Map<string, string[]>();
  for (const key of keys) {
    const stem = championshipStemOf(key);
    const list = byStem.get(stem) ?? [];
    list.push(key);
    byStem.set(stem, list);
  }
  if (byStem.size === 1) {
    const [stem, members] = [...byStem][0]!;
    if (members.length === 1) {
      if (members[0] !== stem) return { kind: "unsupported", detail: `a division without its siblings or its finals event (${members[0]!})` };
      return { kind: "single", key: members[0]! };
    }
    const divisionKeys = members.filter((key) => key !== stem).sort();
    const finalsNotYetOnTheWire = finalsMayBeAbsent && (divisionKeys.length === 2 || divisionKeys.length === 4);
    if (!members.includes(stem) && !finalsNotYetOnTheWire) return { kind: "unsupported", detail: `divisions without their finals event (${members.join(", ")})` };
    if (divisionKeys.length !== 2 && divisionKeys.length !== 4) {
      return { kind: "unsupported", detail: `${String(divisionKeys.length)} divisions (${members.join(", ")})` };
    }
    return { kind: "divisioned", stem, finalsKey: stem, divisionKeys };
  }
  if ([...byStem.values()].every((members) => members.length === 1)) return { kind: "multiple", keys };
  return { kind: "unsupported", detail: `several championships, one of them divisioned (${keys.join(", ")})` };
}
