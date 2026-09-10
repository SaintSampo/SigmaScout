/**
 * Coverage for `TeamsBubbleChart.tsx` (Task 2, 260909-tom-PLAN.md) — the
 * eleven behaviors listed in the plan's `<behavior>` block, one test each.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TOTAL_KEY } from "@/lib/metricKeys";
import type { TeamRow } from "./rowModel.js";
import { BUBBLE_TONE_DRAW_ORDER } from "./teamsBubbleModel.js";
import { TeamsBubbleChart } from "./TeamsBubbleChart.js";

function makeRow(overrides: Partial<TeamRow> & Pick<TeamRow, "teamKey" | "teamNumber">): TeamRow {
  return {
    teamKey: overrides.teamKey,
    teamNumber: overrides.teamNumber,
    nickname: overrides.nickname ?? `Team ${overrides.teamNumber}`,
    record: overrides.record ?? { wins: 0, losses: 0, ties: 0 },
    winRate: overrides.winRate ?? null,
    metrics: overrides.metrics ?? {},
    swingScore: overrides.swingScore,
    swingTier: overrides.swingTier,
    rank: overrides.rank ?? overrides.teamNumber,
  };
}

/** Counts every `M` command across every `[data-tone]` path's `d` attribute — the plotted-dot count. */
function countDots(container: HTMLElement, tone?: string): number {
  const selector = tone ? `[data-tone="${tone}"]` : "[data-tone]";
  return Array.from(container.querySelectorAll(selector)).reduce((sum, el) => {
    const d = el.getAttribute("d") ?? "";
    return sum + (d.match(/M/g) ?? []).length;
  }, 0);
}

const MIXED_ROWS: TeamRow[] = [
  makeRow({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10, tier: "legendary" } }, swingScore: 1 }),
  makeRow({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 20, tier: "epic" } }, swingScore: 2 }),
  makeRow({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 30, tier: "epic" } }, swingScore: 3 }),
  makeRow({ teamKey: "frc4", teamNumber: 4, metrics: { [TOTAL_KEY]: { value: 40, tier: "rare" } }, swingScore: 4 }),
  makeRow({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 50, spread: 3.5 } }, swingScore: 5 }), // no tier -> neutral, carries spread
];

describe("TeamsBubbleChart", () => {
  afterEach(() => cleanup());

  it("renders exactly one path per non-empty tone, with the M-command count matching that tone's point count", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const paths = container.querySelectorAll("[data-tone]");
    // legendary(1), epic(2), rare(1), neutral(1) -> four non-empty tones.
    expect(paths).toHaveLength(4);
    expect(countDots(container, "legendary")).toBe(1);
    expect(countDots(container, "epic")).toBe(2);
    expect(countDots(container, "rare")).toBe(1);
    expect(countDots(container, "neutral")).toBe(1);
  });

  it("paths appear in the DOM in BUBBLE_TONE_DRAW_ORDER, neutral first and legendary last", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const tones = Array.from(container.querySelectorAll("[data-tone]")).map((el) => el.getAttribute("data-tone"));
    const presentTones = new Set(tones);
    const expectedOrder = BUBBLE_TONE_DRAW_ORDER.filter((tone) => presentTones.has(tone));
    expect(tones).toEqual(expectedOrder);
    expect(tones[0]).toBe("neutral");
    expect(tones[tones.length - 1]).toBe("legendary");
  });

  it("with rows whose Swing Score is absent, an on-screen note names the count and the reason; absent when nothing was omitted", () => {
    const rowsWithOmission: TeamRow[] = [
      ...MIXED_ROWS,
      makeRow({ teamKey: "frc6", teamNumber: 6, metrics: { [TOTAL_KEY]: { value: 60 } }, swingScore: undefined }),
    ];
    render(<TeamsBubbleChart rows={rowsWithOmission} />);
    expect(screen.getByText(/1 team is not plotted: they have played fewer than two matches, so they have no Swing Score\./)).toBeDefined();

    cleanup();
    render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    expect(screen.queryByText(/not plotted: they have played fewer than two matches/)).toBeNull();
  });

  it("with rows carrying no Total metric, a second note names that count separately", () => {
    const rowsWithOmission: TeamRow[] = [...MIXED_ROWS, makeRow({ teamKey: "frc7", teamNumber: 7, metrics: {}, swingScore: 1 })];
    render(<TeamsBubbleChart rows={rowsWithOmission} />);
    expect(screen.getByText(/1 team is not plotted: they carry no Total for this algorithm\./)).toBeDefined();
  });

  it("with zero plottable points, an empty-state message renders and no tone path is emitted", () => {
    const { container } = render(<TeamsBubbleChart rows={[]} />);
    expect(screen.getByTestId("bubble-chart-empty")).toBeDefined();
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(0);
  });

  it("the svg carries role=img and an accessible name naming both axes and the plotted team count", () => {
    render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = screen.getByRole("img");
    const label = svg.getAttribute("aria-label") ?? "";
    expect(label).toContain("5 teams plotted");
    expect(label).toContain("Horizontal axis");
    expect(label).toContain("Vertical axis");
  });

  it("the Y axis title text is exactly 'Swing Score'", () => {
    render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    expect(screen.getByText("Swing Score")).toBeDefined();
  });

  it("the X axis title is the same label the table's Total column header uses", () => {
    render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    // `metricDisplayLabel(TOTAL_KEY)` resolves to "Total" — the same label
    // `columns.tsx`'s Total column header renders, imported not re-typed.
    expect(screen.getByText("Total")).toBeDefined();
  });

  it("the rendered text of the whole component contains no plus-minus glyph and no occurrence of the algorithm's own confidence field name", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    expect(container.textContent ?? "").not.toContain("±");
    expect(container.textContent ?? "").not.toContain("spread");
  });

  it("a row whose Total metric has no published tier lands in the neutral tone path, not rare/epic/legendary", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    // frc5 (no tier) is the only point given a swingScore of 5; its dot must
    // be counted in the neutral bucket and nowhere else.
    expect(countDots(container, "neutral")).toBe(1);
    const nonNeutralTotal = countDots(container, "rare") + countDots(container, "epic") + countDots(container, "legendary");
    expect(nonNeutralTotal).toBe(4);
  });

  it("the key row lists four entries in draw order, the first labelled for the ambiguous Common-or-unranked case", () => {
    render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const keyRow = screen.getByTestId("bubble-chart-key");
    const labels = Array.from(keyRow.children).map((child) => child.textContent);
    expect(labels).toEqual(["Common / unranked", "Rare", "Epic", "Legendary"]);
    expect(within(keyRow).getByText("Common / unranked")).toBeDefined();
  });
});
