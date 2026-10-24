/**
 * The Teams, Locks and Events pages under the REVEALED state (quick task 261024-lfa): `CURRENT_SEASON`
 * moved one past the newest game season, so a roster-only season (2027 today) is listed. The committed
 * `CURRENT_SEASON` stays on the newest game season until the roster season is verified live; this file
 * mocks `../lib/seasons.js` exactly as `lib/seasonReveal.test.ts` does, so the reveal is proven safe
 * without being made.
 *
 * - Teams and Locks show the plain "game is not out yet" state and request no artifact for that season.
 *   The publisher writes an empty teams list and no district file for it, and neither would say anything.
 * - The default season's Teams and Locks pages still request their artifacts (non-vacuity).
 * - The Events page lists the roster season's events with their roster team counts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { CURRENT_SEASON, DEFAULT_SEASON } from "../lib/seasons.js";
import { GAME_NOT_OUT_LOCKS_BODY, gameNotOutHeading, gameNotOutTeamsBody, isRosterOnlySeason } from "../lib/seasonGame.js";
import { Route as TeamsRouteImport } from "./teams.js";
import { Route as DistrictsRouteImport } from "./districts.js";
import { Route as EventsRouteImport } from "./events.js";

vi.mock("../lib/seasons.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/seasons.js")>();
  const { NEWEST_GAME_SEASON } = await import("../../../../packages/harness/rosterOnlySeason.js");
  const revealed = NEWEST_GAME_SEASON + 1;
  return {
    ...original,
    CURRENT_SEASON: revealed,
    // The same descending rule `seasons.ts` uses, rebuilt from the revealed bound.
    SEASONS: Array.from({ length: revealed - original.FIRST_SEASON + 1 }, (_, index) => revealed - index).filter(
      (season) => !original.EXCLUDED_SEASONS.includes(season)
    ),
  };
});

const ROSTER_SEASON = CURRENT_SEASON;
const VERSION = "2.0.0+tuned-2026-09";

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-10-24T00:00:00.000Z",
      algorithms: [{ id: "spr", version: VERSION, codeVersion: "2.0.0", paramSetName: "tuned-2026-09" }],
    }),
    { status: 200 }
  );
}

function teamsArtifactResponse(season: number) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-10-24T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: VERSION,
      season,
      teams: [
        {
          teamKey: "frc1",
          teamNumber: 1,
          nickname: "One",
          eventCount: 1,
          matchCount: 10,
          record: { wins: 6, losses: 4, ties: 0 },
          metrics: { total: { value: 50, tier: "rare" }, sigma: { value: 3.5 } },
          country: "USA",
        },
      ],
    }),
    { status: 200 }
  );
}

function districtsIndexResponse(season: number) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-10-24T00:00:00.000Z",
      year: season,
      districts: [{ districtKey: `${season}fnc`, abbreviation: "fnc", displayName: "FIRST North Carolina", dcmpSlots: 54, cmpSlots: 19, teamCount: 90, eventCount: 7 }],
    }),
    { status: 200 }
  );
}

/** Two rows shaped like the roster-only publisher's output: roster team counts, no matches, future dates. */
function rosterEventsResponse(season: number) {
  const row = (eventKey: string, name: string, startDate: string, teamCount: number, districtKey: string | null, eventType: number) => ({
    eventKey,
    name,
    eventType,
    isOffseason: false,
    startDate,
    week: 1,
    teamCount,
    matchCount: 0,
    playedMatchCount: 0,
    country: "USA",
    stateProv: null,
    districtKey,
  });
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-10-24T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: VERSION,
      season,
      events: [
        row(`${season}abca`, "Alberta Regional", `${season}-03-05`, 4, null, 0),
        row(`${season}micmp`, "Michigan Championship", `${season}-04-01`, 0, "fim", 2),
      ],
    }),
    { status: 200 }
  );
}

/** Records every requested URL; answers the manifest and whatever `extra` matches, and leaves the rest pending. */
function fetchSpy(extra: (url: string) => Response | undefined = () => undefined) {
  const urls: string[] = [];
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("manifest")) return Promise.resolve(manifestResponse());
    const answer = extra(url);
    return answer !== undefined ? Promise.resolve(answer) : new Promise<Response>(() => {});
  });
  global.fetch = spy as unknown as typeof fetch;
  return urls;
}

function renderRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamsRoute = TeamsRouteImport.update({ id: "/teams", path: "/teams", getParentRoute: () => rootRoute } as never);
  const districtsRoute = DistrictsRouteImport.update({ id: "/districts", path: "/districts", getParentRoute: () => rootRoute } as never);
  const eventsRoute = EventsRouteImport.update({ id: "/events", path: "/events", getParentRoute: () => rootRoute } as never);
  // Stubs so the rows' links resolve somewhere.
  const eventRoute = createRoute({ getParentRoute: () => rootRoute, path: "/event/$eventKey", component: () => <div /> });
  const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: "/team/$teamNumber", component: () => <div /> });
  const routeTree = rootRoute.addChildren([teamsRoute, districtsRoute, eventsRoute, eventRoute, teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

/** Lets the manifest resolve and any query it unlocks fire, so "nothing was requested" is a real observation. */
async function settle(urls: readonly string[]): Promise<void> {
  await waitFor(() => expect(urls.some((u) => u.includes("manifest"))).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("roster-only season pages (revealed state)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("is rehearsing a real roster-only season", () => {
    expect(isRosterOnlySeason(ROSTER_SEASON)).toBe(true);
    expect(isRosterOnlySeason(DEFAULT_SEASON)).toBe(false);
  });

  it("Teams shows the plain game not out state and requests no teams artifact for the roster season", async () => {
    const urls = fetchSpy((url) => (url.includes("/v1/teams/") ? teamsArtifactResponse(DEFAULT_SEASON) : undefined));
    renderRoute(`/teams?year=${ROSTER_SEASON}&algorithm=spr`);

    await waitFor(() => expect(screen.getByText(gameNotOutHeading(ROSTER_SEASON))).toBeDefined());
    expect(screen.getByRole("heading", { level: 1, name: `Teams ${ROSTER_SEASON}` })).toBeDefined();
    expect(screen.getByText(gameNotOutTeamsBody(ROSTER_SEASON))).toBeDefined();
    await settle(urls);
    expect(urls.filter((u) => u.includes(`/teams/${ROSTER_SEASON}/`))).toEqual([]);
    expect(screen.queryByTestId("teams-table-scroll")).toBeNull();
    expect(screen.queryByTestId("teams-chart-toggle")).toBeNull();
    expect(screen.queryByTestId("teams-view-toggle")).toBeNull();
    expect(screen.queryByTestId("teams-filter-row")).toBeNull();
  });

  it("Locks shows the plain game not out state and requests no district index or district file for the roster season", async () => {
    const urls = fetchSpy((url) => (url.includes("/v1/districts/") ? districtsIndexResponse(ROSTER_SEASON) : undefined));
    renderRoute(`/districts?year=${ROSTER_SEASON}&algorithm=spr&district=${ROSTER_SEASON}fim`);

    await waitFor(() => expect(screen.getByText(gameNotOutHeading(ROSTER_SEASON))).toBeDefined());
    expect(screen.getByRole("heading", { level: 1, name: "Locks" })).toBeDefined();
    expect(screen.getByText(GAME_NOT_OUT_LOCKS_BODY)).toBeDefined();
    await settle(urls);
    expect(urls.filter((u) => u.includes(`/v1/districts/${ROSTER_SEASON}`) || u.includes(`/v1/district/${ROSTER_SEASON}`))).toEqual([]);
    expect(screen.queryByRole("group", { name: "District" })).toBeNull();
    expect(screen.queryByText("No published district data yet")).toBeNull();
  });

  it("the default season's Teams and Locks pages still request their artifacts", async () => {
    const teamUrls = fetchSpy((url) => (url.includes("/v1/teams/") ? teamsArtifactResponse(DEFAULT_SEASON) : undefined));
    renderRoute(`/teams?year=${DEFAULT_SEASON}&algorithm=spr`);
    await waitFor(() => expect(teamUrls.some((u) => u.includes(`/v1/teams/${DEFAULT_SEASON}/`))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("teams-filter-row")).toBeDefined());
    expect(screen.getByTestId("teams-table-scroll")).toBeDefined();
    expect(screen.queryByText(gameNotOutHeading(DEFAULT_SEASON))).toBeNull();
    cleanup();

    const districtUrls = fetchSpy((url) => (url.includes("/v1/districts/") ? districtsIndexResponse(DEFAULT_SEASON) : undefined));
    renderRoute(`/districts?year=${DEFAULT_SEASON}&algorithm=spr`);
    await waitFor(() => expect(screen.getByRole("group", { name: "District" })).toBeDefined());
    expect(districtUrls.some((u) => u.includes(`/v1/districts/${DEFAULT_SEASON}.json`))).toBe(true);
    expect(screen.queryByText(gameNotOutHeading(DEFAULT_SEASON))).toBeNull();
  });

  it("Events lists the roster season's events with their roster team counts", async () => {
    const urls = fetchSpy((url) => (url.includes(`/v1/events/${ROSTER_SEASON}/`) ? rosterEventsResponse(ROSTER_SEASON) : undefined));
    renderRoute(`/events?year=${ROSTER_SEASON}&algorithm=spr`);

    await waitFor(() => expect(screen.getByText("Alberta Regional")).toBeDefined());
    expect(screen.getByRole("heading", { level: 1, name: `Events ${ROSTER_SEASON}` })).toBeDefined();
    expect(screen.getByText("Michigan Championship")).toBeDefined();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.queryByText(/couldn.t load|could not load|something went wrong/i)).toBeNull();
    expect(urls.some((u) => u.includes(`/v1/events/${ROSTER_SEASON}/spr@${VERSION}.json`))).toBe(true);
  });
});
