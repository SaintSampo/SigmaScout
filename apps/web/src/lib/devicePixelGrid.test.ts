import { describe, expect, it } from "vitest";
import { devicePixelPhaseStep, snapToDevicePixelPhase } from "./devicePixelGrid.js";

describe("devicePixelPhaseStep", () => {
  /**
   * The four ratios that actually matter, with the step each one needs. These
   * are the ratios the headless-Chromium measurement in `devicePixelGrid.ts`'s
   * own doc comment was run at, and the step is what made the rendered tick
   * widths uniform at each.
   */
  it.each([
    [1, 1],
    [1.25, 4],
    [1.5, 2],
    [1.75, 4],
    [2, 1],
    [2.5, 2],
    [3, 1],
  ])("dpr %s snaps on a %s-CSS-pixel step", (dpr, step) => {
    expect(devicePixelPhaseStep(dpr)).toBe(step);
  });

  it("returns a step whose device-pixel length is a whole number — the property the step exists for, not just the table above", () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]) {
      const step = devicePixelPhaseStep(dpr);
      expect(Math.abs(step * dpr - Math.round(step * dpr))).toBeLessThan(1e-6);
    }
  });

  it("falls back to 1 for a ratio no small step can land, rather than shifting a mark far off its own value", () => {
    // Bounded at 8 by design: 1/3 would need a step of 3 (fine), but an
    // irrational-ish ratio has no small step at all.
    expect(devicePixelPhaseStep(1.1)).toBe(1);
    expect(devicePixelPhaseStep(Math.PI)).toBe(1);
  });

  it("survives the values a real browser can hand back before layout", () => {
    expect(devicePixelPhaseStep(0)).toBe(1);
    expect(devicePixelPhaseStep(Number.NaN)).toBe(1);
    expect(devicePixelPhaseStep(-2)).toBe(1);
  });
});

describe("snapToDevicePixelPhase", () => {
  it("puts every offset on the same grid phase — the whole point, stated as a property", () => {
    const step = devicePixelPhaseStep(1.25);
    for (const raw of [12.4, 47.91, 103.02, 288.75, 469.6]) {
      expect(snapToDevicePixelPhase(raw, step) % step).toBe(0);
    }
  });

  it("moves an offset by less than half a step, so the mark still reads at its own value", () => {
    const step = devicePixelPhaseStep(1.25);
    for (const raw of [12.4, 47.91, 103.02, 288.75, 469.6]) {
      expect(Math.abs(snapToDevicePixelPhase(raw, step) - raw)).toBeLessThanOrEqual(step / 2);
    }
  });

  it("leaves geometry untouched at step 1 for a whole-pixel offset — dpr 1 and 2 were never broken and must not be 'fixed'", () => {
    expect(snapToDevicePixelPhase(240, 1)).toBe(240);
    expect(snapToDevicePixelPhase(240.4, 1)).toBe(240);
  });
});
