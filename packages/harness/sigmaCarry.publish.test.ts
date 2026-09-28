/**
 * `publishSeasons`' `sigmaCarry` switch, end to end on a two-season temp corpus, dry run (nothing is
 * uploaded; bodies are read through `artifactSink`).
 *
 *   - OFF IS THE INCUMBENT: absent and `false` publish byte-identical bodies.
 *   - ON NEVER MOVES WINNER ODDS: the Compare page (winner accuracy and Brier, the published scorer) is
 *     byte-identical with the candidate on, which is the structural claim behind gate G1 of the
 *     pre-registered bar. The second season's team pages DO change (non-vacuity: the carry reached
 *     the published Sigma).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { spr } from "../core/algorithms/spr.js";
import { publishSeasons } from "./publish.js";

function event(eventKey: string, year: number, startDate: string): CorpusEvent {
  return {
    eventKey,
    year,
    eventType: 0,
    isOffseason: false,
    startDate,
    name: eventKey,
    week: 1,
    country: null,
    stateProv: null,
    districtKey: null,
  };
}

const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9"];

/** A deterministic round-robin of qualification matches over nine teams, with scores that vary by team. */
function seedSeason(db: Corpus, year: number, eventKey: string, startSortTime: number, matches: number): void {
  upsertEvent(db, event(eventKey, year, `${year}-03-01`));
  for (let i = 0; i < matches; i++) {
    const pick = (k: number): string => TEAMS[(i * 4 + k * 2 + (i % 3)) % TEAMS.length]!;
    const red = [pick(0), pick(1), pick(2)];
    const blue = TEAMS.filter((t) => !red.includes(t)).slice(i % 4, (i % 4) + 3);
    const strength = (team: string): number => Number(team.slice(3)) * (year === 2025 ? 6 : 9) + ((i * 13 + year) % 17);
    const redScore = red.reduce((s, t) => s + strength(t), 0);
    const blueScore = blue.reduce((s, t) => s + strength(t), 0);
    const match: CorpusMatch = {
      matchKey: `${eventKey}_qm${i + 1}`,
      eventKey,
      compLevel: "qm",
      matchNumber: i + 1,
      setNumber: 1,
      sortTime: startSortTime + i * 1_000,
      redTeams: red,
      blueTeams: blue,
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      winner: redScore > blueScore ? "red" : redScore < blueScore ? "blue" : "tie",
      winnerImputed: false,
      redScore,
      blueScore,
      redRpEarned: null,
      blueRpEarned: null,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      videoKey: null,
    };
    upsertMatch(db, match);
  }
}

async function bodies(db: Corpus, sigmaCarry: boolean | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await publishSeasons(db, {
    seasons: [2025, 2026],
    algorithms: [spr],
    bucket: "sigma-carry-test-never-uploaded",
    dryRun: true,
    skipState: true,
    generation: "sigma-carry-test",
    computedAt: "2026-09-28T00:00:00.000Z",
    artifactSink: (_kind, key, body) => {
      out.set(key, body);
    },
    ...(sigmaCarry === undefined ? {} : { sigmaCarry }),
  });
  return out;
}

describe("publishSeasons sigmaCarry", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-sigma-carry-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    seedSeason(db, 2025, "2025test", Date.parse("2025-03-01T15:00:00Z"), 24);
    seedSeason(db, 2026, "2026test", Date.parse("2026-03-01T15:00:00Z"), 24);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("absent and false publish byte-identical bodies", async () => {
    const absent = await bodies(db, undefined);
    const off = await bodies(db, false);
    expect([...off.keys()]).toEqual([...absent.keys()]);
    for (const [key, body] of absent) expect(off.get(key), key).toBe(body);
    expect(absent.size).toBeGreaterThan(0);
  });

  it("ON leaves every Compare page byte-identical (winner odds cannot move) and does move the second season's published Sigma", async () => {
    const off = await bodies(db, undefined);
    const on = await bodies(db, true);
    expect([...on.keys()]).toEqual([...off.keys()]);

    const compareKeys = [...off.keys()].filter((key) => key.startsWith("v1/compare/"));
    expect(compareKeys.length).toBe(2);
    for (const key of compareKeys) expect(on.get(key), key).toBe(off.get(key));

    // The cold-start season carries nothing in, so it is identical too; 2026 is where the carry lands.
    for (const [key, body] of off) if (key.includes("/2025/")) expect(on.get(key), key).toBe(body);
    const changed2026 = [...off.keys()].filter((key) => key.startsWith("v1/team/") && key.includes("/2026/") && on.get(key) !== off.get(key));
    expect(changed2026.length).toBeGreaterThan(0);
  });
});
