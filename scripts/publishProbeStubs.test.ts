/**
 * Which events the stub-only publish selects, against a real corpus file: the
 * same three conditions under which the season loop reaches its stub branch.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../packages/ingest/normalize.js";
import { selectStubEvents } from "./publishProbeStubs.js";

const NOW = Date.parse("2026-09-21T00:00:00.000Z");

function event(overrides: Partial<CorpusEvent>): CorpusEvent {
  return { eventKey: "2026x", year: 2026, eventType: 99, isOffseason: true, startDate: "2026-09-26", name: "X", week: null, country: null, stateProv: null, districtKey: null, ...overrides };
}

function match(eventKey: string): CorpusMatch {
  return {
    matchKey: `${eventKey}_qm1`,
    eventKey,
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    winnerImputed: false,
    redScore: 10,
    blueScore: 5,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    replayed: false,
    replayDetectedAt: null,
    videoKey: null,
  } as CorpusMatch;
}

describe("selectStubEvents", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-stubs-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("selects an upcoming zero-match event, and not one with a match, a closed window or another season", () => {
    upsertEvent(db, event({ eventKey: "2026soon" }));
    upsertEvent(db, event({ eventKey: "2026played" }));
    upsertMatch(db, match("2026played"));
    upsertEvent(db, event({ eventKey: "2026gone", startDate: "2026-05-02" }));
    upsertEvent(db, event({ eventKey: "2025old", year: 2025, startDate: "2026-09-26" }));

    expect(selectStubEvents(db, 2026, NOW).map((row) => row.event_key)).toEqual(["2026soon"]);
  });
});
