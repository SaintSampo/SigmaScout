/**
 * Small pure helpers shared by the surviving measurement scripts
 * (`measureMatchBandCoverage.ts`).
 *
 * Relocated verbatim by quick task 260913-it4 from the measurement script of
 * the retired per-robot consistency accumulator, which was deleted with it.
 */

/**
 * Splits rows into `count` equal-population buckets by `key`, ascending.
 *
 * Equal-population rather than equal-width deliberately: per-robot spread
 * figures are right-skewed across a season's teams, so equal-width buckets
 * would leave the top ones nearly empty and report calibration from a handful
 * of rows.
 */
export function equalCountBuckets<T>(rows: readonly T[], key: (row: T) => number, count: number): T[][] {
  if (rows.length === 0 || count < 1) return [];
  const sorted = [...rows].sort((a, b) => key(a) - key(b));
  const buckets: T[][] = [];
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * sorted.length) / count);
    const end = Math.floor(((b + 1) * sorted.length) / count);
    if (end > start) buckets.push(sorted.slice(start, end));
  }
  return buckets;
}

/** Parses a season spec such as `2016-2019,2022-2026` into a sorted, de-duplicated list. */
export function parseSeasons(spec: string): number[] {
  const seasons = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && Number.isFinite(range[0]!) && Number.isFinite(range[1]!)) {
      for (let s = range[0]!; s <= range[1]!; s++) seasons.add(s);
    } else if (Number.isFinite(range[0]!)) {
      seasons.add(range[0]!);
    }
  }
  return [...seasons].sort((a, b) => a - b);
}
