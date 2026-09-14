/**
 * Display names for FRC district keys. The published artifact carries TBA's
 * `district.abbreviation` (e.g. `fnc`); the reader-facing name follows the
 * pattern `FIRST {state abbrev}` where the district is a single-state
 * FIRST district, the established proper name otherwise.
 *
 * The key set is NOT closed. A future backfill must re-run
 * `SELECT DISTINCT district_key FROM events WHERE year = N` for the new
 * season and compare against this map before assuming coverage. An unknown
 * key falls back to its uppercased abbreviation, which is exactly what the
 * UI showed for every key before this map existed.
 *
 * `in`/`fin`, `tx`/`fit`, `mar`/`fma`, and `nc`/`fnc` are deliberate
 * DUPLICATE entries, not an oversight — one phenomenon (TBA re-keying a
 * district's abbreviation at a season boundary) with two occurrences so
 * far: Indiana and Texas were re-keyed between the 2020 and 2022 seasons
 * (`in`/`tx` in 2019-2020, `fin`/`fit` from 2022 onward), and Mid-Atlantic
 * and North Carolina were re-keyed between the 2018 and 2019 seasons
 * (`mar`/`nc` in 2018, `fma`/`fnc` from 2019 onward). Both spellings of each
 * pair are live in the corpus and both must resolve to the same
 * reader-facing name.
 *
 * INERT ON THE SITE TODAY: `FIRST_SEASON` in `apps/web/src/lib/seasons.ts`
 * is still 2019 and no 2016, 2017 or 2018 artifacts exist in R2, so the
 * `mar` and `nc` entries below are unreachable from the running site until
 * a publish for those seasons and a deliberate `seasons.ts` change land —
 * in that order.
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
  mar: "FIRST Mid-Atlantic",
  fnc: "FIRST NC",
  nc: "FIRST NC",
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
