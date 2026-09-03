/**
 * Focused follow-up probe: can 2019's `completeRocketRankingPoint` be recomputed
 * from ANY available field combination?
 *
 * `recon-rp-thresholds-2019-2020.ts` swept single candidates and found that none
 * meaningfully beats the trivial always-false baseline at base tier
 * (`hatchPanelPoints >= 28` ties it exactly at 96.08%; `cargoPoints >= 39` beats it
 * by 0.24pp; each rocket boolean alone lands slightly BELOW it). But it never tested
 * the obvious rule — `completedRocketNear OR completedRocketFar` — nor a joint
 * points condition.
 *
 * This matters because the answer picks the module's strategy:
 *
 *   - If a combination reconciles well, `rp/rules/2019.ts` recomputes from it
 *     normally, like every other season.
 *   - If nothing does, the rocket bonus is a bonus whose real condition depends on
 *     signals that are not tracked threshold variables — the case
 *     `RpRuleModule.predictThresholds` already documents — and it takes the
 *     CONSERVATIVE BRANCH, following 2025's `autoBonus` precedent (always false in
 *     prediction, with the understatement measured and published rather than hidden).
 *
 * Read-only. Key never logged or written.
 *
 * Run: pnpm recon:rocket-rp
 */
import { writeFile } from "node:fs/promises";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const OUTPUT_PATH = "docs/data/tba-rocket-rp-2019.md";

const EVENT_TYPE_TIERS: Readonly<Record<number, string>> = {
  0: "base", 1: "base", 100: "base",
  2: "districtChampionship", 5: "districtChampionship",
  3: "championship", 4: "championship",
};

interface TbaEventSimple { key: string; event_type: number; start_date: string }
interface TbaMatch { comp_level: string; score_breakdown: Record<string, Record<string, unknown>> | null }

interface Row {
  tier: string;
  flag: boolean;
  near: boolean;
  far: boolean;
  hatch: number;
  cargo: number;
}

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) throw new Error("TBA_API_KEY is not set in the environment.");
  return key;
}

async function tbaGet<T>(path: string, apiKey: string): Promise<T | null> {
  const res = await fetch(`${TBA_BASE}${path}`, { headers: { "X-TBA-Auth-Key": apiKey } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function collect(apiKey: string): Promise<Row[]> {
  const events = await tbaGet<TbaEventSimple[]>(`/events/2019/simple`, apiKey);
  if (!events) return [];
  const rows: Row[] = [];
  for (const e of events.filter((x) => EVENT_TYPE_TIERS[x.event_type] !== undefined).sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    const matches = await tbaGet<TbaMatch[]>(`/event/${e.key}/matches`, apiKey);
    if (!matches) continue;
    for (const m of matches) {
      if (m.comp_level !== "qm" || !m.score_breakdown) continue;
      for (const side of ["red", "blue"] as const) {
        const bd = m.score_breakdown[side];
        if (!bd) continue;
        if (typeof bd["completeRocketRankingPoint"] !== "boolean") continue;
        rows.push({
          tier: EVENT_TYPE_TIERS[e.event_type]!,
          flag: bd["completeRocketRankingPoint"] === true,
          near: bd["completedRocketNear"] === true,
          far: bd["completedRocketFar"] === true,
          hatch: typeof bd["hatchPanelPoints"] === "number" ? (bd["hatchPanelPoints"] as number) : 0,
          cargo: typeof bd["cargoPoints"] === "number" ? (bd["cargoPoints"] as number) : 0,
        });
      }
    }
  }
  return rows;
}

interface Score { name: string; agreement: number; falseNeg: number; falsePos: number }

function score(rows: Row[], name: string, predict: (r: Row) => boolean): Score {
  let agree = 0, fn = 0, fp = 0;
  for (const r of rows) {
    const p = predict(r);
    if (p === r.flag) agree += 1;
    else if (r.flag) fn += 1;
    else fp += 1;
  }
  return { name, agreement: agree / rows.length, falseNeg: fn / rows.length, falsePos: fp / rows.length };
}

function pct(x: number): string { return `${(100 * x).toFixed(2)}%`; }

async function main(): Promise<void> {
  const apiKey = tbaApiKey();
  console.log("collecting 2019 (walks every in-season event)...");
  const all = await collect(apiKey);
  console.log(`  ${all.length} alliance-sides`);

  const sections: string[] = [];
  for (const tier of ["base", "districtChampionship", "championship", "ALL"]) {
    const rows = tier === "ALL" ? all : all.filter((r) => r.tier === tier);
    if (rows.length === 0) continue;
    const base = rows.filter((r) => r.flag).length / rows.length;

    // Best joint points threshold, searched coarsely over both axes.
    let bestJoint: Score = { name: "", agreement: -1, falseNeg: 0, falsePos: 0 };
    for (let h = 0; h <= 40; h += 2) {
      for (let c = 0; c <= 60; c += 3) {
        const s = score(rows, `hatch >= ${h} AND cargo >= ${c}`, (r) => r.hatch >= h && r.cargo >= c);
        if (s.agreement > bestJoint.agreement) bestJoint = s;
      }
    }

    const candidates: Score[] = [
      score(rows, "always false (trivial baseline)", () => false),
      score(rows, "near", (r) => r.near),
      score(rows, "far", (r) => r.far),
      score(rows, "**near OR far**", (r) => r.near || r.far),
      score(rows, "near AND far", (r) => r.near && r.far),
      bestJoint,
    ];

    const L = [`## ${tier} (n = ${rows.length.toLocaleString()}, flag rate ${pct(base)})`, ``];
    L.push(`| Rule | Agreement | False negatives | False positives |`);
    L.push(`|---|---|---|---|`);
    for (const c of candidates.sort((a, b) => b.agreement - a.agreement)) {
      L.push(`| ${c.name} | **${pct(c.agreement)}** | ${pct(c.falseNeg)} | ${pct(c.falsePos)} |`);
    }
    L.push(``);
    sections.push(L.join("\n"));
  }

  const doc = [
    `# 2019 Complete Rocket RP — can it be recomputed?`,
    ``,
    `Generated by \`scripts/recon-rocket-rp-2019.ts\`. Read-only.`,
    ``,
    `The single-candidate sweep found nothing that meaningfully beats always-false at base tier.`,
    `This tests the combinations it did not: the natural \`near OR far\` rule, its AND variant, and`,
    `the best joint points condition over \`hatchPanelPoints\` x \`cargoPoints\`.`,
    ``,
    `**False negatives matter more than raw agreement here.** A rule that under-fires is the`,
    `CONSERVATIVE direction this codebase already prefers (understate a bonus, never overstate) —`,
    `see \`RpRuleModule.predictThresholds\`'s doc comment and 2025's \`autoBonus\` precedent.`,
    ``,
    ...sections,
  ].join("\n");

  if (doc.includes(apiKey)) throw new Error("REFUSING TO WRITE: document contains the API key.");
  await writeFile(OUTPUT_PATH, doc, "utf8");
  console.log(`\nwrote ${OUTPUT_PATH}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
