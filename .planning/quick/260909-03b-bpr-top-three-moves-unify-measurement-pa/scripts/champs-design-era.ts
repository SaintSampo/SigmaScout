/**
 * GATE B: does BPR's championship deficit reproduce on 2016-2022?
 *
 * The hypothesis behind P1 was found on the HOLDOUT (2023-2026 champs events,
 * n=5,820, BPR 74.67 vs EPA 76.51, -1.84pp). Holdout-suggested is not fatal,
 * but it obliges a check on the design era before anything is fitted to it —
 * otherwise a knob gets tuned to a number that cannot honestly be re-tested.
 *
 * READS ONLY THE SIX DESIGN-ERA FILES. The holdout jsonl sit in the same
 * directory and are deliberately never opened: the season list below is
 * explicit, not a glob.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { openCorpusReadOnly } from "../../../../packages/corpus/db.js";
import { accuracyCall, outcomeTarget } from "../../../../packages/core/scoring/brier.js";
import { eventBlockedBootstrap } from "../../../../packages/harness/eventBootstrap.js";

const DIR = "reports/260908-vqr-fourway";
/** Explicit, never a glob — 2023-2026 files exist alongside these and are not read. */
const DESIGN_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022];
const ALGOS = ["bpr", "epa", "vpr"] as const;
type Algo = (typeof ALGOS)[number];
const RESAMPLES = 2000;

interface Rec {
  eventKey: string;
  eventType: number;
  actualWinner: "red" | "blue" | "tie";
  p: Partial<Record<Algo, number>>;
}

interface Unit {
  readonly eventKey: string;
  readonly inDen: number;
  /** bprHit - epaHit */
  readonly dHit: number;
}

async function load(): Promise<Map<string, Rec>> {
  const byMatch = new Map<string, Rec>();
  for (const season of DESIGN_SEASONS) {
    const file = `${DIR}/predictions-${season}.jsonl`;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim() === "") continue;
      const r = JSON.parse(line) as {
        matchKey: string;
        eventKey: string;
        algorithmId: string;
        pRedWin: number;
        actualWinner: "red" | "blue" | "tie";
      };
      if (!(ALGOS as readonly string[]).includes(r.algorithmId)) continue;
      let rec = byMatch.get(r.matchKey);
      if (rec === undefined) {
        rec = { eventKey: r.eventKey, eventType: -1, actualWinner: r.actualWinner, p: {} };
        byMatch.set(r.matchKey, rec);
      }
      rec.p[r.algorithmId as Algo] = r.pRedWin;
    }
    process.stderr.write(`  read ${season} (${byMatch.size} matches so far)\n`);
  }
  return byMatch;
}

function attachEventTypes(byMatch: Map<string, Rec>): void {
  const db = openCorpusReadOnly("data/corpus.sqlite");
  try {
    const rows = db
      .prepare<[], { event_key: string; event_type: number }>(
        `select event_key, event_type from events`,
      )
      .all();
    const types = new Map(rows.map((r) => [r.event_key, r.event_type]));
    for (const rec of byMatch.values()) rec.eventType = types.get(rec.eventKey) ?? -1;
  } finally {
    db.close();
  }
}

const hit = (p: number | undefined, w: Rec["actualWinner"]): number | null => {
  if (p === undefined) return null;
  const c = accuracyCall({ pRedWin: p, actualWinner: w });
  return c === null ? null : c ? 1 : 0;
};

function report(label: string, recs: Array<[string, Rec]>): void {
  if (recs.length === 0) {
    console.log(`  ${label.padEnd(34)} (empty)`);
    return;
  }
  const acc: Record<string, { c: number; d: number }> = {};
  const bri: Record<string, { s: number; n: number }> = {};
  for (const a of ALGOS) {
    acc[a] = { c: 0, d: 0 };
    bri[a] = { s: 0, n: 0 };
  }
  const units: Unit[] = [];
  for (const [, r] of recs) {
    for (const a of ALGOS) {
      const h = hit(r.p[a], r.actualWinner);
      if (h !== null) {
        acc[a]!.d += 1;
        acc[a]!.c += h;
      }
      const p = r.p[a];
      if (p !== undefined) {
        bri[a]!.s += (p - outcomeTarget(r.actualWinner)) ** 2;
        bri[a]!.n += 1;
      }
    }
    const b = hit(r.p.bpr, r.actualWinner);
    const e = hit(r.p.epa, r.actualWinner);
    units.push({
      eventKey: r.eventKey,
      inDen: b === null || e === null ? 0 : 1,
      dHit: b === null || e === null ? 0 : b - e,
    });
  }

  const pct = (a: Algo): string =>
    acc[a]!.d > 0 ? ((100 * acc[a]!.c) / acc[a]!.d).toFixed(2) : "n/a";
  const brier = (a: Algo): string =>
    bri[a]!.n > 0 ? (bri[a]!.s / bri[a]!.n).toFixed(4) : "n/a";

  const stat = (s: readonly Unit[]): number => {
    let d = 0;
    let sum = 0;
    for (const u of s) {
      d += u.inDen;
      sum += u.dHit;
    }
    return d > 0 ? sum / d : 0;
  };

  let intervalText = "(too few events)";
  let verdict = "";
  try {
    const b = eventBlockedBootstrap(units, stat, { resamples: RESAMPLES });
    const excl = b.percentile.lower > 0 || b.percentile.upper < 0;
    intervalText =
      `${((100 * b.pointEstimate >= 0 ? "+" : "") + (100 * b.pointEstimate).toFixed(3)).padStart(7)}pp ` +
      `[${(100 * b.percentile.lower).toFixed(3)}, ${(100 * b.percentile.upper).toFixed(3)}] ` +
      `SE ${(100 * b.standardError).toFixed(4)} events ${b.eventCount}`;
    verdict = excl ? (b.pointEstimate < 0 ? "  <- NEGATIVE, excludes 0" : "  <- positive, excludes 0") : "  <- includes 0";
  } catch {
    /* fewer than 2 event blocks */
  }

  console.log(
    `  ${label.padEnd(34)} n=${String(recs.length).padStart(6)}  ` +
      `BPR ${pct("bpr")} EPA ${pct("epa")} VPR ${pct("vpr")}  |  ` +
      `brier B ${brier("bpr")} E ${brier("epa")} V ${brier("vpr")}`,
  );
  console.log(`      BPR-EPA paired event-blocked: ${intervalText}${verdict}`);
}

async function main(): Promise<void> {
  process.stderr.write("reading design-era four-way predictions (2016-2022 ONLY)\n");
  const byMatch = await load();
  attachEventTypes(byMatch);

  const all = [...byMatch.entries()];

  // Event size, for the review's own size proxy.
  const eventSize = new Map<string, number>();
  for (const [, r] of all) eventSize.set(r.eventKey, (eventSize.get(r.eventKey) ?? 0) + 1);

  console.log("GATE B - does the champs deficit reproduce on the DESIGN ERA (2016-2022)?");
  console.log(`  matches: ${all.length}   events: ${eventSize.size}`);
  console.log("  (holdout reference, NOT re-measured here: champs n=5,820, BPR 74.67 vs EPA 76.51 = -1.84pp)");
  console.log("");

  const champs34 = all.filter(([, r]) => r.eventType === 3 || r.eventType === 4);
  const champs234 = all.filter(([, r]) => r.eventType >= 2 && r.eventType <= 4);
  const sizeProxy = all.filter(([, r]) => {
    const s = eventSize.get(r.eventKey) ?? 0;
    return s >= 121 && s <= 200;
  });
  const rest = all.filter(([, r]) => !(r.eventType >= 2 && r.eventType <= 4));

  report("champs {3,4}", champs34);
  report("champs {2,3,4}", champs234);
  report("size proxy 121-200 matches/event", sizeProxy);
  report("everything else (contrast)", rest);

  console.log("");
  console.log("  event-type composition of the design era:");
  const byType = new Map<number, number>();
  for (const [, r] of all) byType.set(r.eventType, (byType.get(r.eventType) ?? 0) + 1);
  for (const t of [...byType.keys()].sort((a, b) => a - b)) {
    console.log(`    type ${String(t).padStart(3)}: ${byType.get(t)} matches`);
  }
}

void main();
