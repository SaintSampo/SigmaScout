/**
 * The tick's ingest log (quick task 261004-uyc): an in memory buffer the tick
 * fills as it goes and ONE statement that writes it to D1 at the end.
 *
 * WHY A BUFFER AND ONE STATEMENT. A tick that saw nothing new (every poll a 304)
 * must cost nothing, so there is no row and no call. A tick that saw something
 * pays one subrequest for the whole flush, however many rows it carries, and the
 * statement is `.run()` rather than `db.batch`, so it never moves a batch pin.
 * D1 allows 100 bound parameters per statement and a row has twelve columns, so
 * the insert binds ONE JSON string and expands it with `json_each`.
 *
 * WHY THE FLUSH NEVER THROWS. The log is an instrument, not part of the fold. A
 * missing table, a full database or a network blip costs this log and nothing
 * else: the warn line says so once, and the tick's result is what it would have
 * been without the log.
 *
 * WHAT NEVER GOES IN A ROW. Ids, counts, times and a message cut to
 * `ERROR_MESSAGE_MAX` characters. The buffer's API has no parameter that accepts
 * a header, an artifact body, a TBA key or an environment value, so there is
 * nothing here to leak by accident.
 *
 * Worker safe: no zod at runtime, no Node built in.
 */
import type { D1Database } from "@cloudflare/workers-types";
import type { LivePhaseFacts } from "./eventPhase.js";

/** Rows older than this are pruned when an event completes. */
export const INGEST_LOG_RETENTION_DAYS = 60;

/** The longest error message a failure row (or the flush warning) carries. */
export const INGEST_LOG_ERROR_MESSAGE_MAX = 300;

export type IngestLogKind = "endpoint" | "match" | "phase" | "failure";

/** The camelCase mirror of `ingest_log`'s columns (`apps/worker/migrations/0003_ingest_log.sql`), minus the autoincrement id. */
export interface IngestLogRow {
  readonly eventKey: string;
  readonly tickAt: string;
  readonly kind: IngestLogKind;
  readonly subject: string;
  readonly phase: string | null;
  readonly tbaLastModified: string | null;
  readonly tbaActualTime: number | null;
  readonly tbaPostResultTime: number | null;
  readonly observedAt: string;
  readonly foldedAt: string | null;
  readonly publishedAt: string | null;
  readonly detail: string | null;
}

/** One match's arrival times as TBA states them, read off the unparsed match list. */
export interface MatchArrivalFacts {
  readonly matchKey: string;
  readonly actualTime: number | null;
  readonly postResultTime: number | null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `actual_time` and `post_result_time` for the named matches, read off the
 * UNPARSED TBA array with typeof guards. `post_result_time` is not in the shared
 * ingest schema (zod strips undeclared keys) and that schema is deliberately not
 * widened for a log, so this reads the raw objects. Anything missing or non
 * numeric becomes null; a malformed element is skipped, never thrown on.
 */
export function matchArrivalFacts(rawMatches: readonly unknown[], matchKeys: ReadonlySet<string>): MatchArrivalFacts[] {
  const facts: MatchArrivalFacts[] = [];
  for (const raw of rawMatches) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const key = record.key;
    if (typeof key !== "string" || !matchKeys.has(key)) continue;
    facts.push({ matchKey: key, actualTime: finiteNumberOrNull(record.actual_time), postResultTime: finiteNumberOrNull(record.post_result_time) });
  }
  return facts;
}

/** An Error becomes its message, anything else its string form, cut to the log's message limit. */
function truncatedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, INGEST_LOG_ERROR_MESSAGE_MAX);
}

/** The accepted shapes of a row's `detail`: a plain object (serialised), a string, or an Error (its message). */
export type IngestLogDetail = Readonly<Record<string, unknown>> | Error | string;

function serializeDetail(detail: IngestLogDetail | undefined): string | null {
  if (detail === undefined) return null;
  if (detail instanceof Error) return truncatedMessage(detail);
  if (typeof detail === "string") return detail.slice(0, INGEST_LOG_ERROR_MESSAGE_MAX);
  return JSON.stringify(detail);
}

type MutableRow = { -readonly [K in keyof IngestLogRow]: IngestLogRow[K] };

export class IngestLogBuffer {
  readonly #tickAt: string;
  readonly #clock: () => number;
  readonly #rows: MutableRow[] = [];
  readonly #phaseByEvent = new Map<string, string>();

  constructor(tickAt: string, clock: () => number = Date.now) {
    this.#tickAt = tickAt;
    this.#clock = clock;
  }

  #nowIso(): string {
    return new Date(this.#clock()).toISOString();
  }

  /** TBA answered `endpoint` with a changed body. `lastModified` is TBA's own header when it sent one. */
  endpointChanged(eventKey: string, endpoint: string, facts: { readonly lastModified?: string | undefined; readonly detail?: IngestLogDetail } = {}): void {
    this.#rows.push({
      eventKey,
      tickAt: this.#tickAt,
      kind: "endpoint",
      subject: endpoint,
      phase: null,
      tbaLastModified: facts.lastModified ?? null,
      tbaActualTime: null,
      tbaPostResultTime: null,
      observedAt: this.#nowIso(),
      foldedAt: null,
      publishedAt: null,
      detail: serializeDetail(facts.detail),
    });
  }

  /** Newly folded matches: one row each, observed when this tick's `matches` endpoint row was, folded now. */
  matchesFolded(eventKey: string, facts: readonly MatchArrivalFacts[]): void {
    const endpointRow = this.#rows.find((row) => row.eventKey === eventKey && row.kind === "endpoint" && row.subject === "matches");
    const foldedAt = this.#nowIso();
    const observedAt = endpointRow?.observedAt ?? foldedAt;
    for (const fact of facts) {
      this.#rows.push({
        eventKey,
        tickAt: this.#tickAt,
        kind: "match",
        subject: fact.matchKey,
        phase: null,
        tbaLastModified: null,
        tbaActualTime: fact.actualTime,
        tbaPostResultTime: fact.postResultTime,
        observedAt,
        foldedAt,
        publishedAt: null,
        detail: null,
      });
    }
  }

  /** The event's matches artifacts are written: stamp the published time on this tick's `matches` endpoint row and match rows for the event that lack one. */
  eventPublished(eventKey: string): void {
    const publishedAt = this.#nowIso();
    for (const row of this.#rows) {
      if (row.eventKey !== eventKey || row.publishedAt !== null) continue;
      if (row.kind === "match" || (row.kind === "endpoint" && row.subject === "matches")) row.publishedAt = publishedAt;
    }
  }

  /** The same stamp for ONE named endpoint's row. */
  endpointPublished(eventKey: string, endpoint: string): void {
    const publishedAt = this.#nowIso();
    for (const row of this.#rows) {
      if (row.eventKey === eventKey && row.kind === "endpoint" && row.subject === endpoint && row.publishedAt === null) row.publishedAt = publishedAt;
    }
  }

  /** The event moved from one phase to another. The row carries the new phase as its own phase. */
  phaseChanged(eventKey: string, from: string, to: string): void {
    this.#rows.push({
      eventKey,
      tickAt: this.#tickAt,
      kind: "phase",
      subject: to,
      phase: to,
      tbaLastModified: null,
      tbaActualTime: null,
      tbaPostResultTime: null,
      observedAt: this.#nowIso(),
      foldedAt: null,
      publishedAt: null,
      detail: JSON.stringify({ from }),
    });
  }

  /** The event's phase for this tick, applied to the phase column of every row of that event when rows are read out. */
  setPhase(eventKey: string, phase: string): void {
    this.#phaseByEvent.set(eventKey, phase);
  }

  /** A stage the tick swallowed. `error` is cut to the log's message limit. */
  failure(eventKey: string, stage: string, error: unknown): void {
    this.#rows.push({
      eventKey,
      tickAt: this.#tickAt,
      kind: "failure",
      subject: stage,
      phase: null,
      tbaLastModified: null,
      tbaActualTime: null,
      tbaPostResultTime: null,
      observedAt: this.#nowIso(),
      foldedAt: null,
      publishedAt: null,
      detail: truncatedMessage(error),
    });
  }

  /** Every row, with each event's phase applied where the row does not already carry one. */
  rows(): IngestLogRow[] {
    return this.#rows.map((row) => {
      const phase = row.phase ?? this.#phaseByEvent.get(row.eventKey) ?? null;
      return { ...row, phase };
    });
  }
}

/**
 * The one INSERT. Every column is read out of the bound JSON string with
 * `json_extract` over `json_each`, so a single bound parameter carries any number
 * of rows and a JSON null becomes SQL NULL.
 */
export const INGEST_LOG_INSERT_SQL = `INSERT INTO ingest_log (event_key, tick_at, kind, subject, phase, tba_last_modified, tba_actual_time, tba_post_result_time, observed_at, folded_at, published_at, detail)
SELECT json_extract(value, '$.eventKey'), json_extract(value, '$.tickAt'), json_extract(value, '$.kind'), json_extract(value, '$.subject'), json_extract(value, '$.phase'), json_extract(value, '$.tbaLastModified'), json_extract(value, '$.tbaActualTime'), json_extract(value, '$.tbaPostResultTime'), json_extract(value, '$.observedAt'), json_extract(value, '$.foldedAt'), json_extract(value, '$.publishedAt'), json_extract(value, '$.detail')
FROM json_each(?)`;

/** Deletes rows observed before the bound ISO time. */
export const INGEST_LOG_PRUNE_SQL = `DELETE FROM ingest_log WHERE observed_at < ?`;

/** The per tick context the tick threads through its helpers. */
export interface LiveTickContext {
  readonly ingest: IngestLogBuffer;
  /** The phase facts `processEvent` derived from each match list this tick fetched, by event key (`liveEventPass.ts` reads them). An event with no entry held no fresh list. */
  readonly phaseFacts: Map<string, LivePhaseFacts>;
}

/**
 * Writes the buffer in ONE statement. No rows, no call, 0. NEVER throws: a
 * rejection is caught, warned as one JSON line and reported as 0 rows written.
 */
export async function flushIngestLog(db: D1Database, buffer: IngestLogBuffer): Promise<number> {
  const rows = buffer.rows();
  if (rows.length === 0) return 0;
  try {
    await db.prepare(INGEST_LOG_INSERT_SQL).bind(JSON.stringify(rows)).run();
    return rows.length;
  } catch (error) {
    console.warn(JSON.stringify({ msg: "ingest-log-flush-failed", rows: rows.length, error: truncatedMessage(error) }));
    return 0;
  }
}
