/**
 * Adversarial review 260908-vqr: like-for-like recount + event-clustered block
 * bootstrap over reports/260908-vqr-fourway/. Read-only.
 *
 * Applies the SHARED harness's scoring rules to every algorithm identically:
 *   - surrogate-affected matches excluded (D-07)
 *   - actual ties excluded from the accuracy denominator only
 *   - a pRedWin === 0.5 no-call counted as a MISS against a decided match (D-Q3)
 *   - Brier denominator = all scored predictions, ties included
 */
import { createReadStream, readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";

const DIR = "reports/260908-vqr-fourway";
const ALGOS = ["opr", "epa", "vpr", "bpr"] as const;
type Algo = (typeof ALGOS)[number];
const SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];
const DESIGN = [2016, 2017, 2018, 2019, 2020, 2022];
const HOLDOUT = [2023, 2024, 2025, 2026];

const db = new Database("data/corpus.sqlite", { readonly: true, fileMustExist: true });
const surr = new Set<string>();
for (const r of db
  .prepare(`select match_key, red_surrogates, blue_surrogates from matches where winner is not null`)
  .all() as Array<{ match_key: string; red_surrogates: string; blue_surrogates: string }>) {
  if (
    (JSON.parse(r.red_surrogates) as string[]).length > 0 ||
    (JSON.parse(r.blue_surrogates) as string[]).length > 0
  )
    surr.add(r.match_key);
}
db.close();
console.log(`surrogate-affected match keys in corpus: ${surr.size}`);

interface Rec {
  matchKey: string;
  season: number;
  eventKey: string;
  compLevel: string;
  algorithmId: Algo;
  algorithmVersion: string;
  pRedWin: number;
  actualWinner: string | null;
}

interface Cell {
  n: number;
  ties: number;
  noCall: number;
  accNum: number;
  accDen: number;
  brier: number;
}
const cell = (): Cell => ({ n: 0, ties: 0, noCall: 0, accNum: 0, accDen: 0, brier: 0 });
const key = (a: string, s: number, v: string): string => `${a}|${s}|${v}`;
const tbl = new Map<string, Cell>();

interface Paired {
  ev: string;
  season: number;
  comp: string;
  actual: string;
  /** True when the shared harness would exclude this match (D-07 surrogate rule). */
  isSurr: boolean;
  p: Partial<Record<Algo, number>>;
}
const paired = new Map<string, Paired>();
const versions = new Map<string, string>();

const viewsOf = (comp: string): string[] =>
  comp === "qm" ? ["qualification", "combined"] : ["elimination", "combined"];

async function ingest(season: number): Promise<void> {
  const f = `${DIR}/predictions-${season}.jsonl`;
  if (!existsSync(f)) return;
  const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as Rec;
    versions.set(r.algorithmId, r.algorithmVersion);
    if (r.actualWinner === null) continue;
    if (!(r.pRedWin >= 0 && r.pRedWin <= 1)) continue;

    // The paired map keeps EVERY match, surrogate-affected included, so the two
    // scoring conventions can be compared. The `tbl` recount below applies the
    // shared harness's D-07 exclusion.
    let pr = paired.get(r.matchKey);
    if (pr === undefined) {
      pr = {
        ev: r.eventKey,
        season: r.season,
        comp: r.compLevel,
        actual: r.actualWinner,
        isSurr: surr.has(r.matchKey),
        p: {},
      };
      paired.set(r.matchKey, pr);
    }
    pr.p[r.algorithmId] = r.pRedWin;

    if (surr.has(r.matchKey)) continue;
    const target = r.actualWinner === "red" ? 1 : r.actualWinner === "blue" ? 0 : 0.5;
    for (const v of viewsOf(r.compLevel)) {
      const k = key(r.algorithmId, r.season, v);
      let c = tbl.get(k);
      if (c === undefined) {
        c = cell();
        tbl.set(k, c);
      }
      c.n += 1;
      c.brier += (r.pRedWin - target) ** 2;
      if (r.actualWinner === "tie") c.ties += 1;
      if (r.pRedWin === 0.5) c.noCall += 1;
      if (r.actualWinner !== "tie") {
        c.accDen += 1;
        const fav = r.pRedWin > 0.5 ? "red" : r.pRedWin < 0.5 ? "blue" : null;
        if (fav !== null && fav === r.actualWinner) c.accNum += 1;
      }
    }
  }
}

const hit = (p: number, actual: string): number =>
  (p > 0.5 ? "red" : p < 0.5 ? "blue" : null) === actual ? 1 : 0;

function pool(a: Algo, yrs: number[], view: string): Cell {
  const out = cell();
  for (const s of yrs) {
    const c = tbl.get(key(a, s, view));
    if (c === undefined) continue;
    out.n += c.n;
    out.ties += c.ties;
    out.noCall += c.noCall;
    out.accNum += c.accNum;
    out.accDen += c.accDen;
    out.brier += c.brier;
  }
  return out;
}

function bootstrap(yrs: number[], view: string, label: string, draws = 2000): void {
  const recs = [...paired.values()].filter(
    (r) =>
      yrs.includes(r.season) &&
      r.actual !== "tie" &&
      !r.isSurr &&
      (view === "combined"
        ? true
        : view === "qualification"
          ? r.comp === "qm"
          : r.comp !== "qm") &&
      ALGOS.every((a) => r.p[a] !== undefined),
  );
  const byEvent = new Map<string, Paired[]>();
  for (const r of recs) {
    let g = byEvent.get(r.ev);
    if (g === undefined) {
      g = [];
      byEvent.set(r.ev, g);
    }
    g.push(r);
  }
  const events = [...byEvent.values()];

  const point: Record<string, number> = {};
  for (const a of ALGOS)
    point[a] = recs.reduce((s, r) => s + hit(r.p[a]!, r.actual), 0) / recs.length;

  const samples: Record<string, number[]> = {};
  for (const k of [...ALGOS, "bpr-vpr", "bpr-epa", "bpr-opr"]) samples[k] = [];

  for (let d = 0; d < draws; d++) {
    let n = 0;
    const s: Record<string, number> = { opr: 0, epa: 0, vpr: 0, bpr: 0 };
    for (let i = 0; i < events.length; i++) {
      const g = events[(Math.random() * events.length) | 0]!;
      n += g.length;
      for (const r of g) for (const a of ALGOS) s[a] += hit(r.p[a]!, r.actual);
    }
    for (const a of ALGOS) samples[a]!.push(s[a]! / n);
    samples["bpr-vpr"]!.push((s.bpr! - s.vpr!) / n);
    samples["bpr-epa"]!.push((s.bpr! - s.epa!) / n);
    samples["bpr-opr"]!.push((s.bpr! - s.opr!) / n);
  }

  const q = (arr: number[], p: number): number => {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * a.length)))]!;
  };
  const sd = (arr: number[]): number => {
    const m = arr.reduce((x, y) => x + y, 0) / arr.length;
    return Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / (arr.length - 1));
  };

  console.log(
    `\n=== BOOTSTRAP ${label} (${view}) — ${recs.length} decided matches in ${events.length} event blocks, ${draws} draws ===`,
  );
  for (const a of ALGOS) {
    const naive = Math.sqrt((point[a]! * (1 - point[a]!)) / recs.length);
    const cl = sd(samples[a]!);
    console.log(
      `  ${a.padEnd(4)} acc ${(100 * point[a]!).toFixed(2)}%  naiveSE ${(100 * naive).toFixed(3)}pp  clusteredSE ${(100 * cl).toFixed(3)}pp  designEffect ${(cl / naive).toFixed(2)}x  95%CI [${(100 * q(samples[a]!, 0.025)).toFixed(2)}, ${(100 * q(samples[a]!, 0.975)).toFixed(2)}]`,
    );
  }
  for (const d of ["bpr-vpr", "bpr-epa", "bpr-opr"]) {
    const other = d.split("-")[1]!;
    const pt = point.bpr! - point[other]!;
    console.log(
      `  PAIRED ${d}: ${(100 * pt).toFixed(2)}pp  clusteredSE ${(100 * sd(samples[d]!)).toFixed(3)}pp  95%CI [${(100 * q(samples[d]!, 0.025)).toFixed(2)}, ${(100 * q(samples[d]!, 0.975)).toFixed(2)}]`,
    );
  }
}

async function main(): Promise<void> {
  for (const s of SEASONS) await ingest(s);
  console.log(`algorithm versions: ${[...versions].map(([a, v]) => `${a}=${v}`).join("  ")}\n`);

  if (existsSync(`${DIR}/artifact.json`)) {
    const art = JSON.parse(readFileSync(`${DIR}/artifact.json`, "utf8")) as Record<string, unknown>;
    const ids = JSON.stringify((art as { algorithms?: unknown }).algorithms ?? Object.keys(art));
    console.log(`ARTIFACT algorithms field: ${ids.slice(0, 400)}\n`);
  }

  for (const view of ["combined", "qualification", "elimination"]) {
    console.log(`\n################ ${view.toUpperCase()} ################`);
    console.log(
      "year " + ALGOS.map((a) => a.toUpperCase().padStart(8)).join(" ") + "   | n/accDen/ties/noCall per algo",
    );
    for (const s of SEASONS) {
      const cs = ALGOS.map((a) => tbl.get(key(a, s, view)));
      if (cs.every((c) => c === undefined)) continue;
      const accs = cs.map((c) =>
        c !== undefined && c.accDen > 0 ? ((100 * c.accNum) / c.accDen).toFixed(2).padStart(8) : "     -  ",
      );
      const dens = cs
        .map((c) => (c !== undefined ? `${c.n}/${c.accDen}/${c.ties}/${c.noCall}` : "-"))
        .join(" ");
      console.log(`${s} ${accs.join(" ")}   | ${dens}`);
    }
    console.log("--- Brier ---");
    for (const s of SEASONS) {
      const cs = ALGOS.map((a) => tbl.get(key(a, s, view)));
      if (cs.every((c) => c === undefined)) continue;
      console.log(
        `${s} ` +
          cs
            .map((c) => (c !== undefined && c.n > 0 ? (c.brier / c.n).toFixed(4).padStart(8) : "     -  "))
            .join(" "),
      );
    }
    for (const [label, yrs] of [
      ["DESIGN 2016-2022 ", DESIGN],
      ["HOLDOUT 2023-2026", HOLDOUT],
      ["ALL 2016-2026    ", SEASONS],
    ] as Array<[string, number[]]>) {
      console.log(
        `${label}: ` +
          ALGOS.map((a) => {
            const c = pool(a, yrs, view);
            return c.accDen > 0
              ? `${a}=${((100 * c.accNum) / c.accDen).toFixed(2)}%/${(c.brier / c.n).toFixed(4)}(den ${c.accDen},nc ${c.noCall})`
              : `${a}=-`;
          }).join("  "),
      );
    }
  }

  bootstrap(HOLDOUT, "combined", "HOLDOUT 2023-2026");
  bootstrap(HOLDOUT, "qualification", "HOLDOUT 2023-2026");
  bootstrap(DESIGN, "combined", "DESIGN 2016-2022");

  console.log("\n=== margin-flip noise floor: share of decided matches with |p-0.5| below a threshold ===");
  for (const yrs of [HOLDOUT, DESIGN]) {
    const recs = [...paired.values()].filter((r) => yrs.includes(r.season) && r.actual !== "tie");
    console.log(`  ${yrs[0]}-${yrs[yrs.length - 1]} (n=${recs.length}):`);
    for (const a of ALGOS) {
      const n1 = recs.filter((r) => r.p[a] !== undefined && Math.abs(r.p[a]! - 0.5) < 0.01).length;
      const n2 = recs.filter((r) => r.p[a] !== undefined && Math.abs(r.p[a]! - 0.5) < 0.02).length;
      console.log(
        `    ${a.padEnd(4)} <0.01: ${n1} (${((100 * n1) / recs.length).toFixed(2)}%)   <0.02: ${n2} (${((100 * n2) / recs.length).toFixed(2)}%)`,
      );
    }
  }

  console.log(
    "\n=== convention gap: scoring WITH surrogate-affected matches (packages/bpr) vs WITHOUT (shared harness) ===",
  );
  for (const yrs of [HOLDOUT, DESIGN]) {
    const label = `${yrs[0]}-${yrs[yrs.length - 1]}`;
    for (const a of ALGOS) {
      const all = [...paired.values()].filter(
        (r) => yrs.includes(r.season) && r.actual !== "tie" && r.p[a] !== undefined,
      );
      const clean = all.filter((r) => !r.isSurr);
      const accAll = all.reduce((s, r) => s + hit(r.p[a]!, r.actual), 0) / all.length;
      const accClean = clean.reduce((s, r) => s + hit(r.p[a]!, r.actual), 0) / clean.length;
      console.log(
        `  ${label} ${a.padEnd(4)}: with-surrogates ${(100 * accAll).toFixed(3)}% (n=${all.length})  without ${(100 * accClean).toFixed(3)}% (n=${clean.length})  delta ${(100 * (accAll - accClean)).toFixed(3)}pp`,
      );
    }
  }

  console.log("\n=== half-credit no-call convention (packages/bpr/evaluate.ts) vs miss (D-Q3) ===");
  for (const yrs of [HOLDOUT, DESIGN]) {
    const label = `${yrs[0]}-${yrs[yrs.length - 1]}`;
    for (const a of ALGOS) {
      const decided = [...paired.values()].filter(
        (r) => yrs.includes(r.season) && r.actual !== "tie" && r.p[a] !== undefined,
      );
      const nc = decided.filter((r) => r.p[a] === 0.5).length;
      const miss = decided.reduce((s, r) => s + hit(r.p[a]!, r.actual), 0) / decided.length;
      const half = (decided.reduce((s, r) => s + hit(r.p[a]!, r.actual), 0) + 0.5 * nc) / decided.length;
      console.log(
        `  ${label} ${a.padEnd(4)}: no-calls ${nc}  as-miss ${(100 * miss).toFixed(3)}%  as-half-credit ${(100 * half).toFixed(3)}%  gap ${(100 * (half - miss)).toFixed(3)}pp`,
      );
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
