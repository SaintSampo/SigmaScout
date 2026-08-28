/**
 * The replay rig (plan 04-07, Task 2): one recorded historical event, driven
 * through the DEPLOYED `sigmascout-worker`'s real `scheduled()` path over
 * HTTPS, produces two proofs from one fixture (D-20):
 *
 *   1. FRESHNESS (D-20/SC-2): revealing the event's real matches one at a
 *      time and measuring wall-clock time from "result available" to
 *      "published artifact reflects it," either by manually triggering the
 *      scheduled handler (`--live-trigger manual`, isolates the write path's
 *      own latency) or by letting the real one-minute cron fire on its own
 *      (`--live-trigger cron`, the only run that includes the platform's own
 *      scheduling jitter).
 *   2. EQUIVALENCE (D-14): the SAME event, replayed offline from the SAME
 *      cold-start baseline through `packages/harness`'s `WalkForwardSimulator`
 *      — compared against the deployed Worker's own published output via a
 *      prediction-stream digest (`packages/harness/promote.ts`'s
 *      `computePredictionStreamDigest`, unchanged) and a full published
 *      event-artifact comparison excluding exactly `generation`/`computedAt`.
 *
 * HOW THE RIG SUBSTITUTES FOR TBA (D-20's fixture mechanism — the plan
 * deliberately left this open). This project's choice: a SECOND, minimal
 * Worker (`apps/worker/src/fixtureServer.ts`, `wrangler.fixture.toml`)
 * serving real-corpus-derived TBA-shaped JSON from the SAME R2 bucket the
 * production Worker already publishes to, under a `fixtures/` prefix. Chosen
 * over a locally-tunnelled server because it runs on infrastructure already
 * proven working (R2, a deployed Worker, an authenticated `wrangler`) and
 * does not depend on a tunnel process staying up for a multi-minute
 * measurement — a dropped tunnel mid-run would corrupt a freshness
 * distribution silently, where a second Worker either answers or the whole
 * request visibly fails. The production Worker is pointed at it via
 * `apps/worker/src/env.ts`'s `TBA_BASE_URL` — a plain, tracked `[vars]`
 * default (the real TBA base) overridden ONLY at deploy time
 * (`wrangler deploy --var TBA_BASE_URL:<fixture-worker-url>`), never an
 * undocumented back door (T-04-47). This script owns exactly that deploy/
 * restore cycle, in a `try`/`finally` so a mid-run failure still restores
 * the production default.
 *
 * WHAT THIS RIG NECESSARILY MUTATES ON THE DEPLOYED WORKER, AND WHY IT IS
 * SAFE (documented here once rather than at every call site below):
 *   - The real `v1/manifest/live-windows.json` R2 object gains ONE temporary
 *     window entry for `--event`, so the deployed Worker's tick considers it
 *     live at all (D-18's early exit reads exactly this object). Removed by
 *     the next real `pnpm publish:seasons` run, which regenerates this
 *     manifest from the corpus and has no knowledge of the rig's synthetic
 *     window — this is why a rig session MUST be followed by a re-baseline
 *     (`docs/worker-operations.md`'s "Re-baselining" section), not just for
 *     hygiene but as the actual restore mechanism.
 *   - `algorithm_state`/`event_cursor` rows for `--event`'s touched scope are
 *     DELETED (cold-started) before driving, so the online run starts from
 *     the same blank slate the offline `WalkForwardSimulator` does — the
 *     controlled condition the equivalence proof needs. Also restored by the
 *     next re-baseline.
 *   - The production Worker is redeployed twice per rig session (fixture
 *     base URL, then the tracked default) — this is D-27's existing manual
 *     deploy procedure, just invoked programmatically.
 *
 * Standalone-script shape matching `baselineFingerprint.ts`/`promote.ts`:
 * `parseArgs`, `async function main()`, an entry-point guard.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { z } from "zod";
import { opr } from "../packages/core/algorithms/opr.js";
import { epa } from "../packages/core/algorithms/epa.js";
import { makeSigma1 } from "../packages/core/algorithms/sigma1/index.js";
import type { AlgorithmModule, ComponentPrediction, MatchResult, Prediction, TeamMetric } from "../packages/core/algorithms/types.js";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../packages/corpus/db.js";
import { WalkForwardSimulator, type PredictionRecord } from "../packages/harness/replay.js";
import { computePredictionStreamDigest } from "../packages/harness/promote.js";
import { buildAlgorithmsManifest, type AlgorithmsManifest } from "../packages/harness/manifests.js";
import { PIPELINE_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import { roundMetric, roundProbability } from "../packages/harness/rounding.js";
import { artifactKey } from "../packages/harness/pageArtifacts.js";
import { deleteObject, getObject, putObject } from "../packages/harness/r2Client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUCKET = "sigmascout-artifacts";
const LIVE_WINDOWS_KEY = "v1/manifest/live-windows.json";
const CRON_EXPRESSION = "* * * * *";
/** D-20's accepted gap, recorded verbatim in every result file and printed to the console — never omitted, never softened. */
export const MEASUREMENT_GAP_NOTE =
  "The rig replaces TBA with a recorded fixture, so this measurement does not exercise real TBA response " +
  "latency. A --live-trigger cron run covers Cloudflare's own scheduling jitter but still not TBA's own " +
  "timing. A live offseason event (2026azscor 2026-08-28, 2026scsc 2026-08-29) remains available as optional " +
  "later confirmation and is not required to close the criterion (D-20).";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const WORKER_DIR = join(REPO_ROOT, "apps", "worker");

// ---------------------------------------------------------------------------
// Pure parts (unit-tested by scripts/replayRig.test.ts — no I/O below this line)
// ---------------------------------------------------------------------------

/** D-14: the exclusion list is EXACTLY these two fields — asserted by a unit test, never widened to make a comparison pass. */
export const ARTIFACT_COMPARISON_EXCLUDED_FIELDS = ["generation", "computedAt"] as const;

export interface ArtifactDiff {
  readonly path: string;
  readonly online: unknown;
  readonly offline: unknown;
}

/**
 * Deep, order-sensitive-for-arrays structural diff between two published
 * artifacts, ignoring exactly `ARTIFACT_COMPARISON_EXCLUDED_FIELDS` at any
 * depth (the preamble fields can appear only at the top level of an
 * `EventArtifact`, but this stays depth-agnostic rather than hardcoding
 * "top level only," since a future nested stamp would still be a legitimate
 * exclusion-list entry, never a silent one). Returns an empty array on a
 * full match; every other difference is reported by JSON path.
 */
export function compareArtifacts(online: unknown, offline: unknown, path = "$"): ArtifactDiff[] {
  if (online === offline) return [];
  const bothObjects = typeof online === "object" && online !== null && typeof offline === "object" && offline !== null;
  if (!bothObjects) {
    return [{ path, online, offline }];
  }
  if (Array.isArray(online) !== Array.isArray(offline)) {
    return [{ path, online, offline }];
  }
  if (Array.isArray(online) && Array.isArray(offline)) {
    if (online.length !== offline.length) {
      return [{ path: `${path}.length`, online: online.length, offline: offline.length }];
    }
    const diffs: ArtifactDiff[] = [];
    for (let i = 0; i < online.length; i++) {
      diffs.push(...compareArtifacts(online[i], offline[i], `${path}[${i}]`));
    }
    return diffs;
  }
  const onlineRecord = online as Record<string, unknown>;
  const offlineRecord = offline as Record<string, unknown>;
  const keys = new Set([...Object.keys(onlineRecord), ...Object.keys(offlineRecord)]);
  const diffs: ArtifactDiff[] = [];
  for (const key of [...keys].sort()) {
    if ((ARTIFACT_COMPARISON_EXCLUDED_FIELDS as readonly string[]).includes(key)) continue;
    diffs.push(...compareArtifacts(onlineRecord[key], offlineRecord[key], `${path}.${key}`));
  }
  return diffs;
}

export interface FreshnessStats {
  readonly count: number;
  readonly timeoutCount: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

/** Median/p95/max over the non-timed-out samples (D-20/SC-2: report the distribution, never a single number). `null` fields mean "no successful sample to compute from," never a fabricated 0. */
export function computeFreshnessStats(samplesMs: readonly (number | null)[]): FreshnessStats {
  const successes = samplesMs.filter((v): v is number => v !== null).slice().sort((a, b) => a - b);
  const timeoutCount = samplesMs.length - successes.length;
  if (successes.length === 0) {
    return { count: samplesMs.length, timeoutCount, medianMs: null, p95Ms: null, maxMs: null };
  }
  const percentile = (p: number): number => {
    const idx = Math.min(successes.length - 1, Math.ceil((p / 100) * successes.length) - 1);
    return successes[Math.max(0, idx)]!;
  };
  return {
    count: samplesMs.length,
    timeoutCount,
    medianMs: percentile(50),
    p95Ms: percentile(95),
    maxMs: successes[successes.length - 1]!,
  };
}

const FreshnessSampleSchema = z.object({ matchKey: z.string().min(1), elapsedMs: z.number().nonnegative().nullable() });

const EquivalenceEntrySchema = z.object({
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  onlineDigest: z.string().regex(/^[0-9a-f]{64}$/),
  offlineDigest: z.string().regex(/^[0-9a-f]{64}$/),
  digestMatch: z.boolean(),
  artifactMatch: z.boolean(),
  artifactDiffs: z.array(z.object({ path: z.string(), online: z.unknown(), offline: z.unknown() })),
});

/** The single, checkable schema every `--out` result file is validated against before its one terminal write. */
export const ReplayRigResultSchema = z.object({
  runAt: z.string().min(1),
  mode: z.enum(["freshness", "equivalence", "both"]),
  liveTrigger: z.enum(["manual", "cron"]),
  workerUrl: z.string().min(1),
  fixtureUrl: z.string().min(1),
  event: z.object({ eventKey: z.string().min(1), season: z.number().int(), matchCount: z.number().int().nonnegative() }),
  algorithms: z.array(z.string().min(1)).min(1),
  freshness: z
    .object({
      samples: z.array(FreshnessSampleSchema),
      stats: z.object({
        count: z.number().int().nonnegative(),
        timeoutCount: z.number().int().nonnegative(),
        medianMs: z.number().nullable(),
        p95Ms: z.number().nullable(),
        maxMs: z.number().nullable(),
      }),
    })
    .optional(),
  equivalence: z.object({ perAlgorithm: z.array(EquivalenceEntrySchema) }).optional(),
  gap: z.string().min(1),
});

export type ReplayRigResult = z.infer<typeof ReplayRigResultSchema>;

// ---------------------------------------------------------------------------
// Algorithm module construction — a SMALL, DELIBERATE duplication of
// apps/worker/src/scheduled.ts's own buildAlgorithmModules (D-06's own
// precedent for exactly this direction of duplication: a Node/root-typechecked
// script must never import a file carrying apps/worker's Cloudflare ambient
// types, `@cloudflare/workers-types`, the same reason scheduled.ts's own
// header gives for duplicating publish.ts's rounding helpers instead of
// importing them — the isolation is symmetric). Any drift between the two
// copies would show up immediately as an equivalence mismatch this rig itself
// reports, which is what keeps this duplication honest rather than silent.
// ---------------------------------------------------------------------------

function buildAlgorithmModulesLocal(algorithmsManifest: AlgorithmsManifest): Map<string, AlgorithmModule<any>> {
  const modules = new Map<string, AlgorithmModule<any>>();
  for (const entry of algorithmsManifest.algorithms) {
    if (entry.id === "opr") {
      modules.set(entry.id, opr);
      continue;
    }
    if (entry.id === "epa") {
      modules.set(entry.id, epa);
      continue;
    }
    modules.set(entry.id, makeSigma1({ id: entry.id, linkMode: "predictive-variance", params: entry.params, paramSetName: entry.paramSetName }));
  }
  return modules;
}

function roundComponentsLocal(components: Record<string, ComponentPrediction> | undefined): Record<string, ComponentPrediction> | undefined {
  if (components === undefined) return undefined;
  const result: Record<string, ComponentPrediction> = {};
  for (const [key, c] of Object.entries(components)) {
    result[key] = { mean: roundMetric(c.mean), ...(c.variance !== undefined ? { variance: roundMetric(c.variance) } : {}) };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Corpus extraction — real TBA-shaped payloads reconstructed from the real
// corpus (never synthesized): the fixture endpoint serves genuine historical
// data, only revealed progressively.
// ---------------------------------------------------------------------------

interface RawEventMatchRow {
  match_key: string;
  event_key: string;
  comp_level: string;
  match_number: number;
  set_number: number;
  sort_time: number;
  red_teams: string;
  blue_teams: string;
  red_surrogates: string;
  blue_surrogates: string;
  red_dqs: string;
  blue_dqs: string;
  winner: string | null;
  red_score: number | null;
  blue_score: number | null;
  has_score_breakdown: number;
  score_breakdown_raw: string | null;
}

interface EventInfo {
  readonly eventKey: string;
  readonly season: number;
  readonly eventType: number;
  readonly startDate: string;
}

/** One match, TBA-`GET /event/{key}/matches` element shape, `revealed: false` (unplayed placeholder — score/winning_alliance/score_breakdown all absent, matching what TBA reports for a not-yet-played match). */
interface FixtureMatch {
  key: string;
  event_key: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  time: null;
  predicted_time: null;
  actual_time: number | null;
  winning_alliance: "red" | "blue" | "";
  alliances: {
    red: { team_keys: string[]; surrogate_team_keys: string[]; dq_team_keys: string[]; score: number | null };
    blue: { team_keys: string[]; surrogate_team_keys: string[]; dq_team_keys: string[]; score: number | null };
  };
  score_breakdown: unknown;
}

function unplayedFixtureMatch(row: RawEventMatchRow): FixtureMatch {
  return {
    key: row.match_key,
    event_key: row.event_key,
    comp_level: row.comp_level,
    set_number: row.set_number,
    match_number: row.match_number,
    time: null,
    predicted_time: null,
    actual_time: null,
    winning_alliance: "",
    alliances: {
      red: { team_keys: JSON.parse(row.red_teams), surrogate_team_keys: JSON.parse(row.red_surrogates), dq_team_keys: JSON.parse(row.red_dqs), score: null },
      blue: { team_keys: JSON.parse(row.blue_teams), surrogate_team_keys: JSON.parse(row.blue_surrogates), dq_team_keys: JSON.parse(row.blue_dqs), score: null },
    },
    score_breakdown: null,
  };
}

/** The REAL result for this row, reconstructed from the real corpus (D-20: "a recorded historical match result pushed through the deployed Worker's real scheduled path"). */
function playedFixtureMatch(row: RawEventMatchRow): FixtureMatch {
  const winningAlliance: "red" | "blue" | "" = row.winner === "red" || row.winner === "blue" ? row.winner : "";
  return {
    key: row.match_key,
    event_key: row.event_key,
    comp_level: row.comp_level,
    set_number: row.set_number,
    match_number: row.match_number,
    time: null,
    predicted_time: null,
    actual_time: Math.round(row.sort_time / 1000),
    winning_alliance: winningAlliance,
    alliances: {
      red: { team_keys: JSON.parse(row.red_teams), surrogate_team_keys: JSON.parse(row.red_surrogates), dq_team_keys: JSON.parse(row.red_dqs), score: row.red_score },
      blue: { team_keys: JSON.parse(row.blue_teams), surrogate_team_keys: JSON.parse(row.blue_surrogates), dq_team_keys: JSON.parse(row.blue_dqs), score: row.blue_score },
    },
    score_breakdown: row.has_score_breakdown === 1 && row.score_breakdown_raw ? JSON.parse(row.score_breakdown_raw) : null,
  };
}

function loadEventRows(db: Corpus, eventKey: string): { info: EventInfo; rows: RawEventMatchRow[] } {
  const info = db
    .prepare(`SELECT event_key, year, event_type, start_date FROM events WHERE event_key = ?`)
    .get(eventKey) as { event_key: string; year: number; event_type: number; start_date: string } | undefined;
  if (!info) throw new Error(`replayRig: event "${eventKey}" not found in the corpus`);

  const rows = db
    .prepare(
      `SELECT m.match_key, m.event_key, m.comp_level, m.match_number, m.set_number, m.sort_time,
              m.red_teams, m.blue_teams, m.red_surrogates, m.blue_surrogates, m.red_dqs, m.blue_dqs,
              m.winner, m.red_score, m.blue_score, m.has_score_breakdown, m.score_breakdown_raw
       FROM matches m
       WHERE m.event_key = ? AND m.winner IS NOT NULL
       ORDER BY m.sort_time ASC,
         CASE m.comp_level WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END ASC,
         m.set_number ASC, m.match_number ASC`
    )
    .all(eventKey) as RawEventMatchRow[];

  return { info: { eventKey: info.event_key, season: info.year, eventType: info.event_type, startDate: info.start_date }, rows };
}

function touchedTeamsOf(rows: readonly RawEventMatchRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const t of JSON.parse(row.red_teams) as string[]) set.add(t);
    for (const t of JSON.parse(row.blue_teams) as string[]) set.add(t);
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// wrangler CLI shell-outs (D1 reset, deploy) — real production infra
// mutations, always run from apps/worker so wrangler.toml resolves.
// ---------------------------------------------------------------------------

/**
 * Resolves wrangler's real JS entry point (never its `.cmd`/`.ps1` shim) so
 * it can be spawned via `process.execPath` directly — `spawnSync` invoking a
 * Windows `.cmd` file WITHOUT `shell: true` fails outright (`EINVAL`), and
 * `shell: true` is a documented argument-injection risk (Node's own
 * deprecation warning: "arguments are not escaped, only concatenated").
 * Spawning `node <wrangler.js> ...args` sidesteps both — no shell involved.
 */
function resolveWranglerBin(): string {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("wrangler/package.json", { paths: [WORKER_DIR] });
  return join(dirname(pkgJsonPath), "bin", "wrangler.js");
}

function runWrangler(args: string[]): { status: number; stdout: string; stderr: string } {
  const wranglerBin = resolveWranglerBin();
  const result = spawnSync(process.execPath, [wranglerBin, ...args], { cwd: WORKER_DIR, encoding: "utf8" });
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? "", stderr: `spawnSync error: ${result.error.message}` };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

/** Cold-starts exactly the D1 scope this event/algorithm-set touches (D-14's controlled starting condition) — never a broader wipe. */
function resetD1State(reportsDir: string, algorithmIds: readonly string[], eventKey: string, touchedTeams: readonly string[]): void {
  const statements: string[] = [];
  for (const id of algorithmIds) {
    statements.push(`DELETE FROM algorithm_state WHERE algorithm_id = '${sqlEscape(id)}' AND scope_kind = 'league';`);
    if (touchedTeams.length > 0) {
      const inList = touchedTeams.map((t) => `'${sqlEscape(t)}'`).join(",");
      statements.push(`DELETE FROM algorithm_state WHERE algorithm_id = '${sqlEscape(id)}' AND scope_kind = 'team' AND scope_key IN (${inList});`);
    }
    if (id === "opr") {
      statements.push(`DELETE FROM algorithm_state WHERE algorithm_id = 'opr' AND scope_kind = 'event' AND scope_key = '${sqlEscape(eventKey)}';`);
    }
  }
  statements.push(`DELETE FROM event_cursor WHERE event_key = '${sqlEscape(eventKey)}';`);

  const sqlPath = join(reportsDir, `reset-${eventKey}-${Date.now()}.sql`);
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(sqlPath, statements.join("\n"), "utf8");
  const result = runWrangler(["d1", "execute", "sigmascout-state", "--remote", "--file", sqlPath]);
  if (result.status !== 0) {
    throw new Error(`replayRig: resetD1State failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

function deployWorker(overrideBaseUrl: string | undefined): void {
  const args = ["deploy"];
  if (overrideBaseUrl) args.push("--var", `TBA_BASE_URL:${overrideBaseUrl}`);
  const result = runWrangler(args);
  if (result.status !== 0) {
    throw new Error(`replayRig: deployWorker failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function triggerScheduledHandler(workerUrl: string): Promise<number> {
  const url = new URL("/cdn-cgi/handler/scheduled", workerUrl);
  url.searchParams.set("cron", CRON_EXPRESSION);
  const res = await fetch(url, { method: "POST" });
  return res.status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// R2 fixture / manifest I/O
// ---------------------------------------------------------------------------

async function uploadFixture(eventKey: string, matches: readonly FixtureMatch[], detail: unknown): Promise<void> {
  await putObject(BUCKET, `fixtures/${eventKey}/matches.json`, JSON.stringify(matches), { contentType: "application/json", cacheControl: "no-store" });
  await putObject(BUCKET, `fixtures/${eventKey}/detail.json`, JSON.stringify(detail), { contentType: "application/json", cacheControl: "no-store" });
}

interface LiveWindowsManifestShape {
  schemaVersion: number;
  generation: string;
  computedAt: string;
  windows: { eventKey: string; season: number; startMs: number; endMs: number; inferred: boolean }[];
}

/** Adds (or widens) a temporary live window for `eventKey`, returning the ORIGINAL manifest text so the caller can log what a manual restore would need — the actual restore is the next `pnpm publish:seasons` re-baseline (see this file's header). */
async function patchLiveWindowsManifest(eventKey: string, season: number, startMs: number, endMs: number): Promise<string> {
  const original = await getObject(BUCKET, LIVE_WINDOWS_KEY);
  const parsed = JSON.parse(original) as LiveWindowsManifestShape;
  const withoutTest = parsed.windows.filter((w) => w.eventKey !== eventKey);
  const patched: LiveWindowsManifestShape = {
    ...parsed,
    generation: `replay-rig-${Date.now()}`,
    computedAt: new Date().toISOString(),
    windows: [...withoutTest, { eventKey, season, startMs, endMs, inferred: false }],
  };
  await putObject(BUCKET, LIVE_WINDOWS_KEY, JSON.stringify(patched), { contentType: "application/json", cacheControl: "public, max-age=60" });
  return original;
}

/** Bypasses the R2 custom domain's 60s edge cache entirely (a signed S3-compatible GET, D-26's cache policy does not apply here) — measures when the WRITE landed, not when a cache happened to expire, which would otherwise corrupt the freshness figure with an unrelated cache-policy artifact. */
async function readPublishedEventArtifact(eventKey: string, algorithmId: string, version: string): Promise<{ matches: { matchKey: string }[]; [k: string]: unknown } | undefined> {
  try {
    const text = await getObject(BUCKET, artifactKey({ page: "event", eventKey, algorithmId, version }));
    return JSON.parse(text) as { matches: { matchKey: string }[]; [k: string]: unknown };
  } catch {
    return undefined;
  }
}

async function waitForMatchInArtifact(eventKey: string, algorithmId: string, version: string, matchKey: string, timeoutMs: number, intervalMs: number): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const artifact = await readPublishedEventArtifact(eventKey, algorithmId, version);
    if (artifact && artifact.matches.some((m) => m.matchKey === matchKey)) return Date.now() - start;
    await sleep(intervalMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Offline comparison build (independently derived — never copies the online
// output, per this plan's own prohibition on "resolving" a mismatch)
// ---------------------------------------------------------------------------

function buildOfflineEventMatchRow(match: MatchResult, prediction: Prediction) {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponentsLocal(prediction.redComponents),
    blueComponents: roundComponentsLocal(prediction.blueComponents),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  };
}

function roundTeamMetricsLocal(metrics: Record<string, TeamMetric>): Record<string, TeamMetric> {
  const result: Record<string, TeamMetric> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = { value: roundMetric(m.value), ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}) };
  }
  return result;
}

interface OfflineRunOutput {
  readonly records: readonly PredictionRecord[];
  readonly eventArtifactShape: {
    matches: ReturnType<typeof buildOfflineEventMatchRow>[];
    upcoming: unknown[];
    teams: { teamKey: string; teamNumber: number; nickname: string; metrics: Record<string, TeamMetric> }[];
  };
}

function runOfflineReplay(
  matches: readonly MatchResult[],
  touchedTeams: readonly string[],
  algorithm: AlgorithmModule<any>,
  priorTeamInfo: ReadonlyMap<string, { teamNumber: number; nickname: string }>
): OfflineRunOutput {
  const records = new WalkForwardSimulator(matches).run(algorithm, [...touchedTeams]);
  const finalState = records.length > 0 ? recomputeFinalState(matches, touchedTeams, algorithm) : algorithm.initState([...touchedTeams]);
  const metrics = algorithm.teamMetrics(finalState, touchedTeams);

  const eventMatches = records.map((r) => buildOfflineEventMatchRow(r.match, r.prediction));
  const teams = touchedTeams.map((teamKey) => {
    const prior = priorTeamInfo.get(teamKey);
    const fallbackNumber = Number.parseInt(teamKey.replace(/^frc/, ""), 10);
    return {
      teamKey,
      teamNumber: prior?.teamNumber ?? (Number.isFinite(fallbackNumber) ? fallbackNumber : 0),
      nickname: prior?.nickname ?? "",
      metrics: roundTeamMetricsLocal(metrics[teamKey] ?? {}),
    };
  });

  return { records, eventArtifactShape: { matches: eventMatches, upcoming: [], teams } };
}

/** `WalkForwardSimulator.run` returns predictions, not the final state — re-derive it by folding `update` the same way, so `teamMetrics` can be read off the post-replay state (mirrors `processEvent`'s own fold loop in `scheduled.ts`, independently). */
function recomputeFinalState(matches: readonly MatchResult[], touchedTeams: readonly string[], algorithm: AlgorithmModule<any>): unknown {
  let state = algorithm.initState([...touchedTeams]);
  for (const match of matches) state = algorithm.update(state, match);
  return state;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface RigOptions {
  event: string;
  workerUrl: string;
  fixtureUrl: string;
  algorithms: string[];
  mode: "freshness" | "equivalence" | "both";
  out: string;
  liveTrigger: "manual" | "cron";
  matchLimit: number | undefined;
  corpusPath: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  skipDeploy: boolean;
}

function parseOptions(): RigOptions {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      "worker-url": { type: "string" },
      "fixture-url": { type: "string" },
      algorithm: { type: "string" },
      mode: { type: "string" },
      out: { type: "string" },
      "live-trigger": { type: "string" },
      "match-limit": { type: "string" },
      corpus: { type: "string" },
      "poll-interval-ms": { type: "string" },
      "poll-timeout-ms": { type: "string" },
      "skip-deploy": { type: "boolean" },
    },
  });

  const event = values.event;
  if (!event) throw new Error("--event is required (a real historical event key, e.g. 2026cmptx)");
  const workerUrl = values["worker-url"];
  if (!workerUrl) throw new Error("--worker-url is required (the deployed sigmascout-worker's base URL)");
  const mode = (values.mode ?? "both") as RigOptions["mode"];
  if (!["freshness", "equivalence", "both"].includes(mode)) throw new Error(`--mode must be freshness|equivalence|both, got "${mode}"`);
  const liveTrigger = (values["live-trigger"] ?? "manual") as RigOptions["liveTrigger"];
  if (!["manual", "cron"].includes(liveTrigger)) throw new Error(`--live-trigger must be manual|cron, got "${liveTrigger}"`);
  const fixtureUrl = values["fixture-url"];
  if (!fixtureUrl) throw new Error("--fixture-url is required (the deployed sigmascout-fixture-rig Worker's base URL)");

  const algorithms = (values.algorithm ?? PIPELINE_ALGORITHM_IDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  // ALWAYS absolute: resetD1State/deployWorker shell out to `wrangler` with
  // `cwd: WORKER_DIR` (apps/worker), so a relative `--out`/`--corpus` path
  // (naturally typed relative to the repo root, where this script is meant
  // to be invoked from) would silently resolve against the WRONG directory
  // once handed to a child process with a different cwd.
  const out = resolve(REPO_ROOT, values.out ?? join("reports", "replay-rig", `${event}-${mode}-${liveTrigger}-${Date.now()}.json`));
  const matchLimit = values["match-limit"] ? Number.parseInt(values["match-limit"], 10) : undefined;

  return {
    event,
    workerUrl,
    fixtureUrl,
    algorithms,
    mode,
    out,
    liveTrigger,
    matchLimit,
    corpusPath: resolve(REPO_ROOT, values.corpus ?? join("data", "corpus.sqlite")),
    pollIntervalMs: values["poll-interval-ms"] ? Number.parseInt(values["poll-interval-ms"], 10) : 2000,
    pollTimeoutMs: values["poll-timeout-ms"] ? Number.parseInt(values["poll-timeout-ms"], 10) : 90_000,
    skipDeploy: values["skip-deploy"] ?? false,
  };
}

export async function runRig(options: RigOptions): Promise<ReplayRigResult> {
  const db = openCorpusReadOnly(options.corpusPath);
  let deployedWithOverride = false;
  try {
    const { info, rows: allRows } = loadEventRows(db, options.event);
    const rows = options.matchLimit ? allRows.slice(0, options.matchLimit) : allRows;
    if (rows.length === 0) throw new Error(`replayRig: event "${options.event}" has no played matches in the corpus`);
    const touchedTeams = touchedTeamsOf(rows);

    const algorithmsManifest = buildAlgorithmsManifest({ generation: `replay-rig-${Date.now()}`, computedAt: new Date().toISOString() });
    const allModules = buildAlgorithmModulesLocal(algorithmsManifest);
    const modules = options.algorithms.map((id) => {
      const mod = allModules.get(id);
      if (!mod) throw new Error(`replayRig: algorithm "${id}" is not in the published algorithms manifest`);
      return mod;
    });

    console.log(`replayRig: event=${options.event} season=${info.season} matches=${rows.length} algorithms=${options.algorithms.join(",")} mode=${options.mode} liveTrigger=${options.liveTrigger}`);

    // Cold-start (D-14's controlled condition). `--event` names a REAL
    // historical event this repo's own `pnpm publish:seasons` has already
    // published in full (every corpus event has been) — its D1 algorithm
    // state AND its published R2 artifact both already reflect the whole
    // real result. Resetting D1 alone is not a cold start: the deployed
    // Worker's merge logic reads the EXISTING published artifact first
    // (`readExistingEvent`) and a freshness poll would find every match
    // "already there" from the ORIGINAL publish, not from anything this run
    // drove — a methodological bug this rig's own first real run caught (see
    // the SUMMARY). Deleting the touched-scope published artifacts too is
    // what makes "newly folded" genuinely new.
    resetD1State(dirname(options.out), options.algorithms, options.event, touchedTeams);
    for (const mod of modules) {
      await deleteObject(BUCKET, artifactKey({ page: "event", eventKey: options.event, algorithmId: mod.id, version: mod.version }));
      for (const teamKey of touchedTeams) {
        await deleteObject(BUCKET, artifactKey({ page: "team", teamKey, year: info.season, algorithmId: mod.id, version: mod.version }));
      }
    }
    // Symmetric with the now-deleted artifacts: BOTH the online merge (reading
    // nothing back) and this offline reconstruction start from no prior team
    // roster, falling back to the teamKey-derived number and an empty
    // nickname on both sides — never a real name read from data this run
    // just deleted.
    const emptyPriorTeamInfo = new Map<string, { teamNumber: number; nickname: string }>();

    // Make the event live for the deployed Worker's tick, and point it at the fixture.
    const nowMs = Date.now();
    const bufferMs = 15 * 60 * 1000;
    await patchLiveWindowsManifest(options.event, info.season, nowMs - bufferMs, nowMs + bufferMs + rows.length * options.pollTimeoutMs);

    const fixtureMatches: FixtureMatch[] = rows.map(unplayedFixtureMatch);
    const detail = { key: info.eventKey, year: info.season, event_type: info.eventType, start_date: info.startDate };
    await uploadFixture(options.event, fixtureMatches, detail);

    if (!options.skipDeploy) {
      deployWorker(options.fixtureUrl);
      deployedWithOverride = true;
    }

    // Drive the event, match by match, revealing the REAL corpus result.
    const samples: { matchKey: string; elapsedMs: number | null }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      fixtureMatches[i] = playedFixtureMatch(row);
      await uploadFixture(options.event, fixtureMatches, detail);

      if (options.liveTrigger === "manual") {
        const status = await triggerScheduledHandler(options.workerUrl);
        if (status >= 400) console.warn(`replayRig: scheduled-handler trigger for match ${row.match_key} returned HTTP ${status}`);
      }

      const start = Date.now();
      let elapsedAcrossAlgorithms = 0;
      let anyTimedOut = false;
      for (const mod of modules) {
        const elapsed = await waitForMatchInArtifact(options.event, mod.id, mod.version, row.match_key, options.pollTimeoutMs, options.pollIntervalMs);
        if (elapsed === null) {
          anyTimedOut = true;
        } else {
          elapsedAcrossAlgorithms = Math.max(elapsedAcrossAlgorithms, Date.now() - start);
        }
      }
      samples.push({ matchKey: row.match_key, elapsedMs: anyTimedOut ? null : elapsedAcrossAlgorithms });
      console.log(`replayRig: ${row.match_key} -> ${anyTimedOut ? "TIMEOUT" : `${elapsedAcrossAlgorithms}ms`}`);
    }

    // Equivalence (offline replay from the SAME cold start).
    let equivalence: ReplayRigResult["equivalence"];
    if (options.mode === "equivalence" || options.mode === "both") {
      const matchResults = selectMatchesChronological(db, { eventKey: options.event }).slice(0, rows.length);
      const perAlgorithm: z.infer<typeof EquivalenceEntrySchema>[] = [];
      for (const mod of modules) {
        const offline = runOfflineReplay(matchResults, touchedTeams, mod, emptyPriorTeamInfo);
        const offlineDigestInput = offline.records.map((r) => ({
          match: r.match,
          prediction: { ...r.prediction, pRedWin: roundProbability(r.prediction.pRedWin), redScore: roundMetric(r.prediction.redScore), blueScore: roundMetric(r.prediction.blueScore) },
        }));
        const offlineDigest = computePredictionStreamDigest(offlineDigestInput);

        const onlineArtifact = await readPublishedEventArtifact(options.event, mod.id, mod.version);
        const onlineOrdered = matchResults.map((m) => (onlineArtifact?.["matches"] as any[] | undefined)?.find((row: any) => row.matchKey === m.matchKey)).filter(Boolean);
        const onlineDigestInput: PredictionRecord[] = onlineOrdered.map((row: any) => ({
          match: { matchKey: row.matchKey } as MatchResult,
          prediction: { winner: row.predictedWinner, pRedWin: row.pRedWin, redScore: row.predictedRedScore, blueScore: row.predictedBlueScore } as Prediction,
        }));
        const onlineDigest = computePredictionStreamDigest(onlineDigestInput);

        const onlineComparable = onlineArtifact ? { matches: onlineOrdered, upcoming: onlineArtifact["upcoming"], teams: onlineArtifact["teams"] } : undefined;
        const diffs = onlineComparable ? compareArtifacts(onlineComparable, offline.eventArtifactShape) : [{ path: "$", online: undefined, offline: offline.eventArtifactShape }];

        perAlgorithm.push({
          algorithmId: mod.id,
          algorithmVersion: mod.version,
          onlineDigest,
          offlineDigest,
          digestMatch: onlineDigest === offlineDigest,
          artifactMatch: diffs.length === 0,
          artifactDiffs: diffs,
        });
      }
      equivalence = { perAlgorithm };
    }

    const freshness = options.mode === "freshness" || options.mode === "both" ? { samples, stats: computeFreshnessStats(samples.map((s) => s.elapsedMs)) } : undefined;

    const result: ReplayRigResult = {
      runAt: new Date().toISOString(),
      mode: options.mode,
      liveTrigger: options.liveTrigger,
      workerUrl: options.workerUrl,
      fixtureUrl: options.fixtureUrl,
      event: { eventKey: options.event, season: info.season, matchCount: rows.length },
      algorithms: options.algorithms,
      freshness,
      equivalence,
      gap: MEASUREMENT_GAP_NOTE,
    };
    return ReplayRigResultSchema.parse(result);
  } finally {
    db.close();
    if (deployedWithOverride && !options.skipDeploy) {
      try {
        deployWorker(undefined); // restore the tracked default TBA_BASE_URL
        console.log("replayRig: restored sigmascout-worker to the tracked default TBA_BASE_URL");
      } catch (err) {
        console.error(`replayRig: FAILED to restore the deployed Worker's TBA_BASE_URL override — redeploy manually: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const result = await runRig(options);

  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(result, null, 2), "utf8");
  console.log(`replayRig: wrote ${options.out}`);
  console.log(`replayRig: ${MEASUREMENT_GAP_NOTE}`);
  if (result.freshness) {
    console.log(`replayRig: freshness median=${result.freshness.stats.medianMs}ms p95=${result.freshness.stats.p95Ms}ms max=${result.freshness.stats.maxMs}ms timeouts=${result.freshness.stats.timeoutCount}`);
  }
  if (result.equivalence) {
    for (const entry of result.equivalence.perAlgorithm) {
      console.log(`replayRig: ${entry.algorithmId} digestMatch=${entry.digestMatch} artifactMatch=${entry.artifactMatch} (${entry.artifactDiffs.length} diffs)`);
    }
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("replayRig failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
