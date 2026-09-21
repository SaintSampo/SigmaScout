import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * The production artifact origin (mirrors `src/lib/artifactOrigin.ts`'s own
 * fallback exactly — see that file's header for why `https://data.sigmascout.org`
 * is the one place a host string for the artifact origin lives). This file
 * cannot IMPORT that module: `artifactOrigin.ts` reads `import.meta.env` at
 * module top, which is `undefined` in this config's Node context, so this
 * constant is declared here instead, kept in step by hand.
 */
const DEFAULT_ARTIFACT_ORIGIN = "https://data.sigmascout.org";

/** `manifests.ts`'s `ALGORITHMS_MANIFEST_KEY`, kept in step by hand for the same reason above — this file cannot import from `src/`. */
const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";

/**
 * Injects a `preconnect` + `preload as=fetch` hint for the algorithms
 * manifest into the built `index.html` `<head>` (audit E1) — the browser
 * opens the connection to the artifact origin and starts fetching the
 * manifest before the main JS bundle finishes parsing, shaving a full
 * request-waterfall hop off first paint. `crossorigin` is the empty-string
 * attribute (anonymous mode), matching a default-credentials cross-origin
 * `fetch()` exactly, so the preloaded response is reused by
 * `fetchAlgorithmsManifest`'s own request rather than fetched twice.
 */
function manifestPreloadPlugin(artifactOrigin: string): Plugin {
  return {
    name: "sigmascout-manifest-preload",
    transformIndexHtml() {
      return [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: artifactOrigin, crossorigin: "" },
          injectTo: "head-prepend",
        },
        {
          tag: "link",
          attrs: { rel: "preload", as: "fetch", href: `${artifactOrigin}/${ALGORITHMS_MANIFEST_KEY}`, crossorigin: "" },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const artifactOrigin = loadEnv(mode, process.cwd(), "VITE_").VITE_ARTIFACT_ORIGIN ?? DEFAULT_ARTIFACT_ORIGIN;

  /**
   * Same-origin artifact path for a LOCAL page.
   *
   * `https://data.sigmascout.org`'s R2 CORS policy does not allow-list
   * `localhost`, so a page served from a local origin must never
   * issue a cross-origin artifact request directly — it will CORS-fail and the
   * page renders empty, which looks exactly like a layout defect and is not
   * one. Proxying `/v1` through the page's own origin makes the browser's
   * request same-origin; the proxy itself forwards it server-side to the real
   * R2 custom domain, so the bytes served are the actual published artifacts,
   * not a fixture or a mock.
   *
   * The target is ALWAYS the real published origin, never `artifactOrigin`.
   * The e2e build sets `VITE_ARTIFACT_ORIGIN` to the preview server's own URL
   * so the BROWSER asks this server for `/v1`; using that same value as the
   * forwarding target made the proxy forward every `/v1` request back to
   * itself, looping until the machine ran out of ephemeral ports
   * (`EADDRINUSE`) and every local-project spec failed on an empty page.
   *
   * `server`/`preview` are Vite-local-only options — Cloudflare Pages serves
   * the built `dist/` directory directly and never reads this file, so this
   * proxy has no effect on, and no relevance to, the deployed site.
   */
  const localArtifactProxy = {
    "/v1": {
      target: DEFAULT_ARTIFACT_ORIGIN,
      changeOrigin: true,
    },
  };

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
        routeFileIgnorePattern: "\\.test\\.tsx?$",
      }),
      react(),
      tailwindcss(),
      manifestPreloadPlugin(artifactOrigin),
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
  };
});
