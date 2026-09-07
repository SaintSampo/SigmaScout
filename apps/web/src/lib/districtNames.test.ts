import { describe, expect, it } from "vitest";
import { districtDisplayName } from "./districtNames.js";

// The 2019/2020 district keys observed in the corpus, queried directly
// (quick task 260904-nt4, 2026-09-04):
//   SELECT DISTINCT district_key FROM events WHERE year IN (2019, 2020)
// -> chs, fim, fma, fnc, in, isr, ne, ont, pch, pnw, tx
// A browser-side test cannot open the corpus, so this list is hardcoded from
// that query's result, with the date and query recorded above so it can be
// re-verified if the corpus changes.
const OBSERVED_2019_2020_DISTRICT_KEYS = ["chs", "fim", "fma", "fnc", "in", "isr", "ne", "ont", "pch", "pnw", "tx"] as const;

// The 2018 district keys observed in the corpus, queried directly
// (quick task 260907-12k, 2026-09-07):
//   SELECT DISTINCT district_key FROM events WHERE year = 2018
// -> chs, fim, in, isr, mar, nc, ne, ont, pch, pnw
// A browser-side test cannot open the corpus, so this list is hardcoded from
// that query's result, with the date and query recorded above so it can be
// re-verified if the corpus changes.
const OBSERVED_2018_DISTRICT_KEYS = ["chs", "fim", "in", "isr", "mar", "nc", "ne", "ont", "pch", "pnw"] as const;

// The 2017 and 2016 district keys observed in the corpus, queried directly
// (quick task 260907-203, 2026-09-07):
//   SELECT DISTINCT district_key FROM events WHERE year = 2017
//   -> chs, fim, in, isr, mar, nc, ne, ont, pch, pnw   (10, identical to 2018's)
//   SELECT DISTINCT district_key FROM events WHERE year = 2016
//   -> chs, fim, in, mar, nc, ne, pch, pnw             (8)
// 2016 lacks `isr` and `ont`, and NEITHER season carries `tx` — Texas's
// pre-rename spelling is a 2019/2020-only key. Both seasons' backward
// extension introduced no new key at all: every one already resolved,
// because `mar` and `nc` landed with 2018.
//
// These three OBSERVED_* lists ARE iteration lists, and that is correct
// here rather than the silent-trap shape: the literal key set IS the pinned
// data. Deleting an entry from `DISTRICT_DISPLAY_NAMES` makes the matching
// literal below fall back to its uppercased form and fails loudly by name.
// (Contrast the trap: a list of SEASONS driving per-season assertions, where
// a season simply absent from the list is never exercised.)
const OBSERVED_2017_DISTRICT_KEYS = ["chs", "fim", "in", "isr", "mar", "nc", "ne", "ont", "pch", "pnw"] as const;
const OBSERVED_2016_DISTRICT_KEYS = ["chs", "fim", "in", "mar", "nc", "ne", "pch", "pnw"] as const;

describe("districtDisplayName", () => {
  it("TBA re-keyed Indiana/Texas between 2020 and 2022, and Mid-Atlantic/North Carolina between 2018 and 2019 — every rename pair resolves to the same reader-facing name", () => {
    expect(districtDisplayName("in")).toBe(districtDisplayName("fin"));
    expect(districtDisplayName("tx")).toBe(districtDisplayName("fit"));
    expect(districtDisplayName("mar")).toBe(districtDisplayName("fma"));
    expect(districtDisplayName("nc")).toBe(districtDisplayName("fnc"));
  });

  it("every district key the 2019/2020 corpus carries resolves to a proper name, never its uppercased fallback", () => {
    for (const key of OBSERVED_2019_2020_DISTRICT_KEYS) {
      expect(districtDisplayName(key)).not.toBe(key.toUpperCase());
    }
  });

  it("every district key the 2018 corpus carries resolves to a proper name, never its uppercased fallback", () => {
    for (const key of OBSERVED_2018_DISTRICT_KEYS) {
      expect(districtDisplayName(key)).not.toBe(key.toUpperCase());
    }
  });

  it("every district key the 2017 corpus carries resolves to a proper name, never its uppercased fallback", () => {
    for (const key of OBSERVED_2017_DISTRICT_KEYS) {
      expect(districtDisplayName(key)).not.toBe(key.toUpperCase());
    }
  });

  it("every district key the 2016 corpus carries resolves to a proper name, never its uppercased fallback", () => {
    for (const key of OBSERVED_2016_DISTRICT_KEYS) {
      expect(districtDisplayName(key)).not.toBe(key.toUpperCase());
    }
  });

  it("an unknown key still falls back to its uppercased abbreviation", () => {
    expect(districtDisplayName("zzz")).toBe("ZZZ");
  });
});
