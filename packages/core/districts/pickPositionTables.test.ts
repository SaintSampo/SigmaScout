import { describe, expect, it } from "vitest";
import { PICK_POSITION_COUNTS } from "./pickPositionTables.js";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe("PICK_POSITION_COUNTS, the weighted pick draft's tables (quick task 261014-ol6)", () => {
  it("is walk forward: every season's table ends the season before it", () => {
    for (const [season, table] of Object.entries(PICK_POSITION_COUNTS)) {
      expect(table.seasonsTo).toBe(Number(season) - 1);
      expect(table.seasonsFrom).toBe(2016);
    }
  });

  it("holds the turns quick task 261014-mji scored, season by season", () => {
    // Turn counts and position 1 shares as printed by the measurement (261014-mji-SUMMARY.md).
    const measured: Record<number, [number, number, number]> = {
      2023: [4016, 29.5, 23.0],
      2024: [4896, 31.3, 23.6],
      2025: [5808, 32.3, 24.5],
      2026: [6768, 33.4, 24.8],
    };
    for (const [season, [turns, firstShare, secondShare]] of Object.entries(measured)) {
      const table = PICK_POSITION_COUNTS[Number(season)]!;
      expect(sum(table.firstPick)).toBe(turns);
      expect(sum(table.secondPick)).toBe(turns);
      expect(Number(((100 * table.firstPick[0]!) / turns).toFixed(1))).toBe(firstShare);
      expect(Number(((100 * table.secondPick[0]!) / turns).toFixed(1))).toBe(secondShare);
    }
  });

  it("covers every season from 2023 to the one after the newest draft, and only adds turns as seasons pass", () => {
    const seasons = Object.keys(PICK_POSITION_COUNTS).map(Number).sort((a, b) => a - b);
    expect(seasons[0]).toBe(2023);
    expect(seasons).toContain(2027);
    for (let i = 1; i < seasons.length; i++) {
      const before = PICK_POSITION_COUNTS[seasons[i - 1]!]!;
      const after = PICK_POSITION_COUNTS[seasons[i]!]!;
      expect(sum(after.firstPick)).toBeGreaterThan(sum(before.firstPick));
      before.firstPick.forEach((count, k) => expect(after.firstPick[k]!).toBeGreaterThanOrEqual(count));
      before.secondPick.forEach((count, k) => expect(after.secondPick[k]!).toBeGreaterThanOrEqual(count));
    }
  });

  it("stores whole counts with a real pick at position 1", () => {
    for (const table of Object.values(PICK_POSITION_COUNTS)) {
      for (const counts of [table.firstPick, table.secondPick]) {
        expect(counts.every((c) => Number.isInteger(c) && c >= 0)).toBe(true);
        expect(counts[0]!).toBeGreaterThan(0);
      }
    }
  });
});
