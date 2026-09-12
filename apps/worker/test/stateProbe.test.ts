/**
 * Quick task 260912-3e6, Task 2. Pins two properties of `src/stateProbe.ts`
 * that a naive "it returns 200" test would not catch:
 *
 *   1. It genuinely cannot write to D1, EVEN THOUGH `wrangler.probe.toml`
 *      binds `DB` read-write (Workers has no read-only D1 binding — see
 *      `stateProbe.ts`'s own header for the two-layer guarantee this file
 *      is the "test-enforced" half of).
 *   2. It genuinely drives the ranking-point path — `analyticRpPmf` really
 *      runs, the partial-roster gate really opens, and the counters the
 *      probe reports are not all suppressed to zero while still returning
 *      `ok: true`.
 *
 * Three of the four groups below are BEHAVIORAL for exactly that reason: a
 * test that would still pass if the probe silently stopped exercising the RP
 * path is worthless.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import stateProbe, { probeSelectionsFor } from "../src/stateProbe.js";
import { selectionsFor } from "../src/scheduled.js";
import {
  serializeState,
  withSwingBeliefs,
  withSigmaBeliefs,
  withSigmaPopulation,
  withRpBeliefs,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateRow,
} from "../../../packages/harness/stateSnapshot.js";
import { SwingFactorAccumulator } from "../../../packages/harness/swingFactor.js";
import { SigmaScoreAccumulator } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { bpr } from "../../../packages/core/algorithms/bpr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../../../packages/core/algorithms/types.js";
import type { D1Database } from "@cloudflare/workers-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_PROBE_SRC = resolve(__dirname, "../src/stateProbe.ts");
const WRANGLER_PROBE_TOML = resolve(__dirname, "../wrangler.probe.toml");

// ---------------------------------------------------------------------------
// Comment stripping — following `liveAlgorithmTier.test.ts`'s
// `extractVarsValue` precedent ("drop comment lines BEFORE matching"),
// extended to block comments since `stateProbe.ts`'s own header (which MUST
// name `writeScopedState`/`writeEventCursor`/`scheduled.ts` in prose, per its
// own design) lives inside a `/** */` block.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transitive local import graph walker — `readFileSync` + a relative-
// specifier regex, resolving `.js` -> `.ts`, the same on-disk-file-reading
// shape `liveAlgorithmTier.test.ts` already uses for `wrangler.toml`.
// ---------------------------------------------------------------------------

const LOCAL_IMPORT_RE = /from\s+["'](\.\.?\/[^"']+)["']/g;

function resolveLocalImport(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier);
  if (resolved.endsWith(".js")) {
    const asTs = resolved.slice(0, -3) + ".ts";
    if (existsSync(asTs)) return asTs;
  }
  return resolved;
}

/** BFS/DFS over every LOCAL (relative-specifier) import reachable from `entryFile`, transitively. Non-relative (package) specifiers are never followed — this is a graph over this repo's own files only. */
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
    // Real code containing the identifier survives stripping — without this
    // half, a stripper that returned "" would make every negative assertion
    // below vacuously true.
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
  // The test file itself MAY import scheduled.ts freely (only the probe's
  // OWN graph is constrained, per Group 1 above) — that is what lets this
  // group compare the probe's duplicate against the real thing at all.
  const EVENT_KEY = "2026testevt";
  const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

  it.each([
    ["opr (the event-scoped case — the one that matters)", "opr", TEAMS],
    ["epa", "epa", TEAMS],
    ["bpr", "bpr", TEAMS],
    ["empty roster", "opr", []],
  ])("probeSelectionsFor matches the real selectionsFor for %s — stops the probe reading a different row set than a real tick", (_label, algorithmId, teams) => {
    expect(probeSelectionsFor(algorithmId, EVENT_KEY, teams)).toEqual(selectionsFor(algorithmId, EVENT_KEY, teams));
  });
});

// ---------------------------------------------------------------------------
// Group 3 + 4 fixtures: a fake D1Database, deliberately DUPLICATED from
// `apps/worker/test/stateStore.test.ts` rather than imported (that file
// exports none of these classes; `scheduled.rp.test.ts`'s header already
// sets this codebase's precedent for the exact same cross-boundary
// situation). Extended here to COUNT WRITE STATEMENTS — any `batch()` call,
// and any `run()` whose SQL is not a SELECT — which is the behavioral half
// of Group 1's static "no write helper is reachable" proof: this proves no
// write was actually ISSUED, against a probe wired to a live-shaped D1.
// ---------------------------------------------------------------------------

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
    if (sql.includes("FROM algorithm_state") && sql.includes("algorithm_id = 'bpr'") && sql.includes("scope_kind = 'team'")) {
      const limit = args[0] as number;
      return [...this.algorithmState.values()]
        .filter((row) => row.algorithm_id === "bpr" && row.scope_kind === "team")
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
/**
 * 21 teams — matches `stateProbe.ts`'s own `DEFAULT_TEAM_COUNT`, so a probe
 * request with NO `teamCount=` override (the exact request shape this
 * plan's Task 2 spec drives) finds a full-sized roster and never trips the
 * "roster smaller than requested" warning.
 */
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

/** Cycles 6-at-a-time through `SEED_ROSTER`, the same shape `stateProbe.ts`'s own `rosterAt` uses — `ceil(21/6) = 4` matches is the minimum that touches every one of the 21 seeded teams at least once (the 4th wraps and re-touches a few, which is harmless: RP beliefs are keyed by team, not by match). */
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
 * Seeds a fresh `FakeD1Database` with REAL rows for all three published
 * algorithms — built via `initState`/`update`/`serializeState` and, for bpr,
 * real `SwingFactorAccumulator`/`SigmaScoreAccumulator`/`RpMomentsAccumulator`
 * instances that folded the SAME seed matches — never hand-written JSON.
 *
 * Folding the seed matches through the SAME 6-team roster the probe's own
 * `rosterAt` cycles through (n=6, so every synthetic match uses the whole
 * roster) is what makes the seeded RP beliefs cover the probe's own fold, so
 * the partial-roster gate does not fire on the very first synthetic match.
 */
function seedAllAlgorithms(db: FakeD1Database): void {
  let oprState = opr.initState([...SEED_ROSTER]);
  for (const m of SEED_MATCHES) oprState = opr.update(oprState, m);
  seedRows(db, serializeState("opr", opr.version, oprState, SEED_STAMP));

  let epaState = epa.initState([...SEED_ROSTER]);
  for (const m of SEED_MATCHES) epaState = epa.update(epaState, m);
  seedRows(db, serializeState("epa", epa.version, epaState, SEED_STAMP));

  let bprState = bpr.initState([...SEED_ROSTER]);
  const swing = new SwingFactorAccumulator();
  const sigma = new SigmaScoreAccumulator();
  const rpRuleModule = RP_RULE_MODULES[2026]!;
  const rp = new RpMomentsAccumulator(rpRuleModule);
  for (const m of SEED_MATCHES) {
    const prediction = bpr.predict(bprState, toLeakProofUpcoming(m));
    bprState = bpr.update(bprState, m);
    swing.foldMatch(m, prediction);
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
    const metrics = bpr.teamMetrics(bprState, roster);
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) sigma.observeTalent(teamKey, total);
    }
  }
  let bprRows = withSwingBeliefs(serializeState("bpr", bpr.version, bprState, SEED_STAMP), swing.beliefsByTeam());
  bprRows = withRpBeliefs(bprRows, rp.beliefsByTeam());
  bprRows = withSigmaPopulation(withSigmaBeliefs(bprRows, sigma.beliefsByTeam()), sigma.population());
  seedRows(db, bprRows);
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

    const bprEntry = body.algorithms.find((a) => a.id === "bpr");
    expect(bprEntry?.ok).toBe(true);
    expect(bprEntry?.snapshotShapeVersionObserved).toBe(STATE_SNAPSHOT_SHAPE_VERSION);

    expect(body.fold.matchesFolded).toBe(2);
    expect(body.fold.upcomingPriced).toBe(5);
    // EQUALITY against folded + upcoming, not `> 0` — a `> 0` check would
    // pass even if the partial-roster gate silently suppressed six of the
    // seven matches' pmfs.
    expect(body.fold.rpPmfsProduced).toBe(7);
    expect(body.fold.bandsProduced).toBeGreaterThan(0);
    expect(body.fold.rpObservedFolds).toBeGreaterThan(0);
    expect(body.fold.changedRowsDiscarded).toBeGreaterThan(0);

    expect(body.warnings).toEqual([]);

    // The behavioral half of Group 1: static analysis proves no write
    // helper is REACHABLE; this proves no write was actually ISSUED against
    // a D1 wired to record every one.
    expect(db.writeStatementCount).toBe(0);
  });
});

describe("stateProbe — Group 4: the shape-mismatch report is readable, not an opaque failure", () => {
  it("reports LeagueRowShapeVersionError by name and message when a league row is stale", async () => {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);

    // Re-seed bpr's league row alone at a STALE shape version.
    const staleKey = "bpr::league::league";
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

    const bprEntry = body.algorithms.find((a) => a.id === "bpr");
    expect(bprEntry?.ok).toBe(false);
    expect(bprEntry?.error?.name).toBe("LeagueRowShapeVersionError");
    expect(bprEntry?.error?.message).toContain(String(STATE_SNAPSHOT_SHAPE_VERSION));
    expect(bprEntry?.error?.message).toContain(String(STATE_SNAPSHOT_SHAPE_VERSION - 1));

    // Still zero writes even on a failing run — the shape check trips before
    // anything downstream of it, but no write helper exists in this file's
    // graph regardless of which branch runs.
    expect(db.writeStatementCount).toBe(0);
  });
});
