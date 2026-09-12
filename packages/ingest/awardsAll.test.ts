/**
 * `selectAllEventKeysForYear` / `normalizeEventAwardsAll` /
 * `eventAwardsAllEtagKey` tests (quick task 260912-5n8 T1), plus the
 * delete-then-insert contract of `replaceEventAwardsAll` that the positional
 * primary key depends on.
 *
 * Fixture-driven, no network: every TBA body here is a literal typed as
 * `TbaEventAwardsResponse`, and the corpus is a fresh temp `openCorpus` per
 * test, mirroring `eventTeams.test.ts`'s shape exactly.
 *
 * The point of nearly every case below is a NEGATIVE: this path must keep
 * what `normalizeEventAwards` throws away. A test that only checked the
 * four qualification award types would pass identically against the wrong
 * function.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openCorpus,
  replaceEventAwardsAll,
  selectEventAwardsAllForYear,
  upsertEvent,
  type Corpus,
  type CorpusEventAwardAll,
} from "../corpus/db.js";
import { eventAwardsAllEtagKey, normalizeEventAwardsAll, selectAllEventKeysForYear } from "./awardsAll.js";
import type { CorpusEvent } from "./normalize.js";
import type { TbaEventAwardsResponse } from "./schemas.js";

/** The row shape `replaceEventAwardsAll` takes — the stored row minus its event key, which is the function's own parameter. */
type AwardAllRowInput = Omit<CorpusEventAwardAll, "eventKey">;

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

describe("normalizeEventAwardsAll (quick task 260912-5n8 T1)", () => {
  it("keeps award types OUTSIDE the qualification set {0,1,9,10}", () => {
    // 13 = Judges' Award, 16 = Excellence in Engineering, 68 = a type this
    // pipeline has never enumerated anywhere. All three are dropped on the
    // floor by normalizeEventAwards; all three are the entire reason this
    // function exists.
    const body: TbaEventAwardsResponse = [
      { name: "Judges' Award", award_type: 13, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: "frc111", awardee: null }] },
      { name: "Excellence in Engineering", award_type: 16, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: "frc222", awardee: null }] },
      { name: "Some Future Award", award_type: 68, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: "frc333", awardee: null }] },
    ];
    expect(normalizeEventAwardsAll(body).map((r) => r.awardType)).toEqual([13, 16, 68]);
  });

  it("keeps a person-only recipient (team_key null) together with its awardee", () => {
    const body: TbaEventAwardsResponse = [
      {
        name: "Woodie Flowers Finalist Award",
        award_type: 3,
        event_key: "2026aaa",
        year: 2026,
        recipient_list: [{ team_key: null, awardee: "Jane Mentor" }],
      },
    ];
    const rows = normalizeEventAwardsAll(body);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamKey).toBeNull();
    expect(rows[0]!.awardee).toBe("Jane Mentor");
    expect(rows[0]!.name).toBe("Woodie Flowers Finalist Award");
  });

  it("emits one row per recipient of a multi-recipient award, with distinct recipient_index", () => {
    const body: TbaEventAwardsResponse = [
      {
        name: "Winner",
        award_type: 1,
        event_key: "2026aaa",
        year: 2026,
        recipient_list: [
          { team_key: "frc111", awardee: null },
          { team_key: "frc222", awardee: null },
          { team_key: "frc333", awardee: null },
          { team_key: "frc444", awardee: null },
        ],
      },
    ];
    const rows = normalizeEventAwardsAll(body);
    expect(rows.map((r) => r.recipientIndex)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.teamKey)).toEqual(["frc111", "frc222", "frc333", "frc444"]);
    expect(rows.every((r) => r.awardIndex === 0)).toBe(true);
  });

  it("keeps two awards of the SAME type at one event distinct via award_index", () => {
    // Without award_index in the key these two collapse into one row and the
    // second Volunteer of the Year silently disappears.
    const body: TbaEventAwardsResponse = [
      { name: "Volunteer of the Year", award_type: 12, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: null, awardee: "First Person" }] },
      { name: "Volunteer of the Year", award_type: 12, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: null, awardee: "Second Person" }] },
    ];
    const rows = normalizeEventAwardsAll(body);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.awardIndex)).toEqual([0, 1]);
    expect(rows.map((r) => r.awardee)).toEqual(["First Person", "Second Person"]);
    // Same type, same event, same recipient_index — only award_index separates them.
    expect(new Set(rows.map((r) => `${r.awardType}:${r.awardIndex}:${r.recipientIndex}`)).size).toBe(2);
  });

  it("returns [] for a null body and for an empty array, and throws on neither", () => {
    expect(normalizeEventAwardsAll(null)).toEqual([]);
    expect(normalizeEventAwardsAll([])).toEqual([]);
  });

  it("contributes no rows for an award with an empty recipient_list", () => {
    const body: TbaEventAwardsResponse = [
      { name: "Unclaimed Award", award_type: 13, event_key: "2026aaa", year: 2026, recipient_list: [] },
      { name: "Judges' Award", award_type: 13, event_key: "2026aaa", year: 2026, recipient_list: [{ team_key: "frc111", awardee: null }] },
    ];
    const rows = normalizeEventAwardsAll(body);
    expect(rows).toHaveLength(1);
    // The empty award still consumed index 0, so the real one is index 1 —
    // indices are POSITIONS in the response, not a compacted counter.
    expect(rows[0]!.awardIndex).toBe(1);
  });
});

describe("eventAwardsAllEtagKey (quick task 260912-5n8 T1)", () => {
  it("is NOT the /event/{key}/awards fetch URL that --awards-only already cached", () => {
    // THE trap. readEtag/writeEtag are keyed by URL string, and --awards-only
    // has already stored an ETag under the bare URL for every district event.
    // Reusing it would 304-with-no-body on exactly the events that have
    // awards, storing nothing while the run reports success. Pinned as an
    // assertion, deliberately, because a comment would not have caught it.
    const fetchUrl = "/event/2026ncwak/awards";
    expect(eventAwardsAllEtagKey("2026ncwak")).not.toBe(fetchUrl);
    expect(eventAwardsAllEtagKey("2026ncwak")).toBe("/event/2026ncwak/awards#all");
  });

  it("keeps the fetch URL as its prefix so the key is still traceable to its endpoint", () => {
    expect(eventAwardsAllEtagKey("2016nyro").startsWith("/event/2016nyro/awards#")).toBe(true);
  });
});

describe("selectAllEventKeysForYear (quick task 260912-5n8 T1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-awards-all-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedTwoYears(): void {
    upsertEvent(db, corpusEvent({ eventKey: "2026ccc", year: 2026, eventType: 3 })); // Champ Division
    upsertEvent(db, corpusEvent({ eventKey: "2026aaa", year: 2026, eventType: 1 })); // District
    upsertEvent(db, corpusEvent({ eventKey: "2026zoff", year: 2026, eventType: 99, isOffseason: true })); // Offseason
    upsertEvent(db, corpusEvent({ eventKey: "2026bbb", year: 2026, eventType: 0 })); // Regional
    upsertEvent(db, corpusEvent({ eventKey: "2026wpre", year: 2026, eventType: 100 })); // Preseason Week 0
    upsertEvent(db, corpusEvent({ eventKey: "2025reg", year: 2025, eventType: 0 }));
  }

  it("INCLUDES offseason (99) and preseason (100) events, unlike selectOfficialEventKeysForYear", () => {
    seedTwoYears();
    const keys = selectAllEventKeysForYear(db, 2026);
    expect(keys).toContain("2026zoff");
    expect(keys).toContain("2026wpre");
  });

  it("returns every event for the year, ascending by event key", () => {
    seedTwoYears();
    expect(selectAllEventKeysForYear(db, 2026)).toEqual(["2026aaa", "2026bbb", "2026ccc", "2026wpre", "2026zoff"]);
  });

  it("scopes to the requested year only", () => {
    seedTwoYears();
    expect(selectAllEventKeysForYear(db, 2025)).toEqual(["2025reg"]);
  });

  it("returns an empty array for a year with no rows", () => {
    seedTwoYears();
    expect(selectAllEventKeysForYear(db, 2024)).toEqual([]);
  });
});

describe("replaceEventAwardsAll (quick task 260912-5n8 T1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-awards-all-db-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    upsertEvent(db, corpusEvent({ eventKey: "2026aaa", year: 2026 }));
    upsertEvent(db, corpusEvent({ eventKey: "2026bbb", year: 2026 }));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function row(overrides: Partial<AwardAllRowInput> = {}): AwardAllRowInput {
    return {
      awardType: 13,
      awardIndex: 0,
      recipientIndex: 0,
      teamKey: "frc111",
      awardee: null,
      name: "Judges' Award",
      year: 2026,
      fetchedAt: "2026-09-12T00:00:00.000Z",
      ...overrides,
    };
  }

  it("stores nullable team_key and awardee round-trip, both directions", () => {
    replaceEventAwardsAll(db, "2026aaa", [
      row({ awardIndex: 0, teamKey: "frc111", awardee: null }),
      row({ awardIndex: 1, teamKey: null, awardee: "Jane Mentor", name: "Woodie Flowers Finalist Award", awardType: 3 }),
    ]);
    const stored = selectEventAwardsAllForYear(db, 2026);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ eventKey: "2026aaa", teamKey: "frc111", awardee: null });
    expect(stored[1]).toMatchObject({ eventKey: "2026aaa", teamKey: null, awardee: "Jane Mentor" });
  });

  it("leaves NO stale rows when the award list shrinks (the whole reason it is not an upsert)", () => {
    replaceEventAwardsAll(db, "2026aaa", [row({ awardIndex: 0 }), row({ awardIndex: 1 }), row({ awardIndex: 2 })]);
    expect(selectEventAwardsAllForYear(db, 2026)).toHaveLength(3);

    // Second fetch returns only one award. Under an upsert, indices 1 and 2
    // would survive and read as real awards forever.
    replaceEventAwardsAll(db, "2026aaa", [row({ awardIndex: 0, name: "Judges' Award (corrected)" })]);
    const stored = selectEventAwardsAllForYear(db, 2026);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("Judges' Award (corrected)");
  });

  it("clears an event down to zero rows when it is replaced with an empty list", () => {
    replaceEventAwardsAll(db, "2026aaa", [row()]);
    replaceEventAwardsAll(db, "2026aaa", []);
    expect(selectEventAwardsAllForYear(db, 2026)).toHaveLength(0);
  });

  it("scopes its DELETE to the named event and never touches another event's rows", () => {
    replaceEventAwardsAll(db, "2026aaa", [row()]);
    replaceEventAwardsAll(db, "2026bbb", [row({ teamKey: "frc999" })]);
    replaceEventAwardsAll(db, "2026aaa", []);
    const stored = selectEventAwardsAllForYear(db, 2026);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ eventKey: "2026bbb", teamKey: "frc999" });
  });

  it("stores two same-type awards at one event, separated only by award_index", () => {
    replaceEventAwardsAll(db, "2026aaa", [
      row({ awardType: 12, awardIndex: 0, teamKey: null, awardee: "First Person", name: "Volunteer of the Year" }),
      row({ awardType: 12, awardIndex: 1, teamKey: null, awardee: "Second Person", name: "Volunteer of the Year" }),
    ]);
    const stored = selectEventAwardsAllForYear(db, 2026);
    expect(stored.map((r) => r.awardee)).toEqual(["First Person", "Second Person"]);
  });
});
