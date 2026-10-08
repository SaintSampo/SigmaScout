/**
 * The verdict drawer's three components and its CSS block (sketch 025 variant
 * A, quick task 261006-lxp), rendered directly over synthetic data: a two lump
 * grand total on 0..425, a qualification lump at the 22 point cap, and a five
 * row playoff list with a zero row.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { DistrictPointHistogram, type DistrictPointHistogramProps } from "./DistrictPointHistogram.js";
import { DistrictOutcomeList } from "./DistrictOutcomeList.js";
import { VerdictDrawer } from "./LedgerVerdictDrawer.js";
import { VERDICT_PLOT_W, pointBinSize, pointMedianTickLeft, pointX } from "./districtHistGeometry.js";
import type { VerdictModel, VerdictOutcomeRow } from "./ledgerVerdict.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = resolve(HERE, "..", "..", "styles", "theme.css");

afterEach(() => {
  cleanup();
});

/** A sparse distribution over 0..max. */
function sparse(max: number, pairs: ReadonlyArray<readonly [number, number]>): number[] {
  const counts = new Array<number>(max + 1).fill(0);
  for (const [value, count] of pairs) counts[value] = count;
  return counts;
}

const GRAND_MAX = 425;
const GRAND = sparse(GRAND_MAX, [
  [100, 120],
  [101, 100],
  [102, 70],
  [236, 60],
  [238, 120],
  [240, 200],
  [241, 260],
  [242, 180],
  [243, 70],
  [245, 90],
  [247, 40],
]);
const GRAND_DENOMINATOR = GRAND.reduce((sum, value) => sum + value, 0);
const QUAL = sparse(22, [
  [22, 58],
  [21, 22],
  [20, 12],
  [19, 8],
]);

function grandProps(overrides: Partial<DistrictPointHistogramProps> = {}): DistrictPointHistogramProps {
  const { p10, p50, p90 } = pointPercentiles(GRAND, GRAND_DENOMINATOR);
  return {
    counts: GRAND,
    denominator: GRAND_DENOMINATOR,
    maxPoints: GRAND_MAX,
    p10,
    p50,
    p90,
    label: "Grand total district points",
    testId: "district-ledger-drawer-grand-plot",
    ...overrides,
  };
}

const num = (element: Element, attribute: string): number => Number(element.getAttribute(attribute));

describe("DistrictPointHistogram as an SVG", () => {
  it("draws a cutoff chart at viewBox 0 0 560 124 with the zone, band, touching bars, tick, dashed line and label", () => {
    render(<DistrictPointHistogram {...grandProps({ cutoff: { position: 213, label: "cutoff ~213", zone: { p10: 199, p90: 228 } } })} />);
    const plot = screen.getByTestId("district-ledger-drawer-grand-plot");
    const svg = plot.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 560 124");
    expect(svg.getAttribute("class")).toBe("district-ledger-verdict-hist__svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-plot-max")).toBe(String(GRAND_MAX));
    expect(within(plot).getByText("Grand total district points").className).toBe("sr-only");

    const pattern = svg.querySelector("pattern")!;
    expect(pattern.getAttribute("width")).toBe("4");
    expect(pattern.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(pattern.getAttribute("patternTransform")).toBe("rotate(135)");
    expect(pattern.id).toMatch(/^district-ledger-hatch-[A-Za-z0-9_-]+$/);
    expect(pattern.querySelector("rect")!.getAttribute("class")).toBe("district-ledger-verdict-hist__hatch");
    const zone = within(plot).getByTestId("district-hist-cutoff-zone");
    expect(zone.getAttribute("fill")).toBe(`url(#${pattern.id})`);
    expect(num(zone, "y")).toBe(20);
    expect(num(zone, "height")).toBe(84);

    expect(within(plot).getByTestId("district-hist-band").getAttribute("class")).toBe("district-ledger-verdict-hist__band");

    const bars = within(plot).getAllByTestId("district-hist-bar");
    const heights = bars.map((bar) => num(bar, "height"));
    expect(Math.max(...heights)).toBeCloseTo(82, 9);
    for (const bar of bars) {
      expect(bar.getAttribute("shape-rendering")).toBe("crispEdges");
      expect(num(bar, "y") + num(bar, "height")).toBeCloseTo(104, 9);
    }
    // Neighbouring bins touch: no gap between two drawn bars one bin apart.
    const bin = pointBinSize(GRAND_MAX);
    const slotW = VERDICT_PLOT_W / (GRAND_MAX + 1);
    let touching = 0;
    for (let i = 1; i < bars.length; i++) {
      const previous = bars[i - 1]!;
      const gap = num(bars[i]!, "x") - (num(previous, "x") + num(previous, "width"));
      if (Math.abs(gap) < 1e-9) touching++;
      else expect(gap).toBeGreaterThanOrEqual(bin * slotW - 1e-9);
    }
    expect(touching).toBeGreaterThan(0);

    const tick = within(plot).getByTestId("district-hist-median-tick");
    expect(num(tick, "width")).toBe(2);
    expect(num(tick, "x")).toBeCloseTo(pointMedianTickLeft(grandProps().p50, GRAND_MAX, VERDICT_PLOT_W), 9);

    const line = within(plot).getByTestId("district-hist-marked-line");
    const cx = pointX(213, GRAND_MAX, VERDICT_PLOT_W);
    expect(num(line, "x1")).toBeCloseTo(cx, 9);
    expect(num(line, "y1")).toBe(18);
    expect(num(line, "y2")).toBe(104);
    expect(line.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(line.getAttribute("stroke-width")).toBe("1.5");
    const label = within(plot).getByTestId("district-hist-cutoff-label");
    expect(label.textContent).toBe("cutoff ~213");
    expect(label.getAttribute("text-anchor")).toBe("start");
    expect(num(label, "x")).toBeCloseTo(cx + 5, 9);
    expect(num(label, "y")).toBe(13);

    const legend = within(plot).getByTestId("district-hist-legend");
    expect(legend.children).toHaveLength(5);
    expect(legend.textContent).toBe("how often each total came uplikely rangemediancutoffwhere the cutoff lands in 8 of 10 runs");
  });

  it("anchors the cutoff label at its end, 5 left of the line, within 80 of the right edge", () => {
    render(<DistrictPointHistogram {...grandProps({ cutoff: { position: 400, label: "cutoff ~400" } })} />);
    const label = screen.getByTestId("district-hist-cutoff-label");
    const cx = pointX(400, GRAND_MAX, VERDICT_PLOT_W);
    expect(cx).toBeGreaterThan(VERDICT_PLOT_W - 80);
    expect(label.getAttribute("text-anchor")).toBe("end");
    expect(num(label, "x")).toBeCloseTo(cx - 5, 9);
    // A cutoff with no zone: four legend items, no pattern.
    expect(screen.getByTestId("district-hist-legend").children).toHaveLength(4);
    expect(document.querySelector("pattern")).toBeNull();
    expect(screen.queryByTestId("district-hist-cutoff-zone")).toBeNull();
  });

  it("draws neither a cutoff nor a cap label at viewBox height 110, with a three item legend", () => {
    render(<DistrictPointHistogram {...grandProps()} />);
    const svg = screen.getByTestId("district-ledger-drawer-grand-plot").querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 560 110");
    expect(svg.querySelector("pattern")).toBeNull();
    expect(screen.queryByTestId("district-hist-marked-line")).toBeNull();
    expect(screen.queryByTestId("district-hist-cutoff-label")).toBeNull();
    expect(screen.queryByTestId("district-hist-cap")).toBeNull();
    expect(screen.getByTestId("district-hist-legend").children).toHaveLength(3);
    expect(num(screen.getByTestId("district-hist-band"), "y")).toBe(6);
  });

  it("puts the axis hairline at the plot bottom and the tick labels on the ladder, the first anchored start", () => {
    render(<DistrictPointHistogram {...grandProps()} />);
    const axis = document.querySelector(".district-ledger-verdict-hist__axis")!;
    expect(num(axis, "x1")).toBe(0);
    expect(num(axis, "x2")).toBe(560);
    expect(num(axis, "y1")).toBe(90.5);
    const ticks = screen.getAllByTestId("district-hist-tick");
    expect(ticks.map((tick) => tick.textContent)).toEqual(["0", "100", "200", "300", "400"]);
    expect(ticks.map((tick) => tick.getAttribute("text-anchor"))).toEqual(["start", "middle", "middle", "middle", "middle"]);
    expect(num(ticks[1]!, "x")).toBeCloseTo(pointX(100, GRAND_MAX, VERDICT_PLOT_W), 9);
    expect(num(ticks[0]!, "y")).toBe(6 + 84 + 13);
  });

  it("draws a Qualification chart's cap label anchored end at the top right, with top 20", () => {
    const { p10, p50, p90 } = pointPercentiles(QUAL, 100);
    render(
      <DistrictPointHistogram
        counts={QUAL}
        denominator={100}
        maxPoints={22}
        p10={p10}
        p50={p50}
        p90={p90}
        capLabel="22 cap"
        label="Points for this category"
        testId="district-ledger-drawer-cell-plot"
      />
    );
    const svg = screen.getByTestId("district-ledger-drawer-cell-plot").querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 560 124");
    const cap = screen.getByTestId("district-hist-cap");
    expect(cap.textContent).toBe("22 cap");
    expect(cap.getAttribute("text-anchor")).toBe("end");
    expect(num(cap, "x")).toBeCloseTo(pointX(22, 22, VERDICT_PLOT_W), 9);
    expect(num(cap, "y")).toBe(13);
    // One value to a bar on a 23 slot axis, and the cap legend is not a cutoff.
    expect(screen.getAllByTestId("district-hist-bar")).toHaveLength(4);
    expect(screen.getByTestId("district-hist-legend").children).toHaveLength(3);
  });
});

const PLAYOFF_ROWS: VerdictOutcomeRow[] = [
  { key: "winner", label: "Wins the event", points: 30, chance: 0.05 },
  { key: "finalist", label: "Finalist", points: 20, chance: 0.08 },
  { key: "third", label: "Third place", points: 13, chance: 0.08 },
  { key: "fourth", label: "Fourth place", points: 7, chance: 0 },
  { key: "none", label: "Out before the top four", points: 0, chance: 0.79 },
];

describe("DistrictOutcomeList as labelled chance bars", () => {
  it("renders one grid row per outcome in order, the bar as a share of its track, and the points with the unit", () => {
    render(<DistrictOutcomeList rows={PLAYOFF_ROWS} label="Playoff outcomes" testId="district-ledger-drawer-outcomes" />);
    const list = screen.getByRole("list", { name: "Playoff outcomes" });
    expect(list.className).toBe("district-ledger-verdict-outcomes");
    expect(list.getAttribute("data-testid")).toBe("district-ledger-drawer-outcomes");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["winner", "finalist", "third", "fourth", "none"]);
    const first = rows[0]!;
    expect([...first.children].map((child) => child.className)).toEqual([
      "district-ledger-verdict-outcomes__label",
      "district-ledger-verdict-outcomes__track",
      "district-ledger-verdict-outcomes__chance",
      "district-ledger-verdict-outcomes__points",
    ]);
    expect(first.querySelector(".district-ledger-verdict-outcomes__track")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(first).getByTestId("district-ledger-outcome-bar").style.width).toBe("5%");
    expect(within(rows[4]!).getByTestId("district-ledger-outcome-bar").style.width).toBe("79%");
    expect(first.querySelector(".district-ledger-verdict-outcomes__chance")!.textContent).toBe("~5%");
    expect(first.querySelector(".district-ledger-verdict-outcomes__points")!.textContent).toBe("30 pts");
    // No caption anywhere: the list is the whole pane.
    expect(list.textContent).not.toContain("Each row");
  });

  it("marks a zero chance row's label and chance faint, and prints a range with the unit", () => {
    render(
      <DistrictOutcomeList
        rows={[...PLAYOFF_ROWS, { key: "captain", label: "Captain", points: 27, pointsHigh: 48, chance: 0.12 }]}
        label="Playoff outcomes"
      />
    );
    const zero = document.querySelector('[data-outcome="fourth"]')!;
    expect(zero.querySelector(".district-ledger-verdict-outcomes__label")!.className).toContain("district-ledger-verdict-outcomes__zero");
    expect(zero.querySelector(".district-ledger-verdict-outcomes__chance")!.className).toContain("district-ledger-verdict-outcomes__zero");
    expect(zero.querySelector(".district-ledger-verdict-outcomes__chance")!.textContent).toBe("0%");
    const nonZero = document.querySelector('[data-outcome="winner"]')!;
    expect(nonZero.querySelector(".district-ledger-verdict-outcomes__label")!.className).not.toContain("__zero");
    expect(document.querySelector('[data-outcome="captain"] .district-ledger-verdict-outcomes__points')!.textContent).toBe("27 to 48 pts");
  });

  it("renders nothing for an empty row list, so no empty labelled list reaches a screen reader (261007-3ik)", () => {
    render(<DistrictOutcomeList rows={[]} label="Playoff outcomes" testId="district-ledger-drawer-outcomes" />);
    expect(screen.queryByTestId("district-ledger-drawer-outcomes")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("VerdictDrawer", () => {
  function grandModel(sourceChips: VerdictModel["sourceChips"]): VerdictModel {
    const props = grandProps();
    return {
      eyebrow: "Grand total · 4915 Spartronics",
      headline: "Qualifies in 57 of 100 runs.",
      tiles: [
        { key: "median", label: "median", value: "~241" },
        { key: "likely", label: "likely", value: "101–243" },
        { key: "cutoff", label: "cutoff", value: "~213" },
      ],
      chart: {
        kind: "histogram",
        testId: "district-ledger-drawer-grand-plot",
        label: "Grand total district points",
        counts: props.counts,
        denominator: props.denominator,
        maxPoints: props.maxPoints,
        p10: props.p10,
        p50: props.p50,
        p90: props.p90,
        cutoff: { position: 213, label: "cutoff ~213", zone: { p10: 199, p90: 228 } },
        capLabel: undefined,
      },
      sourceChips,
    };
  }

  it("renders the eyebrow, an h3 headline, the tiles with the lead on the first, the note and the chart", () => {
    render(<VerdictDrawer model={grandModel([])} />);
    const drawer = screen.getByTestId("district-ledger-verdict");
    expect(drawer.className).toBe("district-ledger-verdict");
    expect(within(drawer).getByTestId("district-ledger-verdict-eyebrow").textContent).toBe("Grand total · 4915 Spartronics");
    const headline = within(drawer).getByTestId("district-ledger-verdict-headline");
    expect(headline.tagName).toBe("H3");
    expect(headline.textContent).toBe("Qualifies in 57 of 100 runs.");
    const tiles = within(drawer).getAllByTestId("district-ledger-verdict-tile");
    expect(tiles.map((tile) => tile.getAttribute("data-tile"))).toEqual(["median", "likely", "cutoff"]);
    expect(tiles[0]!.className).toBe("district-ledger-verdict__tile district-ledger-verdict__tile--lead");
    expect(tiles[1]!.className).toBe("district-ledger-verdict__tile");
    expect(tiles[2]!.querySelector(".district-ledger-verdict__tile-label")!.textContent).toBe("cutoff");
    expect(tiles[2]!.querySelector("b.district-ledger-verdict__tile-value")!.textContent).toBe("~213");
    expect(within(drawer).getByTestId("district-ledger-verdict-note").textContent).toBe("likely = 8 of 10 runs");
    expect(within(drawer).getByTestId("district-ledger-drawer-grand-plot")).toBeDefined();
    expect(within(drawer).getByTestId("district-hist-cutoff-label").textContent).toBe("cutoff ~213");
    // No chips, no source line.
    expect(within(drawer).queryByTestId("district-ledger-verdict-source")).toBeNull();
  });

  it("prints the source line only when chips exist, chips separated by a middle dot", () => {
    render(
      <VerdictDrawer
        model={grandModel([
          { kind: "earned", figure: "112", text: "earned at district events" },
          { kind: "predicted", figure: "~130", text: "predicted at the DCMP, in the field 71% of runs" },
          { kind: "note", text: "+10 rookie bonus" },
        ])}
      />
    );
    const source = screen.getByTestId("district-ledger-verdict-source");
    expect(source.className).toBe("district-ledger-verdict__source");
    expect(source.textContent).toBe("112 earned at district events·~130 predicted at the DCMP, in the field 71% of runs·+10 rookie bonus");
    expect([...source.querySelectorAll(".district-ledger-verdict__sep")].map((sep) => sep.textContent)).toEqual(["·", "·"]);
    expect(source.querySelector("b")!.textContent).toBe("112");
    expect(source.querySelector(".district-ledger-verdict__pred")!.textContent).toBe("~130");
  });

  it("renders the outcome list for an outcome chart, and a subtotal's category chips", () => {
    const model: VerdictModel = {
      eyebrow: "Playoffs · 4915 Spartronics",
      headline: "Out before the top four in 79 of 100 runs.",
      tiles: [
        { key: "mostLikely", label: "most likely", value: "Out before the top four" },
        { key: "chanceOfPoints", label: "chance of points", value: "21%" },
      ],
      chart: { kind: "outcomes", label: "Playoff outcomes", rows: PLAYOFF_ROWS },
      sourceChips: [
        { kind: "category", label: "Quals", figure: "~39", small: undefined, open: true },
        { kind: "category", label: "Alliance", figure: "44% picked", small: "pays 1 to 16", open: true },
        { kind: "category", label: "Awards", figure: "15", small: undefined, open: false },
      ],
    };
    render(<VerdictDrawer model={model} />);
    expect(screen.getByTestId("district-ledger-drawer-outcomes")).toBeDefined();
    expect(screen.queryByTestId("district-hist-legend")).toBeNull();
    const source = screen.getByTestId("district-ledger-verdict-source");
    expect(source.textContent).toBe("Quals ~39·Alliance 44% picked pays 1 to 16·Awards 15");
    expect(source.querySelector("i")!.textContent).toBe("pays 1 to 16");
    expect([...source.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["~39", "44% picked"]);
  });

  it("reads as the headline and tiles alone for an alliance already placed fifth to eighth (261007-3ik)", () => {
    const model: VerdictModel = {
      eyebrow: "Playoffs · 4915 Spartronics",
      headline: "Out before the top four in 100 of 100 runs.",
      tiles: [
        { key: "mostLikely", label: "most likely", value: "Out before the top four" },
        { key: "chanceOfPoints", label: "chance of points", value: "0%" },
      ],
      chart: { kind: "outcomes", label: "Playoff outcomes", rows: [] },
      sourceChips: [],
    };
    render(<VerdictDrawer model={model} />);
    const drawer = screen.getByTestId("district-ledger-verdict");
    expect(within(drawer).getByTestId("district-ledger-verdict-headline").textContent).toBe("Out before the top four in 100 of 100 runs.");
    expect(within(drawer).getAllByTestId("district-ledger-verdict-tile").map((tile) => tile.getAttribute("data-tile"))).toEqual(["mostLikely", "chanceOfPoints"]);
    expect(within(drawer).queryByTestId("district-ledger-drawer-outcomes")).toBeNull();
  });
});

describe("the verdict drawer's CSS contract (sketch 025 variant A)", () => {
  // `core.autocrlf` is true on this machine, so a checkout can carry CRLF.
  const css = readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n");
  const start = css.lastIndexOf("/*", css.indexOf("The Locks drawer, verdict first (sketch 025 variant A)"));
  const end = css.indexOf("end of the Locks drawer verdict block");
  const block = css.slice(start, end);

  it("finds the block between its two markers", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("carries the sketch's grid, gaps, breakpoint and sizes", () => {
    expect(block).toMatch(/\.district-ledger-verdict \{[^}]*grid-template-columns: minmax\(240px, 300px\) minmax\(280px, 1fr\);[^}]*gap: 12px 32px;[^}]*white-space: normal;/);
    expect(block).toMatch(/@media \(max-width: 760px\) \{\s*\.district-ledger-verdict \{\s*grid-template-columns: 1fr;/);
    expect(block).toMatch(/tr\.district-ledger-row--drawer > td \{[^}]*padding: 14px 16px 16px;/);
    expect(block).toMatch(/\.district-ledger-verdict__headline \{[^}]*margin: 2px 0 10px;[^}]*font-size: 18px;[^}]*line-height: 1\.25;/);
    expect(block).toMatch(/\.district-ledger-verdict__tile \{[^}]*border-radius: 8px;[^}]*padding: 6px 10px;[^}]*min-width: 78px;/);
    expect(block).toMatch(/\.district-ledger-verdict-hist__svg \{[^}]*width: 100%;[^}]*max-width: 560px;[^}]*height: auto;/);
    expect(block).toMatch(/\.district-ledger-verdict-legend \{[^}]*gap: 4px 14px;/);
    expect(block).toMatch(/\.district-ledger-verdict-outcomes \{[^}]*grid-template-columns: max-content 1fr max-content max-content;[^}]*gap: 6px 12px;[^}]*max-width: 560px;/);
    expect(block).toMatch(/\.district-ledger-verdict-outcomes__row \{[^}]*grid-template-columns: subgrid;/);
    expect(block).toMatch(/\.district-ledger-verdict-outcomes__track \{[^}]*height: 10px;[^}]*min-width: 120px;/);
    expect(block).toMatch(/\.district-ledger-verdict__source \{[^}]*margin-top: 8px;[^}]*gap: 4px 10px;/);
  });

  it("writes no hex, rgb or hsl literal", () => {
    const code = block.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
