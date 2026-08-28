/**
 * D-12 / 03-REVIEW WR-03: `warnIfNewerPromotedVpr` makes a newer
 * committed VPR version file LOUD at load time while the pinned path
 * (`PROMOTED_VPR_VERSION_PATH` in `cli.ts`) stays the one that is
 * actually loaded — an explicit pin is a reproducibility feature (D-13
 * makes version identity load-bearing for Phase 4's artifacts, the Phase 5
 * dropdown, and the Phase 8 Compare page), not an oversight to paper over
 * with auto-selection (the globbing alternative D-12 rejected). Every case
 * here builds its fixtures in a TEMPORARY directory, never the real
 * committed version-file directory — a future real promotion must never
 * turn this suite red.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { warnIfNewerPromotedVpr } from "./cli.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../core/algorithms/sigma1/params.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "sigmascout-promoted-staleness-"));
  return tempDir;
}

/** A schema-valid promoted-version object, matching `promotedOverrides.test.ts`'s own fixture shape. */
function promotedVersionFile(id: string, paramSetName: string, promotedAt: string, params: Sigma1Params = DEFAULT_SIGMA1_PARAMS): string {
  return JSON.stringify({
    id,
    codeVersion: "2.0.0",
    paramSetName,
    version: `2.0.0+${paramSetName}`,
    params,
    provenance: {
      searchArtifact: "reports/test.json",
      corpusIdentity: "data/corpus.sqlite",
      promotedAt,
      objective: 0.15,
      tuneSeasons: [2022, 2023, 2024],
    },
    digest: {
      sliceSeason: 2022,
      sliceEventKeys: ["test"],
      sliceMatchCount: 100,
      predictionStreamSha256: "0".repeat(64),
      headlineMetrics: [],
    },
  });
}

const PINNED_PROMOTED_AT = "2026-08-16T20:00:00.000Z";
const OLDER_PROMOTED_AT = "2026-08-01T00:00:00.000Z";
const NEWER_PROMOTED_AT = "2026-08-18T12:00:00.000Z";

describe("warnIfNewerPromotedVpr (D-12 / 03-REVIEW WR-03)", () => {
  it("emits no warning given a versions directory containing only the pinned file", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      warnIfNewerPromotedVpr(dir, pinnedPath);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("emits a warning naming both the pinned file and the newer file when a newer VPR version exists", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    const newerPath = join(dir, "vpr@2.0.0+newer.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));
    writeFileSync(newerPath, promotedVersionFile("vpr", "newer", NEWER_PROMOTED_AT));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      warnIfNewerPromotedVpr(dir, pinnedPath);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).toContain("vpr@2.0.0+pinned.json");
      expect(message).toContain("vpr@2.0.0+newer.json");
      expect(message).toContain(PINNED_PROMOTED_AT);
      expect(message).toContain(NEWER_PROMOTED_AT);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("emits no warning when the other version file is OLDER than the pinned one — deliberately scoring an older version is legitimate work", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    const olderPath = join(dir, "vpr@2.0.0+older.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));
    writeFileSync(olderPath, promotedVersionFile("vpr", "older", OLDER_PROMOTED_AT));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      warnIfNewerPromotedVpr(dir, pinnedPath);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("ignores a newer version file belonging to a DIFFERENT algorithm id, regardless of timestamp", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    const otherPath = join(dir, "vpr-adapt@2.0.0+newer.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));
    writeFileSync(otherPath, promotedVersionFile("vpr-adapt", "newer", NEWER_PROMOTED_AT));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      warnIfNewerPromotedVpr(dir, pinnedPath);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns quietly (never throws) when the versions directory is missing", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));

    expect(() => warnIfNewerPromotedVpr(join(dir, "does-not-exist"), pinnedPath)).not.toThrow();
  });

  it("returns quietly (never throws) when the pinned file is missing", () => {
    const dir = makeTempDir();
    expect(() => warnIfNewerPromotedVpr(dir, join(dir, "no-such-pinned.json"))).not.toThrow();
  });

  it("skips a malformed/unparseable file in the versions directory rather than throwing", () => {
    const dir = makeTempDir();
    const pinnedPath = join(dir, "vpr@2.0.0+pinned.json");
    const malformedPath = join(dir, "vpr@2.0.0+malformed.json");
    writeFileSync(pinnedPath, promotedVersionFile("vpr", "pinned", PINNED_PROMOTED_AT));
    writeFileSync(malformedPath, "{ not valid json");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      expect(() => warnIfNewerPromotedVpr(dir, pinnedPath)).not.toThrow();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
