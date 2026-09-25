/**
 * Route level coverage for `/methodology/district-points` (phase 10 plan 08).
 * Builds a small, self contained route tree the same way
 * `methodology.awards.test.tsx` does, so the REAL exported `Route` object from
 * `methodology.district-points.tsx` is under test.
 *
 * The rendered DOM dash and plus minus gate is the second, independent voice
 * check: `districtLedgerContent.test.ts` gates the exported string VALUES, and
 * this one still holds if someone later adds a label, a caption or a table
 * cell in JSX rather than in the content module.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import {
  DISTRICT_LEDGER_LEAD,
  DISTRICT_LEDGER_PAGE_TITLE,
  DISTRICT_LEDGER_SECTIONS,
} from "../components/methodology/districtLedgerContent.js";
import { Route as MethodologyDistrictPointsRouteImport } from "./methodology.district-points.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";
const PLUS_MINUS = "±";

async function renderMethodologyDistrictPoints() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologyDistrictPointsRoute = MethodologyDistrictPointsRouteImport.update({
    id: "/methodology/district-points",
    path: "/methodology/district-points",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologyDistrictPointsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/methodology/district-points"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology/district-points", () => {
  it("renders an h1 carrying the page title", async () => {
    await renderMethodologyDistrictPoints();
    expect(screen.getByRole("heading", { level: 1, name: DISTRICT_LEDGER_PAGE_TITLE })).toBeDefined();
  });

  it("renders the lead paragraph", async () => {
    await renderMethodologyDistrictPoints();
    expect(document.body.textContent ?? "").toContain(DISTRICT_LEDGER_LEAD);
  });

  // Iterates the exported constant; the id set itself is pinned by equality in
  // `districtLedgerContent.test.ts`, which is what stops a silently added
  // section here.
  it("renders a level 2 heading and every paragraph for every section", async () => {
    await renderMethodologyDistrictPoints();
    const bodyText = document.body.textContent ?? "";
    for (const section of DISTRICT_LEDGER_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeDefined();
      for (const paragraph of section.paragraphs) {
        expect(bodyText, `${section.id} paragraph missing from the page`).toContain(paragraph);
      }
    }
  });

  it("gives each section an anchor id so a reader can link straight to it", async () => {
    await renderMethodologyDistrictPoints();
    for (const section of DISTRICT_LEDGER_SECTIONS) {
      expect(document.getElementById(section.id), `no element with id ${section.id}`).not.toBeNull();
    }
  });

  it("renders every table: its caption, its column headers and every cell", async () => {
    await renderMethodologyDistrictPoints();
    const tables = DISTRICT_LEDGER_SECTIONS.map((section) => section.table).filter((table) => table !== undefined);
    expect(screen.getAllByRole("table").length).toBe(tables.length);
    const bodyText = document.body.textContent ?? "";
    for (const table of tables) {
      if (table.caption !== undefined) expect(bodyText).toContain(table.caption);
      for (const cell of [...table.head, ...table.rows.flat()]) expect(bodyText, `cell "${cell}" missing`).toContain(cell);
    }
  });

  it("renders no hyphen minus, en dash, em dash or plus minus anywhere in the page text", async () => {
    await renderMethodologyDistrictPoints();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toContain(HYPHEN_MINUS);
    expect(bodyText).not.toContain(EN_DASH);
    expect(bodyText).not.toContain(EM_DASH);
    expect(bodyText).not.toContain(PLUS_MINUS);
  });
});
