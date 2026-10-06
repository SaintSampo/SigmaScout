/**
 * The rewound Locks view's as-of plan (quick task 261005-5g0): the stop's cut,
 * each event's mode and rows in the ONE order, and the loader's fetch loop.
 *
 * The as-of objects are folded through the production reducer
 * (`asOfTestFixtures.ts`), so the INDEX rows, segments and tails are the shape
 * the publisher writes.
 */
import { describe, expect, it } from "vitest";
import { defaultMatchesPerTeam } from "../../../../../packages/harness/generatedSchedules.js";
import { RP_REGISTERED_SEASONS } from "../../../../../packages/core/rankingPoints/rules.js";
import { AS_OF_SEASON_START_CUT, type AsOfIndex, type AsOfLog, type AsOfSeason, type AsOfStart } from "../../../../../packages/harness/asOfState.js";
import {
  AAA,
  ARTIFACTS,
  BBB,
  CANDIDATES,
  EVENTS,
  FIXTURE_SEASON as SEASON,
  FIXTURE_VERSION as VERSION,
  NOW_STAGES,
  OBJECTS,
  T0,
  TEAMS,
  asOfBodyFor,
  districtArtifact,
} from "./asOfTestFixtures.js";
import {
  asOfCutId,
  asOfDefaultMatchesPerTeam,
  AS_OF_PRICEABLE_SEASONS,
  asOfQualSplit,
  asOfStopAnchorId,
  districtRegistrations,
  loadAsOfRewind,
  planAsOfEvent,
  resolveStopCut,
  type AsOfFetchers,
} from "./asOfRewind.js";
import { buildDistrictTimeline, districtStageAtPosition, type DistrictTimeline } from "./districtTimeline.js";


function timeline(): DistrictTimeline {
  return buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
}

function at(id: string): number {
  const index = timeline().positions.findIndex((position) => position.id === id);
  expect(index, id).toBeGreaterThan(-1);
  return index;
}

const INDEXES: ReadonlyMap<string, AsOfIndex | null> = new Map(OBJECTS.indexes);

/** Fetchers over the fixture objects that record every call. */
function countingFetchers(objects = OBJECTS) {
  const calls: string[] = [];
  const read = <T,>(url: string): T | null => {
    calls.push(url);
    const body = asOfBodyFor(objects, url);
    return body === undefined ? null : (JSON.parse(body) as T);
  };
  const fetchers: AsOfFetchers = {
    index: async (eventKey) => read<AsOfIndex>(`v1/asof/${eventKey}/spr@${VERSION}.json`),
    log: async (eventKey) => read<AsOfLog>(`v1/asof-log/${eventKey}/spr@${VERSION}.json`),
    season: async () => read<AsOfSeason>(`v1/asof-season/${String(SEASON)}/spr@${VERSION}.json`),
    start: async () => read<AsOfStart>(`v1/asof-start/${String(SEASON)}/spr@${VERSION}.json`),
  };
  return { fetchers, calls };
}

describe("resolveStopCut", () => {
  it("is the season start at Season start", () => {
    const stop = resolveStopCut(timeline(), 0, INDEXES);
    expect(stop).toEqual({ status: "ok", cut: AS_OF_SEASON_START_CUT, id: "start" });
  });

  it("is a match step's own INDEX row", () => {
    const stop = resolveStopCut(timeline(), at("2026wabbb:m:2026wabbb_qm2"), INDEXES);
    expect(stop.status === "ok" && stop.cut).toEqual({ eventKey: "2026wabbb", t: T0 + 7 * 86_400 + 600, i: 1 });
  });

  it("is the last played playoff row at a Playoffs or Awards stop", () => {
    const stop = resolveStopCut(timeline(), at("2026waaa:awards"), INDEXES);
    expect(stop.status === "ok" && stop.cut).toEqual({ eventKey: "2026waaa", t: T0 + 7_200, i: 6 });
  });

  it("walks back from a scheduled row nobody has played to the last played position before it", () => {
    const stop = resolveStopCut(timeline(), at("2026wabbb:m:2026wabbb_qm6"), INDEXES);
    expect(stop.status === "ok" && stop.id).toBe(asOfCutId({ eventKey: "2026wabbb", t: T0 + 7 * 86_400 + 1_800, i: 3 }));
  });

  it("asOfStopAnchorId names the row the cut is read from, without any INDEX (R5)", () => {
    expect(asOfStopAnchorId(timeline(), 0)).toBe("start");
    expect(asOfStopAnchorId(timeline(), at("2026wabbb:m:2026wabbb_qm2"))).toBe("2026wabbb|2026wabbb_qm2|row");
    expect(asOfStopAnchorId(timeline(), at("2026waaa:awards"))).toBe("2026waaa|2026waaa_f1m1|stage");
    // A scheduled row nobody has played walks back to the last played one, as resolveStopCut does.
    expect(asOfStopAnchorId(timeline(), at("2026wabbb:m:2026wabbb_qm6"))).toBe("2026wabbb|2026wabbb_qm4|row");
  });

  it("is pending until the anchor event's INDEX is in hand, and unavailable when it is unpublished", () => {
    const position = at("2026waaa:m:2026waaa_qm3");
    expect(resolveStopCut(timeline(), position, new Map())).toEqual({ status: "pending", missingIndexes: ["2026waaa"] });
    expect(resolveStopCut(timeline(), position, new Map([["2026waaa", null]])).status).toBe("unavailable");
  });
});

describe("asOfQualSplit: the ONE order", () => {
  it("takes the rows strictly after the cut as remaining, folded rows by INDEX row first, and sums the actual RP before it", () => {
    const cut = { eventKey: "2026wabbb", t: T0 + 7 * 86_400 + 600, i: 1 };
    const split = asOfQualSplit({ eventKey: "2026wabbb", tier: "district", eventArtifact: BBB, index: OBJECTS.indexes.get("2026wabbb")!, cut, week: 1 });
    expect(split.rows.map((row) => row.matchKey)).toEqual(["2026wabbb_qm3", "2026wabbb_qm4", "2026wabbb_qm5", "2026wabbb_qm6", "2026wabbb_qm7", "2026wabbb_qm8"]);
    expect(split.rows[0]).toMatchObject({ eventKey: "2026wabbb", compLevel: "qm", eventType: 1, week: 1, redSurrogates: [], blueSurrogates: [] });
    // qm1 (red 2 RP, blue 0) and qm2 (red 3, blue 1).
    const byTeam = new Map(split.baselines.map((baseline) => [baseline.teamKey, baseline] as const));
    expect(byTeam.get("frc100")).toEqual({ teamKey: "frc100", earnedRpSum: 2, matchesPlayed: 1 });
    expect(byTeam.get("frc106")).toEqual({ teamKey: "frc106", earnedRpSum: 3, matchesPlayed: 1 });
    expect(byTeam.get("frc109")).toEqual({ teamKey: "frc109", earnedRpSum: 1, matchesPlayed: 1 });
  });

  it("orders remaining rows by the INDEX, not by the artifact's row order", () => {
    const index = OBJECTS.indexes.get("2026wabbb")!;
    // Swap the fold order of qm3 and qm4 in a copy of the INDEX.
    const swapped: AsOfIndex = { ...index, m: [index.m[0]!, index.m[1]!, index.m[3]!, index.m[2]!] };
    const split = asOfQualSplit({ eventKey: "2026wabbb", tier: "district", eventArtifact: BBB, index: swapped, cut: { eventKey: "2026wabbb", t: index.m[1]![1], i: 1 }, week: 1 });
    expect(split.rows.slice(0, 2).map((row) => row.matchKey)).toEqual(["2026wabbb_qm4", "2026wabbb_qm3"]);
  });

  it("reads TBA's final ranking once every qualification row is at or before the cut", () => {
    const cut = { eventKey: "2026waaa", t: T0 + 3_000, i: 5 };
    const split = asOfQualSplit({ eventKey: "2026waaa", tier: "district", eventArtifact: AAA, index: OBJECTS.indexes.get("2026waaa")!, cut, week: 0 });
    expect(split.rows).toEqual([]);
    expect(split.baselines[0]).toEqual({ teamKey: "frc100", earnedRpSum: 12, matchesPlayed: 6 });
  });

  it("a teams[] row on no qualification row (a playoff-only demo robot) gets no baseline, mid-event and at the final ranking (quick task 261006-2t0)", () => {
    const demo = { teamKey: "frc9999", teamNumber: 9999, nickname: "Off-Season Demo Team 9999", metrics: {} };
    const midEvent = asOfQualSplit({
      eventKey: "2026wabbb",
      tier: "district",
      eventArtifact: { ...BBB, teams: [...BBB.teams, demo] },
      index: OBJECTS.indexes.get("2026wabbb")!,
      cut: { eventKey: "2026wabbb", t: T0 + 7 * 86_400 + 600, i: 1 },
      week: 1,
    });
    expect(midEvent.baselines.some((baseline) => baseline.teamKey === "frc9999")).toBe(false);
    expect(midEvent.baselines.some((baseline) => baseline.teamKey === "frc100")).toBe(true);
    const finished = asOfQualSplit({
      eventKey: "2026waaa",
      tier: "district",
      eventArtifact: { ...AAA, teams: [...AAA.teams, demo] },
      index: OBJECTS.indexes.get("2026waaa")!,
      cut: { eventKey: "2026waaa", t: T0 + 3_000, i: 5 },
      week: 0,
    });
    expect(finished.baselines.map((baseline) => baseline.teamKey)).toEqual(AAA.teams.map((team) => team.teamKey));
  });
});

describe("planAsOfEvent: modes", () => {
  const plan = (eventKey: string, positionId: string, scheduleStop?: string) => {
    const tl = timeline();
    const positionIndex = tl.positions.findIndex((position) => position.id === positionId);
    const stop = resolveStopCut(tl, positionIndex, INDEXES);
    if (stop.status !== "ok") throw new Error(`no cut at ${positionId}`);
    return planAsOfEvent({
      eventKey,
      tier: "district",
      week: 1,
      districtArtifact: districtArtifact(),
      eventArtifact: ARTIFACTS.get(eventKey),
      index: INDEXES.get(eventKey),
      cut: stop.cut,
      scheduleStopEventKey: scheduleStop,
    });
  };

  it("is REAL for an event with a folded row at or before the cut", () => {
    const result = plan("2026wabbb", "2026wabbb:m:2026wabbb_qm2");
    expect(result.ok && result.plan.mode).toBe("real");
  });

  it("is REAL at the event's own Schedule milestone, and only there", () => {
    const tl = timeline();
    const first = tl.positions.findIndex((position) => position.id === "2026wabbb:m:2026wabbb_qm1");
    const result = plan("2026wabbb", tl.positions[first - 1]!.id, "2026wabbb");
    // The same position, reached as another stop rather than as B's Schedule milestone, is GENERATED for B.
    const sameWithoutAlias = plan("2026wabbb", tl.positions[first - 1]!.id);
    expect(sameWithoutAlias.ok && sameWithoutAlias.plan.mode).toBe("generated");
    expect(result.ok && result.plan.mode).toBe("real");
    expect(result.ok && result.plan.mode === "real" && result.plan.rows).toHaveLength(8);
  });

  it("is GENERATED earlier than that, on the event artifact's own roster, with the publisher's no schedule matches per team", () => {
    const result = plan("2026wabbb", "2026waaa:m:2026waaa_qm2");
    expect(result.ok && result.plan).toMatchObject({ mode: "generated", roster: [...TEAMS].sort(), bake: { districtKey: "2026pnw", eventType: 1, matchesPerTeam: 12 } });
  });

  it("is GENERATED for an event unstarted even today, on the district artifact's registrations", () => {
    const result = plan("2026wazzz", "2026wabbb:m:2026wabbb_qm2");
    expect(result.ok && result.plan.roster).toEqual(TEAMS.slice(0, 8));
    expect(districtRegistrations(districtArtifact(), "2026wazzz", "district")).toEqual(TEAMS.slice(0, 8));
  });

  it("is unavailable for a started event whose INDEX is unpublished, never the stored odds", () => {
    const tl = timeline();
    const positionIndex = tl.positions.findIndex((position) => position.id === "2026wabbb:m:2026wabbb_qm2");
    const result = planAsOfEvent({
      eventKey: "2026waaa",
      tier: "district",
      week: 0,
      districtArtifact: districtArtifact(),
      eventArtifact: AAA,
      index: null,
      cut: { eventKey: "2026wabbb", t: T0 + 7 * 86_400 + 600, i: 1 },
      scheduleStopEventKey: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("restates the publisher's no schedule matches per team exactly", () => {
    for (const eventType of [0, 1, 2, 3, 4, 5, 99, 100]) expect(asOfDefaultMatchesPerTeam(eventType)).toBe(defaultMatchesPerTeam(eventType));
  });
});

describe("loadAsOfRewind: the fetch loop", () => {
  const input = (positionId: string) => {
    const tl = timeline();
    const positionIndex = tl.positions.findIndex((position) => position.id === positionId);
    return {
      districtArtifact: districtArtifact(),
      timeline: tl,
      positionIndex,
      eventArtifacts: ARTIFACTS,
      stageByEvent: districtStageAtPosition(tl, positionIndex, NOW_STAGES),
      candidates: CANDIDATES,
      scheduleStopEventKey: undefined,
    };
  };

  it("fetches the season object and every fetched event's INDEX, then the cut event's LOG, and never the start object when no team needs it", async () => {
    const { fetchers, calls } = countingFetchers();
    const result = await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), fetchers);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect([...result.events.keys()].sort()).toEqual(["2026wabbb", "2026wazzz"]);
    const bbb = result.events.get("2026wabbb")!;
    expect(bbb.status === "ready" && bbb.state.plan.mode).toBe("real");
    expect(bbb.status === "ready" && bbb.state.teams.map(([teamKey]) => teamKey)).toEqual([...TEAMS].sort());
    expect(calls.some((url) => url.includes("asof-log/2026wabbb"))).toBe(true);
    expect(calls.some((url) => url.includes("asof-start"))).toBe(false);
    // Each object at most once.
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("fetches the season start object only when a team needs it: a registered team with no match anywhere", async () => {
    const atSeasonStart = await (async () => {
      const { fetchers, calls } = countingFetchers();
      await loadAsOfRewind(input("season-start"), fetchers);
      return calls;
    })();
    // Every team at Season start resolves through its first segment's `s`.
    expect(atSeasonStart.some((url) => url.includes("asof-start"))).toBe(false);

    const withNewcomer = districtArtifact();
    const newcomer = { ...withNewcomer.teams[0]!, teamKey: "frc199", teamNumber: 199, eventPoints: [], remainingEvents: [withNewcomer.teams[0]!.remainingEvents[1]!] };
    const { fetchers, calls } = countingFetchers();
    const result = await loadAsOfRewind({ ...input("2026wabbb:m:2026wabbb_qm2"), districtArtifact: { ...withNewcomer, teams: [...withNewcomer.teams, newcomer] } }, fetchers);
    expect(calls.filter((url) => url.includes("asof-start"))).toHaveLength(1);
    const zzz = result.status === "ready" ? result.events.get("2026wazzz") : undefined;
    expect(zzz?.status === "ready" && zzz.state.teams.map(([teamKey]) => teamKey)).toContain("frc199");
  });

  it("reads every event unavailable when the season object is unpublished", async () => {
    const { fetchers } = countingFetchers({ ...OBJECTS, bodies: new Map([...OBJECTS.bodies].filter(([key]) => !key.includes("asof-season"))) });
    expect((await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), fetchers)).status).toBe("unavailable");
  });

  it("reads every event unavailable, fetching nothing, in a season with no registered RP rule module (N5)", async () => {
    const { fetchers, calls } = countingFetchers();
    const result = await loadAsOfRewind({ ...input("2026wabbb:m:2026wabbb_qm2"), districtArtifact: { ...districtArtifact(), year: 2027 } }, fetchers);
    expect(result).toEqual({ status: "unavailable", reason: "season 2027 has no registered RP rule module" });
    expect(calls).toEqual([]);
    // The restated list is the registry, exactly: registering a season fails here until the list follows.
    expect([...AS_OF_PRICEABLE_SEASONS]).toEqual([...RP_REGISTERED_SEASONS]);
  });

  it("reads an event with an unpublished INDEX unavailable, and every event whose teams' walks must step into it, without failing the stop", async () => {
    const { fetchers } = countingFetchers({ ...OBJECTS, bodies: new Map([...OBJECTS.bodies].filter(([key]) => !key.startsWith("v1/asof/2026wabbb"))) });
    const result = await loadAsOfRewind(input("2026waaa:m:2026waaa_qm3"), fetchers);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.events.get("2026wabbb")?.status).toBe("unavailable");
    // Mid 2026waaa every roster team resolves inside 2026waaa (a segment that straddles the cut is read from
    // its own LOG, one that begins after it from its `s`), so none walks to its season tail at 2026wabbb and
    // an unrelated event's missing INDEX no longer fails this one (review R2).
    expect(result.events.get("2026waaa")?.status).toBe("ready");
    // After 2026waaa every team's last segment ends before the cut and its tail is at 2026wabbb, so the
    // unstarted 2026wazzz's walks must step into the unpublished INDEX too: unavailable, and the stop stands.
    const after = await loadAsOfRewind(input("2026waaa:awards"), fetchers);
    expect(after.status).toBe("ready");
    if (after.status !== "ready") return;
    expect(after.events.get("2026wazzz")?.status).toBe("unavailable");
  });

  it("refetches FRESH, once, a LOG copy older than its INDEX, then resolves; a copy still out of step after that reads unavailable (C4, R1)", async () => {
    const shortLog = (() => {
      const log = JSON.parse(OBJECTS.bodies.get(`v1/asof-log/2026wabbb/spr@${VERSION}.json`)!) as AsOfLog;
      return JSON.stringify({ ...log, rows: log.rows.slice(0, 1) });
    })();
    const fresh: string[] = [];
    const make = (freshLog: string) => {
      const { fetchers, calls } = countingFetchers();
      const wrapped: AsOfFetchers = {
        ...fetchers,
        log: async (eventKey, options) => {
          if (eventKey !== "2026wabbb") return fetchers.log(eventKey, options);
          calls.push(`log:${eventKey}:${options?.fresh === true ? "fresh" : "cached"}`);
          if (options?.fresh === true) fresh.push(eventKey);
          return JSON.parse(options?.fresh === true ? freshLog : shortLog) as AsOfLog;
        },
      };
      return { fetchers: wrapped, calls };
    };
    // The cached copy lacks rows the INDEX names at or before the cut; the fresh one is whole.
    const healed = make(OBJECTS.bodies.get(`v1/asof-log/2026wabbb/spr@${VERSION}.json`)!);
    const result = await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), healed.fetchers);
    expect(result.status === "ready" && result.events.get("2026wabbb")?.status).toBe("ready");
    expect(healed.calls.filter((call) => call.startsWith("log:2026wabbb"))).toEqual(["log:2026wabbb:cached", "log:2026wabbb:fresh"]);
    // The same answer as a load whose copies were never out of step.
    const clean = await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), countingFetchers().fetchers);
    expect(result).toEqual(clean);

    // A fresh copy that is STILL short: one fresh fetch, then unavailable, never an older row.
    fresh.length = 0;
    const stuck = make(shortLog);
    const stuckResult = await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), stuck.fetchers);
    expect(fresh).toEqual(["2026wabbb"]);
    expect(stuckResult.status === "ready" && stuckResult.events.get("2026wabbb")?.status).toBe("unavailable");
  });

  it("refetches the stop's own INDEX fresh when the anchor row is newer than the cached copy", async () => {
    const indexKey = `v1/asof/2026wabbb/spr@${VERSION}.json`;
    const whole = OBJECTS.bodies.get(indexKey)!;
    const older = (() => {
      const index = JSON.parse(whole) as AsOfIndex;
      return JSON.stringify({ ...index, m: index.m.slice(0, 1) });
    })();
    const { fetchers } = countingFetchers();
    const freshCalls: string[] = [];
    const wrapped: AsOfFetchers = {
      ...fetchers,
      index: async (eventKey, options) => {
        if (eventKey !== "2026wabbb") return fetchers.index(eventKey, options);
        if (options?.fresh === true) freshCalls.push(eventKey);
        return JSON.parse(options?.fresh === true ? whole : older) as AsOfIndex;
      },
    };
    const result = await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), wrapped);
    expect(freshCalls).toEqual(["2026wabbb"]);
    expect(result.status).toBe("ready");
    expect(result).toEqual(await loadAsOfRewind(input("2026wabbb:m:2026wabbb_qm2"), countingFetchers().fetchers));
  });
});
