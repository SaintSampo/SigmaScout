/**
 * The district pre-simulation sidecar fetcher, including BOTH of the
 * divergences from `event.ts` it inherits from `preSchedule.ts`: a 404 returns
 * `null` because an absent sidecar is an ordinary expected state, while every
 * other non-ok status still throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { districtPreSimKey } from "../../../../../packages/harness/pageArtifacts.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";
import { districtPreSimQueryOptions, fetchDistrictPreSimArtifact } from "./districtLedger.js";

const PMF = { o: 0, p: [0.5, 0.5] };

function body(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    eventKey: "2026wasoon",
    year: 2026,
    roster: ["frc1", "frc2"],
    rows: [{ t: 0, qual: PMF, alliance: PMF, elim: PMF, award: PMF, total: PMF }],
    ...overrides,
  };
}

describe("fetchDistrictPreSimArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests the key `districtPreSimKey` builds — never a second spelling", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      seen.push(String(input));
      return Promise.resolve(new Response(JSON.stringify(body()), { status: 200 }));
    }) as unknown as typeof fetch;

    await fetchDistrictPreSimArtifact({ districtKey: "2026pnw", eventKey: "2026wasoon" });
    expect(seen[0]).toContain(districtPreSimKey({ districtKey: "2026pnw", eventKey: "2026wasoon" }));
  });

  it("parses a valid body through the real schema", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body()), { status: 200 }))) as unknown as typeof fetch;
    const parsed = await fetchDistrictPreSimArtifact({ districtKey: "2026pnw", eventKey: "2026wasoon" });
    expect(parsed?.eventKey).toBe("2026wasoon");
    expect(parsed?.rows).toHaveLength(1);
  });

  it("returns null for a 404 — an absent sidecar is an ordinary expected state, never an error state", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch;
    await expect(fetchDistrictPreSimArtifact({ districtKey: "2026pnw", eventKey: "2026wasoon" })).resolves.toBeNull();
  });

  it("still throws ArtifactFetchError for every other non-ok status, so an outage stays distinguishable from an uncovered event", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response("", { status: 500 }))) as unknown as typeof fetch;
    await expect(fetchDistrictPreSimArtifact({ districtKey: "2026pnw", eventKey: "2026wasoon" })).rejects.toBeInstanceOf(ArtifactFetchError);
  });

  it("throws ArtifactValidationError for a body that does not match the schema", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body({ roster: ["frc2", "frc1"] })), { status: 200 }))
    ) as unknown as typeof fetch;
    await expect(fetchDistrictPreSimArtifact({ districtKey: "2026pnw", eventKey: "2026wasoon" })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("keys the query positionally, in the order the fetcher takes its params", () => {
    expect(districtPreSimQueryOptions({ districtKey: "2026pnw", eventKey: "2026wasoon" }).queryKey).toEqual([
      "districtPreSim",
      "2026pnw",
      "2026wasoon",
    ]);
  });
});
