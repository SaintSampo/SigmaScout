/**
 * Pins two properties of `src/stateProbe.ts` that "it returns 200" would miss:
 *
 *   1. It cannot write to D1, although `wrangler.probe.toml` binds `DB`
 *      read-write (this file is the test-enforced half of the probe's
 *      two-layer write guarantee).
 *   2. It really drives the ranking-point path: `analyticRpPmf` runs, the
 *      partial-roster gate opens, and the counters are not all zero under
 *      `ok: true`.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import stateProbe, { probeSelectionsFor, resolveRpArm } from "../src/stateProbe.js";
import { selectionsFor } from "../src/scheduled.js";
import {
  serializeState,
  withSigmaBeliefs,
  withSigmaPopulation,
  withRpBeliefs,
  withRpMeanShift,
  STATE_SNAPSHOT_SHAPE_VERSION,
  StateRowSchema,
  type StateRow,
} from "../../../packages/harness/stateSnapshot.js";
import { SigmaScoreAccumulator } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS } from "../../../packages/core/rankingPoints/meanShift.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../../../packages/core/algorithms/types.js";
import type { D1Database } from "@cloudflare/workers-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_PROBE_SRC = resolve(__dirname, "../src/stateProbe.ts");
const WRANGLER_PROBE_TOML = resolve(__dirname, "../wrangler.probe.toml");

// Strips block comments too: `stateProbe.ts`'s header names the forbidden
// helpers in prose.

function stripComments(source: string): string {
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

// Transitive local import graph walker — `readFileSync` + a relative-
// specifier regex, resolving `.js` -> `.ts`.

const LOCAL_IMPORT_RE = /from\s+["'](\.\.?\/[^"']+)["']/g;

function resolveLocalImport(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier);
  if (resolved.endsWith(".js")) {
    const asTs = resolved.slice(0, -3) + ".ts";
    if (existsSync(asTs)) return asTs;
  }
  return resolved;
}

/** Every local (relative-specifier) import reachable from `entryFile`, transitively; package specifiers are never followed. */
function collectLocalImportGraph(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const stack = [entryFile];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(LOCAL_IMPORT_RE)) {
      const resolved = resolveLocalImport(file, match[1]!);
      if (!visited.has(resolved)) stack.push(resolved);
    }
  }
  return visited;
}

describe("stateProbe — Group 1: the no-write property, STATIC", () => {
  const importGraph = collectLocalImportGraph(STATE_PROBE_SRC);

  it("never reaches src/scheduled.ts, transitively", () => {
    expect(importGraph.has(resolve(__dirname, "../src/scheduled.ts"))).toBe(false);
  });

  it("never reaches src/artifactWriter.ts, transitively", () => {
    expect(importGraph.has(resolve(__dirname, "../src/artifactWriter.ts"))).toBe(false);
  });

  it("positive control: stripComments actually strips comments and leaves real code alone", () => {
    const fixture = [
      "// writeScopedState mentioned only in a line comment",
      'const real = "not a comment";',
      "/* writeScopedState mentioned only in a",
      "   block comment spanning multiple lines */",
      "const stillHere = writeScopedStateLookalike;",
    ].join("\n");
    const stripped = stripComments(fixture);
    expect(stripped).not.toContain("mentioned only in a line comment");
    expect(stripped).not.toContain("mentioned only in a");
    expect(stripped).not.toContain("block comment spanning multiple lines");
    // Real code survives stripping; a stripper returning "" would make every
    // negative assertion vacuous.
    expect(stripped).toContain("writeScopedStateLookalike");
    expect(stripped).toContain('const real = "not a comment";');
  });

  const bannedIdentifiers = [
    "writeScopedState",
    "writeEventCursor",
    "writeArtifactObject",
    "readArtifactObject",
    ".batch(",
    ".put(",
    "INSERT INTO",
    "DELETE FROM",
    "Date.now(",
    "performance.now(",
  ];
  const strippedSource = stripComments(readFileSync(STATE_PROBE_SRC, "utf8"));
  for (const banned of bannedIdentifiers) {
    it(`comment-stripped stateProbe.ts source never contains "${banned}" in real code`, () => {
      expect(strippedSource).not.toContain(banned);
    });
  }

  describe("wrangler.probe.toml", () => {
    const rawToml = readFileSync(WRANGLER_PROBE_TOML, "utf8");
    const toml = rawToml
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

    it("declares no [[r2_buckets]] block", () => {
      expect(toml).not.toContain("[[r2_buckets]]");
    });
    it("declares no [[kv_namespaces]] block", () => {
      expect(toml).not.toContain("[[kv_namespaces]]");
    });
    it("declares no [triggers] block", () => {
      expect(toml).not.toContain("[triggers]");
    });
    it("declares exactly one [[d1_databases]] block", () => {
      expect([...toml.matchAll(/\[\[d1_databases\]\]/g)]).toHaveLength(1);
    });
    it('points main at "src/stateProbe.ts"', () => {
      expect(toml).toMatch(/^main\s*=\s*"src\/stateProbe\.ts"/m);
    });
    it("declares nodejs_compat", () => {
      expect(toml).toContain("nodejs_compat");
    });
    it('is named "sigmascout-state-probe" — not sigmascout-worker, not sigmascout-fixture-rig', () => {
      expect(toml).toMatch(/^name\s*=\s*"sigmascout-state-probe"/m);
      expect(toml).not.toContain('"sigmascout-worker"');
      expect(toml).not.toContain('"sigmascout-fixture-rig"');
    });
  });
});

describe("stateProbe — Group 2: selection-rule equivalence with the real tick", () => {
  // Only the probe's graph is constrained, so this test may import scheduled.ts.
  const EVENT_KEY = "2026testevt";
  const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

  it.each([
    ["opr (the event-scoped case — the one that matters)", "opr", TEAMS],
    ["epa", "epa", TEAMS],
    ["spr", "spr", TEAMS],
    ["empty roster", "opr", []],
  ])("probeSelectionsFor matches the real selectionsFor for %s — stops the probe reading a different row set than a real tick", (_label, algorithmId, teams) => {
    expect(probeSelectionsFor(algorithmId, EVENT_KEY, teams)).toEqual(selectionsFor(algorithmId, EVENT_KEY, teams));
  });
});

// Group 3 + 4 fixtures: a fake D1Database copied from `stateStore.test.ts`,
// extended to count writes (any `batch()`, any non-SELECT `run()`). The
// behavioral half of Group 1: no write was actually issued.

interface FakeAlgorithmStateRow {
  algorithm_id: string;
  algorithm_version: string;
  scope_kind: string;
  scope_key: string;
  state_json: string;
  generation: string;
  computed_at: string;
}

class FakePreparedStatement {
  readonly sql: string;
  boundArgs: readonly unknown[] = [];
  constructor(
    sql: string,
    private readonly db: FakeD1Database
  ) {
    this.sql = sql;
  }
  bind(...args: unknown[]): FakePreparedStatement {
    const bound = new FakePreparedStatement(this.sql, this.db);
    bound.boundArgs = args;
    return bound;
  }
  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.db.executeSelect(this.sql, this.boundArgs) as T[] };
  }
  async first<T = unknown>(): Promise<T | null> {
    const results = this.db.executeSelect(this.sql, this.boundArgs) as T[];
    return results.length > 0 ? results[0]! : null;
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    this.db.recordRunAsWriteIfMutating(this.sql, this.boundArgs);
    return { success: true, meta: { changes: 0 } };
  }
}

class FakeD1Database {
  /** Any `batch()` call, plus any `run()` whose SQL is not a SELECT — the write-count half of the no-write property. */
  writeStatementCount = 0;
  algorithmState = new Map<string, FakeAlgorithmStateRow>();

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.writeStatementCount += statements.length;
    return statements.map(() => ({ success: true as const }));
  }

  recordRunAsWriteIfMutating(sql: string, _args: readonly unknown[]): void {
    if (!/^\s*SELECT/i.test(sql)) this.writeStatementCount++;
  }

  executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    // The two discovery queries — scope_key-only, LIMIT-bound, no OR groups.
    if (sql.includes("FROM algorithm_state") && sql.includes("algorithm_id = 'spr'") && sql.includes("scope_kind = 'team'")) {
      const limit = args[0] as number;
      return [...this.algorithmState.values()]
        .filter((row) => row.algorithm_id === "spr" && row.scope_kind === "team")
        .sort((a, b) => a.scope_key.localeCompare(b.scope_key))
        .slice(0, limit);
    }
    if (sql.includes("FROM algorithm_state") && sql.includes("algorithm_id = 'opr'") && sql.includes("scope_kind = 'event'")) {
      return [...this.algorithmState.values()]
        .filter((row) => row.algorithm_id === "opr" && row.scope_kind === "event")
        .sort((a, b) => a.scope_key.localeCompare(b.scope_key))
        .slice(0, 1);
    }
    // The real readScopedState shape: `algorithm_id = ? AND ((scope_kind = ?
    // AND scope_key IN (...)) OR ... OR scope_kind = 'league')`.
    if (sql.includes("FROM algorithm_state")) {
      const algorithmId = args[0] as string;
      const groupSizes = [...sql.matchAll(/\(scope_kind = \? AND scope_key IN \(([^)]*)\)\)/g)].map(
        (m) => m[1]!.split(",").filter((s) => s.length > 0).length
      );
      if (groupSizes.length === 0) {
        return [...this.algorithmState.values()].filter((row) => row.algorithm_id === algorithmId && row.scope_kind === "league");
      }
      let idx = 1;
      const matchers: { scopeKind: string; keySet: Set<string> }[] = [];
      for (const size of groupSizes) {
        const scopeKind = args[idx] as string;
        idx += 1;
        const keys = args.slice(idx, idx + size) as string[];
        idx += size;
        matchers.push({ scopeKind, keySet: new Set(keys) });
      }
      return [...this.algorithmState.values()].filter((row) => {
        if (row.algorithm_id !== algorithmId) return false;
        if (row.scope_kind === "league") return true;
        return matchers.some((m) => m.scopeKind === row.scope_kind && m.keySet.has(row.scope_key));
      });
    }
    throw new Error(`FakeD1Database.executeSelect: unrecognized SQL: ${sql}`);
  }
}

function seedRows(db: FakeD1Database, rows: readonly StateRow[]): void {
  for (const row of rows) {
    db.algorithmState.set(`${row.algorithmId}::${row.scopeKind}::${row.scopeKey}`, {
      algorithm_id: row.algorithmId,
      algorithm_version: row.algorithmVersion,
      scope_kind: row.scopeKind,
      scope_key: row.scopeKey,
      state_json: row.stateJson,
      generation: row.generation,
      computed_at: row.computedAt,
    });
  }
}

const SEED_STAMP = { generation: "seed", computedAt: "2026-01-01T00:00:00.000Z" };
const SEED_EVENT_KEY = "2026seedevt";
/** 21 teams, `stateProbe.ts`'s `DEFAULT_TEAM_COUNT`, so no "roster smaller than requested" warning. */
const SEED_ROSTER = Array.from({ length: 21 }, (_, i) => `frc${i + 1}`);

/** The 2026 score-breakdown shape `rp2026.parse` reads — same shape as `scheduled.rp.test.ts`'s `breakdownOf`. */
function seedBreakdown(redHub: number, redTower: number, blueHub: number, blueTower: number): unknown {
  const side = (hub: number, tower: number) => ({
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  });
  return { red: side(redHub, redTower), blue: side(blueHub, blueTower) };
}

function seedMatch(
  matchNumber: number,
  red: readonly string[],
  blue: readonly string[],
  redScore: number,
  blueScore: number,
  redHub: number,
  redTower: number,
  blueHub: number,
  blueTower: number
): MatchResult {
  return {
    matchKey: `${SEED_EVENT_KEY}_qm${matchNumber}`,
    eventKey: SEED_EVENT_KEY,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: red,
    blueTeams: blue,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    week: null,
    winner: redScore > blueScore ? "red" : "blue",
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify(seedBreakdown(redHub, redTower, blueHub, blueTower)),
  };
}

/** Cycles 6 at a time through `SEED_ROSTER`, like `stateProbe.ts`'s `rosterAt`; `ceil(21/6) = 4` matches touch every seeded team. */
function seedRosterAt(index: number): { red: string[]; blue: string[] } {
  const n = SEED_ROSTER.length;
  const start = (index * 6) % n;
  const picks: string[] = [];
  for (let i = 0; i < 6; i++) picks.push(SEED_ROSTER[(start + i) % n]!);
  return { red: picks.slice(0, 3), blue: picks.slice(3, 6) };
}

const SEED_MATCH_COUNT = 4;
const SEED_MATCHES: readonly MatchResult[] = Array.from({ length: SEED_MATCH_COUNT }, (_, i) => {
  const { red, blue } = seedRosterAt(i);
  return seedMatch(i + 1, red, blue, 120 + i * 3, 100 + i * 2, 140 + i * 4, 40 + i, 110 + i * 3, 36 + i);
});

/**
 * Seeds a `FakeD1Database` with real rows for all three published algorithms
 * (real `initState`/`update`/`serializeState` and, for spr, real accumulators),
 * never hand-written JSON. Seeding through the probe's roster cycle makes the
 * RP beliefs cover its fold, so the partial-roster gate stays open.
 */
function seedAllAlgorithms(db: FakeD1Database): void {
  let oprState = opr.initState([...SEED_ROSTER]);
  for (const m of SEED_MATCHES) oprState = opr.update(oprState, m);
  seedRows(db, serializeState("opr", opr.version, oprState, SEED_STAMP));

  let epaState = epa.initState([...SEED_ROSTER]);
  for (const m of SEED_MATCHES) epaState = epa.update(epaState, m);
  seedRows(db, serializeState("epa", epa.version, epaState, SEED_STAMP));

  let sprState = spr.initState([...SEED_ROSTER]);
  const sigma = new SigmaScoreAccumulator();
  const rpRuleModule = RP_RULE_MODULES[2026]!;
  const rp = new RpMomentsAccumulator(rpRuleModule);
  for (const m of SEED_MATCHES) {
    const prediction = spr.predict(sprState, toLeakProofUpcoming(m));
    sprState = spr.update(sprState, m);
    sigma.foldMatch(m, prediction);
    for (const side of ["red", "blue"] as const) {
      try {
        const parsed = rpRuleModule.parse(JSON.parse(m.scoreBreakdownRaw!), side, m.eventType);
        rp.fold(side === "red" ? m.redTeams : m.blueTeams, parsed.thresholdVariables);
      } catch {
        // matches scheduled.ts's own degrade-to-a-counted-skip
      }
    }
    const roster = [...m.redTeams, ...m.blueTeams];
    const metrics = spr.teamMetrics(sprState, roster);
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) sigma.observeTalent(teamKey, total);
    }
  }
  let sprRows = serializeState("spr", spr.version, sprState, SEED_STAMP);
  sprRows = withRpBeliefs(sprRows, rp.beliefsByTeam());
  sprRows = withSigmaPopulation(withSigmaBeliefs(sprRows, sigma.beliefsByTeam()), sigma.population());
  seedRows(db, sprRows);
}

describe("stateProbe — Group 3: the RP path really runs, and really writes nothing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("folds+prices the real RP path end to end and issues zero D1 writes", async () => {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);

    const request = new Request("https://probe/?folded=2&upcoming=5&season=2026");
    const response = await stateProbe.fetch(request, { DB: db as unknown as D1Database });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      algorithms: { id: string; ok: boolean; snapshotShapeVersionObserved: unknown }[];
      fold: {
        matchesFolded: number;
        upcomingPriced: number;
        bandsProduced: number;
        rpPmfsProduced: number;
        rpObservedFolds: number;
        changedRowsDiscarded: number;
      };
      warnings: string[];
    };

    expect(body.ok).toBe(true);

    const sprEntry = body.algorithms.find((a) => a.id === "spr");
    expect(sprEntry?.ok).toBe(true);
    expect(sprEntry?.snapshotShapeVersionObserved).toBe(STATE_SNAPSHOT_SHAPE_VERSION);

    expect(body.fold.matchesFolded).toBe(2);
    expect(body.fold.upcomingPriced).toBe(5);
    // Equality, not `> 0`, which would pass with six of seven pmfs suppressed.
    expect(body.fold.rpPmfsProduced).toBe(7);
    expect(body.fold.bandsProduced).toBeGreaterThan(0);
    expect(body.fold.rpObservedFolds).toBeGreaterThan(0);
    expect(body.fold.changedRowsDiscarded).toBeGreaterThan(0);

    expect(body.warnings).toEqual([]);

    // The behavioral half of Group 1: no write was actually issued.
    expect(db.writeStatementCount).toBe(0);
  });
});

describe("stateProbe — Group 4: the shape-mismatch report is readable, not an opaque failure", () => {
  it("reports LeagueRowShapeVersionError by name and message when a league row is stale", async () => {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);

    // Re-seed spr's league row alone at a STALE shape version.
    const staleKey = "spr::league::league";
    const existing = db.algorithmState.get(staleKey)!;
    const stale = JSON.parse(existing.state_json) as Record<string, unknown>;
    stale.snapshotShapeVersion = STATE_SNAPSHOT_SHAPE_VERSION - 1;
    db.algorithmState.set(staleKey, { ...existing, state_json: JSON.stringify(stale) });

    const request = new Request("https://probe/?folded=1&upcoming=1&season=2026");
    const response = await stateProbe.fetch(request, { DB: db as unknown as D1Database });

    // Not an opaque error page — the body parses as JSON either way.
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      ok: boolean;
      algorithms: { id: string; ok: boolean; error?: { name: string; message: string } }[];
    };
    expect(body.ok).toBe(false);

    const sprEntry = body.algorithms.find((a) => a.id === "spr");
    expect(sprEntry?.ok).toBe(false);
    expect(sprEntry?.error?.name).toBe("LeagueRowShapeVersionError");
    expect(sprEntry?.error?.message).toContain(String(STATE_SNAPSHOT_SHAPE_VERSION));
    expect(sprEntry?.error?.message).toContain(String(STATE_SNAPSHOT_SHAPE_VERSION - 1));

    // Still zero writes on a failing run.
    expect(db.writeStatementCount).toBe(0);
  });

  it("algorithms=spr reads spr alone, so a stale opr/epa row cannot fail a live-tier measurement, and the fold is byte-identical", async () => {
    const staleOthers = () => {
      const db = new FakeD1Database();
      seedAllAlgorithms(db);
      for (const id of ["opr", "epa"]) {
        const key = `${id}::league::league`;
        const existing = db.algorithmState.get(key)!;
        const stale = JSON.parse(existing.state_json) as Record<string, unknown>;
        stale.snapshotShapeVersion = STATE_SNAPSHOT_SHAPE_VERSION - 1;
        db.algorithmState.set(key, { ...existing, state_json: JSON.stringify(stale) });
      }
      return db;
    };
    const run = async (query: string) => {
      const db = staleOthers();
      const response = await stateProbe.fetch(new Request(`https://probe/?folded=2&upcoming=5&season=2026${query}`), { DB: db as unknown as D1Database });
      const body = (await response.json()) as { ok: boolean; params: { algorithms: string[] }; algorithms: { id: string; ok: boolean }[]; fold: unknown; warnings: string[] };
      return { status: response.status, body, writes: db.writeStatementCount };
    };

    const all = await run("");
    expect(all.status).toBe(500);
    expect(all.body.params.algorithms).toEqual(["opr", "epa", "spr"]);

    const sprOnly = await run("&algorithms=spr");
    expect(sprOnly.status).toBe(200);
    expect(sprOnly.body.ok).toBe(true);
    expect(sprOnly.body.params.algorithms).toEqual(["spr"]);
    expect(sprOnly.body.algorithms.map((a) => a.id)).toEqual(["spr"]);
    expect(sprOnly.body.warnings).toEqual(all.body.warnings);
    expect(sprOnly.body.fold).toEqual(all.body.fold);
    expect(sprOnly.writes).toBe(0);

    const typo = await run("&algorithms=opr,sprr");
    expect(typo.body.params.algorithms).toEqual(["opr", "spr"]);
    expect(typo.body.warnings.filter((w) => w.startsWith("algorithms="))).toEqual([
      `algorithms= named unknown id(s) ["sprr"]; ignored (accepted: opr, epa, spr)`,
      "algorithms= omitted spr; spr was added back because the fold needs it",
    ]);
  });
});

// Group 5: the `rp` ablation arm.
//
// Group 3 passes no `rp` param, so it is the default-ON regression proof.
// The load-bearing assertion here is `bandsProduced` equal across arms: an
// ablation that also dropped bands would overstate ranking points' CPU share.

interface ArmBody {
  ok: boolean;
  params: { folded: number; upcoming: number; rp: boolean };
  fold: {
    matchesFolded: number;
    upcomingPriced: number;
    bandsProduced: number;
    rpPmfsProduced: number;
    rpObservedFolds: number;
    changedRowsDiscarded: number;
    error?: { name: string; message: string };
  };
  warnings: string[];
}

const ARM_FOLDED = 2;
const ARM_UPCOMING = 5;
const ARM_QUERY = `folded=${ARM_FOLDED}&upcoming=${ARM_UPCOMING}&season=2026`;

async function runArm(query: string): Promise<{ body: ArmBody; text: string; status: number; writes: number }> {
  const db = new FakeD1Database();
  seedAllAlgorithms(db);
  const response = await stateProbe.fetch(new Request(`https://probe/?${query}`), { DB: db as unknown as D1Database });
  const text = await response.text();
  return { body: JSON.parse(text) as ArmBody, text, status: response.status, writes: db.writeStatementCount };
}

describe("stateProbe — Group 5: the rp ablation arm", () => {
  it("defaults ON: an absent rp= produces a byte-identical response to rp=1", async () => {
    const absent = await runArm(ARM_QUERY);
    const explicit = await runArm(`${ARM_QUERY}&rp=1`);

    // Byte-identical, not merely deep-equal: the default must change nothing.
    expect(absent.text).toBe(explicit.text);
    expect(absent.status).toBe(200);
    expect(absent.body.params.rp).toBe(true);
    expect(absent.body.warnings).toEqual([]);
  });

  it("pins BOTH arms by equality — never an inequality, which would pass vacuously", async () => {
    const on = await runArm(`${ARM_QUERY}&rp=1`);
    const off = await runArm(`${ARM_QUERY}&rp=0`);

    expect(on.status).toBe(200);
    expect(off.status).toBe(200);
    expect(on.body.ok).toBe(true);
    expect(off.body.ok).toBe(true);
    expect(on.body.fold.error).toBeUndefined();
    expect(off.body.fold.error).toBeUndefined();

    // The arm is echoed so a `wrangler tail` cpuTime is never misattributed.
    expect(on.body.params.rp).toBe(true);
    expect(off.body.params.rp).toBe(false);

    // ON arm: every match gets a pmf, pinned by equality as in Group 3.
    expect(on.body.fold.rpPmfsProduced).toBe(ARM_FOLDED + ARM_UPCOMING);
    expect(on.body.fold.rpObservedFolds).toBeGreaterThan(0);

    // OFF arm: 0 by construction, pinned by equality.
    expect(off.body.fold.rpPmfsProduced).toBe(0);
    expect(off.body.fold.rpObservedFolds).toBe(0);

    // Non-vacuity: the arms differ, so both producing 0 would fail.
    expect(on.body.fold.rpPmfsProduced).not.toBe(off.body.fold.rpPmfsProduced);

    // Both loops still run in both arms.
    expect(off.body.fold.matchesFolded).toBe(on.body.fold.matchesFolded);
    expect(off.body.fold.upcomingPriced).toBe(on.body.fold.upcomingPriced);
    expect(off.body.fold.matchesFolded).toBe(ARM_FOLDED);
    expect(off.body.fold.upcomingPriced).toBe(ARM_UPCOMING);

    // Bands are identical across arms: two alliances per match, every roster banded.
    expect(off.body.fold.bandsProduced).toBe(on.body.fold.bandsProduced);
    expect(on.body.fold.bandsProduced).toBe(2 * (ARM_FOLDED + ARM_UPCOMING));

    // Serialize-and-discard still happens in the off arm; only the
    // `withRpBeliefs` passenger is missing from the candidate rows.
    expect(off.body.fold.changedRowsDiscarded).toBeGreaterThan(0);

    // The probe's no-write property holds in the ablated arm too.
    expect(on.writes).toBe(0);
    expect(off.writes).toBe(0);
  });

  it("names the ablated arm in warnings, and warns nothing extra in the ON arm", async () => {
    const on = await runArm(`${ARM_QUERY}&rp=1`);
    const off = await runArm(`${ARM_QUERY}&rp=0`);

    expect(on.body.warnings).toEqual([]);
    expect(off.body.warnings).toHaveLength(1);
    expect(off.body.warnings[0]).toContain("rp=0");
    expect(off.body.warnings[0]).toContain("ABLATED ARM");

    // The off arm must NOT inherit the "every RP pmf was suppressed" warning,
    // none of whose named causes happened here.
    expect(off.body.warnings.join(" ")).not.toContain("partial-roster gate");
  });

  it("treats an unrecognized rp= value as ON and says so, rather than silently picking an arm", async () => {
    const typo = await runArm(`${ARM_QUERY}&rp=fasle`);

    expect(typo.body.params.rp).toBe(true);
    expect(typo.body.fold.rpPmfsProduced).toBe(ARM_FOLDED + ARM_UPCOMING);
    expect(typo.body.warnings).toHaveLength(1);
    expect(typo.body.warnings[0]).toContain('rp="fasle"');
    expect(typo.body.warnings[0]).toContain("ENABLED");
  });

  it("accepts the spelled-out off values, so a runbook reader cannot miss the arm", async () => {
    for (const value of ["0", "off", "false", "no", "OFF", "False"]) {
      const arm = await runArm(`${ARM_QUERY}&rp=${value}`);
      expect(arm.body.params.rp, `rp=${value} should ablate`).toBe(false);
      expect(arm.body.fold.rpPmfsProduced, `rp=${value} should produce no pmfs`).toBe(0);
    }
  });
});

// Group 6: the mean shift.
//
// The probe cannot expose its pmfs, so the mirror of `scheduled.ts` is proven
// through two counters an independent computation predicts exactly: residuals
// `observeMatch` booked and alliances `apply` moved. Every seeded team has
// history of both 2026 variables, so every synthetic roster is fully warm.

/** A past-warmup passenger, hand-built: the probe prices from whatever D1 holds, so what matters here is that it RESUMES one. */
const SEEDED_SHIFT = {
  season: 2026,
  variables: {
    hubTotalCount: { count: RP_MEAN_SHIFT_WARMUP_OBSERVATIONS + 40, sum: 480 },
    totalTowerPoints: { count: RP_MEAN_SHIFT_WARMUP_OBSERVATIONS + 40, sum: 360 },
  },
};

function seedMeanShift(db: FakeD1Database, shift: typeof SEEDED_SHIFT): void {
  const key = "spr::league::league";
  const row = db.algorithmState.get(key)!;
  const [withShift] = withRpMeanShift(
    [
      StateRowSchema.parse({
        algorithmId: row.algorithm_id,
        algorithmVersion: row.algorithm_version,
        scopeKind: row.scope_kind,
        scopeKey: row.scope_key,
        stateJson: row.state_json,
        generation: row.generation,
        computedAt: row.computed_at,
      }),
    ],
    shift
  );
  db.algorithmState.set(key, { ...row, state_json: withShift!.stateJson });
}

async function runShiftArm(query: string, shift: typeof SEEDED_SHIFT | undefined): Promise<{ body: ArmBody & { fold: { rpMeanShiftObservations: number; rpMeanShiftedAlliances: number } }; writes: number; status: number }> {
  const db = new FakeD1Database();
  seedAllAlgorithms(db);
  if (shift !== undefined) seedMeanShift(db, shift);
  const response = await stateProbe.fetch(new Request(`https://probe/?${query}`), { DB: db as unknown as D1Database });
  return { body: JSON.parse(await response.text()), writes: db.writeStatementCount, status: response.status };
}

describe("stateProbe — Group 6: the mean shift mirrors scheduled.ts (shape 16)", () => {
  const variableCount = RP_RULE_MODULES[2026]!.thresholdVariables.length;

  it("resumes a seeded past-warmup shift and applies it to every alliance priced, in both loops", async () => {
    const arm = await runShiftArm(`${ARM_QUERY}&rp=1`, SEEDED_SHIFT);
    expect(arm.status).toBe(200);
    expect(arm.body.fold.error).toBeUndefined();
    expect(arm.body.fold.rpPmfsProduced).toBe(ARM_FOLDED + ARM_UPCOMING);
    // Two alliances per match, every roster fully warm, both variables past warmup.
    expect(arm.body.fold.rpMeanShiftedAlliances).toBe(2 * (ARM_FOLDED + ARM_UPCOMING));
    // Played matches only: two sides, one residual per variable per side.
    expect(arm.body.fold.rpMeanShiftObservations).toBe(ARM_FOLDED * 2 * variableCount);
    expect(arm.writes).toBe(0);
  });

  it("with no passenger it resumes a FRESH shift: residuals still book, nothing is applied", async () => {
    const arm = await runShiftArm(`${ARM_QUERY}&rp=1`, undefined);
    expect(arm.body.fold.rpMeanShiftedAlliances).toBe(0);
    expect(arm.body.fold.rpMeanShiftObservations).toBe(ARM_FOLDED * 2 * variableCount);
    expect(arm.writes).toBe(0);
  });

  it("a passenger from ANOTHER season is discarded, exactly as fromState discards it in the Worker", async () => {
    const arm = await runShiftArm(`${ARM_QUERY}&rp=1`, { ...SEEDED_SHIFT, season: 2025 });
    expect(arm.body.fold.rpMeanShiftedAlliances).toBe(0);
    expect(arm.body.fold.rpMeanShiftObservations).toBe(ARM_FOLDED * 2 * variableCount);
  });

  it("rp=0 ablates the mean shift with the rest of the RP path", async () => {
    const arm = await runShiftArm(`${ARM_QUERY}&rp=0`, SEEDED_SHIFT);
    expect(arm.body.fold.rpMeanShiftedAlliances).toBe(0);
    expect(arm.body.fold.rpMeanShiftObservations).toBe(0);
    expect(arm.writes).toBe(0);
  });

  it("the probe's source performs the same four mean-shift operations scheduled.ts does", () => {
    // The counters prove resume, apply and observe; the write-back only reaches
    // discarded rows, so it is pinned here.
    const probe = stripComments(readFileSync(STATE_PROBE_SRC, "utf8"));
    const worker = stripComments(readFileSync(resolve(__dirname, "../src/scheduled.ts"), "utf8"));
    for (const operation of ["RpMeanShiftAccumulator.fromState(", "readRpMeanShift(", ".apply(", "rosterIsFullyWarm(", ".observeMatch(", "withRpMeanShift("]) {
      expect(worker, `scheduled.ts no longer calls ${operation}`).toContain(operation);
      expect(probe, `stateProbe.ts no longer mirrors ${operation}`).toContain(operation);
    }
  });
});


// Group 7: the Phase A mirror guard.
//
// Groups 1-6 pin RP/mean-shift SEMANTICS. This group pins SHAPE: every call
// the live tick's Phase A makes (minus a four-name tick-only skeleton
// allowlist) must appear, by name, somewhere in the probe's source. A future
// refactor that adds a call to `processEvent`'s Phase A without adding it
// here fails this group, rather than silently drifting.

const PHASE_A_START_MARKER = "for (const [algorithmId, algorithm] of algorithmModules) {";
const PHASE_A_END_MARKER = "perAlgorithm.set(algorithmId";

/** Slices `source` from the Phase A start marker up to (not including) the end marker. Throws, naming whichever marker is absent, rather than silently returning an empty or wrong-bounded region. */
function extractPhaseARegion(source: string): string {
  const startIdx = source.indexOf(PHASE_A_START_MARKER);
  if (startIdx === -1) {
    throw new Error(`extractPhaseARegion: missing start marker ${JSON.stringify(PHASE_A_START_MARKER)} — scheduled.ts's Phase A loop was renamed or restructured`);
  }
  const endIdx = source.indexOf(PHASE_A_END_MARKER, startIdx);
  if (endIdx === -1) {
    throw new Error(`extractPhaseARegion: missing end marker ${JSON.stringify(PHASE_A_END_MARKER)} — scheduled.ts's Phase A loop was renamed or restructured`);
  }
  return source.slice(startIdx, endIdx);
}

const CALL_NAME_RE = /([A-Za-z_$][\w$]*)\s*\(/g;
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "typeof", "function"]);

/** Every identifier immediately followed by `(`, minus JS keywords — a call-name set, not a full parse. */
function extractCallNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(CALL_NAME_RE)) {
    const name = match[1]!;
    if (JS_KEYWORDS.has(name)) continue;
    names.add(name);
  }
  return names;
}

describe("stateProbe — Group 7: Phase A mirror guard (call-name equivalence with scheduled.ts)", () => {
  const strippedWorker = stripComments(readFileSync(resolve(__dirname, "../src/scheduled.ts"), "utf8"));
  const strippedProbe = stripComments(readFileSync(STATE_PROBE_SRC, "utf8"));
  const phaseARegion = extractPhaseARegion(strippedWorker);
  const callNames = extractCallNames(phaseARegion);

  it("test A: extracts a non-empty Phase A region, and throws by name when a marker is missing", () => {
    expect(phaseARegion.length).toBeGreaterThan(0);
    expect(() => extractPhaseARegion("no markers in this source at all")).toThrow(/missing start marker/);
    expect(() => extractPhaseARegion(PHASE_A_START_MARKER)).toThrow(/missing end marker/);
  });

  it("test B (positive control): the extracted call-name set is non-trivial and includes the calls this task must re-mirror", () => {
    expect(callNames.size).toBeGreaterThanOrEqual(25);
    for (const name of ["analyticRpPmf", "withRpBeliefs", "sigmaMatchBandVariance", "publishesRankingPoints", "teamMetrics", "sigmaFor"]) {
      expect(callNames, `Phase A no longer calls ${name} — update the positive control`).toContain(name);
    }
  });

  // Mirrors scheduled.ts's own skeleton, not RP semantics — see each entry's comment.
  const TICK_ONLY_ALLOWLIST = new Set([
    "selectionsFor", // the probe's copy is probeSelectionsFor, pinned equal by Group 2.
    "loadOrInitState", // the probe calls readScopedState plus deserializeState, and deliberately never takes the initState cold path.
    "consume", // subrequest budget bookkeeping that the probe does not have.
    "writeScopedState", // forbidden in the probe, and Group 1 bans it.
  ]);

  it("test C: every mirrored call name (minus the tick-only allowlist) appears in the probe's source", () => {
    const missing: string[] = [];
    for (const name of callNames) {
      if (TICK_ONLY_ALLOWLIST.has(name)) continue;
      if (!strippedProbe.includes(`${name}(`)) missing.push(name);
    }
    expect(missing, `probe.ts is missing these Phase A calls: ${missing.join(", ")}`).toEqual([]);
  });
});

// Group 8: per-component RP ablation arms (`rpSkip`), layered on top of `rp`.
//
// Uses the Group 6 fixture with SEEDED_SHIFT, so the mean shift's `apply` is
// observable (every seeded team is fully warm for both 2026 variables).

interface Group8Fold {
  matchesFolded: number;
  upcomingPriced: number;
  bandsProduced: number;
  rpPmfsProduced: number;
  rpObservedFolds: number;
  rpMeanShiftObservations: number;
  rpMeanShiftedAlliances: number;
  rpBeliefTeamsResumed: number;
  rpGatesOpened: number;
  rpBeliefTeamsAttached: number;
  rpMeanShiftAttached: boolean;
  changedRowsDiscarded: number;
  error?: { name: string; message: string };
}

interface Group8Ran {
  resume: boolean;
  foldedPmf: boolean;
  upcomingPmf: boolean;
  formula: boolean;
  observe: boolean;
  beliefs: boolean;
}

interface Group8Body {
  ok: boolean;
  params: { rp: boolean; rpArm: { id: string; ran: Group8Ran } };
  fold: Group8Fold;
  warnings: string[];
}

async function runGroup8Arm(query: string, shift: typeof SEEDED_SHIFT | undefined): Promise<{ body: Group8Body; writes: number; status: number }> {
  const db = new FakeD1Database();
  seedAllAlgorithms(db);
  if (shift !== undefined) seedMeanShift(db, shift);
  const response = await stateProbe.fetch(new Request(`https://probe/?${query}`), { DB: db as unknown as D1Database });
  return { body: JSON.parse(await response.text()) as Group8Body, writes: db.writeStatementCount, status: response.status };
}

describe("stateProbe — Group 8: per-component RP ablation arms (rpSkip)", () => {
  const variableCount = RP_RULE_MODULES[2026]!.thresholdVariables.length;
  const shiftObsWhenObserved = 2 * ARM_FOLDED * variableCount;
  const ALL_BANDS = 2 * (ARM_FOLDED + ARM_UPCOMING);

  interface ArmCase {
    readonly label: string;
    readonly query: string;
    readonly expectedId: string;
    readonly ran: Group8Ran;
    readonly resumed: number;
    readonly gates: number;
    readonly pmfs: number;
    readonly shifted: number;
    readonly obsFolds: number;
    readonly shiftObs: number;
    readonly attached: number;
    readonly shiftAtt: boolean;
  }

  const RAN_ALL: Group8Ran = { resume: true, foldedPmf: true, upcomingPmf: true, formula: true, observe: true, beliefs: true };
  const RAN_NONE: Group8Ran = { resume: false, foldedPmf: false, upcomingPmf: false, formula: false, observe: false, beliefs: false };

  const CASES: readonly ArmCase[] = [
    {
      label: "all",
      query: `${ARM_QUERY}&rp=1`,
      expectedId: "all",
      ran: RAN_ALL,
      resumed: 21,
      gates: 7,
      pmfs: 7,
      shifted: 14,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "none",
      query: `${ARM_QUERY}&rp=0`,
      expectedId: "none",
      ran: RAN_NONE,
      resumed: 0,
      gates: 0,
      pmfs: 0,
      shifted: 0,
      obsFolds: 0,
      shiftObs: 0,
      attached: 0,
      shiftAtt: false,
    },
    {
      label: "resumeOnly",
      query: `${ARM_QUERY}&rpSkip=foldedPmf,upcomingPmf,observe,beliefs`,
      expectedId: "skip:foldedPmf,upcomingPmf,observe,beliefs",
      ran: { resume: true, foldedPmf: false, upcomingPmf: false, formula: false, observe: false, beliefs: false },
      resumed: 21,
      gates: 0,
      pmfs: 0,
      shifted: 0,
      obsFolds: 0,
      shiftObs: 0,
      attached: 0,
      shiftAtt: false,
    },
    {
      label: "skipFoldedPmf",
      query: `${ARM_QUERY}&rpSkip=foldedPmf`,
      expectedId: "skip:foldedPmf",
      ran: { resume: true, foldedPmf: false, upcomingPmf: true, formula: true, observe: true, beliefs: true },
      resumed: 21,
      gates: 5,
      pmfs: 5,
      shifted: 10,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipUpcomingPmf",
      query: `${ARM_QUERY}&rpSkip=upcomingPmf`,
      expectedId: "skip:upcomingPmf",
      ran: { resume: true, foldedPmf: true, upcomingPmf: false, formula: true, observe: true, beliefs: true },
      resumed: 21,
      gates: 2,
      pmfs: 2,
      shifted: 4,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipBothPmf",
      query: `${ARM_QUERY}&rpSkip=foldedPmf,upcomingPmf`,
      expectedId: "skip:foldedPmf,upcomingPmf",
      ran: { resume: true, foldedPmf: false, upcomingPmf: false, formula: false, observe: true, beliefs: true },
      resumed: 21,
      gates: 0,
      pmfs: 0,
      shifted: 0,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipFormula",
      query: `${ARM_QUERY}&rpSkip=formula`,
      expectedId: "skip:formula",
      ran: { resume: true, foldedPmf: true, upcomingPmf: true, formula: false, observe: true, beliefs: true },
      resumed: 21,
      gates: 7,
      pmfs: 0,
      shifted: 14,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipObserve",
      query: `${ARM_QUERY}&rpSkip=observe`,
      expectedId: "skip:observe",
      ran: { resume: true, foldedPmf: true, upcomingPmf: true, formula: true, observe: false, beliefs: true },
      resumed: 21,
      gates: 7,
      pmfs: 7,
      shifted: 14,
      obsFolds: 0,
      shiftObs: 0,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipBeliefs",
      query: `${ARM_QUERY}&rpSkip=beliefs`,
      expectedId: "skip:beliefs",
      ran: { resume: true, foldedPmf: true, upcomingPmf: true, formula: true, observe: true, beliefs: false },
      resumed: 21,
      gates: 7,
      pmfs: 7,
      shifted: 14,
      obsFolds: 4,
      shiftObs: shiftObsWhenObserved,
      attached: 0,
      shiftAtt: false,
    },
  ];

  it.each(CASES.map((c) => [c.label, c] as const))(
    "arm %s: id, ran, counters, bandsProduced, matches, D1 writes and warning shape are pinned by equality",
    async (_label, c) => {
      const { body, writes, status } = await runGroup8Arm(c.query, SEEDED_SHIFT);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.fold.error).toBeUndefined();

      expect(body.params.rpArm.id).toBe(c.expectedId);
      expect(body.params.rpArm.ran).toEqual(c.ran);
      expect(body.params.rp).toBe(c.ran.resume);

      expect(body.fold.matchesFolded).toBe(ARM_FOLDED);
      expect(body.fold.upcomingPriced).toBe(ARM_UPCOMING);
      expect(body.fold.bandsProduced).toBe(14);
      expect(body.fold.bandsProduced).toBe(ALL_BANDS);

      expect(body.fold.rpBeliefTeamsResumed).toBe(c.resumed);
      expect(body.fold.rpGatesOpened).toBe(c.gates);
      expect(body.fold.rpPmfsProduced).toBe(c.pmfs);
      expect(body.fold.rpMeanShiftedAlliances).toBe(c.shifted);
      expect(body.fold.rpObservedFolds).toBe(c.obsFolds);
      expect(body.fold.rpMeanShiftObservations).toBe(c.shiftObs);
      expect(body.fold.rpBeliefTeamsAttached).toBe(c.attached);
      expect(body.fold.rpMeanShiftAttached).toBe(c.shiftAtt);

      expect(writes).toBe(0);

      if (c.label === "all") {
        expect(body.warnings).toEqual([]);
      } else {
        expect(body.warnings).toHaveLength(1);
        expect(body.warnings[0]).toContain("ABLATED ARM");
        // The plain rp=0 arm keeps its pre-existing (unmodified) wording, which
        // never quoted the id; every rpSkip-driven arm's NEW wording does.
        if (c.label !== "none") {
          expect(body.warnings[0]).toContain(`"${c.expectedId}"`);
        }
      }
    }
  );

  it("changedRowsDiscarded: beliefs-on arms match the all arm; beliefs-off arms match the rp=0 arm", async () => {
    const all = await runGroup8Arm(`${ARM_QUERY}&rp=1`, SEEDED_SHIFT);
    const none = await runGroup8Arm(`${ARM_QUERY}&rp=0`, SEEDED_SHIFT);
    const beliefsOn = new Set(["skipFoldedPmf", "skipUpcomingPmf", "skipBothPmf", "skipFormula", "skipObserve"]);
    const beliefsOff = new Set(["resumeOnly", "skipBeliefs"]);
    for (const c of CASES) {
      if (c.label === "all" || c.label === "none") continue;
      const arm = await runGroup8Arm(c.query, SEEDED_SHIFT);
      if (beliefsOn.has(c.label)) {
        expect(arm.body.fold.changedRowsDiscarded, c.label).toBe(all.body.fold.changedRowsDiscarded);
      } else if (beliefsOff.has(c.label)) {
        expect(arm.body.fold.changedRowsDiscarded, c.label).toBe(none.body.fold.changedRowsDiscarded);
      } else {
        throw new Error(`unclassified arm: ${c.label}`);
      }
    }
  });

  it('rpSkip=resume ablates via the dependency rule: id "none", fold deep-equals rp=0\'s, one warning naming the forced-off dependents', async () => {
    const viaRpSkip = await runGroup8Arm(`${ARM_QUERY}&rpSkip=resume`, SEEDED_SHIFT);
    const viaRpZero = await runGroup8Arm(`${ARM_QUERY}&rp=0`, SEEDED_SHIFT);

    expect(viaRpSkip.body.params.rpArm.id).toBe("none");
    expect(viaRpSkip.body.params.rpArm.ran).toEqual(RAN_NONE);
    expect(viaRpSkip.body.fold).toEqual(viaRpZero.body.fold);

    expect(viaRpSkip.body.warnings).toHaveLength(1);
    expect(viaRpSkip.body.warnings[0]).toContain("ABLATED ARM");
    expect(viaRpSkip.body.warnings[0]).toContain('"none"');
    expect(viaRpSkip.body.warnings[0]!.toLowerCase()).toContain("forced off");
  });

  it('rpSkip=upcomingPmf,obsrve (unknown token): id "all", counters match the all arm, one warning naming the typo with no ABLATED ARM substring', async () => {
    const typo = await runGroup8Arm(`${ARM_QUERY}&rpSkip=upcomingPmf,obsrve`, SEEDED_SHIFT);
    const all = await runGroup8Arm(`${ARM_QUERY}&rp=1`, SEEDED_SHIFT);

    expect(typo.body.params.rpArm.id).toBe("all");
    expect(typo.body.params.rpArm.ran).toEqual(RAN_ALL);
    expect(typo.body.fold).toEqual(all.body.fold);

    expect(typo.body.warnings).toHaveLength(1);
    expect(typo.body.warnings[0]).toContain("obsrve");
    expect(typo.body.warnings[0]).toContain("NO component was skipped");
    expect(typo.body.warnings[0]).not.toContain("ABLATED ARM");
  });

  it("rpSkip is matched case-insensitively; an empty rpSkip= is byte-identical to the all arm", async () => {
    const upper = await runGroup8Arm(`${ARM_QUERY}&rpSkip=UPCOMINGPMF`, SEEDED_SHIFT);
    expect(upper.body.params.rpArm.id).toBe("skip:upcomingPmf");

    const emptyDb = new FakeD1Database();
    seedAllAlgorithms(emptyDb);
    seedMeanShift(emptyDb, SEEDED_SHIFT);
    const emptyResponse = await stateProbe.fetch(new Request(`https://probe/?${ARM_QUERY}&rp=1&rpSkip=`), { DB: emptyDb as unknown as D1Database });

    const allDb = new FakeD1Database();
    seedAllAlgorithms(allDb);
    seedMeanShift(allDb, SEEDED_SHIFT);
    const allResponse = await stateProbe.fetch(new Request(`https://probe/?${ARM_QUERY}&rp=1`), { DB: allDb as unknown as D1Database });

    expect(await emptyResponse.text()).toBe(await allResponse.text());
  });

  it('rp=0&rpSkip=beliefs: id "none", two warnings — the existing rp=0 warning first, then an ignored-rpSkip warning with no ABLATED ARM substring', async () => {
    const arm = await runGroup8Arm(`${ARM_QUERY}&rp=0&rpSkip=beliefs`, SEEDED_SHIFT);

    expect(arm.body.params.rpArm.id).toBe("none");
    expect(arm.body.warnings).toHaveLength(2);
    expect(arm.body.warnings[0]).toContain("rp=0");
    expect(arm.body.warnings[0]).toContain("ABLATED ARM");
    expect(arm.body.warnings[1]).not.toContain("ABLATED ARM");
    expect(arm.body.warnings[1]!.toLowerCase()).toContain("ignored");
  });

  it("resolveRpArm is a pure function: same inputs, same outputs, no D1/network access required to call it", () => {
    const a = resolveRpArm("1", "foldedPmf");
    const b = resolveRpArm("1", "foldedPmf");
    expect(a).toEqual(b);
    expect(a.id).toBe("skip:foldedPmf");
    expect(a.ran.foldedPmf).toBe(false);
    expect(a.ran.upcomingPmf).toBe(true);
  });
});

