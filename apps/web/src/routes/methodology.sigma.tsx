import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/methodology/sigma` used to be the "Sigma Score and the match band" page.
 * That page was folded into "What is SPR?" on 2026-09-17 (sketch 018), so
 * this route exists only to keep old links and bookmarks working: it
 * redirects to `/methodology/spr`, carrying the current search params.
 */
/** Cross-route search carry, the same documented escape hatch `Ribbon.tsx`'s `preserveSearch` uses. */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

export const Route = createFileRoute("/methodology/sigma")({
  beforeLoad: () => {
    throw redirect({ to: "/methodology/spr", search: preserveSearch, replace: true });
  },
});
