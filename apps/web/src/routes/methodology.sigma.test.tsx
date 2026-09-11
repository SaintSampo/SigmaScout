/**
 * Route-level coverage for `/methodology/sigma` (quick task 260910-u7g).
 * Builds a small, self-contained route tree the same way
 * `methodology.acknowledgments.test.tsx` does — the REAL exported `Route`
 * object from `methodology.sigma.tsx` is under test.
 *
 * THE LOAD BEARING TEST IN THIS FILE is the rendered-DOM dash gate. The
 * person who asked for this page asked for no hyphens, and `sigmaContent.ts`'s
 * own gate only covers strings that live in the content module. Roughly half
 * the words on this page are labels INSIDE the six SVG figures, which are
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
  SIGMA_FIGURES,
  SIGMA_LEAD,
  SIGMA_PAGE_TITLE,
  SIGMA_SECTIONS,
} from "../components/methodology/sigmaContent.js";
import { Route as MethodologySigmaRouteImport } from "./methodology.sigma.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

async function renderMethodologySigma() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologySigmaRoute = MethodologySigmaRouteImport.update({
    id: "/methodology/sigma",
    path: "/methodology/sigma",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologySigmaRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/sigma"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

/**
 * `SigmaPage.tsx`'s own source, resolved relative to THIS module rather than
 * the process cwd — see `methodology.acknowledgments.test.tsx`'s "test scope
 * trap" note: a bare `vitest run` at the repo root picks up a different file
 * set than one invoked from `apps/web`, so a cwd-relative path is exactly how
 * a test starts passing in one invocation and failing in the other.
 */
function readSigmaPageSource(): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(testDir, "../components/methodology/SigmaPage.tsx"), "utf8");
}

describe("/methodology/sigma", () => {
  it("renders an h1 carrying the page title", async () => {
    await renderMethodologySigma();
    expect(screen.getByRole("heading", { level: 1, name: SIGMA_PAGE_TITLE })).toBeDefined();
  });

  it("renders the lead paragraph", async () => {
    await renderMethodologySigma();
    expect(document.body.textContent ?? "").toContain(SIGMA_LEAD);
  });

  // Iterates the exported constant — never a hand-typed second copy. The id
  // set itself is pinned by equality in `sigmaContent.test.ts`, which is what
  // stops a silently added section from slipping past this loop.
  it("renders a level 2 heading and every paragraph for all seven sections", async () => {
    await renderMethodologySigma();
    const bodyText = document.body.textContent ?? "";
    for (const section of SIGMA_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeDefined();
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(bodyText, `section "${section.id}" paragraph ${index} is not rendered`).toContain(paragraph);
      }
    }
  });

  it("renders exactly one accessible image per figure, each with its caption", async () => {
    await renderMethodologySigma();
    const bodyText = document.body.textContent ?? "";
    for (const figure of SIGMA_FIGURES) {
      const drawings = screen.getAllByRole("img", { name: figure.title });
      expect(drawings, `figure "${figure.id}" is not drawn exactly once`).toHaveLength(1);
      expect(bodyText, `figure "${figure.id}" caption is missing`).toContain(figure.caption);
    }
  });

  it("draws five figures and no more", async () => {
    await renderMethodologySigma();
    expect(screen.getAllByRole("img")).toHaveLength(SIGMA_FIGURES.length);
  });
});

describe("/methodology/sigma rendered text carries no dash character", () => {
  it("carries no hyphen-minus, including inside every SVG label", async () => {
    await renderMethodologySigma();
    expect(document.body.textContent ?? "").not.toContain(HYPHEN_MINUS);
  });

  it("carries no en dash, including inside every SVG label", async () => {
    await renderMethodologySigma();
    expect(document.body.textContent ?? "").not.toContain(EN_DASH);
  });

  it("carries no em dash, including inside every SVG label", async () => {
    await renderMethodologySigma();
    expect(document.body.textContent ?? "").not.toContain(EM_DASH);
  });
});

describe("/methodology/sigma names only the algorithms the site publishes", () => {
  it("never names the retired algorithm", async () => {
    await renderMethodologySigma();
    expect(document.body.textContent ?? "").not.toMatch(/\bvpr\b/i);
  });

  it("names OPR, EPA and SPR", async () => {
    await renderMethodologySigma();
    const bodyText = document.body.textContent ?? "";
    for (const algorithm of ["OPR", "EPA", "SPR"]) {
      expect(bodyText, `the page never names ${algorithm}`).toContain(algorithm);
    }
  });
});

describe("SigmaPage.tsx source discipline", () => {
  it("uses no literal hex colour — every colour is a custom property", () => {
    const source = readSigmaPageSource();
    const hexColours = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexColours, `hex literals found: ${hexColours.join(", ")}`).toEqual([]);
  });

  it("never wears the accent token, because nothing in these figures is clickable", () => {
    expect(readSigmaPageSource()).not.toContain("--color-accent");
  });

  it("fetches nothing — the page is static, so no query, no fetch, no api module", () => {
    const source = readSigmaPageSource();
    for (const token of ["useQuery", "fetch(", "lib/api"]) {
      expect(source, `SigmaPage.tsx references "${token}"`).not.toContain(token);
    }
  });

  it("never retypes the shipping estimator — every drawn value comes from the published code", () => {
    const source = readSigmaPageSource();
    // The half lives and the prior strength are read off
    // `DEFAULT_SIGMA_SCORE_OPTIONS`, never typed in. A figure that hard-codes
    // 18 or 2 keeps drawing the old shape after a retune, which is exactly the
    // stale-number failure this project keeps a log about.
    for (const literal of ["varHalfLife: ", "meanHalfLife: ", "priorObs: "]) {
      expect(source, `SigmaPage.tsx hard-codes ${literal}`).not.toContain(literal);
    }
    for (const imported of [
      "DEFAULT_SIGMA_SCORE_OPTIONS",
      "SigmaScoreAccumulator",
      "allianceSwingBandVariance",
    ]) {
      expect(source, `SigmaPage.tsx no longer imports ${imported}`).toContain(imported);
    }
  });

  it("draws the match band with the shipped match table's own geometry", () => {
    const source = readSigmaPageSource();
    for (const imported of ["MATCH_GEOMETRY", "allianceMarkPositions", "scaleToPlot", "padAxisDomain", "axisTicks"]) {
      expect(source, `SigmaPage.tsx no longer imports ${imported}`).toContain(imported);
    }
  });
});
