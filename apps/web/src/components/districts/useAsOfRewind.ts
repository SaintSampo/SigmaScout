import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import { asOfIndexQueryOptions, asOfLogQueryOptions, asOfSeasonQueryOptions, asOfStartQueryOptions } from "../../lib/api/asOf.js";
import { EVENT_POLL_INTERVAL_MS, shouldPollEventArtifact } from "../../lib/liveEvent.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { asOfCandidateEvents, asOfScheduleStopEventKey, asOfStopAnchorId, loadAsOfRewind, type AsOfFetchers, type AsOfRewindResult } from "./asOfRewind.js";
import type { DistrictTimeline } from "./districtTimeline.js";
import type { DistrictStageFinality } from "./districtLedgerRows.js";
import { DISTRICT_LEDGER_ALGORITHM_ID } from "./districtRunAssembly.js";

/**
 * A REWOUND LOCKS STOP'S AS-OF STATE (quick task 261005-5g0), for both Locks
 * tabs: fetch the season object and the INDEX of every event in the fetch set,
 * resolve every team on a roster of an event with an open category at the stop,
 * fetch what the resolve names (other events' INDEX, logs of events in progress
 * at the cut, the season start object only when a team needs it) and repeat
 * until resolved (`asOfRewind.ts` `loadAsOfRewind`).
 *
 * LIVE IS UNTOUCHED: with `enabled` false this hook fetches nothing and
 * returns `undefined`, and `useDistrictLedgerData` takes the shipped path.
 *
 * Every object goes through the query cache under its own key
 * (`lib/api/asOf.ts`), so stepping between stops refetches only the objects the
 * new stop needs that the last one did not. An object the resolve reports out
 * of step with another is refetched FRESH once (`fetchOptions.fresh`), and an
 * unavailable plan is asked again on the live cadence while an event is live
 * (`asOfRewindRefetchInterval`).
 */

export type AsOfRewindView =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly result: AsOfRewindResult; readonly algorithmVersion: string }
  /** A fetch failed outright (not a 404, which is an ordinary unpublished object): every candidate event is unavailable. */
  | { readonly status: "failed" };

export interface UseAsOfRewindOptions {
  /** True at a rewound stop only. */
  readonly enabled: boolean;
  /** While the fetch set's event artifacts are still loading the timeline is not final, so nothing is planned yet. */
  readonly artifactsLoading: boolean;
  /** Fetch set events whose artifact did not load (`useDistrictEventArtifacts`' `missingEventArtifacts`): each reads unavailable at the stop. */
  readonly unloadedEventKeys: readonly string[];
  readonly districtArtifact: DistrictArtifact;
  readonly timeline: DistrictTimeline;
  readonly positionIndex: number;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** The raw `?at=` value: a Schedule milestone (`<eventKey>:schedule`) prices that event on its real schedule. */
  readonly at: string | undefined;
  /**
   * Every event this tab may simulate, with its tier and week. An optional
   * `roster` overrides a GENERATED plan's roster (`AsOfRewindInput.candidates`):
   * the Champ Locks tab's unstarted championship, quick task 261007-mxf.
   */
  readonly candidates: readonly { readonly eventKey: string; readonly tier: DistrictTier; readonly week: number | null; readonly roster?: readonly string[] }[];
}

/** Whether a plan reads anything unavailable: the whole stop, or one event in it. */
export function asOfRewindHasUnavailable(result: AsOfRewindResult | undefined): boolean {
  if (result === undefined) return false;
  if (result.status === "unavailable") return true;
  return [...result.events.values()].some((outcome) => outcome.status === "unavailable");
}

/**
 * How often the stop's plan is asked again. An UNAVAILABLE plan (an object
 * not published yet, or copies still out of step after a fresh refetch) must
 * not stick while any event in the fetch set is live: its as-of objects are
 * still being written, so it is asked again on the live artifacts' own
 * cadence. A finished district, or a plan with nothing unavailable, is never
 * re-asked on a timer (a refreshed artifact re-plans it through the key).
 */
export function asOfRewindRefetchInterval(data: AsOfRewindResult | undefined, eventArtifacts: ReadonlyMap<string, EventArtifact>, nowMs: number): number | false {
  if (!asOfRewindHasUnavailable(data)) return false;
  return [...eventArtifacts.values()].some((artifact) => shouldPollEventArtifact(artifact, nowMs)) ? EVENT_POLL_INTERVAL_MS : false;
}

/** Each fetched event artifact's identity, so a refreshed artifact re-plans the stop. */
function artifactsFingerprint(eventArtifacts: ReadonlyMap<string, EventArtifact>): string {
  return [...eventArtifacts]
    .map(([eventKey, artifact]) => `${eventKey}:${artifact.generation}:${artifact.computedAt}`)
    .sort()
    .join(",");
}

/** Where the artifacts fingerprint sits in the query key: the one part a same stop placeholder may differ in. */
const FINGERPRINT_KEY_INDEX = 5;

export function useAsOfRewind(options: UseAsOfRewindOptions): AsOfRewindView | undefined {
  const { enabled, artifactsLoading, districtArtifact, timeline, positionIndex, eventArtifacts, stageByEvent, candidates } = options;
  const scheduleStopEventKey = asOfScheduleStopEventKey(options.at);
  const version = useAlgorithmVersion(DISTRICT_LEDGER_ALGORITHM_ID);
  const queryClient = useQueryClient();

  const open = useMemo(() => asOfCandidateEvents({ candidates, stageByEvent }), [candidates, stageByEvent]);
  // THE STOP'S OWN IDENTITY, never its index: the `?at=` value the reader
  // picked (a step id, or a Schedule alias) and the row its cut is read from.
  // A live refetch that moves a row from its predicted time to its actual one
  // reorders the timeline and shifts the stop's index; keyed on the index, the
  // same stop refused its own placeholder and restarted the run (review R5).
  const stopId = options.at ?? timeline.positions[positionIndex]?.id ?? "";
  const anchorId = asOfStopAnchorId(timeline, positionIndex);
  const fingerprint = useMemo(() => artifactsFingerprint(eventArtifacts), [eventArtifacts]);
  const openKeys = open.map((candidate) => candidate.eventKey).join(",");
  const unloadedKeys = [...options.unloadedEventKeys].sort().join(",");
  // A roster override's size, per open candidate that carries one, so a
  // district artifact that gains a team re-plans the stop. The LAST key
  // segment, so FINGERPRINT_KEY_INDEX does not move.
  const rosterKeys = open
    .filter((candidate) => candidate.roster !== undefined)
    .map((candidate) => `${candidate.eventKey}:${String(candidate.roster!.length)}`)
    .join(",");
  const active = enabled && !artifactsLoading && version !== undefined;

  const queryKey = ["asOfRewind", districtArtifact.districtKey, version ?? "", stopId, anchorId, fingerprint, openKeys, scheduleStopEventKey ?? "", unloadedKeys, rosterKeys] as const;
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AsOfRewindResult> => {
      const algorithmId = DISTRICT_LEDGER_ALGORITHM_ID;
      const v = version!;
      const season = districtArtifact.year;
      const fetchers: AsOfFetchers = {
        index: (eventKey, fetchOptions) => queryClient.fetchQuery(asOfIndexQueryOptions({ eventKey, algorithmId, version: v }, fetchOptions)),
        log: (eventKey, fetchOptions) => queryClient.fetchQuery(asOfLogQueryOptions({ eventKey, algorithmId, version: v }, fetchOptions)),
        season: (fetchOptions) => queryClient.fetchQuery(asOfSeasonQueryOptions({ season, algorithmId, version: v }, fetchOptions)),
        start: () => queryClient.fetchQuery(asOfStartQueryOptions({ season, algorithmId, version: v })),
      };
      return loadAsOfRewind(
        { districtArtifact, timeline, positionIndex, eventArtifacts, stageByEvent, candidates: open, scheduleStopEventKey, unloadedEventKeys: options.unloadedEventKeys },
        fetchers
      );
    },
    enabled: active,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => asOfRewindRefetchInterval(q.state.data, eventArtifacts, Date.now()),
    // A live event's artifact refetches every minute, which changes the
    // fingerprint and so the key. The SAME stop's previous plan stands while
    // the new one loads, so the run is not torn down and restarted each minute
    // (its signature only moves if the plan does). A different stop never
    // borrows another stop's plan.
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      if (previous === undefined || key === undefined) return undefined;
      const same = key.length === queryKey.length && key.every((part, n) => n === FINGERPRINT_KEY_INDEX || part === queryKey[n]);
      return same ? previous : undefined;
    },
  });

  if (!enabled) return undefined;
  if (query.isError) return { status: "failed" };
  if (!active || query.data === undefined) return { status: "loading" };
  return { status: "ready", result: query.data, algorithmVersion: version! };
}
