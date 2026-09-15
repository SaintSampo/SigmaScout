// @vitest-environment node
/**
 * WEB-LAYER PARITY for browser pricing (260915-m4j).
 *
 * `eventStatePricing.parity.test.ts` proves the pricer reproduces the offline
 * publisher's rows. This test proves the web's data layer carries that parity
 * all the way to what the pages read: `resolveEventArtifact` (the queryFn's
 * pricing step), the merged table rows, the rank simulation's inputs and the
 * team rows. The input is a real offline SPR artifact with a state block
 * built from the committed digest slice
 * (`packages/harness/fixtures/eventStateArtifactFixture.ts`).
 *
 * No tolerance anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOfflineEventArtifactWithBlock, toScheduleOnly } from "../../../../packages/harness/fixtures/eventStateArtifactFixture.js";
import { LiveEventArtifactSchema, type LiveEventArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { mergeEventMatches } from "../components/event/eventMatchAxis.js";
import { buildSimulationInputs } from "./simulationInputs.js";
import { clearEventPricingMemo, isPricedUpcomingRow, resolveEventArtifact, type EventPricingModule } from "./eventPricing.js";
import * as realPricer from "./eventPricing.lazy.js";

const RP_ROW_KEYS = ["redRpPmf", "blueRpPmf", "matchOutcomePmf", "redBonusRpPmf", "blueBonusRpPmf", "redBonusRp", "blueBonusRp"] as const;
const PREDICTION_KEYS = ["predictedWinner", "pRedWin", "predictedRedScore", "predictedBlueScore", "redScoreVarianceOwn", "blueScoreVarianceOwn", "redMatchBandVariance", "blueMatchBandVariance", ...RP_ROW_KEYS] as const;

function jsonNormal<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The body a browser receives, parsed the way `fetchEventArtifact` parses it. */
function wire(artifact: unknown): LiveEventArtifact {
  return LiveEventArtifactSchema.parse(JSON.parse(JSON.stringify(artifact)));
}

const fixture = buildOfflineEventArtifactWithBlock();
const offline = fixture.artifact;
const offlineUpcomingNormal = jsonNormal(offline.upcoming);

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearEventPricingMemo();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eventPricing web-layer parity (tracer)", () => {
  it("non-vacuity: the fixture carries a state block, and a band and an RP pmf on its upcoming rows", () => {
    expect(offline.state).toBeDefined();
    expect(offline.algorithmId).toBe("spr");
    expect(offline.eventType).toBeTypeOf("number");
    expect(offline.upcoming.length).toBeGreaterThanOrEqual(12);
    expect(offline.matches.length).toBeGreaterThan(0);
    expect(offline.upcoming.some((row) => typeof row.redMatchBandVariance === "number" && row.redRpPmf !== undefined)).toBe(true);
    expect(fixture.offlineTeamRowsByMatchKey.size).toBe(offline.upcoming.length);
  });

  it("A: a Worker-shaped (schedule-only) artifact resolves to the offline publisher's exact upcoming rows", async () => {
    const workerShaped = wire(toScheduleOnly(offline));
    expect(workerShaped.upcoming.every((row) => !isPricedUpcomingRow(row))).toBe(true);
    for (const row of workerShaped.upcoming) for (const key of PREDICTION_KEYS) expect(row, key).not.toHaveProperty(key);

    const resolved = await resolveEventArtifact(workerShaped);

    expect(resolved).not.toHaveProperty("state");
    expect(jsonNormal(resolved.upcoming)).toStrictEqual(offlineUpcomingNormal);
    expect(resolved.upcoming).toEqual(offline.upcoming);

    const priced = log.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((l: Record<string, unknown>) => l.event === "event-upcoming-priced");
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ eventKey: offline.eventKey, rows: offline.upcoming.length });
    expect(priced[0]!.durationMs).toBeTypeOf("number");
    expect(warn).not.toHaveBeenCalled();
  });

  it("B: the unmodified offline artifact (priced rows plus the block) resolves to the same rows", async () => {
    const resolved = await resolveEventArtifact(wire(offline));
    expect(resolved).not.toHaveProperty("state");
    expect(jsonNormal(resolved.upcoming)).toStrictEqual(offlineUpcomingNormal);
  });

  it("B2: the block is authoritative: a published priced row that disagrees with the block is replaced by the browser price", async () => {
    const base = wire(offline);
    const tampered: LiveEventArtifact = { ...base, upcoming: base.upcoming.map((row, i) => (i === 0 && isPricedUpcomingRow(row) ? { ...row, pRedWin: 0.123 } : row)) };
    const resolved = await resolveEventArtifact(tampered);
    expect(jsonNormal(resolved.upcoming)).toStrictEqual(offlineUpcomingNormal);
  });

  it("C: merged table rows and the rank simulation's inputs equal their offline equivalents", async () => {
    const resolved = await resolveEventArtifact(wire(toScheduleOnly(offline)));
    const all = () => true;
    expect(mergeEventMatches(resolved.matches, resolved.upcoming, all)).toEqual(mergeEventMatches(offline.matches, offline.upcoming, all));

    const firstUpcomingQm = offline.upcoming.find((row) => row.compLevel === "qm")!.matchKey;
    const fromResolved = buildSimulationInputs(resolved, firstUpcomingQm);
    const fromOffline = buildSimulationInputs(offline, firstUpcomingQm);
    expect(fromResolved).not.toBeNull();
    expect(fromResolved!.remainingMatches.length).toBeGreaterThan(0);
    expect(fromResolved).toEqual(fromOffline);
  });

  it("D: upcomingTeamRows holds the offline team-season row for every upcoming match", async () => {
    const resolved = await resolveEventArtifact(wire(toScheduleOnly(offline)));
    const teamRows = resolved.upcomingTeamRows!;
    expect(Object.keys(teamRows).sort()).toEqual(offline.upcoming.map((row) => row.matchKey).sort());
    for (const row of offline.upcoming) {
      expect(jsonNormal(teamRows[row.matchKey]), row.matchKey).toStrictEqual(jsonNormal(fixture.offlineTeamRowsByMatchKey.get(row.matchKey)));
    }
  });
});

describe("eventPricing fallbacks: never throw, keep published rows, one warning", () => {
  function warnings(): Record<string, unknown>[] {
    return warn.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>);
  }

  function expectUnpricedFallback(resolved: Awaited<ReturnType<typeof resolveEventArtifact>>, input: LiveEventArtifact): void {
    expect(resolved).not.toHaveProperty("state");
    expect(resolved).not.toHaveProperty("upcomingTeamRows");
    expect(resolved.upcoming).toEqual(input.upcoming);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatchObject({ event: "event-upcoming-pricing-failed", eventKey: input.eventKey });
  }

  const scheduleOnly = () => wire(toScheduleOnly(offline));

  it("no block: schedule-only rows stay without prediction keys", async () => {
    const { state: _s, ...noBlock } = scheduleOnly();
    void _s;
    const input = noBlock as LiveEventArtifact;
    const resolved = await resolveEventArtifact(input);
    expectUnpricedFallback(resolved, input);
    expect(warnings()[0]!.error).toBe("no-state-block");
    for (const row of resolved.upcoming) for (const key of PREDICTION_KEYS) expect(row, key).not.toHaveProperty(key);
  });

  it("algorithmId not spr", async () => {
    const input = { ...scheduleOnly(), algorithmId: "opr" };
    expectUnpricedFallback(await resolveEventArtifact(input), input);
    expect(warnings()[0]!.error).toBe("not-spr");
  });

  it("missing eventType", async () => {
    const { eventType: _e, ...rest } = scheduleOnly();
    void _e;
    const input = rest as LiveEventArtifact;
    expectUnpricedFallback(await resolveEventArtifact(input), input);
    expect(warnings()[0]!.error).toBe("no-event-type");
  });

  it("a block whose algorithmVersion differs from the bundled SPR", async () => {
    const base = scheduleOnly();
    const stale = "3.0.0+stale";
    const input: LiveEventArtifact = { ...base, state: { ...base.state!, algorithmVersion: stale, rows: base.state!.rows.map((r) => ({ ...r, algorithmVersion: stale })) } };
    expectUnpricedFallback(await resolveEventArtifact(input), input);
    expect(warnings()[0]!.error).toBe("EventStateBlockError");
  });

  it("published priced rows with a failed pricing keep the published rows exactly", async () => {
    const base = wire(offline);
    const input: LiveEventArtifact = { ...base, state: { ...base.state!, snapshotShapeVersion: -1 } };
    const resolved = await resolveEventArtifact(input);
    expectUnpricedFallback(resolved, input);
    expect(jsonNormal(resolved.upcoming)).toStrictEqual(offlineUpcomingNormal);
  });

  it("a loader rejection falls back and is not memoized: the next fetch retries the chunk", async () => {
    const input = scheduleOnly();
    const failingLoad = vi.fn(async (): Promise<EventPricingModule> => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    expectUnpricedFallback(await resolveEventArtifact(input, { loadPricer: failingLoad }), input);
    expect(warnings()[0]!.error).toBe("TypeError");

    const workingLoad = vi.fn(async () => realPricer);
    const retried = await resolveEventArtifact(input, { loadPricer: workingLoad });
    expect(failingLoad).toHaveBeenCalledTimes(1);
    expect(workingLoad).toHaveBeenCalledTimes(1);
    expect(jsonNormal(retried.upcoming)).toStrictEqual(offlineUpcomingNormal);
  });

  it("a finished event and a fully published artifact without a block stay quiet", async () => {
    const { state: _s, ...published } = wire(offline);
    void _s;
    const resolvedPublished = await resolveEventArtifact(published as LiveEventArtifact);
    expect(resolvedPublished.upcoming).toEqual(offline.upcoming);
    const resolvedFinished = await resolveEventArtifact({ ...(published as LiveEventArtifact), upcoming: [] });
    expect(resolvedFinished.upcoming).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("eventPricing demo fallback", () => {
  const DEMO_TEAM = "frc9975";

  it("a published-priced row with a demo robot resolves to the published row unchanged, with no team row", async () => {
    const base = wire(offline);
    const index = 0;
    const demoRow = { ...base.upcoming[index]!, redTeams: [DEMO_TEAM, ...base.upcoming[index]!.redTeams.slice(1)] };
    const input: LiveEventArtifact = { ...base, upcoming: base.upcoming.map((row, i) => (i === index ? demoRow : row)) };

    const resolved = await resolveEventArtifact(input);
    expect(resolved.upcoming[index]).toBe(demoRow);
    expect(resolved.upcomingTeamRows).not.toHaveProperty(demoRow.matchKey);
    // Every other row is still browser priced.
    expect(Object.keys(resolved.upcomingTeamRows!)).toHaveLength(base.upcoming.length - 1);
  });

  it("the same row schedule-only takes the pricer's output: win odds and scores, no band on the demo alliance, no RP", async () => {
    const base = wire(toScheduleOnly(offline));
    const index = 0;
    const input: LiveEventArtifact = {
      ...base,
      upcoming: base.upcoming.map((row, i) => (i === index ? { ...row, redTeams: [DEMO_TEAM, ...row.redTeams.slice(1)] } : row)),
    };
    const resolved = await resolveEventArtifact(input);
    const row = jsonNormal(resolved.upcoming[index]) as Record<string, unknown>;
    expect(row.pRedWin).toBeTypeOf("number");
    expect(row.predictedRedScore).toBeTypeOf("number");
    expect(row.predictedBlueScore).toBeTypeOf("number");
    expect(row).not.toHaveProperty("redMatchBandVariance");
    for (const key of RP_ROW_KEYS) expect(row, key).not.toHaveProperty(key);
    expect(resolved.upcomingTeamRows).toHaveProperty(String(row.matchKey));
  });
});

describe("eventPricing memo", () => {
  function countingLoader() {
    const price = vi.fn(realPricer.priceArtifactUpcoming);
    const load = vi.fn(async () => ({ ...realPricer, priceArtifactUpcoming: price }) as EventPricingModule);
    return { price, load };
  }

  it("two equal artifacts price once; a changed generation prices again", async () => {
    const { price, load } = countingLoader();
    const first = await resolveEventArtifact(wire(toScheduleOnly(offline)), { loadPricer: load });
    const second = await resolveEventArtifact(wire(toScheduleOnly(offline)), { loadPricer: load });
    expect(price).toHaveBeenCalledTimes(1);
    expect(second.upcoming).toEqual(first.upcoming);

    await resolveEventArtifact({ ...wire(toScheduleOnly(offline)), generation: "tick-2" }, { loadPricer: load });
    expect(price).toHaveBeenCalledTimes(2);
  });

  it("a changed roster on an upcoming match prices again", async () => {
    const { price, load } = countingLoader();
    const base = wire(toScheduleOnly(offline));
    await resolveEventArtifact(base, { loadPricer: load });
    const swapped: LiveEventArtifact = {
      ...base,
      upcoming: base.upcoming.map((row, i) => (i === 0 ? { ...row, redTeams: [row.blueTeams[0]!, ...row.redTeams.slice(1)], blueTeams: [row.redTeams[0]!, ...row.blueTeams.slice(1)] } : row)),
    };
    await resolveEventArtifact(swapped, { loadPricer: load });
    expect(price).toHaveBeenCalledTimes(2);
  });
});
