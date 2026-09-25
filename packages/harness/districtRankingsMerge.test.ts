/**
 * Coverage for `districtRankingsMerge.ts` — the one shared producer of the
 * merged district shape. The first test in this file is the TRACER: a real
 * published-shape district artifact plus a real TBA-shaped rankings payload
 * go through `applyDistrictRankings` and come out as a schema-valid artifact
 * with recomputed verdicts. Everything after it is a refusal, a
 * carry-forward, or a never-invent-metadata pin.
 */
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "./pageArtifacts.js";
import {
  applyDistrictRankings,
  DistrictMergeError,
  DistrictRankingsEventPointsEntrySchema,
  DistrictRankingsPayloadSchema,
  DistrictRankingsRowSchema,
  recomputeDistrictVerdicts,
} from "./districtRankingsMerge.js";

const GENERATION = "gen-merge-test";
const COMPUTED_AT = "2026-03-14T12:00:00.000Z";

/** 2026 district-tier event maximum: 22 + 16 + 30 + 15. */
const DISTRICT_EVENT_MAX = 83;
/** 2026 dcmp-tier event maximum: three times the district tier. */
const DCMP_EVENT_MAX = 249;

function lockVerdict(status: DistrictArtifact["teams"][number]["districtLock"]["status"]) {
  return { status, pointsToLock: null as number | null, threatCount: 0, cutLinePoints: null as number | null, allocationNote: null as string | null };
}

/**
 * Two teams, one played event each, one event still ahead for `frc1` only.
 * `frc1`'s `districtLock.status` is deliberately WRONG (`"contending"` when
 * the merge will recompute `"locked"`) so a carried-over verdict fails
 * loudly rather than passing by accident.
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
    dcmpSlots: 1,
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
        eventPoints: [{ eventKey: "2026ncwak", eventName: "Wake County Event", week: 1, tier: "district", qual: 20, alliance: 10, elim: 5, award: 5, total: 40 }],
        remainingEvents: [{ eventKey: "2026ncpem", eventName: "Pembroke Event", week: 3, tier: "district", maxPoints: DISTRICT_EVENT_MAX }],
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
        eventPoints: [{ eventKey: "2026ncwak", eventName: "Wake County Event", week: 1, tier: "district", qual: 15, alliance: 8, elim: 2, award: 5, total: 30 }],
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

function eventPointsEntry(eventKey: string, total: number, districtCmp = false) {
  return {
    event_key: eventKey,
    district_cmp: districtCmp,
    qual_points: total,
    alliance_points: 0,
    elim_points: 0,
    award_points: 0,
    total,
  };
}

/** `frc1` played `2026ncpem` for 50 more points; `frc2` is unchanged. */
function tracerPayload() {
  return [
    {
      team_key: "frc1",
      rank: 1,
      point_total: 90,
      rookie_bonus: 0,
      adjustments: 0,
      event_points: [eventPointsEntry("2026ncwak", 40), eventPointsEntry("2026ncpem", 50)],
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
    // 5. maxRemainingDistrict dropped by that event's ceiling.
    expect(artifact.teams[0]!.maxRemainingDistrict - teamA.maxRemainingDistrict).toBe(DISTRICT_EVENT_MAX);
    expect(teamA.maxRemainingDistrict).toBe(0);
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
    expect(newcomer.maxRemainingDistrict).toBe(0);
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
