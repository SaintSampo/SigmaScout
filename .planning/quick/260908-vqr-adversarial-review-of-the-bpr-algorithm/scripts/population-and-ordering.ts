/**
 * Throwaway probe for adversarial review 260908-vqr.
 * Q1: does packages/bpr/data.ts score a DIFFERENT population than the shared harness?
 * Q2: does data.ts's lexicographic `match_key` tiebreak order matches differently
 *     from packages/corpus/db.ts's comp-level play order?
 * Read-only against data/corpus.sqlite.
 */
import Database from "better-sqlite3";

const db = new Database("data/corpus.sqlite", { readonly: true, fileMustExist: true });

// --- exactly packages/bpr/data.ts's query + ordering ---
const bprRows = db
  .prepare(
    `select m.match_key, m.event_key, e.year, m.comp_level, m.sort_time,
            m.red_surrogates, m.blue_surrogates, m.red_dqs, m.blue_dqs,
            m.set_number, m.match_number, m.winner
       from matches m
       join events e using(event_key)
      where e.is_offseason = 0
        and e.event_type <> 100
        and m.winner is not null
        and m.red_score is not null
        and m.blue_score is not null
      order by m.sort_time asc, m.match_key asc`,
  )
  .all() as any[];

// --- exactly packages/corpus/db.ts's selectMatchesChronological ordering ---
const sharedRows = db
  .prepare(
    `SELECT m.match_key, m.event_key, e.year, m.comp_level, m.sort_time,
            m.red_surrogates, m.blue_surrogates, m.set_number, m.match_number, m.winner
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
      WHERE m.winner IS NOT NULL AND e.is_offseason = 0
      ORDER BY m.sort_time ASC, m.event_key ASC,
        CASE m.comp_level WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END ASC,
        m.set_number ASC, m.match_number ASC`,
  )
  .all() as any[];

const isSurr = (r: any) =>
  (JSON.parse(r.red_surrogates) as string[]).length > 0 ||
  (JSON.parse(r.blue_surrogates) as string[]).length > 0;

console.log(`data.ts population:      ${bprRows.length}`);
console.log(`shared population:       ${sharedRows.length}`);

// Population by season, and how many data.ts rows the harness would EXCLUDE as surrogate-affected.
const seasons = [...new Set(bprRows.map((r) => r.year as number))].sort();
console.log("\nPer season: bpr_n = what evaluate.ts scores; surr = of those, surrogate-affected (harness excludes)");
console.log("year   bpr_n   surr  surr%   bpr_n_after_surr_excl   holdout_pub");
let totS = 0;
for (const y of seasons) {
  const rows = bprRows.filter((r) => r.year === y);
  const s = rows.filter(isSurr).length;
  totS += s;
  console.log(
    `${y}  ${String(rows.length).padStart(6)} ${String(s).padStart(6)}  ${((100 * s) / rows.length).toFixed(2).padStart(5)}%          ${String(rows.length - s).padStart(6)}`,
  );
}
console.log(`TOTAL ${String(bprRows.length).padStart(6)} ${String(totS).padStart(6)}`);

// Holdout era only
const ho = bprRows.filter((r) => r.year >= 2023);
console.log(`\nHoldout era 2023-2026: n=${ho.length}, surrogate-affected=${ho.filter(isSurr).length}`);
const hoQ = ho.filter((r) => r.comp_level === "qm");
console.log(`  quals only: n=${hoQ.length}, surrogate-affected=${hoQ.filter(isSurr).length}`);
console.log(`  ties in holdout era: ${ho.filter((r) => r.winner === "tie").length}`);
console.log(`  ties, quals only:    ${hoQ.filter((r) => r.winner === "tie").length}`);

// --- Q2: ordering inversions ---
const sharedPos = new Map<string, number>();
sharedRows.forEach((r, i) => sharedPos.set(r.match_key, i));
// Restrict to the intersection so a population difference is not counted as an inversion.
const common = bprRows.filter((r) => sharedPos.has(r.match_key));
console.log(`\nOrdering compared over ${common.length} matches present in both.`);

// Count adjacent inversions: consecutive pairs in bpr order whose shared-order is reversed.
let adjInv = 0;
let adjInvSameEvent = 0;
const examples: string[] = [];
for (let i = 0; i + 1 < common.length; i++) {
  const a = common[i], b = common[i + 1];
  if (sharedPos.get(a.match_key)! > sharedPos.get(b.match_key)!) {
    adjInv++;
    if (a.event_key === b.event_key) {
      adjInvSameEvent++;
      if (examples.length < 12) examples.push(`${a.event_key}: ${a.match_key} before ${b.match_key} (sort_time ${a.sort_time} / ${b.sort_time})`);
    }
  }
}
console.log(`adjacent inversions: ${adjInv}  (same event: ${adjInvSameEvent})`);
for (const e of examples) console.log("   " + e);

// Within one event, how many matches does data.ts place out of true play order?
let sameTimeGroups = 0, sameTimeMatches = 0;
const byKey = new Map<string, any[]>();
for (const r of bprRows) {
  const k = `${r.event_key}|${r.sort_time}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k)!.push(r);
}
for (const [, g] of byKey) if (g.length > 1) { sameTimeGroups++; sameTimeMatches += g.length; }
console.log(`\nsort_time collisions WITHIN one event: ${sameTimeGroups} groups covering ${sameTimeMatches} matches`);

// The tiebreak only matters when sort_time collides. Count collisions where
// lexicographic match_key disagrees with numeric match order.
let misordered = 0;
const misExamples: string[] = [];
for (const [k, g] of byKey) {
  if (g.length < 2) continue;
  const lex = [...g].sort((a, b) => (a.match_key < b.match_key ? -1 : a.match_key > b.match_key ? 1 : 0));
  const play = [...g].sort((a, b) => {
    const ord = (c: string) => (c === "qm" ? 0 : c === "ef" ? 1 : c === "qf" ? 2 : c === "sf" ? 3 : c === "f" ? 4 : 5);
    return ord(a.comp_level) - ord(b.comp_level) || a.set_number - b.set_number || a.match_number - b.match_number;
  });
  for (let i = 0; i < g.length; i++) {
    if (lex[i].match_key !== play[i].match_key) {
      misordered++;
      if (misExamples.length < 10) misExamples.push(`${k} -> lex ${lex.map((x: any) => x.match_key.split("_")[1]).join(",")} vs play ${play.map((x: any) => x.match_key.split("_")[1]).join(",")}`);
      break;
    }
  }
}
console.log(`collision groups where lexicographic tiebreak != play order: ${misordered}`);
for (const e of misExamples) console.log("   " + e);

db.close();
