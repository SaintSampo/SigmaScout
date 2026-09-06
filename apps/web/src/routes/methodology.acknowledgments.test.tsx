/**
 * Route-level coverage for `/methodology/acknowledgments` (quick task
 * 260905-tor). Builds a small, self-contained route tree the same way
 * `methodology.vpr.test.tsx`/`methodology.index.test.tsx` do — the REAL
 * exported `Route` object from `methodology.acknowledgments.tsx` is under
 * test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { ACKNOWLEDGMENTS_ENTRIES, ACKNOWLEDGMENTS_PACKAGES } from "../components/methodology/acknowledgmentsContent.js";
import { Route as MethodologyAcknowledgmentsRouteImport } from "./methodology.acknowledgments.js";

async function renderMethodologyAcknowledgments() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologyAcknowledgmentsRoute = MethodologyAcknowledgmentsRouteImport.update({
    id: "/methodology/acknowledgments",
    path: "/methodology/acknowledgments",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologyAcknowledgmentsRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/acknowledgments"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology/acknowledgments", () => {
  it("renders an h1 reading 'Acknowledgments'", async () => {
    await renderMethodologyAcknowledgments();
    expect(screen.getByRole("heading", { level: 1, name: "Acknowledgments" })).toBeDefined();
  });

  // Iterates the exported constant — never a hand-typed second copy of the
  // names/hrefs, per this task's own instruction.
  for (const entry of ACKNOWLEDGMENTS_ENTRIES) {
    it(`renders a heading and outbound link for "${entry.name}" pointing at ${entry.href}`, async () => {
      await renderMethodologyAcknowledgments();
      expect(screen.getByRole("heading", { level: 2, name: entry.name })).toBeDefined();
      const link = screen.getByRole("link", { name: entry.name });
      expect(link.getAttribute("href")).toBe(entry.href);
    });
  }

  it("every entry carries at least one non-blank paragraph — an emptied credit fails here rather than rendering a bare heading", () => {
    for (const entry of ACKNOWLEDGMENTS_ENTRIES) {
      expect(entry.paragraphs.length, `entry "${entry.name}" has no paragraphs`).toBeGreaterThan(0);
      for (const paragraph of entry.paragraphs) {
        expect(paragraph.trim().length, `entry "${entry.name}" has a blank paragraph`).toBeGreaterThan(0);
      }
    }
  });

  it("credits The Blue Alliance, Statbotics, FRC Locks and FIRST by name", () => {
    const names = ACKNOWLEDGMENTS_ENTRIES.map((entry) => entry.name);
    expect(names.some((name) => /blue alliance/i.test(name))).toBe(true);
    expect(names.some((name) => /statbotics/i.test(name))).toBe(true);
    expect(names.some((name) => /frc locks/i.test(name))).toBe(true);
    expect(names.some((name) => /^first$/i.test(name))).toBe(true);
  });

  it("every entry href is an absolute https URL", () => {
    for (const entry of ACKNOWLEDGMENTS_ENTRIES) {
      const url = new URL(entry.href);
      expect(url.protocol, `entry "${entry.name}" href is not https`).toBe("https:");
    }
  });

  it("every outbound anchor opens in a new tab with rel=noopener noreferrer", async () => {
    await renderMethodologyAcknowledgments();
    for (const entry of ACKNOWLEDGMENTS_ENTRIES) {
      const link = screen.getByRole("link", { name: entry.name });
      expect(link.getAttribute("target"), `entry "${entry.name}" missing target=_blank`).toBe("_blank");
      const rel = link.getAttribute("rel") ?? "";
      expect(rel, `entry "${entry.name}" missing rel noopener`).toContain("noopener");
      expect(rel, `entry "${entry.name}" missing rel noreferrer`).toContain("noreferrer");
    }
  });

  it("renders an internal link whose href pathname ends with /methodology/compare", async () => {
    await renderMethodologyAcknowledgments();
    const link = screen.getByRole("link", { name: /accuracy comparison/i });
    const href = link.getAttribute("href") ?? "";
    // Compare the pathname only — `preserveSearch` carries the router's
    // default-filled search params through, so the rendered href legitimately
    // has a query string appended (see methodology.vpr.test.tsx).
    expect(href.split("?")[0]?.endsWith("/methodology/compare")).toBe(true);
  });

  it("every ACKNOWLEDGMENTS_PACKAGES entry is a real dependency of apps/web", () => {
    // Resolved relative to THIS module (not the process cwd) — see
    // favicon.test.ts's "Test scope trap" doc comment: a bare `vitest run`
    // at the repo root picks up a different file set than `vitest run`
    // invoked from `apps/web`, so a cwd-relative path is exactly how a test
    // starts passing in one invocation and failing in the other.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(testDir, "../../package.json");
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const { package: pkg } of ACKNOWLEDGMENTS_PACKAGES) {
      expect(Object.prototype.hasOwnProperty.call(allDeps, pkg), `package "${pkg}" is not a dependency of apps/web`).toBe(true);
    }
  });

  it("states no numeric accuracy figure of its own — no Brier-shaped decimal, no percentage sign anywhere in the rendered prose", async () => {
    await renderMethodologyAcknowledgments();
    const bodyText = document.body.textContent ?? "";
    // A Brier score reads like "0.1234" (leading-zero decimal, 4 places).
    expect(bodyText).not.toMatch(/\b0\.\d{3,4}\b/);
    expect(bodyText).not.toContain("%");
  });

  it("makes no superiority claim against any credited project", async () => {
    await renderMethodologyAcknowledgments();
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    expect(bodyText).not.toMatch(/better than|outperforms|beats /);
  });

  it("makes no claim about any third party's licence, terms of use, or required attribution", async () => {
    await renderMethodologyAcknowledgments();
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    expect(bodyText).not.toMatch(/licen[sc]e|terms of use|terms of service|attribution requir/);
  });
});
