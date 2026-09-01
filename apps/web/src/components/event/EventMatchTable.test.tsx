import { describe, expect, expectTypeOf, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { EventMatchTable, EventMatchTableSkeleton, EVENT_MATCH_TABLE_COLUMN_COUNT, type EventMatchTableProps } from "./EventMatchTable.js";
import type { EventMatchRow } from "./eventMatchAxis.js";

const DOMAIN = { min: 100, max: 400 };

function makeRow(overrides: Partial<EventMatchRow> = {}): EventMatchRow {
  return {
    matchKey: "2024casj_qm1",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc118", "frc254", "frc971"],
    blueTeams: ["frc604", "frc1678", "frc2056"],
    predictedWinner: "red",
    pRedWin: 0.62,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    redScoreVarianceOwn: 100,
    blueScoreVarianceOwn: 64,
    played: false,
    ...overrides,
  };
}

describe("Structure and the dropped highlight rule", () => {
  it("EventMatchTableProps has exactly the keys rows, domain and season — a team key can never be threaded back in", () => {
    type Keys = keyof EventMatchTableProps;
    expectTypeOf<Exclude<Keys, "rows" | "domain" | "season" | "algorithm">>().toEqualTypeOf<never>();
    const probe = { rows: [], domain: DOMAIN, season: 2024, algorithm: "vpr" as const } satisfies EventMatchTableProps;
    expect(probe).toBeDefined();
  });

  it("every team-number element inside one row's Match column carries an identical class list", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1" })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    const row = screen.getByTestId("match-row-m1");
    const numbers = ["118", "254", "971", "604", "1678", "2056"].map((n) => within(row).getByText(n));
    const classLists = numbers.map((el) => el.className);
    expect(new Set(classLists).size).toBe(1);
  });

  it("the header row exposes exactly EVENT_MATCH_TABLE_COLUMN_COUNT column headers, and the axis header renders exactly once for a multi-row table", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1" }), makeRow({ matchKey: "m2" })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(EVENT_MATCH_TABLE_COLUMN_COUNT);
    expect(screen.getAllByTestId("axis-ticks")).toHaveLength(1);
  });

  /**
   * G-9 (07-UAT.md): the untinted row must carry its OWN explicit background
   * class (`match-row-untinted`), never `transparent` with no class at all —
   * a transparent untinted row is exactly the bug this table shipped with,
   * since this component (unlike `MatchTable.tsx`) has no `.event-card`
   * ancestor to quietly borrow a colour from. Also asserts the sticky first
   * cell's own class always matches its row's state, so the pinned column
   * never desyncs from the row's own stripe.
   */
  it("both zebra-stripe states are painted with their own explicit class — never left to inherit a transparent background from an ancestor", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1" }), makeRow({ matchKey: "m2" }), makeRow({ matchKey: "m3" })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    const row1 = screen.getByTestId("match-row-m1");
    const row2 = screen.getByTestId("match-row-m2");
    const row3 = screen.getByTestId("match-row-m3");

    expect(row1.className).toContain("match-row-untinted");
    expect(row1.className).not.toContain("match-row-tint");
    expect(row2.className).toContain("match-row-tint");
    expect(row3.className).toContain("match-row-untinted");
    expect(row3.className).not.toContain("match-row-tint");
    expect(row1.className).not.toBe(row2.className);

    // The sticky first cell (the Match column) must carry the SAME state
    // class as its own row, in both directions — never a bare
    // `bg-[var(--color-bg-surface)]` literal that could drift from the
    // row's own token.
    const stickyCell1 = within(row1).getByText("Qual 1").closest("td")!;
    const stickyCell2 = within(row2).getByText("Qual 1").closest("td")!;
    expect(stickyCell1.className).toContain("match-row-untinted");
    expect(stickyCell2.className).toContain("match-row-tint");
  });
});

describe("Played rows", () => {
  it("renders a band, a tick and a dot for each alliance", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    for (const side of ["red", "blue"]) {
      expect(screen.getByTestId(`alliance-mark-m1-${side}-band`)).toBeDefined();
      expect(screen.getByTestId(`alliance-mark-m1-${side}-tick`)).toBeDefined();
      expect(screen.getByTestId(`alliance-mark-m1-${side}-dot`)).toBeDefined();
    }
  });

  it("greys the losing alliance's Actual number and leaves the winning one ungreyed", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    const winner = screen.getByTestId("actual-m1-red");
    const loser = screen.getByTestId("actual-m1-blue");
    expect(winner.className).not.toContain("loser-ink");
    expect(loser.className).toContain("loser-ink");
  });

  it("both alliances' plotted dots render in their own colour — the losing alliance's dot does NOT carry the loser ink treatment", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    const redDot = screen.getByTestId("alliance-mark-m1-red-dot");
    const blueDot = screen.getByTestId("alliance-mark-m1-blue-dot");
    expect(redDot.style.border).toContain("var(--alliance-red)");
    expect(blueDot.style.border).toContain("var(--alliance-blue)");
    expect(redDot.className).not.toContain("loser-ink");
    expect(blueDot.className).not.toContain("loser-ink");
  });

  it("the Call cell exposes the correct/incorrect accessible label matching predicted vs actual winner", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[
          makeRow({ matchKey: "correct", predictedWinner: "red", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 }),
          makeRow({ matchKey: "wrong", predictedWinner: "red", played: true, actualWinner: "blue", actualRedScore: 200, actualBlueScore: 260 }),
        ]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    expect(within(screen.getByTestId("call-correct")).getByLabelText("Prediction correct")).toBeDefined();
    expect(within(screen.getByTestId("call-wrong")).getByLabelText("Prediction incorrect")).toBeDefined();
  });

  it("a tie renders the incorrect-call label and greys neither alliance's number", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", predictedWinner: "red", played: true, actualWinner: "tie", actualRedScore: 200, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    expect(within(screen.getByTestId("call-m1")).getByLabelText("Prediction incorrect")).toBeDefined();
    expect(screen.getByTestId("actual-m1-red").className).not.toContain("loser-ink");
    expect(screen.getByTestId("actual-m1-blue").className).not.toContain("loser-ink");
  });

  it("the Confidence cell renders the predicted winner's chip and the winner-side probability as a whole percentage", () => {
    renderWithRouter(
      <EventMatchTable rows={[makeRow({ matchKey: "m1", predictedWinner: "red", pRedWin: 0.62 }), makeRow({ matchKey: "m2", predictedWinner: "blue", pRedWin: 0.38 })]} domain={DOMAIN} season={2024} algorithm="vpr" />,
    );
    expect(within(screen.getByTestId("confidence-m1")).getByText("62%")).toBeDefined();
    expect(within(screen.getByTestId("confidence-m2")).getByText("62%")).toBeDefined();
  });

  it("the Predicted Score cell rounds each alliance's score with a plus-minus suffix equal to the rounded sqrt of its variance", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", predictedRedScore: 250.4, redScoreVarianceOwn: 100, predictedBlueScore: 220.6, blueScoreVarianceOwn: 64 })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    const red = screen.getByTestId("predicted-score-m1-red");
    const blue = screen.getByTestId("predicted-score-m1-blue");
    expect(red.textContent).toContain("250");
    expect(red.textContent).toContain("± 10");
    expect(blue.textContent).toContain("221");
    expect(blue.textContent).toContain("± 8");
  });
});

describe("Unplayed rows", () => {
  it("renders both bands and both ticks and no dot for either alliance", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", played: false })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-dot")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-dot")).toBeNull();
  });

  it("renders the scheduled time when the row carries sortTime, matching the shipped formatter's output for that instant", async () => {
    const { formatScheduledTime } = await import("../team/MatchTable.js");
    const sortTime = Math.floor(new Date("2026-01-03T18:30:00Z").getTime() / 1000);
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", played: false, sortTime })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getByTestId("actual-m1").textContent).toBe(formatScheduledTime(sortTime));
  });

  it("renders an em-dash when the row carries no sortTime — never '0' and never a 1970 date", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", played: false, sortTime: undefined })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    const actual = screen.getByTestId("actual-m1");
    expect(actual.textContent).toBe("");
    expect(actual.textContent).not.toBe("0");
    expect(actual.textContent).not.toContain("1970");
  });

  it("the Call cell renders an em-dash carrying no correct/incorrect accessible label", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", played: false })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    const call = screen.getByTestId("call-m1");
    expect(call.textContent).toBe("");
    expect(screen.queryByLabelText("Prediction correct")).toBeNull();
    expect(screen.queryByLabelText("Prediction incorrect")).toBeNull();
  });

  it("the Predicted Score cell renders normally for an unplayed row", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", played: false, predictedRedScore: 240, redScoreVarianceOwn: 81 })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getByTestId("predicted-score-m1-red").textContent).toContain("240");
  });
});

describe("Absent variance (OPR/EPA and pre-republish state)", () => {
  it("a row with neither variance field renders both ticks and no band, and a bare predicted score with no suffix", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", redScoreVarianceOwn: undefined, blueScoreVarianceOwn: undefined })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-band")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-band")).toBeNull();
    expect(screen.getByTestId("predicted-score-m1-red").textContent).not.toContain("±");
  });

  it("a row with only redScoreVarianceOwn renders a red band and no blue band, and a suffix on red only", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1", redScoreVarianceOwn: 100, blueScoreVarianceOwn: undefined })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-blue-band")).toBeNull();
    expect(screen.getByTestId("predicted-score-m1-red").textContent).toContain("±");
    expect(screen.getByTestId("predicted-score-m1-blue").textContent).not.toContain("±");
  });
});

describe("Bonus-RP dots", () => {
  function collectDotStates(groupTestId: string): (string | null)[] {
    const group = screen.getByTestId(groupTestId);
    return Array.from(group.querySelectorAll("[data-testid^='bonus-dot-']")).map((dot) => dot.getAttribute("data-state"));
  }

  it("a qm row renders predicted and actual dot groups per alliance, every dot unknown", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", compLevel: "qm", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    const groups = ["bonus-rp-predicted-m1-red", "bonus-rp-predicted-m1-blue", "bonus-rp-actual-m1-red", "bonus-rp-actual-m1-blue"];
    const allStates = groups.flatMap((g) => collectDotStates(g));
    expect(allStates.length).toBeGreaterThan(0);
    expect(allStates.every((s) => s === "unknown")).toBe(true);
  });

  it("a 2024 row renders two dots per group and a 2025 row renders three", () => {
    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m1" })]} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(collectDotStates("bonus-rp-predicted-m1-red")).toHaveLength(2);
    expect(collectDotStates("bonus-rp-predicted-m1-red")).toHaveLength(2);

    renderWithRouter(<EventMatchTable rows={[makeRow({ matchKey: "m2" })]} domain={DOMAIN} season={2025} algorithm="vpr" />);
    expect(collectDotStates("bonus-rp-predicted-m2-red")).toHaveLength(3);
  });

  it("an sf row renders every dot unknown as well (via isBonusRpCompLevel returning false)", () => {
    renderWithRouter(
      <EventMatchTable
        rows={[makeRow({ matchKey: "m1", compLevel: "sf", played: true, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        season={2024}
        algorithm="vpr"
      />,
    );
    const groups = ["bonus-rp-predicted-m1-red", "bonus-rp-predicted-m1-blue", "bonus-rp-actual-m1-red", "bonus-rp-actual-m1-blue"];
    const allStates = groups.flatMap((g) => collectDotStates(g));
    expect(allStates.every((s) => s === "unknown")).toBe(true);
  });
});

describe("Skeleton", () => {
  it("renders skeleton rows and exposes zero elements with role progressbar", () => {
    renderWithRouter(<EventMatchTableSkeleton rowCount={4} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders EVENT_MATCH_TABLE_COLUMN_COUNT columns' worth of placeholders, from the same exported constant the header uses", () => {
    renderWithRouter(<EventMatchTableSkeleton rowCount={4} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(EVENT_MATCH_TABLE_COLUMN_COUNT);
  });
});

describe("Row count conservation", () => {
  it.each([1, 2, 40])("rendering %i rows produces exactly that many body rows", (n) => {
    const rows = Array.from({ length: n }, (_, i) =>
      makeRow({
        matchKey: `m${i}`,
        matchNumber: i + 1,
        played: i % 3 === 0,
        actualWinner: i % 3 === 0 ? "red" : undefined,
        actualRedScore: i % 3 === 0 ? 260 : undefined,
        actualBlueScore: i % 3 === 0 ? 200 : undefined,
        redScoreVarianceOwn: i % 2 === 0 ? 100 : undefined,
        blueScoreVarianceOwn: i % 2 === 0 ? 64 : undefined,
      }),
    );
    renderWithRouter(<EventMatchTable rows={rows} domain={DOMAIN} season={2024} algorithm="vpr" />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(n);
  });
});
