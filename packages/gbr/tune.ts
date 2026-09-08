/**
 * Seeded random search over `runOrigin`'s hyperparameter space, scored on
 * origins 2022, 2023, 2024, 2025. Objective: mean winner accuracy across the
 * four origins, tie-broken on lower mean Brier — the same accuracy-primary,
 * Brier-secondary ordering this project already uses.
 *
 * P-7: fits only the head the objective reads — `--heads` defaults to
 * `"win"` here (evaluate.ts and holdout.ts default to `"all"`). Fitting all
 * three heads during search would triple the cost for information the
 * objective discards. This is a flag, not a hardcoded divergence: every
 * record in the output JSONL carries the `heads` value it was run with, so a
 * run's scope is never ambiguous.
 *
 * Like evaluate.ts, this file must never reference the seal-break option or
 * the sealed year set, comments included — `seal.test.ts`'s comment-stripped
 * source scan runs against this exact file too.
 *
 * This task runs only a `--configs 2 --quick` smoke. A real search is a
 * later, deliberate job, sized by evaluate.ts's reported per-fit timing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runOrigin, type RunOriginOptions } from "./evaluate.js";
import { mulberry32 } from "./gbdt.js";

function sampleUniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function sampleLogUniform(rng: () => number, lo: number, hi: number): number {
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  return Math.exp(logLo + rng() * (logHi - logLo));
}

function sampleInt(rng: () => number, lo: number, hi: number): number {
  return Math.min(hi, Math.floor(sampleUniform(rng, lo, hi + 1)));
}

function samplePick<T>(rng: () => number, options: readonly T[]): T {
  const idx = Math.min(options.length - 1, Math.floor(rng() * options.length));
  return options[idx]!;
}

interface SampledConfig {
  nTrees: number;
  maxDepth: number;
  learningRate: number;
  minChildWeight: number;
  lambda: number;
  subsample: number;
  colsampleByTree: number;
  halflife: 5 | 10 | 20;
  prevSeasonDecay: 0.3 | 0.6 | 0.9;
  seed: number;
}

/** The search space, transcribed verbatim from the plan's Task 3 action item 2. */
function sampleConfig(rng: () => number, configSeed: number): SampledConfig {
  return {
    nTrees: sampleInt(rng, 100, 500),
    maxDepth: sampleInt(rng, 3, 7),
    learningRate: sampleLogUniform(rng, 0.03, 0.2),
    minChildWeight: sampleLogUniform(rng, 1, 50),
    lambda: sampleLogUniform(rng, 0.1, 10),
    subsample: sampleUniform(rng, 0.6, 1),
    colsampleByTree: sampleUniform(rng, 0.6, 1),
    halflife: samplePick(rng, [5, 10, 20] as const),
    prevSeasonDecay: samplePick(rng, [0.3, 0.6, 0.9] as const),
    seed: configSeed,
  };
}

interface TuneRecord {
  config: SampledConfig;
  nTrees: number;
  heads: "win" | "all";
  origins: Record<number, { winnerAccuracy: number; brier: number }>;
  objective: number;
  meanBrier: number;
}

function getFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

interface CliArgs {
  configs: number;
  seed: number;
  quick: boolean;
  heads: "win" | "all";
  origins: number[];
}

function parseArgs(argv: string[]): CliArgs {
  const configsArg = getFlag(argv, "--configs");
  const configs = configsArg !== undefined ? Number(configsArg) : 20;
  const seedArg = getFlag(argv, "--seed");
  const seed = seedArg !== undefined ? Number(seedArg) : 1;
  const quick = argv.includes("--quick");
  const headsArg = getFlag(argv, "--heads");
  const heads: "win" | "all" = headsArg === "all" ? "all" : "win"; // P-7 default
  const originsArg = getFlag(argv, "--origins");
  const origins = originsArg !== undefined ? originsArg.split(",").map(Number) : [2022, 2023, 2024, 2025];
  return { configs, seed, quick, heads, origins };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rng = mulberry32(args.seed);
  const dir = "packages/gbr/results";
  mkdirSync(dir, { recursive: true });
  const outPath = `${dir}/tune-${args.seed}.jsonl`;

  const records: TuneRecord[] = [];

  for (let i = 0; i < args.configs; i += 1) {
    const cfg = sampleConfig(rng, args.seed * 1000 + i);
    const nTrees = args.quick ? Math.min(cfg.nTrees, 30) : cfg.nTrees;
    const heads: "win" | "all" = args.quick ? "win" : args.heads;

    const perOrigin: Record<number, { winnerAccuracy: number; brier: number }> = {};
    let accSum = 0;
    let brierSum = 0;
    for (const origin of args.origins) {
      const opts: RunOriginOptions = {
        heads,
        nTrees,
        maxDepth: cfg.maxDepth,
        learningRate: cfg.learningRate,
        minChildWeight: cfg.minChildWeight,
        lambda: cfg.lambda,
        subsample: cfg.subsample,
        colsampleByTree: cfg.colsampleByTree,
        seed: cfg.seed,
        halflife: cfg.halflife,
        prevSeasonDecay: cfg.prevSeasonDecay,
      };
      const r = runOrigin(origin, opts);
      perOrigin[origin] = { winnerAccuracy: r.winnerAccuracy, brier: r.brier };
      accSum += r.winnerAccuracy;
      brierSum += r.brier;
    }

    const n = args.origins.length;
    const record: TuneRecord = {
      config: cfg,
      nTrees,
      heads,
      origins: perOrigin,
      objective: n > 0 ? accSum / n : 0,
      meanBrier: n > 0 ? brierSum / n : 0,
    };
    records.push(record);
    process.stderr.write(
      `[tune] config ${i + 1}/${args.configs} objective=${record.objective.toFixed(4)} brier=${record.meanBrier.toFixed(4)}\n`,
    );
  }

  // Accuracy-primary, Brier-secondary — same ordering this project's other
  // tuners already use.
  records.sort((a, b) => (b.objective !== a.objective ? b.objective - a.objective : a.meanBrier - b.meanBrier));

  const lines = records.map((r) => JSON.stringify(r));
  writeFileSync(outPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  console.log(`wrote ${outPath} (${records.length} configs)`);
  if (records.length > 0) {
    const best = records[0]!;
    console.log(`best: objective=${best.objective.toFixed(4)} meanBrier=${best.meanBrier.toFixed(4)} heads=${best.heads}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
