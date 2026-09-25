/**
 * `deriveMatchDerivedEventState` alone — pure, no tick, no fakes, no fetch.
 * Every case here pins ONE of the four facts against the evidence it is
 * allowed to read, and in particular against the honest-null / false-by-default
 * answer when that evidence is absent: an unpublished schedule is a `null`
 * total, never a fabricated `0`; an absent playoff row is not a completed
 * playoff.
 */
import { describe, expect, it } from "vitest";
import { deriveMatchDerivedEventState } from "../src/districtEventState.js";
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";

const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

interface MatchFixture {
  compLevel?: "qm" | "sf" | "f";
  setNumber?: number;
  matchNumber: number;
  redScore?: number | null;
  blueScore?: number | null;
  winningAlliance?: "red" | "blue" | "";
  redTeams?: readonly string[];
  blueTeams?: readonly string[];
}

/** Goes through `tbaMatchListSchema` so every fixture is a real, parse-valid TBA shape rather than a hand-cast object. */
function matches(fixtures: readonly MatchFixture[]): TbaMatch[] {
  return tbaMatchListSchema.parse(
    fixtures.map((f) => ({
      key: `2026wayak_${f.compLevel ?? "qm"}${f.setNumber ?? 1}m${f.matchNumber}`,
      event_key: "2026wayak",
      comp_level: f.compLevel ?? "qm",
      set_number: f.setNumber ?? 1,
      match_number: f.matchNumber,
      time: null,
      predicted_time: null,
      actual_time: null,
      winning_alliance: f.winningAlliance ?? "",
      alliances: {
        red: { team_keys: f.redTeams ?? RED, surrogate_team_keys: [], dq_team_keys: [], score: f.redScore ?? null },
        blue: { team_keys: f.blueTeams ?? BLUE, surrogate_team_keys: [], dq_team_keys: [], score: f.blueScore ?? null },
      },
      score_breakdown: null,
    }))
  );
}

function qual(matchNumber: number, scores?: { red: number; blue: number }): MatchFixture {
  return { compLevel: "qm", matchNumber, redScore: scores?.red ?? null, blueScore: scores?.blue ?? null };
}

describe("deriveMatchDerivedEventState", () => {
  it("answers an EMPTY match list with a null total, never a fabricated zero", () => {
    expect(deriveMatchDerivedEventState([])).toEqual({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false });
  });

  it("counts twelve scheduled quals with three scored as played 3 of 12", () => {
    const list = matches([
      qual(1, { red: 50, blue: 40 }),
      qual(2, { red: 30, blue: 60 }),
      qual(3, { red: 45, blue: 45 }),
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => qual(n)),
    ]);

    const state = deriveMatchDerivedEventState(list);

    expect(state.qualMatchesPlayed).toBe(3);
    expect(state.qualMatchesTotal).toBe(12);
  });

  it("does NOT count a qual whose two alliance scores are null, even when it names a winning alliance (isPlayed, not winning_alliance)", () => {
    const list = matches([{ compLevel: "qm", matchNumber: 1, winningAlliance: "red" }, qual(2, { red: 10, blue: 5 })]);

    expect(deriveMatchDerivedEventState(list).qualMatchesPlayed).toBe(1);
  });

  it("reports alliancesPicked false for quals alone, and true once a non-qual row carries both alliances' team keys", () => {
    const qualsOnly = matches([qual(1), qual(2)]);
    expect(deriveMatchDerivedEventState(qualsOnly).alliancesPicked).toBe(false);

    const withBracket = matches([qual(1), qual(2), { compLevel: "sf", setNumber: 1, matchNumber: 1 }]);
    expect(deriveMatchDerivedEventState(withBracket).alliancesPicked).toBe(true);
  });

  it("does NOT flip alliancesPicked on a placeholder bracket row with an empty team_keys on either side", () => {
    const emptyRed = matches([qual(1), { compLevel: "sf", setNumber: 1, matchNumber: 1, redTeams: [] }]);
    expect(deriveMatchDerivedEventState(emptyRed).alliancesPicked).toBe(false);

    const emptyBlue = matches([qual(1), { compLevel: "sf", setNumber: 1, matchNumber: 1, blueTeams: [] }]);
    expect(deriveMatchDerivedEventState(emptyBlue).alliancesPicked).toBe(false);
  });

  it("reports playoffsDone false while any non-qual row is unplayed", () => {
    const list = matches([
      qual(1, { red: 10, blue: 5 }),
      { compLevel: "sf", setNumber: 1, matchNumber: 1, redScore: 60, blueScore: 50, winningAlliance: "red" },
      { compLevel: "f", setNumber: 1, matchNumber: 1 },
    ]);

    expect(deriveMatchDerivedEventState(list).playoffsDone).toBe(false);
  });

  it("reports playoffsDone false when every non-qual row is played but no f row names a winner (a tied finals awaiting its replay)", () => {
    const list = matches([
      qual(1, { red: 10, blue: 5 }),
      { compLevel: "sf", setNumber: 1, matchNumber: 1, redScore: 60, blueScore: 50, winningAlliance: "red" },
      { compLevel: "f", setNumber: 1, matchNumber: 1, redScore: 70, blueScore: 70, winningAlliance: "" },
    ]);

    expect(deriveMatchDerivedEventState(list).playoffsDone).toBe(false);
  });

  it("reports playoffsDone true only when every non-qual row is played AND some f row names a winner", () => {
    const list = matches([
      qual(1, { red: 10, blue: 5 }),
      { compLevel: "sf", setNumber: 1, matchNumber: 1, redScore: 60, blueScore: 50, winningAlliance: "red" },
      { compLevel: "f", setNumber: 1, matchNumber: 1, redScore: 70, blueScore: 70, winningAlliance: "" },
      { compLevel: "f", setNumber: 1, matchNumber: 2, redScore: 80, blueScore: 65, winningAlliance: "red" },
    ]);

    expect(deriveMatchDerivedEventState(list).playoffsDone).toBe(true);
  });

  it("reports playoffsDone false for an event with no playoff rows at all (an absent playoff is not a completed one)", () => {
    expect(deriveMatchDerivedEventState(matches([qual(1, { red: 10, blue: 5 })])).playoffsDone).toBe(false);
  });

  it("counts qm rows ONLY toward qualMatchesTotal — playoff rows never inflate it", () => {
    const list = matches([
      qual(1, { red: 10, blue: 5 }),
      qual(2, { red: 20, blue: 15 }),
      { compLevel: "sf", setNumber: 1, matchNumber: 1, redScore: 60, blueScore: 50, winningAlliance: "red" },
      { compLevel: "f", setNumber: 1, matchNumber: 1, redScore: 70, blueScore: 65, winningAlliance: "red" },
    ]);

    const state = deriveMatchDerivedEventState(list);

    expect(state.qualMatchesTotal).toBe(2);
    expect(state.qualMatchesPlayed).toBe(2);
  });
});
