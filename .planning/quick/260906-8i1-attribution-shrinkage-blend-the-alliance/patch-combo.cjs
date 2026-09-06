#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-8i1 — COMBINED arm patcher.
 *
 * Applies 260906-7fj's gain CAP and this task's attribution SHRINKAGE together,
 * in the order they must compose: shrink the attribution vector toward uniform
 * FIRST, then clip the result. Order matters and this is the defensible one —
 * capping first would let the uniform blend push a clipped gain back above the
 * cap, so the cap would not bind at all.
 *
 * The two mechanisms are genuinely different and that is why they might
 * compose: shrinkage REDISTRIBUTES learning across teammates while leaving
 * Sum_j K_j unchanged; the cap REDUCES Sum_j K_j for alliances containing a
 * dominant-variance team. Neither subsumes the other.
 *
 * A separate patcher rather than running the two existing ones in sequence:
 * their anchors overlap on the same gain line, so applying either first
 * destroys the other's anchor.
 *
 * EXPERIMENT-ONLY. Never shipped. Reverted after the arm.
 *
 * Usage: node patch-combo.cjs <lambda> <maxGain>    e.g. node patch-combo.cjs 0.30 0.20
 */

const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "..", "..", "packages", "core", "algorithms", "sigma1");
const KALMAN = path.join(CORE, "kalman.ts");
const INDEX = path.join(CORE, "index.ts");
const L = "EXPERIMENT_260906_8I1_ATTRIB_LAMBDA";
const G = "EXPERIMENT_260906_8I1_MAX_GAIN";

const K_DECL = "export const SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8;";
const K_SIG = `export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[],
  observedSum: number,
  measurementNoise: number
): TeamComponentBelief[] {`;
const K_SIG_NEW = `export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[],
  observedSum: number,
  measurementNoise: number,
  attribLambda: number = 0,
  maxGain: number = 1
): TeamComponentBelief[] {`;
const K_GAIN = `  return teammates.map((t) => {
    const gain = t.variance / pooledVariance;`;
const K_GAIN_NEW = `  const sumP = pooledVariance - measurementNoise;
  const uniformGain = sumP / pooledVariance / teammates.length;
  return teammates.map((t) => {
    const shareGain = t.variance / pooledVariance;
    const blended = attribLambda === 0 ? shareGain : (1 - attribLambda) * shareGain + attribLambda * uniformGain;
    const gain = Math.min(blended, maxGain);`;

const I_IMP = 'import { applyProcessNoise, updateAllianceSum, type TeamComponentBelief } from "./kalman.js";';
const I_IMP_NEW = `import { applyProcessNoise, updateAllianceSum, ${L}, ${G}, type TeamComponentBelief } from "./kalman.js";`;
const I_CG = "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number): number[] {";
const I_CG_NEW =
  "function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number, attribLambda: number = 0, maxGain: number = 1): number[] {";
const I_CGR = "  return teammates.map((t) => t.variance / pooled);";
const I_CGR_NEW = `  const sumPg = pooled - measurementNoise;
  const uniformG = sumPg / pooled / teammates.length;
  return teammates.map((t) => {
    const share = t.variance / pooled;
    const blended = attribLambda === 0 ? share : (1 - attribLambda) * share + attribLambda * uniformG;
    return Math.min(blended, maxGain);
  });`;
const I_CALL = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = componentGains(teammateBeliefs, measurementNoise);`;
const I_CALL_NEW = `    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise, ${L}, ${G});
    const gains = componentGains(teammateBeliefs, measurementNoise, ${L}, ${G});`;

const rd = (f) => {
  const o = fs.readFileSync(f, "utf8");
  const crlf = o.includes("\r\n");
  return { src: crlf ? o.replace(/\r\n/g, "\n") : o, crlf };
};
const wr = (f, s, crlf) => fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s);
const once = (s, a, l) => {
  const c = s.split(a).length - 1;
  if (c !== 1) {
    console.error(`REFUSING: ${l} occurred ${c} times, expected 1.`);
    process.exit(1);
  }
};

const lam = Number(process.argv[2]);
const cap = Number(process.argv[3]);
if (!Number.isFinite(lam) || lam < 0 || lam > 1 || !Number.isFinite(cap) || cap <= 0 || cap > 1) {
  console.error("usage: node patch-combo.cjs <lambda in [0,1]> <maxGain in (0,1]>");
  process.exit(1);
}
const k = rd(KALMAN), i = rd(INDEX);
if (k.src.includes(L) || i.src.includes(L) || k.src.includes(G)) {
  console.error("REFUSING: experiment constants already present — revert first.");
  process.exit(1);
}
once(k.src, K_DECL, "kalman decl");
once(k.src, K_SIG, "updateAllianceSum sig");
once(k.src, K_GAIN, "gain block");
once(i.src, I_IMP, "index import");
once(i.src, I_CG, "componentGains sig");
once(i.src, I_CGR, "componentGains return");
once(i.src, I_CALL, "call pair");

const decl =
  `\n\n// EXPERIMENT-ONLY SCAFFOLDING (quick task 260906-8i1, COMBINED arm). Never\n` +
  `// shipped. Attribution shrinkage is applied BEFORE the cap: capping first\n` +
  `// would let the uniform blend lift a clipped gain back over the cap.\n` +
  `export const ${L} = ${lam};\nexport const ${G} = ${cap};`;

let ks = k.src.replace(K_DECL, K_DECL + decl).replace(K_SIG, K_SIG_NEW).replace(K_GAIN, K_GAIN_NEW);
let is = i.src.replace(I_IMP, I_IMP_NEW).replace(I_CG, I_CG_NEW).replace(I_CGR, I_CGR_NEW).replace(I_CALL, I_CALL_NEW);
wr(KALMAN, ks, k.crlf);
wr(INDEX, is, i.crlf);
console.log(`PATCHED lambda=${lam} maxGain=${cap}`);
