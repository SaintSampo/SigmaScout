/**
 * 260921-q2s Task 1: `deriveLiveEventStandings`/`withDerivedLiveStandings`
 * (this module's own pure derivation) plus `resolveEventArtifact`'s
 * wiring of it (eventPricing.ts). Every fixture parses through
 * `LiveEventArtifactSchema.parse` directly — `makeEventArtifact` in
 * `src/test/helpers.ts` parses through `EventArtifactSchema`, which does
 * not declare `live` and silently strips it.
 *
 * Task 3 (260921-q2s) extends this same file with the rank-simulation
 * flow-through cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveEventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type LiveEventArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { deriveLiveEventStandings, withDerivedLiveStandings } from "./liveStandings.js";
import { resolveEventArtifact } from "./eventPricing.js";
import { buildSimulationInputs } from "./simulationInputs.js";

type RawMatch = Record<string, unknown>;
type RawTeam = Record<string, unknown>;

function qualMatch(overrides: RawMatch = {}): RawMatch {
  return {
    matchKey: "2026casf_qm1",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [],
    blueTeams: [],
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    actualWinner: "red",
    actualRedScore: 100,
    actualBlueScore: 90,
    ...overrides,
  };
}

function playoffMatch(overrides: RawMatch = {}): RawMatch {
  return { ...qualMatch(overrides), compLevel: "sf", matchKey: overrides.matchKey ?? "2026casf_sf1m1" };
}

function scheduledUpcoming(overrides: RawMatch = {}): RawMatch {
  return {
    matchKey: "2026casf_qm99",
    compLevel: "qm",
    setNumber: 99,
    matchNumber: 99,
    redTeams: [],
    blueTeams: [],
    ...overrides,
  };
}

function team(overrides: RawTeam = {}): RawTeam {
  return { teamKey: "frc1", metrics: {}, ...overrides };
}

function liveArtifact(overrides: RawMatch = {}): LiveEventArtifact {
  return LiveEventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-09-21T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2026casf",
    season: 2026,
    matches: [],
    upcoming: [],
    teams: [],
    live: { metricKeys: [], rows: [] },
    ...overrides,
  });
}

describe("deriveLiveEventStandings — the counted tally", () => {
  it("three played qualification rows yield exact win/loss/tie counts and rp averages, ranked descending, unaffected by a playoff row or an upcoming row", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1" }), team({ teamKey: "frc2" }), team({ teamKey: "frc3" })],
      matches: [
        qualMatch({ matchKey: "2026casf_qm1", redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 }),
        qualMatch({ matchKey: "2026casf_qm2", redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "tie", actualRedRp: 2, actualBlueRp: 1 }),
        qualMatch({ matchKey: "2026casf_qm3", redTeams: ["frc2"], blueTeams: ["frc3"], actualWinner: "blue", actualRedRp: 0, actualBlueRp: 3 }),
        // A playoff row with a deliberately large bonus — must contribute nothing.
        playoffMatch({ matchKey: "2026casf_sf1m1", redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 99, actualBlueRp: 99 }),
      ],
      upcoming: [scheduledUpcoming({ matchKey: "2026casf_qm4", redTeams: ["frc1"], blueTeams: ["frc3"] })],
    });

    const result = deriveLiveEventStandings(artifact)!;
    expect(result.ranked).toBe(true);

    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 1 }, rp: 3, rank: 2 });
    expect(result.rows.get("frc2")).toEqual({ record: { wins: 0, losses: 2, ties: 0 }, rp: 0, rank: 3 });
    expect(result.rows.get("frc3")).toEqual({ record: { wins: 1, losses: 0, ties: 1 }, rp: 3.5, rank: 1 });
  });

  it("with the live key removed, deriveLiveEventStandings returns undefined and withDerivedLiveStandings returns the identical object reference", () => {
    const withLive = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1" })],
      matches: [qualMatch({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 })],
    });
    const artifact = { ...withLive, live: undefined };

    expect(deriveLiveEventStandings(artifact)).toBeUndefined();
    const applied = withDerivedLiveStandings(artifact);
    expect(applied).toBe(artifact);
    expect(applied.teams).toEqual(artifact.teams);
  });

  it("a team present in teams with no played qualification row gets a zero record and sorts last", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1", teamNumber: 1 }), team({ teamKey: "frc2", teamNumber: 2 })],
      matches: [
        // frc3 loses but still earns a nonzero bonus, so its average (1) stays
        // clearly above frc2's zero appearance — the ordering below is
        // unambiguous, not an artifact of the tiebreak.
        qualMatch({ redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 1 }),
      ],
    });

    const result = deriveLiveEventStandings(artifact)!;
    expect(result.ranked).toBe(true);
    expect(result.rows.get("frc2")).toEqual({ record: { wins: 0, losses: 0, ties: 0 }, rp: 0, rank: 3 });
  });

  it("two teams on the identical rp average are ordered by ascending team number", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 0 },
      teams: [team({ teamKey: "frc9", teamNumber: 9 }), team({ teamKey: "frc3", teamNumber: 3 })],
      matches: [
        qualMatch({ matchKey: "2026casf_qm1", redTeams: ["frc9"], blueTeams: ["frc90"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 0 }),
        qualMatch({ matchKey: "2026casf_qm2", redTeams: ["frc3"], blueTeams: ["frc30"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 0 }),
      ],
    });

    const result = deriveLiveEventStandings(artifact)!;
    expect(result.rows.get("frc9")!.rp).toBe(2);
    expect(result.rows.get("frc3")!.rp).toBe(2);
    expect(result.rows.get("frc3")!.rank).toBe(1);
    expect(result.rows.get("frc9")!.rank).toBe(2);
  });

  it("a null actualRedRp makes the whole result unranked — records only, no rp and no rank keys", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1" }), team({ teamKey: "frc2" })],
      matches: [qualMatch({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: null, actualBlueRp: 0 })],
    });

    const result = deriveLiveEventStandings(artifact)!;
    expect(result.ranked).toBe(false);
    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 0 } });
    expect(result.rows.get("frc1")).not.toHaveProperty("rp");
    expect(result.rows.get("frc1")).not.toHaveProperty("rank");
  });

  it("an unranked result never overwrites a team that already carries a published rank — withDerivedLiveStandings returns the artifact untouched", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1", rank: 1 }), team({ teamKey: "frc2" })],
      matches: [qualMatch({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: null, actualBlueRp: 0 })],
    });

    expect(withDerivedLiveStandings(artifact)).toBe(artifact);
  });

  it("an artifact with no rpOutcomeRp behaves the same way as the null-bonus case: unranked, records only", () => {
    const artifact = liveArtifact({
      teams: [team({ teamKey: "frc1" }), team({ teamKey: "frc2" })],
      matches: [qualMatch({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 4, actualBlueRp: 1 })],
    });

    const result = deriveLiveEventStandings(artifact)!;
    expect(result.ranked).toBe(false);
    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 0 } });
  });

  it("a letter-suffixed, non-frc-numeric team key does not throw and is placed by the guarded-parse/key-string fallback", () => {
    const artifact = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1", teamNumber: 1 })],
      matches: [qualMatch({ redTeams: ["frc5199B"], blueTeams: ["frc1"], actualWinner: "blue", actualRedRp: 0, actualBlueRp: 2 })],
    });

    let result: ReturnType<typeof deriveLiveEventStandings>;
    expect(() => {
      result = deriveLiveEventStandings(artifact);
    }).not.toThrow();

    expect(result!.rows.get("frc5199B")).toEqual({ record: { wins: 0, losses: 1, ties: 0 }, rp: 0, rank: 2 });
  });
});

describe("resolveEventArtifact — the applier wired at the artifact entry point", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("a live fixture resolves with counted teams and a ranked standings marker", async () => {
    const fixture = liveArtifact({
      rpOutcomeRp: { win: 2, tie: 1 },
      teams: [team({ teamKey: "frc1" }), team({ teamKey: "frc2" })],
      matches: [qualMatch({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 })],
      upcoming: [],
    });

    const resolved = await resolveEventArtifact(fixture);
    expect(resolved.standings).toEqual({ source: "live-derived", ranked: true });
    expect(resolved.teams.find((t) => t.teamKey === "frc1")).toMatchObject({ record: { wins: 1, losses: 0, ties: 0 }, rp: 3, rank: 1 });
  });

  it("a non-live fixture resolves with a teams array deep-equal to the parsed one and carries no standings marker", async () => {
    const fixture = liveArtifact({
      teams: [team({ teamKey: "frc1" })],
      upcoming: [],
      live: undefined,
    });

    const resolved = await resolveEventArtifact(fixture);
    expect(resolved.teams).toEqual(fixture.teams);
    expect(resolved).not.toHaveProperty("standings");
  });
});

describe("buildSimulationInputs over a derived live artifact — 260921-q2s Task 3", () => {
  // Same three played qual rows as the main tally test above, plus one
  // genuinely unplayed qualification row — the simulation's start match.
  // `matchesPlayed`/`earnedRpSum` below are hand-computed from these rows,
  // not read back from the derivation, so this pins the unit conversion
  // `simulationInputs.ts` and `liveStandings.ts` meet on. DO NOT EDIT
  // simulationInputs.ts if either assertion below fails — the derivation is
  // wrong, not the consumer.
  const rpOutcomeRp = { win: 2, tie: 1 };
  const playedMatches = [
    qualMatch({ matchKey: "2026casf_qm1", setNumber: 1, matchNumber: 1, redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 }),
    qualMatch({ matchKey: "2026casf_qm2", setNumber: 1, matchNumber: 2, redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "tie", actualRedRp: 2, actualBlueRp: 1 }),
    qualMatch({ matchKey: "2026casf_qm3", setNumber: 1, matchNumber: 3, redTeams: ["frc2"], blueTeams: ["frc3"], actualWinner: "blue", actualRedRp: 0, actualBlueRp: 3 }),
  ];
  const unplayedUpcoming = [scheduledUpcoming({ matchKey: "2026casf_qm4", setNumber: 1, matchNumber: 4, redTeams: ["frc1"], blueTeams: ["frc3"] })];
  const START_MATCH_KEY = "2026casf_qm4";

  function stubEventArtifact(): LiveEventArtifact {
    // No published record/rp/rank at all — the Worker-promoted-stub shape
    // this whole quick task exists to fix.
    return liveArtifact({
      rpOutcomeRp,
      teams: [team({ teamKey: "frc1" }), team({ teamKey: "frc2" }), team({ teamKey: "frc3" })],
      matches: playedMatches,
      upcoming: unplayedUpcoming,
    });
  }

  it("the derived baseline recovers the exact integer rp total, matchesPlayed equal to the derived record total, sourced from ranking-score-with-record", () => {
    const derived = withDerivedLiveStandings(stubEventArtifact());
    const inputs = buildSimulationInputs(derived, START_MATCH_KEY);
    expect(inputs).not.toBeNull();
    expect(inputs!.isRewindStart).toBe(false);

    // frc1: outcome+bonus totals 2+1=3 (qm1, win) and 1+2=3 (qm2, tie) = 6 over 2 appearances.
    expect(inputs!.baselines.find((b) => b.teamKey === "frc1")).toEqual({ teamKey: "frc1", earnedRpSum: 6, matchesPlayed: 2 });
    expect(inputs!.baselineSources.get("frc1")).toBe("ranking-score-with-record");

    // frc3: outcome+bonus totals 1+1=2 (qm2, tie) and 2+3=5 (qm3, win) = 7 over 2 appearances.
    expect(inputs!.baselines.find((b) => b.teamKey === "frc3")).toEqual({ teamKey: "frc3", earnedRpSum: 7, matchesPlayed: 2 });
    expect(inputs!.baselineSources.get("frc3")).toBe("ranking-score-with-record");
  });

  it("the same artifact before derivation gives a different, staler baseline — proving the derivation, not simulationInputs.ts, is what moved it", () => {
    const before = stubEventArtifact();
    const inputs = buildSimulationInputs(before, START_MATCH_KEY);
    expect(inputs).not.toBeNull();

    // No team.rp published, so simulationInputs.ts falls to its own
    // summed-actual-rp fallback — the BONUS RP alone (1+2=3), never the
    // outcome+bonus total the derivation above computes (6). Different
    // quantity, different source, on the identical input rows.
    const frc1 = inputs!.baselines.find((b) => b.teamKey === "frc1")!;
    expect(frc1.earnedRpSum).toBe(3);
    expect(frc1.matchesPlayed).toBe(2);
    expect(inputs!.baselineSources.get("frc1")).toBe("summed-actual-rp");
  });
});
