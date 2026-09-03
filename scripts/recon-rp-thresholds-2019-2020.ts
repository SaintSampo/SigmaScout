/**
 * Read-only probe that DERIVES each 2019/2020 bonus-RP threshold from the data
 * rather than from a game manual, for the corpus backfill
 * (`.planning/todos/pending/extend-corpus-2019-2020.md`).
 *
 * ## Why derive rather than cite
 *
 * Every `RpRuleModule` returns BOTH a recomputed `bonusFlags` and TBA's own
 * `recordedBonusFlags`, so `reconciliation.test.ts` is a comparison rather than a
 * restatement (D-12). That makes the recomputation rule load-bearing: it is what
 * `predictThresholds` uses for FUTURE matches, where no recorded flag exists.
 *
 * A wrong threshold taken from memory would still reconcile "well enough" to look
 * plausible while quietly mispredicting. So for each (threshold variable, recorded
 * flag) pair this sweeps every candidate cut point and reports the one that
 * reproduces TBA's flag most often, WITH its exact agreement rate — the same shape
 * the existing season modules encode as `RpTieredThreshold` data.
 *
 * Swept per event tier (base / districtChampionship / championship) because FRC
 * thresholds sometimes scale by tier (Pitfall 1) — reporting per tier is what
 * shows whether 2019/2020 actually did.
 *
 * Reads TBA_API_KEY from the environment, sends it only as X-TBA-Auth-Key, never
 * logs it and never writes it to the output.
 *
 * Run: pnpm recon:rp-thresholds
 */
import { writeFile } from "node:fs/promises";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const OUTPUT_PATH = "docs/data/tba-rp-thresholds-2019-2020.md";

/** Mirrors `rp/constants.ts`'s EVENT_TYPE_TIERS. Offseason (99) deliberately absent. */
const EVENT_TYPE_TIERS: Readonly<Record<number, string>> = {
  0: "base",
  1: "base",
  100: "base",
  2: "districtChampionship",
  5: "districtChampionship",
  3: "championship",
  4: "championship",
};

/** (recorded flag) <- (candidate numeric field) pairs to sweep, per season. */
const CANDIDATES: Readonly<Record<number, readonly { flag: string; variable: string }[]>> = {
  2019: [
    { flag: "habDockingRankingPoint", variable: "habClimbPoints" },
    { flag: "completeRocketRankingPoint", variable: "hatchPanelPoints" },
    { flag: "completeRocketRankingPoint", variable: "cargoPoints" },
  ],
  2020: [
    { flag: "shieldOperationalRankingPoint", variable: "endgamePoints" },
    { flag: "shieldOperationalRankingPoint", variable: "teleopCellPoints" },
    { flag: "shieldEnergizedRankingPoint", variable: "endgamePoints" },
  ],
};

/** Boolean fields worth testing as an exact predictor of a flag (rather than a threshold). */
const BOOLEAN_CANDIDATES: Readonly<Record<number, readonly { flag: string; predictor: string }[]>> = {
  2019: [
    { flag: "completeRocketRankingPoint", predictor: "completedRocketNear" },
    { flag: "completeRocketRankingPoint", predictor: "completedRocketFar" },
  ],
  2020: [
    { flag: "shieldOperationalRankingPoint", predictor: "stage2Activated" },
    { flag: "shieldEnergizedRankingPoint", predictor: "stage3Activated" },
  ],
};

interface TbaEventSimple { key: string; event_type: number; start_date: string }
interface TbaMatch { key: string; comp_level: string; score_breakdown: Record<string, Record<string, unknown>> | null }

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

/** One alliance-side observation: the tier, every numeric field, every boolean field. */
interface Obs {
  tier: string;
  nums: Record<string, number>;
  bools: Record<string, boolean>;
}

async function collect(season: number, apiKey: string): Promise<Obs[]> {
  const events = await tbaGet<TbaEventSimple[]>(`/events/${season}/simple`, apiKey);
  if (!events) return [];
  const inSeason = events
    .filter((e) => EVENT_TYPE_TIERS[e.event_type] !== undefined)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const obs: Obs[] = [];
  for (const event of inSeason) {
    const tier = EVENT_TYPE_TIERS[event.event_type]!;
    const matches = await tbaGet<TbaMatch[]>(`/event/${event.key}/matches`, apiKey);
    if (!matches) continue;
    for (const m of matches) {
      if (m.comp_level !== "qm" || !m.score_breakdown) continue;
      for (const side of ["red", "blue"] as const) {
        const bd = m.score_breakdown[side];
        if (!bd) continue;
        const nums: Record<string, number> = {};
        const bools: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(bd)) {
          if (typeof v === "number") nums[k] = v;
          else if (typeof v === "boolean") bools[k] = v;
        }
        obs.push({ tier, nums, bools });
      }
    }
  }
  return obs;
}

interface Sweep {
  flag: string;
  variable: string;
  tier: string;
  n: number;
  bestThreshold: number | null;
  bestAgreement: number;
  flagTrueRate: number;
  /** Agreement you would get by always predicting false — the bar a real rule must beat. */
  trivialAgreement: number;
}

function sweep(obs: Obs[], flag: string, variable: string, tier: string): Sweep | null {
  const rows = obs.filter((o) => o.tier === tier && flag in o.bools && variable in o.nums);
  if (rows.length === 0) return null;

  const trueCount = rows.filter((r) => r.bools[flag] === true).length;
  const values = [...new Set(rows.map((r) => r.nums[variable]!))].sort((a, b) => a - b);

  let bestThreshold: number | null = null;
  let bestAgreement = -1;
  for (const t of values) {
    let agree = 0;
    for (const r of rows) if ((r.nums[variable]! >= t) === (r.bools[flag] === true)) agree += 1;
    const rate = agree / rows.length;
    if (rate > bestAgreement) {
      bestAgreement = rate;
      bestThreshold = t;
    }
  }

  return {
    flag,
    variable,
    tier,
    n: rows.length,
    bestThreshold,
    bestAgreement,
    flagTrueRate: trueCount / rows.length,
    trivialAgreement: 1 - trueCount / rows.length,
  };
}

interface BoolCheck { flag: string; predictor: string; n: number; agreement: number; flagTrueRate: number; predictorTrueRate: number }

function boolCheck(obs: Obs[], flag: string, predictor: string): BoolCheck | null {
  const rows = obs.filter((o) => flag in o.bools && predictor in o.bools);
  if (rows.length === 0) return null;
  let agree = 0;
  for (const r of rows) if (r.bools[flag] === r.bools[predictor]) agree += 1;
  return {
    flag,
    predictor,
    n: rows.length,
    agreement: agree / rows.length,
    flagTrueRate: rows.filter((r) => r.bools[flag]).length / rows.length,
    predictorTrueRate: rows.filter((r) => r.bools[predictor]).length / rows.length,
  };
}

function pct(x: number): string {
  return `${(100 * x).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const apiKey = tbaApiKey();
  const sections: string[] = [];

  for (const season of [2019, 2020]) {
    console.log(`collecting ${season} (walks every in-season event)...`);
    const obs = await collect(season, apiKey);
    console.log(`  ${season}: ${obs.length} alliance-sides`);

    const L: string[] = [`## ${season}`, ``, `${obs.length.toLocaleString()} alliance-sides across every in-season qualification match.`, ``];

    L.push(`### Threshold sweeps`, ``);
    L.push(`\`bestThreshold\` is the cut point maximising agreement with TBA's own recorded flag.`);
    L.push(`\`trivial\` is the agreement from always predicting false — a rule must beat it to be worth anything.`, ``);
    L.push(`| Recorded flag | Candidate variable | Tier | n | Best \`>=\` | Agreement | Trivial | Flag rate |`);
    L.push(`|---|---|---|---|---|---|---|---|`);
    for (const c of CANDIDATES[season] ?? []) {
      for (const tier of ["base", "districtChampionship", "championship"]) {
        const s = sweep(obs, c.flag, c.variable, tier);
        if (!s) continue;
        const beats = s.bestAgreement > s.trivialAgreement ? "" : " ⚠";
        L.push(
          `| \`${s.flag}\` | \`${s.variable}\` | ${s.tier} | ${s.n.toLocaleString()} | ${s.bestThreshold} | **${pct(s.bestAgreement)}**${beats} | ${pct(s.trivialAgreement)} | ${pct(s.flagTrueRate)} |`
        );
      }
    }
    L.push(``);

    L.push(`### Boolean predictor checks`, ``);
    L.push(`| Recorded flag | Candidate predictor | n | Agreement | Flag rate | Predictor rate |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const b of BOOLEAN_CANDIDATES[season] ?? []) {
      const r = boolCheck(obs, b.flag, b.predictor);
      if (!r) continue;
      L.push(`| \`${r.flag}\` | \`${r.predictor}\` | ${r.n.toLocaleString()} | **${pct(r.agreement)}** | ${pct(r.flagTrueRate)} | ${pct(r.predictorTrueRate)} |`);
    }
    L.push(``);
    sections.push(L.join("\n"));
  }

  const doc = [
    `# Derived bonus-RP thresholds — 2019 and 2020`,
    ``,
    `Generated by \`scripts/recon-rp-thresholds-2019-2020.ts\`. Read-only; no corpus writes.`,
    ``,
    `Each \`RpRuleModule\` must RECOMPUTE its bonus flags from threshold variables, because`,
    `\`predictThresholds\` sees only threshold-variable values and never a raw breakdown — a module`,
    `that merely echoed TBA's recorded flag could score history but could not predict a match.`,
    `That makes the recomputation rule load-bearing, so these thresholds are DERIVED from every`,
    `observed alliance-side rather than cited from a game manual.`,
    ``,
    ...sections,
  ].join("\n");

  if (doc.includes(apiKey)) throw new Error("REFUSING TO WRITE: document contains the API key.");
  await writeFile(OUTPUT_PATH, doc, "utf8");
  console.log(`\nwrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
