/**
 * SINGLE-SHOT holdout evaluation on 2023+2024.
 *
 * This is the ONLY file in the package permitted to score the holdout seasons,
 * and it refuses to run unless three things hold at once:
 *
 *  1. `--break-seal` was passed explicitly. No accidental invocation.
 *  2. `packages/pcm/frozen-params.json` exists, is tracked at HEAD, and has a
 *     clean working tree -- the parameters must PREDATE the evaluation.
 *  3. Every SEALED PATH is committed with a clean working tree. The seal covers
 *     the MODEL as well as the parameters, because BPR's own holdout history
 *     (quick task 260908-vqr, F-15) found `model.ts` had changed twice after the
 *     sealed evaluation ran, leaving a printed number that could not be
 *     attributed to any specific revision without manual forensics. Each path's
 *     blob sha is printed, so a reader can check the result against the
 *     repository line by line rather than trusting a claim.
 *
 * WHAT THIS SPENDS. 2023 and 2024 only. `stopAfterYear` is bound to the maximum
 * holdout year, so a 2025 match is never stepped -- the reserved seasons stay
 * genuinely unspent as a consequence of the loop bound, not as a promise about
 * what gets printed. If PCM wins here, 2025+2026 remain available as a second,
 * independent confirmation; if it loses, they were never touched.
 *
 * WHAT IT DOES NOT DO. It does not promote anything, publish anything, or
 * modify BPR. PCM has no algorithm id and no artifact surface. The output is a
 * text file and a verdict.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSealed, type CommandRunner } from "../spr/sealedPaths.js";
import { evalYears, HOLDOUT_YEARS, RESERVED_YEARS } from "./cli.js";
import { formatPaired } from "./evaluate.js";
import { PCM_DEFAULTS, type PcmParams } from "./model.js";

const FROZEN_PARAMS_PATH = "packages/pcm/frozen-params.json";
const RESULT_PATH = "packages/pcm/HOLDOUT-RESULT.txt";

/**
 * Every file that can change what PCM predicts, plus the BPR files it stands on.
 *
 * BPR's model and loader are included because PCM's fallback path IS a private
 * `BprModel` instance and its match population IS `loadMatches`'s -- a change to
 * either moves PCM's numbers, so a seal that omitted them would be describing
 * less than it appears to. `groups.ts` is included because the auto/teleop/
 * endgame mapping is the experiment's entire independent variable.
 */
export const SEALED_CODE_PATHS: readonly string[] = [
  "packages/pcm/model.ts",
  "packages/pcm/data.ts",
  "packages/pcm/evaluate.ts",
  "packages/pcm/cli.ts",
  "packages/pcm/holdout.ts",
  "packages/spr/model.ts",
  "packages/spr/data.ts",
  "packages/core/algorithms/breakdown/groups.ts",
];

const defaultRunner: CommandRunner = (file, args) =>
  execFileSync(file, [...args], { encoding: "utf8" });

function assertFrozenParams(run: CommandRunner): PcmParams {
  if (!existsSync(FROZEN_PARAMS_PATH)) {
    throw new Error(
      `holdout: ${FROZEN_PARAMS_PATH} does not exist - refusing to run without frozen parameters`,
    );
  }
  const status = run("git", ["status", "--porcelain", "--", FROZEN_PARAMS_PATH]).trim();
  if (status !== "") {
    throw new Error(
      `holdout: ${FROZEN_PARAMS_PATH} has uncommitted changes (${status}). ` +
        `Commit the frozen parameters first - the seal must predate the evaluation.`,
    );
  }
  const raw = JSON.parse(readFileSync(FROZEN_PARAMS_PATH, "utf8")) as {
    params?: Partial<PcmParams>;
  };
  return { ...PCM_DEFAULTS, ...(raw.params ?? (raw as Partial<PcmParams>)) };
}

export interface HoldoutOptions {
  readonly argv?: readonly string[];
  readonly run?: CommandRunner;
  /** Injected so the refusal logic is testable without writing a result file. */
  readonly write?: (path: string, body: string) => void;
}

export function runHoldout(opts: HoldoutOptions = {}): string {
  const argv = opts.argv ?? process.argv.slice(2);
  const run = opts.run ?? defaultRunner;

  if (!argv.includes("--break-seal")) {
    throw new Error(
      "holdout: refusing to run without --break-seal.\n" +
        `This spends ${HOLDOUT_YEARS.join("+")} permanently. ` +
        `${RESERVED_YEARS.join(" and ")} stay reserved either way.`,
    );
  }

  const params = assertFrozenParams(run);
  const seal = assertSealed(SEALED_CODE_PATHS, run);

  const { res, delta } = evalYears(HOLDOUT_YEARS, { params });

  const header: string[] = [
    "PCM (phase-component model) -- SINGLE-SHOT HOLDOUT",
    "",
    `HEAD: ${seal.head}`,
    "sealed paths:",
    ...seal.paths.map((p) => `  ${p.blob}  ${p.path}`),
    `frozen params: ${FROZEN_PARAMS_PATH}`,
    `scored years: ${HOLDOUT_YEARS.join(", ")}`,
    `reserved and NOT stepped: ${RESERVED_YEARS.join(", ")}`,
    "",
  ];

  const body =
    header.join("\n") +
    formatPaired(res, delta, `PCM vs BPR -- HOLDOUT ${HOLDOUT_YEARS.join("+")}`) +
    "\n";

  const write =
    opts.write ??
    ((path: string, text: string): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    });
  write(RESULT_PATH, body);
  return body;
}

function main(): void {
  const body = runHoldout();
  console.log(body);
  console.log(`written: ${RESULT_PATH}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
