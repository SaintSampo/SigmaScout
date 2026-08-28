/**
 * tbaAllianceResponseSchema / normalizeEventAlliances tests (D-18.7, EVNT-05,
 * plan 07-03), from real-shaped TBA alliances fixtures per RESEARCH.md's
 * live-confirmed Open Question 2 probe. Mirrors `rankings.test.ts`'s
 * fixture-factory structure — one factory per shape, each case states only
 * what it varies. The default fixture is a transcription of the real
 * `2022roe` response RESEARCH.md recorded, not an invention.
 */
import { describe, expect, it } from "vitest";
import { normalizeEventAlliances } from "./alliances.js";
import { tbaAllianceResponseSchema, type TbaAllianceEntry, type TbaAllianceResponse } from "./schemas.js";

function allianceEntry(overrides: Partial<TbaAllianceEntry> = {}): TbaAllianceEntry {
  return {
    declines: [],
    name: "Alliance 1",
    picks: ["frc3310", "frc67", "frc4451", "frc3539"],
    status: {
      current_level_record: { wins: 1, losses: 2, ties: 0 },
      level: "f",
      playoff_type: 0,
      record: { wins: 5, losses: 2, ties: 0 },
      status: "eliminated",
    },
    ...overrides,
  };
}

function alliancesResponse(overrides: TbaAllianceEntry[] | null = null): TbaAllianceResponse {
  if (overrides !== null) return overrides;
  return [allianceEntry()];
}

describe("tbaAllianceResponseSchema", () => {
  it("parses a null body without throwing and yields null (2022ispr, the one null-body case in the 40-event sample)", () => {
    expect(() => tbaAllianceResponseSchema.parse(null)).not.toThrow();
    expect(tbaAllianceResponseSchema.parse(null)).toBeNull();
  });

  it("parses an empty array response without throwing (2025bc / 2026wvrox, the two live empty-array cases)", () => {
    expect(() => tbaAllianceResponseSchema.parse([])).not.toThrow();
    expect(tbaAllianceResponseSchema.parse([])).toEqual([]);
  });

  it("parses the real 2022roe response (4-pick alliance, RESEARCH.md Code Examples)", () => {
    const response = alliancesResponse();
    expect(() => tbaAllianceResponseSchema.parse(response)).not.toThrow();
  });

  it("parses an alliance object whose keys are exactly declines/picks/status — no name key at all (2024wvrox, live-observed)", () => {
    const noNameEntry = { declines: [], picks: ["frc1", "frc2", "frc3"], status: {} } as unknown as TbaAllianceEntry;
    expect(Object.keys(noNameEntry)).toEqual(["declines", "picks", "status"]);
    const response = alliancesResponse([noNameEntry]);
    expect(() => tbaAllianceResponseSchema.parse(response)).not.toThrow();
  });

  it("parses an alliance object whose name is explicit null", () => {
    const response = alliancesResponse([allianceEntry({ name: null })]);
    expect(() => tbaAllianceResponseSchema.parse(response)).not.toThrow();
  });

  it("throws on a drifted payload — picks retyped from an array of strings to a single string", () => {
    const drifted = [{ ...allianceEntry(), picks: "frc3310" }];
    expect(() => tbaAllianceResponseSchema.parse(drifted)).toThrow();
  });

  it("throws on a drifted payload — picks present but empty (min(1) rejects a zero-pick alliance)", () => {
    const drifted = [{ ...allianceEntry(), picks: [] }];
    expect(() => tbaAllianceResponseSchema.parse(drifted)).toThrow();
  });

  it("throws on a drifted payload — declines absent entirely (a NOT NULL column cannot honestly absorb a missing required key)", () => {
    const { declines: _declines, ...withoutDeclines } = allianceEntry();
    expect(() => tbaAllianceResponseSchema.parse([withoutDeclines])).toThrow();
  });
});

describe("normalizeEventAlliances", () => {
  it("normalizes a null response to an empty array, does not throw", () => {
    expect(() => normalizeEventAlliances(null)).not.toThrow();
    expect(normalizeEventAlliances(null)).toEqual([]);
  });

  it("normalizes a response with an empty array to an empty array — a SEPARATE case from the null-response case, never folded into it", () => {
    expect(() => normalizeEventAlliances([])).not.toThrow();
    expect(normalizeEventAlliances([])).toEqual([]);
  });

  it("a populated response of 5 alliance objects normalizes allianceNumber to [1,2,3,4,5] in the response's own order, proven by names that do NOT match their positions", () => {
    const entries = [
      allianceEntry({ name: "Zebra" }),
      allianceEntry({ name: "Alpha" }),
      allianceEntry({ name: "Mongoose" }),
      allianceEntry({ name: "Delta" }),
      allianceEntry({ name: "Bravo" }),
    ];
    const result = normalizeEventAlliances(entries);
    expect(result.map((r) => r.allianceNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(result.map((r) => r.name)).toEqual(["Zebra", "Alpha", "Mongoose", "Delta", "Bravo"]);
  });

  it("an alliance object with no name key at all normalizes to name: null", () => {
    const noNameEntry = { declines: [], picks: ["frc1", "frc2", "frc3"], status: {} } as unknown as TbaAllianceEntry;
    const result = normalizeEventAlliances([noNameEntry]);
    expect(result[0]?.name).toBeNull();
  });

  it("an absent name normalizes to null, not an empty string", () => {
    const noNameEntry = { declines: [], picks: ["frc1", "frc2", "frc3"], status: {} } as unknown as TbaAllianceEntry;
    const result = normalizeEventAlliances([noNameEntry]);
    expect(result[0]?.name).not.toBe("");
  });

  it("name: null and name: '' both normalize to null", () => {
    const nullNameResult = normalizeEventAlliances([allianceEntry({ name: null })]);
    const emptyNameResult = normalizeEventAlliances([allianceEntry({ name: "" })]);
    expect(nullNameResult[0]?.name).toBeNull();
    expect(emptyNameResult[0]?.name).toBeNull();
  });

  it("a real name string round-trips verbatim", () => {
    const result = normalizeEventAlliances([allianceEntry({ name: "Alliance 7" })]);
    expect(result[0]?.name).toBe("Alliance 7");
  });

  it("a 4-pick alliance normalizes with picks.length === 4 and picks[3] equal to the 4th team key, matching 2022roe's real recorded values", () => {
    const result = normalizeEventAlliances([
      allianceEntry({ picks: ["frc3310", "frc67", "frc4451", "frc3539"] }),
    ]);
    expect(result[0]?.picks).toHaveLength(4);
    expect(result[0]?.picks[3]).toBe("frc3539");
    expect(result[0]?.picks).toEqual(["frc3310", "frc67", "frc4451", "frc3539"]);
  });

  it("a 3-pick alliance normalizes with picks.length === 3", () => {
    const result = normalizeEventAlliances([allianceEntry({ picks: ["frc1", "frc2", "frc3"] })]);
    expect(result[0]?.picks).toHaveLength(3);
  });

  it("declines passes through as the array TBA sent, including the empty array observed in all 40 sampled events", () => {
    const result = normalizeEventAlliances([allianceEntry({ declines: [] })]);
    expect(result[0]?.declines).toEqual([]);
  });

  it("declines passes through non-empty verbatim, order intact", () => {
    const result = normalizeEventAlliances([allianceEntry({ declines: ["frc9", "frc8"] })]);
    expect(result[0]?.declines).toEqual(["frc9", "frc8"]);
  });

  it("statusRaw is JSON.stringify of status, and JSON.parse(statusRaw) deep-equals the original status object", () => {
    const status = {
      current_level_record: { wins: 1, losses: 2, ties: 0 },
      level: "f",
      playoff_type: 0,
      record: { wins: 5, losses: 2, ties: 0 },
      status: "eliminated",
    };
    const result = normalizeEventAlliances([allianceEntry({ status })]);
    expect(result[0]?.statusRaw).not.toBeNull();
    expect(JSON.parse(result[0]!.statusRaw!)).toEqual(status);
  });

  it("an alliance object with no status key normalizes to statusRaw: null", () => {
    const noStatusEntry = { declines: [], name: "Alliance 1", picks: ["frc1", "frc2", "frc3"] } as unknown as TbaAllianceEntry;
    const result = normalizeEventAlliances([noStatusEntry]);
    expect(result[0]?.statusRaw).toBeNull();
  });

  it("never reorders or renumbers alliance objects, regardless of their given order", () => {
    const entries = [allianceEntry({ name: "Third" }), allianceEntry({ name: "First" }), allianceEntry({ name: "Second" })];
    const result = normalizeEventAlliances(entries);
    expect(result.map((r) => r.name)).toEqual(["Third", "First", "Second"]);
    expect(result.map((r) => r.allianceNumber)).toEqual([1, 2, 3]);
  });
});
