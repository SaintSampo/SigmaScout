import { describe, expect, it } from "vitest";
import { rotate, sortEventKeys, SubrequestBudget, SUBREQUEST_CAP, SUBREQUEST_RESERVE } from "../src/subrequestBudget.js";

describe("SUBREQUEST_CAP / SUBREQUEST_RESERVE", () => {
  it("SUBREQUEST_CAP is the documented Workers free-plan limit (50)", () => {
    expect(SUBREQUEST_CAP).toBe(50);
  });

  it("a named SUBREQUEST_RESERVE is subtracted from the usable budget", () => {
    const budget = new SubrequestBudget();
    expect(budget.usableCap).toBe(SUBREQUEST_CAP - SUBREQUEST_RESERVE);
    expect(budget.usableCap).toBeLessThan(SUBREQUEST_CAP);
  });
});

describe("SubrequestBudget.tryConsume", () => {
  it("returns true and increments while used + n <= usableCap", () => {
    const budget = new SubrequestBudget(50, 4); // usableCap = 46
    expect(budget.tryConsume(10)).toBe(true);
    expect(budget.used).toBe(10);
    expect(budget.tryConsume(36)).toBe(true);
    expect(budget.used).toBe(46);
  });

  it("returns false WITHOUT incrementing at the boundary", () => {
    const budget = new SubrequestBudget(50, 4); // usableCap = 46
    budget.consume(46);
    expect(budget.tryConsume(1)).toBe(false);
    expect(budget.used).toBe(46); // unchanged
  });

  it("boundary triple: at usableCap-1, a 1-unit consume succeeds and a 2-unit consume fails, neither leaving used above usableCap", () => {
    const usableCap = SUBREQUEST_CAP - SUBREQUEST_RESERVE;

    const succeeds = new SubrequestBudget();
    succeeds.consume(usableCap - 1);
    expect(succeeds.tryConsume(1)).toBe(true);
    expect(succeeds.used).toBe(usableCap);
    expect(succeeds.used).toBeLessThanOrEqual(succeeds.usableCap);

    const fails = new SubrequestBudget();
    fails.consume(usableCap - 1);
    expect(fails.tryConsume(2)).toBe(false);
    expect(fails.used).toBe(usableCap - 1); // unchanged by the failed attempt
    expect(fails.used).toBeLessThanOrEqual(fails.usableCap);
  });

  it("remaining is never negative after any sequence of tryConsume calls, including repeated over-budget attempts", () => {
    const budget = new SubrequestBudget(50, 4);
    for (let i = 0; i < 100; i++) {
      budget.tryConsume(7); // most of these fail once near the cap
      expect(budget.remaining).toBeGreaterThanOrEqual(0);
    }
    expect(budget.remaining).toBe(budget.usableCap - budget.used);
  });
});

describe("SubrequestBudget.consume", () => {
  it("throws when consuming would exceed the usable budget", () => {
    const budget = new SubrequestBudget(50, 4);
    budget.consume(46);
    expect(() => budget.consume(1)).toThrow(/exceed the usable budget/);
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

describe("no-starvation property (D-15, T-04-29)", () => {
  const events = Array.from({ length: 40 }, (_, i) => `event${String(i).padStart(2, "0")}`);
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
