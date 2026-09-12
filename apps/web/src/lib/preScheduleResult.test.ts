/**
 * `decodePreScheduleResult`'s own coverage (quick task 260905-tll Task 5).
 *
 * The load-bearing case is the second one: the decoded result is fed to the
 * SHIPPED `buildRankDistributionRows` — the same builder the live client
 * engine's output goes through — and must produce rows without tripping
 * `MalformedRankHistogramError`. That is the whole point of decoding to a
 * `SimResult` rather than to rows: one row builder, two sources.
 */
import { describe, expect, it } from "vitest";
import {
  PAGE_ARTIFACT_SCHEMA_VERSION,
  PublishedPreScheduleArtifactSchema,
  type PublishedPreScheduleArtifact,
} from "../../../../packages/harness/pageArtifacts.js";
import { decodePreScheduleResult } from "./preScheduleResult.js";
import { buildRankDistributionRows } from "../components/event/rankRows.js";

function makeArtifact(): PublishedPreScheduleArtifact {
  return PublishedPreScheduleArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    algorithmId: "bpr",
    algorithmVersion: "9.0.0+rolling-2026-09c",
    eventKey: "2026casj",
    season: 2026,
    pricedFrom: "pre-event-walk-forward",
    matchesPerTeam: 12,
    roster: ["frc111", "frc222", "frc333"],
    scheduleCount: 1,
    baked: { draws: 6, histograms: [[3, 2, 1], [2, 3, 1], [1, 1, 4]] },
  });
}

describe("decodePreScheduleResult", () => {
  it("produces one Int32Array histogram per roster team, in roster order, with draws taken from baked.draws", () => {
    const result = decodePreScheduleResult(makeArtifact());

    expect(result.draws).toBe(6);
    expect([...result.rankHistograms.keys()]).toEqual(["frc111", "frc222", "frc333"]);
    for (const histogram of result.rankHistograms.values()) {
      expect(histogram).toBeInstanceOf(Int32Array);
      expect(histogram.length).toBe(3);
    }
    expect([...result.rankHistograms.get("frc333")!]).toEqual([1, 1, 4]);
  });

  it("feeds the SHIPPED buildRankDistributionRows and produces one row per team without throwing MalformedRankHistogramError", () => {
    const result = decodePreScheduleResult(makeArtifact());

    const rows = buildRankDistributionRows(result, []);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.draws === 6 && row.teamCount === 3)).toBe(true);
    // The roster carries no `teams[]` entry here, so every teamNumber comes
    // from `teamNumberFromKey` — proving the baked path needs no roster
    // metadata to render a valid row.
    expect(rows.map((row) => row.teamNumber).sort((a, b) => a - b)).toEqual([111, 222, 333]);
  });

  it("mutates nothing on the input artifact — the decoded histograms are copies, not aliases", () => {
    const artifact = makeArtifact();
    const before = JSON.stringify(artifact);

    const result = decodePreScheduleResult(artifact);
    result.rankHistograms.get("frc111")![0] = 999;

    expect(JSON.stringify(artifact)).toBe(before);
    expect(artifact.baked.histograms[0]![0]).toBe(3);
  });
});
