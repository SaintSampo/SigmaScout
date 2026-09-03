/**
 * Read-only probe measuring BONUS-RP BASE RATES across the full 2019 and 2020
 * seasons, for the corpus backfill
 * (`.planning/todos/pending/extend-corpus-2019-2020.md`).
 *
 * `recon-tba-fields-2019-2020.ts` sampled a single event to learn the
 * `score_breakdown` SHAPE. This answers a different question that shape alone
 * cannot: how OFTEN does each bonus RP actually fire?
 *
 * It matters because a threshold variable that fires almost never is worse than
 * not modelling the RP at all — the model spends a parameter learning a constant.
 * Two specific worries motivated this:
 *
 *   - 2020's `shieldEnergizedRankingPoint` never fired once in the 24 alliance-sides
 *     first sampled, and `stage3Activated` was false throughout. If that holds
 *     season-wide, `rp/rules/2020.ts` should not model it as a live threshold.
 *   - 2019's `completeRocketRankingPoint` is a combinatorial completion condition
 *     rather than a count threshold, so its rate determines how much design effort
 *     the awkward case actually deserves.
 *
 * Also reports total qualification-match counts, which size the "2020 was barely a
 * season" claim with a number instead of an adjective.
 *
 * Reads TBA_API_KEY from the environment and sends it only as the X-TBA-Auth-Key
 * header. Never logged, never written to the output document.
 *
 * Run: pnpm recon:rp-rates
 */
import { writeFile } from "node:fs/promises";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const OUTPUT_PATH = "docs/data/tba-rp-rates-2019-2020.md";

/** Boolean bonus-RP fields to tally, per season. Win/tie RP is not a score_breakdown flag and is excluded. */
const RP_FLAGS: Readonly<Record<number, readonly string[]>> = {
  2019: ["completeRocketRankingPoint", "habDockingRankingPoint"],
  2020: ["shieldEnergizedRankingPoint", "shieldOperationalRankingPoint"],
};

/** Supporting booleans worth tallying alongside, to explain WHY an RP is rare. */
const SUPPORT_FLAGS: Readonly<Record<number, readonly string[]>> = {
  2019: ["completedRocketNear", "completedRocketFar"],
  2020: ["stage1Activated", "stage2Activated", "stage3Activated"],
};

interface TbaEventSimple {
  key: string;
  name: string;
  event_type: number;
  start_date: string;
}

interface TbaMatch {
  key: string;
  comp_level: string;
  score_breakdown: Record<string, Record<string, unknown>> | null;
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

const IN_SEASON_EVENT_TYPES = new Set([0, 1, 2, 3, 4, 5, 6]);

interface SeasonRates {
  season: number;
  eventsListed: number;
  eventsWithQuals: number;
  qualMatches: number;
  allianceSides: number;
  /** flag -> times true */
  flagTrue: Map<string, number>;
  /** flag -> times the key was present at all */
  flagPresent: Map<string, number>;
  /** Observed distribution of the computed `rp` total. */
  rpTotals: Map<number, number>;
}

async function measureSeason(season: number, apiKey: string): Promise<SeasonRates> {
  const out: SeasonRates = {
    season,
    eventsListed: 0,
    eventsWithQuals: 0,
    qualMatches: 0,
    allianceSides: 0,
    flagTrue: new Map(),
    flagPresent: new Map(),
    rpTotals: new Map(),
  };

  const events = await tbaGet<TbaEventSimple[]>(`/events/${season}/simple`, apiKey);
  if (!events) return out;

  const inSeason = events
    .filter((e) => IN_SEASON_EVENT_TYPES.has(e.event_type))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  out.eventsListed = inSeason.length;

  const tracked = [...(RP_FLAGS[season] ?? []), ...(SUPPORT_FLAGS[season] ?? [])];

  for (const event of inSeason) {
    const matches = await tbaGet<TbaMatch[]>(`/event/${event.key}/matches`, apiKey);
    if (!matches) continue;
    const quals = matches.filter((m) => m.comp_level === "qm" && m.score_breakdown != null);
    if (quals.length === 0) continue;
    out.eventsWithQuals += 1;
    out.qualMatches += quals.length;

    for (const match of quals) {
      for (const side of ["red", "blue"] as const) {
        const bd = match.score_breakdown?.[side];
        if (!bd) continue;
        out.allianceSides += 1;

        const rpVal = bd["rp"];
        if (typeof rpVal === "number") {
          out.rpTotals.set(rpVal, (out.rpTotals.get(rpVal) ?? 0) + 1);
        }

        for (const flag of tracked) {
          if (!(flag in bd)) continue;
          out.flagPresent.set(flag, (out.flagPresent.get(flag) ?? 0) + 1);
          if (bd[flag] === true) out.flagTrue.set(flag, (out.flagTrue.get(flag) ?? 0) + 1);
        }
      }
    }
  }
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function render(r: SeasonRates): string {
  const L: string[] = [];
  L.push(`## ${r.season}`);
  L.push("");
  L.push(`- **In-season events listed:** ${r.eventsListed}`);
  L.push(`- **Events that actually played quals:** ${r.eventsWithQuals}`);
  L.push(`- **Qualification matches:** ${r.qualMatches.toLocaleString()}`);
  L.push(`- **Alliance-sides (the denominator below):** ${r.allianceSides.toLocaleString()}`);
  L.push("");
  L.push(`### Bonus RP rates`);
  L.push("");
  L.push(`| Flag | Fired | Rate | Present on |`);
  L.push(`|---|---|---|---|`);
  for (const flag of [...(RP_FLAGS[r.season] ?? []), ...(SUPPORT_FLAGS[r.season] ?? [])]) {
    const present = r.flagPresent.get(flag) ?? 0;
    const fired = r.flagTrue.get(flag) ?? 0;
    L.push(`| \`${flag}\` | ${fired.toLocaleString()} | **${pct(fired, present)}** | ${present.toLocaleString()} sides |`);
  }
  L.push("");
  L.push(`### Computed \`rp\` total distribution`);
  L.push("");
  L.push(`| RP total | Alliance-sides | Share |`);
  L.push(`|---|---|---|`);
  for (const key of [...r.rpTotals.keys()].sort((a, b) => a - b)) {
    const n = r.rpTotals.get(key)!;
    L.push(`| ${key} | ${n.toLocaleString()} | ${pct(n, r.allianceSides)} |`);
  }
  L.push("");
  return L.join("\n");
}

async function main(): Promise<void> {
  const apiKey = tbaApiKey();
  const results: SeasonRates[] = [];
  for (const season of [2019, 2020]) {
    console.log(`measuring ${season} (walks every in-season event; this takes a few minutes)...`);
    const r = await measureSeason(season, apiKey);
    results.push(r);
    console.log(`  ${season}: ${r.qualMatches} quals across ${r.eventsWithQuals}/${r.eventsListed} events`);
  }

  const doc = [
    `# Bonus-RP base rates — 2019 and 2020`,
    ``,
    `Generated by \`scripts/recon-rp-rates-2019-2020.ts\` for the corpus backfill`,
    `(\`.planning/todos/pending/extend-corpus-2019-2020.md\`). Read-only; no corpus writes.`,
    ``,
    `Measures how OFTEN each bonus RP fires across the FULL season, which the single-event`,
    `shape probe could not answer. A threshold variable that fires almost never is worse than`,
    `not modelling the RP at all, so these rates decide what \`rp/rules/{2019,2020}.ts\` should`,
    `actually model.`,
    ``,
    `Denominator is alliance-sides (2 per qualification match), matching how the RP flags are`,
    `recorded in \`score_breakdown\`.`,
    ``,
    ...results.map(render),
  ].join("\n");

  if (doc.includes(apiKey)) throw new Error("REFUSING TO WRITE: document contains the API key.");
  await writeFile(OUTPUT_PATH, doc, "utf8");
  console.log(`\nwrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
