/**
 * The GUARDS that make a holdout number attributable and a holdout season
 * unspendable by accident (quick task 260909-03b, P3 part 2).
 *
 * `assertSealed` takes an injectable command runner precisely so these cases
 * can be exercised without dirtying the real working tree — a test that had to
 * `git rm` a file to prove the refusal fires would be its own hazard.
 */
import { describe, expect, it } from "vitest";
import { resolveYears } from "./holdout.js";
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
