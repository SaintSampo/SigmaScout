/**
 * THE SHIPPED WEIGHTED PICK DRAFT: the one place a season's pick position pmf
 * comes from (quick task 261014-ol6).
 *
 * Quick task 261014-mji measured a weighted pick draft against the fixed SPR
 * draft at Quals done, walk forward over 2023 to 2026, and it won on every
 * season (pooled Brier 0.0917 vs 0.1327). Jacob's call on 2026-10-14: SHIP IT,
 * with the 2016 onward walk forward tables. Every simulated draft behind a
 * displayed or published Locks number now draws its picks from the pmf this
 * module returns, set inside the two input builders every caller shares
 * (`buildDistrictEventSimulationInput` in the web app and `bakeDistrictEvent`
 * in the harness), so no caller passes it and no caller can forget it.
 *
 * THE SEASON RULE, in plain words:
 *   - A season uses its own table, which counts drafts from 2016 up to the
 *     season before it.
 *   - A season newer than every table uses the newest table.
 *   - A season older than the oldest table gets no pmf, because every table
 *     holds that season's own drafts. `simulateDistrictEvent` refuses those
 *     seasons anyway (its bracket is registered for 2023 onward).
 *   - No season ever uses a table that holds its own or later drafts;
 *     `PickTableLeakError` guards that against a hand edit.
 *
 * Rerun `scripts/buildPickPositionTables.ts` once a season's drafts are in the
 * corpus, so the next season gets its own table.
 *
 * Pure and browser safe: committed data and arithmetic only, no Node built in.
 */

import { PICK_POSITION_COUNTS, type PickPositionCounts } from "./pickPositionTables.js";
import type { PickPositionPmf } from "./ledgerSimulation.js";

/** Raised when the table chosen for a season holds that season's own (or later) drafts. */
export class PickTableLeakError extends Error {
  constructor(season: number, tableSeason: number, seasonsTo: number) {
    super(
      `pickDraft: season ${String(season)} would read table ${String(tableSeason)}, ` +
        `which counts drafts through ${String(seasonsTo)}; a season may only read drafts before it`
    );
    this.name = "PickTableLeakError";
  }
}

const TABLE_SEASONS: readonly number[] = Object.keys(PICK_POSITION_COUNTS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * The table key a season reads: the greatest key at or below `season`, or
 * `undefined` when `season` is below the oldest key.
 */
export function pickPositionTableSeason(season: number): number | undefined {
  let chosen: number | undefined;
  for (const key of TABLE_SEASONS) {
    if (key <= season) chosen = key;
    else break;
  }
  return chosen;
}

/** Counts over total, the same expression `scripts/buildPickPositionTables.ts` checks against the measurement. */
function roundPmf(counts: readonly number[]): readonly number[] {
  const total = counts.reduce((x, y) => x + y, 0);
  return Object.freeze(counts.map((count) => count / total));
}

const memo = new Map<number, PickPositionPmf>();

/**
 * The season's pick position pmf: its table's two rounds as counts over total,
 * memoised per table and frozen. `undefined` when the season is older than
 * every table.
 */
export function pickPositionPmfForSeason(season: number): PickPositionPmf | undefined {
  const key = pickPositionTableSeason(season);
  if (key === undefined) return undefined;
  const table: PickPositionCounts = PICK_POSITION_COUNTS[key]!;
  if (table.seasonsTo >= season) throw new PickTableLeakError(season, key, table.seasonsTo);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const pmf: PickPositionPmf = Object.freeze({
    firstPick: roundPmf(table.firstPick),
    secondPick: roundPmf(table.secondPick),
  });
  memo.set(key, pmf);
  return pmf;
}
