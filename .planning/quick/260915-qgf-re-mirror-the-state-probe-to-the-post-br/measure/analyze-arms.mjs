#!/usr/bin/env node
/**
 * CLI analyzer: joins `measure-arms.mjs`'s `driver.jsonl` to a `wrangler tail
 * --format json` capture by `seq`, and reports per-arm `cpuTime` statistics
 * plus named component differences. Plain Node ESM, no dependencies — only
 * native `node:fs`, `node:path` and `node:url`.
 *
 * Adapted from `260914-nhc/measure/analyze-arms.mjs`; that copy is left
 * untouched as the record of the 2026-09-14 run.
 *
 * WHAT IS NEW HERE, AND WHY IT IS THE LOAD-BEARING PART: the FRESH/REUSED
 * ISOLATE SPLIT. On 2026-09-14 a fresh isolate (`isolateRequest=1`) ran ~18 ms
 * even with RP fully OFF — platform cold-start, not component cost. Every
 * per-component number in that profile was therefore drawn from the REUSED
 * stratum, and a difference computed over the pooled samples prices cold-start
 * noise as if it were the component. This file now stratifies every arm and
 * reports each named difference twice, labelling which one is comparable.
 *
 * Emits aggregates only — never request headers or `cf`/geo fields. Raw tail
 * events and driver records stay wherever the caller pointed `--tail`/
 * `--driver`; this file never writes them anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARMS, DIFFERENCES, RETIRED_DIFFERENCES } from "./arms.mjs";

const NODE_WARM_REFERENCE_US = 4.6;
/** Below this, a stratum cannot support a per-component number and the report says so, loudly. */
const LOW_N_THRESHOLD = 8;

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

/**
 * The probe logs `isolateRequest=<n>` as the first thing it does on every
 * request: `1` means a brand-new isolate, anything higher a reused one.
 *
 * `tailEvent.logs[].message` is itself an ARRAY (wrangler mirrors
 * `console.log`'s varargs), whose members may be strings or arbitrary values,
 * so both shapes are handled and non-strings are skipped rather than
 * stringified into a false match. Returns `undefined` when the event carried
 * no such line at all — that sample lands in the `unknown` stratum and is
 * never silently counted as either of the others.
 */
export function extractIsolateRequest(tailEvent) {
  const logs = tailEvent?.logs;
  if (!Array.isArray(logs)) return undefined;
  for (const log of logs) {
    const message = log?.message;
    const parts = Array.isArray(message) ? message : [message];
    for (const part of parts) {
      if (typeof part !== "string") continue;
      const m = part.match(/isolateRequest=(\d+)/);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return undefined;
}

export const STRATA = ["fresh", "reused", "unknown"];

/** `1` is a brand-new isolate; anything higher is reused; absent is `unknown`. */
export function stratumOf(isolateRequest) {
  if (isolateRequest === undefined) return "unknown";
  return isolateRequest === 1 ? "fresh" : "reused";
}

// ---------------------------------------------------------------------------
// Join + filter: driver.jsonl records (already parsed, one object each) x
// tail events (from parseJsonStream), by seq.
// ---------------------------------------------------------------------------

/**
 * Builds, per arm: the kept `cpuTime` samples (each carrying its `fold`, its
 * `phaseB` and its isolate stratum for the invariant checks) and exclusion
 * counts (missing tail event, non-ok tail outcomes by name, id/phaseB
 * mismatches). Warm-up records are dropped up front — never counted in any
 * exclusion bucket, since they were never candidates.
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
    if (!exclusionsByArm.has(name)) exclusionsByArm.set(name, { missingTail: 0, nonOkOutcomes: new Map(), idMismatches: 0, phaseBMismatches: 0 });
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
    // Two arms share an `expectedId`, so without this a `phaseB=1` sample
    // could be pooled into the `phaseB=0` arm it echoes the same id as.
    if (rec.expectedPhaseB !== undefined && rec.echoedPhaseB !== rec.expectedPhaseB) {
      exclusions.phaseBMismatches++;
      continue;
    }
    if (rec.status !== 200 || rec.ok !== true) {
      // Not one of the named categories, but still a real exclusion — tracked
      // so a driver-level failure is never silently dropped from n.
      exclusions.nonOkOutcomes.set("driverNotOk", (exclusions.nonOkOutcomes.get("driverNotOk") ?? 0) + 1);
      continue;
    }
    const cpuTime = tailEvent.cpuTime;
    if (typeof cpuTime !== "number" || !Number.isFinite(cpuTime)) {
      exclusions.nonOkOutcomes.set("cpuTimeMissing", (exclusions.nonOkOutcomes.get("cpuTimeMissing") ?? 0) + 1);
      continue;
    }

    const isolateRequest = extractIsolateRequest(tailEvent);
    samples.push({ seq: rec.seq, cpuTime, fold: rec.fold, phaseB: rec.phaseB ?? null, isolateRequest, stratum: stratumOf(isolateRequest) });
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
  const a = computeArmStats(minuendSamples ?? []);
  const b = computeArmStats(subtrahendSamples ?? []);
  if (a.n === 0 || b.n === 0) {
    return { meanDiff: undefined, se: undefined, p50Diff: undefined, resolved: undefined, insufficientData: true, minuendN: a.n, subtrahendN: b.n };
  }
  const meanDiff = a.mean - b.mean;
  const se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  const p50Diff = a.p50 - b.p50;
  const resolved = Math.abs(meanDiff) >= 2 * se;
  return { meanDiff, se, p50Diff, resolved, insufficientData: false, minuendN: a.n, subtrahendN: b.n };
}

/** `samples` split into the three isolate strata, in `STRATA` order. */
export function splitByStratum(samples) {
  const out = { fresh: [], reused: [], unknown: [] };
  for (const s of samples ?? []) out[s.stratum].push(s);
  return out;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Counters that MUST be identical across every sample of every arm, or the
 * arms are not comparable at all. `upcomingScheduled` replaced
 * `upcomingPriced`: the tick prices no upcoming match, so what is constant now
 * is how many schedule rows were BUILT.
 */
const CONSTANT_ACROSS_ARMS_FIELDS = ["bandsProduced", "matchesFolded", "upcomingScheduled"];

/** Every `FoldResult` numeric/boolean field, checked for per-arm constancy across an arm's own samples. */
const FOLD_VECTOR_FIELDS = [
  "matchesFolded",
  "upcomingScheduled",
  "bandsProduced",
  "rpPmfsProduced",
  "rpObservedFolds",
  "rpBonusSidesCaptured",
  "rpMeanShiftObservations",
  "rpMeanShiftedAlliances",
  "rpBeliefTeamsResumed",
  "rpGatesOpened",
  "rpBeliefTeamsAttached",
  "rpMeanShiftAttached",
  "changedRowsDiscarded",
];

/**
 * Every `PhaseBResult` field. These are reported per arm and checked for
 * constancy WITHIN an arm, but are deliberately NOT in
 * `CONSTANT_ACROSS_ARMS_FIELDS`: they vary between the phaseB and non-phaseB
 * arms by design — that variation is the measurement.
 */
const PHASE_B_VECTOR_FIELDS = [
  "ran",
  "eventArtifactBytes",
  "teamArtifactBytes",
  "eventStateBlockPresent",
  "stateBlockSynthesized",
  "playedRowFactsBuilt",
  "mergedEventBytes",
  "mergedEventStateBlockPresent",
  "mergedEventStateRows",
  "mergedEventUpcomingRows",
  "mergedEventPlayedRows",
  "teamParsesRun",
  "teamMergesRun",
  "mergedTeamBytes",
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

  // 1. bandsProduced/matchesFolded/upcomingScheduled identical across EVERY sample of EVERY arm.
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

  // 2. Every arm's OWN fold + phaseB counter vectors constant across its own samples.
  const perArmConstant = { pass: true, deviations: [] };
  for (const [arm, samples] of samplesByArm) {
    if (samples.length === 0) continue;
    const baselineFold = samples[0].fold;
    const baselinePhaseB = samples[0].phaseB;
    for (const s of samples) {
      for (const field of FOLD_VECTOR_FIELDS) {
        if (s.fold?.[field] !== baselineFold?.[field]) {
          perArmConstant.pass = false;
          perArmConstant.deviations.push({ arm, seq: s.seq, field, expected: baselineFold?.[field], actual: s.fold?.[field] });
        }
      }
      for (const field of PHASE_B_VECTOR_FIELDS) {
        if (s.phaseB?.[field] !== baselinePhaseB?.[field]) {
          perArmConstant.pass = false;
          perArmConstant.deviations.push({ arm, seq: s.seq, field: `phaseB.${field}`, expected: baselinePhaseB?.[field], actual: s.phaseB?.[field] });
        }
      }
    }
  }

  // 3. The pmf gate is folded-only: the all arm opens exactly `matchesFolded`
  //    gates, and skipping the one remaining pmf loop opens none. (The old
  //    additivity check spanned two pmf loops; there is one now.)
  const firstFold = (arm) => samplesByArm.get(arm)?.[0]?.fold;
  const allFold = firstFold("all");
  const skipFoldedPmfFold = firstFold("skipFoldedPmf");
  let gatesFoldedOnly = { pass: undefined, allGates: undefined, matchesFolded: undefined, skipFoldedPmfGates: undefined };
  if (allFold && skipFoldedPmfFold) {
    gatesFoldedOnly = {
      pass: allFold.rpGatesOpened === allFold.matchesFolded && skipFoldedPmfFold.rpGatesOpened === 0,
      allGates: allFold.rpGatesOpened,
      matchesFolded: allFold.matchesFolded,
      skipFoldedPmfGates: skipFoldedPmfFold.rpGatesOpened,
    };
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

  return { crossArmConstant, perArmConstant, gatesFoldedOnly, pmfsUnaffectedByObserveOrBeliefs };
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

export function buildAggregates(samplesByArm, exclusionsByArm) {
  const armOrder = ARMS.map((a) => a.name).filter((name) => samplesByArm.has(name));
  const perArm = {};
  const strataByArm = new Map();
  const lowN = [];

  for (const name of armOrder) {
    const samples = samplesByArm.get(name);
    const strata = splitByStratum(samples);
    strataByArm.set(name, strata);
    const exclusions = exclusionsByArm.get(name);
    perArm[name] = {
      ...computeArmStats(samples),
      strata: { fresh: computeArmStats(strata.fresh), reused: computeArmStats(strata.reused), unknown: computeArmStats(strata.unknown) },
      foldVector: samples?.[0]?.fold ?? null,
      phaseBVector: samples?.[0]?.phaseB ?? null,
      exclusions: {
        missingTail: exclusions?.missingTail ?? 0,
        nonOkOutcomes: Object.fromEntries(exclusions?.nonOkOutcomes ?? []),
        idMismatches: exclusions?.idMismatches ?? 0,
        phaseBMismatches: exclusions?.phaseBMismatches ?? 0,
      },
    };
    for (const stratum of ["fresh", "reused"]) {
      const n = perArm[name].strata[stratum].n;
      if (n < LOW_N_THRESHOLD) lowN.push({ arm: name, stratum, n });
    }
  }

  const reusedOf = (name) => strataByArm.get(name)?.reused ?? [];

  const differences = {};
  for (const d of DIFFERENCES) {
    differences[d.label] = {
      meaning: d.meaning,
      minuend: d.minuend,
      subtrahend: d.subtrahend,
      reused: computeDifference(reusedOf(d.minuend), reusedOf(d.subtrahend)),
      overall: computeDifference(samplesByArm.get(d.minuend) ?? [], samplesByArm.get(d.subtrahend) ?? []),
    };
  }

  // Closure on the comparable stratum. `bothPmf` is retired; `foldedPmf` is
  // the whole pmf term now (skipping it forces `formula` off with it).
  const reusedDiff = (label) => differences[label]?.reused?.meanDiff;
  const closure =
    reusedDiff("total") !== undefined && reusedDiff("resume") !== undefined && reusedDiff("foldedPmf") !== undefined && reusedDiff("observe") !== undefined && reusedDiff("beliefs") !== undefined
      ? reusedDiff("total") - (reusedDiff("resume") + reusedDiff("foldedPmf") + reusedDiff("observe") + reusedDiff("beliefs"))
      : undefined;

  const allFold = samplesByArm.get("all")?.[0]?.fold;
  const perGateUs = allFold?.rpGatesOpened > 0 && reusedDiff("formula") !== undefined ? (reusedDiff("formula") / allFold.rpGatesOpened) * 1000 : undefined;

  const phaseBFold = samplesByArm.get("allPhaseB")?.[0]?.phaseB;
  const perTeamMergeUs =
    phaseBFold?.teamMergesRun > 0 && reusedDiff("phaseB") !== undefined ? (reusedDiff("phaseB") / phaseBFold.teamMergesRun) * 1000 : undefined;

  const invariants = checkInvariants(samplesByArm);

  return { perArm, differences, closure, perGateUs, perTeamMergeUs, lowN, invariants };
}

function printStatsRow(label, stats) {
  console.log(
    `${label}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}`
  );
}

function printReport(aggregates) {
  console.log("\n=== Per-arm cpuTime (ms), ALL isolates pooled ===");
  console.log("arm\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms\tmissingTail\tnonOk\tidMismatch\tphaseBMismatch");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    const nonOkTotal = Object.values(stats.exclusions.nonOkOutcomes).reduce((a, b) => a + b, 0);
    console.log(
      `${name}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}\t${stats.exclusions.missingTail}\t${nonOkTotal}\t${stats.exclusions.idMismatches}\t${stats.exclusions.phaseBMismatches}`
    );
    if (nonOkTotal > 0) {
      for (const [outcome, count] of Object.entries(stats.exclusions.nonOkOutcomes)) {
        console.log(`    non-ok outcome "${outcome}": ${count}`);
      }
    }
  }

  console.log("\n=== Per-arm cpuTime (ms), SPLIT BY ISOLATE ===");
  console.log("A `fresh` isolate (isolateRequest=1) pays platform cold-start. On 2026-09-14 the `none`");
  console.log("arm still ran ~18 ms fresh with RP fully OFF, so a fresh-isolate difference prices");
  console.log("cold-start, not the component. `unknown` = the tail event carried no isolateRequest line.");
  console.log("arm/stratum\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    for (const stratum of ["fresh", "reused", "unknown"]) {
      printStatsRow(`${name}/${stratum}`, stats.strata[stratum]);
    }
  }

  if (aggregates.lowN.length > 0) {
    console.log("\n*** LOW N — these strata cannot support a per-component number ***");
    for (const { arm, stratum, n } of aggregates.lowN) {
      console.log(`  !!! arm "${arm}" stratum "${stratum}" has n=${n} (< ${LOW_N_THRESHOLD}). Do NOT read a component cost off it.`);
    }
  }

  console.log("\n=== Differences (ms) — the REUSED column is the comparable one ===");
  console.log("Read the reused-stratum figures. The overall column is printed only so a large gap");
  console.log("between the two is visible: when it is large, cold-start is doing the work, not the component.");
  console.log("label\treusedMean\treusedSE\treusedP50\tresolved\toverallMean\toverallSE\tmeaning");
  for (const [label, d] of Object.entries(aggregates.differences)) {
    const r = d.reused;
    const o = d.overall;
    if (r.insufficientData && o.insufficientData) {
      console.log(`${label}\tinsufficient data (n=0 in "${d.minuend}" or "${d.subtrahend}")\t\t\t\t\t\t${d.meaning}`);
      continue;
    }
    console.log(
      `${label}\t${fmt1(r.meanDiff)}\t${fmt1(r.se)}\t${fmt1(r.p50Diff)}\t${r.insufficientData ? "n/a" : r.resolved ? "resolved" : "unresolved"}\t${fmt1(o.meanDiff)}\t${fmt1(o.se)}\t${d.meaning}`
    );
  }

  console.log("\n=== Differences RETIRED since the 2026-09-14 COMPONENT PROFILE (removed on purpose, not lost) ===");
  for (const r of RETIRED_DIFFERENCES) {
    console.log(`  ${r.label} (was ${r.wasMinuend} - ${r.wasSubtrahend}): ${r.reason}`);
  }

  if (aggregates.closure !== undefined) {
    console.log(
      `\nClosure on the reused stratum (non-additivity residual, never forced to zero): total - (resume + foldedPmf + observe + beliefs) = ${fmt1(aggregates.closure)} ms`
    );
  } else {
    console.log("\nClosure: insufficient data to compute");
  }

  if (aggregates.perGateUs !== undefined) {
    console.log(`Formula per-gate (reused formula meanDiff / all arm's rpGatesOpened): ${aggregates.perGateUs.toFixed(1)} µs/gate (Node warm reference: ${NODE_WARM_REFERENCE_US} µs)`);
  } else {
    console.log("Formula per-gate: insufficient data to compute");
  }
  if (aggregates.perTeamMergeUs !== undefined) {
    console.log(`Phase B per team merge (reused phaseB meanDiff / teamMergesRun): ${aggregates.perTeamMergeUs.toFixed(1)} µs/team — includes the event merge, so it is an upper bound per team`);
  } else {
    console.log("Phase B per team merge: insufficient data to compute");
  }

  console.log("\n=== Fold and phaseB counter vectors (first kept sample per arm) ===");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    console.log(`${name}\tfold=${JSON.stringify(stats.foldVector)}`);
    console.log(`${name}\tphaseB=${JSON.stringify(stats.phaseBVector)}`);
  }

  console.log("\n=== Invariants ===");
  const inv = aggregates.invariants;
  console.log(`bandsProduced/matchesFolded/upcomingScheduled constant across every sample of every arm: ${inv.crossArmConstant.pass ? "PASS" : "FAIL"}`);
  if (!inv.crossArmConstant.pass) {
    for (const dev of inv.crossArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);
  }
  console.log(`Each arm's fold + phaseB counter vectors constant across its own samples: ${inv.perArmConstant.pass ? "PASS" : "FAIL"}`);
  if (!inv.perArmConstant.pass) {
    for (const dev of inv.perArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);
  }
  console.log(
    `rpGatesOpened is folded-only (all === matchesFolded, skipFoldedPmf === 0): ${
      inv.gatesFoldedOnly.pass === undefined
        ? "n/a (insufficient data)"
        : inv.gatesFoldedOnly.pass
          ? "PASS"
          : `FAIL (all=${inv.gatesFoldedOnly.allGates} vs matchesFolded=${inv.gatesFoldedOnly.matchesFolded}; skipFoldedPmf=${inv.gatesFoldedOnly.skipFoldedPmfGates})`
    }`
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
    upcomingScheduled: 60,
    bandsProduced: 4,
    rpPmfsProduced: 2,
    rpObservedFolds: 4,
    rpBonusSidesCaptured: 2,
    rpMeanShiftObservations: 8,
    rpMeanShiftedAlliances: 4,
    rpBeliefTeamsResumed: 21,
    rpGatesOpened: 2,
    rpBeliefTeamsAttached: 21,
    rpMeanShiftAttached: true,
    changedRowsDiscarded: 5,
  };
  const records = [];
  const push = (seq, arm, warmup, echoedId, expectedId, echoedPhaseB = false, expectedPhaseB = false) =>
    records.push({
      seq,
      round: seq,
      warmup,
      arm,
      expectedId,
      expectedPhaseB,
      status: 200,
      echoedId,
      echoedPhaseB,
      ok: true,
      fold: { ...baseFold },
      phaseB: null,
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
  // Same id as armA, phaseB=1 requested but the probe echoed false -> excluded.
  push(16, "armD", false, "armA-id", "armA-id", false, true);
  push(100, "armA", true, "armA-id", "armA-id"); // warm-up: must never appear in n
  push(101, "armB", true, "armB-id", "armB-id"); // warm-up: must never appear in n

  return records;
}

function buildSelfTestTailText() {
  const toTailEvent = (seq, arm, cpuTime, outcome, isolateRequest, extraLogMessage) => {
    const logs = [];
    if (isolateRequest !== undefined) logs.push({ message: [`isolateRequest=${isolateRequest}`] });
    if (extraLogMessage !== undefined) logs.push({ message: [extraLogMessage] });
    return {
      outcome,
      cpuTime,
      ...(logs.length > 0 ? { logs } : {}),
      event: { request: { url: `https://sigmascout-state-probe.example.workers.dev/?season=2026&seq=${seq}&arm=${arm}` } },
    };
  };

  const armACpu = [8, 9, 10, 11, 12];
  // armA: seq 0 is a FRESH isolate, the other four reused.
  const armAIsolate = [1, 2, 3, 4, 5];
  const armBCpu = [20, 21, 22, 23, 24];
  // armB: every sample reused, so its fresh stratum is empty.
  const armBIsolate = [2, 3, 4, 5, 6];
  const events = [];
  for (let i = 0; i < armACpu.length; i++) {
    events.push(
      toTailEvent(i, "armA", armACpu[i], "ok", armAIsolate[i], i === 0 ? 'a note with a brace { and a quote " inside and a close brace }' : undefined)
    );
  }
  for (let i = 0; i < armBCpu.length; i++) events.push(toTailEvent(5 + i, "armB", armBCpu[i], "ok", armBIsolate[i]));
  // armC carries NO isolateRequest line at all -> the `unknown` stratum.
  events.push(toTailEvent(10, "armC", 9, "ok", undefined));
  events.push(toTailEvent(11, "armC", 10, "ok", undefined));
  events.push(toTailEvent(12, "armC", 11, "ok", undefined));
  events.push(toTailEvent(13, "armC", 999, "exceededCpu", 3)); // excluded via nonOkOutcomes
  events.push(toTailEvent(14, "armC", 5, "ok", 3)); // tail is fine; driver-side echoedId mismatch excludes it
  // seq 15: intentionally NO tail event, to exercise missingTail.
  events.push(toTailEvent(16, "armD", 7, "ok", 3)); // excluded via phaseBMismatches
  events.push(toTailEvent(100, "armA", 999, "ok", 1)); // warm-up
  events.push(toTailEvent(101, "armB", 999, "ok", 1)); // warm-up

  const chunks = events.map((event, i) => {
    if (i === 1) return JSON.stringify(event, null, 2); // pretty-printed, multi-line
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

  // 5 armA + 5 armB + 5 armC (seq10-14; seq15 deliberately has none) + 1 armD + 2 warm-up = 18.
  assertEqual(tailEvents.length, 18, "parseJsonStream: event count (mixed pretty/compact, embedded braces/quotes, junk text)");

  // The isolate extractor reads the ARRAY-shaped `message`, tolerates a
  // non-isolate log line beside it, and returns undefined when there is none.
  assertEqual(extractIsolateRequest(tailEvents[0]), 1, "extractIsolateRequest: array message alongside a noisy second log line");
  assertEqual(extractIsolateRequest(tailEvents[1]), 2, "extractIsolateRequest: pretty-printed event");
  assertEqual(extractIsolateRequest(tailEvents[10]), undefined, "extractIsolateRequest: no logs at all");
  assertEqual(extractIsolateRequest({ logs: [{ message: [42, null, "isolateRequest=7"] }] }), 7, "extractIsolateRequest: skips non-string members");
  assertEqual(extractIsolateRequest({ logs: [{ message: "isolateRequest=9" }] }), 9, "extractIsolateRequest: string-shaped message");
  assertEqual(stratumOf(1), "fresh", "stratumOf(1)");
  assertEqual(stratumOf(2), "reused", "stratumOf(2)");
  assertEqual(stratumOf(undefined), "unknown", "stratumOf(undefined)");

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

  // The split itself.
  const armAStrata = splitByStratum(samplesByArm.get("armA"));
  const armBStrata = splitByStratum(samplesByArm.get("armB"));
  const armCStrata = splitByStratum(samplesByArm.get("armC"));
  assertEqual(armAStrata.fresh.length, 1, "armA fresh stratum n");
  assertEqual(armAStrata.reused.length, 4, "armA reused stratum n");
  assertEqual(armAStrata.unknown.length, 0, "armA unknown stratum n");
  assertEqual(armBStrata.fresh.length, 0, "armB fresh stratum n (every sample reused)");
  assertEqual(armBStrata.reused.length, 5, "armB reused stratum n");
  assertEqual(armCStrata.unknown.length, 3, "armC unknown stratum n (no isolateRequest line)");

  assertEqual(fmt1(computeArmStats(armAStrata.fresh).mean), "8.0", "armA fresh mean (the cold sample alone)");
  assertEqual(fmt1(computeArmStats(armAStrata.reused).mean), "10.5", "armA reused mean");

  const armDExclusions = exclusionsByArm.get("armD");
  assertEqual(armDExclusions?.phaseBMismatches, 1, "armD phaseBMismatches exclusion count");
  assertEqual(samplesByArm.get("armD")?.length ?? 0, 0, "armD kept no sample (phaseB echo disagreed)");

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
  assertEqual(fmt1(bMinusA.meanDiff), "12.0", "armB - armA meanDiff (pooled)");
  assertEqual(fmt1(bMinusA.se), "1.0", "armB - armA SE (pooled)");
  assertEqual(bMinusA.resolved, true, "armB - armA resolved (pooled)");

  // The same difference on the REUSED stratum alone is SMALLER, because armA's
  // one cold sample was dragging the pooled mean down. That gap is the whole
  // reason the split exists.
  const bMinusAReused = computeDifference(armBStrata.reused, armAStrata.reused);
  assertEqual(fmt1(bMinusAReused.meanDiff), "11.5", "armB - armA meanDiff (reused stratum)");
  assertEqual(bMinusAReused.resolved, true, "armB - armA resolved (reused stratum)");

  // Unresolved: armC (mean 10.0) vs armA (mean 10.0) — same mean, well within noise.
  const cMinusA = computeDifference(samplesByArm.get("armC"), samplesByArm.get("armA"));
  assertEqual(fmt1(cMinusA.meanDiff), "0.0", "armC - armA meanDiff");
  assertEqual(cMinusA.resolved, false, "armC - armA resolved");

  // Low-n reporting: with these synthetic n values every stratum is under the
  // threshold, so the report must name them rather than print a clean table.
  const aggregates = buildAggregates(samplesByArm, exclusionsByArm);
  assertEqual(aggregates.lowN.every((entry) => entry.n < LOW_N_THRESHOLD), true, "lowN entries are all genuinely below the threshold");

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
