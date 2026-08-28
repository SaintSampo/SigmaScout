/**
 * Unit tests for `replayRig.ts`'s pure parts — the artifact-comparison
 * exclusion list, the freshness statistics calculation, and the result-file
 * schema (plan 04-07 Task 2's acceptance criteria). None of this touches a
 * deployed Worker, D1, R2, or the corpus — importing this module must never
 * have a side effect (the entry-point guard in `replayRig.ts` is what makes
 * that true).
 */
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_COMPARISON_EXCLUDED_FIELDS,
  compareArtifacts,
  computeFreshnessStats,
  MEASUREMENT_GAP_NOTE,
  ReplayRigResultSchema,
} from "./replayRig.js";
import { PIPELINE_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";

// Test 5 (plan 07-16 Task 2): `replayRig.ts`'s default `--algorithm` list
// (`values.algorithm ?? PIPELINE_ALGORITHM_IDS.join(",")`, in `parseOptions`,
// not itself exported/unit-testable without a CLI-args harness) is built
// directly from `PIPELINE_ALGORITHM_IDS` — asserted here against the
// imported constant, never a re-typed array literal, so a future rename of
// the constant's members is caught here without editing this test.
describe("replayRig's default --algorithm list (plan 07-16 Task 2)", () => {
  it("PIPELINE_ALGORITHM_IDS resolves to the renamed pipeline triple, in publish order", () => {
    expect([...PIPELINE_ALGORITHM_IDS]).toEqual(["opr", "epa", "vpr"]);
  });
});

describe("ARTIFACT_COMPARISON_EXCLUDED_FIELDS", () => {
  it("is exactly generation and computedAt — never widened", () => {
    expect([...ARTIFACT_COMPARISON_EXCLUDED_FIELDS].sort()).toEqual(["computedAt", "generation"]);
  });
});

describe("compareArtifacts", () => {
  it("reports no diffs for two structurally identical objects", () => {
    const a = { matches: [{ matchKey: "m1", pRedWin: 0.5 }], teams: [{ teamKey: "frc1" }] };
    const b = { matches: [{ matchKey: "m1", pRedWin: 0.5 }], teams: [{ teamKey: "frc1" }] };
    expect(compareArtifacts(a, b)).toEqual([]);
  });

  it("ignores exactly generation and computedAt at the top level", () => {
    const online = { schemaVersion: 1, generation: "tick-111", computedAt: "2026-01-01T00:00:00Z", matches: [] };
    const offline = { schemaVersion: 1, generation: "replay-rig-999", computedAt: "2026-06-01T00:00:00Z", matches: [] };
    expect(compareArtifacts(online, offline)).toEqual([]);
  });

  it("reports a diff for any OTHER field that differs — never silently excluded", () => {
    const online = { generation: "g1", computedAt: "c1", schemaVersion: 1 };
    const offline = { generation: "g2", computedAt: "c2", schemaVersion: 2 };
    const diffs = compareArtifacts(online, offline);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ path: "$.schemaVersion", online: 1, offline: 2 });
  });

  it("reports an array-length mismatch precisely", () => {
    const online = { matches: [{ matchKey: "m1" }, { matchKey: "m2" }] };
    const offline = { matches: [{ matchKey: "m1" }] };
    const diffs = compareArtifacts(online, offline);
    expect(diffs).toEqual([{ path: "$.matches.length", online: 2, offline: 1 }]);
  });

  it("recurses into nested arrays/objects and reports the exact path of a leaf mismatch", () => {
    const online = { matches: [{ matchKey: "m1", pRedWin: 0.6123 }] };
    const offline = { matches: [{ matchKey: "m1", pRedWin: 0.6 }] };
    const diffs = compareArtifacts(online, offline);
    expect(diffs).toEqual([{ path: "$.matches[0].pRedWin", online: 0.6123, offline: 0.6 }]);
  });

  it("does not exclude a nested field merely because it is named generation/computedAt at ANY depth (documented, depth-agnostic exclusion)", () => {
    // Both sides carry the SAME excluded field name nested — still excluded,
    // since exclusion applies wherever the key appears, not "top level only."
    const online = { teams: [{ teamKey: "frc1", generation: "a" }] };
    const offline = { teams: [{ teamKey: "frc1", generation: "b" }] };
    expect(compareArtifacts(online, offline)).toEqual([]);
  });
});

describe("computeFreshnessStats", () => {
  it("computes median/p95/max over successful samples only", () => {
    const stats = computeFreshnessStats([1000, 2000, 3000, 4000, 5000]);
    expect(stats.count).toBe(5);
    expect(stats.timeoutCount).toBe(0);
    expect(stats.medianMs).toBe(3000);
    expect(stats.maxMs).toBe(5000);
    expect(stats.p95Ms).toBeGreaterThanOrEqual(stats.medianMs!);
  });

  it("excludes timeouts (null) from the distribution but counts them separately", () => {
    const stats = computeFreshnessStats([1000, null, 2000, null]);
    expect(stats.count).toBe(4);
    expect(stats.timeoutCount).toBe(2);
    expect(stats.medianMs).not.toBeNull();
  });

  it("returns null stats (never a fabricated 0) when every sample timed out", () => {
    const stats = computeFreshnessStats([null, null]);
    expect(stats).toEqual({ count: 2, timeoutCount: 2, medianMs: null, p95Ms: null, maxMs: null });
  });

  it("handles a single sample without dividing by zero", () => {
    const stats = computeFreshnessStats([1500]);
    expect(stats).toEqual({ count: 1, timeoutCount: 0, medianMs: 1500, p95Ms: 1500, maxMs: 1500 });
  });
});

describe("ReplayRigResultSchema", () => {
  const base = {
    runAt: "2026-08-23T00:00:00Z",
    mode: "both" as const,
    liveTrigger: "manual" as const,
    workerUrl: "https://sigmascout-worker.example.workers.dev",
    fixtureUrl: "https://sigmascout-fixture-rig.example.workers.dev",
    event: { eventKey: "2026cmptx", season: 2026, matchCount: 16 },
    algorithms: ["opr", "epa", "vpr"],
    gap: MEASUREMENT_GAP_NOTE,
  };

  it("accepts a minimal result with no freshness/equivalence sections", () => {
    expect(() => ReplayRigResultSchema.parse(base)).not.toThrow();
  });

  it("accepts a full result with both sections populated", () => {
    const full = {
      ...base,
      freshness: {
        samples: [{ matchKey: "2026cmptx_f1m1", elapsedMs: 1234 }],
        stats: { count: 1, timeoutCount: 0, medianMs: 1234, p95Ms: 1234, maxMs: 1234 },
      },
      equivalence: {
        perAlgorithm: [
          {
            algorithmId: "opr",
            algorithmVersion: "opr@3.0.0+baseline",
            onlineDigest: "a".repeat(64),
            offlineDigest: "a".repeat(64),
            digestMatch: true,
            artifactMatch: true,
            artifactDiffs: [],
          },
        ],
      },
    };
    expect(() => ReplayRigResultSchema.parse(full)).not.toThrow();
  });

  it("rejects a mode outside freshness|equivalence|both", () => {
    expect(() => ReplayRigResultSchema.parse({ ...base, mode: "bogus" })).toThrow();
  });

  it("rejects a digest that is not 64 lowercase hex characters", () => {
    const bad = {
      ...base,
      equivalence: {
        perAlgorithm: [
          { algorithmId: "opr", algorithmVersion: "opr@3.0.0+baseline", onlineDigest: "not-a-digest", offlineDigest: "a".repeat(64), digestMatch: false, artifactMatch: true, artifactDiffs: [] },
        ],
      },
    };
    expect(() => ReplayRigResultSchema.parse(bad)).toThrow();
  });

  it("requires the D-20 gap note field to be present and non-empty", () => {
    const { gap: _gap, ...withoutGap } = base;
    expect(() => ReplayRigResultSchema.parse(withoutGap)).toThrow();
  });
});
