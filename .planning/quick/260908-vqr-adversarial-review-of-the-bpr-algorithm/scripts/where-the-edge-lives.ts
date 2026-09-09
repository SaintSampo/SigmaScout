/**
 * Adversarial review 260908-vqr, angle G (constructive): WHERE does BPR's
 * holdout-era edge over VPR/EPA actually come from, and where does it lose?
 * Slices the four-way replay by season, competition phase, and how far into an
 * event the match sits. Read-only.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const DIR = "reports/260908-vqr-fourway";
const ALGOS = ["opr", "epa", "vpr", "bpr"] as const;
type Algo = (typeof ALGOS)[number];
const HOLDOUT = [2023, 2024, 2025, 2026];

interface P {
  season: number;
  ev: string;
  comp: string;
  mn: number;
  actual: string;
  p: Partial<Record<Algo, number>>;
}
const rec = new Map<string, P>();

async function ingest(season: number): Promise<void> {
  const f = `${DIR}/predictions-${season}.jsonl`;
  if (!existsSync(f)) return;
  const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as {
      matchKey: string; season: number; eventKey: string; compLevel: string;
      algorithmId: Algo; pRedWin: number; actualWinner: string | null;
    };
    if (r.actualWinner === null || r.actualWinner === "tie") continue;
    let e = rec.get(r.matchKey);
    if (e === undefined) {
      const m = /_(?:qm|ef|qf|sf|f)(\d+)/.exec(r.matchKey);
      e = { season: r.season, ev: r.eventKey, comp: r.compLevel, mn: m ? Number(m[1]) : 0, actual: r.actualWinner, p: {} };
      rec.set(r.matchKey, e);
    }
    e.p[r.algorithmId] = r.pRedWin;
  }
}

const hit = (p: number, a: string): number => ((p > 0.5 ? "red" : p < 0.5 ? "blue" : null) === a ? 1 : 0);

function report(label: string, rows: P[]): void {
  if (rows.length === 0) return;
  const acc: Record<string, number> = {};
  for (const a of ALGOS) {
    const r = rows.filter((x) => x.p[a] !== undefined);
    acc[a] = r.reduce((s, x) => s + hit(x.p[a]!, x.actual), 0) / r.length;
  }
  const brier: Record<string, number> = {};
  for (const a of ALGOS) {
    const r = rows.filter((x) => x.p[a] !== undefined);
    brier[a] = r.reduce((s, x) => s + (x.p[a]! - (x.actual === "red" ? 1 : 0)) ** 2, 0) / r.length;
  }
  console.log(
    `${label.padEnd(30)} n=${String(rows.length).padStart(6)}  ` +
      ALGOS.map((a) => `${a} ${(100 * acc[a]!).toFixed(2)}`).join("  ") +
      `   | BPR-VPR ${(100 * (acc.bpr! - acc.vpr!)).toFixed(2).padStart(6)}pp  BPR-EPA ${(100 * (acc.bpr! - acc.epa!)).toFixed(2).padStart(6)}pp` +
      `   | brier bpr ${brier.bpr!.toFixed(4)} vpr ${brier.vpr!.toFixed(4)} epa ${brier.epa!.toFixed(4)}`,
  );
}

async function main(): Promise<void> {
  for (const s of [2016, 2017, 2018, 2019, 2020, 2022, ...HOLDOUT]) await ingest(s);
  const all = [...rec.values()].filter((r) => ALGOS.every((a) => r.p[a] !== undefined));

  console.log("=== per season (decided matches, all comp levels) ===");
  for (const s of [2016, 2017, 2018, 2019, 2020, 2022, ...HOLDOUT])
    report(String(s), all.filter((r) => r.season === s));

  console.log("\n=== holdout era, by qualification-match number (how far into the event) ===");
  const ho = all.filter((r) => HOLDOUT.includes(r.season) && r.comp === "qm");
  for (const [lo, hi] of [[1, 12], [13, 24], [25, 36], [37, 48], [49, 60], [61, 999]] as Array<[number, number]>)
    report(`qm ${lo}-${hi === 999 ? "end" : hi}`, ho.filter((r) => r.mn >= lo && r.mn <= hi));

  console.log("\n=== holdout era, by competition level ===");
  report("qualification", all.filter((r) => HOLDOUT.includes(r.season) && r.comp === "qm"));
  report("elimination", all.filter((r) => HOLDOUT.includes(r.season) && r.comp !== "qm"));

  console.log("\n=== holdout era, events by size (a proxy for district vs regional vs champs) ===");
  const size = new Map<string, number>();
  for (const r of all) size.set(r.ev, (size.get(r.ev) ?? 0) + 1);
  for (const [lo, hi] of [[0, 80], [81, 120], [121, 200], [201, 99999]] as Array<[number, number]>)
    report(`event size ${lo}-${hi === 99999 ? "max" : hi}`, all.filter((r) => HOLDOUT.includes(r.season) && (size.get(r.ev) ?? 0) >= lo && (size.get(r.ev) ?? 0) <= hi));

  console.log("\n=== 2024 alone, by competition level (the season that carries the pooled lead) ===");
  report("2024 qualification", all.filter((r) => r.season === 2024 && r.comp === "qm"));
  report("2024 elimination", all.filter((r) => r.season === 2024 && r.comp !== "qm"));

  console.log("\n=== holdout era EXCLUDING 2024 ===");
  report("2023+2025+2026", all.filter((r) => [2023, 2025, 2026].includes(r.season)));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
