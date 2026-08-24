import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
});
