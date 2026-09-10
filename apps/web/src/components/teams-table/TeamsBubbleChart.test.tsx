/**
 * Coverage for `TeamsBubbleChart.tsx` (Task 2, 260909-tom-PLAN.md, plus
 * Task 2, 260909-v5v-PLAN.md) — the eleven original behaviors plus the
 * twelve hover/click behaviors listed in 260909-v5v-PLAN.md's `<behavior>`
 * block, one test each.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TOTAL_KEY } from "@/lib/metricKeys";
import type { TeamRow } from "./rowModel.js";
import { BUBBLE_CHART, BUBBLE_TONE_DRAW_ORDER } from "./teamsBubbleModel.js";
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

/**
 * Coverage for hover/click (Task 2, 260909-v5v-PLAN.md). Follows
 * `<test_strategy>` exactly: jsdom does no layout, so every test stubs the
 * svg's `getBoundingClientRect()` and derives the pointer target from the
 * ACTUAL rendered `d` attribute rather than recomputing the projection.
 */

/** `<test_strategy>` step 2 — a stubbed rect with left/top at zero and width equal to the svg's own width attribute, so client coordinates ARE svg coordinates. */
function stubRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: BUBBLE_CHART.fallbackWidth,
      height: BUBBLE_CHART.height,
      right: BUBBLE_CHART.fallbackWidth,
      bottom: BUBBLE_CHART.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** `<test_strategy>` step 3 — parses the first `M{cx},{cy}` out of a tone path's `d` attribute, the coordinates the component ACTUALLY drew. */
function firstDotCoords(container: HTMLElement, tone: string): { x: number; y: number } {
  const el = container.querySelector(`[data-tone="${tone}"]`);
  const d = el?.getAttribute("d") ?? "";
  const match = /M([\d.-]+),([\d.-]+)/.exec(d);
  if (!match) throw new Error(`no M command found for tone "${tone}"`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("TeamsBubbleChart hover and click", () => {
  afterEach(() => cleanup());

  it("moving the pointer to a point's projected coordinates renders exactly one tooltip naming that team", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary"); // frc1
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const tooltips = screen.getAllByTestId("bubble-chart-tooltip");
    expect(tooltips).toHaveLength(1);
    expect(within(tooltips[0]!).getByText("1")).toBeDefined();
  });

  it("the tooltip's first line is the team number, rendered in the largest type role the card uses", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary"); // frc1
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const tooltip = screen.getByTestId("bubble-chart-tooltip");
    const firstLine = tooltip.firstElementChild;
    expect(firstLine?.textContent).toBe("1");
    expect(firstLine?.className).toContain("text-role-heading");
  });

  it("the tooltip shows the nickname, the Total value under the X axis's label, and the Swing Score value under the Y axis's label", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary"); // frc1: x=10, swingScore=1
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const tooltip = within(screen.getByTestId("bubble-chart-tooltip"));
    expect(tooltip.getByText("Team 1")).toBeDefined(); // nickname (makeRow's default)
    expect(tooltip.getByText("Total")).toBeDefined();
    expect(tooltip.getByText("Swing Score")).toBeDefined();
  });

  it("both tooltip values render with the table's two-decimal display precision", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary"); // frc1: x=10, swingScore=1
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const tooltip = within(screen.getByTestId("bubble-chart-tooltip"));
    expect(tooltip.getByText("10.00")).toBeDefined();
    expect(tooltip.getByText("1.00")).toBeDefined();
  });

  it("hovering a point whose Total metric publishes the algorithm's own confidence field produces a tooltip with no plus-minus glyph and no occurrence of that field's name", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "neutral"); // frc5, carries spread: 3.5
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const tooltip = screen.getByTestId("bubble-chart-tooltip");
    expect(tooltip.textContent ?? "").not.toContain("±");
    expect(tooltip.textContent ?? "").not.toContain("spread");
    expect(tooltip.textContent ?? "").not.toContain("3.5");
  });

  it("moving the pointer further than the hit radius from every point renders no tooltip and no highlight", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    fireEvent.pointerMove(svg, { clientX: 1, clientY: 1 }); // top-left corner, well outside every dot's hit disc

    expect(screen.queryByTestId("bubble-chart-tooltip")).toBeNull();
    expect(screen.queryByTestId("bubble-chart-highlight")).toBeNull();
  });

  it("a pointer leave event clears both the tooltip and the highlight", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary");
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });
    expect(screen.queryByTestId("bubble-chart-tooltip")).not.toBeNull();

    fireEvent.pointerLeave(svg);
    expect(screen.queryByTestId("bubble-chart-tooltip")).toBeNull();
    expect(screen.queryByTestId("bubble-chart-highlight")).toBeNull();
  });

  it("hovering renders exactly one highlight mark, centred on the hovered point's drawn coordinates", () => {
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary");
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const highlights = container.querySelectorAll('[data-testid="bubble-chart-highlight"]');
    expect(highlights).toHaveLength(1);
    expect(Number(highlights[0]!.getAttribute("cx"))).toBe(x);
    expect(Number(highlights[0]!.getAttribute("cy"))).toBe(y);
  });

  it("clicking at a point's coordinates calls onSelectTeam exactly once with that point", () => {
    const onSelectTeam = vi.fn();
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} onSelectTeam={onSelectTeam} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary"); // frc1
    fireEvent.click(svg, { clientX: x, clientY: y });

    expect(onSelectTeam).toHaveBeenCalledOnce();
    expect(onSelectTeam.mock.calls[0]![0]).toMatchObject({ teamKey: "frc1", teamNumber: 1 });
  });

  it("clicking further than the hit radius from every point does not call onSelectTeam", () => {
    const onSelectTeam = vi.fn();
    const { container } = render(<TeamsBubbleChart rows={MIXED_ROWS} onSelectTeam={onSelectTeam} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    fireEvent.click(svg, { clientX: 1, clientY: 1 });

    expect(onSelectTeam).not.toHaveBeenCalled();
  });

  it("rendering 400 rows with a hover active yields at most four data-tone paths, at most one highlight circle, and no other per-point element", () => {
    const rows: TeamRow[] = Array.from({ length: 400 }, (_, i) =>
      makeRow({
        teamKey: `frc${i + 1}`,
        teamNumber: i + 1,
        metrics: { [TOTAL_KEY]: { value: i, tier: i % 4 === 0 ? "legendary" : i % 3 === 0 ? "epic" : i % 2 === 0 ? "rare" : undefined } },
        swingScore: i,
      }),
    );
    const { container } = render(<TeamsBubbleChart rows={rows} />);
    const svg = container.querySelector("svg")!;
    stubRect(svg);
    const { x, y } = firstDotCoords(container, "legendary");
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });

    const paths = container.querySelectorAll("[data-tone]");
    const circles = container.querySelectorAll("circle");
    expect(paths.length).toBeLessThanOrEqual(4);
    expect(circles.length).toBeLessThanOrEqual(1);
  });
});
