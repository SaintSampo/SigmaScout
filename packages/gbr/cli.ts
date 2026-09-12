/**
 * GBR (Gradient-Boosted Rating) — package year vocabulary, and nothing else
 * yet. This is THE SEAL's declaration point: `data.ts`'s `loadSeason` reads
 * `HOLDOUT_YEARS` from here to decide whether a year requires the
 * `{ breakSeal: true }` option.
 *
 * **2021 is a permanent exclusion, not a gap.** There was no 2021 FRC season
 * in this corpus's sense — a remote season with no comparable match data —
 * so no future reader should "fix" either list below by inserting it.
 *
 * This file is imported by `evaluate.ts`/`tune.ts` for `DESIGN_YEARS` only.
 * `main()` below is guarded by the entry check at the bottom (the
 * `packages/spr/cli.ts:66-69` precedent) so importing this module for its
 * exports never triggers a run.
 */
import { pathToFileURL } from "node:url";

export const DESIGN_YEARS: readonly number[] = Object.freeze([
  2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025,
]);

export const HOLDOUT_YEARS: readonly number[] = Object.freeze([2026]);

export const CORPUS_PATH = "data/corpus.sqlite";

function main(): void {
  console.log(`GBR design years:          ${DESIGN_YEARS.join(", ")}`);
  console.log(`GBR holdout years (SEALED): ${HOLDOUT_YEARS.join(", ")}`);
  console.log(`2021 is a permanent exclusion (no comparable FRC season), not a gap.`);
}

// Only run when invoked directly — data.ts/features.ts/evaluate.ts/tune.ts
// import this module for its exports, and an unguarded main() would make
// every one of them print on import.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
