/**
 * `locks.ts`'s behavior contract (quick task 260905-lic Task 2, written
 * first per this task's TDD marker). `floor(T) = T.pointTotal`,
 * `ceiling(R) = R.pointTotal + R.maxRemaining`. `threatCount(T)` counts every
 * OTHER team `R` with `ceiling(R) >= floor(T)` (the `>=` rule: a tie is
 * settled by a tiebreaker this model does not carry, so a tie must count as
 * a possible loss). `status(T) === "locked"` iff `threatCount(T) < slots`.
 */
import { describe, expect, it } from "vitest";
import { computeLocks, computeLocksWithQualifiers, cutLinePointsWithQualifiers, type LockTeamInput, type QualifierSets } from "./locks.js";

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

describe("reservedSlots — one points slot held back per award still to come (260925-ms7)", () => {
  const noQualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set() };

  /**
   * Two slots, three teams, nothing left to play. `a` and `b` are both safe on
   * points against `c` when two slots are available; with one held back only
   * `a` is.
   */
  const teams = [team("a", 90, 0), team("b", 60, 0), team("c", 10, 0)];

  it("defaults to zero, so a caller that passes nothing reads exactly the verdicts it always did", () => {
    expect(computeLocksWithQualifiers(teams, 2, noQualifiers)).toEqual(computeLocksWithQualifiers(teams, 2, noQualifiers, 0));
    expect(computeLocksWithQualifiers(teams, 2, noQualifiers)).toEqual(computeLocks(teams, 2));
  });

  it("locks a team with 0 reserved and does NOT lock the same team with 1 reserved", () => {
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 0), "b").status).toBe("locked");
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 1), "b").status).not.toBe("locked");
    // The top team is far enough clear that one held-back slot does not reach
    // it, so the reservation is a cut line moving rather than a blanket.
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 1), "a").status).toBe("locked");
  });

  it("leaves the ELIMINATION verdict on the unreserved slot count, which is what keeps the opposite promise", () => {
    // `c` cannot reach either slot, and that is true with or without a
    // reservation. What must NOT happen is `b` being told the slot is already
    // gone: the pending award's winner is still in this pool competing, so
    // withholding the slot AND counting the rival would price one award twice.
    // Measured: reserving on the elimination side too turned quick task
    // 260925-ma5's sweep from 0 tenet-B violations into 551.
    for (const reserved of [0, 1, 2, 5]) {
      expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, reserved), "c").status).toBe("eliminated");
    }
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 1), "b").status).toBe("contending");
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 5), "b").status).toBe("contending");
  });

  it("stacks with the award-consumed slots rather than replacing them", () => {
    // 3 slots, one posted Impact winner consumes one, one pending award
    // reserves another: one points slot is left, so only the top team locks.
    const withWinner = [team("winner", 5, 0), ...teams];
    const qualifiers: QualifierSets = { awardQualified: new Set(["winner"]), prequalified: new Set() };
    const results = computeLocksWithQualifiers(withWinner, 3, qualifiers, 1);
    expect(resultFor(results, "winner").status).toBe("lockedAward");
    expect(resultFor(results, "a").status).toBe("locked");
    expect(resultFor(results, "b").status).not.toBe("locked");
  });

  it("clamps a negative reservation to zero rather than WIDENING the pool", () => {
    expect(computeLocksWithQualifiers(teams, 2, noQualifiers, -3)).toEqual(computeLocksWithQualifiers(teams, 2, noQualifiers, 0));
  });

  it("reports pointsToLock against the reserved count, so the number a team is told it needs is the number that locks it", () => {
    const climbing = [team("a", 90, 0), team("b", 60, 0), team("chaser", 10, 100)];
    const needed = resultFor(computeLocksWithQualifiers(climbing, 2, noQualifiers, 1), "chaser").pointsToLock;
    expect(needed).not.toBeNull();
    const withThosePoints = [team("a", 90, 0), team("b", 60, 0), team("chaser", 10 + needed!, 100 - needed!)];
    expect(resultFor(computeLocksWithQualifiers(withThosePoints, 2, noQualifiers, 1), "chaser").status).toBe("locked");
  });
});

describe("cutLinePointsWithQualifiers", () => {
  const noQualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set() };

  it("returns null when slots is null", () => {
    const teams = [team("a", 100, 0), team("b", 50, 0)];
    expect(cutLinePointsWithQualifiers(teams, null, noQualifiers)).toBeNull();
  });

  it("with no qualifiers, returns the pointTotal of the slots-th team sorted descending, even when input is not already in points order", () => {
    const teams = [team("d", 40, 0), team("a", 100, 0), team("c", 60, 0), team("b", 80, 0)];
    expect(cutLinePointsWithQualifiers(teams, 3, noQualifiers)).toBe(60);
  });

  it("NC-2026-shaped regression: the naive rank-slot answer (70) is wrong; the pool/pointsSlots-consistent answer (90) matches which team is eliminated", () => {
    const teams = [
      team("a", 100, 0),
      team("b", 90, 0),
      team("c", 80, 0),
      team("d", 70, 0),
      team("e", 60, 0),
      team("f", 50, 0),
      team("g", 40, 0),
    ];
    const qualifiers: QualifierSets = { awardQualified: new Set(["f", "g"]), prequalified: new Set() };
    expect(cutLinePointsWithQualifiers(teams, 4, qualifiers)).toBe(90);

    const results = computeLocksWithQualifiers(teams, 4, qualifiers);
    expect(results.find((r) => r.teamKey === "c")!.status).toBe("eliminated");
  });

  it("prequalified teams leave the pool but do not consume slots", () => {
    const teams = [team("a", 100, 0), team("b", 90, 0), team("c", 80, 0), team("d", 70, 0)];
    const qualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set(["a"]) };
    expect(cutLinePointsWithQualifiers(teams, 3, qualifiers)).toBe(70);
  });

  it("an award qualifier not present in teams (unranked) does not reduce slots", () => {
    const teams = [team("a", 100, 0), team("b", 90, 0), team("c", 80, 0), team("d", 70, 0)];
    const qualifiers: QualifierSets = { awardQualified: new Set(["ghost"]), prequalified: new Set() };
    expect(cutLinePointsWithQualifiers(teams, 3, qualifiers)).toBe(80);
  });

  it("ranked award-qualified count >= slots gives pointsSlots 0 and returns null", () => {
    const teams = [team("a", 100, 0), team("b", 90, 0)];
    const qualifiers: QualifierSets = { awardQualified: new Set(["a", "b"]), prequalified: new Set() };
    expect(cutLinePointsWithQualifiers(teams, 2, qualifiers)).toBeNull();
  });

  it("an empty pool returns null", () => {
    const teams = [team("a", 100, 0)];
    const qualifiers: QualifierSets = { awardQualified: new Set(["a"]), prequalified: new Set() };
    expect(cutLinePointsWithQualifiers(teams, 1, qualifiers)).toBeNull();
  });

  it("a pool smaller than pointsSlots returns the lowest pool team's pointTotal, mirroring the old clamp", () => {
    const teams = [team("a", 100, 0), team("b", 50, 0)];
    expect(cutLinePointsWithQualifiers(teams, 10, noQualifiers)).toBe(50);
  });

  /** Deterministic LCG (no Math.random) so the property test is reproducible. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it("property: for every non-null cut line, no team above it is eliminated and no team below it is locked, across ~200 seeded pseudo-random fixtures", () => {
    const rand = lcg(0xc0ffee);
    const randInt = (max: number) => Math.floor(rand() * (max + 1));

    for (let trial = 0; trial < 200; trial++) {
      const teamCount = 1 + randInt(12);
      const teams: LockTeamInput[] = [];
      for (let i = 0; i < teamCount; i++) {
        const pointTotal = randInt(500);
        const maxRemaining = rand() < 0.3 ? 0 : randInt(200);
        teams.push(team(`t${i}`, pointTotal, maxRemaining));
      }
      const slots = randInt(teamCount + 2);
      const awardQualified = new Set(teams.filter(() => rand() < 0.15).map((t) => t.teamKey));
      const prequalified = new Set(teams.filter((t) => !awardQualified.has(t.teamKey) && rand() < 0.1).map((t) => t.teamKey));
      const qualifiers: QualifierSets = { awardQualified, prequalified };

      const cutLine = cutLinePointsWithQualifiers(teams, slots, qualifiers);
      if (cutLine === null) continue;

      // HALF THESE TRIALS CARRY A RESERVATION. The cut line reads the
      // unreserved count while the lock test reads the reserved one, so the
      // invariant has to survive the two disagreeing — a stricter lock test
      // only shrinks the locked set, and the elimination test the line is
      // derived against is untouched.
      const reservedSlots = rand() < 0.5 ? 0 : randInt(3);
      const results = computeLocksWithQualifiers(teams, slots, qualifiers, reservedSlots);
      const byTeam = new Map(teams.map((t) => [t.teamKey, t] as const));
      for (const result of results) {
        if (result.status !== "locked" && result.status !== "eliminated" && result.status !== "contending") continue;
        const pointTotal = byTeam.get(result.teamKey)!.pointTotal;
        if (pointTotal > cutLine) {
          expect(result.status, `trial ${trial} team ${result.teamKey} pointTotal ${pointTotal} > cutLine ${cutLine}`).not.toBe("eliminated");
        }
        if (pointTotal < cutLine) {
          expect(result.status, `trial ${trial} team ${result.teamKey} pointTotal ${pointTotal} < cutLine ${cutLine}`).not.toBe("locked");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The pooled remaining-points argument (quick task 260925-pl6)
// ---------------------------------------------------------------------------

describe("the pooled remaining-points lock", () => {
  const noQualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set() };

  /**
   * THE WHITE PAPER'S OWN WORKED EXAMPLE (Liatys and Papa, 2024). Team `A` sits
   * on 70 points, ranked 58th, with 60 slots. Three more teams therefore have
   * to pass it. The four teams immediately below it are on 68, 64, 62 and 61,
   * and the one on 64 has no district event left to play, so it is skipped: the
   * three cheapest rivals that CAN still score are 68, 62 and 61, costing
   * 2 + 8 + 9 = 19 points between them.
   *
   * Every team carries a full district event's ceiling, so the SHIPPED ceiling
   * test does not lock `A` at all -- 62 rivals can each reach its floor alone.
   * That is the whole point of the pooled argument: they cannot all do it at
   * once.
   */
  const SLOTS = 60;
  const paperTeams = (sixtyFourCanScore: boolean): LockTeamInput[] => {
    const teams: LockTeamInput[] = [];
    for (let i = 0; i < 57; i++) teams.push(team(`ahead${i}`, 100, 83));
    teams.push(team("A", 70, 83));
    teams.push(team("r68", 68, 83));
    teams.push(team("r64", 64, sixtyFourCanScore ? 83 : 0));
    teams.push(team("r62", 62, 83));
    teams.push(team("r61", 61, 83));
    teams.push(team("r55", 55, 83));
    teams.push(team("r50", 50, 83));
    return teams;
  };
  const paperPooled = (remainingPoints: number, sixtyFourCanScore: boolean) => ({
    remainingPoints,
    hasRemainingEvent: new Set(
      paperTeams(sixtyFourCanScore)
        .filter((t) => t.maxRemaining > 0)
        .map((t) => t.teamKey)
    ),
  });

  it("reproduces the paper's worked example: the minimum that could eliminate team A is exactly 19", () => {
    const teams = paperTeams(false);
    // 18 points left in the district is not enough to buy the 19 that would
    // push three rivals past A.
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers, 0, paperPooled(18, false)), "A").status).toBe("locked");
    // 19 exactly is enough, so the team is not locked -- the comparison is
    // strict, which is the friendlier-side tie rule the rest of this module
    // uses read from the other direction.
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers, 0, paperPooled(19, false)), "A").status).toBe("contending");
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers, 0, paperPooled(400, false)), "A").status).toBe("contending");
  });

  it("says the lock came from the POOLED argument, because the ceiling test does not reach it", () => {
    const teams = paperTeams(false);
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers, 0, paperPooled(18, false)), "A").lockedBy).toBe("pooled");
    // Without the pooled argument the very same inputs report contending.
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers), "A").status).toBe("contending");
    expect(resultFor(computeLocksWithQualifiers(teams, SLOTS, noQualifiers), "A").lockedBy).toBeNull();
  });

  it("skips a rival with no district event left, which is what makes the minimum 19 rather than 16", () => {
    // With the team on 64 able to score, the three cheapest rivals are 68, 64
    // and 62, costing 2 + 6 + 8 = 16. 17 points left in the district then buys
    // the elimination and A is not locked; with that team skipped it does not.
    expect(resultFor(computeLocksWithQualifiers(paperTeams(false), SLOTS, noQualifiers, 0, paperPooled(17, false)), "A").status).toBe("locked");
    expect(resultFor(computeLocksWithQualifiers(paperTeams(true), SLOTS, noQualifiers, 0, paperPooled(17, true)), "A").status).toBe("contending");
  });

  it("locks a team the ceiling test leaves contending, which is the whole reason it exists", () => {
    // Two slots, four rivals each able to reach the leader's floor ALONE, so
    // the ceiling test refuses. Two of them have to pass it, and the cheapest
    // pair would need 5 + 30 = 35 points between them; only 30 are left in the
    // whole district.
    const teams = [team("leader", 100, 0), team("second", 95, 60), team("r70", 70, 60), team("r60", 60, 60), team("r50", 50, 60)];
    const pooled = { remainingPoints: 30, hasRemainingEvent: new Set(["second", "r70", "r60", "r50"]) };
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers), "leader").status).toBe("contending");
    const withPool = resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 0, pooled), "leader");
    expect(withPool.status).toBe("locked");
    expect(withPool.lockedBy).toBe("pooled");
  });

  it("reports BOTH when the ceiling test holds too", () => {
    const teams = [team("leader", 100, 0), team("rival", 10, 5)];
    const result = resultFor(
      computeLocksWithQualifiers(teams, 1, noQualifiers, 0, { remainingPoints: 5, hasRemainingEvent: new Set(["rival"]) }),
      "leader"
    );
    expect(result.status).toBe("locked");
    expect(result.lockedBy).toBe("both");
  });

  it("locks a team no rival can reach at all, whatever the pool", () => {
    // Two slots and only one rival left who can score: fewer rivals able to
    // score than the number that would have to pass, so the cost is
    // unattainable rather than merely large and the pool's size is irrelevant.
    const teams = [team("leader", 100, 0), team("a", 99, 500), team("b", 98, 0), team("c", 97, 0)];
    const pooled = { remainingPoints: 1_000_000, hasRemainingEvent: new Set(["a"]) };
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 0, pooled), "leader").status).toBe("locked");
  });

  it("never locks a team already outside the slot count", () => {
    // One slot: `b` is already behind `a`, so no points need to move at all for
    // it to miss, and the pooled argument must prove nothing.
    const teams = [team("a", 100, 0), team("b", 90, 0), team("c", 80, 50), team("d", 10, 50)];
    const pooled = { remainingPoints: 0, hasRemainingEvent: new Set(["c", "d"]) };
    expect(resultFor(computeLocksWithQualifiers(teams, 1, noQualifiers, 0, pooled), "b").status).not.toBe("locked");
  });

  it("treats a TIE as already ahead, the same way the ceiling test does", () => {
    // Two teams tied on 90 for one slot with nothing left to play anywhere:
    // neither locks, because the tiebreaker this model does not carry could go
    // either way.
    const teams = [team("a", 90, 0), team("b", 90, 0), team("c", 10, 0)];
    const results = computeLocksWithQualifiers(teams, 1, noQualifiers, 0, { remainingPoints: 0, hasRemainingEvent: new Set<string>() });
    expect(resultFor(results, "a").status).not.toBe("locked");
    expect(resultFor(results, "b").status).not.toBe("locked");
  });

  it("leaves the ELIMINATED verdict exactly where it was, because the pooled argument says nothing about elimination", () => {
    const teams = [team("leader", 100, 0), team("second", 95, 0), team("doomed", 10, 5)];
    const pooled = { remainingPoints: 5, hasRemainingEvent: new Set(["doomed"]) };
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers), "doomed").status).toBe("eliminated");
    expect(resultFor(computeLocksWithQualifiers(teams, 2, noQualifiers, 0, pooled), "doomed").status).toBe("eliminated");
  });

  it("is identical to today when no pooled argument is passed", () => {
    const teams = [team("a", 90, 30), team("b", 60, 40), team("c", 10, 5)];
    for (const slots of [1, 2, 3]) {
      for (const reserved of [0, 1]) {
        expect(computeLocksWithQualifiers(teams, slots, noQualifiers, reserved)).toEqual(
          computeLocksWithQualifiers(teams, slots, noQualifiers, reserved, undefined)
        );
        // `lockedBy` can never read "pooled" or "both" when the argument was
        // never supplied, so a reader cannot mistake silence for a measurement.
        for (const result of computeLocksWithQualifiers(teams, slots, noQualifiers, reserved)) {
          expect(result.lockedBy === null || result.lockedBy === "ceiling").toBe(true);
        }
      }
    }
    expect(computeLocksWithQualifiers(teams, null, noQualifiers, 0, { remainingPoints: 0, hasRemainingEvent: new Set() })).toEqual(
      computeLocksWithQualifiers(teams, null, noQualifiers)
    );
  });

  it("changes nothing at all for a district with nothing left to play", () => {
    // Every event finished: the pool is zero and no team can score again, which
    // is every finished season in the corpus. The pooled test then locks
    // EXACTLY the teams the ceiling test already locked, which is why a
    // recompute of a finished artifact moves no published number.
    const teams = [team("a", 100, 0), team("b", 90, 0), team("c", 80, 0), team("d", 10, 0)];
    const pooled = { remainingPoints: 0, hasRemainingEvent: new Set<string>() };
    for (const slots of [0, 1, 2, 3, 4, 5]) {
      const without = computeLocksWithQualifiers(teams, slots, noQualifiers);
      const withPool = computeLocksWithQualifiers(teams, slots, noQualifiers, 0, pooled);
      expect(withPool.map((r) => r.status)).toEqual(without.map((r) => r.status));
      expect(withPool.map((r) => r.pointsToLock)).toEqual(without.map((r) => r.pointsToLock));
      expect(withPool.map((r) => r.threatCount)).toEqual(without.map((r) => r.threatCount));
    }
  });

  /** Deterministic LCG (no Math.random) so the two property tests below are reproducible. */
  function pooledLcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it("property: raising the remaining-points pool never locks a team a smaller pool left unlocked, across 300 seeded fixtures", () => {
    const rand = pooledLcg(0x5eed1);
    const randInt = (max: number) => Math.floor(rand() * (max + 1));

    for (let trial = 0; trial < 300; trial++) {
      const teamCount = 1 + randInt(14);
      const teams: LockTeamInput[] = [];
      for (let i = 0; i < teamCount; i++) teams.push(team(`t${i}`, randInt(400), rand() < 0.3 ? 0 : randInt(200)));
      const slots = randInt(teamCount + 2);
      const reservedSlots = randInt(2);
      const hasRemainingEvent = new Set(teams.filter(() => rand() < 0.7).map((t) => t.teamKey));

      const pools = [0, randInt(200), randInt(600), randInt(2000)].sort((a, b) => a - b);
      let previousLocked: Set<string> | null = null;
      for (const remainingPoints of pools) {
        const locked = new Set(
          computeLocksWithQualifiers(teams, slots, noQualifiers, reservedSlots, { remainingPoints, hasRemainingEvent })
            .filter((r) => r.status === "locked")
            .map((r) => r.teamKey)
        );
        if (previousLocked !== null) {
          for (const teamKey of locked) {
            expect(previousLocked.has(teamKey), `trial ${trial}: ${teamKey} locks at pool ${remainingPoints} but not at a smaller one`).toBe(true);
          }
        }
        previousLocked = locked;
      }
    }
  });

  it("property: the pooled argument only ever ADDS locks, never removes one, across 300 seeded fixtures", () => {
    const rand = pooledLcg(0x5eed2);
    const randInt = (max: number) => Math.floor(rand() * (max + 1));

    for (let trial = 0; trial < 300; trial++) {
      const teamCount = 1 + randInt(14);
      const teams: LockTeamInput[] = [];
      for (let i = 0; i < teamCount; i++) teams.push(team(`t${i}`, randInt(400), rand() < 0.3 ? 0 : randInt(200)));
      const slots = randInt(teamCount + 2);
      const reservedSlots = randInt(2);
      const pooled = {
        remainingPoints: randInt(1500),
        hasRemainingEvent: new Set(teams.filter(() => rand() < 0.7).map((t) => t.teamKey)),
      };

      const without = computeLocksWithQualifiers(teams, slots, noQualifiers, reservedSlots);
      const withPool = computeLocksWithQualifiers(teams, slots, noQualifiers, reservedSlots, pooled);
      for (let i = 0; i < without.length; i++) {
        const before = without[i]!;
        const after = withPool[i]!;
        expect(after.teamKey).toBe(before.teamKey);
        if (before.status === "locked") expect(after.status, `trial ${trial}: ${before.teamKey} lost its lock`).toBe("locked");
        // The only status change the pooled argument may produce is INTO
        // "locked"; everything else must be untouched.
        if (after.status !== "locked") expect(after.status).toBe(before.status);
      }
    }
  });
});
