/**
 * `selectOfficialEventKeysForYear` / `eventTeamsUrlFor` tests (quick task
 * 260905-tll Task 3, C-16). Mirrors `packages/corpus/districts.test.ts`'s
 * temp-corpus fixture shape — a fresh `openCorpus` per test, cleaned up in
 * `afterEach`. Needs no real corpus; always runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertEvent, type Corpus } from "../corpus/db.js";
import type { CorpusEvent } from "./normalize.js";
import { eventTeamsUrlFor, selectOfficialEventKeysForYear } from "./eventTeams.js";

function corpusEvent(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2026aaa",
    year: 2026,
    eventType: 0,
    isOffseason: false,
    startDate: "2026-03-01",
    name: "Fixture Event",
    week: null,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

describe("selectOfficialEventKeysForYear / eventTeamsUrlFor (quick task 260905-tll Task 3)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-event-teams-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedTwoYears(): void {
    // 2026: one of each shape the predicate must decide on. Keys chosen so
    // ascending order differs from insertion order (the sort is asserted,
    // not assumed).
    upsertEvent(db, corpusEvent({ eventKey: "2026ccc", year: 2026, eventType: 3 })); // Champ Division — official
    upsertEvent(db, corpusEvent({ eventKey: "2026aaa", year: 2026, eventType: 1 })); // District — official
    upsertEvent(db, corpusEvent({ eventKey: "2026zoff", year: 2026, eventType: 99, isOffseason: true })); // Offseason — excluded
    upsertEvent(db, corpusEvent({ eventKey: "2026bbb", year: 2026, eventType: 0 })); // Regional — official
    upsertEvent(db, corpusEvent({ eventKey: "2026wpre", year: 2026, eventType: 100 })); // Preseason Week 0 — excluded
    // 2025: one official event, proving the year filter scopes correctly.
    upsertEvent(db, corpusEvent({ eventKey: "2025reg", year: 2025, eventType: 0 }));
  }

  it("returns exactly the official events for the requested year, ascending by event key", () => {
    seedTwoYears();
    expect(selectOfficialEventKeysForYear(db, 2026)).toEqual(["2026aaa", "2026bbb", "2026ccc"]);
  });

  it("excludes offseason (99) and preseason Week 0 (100) events", () => {
    seedTwoYears();
    const keys = selectOfficialEventKeysForYear(db, 2026);
    expect(keys).not.toContain("2026zoff");
    expect(keys).not.toContain("2026wpre");
  });

  it("scopes to the requested year only", () => {
    seedTwoYears();
    expect(selectOfficialEventKeysForYear(db, 2025)).toEqual(["2025reg"]);
  });

  it("returns an empty array for a year with no rows", () => {
    seedTwoYears();
    expect(selectOfficialEventKeysForYear(db, 2024)).toEqual([]);
  });

  it("eventTeamsUrlFor produces the exact path string the ETag cache is keyed on", () => {
    expect(eventTeamsUrlFor("2026ncwak")).toBe("/event/2026ncwak/teams/keys");
  });
});
