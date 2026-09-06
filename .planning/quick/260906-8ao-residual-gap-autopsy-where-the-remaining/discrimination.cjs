#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-8ao — discrimination and self-diagnosis analysis.
 *
 * Two questions the slice tables cannot answer:
 *
 *  D. DISCRIMINATION. For each model, bucket matches by that model's OWN
 *     |predicted margin| decile and report its accuracy in each. This is the
 *     cleanest head-to-head of information content: at equal self-declared
 *     confidence, whose predictions are actually right more often? A model
 *     whose top decile is less accurate has a NOISIER rating difference, not
 *     merely a differently-scaled one.
 *
 *  E. SELF-DIAGNOSIS. VPR publishes a per-match predictive variance; EPA
 *     publishes none. Bucket by VPR's own variance and report both models'
 *     accuracy. If VPR's deficit concentrates in matches VPR ITSELF flags as
 *     uncertain, the weakness is self-identifiable at prediction time — which
 *     is exploitable in a way an unknown weakness is not.
 *
 * Streams; never retains a parsed row.
 *
 * Usage: node discrimination.cjs
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SEASONS = [2022, 2023, 2024, 2025, 2026];
const REPO = path.join(__dirname, "..", "..", "..");
const SERIES = {
  baseline: path.join(REPO, "reports", "rpnoise-baseline-260905"),
  g20: path.join(REPO, "reports", "gaincap-g20-260906"),
  epa: path.join(REPO, "reports", "autopsy-260905"),
};

async function streamLines(filePath, onLine) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) onLine(JSON.parse(line));
}

function quantiles(sorted, n) {
  const out = [];
  for (let i = 1; i < n; i++) out.push(sorted[Math.floor((sorted.length * i) / n)]);
  return out;
}
function bucketOf(edges, v) {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
}
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(2) + "%" : "n/a");

async function main() {
  const rows = [];

  for (const season of SEASONS) {
    const m = new Map();
    for (const [name, dir] of Object.entries(SERIES)) {
      await streamLines(path.join(dir, `predictions-${season}.jsonl`), (r) => {
        if (name === "epa" && r.algorithmId !== "epa") return;
        if (name !== "epa" && r.algorithmId !== "vpr") return;
        let e = m.get(r.matchKey);
        if (!e) {
          if (name !== "baseline") return;
          e = { actualWinner: r.actualWinner, s: {} };
          m.set(r.matchKey, e);
        }
        e.s[name] = {
          p: r.pRedWin,
          margin: r.predictedRedScore - r.predictedBlueScore,
          variance: r.variance,
        };
      });
    }
    for (const [, e] of m) {
      if (e.actualWinner !== "red" && e.actualWinner !== "blue") continue;
      if (!e.s.baseline || !e.s.g20 || !e.s.epa) continue;
      rows.push({
        w: e.actualWinner,
        base: e.s.baseline,
        g20: e.s.g20,
        epa: e.s.epa,
      });
    }
  }

  console.log(`# Discrimination and self-diagnosis (n=${rows.length})\n`);

  // --- D. discrimination by each model's OWN |predicted margin| decile ---
  console.log("## D. Accuracy by the model's OWN |predicted margin| decile\n");
  console.log("Each model is bucketed by its own confidence, so the columns are NOT the same");
  console.log("matches. The question is whether equal self-declared confidence buys equal accuracy.\n");
  console.log("| decile | base |margin| | base acc | g20 |margin| | g20 acc | epa |margin| | epa acc |");
  console.log("|---|---|---|---|---|---|---|");

  const stats = {};
  for (const k of ["base", "g20", "epa"]) {
    const sorted = rows.map((r) => Math.abs(r[k].margin)).sort((a, b) => a - b);
    const edges = quantiles(sorted, 10);
    const acc = Array.from({ length: 10 }, () => ({ n: 0, c: 0, mSum: 0 }));
    for (const r of rows) {
      const am = Math.abs(r[k].margin);
      const b = Math.min(bucketOf(edges, am), 9);
      const pick = r[k].p >= 0.5 ? "red" : "blue";
      acc[b].n++;
      acc[b].mSum += am;
      if (pick === r.w) acc[b].c++;
    }
    stats[k] = acc;
  }
  for (let i = 0; i < 10; i++) {
    const b = stats.base[i], g = stats.g20[i], e = stats.epa[i];
    console.log(
      `| ${i + 1} | ${(b.mSum / b.n).toFixed(1)} | ${pct(b.c, b.n)} | ${(g.mSum / g.n).toFixed(1)} | ${pct(g.c, g.n)} | ${(e.mSum / e.n).toFixed(1)} | ${pct(e.c, e.n)} |`
    );
  }

  // --- E. accuracy by VPR's OWN declared variance quintile ---
  console.log("\n## E. Both models' accuracy, bucketed by VPR's OWN predicted variance\n");
  console.log("Same matches in every column. VPR's variance is its own uncertainty claim.\n");
  const vs = rows.map((r) => r.base.variance).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const vEdges = quantiles(vs, 5);
  const q = Array.from({ length: 5 }, () => ({ n: 0, b: 0, g: 0, e: 0, vSum: 0 }));
  for (const r of rows) {
    if (!Number.isFinite(r.base.variance)) continue;
    const i = Math.min(bucketOf(vEdges, r.base.variance), 4);
    q[i].n++;
    q[i].vSum += r.base.variance;
    if ((r.base.p >= 0.5 ? "red" : "blue") === r.w) q[i].b++;
    if ((r.g20.p >= 0.5 ? "red" : "blue") === r.w) q[i].g++;
    if ((r.epa.p >= 0.5 ? "red" : "blue") === r.w) q[i].e++;
  }
  console.log("| VPR variance quintile | n | mean sd (pts) | baseline acc | g20 acc | epa acc | epa - g20 |");
  console.log("|---|---|---|---|---|---|---|");
  for (let i = 0; i < 5; i++) {
    const x = q[i];
    const gAcc = x.g / x.n, eAcc = x.e / x.n;
    console.log(
      `| Q${i + 1} | ${x.n} | ${Math.sqrt(x.vSum / x.n).toFixed(1)} | ${pct(x.b, x.n)} | ${pct(x.g, x.n)} | ${pct(x.e, x.n)} | ${((eAcc - gAcc) * 100 >= 0 ? "+" : "") + ((eAcc - gAcc) * 100).toFixed(2)}pt |`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
