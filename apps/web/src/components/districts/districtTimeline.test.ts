/**
 * The district's interleaved timeline, its step resolver and the per-event
 * stage at a position.
 *
 * Pure and synthetic, with the event artifacts parsed through the REAL
 * `EventArtifactSchema` so every fixture matches the published shape.
 */
import { describe, expect, it } from "vitest";
import { EventArtifactSchema, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictStageFinality } from "./districtLedgerRows.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  DISTRICT_TIMELINE_SEASON_START_ID,
  buildDistrictTimeline,
  cutAtPosition,
  districtStageAtPosition,
  eventStartedAtPosition,
  eventsWithOpenCategoriesAt,
  firstMatchPositionIndex,
  remainingQualRowsAtPosition,
  resolveDistrictTimelinePosition,
  startMatchKeyAtPosition,
  timelineEventsOf,
} from "./districtTimeline.js";

const BASE_MS = Date.parse("2026-03-06T17:00:00.000Z");

interface MatchSpec {
  readonly matchNumber: number;
  /** Epoch MILLISECONDS, or `undefined` for a row TBA published no time for. */
  readonly ms: number | undefined;
  /** When true the row is published in epoch SECONDS, the other unit some artifacts carry. */
  readonly asSeconds?: boolean;
}

function eventArtifact(eventKey: string, specs: readonly MatchSpec[]): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey,
    season: 2026,
    matches: [],
    upcoming: specs.map((spec) => ({
      matchKey: `${eventKey}_qm${String(spec.matchNumber)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: spec.matchNumber,
      ...(spec.ms === undefined ? {} : { sortTime: spec.asSeconds === true ? Math.floor(spec.ms / 1000) : spec.ms }),
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 50,
      predictedBlueScore: 50,
    })),
    teams: [],
  });
}

const EVENTS = [
  { eventKey: "eva", eventName: "Event A", week: 0 as number | null },
  { eventKey: "evb", eventName: "Event B", week: 0 as number | null },
];

/** Two events whose matches interleave: A at t+0 and t+40, B at t+20 and t+60. */
function interleavedTimeline() {
  return buildDistrictTimeline({
    events: EVENTS,
    eventArtifacts: new Map([
      ["eva", eventArtifact("eva", [{ matchNumber: 1, ms: BASE_MS }, { matchNumber: 2, ms: BASE_MS + 40_000 }])],
      ["evb", eventArtifact("evb", [{ matchNumber: 1, ms: BASE_MS + 20_000 }, { matchNumber: 2, ms: BASE_MS + 60_000 }])],
    ]),
  });
}

const NOW_STAGES: ReadonlyMap<string, DistrictStageFinality> = new Map([
  ["eva", { qual: true, alliance: true, elim: true, award: true }],
  ["evb", { qual: true, alliance: true, elim: true, award: true }],
]);

describe("buildDistrictTimeline", () => {
  it("interleaves two events by sortTime and puts each event's four stage steps after its own last qualification row", () => {
    const timeline = interleavedTimeline();
    expect(timeline.positions.map((position) => position.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "eva:m:eva_qm1",
      "evb:m:evb_qm1",
      "eva:m:eva_qm2",
      "eva:qualsDone",
      "eva:alliance",
      "eva:playoffs",
      "eva:awards",
      "evb:m:evb_qm2",
      "evb:qualsDone",
      "evb:alliance",
      "evb:playoffs",
      "evb:awards",
      DISTRICT_TIMELINE_NOW_ID,
    ]);
  });

  /**
   * THE DCMP IS JUST ANOTHER EVENT ON THIS RAIL (quick task 260925-xab). The
   * Champ Locks tab passes the district-tier events AND the District
   * Championship, so the rail must run through the DCMP's matches and its four
   * stage steps, in week order, and every DCMP stage must rewind exactly as a
   * district event's does. `buildDistrictTimeline` is tier-agnostic by
   * construction — it takes an `events` list and no tier at all — and this
   * pins that it stays so.
   */
  it("runs through a dcmp-keyed event's matches and its four stage steps, in week order", () => {
    const events = [
      { eventKey: "2026wabon", eventName: "Bonney Lake", week: 0 as number | null },
      { eventKey: "2026pncmp", eventName: "PNW District Championship", week: 5 as number | null },
    ];
    const timeline = buildDistrictTimeline({
      events,
      eventArtifacts: new Map([
        ["2026wabon", eventArtifact("2026wabon", [{ matchNumber: 1, ms: BASE_MS }])],
        ["2026pncmp", eventArtifact("2026pncmp", [{ matchNumber: 1, ms: BASE_MS + 5_000_000 }])],
      ]),
    });
    expect(timeline.positions.map((position) => position.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "2026wabon:m:2026wabon_qm1",
      "2026wabon:qualsDone",
      "2026wabon:alliance",
      "2026wabon:playoffs",
      "2026wabon:awards",
      "2026pncmp:m:2026pncmp_qm1",
      "2026pncmp:qualsDone",
      "2026pncmp:alliance",
      "2026pncmp:playoffs",
      "2026pncmp:awards",
      DISTRICT_TIMELINE_NOW_ID,
    ]);

    const nowStages: ReadonlyMap<string, DistrictStageFinality> = new Map([
      ["2026wabon", { qual: true, alliance: true, elim: true, award: true }],
      ["2026pncmp", { qual: true, alliance: true, elim: true, award: true }],
    ]);
    const at = (id: string) => districtStageAtPosition(timeline, resolveDistrictTimelinePosition(timeline, id), nowStages);
    // The DCMP's own stages reopen one at a time, exactly as a district
    // event's do, and rewinding into it leaves the finished district event
    // alone.
    expect(at("2026pncmp:qualsDone").get("2026pncmp")).toEqual({ qual: true, alliance: false, elim: false, award: false });
    expect(at("2026pncmp:playoffs").get("2026pncmp")).toEqual({ qual: true, alliance: true, elim: true, award: false });
    expect(at("2026pncmp:qualsDone").get("2026wabon")).toEqual({ qual: true, alliance: true, elim: true, award: true });
    expect(at("2026wabon:alliance").get("2026pncmp")).toEqual({ qual: false, alliance: false, elim: false, award: false });
    expect(startMatchKeyAtPosition(timeline, resolveDistrictTimelinePosition(timeline, "2026pncmp:qualsDone"), "2026pncmp")).toBeNull();
  });

  it("interleaves an event published in epoch SECONDS with one published in epoch milliseconds", () => {
    const timeline = buildDistrictTimeline({
      events: EVENTS,
      eventArtifacts: new Map([
        ["eva", eventArtifact("eva", [{ matchNumber: 1, ms: BASE_MS }, { matchNumber: 2, ms: BASE_MS + 40_000 }])],
        ["evb", eventArtifact("evb", [{ matchNumber: 1, ms: BASE_MS + 20_000, asSeconds: true }])],
      ]),
    });
    const matchIds = timeline.positions.flatMap((position) => (position.step?.kind === "match" ? [position.id] : []));
    expect(matchIds).toEqual(["eva:m:eva_qm1", "evb:m:evb_qm1", "eva:m:eva_qm2"]);
  });

  it("orders an untimed row after every timed one, by match key, and discloses the event", () => {
    const timeline = buildDistrictTimeline({
      events: [EVENTS[0]!],
      eventArtifacts: new Map([
        ["eva", eventArtifact("eva", [{ matchNumber: 2, ms: undefined }, { matchNumber: 1, ms: BASE_MS }, { matchNumber: 3, ms: undefined }])],
      ]),
    });
    const matchIds = timeline.positions.flatMap((position) => (position.step?.kind === "match" ? [position.id] : []));
    expect(matchIds).toEqual(["eva:m:eva_qm1", "eva:m:eva_qm2", "eva:m:eva_qm3"]);
    expect(timeline.gaps.eventsWithUntimedRows).toEqual(["eva"]);
  });

  it("keeps a week-1 event's unloaded stage steps AHEAD of a week-3 event's timed matches", () => {
    // The ordinary first-paint state: the event list IS the fetch set, so an
    // event whose artifact has not arrived yet contributes four stage steps
    // carrying no instant at all. Before this fix every one of them sorted
    // after every timed step, so a finished week-1 event landed past a live
    // week-3 event's matches, near the end of the season.
    const timeline = buildDistrictTimeline({
      events: [
        { eventKey: "wk1", eventName: "Week One", week: 1 },
        { eventKey: "wk3", eventName: "Week Three", week: 3 },
      ],
      eventArtifacts: new Map([
        ["wk3", eventArtifact("wk3", [{ matchNumber: 1, ms: BASE_MS }, { matchNumber: 2, ms: BASE_MS + 40_000 }])],
      ]),
    });

    expect(timeline.gaps.eventsWithoutArtifact).toEqual(["wk1"]);
    expect(timeline.positions.map((position) => position.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "wk1:qualsDone",
      "wk1:alliance",
      "wk1:playoffs",
      "wk1:awards",
      "wk3:m:wk3_qm1",
      "wk3:m:wk3_qm2",
      "wk3:qualsDone",
      "wk3:alliance",
      "wk3:playoffs",
      "wk3:awards",
      DISTRICT_TIMELINE_NOW_ID,
    ]);

  });

  it("within ONE week an untimed step still sorts after the timed ones, so it never jumps to the front", () => {
    const timeline = buildDistrictTimeline({
      events: [
        { eventKey: "eva", eventName: "Event A", week: 2 },
        { eventKey: "evb", eventName: "Event B", week: 2 },
      ],
      eventArtifacts: new Map([["eva", eventArtifact("eva", [{ matchNumber: 1, ms: BASE_MS }])]]),
    });
    expect(timeline.positions.map((position) => position.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "eva:m:eva_qm1",
      "eva:qualsDone",
      "eva:alliance",
      "eva:playoffs",
      "eva:awards",
      "evb:qualsDone",
      "evb:alliance",
      "evb:playoffs",
      "evb:awards",
      DISTRICT_TIMELINE_NOW_ID,
    ]);
  });

  it("a null-week unloaded event still sorts last, which is the only place a week cannot place it", () => {
    const timeline = buildDistrictTimeline({
      events: [
        { eventKey: "nul", eventName: "No Week", week: null },
        { eventKey: "wk1", eventName: "Week One", week: 1 },
      ],
      eventArtifacts: new Map(),
    });
    const ids = timeline.positions.flatMap((position) => (position.step === undefined ? [] : [position.id]));
    expect(ids.slice(0, 4)).toEqual(["wk1:qualsDone", "wk1:alliance", "wk1:playoffs", "wk1:awards"]);
    expect(ids.slice(4)).toEqual(["nul:qualsDone", "nul:alliance", "nul:playoffs", "nul:awards"]);
  });

  it("gives an event with NO loaded artifact its four stage steps and no match steps, and discloses it", () => {
    const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: new Map() });
    expect(timeline.gaps.eventsWithoutArtifact).toEqual(["eva", "evb"]);
    expect(timeline.positions.filter((position) => position.step?.kind === "match")).toHaveLength(0);
    // Four stage steps per event, plus season start and now.
    expect(timeline.positions).toHaveLength(2 * 4 + 2);
  });
});

describe("resolveDistrictTimelinePosition", () => {
  it("resolves an unknown or stale id to NOW, never to a neighbouring step", () => {
    const timeline = interleavedTimeline();
    expect(resolveDistrictTimelinePosition(timeline, "eva:m:eva_qm999")).toBe(timeline.nowIndex);
    expect(resolveDistrictTimelinePosition(timeline, "nonsense")).toBe(timeline.nowIndex);
    expect(resolveDistrictTimelinePosition(timeline, undefined)).toBe(timeline.nowIndex);
    expect(resolveDistrictTimelinePosition(timeline, DISTRICT_TIMELINE_NOW_ID)).toBe(timeline.nowIndex);
  });

  it("resolves a real step id to that step", () => {
    const timeline = interleavedTimeline();
    const index = resolveDistrictTimelinePosition(timeline, "eva:qualsDone");
    expect(timeline.positions[index]!.id).toBe("eva:qualsDone");
  });
});

describe("the per-event stage at a position", () => {
  const timeline = interleavedTimeline();
  const indexOf = (id: string) => resolveDistrictTimelinePosition(timeline, id);

  it("returns the artifact's own state-block answer UNCHANGED at the now position", () => {
    expect(districtStageAtPosition(timeline, timeline.nowIndex, NOW_STAGES)).toEqual(new Map(NOW_STAGES));
  });

  it("leaves all four open with every qualification row remaining at the last step before an event's first match", () => {
    // Season start is before every match of either event.
    const stages = districtStageAtPosition(timeline, 0, NOW_STAGES);
    expect(stages.get("eva")).toEqual({ qual: false, alliance: false, elim: false, award: false });
    expect(remainingQualRowsAtPosition(timeline, 0, "eva")).toEqual(["eva_qm1", "eva_qm2"]);
    expect(startMatchKeyAtPosition(timeline, 0, "eva")).toBe("eva_qm1");
  });

  it("leaves THREE open with ZERO remaining at the quals-done step", () => {
    const index = indexOf("eva:qualsDone");
    expect(districtStageAtPosition(timeline, index, NOW_STAGES).get("eva")).toEqual({ qual: true, alliance: false, elim: false, award: false });
    expect(remainingQualRowsAtPosition(timeline, index, "eva")).toEqual([]);
    // A finished qualification stage is expressed as ZERO remaining matches,
    // never as a fifth flag.
    expect(startMatchKeyAtPosition(timeline, index, "eva")).toBeNull();
  });

  it("leaves NONE open at the awards step", () => {
    const index = indexOf("eva:awards");
    expect(districtStageAtPosition(timeline, index, NOW_STAGES).get("eva")).toEqual({ qual: true, alliance: true, elim: true, award: true });
  });

  it("is monotone: no category open at a later position is closed at an earlier one", () => {
    for (let later = 1; later <= timeline.nowIndex - 1; later++) {
      const laterStages = districtStageAtPosition(timeline, later, NOW_STAGES);
      const earlierStages = districtStageAtPosition(timeline, later - 1, NOW_STAGES);
      for (const [eventKey, final] of laterStages) {
        const earlier = earlierStages.get(eventKey)!;
        for (const category of ["qual", "alliance", "elim", "award"] as const) {
          if (!final[category]) expect(earlier[category]).toBe(false);
        }
      }
    }
  });

  it("reports exactly the events with at least one open category at a position", () => {
    const index = indexOf("eva:awards");
    const stages = districtStageAtPosition(timeline, index, NOW_STAGES);
    expect(eventsWithOpenCategoriesAt(stages)).toEqual(["evb"]);
  });

  /**
   * The Champ Locks tab reads this for one question: whether the District
   * Championship field is a FACT yet at the position the slider is at
   * (quick task 260925-xab).
   */
  it("says an event has not started before its first step and has started at it", () => {
    expect(eventStartedAtPosition(timeline, 0, "eva")).toBe(false);
    expect(eventStartedAtPosition(timeline, 0, "evb")).toBe(false);
    expect(eventStartedAtPosition(timeline, indexOf("eva:qualsDone"), "eva")).toBe(true);
    // An event key with no step at all has not started at any position.
    expect(eventStartedAtPosition(timeline, timeline.nowIndex, "not-an-event")).toBe(false);
  });

  it("is monotone, and never reads past the end of the position list", () => {
    let seen = false;
    for (let i = 0; i <= timeline.nowIndex; i++) {
      const started = eventStartedAtPosition(timeline, i, "eva");
      if (seen) expect(started).toBe(true);
      seen = seen || started;
    }
    expect(seen).toBe(true);
    expect(eventStartedAtPosition(timeline, timeline.positions.length + 50, "eva")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The playoffs and awards instants, and the as-of cut (quick task 261005-5g0)
// ---------------------------------------------------------------------------

/** One event with two PLAYED qualification rows and, optionally, played playoff rows at the given instants. */
function playedEventArtifact(eventKey: string, qualMs: readonly number[], playoffMs: readonly number[]): EventArtifact {
  const played = (matchKey: string, compLevel: string, setNumber: number, matchNumber: number, ms: number) => ({
    matchKey,
    compLevel,
    setNumber,
    matchNumber,
    sortTime: Math.floor(ms / 1000),
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 50,
    predictedBlueScore: 50,
    actualWinner: "red",
    actualRedScore: 60,
    actualBlueScore: 40,
  });
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey,
    season: 2026,
    matches: [
      ...qualMs.map((ms, n) => played(`${eventKey}_qm${String(n + 1)}`, "qm", 1, n + 1, ms)),
      ...playoffMs.map((ms, n) => played(`${eventKey}_sf${String(n + 1)}m1`, "sf", n + 1, 1, ms)),
    ],
    upcoming: [],
    teams: [],
  });
}

describe("buildDistrictTimeline: playoffs and awards sit at the last played playoff row (261005-5g0)", () => {
  /** A's quals at t+0 and t+10 min, its playoffs at t+60 and t+90 min; B's quals at t+20 and t+70 min. */
  function concurrentTimeline(options: { aPlayoffs?: readonly number[]; aPlayoffsDone?: boolean } = {}) {
    const minute = 60_000;
    return buildDistrictTimeline({
      events: [
        { eventKey: "eva", eventName: "Event A", week: 0, ...(options.aPlayoffsDone === undefined ? {} : { playoffsDone: options.aPlayoffsDone }) },
        { eventKey: "evb", eventName: "Event B", week: 0 },
      ],
      eventArtifacts: new Map([
        ["eva", playedEventArtifact("eva", [BASE_MS, BASE_MS + 10 * minute], options.aPlayoffs ?? [BASE_MS + 60 * minute, BASE_MS + 90 * minute])],
        ["evb", playedEventArtifact("evb", [BASE_MS + 20 * minute, BASE_MS + 70 * minute], [])],
      ]),
    });
  }

  it("keeps Quals done and Alliance selection at the last qualification row and moves Playoffs and Awards to the last played playoff row", () => {
    const timeline = concurrentTimeline();
    expect(timeline.positions.map((position) => position.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "eva:m:eva_qm1",
      "eva:m:eva_qm2",
      "eva:qualsDone",
      "eva:alliance",
      "evb:m:evb_qm1",
      "evb:m:evb_qm2",
      // B has no played playoff row and no state, so its four steps keep its last qualification instant.
      "evb:qualsDone",
      "evb:alliance",
      "evb:playoffs",
      "evb:awards",
      // A's playoffs end at t+90, after B's last qualification row at t+70.
      "eva:playoffs",
      "eva:awards",
      DISTRICT_TIMELINE_NOW_ID,
    ]);
  });

  it("anchors every step on the row its instant came from", () => {
    const timeline = concurrentTimeline();
    const anchorOf = (id: string) => timeline.positions.find((position) => position.id === id)?.step?.anchor;
    expect(anchorOf("eva:m:eva_qm1")).toEqual({ matchKey: "eva_qm1", played: true });
    expect(anchorOf("eva:qualsDone")).toEqual({ matchKey: "eva_qm2", played: true });
    expect(anchorOf("eva:alliance")).toEqual({ matchKey: "eva_qm2", played: true });
    expect(anchorOf("eva:playoffs")).toEqual({ matchKey: "eva_sf2m1", played: true });
    expect(anchorOf("eva:awards")).toEqual({ matchKey: "eva_sf2m1", played: true });
    expect(anchorOf("evb:playoffs")).toEqual({ matchKey: "evb_qm2", played: true });
  });

  it("reads A's playoffs as still OPEN at B's later qualification match, which the old shared instant read as final", () => {
    const timeline = concurrentTimeline();
    const atB2 = timeline.positions.findIndex((position) => position.id === "evb:m:evb_qm2");
    const stage = districtStageAtPosition(timeline, atB2, NOW_STAGES);
    expect(stage.get("eva")).toEqual({ qual: true, alliance: true, elim: false, award: false });
  });

  it("places Playoffs and Awards after every timed step while an event's playoffs are still ahead", () => {
    const timeline = concurrentTimeline({ aPlayoffs: [], aPlayoffsDone: false });
    const ids = timeline.positions.map((position) => position.id);
    expect(ids.slice(-3)).toEqual(["eva:playoffs", "eva:awards", DISTRICT_TIMELINE_NOW_ID]);
    expect(timeline.positions.find((position) => position.id === "eva:playoffs")?.step?.anchor).toBeUndefined();
    // A stop at B's last match does not read A's unplayed playoffs as final.
    const atB2 = ids.indexOf("evb:m:evb_qm2");
    expect(districtStageAtPosition(timeline, atB2, NOW_STAGES).get("eva")?.elim).toBe(false);
  });

  it("a bracket in progress: a stop after A's latest played playoff row (B's later qualification match) still reads A's playoffs and awards as OPEN, as now does (C3)", () => {
    // A has played two playoff matches (t+60, t+90) and its bracket is not done; B plays a qualification match at t+95.
    const minute = 60_000;
    const timeline = buildDistrictTimeline({
      events: [
        { eventKey: "eva", eventName: "Event A", week: 0, playoffsDone: false },
        { eventKey: "evb", eventName: "Event B", week: 0 },
      ],
      eventArtifacts: new Map([
        ["eva", playedEventArtifact("eva", [BASE_MS, BASE_MS + 10 * minute], [BASE_MS + 60 * minute, BASE_MS + 90 * minute])],
        ["evb", playedEventArtifact("evb", [BASE_MS + 20 * minute, BASE_MS + 95 * minute], [])],
      ]),
    });
    const now = new Map<string, DistrictStageFinality>([
      ["eva", { qual: true, alliance: true, elim: false, award: false }],
      ["evb", { qual: false, alliance: false, elim: false, award: false }],
    ]);
    const ids = timeline.positions.map((position) => position.id);
    for (const id of ["evb:m:evb_qm2", "evb:qualsDone", "eva:awards"]) {
      const stage = districtStageAtPosition(timeline, ids.indexOf(id), now).get("eva");
      expect(stage, id).toEqual({ qual: true, alliance: true, elim: false, award: false });
    }
    // A category open now that IS reached by a step stays open; B's own quals done step cannot close B's quals while now has them open.
    expect(districtStageAtPosition(timeline, ids.indexOf("evb:qualsDone"), now).get("evb")?.qual).toBe(false);
  });

  it("awards not yet posted: after A's finals every later stop reads A's awards as OPEN while its playoff points are final (C3)", () => {
    const timeline = concurrentTimeline({ aPlayoffsDone: true });
    const now = new Map<string, DistrictStageFinality>([
      ["eva", { qual: true, alliance: true, elim: true, award: false }],
      ["evb", { qual: true, alliance: true, elim: true, award: true }],
    ]);
    const ids = timeline.positions.map((position) => position.id);
    const atAwards = districtStageAtPosition(timeline, ids.indexOf("eva:awards"), now);
    expect(atAwards.get("eva")).toEqual({ qual: true, alliance: true, elim: true, award: false });
    expect(atAwards.get("evb")).toEqual({ qual: true, alliance: true, elim: true, award: true });
    // The live view itself is untouched.
    expect(districtStageAtPosition(timeline, timeline.nowIndex, now)).toEqual(now);
  });

  it("falls back to the last qualification instant for an event with no played playoff row whose playoffs are done", () => {
    const timeline = concurrentTimeline({ aPlayoffs: [], aPlayoffsDone: true });
    const ids = timeline.positions.map((position) => position.id);
    expect(ids.indexOf("eva:playoffs")).toBe(ids.indexOf("eva:alliance") + 1);
    expect(timeline.positions[ids.indexOf("eva:awards")]?.step?.anchor).toEqual({ matchKey: "eva_qm2", played: true });
  });
});

describe("cutAtPosition (261005-5g0)", () => {
  it("names the season start, a match step's own row, and a stage step's anchor with the stage flag", () => {
    const timeline = buildDistrictTimeline({
      events: [{ eventKey: "eva", eventName: "Event A", week: 0 }],
      eventArtifacts: new Map([["eva", playedEventArtifact("eva", [BASE_MS, BASE_MS + 60_000], [BASE_MS + 600_000])]]),
    });
    const at = (id: string) => timeline.positions.findIndex((position) => position.id === id);
    expect(cutAtPosition(timeline, 0)).toEqual({ kind: "seasonStart" });
    expect(cutAtPosition(timeline, at("eva:m:eva_qm2"))).toEqual({ kind: "row", eventKey: "eva", matchKey: "eva_qm2", played: true, stage: false });
    expect(cutAtPosition(timeline, at("eva:qualsDone"))).toEqual({ kind: "row", eventKey: "eva", matchKey: "eva_qm2", played: true, stage: true });
    expect(cutAtPosition(timeline, at("eva:awards"))).toEqual({ kind: "row", eventKey: "eva", matchKey: "eva_sf1m1", played: true, stage: true });
    expect(firstMatchPositionIndex(timeline, "eva")).toBe(1);
  });

  it("returns null for a step with no anchor: an event whose artifact is not loaded", () => {
    const timeline = buildDistrictTimeline({ events: [{ eventKey: "eva", eventName: "Event A", week: 0 }], eventArtifacts: new Map() });
    const qualsDone = timeline.positions.findIndex((position) => position.id === "eva:qualsDone");
    expect(cutAtPosition(timeline, qualsDone)).toBeNull();
    expect(firstMatchPositionIndex(timeline, "eva")).toBe(-1);
  });

  it("marks an unplayed scheduled row's anchor as not played", () => {
    const timeline = interleavedTimeline();
    const step = timeline.positions.findIndex((position) => position.id === "eva:m:eva_qm1");
    expect(cutAtPosition(timeline, step)).toEqual({ kind: "row", eventKey: "eva", matchKey: "eva_qm1", played: false, stage: false });
  });
});

describe("timelineEventsOf (261005-5g0)", () => {
  it("adds each event's playoffsDone from its state and leaves an event with no state untouched", () => {
    const events = [
      { eventKey: "eva", eventName: "A", week: 0 },
      { eventKey: "evb", eventName: "B", week: 1 },
    ];
    expect(timelineEventsOf(events, [{ eventKey: "eva", state: { playoffsDone: false } }, { eventKey: "evb", state: undefined }])).toEqual([
      { eventKey: "eva", eventName: "A", week: 0, playoffsDone: false },
      { eventKey: "evb", eventName: "B", week: 1 },
    ]);
  });
});
