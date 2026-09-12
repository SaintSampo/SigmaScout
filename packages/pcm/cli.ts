/**
 * PCM driver. Default action: paired walk-forward evaluation over the DESIGN
 * years only. The holdout is not reachable from this file.
 *
 * YEAR BUDGET, and why it is drawn here rather than copied from BPR.
 *
 * BPR's own holdout is 2023-2026 and was spent once, at 78.05%. PCM is a
 * DIFFERENT model, so it needs its own out-of-sample evidence, and the operator
 * has allocated it explicitly: design on the pre-2023 era, judge on 2023+2024,
 * leave 2025 and 2026 untouched. That leaves a second, later out-of-sample
 * window available if PCM survives the first -- which is the whole reason not
 * to spend all four years at once.
 *
 * `RESERVED_YEARS` is therefore not decoration. 2025 and 2026 are reachable by
 * NO file in this package, and `seal.test.ts` pins that. `stopAfterYear` is what
 * enforces it in practice: a design run halts the replay at the end of 2022, so
 * a 2023 match is never stepped at all and the later seasons stay unspent as a
 * structural consequence of the loop bound rather than as a promise about what
 * gets printed.
 */
import { pathToFileURL } from "node:url";
import { loadPcmMatches, phaseDiagnostics, type PcmMatch } from "./data.js";
import { formatPaired, pairedDelta, runPaired } from "./evaluate.js";
import { PCM_DEFAULTS, type PcmParams } from "./model.js";

/**
 * The design era. Matches BPR's own `DESIGN_YEARS` exactly, deliberately: the
 * baseline arm was tuned on precisely these seasons, so scoring it anywhere
 * else would handicap the incumbent and flatter PCM. 2021 is absent because the
 * season did not happen; 2020 is a partial season and is kept, as BPR keeps it.
 *
 * The operator's phrasing was "pre2022". A strictly-less-than-2022 slice is
 * available as `--years 2016,2017,2018,2019,2020`; the default includes 2022
 * because that is where BPR's design era actually ends, and excluding it would
 * throw away a full season of evidence without putting any holdout at risk.
 */
export const DESIGN_YEARS: readonly number[] = [2016, 2017, 2018, 2019, 2020, 2022];
export const LAST_DESIGN_YEAR = 2022;

/** Spent ONCE, by `holdout.ts`, and by nothing else. */
export const HOLDOUT_YEARS: readonly number[] = [2023, 2024];
export const LAST_HOLDOUT_YEAR = 2024;

/** Deliberately unspent. No file in this package may score these. */
export const RESERVED_YEARS: readonly number[] = [2025, 2026];

const CORPUS = "data/corpus.sqlite";

let cached: PcmMatch[] | null = null;
export function matches(): PcmMatch[] {
  if (cached === null) {
    const t = Date.now();
    cached = loadPcmMatches(CORPUS);
    const d = phaseDiagnostics();
    process.stderr.write(`[pcm] loaded ${cached.length} matches in ${Date.now() - t}ms\n`);
    if (d !== null) {
      process.stderr.write(
        `[pcm] breakdown status: parsed=${d.byStatus.parsed} absent=${d.byStatus.absent} ` +
          `malformed=${d.byStatus.malformed} unregistered=${d.byStatus.unregistered}\n`,
      );
    }
  }
  return cached;
}

export interface EvalOptions {
  readonly qualsOnly?: boolean;
  readonly params?: PcmParams;
}

/**
 * Evaluate over an arbitrary set of years, halting the replay after the LAST of
 * them. Exported so `holdout.ts` can reuse one code path rather than owning a
 * second transcription of the replay bounds.
 */
export function evalYears(years: readonly number[], opts: EvalOptions = {}) {
  const set = new Set(years);
  const stopAfterYear = Math.max(...years);
  const res = runPaired(
    matches(),
    { scoreYears: set, stopAfterYear, qualsOnly: opts.qualsOnly },
    opts.params ?? PCM_DEFAULTS,
  );
  return { res, delta: pairedDelta(res.rows) };
}

export function evalDesign(opts: EvalOptions = {}) {
  return evalYears(DESIGN_YEARS, opts);
}

/** Per-year breakdown coverage and the component-sum residual, as a report. */
function coverageReport(): string {
  const d = phaseDiagnostics();
  if (d === null) return "  (no diagnostics -- load matches first)";
  const lines: string[] = [
    "  year   parsed/n     cov%   meanResidual   meanAbsAsym",
  ];
  for (const y of [...d.perYear.keys()].sort((a, b) => a - b)) {
    const c = d.perYear.get(y);
    if (c === undefined) continue;
    const r = d.perYearResidual.get(y);
    const cov = c.n > 0 ? (100 * c.parsed) / c.n : 0;
    lines.push(
      `  ${y}  ${String(c.parsed).padStart(6)}/${String(c.n).padEnd(6)} ` +
        `${cov.toFixed(1).padStart(6)}  ` +
        `${(r?.meanResidual ?? 0).toFixed(3).padStart(12)}  ` +
        `${(r?.meanAbsAsymmetry ?? 0).toFixed(3).padStart(12)}`,
    );
  }
  return lines.join("\n");
}

function parseYears(argv: readonly string[]): readonly number[] | null {
  const i = argv.indexOf("--years");
  if (i < 0) return null;
  const raw = argv[i + 1];
  if (raw === undefined) throw new Error("--years needs a comma-separated list");
  const years = raw.split(",").map((s) => Number(s.trim()));
  for (const y of years) {
    if (!Number.isFinite(y)) throw new Error(`--years: bad year in "${raw}"`);
    if (y > LAST_DESIGN_YEAR) {
      throw new Error(
        `--years: ${y} is past the design era. The holdout is run ONCE, from ` +
          `packages/pcm/holdout.ts, which requires committed frozen parameters ` +
          `and an explicit seal break. 2025 and 2026 are reserved and reachable ` +
          `from nowhere in this package.`,
      );
    }
  }
  return years;
}

function main(): void {
  const argv = process.argv.slice(2);

  const years = parseYears(argv) ?? DESIGN_YEARS;
  const { res, delta } = evalYears(years, { qualsOnly: argv.includes("--quals-only") });

  console.log("");
  console.log("breakdown coverage and component-sum residual, all loaded years:");
  console.log(coverageReport());
  console.log("");
  console.log(
    formatPaired(res, delta, `PCM vs BPR -- DESIGN years (${years.join(", ")})`),
  );
}

// Only run when invoked directly, so `holdout.ts` and the tests can import the
// year sets and `evalYears` without silently burning a full evaluation on
// import -- the same guard, for the same reason, as `packages/spr/cli.ts`.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
