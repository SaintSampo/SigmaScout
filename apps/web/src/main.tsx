import "@fontsource-variable/inter";
import "./styles/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.js";
import { queryClient } from "./lib/query-client.js";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("main.tsx: no #root element found in index.html");
}

// `index.html`'s #root now ships real static shell markup (06-09-PLAN.md
// Task 1) so the ribbon frame and wordmark paint before this script runs.
// No change is needed here beyond this comment: `createRoot(el).render(...)`
// is a from-scratch client render, not a hydration — on its first commit it
// removes any existing children of `el` (the shell markup) before inserting
// its own tree, so there is never a moment with two headers on screen and
// no leftover shell node survives the mount. If this ever changes to
// `hydrateRoot` (it should not, without a matching SSR/prerender story), the
// shell's DOM shape would need to match the real render exactly instead of
// only approximately, since hydration diffs against existing nodes rather
// than replacing them outright.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
