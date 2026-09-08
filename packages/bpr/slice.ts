/**
 * Diagnostic analysis of a single slice of a season (e.g. 2023 weeks 0-1).
 *
 * READ-ONLY with respect to the model. The holdout has already been spent on
 * one sealed evaluation; this script exists to understand the model's behaviour,
 * NOT to tune it. Nothing here may feed back into a parameter choice.
 *
 * The model is always warmed by walking the full chronological stream from 2016;
 * only the selected matches are scored, so a week-1 slice is measured with
 * exactly the state the model would really have had at that moment.
 */
import { readFileSync } from "node:fs";
import { loadMatches } from "./data.js";
import { BprModel, DEFAULTS, type BprParams } from "./model.js";

interface Rec {
  week: number | null;
  compLevel: string;
  pRed: number;
  outcome: number;
  /** Model's confidence in whichever side it favoured. */
  conf: number;
  favWon: boolean | null;
  /** Matches already played at this event before this one. */
  eventOrdinal: number;
  /** Fewest matches any of the six teams had played this season. */
  minExp: number;
  marginPoints: number;
  actualMargin: number;
}

function pct(x: number): string {
  return (100 * x).toFixed(2).padStart(6);
}

interface Summary {
  n: number;
  acc: number;
  /** What the model itself expected to get right in this group. */
  expected: number;
  brier: number;
  ll: number;
}

function summarize(rs: Rec[]): Summary {
  let dec = 0;
  let corr = 0;
  let conf = 0;
  let brier = 0;
  let ll = 0;
  for (const r of rs) {
    brier += (r.pRed - r.outcome) ** 2;
    ll += -(r.outcome * Math.log(r.pRed) + (1 - r.outcome) * Math.log(1 - r.pRed));
    if (r.favWon !== null) {
      dec += 1;
      conf += r.conf;
      if (r.favWon) corr += 1;
    }
  }
  return {
    n: rs.length,
    acc: dec > 0 ? corr / dec : 0,
    expected: dec > 0 ? conf / dec : 0,
    brier: rs.length > 0 ? brier / rs.length : 0,
    ll: rs.length > 0 ? ll / rs.length : 0,
  };
}

/**
 * Raw accuracy alone cannot separate "the model is worse on this subgroup" from
 * "these matches were genuinely closer". `exp%` is the accuracy the model itself
 * expected given how confident it was; `gap` is the part that needs explaining.
 */
function table(title: string, groups: Array<[string, Rec[]]>): void {
  console.log(title);
  console.log("  group                 n     acc%    exp%     gap    brier");
  for (const [name, rs] of groups) {
    if (rs.length === 0) continue;
    const s = summarize(rs);
    const gap = 100 * (s.acc - s.expected);
    console.log(
      `  ${name.padEnd(18)} ${String(s.n).padStart(5)}  ${pct(s.acc)}  ${pct(s.expected)}  ` +
        `${((gap >= 0 ? "+" : "") + gap.toFixed(2)).padStart(6)}  ${s.brier.toFixed(4)}`,
    );
  }
  console.log("");
}

function main(): void {
  const paramsPath = process.argv[2] ?? "packages/bpr/frozen-params.json";
  const year = Number(process.argv[3] ?? "2023");
  const weeks = new Set((process.argv[4] ?? "0,1").split(",").map((s) => Number(s.trim())));

  const raw = JSON.parse(readFileSync(paramsPath, "utf8")) as { params?: BprParams };
  const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };

  const model = new BprModel(params);
  const all = loadMatches("data/corpus.sqlite");

  const recs: Rec[] = [];
  const seasonPlayed = new Map<string, number>();
  const eventPlayed = new Map<string, number>();
  let seasonSeen = -1;
  const events = new Set<string>();

  for (const m of all) {
    if (seasonSeen !== m.year) {
      seasonPlayed.clear();
      seasonSeen = m.year;
    }
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;

    if (m.year === year && m.week !== null && weeks.has(m.week)) {
      events.add(m.eventKey);
      const teams = [...m.redTeams, ...m.blueTeams];
      let minExp = Number.POSITIVE_INFINITY;
      for (const t of teams) minExp = Math.min(minExp, seasonPlayed.get(t) ?? 0);
      const conf = Math.max(pred.pRed, 1 - pred.pRed);
      const favRed = pred.pRed >= 0.5;
      recs.push({
        week: m.week,
        compLevel: m.compLevel,
        pRed: pred.pRed,
        outcome,
        conf,
        favWon: outcome === 0.5 ? null : favRed === (outcome === 1),
        eventOrdinal: eventPlayed.get(m.eventKey) ?? 0,
        minExp: Number.isFinite(minExp) ? minExp : 0,
        marginPoints: pred.marginPoints,
        actualMargin: m.redOut - m.blueOut,
      });
    }

    model.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      m.redOut,
      m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      pred,
    );

    eventPlayed.set(m.eventKey, (eventPlayed.get(m.eventKey) ?? 0) + 1);
    for (const t of [...m.redTeams, ...m.blueTeams]) {
      seasonPlayed.set(t, (seasonPlayed.get(t) ?? 0) + 1);
    }
  }

  const s = summarize(recs);
  console.log(`BPR slice analysis - ${year} weeks ${[...weeks].sort().join(",")}`);
  console.log(`  params:  ${paramsPath}`);
  console.log(`  events:  ${events.size}`);
  console.log(`  matches: ${s.n}`);
  console.log(
    `  OVERALL  acc ${pct(s.acc)}%   brier ${s.brier.toFixed(4)}   logloss ${s.ll.toFixed(4)}`,
  );
  console.log("");

  table(
    "By week",
    [...weeks].sort((a, b) => a - b).map((w) => [`week ${w}`, recs.filter((r) => r.week === w)]),
  );

  table("By competition level", [
    ["qualification", recs.filter((r) => r.compLevel === "qm")],
    ["elimination", recs.filter((r) => r.compLevel !== "qm")],
  ]);

  table("By matches already played at that event", [
    ["0-19 (early)", recs.filter((r) => r.eventOrdinal < 20)],
    ["20-39", recs.filter((r) => r.eventOrdinal >= 20 && r.eventOrdinal < 40)],
    ["40-59", recs.filter((r) => r.eventOrdinal >= 40 && r.eventOrdinal < 60)],
    ["60+ (late)", recs.filter((r) => r.eventOrdinal >= 60)],
  ]);

  table("By least-experienced team on the field (matches this season)", [
    ["0 (a debut)", recs.filter((r) => r.minExp === 0)],
    ["1-3", recs.filter((r) => r.minExp >= 1 && r.minExp <= 3)],
    ["4-7", recs.filter((r) => r.minExp >= 4 && r.minExp <= 7)],
    ["8+", recs.filter((r) => r.minExp >= 8)],
  ]);

  // Reliability: does "70% confident" actually win 70% of the time?
  console.log("Calibration (confidence in the favoured alliance)");
  console.log("  bucket        n   predicted   actual    gap");
  const edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i] ?? 0;
    const hi = edges[i + 1] ?? 1;
    const inB = recs.filter((r) => r.conf >= lo && r.conf < hi && r.favWon !== null);
    if (inB.length === 0) continue;
    const predMean = inB.reduce((a, r) => a + r.conf, 0) / inB.length;
    const actual = inB.filter((r) => r.favWon === true).length / inB.length;
    const gap = actual - predMean;
    console.log(
      `  ${lo.toFixed(2)}-${hi > 1 ? "1.00" : hi.toFixed(2)} ${String(inB.length).padStart(6)}   ` +
        `${pct(predMean)}%   ${pct(actual)}%  ${(gap >= 0 ? "+" : "") + (100 * gap).toFixed(2)}`,
    );
  }
  console.log("");

  // Margin calibration: is the points-margin prediction biased or mis-scaled?
  const withMargin = recs.filter((r) => Number.isFinite(r.marginPoints));
  const meanPred = withMargin.reduce((a, r) => a + r.marginPoints, 0) / withMargin.length;
  const meanAct = withMargin.reduce((a, r) => a + r.actualMargin, 0) / withMargin.length;
  const mae = withMargin.reduce((a, r) => a + Math.abs(r.marginPoints - r.actualMargin), 0) /
    withMargin.length;
  const sdAct = Math.sqrt(
    withMargin.reduce((a, r) => a + (r.actualMargin - meanAct) ** 2, 0) / withMargin.length,
  );
  console.log("Score margin (foul-adjusted, red minus blue)");
  console.log(`  mean predicted ${meanPred.toFixed(2)}   mean actual ${meanAct.toFixed(2)}`);
  console.log(`  MAE ${mae.toFixed(2)} points   sd of actual margin ${sdAct.toFixed(2)}`);
  console.log("");

  const confident = recs.filter((r) => r.conf >= 0.75).length;
  const coinflip = recs.filter((r) => r.conf < 0.55).length;
  console.log("Confidence profile");
  console.log(`  near coin-flip (<55%): ${((100 * coinflip) / recs.length).toFixed(1)}%`);
  console.log(`  confident (>=75%):     ${((100 * confident) / recs.length).toFixed(1)}%`);
}

main();
