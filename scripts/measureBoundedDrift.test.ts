/**
 * The bounded-drift instrument's verdict is computed, never argued, so the
 * function that computes it is what gets tested: every branch of the committed
 * bar, the gate's priority over everything else, and the row comparison's
 * treatment of a surface that is absent on one side only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import { BOUNDED_DRIFT_BAR, matchRowsEqual, missedLeagueSteps, verdictOf, type EventDrift, type HorizonResult } from "./measureBoundedDrift.js";
import type { ArmRows } from "./measureReplayParity.js";

function horizon(h: number, windows: number, exact: number): HorizonResult {
  return { horizon: h, windows, exact, exactShare: exact / windows, medianMissedLeagueSteps: 0, maxMissedLeagueSteps: 0 };
}

/** An event whose windows are all exact up to `allExactThrough`, then one short at every later horizon. */
function event(eventKey: string, allExactThrough: number, overrides: Record<number, number> = {}): EventDrift {
  const horizons: HorizonResult[] = [];
  for (let h = 1; h <= 8; h++) horizons.push(horizon(h, 100, overrides[h] ?? (h <= allExactThrough ? 100 : 99)));
  let largest = 0;
  for (const r of horizons) {
    if (r.exact !== r.windows) break;
    largest = r.horizon;
  }
  return { eventKey, matches: 100, horizons, largestAllExactHorizon: largest };
}

describe("verdictOf applies the committed bar mechanically", () => {
  it("the gate comes first: one inexact window at h=1 discards the pass whatever else is true", () => {
    expect(verdictOf([event("a", 8), event("b", 0)])).toBe("DISCARDED: validity gate failed");
    expect(verdictOf([])).toBe("DISCARDED: validity gate failed");
  });

  it("IT WORKED needs every event all-exact through the floor horizon", () => {
    expect(verdictOf([event("a", BOUNDED_DRIFT_BAR.workedMinHorizon), event("b", 8)])).toBe("IT WORKED");
    // One event a single horizon short of the floor is not a pass.
    expect(verdictOf([event("a", BOUNDED_DRIFT_BAR.workedMinHorizon - 1), event("b", 8)])).toBe("INCONCLUSIVE");
  });

  it("IT DID NOT WORK when any one event falls under 99 percent at h=2, and exactly 99 percent is not under it", () => {
    expect(verdictOf([event("a", 8), event("b", 1, { 2: 98 })])).toBe("IT DID NOT WORK");
    expect(verdictOf([event("a", 8), event("b", 1, { 2: 99 })])).toBe("INCONCLUSIVE");
  });

  it("a horizon the event is too short to reach is not read as a failure", () => {
    const short: EventDrift = { eventKey: "c", matches: 1, horizons: [horizon(1, 1, 1)], largestAllExactHorizon: 1 };
    expect(verdictOf([short])).toBe("INCONCLUSIVE");
  });
});

describe("matchRowsEqual", () => {
  const match = { matchKey: "2026x_qm1", redTeams: ["frc1", "frc2", "frc9991"], blueTeams: ["frc4", "frc5", "frc6"] } as unknown as MatchResult;

  function rows(mutate?: (r: ArmRows) => void): ArmRows {
    const r: ArmRows = {
      eventRows: new Map([[match.matchKey, { pRedWin: 0.61 }]]),
      teamRows: new Map(),
      historyMetrics: new Map(),
      rawPredictions: new Map(),
      rawHistoryMetrics: new Map(),
      unroundedEventRows: new Map(),
      unroundedTeamRows: new Map(),
      unroundedHistory: new Map(),
    };
    // The demo robot frc9991 has no team row on either side.
    for (const teamKey of ["frc1", "frc2", "frc4", "frc5", "frc6"]) {
      r.teamRows.set(`${teamKey}|${match.matchKey}`, { result: "W" });
      r.historyMetrics.set(`${teamKey}|${match.matchKey}`, { total: { value: 10 } });
    }
    mutate?.(r);
    return r;
  }

  it("equal surfaces are equal, and a robot with no row on EITHER side does not break that", () => {
    expect(matchRowsEqual(rows(), rows(), match)).toBe(true);
  });

  it("a moved event field, a moved history value, and a row present on one side only are each a difference", () => {
    expect(matchRowsEqual(rows(), rows((r) => r.eventRows.set(match.matchKey, { pRedWin: 0.62 })), match)).toBe(false);
    expect(matchRowsEqual(rows(), rows((r) => r.historyMetrics.set(`frc4|${match.matchKey}`, { total: { value: 10.01 } })), match)).toBe(false);
    expect(matchRowsEqual(rows(), rows((r) => r.teamRows.delete(`frc5|${match.matchKey}`)), match)).toBe(false);
    expect(matchRowsEqual(rows(), rows((r) => r.eventRows.delete(match.matchKey)), match)).toBe(false);
  });
});

describe("missedLeagueSteps", () => {
  it("counts other events' matches only: the stream span minus this event's own matches inside it", () => {
    expect(missedLeagueSteps(100, 100, 0)).toBe(0);
    // Matches k and k+2 of the event sit 30 stream positions apart, with 2 of this event's own folds between them.
    expect(missedLeagueSteps(100, 130, 2)).toBe(28);
  });
});

describe("safety, inherited rather than restated", () => {
  it("imports no network or signing module and reads no environment variable", () => {
    const source = readFileSync(new URL("./measureBoundedDrift.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/r2Client|@aws-sdk|aws4fetch|process\.env|\bfetch\(/);
  });
});
