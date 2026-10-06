/**
 * `measureDistrictCutoff.ts`' coverage (fast task 261006, todo
 * `district-cutoff-line-backtest`).
 *
 * THREE JOBS:
 *
 *   1. The backtest runs end to end on the COMMITTED 2026 PNW district fixture
 *      with its eight event artifacts, scoring the season start and the three
 *      week end positions before the season settles, and every leak check
 *      passes. The event artifacts are local only (gitignored), so this block
 *      is skipped where they are absent and runs on every machine that has them.
 *   2. The pre-registered gate refuses on each failing condition, including
 *      coverage one position either side of the 72% to 88% band.
 *   3. The measurement positions are season start plus the last step of each
 *      week, and never the settled now position.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, EventArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import {
  backtestDistrict,
  coverageInBand,
  districtEventKeysOf,
  districtTimelineOf,
  gateVerdict,
  measurementPositions,
  type BacktestSummary,
  type LineStats,
} from "./measureDistrictCutoff.js";

const FINAL_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const FIXTURE_DIR = "data/fixtures/phase10";

/** The committed fixture predates `state`; stamp an all final block on every event row, as the champ backtest's test does. */
function stampedFixture(): DistrictArtifact {
  const raw = JSON.parse(readFileSync(`${FIXTURE_DIR}/district-2026pnw.json`, "utf8")) as {
    teams: { eventPoints: Record<string, unknown>[]; remainingEvents: Record<string, unknown>[] }[];
  };
  for (const team of raw.teams) {
    for (const row of team.eventPoints) row.state = FINAL_STATE;
    for (const row of team.remainingEvents) row.state = FINAL_STATE;
  }
  return DistrictArtifactSchema.parse(raw);
}

function fixtureEvents(artifact: DistrictArtifact): Map<string, EventArtifact> {
  const out = new Map<string, EventArtifact>();
  for (const eventKey of districtEventKeysOf(artifact)) {
    const path = `${FIXTURE_DIR}/event-${eventKey}.json`;
    if (existsSync(path)) out.set(eventKey, EventArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
  }
  return out;
}

const eventFixturesPresent = existsSync(`${FIXTURE_DIR}/event-2026wabon.json`);

describe.skipIf(!eventFixturesPresent)("backtestDistrict on the committed 2026 PNW fixture", () => {
  const artifact = stampedFixture();
  const events = fixtureEvents(artifact);
  const outcome = backtestDistrict(artifact, events);

  it("loads all eight district tier event artifacts", () => {
    expect(districtEventKeysOf(artifact)).toHaveLength(8);
    expect(events.size).toBe(8);
  });

  it("scores the season start and the three week ends before the season settles, and counts the last week end as settled", () => {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const scored = outcome.backtest.outcomes.filter((o) => o.kind === "scored");
    expect(scored.map((o) => (o.kind === "scored" ? o.row.label : ""))).toEqual(["Season start", "After week 1", "After week 2", "After week 3"]);
    expect(outcome.backtest.outcomes.filter((o) => o.kind === "settled")).toHaveLength(1);
    expect(outcome.backtest.eventsWithoutArtifact).toEqual([]);
  });

  it("targets the tab's own settled cutoff and reports TBA's line beside it", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    // The District Locks tab's settled line for 2026 PNW is 59; TBA publishes 82 on a different total.
    expect(outcome.backtest.settled).toBe(59);
    expect(outcome.backtest.published).toBe(82);
  });

  it("passes every leak check at every scored position", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    for (const o of outcome.backtest.outcomes) {
      if (o.kind !== "scored") continue;
      expect(o.row.leaks).toEqual({ awardsFromFinalEventsOnly: true, earnedNeverAhead: true, openEventsOpenInRows: true });
      expect(o.row.unpricedEvents).toBe(0);
    }
  });

  it("prints each line inside its own likely range, at the seeded values", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    const rows = outcome.backtest.outcomes.flatMap((o) => (o.kind === "scored" ? [o.row] : []));
    for (const row of rows) {
      expect(row.p10).toBeLessThanOrEqual(row.simulated);
      expect(row.simulated).toBeLessThanOrEqual(row.p90);
    }
    // Recorded from the first run on the fixture: 1000 draws, seed 20260830. Open events shrink 8, 6, 4, 2.
    expect(rows.map((row) => row.simulated)).toEqual(SEEDED_SIMULATED);
    expect(rows.map((row) => row.midpoint)).toEqual(SEEDED_MIDPOINT);
    expect(rows.map((row) => row.openEvents)).toEqual([8, 6, 4, 2]);
  });

  it("derives the measurement positions as season start plus the last step of each week, never now", () => {
    const timeline = districtTimelineOf(artifact, events);
    const positions = measurementPositions(timeline);
    expect(positions[0]).toEqual({ index: 0, label: "Season start" });
    expect(positions.map((p) => p.label)).toEqual(["Season start", "After week 1", "After week 2", "After week 3", "After week 4"]);
    for (const position of positions) expect(position.index).toBeLessThan(timeline.nowIndex);
  });
});

/** Recorded from the first run of the test above. The fixture is the 2026-09-25 publish, so its stored odds differ from the current local publish set. */
const SEEDED_SIMULATED = [58, 57, 58, 57];
const SEEDED_MIDPOINT = [53, 53, 54, 54];

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function stats(mae: number, bias: number, n = 500): LineStats {
  return { n, mae, bias };
}

function passingSummary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    n: 500,
    simulatedVsSettled: stats(6, 1),
    midpointVsSettled: stats(9, -4),
    coveredSettled: 400,
    simulatedVsPublished: stats(20, -15),
    midpointVsPublished: stats(24, -20),
    nPublished: 500,
    coveredPublished: 100,
    ...overrides,
  };
}

describe("gateVerdict", () => {
  it("is GO when both conditions hold, at both ends of the coverage band", () => {
    expect(gateVerdict(passingSummary()).go).toBe(true);
    expect(gateVerdict(passingSummary({ coveredSettled: 360 })).go).toBe(true);
    expect(gateVerdict(passingSummary({ coveredSettled: 440 })).go).toBe(true);
  });

  it("is NO-GO when the simulated MAE does not beat the midpoint rule's", () => {
    const verdict = gateVerdict(passingSummary({ simulatedVsSettled: stats(9, 1) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[0]!.pass).toBe(false);
  });

  it("is NO-GO one position outside the band on either side", () => {
    expect(gateVerdict(passingSummary({ coveredSettled: 359 })).go).toBe(false);
    expect(gateVerdict(passingSummary({ coveredSettled: 441 })).go).toBe(false);
    expect(gateVerdict(passingSummary({ coveredSettled: 359 })).conditions[1]!.pass).toBe(false);
  });

  it("is NO-GO with nothing scored", () => {
    expect(gateVerdict(passingSummary({ n: 0, coveredSettled: 0, simulatedVsSettled: stats(Number.NaN, Number.NaN, 0), midpointVsSettled: stats(Number.NaN, Number.NaN, 0) })).go).toBe(false);
  });

  it("states the coverage band in integers", () => {
    expect(coverageInBand(17, 25)).toBe(false);
    expect(coverageInBand(18, 25)).toBe(true);
    expect(coverageInBand(22, 25)).toBe(true);
    expect(coverageInBand(23, 25)).toBe(false);
  });
});
