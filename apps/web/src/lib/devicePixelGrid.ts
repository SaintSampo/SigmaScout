import { useSyncExternalStore } from "react";

/**
 * Keeping a hairline mark the SAME apparent weight everywhere it is drawn.
 *
 * The match plot's prediction tick is declared `width: 2px`, but a reader on
 * a scaled display (Windows at 125%, a HiDPI laptop, or any browser zoom)
 * sees some ticks render heavier than others in the same table. The width is
 * not the variable — the POSITION is. `scaleToPlot` returns a fractional x,
 * and at a device-pixel ratio that is not a whole number, two ticks with
 * different fractional offsets straddle the device grid differently: the
 * browser spreads one tick's ink over 3 device pixels and the next one's
 * over 4, with softer edges. Same ink, different apparent weight.
 *
 * Measured in headless Chromium across dpr 1 / 1.25 / 1.5 / 2 (2026-09-09),
 * sampling the rendered pixel row under twelve ticks at fractional offsets:
 *
 *   dpr 1.00  raw [2,2,2,2,…]        — never broken; every tick already 2 device px
 *   dpr 1.25  raw [4,3,3,4,3,3,…]    — cycles, because integer CSS px × 1.25 cycles
 *                                      through four device-grid phases
 *   dpr 1.50  raw [4,3,3,4,3,4,…]
 *   dpr 2.00  raw [4,4,4,4,…]        — never broken
 *
 * Rounding the tick's `left` to a whole CSS pixel does NOT fix this — it was
 * measured byte-identical to the unrounded case at every dpr above, because
 * whole CSS pixels are exactly what cycles through the phases. Neither does
 * converting to exact device pixels and dividing back (`round(x·dpr)/dpr`):
 * Chrome quantizes CSS lengths to 1/64px, 3/1.25 = 2.4 is not a multiple of
 * 1/64, and the residue made the spread WORSE (measured [5,3,3,5,…]). SVG
 * `shape-rendering: crispEdges` was measured worst of all at dpr 1.25
 * ([2,3,3,2,3,2,…] with hard edges, so the difference reads as a step rather
 * than a blur).
 *
 * What does work is leaving the width alone — 2px is exactly representable,
 * so it is never the problem — and putting every tick on the SAME phase of
 * the device grid. Snapping `left` to a multiple of `devicePixelPhaseStep`
 * measured uniform at every dpr tested: dpr 1 → 2 device px, dpr 1.25 → 3,
 * dpr 1.5 → 3, dpr 2 → 4, with identical ink coverage on all twelve ticks.
 *
 * Re-measured against the REAL page rather than the repro — a local build of
 * `/event/2024casf?tab=quals`, 56 ticks sampled per run, in headless Chromium:
 *
 *              before        after
 *   dpr 1.00   [2]           [2]     unchanged, never broken
 *   dpr 1.25   [3,4] mixed   [3]     uniform
 *   dpr 1.50   [3,4] mixed   [3]     uniform
 *   dpr 2.00   [4]           [4]     unchanged, never broken
 */

/**
 * The smallest whole number of CSS pixels whose length in device pixels is
 * also a whole number — 1 at dpr 1 and 2, 4 at dpr 1.25 and 1.75, 2 at dpr
 * 1.5 and 2.5. A position that is a multiple of this always lands on the
 * same phase of the device-pixel grid, which is what makes two ticks render
 * identically instead of one soft and one sharp.
 *
 * Bounded at 8: past that the positional cost of snapping (up to half a step)
 * would outweigh the weight consistency it buys, so an exotic ratio falls
 * back to 1 and simply keeps today's behaviour rather than shifting a mark
 * several pixels off its own value.
 */
export function devicePixelPhaseStep(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  for (let step = 1; step <= 8; step++) {
    if (Math.abs(step * dpr - Math.round(step * dpr)) < 1e-6) return step;
  }
  return 1;
}

/**
 * A CSS-pixel offset moved to the nearest device-grid phase. The caller
 * passes the mark's LEFT EDGE, not its centre — snapping the edge is what
 * fixes the rendering, and snapping a centre then subtracting half a width
 * would reintroduce the fractional offset this exists to remove.
 */
export function snapToDevicePixelPhase(cssPx: number, step: number): number {
  return Math.round(cssPx / step) * step;
}

/**
 * `window.devicePixelRatio`, kept current across zoom changes and monitor
 * moves, shared by every subscriber through ONE `matchMedia` listener rather
 * than one per mark — a full event page draws ~160 ticks, and 160 media
 * queries to learn a single number would be its own defect.
 */
const listeners = new Set<() => void>();
let watched: MediaQueryList | undefined;

function currentRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

/** Re-arms the watch at the NEW ratio: a `(resolution: Ndppx)` query only reports leaving N, so each change needs a fresh query to hear the one after it. */
function watch(): void {
  watched?.removeEventListener("change", onChange);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  watched = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
  watched.addEventListener("change", onChange);
}

function onChange(): void {
  watch();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      watched?.removeEventListener("change", onChange);
      watched = undefined;
    }
  };
}

/** The device-grid step for the reader's CURRENT display, re-rendering the marks that use it when they zoom. Returns 1 under jsdom and any environment without `matchMedia`, which is exactly right: dpr is 1 there and 1 is the step that leaves geometry untouched. */
export function useDevicePixelPhaseStep(): number {
  const dpr = useSyncExternalStore(subscribe, currentRatio, () => 1);
  return devicePixelPhaseStep(dpr);
}
