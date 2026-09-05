/**
 * `locks.ts`'s behavior contract (quick task 260905-lic Task 2, written
 * first per this task's TDD marker). `floor(T) = T.pointTotal`,
 * `ceiling(R) = R.pointTotal + R.maxRemaining`. `threatCount(T)` counts every
 * OTHER team `R` with `ceiling(R) >= floor(T)` (the `>=` rule: a tie is
 * settled by a tiebreaker this model does not carry, so a tie must count as
 * a possible loss). `status(T) === "locked"` iff `threatCount(T) < slots`.
 */
import { describe, expect, it } from "vitest";
import { computeLocks, computeLocksWithQualifiers, type LockTeamInput, type QualifierSets } from "./locks.js";

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

describe("computeLocksWithQualifiers (revision R2a)", () => {
  const noQualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set() };

  it("an award-qualified team reports lockedAward even when the points math alone would not lock it", () => {
    const teams = [team("awardWinner", 10, 5), team("leader", 100, 50), team("mid", 60, 40)];
    const results = computeLocksWithQualifiers(teams, 1, {
      awardQualified: new Set(["awardWinner"]),
      prequalified: new Set(),
    });
    expect(resultFor(results, "awardWinner").status).toBe("lockedAward");
    expect(resultFor(results, "awardWinner").pointsToLock).toBe(0);
  });

  it("a team that is BOTH award-qualified and points-safe still reports lockedAward, not locked", () => {
    const teams = [team("awardAndPointsSafe", 500, 0), team("rival", 10, 5)];
    const results = computeLocksWithQualifiers(teams, 1, {
      awardQualified: new Set(["awardAndPointsSafe"]),
      prequalified: new Set(),
    });
    expect(resultFor(results, "awardAndPointsSafe").status).toBe("lockedAward");
  });

  it("a prequalified team reports prequalified regardless of its own points standing", () => {
    const teams = [team("prequal", 0, 0), team("leader", 100, 0), team("mid", 60, 20)];
    const results = computeLocksWithQualifiers(teams, 1, {
      awardQualified: new Set(),
      prequalified: new Set(["prequal"]),
    });
    expect(resultFor(results, "prequal").status).toBe("prequalified");
    expect(resultFor(results, "prequal").pointsToLock).toBe(0);
  });

  it("an award-qualified team is removed from the pool AND reduces pointsSlots by one — the remaining points-competing pool sees one fewer rival and one fewer slot", () => {
    // 2 slots, one award-qualified team removes it from the pool and drops
    // pointsSlots to 1 for the remaining two point-competing teams.
    const teams = [team("awardWinner", 10, 0), team("a", 60, 20), team("b", 55, 15)];
    const results = computeLocksWithQualifiers(teams, 2, {
      awardQualified: new Set(["awardWinner"]),
      prequalified: new Set(),
    });
    // a's ceiling 80 >= b's floor 55 (a threat to b) and vice versa (b's ceiling 70 >= a's floor 60) —
    // with pointsSlots=1, both a and b threaten each other, so both are "contending", not "locked".
    expect(resultFor(results, "a").status).toBe("contending");
    expect(resultFor(results, "b").status).toBe("contending");
  });

  it("a prequalified team is removed from the pool but does NOT reduce pointsSlots — this is the non-consuming/consuming distinction", () => {
    const teams = [team("prequal", 0, 0), team("only-real-contender", 50, 50)];
    const results = computeLocksWithQualifiers(teams, 1, {
      awardQualified: new Set(),
      prequalified: new Set(["prequal"]),
    });
    // With prequal removed from the pool (non-consuming), the sole remaining
    // points-competing team faces pointsSlots still at 1, with nobody else
    // in the pool to threaten it — locked, not contending.
    expect(resultFor(results, "only-real-contender").status).toBe("locked");
  });

  it("slots: null yields unknown for a points-competing team but does not change a qualified team's own status", () => {
    const teams = [team("awardWinner", 10, 0), team("prequal", 0, 0), team("normal", 50, 20)];
    const results = computeLocksWithQualifiers(teams, null, {
      awardQualified: new Set(["awardWinner"]),
      prequalified: new Set(["prequal"]),
    });
    expect(resultFor(results, "awardWinner").status).toBe("lockedAward");
    expect(resultFor(results, "prequal").status).toBe("prequalified");
    expect(resultFor(results, "normal").status).toBe("unknown");
    expect(resultFor(results, "normal").pointsToLock).toBeNull();
  });

  it("with no qualifiers at all, computeLocksWithQualifiers matches computeLocks exactly", () => {
    const teams = [team("leader", 100, 0), team("rival1", 50, 20), team("rival2", 40, 10)];
    expect(computeLocksWithQualifiers(teams, 1, noQualifiers)).toEqual(computeLocks(teams, 1));
  });

  it("property: adding an award qualifier never improves a non-qualified rival's status", () => {
    const statusRank: Record<string, number> = {
      eliminated: 0,
      contending: 1,
      unknown: 1,
      locked: 2,
      lockedAward: 3,
      prequalified: 3,
    };
    const teams = [team("newAwardWinner", 20, 10), team("rival", 60, 30), team("other", 55, 25)];

    const before = resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers), "rival");
    const after = resultFor(
      computeLocksWithQualifiers(teams, 2, { awardQualified: new Set(["newAwardWinner"]), prequalified: new Set() }),
      "rival"
    );

    expect(statusRank[after.status]).toBeLessThanOrEqual(statusRank[before.status]!);
  });
});
