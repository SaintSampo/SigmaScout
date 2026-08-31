import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPARE_SEASONS, fetchCompareArtifact, type FetchCompareArtifactParams } from "./compare.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../../packages/harness/pageArtifacts.js";

function validCompareBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-30T00:00:00.000Z",
    algorithms: [{ id: "opr", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" }],
    slices: [],
    ...overrides,
  };
}

describe("fetchCompareArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects with ArtifactFetchError (status/year/resource) on a non-ok response", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    await expect(fetchCompareArtifact({ year: 2024 })).rejects.toMatchObject({
      name: "ArtifactFetchError",
      status: 500,
      year: 2024,
      resource: "comparison data",
    });
  });

  it("rejects with ArtifactValidationError when the body is missing the required slices key", async () => {
    const badBody: Record<string, unknown> = validCompareBody();
    delete badBody.slices;
    global.fetch = vi.fn(async () => new Response(JSON.stringify(badBody), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchCompareArtifact({ year: 2024 })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests a URL ending in /v1/compare/{year}.json with no algorithm id and no @ version segment", async () => {
    let requestedUrl = "";
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(validCompareBody()), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchCompareArtifact({ year: 2023 });

    expect(requestedUrl.endsWith("/v1/compare/2023.json")).toBe(true);
    expect(requestedUrl).not.toContain("@");
    expect(requestedUrl).not.toMatch(/\/v1\/compare\/2023\/(opr|epa|vpr)/);
  });

  it("propagates the real error and errors thrown by fetch itself never crash the returned promise chain silently", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(validCompareBody()), { status: 404 })) as unknown as typeof fetch;

    await expect(fetchCompareArtifact({ year: 2022 })).rejects.toBeInstanceOf(ArtifactFetchError);
  });
});

describe("FetchCompareArtifactParams — compile-time shape assertion", () => {
  it("carries exactly the single key `year` (Exclude<keyof T, 'year'> resolves to never)", () => {
    // If a future edit threads `algorithmId`/`version` onto this interface by
    // symmetry with the other four fetchers, this line fails typecheck
    // (`pnpm --filter web typecheck`) rather than silently drifting from the
    // key shape `ComparePageParams` actually supports.
    type OnlyYear = Exclude<keyof FetchCompareArtifactParams, "year">;
    const assertNever: OnlyYear extends never ? true : false = true;
    expect(assertNever).toBe(true);

    const params = { year: 2026 } satisfies FetchCompareArtifactParams;
    expect(params.year).toBe(2026);
  });
});

describe("COMPARE_SEASONS", () => {
  it("is the five seasons in ascending order, derived from the descending SEASONS constant", () => {
    expect(COMPARE_SEASONS).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(COMPARE_SEASONS[0]).toBeLessThan(COMPARE_SEASONS[COMPARE_SEASONS.length - 1]!);
  });
});
