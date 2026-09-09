/**
 * The GUARDS that make a holdout number attributable and a holdout season
 * unspendable by accident (quick task 260909-03b, P3 part 2).
 *
 * `assertSealed` takes an injectable command runner precisely so these cases
 * can be exercised without dirtying the real working tree — a test that had to
 * `git rm` a file to prove the refusal fires would be its own hazard.
 */
import { describe, expect, it } from "vitest";
import { meanAccuracyDelta, meanBrierDelta, resolveYears, type Paired } from "./holdout.js";
import { assertSealed, SEALED_CODE_PATHS, type CommandRunner } from "./sealedPaths.js";

/** A runner where every path is clean and every blob resolves. */
function cleanRunner(overrides: Record<string, string> = {}): CommandRunner {
  return (file, args) => {
    expect(file).toBe("git");
    const a = [...args];
    if (a[0] === "rev-parse" && a[1] === "--short") return "abc1234\n";
    if (a[0] === "status") {
      const path = a[a.length - 1]!;
      return overrides[`status:${path}`] ?? "";
    }
    if (a[0] === "rev-parse" && a[1]?.startsWith("HEAD:") === true) {
      const path = a[1].slice("HEAD:".length);
      if (overrides[`missing:${path}`] !== undefined) throw new Error("fatal: not a valid object");
      return `blob-${path}\n`;
    }
    throw new Error(`unexpected git invocation: ${a.join(" ")}`);
  };
}

describe("assertSealed", () => {
  it("reports a per-path blob sha for every sealed path", () => {
    const result = assertSealed(SEALED_CODE_PATHS, cleanRunner());
    expect(result.head).toBe("abc1234");
    expect(result.paths.map((p) => p.path)).toEqual([...SEALED_CODE_PATHS]);
    for (const p of result.paths) expect(p.blob).toBe(`blob-${p.path}`);
  });

  it("covers the model and the shipped port, not just the parameter file (F-15)", () => {
    // The whole point of the rewrite: model.ts changed twice after the sealed
    // holdout ran, unchecked, because the seal only looked at the params.
    expect(SEALED_CODE_PATHS).toContain("packages/bpr/model.ts");
    expect(SEALED_CODE_PATHS).toContain("packages/core/algorithms/bpr.ts");
    expect(SEALED_CODE_PATHS).toContain("packages/bpr/data.ts");
    expect(SEALED_CODE_PATHS).toContain("packages/bpr/evaluate.ts");
  });

  it("refuses when ANY sealed path is dirty, naming the offending path", () => {
    const runner = cleanRunner({ "status:packages/bpr/model.ts": " M packages/bpr/model.ts" });
    expect(() => assertSealed(SEALED_CODE_PATHS, runner)).toThrow(
      /packages\/bpr\/model\.ts has uncommitted changes/,
    );
  });

  it("refuses when a sealed path is untracked at HEAD", () => {
    const runner = cleanRunner({ "missing:packages/bpr/cli.ts": "1" });
    expect(() => assertSealed(SEALED_CODE_PATHS, runner)).toThrow(/not tracked at HEAD/);
  });

  it("refuses outside a git repository", () => {
    const runner: CommandRunner = () => {
      throw new Error("not a git repository");
    };
    expect(() => assertSealed(SEALED_CODE_PATHS, runner)).toThrow(/not a git repository/);
  });

  it("seals a named parameter file alongside the code paths", () => {
    const paths = [...SEALED_CODE_PATHS, "packages/bpr/frozen-params.json"];
    const result = assertSealed(paths, cleanRunner());
    expect(result.paths.map((p) => p.path)).toContain("packages/bpr/frozen-params.json");
  });
});

describe("resolveYears", () => {
  it("rejects a design year, pointing the caller at score.ts", () => {
    expect(() => resolveYears("2022")).toThrow(/2022 is not a holdout year/);
    expect(() => resolveYears("2022")).toThrow(/score\.ts/);
  });

  it("rejects a year that is in neither era", () => {
    expect(() => resolveYears("2027")).toThrow(/2027 is not a holdout year/);
  });

  it("binds the halt-after year to the single named season, so no later season is stepped", () => {
    const { years, stopAfterYear } = resolveYears("2023");
    expect([...years]).toEqual([2023]);
    // The structural guarantee: runEval breaks out of the replay once a match's
    // year exceeds this, so 2024-2026 are never stepped at all.
    expect(stopAfterYear).toBe(2023);
  });

  it("binds the halt-after year to the MAXIMUM of several named seasons", () => {
    const { years, stopAfterYear } = resolveYears("2023,2024");
    expect([...years].sort()).toEqual([2023, 2024]);
    expect(stopAfterYear).toBe(2024);
  });

  it("defaults to the whole holdout set, halting after its last season", () => {
    const { years, stopAfterYear } = resolveYears(undefined);
    expect([...years].sort()).toEqual([2023, 2024, 2025, 2026]);
    expect(stopAfterYear).toBe(2026);
  });

  it("rejects a malformed year rather than silently clipping it", () => {
    expect(() => resolveYears("twenty-23")).toThrow(/bad year/);
  });
});

/**
 * The two PAIRED statistics, pinned on a hand-computed fixture.
 *
 * These are exported so a design-era contrast (quick task 260909-25z) and a
 * holdout run compute the SAME quantity with the SAME code. That reuse is only
 * worth anything if the quantity itself is pinned, so these cases fix what the
 * numerator and denominator of each statistic actually contain — in particular
 * the asymmetry that a TIE leaves the accuracy denominator entirely (there is
 * no winner to have predicted) while still sitting in the Brier mean's
 * denominator against a target of 0.5.
 */
describe("paired statistics", () => {
  const unit = (over: Partial<Paired>): Paired => ({
    eventKey: "2019test",
    matchKey: "2019test_qm1",
    season: 2019,
    compLevel: "qm",
    eventType: 0,
    actualWinner: "red",
    pIncumbent: 0.5,
    pCandidate: 0.5,
    ...over,
  });

  it("credits +1 to the accuracy numerator when the candidate is right and the incumbent wrong", () => {
    const units = [unit({ actualWinner: "red", pIncumbent: 0.2, pCandidate: 0.8 })];
    // One unit in the denominator, numerator +1 => exactly +1.
    expect(meanAccuracyDelta(units)).toBe(1);
  });

  it("credits -1 when the orientation is the other way round", () => {
    const units = [unit({ actualWinner: "red", pIncumbent: 0.8, pCandidate: 0.2 })];
    expect(meanAccuracyDelta(units)).toBe(-1);
  });

  it("contributes 0 when both models call the match the same way", () => {
    const units = [
      unit({ actualWinner: "red", pIncumbent: 0.8, pCandidate: 0.9 }),
      unit({ matchKey: "m2", actualWinner: "blue", pIncumbent: 0.4, pCandidate: 0.1 }),
    ];
    expect(meanAccuracyDelta(units)).toBe(0);
  });

  it("excludes a TIE from the accuracy denominator entirely", () => {
    const decided = unit({ actualWinner: "red", pIncumbent: 0.2, pCandidate: 0.8 });
    const tie = unit({ matchKey: "m2", actualWinner: "tie", pIncumbent: 0.1, pCandidate: 0.9 });
    // Two units, but the tie is not in the denominator: +1/1, not +1/2. If the
    // tie were counted the answer would be 0.5.
    expect(meanAccuracyDelta([decided, tie])).toBe(1);
  });

  it("still counts a TIE in the Brier mean's denominator, against a 0.5 target", () => {
    const tie = unit({ actualWinner: "tie", pIncumbent: 0.5, pCandidate: 1 });
    // (1 - 0.5)^2 - (0.5 - 0.5)^2 = 0.25, over a denominator of 1.
    expect(meanBrierDelta([tie])).toBeCloseTo(0.25, 12);
    // And over two units the denominator is 2 - the tie is NOT dropped.
    const clean = unit({ matchKey: "m2", actualWinner: "red", pIncumbent: 1, pCandidate: 1 });
    expect(meanBrierDelta([tie, clean])).toBeCloseTo(0.125, 12);
  });

  it("scores a 0.5 no-call as a miss rather than half credit (D-Q3)", () => {
    // Incumbent abstains at exactly 0.5, candidate calls it right: +1, because
    // accuracyCall returns false (not null) for a no-call on a decided match.
    const units = [unit({ actualWinner: "red", pIncumbent: 0.5, pCandidate: 0.8 })];
    expect(meanAccuracyDelta(units)).toBe(1);
  });

  it("flips the sign of BOTH deltas when incumbent and candidate are reversed, and nothing else", () => {
    const forward: Paired[] = [
      unit({ actualWinner: "red", pIncumbent: 0.2, pCandidate: 0.8 }),
      unit({ matchKey: "m2", actualWinner: "blue", pIncumbent: 0.55, pCandidate: 0.3 }),
      unit({ matchKey: "m3", actualWinner: "tie", pIncumbent: 0.4, pCandidate: 0.7 }),
    ];
    const reversed = forward.map((u) => ({
      ...u,
      pIncumbent: u.pCandidate,
      pCandidate: u.pIncumbent,
    }));
    expect(meanAccuracyDelta(reversed)).toBeCloseTo(-meanAccuracyDelta(forward), 12);
    expect(meanBrierDelta(reversed)).toBeCloseTo(-meanBrierDelta(forward), 12);
    // Non-trivial: the forward deltas are not zero, so the flip is a real test.
    expect(meanAccuracyDelta(forward)).not.toBe(0);
    expect(meanBrierDelta(forward)).not.toBe(0);
  });

  it("returns 0 rather than NaN when every unit is a tie", () => {
    const ties = [unit({ actualWinner: "tie", pIncumbent: 0.2, pCandidate: 0.8 })];
    expect(meanAccuracyDelta(ties)).toBe(0);
    expect(meanBrierDelta([])).toBe(0);
  });
});
