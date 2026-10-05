/**
 * The as-of object fetchers (quick task 261005-5g0): the key each one reads, a
 * 404 as a typed "not published" `null`, any other failure thrown, and a body
 * that does not parse thrown as a validation error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { asOfIndexKey, asOfLogKey, asOfSeasonKey, asOfStartKey } from "../../../../../packages/harness/pageArtifacts.js";
import { FIXTURE_VERSION, OBJECTS } from "../../components/districts/asOfTestFixtures.js";
import { asOfIndexQueryOptions, asOfStartQueryOptions, fetchAsOfIndex, fetchAsOfLog, fetchAsOfSeason, fetchAsOfStart } from "./asOf.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

const PARAMS = { algorithmId: "spr", version: FIXTURE_VERSION };

function serve(status: number, body: string | undefined) {
  const calls: string[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response(body ?? "", { status }));
  }) as unknown as typeof fetch;
  return calls;
}

describe("lib/api/asOf", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reads each object at its one key and parses it", async () => {
    const indexKey = asOfIndexKey({ eventKey: "2026wabbb", ...PARAMS });
    const calls = serve(200, OBJECTS.bodies.get(indexKey));
    const index = await fetchAsOfIndex({ eventKey: "2026wabbb", ...PARAMS });
    expect(calls[0]!.endsWith(indexKey)).toBe(true);
    expect(index?.m.length).toBe(4);

    serve(200, OBJECTS.bodies.get(asOfLogKey({ eventKey: "2026wabbb", ...PARAMS })));
    expect((await fetchAsOfLog({ eventKey: "2026wabbb", ...PARAMS }))?.rows.length).toBe(4);
    serve(200, OBJECTS.bodies.get(asOfSeasonKey({ season: 2026, ...PARAMS })));
    expect((await fetchAsOfSeason({ season: 2026, ...PARAMS }))?.season).toBe(2026);
    serve(200, OBJECTS.bodies.get(asOfStartKey({ season: 2026, ...PARAMS })));
    expect((await fetchAsOfStart({ season: 2026, ...PARAMS }))?.season).toBe(2026);
  });

  it("returns null for a 404, which the resolver reads as not published", async () => {
    serve(404, undefined);
    expect(await fetchAsOfIndex({ eventKey: "2026wabbb", ...PARAMS })).toBeNull();
    expect(await fetchAsOfStart({ season: 2026, ...PARAMS })).toBeNull();
  });

  it("throws for any other failure and for a body that does not parse", async () => {
    serve(503, undefined);
    await expect(fetchAsOfSeason({ season: 2026, ...PARAMS })).rejects.toBeInstanceOf(ArtifactFetchError);
    serve(200, JSON.stringify({ not: "an index" }));
    await expect(fetchAsOfIndex({ eventKey: "2026wabbb", ...PARAMS })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("keys each query by kind and its fetcher's params, and never refetches the season start object", () => {
    expect(asOfIndexQueryOptions({ eventKey: "2026wabbb", ...PARAMS }).queryKey).toEqual(["asOfIndex", "2026wabbb", "spr", FIXTURE_VERSION]);
    expect(asOfStartQueryOptions({ season: 2026, ...PARAMS }).staleTime).toBe(Number.POSITIVE_INFINITY);
  });
});
