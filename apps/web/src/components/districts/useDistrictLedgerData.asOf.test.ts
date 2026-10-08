/**
 * The district run's request assembly at Live and at a rewound stop (quick
 * task 261005-5g0).
 *
 * LIVE IS PINNED AGAINST A FROZEN COPY of the assembly and the signature as
 * they stood before the as-of path existed (`frozenLiveAssembly` below, the old
 * `useMemo` body and `districtRunSignature` verbatim). The Live request list
 * and its signature must stay byte for byte what they were.
 */
import { describe, expect, it } from "vitest";
import type { DistrictLedgerEventInput } from "../../../../../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { AsOfIndex, AsOfLog, AsOfSeason, AsOfStart } from "../../../../../packages/harness/asOfState.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import { MAX_DISTRICT_SIMULATION_ROSTER, type DistrictSimulationEventEntry, type DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import { runAsOfEvent } from "../../workers/districtAsOfJob.js";
import { assembleSimulatedDcmpBake, simulatedDcmpBakeView } from "./districtRunAssembly.js";
import { loadAsOfRewind, type AsOfFetchers, type AsOfRewindResult } from "./asOfRewind.js";
import {
  ARTIFACTS,
  BBB,
  CANDIDATES,
  EVENTS,
  FIXTURE_VERSION,
  NOW_STAGES,
  OBJECTS,
  asOfBodyFor,
  districtArtifact,
} from "./asOfTestFixtures.js";
import { DISTRICT_CATEGORIES, buildDistrictEventSimulationInput, type DistrictStageFinality } from "./districtLedgerRows.js";
import { buildDistrictTimeline, districtStageAtPosition, startMatchKeyAtPosition } from "./districtTimeline.js";
import {
  AS_OF_UNAVAILABLE_NAME,
  assembleAsOfDistrictEvents,
  assembleLiveDistrictEvents,
  districtRunSignature,
} from "./useDistrictLedgerData.js";

// ---------------------------------------------------------------------------
// The frozen pre 261005-5g0 assembly
// ---------------------------------------------------------------------------

const FROZEN_SIGNATURE_ABSENT = "-";

function frozenFoldKnownPoints(known: ReadonlyMap<string, number> | undefined): string {
  if (known === undefined) return FROZEN_SIGNATURE_ABSENT;
  return [...known]
    .map(([teamKey, value]) => `${teamKey}=${String(value)}`)
    .sort()
    .join(",");
}

function frozenFoldKnownAlliances(alliances: DistrictLedgerEventInput["knownAlliances"]): string {
  if (alliances === undefined) return FROZEN_SIGNATURE_ABSENT;
  return [...alliances]
    .map((alliance) => `${String(alliance.allianceNumber)}:${alliance.picks.join("+")}`)
    .sort()
    .join(",");
}

function frozenFoldBaselines(baselines: DistrictLedgerEventInput["baselines"]): string {
  return baselines.map((baseline) => `${baseline.teamKey}=${String(baseline.earnedRpSum)}/${String(baseline.matchesPlayed)}`).join(",");
}

function frozenFoldPlayedElims(matches: DistrictLedgerEventInput["playedElimMatches"]): string {
  if (matches === undefined) return FROZEN_SIGNATURE_ABSENT;
  return [...matches]
    .map((match) => `${match.compLevel}${String(match.setNumber)}m${String(match.matchNumber)}=${String(match.winningAllianceNumber)}`)
    .sort()
    .join(",");
}

function frozenRunSignature(events: readonly DistrictSimulationEventRequest[]): string {
  return events
    .map((event) => {
      const input = event.input;
      return [
        event.eventKey,
        String(input.remainingMatches.length),
        String(input.allianceCount),
        String(input.fieldSize),
        frozenFoldBaselines(input.baselines),
        frozenFoldKnownAlliances(input.knownAlliances),
        frozenFoldKnownPoints(input.knownElimPoints),
        frozenFoldKnownPoints(input.knownAwardPoints),
        frozenFoldPlayedElims(input.playedElimMatches),
        ...(input.awardOnlyTeams === undefined ? [] : [`awardOnly=${input.awardOnlyTeams.join(",")}`]),
      ].join("|");
    })
    .join(";");
}

function frozenDefaultStartKey(artifact: EventArtifact): string | null {
  const rows = buildQualRows(artifact);
  return rows.find((row) => !row.played)?.matchKey ?? null;
}

function frozenLiveAssembly(
  artifact: DistrictArtifact,
  activeKeys: readonly string[],
  eventArtifacts: ReadonlyMap<string, EventArtifact>,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  startMatchKeyByEvent: ReadonlyMap<string, string | null> | undefined,
  tierByEvent: ReadonlyMap<string, DistrictTier> | undefined
) {
  const events: DistrictSimulationEventRequest[] = [];
  const eventsWithExcludedMatches: string[] = [];
  const eventsWithFallbackFieldSize: string[] = [];
  const eventsWithPartialAllianceList: string[] = [];
  const eventsWithUnresolvedElimMatches: string[] = [];
  for (const eventKey of activeKeys) {
    const eventArtifact = eventArtifacts.get(eventKey);
    if (eventArtifact === undefined) continue;
    const stage = stageByEvent.get(eventKey);
    if (stage === undefined) continue;
    if (DISTRICT_CATEGORIES.every((category) => stage[category])) continue;
    const startMatchKey = startMatchKeyByEvent?.has(eventKey) ? (startMatchKeyByEvent.get(eventKey) ?? null) : frozenDefaultStartKey(eventArtifact);
    const built = buildDistrictEventSimulationInput({
      eventKey,
      season: artifact.year,
      eventArtifact,
      districtArtifact: artifact,
      stage,
      startMatchKey,
      conditionOnPlayedElims: startMatchKeyByEvent === undefined,
      tier: tierByEvent?.get(eventKey) ?? "district",
    });
    if (!built.ok) continue;
    if (built.excludedMatchCount > 0) eventsWithExcludedMatches.push(eventKey);
    if (built.fieldSizeFellBack) eventsWithFallbackFieldSize.push(eventKey);
    if (built.allianceListIsPartial) eventsWithPartialAllianceList.push(eventKey);
    if (built.unresolvedElimMatchKeys.length > 0) eventsWithUnresolvedElimMatches.push(eventKey);
    events.push({ eventKey, input: built.input });
  }
  return {
    events,
    signature: frozenRunSignature(events),
    eventsWithExcludedMatches,
    eventsWithFallbackFieldSize,
    eventsWithPartialAllianceList,
    eventsWithUnresolvedElimMatches,
  };
}

// ---------------------------------------------------------------------------

describe("the Live request list is byte for byte the shipped one", () => {
  const artifact = districtArtifact();

  it("at now: the same requests, the same gaps, the same signature, and no as-of block anywhere", () => {
    const params = { artifact, activeKeys: ["2026waaa", "2026wabbb"], eventArtifacts: ARTIFACTS, stageByEvent: NOW_STAGES };
    const live = assembleLiveDistrictEvents(params);
    const frozen = frozenLiveAssembly(artifact, params.activeKeys, ARTIFACTS, NOW_STAGES, undefined, undefined);
    expect(live.events).toEqual(frozen.events);
    expect(live.signature).toBe(frozen.signature);
    expect(districtRunSignature(live.events)).toBe(frozenRunSignature(frozen.events));
    expect({ ...live, asOfUnavailable: undefined, events: undefined, signature: undefined }).toEqual({ ...frozen, asOfUnavailable: undefined, events: undefined, signature: undefined });
    expect(live.asOfUnavailable).toEqual([]);
    expect(live.events.every((event) => event.asOf === undefined)).toBe(true);
  });

  it("with an override map and a dcmp tier, every branch of the shipped assembly agrees", () => {
    const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
    for (let positionIndex = 0; positionIndex < timeline.positions.length; positionIndex++) {
      const stageByEvent = districtStageAtPosition(timeline, positionIndex, NOW_STAGES);
      const startMatchKeyByEvent = new Map(EVENTS.map((event) => [event.eventKey, startMatchKeyAtPosition(timeline, positionIndex, event.eventKey)] as const));
      const tierByEvent = new Map<string, DistrictTier>([["2026wabbb", "dcmp"]]);
      const params = { artifact, activeKeys: ["2026waaa", "2026wabbb"], eventArtifacts: ARTIFACTS, stageByEvent, startMatchKeyByEvent, tierByEvent };
      const live = assembleLiveDistrictEvents(params);
      const frozen = frozenLiveAssembly(artifact, params.activeKeys, ARTIFACTS, stageByEvent, startMatchKeyByEvent, tierByEvent);
      expect(live.events).toEqual(frozen.events);
      expect(live.signature).toBe(frozen.signature);
    }
  });
});

function fetchers(): AsOfFetchers {
  const read = <T,>(key: string): T | null => {
    const body = asOfBodyFor(OBJECTS, key);
    return body === undefined ? null : (JSON.parse(body) as T);
  };
  return {
    index: async (eventKey) => read<AsOfIndex>(`v1/asof/${eventKey}/spr@${FIXTURE_VERSION}.json`),
    log: async (eventKey) => read<AsOfLog>(`v1/asof-log/${eventKey}/spr@${FIXTURE_VERSION}.json`),
    season: async () => read<AsOfSeason>(`v1/asof-season/2026/spr@${FIXTURE_VERSION}.json`),
    start: async () => read<AsOfStart>(`v1/asof-start/2026/spr@${FIXTURE_VERSION}.json`),
  };
}

async function rewoundAt(positionId: string): Promise<{ result: AsOfRewindResult; stageByEvent: Map<string, DistrictStageFinality> }> {
  const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
  const positionIndex = timeline.positions.findIndex((position) => position.id === positionId);
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, NOW_STAGES);
  const result = await loadAsOfRewind({ districtArtifact: districtArtifact(), timeline, positionIndex, eventArtifacts: ARTIFACTS, stageByEvent, candidates: CANDIDATES, scheduleStopEventKey: undefined }, fetchers());
  return { result, stageByEvent };
}

describe("a rewound stop's requests", () => {
  it("puts REAL events first and GENERATED after, prices nothing on the main thread, and bakes with the publisher's parameters", async () => {
    const { result, stageByEvent } = await rewoundAt("2026wabbb:m:2026wabbb_qm2");
    const assembled = assembleAsOfDistrictEvents({ artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventArtifacts: ARTIFACTS, stageByEvent, candidateKeys: ["2026wabbb", "2026wazzz"] });
    expect(assembled.events.map((event) => [event.eventKey, event.asOf?.mode])).toEqual([
      ["2026wabbb", "real"],
      ["2026wazzz", "generated"],
    ]);
    const [real, generated] = assembled.events;
    // Nothing from a stored row or `teams[].metrics`: the Worker fills both.
    expect(real!.input.remainingMatches).toEqual([]);
    expect(real!.input.ratings.size).toBe(0);
    expect(real!.asOf?.rows?.map((row) => row.matchKey)).toEqual(["2026wabbb_qm3", "2026wabbb_qm4", "2026wabbb_qm5", "2026wabbb_qm6", "2026wabbb_qm7", "2026wabbb_qm8"]);
    expect(generated!.input).toMatchObject({ fieldSize: 8, allianceCount: 8, remainingMatches: [] });
    expect(generated!.asOf?.bake).toEqual({ districtKey: "2026pnw", eventType: 1, week: 2, matchesPerTeam: 12, algorithmId: "spr", algorithmVersion: FIXTURE_VERSION });
    expect(assembled.signature).toContain("asOf=2026wabbb@");
  });

  it("re-runs on every stop change: the signature carries the cut and the mode", async () => {
    const a = await rewoundAt("2026wabbb:m:2026wabbb_qm2");
    const b = await rewoundAt("2026wabbb:m:2026wabbb_qm3");
    const sign = (r: typeof a) =>
      assembleAsOfDistrictEvents({ artifact: districtArtifact(), result: r.result, algorithmVersion: FIXTURE_VERSION, eventArtifacts: ARTIFACTS, stageByEvent: r.stageByEvent, candidateKeys: [] }).signature;
    expect(sign(a)).not.toBe(sign(b));
    expect(sign(a)).toBe(sign(await rewoundAt("2026wabbb:m:2026wabbb_qm2")));
  });

  it("names every open event unavailable when the stop has no exact instant, and drops the events the caller skips", () => {
    const assembled = assembleAsOfDistrictEvents({
      artifact: districtArtifact(),
      result: { status: "unavailable", reason: "test" },
      algorithmVersion: FIXTURE_VERSION,
      eventArtifacts: ARTIFACTS,
      stageByEvent: NOW_STAGES,
      skipEventKeys: new Set(["2026wazzz"]),
      candidateKeys: ["2026wabbb", "2026wazzz"],
    });
    expect(assembled.events).toEqual([]);
    expect(assembled.asOfUnavailable).toEqual([{ eventKey: "2026wabbb", name: AS_OF_UNAVAILABLE_NAME }]);
  });

  it("a REAL event the input builder refuses, or whose artifact is gone, reads unavailable instead of vanishing (C6)", async () => {
    const { result, stageByEvent } = await rewoundAt("2026wabbb:m:2026wabbb_qm2");
    if (result.status !== "ready") throw new Error("expected a ready plan");
    const bbb = result.events.get("2026wabbb")!;
    if (bbb.status !== "ready" || bbb.state.plan.mode !== "real") throw new Error("expected a REAL 2026wabbb");
    // No roster team and no remaining row at the stop: `buildDistrictEventSimulationInput` refuses it.
    const refused: AsOfRewindResult = { ...result, events: new Map(result.events).set("2026wabbb", { status: "ready", state: { ...bbb.state, plan: { ...bbb.state.plan, baselines: [], rows: [] } } }) };
    const params = { artifact: districtArtifact(), algorithmVersion: FIXTURE_VERSION, eventArtifacts: ARTIFACTS, stageByEvent, candidateKeys: ["2026wabbb", "2026wazzz"] };
    const assembled = assembleAsOfDistrictEvents({ ...params, result: refused });
    expect(assembled.events.map((event) => event.eventKey)).toEqual(["2026wazzz"]);
    expect(assembled.asOfUnavailable).toEqual([{ eventKey: "2026wabbb", name: AS_OF_UNAVAILABLE_NAME }]);
    // The same for a REAL plan whose artifact is not in hand.
    const noArtifact = assembleAsOfDistrictEvents({ ...params, result, eventArtifacts: new Map([["2026waaa", ARTIFACTS.get("2026waaa")!]]) });
    expect(noArtifact.asOfUnavailable).toEqual([{ eventKey: "2026wabbb", name: AS_OF_UNAVAILABLE_NAME }]);
  });

  it("a started event whose artifact failed to load reads unavailable at a rewound stop, never simulated as unstarted (R3)", async () => {
    const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
    const positionIndex = timeline.positions.findIndex((position) => position.id === "2026waaa:awards");
    const stageByEvent = districtStageAtPosition(timeline, positionIndex, NOW_STAGES);
    // 2026wabbb's artifact query errored: the fetch set holds 2026waaa only.
    const loaded = new Map([["2026waaa", ARTIFACTS.get("2026waaa")!]]);
    const input = { districtArtifact: districtArtifact(), timeline, positionIndex, eventArtifacts: loaded, stageByEvent, candidates: CANDIDATES, scheduleStopEventKey: undefined };
    const told = await loadAsOfRewind({ ...input, unloadedEventKeys: ["2026wabbb"] }, fetchers());
    expect(told.status === "ready" && told.events.get("2026wabbb")).toMatchObject({ status: "unavailable" });
    // Without the fact, the same stop would have generated a full forecast for an event that has played.
    const blind = await loadAsOfRewind(input, fetchers());
    const generated = blind.status === "ready" ? blind.events.get("2026wabbb") : undefined;
    expect(generated?.status === "ready" && generated.state.plan.mode).toBe("generated");
    // Unstarted events are untouched.
    expect(told.status === "ready" && told.events.get("2026wazzz")?.status).toBe("ready");
  });

  it("discloses a REAL event whose as-of playoff row cannot be resolved to one alliance (261007-3g2)", async () => {
    const { result } = await rewoundAt("2026wabbb:m:2026wabbb_qm2");
    if (result.status !== "ready") throw new Error("expected a ready plan");
    const bbb = result.events.get("2026wabbb")!;
    if (bbb.status !== "ready" || bbb.state.plan.mode !== "real") throw new Error("expected a REAL 2026wabbb");
    // Eight published alliances, and a played sf row whose red side spans three of them.
    const alliances = Array.from({ length: 8 }, (_unused, n) => ({ allianceNumber: n + 1, picks: [1, 2, 3].map((k) => `frc9${String(n + 1)}${String(k)}`) }));
    const spanning = { ...BBB.matches[0]!, matchKey: "2026wabbb_sf1m1", compLevel: "sf" as const, redTeams: ["frc911", "frc921", "frc931"], blueTeams: alliances[7]!.picks };
    const bracketed = { ...BBB, matches: [...BBB.matches, spanning], alliances };
    const withKey: AsOfRewindResult = {
      ...result,
      events: new Map(result.events).set("2026wabbb", { status: "ready", state: { ...bbb.state, plan: { ...bbb.state.plan, playedPlayoffMatchKeys: ["2026wabbb_sf1m1"] } } }),
    };
    const stageByEvent = new Map<string, DistrictStageFinality>([["2026wabbb", { qual: true, alliance: true, elim: false, award: false }]]);
    const assembled = assembleAsOfDistrictEvents({
      artifact: districtArtifact(),
      result: withKey,
      algorithmVersion: FIXTURE_VERSION,
      eventArtifacts: new Map([["2026wabbb", bracketed]]),
      stageByEvent,
      candidateKeys: ["2026wabbb"],
    });
    expect(assembled.eventsWithUnresolvedElimMatches).toEqual(["2026wabbb"]);
    expect(assembled.events.find((event) => event.eventKey === "2026wabbb")?.input.playedElimMatches).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The Champ Locks DCMP bake (quick task 261007-mxf)
// ---------------------------------------------------------------------------

/** The stop with 2026wazzz planned over EVERY fixture district team, as the Champ Locks tab plans its unstarted championship. */
async function rewoundWithRoster(positionId: string): Promise<AsOfRewindResult> {
  const timeline = buildDistrictTimeline({ events: EVENTS, eventArtifacts: ARTIFACTS });
  const positionIndex = timeline.positions.findIndex((position) => position.id === positionId);
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, NOW_STAGES);
  const allTeams = districtArtifact().teams.map((team) => team.teamKey).sort();
  const candidates = CANDIDATES.map((candidate) => (candidate.eventKey === "2026wazzz" ? { ...candidate, roster: allTeams } : candidate));
  return loadAsOfRewind({ districtArtifact: districtArtifact(), timeline, positionIndex, eventArtifacts: ARTIFACTS, stageByEvent, candidates, scheduleStopEventKey: undefined }, fetchers());
}

const BAKE_STOP = "2026wabbb:m:2026wabbb_qm2";
/** A verdict roster: ten of the twelve district teams, more than the event's eight registrations. */
const FIELD = districtArtifact()
  .teams.map((team) => team.teamKey)
  .sort()
  .slice(1, 11);

describe("the Champ Locks DCMP bake's one request", () => {
  it("is ONE generated request over exactly the roster, with the plan's tier and bake and the roster's tuples in key order", async () => {
    const result = await rewoundWithRoster(BAKE_STOP);
    const assembled = assembleSimulatedDcmpBake({ artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventKey: "2026wazzz", roster: FIELD });
    expect(assembled.status).toBe("ready");
    if (assembled.status !== "ready" || result.status !== "ready") return;
    const outcome = result.events.get("2026wazzz")!;
    if (outcome.status !== "ready" || outcome.state.plan.mode !== "generated") throw new Error("expected a generated 2026wazzz");
    const { request } = assembled;
    expect(request.eventKey).toBe("2026wazzz");
    expect(request.input.baselines).toEqual(FIELD.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 })));
    expect(request.input).toMatchObject({ fieldSize: FIELD.length, allianceCount: 8, remainingMatches: [], tier: outcome.state.plan.tier });
    expect(request.asOf?.mode).toBe("generated");
    expect(request.asOf?.bake).toEqual({ ...outcome.state.plan.bake, algorithmId: "spr", algorithmVersion: FIXTURE_VERSION });
    expect(request.asOf?.teams.map(([teamKey]) => teamKey)).toEqual(FIELD);
    expect(request.asOf?.cutId).toBe(result.cutId);
    expect(assembled.signature).toBe(districtRunSignature([request]));
  });

  it("re-bakes only for a different roster: the signature moves with the roster and is stable for the same one", async () => {
    const result = await rewoundWithRoster(BAKE_STOP);
    const sign = (roster: readonly string[]) => {
      const assembled = assembleSimulatedDcmpBake({ artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventKey: "2026wazzz", roster });
      if (assembled.status !== "ready") throw new Error("expected a ready bake");
      return assembled.signature;
    };
    expect(sign(FIELD)).toBe(sign([...FIELD]));
    expect(sign(FIELD)).not.toBe(sign(FIELD.slice(1)));
  });

  it("is unavailable for an unavailable stop, a missing or unavailable outcome, a team with no tuple, an empty roster and a roster over the Worker's bound", async () => {
    const result = await rewoundWithRoster(BAKE_STOP);
    if (result.status !== "ready") throw new Error("expected a ready plan");
    const base = { artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventKey: "2026wazzz", roster: FIELD };
    expect(assembleSimulatedDcmpBake({ ...base, result: { status: "unavailable", reason: "test" } }).status).toBe("unavailable");
    expect(assembleSimulatedDcmpBake({ ...base, eventKey: "2026wanope" }).status).toBe("unavailable");
    const failed: AsOfRewindResult = { ...result, events: new Map(result.events).set("2026wazzz", { status: "unavailable", reason: "test" }) };
    expect(assembleSimulatedDcmpBake({ ...base, result: failed }).status).toBe("unavailable");
    expect(assembleSimulatedDcmpBake({ ...base, roster: [...FIELD, "frc999"] }).status).toBe("unavailable");
    expect(assembleSimulatedDcmpBake({ ...base, roster: [] }).status).toBe("unavailable");
    const tooMany = Array.from({ length: MAX_DISTRICT_SIMULATION_ROSTER + 1 }, (_unused, i) => `frc${String(1000 + i)}`);
    expect(assembleSimulatedDcmpBake({ ...base, roster: tooMany }).status).toBe("unavailable");
  });

  it("assembleAsOfDistrictEvents reads a GENERATED plan over the Worker's bound unavailable rather than posting it", async () => {
    const { result, stageByEvent } = await rewoundAt(BAKE_STOP);
    if (result.status !== "ready") throw new Error("expected a ready plan");
    const zzz = result.events.get("2026wazzz")!;
    if (zzz.status !== "ready") throw new Error("expected a ready 2026wazzz");
    const tooMany = Array.from({ length: MAX_DISTRICT_SIMULATION_ROSTER + 1 }, (_unused, i) => `frc${String(1000 + i)}`);
    const oversized: AsOfRewindResult = { ...result, events: new Map(result.events).set("2026wazzz", { status: "ready", state: { ...zzz.state, plan: { ...zzz.state.plan, roster: tooMany } } }) };
    const assembled = assembleAsOfDistrictEvents({ artifact: districtArtifact(), result: oversized, algorithmVersion: FIXTURE_VERSION, eventArtifacts: ARTIFACTS, stageByEvent, candidateKeys: ["2026wabbb", "2026wazzz"] });
    expect(assembled.events.map((event) => event.eventKey)).toEqual(["2026wabbb"]);
    expect(assembled.asOfUnavailable).toEqual([{ eventKey: "2026wazzz", name: AS_OF_UNAVAILABLE_NAME }]);
  });

  it("bakes end to end in the as-of Worker job, and the view reads it ready by team", async () => {
    const result = await rewoundWithRoster(BAKE_STOP);
    const assembled = assembleSimulatedDcmpBake({ artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventKey: "2026wazzz", roster: FIELD });
    if (assembled.status !== "ready" || assembled.request.asOf === undefined) throw new Error("expected a ready bake");
    const entry = runAsOfEvent({ ...assembled.request, asOf: assembled.request.asOf }, 1000, 1);
    expect(entry.status).toBe("baked");
    if (entry.status !== "baked") return;
    expect([...entry.roster].sort()).toEqual(FIELD);
    const view = simulatedDcmpBakeView({
      asOf: { status: "ready" },
      assembled,
      runState: { status: "complete", signature: assembled.signature, events: [entry] },
    });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect([...view.distributions.byTeam.keys()].sort()).toEqual(FIELD);
  }, 60000);

  it("the view is pending until the load, the assembly and a run of THIS signature are in hand, and unavailable for every refusal", async () => {
    const result = await rewoundWithRoster(BAKE_STOP);
    const assembled = assembleSimulatedDcmpBake({ artifact: districtArtifact(), result, algorithmVersion: FIXTURE_VERSION, eventKey: "2026wazzz", roster: FIELD });
    if (assembled.status !== "ready") throw new Error("expected a ready bake");
    const ready = { status: "ready" } as const;
    const complete = (signature: string, events: DistrictSimulationEventEntry[]) => ({ status: "complete" as const, signature, events });
    const unavailableEntry: DistrictSimulationEventEntry = { status: "unavailable", eventKey: "2026wazzz", name: "Error", message: "test" };

    expect(simulatedDcmpBakeView({ asOf: undefined, assembled, runState: { status: "idle" } }).status).toBe("pending");
    expect(simulatedDcmpBakeView({ asOf: { status: "loading" }, assembled, runState: { status: "idle" } }).status).toBe("pending");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled: undefined, runState: { status: "idle" } }).status).toBe("pending");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled, runState: { status: "idle" } }).status).toBe("pending");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled, runState: { status: "running" } }).status).toBe("pending");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled, runState: complete("another", []) }).status).toBe("pending");

    expect(simulatedDcmpBakeView({ asOf: { status: "failed" }, assembled, runState: { status: "idle" } }).status).toBe("unavailable");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled: { status: "unavailable", reason: "test" }, runState: { status: "idle" } }).status).toBe("unavailable");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled, runState: { status: "error" } }).status).toBe("unavailable");
    expect(simulatedDcmpBakeView({ asOf: ready, assembled, runState: complete(assembled.signature, [unavailableEntry]) }).status).toBe("unavailable");
  });
});
