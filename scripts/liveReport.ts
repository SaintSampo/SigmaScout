/**
 * `pnpm live:report <eventKey>`: what the live tick saw for one event and how
 * late the site was (quick task 261004-uyc). It reads the rows the Worker's
 * ingest log wrote to D1 (`apps/worker/migrations/0003_ingest_log.sql`), either
 * straight out of D1 through wrangler or from a JSON file (`--from-json`), and
 * prints four sections: the timeline, the post to published delay (overall and
 * per phase), the gaps and the failures, plus the TBA endpoint lag and the time
 * spent in each phase.
 *
 * THE D1 CALLS ARE `--command` CALLS AND PASS NO ENV FILE FLAG. Per project
 * memory a `--command` call fails with the `.env` token and works on the logged
 * in wrangler session, so this script never hands wrangler `.env` and never reads
 * it either.
 *
 * `buildLiveReport` and `formatLiveReport` are pure: the same rows always give
 * the same report, which is what the tests pin. All arithmetic is on parsed epoch
 * milliseconds; a row whose time does not parse is skipped from the statistic it
 * would have fed and counted in `unparseable`.
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

/** Two consecutive `matches` observations further apart than this, while the event is in a phase that should be moving, are a gap. */
const OBSERVATION_GAP_SECONDS = 15 * 60;

/** The phases in which matches are being played, so a quiet log is suspicious. */
const ACTIVE_PHASES: ReadonlySet<string> = new Set(["quals-in-progress", "playoffs-in-progress"]);

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
    typeof first === "object" && first !== null && Array.isArray((first as { results?: unknown }).results) ? (first as { results: unknown[] }).results : parsed;
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

/** Count, median and worst of a set of seconds. The median of an even count is the mean of the two middle values. */
export interface LatencyStats {
  readonly count: number;
  readonly medianSeconds: number | null;
  readonly worstSeconds: number | null;
}

export interface PhaseLatency {
  readonly phase: string;
  readonly stats: LatencyStats;
}

export interface EndpointLag {
  readonly endpoint: string;
  /** How many changed bodies the log recorded for this endpoint. */
  readonly changes: number;
  /** Seconds between TBA's `Last-Modified` and our observed time, over the rows that carry a Last-Modified. */
  readonly lag: LatencyStats;
}

export interface ObservationGap {
  readonly fromAt: string;
  readonly toAt: string;
  readonly seconds: number;
  /** The phase of the earlier observation: the phase the quiet stretch began in. */
  readonly phase: string;
}

export interface FailureEntry {
  readonly at: string;
  readonly stage: string;
  readonly message: string;
}

export interface PhaseSpan {
  readonly phase: string;
  readonly enteredAt: string;
  /** Seconds until the next phase row; for the last phase, until the final row in the log. */
  readonly seconds: number | null;
}

export interface LiveReport {
  readonly timeline: readonly TimelineEntry[];
  readonly matches: readonly MatchLatency[];
  readonly summary: {
    /** Post to published, over matches that carry TBA's `post_result_time` and a published time. */
    readonly overall: LatencyStats;
    readonly byPhase: readonly PhaseLatency[];
    /** Matches TBA gave no `post_result_time` for. They NEVER enter the post to published figures above. */
    readonly noPostTime: {
      readonly count: number;
      /** `actual_time` to published instead, clearly a different measure: when the match was played, not when TBA posted the result. */
      readonly playedToPublished: LatencyStats;
    };
    /** Rows whose times did not parse and were skipped from a statistic. */
    readonly unparseable: number;
  };
  readonly endpoints: readonly EndpointLag[];
  readonly gaps: {
    /** Match rows that were folded but never stamped published. */
    readonly foldedButUnpublished: readonly string[];
    /** Matches TBA showed played on the last `matches` observation that no match row ever recorded as folded. */
    readonly neverFolded: number;
    readonly observationGaps: readonly ObservationGap[];
  };
  readonly failures: readonly FailureEntry[];
  readonly phases: readonly PhaseSpan[];
}

function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function secondsBetween(fromMs: number | null, toMs: number | null): number | null {
  return fromMs === null || toMs === null ? null : Math.round((toMs - fromMs) / 1000);
}

export function latencyStats(values: readonly number[]): LatencyStats {
  if (values.length === 0) return { count: 0, medianSeconds: null, worstSeconds: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { count: sorted.length, medianSeconds: median, worstSeconds: sorted[sorted.length - 1]! };
}

/** The `played` count a `matches` endpoint row's detail carries, or null when absent or unreadable. */
function playedCountOf(detail: string | null): number | null {
  if (detail === null) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed === "object" && parsed !== null) return numberOrNull((parsed as Record<string, unknown>).played);
  } catch {
    // an unreadable detail simply carries no count
  }
  return null;
}

export function buildLiveReport(rows: readonly IngestLogRow[]): LiveReport {
  // A time that is present but does not parse is counted once here, then treated
  // as absent by every statistic it would have fed.
  let unparseable = 0;
  for (const row of rows) {
    for (const value of [row.observedAt, row.foldedAt, row.publishedAt, row.tbaLastModified]) {
      if (value !== null && ms(value) === null) unparseable++;
    }
  }
  const timeMs = ms;

  const timeline: TimelineEntry[] = rows.map((row) => ({ at: row.observedAt, kind: row.kind, subject: row.subject, phase: row.phase }));

  const matchRows = rows.filter((row) => row.kind === "match");
  const matches: MatchLatency[] = [];
  const overallValues: number[] = [];
  const byPhaseValues = new Map<string, number[]>();
  const playedToPublishedValues: number[] = [];
  let noPostCount = 0;
  const foldedButUnpublished: string[] = [];

  for (const row of matchRows) {
    const postMs = row.tbaPostResultTime === null ? null : row.tbaPostResultTime * 1000;
    const seenMs = timeMs(row.observedAt);
    const foldedMs = timeMs(row.foldedAt);
    const publishedMs = timeMs(row.publishedAt);
    matches.push({
      matchKey: row.subject,
      postToSeenSeconds: secondsBetween(postMs, seenMs),
      seenToFoldedSeconds: secondsBetween(seenMs, foldedMs),
      foldedToPublishedSeconds: secondsBetween(foldedMs, publishedMs),
      postToPublishedSeconds: secondsBetween(postMs, publishedMs),
    });

    if (row.publishedAt === null) foldedButUnpublished.push(row.subject);

    if (postMs === null) {
      noPostCount++;
      const playedToPublished = secondsBetween(row.tbaActualTime === null ? null : row.tbaActualTime * 1000, publishedMs);
      if (playedToPublished !== null) playedToPublishedValues.push(playedToPublished);
      continue;
    }
    const postToPublished = secondsBetween(postMs, publishedMs);
    if (postToPublished === null) continue;
    overallValues.push(postToPublished);
    const phase = row.phase ?? "unknown";
    byPhaseValues.set(phase, [...(byPhaseValues.get(phase) ?? []), postToPublished]);
  }

  const byPhase: PhaseLatency[] = [...byPhaseValues].map(([phase, values]) => ({ phase, stats: latencyStats(values) }));

  // Endpoint lag: Last-Modified to observed, per endpoint, in the order each endpoint first appears.
  const endpointRows = rows.filter((row) => row.kind === "endpoint");
  const endpointOrder: string[] = [];
  for (const row of endpointRows) if (!endpointOrder.includes(row.subject)) endpointOrder.push(row.subject);
  const endpoints: EndpointLag[] = endpointOrder.map((endpoint) => {
    const own = endpointRows.filter((row) => row.subject === endpoint);
    const lags: number[] = [];
    for (const row of own) {
      if (row.tbaLastModified === null) continue;
      const lag = secondsBetween(timeMs(row.tbaLastModified), timeMs(row.observedAt));
      if (lag !== null) lags.push(lag);
    }
    return { endpoint, changes: own.length, lag: latencyStats(lags) };
  });

  // Matches TBA showed played that no match row ever recorded.
  const matchesObservations = endpointRows.filter((row) => row.subject === "matches");
  const lastPlayed = matchesObservations.length === 0 ? null : playedCountOf(matchesObservations[matchesObservations.length - 1]!.detail);
  const distinctMatches = new Set(matchRows.map((row) => row.subject)).size;
  const neverFolded = lastPlayed === null ? 0 : Math.max(0, lastPlayed - distinctMatches);

  const observationGaps: ObservationGap[] = [];
  for (let i = 1; i < matchesObservations.length; i++) {
    const earlier = matchesObservations[i - 1]!;
    const later = matchesObservations[i]!;
    const seconds = secondsBetween(timeMs(earlier.observedAt), timeMs(later.observedAt));
    if (seconds !== null && seconds > OBSERVATION_GAP_SECONDS && earlier.phase !== null && ACTIVE_PHASES.has(earlier.phase)) {
      observationGaps.push({ fromAt: earlier.observedAt, toAt: later.observedAt, seconds, phase: earlier.phase });
    }
  }

  const failures: FailureEntry[] = rows.filter((row) => row.kind === "failure").map((row) => ({ at: row.observedAt, stage: row.subject, message: row.detail ?? "" }));

  const phaseRows = rows.filter((row) => row.kind === "phase");
  let lastObservedMs: number | null = null;
  for (const row of rows) {
    const value = ms(row.observedAt);
    if (value !== null && (lastObservedMs === null || value > lastObservedMs)) lastObservedMs = value;
  }
  const phases: PhaseSpan[] = phaseRows.map((row, i) => {
    const next = phaseRows[i + 1];
    const endMs = next === undefined ? lastObservedMs : timeMs(next.observedAt);
    return { phase: row.subject, enteredAt: row.observedAt, seconds: secondsBetween(timeMs(row.observedAt), endMs) };
  });

  return {
    timeline,
    matches,
    summary: {
      overall: latencyStats(overallValues),
      byPhase,
      noPostTime: { count: noPostCount, playedToPublished: latencyStats(playedToPublishedValues) },
      unparseable,
    },
    endpoints,
    gaps: { foldedButUnpublished, neverFolded, observationGaps },
    failures,
    phases,
  };
}

function hms(iso: string): string {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? iso : new Date(value).toISOString().slice(11, 19);
}

function whole(value: number | null): string {
  return value === null ? "-" : String(Math.round(value));
}

function statsText(stats: LatencyStats): string {
  return `n=${String(stats.count).padEnd(4)}median=${whole(stats.medianSeconds).padEnd(6)}worst=${whole(stats.worstSeconds)}`;
}

function cell(value: number | null): string {
  return whole(value).padStart(10);
}

export function formatLiveReport(report: LiveReport): string {
  if (report.timeline.length === 0) return "No ingest log rows exist for that event.";
  const lines: string[] = ["Timeline (UTC)"];
  for (const entry of report.timeline) lines.push(`  ${hms(entry.at)}  ${entry.kind.padEnd(8)}  ${entry.subject}${entry.phase === null ? "" : `  [${entry.phase}]`}`);

  lines.push("", "Matches (seconds)", `  ${"match".padEnd(22)}${"post>seen".padStart(10)}${"seen>fold".padStart(10)}${"fold>pub".padStart(10)}${"post>pub".padStart(10)}`);
  for (const m of report.matches) lines.push(`  ${m.matchKey.padEnd(22)}${cell(m.postToSeenSeconds)}${cell(m.seenToFoldedSeconds)}${cell(m.foldedToPublishedSeconds)}${cell(m.postToPublishedSeconds)}`);

  lines.push("", "Post to published (seconds)", `  ${"overall".padEnd(22)}${statsText(report.summary.overall)}`);
  for (const phase of report.summary.byPhase) lines.push(`  ${phase.phase.padEnd(22)}${statsText(phase.stats)}`);
  lines.push(`  ${"no TBA post time".padEnd(22)}n=${report.summary.noPostTime.count}   (played to published instead: ${statsText(report.summary.noPostTime.playedToPublished)})`);
  if (report.summary.unparseable > 0) lines.push(`  ${report.summary.unparseable} time value(s) did not parse and were skipped`);

  lines.push("", "TBA endpoints (Last-Modified to observed, seconds)");
  for (const endpoint of report.endpoints) lines.push(`  ${endpoint.endpoint.padEnd(22)}changes=${String(endpoint.changes).padEnd(5)}${statsText(endpoint.lag)}`);

  lines.push("", "Gaps");
  lines.push(`  folded but unpublished: ${report.gaps.foldedButUnpublished.length === 0 ? "none" : report.gaps.foldedButUnpublished.join(", ")}`);
  lines.push(`  played on TBA but never folded: ${report.gaps.neverFolded}`);
  if (report.gaps.observationGaps.length === 0) lines.push("  observation gaps over 15 minutes: none");
  for (const gap of report.gaps.observationGaps) lines.push(`  no matches observation for ${gap.seconds} s (${hms(gap.fromAt)} to ${hms(gap.toAt)}, ${gap.phase})`);

  lines.push("", "Failures");
  if (report.failures.length === 0) lines.push("  none");
  for (const failure of report.failures) lines.push(`  ${hms(failure.at)}  ${failure.stage.padEnd(16)}${failure.message}`);

  lines.push("", "Phases");
  for (const phase of report.phases) lines.push(`  ${hms(phase.enteredAt)}  ${phase.phase.padEnd(22)}${phase.seconds === null ? "-" : `${phase.seconds} s`}`);
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

/** True for a real calendar date written YYYY-MM-DD. The pattern alone would let 2026-13-45 through. */
function isStrictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The prune statement. `date` must be a strict YYYY-MM-DD BEFORE it reaches the SQL text. Observed times are ISO strings, so a date sorts before every time on that day. */
export function buildPruneCommand(date: string): string {
  if (!isStrictDate(date)) throw new Error(`"${date}" is not a YYYY-MM-DD date`);
  return `npx wrangler d1 execute ${D1_DATABASE} --remote --command "DELETE FROM ingest_log WHERE observed_at < '${date}'"`;
}

const USAGE = "usage: pnpm live:report <eventKey> [--from-json <path>] [--json]\n       pnpm live:report --prune-before <YYYY-MM-DD>";

/** The effects the CLI needs, injected so a test never touches wrangler or the filesystem. */
export interface CliIo {
  exec(command: string, cwd: string): { status: number | null; stdout: string };
  readFile(path: string): string;
  log(line: string): void;
  error(line: string): void;
}

/** Runs the CLI against `argv` (without node and the script) and returns the exit code. */
export function runCli(argv: readonly string[], io: CliIo): number {
  let values: { "from-json"?: string | undefined; json?: boolean | undefined; "prune-before"?: string | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: { "from-json": { type: "string" }, json: { type: "boolean" }, "prune-before": { type: "string" } },
      allowPositionals: true,
    }));
  } catch {
    io.error(USAGE);
    return 1;
  }
  const workerDir = resolve(REPO_ROOT, "apps/worker");

  if (values["prune-before"] !== undefined) {
    if (positionals.length > 0 || values["from-json"] !== undefined || values.json === true) {
      io.error(USAGE);
      return 1;
    }
    const date = values["prune-before"];
    if (!isStrictDate(date)) {
      io.error(`"${date}" is not a YYYY-MM-DD date`);
      return 1;
    }
    const result = io.exec(buildPruneCommand(date), workerDir);
    if (result.status !== 0) {
      io.error("wrangler could not prune the ingest log (is the wrangler session logged in?)");
      return 1;
    }
    io.log(`Pruned ingest log rows observed before ${date}.`);
    return 0;
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
      const result = io.exec(buildSelectCommand(eventKey), workerDir);
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

  const report = buildLiveReport(rows);
  io.log(values.json === true ? JSON.stringify(report, null, 2) : formatLiveReport(report));
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
