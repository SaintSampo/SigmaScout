/**
 * `prequalified.ts`'s behavior contract (quick task 260905-lic revision
 * R2a) -- verbatim curated team lists per season, verified against
 * `260905-lic-RESEARCH-awards.md` §Q3's own enumerations.
 */
import { describe, expect, it } from "vitest";
import { prequalifiedTeams } from "./prequalified.js";

describe("prequalifiedTeams", () => {
  it("2019 carries ONLY the original & sustaining list (9 teams) -- Hall of Fame and prior-year lists are NOT enumerable from the research and are deliberately omitted", () => {
    const result = prequalifiedTeams(2019);
    expect(result).toEqual(
      new Set(["frc20", "frc45", "frc126", "frc148", "frc151", "frc157", "frc190", "frc191", "frc250"])
    );
  });

  it("2020 carries NO prequalified list at all -- the disputed original & sustaining category follows TBA's year_end=2019, not the 2020 manual text", () => {
    expect(prequalifiedTeams(2020)).toEqual(new Set());
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
    expect(prequalifiedTeams(2018)).toEqual(new Set());
  });
});
