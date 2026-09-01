/**
 * Display names for FRC district keys (2026-09-01, user request: "do not
 * display fnc, display FIRST NC, etc"). The published artifact carries TBA's
 * `district.abbreviation` (e.g. `fnc`); the reader-facing name follows the
 * user's own stated pattern — `FIRST {state abbrev}` where the district is a
 * single-state FIRST district, the established proper name otherwise. The
 * key set is closed for 2022–2026 (districts don't appear retroactively);
 * an unknown future key falls back to its uppercased abbreviation, which is
 * exactly what the UI showed for every key before this map existed.
 */
const DISTRICT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ca: "FIRST California",
  fch: "FIRST Chesapeake",
  win: "FIRST WI",
  chs: "FIRST Chesapeake",
  fim: "FIRST MI",
  fin: "FIRST IN",
  fit: "FIRST TX",
  fma: "FIRST Mid-Atlantic",
  fnc: "FIRST NC",
  fsc: "FIRST SC",
  isr: "FIRST Israel",
  ne: "New England",
  ont: "Ontario",
  pch: "Peachtree",
  pnw: "Pacific Northwest",
};

/** Reader-facing name for a TBA district key; uppercased key for an unknown one. */
export function districtDisplayName(districtKey: string): string {
  return DISTRICT_DISPLAY_NAMES[districtKey.toLowerCase()] ?? districtKey.toUpperCase();
}
