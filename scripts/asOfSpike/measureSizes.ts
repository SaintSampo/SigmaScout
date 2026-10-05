/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). Sizes of the captured
 * objects under `reports/asof-spike/<season>/`: raw UTF-8, gzip level 9 and
 * brotli quality 11, at full precision and at 12 and 9 significant digits,
 * plus the two layout variants (INDEX with `s` only when `p` is null, LOG
 * split into four carry-in chunks). Reads and writes local files only.
 *
 *   npx tsx scripts/asOfSpike/measureSizes.ts --season 2026     one season -> reports/asof-spike/sizes-2026.json
 *   npx tsx scripts/asOfSpike/measureSizes.ts --summarize       every sizes-*.json -> reports/asof-spike/sizes-summary.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync, constants as zlib } from "node:zlib";
import { isDemoTeamKey } from "../../packages/core/algorithms/demoTeams.js";
import { openCorpusReadOnly } from "../../packages/corpus/db.js";
import type { EventIndex, EventLog, TeamTuple } from "./format.js";

const ROOT = "reports/asof-spike";
const CORPUS = "C:/Users/Jacob/Documents/GitHub/SigmaScout/data/corpus.sqlite";
const SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

interface Sz {
  raw: number;
  gz: number;
  br: number;
}

function sz(text: string): Sz {
  const buf = Buffer.from(text, "utf8");
  return {
    raw: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf, {
      params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT, [zlib.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }).length,
  };
}

const add = (a: Sz, b: Sz): Sz => ({ raw: a.raw + b.raw, gz: a.gz + b.gz, br: a.br + b.br });
const ZERO: Sz = { raw: 0, gz: 0, br: 0 };

/** Every non-integer number rounded to `digits` significant digits; integers, strings and structure untouched. */
function reduce(value: unknown, digits: number): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Number(value.toPrecision(digits));
  if (Array.isArray(value)) return value.map((v) => reduce(v, digits));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reduce(v, digits);
    return out;
  }
  return value;
}

function quantiles(values: number[]): { median: number; p95: number; max: number } {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return { median: 0, p95: 0, max: 0 };
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]!;
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1]! };
}

function dist(list: Sz[]): Record<keyof Sz, { median: number; p95: number; max: number }> {
  return { raw: quantiles(list.map((x) => x.raw)), gz: quantiles(list.map((x) => x.gz)), br: quantiles(list.map((x) => x.br)) };
}

interface EventSizes {
  eventKey: string;
  rows: number;
  teams: number;
  index: Sz;
  /** INDEX with `s` kept only where `p` is null (the original brief's layout). */
  indexSeasonStartOnly: Sz;
  log: Sz;
  index12: Sz;
  log12: Sz;
  index9: Sz;
  log9: Sz;
  /** The LOG as four row-count chunks, each led by a carry-in block of every event team's latest tuple. */
  chunks?: Sz[];
}

function chunked(index: EventIndex, log: EventLog): string[] {
  const n = log.rows.length;
  const out: string[] = [];
  const latest = new Map<string, TeamTuple>();
  for (const [teamKey, entry] of Object.entries(index.teams)) latest.set(teamKey, entry.s);
  for (let c = 0; c < 4; c++) {
    const from = Math.floor((c * n) / 4);
    const to = Math.floor(((c + 1) * n) / 4);
    const carry: Record<string, TeamTuple> = {};
    for (const [teamKey, tuple] of latest) carry[teamKey] = tuple;
    const rows = log.rows.slice(from, to);
    out.push(JSON.stringify({ v: 1, eventKey: log.eventKey, season: log.season, algorithmId: log.algorithmId, algorithmVersion: log.algorithmVersion, vars: log.vars, c, from, carry, rows }));
    for (const row of rows) for (const [teamKey, tuple] of row.tm) latest.set(teamKey, tuple);
  }
  return out;
}

function measureSeason(season: number, chunkEvents: ReadonlySet<string>): void {
  const dir = join(ROOT, String(season));
  const eventKeys = readdirSync(join(dir, "index")).map((f) => f.replace(/\.json$/, "")).sort();
  const events: EventSizes[] = [];
  /** Per team: its events' [first row ordinal, last row ordinal] in a season-wide order, for the interleave census. */
  const spans = new Map<string, { eventKey: string; f: number; l: number }[]>();

  for (const eventKey of eventKeys) {
    const indexText = readFileSync(join(dir, "index", `${eventKey}.json`), "utf8");
    const logText = readFileSync(join(dir, "log", `${eventKey}.json`), "utf8");
    const index = JSON.parse(indexText) as EventIndex;
    const log = JSON.parse(logText) as EventLog;

    const startOnly = { ...index, teams: Object.fromEntries(Object.entries(index.teams).map(([k, e]) => [k, e.p === null ? e : { f: e.f, l: e.l, p: e.p, x: e.x }])) };
    const entry: EventSizes = {
      eventKey,
      rows: log.rows.length,
      teams: Object.keys(index.teams).length,
      index: sz(indexText),
      indexSeasonStartOnly: sz(JSON.stringify(startOnly)),
      log: sz(logText),
      index12: sz(JSON.stringify(reduce(index, 12))),
      log12: sz(JSON.stringify(reduce(log, 12))),
      index9: sz(JSON.stringify(reduce(index, 9))),
      log9: sz(JSON.stringify(reduce(log, 9))),
    };
    if (chunkEvents.has(eventKey)) entry.chunks = chunked(index, log).map(sz);
    events.push(entry);

    for (const [teamKey, e] of Object.entries(index.teams)) {
      let list = spans.get(teamKey);
      if (list === undefined) spans.set(teamKey, (list = []));
      list.push({ eventKey, f: e.f, l: e.l });
    }
  }

  // Interleave census on sort_time intervals: a team whose [f, l] at one event strictly contains or overlaps its [f, l] at another.
  let overlappingPairsReal = 0;
  let overlappingPairsDemo = 0;
  const realExamples: string[] = [];
  for (const [teamKey, list] of spans) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a]!;
        const B = list[b]!;
        if (A.f <= B.l && B.f <= A.l) {
          if (isDemoTeamKey(teamKey)) overlappingPairsDemo += 1;
          else {
            overlappingPairsReal += 1;
            if (realExamples.length < 400) realExamples.push(`${teamKey}:${A.eventKey}/${B.eventKey}`);
          }
        }
      }
    }
  }

  const tails = sz(readFileSync(join(dir, "tails.json"), "utf8"));
  const start = sz(readFileSync(join(dir, "start.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(
    join(ROOT, `sizes-${season}.json`),
    JSON.stringify({ season, meta, tails, start, overlappingPairsReal, overlappingPairsDemo, realExamples, events })
  );
  console.log(`sizes: ${season} ${events.length} events done`);
}

interface SeasonFile {
  season: number;
  meta: { rows: number; events: number; nonFoldingRows: number; fullyDemoRows: number; teams: number; interleavedReturns: number };
  tails: Sz;
  start: Sz;
  overlappingPairsReal: number;
  overlappingPairsDemo: number;
  realExamples: string[];
  events: EventSizes[];
}

function summarize(): void {
  const db = openCorpusReadOnly(CORPUS);
  const fim = db.prepare(`SELECT event_key AS k, event_type AS ty FROM events WHERE year = 2026 AND district_key = 'fim'`).all() as { k: string; ty: number }[];
  db.close();
  const fimDistrict = new Set(fim.filter((e) => e.ty === 1).map((e) => e.k));
  const fimDcmp = new Set(fim.filter((e) => e.ty !== 1).map((e) => e.k));

  const perSeason: unknown[] = [];
  let grandRaw = 0;
  let grandObjects = 0;
  let grandGz = 0;
  let grandBr = 0;
  let out2026: Record<string, unknown> = {};
  for (const season of SEASONS) {
    const path = join(ROOT, `sizes-${season}.json`);
    if (!existsSync(path)) throw new Error(`summarize: ${path} missing`);
    const file = JSON.parse(readFileSync(path, "utf8")) as SeasonFile;
    const sum = (pick: (e: EventSizes) => Sz) => file.events.reduce((acc, e) => add(acc, pick(e)), ZERO);
    const totals = {
      index: sum((e) => e.index),
      indexSeasonStartOnly: sum((e) => e.indexSeasonStartOnly),
      log: sum((e) => e.log),
      index12: sum((e) => e.index12),
      log12: sum((e) => e.log12),
      index9: sum((e) => e.index9),
      log9: sum((e) => e.log9),
    };
    const objects = file.events.length * 2 + 2;
    const raw = totals.index.raw + totals.log.raw + file.tails.raw + file.start.raw;
    grandRaw += raw;
    grandObjects += objects;
    grandGz += totals.index.gz + totals.log.gz + file.tails.gz + file.start.gz;
    grandBr += totals.index.br + totals.log.br + file.tails.br + file.start.br;
    perSeason.push({
      season,
      events: file.events.length,
      rows: file.meta.rows,
      nonFoldingRows: file.meta.nonFoldingRows,
      fullyDemoRows: file.meta.fullyDemoRows,
      teams: file.meta.teams,
      interleavedReturns: file.meta.interleavedReturns,
      overlappingTeamEventPairsReal: file.overlappingPairsReal,
      overlappingTeamEventPairsDemo: file.overlappingPairsDemo,
      totals,
      perEvent: {
        index: dist(file.events.map((e) => e.index)),
        indexSeasonStartOnly: dist(file.events.map((e) => e.indexSeasonStartOnly)),
        log: dist(file.events.map((e) => e.log)),
        indexPlusLog: dist(file.events.map((e) => add(e.index, e.log))),
      },
      tails: file.tails,
      start: file.start,
      objects,
      rawBytes: raw,
    });

    if (season === 2026) {
      const pickSum = (set: ReadonlySet<string>, pick: (e: EventSizes) => Sz) => file.events.filter((e) => set.has(e.eventKey)).reduce((acc, e) => add(acc, pick(e)), ZERO);
      const variants = (set: ReadonlySet<string>) => ({
        events: file.events.filter((e) => set.has(e.eventKey)).length,
        index: pickSum(set, (e) => e.index),
        indexSeasonStartOnly: pickSum(set, (e) => e.indexSeasonStartOnly),
        log: pickSum(set, (e) => e.log),
        index12: pickSum(set, (e) => e.index12),
        log12: pickSum(set, (e) => e.log12),
        index9: pickSum(set, (e) => e.index9),
        log9: pickSum(set, (e) => e.log9),
      });
      const chunkList = file.events.filter((e) => fimDistrict.has(e.eventKey)).flatMap((e) => e.chunks ?? []);
      const miche = file.events.find((e) => e.eventKey === "2026miche")!;
      out2026 = {
        fimDistrict: variants(fimDistrict),
        fimDcmp: variants(fimDcmp),
        fimDistrictPerEvent: {
          index: dist(file.events.filter((e) => fimDistrict.has(e.eventKey)).map((e) => e.index)),
          log: dist(file.events.filter((e) => fimDistrict.has(e.eventKey)).map((e) => e.log)),
        },
        chunkedLogFimDistrict: { chunks: chunkList.length, perChunk: dist(chunkList) },
        miche: { index: miche.index, indexSeasonStartOnly: miche.indexSeasonStartOnly, log: miche.log, indexPlusLog: add(miche.index, miche.log), rows: miche.rows, teams: miche.teams },
        realOverlapExamples: file.realExamples,
      };
    }
  }
  const summary = { perSeason, grand: { rawBytes: grandRaw, gzipBytes: grandGz, brotliBytes: grandBr, objects: grandObjects }, y2026: out2026 };
  writeFileSync(join(ROOT, "sizes-summary.json"), JSON.stringify(summary, null, 1));
  console.log(`sizes: summary written, grand raw ${grandRaw} B over ${grandObjects} objects`);
}

function main(): void {
  const { values } = parseArgs({ options: { season: { type: "string" }, summarize: { type: "boolean" } } });
  if (values.summarize === true) return summarize();
  const season = Number(values.season);
  if (!SEASONS.includes(season)) throw new Error("--season must be a captured season, or pass --summarize");
  let chunkEvents = new Set<string>();
  if (season === 2026) {
    const db = openCorpusReadOnly(CORPUS);
    chunkEvents = new Set((db.prepare(`SELECT event_key AS k FROM events WHERE year = 2026 AND district_key = 'fim' AND event_type = 1`).all() as { k: string }[]).map((r) => r.k));
    db.close();
  }
  measureSeason(season, chunkEvents);
}

main();
