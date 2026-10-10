/**
 * Coverage for `districtRankingsMerge.ts` — the one shared producer of the
 * merged district shape. The first test in this file is the TRACER: a real
 * published-shape district artifact plus a real TBA-shaped rankings payload
 * go through `applyDistrictRankings` and come out as a schema-valid artifact
 * with recomputed verdicts. Everything after it is a refusal, a
 * carry-forward, or a never-invent-metadata pin.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { districtEventCategoryFinality } from "../core/districts/reservedSlots.js";
import { DistrictArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type DistrictArtifact } from "./pageArtifacts.js";
import {
  applyDistrictEventAwards,
  applyDistrictEventState,
  applyDistrictRankings,
  DistrictMergeError,
  DistrictRankingsEventPointsEntrySchema,
  DistrictRankingsPayloadSchema,
  DistrictRankingsRowSchema,
  publishedCategoryFinality,
  recomputeDistrictVerdicts,
  type DistrictEventAwardInput,
} from "./districtRankingsMerge.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const GENERATION = "gen-merge-test";
const COMPUTED_AT = "2026-03-14T12:00:00.000Z";

/** 2026 district-tier event maximum: 22 + 16 + 30 + 15. */
const DISTRICT_EVENT_MAX = 83;
/** 2026 dcmp-tier event maximum: three times the district tier. */
const DCMP_EVENT_MAX = 249;
/** 2026 district-tier category ceilings for the playoffs and the awards. */
const DISTRICT_ELIM_MAX = 30;
const DISTRICT_AWARD_MAX = 15;

function lockVerdict(status: DistrictArtifact["teams"][number]["districtLock"]["status"]) {
  return { status, pointsToLock: null as number | null, threatCount: 0, cutLinePoints: null as number | null, allocationNote: null as string | null };
}

/** `2026ncwak`: over, awards posted. Nothing is reserved for it. */
const WAK_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } as const;

/**
 * `2026ncpem`: played out, Impact award NOT posted yet. This is the exact
 * shape that made quick task 260925-ma5's thirteen tenet-A violations, so the
 * fixture carries it deliberately: one points slot is held back here.
 */
const PEM_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: false } as const;

/**
 * Two teams, one played event each, one event still ahead for `frc1` only.
 * `frc1`'s `districtLock.status` is deliberately WRONG (`"contending"` when
 * the merge will recompute `"locked"`) so a carried-over verdict fails
 * loudly rather than passing by accident.
 *
 * TWO DCMP SLOTS, not one, because `2026ncpem`'s Impact award is not posted
 * and 260925-ms7 holds one slot back for it: with a single slot there would be
 * no points slot left for anybody to lock into, and the recomputed-verdict
 * assertion below would pass for the wrong reason.
 */
function twoTeamFixture(): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-published",
    computedAt: "2026-03-01T00:00:00.000Z",
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 2,
    cmpSlots: 1,
    teams: [
      {
        teamKey: "frc1",
        teamNumber: 1,
        nickname: "The Juggernauts",
        rank: 1,
        pointTotal: 40,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: "2026ncwak", eventName: "Wake County Event", week: 1, tier: "district", qual: 20, alliance: 10, elim: 5, award: 5, total: 40, state: { ...WAK_STATE } }],
        remainingEvents: [{ eventKey: "2026ncpem", eventName: "Pembroke Event", week: 3, tier: "district", maxPoints: DISTRICT_EVENT_MAX, state: { ...PEM_STATE } }],
        maxRemainingDistrict: DISTRICT_EVENT_MAX,
        maxRemainingChamp: DISTRICT_EVENT_MAX + DCMP_EVENT_MAX,
        qualifyingAwards: [{ eventKey: "2026ncwak", awardType: 9, label: "Engineering Inspiration", awardOnly: true }],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
      {
        teamKey: "frc2",
        teamNumber: 2,
        nickname: "Mechanical Bulls",
        rank: 2,
        pointTotal: 30,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: "2026ncwak", eventName: "Wake County Event", week: 1, tier: "district", qual: 15, alliance: 8, elim: 2, award: 5, total: 30, state: { ...WAK_STATE } }],
        remainingEvents: [],
        maxRemainingDistrict: 0,
        maxRemainingChamp: DCMP_EVENT_MAX,
        qualifyingAwards: [],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
    ],
    insights: {
      teamCount: 2,
      eventCount: 3,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 40,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

/**
 * One rankings entry. `proof` moves part of the total out of qualification
 * and into alliance and playoff points, so the row can PROVE those two
 * categories are in (quick task 261009-vp9: a category's number is final only
 * once its points are in). The total is unchanged.
 */
function eventPointsEntry(eventKey: string, total: number, districtCmp = false, proof: { alliance: number; elim: number } = { alliance: 0, elim: 0 }) {
  return {
    event_key: eventKey,
    district_cmp: districtCmp,
    qual_points: total - proof.alliance - proof.elim,
    alliance_points: proof.alliance,
    elim_points: proof.elim,
    award_points: 0,
    total,
  };
}

/**
 * `frc1` played `2026ncpem` for 50 more points; `frc2` is unchanged.
 *
 * The 50 are 10 qualification, 10 alliance and the winner's 30 playoff
 * points: `2026ncpem`'s state says its playoffs are done, and this fixture
 * means "everything but the awards is in", so its row carries the points
 * that prove it (quick task 261009-vp9).
 */
function tracerPayload() {
  return [
    {
      team_key: "frc1",
      rank: 1,
      point_total: 90,
      rookie_bonus: 0,
      adjustments: 0,
      event_points: [eventPointsEntry("2026ncwak", 40), eventPointsEntry("2026ncpem", 50, false, { alliance: 10, elim: DISTRICT_ELIM_MAX })],
    },
    {
      team_key: "frc2",
      rank: 2,
      point_total: 30,
      rookie_bonus: 0,
      adjustments: 0,
      event_points: [eventPointsEntry("2026ncwak", 30)],
    },
  ];
}

function merge(artifact: DistrictArtifact, rankings: unknown) {
  return applyDistrictRankings({ artifact, rankings, generation: GENERATION, computedAt: COMPUTED_AT });
}

describe("applyDistrictRankings — the tracer: a TBA rankings payload becomes an updated published district artifact", () => {
  it("merges a real payload into a real artifact and returns a schema-valid artifact with recomputed verdicts", () => {
    const artifact = twoTeamFixture();
    const merged = merge(artifact, tracerPayload());

    // 1. The RESULT re-parses through the published schema.
    expect(() => DistrictArtifactSchema.parse(merged)).not.toThrow();

    const teamA = merged.teams.find((t) => t.teamKey === "frc1")!;

    // 2. Team A's point total moved.
    expect(teamA.pointTotal).toBe(90);
    // 3. Its new event appears in eventPoints.
    expect(teamA.eventPoints.map((e) => e.eventKey)).toEqual(["2026ncwak", "2026ncpem"]);
    // 4. That event is gone from its remainingEvents.
    expect(teamA.remainingEvents).toEqual([]);
    // 5. maxRemainingDistrict dropped by that event's ceiling, less the one
    //    category still open there. `2026ncpem`'s state says its playoffs are
    //    done and its awards are not posted, so its award ceiling (15) is
    //    still ahead of frc1 (quick task 261009-tx6).
    expect(artifact.teams[0]!.maxRemainingDistrict - teamA.maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX - DISTRICT_AWARD_MAX);
    expect(teamA.maxRemainingDistrict).toBe(DISTRICT_AWARD_MAX);
    // 6. districtLock.status was RECOMPUTED, not carried over.
    expect(artifact.teams[0]!.districtLock.status).toBe("contending");
    expect(teamA.districtLock.status).toBe("locked");
  });

  it("stamps the caller's generation and computedAt, never a clock inside the module", () => {
    const merged = merge(twoTeamFixture(), tracerPayload());
    expect(merged.generation).toBe(GENERATION);
    expect(merged.computedAt).toBe(COMPUTED_AT);
  });
});

describe("applyDistrictRankings — refusals", () => {
  it("throws DistrictMergeError for an empty rankings payload rather than blanking a published district", () => {
    expect(() => merge(twoTeamFixture(), [])).toThrow(DistrictMergeError);
    expect(() => merge(twoTeamFixture(), [])).toThrow(/2026fnc/);
  });

  it("throws DistrictMergeError for a duplicated team_key", () => {
    const payload = tracerPayload();
    payload.push({ ...payload[0]!, rank: 3 });
    expect(() => merge(twoTeamFixture(), payload)).toThrow(DistrictMergeError);
    expect(() => merge(twoTeamFixture(), payload)).toThrow(/frc1/);
  });
});

describe("applyDistrictRankings — never invents metadata", () => {
  it("carries a rankings row for a team absent from the artifact with no teamNumber, no nickname, no awards and no remaining events", () => {
    const payload = tracerPayload();
    payload.push({ team_key: "frc9999", rank: 3, point_total: 5, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry("2026ncwak", 5)] });
    const merged = merge(twoTeamFixture(), payload);

    const newcomer = merged.teams.find((t) => t.teamKey === "frc9999")!;
    expect(newcomer.teamNumber).toBeUndefined();
    expect(newcomer.nickname).toBeUndefined();
    expect(newcomer.qualifyingAwards).toEqual([]);
    expect(newcomer.remainingEvents).toEqual([]);
  });

  it("gives an event_points entry for an unknown event key the event key as its name, a null week, and its tier from its OWN district_cmp boolean", () => {
    const payload = tracerPayload();
    payload[0]!.event_points.push(eventPointsEntry("2026ncmys", 10, true));
    const merged = merge(twoTeamFixture(), payload);

    const row = merged.teams[0]!.eventPoints.find((e) => e.eventKey === "2026ncmys")!;
    expect(row.eventName).toBe("2026ncmys");
    expect(row.week).toBeNull();
    expect(row.tier).toBe("dcmp");
  });

  it("keeps a team present in the artifact but absent from the payload unchanged, and still counts it in the lock math", () => {
    const payload = [tracerPayload()[0]!];
    const merged = merge(twoTeamFixture(), payload);

    const teamB = merged.teams.find((t) => t.teamKey === "frc2")!;
    expect(teamB.pointTotal).toBe(30);
    expect(teamB.eventPoints).toEqual(twoTeamFixture().teams[1]!.eventPoints);
    expect(merged.teams).toHaveLength(2);
    // frc2's floor of 30 is below frc1's, so frc1 locks; frc2 itself is the
    // threat that would have been silently dropped had it not been carried.
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.districtLock.threatCount).toBe(0);
  });
});

describe("applyDistrictRankings — carry-forward", () => {
  it("carries qualifyingAwards and every district-level field forward byte-identically", () => {
    const artifact = twoTeamFixture();
    const merged = merge(artifact, tracerPayload());

    expect(merged.teams[0]!.qualifyingAwards).toEqual(artifact.teams[0]!.qualifyingAwards);
    expect(merged.teams[0]!.teamNumber).toBe(1);
    expect(merged.teams[0]!.nickname).toBe("The Juggernauts");
    expect(merged.abbreviation).toBe(artifact.abbreviation);
    expect(merged.displayName).toBe(artifact.displayName);
    expect(merged.dcmpSlots).toBe(artifact.dcmpSlots);
    expect(merged.cmpSlots).toBe(artifact.cmpSlots);
    expect(merged.year).toBe(artifact.year);
    expect(merged.districtKey).toBe(artifact.districtKey);
  });

  it("carries eventName and week for a known event key from the artifact's own rows", () => {
    const merged = merge(twoTeamFixture(), tracerPayload());
    const played = merged.teams[0]!.eventPoints.find((e) => e.eventKey === "2026ncpem")!;
    // 2026ncpem appeared only in remainingEvents before the merge.
    expect(played.eventName).toBe("Pembroke Event");
    expect(played.week).toBe(3);
  });
});

describe("applyDistrictRankings — the baked-pmf sidecar list", () => {
  it("drops an event key from bakedEvents as soon as ANY team reports points for it", () => {
    const artifact = DistrictArtifactSchema.parse({ ...twoTeamFixture(), bakedEvents: ["2026ncpem", "2026ncmys"] });
    const merged = merge(artifact, tracerPayload());
    // frc1 played 2026ncpem, so its baked pmf is stale by definition.
    expect(merged.bakedEvents).toEqual(["2026ncmys"]);
  });

  it("leaves bakedEvents absent when the artifact carries none — never invents an empty list", () => {
    const merged = merge(twoTeamFixture(), tracerPayload());
    expect(merged.bakedEvents).toBeUndefined();
  });

  it("carries an awardProfile forward untouched, priorJudgedAwards and priorImpactWins included", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<Record<string, unknown>> };
    fixture.teams[0]!.awardProfile = { bucket: "oneOrTwo", rookie: false, priorJudgedAwards: 2, priorImpactWins: 1 };
    const merged = merge(DistrictArtifactSchema.parse(fixture), tracerPayload());
    // The ordering key has to survive the live merge: a Worker tick that
    // dropped it would silently take every promoted event off the ordering path
    // and back onto the base rate, and nothing on the page would say so.
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.awardProfile).toEqual({
      bucket: "oneOrTwo",
      rookie: false,
      priorJudgedAwards: 2,
      priorImpactWins: 1,
    });
  });

  it("carries a top-level awardBaseRates table forward untouched", () => {
    const table = {
      season: 2026,
      measuredThroughSeason: 2025,
      script: "scripts/measureDistrictAwardBaseRates.ts",
      rows: [{ bucket: "none" as const, rookie: false, n: 500, points: { o: 0, p: [0.8, 0.2] } }],
    };
    const merged = merge(DistrictArtifactSchema.parse({ ...twoTeamFixture(), awardBaseRates: table }), tracerPayload());
    expect(merged.awardBaseRates).toEqual(table);
  });

  it("carries a top-level awardOrderingTables block forward untouched", () => {
    const tables = {
      season: 2026,
      measuredThroughSeason: 2025,
      script: "scripts/measureAwardOrderingTables.ts",
      impact: [{ position: 1, n: 756, p: 0.1799 }],
      impactTail: { n: 18146, p: 0.0056 },
      rookieAllStar: [{ position: 1, n: 645, p: 0.3814 }],
      rookieAllStarTail: { n: 559, p: 0.1163 },
      residual: [{ bucket: "none" as const, rookie: false, n: 500, points: { o: 0, p: [0.8, 0.2] } }],
    };
    const merged = merge(DistrictArtifactSchema.parse({ ...twoTeamFixture(), awardOrderingTables: tables }), tracerPayload());
    expect(merged.awardOrderingTables).toEqual(tables);
  });
});

describe("recomputeDistrictVerdicts — one points slot held back per award still to come (260925-ms7)", () => {
  /** The merged tracer artifact, with `2026ncpem`'s award posted or not on every row that carries it. */
  function mergedWithPemAwards(awardsPosted: boolean): DistrictArtifact {
    const merged = merge(twoTeamFixture(), tracerPayload()) as unknown as {
      teams: { eventPoints: { eventKey: string; state?: { awardsPosted: boolean } }[]; remainingEvents: { eventKey: string; state?: { awardsPosted: boolean } }[] }[];
    };
    for (const team of merged.teams) {
      for (const row of [...team.eventPoints, ...team.remainingEvents]) {
        if (row.eventKey === "2026ncpem" && row.state !== undefined) row.state.awardsPosted = awardsPosted;
      }
    }
    return recomputeDistrictVerdicts(DistrictArtifactSchema.parse(merged));
  }

  it("locks one FEWER team while an Impact award is still to come, and the same district with that award posted locks both", () => {
    const pending = mergedWithPemAwards(false);
    const posted = mergedWithPemAwards(true);

    // Two DCMP slots, no consuming district award won by either team (frc1's
    // Engineering Inspiration is an award-only invite at this tier). With
    // 2026ncpem's Impact still to come one slot is held back, so only the top
    // team can be guaranteed; once it is posted both are.
    expect(pending.teams.map((t) => t.districtLock.status)).toEqual(["locked", "contending"]);
    expect(posted.teams.map((t) => t.districtLock.status)).toEqual(["locked", "locked"]);
    expect(pending.insights.districtLockedCount).toBe(1);
    expect(posted.insights.districtLockedCount).toBe(2);
  });

  it("leaves the published cut line and the eliminated count untouched by the reservation", () => {
    const pending = mergedWithPemAwards(false);
    const posted = mergedWithPemAwards(true);

    // The cut line and the elimination test read the UNRESERVED slot count on
    // purpose: the pending award's winner is still in the pool competing, so
    // withholding the slot AND counting the rival would price one award twice.
    expect(pending.insights.dcmpCutLinePoints).toBe(posted.insights.dcmpCutLinePoints);
    expect(pending.insights.districtEliminatedCount).toBe(posted.insights.districtEliminatedCount);
    expect(pending.teams.every((t) => t.districtLock.cutLinePoints === posted.insights.dcmpCutLinePoints)).toBe(true);
  });

  it("reserves nothing for an event that never happened once every other event in the district has finished", () => {
    // A registered, never played, never awarded event: no schedule, nothing
    // started, and the only other event of the district already finished. A
    // slot held back for it would never be released, so nothing is held back.
    const base = merge(twoTeamFixture(), tracerPayload()) as unknown as {
      teams: { eventPoints: { eventKey: string; state?: unknown }[]; remainingEvents: unknown[] }[];
    };
    for (const team of base.teams) {
      for (const row of team.eventPoints) {
        if (row.eventKey === "2026ncpem") row.state = { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
      }
    }
    const cancelled = recomputeDistrictVerdicts(DistrictArtifactSchema.parse(base));
    expect(cancelled.insights.districtLockedCount).toBe(2);
  });
});

describe("recomputeDistrictVerdicts — the champ tier holds back the DCMP's own qualifications (261006-3gg)", () => {
  const champLocked = (artifact: DistrictArtifact): number => artifact.teams.filter((t) => t.champLock.status === "locked").length;

  it("reserves a whole open championship for a current season with no DCMP row yet, so nobody locks on points into its single slot", () => {
    // `frc2` has 30 points and nothing left to play; `frc1` has 40 and one
    // event ahead. With cmpSlots 1 and no reservation one of them could lock.
    expect(champLocked(recomputeDistrictVerdicts(twoTeamFixture(), { nowYear: 2026 }))).toBe(0);
  });

  it("reserves nothing for a past season whose championship never happened, so the ordinary points math stands", () => {
    // Neither team can lock into one slot while the other's ceiling reaches
    // its floor, so the STATUSES agree either way; `pointsToLock` is what
    // tells the two slot counts apart. With every slot held back no number of
    // points can lock (`null`); with the reservation gone `frc1` locks once it
    // clears `frc2`'s 30 + 249 ceiling: 240 more points.
    const current = recomputeDistrictVerdicts(twoTeamFixture(), { nowYear: 2026 });
    const past = recomputeDistrictVerdicts(twoTeamFixture(), { nowYear: 2027 });
    expect(current.teams.map((t) => t.champLock.pointsToLock)).toEqual([null, null]);
    expect(past.teams.find((t) => t.teamKey === "frc1")!.champLock.pointsToLock).toBe(240);
    expect(past.teams.map((t) => t.champLock.status)).toEqual(current.teams.map((t) => t.champLock.status));
  });

  it("reserves nothing once the DCMP has posted its awards, playoffs flag or not, and leaves the champ cut line on the unreserved count either way", () => {
    const base = twoTeamFixture();
    const withDcmp = (state: { playoffsDone: boolean; awardsPosted: boolean }): DistrictArtifact =>
      DistrictArtifactSchema.parse({
        ...base,
        teams: base.teams.map((team) => ({
          ...team,
          remainingEvents: [
            ...team.remainingEvents,
            { eventKey: "2026nccmp", eventName: "FNC District Championship", week: 6, tier: "dcmp", maxPoints: DCMP_EVENT_MAX, state: { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, ...state } },
          ],
        })),
      });
    const open = recomputeDistrictVerdicts(withDcmp({ playoffsDone: false, awardsPosted: false }), { nowYear: 2026 });
    const playoffsDone = recomputeDistrictVerdicts(withDcmp({ playoffsDone: true, awardsPosted: false }), { nowYear: 2026 });
    const posted = recomputeDistrictVerdicts(withDcmp({ playoffsDone: false, awardsPosted: true }), { nowYear: 2026 });
    const pointsToLock = (artifact: DistrictArtifact): (number | null)[] => artifact.teams.map((t) => t.champLock.pointsToLock);
    expect(champLocked(open)).toBe(0);
    expect(champLocked(playoffsDone)).toBe(0);
    expect(pointsToLock(open)).toEqual([null, null]);
    expect(pointsToLock(playoffsDone)).toEqual([null, null]);
    expect(pointsToLock(posted)).toEqual([240, null]);
    expect(open.insights.cmpCutLinePoints).toEqual(posted.insights.cmpCutLinePoints);
  });
});

describe("recomputeDistrictVerdicts", () => {
  it("reports every champLock as unknown with the note for a district carrying the 2025fsc special allocation", () => {
    const base = twoTeamFixture();
    const fsc = DistrictArtifactSchema.parse({ ...base, districtKey: "2025fsc", year: 2025, abbreviation: "fsc", displayName: "FIRST South Carolina" });
    const merged = recomputeDistrictVerdicts(fsc);

    for (const team of merged.teams) {
      expect(team.champLock.status).toBe("unknown");
      expect(team.champLock.allocationNote).toBe("special allocation, not modeled");
      expect(team.champLock.cutLinePoints).toBeNull();
    }
    expect(merged.insights.cmpCutLinePoints).toBeNull();
  });

  it("rebuilds insights' four counts from the verdicts it just produced, never a stale carry-over", () => {
    const merged = merge(twoTeamFixture(), tracerPayload());
    const districtLocked = merged.teams.filter((t) => t.districtLock.status === "locked").length;
    const districtEliminated = merged.teams.filter((t) => t.districtLock.status === "eliminated").length;
    const champLocked = merged.teams.filter((t) => t.champLock.status === "locked").length;
    const champEliminated = merged.teams.filter((t) => t.champLock.status === "eliminated").length;

    expect(merged.insights.districtLockedCount).toBe(districtLocked);
    expect(merged.insights.districtEliminatedCount).toBe(districtEliminated);
    expect(merged.insights.champLockedCount).toBe(champLocked);
    expect(merged.insights.champEliminatedCount).toBe(champEliminated);
    // The fixture's stale zeros must have moved.
    expect(merged.insights.districtLockedCount).toBeGreaterThan(0);
    expect(merged.insights.teamCount).toBe(merged.teams.length);
    // eventCount has no corpus-free source, so it rides forward untouched.
    expect(merged.insights.eventCount).toBe(3);
  });
});

describe("applyDistrictEventState — the write path for a category that finished without moving a point total", () => {
  const observed = { qualMatchesPlayed: 72, qualMatchesTotal: 72, alliancesPicked: true, playoffsDone: false, awardsPosted: false };

  function applyState(eventKey: string, artifact = twoTeamFixture()) {
    return applyDistrictEventState({ artifact, eventState: new Map([[eventKey, observed]]), generation: GENERATION, computedAt: COMPUTED_AT });
  }

  it("sets the state block on the matching rows across EVERY team", () => {
    const updated = applyState("2026ncwak");
    for (const team of updated.teams) {
      expect(team.eventPoints.find((row) => row.eventKey === "2026ncwak")!.state).toEqual(observed);
    }
  });

  it("writes onto a remainingEvents row too — an event in progress has no points yet and still lives there", () => {
    const updated = applyState("2026ncpem");
    expect(updated.teams[0]!.remainingEvents[0]!.state).toEqual(observed);
  });

  it("leaves pointTotal and rank untouched, raises both ceilings by the two categories the observation reopened, and leaves the verdicts at the recompute's fixed point", () => {
    // The fixture's verdicts are hand-written stubs; a published artifact is
    // already at the recompute's fixed point, so that is the reference here.
    const artifact = recomputeDistrictVerdicts(twoTeamFixture());
    const updated = applyState("2026ncwak", artifact);
    // The observation says 2026ncwak's playoffs and awards are still open, and
    // both teams have a points row there, so each ceiling gains those two
    // category ceilings (quick task 261009-tx6). Before that task a played
    // row added nothing and both ceilings were untouched here.
    const reopened = DISTRICT_ELIM_MAX + DISTRICT_AWARD_MAX;
    for (const [index, team] of updated.teams.entries()) {
      const before = artifact.teams[index]!;
      expect(team.pointTotal).toBe(before.pointTotal);
      expect(team.rank).toBe(before.rank);
      expect(team.maxRemainingDistrict).toBe(before.maxRemainingDistrict + reopened);
      expect(team.maxRemainingChamp).toBe(before.maxRemainingChamp + reopened);
    }
    // Idempotent: running the pass again over the state-carrying rows changes nothing.
    const again = recomputeDistrictVerdicts(updated);
    expect(updated.teams.map((t) => [t.districtLock, t.champLock])).toEqual(again.teams.map((t) => [t.districtLock, t.champLock]));
    expect(updated.insights).toEqual(again.insights);
    // And the observation is NOT inert. With no state block a points row reads
    // as a finished event; this observation says 2026ncwak's playoffs and awards
    // are still ahead, so the rival can still earn them and the leader's lock
    // correctly loosens to contending.
    expect(artifact.teams[0]!.districtLock.status).toBe("locked");
    expect(updated.teams[0]!.districtLock.status).toBe("contending");
  });

  it("stamps the caller's generation and computedAt and returns a schema-parsed artifact", () => {
    const updated = applyState("2026ncwak");
    expect(updated.generation).toBe(GENERATION);
    expect(updated.computedAt).toBe(COMPUTED_AT);
    expect(() => DistrictArtifactSchema.parse(updated)).not.toThrow();
  });

  it("throws DistrictMergeError for an event key no team in the artifact carries — a state observation for an event outside the district is a caller bug, not a silent no-op", () => {
    expect(() => applyState("2026zzzzz")).toThrow(DistrictMergeError);
    expect(() => applyState("2026zzzzz")).toThrow(/2026zzzzz/);
  });
});

describe("the payload schemas", () => {
  it("DistrictRankingsEventPointsEntrySchema carries the seven TBA fields", () => {
    expect(() => DistrictRankingsEventPointsEntrySchema.parse(eventPointsEntry("2026ncwak", 40))).not.toThrow();
    const { district_cmp: _dropped, ...withoutTier } = eventPointsEntry("2026ncwak", 40);
    expect(() => DistrictRankingsEventPointsEntrySchema.parse(withoutTier)).toThrow();
  });

  it("DistrictRankingsRowSchema and DistrictRankingsPayloadSchema parse a real payload", () => {
    expect(() => DistrictRankingsRowSchema.parse(tracerPayload()[0])).not.toThrow();
    expect(() => DistrictRankingsPayloadSchema.parse(tracerPayload())).not.toThrow();
  });
});

describe("DistrictEventStateSchema round-trip on the published artifact", () => {
  const state = { qualMatchesPlayed: 8, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

  it("accepts a state block on an eventPoints row and on a remainingEvents row", () => {
    const fixture = twoTeamFixture() as unknown as {
      teams: Array<{ eventPoints: Array<Record<string, unknown>>; remainingEvents: Array<Record<string, unknown>> }>;
    };
    fixture.teams[0]!.eventPoints[0]!.state = state;
    fixture.teams[0]!.remainingEvents[0]!.state = { ...state, qualMatchesPlayed: 0, qualMatchesTotal: null };
    expect(() => DistrictArtifactSchema.parse(fixture)).not.toThrow();
  });

  it("rejects a state whose qualMatchesPlayed exceeds a non-null qualMatchesTotal", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<{ eventPoints: Array<Record<string, unknown>> }> };
    fixture.teams[0]!.eventPoints[0]!.state = { ...state, qualMatchesPlayed: 13, qualMatchesTotal: 12 };
    expect(() => DistrictArtifactSchema.parse(fixture)).toThrow();
  });

  it("accepts a null qualMatchesTotal — the honest answer for an event whose schedule TBA has not published", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<{ eventPoints: Array<Record<string, unknown>> }> };
    fixture.teams[0]!.eventPoints[0]!.state = { ...state, qualMatchesPlayed: 4, qualMatchesTotal: null };
    expect(() => DistrictArtifactSchema.parse(fixture)).not.toThrow();
  });

  it("accepts a row with no state at all — the pre-republish shape", () => {
    expect(() => DistrictArtifactSchema.parse(twoTeamFixture())).not.toThrow();
  });

  it("carries an existing state block forward through a merge when the caller supplies none", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<{ eventPoints: Array<Record<string, unknown>> }> };
    fixture.teams[0]!.eventPoints[0]!.state = state;
    const merged = merge(DistrictArtifactSchema.parse(fixture), tracerPayload());
    expect(merged.teams[0]!.eventPoints.find((e) => e.eventKey === "2026ncwak")!.state).toEqual(state);
  });

  it("writes the caller's eventState onto the matching rows when one is supplied", () => {
    const artifact = twoTeamFixture();
    const merged = applyDistrictRankings({
      artifact,
      rankings: tracerPayload(),
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      eventState: new Map([["2026ncpem", { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true }]]),
    });
    expect(merged.teams[0]!.eventPoints.find((e) => e.eventKey === "2026ncpem")!.state).toEqual({
      qualMatchesPlayed: 60,
      qualMatchesTotal: 60,
      alliancesPicked: true,
      playoffsDone: true,
      awardsPosted: true,
    });
  });
});

describe("applyDistrictRankings — a payload-only team's ceiling errs toward still ahead (WR-01)", () => {
  /** A team in TBA's rankings payload that the published artifact has never seen. */
  function withNewcomer(pointTotal: number) {
    const payload = tracerPayload();
    payload.push({
      team_key: "frc9999",
      rank: 3,
      point_total: pointTotal,
      rookie_bonus: 0,
      adjustments: 0,
      event_points: [eventPointsEntry("2026ncwak", pointTotal)],
    });
    return merge(twoTeamFixture(), payload);
  }

  it("seeds a payload-only team with one district event's own maximum, never zero", () => {
    // Zero is a ceiling equal to the team's current point total. It removes the
    // team as a threat to everyone above it and can mark the team itself
    // eliminated — the outcome this module's header says dropping a team would
    // produce, reached by a different route.
    const newcomer = withNewcomer(5).teams.find((t) => t.teamKey === "frc9999")!;
    expect(newcomer.maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX);
    expect(newcomer.maxRemainingDistrict).toBeGreaterThan(0);
  });

  it("the substituted ceiling rides into the CHAMP ceiling the second pass derives", () => {
    const newcomer = withNewcomer(5).teams.find((t) => t.teamKey === "frc9999")!;
    expect(newcomer.maxRemainingChamp).toBeGreaterThanOrEqual(newcomer.maxRemainingDistrict);
  });

  it("does NOT mark a payload-only team eliminated on its own zeroed ceiling", () => {
    // `frc9999` sits at 50 points against `frc1`'s 90 with the district's one
    // dcmp slot in play. A zeroed ceiling caps it at 50 and reads eliminated;
    // one district event's maximum puts 133 within reach, which is the honest
    // answer for a team whose calendar this function cannot see.
    const newcomer = withNewcomer(50).teams.find((t) => t.teamKey === "frc9999")!;
    expect(newcomer.pointTotal + newcomer.maxRemainingDistrict).toBeGreaterThan(90);
    expect(newcomer.districtLock.status).not.toBe("eliminated");
  });

  it("a payload-only team is still a THREAT, so a rival above it is not handed a premature lock", () => {
    // 90 points against `frc1`'s own 90 with a full district event still
    // available: a zeroed ceiling made this team invisible to the lock math.
    const merged = withNewcomer(90);
    const newcomer = merged.teams.find((t) => t.teamKey === "frc9999")!;
    expect(newcomer.pointTotal + newcomer.maxRemainingDistrict).toBeGreaterThan(
      merged.teams.find((t) => t.teamKey === "frc1")!.pointTotal
    );
  });

  it("a team the artifact DOES carry still sums its own published remaining events, unchanged", () => {
    // The substitution applies only where there is no calendar to read. `frc1`
    // has one remaining event in the fixture and the tracer payload plays it,
    // so its carried sum drops to zero, and nothing is seeded on top. What is
    // left is read from its rows: 2026ncpem's awards are not posted, so that
    // one category's ceiling is still ahead of it (quick task 261009-tx6).
    // `frc2` has no row there and reads zero, a real answer and not a guess.
    const merged = merge(twoTeamFixture(), tracerPayload());
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.maxRemainingDistrict).toBe(DISTRICT_AWARD_MAX);
    expect(merged.teams.find((t) => t.teamKey === "frc2")!.maxRemainingDistrict).toBe(0);
  });
});

describe("the two merge entry points agree on schemaVersion (WR-02)", () => {
  // `districtRefresh.ts` picks between these two on whether TBA answered 200 or
  // 304. A version stamped by one and merely carried by the other makes the
  // published schema version of a live district depend on a cache hit.
  const eventState = new Map([
    [
      "2026ncwak",
      { qualMatchesPlayed: 1, qualMatchesTotal: 1, alliancesPicked: true, playoffsDone: true, awardsPosted: true },
    ],
  ]);

  it("applyDistrictEventState stamps the version rather than carrying the input's", () => {
    // A stale stamp on the way in. Before the fix this reached the closing
    // `DistrictArtifactSchema.parse` unchanged and threw; the producer now owns
    // the field on both paths, so it is overwritten.
    const stale = { ...twoTeamFixture(), schemaVersion: 0 } as unknown as DistrictArtifact;
    const merged = applyDistrictEventState({ artifact: stale, eventState, generation: GENERATION, computedAt: COMPUTED_AT });
    expect(merged.schemaVersion).toBe(PAGE_ARTIFACT_SCHEMA_VERSION);
  });

  it("both entry points write the SAME version over the same district", () => {
    const viaRankings = applyDistrictRankings({
      artifact: twoTeamFixture(),
      rankings: tracerPayload(),
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      eventState,
    });
    const viaState = applyDistrictEventState({
      artifact: twoTeamFixture(),
      eventState,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
    });
    expect(viaState.schemaVersion).toBe(viaRankings.schemaVersion);
    expect(viaState.schemaVersion).toBe(PAGE_ARTIFACT_SCHEMA_VERSION);
  });

  it("recomputes the verdicts with the state attached, so a posted award releases its held back slot (2026-09-26 regression)", () => {
    // A missing state block counts as a PENDING Impact award, and the Locked
    // test holds a slot back for it. Posting the awards must release that slot
    // through the state-only path too: the publisher attaches state through
    // this function AFTER its verdict pass, and shipped eight demotions when
    // this path left the verdicts as found.
    const artifact = twoTeamFixture();
    const posted = { qualMatchesPlayed: 72, qualMatchesTotal: 72, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
    const eventKeys = new Set<string>();
    for (const team of artifact.teams) {
      for (const row of team.eventPoints) eventKeys.add(row.eventKey);
      for (const row of team.remainingEvents) eventKeys.add(row.eventKey);
    }
    const eventState = new Map([...eventKeys].map((key) => [key, posted] as const));
    const viaState = applyDistrictEventState({ artifact, eventState, generation: GENERATION, computedAt: COMPUTED_AT });
    const fresh = recomputeDistrictVerdicts(viaState);
    expect(viaState.teams.map((t) => t.districtLock)).toEqual(fresh.teams.map((t) => t.districtLock));
    expect(viaState.insights).toEqual(fresh.insights);
  });
});

describe("recomputeDistrictVerdicts — the pooled remaining-points lock (260925-pl6)", () => {
  /** `2026ncpem` wholly ahead: scheduled, nothing played, nothing awarded. Its whole four-category pool is still to be handed out. */
  const PEM_AHEAD = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false } as const;

  /**
   * Fifteen teams, twelve DCMP slots, one district event still ahead of every
   * one of them. The leader sits on 100 and every rival on 17, which is exactly
   * one event's maximum below it, so EVERY rival's ceiling reaches the leader's
   * floor and the ceiling test sees fourteen threats against the eleven slots
   * that are not held back for the event's pending Impact award.
   *
   * Eleven rivals would have to pass the leader, costing 11 x 83 = 913 points
   * between them; a fifteen-team event has 754 to hand out.
   */
  function pooledFixture(pemState: Record<string, unknown>): DistrictArtifact {
    const remainingEvents = [{ eventKey: "2026ncpem", eventName: "Pembroke Event", week: 3, tier: "district", maxPoints: DISTRICT_EVENT_MAX, state: { ...pemState } }];
    const teamAt = (index: number, pointTotal: number) => ({
      teamKey: `frc${String(index)}`,
      teamNumber: index,
      nickname: `Team ${String(index)}`,
      rank: index,
      pointTotal,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        {
          eventKey: "2026ncwak",
          eventName: "Wake County Event",
          week: 1,
          tier: "district",
          qual: pointTotal,
          alliance: 0,
          elim: 0,
          award: 0,
          total: pointTotal,
          state: { ...WAK_STATE },
        },
      ],
      remainingEvents,
      maxRemainingDistrict: DISTRICT_EVENT_MAX,
      maxRemainingChamp: DISTRICT_EVENT_MAX + DCMP_EVENT_MAX,
      qualifyingAwards: [],
      districtLock: lockVerdict("contending"),
      champLock: lockVerdict("contending"),
    });

    return DistrictArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-published",
      computedAt: "2026-03-01T00:00:00.000Z",
      districtKey: "2026fnc",
      year: 2026,
      abbreviation: "fnc",
      displayName: "FIRST North Carolina",
      dcmpSlots: 12,
      cmpSlots: 1,
      teams: [teamAt(1, 100), ...Array.from({ length: 14 }, (_, index) => teamAt(index + 2, 17))],
      insights: {
        teamCount: 15,
        eventCount: 2,
        dcmpCutLinePoints: null,
        cmpCutLinePoints: null,
        districtLockedCount: 0,
        districtEliminatedCount: 0,
        champLockedCount: 0,
        champEliminatedCount: 0,
      },
    });
  }

  it("locks a team the ceiling test leaves contending", () => {
    const recomputed = recomputeDistrictVerdicts(pooledFixture(PEM_AHEAD));
    expect(recomputed.teams[0]!.districtLock.status).toBe("locked");
    // Every rival really can reach the leader's floor on its own, which is what
    // makes the shipped ceiling test refuse: fourteen threats, eleven slots.
    expect(recomputed.teams[0]!.districtLock.threatCount).toBe(14);
    expect(recomputed.insights.districtLockedCount).toBe(1);
  });

  it("does not lock that team when a second event leaves enough points on the table", () => {
    const base = pooledFixture(PEM_AHEAD) as unknown as {
      teams: { remainingEvents: unknown[]; maxRemainingDistrict: number }[];
    };
    const second = { eventKey: "2026ncgui", eventName: "Guilford Event", week: 4, tier: "district", maxPoints: DISTRICT_EVENT_MAX, state: { ...PEM_AHEAD } };
    for (const team of base.teams) {
      team.remainingEvents = [...team.remainingEvents, second];
      team.maxRemainingDistrict = DISTRICT_EVENT_MAX * 2;
    }
    const recomputed = recomputeDistrictVerdicts(DistrictArtifactSchema.parse(base));
    expect(recomputed.teams[0]!.districtLock.status).toBe("contending");
    expect(recomputed.insights.districtLockedCount).toBe(0);
  });

  it("locks nobody extra once every event is finished, even though no team can score again", () => {
    // The pool is zero and `hasRemainingEvent` is empty, so no rival can be
    // bought past anybody at any price. The fourteen teams tied on 17 are still
    // NOT locked, because a tie counts as already ahead and fourteen of them
    // sit at or above each other against twelve slots — exactly the ceiling
    // test's own answer, which is why a finished season's published verdicts do
    // not move.
    const recomputed = recomputeDistrictVerdicts(pooledFixture({ ...WAK_STATE }));
    expect(recomputed.teams[0]!.districtLock.status).toBe("locked");
    expect(recomputed.insights.districtLockedCount).toBe(1);
    expect(recomputed.teams.slice(1).every((team) => team.districtLock.status === "contending")).toBe(true);
  });

  it("leaves the published cut line and the eliminated count exactly where they were", () => {
    const ahead = recomputeDistrictVerdicts(pooledFixture(PEM_AHEAD));
    // The pooled argument reaches the `"locked"` test alone: it takes no
    // reservation, moves no cut line and eliminates nobody.
    expect(ahead.insights.districtEliminatedCount).toBe(0);
    expect(ahead.insights.dcmpCutLinePoints).toBe(17);
  });
});

describe("recomputeDistrictVerdicts — the district pass ranks the district tier total (261007-il9)", () => {
  const DONE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } as const;
  const districtRow = (qual: number, alliance: number, elim: number, award: number) => ({
    eventKey: "2026ncwak",
    eventName: "Wake County Event",
    week: 1,
    tier: "district" as const,
    qual,
    alliance,
    elim,
    award,
    total: qual + alliance + elim + award,
    state: { ...DONE },
  });
  const dcmpRow = (qual: number) => ({
    eventKey: "2026nccmp",
    eventName: "FIRST North Carolina State Championship",
    week: 5,
    tier: "dcmp" as const,
    qual,
    alliance: 0,
    elim: 0,
    award: 0,
    total: qual,
    state: { ...DONE },
  });
  type Row = ReturnType<typeof districtRow> | ReturnType<typeof dcmpRow>;
  const team = (teamKey: string, rank: number, rows: Row[]) => ({
    teamKey,
    teamNumber: Number(teamKey.slice(3)),
    nickname: teamKey,
    rank,
    pointTotal: rows.reduce((sum, row) => sum + row.total, 0),
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: rows,
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: lockVerdict("contending"),
    champLock: lockVerdict("contending"),
  });

  /**
   * A finished district, two DCMP slots and one Championship slot, no awards.
   * A: district 60, no DCMP row (the decliner). B: district 50 plus DCMP 40,
   * 90 in all. C: district 55 plus DCMP 10, 65 in all. D: district 40.
   */
  function finishedFixture(): DistrictArtifact {
    return DistrictArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-published",
      computedAt: "2026-04-20T00:00:00.000Z",
      districtKey: "2026fnc",
      year: 2026,
      abbreviation: "fnc",
      displayName: "FIRST North Carolina",
      dcmpSlots: 2,
      cmpSlots: 1,
      teams: [
        team("frc4", 1, [districtRow(20, 10, 15, 5), dcmpRow(40)]),
        team("frc3", 2, [districtRow(20, 15, 15, 5), dcmpRow(10)]),
        team("frc1", 3, [districtRow(20, 15, 20, 5)]),
        team("frc2", 4, [districtRow(20, 10, 5, 5)]),
      ],
      insights: {
        teamCount: 4,
        eventCount: 2,
        dcmpCutLinePoints: null,
        cmpCutLinePoints: null,
        districtLockedCount: 0,
        districtEliminatedCount: 0,
        champLockedCount: 0,
        champEliminatedCount: 0,
      },
    });
  }
  // frc1 is A, frc4 is B, frc3 is C, frc2 is D.
  const statusOf = (artifact: DistrictArtifact, which: "districtLock" | "champLock") =>
    Object.fromEntries(artifact.teams.map((t) => [t.teamKey, t[which].status]));

  it("locks the two best district tier totals, so the decliner is Locked and a team ahead only on DCMP points is Locked out", () => {
    const out = recomputeDistrictVerdicts(finishedFixture(), { nowYear: 2026 });
    expect(statusOf(out, "districtLock")).toEqual({ frc1: "locked", frc3: "locked", frc4: "eliminated", frc2: "eliminated" });
    expect(out.insights.districtLockedCount).toBe(2);
    expect(out.insights.districtEliminatedCount).toBe(2);
  });

  it("puts the published DCMP cut line on the district tier totals: 55 here", () => {
    const out = recomputeDistrictVerdicts(finishedFixture(), { nowYear: 2026 });
    expect(out.insights.dcmpCutLinePoints).toBe(55);
    for (const t of out.teams) expect(t.districtLock.cutLinePoints).toBe(55);
  });

  it("keeps the champ pass on the all tier total: the 90 point team is the champ lock, and the champ cut line follows the all tier totals", () => {
    const out = recomputeDistrictVerdicts(finishedFixture(), { nowYear: 2026 });
    expect(statusOf(out, "champLock").frc4).toBe("locked");
    expect(out.insights.champLockedCount).toBe(1);
    expect(out.insights.cmpCutLinePoints).toBe(90);
  });

  it("leaves every pointTotal on the wire unchanged", () => {
    const input = finishedFixture();
    const out = recomputeDistrictVerdicts(input, { nowYear: 2026 });
    expect(out.teams.map((t) => [t.teamKey, t.pointTotal])).toEqual(input.teams.map((t) => [t.teamKey, t.pointTotal]));
  });

  it("reaches the Worker's entry point: applyDistrictRankings over the same rows yields the same four district statuses", () => {
    const input = finishedFixture();
    const payload = input.teams.map((t) => ({
      team_key: t.teamKey,
      rank: t.rank,
      point_total: t.pointTotal,
      rookie_bonus: 0,
      adjustments: 0,
      event_points: t.eventPoints.map((row) => eventPointsEntry(row.eventKey, row.total, row.tier === "dcmp")),
    }));
    const merged = merge(input, payload);
    expect(statusOf(merged, "districtLock")).toEqual({ frc1: "locked", frc3: "locked", frc4: "eliminated", frc2: "eliminated" });
  });
});

describe("applyDistrictEventAwards: the awards flag waits for a judged award and its points, and the merge records who won (quick task 261009-r9x)", () => {
  const E1 = "2026ncwak";
  const E2 = "2026ncpem";
  const DCMP = "2026nccmp";
  const DIVISION = "2026nccmp1";
  const IMPACT_2026 = "FIRST Impact Award";

  const FINISHED = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } as const;
  const PLAYOFFS_DONE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: false } as const;

  type Team = DistrictArtifact["teams"][number];
  type PointsRow = Team["eventPoints"][number];
  type RemainingRow = Team["remainingEvents"][number];

  /**
   * One points row. `proof` moves part of the total into alliance and playoff
   * points, so the row can PROVE the event's two earlier categories are in
   * (quick task 261009-vp9). The total is unchanged.
   */
  function pointsRow(
    eventKey: string,
    total: number,
    award: number,
    state: PointsRow["state"],
    tier: "district" | "dcmp" = "district",
    proof: { alliance: number; elim: number } = { alliance: 0, elim: 0 }
  ): PointsRow {
    return {
      eventKey,
      eventName: `${eventKey} event`,
      week: 1,
      tier,
      qual: total - award - proof.alliance - proof.elim,
      alliance: proof.alliance,
      elim: proof.elim,
      award,
      total,
      ...(state === undefined ? {} : { state: { ...state } }),
    };
  }

  /** The alliance point and the winner's playoff value at a 2026 district tier event: 31 of a row's points. */
  const E2_PROOF = { alliance: 1, elim: 30 } as const;
  /** The same at a 2026 District Championship: the winner's value there is 90. */
  const DCMP_PROOF = { alliance: 5, elim: 90 } as const;

  interface FixtureOptions {
    /** `2026ncpem`'s published flag on every row. Default false. */
    readonly e2Posted?: boolean;
    /** Award points on a team's `2026ncpem` row, by team key. Default none. */
    readonly e2Award?: Readonly<Record<string, number>>;
    /** Extra `eventPoints` rows, by team key. */
    readonly extraPoints?: Readonly<Record<string, readonly PointsRow[]>>;
    /** Extra `remainingEvents` rows, by team key. */
    readonly extraRemaining?: Readonly<Record<string, readonly RemainingRow[]>>;
    /** Entries already on a team's `qualifyingAwards`, by team key. */
    readonly awards?: Readonly<Record<string, Team["qualifyingAwards"]>>;
  }

  /**
   * Three teams, A (40 points), B (30) and C (10), two DCMP slots, nothing
   * left to play. Every team has a row at `2026ncwak` (over, awards posted)
   * and at `2026ncpem` (playoffs done, awards as the option says).
   *
   * EVERYTHING BUT THE AWARDS IS IN at `2026ncpem`, and the rows say so
   * (quick task 261009-vp9): A's row there carries an alliance point and the
   * winner's 30 playoff points, so 36 of its 40 points sit on that row and 4
   * on the other. B and C split evenly as before. Every total is unchanged.
   */
  function fixture(options: FixtureOptions = {}): DistrictArtifact {
    const e2State = { ...PLAYOFFS_DONE, awardsPosted: options.e2Posted === true };
    const team = (teamKey: string, teamNumber: number, rank: number, half: number): Team => {
      const extraPoints = options.extraPoints?.[teamKey] ?? [];
      return {
        teamKey,
        teamNumber,
        nickname: `Team ${teamNumber}`,
        rank,
        pointTotal: half * 2 + extraPoints.reduce((sum, row) => sum + row.total, 0),
        rookieBonus: 0,
        adjustments: 0,
        eventPoints:
          teamKey === "frcA"
            ? [pointsRow(E1, half * 2 - 36, 0, FINISHED), pointsRow(E2, 36, options.e2Award?.[teamKey] ?? 0, e2State, "district", E2_PROOF), ...extraPoints]
            : [pointsRow(E1, half, 0, FINISHED), pointsRow(E2, half, options.e2Award?.[teamKey] ?? 0, e2State), ...extraPoints],
        remainingEvents: [...(options.extraRemaining?.[teamKey] ?? [])],
        maxRemainingDistrict: 0,
        maxRemainingChamp: 0,
        qualifyingAwards: [...(options.awards?.[teamKey] ?? [])],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      };
    };
    return DistrictArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-published",
      computedAt: "2026-03-01T00:00:00.000Z",
      districtKey: "2026fnc",
      year: 2026,
      abbreviation: "fnc",
      displayName: "FIRST North Carolina",
      dcmpSlots: 2,
      cmpSlots: 1,
      teams: [team("frcA", 101, 1, 20), team("frcB", 102, 2, 15), team("frcC", 103, 3, 5)],
      insights: { teamCount: 3, eventCount: 2, dcmpCutLinePoints: null, cmpCutLinePoints: null, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
    });
  }

  function award(awardType: number, ...teamKeys: (string | null)[]): DistrictEventAwardInput {
    return { award_type: awardType, recipient_list: teamKeys.map((teamKey) => ({ team_key: teamKey })) };
  }

  function lists(...entries: [string, DistrictEventAwardInput[]][]): Map<string, DistrictEventAwardInput[]> {
    return new Map(entries);
  }

  function teamOf(artifact: DistrictArtifact, teamKey: string): Team {
    return artifact.teams.find((team) => team.teamKey === teamKey)!;
  }

  function flagsAt(artifact: DistrictArtifact, eventKey: string): (boolean | undefined)[] {
    return artifact.teams.flatMap((team) => [...team.eventPoints, ...team.remainingEvents].filter((row) => row.eventKey === eventKey).map((row) => row.state?.awardsPosted));
  }

  function districtStatuses(artifact: DistrictArtifact): Record<string, string> {
    return Object.fromEntries(artifact.teams.map((team) => [team.teamKey, team.districtLock.status]));
  }

  /**
   * The state entry point with this tick's lists. EVERY LISTED EVENT IS PASSED
   * AS SETTLED unless the caller says otherwise (quick task 261009-tx6), so a
   * case here turns on the first two facts of the live rule, as it did before
   * the third existed. The settle fact has its own describe below.
   */
  function withAwards(artifact: DistrictArtifact, eventAwards: Map<string, DistrictEventAwardInput[]>, settledAwardEvents: ReadonlySet<string> = new Set(eventAwards.keys())): DistrictArtifact {
    return applyDistrictEventState({ artifact, eventState: new Map(), eventAwards, settledAwardEvents, generation: GENERATION, computedAt: COMPUTED_AT });
  }

  describe("the flag", () => {
    it("is not raised by a Winner and Finalist only list at a district tier event, and nothing is recorded", () => {
      const out = applyDistrictEventAwards(fixture({ e2Award: { frcC: 5 } }), lists([E2, [award(1, "frcA", "frcB"), award(2, "frcC")]]), new Set([E2]));
      expect(flagsAt(out, E2)).toEqual([false, false, false]);
      expect(out.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    });

    it("is not raised by a judged award with no award points at the event, and the Impact recipient IS recorded", () => {
      const out = applyDistrictEventAwards(fixture(), lists([E2, [award(1, "frcA"), award(2, "frcB"), award(0, "frcC")]]), new Set([E2]));
      expect(flagsAt(out, E2)).toEqual([false, false, false]);
      expect(teamOf(out, "frcC").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false }]);
    });

    it("turns true on every row for the event that carries a state block, in eventPoints and remainingEvents alike, and leaves a row with no state block without one", () => {
      const base = fixture({
        e2Award: { frcC: 5 },
        // frcA also lists the event as still ahead (with a state block), and
        // frcB carries a second row for it with no state block at all.
        extraRemaining: { frcA: [{ eventKey: E2, eventName: `${E2} event`, week: 1, tier: "district", maxPoints: DISTRICT_EVENT_MAX, state: { ...PLAYOFFS_DONE } }] },
        extraPoints: { frcB: [pointsRow(E2, 0, 0, undefined)] },
      });
      const out = applyDistrictEventAwards(base, lists([E2, [award(0, "frcC")]]), new Set([E2]));
      expect(teamOf(out, "frcA").eventPoints.find((row) => row.eventKey === E2)!.state!.awardsPosted).toBe(true);
      expect(teamOf(out, "frcA").remainingEvents[0]!.state!.awardsPosted).toBe(true);
      expect(teamOf(out, "frcC").eventPoints.find((row) => row.eventKey === E2)!.state!.awardsPosted).toBe(true);
      const frcBRows = teamOf(out, "frcB").eventPoints.filter((row) => row.eventKey === E2);
      expect(frcBRows.map((row) => row.state?.awardsPosted)).toEqual([true, undefined]);
      expect("state" in frcBRows[1]!).toBe(false);
      // The other event is untouched.
      expect(flagsAt(out, E1)).toEqual([true, true, true]);
    });

    it("stays true once true, under an empty list and under a Winner only list", () => {
      const posted = fixture({ e2Posted: true });
      expect(flagsAt(applyDistrictEventAwards(posted, lists([E2, []])), E2)).toEqual([true, true, true]);
      expect(flagsAt(applyDistrictEventAwards(posted, lists([E2, [award(1, "frcA")]])), E2)).toEqual([true, true, true]);
    });
  });

  describe("the records", () => {
    it("gives the Impact recipient exactly the publisher's record, and marks Engineering Inspiration and Rookie All Star at a district event as award only", () => {
      const out = applyDistrictEventAwards(fixture(), lists([E2, [award(0, "frcA"), award(9, "frcB"), award(10, "frcC")]]));
      expect(teamOf(out, "frcA").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false }]);
      expect(teamOf(out, "frcB").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 9, label: "Engineering Inspiration", awardOnly: true }]);
      expect(teamOf(out, "frcC").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 10, label: "Rookie All Star", awardOnly: true }]);
    });

    it("records a DCMP Winner on every recipient that is a district team while the flag stays false", () => {
      const dcmpRow = (total: number) => pointsRow(DCMP, total, 0, PLAYOFFS_DONE, "dcmp");
      const base = fixture({ extraPoints: { frcA: [dcmpRow(30)], frcB: [dcmpRow(20)] } });
      const out = applyDistrictEventAwards(base, lists([DCMP, [award(1, "frcA", "frcB", "frc9999")]]));
      const winner = { eventKey: DCMP, awardType: 1, label: "Winner", awardOnly: false };
      expect(teamOf(out, "frcA").qualifyingAwards).toEqual([winner]);
      expect(teamOf(out, "frcB").qualifyingAwards).toEqual([winner]);
      expect(teamOf(out, "frcC").qualifyingAwards).toEqual([]);
      expect(flagsAt(out, DCMP)).toEqual([false, false]);
    });

    it("records nothing for a DCMP division key, whose flag still follows the rule", () => {
      const divisionRow = (awardPoints: number) => pointsRow(DIVISION, 20 + awardPoints, awardPoints, PLAYOFFS_DONE, "dcmp");
      const noPoints = fixture({ extraPoints: { frcA: [divisionRow(0)], frcB: [divisionRow(0)] } });
      const list = [award(0, "frcA"), award(1, "frcA", "frcB"), award(9, "frcB"), award(10, "frcA")];
      const waiting = applyDistrictEventAwards(noPoints, lists([DIVISION, list]));
      expect(waiting.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
      expect(flagsAt(waiting, DIVISION)).toEqual([false, false]);

      const withPoints = fixture({ extraPoints: { frcA: [divisionRow(10)], frcB: [divisionRow(0)] } });
      const posted = applyDistrictEventAwards(withPoints, lists([DIVISION, list]), new Set([DIVISION]));
      expect(posted.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
      expect(flagsAt(posted, DIVISION)).toEqual([true, true]);
    });

    it("ignores a recipient that is not a team of the artifact and a recipient with a null team_key", () => {
      const out = applyDistrictEventAwards(fixture(), lists([E2, [award(0, "frc9999"), award(9, null), award(10, null, "frcB")]]));
      expect(teamOf(out, "frcA").qualifyingAwards).toEqual([]);
      expect(teamOf(out, "frcB").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 10, label: "Rookie All Star", awardOnly: true }]);
      expect(out.teams.map((team) => team.teamKey)).toEqual(["frcA", "frcB", "frcC"]);
    });

    it("records nothing, flags nothing and does not throw for an event on no row", () => {
      const base = fixture();
      const out = applyDistrictEventAwards(base, lists(["2026zzzzz", [award(0, "frcA"), award(5, "frcB")]]));
      expect(out).toEqual(base);
    });

    it("is idempotent, appends an award listed later after the earlier entries, and never removes an entry the list no longer holds", () => {
      const existing = { eventKey: E1, awardType: 9, label: "Engineering Inspiration", awardOnly: true };
      const base = fixture({ awards: { frcA: [existing] } });
      const first = applyDistrictEventAwards(base, lists([E2, [award(0, "frcA")]]));
      const impact = { eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false };
      expect(teamOf(first, "frcA").qualifyingAwards).toEqual([existing, impact]);

      const second = applyDistrictEventAwards(first, lists([E2, [award(0, "frcA")]]));
      expect(second).toEqual(first);

      // A later list adds Engineering Inspiration and no longer holds Impact.
      const later = applyDistrictEventAwards(second, lists([E2, [award(9, "frcA")]]));
      expect(teamOf(later, "frcA").qualifyingAwards).toEqual([existing, impact, { eventKey: E2, awardType: 9, label: "Engineering Inspiration", awardOnly: true }]);

      // One list naming the same team twice for the same award adds it once.
      const doubled = applyDistrictEventAwards(base, lists([E2, [award(0, "frcA", "frcA"), award(0, "frcA")]]));
      expect(teamOf(doubled, "frcA").qualifyingAwards).toEqual([existing, impact]);
    });

    it("touches rows only: no verdict, no stamp and no team order changes", () => {
      const base = fixture({ e2Award: { frcC: 5 } });
      const out = applyDistrictEventAwards(base, lists([E2, [award(0, "frcC")]]), new Set([E2]));
      expect(flagsAt(out, E2)).toEqual([true, true, true]);
      expect(out.generation).toBe(base.generation);
      expect(out.computedAt).toBe(base.computedAt);
      expect(out.insights).toEqual(base.insights);
      expect(out.teams.map((team) => [team.teamKey, team.districtLock, team.champLock])).toEqual(base.teams.map((team) => [team.teamKey, team.districtLock, team.champLock]));
    });
  });

  describe("through the two entry points", () => {
    function payload(artifact: DistrictArtifact, e2AwardPoints: Readonly<Record<string, number>>) {
      return artifact.teams.map((team) => ({
        team_key: team.teamKey,
        rank: team.rank,
        point_total: team.pointTotal + (e2AwardPoints[team.teamKey] ?? 0),
        rookie_bonus: 0,
        adjustments: 0,
        event_points: team.eventPoints.map((row) => {
          const awardPoints = row.eventKey === E2 ? (e2AwardPoints[team.teamKey] ?? 0) : row.award;
          return { event_key: row.eventKey, district_cmp: row.tier === "dcmp", qual_points: row.qual, alliance_points: 0, elim_points: 0, award_points: awardPoints, total: row.qual + awardPoints };
        }),
      }));
    }

    it("applyDistrictRankings reads the rule on the rows AFTER the rankings merge: award points arriving in the same call turn the flag true", () => {
      const base = fixture();
      expect(flagsAt(base, E2)).toEqual([false, false, false]);
      const eventAwards = lists([E2, [award(0, "frcC")]]);

      const settledAwardEvents = new Set([E2]);
      const stillWaiting = applyDistrictRankings({ artifact: base, rankings: payload(base, {}), generation: GENERATION, computedAt: COMPUTED_AT, eventAwards, settledAwardEvents });
      expect(flagsAt(stillWaiting, E2)).toEqual([false, false, false]);

      const out = applyDistrictRankings({ artifact: base, rankings: payload(base, { frcC: 10 }), generation: GENERATION, computedAt: COMPUTED_AT, eventAwards, settledAwardEvents });
      expect(flagsAt(out, E2)).toEqual([true, true, true]);
      expect(teamOf(out, "frcC").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false }]);
      expect(teamOf(out, "frcC").districtLock.status).toBe("lockedAward");
      expect(() => DistrictArtifactSchema.parse(out)).not.toThrow();
    });

    it("applyDistrictEventState returns the Impact winner as lockedAward in the same artifact as the flag", () => {
      const out = withAwards(fixture({ e2Award: { frcC: 5 } }), lists([E2, [award(0, "frcC")]]));
      expect(flagsAt(out, E2)).toEqual([true, true, true]);
      expect(teamOf(out, "frcC").districtLock.status).toBe("lockedAward");
      expect(out.generation).toBe(GENERATION);
    });

    it("the settle fact: a judged list with its points raises the flag only for an event in the settled set, and every record is appended either way (quick task 261009-tx6)", () => {
      const base = fixture({ e2Award: { frcC: 5 } });
      const eventAwards = lists([E2, [award(1, "frcA", "frcB"), award(0, "frcC"), award(9, "frcB")]]);
      const records = (artifact: DistrictArtifact) => artifact.teams.map((team) => team.qualifyingAwards.map((entry) => entry.awardType));

      const settled = applyDistrictEventAwards(base, eventAwards, new Set([E2]));
      expect(flagsAt(settled, E2)).toEqual([true, true, true]);
      expect(records(settled)).toEqual([[], [9], [0]]);

      // The event is not in the set, the set is empty, or no set is passed at
      // all: the list has not settled, so the flag waits and nothing else
      // changes.
      for (const notSettled of [applyDistrictEventAwards(base, eventAwards, new Set([E1])), applyDistrictEventAwards(base, eventAwards, new Set()), applyDistrictEventAwards(base, eventAwards)]) {
        expect(flagsAt(notSettled, E2)).toEqual([false, false, false]);
        expect(records(notSettled)).toEqual([[], [9], [0]]);
      }

      // The same through both entry points, where an absent set settles nothing.
      const rankings = payload(base, { frcC: 5 });
      const viaRankings = (settledAwardEvents?: ReadonlySet<string>) =>
        applyDistrictRankings({ artifact: base, rankings, generation: GENERATION, computedAt: COMPUTED_AT, eventAwards, ...(settledAwardEvents === undefined ? {} : { settledAwardEvents }) });
      const viaState = (settledAwardEvents?: ReadonlySet<string>) =>
        applyDistrictEventState({ artifact: base, eventState: new Map(), generation: GENERATION, computedAt: COMPUTED_AT, eventAwards, ...(settledAwardEvents === undefined ? {} : { settledAwardEvents }) });
      for (const entryPoint of [viaRankings, viaState]) {
        expect(flagsAt(entryPoint(new Set([E2])), E2)).toEqual([true, true, true]);
        expect(teamOf(entryPoint(new Set([E2])), "frcC").districtLock.status).toBe("lockedAward");
        expect(flagsAt(entryPoint(), E2)).toEqual([false, false, false]);
        expect(records(entryPoint())).toEqual([[], [9], [0]]);
        // Recorded, and not read yet: the winner is not locked by an award
        // whose event has not said it is given.
        expect(teamOf(entryPoint(), "frcC").districtLock.status).not.toBe("lockedAward");
      }
    });

    it("applyDistrictEventState does not refuse an awards list for an event on no row: it contributes nothing", () => {
      const base = fixture();
      const out = withAwards(base, lists(["2026zzzzz", [award(0, "frcA")]]));
      expect(out).toEqual(withAwards(base, new Map()));
    });

    it("with eventAwards omitted both entry points return exactly what the verdict pass alone returns", () => {
      const base = fixture({ e2Award: { frcC: 5 } });
      const stamped: DistrictArtifact = { ...base, generation: GENERATION, computedAt: COMPUTED_AT };

      const stateOnly = applyDistrictEventState({ artifact: base, eventState: new Map(), generation: GENERATION, computedAt: COMPUTED_AT });
      expect(stateOnly).toEqual(recomputeDistrictVerdicts(stamped));
      expect(withAwards(base, new Map())).toEqual(stateOnly);

      const rankings = payload(base, { frcC: 5 });
      const merged = applyDistrictRankings({ artifact: base, rankings, generation: GENERATION, computedAt: COMPUTED_AT });
      expect(merged).toEqual(applyDistrictRankings({ artifact: base, rankings, generation: GENERATION, computedAt: COMPUTED_AT, eventAwards: new Map() }));
      // No list supplied: the flag is whatever the rows already said, and no
      // record is invented.
      expect(flagsAt(merged, E2)).toEqual([false, false, false]);
      expect(merged.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    });
  });

  describe("the published verdicts count an award only once its own event says it is given (quick task 261009-tx6, D3)", () => {
    const IMPACT_AT_E2 = { eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false };
    const PLAYOFFS_OPEN = { ...PLAYOFFS_DONE, playoffsDone: false } as const;

    const champStatuses = (artifact: DistrictArtifact): Record<string, string> => Object.fromEntries(artifact.teams.map((team) => [team.teamKey, team.champLock.status]));
    const districtLocks = (artifact: DistrictArtifact) => artifact.teams.map((team) => [team.teamKey, team.districtLock] as const);
    const verdicts = (artifact: DistrictArtifact): DistrictArtifact => recomputeDistrictVerdicts(artifact, { nowYear: 2026 });

    /** The artifact with the state block removed from the named teams' rows at one event (every team when none is named). */
    function withoutState(artifact: DistrictArtifact, eventKey: string, teamKeys?: readonly string[]): DistrictArtifact {
      const strip = <T extends { eventKey: string; state?: unknown }>(row: T): T => {
        if (row.eventKey !== eventKey) return row;
        const { state: _state, ...rest } = row;
        return rest as T;
      };
      return DistrictArtifactSchema.parse({
        ...artifact,
        teams: artifact.teams.map((team) =>
          teamKeys !== undefined && !teamKeys.includes(team.teamKey) ? team : { ...team, eventPoints: team.eventPoints.map(strip), remainingEvents: team.remainingEvents.map(strip) }
        ),
      });
    }

    /**
     * A District Championship row for A and C with the given state, and one
     * award of the given type recorded on C. A's row carries alliance points
     * and the winner's 90 playoff points, so a state that says the playoffs
     * are done is proven by the rows (quick task 261009-vp9).
     */
    function dcmpFixture(awardType: number, state: PointsRow["state"]): DistrictArtifact {
      const dcmpRow = (total: number, proof?: { alliance: number; elim: number }) => pointsRow(DCMP, total, 0, state, "dcmp", proof);
      return fixture({ extraPoints: { frcA: [dcmpRow(100, DCMP_PROOF)], frcC: [dcmpRow(5)] }, awards: { frcC: [{ eventKey: DCMP, awardType, label: "an award", awardOnly: false }] } });
    }

    it("leaves a district tier Impact record uncounted while its event's awards are not posted: every verdict equals the one with the record removed", () => {
      const withRecord = verdicts(fixture({ awards: { frcC: [IMPACT_AT_E2] } }));
      const withoutRecord = verdicts(fixture());
      expect(districtStatuses(withRecord).frcC).not.toBe("lockedAward");
      expect(districtLocks(withRecord)).toEqual(districtLocks(withoutRecord));
    });

    it("counts the same record once its event's awards are posted", () => {
      const out = verdicts(fixture({ e2Posted: true, awards: { frcC: [IMPACT_AT_E2] } }));
      expect(districtStatuses(out).frcC).toBe("lockedAward");
    });

    it("counts a District Championship Winner once the playoffs are done, awards posted or not, and not while the playoffs are open", () => {
      expect(champStatuses(verdicts(dcmpFixture(1, PLAYOFFS_DONE))).frcC).toBe("lockedAward");
      expect(champStatuses(verdicts(dcmpFixture(1, PLAYOFFS_OPEN))).frcC).not.toBe("lockedAward");
    });

    it("counts a District Championship Winner at an event whose awards are posted while its playoffs flag never turned true", () => {
      // The curtailed shape (2022gacar posted its awards with one quarterfinal
      // row never played). Posted awards end the champ reservation for the
      // winning alliance too (`reservedChampSlots`), so a winner left
      // uncounted here would be neither reserved for nor counted.
      expect(champStatuses(verdicts(dcmpFixture(1, { ...PLAYOFFS_OPEN, awardsPosted: true }))).frcC).toBe("lockedAward");
    });

    it.each([0, 9, 10])("leaves a District Championship judged award (type %i) uncounted until its awards are posted", (awardType) => {
      expect(champStatuses(verdicts(dcmpFixture(awardType, PLAYOFFS_DONE))).frcC).not.toBe("lockedAward");
      expect(champStatuses(verdicts(dcmpFixture(awardType, FINISHED))).frcC).toBe("lockedAward");
    });

    it("counts a record whose event rows carry no state block exactly as before", () => {
      expect(districtStatuses(verdicts(withoutState(fixture({ awards: { frcC: [IMPACT_AT_E2] } }), E2))).frcC).toBe("lockedAward");
      expect(champStatuses(verdicts(dcmpFixture(1, undefined))).frcC).toBe("lockedAward");
      expect(champStatuses(verdicts(dcmpFixture(0, undefined))).frcC).toBe("lockedAward");
    });

    it("still leaves out a record whose event is on no row, and still counts one resolved by a supplied tier with no state block", () => {
      const nowhere = fixture({ awards: { frcC: [{ eventKey: "2026zzzzz", awardType: 0, label: IMPACT_2026, awardOnly: false }] } });
      expect(districtStatuses(verdicts(nowhere)).frcC).not.toBe("lockedAward");
      const supplied = recomputeDistrictVerdicts(nowhere, { nowYear: 2026, tierByEvent: new Map([["2026zzzzz", "district"]]) });
      expect(districtStatuses(supplied).frcC).toBe("lockedAward");
    });

    it("reads the state block of the row that carries one when another row for the same event carries none", () => {
      // frcA is the first team walked and its row for the event has no state
      // block. The other two rows say the awards are not posted, and that is
      // the answer.
      const mixed = withoutState(fixture({ awards: { frcC: [IMPACT_AT_E2] } }), E2, ["frcA"]);
      expect(teamOf(mixed, "frcA").eventPoints.find((row) => row.eventKey === E2)!.state).toBeUndefined();
      expect(districtStatuses(verdicts(mixed)).frcC).not.toBe("lockedAward");
    });
  });

  describe("the district tier lock regression: a team is never shown Locked on a slot an Impact winner then takes", () => {
    it("the hazard: with the flag true and no winner recorded, the knife edge team reads locked", () => {
      // This is the state the old Worker published when TBA listed Winner and
      // Finalist first: the flag turned true on the first award of any kind,
      // the reservation for 2026ncpem's Impact fell to zero, and nobody was
      // recorded as having won it. B holds the second of two slots on points,
      // and an Impact award to C would take that slot away from it.
      const old = recomputeDistrictVerdicts(fixture({ e2Posted: true }));
      expect(districtStatuses(old)).toEqual({ frcA: "locked", frcB: "locked", frcC: "eliminated" });
    });

    it("the first list, Winner and Finalist: the flag stays false and the knife edge team is not locked", () => {
      const out = withAwards(fixture(), lists([E2, [award(1, "frcA", "frcB"), award(2, "frcC")]]));
      expect(flagsAt(out, E2)).toEqual([false, false, false]);
      expect(out.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
      expect(districtStatuses(out).frcB).not.toBe("locked");
      // A read locked here before quick task 261009-tx6. 2026ncpem's awards
      // are open and every team has a row there, so B (30) can still be given
      // the 15 award points and reach A's 40: A waits for the awards too.
      expect(districtStatuses(out)).toEqual({ frcA: "contending", frcB: "contending", frcC: "eliminated" });
    });

    it("the second list, Impact to C with its points: the flag is true, C is locked by the award, and B is not locked", () => {
      const out = withAwards(fixture({ e2Award: { frcC: 5 } }), lists([E2, [award(1, "frcA", "frcB"), award(2, "frcC"), award(0, "frcC")]]));
      expect(flagsAt(out, E2)).toEqual([true, true, true]);
      expect(districtStatuses(out).frcC).toBe("lockedAward");
      expect(districtStatuses(out).frcB).not.toBe("locked");
      // C's award takes one of the two slots and A's points take the other, so
      // B is out: the slot the old flag had promised it was never B's.
      expect(districtStatuses(out)).toEqual({ frcA: "locked", frcB: "eliminated", frcC: "lockedAward" });
    });

    it("the other branch, Impact to A: A is locked by the award and B takes the points slot", () => {
      const out = withAwards(fixture({ e2Award: { frcA: 5 } }), lists([E2, [award(0, "frcA")]]));
      expect(flagsAt(out, E2)).toEqual([true, true, true]);
      expect(districtStatuses(out)).toEqual({ frcA: "lockedAward", frcB: "locked", frcC: "eliminated" });
    });

    it("three states in order: the winner is read only once the flag is true, and no held place is lost on the way (quick task 261009-tx6)", () => {
      // Before quick task 261009-tx6 the second state read A contending: the
      // recorded winner consumed a slot while its event still reserved one,
      // and the published verdict took A's Locked back until the points
      // arrived. A record is now read only once its event says the award is
      // given, so the second state equals the first.
      const fieldAwards = [award(1, "frcA", "frcB"), award(2, "frcC")];
      const winnerListed = withAwards(fixture(), lists([E2, fieldAwards]));
      const impactRecorded = withAwards(fixture(), lists([E2, [...fieldAwards, award(0, "frcC")]]));
      const flagTrue = withAwards(fixture({ e2Award: { frcC: 5 } }), lists([E2, [...fieldAwards, award(0, "frcC")]]));

      expect(flagsAt(winnerListed, E2)).toEqual([false, false, false]);
      expect(flagsAt(impactRecorded, E2)).toEqual([false, false, false]);
      expect(flagsAt(flagTrue, E2)).toEqual([true, true, true]);
      expect(teamOf(impactRecorded, "frcC").qualifyingAwards).toEqual([{ eventKey: E2, awardType: 0, label: IMPACT_2026, awardOnly: false }]);

      // The record alone moves nothing.
      expect(impactRecorded.teams.map((team) => team.districtLock)).toEqual(winnerListed.teams.map((team) => team.districtLock));

      // PINNED AS THE RUN SHOWS. A is not locked while the awards are open: B
      // (30) could still be given the 15 award points and reach A's 40, which
      // the ceilings count since quick task 261009-tx6. Nobody holds a place
      // in the first two states, so nothing can be taken back.
      const walk = [winnerListed, impactRecorded, flagTrue].map(districtStatuses);
      expect(walk).toEqual([
        { frcA: "contending", frcB: "contending", frcC: "eliminated" },
        { frcA: "contending", frcB: "contending", frcC: "eliminated" },
        { frcA: "locked", frcB: "eliminated", frcC: "lockedAward" },
      ]);

      // C reads lockedAward in the third state only.
      expect(walk.map((statuses) => statuses.frcC === "lockedAward")).toEqual([false, false, true]);

      // No team holds a place in one state and loses it in a later one.
      const held = (status: string | undefined) => status === "locked" || status === "lockedAward";
      for (const teamKey of ["frcA", "frcB", "frcC"]) {
        for (let earlier = 0; earlier < walk.length; earlier++) {
          if (!held(walk[earlier]![teamKey])) continue;
          for (let later = earlier + 1; later < walk.length; later++) expect({ teamKey, later, held: held(walk[later]![teamKey]) }).toEqual({ teamKey, later, held: true });
        }
      }
    });
  });
});

describe("recomputeDistrictVerdicts: the ceilings and floors count what is still open at a played event (quick task 261009-tx6, D8)", () => {
  /** 2026 district tier category ceilings: 22 + 16 + 30 + 15 = 83. */
  const AWARD_MAX = 15;
  /** 2026 dcmp tier category ceilings are three times the district tier's: 66 + 48 + 90 + 45 = 249. */
  const DCMP_ELIM_MAX = 90;
  const DCMP_AWARD_MAX = 45;

  const FINAL = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } as const;
  const AWARDS_OPEN = { ...FINAL, awardsPosted: false } as const;
  const PLAYOFFS_OPEN = { ...FINAL, playoffsDone: false, awardsPosted: false } as const;
  const QUAL_RUNNING = { qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false } as const;
  const NOT_STARTED = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false } as const;

  const E0 = "2026ncwak";
  const E1 = "2026ncpem";
  const E2 = "2026ncash";
  const DCMP = "2026nccmp";

  type Team = DistrictArtifact["teams"][number];
  type PointsRow = Team["eventPoints"][number];
  type RemainingRow = Team["remainingEvents"][number];
  type State = NonNullable<PointsRow["state"]>;
  type Tier = "district" | "dcmp";

  function played(eventKey: string, points: { qual?: number; alliance?: number; elim?: number; award?: number }, state: State | undefined, tier: Tier = "district"): PointsRow {
    const qual = points.qual ?? 0;
    const alliance = points.alliance ?? 0;
    const elim = points.elim ?? 0;
    const award = points.award ?? 0;
    return { eventKey, eventName: `${eventKey} event`, week: 1, tier, qual, alliance, elim, award, total: qual + alliance + elim + award, ...(state === undefined ? {} : { state: { ...state } }) };
  }

  function ahead(eventKey: string, state: State | undefined = NOT_STARTED, tier: Tier = "district"): RemainingRow {
    return { eventKey, eventName: `${eventKey} event`, week: 5, tier, maxPoints: tier === "dcmp" ? DCMP_EVENT_MAX : DISTRICT_EVENT_MAX, ...(state === undefined ? {} : { state: { ...state } }) };
  }

  interface TeamOptions {
    readonly remaining?: readonly RemainingRow[];
    /** The stored ceiling. Default: the sum of the district tier remaining events. */
    readonly maxRemainingDistrict?: number;
    /** The stored champ ceiling. Default: the stored district ceiling (no championship ahead). */
    readonly maxRemainingChamp?: number;
    readonly awards?: Team["qualifyingAwards"];
  }

  function team(teamKey: string, rows: readonly PointsRow[], options: TeamOptions = {}): Team {
    const remaining = options.remaining ?? [];
    const maxRemainingDistrict = options.maxRemainingDistrict ?? remaining.filter((row) => row.tier === "district").reduce((sum, row) => sum + row.maxPoints, 0);
    return {
      teamKey,
      teamNumber: Number(teamKey.replace(/\D/g, "")),
      nickname: `Team ${teamKey}`,
      rank: 1,
      pointTotal: rows.reduce((sum, row) => sum + row.total, 0),
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [...rows],
      remainingEvents: [...remaining],
      maxRemainingDistrict,
      maxRemainingChamp: options.maxRemainingChamp ?? maxRemainingDistrict,
      qualifyingAwards: [...(options.awards ?? [])],
      districtLock: lockVerdict("contending"),
      champLock: lockVerdict("contending"),
    };
  }

  function district(teams: readonly Team[], slots: { dcmpSlots?: number; cmpSlots?: number } = {}): DistrictArtifact {
    return DistrictArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-published",
      computedAt: "2026-03-01T00:00:00.000Z",
      districtKey: "2026fnc",
      year: 2026,
      abbreviation: "fnc",
      displayName: "FIRST North Carolina",
      dcmpSlots: slots.dcmpSlots ?? 2,
      cmpSlots: slots.cmpSlots ?? 1,
      teams,
      insights: { teamCount: teams.length, eventCount: 3, dcmpCutLinePoints: null, cmpCutLinePoints: null, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
    });
  }

  const verdicts = (artifact: DistrictArtifact): DistrictArtifact => recomputeDistrictVerdicts(artifact, { nowYear: 2026 });
  const teamOf = (artifact: DistrictArtifact, teamKey: string): Team => artifact.teams.find((entry) => entry.teamKey === teamKey)!;
  const ceilings = (artifact: DistrictArtifact) => artifact.teams.map((entry) => [entry.teamKey, entry.maxRemainingDistrict, entry.maxRemainingChamp] as const);
  const locks = (artifact: DistrictArtifact) => artifact.teams.map((entry) => [entry.teamKey, entry.districtLock, entry.champLock] as const);
  const districtStatuses = (artifact: DistrictArtifact): Record<string, string> => Object.fromEntries(artifact.teams.map((entry) => [entry.teamKey, entry.districtLock.status]));
  const held = (status: string | undefined) => status === "locked" || status === "lockedAward";

  /** A TBA shaped rankings payload that says exactly what the artifact's rows say. */
  function payloadOf(artifact: DistrictArtifact) {
    return artifact.teams.map((entry) => ({
      team_key: entry.teamKey,
      rank: entry.rank,
      point_total: entry.pointTotal,
      rookie_bonus: entry.rookieBonus,
      adjustments: entry.adjustments,
      event_points: entry.eventPoints.map((row) => ({
        event_key: row.eventKey,
        district_cmp: row.tier === "dcmp",
        qual_points: row.qual,
        alliance_points: row.alliance,
        elim_points: row.elim,
        award_points: row.award,
        total: row.total,
      })),
    }));
  }

  const viaRankings = (artifact: DistrictArtifact): DistrictArtifact => applyDistrictRankings({ artifact, rankings: payloadOf(artifact), generation: GENERATION, computedAt: COMPUTED_AT });
  const viaState = (artifact: DistrictArtifact): DistrictArtifact => applyDistrictEventState({ artifact, eventState: new Map(), generation: GENERATION, computedAt: COMPUTED_AT });

  /**
   * Three teams with an open award category at `2026ncpem`, one event still
   * ahead for two of them, and a championship still ahead.
   *
   * ONLY THE AWARDS ARE OPEN THERE, and the rows prove it (quick task
   * 261009-vp9): frc1's row carries the winner's 30 playoff points and frc2's
   * carries alliance points. The totals are what they were (30 and 20).
   */
  function openAwardDistrict(e1Award: Readonly<Record<string, number>> = {}): DistrictArtifact {
    const seeded = (ahead: number) => ({ maxRemainingDistrict: ahead, maxRemainingChamp: ahead + DCMP_EVENT_MAX });
    return district(
      [
        team("frc1", [played(E0, { qual: 40 }, FINAL), played(E1, { elim: DISTRICT_ELIM_MAX, award: e1Award.frc1 ?? 0 }, AWARDS_OPEN)], { remaining: [ahead(E2)], ...seeded(DISTRICT_EVENT_MAX) }),
        team("frc2", [played(E1, { qual: 10, alliance: 10, award: e1Award.frc2 ?? 0 }, AWARDS_OPEN)], seeded(0)),
        team("frc3", [played(E0, { qual: 25 }, FINAL)], { remaining: [ahead(E2)], ...seeded(DISTRICT_EVENT_MAX) }),
      ],
      { dcmpSlots: 3 }
    );
  }

  it("moves nothing where nothing is open: every state block final, or no state block at all", () => {
    for (const state of [FINAL, undefined]) {
      const input = district([
        team("frc1", [played(E0, { qual: 40, award: 5 }, state)], { remaining: [ahead(E2, state === undefined ? undefined : NOT_STARTED)] }),
        team("frc2", [played(E0, { qual: 30 }, state)]),
      ]);
      const out = verdicts(input);
      expect(ceilings(out)).toEqual([
        ["frc1", DISTRICT_EVENT_MAX, DISTRICT_EVENT_MAX],
        ["frc2", 0, 0],
      ]);
      expect(out.teams.map((entry) => entry.pointTotal)).toEqual([45, 30]);
      expect(verdicts(out)).toEqual(out);
    }
  });

  it("adds the award ceiling for every team with a row at an event whose awards are still open, and nothing for a team with no row there", () => {
    const out = verdicts(openAwardDistrict());
    // frc1 and frc2 have a row at 2026ncpem, frc3 does not. Each keeps the
    // championship the publisher's calendar seeded, on top of its new ceiling.
    expect(ceilings(out)).toEqual([
      ["frc1", DISTRICT_EVENT_MAX + AWARD_MAX, DISTRICT_EVENT_MAX + AWARD_MAX + DCMP_EVENT_MAX],
      ["frc2", AWARD_MAX, AWARD_MAX + DCMP_EVENT_MAX],
      ["frc3", DISTRICT_EVENT_MAX, DISTRICT_EVENT_MAX + DCMP_EVENT_MAX],
    ]);
  });

  it("a row at an event still in qualification adds all four ceilings, which is what the event was worth while it was still ahead", () => {
    const rival = team("frc2", [played(E0, { qual: 30 }, FINAL)]);
    const stillAhead = verdicts(district([team("frc1", [played(E0, { qual: 40 }, FINAL)], { remaining: [ahead(E1, QUAL_RUNNING)] }), rival]));
    const rowAppeared = verdicts(district([team("frc1", [played(E0, { qual: 40 }, FINAL), played(E1, { qual: 6 }, QUAL_RUNNING)], { maxRemainingDistrict: 0 }), rival]));
    expect(teamOf(stillAhead, "frc1").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX);
    expect(teamOf(rowAppeared, "frc1").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX);
    // The six points earned so far are in an open category, so they are not
    // in the floor yet and no verdict moves when the row appears.
    expect(locks(rowAppeared)).toEqual(locks(stillAhead));
    expect(teamOf(rowAppeared, "frc1").pointTotal).toBe(46);
  });

  it("a District Championship row with playoffs and awards open raises the champ ceiling by those two dcmp tier ceilings and leaves the district ceiling alone", () => {
    const out = verdicts(
      district([team("frc1", [played(E0, { qual: 50 }, FINAL), played(DCMP, { qual: 30, alliance: 20 }, PLAYOFFS_OPEN, "dcmp")]), team("frc2", [played(E0, { qual: 40 }, FINAL)])])
    );
    expect(ceilings(out)).toEqual([
      ["frc1", 0, DCMP_ELIM_MAX + DCMP_AWARD_MAX],
      ["frc2", 0, 0],
    ]);
  });

  it("floors: award points landing in an open category move no verdict and no cut line, at either tier, and pointTotal on the wire is the landed total", () => {
    const before = verdicts(openAwardDistrict());
    const after = verdicts(openAwardDistrict({ frc1: 5, frc2: 10 }));
    expect(locks(after)).toEqual(locks(before));
    expect(ceilings(after)).toEqual(ceilings(before));
    expect(after.insights).toEqual(before.insights);
    expect(after.teams.map((entry) => entry.pointTotal)).toEqual([75, 30, 25]);
    expect(before.teams.map((entry) => entry.pointTotal)).toEqual([70, 20, 25]);

    // The same at the dcmp tier, where only the champ pass reads the row.
    const champDistrict = (dcmpAward: number) =>
      verdicts(
        district(
          [
            team("frc1", [played(E0, { qual: 50 }, FINAL), played(DCMP, { qual: 30, award: dcmpAward }, AWARDS_OPEN, "dcmp")]),
            team("frc2", [played(E0, { qual: 45 }, FINAL), played(DCMP, { qual: 40 }, AWARDS_OPEN, "dcmp")]),
          ],
          { cmpSlots: 1 }
        )
      );
    expect(locks(champDistrict(30))).toEqual(locks(champDistrict(0)));
    expect(champDistrict(30).insights).toEqual(champDistrict(0).insights);
    expect(teamOf(champDistrict(30), "frc1").pointTotal).toBe(110);
  });

  it("no take back at the award stage: a team Locked while a rival's award points are still to land holds it when they land and when the category closes", () => {
    // Three DCMP slots. 2026ncpem's awards are open, so one slot is held back
    // and two are left for points.
    //
    // TODAY'S TAKE BACK, before this task, is frcY's: it sat on 60 with only
    // frcX above it, so it read Locked. Then frcR's ten award points landed
    // (55 to 65), frcR passed it, two rivals stood at or above it against two
    // slots, and the published verdict read contending. Under this rule
    // frcR's ceiling counts the fifteen award points it could still be given
    // from the start, so frcY is never shown Locked and nothing is taken
    // back. frcX is far enough ahead that no open award can reach it, so it
    // is Locked at every step.
    const stage = (landed: boolean, posted: boolean) => {
      const state = posted ? FINAL : AWARDS_OPEN;
      const award = (points: number) => (landed ? points : 0);
      return verdicts(
        district(
          [
            // The same totals as ever (80 and 60). frcX's row at 2026ncpem
            // carries the winner's 30 playoff points and frcY's carries
            // alliance points, so only the awards are open there (quick
            // task 261009-vp9).
            team("frcX", [played(E0, { qual: 50 }, FINAL), played(E1, { elim: DISTRICT_ELIM_MAX }, state)]),
            team("frcY", [played(E0, { qual: 40 }, FINAL), played(E1, { qual: 10, alliance: 10 }, state)]),
            team("frcR", [played(E0, { qual: 35 }, FINAL), played(E1, { qual: 20, award: award(10) }, state)]),
            team("frcW", [played(E0, { qual: 10 }, FINAL), played(E1, { qual: 5, award: award(10) }, state)], { awards: [{ eventKey: E1, awardType: 0, label: "FIRST Impact Award", awardOnly: false }] }),
          ],
          { dcmpSlots: 3 }
        )
      );
    };
    const walk = [stage(false, false), stage(true, false), stage(true, true)].map(districtStatuses);
    expect(walk.map((statuses) => statuses.frcX)).toEqual(["locked", "locked", "locked"]);
    expect(walk.map((statuses) => held(statuses.frcY))).toEqual([false, false, false]);
    expect(walk[1]).toEqual(walk[0]);
    expect(walk[2]!.frcW).toBe("lockedAward");
    for (const teamKey of ["frcX", "frcY", "frcR", "frcW"]) {
      for (let earlier = 0; earlier < walk.length; earlier++) {
        if (!held(walk[earlier]![teamKey])) continue;
        for (let later = earlier + 1; later < walk.length; later++) expect({ teamKey, later, held: held(walk[later]![teamKey]) }).toEqual({ teamKey, later, held: true });
      }
    }
  });

  it("is idempotent with open categories present, and applyDistrictEventState with an unchanged state map is a fixed point", () => {
    const once = verdicts(openAwardDistrict({ frc2: 10 }));
    expect(verdicts(once)).toEqual(once);

    const stateOnce = viaState(openAwardDistrict({ frc2: 10 }));
    expect(viaState(stateOnce)).toEqual(stateOnce);
    const rankingsOnce = viaRankings(openAwardDistrict({ frc2: 10 }));
    expect(viaRankings(rankingsOnce)).toEqual(rankingsOnce);
  });

  it("an open championship row is never read as a granted hypothetical championship, on either path, however often the merge runs", () => {
    // No championship is ahead of anyone: no dcmp tier remaining event and no
    // stored champ ceiling above a district ceiling. frc1's own championship
    // row is wholly open, which puts 249 on its champ ceiling and must not
    // read as "a championship is still ahead" on the next call.
    const input = district(
      [team("frc1", [played(E0, { qual: 50 }, FINAL), played(DCMP, { qual: 10 }, QUAL_RUNNING, "dcmp")]), team("frc2", [played(E0, { qual: 40 }, FINAL)]), team("frc3", [played(E0, { qual: 30 }, FINAL)])],
      { dcmpSlots: 3 }
    );
    for (const path of [viaState, viaRankings]) {
      const once = path(input);
      const twice = path(once);
      expect(twice).toEqual(once);
      for (const out of [once, twice]) {
        expect(ceilings(out)).toEqual([
          ["frc1", 0, DCMP_EVENT_MAX],
          ["frc2", 0, 0],
          ["frc3", 0, 0],
        ]);
      }
    }
  });

  it("gives the same ceilings and verdicts on the rankings path and the state path for one incoming artifact", () => {
    const input = openAwardDistrict({ frc1: 5 });
    const rankings = viaRankings(input);
    const state = viaState(input);
    expect(ceilings(rankings)).toEqual(ceilings(state));
    expect(locks(rankings)).toEqual(locks(state));
    expect(rankings.insights).toEqual(state.insights);
  });

  it("keeps the calendar's answer: a district with no dcmp event on any row still reads its seeded championship as ahead, on both paths", () => {
    const input = district(
      [team("frc1", [played(E0, { qual: 50 }, FINAL)], { maxRemainingDistrict: 0, maxRemainingChamp: DCMP_EVENT_MAX }), team("frc2", [played(E0, { qual: 40 }, FINAL)], { maxRemainingDistrict: 0, maxRemainingChamp: DCMP_EVENT_MAX })],
      { dcmpSlots: 2 }
    );
    for (const path of [viaState, viaRankings]) {
      const once = path(input);
      const twice = path(once);
      for (const out of [once, twice]) {
        expect(ceilings(out)).toEqual([
          ["frc1", 0, DCMP_EVENT_MAX],
          ["frc2", 0, DCMP_EVENT_MAX],
        ]);
      }
    }
  });

  it("a newcomer's seed survives the next rankings tick and the unchanged tick after it", () => {
    const payload = tracerPayload();
    payload.push({ team_key: "frc9999", rank: 3, point_total: 5, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry("2026ncwak", 5)] });
    const seedOf = (artifact: DistrictArtifact) => artifact.teams.find((entry) => entry.teamKey === "frc9999")!.maxRemainingDistrict;

    const first = merge(twoTeamFixture(), payload);
    expect(seedOf(first)).toBe(DISTRICT_EVENT_MAX);
    // The rankings 200 tick: the newcomer is in the artifact now and still has
    // no calendar. Before this task its ceiling fell to zero here.
    const second = merge(first, payload);
    expect(seedOf(second)).toBe(DISTRICT_EVENT_MAX);
    // The 304 tick.
    const third = applyDistrictEventState({ artifact: second, eventState: new Map(), generation: GENERATION, computedAt: COMPUTED_AT });
    expect(seedOf(third)).toBe(DISTRICT_EVENT_MAX);
  });

  it("a stored ceiling written before this task never lowers a ceiling: the open category is added on top of the remaining event on both paths", () => {
    // Stored: the one remaining event and nothing else, which is what every
    // artifact written before this task carries. The rows prove that only
    // the awards are open at 2026ncpem (quick task 261009-vp9).
    const input = district([
      team("frc1", [played(E1, { elim: DISTRICT_ELIM_MAX }, AWARDS_OPEN)], { remaining: [ahead(E2)], maxRemainingDistrict: DISTRICT_EVENT_MAX }),
      team("frc2", [played(E1, { qual: 10, alliance: 10 }, AWARDS_OPEN)]),
    ]);
    expect(teamOf(viaState(input), "frc1").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX + AWARD_MAX);
    expect(teamOf(viaRankings(input), "frc1").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX + AWARD_MAX);
    expect(teamOf(verdicts(input), "frc1").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX + AWARD_MAX);
  });

  describe("category finality is read in one place, and it reads the rows (quick task 261009-vp9)", () => {
    const OPEN = { qual: false, alliance: false, elim: false, award: false };
    /** Every qualification match played, alliances not picked yet. */
    const QUAL_PLAYED = { ...FINAL, alliancesPicked: false, playoffsDone: false, awardsPosted: false } as const;
    /** One row that proves both earlier categories at a district tier event: alliance points, and the winner's playoff value. */
    const PROVEN = { qual: 10, alliance: 5, elim: DISTRICT_ELIM_MAX };

    it("publishedCategoryFinality equals the state's reading where the rows prove every category, and reads the uncorroborated categories open where no row does", () => {
      const proven = [team("frc1", [played(E1, PROVEN, FINAL)])];
      for (const state of [FINAL, AWARDS_OPEN, PLAYOFFS_OPEN, QUAL_RUNNING, NOT_STARTED, { ...NOT_STARTED, qualMatchesTotal: null }, { ...NOT_STARTED, awardsPosted: true }, undefined]) {
        expect(publishedCategoryFinality(proven, E1, state, 2026)).toEqual(districtEventCategoryFinality(state));
      }

      const unproven = [team("frc1", [played(E1, { qual: 10 }, FINAL)])];
      expect(publishedCategoryFinality(unproven, E1, AWARDS_OPEN, 2026)).toEqual(OPEN);
      expect(publishedCategoryFinality(unproven, E1, PLAYOFFS_OPEN, 2026)).toEqual(OPEN);
      // The awards flag closes all four with no proving row at all.
      expect(publishedCategoryFinality(unproven, E1, FINAL, 2026)).toEqual({ qual: true, alliance: true, elim: true, award: true });
      // Alliance points and no row at the winner's value: Playoffs stay open, the two earlier categories close.
      const allianceOnly = [team("frc1", [played(E1, { qual: 10, alliance: 5 }, FINAL)])];
      expect(publishedCategoryFinality(allianceOnly, E1, AWARDS_OPEN, 2026)).toEqual({ qual: true, alliance: true, elim: false, award: false });

      // Every qualification match played and alliances not picked: the state
      // reads Qualification final, and the rule reads it open until the
      // alliance points land, whatever the rows hold.
      expect(districtEventCategoryFinality(QUAL_PLAYED).qual).toBe(true);
      expect(publishedCategoryFinality(proven, E1, QUAL_PLAYED, 2026)).toEqual(OPEN);
      // An event on no row has nothing proven.
      expect(publishedCategoryFinality(proven, E2, AWARDS_OPEN, 2026)).toEqual(OPEN);
    });

    it("the presence facts are kept per teams array: a NEW array with the winner's row added, and one with it removed, are each read afresh", () => {
      const without = [team("frc1", [played(E1, { qual: 10, alliance: 5 }, AWARDS_OPEN)])];
      expect(publishedCategoryFinality(without, E1, AWARDS_OPEN, 2026).elim).toBe(false);
      const withWinner = [...without, team("frc2", [played(E1, { elim: DISTRICT_ELIM_MAX }, AWARDS_OPEN)])];
      expect(publishedCategoryFinality(withWinner, E1, AWARDS_OPEN, 2026).elim).toBe(true);
      // The first array still reads as it did, and a third array with the
      // row removed again reads open.
      expect(publishedCategoryFinality(without, E1, AWARDS_OPEN, 2026).elim).toBe(false);
      const removed = withWinner.filter((entry) => entry.teamKey !== "frc2");
      expect(publishedCategoryFinality(removed, E1, AWARDS_OPEN, 2026).elim).toBe(false);
      expect(publishedCategoryFinality(withWinner, E1, AWARDS_OPEN, 2026).elim).toBe(true);
    });

    /**
     * Fifteen teams, twelve DCMP slots, every team with a row at one event
     * whose state says the playoffs are done and the awards are open. One
     * slot is held back, so eleven are left. The leader sits ten points above
     * fourteen rivals. Its row carries the alliance point, so Alliance
     * selection and Qualification are proven. `winner` puts the winner's
     * playoff value on one rival's row. `landed` puts playoff points below
     * the winner's value on another rival's row.
     */
    const playoffsDoneByState = (options: { winner: boolean; landed: number }) =>
      verdicts(
        district(
          [
            team("frc1", [played(E1, { qual: 99, alliance: 1 }, AWARDS_OPEN)]),
            team("frc2", [played(E1, { qual: 90, elim: options.landed }, AWARDS_OPEN)]),
            team("frc3", [played(E1, options.winner ? { qual: 60, elim: DISTRICT_ELIM_MAX } : { qual: 90 }, AWARDS_OPEN)]),
            ...Array.from({ length: 12 }, (_, index) => team(`frc${String(index + 4)}`, [played(E1, { qual: 90 }, AWARDS_OPEN)])),
          ],
          { dcmpSlots: 12 }
        )
      );

    it("playoffs done by state with no row at the winner's value: the playoff ceiling stays, the playoff points a row carries are out of the floor, and the pooled pool still counts the playoffs", () => {
      const out = playoffsDoneByState({ winner: false, landed: 0 });
      // The ceilings: the Playoffs and the Awards ceilings, for every participant.
      expect(new Set(out.teams.map((entry) => entry.maxRemainingDistrict))).toEqual(new Set([DISTRICT_ELIM_MAX + AWARD_MAX]));
      // The floors: playoff points landing on a rival move no districtLock for any team.
      const landed = playoffsDoneByState({ winner: false, landed: 12 });
      expect(landed.teams.map((entry) => entry.districtLock)).toEqual(out.teams.map((entry) => entry.districtLock));
      expect(teamOf(landed, "frc2").pointTotal).toBe(102);
      // The pool: with the playoffs counted the leader is not locked.
      expect(teamOf(out, "frc1").districtLock.status).toBe("contending");
    });

    it("give one row the winner's value and the ceilings, the floors and the pooled pool flip together", () => {
      const out = playoffsDoneByState({ winner: true, landed: 0 });
      // The ceilings: the award ceiling and nothing else.
      expect(new Set(out.teams.map((entry) => entry.maxRemainingDistrict))).toEqual(new Set([AWARD_MAX]));
      // The pool: the award pool alone (91 for fifteen teams, against the 110
      // eleven rivals would need), so the leader is locked.
      expect(teamOf(out, "frc1").districtLock.status).toBe("locked");
      // The floors: the playoff points on a rival's row are in its floor now.
      // 102 passes the leader's 100, so a verdict moves.
      const landed = playoffsDoneByState({ winner: true, landed: 12 });
      expect(landed.teams.map((entry) => entry.districtLock)).not.toEqual(out.teams.map((entry) => entry.districtLock));
    });

    it("alliances picked by state with no alliance points on any row: the Alliance selection and Qualification ceilings both stay, and one row with alliance points closes both", () => {
      const build = (alliance: number, qualLanded: number) =>
        verdicts(
          district([
            team("frc1", [played(E0, { qual: 40 }, FINAL), played(E1, { qual: 20 }, PLAYOFFS_OPEN)]),
            team("frc2", [played(E0, { qual: 30 }, FINAL), played(E1, { qual: 15 + qualLanded, alliance }, PLAYOFFS_OPEN)]),
            team("frc3", [played(E0, { qual: 25 }, FINAL)]),
          ])
        );
      const unproven = build(0, 0);
      expect(ceilings(unproven)).toEqual([
        ["frc1", DISTRICT_EVENT_MAX, DISTRICT_EVENT_MAX],
        ["frc2", DISTRICT_EVENT_MAX, DISTRICT_EVENT_MAX],
        ["frc3", 0, 0],
      ]);
      // Qualification points landing while Qualification reads open move no verdict.
      expect(locks(build(0, 6))).toEqual(locks(unproven));

      const proven = build(4, 0);
      expect(ceilings(proven)).toEqual([
        ["frc1", DISTRICT_ELIM_MAX + AWARD_MAX, DISTRICT_ELIM_MAX + AWARD_MAX],
        ["frc2", DISTRICT_ELIM_MAX + AWARD_MAX, DISTRICT_ELIM_MAX + AWARD_MAX],
        ["frc3", 0, 0],
      ]);
    });

    it("a District Championship Winner recorded while no row carries the winner's value is not counted, and the winning alliance's four places stay held", () => {
      // Eight Championship slots. The judged awards hold five back while the
      // championship's awards are open (2026fnc at this size), and the
      // winning alliance four more while its playoffs are open. frcP is so
      // far ahead that no rival's ceiling reaches it, so it is locked the
      // moment a single points slot is free: with the four places released
      // and the winner counted, 8 - 5 - 1 = 2 are; with them held, none is.
      const WINNER_RECORD = { eventKey: DCMP, awardType: 1, label: "District Championship Winner", awardOnly: false };
      const build = (state: State, winnerElim: number) =>
        verdicts(
          district(
            [
              team("frcP", [played(E0, { qual: 400 }, FINAL), played(DCMP, { qual: 30, alliance: 10 }, state, "dcmp")]),
              team("frcR", [played(E0, { qual: 40 }, FINAL), played(DCMP, { qual: 20, alliance: 5 }, state, "dcmp")]),
              team("frcS", [played(E0, { qual: 30 }, FINAL), played(DCMP, { qual: 20 }, state, "dcmp")]),
              team("frcW", [played(E0, { qual: 5 }, FINAL), played(DCMP, { qual: 10, alliance: 2, elim: winnerElim }, state, "dcmp")], { awards: [WINNER_RECORD] }),
            ],
            { cmpSlots: 8 }
          )
        );
      const champLocks = (artifact: DistrictArtifact) => artifact.teams.map((entry) => [entry.teamKey, entry.champLock] as const);

      const playoffsOpen = build(PLAYOFFS_OPEN, 0);
      const doneNoPoints = build(AWARDS_OPEN, 0);
      const doneWithPoints = build(AWARDS_OPEN, DCMP_ELIM_MAX);

      // Done by state with no row at 90 reads exactly as playoffs open: the
      // Winner is not counted and the four places are still held.
      expect(champLocks(doneNoPoints)).toEqual(champLocks(playoffsOpen));
      expect(teamOf(doneNoPoints, "frcW").champLock.status).not.toBe("lockedAward");
      expect(teamOf(doneNoPoints, "frcP").champLock.status).toBe("contending");

      // With a row at the winner's value the reservation follows the state
      // as before: the four places are released and the winner is counted.
      expect(teamOf(doneWithPoints, "frcW").champLock.status).toBe("lockedAward");
      expect(teamOf(doneWithPoints, "frcP").champLock.status).toBe("locked");
    });

    it("is idempotent and path independent with an uncorroborated category present", () => {
      // 2026ncpem's state says its playoffs are done. No row there carries
      // alliance points or the winner's value, so all four categories read open.
      const seeded = (ahead: number) => ({ maxRemainingDistrict: ahead, maxRemainingChamp: ahead + DCMP_EVENT_MAX });
      const input = district(
        [
          team("frc1", [played(E0, { qual: 40 }, FINAL), played(E1, { qual: 30, elim: 12 }, AWARDS_OPEN)], { remaining: [ahead(E2)], ...seeded(DISTRICT_EVENT_MAX) }),
          team("frc2", [played(E1, { qual: 20, award: 10 }, AWARDS_OPEN)], seeded(0)),
          team("frc3", [played(E0, { qual: 25 }, FINAL)], { remaining: [ahead(E2)], ...seeded(DISTRICT_EVENT_MAX) }),
        ],
        { dcmpSlots: 3 }
      );
      const once = verdicts(input);
      expect(teamOf(once, "frc2").maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX);
      expect(teamOf(once, "frc1").maxRemainingDistrict).toBe(2 * DISTRICT_EVENT_MAX);
      expect(verdicts(once)).toEqual(once);

      const rankings = viaRankings(input);
      const state = viaState(input);
      expect(ceilings(rankings)).toEqual(ceilings(state));
      expect(locks(rankings)).toEqual(locks(state));
      expect(rankings.insights).toEqual(state.insights);
      expect(viaState(state)).toEqual(state);
      expect(viaRankings(rankings)).toEqual(rankings);
    });

    it("the ceilings, the floors and the pooled pool of one artifact agree that only the award category is open", () => {
      // Fifteen teams, twelve DCMP slots, every team with a row at one event
      // whose playoffs are done and whose awards are open. One slot is held
      // back, so eleven are left. The leader sits ten points above fourteen
      // rivals, and every rival's ceiling (90 + 15) reaches it, so the
      // ceiling test sees fourteen threats. The leader's row carries an
      // alliance point and one rival's the winner's 30 playoff points, so
      // the rows prove what the state says (quick task 261009-vp9).
      //
      // The pooled test locks the leader ONLY if the pool is the award pool:
      // eleven rivals each need ten points, 110 in all, and the award pool of
      // a fifteen team event is 91. A pool that also counted the playoffs
      // would be far larger and the leader would read contending.
      const build = (rivalAward: number) =>
        verdicts(
          district(
            [
              team("frc1", [played(E1, { qual: 99, alliance: 1 }, AWARDS_OPEN)]),
              ...Array.from({ length: 14 }, (_, index) => team(`frc${String(index + 2)}`, [played(E1, index === 0 ? { qual: 60, elim: DISTRICT_ELIM_MAX, award: rivalAward } : { qual: 90 }, AWARDS_OPEN)])),
            ],
            { dcmpSlots: 12 }
          )
        );
      const out = build(0);
      // The ceilings: the award ceiling and nothing else.
      expect(new Set(out.teams.map((entry) => entry.maxRemainingDistrict))).toEqual(new Set([AWARD_MAX]));
      // The pool: the award pool alone.
      expect(teamOf(out, "frc1").districtLock.status).toBe("locked");
      // The floors: award points landing on a rival change nothing.
      expect(locks(build(12))).toEqual(locks(out));
    });

    it("districtRankingsMerge.ts calls corroboratedCategoryFinality in exactly one place, inside publishedCategoryFinality, never calls districtEventCategoryFinality, and never reads the state's playoffs flag itself", () => {
      // Checkouts on this machine are CRLF, so the source is normalised first.
      const source = readFileSync(resolve(HERE, "districtRankingsMerge.ts"), "utf8").replace(/\r\n/g, "\n");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code.split("corroboratedCategoryFinality(").length - 1).toBe(1);
      expect(code.split("districtEventCategoryFinality(").length - 1).toBe(0);
      const helper = /export function publishedCategoryFinality\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(code);
      expect(helper).not.toBeNull();
      expect(helper![1]).toContain("corroboratedCategoryFinality(");
      // The playoffs flag is read by the rule in core and nowhere here.
      expect(code).not.toContain("playoffsDone");
    });
  });
});
