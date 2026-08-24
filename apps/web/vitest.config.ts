import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors vite.config.ts's "@" -> "./src" alias (05-03-PLAN.md Task 1) —
    // vitest.config.ts is a separate config from vite.config.ts and does not
    // inherit its `resolve.alias`, so every generated src/components/ui/*
    // import of "@/..." needs this restated here too.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    environment: "jsdom",
    globals: false,
    passWithNoTests: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
