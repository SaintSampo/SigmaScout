/**
 * The finals of a divisioned District Championship and the championship shape
 * (quick task 261009-kt3, CONTEXT D1, D2, D7). Pure, no corpus: the real match
 * lists below were read from `data/corpus.sqlite` while planning and are
 * written out as alliance numbered decisions in the finals event's own
 * numbering.
 */
import { describe, expect, it } from "vitest";
import { bracketDecisionKey, InvalidBracketDecisionError, UnsupportedAllianceCountError, type BracketFeed } from "./bracket.js";
import { championshipShape, FINALS_SETS, finalsDecisionsFromPlayedMatches, finalsSetIdFor, routeFinals } from "./finalsBracket.js";

/** Decisions from (set id, winners in match order) pairs, match numbers from 1. */
function decisionsOf(sets: readonly (readonly [string, readonly number[]])[]): Map<string, number> {
  const decisions = new Map<string, number>();
  for (const [setId, winners] of sets) winners.forEach((winner, index) => decisions.set(bracketDecisionKey(setId, index + 1), winner));
  return decisions;
}

/** Every completion of the finals: each sf set either way, the final as every 2 to 0 and 2 to 1 series. */
function everyCompletion(allianceCount: 2 | 4): Map<string, number>[] {
  const sets = FINALS_SETS[allianceCount];
  const out: Map<string, number>[] = [];
  const seriesPatterns: readonly (readonly ("A" | "B")[])[] = [
    ["A", "A"],
    ["B", "B"],
    ["A", "B", "A"],
    ["A", "B", "B"],
    ["B", "A", "A"],
    ["B", "A", "B"],
  ];
  const visit = (index: number, decisions: Map<string, number>, winners: Map<string, number>, losers: Map<string, number>): void => {
    if (index === sets.length) {
      out.push(new Map(decisions));
      return;
    }
    const set = sets[index]!;
    const resolve = (feed: BracketFeed): number => (feed.kind === "seed" ? feed.seed : (feed.kind === "winner" ? winners : losers).get(feed.setId)!);
    const a = resolve(set.feedA);
    const b = resolve(set.feedB);
    const patterns = set.winsNeeded === 1 ? [["A"], ["B"]] : seriesPatterns;
    for (const pattern of patterns) {
      const next = new Map(decisions);
      pattern.forEach((side, matchIndex) => next.set(bracketDecisionKey(set.id, matchIndex + 1), side === "A" ? a : b));
      const wins = pattern.filter((side) => side === "A").length;
      const winner = wins >= set.winsNeeded ? a : b;
      visit(index + 1, next, new Map(winners).set(set.id, winner), new Map(losers).set(set.id, winner === a ? b : a));
    }
  };
  visit(0, new Map(), new Map(), new Map());
  return out;
}

describe("routeFinals (quick task 261009-kt3, D2)", () => {
  it("routes every completion of the four alliance finals to a bijection onto placements 1 to 4", () => {
    const completions = everyCompletion(4);
    expect(completions.length).toBe(32 * 6);
    for (const decisions of completions) {
      const routing = routeFinals(decisions, 4);
      expect([...routing.placementByAlliance.keys()].sort()).toEqual([1, 2, 3, 4]);
      expect([...routing.placementByAlliance.values()].sort()).toEqual([1, 2, 3, 4]);
      expect(routing.placementByAlliance.get(routing.champion!)).toBe(1);
    }
  });

  it("routes every completion of the two alliance finals to a bijection onto placements 1 and 2", () => {
    for (const decisions of everyCompletion(2)) {
      const routing = routeFinals(decisions, 2);
      expect([...routing.placementByAlliance.values()].sort()).toEqual([1, 2]);
      expect(routing.placementByAlliance.get(routing.champion!)).toBe(1);
    }
  });

  it("routes the real 2026, 2025 and 2024 micmp finals to their real placements", () => {
    const real: readonly { label: string; sets: readonly (readonly [string, readonly number[]])[]; placements: readonly [number, number, number, number] }[] = [
      { label: "2026micmp", sets: [["sf1", [1]], ["sf2", [3]], ["sf3", [1]], ["sf4", [4]], ["sf5", [4]], ["f", [1, 1]]], placements: [1, 4, 3, 2] },
      { label: "2025micmp", sets: [["sf1", [1]], ["sf2", [2]], ["sf3", [2]], ["sf4", [4]], ["sf5", [4]], ["f", [2, 4, 2]]], placements: [2, 4, 1, 3] },
      { label: "2024micmp", sets: [["sf1", [4]], ["sf2", [2]], ["sf3", [2]], ["sf4", [1]], ["sf5", [1]], ["f", [2, 2]]], placements: [2, 1, 4, 3] },
    ];
    for (const { label, sets, placements } of real) {
      const routing = routeFinals(decisionsOf(sets), 4);
      expect(routing.champion, label).toBe(placements[0]);
      placements.forEach((allianceNumber, index) => expect(routing.placementByAlliance.get(allianceNumber), `${label} placement ${index + 1}`).toBe(index + 1));
    }
  });

  it("counts every played decision of a series: 2024necmp (f1m1 tied, then a2, a2, a1) and 2026necmp route to alliance 2", () => {
    const necmp2024 = new Map([
      [bracketDecisionKey("f", 2), 2],
      [bracketDecisionKey("f", 3), 2],
      [bracketDecisionKey("f", 4), 1],
    ]);
    expect(routeFinals(necmp2024, 2).champion).toBe(2);
    expect(routeFinals(decisionsOf([["f", [1, 2, 2]]]), 2).champion).toBe(2);
    expect(routeFinals(decisionsOf([["f", [1, 2, 2]]]), 2).placementByAlliance.get(1)).toBe(2);
  });

  it("places nobody from a partial list: sf1 and sf2 only", () => {
    const routing = routeFinals(decisionsOf([["sf1", [1]], ["sf2", [3]]]), 4);
    expect(routing.placementByAlliance.size).toBe(0);
    expect(routing.champion).toBeUndefined();
    expect(routing.participantsBySet.get("sf3")).toEqual([1, 3]);
    expect(routing.participantsBySet.get("sf4")).toEqual([4, 2]);
  });

  it("refuses a decision naming a non participant, and a series where both reach the needed wins", () => {
    expect(() => routeFinals(decisionsOf([["sf1", [2]]]), 4)).toThrow(InvalidBracketDecisionError);
    expect(() => routeFinals(decisionsOf([["f", [1, 1, 2, 2]]]), 2)).toThrow(InvalidBracketDecisionError);
    expect(() => routeFinals(decisionsOf([["sf3", [1]]]), 4)).toThrow(InvalidBracketDecisionError);
    expect(() => routeFinals(new Map(), 3)).toThrow(UnsupportedAllianceCountError);
  });

  it("maps TBA's coordinates onto the finals topology and drops anything else", () => {
    expect(finalsSetIdFor("sf", 5, 4)).toBe("sf5");
    expect(finalsSetIdFor("sf", 6, 4)).toBeUndefined();
    expect(finalsSetIdFor("sf", 1, 2)).toBeUndefined();
    expect(finalsSetIdFor("f", 1, 2)).toBe("f");
    expect(finalsSetIdFor("f", 2, 4)).toBeUndefined();
    expect(finalsSetIdFor("qm", 1, 4)).toBeUndefined();
    const decisions = finalsDecisionsFromPlayedMatches(
      [
        { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
        { compLevel: "sf", setNumber: 9, matchNumber: 1, winningAllianceNumber: 1 },
        { compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 4 },
      ],
      4
    );
    expect([...decisions]).toEqual([
      ["sf1:1", 1],
      ["f:2", 4],
    ]);
  });
});

describe("championshipShape (quick task 261009-kt3, D1)", () => {
  it("reads none, single, divisioned and multiple from the dcmp tier keys", () => {
    expect(championshipShape([])).toEqual({ kind: "none" });
    expect(championshipShape(["2026nccmp"])).toEqual({ kind: "single", key: "2026nccmp" });
    expect(championshipShape(["2026micmp4", "2026micmp", "2026micmp1", "2026micmp3", "2026micmp2"])).toEqual({
      kind: "divisioned",
      stem: "2026micmp",
      finalsKey: "2026micmp",
      divisionKeys: ["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"],
    });
    expect(championshipShape(["2026necmp", "2026necmp2", "2026necmp1"])).toEqual({
      kind: "divisioned",
      stem: "2026necmp",
      finalsKey: "2026necmp",
      divisionKeys: ["2026necmp1", "2026necmp2"],
    });
    expect(championshipShape(["2026cascmp", "2026cancmp"])).toEqual({ kind: "multiple", keys: ["2026cancmp", "2026cascmp"] });
  });

  it("a lone division key is not a single championship (quick task 261010-66y, D2)", () => {
    // A division without its siblings or its finals event: the artifact has
    // seen one division's rows and nothing else of that championship, so the
    // single event proof must never run on it.
    for (const lone of ["2026micmp1", "2026necmp2", "2026txcmp1"]) {
      const shape = championshipShape([lone]);
      expect({ lone, kind: shape.kind }).toEqual({ lone, kind: "unsupported" });
      expect(shape.kind === "unsupported" ? shape.detail : "").toContain(lone);
    }
    // A lone key that is its own stem is still a single championship.
    expect(championshipShape(["2026pncmp"])).toEqual({ kind: "single", key: "2026pncmp" });
    expect(championshipShape(["2026micmp"])).toEqual({ kind: "single", key: "2026micmp" });
  });

  describe("the finals event not yet on the wire (quick task 261010-d7r, D2; first built as D3 of quick task 261010-66y and refused there)", () => {
    const FIM = ["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    const NE = ["2026necmp1", "2026necmp2"];

    it("with the flag, two or four digit suffixed keys on one stem and no parent are divisioned, the stem the finals key", () => {
      expect(championshipShape(FIM, true)).toEqual({ kind: "divisioned", stem: "2026micmp", finalsKey: "2026micmp", divisionKeys: FIM });
      expect(championshipShape(["2026necmp2", "2026necmp1"], true)).toEqual({ kind: "divisioned", stem: "2026necmp", finalsKey: "2026necmp", divisionKeys: NE });
    });

    it("with the flag, one or three divisions without the parent are still unsupported", () => {
      expect(championshipShape(["2026micmp1"], true).kind).toBe("unsupported");
      expect(championshipShape(FIM.slice(0, 3), true).kind).toBe("unsupported");
    });

    it("the flag changes nothing where the parent is on the rows, or at any other shape", () => {
      const sets: readonly (readonly string[])[] = [
        [],
        ["2026nccmp"],
        ["2026micmp", ...FIM],
        ["2026necmp", ...NE],
        ["2026cascmp", "2026cancmp"],
        ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3"],
        ["2026micmp", "2026micmp1"],
        ["2026cancmp", "2026cascmp", "2026cascmp1", "2026cascmp2"],
        ["2026cancmp", "2026cascmp1", "2026cascmp2"],
      ];
      for (const keys of sets) expect(championshipShape(keys, true), keys.join(",")).toEqual(championshipShape(keys));
    });

    it("without the flag, and with it false, divisions without their finals event are unsupported, as before", () => {
      for (const keys of [FIM, NE]) {
        expect(championshipShape(keys).kind).toBe("unsupported");
        expect(championshipShape(keys, false)).toEqual(championshipShape(keys));
      }
    });
  });

  it("calls every other grouping unsupported", () => {
    // Division keys with no parent, read WITHOUT `finalsMayBeAbsent`: every rewound stop and every sweep.
    expect(championshipShape(["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"]).kind).toBe("unsupported");
    expect(championshipShape(["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3"]).kind).toBe("unsupported");
    expect(championshipShape(["2026micmp", "2026micmp1"]).kind).toBe("unsupported");
    expect(championshipShape(["2026cancmp", "2026cascmp", "2026cascmp1", "2026cascmp2"]).kind).toBe("unsupported");
  });
});
