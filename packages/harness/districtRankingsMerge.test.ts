/**
 * Coverage for `districtRankingsMerge.ts` — the one shared producer of the
 * merged district shape. The first test in this file is the TRACER: a real
 * published-shape district artifact plus a real TBA-shaped rankings payload
 * go through `applyDistrictRankings` and come out as a schema-valid artifact
 * with recomputed verdicts. Everything after it is a refusal, a
 * carry-forward, or a never-invent-metadata pin.
 */
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type DistrictArtifact } from "./pageArtifacts.js";
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

  it("carries an awardProfile forward untouched, priorJudgedAwards included", () => {
    const fixture = twoTeamFixture() as unknown as { teams: Array<Record<string, unknown>> };
    fixture.teams[0]!.awardProfile = { bucket: "oneOrTwo", rookie: false, priorJudgedAwards: 2 };
    const merged = merge(DistrictArtifactSchema.parse(fixture), tracerPayload());
    // The ordering key has to survive the live merge: a Worker tick that
    // dropped it would silently take every promoted event off the ordering path
    // and back onto the base rate, and nothing on the page would say so.
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.awardProfile).toEqual({ bucket: "oneOrTwo", rookie: false, priorJudgedAwards: 2 });
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

  it("leaves pointTotal, rank and the ceilings untouched, and leaves the verdicts at the recompute's fixed point — which CAN differ from before, since an observed state shrinks the remaining pool", () => {
    // The fixture's verdicts are hand-written stubs; a published artifact is
    // already at the recompute's fixed point, so that is the reference here.
    const artifact = recomputeDistrictVerdicts(twoTeamFixture());
    const updated = applyState("2026ncwak", artifact);
    for (const [index, team] of updated.teams.entries()) {
      const before = artifact.teams[index]!;
      expect(team.pointTotal).toBe(before.pointTotal);
      expect(team.rank).toBe(before.rank);
      expect(team.maxRemainingDistrict).toBe(before.maxRemainingDistrict);
      expect(team.maxRemainingChamp).toBe(before.maxRemainingChamp);
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
    // so its carried sum drops to zero — and that zero is a real answer, not a
    // guess, so it is left alone.
    const merged = merge(twoTeamFixture(), tracerPayload());
    expect(merged.teams.find((t) => t.teamKey === "frc1")!.maxRemainingDistrict).toBe(0);
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
