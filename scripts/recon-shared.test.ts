/**
 * Offline unit suite for `scripts/recon-shared.ts`'s pure helpers, plus the
 * boolean-enumeration and threshold-sweep helpers exported from
 * `scripts/recon-rp-rates.ts` and `scripts/recon-rp-thresholds.ts`. No
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
import { tallyBooleans } from "./recon-rp-rates.js";
import { boolCheck, boolCheckCandidates, sweep, sweepCandidates, type Obs } from "./recon-rp-thresholds.js";

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

describe("tallyBooleans", () => {
  it("reports BOTH keys with correct fired/present counts for a 2016-shaped fixture with no RP-suffixed name (false-negative guard)", () => {
    // 2016's real bonus RPs are teleopTowerCaptured/teleopDefensesBreached --
    // neither name carries an RP-shaped suffix. A name filter would find
    // zero; enumeration must find both.
    const sides2016 = [
      { teleopTowerCaptured: true, teleopDefensesBreached: false, autoMobilityPoints: 5 },
      { teleopTowerCaptured: false, teleopDefensesBreached: true, autoMobilityPoints: 0 },
      { teleopTowerCaptured: true, teleopDefensesBreached: true, autoMobilityPoints: 10 },
    ];

    const rows = tallyBooleans(sides2016);
    const byKey = new Map(rows.map((r) => [r.key, r]));

    expect(byKey.has("teleopTowerCaptured")).toBe(true);
    expect(byKey.has("teleopDefensesBreached")).toBe(true);
    expect(byKey.get("teleopTowerCaptured")).toEqual({ key: "teleopTowerCaptured", fired: 2, present: 3 });
    expect(byKey.get("teleopDefensesBreached")).toEqual({ key: "teleopDefensesBreached", fired: 2, present: 3 });
  });

  it("tallies the complete boolean key set for a 2022-shaped fixture, filtering nothing out and inventing nothing (false-positive guard)", () => {
    // quintetAchieved is a prerequisite, not an RP. A name filter would
    // still need to decide about it one way or the other; enumeration
    // reports every boolean and leaves that judgment to the human reader.
    const sides2022 = [
      { quintetAchieved: true, cargoBonusRankingPoint: true, hangarBonusRankingPoint: false, autoPoints: 10 },
      { quintetAchieved: false, cargoBonusRankingPoint: false, hangarBonusRankingPoint: true, autoPoints: 8 },
    ];

    const rows = tallyBooleans(sides2022);
    const keys = rows.map((r) => r.key).sort();

    expect(keys).toEqual(["cargoBonusRankingPoint", "hangarBonusRankingPoint", "quintetAchieved"].sort());
  });

  it("never includes a non-boolean field in the tally", () => {
    const sides = [{ flagA: true, numericField: 5, stringField: "x", nullField: null }];
    const rows = tallyBooleans(sides);
    expect(rows.map((r) => r.key)).toEqual(["flagA"]);
  });

  it("reports a present count below the side count when a key is absent on some sides", () => {
    const sides = [{ flagA: true }, { flagA: false, flagB: true }];
    const rows = tallyBooleans(sides);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("flagA")).toEqual({ key: "flagA", fired: 1, present: 2 });
    expect(byKey.get("flagB")).toEqual({ key: "flagB", fired: 1, present: 1 });
  });

  it("returns rows sorted by key so two runs over the same data render identically", () => {
    const sides = [{ zebra: true, apple: false, mango: true }];
    const rows = tallyBooleans(sides);
    expect(rows.map((r) => r.key)).toEqual(["apple", "mango", "zebra"]);
  });
});

describe("sweep", () => {
  it("returns the exact cut point and 100% agreement for a fixture with a known exact separation", () => {
    const obs: Obs[] = [
      { tier: "base", nums: { endgamePoints: 60 }, bools: { flag: false } },
      { tier: "base", nums: { endgamePoints: 70 }, bools: { flag: true } },
      { tier: "base", nums: { endgamePoints: 80 }, bools: { flag: true } },
    ];

    const s = sweep(obs, "flag", "endgamePoints", "base");
    expect(s).not.toBeNull();
    expect(s!.bestThreshold).toBe(70);
    expect(s!.bestAgreement).toBe(1);
  });

  it("reports a trivial baseline of 1 and does not beat it when the flag is never true", () => {
    const obs: Obs[] = [
      { tier: "base", nums: { endgamePoints: 10 }, bools: { flag: false } },
      { tier: "base", nums: { endgamePoints: 20 }, bools: { flag: false } },
    ];

    const s = sweep(obs, "flag", "endgamePoints", "base");
    expect(s).not.toBeNull();
    expect(s!.trivialAgreement).toBe(1);
    expect(s!.bestAgreement).toBeLessThanOrEqual(s!.trivialAgreement);
  });
});

describe("sweepCandidates (top-k enumeration)", () => {
  // Two flags sharing the same underlying pattern (flagY mirrors flagX) so
  // both should independently select the same top-2 variable set,
  // demonstrating top-k applies PER FLAG PER TIER, not globally.
  const obs: Obs[] = [
    { tier: "base", nums: { a: 1, b: 1, c: 1 }, bools: { flagX: false, flagY: false } },
    { tier: "base", nums: { a: 2, b: 9, c: 1 }, bools: { flagX: false, flagY: false } },
    { tier: "base", nums: { a: 3, b: 2, c: 9 }, bools: { flagX: true, flagY: true } },
    { tier: "base", nums: { a: 4, b: 8, c: 9 }, bools: { flagX: true, flagY: true } },
  ];

  it("reports every candidate pair when top is 0", () => {
    const rows = sweepCandidates(obs, "base", 0);
    const forFlagX = rows.filter((r) => r.flag === "flagX").map((r) => r.variable).sort();
    expect(forFlagX).toEqual(["a", "b", "c"]);
  });

  it("reports exactly the two highest-agreement pairs per flag per tier when top is 2", () => {
    const rows = sweepCandidates(obs, "base", 2);
    const forFlagX = rows.filter((r) => r.flag === "flagX").map((r) => r.variable).sort();
    const forFlagY = rows.filter((r) => r.flag === "flagY").map((r) => r.variable).sort();
    // a and c both reach 100% agreement; b tops out at 75% and is excluded.
    expect(forFlagX).toEqual(["a", "c"]);
    expect(forFlagY).toEqual(["a", "c"]);
  });
});

describe("boolCheckCandidates (top-k enumeration)", () => {
  const obs: Obs[] = [
    { tier: "base", nums: {}, bools: { flagA: true, predictor1: true, predictor2: false, predictor3: true } },
    { tier: "base", nums: {}, bools: { flagA: false, predictor1: false, predictor2: true, predictor3: false } },
    { tier: "base", nums: {}, bools: { flagA: true, predictor1: true, predictor2: false, predictor3: false } },
  ];

  it("reports every candidate predictor when top is 0", () => {
    const rows = boolCheckCandidates(obs, 0).filter((r) => r.flag === "flagA");
    expect(rows.map((r) => r.predictor).sort()).toEqual(["predictor1", "predictor2", "predictor3"]);
  });

  it("reports exactly the single highest-agreement predictor when top is 1", () => {
    const rows = boolCheckCandidates(obs, 1).filter((r) => r.flag === "flagA");
    expect(rows.map((r) => r.predictor)).toEqual(["predictor1"]);
  });
});
