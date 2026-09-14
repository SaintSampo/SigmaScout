/**
 * ALGO-05: does SPR's within-season adaptation help? Paired walk-forward A/B,
 * adaptation ON (packages/spr/frozen-params.json) against each committed OFF
 * arm in ../arms/, over the same match stream.
 *
 * Every arm replays 2016 -> 2026 once, predicting before it updates. Deltas
 * are ON minus OFF, oriented so a POSITIVE number always means adaptation
 * helped: accuracy ON - OFF, Brier OFF - ON, log loss OFF - ON. Intervals are
 * 95% event-blocked percentile bootstraps (2000 resamples, seed 42) from the
 * project's shared resampler.
 *
 * Run from the repo root: npx tsx <this file>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { eventBlockedBootstrap } from "../../../../packages/harness/eventBootstrap.js";
import { accuracyCall, outcomeTarget } from "../../../../packages/core/scoring/brier.js";
import { frozenParams, replay, summarize, type ArmParams, type Scored } from "./runner.js";

const DIR = ".planning/quick/260914-ndu-clear-algo-05-prove-whether-spr-within-s";
const ALL_YEARS = new Set([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
const HOLDOUT = [2023, 2024, 2025, 2026];
const DESIGN = [2016, 2017, 2018, 2019, 2020, 2022];

interface Pair {
  readonly eventKey: string;
  readonly year: number;
  readonly compLevel: string;
  readonly winner: Scored["winner"];
  readonly pOn: number;
  readonly pOff: number;
}

const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};

/** Per-match deltas, precomputed once so each bootstrap statistic is a plain mean. */
interface Delta {
  readonly eventKey: string;
  /** ON hit minus OFF hit, or null where accuracyCall excludes the match (a tie). */
  readonly acc: number | null;
  readonly brier: number;
  readonly logLoss: number;
}

function toDelta(u: Pair): Delta {
  const on = accuracyCall({ pRedWin: u.pOn, actualWinner: u.winner });
  const off = accuracyCall({ pRedWin: u.pOff, actualWinner: u.winner });
  const t = outcomeTarget(u.winner);
  const ll = (p: number) => -(t * Math.log(p) + (1 - t) * Math.log(1 - p));
  return {
    eventKey: u.eventKey,
    acc: on === null || off === null ? null : (on ? 1 : 0) - (off ? 1 : 0),
    brier: (u.pOff - t) ** 2 - (u.pOn - t) ** 2,
    logLoss: ll(u.pOff) - ll(u.pOn),
  };
}

function accHelp(units: readonly Delta[]): number {
  let n = 0;
  let sum = 0;
  for (const u of units) {
    if (u.acc === null) continue;
    n += 1;
    sum += u.acc;
  }
  return n > 0 ? sum / n : 0;
}
const meanOf = (pick: (d: Delta) => number) => (units: readonly Delta[]): number => {
  let sum = 0;
  for (const u of units) sum += pick(u);
  return units.length > 0 ? sum / units.length : 0;
};
const brierHelp = meanOf((d) => d.brier);
const logLossHelp = meanOf((d) => d.logLoss);

type Verdict = "HELPS" | "HURTS" | "MIXED" | "NO DETECTABLE EFFECT";
interface Interval {
  point: number;
  lo: number;
  hi: number;
}

function boot(units: readonly Delta[], stat: (u: readonly Delta[]) => number): Interval {
  const r = eventBlockedBootstrap(units, stat);
  return { point: r.pointEstimate, lo: r.percentile.lower, hi: r.percentile.upper };
}

/**
 * Pre-registered in PLAN.md. `accIdentical` is the tau-only case, where both
 * arms make the same call on every match by construction and Brier decides.
 */
function verdict(acc: Interval, brier: Interval, accIdentical: boolean): Verdict {
  const favours = (i: Interval) => i.lo > 0;
  const against = (i: Interval) => i.hi < 0;
  if (accIdentical) return favours(brier) ? "HELPS" : against(brier) ? "HURTS" : "NO DETECTABLE EFFECT";
  if (acc.point > 0 && brier.point > 0 && (favours(acc) || favours(brier)) && !against(acc) && !against(brier)) return "HELPS";
  if (acc.point < 0 && brier.point < 0 && (against(acc) || against(brier)) && !favours(acc) && !favours(brier)) return "HURTS";
  if ((favours(acc) && against(brier)) || (against(acc) && favours(brier))) return "MIXED";
  return "NO DETECTABLE EFFECT";
}

const fmtPp = (i: Interval) =>
  `${i.point >= 0 ? "+" : ""}${(100 * i.point).toFixed(3)}pp [${(100 * i.lo).toFixed(3)}, ${(100 * i.hi).toFixed(3)}]`;
const fmtB = (i: Interval) => `${i.point >= 0 ? "+" : ""}${i.point.toFixed(5)} [${i.lo.toFixed(5)}, ${i.hi.toFixed(5)}]`;

const t0 = Date.now();
const on = replay(frozenParams(), ALL_YEARS, 2026);
say(`ON replayed: ${on.length} scored matches 2016-2026 (${Date.now() - t0}ms)`);
for (const [label, years] of [["design 2016-2022", DESIGN], ["holdout 2023-2026", HOLDOUT]] as const) {
  const s = summarize(on.filter((r) => (years as readonly number[]).includes(r.year)));
  say(`  ON ${label}: n ${s.n}  acc ${(100 * s.acc).toFixed(3)}%  brier ${s.brier.toFixed(5)}  logloss ${s.logLoss.toFixed(5)}`);
}

const armFiles = readdirSync(`${DIR}/arms`).filter((f) => f.startsWith("off-") && f.endsWith(".json")).sort();
const summaryRows: string[] = [];

for (const file of armFiles) {
  const name = file.replace(/\.json$/, "");
  const arm = JSON.parse(readFileSync(`${DIR}/arms/${file}`, "utf8")) as { overrides: Partial<ArmParams>; params: ArmParams };
  const off = replay(arm.params, ALL_YEARS, 2026);
  const offByKey = new Map(off.map((r) => [r.matchKey, r]));
  const pairs: Pair[] = [];
  for (const r of on) {
    const o = offByKey.get(r.matchKey);
    if (o === undefined) throw new Error(`${name}: ${r.matchKey} missing from off arm`);
    pairs.push({ eventKey: r.eventKey, year: r.year, compLevel: r.compLevel, winner: r.winner, pOn: r.pRed, pOff: o.pRed });
  }
  const accIdentical = pairs.every(
    (p) => accuracyCall({ pRedWin: p.pOn, actualWinner: p.winner }) === accuracyCall({ pRedWin: p.pOff, actualWinner: p.winner }),
  );

  say(`\n=== ${name}  ${JSON.stringify(arm.overrides)} ===`);
  say(`  slice                    n       events  dAcc (ON-OFF)                      dBrier (OFF-ON)                 dLogLoss (OFF-ON)`);
  const slices: Array<[string, (p: Pair) => boolean]> = [
    ["HOLDOUT 2023-2026", (p) => HOLDOUT.includes(p.year)],
    ["  holdout quals only", (p) => HOLDOUT.includes(p.year) && p.compLevel === "qm"],
    ...HOLDOUT.map((y) => [`  ${y}`, (p: Pair) => p.year === y] as [string, (p: Pair) => boolean]),
    ["design 2016-2022", (p) => DESIGN.includes(p.year)],
  ];
  let headline: { acc: Interval; brier: Interval; v: Verdict } | null = null;
  for (const [label, keep] of slices) {
    const units = pairs.filter(keep).map(toDelta);
    const events = new Set(units.map((u) => u.eventKey)).size;
    const acc = boot(units, accHelp);
    const brier = boot(units, brierHelp);
    const ll = boot(units, logLossHelp);
    say(`  ${label.padEnd(22)} ${String(units.length).padStart(6)}  ${String(events).padStart(5)}  ${fmtPp(acc).padEnd(34)} ${fmtB(brier).padEnd(31)} ${fmtB(ll)}`);
    if (label === "HOLDOUT 2023-2026") headline = { acc, brier, v: verdict(acc, brier, accIdentical) };
  }
  if (headline === null) throw new Error("no headline slice");
  say(`  VERDICT (holdout, pre-registered rule): ${headline.v}${accIdentical ? "  (calls identical on every match; judged on Brier)" : ""}`);
  summaryRows.push(`  ${name.padEnd(16)} ${fmtPp(headline.acc).padEnd(34)} ${fmtB(headline.brier).padEnd(31)} ${headline.v}`);
}

say(`\n=== SUMMARY: adaptation ON vs OFF on 2023-2026, positive = adaptation helps ===`);
say(`  arm              dAcc (ON-OFF)                      dBrier (OFF-ON)                 verdict`);
for (const row of summaryRows) say(row);
writeFileSync(`${DIR}/AB-RESULT.txt`, log.join("\n") + "\n");
