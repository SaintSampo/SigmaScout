/**
 * Mirrors `teams.test.ts`'s shape (05-01) for the algorithms-manifest
 * fetcher: happy path, non-OK-status error, schema-failure error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAlgorithmsManifest, AlgorithmsManifestFetchError, AlgorithmsManifestValidationError } from "./manifests.js";

function makeValidManifest() {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithms: [
      { id: "opr", version: "2.0.0+baseline", codeVersion: "2.0.0", paramSetName: "baseline" },
      { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
      { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
    ],
  };
}

describe("fetchAlgorithmsManifest", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed fixture and returns typed entries", async () => {
    const manifest = makeValidManifest();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));

    const result = await fetchAlgorithmsManifest();

    expect(result.algorithms).toHaveLength(3);
    expect(result.algorithms.find((a) => a.id === "vpr")?.version).toBe("2.0.0+tuned-2026-08");
  });

  it("ignores extra keys on an entry rather than validating them (the client's narrow schema, not the harness's full one)", async () => {
    const manifest = makeValidManifest();
    // A real manifest entry also carries an optional `params` object (the
    // harness's full AlgorithmManifestEntrySchema) — the client schema must
    // strip it, never require or reject it.
    (manifest.algorithms[2] as Record<string, unknown>).params = { some: "vpr-only-shape" };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));

    const result = await fetchAlgorithmsManifest();
    expect(result.algorithms[2]).not.toHaveProperty("params");
  });

  it("raises AlgorithmsManifestFetchError with the status on a non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchAlgorithmsManifest();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AlgorithmsManifestFetchError);
    expect((caught as AlgorithmsManifestFetchError).status).toBe(404);
  });

  it("raises AlgorithmsManifestValidationError (not a bare throw) when a required field is missing", async () => {
    const manifest = makeValidManifest() as Record<string, unknown>;
    delete manifest.generation; // required field
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));

    await expect(fetchAlgorithmsManifest()).rejects.toBeInstanceOf(AlgorithmsManifestValidationError);
  });

  it("requests the manifest's own literal key at the artifact origin", async () => {
    const manifest = makeValidManifest();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));
    global.fetch = fetchMock;

    await fetchAlgorithmsManifest();

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/manifest/algorithms.json");
  });
});
