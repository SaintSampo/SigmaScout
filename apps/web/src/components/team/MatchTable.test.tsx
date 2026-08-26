import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MatchTable, matchLabel } from "./MatchTable.js";
import type { TeamSeasonMatch } from "./matchAxis.js";

const DOMAIN = { min: 100, max: 400 };

function makeMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    compLevel: "qm",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    predictedWinner: "red",
    pRedWin: 0.63,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    redComponents: {},
    blueComponents: {},
    redTeams: ["frc118", "frc254", "frc971"],
    blueTeams: ["frc604", "frc1678", "frc2056"],
    redScoreVarianceOwn: 100,
    blueScoreVarianceOwn: 64,
    redRpPmf: [0.2, 0.5, 0.3],
    blueRpPmf: [0.5, 0.4, 0.1],
    ...overrides,
  } as TeamSeasonMatch;
}

describe("matchLabel", () => {
  it("labels a qualification match from its published match number", () => {
    expect(matchLabel({ compLevel: "qm", setNumber: 1, matchNumber: 12, matchKey: "2024casj_qm12" })).toBe("Qual 12");
  });

  it("labels a semifinal with a set number", () => {
    expect(matchLabel({ compLevel: "sf", setNumber: 2, matchNumber: 1, matchKey: "2024casj_sf2m1" })).toBe("Semifinal 2-1");
  });

  it("labels a final", () => {
    expect(matchLabel({ compLevel: "f", setNumber: 1, matchNumber: 1, matchKey: "2024casj_f1m1" })).toBe("Final 1-1");
  });

  it("falls back to the matchKey's own suffix when setNumber/matchNumber are absent", () => {
    expect(matchLabel({ compLevel: "qm", setNumber: undefined, matchNumber: undefined, matchKey: "2024casj_qm7" })).toBe("qm7");
  });
});

describe("MatchTable", () => {
  it("renders six alliance marks for a played Sigma1 row (band+tick+dot per alliance), dots carrying alliance colour classes with no loser-ink token", () => {
    render(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1", actualWinner: "red", actualRedScore: 260, actualBlueScore: 200, actualRedRp: 2, actualBlueRp: 0 })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-dot")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    const blueDot = screen.getByTestId("alliance-mark-m1-blue-dot");
    expect(blueDot).toBeDefined();

    const redDot = screen.getByTestId("alliance-mark-m1-red-dot");
    expect(redDot.className).toContain("bg-white");
    expect(redDot.style.border).toContain("var(--alliance-red)");
    expect(blueDot.style.border).toContain("var(--alliance-blue)");
    expect(redDot.className).not.toContain("loser-ink");
    expect(blueDot.className).not.toContain("loser-ink");
  });

  it("greys the losing number in the Actual column and leaves the winning number ungreyed", () => {
    render(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1", actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    const winner = screen.getByTestId("actual-m1-red");
    const loser = screen.getByTestId("actual-m1-blue");
    expect(winner.className).not.toContain("loser-ink");
    expect(loser.className).toContain("loser-ink");
  });

  it("renders a scheduled row with four marks, zero dots, a weekday/time string in Actual, and an em-dash in Call", () => {
    // 2026-01-03 is a Saturday.
    const sortTime = Math.floor(new Date("2026-01-03T18:30:00Z").getTime() / 1000);
    render(<MatchTable matches={[makeMatch({ matchKey: "m1", sortTime })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
      />);

    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-dot")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-dot")).toBeNull();

    const actual = screen.getByTestId("actual-m1");
    expect(actual.textContent).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (AM|PM)$/);

    const call = screen.getByTestId("call-m1");
    expect(call.textContent).toBe("—");
  });

  it("renders ticks but zero band elements, and a bare whole-number predicted score, for an OPR row (no own-variance, no pmf)", () => {
    render(
      <MatchTable
        matches={[
          makeMatch({
            matchKey: "m1",
            algorithmId: "opr",
            redScoreVarianceOwn: undefined,
            blueScoreVarianceOwn: undefined,
            redRpPmf: undefined,
            blueRpPmf: undefined,
          }),
        ]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-band")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-band")).toBeNull();

    // The predicted-RP column was removed entirely: bonus RP is now the
    // per-bonus dots, and win/tie RP is already carried by the Confidence
    // chip and the Call column.
    expect(screen.queryByTestId("predicted-rp-m1")).toBeNull();

    // The predicted SCORE that replaced it carries neither a ± nor a decimal
    // — its uncertainty is the interval band in the plot column.
    const predictedScore = screen.getByTestId("predicted-score-m1");
    expect(predictedScore.textContent).not.toContain("±");
    expect(predictedScore.textContent).not.toContain(".");
  });

  it("positions red's marks above blue's in every row, regardless of which alliance this team is on", () => {
    render(
      <MatchTable
        matches={[
          makeMatch({ matchKey: "m1", redTeams: ["frc118"], blueTeams: ["frc254"] }),
          makeMatch({ matchKey: "m2", redTeams: ["frc254"], blueTeams: ["frc118"] }),
        ]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    for (const matchKey of ["m1", "m2"]) {
      const redTop = parseFloat(screen.getByTestId(`alliance-mark-${matchKey}-red-tick`).style.top);
      const blueTop = parseFloat(screen.getByTestId(`alliance-mark-${matchKey}-blue-tick`).style.top);
      expect(redTop).toBeLessThan(blueTop);
    }
  });

  it("renders this team's own three numbers at semibold and the opposing three at regular weight, with no row background class difference", () => {
    render(
      <MatchTable matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc254", "frc971"], blueTeams: ["frc604", "frc1678", "frc2056"] })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
      />,
    );
    const row = screen.getByTestId("match-row-m1");
    const ownNumber = within(row).getByText("118");
    const opponentNumber = within(row).getByText("604");
    expect(ownNumber.className).toContain("font-semibold");
    expect(opponentNumber.className).not.toContain("font-semibold");
    // Both belong to the same physical <tr> — no per-alliance background class exists on it.
    expect(ownNumber.closest("tr")).toBe(opponentNumber.closest("tr"));
  });

  it("renders the axis header exactly once, with at least two labelled ticks, and never labels the lowest tick 0 for a 180-floor fixture", () => {
    render(<MatchTable matches={[makeMatch({ matchKey: "m1" })]} domain={{ min: 180, max: 300 }} teamKey="frc118"
        season={2024}
      />);
    const axes = screen.getAllByTestId("axis-ticks");
    expect(axes).toHaveLength(1);
    const ticks = screen.getAllByTestId("axis-tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]?.textContent).not.toBe("0");
  });

  it("still renders the full labelled axis for a single-match event", () => {
    render(<MatchTable matches={[makeMatch({ matchKey: "m1" })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
      />);
    expect(screen.getAllByTestId("axis-tick").length).toBeGreaterThanOrEqual(2);
  });

  it("renders alternating row tints — adjacent rows carry differing background classes (06-09-PLAN.md Task 3 polish pass)", () => {
    render(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1" }), makeMatch({ matchKey: "m2" }), makeMatch({ matchKey: "m3" })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    const row1 = screen.getByTestId("match-row-m1");
    const row2 = screen.getByTestId("match-row-m2");
    const row3 = screen.getByTestId("match-row-m3");
    expect(row1.className).not.toContain("match-row-tint");
    expect(row2.className).toContain("match-row-tint");
    expect(row3.className).not.toContain("match-row-tint");
    expect(row1.className).not.toBe(row2.className);
  });

  it("renders the predicted-winner confidence chip in the alliance's own colour tokens, no bare string alone", () => {
    render(<MatchTable matches={[makeMatch({ matchKey: "m1", predictedWinner: "blue" })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
      />);
    const confidence = screen.getByTestId("confidence-m1");
    const chip = within(confidence).getByText("Blue");
    expect(chip.className).toContain("alliance-chip--blue");
  });

  it("renders matches in the exact order passed, never re-sorted", () => {
    render(
      <MatchTable
        matches={[makeMatch({ matchKey: "z-last" }), makeMatch({ matchKey: "a-first" })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
      />,
    );
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows[0]?.getAttribute("data-testid")).toBe("match-row-z-last");
    expect(rows[1]?.getAttribute("data-testid")).toBe("match-row-a-first");
  });

  /**
   * Plan 06.1-06, Task 2 (F-06-1): real dot states on every eligible match
   * row. Closes success criterion 1 — no dot remains `unknown` for a played
   * qualification match with published per-bonus data.
   */
  describe("real bonus-RP dot states (plan 06.1-06, F-06-1)", () => {
    function collectDotStates(groupTestId: string): (string | null)[] {
      const group = screen.getByTestId(groupTestId);
      return Array.from(group.querySelectorAll("[data-testid^='bonus-dot-']")).map((dot) => dot.getAttribute("data-state"));
    }

    it("resolves every predicted and every actual dot to earned or missed — none unknown — for a two-bonus season (2024)", () => {
      render(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2],
              blueBonusRp: [0.1, 0.9],
              actualRedBonusRp: [true, false],
              actualBlueBonusRp: [false, true],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).toHaveLength(2);
      expect(predictedBlue).toHaveLength(2);
      expect(actualRed).toHaveLength(2);
      expect(actualBlue).toHaveLength(2);

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "earned" || state === "missed")).toBe(true);
      expect(allStates).not.toContain("unknown");
    });

    it("resolves every predicted and every actual dot to earned or missed — none unknown — for a three-bonus season (2025)", () => {
      render(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              season: 2025,
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2, 0.55],
              blueBonusRp: [0.1, 0.9, 0.4],
              actualRedBonusRp: [true, false, true],
              actualBlueBonusRp: [false, true, false],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2025}
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).toHaveLength(3);
      expect(predictedBlue).toHaveLength(3);
      expect(actualRed).toHaveLength(3);
      expect(actualBlue).toHaveLength(3);

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "earned" || state === "missed")).toBe(true);
      expect(allStates).not.toContain("unknown");
    });

    it("renders every actual dot unknown when actual bonus arrays are null, while predicted dots still resolve", () => {
      render(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2],
              blueBonusRp: [0.1, 0.9],
              actualRedBonusRp: null,
              actualBlueBonusRp: null,
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).not.toContain("unknown");
      expect(predictedBlue).not.toContain("unknown");
      expect(actualRed.every((state) => state === "unknown")).toBe(true);
      expect(actualBlue.every((state) => state === "unknown")).toBe(true);
    });

    it("renders every dot unknown when a match carries none of the four bonus fields (pre-phase behaviour preserved)", () => {
      render(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: undefined,
              blueBonusRp: undefined,
              actualRedBonusRp: undefined,
              actualBlueBonusRp: undefined,
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed.every((state) => state === "unknown")).toBe(true);
      expect(predictedBlue.every((state) => state === "unknown")).toBe(true);
      expect(actualRed.every((state) => state === "unknown")).toBe(true);
      expect(actualBlue.every((state) => state === "unknown")).toBe(true);
    });

    it("reads each alliance's own data only — red and blue never cross-read, given deliberately different arrays", () => {
      render(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.9, 0.9],
              blueBonusRp: [0.1, 0.1],
              actualRedBonusRp: [true, true],
              actualBlueBonusRp: [false, false],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        />,
      );

      expect(collectDotStates("bonus-rp-predicted-m1-red")).toEqual(["earned", "earned"]);
      expect(collectDotStates("bonus-rp-predicted-m1-blue")).toEqual(["missed", "missed"]);
      expect(collectDotStates("bonus-rp-actual-m1-red")).toEqual(["earned", "earned"]);
      expect(collectDotStates("bonus-rp-actual-m1-blue")).toEqual(["missed", "missed"]);
    });
  });
});
