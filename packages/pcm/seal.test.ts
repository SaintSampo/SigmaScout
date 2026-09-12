/**
 * THE SEAL's gate for PCM.
 *
 * DANGER, read before adding a test here: `runHoldout` with a runner that
 * PASSES every check will actually score 2023+2024 and spend the holdout. Every
 * test in this file therefore injects a runner that REFUSES, and asserts on the
 * refusal. There is deliberately no "happy path" test of `runHoldout`, because a
 * happy path here is indistinguishable from spending the thing the seal exists
 * to protect.
 *
 * Three groups of assertions, following `packages/gbr/seal.test.ts`:
 *
 *  1. The year-set pins. Written as EQUALITY against literal lists, never as an
 *     iteration over the exported set -- a test that iterates whatever the
 *     constant happens to contain passes no matter what someone puts in it,
 *     which is the exact shape that has let a season silently slip through in
 *     this repo before.
 *  2. A comment-stripped source scan proving the holdout is unreachable from the
 *     model, the loader and the evaluator, plus a self-test proving the scan
 *     actually bites (against inline fixtures, so no red state is committed).
 *  3. The refusal behaviour of `runHoldout` itself.
 *
 * None of this needs the corpus, and none of it sits behind an `existsSync`
 * guard -- a machine without `data/corpus.sqlite` must not silently disable the
 * only thing protecting the holdout.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_YEARS, HOLDOUT_YEARS, LAST_DESIGN_YEAR, RESERVED_YEARS } from "./cli.js";
import { runHoldout, SEALED_CODE_PATHS } from "./holdout.js";

const PCM_DIR = fileURLToPath(new URL(".", import.meta.url));

const HOLDOUT_TOKEN = "HOLDOUT_YEARS";
const SEAL_BREAK_TOKEN = "break-seal";

/** Strips block and line comments before searching, so a doc comment that names a token does not trip the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function tokensPresent(src: string): string[] {
  const stripped = stripComments(src);
  const found: string[] = [];
  if (stripped.includes(HOLDOUT_TOKEN)) found.push(HOLDOUT_TOKEN);
  if (stripped.includes(SEAL_BREAK_TOKEN)) found.push(SEAL_BREAK_TOKEN);
  return found;
}

function readPcm(name: string): string {
  return readFileSync(`${PCM_DIR}${name}`, "utf8");
}

// --- 1. year-set pins -------------------------------------------------------

describe("THE SEAL - year sets", () => {
  it("DESIGN_YEARS matches the literal design-year list exactly", () => {
    expect(DESIGN_YEARS).toEqual([2016, 2017, 2018, 2019, 2020, 2022]);
  });

  it("HOLDOUT_YEARS matches the literal holdout-year list exactly", () => {
    expect(HOLDOUT_YEARS).toEqual([2023, 2024]);
  });

  it("RESERVED_YEARS matches the literal reserved-year list exactly", () => {
    expect(RESERVED_YEARS).toEqual([2025, 2026]);
  });

  it("the three year sets are pairwise disjoint", () => {
    const design = new Set(DESIGN_YEARS);
    const holdout = new Set(HOLDOUT_YEARS);
    expect(HOLDOUT_YEARS.filter((y) => design.has(y))).toEqual([]);
    expect(RESERVED_YEARS.filter((y) => design.has(y))).toEqual([]);
    expect(RESERVED_YEARS.filter((y) => holdout.has(y))).toEqual([]);
  });

  it("LAST_DESIGN_YEAR is below every holdout and reserved year", () => {
    for (const y of [...HOLDOUT_YEARS, ...RESERVED_YEARS]) {
      expect(LAST_DESIGN_YEAR).toBeLessThan(y);
    }
  });

  it("no reserved year is inside the holdout the sealed runner will score", () => {
    // The single-shot run binds stopAfterYear to max(HOLDOUT_YEARS), so this
    // inequality is what keeps 2025/2026 from ever being stepped.
    const lastHoldout = Math.max(...HOLDOUT_YEARS);
    for (const y of RESERVED_YEARS) expect(y).toBeGreaterThan(lastHoldout);
  });
});

// --- 2. source scan ---------------------------------------------------------

describe("THE SEAL - the holdout is unreachable from the model path", () => {
  for (const file of ["model.ts", "data.ts", "evaluate.ts"]) {
    it(`${file} names neither ${HOLDOUT_TOKEN} nor ${SEAL_BREAK_TOKEN} outside comments`, () => {
      expect(tokensPresent(readPcm(file))).toEqual([]);
    });
  }

  it("the scan bites: a fixture that uses the tokens in CODE is caught", () => {
    const bad = `const years = HOLDOUT_YEARS;\nif (argv.includes("--break-seal")) run();`;
    expect(tokensPresent(bad).sort()).toEqual([HOLDOUT_TOKEN, SEAL_BREAK_TOKEN].sort());
  });

  it("the scan strips comments: a fixture that only MENTIONS the tokens passes", () => {
    const ok = `/* HOLDOUT_YEARS and --break-seal live in cli.ts */\n// see --break-seal\nconst x = 1;`;
    expect(tokensPresent(ok)).toEqual([]);
  });

  it("the seal covers every file that can change what PCM predicts", () => {
    // A new file in the model path must be added to SEALED_CODE_PATHS, or a
    // holdout result stops being attributable to a specific revision.
    for (const p of [
      "packages/pcm/model.ts",
      "packages/pcm/data.ts",
      "packages/pcm/evaluate.ts",
      "packages/pcm/cli.ts",
      "packages/pcm/holdout.ts",
      "packages/spr/model.ts",
      "packages/spr/data.ts",
      "packages/core/algorithms/breakdown/groups.ts",
    ]) {
      expect(SEALED_CODE_PATHS).toContain(p);
    }
  });
});

// --- 3. refusal behaviour ---------------------------------------------------

describe("THE SEAL - runHoldout refuses", () => {
  /** A runner that would fail the test outright if the seal ever let it run. */
  const forbidden = (): string => {
    throw new Error("runner must not be reached - the refusal should have fired first");
  };

  it("refuses without --break-seal, before touching git at all", () => {
    expect(() => runHoldout({ argv: [], run: forbidden })).toThrow(/--break-seal/);
  });

  it("refuses when the frozen parameter file has uncommitted changes", () => {
    const dirty = (_file: string, args: readonly string[]): string => {
      if (args[0] === "status") return " M packages/pcm/frozen-params.json";
      return "deadbeef";
    };
    expect(() => runHoldout({ argv: ["--break-seal"], run: dirty })).toThrow(
      /uncommitted changes/,
    );
  });

  it("refuses when a sealed code path has uncommitted changes", () => {
    const dirtyModel = (_file: string, args: readonly string[]): string => {
      if (args[0] === "status") {
        const path = args.at(-1) ?? "";
        return path.endsWith("frozen-params.json") ? "" : ` M ${path}`;
      }
      return "deadbeef";
    };
    expect(() => runHoldout({ argv: ["--break-seal"], run: dirtyModel })).toThrow(
      /uncommitted changes/,
    );
  });

  it("refuses when a sealed code path is not tracked at HEAD", () => {
    const untracked = (_file: string, args: readonly string[]): string => {
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse" && String(args[1]).startsWith("HEAD:")) {
        throw new Error("fatal: path does not exist in HEAD");
      }
      return "deadbeef";
    };
    expect(() => runHoldout({ argv: ["--break-seal"], run: untracked })).toThrow(
      /not tracked at HEAD/,
    );
  });
});

// --- 4. the CLI cannot reach the holdout ------------------------------------

describe("THE SEAL - cli.ts refuses holdout years", () => {
  it("--years rejects any year past the design era", async () => {
    const cli = await import("./cli.js");
    // `parseYears` is internal; the guard is asserted through the exported
    // bound it enforces, which is the thing a future edit could actually break.
    expect(cli.LAST_DESIGN_YEAR).toBe(2022);
    expect(Math.min(...cli.HOLDOUT_YEARS)).toBeGreaterThan(cli.LAST_DESIGN_YEAR);
  });

  it("cli.ts source rejects years past LAST_DESIGN_YEAR", () => {
    const src = stripComments(readPcm("cli.ts"));
    expect(src).toMatch(/y\s*>\s*LAST_DESIGN_YEAR/);
  });
});
