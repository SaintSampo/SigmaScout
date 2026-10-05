import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import { asOfIndexQueryOptions, asOfLogQueryOptions, asOfSeasonQueryOptions, asOfStartQueryOptions } from "../../lib/api/asOf.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { asOfCandidateEvents, asOfScheduleStopEventKey, loadAsOfRewind, type AsOfFetchers, type AsOfRewindResult } from "./asOfRewind.js";
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
 * new stop needs that the last one did not.
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
  readonly districtArtifact: DistrictArtifact;
  readonly timeline: DistrictTimeline;
  readonly positionIndex: number;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** The raw `?at=` value: a Schedule milestone (`<eventKey>:schedule`) prices that event on its real schedule. */
  readonly at: string | undefined;
  /** Every event this tab may simulate, with its tier and week. */
  readonly candidates: readonly { readonly eventKey: string; readonly tier: DistrictTier; readonly week: number | null }[];
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
  const positionId = timeline.positions[positionIndex]?.id ?? "";
  const fingerprint = useMemo(() => artifactsFingerprint(eventArtifacts), [eventArtifacts]);
  const openKeys = open.map((candidate) => candidate.eventKey).join(",");
  const active = enabled && !artifactsLoading && version !== undefined;

  const queryKey = ["asOfRewind", districtArtifact.districtKey, version ?? "", positionId, positionIndex, fingerprint, openKeys, scheduleStopEventKey ?? ""] as const;
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AsOfRewindResult> => {
      const algorithmId = DISTRICT_LEDGER_ALGORITHM_ID;
      const v = version!;
      const season = districtArtifact.year;
      const fetchers: AsOfFetchers = {
        index: (eventKey) => queryClient.fetchQuery(asOfIndexQueryOptions({ eventKey, algorithmId, version: v })),
        log: (eventKey) => queryClient.fetchQuery(asOfLogQueryOptions({ eventKey, algorithmId, version: v })),
        season: () => queryClient.fetchQuery(asOfSeasonQueryOptions({ season, algorithmId, version: v })),
        start: () => queryClient.fetchQuery(asOfStartQueryOptions({ season, algorithmId, version: v })),
      };
      return loadAsOfRewind({ districtArtifact, timeline, positionIndex, eventArtifacts, stageByEvent, candidates: open, scheduleStopEventKey }, fetchers);
    },
    enabled: active,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
