/**
 * Score a parameter file over an explicit set of design-era years.
 *
 * Used for the optimism check: comparing parameters tuned on 2016-2019 against
 * parameters tuned on the whole design era, both measured on the 2020+2022
 * slice, estimates how much the search overfits without spending any of the
 * real holdout. Holdout years are rejected here exactly as they are in tune.ts.
 */
import { readFileSync } from "node:fs";
import { evalYears, LAST_DESIGN_YEAR } from "./cli.js";
import { formatResult } from "./evaluate.js";
import { DEFAULTS, type BprParams } from "./model.js";

function main(): void {
  const path = process.argv[2];
  const yearsArg = process.argv[3];
  if (path === undefined || yearsArg === undefined) {
    throw new Error("usage: score.ts <params.json> <years,csv>");
  }
  const years = yearsArg.split(",").map((s) => Number(s.trim()));
  for (const y of years) {
    if (!Number.isFinite(y)) throw new Error(`score: bad year in "${yearsArg}"`);
    if (y > LAST_DESIGN_YEAR) {
      throw new Error(`score: ${y} is a holdout year - use holdout.ts, deliberately`);
    }
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
  const r = evalYears(params, new Set(years), Math.max(...years));
  console.log(formatResult(r, `${path} on ${years.join("+")}`));
}

main();
