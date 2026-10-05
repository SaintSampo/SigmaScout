/** The per event live ingest state blob (quick task 261004-uyc): tolerant to read, exact to write. */
import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_INGEST_STATE, parseLiveIngestState, serializeLiveIngestState, type LiveIngestState } from "../src/liveIngestState.js";

describe("parseLiveIngestState", () => {
  it("a missing blob parses to the default state", () => {
    expect(parseLiveIngestState(null)).toEqual(DEFAULT_LIVE_INGEST_STATE);
    expect(parseLiveIngestState(undefined)).toEqual(DEFAULT_LIVE_INGEST_STATE);
    expect(parseLiveIngestState("")).toEqual(DEFAULT_LIVE_INGEST_STATE);
  });

  it("a malformed or wrong typed blob parses to the default state and never throws", () => {
    for (const text of ["{not json", "42", "null", '"a string"', "[1,2]", "true"]) {
      expect(parseLiveIngestState(text)).toEqual(DEFAULT_LIVE_INGEST_STATE);
    }
  });

  it("a wrong typed field falls back to that field's default and keeps the rest", () => {
    const parsed = parseLiveIngestState(JSON.stringify({ phase: "quals-complete", rankingsEtag: 5, rankingsSeen: "yes", alliancesSeen: true }));
    expect(parsed).toEqual({ ...DEFAULT_LIVE_INGEST_STATE, phase: "quals-complete", alliancesSeen: true });
  });

  it("an unknown phase name falls back to the default phase", () => {
    expect(parseLiveIngestState(JSON.stringify({ phase: "overtime" })).phase).toBe("no-schedule");
  });

  it("a round trip is lossless", () => {
    const state: LiveIngestState = {
      phase: "playoffs-in-progress",
      rankingsEtag: '"abc"',
      alliancesEtag: '"def"',
      rankingsSeen: true,
      alliancesSeen: true,
      rankingsChangedAt: "2026-10-03T22:00:00.000Z",
      alliancesChangedAt: "2026-10-03T22:30:00.000Z",
    };
    expect(parseLiveIngestState(serializeLiveIngestState(state))).toEqual(state);
  });

  it("serialises with a fixed key order, so an unchanged state is byte identical", () => {
    const a = serializeLiveIngestState({ ...DEFAULT_LIVE_INGEST_STATE, phase: "complete" });
    const reordered = parseLiveIngestState(JSON.stringify({ alliancesSeen: false, phase: "complete" }));
    expect(serializeLiveIngestState(reordered)).toBe(a);
    expect(Object.keys(JSON.parse(a))).toEqual(["phase", "rankingsEtag", "alliancesEtag", "rankingsSeen", "alliancesSeen", "rankingsChangedAt", "alliancesChangedAt"]);
  });
});
