/**
 * The one strict season-list grammar shared by the publish CLIs: a single
 * year (`"2026"`), a range (`"2022-2026"`), or a comma-separated list of
 * these (`"2019,2020,2022-2026"`). The result is ascending and de-duplicated.
 * Every error message names `flagName`, so each CLI reports its own flag.
 *
 * Dependency-free on purpose, so a small script can import it without pulling
 * in `publish.ts`. The lenient `parseSeasons` helpers in `scripts/` have
 * different semantics and are deliberately not built on this.
 */
export function parseSeasonSpec(spec: string, flagName: string): number[] {
  const terms = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (terms.length === 0) {
    throw new Error(`${flagName} must not be empty, got "${spec}"`);
  }

  const seasons = new Set<number>();
  for (const term of terms) {
    const singleMatch = /^(\d{4})$/.exec(term);
    if (singleMatch) {
      seasons.add(Number.parseInt(singleMatch[1]!, 10));
      continue;
    }
    const rangeMatch = /^(\d{4})-(\d{4})$/.exec(term);
    if (!rangeMatch) {
      throw new Error(
        `${flagName} terms must each be a single year like "2026" or a range like "2022-2026" (or a comma-separated list of these, e.g. "2019,2020,2022-2026"), got invalid term "${term}" in "${spec}"`
      );
    }
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (end < start) {
      throw new Error(`${flagName} range end (${end}) must be >= start (${start}), in term "${term}" of "${spec}"`);
    }
    for (let year = start; year <= end; year++) seasons.add(year);
  }

  return Array.from(seasons).sort((a, b) => a - b);
}
