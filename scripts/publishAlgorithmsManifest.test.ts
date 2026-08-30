/**
 * WR-01 coverage (added retroactively by code review, phase 07): the shared
 * `v1/manifest/algorithms.json` write now re-fetches through the public origin
 * after `putObject` and asserts the read-back matches what was just composed,
 * mirroring `deleteOrphanedDemoTeamObjects.ts`/`deleteRetiredAlgorithmObjects.ts`'s
 * own probe/census read-back discipline. `putObject` is mocked (no credential,
 * no real R2 call — matches `packages/harness/publish.test.ts`'s established
 * `vi.mock("./r2Client.js", ...)` pattern); the read-back GET goes through a
 * mocked global `fetch`, matching `packages/ingest/tbaClient.test.ts`'s pattern.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../packages/harness/r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
}));

import { putObject } from "../packages/harness/r2Client.js";
import type { AlgorithmsManifest } from "../packages/harness/manifestSchemas.js";
import { ManifestReadBackMismatchError, run } from "./publishAlgorithmsManifest.js";

const SOURCE: AlgorithmsManifest = {
  schemaVersion: 1,
  generation: "gen-source",
  computedAt: "2026-08-29T00:00:00.000Z",
  algorithms: [
    { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" },
    { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
    { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("publishAlgorithmsManifest.run — WR-01 read-back verification", () => {
  let dir: string;
  let sourcePath: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-manifest-run-"));
    sourcePath = join(dir, "source.json");
    writeFileSync(sourcePath, JSON.stringify(SOURCE), "utf8");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("publishes and returns normally when the post-write read-back matches what was composed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SOURCE));

    const result = await run({
      fromLive: false,
      fromFile: sourcePath,
      addFrom: undefined,
      addId: undefined,
      dropId: undefined,
      out: undefined,
      dryRun: false,
      bucket: "test-bucket",
      origin: "https://example.test",
    });

    expect(result.algorithms.map((a) => a.id)).toEqual(["opr", "epa", "vpr"]);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://example.test/v1/manifest/algorithms.json?cb=");
    expect((init as { cache?: string }).cache).toBe("no-store");
  });

  it("throws ManifestReadBackMismatchError, naming expected vs observed, when the read-back disagrees with what was composed", async () => {
    const truncated: AlgorithmsManifest = { ...SOURCE, algorithms: SOURCE.algorithms.slice(0, 1) };
    fetchMock.mockResolvedValueOnce(jsonResponse(truncated));

    let thrown: unknown;
    try {
      await run({
        fromLive: false,
        fromFile: sourcePath,
        addFrom: undefined,
        addId: undefined,
        dropId: undefined,
        out: undefined,
        dryRun: false,
        bucket: "test-bucket",
        origin: "https://example.test",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ManifestReadBackMismatchError);
    const message = (thrown as Error).message;
    expect(message).toContain("opr@3.0.0+baseline");
    expect(message).toContain("epa@1.0.0+baseline");
    expect(message).toContain("vpr@2.0.0+tuned-2026-08");
    expect(putObject).toHaveBeenCalledTimes(1); // the write itself happened; only the verification failed
  });

  it("never calls putObject or fetch for the read-back when --dry-run is passed", async () => {
    const result = await run({
      fromLive: false,
      fromFile: sourcePath,
      addFrom: undefined,
      addId: undefined,
      dropId: undefined,
      out: undefined,
      dryRun: true,
      bucket: "test-bucket",
      origin: "https://example.test",
    });

    expect(result.algorithms.map((a) => a.id)).toEqual(["opr", "epa", "vpr"]);
    expect(putObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
