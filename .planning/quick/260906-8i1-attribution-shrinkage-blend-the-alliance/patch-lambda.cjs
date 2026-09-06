#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-8i1 — attribution-shrinkage arm patcher.
 *
 * `updateAllianceSum` attributes a SHARED alliance-sum observation across
 * teammates strictly by variance share, `K_j = P_j / (Sum P_i + R)`. A green
 * team among two veterans therefore absorbs roughly half the innovation on the
 * strength of an assumption about who was responsible — an assumption
 * `covariance.ts`'s own header already flags as unrecoverable from a summed
 * observation. 260906-8ao Finding 4 showed the residual VPR-EPA deficit is
 * VARIANCE in exactly that thin-information regime, not bias.
 *
 * This shrinks the attribution VECTOR toward uniform:
 *
 *   share_j   = P_j / (Sum P_i + R)
 *   uniform_j = (Sum P_i / (Sum P_i + R)) / n
 *   K_j       = (1 - lambda) * share_j + lambda * uniform_j
 *
 * Sum_j share_j == Sum_j uniform_j == Sum P_i / (Sum P_i + R), so `Sum_j K_j`
 * is IDENTICAL for every lambda. The alliance's TOTAL learning per observation
 * is unchanged — this is NOT a slower filter, unlike 260906-7fj's cap. It only
 * redistributes that learning toward an equal split, trading a little
 * attribution bias for variance reduction.
 *
 * Inert at lambda = 0: the blend collapses to `share_j` exactly (multiplying by
 * 1 and adding 0*x is exact in IEEE-754 for finite x), proven by the Task 2
 * replay rather than asserted.
 *
 * Applied to the SCORE side only — `rp/state.ts` passes three arguments and
 * keeps the unshrunk attribution.
 *
 * Usage: node patch-lambda.cjs <lambda in [0,1]>
 */

const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "..", "..", "packages", "core", "algorithms", "sigma1");
const KALMAN = path.join(CORE, "kalman.ts");
const INDEX = path.join(CORE, "index.ts");
const CONST_NAME = "EXPERIMENT_260906_8I1_ATTRIB_LAMBDA";

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
  attribLambda: number = 0
): TeamComponentBelief[] {`;
const K_GAIN_ANCHOR = `  return teammates.map((t) => {
    const gain = t.variance / pooledVariance;`;
const K_GAIN_NEW = `  const sumP = pooledVariance - measurementNoise;
  const uniformGain = sumP / pooledVariance / teammates.length;
  return teammates.map((t) => {
    const shareGain = t.variance / pooledVariance;
    const gain = attribLambda === 0 ? shareGain : (1 - attribLambda) * shareGain + attribLambda * uniformGain;`;

const I_IMPORT_ANCHOR =
  'import { applyProcessNoise, updateAllianceSum, type TeamComponentBelief } from "./kalman.js";';
const I_IMPORT_NEW =
  'import { applyProcessNoise, updateAllianceSum, EXPERIMENT_260906_8I1_ATTRIB_LAMBDA, type TeamComponentBelief } from "./kalman.js";';
const I_CG_SIG_ANCHOR =
  "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number): number[] {";
const I_CG_SIG_NEW =
  "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number, attribLambda: number = 0): number[] {";
const I_CG_RET_ANCHOR = "  return teammates.map((t) => t.variance / pooled);";
const I_CG_RET_NEW = `  const sumPg = pooled - measurementNoise;
  const uniformG = sumPg / pooled / teammates.length;
  return teammates.map((t) =>
    attribLambda === 0 ? t.variance / pooled : (1 - attribLambda) * (t.variance / pooled) + attribLambda * uniformG
  );`;
const I_CALL_ANCHOR = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = componentGains(teammateBeliefs, measurementNoise);`;
const I_CALL_NEW = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise, ${CONST_NAME});
    const gains = componentGains(teammateBeliefs, measurementNoise, ${CONST_NAME});`;

function readNorm(f) {
  const o = fs.readFileSync(f, "utf8");
  const crlf = o.includes("\r\n");
  return { src: crlf ? o.replace(/\r\n/g, "\n") : o, crlf };
}
function write(f, s, crlf) {
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s);
}
function once(src, a, label) {
  const c = src.split(a).length - 1;
  if (c !== 1) {
    console.error(`REFUSING: expected exactly 1 occurrence of ${label}, found ${c}.`);
    process.exit(1);
  }
}

function main() {
  const raw = process.argv[2];
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    console.error(`usage: node patch-lambda.cjs <lambda in [0,1]>  (got ${JSON.stringify(raw)})`);
    process.exit(1);
  }
  const k = readNorm(KALMAN), i = readNorm(INDEX);
  if (k.src.includes(CONST_NAME) || i.src.includes(CONST_NAME)) {
    console.error(`REFUSING: ${CONST_NAME} already present — tree not clean. Revert first.`);
    process.exit(1);
  }
  once(k.src, K_DECL_ANCHOR, "kalman decl anchor");
  once(k.src, K_SIG_ANCHOR, "updateAllianceSum signature");
  once(k.src, K_GAIN_ANCHOR, "updateAllianceSum gain block");
  once(i.src, I_IMPORT_ANCHOR, "index kalman import");
  once(i.src, I_CG_SIG_ANCHOR, "componentGains signature");
  once(i.src, I_CG_RET_ANCHOR, "componentGains return");
  once(i.src, I_CALL_ANCHOR, "score-side call pair");

  const decl =
    `\n\n// EXPERIMENT-ONLY SCAFFOLDING (quick task 260906-8i1). Never shipped: no\n` +
    `// Sigma1Params field, no SIGMA1_CODE_VERSION bump. Shrinks the alliance-sum\n` +
    `// ATTRIBUTION vector toward uniform while leaving Sum_j K_j exactly\n` +
    `// unchanged, so total learning per observation is identical. Inert at 0.\n` +
    `// Score side only — rp/state.ts passes three arguments.\n` +
    `export const ${CONST_NAME} = ${v};`;

  let ks = k.src.replace(K_DECL_ANCHOR, K_DECL_ANCHOR + decl);
  ks = ks.replace(K_SIG_ANCHOR, K_SIG_NEW).replace(K_GAIN_ANCHOR, K_GAIN_NEW);
  let is = i.src.replace(I_IMPORT_ANCHOR, I_IMPORT_NEW);
  is = is.replace(I_CG_SIG_ANCHOR, I_CG_SIG_NEW).replace(I_CG_RET_ANCHOR, I_CG_RET_NEW);
  is = is.replace(I_CALL_ANCHOR, I_CALL_NEW);

  write(KALMAN, ks, k.crlf);
  write(INDEX, is, i.crlf);
  console.log(`PATCHED ${CONST_NAME} = ${v}`);
}
main();
