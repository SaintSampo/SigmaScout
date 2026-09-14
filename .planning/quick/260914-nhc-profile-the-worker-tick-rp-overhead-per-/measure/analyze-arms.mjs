#!/usr/bin/env node
/**
 * CLI analyzer: joins `measure-arms.mjs`'s `driver.jsonl` to a `wrangler tail
 * --format json` capture by `seq`, and reports per-arm `cpuTime` statistics
 * plus named component differences. Plain Node ESM, no dependencies — only
 * native `node:fs`, `node:path` and `node:url`.
 *
 * Emits aggregates only — never request headers or `cf`/geo fields. Raw tail
 * events and driver records stay wherever the caller pointed `--tail`/
 * `--driver`; this file never writes them anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARMS, DIFFERENCES } from "./arms.mjs";

const ARM_LABEL_MARKER = "ABLATED ARM";
const NODE_WARM_REFERENCE_US = 4.6;

// ---------------------------------------------------------------------------
// Tail parsing: a stream of concatenated JSON values, brace-depth/string-
// state tracked so pretty-printed and one-object-per-line output both parse,
// and text outside `{...}` (wrangler's own log lines) is ignored.
// ---------------------------------------------------------------------------

export function parseJsonStream(text) {
  const objects = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escapeNext = false;
      }
      continue;
    }

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        try {
          objects.push(JSON.parse(raw));
        } catch {
          // A malformed chunk (truncated capture, non-JSON wrangler banner
          // that happened to balance braces) is skipped, not fatal.
        }
        start = -1;
      }
    }
  }
  return objects;
}

/** `seq` from `event.request.url`'s search params — falls back to a regex if the URL fails to parse (e.g. a relative/partial capture). */
export function extractSeq(tailEvent) {
  const url = tailEvent?.event?.request?.url;
  if (typeof url !== "string") return undefined;
  try {
    const seqRaw = new URL(url).searchParams.get("seq");
    if (seqRaw === null) return undefined;
    const n = Number.parseInt(seqRaw, 10);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    const m = url.match(/[?&]seq=(\d+)/);
    return m ? Number.parseInt(m[1], 10) : undefined;
  }
}

// ---------------------------------------------------------------------------
// Join + filter: driver.jsonl records (already parsed, one object each) x
// tail events (from parseJsonStream), by seq.
// ---------------------------------------------------------------------------

function isArmLabelWarning(warning) {
  return typeof warning === "string" && warning.includes(ARM_LABEL_MARKER);
}

/**
 * Builds, per arm: the kept `cpuTime` samples (each carrying its `fold` for
 * the invariant checks) and exclusion counts (missing tail event, non-ok tail
 * outcomes by name, id mismatches). Warm-up records are dropped up front —
 * never counted in any exclusion bucket, since they were never candidates.
 */
export function joinAndFilter(driverRecords, tailEvents) {
  const tailBySeq = new Map();
  for (const event of tailEvents) {
    const seq = extractSeq(event);
    if (seq !== undefined) tailBySeq.set(seq, event);
  }

  const samplesByArm = new Map();
  const exclusionsByArm = new Map();

  const arm = (name) => {
    if (!samplesByArm.has(name)) samplesByArm.set(name, []);
    if (!exclusionsByArm.has(name)) exclusionsByArm.set(name, { missingTail: 0, nonOkOutcomes: new Map(), idMismatches: 0 });
    return { samples: samplesByArm.get(name), exclusions: exclusionsByArm.get(name) };
  };

  for (const rec of driverRecords) {
    if (rec.warmup) continue; // never a candidate; never counted
    const { samples, exclusions } = arm(rec.arm);

    const tailEvent = tailBySeq.get(rec.seq);
    if (tailEvent === undefined) {
      exclusions.missingTail++;
      continue;
    }
    const outcome = tailEvent.outcome;
    if (outcome !== "ok") {
      exclusions.nonOkOutcomes.set(outcome, (exclusions.nonOkOutcomes.get(outcome) ?? 0) + 1);
      continue;
    }
    if (rec.echoedId !== rec.expectedId) {
      exclusions.idMismatches++;
      continue;
    }
    if (rec.status !== 200 || rec.ok !== true) {
      // Not one of the three named categories, but still a real exclusion —
      // tracked so a driver-level failure is never silently dropped from n.
      exclusions.nonOkOutcomes.set("driverNotOk", (exclusions.nonOkOutcomes.get("driverNotOk") ?? 0) + 1);
      continue;
    }
    const cpuTime = tailEvent.cpuTime;
    if (typeof cpuTime !== "number" || !Number.isFinite(cpuTime)) {
      exclusions.nonOkOutcomes.set("cpuTimeMissing", (exclusions.nonOkOutcomes.get("cpuTimeMissing") ?? 0) + 1);
      continue;
    }

    samples.push({ seq: rec.seq, cpuTime, fold: rec.fold });
  }

  return { samplesByArm, exclusionsByArm };
}

// ---------------------------------------------------------------------------
// Statistics: percentiles by nearest-rank, mean, sample variance.
// ---------------------------------------------------------------------------

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Unbiased (n-1) sample variance. 0 for n < 2 — no spread is measurable from a single point. */
function sampleVariance(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSq = values.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return sumSq / (values.length - 1);
}

/** Nearest-rank percentile: rank = ceil(p/100 * n), clamped to [1, n], 1-indexed into the ascending-sorted array. */
function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return undefined;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * n), 1), n);
  return sortedAsc[rank - 1];
}

export function computeArmStats(samples) {
  const cpuTimes = samples.map((s) => s.cpuTime).slice().sort((a, b) => a - b);
  const n = cpuTimes.length;
  if (n === 0) {
    return { n: 0, p50: undefined, p75: undefined, p90: undefined, max: undefined, mean: undefined, pctOver10: undefined, variance: 0 };
  }
  const over10 = cpuTimes.filter((c) => c > 10).length;
  return {
    n,
    p50: percentile(cpuTimes, 50),
    p75: percentile(cpuTimes, 75),
    p90: percentile(cpuTimes, 90),
    max: cpuTimes[n - 1],
    mean: mean(cpuTimes),
    pctOver10: (over10 / n) * 100,
    variance: sampleVariance(cpuTimes),
  };
}

/** Mean difference (minuend - subtrahend), its standard error, the p50 difference, and whether |mean diff| >= 2*SE ("resolved" — never forced, just reported). */
export function computeDifference(minuendSamples, subtrahendSamples) {
  const a = computeArmStats(minuendSamples);
  const b = computeArmStats(subtrahendSamples);
  if (a.n === 0 || b.n === 0) {
    return { meanDiff: undefined, se: undefined, p50Diff: undefined, resolved: undefined, insufficientData: true };
  }
  const meanDiff = a.mean - b.mean;
  const se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  const p50Diff = a.p50 - b.p50;
  const resolved = Math.abs(meanDiff) >= 2 * se;
  return { meanDiff, se, p50Diff, resolved, insufficientData: false };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

const CONSTANT_ACROSS_ARMS_FIELDS = ["bandsProduced", "matchesFolded", "upcomingPriced"];
/** Every FoldResult numeric/boolean field, checked for per-arm constancy across an arm's own samples. */
const FOLD_VECTOR_FIELDS = [
  "matchesFolded",
  "upcomingPriced",
  "bandsProduced",
  "rpPmfsProduced",
  "rpObservedFolds",
  "rpMeanShiftObservations",
  "rpMeanShiftedAlliances",
  "rpBeliefTeamsResumed",
  "rpGatesOpened",
  "rpBeliefTeamsAttached",
  "rpMeanShiftAttached",
  "changedRowsDiscarded",
];

/**
 * Four invariants, each PASS/FAIL. `crossArmConstant` (bandsProduced etc.
 * identical across every sample of every arm) is the one that, on FAIL,
 * means the arms are not comparable at all — the caller exits 3 after
 * printing everything else, never silently continues.
 */
export function checkInvariants(samplesByArm) {
  const allSamples = [];
  for (const [arm, samples] of samplesByArm) {
    for (const s of samples) allSamples.push({ arm, ...s });
  }

  // 1. bandsProduced/matchesFolded/upcomingPriced identical across EVERY sample of EVERY arm.
  const crossArmConstant = { pass: true, field: undefined, deviations: [] };
  if (allSamples.length > 0) {
    const baseline = allSamples[0].fold;
    for (const field of CONSTANT_ACROSS_ARMS_FIELDS) {
      for (const s of allSamples) {
        if (s.fold?.[field] !== baseline?.[field]) {
          crossArmConstant.pass = false;
          crossArmConstant.deviations.push({ arm: s.arm, seq: s.seq, field, expected: baseline?.[field], actual: s.fold?.[field] });
        }
      }
    }
  }

  // 2. Every arm's OWN fold counter vector constant across its own samples.
  const perArmConstant = { pass: true, deviations: [] };
  for (const [arm, samples] of samplesByArm) {
    if (samples.length === 0) continue;
    const baseline = samples[0].fold;
    for (const s of samples) {
      for (const field of FOLD_VECTOR_FIELDS) {
        if (s.fold?.[field] !== baseline?.[field]) {
          perArmConstant.pass = false;
          perArmConstant.deviations.push({ arm, seq: s.seq, field, expected: baseline?.[field], actual: s.fold?.[field] });
        }
      }
    }
  }

  // 3. rpGatesOpened additive: skipFoldedPmf + skipUpcomingPmf === all.
  const firstFold = (arm) => samplesByArm.get(arm)?.[0]?.fold;
  const allFold = firstFold("all");
  const skipFoldedPmfFold = firstFold("skipFoldedPmf");
  const skipUpcomingPmfFold = firstFold("skipUpcomingPmf");
  let gatesAdditive = { pass: undefined, allGates: undefined, sumOfParts: undefined };
  if (allFold && skipFoldedPmfFold && skipUpcomingPmfFold) {
    const sumOfParts = skipFoldedPmfFold.rpGatesOpened + skipUpcomingPmfFold.rpGatesOpened;
    gatesAdditive = { pass: sumOfParts === allFold.rpGatesOpened, allGates: allFold.rpGatesOpened, sumOfParts };
  }

  // 4. rpPmfsProduced for skipObserve and skipBeliefs equals the all arm's.
  const skipObserveFold = firstFold("skipObserve");
  const skipBeliefsFold = firstFold("skipBeliefs");
  let pmfsUnaffectedByObserveOrBeliefs = { pass: undefined };
  if (allFold && skipObserveFold && skipBeliefsFold) {
    pmfsUnaffectedByObserveOrBeliefs = {
      pass: skipObserveFold.rpPmfsProduced === allFold.rpPmfsProduced && skipBeliefsFold.rpPmfsProduced === allFold.rpPmfsProduced,
      allPmfs: allFold.rpPmfsProduced,
      skipObservePmfs: skipObserveFold.rpPmfsProduced,
      skipBeliefsPmfs: skipBeliefsFold.rpPmfsProduced,
    };
  }

  return { crossArmConstant, perArmConstant, gatesAdditive, pmfsUnaffectedByObserveOrBeliefs };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usageError(message) {
  console.error(`analyze-arms: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { tail: undefined, driver: undefined, jsonOut: undefined, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--tail":
        args.tail = argv[++i];
        break;
      case "--driver":
        args.driver = argv[++i];
        break;
      case "--json-out":
        args.jsonOut = argv[++i];
        break;
      case "--self-test":
        args.selfTest = true;
        break;
      default:
        usageError(`unknown flag "${argv[i]}"`);
    }
  }
  return args;
}

function readDriverRecords(path) {
  const text = readFileSync(path, "utf8");
  const records = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    records.push(JSON.parse(trimmed));
  }
  return records;
}

function fmt1(n) {
  return n === undefined ? "n/a" : n.toFixed(1);
}

function buildAggregates(samplesByArm, exclusionsByArm) {
  const armOrder = ARMS.map((a) => a.name).filter((name) => samplesByArm.has(name));
  const perArm = {};
  for (const name of armOrder) {
    const stats = computeArmStats(samplesByArm.get(name));
    const exclusions = exclusionsByArm.get(name);
    perArm[name] = {
      ...stats,
      exclusions: {
        missingTail: exclusions?.missingTail ?? 0,
        nonOkOutcomes: Object.fromEntries(exclusions?.nonOkOutcomes ?? []),
        idMismatches: exclusions?.idMismatches ?? 0,
      },
    };
  }

  const differences = {};
  for (const d of DIFFERENCES) {
    const minuendSamples = samplesByArm.get(d.minuend) ?? [];
    const subtrahendSamples = samplesByArm.get(d.subtrahend) ?? [];
    differences[d.label] = { ...computeDifference(minuendSamples, subtrahendSamples), meaning: d.meaning, minuend: d.minuend, subtrahend: d.subtrahend };
  }

  const closure =
    differences.total?.meanDiff !== undefined &&
    differences.resume?.meanDiff !== undefined &&
    differences.bothPmf?.meanDiff !== undefined &&
    differences.observe?.meanDiff !== undefined &&
    differences.beliefs?.meanDiff !== undefined
      ? differences.total.meanDiff - (differences.resume.meanDiff + differences.bothPmf.meanDiff + differences.observe.meanDiff + differences.beliefs.meanDiff)
      : undefined;

  const allFold = samplesByArm.get("all")?.[0]?.fold;
  const skipUpcomingPmfFold = samplesByArm.get("skipUpcomingPmf")?.[0]?.fold;
  const upcomingGates = allFold && skipUpcomingPmfFold ? allFold.rpGatesOpened - skipUpcomingPmfFold.rpGatesOpened : undefined;
  const perPmfUs =
    upcomingGates !== undefined && upcomingGates > 0 && differences.upcomingPmf?.meanDiff !== undefined
      ? (differences.upcomingPmf.meanDiff / upcomingGates) * 1000
      : undefined;
  const perGateUs =
    allFold?.rpGatesOpened > 0 && differences.formula?.meanDiff !== undefined ? (differences.formula.meanDiff / allFold.rpGatesOpened) * 1000 : undefined;

  const invariants = checkInvariants(samplesByArm);

  return { perArm, differences, closure, upcomingGates, perPmfUs, perGateUs, invariants };
}

function printReport(aggregates) {
  console.log("\n=== Per-arm cpuTime (ms) ===");
  console.log("arm\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms\tmissingTail\tnonOk\tidMismatch");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    const nonOkTotal = Object.values(stats.exclusions.nonOkOutcomes).reduce((a, b) => a + b, 0);
    console.log(
      `${name}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}\t${stats.exclusions.missingTail}\t${nonOkTotal}\t${stats.exclusions.idMismatches}`
    );
    if (nonOkTotal > 0) {
      for (const [outcome, count] of Object.entries(stats.exclusions.nonOkOutcomes)) {
        console.log(`    non-ok outcome "${outcome}": ${count}`);
      }
    }
  }

  console.log("\n=== Differences (ms) ===");
  console.log("label\tmeanDiff\tSE\tp50Diff\tresolved\tmeaning");
  for (const [label, d] of Object.entries(aggregates.differences)) {
    if (d.insufficientData) {
      console.log(`${label}\tinsufficient data (n=0 in "${d.minuend}" or "${d.subtrahend}")\t\t\t\t${d.meaning}`);
      continue;
    }
    console.log(`${label}\t${fmt1(d.meanDiff)}\t${fmt1(d.se)}\t${fmt1(d.p50Diff)}\t${d.resolved ? "resolved" : "unresolved"}\t${d.meaning}`);
  }

  if (aggregates.closure !== undefined) {
    console.log(
      `\nClosure (non-additivity residual, report never force to zero): total - (resume + bothPmf + observe + beliefs) = ${fmt1(aggregates.closure)} ms`
    );
  } else {
    console.log("\nClosure: insufficient data to compute");
  }

  if (aggregates.perPmfUs !== undefined) {
    console.log(`Per-pmf (upcomingPmf meanDiff / upcoming gates): ${aggregates.perPmfUs.toFixed(1)} µs/pmf (Node warm reference: ${NODE_WARM_REFERENCE_US} µs)`);
  } else {
    console.log("Per-pmf: insufficient data to compute");
  }
  if (aggregates.perGateUs !== undefined) {
    console.log(`Formula per-gate (formula meanDiff / all arm's rpGatesOpened): ${aggregates.perGateUs.toFixed(1)} µs/gate (Node warm reference: ${NODE_WARM_REFERENCE_US} µs)`);
  } else {
    console.log("Formula per-gate: insufficient data to compute");
  }

  console.log("\n=== Invariants ===");
  const inv = aggregates.invariants;
  console.log(`bandsProduced/matchesFolded/upcomingPriced constant across every sample of every arm: ${inv.crossArmConstant.pass ? "PASS" : "FAIL"}`);
  if (!inv.crossArmConstant.pass) {
    for (const dev of inv.crossArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);
  }
  console.log(`Each arm's fold counter vector constant across its own samples: ${inv.perArmConstant.pass ? "PASS" : "FAIL"}`);
  if (!inv.perArmConstant.pass) {
    for (const dev of inv.perArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);
  }
  console.log(
    `rpGatesOpened additive (skipFoldedPmf + skipUpcomingPmf === all): ${inv.gatesAdditive.pass === undefined ? "n/a (insufficient data)" : inv.gatesAdditive.pass ? "PASS" : `FAIL (${inv.gatesAdditive.sumOfParts} !== ${inv.gatesAdditive.allGates})`}`
  );
  console.log(
    `rpPmfsProduced for skipObserve/skipBeliefs equals all's: ${inv.pmfsUnaffectedByObserveOrBeliefs.pass === undefined ? "n/a (insufficient data)" : inv.pmfsUnaffectedByObserveOrBeliefs.pass ? "PASS" : "FAIL"}`
  );

  if (!inv.crossArmConstant.pass) {
    console.log("\nARMS NOT COMPARABLE");
  }
}

function runReal(args) {
  if (args.tail === undefined) usageError("--tail is required (unless --self-test)");
  if (args.driver === undefined) usageError("--driver is required (unless --self-test)");

  const tailText = readFileSync(args.tail, "utf8");
  const tailEvents = parseJsonStream(tailText);
  if (tailEvents.length === 0) {
    console.error("analyze-arms: no parseable JSON objects found in --tail file");
    process.exit(1);
  }
  const first = tailEvents[0];
  if (typeof first.cpuTime !== "number" || !Number.isFinite(first.cpuTime)) {
    console.error(`analyze-arms: first tail event has no numeric cpuTime — top-level keys: ${Object.keys(first).join(", ")}`);
    process.exit(1);
  }

  const driverRecords = readDriverRecords(args.driver);
  const { samplesByArm, exclusionsByArm } = joinAndFilter(driverRecords, tailEvents);
  const aggregates = buildAggregates(samplesByArm, exclusionsByArm);

  printReport(aggregates);

  if (args.jsonOut !== undefined) {
    writeFileSync(args.jsonOut, JSON.stringify(aggregates, null, 2), "utf8");
    console.log(`\nWrote aggregates to ${args.jsonOut}`);
  }

  if (!aggregates.invariants.crossArmConstant.pass) {
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// --self-test: synthetic data built in memory, no files touched.
// ---------------------------------------------------------------------------

function buildSelfTestDriverRecords() {
  const baseFold = {
    matchesFolded: 2,
    upcomingPriced: 60,
    bandsProduced: 124,
    rpPmfsProduced: 10,
    rpObservedFolds: 4,
    rpMeanShiftObservations: 16,
    rpMeanShiftedAlliances: 14,
    rpBeliefTeamsResumed: 21,
    rpGatesOpened: 10,
    rpBeliefTeamsAttached: 21,
    rpMeanShiftAttached: true,
    changedRowsDiscarded: 5,
  };
  const records = [];
  const push = (seq, arm, warmup, echoedId, expectedId) =>
    records.push({
      seq,
      round: seq,
      warmup,
      arm,
      expectedId,
      status: 200,
      echoedId,
      ok: true,
      fold: { ...baseFold },
      teamsLength: 21,
      algorithms: [{ id: "spr", ok: true, snapshotShapeVersionObserved: 16 }],
      shapeVersionExpected: 16,
      warnings: [],
      error: undefined,
    });

  for (let i = 0; i < 5; i++) push(i, "armA", false, "armA-id", "armA-id");
  for (let i = 0; i < 5; i++) push(5 + i, "armB", false, "armB-id", "armB-id");
  push(10, "armC", false, "armC-id", "armC-id");
  push(11, "armC", false, "armC-id", "armC-id");
  push(12, "armC", false, "armC-id", "armC-id");
  push(13, "armC", false, "armC-id", "armC-id"); // tail outcome exceededCpu -> excluded
  push(14, "armC", false, "MISMATCHED-id", "armC-id"); // echoedId mismatch -> excluded
  push(15, "armC", false, "armC-id", "armC-id"); // no tail event at all -> excluded (missingTail)
  push(100, "armA", true, "armA-id", "armA-id"); // warm-up: must never appear in n
  push(101, "armB", true, "armB-id", "armB-id"); // warm-up: must never appear in n

  return records;
}

function buildSelfTestTailText() {
  const toTailEvent = (seq, arm, cpuTime, outcome) => ({
    outcome,
    cpuTime,
    event: { request: { url: `https://sigmascout-state-probe.example.workers.dev/?season=2026&seq=${seq}&arm=${arm}` } },
  });

  const armACpu = [8, 9, 10, 11, 12];
  const armBCpu = [20, 21, 22, 23, 24];
  const events = [];
  for (let i = 0; i < armACpu.length; i++) events.push(toTailEvent(i, "armA", armACpu[i], "ok"));
  for (let i = 0; i < armBCpu.length; i++) events.push(toTailEvent(5 + i, "armB", armBCpu[i], "ok"));
  events.push(toTailEvent(10, "armC", 9, "ok"));
  events.push(toTailEvent(11, "armC", 10, "ok"));
  events.push(toTailEvent(12, "armC", 11, "ok"));
  events.push(toTailEvent(13, "armC", 999, "exceededCpu")); // excluded via nonOkOutcomes
  events.push(toTailEvent(14, "armC", 5, "ok")); // tail is fine; driver-side echoedId mismatch excludes it
  // seq 15: intentionally NO tail event, to exercise missingTail.
  events.push(toTailEvent(100, "armA", 999, "ok")); // warm-up
  events.push(toTailEvent(101, "armB", 999, "ok")); // warm-up

  const chunks = events.map((event, i) => {
    if (i === 0) {
      // Compact, with an embedded-braces + embedded-quote string, to stress the parser.
      const withNote = { ...event, logs: [{ message: 'a note with a brace { and a quote " inside and a close brace }' }] };
      return JSON.stringify(withNote);
    }
    if (i === 1) {
      // Pretty-printed, multi-line.
      return JSON.stringify(event, null, 2);
    }
    return JSON.stringify(event);
  });

  return `Connected to sigmascout-state-probe, waiting for events...\n${chunks.join("\n")}\nSome trailing non-JSON line\n`;
}

function runSelfTest() {
  const failures = [];
  const assertEqual = (actual, expected, label) => {
    if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };

  const driverRecords = buildSelfTestDriverRecords();
  const tailText = buildSelfTestTailText();
  const tailEvents = parseJsonStream(tailText);

  // 5 armA + 5 armB + 5 armC (seq10-14; seq15 deliberately has none) + 2 warm-up = 17.
  assertEqual(tailEvents.length, 17, "parseJsonStream: event count (mixed pretty/compact, embedded braces/quotes, junk text)");

  const { samplesByArm, exclusionsByArm } = joinAndFilter(driverRecords, tailEvents);

  const armA = computeArmStats(samplesByArm.get("armA") ?? []);
  const armB = computeArmStats(samplesByArm.get("armB") ?? []);
  const armC = computeArmStats(samplesByArm.get("armC") ?? []);

  assertEqual(armA.n, 5, "armA n (warm-up seq 100 excluded)");
  assertEqual(armA.p50, 10, "armA p50");
  assertEqual(fmt1(armA.mean), "10.0", "armA mean");
  assertEqual(fmt1(armA.pctOver10), "40.0", "armA %>10ms");

  assertEqual(armB.n, 5, "armB n (warm-up seq 101 excluded)");
  assertEqual(armB.p50, 22, "armB p50");
  assertEqual(fmt1(armB.mean), "22.0", "armB mean");
  assertEqual(fmt1(armB.pctOver10), "100.0", "armB %>10ms");

  assertEqual(armC.n, 3, "armC n (seq13 exceededCpu, seq14 idMismatch, seq15 missingTail all excluded)");
  assertEqual(armC.p50, 10, "armC p50");
  assertEqual(fmt1(armC.mean), "10.0", "armC mean");
  assertEqual(fmt1(armC.pctOver10), "33.3", "armC %>10ms");

  const armCExclusions = exclusionsByArm.get("armC");
  assertEqual(armCExclusions?.missingTail, 1, "armC missingTail exclusion count");
  assertEqual(armCExclusions?.nonOkOutcomes.get("exceededCpu"), 1, "armC nonOkOutcomes.exceededCpu exclusion count");
  assertEqual(armCExclusions?.idMismatches, 1, "armC idMismatches exclusion count");

  const armAExclusions = exclusionsByArm.get("armA");
  const armBExclusions = exclusionsByArm.get("armB");
  assertEqual(armAExclusions?.missingTail ?? 0, 0, "armA missingTail exclusion count (warm-up never counted)");
  assertEqual(armBExclusions?.missingTail ?? 0, 0, "armB missingTail exclusion count (warm-up never counted)");

  // Resolved: armB (mean 22.0) vs armA (mean 10.0) — a clean, well-separated difference.
  const bMinusA = computeDifference(samplesByArm.get("armB"), samplesByArm.get("armA"));
  assertEqual(fmt1(bMinusA.meanDiff), "12.0", "armB - armA meanDiff");
  assertEqual(fmt1(bMinusA.se), "1.0", "armB - armA SE");
  assertEqual(bMinusA.resolved, true, "armB - armA resolved");

  // Unresolved: armC (mean 10.0) vs armA (mean 10.0) — same mean, well within noise.
  const cMinusA = computeDifference(samplesByArm.get("armC"), samplesByArm.get("armA"));
  assertEqual(fmt1(cMinusA.meanDiff), "0.0", "armC - armA meanDiff");
  assertEqual(cMinusA.resolved, false, "armC - armA resolved");

  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  runReal(args);
}

const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main();
}
