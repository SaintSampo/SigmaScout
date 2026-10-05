/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). The proof: rebuild as-of
 * state from the captured 2026 FILES alone (`reports/asof-spike/2026/`), price
 * from it with `lookup.ts`, and compare strictly (`Object.is`) against the
 * offline oracle `buildDistrictPricingState` built at the same instant.
 *
 *   npx tsx scripts/asOfSpike/oracleCheck.ts --cut a      season start
 *   npx tsx scripts/asOfSpike/oracleCheck.ts --cut b      right after 2026miche qm40
 *   npx tsx scripts/asOfSpike/oracleCheck.ts --cut c      right after the last match of fim's first competition week
 *   npx tsx scripts/asOfSpike/oracleCheck.ts --trunc      cut (b): the full capture's lookup against a capture of the truncated stream
 *
 * Corpus READ-ONLY. No network, no credential.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../../packages/corpus/db.js";
import { isDemoTeamKey } from "../../packages/core/algorithms/demoTeams.js";
import type { MatchResult, Prediction, UpcomingMatch } from "../../packages/core/algorithms/types.js";
import { buildDistrictPricingState, resolveDistrictPricingAlgorithm } from "../districtPricingState.js";
import { SEASON_START_CUT, atOrBefore, isSeasonStartCut, type Cut, type EventIndex, type EventLog, type SeasonStart, type SeasonTails, type TeamTuple } from "./format.js";
import { buildAsOfPricer, leagueAt, resolveTeamStateAt, type AsOfSource, type ResolvedTeam } from "./lookup.js";

const CORPUS = "C:/Users/Jacob/Documents/GitHub/SigmaScout/data/corpus.sqlite";
const ROOT = "reports/asof-spike";
const SEASON = 2026;
const WARMUP = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025];
const DISTRICT = "fim";

/** Reads the captured JSON files, caching each and recording which were read. */
export class FileSource implements AsOfSource {
  readonly indexReads = new Set<string>();
  readonly logReads = new Set<string>();
  readonly tails: SeasonTails;
  readonly start: SeasonStart;
  readonly #dir: string;
  readonly #indexes = new Map<string, EventIndex>();
  readonly #logs = new Map<string, EventLog>();

  constructor(dir: string) {
    this.#dir = dir;
    this.tails = JSON.parse(readFileSync(join(dir, "tails.json"), "utf8")) as SeasonTails;
    this.start = JSON.parse(readFileSync(join(dir, "start.json"), "utf8")) as SeasonStart;
  }

  getIndex(eventKey: string): EventIndex {
    let index = this.#indexes.get(eventKey);
    if (index === undefined) {
      index = JSON.parse(readFileSync(join(this.#dir, "index", `${eventKey}.json`), "utf8")) as EventIndex;
      this.#indexes.set(eventKey, index);
      this.indexReads.add(eventKey);
    }
    return index;
  }

  getLog(eventKey: string): EventLog {
    let log = this.#logs.get(eventKey);
    if (log === undefined) {
      log = JSON.parse(readFileSync(join(this.#dir, "log", `${eventKey}.json`), "utf8")) as EventLog;
      this.#logs.set(eventKey, log);
      this.logReads.add(eventKey);
    }
    return log;
  }
}

interface FimEvent {
  eventKey: string;
  eventType: number;
  week: number | null;
  tier: "district" | "dcmp";
  /** Played matches in stream order, which is the log's row order. */
  matches: MatchResult[];
  times: number[];
  roster: string[];
}

function loadFimEvents(db: Corpus): FimEvent[] {
  const rows = db.prepare(`SELECT event_key AS k, event_type AS ty, week AS w FROM events WHERE year = ? AND district_key = ? ORDER BY event_key`).all(SEASON, DISTRICT) as {
    k: string;
    ty: number;
    w: number | null;
  }[];
  const timeOf = db.prepare(`SELECT sort_time AS t FROM matches WHERE match_key = ?`);
  return rows.map((row) => {
    const matches = selectMatchesChronological(db, { eventKey: row.k });
    return {
      eventKey: row.k,
      eventType: row.ty,
      week: row.w,
      tier: row.ty === 1 ? ("district" as const) : ("dcmp" as const),
      matches,
      times: matches.map((m) => (timeOf.get(m.matchKey) as { t: number }).t),
      roster: [...new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort(),
    };
  });
}

function sameInstantCount(db: Corpus, t: number): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time = ?`).get(SEASON, t) as { c: number }
  ).c;
}

interface CutSpec {
  id: "a" | "b" | "c";
  label: string;
  cut: Cut;
  asOf: string;
  note: string;
}

function cutSpecs(db: Corpus, events: FimEvent[]): Record<"a" | "b" | "c", CutSpec> {
  const first = (db.prepare(`SELECT MIN(m.sort_time) AS t FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = ? AND m.winner IS NOT NULL`).get(SEASON) as { t: number }).t;

  const miche = events.find((e) => e.eventKey === "2026miche")!;
  let bIndex = miche.matches.findIndex((m) => m.matchKey === "2026miche_qm40");
  let bNote = "2026miche_qm40, no other 2026 match shares its sort_time";
  while (sameInstantCount(db, miche.times[bIndex]!) !== 1) {
    bIndex += 1;
    bNote = `moved to ${miche.matches[bIndex]!.matchKey} because an earlier candidate shared its sort_time with another 2026 match`;
  }

  const firstWeek = Math.min(...events.filter((e) => e.tier === "district" && e.week !== null).map((e) => e.week!));
  const weekOne = events.filter((e) => e.tier === "district" && e.week === firstWeek);
  let last: { event: FimEvent; i: number } | undefined;
  for (const event of weekOne) {
    const i = event.matches.length - 1;
    if (last === undefined || event.times[i]! > last.event.times[last.i]! || (event.times[i]! === last.event.times[last.i]! && event.eventKey > last.event.eventKey)) last = { event, i };
  }
  if (last === undefined) throw new Error("no first-week fim event");
  const cT = last.event.times[last.i]!;
  const cShared = sameInstantCount(db, cT);
  if (cShared !== 1) throw new Error(`cut (c): ${cShared} matches share the sort_time of ${last.event.matches[last.i]!.matchKey}`);

  return {
    a: { id: "a", label: "season start", cut: SEASON_START_CUT, asOf: new Date(first - 1).toISOString(), note: `oracle asOf is 1 ms before the first 2026 match (sort_time ${first})` },
    b: {
      id: "b",
      label: `right after ${miche.matches[bIndex]!.matchKey}`,
      cut: { t: miche.times[bIndex]!, eventKey: miche.eventKey, rowIndex: bIndex },
      asOf: new Date(miche.times[bIndex]! + 1).toISOString(),
      note: bNote,
    },
    c: {
      id: "c",
      label: `right after ${last.event.matches[last.i]!.matchKey} (last match of fim week index ${firstWeek}: ${weekOne.map((e) => e.eventKey).join(", ")})`,
      cut: { t: cT, eventKey: last.event.eventKey, rowIndex: last.i },
      asOf: new Date(cT + 1).toISOString(),
      note: "no other 2026 match shares its sort_time",
    },
  };
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

class Tally {
  compared = 0;
  mismatches = 0;
  maxAbsDiff = 0;
  examples: string[] = [];

  check(label: string, mine: number | undefined, oracle: number | undefined): void {
    this.compared += 1;
    if (Object.is(mine, oracle)) return;
    this.mismatches += 1;
    if (typeof mine === "number" && typeof oracle === "number") this.maxAbsDiff = Math.max(this.maxAbsDiff, Math.abs(mine - oracle));
    else this.maxAbsDiff = Infinity;
    if (this.examples.length < 20) this.examples.push(`${label}: rebuilt ${String(mine)} oracle ${String(oracle)}`);
  }

  checkArray(label: string, mine: readonly number[] | undefined, oracle: readonly number[] | undefined): void {
    if (mine === undefined || oracle === undefined) {
      this.compared += 1;
      if (mine !== oracle) {
        this.mismatches += 1;
        this.maxAbsDiff = Infinity;
        if (this.examples.length < 20) this.examples.push(`${label}: one side has no pmf (rebuilt ${mine === undefined ? "absent" : "present"}, oracle ${oracle === undefined ? "absent" : "present"})`);
      }
      return;
    }
    const n = Math.max(mine.length, oracle.length);
    for (let i = 0; i < n; i++) this.check(`${label}[${i}]`, mine[i], oracle[i]);
  }
}

function rowAfterCut(event: FimEvent, i: number, cut: Cut): boolean {
  return !atOrBefore(event.times[i]!, event.eventKey, cut, i);
}

function runCut(db: Corpus, events: FimEvent[], spec: CutSpec): void {
  const algorithm = resolveDistrictPricingAlgorithm();
  if (algorithm === null) throw new Error("no algorithm");
  const fimKeys = new Set(events.map((e) => e.eventKey));
  const cut = spec.cut;

  // Which fim events are priced at this cut: every one whose first match is after it, and any in progress.
  const checked = events.filter((e) => e.matches.length > 0 && rowAfterCut(e, e.matches.length - 1, cut));
  const inProgress = checked.filter((e) => !rowAfterCut(e, 0, cut)).map((e) => e.eventKey);

  // --- rebuild from files only ---
  const source = new FileSource(join(ROOT, String(SEASON)));
  const t0 = performance.now();
  const startEvent = new Map<string, { eventKey: string; f: number }>();
  for (const event of checked) {
    const index = source.getIndex(event.eventKey);
    for (const teamKey of event.roster) {
      const entry = index.teams[teamKey];
      if (entry === undefined) throw new Error(`${teamKey} is in ${event.eventKey}'s corpus roster but not its index`);
      const best = startEvent.get(teamKey);
      if (best === undefined || entry.f < best.f || (entry.f === best.f && event.eventKey < best.eventKey)) startEvent.set(teamKey, { eventKey: event.eventKey, f: entry.f });
    }
  }
  const resolved = new Map<string, ResolvedTeam>();
  for (const [teamKey, start] of startEvent) resolved.set(teamKey, resolveTeamStateAt(teamKey, cut, start.eventKey, source));
  const league = leagueAt(cut, source);
  const lookupMs = performance.now() - t0;

  let hops = 0;
  let hopsLeavingDistrict = 0;
  const kinds: Record<string, number> = { x: 0, s: 0, log: 0, unseen: 0 };
  for (const r of resolved.values()) {
    kinds[r.trace.kind]! += 1;
    hops += r.trace.hops.length;
    hopsLeavingDistrict += r.trace.hops.filter((eventKey) => !fimKeys.has(eventKey)).length;
  }
  const indexReads = [...source.indexReads];
  const logReads = [...source.logReads];
  const outsideIndexReads = indexReads.filter((k) => !fimKeys.has(k));
  const outsideLogReads = logReads.filter((k) => !fimKeys.has(k));

  // --- the oracle ---
  const o0 = performance.now();
  const oracle = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: WARMUP, asOf: spec.asOf, algorithm });
  if (oracle === null) throw new Error(`cut ${spec.id}: the oracle returned null at ${spec.asOf}`);
  const oracleSeconds = (performance.now() - o0) / 1000;

  const ratings = new Tally();
  const predictions = new Tally();
  let teamsChecked = 0;
  let matchesChecked = 0;
  const refused: { eventKey: string; oracleRefused: boolean; rebuiltRefused: boolean; oracleWithout: string[]; rebuiltWithout: string[] }[] = [];
  const perEvent: { eventKey: string; tier: string; roster: number; quals: number }[] = [];
  const vars = source.getIndex(checked[0]!.eventKey).vars;

  for (const event of checked) {
    const teams = new Map<string, TeamTuple>();
    for (const teamKey of event.roster) teams.set(teamKey, resolved.get(teamKey)!.tuple);
    const pricer = buildAsOfPricer({ season: SEASON, vars, league, teams });

    const mine = pricer.ratingsFor(event.roster);
    const theirs = oracle.ratingsFor(event.roster);
    for (const teamKey of event.roster) {
      teamsChecked += 1;
      ratings.check(`${event.eventKey} ${teamKey} total`, mine.get(teamKey)?.total, theirs.get(teamKey)?.total);
      ratings.check(`${event.eventKey} ${teamKey} sigma`, mine.get(teamKey)?.sigma, theirs.get(teamKey)?.sigma);
    }

    const minePredict = pricer.predictFor(event.roster);
    const theirPredict = oracle.predictFor(event.roster);
    if (minePredict === undefined || theirPredict === undefined) {
      refused.push({
        eventKey: event.eventKey,
        oracleRefused: theirPredict === undefined,
        rebuiltRefused: minePredict === undefined,
        oracleWithout: oracle.teamsWithoutSigmaFor(event.roster),
        rebuiltWithout: pricer.teamsWithoutSigmaFor(event.roster),
      });
      if ((minePredict === undefined) !== (theirPredict === undefined)) {
        predictions.mismatches += 1;
        predictions.examples.push(`${event.eventKey}: roster refusal disagrees`);
      }
      perEvent.push({ eventKey: event.eventKey, tier: event.tier, roster: event.roster.length, quals: 0 });
      continue;
    }
    let quals = 0;
    for (let i = 0; i < event.matches.length; i++) {
      const match = event.matches[i]!;
      if (match.compLevel !== "qm" || !rowAfterCut(event, i, cut)) continue;
      const upcoming = toUpcoming(match);
      const a: Prediction = minePredict(upcoming);
      const b: Prediction = theirPredict(upcoming);
      quals += 1;
      predictions.check(`${match.matchKey} pRedWin`, a.pRedWin, b.pRedWin);
      predictions.check(`${match.matchKey} redScore`, a.redScore, b.redScore);
      predictions.check(`${match.matchKey} blueScore`, a.blueScore, b.blueScore);
      predictions.checkArray(`${match.matchKey} redRpPmf`, a.redRpPmf, b.redRpPmf);
      predictions.checkArray(`${match.matchKey} blueRpPmf`, a.blueRpPmf, b.blueRpPmf);
    }
    matchesChecked += quals;
    perEvent.push({ eventKey: event.eventKey, tier: event.tier, roster: event.roster.length, quals });
  }

  const frc27 = resolved.get("frc27");
  const result = {
    cut: spec.id,
    label: spec.label,
    note: spec.note,
    cutPosition: isSeasonStartCut(cut) ? "season start" : cut,
    oracleAsOf: spec.asOf,
    oracleMatchesReplayed: oracle.matchesReplayed,
    oracleMatchesTruncated: oracle.matchesTruncated,
    oracleSeconds: Number(oracleSeconds.toFixed(1)),
    eventsChecked: checked.length,
    eventsInProgress: inProgress,
    teamsChecked,
    uniqueTeams: resolved.size,
    matchesChecked,
    ratingComparisons: ratings.compared,
    ratingMismatches: ratings.mismatches,
    ratingMaxAbsDiff: ratings.maxAbsDiff,
    predictionComparisons: predictions.compared,
    predictionMismatches: predictions.mismatches,
    predictionMaxAbsDiff: predictions.maxAbsDiff,
    mismatchExamples: [...ratings.examples, ...predictions.examples],
    refusedRosters: refused,
    lookup: {
      ms: Number(lookupMs.toFixed(1)),
      indexFilesRead: indexReads.length,
      indexFilesReadOutsideDistrict: outsideIndexReads,
      logFilesRead: logReads,
      logFilesReadOutsideDistrict: outsideLogReads,
      hops,
      hopsLeavingDistrict,
      resolvedBy: kinds,
    },
    frc27: frc27 === undefined ? null : frc27.trace,
    perEvent,
  };
  writeFileSync(join(ROOT, `oracle-${spec.id}.json`), JSON.stringify(result, null, 1));
  const { perEvent: _perEvent, ...short } = result;
  console.log(`oracleCheck: ${JSON.stringify(short, null, 1)}`);
}

function strictDeepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => strictDeepEqual(v, b[i]));
  return a === b;
}

/** Cut (b): every tuple the lookup returns from the FULL capture against a capture of the stream truncated at the cut. */
function runTruncation(events: FimEvent[], spec: CutSpec): void {
  const full = new FileSource(join(ROOT, String(SEASON)));
  const trunc = new FileSource(join(ROOT, "trunc", String(SEASON)));
  const cut = spec.cut;
  let compared = 0;
  let mismatched = 0;
  let mismatchedDemo = 0;
  let hops = 0;
  const examples: string[] = [];
  const kinds: Record<string, number> = { x: 0, s: 0, log: 0, unseen: 0 };
  // Every team the truncated season holds: all it has seen at or before the cut, worldwide.
  for (const teamKey of Object.keys(trunc.tails)) {
    const fromFull = resolveTeamStateAt(teamKey, cut, undefined, full);
    const fromTrunc = resolveTeamStateAt(teamKey, cut, undefined, trunc);
    compared += 1;
    kinds[fromFull.trace.kind]! += 1;
    hops += fromFull.trace.hops.length;
    if (!strictDeepEqual(fromFull.tuple, fromTrunc.tuple)) {
      mismatched += 1;
      if (isDemoTeamKey(teamKey)) mismatchedDemo += 1;
      if (examples.length < 12) examples.push(`${teamKey}: full ${JSON.stringify(fromFull.trace)} trunc ${JSON.stringify(fromTrunc.trace)}`);
    }
  }
  // The fim roster teams with no row at or before the cut have no entry in the truncated files at all; the oracle check covers them.
  const fimTeams = new Set(events.flatMap((e) => e.roster));
  const fimCovered = [...fimTeams].filter((teamKey) => trunc.tails[teamKey] !== undefined).length;
  const leagueFull = leagueAt(cut, full);
  const leagueTrunc = trunc.getIndex(cut.eventKey).le.L;
  const result = {
    cut: spec.label,
    teamsCompared: compared,
    fimTeamsAmongThem: fimCovered,
    teamTupleMismatches: mismatched,
    mismatchesThatAreDemoRobots: mismatchedDemo,
    mismatchExamples: examples,
    leagueTupleIdentical: strictDeepEqual(leagueFull, leagueTrunc),
    fullLookup: { resolvedBy: kinds, hops, indexFilesRead: full.indexReads.size, logFilesRead: full.logReads.size },
  };
  writeFileSync(join(ROOT, "truncation-b.json"), JSON.stringify(result, null, 1));
  console.log(`oracleCheck: truncation ${JSON.stringify(result, null, 1)}`);
}

function main(): void {
  const { values } = parseArgs({ options: { cut: { type: "string" }, trunc: { type: "boolean" }, "print-cuts": { type: "boolean" } } });
  const db = openCorpusReadOnly(CORPUS);
  try {
    const events = loadFimEvents(db);
    const specs = cutSpecs(db, events);
    if (values["print-cuts"] === true) {
      console.log(JSON.stringify({ specs, events: events.map((e) => ({ k: e.eventKey, tier: e.tier, week: e.week, matches: e.matches.length, roster: e.roster.length })) }, null, 1));
      return;
    }
    if (values.trunc === true) return runTruncation(events, specs.b);
    const id = values.cut;
    if (id !== "a" && id !== "b" && id !== "c") throw new Error("--cut must be a, b or c (or pass --trunc)");
    runCut(db, events, specs[id]);
  } finally {
    db.close();
  }
}

if (process.argv[1] !== undefined && /oracleCheck\.ts$/.test(process.argv[1])) main();
