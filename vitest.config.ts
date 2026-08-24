import { defineConfig } from "vitest/config";

// Plan 05-01 Task 3, Step 3: this file used to force a single `environment:
// "node"` on everything under `apps/**`, which would silently run any
// `apps/web` component test with no DOM (RESEARCH.md Pitfall 5). Converted to
// a `projects` array so `pnpm test` from the root still runs everything, but
// each half owns its own environment — `apps/web` never shares this node
// project's config, it has its own `apps/web/vitest.config.ts`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/worker/**/*.test.ts"],
          environment: "node",
          globals: false,
          passWithNoTests: true,
        },
      },
      "./apps/web",
    ],
  },
});
