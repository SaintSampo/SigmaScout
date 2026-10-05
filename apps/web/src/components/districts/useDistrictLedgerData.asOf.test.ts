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
import type { DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import { loadAsOfRewind, type AsOfFetchers, type AsOfRewindResult } from "./asOfRewind.js";
import {
  ARTIFACTS,
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
  const result = await loadAsOfRewind({ districtArtifact: districtArtifact(), timeline, positionIndex, eventArtifacts: ARTIFACTS, stageByEvent, candidates: CANDIDATES }, fetchers());
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
});
