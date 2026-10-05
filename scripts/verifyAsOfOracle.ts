/**
 * THE AS-OF PROOF ON THE REAL CORPUS (quick task 261005-5g0). Replays every
 * published season once, captures every fold through the publisher's own
 * `AsOfSeasonCapture` and `applyAsOfFold`, then rebuilds state from those
 * objects alone (`resolveAsOf`, `buildAsOfPricer`) and compares it, strictly
 * (`Object.is`), with the offline oracle `buildDistrictPricingState` built at
 * the same instant.
 *
 *   npx tsx scripts/verifyAsOfOracle.ts
 *   npx tsx scripts/verifyAsOfOracle.ts --corpus C:/path/corpus.sqlite --district 2026fim
 *
 * Checks, every one printed as a `verifyAsOfOracle:` summary line:
 *
 *   - THREE CUTS in the district's season: (a) the season start, (b) right
 *     after `{season}miche_qm40` (moved forward if its sort_time is shared),
 *     (c) right after the last row of the district's first competition week.
 *     Every district event with a qualification match after the cut: every
 *     roster team's rating, and every remaining qualification match's whole
 *     prediction.
 *   - TRUNCATION at cut (b): the season replayed again with every match after
 *     the cut removed; every team the truncated season has seen, and the
 *     league, read back at the cut from both captures, deep strict equal.
 *   - OVERLAP, 2023: a team with two segments at one event (a team that
 *     played elsewhere in between), at a cut inside that overlap; the event
 *     roster's rebuilt ratings against the oracle's.
 *   - SIZES of every object the publisher would upload, per family and per
 *     season, measured the way the publisher serializes them. These are the
 *     measurement behind `AS_OF_BUDGET_MAX_BYTES`.
 *
 * `--init-teams publish` starts the cold-start season from the publisher's
 * own team list (scheduled teams in, demo keys out) instead of the oracle's
 * (every team in the played stream). It only matters for the first season.
 *
 * Exits non-zero on any mismatch. A full run replays ten seasons once, plus
 * one oracle build per cut and one for the overlap (each a replay of its
 * own): about fifteen minutes and under 4 GB.
 *
 * CREDENTIALS: reads the corpus READ-ONLY. No network request, no environment
 * variable, no credential, no R2, no D1. `.env` is never read.
 */
import { parseArgs } from "node:util";
import { openCorpusReadOnly, selectMatchesChronological, selectScheduledMatches, type Corpus } from "../packages/corpus/db.js";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type UpcomingMatch } from "../packages/core/algorithms/types.js";
import type { SprState } from "../packages/core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import type { SigmaSeasonCarry } from "../packages/harness/sigmaCarry.js";
import { cancelledEventKeysForSeason } from "../packages/harness/publish.js";
import { AsOfSeasonCapture, type AsOfSeasonCaptureResult } from "../packages/harness/asOfCapture.js";
import {
  AS_OF_SEASON_START_CUT,
  asOfAtOrBefore,
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  type AsOfCut,
  type AsOfIndex,
  type AsOfLog,
  type AsOfTeamTuple,
} from "../packages/harness/asOfState.js";
import { asOfCutAtMatch, resolveAsOf, type AsOfResolveResult, type AsOfResolveTeam } from "../packages/harness/asOfLookup.js";
import { buildAsOfPricer } from "../packages/harness/asOfPricing.js";
import { AS_OF_FAMILIES, percentileOf, type AsOfFamily } from "../packages/harness/publishBudget.js";
import { buildDistrictPricingState, resolveDistrictPricingAlgorithm } from "./districtPricingState.js";

const DEFAULT_CORPUS = "data/corpus.sqlite";
/** The seasons `pnpm publish:seasons` publishes, in replay order (2021 has no corpus season). */
const SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];
const OVERLAP_SEASON = 2023;
const STAMP = { generation: "verify-asof-oracle", computedAt: new Date(0).toISOString() };

let mismatchTotal = 0;
function line(label: string, payload: unknown): void {
  console.log(`verifyAsOfOracle: ${label} ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// The replay: buildDistrictPricingState's loop, no cut, a full layer every season
// ---------------------------------------------------------------------------

function sortTimesFor(db: Corpus, season: number): Map<string, number> {
  const rows = db
    .prepare(`SELECT m.match_key AS k, m.sort_time AS t FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL`)
    .all(season) as { k: string; t: number }[];
  return new Map(rows.map((r) => [r.k, r.t]));
}

/** The publisher's own cold-start team list: played and scheduled teams of every non-cancelled event, demo keys out. */
function publishTeamsFor(db: Corpus, season: number, stream: readonly MatchResult[]): string[] {
  const cancelled = cancelledEventKeysForSeason(db, season, Date.now());
  const scheduled = selectScheduledMatches(db, { year: season, excludeOffseason: false }).filter((m) => !cancelled.has(m.eventKey));
  return [...new Set([...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]), ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])])].filter(
    (teamKey) => !isDemoTeamKey(teamKey)
  );
}

interface Carry {
  carriedState: unknown;
  sigmaCarry: SigmaSeasonCarry | undefined;
}

/**
 * One season, mirroring `buildDistrictPricingState` statement for statement
 * (stream, cold-start index, boundary, `carrySeason`, the talent capture, the
 * Sigma carry and the RP cold prior), with the capture's two hooks in it.
 */
function replaySeason(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  seasonIdx: number,
  carry: Carry,
  options: { truncateAfter?: string; initTeams: "oracle" | "publish"; coldStartIndex: ReadonlySet<string> }
): { capture: AsOfSeasonCaptureResult; carry: Carry; matches: number } {
  const s = SEASONS[seasonIdx]!;
  const fullStream = buildSeasonStream(db, s, { includeOffseason: true });
  let stream = fullStream;
  if (options.truncateAfter !== undefined) {
    const at = fullStream.findIndex((m) => m.matchKey === options.truncateAfter);
    if (at < 0) throw new Error(`verifyAsOfOracle: ${options.truncateAfter} is not in the ${s} stream`);
    stream = fullStream.slice(0, at + 1);
  }
  const sortTimes = sortTimesFor(db, s);
  const streamTeams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
  const teams = options.initTeams === "publish" ? publishTeamsFor(db, s, stream) : streamTeams;
  const boundary = seasonBoundaryFor(SEASONS, seasonIdx);
  let initialStates: ReadonlyMap<string, unknown> | undefined;
  if (!boundary.isColdStart && carry.carriedState !== undefined && algorithm.carrySeason) {
    initialStates = new Map<string, unknown>([[algorithm.id, algorithm.carrySeason(carry.carriedState, boundary)]]);
  }

  const ruleModule = RP_RULE_MODULES[s];
  const capture = new AsOfSeasonCapture({
    season: s,
    vars: ruleModule?.thresholdVariables.map((v) => v.name) ?? [],
    initialState: (initialStates?.get(algorithm.id) ?? algorithm.initState([...teams])) as SprState,
    stamp: { ...STAMP, algorithmId: algorithm.id, algorithmVersion: algorithm.version },
    sortTimeOf: (matchKey) => sortTimes.get(matchKey),
  });

  const talentAfterMatch = new Map<string, Map<string, number>>();
  const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
    if (algorithmId !== algorithm.id) return;
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = algorithm.teamMetrics(state, involved);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
    capture.onMatchComplete(match, state as SprState);
  };

  const simulator = new WalkForwardSimulator(stream, options.coldStartIndex);
  const records = simulator.runAll([algorithm], teams, initialStates, onMatchComplete);

  const layer = new SigmaScoutLayer(ruleModule, algorithm.id, { sigmaCarry: { from: boundary.isColdStart ? undefined : carry.sigmaCarry }, rpColdPrior: true });
  capture.attachLayer(layer);
  for (const record of records) {
    if (record.algorithmId !== algorithm.id) continue;
    capture.foldLayer(record.match, () => layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey)));
  }
  return {
    capture: capture.finish(),
    carry: { carriedState: records.carryStates.get(algorithm.id), sigmaCarry: layer.sigmaCarryOut() },
    matches: stream.length,
  };
}

// ---------------------------------------------------------------------------
// Sizes, serialized exactly as the publisher serializes them
// ---------------------------------------------------------------------------

const sizes: Record<AsOfFamily, { key: string; bytes: number; season: number }[]> = { asof: [], "asof-log": [], "asof-season": [] };

function measure(capture: AsOfSeasonCaptureResult): void {
  const season = capture.season.season;
  for (const [eventKey, index] of capture.indexes) {
    sizes.asof.push({ key: `v1/asof/${eventKey}`, bytes: Buffer.byteLength(JSON.stringify(AsOfIndexSchema.parse(index))), season });
    sizes["asof-log"].push({ key: `v1/asof-log/${eventKey}`, bytes: Buffer.byteLength(JSON.stringify(AsOfLogSchema.parse(capture.logs.get(eventKey)))), season });
  }
  sizes["asof-season"].push({ key: `v1/asof-season/${season}`, bytes: Buffer.byteLength(JSON.stringify(AsOfSeasonSchema.parse(capture.season))), season });
}

function printSizes(): void {
  for (const family of AS_OF_FAMILIES) {
    const list = [...sizes[family]].sort((a, b) => a.bytes - b.bytes);
    const bytes = list.map((r) => r.bytes);
    const largest = list[list.length - 1]!;
    line(`sizes ${family}`, {
      count: list.length,
      medianBytes: percentileOf(bytes, 50),
      p95Bytes: percentileOf(bytes, 95),
      maxBytes: largest.bytes,
      largestKey: largest.key,
      totalBytes: bytes.reduce((sum, b) => sum + b, 0),
    });
  }
  const perSeason = SEASONS.map((season) => {
    const objects = AS_OF_FAMILIES.flatMap((family) => sizes[family].filter((r) => r.season === season));
    return { season, objects: objects.length, bytes: objects.reduce((sum, r) => sum + r.bytes, 0) };
  });
  line("sizes per season", perSeason);
}

// ---------------------------------------------------------------------------
// Rebuilding from the captured objects
// ---------------------------------------------------------------------------

/** The browser's loop over in-memory objects: resolve, supply what was missing (absent means unpublished), repeat. */
function resolveFrom(capture: AsOfSeasonCaptureResult, cut: AsOfCut, teams: readonly AsOfResolveTeam[]): AsOfResolveResult & { indexReads: number; logReads: number } {
  const indexes = new Map<string, AsOfIndex | null>();
  const logs = new Map<string, AsOfLog | null>();
  for (let round = 0; round < 200; round++) {
    const result = resolveAsOf({ cut, teams, season: capture.season, indexes, logs });
    if (result.missingIndexes.length === 0 && result.missingLogs.length === 0) return { ...result, indexReads: indexes.size, logReads: logs.size };
    for (const key of result.missingIndexes) indexes.set(key, capture.indexes.get(key) ?? null);
    for (const key of result.missingLogs) logs.set(key, capture.logs.get(key) ?? null);
  }
  throw new Error("verifyAsOfOracle: resolveAsOf did not settle in 200 rounds");
}

class Tally {
  compared = 0;
  mismatches = 0;
  maxAbsDiff = 0;
  readonly examples: string[] = [];

  check(label: string, mine: unknown, oracle: unknown): void {
    if (Array.isArray(mine) || Array.isArray(oracle)) {
      const a = (mine ?? []) as unknown[];
      const b = (oracle ?? []) as unknown[];
      if (!Array.isArray(mine) || !Array.isArray(oracle) || a.length !== b.length) this.fail(label, mine, oracle, Infinity);
      for (let i = 0; i < Math.max(a.length, b.length); i++) this.check(`${label}[${i}]`, a[i], b[i]);
      return;
    }
    this.compared += 1;
    if (Object.is(mine, oracle)) return;
    this.fail(label, mine, oracle, typeof mine === "number" && typeof oracle === "number" ? Math.abs(mine - oracle) : Infinity);
  }

  private fail(label: string, mine: unknown, oracle: unknown, diff: number): void {
    this.mismatches += 1;
    this.maxAbsDiff = Math.max(this.maxAbsDiff, diff);
    if (this.examples.length < 12) this.examples.push(`${label}: rebuilt ${JSON.stringify(mine)} oracle ${JSON.stringify(oracle)}`);
  }
}

function toUpcoming(m: MatchResult): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    redTeams: m.redTeams,
    blueTeams: m.blueTeams,
    redSurrogates: m.redSurrogates,
    blueSurrogates: m.blueSurrogates,
    eventType: m.eventType,
    week: m.week,
  };
}

function tuplesFor(roster: readonly string[], resolved: AsOfResolveResult): Map<string, AsOfTeamTuple> {
  const tuples = new Map<string, AsOfTeamTuple>();
  for (const teamKey of roster) tuples.set(teamKey, resolved.states.get(teamKey)!);
  if (roster.some((teamKey) => isDemoTeamKey(teamKey))) tuples.set(DEMO_PSEUDO_TEAM_KEY, resolved.states.get(DEMO_PSEUDO_TEAM_KEY)!);
  return tuples;
}

/** Strict deep equality, numbers by `Object.is`. */
function strictEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => strictEqual(v, b[i]));
  return a === b;
}

function sharedSortTimeCount(db: Corpus, season: number, t: number): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time = ?`).get(season, t) as {
      c: number;
    }
  ).c;
}

// ---------------------------------------------------------------------------
// The district cuts
// ---------------------------------------------------------------------------

interface DistrictEvent {
  readonly eventKey: string;
  readonly eventType: number;
  readonly week: number | null;
  readonly matches: MatchResult[];
  readonly roster: string[];
}

function loadDistrictEvents(db: Corpus, season: number, districtKey: string): DistrictEvent[] {
  const rows = db.prepare(`SELECT event_key AS k, event_type AS ty, week AS w FROM events WHERE year = ? AND district_key = ? ORDER BY event_key`).all(season, districtKey) as {
    k: string;
    ty: number;
    w: number | null;
  }[];
  return rows.map((row) => {
    const matches = selectMatchesChronological(db, { eventKey: row.k });
    return { eventKey: row.k, eventType: row.ty, week: row.w, matches, roster: [...new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort() };
  });
}

interface CutSpec {
  readonly id: string;
  readonly label: string;
  readonly cut: AsOfCut;
  readonly asOf: string;
}

function districtCuts(db: Corpus, season: number, events: readonly DistrictEvent[], capture: AsOfSeasonCaptureResult): CutSpec[] {
  const first = Math.min(...[...capture.indexes.values()].map((index) => index.m[0]![1]));
  // (b) right after {season}miche_qm40, moved forward until no other played match shares its sort_time.
  const micheKey = `${season}miche`;
  const miche = capture.indexes.get(micheKey);
  if (miche === undefined) throw new Error(`verifyAsOfOracle: no ${micheKey} INDEX; pass a district whose season has it, or extend the cut rules`);
  let bIndex = miche.m.findIndex(([matchKey]) => matchKey === `${micheKey}_qm40`);
  while (sharedSortTimeCount(db, season, miche.m[bIndex]![1]) !== 1) bIndex += 1;
  const b = { eventKey: micheKey, t: miche.m[bIndex]![1], i: bIndex };

  // (c) right after the last row of the district's first competition week.
  const districtTier = events.filter((e) => e.eventType === 1 && e.week !== null && e.matches.length > 0);
  const firstWeek = Math.min(...districtTier.map((e) => e.week!));
  let c: AsOfCut | undefined;
  for (const event of districtTier.filter((e) => e.week === firstWeek)) {
    const index = capture.indexes.get(event.eventKey)!;
    const i = index.m.length - 1;
    const candidate = { eventKey: event.eventKey, t: index.m[i]![1], i };
    if (c === undefined || !asOfAtOrBefore(candidate.eventKey, [candidate.t, candidate.i], c)) c = candidate;
  }
  if (c === undefined) throw new Error("verifyAsOfOracle: the district has no first-week event");
  if (sharedSortTimeCount(db, season, c.t) !== 1) throw new Error(`verifyAsOfOracle: cut (c) ${c.eventKey}[${c.i}] shares its sort_time with another match`);

  return [
    { id: "a", label: "season start", cut: AS_OF_SEASON_START_CUT, asOf: new Date(first - 1).toISOString() },
    { id: "b", label: `right after ${miche.m[b.i]![0]}`, cut: b, asOf: new Date(b.t + 1).toISOString() },
    { id: "c", label: `right after ${capture.indexes.get(c.eventKey)!.m[c.i]![0]} (last row of week ${firstWeek})`, cut: c, asOf: new Date(c.t + 1).toISOString() },
  ];
}

function rowAfterCut(capture: AsOfSeasonCaptureResult, match: MatchResult, cut: AsOfCut): boolean {
  const position = asOfCutAtMatch(capture.indexes.get(match.eventKey)!, match.matchKey);
  if (position === undefined) throw new Error(`verifyAsOfOracle: ${match.matchKey} has no INDEX row`);
  return !asOfAtOrBefore(match.eventKey, [position.t, position.i], cut);
}

function runCut(db: Corpus, algorithm: AlgorithmModule<any>, season: number, events: readonly DistrictEvent[], capture: AsOfSeasonCaptureResult, spec: CutSpec): void {
  const priced = events.filter((e) => e.matches.some((m) => m.compLevel === "qm" && rowAfterCut(capture, m, spec.cut)));
  const known = new Map<string, Set<string>>();
  for (const event of events) for (const teamKey of event.roster) known.set(teamKey, (known.get(teamKey) ?? new Set()).add(event.eventKey));
  const teamKeys = [...new Set(priced.flatMap((e) => e.roster))];
  const t0 = performance.now();
  const resolved = resolveFrom(
    capture,
    spec.cut,
    teamKeys.map((teamKey) => ({ teamKey, knownEventKeys: [...known.get(teamKey)!] }))
  );
  const lookupMs = performance.now() - t0;
  if (resolved.league === undefined) throw new Error(`verifyAsOfOracle: cut ${spec.id} resolved no league tuple`);

  const o0 = performance.now();
  const oracle = buildDistrictPricingState(db, { season, warmupSeasons: SEASONS.filter((s) => s < season), asOf: spec.asOf, algorithm });
  if (oracle === null) throw new Error(`verifyAsOfOracle: the oracle returned null at ${spec.asOf}`);
  const oracleSeconds = (performance.now() - o0) / 1000;

  const ratings = new Tally();
  const predictions = new Tally();
  let quals = 0;
  let refused = 0;
  for (const event of priced) {
    const pricer = buildAsOfPricer({ season, vars: capture.season.vars, league: resolved.league, teams: tuplesFor(event.roster, resolved) });
    const mine = pricer.ratingsFor(event.roster);
    const theirs = oracle.ratingsFor(event.roster);
    for (const teamKey of event.roster) {
      ratings.check(`${event.eventKey} ${teamKey} total`, mine.get(teamKey)?.total, theirs.get(teamKey)?.total);
      ratings.check(`${event.eventKey} ${teamKey} sigma`, mine.get(teamKey)?.sigma, theirs.get(teamKey)?.sigma);
    }
    const minePredict = pricer.predictFor(event.roster);
    const theirPredict = oracle.predictFor(event.roster);
    predictions.check(`${event.eventKey} roster gate`, minePredict === undefined, theirPredict === undefined);
    if (minePredict === undefined || theirPredict === undefined) {
      refused += 1;
      continue;
    }
    for (const match of event.matches) {
      if (match.compLevel !== "qm" || !rowAfterCut(capture, match, spec.cut)) continue;
      quals += 1;
      const a: Prediction = minePredict(toUpcoming(match));
      const b: Prediction = theirPredict(toUpcoming(match));
      for (const key of Object.keys(b) as (keyof Prediction)[]) predictions.check(`${match.matchKey} ${String(key)}`, a[key], b[key]);
    }
  }
  mismatchTotal += ratings.mismatches + predictions.mismatches;
  line(`cut ${spec.id}`, {
    label: spec.label,
    oracleAsOf: spec.asOf,
    oracleMatchesReplayed: oracle.matchesReplayed,
    oracleSeconds: Number(oracleSeconds.toFixed(1)),
    events: priced.length,
    teams: teamKeys.length,
    quals,
    refusedRosters: refused,
    ratingComparisons: ratings.compared,
    ratingMismatches: ratings.mismatches,
    predictionComparisons: predictions.compared,
    predictionMismatches: predictions.mismatches,
    maxAbsDiff: Math.max(ratings.maxAbsDiff, predictions.maxAbsDiff),
    lookupMs: Number(lookupMs.toFixed(1)),
    indexReads: resolved.indexReads,
    logReads: resolved.logReads,
    examples: [...ratings.examples, ...predictions.examples],
  });
}

function runTruncation(full: AsOfSeasonCaptureResult, truncated: AsOfSeasonCaptureResult, spec: CutSpec): void {
  const teams = Object.keys(truncated.season.tails).map((teamKey) => ({ teamKey, knownEventKeys: [] as string[] }));
  const fromFull = resolveFrom(full, spec.cut, teams);
  const fromTrunc = resolveFrom(truncated, spec.cut, teams);
  let mismatches = 0;
  const examples: string[] = [];
  for (const { teamKey } of teams) {
    if (strictEqual(fromFull.states.get(teamKey), fromTrunc.states.get(teamKey))) continue;
    mismatches += 1;
    if (examples.length < 12) examples.push(teamKey);
  }
  const leagueIdentical = strictEqual(fromFull.league, fromTrunc.league);
  mismatchTotal += mismatches + (leagueIdentical ? 0 : 1);
  line(`truncation cut ${spec.id}`, {
    label: spec.label,
    teamsCompared: teams.length,
    demoOrPseudoAmongThem: teams.filter(({ teamKey }) => isDemoTeamKey(teamKey) || teamKey === DEMO_PSEUDO_TEAM_KEY).length,
    tupleMismatches: mismatches,
    leagueIdentical,
    fullCaptureIndexReads: fromFull.indexReads,
    fullCaptureLogReads: fromFull.logReads,
    examples,
  });
}

// ---------------------------------------------------------------------------
// The overlap check
// ---------------------------------------------------------------------------

function runOverlap(db: Corpus, algorithm: AlgorithmModule<any>, capture: AsOfSeasonCaptureResult): void {
  const season = capture.season.season;
  const pairs: { teamKey: string; eventKey: string }[] = [];
  for (const [eventKey, index] of capture.indexes) {
    for (const [teamKey, segments] of Object.entries(index.teams)) {
      if (segments.length > 1 && !isDemoTeamKey(teamKey) && teamKey !== DEMO_PSEUDO_TEAM_KEY) pairs.push({ teamKey, eventKey });
    }
  }
  pairs.sort((a, b) => (a.eventKey + a.teamKey < b.eventKey + b.teamKey ? -1 : 1));

  // A cut inside the overlap: the first row of the event, after the team's row elsewhere and before its return,
  // else that row elsewhere itself; always at a sort_time no other played match shares.
  let chosen: { teamKey: string; eventKey: string; cut: AsOfCut; label: string } | undefined;
  for (const pair of pairs) {
    const index = capture.indexes.get(pair.eventKey)!;
    const [first, second] = index.teams[pair.teamKey]!;
    const p = second!.p!;
    const candidates: AsOfCut[] = [];
    for (let i = first!.l[1] + 1; i < second!.f[1]; i++) {
      const cut = { eventKey: pair.eventKey, t: index.m[i]![1], i };
      if (!asOfAtOrBefore(cut.eventKey, [cut.t, cut.i], { eventKey: p[0], t: p[1], i: p[2] })) candidates.push(cut);
    }
    candidates.push({ eventKey: p[0], t: p[1], i: p[2] });
    const cut = candidates.find((candidate) => sharedSortTimeCount(db, season, candidate.t) === 1);
    if (cut === undefined) continue;
    chosen = { ...pair, cut, label: `${pair.teamKey} at ${pair.eventKey}, cut right after ${capture.indexes.get(cut.eventKey)!.m[cut.i]![0]}` };
    break;
  }
  if (chosen === undefined) throw new Error(`verifyAsOfOracle: no overlap pair in ${season} has a cut at an unshared sort_time`);

  const roster = [...new Set([chosen.teamKey, ...Object.keys(capture.indexes.get(chosen.eventKey)!.teams)])].filter((teamKey) => teamKey !== DEMO_PSEUDO_TEAM_KEY).sort();
  const resolved = resolveFrom(
    capture,
    chosen.cut,
    roster.map((teamKey) => ({ teamKey, knownEventKeys: [chosen!.eventKey] }))
  );
  const asOf = new Date(chosen.cut.t + 1).toISOString();
  const oracle = buildDistrictPricingState(db, { season, warmupSeasons: SEASONS.filter((s) => s < season), asOf, algorithm });
  if (oracle === null) throw new Error(`verifyAsOfOracle: the overlap oracle returned null at ${asOf}`);
  const pricer = buildAsOfPricer({ season, vars: capture.season.vars, league: resolved.league!, teams: tuplesFor(roster, resolved) });
  const mine = pricer.ratingsFor(roster);
  const theirs = oracle.ratingsFor(roster);
  const tally = new Tally();
  for (const teamKey of roster) {
    tally.check(`${teamKey} total`, mine.get(teamKey)?.total, theirs.get(teamKey)?.total);
    tally.check(`${teamKey} sigma`, mine.get(teamKey)?.sigma, theirs.get(teamKey)?.sigma);
  }
  const team = new Tally();
  team.check(`${chosen.teamKey} total`, mine.get(chosen.teamKey)?.total, theirs.get(chosen.teamKey)?.total);
  team.check(`${chosen.teamKey} sigma`, mine.get(chosen.teamKey)?.sigma, theirs.get(chosen.teamKey)?.sigma);
  mismatchTotal += tally.mismatches;
  line("overlap", {
    season,
    realTeamPairsWithTwoOrMoreSegments: pairs.length,
    label: chosen.label,
    oracleAsOf: asOf,
    overlapTeamMismatches: team.mismatches,
    rosterTeams: roster.length,
    ratingComparisons: tally.compared,
    ratingMismatches: tally.mismatches,
    examples: tally.examples,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { values } = parseArgs({ options: { corpus: { type: "string" }, district: { type: "string" }, "init-teams": { type: "string" } } });
  const district = values.district ?? "2026fim";
  const match = /^(\d{4})([a-z]+)$/.exec(district);
  if (match === null) throw new Error(`--district must look like 2026fim, got "${district}"`);
  const season = Number(match[1]);
  const districtKey = match[2]!;
  const initTeams = values["init-teams"] === "publish" ? "publish" : "oracle";
  if (!SEASONS.includes(season) || !SEASONS.includes(OVERLAP_SEASON)) throw new Error(`--district season ${season} is not a published season`);
  const algorithm = resolveDistrictPricingAlgorithm();
  if (algorithm === null) throw new Error("verifyAsOfOracle: no Sigma algorithm resolved");

  const db = openCorpusReadOnly(values.corpus ?? DEFAULT_CORPUS);
  const started = performance.now();
  try {
    const coldStartIndex = corpusColdStartIndex(db);
    let carry: Carry = { carriedState: undefined, sigmaCarry: undefined };
    let target: AsOfSeasonCaptureResult | undefined;
    let overlap: AsOfSeasonCaptureResult | undefined;
    let carryIntoTarget: Carry | undefined;
    for (const [seasonIdx, s] of SEASONS.entries()) {
      if (s > season) break;
      if (s === season) carryIntoTarget = carry;
      const r0 = performance.now();
      const replayed = replaySeason(db, algorithm, seasonIdx, carry, { initTeams, coldStartIndex });
      carry = replayed.carry;
      measure(replayed.capture);
      line(`replayed ${s}`, { matches: replayed.matches, events: replayed.capture.indexes.size, seconds: Number(((performance.now() - r0) / 1000).toFixed(1)) });
      if (s === season) target = replayed.capture;
      if (s === OVERLAP_SEASON) overlap = replayed.capture;
    }
    if (target === undefined || overlap === undefined || carryIntoTarget === undefined) throw new Error("verifyAsOfOracle: the replay did not reach the target season");
    if (season === SEASONS[SEASONS.length - 1]) printSizes();
    else line("sizes", "skipped: only a run whose district season is the last published season replays every season");

    const events = loadDistrictEvents(db, season, districtKey);
    if (events.length === 0) throw new Error(`verifyAsOfOracle: no ${districtKey} events in ${season}`);
    const specs = districtCuts(db, season, events, target);
    for (const spec of specs) runCut(db, algorithm, season, events, target, spec);

    const b = specs.find((spec) => spec.id === "b")!;
    const truncated = replaySeason(db, algorithm, SEASONS.indexOf(season), carryIntoTarget, {
      truncateAfter: target.indexes.get(b.cut.eventKey)!.m[b.cut.i]![0],
      initTeams,
      coldStartIndex,
    });
    runTruncation(target, truncated.capture, b);

    runOverlap(db, algorithm, overlap);
  } finally {
    db.close();
  }
  line("RESULT", {
    mismatches: mismatchTotal,
    initTeams,
    algorithm: `${algorithm.id}@${algorithm.version}`,
    seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    peakRssMb: Number((process.resourceUsage().maxRSS / 1024).toFixed(0)),
  });
  if (mismatchTotal > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && /verifyAsOfOracle\.ts$/.test(process.argv[1])) main();
