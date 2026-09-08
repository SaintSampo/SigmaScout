/**
 * Structural ablations, scored on the DESIGN years only. Each variant answers
 * "does this piece of the model earn its place?" independently of the
 * hyperparameter search, so a knob that merely tuned itself into inertness is
 * visible as such.
 */
import { readFileSync } from "node:fs";
import { evalDesign } from "./cli.js";
import { DEFAULTS, type BprParams } from "./model.js";

function load(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

function main(): void {
  const path = process.argv[2];
  if (path === undefined) throw new Error("usage: ablate.ts <params.json>");
  const base = load(path);

  const variants: Array<{ name: string; params: BprParams; raw?: boolean }> = [
    { name: "full model (tuned)", params: base },
    {
      name: "no fast/form component (single timescale)",
      params: { ...base, qFast: 0, fastPriorVar: 0, rhoFast: 0 },
    },
    { name: "no foul submodel", params: { ...base, foulOn: false } },
    { name: "no elim down-weighting", params: { ...base, elimWeight: 1 } },
    { name: "purely additive alliances (w2=w3=1)", params: { ...base, w2: 1, w3: 1 } },
    { name: "no online link calibration (tauLr=0)", params: { ...base, tauLr: 0 } },
    { name: "no season carryover (reset each year)", params: { ...base, seasonShrink: 0 } },
    {
      name: "raw score (no foul adjustment at all)",
      params: { ...base, foulOn: false },
      raw: true,
    },
    { name: "no defensive suppression term", params: { ...base, defPriorVar: 0, defQ: 0 } },
  ];

  const rows: string[] = ["  variant                                        acc%    logloss    d(acc)"];
  let baseAcc = 0;
  for (const v of variants) {
    const r = evalDesign(v.params, { useRawScore: v.raw === true });
    if (v.name.startsWith("full model")) baseAcc = r.accuracy;
    const d = 100 * (r.accuracy - baseAcc);
    rows.push(
      `  ${v.name.padEnd(45)} ${(100 * r.accuracy).toFixed(3).padStart(6)}  ` +
        `${r.logLoss.toFixed(4)}  ${(d >= 0 ? "+" : "") + d.toFixed(3)}`,
    );
  }
  console.log("BPR ablations - DESIGN years (2016-2022)");
  console.log(rows.join("\n"));
}

main();
