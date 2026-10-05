/**
 * `useAsOfRewind` (quick task 261005-5g0): Live fetches nothing, a rewound stop
 * fetches through the query cache until resolved, and a refused fetch reads as
 * failed rather than as an unpublished object.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ARTIFACTS, CANDIDATES, EVENTS, FIXTURE_VERSION, NOW_STAGES, OBJECTS, asOfBodyFor, districtArtifact } from "./asOfTestFixtures.js";
import { buildDistrictTimeline, districtStageAtPosition } from "./districtTimeline.js";
import { useAsOfRewind, type UseAsOfRewindOptions } from "./useAsOfRewind.js";

function manifestBody() {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithms: [{ id: "spr", version: FIXTURE_VERSION, codeVersion: "9.0.0", paramSetName: "rolling" }],
  };
}

function installFetch(status: (url: string) => number = () => 200) {
  const calls: string[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/v1/manifest/algorithms.json")) return Promise.resolve(new Response(JSON.stringify(manifestBody()), { status: 200 }));
    const code = status(url);
    if (code !== 200) return Promise.resolve(new Response("", { status: code }));
    const body = asOfBodyFor(OBJECTS, url);
    return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;
  return calls;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function options(positionId: string, enabled = true): UseAsOfRewindOptions {
  const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
  const positionIndex = timeline.positions.findIndex((position) => position.id === positionId);
  return {
    enabled,
    artifactsLoading: false,
    districtArtifact: districtArtifact(),
    timeline,
    positionIndex,
    eventArtifacts: ARTIFACTS,
    stageByEvent: districtStageAtPosition(timeline, positionIndex, NOW_STAGES),
    at: positionId,
    candidates: CANDIDATES,
  };
}

describe("useAsOfRewind", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("returns undefined and fetches no as-of object at Live", async () => {
    const calls = installFetch();
    const { result } = renderHook(() => useAsOfRewind(options("2026wabbb:m:2026wabbb_qm2", false)), { wrapper });
    await waitFor(() => expect(calls.some((url) => url.includes("manifest"))).toBe(true));
    expect(result.current).toBeUndefined();
    expect(calls.some((url) => url.includes("/v1/asof"))).toBe(false);
  });

  it("is loading, then ready, after fetching the season object, every fetched event's INDEX and the cut event's LOG", async () => {
    const calls = installFetch();
    const { result } = renderHook(() => useAsOfRewind(options("2026wabbb:m:2026wabbb_qm2")), { wrapper });
    expect(result.current?.status).toBe("loading");
    await waitFor(() => expect(result.current?.status).toBe("ready"));
    const asOf = calls.filter((url) => url.includes("/v1/asof"));
    expect(asOf.some((url) => url.includes("/v1/asof-season/2026/"))).toBe(true);
    expect(asOf.some((url) => url.includes("/v1/asof/2026waaa/"))).toBe(true);
    expect(asOf.some((url) => url.includes("/v1/asof/2026wabbb/"))).toBe(true);
    expect(asOf.some((url) => url.includes("/v1/asof-log/2026wabbb/"))).toBe(true);
    expect(asOf.some((url) => url.includes("/v1/asof-start/"))).toBe(false);
    const ready = result.current;
    expect(ready?.status === "ready" && ready.result.status).toBe("ready");
  });

  it("reads a failed fetch (not a 404) as failed, never as an unpublished object", async () => {
    installFetch((url) => (url.includes("/v1/asof-season/") ? 503 : 200));
    const { result } = renderHook(() => useAsOfRewind(options("2026wabbb:m:2026wabbb_qm2")), { wrapper });
    await waitFor(() => expect(result.current?.status).toBe("failed"));
  });
});
