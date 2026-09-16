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
import { checkTeamSeasonArtifactShape } from "../src/artifactShapeCheck.js";
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
import { buildEventStateBlock } from "../../../packages/harness/eventStatePricing.js";
import { LiveEventArtifactSchema, TeamSeasonArtifactSchema } from "../../../packages/harness/pageArtifacts.js";
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
const ARTIFACT_MERGE_SRC = resolve(__dirname, "../src/artifactMerge.ts");
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

  // `artifactMerge.ts` exists so the probe can price Phase B by calling the
  // tick's OWN merge functions. That is only safe while the merge module
  // itself reaches no write helper — otherwise the extraction would have
  // smuggled `writeArtifactObject` into the probe's graph through the back
  // door, and the two assertions above would still pass.
  describe("src/artifactMerge.ts — the shared Phase B merge path", () => {
    const mergeGraph = collectLocalImportGraph(ARTIFACT_MERGE_SRC);

    it("exists (a missing entry file would make every graph assertion below vacuous)", () => {
      expect(existsSync(ARTIFACT_MERGE_SRC)).toBe(true);
      // Non-vacuity: a file the walker could not read yields a 1-element graph.
      expect(mergeGraph.size).toBeGreaterThan(1);
    });

    it("never reaches src/scheduled.ts, transitively — the tick imports the merge, never the reverse", () => {
      expect(mergeGraph.has(resolve(__dirname, "../src/scheduled.ts"))).toBe(false);
    });

    it("never reaches src/artifactWriter.ts, transitively", () => {
      expect(mergeGraph.has(resolve(__dirname, "../src/artifactWriter.ts"))).toBe(false);
    });
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

  // The probe gained an outbound request with `phaseB` (it reads a published
  // artifact over public HTTPS). These four pin it to a shape that cannot
  // mutate the origin, in source, independently of the stubbed-fetch
  // behavioral assertions in Group 9.
  describe("the outbound artifact read is GET-only, one call site", () => {
    it("contains exactly one outbound-fetch call site", () => {
      expect([...strippedSource.matchAll(/globalThis\.fetch\(/g)]).toHaveLength(1);
    });

    it("passes exactly `{ method: \"GET\" }` at that call site — no request body, no other init key", () => {
      const call = strippedSource.match(/globalThis\.fetch\(([^;]*?)\);/);
      expect(call?.[1]).toBe('url.toString(), { method: "GET" }');
    });

    it.each(['"POST"', '"PUT"', '"PATCH"', '"DELETE"', '"HEAD"', '"OPTIONS"'])("never contains the HTTP verb literal %s", (verb) => {
      expect(strippedSource).not.toContain(verb);
    });

    it("never contains a request `body:` key anywhere in real code", () => {
      expect(strippedSource.match(/\bbody\s*:/g)).toBeNull();
    });
  });

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
        upcomingScheduled: number;
        bandsProduced: number;
        rpPmfsProduced: number;
        rpObservedFolds: number;
        rpBonusSidesCaptured: number;
        changedRowsDiscarded: number;
      };
      phaseB: { ran: boolean };
      warnings: string[];
    };

    expect(body.ok).toBe(true);

    const sprEntry = body.algorithms.find((a) => a.id === "spr");
    expect(sprEntry?.ok).toBe(true);
    expect(sprEntry?.snapshotShapeVersionObserved).toBe(STATE_SNAPSHOT_SHAPE_VERSION);

    expect(body.fold.matchesFolded).toBe(2);
    // The still-upcoming schedule is BUILT, never priced (260915-isq).
    expect(body.fold.upcomingScheduled).toBe(5);
    // Folded-only now, and by equality: one pmf per folded match, never 7.
    expect(body.fold.rpPmfsProduced).toBe(2);
    expect(body.fold.rpBonusSidesCaptured).toBe(2);
    // phaseB is off by default, so this regression case measures Phase A alone.
    expect(body.phaseB.ran).toBe(false);
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
    upcomingScheduled: number;
    bandsProduced: number;
    rpPmfsProduced: number;
    rpObservedFolds: number;
    rpBonusSidesCaptured: number;
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

    // ON arm: every FOLDED match gets a pmf, pinned by equality as in Group 3.
    // Never `ARM_FOLDED + ARM_UPCOMING` — the tick prices no upcoming match.
    expect(on.body.fold.rpPmfsProduced).toBe(ARM_FOLDED);
    expect(on.body.fold.rpObservedFolds).toBeGreaterThan(0);
    expect(on.body.fold.rpBonusSidesCaptured).toBe(ARM_FOLDED);

    // OFF arm: 0 by construction, pinned by equality.
    expect(off.body.fold.rpPmfsProduced).toBe(0);
    expect(off.body.fold.rpObservedFolds).toBe(0);
    expect(off.body.fold.rpBonusSidesCaptured).toBe(0);

    // Non-vacuity: the arms differ, so both producing 0 would fail.
    expect(on.body.fold.rpPmfsProduced).not.toBe(off.body.fold.rpPmfsProduced);

    // The played loop and the schedule build still run in both arms.
    expect(off.body.fold.matchesFolded).toBe(on.body.fold.matchesFolded);
    expect(off.body.fold.upcomingScheduled).toBe(on.body.fold.upcomingScheduled);
    expect(off.body.fold.matchesFolded).toBe(ARM_FOLDED);
    expect(off.body.fold.upcomingScheduled).toBe(ARM_UPCOMING);

    // Bands are identical across arms: two alliances per FOLDED match.
    expect(off.body.fold.bandsProduced).toBe(on.body.fold.bandsProduced);
    expect(on.body.fold.bandsProduced).toBe(2 * ARM_FOLDED);

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
    expect(typo.body.fold.rpPmfsProduced).toBe(ARM_FOLDED);
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
    expect(arm.body.fold.rpPmfsProduced).toBe(ARM_FOLDED);
    // Two alliances per FOLDED match, every roster fully warm, both variables
    // past warmup. The upcoming loop is gone, so nothing else is shifted.
    expect(arm.body.fold.rpMeanShiftedAlliances).toBe(2 * ARM_FOLDED);
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


// Group 7: the Phase A mirror guard, BIDIRECTIONAL.
//
// Groups 1-6 pin RP/mean-shift SEMANTICS. This group pins SHAPE.
//
// The old version only failed when the TICK gained a call the probe lacked.
// It could not fail when the PROBE kept a call the tick had DROPPED — which
// is precisely the drift this task repaired: the deployed probe went on
// pricing 60 upcoming matches for a whole release after `processEvent` stopped
// pricing any. So both sides are now pinned by EQUALITY to a sorted literal
// snapshot, and a deletion on either side fails here.

const PHASE_A_START_MARKER = "for (const [algorithmId, algorithm] of algorithmModules) {";
const PHASE_A_END_MARKER = "perAlgorithm.set(algorithmId";

/** The probe's fold region runs from its `runSprFold` declaration to the `runSprPhaseB` declaration immediately after it — a hard source boundary, commented at both ends in `stateProbe.ts`. */
const PROBE_FOLD_START_MARKER = "function runSprFold(";
const PROBE_FOLD_END_MARKER = "async function runSprPhaseB(";

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

/** Slices the PROBE's fold region between its two function declarations. Throws, naming whichever marker is absent, rather than silently returning an empty or wrong-bounded region. */
function extractProbeFoldRegion(source: string): string {
  const startIdx = source.indexOf(PROBE_FOLD_START_MARKER);
  if (startIdx === -1) {
    throw new Error(`extractProbeFoldRegion: missing start marker ${JSON.stringify(PROBE_FOLD_START_MARKER)} — stateProbe.ts's fold was renamed or restructured`);
  }
  const endIdx = source.indexOf(PROBE_FOLD_END_MARKER, startIdx);
  if (endIdx === -1) {
    throw new Error(`extractProbeFoldRegion: missing end marker ${JSON.stringify(PROBE_FOLD_END_MARKER)} — stateProbe.ts's Phase B function was renamed or moved above the fold`);
  }
  return source.slice(startIdx, endIdx);
}

const CALL_NAME_RE = /([A-Za-z_$][\w$]*)\s*\(/g;
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "typeof", "function"]);

/** Builtins and array/Map methods that carry no mirror signal — dropped from the probe-side snapshot so it pins DOMAIN calls, not `push`/`filter`/`String`. */
const JS_BUILTIN_AND_METHOD_NAMES = new Set([
  "Set",
  "String",
  "Map",
  "Object",
  "Number",
  "Array",
  "JSON",
  "filter",
  "flatMap",
  "push",
  "reduce",
  "sort",
  "values",
  "map",
  "slice",
  "includes",
  "find",
  "every",
  "some",
  "join",
]);

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

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort();
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

  // Test D is what makes a TICK-SIDE DELETION fail. Test C is satisfied by a
  // probe that is a strict superset of the tick — which is exactly what the
  // drifted probe was, and why it went unnoticed.
  const TICK_PHASE_A_CALL_NAMES = [
    "Set",
    "add",
    "analyticRpPmf",
    "apply",
    "bandVarianceFor",
    "beliefsByTeam",
    "consume",
    "displayBandFor",
    "fold",
    "foldMatch",
    "foldObservedRp",
    "fromBeliefs",
    "fromState",
    "has",
    "isRpEligibleEventType",
    "keys",
    "loadOrInitState",
    "momentsFor",
    "observeMatch",
    "observeTalent",
    "parse",
    "population",
    "predict",
    "publishesRankingPoints",
    "readRpBeliefs",
    "readRpMeanShift",
    "readSigmaBeliefs",
    "readSigmaPopulation",
    "rosterIsFullyWarm",
    "rpFieldsFor",
    "selectChangedRows",
    "selectionsFor",
    "serializeState",
    "set",
    "sigmaFor",
    "sigmaMatchBandVariance",
    "teamMetrics",
    "toLeakProofUpcoming",
    "toState",
    "update",
    "usesSigmaScore",
    "winOddsVarianceFor",
    "withRpBeliefs",
    "withRpMeanShift",
    "withSigmaBeliefs",
    "withSigmaPopulation",
    "writeScopedState",
  ];

  it("test D: the TICK's Phase A call-name set is pinned by equality — a call added to OR removed from processEvent fails here", () => {
    expect(
      sortedNames(callNames),
      "scheduled.ts's Phase A call set changed. Re-mirror stateProbe.ts's runSprFold against processEvent FIRST, then update TICK_PHASE_A_CALL_NAMES — never the other way round."
    ).toEqual(TICK_PHASE_A_CALL_NAMES);
  });

  const probeFoldRegion = extractProbeFoldRegion(strippedProbe);
  const probeFoldCallNames = sortedNames([...extractCallNames(probeFoldRegion)].filter((name) => !JS_BUILTIN_AND_METHOD_NAMES.has(name)));

  const PROBE_FOLD_CALL_NAMES = [
    "add",
    "analyticRpPmf",
    "apply",
    "bandVarianceFor",
    "beliefsByTeam",
    "buildPlayedMatch",
    "buildScheduledMatch",
    "displayBandFor",
    "fold",
    "foldMatch",
    "foldObservedRp",
    "fromBeliefs",
    "fromState",
    "has",
    "isDemoTeamKey",
    "isRpEligibleEventType",
    "keys",
    "momentsFor",
    "observeMatch",
    "observeTalent",
    "parse",
    "population",
    "predict",
    "publishesRankingPoints",
    "readRpBeliefs",
    "readRpMeanShift",
    "readSigmaBeliefs",
    "readSigmaPopulation",
    "rosterAt",
    "rosterIsFullyWarm",
    "rpFieldsFor",
    "runSprFold",
    "selectChangedRows",
    "serializeState",
    "set",
    "shiftObservationTotal",
    "sigmaFor",
    "sigmaMatchBandVariance",
    "teamMetrics",
    "toLeakProofUpcoming",
    "toState",
    "update",
    "usesSigmaScore",
    "winOddsVarianceFor",
    "withRpBeliefs",
    "withRpMeanShift",
    "withSigmaBeliefs",
    "withSigmaPopulation",
  ];

  it("test E (positive control): the probe's fold region slices non-trivially and really contains the RP path", () => {
    expect(probeFoldRegion.length).toBeGreaterThan(0);
    expect(probeFoldCallNames.length).toBeGreaterThanOrEqual(25);
    expect(probeFoldCallNames).toContain("analyticRpPmf");
    expect(probeFoldCallNames).toContain("serializeState");
    expect(() => extractProbeFoldRegion("no markers in this source at all")).toThrow(/missing start marker/);
    expect(() => extractProbeFoldRegion(PROBE_FOLD_START_MARKER)).toThrow(/missing end marker/);
  });

  it("test F: the PROBE's fold-region call-name set is pinned by equality — re-adding a dropped loop fails here", () => {
    expect(
      probeFoldCallNames,
      "stateProbe.ts's runSprFold call set changed. If the tick changed too, re-mirror first; if only the probe changed, that is the drift this guard exists to catch."
    ).toEqual(PROBE_FOLD_CALL_NAMES);
  });

  // The probe's own fixtures and helpers, which `processEvent` has no analogue
  // for: it folds TBA's real matches instead of synthesizing any.
  const PROBE_ONLY_ALLOWLIST = new Set([
    "runSprFold", // the region's own declaration, caught by the slice's start marker.
    "buildPlayedMatch", // synthetic played fixture; the tick normalizes TBA's own matches.
    "buildScheduledMatch", // synthetic still-upcoming fixture, for the same reason.
    "rosterAt", // cycles the discovered roster into 3v3 alliances.
    "isDemoTeamKey", // the tick calls it too, but BEFORE its Phase A loop, so it is outside the sliced region.
    "shiftObservationTotal", // the probe's own mean-shift counter; it reports what the tick merely does.
  ]);

  it("test G: every domain call in the probe's fold region is one the tick's Phase A also makes", () => {
    const extra = probeFoldCallNames.filter((name) => !callNames.has(name) && !PROBE_ONLY_ALLOWLIST.has(name));
    // KNOWN LIMITATION: a re-added upcoming loop built entirely from calls the
    // tick also makes (predict, displayBandFor, rpFieldsFor) would pass this
    // test — the call NAMES would all still be legitimate. That is why the
    // behavioral pins carry the weight: Group 5 and Group 8 fix
    // `rpPmfsProduced` and `bandsProduced` at their folded-only values by
    // equality, and a second loop moves both immediately.
    expect(extra, `stateProbe.ts's fold calls these, which processEvent's Phase A does not: ${extra.join(", ")}`).toEqual([]);
  });
});

// Group 8: per-component RP ablation arms (`rpSkip`), layered on top of `rp`.
//
// Uses the Group 6 fixture with SEEDED_SHIFT, so the mean shift's `apply` is
// observable (every seeded team is fully warm for both 2026 variables).

interface Group8Fold {
  matchesFolded: number;
  upcomingScheduled: number;
  bandsProduced: number;
  rpPmfsProduced: number;
  rpObservedFolds: number;
  rpBonusSidesCaptured: number;
  rpMeanShiftObservations: number;
  rpMeanShiftedAlliances: number;
  rpBeliefTeamsResumed: number;
  rpGatesOpened: number;
  rpBeliefTeamsAttached: number;
  rpMeanShiftAttached: boolean;
  changedRowsDiscarded: number;
  error?: { name: string; message: string };
}

/** Five components. `upcomingPmf` is RETIRED — it is not a key here, and an arm naming it gets a NOT APPLICABLE warning instead of a silent no-op. */
interface Group8Ran {
  resume: boolean;
  foldedPmf: boolean;
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
  /** Two alliances per FOLDED match. The upcoming loop is gone, so upcoming matches contribute no band. */
  const ALL_BANDS = 2 * ARM_FOLDED;

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
    readonly bonusSides: number;
    readonly shiftObs: number;
    readonly attached: number;
    readonly shiftAtt: boolean;
  }

  const RAN_ALL: Group8Ran = { resume: true, foldedPmf: true, formula: true, observe: true, beliefs: true };
  const RAN_NONE: Group8Ran = { resume: false, foldedPmf: false, formula: false, observe: false, beliefs: false };

  const CASES: readonly ArmCase[] = [
    {
      label: "all",
      query: `${ARM_QUERY}&rp=1`,
      expectedId: "all",
      ran: RAN_ALL,
      resumed: 21,
      gates: ARM_FOLDED,
      pmfs: ARM_FOLDED,
      shifted: 2 * ARM_FOLDED,
      obsFolds: 2 * ARM_FOLDED,
      bonusSides: ARM_FOLDED,
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
      bonusSides: 0,
      shiftObs: 0,
      attached: 0,
      shiftAtt: false,
    },
    {
      // The retired name is gone from this query: an arm id must describe what
      // actually ran, and `upcomingPmf` no longer names anything that does.
      label: "resumeOnly",
      query: `${ARM_QUERY}&rpSkip=foldedPmf,observe,beliefs`,
      expectedId: "skip:foldedPmf,observe,beliefs",
      ran: { resume: true, foldedPmf: false, formula: false, observe: false, beliefs: false },
      resumed: 21,
      gates: 0,
      pmfs: 0,
      shifted: 0,
      obsFolds: 0,
      bonusSides: 0,
      shiftObs: 0,
      attached: 0,
      shiftAtt: false,
    },
    {
      label: "skipFoldedPmf",
      query: `${ARM_QUERY}&rpSkip=foldedPmf`,
      expectedId: "skip:foldedPmf",
      ran: { resume: true, foldedPmf: false, formula: false, observe: true, beliefs: true },
      resumed: 21,
      gates: 0,
      pmfs: 0,
      shifted: 0,
      obsFolds: 2 * ARM_FOLDED,
      bonusSides: ARM_FOLDED,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipFormula",
      query: `${ARM_QUERY}&rpSkip=formula`,
      expectedId: "skip:formula",
      ran: { resume: true, foldedPmf: true, formula: false, observe: true, beliefs: true },
      resumed: 21,
      gates: ARM_FOLDED,
      pmfs: 0,
      shifted: 2 * ARM_FOLDED,
      obsFolds: 2 * ARM_FOLDED,
      bonusSides: ARM_FOLDED,
      shiftObs: shiftObsWhenObserved,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipObserve",
      query: `${ARM_QUERY}&rpSkip=observe`,
      expectedId: "skip:observe",
      ran: { resume: true, foldedPmf: true, formula: true, observe: false, beliefs: true },
      resumed: 21,
      gates: ARM_FOLDED,
      pmfs: ARM_FOLDED,
      shifted: 2 * ARM_FOLDED,
      obsFolds: 0,
      // The capture lives inside `foldObservedRp`, exactly as in the tick, so
      // ablating `observe` ablates it too.
      bonusSides: 0,
      shiftObs: 0,
      attached: 21,
      shiftAtt: true,
    },
    {
      label: "skipBeliefs",
      query: `${ARM_QUERY}&rpSkip=beliefs`,
      expectedId: "skip:beliefs",
      ran: { resume: true, foldedPmf: true, formula: true, observe: true, beliefs: false },
      resumed: 21,
      gates: ARM_FOLDED,
      pmfs: ARM_FOLDED,
      shifted: 2 * ARM_FOLDED,
      obsFolds: 2 * ARM_FOLDED,
      bonusSides: ARM_FOLDED,
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
      expect(body.fold.upcomingScheduled).toBe(ARM_UPCOMING);
      expect(body.fold.bandsProduced).toBe(4);
      expect(body.fold.bandsProduced).toBe(ALL_BANDS);

      expect(body.fold.rpBeliefTeamsResumed).toBe(c.resumed);
      expect(body.fold.rpGatesOpened).toBe(c.gates);
      expect(body.fold.rpPmfsProduced).toBe(c.pmfs);
      expect(body.fold.rpMeanShiftedAlliances).toBe(c.shifted);
      expect(body.fold.rpObservedFolds).toBe(c.obsFolds);
      expect(body.fold.rpBonusSidesCaptured).toBe(c.bonusSides);
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
    const beliefsOn = new Set(["skipFoldedPmf", "skipFormula", "skipObserve"]);
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

  it('rpSkip=obsrve (unknown token): id "all", counters match the all arm, one warning naming the typo with no ABLATED ARM substring', async () => {
    const typo = await runGroup8Arm(`${ARM_QUERY}&rpSkip=obsrve`, SEEDED_SHIFT);
    const all = await runGroup8Arm(`${ARM_QUERY}&rp=1`, SEEDED_SHIFT);

    expect(typo.body.params.rpArm.id).toBe("all");
    expect(typo.body.params.rpArm.ran).toEqual(RAN_ALL);
    expect(typo.body.fold).toEqual(all.body.fold);

    expect(typo.body.warnings).toHaveLength(1);
    expect(typo.body.warnings[0]).toContain("obsrve");
    expect(typo.body.warnings[0]).toContain("NO component was skipped");
    expect(typo.body.warnings[0]).not.toContain("ABLATED ARM");
    // The retired name is not one of the five it offers as valid.
    expect(typo.body.warnings[0]).not.toContain("upcomingPmf");
  });

  // The RETIRED component. The point of these three is that `upcomingPmf` is
  // RECOGNIZED: it neither takes the unknown-token path (which would silently
  // discard the other, valid names beside it) nor vanishes into a no-op that
  // reports a "skip" nothing performed.
  it('rpSkip=upcomingPmf: id stays "all", every counter equals the all arm\'s, and exactly one warning says NOT APPLICABLE with the reason', async () => {
    const retired = await runGroup8Arm(`${ARM_QUERY}&rpSkip=upcomingPmf`, SEEDED_SHIFT);
    const all = await runGroup8Arm(`${ARM_QUERY}&rp=1`, SEEDED_SHIFT);

    expect(retired.status).toBe(200);
    expect(retired.body.params.rpArm.id).toBe("all");
    expect(retired.body.params.rpArm.ran).toEqual(RAN_ALL);
    expect(retired.body.fold).toEqual(all.body.fold);

    expect(retired.body.warnings).toHaveLength(1);
    expect(retired.body.warnings[0]).toContain('"upcomingPmf"');
    expect(retired.body.warnings[0]).toContain("NOT APPLICABLE");
    expect(retired.body.warnings[0]).toContain("260915-isq");
    // Not an unknown token, and not an ablation.
    expect(retired.body.warnings[0]).not.toContain("NO component was skipped");
    expect(retired.body.warnings[0]).not.toContain("ABLATED ARM");
    expect(retired.writes).toBe(0);
  });

  it("rpSkip=foldedPmf,upcomingPmf: the live name still applies, and the retired name warns separately", async () => {
    const mixed = await runGroup8Arm(`${ARM_QUERY}&rpSkip=foldedPmf,upcomingPmf`, SEEDED_SHIFT);
    const foldedOnly = await runGroup8Arm(`${ARM_QUERY}&rpSkip=foldedPmf`, SEEDED_SHIFT);

    // The retired name changes neither the id nor a single counter.
    expect(mixed.body.params.rpArm.id).toBe("skip:foldedPmf");
    expect(mixed.body.fold).toEqual(foldedOnly.body.fold);

    expect(mixed.body.warnings).toHaveLength(2);
    expect(mixed.body.warnings[0]).toContain("PARTIALLY ABLATED ARM");
    // The warning echoes the raw query, so it necessarily repeats the retired
    // name; what must NOT list it is the "skipped …" clause, which claims work
    // that was actually skipped.
    expect(mixed.body.warnings[0]).toContain("skipped foldedPmf;");
    expect(mixed.body.warnings[1]).toContain("NOT APPLICABLE");
    expect(mixed.body.warnings[1]).toContain('"upcomingPmf"');
  });

  it("a retired name is matched case-insensitively too, and never reaches the arm id", async () => {
    const upper = await runGroup8Arm(`${ARM_QUERY}&rpSkip=UPCOMINGPMF`, SEEDED_SHIFT);
    expect(upper.body.params.rpArm.id).toBe("all");
    expect(upper.body.warnings).toHaveLength(1);
    expect(upper.body.warnings[0]).toContain("NOT APPLICABLE");
  });

  it("rpSkip is matched case-insensitively; an empty rpSkip= is byte-identical to the all arm", async () => {
    const upper = await runGroup8Arm(`${ARM_QUERY}&rpSkip=FOLDEDPMF`, SEEDED_SHIFT);
    expect(upper.body.params.rpArm.id).toBe("skip:foldedPmf");

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
    // `formula` is forced off with the pmf loop it gated — nothing calls it now.
    expect(a.ran.formula).toBe(false);
    expect(a.ran.observe).toBe(true);
  });
});

// Group 9: the Phase B emulation arm (`phaseB`).
//
// Phase A's cost has been measured three times. Phase B's never has — and the
// browser-pricing work made it BIGGER, by putting a `state` block of tens of
// KB into every live event artifact that is now parsed and spliced every tick.
// This group pins that the emulation really runs the tick's own merge (not a
// copy), that it is OFF by default, and that the new outbound request cannot
// mutate anything.

interface PhaseBBody {
  ok: boolean;
  params: { phaseB: boolean; phaseBTeams: number; phaseBEvent: string; artifactOrigin: string | null };
  fold: { error?: { name: string; message: string } };
  phaseB: {
    ran: boolean;
    eventArtifactBytes: number;
    teamArtifactBytes: number;
    eventStateBlockPresent: boolean;
    stateBlockSynthesized: boolean;
    playedRowFactsBuilt: number;
    mergedEventBytes: number;
    mergedEventStateBlockPresent: boolean;
    mergedEventStateRows: number;
    mergedEventUpcomingRows: number;
    mergedEventPlayedRows: number;
    teamParsesRun: number;
    teamMergesRun: number;
    mergedTeamBytes: number;
    error?: { name: string; message: string };
  };
  warnings: string[];
}

/** The spr rows a seeded FakeD1Database holds, rebuilt here so the fixtures can carry a REAL state block rather than a hand-written one. */
function seededSprRows(db: FakeD1Database): StateRow[] {
  return [...db.algorithmState.values()]
    .filter((row) => row.algorithm_id === "spr")
    .map((row) =>
      StateRowSchema.parse({
        algorithmId: row.algorithm_id,
        algorithmVersion: row.algorithm_version,
        scopeKind: row.scope_kind,
        scopeKey: row.scope_key,
        stateJson: row.state_json,
        generation: row.generation,
        computedAt: row.computed_at,
      })
    );
}

const PUBLISHED_STAMP = { schemaVersion: 1, generation: "published", computedAt: "2026-03-01T00:00:00.000Z" };

/** A real-shaped published event artifact. `withState` decides whether it carries the block a live event's artifact carries and an out-of-season one does not. */
function publishedEventArtifact(db: FakeD1Database, withState: boolean): unknown {
  return {
    ...PUBLISHED_STAMP,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    eventKey: SEED_EVENT_KEY,
    season: 2026,
    eventType: 0,
    matches: [],
    upcoming: [],
    teams: SEED_ROSTER.map((teamKey) => ({ teamKey, teamNumber: Number(teamKey.slice(3)), nickname: "", metrics: {} })),
    ...(withState ? { state: buildEventStateBlock(seededSprRows(db), SEED_ROSTER) } : {}),
  };
}

/** A real-shaped published team-season artifact. */
function publishedTeamArtifact(): unknown {
  return {
    ...PUBLISHED_STAMP,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    teamKey: SEED_ROSTER[0],
    teamNumber: 1,
    nickname: "Probe",
    season: 2026,
    seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
    events: [],
    metricHistory: [],
  };
}

interface RecordedRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly hasBody: boolean;
}

/** Replaces `globalThis.fetch` with a recorder. Returns the live array of requests the probe issued, so the GET-only guarantee is checked BEHAVIORALLY, not only in source. */
function installFetchRecorder(handler: (url: string) => { status: number; body: string }): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url);
    recorded.push({ url, method: init?.method, hasBody: init?.body !== undefined });
    const { status, body } = handler(url);
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch);
  return recorded;
}

describe("stateProbe — Group 9: the phaseB emulation arm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `rosterAt` cycles 6 at a time, so 2 folded matches touch teams 1-12. That is the default `phaseBTeams`. */
  const EXPECTED_TOUCHED_TEAMS = 12;
  /** `buildEventStateBlock` over the seeded rows: one league row plus 21 team rows. */
  const EXPECTED_STATE_ROWS = 1 + SEED_ROSTER.length;

  async function runPhaseBArm(query: string, options: { withState: boolean; eventStatus?: number; eventBody?: string; teamBody?: string }) {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);
    seedMeanShift(db, SEEDED_SHIFT);
    const eventText = options.eventBody ?? JSON.stringify(publishedEventArtifact(db, options.withState));
    const teamText = options.teamBody ?? JSON.stringify(publishedTeamArtifact());
    const recorded = installFetchRecorder((url) =>
      url.includes("/v1/event/")
        ? { status: options.eventStatus ?? 200, body: eventText }
        : { status: 200, body: teamText }
    );
    const response = await stateProbe.fetch(new Request(`https://probe/?${query}`), { DB: db as unknown as D1Database });
    const text = await response.text();
    return { body: JSON.parse(text) as PhaseBBody, text, status: response.status, writes: db.writeStatementCount, recorded, eventText, teamText };
  }

  it("positive control: the fixtures really are schema-valid published artifacts, with and without a state block", () => {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);
    const withState = LiveEventArtifactSchema.parse(publishedEventArtifact(db, true));
    expect(withState.state?.rows).toHaveLength(EXPECTED_STATE_ROWS);
    const withoutState = LiveEventArtifactSchema.parse(publishedEventArtifact(db, false));
    expect(withoutState.state).toBeUndefined();
    expect(TeamSeasonArtifactSchema.parse(publishedTeamArtifact()).teamKey).toBe(SEED_ROSTER[0]);
  });

  it("is OFF by default: an absent phaseB= is byte-identical to phaseB=0, ran is false, every counter is 0, and NO request is issued", async () => {
    const absent = await runPhaseBArm(ARM_QUERY, { withState: true });
    const explicitOff = await runPhaseBArm(`${ARM_QUERY}&phaseB=0`, { withState: true });

    expect(absent.text).toBe(explicitOff.text);
    expect(absent.status).toBe(200);
    expect(absent.body.params.phaseB).toBe(false);
    expect(absent.body.phaseB).toEqual({
      ran: false,
      eventArtifactBytes: 0,
      teamArtifactBytes: 0,
      // Added by 260915-t7o alongside `phaseBUpcoming`. This assertion is
      // deliberately EXHAUSTIVE — a new PhaseBResult field must appear here or
      // it fails, which is what caught these two.
      eventUpcomingReshapedRows: 0,
      reshapedEventTextBytes: 0,
      eventStateBlockPresent: false,
      stateBlockSynthesized: false,
      playedRowFactsBuilt: 0,
      mergedEventBytes: 0,
      mergedEventStateBlockPresent: false,
      mergedEventStateRows: 0,
      mergedEventUpcomingRows: 0,
      mergedEventPlayedRows: 0,
      teamParsesRun: 0,
      teamMergesRun: 0,
      mergedTeamBytes: 0,
    });
    expect(absent.recorded).toEqual([]);
    expect(absent.body.warnings).toEqual([]);
    expect(absent.writes).toBe(0);
  });

  it("phaseB=1 against a PUBLISHED state block: fetches once each, parses, merges, splices and stringifies — every structural counter pinned by equality", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true });

    expect(arm.status).toBe(200);
    expect(arm.body.ok).toBe(true);
    expect(arm.body.phaseB.error).toBeUndefined();

    expect(arm.body.params.phaseB).toBe(true);
    expect(arm.body.params.phaseBTeams).toBe(EXPECTED_TOUCHED_TEAMS);
    expect(arm.body.params.phaseBEvent).toBe(SEED_EVENT_KEY);
    expect(arm.body.params.artifactOrigin).toBe("https://data.sigmascout.org");

    expect(arm.body.phaseB.ran).toBe(true);
    expect(arm.body.phaseB.eventArtifactBytes).toBe(arm.eventText.length);
    expect(arm.body.phaseB.teamArtifactBytes).toBe(arm.teamText.length);
    expect(arm.body.phaseB.eventStateBlockPresent).toBe(true);
    expect(arm.body.phaseB.stateBlockSynthesized).toBe(false);
    expect(arm.body.phaseB.playedRowFactsBuilt).toBe(ARM_FOLDED);
    // The observable proof the splice ran: the merged object still carries a
    // block, and it holds every row the published one did.
    expect(arm.body.phaseB.mergedEventStateBlockPresent).toBe(true);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(EXPECTED_STATE_ROWS);
    expect(arm.body.phaseB.mergedEventUpcomingRows).toBe(ARM_UPCOMING);
    expect(arm.body.phaseB.mergedEventPlayedRows).toBe(ARM_FOLDED);
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TOUCHED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TOUCHED_TEAMS);

    // The two byte totals are pinned by a strict floor plus determinism (the
    // next test), not by a literal: a literal would turn this into a
    // change-detector on `spr.version` and every published-row field.
    expect(arm.body.phaseB.mergedEventBytes).toBeGreaterThan(arm.body.phaseB.eventArtifactBytes);
    expect(arm.body.phaseB.mergedTeamBytes).toBeGreaterThan(arm.body.phaseB.teamArtifactBytes);

    expect(arm.body.warnings).toEqual([]);
    expect(arm.writes).toBe(0);
  });

  it("the phaseB numbers are deterministic: two identical runs are byte-identical", async () => {
    const a = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true });
    const b = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true });
    expect(a.text).toBe(b.text);
  });

  it("phaseB=1 against an artifact with NO block: synthesizes one, still splices, and warns that the number is a floor", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: false });

    expect(arm.status).toBe(200);
    expect(arm.body.phaseB.eventStateBlockPresent).toBe(false);
    expect(arm.body.phaseB.stateBlockSynthesized).toBe(true);
    expect(arm.body.phaseB.mergedEventStateBlockPresent).toBe(true);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(EXPECTED_STATE_ROWS);

    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain("synthesized");
    expect(arm.body.warnings[0]).toContain("FLOOR");
    expect(arm.writes).toBe(0);
  });

  it("phaseBTeams overrides the default merge count, and phaseBEvent picks a different published key", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1&phaseBTeams=3&phaseBEvent=2026other`, { withState: true });

    expect(arm.body.params.phaseBTeams).toBe(3);
    expect(arm.body.params.phaseBEvent).toBe("2026other");
    expect(arm.body.phaseB.teamMergesRun).toBe(3);
    expect(arm.body.phaseB.teamParsesRun).toBe(3);
    // The event artifact key follows phaseBEvent; the merge's own eventKey
    // stays the resolved probe event, as the tick's does.
    expect(arm.recorded.some((r) => r.url.includes("/v1/event/2026other/"))).toBe(true);
  });

  it("every outbound request is a GET over https, with no request body", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true });

    expect(arm.recorded.length).toBeGreaterThan(0);
    for (const request of arm.recorded) {
      expect(request.method, request.url).toBe("GET");
      expect(request.hasBody, request.url).toBe(false);
      expect(new URL(request.url).protocol, request.url).toBe("https:");
    }
    // Exactly two reads: one event artifact, one team artifact re-parsed N times.
    expect(arm.recorded).toHaveLength(2);
  });

  it("a non-200 artifact fetch is a 500 with phaseB.error set and every counter 0 — never a phaseB arm that measured nothing", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true, eventStatus: 404 });

    expect(arm.status).toBe(500);
    expect(arm.body.ok).toBe(false);
    expect(arm.body.phaseB.error?.name).toBe("ArtifactFetchFailed");
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.body.phaseB.mergedEventBytes).toBe(0);
    expect(arm.body.phaseB.teamMergesRun).toBe(0);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(0);
    expect(arm.writes).toBe(0);
  });

  /**
   * TWO DISTINCT FAILURES, and they must stay distinguishable. Since
   * 260915-t7o's fix F2 the probe's `eventValidate` component calls the tick's
   * own `checkLiveEventArtifactShape` rather than `LiveEventArtifactSchema.parse`
   * (see `runSprPhaseB`'s header), so a body that is valid JSON of the wrong
   * SHAPE now fails at the guard, not at the parse. Both still 500 with every
   * counter 0 — the property that matters is that the driver's warm-up gate
   * never records an arm that measured nothing — but a single assertion on one
   * error name would have let the shape rejection quietly become a parse
   * failure, or vice versa.
   */
  it("a body that is not valid JSON is a 500 named EventArtifactParseFailed, with every counter 0", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true, eventBody: '{"schemaVersion":1,' });

    expect(arm.status).toBe(500);
    expect(arm.body.phaseB.error?.name).toBe("EventArtifactParseFailed");
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.body.phaseB.mergedEventBytes).toBe(0);
    expect(arm.writes).toBe(0);
  });

  it("a body the tick's own read guard rejects is a 500 named EventArtifactShapeRejected, with every counter 0", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true, eventBody: '{"schemaVersion":1,"nope":true}' });

    expect(arm.status).toBe(500);
    expect(arm.body.phaseB.error?.name).toBe("EventArtifactShapeRejected");
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.body.phaseB.mergedEventBytes).toBe(0);
    expect(arm.writes).toBe(0);
  });

  /**
   * THE PROBE'S READ PATH MUST BE THE TICK'S READ PATH. Both bodies below are
   * valid JSON that `checkTeamSeasonArtifactShape` ACCEPTS and
   * `TeamSeasonArtifactSchema` REJECTS — the exact gap between the two. If the
   * probe ever drifts back to a zod parse here it would throw where the live
   * tick merges happily, and every `teamValidate` number it produced would
   * price a read path production does not run. That drift is invisible to
   * every other assertion in this file, which is why these two exist.
   */
  const GUARD_ACCEPTS_ZOD_REJECTS_TEAM = JSON.stringify({ ...(publishedTeamArtifact() as Record<string, unknown>), teamNumber: "seventeen" });

  it("a team artifact the tick's guard ACCEPTS but zod would reject still prices Phase B — the probe follows the tick, not the schema", async () => {
    // Non-vacuity: the fixture really does straddle the guard/schema gap.
    const parsedBody = JSON.parse(GUARD_ACCEPTS_ZOD_REJECTS_TEAM) as unknown;
    expect(checkTeamSeasonArtifactShape(parsedBody)).toBeDefined();
    expect(() => TeamSeasonArtifactSchema.parse(parsedBody)).toThrow();

    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true, teamBody: GUARD_ACCEPTS_ZOD_REJECTS_TEAM });

    expect(arm.status).toBe(200);
    expect(arm.body.phaseB.error).toBeUndefined();
    expect(arm.body.phaseB.ran).toBe(true);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TOUCHED_TEAMS);
    expect(arm.writes).toBe(0);
  });

  it("a team artifact the tick's guard REJECTS is a 500 named TeamArtifactShapeRejected, with every counter 0", async () => {
    const body = JSON.stringify({ ...(publishedTeamArtifact() as Record<string, unknown>), metricHistory: 0 });
    expect(checkTeamSeasonArtifactShape(JSON.parse(body))).toBeUndefined();

    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1`, { withState: true, teamBody: body });

    expect(arm.status).toBe(500);
    expect(arm.body.phaseB.error?.name).toBe("TeamArtifactShapeRejected");
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.body.phaseB.teamMergesRun).toBe(0);
    expect(arm.writes).toBe(0);
  });

  it("phaseBSkip=teamValidate SKIPS the guard: the same zod-rejected body prices Phase B either way, so the arm's difference is the guard alone", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1&phaseBSkip=teamValidate`, { withState: true, teamBody: GUARD_ACCEPTS_ZOD_REJECTS_TEAM });

    // Group 10 pins the `params.phaseBArm.ran` echo itself; what matters HERE
    // is that the skipped arm still reaches the merge on the same body, so the
    // `teamValidate` difference isolates the guard and nothing else.
    expect(arm.status).toBe(200);
    expect(arm.body.phaseB.error).toBeUndefined();
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TOUCHED_TEAMS);
  });

  it("an unrecognized phaseB= value runs ON and says so, rather than silently picking the cheaper arm", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=yse`, { withState: true });

    expect(arm.body.params.phaseB).toBe(true);
    expect(arm.body.phaseB.ran).toBe(true);
    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain('phaseB="yse"');
    expect(arm.body.warnings[0]).toContain("ENABLED");
  });

  it("a non-https artifactOrigin is REJECTED, never silently replaced by the default — nothing is fetched", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1&artifactOrigin=http://data.sigmascout.org`, { withState: true });

    expect(arm.status).toBe(500);
    expect(arm.body.params.artifactOrigin).toBeNull();
    expect(arm.body.phaseB.error?.name).toBe("ArtifactOriginRejected");
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.recorded).toEqual([]);
    expect(arm.body.warnings.some((w) => w.includes("REJECTED"))).toBe(true);
    expect(arm.writes).toBe(0);
  });

  it("an https artifactOrigin override is accepted and is the origin actually requested", async () => {
    const arm = await runPhaseBArm(`${ARM_QUERY}&phaseB=1&artifactOrigin=https://staging.example.org`, { withState: true });

    expect(arm.body.params.artifactOrigin).toBe("https://staging.example.org");
    expect(arm.body.phaseB.ran).toBe(true);
    for (const request of arm.recorded) expect(request.url.startsWith("https://staging.example.org/v1/")).toBe(true);
  });

  it("phaseB does not disturb the RP arms: the fold block is identical with phaseB on and off", async () => {
    const off = await runPhaseBArm(`${ARM_QUERY}&rp=1`, { withState: true });
    const on = await runPhaseBArm(`${ARM_QUERY}&rp=1&phaseB=1`, { withState: true });
    expect(on.body.fold).toEqual(off.body.fold);

    const rpOffNoPhaseB = await runPhaseBArm(`${ARM_QUERY}&rp=0`, { withState: true });
    const rpOffPhaseB = await runPhaseBArm(`${ARM_QUERY}&rp=0&phaseB=1`, { withState: true });
    expect(rpOffPhaseB.body.fold).toEqual(rpOffNoPhaseB.body.fold);
    // Both phaseB arms really ran, so the equality above is not vacuous.
    expect(on.body.phaseB.ran).toBe(true);
    expect(rpOffPhaseB.body.phaseB.ran).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 10: the Phase B SUB-ARMS (`phaseBSkip`, `phaseBUpcoming`), added by
// quick task 260915-t7o.
//
// Group 9 proved Phase B runs. It measured it as ONE lump: +64.0 ms covering
// JSON.parse, zod validation, the merge/splice and stringify, across one event
// artifact and twelve team artifacts. This group pins the ablation that splits
// that lump — every component's `ran` flag and every counter by EQUALITY, never
// an inequality, because an inequality passes vacuously when a skip silently
// stops doing anything.
//
// Two invariants carry the weight and are asserted repeatedly:
//   1. DEFAULTS ARE THE OLD BEHAVIOUR. No `phaseBSkip` and no `phaseBUpcoming`
//      runs every component against the published shape, so every arm measured
//      before these params existed stays comparable.
//   2. A SKIPPED ROOT NAMES ITS FORCED DEPENDENTS. An arm that quietly turned
//      off more than it was asked to is an arm whose cpuTime gets attributed to
//      the wrong component.
// ---------------------------------------------------------------------------

interface PhaseBArmRanBody {
  eventParse: boolean;
  eventValidate: boolean;
  eventMerge: boolean;
  eventStringify: boolean;
  teamValidate: boolean;
  teamMerge: boolean;
  teamStringify: boolean;
}

interface PhaseBArmBody {
  ok: boolean;
  params: {
    phaseB: boolean;
    phaseBArm: { id: string; ran: PhaseBArmRanBody };
    phaseBUpcoming: string;
    phaseBTeams: number;
  };
  phaseB: {
    ran: boolean;
    eventArtifactBytes: number;
    teamArtifactBytes: number;
    eventUpcomingReshapedRows: number;
    reshapedEventTextBytes: number;
    eventStateBlockPresent: boolean;
    stateBlockSynthesized: boolean;
    playedRowFactsBuilt: number;
    mergedEventBytes: number;
    mergedEventStateBlockPresent: boolean;
    mergedEventStateRows: number;
    mergedEventUpcomingRows: number;
    mergedEventPlayedRows: number;
    teamParsesRun: number;
    teamMergesRun: number;
    mergedTeamBytes: number;
    error?: { name: string; message: string };
  };
  warnings: string[];
}

/** Every component ON — the default, and the thing each skip is measured against. */
const PHASE_B_ALL_RAN: PhaseBArmRanBody = {
  eventParse: true,
  eventValidate: true,
  eventMerge: true,
  eventStringify: true,
  teamValidate: true,
  teamMerge: true,
  teamStringify: true,
};

/**
 * A FULLY PRICED upcoming row — every key `EventUpcomingMatchSchema` requires
 * plus the optional priced ones. Group 9's fixture publishes `upcoming: []`,
 * which cannot exercise `phaseBUpcoming=scheduled` at all: with no rows there
 * is nothing to reshape and the arm would pass vacuously.
 */
function pricedUpcomingRow(matchNumber: number): Record<string, unknown> {
  return {
    matchKey: `${SEED_EVENT_KEY}_qm${matchNumber}`,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    sortTime: 1_770_000_000 + matchNumber,
    redTeams: SEED_ROSTER.slice(0, 3),
    blueTeams: SEED_ROSTER.slice(3, 6),
    predictedWinner: "red",
    pRedWin: 0.62,
    predictedRedScore: 121.5,
    predictedBlueScore: 98.25,
    redScoreVarianceOwn: 210.5,
    blueScoreVarianceOwn: 198.25,
    redMatchBandVariance: 44.5,
    blueMatchBandVariance: 41.25,
    redRpPmf: [0.25, 0.35, 0.4],
    blueRpPmf: [0.4, 0.35, 0.25],
    matchOutcomePmf: [0.62, 0.03, 0.35],
    redBonusRp: [0.5, 0.25],
    blueBonusRp: [0.45, 0.2],
  };
}

const PRICED_UPCOMING_ROWS = 4;

/** Group 9's published artifact, carrying a real `state` block AND priced upcoming rows. */
function publishedEventWithPricedUpcoming(db: FakeD1Database, rows: number): unknown {
  const base = publishedEventArtifact(db, true) as Record<string, unknown>;
  return { ...base, upcoming: Array.from({ length: rows }, (_, i) => pricedUpcomingRow(i + 1)) };
}

describe("stateProbe — Group 10: the Phase B sub-arms (phaseBSkip, phaseBUpcoming)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `rosterAt` cycles 6 at a time, so 2 folded matches touch teams 1-12. That is the default `phaseBTeams`. */
  const EXPECTED_TEAMS = 12;
  /** `buildEventStateBlock` over the seeded rows: one league row plus 21 team rows. */
  const EXPECTED_STATE_ROWS = 1 + SEED_ROSTER.length;

  async function runSubArm(query: string, options: { upcomingRows?: number } = {}) {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);
    seedMeanShift(db, SEEDED_SHIFT);
    const eventText = JSON.stringify(publishedEventWithPricedUpcoming(db, options.upcomingRows ?? PRICED_UPCOMING_ROWS));
    const teamText = JSON.stringify(publishedTeamArtifact());
    const recorded = installFetchRecorder((url) => (url.includes("/v1/event/") ? { status: 200, body: eventText } : { status: 200, body: teamText }));
    const response = await stateProbe.fetch(new Request(`https://probe/?${query}`), { DB: db as unknown as D1Database });
    const text = await response.text();
    return { body: JSON.parse(text) as PhaseBArmBody, text, status: response.status, writes: db.writeStatementCount, recorded, eventText, teamText };
  }

  const BASE = `${ARM_QUERY}&phaseB=1`;

  it("positive control: the priced-upcoming fixture really parses, and its rows are PRICED — so a reshape has something to remove", () => {
    const db = new FakeD1Database();
    seedAllAlgorithms(db);
    const parsed = LiveEventArtifactSchema.parse(publishedEventWithPricedUpcoming(db, PRICED_UPCOMING_ROWS));
    expect(parsed.upcoming).toHaveLength(PRICED_UPCOMING_ROWS);
    // If this key were absent the row would already be schedule-only and the
    // `scheduled` arm would measure nothing.
    expect((parsed.upcoming[0] as { predictedWinner?: string }).predictedWinner).toBe("red");
    expect(parsed.state?.rows).toHaveLength(EXPECTED_STATE_ROWS);
  });

  it("DEFAULT: no phaseBSkip and no phaseBUpcoming runs every component, echoes id \"all\", and is byte-identical to an empty phaseBSkip", async () => {
    const bare = await runSubArm(BASE);
    const emptySkip = await runSubArm(`${BASE}&phaseBSkip=`);

    expect(bare.text).toBe(emptySkip.text);
    expect(bare.status).toBe(200);
    expect(bare.body.ok).toBe(true);
    expect(bare.body.params.phaseBArm.id).toBe("all");
    expect(bare.body.params.phaseBArm.ran).toEqual(PHASE_B_ALL_RAN);
    expect(bare.body.params.phaseBUpcoming).toBe("published");
    expect(bare.body.params.phaseBTeams).toBe(EXPECTED_TEAMS);

    // The published shape is NOT reshaped, and says so with a zero rather than
    // an absent key.
    expect(bare.body.phaseB.eventUpcomingReshapedRows).toBe(0);
    expect(bare.body.phaseB.reshapedEventTextBytes).toBe(0);
    expect(bare.body.phaseB.eventArtifactBytes).toBe(bare.eventText.length);

    expect(bare.body.phaseB.eventStateBlockPresent).toBe(true);
    expect(bare.body.phaseB.stateBlockSynthesized).toBe(false);
    expect(bare.body.phaseB.mergedEventStateRows).toBe(EXPECTED_STATE_ROWS);
    expect(bare.body.phaseB.mergedEventUpcomingRows).toBe(ARM_UPCOMING);
    expect(bare.body.phaseB.mergedEventPlayedRows).toBe(ARM_FOLDED);
    expect(bare.body.phaseB.playedRowFactsBuilt).toBe(ARM_FOLDED);
    expect(bare.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(bare.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
    expect(bare.body.phaseB.mergedEventBytes).toBeGreaterThan(0);
    expect(bare.body.phaseB.mergedTeamBytes).toBeGreaterThan(0);

    // No sub-arm warning at all: the default arm is not an ablated arm.
    expect(bare.body.warnings).toEqual([]);
    expect(bare.writes).toBe(0);
  });

  it("phaseBSkip=eventValidate: the merge runs on the RAW JSON.parse output — every merged counter is byte-for-byte the all arm's", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=eventValidate`);

    expect(arm.status).toBe(200);
    expect(arm.body.params.phaseBArm.id).toBe("skip:eventValidate");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, eventValidate: false });

    // The whole point: skipping validation must not change the OUTPUT, only
    // its cost. Pinned by equality on every merged counter.
    expect(arm.body.phaseB.mergedEventBytes).toBe(all.body.phaseB.mergedEventBytes);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(all.body.phaseB.mergedEventStateRows);
    expect(arm.body.phaseB.mergedEventUpcomingRows).toBe(all.body.phaseB.mergedEventUpcomingRows);
    expect(arm.body.phaseB.mergedEventPlayedRows).toBe(all.body.phaseB.mergedEventPlayedRows);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(all.body.phaseB.mergedTeamBytes);
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.playedRowFactsBuilt).toBe(all.body.phaseB.playedRowFactsBuilt);

    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain("PARTIALLY ABLATED PHASE B ARM");
    expect(arm.body.warnings[0]).toContain("skipped eventValidate");
    // Nothing was forced off, so the warning must not claim anything was.
    expect(arm.body.warnings[0]).not.toContain("FORCED OFF");
    expect(arm.writes).toBe(0);
  });

  it("phaseBSkip=eventMerge FORCES eventStringify off, reports BOTH in one warning, and zeroes every merged-event counter", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=eventMerge`);

    expect(arm.status).toBe(200);
    expect(arm.body.params.phaseBArm.id).toBe("skip:eventMerge");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, eventMerge: false, eventStringify: false });

    expect(arm.body.phaseB.mergedEventBytes).toBe(0);
    expect(arm.body.phaseB.mergedEventStateBlockPresent).toBe(false);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(0);
    expect(arm.body.phaseB.mergedEventUpcomingRows).toBe(0);
    expect(arm.body.phaseB.mergedEventPlayedRows).toBe(0);

    // The team half is untouched — it is a separate root.
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(all.body.phaseB.mergedTeamBytes);
    // And so is the parse, which still ran.
    expect(arm.body.phaseB.eventStateBlockPresent).toBe(true);
    expect(arm.body.phaseB.playedRowFactsBuilt).toBe(all.body.phaseB.playedRowFactsBuilt);

    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain("skipped eventMerge");
    expect(arm.body.warnings[0]).toContain("FORCED OFF as dependents of a skipped root: eventStringify");
    expect(arm.writes).toBe(0);
  });

  it("phaseBSkip=eventStringify: only the serialization disappears; the merge still ran and its row counters are the all arm's", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=eventStringify`);

    expect(arm.body.params.phaseBArm.id).toBe("skip:eventStringify");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, eventStringify: false });
    expect(arm.body.phaseB.mergedEventBytes).toBe(0);
    // The merge itself ran, which is what separates this arm from eventMerge.
    expect(arm.body.phaseB.mergedEventStateBlockPresent).toBe(true);
    expect(arm.body.phaseB.mergedEventStateRows).toBe(all.body.phaseB.mergedEventStateRows);
    expect(arm.body.phaseB.mergedEventUpcomingRows).toBe(all.body.phaseB.mergedEventUpcomingRows);
    expect(arm.body.phaseB.mergedEventPlayedRows).toBe(all.body.phaseB.mergedEventPlayedRows);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(all.body.phaseB.mergedTeamBytes);
  });

  it("phaseBSkip=eventParse is the event half's ROOT: it forces validate/merge/stringify off, zeroes every event-half counter, and leaves the team half and playedRowFacts alone", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=eventParse`);

    expect(arm.status).toBe(200);
    expect(arm.body.ok).toBe(true);
    expect(arm.body.params.phaseBArm.id).toBe("skip:eventParse");
    expect(arm.body.params.phaseBArm.ran).toEqual({
      ...PHASE_B_ALL_RAN,
      eventParse: false,
      eventValidate: false,
      eventMerge: false,
      eventStringify: false,
    });

    // Every event-half WORK counter, pinned by equality as a set.
    expect({
      eventStateBlockPresent: arm.body.phaseB.eventStateBlockPresent,
      mergedEventBytes: arm.body.phaseB.mergedEventBytes,
      mergedEventStateBlockPresent: arm.body.phaseB.mergedEventStateBlockPresent,
      mergedEventStateRows: arm.body.phaseB.mergedEventStateRows,
      mergedEventUpcomingRows: arm.body.phaseB.mergedEventUpcomingRows,
      mergedEventPlayedRows: arm.body.phaseB.mergedEventPlayedRows,
    }).toEqual({
      eventStateBlockPresent: false,
      mergedEventBytes: 0,
      mergedEventStateBlockPresent: false,
      mergedEventStateRows: 0,
      mergedEventUpcomingRows: 0,
      mergedEventPlayedRows: 0,
    });

    // playedRowFactsFor runs in EVERY arm, so it cancels in every difference.
    expect(arm.body.phaseB.playedRowFactsBuilt).toBe(all.body.phaseB.playedRowFactsBuilt);
    expect(arm.body.phaseB.playedRowFactsBuilt).toBe(ARM_FOLDED);
    // The team half is a separate root and is untouched.
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(all.body.phaseB.mergedTeamBytes);
    // The fetch still happened; only the parse of its bytes did not.
    expect(arm.body.phaseB.eventArtifactBytes).toBe(all.body.phaseB.eventArtifactBytes);

    // THE DOCUMENTED ASYMMETRY: with no parsed object to ask, the probe cannot
    // know the published artifact carried a block, so it synthesizes one
    // anyway. Out of season — where no artifact carries a block and the full
    // arm synthesizes too — the term cancels; here, with a block present, the
    // skipped arm pays one the full arm did not.
    expect(all.body.phaseB.stateBlockSynthesized).toBe(false);
    expect(arm.body.phaseB.stateBlockSynthesized).toBe(true);
    expect(arm.body.warnings.filter((w) => w.includes("synthesized"))).toHaveLength(1);
    expect(arm.writes).toBe(0);
  });

  it("naming a dependent alongside its skipped root changes nothing further: the id and the ran set are identical to naming the root alone", async () => {
    const rootOnly = await runSubArm(`${BASE}&phaseBSkip=eventParse`);
    const rootAndDependents = await runSubArm(`${BASE}&phaseBSkip=eventParse,eventValidate,eventMerge,eventStringify`);

    expect(rootAndDependents.body.params.phaseBArm.id).toBe("skip:eventParse");
    expect(rootAndDependents.body.params.phaseBArm.ran).toEqual(rootOnly.body.params.phaseBArm.ran);
    expect(rootAndDependents.body.phaseB).toEqual(rootOnly.body.phaseB);
  });

  it("phaseBTeams=0 is the TEAM half's root: zero team parses and zero team merges — where it used to report one parse", async () => {
    const zero = await runSubArm(`${BASE}&phaseBTeams=0`);
    const full = await runSubArm(`${BASE}&phaseBTeams=12`);

    expect(zero.body.params.phaseBTeams).toBe(0);
    expect(zero.body.phaseB.teamParsesRun).toBe(0);
    expect(zero.body.phaseB.teamMergesRun).toBe(0);
    expect(zero.body.phaseB.mergedTeamBytes).toBe(0);
    // The event half is untouched by the team root.
    expect(zero.body.phaseB.mergedEventBytes).toBe(full.body.phaseB.mergedEventBytes);

    // And the 12-team total is UNCHANGED by moving the parse into the loop.
    expect(full.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(full.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
  });

  it("phaseBSkip=teamValidate: the loop's JSON.parse still runs every iteration, and the merged team bytes are the all arm's", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=teamValidate`);

    expect(arm.body.params.phaseBArm.id).toBe("skip:teamValidate");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, teamValidate: false });
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(all.body.phaseB.mergedTeamBytes);
    expect(arm.body.phaseB.mergedEventBytes).toBe(all.body.phaseB.mergedEventBytes);
  });

  it("phaseBSkip=teamMerge FORCES teamStringify off and names it; the parses still run", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=teamMerge`);

    expect(arm.body.params.phaseBArm.id).toBe("skip:teamMerge");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, teamMerge: false, teamStringify: false });
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(0);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(0);
    expect(arm.body.phaseB.mergedEventBytes).toBe(all.body.phaseB.mergedEventBytes);
    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain("FORCED OFF as dependents of a skipped root: teamStringify");
  });

  it("phaseBSkip=teamStringify: the merges still run, only their serialization disappears", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=teamStringify`);

    expect(arm.body.params.phaseBArm.id).toBe("skip:teamStringify");
    expect(arm.body.params.phaseBArm.ran).toEqual({ ...PHASE_B_ALL_RAN, teamStringify: false });
    expect(arm.body.phaseB.teamParsesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.teamMergesRun).toBe(EXPECTED_TEAMS);
    expect(arm.body.phaseB.mergedTeamBytes).toBe(0);
    expect(arm.body.phaseB.mergedEventBytes).toBe(all.body.phaseB.mergedEventBytes);
  });

  it("an unrecognized phaseBSkip token skips NOTHING, says so, and names the valid components — it never silently discards the other names in the list", async () => {
    const all = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBSkip=nonsense,eventMerge`);

    expect(arm.body.params.phaseBArm.id).toBe("all");
    expect(arm.body.params.phaseBArm.ran).toEqual(PHASE_B_ALL_RAN);
    // Every counter is the full arm's: the valid `eventMerge` in the same list
    // was NOT applied either, which is the rule, not an accident.
    expect(arm.body.phaseB).toEqual(all.body.phaseB);

    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain('"nonsense"');
    expect(arm.body.warnings[0]).toContain("NO component was skipped");
    expect(arm.body.warnings[0]).toContain("eventParse, eventValidate, eventMerge, eventStringify, teamValidate, teamMerge, teamStringify");
    // The team half's root is not a component name, and the warning says so.
    expect(arm.body.warnings[0]).toContain("phaseBTeams=0");
  });

  it("phaseBUpcoming=scheduled reshapes the priced rows to the seven schedule-only keys, reports the count and the reshaped size, and warns that its ABSOLUTE cpuTime is not comparable", async () => {
    const published = await runSubArm(BASE);
    const scheduled = await runSubArm(`${BASE}&phaseBUpcoming=scheduled`);

    expect(scheduled.status).toBe(200);
    expect(scheduled.body.ok).toBe(true);
    expect(scheduled.body.params.phaseBUpcoming).toBe("scheduled");
    expect(scheduled.body.phaseB.eventUpcomingReshapedRows).toBe(PRICED_UPCOMING_ROWS);

    // The reshaped text is genuinely SMALLER — proof the priced keys were
    // dropped rather than the rows merely copied.
    expect(scheduled.body.phaseB.reshapedEventTextBytes).toBeGreaterThan(0);
    expect(scheduled.body.phaseB.reshapedEventTextBytes).toBeLessThan(scheduled.body.phaseB.eventArtifactBytes);
    // `eventArtifactBytes` stays the FETCHED size in both arms.
    expect(scheduled.body.phaseB.eventArtifactBytes).toBe(published.body.phaseB.eventArtifactBytes);

    // The merge replaces `upcoming` wholesale from Phase A's schedule, so the
    // reshape changes the parse COST and nothing about the output.
    expect(scheduled.body.phaseB.mergedEventBytes).toBe(published.body.phaseB.mergedEventBytes);
    expect(scheduled.body.phaseB.mergedEventUpcomingRows).toBe(published.body.phaseB.mergedEventUpcomingRows);
    expect(scheduled.body.phaseB.mergedTeamBytes).toBe(published.body.phaseB.mergedTeamBytes);

    expect(scheduled.body.warnings).toHaveLength(1);
    expect(scheduled.body.warnings[0]).toContain("phaseBUpcoming=scheduled");
    expect(scheduled.body.warnings[0]).toContain("NOT comparable");
    expect(scheduled.writes).toBe(0);
  });

  it("the reshape runs in EVERY arm, including the one that skips the parse — that is what makes it cancel in the difference", async () => {
    const schedAll = await runSubArm(`${BASE}&phaseBUpcoming=scheduled`);
    const schedSkipParse = await runSubArm(`${BASE}&phaseBUpcoming=scheduled&phaseBSkip=eventParse`);

    expect(schedSkipParse.body.params.phaseBArm.ran.eventParse).toBe(false);
    // Identical reshape work in both arms of the pair, pinned by equality.
    expect(schedSkipParse.body.phaseB.eventUpcomingReshapedRows).toBe(schedAll.body.phaseB.eventUpcomingReshapedRows);
    expect(schedSkipParse.body.phaseB.reshapedEventTextBytes).toBe(schedAll.body.phaseB.reshapedEventTextBytes);
    expect(schedSkipParse.body.phaseB.eventUpcomingReshapedRows).toBe(PRICED_UPCOMING_ROWS);
    // And the parse really did not run.
    expect(schedSkipParse.body.phaseB.mergedEventBytes).toBe(0);

    const schedSkipValidate = await runSubArm(`${BASE}&phaseBUpcoming=scheduled&phaseBSkip=eventValidate`);
    expect(schedSkipValidate.body.phaseB.eventUpcomingReshapedRows).toBe(PRICED_UPCOMING_ROWS);
    expect(schedSkipValidate.body.phaseB.mergedEventBytes).toBe(schedAll.body.phaseB.mergedEventBytes);
  });

  it("an unrecognized phaseBUpcoming value runs the PUBLISHED shape and warns, rather than silently measuring the other shape", async () => {
    const published = await runSubArm(BASE);
    const arm = await runSubArm(`${BASE}&phaseBUpcoming=schedled`);

    expect(arm.body.params.phaseBUpcoming).toBe("published");
    expect(arm.body.phaseB.eventUpcomingReshapedRows).toBe(0);
    expect(arm.body.phaseB.reshapedEventTextBytes).toBe(0);
    expect(arm.body.phaseB.mergedEventBytes).toBe(published.body.phaseB.mergedEventBytes);
    expect(arm.body.warnings).toHaveLength(1);
    expect(arm.body.warnings[0]).toContain('phaseBUpcoming="schedled"');
    expect(arm.body.warnings[0]).toContain("published | scheduled");
  });

  it("with phaseB OFF both new params are inert and say so — the emulation never ran, so there was nothing to ablate or reshape", async () => {
    const arm = await runSubArm(`${ARM_QUERY}&phaseBSkip=eventParse&phaseBUpcoming=scheduled`);

    expect(arm.body.params.phaseB).toBe(false);
    expect(arm.body.params.phaseBArm.id).toBe("all");
    expect(arm.body.params.phaseBArm.ran).toEqual(PHASE_B_ALL_RAN);
    expect(arm.body.phaseB.ran).toBe(false);
    expect(arm.body.phaseB.eventUpcomingReshapedRows).toBe(0);
    expect(arm.recorded).toEqual([]);

    expect(arm.body.warnings).toHaveLength(2);
    expect(arm.body.warnings[0]).toContain("phaseBSkip=");
    expect(arm.body.warnings[0]).toContain("ignored because phaseB is off");
    expect(arm.body.warnings[1]).toContain("phaseBUpcoming=");
    expect(arm.body.warnings[1]).toContain("ignored because phaseB is off");
  });

  it("every sub-arm is deterministic and still writes nothing: two identical runs are byte-identical", async () => {
    for (const query of [
      `${BASE}&phaseBSkip=eventParse`,
      `${BASE}&phaseBSkip=teamMerge`,
      `${BASE}&phaseBUpcoming=scheduled`,
      `${BASE}&phaseBUpcoming=scheduled&phaseBSkip=eventValidate`,
    ]) {
      const a = await runSubArm(query);
      const b = await runSubArm(query);
      expect(a.text, query).toBe(b.text);
      expect(a.writes, query).toBe(0);
      expect(a.status, query).toBe(200);
    }
  });

  it("the sub-arms never disturb Phase A: the fold block is identical across every one of them", async () => {
    const baseline = await runSubArm(BASE);
    const baselineFold = (JSON.parse(baseline.text) as { fold: unknown }).fold;
    for (const query of [
      `${BASE}&phaseBSkip=eventParse`,
      `${BASE}&phaseBSkip=eventValidate`,
      `${BASE}&phaseBSkip=eventMerge`,
      `${BASE}&phaseBSkip=eventStringify`,
      `${BASE}&phaseBTeams=0`,
      `${BASE}&phaseBSkip=teamValidate`,
      `${BASE}&phaseBSkip=teamMerge`,
      `${BASE}&phaseBSkip=teamStringify`,
      `${BASE}&phaseBUpcoming=scheduled`,
    ]) {
      const arm = await runSubArm(query);
      expect((JSON.parse(arm.text) as { fold: unknown }).fold, query).toEqual(baselineFold);
    }
  });
});

