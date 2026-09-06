#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-6zc, Task 2 — the arm patcher.
 *
 * Applies EXACTLY ONE working-tree edit to
 * packages/core/algorithms/sigma1/carryover.ts: a module-level experiment
 * constant, substituted for `params.carryMeanReversion` at the single site
 * that can move a prediction (`sigma1CarryNormalizedRating`'s return). This
 * overrides the per-season promoted values UNIFORMLY (P-1) so the sweep reads
 * as one axis.
 *
 * EXPERIMENT-ONLY. Never shipped: no Sigma1Params field, no
 * SIGMA1_CODE_VERSION bump. Reverted with `git checkout --` after each arm.
 *
 * A script rather than three hand-edits so every arm is character-identical
 * except the constant — the same containment argument 260905-wwt made by
 * diffing its two arms by hand, here made structural instead.
 *
 * Usage: node patch-arm.cjs <reversion>     e.g. node patch-arm.cjs 0.25
 */

const fs = require("fs");
const path = require("path");

const TARGET = path.join(__dirname, "..", "..", "..", "packages", "core", "algorithms", "sigma1", "carryover.ts");

const CONST_NAME = "EXPERIMENT_260906_6ZC_CARRY_MEAN_REVERSION";

const ANCHOR_DECL = "/**\n * Sigma1's parameterized equivalent of `carryover.ts`'s";
const ANCHOR_USE = "return blended + reversionOverGap(params.carryMeanReversion, gap) * (EPA_ROOKIE_BASELINE - blended);";

function main() {
  const raw = process.argv[2];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.error(`usage: node patch-arm.cjs <reversion in [0,1]>  (got ${JSON.stringify(raw)})`);
    process.exit(1);
  }

  // core.autocrlf is on in this checkout: the file is LF on first read but
  // git re-materializes it CRLF after `git checkout --`, so anchors written
  // with \n stop matching on the SECOND arm. Normalize for matching, restore
  // the original ending style on write — otherwise the patch would also
  // rewrite every line ending in the file and bury the two real hunks.
  const original = fs.readFileSync(TARGET, "utf8");
  const wasCrlf = original.includes("\r\n");
  let src = wasCrlf ? original.replace(/\r\n/g, "\n") : original;

  if (src.includes(CONST_NAME)) {
    console.error(`REFUSING: ${CONST_NAME} is already present — the tree is not clean. Revert first.`);
    process.exit(1);
  }
  if (!src.includes(ANCHOR_DECL)) {
    console.error("REFUSING: declaration anchor not found — carryover.ts has drifted from the plan's interface facts.");
    process.exit(1);
  }
  const useCount = src.split(ANCHOR_USE).length - 1;
  if (useCount !== 1) {
    console.error(`REFUSING: expected exactly 1 use site, found ${useCount}.`);
    process.exit(1);
  }

  const decl =
    `// EXPERIMENT-ONLY SCAFFOLDING (quick task 260906-6zc). Never shipped: no\n` +
    `// Sigma1Params field, no SIGMA1_CODE_VERSION bump. Working-tree-only,\n` +
    `// reverted after replay. REPLACES the per-season promoted\n` +
    `// carryMeanReversion uniformly at the one site that can move a\n` +
    `// prediction — see the plan's P-1. EPA's own frozen carry\n` +
    `// (carryNormalizedRating / epaCarryover) is a different function and is\n` +
    `// untouched, so the EPA baseline structurally cannot move (D-04).\n` +
    `const ${CONST_NAME} = ${value};\n\n`;

  src = src.replace(ANCHOR_DECL, decl + ANCHOR_DECL);
  src = src.replace(
    ANCHOR_USE,
    `return blended + reversionOverGap(${CONST_NAME}, gap) * (EPA_ROOKIE_BASELINE - blended);`
  );

  fs.writeFileSync(TARGET, wasCrlf ? src.replace(/\n/g, "\r\n") : src);
  console.log(`PATCHED ${CONST_NAME} = ${value} (crlf=${wasCrlf})`);
}

main();
