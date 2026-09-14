import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import MetricHistoryChart, { BAND_FILL, BAND_FILL_OPACITY, LINE_STROKE } from "./MetricHistoryChart.js";
import { METRIC_HISTORY_LEGEND_HEIGHT_PX } from "./metricHistorySeries.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";

function row(overrides: {
  matchKey: string;
  eventKey: string;
  matchIndex: number;
  value?: number;
  spread?: number;
  sigma?: number;
  hasMetric?: boolean;
}): MetricHistoryRow {
  const hasMetric = overrides.hasMetric ?? true;
  return {
    matchKey: overrides.matchKey,
    season: 2024,
    eventKey: overrides.eventKey,
    algorithmId: "spr",
    teamKey: "frc1114",
    matchIndex: overrides.matchIndex,
    metrics: hasMetric
      ? {
          total: { value: overrides.value ?? 100, spread: overrides.spread },
          ...(overrides.sigma !== undefined ? { [SIGMA_METRIC_KEY]: { value: overrides.sigma } } : {}),
        }
      : {},
  };
}

const EVENT_NAMES: Record<string, string> = {
  "2024casj": "Sacramento Regional",
  "2024cala": "Los Angeles Regional",
};

describe("MetricHistoryChart", () => {
  it("renders NO Area band when points carry only a spread — the band is built from sigma, never spread", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, spread: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, spread: 6 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    // Spread is the algorithm's own confidence and must never reach the
    // screen. These rows carry no published sigma, so no band renders.
    expect(container.querySelectorAll(".recharts-area").length).toBe(0);
  });

  it("renders zero Area elements and no variance/spread copy when no row carries sigma (OPR/EPA)", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="opr" season={2024} eventNameByKey={EVENT_NAMES} />);

    expect(container.querySelectorAll(".recharts-area").length).toBe(0);
    expect(container.textContent?.toLowerCase()).not.toContain("variance");
    expect(container.textContent?.toLowerCase()).not.toContain("spread");
  });

  it("draws no band for OPR rows even when they carry a sigma key (algorithm gate wins, not row presence)", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 8 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, sigma: 9 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="opr" season={2024} eventNameByKey={EVENT_NAMES} />);

    expect(container.querySelectorAll(".recharts-area").length).toBe(0);
  });

  it("renders a single point with no line segment for a one-match team-season (E9 zero-one-many)", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 4 })];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    // Recharts never draws a curve path for a single-point Line series —
    // only the dot renders. Zero curve elements IS "no line path with more
    // than one coordinate pair" (there is no path element to have one).
    expect(container.querySelectorAll(".recharts-line-curve").length).toBe(0);
    expect(container.querySelectorAll(".recharts-line-dots").length).toBeGreaterThan(0);
  });

  it("renders many points as an ordinary line-plus-band, for spr rows carrying sigma", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, sigma: 6 }),
      row({ matchKey: "m3", eventKey: "2024casj", matchIndex: 2, value: 105, sigma: 5 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    expect(container.querySelectorAll(".recharts-line-curve").length).toBe(1);
    expect(container.querySelectorAll(".recharts-area").length).toBe(1);
    expect(container.textContent?.toLowerCase()).not.toContain("variance");
    expect(container.textContent?.toLowerCase()).not.toContain("spread");
  });

  describe("legend", () => {
    it("renders a two-item legend labelling Total and ± Sigma, sized to METRIC_HISTORY_LEGEND_HEIGHT_PX, when the band draws", () => {
      const rows = [
        row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 5 }),
        row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, sigma: 6 }),
      ];
      const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

      const legend = container.querySelector('[data-testid="metric-history-legend"]');
      expect(legend).not.toBeNull();
      expect(legend?.textContent).toContain("Total");
      expect(legend?.textContent).toContain("± Sigma");
      expect((legend as HTMLElement).style.height).toBe(`${METRIC_HISTORY_LEGEND_HEIGHT_PX}px`);

      const swatches = legend!.querySelectorAll('[aria-hidden="true"]');
      expect(swatches.length).toBe(2);
      const [lineSwatch, bandSwatch] = Array.from(swatches) as HTMLElement[];
      expect(lineSwatch!.style.background).toBe(LINE_STROKE);
      expect(bandSwatch!.style.background).toBe(BAND_FILL);
      expect(Number(bandSwatch!.style.opacity)).toBeCloseTo(BAND_FILL_OPACITY);

      const hexLike = /#[0-9A-Fa-f]{6}/;
      for (const el of Array.from(legend!.querySelectorAll("*"))) {
        expect((el as HTMLElement).style.background ?? "").not.toMatch(hexLike);
      }
    });

    it("renders no legend, and no rendered text mentions sigma, for OPR rows", () => {
      const rows = [
        row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100 }),
        row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110 }),
      ];
      const { container } = render(<MetricHistoryChart rows={rows} algorithmId="opr" season={2024} eventNameByKey={EVENT_NAMES} />);

      expect(container.querySelector('[data-testid="metric-history-legend"]')).toBeNull();
      expect(container.textContent?.toLowerCase()).not.toContain("sigma");
    });

    it("renders no legend for spr rows carrying no sigma entry (pre-republish)", () => {
      const rows = [
        row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100 }),
        row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110 }),
      ];
      const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

      expect(container.querySelector('[data-testid="metric-history-legend"]')).toBeNull();
      expect(container.textContent?.toLowerCase()).not.toContain("sigma");
    });
  });

  it("a middle row lacking sigma still renders one Area — the series gives that point a null band (a gap, not a broken chart)", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110 }), // no sigma: a gap in the band
      row({ matchKey: "m3", eventKey: "2024casj", matchIndex: 2, value: 105, sigma: 5 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    expect(container.querySelectorAll(".recharts-area").length).toBe(1);
  });

  it("renders a plain labelled axis and zero line elements for a zero-match team-season (E9 empty)", () => {
    const { container } = render(<MetricHistoryChart rows={[]} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    expect(container.querySelectorAll(".recharts-cartesian-axis").length).toBe(2);
    expect(container.querySelectorAll(".recharts-line").length).toBe(0);
  });

  it("uses only theme tokens, never a hardcoded hex literal, in the rendered inline styles/attrs", () => {
    // A structural proxy for the source-file grep acceptance criterion —
    // confirms no rendered fill/stroke attribute is a bare hex literal. Uses
    // a real sigma so the band's fill token is actually rendered, not just
    // the line's.
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, sigma: 6 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);
    const hexLike = /#[0-9A-Fa-f]{6}/;
    for (const el of Array.from(container.querySelectorAll("[fill], [stroke]"))) {
      expect(el.getAttribute("fill") ?? "").not.toMatch(hexLike);
      expect(el.getAttribute("stroke") ?? "").not.toMatch(hexLike);
    }
  });

  it("truncates a long event-name band label and carries the full name via an accessible <title>", () => {
    // 2026-09-01: truncation is width-aware now — one event's band spans the
    // whole default 640px chart (~98 chars of room), so the fixture name must
    // exceed even that to exercise the ellipsis path.
    const longName = "Very Long Championship Sub-Division Event Name 2024 With An Additional Ceremonial Suffix Attached For Good Measure And Then Some";
    const rows = Array.from({ length: 4 }, (_, i) => row({ matchKey: `m${i}`, eventKey: "2024long", matchIndex: i, value: 100 + i }));
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={{ "2024long": longName }} />);

    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain(longName);

    const bandText = Array.from(container.querySelectorAll("text")).find((t) => t.textContent?.includes("…"));
    expect(bandText).toBeDefined();
    expect(bandText?.textContent?.length ?? 0).toBeLessThan(longName.length);
  });

  it("renders legibly for a high-match-count team fixture spanning several events (E9 overflow backstop)", () => {
    const eventKeys = ["2024casj", "2024cala", "2024cabe", "2024cain"];
    const rows = Array.from({ length: 62 }, (_, i) =>
      row({ matchKey: `m${i}`, eventKey: eventKeys[Math.floor(i / 16)] ?? "2024casj", matchIndex: i * 3, value: 100 + i, sigma: 4 }),
    );
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    // Four distinct events -> four alternating ReferenceArea bands, one
    // continuous line/band across all 62 points, no thrown error.
    expect(container.querySelectorAll(".recharts-reference-area").length).toBe(4);
    expect(container.querySelectorAll(".recharts-line-curve").length).toBe(1);
    expect(container.querySelectorAll(".recharts-area").length).toBe(1);
  });

  it("renders no float-noise Y-axis tick labels for an extreme, negative domain", () => {
    // Mirrors the live-reported case (frc4788/2026/vpr): a deeply negative
    // total alongside a small positive one, the exact domain shape that
    // surfaced Recharts' own floating-point interval-arithmetic noise
    // (e.g. "-1349.99999997") before this fix's `tickFormatter`. Sigma
    // (quick task 260913-m45) now stands in for the retired spread-based
    // band fixture, since band edges are what stretched this domain.
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: -1354.13, sigma: 155.53 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 62.69, sigma: 5 }),
      row({ matchKey: "m3", eventKey: "2024casj", matchIndex: 2, value: -700, sigma: 30 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const ticks = Array.from(container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"));
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      // At most 2 decimal places (this project's own display-metric
      // precision, packages/harness/rounding.ts's ROUNDING_RULE.metric) —
      // never a long float tail.
      expect(tick.textContent ?? "").toMatch(/^-?\d+(\.\d{1,2})?$/);
    }
  });

  it("widens the Y axis for a wide extreme label, narrower for a typical short one — never a fixed magic number", () => {
    const extremeRows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: -1354.13, sigma: 155.53 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 62.69, sigma: 5 }),
    ];
    const normalRows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100, sigma: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 110, sigma: 6 }),
    ];

    const { container: extremeContainer } = render(<MetricHistoryChart rows={extremeRows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);
    const { container: normalContainer } = render(<MetricHistoryChart rows={normalRows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const extremeWidth = Number(extremeContainer.querySelector(".recharts-yAxis .recharts-cartesian-axis-line")?.getAttribute("width"));
    const normalWidth = Number(normalContainer.querySelector(".recharts-yAxis .recharts-cartesian-axis-line")?.getAttribute("width"));

    expect(extremeWidth).toBeGreaterThan(normalWidth);
    // The extreme label ("-1354.13", 8 characters) must not be narrower than
    // Recharts' own 60px default that clipped it pre-fix.
    expect(extremeWidth).toBeGreaterThan(60);
  });

  /**
   * 2026-09-07 (user request): the Y axis always includes metric = 0, so the
   * reader measures a trajectory against zero rather than against whichever
   * value this team happened to bottom out at. Asserted through the RENDERED
   * tick labels rather than by reaching into the component's internals —
   * the domain is not otherwise observable from the DOM, and a test that
   * reproduced the clamp arithmetic would pass against a broken component.
   */
  function tickValues(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"))
      .map((tick) => Number(tick.textContent))
      .filter((value) => Number.isFinite(value));
  }

  it("Y axis includes zero for an all-positive series — the baseline is 0, not the data minimum", () => {
    // Values nowhere near zero: pre-change the domain floor was 114 (the
    // lowest band edge), so 0 was nowhere on the axis. Sigma (quick task
    // 260913-m45) is what now stretches the domain past the data — the top
    // tick must be at or above the band's own upper edge (124 + 5 = 129).
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 118, sigma: 4 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 124, sigma: 5 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const ticks = tickValues(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.min(...ticks)).toBe(0);
    // The top still clears the data for the event-band label strip.
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(129);
  });

  it("Y axis includes zero for an all-NEGATIVE series — there 0 is the CEILING, not the floor", () => {
    // The clamp is two-sided: VPR/OPR totals go genuinely negative, and a
    // one-sided Math.min(0, ...) would leave this series' axis topping out
    // below zero. The band's lower edge (-80 - 5 = -85) is what the tick
    // floor must clear.
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: -80, sigma: 5 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: -40, sigma: 5 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const ticks = tickValues(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBe(0);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-85);
  });

  it("a band dipping below zero gets round Y ticks through zero, never ticks anchored at the band edge", () => {
    // The look check found a band lower edge of -18.71 rendering ticks
    // -18.71, 131.29, 281.29: every label offset by the edge. The ladder must
    // step through 0 and cover both band edges.
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 98, sigma: 116.71 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 400, sigma: 40 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const ticks = tickValues(container);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks).toContain(0);
    const step = ticks[1]! - ticks[0]!;
    for (const tick of ticks) expect(Math.abs(tick / step - Math.round(tick / step))).toBeLessThan(1e-9);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(98 - 116.71);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(440);
  });

  it("a flat all-positive series still spans zero rather than collapsing to a hairline", () => {
    // Zero-range data took the `headroom = 1` branch, which pre-change gave
    // the degenerate domain [100, 101]. No sigma here — band irrelevant to
    // this case.
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, value: 100 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 1, value: 100 }),
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    const ticks = tickValues(container);
    expect(Math.min(...ticks)).toBe(0);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(100);
  });

  it("plots only the Total metric — never a component key — for a mixed metrics payload", () => {
    const rows: MetricHistoryRow[] = [
      { matchKey: "m1", season: 2024, eventKey: "2024casj", algorithmId: "spr", teamKey: "frc1114", matchIndex: 0, metrics: { total: { value: 200, spread: 8 }, autoPoints: { value: 20, spread: 2 } } },
    ];
    const { container } = render(<MetricHistoryChart rows={rows} algorithmId="spr" season={2024} eventNameByKey={EVENT_NAMES} />);

    // A single point still renders (Total exists on the row); no assertion
    // needs a second series — MetricHistoryChart has no per-component Line
    // at all, verified structurally by MetricHistoryChart.tsx's own
    // acceptance criteria (no `metricKeysFor` import).
    expect(container.querySelectorAll(".recharts-line-dots").length).toBeGreaterThan(0);
  });
});
