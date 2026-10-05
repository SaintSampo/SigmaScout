/**
 * The Live field overlay (quick task 261005-04t, D-06), every branch.
 *
 * Hand built districts parsed through the REAL `DistrictArtifactSchema`, with
 * the raw model built by the REAL row builder and status module, so each cell's
 * raw verdict is something `locks.ts` actually returned and is asserted as a
 * premise before the overlay is read. Then the committed 2026 PNW fixture.
 *
 * THE FIXTURE CARRIES NO `state` BLOCKS, so as committed its championship reads
 * not started; the two fixture pins set a finished state on every eventPoints
 * entry first, and say so.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import {
  AWARD_TYPE_ENGINEERING_INSPIRATION,
  AWARD_TYPE_IMPACT,
} from "../../../../../packages/core/districts/qualification.js";
import {
  DistrictArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import { buildDistrictLedgerRows, type DistrictEventDistributions } from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses, type DistrictLedgerStatusModel, type DistrictLedgerStatusResult } from "./districtLedgerStatus.js";
import {
  DISTRICT_LEDGER_SHOWN_STATUS_KEYS,
  applyChampionshipFieldOverlay,
  championshipHasStarted,
  isPlayingChampionship,
} from "./districtFieldOverlay.js";

type DistrictTeam = DistrictArtifact["teams"][number];

const SEASON = 2026;
const CEILINGS = maxEventPoints(SEASON, "district");
const EVENT_MAX = CEILINGS.qual + CEILINGS.alliance + CEILINGS.elim + CEILINGS.award;
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();

const FINISHED: DistrictEventState = { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const STARTED: DistrictEventState = { qualMatchesPlayed: 3, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
const UNSTARTED: DistrictEventState = { qualMatchesPlayed: 0, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

const CMP = "cmp";

/** A finished DISTRICT tier event row, all of its points in qualification. */
function played(eventKey: string, total: number, week = 0) {
  return { eventKey, eventName: `Event ${eventKey}`, week, tier: "district" as const, qual: total, alliance: 0, elim: 0, award: 0, total, state: FINISHED as DistrictEventState | undefined };
}

/** A DCMP tier eventPoints row. `state: null` leaves the block OFF the row, which is what a pre republish artifact carries. */
function championship(points: { qual?: number; alliance?: number; elim?: number; award?: number }, state: DistrictEventState | null = FINISHED) {
  const qual = points.qual ?? 0;
  const alliance = points.alliance ?? 0;
  const elim = points.elim ?? 0;
  const award = points.award ?? 0;
  const row = { eventKey: CMP, eventName: "District Championship", week: 5, tier: "dcmp" as const, qual, alliance, elim, award, total: qual + alliance + elim + award };
  return state === null ? row : { ...row, state };
}

/** A DCMP tier remainingEvents row: the team is entered and TBA has reported no points for it. */
function championshipAhead(state: DistrictEventState | null = STARTED) {
  const row = { eventKey: CMP, eventName: "District Championship", week: 5, tier: "dcmp" as const, maxPoints: EVENT_MAX * 3 };
  return state === null ? row : { ...row, state };
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
    computedAt: "2026-10-05T00:00:00.000Z",
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

/** The RAW model at now: the real rows and the real status module, no stage map. */
function rawFor(artifact: DistrictArtifact): DistrictLedgerStatusModel {
  const rows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
  return computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
}

const IMPACT = (eventKey: string) => ({ eventKey, awardType: AWARD_TYPE_IMPACT, label: "Impact", awardOnly: false });
/** At the district tier an Engineering Inspiration is an award only invitation: the team attends the championship and does not play it. */
const AWARD_ONLY = (eventKey: string) => ({ eventKey, awardType: AWARD_TYPE_ENGINEERING_INSPIRATION, label: "Engineering Inspiration", awardOnly: true });

/**
 * ONE DISTRICT, ONE TEAM PER CELL, the championship finished. Six slots: two go
 * to the Impact winners, leaving four points slots over an eight team pool.
 * Three teams are clear of the line, two are TIED on the last slot, three are
 * below it.
 */
function cellDistrict(overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  return artifactOf(
    [
      // Raw locked.
      team("frc1", { pointTotal: 100 + 30, eventPoints: [played("a", 100), championship({ qual: 30 })] }),
      team("frc2", { pointTotal: 90, eventPoints: [played("a", 90)] }),
      team("frc3", { pointTotal: 80 + 10, eventPoints: [played("a", 80), championship({ award: 10 })] }),
      // Raw contending: tied on the last points slot.
      team("frc4", { pointTotal: 50 + 12, eventPoints: [played("a", 50), championship({ alliance: 12 })] }),
      team("frc5", { pointTotal: 50, eventPoints: [played("a", 50)] }),
      // Raw eliminated.
      team("frc6", { pointTotal: 20 + 9, eventPoints: [played("a", 20), championship({ elim: 9 })] }),
      team("frc7", { pointTotal: 10, eventPoints: [played("a", 10)] }),
      team("frc8", { pointTotal: 5 + 10, eventPoints: [played("a", 5), championship({ award: 10 })] }),
      // Raw lockedAward: an Impact award at a district tier event.
      team("frc9", { pointTotal: 3 + 15, eventPoints: [played("a", 3), championship({ qual: 15 })], qualifyingAwards: [IMPACT("a")] }),
      team("frc10", { pointTotal: 2, eventPoints: [played("a", 2), played("b", 0, 2)], qualifyingAwards: [IMPACT("b")] }),
    ],
    { dcmpSlots: 6, ...overrides }
  );
}

const CELL_KEYS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9", "frc10"] as const;

function repoFile(relative: string): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
    dir = parent;
  }
}

// ---------------------------------------------------------------------------

describe("the shown vocabulary", () => {
  it("is six keys in chip order, Declined between Locked and In range", () => {
    expect(DISTRICT_LEDGER_SHOWN_STATUS_KEYS).toEqual(["prequalified", "locked", "declined", "inRange", "outOfRange", "lockedOut"]);
  });
});

describe("O1: the overlay hands the raw model back untouched whenever it does not apply", () => {
  function expectUntouched(raw: DistrictLedgerStatusModel, artifact: DistrictArtifact, options?: { readonly atLive?: boolean }): void {
    const shown = options === undefined ? applyChampionshipFieldOverlay(raw, artifact) : applyChampionshipFieldOverlay(raw, artifact, options);
    // The SAME map and the SAME counts object, never an equal copy.
    expect(shown.byTeam).toBe(raw.byTeam);
    expect(shown.counts).toBe(raw.counts);
    expect(shown.fieldOverlay).toBe(false);
    expect(shown.counts.declined).toBeUndefined();
    expect(shown.verdictCensus).toBe(raw.verdictCensus);
    expect(shown.awardQualified).toBe(raw.awardQualified);
    expect(shown.reservedSlots).toBe(raw.reservedSlots);
  }

  it("when atLive is absent", () => {
    const artifact = cellDistrict();
    expect(championshipHasStarted(artifact)).toBe(true);
    expectUntouched(rawFor(artifact), artifact);
    expectUntouched(rawFor(artifact), artifact, {});
  });

  it("when atLive is false: a rewound position, whatever the championship's state", () => {
    const artifact = cellDistrict();
    expectUntouched(rawFor(artifact), artifact, { atLive: false });
  });

  it("when atLive is true and no dcmp tier entry has started", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)], remainingEvents: [championshipAhead(UNSTARTED)] }),
      team("frc2", { pointTotal: 30, eventPoints: [played("a", 30)], remainingEvents: [championshipAhead(null)] }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)] }),
    ]);
    expect(championshipHasStarted(artifact)).toBe(false);
    expectUntouched(rawFor(artifact), artifact, { atLive: true });
  });

  it("when atLive is true and the championship has started but dcmpSlots is null", () => {
    const artifact = cellDistrict({ dcmpSlots: null });
    expect(championshipHasStarted(artifact)).toBe(true);
    expectUntouched(rawFor(artifact), artifact, { atLive: true });
  });
});

describe("O2: when the championship has started", () => {
  const district = (overrides: Partial<DistrictTeam>) =>
    artifactOf([team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)], ...overrides }), team("frc2", { pointTotal: 10, eventPoints: [played("a", 10)] })]);

  it("a dcmp tier remainingEvents entry with a started state starts it", () => {
    expect(championshipHasStarted(district({ remainingEvents: [championshipAhead(STARTED)] }))).toBe(true);
  });

  it("a dcmp tier eventPoints entry with a finished state starts it", () => {
    expect(championshipHasStarted(district({ pointTotal: 70, eventPoints: [played("a", 40), championship({ qual: 30 }, FINISHED)] }))).toBe(true);
  });

  it("a dcmp tier entry with an unstarted state, or with no state at all, does not", () => {
    expect(championshipHasStarted(district({ remainingEvents: [championshipAhead(UNSTARTED)] }))).toBe(false);
    expect(championshipHasStarted(district({ remainingEvents: [championshipAhead(null)] }))).toBe(false);
    expect(championshipHasStarted(district({ pointTotal: 70, eventPoints: [played("a", 40), championship({ qual: 30 }, null)] }))).toBe(false);
  });

  it("a DISTRICT tier event in progress does not: only the championship's own state counts", () => {
    const artifact = artifactOf([
      team("frc1", { pointTotal: 40, eventPoints: [{ ...played("a", 40), state: STARTED }] }),
      team("frc2", { pointTotal: 10, eventPoints: [{ ...played("a", 10), state: STARTED }] }),
    ]);
    expect(championshipHasStarted(artifact)).toBe(false);
  });
});

describe("O3: one team per cell, at Live, with the championship finished", () => {
  const artifact = cellDistrict();
  const raw = rawFor(artifact);
  const shown = applyChampionshipFieldOverlay(raw, artifact, { atLive: true });
  const cell = (teamKey: string) => {
    const result = shown.byTeam.get(teamKey)!;
    return { status: result.status, byAward: result.byAward };
  };

  it("has the premise: the raw verdicts are the ones each cell names", () => {
    expect(Object.fromEntries(CELL_KEYS.map((teamKey) => [teamKey, raw.byTeam.get(teamKey)?.verdict]))).toEqual({
      frc1: "locked",
      frc2: "locked",
      frc3: "locked",
      frc4: "contending",
      frc5: "contending",
      frc6: "eliminated",
      frc7: "eliminated",
      frc8: "eliminated",
      frc9: "lockedAward",
      frc10: "lockedAward",
    });
    expect(shown.fieldOverlay).toBe(true);
  });

  it("raw locked and played reads Locked, not by award", () => {
    expect(cell("frc1")).toEqual({ status: "locked", byAward: false });
  });

  it("raw lockedAward and played reads Locked, by award", () => {
    expect(cell("frc9")).toEqual({ status: "locked", byAward: true });
  });

  it("raw eliminated and played reads Locked, not by award", () => {
    expect(cell("frc6")).toEqual({ status: "locked", byAward: false });
  });

  it("raw contending (tied on the last slot) and played reads Locked", () => {
    expect(cell("frc4")).toEqual({ status: "locked", byAward: false });
  });

  it("raw locked with no championship entry reads Declined", () => {
    expect(cell("frc2")).toEqual({ status: "declined", byAward: false });
  });

  it("raw lockedAward with no championship entry reads Declined, and never by award", () => {
    expect(cell("frc10")).toEqual({ status: "declined", byAward: false });
  });

  it("raw locked with a championship entry carrying award points only reads Declined", () => {
    expect(cell("frc3")).toEqual({ status: "declined", byAward: false });
  });

  it("raw eliminated and absent reads Locked out", () => {
    expect(cell("frc7")).toEqual({ status: "lockedOut", byAward: false });
  });

  it("raw eliminated with an award only championship entry reads Locked out", () => {
    expect(cell("frc8")).toEqual({ status: "lockedOut", byAward: false });
  });

  it("raw contending and absent reads Locked out", () => {
    expect(cell("frc5")).toEqual({ status: "lockedOut", byAward: false });
  });

  it("keeps verdict, lockedBy and teamKey on every shown result exactly as the raw model has them", () => {
    expect([...shown.byTeam.keys()]).toEqual([...raw.byTeam.keys()]);
    for (const [teamKey, result] of shown.byTeam) {
      const source = raw.byTeam.get(teamKey)!;
      expect(result.teamKey).toBe(teamKey);
      expect(result.verdict).toBe(source.verdict);
      expect(result.lockedBy).toBe(source.lockedBy);
    }
  });

  it("counts no In range and no Out of range, and the six counts add up to the roster", () => {
    expect(shown.counts.inRange).toBe(0);
    expect(shown.counts.outOfRange).toBe(0);
    const declined = [...shown.byTeam.values()].filter((result) => result.status === "declined").length;
    expect(declined).toBe(3);
    expect(shown.counts.declined).toBe(declined);
    expect(shown.counts.locked).toBe(4);
    expect(shown.counts.lockedOut).toBe(3);
    expect(shown.counts.locked + (shown.counts.declined ?? 0) + shown.counts.lockedOut + shown.counts.prequalified).toBe(artifact.teams.length);
    for (const result of shown.byTeam.values()) expect(["locked", "declined", "lockedOut"]).toContain(result.status);
  });

  it("leaves the raw model itself and every other model field alone", () => {
    expect(shown.byTeam).not.toBe(raw.byTeam);
    expect(shown.counts).not.toBe(raw.counts);
    expect(raw.byTeam.get("frc2")?.status).toBe("locked");
    expect("declined" in raw.counts).toBe(false);
    expect(shown.verdictCensus).toBe(raw.verdictCensus);
    expect(shown.projectionCutLine).toBe(raw.projectionCutLine);
    expect(shown.awardQualified).toBe(raw.awardQualified);
    expect(shown.prequalified).toBe(raw.prequalified);
    expect(shown.reservedSlots).toBe(raw.reservedSlots);
    expect(shown.pooledRemainingPoints).toBe(raw.pooledRemainingPoints);
  });

  it("passes a prequalified result through as the same object, and reads a team the artifact does not carry as not playing", () => {
    const prequalified = { teamKey: "frc900", status: "prequalified" as const, byAward: false, verdict: "prequalified" as const, lockedBy: null };
    const handBuilt: DistrictLedgerStatusModel = {
      ...raw,
      byTeam: new Map<string, DistrictLedgerStatusResult>([
        ["frc900", prequalified],
        ["frc901", { teamKey: "frc901", status: "locked" as const, byAward: false, verdict: "locked" as const, lockedBy: "both" as const }],
        ["frc902", { teamKey: "frc902", status: "lockedOut" as const, byAward: false, verdict: "eliminated" as const, lockedBy: null }],
      ]),
      counts: { prequalified: 1, locked: 1, inRange: 0, outOfRange: 0, lockedOut: 1 },
    };
    const result = applyChampionshipFieldOverlay(handBuilt, artifact, { atLive: true });
    expect(result.byTeam.get("frc900")).toBe(prequalified);
    expect(result.byTeam.get("frc901")?.status).toBe("declined");
    expect(result.byTeam.get("frc902")?.status).toBe("lockedOut");
    expect(result.counts).toEqual({ prequalified: 1, locked: 0, declined: 1, inRange: 0, outOfRange: 0, lockedOut: 1 });
  });
});

describe("O4: points not yet reported for a team (no dcmp tier eventPoints entry, a started dcmp tier remainingEvents entry)", () => {
  const artifact = artifactOf(
    [
      team("frc1", { pointTotal: 100, eventPoints: [played("a", 100)], remainingEvents: [championshipAhead()] }),
      team("frc2", { pointTotal: 90, eventPoints: [played("a", 90)], remainingEvents: [championshipAhead()], qualifyingAwards: [AWARD_ONLY("a")] }),
      team("frc3", { pointTotal: 10, eventPoints: [played("a", 10)], remainingEvents: [championshipAhead()] }),
      team("frc4", { pointTotal: 5, eventPoints: [played("a", 5)], remainingEvents: [championshipAhead()], qualifyingAwards: [AWARD_ONLY("a")] }),
      // Entered nowhere at the championship.
      team("frc5", { pointTotal: 1, eventPoints: [played("a", 1)] }),
      // An award only entry at an event that is NOT one of this team's district tier events does not make it an invitee.
      team("frc6", { pointTotal: 0, eventPoints: [played("a", 0)], remainingEvents: [championshipAhead()], qualifyingAwards: [AWARD_ONLY(CMP)] }),
    ],
    { dcmpSlots: 2 }
  );
  const raw = rawFor(artifact);
  const shown = applyChampionshipFieldOverlay(raw, artifact, { atLive: true });

  it("has the premise: started, two raw locked, four raw eliminated", () => {
    expect(championshipHasStarted(artifact)).toBe(true);
    expect(shown.fieldOverlay).toBe(true);
    expect(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"].map((teamKey) => raw.byTeam.get(teamKey)?.verdict)).toEqual([
      "locked",
      "locked",
      "eliminated",
      "eliminated",
      "eliminated",
      "eliminated",
    ]);
  });

  it("raw locked reads Locked", () => {
    expect(shown.byTeam.get("frc1")?.status).toBe("locked");
  });

  it("raw eliminated with no award only award reads Locked: it is entered, so it is in the field", () => {
    expect(shown.byTeam.get("frc3")?.status).toBe("locked");
    expect(shown.byTeam.get("frc6")?.status).toBe("locked");
  });

  it("raw eliminated holding an award only award from one of its district tier events reads Locked out: an award only invitee", () => {
    expect(shown.byTeam.get("frc4")?.status).toBe("lockedOut");
  });

  it("raw locked holding such an award still reads Locked: it earned its place on points", () => {
    expect(shown.byTeam.get("frc2")?.status).toBe("locked");
  });

  it("a team with no championship entry of either kind is not playing", () => {
    expect(shown.byTeam.get("frc5")?.status).toBe("lockedOut");
    expect(shown.counts).toEqual({ prequalified: 0, locked: 4, declined: 0, inRange: 0, outOfRange: 0, lockedOut: 2 });
  });

  it("isPlayingChampionship reads the same rule one team at a time", () => {
    const byKey = new Map(artifact.teams.map((entry) => [entry.teamKey, entry] as const));
    expect(isPlayingChampionship(byKey.get("frc4")!, false)).toBe(false);
    // The same team WITH an earned place is playing: the award only test never applies to a team that earned its place.
    expect(isPlayingChampionship(byKey.get("frc4")!, true)).toBe(true);
    expect(isPlayingChampionship(byKey.get("frc5")!, true)).toBe(false);
    expect(isPlayingChampionship(byKey.get("frc5")!, false)).toBe(false);
    // A reported row decides on its own, whatever the team earned.
    const cells = new Map(cellDistrict().teams.map((entry) => [entry.teamKey, entry] as const));
    expect(isPlayingChampionship(cells.get("frc6")!, false)).toBe(true);
    expect(isPlayingChampionship(cells.get("frc3")!, true)).toBe(false);
  });
});

describe("O6: a championship row that carries no points yet is not a decline", () => {
  /** Qualification over, nothing else decided: the row's zero qualification points are a result, not a gap. */
  const QUAL_DONE: DistrictEventState = { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
  const one = (overrides: Partial<DistrictTeam>) => team("frc1", { pointTotal: 40, eventPoints: [played("a", 40)], ...overrides });
  const withRow = (row: ReturnType<typeof championship>, overrides: Partial<DistrictTeam> = {}) =>
    one({ eventPoints: [played("a", 40), row], ...overrides });

  it("case 1: a row with qualification, alliance or playoff points is playing, whatever its state and whatever the team earned", () => {
    for (const state of [STARTED, FINISHED, null]) {
      expect(isPlayingChampionship(withRow(championship({ qual: 4 }, state)), false)).toBe(true);
      expect(isPlayingChampionship(withRow(championship({ alliance: 4 }, state)), false)).toBe(true);
      expect(isPlayingChampionship(withRow(championship({ elim: 4 }, state), { qualifyingAwards: [AWARD_ONLY("a")] }), false)).toBe(true);
    }
  });

  it("case 2: a row with award points and no playing points is not playing through that row, even while qualification is open", () => {
    for (const state of [STARTED, UNSTARTED, FINISHED, null]) {
      expect(isPlayingChampionship(withRow(championship({ award: 10 }, state)), true)).toBe(false);
      expect(isPlayingChampionship(withRow(championship({ award: 10 }, state)), false)).toBe(false);
    }
  });

  it("case 3: an all zero row whose qualification is not finished reads as points not yet reported, exactly as a remainingEvents entry does", () => {
    // An absent state block counts as not finished.
    for (const state of [STARTED, UNSTARTED, null]) {
      const empty = withRow(championship({}, state));
      const emptyInvitee = withRow(championship({}, state), { qualifyingAwards: [AWARD_ONLY("a")] });
      // The same team entered through remainingEvents instead: the two must agree in every arm.
      const ahead = one({ remainingEvents: [championshipAhead(state)] });
      const aheadInvitee = one({ remainingEvents: [championshipAhead(state)], qualifyingAwards: [AWARD_ONLY("a")] });

      expect(isPlayingChampionship(empty, true)).toBe(true);
      expect(isPlayingChampionship(empty, false)).toBe(true);
      expect(isPlayingChampionship(emptyInvitee, true)).toBe(true);
      expect(isPlayingChampionship(emptyInvitee, false)).toBe(false);

      expect(isPlayingChampionship(empty, true)).toBe(isPlayingChampionship(ahead, true));
      expect(isPlayingChampionship(empty, false)).toBe(isPlayingChampionship(ahead, false));
      expect(isPlayingChampionship(emptyInvitee, true)).toBe(isPlayingChampionship(aheadInvitee, true));
      expect(isPlayingChampionship(emptyInvitee, false)).toBe(isPlayingChampionship(aheadInvitee, false));
    }
    // An award only entry from an event that is not one of the team's district tier events does not make it an invitee.
    expect(isPlayingChampionship(withRow(championship({}, STARTED), { qualifyingAwards: [AWARD_ONLY(CMP)] }), false)).toBe(true);
  });

  it("case 4: an all zero row whose qualification has finished is not playing through that row", () => {
    for (const state of [QUAL_DONE, FINISHED]) {
      expect(isPlayingChampionship(withRow(championship({}, state)), true)).toBe(false);
      expect(isPlayingChampionship(withRow(championship({}, state)), false)).toBe(false);
    }
  });

  it("a second championship row cannot undo a row that shows the team playing or still waiting on points", () => {
    const awardRow = { ...championship({ award: 10 }, FINISHED), eventKey: "cmpfinals" };
    expect(isPlayingChampionship(one({ eventPoints: [played("a", 40), awardRow, championship({}, STARTED)] }), true)).toBe(true);
    expect(isPlayingChampionship(one({ eventPoints: [played("a", 40), championship({}, STARTED), awardRow] }), true)).toBe(true);
    expect(isPlayingChampionship(one({ eventPoints: [played("a", 40), awardRow, championship({ qual: 4 }, STARTED)] }), false)).toBe(true);
  });

  it("at Live, a championship under way with empty rows shows no team Declined and no late entry Locked out", () => {
    const artifact = artifactOf(
      [
        // Earned a place, row published empty.
        team("frc1", { pointTotal: 100, eventPoints: [played("a", 100), championship({}, STARTED)] }),
        team("frc2", { pointTotal: 90, eventPoints: [played("a", 90), championship({}, STARTED)] }),
        // A late entry from below the line, row published empty.
        team("frc3", { pointTotal: 10, eventPoints: [played("a", 10), championship({}, STARTED)] }),
        // An award only invitee, row published empty: attends, does not play.
        team("frc4", { pointTotal: 5, eventPoints: [played("a", 5), championship({}, STARTED)], qualifyingAwards: [AWARD_ONLY("a")] }),
        // Not entered.
        team("frc5", { pointTotal: 1, eventPoints: [played("a", 1)] }),
      ],
      { dcmpSlots: 2 }
    );
    const raw = rawFor(artifact);
    expect(["frc1", "frc2", "frc3", "frc4", "frc5"].map((teamKey) => raw.byTeam.get(teamKey)?.verdict)).toEqual([
      "locked",
      "locked",
      "eliminated",
      "eliminated",
      "eliminated",
    ]);
    const shown = applyChampionshipFieldOverlay(raw, artifact, { atLive: true });
    expect(shown.fieldOverlay).toBe(true);
    expect(["frc1", "frc2", "frc3", "frc4", "frc5"].map((teamKey) => shown.byTeam.get(teamKey)?.status)).toEqual([
      "locked",
      "locked",
      "locked",
      "lockedOut",
      "lockedOut",
    ]);
    expect(shown.counts).toEqual({ prequalified: 0, locked: 3, declined: 0, inRange: 0, outOfRange: 0, lockedOut: 2 });
  });
});

describe("O5: the committed 2026 PNW fixture", () => {
  const FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse(
    JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8"))
  );

  /** The fixture with a finished state on EVERY eventPoints entry: what a republished artifact carries once the season is over. */
  const FINISHED_FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((source) => ({ ...source, eventPoints: source.eventPoints.map((entry) => ({ ...entry, state: FINISHED })) })),
  });

  it("as committed the overlay is inactive at Live: the fixture has no state blocks, so its championship reads not started", () => {
    expect(FIXTURE.teams.every((source) => source.eventPoints.every((entry) => entry.state === undefined))).toBe(true);
    expect(championshipHasStarted(FIXTURE)).toBe(false);
    const raw = rawFor(FIXTURE);
    const shown = applyChampionshipFieldOverlay(raw, FIXTURE, { atLive: true });
    expect(shown.fieldOverlay).toBe(false);
    expect(shown.byTeam).toBe(raw.byTeam);
  });

  it("has no championship row that is all zero, so the points not yet reported rule cannot move a finished pin", () => {
    const allZero = FIXTURE.teams.flatMap((source) =>
      source.eventPoints.filter((entry) => entry.tier === "dcmp" && entry.qual + entry.alliance + entry.elim + entry.award === 0)
    );
    expect(allZero).toEqual([]);
  });

  it("with a finished state everywhere, the Live view shows 50 Locked (8 by award), 0 Declined, 76 Locked out", () => {
    const raw = rawFor(FINISHED_FIXTURE);
    expect(raw.verdictCensus).toMatchObject({ locked: 42, lockedAward: 8, eliminated: 76, contending: 0 });
    const shown = applyChampionshipFieldOverlay(raw, FINISHED_FIXTURE, { atLive: true });
    expect(shown.fieldOverlay).toBe(true);
    expect(shown.counts).toEqual({ prequalified: 0, locked: 50, declined: 0, inRange: 0, outOfRange: 0, lockedOut: 76 });
    expect([...shown.byTeam.values()].filter((result) => result.byAward)).toHaveLength(8);
  });

  it("with one raw locked team's championship entry removed, it shows 49, 1 and 76, and that team is the Declined one", () => {
    const rawBefore = rawFor(FINISHED_FIXTURE);
    const gaveUp = FINISHED_FIXTURE.teams.find(
      (source) => rawBefore.byTeam.get(source.teamKey)?.verdict === "locked" && source.eventPoints.some((entry) => entry.tier === "dcmp")
    )!;
    const championshipTotal = gaveUp.eventPoints.filter((entry) => entry.tier === "dcmp").reduce((sum, entry) => sum + entry.total, 0);
    expect(championshipTotal).toBeGreaterThan(0);

    const artifact = DistrictArtifactSchema.parse({
      ...FINISHED_FIXTURE,
      teams: FINISHED_FIXTURE.teams.map((source) =>
        source.teamKey === gaveUp.teamKey
          ? { ...source, pointTotal: source.pointTotal - championshipTotal, eventPoints: source.eventPoints.filter((entry) => entry.tier !== "dcmp") }
          : source
      ),
    });
    const raw = rawFor(artifact);
    // The raw guarantee does not move: the floor never held those points.
    expect(raw.byTeam.get(gaveUp.teamKey)?.verdict).toBe("locked");
    const shown = applyChampionshipFieldOverlay(raw, artifact, { atLive: true });
    expect(shown.counts).toEqual({ prequalified: 0, locked: 49, declined: 1, inRange: 0, outOfRange: 0, lockedOut: 76 });
    const declined = [...shown.byTeam.values()].filter((result) => result.status === "declined").map((result) => result.teamKey);
    expect(declined).toEqual([gaveUp.teamKey]);
    expect(shown.byTeam.get(gaveUp.teamKey)?.verdict).toBe("locked");
  });
});
