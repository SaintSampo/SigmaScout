/**
 * LD-3 polling, end to end through TanStack Query with fake timers
 * (260915-m4j): the event query refetches every 60 s only while the event is
 * live, never for a finished event, and not while the tab is hidden.
 *
 * `fetch` is mocked with a plain object (no Response stream), so every step
 * is driven by the fake clock alone.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../../packages/harness/pageArtifacts.js";
import { EVENT_POLL_INTERVAL_MS } from "../liveEvent.js";
import { eventQueryOptions } from "./event.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const PARAMS = { eventKey: "2026test", algorithmId: "opr", version: "1.0.0+test" };

function priced(matchKey: string, sortTime: number) {
  return {
    matchKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: Number(matchKey.replace(/\D/g, "")) || 1,
    sortTime,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 80,
    predictedBlueScore: 70,
  };
}

function eventArtifact(upcoming: unknown[]) {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: new Date(NOW).toISOString(),
    algorithmId: "opr",
    algorithmVersion: "1.0.0+test",
    eventKey: "2026test",
    season: 2026,
    matches: [],
    upcoming,
    teams: [],
  };
}

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function renderEventQuery() {
  // Production's staleTime, so a focus event alone never refetches: only the interval does.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useQuery(eventQueryOptions(PARAMS)), { wrapper });
  return { hook, client };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  focusManager.setFocused(true);
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("event query polling", () => {
  it("a current artifact with upcoming matches fetches again after 60 s", async () => {
    const fetchMock = mockFetch(eventArtifact([priced("2026test_qm9", NOW + 600_000)]));
    const { hook } = renderEventQuery();
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.data?.upcoming).toHaveLength(1);

    await advance(EVENT_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a finished artifact (no upcoming matches) fetches once and never polls", async () => {
    const fetchMock = mockFetch(eventArtifact([]));
    renderEventQuery();
    await advance(0);
    await advance(EVENT_POLL_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a stale artifact (latest scheduled match 8 days ago) never polls", async () => {
    const fetchMock = mockFetch(eventArtifact([priced("2026test_qm9", NOW - 8 * 24 * 60 * 60 * 1000)]));
    renderEventQuery();
    await advance(0);
    await advance(EVENT_POLL_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab does not poll; once focus returns, the next interval refetches", async () => {
    const fetchMock = mockFetch(eventArtifact([priced("2026test_qm9", NOW + 600_000)]));
    renderEventQuery();
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(false));
    await advance(EVENT_POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(true));
    await advance(0);
    // Focus alone does not refetch fresh data (staleTime 5 min) ...
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(EVENT_POLL_INTERVAL_MS);
    // ... the interval does.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
