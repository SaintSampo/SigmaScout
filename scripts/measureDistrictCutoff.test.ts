/**
 * `measureDistrictCutoff.ts`' coverage (fast task 261006, todo
 * `district-cutoff-line-backtest`; rebuilt on the as-of path by quick task
 * 261014-hx6).
 *
 * JOBS:
 *
 *   1. The backtest runs end to end on the COMMITTED 2026 PNW district fixture
 *      with its eight event artifacts and as-of objects built from them
 *      (`buildAsOfTestObjects`, the in memory world every as-of test uses),
 *      through the tab's own loader, assembly and as-of runner. The event
 *      artifacts are local only (gitignored), so this block is skipped where
 *      they are absent and runs on every machine that has them.
 *   2. The pre-registered gate refuses on each failing condition, including
 *      coverage one position either side of the 72% to 88% band. Its bars are
 *      unchanged.
 *   3. The measurement positions are season start plus the last step of each
 *      week, and never the settled now position.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, EventArtifactSchema, asOfStartKey, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { AsOfStartSchema } from "../packages/harness/asOfState.js";
import { buildAsOfTestObjects, type AsOfTestObjects } from "../apps/web/src/components/districts/asOfTestFixtures.js";
import type { AsOfFetchers } from "../apps/web/src/components/districts/asOfRewind.js";
import {
  backtestDistrict,
  coverageInBand,
  createRunMemo,
  districtEventKeysOf,
  districtTimelineOf,
  gateVerdict,
  measurementPositions,
  type BacktestSummary,
  type LineStats,
  type TabSources,
} from "./measureDistrictCutoff.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";

const FINAL_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const FIXTURE_DIR = "data/fixtures/phase10";
const FIXTURE_TIMEOUT_MS = 180_000;

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

/** In memory fetchers over one built world, as `scripts/asOfRewindWeb.test.ts`' `fetchersOf` reads its uploads. */
function fetchersOf(objects: AsOfTestObjects, season: number, version: string): AsOfFetchers {
  return {
    index: (eventKey) => Promise.resolve(objects.indexes.get(eventKey) ?? null),
    log: (eventKey) => Promise.resolve(objects.logs.get(eventKey) ?? null),
    season: () => Promise.resolve(objects.season),
    start: () => {
      const body = objects.bodies.get(asOfStartKey({ season, algorithmId: "spr", version }));
      return Promise.resolve(body === undefined ? null : AsOfStartSchema.parse(JSON.parse(body)));
    },
  };
}

const eventFixturesPresent = existsSync(`${FIXTURE_DIR}/event-2026wabon.json`);

describe.skipIf(!eventFixturesPresent)("backtestDistrict on the committed 2026 PNW fixture, on the as-of path", () => {
  const artifact = stampedFixture();
  const events = fixtureEvents(artifact);
  const version = [...events.values()][0]?.algorithmVersion ?? "";
  const objects = eventFixturesPresent
    ? buildAsOfTestObjects({ season: 2026, version, eventArtifacts: [...events.values()], extraTeams: artifact.teams.map((team) => team.teamKey) })
    : undefined;
  const sources = (): TabSources => ({
    eventArtifacts: events,
    unloadedEventKeys: [],
    fetchers: fetchersOf(objects!, 2026, version),
    version,
    memo: createRunMemo(),
    draws: SIMULATION_DRAWS,
    seed: DEFAULT_SIMULATION_SEED,
  });

  it(
    "scores the season start from the as-of state, every open event baked",
    async () => {
      const outcome = await backtestDistrict(artifact, sources());
      if (!outcome.ok) throw new Error(outcome.reason);
      expect(outcome.backtest.settled).toBe(59);
      expect(outcome.backtest.published).toBe(82);
      const first = outcome.backtest.outcomes[0]!;
      expect(first.kind).toBe("scored");
      if (first.kind !== "scored") return;
      expect(first.row.label).toBe("Season start");
      expect(first.row.openEvents).toBe(8);
      expect(first.row.generatedEvents).toBe(8);
      expect(first.row.realEvents).toBe(0);
      expect(first.row.unpricedEvents).toBe(0);
      expect(first.row.p10).toBeLessThanOrEqual(first.row.simulated);
      expect(first.row.simulated).toBeLessThanOrEqual(first.row.p90);
      console.log("tracer season start", JSON.stringify(outcome.backtest.outcomes.map((o) => (o.kind === "scored" ? [o.row.label, o.row.simulated, o.row.p10, o.row.p90, o.row.midpoint, o.row.openEvents, o.row.realEvents, o.row.generatedEvents] : [o.kind]))));
    },
    FIXTURE_TIMEOUT_MS
  );

  it("derives the measurement positions as season start plus the last step of each week, never now", () => {
    const timeline = districtTimelineOf(artifact, events);
    const positions = measurementPositions(timeline);
    expect(positions[0]).toEqual({ index: 0, label: "Season start" });
    expect(positions.map((p) => p.label)).toEqual(["Season start", "After week 1", "After week 2", "After week 3", "After week 4"]);
    for (const position of positions) expect(position.index).toBeLessThan(timeline.nowIndex);
  });
});

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
