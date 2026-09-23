/**
 * The counted live standings, moved into the tick by quick task 260923-3w7.
 *
 * This file is `apps/web/src/lib/liveStandings.test.ts` (260921-q2s) carried
 * over: the same cases, the same hand-computed expectations, against the same
 * arithmetic in its new home. Two things changed with the move and nothing
 * else did:
 *
 *   - the `artifact.live !== undefined` trigger is gone (nothing emits a `live`
 *     block since 260923-3w6), so the cases that pinned it are replaced by the
 *     structural trigger this module actually has: a played qualification row;
 *   - the browser fixtures parsed through `LiveEventArtifactSchema`; here the
 *     inputs are plain objects, because this module takes the narrow row shapes
 *     it reads and never a whole artifact.
 *
 * The final describe pins the wiring in `mergeEventArtifact`, which is the only
 * caller.
 */
import { describe, expect, it } from "vitest";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type LiveEventArtifact } from "../../../packages/harness/pageArtifacts.js";
import { mergeEventArtifact } from "../src/artifactMerge.js";
import { deriveEventStandings, withCountedStandings, type StandingsMatchRow, type StandingsTeamRow } from "../src/liveStandings.js";

const RP_OUTCOME_RP = { win: 2, tie: 1 };

function qual(overrides: Partial<StandingsMatchRow> = {}): StandingsMatchRow {
  return { compLevel: "qm", redTeams: [], blueTeams: [], actualWinner: "red", ...overrides };
}

function playoff(overrides: Partial<StandingsMatchRow> = {}): StandingsMatchRow {
  return { ...qual(overrides), compLevel: "sf" };
}

function team(teamKey: string, overrides: Partial<StandingsTeamRow> = {}): StandingsTeamRow {
  return { teamKey, ...overrides };
}

describe("deriveEventStandings — the counted tally", () => {
  it("three played qualification rows yield exact win/loss/tie counts and rp averages, ranked descending, unaffected by a playoff row", () => {
    const result = deriveEventStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams: [team("frc1"), team("frc2"), team("frc3")],
      matches: [
        qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 }),
        qual({ redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "tie", actualRedRp: 2, actualBlueRp: 1 }),
        qual({ redTeams: ["frc2"], blueTeams: ["frc3"], actualWinner: "blue", actualRedRp: 0, actualBlueRp: 3 }),
        // A playoff row with a deliberately large bonus — must contribute nothing.
        playoff({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 99, actualBlueRp: 99 }),
      ],
    })!;

    expect(result.ranked).toBe(true);
    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 1 }, rp: 3, rank: 2 });
    expect(result.rows.get("frc2")).toEqual({ record: { wins: 0, losses: 2, ties: 0 }, rp: 0, rank: 3 });
    expect(result.rows.get("frc3")).toEqual({ record: { wins: 1, losses: 0, ties: 1 }, rp: 3.5, rank: 1 });
  });

  it("the counted rp average times the counted appearances recovers the exact integer outcome+bonus total the rank simulation's baseline needs", () => {
    // Carried over from the browser suite's `buildSimulationInputs` case: the
    // rank simulation reads `team.rp` and `team.record` off this artifact and
    // multiplies them back out (`ranking-score-with-record`), so the published
    // pair has to recover the integer total exactly, not approximately.
    const result = deriveEventStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams: [team("frc1"), team("frc2"), team("frc3")],
      matches: [
        qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 }),
        qual({ redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "tie", actualRedRp: 2, actualBlueRp: 1 }),
        qual({ redTeams: ["frc2"], blueTeams: ["frc3"], actualWinner: "blue", actualRedRp: 0, actualBlueRp: 3 }),
      ],
    })!;

    // frc1: 2+1=3 (win) and 1+2=3 (tie) = 6 over 2 appearances.
    const frc1 = result.rows.get("frc1")!;
    const frc1Played = frc1.record.wins + frc1.record.losses + frc1.record.ties;
    expect(frc1Played).toBe(2);
    expect(frc1.rp! * frc1Played).toBe(6);

    // frc3: 1+1=2 (tie) and 2+3=5 (win) = 7 over 2 appearances.
    const frc3 = result.rows.get("frc3")!;
    const frc3Played = frc3.record.wins + frc3.record.losses + frc3.record.ties;
    expect(frc3Played).toBe(2);
    expect(frc3.rp! * frc3Played).toBe(7);
  });

  it("with no played qualification row, deriveEventStandings returns undefined and withCountedStandings returns the identical array reference", () => {
    const teams = [team("frc1")];
    const input = { rpOutcomeRp: RP_OUTCOME_RP, teams, matches: [playoff({ redTeams: ["frc1"], blueTeams: ["frc2"], actualRedRp: 1, actualBlueRp: 0 })] };

    expect(deriveEventStandings(input)).toBeUndefined();
    const applied = withCountedStandings(input);
    expect(applied.teams).toBe(teams);
    expect(applied.standings).toBeUndefined();
  });

  it("a team present in teams with no played qualification row gets a zero record and sorts last", () => {
    const result = deriveEventStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams: [team("frc1", { teamNumber: 1 }), team("frc2", { teamNumber: 2 })],
      // frc3 loses but still earns a nonzero bonus, so its average (1) stays
      // clearly above frc2's zero appearance — the ordering below is
      // unambiguous, not an artifact of the tiebreak.
      matches: [qual({ redTeams: ["frc1"], blueTeams: ["frc3"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 1 })],
    })!;

    expect(result.ranked).toBe(true);
    expect(result.rows.get("frc2")).toEqual({ record: { wins: 0, losses: 0, ties: 0 }, rp: 0, rank: 3 });
  });

  it("two teams on the identical rp average are ordered by ascending team number", () => {
    const result = deriveEventStandings({
      rpOutcomeRp: { win: 2, tie: 0 },
      teams: [team("frc9", { teamNumber: 9 }), team("frc3", { teamNumber: 3 })],
      matches: [
        qual({ redTeams: ["frc9"], blueTeams: ["frc90"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 0 }),
        qual({ redTeams: ["frc3"], blueTeams: ["frc30"], actualWinner: "red", actualRedRp: 0, actualBlueRp: 0 }),
      ],
    })!;

    expect(result.rows.get("frc9")!.rp).toBe(2);
    expect(result.rows.get("frc3")!.rp).toBe(2);
    expect(result.rows.get("frc3")!.rank).toBe(1);
    expect(result.rows.get("frc9")!.rank).toBe(2);
  });

  it("a null actualRedRp makes the whole result unranked — records only, no rp and no rank keys", () => {
    const result = deriveEventStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams: [team("frc1"), team("frc2")],
      matches: [qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: null, actualBlueRp: 0 })],
    })!;

    expect(result.ranked).toBe(false);
    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 0 } });
    expect(result.rows.get("frc1")).not.toHaveProperty("rp");
    expect(result.rows.get("frc1")).not.toHaveProperty("rank");
  });

  it("an unranked result never overwrites a team that already carries a published rank — withCountedStandings returns the rows untouched", () => {
    const teams = [team("frc1", { rank: 1 }), team("frc2")];
    const applied = withCountedStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams,
      matches: [qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: null, actualBlueRp: 0 })],
    });
    expect(applied.teams).toBe(teams);
    // No marker either: an artifact whose standings are still TBA's must never claim they were counted here.
    expect(applied.standings).toBeUndefined();
  });

  it("no rpOutcomeRp behaves the same way as the null-bonus case: unranked, records only", () => {
    const result = deriveEventStandings({
      teams: [team("frc1"), team("frc2")],
      matches: [qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 4, actualBlueRp: 1 })],
    })!;

    expect(result.ranked).toBe(false);
    expect(result.rows.get("frc1")).toEqual({ record: { wins: 1, losses: 0, ties: 0 } });
  });

  it("a letter-suffixed, non-frc-numeric team key does not throw and is placed by the guarded-parse/key-string fallback", () => {
    const input = {
      rpOutcomeRp: RP_OUTCOME_RP,
      teams: [team("frc1", { teamNumber: 1 })],
      matches: [qual({ redTeams: ["frc5199B"], blueTeams: ["frc1"], actualWinner: "blue" as const, actualRedRp: 0, actualBlueRp: 2 })],
    };

    let result: ReturnType<typeof deriveEventStandings>;
    expect(() => {
      result = deriveEventStandings(input);
    }).not.toThrow();

    expect(result!.rows.get("frc5199B")).toEqual({ record: { wins: 0, losses: 1, ties: 0 }, rp: 0, rank: 2 });
  });

  it("withCountedStandings leaves a teams row outside the counted pool untouched and never reorders the array", () => {
    const teams = [team("frc2", { teamNumber: 2 }), team("frc1", { teamNumber: 1 })];
    const applied = withCountedStandings({
      rpOutcomeRp: RP_OUTCOME_RP,
      teams,
      matches: [qual({ redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 })],
    });

    // Positions preserved: rank is a FIELD, never the row's index.
    expect(applied.teams.map((row) => row.teamKey)).toEqual(["frc2", "frc1"]);
    expect(applied.teams[1]).toMatchObject({ teamKey: "frc1", rank: 1 });
    expect(teams[0]).not.toHaveProperty("rank");
    expect(applied.standings).toEqual({ source: "tick-counted", ranked: true });
  });
});

describe("mergeEventArtifact wiring", () => {
  const EVENT_KEY = "2026casf";

  function existingArtifact(): LiveEventArtifact {
    return {
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "published-gen",
      computedAt: "2026-09-20T00:00:00.000Z",
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      eventKey: EVENT_KEY,
      season: 2026,
      rpOutcomeRp: RP_OUTCOME_RP,
      matches: [
        { matchKey: `${EVENT_KEY}_qm1`, compLevel: "qm", setNumber: 1, matchNumber: 1, redTeams: ["frc1"], blueTeams: ["frc2"], actualWinner: "red", actualRedRp: 1, actualBlueRp: 0 },
        { matchKey: `${EVENT_KEY}_qm2`, compLevel: "qm", setNumber: 1, matchNumber: 2, redTeams: ["frc2"], blueTeams: ["frc1"], actualWinner: "red", actualRedRp: 3, actualBlueRp: 0 },
      ],
      upcoming: [],
      // The published standings are deliberately WRONG for these rows: a stale
      // rank frozen at publish time is exactly what the tick now corrects.
      teams: [
        { teamKey: "frc1", teamNumber: 1, nickname: "One", metrics: {}, rank: 1, record: { wins: 9, losses: 9, ties: 9 }, rp: 99 },
        { teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: {}, rank: 2, record: { wins: 9, losses: 9, ties: 9 }, rp: 99 },
      ],
    } as unknown as LiveEventArtifact;
  }

  it("the merged teams rows carry the counted record, rp and rank, replacing the stale published standings", () => {
    const merged = mergeEventArtifact({
      existing: existingArtifact(),
      eventKey: EVENT_KEY,
      season: 2026,
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      eventType: 0,
      newlyFolded: [],
      newPredictions: new Map(),
      upcoming: [],
      touchedTeams: [],
      touchedMetrics: {},
      newBands: new Map(),
      playedRowFacts: new Map(),
      stamp: { generation: "tick-1", computedAt: "2026-09-23T00:00:00.000Z" },
    }) as { teams: { teamKey: string; rank?: number; rp?: number; record?: { wins: number; losses: number; ties: number } }[] };

    // frc1: win (2+1=3) then loss (0+0=0) = 3 over 2 appearances.
    // frc2: loss (0+0=0) then win (2+3=5) = 5 over 2 appearances.
    expect(merged.teams).toEqual([
      expect.objectContaining({ teamKey: "frc1", record: { wins: 1, losses: 1, ties: 0 }, rp: 1.5, rank: 2 }),
      expect.objectContaining({ teamKey: "frc2", record: { wins: 1, losses: 1, ties: 0 }, rp: 2.5, rank: 1 }),
    ]);
  });
});
