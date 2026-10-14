/**
 * `measureLocksInRange.ts`' coverage (quick task 261014-hx6).
 *
 *   1. The tally rules: locked is `locked` plus `lockedAward`, prequalified is
 *      its own count, a tie at the line (`contending`) is not locked, and
 *      pooled rates come from summed counts.
 *   2. End to end on the committed 2026 PNW fixture (skipped where its local
 *      event artifacts are absent): the district side's season start state is
 *      the backtest's own for the same artifacts, and the champ side runs the
 *      simulated DCMP bake to a baked entry and a range state that is not
 *      pending.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, EventArtifactSchema, asOfStartKey, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { AsOfStartSchema } from "../packages/harness/asOfState.js";
import { buildAsOfTestObjects, type AsOfTestObjects } from "../apps/web/src/components/districts/asOfTestFixtures.js";
import type { AsOfFetchers } from "../apps/web/src/components/districts/asOfRewind.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import { backtestDistrict, champTabContext, createRunMemo, districtEventKeysOf, districtTabContext, type TabSources } from "./measureDistrictCutoff.js";
import { champSeasonStart, champTabAtPosition, districtSeasonStart, lockedRate, pointsOnlyRate, sumTallies, tallyInRange } from "./measureLocksInRange.js";

describe("tallyInRange", () => {
  const finals = new Map([
    ["frc1", "locked"],
    ["frc2", "lockedAward"],
    ["frc3", "prequalified"],
    ["frc4", "contending"],
    ["frc5", "eliminated"],
  ]);

  it("counts locked plus lockedAward as locked, prequalified on its own, and a tie at the line as not locked", () => {
    const tally = tallyInRange(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"], finals);
    expect(tally).toEqual({ inRange: 6, lockedPoints: 1, lockedAward: 1, prequalified: 1, tieAtLine: 1, notLocked: 2 });
    expect(lockedRate(tally)).toBeCloseTo(2 / 6, 12);
    expect(pointsOnlyRate(tally)).toBeCloseTo(1 / 6, 12);
  });

  it("pools from summed counts, never by averaging the per district rates", () => {
    const small = tallyInRange(["frc1"], finals); // 1 of 1 locked
    const large = tallyInRange(["frc5", "frc5", "frc5", "frc1"], finals); // 1 of 4 locked
    const pooled = sumTallies([small, large]);
    expect(pooled.inRange).toBe(5);
    expect(lockedRate(pooled)).toBeCloseTo(2 / 5, 12);
    expect(lockedRate(pooled)).not.toBeCloseTo((1 + 0.25) / 2, 6);
    expect(lockedRate(sumTallies([]))).toBeNull();
  });
});

const FINAL_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const FIXTURE_DIR = "data/fixtures/phase10";
const FIXTURE_TIMEOUT_MS = 180_000;
const eventFixturesPresent = existsSync(`${FIXTURE_DIR}/event-2026wabon.json`);

/**
 * The committed fixture predates `state`. Its district tier rows are stamped
 * all final, as the backtest's test does. Its championship (2026pncmp) rows
 * are LEFT UNSTAMPED, so the championship reads unstarted at now: the fixture
 * carries no 2026pncmp event artifact, and a started event with no artifact
 * reads unavailable at every stop (`loadAsOfRewind`'s `unloadedEventKeys`).
 * At the season start the tab plans the championship GENERATED either way
 * (its first INDEX row is after the cut), so the season start reading is the
 * one the real run takes. `cmpSlots` (21) is already on the fixture.
 */
function stampedFixture(): DistrictArtifact {
  const raw = JSON.parse(readFileSync(`${FIXTURE_DIR}/district-2026pnw.json`, "utf8")) as {
    teams: { eventPoints: Record<string, unknown>[]; remainingEvents: Record<string, unknown>[] }[];
  };
  for (const team of raw.teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) if (row.tier === "district") row.state = FINAL_STATE;
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

describe.skipIf(!eventFixturesPresent)("the season start in range report on the committed 2026 PNW fixture", () => {
  const artifact = eventFixturesPresent ? stampedFixture() : (undefined as unknown as DistrictArtifact);
  const events = eventFixturesPresent ? fixtureEvents(artifact) : new Map<string, EventArtifact>();
  const version = [...events.values()][0]?.algorithmVersion ?? "";
  const objects = eventFixturesPresent
    ? buildAsOfTestObjects({ season: 2026, version, eventArtifacts: [...events.values()], extraTeams: artifact.teams.map((team) => team.teamKey) })
    : undefined;
  const sources = (memo = createRunMemo()): TabSources => ({
    eventArtifacts: events,
    unloadedEventKeys: [],
    fetchers: fetchersOf(objects!, 2026, version),
    version,
    memo,
    draws: SIMULATION_DRAWS,
    seed: DEFAULT_SIMULATION_SEED,
  });

  it(
    "the district side's season start state is the backtest's own for the same artifacts",
    async () => {
      const reading = await districtSeasonStart(districtTabContext(artifact, events), sources());
      const backtest = await backtestDistrict(artifact, sources());
      if (!backtest.ok) throw new Error(backtest.reason);
      const first = backtest.backtest.outcomes[0]!;
      expect(first.kind).toBe("scored");
      if (first.kind !== "scored") return;
      expect(reading.state).toBe("simulated");
      expect(reading.line).toEqual({ points: first.row.simulated, p10: first.row.p10, p90: first.row.p90 });
      expect(reading.unpriced).toBe(first.row.unpricedEvents);
      expect(reading.inRange.length).toBeGreaterThan(0);
      expect(reading.tally.inRange).toBe(reading.inRange.length);
    },
    FIXTURE_TIMEOUT_MS
  );

  it(
    "the champ side runs the simulated DCMP bake: the bake entry is baked and the range state is not pending",
    async () => {
      const memo = createRunMemo();
      const ctx = champTabContext(artifact, events);
      expect(ctx.dcmpEventKeys).toEqual(["2026pncmp"]);
      const tab = await champTabAtPosition(ctx, 0, sources(memo));
      expect(tab.simulatedField?.status).toBe("ready");
      expect(tab.assembled?.status).toBe("ready");
      if (tab.assembled?.status !== "ready") return;
      expect(tab.assembled.request.asOf?.mode).toBe("generated");
      // The main run skipped the unstarted championship; only the bake posted it.
      expect(tab.priced.assembled.events.map((event) => event.eventKey)).not.toContain("2026pncmp");
      const entry = [...memo.entries.values()].flatMap((outcome) => (outcome.failed ? [] : [outcome.entry])).find((e) => e.eventKey === "2026pncmp");
      expect(entry?.status).toBe("baked");
      expect(tab.bake.status).toBe("ready");
      expect(tab.simulatedDcmpStatus).toBe("ready");
      expect(tab.rangeState.kind).not.toBe("pending");

      const reading = await champSeasonStart(ctx, sources());
      expect(reading.bake).toEqual({ status: "ready" });
      expect(reading.state).not.toBe("pending");
      expect(reading.tally.inRange).toBe(reading.inRange.length);
    },
    FIXTURE_TIMEOUT_MS
  );
});
