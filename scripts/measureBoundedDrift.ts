/**
 * OFFLINE BOUNDED-DRIFT INSTRUMENT. It measures and reports; it publishes
 * nothing. The bar it is judged against was committed before this file existed
 * (`.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`, section
 * `BOUNDED DRIFT — the bar, pre-registered BEFORE any number`, commit 41baf5f0).
 *
 * THE QUESTION. `measureReplayParity.ts` showed a one-event fold from a
 * PRE-EVENT state block cannot reproduce the publisher, because SPR's league
 * scalars (`scale`, `logTau`) are stepped by every other event's matches in
 * between. It also showed the error is exactly zero at match 1. This asks where
 * in between it crosses the published rounding grid: start the fold from the
 * publisher's own state as of the instant before match `k`, fold the event's
 * own matches `k .. k+h-1` and nothing else, and ask whether the row for match
 * `k+h-1` still equals the publisher's. `h` is the horizon.
 *
 * ONE FOLD PER START, not one per window. The row a fold from `k` produces at
 * its `h`-th match IS window `(k, h)`'s final row, so folding `maxHorizon`
 * matches once from each `k` yields every horizon for that start.
 *
 * TRUTH is arm C of `measureReplayParity.ts` (the real `SigmaScoutLayer` over
 * the publisher's two-pass structure), which 260917-mwu gated equal to the
 * published bodies on these events. THE VALIDITY GATE here is `h = 1`: it
 * predicts from the publisher's own state having folded nothing, so it must be
 * exact on every window, and a pass where it is not is discarded.
 *
 * SAFETY is inherited from `measureReplayParity.ts`, whose exports this file
 * uses and whose own test scans them: no network, no environment variable, the
 * corpus opened read-only, nothing written outside `--out`.
 *
 * USAGE (no `.env`, no network):
 *   npx tsx scripts/measureBoundedDrift.ts --events 2026arc,2026nyro,2026auwarp
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import { armHarness, armReplay, deepStrictEqual, parseEventsArg, type ArmRows, type HarnessPass } from "./measureReplayParity.js";

export const DEFAULT_MAX_HORIZON = 20;

/** The pre-registered thresholds, as data, so the verdict is computed and never argued. */
export const BOUNDED_DRIFT_BAR = {
  /** IT WORKED needs every window exact at every horizon up to at least this one, on every event. */
  workedMinHorizon: 5,
  /** IT DID NOT WORK when any event's exact share at this horizon falls below `didNotWorkShare`. */
  didNotWorkHorizon: 2,
  didNotWorkShare: 0.99,
} as const;

export interface HorizonResult {
  readonly horizon: number;
  readonly windows: number;
  readonly exact: number;
  readonly exactShare: number;
  /** Median and maximum league steps the fold missed across this horizon's windows: other events' matches between match `k` and match `k+h-1` in the season stream. */
  readonly medianMissedLeagueSteps: number;
  readonly maxMissedLeagueSteps: number;
  /** The first window that was not exact, as `startMatchKey -> finalMatchKey`. */
  readonly firstInexactWindow?: string;
}

export interface EventDrift {
  readonly eventKey: string;
  readonly matches: number;
  readonly horizons: HorizonResult[];
  /** The largest `H` with every window exact at every `h <= H`. 0 when `h = 1` itself fails. */
  readonly largestAllExactHorizon: number;
}

/** True when the three published surfaces of one match are deep-equal between the two arms. Thirteen objects for a six-robot match: one event row, six team rows, six history records. */
export function matchRowsEqual(truth: ArmRows, arm: ArmRows, match: MatchResult): boolean {
  const eventTruth = truth.eventRows.get(match.matchKey);
  const eventArm = arm.eventRows.get(match.matchKey);
  if (eventTruth === undefined || eventArm === undefined || !deepStrictEqual(eventTruth, eventArm)) return false;
  for (const teamKey of new Set([...match.redTeams, ...match.blueTeams])) {
    const key = `${teamKey}|${match.matchKey}`;
    const teamTruth = truth.teamRows.get(key);
    const teamArm = arm.teamRows.get(key);
    // A demo robot has no team row on either side; absent on both is equal.
    if ((teamTruth === undefined) !== (teamArm === undefined)) return false;
    if (teamTruth !== undefined && !deepStrictEqual(teamTruth, teamArm)) return false;
    const historyTruth = truth.historyMetrics.get(key);
    const historyArm = arm.historyMetrics.get(key);
    if ((historyTruth === undefined) !== (historyArm === undefined)) return false;
    if (historyTruth !== undefined && !deepStrictEqual(historyTruth, historyArm)) return false;
  }
  return true;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Other events' matches between two of this event's matches in the season stream: the span, minus this event's own matches inside it. */
export function missedLeagueSteps(streamIndexStart: number, streamIndexFinal: number, ownMatchesBetween: number): number {
  return streamIndexFinal - streamIndexStart - ownMatchesBetween;
}

export function measureEvent(pass: HarnessPass, eventKey: string, maxHorizon: number): EventDrift {
  const matches = pass.eventStream.get(eventKey) ?? [];
  const truth = pass.armC.get(eventKey);
  if (truth === undefined || matches.length === 0) throw new Error(`measureBoundedDrift: ${eventKey} has no played matches in the priced season`);

  const windows = new Map<number, { exact: number; total: number; missed: number[]; firstInexact?: string }>();
  for (let h = 1; h <= maxHorizon; h++) windows.set(h, { exact: 0, total: 0, missed: [] });

  for (let k = 0; k < matches.length; k++) {
    const start = matches[k]!;
    const state = pass.stateBeforeMatch.get(start.matchKey);
    const passengers = pass.passengersBeforeMatch.get(start.matchKey);
    if (state === undefined || passengers === undefined) throw new Error(`measureBoundedDrift: no captured state before ${start.matchKey}`);
    const slice = matches.slice(k, k + maxHorizon);
    const folded = armReplay(state, passengers, slice, pass.coldStartKeys, pass.lookups, { throughWire: true });
    const startIndex = pass.streamIndex.get(start.matchKey)!;
    for (let h = 1; h <= slice.length; h++) {
      const final = slice[h - 1]!;
      const bucket = windows.get(h)!;
      bucket.total++;
      bucket.missed.push(missedLeagueSteps(startIndex, pass.streamIndex.get(final.matchKey)!, h - 1));
      if (matchRowsEqual(truth, folded.rows, final)) bucket.exact++;
      else bucket.firstInexact ??= `${start.matchKey} -> ${final.matchKey}`;
    }
  }

  const horizons: HorizonResult[] = [];
  for (let h = 1; h <= maxHorizon; h++) {
    const bucket = windows.get(h)!;
    if (bucket.total === 0) continue;
    horizons.push({
      horizon: h,
      windows: bucket.total,
      exact: bucket.exact,
      exactShare: bucket.exact / bucket.total,
      medianMissedLeagueSteps: median(bucket.missed),
      maxMissedLeagueSteps: Math.max(...bucket.missed),
      ...(bucket.firstInexact !== undefined ? { firstInexactWindow: bucket.firstInexact } : {}),
    });
  }
  let largestAllExactHorizon = 0;
  for (const result of horizons) {
    if (result.exact !== result.windows) break;
    largestAllExactHorizon = result.horizon;
  }
  return { eventKey, matches: matches.length, horizons, largestAllExactHorizon };
}

export type Verdict = "DISCARDED: validity gate failed" | "IT WORKED" | "IT DID NOT WORK" | "INCONCLUSIVE";

/** The committed bar, applied mechanically. The gate is checked first and nothing else is read when it fails. */
export function verdictOf(events: readonly EventDrift[]): Verdict {
  if (events.length === 0) return "DISCARDED: validity gate failed";
  const gate = events.every((event) => {
    const first = event.horizons.find((result) => result.horizon === 1);
    return first !== undefined && first.exact === first.windows;
  });
  if (!gate) return "DISCARDED: validity gate failed";
  const failed = events.some((event) => {
    const at = event.horizons.find((result) => result.horizon === BOUNDED_DRIFT_BAR.didNotWorkHorizon);
    return at !== undefined && at.exactShare < BOUNDED_DRIFT_BAR.didNotWorkShare;
  });
  if (failed) return "IT DID NOT WORK";
  if (events.every((event) => event.largestAllExactHorizon >= BOUNDED_DRIFT_BAR.workedMinHorizon)) return "IT WORKED";
  return "INCONCLUSIVE";
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: { events: { type: "string" }, "max-horizon": { type: "string" }, out: { type: "string" }, corpus: { type: "string" } },
  });
  const events = parseEventsArg(values.events);
  const maxHorizon = values["max-horizon"] !== undefined ? Number(values["max-horizon"]) : DEFAULT_MAX_HORIZON;
  if (!Number.isInteger(maxHorizon) || maxHorizon < 2) throw new Error("--max-horizon must be an integer of at least 2");

  const db = openCorpusReadOnly(values.corpus ?? "data/corpus.sqlite");
  try {
    const pass = armHarness(db, events, { perMatchPassengers: true });
    const results = events.map((eventKey) => measureEvent(pass, eventKey, maxHorizon));
    const verdict = verdictOf(results);

    for (const event of results) {
      console.log(`\n${event.eventKey}: ${event.matches} matches, largest all-exact horizon ${event.largestAllExactHorizon}`);
      console.log("  h  windows  exact   share    missed league steps (median / max)");
      for (const r of event.horizons) {
        console.log(
          `  ${String(r.horizon).padStart(2)}  ${String(r.windows).padStart(7)}  ${String(r.exact).padStart(5)}  ${(r.exactShare * 100).toFixed(1).padStart(6)}%   ${String(r.medianMissedLeagueSteps).padStart(6)} / ${r.maxMissedLeagueSteps}`
        );
      }
    }
    console.log(`\nVERDICT against the committed bar: ${verdict}`);

    if (values.out !== undefined) {
      mkdirSync(dirname(values.out), { recursive: true });
      writeFileSync(values.out, JSON.stringify({ bar: BOUNDED_DRIFT_BAR, maxHorizon, events: results, verdict }, null, 2));
      console.log(`wrote ${values.out}`);
    }
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2));
}
