import { describe, expect, it } from "vitest";
import {
  allianceMarkPositions,
  axisTicks,
  computeAxisDomain,
  MATCH_GEOMETRY,
  scaleToPlot,
  type TeamSeasonEvent,
  type TeamSeasonMatch,
} from "./matchAxis.js";

function makeMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    compLevel: "qm",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    redComponents: {},
    blueComponents: {},
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    ...overrides,
  } as TeamSeasonMatch;
}

function makeEvent(matches: TeamSeasonMatch[], overrides: Partial<TeamSeasonEvent> = {}): TeamSeasonEvent {
  return {
    eventKey: "2024casj",
    eventName: "Sacramento Regional",
    startDate: "2024-03-01",
    matches,
    ...overrides,
  } as TeamSeasonEvent;
}

describe("MATCH_GEOMETRY / allianceMarkPositions", () => {
  it("derives dot top and tick top symmetrically about the same centre, via arithmetic on MATCH_GEOMETRY", () => {
    const pos = allianceMarkPositions(12);
    const expectedCentre = 12 + MATCH_GEOMETRY.BAND_H / 2;
    expect(pos.centre).toBe(expectedCentre);
    expect(pos.centre - pos.dotTop).toBe(MATCH_GEOMETRY.DOT_H / 2);
    expect(pos.dotTop - pos.centre).toBe(-(MATCH_GEOMETRY.DOT_H / 2));
    expect(pos.centre - pos.tickTop).toBe(MATCH_GEOMETRY.TICK_H / 2);
    expect(pos.centre - pos.bandTop).toBe(MATCH_GEOMETRY.BAND_H / 2);
  });

  it("positions red and blue 12px apart at centre, per Y_RED/Y_BLUE", () => {
    const red = allianceMarkPositions(MATCH_GEOMETRY.Y_RED);
    const blue = allianceMarkPositions(MATCH_GEOMETRY.Y_BLUE);
    expect(blue.centre - red.centre).toBe(MATCH_GEOMETRY.Y_BLUE - MATCH_GEOMETRY.Y_RED);
  });
});

describe("computeAxisDomain", () => {
  it("includes a scheduled match's predicted score even when it sits outside the played range", () => {
    const played = [
      makeMatch({ matchKey: "m1", predictedRedScore: 200, predictedBlueScore: 210, actualWinner: "red", actualRedScore: 205, actualBlueScore: 195 }),
      makeMatch({ matchKey: "m2", predictedRedScore: 290, predictedBlueScore: 300, actualWinner: "blue", actualRedScore: 280, actualBlueScore: 300 }),
    ];
    const scheduled = makeMatch({ matchKey: "m3", predictedRedScore: 400, predictedBlueScore: 380 });
    const domain = computeAxisDomain([makeEvent([...played, scheduled])]);
    expect(domain.max).toBeGreaterThan(400);
  });

  it("keeps the domain identical before and after a scheduled match becomes played with a result inside the existing range", () => {
    const scheduled = makeMatch({ matchKey: "m1", predictedRedScore: 250, predictedBlueScore: 240 });
    const before = computeAxisDomain([makeEvent([scheduled, makeMatch({ matchKey: "m2", predictedRedScore: 200, predictedBlueScore: 300 })])]);

    const played = { ...scheduled, actualWinner: "red" as const, actualRedScore: 255, actualBlueScore: 235 };
    const after = computeAxisDomain([makeEvent([played, makeMatch({ matchKey: "m2", predictedRedScore: 200, predictedBlueScore: 300 })])]);

    expect(after).toEqual(before);
  });

  it("does not anchor the lower bound at zero for a fixture whose lowest value is 180", () => {
    const domain = computeAxisDomain([
      makeEvent([makeMatch({ matchKey: "m1", predictedRedScore: 180, predictedBlueScore: 300, actualWinner: "blue", actualRedScore: 180, actualBlueScore: 300 })]),
    ]);
    expect(domain.min).toBeGreaterThan(0);
  });

  it("never runs below zero — no FRC alliance score can be negative", () => {
    // A low-scoring team: the raw minimum is 3, and MIN_DOMAIN_PADDING (10)
    // would otherwise carry the domain to -7, labelling a stretch of plot no
    // mark can ever reach. This is the real defect seen on frc118/2024, whose
    // axis started at -14.
    const domain = computeAxisDomain([
      {
        matches: [
          { predictedRedScore: 3, predictedBlueScore: 8, actualRedScore: 0, actualBlueScore: 12 },
          { predictedRedScore: 40, predictedBlueScore: 55, actualRedScore: 44, actualBlueScore: 60 },
        ],
      },
    ] as never);

    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThan(60);
  });

  it("includes each alliance's own predicted-score variance band, not just the point prediction", () => {
    const domain = computeAxisDomain([
      makeEvent([makeMatch({ matchKey: "m1", predictedRedScore: 250, predictedBlueScore: 250, redScoreVarianceOwn: 400, blueScoreVarianceOwn: 100 })]),
    ]);
    // sqrt(400) = 20, so the red band's upper edge sits at 270 plus padding.
    expect(domain.max).toBeGreaterThanOrEqual(270);
  });

  it("degrades to a safe fallback domain for a team-season with zero matches", () => {
    const domain = computeAxisDomain([]);
    expect(domain.min).toBeLessThan(domain.max);
  });
});

describe("scaleToPlot", () => {
  it("maps the domain's own endpoints to the plot's own endpoints", () => {
    const domain = { min: 100, max: 300 };
    expect(scaleToPlot(100, domain, 470)).toBe(0);
    expect(scaleToPlot(300, domain, 470)).toBe(470);
    expect(scaleToPlot(200, domain, 470)).toBe(235);
  });

  it("returns the plot's midpoint for a degenerate zero-width domain", () => {
    const domain = { min: 250, max: 250 };
    expect(scaleToPlot(250, domain, 470)).toBe(235);
  });
});

describe("axisTicks", () => {
  it("returns at least two ticks and includes both domain endpoints", () => {
    const domain = { min: 170, max: 330 };
    const ticks = axisTicks(domain);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBe(170);
    expect(ticks[ticks.length - 1]).toBe(330);
  });

  it("never anchors the lowest tick at zero for a fixture whose lowest value is 180", () => {
    const domain = { min: 180, max: 300 };
    const ticks = axisTicks(domain);
    expect(ticks[0]).not.toBe(0);
    expect(ticks[0]).toBe(180);
  });
});
