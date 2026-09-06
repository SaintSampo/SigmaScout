/**
 * Populates the gitignored `data/schedule-templates/` cache (quick task
 * 260905-tll Task 1, C-11) with Team 254's cheesy-arena qualification
 * schedule templates: the complete 6..100-teams by 1..14-matches-per-team
 * grid (1,330 CSVs) plus the upstream `LICENSE`, fetched from
 * `raw.githubusercontent.com/Team254/cheesy-arena`.
 *
 * WHY the CSVs are cached and never committed: the upstream licence is
 * Team 254's OWN custom licence, NOT MIT, and it grants redistribution
 * only for the purpose of contributing back upstream. SigmaScout is a
 * public repository, so committing the templates would be redistribution
 * outside that grant. Caching them locally for this machine's own pipeline
 * runs is use, not redistribution — Statbotics fetches these same files at
 * runtime for the same reason. `.gitignore`'s `data/*` rule keeps the
 * cache out of git; this script exists so any other machine can rebuild it
 * with one command (`pnpm fetch:schedule-templates`).
 *
 * Idempotent: any file already present on disk is skipped, so an
 * interrupted run resumes where it left off. Standalone-script shape
 * matches `scripts/publishAlgorithmsManifest.ts`: `parseArgs` from
 * `node:util`, deep relative imports with explicit `.js` extensions, a
 * `main()` guarded on being the process entry point, non-zero exit on
 * failure. Credential-free — these are public raw.githubusercontent.com
 * URLs; this script never reads `.env` or `process.env` at all.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { SCHEDULE_TEMPLATE_DIR } from "../packages/harness/scheduleTemplates.js";

const UPSTREAM_BASE = "https://raw.githubusercontent.com/Team254/cheesy-arena/main";

/** The grid `packages/harness/scheduleTemplates.ts` serves: team counts 6..100, matches-per-team 1..14. */
const MIN_TEAMS = 6;
const MAX_TEAMS = 100;
const MIN_MATCHES_PER_TEAM = 1;
const MAX_MATCHES_PER_TEAM = 14;

interface FetchSummary {
  fetched: number;
  skipped: number;
}

async function fetchToFile(url: string, destination: string, summary: FetchSummary): Promise<void> {
  if (existsSync(destination)) {
    summary.skipped += 1;
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetchScheduleTemplates: GET ${url} -> HTTP ${res.status}`);
  }
  const body = await res.text();
  writeFileSync(destination, body, "utf8");
  summary.fetched += 1;
}

export async function run(): Promise<FetchSummary> {
  mkdirSync(SCHEDULE_TEMPLATE_DIR, { recursive: true });
  const summary: FetchSummary = { fetched: 0, skipped: 0 };

  // The upstream repo-root LICENSE first — the cache must never exist
  // without the licence text that governs it sitting alongside.
  await fetchToFile(`${UPSTREAM_BASE}/LICENSE`, join(SCHEDULE_TEMPLATE_DIR, "LICENSE"), summary);

  for (let numTeams = MIN_TEAMS; numTeams <= MAX_TEAMS; numTeams++) {
    for (let matchesPerTeam = MIN_MATCHES_PER_TEAM; matchesPerTeam <= MAX_MATCHES_PER_TEAM; matchesPerTeam++) {
      const fileName = `${numTeams}_${matchesPerTeam}.csv`;
      await fetchToFile(`${UPSTREAM_BASE}/schedules/${fileName}`, join(SCHEDULE_TEMPLATE_DIR, fileName), summary);
    }
    console.log(
      `fetchScheduleTemplates: ${numTeams}-team column done (${summary.fetched} fetched, ${summary.skipped} skipped so far)`
    );
  }

  console.log(
    `fetchScheduleTemplates: complete — ${summary.fetched} files fetched, ${summary.skipped} already present, into ${SCHEDULE_TEMPLATE_DIR}/`
  );
  return summary;
}

async function main(): Promise<void> {
  // No options today; parseArgs still runs so an unknown flag fails loudly
  // instead of being silently ignored (matches the repo's script convention).
  parseArgs({ args: process.argv.slice(2), options: {} });
  await run();
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("fetchScheduleTemplates failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
