import { QueryClient } from "@tanstack/react-query";

/**
 * Artifacts change at most once per publish or, during a live event, once per
 * Worker tick. The 5-minute `staleTime` keeps ordinary browsing cheap. Four
 * queries refresh on a shorter cadence: the event artifact (`eventQueryOptions`,
 * 260915-m4j, closing audit F3), the team artifact, the district artifact and the
 * events list (`eventsQueryOptions`, 261024-jdz). Each sets `refetchInterval` to
 * 60 s only while live, and each pauses in a hidden tab.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
