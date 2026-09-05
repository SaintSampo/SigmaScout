/**
 * `locks.ts`'s behavior contract (quick task 260905-lic Task 2, written
 * first per this task's TDD marker). `floor(T) = T.pointTotal`,
 * `ceiling(R) = R.pointTotal + R.maxRemaining`. `threatCount(T)` counts every
 * OTHER team `R` with `ceiling(R) >= floor(T)` (the `>=` rule: a tie is
 * settled by a tiebreaker this model does not carry, so a tie must count as
 * a possible loss). `status(T) === "locked"` iff `threatCount(T) < slots`.
 */
import { describe, expect, it } from "vitest";
import { computeLocks, type LockTeamInput } from "./locks.js";

function team(teamKey: string, pointTotal: number, maxRemaining: number): LockTeamInput {
  return { teamKey, pointTotal, maxRemaining };
}

function resultFor(results: ReturnType<typeof computeLocks>, teamKey: string) {
  const found = results.find((r) => r.teamKey === teamKey);
  if (found === undefined) throw new Error(`no result for ${teamKey}`);
  return found;
}

describe("computeLocks", () => {
  it("3 teams, 1 slot, leader's floor above every rival's ceiling -> leader locked, others eliminated", () => {
    const teams = [
      team("leader", 100, 0), // floor 100, ceiling 100
      team("rival1", 50, 20), // ceiling 70 < 100
      team("rival2", 40, 10), // ceiling 50 < 100
    ];
    const results = computeLocks(teams, 1);
    expect(resultFor(results, "leader").status).toBe("locked");
    expect(resultFor(results, "rival1").status).toBe("eliminated");
    expect(resultFor(results, "rival2").status).toBe("eliminated");
  });

  it("exact tie between a rival's ceiling and the subject's floor -> subject NOT locked (the >= rule)", () => {
    const teams = [
      team("subject", 100, 0), // floor 100
      team("rival", 80, 20), // ceiling exactly 100 -- ties, counts as a threat
    ];
    const results = computeLocks(teams, 1);
    expect(resultFor(results, "subject").status).not.toBe("locked");
  });

  it("a team whose pointsToLock would exceed its maxRemaining reports null, not a number", () => {
    const teams = [
      team("subject", 10, 5), // ceiling 15, can never out-ceiling the rival below
      team("rival", 50, 50), // ceiling 100
    ];
    const results = computeLocks(teams, 1);
    const subject = resultFor(results, "subject");
    expect(subject.status).not.toBe("locked");
    expect(subject.pointsToLock).toBeNull();
  });

  it("slots: null -> every team unknown, pointsToLock null for every team", () => {
    const teams = [team("a", 100, 0), team("b", 50, 20)];
    const results = computeLocks(teams, null);
    for (const r of results) {
      expect(r.status).toBe("unknown");
      expect(r.pointsToLock).toBeNull();
    }
  });

  it("slots larger than the team count -> every team locked", () => {
    const teams = [team("a", 100, 0), team("b", 50, 20), team("c", 10, 5)];
    const results = computeLocks(teams, 10);
    for (const r of results) {
      expect(r.status).toBe("locked");
      expect(r.pointsToLock).toBe(0);
    }
  });

  it("monotonicity: adding points to one team never worsens that team's own status", () => {
    const statusRank: Record<string, number> = { eliminated: 0, contending: 1, unknown: 1, locked: 2 };
    const baseTeams = [team("subject", 40, 30), team("rival1", 60, 20), team("rival2", 55, 15)];
    const before = resultFor(computeLocks(baseTeams, 2), "subject");

    const improvedTeams = [team("subject", 55, 30), team("rival1", 60, 20), team("rival2", 55, 15)];
    const after = resultFor(computeLocks(improvedTeams, 2), "subject");

    expect(statusRank[after.status]).toBeGreaterThanOrEqual(statusRank[before.status]!);
  });

  it("a mid-table team with real threats reports a real points-still-needed number, not zero", () => {
    const teams = [team("leader", 100, 0), team("mid", 60, 50), team("last", 30, 40)];
    const results = computeLocks(teams, 1);
    const mid = resultFor(results, "mid");
    expect(mid.status).toBe("contending");
    expect(mid.pointsToLock).not.toBeNull();
    expect(mid.pointsToLock).toBeGreaterThan(0);
  });

  it("threatCount is exposed and matches the count of rivals whose ceiling meets or exceeds the subject's floor", () => {
    const teams = [team("subject", 50, 0), team("rival1", 40, 20), team("rival2", 10, 5)];
    // rival1 ceiling 60 >= 50 (threat); rival2 ceiling 15 < 50 (not a threat)
    const results = computeLocks(teams, 1);
    expect(resultFor(results, "subject").threatCount).toBe(1);
  });
});
