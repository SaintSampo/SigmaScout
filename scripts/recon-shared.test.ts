/**
 * Offline unit suite for `scripts/recon-shared.ts`'s pure helpers. No
 * network, no TBA_API_KEY required, no corpus access. Any temp file this
 * suite writes lives under `node:fs`'s `mkdtemp`, never under `docs/`.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveOutputPath,
  parseReconArgs,
  seasonsSlug,
  writeReconDoc,
} from "./recon-shared.js";

const COMMITTED_EVIDENCE_PATHS = [
  "docs/data/tba-field-recon-2019-2020.md",
  "docs/data/tba-rp-rates-2019-2020.md",
  "docs/data/tba-rp-thresholds-2019-2020.md",
  "docs/data/tba-rocket-rp-2019.md",
] as const;

describe("seasonsSlug", () => {
  it("yields the year alone for a single season", () => {
    expect(seasonsSlug([2020])).toBe("2020");
  });

  it("joins two adjacent seasons by a hyphen", () => {
    expect(seasonsSlug([2019, 2020])).toBe("2019-2020");
  });

  it("joins every requested season by hyphens in ascending order for a gapped list, never a compressed range", () => {
    // A gapped run (2019, 2022) must NOT collapse to a range-style "2019-2022"
    // that a contiguous 2019-2020-2021-2022 run would also produce if ranges
    // were compressed to endpoints.
    expect(seasonsSlug([2022, 2019])).toBe("2019-2022");
    expect(seasonsSlug([2019, 2020, 2021, 2022])).toBe("2019-2020-2021-2022");
    expect(seasonsSlug([2019, 2020, 2021, 2022])).not.toBe(seasonsSlug([2019, 2022]));
  });
});

describe("deriveOutputPath", () => {
  it("derives docs/data/{stem}-{slug}.md with no override", () => {
    expect(deriveOutputPath("recon-fields", [2020])).toBe("docs/data/recon-fields-2020.md");
  });

  it("returns the override verbatim when given one", () => {
    expect(deriveOutputPath("recon-fields", [2020], "/tmp/scratch/out.md")).toBe("/tmp/scratch/out.md");
  });

  it("never collides with any of the four committed evidence paths for the adjacent 2019/2020 pair", () => {
    const fieldsPath = deriveOutputPath("recon-fields", [2019, 2020]);
    const ratesPath = deriveOutputPath("recon-rp-rates", [2019, 2020]);
    const thresholdsPath = deriveOutputPath("recon-rp-thresholds", [2019, 2020]);

    for (const derived of [fieldsPath, ratesPath, thresholdsPath]) {
      for (const committed of COMMITTED_EVIDENCE_PATHS) {
        expect(derived).not.toBe(committed);
      }
    }
  });
});

describe("writeReconDoc", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws rather than writing when the rendered document contains the API key", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "recon-shared-test-"));
    const target = join(tmpDir, "leaky.md");
    await expect(writeReconDoc(target, "secret is sk-live-abc123", "sk-live-abc123", false)).rejects.toThrow(
      /REFUSING TO WRITE/
    );
  });

  it("throws rather than writing when the target path already exists and force is false", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "recon-shared-test-"));
    const target = join(tmpDir, "existing.md");
    await writeFile(target, "already here", "utf8");
    await expect(writeReconDoc(target, "new content", "some-key", false)).rejects.toThrow(/REFUSING TO WRITE/);
    expect(await readFile(target, "utf8")).toBe("already here");
  });

  it("writes when the target path already exists and force is true", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "recon-shared-test-"));
    const target = join(tmpDir, "existing.md");
    await writeFile(target, "already here", "utf8");
    await writeReconDoc(target, "new content", "some-key", true);
    expect(await readFile(target, "utf8")).toBe("new content");
  });

  it("writes a fresh file that does not yet exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "recon-shared-test-"));
    const target = join(tmpDir, "fresh.md");
    await writeReconDoc(target, "fresh content", "some-key", false);
    expect(await readFile(target, "utf8")).toBe("fresh content");
  });
});

describe("parseReconArgs", () => {
  it("rejects a missing seasons argument with a message naming the accepted grammar", () => {
    expect(() => parseReconArgs([])).toThrow(/single year|range|comma-separated/);
  });

  it("returns ascending de-duplicated seasons for a gapped list", () => {
    const args = parseReconArgs(["--seasons", "2020,2019,2020"]);
    expect(args.seasons).toEqual([2019, 2020]);
  });

  it("parses --out, --force, --events and --top", () => {
    const args = parseReconArgs([
      "--seasons",
      "2020",
      "--out",
      "/tmp/scratch/out.md",
      "--force",
      "--events",
      "2020isde1, 2020code",
      "--top",
      "2",
    ]);
    expect(args.out).toBe("/tmp/scratch/out.md");
    expect(args.force).toBe(true);
    expect(args.events).toEqual(["2020isde1", "2020code"]);
    expect(args.top).toBe(2);
  });

  it("defaults force to false and leaves out/events/top undefined when not given", () => {
    const args = parseReconArgs(["--seasons", "2020"]);
    expect(args.force).toBe(false);
    expect(args.out).toBeUndefined();
    expect(args.events).toBeUndefined();
    expect(args.top).toBeUndefined();
  });
});
