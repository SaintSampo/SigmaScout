/**
 * The five statuses at a position.
 *
 * Pure and synthetic, with every fixture parsed through the REAL
 * `DistrictArtifactSchema`, plus one test over a finished-district fixture
 * shaped exactly like the real artifact — that one is SC-3's acceptance.
 */
import { describe, expect, it } from "vitest";
import {
  cutLinePointsWithQualifiers,
  type LockTeamInput,
  type QualifierSets,
} from "../../../../../packages/core/districts/locks.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import {
  AWARD_TYPE_IMPACT,
  AWARD_TYPE_ENGINEERING_INSPIRATION,
} from "../../../../../packages/core/districts/qualification.js";
import {
  DistrictArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import {
  buildDistrictLedgerRows,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";

type DistrictTeam = DistrictArtifact["teams"][number];

const SEASON = 2026;
const CEILINGS = maxEventPoints(SEASON, "district");
const EVENT_MAX = CEILINGS.qual + CEILINGS.alliance + CEILINGS.elim + CEILINGS.award;
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();

const FINISHED: DistrictEventState = { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const UNSTARTED: DistrictEventState = { qualMatchesPlayed: 0, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

function played(eventKey: string, total: number, week = 0, state: DistrictEventState = FINISHED) {
  const qual = total;
  return { eventKey, eventName: `Event ${eventKey}`, week, tier: "district" as const, qual, alliance: 0, elim: 0, award: 0, total, state };
}

function ahead(eventKey: string, week = 3, state: DistrictEventState = UNSTARTED) {
  return { eventKey, eventName: `Event ${eventKey}`, week, tier: "district" as const, maxPoints: EVENT_MAX, state };
}

function team(teamKey: string, overrides: Partial<DistrictTeam> = {}): DistrictTeam {
  return {
    teamKey,
    teamNumber: Number(teamKey.replace("frc", "")),
    nickname: `Nickname ${teamKey}`,
    rank: 1,
    pointTotal: 0,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: { status: "contending", pointsToLock: 0, threatCount: 0, cutLinePoints: null, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 0, threatCount: 0, cutLinePoints: null, allocationNote: null },
    ...overrides,
  };
}

function artifactOf(teams: DistrictTeam[], overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 2,
    cmpSlots: 1,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 2,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
    ...overrides,
  });
}

function statusesFor(artifact: DistrictArtifact, stageByEvent?: ReadonlyMap<string, DistrictStageFinality>) {
  const rows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, stageByEvent });
  return { rows, model: computeDistrictLedgerStatuses({ artifact, teams: rows.teams }) };
}

// ---------------------------------------------------------------------------

describe("the floor and the ceiling at a position", () => {
  it("makes the floor EXACTLY team.pointTotal at the now position, with nothing reopened", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)] }),
      team("frc2", { pointTotal: 10, eventPoints: [played("a", 10)] }),
    ]);
    const { model } = statusesFor(artifact);
    // Every event is finished, so every team's ceiling equals its floor and the
    // two top teams for two slots are locked.
    expect(model.verdictCensus.locked).toBe(2);
  });

  it("makes a wholly unstarted event's four category ceilings sum to its own remainingEvents.maxPoints", () => {
    const artifact = artifactOf([team("frc1", { pointTotal: 0, remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX })]);
    const { rows } = statusesFor(artifact);
    const row = rows.teams[0]!.rows[0]!;
    expect(row.remainingMaxPoints).toBe(EVENT_MAX);
    const summed = CEILINGS.qual + CEILINGS.alliance + CEILINGS.elim + CEILINGS.award;
    expect(summed).toBe(row.remainingMaxPoints);
  });

  it("removes a reopened category's earned points from the floor and adds its ceiling to the ceiling", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)] }),
      team("frc2", { pointTotal: 10, eventPoints: [played("a", 10)] }),
      team("frc3", { pointTotal: 5, eventPoints: [played("a", 5)] }),
    ]);
    const now = statusesFor(artifact).model;
    const reopened = statusesFor(artifact, new Map([["a", { qual: false, alliance: true, elim: true, award: true }]])).model;
    // At now, the top two of three teams for two slots are locked.
    expect(now.verdictCensus.locked).toBe(2);
    // Reopening qualification for everybody makes every verdict more
    // conservative: nothing stays locked.
    expect(reopened.verdictCensus.locked).toBe(0);
  });
});

describe("the precedence order — five branches, asserted pairwise", () => {
  it("reports Locked out for a team that cannot reach the line, and Locked for one that cannot be caught", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 100, eventPoints: [played("a", 100)] }),
      team("frc2", { pointTotal: 90, eventPoints: [played("a", 90)] }),
      team("frc3", { pointTotal: 1, eventPoints: [played("a", 1)] }),
    ]);
    const { model } = statusesFor(artifact);
    expect(model.byTeam.get("frc1")?.status).toBe("locked");
    expect(model.byTeam.get("frc2")?.status).toBe("locked");
    expect(model.byTeam.get("frc3")?.status).toBe("lockedOut");
  });

  it("reports Locked with the award reason ahead of the points verdict, and never prints a second status for it", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 5, eventPoints: [played("a", 5)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX, qualifyingAwards: [{ eventKey: "a", awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: false }] }),
      team("frc2", { pointTotal: 80, eventPoints: [played("a", 80)] }),
      team("frc3", { pointTotal: 70, eventPoints: [played("a", 70)] }),
      team("frc4", { pointTotal: 60, eventPoints: [played("a", 60)] }),
    ]);
    const { model } = statusesFor(artifact);
    const awarded = model.byTeam.get("frc1")!;
    expect(awarded.status).toBe("locked");
    expect(awarded.byAward).toBe(true);
    expect(awarded.verdict).toBe("lockedAward");
  });
});

describe("the award-qualified set is filtered three ways", () => {
  function withAward(eventKey: string, awardType: number, stage?: ReadonlyMap<string, DistrictStageFinality>) {
    const artifact = artifactOf([
      team("frc1", {
        pointTotal: 5,
        eventPoints: [played("a", 5), { eventKey: "cmp", eventName: "DCMP", week: 5, tier: "dcmp", qual: 0, alliance: 0, elim: 0, award: 0, total: 0, state: FINISHED }],
        qualifyingAwards: [{ eventKey, awardType, label: "Award", awardOnly: false }],
      }),
      team("frc2", { pointTotal: 80, eventPoints: [played("a", 80)] }),
      team("frc3", { pointTotal: 70, eventPoints: [played("a", 70)] }),
    ]);
    return statusesFor(artifact, stage).model.byTeam.get("frc1")!;
  }

  it("excludes a DCMP-tier award — that event's row never renders on this tab at all", () => {
    expect(withAward("cmp", AWARD_TYPE_IMPACT).byAward).toBe(false);
  });

  it("excludes a non-consuming district award (Engineering Inspiration is an award-only invite at this tier)", () => {
    expect(withAward("a", AWARD_TYPE_ENGINEERING_INSPIRATION).byAward).toBe(false);
  });

  it("excludes a district Impact award at an event whose AWARDS the slider has reopened", () => {
    const reopened = new Map<string, DistrictStageFinality>([["a", { qual: true, alliance: true, elim: true, award: false }]]);
    expect(withAward("a", AWARD_TYPE_IMPACT, reopened).byAward).toBe(false);
    // The same award at the same event IS counted at the now position.
    expect(withAward("a", AWARD_TYPE_IMPACT).byAward).toBe(true);
  });

  /**
   * The exposed sets, added by quick task 260925-rpj so the advancement chance
   * ranks the SAME narrowed race the verdicts did. Asserted against the
   * `byAward` verdicts rather than against a hand typed list, so the two can
   * only agree by actually agreeing.
   */
  it("exposes the consuming award qualifiers it actually handed locks.ts, and an empty prequalified set", () => {
    const artifact = artifactOf([
      team("frc1", {
        pointTotal: 5,
        eventPoints: [played("a", 5)],
        qualifyingAwards: [{ eventKey: "a", awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: false }],
      }),
      team("frc2", {
        pointTotal: 80,
        eventPoints: [played("a", 80)],
        qualifyingAwards: [{ eventKey: "a", awardType: AWARD_TYPE_ENGINEERING_INSPIRATION, label: "EI", awardOnly: false }],
      }),
      team("frc3", { pointTotal: 70, eventPoints: [played("a", 70)] }),
    ]);
    const { model } = statusesFor(artifact);
    expect(model.awardQualified).toEqual(["frc1"]);
    expect(model.prequalified).toEqual([]);
    const byAward = [...model.byTeam.values()].filter((entry) => entry.byAward).map((entry) => entry.teamKey);
    expect(model.awardQualified).toEqual(byAward);
  });

  it("keeps the prequalified set empty at this tier — no team ever reports Prequalified from the district lock", () => {
    const artifact = artifactOf([team("frc1", { pointTotal: 5, eventPoints: [played("a", 5)] })]);
    expect(statusesFor(artifact).model.counts.prequalified).toBe(0);
    expect(statusesFor(artifact).model.verdictCensus.prequalified).toBe(0);
  });
});

describe("In range versus Out of range", () => {
  /** Four contending teams whose open event leaves everybody reachable, so the points verdict is `contending` for all of them. */
  function contendingArtifact(totals: readonly number[]) {
    return artifactOf(
      totals.map((total, index) =>
        team(`frc${String(index + 1)}`, {
          pointTotal: total,
          eventPoints: [played("a", total)],
          remainingEvents: [ahead("b")],
          maxRemainingDistrict: EVENT_MAX,
        })
      ),
      { dcmpSlots: 2 }
    );
  }

  it("splits on the SHIPPED cutLinePointsWithQualifiers over median-projection inputs, not on a hand-rolled slot subtraction", () => {
    const artifact = contendingArtifact([40, 30, 20, 10]);
    const { rows, model } = statusesFor(artifact);
    const projectionInputs: LockTeamInput[] = rows.teams.map((entry) => ({ teamKey: entry.teamKey, pointTotal: entry.projection, maxRemaining: 0 }));
    const qualifiers: QualifierSets = { awardQualified: new Set(), prequalified: new Set() };
    const expected = cutLinePointsWithQualifiers(projectionInputs, artifact.dcmpSlots, qualifiers);
    expect(model.projectionCutLine).toBe(expected);
    expect(model.counts.inRange).toBe(2);
    expect(model.counts.outOfRange).toBe(2);
  });

  it("puts every team tied exactly AT the line In range, following locks.ts's own tie philosophy", () => {
    const artifact = contendingArtifact([30, 30, 30, 10]);
    const { model } = statusesFor(artifact);
    expect(model.byTeam.get("frc1")?.status).toBe("inRange");
    expect(model.byTeam.get("frc2")?.status).toBe("inRange");
    expect(model.byTeam.get("frc3")?.status).toBe("inRange");
    expect(model.byTeam.get("frc4")?.status).toBe("outOfRange");
  });

  it("reports neither In range nor Out of range for a null dcmpSlots — the honest capacity-not-published state instead", () => {
    const artifact = contendingArtifact([40, 30, 20, 10]);
    const withNoCapacity = DistrictArtifactSchema.parse({ ...artifact, dcmpSlots: null });
    const { model } = statusesFor(withNoCapacity);
    expect(model.projectionCutLine).toBeNull();
    expect(model.counts.inRange).toBe(0);
    expect(model.counts.outOfRange).toBe(0);
    for (const entry of model.byTeam.values()) expect(entry.status).toBe("capacityUnknown");
  });
});

describe("rewinding is monotonically more conservative", () => {
  it("never leaves a team locked at a reopened position that is not locked at now, in that direction only", () => {
    const artifact = artifactOf(
      Array.from({ length: 6 }, (_unused, i) =>
        team(`frc${String(i + 1)}`, { pointTotal: 60 - i * 10, eventPoints: [played("a", 60 - i * 10)] })
      ),
      { dcmpSlots: 2 }
    );
    const now = statusesFor(artifact).model;
    const reopened = statusesFor(artifact, new Map([["a", { qual: false, alliance: false, elim: true, award: true }]])).model;
    for (const [teamKey, entry] of reopened.byTeam) {
      if (entry.status === "locked") expect(now.byTeam.get(teamKey)?.status).toBe("locked");
      if (entry.verdict === "eliminated") expect(now.byTeam.get(teamKey)?.verdict).toBe("eliminated");
    }
    // And the reopening really did move something, so the implication above is
    // not vacuously true.
    expect(reopened.verdictCensus.locked).toBeLessThan(now.verdictCensus.locked);
  });
});

describe("one points slot held back per Impact award still to come (260925-ms7)", () => {
  /**
   * The `2025fnc` `frc3229` shape, at its smallest. Event `a` is over and
   * awarded; event `b` is over and awarded too, and its Impact went to `frc3`.
   * `frc2` never entered `b`, so nothing about `frc2` changes between the two
   * positions below: its floor, its ceiling and its total are 80 throughout,
   * exactly as the real trace recorded.
   *
   * Two DCMP slots. At `now` one is consumed by `frc3`'s Impact, leaving one
   * points slot, and `frc2` is out. One step earlier — `b`'s playoffs decided,
   * its award not yet posted — the award is not consuming that slot, so
   * WITHOUT a reservation `pointsSlots` would read 2 and `frc2` would be told
   * `Locked`, one step before the award takes it away. That is the defect, and
   * the held-back slot is the fix.
   */
  function knifeEdgeArtifact(): DistrictArtifact {
    const a = (total: number) => played("a", total, 0);
    const b = (total: number) => played("b", total, 3);
    return artifactOf(
      [
        team("frc1", { pointTotal: 100, eventPoints: [a(100)] }),
        team("frc2", { pointTotal: 80, eventPoints: [a(80)] }),
        team("frc3", {
          pointTotal: 60,
          eventPoints: [a(30), b(30)],
          qualifyingAwards: [{ eventKey: "b", awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: false }],
        }),
        team("frc4", { pointTotal: 50, eventPoints: [a(25), b(25)] }),
      ],
      { dcmpSlots: 2 }
    );
  }

  /** `b`'s playoffs are decided, its awards are not posted. Everything else is final. */
  const B_AWARD_REOPENED = new Map<string, DistrictStageFinality>([
    ["a", { qual: true, alliance: true, elim: true, award: true }],
    ["b", { qual: true, alliance: true, elim: true, award: false }],
  ]);

  it("holds back exactly one slot at the position where an event's award is still open, and none at now", () => {
    expect(statusesFor(knifeEdgeArtifact()).model.reservedSlots).toBe(0);
    expect(statusesFor(knifeEdgeArtifact(), B_AWARD_REOPENED).model.reservedSlots).toBe(1);
  });

  it("reads In range at the open-award position and Locked out once the award posts, never Locked at either", () => {
    const pending = statusesFor(knifeEdgeArtifact(), B_AWARD_REOPENED).model;
    const now = statusesFor(knifeEdgeArtifact()).model;

    expect(pending.byTeam.get("frc2")?.status).toBe("inRange");
    expect(now.byTeam.get("frc2")?.status).toBe("lockedOut");
    // The team at the top is clear of the held-back slot and stays Locked, so
    // the reservation is a line moving rather than a blanket refusal.
    expect(pending.byTeam.get("frc1")?.status).toBe("locked");
    expect(now.byTeam.get("frc1")?.status).toBe("locked");
  });

  it("leaves the projection cut line on the unreserved slot count, so In range does not shrink with the reservation", () => {
    const pending = statusesFor(knifeEdgeArtifact(), B_AWARD_REOPENED).model;
    // Two slots, no award consumed at this position, so the line is the second
    // highest projection. Subtracting the held-back slot here too would price
    // one award twice: its winner is still in this pool, competing.
    expect(pending.projectionCutLine).toBe(80);
  });

  it("reserves nothing for an event that will never happen, once every other event has finished", () => {
    // `b` registered, never scheduled, never played, never awarded, and `a` is
    // finished. A slot held back for it would never be released.
    const artifact = artifactOf(
      [
        team("frc1", { pointTotal: 100, eventPoints: [played("a", 100, 0)] }),
        team("frc2", {
          pointTotal: 80,
          eventPoints: [played("a", 80, 0)],
          remainingEvents: [ahead("b", 3, { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false })],
          maxRemainingDistrict: EVENT_MAX,
        }),
      ],
      { dcmpSlots: 2 }
    );
    expect(statusesFor(artifact).model.reservedSlots).toBe(0);
  });
});

describe("SC-3 — a finished district reproduces the artifact's own two counts EXACTLY", () => {
  /**
   * A finished district shaped like the real `2026pnw` artifact: every team's
   * district-tier events final, a handful of Impact winners, and a published
   * `dcmpSlots`. The artifact's own `insights` counts are computed by the same
   * shipped verdict pass the publisher runs, then asserted against this
   * module's recompute.
   */
  const TEAM_COUNT = 30;
  const SLOTS = 12;
  const IMPACT_TEAMS = ["frc25", "frc26", "frc27"];

  const teams = Array.from({ length: TEAM_COUNT }, (_unused, i) => {
    const teamKey = `frc${String(i + 1)}`;
    const total = 120 - i * 4;
    return team(teamKey, {
      pointTotal: total,
      eventPoints: [played("a", total, 0), played("b", 0, 2)],
      qualifyingAwards: IMPACT_TEAMS.includes(teamKey) ? [{ eventKey: "a", awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: false }] : [],
    });
  });

  it("matches insights.districtLockedCount and insights.districtEliminatedCount, per VERDICT status", () => {
    const provisional = artifactOf(teams, { dcmpSlots: SLOTS });
    const { model } = statusesFor(provisional);
    // The fixture's own three numbers, written out so a future reader cannot
    // conflate them: 9 teams at `locked`, 3 at `lockedAward`, 18 at
    // `eliminated`. Twelve slots minus the three consuming Impact winners
    // leaves nine points slots over a 27-team pool, so nine lock and the
    // remaining eighteen are out. The artifact field counts `locked` ALONE.
    const artifact = DistrictArtifactSchema.parse({
      ...provisional,
      insights: { ...provisional.insights, districtLockedCount: 9, districtEliminatedCount: 18 },
    });
    expect(model.verdictCensus.locked).toBe(artifact.insights.districtLockedCount);
    expect(model.verdictCensus.eliminated).toBe(artifact.insights.districtEliminatedCount);
    expect(model.verdictCensus.lockedAward).toBe(3);
  });

  it("makes the Locked CHIP count `locked` plus `lockedAward` — a DIFFERENT number from insights.districtLockedCount", () => {
    const { model } = statusesFor(artifactOf(teams, { dcmpSlots: SLOTS }));
    expect(model.counts.locked).toBe(model.verdictCensus.locked + model.verdictCensus.lockedAward);
    expect(model.counts.locked).toBe(12);
    expect(model.counts.locked).not.toBe(9);
  });
});

describe("the projection order is the row order", () => {
  it("reads the array districtLedgerRows produced and computes no second ordering of its own", () => {
    const artifact = artifactOf([
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)] }),
      team("frc1", { pointTotal: 30, eventPoints: [played("a", 30)] }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)] }),
    ]);
    const { rows, model } = statusesFor(artifact);
    expect([...model.byTeam.keys()]).toEqual(rows.teams.map((entry) => entry.teamKey));
  });
});

describe("the pooled remaining-points lock at a position (260925-pl6)", () => {
  /**
   * Fifteen teams, twelve points slots, one district event still wholly ahead
   * of every one of them. The leader sits 83 points clear of the rest, which is
   * exactly one event's maximum, so EVERY rival's ceiling reaches its floor and
   * the shipped ceiling test refuses to lock it: fourteen threats against the
   * eleven slots that are not held back for the event's pending Impact award.
   *
   * Eleven of them would have to pass it, and that costs 11 x 83 = 913 points
   * between them. A fifteen-team event has 754 to hand out, so the pooled
   * argument locks the leader where the ceiling test could not.
   */
  const POOLED_SLOTS = 12;
  const pooledTeams = [
    team("frc1", { pointTotal: 100, eventPoints: [played("a", 100)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ...Array.from({ length: 14 }, (_, index) =>
      team(`frc${String(index + 2)}`, {
        pointTotal: 17,
        eventPoints: [played("a", 17)],
        remainingEvents: [ahead("b")],
        maxRemainingDistrict: EVENT_MAX,
      })
    ),
  ];

  it("locks a team the ceiling test leaves contending, and says the pooled argument is why", () => {
    const { model } = statusesFor(artifactOf(pooledTeams, { dcmpSlots: POOLED_SLOTS }));
    const leader = model.byTeam.get("frc1")!;
    expect(leader.status).toBe("locked");
    // `"pooled"` and not `"both"`: the ceiling test did not reach this team.
    expect(leader.lockedBy).toBe("pooled");
    expect(model.pooledRemainingPoints).toBeGreaterThan(0);
    // Every rival's ceiling really does reach the leader's floor, which is what
    // makes the ceiling test refuse.
    expect(17 + EVENT_MAX).toBeGreaterThanOrEqual(100);
  });

  it("stops locking that team once the district has enough points left to unseat it", () => {
    // The same teams with a SECOND event still ahead: twice the pool, and the
    // 830 points that would have to move are now available.
    const twoEvents = pooledTeams.map((entry) => ({
      ...entry,
      remainingEvents: [ahead("b"), ahead("c", 4)],
      maxRemainingDistrict: EVENT_MAX * 2,
    }));
    const { model } = statusesFor(artifactOf(twoEvents, { dcmpSlots: POOLED_SLOTS }));
    expect(model.byTeam.get("frc1")!.verdict).toBe("contending");
    expect(model.byTeam.get("frc1")!.lockedBy).toBeNull();
  });

  it("holds no points at all at a finished district, so the two arguments lock exactly the same teams", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)] }),
      team("frc2", { pointTotal: 10, eventPoints: [played("a", 10)] }),
      team("frc3", { pointTotal: 5, eventPoints: [played("a", 5)] }),
    ]);
    const { model } = statusesFor(artifact);
    expect(model.pooledRemainingPoints).toBe(0);
    expect(model.verdictCensus.locked).toBe(2);
    // Both arguments hold for every locked team, which is the whole reason a
    // finished season's published verdicts do not move.
    for (const result of model.byTeam.values()) {
      if (result.verdict === "locked") expect(result.lockedBy).toBe("both");
      else expect(result.lockedBy).toBeNull();
    }
  });

  it("reads the pool from the REWOUND position, not from the artifact's own state blocks", () => {
    const artifact = artifactOf(pooledTeams, { dcmpSlots: POOLED_SLOTS });
    // Reopening qualification at the already-finished event `a` puts that
    // event's qualification pool back on the table on top of event `b`'s.
    const reopened = statusesFor(artifact, new Map([["a", { qual: false, alliance: true, elim: true, award: true }]])).model;
    expect(reopened.pooledRemainingPoints).toBeGreaterThan(statusesFor(artifact).model.pooledRemainingPoints);
  });
});
