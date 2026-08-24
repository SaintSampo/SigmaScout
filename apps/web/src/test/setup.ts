import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup only fires when Vitest's `globals` option is enabled; this
// repo's convention keeps `globals: false` everywhere (root vitest.config.ts),
// so it is wired explicitly here instead.
afterEach(() => {
  cleanup();
});
