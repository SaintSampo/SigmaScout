/**
 * The as-of object fetchers the event route hands the Simulation tab (quick
 * task 261005-5g0, Part 4), kept apart from `simulationAsOf.ts` so that pure
 * module stays free of the browser only artifact origin and can run under the
 * repo root's own typecheck and tests.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { asOfIndexQueryOptions, asOfLogQueryOptions, asOfSeasonQueryOptions, asOfStartQueryOptions } from "../../lib/api/asOf.js";
import type { AsOfFetchers } from "../districts/asOfRewind.js";

/**
 * The fetchers the route hands the tab: every object through the query cache
 * under its own key (`lib/api/asOf.ts`), so a second run at a nearby start
 * refetches only what it newly needs. Keyed by the ARTIFACT's own algorithm and
 * version, the generation its stored rows came from. A `fresh` fetch (an
 * object `resolveAsOf` reported out of step) skips the cache.
 */
export function simulationAsOfFetchers(queryClient: QueryClient, artifact: Pick<EventArtifact, "season" | "algorithmId" | "algorithmVersion">): AsOfFetchers {
  const algorithmId = artifact.algorithmId;
  const version = artifact.algorithmVersion;
  const season = artifact.season;
  return {
    index: (eventKey, options) => queryClient.fetchQuery(asOfIndexQueryOptions({ eventKey, algorithmId, version }, options)),
    log: (eventKey, options) => queryClient.fetchQuery(asOfLogQueryOptions({ eventKey, algorithmId, version }, options)),
    season: (options) => queryClient.fetchQuery(asOfSeasonQueryOptions({ season, algorithmId, version }, options)),
    start: () => queryClient.fetchQuery(asOfStartQueryOptions({ season, algorithmId, version })),
  };
}
