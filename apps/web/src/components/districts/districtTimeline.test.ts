/**
 * The district's interleaved timeline, its step resolver, its derived jump
 * chips and the per-event stage at a position.
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
  districtStageAtPosition,
  eventsWithOpenCategoriesAt,
  remainingQualRowsAtPosition,
  resolveDistrictTimelinePosition,
  startMatchKeyAtPosition,
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

describe("the derived jump chips", () => {
  it("derives one chip after each distinct week present, plus season start and now", () => {
    const fourWeeks = buildDistrictTimeline({
      events: [0, 1, 2, 3].map((week) => ({ eventKey: `ev${String(week)}`, eventName: `Event ${String(week)}`, week })),
      eventArtifacts: new Map(),
    });
    expect(fourWeeks.chips.map((chip) => chip.id)).toEqual([
      DISTRICT_TIMELINE_SEASON_START_ID,
      "week-0",
      "week-1",
      "week-2",
      "week-3",
      DISTRICT_TIMELINE_NOW_ID,
    ]);
  });

  it("derives only one week chip on a single-week fixture — never a hardcoded week list", () => {
    const oneWeek = buildDistrictTimeline({ events: EVENTS, eventArtifacts: new Map() });
    expect(oneWeek.chips.map((chip) => chip.id)).toEqual([DISTRICT_TIMELINE_SEASON_START_ID, "week-0", DISTRICT_TIMELINE_NOW_ID]);
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
});
