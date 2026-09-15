// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOfflineEventArtifactWithBlock, toScheduleOnly } from "../../../../../packages/harness/fixtures/eventStateArtifactFixture.js";
import { LiveEventArtifactSchema, type TeamSeasonMatch as PublishedTeamSeasonMatch } from "../../../../../packages/harness/pageArtifacts.js";
import { resolveEventArtifact, type EventPageArtifact } from "../../lib/eventPricing.js";
import type { TeamSeasonMatch } from "./matchAxis.js";
import { overlayTeamEventMatches } from "./teamUpcomingOverlay.js";

const TEAM = "frc1";
const PREDICTION_KEYS = ["predictedWinner", "pRedWin", "predictedRedScore", "predictedBlueScore", "redMatchBandVariance", "blueMatchBandVariance", "redRpPmf", "blueRpPmf"];

function teamRow(matchKey: string, matchNumber: number, overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey,
    season: 2026,
    eventKey: "2026test",
    compLevel: "qm",
    algorithmId: "spr",
    algorithmVersion: "4.0.0+test",
    predictedWinner: "red",
    pRedWin: 0.55,
    predictedRedScore: 50,
    predictedBlueScore: 45,
    setNumber: 1,
    matchNumber,
    sortTime: 1_757_937_600_000 + matchNumber * 480_000,
    redTeams: [TEAM, "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    ...overrides,
  };
}

const PLAYED = { actualWinner: "red" as const, actualRedScore: 60, actualBlueScore: 40 };

function eventPlayed(matchKey: string, matchNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    matchKey,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber,
    sortTime: 1_757_937_600_000 + matchNumber * 480_000,
    redTeams: [TEAM, "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    predictedWinner: "blue" as const,
    pRedWin: 0.4,
    predictedRedScore: 48,
    predictedBlueScore: 52,
    redMatchBandVariance: 90,
    blueMatchBandVariance: 80,
    redRpPmf: [0.5, 0.5],
    blueRpPmf: [0.5, 0.5],
    matchOutcomePmf: [0.4, 0.1, 0.5],
    actualWinner: "blue" as const,
    actualRedScore: 41,
    actualBlueScore: 66,
    actualRedRp: 0,
    actualBlueRp: 3,
    video: "abc123",
    ...overrides,
  };
}

function eventScheduleOnly(matchKey: string, matchNumber: number, redTeams: string[] = [TEAM, "frc2", "frc3"]) {
  return { matchKey, compLevel: "qm" as const, setNumber: 1, matchNumber, sortTime: 1_757_937_600_000 + matchNumber * 480_000, redTeams, blueTeams: ["frc4", "frc5", "frc6"] };
}

function eventPriced(matchKey: string, matchNumber: number) {
  const { actualWinner: _w, actualRedScore: _r, actualBlueScore: _b, actualRedRp: _rr, actualBlueRp: _br, video: _v, ...rest } = eventPlayed(matchKey, matchNumber);
  void [_w, _r, _b, _rr, _br, _v];
  return { ...rest, predictedRedScore: 70, predictedBlueScore: 20, pRedWin: 0.9, predictedWinner: "red" as const };
}

function artifact(overrides: Partial<EventPageArtifact>): EventPageArtifact {
  return {
    schemaVersion: 1,
    generation: "tick-1",
    computedAt: "2026-09-15T12:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "4.0.0+test",
    eventKey: "2026test",
    season: 2026,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as EventPageArtifact;
}

const keys = (rows: readonly TeamSeasonMatch[]) => rows.map((row) => row.matchKey);

describe("overlayTeamEventMatches: dedupe", () => {
  it("a played row and a stale unplayed row for one match render as the one played row", () => {
    const stale = teamRow("2026test_qm1", 1);
    const played = teamRow("2026test_qm1", 1, PLAYED);
    for (const matches of [
      [stale, played],
      [played, stale],
    ]) {
      const out = overlayTeamEventMatches({ teamKey: TEAM, event: { eventKey: "2026test", matches }, eventArtifact: undefined });
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(played);
    }
  });

  it("with no event artifact, the deduped team rows come back in published order", () => {
    const matches = [teamRow("2026test_qm3", 3), teamRow("2026test_qm1", 1, PLAYED), teamRow("2026test_qm2", 2), teamRow("2026test_qm3", 3)];
    const out = overlayTeamEventMatches({ teamKey: TEAM, event: { eventKey: "2026test", matches }, eventArtifact: undefined });
    expect(keys(out)).toEqual(["2026test_qm3", "2026test_qm1", "2026test_qm2"]);
    expect(out[0]).toBe(matches[0]);
  });
});

describe("overlayTeamEventMatches: the event artifact over the team artifact", () => {
  it("a match played in the event artifact but unplayed in the team artifact renders played, with the event row's actual scores", () => {
    const matches = [teamRow("2026test_qm1", 1), teamRow("2026test_qm2", 2)];
    const out = overlayTeamEventMatches({
      teamKey: TEAM,
      event: { eventKey: "2026test", matches },
      eventArtifact: artifact({ matches: [eventPlayed("2026test_qm1", 1)], upcoming: [eventPriced("2026test_qm2", 2)] }),
    });
    expect(keys(out)).toEqual(["2026test_qm1", "2026test_qm2"]);
    expect(out[0]).toMatchObject({ actualWinner: "blue", actualRedScore: 41, actualBlueScore: 66, actualRedRp: 0, actualBlueRp: 3, video: "abc123", pRedWin: 0.4, redMatchBandVariance: 90 });
    expect(out[0]).toMatchObject({ season: 2026, eventKey: "2026test", algorithmId: "spr", algorithmVersion: "4.0.0+test" });
    // Event-only fields never leak onto a team row.
    expect(out[0]).not.toHaveProperty("matchOutcomePmf");
  });

  it("a team row already played is kept even when the event artifact also has the match", () => {
    const played = teamRow("2026test_qm1", 1, PLAYED);
    const out = overlayTeamEventMatches({ teamKey: TEAM, event: { eventKey: "2026test", matches: [played] }, eventArtifact: artifact({ matches: [eventPlayed("2026test_qm1", 1)] }) });
    expect(out).toEqual([played]);
  });

  it("a block-priced upcoming row replaces the team artifact's stale priced row with upcomingTeamRows[key]", () => {
    const stale = teamRow("2026test_qm2", 2);
    const browserPriced = teamRow("2026test_qm2", 2, { pRedWin: 0.81, predictedRedScore: 77, redMatchBandVariance: 64 });
    const out = overlayTeamEventMatches({
      teamKey: TEAM,
      event: { eventKey: "2026test", matches: [stale] },
      eventArtifact: artifact({ upcoming: [eventPriced("2026test_qm2", 2)], upcomingTeamRows: { "2026test_qm2": browserPriced as PublishedTeamSeasonMatch } }),
    });
    expect(out).toEqual([browserPriced]);
    expect(out[0]).toBe(browserPriced);
  });

  it("a schedule-only upcoming row replaces the stale row with an unpriced display row (no prediction keys)", () => {
    const stale = teamRow("2026test_qm2", 2);
    const out = overlayTeamEventMatches({ teamKey: TEAM, event: { eventKey: "2026test", matches: [stale] }, eventArtifact: artifact({ upcoming: [eventScheduleOnly("2026test_qm2", 2)] }) });
    expect(out).toHaveLength(1);
    for (const key of PREDICTION_KEYS) expect(out[0], key).not.toHaveProperty(key);
    expect(out[0]).toMatchObject({ matchKey: "2026test_qm2", sortTime: stale.sortTime, redTeams: stale.redTeams, compLevel: "qm", season: 2026 });
    expect(out[0]).not.toHaveProperty("actualWinner");
  });

  it("a published-priced upcoming row with no team row entry keeps the team artifact's own row", () => {
    const own = teamRow("2026test_qm2", 2, { redBonusRp: [0.3, 0.2, 0.1], blueBonusRp: [0.3, 0.2, 0.1] });
    const out = overlayTeamEventMatches({ teamKey: TEAM, event: { eventKey: "2026test", matches: [own] }, eventArtifact: artifact({ upcoming: [eventPriced("2026test_qm2", 2)], upcomingTeamRows: {} }) });
    expect(out[0]).toBe(own);
  });

  it("an upcoming match absent from the team artifact is appended, event-only matches in schedule order after the team's rows", () => {
    const matches = [teamRow("2026test_qm1", 1, PLAYED), teamRow("2026test_qm9", 9)];
    const out = overlayTeamEventMatches({
      teamKey: TEAM,
      event: { eventKey: "2026test", matches },
      eventArtifact: artifact({
        matches: [eventPlayed("2026test_qm4", 4)],
        upcoming: [eventScheduleOnly("2026test_qm6", 6), eventPriced("2026test_qm5", 5), eventScheduleOnly("2026test_qm7", 7, ["frc7", "frc8", "frc9"])],
      }),
    });
    // qm9 is not mentioned by the event artifact and is kept; qm7 does not involve the team.
    expect(keys(out)).toEqual(["2026test_qm1", "2026test_qm9", "2026test_qm4", "2026test_qm5", "2026test_qm6"]);
    expect(out[3]).toMatchObject({ pRedWin: 0.9, predictedRedScore: 70 });
    for (const key of PREDICTION_KEYS) expect(out[4], key).not.toHaveProperty(key);
  });

  it("an upcoming row whose match is played in the event artifact renders once, as played", () => {
    const out = overlayTeamEventMatches({
      teamKey: TEAM,
      event: { eventKey: "2026test", matches: [teamRow("2026test_qm2", 2)] },
      eventArtifact: artifact({ matches: [eventPlayed("2026test_qm2", 2)], upcoming: [eventScheduleOnly("2026test_qm2", 2)] }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.actualWinner).toBe("blue");
  });
});

describe("overlayTeamEventMatches: a real browser-priced artifact", () => {
  it("every upcoming match the team plays renders the offline publisher's team row", async () => {
    const fixture = buildOfflineEventArtifactWithBlock();
    const resolved = await resolveEventArtifact(LiveEventArtifactSchema.parse(JSON.parse(JSON.stringify(toScheduleOnly(fixture.artifact)))));
    const teamKey = resolved.upcoming[0]!.redTeams[0]!;
    const theirs = resolved.upcoming.filter((row) => row.redTeams.includes(teamKey) || row.blueTeams.includes(teamKey));
    expect(theirs.length).toBeGreaterThan(0);

    const out = overlayTeamEventMatches({ teamKey, event: { eventKey: resolved.eventKey, matches: [] }, eventArtifact: resolved });
    const byKey = new Map(out.map((row) => [row.matchKey, row]));
    for (const row of theirs) {
      expect(JSON.parse(JSON.stringify(byKey.get(row.matchKey))), row.matchKey).toStrictEqual(JSON.parse(JSON.stringify(fixture.offlineTeamRowsByMatchKey.get(row.matchKey))));
    }
  });
});
