/**
 * `isRealTeamKey` (2026-09-01) — the rule that keeps non-real TBA team
 * entries off the model-derived surfaces (Teams list, search). See the
 * function's own doc comment for the two shapes and the measured report
 * that surfaced them.
 */
import { describe, expect, it } from "vitest";
import { isRealTeamKey } from "./teamKey.js";
import { buildTeamRows } from "../components/teams-table/rowModel.js";
import type { TeamsArtifact } from "../../../../packages/harness/pageArtifacts.js";

describe("isRealTeamKey", () => {
  it("accepts ordinary team keys, including a five-digit number", () => {
    expect(isRealTeamKey("frc1114")).toBe(true);
    expect(isRealTeamKey("frc5199")).toBe(true);
    expect(isRealTeamKey("frc10000")).toBe(true);
  });

  it("rejects letter-suffixed B/C-team keys — the offseason second robots that publish no nickname", () => {
    expect(isRealTeamKey("frc5199B")).toBe(false);
    expect(isRealTeamKey("frc1165C")).toBe(false);
    expect(isRealTeamKey("frc9312b")).toBe(false);
  });

  it("rejects frc0 — FRC team numbers start at 1", () => {
    expect(isRealTeamKey("frc0")).toBe(false);
  });

  it("rejects anything that is not the frc{digits} shape at all", () => {
    expect(isRealTeamKey("1114")).toBe(false);
    expect(isRealTeamKey("")).toBe(false);
  });
});

function team(teamKey: string, teamNumber: number, nickname: string, total: number): TeamsArtifact["teams"][number] {
  return {
    teamKey,
    teamNumber,
    nickname,
    record: { wins: 1, losses: 0, ties: 0 },
    metrics: { total: { value: total } },
    eventCount: 1,
    matchCount: 1,
  } as TeamsArtifact["teams"][number];
}

describe("buildTeamRows drops non-real teams BEFORE ranking", () => {
  it("a nameless offseason B-team outranking real teams is removed, and the real teams' ranks close up behind it", () => {
    // Modelled directly on the live 2024 artifact, where `frc5199B` (no
    // nickname, one offseason event) held rank 3 of the whole season.
    const artifact = {
      teams: [team("frc1690", 1690, "Orbit", 60), team("frc5199B", 5199, "", 55), team("frc5199", 5199, "Robot Dolphins From Outer Space", 34)],
    } as TeamsArtifact;

    const rows = buildTeamRows(artifact, "vpr");

    expect(rows.map((row) => row.teamKey)).toEqual(["frc1690", "frc5199"]);
    // The real 5199 takes rank 2 — it is NOT left at 3 with a hole above it.
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[1]!.nickname).toBe("Robot Dolphins From Outer Space");
  });
});
