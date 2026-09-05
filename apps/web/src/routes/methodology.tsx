import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * The `/methodology` layout route (quick task 260905-phf Task 1). This repo's
 * flat route file naming (`event.$eventKey.tsx` with no `event.tsx` parent)
 * attaches most routes directly to root, so the router plugin only synthesises
 * a parent when a file with the exact prefix exists — introducing
 * `methodology.vpr.tsx` and `methodology.compare.tsx` alongside this file makes
 * THIS the parent by that same flat-nesting rule.
 *
 * This route exists ONLY so the plugin nests the three methodology children
 * under one `/methodology` path segment. It must never grow a heading, a
 * container, or any chrome of its own — every child route (`methodology.index.tsx`,
 * `methodology.vpr.tsx`, `methodology.compare.tsx`) owns its own page container
 * and `<h1>`, exactly as every other top-level page in this app does. Adding
 * chrome here would double it on every child.
 */
export const Route = createFileRoute("/methodology")({
  component: MethodologyLayout,
});

function MethodologyLayout() {
  return <Outlet />;
}
