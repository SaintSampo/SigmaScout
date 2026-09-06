#!/usr/bin/env node
"use strict";

/**
 * Quick task 260906-8i1, Task 1.
 *
 * Joins N+2 series on matchKey — baseline (vpr, reused from
 * reports/rpnoise-baseline-260905), epa (algorithmId==='epa' rows only, from
 * reports/autopsy-260905), and any number of gain-cap arms from
 * reports/gaincap-{arm}-260906 — scores accuracy/Brier over the full scored
 * set and an early-season slice, and prints BOTH deltas that matter:
 *
 *   - `d_base_se`  — arm minus promoted baseline, in baseline-SE units. The
 *                    Rule-A / ship-relevance reading (C-5).
 *   - `d_epa_pt`   — series minus EPA, in percentage points. THE GOAL (C-4).
 *                    Printed for the baseline too, so every table shows how
 *                    far the incumbent is from EPA on that same population.
 *
 * Adapted from
 * .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs
 * — same streaming discipline (never retain a parsed row; the *Components
 * blobs are the bulk of each line), same intersection rule (a match scores
 * only when EVERY requested series has a number for it), same tie exclusion,
 * same per-series version guard, same early slice (first 33% of events in
 * baseline chronological order). What is new: arbitrarily many arms resolved
 * by directory rather than two fixed names, the `d_epa_pt` column, and a
 * head-to-head verdict line per season.
 *
 * Usage: node score-attrib.cjs [--arms g60,g45,g30]
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SEASONS = [2022, 2023, 2024, 2025, 2026];
const REPO = path.join(__dirname, "..", "..", "..");

const BASELINE_DIR = path.join(REPO, "reports", "rpnoise-baseline-260905");
const EPA_DIR = path.join(REPO, "reports", "autopsy-260905");
const ARM_DIR = (name) => path.join(REPO, "reports", `attrib-${name}-260906`);

/**
 * Every arm is a working-tree patch of a CONSTANT inside carryover.ts — no
 * param-set change, no code-version bump — so every arm must still report the
 * promoted version string. An arm reporting anything else means the replay
 * did not read the pin this experiment claims it read, and the run is void.
 */
const BASELINE_VERSION = "9.0.0+rolling-2026-09c";
const EPA_VERSION = "5.0.0+baseline";

function parseArgs(argv) {
  let armsArg = "none";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arms" && argv[i + 1] !== undefined) {
      armsArg = argv[i + 1];
      i++;
    }
  }
  if (armsArg === "none" || armsArg === "") return [];
  return armsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    // Never retain `row` itself — the *Components blobs dominate the line.
  }
}

function newMatchEntry(eventKey, actualWinner) {
  return { eventKey, actualWinner, series: {} };
}

async function scoreSeason(season, arms, versionsSeen) {
  const matches = new Map();
  const eventOrderSeen = new Set();
  const eventOrder = [];

  // 1. Baseline stream defines the match population and chronological event order.
  await streamLines(path.join(BASELINE_DIR, `predictions-${season}.jsonl`), (rec) => {
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

  // 2. Epa stream — algorithmId==='epa' rows ONLY. That directory also holds a
  // STALE vpr@8.0.0+rolling-2026-09b series which must never reach an
  // accumulator, so any non-epa row is dropped on read.
  await streamLines(path.join(EPA_DIR, `predictions-${season}.jsonl`), (rec) => {
    if (rec.algorithmId !== "epa") return;
    const entry = matches.get(rec.matchKey);
    if (!entry) return;
    entry.series.epa = rec.pRedWin;
    versionsSeen.epa.add(rec.algorithmVersion);
  });

  // 3. Each requested arm — keyed by the DIRECTORY it came from, never by
  // `algorithmId` (arm rows carry algorithmId==='vpr', same as baseline).
  for (const arm of arms) {
    await streamLines(path.join(ARM_DIR(arm), `predictions-${season}.jsonl`), (rec) => {
      const entry = matches.get(rec.matchKey);
      if (!entry) return;
      entry.series[arm] = rec.pRedWin;
      versionsSeen[arm].add(rec.algorithmVersion);
    });
  }

  const requestedSeries = ["baseline", "epa", ...arms];
  const earlyEvents = new Set(eventOrder.slice(0, Math.ceil(eventOrder.length * 0.33)));

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
    if (!requestedSeries.every((s) => typeof entry.series[s] === "number")) {
      droppedOther++;
      continue;
    }
    const isEarly = earlyEvents.has(entry.eventKey);
    const actualRed = entry.actualWinner === "red" ? 1 : 0;
    for (const s of requestedSeries) {
      const p = entry.series[s];
      const correct = (p >= 0.5 ? "red" : "blue") === entry.actualWinner;
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
  return {
    accuracy: stat.n > 0 ? stat.correct / stat.n : NaN,
    brier: stat.n > 0 ? stat.brierSum / stat.n : NaN,
    earlyAccuracy: stat.earlyN > 0 ? stat.earlyCorrect / stat.earlyN : NaN,
  };
}

function fmt(x, digits = 4) {
  if (x === "" || x === undefined) return "";
  if (Number.isNaN(x)) return "n/a";
  return x.toFixed(digits);
}

function signed(x, digits = 2) {
  if (Number.isNaN(x)) return "n/a";
  return (x >= 0 ? "+" : "") + x.toFixed(digits);
}

function baselineSe(stats) {
  const p = seriesMetrics(stats.baseline).accuracy;
  const n = stats.baseline.n;
  return n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN;
}

function printTable(requestedSeries, stats, arms) {
  const se = baselineSe(stats);
  const epaAcc = seriesMetrics(stats.epa).accuracy;
  const baseAcc = seriesMetrics(stats.baseline).accuracy;

  const header = ["series", "accuracy", "brier", "early_acc", "scored_n", "d_base_se", "d_epa_pt"];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");
  for (const s of requestedSeries) {
    const m = seriesMetrics(stats[s]);
    const dBaseSe = arms.includes(s)
      ? Number.isNaN(se) || se === 0
        ? "n/a"
        : signed((m.accuracy - baseAcc) / se)
      : "";
    const dEpaPt = s === "epa" ? "" : signed((m.accuracy - epaAcc) * 100);
    console.log(
      `| ${s} | ${fmt(m.accuracy)} | ${fmt(m.brier)} | ${fmt(m.earlyAccuracy)} | ${stats[s].n} | ${dBaseSe} | ${dEpaPt} |`
    );
  }

  // C-4 verdict: does any VPR series out-accuracy EPA on this population?
  const winners = requestedSeries
    .filter((s) => s !== "epa")
    .filter((s) => seriesMetrics(stats[s]).accuracy > epaAcc);
  console.log(
    winners.length > 0
      ? `\nBEATS_EPA: ${winners.join(", ")}`
      : `\nBEATS_EPA: none (best vpr series is ${signed(
          (Math.max(...requestedSeries.filter((s) => s !== "epa").map((s) => seriesMetrics(stats[s]).accuracy)) -
            epaAcc) *
            100
        )}pt vs epa)`
  );
}

function printSeasonTable(result, arms) {
  const { season, requestedSeries, stats, droppedOther, tieCount, scoredN } = result;
  console.log(`\n## Season ${season}`);
  console.log(`scored_n=${scoredN} dropped_other=${droppedOther} ties=${tieCount}\n`);
  printTable(requestedSeries, stats, arms);
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
  console.log(`total_dropped_other=${totalDroppedOther} total_ties=${totalTies}\n`);
  printTable(requestedSeries, pooled, arms);

  // C-5: Rule-A shape — pooled accuracy up AND pooled Brier not worse vs baseline.
  const base = seriesMetrics(pooled.baseline);
  console.log("");
  for (const arm of arms) {
    const m = seriesMetrics(pooled[arm]);
    const accUp = m.accuracy > base.accuracy;
    const brierOk = m.brier <= base.brier;
    console.log(
      `RULE_A ${arm}: acc ${signed((m.accuracy - base.accuracy) * 100)}pt (${accUp ? "up" : "DOWN"}), ` +
        `brier ${signed(m.brier - base.brier, 6)} (${brierOk ? "ok" : "WORSE"}) -> ${
          accUp && brierOk ? "PASSES" : "FAILS"
        }`
    );
  }

  console.log(`\nTOTAL_SCORED=${results.reduce((sum, r) => sum + r.scoredN, 0)}`);
}

function printVersionGuard(arms, versionsSeen) {
  console.log(`\n## Version guard`);
  let ok = true;
  for (const s of ["baseline", "epa", ...arms]) {
    const list = Array.from(versionsSeen[s]).sort();
    const expected = s === "epa" ? EPA_VERSION : BASELINE_VERSION;
    const good = list.length === 1 && list[0] === expected;
    if (!good) ok = false;
    console.log(`${s}: seen=[${list.join(", ")}] expected=${expected} ${good ? "OK" : "MISMATCH"}`);
  }
  if (!ok) {
    console.error("VERSION_GUARD_FAILED: a series carries an unexpected or non-unique algorithmVersion.");
    process.exitCode = 1;
  }
}

async function main() {
  const arms = parseArgs(process.argv.slice(2));
  console.log(`score-attrib.cjs — arms=${arms.length > 0 ? arms.join(",") : "none"}`);

  const versionsSeen = { baseline: new Set(), epa: new Set() };
  for (const arm of arms) versionsSeen[arm] = new Set();

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
