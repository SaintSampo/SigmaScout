import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    environment: "jsdom",
    globals: false,
    passWithNoTests: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
