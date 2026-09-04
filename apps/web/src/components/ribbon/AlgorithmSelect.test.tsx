import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlgorithmSelect, algorithmDisplayLabel, useAlgorithmOptions } from "./AlgorithmSelect.js";

const mockNavigate = vi.fn();
let mockSearch: Record<string, unknown> = { year: 2024, algorithm: "vpr" };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearch: () => mockSearch,
  };
});

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [
        { id: "opr", version: "2.0.0+baseline", codeVersion: "2.0.0", paramSetName: "baseline" },
        { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
        { id: "not-a-published-id", version: "9.9.9+rogue", codeVersion: "9.9.9", paramSetName: "rogue" },
      ],
    }),
    { status: 200 }
  );
}

describe("useAlgorithmOptions", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("MANIFEST PENDING: all three options render with static labels (never empty, never blocked on the fetch)", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})); // never resolves
    const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
    expect(result.current.map((o) => o.id)).toEqual(["opr", "epa", "vpr"]);
    expect(result.current.map((o) => o.label)).toEqual(["OPR", "EPA", "VPR"]);
  });

  it("MANIFEST FAILURE: silently keeps the build-time list with no version suffix — no error surfaces from the hook", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
    // Give the (single, non-retried) failed query a tick to settle.
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((o) => o.label)).toEqual(["OPR", "EPA", "VPR"]);
  });

  it("an id in the manifest but not in PUBLISHED_ALGORITHM_IDS is ignored rather than rendered", async () => {
    global.fetch = vi.fn().mockResolvedValue(manifestResponse());
    const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
    await waitFor(() => expect(result.current.find((o) => o.id === "vpr")?.label).toContain("2.0.0+tuned-2026-08"));
    expect(result.current.map((o) => o.id)).toEqual(["opr", "epa", "vpr"]);
    expect(result.current.some((o) => (o as { id: string }).id === "not-a-published-id")).toBe(false);
  });

  it("a known id absent from the manifest still renders from the constant, without a version suffix", async () => {
    global.fetch = vi.fn().mockResolvedValue(manifestResponse());
    const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
    await waitFor(() => expect(result.current.find((o) => o.id === "opr")?.label).toBe("OPR 2.0.0+baseline"));
    // "epa" is absent from the fixture manifest above.
    expect(result.current.find((o) => o.id === "epa")?.label).toBe("EPA");
  });

  it("render order is always PUBLISHED_ALGORITHM_IDS's own order, independent of the manifest array's order", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          generation: "gen-1",
          computedAt: "2026-08-24T00:00:00.000Z",
          algorithms: [
            { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
            { id: "opr", version: "2.0.0+baseline", codeVersion: "2.0.0", paramSetName: "baseline" },
            { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
          ],
        }),
        { status: 200 }
      )
    );
    const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
    await waitFor(() => expect(result.current.every((o) => o.label.includes("+"))).toBe(true));
    expect(result.current.map((o) => o.id)).toEqual(["opr", "epa", "vpr"]);
  });

  // Test 7 (plan 07-18 Task 1): algorithmDisplayLabel is the single source —
  // it returns "VPR" for the published id, and the manifest-merge cases
  // above append the version suffix to that SAME base label, never a
  // re-typed literal.
  it("algorithmDisplayLabel returns VPR for the published id — the single source useAlgorithmOptions' merge reads from", () => {
    expect(algorithmDisplayLabel("vpr")).toBe("VPR");
    expect(algorithmDisplayLabel("opr")).toBe("OPR");
    expect(algorithmDisplayLabel("epa")).toBe("EPA");
  });

  // D-03 (quick task 260904-5px): the EPA ribbon option's version-gated full
  // name.
  describe("D-03: EPA's version-gated full name", () => {
    function manifestWithEpaVersion(epaVersion: string | undefined) {
      const algorithms = [
        { id: "opr", version: "2.0.0+baseline", codeVersion: "2.0.0", paramSetName: "baseline" },
        { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
      ];
      if (epaVersion !== undefined) {
        algorithms.push({ id: "epa", version: epaVersion, codeVersion: epaVersion.split("+")[0]!, paramSetName: "baseline" });
      }
      return new Response(
        JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-24T00:00:00.000Z", algorithms }),
        { status: 200 }
      );
    }

    it("epa at 5.x reads exactly 'EPA Statbotics 5.0' — no version suffix appended", async () => {
      global.fetch = vi.fn().mockResolvedValue(manifestWithEpaVersion("5.0.0+baseline"));
      const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
      await waitFor(() => expect(result.current.find((o) => o.id === "epa")?.label).toBe("EPA Statbotics 5.0"));
    });

    it("epa at a pre-5.0 version (e.g. 2.0.0+baseline) reads the ordinary base-label-plus-version form, unchanged", async () => {
      global.fetch = vi.fn().mockResolvedValue(manifestWithEpaVersion("2.0.0+baseline"));
      const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
      await waitFor(() => expect(result.current.find((o) => o.id === "epa")?.label).toBe("EPA 2.0.0+baseline"));
    });

    it("no manifest entry for epa (pending/failed/absent) reads the plain base label, unchanged", async () => {
      global.fetch = vi.fn().mockResolvedValue(manifestWithEpaVersion(undefined));
      const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
      await waitFor(() => expect(result.current.find((o) => o.id === "opr")?.label).toBe("OPR 2.0.0+baseline"));
      expect(result.current.find((o) => o.id === "epa")?.label).toBe("EPA");
    });

    it("opr and vpr options are unaffected by the epa gate in every case above", async () => {
      global.fetch = vi.fn().mockResolvedValue(manifestWithEpaVersion("5.0.0+baseline"));
      const { result } = renderHook(() => useAlgorithmOptions(), { wrapper });
      await waitFor(() => expect(result.current.find((o) => o.id === "epa")?.label).toBe("EPA Statbotics 5.0"));
      expect(result.current.find((o) => o.id === "opr")?.label).toBe("OPR 2.0.0+baseline");
      expect(result.current.find((o) => o.id === "vpr")?.label).toBe("VPR 2.0.0+tuned-2026-08");
    });

    it("algorithmDisplayLabel('epa') still returns the short 'EPA' regardless of the ribbon's version-gated full name", () => {
      expect(algorithmDisplayLabel("epa")).toBe("EPA");
    });
  });
});

describe("AlgorithmSelect", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mockNavigate.mockClear();
    mockSearch = { year: 2024, algorithm: "vpr" };
    cleanup();
    vi.restoreAllMocks();
  });

  it("MANIFEST FAILURE: renders no error banner and the trigger/selection stay usable", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    render(<AlgorithmSelect />, { wrapper });

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Algorithm" })).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Algorithm" }).textContent).toBe("VPR");
  });

  it("selecting the already-selected value performs no navigation", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    render(<AlgorithmSelect />, { wrapper });

    const trigger = screen.getByRole("combobox", { name: "Algorithm" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const vprOption = await screen.findByRole("option", { name: "VPR" });
    fireEvent.pointerUp(vprOption, { button: 0, pointerId: 1 });
    fireEvent.click(vprOption);

    // Reselecting the currently-selected id ("vpr", per mockSearch above)
    // must never call navigate.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("selecting a DIFFERENT value does navigate — contrast case proving the reselect guard above is not vacuously true", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    render(<AlgorithmSelect />, { wrapper });

    const trigger = screen.getByRole("combobox", { name: "Algorithm" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const oprOption = await screen.findByRole("option", { name: "OPR" });
    fireEvent.pointerUp(oprOption, { button: 0, pointerId: 1 });
    fireEvent.click(oprOption);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
