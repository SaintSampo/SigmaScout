import { describe, expect, it } from "vitest";
import { rotate, sortEventKeys, SubrequestCounter } from "../src/subrequestCounter.js";

/**
 * The cap, the reserve, `usableCap`, `tryConsume` and the throwing `consume`
 * were deleted by quick task 260923-3w4 along with every deferral path they
 * gated, so the describes that pinned their boundary behaviour went with them.
 * What is left is the counter's one remaining job (feeding the tick log's
 * `subrequestsUsed`) and the rotation's no-starvation property, which is a
 * property of the ordering rather than of any cap — see `subrequestCounter.ts`'s
 * header.
 */
describe("SubrequestCounter", () => {
  it("starts at zero and accumulates what each spend records", () => {
    const counter = new SubrequestCounter();
    expect(counter.used).toBe(0);
    counter.spend(10);
    counter.spend(36);
    expect(counter.used).toBe(46);
  });

  it("spends one by default, so a call site that spends exactly one subrequest passes no argument", () => {
    const counter = new SubrequestCounter();
    counter.spend();
    counter.spend();
    expect(counter.used).toBe(2);
  });

  it("NEVER refuses: a count far past any platform limit still records, because nothing branches on it", () => {
    const counter = new SubrequestCounter();
    for (let i = 0; i < 20_000; i++) counter.spend();
    expect(counter.used).toBe(20_000);
  });
});

describe("rotate", () => {
  it("returns a permutation containing every input exactly once, starting at offset % length", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(rotate(items, 2)).toEqual(["c", "d", "e", "a", "b"]);
    expect([...rotate(items, 2)].sort()).toEqual([...items].sort());
  });

  it("wraps the offset via modulo for an offset >= length", () => {
    const items = ["a", "b", "c"];
    expect(rotate(items, 3)).toEqual(items); // 3 % 3 === 0
    expect(rotate(items, 4)).toEqual(rotate(items, 1));
  });

  it("handles an empty array", () => {
    expect(rotate([], 0)).toEqual([]);
    expect(rotate([], 5)).toEqual([]);
  });

  it("handles a single-element array for any offset", () => {
    expect(rotate(["only"], 0)).toEqual(["only"]);
    expect(rotate(["only"], 1)).toEqual(["only"]);
    expect(rotate(["only"], 99)).toEqual(["only"]);
  });
});

describe("sortEventKeys", () => {
  it("produces the same deterministic total order regardless of input order", () => {
    const shuffledA = ["2026casj", "2026azfg", "2026miket", "2026caph"];
    const shuffledB = ["2026miket", "2026caph", "2026casj", "2026azfg"];
    const sortedA = sortEventKeys(shuffledA);
    const sortedB = sortEventKeys(shuffledB);
    expect(sortedA).toEqual(sortedB);
    expect(sortedA).toEqual(["2026azfg", "2026caph", "2026casj", "2026miket"]);
  });
});

describe("no-starvation property", () => {
  const events = Array.from({ length: 40 }, (_, i) => `event${String(i).padStart(2, "0")}`);
  // An abstract early stop, NOT a subrequest cap (there is no cap any more):
  // whatever makes a tick stop before the tail, the rotation is what stops the
  // tail from being permanently omitted rather than merely delayed.
  const PER_TICK_CAP = 6;
  const EXPECTED_TICKS = Math.ceil(events.length / PER_TICK_CAP);

  it("visits every event within ceil(n/k) ticks when the offset advances by the number processed", () => {
    const sorted = sortEventKeys(events);
    let offset = 0;
    const visited = new Set<string>();

    for (let tick = 0; tick < EXPECTED_TICKS; tick++) {
      const rotated = rotate(sorted, offset);
      const processed = rotated.slice(0, PER_TICK_CAP);
      for (const eventKey of processed) visited.add(eventKey);
      offset += processed.length;
    }

    expect(visited.size).toBe(events.length);
    for (const eventKey of sorted) expect(visited.has(eventKey)).toBe(true);
  });

  it("COUNTERFACTUAL: pinning the offset at 0 every tick never reaches events past the per-tick cap, proving rotation is not optional", () => {
    const sorted = sortEventKeys(events);
    const visited = new Set<string>();

    for (let tick = 0; tick < EXPECTED_TICKS; tick++) {
      const rotated = rotate(sorted, 0); // offset never advances
      const processed = rotated.slice(0, PER_TICK_CAP);
      for (const eventKey of processed) visited.add(eventKey);
    }

    expect(visited.size).toBe(PER_TICK_CAP); // only the front-of-list events, ever
    for (const eventKey of sorted.slice(PER_TICK_CAP)) {
      expect(visited.has(eventKey)).toBe(false);
    }
  });
});
