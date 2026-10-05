/**
 * `pnpm live:report <eventKey>`: what the live tick saw for one event and how
 * late the site was (quick task 261004-uyc). It reads the rows the Worker's
 * ingest log wrote to D1 (`apps/worker/migrations/0003_ingest_log.sql`), either
 * straight out of D1 through wrangler or from a JSON file (`--from-json`), and
 * prints the timeline and the latency of every folded match.
 *
 * THE D1 READ IS A `--command` CALL AND PASSES NO ENV FILE FLAG. Per project
 * memory a `--command` call fails with the `.env` token and works on the logged
 * in wrangler session, so this script never hands wrangler `.env` and never reads
 * it either.
 *
 * `buildLiveReport` and `formatLiveReport` are pure: the same rows always give
 * the same report, which is what the tests pin.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { EVENT_KEY_PATTERN } from "../packages/core/districts/keys.js";
import type { IngestLogKind, IngestLogRow } from "../apps/worker/src/ingestLog.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const D1_DATABASE = "sigmascout-state";

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

const KINDS: readonly IngestLogKind[] = ["endpoint", "match", "phase", "failure"];

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One D1 result row (snake_case) or one report row (camelCase), as an `IngestLogRow`. `undefined` for anything that is not a row. */
function normalizeRow(raw: unknown): IngestLogRow | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const pick = (snake: string, camel: string): unknown => (r[snake] !== undefined ? r[snake] : r[camel]);
  const kind = pick("kind", "kind");
  const eventKey = pick("event_key", "eventKey");
  const subject = pick("subject", "subject");
  const observedAt = pick("observed_at", "observedAt");
  if (typeof kind !== "string" || !KINDS.includes(kind as IngestLogKind)) return undefined;
  if (typeof eventKey !== "string" || typeof subject !== "string" || typeof observedAt !== "string") return undefined;
  return {
    eventKey,
    tickAt: textOrNull(pick("tick_at", "tickAt")) ?? observedAt,
    kind: kind as IngestLogKind,
    subject,
    phase: textOrNull(pick("phase", "phase")),
    tbaLastModified: textOrNull(pick("tba_last_modified", "tbaLastModified")),
    tbaActualTime: numberOrNull(pick("tba_actual_time", "tbaActualTime")),
    tbaPostResultTime: numberOrNull(pick("tba_post_result_time", "tbaPostResultTime")),
    observedAt,
    foldedAt: textOrNull(pick("folded_at", "foldedAt")),
    publishedAt: textOrNull(pick("published_at", "publishedAt")),
    detail: textOrNull(pick("detail", "detail")),
  };
}

/**
 * Wrangler's `--json` stdout: a JSON array of result objects, possibly after
 * banner text. Slices from the first `[`, parses, and returns the first
 * element's `results` as rows. A file of bare rows (an array whose first element
 * is itself a row) is accepted too, so `--from-json` takes either.
 */
export function parseWranglerRows(stdout: string): IngestLogRow[] {
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error("no JSON array in the wrangler output");
  const parsed: unknown = JSON.parse(stdout.slice(start));
  if (!Array.isArray(parsed)) throw new Error("the wrangler output is not a JSON array");
  const first: unknown = parsed[0];
  const results: unknown[] =
    typeof first === "object" && first !== null && Array.isArray((first as { results?: unknown }).results) ? ((first as { results: unknown[] }).results) : parsed;
  return results.map(normalizeRow).filter((row): row is IngestLogRow => row !== undefined);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** One timeline line: a row, in the order the log recorded it. */
export interface TimelineEntry {
  readonly at: string;
  readonly kind: IngestLogKind;
  readonly subject: string;
  readonly phase: string | null;
}

/** The four intervals of one folded match, in seconds. Each is null when an input is null. */
export interface MatchLatency {
  readonly matchKey: string;
  readonly postToSeenSeconds: number | null;
  readonly seenToFoldedSeconds: number | null;
  readonly foldedToPublishedSeconds: number | null;
  readonly postToPublishedSeconds: number | null;
}

export interface LiveReport {
  readonly timeline: readonly TimelineEntry[];
  readonly matches: readonly MatchLatency[];
}

function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function secondsBetween(fromMs: number | null, toMs: number | null): number | null {
  return fromMs === null || toMs === null ? null : Math.round((toMs - fromMs) / 1000);
}

export function buildLiveReport(rows: readonly IngestLogRow[]): LiveReport {
  const timeline: TimelineEntry[] = rows.map((row) => ({ at: row.observedAt, kind: row.kind, subject: row.subject, phase: row.phase }));
  const matches: MatchLatency[] = rows
    .filter((row) => row.kind === "match")
    .map((row) => {
      const postMs = row.tbaPostResultTime === null ? null : row.tbaPostResultTime * 1000;
      const seenMs = ms(row.observedAt);
      const foldedMs = ms(row.foldedAt);
      const publishedMs = ms(row.publishedAt);
      return {
        matchKey: row.subject,
        postToSeenSeconds: secondsBetween(postMs, seenMs),
        seenToFoldedSeconds: secondsBetween(seenMs, foldedMs),
        foldedToPublishedSeconds: secondsBetween(foldedMs, publishedMs),
        postToPublishedSeconds: secondsBetween(postMs, publishedMs),
      };
    });
  return { timeline, matches };
}

function hms(iso: string): string {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? iso : new Date(value).toISOString().slice(11, 19);
}

function cell(value: number | null): string {
  return (value === null ? "-" : String(value)).padStart(8);
}

export function formatLiveReport(report: LiveReport): string {
  if (report.timeline.length === 0) return "No ingest log rows exist for that event.";
  const lines: string[] = ["Timeline (UTC)"];
  for (const entry of report.timeline) lines.push(`  ${hms(entry.at)}  ${entry.kind.padEnd(8)}  ${entry.subject}${entry.phase === null ? "" : `  [${entry.phase}]`}`);
  lines.push("", "Matches (seconds)", `  ${"match".padEnd(22)}${"post>seen".padStart(10)}${"seen>fold".padStart(10)}${"fold>pub".padStart(10)}${"post>pub".padStart(10)}`);
  for (const m of report.matches) lines.push(`  ${m.matchKey.padEnd(22)}${cell(m.postToSeenSeconds).padStart(10)}${cell(m.seenToFoldedSeconds).padStart(10)}${cell(m.foldedToPublishedSeconds).padStart(10)}${cell(m.postToPublishedSeconds).padStart(10)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/** The SELECT for one event. `eventKey` is checked against `EVENT_KEY_PATTERN` BEFORE it reaches the SQL text. */
export function buildSelectCommand(eventKey: string): string {
  if (!EVENT_KEY_PATTERN.test(eventKey)) throw new Error(`"${eventKey}" is not an event key`);
  const sql = `SELECT event_key, tick_at, kind, subject, phase, tba_last_modified, tba_actual_time, tba_post_result_time, observed_at, folded_at, published_at, detail FROM ingest_log WHERE event_key = '${eventKey}' ORDER BY id`;
  return `npx wrangler d1 execute ${D1_DATABASE} --remote --json --command "${sql}"`;
}

const USAGE = "usage: pnpm live:report <eventKey> [--from-json <path>]";

/** The effects the CLI needs, injected so a test never touches wrangler or the filesystem. */
export interface CliIo {
  exec(command: string, cwd: string): { status: number | null; stdout: string };
  readFile(path: string): string;
  log(line: string): void;
  error(line: string): void;
}

/** Runs the CLI against `argv` (without node and the script) and returns the exit code. */
export function runCli(argv: readonly string[], io: CliIo): number {
  let values: { "from-json"?: string | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: [...argv], options: { "from-json": { type: "string" } }, allowPositionals: true }));
  } catch {
    io.error(USAGE);
    return 1;
  }
  const eventKey = positionals[0];
  if (eventKey === undefined || positionals.length !== 1) {
    io.error(USAGE);
    return 1;
  }
  if (!EVENT_KEY_PATTERN.test(eventKey)) {
    io.error(`"${eventKey}" is not an event key`);
    return 1;
  }

  let rows: IngestLogRow[];
  try {
    if (values["from-json"] !== undefined) {
      rows = parseWranglerRows(io.readFile(values["from-json"])).filter((row) => row.eventKey === eventKey);
    } else {
      const result = io.exec(buildSelectCommand(eventKey), resolve(REPO_ROOT, "apps/worker"));
      if (result.status !== 0) {
        io.error("wrangler could not read the ingest log (is the wrangler session logged in, and has migration 0003 been applied?)");
        return 1;
      }
      rows = parseWranglerRows(result.stdout);
    }
  } catch (error) {
    io.error(`could not read ingest log rows: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  io.log(formatLiveReport(buildLiveReport(rows)));
  return 0;
}

const nodeIo: CliIo = {
  exec(command, cwd) {
    const result = spawnSync(command, { cwd, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: result.status, stdout: result.stdout ?? "" };
  },
  readFile: (path) => readFileSync(path, "utf8"),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

// Only auto-run as the entry point, so tests can import the helpers.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exit(runCli(process.argv.slice(2), nodeIo));
