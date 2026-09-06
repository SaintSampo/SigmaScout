#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-7fj, Task 1 — the arm patcher.
 *
 * Six anchored edits across two files, generated from one script so every arm
 * is character-identical except the constant:
 *
 *   kalman.ts
 *     1. the experiment constant, after SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY
 *     2. `updateAllianceSum` gains an optional `maxGain = 1` parameter
 *     3. the belief-update gain is clamped by it
 *   index.ts
 *     4. the kalman.js import picks up the constant
 *     5. `componentGains` gains the same optional parameter and clamp
 *     6. the two SCORE-side call sites pass the constant
 *
 * `rp/state.ts` calls `updateAllianceSum` with three arguments and therefore
 * defaults to `maxGain = 1` — the RP threshold path is deliberately NOT
 * capped (plan P-3), so any measured effect is attributable to the score
 * components alone.
 *
 * Inert at default, provably: K_j = P_j / (Sum P_i + R) <= 1 whenever every
 * P >= 0 and R >= 0, so Math.min(K_j, 1) returns K_j bitwise unchanged.
 *
 * EXPERIMENT-ONLY. Never shipped: no Sigma1Params field, no
 * SIGMA1_CODE_VERSION bump. Reverted with `git checkout --` after each arm.
 *
 * Usage: node patch-gain.cjs <maxGain>     e.g. node patch-gain.cjs 0.45
 */

const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "..", "..", "packages", "core", "algorithms", "sigma1");
const KALMAN = path.join(CORE, "kalman.ts");
const INDEX = path.join(CORE, "index.ts");

const CONST_NAME = "EXPERIMENT_260906_7FJ_MAX_GAIN";

// --- kalman.ts anchors ---
const K_DECL_ANCHOR = "export const SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8;";
const K_SIG_ANCHOR = `export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[],
  observedSum: number,
  measurementNoise: number
): TeamComponentBelief[] {`;
const K_SIG_NEW = `export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[],
  observedSum: number,
  measurementNoise: number,
  maxGain: number = 1
): TeamComponentBelief[] {`;
const K_GAIN_ANCHOR = "    const gain = t.variance / pooledVariance;";
const K_GAIN_NEW = "    const gain = Math.min(t.variance / pooledVariance, maxGain);";

// --- index.ts anchors ---
const I_IMPORT_ANCHOR =
  'import { applyProcessNoise, updateAllianceSum, type TeamComponentBelief } from "./kalman.js";';
const I_IMPORT_NEW =
  'import { applyProcessNoise, updateAllianceSum, EXPERIMENT_260906_7FJ_MAX_GAIN, type TeamComponentBelief } from "./kalman.js";';
const I_CG_SIG_ANCHOR =
  "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number): number[] {";
const I_CG_SIG_NEW =
  "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number, maxGain: number = 1): number[] {";
const I_CG_RET_ANCHOR = "  return teammates.map((t) => t.variance / pooled);";
const I_CG_RET_NEW = "  return teammates.map((t) => Math.min(t.variance / pooled, maxGain));";
const I_CALL_ANCHOR = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = componentGains(teammateBeliefs, measurementNoise);`;
const I_CALL_NEW = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise, ${CONST_NAME});
    const gains = componentGains(teammateBeliefs, measurementNoise, ${CONST_NAME});`;

function readNormalized(file) {
  const original = fs.readFileSync(file, "utf8");
  const wasCrlf = original.includes("\r\n");
  return { src: wasCrlf ? original.replace(/\r\n/g, "\n") : original, wasCrlf };
}

function write(file, src, wasCrlf) {
  fs.writeFileSync(file, wasCrlf ? src.replace(/\n/g, "\r\n") : src);
}

function requireOnce(src, anchor, label) {
  const count = src.split(anchor).length - 1;
  if (count !== 1) {
    console.error(`REFUSING: expected exactly 1 occurrence of ${label}, found ${count}.`);
    process.exit(1);
  }
}

function main() {
  const raw = process.argv[2];
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    console.error(`usage: node patch-gain.cjs <maxGain in (0,1]>  (got ${JSON.stringify(raw)})`);
    process.exit(1);
  }

  const k = readNormalized(KALMAN);
  const i = readNormalized(INDEX);

  if (k.src.includes(CONST_NAME) || i.src.includes(CONST_NAME)) {
    console.error(`REFUSING: ${CONST_NAME} already present — the tree is not clean. Revert first.`);
    process.exit(1);
  }
  requireOnce(k.src, K_DECL_ANCHOR, "kalman decl anchor");
  requireOnce(k.src, K_SIG_ANCHOR, "updateAllianceSum signature");
  requireOnce(k.src, K_GAIN_ANCHOR, "updateAllianceSum gain line");
  requireOnce(i.src, I_IMPORT_ANCHOR, "index kalman.js import");
  requireOnce(i.src, I_CG_SIG_ANCHOR, "componentGains signature");
  requireOnce(i.src, I_CG_RET_ANCHOR, "componentGains return");
  requireOnce(i.src, I_CALL_ANCHOR, "score-side call pair");

  const decl =
    `\n\n// EXPERIMENT-ONLY SCAFFOLDING (quick task 260906-7fj). Never shipped: no\n` +
    `// Sigma1Params field, no SIGMA1_CODE_VERSION bump. Working-tree-only,\n` +
    `// reverted after replay. Caps the per-team alliance-sum Kalman gain; see\n` +
    `// the plan's P-1/P-3. Inert at 1 by construction (K_j <= 1 always), and\n` +
    `// applied ONLY at the score-side call sites — rp/state.ts passes three\n` +
    `// arguments and keeps the uncapped default.\n` +
    `export const ${CONST_NAME} = ${value};`;

  let ks = k.src.replace(K_DECL_ANCHOR, K_DECL_ANCHOR + decl);
  ks = ks.replace(K_SIG_ANCHOR, K_SIG_NEW).replace(K_GAIN_ANCHOR, K_GAIN_NEW);

  let is = i.src.replace(I_IMPORT_ANCHOR, I_IMPORT_NEW);
  is = is.replace(I_CG_SIG_ANCHOR, I_CG_SIG_NEW).replace(I_CG_RET_ANCHOR, I_CG_RET_NEW);
  is = is.replace(I_CALL_ANCHOR, I_CALL_NEW);

  write(KALMAN, ks, k.wasCrlf);
  write(INDEX, is, i.wasCrlf);
  console.log(`PATCHED ${CONST_NAME} = ${value} (kalman crlf=${k.wasCrlf}, index crlf=${i.wasCrlf})`);
}

main();
