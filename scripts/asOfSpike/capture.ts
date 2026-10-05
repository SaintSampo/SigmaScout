/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). Replays every season once,
 * SPR only, mirroring `scripts/districtPricingState.ts`'s `buildDistrictPricingState`
 * loop with no as-of cut, and captures the compact post-match state of the six
 * teams plus the league tuple at every fold, in the proposed wire format
 * (`format.ts`).
 *
 * Reads the corpus READ-ONLY. No network, no credential, `.env` never touched.
 * Writes only under `reports/asof-spike/` (gitignored).
 *
 *   npx tsx scripts/asOfSpike/capture.ts                       full capture, every season written
 *   npx tsx scripts/asOfSpike/capture.ts --no-capture          the same replay, nothing captured (overhead baseline)
 *   npx tsx scripts/asOfSpike/capture.ts --truncate-after 2026miche_qm40 --out reports/asof-spike/trunc --write-seasons 2026
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openCorpusReadOnly, type Corpus } from "../../packages/corpus/db.js";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult } from "../../packages/core/algorithms/types.js";
import type { SprState } from "../../packages/core/algorithms/spr.js";
import { remapDemoTeams, isFullyDemoAlliance } from "../../packages/core/algorithms/demoTeams.js";
import { foldsIntoRatings } from "../../packages/core/algorithms/eventTypes.js";
import { RP_RULE_MODULES } from "../../packages/core/rankingPoints/rules.js";
import { corpusColdStartIndex } from "../../packages/harness/corpusColdStart.js";
import { buildSeasonStream, WalkForwardSimulator } from "../../packages/harness/replay.js";
import { seasonBoundaryFor } from "../../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../../packages/harness/sigmaScore.js";
import type { SigmaSeasonCarry } from "../../packages/harness/sigmaCarry.js";
import { resolveDistrictPricingAlgorithm } from "../districtPricingState.js";
import type { EventIndex, EventLog, IndexTeamEntry, LeagueTuple, LogRow, RpVarPart, SeasonStart, SeasonTails, SigmaPart, SprPart, TeamTuple } from "./format.js";

export const CORPUS = "C:/Users/Jacob/Documents/GitHub/SigmaScout/data/corpus.sqlite";
export const ALL_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

export interface SeasonCapture {
  season: number;
  vars: string[];
  start: SeasonStart;
  tails: SeasonTails;
  indexes: Map<string, EventIndex>;
  logs: Map<string, EventLog>;
  meta: {
    season: number;
    events: number;
    rows: number;
    nonFoldingRows: number;
    fullyDemoRows: number;
    teams: number;
    /** Times a team came BACK to an event after playing a row at another event in between. The walk-back lookup assumes this never happens. */
    interleavedReturns: number;
    interleavedExamples: string[];
  };
}

export interface CaptureOptions {
  readonly capture: boolean;
  /** Keep only the target season's stream through this match key (inclusive). Earlier seasons are unchanged. */
  readonly truncateAfter?: string;
  readonly truncateSeason?: number;
  readonly onSeason?: (capture: SeasonCapture) => void;
}

function sortTimesFor(db: Corpus, season: number): Map<string, number> {
  const rows = db
    .prepare(`SELECT m.match_key AS k, m.sort_time AS t FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL`)
    .all(season) as { k: string; t: number }[];
  return new Map(rows.map((r) => [r.k, r.t]));
}

function uniqueKeys(match: MatchResult): string[] {
  return [...new Set([...match.redTeams, ...match.blueTeams])];
}

/** The key SPR's state holds a team under: a demo robot or placeholder slot reads the one shared pseudo entity. */
function stateKeyOf(teamKey: string): string {
  return remapDemoTeams([teamKey])[0]!;
}

function sprPartOf(state: SprState, teamKey: string): SprPart | null {
  const s = state.teams.get(stateKeyOf(teamKey));
  return s === undefined ? null : [s.muL, s.pL, s.muS, s.pS];
}

/**
 * The replay. Mirrors `buildDistrictPricingState` statement for statement
 * (stream, cold-start index, boundary, `carrySeason`, the talent capture, the
 * layer construction and fold order, Sigma carry and RP cold prior ON), except
 * that there is no as-of cut and every season folds a FULL layer with its own
 * rule module, since every season is captured.
 */
export function replayWithCapture(db: Corpus, algorithm: AlgorithmModule<any>, options: CaptureOptions): { matches: number } {
  const seasons = ALL_SEASONS;
  const coldStartIndex = corpusColdStartIndex(db);
  let carriedState: unknown;
  let sigmaCarry: SigmaSeasonCarry | undefined;
  let matches = 0;

  for (const [seasonIdx, s] of seasons.entries()) {
    const fullStream = buildSeasonStream(db, s, { includeOffseason: true });
    let stream = fullStream;
    if (options.truncateAfter !== undefined && s === options.truncateSeason) {
      const at = fullStream.findIndex((m) => m.matchKey === options.truncateAfter);
      if (at < 0) throw new Error(`capture: --truncate-after match ${options.truncateAfter} is not in the ${s} stream`);
      stream = fullStream.slice(0, at + 1);
    }
    matches += stream.length;
    const sortTimes = options.capture ? sortTimesFor(db, s) : new Map<string, number>();

    const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const boundary = seasonBoundaryFor(seasons, seasonIdx);
    // `runAll` falls back to `initState(teams)` when no carried state is supplied. Passing that same
    // value explicitly is identical, and keeps a handle on the season's start state for the capture.
    const initialState: SprState =
      !boundary.isColdStart && carriedState !== undefined && algorithm.carrySeason
        ? (algorithm.carrySeason(carriedState, boundary) as SprState)
        : (algorithm.initState([...teams]) as SprState);
    const initialStates = new Map<string, unknown>([[algorithm.id, initialState]]);

    // Per match, in stream order: the SPR parts of its teams and the league pair, extracted at once so
    // no per-match state object (each holds a whole team Map) is retained.
    const sprAfter: (SprPart | null)[][] = [];
    const leagueAfter: [number, number][] = [];

    const talentAfterMatch = new Map<string, Map<string, number>>();
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      if (algorithmId !== algorithm.id) return;
      if (!usesSigmaScore(algorithmId)) return;
      const involved = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involved);
      const talent = new Map<string, number>();
      for (const teamKey of involved) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.set(match.matchKey, talent);
      if (options.capture) {
        const st = state as SprState;
        sprAfter.push(uniqueKeys(match).map((teamKey) => sprPartOf(st, teamKey)));
        leagueAfter.push([st.logTau, st.scale]);
      }
    };

    const simulator = new WalkForwardSimulator(stream, coldStartIndex);
    const records = simulator.runAll([algorithm], teams, initialStates, onMatchComplete);
    carriedState = records.carryStates.get(algorithm.id);

    const layerOptions = {
      sigmaCarry: { from: boundary.isColdStart ? undefined : sigmaCarry },
      rpColdPrior: true,
    };
    const ruleModule = RP_RULE_MODULES[s];
    const layer = new SigmaScoutLayer(ruleModule, algorithm.id, layerOptions);
    const vars = ruleModule === undefined ? [] : ruleModule.thresholdVariables.map((v) => v.name);

    const sigmaPartOf = (teamKey: string): SigmaPart | null => {
      const b = layer.sigmaBeliefFor(teamKey);
      return b === undefined ? null : [b.meanWeight, b.mean, b.varWeight, b.sumSquares, b.talent];
    };
    const rpPartOf = (teamKey: string): (RpVarPart | null)[] | null => {
      const beliefs = layer.rpBeliefsFor(teamKey);
      if (beliefs === undefined) return null;
      return vars.map((name): RpVarPart | null => {
        const v = beliefs[name];
        return v === undefined ? null : [v.weight, v.weightSquares, v.mean, v.m2];
      });
    };
    const leagueTupleOf = (pair: readonly [number, number]): LeagueTuple => {
      const pop = layer.sigmaPopulation();
      const L: number[] = [pair[0], pair[1], pop?.sumSquares ?? 0, pop?.talentSquares ?? 0, pop?.count ?? 0];
      const rpPop = layer.rpPopulationState();
      for (const name of vars) {
        const v = rpPop?.variables[name];
        L.push(v?.n ?? 0, v?.mean ?? 0, v?.m2 ?? 0);
      }
      const shift = layer.rpMeanShiftState();
      for (const name of vars) {
        const v = shift?.variables[name];
        L.push(v?.count ?? 0, v?.sum ?? 0);
      }
      return L;
    };

    const cap: SeasonCapture = {
      season: s,
      vars,
      start: { season: s, L0: leagueTupleOf([initialState.logTau, initialState.scale]) },
      tails: {},
      indexes: new Map(),
      logs: new Map(),
      meta: { season: s, events: 0, rows: 0, nonFoldingRows: 0, fullyDemoRows: 0, teams: 0, interleavedReturns: 0, interleavedExamples: [] },
    };
    /** The current SPR part per STATE key (so every demo key reads the pseudo entity's latest). */
    const currentSpr = new Map<string, SprPart | null>();
    /** Per team: the event of its latest row this season and that row's sort_time. */
    const lastSeen = new Map<string, { eventKey: string; t: number }>();
    const header = { v: 1 as const, season: s, algorithmId: algorithm.id as string, algorithmVersion: algorithm.version as string, vars };

    let i = 0;
    for (const record of records) {
      if (record.algorithmId !== algorithm.id) continue;
      const match = record.match;
      if (!options.capture) {
        layer.foldPlayed(match, record.prediction, talentAfterMatch.get(match.matchKey));
        continue;
      }
      const keys = uniqueKeys(match);
      const t = sortTimes.get(match.matchKey);
      if (t === undefined) throw new Error(`capture: no sort_time for ${match.matchKey}`);

      let index = cap.indexes.get(match.eventKey);
      let log = cap.logs.get(match.eventKey);
      if (index === undefined || log === undefined) {
        index = { ...header, eventKey: match.eventKey, n: 0, first: t, last: t, lq: null, le: { t, L: [] }, teams: {} };
        log = { ...header, eventKey: match.eventKey, rows: [] };
        cap.indexes.set(match.eventKey, index);
        cap.logs.set(match.eventKey, log);
      }

      // BEFORE the fold: the pre-event tuple of every team making its first appearance at this event.
      for (const teamKey of keys) {
        const seen = lastSeen.get(teamKey);
        const entry = index.teams[teamKey];
        if (entry === undefined) {
          const stateKey = stateKeyOf(teamKey);
          const sprPre = currentSpr.has(stateKey) ? currentSpr.get(stateKey)! : sprPartOf(initialState, teamKey);
          const s0: TeamTuple = [sprPre, sigmaPartOf(teamKey), rpPartOf(teamKey)];
          index.teams[teamKey] = { f: t, l: t, p: seen === undefined ? null : [seen.eventKey, seen.t], s: s0, x: s0 };
        } else if (seen !== undefined && seen.eventKey !== match.eventKey) {
          cap.meta.interleavedReturns += 1;
          if (cap.meta.interleavedExamples.length < 12) cap.meta.interleavedExamples.push(`${teamKey}: ${match.eventKey} after ${seen.eventKey} (${match.matchKey})`);
        }
      }

      layer.foldPlayed(match, record.prediction, talentAfterMatch.get(match.matchKey));

      const L = leagueTupleOf(leagueAfter[i]!);
      const sprParts = sprAfter[i]!;
      const tm: [string, TeamTuple][] = keys.map((teamKey, j) => [teamKey, [sprParts[j]!, sigmaPartOf(teamKey), rpPartOf(teamKey)]]);
      for (let j = 0; j < keys.length; j++) currentSpr.set(stateKeyOf(keys[j]!), sprParts[j]!);
      const row: LogRow = { k: match.matchKey, t, L, tm };
      log.rows.push(row);
      index.n += 1;
      index.last = t;
      index.le = { t, L };
      if (match.compLevel === "qm") index.lq = { t, L };
      for (const [teamKey, tuple] of tm) {
        const entry = index.teams[teamKey] as IndexTeamEntry;
        entry.l = t;
        entry.x = tuple;
        lastSeen.set(teamKey, { eventKey: match.eventKey, t });
        cap.tails[teamKey] = match.eventKey;
      }
      cap.meta.rows += 1;
      if (!foldsIntoRatings(match.eventType)) cap.meta.nonFoldingRows += 1;
      else if (isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams)) cap.meta.fullyDemoRows += 1;
      i += 1;
    }
    sigmaCarry = layer.sigmaCarryOut();

    if (options.capture) {
      cap.meta.events = cap.indexes.size;
      cap.meta.teams = Object.keys(cap.tails).length;
      options.onSeason?.(cap);
    }
  }
  return { matches };
}

export function writeSeason(outRoot: string, cap: SeasonCapture): void {
  const dir = join(outRoot, String(cap.season));
  mkdirSync(join(dir, "index"), { recursive: true });
  mkdirSync(join(dir, "log"), { recursive: true });
  for (const [eventKey, index] of cap.indexes) writeFileSync(join(dir, "index", `${eventKey}.json`), JSON.stringify(index));
  for (const [eventKey, log] of cap.logs) writeFileSync(join(dir, "log", `${eventKey}.json`), JSON.stringify(log));
  writeFileSync(join(dir, "tails.json"), JSON.stringify(cap.tails));
  writeFileSync(join(dir, "start.json"), JSON.stringify(cap.start));
  writeFileSync(join(dir, "meta.json"), JSON.stringify(cap.meta, null, 1));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "no-capture": { type: "boolean" },
      "truncate-after": { type: "string" },
      out: { type: "string" },
      "write-seasons": { type: "string" },
    },
  });
  const capture = values["no-capture"] !== true;
  const out = values.out ?? "reports/asof-spike";
  const writeSeasons = values["write-seasons"] === undefined ? null : new Set(values["write-seasons"].split(",").map(Number));
  const algorithm = resolveDistrictPricingAlgorithm();
  if (algorithm === null) throw new Error("capture: no Sigma algorithm resolved");

  const db = openCorpusReadOnly(CORPUS);
  const t0 = performance.now();
  let writeMs = 0;
  try {
    const result = replayWithCapture(db, algorithm, {
      capture,
      truncateAfter: values["truncate-after"],
      truncateSeason: 2026,
      onSeason: (cap) => {
        console.log(`capture: ${JSON.stringify({ ...cap.meta, interleavedExamples: cap.meta.interleavedExamples.slice(0, 3) })}`);
        if (writeSeasons !== null && !writeSeasons.has(cap.season)) return;
        const w0 = performance.now();
        writeSeason(out, cap);
        writeMs += performance.now() - w0;
      },
    });
    const wallMs = performance.now() - t0;
    const summary = {
      capture,
      truncateAfter: values["truncate-after"] ?? null,
      algorithm: `${algorithm.id}@${algorithm.version}`,
      matches: result.matches,
      wallSeconds: Number((wallMs / 1000).toFixed(1)),
      writeSeconds: Number((writeMs / 1000).toFixed(1)),
      peakRssMb: Number((process.resourceUsage().maxRSS / 1024).toFixed(0)),
      node: process.version,
    };
    console.log(`capture: done ${JSON.stringify(summary)}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, capture ? "run-capture.json" : "run-no-capture.json"), JSON.stringify(summary, null, 1));
  } finally {
    db.close();
  }
}

if (process.argv[1] !== undefined && /capture\.ts$/.test(process.argv[1])) main();
