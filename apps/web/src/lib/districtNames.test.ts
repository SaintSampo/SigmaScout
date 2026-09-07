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

  it("an unknown key still falls back to its uppercased abbreviation", () => {
    expect(districtDisplayName("zzz")).toBe("ZZZ");
  });
});
