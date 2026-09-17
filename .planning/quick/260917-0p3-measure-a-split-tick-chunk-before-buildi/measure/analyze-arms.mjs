#!/usr/bin/env node
/**
 * CLI analyzer: joins `measure-arms.mjs`'s `driver.jsonl` to a `wrangler tail
 * --format json` capture by `seq`, and reports per-arm `cpuTime` statistics,
 * the split-tick differences, the split penalty, and THE VERDICT against the
 * pre-registered bar. Plain Node ESM, no dependencies.
 *
 * Adapted from `260915-t7o/measure/analyze-arms.mjs`; that copy is left
 * untouched as the record of the 2026-09-17 Phase B run.
 *
 * WHAT IS CARRIED OVER, AND STILL LOAD-BEARING: the FRESH/REUSED ISOLATE SPLIT.
 * A fresh isolate (`isolateRequest=1`) pays platform cold-start — `allPhaseB`
 * averaged 40.8 ms there on 2026-09-17 against 17.5 reused — so a number
 * computed over pooled samples prices cold-start as if it were the work. Every
 * figure worth reading here is the REUSED column.
 *
 * WHAT IS NEW HERE, AND WHY IT MATTERS MORE THAN USUAL:
 *   1. ABSOLUTES ARE THE HEADLINE. Every previous rig in this family reported
 *      differences, because a difference cancels per-invocation overhead. That
 *      overhead is EXACTLY the term under examination now, so it must not be
 *      cancelled — the verdict turns on `chunkTeams`'s absolute mean and p50.
 *      Absolutes are meaningful ONLY within the reused stratum, and the report
 *      says so at every one of them.
 *   2. A VERDICT, decided against a bar written down BEFORE the run
 *      (`PRE_REGISTERED_BAR` in `arms.mjs`, quoted verbatim into the output so
 *      the threshold cannot drift once a number is in front of anyone).
 *   3. CONTINUITY ANCHORS. If `allPhaseB`, `pbTeams0` and `teamHalf` do not
 *      reproduce their 2026-09-17 values, this run is not comparable to that
 *      one and the chunk number must not be published either.
 *   4. THE CHUNK ARMS ARE EXCLUDED from every fold-counter and phaseB-counter
 *      cross-arm pin — they fold nothing and run no Phase B, so a zero there is
 *      the arm working — and CHUNK-SPECIFIC pins are added in their place.
 *
 * Emits aggregates only — never request headers or `cf`/geo fields.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ARMS,
  DIFFERENCES,
  DERIVED_DIFFERENCES,
  RETIRED_DIFFERENCES,
  PHASE_B_CONSTANT_WHERE_RAN,
  CHUNK_CONSTANT_WHERE_RAN,
  CHUNK_ARMS,
  PRE_REGISTERED_BAR,
  HEADLINE_ABSOLUTES,
  CONTINUITY_ANCHORS,
} from "./arms.mjs";

/** Below this, a stratum cannot support a number and the report says so, loudly. */
const LOW_N_THRESHOLD = 8;

// ---------------------------------------------------------------------------
// Tail parsing: a stream of concatenated JSON values, brace-depth/string-state
// tracked so pretty-printed and one-object-per-line output both parse, and text
// outside `{...}` (wrangler's own log lines) is ignored.
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
          // A malformed chunk (truncated capture, non-JSON wrangler banner that
          // happened to balance braces) is skipped, not fatal.
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
 * `tailEvent.logs[].message` is itself an ARRAY whose members may be strings or
 * arbitrary values, so both shapes are handled and non-strings skipped. Returns
 * `undefined` when the event carried no such line — that sample lands in the
 * `unknown` stratum and is never silently counted as either other.
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
 * `phaseB`, its `chunk` and its isolate stratum) and exclusion counts. Warm-up
 * records are dropped up front — never counted in any exclusion bucket, since
 * they were never candidates.
 *
 * FIVE identity fields are checked, not four. `chunkTeams` echoes
 * `rpArm.id: "all"`, `phaseB: false` and `phaseBArm.id: "all"` — exactly what
 * the `all` arm echoes — so without `params.chunk` its samples would be pooled
 * into an arm that measured Phase A.
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
        chunkMismatches: 0,
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
    if (rec.expectedChunk !== undefined && rec.echoedChunk !== rec.expectedChunk) {
      exclusions.chunkMismatches++;
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
    samples.push({
      seq: rec.seq,
      cpuTime,
      fold: rec.fold,
      phaseB: rec.phaseB ?? null,
      chunk: rec.chunk ?? null,
      isolateRequest,
      stratum: stratumOf(isolateRequest),
    });
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
 * Computing it from ARM MEANS rather than from the differences it is written as
 * matters: those differences share arms and are therefore correlated, so adding
 * their SEs in quadrature would be wrong. The arms themselves are separate
 * requests and are treated as independent, which is the assumption this SE
 * rests on — state it when quoting one.
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

/**
 * THE VERDICT, decided mechanically against the pre-registered bar. Pure and
 * exported so it is testable and so nobody has to eyeball a table and decide
 * for themselves — which is the failure mode writing the bar down first exists
 * to prevent.
 *
 * Both conditions must hold. A miss is a MISS, not a near miss.
 */
export function evaluateBar(stats, bar) {
  if (stats === undefined || stats.n === 0) {
    return { verdict: "INSUFFICIENT DATA", meetsP50: undefined, meetsMean: undefined, n: 0 };
  }
  const meetsP50 = stats.p50 <= bar.p50MaxMs;
  const meetsMean = stats.mean <= bar.meanMaxMs;
  return {
    verdict: meetsP50 && meetsMean ? "MEETS THE BAR" : "MISSES THE BAR",
    meetsP50,
    meetsMean,
    n: stats.n,
    p50: stats.p50,
    mean: stats.mean,
  };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Fold counters that MUST be identical across every sample of every
 * NON-CHUNK arm. The chunk arms are excluded by name: `chunk=teams` folds
 * nothing, so every one of these reads 0 there BY DESIGN. Including them would
 * fail the invariant on every run and teach a reader to ignore it.
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

/** Every `PhaseBResult` field, checked for constancy WITHIN an arm. */
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

/** Every `ChunkResult` numeric/boolean field, checked for constancy WITHIN an arm. `unreconstructedFields` is an array and is compared by JSON below. */
const CHUNK_VECTOR_FIELDS = [
  "ran",
  "artifactsFetched",
  "eventArtifactBytes",
  "teamArtifactBytes",
  "publishedPlayedRowsRead",
  "matchesReconstructed",
  "predictionsReconstructed",
  "predictionsWithRpPmf",
  "predictionsWithBand",
  "rostersSubstituted",
  "bonusFlagRoute",
  "bonusFlagArraysInverted",
  "matchesWithActualBonusFlags",
  "playedRowFactsBuilt",
  "teamsWithPublishedMetrics",
  "teamsWithPublishedSigma",
  "teamParsesRun",
  "teamMergesRun",
  "mergedTeamRows",
  "mergedTeamBytes",
];

export function checkInvariants(samplesByArm) {
  const allSamples = [];
  for (const [arm, samples] of samplesByArm) {
    for (const s of samples) allSamples.push({ arm, ...s });
  }

  // 1. The fold vector's cross-arm constants, over the NON-CHUNK arms only.
  const crossArmConstant = { pass: true, deviations: [], excludedArms: CHUNK_ARMS };
  const foldingSamples = allSamples.filter((s) => !CHUNK_ARMS.includes(s.arm));
  if (foldingSamples.length > 0) {
    const baseline = foldingSamples[0].fold;
    for (const field of CONSTANT_ACROSS_ARMS_FIELDS) {
      for (const s of foldingSamples) {
        if (s.fold?.[field] !== baseline?.[field]) {
          crossArmConstant.pass = false;
          crossArmConstant.deviations.push({ arm: s.arm, seq: s.seq, field, expected: baseline?.[field], actual: s.fold?.[field] });
        }
      }
    }
  }

  // 1b. A chunk arm must report every one of those at ZERO — the positive form
  //     of the exclusion above, so "excluded" never turns into "unchecked".
  const chunkFoldsNothing = { pass: true, deviations: [] };
  for (const s of allSamples.filter((x) => CHUNK_ARMS.includes(x.arm))) {
    for (const field of CONSTANT_ACROSS_ARMS_FIELDS) {
      if ((s.fold?.[field] ?? 0) !== 0) {
        chunkFoldsNothing.pass = false;
        chunkFoldsNothing.deviations.push({ arm: s.arm, seq: s.seq, field, expected: 0, actual: s.fold?.[field] });
      }
    }
    if (s.phaseB?.ran !== false) {
      chunkFoldsNothing.pass = false;
      chunkFoldsNothing.deviations.push({ arm: s.arm, seq: s.seq, field: "phaseB.ran", expected: false, actual: s.phaseB?.ran });
    }
  }

  // 2. Every arm's OWN fold + phaseB + chunk counter vectors constant across its own samples.
  const perArmConstant = { pass: true, deviations: [] };
  for (const [arm, samples] of samplesByArm) {
    if (samples.length === 0) continue;
    const baselineFold = samples[0].fold;
    const baselinePhaseB = samples[0].phaseB;
    const baselineChunk = samples[0].chunk;
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
      for (const field of CHUNK_VECTOR_FIELDS) {
        if (s.chunk?.[field] !== baselineChunk?.[field]) {
          perArmConstant.pass = false;
          perArmConstant.deviations.push({ arm, seq: s.seq, field: `chunk.${field}`, expected: baselineChunk?.[field], actual: s.chunk?.[field] });
        }
      }
      if (JSON.stringify(s.chunk?.unreconstructedFields) !== JSON.stringify(baselineChunk?.unreconstructedFields)) {
        perArmConstant.pass = false;
        perArmConstant.deviations.push({
          arm,
          seq: s.seq,
          field: "chunk.unreconstructedFields",
          expected: JSON.stringify(baselineChunk?.unreconstructedFields),
          actual: JSON.stringify(s.chunk?.unreconstructedFields),
        });
      }
    }
  }

  // 3. Phase B counters constant across every NON-CHUNK arm where the component RAN.
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

  // 4. The chunk-side replacements: the counters that must agree across the
  //    arms where the chunk RAN, so a chunk cpuTime difference is a cost
  //    difference and not two chunks reconstructing different things.
  const chunkConstantWhereRan = { pass: true, deviations: [], checked: [] };
  for (const { field, participating: participatingArms } of CHUNK_CONSTANT_WHERE_RAN) {
    const participating = allSamples.filter((s) => participatingArms.includes(s.arm));
    if (participating.length === 0) continue;
    const baseline = participating[0].chunk?.[field];
    const baselineArm = participating[0].arm;
    let fieldPass = true;
    for (const s of participating) {
      if (s.chunk?.[field] !== baseline) {
        fieldPass = false;
        chunkConstantWhereRan.pass = false;
        chunkConstantWhereRan.deviations.push({ arm: s.arm, seq: s.seq, field, expected: baseline, expectedFrom: baselineArm, actual: s.chunk?.[field] });
      }
    }
    chunkConstantWhereRan.checked.push({ field, arms: [...new Set(participating.map((s) => s.arm))], value: baseline, pass: fieldPass });
  }

  // 5. The team loop's root is honest in BOTH halves of the rig: pbTeams0 and
  //    chunkTeams0 each really report zero parses and zero merges, while their
  //    full counterparts report more than zero.
  const firstPhaseB = (armName) => samplesByArm.get(armName)?.[0]?.phaseB;
  const firstChunk = (armName) => samplesByArm.get(armName)?.[0]?.chunk;
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
  const chunk0 = firstChunk("chunkTeams0");
  const fullChunk = firstChunk("chunkTeams");
  let chunkRootHonest = { pass: undefined };
  if (chunk0 && fullChunk) {
    chunkRootHonest = {
      pass:
        chunk0.teamParsesRun === 0 &&
        chunk0.teamMergesRun === 0 &&
        chunk0.matchesReconstructed > 0 &&
        fullChunk.teamParsesRun > 0 &&
        fullChunk.teamMergesRun > 0,
      chunk0Parses: chunk0.teamParsesRun,
      chunk0Merges: chunk0.teamMergesRun,
      chunk0Reconstructed: chunk0.matchesReconstructed,
      fullParses: fullChunk.teamParsesRun,
      fullMerges: fullChunk.teamMergesRun,
    };
  }

  return { crossArmConstant, chunkFoldsNothing, perArmConstant, phaseBConstantWhereRan, chunkConstantWhereRan, teamRootHonest, chunkRootHonest };
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
      chunkVector: samples?.[0]?.chunk ?? null,
      exclusions: {
        missingTail: exclusions?.missingTail ?? 0,
        nonOkOutcomes: Object.fromEntries(exclusions?.nonOkOutcomes ?? []),
        idMismatches: exclusions?.idMismatches ?? 0,
        phaseBMismatches: exclusions?.phaseBMismatches ?? 0,
        phaseBArmIdMismatches: exclusions?.phaseBArmIdMismatches ?? 0,
        phaseBUpcomingMismatches: exclusions?.phaseBUpcomingMismatches ?? 0,
        chunkMismatches: exclusions?.chunkMismatches ?? 0,
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

  // THE HEADLINE. Absolutes, reused stratum only — the whole point of this rig.
  const absolutes = {};
  for (const { arm: armName, meaning } of HEADLINE_ABSOLUTES) {
    absolutes[armName] = { meaning, reused: computeArmStats(reusedOf(armName)) };
  }

  const verdict = {
    bar: PRE_REGISTERED_BAR,
    ...evaluateBar(absolutes[PRE_REGISTERED_BAR.arm]?.reused, PRE_REGISTERED_BAR),
  };

  const reusedDiff = (label) => differences[label]?.reused?.meanDiff;

  // The continuity check: if the 2026-09-17 anchors do not reproduce, this run
  // is not comparable to that one and the chunk number must not be published.
  const anchors = CONTINUITY_ANCHORS.map((anchor) => {
    const observed = anchor.kind === "absolute" ? absolutes[anchor.arm]?.reused?.mean ?? computeArmStats(reusedOf(anchor.arm)).mean : reusedDiff(anchor.difference);
    if (observed === undefined) return { ...anchor, observed: undefined, reproduces: undefined };
    return { ...anchor, observed, delta: observed - anchor.expected, reproduces: Math.abs(observed - anchor.expected) <= anchor.toleranceMs };
  });

  // The fresh-isolate share, stated plainly as a term nothing inside the tick
  // addresses and nothing about splitting improves.
  const isolateShares = {};
  for (const name of armOrder) {
    const fresh = perArm[name].strata.fresh.n;
    const reused = perArm[name].strata.reused.n;
    const unknown = perArm[name].strata.unknown.n;
    const total = fresh + reused + unknown;
    isolateShares[name] = { fresh, reused, unknown, freshSharePct: total > 0 ? (fresh / total) * 100 : undefined };
  }

  // A real consumer's subrequest count, computed from the chunk's own counters
  // rather than asserted: one event GET plus one GET per team.
  const chunkVector = samplesByArm.get("chunkTeams")?.[0]?.chunk;
  const realConsumerSubrequests = chunkVector?.teamMergesRun > 0 ? 1 + chunkVector.teamMergesRun : undefined;

  const invariants = checkInvariants(samplesByArm);

  return { perArm, absolutes, verdict, differences, derived, anchors, isolateShares, realConsumerSubrequests, lowN, invariants };
}

function printStatsRow(label, stats) {
  console.log(`${label}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}`);
}

function printReport(aggregates) {
  console.log("\n=== Per-arm cpuTime (ms), ALL isolates pooled ===");
  console.log("arm\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms\tmissingTail\tnonOk\tidMism\tpbMism\tpbArmMism\tpbUpcMism\tchunkMism");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    const ex = stats.exclusions;
    const nonOkTotal = Object.values(ex.nonOkOutcomes).reduce((a, b) => a + b, 0);
    console.log(
      `${name}\t${stats.n}\t${stats.p50 ?? "n/a"}\t${stats.p75 ?? "n/a"}\t${stats.p90 ?? "n/a"}\t${stats.max ?? "n/a"}\t${fmt1(stats.mean)}\t${fmt1(stats.pctOver10)}\t${ex.missingTail}\t${nonOkTotal}\t${ex.idMismatches}\t${ex.phaseBMismatches}\t${ex.phaseBArmIdMismatches}\t${ex.phaseBUpcomingMismatches}\t${ex.chunkMismatches}`
    );
    if (nonOkTotal > 0) {
      for (const [outcome, count] of Object.entries(ex.nonOkOutcomes)) console.log(`    non-ok outcome "${outcome}": ${count}`);
    }
  }

  console.log("\n=== Per-arm cpuTime (ms), SPLIT BY ISOLATE ===");
  console.log("A `fresh` isolate (isolateRequest=1) pays platform cold-start, so a fresh-isolate");
  console.log("number prices cold-start, not the work. `unknown` = no isolateRequest line.");
  console.log("arm/stratum\tn\tp50\tp75\tp90\tmax\tmean\t%>10ms");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    for (const stratum of ["fresh", "reused", "unknown"]) printStatsRow(`${name}/${stratum}`, stats.strata[stratum]);
  }

  if (aggregates.lowN.length > 0) {
    console.log("\n*** LOW N — these strata cannot support a number ***");
    for (const { arm, stratum, n } of aggregates.lowN) {
      console.log(`  !!! arm "${arm}" stratum "${stratum}" has n=${n} (< ${LOW_N_THRESHOLD}). Do NOT read a cost off it.`);
    }
  }

  console.log("\n=== HEADLINE ABSOLUTES (ms), REUSED ISOLATES ONLY ===");
  console.log("UNUSUAL FOR THIS RIG: the verdict turns on an ABSOLUTE, not a difference. A difference");
  console.log("cancels per-invocation overhead, and that overhead is exactly the term under");
  console.log("examination. An absolute is meaningful ONLY within this stratum.");
  console.log("arm\tn\tp50\tp90\tmean\t%>10ms\tmeaning");
  for (const [name, entry] of Object.entries(aggregates.absolutes)) {
    const s = entry.reused;
    console.log(`${name}\t${s.n}\t${s.p50 ?? "n/a"}\t${s.p90 ?? "n/a"}\t${fmt1(s.mean)}\t${fmt1(s.pctOver10)}\t${entry.meaning}`);
  }

  console.log("\n=== CONTINUITY against 2026-09-17 ===");
  console.log("If these do not reproduce, this run is NOT comparable to that one and the chunk");
  console.log("number must not be published either.");
  console.log("anchor\texpected\tobserved\tdelta\ttolerance\treproduces");
  for (const a of aggregates.anchors) {
    console.log(`${a.label}\t${a.expected}\t${fmt1(a.observed)}\t${a.delta === undefined ? "n/a" : fmt1(a.delta)}\t±${a.toleranceMs}\t${a.reproduces === undefined ? "n/a" : a.reproduces ? "yes" : "NO"}`);
  }

  console.log("\n=== MEASURED differences (ms) — the REUSED column is the comparable one ===");
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
  console.log("A linear combination of arm means, with the SE propagated from the arm variances.");
  console.log("A residual ABSORBS whatever the measured terms did not account for, including any");
  console.log("non-additivity between them — never quote one as a measurement of its own label.");
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

  console.log("\n=== Isolate split (the term nothing inside the tick addresses) ===");
  console.log("A queue consumer would be a SEPARATE Worker with its own isolate population, invoked");
  console.log("less often than this probe, so its fresh-isolate share would likely be WORSE than");
  console.log("what this table shows. That is not measured here and must not be assumed away.");
  console.log("arm\tfresh\treused\tunknown\tfreshShare%");
  for (const [name, s] of Object.entries(aggregates.isolateShares)) {
    console.log(`${name}\t${s.fresh}\t${s.reused}\t${s.unknown}\t${fmt1(s.freshSharePct)}`);
  }

  console.log(
    aggregates.realConsumerSubrequests !== undefined
      ? `\nA real consumer's subrequest count: 1 event GET + ${aggregates.realConsumerSubrequests - 1} team GETs = ${aggregates.realConsumerSubrequests}, under 50 even on the strictest reading of the per-invocation cap. (This probe issues 2: it re-parses ONE team's bytes N times, so its team half is a FLOOR.)`
      : "\nA real consumer's subrequest count: insufficient data to compute"
  );

  console.log("\n=== Differences the t7o rig reported that this one does NOT (dropped on purpose) ===");
  for (const r of RETIRED_DIFFERENCES) {
    console.log(`  ${r.label} (was ${r.wasMinuend} - ${r.wasSubtrahend}): ${r.reason}`);
  }

  console.log("\n=== Fold, phaseB and chunk counter vectors (first kept sample per arm) ===");
  for (const [name, stats] of Object.entries(aggregates.perArm)) {
    console.log(`${name}\tfold=${JSON.stringify(stats.foldVector)}`);
    console.log(`${name}\tphaseB=${JSON.stringify(stats.phaseBVector)}`);
    console.log(`${name}\tchunk=${JSON.stringify(stats.chunkVector)}`);
  }

  console.log("\n=== Invariants ===");
  const inv = aggregates.invariants;
  console.log(
    `bandsProduced/matchesFolded/upcomingScheduled constant across every FOLDING arm (chunk arms excluded: ${inv.crossArmConstant.excludedArms.join(", ")}): ${inv.crossArmConstant.pass ? "PASS" : "FAIL"}`
  );
  for (const dev of inv.crossArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(`Each chunk arm really folds NOTHING and runs no Phase B (the positive form of that exclusion): ${inv.chunkFoldsNothing.pass ? "PASS" : "FAIL"}`);
  for (const dev of inv.chunkFoldsNothing.deviations) console.log(`    !!! arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(`Each arm's fold + phaseB + chunk counter vectors constant across its own samples: ${inv.perArmConstant.pass ? "PASS" : "FAIL"}`);
  for (const dev of inv.perArmConstant.deviations) console.log(`    arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} actual=${dev.actual}`);

  console.log(`Phase B counters identical across every arm where the component RAN: ${inv.phaseBConstantWhereRan.pass ? "PASS" : "FAIL"}`);
  for (const c of inv.phaseBConstantWhereRan.checked) {
    console.log(`    ${c.pass ? "ok  " : "FAIL"} ${c.field}=${c.value} across ${c.arms.length} arm(s): ${c.arms.join(", ")}`);
  }
  for (const dev of inv.phaseBConstantWhereRan.deviations) {
    console.log(`    !!! arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} (from ${dev.expectedFrom}) actual=${dev.actual}`);
  }

  console.log(`Chunk counters identical across every arm where the chunk RAN: ${inv.chunkConstantWhereRan.pass ? "PASS" : "FAIL"}`);
  for (const c of inv.chunkConstantWhereRan.checked) {
    console.log(`    ${c.pass ? "ok  " : "FAIL"} ${c.field}=${c.value} across ${c.arms.length} arm(s): ${c.arms.join(", ")}`);
  }
  for (const dev of inv.chunkConstantWhereRan.deviations) {
    console.log(`    !!! arm=${dev.arm} seq=${dev.seq} field=${dev.field} expected=${dev.expected} (from ${dev.expectedFrom}) actual=${dev.actual}`);
  }

  console.log(
    `The Phase B team loop's root is honest (pbTeams0 reports 0 parses and 0 merges): ${
      inv.teamRootHonest.pass === undefined
        ? "n/a (insufficient data)"
        : inv.teamRootHonest.pass
          ? `PASS (pbTeams0 ${inv.teamRootHonest.teams0Parses}/${inv.teamRootHonest.teams0Merges}, allPhaseB ${inv.teamRootHonest.allPhaseBParses}/${inv.teamRootHonest.allPhaseBMerges})`
          : `FAIL (pbTeams0 ${inv.teamRootHonest.teams0Parses}/${inv.teamRootHonest.teams0Merges}, allPhaseB ${inv.teamRootHonest.allPhaseBParses}/${inv.teamRootHonest.allPhaseBMerges})`
    }`
  );
  console.log(
    `The CHUNK team loop's root is honest (chunkTeams0 reports 0 parses and 0 merges, and still reconstructed): ${
      inv.chunkRootHonest.pass === undefined
        ? "n/a (insufficient data)"
        : inv.chunkRootHonest.pass
          ? `PASS (chunkTeams0 ${inv.chunkRootHonest.chunk0Parses}/${inv.chunkRootHonest.chunk0Merges}, reconstructed ${inv.chunkRootHonest.chunk0Reconstructed}; chunkTeams ${inv.chunkRootHonest.fullParses}/${inv.chunkRootHonest.fullMerges})`
          : `FAIL (chunkTeams0 ${inv.chunkRootHonest.chunk0Parses}/${inv.chunkRootHonest.chunk0Merges}, reconstructed ${inv.chunkRootHonest.chunk0Reconstructed}; chunkTeams ${inv.chunkRootHonest.fullParses}/${inv.chunkRootHonest.fullMerges})`
    }`
  );

  // THE VERDICT, last, against a bar quoted verbatim from `arms.mjs`.
  const v = aggregates.verdict;
  console.log("\n=== THE VERDICT ===");
  console.log(`THE BAR, pre-registered ${v.bar.statedBefore}:`);
  console.log(`  ${v.bar.text}`);
  console.log(
    `OBSERVED on arm "${v.bar.arm}", ${v.bar.stratum} stratum: n=${v.n ?? 0}, p50=${v.p50 ?? "n/a"} (bar: <= ${v.bar.p50MaxMs}) ${v.meetsP50 === undefined ? "" : v.meetsP50 ? "MET" : "MISSED"}, mean=${fmt1(v.mean)} (bar: <= ${v.bar.meanMaxMs}) ${v.meetsMean === undefined ? "" : v.meetsMean ? "MET" : "MISSED"}`
  );
  console.log(`VERDICT: ${v.verdict}`);
  if (v.verdict === "MISSES THE BAR") console.log(`  ${v.bar.onMiss}`);

  const anchorsFail = aggregates.anchors.some((a) => a.reproduces === false);
  if (anchorsFail) {
    console.log("\n*** A CONTINUITY ANCHOR DID NOT REPRODUCE — this run is not comparable to 2026-09-17 and the verdict above must NOT be published ***");
  }
  if (!inv.crossArmConstant.pass || !inv.chunkFoldsNothing.pass || !inv.phaseBConstantWhereRan.pass || !inv.chunkConstantWhereRan.pass) {
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
  if (!inv.crossArmConstant.pass || !inv.chunkFoldsNothing.pass || !inv.phaseBConstantWhereRan.pass || !inv.chunkConstantWhereRan.pass) {
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// --self-test: synthetic data built in memory, no files touched.
//
// Uses the REAL arm names, so `buildAggregates` actually produces the
// differences, the residual, the verdict and the invariants — a self-test on
// invented arm names exercises the statistics and nothing else.
// ---------------------------------------------------------------------------

/** Eight samples centred on `m`: mean exactly `m`, sample variance exactly 24, so every SE below is checkable by hand. */
function samplesAround(m) {
  return [m - 7, m - 5, m - 3, m - 1, m + 1, m + 3, m + 5, m + 7];
}

/**
 * Arm means chosen so every difference is a round number AND the verdict lands
 * on MISSES — the branch that is easy to fudge after the fact, and therefore
 * the one worth pinning. The pass branch is checked directly against
 * `evaluateBar` below.
 */
const SELF_TEST_MEANS = {
  all: 6,
  allPhaseB: 18,
  pbTeams0: 10,
  chunkTeams: 12,
  chunkTeams0: 5,
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

/** Every fold counter at rest — what a `chunk=teams` response really carries. */
const SELF_TEST_FOLD_ZEROS = Object.fromEntries(Object.entries(SELF_TEST_FOLD).map(([k, v]) => [k, typeof v === "boolean" ? false : 0]));

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

const SELF_TEST_PHASE_B_OFF = Object.fromEntries(Object.entries(SELF_TEST_PHASE_B_FULL).map(([k, v]) => [k, typeof v === "boolean" ? false : 0]));

const SELF_TEST_CHUNK_FULL = {
  ran: true,
  artifactsFetched: 2,
  eventArtifactBytes: 106000,
  teamArtifactBytes: 32000,
  publishedPlayedRowsRead: 70,
  matchesReconstructed: 2,
  predictionsReconstructed: 2,
  predictionsWithRpPmf: 2,
  predictionsWithBand: 2,
  rostersSubstituted: 2,
  bonusFlagRoute: "invert-published-actual-bonus-arrays",
  bonusFlagArraysInverted: 2,
  matchesWithActualBonusFlags: 2,
  playedRowFactsBuilt: 2,
  teamsWithPublishedMetrics: 12,
  teamsWithPublishedSigma: 12,
  teamParsesRun: 12,
  teamMergesRun: 12,
  mergedTeamRows: 12,
  mergedTeamBytes: 400000,
  unreconstructedFields: ["match.redSurrogates", "prediction.variance"],
};

const SELF_TEST_CHUNK_OFF = {
  ...Object.fromEntries(Object.entries(SELF_TEST_CHUNK_FULL).map(([k, v]) => [k, typeof v === "boolean" ? false : typeof v === "number" ? 0 : v])),
  bonusFlagRoute: "none",
  unreconstructedFields: [],
};

const SELF_TEST_CHUNK_TEAMS0 = { ...SELF_TEST_CHUNK_FULL, teamParsesRun: 0, teamMergesRun: 0, mergedTeamRows: 0, mergedTeamBytes: 0, teamsWithPublishedMetrics: 0, teamsWithPublishedSigma: 0 };

const SELF_TEST_BY_ARM = {
  all: { fold: SELF_TEST_FOLD, phaseB: SELF_TEST_PHASE_B_OFF, chunk: SELF_TEST_CHUNK_OFF },
  allPhaseB: { fold: SELF_TEST_FOLD, phaseB: SELF_TEST_PHASE_B_FULL, chunk: SELF_TEST_CHUNK_OFF },
  pbTeams0: { fold: SELF_TEST_FOLD, phaseB: { ...SELF_TEST_PHASE_B_FULL, teamParsesRun: 0, teamMergesRun: 0, mergedTeamBytes: 0 }, chunk: SELF_TEST_CHUNK_OFF },
  chunkTeams: { fold: SELF_TEST_FOLD_ZEROS, phaseB: SELF_TEST_PHASE_B_OFF, chunk: SELF_TEST_CHUNK_FULL },
  chunkTeams0: { fold: SELF_TEST_FOLD_ZEROS, phaseB: SELF_TEST_PHASE_B_OFF, chunk: SELF_TEST_CHUNK_TEAMS0 },
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
        expectedChunk: armDef.expectedChunk,
        status: 200,
        echoedId: armDef.expectedId,
        echoedPhaseB: armDef.expectedPhaseB,
        echoedPhaseBArmId: armDef.expectedPhaseBArmId,
        echoedPhaseBUpcoming: armDef.expectedPhaseBUpcoming,
        echoedChunk: armDef.expectedChunk,
        ok: true,
        fold: { ...SELF_TEST_BY_ARM[armDef.name].fold },
        phaseB: { ...SELF_TEST_BY_ARM[armDef.name].phaseB },
        chunk: { ...SELF_TEST_BY_ARM[armDef.name].chunk },
        warnings: [],
      });
      tailEvents.push({
        outcome: "ok",
        cpuTime: cpuTimes[i],
        // Every sample REUSED (isolateRequest > 1), so the reused stratum
        // carries the full n and every figure is computable there.
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
  assertEqual(extractSeq(messyEvents[0]), 0, "extractSeq: from a parsed URL");
  assertEqual(stratumOf(1), "fresh", "stratumOf(1)");
  assertEqual(stratumOf(2), "reused", "stratumOf(2)");
  assertEqual(stratumOf(undefined), "unknown", "stratumOf(undefined)");

  // --- the bar, both branches, before any of the plumbing ---
  assertEqual(evaluateBar({ n: 20, p50: 8, mean: 9 }, PRE_REGISTERED_BAR).verdict, "MEETS THE BAR", "the bar is inclusive at exactly p50 8 / mean 9");
  assertEqual(evaluateBar({ n: 20, p50: 9, mean: 8 }, PRE_REGISTERED_BAR).verdict, "MISSES THE BAR", "p50 over the bar MISSES even with a mean under it");
  assertEqual(evaluateBar({ n: 20, p50: 8, mean: 9.1 }, PRE_REGISTERED_BAR).verdict, "MISSES THE BAR", "mean over the bar MISSES even with a p50 under it");
  // The band the plan explicitly refuses to call a near miss.
  assertEqual(evaluateBar({ n: 20, p50: 11, mean: 11.5 }, PRE_REGISTERED_BAR).verdict, "MISSES THE BAR", "a chunk in the 10-13 ms band is a MISS, not a near miss");
  assertEqual(evaluateBar(undefined, PRE_REGISTERED_BAR).verdict, "INSUFFICIENT DATA", "no samples is INSUFFICIENT DATA, never a pass");
  assertEqual(evaluateBar({ n: 0 }, PRE_REGISTERED_BAR).verdict, "INSUFFICIENT DATA", "n=0 is INSUFFICIENT DATA, never a pass");

  // --- the real arms, end to end ---
  const { driverRecords, tailEvents } = buildSelfTestFixtures();
  const { samplesByArm, exclusionsByArm } = joinAndFilter(driverRecords, tailEvents);
  const aggregates = buildAggregates(samplesByArm, exclusionsByArm);

  assertEqual(Object.keys(aggregates.perArm).length, ARMS.length, "every arm produced samples");
  assertEqual(ARMS.length, 5, "the rig carries exactly five arms");
  assertEqual(aggregates.perArm.chunkTeams.strata.reused.n, 8, "chunkTeams reused n");
  assertEqual(fmt1(aggregates.perArm.chunkTeams.strata.reused.mean), "12.0", "chunkTeams reused mean");
  assertEqual(
    aggregates.lowN.every((e) => e.stratum === "fresh"),
    true,
    "low-n entries are the fresh strata only"
  );

  // Absolutes — the headline, and the thing the verdict reads.
  assertEqual(fmt1(aggregates.absolutes.chunkTeams.reused.mean), "12.0", "headline absolute: chunkTeams");
  assertEqual(fmt1(aggregates.absolutes.chunkTeams0.reused.mean), "5.0", "headline absolute: chunkTeams0, the fixed overhead");
  assertEqual(aggregates.absolutes.chunkTeams.reused.p50, 11, "chunkTeams reused p50 (nearest-rank on 8 samples)");

  // Measured differences.
  const d = aggregates.differences;
  assertEqual(fmt1(d.phaseB.reused.meanDiff), "12.0", "phaseB meanDiff = 18 - 6");
  assertEqual(fmt1(d.phaseB.reused.se), "2.4", "phaseB SE (sqrt(24/8 + 24/8) = sqrt 6)");
  assertEqual(fmt1(d.teamHalf.reused.meanDiff), "8.0", "teamHalf meanDiff = 18 - 10");
  assertEqual(fmt1(d.chunkTeamHalf.reused.meanDiff), "7.0", "chunkTeamHalf meanDiff = 12 - 5");

  // THE residual: what a split costs.
  const dd = aggregates.derived;
  assertEqual(fmt1(dd.splitPenalty.reused.meanDiff), "4.0", "splitPenalty = chunkTeams(12) - teamHalf(8)");
  assertEqual(fmt1(dd.splitPenalty.reused.se), "3.0", "splitPenalty SE (3 arms, |c|=1: sqrt(3 * 24/8) = 3)");
  // 4.0 against an SE of 3.0 is NOT resolved (4.0 < 2 x 3.0), and the report
  // must say so rather than letting a plausible-looking mean through.
  assertEqual(dd.splitPenalty.reused.resolved, false, "splitPenalty is UNRESOLVED at these synthetic numbers, and the report must not claim otherwise");

  // The verdict, on numbers chosen to MISS.
  assertEqual(aggregates.verdict.verdict, "MISSES THE BAR", "the verdict is decided mechanically, and these numbers miss");
  assertEqual(aggregates.verdict.meetsP50, false, "p50 11 > 8");
  assertEqual(aggregates.verdict.meetsMean, false, "mean 12 > 9");

  // Continuity anchors: the synthetic allPhaseB (18.0) reproduces 17.5 within
  // tolerance, pbTeams0 (10.0) reproduces 9.9, and teamHalf (8.0) reproduces
  // 7.6 — so a clean run must not be flagged incomparable.
  assertEqual(aggregates.anchors.length, CONTINUITY_ANCHORS.length, "every continuity anchor is evaluated");
  assertEqual(
    aggregates.anchors.every((a) => a.reproduces === true),
    true,
    "the synthetic run reproduces every 2026-09-17 anchor"
  );

  // A real consumer's subrequest count, computed rather than asserted.
  assertEqual(aggregates.realConsumerSubrequests, 13, "a real consumer issues 1 event GET + 12 team GETs");

  // Invariants pass on well-formed data...
  const inv = aggregates.invariants;
  assertEqual(inv.crossArmConstant.pass, true, "crossArmConstant passes, with the chunk arms excluded");
  assertEqual(inv.chunkFoldsNothing.pass, true, "the chunk arms really fold nothing");
  assertEqual(inv.perArmConstant.pass, true, "perArmConstant passes on well-formed data");
  assertEqual(inv.phaseBConstantWhereRan.pass, true, "phaseBConstantWhereRan passes on well-formed data");
  assertEqual(inv.chunkConstantWhereRan.pass, true, "chunkConstantWhereRan passes on well-formed data");
  assertEqual(inv.teamRootHonest.pass, true, "the Phase B team root is honest");
  assertEqual(inv.chunkRootHonest.pass, true, "the chunk team root is honest");

  // ...and FAIL on each specific corruption, which is the half that matters.
  const corruptChunkCounter = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptChunkCounter.get("chunkTeams0")[0].chunk = { ...SELF_TEST_CHUNK_TEAMS0, matchesReconstructed: 1 };
  const corruptChunkInv = checkInvariants(corruptChunkCounter);
  assertEqual(corruptChunkInv.chunkConstantWhereRan.pass, false, "two chunk arms reconstructing DIFFERENT match counts is CAUGHT, not averaged over");
  assertEqual(corruptChunkInv.chunkConstantWhereRan.deviations[0].field, "matchesReconstructed", "the caught chunk mismatch names the field");

  const corruptChunkFold = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptChunkFold.get("chunkTeams")[0].fold = { ...SELF_TEST_FOLD_ZEROS, matchesFolded: 2 };
  assertEqual(checkInvariants(corruptChunkFold).chunkFoldsNothing.pass, false, "a chunk arm reporting a non-zero fold counter is CAUGHT — that would mean it fell through to the normal path");

  const corruptChunkRoot = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptChunkRoot.get("chunkTeams0").forEach((s) => {
    s.chunk = { ...SELF_TEST_CHUNK_TEAMS0, teamParsesRun: 1 };
  });
  assertEqual(checkInvariants(corruptChunkRoot).chunkRootHonest.pass, false, "chunkTeams0 reporting one parse is CAUGHT — the fixed-overhead arm would be measuring the loop");

  const corruptFold = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptFold.get("pbTeams0")[0].fold = { ...SELF_TEST_FOLD, bandsProduced: 3 };
  assertEqual(checkInvariants(corruptFold).crossArmConstant.pass, false, "a bandsProduced deviation between two FOLDING arms is CAUGHT");

  const corruptPhaseBCounter = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptPhaseBCounter.get("pbTeams0")[0].phaseB = { ...SELF_TEST_PHASE_B_FULL, teamParsesRun: 0, teamMergesRun: 0, mergedTeamBytes: 0, mergedEventBytes: 169999 };
  assertEqual(checkInvariants(corruptPhaseBCounter).phaseBConstantWhereRan.pass, false, "a merged-event byte mismatch between two phaseB arms is CAUGHT");

  const corruptUnreconstructed = new Map([...samplesByArm].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  corruptUnreconstructed.get("chunkTeams")[0].chunk = { ...SELF_TEST_CHUNK_FULL, unreconstructedFields: ["match.redSurrogates"] };
  assertEqual(
    checkInvariants(corruptUnreconstructed).perArmConstant.pass,
    false,
    "the unreconstructed-field list changing mid-run is CAUGHT — the probe would have been redeployed under the campaign"
  );

  // Exclusions: a sample whose echoed chunk disagrees is dropped, not pooled
  // into the arm it shares every other identity field with.
  const mismatched = driverRecords.map((r) => ({ ...r }));
  const chunkIdx = mismatched.findIndex((r) => r.arm === "chunkTeams");
  mismatched[chunkIdx] = { ...mismatched[chunkIdx], echoedChunk: "off" };
  const mismatchedJoin = joinAndFilter(mismatched, tailEvents);
  assertEqual(mismatchedJoin.exclusionsByArm.get("chunkTeams")?.chunkMismatches, 1, "a params.chunk mismatch is excluded and counted");
  assertEqual(mismatchedJoin.samplesByArm.get("chunkTeams")?.length, 7, "and the mismatched sample really is dropped, not merely counted");

  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASSED (${ARMS.length} arms, ${DIFFERENCES.length} measured differences, ${DERIVED_DIFFERENCES.length} derived residual, ${CHUNK_ARMS.length} chunk arms, bar: p50 <= ${PRE_REGISTERED_BAR.p50MaxMs} AND mean <= ${PRE_REGISTERED_BAR.meanMaxMs})`
  );
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
