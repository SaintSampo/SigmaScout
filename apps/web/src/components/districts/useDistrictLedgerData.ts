import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { eventQueryOptions } from "../../lib/api/event.js";
import { districtPreSimQueryOptions } from "../../lib/api/districtLedger.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import {
  DISTRICT_CATEGORIES,
  allDistrictTierEventKeys,
  distributionsFromPreSim,
  dcmpBracketFactsAtPosition,
  dcmpBracketFactsFor,
  distributionsFromResult,
  type DcmpBracketFacts,
  type DistrictEventDistributions,
  type DistrictLedgerGaps,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { dcmpEventKeysFor } from "./champLedgerRows.js";
import { championshipShape } from "../../../../../packages/core/districts/finalsBracket.js";
import { useDistrictSimulationRun, type DistrictSimulationRunState } from "./useDistrictSimulationRun.js";
import type { DistrictSimulationEventEntry } from "../../workers/districtSimulationProtocol.js";
import type { AsOfRewindView } from "./useAsOfRewind.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The tab's LAZY loading, in TWO hooks so the dependency runs one way only.
 *
 * `useDistrictEventArtifacts` fetches event artifacts for a key list the caller
 * derives from the district artifact's own `state` blocks — it needs no
 * timeline and no stage. The caller then builds the interleaved timeline FROM
 * those artifacts, resolves the slider position against it, and hands the
 * resulting per-event stage back into `useDistrictLedgerData`, which fetches
 * the baked sidecars and runs the Worker. Splitting the two is what keeps the
 * whole chain acyclic: artifacts -> timeline -> stage -> simulation.
 *
 * SC-5 LIVES IN THAT KEY LIST. The tab's FIRST paint at the "now" position over
 * a finished or unstarted district fetches NO event artifact and posts NO
 * Worker message at all; the unstarted case still paints its blue cells, from
 * 10-06's baked pmfs. Under a Rewind the FETCH set widens to every started
 * district-tier event, because the interleaved timeline is built from those
 * artifacts' schedules and a slider that could not see a finished event's
 * matches could not rewind into it. The SIMULATION set stays narrower still:
 * an event whose four categories are all final at the position is skipped.
 *
 * THE ALGORITHM IS PINNED TO `spr`, never taken from `?algorithm=`. The
 * district ledger deliberately stays on SPR's ranking-point distributions. SPR
 * and EPA both publish a `redRpPmf`/`blueRpPmf` pair (EPA since 14.0.0, quick
 * task 260929-mat), but OPR publishes none, so following `?algorithm=` would
 * leave the joint run with nothing to consume on OPR. The DISTRICT artifact itself remains algorithm-free, so
 * `lib/api/districts.ts`'s own header note about not adding a version gate by
 * symmetry still holds and must not be undone.
 *
 * A REWOUND STOP IS AN AS-OF FORECAST (quick task 261005-5g0). With `asOf`
 * supplied (`useAsOfRewind`), every simulated event is assembled from the
 * model as it stood at the stop (`assembleAsOfDistrictEvents`): a REAL event's
 * remaining rows and every draft rating are priced in the as-of Worker, a
 * GENERATED event is baked there, and no sidecar, stored per row prediction or
 * `teams[].metrics` is read. Without it (Live) the shipped assembly runs,
 * `assembleLiveDistrictEvents`, byte for byte.
 *
 * A SIDECAR IS FETCHED ONLY FOR A KEY THE ARTIFACT LISTS. 10-03's
 * `bakedEvents` is the exact set published in this generation, so a 404 is
 * never used as control flow.
 */

// The request assembly and the run signature live in the pure
// `districtRunAssembly.ts` (quick task 261005-5g0), re-exported here so every
// existing import keeps working and a node script can import them with no React.
export {
  AS_OF_UNAVAILABLE_NAME,
  DISTRICT_LEDGER_ALGORITHM_ID,
  assembleAsOfDistrictEvents,
  assembleLiveDistrictEvents,
  districtRunSignature,
  type AssembleAsOfDistrictEventsParams,
  type AssembleLiveDistrictEventsParams,
  type AssembledDistrictEvents,
} from "./districtRunAssembly.js";
import {
  AS_OF_UNAVAILABLE_NAME,
  DISTRICT_LEDGER_ALGORITHM_ID,
  assembleAsOfDistrictEvents,
  assembleLiveDistrictEvents,
  type AssembledDistrictEvents,
} from "./districtRunAssembly.js";

export interface DistrictEventArtifacts {
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly missingEventArtifacts: readonly string[];
  readonly isLoading: boolean;
}

export function useDistrictEventArtifacts(activeEventKeys: readonly string[]): DistrictEventArtifacts {
  const version = useAlgorithmVersion(DISTRICT_LEDGER_ALGORITHM_ID);
  const keys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);

  // `useQueries` preserves input order — the same documented behaviour
  // `routes/index.tsx` already depends on.
  const queries = useQueries({
    queries: keys.map((eventKey) => ({
      ...eventQueryOptions({ eventKey, algorithmId: DISTRICT_LEDGER_ALGORITHM_ID, version: version ?? "" }),
      enabled: version !== undefined,
    })),
  });

  const eventArtifacts = useMemo(() => {
    const map = new Map<string, EventArtifact>();
    keys.forEach((eventKey, index) => {
      const data = queries[index]?.data;
      if (data !== undefined) map.set(eventKey, data);
    });
    return map;
  }, [keys, queries]);

  return {
    eventArtifacts,
    missingEventArtifacts: keys.filter((eventKey) => !eventArtifacts.has(eventKey)),
    isLoading: queries.some((query) => query.isPending),
  };
}

export interface UseDistrictLedgerDataOptions {
  readonly artifact: DistrictArtifact;
  /** The district-tier events whose artifacts were fetched — the same list `useDistrictEventArtifacts` was given. */
  readonly activeEventKeys: readonly string[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** Per-event category finality at the current position. */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * Per-event override for the first qualification row still to be played at
   * this position — `null` means qualification is FINISHED there, expressed as
   * zero remaining matches. Absent falls back to the event artifact's own first
   * unplayed row, which is the "now" answer. No tab passes it since quick task
   * 261005-5g0 (a rewound stop uses `asOf`); only the parity tests still do.
   */
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
  /**
   * Which event keys a BAKED sidecar may be fetched for. Defaults to
   * `allDistrictTierEventKeys(artifact)`, which is byte for byte the shipped
   * behaviour.
   *
   * The Champ Locks tab passes the district-tier keys PLUS the dcmp event key,
   * so an unstarted District Championship's baked sidecar is fetched rather
   * than silently skipped. `scripts/publishDistricts.ts` already bakes dcmp-tier
   * candidates (`tier: districtTierForEventType(event.eventType)`), so the
   * sidecar exists and `bakedEvents` already lists it — no publisher change
   * (quick task 260925-xab).
   */
  readonly allowedEventKeys?: readonly string[];
  /**
   * `eventKey -> the point tier it is simulated at`. Absent, or absent for one
   * key, reads as `"district"` — the shipped behaviour.
   *
   * The DCMP is therefore priced at the 3x ceilings by the SAME code path as
   * any district event, in the same Worker, in the same run, under one
   * signature. A second run for one event would be a second place for the
   * position, the algorithm version and the refusals to drift. The one
   * deliberate exception is the Champ Locks DCMP bake at a rewound stop
   * (`useSimulatedDcmpBake`, quick task 261007-mxf): its roster is a function
   * of THIS run's output (the district line cuts In range), so folding it in
   * would move this run's signature once the roster landed and re-run every
   * district event. It reads the same as-of load and the same bake
   * parameters, so the drift this rule guards against has no room.
   */
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
  /**
   * A REWOUND STOP'S AS-OF STATE (quick task 261005-5g0), from
   * `useAsOfRewind`. Absent at Live, which therefore takes the shipped path
   * byte for byte: the same sidecar fetches, the same requests, the same run.
   * Present, every simulated event is assembled from it and nothing else (no
   * sidecar, no stored per row prediction, no `teams[].metrics`), and an event
   * it marks unavailable is unavailable.
   */
  readonly asOf?: AsOfRewindView;
  /** Rewound only: events the caller will not read at this stop, so they cost no Worker time (`assembleAsOfDistrictEvents`). Ignored at Live. */
  readonly skipEventKeys?: ReadonlySet<string>;
}

export interface DistrictLedgerData {
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  readonly runState: DistrictSimulationRunState;
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps: Partial<DistrictLedgerGaps>;
  readonly isLoading: boolean;
  /**
   * TRUE while the per event run for the CURRENT inputs has not landed: events
   * are assembled and the run state is idle (the effect has not started it
   * yet), running, or complete for a stale signature. A failed run is not
   * pending. Both tabs read it so an unstarted run is never mistaken for
   * "nothing to run": the champ tab since quick task 260927-6bf, and the
   * district tab since 261004-uw4, when its cutoff became the simulated line.
   */
  readonly runPending: boolean;
}

/** What `divisionedDcmpBracketFacts` reads for one run request: its alliances and played rows. */
export interface DcmpFactsRequest {
  readonly knownAlliances?: DistrictSimulationEventEntryInput["knownAlliances"];
  readonly playedElimMatches?: DistrictSimulationEventEntryInput["playedElimMatches"];
  readonly unresolvedMatchCount: number;
}
type DistrictSimulationEventEntryInput = AssembledDistrictEvents["events"][number]["input"];

/**
 * THE BRACKET FACTS OF A DIVISIONED CHAMPIONSHIP (quick task 261009-kt3,
 * reading R12): one entry per DIVISION key and the FINALS key with a loaded
 * event artifact, run request or not, through `dcmpBracketFactsAtPosition`
 * (role `division`, or `finals` with as many alliances as divisions). Empty for
 * every other shape: a single championship and two championships keep the
 * run request path byte for byte.
 */
export function divisionedDcmpBracketFacts(params: {
  readonly artifact: DistrictArtifact;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly requestByKey: ReadonlyMap<string, DcmpFactsRequest>;
}): Map<string, DcmpBracketFacts> {
  const out = new Map<string, DcmpBracketFacts>();
  const shape = championshipShape(dcmpEventKeysFor(params.artifact));
  if (shape.kind !== "divisioned") return out;
  const roles: readonly [string, "division" | "finals"][] = [
    ...shape.divisionKeys.map((key) => [key, "division"] as [string, "division"]),
    [shape.finalsKey, "finals"],
  ];
  for (const [eventKey, role] of roles) {
    const eventArtifact = params.eventArtifacts.get(eventKey);
    if (eventArtifact === undefined) continue;
    const request = params.requestByKey.get(eventKey);
    const facts = dcmpBracketFactsAtPosition({
      eventKey,
      season: params.artifact.year,
      role,
      ...(role === "finals" ? { expectedAllianceCount: shape.divisionKeys.length } : {}),
      stage: params.stageByEvent.get(eventKey),
      eventArtifact,
      ...(request === undefined ? {} : { request }),
    });
    if (facts !== undefined) out.set(eventKey, facts);
  }
  return out;
}

/**
 * The Champ Locks tab's fetch set at the LIVE position (quick task 261009-kt3):
 * the in progress events, plus every STARTED dcmp tier key of a divisioned
 * championship while any of its keys is in progress, so the finished divisions'
 * brackets are on hand for the joint proof during the finals. Any other shape
 * returns the in progress keys unchanged. An event with no open category costs
 * no simulation however it got into the fetch set.
 */
export function champLiveFetchKeys(inProgressKeys: readonly string[], startedKeys: readonly string[], dcmpEventKeys: readonly string[]): string[] {
  const keys = new Set(inProgressKeys);
  const shape = championshipShape(dcmpEventKeys);
  if (shape.kind === "divisioned") {
    const championshipKeys = [...shape.divisionKeys, shape.finalsKey];
    if (championshipKeys.some((key) => keys.has(key))) for (const key of championshipKeys) if (startedKeys.includes(key)) keys.add(key);
  }
  return [...keys].sort();
}

/** Every event entry the run has produced so far: the terminal set, or an as-of run's partial set for the current signature. */
function landedEntries(runState: DistrictSimulationRunState, signature: string): readonly DistrictSimulationEventEntry[] {
  if (runState.status === "complete") return runState.events;
  if (runState.status === "running" && runState.events !== undefined && runState.signature === signature) return runState.events;
  return [];
}

export function useDistrictLedgerData(options: UseDistrictLedgerDataOptions): DistrictLedgerData {
  const { artifact, activeEventKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent, allowedEventKeys, tierByEvent, asOf } = options;
  const activeKeys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);
  const rewound = asOf !== undefined;

  const bakedKeys = useMemo(() => {
    // A REWOUND STOP NEVER READS A SIDECAR: it is priced at the publish
    // clock, after the stop. A GENERATED event is baked in the Worker instead.
    if (rewound) return [];
    const listed = artifact.bakedEvents;
    if (listed === undefined || listed.length === 0) return [];
    const allowed = new Set(allowedEventKeys ?? allDistrictTierEventKeys(artifact));
    const active = new Set(activeKeys);
    return listed.filter((eventKey) => allowed.has(eventKey) && !active.has(eventKey)).sort();
  }, [rewound, artifact, activeKeys, allowedEventKeys]);

  const preSimQueries = useQueries({
    queries: bakedKeys.map((eventKey) => districtPreSimQueryOptions({ districtKey: artifact.districtKey, eventKey })),
  });

  const skipEventKeys = options.skipEventKeys;
  const assembled = useMemo((): AssembledDistrictEvents => {
    if (asOf === undefined) return assembleLiveDistrictEvents({ artifact, activeKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent, tierByEvent });
    if (asOf.status === "ready") {
      return assembleAsOfDistrictEvents({
        artifact,
        result: asOf.result,
        algorithmVersion: asOf.algorithmVersion,
        eventArtifacts,
        stageByEvent,
        tierByEvent,
        skipEventKeys,
        candidateKeys: openEventKeys(allowedEventKeys ?? allDistrictTierEventKeys(artifact), stageByEvent),
      });
    }
    const asOfUnavailable =
      asOf.status === "failed"
        ? openEventKeys(allowedEventKeys ?? allDistrictTierEventKeys(artifact), stageByEvent)
            .filter((eventKey) => skipEventKeys?.has(eventKey) !== true)
            .map((eventKey) => ({ eventKey, name: AS_OF_UNAVAILABLE_NAME }))
        : [];
    return {
      events: [],
      signature: "",
      eventsWithExcludedMatches: [],
      eventsWithFallbackFieldSize: [],
      eventsWithPartialAllianceList: [],
      eventsWithUnresolvedElimMatches: [],
      asOfUnavailable,
    };
  }, [asOf, activeKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent, artifact, tierByEvent, skipEventKeys, allowedEventKeys]);

  const runState = useDistrictSimulationRun(
    useMemo(() => ({ events: assembled.events, signature: assembled.signature }), [assembled])
  );

  const entries = useMemo(() => landedEntries(runState, assembled.signature), [runState, assembled.signature]);

  const distributions = useMemo(() => {
    const map = new Map<string, DistrictEventDistributions>();
    bakedKeys.forEach((eventKey, index) => {
      const data = preSimQueries[index]?.data;
      if (data === undefined || data === null) return;
      map.set(eventKey, distributionsFromPreSim(data));
    });
    // THE DCMP'S BRACKET FACTS (quick task 261009-2tr), for the Champ Locks
    // joint lock proof: read off the run's OWN request (the published alliances
    // and the played playoff rows it was handed), never off the Monte Carlo
    // result, and attached only where `dcmpBracketFactsFor`'s gates all pass.
    const requestByKey = new Map(assembled.events.map((request) => [request.eventKey, request] as const));
    const unresolved = new Set(assembled.eventsWithUnresolvedElimMatches);
    for (const entry of entries) {
      if (entry.status === "ok") {
        const distributions = distributionsFromResult(entry.result);
        const request = requestByKey.get(entry.eventKey);
        const dcmpBracket =
          request === undefined || request.input.tier !== "dcmp"
            ? undefined
            : dcmpBracketFactsFor({
                eventKey: entry.eventKey,
                season: artifact.year,
                tier: request.input.tier,
                stage: stageByEvent.get(entry.eventKey),
                alliances: request.input.knownAlliances,
                playedMatches: request.input.playedElimMatches ?? [],
                unresolvedMatchCount: unresolved.has(entry.eventKey) ? 1 : 0,
              });
        map.set(entry.eventKey, dcmpBracket === undefined ? distributions : { ...distributions, dcmpBracket });
      } else if (entry.status === "baked") map.set(entry.eventKey, distributionsFromPreSim(entry));
    }
    // A DIVISIONED CHAMPIONSHIP'S FACTS (quick task 261009-kt3): every division
    // and the finals, attached to the key's entry, or to a minimal entry with
    // no team record (which reads exactly as no entry for every cell).
    const divisioned = divisionedDcmpBracketFacts({
      artifact,
      eventArtifacts,
      stageByEvent,
      requestByKey: new Map(
        assembled.events.map((request) => [
          request.eventKey,
          {
            ...(request.input.knownAlliances === undefined ? {} : { knownAlliances: request.input.knownAlliances }),
            ...(request.input.playedElimMatches === undefined ? {} : { playedElimMatches: request.input.playedElimMatches }),
            unresolvedMatchCount: unresolved.has(request.eventKey) ? 1 : 0,
          },
        ] as const)
      ),
    });
    for (const [eventKey, dcmpBracket] of divisioned) {
      const existing = map.get(eventKey);
      map.set(eventKey, existing === undefined ? { eventKey, byTeam: new Map(), dcmpBracket } : { ...existing, dcmpBracket });
    }
    return map;
  }, [bakedKeys, preSimQueries, entries, assembled, stageByEvent, artifact, eventArtifacts]);

  const unavailableEvents = useMemo(() => {
    const fromRun = runState.status !== "complete" ? [] : runState.events.flatMap((entry) => (entry.status === "unavailable" ? [{ eventKey: entry.eventKey, name: entry.name }] : []));
    return assembled.asOfUnavailable.length === 0 ? fromRun : [...assembled.asOfUnavailable, ...fromRun];
  }, [runState, assembled.asOfUnavailable]);

  const eventsWithExcludedMatches = useMemo(() => {
    const asOfExcluded = entries.flatMap((entry) => (entry.status === "ok" && entry.excludedMatchKeys !== undefined ? [entry.eventKey] : []));
    return asOfExcluded.length === 0 ? assembled.eventsWithExcludedMatches : [...assembled.eventsWithExcludedMatches, ...asOfExcluded];
  }, [entries, assembled.eventsWithExcludedMatches]);

  return {
    distributions,
    runState,
    unavailableEvents,
    gaps: {
      eventsWithExcludedMatches,
      eventsWithFallbackFieldSize: assembled.eventsWithFallbackFieldSize,
      eventsWithPartialAllianceList: assembled.eventsWithPartialAllianceList,
      eventsWithUnresolvedElimMatches: assembled.eventsWithUnresolvedElimMatches,
    },
    isLoading: preSimQueries.some((query) => query.isPending),
    runPending:
      // The as-of objects for a rewound stop are still loading: nothing can be
      // assembled yet, and that is not "nothing to run".
      asOf?.status === "loading" ||
      (assembled.events.length > 0 &&
        runState.status !== "error" &&
        !(runState.status === "complete" && runState.signature === assembled.signature)),
  };
}

/** The events with an open category at the stop, sorted. */
function openEventKeys(keys: readonly string[], stageByEvent: ReadonlyMap<string, DistrictStageFinality>): string[] {
  return keys
    .filter((eventKey) => {
      const stage = stageByEvent.get(eventKey);
      return stage !== undefined && DISTRICT_CATEGORIES.some((category) => !stage[category]);
    })
    .sort();
}
