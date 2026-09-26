import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { eventQueryOptions } from "../../lib/api/event.js";
import { districtPreSimQueryOptions } from "../../lib/api/districtLedger.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import {
  DISTRICT_CATEGORIES,
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
import type { DistrictLedgerEventInput } from "../../../../../packages/core/districts/ledgerSimulation.js";
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
   * unplayed row, which is the "now" answer.
   */
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
}

export interface DistrictLedgerData {
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  readonly runState: DistrictSimulationRunState;
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps: Partial<DistrictLedgerGaps>;
  readonly isLoading: boolean;
}

/** The "now" start key: the first genuinely unplayed qualification row, or `null` when every row is played. */
function defaultStartKey(artifact: EventArtifact): string | null {
  const rows = buildQualRows(artifact);
  return rows.find((row) => !row.played)?.matchKey ?? null;
}

/** An absent optional member, distinguishable from a present-but-empty one. */
const SIGNATURE_ABSENT = "-";

/** One known-points map folded to its SORTED `key=value` pairs — the VALUES, never their presence. */
function foldKnownPoints(known: ReadonlyMap<string, number> | undefined): string {
  if (known === undefined) return SIGNATURE_ABSENT;
  return [...known]
    .map(([teamKey, value]) => `${teamKey}=${String(value)}`)
    .sort()
    .join(",");
}

/** One supplied alliance set folded to its rosters, sorted by alliance number. */
function foldKnownAlliances(alliances: DistrictLedgerEventInput["knownAlliances"]): string {
  if (alliances === undefined) return SIGNATURE_ABSENT;
  return [...alliances]
    .map((alliance) => `${String(alliance.allianceNumber)}:${alliance.picks.join("+")}`)
    .sort()
    .join(",");
}

/** The ranking inputs folded per team, so a score correction that leaves the row COUNT unchanged still moves the signature. */
function foldBaselines(baselines: DistrictLedgerEventInput["baselines"]): string {
  return baselines.map((baseline) => `${baseline.teamKey}=${String(baseline.earnedRpSum)}/${String(baseline.matchesPlayed)}`).join(",");
}

/**
 * The played elimination rows folded to their VALUES, sorted.
 *
 * WHY IT IS IN THE SIGNATURE AT ALL. An elimination match being played changes
 * nothing else in this input: the baselines are qualification-only, the rosters
 * are unchanged and the four stage booleans do not move until the whole bracket
 * is done. So a signature blind to these rows would leave the Playoffs cell
 * printing the chance of reaching the top four for an alliance that had already
 * won the semifinal, for as long as the tab stayed open — which is exactly the
 * staleness this function exists to prevent, one stage later.
 */
function foldPlayedElims(matches: DistrictLedgerEventInput["playedElimMatches"]): string {
  if (matches === undefined) return SIGNATURE_ABSENT;
  return [...matches]
    .map((match) => `${match.compLevel}${String(match.setNumber)}m${String(match.matchNumber)}=${String(match.winningAllianceNumber)}`)
    .sort()
    .join(",");
}

/**
 * The string `useDistrictSimulationRun` keys its effect on: everything a run's
 * OUTPUT depends on, folded to its VALUES.
 *
 * WHY VALUES AND NOT PRESENCE. The district artifact refetches on a 60 second
 * floor while any member event is live (`lib/api/districts.ts`'s
 * `refetchInterval`), and the live window is the whole point of this tab. A
 * signature built from `knownElimPoints !== undefined` cannot see an award
 * being posted, an alliance roster being corrected, a score correction that
 * revises the baselines without changing the row count, or `allianceCount`
 * moving at all — every one of which changes the distributions the cells
 * print. The run would not re-fire and the tab would go quietly stale in
 * exactly the minutes it exists for.
 *
 * DETERMINISTIC AND EXACT, not hashed. Each map is folded to its sorted
 * `key=value` pairs so two equal inputs always produce one string, and no
 * collision can silently suppress a re-run. It is recomputed inside the same
 * `useMemo` that already walks every roster, so it costs one more pass over
 * data already in hand.
 *
 * Exported for its own test: the staleness this closes is invisible to a
 * render test and only a direct assertion on this string can pin it.
 */
export function districtRunSignature(events: readonly DistrictSimulationEventRequest[]): string {
  return events
    .map((event) => {
      const input = event.input;
      return [
        event.eventKey,
        String(input.remainingMatches.length),
        String(input.allianceCount),
        String(input.fieldSize),
        foldBaselines(input.baselines),
        foldKnownAlliances(input.knownAlliances),
        foldKnownPoints(input.knownElimPoints),
        foldKnownPoints(input.knownAwardPoints),
        foldPlayedElims(input.playedElimMatches),
      ].join("|");
    })
    .join(";");
}

export function useDistrictLedgerData(options: UseDistrictLedgerDataOptions): DistrictLedgerData {
  const { artifact, activeEventKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent } = options;
  const activeKeys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);

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

  const assembled = useMemo(() => {
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
      // An event with NO open category at this position costs no simulation,
      // however it got into the fetch set.
      if (DISTRICT_CATEGORIES.every((category) => stage[category])) continue;
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
        // ONLY THE LIVE POSITION may condition the bracket on played matches.
        // `startMatchKeyByEvent` is supplied exactly when the caller is rewound —
        // see `UseDistrictLedgerDataOptions` — so its absence IS "now", and the
        // rewind rail's own playoff step is all-or-nothing by construction.
        conditionOnPlayedElims: startMatchKeyByEvent === undefined,
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
      signature: districtRunSignature(events),
      eventsWithExcludedMatches,
      eventsWithFallbackFieldSize,
      eventsWithPartialAllianceList,
      eventsWithUnresolvedElimMatches,
    };
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
    return runState.events.flatMap((entry) => (entry.status === "unavailable" ? [{ eventKey: entry.eventKey, name: entry.name }] : []));
  }, [runState]);

  return {
    distributions,
    runState,
    unavailableEvents,
    gaps: {
      eventsWithExcludedMatches: assembled.eventsWithExcludedMatches,
      eventsWithFallbackFieldSize: assembled.eventsWithFallbackFieldSize,
      eventsWithPartialAllianceList: assembled.eventsWithPartialAllianceList,
      eventsWithUnresolvedElimMatches: assembled.eventsWithUnresolvedElimMatches,
    },
    isLoading: preSimQueries.some((query) => query.isPending),
  };
}
