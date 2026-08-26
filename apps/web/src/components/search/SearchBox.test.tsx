import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, TeamsArtifactSchema, type EventsArtifact, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SearchBox } from "./SearchBox.js";

const PLACEHOLDER = "Search teams or events";

const mockNavigate = vi.fn();
let mockSearch: Record<string, unknown> = { year: 2024, algorithm: "sigma1" };
let mockPathname = "/teams";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearch: () => mockSearch,
    useLocation: (opts?: { select?: (loc: { pathname: string }) => unknown }) => {
      const location = { pathname: mockPathname };
      return opts?.select ? opts.select(location) : location;
    },
  };
});

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;
}

function manifestResponse(): Response {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [
        { id: "sigma1", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
        { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
      ],
    }),
    { status: 200 },
  );
}

function team(overrides: Partial<TeamsArtifact["teams"][number]> = {}): TeamsArtifact["teams"][number] {
  return {
    teamKey: `frc${overrides.teamNumber ?? 1114}`,
    teamNumber: 1114,
    nickname: "Simbotics",
    record: { wins: 7, losses: 3, ties: 0 },
    metrics: { total: { value: 50 } },
    eventCount: 1,
    matchCount: 10,
    ...overrides,
  };
}

function makeTeamsArtifact(teams: TeamsArtifact["teams"]): TeamsArtifact {
  return TeamsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2024,
    teams,
  });
}

function event(overrides: Partial<EventsArtifact["events"][number]> = {}): EventsArtifact["events"][number] {
  return {
    eventKey: "2024casj",
    name: "Silicon Valley Regional",
    eventType: 0,
    isOffseason: false,
    startDate: "2024-03-01",
    week: 2,
    teamCount: 40,
    matchCount: 80,
    playedMatchCount: 80,
    country: "USA",
    stateProv: "CA",
    districtKey: null,
    ...overrides,
  };
}

function makeEventsArtifact(events: EventsArtifact["events"]): EventsArtifact {
  return EventsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2024,
    events,
  });
}

/** Never-resolving fetch response — simulates a permanently in-flight query for the "loading" degraded state. */
function pendingResponse(): Promise<Response> {
  return new Promise<Response>(() => {});
}

function baseFetchMock(opts: { teams?: TeamsArtifact["teams"]; eventsFetch?: () => Promise<Response> }) {
  const { teams = [team()], eventsFetch = pendingResponse } = opts;
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest/algorithms")) return Promise.resolve(manifestResponse());
    if (url.includes("/teams/")) return Promise.resolve(new Response(JSON.stringify(makeTeamsArtifact(teams)), { status: 200 }));
    if (url.includes("/events/")) return eventsFetch();
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe("SearchBox", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mockNavigate.mockClear();
    mockSearch = { year: 2024, algorithm: "sigma1" };
    mockPathname = "/teams";
    cleanup();
    vi.restoreAllMocks();
  });

  it("EVENTS LOADING: team results render immediately and stay keyboard-navigable while the events section shows the loading copy", async () => {
    global.fetch = baseFetchMock({ teams: [team({ teamNumber: 1114, nickname: "Simbotics" })] });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1114" } });

    const teamOption = await screen.findByRole("option", { name: /1114/ });
    expect(teamOption.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText("Loading events…")).toBeDefined();
  });

  it("EVENTS FAILED: team results still render and navigate by keyboard, and the events section shows the team-results-only copy with no error banner anywhere", async () => {
    global.fetch = baseFetchMock({
      teams: [team({ teamNumber: 1114, nickname: "Simbotics" })],
      eventsFetch: () => Promise.resolve(new Response("boom", { status: 500 })),
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1114" } });

    const teamOption = await screen.findByRole("option", { name: /1114/ });
    expect(teamOption.getAttribute("aria-disabled")).toBe("false");
    await waitFor(() => expect(screen.getByText("Team results only — couldn't load events")).toBeDefined());
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("resolving the events query afterwards does not reorder the already-rendered team rows or move focus off the highlighted one", async () => {
    let resolveEvents: (value: Response) => void = () => {};
    const eventsPromise = new Promise<Response>((resolve) => {
      resolveEvents = resolve;
    });
    global.fetch = baseFetchMock({
      teams: [team({ teamNumber: 1114, nickname: "Simbotics" }), team({ teamNumber: 11140, nickname: "Simbotics B" })],
      eventsFetch: () => eventsPromise,
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1114" } });

    await screen.findByText("Loading events…");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    const beforeOptions = screen.getAllByRole("option");
    const beforeTextOrder = beforeOptions.map((el) => el.textContent);
    const selectedBefore = beforeOptions.find((el) => el.getAttribute("aria-selected") === "true")?.textContent;

    resolveEvents(new Response(JSON.stringify(makeEventsArtifact([event({ eventKey: "2024casj", name: "Silicon Valley Regional" })])), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("Loading events…")).toBeNull());

    const afterTeamOptions = screen.getAllByRole("option").filter((el) => /111/.test(el.textContent ?? ""));
    expect(afterTeamOptions.map((el) => el.textContent)).toEqual(beforeTextOrder);
    const selectedAfter = screen.getAllByRole("option").find((el) => el.getAttribute("aria-selected") === "true")?.textContent;
    expect(selectedAfter).toBe(selectedBefore);
  });

  it("a query matching nothing anywhere renders the no-matches copy inline", async () => {
    global.fetch = baseFetchMock({
      teams: [team({ teamNumber: 1114, nickname: "Simbotics" })],
      eventsFetch: () => Promise.resolve(new Response(JSON.stringify(makeEventsArtifact([event()])), { status: 200 })),
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzzznomatch" } });

    await waitFor(() => expect(screen.getByText('No teams or events found for "zzzznomatch"')).toBeDefined());
  });

  it("a query matching exactly one team navigates on Enter with no intermediate disambiguation step", async () => {
    global.fetch = baseFetchMock({
      teams: [team({ teamNumber: 1114, nickname: "Simbotics" })],
      eventsFetch: () => Promise.resolve(new Response(JSON.stringify(makeEventsArtifact([])), { status: 200 })),
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1114" } });
    await screen.findByRole("option", { name: /1114/ });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/team/$teamNumber", params: { teamNumber: "1114" } }));
  });

  it("a team-hit selection navigates to the real team route, carrying the selected team's number, current year and algorithm (D-15/D-16)", async () => {
    mockSearch = { year: 2023, algorithm: "epa" };
    global.fetch = baseFetchMock({
      teams: [team({ teamNumber: 1114, nickname: "Simbotics" })],
      eventsFetch: () => Promise.resolve(new Response(JSON.stringify(makeEventsArtifact([])), { status: 200 })),
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1114" } });
    const teamOption = await screen.findByRole("option", { name: /1114/ });
    fireEvent.click(teamOption);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0]?.[0] as { to: string; params: { teamNumber: string }; search: (prev: Record<string, unknown>) => Record<string, unknown> };
    expect(call.to).toBe("/team/$teamNumber");
    expect(call.params).toEqual({ teamNumber: "1114" });
    expect(call.search({ tab: "history" })).toEqual({ tab: "history", year: 2023, algorithm: "epa" });
  });

  it("nine matching team rows render exactly eight results (SEARCH_RESULT_CAP)", async () => {
    const nineTeams = Array.from({ length: 9 }, (_, i) => team({ teamNumber: 1000 + i, nickname: `Match Team ${i}` }));
    global.fetch = baseFetchMock({ teams: nineTeams, eventsFetch: () => Promise.resolve(new Response(JSON.stringify(makeEventsArtifact([])), { status: 200 })) });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "match" } });

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("option")).toHaveLength(8);
  });

  it("an event row with a null week renders no week chip", async () => {
    mockPathname = "/events"; // events resident on this route, fetched unconditionally
    global.fetch = baseFetchMock({
      teams: [],
      eventsFetch: () => Promise.resolve(new Response(JSON.stringify(makeEventsArtifact([event({ eventKey: "2024off", name: "Offseason Bash", week: null })])), { status: 200 })),
    });
    render(<SearchBox />, { wrapper });

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "offseason" } });

    await screen.findByRole("option", { name: /Offseason Bash/ });
    expect(screen.queryByText(/Week/)).toBeNull();
  });

  it("the mobile icon trigger exposes an accessible name", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;

    try {
      global.fetch = baseFetchMock({});
      render(<SearchBox />, { wrapper });
      expect(screen.getByRole("button", { name: "Open search" })).toBeDefined();
    } finally {
      window.matchMedia = original;
    }
  });

  it("the events query is enabled by a focus or input event, not at mount — the events fetcher is not called before interaction", async () => {
    const fetchMock = baseFetchMock({ teams: [team()] });
    global.fetch = fetchMock;
    render(<SearchBox />, { wrapper });

    await screen.findByPlaceholderText(PLACEHOLDER);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/events/"))).toBe(false);
  });
});
