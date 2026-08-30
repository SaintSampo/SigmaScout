/**
 * One-off cleanup: deletes the orphaned pre-exclusion demo-team-season R2
 * objects (`.planning/todos/completed/exclude-offseason-demo-teams-SUMMARY.md`,
 * "gap 2" — a known residual that SUMMARY explicitly disclosed, not fixed,
 * since R2 has no cascading delete and `publishSeasons` only ever PUTs keys
 * it is asked to build). The prior generation wrote `team/{teamKey}/{year}`
 * objects for all 30 `frc9970`-`frc9999` "Off-Season Demo Team" keys before
 * the exclusion landed; those objects still physically exist in the bucket,
 * reachable only by guessing their exact old URL, absent from every list a
 * real page navigates through.
 *
 * The key set is small, closed, and fully deterministic — 30 demo team keys
 * (`demoTeams.ts`'s `DEMO_TEAM_KEYS`, `frc9970`-`frc9999`) x `SEASONS`
 * (2022-2026) x the three currently-published algorithm/version pairs
 * (`resolveLiveAlgorithmVersions`, which reproduces `publish.ts`'s own
 * `resolvePublishAlgorithms(undefined)` resolution — never a second,
 * independently-typed version string). No corpus read, no live query: this
 * is pure arithmetic over fixed constants, unlike
 * `scripts/deleteRetiredAlgorithmObjects.ts`'s corpus-derived enumeration.
 *
 * Every key is built through `artifactKey`, never hand-constructed. Two
 * mechanical guards make this tool structurally unable to widen its own
 * scope:
 *
 *   - `NonDemoKeySegmentError` — every enumerated key's `team/{teamKey}/`
 *     segment is asserted to be a genuine member of `DEMO_TEAM_KEYS` before
 *     it is trusted. A bug in the Cartesian-product construction above
 *     would otherwise risk widening the delete set to a real team.
 *   - `UnexpectedKeyCountError` — the enumerated count is asserted to equal
 *     `EXPECTED_CANDIDATE_KEY_COUNT` EXACTLY (not a band, since this
 *     enumeration has no corpus dependency to drift against) before
 *     anything is deleted.
 *
 * Reuses `deleteRetiredAlgorithmObjects.ts`'s safety shape otherwise: no
 * bulk/prefix delete capability (every credentialed call goes through
 * `r2Client.ts`'s `deleteObject`, one key at a time), a dry-run-by-default
 * CLI (`--execute` is required to actually delete anything — the
 * destructive target here has no operator-supplied name to force explicit
 * intent through, unlike `--retired-id`, so the intent gate is this flag
 * instead), and read-back verification rather than trusting a 2xx from the
 * delete call alone (`deleteObject`'s DELETE is idempotent by S3 contract, so
 * a 404 observed before the delete pass even runs would look identical to a
 * successful delete). A full census (not a stratified sample) is affordable
 * here — the whole candidate set is 450 keys, not the retired-algorithm
 * tool's ~19,261.
 *
 * This file never reads `.env` itself, never reads `process.env` directly,
 * and never prints, logs, or interpolates a credential value — the same
 * discipline `deleteRetiredAlgorithmObjects.ts` documents for itself.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { DEMO_TEAM_KEYS, isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { artifactKey } from "../packages/harness/pageArtifacts.js";
import { deleteObject } from "../packages/harness/r2Client.js";
import { DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh } from "./verifySubsetPublish.js";

const DEFAULT_BUCKET = "sigmascout-artifacts";

/** The five published seasons this project's `pnpm publish:seasons` covers (`--seasons 2022-2026`) — the same range the pre-exclusion generation wrote demo-team objects under. */
export const SEASONS = [2022, 2023, 2024, 2025, 2026] as const;

/** 30 demo team keys x 5 seasons x 3 published algorithms — the exact, fully-deterministic candidate count. No corpus, no live query: pure arithmetic over fixed constants, so this bound is checked for EQUALITY, not a band. */
export const EXPECTED_CANDIDATE_KEY_COUNT = DEMO_TEAM_KEYS.size * SEASONS.length * 3;

export class UnexpectedKeyCountError extends Error {
  constructor(observed: number, expected: number) {
    super(
      `deleteOrphanedDemoTeamObjects: enumerated ${observed} keys, expected EXACTLY ${expected} ` +
        `(${DEMO_TEAM_KEYS.size} demo keys x ${SEASONS.length} seasons x 3 algorithms). This enumeration is pure ` +
        `arithmetic over fixed constants — any deviation means SEASONS, DEMO_TEAM_KEYS, or the resolved algorithm ` +
        `list drifted from what this tool assumes. Aborting before any delete.`
    );
    this.name = "UnexpectedKeyCountError";
  }
}

export class NonDemoKeySegmentError extends Error {
  constructor(key: string, teamKey: string | undefined) {
    super(
      `deleteOrphanedDemoTeamObjects: enumerated key "${key}" carries team key "${teamKey ?? "(unparseable)"}", ` +
        `which is NOT one of the 30 off-season demo team keys (frc9970-frc9999) — refusing to include it in the ` +
        `delete set. A bug here would risk deleting a real team's published page.`
    );
    this.name = "NonDemoKeySegmentError";
  }
}

export interface AlgorithmVersion {
  readonly id: string;
  readonly version: string;
}

/** Reproduces `publish.ts`'s own `resolvePublishAlgorithms(undefined)` resolution (the promoted VPR override included) — never a second, independently-typed version string that could silently drift from what is actually live. */
export function resolveLiveAlgorithmVersions(): AlgorithmVersion[] {
  return resolvePublishAlgorithms(undefined).map((a) => ({ id: a.id, version: a.version }));
}

/**
 * Builds every candidate `v1/team/{demoKey}/{year}/{algorithmId}@{version}.json`
 * key — the deterministic 30 x `SEASONS` x `algorithmVersions` Cartesian
 * product. Every key is built through `artifactKey`, never hand-constructed;
 * every key's team-key segment is asserted to be a genuine demo key
 * (`NonDemoKeySegmentError`) before being trusted; the total is asserted
 * against `EXPECTED_CANDIDATE_KEY_COUNT` (`UnexpectedKeyCountError`) before
 * any caller sees the list.
 */
export function enumerateOrphanedDemoTeamKeys(algorithmVersions: readonly AlgorithmVersion[]): string[] {
  const keys: string[] = [];
  for (const season of SEASONS) {
    for (const { id, version } of algorithmVersions) {
      for (const teamKey of DEMO_TEAM_KEYS) {
        keys.push(artifactKey({ page: "team", teamKey, year: season, algorithmId: id, version }));
      }
    }
  }

  for (const key of keys) {
    const match = /^v1\/team\/([^/]+)\//.exec(key);
    const teamKey = match?.[1];
    if (!teamKey || !isDemoTeamKey(teamKey)) {
      throw new NonDemoKeySegmentError(key, teamKey);
    }
  }

  if (keys.length !== EXPECTED_CANDIDATE_KEY_COUNT) {
    throw new UnexpectedKeyCountError(keys.length, EXPECTED_CANDIDATE_KEY_COUNT);
  }

  return keys;
}

/**
 * One real, currently-published team-season key per algorithm — fetched
 * BEFORE and AFTER the delete pass and asserted 200 both times, so this tool
 * can testify (from real reads, never assumed) that it touched nothing
 * outside the demo-key set. `frc3538/2024` is the same control key the
 * orchestrator verified live against the origin before this tool was
 * written.
 */
export function buildControlKeys(algorithmVersions: readonly AlgorithmVersion[]): string[] {
  return algorithmVersions.map(({ id, version }) => artifactKey({ page: "team", teamKey: "frc3538", year: 2024, algorithmId: id, version }));
}

export interface CensusRow {
  readonly key: string;
  readonly status: number;
}

async function censusKeys(origin: string, keys: readonly string[], runId: string): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  for (const key of keys) {
    const fetched = await fetchArtifactFresh(origin, key, runId);
    rows.push({ key, status: fetched.status });
    console.log(`  census: ${key} -> ${fetched.status}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bounded-concurrency delete pass — never invoked unless --execute is passed.
// ---------------------------------------------------------------------------

async function deleteKeys(bucket: string, keys: readonly string[], concurrency: number): Promise<number> {
  let completed = 0;
  let active = 0;
  const queue: (() => void)[] = [];

  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  }

  await Promise.all(
    keys.map((key) =>
      withSlot(async () => {
        await deleteObject(bucket, key);
        completed++;
        if (completed % 50 === 0) console.log(`deleteOrphanedDemoTeamObjects: ${completed}/${keys.length} deletes issued`);
      })
    )
  );
  return completed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  readonly execute: boolean;
  readonly concurrency: number;
  readonly bucket: string;
  readonly origin: string;
}

/** `--execute` has NO default and defaults to `false` — the destructive target here has no operator-supplied name (unlike `deleteRetiredAlgorithmObjects.ts`'s required `--retired-id`) to force explicit intent through, so this flag is that gate instead: omitting it always runs the census-only path, no matter what else is passed. */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      execute: { type: "boolean" },
      concurrency: { type: "string" },
      bucket: { type: "string" },
      origin: { type: "string" },
    },
  });
  return {
    execute: values.execute === true,
    concurrency: values.concurrency !== undefined ? Number.parseInt(values.concurrency, 10) : 16,
    bucket: values.bucket ?? DEFAULT_BUCKET,
    origin: values.origin ?? DEFAULT_ARTIFACT_ORIGIN,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const algorithmVersions = resolveLiveAlgorithmVersions();
  const keys = enumerateOrphanedDemoTeamKeys(algorithmVersions);
  const controlKeys = buildControlKeys(algorithmVersions);

  console.log(
    `deleteOrphanedDemoTeamObjects: enumerated ${keys.length} candidate keys (expected exactly ${EXPECTED_CANDIDATE_KEY_COUNT}), ` +
      `algorithms: ${algorithmVersions.map((a) => `${a.id}@${a.version}`).join(", ")}`
  );

  const beforeRunId = randomUUID();
  console.log(`deleteOrphanedDemoTeamObjects: pre-delete census of all ${keys.length} candidate keys against ${options.origin}...`);
  const before = await censusKeys(options.origin, keys, beforeRunId);
  const presentBefore = before.filter((r) => r.status === 200);
  console.log(`deleteOrphanedDemoTeamObjects: ${presentBefore.length} of ${keys.length} candidates present (200) before any delete.`);

  console.log(`deleteOrphanedDemoTeamObjects: pre-delete census of ${controlKeys.length} control key(s)...`);
  const controlsBefore = await censusKeys(options.origin, controlKeys, beforeRunId);
  for (const row of controlsBefore) {
    if (row.status !== 200) {
      throw new Error(
        `deleteOrphanedDemoTeamObjects: FATAL — control key "${row.key}" did not return 200 BEFORE any delete ` +
          `(status ${row.status}). Aborting — either the census is not observing what this tool expects, or the ` +
          `control page itself is missing; every absence proof this tool produces is worthless until this is fixed.`
      );
    }
  }

  mkdirSync("reports/publish", { recursive: true });
  writeFileSync(
    "reports/publish/gap2-census-before.json",
    JSON.stringify({ candidateCount: keys.length, presentBefore: presentBefore.length, before, controlsBefore }, null, 2)
  );
  console.log(`deleteOrphanedDemoTeamObjects: pre-delete census saved to reports/publish/gap2-census-before.json`);

  if (!options.execute) {
    console.log(`deleteOrphanedDemoTeamObjects: --execute not passed — deleting nothing. Re-run with --execute to perform the real delete pass.`);
    return;
  }

  console.log(`deleteOrphanedDemoTeamObjects: DELETE pass — issuing ${keys.length} idempotent deletes (concurrency ${options.concurrency})...`);
  const completed = await deleteKeys(options.bucket, keys, options.concurrency);
  console.log(`deleteOrphanedDemoTeamObjects: DONE — ${completed} deletes issued.`);

  const afterRunId = randomUUID();
  console.log(`deleteOrphanedDemoTeamObjects: post-delete read-back census of all ${keys.length} candidate keys...`);
  const after = await censusKeys(options.origin, keys, afterRunId);
  const stillPresent = after.filter((r) => r.status === 200);

  console.log(`deleteOrphanedDemoTeamObjects: post-delete census of ${controlKeys.length} control key(s)...`);
  const controlsAfter = await censusKeys(options.origin, controlKeys, afterRunId);
  const brokenControls = controlsAfter.filter((r) => r.status !== 200);

  writeFileSync(
    "reports/publish/gap2-census-after.json",
    JSON.stringify({ candidateCount: keys.length, stillPresent: stillPresent.length, after, controlsAfter }, null, 2)
  );
  console.log(`deleteOrphanedDemoTeamObjects: post-delete census saved to reports/publish/gap2-census-after.json`);

  if (stillPresent.length > 0) {
    throw new Error(
      `deleteOrphanedDemoTeamObjects: FATAL — ${stillPresent.length} of ${keys.length} candidate keys still return ` +
        `200 AFTER the delete pass: ${stillPresent.map((r) => r.key).join(", ")}`
    );
  }
  if (brokenControls.length > 0) {
    throw new Error(
      `deleteOrphanedDemoTeamObjects: FATAL — ${brokenControls.length} control key(s) no longer return 200 after the ` +
        `delete pass: ${brokenControls.map((r) => r.key).join(", ")}. This tool's own scope guards should have made ` +
        `this impossible — investigate before trusting anything else it did.`
    );
  }

  console.log(
    `deleteOrphanedDemoTeamObjects: PASSED — 0/${keys.length} candidate keys remain present, all ${controlKeys.length} control key(s) still return 200.`
  );
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("deleteOrphanedDemoTeamObjects failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
