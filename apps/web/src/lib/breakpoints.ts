import { useEffect, useState } from "react";

/**
 * The single definition of the phone/desktop boundary (05-03-PLAN.md Task 2).
 * Both CSS responsive utilities (Tailwind's `md:` prefix, which defaults to
 * this exact 768px value) and `useIsMobile` below resolve to this one
 * number, so two components can never disagree about which side of the
 * line they are on.
 *
 * Boundary condition: a viewport width of EXACTLY `MOBILE_BREAKPOINT_PX`
 * (768px) counts as DESKTOP, not mobile. `useIsMobile` queries
 * `(max-width: 767px)` — one pixel narrower than the constant — so the
 * boundary value itself always resolves to exactly one mode.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * `true` when the viewport is narrower than `MOBILE_BREAKPOINT_PX` (i.e. at
 * most `MOBILE_BREAKPOINT_PX - 1`), `false` at or above it. Subscribes to
 * `window.matchMedia` and unsubscribes on unmount.
 *
 * Does not crash when `matchMedia` is unavailable (jsdom provides no
 * implementation by default) — falls back to `false` (desktop) and skips
 * the subscription entirely rather than throwing.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handleChange = () => {
      setIsMobile(mediaQueryList.matches);
    };
    handleChange();
    mediaQueryList.addEventListener("change", handleChange);
    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  return isMobile;
}

/**
 * The F3 metric-first narrow ordering (ui-polish, 2026-08-31) is justified
 * by measured geometry: rank 56 + team 72 + nickname 90 + metric 120 =
 * 338px, which fits a 390px phone's ~342px scroller but NOT the ~312px
 * scroller of the narrowest supported devices (G-2's pixel-10 case, where
 * it regressed the "one full data column at scroll 0" invariant). Below
 * this viewport width the tables fall back to the G-11 record-first order,
 * whose 80px record column does fit. 380 viewport ≈ the narrowest width
 * whose scroller still fits the 338px F3 first-paint set.
 */
export const F3_METRIC_FIRST_MIN_VIEWPORT_PX = 380;

/** `true` when the viewport is mobile-narrow (`useIsMobile`) but still wide enough for the F3 metric-first order; `false` on the narrowest devices, which keep the G-11 record-first order. Same matchMedia/jsdom-fallback discipline as `useIsMobile`. */
export function useIsF3MetricFirstWidth(): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(`(min-width: ${F3_METRIC_FIRST_MIN_VIEWPORT_PX}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(`(min-width: ${F3_METRIC_FIRST_MIN_VIEWPORT_PX}px)`);
    const handleChange = () => {
      setMatches(mediaQueryList.matches);
    };
    handleChange();
    mediaQueryList.addEventListener("change", handleChange);
    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  return matches;
}
