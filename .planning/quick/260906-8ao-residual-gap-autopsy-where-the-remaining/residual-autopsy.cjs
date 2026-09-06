#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-8ao — residual gap autopsy.
 *
 * Answers three questions from prediction streams ALREADY ON DISK, with no new
 * replay:
 *
 *  A. DISAGREEMENT SLICES. Reproduces `reports/autopsy-260905/FINDINGS.md`'s
 *     analysis for BOTH the promoted baseline and the 260906-7fj g20 gain-cap
 *     arm, so we can see which slices the cap fixed and which still lose.
 *
 *  B. MARGIN CALIBRATION. Buckets by PREDICTED margin and reports the MEAN
 *     ACTUAL margin in each bucket, per series. A well-calibrated model tracks
 *     the diagonal. Systematic compression (actual > predicted at the
 *     extremes) or inflation (actual < predicted) is a fixable bias, and it is
 *     the direct test of why blowout disagreements are lost.
 *
 *  C. TOTAL-SCORE SATURATION. Buckets by PREDICTED alliance total and reports
 *     mean actual total. FRC scoring is supply-limited (finitely many game
 *     pieces), but both VPR and EPA predict an alliance total as a strictly
 *     LINEAR sum of per-team contributions. If the linear model over-predicts
 *     high-total alliances, that is saturation, and it is a modelling defect
 *     neither algorithm currently represents.
 *
 * All three are computed per-alliance-observation or per-match as appropriate,
 * streaming, never retaining a parsed row (the *Components blobs dominate each
 * line).
 *
 * Usage: node residual-autopsy.cjs
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
  for await (const line of rl) {
    if (!line) continue;
    const row = JSON.parse(line);
    onLine(row);
  }
}

function newBucketSet(edges) {
  return { edges, sums: edges.map(() => ({ n: 0, predSum: 0, actSum: 0 })) };
}
function bucketIndex(edges, v) {
  for (let i = 0; i < edges.length - 1; i++) if (v < edges[i + 1]) return i;
  return edges.length - 1;
}
function addBucket(bs, pred, act) {
  const i = bucketIndex(bs.edges, pred);
  const s = bs.sums[i];
  s.n++;
  s.predSum += pred;
  s.actSum += act;
}

const MARGIN_EDGES = [-Infinity, -40, -25, -15, -8, -3, 3, 8, 15, 25, 40];
const TOTAL_EDGES = [-Infinity, 20, 40, 60, 80, 100, 120, 150, 200];

function fmt(x, d = 1) {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}
function signed(x, d = 1) {
  return Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(d) : "n/a";
}

async function main() {
  // matchKey -> { actualWinner, actualMargin, actualTotalRed, actualTotalBlue,
  //               compLevel, eventKey, series: { name: {p, predMargin, predRed, predBlue} } }
  const marginCal = { baseline: newBucketSet(MARGIN_EDGES), g20: newBucketSet(MARGIN_EDGES), epa: newBucketSet(MARGIN_EDGES) };
  const totalCal = { baseline: newBucketSet(TOTAL_EDGES), g20: newBucketSet(TOTAL_EDGES), epa: newBucketSet(TOTAL_EDGES) };

  // Disagreement accounting: baseline-vs-epa and g20-vs-epa
  const slices = {};
  function slice(tag, key, vprCorrect) {
    const s = (slices[tag] ??= {});
    const e = (s[key] ??= { n: 0, vprWin: 0 });
    e.n++;
    if (vprCorrect) e.vprWin++;
  }

  for (const season of SEASONS) {
    const matches = new Map();
    const eventOrder = [];
    const eventSeen = new Set();

    for (const [name, dir] of Object.entries(SERIES)) {
      await streamLines(path.join(dir, `predictions-${season}.jsonl`), (row) => {
        if (name === "epa" && row.algorithmId !== "epa") return;
        if (name !== "epa" && row.algorithmId !== "vpr") return;
        let m = matches.get(row.matchKey);
        if (!m) {
          if (name !== "baseline") return; // baseline defines the population
          m = {
            compLevel: row.compLevel,
            eventKey: row.eventKey,
            actualWinner: row.actualWinner,
            actualRed: row.actualRedScore,
            actualBlue: row.actualBlueScore,
            series: {},
          };
          matches.set(row.matchKey, m);
          if (!eventSeen.has(row.eventKey)) {
            eventSeen.add(row.eventKey);
            eventOrder.push(row.eventKey);
          }
        }
        m.series[name] = {
          p: row.pRedWin,
          predRed: row.predictedRedScore,
          predBlue: row.predictedBlueScore,
        };
      });
    }

    const earlyCut = Math.ceil(eventOrder.length * 0.33);
    const midCut = Math.ceil(eventOrder.length * 0.66);
    const phaseOf = new Map();
    eventOrder.forEach((ev, i) => phaseOf.set(ev, i < earlyCut ? "early" : i < midCut ? "mid" : "late"));

    for (const [, m] of matches) {
      if (m.actualWinner !== "red" && m.actualWinner !== "blue") continue;
      if (!m.series.baseline || !m.series.g20 || !m.series.epa) continue;

      const actMargin = m.actualRed - m.actualBlue;
      const absActMargin = Math.abs(actMargin);

      for (const name of ["baseline", "g20", "epa"]) {
        const s = m.series[name];
        if (typeof s.predRed !== "number" || typeof s.predBlue !== "number") continue;
        addBucket(marginCal[name], s.predRed - s.predBlue, actMargin);
        addBucket(totalCal[name], s.predRed, m.actualRed);
        addBucket(totalCal[name], s.predBlue, m.actualBlue);
      }

      // Disagreement slices, for each vpr series against epa
      const epaPick = m.series.epa.p >= 0.5 ? "red" : "blue";
      const epaCorrect = epaPick === m.actualWinner;
      for (const name of ["baseline", "g20"]) {
        const pick = m.series[name].p >= 0.5 ? "red" : "blue";
        if (pick === epaPick) continue; // agreement decides nothing
        const vprCorrect = pick === m.actualWinner;
        if (vprCorrect === epaCorrect) continue; // impossible on a disagreement, guard anyway
        const tag = name;
        slice(tag, "ALL", vprCorrect);
        slice(tag, m.compLevel === "qm" ? "quals" : "elims", vprCorrect);
        slice(tag, absActMargin > 20 ? "blowout>20" : absActMargin >= 8 ? "mid8-20" : "close<8", vprCorrect);
        slice(tag, `phase:${phaseOf.get(m.eventKey)}`, vprCorrect);
        slice(tag, `season:${season}`, vprCorrect);
        // confidence asymmetry
        const dv = Math.abs(m.series[name].p - 0.5);
        const de = Math.abs(m.series.epa.p - 0.5);
        if (dv < 0.05 && de >= 0.1) slice(tag, "vpr~coinflip,epa decisive", vprCorrect);
        if (de < 0.05 && dv >= 0.1) slice(tag, "epa~coinflip,vpr decisive", vprCorrect);
      }
    }
  }

  console.log("# Residual gap autopsy (no new replays)\n");
  console.log("## A. Disagreement slices — VPR's share of disagreements WON (>50% = VPR ahead)\n");
  const keys = Object.keys(slices.baseline);
  console.log("| slice | n (base) | baseline VPR share | n (g20) | g20 VPR share | change |");
  console.log("|---|---|---|---|---|---|");
  for (const k of keys) {
    const b = slices.baseline[k];
    const g = slices.g20[k] ?? { n: 0, vprWin: 0 };
    const bs = (b.vprWin / b.n) * 100;
    const gs = g.n ? (g.vprWin / g.n) * 100 : NaN;
    console.log(`| ${k} | ${b.n} | ${fmt(bs)}% | ${g.n} | ${fmt(gs)}% | ${signed(gs - bs)}pt |`);
  }

  console.log("\n## B. Margin calibration — mean ACTUAL margin by PREDICTED margin bucket\n");
  console.log("A well-calibrated model tracks predicted. |actual| > |predicted| = COMPRESSION.\n");
  console.log("| predicted margin bucket | n | base pred | base act | g20 pred | g20 act | epa pred | epa act |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (let i = 0; i < MARGIN_EDGES.length; i++) {
    const b = marginCal.baseline.sums[i], g = marginCal.g20.sums[i], e = marginCal.epa.sums[i];
    if (b.n === 0) continue;
    const lo = MARGIN_EDGES[i] === -Infinity ? "<-40" : `${MARGIN_EDGES[i]}..${MARGIN_EDGES[i + 1] ?? "+"}`;
    console.log(
      `| ${lo} | ${b.n} | ${fmt(b.predSum / b.n)} | ${fmt(b.actSum / b.n)} | ${fmt(g.predSum / g.n)} | ${fmt(g.actSum / g.n)} | ${fmt(e.predSum / e.n)} | ${fmt(e.actSum / e.n)} |`
    );
  }

  console.log("\n## C. Total-score saturation — mean ACTUAL alliance total by PREDICTED total bucket\n");
  console.log("Linear-sum models should over-predict at the top if FRC scoring is supply-limited.\n");
  console.log("| predicted total bucket | n | base pred | base act | base bias | epa pred | epa act | epa bias |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (let i = 0; i < TOTAL_EDGES.length; i++) {
    const b = totalCal.baseline.sums[i], e = totalCal.epa.sums[i];
    if (b.n === 0) continue;
    const lo = TOTAL_EDGES[i] === -Infinity ? "<20" : `${TOTAL_EDGES[i]}..${TOTAL_EDGES[i + 1] ?? "+"}`;
    const bb = b.actSum / b.n - b.predSum / b.n;
    const eb = e.n ? e.actSum / e.n - e.predSum / e.n : NaN;
    console.log(
      `| ${lo} | ${b.n} | ${fmt(b.predSum / b.n)} | ${fmt(b.actSum / b.n)} | ${signed(bb)} | ${fmt(e.predSum / e.n)} | ${fmt(e.actSum / e.n)} | ${signed(eb)} |`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
