/**
 * Display names for FRC district keys (2026-09-01, user request: "do not
 * display fnc, display FIRST NC, etc"). The published artifact carries TBA's
 * `district.abbreviation` (e.g. `fnc`); the reader-facing name follows the
 * user's own stated pattern — `FIRST {state abbrev}` where the district is a
 * single-state FIRST district, the established proper name otherwise. The
 * The key set is **not** closed. It was believed closed for the
 * seven-season 2019-2026 corpus, but the corpus is now extending
 * *backward* (2018 landed 2026-09-06; 2017 and 2016 are planned per
 * `.planning/todos/pending/extend-corpus-2018-2017-2016.md`), and each
 * backward season may introduce further pre-rename spellings the way 2018
 * did. A future backfill must re-run
 * `SELECT DISTINCT district_key FROM events WHERE year = N` for the new
 * season and compare against this map before assuming coverage. An unknown
 * key falls back to its uppercased abbreviation, which is exactly what the
 * UI showed for every key before this map existed.
 *
 * `in`/`fin`, `tx`/`fit`, `mar`/`fma`, and `nc`/`fnc` are deliberate
 * DUPLICATE entries, not an oversight — one phenomenon (TBA re-keying a
 * district's abbreviation at a season boundary) with two occurrences so far:
 * Indiana and Texas were re-keyed between the 2020 and 2022 seasons
 * (`in`/`tx` in 2019-2020, `fin`/`fit` from 2022 onward), and Mid-Atlantic
 * and North Carolina were re-keyed between the 2018 and 2019 seasons
 * (`mar`/`nc` in 2018, `fma`/`fnc` from 2019 onward). Both spellings of each
 * pair are live in the corpus and both must resolve to the same
 * reader-facing name. Verified against the corpus 2026-09-04: 2019/2020
 * events carry exactly `chs, fim, fma, fnc, in, isr, ne, ont, pch, pnw, tx`
 * — every key but `in` and `tx` was already present from the 2022-2026 set.
 * Verified again 2026-09-07 (quick task 260907-12k):
 * `SELECT DISTINCT district_key FROM events WHERE year = 2018` returned
 * exactly `chs, fim, in, isr, mar, nc, ne, ont, pch, pnw` — `mar` and `nc`
 * are new pre-rename spellings; `tx` did not exist in 2018.
 *
 * INERT ON THE SITE TODAY: `FIRST_SEASON` in `apps/web/src/lib/seasons.ts`
 * is still 2019 and no 2018 artifacts exist in R2, so the `mar` and `nc`
 * entries below are unreachable from the running site until a 2018 publish
 * and a deliberate `seasons.ts` change land — in that order.
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
