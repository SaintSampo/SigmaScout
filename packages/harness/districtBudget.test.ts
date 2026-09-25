/**
 * The district artifact's byte budget: the MEASUREMENT that decided where the
 * baked pmfs live, and the ceilings that decision produced.
 *
 * The synthesizer below is a measurement instrument, used nowhere in
 * production, which is why it lives in a test file rather than in
 * `publishBudget.ts`. It reads the live `2026pnw` artifact from the local,
 * gitignored fixture and builds three variants of it, so the
 * inline-versus-sidecar choice recorded in `docs/publish-budget.md` is a
 * consequence of measured bytes rather than a preference — and is
 * reproducible by re-running this file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxEventPoints, type DistrictTier } from "../core/districts/pointModel.js";
import {
  assertWithinDistrictBudget,
  DISTRICT_DETAIL_MAX_BYTES,
  DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
  DISTRICT_PRESIM_MAX_BYTES,
  DistrictBudgetExceededError,
  PUBLISH_BUDGET_DOC_PATH,
} from "./publishBudget.js";
import { roundPmf } from "./rounding.js";

const FIXTURE_PATH = join("data", "fixtures", "phase10", "district-2026pnw.json");
const FIXTURE_SEASON = 2026;

// ---------------------------------------------------------------------------
// The synthesizer
// ---------------------------------------------------------------------------

/**
 * A discretized bell over `length` support points, renormalized by `roundPmf`.
 *
 * HONEST WORST-CASE BYTES, deliberately. A pmf of all zeros and a single one
 * serializes to a fraction of a real one, and measuring that would make the
 * whole decision a lie. A bell whose standard deviation is a fifth of the
 * support keeps nearly every entry a full-width five-decimal number, which is
 * what a real category distribution looks like.
 */
function bellPmf(length: number): number[] {
  const mean = (length - 1) / 2;
  const sd = Math.max(1, length / 5);
  const raw: number[] = [];
  for (let i = 0; i < length; i++) {
    const z = (i - mean) / sd;
    raw.push(Math.exp(-0.5 * z * z));
  }
  const sum = raw.reduce((total, value) => total + value, 0);
  return roundPmf(raw.map((value) => value / sum));
}

/** The five baked category pmfs for one (team, event) pair at `tier`, each over its real support from `maxEventPoints`. */
function bakedBlock(season: number, tier: DistrictTier) {
  const max = maxEventPoints(season, tier);
  const eventTotal = max.qual + max.alliance + max.elim + max.award;
  return {
    qual: { o: 0, p: bellPmf(max.qual + 1) },
    alliance: { o: 0, p: bellPmf(max.alliance + 1) },
    elim: { o: 0, p: bellPmf(max.elim + 1) },
    award: { o: 0, p: bellPmf(max.award + 1) },
    total: { o: 0, p: bellPmf(eventTotal + 1) },
  };
}

/** One representative state block — an event mid-qualification, the widest of the five fields' serializations. */
function stateBlock() {
  return { qualMatchesPlayed: 48, qualMatchesTotal: 72, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
}

const BUCKETS = ["none", "oneOrTwo", "threeOrMore"] as const;

/** The per-season award base-rate table: three decoration buckets crossed with rookie status, each row a pmf over the award-point support. */
function awardBaseRatesBlock(season: number) {
  const awardMax = maxEventPoints(season, "district").award;
  const rows = [];
  for (const bucket of BUCKETS) {
    for (const rookie of [false, true]) {
      rows.push({ bucket, rookie, n: 1234, points: { o: 0, p: bellPmf(awardMax + 1) } });
    }
  }
  return { season, measuredThroughSeason: season - 1, script: "scripts/measureDistrictAwardBaseRates.ts", rows };
}

type FixtureRow = Record<string, unknown> & { eventKey: string; tier: DistrictTier };

interface FixtureTeam {
  teamKey: string;
  eventPoints: FixtureRow[];
  remainingEvents: FixtureRow[];
}
interface Fixture {
  teams: FixtureTeam[];
  [key: string]: unknown;
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export interface DistrictVariantMeasurement {
  readonly teamCount: number;
  readonly baselineBytes: number;
  readonly stateOnlyBytes: number;
  readonly inlineBytes: number;
  readonly sidecarTotalBytes: number;
  readonly largestSidecarBytes: number;
  readonly sidecarCount: number;
  readonly teamEventPairs: number;
}

/**
 * Builds the three variants and measures each.
 *
 * (a) STATE-ONLY: a `state` block on every `eventPoints` and
 *     `remainingEvents` row, an `awardProfile` on every team, one
 *     `awardBaseRates` block.
 * (b) INLINE: (a) with every (team, event) pair moved from `eventPoints` into
 *     `remainingEvents`, each carrying the five baked pmfs. The fixture is a
 *     FINISHED season with zero remaining events, so measuring it as-is would
 *     measure nothing — the move is what makes this the honest worst case.
 * (c) SIDECAR: (a) unchanged, plus one sidecar object per district event
 *     carrying the same pmfs for that event's own roster.
 */
export function measureDistrictVariants(fixture: Fixture): DistrictVariantMeasurement {
  const baselineBytes = bytesOf(fixture);

  const stateOnly = {
    ...fixture,
    awardBaseRates: awardBaseRatesBlock(FIXTURE_SEASON),
    teams: fixture.teams.map((team, index) => ({
      ...team,
      awardProfile: { bucket: BUCKETS[index % BUCKETS.length], rookie: index % 7 === 0 },
      eventPoints: team.eventPoints.map((row): FixtureRow => ({ ...row, state: stateBlock() })),
      remainingEvents: team.remainingEvents.map((row): FixtureRow => ({ ...row, state: stateBlock() })),
    })),
  };

  const inline = {
    ...stateOnly,
    teams: stateOnly.teams.map((team) => ({
      ...team,
      eventPoints: [],
      remainingEvents: [
        ...team.remainingEvents.map((row): FixtureRow => ({ ...row, baked: bakedBlock(FIXTURE_SEASON, row.tier) })),
        ...team.eventPoints.map(
          (row): FixtureRow => ({
            eventKey: row.eventKey,
            eventName: row["eventName"],
            week: row["week"],
            tier: row.tier,
            maxPoints: 0,
            state: stateBlock(),
            baked: bakedBlock(FIXTURE_SEASON, row.tier),
          })
        ),
      ],
    })),
  };

  // One sidecar per district event, over that event's own roster.
  const rosterByEvent = new Map<string, { tier: DistrictTier; teams: string[] }>();
  for (const team of fixture.teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      const entry = rosterByEvent.get(row.eventKey) ?? { tier: row.tier, teams: [] };
      entry.teams.push(team.teamKey);
      rosterByEvent.set(row.eventKey, entry);
    }
  }
  let sidecarTotalBytes = 0;
  let largestSidecarBytes = 0;
  for (const [eventKey, entry] of rosterByEvent) {
    const roster = [...entry.teams].sort();
    const sidecar = {
      schemaVersion: 1,
      generation: "gggggggg",
      computedAt: "2026-03-14T12:00:00.000Z",
      districtKey: "2026pnw",
      eventKey,
      year: FIXTURE_SEASON,
      roster,
      rows: roster.map((_teamKey, index) => ({ t: index, ...bakedBlock(FIXTURE_SEASON, entry.tier) })),
    };
    const bytes = bytesOf(sidecar);
    sidecarTotalBytes += bytes;
    if (bytes > largestSidecarBytes) largestSidecarBytes = bytes;
  }

  return {
    teamCount: fixture.teams.length,
    baselineBytes,
    stateOnlyBytes: bytesOf(stateOnly),
    inlineBytes: bytesOf(inline),
    sidecarTotalBytes: bytesOf(stateOnly) + sidecarTotalBytes,
    largestSidecarBytes,
    sidecarCount: rosterByEvent.size,
    teamEventPairs: fixture.teams.reduce((sum, team) => sum + team.eventPoints.length + team.remainingEvents.length, 0),
  };
}

describe("district artifact byte measurement (2026pnw)", () => {
  const present = existsSync(FIXTURE_PATH);
  const guard = present ? it : it.skip;

  guard(`measures the three variants of ${FIXTURE_PATH}`, () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
    const m = measureDistrictVariants(fixture);
    const perTeam = (bytes: number) => Math.round(bytes / m.teamCount);
    console.log(
      [
        `2026pnw: ${m.teamCount} teams, ${m.teamEventPairs} team-event pairs, ${m.sidecarCount} district events`,
        `  baseline (as published)  ${m.baselineBytes} bytes, ${perTeam(m.baselineBytes)} per team`,
        `  (a) state-only           ${m.stateOnlyBytes} bytes, ${perTeam(m.stateOnlyBytes)} per team`,
        `  (b) inline baked pmfs    ${m.inlineBytes} bytes, ${perTeam(m.inlineBytes)} per team, ratio ${(m.inlineBytes / m.stateOnlyBytes).toFixed(3)}x state-only`,
        `  (c) sidecar total        ${m.sidecarTotalBytes} bytes across 1 district + ${m.sidecarCount} sidecars, largest single sidecar ${m.largestSidecarBytes} bytes`,
      ].join("\n")
    );
    expect(m.stateOnlyBytes).toBeGreaterThan(0);
  });

  guard("the state-only variant sits under both the per-team and the absolute ceiling", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
    const m = measureDistrictVariants(fixture);
    expect(m.stateOnlyBytes / m.teamCount).toBeLessThanOrEqual(DISTRICT_DETAIL_MAX_BYTES_PER_TEAM);
    expect(m.stateOnlyBytes).toBeLessThanOrEqual(DISTRICT_DETAIL_MAX_BYTES);
  });

  guard("the largest single sidecar sits under the sidecar ceiling", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
    const m = measureDistrictVariants(fixture);
    expect(m.largestSidecarBytes).toBeLessThanOrEqual(DISTRICT_PRESIM_MAX_BYTES);
  });

  guard("the stated decision rule still selects SIDECAR on the measured numbers", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
    const m = measureDistrictVariants(fixture);
    const chooseInline = m.inlineBytes <= 150_000 && m.inlineBytes / m.stateOnlyBytes <= 1.35;
    expect(chooseInline).toBe(false);
  });
});

describe("the district ceilings and the doc cannot drift", () => {
  const ceilings = {
    DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
    DISTRICT_DETAIL_MAX_BYTES,
    DISTRICT_PRESIM_MAX_BYTES,
  };

  it("every exported ceiling is a finite, positive integer", () => {
    for (const [name, value] of Object.entries(ceilings)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it(`${PUBLISH_BUDGET_DOC_PATH} states each ceiling with comma grouping`, () => {
    const markdown = readFileSync(PUBLISH_BUDGET_DOC_PATH, "utf8");
    for (const [name, value] of Object.entries(ceilings)) {
      const rendered = value.toLocaleString("en-US");
      expect(markdown.includes(rendered), `${name} (${rendered}) is not stated in ${PUBLISH_BUDGET_DOC_PATH}`).toBe(true);
    }
  });

  it(`${PUBLISH_BUDGET_DOC_PATH} names each ceiling constant and records the decision the measurement produced`, () => {
    const markdown = readFileSync(PUBLISH_BUDGET_DOC_PATH, "utf8");
    for (const name of Object.keys(ceilings)) expect(markdown.includes(name), `${name} is not named in ${PUBLISH_BUDGET_DOC_PATH}`).toBe(true);
    // The three measured totals the branch was chosen from.
    for (const measured of ["106,920", "151,351", "717,001", "733,050", "209,043"]) {
      expect(markdown.includes(measured), `measured figure ${measured} is not recorded in ${PUBLISH_BUDGET_DOC_PATH}`).toBe(true);
    }
    expect(markdown.includes("Outcome: SIDECAR")).toBe(true);
  });
});

describe("assertWithinDistrictBudget", () => {
  it("passes exactly at the ceiling and throws one byte above it", () => {
    expect(() => assertWithinDistrictBudget("v1/district/2026pnw.json", DISTRICT_DETAIL_MAX_BYTES, DISTRICT_DETAIL_MAX_BYTES)).not.toThrow();
    expect(() => assertWithinDistrictBudget("v1/district/2026pnw.json", DISTRICT_DETAIL_MAX_BYTES + 1, DISTRICT_DETAIL_MAX_BYTES)).toThrow(DistrictBudgetExceededError);
  });

  it("names the key, the measured bytes and the ceiling, and says never to widen it", () => {
    try {
      assertWithinDistrictBudget("v1/district/2026fim.json", DISTRICT_DETAIL_MAX_BYTES + 1, DISTRICT_DETAIL_MAX_BYTES);
      expect.unreachable("assertWithinDistrictBudget should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("v1/district/2026fim.json");
      expect(message).toContain(String(DISTRICT_DETAIL_MAX_BYTES + 1));
      expect(message).toContain(String(DISTRICT_DETAIL_MAX_BYTES));
      expect(message).toContain("never widen the ceiling");
    }
  });
});
