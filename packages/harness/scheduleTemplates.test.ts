/**
 * Quick task 260905-tll Task 1: the schedule-template cache reader,
 * exercised against the REAL gitignored cache in `data/schedule-templates/`
 * — following `packages/ingest/corpusCensus.test.ts`'s established
 * gate-on-existence discipline for tests that read a gitignored `data/*`
 * artifact (skip with an instruction naming the populate command, never
 * fail, on a machine that has not fetched the cache).
 *
 * Fixture facts pinned below, verified by hand against the cache before
 * being written into assertions:
 * - `34_12.csv` has 68 rows = ceil(34*12/6).
 * - `10_10.csv` has 17 rows = ceil(10*10/6), and its row 5 is
 *   `7,1,10,0,4,0,9,1,5,0,1,0` — red slot 7 and blue slot 9 are surrogates.
 * - `55_12.csv` has 110 rows, so a 110-team split load concatenates two
 *   55-team blocks into 220 rows.
 * - The grid is complete at 6..100 x 1..14 (1,330 files), so the only
 *   reachable missing-file case against a fully-fetched cache is a
 *   matches-per-team value outside 1..14.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultMatchesPerTeam,
  loadScheduleTemplate,
  matchesPerTeamFor,
  SCHEDULE_TEMPLATE_DIR,
  ScheduleTemplateMissingError,
  ScheduleTemplateUnavailableError,
} from "./scheduleTemplates.js";

const CACHE_AVAILABLE = existsSync(SCHEDULE_TEMPLATE_DIR);

describe("matchesPerTeamFor (C-12, pure — no cache needed)", () => {
  it("TRUNCATES rather than rounds, at a case where the two differ", () => {
    // 16 quals * 6 slots / 10 teams = 9.6 -> trunc 9, round would say 10.
    expect(matchesPerTeamFor(10, 16)).toBe(9);
  });

  it("clamps at the low end (a derived 0 becomes 1)", () => {
    // 1 qual * 6 / 100 teams = 0.06 -> trunc 0 -> clamped to 1.
    expect(matchesPerTeamFor(100, 1)).toBe(1);
  });

  it("clamps at the high end (a derived 600 becomes 14)", () => {
    expect(matchesPerTeamFor(10, 1000)).toBe(14);
  });
});

describe("defaultMatchesPerTeam (C-12, pure — no cache needed)", () => {
  it("returns 10 for TBA event type 3 (Championship Division)", () => {
    expect(defaultMatchesPerTeam(3)).toBe(10);
  });

  it("returns 12 for types 0 (Regional) and 1 (District)", () => {
    expect(defaultMatchesPerTeam(0)).toBe(12);
    expect(defaultMatchesPerTeam(1)).toBe(12);
  });
});

describe("loadScheduleTemplate range guards (pure — thrown before any file read)", () => {
  it("throws ScheduleTemplateUnavailableError for a below-6 team count", () => {
    expect(() => loadScheduleTemplate(5, 12)).toThrow(ScheduleTemplateUnavailableError);
  });

  it("throws ScheduleTemplateUnavailableError for an above-200 team count (split blocks still exceed 100)", () => {
    expect(() => loadScheduleTemplate(250, 12)).toThrow(ScheduleTemplateUnavailableError);
  });
});

describe("loadScheduleTemplate against the real cache", () => {
  if (!CACHE_AVAILABLE) {
    it.skip(`skipped: ${SCHEDULE_TEMPLATE_DIR} is absent — run \`pnpm fetch:schedule-templates\` to populate it`, () => {});
    return;
  }

  it("a direct 6..100 load returns ceil(n*m/6) rows with zero-based indices in range", () => {
    const template = loadScheduleTemplate(34, 12);
    expect(template.length).toBe(Math.ceil((34 * 12) / 6)); // 68
    for (const match of template) {
      expect(match.red.length).toBe(3);
      expect(match.blue.length).toBe(3);
      for (const index of [...match.red, ...match.blue]) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(34);
      }
    }
  });

  it("parses surrogate flags as booleans on a template that has some (10_10.csv row 5)", () => {
    const template = loadScheduleTemplate(10, 10);
    expect(template.length).toBe(17); // ceil(10*10/6)
    // Row 5 of 10_10.csv is `7,1,10,0,4,0,9,1,5,0,1,0`: red slot 7 (one-based)
    // and blue slot 9 (one-based) are surrogates.
    const row5 = template[4]!;
    expect(row5.red).toEqual([6, 9, 3]);
    expect(row5.blue).toEqual([8, 4, 0]);
    expect(row5.redSurrogate).toEqual([true, false, false]);
    expect(row5.blueSurrogate).toEqual([true, false, false]);
    // And every flag across the file is a real boolean, never a raw 0/1.
    for (const match of template) {
      for (const flag of [...match.redSurrogate, ...match.blueSurrogate]) {
        expect(typeof flag).toBe("boolean");
      }
    }
  });

  it("a 110-team count produces a concatenated two-block schedule whose indices span 0..109", () => {
    const template = loadScheduleTemplate(110, 12);
    // Two 55-team blocks of 110 rows each.
    expect(template.length).toBe(220);
    const seen = new Set<number>();
    for (const match of template) {
      for (const index of [...match.red, ...match.blue]) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(110);
        seen.add(index);
      }
    }
    // Every one of the 110 teams appears somewhere — both blocks are present
    // and the second block's offset genuinely reaches 109.
    expect(seen.size).toBe(110);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(109);
  });

  it("a deliberately-absent (numTeams, matchesPerTeam) pair throws ScheduleTemplateMissingError naming the fetch script", () => {
    // The fetched grid covers matches-per-team 1..14 completely, so 15 is
    // the deliberately-absent coordinate against a fully-populated cache.
    expect(() => loadScheduleTemplate(34, 15)).toThrow(ScheduleTemplateMissingError);
    expect(() => loadScheduleTemplate(34, 15)).toThrow(/fetch:schedule-templates/);
  });
});
