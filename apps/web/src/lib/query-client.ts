import { QueryClient } from "@tanstack/react-query";

/**
 * Artifacts change at most once per publish or, during a live event, once per
 * Worker tick. The 5-minute `staleTime` keeps ordinary browsing cheap — no
 * query in apps/web sets `refetchInterval` (audit F3), so a live page's data
 * only refreshes when this `staleTime` lapses, not on any shorter cadence.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
