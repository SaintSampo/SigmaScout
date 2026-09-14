#!/usr/bin/env node
/**
 * CLI driver: round-robins the nine (or a `--arms` subset of the) measurement
 * arms against a DEPLOYED probe, appending one JSON line per request to
 * `OUT/driver.jsonl`. Plain Node ESM, no dependencies — only native `fetch`,
 * `node:fs`, `node:path` and `node:url`.
 *
 * NEVER run this against a URL from inside an executor sandbox — this file is
 * for the orchestrator's main context only (see the quick task's plan, "M3").
 * Importing this module does nothing; execution is guarded below.
 */
import { mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ARMS, ARMS_BY_NAME, COMMON_QUERY } from "./arms.mjs";

const DEFAULT_BASE = "https://sigmascout-state-probe.jrw4561.workers.dev";
const DEFAULT_ROUNDS = 60;
const DEFAULT_WARMUP = 2;
const DEFAULT_DELAY_MS = 200;
const FETCH_TIMEOUT_MS = 30_000;
/** A warning is an arm label — never a shared/non-arm warning — exactly when it contains this case-sensitive substring. */
const ARM_LABEL_MARKER = "ABLATED ARM";

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

  if (args.out === undefined) usageError("--out is required");
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
 * across warm-up and measured rounds alike. Total rounds = `warmup + rounds`
 * — the first `warmup` rounds are excluded from analysis, never from the run.
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
      requests.push({ seq, round, warmup: isWarmup, arm: arm.name, expectedId: arm.expectedId, url });
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
  const body = result.json;
  const algorithms = Array.isArray(body?.algorithms) ? body.algorithms : [];
  return {
    seq: req.seq,
    round: req.round,
    warmup: req.warmup,
    arm: req.arm,
    expectedId: req.expectedId,
    status: result.status ?? null,
    echoedId: body?.params?.rpArm?.id ?? null,
    ok: typeof body?.ok === "boolean" ? body.ok : null,
    fold: body?.fold ?? null,
    teamsLength: Array.isArray(body?.params?.teams) ? body.params.teams.length : null,
    algorithms: algorithms.map((a) => ({ id: a.id, ok: a.ok, snapshotShapeVersionObserved: a.snapshotShapeVersionObserved })),
    shapeVersionExpected: body?.shapeVersionExpected ?? null,
    warnings: Array.isArray(body?.warnings) ? body.warnings : [],
    error: result.error,
  };
}

function isArmLabel(warning) {
  return warning.includes(ARM_LABEL_MARKER);
}

function nonArmWarnings(record) {
  return record.warnings.filter((w) => !isArmLabel(w)).slice().sort();
}

/**
 * Validates the warm-up round(s) before spending time on the full run.
 * Exits 2 with a specific message on any failure — never silently proceeds
 * to measure an arm the probe did not actually run as requested.
 */
function runWarmupGate(warmupRecords) {
  for (const rec of warmupRecords) {
    if (rec.status !== 200) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} status=${rec.status} (expected 200)`);
      process.exit(2);
    }
    if (rec.ok !== true) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} body.ok=${rec.ok} (expected true)`);
      process.exit(2);
    }
    if (rec.echoedId !== rec.expectedId) {
      console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} echoedId="${rec.echoedId}" !== expectedId="${rec.expectedId}" — the arm-id rules disagree with what this driver expects`);
      process.exit(2);
    }
    for (const algo of rec.algorithms) {
      if (algo.ok !== true) {
        console.error(`WARM-UP GATE FAILED: seq=${rec.seq} arm=${rec.arm} algorithm "${algo.id}" ok=false`);
        process.exit(2);
      }
    }
  }

  let sharedNonArm;
  const byArm = new Map();
  for (const rec of warmupRecords) {
    if (!byArm.has(rec.arm)) byArm.set(rec.arm, []);
    byArm.get(rec.arm).push(rec);
  }
  for (const [armName, recs] of byArm) {
    for (const rec of recs) {
      const nonArm = nonArmWarnings(rec);
      if (sharedNonArm === undefined) {
        sharedNonArm = nonArm;
      } else if (JSON.stringify(nonArm) !== JSON.stringify(sharedNonArm)) {
        console.error(
          `WARM-UP GATE FAILED: non-arm warnings differ across arms — arm "${armName}" seq=${rec.seq} has ${JSON.stringify(nonArm)}, expected ${JSON.stringify(sharedNonArm)} (the environment warnings must be identical for every arm, or a cpuTime comparison is not apples-to-apples)`
        );
        process.exit(2);
      }
      const armLabelCount = rec.warnings.filter(isArmLabel).length;
      const expectedArmLabelCount = armName === "all" ? 0 : 1;
      if (armLabelCount !== expectedArmLabelCount) {
        console.error(
          `WARM-UP GATE FAILED: arm "${armName}" seq=${rec.seq} carries ${armLabelCount} "${ARM_LABEL_MARKER}" warning(s), expected exactly ${expectedArmLabelCount}`
        );
        process.exit(2);
      }
    }
  }

  console.log(`Warm-up gate passed. Shared non-arm warnings (${sharedNonArm?.length ?? 0}):`);
  for (const w of sharedNonArm ?? []) console.log(`  - ${w}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requests = buildRequests(args);

  if (args.dryRun) {
    console.log(`DRY RUN — ${requests.length} URL(s), no fetch performed:`);
    for (const req of requests) {
      console.log(`  seq=${req.seq} round=${req.round} warmup=${req.warmup} arm=${req.arm} ${req.url}`);
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
