import { QueryClient } from "@tanstack/react-query";

/**
 * Artifacts change at most once per publish or, during a live event, once per
 * Worker tick. The 5-minute `staleTime` keeps ordinary browsing cheap. The one
 * query that refreshes on a shorter cadence is the event artifact
 * (`eventQueryOptions`, 260915-m4j, closing audit F3): it sets
 * `refetchInterval` to 60 s only while its event is live (upcoming matches and
 * a current schedule), and pauses in a hidden tab.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
