/**
 * Direct unit coverage of the deterministic, corpus-free parts of the gap-2
 * cleanup tool: enumeration shape/count, the scope-guard errors, and CLI
 * option parsing. No network, no credential of any kind — the delete pass
 * and census functions are exercised live only by the orchestrator's own
 * manual run against the real bucket (recorded in this task's SUMMARY, not
 * here), matching `deleteRetiredAlgorithmObjects.test.ts`'s own precedent of
 * unit-testing enumeration/guards without a live R2 origin.
 */
import { describe, expect, it } from "vitest";
import { DEMO_TEAM_KEYS, isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import {
  buildControlKeys,
  enumerateOrphanedDemoTeamKeys,
  EXPECTED_CANDIDATE_KEY_COUNT,
  NonDemoKeySegmentError,
  parseCliOptions,
  resolveLiveAlgorithmVersions,
  SEASONS,
  UnexpectedKeyCountError,
  type AlgorithmVersion,
} from "./deleteOrphanedDemoTeamObjects.js";

const FIXTURE_VERSIONS: AlgorithmVersion[] = [
  { id: "opr", version: "3.0.0+baseline" },
  { id: "epa", version: "1.0.0+baseline" },
  { id: "vpr", version: "2.0.0+tuned-2026-08" },
];

describe("EXPECTED_CANDIDATE_KEY_COUNT", () => {
  it("is exactly 30 demo keys x 5 seasons x 3 algorithms = 450", () => {
    expect(DEMO_TEAM_KEYS.size).toBe(30);
    expect(SEASONS).toHaveLength(5);
    expect(EXPECTED_CANDIDATE_KEY_COUNT).toBe(450);
  });
});

describe("resolveLiveAlgorithmVersions", () => {
  it("resolves exactly the three published algorithm ids, each carrying a non-empty version", () => {
    const resolved = resolveLiveAlgorithmVersions();
    expect(resolved.map((a) => a.id).sort()).toEqual([...PUBLISHED_ALGORITHM_IDS].sort());
    for (const { version } of resolved) {
      expect(version.length).toBeGreaterThan(0);
    }
  });
});

describe("enumerateOrphanedDemoTeamKeys", () => {
  it("returns exactly EXPECTED_CANDIDATE_KEY_COUNT keys for a 3-algorithm fixture", () => {
    const keys = enumerateOrphanedDemoTeamKeys(FIXTURE_VERSIONS);
    expect(keys.length).toBe(EXPECTED_CANDIDATE_KEY_COUNT);
  });

  it("every returned key's team segment is a genuine demo team key, and every demo key x season x algorithm combination is present exactly once", () => {
    const keys = enumerateOrphanedDemoTeamKeys(FIXTURE_VERSIONS);
    const seen = new Set<string>();
    for (const key of keys) {
      const match = /^v1\/team\/([^/]+)\/(\d{4})\/([a-z0-9-]+)@(.+)\.json$/.exec(key);
      expect(match, `key "${key}" did not match the expected team-page shape`).not.toBeNull();
      const [, teamKey, yearStr, algorithmId] = match!;
      expect(isDemoTeamKey(teamKey!)).toBe(true);
      expect(SEASONS as readonly number[]).toContain(Number(yearStr));
      expect(FIXTURE_VERSIONS.some((a) => a.id === algorithmId)).toBe(true);
      const dedupeKey = `${teamKey}::${yearStr}::${algorithmId}`;
      expect(seen.has(dedupeKey), `duplicate combination: ${dedupeKey}`).toBe(false);
      seen.add(dedupeKey);
    }
    expect(seen.size).toBe(EXPECTED_CANDIDATE_KEY_COUNT);
  });

  it("every one of the 30 demo team keys appears in the enumeration", () => {
    const keys = enumerateOrphanedDemoTeamKeys(FIXTURE_VERSIONS);
    for (const demoKey of DEMO_TEAM_KEYS) {
      expect(keys.some((k) => k.includes(`/team/${demoKey}/`))).toBe(true);
    }
  });

  it("never enumerates a key for a real team key", () => {
    const keys = enumerateOrphanedDemoTeamKeys(FIXTURE_VERSIONS);
    expect(keys.some((k) => k.includes("/team/frc3538/"))).toBe(false);
    expect(keys.some((k) => k.includes("/team/frc254/"))).toBe(false);
  });

  it("throws UnexpectedKeyCountError, never silently truncating or padding, when given an empty algorithm list", () => {
    let thrown: unknown;
    try {
      enumerateOrphanedDemoTeamKeys([]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnexpectedKeyCountError);
    const message = (thrown as Error).message;
    expect(message).toContain("0");
    expect(message).toContain(String(EXPECTED_CANDIDATE_KEY_COUNT));
  });

  it("throws UnexpectedKeyCountError for a 2-algorithm list too — the guard is exact, not a band, because the whole point of this tool is exactly the 3 currently-published algorithms", () => {
    let thrown: unknown;
    try {
      enumerateOrphanedDemoTeamKeys(FIXTURE_VERSIONS.slice(0, 2));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnexpectedKeyCountError);
    const message = (thrown as Error).message;
    expect(message).toContain(String((EXPECTED_CANDIDATE_KEY_COUNT / 3) * 2)); // observed count (300)
    expect(message).toContain(String(EXPECTED_CANDIDATE_KEY_COUNT)); // expected count (450)
  });
});

describe("NonDemoKeySegmentError — direct construction (the guard's message shape)", () => {
  it("names both the offending key and the non-demo team key", () => {
    const err = new NonDemoKeySegmentError("v1/team/frc254/2024/opr@3.0.0+baseline.json", "frc254");
    expect(err.message).toContain("v1/team/frc254/2024/opr@3.0.0+baseline.json");
    expect(err.message).toContain("frc254");
    expect(err.name).toBe("NonDemoKeySegmentError");
  });
});

describe("buildControlKeys", () => {
  it("builds exactly one frc3538/2024 key per algorithm, through artifactKey (never hand-constructed)", () => {
    const controls = buildControlKeys(FIXTURE_VERSIONS);
    expect(controls).toHaveLength(FIXTURE_VERSIONS.length);
    for (const { id, version } of FIXTURE_VERSIONS) {
      expect(controls).toContain(`v1/team/frc3538/2024/${id}@${version}.json`);
    }
  });
});

describe("parseCliOptions", () => {
  it("defaults to execute:false — omitting --execute never deletes anything", () => {
    expect(parseCliOptions([]).execute).toBe(false);
  });

  it("--execute flips execute:true", () => {
    expect(parseCliOptions(["--execute"]).execute).toBe(true);
  });

  it("defaults concurrency/bucket/origin, and accepts overrides", () => {
    const defaults = parseCliOptions([]);
    expect(defaults.concurrency).toBe(16);
    expect(defaults.bucket).toBe("sigmascout-artifacts");
    expect(defaults.origin).toBe("https://data.sigmascout.org");

    const overridden = parseCliOptions(["--concurrency", "4", "--bucket", "test-bucket", "--origin", "https://example.test"]);
    expect(overridden.concurrency).toBe(4);
    expect(overridden.bucket).toBe("test-bucket");
    expect(overridden.origin).toBe("https://example.test");
  });
});
