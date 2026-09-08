import { afterEach, describe, expect, it, vi } from "vitest";
import { EpaComparisonFetchError, EpaComparisonValidationError, fetchEpaComparisonArtifact } from "./epaComparison.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../../packages/harness/pageArtifacts.js";

function validEpaComparisonBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-09-08T00:00:00.000Z",
    measuredAt: "2026-09-08T00:00:00.000Z",
    epaVersion: "6.0.0+baseline",
    minMatches: 12,
    agreement: [],
    headToHead: [],
    ...overrides,
  };
}

describe("fetchEpaComparisonArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects with EpaComparisonFetchError on a non-ok response", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    await expect(fetchEpaComparisonArtifact()).rejects.toMatchObject({
      name: "EpaComparisonFetchError",
      status: 500,
    });
  });

  it("rejects with EpaComparisonValidationError when the body is missing a required key", async () => {
    const badBody: Record<string, unknown> = validEpaComparisonBody();
    delete badBody.agreement;
    global.fetch = vi.fn(async () => new Response(JSON.stringify(badBody), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchEpaComparisonArtifact()).rejects.toBeInstanceOf(EpaComparisonValidationError);
  });

  it("requests exactly /v1/methodology/epa-vs-statbotics.json, with no algorithm id, no @ version segment, and no year segment", async () => {
    let requestedUrl = "";
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(validEpaComparisonBody()), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchEpaComparisonArtifact();

    expect(requestedUrl.endsWith("/v1/methodology/epa-vs-statbotics.json")).toBe(true);
    expect(requestedUrl).not.toContain("@");
    expect(requestedUrl).not.toMatch(/\/v1\/methodology\/epa-vs-statbotics\/\d{4}/);
  });

  it("resolves with the parsed artifact on a valid response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(validEpaComparisonBody({ epaVersion: "7.0.0+baseline" })), { status: 200 })) as unknown as typeof fetch;

    const artifact = await fetchEpaComparisonArtifact();
    expect(artifact.epaVersion).toBe("7.0.0+baseline");
  });

  it("a 404 rejects with EpaComparisonFetchError carrying status 404, distinguishing it from every other failure", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    await expect(fetchEpaComparisonArtifact()).rejects.toMatchObject({ name: "EpaComparisonFetchError", status: 404 });
  });
});
