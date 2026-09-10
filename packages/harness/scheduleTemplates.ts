/**
 * Reader for the gitignored cheesy-arena qualification-schedule template
 * cache (quick task 260905-tll Task 1, C-11/C-12/C-13). Templates are
 * Team 254's own pre-computed balanced schedules, cached locally by
 * `scripts/fetchScheduleTemplates.ts` into `data/schedule-templates/` and
 * NEVER committed — the upstream licence is Team 254's own custom licence
 * (not MIT) and grants redistribution only for contributing back upstream;
 * see the fetch script's header for the full statement.
 *
 * A pure Node module: no I/O beyond `readFileSync`/`existsSync`, no
 * network, no clock. There is no silent degrade path and no fabricated
 * schedule anywhere in this module — a missing cache file throws
 * `ScheduleTemplateMissingError` naming the exact path and the fetch
 * script (C-11), and a malformed cache line throws
 * `ScheduleTemplateParseError` naming the file and line number rather than
 * producing an off-by-one schedule. The ONE exception is a wholly absent
 * cache directory, which falls back to the committed
 * `SCHEDULE_TEMPLATE_FIXTURE_DIR` grid — see that constant for why that is
 * a CI affordance rather than a degrade path.
 *
 * A positive fact about template geometry, stated here rather than
 * rediscovered per caller: a template's row count is
 * `ceil(numTeams * matchesPerTeam / 6)` — six slots per match — and can
 * therefore differ from a real event's qualification-match count by a row
 * or two. That is harmless for a synthetic schedule: the pre-schedule
 * sidecar prices "a plausible schedule of about this shape", not a
 * reproduction of any specific event's real match list.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The template cache's root, a literal relative path resolved against
 * `process.cwd()` — the same discipline `packages/ingest/cli.ts`'s
 * `CORPUS_PATH` ("data/corpus.sqlite") already uses for the repo's other
 * gitignored `data/*` artifact. Every pipeline entry point runs from the
 * repo root, so a bare relative path is the established convention here,
 * not an oversight.
 */
export const SCHEDULE_TEMPLATE_DIR = "data/schedule-templates";

/**
 * A three-cell stand-in grid that IS committed, consulted only when the
 * production cache directory above does not exist at all — in practice,
 * only on a machine that has never run `pnpm fetch:schedule-templates`,
 * which means CI.
 *
 * These CSVs are NOT Team 254's files and reproduce none of their content:
 * they are balanced schedules this repo generated for itself, verified
 * distinct from the upstream cache byte-for-byte, covering exactly the
 * three grid cells (6x1, 6x2, 8x2) that `publish.test.ts`'s synthetic
 * `publishSeasons` fixtures reach through `buildPreScheduleSidecarForEvent`.
 * Being ours, they are ours to commit — which is the whole point: without
 * them CI could only SKIP those 16 tests, silently retiring the presim
 * sidecar gate and the `publishSeasons`/`--event` parity gate that exist
 * to catch a cold-publish regression.
 *
 * Deliberately a fallback for a WHOLLY ABSENT directory, never a
 * per-file one. On a machine that HAS the cache, a missing individual cell
 * still throws `ScheduleTemplateMissingError` exactly as before, so a
 * half-fetched cache can never be masked by this. And 6- and 8-team fields
 * are far below any real FRC event, so no real publish can quietly land
 * here even if the fallback did engage.
 */
export const SCHEDULE_TEMPLATE_FIXTURE_DIR = "packages/harness/fixtures/schedule-templates";

/**
 * Resolved once per process, not per load: the answer cannot change
 * mid-run (nothing in this pipeline creates the cache directory while it
 * is running), and re-`existsSync`-ing on every one of a full-season
 * publish's hundreds of template loads would be pure syscall overhead.
 */
let resolvedTemplateDir: string | undefined;
function templateDir(): string {
  resolvedTemplateDir ??= existsSync(SCHEDULE_TEMPLATE_DIR) ? SCHEDULE_TEMPLATE_DIR : SCHEDULE_TEMPLATE_FIXTURE_DIR;
  return resolvedTemplateDir;
}

/** The grid `scripts/fetchScheduleTemplates.ts` mirrors: team counts 6..100, matches-per-team 1..14. */
const MIN_TEMPLATE_TEAMS = 6;
const MAX_TEMPLATE_TEAMS = 100;

/**
 * C-11's loud failure: the cache file for a `(numTeams, matchesPerTeam)`
 * pair inside the servable range does not exist on disk. This is an
 * OPERATOR problem (the cache was never fetched, or was partially
 * fetched), never an event-shape problem — callers must let this
 * propagate and fail the run, in contrast to
 * `ScheduleTemplateUnavailableError` below.
 */
export class ScheduleTemplateMissingError extends Error {
  constructor(path: string) {
    super(
      `scheduleTemplates: template cache file "${path}" is missing — run \`pnpm fetch:schedule-templates\` to populate the local cache (data/schedule-templates/ is gitignored and never committed; see scripts/fetchScheduleTemplates.ts for why)`
    );
    this.name = "ScheduleTemplateMissingError";
  }
}

/**
 * A team count the template grid cannot serve at all: fewer than 6 teams,
 * or a split block (see `loadScheduleTemplate`'s above-100 handling) that
 * still falls outside 6..100. Distinguishable from
 * `ScheduleTemplateMissingError` BY TYPE, deliberately — a caller is
 * expected to catch this one and skip the event, while the missing-file
 * case must fail the whole run.
 */
export class ScheduleTemplateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleTemplateUnavailableError";
  }
}

/**
 * A cache line that does not parse into twelve finite integers, or that
 * carries a slot index outside `1..numTeams`, or a surrogate flag that is
 * neither 0 nor 1. Names the file and the one-based line number — a
 * tampered or truncated cache entry must fail loudly rather than produce
 * an off-by-one schedule (threat T-tll-01).
 */
export class ScheduleTemplateParseError extends Error {
  constructor(path: string, lineNumber: number, detail: string) {
    super(`scheduleTemplates: malformed template line — ${path}:${lineNumber}: ${detail}`);
    this.name = "ScheduleTemplateParseError";
  }
}

/**
 * One template match: `red`/`blue` are three ZERO-BASED slot indices into
 * a (shuffled) team list — converted on read from the cache's one-based
 * encoding — and `redSurrogate`/`blueSurrogate` flag, positionally, which
 * of those three slots is a surrogate appearance (plays the match, earns
 * no ranking credit — PD-03).
 */
export interface ScheduleTemplateMatch {
  readonly red: readonly number[];
  readonly blue: readonly number[];
  readonly redSurrogate: readonly boolean[];
  readonly blueSurrogate: readonly boolean[];
}

/**
 * C-12: cheesy-arena's own matches-per-team derivation from a real
 * schedule's shape — `trunc(qualMatchCount * 6 / numTeams)`, TRUNCATED
 * (cheesy-arena `tournament/schedule.go`'s own convention; CONTEXT.md's
 * earlier "round" phrasing is superseded by the upstream convention),
 * clamped into the closed interval 1..14 (the template grid's own range).
 */
export function matchesPerTeamFor(numTeams: number, qualMatchCount: number): number {
  const truncated = Math.trunc((qualMatchCount * 6) / numTeams);
  return Math.min(14, Math.max(1, truncated));
}

/**
 * C-12: the matches-per-team to assume when the real schedule is unknown —
 * 10 for TBA event type 3 (Championship Division), 12 otherwise. This is
 * the Statbotics convention, named here as the source rather than invented.
 */
export function defaultMatchesPerTeam(eventType: number): number {
  return eventType === 3 ? 10 : 12;
}

/**
 * Parsed-template memo, keyed `{numTeams}_{matchesPerTeam}` — a
 * full-season publish loads the same handful of templates hundreds of
 * times, and the parse is pure, so parsing each file once is free
 * correctness-wise. Only direct (6..100) loads are memoized; the split
 * path below composes fresh objects from two memoized blocks, so nothing
 * a caller receives from the split path aliases a memoized entry's own
 * match objects with mutated indices.
 */
const templateMemo = new Map<string, readonly ScheduleTemplateMatch[]>();

/** The twelve-column cache layout: red1,red1Surrogate,red2,red2Surrogate,red3,red3Surrogate,blue1,... — team values ONE-BASED, surrogate values 1 or 0. */
function parseTemplateFile(path: string, raw: string, numTeams: number): ScheduleTemplateMatch[] {
  const matches: ScheduleTemplateMatch[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue; // a trailing newline is not a malformed row
    const lineNumber = i + 1;
    const parts = line.split(",");
    if (parts.length !== 12) {
      throw new ScheduleTemplateParseError(path, lineNumber, `expected 12 comma-separated values, found ${parts.length}`);
    }
    const values = parts.map((part) => Number(part.trim()));
    for (const value of values) {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new ScheduleTemplateParseError(path, lineNumber, `value "${String(value)}" is not a finite integer`);
      }
    }
    const red: number[] = [];
    const blue: number[] = [];
    const redSurrogate: boolean[] = [];
    const blueSurrogate: boolean[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const teamOneBased = values[slot * 2]!;
      const surrogateFlag = values[slot * 2 + 1]!;
      if (teamOneBased < 1 || teamOneBased > numTeams) {
        throw new ScheduleTemplateParseError(
          path,
          lineNumber,
          `slot index ${teamOneBased} is outside 1..${numTeams}`
        );
      }
      if (surrogateFlag !== 0 && surrogateFlag !== 1) {
        throw new ScheduleTemplateParseError(path, lineNumber, `surrogate flag ${surrogateFlag} is neither 0 nor 1`);
      }
      // Cache encoding is one-based; everything downstream of this module is zero-based.
      const teamZeroBased = teamOneBased - 1;
      if (slot < 3) {
        red.push(teamZeroBased);
        redSurrogate.push(surrogateFlag === 1);
      } else {
        blue.push(teamZeroBased);
        blueSurrogate.push(surrogateFlag === 1);
      }
    }
    matches.push({ red, blue, redSurrogate, blueSurrogate });
  }
  return matches;
}

/** Direct (6..100) load: reads and memoizes `{numTeams}_{matchesPerTeam}.csv`. */
function loadTemplateFileDirect(numTeams: number, matchesPerTeam: number): readonly ScheduleTemplateMatch[] {
  const memoKey = `${numTeams}_${matchesPerTeam}`;
  const memoized = templateMemo.get(memoKey);
  if (memoized !== undefined) return memoized;

  const path = join(templateDir(), `${numTeams}_${matchesPerTeam}.csv`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err !== null && typeof err === "object" && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ScheduleTemplateMissingError(path);
    }
    throw err;
  }
  const parsed = parseTemplateFile(path, raw, numTeams);
  templateMemo.set(memoKey, parsed);
  return parsed;
}

/**
 * Loads the template for `numTeams` at `matchesPerTeam` matches per team.
 *
 * Team-count coverage (C-13): a `numTeams` in 6..100 reads
 * `{numTeams}_{matchesPerTeam}.csv` directly. Above 100, the grid has no
 * file, so the field is split into two blocks of `ceil(n/2)` and
 * `floor(n/2)`, each loaded independently, every index in the second block
 * offset by the first block's team count, and the two match lists
 * concatenated — the nearest-template/split trick, producing a schedule
 * where every team still appears the right number of times, at the cost of
 * the two halves never crossing over. Throws
 * `ScheduleTemplateUnavailableError` when `numTeams` is below 6 or when a
 * split block still falls outside 6..100 (i.e. `numTeams > 200`).
 */
export function loadScheduleTemplate(numTeams: number, matchesPerTeam: number): readonly ScheduleTemplateMatch[] {
  if (numTeams < MIN_TEMPLATE_TEAMS) {
    throw new ScheduleTemplateUnavailableError(
      `scheduleTemplates: ${numTeams} teams is below the ${MIN_TEMPLATE_TEAMS}-team minimum the template grid can serve`
    );
  }
  if (numTeams <= MAX_TEMPLATE_TEAMS) {
    return loadTemplateFileDirect(numTeams, matchesPerTeam);
  }

  const firstBlockTeams = Math.ceil(numTeams / 2);
  const secondBlockTeams = Math.floor(numTeams / 2);
  if (firstBlockTeams > MAX_TEMPLATE_TEAMS || secondBlockTeams < MIN_TEMPLATE_TEAMS) {
    throw new ScheduleTemplateUnavailableError(
      `scheduleTemplates: ${numTeams} teams splits into blocks of ${firstBlockTeams} and ${secondBlockTeams}, at least one of which falls outside the servable ${MIN_TEMPLATE_TEAMS}..${MAX_TEMPLATE_TEAMS} range`
    );
  }

  const firstBlock = loadTemplateFileDirect(firstBlockTeams, matchesPerTeam);
  const secondBlock = loadTemplateFileDirect(secondBlockTeams, matchesPerTeam);

  const combined: ScheduleTemplateMatch[] = firstBlock.map((match) => ({
    red: [...match.red],
    blue: [...match.blue],
    redSurrogate: [...match.redSurrogate],
    blueSurrogate: [...match.blueSurrogate],
  }));
  for (const match of secondBlock) {
    combined.push({
      red: match.red.map((index) => index + firstBlockTeams),
      blue: match.blue.map((index) => index + firstBlockTeams),
      redSurrogate: [...match.redSurrogate],
      blueSurrogate: [...match.blueSurrogate],
    });
  }
  return combined;
}
