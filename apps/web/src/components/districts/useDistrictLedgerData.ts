import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { eventQueryOptions } from "../../lib/api/event.js";
import { districtPreSimQueryOptions } from "../../lib/api/districtLedger.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import {
  allDistrictTierEventKeys,
  buildDistrictEventSimulationInput,
  distributionsFromPreSim,
  distributionsFromResult,
  type DistrictEventDistributions,
  type DistrictLedgerGaps,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { useDistrictSimulationRun, type DistrictSimulationRunState } from "./useDistrictSimulationRun.js";
import type { DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The tab's LAZY loading: one event artifact per district-tier event that is
 * currently in progress or reopened by the Rewind slider, one baked sidecar per
 * unstarted event the district artifact's `bakedEvents` list names, and NOTHING
 * for any other event.
 *
 * That is SC-5's other half. The tab's FIRST paint at the "now" position over a
 * finished or unstarted district fetches no event artifact and posts no Worker
 * message at all; the unstarted case still paints its blue cells, from the
 * baked pmfs.
 *
 * THE ALGORITHM IS PINNED TO `spr`, never taken from `?algorithm=`. Ranking-
 * point distributions are published for SPR only, so an OPR or EPA event
 * artifact carries no `redRpPmf`/`blueRpPmf` pair and the joint run would have
 * nothing to consume. The DISTRICT artifact itself remains algorithm-free, so
 * `lib/api/districts.ts`'s own header note about not adding a version gate by
 * symmetry still holds and must not be undone.
 *
 * A SIDECAR IS FETCHED ONLY FOR A KEY THE ARTIFACT LISTS. 10-03's
 * `bakedEvents` is the exact set published in this generation, so a 404 is
 * never used as control flow.
 */

/** The published algorithm the joint run reads its ranking-point pmfs from. */
export const DISTRICT_LEDGER_ALGORITHM_ID = "spr";

export interface UseDistrictLedgerDataOptions {
  readonly artifact: DistrictArtifact;
  /** The district-tier events to fetch and simulate: in progress at "now", unioned with whatever the current slider position reopens. */
  readonly activeEventKeys: readonly string[];
  /** Per-event category finality at the current position. */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * Per-event override for the first qualification row still to be played at
   * this position — `null` means qualification is FINISHED there, expressed as
   * zero remaining matches. Absent falls back to the event artifact's own first
   * unplayed row, which is the "now" answer.
   */
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
}

export interface DistrictLedgerData {
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  readonly runState: DistrictSimulationRunState;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps: Partial<DistrictLedgerGaps>;
  readonly isLoading: boolean;
}

/** The "now" start key: the first genuinely unplayed qualification row, or `null` when every row is played. */
function defaultStartKey(artifact: EventArtifact): string | null {
  const rows = buildQualRows(artifact);
  return rows.find((row) => !row.played)?.matchKey ?? null;
}

export function useDistrictLedgerData(options: UseDistrictLedgerDataOptions): DistrictLedgerData {
  const { artifact, activeEventKeys, stageByEvent, startMatchKeyByEvent } = options;
  const version = useAlgorithmVersion(DISTRICT_LEDGER_ALGORITHM_ID);

  const activeKeys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);

  // `useQueries` preserves input order — the same documented behaviour
  // `routes/index.tsx` already depends on.
  const eventQueries = useQueries({
    queries: activeKeys.map((eventKey) => ({
      ...eventQueryOptions({ eventKey, algorithmId: DISTRICT_LEDGER_ALGORITHM_ID, version: version ?? "" }),
      enabled: version !== undefined,
    })),
  });

  const bakedKeys = useMemo(() => {
    const listed = artifact.bakedEvents;
    if (listed === undefined || listed.length === 0) return [];
    const districtTier = new Set(allDistrictTierEventKeys(artifact));
    const active = new Set(activeKeys);
    return listed.filter((eventKey) => districtTier.has(eventKey) && !active.has(eventKey)).sort();
  }, [artifact, activeKeys]);

  const preSimQueries = useQueries({
    queries: bakedKeys.map((eventKey) => districtPreSimQueryOptions({ districtKey: artifact.districtKey, eventKey })),
  });

  const eventArtifacts = useMemo(() => {
    const map = new Map<string, EventArtifact>();
    activeKeys.forEach((eventKey, index) => {
      const data = eventQueries[index]?.data;
      if (data !== undefined) map.set(eventKey, data);
    });
    return map;
  }, [activeKeys, eventQueries]);

  const missingEventArtifacts = useMemo(
    () => activeKeys.filter((eventKey) => !eventArtifacts.has(eventKey)),
    [activeKeys, eventArtifacts]
  );

  const assembled = useMemo(() => {
    const events: DistrictSimulationEventRequest[] = [];
    const eventsWithExcludedMatches: string[] = [];
    const eventsWithFallbackFieldSize: string[] = [];
    for (const eventKey of activeKeys) {
      const eventArtifact = eventArtifacts.get(eventKey);
      if (eventArtifact === undefined) continue;
      const stage = stageByEvent.get(eventKey);
      if (stage === undefined) continue;
      const startMatchKey = startMatchKeyByEvent?.has(eventKey)
        ? (startMatchKeyByEvent.get(eventKey) ?? null)
        : defaultStartKey(eventArtifact);
      const built = buildDistrictEventSimulationInput({
        eventKey,
        season: artifact.year,
        eventArtifact,
        districtArtifact: artifact,
        stage,
        startMatchKey,
      });
      if (!built.ok) continue;
      if (built.excludedMatchCount > 0) eventsWithExcludedMatches.push(eventKey);
      if (built.fieldSizeFellBack) eventsWithFallbackFieldSize.push(eventKey);
      events.push({ eventKey, input: built.input });
    }
    const signature = events
      .map((event) => `${event.eventKey}|${String(event.input.remainingMatches.length)}|${String(event.input.baselines.length)}|${String(event.input.knownAlliances !== undefined)}${String(event.input.knownElimPoints !== undefined)}${String(event.input.knownAwardPoints !== undefined)}`)
      .join(";");
    return { events, signature, eventsWithExcludedMatches, eventsWithFallbackFieldSize };
  }, [activeKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent, artifact]);

  const runState = useDistrictSimulationRun(
    useMemo(() => ({ events: assembled.events, signature: assembled.signature }), [assembled])
  );

  const distributions = useMemo(() => {
    const map = new Map<string, DistrictEventDistributions>();
    bakedKeys.forEach((eventKey, index) => {
      const data = preSimQueries[index]?.data;
      if (data === undefined || data === null) return;
      map.set(eventKey, distributionsFromPreSim(data));
    });
    if (runState.status === "complete") {
      for (const entry of runState.events) {
        if (entry.status !== "ok") continue;
        map.set(entry.eventKey, distributionsFromResult(entry.result));
      }
    }
    return map;
  }, [bakedKeys, preSimQueries, runState]);

  const unavailableEvents = useMemo(() => {
    if (runState.status !== "complete") return [];
    return runState.events
      .filter((entry) => entry.status === "unavailable")
      .map((entry) => ({ eventKey: entry.eventKey, name: entry.status === "unavailable" ? entry.name : "" }));
  }, [runState]);

  const isLoading = eventQueries.some((query) => query.isPending) || preSimQueries.some((query) => query.isPending);

  return {
    distributions,
    runState,
    eventArtifacts,
    unavailableEvents,
    gaps: {
      missingEventArtifacts,
      eventsWithExcludedMatches: assembled.eventsWithExcludedMatches,
      eventsWithFallbackFieldSize: assembled.eventsWithFallbackFieldSize,
    },
    isLoading,
  };
}
