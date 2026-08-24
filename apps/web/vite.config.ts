import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // `autoCodeSplitting: true` (D-19, 05-08-PLAN.md Task 3, added outside
    // this plan's declared `files_modified` per D-19's own note): TanStack
    // Router's officially supported route-level code split. Each route's
    // `component` (Teams pulls in `@tanstack/react-table` +
    // `@tanstack/react-virtual` — the diagnosed 602 KB/183 KB gzip weight
    // delaying the ribbon wordmark's first paint) is split into its own
    // chunk, fetched only once the router actually navigates to that route.
    // `validateSearch`/the route tree itself stay in the main chunk — the
    // router needs those synchronously to resolve ANY URL, including the
    // one that never visits `/teams` at all. No route file was restructured
    // into the manual `.lazy.tsx` convention to get this; the plugin does it
    // from the existing single-file routes.
    tanstackRouter({ target: "react", routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    // Prevent the root workspace's zod/react/react-dom from landing in the bundle
    // as a second, separate instance from apps/web's own copies (05-01-PLAN.md).
    dedupe: ["zod", "react", "react-dom"],
    alias: {
      // "@/*" -> "./src/*" — the import alias shadcn's initializer requires
      // (05-03-PLAN.md Task 1). Mirrors the "@/*" path in tsconfig.json.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
