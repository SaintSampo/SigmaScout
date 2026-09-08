/**
 * How much does FRC team strength persist across seasons, and what is carrying
 * a rating forward actually worth?
 *
 * Two measurements:
 *
 * 1. PERSISTENCE. Snapshot every team's rating at the end of each season and
 *    correlate consecutive snapshots. This is a property of FRC itself, not of
 *    the model - it answers "does last year's good robot predict this year's".
 *
 * 2. VALUE. Re-run the whole walk-forward at several `seasonShrink` settings
 *    (1.0 = carry the rating forward untouched, 0.0 = reset every team to
 *    league average each season) and compare early-season accuracy per year.
 *    The spread is what carryover buys, measured separately for each
 *    transition.
 *
 * ANALYSIS ONLY. This reports on holdout seasons because the question is about
 * FRC, not about fitting. Nothing here may be used to re-tune the frozen model;
 * doing so would convert the sealed evaluation into a training run.
 */
import { readFileSync } from "node:fs";
import { loadMatches, type BprMatch } from "./data.js";
import { BprModel, DEFAULTS, type BprParams } from "./model.js";

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (a[i] ?? 0) - ma;
    const y = (b[i] ?? 0) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

function ranks(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((p, q) => (v[p] ?? 0) - (v[q] ?? 0));
  const r = new Array<number>(v.length).fill(0);
  for (let i = 0; i < idx.length; i += 1) {
    const j = idx[i];
    if (j !== undefined) r[j] = i;
  }
  return r;
}

const spearman = (a: number[], b: number[]): number => pearson(ranks(a), ranks(b));

/** One full walk-forward; returns early-season and full-season accuracy per year. */
function runAt(
  matches: readonly BprMatch[],
  params: BprParams,
): { early: Map<number, [number, number]>; full: Map<number, [number, number]> } {
  const model = new BprModel(params);
  const early = new Map<number, [number, number]>();
  const full = new Map<number, [number, number]>();

  for (const m of matches) {
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;

    if (outcome !== 0.5) {
      const right = (pred.pRed > 0.5) === (outcome === 1) ? 1 : 0;
      const f = full.get(m.year) ?? [0, 0];
      full.set(m.year, [f[0] + right, f[1] + 1]);
      if (m.week !== null && m.week <= 1) {
        const e = early.get(m.year) ?? [0, 0];
        early.set(m.year, [e[0] + right, e[1] + 1]);
      }
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
  }
  return { early, full };
}

function main(): void {
  const paramsPath = process.argv[2] ?? "packages/bpr/frozen-params.json";
  const raw = JSON.parse(readFileSync(paramsPath, "utf8")) as { params?: BprParams };
  const base: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
  const matches = loadMatches("data/corpus.sqlite");

  // ---- 1. persistence of team strength across seasons ----
  const model = new BprModel(base);
  const snaps = new Map<number, Map<string, number>>();
  const played = new Map<number, Set<string>>();
  let cur = -1;
  for (const m of matches) {
    if (cur !== -1 && m.year !== cur) snaps.set(cur, model.snapshot());
    cur = m.year;
    if (!played.has(m.year)) played.set(m.year, new Set());
    const p = played.get(m.year);
    for (const t of [...m.redTeams, ...m.blueTeams]) p?.add(t);
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
    model.update(
      m.redTeams, m.blueTeams, m.year, m.redOut, m.blueOut,
      m.redFoul, m.blueFoul, outcome, isElim, pred,
    );
  }
  if (cur !== -1) snaps.set(cur, model.snapshot());

  const years = [...snaps.keys()].sort((a, b) => a - b);
  console.log("1. PERSISTENCE OF TEAM STRENGTH ACROSS SEASONS");
  console.log("   end-of-season rating vs end-of-next-season rating, teams in both");
  console.log("   transition      teams   pearson  spearman   gap");
  for (let i = 0; i < years.length - 1; i += 1) {
    const y0 = years[i];
    const y1 = years[i + 1];
    if (y0 === undefined || y1 === undefined) continue;
    const s0 = snaps.get(y0);
    const s1 = snaps.get(y1);
    const p0 = played.get(y0);
    const p1 = played.get(y1);
    if (!s0 || !s1 || !p0 || !p1) continue;
    const a: number[] = [];
    const b: number[] = [];
    for (const t of p0) {
      if (!p1.has(t)) continue;
      const x = s0.get(t);
      const y = s1.get(t);
      if (x !== undefined && y !== undefined) {
        a.push(x);
        b.push(y);
      }
    }
    const gap = y1 - y0;
    console.log(
      `   ${y0} -> ${y1}   ${String(a.length).padStart(5)}   ` +
        `${pearson(a, b).toFixed(3).padStart(6)}    ${spearman(a, b).toFixed(3).padStart(6)}   ` +
        `${gap} yr${gap > 1 ? " (COVID)" : ""}`,
    );
  }
  console.log("");

  // ---- 2. what carryover is worth, per transition ----
  const shrinks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const results = shrinks.map((s) => ({ s, r: runAt(matches, { ...base, seasonShrink: s }) }));

  console.log("2. EARLY-SEASON ACCURACY (weeks 0-1) BY CARRYOVER STRENGTH");
  console.log("   seasonShrink 0.0 = reset every team to average; 1.0 = carry rating untouched");
  console.log(
    "   year    " + shrinks.map((s) => s.toFixed(1).padStart(7)).join("") + "     best   gain",
  );
  for (const y of years) {
    const row = results.map((x) => {
      const e = x.r.early.get(y);
      return e && e[1] > 0 ? (100 * e[0]) / e[1] : NaN;
    });
    if (row.every((v) => Number.isNaN(v))) continue;
    let bi = 0;
    for (let i = 1; i < row.length; i += 1) if ((row[i] ?? -1) > (row[bi] ?? -1)) bi = i;
    const gain = (row[bi] ?? 0) - (row[0] ?? 0);
    console.log(
      `   ${y}  ` +
        row.map((v) => (Number.isNaN(v) ? "      -" : v.toFixed(2).padStart(7))).join("") +
        `    ${(shrinks[bi] ?? 0).toFixed(1)}   ${(gain >= 0 ? "+" : "") + gain.toFixed(2)}`,
    );
  }
  console.log("");

  console.log("3. FULL-SEASON ACCURACY BY CARRYOVER STRENGTH");
  console.log(
    "   year    " + shrinks.map((s) => s.toFixed(1).padStart(7)).join("") + "     best   gain",
  );
  for (const y of years) {
    const row = results.map((x) => {
      const f = x.r.full.get(y);
      return f && f[1] > 0 ? (100 * f[0]) / f[1] : NaN;
    });
    if (row.every((v) => Number.isNaN(v))) continue;
    let bi = 0;
    for (let i = 1; i < row.length; i += 1) if ((row[i] ?? -1) > (row[bi] ?? -1)) bi = i;
    const gain = (row[bi] ?? 0) - (row[0] ?? 0);
    console.log(
      `   ${y}  ` +
        row.map((v) => (Number.isNaN(v) ? "      -" : v.toFixed(2).padStart(7))).join("") +
        `    ${(shrinks[bi] ?? 0).toFixed(1)}   ${(gain >= 0 ? "+" : "") + gain.toFixed(2)}`,
    );
  }
}

main();
