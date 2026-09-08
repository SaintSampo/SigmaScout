/**
 * SINGLE-SHOT holdout evaluation on 2023-2026.
 *
 * This is the only file in the package permitted to score the holdout seasons.
 * It refuses to run unless the frozen parameter file is committed to git with a
 * clean working tree for that path, so the numbers it prints provably belong to
 * parameters chosen before the seal was broken. Re-running it after editing the
 * model and re-tuning would silently turn the holdout into a second training
 * set; the git check is what makes that misuse visible rather than invisible.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { HOLDOUT_YEARS, matches } from "./cli.js";
import { runEval, formatResult } from "./evaluate.js";
import { DEFAULTS, type BprParams } from "./model.js";

function assertCommitted(path: string): string {
  let head: string;
  try {
    head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("holdout: not a git repository - refusing to run");
  }
  const status = execFileSync("git", ["status", "--porcelain", "--", path], {
    encoding: "utf8",
  }).trim();
  if (status !== "") {
    throw new Error(
      `holdout: ${path} has uncommitted changes (${status}).\n` +
        "Commit the frozen parameters first - the seal must predate the evaluation.",
    );
  }
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" });
  } catch {
    throw new Error(`holdout: ${path} is not tracked at HEAD - commit it first`);
  }
  return head;
}

function main(): void {
  const path = process.argv[2];
  if (path === undefined) throw new Error("usage: holdout.ts <frozen-params.json>");
  if (!process.argv.includes("--break-seal")) {
    throw new Error(
      "holdout: refusing to run without --break-seal.\n" +
        "This evaluation is single-shot by design. Every extra run costs a\n" +
        "little of the holdout's independence, so it must be deliberate.",
    );
  }

  const head = assertCommitted(path);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };

  console.log(`BPR holdout evaluation`);
  console.log(`  frozen params: ${path} @ ${head}`);
  console.log(`  seasons:       ${[...HOLDOUT_YEARS].sort((a, b) => a - b).join(", ")}`);
  console.log("");

  const all = runEval(matches(), params, { scoreYears: HOLDOUT_YEARS });
  console.log(formatResult(all, "ALL matches (quals + playoffs)"));
  console.log("");

  const quals = runEval(matches(), params, { scoreYears: HOLDOUT_YEARS, qualsOnly: true });
  console.log(formatResult(quals, "Qualification matches only"));
}

main();
