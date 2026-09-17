/**
 * Offline tests for the cross-engine determinism instrument (260917-mwu, Half B).
 * The engines themselves are not launched here — the instrument's own run does
 * that; what these pin are the three properties that decide whether its OUTPUT
 * can be believed:
 *
 * 1. THE BUNDLE MARKER ASSERTION ACTUALLY FAILS. A harness whose "is the real
 *    code in the bundle?" check silently passed on an empty string would report
 *    three engines agreeing about nothing at all. Both directions are asserted,
 *    including against a real bundle built here.
 * 2. THE ULP DISTANCE IS A REAL ULP DISTANCE. The whole point of Half B is
 *    last-bit differences; a distance function that returned 0 for adjacent
 *    doubles would turn "the engines differ" into "the engines agree".
 * 3. THE DIGEST IS LOSSLESS. Two doubles that render identically in decimal must
 *    hash differently, or the digest hides exactly what it was built to find.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ROUNDING_RULE } from "../packages/harness/rounding.js";
import {
  assertBundleMarkers,
  BundleMarkerError,
  buildBundle,
  closestRoundingBoundary,
  comparePair,
  ENGINE_SPECS,
  REQUIRED_BUNDLE_MARKERS,
  ulpDistance,
} from "./measureEngineDeterminism.js";
import { bitsOf, digestFloats, digestString, type BrowserFoldResult } from "./browserFoldEntry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

describe("the bundle-marker assertion cannot pass vacuously", () => {
  it("throws for an empty bundle, naming every missing marker", () => {
    let thrown: unknown;
    try {
      assertBundleMarkers("");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BundleMarkerError);
    expect((thrown as BundleMarkerError).missing).toHaveLength(REQUIRED_BUNDLE_MARKERS.length);
  });

  it("throws when a single module's marker is missing, not only when all are", () => {
    const allButOne = REQUIRED_BUNDLE_MARKERS.slice(1)
      .map((m) => m.marker)
      .join(" ");
    expect(() => assertBundleMarkers(allButOne)).toThrow(BundleMarkerError);
    expect(() => assertBundleMarkers(REQUIRED_BUNDLE_MARKERS.map((m) => m.marker).join(" "))).not.toThrow();
  });

  it("names a real source module and a real reason for every marker", () => {
    for (const marker of REQUIRED_BUNDLE_MARKERS) {
      expect(marker.module).toMatch(/\.ts$/);
      expect(marker.marker.length).toBeGreaterThan(3);
      expect(marker.why.length).toBeGreaterThan(10);
    }
  });

  it("builds the real bundle and finds every marker in it, so the check is proven against the artifact it guards", () => {
    const bundle = buildBundle();
    expect(bundle.length).toBeGreaterThan(50_000);
    for (const marker of REQUIRED_BUNDLE_MARKERS) {
      expect(bundle, `${marker.module} (${marker.why})`).toContain(marker.marker);
    }
    // The global the browser arms call, present by name in the built output.
    expect(bundle).toContain("__replayParityBrowserFold");
    // The bundle must be a browser IIFE: no Node built-in survived into it.
    expect(bundle).not.toMatch(/require\("node:/);
    expect(bundle).not.toContain("better-sqlite3");
  }, 120_000);
});

/**
 * The next representable double above `value`, by incrementing its bit pattern.
 * Computed rather than approximated: `x + Number.EPSILON * k` is NOT one ulp
 * away for a general `x` (for `x = 0.1` it is two), and a test that assumed it
 * was would be testing its own arithmetic rather than `ulpDistance`.
 */
function nextUp(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

describe("ulp distance measures last-bit differences", () => {
  it("is 1 for adjacent doubles and 0 for identical ones", () => {
    for (const x of [0.1, 1, 123.456, 1e-9, 5e5]) {
      expect(ulpDistance(x, x)).toBe(0);
      expect(ulpDistance(x, nextUp(x)), `nextUp(${x})`).toBe(1);
    }
  });

  it("grows with the gap rather than saturating", () => {
    const x = 0.1;
    expect(ulpDistance(x, nextUp(x))).toBe(1);
    expect(ulpDistance(x, nextUp(nextUp(x)))).toBe(2);
    expect(ulpDistance(x, nextUp(nextUp(nextUp(x))))).toBe(3);
  });

  it("is symmetric, so the pair order cannot change the reported distance", () => {
    const x = 0.1;
    expect(ulpDistance(x, nextUp(x))).toBe(ulpDistance(nextUp(x), x));
  });

  it("stays finite across zero and distinguishes 0 from -0", () => {
    expect(Number.isFinite(ulpDistance(-Number.MIN_VALUE, Number.MIN_VALUE))).toBe(true);
    expect(ulpDistance(0, -0)).toBe(0); // Object.is is false, but they are the same point on the number line's two sides
    expect(ulpDistance(1, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the digest is lossless, which is the only reason it can answer this question", () => {
  it("hashes two doubles that print the same decimal to different values", () => {
    // Both render as "0.3" at any display precision the site uses.
    const a = 0.1 + 0.2;
    const b = 0.3;
    expect(a.toFixed(ROUNDING_RULE.pmf)).toBe(b.toFixed(ROUNDING_RULE.pmf));
    expect(bitsOf(a)).not.toBe(bitsOf(b));
    expect(digestFloats([a])).not.toBe(digestFloats([b]));
  });

  it("is order-sensitive, so a reordered sequence is not mistaken for the same one", () => {
    expect(digestFloats([1, 2])).not.toBe(digestFloats([2, 1]));
  });

  it("separates an absent field's sentinel from a real zero", () => {
    expect(digestFloats([Number.NEGATIVE_INFINITY])).not.toBe(digestFloats([0]));
    expect(digestFloats([0])).not.toBe(digestFloats([-0]));
  });

  it("hashes strings stably and distinguishes a one-character change", () => {
    expect(digestString("abc")).toBe(digestString("abc"));
    expect(digestString("abc")).not.toBe(digestString("abd"));
  });
});

describe("the pairwise comparison reports what actually differs", () => {
  function armResult(values: number[], rounded: unknown[]): BrowserFoldResult {
    const digest = {
      unroundedDigest: digestFloats(values),
      roundedDigest: digestString(JSON.stringify(rounded)),
      floatCount: values.length,
      unrounded: values,
      rounded,
      byRule: { probability: [], score: [], variance: [], pmf: values, metric: [] },
    };
    return { resumed: digest, coldLayer: digest, markers: { mirror: "m", entry: "e", sprVersion: "v", ruleSeason: 2026 } };
  }

  it("reports identical digests and zero differing floats for two equal arms", () => {
    const a = armResult([1, 2, 3], [{ pRedWin: 0.5 }]);
    const pair = comparePair("node", a, "chromium", a, "resumed");
    expect(pair.unroundedIdentical).toBe(true);
    expect(pair.roundedIdentical).toBe(true);
    expect(pair.differingFloats).toBe(0);
    expect(pair.floatsCompared).toBe(3);
  });

  it("localises a single one-ulp difference and reports the rounded rows as still identical", () => {
    const base = [1, 2, 3];
    const drifted = [1, 2 + Number.EPSILON * 2, 3];
    const pair = comparePair("chromium", armResult(base, [{ x: 1 }]), "firefox", armResult(drifted, [{ x: 1 }]), "resumed");
    expect(pair.unroundedIdentical).toBe(false);
    // The published rows did not move, which is the "INCONCLUSIVE, rounding
    // absorbed it" case the pre-registration names.
    expect(pair.roundedIdentical).toBe(true);
    expect(pair.differingFloats).toBe(1);
    expect(pair.firstDivergingIndex).toBe(1);
    expect(pair.maxUlpDistance).toBe(1);
  });

  it("reports a rounded-digest difference when a published number itself moved", () => {
    const pair = comparePair("a", armResult([1], [{ pRedWin: 0.5 }]), "b", armResult([1], [{ pRedWin: 0.5001 }]), "resumed");
    expect(pair.unroundedIdentical).toBe(true);
    expect(pair.roundedIdentical).toBe(false);
  });
});

describe("the rounding-boundary report", () => {
  it("returns a small margin for a value sitting on a rounding boundary", () => {
    expect(closestRoundingBoundary([0.123455], ROUNDING_RULE.pmf)).toBeLessThan(1e-6);
  });

  it("returns the full half-unit for values nowhere near one", () => {
    expect(closestRoundingBoundary([0.1, 0.2, 0.3], ROUNDING_RULE.pmf)).toBeCloseTo(0.5, 6);
  });

  it("reports the CLOSEST value, not the average, so one near-miss is not averaged away", () => {
    expect(closestRoundingBoundary([0.1, 0.123455, 0.2], ROUNDING_RULE.pmf)).toBeLessThan(1e-6);
  });
});

describe("no engine can be absorbed into an identical verdict", () => {
  it("names all three engines and an install command for each", () => {
    expect(ENGINE_SPECS.map((s) => s.id).sort()).toEqual(["chromium", "firefox", "webkit"]);
    expect(ENGINE_SPECS.map((s) => s.engine).sort()).toEqual(["JavaScriptCore", "SpiderMonkey", "V8"]);
    for (const spec of ENGINE_SPECS) {
      expect(spec.install).toContain("playwright install");
      expect(spec.install).toContain(spec.id);
    }
  });

  it("imports no R2 client, no signing SDK and reads no environment variable", () => {
    const source = readFileSync(resolve(HERE, "measureEngineDeterminism.ts"), "utf8");
    const specifiers = [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
    expect(specifiers.filter((s) => /r2Client|@aws-sdk|aws4fetch|signature|sigv4/i.test(s))).toEqual([]);
    expect(source).not.toMatch(/process\.env/);
    // The only page this instrument ever opens is `about:blank`: it drives a
    // LOCAL browser and never loads a URL, which is what keeps "launch a
    // browser" from becoming "make a network request".
    expect(source).toContain('page.goto("about:blank")');
    expect(source).not.toMatch(/goto\("https?:/);
  });
});
