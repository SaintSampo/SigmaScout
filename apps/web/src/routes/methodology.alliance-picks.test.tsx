/**
 * Route level coverage for `/methodology/alliance-picks` (quick task
 * 261014-ol7). Builds a small, self contained route tree the same way
 * `methodology.awards.test.tsx` does, so the REAL exported `Route` object is
 * under test, and drives the two interactive charts: the round toggle, the
 * teams left slider, the hover tooltips and the table views.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import {
  ALLIANCE_PICKS_LEAD,
  ALLIANCE_PICKS_PAGE_TITLE,
  CALIBRATION_FIXED_ORDER,
  CALIBRATION_LABELS,
  CALIBRATION_WEIGHTED_DRAFT,
  calibrationTooltip,
  formatChance,
  HOW_IT_SCORES_SECTION,
  PICK_TABLE_CAPTION,
  PICK_TABLE_SECTION,
  pickBarTooltip,
  pickChances,
  pickCounts,
  RESULTS_TABLE,
  SAID_VERSUS_HAPPENED_SUBSECTION,
  TEAMS_LEFT_DEFAULT,
  WHAT_IT_LEAVES_OUT_SECTION,
} from "../components/methodology/alliancePicksContent.js";
import { Route as MethodologyAlliancePicksRouteImport } from "./methodology.alliance-picks.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

async function renderPage() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const route = MethodologyAlliancePicksRouteImport.update({
    id: "/methodology/alliance-picks",
    path: "/methodology/alliance-picks",
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/methodology/alliance-picks"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("/methodology/alliance-picks", () => {
  it("renders the title, the lead, every heading with its anchor and every paragraph, in order", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: ALLIANCE_PICKS_PAGE_TITLE })).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      PICK_TABLE_SECTION.heading,
      HOW_IT_SCORES_SECTION.heading,
      WHAT_IT_LEAVES_OUT_SECTION.heading,
    ]);
    expect(screen.getByRole("heading", { level: 3, name: SAID_VERSUS_HAPPENED_SUBSECTION.heading })).toBeDefined();
    for (const id of ["the-pick-table", "how-it-scores", "said-versus-happened", "what-it-leaves-out"]) {
      expect(document.getElementById(id), `no element with id ${id}`).not.toBeNull();
    }
    const text = bodyText();
    for (const paragraph of [
      ALLIANCE_PICKS_LEAD,
      ...PICK_TABLE_SECTION.paragraphs,
      PICK_TABLE_CAPTION,
      ...HOW_IT_SCORES_SECTION.paragraphs,
      RESULTS_TABLE.caption,
      ...HOW_IT_SCORES_SECTION.afterTable,
      ...SAID_VERSUS_HAPPENED_SUBSECTION.paragraphs,
    ]) {
      expect(text).toContain(paragraph);
    }
    // Results before explanation of what is left out: the pick table chart, then the scores, then the limits.
    expect(text.indexOf(PICK_TABLE_CAPTION)).toBeLessThan(text.indexOf(RESULTS_TABLE.caption));
    expect(text.indexOf(RESULTS_TABLE.caption)).toBeLessThan(text.indexOf(WHAT_IT_LEAVES_OUT_SECTION.heading));
  });

  it("renders the results table, every cell, and the four limits", async () => {
    await renderPage();
    const table = screen.getByTestId("alliance-picks-results");
    for (const cell of [...RESULTS_TABLE.head, ...RESULTS_TABLE.rows.flat()]) expect(table.textContent).toContain(cell);
    const items = within(document.getElementById("what-it-leaves-out")!).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(WHAT_IT_LEAVES_OUT_SECTION.items.map((item) => `${item.label} ${item.detail}`));
  });

  it("draws one bar per team left, states the best team and the best 3, and follows the round toggle", async () => {
    await renderPage();
    const chart = screen.getByTestId("pick-table-chart");
    expect(within(chart).getAllByTestId("pick-table-bar-hit")).toHaveLength(TEAMS_LEFT_DEFAULT);

    const first = pickChances(pickCounts("first"), TEAMS_LEFT_DEFAULT);
    const stats = within(chart).getByTestId("pick-table-stats");
    expect(stats.textContent).toContain(`${formatChance(first[0]!)}best team left`);
    expect(stats.textContent).toContain(`${formatChance(first[0]! + first[1]! + first[2]!)}one of the best 3`);

    const second = within(chart).getByRole("button", { name: "Second pick" });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    const secondChances = pickChances(pickCounts("second"), TEAMS_LEFT_DEFAULT);
    expect(stats.textContent).toContain(`${formatChance(secondChances[0]!)}best team left`);
  });

  it("cuts the table to the slider's line and rescales the table view", async () => {
    await renderPage();
    const chart = screen.getByTestId("pick-table-chart");
    fireEvent.change(within(chart).getByRole("slider"), { target: { value: "6" } });
    expect(within(chart).getByTestId("pick-table-teams-left").textContent).toBe("6");
    expect(within(chart).getAllByTestId("pick-table-bar-hit")).toHaveLength(6);
    const rows = within(within(chart).getByTestId("pick-table-table")).getAllByRole("row");
    expect(rows).toHaveLength(1 + 6);
    const six = pickChances(pickCounts("first"), 6);
    expect(rows.slice(1).map((row) => row.textContent)).toEqual(six.map((chance, i) => `${i + 1}${formatChance(chance)}`));
  });

  it("shows a tooltip on a hovered bar and a hovered point, and hides it on leave", async () => {
    await renderPage();
    const chart = screen.getByTestId("pick-table-chart");
    fireEvent.pointerEnter(within(chart).getAllByTestId("pick-table-bar-hit")[2]!);
    const first = pickChances(pickCounts("first"), TEAMS_LEFT_DEFAULT);
    expect(within(chart).getByTestId("alliance-picks-tooltip").textContent).toBe(pickBarTooltip(3, first[2]!));

    const cal = screen.getByTestId("calibration-chart");
    expect(within(cal).getAllByTestId("calibration-weighted-point")).toHaveLength(CALIBRATION_WEIGHTED_DRAFT.length);
    expect(within(cal).getAllByTestId("calibration-fixed-point")).toHaveLength(CALIBRATION_FIXED_ORDER.length);
    const hits = within(cal).getAllByTestId("calibration-point-hit");
    fireEvent.pointerEnter(hits[1]!);
    expect(within(cal).getByTestId("alliance-picks-tooltip").textContent).toBe(
      calibrationTooltip(CALIBRATION_LABELS.weightedDraft, CALIBRATION_WEIGHTED_DRAFT[1]!),
    );
    fireEvent.pointerLeave(hits[1]!.closest("div")!);
    expect(within(cal).queryByTestId("alliance-picks-tooltip")).toBeNull();
  });

  it("draws the fixed order hollow and the weighted draft filled, with a legend naming both and the perfect line", async () => {
    await renderPage();
    const cal = screen.getByTestId("calibration-chart");
    for (const point of within(cal).getAllByTestId("calibration-fixed-point")) {
      expect(point.getAttribute("fill")).toBe("var(--color-bg-surface)");
    }
    for (const point of within(cal).getAllByTestId("calibration-weighted-point")) {
      expect(point.getAttribute("fill")).toBe("var(--color-text-primary)");
    }
    for (const label of [CALIBRATION_LABELS.fixedOrder, CALIBRATION_LABELS.weightedDraft, CALIBRATION_LABELS.perfect]) {
      expect(cal.textContent).toContain(label);
    }
    const rows = within(within(cal).getByTestId("calibration-table")).getAllByRole("row");
    expect(rows).toHaveLength(1 + CALIBRATION_FIXED_ORDER.length + CALIBRATION_WEIGHTED_DRAFT.length);
  });

  it("renders no hyphen minus, en dash or em dash anywhere in the page text", async () => {
    await renderPage();
    const text = bodyText();
    expect(text).not.toContain(HYPHEN_MINUS);
    expect(text).not.toContain(EN_DASH);
    expect(text).not.toContain(EM_DASH);
  });
});
