/**
 * `spliceEventStateBlock`: the live Worker's block maintenance, as a pure
 * function over verbatim rows.
 *
 * The oracle: splicing the rows a tick wrote into a block built from rows A
 * must equal building the block from rows A with those written rows applied.
 * Synthetic rows suffice because neither function parses a team row's
 * `stateJson`; only `buildEventStateBlock` reads the league row's shape
 * version, so the league rows here declare the current one.
 */
import { describe, expect, it } from "vitest";
import { spr } from "../core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, DEMO_TEAM_KEYS } from "../core/algorithms/demoTeams.js";
import { buildEventStateBlock, EventStateBlockError, spliceEventStateBlock } from "./eventStatePricing.js";
import { STATE_SNAPSHOT_SHAPE_VERSION, type StateRow } from "./stateSnapshot.js";
import type { EventStateBlock } from "./pageArtifacts.js";

const SEED = { generation: "seed-gen", computedAt: "2026-09-01T00:00:00.000Z" };
const TICK = { generation: "tick-1", computedAt: "2026-09-15T12:00:00.000Z" };

function leagueRow(marker: string, stamp = SEED, overrides: Partial<StateRow> = {}): StateRow {
  return {
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    scopeKind: "league",
    scopeKey: "league",
    stateJson: JSON.stringify({ marker, snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION }),
    ...stamp,
    ...overrides,
  };
}

function teamRow(teamKey: string, marker: string, stamp = SEED, overrides: Partial<StateRow> = {}): StateRow {
  return {
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    scopeKind: "team",
    scopeKey: teamKey,
    stateJson: `{"marker":"${marker}","team":"${teamKey}"}`,
    ...stamp,
    ...overrides,
  };
}

function eventRow(eventKey: string, overrides: Partial<StateRow> = {}): StateRow {
  return { algorithmId: "opr", algorithmVersion: "9.9.9", scopeKind: "event", scopeKey: eventKey, stateJson: "{}", ...TICK, ...overrides };
}

/** `rows` with each written row replacing the row of the same scope, or added. */
function applyWritten(rows: readonly StateRow[], written: readonly StateRow[]): StateRow[] {
  const byIdentity = new Map(rows.map((row) => [`${row.scopeKind}:${row.scopeKey}`, row]));
  for (const row of written) byIdentity.set(`${row.scopeKind}:${row.scopeKey}`, row);
  return [...byIdentity.values()];
}

const ROSTER = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc10", "frc7"];
const ROWS_A: readonly StateRow[] = [
  leagueRow("seed"),
  ...["frc1", "frc2", "frc3", "frc4", "frc5", "frc10"].map((k) => teamRow(k, "seed")),
  // Outside the roster: never in the block.
  teamRow("frc99", "seed"),
];

describe("spliceEventStateBlock — the oracle", () => {
  it("splice(build(A), written, touched) equals build(A with written applied) for touched teams on the roster", () => {
    const written = [leagueRow("tick", TICK), teamRow("frc2", "tick", TICK), teamRow("frc10", "tick", TICK), teamRow("frc7", "tick", TICK)];
    const touched = ["frc2", "frc10", "frc7"];
    const spliced = spliceEventStateBlock(buildEventStateBlock(ROWS_A, ROSTER), written, touched);
    const expected = buildEventStateBlock(applyWritten(ROWS_A, written), ROSTER);
    expect(spliced).toEqual(expected);
    expect(JSON.stringify(spliced)).toBe(JSON.stringify(expected));
    // Non-vacuity: the splice changed the block, and frc7 (no row in A) was inserted.
    expect(spliced).not.toEqual(buildEventStateBlock(ROWS_A, ROSTER));
    expect(spliced.rows.map((r) => r.scopeKey)).toContain("frc7");
  });

  it("orders the league row first, then team rows by ascending key, whatever order the written rows come in", () => {
    const written = [teamRow("frc7", "tick", TICK), teamRow("frc10", "tick", TICK), leagueRow("tick", TICK), teamRow("frc2", "tick", TICK)];
    const spliced = spliceEventStateBlock(buildEventStateBlock(ROWS_A, ROSTER), written, ["frc7", "frc10", "frc2"]);
    expect(spliced.rows.map((r) => `${r.scopeKind}:${r.scopeKey}`)).toEqual([
      "league:league",
      "team:frc1",
      "team:frc10",
      "team:frc2",
      "team:frc3",
      "team:frc4",
      "team:frc5",
      "team:frc7",
    ]);
  });

  it("carries an untouched row field for field, with the identical stateJson string, and never mutates its inputs", () => {
    const block = buildEventStateBlock(ROWS_A, ROSTER);
    const snapshot = JSON.stringify(block);
    const written = [leagueRow("tick", TICK), teamRow("frc2", "tick", TICK)];
    const writtenSnapshot = JSON.stringify(written);
    const spliced = spliceEventStateBlock(block, written, ["frc2"]);
    const before = block.rows.find((r) => r.scopeKey === "frc3")!;
    const after = spliced.rows.find((r) => r.scopeKey === "frc3")!;
    expect(after).toEqual(before);
    expect(after.stateJson).toBe(before.stateJson);
    expect(after.generation).toBe(SEED.generation);
    expect(JSON.stringify(block)).toBe(snapshot);
    expect(JSON.stringify(written)).toBe(writtenSnapshot);
  });

  it("replaces a block row the tick rewrote even when the tick did not list that team as touched", () => {
    const spliced = spliceEventStateBlock(buildEventStateBlock(ROWS_A, ROSTER), [teamRow("frc4", "tick", TICK)], []);
    expect(spliced.rows.find((r) => r.scopeKey === "frc4")).toEqual({ ...teamRow("frc4", "tick", TICK), scopeKind: "team" });
  });
});

describe("spliceEventStateBlock — rows it ignores", () => {
  it("ignores a written team row outside the block and outside the touched teams", () => {
    const block = buildEventStateBlock(ROWS_A, ROSTER);
    const spliced = spliceEventStateBlock(block, [teamRow("frc42", "tick", TICK)], ["frc2"]);
    expect(spliced).toEqual(block);
    expect(spliced.rows.map((r) => r.scopeKey)).not.toContain("frc42");
  });

  it("admits the demo pseudo-team row when a touched key is a demo key", () => {
    const demoKey = [...DEMO_TEAM_KEYS][0]!;
    const block = buildEventStateBlock(ROWS_A, ROSTER);
    expect(block.rows.map((r) => r.scopeKey)).not.toContain(DEMO_PSEUDO_TEAM_KEY);
    const pseudo = teamRow(DEMO_PSEUDO_TEAM_KEY, "tick", TICK);
    const spliced = spliceEventStateBlock(block, [pseudo], [demoKey]);
    expect(spliced.rows.find((r) => r.scopeKey === DEMO_PSEUDO_TEAM_KEY)).toEqual({ ...pseudo, scopeKind: "team" });
    // Without the demo key the same row is ignored.
    expect(spliceEventStateBlock(block, [pseudo], ["frc2"]).rows.map((r) => r.scopeKey)).not.toContain(DEMO_PSEUDO_TEAM_KEY);
  });

  it("ignores written event rows, even ones from another algorithm and version", () => {
    const block = buildEventStateBlock(ROWS_A, ROSTER);
    expect(spliceEventStateBlock(block, [eventRow("2026casj")], ["frc2"])).toEqual(block);
  });
});

describe("spliceEventStateBlock — the four throw conditions", () => {
  const block = (): EventStateBlock => buildEventStateBlock(ROWS_A, ROSTER);

  it("throws when the block is not SPR's", () => {
    expect(() => spliceEventStateBlock({ ...block(), algorithmId: "epa" }, [], [])).toThrow(EventStateBlockError);
  });

  it("throws when the block declares another snapshot shape", () => {
    expect(() => spliceEventStateBlock({ ...block(), snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION - 1 }, [], [])).toThrow(EventStateBlockError);
  });

  it("throws unless the block holds exactly one league row", () => {
    const b = block();
    expect(() => spliceEventStateBlock({ ...b, rows: b.rows.filter((r) => r.scopeKind !== "league") }, [], [])).toThrow(EventStateBlockError);
    expect(() => spliceEventStateBlock({ ...b, rows: [b.rows[0]!, ...b.rows] }, [], [])).toThrow(EventStateBlockError);
  });

  it("throws when a written league or team row carries another algorithm id or version", () => {
    const b = block();
    expect(() => spliceEventStateBlock(b, [teamRow("frc2", "tick", TICK, { algorithmVersion: "0.0.0+stale" })], ["frc2"])).toThrow(EventStateBlockError);
    expect(() => spliceEventStateBlock(b, [leagueRow("tick", TICK, { algorithmVersion: "0.0.0+stale" })], [])).toThrow(EventStateBlockError);
    expect(() => spliceEventStateBlock(b, [leagueRow("tick", TICK, { algorithmId: "epa" })], [])).toThrow(EventStateBlockError);
    // A mismatched row the splice would otherwise ignore still throws: a mixed-version tick is never spliced.
    expect(() => spliceEventStateBlock(b, [teamRow("frc42", "tick", TICK, { algorithmVersion: "0.0.0+stale" })], [])).toThrow(EventStateBlockError);
  });
});
