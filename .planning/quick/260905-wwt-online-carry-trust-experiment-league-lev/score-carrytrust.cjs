#!/usr/bin/env node
"use strict";

/**
 * Quick task 260905-wwt, Task 1.
 *
 * Joins FOUR series on matchKey — baseline (vpr, reused from
 * reports/rpnoise-baseline-260905), epa (algorithmId==='epa' rows only, from
 * reports/autopsy-260905), and up to two experiment arms (s, sr, from
 * reports/carrytrust-{s,sr}-260905) — scores accuracy/Brier over the full
 * scored set and an early-season slice, prints an SE-unit delta for each arm
 * vs baseline, and (when both arms present) an SR-minus-S delta row — the
 * rescue mechanism's isolated effect.
 *
 * Adapted from
 * .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs
 * — same streaming discipline, same intersection rule, same early slice,
 * same SE-unit delta column. What's new: two DIFFERENT baseline directories
 * (baseline and epa no longer share one directory), a per-series version
 * guard, and the SR-minus-S delta.
 *
 * Usage: node score-carrytrust.cjs [--arms none|s|sr|s,sr]
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SEASONS = [2022, 2023, 2024, 2025, 2026];

const BASELINE_DIR = path.join(__dirname, "..", "..", "..", "reports", "rpnoise-baseline-260905");
const EPA_DIR = path.join(__dirname, "..", "..", "..", "reports", "autopsy-260905");
const ARM_DIR = (name) => path.join(__dirname, "..", "..", "..", "reports", `carrytrust-${name}-260905`);

const EXPECTED_VERSIONS = {
  baseline: "9.0.0+rolling-2026-09c",
  epa: "5.0.0+baseline",
  s: "9.0.0+rolling-2026-09c",
  sr: "9.0.0+rolling-2026-09c",
};

function parseArgs(argv) {
  let armsArg = "none";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arms" && argv[i + 1] !== undefined) {
      armsArg = argv[i + 1];
      i++;
    }
  }
  if (armsArg === "none" || armsArg === "") return [];
  return armsArg.split(",").map((s) => s.trim()).filter(Boolean);
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
      algorithmVersion: row.algorithmVersion,
      pRedWin: row.pRedWin,
      actualWinner: row.actualWinner,
    });
    // Never retain `row` itself — the *Components blobs are the bulk of the line.
  }
}

function newMatchEntry(eventKey, actualWinner) {
  return { eventKey, actualWinner, series: {} };
}

async function scoreSeason(season, arms, versionsSeen) {
  const matches = new Map(); // matchKey -> { eventKey, actualWinner, series: { baseline, epa, s?, sr? } }
  const eventOrderSeen = new Set();
  const eventOrder = [];

  // 1. Baseline stream defines the match population and chronological event order.
  const baselineFile = path.join(BASELINE_DIR, `predictions-${season}.jsonl`);
  await streamLines(baselineFile, (rec) => {
    let entry = matches.get(rec.matchKey);
    if (!entry) {
      entry = newMatchEntry(rec.eventKey, rec.actualWinner);
      matches.set(rec.matchKey, entry);
    }
    entry.series.baseline = rec.pRedWin;
    versionsSeen.baseline.add(rec.algorithmVersion);
    if (!eventOrderSeen.has(rec.eventKey)) {
      eventOrderSeen.add(rec.eventKey);
      eventOrder.push(rec.eventKey);
    }
  });

  // 2. Epa stream — keyed by algorithmId==='epa' only. That directory also
  // holds a STALE vpr@8.0.0+rolling-2026-09b series which must never reach
  // any accumulator, so any non-epa row is dropped on read.
  const epaFile = path.join(EPA_DIR, `predictions-${season}.jsonl`);
  await streamLines(epaFile, (rec) => {
    if (rec.algorithmId !== "epa") return;
    const entry = matches.get(rec.matchKey);
    if (!entry) return; // no baseline entry -> cannot score; excluded downstream anyway
    entry.series.epa = rec.pRedWin;
    versionsSeen.epa.add(rec.algorithmVersion);
  });

  // 3. Each requested arm — keyed by the DIRECTORY it came from, never by
  // `algorithmId` (arm rows carry algorithmId==='vpr', same as baseline).
  for (const arm of arms) {
    const armFile = path.join(ARM_DIR(arm), `predictions-${season}.jsonl`);
    await streamLines(armFile, (rec) => {
      const entry = matches.get(rec.matchKey);
      if (!entry) return;
      entry.series[arm] = rec.pRedWin;
      versionsSeen[arm].add(rec.algorithmVersion);
    });
  }

  const requestedSeries = ["baseline", "epa", ...arms];

  const earlyEventCount = Math.ceil(eventOrder.length * 0.33);
  const earlyEvents = new Set(eventOrder.slice(0, earlyEventCount));

  let droppedOther = 0;
  let tieCount = 0;

  const stats = {};
  for (const s of requestedSeries) {
    stats[s] = { correct: 0, n: 0, brierSum: 0, earlyCorrect: 0, earlyN: 0 };
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
  if (x === "" || x === undefined) return "";
  if (Number.isNaN(x)) return "n/a";
  return x.toFixed(digits);
}

function baselineSe(stats) {
  const m = seriesMetrics(stats.baseline);
  const n = stats.baseline.n;
  const p = m.accuracy;
  return n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN;
}

function labelFor(s) {
  if (s === "baseline") return "baseline";
  if (s === "epa") return "epa";
  return s; // s, sr
}

function printTable(title, requestedSeries, stats, arms, se) {
  console.log(title);
  const header = ["series", "accuracy", "brier", "early_accuracy", "early_n", "scored_n", "se_units_delta"];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");
  for (const s of requestedSeries) {
    const m = seriesMetrics(stats[s]);
    let seUnits = "";
    if (arms.includes(s)) {
      seUnits = Number.isNaN(se) || se === 0 ? "n/a" : fmt((m.accuracy - seriesMetrics(stats.baseline).accuracy) / se, 2);
    }
    console.log(
      `| ${labelFor(s)} | ${fmt(m.accuracy)} | ${fmt(m.brier)} | ${fmt(m.earlyAccuracy)} | ${stats[s].earlyN} | ${stats[s].n} | ${seUnits} |`
    );
  }
  if (arms.includes("s") && arms.includes("sr")) {
    const sAcc = seriesMetrics(stats.s).accuracy;
    const srAcc = seriesMetrics(stats.sr).accuracy;
    const raw = srAcc - sAcc;
    const seUnits = Number.isNaN(se) || se === 0 ? "n/a" : fmt(raw / se, 2);
    console.log(`| sr-minus-s | ${fmt(raw)} |  |  |  |  | ${seUnits} |`);
  }
}

function printSeasonTable(result, arms) {
  const { season, requestedSeries, stats, droppedOther, tieCount, scoredN } = result;
  console.log(`\n## Season ${season}`);
  console.log(`scored_n=${scoredN} dropped_other=${droppedOther} ties=${tieCount}`);
  console.log("");
  const se = baselineSe(stats);
  printTable("", requestedSeries, stats, arms, se);
}

function printPooledTable(results, arms) {
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
  const se = baselineSe(pooled);
  printTable("", requestedSeries, pooled, arms, se);

  const totalScored = results.reduce((sum, r) => sum + r.scoredN, 0);
  console.log(`\nTOTAL_SCORED=${totalScored}`);
}

function printVersionGuard(arms, versionsSeen) {
  console.log(`\n## Version guard`);
  const seriesToCheck = ["baseline", "epa", ...arms];
  let ok = true;
  for (const s of seriesToCheck) {
    const seen = versionsSeen[s];
    const list = Array.from(seen).sort();
    const expected = EXPECTED_VERSIONS[s];
    const matches = list.length === 1 && list[0] === expected;
    if (!matches) ok = false;
    console.log(`${s}: seen=[${list.join(", ")}] expected=${expected} ${matches ? "OK" : "MISMATCH"}`);
  }
  if (!ok) {
    console.error("VERSION_GUARD_FAILED: a series carries an unexpected or non-unique algorithmVersion.");
    process.exitCode = 1;
  }
}

async function main() {
  const arms = parseArgs(process.argv.slice(2));
  console.log(`score-carrytrust.cjs — arms=${arms.length > 0 ? arms.join(",") : "none"}`);

  const versionsSeen = {
    baseline: new Set(),
    epa: new Set(),
    s: new Set(),
    sr: new Set(),
  };

  const results = [];
  for (const season of SEASONS) {
    const result = await scoreSeason(season, arms, versionsSeen);
    printSeasonTable(result, arms);
    results.push(result);
  }
  printPooledTable(results, arms);
  printVersionGuard(arms, versionsSeen);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
