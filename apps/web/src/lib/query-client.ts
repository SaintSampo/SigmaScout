import { QueryClient } from "@tanstack/react-query";

/**
 * Finished-season artifacts change at most once per manual re-baseline
 * (`opr`/`epa`) or once per live tick (`vpr`) — a 5-minute `staleTime` is
 * correct and cheap for browsing pages. A future live-event page (Team/Event
 * detail, Phase 6/7) overrides this per-query with `refetchInterval`, scoped
 * only to `vpr` pages, matching the Worker's `LIVE_ALGORITHM_IDS=vpr` scoping
 * (the live-fold-tier pattern quick task 260822-wqt introduced in Phase 4,
 * renamed from `sigma1` by plan 07-16) — Phase 5's Teams/Events pages are not
 * live-tick targets.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
