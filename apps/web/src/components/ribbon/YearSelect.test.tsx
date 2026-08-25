import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConstrainedYears, YearSelect } from "./YearSelect.js";
import { SEASONS } from "@/lib/seasons";
import { algorithmsManifestQueryOptions } from "@/lib/api/manifests";
import { teamQueryOptions } from "@/lib/api/team";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

// D-18 (06-07-PLAN.md Task 3). `YearSelect` mounts once at the root layout,
// so it can't use a strict route hook — mock `useLocation`/`useSearch` the
// same way `AlgorithmSelect.test.tsx` already mocks `useSearch`/`useNavigate`.
const mockNavigate = vi.fn();
let mockSearch: Record<string, unknown> = { year: 2024, algorithm: "sigma1" };
let mockPathname = "/teams";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearch: () => mockSearch,
    useLocation: () => ({ pathname: mockPathname }),
  };
});

const MANIFEST = {
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-08-24T00:00:00.000Z",
  algorithms: [{ id: "sigma1", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }],
};

const ALGORITHM_VERSION = "2.0.0+tuned-2026-08";

function teamArtifact(overrides: Partial<TeamSeasonArtifact> = {}): TeamSeasonArtifact {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: ALGORITHM_VERSION,
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    season: 2024,
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: {} },
    events: [],
    metricHistory: [],
    ...overrides,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The exact same key `teamQueryOptions` builds (and the route itself queries with) — `useConstrainedYears` must read THIS key, never a derived/approximate one. */
function teamKeyFor(year: number) {
  return teamQueryOptions({ teamKey: "frc1114", year, algorithmId: "sigma1", version: ALGORITHM_VERSION }).queryKey;
}

async function openAndListOptions(): Promise<string[]> {
  const trigger = screen.getByRole("combobox", { name: "Year" });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.click(trigger);
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent ?? "");
}

describe("YearSelect — D-18 constrained year dropdown", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mockNavigate.mockClear();
    mockSearch = { year: 2024, algorithm: "sigma1" };
    mockPathname = "/teams";
    cleanup();
    vi.restoreAllMocks();
  });

  it("on a non-team route renders the full, unconstrained SEASONS list", async () => {
    mockPathname = "/teams";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const client = makeQueryClient();
    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    const labels = await openAndListOptions();
    expect(labels).toEqual(SEASONS.map(String));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on a team route with a resolved 3-year activeYears, lists exactly those 3 years descending", async () => {
    mockPathname = "/team/1114";
    mockSearch = { year: 2024, algorithm: "sigma1" };
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    client.setQueryData(teamKeyFor(2024), teamArtifact({ activeYears: [2022, 2024, 2026] }));

    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    expect(await openAndListOptions()).toEqual(["2026", "2024", "2022"]);
    // Reads the already-cached artifact; never fetches it itself.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("useConstrainedYears: returns the full SEASONS list pending resolution, then narrows once activeYears resolves — never remounting the observer", async () => {
    // Same "assert the hook directly via renderHook" pattern
    // `AlgorithmSelect.test.tsx` uses for `useAlgorithmOptions`, decoupled
    // from Radix `Select`'s own conditional (open-only) content mounting.
    mockPathname = "/team/1114";
    mockSearch = { year: 2024, algorithm: "sigma1" };
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    // Cache starts EMPTY for the team artifact key — the pre-resolution state.

    const { result } = renderHook(() => useConstrainedYears(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });

    expect(result.current).toEqual(SEASONS);

    act(() => {
      client.setQueryData(teamKeyFor(2024), teamArtifact({ activeYears: [2023, 2024] }));
    });

    await waitFor(() => expect(result.current).toEqual([2024, 2023]));
  });

  it("the trigger's displayed value never changes and the Select is never remounted while activeYears resolves", async () => {
    mockPathname = "/team/1114";
    mockSearch = { year: 2024, algorithm: "sigma1" };
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    // Cache starts EMPTY for the team artifact key — the pre-resolution state.

    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    const triggerBefore = screen.getByRole("combobox", { name: "Year" });
    expect(triggerBefore.textContent).toBe("2024");

    // The team artifact resolves — same cache key `useConstrainedYears` reads.
    // `act(async ...)` (not the synchronous form) so React actually flushes
    // the state update the query-cache notification schedules before the
    // next assertion reads the DOM.
    await act(async () => {
      client.setQueryData(teamKeyFor(2024), teamArtifact({ activeYears: [2023, 2024] }));
    });

    const triggerAfter = screen.getByRole("combobox", { name: "Year" });
    expect(triggerAfter).toBe(triggerBefore); // same DOM node — never unmounted/remounted
    expect(triggerAfter.textContent).toBe("2024"); // trigger's displayed value never changed
  });

  it("on a rejected query, falls back to the full SEASONS list rather than blocking", async () => {
    mockPathname = "/team/1114";
    mockSearch = { year: 2024, algorithm: "sigma1" };
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    // Drive the query through a REAL failure so the cache holds a genuine
    // 'error' status (not merely "never fetched") under the exact key
    // `useConstrainedYears` reads.
    await client.prefetchQuery({ queryKey: teamKeyFor(2024), queryFn: () => Promise.reject(new Error("boom")) });

    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    const labels = await openAndListOptions();
    expect(labels).toEqual(SEASONS.map(String));
  });

  it("when the routed year is outside activeYears, the trigger still shows the routed year while the option list stays constrained", async () => {
    mockPathname = "/team/1114";
    mockSearch = { year: 2026, algorithm: "sigma1" };
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    client.setQueryData(teamKeyFor(2026), teamArtifact({ season: 2026, activeYears: [2024] }));

    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    expect(screen.getByRole("combobox", { name: "Year" }).textContent).toBe("2026");
    expect(await openAndListOptions()).toEqual(["2024"]);
  });

  it("a rookie team with a one-entry activeYears renders one enabled option, not a disabled control", async () => {
    mockPathname = "/team/1114";
    mockSearch = { year: 2024, algorithm: "sigma1" };
    const client = makeQueryClient();
    client.setQueryData(algorithmsManifestQueryOptions().queryKey, MANIFEST);
    client.setQueryData(teamKeyFor(2024), teamArtifact({ activeYears: [2024] }));

    render(<YearSelect />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    const trigger = screen.getByRole("combobox", { name: "Year" });
    expect(trigger.getAttribute("aria-disabled")).not.toBe("true");
    expect(trigger.hasAttribute("disabled")).toBe(false);
    expect(await openAndListOptions()).toEqual(["2024"]);
  });
});
