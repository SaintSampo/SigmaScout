/**
 * Shared spine for the TBA `score_breakdown` reconnaissance probes
 * (`recon-breakdown-fields.ts`, `recon-rp-rates.ts`, `recon-rp-thresholds.ts`).
 *
 * Everything exported here is lifted VERBATIM from the three season-suffixed
 * probes this module replaces (`recon-tba-fields-2019-2020.ts`,
 * `recon-rp-rates-2019-2020.ts`, `recon-rp-thresholds-2019-2020.ts`) — no new
 * behaviour, just one home for it instead of three drifting copies. That is
 * what makes extending recon to a new season (2018, then 2017, then 2016 —
 * see `.planning/todos/pending/extend-corpus-2018-2017-2016.md`) a
 * `--seasons` argument rather than a new script file.
 *
 * Carries NO season literal anywhere in executable code. Year mentions in
 * this file are prose only, e.g.: `pnpm recon:fields -- --seasons 2018`.
 *
 * Reads `TBA_API_KEY` from the environment (via `tbaApiKey()`) and sends it
 * only as the `X-TBA-Auth-Key` request header. The key reaches this module
 * only through `tsx --env-file=.env`, and `writeReconDoc` refuses to write
 * any document whose rendered text contains it — see `.claude/CLAUDE.md`'s
 * secrets section, which exists because this was broken once.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parseSeasonsRange } from "../packages/harness/publish.js";

export const TBA_BASE = "https://www.thebluealliance.com/api/v3";

/** Reads TBA_API_KEY from the environment. Returns it to callers only — never to a log, a message, or a document. */
export function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example and re-run.");
  }
  return key;
}

/** Throws on a non-ok response. Use when a bad season/event list should hard-fail the run rather than silently skip. */
export async function tbaGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${TBA_BASE}${path}`, { headers: { "X-TBA-Auth-Key": apiKey } });
  if (!res.ok) throw new Error(`TBA ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Returns null on a non-ok response. Use when a season-walking probe should skip a bad event and continue rather than abort the whole run. */
export async function tbaGetOrNull<T>(path: string, apiKey: string): Promise<T | null> {
  const res = await fetch(`${TBA_BASE}${path}`, { headers: { "X-TBA-Auth-Key": apiKey } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/**
 * event_type values representing normal in-season competition (excludes
 * offseason=99 and preseason=100). Used by the breakdown-fields and rp-rates
 * probes.
 *
 * Deliberately DIFFERENT from `EVENT_TYPE_TIERS` below, which additionally
 * admits preseason (100). For the same 2020 season this filter counted 7,612
 * alliance-sides while `EVENT_TYPE_TIERS` counted 7,640 in the committed
 * evidence (`docs/data/tba-rp-rates-2019-2020.md` vs
 * `docs/data/tba-rp-thresholds-2019-2020.md`). Do NOT unify these two
 * filters — doing so would silently move every number in both documents.
 */
export const IN_SEASON_EVENT_TYPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5, 6]);

/**
 * Maps event_type to a competition tier (base / districtChampionship /
 * championship). Mirrors `packages/rp/constants.ts`'s `EVENT_TYPE_TIERS`.
 * Used by the rp-thresholds probe ONLY.
 *
 * Deliberately DIFFERENT from `IN_SEASON_EVENT_TYPES` above, because it
 * additionally admits preseason (100). For the same 2020 season this filter
 * counted 7,640 alliance-sides while `IN_SEASON_EVENT_TYPES` counted 7,612 in
 * the committed evidence (`docs/data/tba-rp-thresholds-2019-2020.md` vs
 * `docs/data/tba-rp-rates-2019-2020.md`). Do NOT unify these two filters —
 * doing so would silently move every number in both documents.
 */
export const EVENT_TYPE_TIERS: Readonly<Record<number, string>> = {
  0: "base",
  1: "base",
  100: "base",
  2: "districtChampionship",
  5: "districtChampionship",
  3: "championship",
  4: "championship",
};

/** Classifies a raw `score_breakdown` value's runtime shape for the field-recon table. */
export function classify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** One-decimal percentage from a numerator/denominator pair, e.g. "14.7%". Returns "n/a" when the denominator is zero. */
export function pctOf(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

/** Two-decimal percentage from a 0..1 ratio, e.g. "98.05%". */
export function pctRatio(x: number): string {
  return `${(100 * x).toFixed(2)}%`;
}

/**
 * Renders the requested seasons into a filename slug: ascending, hyphen-
 * joined, EVERY season present. Never a compressed range — a gapped run
 * (e.g. seasons 2019 and 2022) and a contiguous run covering the same span
 * must never produce the same slug, so both are spelled out in full.
 */
export function seasonsSlug(seasons: readonly number[]): string {
  return [...seasons].sort((a, b) => a - b).join("-");
}

/**
 * Derives the output path for a probe's generated document from the stem and
 * requested seasons, or returns the override verbatim if one was given.
 *
 * The derived stems (`recon-fields`, `recon-rp-rates`, `recon-rp-thresholds`)
 * deliberately differ from the committed evidence stems (`tba-field-recon`,
 * `tba-rp-rates`, `tba-rp-thresholds`, `tba-rocket-rp`), so a derived path can
 * never collide with a committed evidence document — structurally, not just
 * by convention.
 */
export function deriveOutputPath(stem: string, seasons: readonly number[], override?: string): string {
  if (override) return override;
  return `docs/data/${stem}-${seasonsSlug(seasons)}.md`;
}

/**
 * Writes a generated recon document, guarding both ways a write here can go
 * wrong: refuses if the rendered text contains the live API key (the
 * secrets-boundary assertion, now enforced from one place instead of three
 * copies), and refuses to overwrite an existing file unless `force` is set
 * (the collision guard for committed evidence under `docs/data/`).
 */
export async function writeReconDoc(path: string, doc: string, apiKey: string, force: boolean): Promise<void> {
  if (doc.includes(apiKey)) {
    throw new Error("REFUSING TO WRITE: generated document contains the API key.");
  }
  if (existsSync(path) && !force) {
    throw new Error(`REFUSING TO WRITE: ${path} already exists. Pass --force to overwrite.`);
  }
  await writeFile(path, doc, "utf8");
}

export interface ReconArgs {
  seasons: number[];
  out: string | undefined;
  force: boolean;
  events: string[] | undefined;
  top: number | undefined;
}

const SEASONS_GRAMMAR =
  '--seasons is required. Accepts a single year like "2020", a range like "2019-2020", or a comma-separated list of these, e.g. "2019,2020,2022-2026".';

/**
 * Parses the CLI arguments every recon probe accepts. Seasons come from
 * `parseSeasonsRange`, IMPORTED from `packages/harness/publish.ts` rather
 * than reimplemented — the repo already carries three module-private copies
 * of that parser (`cli.ts`, `identifiability.ts`,
 * `deleteRetiredAlgorithmObjects.ts`) and their drift is documented in
 * `publish.ts`'s own comment. Adding a fourth is exactly the class of
 * failure this task exists to stop.
 */
export function parseReconArgs(argv: readonly string[]): ReconArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      seasons: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      events: { type: "string" },
      top: { type: "string" },
    },
  });

  if (!values.seasons) {
    throw new Error(SEASONS_GRAMMAR);
  }

  const seasons = parseSeasonsRange(values.seasons);
  const events = values.events
    ? values.events
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;
  const top = values.top !== undefined ? Number.parseInt(values.top, 10) : undefined;

  return { seasons, out: values.out, force: values.force ?? false, events, top };
}
