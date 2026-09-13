/**
 * `prequalified.ts`'s behavior contract (quick task 260905-lic revision
 * R2a) -- verbatim curated team lists per season, verified against
 * `260905-lic-RESEARCH-awards.md` §Q3's own enumerations. The 2016-2020
 * lists, backfilled 2026-09-13, are sourced in `prequalified.ts`'s header.
 */
import { describe, expect, it } from "vitest";
import { prequalifiedTeams } from "./prequalified.js";

describe("prequalifiedTeams", () => {
  // 2016-2020 sizes below were counted by hand from the source lists, not
  // read back from the implementation: Hall of Fame inducted before the
  // season, plus original & sustaining (2016-2019), plus the prior-year rows,
  // minus each overlap named in the test.
  it("2016 is the whole Hall of Fame (22), original & sustaining (9), and the 2015 Championship winners (4) and EI winners (4), with no Chairman's Finalist category", () => {
    const result = prequalifiedTeams(2016);
    // 151 is both original & sustaining and Hall of Fame (1995)
    expect(result.size).toBe(22 + 9 - 1 + 4 + 4);
    expect(result.has("frc7")).toBe(true);
    expect(result.has("frc597")).toBe(true);
    expect(result.has("frc987")).toBe(false); // inducted 2016, so not yet a member in 2016
    expect(result.has("frc5012")).toBe(true);
    expect(result.has("frc3132")).toBe(true); // 2015 EI
  });

  it("2017 adds 987 to the Hall of Fame and swaps in the 2016 Championship winners and EI winners, deduplicating 120 (winner and Hall of Fame)", () => {
    const result = prequalifiedTeams(2017);
    expect(result.size).toBe(23 + 9 - 1 + 4 - 1 + 4);
    expect(result.has("frc987")).toBe(true);
    expect(result.has("frc120")).toBe(true);
    expect(result.has("frc5012")).toBe(false); // 2015's winners do not carry past one season
  });

  it("2018 is the first season with a Chairman's Finalist category, drawn from both 2017 Championships", () => {
    const result = prequalifiedTeams(2018);
    // 25 HoF + 9 O&S - 151; 8 winners - 254; 6 EI - 27; 6 finalists - 2614 - 3132
    expect(result.size).toBe(25 + 9 - 1 + 8 - 1 + 6 - 1 + 6 - 2);
    expect(result.has("frc1885")).toBe(true); // 2017cmpmo finalist
    expect(result.has("frc5499")).toBe(true); // 2017cmptx winner
  });

  it("2019 is the whole Hall of Fame, original & sustaining, and the 2018 winners, EI winners and Chairman's Finalists", () => {
    const result = prequalifiedTeams(2019);
    // 27 HoF + 9 O&S - 151; 8 winners - 27 - 254 - 148; 6 EI; 6 finalists - 2834 - 1311
    expect(result.size).toBe(27 + 9 - 1 + 8 - 3 + 6 + 6 - 2);
    for (const key of ["frc20", "frc45", "frc126", "frc148", "frc151", "frc157", "frc190", "frc191", "frc250"]) {
      expect(result.has(key)).toBe(true);
    }
    expect(result.has("frc1816")).toBe(true); // a 2018 finalist, not yet Hall of Fame
  });

  it("2020 carries every category EXCEPT the disputed original & sustaining one, which follows TBA's year_end=2019", () => {
    const result = prequalifiedTeams(2020);
    // 29 HoF; 8 winners; 6 EI - 2834; 6 finalists - 1816 - 1902
    expect(result.size).toBe(29 + 8 + 6 - 1 + 6 - 2);
    expect(result.has("frc191")).toBe(false); // original & sustaining only, never Hall of Fame
    expect(result.has("frc20")).toBe(false);
    expect(result.has("frc151")).toBe(true); // Hall of Fame 1995, independent of the dispute
    expect(result.has("frc1902")).toBe(true);
    expect(result.has("frc5672")).toBe(true); // 2019 finalist
  });

  it("2022 is Hall of Fame only (13 teams) -- the 2021 Championship was cancelled, so there is no prior-year category", () => {
    const result = prequalifiedTeams(2022);
    expect(result.size).toBe(13);
    expect(result.has("frc27")).toBe(true);
    expect(result.has("frc4613")).toBe(true);
  });

  it("2023 includes both the Hall of Fame list and the 2022 prior-year categories, deduplicating the Chairman's Winner (1629) who appears in both", () => {
    const result = prequalifiedTeams(2023);
    expect(result.has("frc1629")).toBe(true);
    // 15 HoF + 4 CMP winners + 5 Chairman's finalists + 6 EI winners + 1 Chairman's winner, minus the 1 dedup (1629 appears in both HoF and prior-year)
    expect(result.size).toBe(15 + 4 + 5 + 6 + 1 - 1);
  });

  it("2024 includes the one-off prior-year Impact Winner (321) who also appears in the Hall of Fame list, deduplicated", () => {
    const result = prequalifiedTeams(2024);
    expect(result.has("frc321")).toBe(true);
    expect(result.size).toBe(15 + 4 + 5 + 8 + 1 - 1);
  });

  it("2025 includes the named one-off exception team 9739", () => {
    const result = prequalifiedTeams(2025);
    expect(result.has("frc9739")).toBe(true);
  });

  it("2026 is Hall of Fame only (10 teams) -- all non-Hall-of-Fame pre-qualification slots were removed for 2026", () => {
    const result = prequalifiedTeams(2026);
    expect(result).toEqual(
      new Set(["frc5985", "frc2486", "frc321", "frc1629", "frc503", "frc4613", "frc1816", "frc1902", "frc1311", "frc2834"])
    );
  });

  it("returns an empty set for a season with no declared list at all", () => {
    expect(prequalifiedTeams(2015)).toEqual(new Set());
    expect(prequalifiedTeams(2021)).toEqual(new Set());
  });
});
