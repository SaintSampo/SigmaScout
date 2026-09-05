import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/compare` redirect (quick task 260905-phf Task 1): the accuracy-comparison
 * page moved to `/methodology/compare`, but `/compare` has been shareable
 * since Phase 8 — a public site must not break already-shared links. This
 * route's only job is to redirect to the moved page, carrying the current
 * search params forward unchanged.
 *
 * The redirect target is a single fixed literal path, never a value read
 * from the URL (threat T-phf-03) — no open-redirect and no redirect loop is
 * constructible here.
 *
 * `search: (prev) => prev` hits the same "no single TanStack Router type
 * expresses carry-everything-forward-for-any-target-route" gap
 * `Ribbon.tsx`'s `preserveSearch` documents, cast through the same narrow,
 * local `as never` escape hatch.
 */
export const Route = createFileRoute("/compare")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/methodology/compare", search: (() => search) as never, replace: true });
  },
});
