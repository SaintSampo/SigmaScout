/**
 * LOCAL VISUAL-CHECK FIXTURE for browser pricing (260915-m4j). Not a test of
 * correctness, and nothing it produces is ever published.
 *
 * - THE NUMBERS ARE NOT WALK-FORWARD CORRECT. The block is the season-END seed
 *   state (`reports/publish/seed-spr.sql`) and the event's standings stay
 *   final, so a "moved" match is priced by a model that has already seen it.
 *   It exists only so a human can SEE browser-priced and unpriced upcoming rows
 *   on a local page. Pricing parity with the offline publisher is proven by
 *   `apps/web/src/lib/eventPricing.parity.test.ts`, never by this script.
 * - It reads the public artifact origin by GET only, and never writes to R2 or
 *   D1: no R2 client, no signing library (`localPricingFixture.test.ts` scans
 *   the imports). Output goes to the gitignored `reports/` tree.
 * - It needs no `.env`.
 *
 * SUBCOMMANDS
 *
 *   build --event 2026vache --unpriced-event 2026alhu --last 8 --out reports/local-artifacts [--event-type N]
 *     Takes the last N played qualification matches of both events and moves
 *     them into `upcoming` as schedule-only rows dated just after now (so the
 *     page polls and the team page fetches). The priced event gets a state
 *     block built from the seed; the unpriced event gets none (the live
 *     Worker's `event-state-block-missing` case). The first red robot of the
 *     priced event's LAST moved match becomes a team the season never saw, so
 *     that match prices with a one-sided band and no RP. Every team on the
 *     priced event's moved matches gets its team artifact rewritten with those
 *     matches unplayed and stale, for the team-page overlay to replace.
 *
 *   serve --dir reports/local-artifacts --port 8788
 *     A 127.0.0.1-only HTTP server. A `/v1/...` key present under `--dir` is
 *     served from disk; any other key is fetched from the public origin by GET
 *     and streamed back. Every response carries
 *     `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`. A path
 *     containing `..` is refused.
 *
 * The transformation and the request resolver are pure exported functions,
 * tested offline; the CLI below them is a thin shell.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { SPR_VERSION } from "../packages/core/algorithms/spr.js";
import { loadRpRuleModule } from "../packages/core/rankingPoints/rulesLoader.js";
import { buildEventStateBlock, priceUpcomingFromState } from "../packages/harness/eventStatePricing.js";
import {
  artifactKey,
  EventStateBlockRowSchema,
  LiveEventArtifactSchema,
  TeamSeasonArtifactSchema,
  type LiveEventArtifact,
  type TeamSeasonArtifact,
} from "../packages/harness/pageArtifacts.js";
import type { StateRow } from "../packages/harness/stateSnapshot.js";

export const PUBLIC_ORIGIN = "https://data.sigmascout.org";
export const DEFAULT_UNSEEN_TEAM_KEY = "frc99991";
const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";
const MOVED_MATCH_SPACING_MS = 7 * 60_000;

// ---------------------------------------------------------------------------
// Seed SQL
// ---------------------------------------------------------------------------

/**
 * Every value tuple of the `INSERT ... VALUES (...), (...)` statements in a
 * seed file (`packages/harness/seedSql.ts`'s format): seven single-quoted
 * strings each, `''` unescaped to `'`. Each row is validated with
 * `EventStateBlockRowSchema`, which admits only league and team rows.
 */
export function parseSeedSql(sqlText: string): StateRow[] {
  const rows: StateRow[] = [];
  let i = 0;
  const n = sqlText.length;

  const readQuoted = (): string => {
    if (sqlText[i] !== "'") throw new Error(`parseSeedSql: expected a quoted string at offset ${i}`);
    i++;
    let out = "";
    for (;;) {
      if (i >= n) throw new Error("parseSeedSql: unterminated string");
      const ch = sqlText[i]!;
      if (ch === "'") {
        if (sqlText[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i++;
        return out;
      }
      out += ch;
      i++;
    }
  };
  const skipSpace = (): void => {
    while (i < n && /\s/.test(sqlText[i]!)) i++;
  };

  for (;;) {
    const valuesAt = sqlText.indexOf("VALUES", i);
    if (valuesAt === -1) break;
    i = valuesAt + "VALUES".length;
    for (;;) {
      skipSpace();
      if (sqlText[i] !== "(") throw new Error(`parseSeedSql: expected "(" at offset ${i}`);
      i++;
      const fields: string[] = [];
      for (;;) {
        skipSpace();
        fields.push(readQuoted());
        skipSpace();
        if (sqlText[i] === ",") {
          i++;
          continue;
        }
        if (sqlText[i] === ")") {
          i++;
          break;
        }
        throw new Error(`parseSeedSql: unexpected "${sqlText[i]}" at offset ${i}`);
      }
      if (fields.length !== 7) throw new Error(`parseSeedSql: a tuple has ${fields.length} fields, expected 7`);
      const [algorithmId, algorithmVersion, scopeKind, scopeKey, stateJson, generation, computedAt] = fields as [string, string, string, string, string, string, string];
      const row = EventStateBlockRowSchema.parse({ algorithmId, algorithmVersion, scopeKind, scopeKey, stateJson, generation, computedAt });
      rows.push(row);
      skipSpace();
      if (sqlText[i] === ",") {
        i++;
        continue;
      }
      break;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The synthetic artifact set
// ---------------------------------------------------------------------------

export interface BuildLocalPricingFixtureInput {
  readonly eventArtifact: LiveEventArtifact;
  readonly teamArtifacts: readonly TeamSeasonArtifact[];
  readonly seedRows: readonly StateRow[];
  readonly lastN: number;
  readonly nowMs: number;
  readonly unseenTeamKey?: string;
  readonly priced: boolean;
  /** Used only when the artifact carries no `eventType`. */
  readonly eventType?: number;
  /** Skip the "the seed's league season is the event's season" check. Tests only: the digest-slice replay's league state carries `season: null`. The CLI never sets it. */
  readonly skipSeasonCheck?: boolean;
}

export interface LocalPricingSummary {
  readonly pricedRows: number;
  readonly bothBands: number;
  readonly oneSidedBand: number;
}

export interface LocalPricingFixture {
  readonly eventArtifact: LiveEventArtifact;
  readonly teamArtifacts: TeamSeasonArtifact[];
  readonly movedMatchKeys: string[];
  /** Present only when `priced`. */
  readonly summary: LocalPricingSummary | undefined;
}

const PLAYED_ONLY_TEAM_ROW_KEYS = [
  "actualWinner",
  "actualRedScore",
  "actualBlueScore",
  "actualRedRp",
  "actualBlueRp",
  "actualRedBonusRp",
  "actualBlueBonusRp",
  "coldStart",
  "video",
] as const;

function leagueSeason(seedRows: readonly StateRow[]): unknown {
  const league = seedRows.find((row) => row.scopeKind === "league");
  if (league === undefined) throw new Error("buildLocalPricingFixture: the seed has no league row");
  return (JSON.parse(league.stateJson) as { season?: unknown }).season;
}

export async function buildLocalPricingFixture(input: BuildLocalPricingFixtureInput): Promise<LocalPricingFixture> {
  const { eventArtifact: source, seedRows, lastN, nowMs, priced } = input;
  const unseenTeamKey = input.unseenTeamKey ?? DEFAULT_UNSEEN_TEAM_KEY;
  if (isDemoTeamKey(unseenTeamKey)) throw new Error(`buildLocalPricingFixture: unseen team ${unseenTeamKey} is a demo key`);
  if (seedRows.some((row) => row.scopeKey === unseenTeamKey)) throw new Error(`buildLocalPricingFixture: unseen team ${unseenTeamKey} has a seed row`);

  const playedQm = source.matches
    .filter((row) => row.compLevel === "qm")
    .sort((a, b) => (a.sortTime ?? Number.NEGATIVE_INFINITY) - (b.sortTime ?? Number.NEGATIVE_INFINITY) || a.matchNumber - b.matchNumber);
  if (playedQm.length < lastN) throw new Error(`buildLocalPricingFixture: ${source.eventKey} has ${playedQm.length} played qualification matches, fewer than ${lastN}`);
  const moved = playedQm.slice(-lastN);
  const movedKeys = new Set(moved.map((row) => row.matchKey));
  const sortTimeByKey = new Map(moved.map((row, i) => [row.matchKey, nowMs + (i + 1) * MOVED_MATCH_SPACING_MS]));
  const lastKey = moved[moved.length - 1]!.matchKey;

  const redTeamsFor = (matchKey: string, redTeams: readonly string[]): string[] => (matchKey === lastKey ? [unseenTeamKey, ...redTeams.slice(1)] : [...redTeams]);

  const scheduleOnly = moved.map((row) => ({
    matchKey: row.matchKey,
    compLevel: row.compLevel,
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    sortTime: sortTimeByKey.get(row.matchKey)!,
    redTeams: redTeamsFor(row.matchKey, row.redTeams),
    blueTeams: [...row.blueTeams],
  }));

  const season = source.season;
  const eventType = source.eventType ?? input.eventType ?? 0;
  const { state: _dropped, ...withoutState } = source;
  void _dropped;
  const matches = source.matches.filter((row) => !movedKeys.has(row.matchKey));
  const upcoming = [...scheduleOnly, ...source.upcoming.filter((row) => !movedKeys.has(row.matchKey))];

  let state: LiveEventArtifact["state"];
  if (priced) {
    const leagueSeasonValue = leagueSeason(seedRows);
    if (!input.skipSeasonCheck && leagueSeasonValue !== season) {
      throw new Error(`buildLocalPricingFixture: the seed's league row is season ${String(leagueSeasonValue)}, the event is ${season}`);
    }
    state = buildEventStateBlock(seedRows, [...matches, ...upcoming].flatMap((row) => [...row.redTeams, ...row.blueTeams]));
  }

  const eventArtifact = LiveEventArtifactSchema.parse({
    ...withoutState,
    eventType,
    generation: `local-fixture-${nowMs}`,
    computedAt: new Date(nowMs).toISOString(),
    matches,
    upcoming,
    ...(state !== undefined ? { state } : {}),
  });

  let summary: LocalPricingSummary | undefined;
  if (priced) {
    const trial = priceUpcomingFromState({ state: eventArtifact.state!, eventKey: source.eventKey, season, eventType, ruleModule: await loadRpRuleModule(season), upcoming: scheduleOnly });
    const bands = trial.event.map((row) => [row.redMatchBandVariance !== undefined, row.blueMatchBandVariance !== undefined] as const);
    summary = {
      pricedRows: trial.event.length,
      bothBands: bands.filter(([red, blue]) => red && blue).length,
      oneSidedBand: bands.filter(([red, blue]) => red !== blue).length,
    };
    if (summary.oneSidedBand < 1) throw new Error("buildLocalPricingFixture: no moved match priced with a one-sided band; the unseen-team case would not be visible");
  }

  const teamArtifacts = input.teamArtifacts.map((team) =>
    TeamSeasonArtifactSchema.parse({
      ...team,
      generation: `local-fixture-${nowMs}`,
      computedAt: new Date(nowMs).toISOString(),
      events: team.events.map((event) =>
        event.eventKey !== source.eventKey
          ? event
          : {
              ...event,
              matches: event.matches.map((row) => {
                if (!movedKeys.has(row.matchKey)) return row;
                const stale: Record<string, unknown> = { ...row, sortTime: sortTimeByKey.get(row.matchKey)!, redTeams: redTeamsFor(row.matchKey, row.redTeams) };
                for (const key of PLAYED_ONLY_TEAM_ROW_KEYS) delete stale[key];
                return stale;
              }),
            }
      ),
    })
  );

  return { eventArtifact, teamArtifacts, movedMatchKeys: moved.map((row) => row.matchKey), summary };
}

// ---------------------------------------------------------------------------
// The localhost server's request resolver
// ---------------------------------------------------------------------------

export type ResolvedRequest = { readonly kind: "local"; readonly file: string } | { readonly kind: "remote"; readonly key: string } | { readonly kind: "reject"; readonly reason: string };

/**
 * Maps a request path to a file under `dir`, a public-origin key, or a
 * refusal. Only `/v1/...` keys are served; any `..` (raw or percent-encoded)
 * is refused before the path is ever joined to `dir`.
 */
export function resolveRequest(dir: string, rawUrl: string, fileExists: (path: string) => boolean = (path) => existsSync(path) && statSync(path).isFile()): ResolvedRequest {
  const pathOnly = rawUrl.split("?")[0]!.split("#")[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return { kind: "reject", reason: "malformed path" };
  }
  if (decoded.includes("..") || pathOnly.includes("..")) return { kind: "reject", reason: "path traversal" };
  if (decoded.includes("\\") || decoded.includes("\0")) return { kind: "reject", reason: "illegal character" };
  if (!decoded.startsWith("/v1/")) return { kind: "reject", reason: "only /v1/ keys are served" };
  const key = decoded.slice(1);
  const root = resolve(dir);
  const file = resolve(root, key);
  if (!file.startsWith(root + sep)) return { kind: "reject", reason: "path traversal" };
  return fileExists(file) ? { kind: "local", file } : { kind: "remote", key };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function getJson(key: string): Promise<unknown> {
  const res = await fetch(`${PUBLIC_ORIGIN}/${key}`, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${key}: HTTP ${res.status}`);
  return res.json();
}

function writeArtifact(outDir: string, key: string, body: unknown): void {
  const file = join(outDir, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body));
}

async function runBuild(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      event: { type: "string" },
      "unpriced-event": { type: "string" },
      last: { type: "string", default: "8" },
      out: { type: "string", default: "reports/local-artifacts" },
      "event-type": { type: "string" },
      seed: { type: "string", default: "reports/publish/seed-spr.sql" },
    },
    strict: true,
  });
  if (values.event === undefined || values["unpriced-event"] === undefined) throw new Error("build needs --event and --unpriced-event");
  const lastN = Number(values.last);
  const eventType = values["event-type"] !== undefined ? Number(values["event-type"]) : undefined;
  const nowMs = Date.now();

  const seedRows = parseSeedSql(readFileSync(values.seed, "utf8"));
  const seedVersions = new Set(seedRows.map((row) => row.algorithmVersion));
  if (seedVersions.size !== 1 || !seedVersions.has(SPR_VERSION)) {
    throw new Error(`refusing: ${values.seed} carries version(s) ${[...seedVersions].join(", ")}, the bundled SPR is ${SPR_VERSION}`);
  }

  const manifest = (await getJson(ALGORITHMS_MANIFEST_KEY)) as { algorithms: { id: string; version: string }[] };
  const version = manifest.algorithms.find((a) => a.id === "spr")?.version;
  if (version !== SPR_VERSION) throw new Error(`refusing: the origin's spr version is ${String(version)}, the bundled SPR is ${SPR_VERSION}`);

  const eventKeyFor = (eventKey: string) => artifactKey({ page: "event", eventKey, algorithmId: "spr", version });
  const pricedSource = LiveEventArtifactSchema.parse(await getJson(eventKeyFor(values.event)));
  const unpricedSource = LiveEventArtifactSchema.parse(await getJson(eventKeyFor(values["unpriced-event"])));

  // Team artifacts for every team on the priced event's moved matches (the unseen team has none).
  const probe = await buildLocalPricingFixture({ eventArtifact: pricedSource, teamArtifacts: [], seedRows, lastN, nowMs, priced: false, eventType });
  const movedTeams = new Set(
    probe.eventArtifact.upcoming.filter((row) => probe.movedMatchKeys.includes(row.matchKey)).flatMap((row) => [...row.redTeams, ...row.blueTeams])
  );
  movedTeams.delete(DEFAULT_UNSEEN_TEAM_KEY);
  const teamArtifacts: TeamSeasonArtifact[] = [];
  for (const teamKey of movedTeams) {
    teamArtifacts.push(TeamSeasonArtifactSchema.parse(await getJson(artifactKey({ page: "team", teamKey, year: pricedSource.season, algorithmId: "spr", version }))));
  }

  const priced = await buildLocalPricingFixture({ eventArtifact: pricedSource, teamArtifacts, seedRows, lastN, nowMs, priced: true, eventType });
  const unpriced = await buildLocalPricingFixture({ eventArtifact: unpricedSource, teamArtifacts: [], seedRows, lastN, nowMs, priced: false, eventType });

  writeArtifact(values.out, eventKeyFor(values.event), priced.eventArtifact);
  writeArtifact(values.out, eventKeyFor(values["unpriced-event"]), unpriced.eventArtifact);
  for (const team of priced.teamArtifacts) {
    writeArtifact(values.out, artifactKey({ page: "team", teamKey: team.teamKey, year: team.season, algorithmId: "spr", version }), team);
  }

  // A team with the most moved matches, for the team-page check.
  const counts = new Map<string, number>();
  for (const row of priced.eventArtifact.upcoming) {
    if (!priced.movedMatchKeys.includes(row.matchKey)) continue;
    for (const teamKey of [...row.redTeams, ...row.blueTeams]) if (movedTeams.has(teamKey)) counts.set(teamKey, (counts.get(teamKey) ?? 0) + 1);
  }
  const [teamKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;

  console.log(
    JSON.stringify(
      {
        pricedEvent: values.event,
        pricedMovedMatchKeys: priced.movedMatchKeys,
        oneSidedMatchKey: priced.movedMatchKeys[priced.movedMatchKeys.length - 1],
        unpricedEvent: values["unpriced-event"],
        unpricedMovedMatchKeys: unpriced.movedMatchKeys,
        teamNumber: Number(teamKey.replace(/^frc/, "")),
        teamArtifactsWritten: priced.teamArtifacts.length,
        summary: priced.summary,
        out: values.out,
      },
      null,
      2
    )
  );
}

function runServe(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { dir: { type: "string", default: "reports/local-artifacts" }, port: { type: "string", default: "8788" } },
    strict: true,
  });
  const dir = values.dir;
  const port = Number(values.port);
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

  const server = createServer((req, res) => {
    const resolved = resolveRequest(dir, req.url ?? "/");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, headers).end();
      return;
    }
    if (resolved.kind === "reject") {
      res.writeHead(400, { ...headers, "Content-Type": "text/plain" }).end(resolved.reason);
      return;
    }
    if (resolved.kind === "local") {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      createReadStream(resolved.file).pipe(res);
      return;
    }
    fetch(`${PUBLIC_ORIGIN}/${resolved.key}`, { method: "GET" })
      .then(async (upstream) => {
        res.writeHead(upstream.status, { ...headers, "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      })
      .catch((err: unknown) => {
        res.writeHead(502, { ...headers, "Content-Type": "text/plain" }).end(String(err));
      });
  });
  server.listen(port, "127.0.0.1", () => console.log(`localPricingFixture: serving ${resolve(dir)} on http://127.0.0.1:${port} (falls through to ${PUBLIC_ORIGIN})`));
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "build") {
    runBuild(rest).catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
  } else if (command === "serve") {
    runServe(rest);
  } else {
    console.error("usage: tsx scripts/localPricingFixture.ts build|serve [options]");
    process.exit(1);
  }
}
