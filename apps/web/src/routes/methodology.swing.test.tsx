/**
 * Route-level coverage for `/methodology/swing` (quick task 260909-3fj).
 * Builds a small, self-contained route tree the same way
 * `methodology.acknowledgments.test.tsx` does — the REAL exported `Route`
 * object from `methodology.swing.tsx` is under test.
 *
 * THE LOAD BEARING TEST IN THIS FILE is the rendered-DOM dash gate. The
 * person who asked for this page asked for no hyphens, and `swingContent.ts`'s
 * own gate only covers strings that live in the content module. Roughly half
 * the words on this page are labels INSIDE the five SVG figures, which are
 * JSX, not content data. Scanning `document.body.textContent` is the only
 * check that covers both halves at once, so it is what actually enforces the
 * requirement across the whole page.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import {
  SWING_FIGURES,
  SWING_LEAD,
  SWING_PAGE_TITLE,
  SWING_SECTIONS,
} from "../components/methodology/swingContent.js";
import { Route as MethodologySwingRouteImport } from "./methodology.swing.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

async function renderMethodologySwing() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologySwingRoute = MethodologySwingRouteImport.update({
    id: "/methodology/swing",
    path: "/methodology/swing",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologySwingRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/swing"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

/**
 * `SwingPage.tsx`'s own source, resolved relative to THIS module rather than
 * the process cwd — see `methodology.acknowledgments.test.tsx`'s "test scope
 * trap" note: a bare `vitest run` at the repo root picks up a different file
 * set than one invoked from `apps/web`, so a cwd-relative path is exactly how
 * a test starts passing in one invocation and failing in the other.
 */
function readSwingPageSource(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(testDir, "../components/methodology/SwingPage.tsx"), "utf8");
}

describe("/methodology/swing", () => {
  it("renders an h1 carrying the page title", async () => {
    await renderMethodologySwing();
    expect(screen.getByRole("heading", { level: 1, name: SWING_PAGE_TITLE })).toBeDefined();
  });

  it("renders the lead paragraph", async () => {
    await renderMethodologySwing();
    expect(document.body.textContent ?? "").toContain(SWING_LEAD);
  });

  // Iterates the exported constant — never a hand-typed second copy. The id
  // set itself is pinned by equality in `swingContent.test.ts`, which is what
  // stops a silently added section from slipping past this loop.
  it("renders a level 2 heading and every paragraph for all seven sections", async () => {
    await renderMethodologySwing();
    const bodyText = document.body.textContent ?? "";
    for (const section of SWING_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeDefined();
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(bodyText, `section "${section.id}" paragraph ${index} is not rendered`).toContain(paragraph);
      }
    }
  });

  it("renders exactly one accessible image per figure, each with its caption", async () => {
    await renderMethodologySwing();
    const bodyText = document.body.textContent ?? "";
    for (const figure of SWING_FIGURES) {
      const drawings = screen.getAllByRole("img", { name: figure.title });
      expect(drawings, `figure "${figure.id}" is not drawn exactly once`).toHaveLength(1);
      expect(bodyText, `figure "${figure.id}" caption is missing`).toContain(figure.caption);
    }
  });

  it("draws five figures and no more", async () => {
    await renderMethodologySwing();
    expect(screen.getAllByRole("img")).toHaveLength(SWING_FIGURES.length);
  });
});

describe("/methodology/swing rendered text carries no dash character", () => {
  it("carries no hyphen-minus, including inside every SVG label", async () => {
    await renderMethodologySwing();
    expect(document.body.textContent ?? "").not.toContain(HYPHEN_MINUS);
  });

  it("carries no en dash, including inside every SVG label", async () => {
    await renderMethodologySwing();
    expect(document.body.textContent ?? "").not.toContain(EN_DASH);
  });

  it("carries no em dash, including inside every SVG label", async () => {
    await renderMethodologySwing();
    expect(document.body.textContent ?? "").not.toContain(EM_DASH);
  });
});

describe("/methodology/swing names only the algorithms the site publishes", () => {
  it("never names the retired algorithm", async () => {
    await renderMethodologySwing();
    expect(document.body.textContent ?? "").not.toMatch(/\bvpr\b/i);
  });

  it("names OPR, EPA and BPR", async () => {
    await renderMethodologySwing();
    const bodyText = document.body.textContent ?? "";
    for (const algorithm of ["OPR", "EPA", "BPR"]) {
      expect(bodyText, `the page never names ${algorithm}`).toContain(algorithm);
    }
  });
});

describe("SwingPage.tsx source discipline", () => {
  it("uses no literal hex colour — every colour is a custom property", () => {
    const source = readSwingPageSource();
    const hexColours = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexColours, `hex literals found: ${hexColours.join(", ")}`).toEqual([]);
  });

  it("never wears the accent token, because nothing in these figures is clickable", () => {
    expect(readSwingPageSource()).not.toContain("--color-accent");
  });

  it("fetches nothing — the page is static, so no query, no fetch, no api module", () => {
    const source = readSwingPageSource();
    for (const token of ["useQuery", "fetch(", "lib/api"]) {
      expect(source, `SwingPage.tsx references "${token}"`).not.toContain(token);
    }
  });

  it("never retypes the shipping constants — 1.92 and 6 are imported, not literals", () => {
    const source = readSwingPageSource();
    expect(source).not.toContain("1.92");
    for (const imported of [
      "SWING_FACTOR_HALF_LIFE_MATCHES",
      "swingDecayFor",
      "swingFactorFromDeviations",
      "allianceSwingBandVariance",
    ]) {
      expect(source, `SwingPage.tsx no longer imports ${imported}`).toContain(imported);
    }
  });

  it("draws the match band with the shipped match table's own geometry", () => {
    const source = readSwingPageSource();
    for (const imported of ["MATCH_GEOMETRY", "allianceMarkPositions", "scaleToPlot", "padAxisDomain", "axisTicks"]) {
      expect(source, `SwingPage.tsx no longer imports ${imported}`).toContain(imported);
    }
  });
});
