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
          // 30s, against vitest's 5s default (2026-09-09).
          //
          // This project's node tests are not unit tests in the millisecond
          // sense. Several load a real season from the corpus (15-20k rows),
          // replay two full seasons twice over, or read every source file in
          // the repo. Six of them sit in the 5-8s range, which means they pass
          // when run alone and FAIL under full-suite parallel load — a suite
          // that is red at random, which is the kind that trains a reader to
          // stop looking. That is not hypothetical here: a genuine failure hid
          // in a red suite for eight days (`payloadBudget`, 2026-08-26).
          //
          // Raised globally rather than per-test on purpose. Patching whichever
          // test happened to lose the race is whack-a-mole; the default is
          // simply wrong for this repo's node half. 30s still catches a
          // genuinely hung test, which is all this limit is for.
          testTimeout: 30_000,
        },
      },
      "./apps/web",
    ],
    passWithNoTests: true,
  },
});
