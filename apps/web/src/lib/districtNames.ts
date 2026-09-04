/**
 * Display names for FRC district keys (2026-09-01, user request: "do not
 * display fnc, display FIRST NC, etc"). The published artifact carries TBA's
 * `district.abbreviation` (e.g. `fnc`); the reader-facing name follows the
 * user's own stated pattern — `FIRST {state abbrev}` where the district is a
 * single-state FIRST district, the established proper name otherwise. The
 * key set is closed for the seven-season corpus (2019, 2020, 2022-2026;
 * districts don't appear retroactively); an unknown future key falls back to
 * its uppercased abbreviation, which is exactly what the UI showed for every
 * key before this map existed.
 *
 * `in`/`fin` and `tx`/`fit` are deliberate DUPLICATE entries, not an
 * oversight: TBA re-keyed the Indiana and Texas districts between the 2020
 * and 2022 seasons (`in`/`tx` in 2019-2020, `fin`/`fit` from 2022 onward), so
 * both spellings are live in the corpus once 2019/2020 are published (quick
 * task 260904-nt4) and both must resolve to the same reader-facing name.
 * Verified against the corpus 2026-09-04: 2019/2020 events carry exactly
 * `chs, fim, fma, fnc, in, isr, ne, ont, pch, pnw, tx` — every key but `in`
 * and `tx` was already present from the 2022-2026 set.
 */
const DISTRICT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ca: "FIRST California",
  fch: "FIRST Chesapeake",
  win: "FIRST WI",
  chs: "FIRST Chesapeake",
  fim: "FIRST MI",
  fin: "FIRST IN",
  in: "FIRST IN",
  fit: "FIRST TX",
  tx: "FIRST TX",
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
