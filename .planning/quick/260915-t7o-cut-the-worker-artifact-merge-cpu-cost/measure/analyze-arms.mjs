#!/usr/bin/env node
/**
 * CLI analyzer: joins `measure-arms.mjs`'s `driver.jsonl` to a `wrangler tail
 * --format json` capture by `seq`, and reports per-arm `cpuTime` statistics,
 * the measured Phase B component differences, and the derived residuals.
 * Plain Node ESM, no dependencies — only native `node:fs`, `node:path` and
 * `node:url`.
 *
 * Adapted from `260915-qgf/measure/analyze-arms.mjs`; that copy is left
 * untouched as the record of the 2026-09-15 run.
 *
 * WHAT IS CARRIED OVER, AND STILL LOAD-BEARING: the FRESH/REUSED ISOLATE
 * SPLIT. A fresh isolate (`isolateRequest=1`) pays platform cold-start — on
 * 2026-09-14 the fully-ablated arm still ran ~18 ms — so a difference computed
 * over pooled samples prices cold-start noise as if it were the component.
 * Every number worth reading here is the REUSED column.
 *
 * WHAT IS NEW HERE:
 *   1. DERIVED RESIDUALS, printed in their own block and flagged as derived.
 *      Each is a linear combination of ARM MEANS, so its SE is propagated from
 *      the arm variances (sqrt(Σ cᵢ²·varᵢ/nᵢ)) rather than by adding the SEs of
 *      differences that all share the `allPhaseB` arm and are correlated.
 *   2. CROSS-ARM COUNTER EQUALITY, WHERE THE COMPONENT RAN. If two arms merged
 *      different artifacts, their cpuTime difference is not a component cost
 *      and averaging over it invents a number. A mismatch is REPORTED, loudly,
 *      and exits non-zero — the same treatment `bandsProduced` already gets.
 *   3. A RESHAPE CHECK. Every `scheduled` arm must report the same non-zero
 *      reshaped-row count and reshaped size, and every `published` arm zero —
 *      which is what makes "the reshape cancels in the difference pair" a
 *      checked fact rather than a claim in a comment.
 *
 * Emits aggregates only — never request headers or `cf`/geo fields.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARMS, DIFFERENCES, DERIVED_DIFFERENCES, RETIRED_DIFFERENCES, PHASE_B_CONSTANT_WHERE_RAN, RESHAPE_FIELDS, SCHEDULED_SHAPE_ARMS } from "./arms.mjs";

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

/** `seq` from `event.request.url`'s search params — falls back to a regex if the URL fails to parse. */
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
 * `tailEvent.logs[].message` is itself an ARRAY, whose members may be strings
 * or arbitrary values, so both shapes are handled and non-strings skipped.
 * Returns `undefined` when the event carried no such line — that sample lands
 * in the `unknown` stratum and is never silently counted as either other.
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
// Join + filter
// ---------------------------------------------------------------------------

/**
 * Builds, per arm: the kept `cpuTime` samples (each carrying its `fold`, its
 * `phaseB` and its isolate stratum) and exclusion counts. Warm-up records are
 * dropped up front — never counted in any exclusion bucket, since they were
 * never candidates.
 *
 * Four identity fields are checked, not two: eleven arms share an `expectedId`
 * and ten an `expectedPhaseB`, so without `phaseBArm.id` and `phaseBUpcoming`
 * a sample would be pooled into an arm that measured something else entirely.
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
    if (!exclusionsByArm.has(name)) {
      exclusionsByArm.set(name, {
        missingTail: 0,
        nonOkOutcomes: new Map(),
        idMismatches: 0,
        phaseBMismatches: 0,
        phaseBArmIdMismatches: 0,
        phaseBUpcomingMismatches: 0,
      });
    }
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
    if (rec.expectedPhaseB !== undefined && rec.echoedPhaseB !== rec.expectedPhaseB) {
      exclusions.phaseBMismatches++;
      continue;
    }
    if (rec.expectedPhaseBArmId !== undefined && rec.echoedPhaseBArmId !== rec.expectedPhaseBArmId) {
      exclusions.phaseBArmIdMismatches++;
      continue;
    }
    if (rec.expectedPhaseBUpcoming !== undefined && rec.echoedPhaseBUpcoming !== rec.expectedPhaseBUpcoming) {
      exclusions.phaseBUpcomingMismatches++;
      continue;
    }
    if (rec.status !== 200 || rec.ok !== true) {
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
// Statistics
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

/**
 * A DERIVED residual: Σ cᵢ · meanᵢ over the named arms, with the SE propagated
 * from the arm variances as sqrt(Σ cᵢ² · varᵢ / nᵢ).
 *
 * Computing it from ARM MEANS rather than from the differences it is written
 * as matters: the differences it is written as all share the `allPhaseB` arm
 * and are therefore correlated, so adding their SEs in quadrature would be
 * wrong. The arms themselves are separate requests and are treated as
 * independent, which is the assumption this SE rests on — state it when
 * quoting one.
 */
export function computeLinearCombination(coefficients, samplesByStratumArm) {
  let meanSum = 0;
  let varianceSum = 0;
  let minN = Infinity;
  for (const [armName, coefficient] of Object.entries(coefficients)) {
    const stats = computeArmStats(samplesByStratumArm(armName));
    if (stats.n === 0) {
      return { meanDiff: undefined, se: undefined, resolved: undefined, insufficientData: true, missingArm: armName };
    }
    meanSum += coefficient * stats.mean;
    varianceSum += coefficient * coefficient * (stats.variance / stats.n);
    minN = Math.min(minN, stats.n);
  }
  const se = Math.sqrt(varianceSum);
  return { meanDiff: meanSum, se, resolved: Math.abs(meanSum) >= 2 * se, insufficientData: false, minN };
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
 * Fold counters that MUST be identical across every sample of every arm. Every
 * arm in this rig runs the SAME full RP Phase A — Phase B is what varies — so
 * a deviation here means the arms are not comparable at all.
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
 * Every `PhaseBResult` field, checked for constancy WITHIN an arm. Across arms
 * they vary by design — that variation is the measurement — which is what
 * `PHASE_B_CONSTANT_WHERE_RAN` exists to handle instead.
 */
const PHASE_B_VECTOR_FIELDS = [
  "ran",
  "eventArtifactBytes",
  "teamArtifactBytes",
  "eventUpcomingReshapedRows",
  "reshapedEventTextBytes",
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

export function checkInvariants(samplesByArm) {
  const allSamples = [];
  for (const [arm, samples] of samplesByArm) {
    for (const s of samples) allSamples.push({ arm, ...s });
  }

  // 1. The fold vector's cross-arm constants.
  const crossArmConstant = { pass: true, deviations: [] };
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

  // 3. Phase B counters constant across every arm where the component RAN.
  //    A mismatch means two arms merged different artifacts, so their cpuTime
  //    difference is not a component cost. Reported, never averaged over.
  const phaseBConstantWhereRan = { pass: true, deviations: [], checked: [] };
  for (const { field, excluded } of PHASE_B_CONSTANT_WHERE_RAN) {
    const participating = allSamples.filter((s) => !excluded.includes(s.arm));
    if (participating.length === 0) continue;
    const baseline = participating[0].phaseB?.[field];
    const baselineArm = participating[0].arm;
    let fieldPass = true;
    for (const s of participating) {
      if (s.phaseB?.[field] !== baseline) {
        fieldPass = false;
        phaseBConstantWhereRan.pass = false;
        phaseBConstantWhereRan.deviations.push({ arm: s.arm, seq: s.seq, field, expected: baseline, expectedFrom: baselineArm, actual: s.phaseB?.[field] });
      }
    }
    phaseBConstantWhereRan.checked.push({ field, arms: [...new Set(participating.map((s) => s.arm))], value: baseline, pass: fieldPass });
  }

  // 4. The reshape ran identically in every `scheduled` arm and in NO
  //    `published` arm — what makes it cancel in the difference pair.
  const reshapeConsistent = { pass: true, deviations: [], scheduledValues: {}, publishedArms: [] };
  const scheduledSamples = allSamples.filter((s) => SCHEDULED_SHAPE_ARMS.includes(s.arm));
  const publishedPhaseBSamples = allSamples.filter((s) => !SCHEDULED_SHAPE_ARMS.includes(s.arm) && s.phaseB?.ran === true);
  for (const field of RESHAPE_FIELDS) {
    if (scheduledSamples.length > 0) {
      const baseline = scheduledSamples[0].phaseB?.[field];
      reshapeConsistent.scheduledValues[field] = baseline;
      if (!(typeof baseline === "number" && baseline > 0)) {
        reshapeConsistent.pass = false;
        reshapeConsistent.deviations.push({ arm: scheduledSamples[0].arm, seq: scheduledSamples[0].seq, field, expected: "> 0", actual: baseline });
      }
      for (const s of scheduledSamples) {
        if (s.phaseB?.[field] !== baseline) {
          reshapeConsistent.pass = false;
          reshapeConsistent.deviations.push({ arm: s.arm, seq: s.seq, field, expected: baseline, actual: s.phaseB?.[field] });
        }
      }
    }
    for (const s of publishedPhaseBSamples) {
      if (s.phaseB?.[field] !== 0) {
        reshapeConsistent.pass = false;
        reshapeConsistent.deviations.push({ arm: s.arm, seq: s.seq, field, expected: 0, actual: s.phaseB?.[field] });
      }
    }
  }
  reshapeConsistent.publishedArms = [...new Set(publishedPhaseBSamples.map((s) => s.arm))];

  // 5. The team half's root is honest: pbTeams0 really reports zero parses and
  //    zero merges, where the pre-260915-t7o probe reported one parse.
  const firstPhaseB = (armName) => samplesByArm.get(armName)?.[0]?.phaseB;
  const teams0 = firstPhaseB("pbTeams0");
  const fullPhaseB = firstPhaseB("allPhaseB");
  let teamRootHonest = { pass: undefined };
  if (teams0 && fullPhaseB) {
    teamRootHonest = {
      pass: teams0.teamParsesRun === 0 && teams0.teamMergesRun === 0 && fullPhaseB.teamParsesRun > 0 && fullPhaseB.teamMergesRun > 0,
      teams0Parses: teams0.teamParsesRun,
      teams0Merges: teams0.teamMergesRun,
      allPhaseBParses: fullPhaseB.teamParsesRun,
      allPhaseBMerges: fullPhaseB.teamMergesRun,
    };
  }

  return { crossArmConstant, perArmConstant, phaseBConstantWhereRan, reshapeConsistent, teamRootHonest };
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
        phaseBArmIdMismatches: exclusions?.phaseBArmIdMismatches ?? 0,
        phaseBUpcomingMismatches: exclusions?.phaseBUpcomingMismatches ?? 0,
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

  const derived = {};
  for (const d of DERIVED_DIFFERENCES) {
    derived[d.label] = {
      meaning: d.meaning,
      expression: d.expression,
      coefficients: d.coefficients,
      reused: computeLinearCombination(d.coefficients, reusedOf),
      overall: computeLinearCombination(d.coefficients, (name) => samplesByArm.get(name) ?? []),
    };
  }

  const reusedDiff = (label) => differences[label]?.reused?.meanDiff;

  // The two halves against the whole, on the comparable stratum. NEVER forced
  // to zero: a non-zero residual is a real fact about non-additivity, and
  // hiding it would be the same error as averaging over a counter mismatch.
  const closure =
    reusedDiff("phaseB") !== undefined && reusedDiff("eventHalf") !== undefined && reusedDiff("teamHalf") !== undefined
      ? reusedDiff("phaseB") - (reusedDiff("eventHalf") + reusedDiff("teamHalf"))
      : undefined;

  const phaseBVector = samplesByArm.get("allPhaseB")?.[0]?.phaseB;
  const perTeamUs = phaseBVector?.teamMergesRun > 0 && reusedDiff("teamHalf") !== undefined ? (reusedDiff("teamHalf") / phaseBVector.teamMergesRun) * 1000 : undefined;
  const eventPerKbUs =
    phaseBVector?.eventArtifactBytes > 0 && reusedDiff("eventHalf") !== undefined ? (reusedDiff("eventHalf") / (phaseBVector.eventArtifactBytes / 1024)) * 1000 : undefined;

  // The three quantities the Task 2 gate reads, computed once so nobody has to
  // recompute them by hand off the printed table.
  const validationTerm =
    derived.unionOrderPenalty !== undefined && differences.eventValidateScheduledShape?.reused?.meanDiff !== undefined && reusedDiff("teamValidate") !== undefined
      ? {
          value: differences.eventValidateScheduledShape.reused.meanDiff + reusedDiff("teamValidate"),
          se: Math.sqrt(differences.eventValidateScheduledShape.reused.se ** 2 + differences.teamValidate.reused.se ** 2),
        }
      : undefined;
  const thresholdQuantities = {
    unionOrderPenalty: derived.unionOrderPenalty?.reused,
    eventValidateScheduledShapePlusTeamValidate: validationTerm,
    teamHalfShareOfPhaseB:
      reusedDiff("teamHalf") !== undefined && reusedDiff("phaseB") !== undefined && reusedDiff("phaseB") !== 0 ? reusedDiff("teamHalf") / reusedDiff("phaseB") : undefined,
  };

  const invariants = checkInvariants(samplesByArm);

  return { perArm, differences, derived, closure, perTeamUs, eventPerKbUs, thresholdQuantities, lowN, invariants };
}

function printStatsRow(label, stats) {
  console.log(`${label}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}`);
}

function printReport(aggregates) {
  console.log("\n=== Per-arm cpuTime (ms), ALL isolates pooled ===");
  console.log("arm\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms\tmissingTail\tnonOk\tidMism\tpbMism\tpbArmMism\tpbUpcMism");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    const ex = stats.exclusions;
    const nonOkTotal = Object.values(ex.nonOkOutcomes).reduce((a, b) => a + b, 0);
    console.log(
      `${name}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}\t${ex.missingTail}\t${nonOkTotal}\t${ex.idMismatches}\t${ex.phaseBMismatches}\t${ex.phaseBArmIdMismatches}\t${ex.phaseBUpcomingMismatches}`
    );
    if (nonOkTotal > 0) {
      for (const [outcome, count] of Object.entries(ex.nonOkOutcomes)) console.log(`    non-ok outcome "${outcome}": ${count}`);
    }
  }

  console.log("\n=== Per-arm cpuTime (ms), SPLIT BY ISOLATE ===");
  console.log("A `fresh` isolate (isolateRequest=1) pays platform cold-start, so a fresh-isolate");
  console.log("difference prices cold-start, not the component. `unknown` = no isolateRequest line.");
  console.log("arm/stratum\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    for (const stratum of ["fresh", "reused", "unknown"]) printStatsRow(`${name}/${stratum}`, stats.strata[stratum]);
  }

  if (aggregates.lowN.length > 0) {
    console.log("\n*** LOW N — these strata cannot support a per-component number ***");
    for (const { arm, stratum, n } of aggregates.lowN) {
      console.log(`  !!! arm "${arm}" stratum "${stratum}" has n=${n} (< ${LOW_N_THRESHOLD}). Do NOT read a component cost off it.`);
    }
  }

  console.log("\n=== MEASURED differences (ms) — the REUSED column is the comparable one ===");
  console.log("Each row is two real arms subtracted. The overall column is printed only so a large");
  console.log("gap between the two is visible: when it is large, cold-start is doing the work.");
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

  console.log("\n=== DERIVED residuals (ms) — NOT measured arms ===");
  console.log("Every row below is a linear combination of arm means, not a difference of two arms.");
  console.log("A residual ABSORBS whatever the measured terms did not account for, including any");
  console.log("non-additivity between them, so it is an estimate with a remainder in it — never");
  console.log("quote one as a measurement of the thing its label names. The SE is propagated from");
  console.log("the arm variances and assumes the arms are independent samples, which they are");
  console.log("(separate requests), but it does NOT account for any shared systematic drift.");
  console.log("label\treusedMean\treusedSE\tresolved\toverallMean\texpression\tmeaning");
  for (const [label, d] of Object.entries(aggregates.derived)) {
    const r = d.reused;
    const o = d.overall;
    if (r.insufficientData) {
      console.log(`${label}\tinsufficient data (arm "${r.missingArm}" has n=0)\t\t\t\t${d.expression}\t${d.meaning}`);
      continue;
    }
    console.log(`${label}\t${fmt1(r.meanDiff)}\t${fmt1(r.se)}\t${r.resolved ? "resolved" : "unresolved"}\t${fmt1(o.meanDiff)}\t${d.expression}\t${d.meaning}`);
  }

  console.log("\n=== Differences the qgf rig reported that this one does NOT (dropped on purpose) ===");
  for (const r of RETIRED_DIFFERENCES) {
    console.log(`  ${r.label} (was ${r.wasMinuend} - ${r.wasSubtrahend}): ${r.reason}`);
  }

  console.log("\n=== Threshold quantities (the numbers Task 2's gate reads) ===");
  const tq = aggregates.thresholdQuantities;
  const u = tq.unionOrderPenalty;
  console.log(
    `unionOrderPenalty (F1 bar: >= 3 ms AND resolved): ${u === undefined || u.insufficientData ? "insufficient data" : `${fmt1(u.meanDiff)} ± ${fmt1(u.se)} ms, ${u.resolved ? "RESOLVED" : "UNRESOLVED"}`}`
  );
  const v = tq.eventValidateScheduledShapePlusTeamValidate;
  console.log(
    `eventValidateScheduledShape + teamValidate (F2 bar: >= 8 ms AND resolved): ${
      v === undefined ? "insufficient data" : `${fmt1(v.value)} ± ${fmt1(v.se)} ms, ${Math.abs(v.value) >= 2 * v.se ? "RESOLVED" : "UNRESOLVED"}`
    }`
  );
  console.log(`teamHalf as a share of phaseB (the F3 recommendation's argument): ${tq.teamHalfShareOfPhaseB === undefined ? "insufficient data" : `${(tq.teamHalfShareOfPhaseB * 100).toFixed(1)}%`}`);

  if (aggregates.closure !== undefined) {
    console.log(`\nClosure on the reused stratum (never forced to zero): phaseB - (eventHalf + teamHalf) = ${fmt1(aggregates.closure)} ms`);
  } else {
    console.log("\nClosure: insufficient data to compute");
  }
  console.log(
    aggregates.perTeamUs !== undefined
      ? `teamHalf per team artifact (teamHalf / teamMergesRun): ${aggregates.perTeamUs.toFixed(1)} µs/team`
      : "teamHalf per team artifact: insufficient data to compute"
  );
  console.log(
    aggregates.eventPerKbUs !== undefined
      ? `eventHalf per KB of fetched event artifact: ${aggregates.eventPerKbUs.toFixed(1)} µs/KB`
      : "eventHalf per KB: insufficient data to compute"
  );

  console.log("\n=== Fold and phaseB counter vectors (first kept sample per arm) ===");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    console.log(`${name}\tfold=${JSON.stringify(stats.foldVector)}`);
    console.log(`${name}\tphaseB=${JSON.stringify(stats.phaseBVector)}`);
  }

  console.log("\n=== Invariants ===");
  const inv = aggregates.invariants;
  console.log(`bandsProduced/matchesFolded/upcomingScheduled constant across every sample of every arm: ${inv.crossArmConstant.pass ? "PASS" : "FAIL"}`);
  for (const dev of inv.crossArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(`Each arm's fold + phaseB counter vectors constant across its own samples: ${inv.perArmConstant.pass ? "PASS" : "FAIL"}`);
  for (const dev of inv.perArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(`Phase B counters identical across every arm where the component RAN: ${inv.phaseBConstantWhereRan.pass ? "PASS" : "FAIL"}`);
  for (const c of inv.phaseBConstantWhereRan.checked) {
    console.log(`    ${c.pass ? "ok  " : "FAIL"} ${c.field}=${c.value} across ${c.arms.length} arm(s): ${c.arms.join(", ")}`);
  }
  for (const dev of inv.phaseBConstantWhereRan.deviations) {
    console.log(`    !!! arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} (from ${dev.expectedFrom}) actual=${dev.actual}`);
  }

  console.log(`The reshape ran identically in every scheduled arm and in no published arm: ${inv.reshapeConsistent.pass ? "PASS" : "FAIL"}`);
  console.log(`    scheduled arms report ${JSON.stringify(inv.reshapeConsistent.scheduledValues)}; published phaseB arms checked: ${inv.reshapeConsistent.publishedArms.join(", ") || "(none)"}`);
  for (const dev of inv.reshapeConsistent.deviations) console.log(`    !!! arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(
    `The team half's root is honest (pbTeams0 reports 0 parses and 0 merges): ${
      inv.teamRootHonest.pass === undefined
        ? "n/a (insufficient data)"
        : inv.teamRootHonest.pass
          ? `PASS (pbTeams0 ${inv.teamRootHonest.teams0Parses}/${inv.teamRootHonest.teams0Merges}, allPhaseB ${inv.teamRootHonest.allPhaseBParses}/${inv.teamRootHonest.allPhaseBMerges})`
          : `FAIL (pbTeams0 ${inv.teamRootHonest.teams0Parses}/${inv.teamRootHonest.teams0Merges}, allPhaseB ${inv.teamRootHonest.allPhaseBParses}/${inv.teamRootHonest.allPhaseBMerges})`
    }`
  );

  if (!inv.crossArmConstant.pass || !inv.phaseBConstantWhereRan.pass || !inv.reshapeConsistent.pass) {
    console.log("\nARMS NOT COMPARABLE — discard these numbers rather than quoting them");
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

  const inv = aggregates.invariants;
  if (!inv.crossArmConstant.pass || !inv.phaseBConstantWhereRan.pass || !inv.reshapeConsistent.pass) {
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// --self-test: synthetic data built in memory, no files touched.
//
// Unlike qgf's copy this uses the REAL arm names, so `buildAggregates` actually
// produces the differences, the derived residuals and the invariants — a
// self-test on invented arm names exercises the statistics and nothing else.
// ---------------------------------------------------------------------------

/** Eight samples centred on `m`: mean exactly `m`, sample variance exactly 24, so every SE below is checkable by hand. */
function samplesAround(m) {
  return [m - 7, m - 5, m - 3, m - 1, m + 1, m + 3, m + 5, m + 7];
}

/** Arm means chosen so every difference and every residual is a round number. */
const SELF_TEST_MEANS = {
  all: 50,
  allPhaseB: 114,
  pbSkipEventParse: 84,
  pbSkipEventValidate: 106,
  pbSkipEventMerge: 100,
  pbSkipEventStringify: 108,
  pbTeams0: 80,
  pbSkipTeamValidate: 104,
  pbSkipTeamMerge: 96,
  pbSkipTeamStringify: 107,
  pbSchedAll: 118,
  pbSchedSkipEventParse: 88,
  pbSchedSkipEventValidate: 105,
};

const SELF_TEST_FOLD = {
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

const SELF_TEST_PHASE_B_FULL = {
  ran: true,
  eventArtifactBytes: 106000,
  teamArtifactBytes: 32000,
  eventUpcomingReshapedRows: 0,
  reshapedEventTextBytes: 0,
  eventStateBlockPresent: false,
  stateBlockSynthesized: true,
  playedRowFactsBuilt: 2,
  mergedEventBytes: 170000,
  mergedEventStateBlockPresent: true,
  mergedEventStateRows: 22,
  mergedEventUpcomingRows: 60,
  mergedEventPlayedRows: 2,
  teamParsesRun: 12,
  teamMergesRun: 12,
  mergedTeamBytes: 400000,
};

const SELF_TEST_PHASE_B_OFF = Object.fromEntries(
  Object.entries(SELF_TEST_PHASE_B_FULL).map(([k, v]) => [k, typeof v === "boolean" ? false : 0])
);

const EVENT_MERGE_ZEROS = { mergedEventBytes: 0, mergedEventStateBlockPresent: false, mergedEventStateRows: 0, mergedEventUpcomingRows: 0, mergedEventPlayedRows: 0 };
const RESHAPED = { eventUpcomingReshapedRows: 60, reshapedEventTextBytes: 92000 };

/** The phaseB counter vector each arm legitimately reports, mirroring what the probe actually returns for that skip. */
const SELF_TEST_PHASE_B_BY_ARM = {
  all: SELF_TEST_PHASE_B_OFF,
  allPhaseB: SELF_TEST_PHASE_B_FULL,
  pbSkipEventParse: { ...SELF_TEST_PHASE_B_FULL, ...EVENT_MERGE_ZEROS },
  pbSkipEventValidate: SELF_TEST_PHASE_B_FULL,
  pbSkipEventMerge: { ...SELF_TEST_PHASE_B_FULL, ...EVENT_MERGE_ZEROS },
  pbSkipEventStringify: { ...SELF_TEST_PHASE_B_FULL, mergedEventBytes: 0 },
  pbTeams0: { ...SELF_TEST_PHASE_B_FULL, teamParsesRun: 0, teamMergesRun: 0, mergedTeamBytes: 0 },
  pbSkipTeamValidate: SELF_TEST_PHASE_B_FULL,
  pbSkipTeamMerge: { ...SELF_TEST_PHASE_B_FULL, teamMergesRun: 0, mergedTeamBytes: 0 },
  pbSkipTeamStringify: { ...SELF_TEST_PHASE_B_FULL, mergedTeamBytes: 0 },
  pbSchedAll: { ...SELF_TEST_PHASE_B_FULL, ...RESHAPED },
  pbSchedSkipEventParse: { ...SELF_TEST_PHASE_B_FULL, ...RESHAPED, ...EVENT_MERGE_ZEROS },
  pbSchedSkipEventValidate: { ...SELF_TEST_PHASE_B_FULL, ...RESHAPED },
};

function buildSelfTestFixtures() {
  const driverRecords = [];
  const tailEvents = [];
  let seq = 0;
  for (const armDef of ARMS) {
    const cpuTimes = samplesAround(SELF_TEST_MEANS[armDef.name]);
    for (let i = 0; i < cpuTimes.length; i++) {
      driverRecords.push({
        seq,
        round: i,
        warmup: false,
        arm: armDef.name,
        expectedId: armDef.expectedId,
        expectedPhaseB: armDef.expectedPhaseB,
        expectedPhaseBArmId: armDef.expectedPhaseBArmId,
        expectedPhaseBUpcoming: armDef.expectedPhaseBUpcoming,
        status: 200,
        echoedId: armDef.expectedId,
        echoedPhaseB: armDef.expectedPhaseB,
        echoedPhaseBArmId: armDef.expectedPhaseBArmId,
        echoedPhaseBUpcoming: armDef.expectedPhaseBUpcoming,
        ok: true,
        fold: { ...SELF_TEST_FOLD },
        phaseB: { ...SELF_TEST_PHASE_B_BY_ARM[armDef.name] },
        warnings: [],
      });
      tailEvents.push({
        outcome: "ok",
        cpuTime: cpuTimes[i],
        // Every sample REUSED (isolateRequest > 1), so the reused stratum
        // carries the full n and the differences are computable there.
        logs: [{ message: [`isolateRequest=${i + 2}`] }],
        event: { request: { url: `https://probe.example.workers.dev/?seq=${seq}&arm=${armDef.name}` } },
      });
      seq++;
    }
  }
  return { driverRecords, tailEvents };
}

function runSelfTest() {
  const failures = [];
  const assertEqual = (actual, expected, label) => {
    if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };

  // --- the parser and the isolate extractor, on adversarial text ---
  const messyTail = [
    "Connected to sigmascout-state-probe, waiting for events...",
    JSON.stringify({ outcome: "ok", cpuTime: 5, logs: [{ message: ['a note with a brace { and a quote " inside and a close brace }'] }, { message: ["isolateRequest=1"] }], event: { request: { url: "https://p/?seq=0" } } }),
    JSON.stringify({ outcome: "ok", cpuTime: 6, logs: [{ message: ["isolateRequest=4"] }], event: { request: { url: "https://p/?seq=1" } } }, null, 2),
    JSON.stringify({ outcome: "ok", cpuTime: 7, event: { request: { url: "https://p/?seq=2" } } }),
    "Some trailing non-JSON line",
  ].join("\n");
  const messyEvents = parseJsonStream(messyTail);
  assertEqual(messyEvents.length, 3, "parseJsonStream: event count (mixed pretty/compact, embedded braces/quotes, junk text)");
  assertEqual(extractIsolateRequest(messyEvents[0]), 1, "extractIsolateRequest: array message alongside a noisy log line");
  assertEqual(extractIsolateRequest(messyEvents[1]), 4, "extractIsolateRequest: pretty-printed event");
  assertEqual(extractIsolateRequest(messyEvents[2]), undefined, "extractIsolateRequest: no logs at all");
  assertEqual(extractIsolateRequest({ logs: [{ message: [42, null, "isolateRequest=7"] }] }), 7, "extractIsolateRequest: skips non-string members");
  assertEqual(extractIsolateRequest({ logs: [{ message: "isolateRequest=9" }] }), 9, "extractIsolateRequest: string-shaped message");
  assertEqual(extractSeq(messyEvents[0]), 0, "extractSeq: from a parsed URL");
  assertEqual(stratumOf(1), "fresh", "stratumOf(1)");
  assertEqual(stratumOf(2), "reused", "stratumOf(2)");
  assertEqual(stratumOf(undefined), "unknown", "stratumOf(undefined)");

  // --- the real arms, end to end ---
  const { driverRecords, tailEvents } = buildSelfTestFixtures();
  const { samplesByArm, exclusionsByArm } = joinAndFilter(driverRecords, tailEvents);
  const aggregates = buildAggregates(samplesByArm, exclusionsByArm);

  assertEqual(Object.keys(aggregates.perArm).length, ARMS.length, "every arm produced samples");
  assertEqual(aggregates.perArm.allPhaseB.strata.reused.n, 8, "allPhaseB reused n");
  assertEqual(fmt1(aggregates.perArm.allPhaseB.strata.reused.mean), "114.0", "allPhaseB reused mean");
  assertEqual(aggregates.lowN.length, ARMS.length, "every arm's FRESH stratum is flagged low-n (n=0), and no reused stratum is");
  assertEqual(
    aggregates.lowN.every((e) => e.stratum === "fresh"),
    true,
    "low-n entries are the fresh strata only"
  );

  // Measured differences. `phaseB` is the continuity anchor against qgf's 64.0.
  const d = aggregates.differences;
  assertEqual(fmt1(d.phaseB.reused.meanDiff), "64.0", "phaseB meanDiff");
  assertEqual(fmt1(d.phaseB.reused.se), "2.4", "phaseB SE (sqrt(24/8 + 24/8) = sqrt 6)");
  assertEqual(d.phaseB.reused.resolved, true, "phaseB resolved");
  assertEqual(fmt1(d.eventHalf.reused.meanDiff), "30.0", "eventHalf meanDiff");
  assertEqual(fmt1(d.eventValidate.reused.meanDiff), "8.0", "eventValidate meanDiff");
  assertEqual(fmt1(d.eventMergeAndStringify.reused.meanDiff), "14.0", "eventMergeAndStringify meanDiff");
  assertEqual(fmt1(d.eventStringify.reused.meanDiff), "6.0", "eventStringify meanDiff");
  assertEqual(fmt1(d.teamHalf.reused.meanDiff), "34.0", "teamHalf meanDiff");
  assertEqual(fmt1(d.teamValidate.reused.meanDiff), "10.0", "teamValidate meanDiff");
  assertEqual(fmt1(d.teamMergeAndStringify.reused.meanDiff), "18.0", "teamMergeAndStringify meanDiff");
  assertEqual(fmt1(d.teamStringify.reused.meanDiff), "7.0", "teamStringify meanDiff");
  assertEqual(fmt1(d.eventValidateScheduledShape.reused.meanDiff), "13.0", "eventValidateScheduledShape meanDiff");
  assertEqual(fmt1(d.eventHalfScheduledShape.reused.meanDiff), "30.0", "eventHalfScheduledShape meanDiff");

  // Derived residuals: the coefficient form must agree with the expression form.
  const dd = aggregates.derived;
  assertEqual(fmt1(dd.eventMerge.reused.meanDiff), "8.0", "derived eventMerge = eventMergeAndStringify - eventStringify = 14 - 6");
  assertEqual(fmt1(dd.eventMerge.reused.se), "2.4", "derived eventMerge SE (2 arms, |c|=1: sqrt(2 * 24/8))");
  assertEqual(fmt1(dd.eventJsonParse.reused.meanDiff), "8.0", "derived eventJsonParse = eventHalf - eventValidate - eventMergeAndStringify = 30 - 8 - 14");
  assertEqual(fmt1(dd.eventJsonParse.reused.se), "3.5", "derived eventJsonParse SE (4 arms, |c|=1: sqrt(4 * 24/8) = sqrt 12)");
  assertEqual(fmt1(dd.teamMerge.reused.meanDiff), "11.0", "derived teamMerge = 18 - 7");
  assertEqual(fmt1(dd.teamJsonParse.reused.meanDiff), "6.0", "derived teamJsonParse = 34 - 10 - 18");
  assertEqual(fmt1(dd.unionOrderPenalty.reused.meanDiff), "5.0", "derived unionOrderPenalty = eventValidateScheduledShape - eventValidate = 13 - 8");
  assertEqual(fmt1(dd.unionOrderPenalty.reused.se), "3.5", "derived unionOrderPenalty SE (4 arms, |c|=1: sqrt 12)");
  // 5.0 against an SE of sqrt(12) = 3.46 is NOT resolved (5.0 < 2 x 3.46), and
  // the report must say so rather than letting a plausible-looking mean through.
  // This is the exact shape of the F1 threshold decision, which is why it is
  // pinned here on numbers chosen to sit just under the bar.
  assertEqual(dd.unionOrderPenalty.reused.resolved, false, "unionOrderPenalty is UNRESOLVED at these synthetic numbers, and the report must not claim otherwise");

  // Threshold quantities, computed once so the gate does not have to.
  assertEqual(fmt1(aggregates.thresholdQuantities.eventValidateScheduledShapePlusTeamValidate.value), "23.0", "F2 threshold quantity = 13 + 10");
  assertEqual((aggregates.thresholdQuantities.teamHalfShareOfPhaseB * 100).toFixed(1), "53.1", "teamHalf share of phaseB = 34/64");
  assertEqual(fmt1(aggregates.closure), "0.0", "closure = phaseB - (eventHalf + teamHalf) = 64 - (30 + 34)");

  // Invariants pass on well-formed data...
  const inv = aggregates.invariants;
  assertEqual(inv.crossArmConstant.pass, true, "crossArmConstant passes on well-formed data");
  assertEqual(inv.perArmConstant.pass, true, "perArmConstant passes on well-formed data");
  assertEqual(inv.phaseBConstantWhereRan.pass, true, "phaseBConstantWhereRan passes on well-formed data");
  assertEqual(inv.reshapeConsistent.pass, true, "reshapeConsistent passes on well-formed data");
  assertEqual(inv.teamRootHonest.pass, true, "teamRootHonest passes on well-formed data");

  // ...and FAIL on each specific corruption, which is the half that matters.
  const corruptCounter = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptCounter.get("pbSkipEventValidate")[0].phaseB = { ...SELF_TEST_PHASE_B_FULL, mergedEventBytes: 169999 };
  const corruptCounterInv = checkInvariants(corruptCounter);
  assertEqual(corruptCounterInv.phaseBConstantWhereRan.pass, false, "a merged-event byte mismatch between two arms is CAUGHT, not averaged over");
  assertEqual(corruptCounterInv.phaseBConstantWhereRan.deviations[0].field, "mergedEventBytes", "the caught mismatch names the field");

  const corruptReshape = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptReshape.get("pbSkipEventMerge")[0].phaseB = { ...SELF_TEST_PHASE_B_BY_ARM.pbSkipEventMerge, ...RESHAPED };
  assertEqual(checkInvariants(corruptReshape).reshapeConsistent.pass, false, "a PUBLISHED arm claiming a reshape it did not do is CAUGHT");

  const corruptSchedReshape = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptSchedReshape.get("pbSchedSkipEventParse")[0].phaseB = { ...SELF_TEST_PHASE_B_BY_ARM.pbSchedSkipEventParse, eventUpcomingReshapedRows: 0, reshapedEventTextBytes: 0 };
  assertEqual(
    checkInvariants(corruptSchedReshape).reshapeConsistent.pass,
    false,
    "a SCHEDULED arm that skipped the reshape is CAUGHT — that is the arm whose difference the reshape has to cancel in"
  );

  const corruptTeamRoot = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptTeamRoot.get("pbTeams0").forEach((s) => {
    s.phaseB = { ...SELF_TEST_PHASE_B_BY_ARM.pbTeams0, teamParsesRun: 1 };
  });
  assertEqual(checkInvariants(corruptTeamRoot).teamRootHonest.pass, false, "phaseBTeams=0 reporting one parse (the pre-260915-t7o bug) is CAUGHT");

  const corruptFold = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptFold.get("pbSchedAll")[0].fold = { ...SELF_TEST_FOLD, bandsProduced: 3 };
  assertEqual(checkInvariants(corruptFold).crossArmConstant.pass, false, "a bandsProduced deviation is CAUGHT");

  // Exclusions: a sample whose echoed phaseBArm.id disagrees is dropped, not
  // pooled into the arm it shares an rpArm.id with.
  const mismatched = driverRecords.map((r) => ({ ...r }));
  mismatched[0] = { ...mismatched[0], echoedPhaseBArmId: "all", expectedPhaseBArmId: "skip:eventParse", arm: "pbSkipEventParse" };
  const mismatchedJoin = joinAndFilter(mismatched, tailEvents);
  assertEqual(mismatchedJoin.exclusionsByArm.get("pbSkipEventParse")?.phaseBArmIdMismatches, 1, "a phaseBArm.id mismatch is excluded and counted");

  const upcomingMismatched = driverRecords.map((r) => ({ ...r }));
  const schedIdx = upcomingMismatched.findIndex((r) => r.arm === "pbSchedAll");
  upcomingMismatched[schedIdx] = { ...upcomingMismatched[schedIdx], echoedPhaseBUpcoming: "published" };
  const upcomingJoin = joinAndFilter(upcomingMismatched, tailEvents);
  assertEqual(upcomingJoin.exclusionsByArm.get("pbSchedAll")?.phaseBUpcomingMismatches, 1, "a phaseBUpcoming mismatch is excluded and counted");

  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED (${ARMS.length} arms, ${DIFFERENCES.length} measured differences, ${DERIVED_DIFFERENCES.length} derived residuals)`);
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
