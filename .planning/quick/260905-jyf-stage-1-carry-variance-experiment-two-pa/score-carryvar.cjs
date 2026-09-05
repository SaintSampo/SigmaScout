#!/usr/bin/env node
"use strict";

/**
 * Quick task 260905-jyf, Task 1.
 *
 * Joins baseline (epa, vpr) and optional candidate (r1, r2) prediction
 * streams on matchKey, scores accuracy/Brier over the full scored set and
 * an early-season slice, and prints an SE-unit delta for each candidate vs
 * baseline-vpr. Streams every file line-by-line and retains only the five
 * scalar fields needed — the *Components blobs dominate line size and must
 * never be held in memory.
 *
 * Usage: node score-carryvar.cjs [--candidates none|r1,r2]
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SEASONS = [2022, 2023, 2024, 2025, 2026];
const BASELINE_DIR = path.join(__dirname, "..", "..", "..", "reports", "autopsy-260905");
const CANDIDATE_DIR = (name) => path.join(__dirname, "..", "..", "..", "reports", `carryvar-${name}-260905`);

function parseArgs(argv) {
  let candidatesArg = "none";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--candidates" && argv[i + 1] !== undefined) {
      candidatesArg = argv[i + 1];
      i++;
    }
  }
  if (candidatesArg === "none" || candidatesArg === "") return [];
  return candidatesArg.split(",").map((s) => s.trim()).filter(Boolean);
}

async function streamLines(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      throw new Error(`Failed to parse line in ${filePath}: ${err.message}`);
    }
    onLine({
      matchKey: row.matchKey,
      eventKey: row.eventKey,
      algorithmId: row.algorithmId,
      pRedWin: row.pRedWin,
      actualWinner: row.actualWinner,
    });
    // Never retain `row` itself — the *Components blobs are the bulk of the line.
  }
}

function newMatchEntry(eventKey, actualWinner) {
  return { eventKey, actualWinner, series: {} };
}

async function scoreSeason(season, candidates) {
  const matches = new Map(); // matchKey -> { eventKey, actualWinner, series: { epa, vpr, r1?, r2? } }
  const eventOrderSeen = new Set();
  const eventOrder = [];

  const baselineFile = path.join(BASELINE_DIR, `predictions-${season}.jsonl`);
  await streamLines(baselineFile, (rec) => {
    let entry = matches.get(rec.matchKey);
    if (!entry) {
      entry = newMatchEntry(rec.eventKey, rec.actualWinner);
      matches.set(rec.matchKey, entry);
    }
    entry.series[rec.algorithmId] = rec.pRedWin;
    if (!eventOrderSeen.has(rec.eventKey)) {
      eventOrderSeen.add(rec.eventKey);
      eventOrder.push(rec.eventKey);
    }
  });

  for (const candidate of candidates) {
    const candidateFile = path.join(CANDIDATE_DIR(candidate), `predictions-${season}.jsonl`);
    await streamLines(candidateFile, (rec) => {
      const entry = matches.get(rec.matchKey);
      if (!entry) return; // no baseline entry -> cannot score (no known actualWinner); excluded downstream anyway
      entry.series[candidate] = rec.pRedWin;
    });
  }

  const requestedSeries = ["epa", "vpr", ...candidates];

  const earlyEventCount = Math.ceil(eventOrder.length * 0.33);
  const earlyEvents = new Set(eventOrder.slice(0, earlyEventCount));

  let droppedOther = 0;
  let tieCount = 0;

  // Per-series accumulators.
  const stats = {};
  for (const s of requestedSeries) {
    stats[s] = {
      correct: 0,
      n: 0,
      brierSum: 0,
      earlyCorrect: 0,
      earlyN: 0,
    };
  }

  for (const [, entry] of matches) {
    if (entry.actualWinner !== "red" && entry.actualWinner !== "blue") {
      tieCount++;
      continue;
    }
    const hasAll = requestedSeries.every((s) => typeof entry.series[s] === "number");
    if (!hasAll) {
      droppedOther++;
      continue;
    }
    const isEarly = earlyEvents.has(entry.eventKey);
    const actualRed = entry.actualWinner === "red" ? 1 : 0;
    for (const s of requestedSeries) {
      const p = entry.series[s];
      const pick = p >= 0.5 ? "red" : "blue";
      const correct = pick === entry.actualWinner;
      stats[s].n++;
      if (correct) stats[s].correct++;
      stats[s].brierSum += (p - actualRed) ** 2;
      if (isEarly) {
        stats[s].earlyN++;
        if (correct) stats[s].earlyCorrect++;
      }
    }
  }

  return {
    season,
    requestedSeries,
    stats,
    droppedOther,
    tieCount,
    scoredN: requestedSeries.length > 0 ? stats[requestedSeries[0]].n : 0,
  };
}

function seriesMetrics(stat) {
  const accuracy = stat.n > 0 ? stat.correct / stat.n : NaN;
  const brier = stat.n > 0 ? stat.brierSum / stat.n : NaN;
  const earlyAccuracy = stat.earlyN > 0 ? stat.earlyCorrect / stat.earlyN : NaN;
  return { accuracy, brier, earlyAccuracy };
}

function fmt(x, digits = 4) {
  if (Number.isNaN(x)) return "n/a";
  return x.toFixed(digits);
}

function printSeasonTable(result, candidates) {
  const { season, requestedSeries, stats, droppedOther, tieCount, scoredN } = result;
  console.log(`\n## Season ${season}`);
  console.log(`scored_n=${scoredN} dropped_other=${droppedOther} ties=${tieCount}`);
  console.log("");
  const baselineVprMetrics = seriesMetrics(stats.vpr);
  const p = baselineVprMetrics.accuracy;
  const n = stats.vpr.n;
  const se = n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN;

  const header = ["series", "accuracy", "brier", "early_accuracy", "early_n", "scored_n", "se_units_delta"];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");
  for (const s of requestedSeries) {
    const m = seriesMetrics(stats[s]);
    const label = s === "vpr" ? "baseline-vpr" : s === "epa" ? "epa" : s;
    let seUnits = "";
    if (candidates.includes(s)) {
      seUnits = Number.isNaN(se) || se === 0 ? "n/a" : fmt((m.accuracy - p) / se, 2);
    }
    console.log(
      `| ${label} | ${fmt(m.accuracy)} | ${fmt(m.brier)} | ${fmt(m.earlyAccuracy)} | ${stats[s].earlyN} | ${stats[s].n} | ${seUnits} |`
    );
  }
}

function printPooledTable(results, candidates) {
  console.log(`\n## Pooled (all seasons)`);
  const requestedSeries = results[0].requestedSeries;
  const pooled = {};
  for (const s of requestedSeries) {
    pooled[s] = { correct: 0, n: 0, brierSum: 0, earlyCorrect: 0, earlyN: 0 };
  }
  let totalDroppedOther = 0;
  let totalTies = 0;
  for (const r of results) {
    totalDroppedOther += r.droppedOther;
    totalTies += r.tieCount;
    for (const s of requestedSeries) {
      pooled[s].correct += r.stats[s].correct;
      pooled[s].n += r.stats[s].n;
      pooled[s].brierSum += r.stats[s].brierSum;
      pooled[s].earlyCorrect += r.stats[s].earlyCorrect;
      pooled[s].earlyN += r.stats[s].earlyN;
    }
  }
  console.log(`total_dropped_other=${totalDroppedOther} total_ties=${totalTies}`);
  console.log("");
  const p = pooled.vpr.n > 0 ? pooled.vpr.correct / pooled.vpr.n : NaN;
  const n = pooled.vpr.n;
  const se = n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN;

  const header = ["series", "accuracy", "brier", "early_accuracy", "early_n", "scored_n", "se_units_delta"];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");
  for (const s of requestedSeries) {
    const m = seriesMetrics(pooled[s]);
    const label = s === "vpr" ? "baseline-vpr" : s === "epa" ? "epa" : s;
    let seUnits = "";
    if (candidates.includes(s)) {
      seUnits = Number.isNaN(se) || se === 0 ? "n/a" : fmt((m.accuracy - p) / se, 2);
    }
    console.log(
      `| ${label} | ${fmt(m.accuracy)} | ${fmt(m.brier)} | ${fmt(m.earlyAccuracy)} | ${pooled[s].earlyN} | ${pooled[s].n} | ${seUnits} |`
    );
  }

  const totalScored = results.reduce((sum, r) => sum + r.scoredN, 0);
  console.log(`\nTOTAL_SCORED=${totalScored}`);
}

async function main() {
  const candidates = parseArgs(process.argv.slice(2));
  console.log(`score-carryvar.cjs — candidates=${candidates.length > 0 ? candidates.join(",") : "none"}`);

  const results = [];
  for (const season of SEASONS) {
    const result = await scoreSeason(season, candidates);
    printSeasonTable(result, candidates);
    results.push(result);
  }
  printPooledTable(results, candidates);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
