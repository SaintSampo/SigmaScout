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
 * Measured in headless Chromium: dpr 1 and dpr 2 never break (every tick
 * already lands on a whole device pixel), but dpr 1.25 and 1.5 cycle
 * through mixed device-pixel widths across a run of ticks. Rounding the
 * tick's `left` to a whole CSS pixel does NOT fix this, since whole CSS
 * pixels are exactly what cycles through the phases; neither does
 * converting to exact device pixels and dividing back, since Chrome
 * quantizes CSS lengths to 1/64px and the residue makes the spread worse;
 * SVG `shape-rendering: crispEdges` was measured worst of all.
 *
 * What does work is leaving the width alone — 2px is exactly representable,
 * so it is never the problem — and putting every tick on the SAME phase of
 * the device grid. Snapping `left` to a multiple of `devicePixelPhaseStep`
 * measured uniform at every dpr tested, confirmed against a real event page
 * (56 sampled ticks per run): mixed device-pixel widths before the snap,
 * uniform after, at every fractional dpr.
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
