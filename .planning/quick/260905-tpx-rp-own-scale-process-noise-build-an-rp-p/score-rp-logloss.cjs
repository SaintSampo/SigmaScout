#!/usr/bin/env node
/**
 * Quick task 260905-tpx, Instrument A — the missing RP-pmf log-loss
 * objective (`.planning/todos/pending/rp-process-noise-own-scale.md`).
 *
 * D-01's tuning objective (Brier over predicted win probability) is
 * structurally blind to `redRpPmf`/`blueRpPmf`. This script scores the
 * negative log-likelihood of each played qualification alliance's ACTUAL
 * total RP under that alliance's predicted pmf, so a change to the RP
 * process-noise parameters has something to be measured against.
 *
 * Plain CommonJS, run with bare `node`. Interface:
 *   node score-rp-logloss.cjs --series <label>=<dir>[,<label>=<dir>...]
 *
 * The FIRST label is the reference series every delta is measured against.
 *
 * Scored observation set: a row qualifies when algorithmId is "vpr",
 * compLevel is "qm", both redRpPmf and blueRpPmf are present, and the
 * corpus has a non-null RP total for its matchKey. Each qualifying row
 * contributes TWO scored observations (red + blue), each pairing one pmf
 * with its own side's actual RP total. Only matchKeys that qualify in
 * EVERY named series are scored, so all series share one denominator.
 *
 * Reading discipline: a five-season stream is ~240MB. Stream line by line
 * with readline, retain only the fields this script needs, never the
 * parsed object as a whole (the *Components blobs dominate line size).
 */
"use strict";

const fs = require("node:fs");
const readline = require("node:readline");
const path = require("node:path");
const Database = require("better-sqlite3");

const CORPUS_PATH = "data/corpus.sqlite";
const SEASONS = [2022, 2023, 2024, 2025, 2026];
// Floors the predicted mass at the actual outcome before taking -ln(). Sets
// the ceiling on how bad a single calibration failure can look.
const LOG_LOSS_EPSILON = 1e-6;

function parseArgs(argv) {
  let seriesArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--series") {
      seriesArg = argv[i + 1];
      i++;
    }
  }
  if (!seriesArg) {
    console.error("Usage: node score-rp-logloss.cjs --series <label>=<dir>[,<label>=<dir>...]");
    process.exit(1);
  }
  const series = seriesArg.split(",").map((entry) => {
    const eq = entry.indexOf("=");
    if (eq < 0) {
      console.error(`Malformed --series entry (expected label=dir): ${entry}`);
      process.exit(1);
    }
    return { label: entry.slice(0, eq), dir: entry.slice(eq + 1) };
  });
  if (series.length === 0) {
    console.error("At least one series is required.");
    process.exit(1);
  }
  return series;
}

/** Loads { matchKey -> { red, blue } } actual RP totals from the corpus, non-null only. */
function loadActualRp(corpusPath) {
  const db = new Database(corpusPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT match_key, red_rp_earned, blue_rp_earned FROM matches
         WHERE red_rp_earned IS NOT NULL AND blue_rp_earned IS NOT NULL`
      )
      .all();
    const map = new Map();
    for (const row of rows) {
      map.set(row.match_key, { red: row.red_rp_earned, blue: row.blue_rp_earned });
    }
    return map;
  } finally {
    db.close();
  }
}

/**
 * Streams one season's predictions-{season}.jsonl for one series, retaining
 * only the fields needed. Returns a Map<matchKey, RowShape> for qualifying
 * `vpr`/`qm`/pmf-present rows, plus the set of distinct vpr algorithmVersion
 * strings seen (including non-qualifying vpr rows, for the version guard).
 */
async function streamSeasonFile(filePath, versionSet) {
  const result = new Map();
  if (!fs.existsSync(filePath)) {
    return result;
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const parsed = JSON.parse(line);
    if (parsed.algorithmId === "vpr" && typeof parsed.algorithmVersion === "string") {
      versionSet.add(parsed.algorithmVersion);
    }
    if (
      parsed.algorithmId === "vpr" &&
      parsed.compLevel === "qm" &&
      Array.isArray(parsed.redRpPmf) &&
      Array.isArray(parsed.blueRpPmf)
    ) {
      result.set(parsed.matchKey, {
        matchKey: parsed.matchKey,
        season: parsed.season,
        eventKey: parsed.eventKey,
        pRedWin: parsed.pRedWin,
        redRpPmf: parsed.redRpPmf,
        blueRpPmf: parsed.blueRpPmf,
      });
    }
    // parsed goes out of scope here; nothing beyond the fields above is retained.
  }
  return result;
}

function pmfMassAt(pmf, index) {
  if (index < 0 || index >= pmf.length) return { mass: undefined, outOfRange: true };
  const value = pmf[index];
  if (!Number.isFinite(value)) return { mass: 0, outOfRange: false };
  return { mass: value, outOfRange: false };
}

function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdErr(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) / Math.sqrt(n);
}

function fmt(n, digits = 6) {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}

async function main() {
  const seriesSpecs = parseArgs(process.argv.slice(2));
  const referenceLabel = seriesSpecs[0].label;

  if (!fs.existsSync(CORPUS_PATH)) {
    console.error(`Corpus not found at ${CORPUS_PATH}`);
    process.exit(1);
  }
  const actualRp = loadActualRp(CORPUS_PATH);
  console.log(`Loaded ${actualRp.size} matches with non-null RP totals from ${CORPUS_PATH}.`);
  console.log(`LOG_LOSS_EPSILON = ${LOG_LOSS_EPSILON}`);
  console.log(`Reference series: ${referenceLabel}`);
  console.log("");

  // seriesData[label][season] = Map<matchKey, row>
  const seriesData = {};
  const versionsBySeries = {};
  for (const { label, dir } of seriesSpecs) {
    seriesData[label] = {};
    versionsBySeries[label] = new Set();
    for (const season of SEASONS) {
      const filePath = path.join(dir, `predictions-${season}.jsonl`);
      seriesData[label][season] = await streamSeasonFile(filePath, versionsBySeries[label]);
    }
  }

  console.log("Distinct vpr algorithmVersion values seen per series:");
  let versionFatal = false;
  for (const { label } of seriesSpecs) {
    const versions = Array.from(versionsBySeries[label]);
    console.log(`  ${label}: ${JSON.stringify(versions)}`);
    if (versions.length !== 1) versionFatal = true;
  }
  const allSameVersion =
    new Set(seriesSpecs.map(({ label }) => Array.from(versionsBySeries[label])[0])).size === 1;
  if (versionFatal) {
    console.log("FATAL: at least one series reports more than one (or zero) vpr algorithmVersion.");
  }
  if (!allSameVersion) {
    console.log("FATAL: series report DIFFERENT vpr algorithmVersion values.");
  }
  console.log("");

  // Per-season, build the matchKey intersection across all series.
  const seasonTables = [];
  let totalScored = 0;
  let grandOutOfRange = 0;

  // Pooled accumulators across all seasons, per series.
  const pooled = {};
  for (const { label } of seriesSpecs) {
    pooled[label] = { logLosses: [], zeroMass: 0, outOfRange: 0 };
  }
  // Pooled pRedWin diverged counts (per series, summed across seasons).
  const pooledDiverged = {};
  for (const { label } of seriesSpecs) pooledDiverged[label] = 0;

  for (const season of SEASONS) {
    // matchKeys present in every series' season map.
    const perSeriesKeys = seriesSpecs.map(({ label }) => seriesData[label][season]);
    let intersection = null;
    for (const map of perSeriesKeys) {
      const keys = new Set(map.keys());
      intersection = intersection === null ? keys : new Set([...intersection].filter((k) => keys.has(k)));
    }
    intersection = intersection || new Set();

    let droppedNotInAllSeries = 0;
    for (const map of perSeriesKeys) {
      for (const key of map.keys()) {
        if (!intersection.has(key)) droppedNotInAllSeries++;
      }
    }

    let droppedNoCorpusRp = 0;
    const scoredKeys = [];
    for (const key of intersection) {
      if (!actualRp.has(key)) {
        droppedNoCorpusRp++;
        continue;
      }
      scoredKeys.push(key);
    }

    const perSeriesStats = {};
    for (const { label } of seriesSpecs) {
      perSeriesStats[label] = { logLosses: [], zeroMass: 0, outOfRange: 0 };
    }

    for (const key of scoredKeys) {
      const actual = actualRp.get(key);
      for (const { label } of seriesSpecs) {
        const row = seriesData[label][season].get(key);
        const stats = perSeriesStats[label];

        for (const side of ["red", "blue"]) {
          const pmf = side === "red" ? row.redRpPmf : row.blueRpPmf;
          const actualTotal = side === "red" ? actual.red : actual.blue;
          const { mass, outOfRange } = pmfMassAt(pmf, actualTotal);
          if (outOfRange) {
            stats.outOfRange++;
            grandOutOfRange++;
            continue;
          }
          const effectiveMass = Math.max(mass, LOG_LOSS_EPSILON);
          if (mass === 0) stats.zeroMass++;
          const logLoss = -Math.log(effectiveMass);
          stats.logLosses.push(logLoss);
        }
      }
    }

    // Win-probability guard: compare pRedWin against the reference series
    // for every scored matchKey using Object.is.
    const refMapForSeason = seriesData[referenceLabel][season];
    const seasonDiverged = {};
    for (const { label } of seriesSpecs) {
      if (label === referenceLabel) continue;
      let divergedCount = 0;
      for (const key of scoredKeys) {
        const refRow = refMapForSeason.get(key);
        const otherRow = seriesData[label][season].get(key);
        if (!Object.is(refRow.pRedWin, otherRow.pRedWin)) divergedCount++;
      }
      seasonDiverged[label] = divergedCount;
      pooledDiverged[label] += divergedCount;
    }

    // Accumulate pooled.
    for (const { label } of seriesSpecs) {
      pooled[label].logLosses.push(...perSeriesStats[label].logLosses);
      pooled[label].zeroMass += perSeriesStats[label].zeroMass;
      pooled[label].outOfRange += perSeriesStats[label].outOfRange;
    }

    totalScored += scoredKeys.length * 2;

    seasonTables.push({
      season,
      scoredMatchKeys: scoredKeys.length,
      scoredObservations: scoredKeys.length * 2,
      droppedNoCorpusRp,
      droppedNotInAllSeries,
      perSeriesStats,
      seasonDiverged,
    });
  }

  // Print per-season tables.
  for (const table of seasonTables) {
    console.log(`## Season ${table.season}`);
    console.log(
      `scoredMatchKeys=${table.scoredMatchKeys} scoredObservations=${table.scoredObservations} droppedNoCorpusRp=${table.droppedNoCorpusRp} droppedNotInAllSeries=${table.droppedNotInAllSeries}`
    );
    console.log("| series | meanLogLoss | n | zeroMass | outOfRange | SE | deltaFromRef(SEunits) |");
    console.log("|---|---|---|---|---|---|---|");
    const refStats = table.perSeriesStats[referenceLabel];
    const refMean = mean(refStats.logLosses);
    const refSe = stdErr(refStats.logLosses);
    for (const { label } of seriesSpecs) {
      const stats = table.perSeriesStats[label];
      const m = mean(stats.logLosses);
      const se = stdErr(stats.logLosses);
      const deltaSeUnits = label === referenceLabel ? "-" : fmt((m - refMean) / refSe, 4);
      console.log(
        `| ${label} | ${fmt(m)} | ${stats.logLosses.length} | ${stats.zeroMass} | ${stats.outOfRange} | ${fmt(se)} | ${deltaSeUnits} |`
      );
    }
    for (const [label, divergedCount] of Object.entries(table.seasonDiverged)) {
      console.log(
        divergedCount === 0
          ? `PRED_WIN_IDENTICAL series=${label} season=${table.season}`
          : `PRED_WIN_DIVERGED series=${label} season=${table.season} n=${divergedCount}`
      );
    }
    console.log("");
  }

  // Pooled row.
  console.log("## Pooled (all seasons, union of scored observations)");
  console.log("| series | meanLogLoss | n | zeroMass | outOfRange | SE | deltaFromRef(SEunits) |");
  console.log("|---|---|---|---|---|---|---|");
  const refPooledMean = mean(pooled[referenceLabel].logLosses);
  const refPooledSe = stdErr(pooled[referenceLabel].logLosses);
  for (const { label } of seriesSpecs) {
    const stats = pooled[label];
    const m = mean(stats.logLosses);
    const se = stdErr(stats.logLosses);
    const deltaSeUnits = label === referenceLabel ? "-" : fmt((m - refPooledMean) / refPooledSe, 4);
    console.log(
      `| ${label} | ${fmt(m)} | ${stats.logLosses.length} | ${stats.zeroMass} | ${stats.outOfRange} | ${fmt(se)} | ${deltaSeUnits} |`
    );
  }
  console.log("");
  console.log("## Pooled win-probability guard (summed across seasons)");
  for (const [label, divergedCount] of Object.entries(pooledDiverged)) {
    console.log(
      divergedCount === 0 ? `PRED_WIN_IDENTICAL series=${label} (pooled)` : `PRED_WIN_DIVERGED series=${label} (pooled) n=${divergedCount}`
    );
  }

  if (grandOutOfRange > 0) {
    console.log("");
    console.log(`FATAL: outOfRange=${grandOutOfRange} across all seasons/series — pmf index and corpus RP column scale MISMATCH. Halt and reconcile.`);
  }

  console.log("");
  console.log(`TOTAL_SCORED=${totalScored}`);
}

main().catch((err) => {
  console.error("score-rp-logloss failed:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
