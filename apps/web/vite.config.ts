import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Same-origin artifact path for a LOCAL page (quick task 260830-p6s, G-06-2).
 *
 * `https://data.sigmascout.org`'s R2 CORS policy (Phase 5 D-18) does not
 * allow-list `localhost`, so a page served from a local origin must never
 * issue a cross-origin artifact request directly — it will CORS-fail and the
 * page renders empty, which looks exactly like a layout defect and is not
 * one. Proxying `/v1` through the page's own origin makes the browser's
 * request same-origin; the proxy itself forwards it server-side to the real
 * R2 custom domain, so the bytes served are the actual published artifacts,
 * not a fixture or a mock.
 *
 * This rule is INERT unless the built bundle's `VITE_ARTIFACT_ORIGIN` also
 * points at this same local origin — the default production build still
 * emits absolute `https://data.sigmascout.org/...` URLs
 * (`src/lib/artifactOrigin.ts`) that never touch this proxy at all.
 * `playwright.config.ts`'s `webServer.env` is what sets that variable for
 * the local e2e loop.
 *
 * `server`/`preview` are Vite-local-only options — Cloudflare Pages serves
 * the built `dist/` directory directly and never reads this file, so this
 * proxy has no effect on, and no relevance to, the deployed site.
 */
const localArtifactProxy = {
  "/v1": {
    target: "https://data.sigmascout.org",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }), react(), tailwindcss()],
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
  server: {
    proxy: localArtifactProxy,
  },
  preview: {
    // Pinned IN CONFIG rather than passed as `pnpm preview --port`: this repo
    // has a recorded pnpm argument-forwarding trap where
    // `pnpm run <script> -- <arg>` forwards `--` itself as a literal argv
    // entry, so a config value is the reliable way to guarantee this port.
    // `playwright.config.ts`'s local `webServer.url` must equal this exact
    // value.
    port: 4173,
    strictPort: true,
    proxy: localArtifactProxy,
  },
});
