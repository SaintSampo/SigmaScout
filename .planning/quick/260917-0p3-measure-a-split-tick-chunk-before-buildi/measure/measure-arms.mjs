#!/usr/bin/env node
/**
 * CLI driver: round-robins the five (or an `--arms` subset of the) split-tick
 * arms against a DEPLOYED probe, appending one JSON line per request to
 * `OUT/driver.jsonl`. Plain Node ESM, no dependencies — only native `fetch`,
 * `node:fs`, `node:path` and `node:url`.
 *
 * NEVER run this against a URL from inside an executor sandbox — this file is
 * for the orchestrator's main context only (executor sandboxes deny all network
 * Bash, so an attempt fails in a way that looks like a dead probe). Importing
 * this module does nothing; execution is guarded below.
 *
 * Adapted from `260915-t7o/measure/measure-arms.mjs`; that copy is left
 * untouched as the record of the 2026-09-17 run, as t7o left qgf's and qgf left
 * 260914-nhc's.
 *
 * WHAT IS NEW HERE. t7o's gate checked FOUR echo fields. This rig's two chunk
 * arms echo `rpArm.id: "all"`, `phaseB: false` and `phaseBArm.id: "all"` —
 * character-for-character what the `all` arm echoes — so those four fields can
 * no longer tell them apart, and the gate would record a chunk arm as `all` and
 * attribute its cpuTime to Phase A. A fifth field, `params.chunk`, is therefore
 * checked on EVERY arm, including the three that carry it as `off`, and the
 * chunk RESULT block is checked for having actually run.
 *
 * The shared-environment-warning comparison also gained an exclusion: a
 * `chunk=teams` request runs a completely different path and emits its own four
 * warnings and NONE of the probe's usual environment ones, so comparing its
 * warning list against a Phase B arm's would reject a perfectly valid run. The
 * chunk arms are compared against each other instead, and their own warning
 * count is checked explicitly.
 */
import { mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ARMS, ARMS_BY_NAME, COMMON_QUERY, CHUNK_ARMS, PRE_REGISTERED_BAR } from "./arms.mjs";

const DEFAULT_BASE = "https://sigmascout-state-probe.jrw4561.workers.dev";
const DEFAULT_ROUNDS = 20;
const DEFAULT_WARMUP = 1;
const DEFAULT_DELAY_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
/** An RP arm label — never a shared/non-arm warning — exactly when it contains this case-sensitive substring. */
const ARM_LABEL_MARKER = "ABLATED ARM";
/** A PHASE B arm label. Deliberately NOT a superstring of `ARM_LABEL_MARKER`, so the two are counted separately. */
const PHASE_B_ARM_LABEL_MARKER = "ABLATED PHASE B ARM";
/** Warnings the Phase B emulation emits about its OWN run — arm-specific by construction, so excluded from the shared-environment comparison. */
const PHASE_B_LABEL_PREFIXES = ["phaseB ", 'phaseB="', "phaseBSkip=", "phaseBUpcoming="];
/** Every warning the chunk arm emits, for the same reason: arm-specific by construction. All four start with this. */
const CHUNK_LABEL_PREFIX = "chunk=";
/** A successful `chunk=teams` response carries exactly this many warnings, all of them its own (pinned by `stateProbe.test.ts` Group 11). */
const EXPECTED_CHUNK_WARNINGS = 4;

function usageError(message) {
  console.error(`measure-arms: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    rounds: DEFAULT_ROUNDS,
    warmup: DEFAULT_WARMUP,
    armNames: ARMS.map((arm) => arm.name),
    delayMs: DEFAULT_DELAY_MS,
    out: undefined,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--base":
        args.base = argv[++i];
        break;
      case "--rounds":
        args.rounds = Number.parseInt(argv[++i], 10);
        break;
      case "--warmup":
        args.warmup = Number.parseInt(argv[++i], 10);
        break;
      case "--delay-ms":
        args.delayMs = Number.parseInt(argv[++i], 10);
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--arms": {
        const raw = argv[++i] ?? "";
        const names = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const name of names) {
          if (!ARMS_BY_NAME.has(name)) {
            usageError(`unknown arm "${name}" — valid names are ${ARMS.map((arm) => arm.name).join(", ")}`);
          }
        }
        args.armNames = names;
        break;
      }
      default:
        usageError(`unknown flag "${flag}"`);
    }
  }

  if (args.out === undefined && !args.dryRun) usageError("--out is required");
  if (!Number.isFinite(args.rounds) || args.rounds < 0) usageError("--rounds must be a non-negative integer");
  if (!Number.isFinite(args.warmup) || args.warmup < 0) usageError("--warmup must be a non-negative integer");
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) usageError("--delay-ms must be a non-negative integer");
  if (args.armNames.length === 0) usageError("--arms named no arms");

  return args;
}

/** `armNames` rotated by `round`, so no arm always runs first within a round. */
function armsForRound(armNames, round) {
  const n = armNames.length;
  const shift = round % n;
  return [...armNames.slice(shift), ...armNames.slice(0, shift)];
}

/**
 * Every request in the whole run, in order, with a single seq counter running
 * across warm-up and measured rounds alike. Total rounds = `warmup + rounds` —
 * the first `warmup` rounds are excluded from analysis, never from the run.
 */
function buildRequests(args) {
  const requests = [];
  let seq = 0;
  const totalRounds = args.warmup + args.rounds;
  for (let round = 0; round < totalRounds; round++) {
    const isWarmup = round < args.warmup;
    for (const armName of armsForRound(args.armNames, round)) {
      const arm = ARMS_BY_NAME.get(armName);
      const url = `${args.base}?${COMMON_QUERY}&${arm.query}&seq=${seq}&arm=${arm.name}`;
      requests.push({
        seq,
        round,
        warmup: isWarmup,
        arm: arm.name,
        expectedId: arm.expectedId,
        expectedPhaseB: arm.expectedPhaseB,
        expectedPhaseBArmId: arm.expectedPhaseBArmId,
        expectedPhaseBUpcoming: arm.expectedPhaseBUpcoming,
        expectedChunk: arm.expectedChunk,
        url,
      });
      seq++;
    }
  }
  return requests;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOne(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, error: undefined };
  } catch (err) {
    return { status: undefined, json: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One driver.jsonl record. Never logs headers or any `cf`/geo field — aggregates and pass/fail facts only. */
function toRecord(req, result) {
  const payload = result.json;
  const algorithms = Array.isArray(payload?.algorithms) ? payload.algorithms : [];
  return {
    seq: req.seq,
    round: req.round,
    warmup: req.warmup,
    arm: req.arm,
    expectedId: req.expectedId,
    expectedPhaseB: req.expectedPhaseB,
    expectedPhaseBArmId: req.expectedPhaseBArmId,
    expectedPhaseBUpcoming: req.expectedPhaseBUpcoming,
    expectedChunk: req.expectedChunk,
    status: result.status ?? null,
    echoedId: payload?.params?.rpArm?.id ?? null,
    echoedPhaseB: typeof payload?.params?.phaseB === "boolean" ? payload.params.phaseB : null,
    echoedPhaseBArmId: payload?.params?.phaseBArm?.id ?? null,
    echoedPhaseBArmRan: payload?.params?.phaseBArm?.ran ?? null,
    echoedPhaseBUpcoming: payload?.params?.phaseBUpcoming ?? null,
    /** `params.chunk` — the fifth identity field, and the only one that tells a chunk arm from the `all` arm. */
    echoedChunk: payload?.params?.chunk ?? null,
    echoedPhaseBTeams: typeof payload?.params?.phaseBTeams === "number" ? payload.params.phaseBTeams : null,
    ok: typeof payload?.ok === "boolean" ? payload.ok : null,
    fold: payload?.fold ?? null,
    phaseB: payload?.phaseB ?? null,
    chunk: payload?.chunk ?? null,
    teamsLength: Array.isArray(payload?.params?.teams) ? payload.params.teams.length : null,
    discoveryQueries: typeof payload?.discovery?.queries === "number" ? payload.discovery.queries : null,
    algorithms: algorithms.map((a) => ({ id: a.id, ok: a.ok, snapshotShapeVersionObserved: a.snapshotShapeVersionObserved })),
    shapeVersionExpected: payload?.shapeVersionExpected ?? null,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    error: result.error,
  };
}

function isArmLabel(warning) {
  return warning.includes(ARM_LABEL_MARKER);
}

function isPhaseBArmLabel(warning) {
  return warning.includes(PHASE_B_ARM_LABEL_MARKER);
}

function isPhaseBLabel(warning) {
  return PHASE_B_LABEL_PREFIXES.some((prefix) => warning.startsWith(prefix));
}

function isChunkLabel(warning) {
  return warning.startsWith(CHUNK_LABEL_PREFIX);
}

function nonArmWarnings(record) {
  return record.warnings
    .filter((w) => !isArmLabel(w) && !isPhaseBArmLabel(w) && !isPhaseBLabel(w) && !isChunkLabel(w))
    .slice()
    .sort();
}

/**
 * The seven Phase B component names, in the probe's canonical order. Kept here
 * ONLY to check the echoed `ran` record for internal consistency with the id it
 * arrived with — the driver deliberately does not reimplement the probe's
 * dependency rules. `stateProbe.test.ts` Group 10 owns the rules themselves.
 */
const PHASE_B_COMPONENTS = ["eventParse", "eventValidate", "eventMerge", "eventStringify", "teamValidate", "teamMerge", "teamStringify"];

/** Every `FoldResult` counter, so a chunk arm can be checked for reporting them ALL at rest rather than just the one a reader happens to look at. */
const FOLD_COUNTER_FIELDS = [
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
  "changedRowsDiscarded",
];

/**
 * Validates the warm-up round(s) before spending time on the full run. Exits 2
 * with a specific message on any failure — never silently proceeds to measure
 * an arm the probe did not actually run as requested.
 */
function runWarmupGate(warmupRecords) {
  for (const rec of warmupRecords) {
    const isChunkArm = CHUNK_ARMS.includes(rec.arm);

    if (rec.status !== 200) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} status=${rec.status} (expected 200)`);
      process.exit(2);
    }
    if (rec.ok !== true) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} body.ok=${rec.ok} (expected true)`);
      process.exit(2);
    }
    if (rec.echoedId !== rec.expectedId) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedId="${rec.echoedId}" !== expectedId="${rec.expectedId}"`);
      process.exit(2);
    }
    if (rec.echoedPhaseB !== rec.expectedPhaseB) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedPhaseB=${rec.echoedPhaseB} !== expectedPhaseB=${rec.expectedPhaseB}`);
      process.exit(2);
    }
    if (rec.echoedPhaseBArmId !== rec.expectedPhaseBArmId) {
      console.error(
        `WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedPhaseBArmId="${rec.echoedPhaseBArmId}" !== expectedPhaseBArmId="${rec.expectedPhaseBArmId}"`
      );
      process.exit(2);
    }
    if (rec.echoedPhaseBUpcoming !== rec.expectedPhaseBUpcoming) {
      console.error(
        `WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedPhaseBUpcoming="${rec.echoedPhaseBUpcoming}" !== expectedPhaseBUpcoming="${rec.expectedPhaseBUpcoming}"`
      );
      process.exit(2);
    }
    // THE FIFTH FIELD. Without it `chunkTeams` and `all` are indistinguishable
    // on every check above, and a chunk cpuTime would be recorded as Phase A's.
    if (rec.echoedChunk !== rec.expectedChunk) {
      console.error(
        `WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedChunk="${rec.echoedChunk}" !== expectedChunk="${rec.expectedChunk}" — the probe did not run the split-tick chunk this arm asked for (an unrecognized chunk= value runs NOTHING and says so, which is exactly this failure); a null here means the probe is older than this rig`
      );
      process.exit(2);
    }

    const ran = rec.echoedPhaseBArmRan;
    if (ran === null || typeof ran !== "object") {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} carries no params.phaseBArm.ran — the probe is older than this rig`);
      process.exit(2);
    }
    const missing = PHASE_B_COMPONENTS.filter((name) => typeof ran[name] !== "boolean");
    if (missing.length > 0) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} params.phaseBArm.ran is missing component(s) ${JSON.stringify(missing)}`);
      process.exit(2);
    }
    // Every arm in THIS rig runs the full Phase B component set when Phase B
    // runs at all: no arm here ablates a component. A "skip:" id would mean the
    // rig and the probe disagree.
    if (rec.expectedPhaseBArmId === "all" && PHASE_B_COMPONENTS.some((name) => ran[name] === false)) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} id is "all" but a component did not run: ${JSON.stringify(ran)}`);
      process.exit(2);
    }

    const phaseBRan = rec.phaseB?.ran;
    if (phaseBRan !== rec.expectedPhaseB) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} phaseB.ran=${phaseBRan} !== expectedPhaseB=${rec.expectedPhaseB}`);
      process.exit(2);
    }

    // The chunk really ran (or really did not), behaviourally — not just
    // according to the echoed param.
    const chunkRan = rec.chunk?.ran;
    if (chunkRan !== isChunkArm) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} chunk.ran=${chunkRan}, expected ${isChunkArm}`);
      process.exit(2);
    }
    if (rec.chunk?.error !== undefined && rec.chunk?.error !== null) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} chunk.error=${JSON.stringify(rec.chunk.error)}`);
      process.exit(2);
    }

    if (isChunkArm) {
      // The chunk touches D1 zero times, so discovery must report zero queries
      // and the algorithms list must be empty. A non-zero here means the
      // request fell through to the normal path and is spending D1 rows.
      if (rec.discoveryQueries !== 0) {
        console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} discovery.queries=${rec.discoveryQueries}, expected 0 — the chunk arm must reach D1 zero times`);
        process.exit(2);
      }
      if (rec.algorithms.length !== 0) {
        console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} algorithms[] is non-empty — the chunk arm deserializes nothing`);
        process.exit(2);
      }
      const nonZeroFold = FOLD_COUNTER_FIELDS.filter((field) => (rec.fold?.[field] ?? 0) !== 0);
      if (nonZeroFold.length > 0) {
        console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} fold counter(s) ${JSON.stringify(nonZeroFold)} are non-zero — the chunk arm folds nothing`);
        process.exit(2);
      }
      // THE TWO GROUPS THAT INVALIDATE THE COMPARISON IF THEY ARE ZERO: a
      // published row thinner than what allPhaseB merges would make the chunk
      // price less work while looking healthy. Caught here, before an hour of
      // wall clock, not after.
      if (!(rec.chunk?.predictionsWithRpPmf > 0)) {
        console.error(
          `WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} chunk.predictionsWithRpPmf=${rec.chunk?.predictionsWithRpPmf} — the published played rows carry no RP pmf, so this chunk is pricing a THINNER row than allPhaseB merges and the comparison would be invalid`
        );
        process.exit(2);
      }
      if (!(rec.chunk?.predictionsWithBand > 0)) {
        console.error(
          `WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} chunk.predictionsWithBand=${rec.chunk?.predictionsWithBand} — the published played rows carry no Match Band, same invalidity as above`
        );
        process.exit(2);
      }
      if (!(rec.chunk?.matchesReconstructed > 0)) {
        console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} chunk.matchesReconstructed=${rec.chunk?.matchesReconstructed} — nothing was rebuilt`);
        process.exit(2);
      }
    } else {
      for (const algo of rec.algorithms) {
        if (algo.ok !== true) {
          console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} algorithm "${algo.id}" ok=false`);
          process.exit(2);
        }
      }
    }
  }

  // The shared-environment comparison, run SEPARATELY over the chunk arms and
  // the non-chunk arms: a chunk request runs a different path and emits none of
  // the probe's usual environment warnings, so pooling the two would reject a
  // valid run.
  for (const group of ["nonChunk", "chunk"]) {
    const groupRecords = warmupRecords.filter((rec) => (group === "chunk") === CHUNK_ARMS.includes(rec.arm));
    let shared;
    for (const rec of groupRecords) {
      const nonArm = nonArmWarnings(rec);
      if (shared === undefined) {
        shared = nonArm;
      } else if (JSON.stringify(nonArm) !== JSON.stringify(shared)) {
        console.error(
          `WARM-UP GATE FAILED: non-arm warnings differ within the "${group}" group — arm "${rec.arm}" seq=${rec.seq} has ${JSON.stringify(nonArm)}, expected ${JSON.stringify(shared)} (the environment warnings must be identical for every arm in a group, or a cpuTime comparison is not apples-to-apples)`
        );
        process.exit(2);
      }
    }
    if (groupRecords.length > 0) {
      console.log(`Warm-up gate: "${group}" group shared non-arm warnings (${shared?.length ?? 0}):`);
      for (const w of shared ?? []) console.log(`  - ${w}`);
    }
  }

  for (const rec of warmupRecords) {
    const isChunkArm = CHUNK_ARMS.includes(rec.arm);
    const armLabelCount = rec.warnings.filter(isArmLabel).length;
    const expectedArmLabelCount = rec.expectedId === "all" ? 0 : 1;
    if (armLabelCount !== expectedArmLabelCount) {
      console.error(`WARM-UP GATE FAILED: arm "${rec.arm}" seq=${rec.seq} carries ${armLabelCount} "${ARM_LABEL_MARKER}" warning(s), expected exactly ${expectedArmLabelCount}`);
      process.exit(2);
    }
    const phaseBArmLabelCount = rec.warnings.filter(isPhaseBArmLabel).length;
    if (phaseBArmLabelCount !== 0) {
      console.error(`WARM-UP GATE FAILED: arm "${rec.arm}" seq=${rec.seq} carries ${phaseBArmLabelCount} "${PHASE_B_ARM_LABEL_MARKER}" warning(s); no arm in this rig ablates a Phase B component`);
      process.exit(2);
    }
    // A chunk arm MUST announce itself, and a non-chunk arm must never claim a
    // chunk it did not run.
    const chunkLabelCount = rec.warnings.filter(isChunkLabel).length;
    const expectedChunkLabelCount = isChunkArm ? EXPECTED_CHUNK_WARNINGS : 0;
    if (chunkLabelCount !== expectedChunkLabelCount) {
      console.error(`WARM-UP GATE FAILED: arm "${rec.arm}" seq=${rec.seq} carries ${chunkLabelCount} chunk warning(s), expected exactly ${expectedChunkLabelCount}`);
      process.exit(2);
    }
    const phaseBLabelCount = rec.warnings.filter(isPhaseBLabel).length;
    if (!rec.expectedPhaseB && phaseBLabelCount > 0) {
      console.error(`WARM-UP GATE FAILED: arm "${rec.arm}" seq=${rec.seq} carries ${phaseBLabelCount} phaseB warning(s) although phaseB was off`);
      process.exit(2);
    }
  }

  console.log("Warm-up gate passed.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requests = buildRequests(args);

  console.log(`THE BAR, pre-registered ${PRE_REGISTERED_BAR.statedBefore}:`);
  console.log(`  ${PRE_REGISTERED_BAR.text}`);
  console.log("");

  if (args.dryRun) {
    console.log(`DRY RUN — ${requests.length} URL(s), no fetch performed:`);
    for (const req of requests) {
      console.log(`  seq=${req.seq} round=${req.round} warmup=${req.warmup} arm=${req.arm} chunk=${req.expectedChunk} ${req.url}`);
    }
    return;
  }

  await mkdir(args.out, { recursive: true });
  const driverPath = `${args.out}/driver.jsonl`;

  const warmupRecords = [];
  let gateChecked = false;
  let lastRound = -1;

  for (const req of requests) {
    const result = await fetchOne(req.url);
    const record = toRecord(req, result);
    await appendFile(driverPath, `${JSON.stringify(record)}\n`, "utf8");

    if (req.warmup) {
      warmupRecords.push(record);
    } else if (!gateChecked) {
      runWarmupGate(warmupRecords);
      gateChecked = true;
    }

    if (req.round !== lastRound) {
      lastRound = req.round;
      const label = req.warmup ? "warm-up" : "measured";
      console.log(`round ${req.round + 1}/${args.warmup + args.rounds} (${label}) — seq ${req.seq}`);
    }

    const isLast = req === requests[requests.length - 1];
    if (!isLast && args.delayMs > 0) await sleep(args.delayMs);
  }

  // All requests were warm-up (e.g. --rounds 0): still run the gate once.
  if (!gateChecked) runWarmupGate(warmupRecords);

  console.log(`DRIVER DONE — ${requests.length} request(s) written to ${driverPath}`);
}

const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main();
}
