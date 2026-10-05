/**
 * THE SIMULATION TAB'S SPR REWIND ON REAL PUBLISHED OBJECTS (quick task
 * 261005-5g0, Part 4). The fixture corpus (`asOfFixtureCorpus.ts`) is
 * published through the REAL publisher (uploads intercepted), and the tab's
 * own loader (`simulationAsOf.ts`) and the Worker's own pricing
 * (`simulationAsOfJob.ts`) run over what it wrote.
 *
 * - REQUEST BUILDING: the cut just before the start match, the remaining rows
 *   in the one as-of order, the baselines, the league, the fetch rounds, and
 *   every fallback.
 * - TRUNCATION: the world with every match after the start match UNPLAYED (its
 *   result removed, its scheduled row kept), republished at that instant,
 *   yields a deep equal plan and the same priced rows and ratings. For a start
 *   inside an event, the world with the start match unplayed too, rebuilt at
 *   the same cut, does as well: nothing at or after the start match can move a
 *   number the run draws from.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusMatch } from "../packages/ingest/normalize.js";
import { spr } from "../packages/core/algorithms/spr.js";
import { publishSeasons } from "../packages/harness/publish.js";
import { asOfAtOrBefore, AsOfIndexSchema, AsOfLogSchema, AsOfSeasonSchema, AsOfStartSchema, type AsOfCut, type AsOfIndex } from "../packages/harness/asOfState.js";
import { asOfCutAtMatch } from "../packages/harness/asOfLookup.js";
import { buildAsOfPricer } from "../packages/harness/asOfPricing.js";
import { artifactKey, asOfIndexKey, asOfLogKey, asOfSeasonKey, asOfStartKey, EventArtifactSchema, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { asOfFixture } from "../packages/harness/fixtures/asOfFixtureCorpus.js";
import type { AsOfFetchers } from "../apps/web/src/components/districts/asOfRewind.js";
import { loadSimulationAsOf, resolveSimulationAsOfAtCut, type SimulationAsOfPlan, type SimulationAsOfReady } from "../apps/web/src/components/event/simulationAsOf.js";
import { priceSimulationAsOfRows } from "../apps/web/src/workers/simulationAsOfJob.js";
import { buildSimulationInputs } from "../apps/web/src/lib/simulationInputs.js";

vi.mock("../packages/harness/r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "../packages/harness/r2Client.js";

const SEASON = 2024;
const COMPUTED_AT = "2024-05-01T00:00:00.000Z";
const GENERATION = "asof-sim-web";

type Uploads = Map<string, string>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asof-sim-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The corpus with every match `keep` refuses UNPLAYED: its result removed, its scheduled row kept. */
function seed(path: string, keep: (match: CorpusMatch) => boolean): Corpus {
  const db = openCorpus(path);
  const fixture = asOfFixture();
  for (const event of fixture.events) upsertEvent(db, event);
  for (const match of fixture.matches) {
    upsertMatch(
      db,
      keep(match)
        ? match
        : { ...match, winner: null, redScore: null, blueScore: null, redRpEarned: null, blueRpEarned: null, hasScoreBreakdown: false, scoreBreakdownRaw: null }
    );
  }
  return db;
}

async function world(keep: (match: CorpusMatch) => boolean, name: string, computedAt: string = COMPUTED_AT): Promise<Uploads> {
  const db = seed(join(dir, `${name}.sqlite`), keep);
  vi.mocked(putObject).mockClear();
  await publishSeasons(db, {
    seasons: [2023, 2024],
    algorithms: [spr],
    bucket: "test-bucket",
    dryRun: false,
    skipState: true,
    includeOffseason: true,
    generation: GENERATION,
    computedAt,
  });
  db.close();
  const uploads: Uploads = new Map();
  for (const [, key, body] of vi.mocked(putObject).mock.calls) uploads.set(key as string, body as string);
  return uploads;
}

const KEY_PARAMS = { algorithmId: spr.id, version: spr.version };

function eventArtifact(uploads: Uploads, eventKey: string): EventArtifact {
  const body = uploads.get(artifactKey({ page: "event", eventKey, ...KEY_PARAMS }));
  if (body === undefined) throw new Error(`no event artifact for ${eventKey}`);
  return EventArtifactSchema.parse(JSON.parse(body));
}

function indexOf(uploads: Uploads, eventKey: string): AsOfIndex {
  return AsOfIndexSchema.parse(JSON.parse(uploads.get(asOfIndexKey({ eventKey, ...KEY_PARAMS }))!));
}

/** Fetchers over one world's uploads, recording every call in order. */
function fetchersOf(uploads: Uploads): AsOfFetchers & { calls: string[] } {
  const calls: string[] = [];
  const read = <T>(label: string, key: string, parse: (body: unknown) => T): Promise<T | null> => {
    calls.push(label);
    const body = uploads.get(key);
    return Promise.resolve(body === undefined ? null : parse(JSON.parse(body)));
  };
  return {
    calls,
    index: (eventKey) => read(`index:${eventKey}`, asOfIndexKey({ eventKey, ...KEY_PARAMS }), (body) => AsOfIndexSchema.parse(body)),
    log: (eventKey) => read(`log:${eventKey}`, asOfLogKey({ eventKey, ...KEY_PARAMS }), (body) => AsOfLogSchema.parse(body)),
    season: () => read("season", asOfSeasonKey({ season: SEASON, ...KEY_PARAMS }), (body) => AsOfSeasonSchema.parse(body)),
    start: () => read("start", asOfStartKey({ season: SEASON, ...KEY_PARAMS }), (body) => AsOfStartSchema.parse(body)),
  };
}

/** Every 2024 match at or before `cut` in the full world's own order; 2023 untouched. */
function keepThrough(full: Uploads, cut: AsOfCut): (match: CorpusMatch) => boolean {
  const indexes = new Map<string, AsOfIndex>();
  for (const [key, body] of full) {
    const m = /^v1\/asof\/([^/]+)\//.exec(key);
    if (m !== null) indexes.set(m[1]!, AsOfIndexSchema.parse(JSON.parse(body)));
  }
  return (match) => {
    if (!match.eventKey.startsWith("2024")) return true;
    const index = indexes.get(match.eventKey);
    const i = index?.m.findIndex(([matchKey]) => matchKey === match.matchKey) ?? -1;
    if (index === undefined || i < 0) return false;
    return asOfAtOrBefore(match.eventKey, [index.m[i]![1], i], cut);
  };
}

function ready(plan: SimulationAsOfPlan): SimulationAsOfReady {
  if (plan.status !== "ready") throw new Error(`expected a ready plan, got: ${plan.reason}`);
  return plan;
}

/** Everything the run draws from: the plan, the Worker's priced rows, and the roster's ratings from the same state. */
function drawnFrom(plan: SimulationAsOfReady) {
  const priced = priceSimulationAsOfRows(plan.block);
  const pricer = buildAsOfPricer({ season: plan.block.season, vars: plan.block.vars, league: [...plan.block.league], teams: new Map(plan.block.teams) });
  return { plan, priced, ratings: [...pricer.ratingsFor(plan.baselines.map((baseline) => baseline.teamKey))] };
}

async function planAt(uploads: Uploads, eventKey: string, startMatchKey: string) {
  const fetchers = fetchersOf(uploads);
  const plan = await loadSimulationAsOf({ artifact: eventArtifact(uploads, eventKey), startMatchKey }, fetchers);
  return { plan, calls: fetchers.calls };
}

describe("the Simulation tab's SPR rewind on the published fixture", () => {
  it("builds the request, survives deleting every result after the start match, and falls back where it cannot price", async () => {
    const full = await world(() => true, "full");

    // ---- A start inside an event: 2024bbb qm6, cut at qm5 (row 4). ----
    const mid = ready((await planAt(full, "2024bbb", "2024bbb_qm6")).plan);
    const bbb = indexOf(full, "2024bbb");
    expect(mid.cutId).toBe(`2024bbb@${String(bbb.m[4]![1])}#4`);
    expect(mid.block.rows.map((row) => row.matchKey)).toEqual(Array.from({ length: 9 }, (_unused, n) => `2024bbb_qm${String(n + 6)}`));
    // The league is the LOG row of qm5, the cut row (neither lq nor le of 2024bbb).
    const bbbLog = AsOfLogSchema.parse(JSON.parse(full.get(asOfLogKey({ eventKey: "2024bbb", ...KEY_PARAMS }))!));
    expect(mid.block.league).toEqual(bbbLog.rows[4]!.L);
    // Baselines: the summed actual RP of qm1-qm5, exactly what today's rewind path sums over the same rows.
    const stored = buildSimulationInputs(eventArtifact(full, "2024bbb"), "2024bbb_qm6")!;
    const byTeam = (rows: readonly { teamKey: string }[]) => [...rows].sort((a, b) => (a.teamKey < b.teamKey ? -1 : 1));
    expect(byTeam(mid.baselines)).toEqual(byTeam(stored.baselines));
    expect(stored.isRewindStart).toBe(true);
    // Not vacuous: the stored rows after the start absorbed later results, so the as-of pmfs differ from them.
    const midDrawn = drawnFrom(mid);
    expect(midDrawn.priced.matches).toHaveLength(9);
    expect(midDrawn.priced.matches.some((m, n) => JSON.stringify(m.redRpPmf) !== JSON.stringify(stored.remainingMatches[n]!.redRpPmf))).toBe(true);

    // ---- The event's FIRST row: 2024ccc qm1, cut before it, league from lb. ----
    const first = await planAt(full, "2024ccc", "2024ccc_qm1");
    const firstPlan = ready(first.plan);
    const ccc = indexOf(full, "2024ccc");
    expect(firstPlan.cutId).toBe(`2024ccc@${String(ccc.m[0]![1])}#-1`);
    expect(firstPlan.block.rows).toHaveLength(12);
    expect(firstPlan.baselines.every((baseline) => baseline.earnedRpSum === 0 && baseline.matchesPlayed === 0)).toBe(true);
    // lb is the row the season held just before 2024ccc's first match: after 2024bbb's final, week 1's last fold.
    expect(ccc.lb).toBeDefined();
    expect(firstPlan.block.league).toEqual(ccc.lb);
    expect(firstPlan.block.league).toEqual(bbbLog.rows.at(-1)!.L);
    // Every team's state is its first segment's `s` here.
    for (const [teamKey, tuple] of firstPlan.block.teams) expect(tuple, teamKey).toEqual(ccc.teams[teamKey]![0]!.s);
    // One round: the event's INDEX and LOG and the season object; nothing else is needed.
    expect(first.calls.sort()).toEqual(["index:2024ccc", "log:2024ccc", "season"]);

    // ---- An overlap: 2024cmpdiv qm4, after the parent's final. The cut is qm3, so the walk hops through 2024cmp. ----
    const overlap = await planAt(full, "2024cmpdiv", "2024cmpdiv_qm4");
    const overlapPlan = ready(overlap.plan);
    expect(overlap.calls).toContain("index:2024cmp");
    expect(overlap.calls).not.toContain("start");
    const div = indexOf(full, "2024cmpdiv");
    // frc1 played qm1-3 here, then the parent's final: at the cut (qm3) its state is still the one qm3 left.
    expect(overlapPlan.block.teams.find(([teamKey]) => teamKey === "frc1")![1]).toEqual(div.teams.frc1![0]!.x);

    // ---- TRUNCATION A: every match after the start match unplayed, republished at the start's instant. ----
    for (const [eventKey, startMatchKey] of [
      ["2024bbb", "2024bbb_qm6"],
      ["2024ccc", "2024ccc_qm1"],
      ["2024cmpdiv", "2024cmpdiv_qm4"],
    ] as const) {
      const before = drawnFrom(ready((await planAt(full, eventKey, startMatchKey)).plan));
      const atStart = asOfCutAtMatch(indexOf(full, eventKey), startMatchKey)!;
      const truncated = await world(keepThrough(full, atStart), `after-${eventKey}`, new Date(atStart.t + 1).toISOString());
      expect(eventArtifact(truncated, eventKey).upcoming.length, `${startMatchKey}: later rows are upcoming in the truncated world`).toBeGreaterThan(0);
      const after = drawnFrom(ready((await planAt(truncated, eventKey, startMatchKey)).plan));
      expect(after, startMatchKey).toEqual(before);
    }

    // ---- TRUNCATION B: the start match unplayed too, rebuilt at the same cut (a start inside an event). ----
    const cut: AsOfCut = { eventKey: "2024bbb", t: bbb.m[4]![1], i: 4 };
    const atCut = await world(keepThrough(full, cut), "at-cut", new Date(cut.t + 1).toISOString());
    const atCutFetchers = fetchersOf(atCut);
    const rebuilt = await resolveSimulationAsOfAtCut(
      { artifact: eventArtifact(atCut, "2024bbb"), index: (await atCutFetchers.index("2024bbb"))!, log: await atCutFetchers.log("2024bbb"), season: (await atCutFetchers.season())!, cut },
      atCutFetchers
    );
    expect(drawnFrom(ready(rebuilt))).toEqual(midDrawn);

    // ---- FALLBACKS: today's stored rows, never a guess. ----
    const fallbackReason = async (fetchers: AsOfFetchers, artifact: EventArtifact, startMatchKey: string): Promise<string> => {
      const plan = await loadSimulationAsOf({ artifact, startMatchKey }, fetchers);
      if (plan.status !== "fallback") throw new Error(`${startMatchKey}: expected a fallback`);
      return plan.reason;
    };
    const base = fetchersOf(full);
    const bbbArtifact = eventArtifact(full, "2024bbb");
    expect(await fallbackReason({ ...base, index: async () => null }, bbbArtifact, "2024bbb_qm6")).toMatch(/no published INDEX/);
    expect(await fallbackReason({ ...base, season: async () => null }, bbbArtifact, "2024bbb_qm6")).toMatch(/season object/);
    expect(await fallbackReason({ ...base, log: async () => null }, bbbArtifact, "2024bbb_qm6")).toMatch(/LOG/);
    expect(await fallbackReason(base, { ...bbbArtifact, eventType: undefined }, "2024bbb_qm6")).toMatch(/event type/);
    // A row the INDEX does not hold (2024ddd qm7 was never played).
    expect(await fallbackReason(base, eventArtifact(full, "2024ddd"), "2024ddd_qm7")).toMatch(/not in 2024ddd's INDEX/);
    // An INDEX written before lb existed cannot price a start at the event's first row.
    const { lb: _lb, ...noLb } = ccc;
    expect(await fallbackReason({ ...base, index: async (eventKey) => (eventKey === "2024ccc" ? noLb : base.index(eventKey)) }, eventArtifact(full, "2024ccc"), "2024ccc_qm1")).toMatch(/no league row before/);
    // An outage is not a fallback: it rejects, and the run shows its error state.
    await expect(loadSimulationAsOf({ artifact: bbbArtifact, startMatchKey: "2024bbb_qm6" }, { ...base, index: () => Promise.reject(new Error("outage")) })).rejects.toThrow("outage");

    // ---- COPIES OF DIFFERENT AGES (C4, R1): a cached LOG older than its INDEX is refetched fresh, once. ----
    const shortLog = { ...bbbLog, rows: bbbLog.rows.slice(0, 2) };
    const withLog = (fresh: typeof bbbLog) => {
      const calls: string[] = [];
      const fetchers: AsOfFetchers = {
        ...base,
        log: async (eventKey, options) => {
          if (eventKey !== "2024bbb") return base.log(eventKey);
          calls.push(options?.fresh === true ? "fresh" : "cached");
          return options?.fresh === true ? fresh : shortLog;
        },
      };
      return { fetchers, calls };
    };
    const healed = withLog(bbbLog);
    const healedPlan = await loadSimulationAsOf({ artifact: bbbArtifact, startMatchKey: "2024bbb_qm6" }, healed.fetchers);
    expect(healed.calls).toEqual(["cached", "fresh"]);
    expect(drawnFrom(ready(healedPlan))).toEqual(midDrawn);
    // Still short after the fresh fetch: today's stored rows, never a tuple from the short copy.
    const stuck = withLog(shortLog);
    expect(await fallbackReason(stuck.fetchers, bbbArtifact, "2024bbb_qm6")).toMatch(/out of step \(log:2024bbb\)/);
    expect(stuck.calls).toEqual(["cached", "fresh"]);
    // A cached INDEX older than the artifact (it lacks the start row) is refetched fresh before falling back.
    const olderIndex = { ...bbb, m: bbb.m.slice(0, 3) };
    const indexCalls: string[] = [];
    const staleIndexPlan = await loadSimulationAsOf(
      { artifact: bbbArtifact, startMatchKey: "2024bbb_qm6" },
      {
        ...base,
        index: async (eventKey, options) => {
          if (eventKey !== "2024bbb") return base.index(eventKey);
          indexCalls.push(options?.fresh === true ? "fresh" : "cached");
          return options?.fresh === true ? bbb : olderIndex;
        },
      }
    );
    expect(indexCalls).toEqual(["cached", "fresh"]);
    expect(drawnFrom(ready(staleIndexPlan))).toEqual(midDrawn);
  }, 180_000);
});
