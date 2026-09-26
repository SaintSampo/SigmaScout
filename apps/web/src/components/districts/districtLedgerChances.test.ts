/**
 * The advancement chance's two pure halves (quick task 260925-rpj).
 *
 * Every fixture goes through the REAL `DistrictArtifactSchema`, the REAL
 * `buildDistrictLedgerRows` and the REAL `computeDistrictLedgerStatuses`, for
 * the reason `districtLedgerStatus.test.ts` states for itself: the thing under
 * test here is agreement BETWEEN those modules, and a hand written status model
 * would agree with whatever this file happened to type.
 *
 * WHAT EACH HALF OWES:
 *
 *   `buildAdvancementChanceRun` must refuse in four cases and post the whole
 *   field in every other one. The refusal that matters most is the unavailable
 *   grand total: a chance is a RANKING, so a missing rival does not make one
 *   chance slightly worse, it makes every other chance too high.
 *
 *   `reconcileAdvancementChances` must let exactly two statuses through and
 *   count, rather than print, anything that disagrees with a verdict.
 */
import { describe, expect, it } from "vitest";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { AWARD_TYPE_IMPACT } from "../../../../../packages/core/districts/qualification.js";
import {
  DistrictArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import {
  buildDistrictLedgerRows,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
} from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses, type DistrictLedgerStatusModel } from "./districtLedgerStatus.js";
import { buildAdvancementChanceRun, reconcileAdvancementChances } from "./districtLedgerChances.js";

type DistrictTeam = DistrictArtifact["teams"][number];

const SEASON = 2026;
const CEILINGS = maxEventPoints(SEASON, "district");
const EVENT_MAX = CEILINGS.qual + CEILINGS.alliance + CEILINGS.elim + CEILINGS.award;
const FINISHED: DistrictEventState = { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const UNSTARTED: DistrictEventState = { qualMatchesPlayed: 0, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
const POSITION = "now";

function played(eventKey: string, total: number, week = 0) {
  return { eventKey, eventName: `Event ${eventKey}`, week, tier: "district" as const, qual: total, alliance: 0, elim: 0, award: 0, total, state: FINISHED };
}

function ahead(eventKey: string, week = 3) {
  return { eventKey, eventName: `Event ${eventKey}`, week, tier: "district" as const, maxPoints: EVENT_MAX, state: UNSTARTED };
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
    awardProfile: { bucket: "none", rookie: false },
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

/** A flat pmf over `0` to `hi`, as a baked sidecar would decode to. */
function flat(hi: number): DistrictPointDistribution {
  const counts = new Float64Array(hi + 1);
  const each = 1 / (hi + 1);
  for (let i = 0; i <= hi; i++) counts[i] = each;
  return { counts, denominator: 1 };
}

/** Every open category of `eventKey` priced flat for every team in `teamKeys`. */
function distributionsFor(eventKey: string, teamKeys: readonly string[]): ReadonlyMap<string, DistrictEventDistributions> {
  const byTeam = new Map<string, Record<DistrictCellKind, DistrictPointDistribution | undefined>>();
  for (const teamKey of teamKeys) {
    byTeam.set(teamKey, {
      qual: flat(CEILINGS.qual),
      alliance: flat(CEILINGS.alliance),
      elim: flat(CEILINGS.elim),
      award: flat(CEILINGS.award),
      eventTotal: flat(EVENT_MAX),
      grandTotal: undefined,
    });
  }
  return new Map<string, DistrictEventDistributions>([[eventKey, { eventKey, byTeam }]]);
}

interface Built {
  readonly artifact: DistrictArtifact;
  readonly teams: ReturnType<typeof buildDistrictLedgerRows>["teams"];
  readonly statuses: DistrictLedgerStatusModel;
}

function build(artifact: DistrictArtifact, distributions: ReadonlyMap<string, DistrictEventDistributions>): Built {
  const rows = buildDistrictLedgerRows({ artifact, distributions });
  return { artifact, teams: rows.teams, statuses: computeDistrictLedgerStatuses({ artifact, teams: rows.teams }) };
}

/** Three teams: one settled and clear, two still racing at one unstarted event. */
function racingDistrict(): Built {
  const artifact = artifactOf([
    team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] }),
    team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
  ]);
  return build(artifact, distributionsFor("b", ["frc2", "frc3"]));
}

function runFor(built: Built, runSignature: string | null = ""): ReturnType<typeof buildAdvancementChanceRun> {
  return buildAdvancementChanceRun({ ...built, runSignature, positionId: POSITION });
}

describe("buildAdvancementChanceRun", () => {
  it("posts one entry per team in the district, including the teams with nothing left to play", () => {
    const run = runFor(racingDistrict());
    expect(run).toBeDefined();
    expect(run!.inputs.teams.map((entry) => entry.teamKey).sort()).toEqual(["frc1", "frc2", "frc3"]);
    expect(run!.inputs.slots).toBe(2);
  });

  it("carries locks.ts's own qualifier set and reservation, straight off the status model", () => {
    const built = racingDistrict();
    const run = runFor(built);
    expect(run!.inputs.awardQualified).toEqual(built.statuses.awardQualified);
    expect(run!.inputs.prequalified).toEqual([]);
    expect(run!.inputs.reservedSlots).toBe(built.statuses.reservedSlots);
  });

  it("forwards an award qualifier as one, so the ranking sees the same narrowed race the verdicts did", () => {
    const artifact = artifactOf([
      team("frc1", {
        pointTotal: 60,
        eventPoints: [played("a", 60)],
        qualifyingAwards: [{ eventKey: "a", awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: true }],
      }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ]);
    const run = runFor(build(artifact, distributionsFor("b", ["frc2", "frc3"])));
    expect(run!.inputs.awardQualified).toEqual(["frc1"]);
  });

  it("gives a settled team a point mass at its earned total, and an open team a real distribution", () => {
    const run = runFor(racingDistrict());
    const settled = run!.inputs.teams.find((entry) => entry.teamKey === "frc1")!;
    const racing = run!.inputs.teams.find((entry) => entry.teamKey === "frc2")!;
    expect(settled.counts.length).toBe(61);
    expect(settled.counts[60]).toBe(1);
    expect(racing.counts.length).toBeGreaterThan(EVENT_MAX);
  });

  it("refuses an unpublished capacity", () => {
    const artifact = artifactOf(
      [
        team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] }),
        team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      ],
      { dcmpSlots: null }
    );
    expect(runFor(build(artifact, distributionsFor("b", ["frc2"])))).toBeUndefined();
  });

  it("refuses a district with nothing left to play, which is what keeps SC-5's promise", () => {
    const artifact = artifactOf([team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] })]);
    expect(runFor(build(artifact, new Map()))).toBeUndefined();
  });

  it("refuses while a per-event run is still in flight", () => {
    expect(runFor(racingDistrict(), null)).toBeUndefined();
  });

  it("refuses when NOTHING open survives the exclusion, which is a settled season by another route", () => {
    // No distribution is supplied for the unstarted event at all, so the one
    // racing team's grand total is unavailable and the only team left is settled.
    const artifact = artifactOf([
      team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ]);
    expect(runFor(build(artifact, new Map()))).toBeUndefined();
  });

  /**
   * THE NARROWING (quick task 260925-uf8). One team whose grand total could not
   * be built used to silence the whole district; it now excludes that team and
   * is bounded by the capacity. See this module's header for the production URL
   * that found it.
   */
  it("EXCLUDES one team whose grand total is unavailable, and still ranks the rest", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ]);
    // Priced for frc2 only, so frc3's open cells and grand total are unavailable.
    const run = runFor(build(artifact, distributionsFor("b", ["frc2"])));
    expect(run).toBeDefined();
    expect(run!.excludedTeams).toEqual(["frc3"]);
    expect(run!.inputs.teams.map((entry) => entry.teamKey).sort()).toEqual(["frc1", "frc2"]);
  });

  it("reports an empty excluded set on a healthy district", () => {
    expect(runFor(racingDistrict())!.excludedTeams).toEqual([]);
  });

  it("refuses when the excluded set alone could fill the capacity", () => {
    // Two slots, and two teams excluded: whatever the remaining field's ranking
    // said, those two could have taken every slot.
    const artifact = artifactOf([
      team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ]);
    expect(runFor(build(artifact, distributionsFor("b", ["frc1"])))).toBeUndefined();
  });

  it("moves the signature when the excluded set changes, so a repaired team re-runs the ranking", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 60, eventPoints: [played("a", 60)] }),
      team("frc2", { pointTotal: 20, eventPoints: [played("a", 20)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [ahead("b")], maxRemainingDistrict: EVENT_MAX }),
    ]);
    const partial = runFor(build(artifact, distributionsFor("b", ["frc2"])))!;
    const whole = runFor(build(artifact, distributionsFor("b", ["frc2", "frc3"])))!;
    expect(partial.signature).not.toBe(whole.signature);
    expect(whole.excludedTeams).toEqual([]);
  });
});

describe("buildAdvancementChanceRun's signature", () => {
  it("is stable for the same position and inputs", () => {
    const built = racingDistrict();
    expect(runFor(built)!.signature).toBe(runFor(built)!.signature);
  });

  it("moves with the position, the per-event run, and the artifact's own publish timestamp", () => {
    const built = racingDistrict();
    const base = runFor(built)!.signature;
    expect(buildAdvancementChanceRun({ ...built, runSignature: "", positionId: "wk-1" })!.signature).not.toBe(base);
    expect(buildAdvancementChanceRun({ ...built, runSignature: "2026wab|4", positionId: POSITION })!.signature).not.toBe(base);

    const later = { ...built, artifact: { ...built.artifact, computedAt: "2026-09-25T01:00:00.000Z" } };
    expect(runFor(later)!.signature).not.toBe(base);
  });
});

describe("reconcileAdvancementChances", () => {
  /** A status model carrying exactly the statuses a test needs, built by hand because these are the INPUT here rather than the thing under test. */
  function statusesWith(entries: readonly [string, "locked" | "inRange" | "outOfRange" | "lockedOut" | "prequalified"][]): DistrictLedgerStatusModel {
    return {
      byTeam: new Map(entries.map(([teamKey, status]) => [teamKey, { teamKey, status, byAward: false, verdict: "contending" as const, lockedBy: null }])),
      counts: { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 },
      verdictCensus: { locked: 0, lockedAward: 0, prequalified: 0, eliminated: 0, contending: 0, unknown: 0 },
      projectionCutLine: 0,
      awardQualified: [],
      prequalified: [],
      reservedSlots: 0,
      pooledRemainingPoints: 0,
    };
  }

  it("prints a chance for In range and Out of range, and for nothing else", () => {
    const statuses = statusesWith([
      ["frc1", "inRange"],
      ["frc2", "outOfRange"],
      ["frc3", "locked"],
      ["frc4", "lockedOut"],
    ]);
    const raw = new Map([
      ["frc1", 0.8],
      ["frc2", 0.2],
      ["frc3", 1],
      ["frc4", 0],
    ]);
    const model = reconcileAdvancementChances(raw, statuses);
    expect([...model.byTeam.keys()].sort()).toEqual(["frc1", "frc2"]);
    expect(model.byTeam.get("frc1")).toBe(0.8);
    expect(model.gaps).toEqual([]);
  });

  it("counts a Locked team below certainty as a gap and prints nothing for it", () => {
    const statuses = statusesWith([
      ["frc1", "locked"],
      ["frc2", "inRange"],
    ]);
    const model = reconcileAdvancementChances(
      new Map([
        ["frc1", 0.93],
        ["frc2", 0.5],
      ]),
      statuses
    );
    expect(model.byTeam.has("frc1")).toBe(false);
    expect(model.gaps).toEqual(["frc1"]);
  });

  it("counts a Locked out team above zero as a gap and prints nothing for it", () => {
    const statuses = statusesWith([["frc1", "lockedOut"]]);
    const model = reconcileAdvancementChances(new Map([["frc1", 0.02]]), statuses);
    expect(model.byTeam.size).toBe(0);
    expect(model.gaps).toEqual(["frc1"]);
  });

  it("treats a team the pool never ranked as no gap at all", () => {
    const statuses = statusesWith([["frc1", "inRange"]]);
    const model = reconcileAdvancementChances(new Map(), statuses);
    expect(model.byTeam.size).toBe(0);
    expect(model.gaps).toEqual([]);
  });
});
