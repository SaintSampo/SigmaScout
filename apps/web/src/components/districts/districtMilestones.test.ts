/**
 * The Locks milestone picker's pure model: the milestone mapping, happened,
 * selection, done and fill, the walk, and the event menu's focus.
 *
 * The timelines are built with the REAL `buildDistrictTimeline`, and the event
 * artifacts are parsed through the REAL `EventArtifactSchema`. The helper
 * mirrors `districtTimeline.test.ts`'s own, which that file does not export.
 */
import { describe, expect, it } from "vitest";
import { EventArtifactSchema, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictEventStateFacts } from "../../../../../packages/core/districts/reservedSlots.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  DISTRICT_TIMELINE_SEASON_START_ID,
  buildDistrictTimeline,
  districtScheduleMilestoneId,
  districtStageAtPosition,
  resolveDistrictTimelinePosition,
} from "./districtTimeline.js";
import {
  DISTRICT_MILESTONE_KEYS,
  buildDistrictMilestones,
  defaultMilestoneFocus,
  districtMilestoneSelection,
  milestoneFocusTarget,
  milestoneStopStates,
  milestoneWalkNeighbours,
  walkItemAtId,
  type DistrictMilestoneEventInput,
  type DistrictMilestoneModel,
} from "./districtMilestones.js";
import type { DistrictTimeline } from "./districtTimeline.js";

const BASE_MS = Date.parse("2026-03-06T17:00:00.000Z");
const MINUTE = 60_000;

function eventArtifact(eventKey: string, count: number, startMs: number, stepMs = MINUTE): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey,
    season: 2026,
    matches: [],
    upcoming: Array.from({ length: count }, (_unused, i) => ({
      matchKey: `${eventKey}_qm${String(i + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: startMs + i * stepMs,
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

function state(overrides: Partial<DistrictEventStateFacts> = {}): DistrictEventStateFacts {
  return { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true, ...overrides };
}

const MID_QUALS = state({ qualMatchesPlayed: 6, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
const UNSTARTED = state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

function input(eventKey: string, eventState: DistrictEventStateFacts | undefined, week: number | null = 0, eventName = eventKey.toUpperCase()): DistrictMilestoneEventInput {
  return { eventKey, eventName, week, isDcmp: false, state: eventState };
}

function timelineOf(inputs: readonly DistrictMilestoneEventInput[], artifacts: [string, EventArtifact][] = []): DistrictTimeline {
  return buildDistrictTimeline({
    events: inputs.map(({ eventKey, eventName, week }) => ({ eventKey, eventName, week })),
    eventArtifacts: new Map(artifacts),
  });
}

function modelOf(timeline: DistrictTimeline, inputs: readonly DistrictMilestoneEventInput[]): DistrictMilestoneModel {
  return buildDistrictMilestones(timeline, inputs);
}

function milestone(model: DistrictMilestoneModel, eventKey: string, key: (typeof DISTRICT_MILESTONE_KEYS)[number]) {
  const found = model.byEvent.get(eventKey)?.milestones.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`no ${key} for ${eventKey}`);
  return found;
}

function select(model: DistrictMilestoneModel, timeline: DistrictTimeline, at: string | undefined) {
  return districtMilestoneSelection(model, timeline, at, resolveDistrictTimelinePosition(timeline, at));
}

describe("the milestone mapping", () => {
  const events = [input("ev", state())];

  it("builds every id with no artifact loaded, resolving only the four stage stops", () => {
    const timeline = timelineOf(events);
    const model = modelOf(timeline, events);
    const stops = model.byEvent.get("ev")!.milestones;
    expect(stops.map((stop) => stop.key)).toEqual([...DISTRICT_MILESTONE_KEYS]);
    expect(stops.every((stop) => stop.happened)).toBe(true);
    expect(stops.slice(1, 4).map((stop) => stop.atId)).toEqual(["ev:m:ev_qm3", "ev:m:ev_qm6", "ev:m:ev_qm9"]);
    for (const stop of stops.slice(0, 4)) expect(stop.positionIndex).toBeNull();
    expect(stops[0]!.atId).toBe("ev:schedule");
    for (const [i, key] of (["qualsDone", "alliance", "playoffs", "awards"] as const).entries()) {
      expect(stops[4 + i]!.atId).toBe(`ev:${key}`);
      expect(stops[4 + i]!.positionIndex).toBe(resolveDistrictTimelinePosition(timeline, `ev:${key}`));
    }
    // The unresolved stops sort just before their own Quals Done, in stop order.
    const orders = stops.map((stop) => stop.order);
    for (let i = 1; i < orders.length; i++) {
      const [a, b] = [orders[i - 1]!, orders[i]!];
      expect(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])).toBe(true);
    }
    expect(orders[3]![0]).toBe(stops[4]!.positionIndex);
  });

  it("resolves the quartiles and the schedule alias once the artifact loads", () => {
    const timeline = timelineOf(events, [["ev", eventArtifact("ev", 12, BASE_MS)]]);
    const model = modelOf(timeline, events);
    const firstMatch = resolveDistrictTimelinePosition(timeline, "ev:m:ev_qm1");
    expect(milestone(model, "ev", "q2").positionIndex).toBe(resolveDistrictTimelinePosition(timeline, "ev:m:ev_qm6"));
    expect(milestone(model, "ev", "schedule").positionIndex).toBe(firstMatch - 1);
    expect(resolveDistrictTimelinePosition(timeline, "ev:schedule")).toBe(firstMatch - 1);
    // The first event in the timeline resolves schedule to season start's index.
    expect(firstMatch - 1).toBe(0);
  });

  it("resolves a later event's schedule to the step just before its first match, and never shadows an exact id", () => {
    const two = [input("eva", state()), input("evb", state())];
    const timeline = timelineOf(two, [
      ["eva", eventArtifact("eva", 4, BASE_MS)],
      ["evb", eventArtifact("evb", 4, BASE_MS + 10 * MINUTE)],
    ]);
    const index = resolveDistrictTimelinePosition(timeline, "evb:schedule");
    expect(timeline.positions[index + 1]!.id).toBe("evb:m:evb_qm1");
    expect(timeline.positions[index]!.step?.eventKey).toBe("eva");
    // An exact id still wins: a real step id never reaches the alias branch.
    expect(resolveDistrictTimelinePosition(timeline, "eva:awards")).toBe(timeline.positions.findIndex((p) => p.id === "eva:awards"));
    expect(districtScheduleMilestoneId("evb")).toBe("evb:schedule");
  });

  it("resolves the alias to now when the event has no match step in the timeline", () => {
    const timeline = timelineOf(events);
    expect(resolveDistrictTimelinePosition(timeline, "ev:schedule")).toBe(timeline.nowIndex);
    expect(resolveDistrictTimelinePosition(timeline, "nope:schedule")).toBe(timeline.nowIndex);
  });

  it("leaves every one of the event's categories open at the Schedule position", () => {
    const timeline = timelineOf(events, [["ev", eventArtifact("ev", 12, BASE_MS)]]);
    const index = resolveDistrictTimelinePosition(timeline, "ev:schedule");
    const stage = districtStageAtPosition(timeline, index, new Map([["ev", { qual: true, alliance: true, elim: true, award: true }]]));
    expect(stage.get("ev")).toEqual({ qual: false, alliance: false, elim: false, award: false });
  });
});

describe("happened reads the state blocks", () => {
  it("an event in mid qualification has schedule, q1 and q2 and nothing later, and is live", () => {
    const events = [input("ev", MID_QUALS)];
    const timeline = timelineOf(events);
    const model = modelOf(timeline, events);
    const event = model.byEvent.get("ev")!;
    expect(event.milestones.map((stop) => stop.happened)).toEqual([true, true, true, false, false, false, false, false]);
    expect(event.status).toBe("live");
    expect(milestoneStopStates(model, "ev", { kind: "live" }).nowBoundary).toBe(3);
  });

  it("an unstarted event, or one with no state block, has nothing happened and is up", () => {
    for (const eventState of [UNSTARTED, undefined]) {
      const events = [input("ev", eventState)];
      const model = modelOf(timelineOf(events), events);
      const event = model.byEvent.get("ev")!;
      expect(event.milestones.some((stop) => stop.happened)).toBe(false);
      expect(event.status).toBe("up");
      expect(milestoneStopStates(model, "ev", { kind: "live" }).nowBoundary).toBeNull();
    }
  });

  it("a future event's stage steps sort before now but are NOT happened", () => {
    const events = [input("past", state(), 0), input("soon", UNSTARTED, 3)];
    const timeline = timelineOf(events);
    const model = modelOf(timeline, events);
    const awards = milestone(model, "soon", "awards");
    expect(awards.positionIndex).not.toBeNull();
    expect(awards.positionIndex!).toBeLessThan(timeline.nowIndex);
    expect(awards.happened).toBe(false);
  });
});

describe("the selection", () => {
  const events = [input("ev", state())];
  const loaded = timelineOf(events, [["ev", eventArtifact("ev", 12, BASE_MS)]]);
  const stageOnly = timelineOf(events);

  it("reads Live, Start, a happened milestone, a position and garbage", () => {
    const model = modelOf(loaded, events);
    expect(select(model, loaded, undefined)).toEqual({ kind: "live" });
    expect(select(model, loaded, DISTRICT_TIMELINE_NOW_ID)).toEqual({ kind: "live" });
    expect(select(model, loaded, DISTRICT_TIMELINE_SEASON_START_ID)).toEqual({ kind: "start" });
    const q2 = select(model, loaded, "ev:m:ev_qm6");
    expect(q2.kind === "milestone" && q2.milestone.key).toBe("q2");
    const seventh = select(model, loaded, "ev:m:ev_qm7");
    expect(seventh).toEqual({ kind: "position", eventKey: "ev", positionIndex: resolveDistrictTimelinePosition(loaded, "ev:m:ev_qm7") });
    expect(select(model, loaded, "garbage")).toEqual({ kind: "live" });
  });

  it("selects a happened milestone even while its step is unresolved", () => {
    const model = modelOf(stageOnly, events);
    const q2 = select(model, stageOnly, "ev:m:ev_qm6");
    expect(q2.kind === "milestone" && q2.milestone.key).toBe("q2");
    const schedule = select(model, stageOnly, "ev:schedule");
    expect(schedule.kind === "milestone" && schedule.milestone.key).toBe("schedule");
  });

  it("reads a link to a milestone that has not happened as a position, with no stop pressed", () => {
    const live = [input("ev", MID_QUALS)];
    const timeline = timelineOf(live, [["ev", eventArtifact("ev", 12, BASE_MS)]]);
    const model = modelOf(timeline, live);
    const selection = select(model, timeline, "ev:m:ev_qm9");
    expect(selection.kind).toBe("position");
    expect(milestoneStopStates(model, "ev", selection).pressed.some(Boolean)).toBe(false);
  });
});

describe("done and fill", () => {
  const events = [input("ev", state())];
  const loaded = timelineOf(events, [["ev", eventArtifact("ev", 12, BASE_MS)]]);

  it("at Live done equals happened; at Start nothing is done", () => {
    const model = modelOf(loaded, events);
    const live = milestoneStopStates(model, "ev", { kind: "live" });
    expect(live.done).toEqual(live.happened);
    expect(live.fillStop).toBe(7);
    const start = milestoneStopStates(model, "ev", { kind: "start" });
    expect(start.done.some(Boolean)).toBe(false);
    expect(start.fillStop).toBe(-1);
  });

  it("at q2 stops 0 to 2 are done, stop 2 is pressed and the fill reaches it", () => {
    for (const timeline of [loaded, timelineOf(events)]) {
      const model = modelOf(timeline, events);
      const states = milestoneStopStates(model, "ev", select(model, timeline, "ev:m:ev_qm6"));
      expect(states.done).toEqual([true, true, true, false, false, false, false, false]);
      expect(states.pressed).toEqual([false, false, true, false, false, false, false, false]);
      expect(states.fillStop).toBe(2);
    }
  });

  it("at a non milestone position stops 0 to 2 are done and none is pressed", () => {
    const model = modelOf(loaded, events);
    const states = milestoneStopStates(model, "ev", select(model, loaded, "ev:m:ev_qm7"));
    expect(states.done).toEqual([true, true, true, false, false, false, false, false]);
    expect(states.pressed.some(Boolean)).toBe(false);
    expect(states.fillStop).toBe(2);
  });
});

describe("the walk", () => {
  // Two loaded events whose matches interleave: A's match k at t + 2k, B's at t + 2k + 1.
  const events = [input("eva", state({ qualMatchesPlayed: 4, qualMatchesTotal: 4 })), input("evb", state({ qualMatchesPlayed: 4, qualMatchesTotal: 4 }))];
  const timeline = timelineOf(events, [
    ["eva", eventArtifact("eva", 4, BASE_MS, 2 * MINUTE)],
    ["evb", eventArtifact("evb", 4, BASE_MS + MINUTE, 2 * MINUTE)],
  ]);
  const model = modelOf(timeline, events);

  it("runs Start, every happened milestone in position order, then Live", () => {
    const ids = model.walk.map(walkItemAtId);
    expect(ids[0]).toBe(DISTRICT_TIMELINE_SEASON_START_ID);
    expect(ids[ids.length - 1]).toBe(DISTRICT_TIMELINE_NOW_ID);
    expect(ids).toHaveLength(2 + 16);
    const positions = ids.slice(1, -1).map((id) => resolveDistrictTimelinePosition(timeline, id));
    for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeGreaterThanOrEqual(positions[i - 1]!);
    // The two events interleave rather than running one after the other.
    const owners = model.walk.slice(1, -1).map((item) => (item.kind === "milestone" ? item.milestone.eventKey : ""));
    expect(owners.slice(0, 4)).toEqual(["eva", "evb", "eva", "evb"]);
  });

  it("never walks onto a stop that has not happened", () => {
    const live = [input("ev", MID_QUALS)];
    const liveModel = modelOf(timelineOf(live), live);
    const keys = liveModel.walk.flatMap((item) => (item.kind === "milestone" ? [item.milestone.key] : []));
    expect(keys).toEqual(["schedule", "q1", "q2"]);
  });

  it("straddles a position selection, and ends at Start and Live", () => {
    const at = "eva:m:eva_qm3";
    const index = resolveDistrictTimelinePosition(timeline, at);
    const { prev, next } = milestoneWalkNeighbours(model, select(model, timeline, at));
    expect(resolveDistrictTimelinePosition(timeline, walkItemAtId(prev!))).toBeLessThan(index);
    expect(resolveDistrictTimelinePosition(timeline, walkItemAtId(next!))).toBeGreaterThan(index);
    expect(milestoneWalkNeighbours(model, { kind: "start" }).prev).toBeUndefined();
    expect(milestoneWalkNeighbours(model, { kind: "live" }).next).toBeUndefined();
    const fromStart = milestoneWalkNeighbours(model, { kind: "start" }).next!;
    expect(walkItemAtId(fromStart)).toBe("eva:schedule");
    expect(milestoneWalkNeighbours(model, { kind: "live" }).prev).toBe(model.walk[model.walk.length - 2]);
  });

  it("walks from a milestone to its neighbours", () => {
    const selection = select(model, timeline, "eva:m:eva_qm2");
    const { prev, next } = milestoneWalkNeighbours(model, selection);
    const walkIndex = model.walk.findIndex((item) => item.kind === "milestone" && item.milestone.atId === "eva:m:eva_qm2");
    expect(prev).toBe(model.walk[walkIndex - 1]);
    expect(next).toBe(model.walk[walkIndex + 1]);
  });
});

describe("the event menu's focus", () => {
  const events = [
    input("a", state(), 0, "Alpha"),
    input("b", state(), 1, "Bravo"),
    input("c", state({ qualMatchesPlayed: 3, alliancesPicked: false, playoffsDone: false, awardsPosted: false }), 2, "Charlie"),
    input("d", UNSTARTED, 3, "Delta"),
  ];
  const timeline = timelineOf(events);
  const model = modelOf(timeline, events);

  it("keeps the same stop when it has happened in the chosen event, else takes the latest happened one", () => {
    const atAq2 = select(model, timeline, "a:m:a_qm6");
    expect(milestoneFocusTarget(model, "b", atAq2)).toBe("b:m:b_qm6");
    expect(milestoneFocusTarget(model, "c", atAq2)).toBe("c:m:c_qm3");
    expect(milestoneFocusTarget(model, "d", atAq2)).toBeNull();
    expect(milestoneFocusTarget(model, "b", { kind: "live" })).toBe("b:awards");
  });

  it("opens on the live event, else the last started one, else the first", () => {
    expect(defaultMilestoneFocus(model)).toBe("c");
    const noLive = events.filter((event) => event.eventKey !== "c");
    expect(defaultMilestoneFocus(modelOf(timelineOf(noLive), noLive))).toBe("b");
    const preseason = [input("x", UNSTARTED, 0, "Xray"), input("y", undefined, 1, "Yankee")];
    expect(defaultMilestoneFocus(modelOf(timelineOf(preseason), preseason))).toBe("x");
  });

  it("orders the events by their first step in the timeline", () => {
    expect(model.events.map((event) => event.input.eventKey)).toEqual(["a", "b", "c", "d"]);
  });
});
