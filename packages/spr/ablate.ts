/**
 * Structural ablations, scored on the DESIGN years only. Each variant answers
 * "does this piece of the model earn its place?" independently of the
 * hyperparameter search, so a knob that merely tuned itself into inertness is
 * visible as such.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evalDesign } from "./cli.js";
import type { BprMatch } from "./data.js";
import { DEFAULTS, type BprParams } from "./model.js";

function load(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

/** Filesystem-safe name for a variant, so a jsonl file is traceable to its row. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function main(): void {
  const path = process.argv[2];
  if (path === undefined) throw new Error("usage: ablate.ts <params.json> [--emit <dir>]");
  const emitIndex = process.argv.indexOf("--emit");
  const emitDir = emitIndex >= 0 ? process.argv[emitIndex + 1] : undefined;
  if (emitIndex >= 0 && emitDir === undefined) {
    throw new Error("ablate: --emit needs a directory");
  }
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
    { name: "no robustness (huber off)", params: { ...base, huberK: 1e9 } },
    {
      // Everything distinctive switched off at once: a plain additive
      // single-timescale filter with no cross-season memory. This is roughly
      // the shape of a textbook OPR/Elo-style rating, and is the reference
      // point for what the structural work above actually bought.
      name: "naive additive baseline (all extras off)",
      params: {
        ...base,
        w2: 1,
        w3: 1,
        qFast: 0,
        fastPriorVar: 0,
        rhoFast: 0,
        seasonShrink: 0,
        defPriorVar: 0,
        defQ: 0,
        foulOn: false,
        elimWeight: 1,
        huberK: 1e9,
      },
    },
  ];

  const rows: string[] = ["  variant                                        acc%    logloss    d(acc)"];
  let baseAcc = 0;
  for (const v of variants) {
    // Per-match emission exists so an ablation delta can be bootstrapped
    // PAIRED on matchKey. Ablation deltas are differences between two models
    // scored on the SAME matches, so a marginal (unpaired) SE is the wrong
    // quantity for a bar built on them - see eventBootstrap.ts's own header.
    const lines: string[] = [];
    const onScored =
      emitDir === undefined
        ? undefined
        : (m: BprMatch, pRed: number): void => {
            lines.push(
              JSON.stringify({
                matchKey: m.matchKey,
                eventKey: m.eventKey,
                season: m.year,
                compLevel: m.compLevel,
                eventType: m.eventType,
                pRed,
                actualWinner: m.winner,
              }),
            );
          };
    const r = evalDesign(v.params, { useRawScore: v.raw === true, onScored });
    if (emitDir !== undefined) {
      mkdirSync(emitDir, { recursive: true });
      writeFileSync(join(emitDir, `${slug(v.name)}.jsonl`), `${lines.join("\n")}\n`);
    }
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
