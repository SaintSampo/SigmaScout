/**
 * One-command re-baseline: ingest -> Worker deploy -> publish -> D1 seed ->
 * verify -> prune superseded generations.
 *
 *   pnpm rebaseline                  (the whole chain, current season)
 *   pnpm rebaseline --year 2026
 *   pnpm rebaseline --skip-ingest --skip-deploy
 *   pnpm rebaseline --from seed      (resume: ingest | deploy | publish | seed | verify | prune)
 *
 * WHY THE ORDER. The Worker deploys BEFORE the publish: a new manifest can
 * carry probe windows and a state-baseline contract an older Worker does not
 * understand, while a newer Worker facing an older seed only refuses to fold
 * (`state-generation-mismatch`) until the seed lands. The four seed files go
 * in the order `publish:seasons` wrote them, `seed-cursors.sql` last, because
 * that file carries the markers that switch folding back on. See
 * docs/worker-operations.md "Re-baselining".
 *
 * A step that fails stops the chain and prints the `--from` flag that resumes
 * it. The prune is the one soft step: `pruneR2Generations.ts` refuses a
 * generation written within its recent-write window, which is every
 * generation this same run just superseded, so a refusal there is reported
 * and the run still exits 0. The window is six hours: rerun `pnpm rebaseline --from prune` after it.
 *
 * Credentials never pass through this file. Every child reads `.env` itself
 * (`tsx --env-file`, `wrangler --env-file`); nothing here reads the
 * environment or echoes a value from it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const STEPS = ["ingest", "deploy", "publish", "seed", "verify", "prune"] as const;
type Step = (typeof STEPS)[number];

const REPO_ROOT = resolve(import.meta.dirname, "..");
const ARTIFACT_ORIGIN = "https://data.sigmascout.org";
const D1_DATABASE = "sigmascout-state";
const SEED_DIR = "reports/publish";
/** Applied in this order; the cursors file must be last (it carries the state-baseline markers). */
const SEED_FILES = ["seed-opr.sql", "seed-epa.sql", "seed-spr.sql", "seed-cursors.sql"] as const;
/** Where the pre-publish manifest is parked so `--from prune` on a later day still knows what was superseded. */
const SUPERSEDED_PATH = resolve(REPO_ROOT, SEED_DIR, "rebaseline-superseded.json");
const INGEST_PASSES = ["", "--rankings-only", "--alliances-only", "--event-teams-only", "--awards-only"] as const;

interface ManifestAlgorithm {
  readonly id: string;
  readonly version: string;
}
interface AlgorithmsManifest {
  readonly generation: string;
  readonly algorithms: readonly ManifestAlgorithm[];
}

class StepFailure extends Error {
  constructor(
    readonly step: Step,
    detail: string
  ) {
    super(`${step}: ${detail}`);
  }
}

function run(step: Step, command: string, cwd: string = REPO_ROOT): void {
  console.log(`\n[rebaseline:${step}] ${command}`);
  const result = spawnSync(command, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new StepFailure(step, `"${command}" exited ${result.status ?? result.signal}`);
}

async function fetchManifest(): Promise<AlgorithmsManifest> {
  const response = await fetch(`${ARTIFACT_ORIGIN}/v1/manifest/algorithms.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`algorithms manifest returned ${response.status}`);
  return (await response.json()) as AlgorithmsManifest;
}

function generationKeys(manifest: AlgorithmsManifest): string[] {
  return manifest.algorithms.map((a) => `${a.id}@${a.version}`);
}

function ingest(year: number): void {
  for (const pass of INGEST_PASSES) {
    const scope = pass === "" ? `--year ${year}` : `${pass} --years ${year}-${year}`;
    run("ingest", `npx tsx --env-file=.env packages/ingest/cli.ts ${scope}`);
  }
}

function seed(): void {
  for (const file of SEED_FILES) {
    const path = `${SEED_DIR}/${file}`;
    if (!existsSync(resolve(REPO_ROOT, path))) throw new StepFailure("seed", `${path} is missing — run the publish step first`);
    const command = `npx wrangler d1 execute ${D1_DATABASE} --remote --env-file .env --file ${path}`;
    try {
      run("seed", command);
    } catch {
      // `--file` uploads then imports as two steps; a first call can fail after the upload and a
      // second then succeeds with "File already uploaded" (docs/worker-operations.md).
      console.log(`[rebaseline:seed] ${file} failed once, retrying`);
      run("seed", command);
    }
  }
}

async function verify(before: AlgorithmsManifest | undefined): Promise<void> {
  const after = await fetchManifest();
  console.log(`\n[rebaseline:verify] live generation ${after.generation}: ${generationKeys(after).join(", ")}`);
  if (before !== undefined && before.generation === after.generation) {
    throw new StepFailure("verify", `the live manifest generation is still ${before.generation} — the publish did not land`);
  }
  const windows = (await (await fetch(`${ARTIFACT_ORIGIN}/v1/manifest/live-windows.json`, { cache: "no-store" })).json()) as {
    generation: string;
    windows: { eventKey: string; startMs: number; endMs: number; inferred: boolean }[];
  };
  if (windows.generation !== after.generation) {
    throw new StepFailure("verify", `live-windows generation ${windows.generation} differs from algorithms ${after.generation}`);
  }
  const now = Date.now();
  const open = windows.windows.filter((w) => w.startMs <= now && now < w.endMs);
  console.log(`[rebaseline:verify] ${windows.windows.length} windows, ${open.length} open now (${open.filter((w) => w.inferred).length} probe-only)`);
  console.log("[rebaseline:verify] if `wrangler tail` shows state-generation-mismatch after this point, the seed did not land: rerun --from seed");
}

async function prune(): Promise<void> {
  if (!existsSync(SUPERSEDED_PATH)) {
    console.log("[rebaseline:prune] no superseded-generation record; nothing to prune");
    return;
  }
  const recorded = JSON.parse(readFileSync(SUPERSEDED_PATH, "utf8")) as string[];
  const live = new Set(generationKeys(await fetchManifest()));
  const orphans = recorded.filter((key) => !live.has(key));
  if (orphans.length === 0) {
    console.log("[rebaseline:prune] every recorded generation is still live (same-version republish overwrites in place); nothing to prune");
    return;
  }
  const flags = orphans.map((key) => `--generation "${key}"`).join(" ");
  try {
    run("prune", `npx tsx --env-file=.env scripts/pruneR2Generations.ts ${flags} --execute`);
    writeFileSync(SUPERSEDED_PATH, "[]\n", "utf8");
  } catch (error) {
    console.log(`[rebaseline:prune] NOT pruned: ${(error as Error).message}`);
    console.log("[rebaseline:prune] expected right after a publish (the six-hour recent-write guard). Rerun `pnpm rebaseline --from prune` once it has passed.");
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      year: { type: "string" },
      from: { type: "string" },
      "skip-ingest": { type: "boolean", default: false },
      "skip-deploy": { type: "boolean", default: false },
      "skip-prune": { type: "boolean", default: false },
    },
  });
  const year = values.year === undefined ? new Date().getUTCFullYear() : Number(values.year);
  if (!Number.isInteger(year)) throw new Error(`--year must be an integer, got "${values.year}"`);
  const from = (values.from ?? "ingest") as Step;
  if (!STEPS.includes(from)) throw new Error(`--from must be one of ${STEPS.join(", ")}`);

  const skipped = new Set<Step>(STEPS.slice(0, STEPS.indexOf(from)));
  if (values["skip-ingest"]) skipped.add("ingest");
  if (values["skip-deploy"]) skipped.add("deploy");
  if (values["skip-prune"]) skipped.add("prune");
  const wants = (step: Step): boolean => !skipped.has(step);

  let before: AlgorithmsManifest | undefined;
  if (wants("publish")) {
    // Whatever the PREVIOUS run could not prune (the six-hour guard) is old enough by now, so no
    // run ever leaves a cleanup owed to a person: the next one collects it before adding its own.
    if (wants("prune")) await prune();
    before = await fetchManifest();
    // Merge, never overwrite: a second run before the first one's prune must not forget its orphans.
    const prior = existsSync(SUPERSEDED_PATH) ? (JSON.parse(readFileSync(SUPERSEDED_PATH, "utf8")) as string[]) : [];
    writeFileSync(SUPERSEDED_PATH, `${JSON.stringify([...new Set([...prior, ...generationKeys(before)])], null, 2)}\n`, "utf8");
  }

  if (wants("ingest")) ingest(year);
  if (wants("deploy")) run("deploy", "npx wrangler deploy", resolve(REPO_ROOT, "apps/worker"));
  if (wants("publish")) run("publish", "pnpm publish:seasons");
  if (wants("seed")) seed();
  if (wants("verify")) await verify(before);
  if (wants("prune")) await prune();

  console.log("\n[rebaseline] done. Commit docs/publish-budget.md if the publish rewrote it.");
}

main().catch((error: unknown) => {
  console.error(`\n[rebaseline] FAILED ${(error as Error).message}`);
  if (error instanceof StepFailure) console.error(`[rebaseline] resume with: pnpm rebaseline --from ${error.step}`);
  process.exitCode = 1;
});
