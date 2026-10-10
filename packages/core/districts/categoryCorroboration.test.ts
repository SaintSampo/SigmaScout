/**
 * `categoryCorroboration.ts`: a category's NUMBER reads final only when the
 * event's state says the stage is over AND the points that prove it are in the
 * district artifact's rows (quick task 261009-vp9).
 *
 * Pure and synthetic. The rule is four booleans read against three presence
 * facts, so every case here is a state block and a presence object, and the
 * presence builder is driven with hand built rows.
 *
 * THE CASE THAT MATTERS MOST is "never closes early": over every combination
 * of state and presence, a category the rule reads final is read final by the
 * state's own reading too. The rule may only ever OPEN a category.
 */
import { describe, expect, it } from "vitest";
import {
  NO_POINTS_PRESENT,
  categoryPointsPresenceByEvent,
  corroboratedCategoryFinality,
  divisionCountOf,
  finalsChampionMaximum,
  type CategoryPointsPresence,
} from "./categoryCorroboration.js";
import { ALL_CATEGORIES_OPEN, districtEventCategoryFinality, type DistrictEventStateFacts } from "./reservedSlots.js";
import type { DistrictTier } from "./pointModel.js";

const state = (over: Partial<DistrictEventStateFacts> = {}): DistrictEventStateFacts => ({
  qualMatchesPlayed: 60,
  qualMatchesTotal: 60,
  alliancesPicked: false,
  playoffsDone: false,
  awardsPosted: false,
  ...over,
});
const presence = (over: Partial<CategoryPointsPresence> = {}): CategoryPointsPresence => ({ ...NO_POINTS_PRESENT, ...over });

const EVERY_PRESENCE: CategoryPointsPresence[] = [];
for (const alliancePoints of [false, true]) for (const winnerPlayoffPoints of [false, true]) for (const finalsEvent of [false, true]) EVERY_PRESENCE.push({ alliancePoints, winnerPlayoffPoints, finalsEvent });

describe("corroboratedCategoryFinality: Awards", () => {
  it("is final exactly when awardsPosted is true, whatever the presence says", () => {
    for (const facts of EVERY_PRESENCE) {
      expect(corroboratedCategoryFinality(state({ alliancesPicked: true, playoffsDone: true, awardsPosted: true }), facts).award).toBe(true);
      expect(corroboratedCategoryFinality(state({ alliancesPicked: true, playoffsDone: true, awardsPosted: false }), facts).award).toBe(false);
    }
  });
});

describe("corroboratedCategoryFinality: Playoffs", () => {
  const done = state({ alliancesPicked: true, playoffsDone: true });

  it("reads open with playoffsDone true and no row at the winner's value", () => {
    expect(corroboratedCategoryFinality(done, presence({ alliancePoints: true })).elim).toBe(false);
  });

  it("reads final with playoffsDone true and a row at the winner's value", () => {
    expect(corroboratedCategoryFinality(done, presence({ alliancePoints: true, winnerPlayoffPoints: true })).elim).toBe(true);
  });

  it("reads final once awardsPosted is true, with no row at all", () => {
    expect(corroboratedCategoryFinality(state({ awardsPosted: true }), NO_POINTS_PRESENT).elim).toBe(true);
  });

  it("reads open with a row at the winner's value while playoffsDone is false", () => {
    expect(corroboratedCategoryFinality(state({ alliancesPicked: true }), presence({ alliancePoints: true, winnerPlayoffPoints: true })).elim).toBe(false);
  });
});

describe("corroboratedCategoryFinality: Alliance selection", () => {
  it("reads open with alliancesPicked true and no alliance points on any row", () => {
    expect(corroboratedCategoryFinality(state({ alliancesPicked: true }), NO_POINTS_PRESENT).alliance).toBe(false);
  });

  it("reads final with alliancesPicked true and alliance points on some row", () => {
    expect(corroboratedCategoryFinality(state({ alliancesPicked: true }), presence({ alliancePoints: true })).alliance).toBe(true);
  });

  it("needs its OWN points: Playoffs corroborated with alliance points absent leaves Alliance selection and Qualification open", () => {
    // The playoff points landed before the alliance points. The winner's
    // value proves the Playoffs and nothing below them.
    const final = corroboratedCategoryFinality(state({ alliancesPicked: true, playoffsDone: true }), presence({ winnerPlayoffPoints: true }));
    expect(final).toEqual({ qual: false, alliance: false, elim: true, award: false });
    // Once the alliance points are in, both lower categories close.
    expect(corroboratedCategoryFinality(state({ alliancesPicked: true, playoffsDone: true }), presence({ winnerPlayoffPoints: true, alliancePoints: true }))).toEqual({
      qual: true,
      alliance: true,
      elim: true,
      award: false,
    });
  });

  it("only the awards flag cascades down: it still closes all four, with no proving row at all", () => {
    expect(corroboratedCategoryFinality(state({ awardsPosted: true }), NO_POINTS_PRESENT)).toEqual({ qual: true, alliance: true, elim: true, award: true });
    expect(corroboratedCategoryFinality(state({ alliancesPicked: true, playoffsDone: true, awardsPosted: true }), NO_POINTS_PRESENT)).toEqual({ qual: true, alliance: true, elim: true, award: true });
  });

  it("reads open with alliance points on a row while alliancesPicked is false", () => {
    expect(corroboratedCategoryFinality(state(), presence({ alliancePoints: true })).alliance).toBe(false);
  });
});

describe("corroboratedCategoryFinality: Qualification", () => {
  it("reads open with every match played and alliances not picked", () => {
    expect(corroboratedCategoryFinality(state(), presence({ alliancePoints: true, winnerPlayoffPoints: true })).qual).toBe(false);
  });

  it("is final exactly when Alliance selection is final, over every state and presence of an ordinary event", () => {
    for (const alliancesPicked of [false, true]) {
      for (const playoffsDone of [false, true]) {
        for (const awardsPosted of [false, true]) {
          for (const facts of EVERY_PRESENCE) {
            if (facts.finalsEvent) continue;
            const final = corroboratedCategoryFinality(state({ alliancesPicked, playoffsDone, awardsPosted }), facts);
            expect(final.qual).toBe(final.alliance);
          }
        }
      }
    }
  });
});

describe("corroboratedCategoryFinality: an absent state", () => {
  it("reads all four open for every presence", () => {
    for (const facts of EVERY_PRESENCE) expect(corroboratedCategoryFinality(undefined, facts)).toEqual(ALL_CATEGORIES_OPEN);
  });
});

describe("corroboratedCategoryFinality: a divisioned championship's finals event", () => {
  /** A finals event as the artifacts carry one: no qualification schedule of its own, alliances carried from the divisions. */
  const finals = (over: Partial<DistrictEventStateFacts> = {}): DistrictEventStateFacts => state({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: true, ...over });

  it("keeps the state's own reading for Qualification and Alliance selection", () => {
    for (const playoffsDone of [false, true]) {
      for (const winnerPlayoffPoints of [false, true]) {
        const facts = finals({ playoffsDone });
        const bare = districtEventCategoryFinality(facts);
        const final = corroboratedCategoryFinality(facts, presence({ finalsEvent: true, winnerPlayoffPoints }));
        expect(final.qual).toBe(bare.qual);
        expect(final.alliance).toBe(bare.alliance);
      }
    }
  });

  it("needs the finals value for its Playoffs", () => {
    expect(corroboratedCategoryFinality(finals({ playoffsDone: true }), presence({ finalsEvent: true })).elim).toBe(false);
    expect(corroboratedCategoryFinality(finals({ playoffsDone: true }), presence({ finalsEvent: true, winnerPlayoffPoints: true })).elim).toBe(true);
  });
});

describe("corroboratedCategoryFinality: never closes early", () => {
  it("reads no category final that districtEventCategoryFinality reads open, over every state and every presence", () => {
    const counts: { played: number; total: number | null }[] = [
      { played: 50, total: 60 },
      { played: 60, total: 60 },
      { played: 0, total: null },
    ];
    let checked = 0;
    for (const { played, total } of counts) {
      for (const alliancesPicked of [false, true]) {
        for (const playoffsDone of [false, true]) {
          for (const awardsPosted of [false, true]) {
            for (const facts of EVERY_PRESENCE) {
              const block: DistrictEventStateFacts = { qualMatchesPlayed: played, qualMatchesTotal: total, alliancesPicked, playoffsDone, awardsPosted };
              const bare = districtEventCategoryFinality(block);
              const final = corroboratedCategoryFinality(block, facts);
              for (const category of ["qual", "alliance", "elim", "award"] as const) {
                if (final[category]) expect(bare[category], `${JSON.stringify(block)} ${JSON.stringify(facts)} ${category}`).toBe(true);
              }
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * 2 * 2 * 2 * 8);
  });
});

// ---------------------------------------------------------------------------
// The presence facts
// ---------------------------------------------------------------------------

interface Row {
  eventKey: string;
  tier: DistrictTier;
  alliance: number;
  elim: number;
}
const row = (eventKey: string, tier: DistrictTier, over: Partial<Row> = {}): Row => ({ eventKey, tier, alliance: 0, elim: 0, ...over });
const team = (eventPoints: Row[], remainingEvents: { eventKey: string; tier: DistrictTier }[] = []) => ({ eventPoints, remainingEvents });

describe("categoryPointsPresenceByEvent", () => {
  it("a district tier row at 30 sets the winner fact and a row at 29 does not (2026)", () => {
    const at30 = categoryPointsPresenceByEvent([team([row("2026orore", "district", { elim: 30 })])], 2026);
    const at29 = categoryPointsPresenceByEvent([team([row("2026orore", "district", { elim: 29 })])], 2026);
    expect(at30.get("2026orore")).toEqual({ alliancePoints: false, winnerPlayoffPoints: true, finalsEvent: false });
    expect(at29.get("2026orore")).toEqual({ alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: false });
  });

  it("a single championship needs 90", () => {
    expect(categoryPointsPresenceByEvent([team([row("2026pncmp", "dcmp", { elim: 89 })])], 2026).get("2026pncmp")?.winnerPlayoffPoints).toBe(false);
    expect(categoryPointsPresenceByEvent([team([row("2026pncmp", "dcmp", { elim: 90 })])], 2026).get("2026pncmp")?.winnerPlayoffPoints).toBe(true);
  });

  it("a division needs 90, and is not a finals event", () => {
    const teams = (elim: number) => [team([row("2026micmp1", "dcmp", { elim }), row("2026micmp2", "dcmp"), row("2026micmp", "dcmp")])];
    expect(categoryPointsPresenceByEvent(teams(89), 2026).get("2026micmp1")).toEqual({ alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: false });
    expect(categoryPointsPresenceByEvent(teams(90), 2026).get("2026micmp1")).toEqual({ alliancePoints: false, winnerPlayoffPoints: true, finalsEvent: false });
  });

  it("a finals event with four division keys needs 60", () => {
    const divisions = ["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"].map((key) => row(key, "dcmp"));
    const below = categoryPointsPresenceByEvent([team([...divisions, row("2026micmp", "dcmp", { elim: 59 })])], 2026);
    const at = categoryPointsPresenceByEvent([team([...divisions, row("2026micmp", "dcmp", { elim: 60 })])], 2026);
    expect(below.get("2026micmp")).toEqual({ alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: true });
    expect(at.get("2026micmp")).toEqual({ alliancePoints: false, winnerPlayoffPoints: true, finalsEvent: true });
  });

  it("a finals event with two division keys needs 30", () => {
    const divisions = ["2026txcmp1", "2026txcmp2"].map((key) => row(key, "dcmp"));
    expect(categoryPointsPresenceByEvent([team([...divisions, row("2026txcmp", "dcmp", { elim: 29 })])], 2026).get("2026txcmp")?.winnerPlayoffPoints).toBe(false);
    expect(categoryPointsPresenceByEvent([team([...divisions, row("2026txcmp", "dcmp", { elim: 30 })])], 2026).get("2026txcmp")?.winnerPlayoffPoints).toBe(true);
  });

  it("a finals event in 2022, a season the bracket module does not carry, needs the whole dcmp Playoffs ceiling, 90", () => {
    const divisions = ["2022micmp1", "2022micmp2", "2022micmp3", "2022micmp4"].map((key) => row(key, "dcmp"));
    const at60 = categoryPointsPresenceByEvent([team([...divisions, row("2022micmp", "dcmp", { elim: 60 })])], 2022);
    const at90 = categoryPointsPresenceByEvent([team([...divisions, row("2022micmp", "dcmp", { elim: 90 })])], 2022);
    expect(at60.get("2022micmp")).toEqual({ alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: true });
    expect(at90.get("2022micmp")?.winnerPlayoffPoints).toBe(true);
  });

  it("alliance points above 0 on any row set the alliance fact, and 0 does not", () => {
    const teams = [team([row("2026orore", "district")]), team([row("2026orore", "district", { alliance: 3 })]), team([row("2026orsal", "district")])];
    const map = categoryPointsPresenceByEvent(teams, 2026);
    expect(map.get("2026orore")?.alliancePoints).toBe(true);
    expect(map.get("2026orsal")?.alliancePoints).toBe(false);
  });

  it("an event that only remainingEvents rows name has both facts false and is in the map", () => {
    const map = categoryPointsPresenceByEvent([team([], [{ eventKey: "2026wasno", tier: "district" }])], 2026);
    expect(map.has("2026wasno")).toBe(true);
    expect(map.get("2026wasno")).toEqual(NO_POINTS_PRESENT);
  });

  it("only a key equal to its stem with two or more division keys is a finals event", () => {
    // One division beside its parent: not two, so the parent is read as a single championship.
    const oneDivision = categoryPointsPresenceByEvent([team([row("2026necmp1", "dcmp"), row("2026necmp", "dcmp")])], 2026);
    expect(oneDivision.get("2026necmp")?.finalsEvent).toBe(false);
    // Two championships of one district the same week (2026 California): neither is the other's division.
    const twoChampionships = categoryPointsPresenceByEvent([team([row("2026cascmp", "dcmp"), row("2026cancmp", "dcmp")])], 2026);
    expect(twoChampionships.get("2026cascmp")?.finalsEvent).toBe(false);
    expect(twoChampionships.get("2026cancmp")?.finalsEvent).toBe(false);
    // A division is never a finals event, and a district tier key never is.
    const divisioned = categoryPointsPresenceByEvent([team([row("2026micmp1", "dcmp"), row("2026micmp2", "dcmp"), row("2026micmp", "dcmp"), row("2026misjo", "district")])], 2026);
    expect(divisioned.get("2026micmp")?.finalsEvent).toBe(true);
    expect(divisioned.get("2026micmp1")?.finalsEvent).toBe(false);
    expect(divisioned.get("2026misjo")?.finalsEvent).toBe(false);
  });

  it("takes an event's tier from the first row that names it, across both row lists", () => {
    // The remaining row of a division is enough to make the parent a finals event.
    const map = categoryPointsPresenceByEvent(
      [team([row("2026micmp", "dcmp", { elim: 60 })], [{ eventKey: "2026micmp1", tier: "dcmp" }]), team([], [{ eventKey: "2026micmp2", tier: "dcmp" }])],
      2026
    );
    expect(map.get("2026micmp")).toEqual({ alliancePoints: false, winnerPlayoffPoints: true, finalsEvent: true });
  });
});

describe("the two finals helpers", () => {
  it("divisionCountOf counts the dcmp keys that share the stem and are not the stem", () => {
    expect(divisionCountOf("2026micmp", ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4", "2026cascmp"])).toBe(4);
    expect(divisionCountOf("2026pncmp", ["2026pncmp"])).toBe(0);
  });

  it("finalsChampionMaximum is 60 at four divisions and 30 at two in a registered bracket season, and the dcmp Playoffs ceiling otherwise", () => {
    expect(finalsChampionMaximum(2026, 4)).toBe(60);
    expect(finalsChampionMaximum(2026, 2)).toBe(30);
    expect(finalsChampionMaximum(2026, 3)).toBe(90);
    expect(finalsChampionMaximum(2022, 4)).toBe(90);
  });
});
