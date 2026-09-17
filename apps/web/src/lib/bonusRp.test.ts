import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RP_RULE_MODULES } from "../../../../packages/core/rankingPoints/rules.js";
import {
  BONUS_RP_BY_SEASON,
  bonusDotLabel,
  BONUS_DOT_TOSSUP_MIN,
  BONUS_DOT_TOSSUP_MAX,
  bonusDotTier,
  type BonusDotTier,
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
 * A predicted dot renders one of three categorical tiers rather than a
 * continuous fill: `unlikely` under one third, `tossup` from one third to
 * two thirds inclusive, `likely` above two thirds.
 */
describe("bonusDotTier", () => {
  it.each([
    [0, "unlikely"],
    [0.2, "unlikely"],
    [BONUS_DOT_TOSSUP_MIN - 1e-9, "unlikely"],
    [BONUS_DOT_TOSSUP_MIN, "tossup"],
    [0.5, "tossup"],
    [BONUS_DOT_TOSSUP_MAX, "tossup"],
    [BONUS_DOT_TOSSUP_MAX + 1e-9, "likely"],
    [0.9, "likely"],
    [1, "likely"],
  ] as const)("maps %s to %s", (probability, tier) => {
    expect(bonusDotTier(probability)).toBe(tier);
  });

  it("returns undefined for an absent or non-finite probability", () => {
    expect(bonusDotTier(undefined)).toBeUndefined();
    expect(bonusDotTier(Number.NaN)).toBeUndefined();
    expect(bonusDotTier(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("pins the cutoff literals so a silently retuned boundary fails here", () => {
    expect(BONUS_DOT_TOSSUP_MIN).toBe(1 / 3);
    expect(BONUS_DOT_TOSSUP_MAX).toBe(2 / 3);
  });

  it("theme.css carries a rule for every tier x side combination BonusRpDots can emit", () => {
    // jsdom applies no CSS, so the shipped CSS TEXT is the source of truth.
    // A renamed class here fails loudly instead of rendering an invisible dot.
    const themePath = findUpward("apps/web/src/styles/theme.css") ?? findUpward("src/styles/theme.css");
    expect(themePath, "could not locate theme.css").toBeDefined();
    const css = readFileSync(themePath!, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    const tiers: readonly BonusDotTier[] = ["unlikely", "tossup", "likely"];
    for (const tier of tiers) {
      for (const side of ["red", "blue"] as const) {
        const selector = `.bonus-dot--predicted.bonus-dot--tier-${tier}.bonus-dot--${side}`;
        expect(css.includes(selector), `expected theme.css to contain a rule for ${selector}`).toBe(true);
      }
    }
  });

  /** Reads the theme stylesheet, comments stripped, as CSS text (no CSSOM in jsdom). */
  function readThemeCss(): string {
    const themePath = findUpward("apps/web/src/styles/theme.css") ?? findUpward("src/styles/theme.css");
    expect(themePath, "could not locate theme.css").toBeDefined();
    return readFileSync(themePath!, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  }

  /**
   * Extracts a selector's `{ ... }` declaration block. Requires the selector be immediately
   * followed by whitespace-then-brace, not by another `.class` — otherwise the bare
   * `.bonus-dot--missed` search below would match inside the compound
   * `.bonus-dot--missed.bonus-dot--red` rule instead of its own standalone rule.
   */
  function declarationBlock(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}(?!\\.[\\w-])\\s*\\{`);
    const match = pattern.exec(css);
    expect(match, `expected theme.css to contain a standalone rule for ${selector}`).toBeTruthy();
    const openBrace = match!.index + match![0].length - 1;
    const closeBrace = css.indexOf("}", openBrace);
    return css.slice(openBrace + 1, closeBrace);
  }

  it("theme.css carries a rule for the actual-missed pip, 6px with 4px side margins", () => {
    const css = readThemeCss();
    const block = declarationBlock(css, ".bonus-dot--missed");
    expect(block).toMatch(/width:\s*6px/);
    expect(block).toMatch(/height:\s*6px/);
    expect(block).toMatch(/margin:\s*0 4px/);
  });

  it.each(["red", "blue"] as const)("the %s toss-up rule hatches that side's soft tint against the surface", (side) => {
    const css = readThemeCss();
    const selector = `.bonus-dot--predicted.bonus-dot--tier-tossup.bonus-dot--${side}`;
    const block = declarationBlock(css, selector);
    expect(block).toContain("repeating-linear-gradient");
    expect(block).toContain(`--alliance-${side}-soft`);
  });

  it.each(["red", "blue"] as const)("the %s likely rule shares the same ground an actual earned dot of that side uses", (side) => {
    const css = readThemeCss();
    const selector = `.bonus-dot--predicted.bonus-dot--tier-likely.bonus-dot--${side}`;
    const block = declarationBlock(css, selector);
    expect(block).toContain(`--alliance-${side}-soft`);
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

describe("the upstream attribution measurement record stays pinned to the threshold it describes", () => {
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
