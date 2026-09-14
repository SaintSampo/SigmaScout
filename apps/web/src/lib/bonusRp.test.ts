import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RP_RULE_MODULES } from "../../../../packages/core/rankingPoints/rules.js";
import {
  BONUS_RP_BY_SEASON,
  bonusDotLabel,
  BONUS_DOT_INNER_PX,
  bonusDotFillPx,
  bonusRpForSeason,
  bonusStatesFromFlags,
} from "./bonusRp.js";

/** Walks up from the working directory to a repo-relative file; under jsdom `import.meta.url` is not a file: URL. */
function findUpward(relative: string): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  return undefined;
}

/**
 * `bonusRp.ts` copies each season's BONUS_NAMES rather than importing the
 * rule modules into the client bundle. This pins the copy: a season added,
 * removed or renamed in core fails here instead of rendering wrong letters.
 */
describe("bonusRp table matches the core RP rule modules", () => {
  it("covers exactly the seasons core registers", () => {
    expect(Object.keys(BONUS_RP_BY_SEASON).sort()).toEqual(Object.keys(RP_RULE_MODULES).sort());
  });

  for (const [season, module] of Object.entries(RP_RULE_MODULES)) {
    it(`${season}: bonus keys and order match core exactly`, () => {
      expect(bonusRpForSeason(Number(season)).map((b) => b.key)).toEqual([...module.bonusNames]);
    });
  }

  it("every letter is a single character, unique within its own season", () => {
    for (const [season, bonuses] of Object.entries(BONUS_RP_BY_SEASON)) {
      const letters = bonuses.map((b) => b.letter);
      expect(letters.every((l) => l.length === 1), `${season} letters must be single characters`).toBe(true);
      expect(new Set(letters).size, `${season} letters must be unique`).toBe(letters.length);
    }
  });

  it("returns an empty list for an unregistered season rather than throwing", () => {
    expect(bonusRpForSeason(1999)).toEqual([]);
  });
});

/**
 * A predicted dot fills from the bottom to its probability, no threshold:
 * `round(p * innerPx)` clamped to `[1, innerPx - 1]`, so a prediction never
 * draws empty or full, matching `predictionPercent`'s 1-99% policy.
 */
describe("bonusDotFillPx", () => {
  it.each([
    [0, 1],
    [0.02, 1],
    [0.5, 6],
    [0.72, 9],
    [0.99, 11],
    [1, 11],
  ])("fills %s to %s px of a 12px interior", (probability, px) => {
    expect(bonusDotFillPx(probability, 12)).toBe(px);
  });

  it("returns undefined (unknown) for an absent or non-finite probability", () => {
    expect(bonusDotFillPx(undefined, 12)).toBeUndefined();
    expect(bonusDotFillPx(Number.NaN, 12)).toBeUndefined();
    expect(bonusDotFillPx(Number.POSITIVE_INFINITY, 12)).toBeUndefined();
  });

  it("always returns a whole number of pixels", () => {
    for (let i = 0; i <= 100; i++) {
      const px = bonusDotFillPx(i / 100, BONUS_DOT_INNER_PX);
      expect(Number.isInteger(px)).toBe(true);
    }
  });

  it("BONUS_DOT_INNER_PX equals .bonus-dot's width minus twice its border in theme.css", () => {
    // jsdom applies no CSS, so the shipped CSS TEXT is the source of truth.
    // If the dot's size or border changes, this fails instead of the fill
    // silently overshooting or falling short of the dot's interior.
    const themePath = findUpward("apps/web/src/styles/theme.css") ?? findUpward("src/styles/theme.css");
    expect(themePath, "could not locate theme.css").toBeDefined();
    const css = readFileSync(themePath!, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const body = /(?:^|\})\s*\.bonus-dot\s*\{([^{}]*)\}/.exec(css)?.[1];
    expect(body, "expected a bare .bonus-dot rule").toBeDefined();
    const width = Number(/(?:^|;)\s*width:\s*(\d+)px/.exec(body!)?.[1]);
    const border = Number(/(?:^|;)\s*border:\s*(\d+)px/.exec(body!)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(border).toBeGreaterThan(0);
    expect(BONUS_DOT_INNER_PX).toBe(width - 2 * border);
  });
});

describe("bonusStatesFromFlags", () => {
  it("maps true to earned and false to missed", () => {
    expect(bonusStatesFromFlags([true, false], 2)).toEqual(["earned", "missed"]);
  });

  it("maps a null flag array to every position unknown — asserted against null specifically, not undefined", () => {
    expect(bonusStatesFromFlags(null, 3)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("maps an undefined flag array to every position unknown", () => {
    expect(bonusStatesFromFlags(undefined, 3)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("maps the missing trailing positions of a shorter-than-count array to unknown", () => {
    expect(bonusStatesFromFlags([true], 3)).toEqual(["earned", "unknown", "unknown"]);
  });

  it("always returns exactly count entries regardless of input length", () => {
    expect(bonusStatesFromFlags([true, false, true], 2)).toHaveLength(2);
  });
});

describe("bonusDotLabel", () => {
  it("returns 'no data published' text for an unknown state, regardless of kind", () => {
    expect(bonusDotLabel("Melody", "unknown", "predicted")).toContain("no data published");
    expect(bonusDotLabel("Melody", "unknown", "actual")).toContain("no data published");
  });

  it("carries the probability as a whole-number percentage for a predicted dot with a defined probability", () => {
    const label = bonusDotLabel("Melody", "earned", "predicted", 0.72);
    expect(label).toContain("72%");
  });

  it("rounds the predicted percentage to the nearest whole number", () => {
    expect(bonusDotLabel("Melody", "earned", "predicted", 0.505)).toContain("51%");
  });

  it("returns distinct text for an actual earned dot", () => {
    expect(bonusDotLabel("Melody", "earned", "actual")).toContain("earned");
    expect(bonusDotLabel("Melody", "earned", "actual")).not.toContain("not earned");
  });

  it("returns distinct text for an actual missed dot", () => {
    expect(bonusDotLabel("Melody", "missed", "actual")).toContain("not earned");
  });

  it("returns distinct text for a predicted dot with no probability, carrying the state word", () => {
    const earnedLabel = bonusDotLabel("Melody", "earned", "predicted");
    const missedLabel = bonusDotLabel("Melody", "missed", "predicted");
    expect(earnedLabel).not.toBe(missedLabel);
    expect(earnedLabel).toContain("earned");
    expect(missedLabel).toContain("missed");
  });

  it("every label starts with the bonus label and a colon", () => {
    expect(bonusDotLabel("Melody", "earned", "actual").startsWith("Melody:")).toBe(true);
  });
});

describe("F10's upstream measurement record stays pinned to the threshold it describes", () => {
  it("the committed attribution record's dotThreshold equals the literal 0.5", () => {
    // The attribution record is a frozen measurement of the earlier solid dot
    // (drawn at 50% or more), so its dotThreshold is pinned as a literal 0.5;
    // it mirrors no live constant.
    const RECORD_RELATIVE = "data/baselines/rp-attribution-2026-09.json";
    const recordPath = findUpward(RECORD_RELATIVE);
    expect(recordPath, `could not locate ${RECORD_RELATIVE} above ${process.cwd()}`).toBeDefined();
    const record = JSON.parse(readFileSync(recordPath!, "utf8")) as { dotThreshold: number };
    expect(record.dotThreshold).toBe(0.5);
  });
});
