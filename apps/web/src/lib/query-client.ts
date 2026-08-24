import { QueryClient } from "@tanstack/react-query";

/**
 * Finished-season artifacts change at most once per manual re-baseline
 * (`opr`/`epa`) or once per live tick (`sigma1`) — a 5-minute `staleTime` is
 * correct and cheap for browsing pages. A future live-event page (Team/Event
 * detail, Phase 6/7) overrides this per-query with `refetchInterval`, scoped
 * only to `sigma1` pages, matching Phase 4's `LIVE_ALGORITHM_IDS=sigma1`
 * scoping — Phase 5's Teams/Events pages are not live-tick targets.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
