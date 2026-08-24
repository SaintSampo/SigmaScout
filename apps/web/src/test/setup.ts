import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup only fires when Vitest's `globals` option is enabled; this
// repo's convention keeps `globals: false` everywhere (root vitest.config.ts),
// so it is wired explicitly here instead.
afterEach(() => {
  cleanup();
});

// jsdom provides no `window.matchMedia` implementation by default (calling
// it throws `TypeError: window.matchMedia is not a function`). breakpoints.ts's
// `useIsMobile` already guards against that absence at runtime, but any test
// that wants to exercise its real matching behavior — not just its no-crash
// fallback — needs a callable stub. Always matches `false` (desktop);
// individual tests can override `window.matchMedia` per-case if they need to
// simulate a mobile viewport (05-03-PLAN.md Task 2).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}
