/**
 * Read-only reconnaissance probe for the 2019 and 2020 corpus backfill
 * (`.planning/todos/pending/extend-corpus-2019-2020.md`).
 *
 * `recon-tba-fields.ts` answered a narrower question for 2022-2026 — "does TBA
 * expose a computed per-match RP field?" — and hardcodes those five seasons.
 * Authoring `breakdown/2019.ts`, `breakdown/2020.ts`, `rp/rules/2019.ts` and
 * `rp/rules/2020.ts` needs strictly more: the COMPLETE `score_breakdown` key
 * set, with observed values and inferred types, across several real qualification
 * matches so that a key which happens to be null in one match is not mistaken for
 * an absent one.
 *
 * Deliberately a SEPARATE file rather than an edit to the existing probe: that
 * one is documented as a one-shot whose output (`docs/data/tba-field-recon.md`)
 * is a committed record of what was true for 2022-2026. Widening its season list
 * would rewrite that record as a side effect.
 *
 * Reads TBA_API_KEY from the environment and sends it only as the
 * X-TBA-Auth-Key request header. The key is never logged and never written into
 * the generated document — asserted at the bottom of main().
 *
 * Run: pnpm recon:tba-2019-2020
 */
import { writeFile } from "node:fs/promises";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const SEASONS = [2019, 2020] as const;
const OUTPUT_PATH = "docs/data/tba-field-recon-2019-2020.md";

/** How many qual matches to sample per season. More than one so a null-in-this-match key is not read as absent. */
const MATCH_SAMPLE_SIZE = 12;
/** How many events to try before giving up on a season. 2020 stopped after ~week 3, so most of its events were never played. */
const MAX_EVENTS_TRIED = 12;

interface TbaEventSimple {
  key: string;
  name: string;
  event_type: number;
  start_date: string;
  week: number | null;
}

interface TbaMatch {
  key: string;
  comp_level: string;
  score_breakdown: Record<string, Record<string, unknown>> | null;
}

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example and re-run.");
  }
  return key;
}

async function tbaGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${TBA_BASE}${path}`, { headers: { "X-TBA-Auth-Key": apiKey } });
  if (!res.ok) throw new Error(`TBA ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** event_type values representing normal in-season competition (excludes offseason=99, preseason=100). */
const IN_SEASON_EVENT_TYPES = new Set([0, 1, 2, 3, 4, 5, 6]);

/** One observed alliance-side key across the sampled matches. */
interface FieldObservation {
  key: string;
  /** Every distinct runtime type seen (null counted separately from its type). */
  types: Set<string>;
  /** Up to 6 distinct stringified sample values, for reading the domain off directly. */
  samples: Set<string>;
  /** How many of the sampled alliance-sides carried this key at all. */
  presentCount: number;
}

interface SeasonRecon {
  season: number;
  eventsTried: string[];
  eventUsed: { key: string; name: string; week: number | null } | null;
  matchKeys: string[];
  allianceSideCount: number;
  fields: FieldObservation[];
  rpTotalFieldName: string | null;
  error: string | null;
}

function classify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function reconSeason(season: number, apiKey: string): Promise<SeasonRecon> {
  const out: SeasonRecon = {
    season,
    eventsTried: [],
    eventUsed: null,
    matchKeys: [],
    allianceSideCount: 0,
    fields: [],
    rpTotalFieldName: null,
    error: null,
  };

  let events: TbaEventSimple[];
  try {
    events = await tbaGet<TbaEventSimple[]>(`/events/${season}/simple`, apiKey);
  } catch (err) {
    out.error = `Could not list events for ${season}: ${err instanceof Error ? err.message : String(err)}`;
    return out;
  }

  const candidates = events
    .filter((e) => IN_SEASON_EVENT_TYPES.has(e.event_type))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const byKey = new Map<string, FieldObservation>();

  for (const event of candidates.slice(0, MAX_EVENTS_TRIED)) {
    out.eventsTried.push(event.key);
    let matches: TbaMatch[];
    try {
      matches = await tbaGet<TbaMatch[]>(`/event/${event.key}/matches`, apiKey);
    } catch {
      continue;
    }

    const quals = matches
      .filter((m) => m.comp_level === "qm" && m.score_breakdown != null)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, MATCH_SAMPLE_SIZE);

    if (quals.length === 0) continue;

    out.eventUsed = { key: event.key, name: event.name, week: event.week };

    for (const match of quals) {
      out.matchKeys.push(match.key);
      for (const side of ["red", "blue"] as const) {
        const bd = match.score_breakdown?.[side];
        if (!bd) continue;
        out.allianceSideCount += 1;
        for (const [key, value] of Object.entries(bd)) {
          let obs = byKey.get(key);
          if (!obs) {
            obs = { key, types: new Set(), samples: new Set(), presentCount: 0 };
            byKey.set(key, obs);
          }
          obs.presentCount += 1;
          obs.types.add(classify(value));
          if (obs.samples.size < 6) obs.samples.add(JSON.stringify(value) ?? "undefined");
        }
      }
    }
    break; // one event with real quals is enough
  }

  if (out.eventUsed === null) {
    out.error = `No in-season event with qualification matches carrying score_breakdown found among the first ${Math.min(candidates.length, MAX_EVENTS_TRIED)} candidates.`;
    return out;
  }

  out.fields = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  out.rpTotalFieldName =
    out.fields.find((f) => f.key.toLowerCase() === "tba_rpearned")?.key ??
    out.fields.find((f) => f.key.toLowerCase() === "rp")?.key ??
    null;
  return out;
}

function renderSeason(r: SeasonRecon): string {
  const lines: string[] = [];
  lines.push(`## ${r.season}`);
  lines.push("");
  if (r.error) {
    lines.push(`**PROBE FAILED:** ${r.error}`);
    lines.push("");
    lines.push(`Events tried: ${r.eventsTried.join(", ") || "(none)"}`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`- **Event sampled:** \`${r.eventUsed!.key}\` — ${r.eventUsed!.name} (week ${r.eventUsed!.week ?? "?"})`);
  lines.push(`- **Qual matches sampled:** ${r.matchKeys.length} (${r.allianceSideCount} alliance-sides)`);
  lines.push(`- **Distinct \`score_breakdown\` keys:** ${r.fields.length}`);
  lines.push(
    `- **Computed RP total field:** ${r.rpTotalFieldName ? `\`${r.rpTotalFieldName}\` — PRESENT` : "**ABSENT** — RP totals must be derived from the component fields below"}`
  );
  lines.push("");
  lines.push(`| Key | Type(s) | Present | Observed values |`);
  lines.push(`|---|---|---|---|`);
  for (const f of r.fields) {
    const present = f.presentCount === r.allianceSideCount ? "all" : `${f.presentCount}/${r.allianceSideCount}`;
    const samples = [...f.samples].map((s) => `\`${s.replace(/\|/g, "\\|")}\``).join(", ");
    lines.push(`| \`${f.key}\` | ${[...f.types].join(" \\| ")} | ${present} | ${samples} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const apiKey = tbaApiKey();
  const results: SeasonRecon[] = [];
  for (const season of SEASONS) {
    console.log(`probing ${season}...`);
    results.push(await reconSeason(season, apiKey));
  }

  const doc = [
    `# TBA \`score_breakdown\` reconnaissance — 2019 and 2020`,
    ``,
    `Generated by \`scripts/recon-tba-fields-2019-2020.ts\` for the corpus backfill`,
    `(\`.planning/todos/pending/extend-corpus-2019-2020.md\`). Read-only probe; no corpus writes.`,
    ``,
    `This exists to author \`breakdown/{2019,2020}.ts\` and \`rp/rules/{2019,2020}.ts\` from`,
    `OBSERVED fields rather than from memory of how those games were scored. Several qual`,
    `matches are sampled per season so a key that is null in one match is not mistaken for an`,
    `absent one.`,
    ``,
    ...results.map(renderSeason),
  ].join("\n");

  if (doc.includes(apiKey)) {
    throw new Error("REFUSING TO WRITE: generated document contains the API key.");
  }

  await writeFile(OUTPUT_PATH, doc, "utf8");
  console.log(`\nwrote ${OUTPUT_PATH}`);
  for (const r of results) {
    console.log(
      r.error
        ? `  ${r.season}: FAILED — ${r.error}`
        : `  ${r.season}: ${r.fields.length} keys from ${r.matchKeys.length} matches at ${r.eventUsed!.key}; RP total field ${r.rpTotalFieldName ?? "ABSENT"}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
