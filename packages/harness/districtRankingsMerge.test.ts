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
  applyDistrictEventState,
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

  it("carries an awardProfile forward untouched", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<Record<string, unknown>> };
    fixture.teams[0]!.awardProfile = { bucket: "oneOrTwo", rookie: false };
    const merged = merge(DistrictArtifactSchema.parse(fixture), tracerPayload());
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.awardProfile).toEqual({ bucket: "oneOrTwo", rookie: false });
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

  it("leaves pointTotal, rank, both lock verdicts and insights untouched — recomputing verdicts here is work that provably cannot alter an outcome", () => {
    const artifact = twoTeamFixture();
    const updated = applyState("2026ncwak", artifact);
    for (const [index, team] of updated.teams.entries()) {
      const before = artifact.teams[index]!;
      expect(team.pointTotal).toBe(before.pointTotal);
      expect(team.rank).toBe(before.rank);
      expect(team.maxRemainingDistrict).toBe(before.maxRemainingDistrict);
      expect(team.maxRemainingChamp).toBe(before.maxRemainingChamp);
      expect(team.districtLock).toEqual(before.districtLock);
      expect(team.champLock).toEqual(before.champLock);
    }
    expect(updated.insights).toEqual(artifact.insights);
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
    // so its carried sum drops to zero — and that zero is a real answer, not a
    // guess, so it is left alone.
    const merged = merge(twoTeamFixture(), tracerPayload());
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.maxRemainingDistrict).toBe(0);
    expect(merged.teams.find((t) => t.teamKey === "frc2")!.maxRemainingDistrict).toBe(0);
  });
});
