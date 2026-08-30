import { expect, test, type Page } from "@playwright/test";

/**
 * G-13 (07-UAT.md): `MetricHistoryChart`'s `<YAxis>` had no `tickFormatter`
 * (Recharts' own floating-point interval arithmetic over the domain surfaces
 * noise like `-1349.99999997`, the visible tail of which is what a real user
 * reported as tick labels reading `99999997`) and no explicit `width` (the
 * 60px Recharts default clips a label as wide as a real extreme value's).
 *
 * `frc4788`/2026/vpr is the reproduction case named in the gap report — its
 * published `total` runs deeply negative (a modelling/cold-start artifact,
 * NOT fixed here — see `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`).
 * `frc254`/2026/vpr is the normal-range control: this fix must not regress
 * the common case (short labels, no clipping risk) while fixing the extreme
 * one.
 */
const EXTREME_TEAM_ROUTE = "/team/4788?year=2026&algorithm=vpr&tab=history";
const NORMAL_TEAM_ROUTE = "/team/254?year=2026&algorithm=vpr&tab=history";

interface TickLegibility {
  label: string;
  left: number;
  textAnchorLeft: number;
}

async function readYAxisTickLegibility(page: Page): Promise<TickLegibility[]> {
  const chart = page.getByTestId("metric-history-chart");
  await expect(chart).toBeVisible();

  return chart.evaluate((el) => {
    const svg = el.querySelector("svg.recharts-surface");
    if (svg === null) throw new Error("expected a rendered recharts <svg>");
    const svgLeft = svg.getBoundingClientRect().left;

    // Recharts renders tick VALUE text in a separate `*-tick-labels` layer
    // group, a SIBLING of `.recharts-yAxis` (which holds only the axis line
    // and tick lines) rather than a descendant of it — confirmed by reading
    // the real rendered markup, not assumed from the source.
    const ticks = Array.from(el.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"));
    if (ticks.length === 0) throw new Error("expected at least one rendered Y-axis tick label");

    return ticks.map((tickEl) => {
      const rect = tickEl.getBoundingClientRect();
      return { label: tickEl.textContent ?? "", left: rect.left - svgLeft, textAnchorLeft: rect.left };
    });
  });
}

const FLOAT_NOISE_PATTERN = /\.\d*9{4,}\d*$|\.\d*0{4,}\d+$/;

test("extreme negative team (frc4788, 2026, vpr): no float-noise tick labels, none clipped at the plot's left edge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(EXTREME_TEAM_ROUTE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const ticks = await readYAxisTickLegibility(page);
  console.log(JSON.stringify({ test: "metric-history-axis extreme", ticks }));

  expect(ticks.length, "expected at least one rendered Y-axis tick").toBeGreaterThan(0);

  for (const tick of ticks) {
    expect(tick.label, `tick "${tick.label}" reads as float noise`).not.toMatch(FLOAT_NOISE_PATTERN);
    expect(
      tick.left,
      `tick "${tick.label}" left edge (${tick.left}px relative to the chart's SVG) is clipped — a value less than 0 means it starts before the SVG's own left edge`,
    ).toBeGreaterThanOrEqual(0);
  }
});

test("normal team (frc254, 2026, vpr): unaffected by the extreme-value fix — no clipping, no regression", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(NORMAL_TEAM_ROUTE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const ticks = await readYAxisTickLegibility(page);
  console.log(JSON.stringify({ test: "metric-history-axis normal", ticks }));

  expect(ticks.length, "expected at least one rendered Y-axis tick").toBeGreaterThan(0);

  for (const tick of ticks) {
    expect(tick.label, `tick "${tick.label}" reads as float noise`).not.toMatch(FLOAT_NOISE_PATTERN);
    expect(tick.left, `tick "${tick.label}" left edge (${tick.left}px) is clipped`).toBeGreaterThanOrEqual(0);
  }
});
