/**
 * The payload budget's one home (D-05, quick task 260913-nvn): the per-page
 * ceilings, the size statistics a publish run measures, and the fenced
 * `json budget` block in `docs/publish-budget.md` that records them.
 *
 * Pure: no filesystem access. `publish.ts`'s CLI reads and writes the doc
 * (`--write-budget`); `payloadBudget.test.ts` reads it and asserts its
 * ceilings equal `PAGE_BUDGET_MAX_BYTES`. The doc mirrors the constant — to
 * change a ceiling, edit the constant, and the test fails until the doc
 * agrees.
 */
import { join } from "node:path";
import type { PageKind } from "./pageArtifacts.js";

export const PUBLISH_BUDGET_DOC_PATH = join("docs", "publish-budget.md");

/** Page kinds in the block's committed order. */
export const BUDGET_PAGE_KINDS = ["teams", "team", "events", "event", "compare"] as const satisfies readonly PageKind[];

/**
 * The per-object byte ceiling for each page kind. `publishSeasons` asserts
 * every page-kind object against it BEFORE the object is recorded or queued
 * for upload, in `--dry-run` and real runs alike, so an over-budget object is
 * never uploaded. Never widen a ceiling to make a run pass.
 */
export const PAGE_BUDGET_MAX_BYTES: Readonly<Record<PageKind, number>> = Object.freeze({
  teams: 3_500_000,
  team: 500_000,
  events: 108_000,
  event: 350_000,
  compare: 20_000,
});

// ---------------------------------------------------------------------------
// The as-of families (quick task 261005-5g0)
// ---------------------------------------------------------------------------

/**
 * The three as-of object families (`asOfIndexKey`, `asOfLogKey`,
 * `asOfSeasonKey` in `pageArtifacts.ts`), in the block's committed order. Not
 * `PageKind`s, so the page block above is unchanged; the block carries them in
 * its own optional `asOf` section.
 */
export const AS_OF_FAMILIES = ["asof", "asof-log", "asof-season"] as const;
export type AsOfFamily = (typeof AS_OF_FAMILIES)[number];

/**
 * The per-object ceiling for each as-of family, asserted by the publisher
 * before an object is recorded or queued, like the page ceilings.
 *
 * DERIVED FROM A MEASUREMENT: the largest object of each family over all ten
 * published seasons, read from `scripts/verifyAsOfOracle.ts`'s size line
 * (which captures through the publisher's own `AsOfSeasonCapture`), times
 * 1.4, rounded up to the next 100,000. The figures are in
 * `docs/publish-budget.md`.
 */
export const AS_OF_BUDGET_MAX_BYTES: Readonly<Record<AsOfFamily, number>> = Object.freeze({
  asof: 400_000,
  "asof-log": 2_000_000,
  "asof-season": 400_000,
});

/** Throws `AsOfBudgetExceededError` when `bytes` is above the family's ceiling; exactly at the ceiling passes. */
export function assertWithinAsOfBudget(family: AsOfFamily, key: string, bytes: number, ceilings: Readonly<Record<AsOfFamily, number>> = AS_OF_BUDGET_MAX_BYTES): void {
  const ceiling = ceilings[family];
  if (bytes > ceiling) throw new AsOfBudgetExceededError(family, key, bytes, ceiling);
}

export class AsOfBudgetExceededError extends Error {
  constructor(
    readonly family: AsOfFamily,
    readonly key: string,
    readonly bytes: number,
    readonly ceiling: number
  ) {
    super(`publish budget exceeded: ${family} object ${key} is ${bytes} bytes, above its ${ceiling}-byte ceiling (AS_OF_BUDGET_MAX_BYTES) — shrink the object; never widen the ceiling to make a run pass`);
    this.name = "AsOfBudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Size statistics
// ---------------------------------------------------------------------------

export interface PublishedObjectRecord {
  readonly pageKind: PageKind;
  readonly key: string;
  readonly bytes: number;
}

export interface PageKindSizeStats {
  readonly count: number;
  readonly medianBytes: number;
  readonly p95Bytes: number;
  readonly maxBytes: number;
  readonly largestKey: string;
}

export function percentileOf(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[idx]!;
}

/**
 * Groups published-object byte counts by page kind and computes the
 * count/median/p95/max/largestKey stats `docs/publish-budget.md`'s
 * machine-readable block records.
 */
export function computeSizeStats<K extends string = PageKind>(
  records: readonly { readonly pageKind: K; readonly key: string; readonly bytes: number }[]
): Partial<Record<K, PageKindSizeStats>> {
  const byKind = new Map<K, { readonly pageKind: K; readonly key: string; readonly bytes: number }[]>();
  for (const record of records) {
    const list = byKind.get(record.pageKind) ?? [];
    list.push(record);
    byKind.set(record.pageKind, list);
  }
  const result: Partial<Record<K, PageKindSizeStats>> = {};
  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => a.bytes - b.bytes);
    const bytesSorted = sorted.map((r) => r.bytes);
    const largest = sorted[sorted.length - 1]!;
    result[kind] = {
      count: sorted.length,
      medianBytes: percentileOf(bytesSorted, 50),
      p95Bytes: percentileOf(bytesSorted, 95),
      maxBytes: largest.bytes,
      largestKey: largest.key,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// The per-object ceiling gate
// ---------------------------------------------------------------------------

export class PublishBudgetExceededError extends Error {
  constructor(
    readonly pageKind: PageKind,
    readonly key: string,
    readonly bytes: number,
    readonly ceiling: number
  ) {
    super(
      `publish budget exceeded: ${pageKind} object ${key} is ${bytes} bytes, above its ${ceiling}-byte ceiling ` +
        `(PAGE_BUDGET_MAX_BYTES.${pageKind}) — shrink the artifact; never widen the ceiling to make a run pass`
    );
    this.name = "PublishBudgetExceededError";
  }
}

/** Throws `PublishBudgetExceededError` when `bytes` is above `ceilings[pageKind]`; exactly at the ceiling passes. */
export function assertWithinPageBudget(pageKind: PageKind, key: string, bytes: number, ceilings: Readonly<Record<PageKind, number>>): void {
  const ceiling = ceilings[pageKind];
  if (bytes > ceiling) throw new PublishBudgetExceededError(pageKind, key, bytes, ceiling);
}

// ---------------------------------------------------------------------------
// The district artifact's ceilings (10-03)
// ---------------------------------------------------------------------------

/**
 * `v1/district/{districtKey}.json`'s per-TEAM byte ceiling.
 *
 * DERIVED FROM A MEASUREMENT, not chosen. `packages/harness/districtBudget.test.ts`
 * measured the live `2026pnw` artifact (126 teams, 303 team-event pairs)
 * carrying every field phase 10 adds except the baked pmfs — a `state` block
 * on every row, an `awardProfile` per team, one `awardBaseRates` table — at
 * 151,351 bytes, or 1,201 bytes per team. This ceiling is that figure times
 * 1.4, rounded up to the next 100.
 *
 * A PER-TEAM ceiling alongside the absolute one below is what makes the gate
 * meaningful across districts of wildly different size: the per-team number
 * catches structural bloat that an absolute number would hide in a small
 * district, and the absolute number bounds the object a browser actually
 * downloads.
 */
export const DISTRICT_DETAIL_MAX_BYTES_PER_TEAM = 1_700;

/**
 * `v1/district/{districtKey}.json`'s absolute byte ceiling:
 * `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` times 750, rounded up to the next
 * 100,000.
 *
 * 750 is a STATED DESIGN MARGIN, not a measurement. FiM is the largest
 * district and carries roughly four times PNW's 126 teams; 750 leaves room
 * above that without becoming a ceiling no real artifact could ever reach.
 */
export const DISTRICT_DETAIL_MAX_BYTES = 1_300_000;

/**
 * `v1/district-presim/{districtKey}/{eventKey}.json`'s byte ceiling.
 *
 * The same measurement built one sidecar per `2026pnw` district event over
 * that event's own roster, with all five category pmfs at their real support:
 * 581,699 bytes across 9 sidecars, largest single sidecar 209,043 bytes. This
 * ceiling is that largest sidecar times 4.4 (FiM's roster scale) times 1.4,
 * rounded up to the next 100,000.
 */
export const DISTRICT_PRESIM_MAX_BYTES = 1_300_000;

/**
 * `v1/districts/{year}.json`'s byte ceiling — the district picker's index.
 *
 * MEASURED, then given a district-count margin. The largest real index is
 * 2026's at 2,089 bytes across 14 districts (measured 2026-09-25 from
 * `publishDistricts --dry-run --local-out`), or 150 bytes per district row.
 * This ceiling is that measurement times 1.4 — the same headroom factor
 * `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` takes — times a stated 10x
 * district-count margin, rounded up to the next 10,000.
 *
 * The 10x is a DESIGN MARGIN, not a measurement: FIRST has never run more than
 * about a dozen districts in a season, and 140 leaves room for a structural
 * field being added to every row as well as for more districts.
 *
 * WHY THE INDEX NEEDS A CEILING AT ALL, given it is three orders of magnitude
 * under the detail object's. It grows with the district count per season, it
 * is on the page-load path for the picker, and until this ceiling existed it
 * was the ONE composed object that bypassed `gateAndRecord` entirely — written
 * and uploaded with no measurement in front of it. A gate that covers two of
 * three object kinds is a gate with a hole in it, not a smaller gate.
 */
export const DISTRICTS_INDEX_MAX_BYTES = 30_000;

export class DistrictBudgetExceededError extends Error {
  constructor(
    readonly key: string,
    readonly bytes: number,
    readonly ceiling: number
  ) {
    super(`district publish budget exceeded: object ${key} is ${bytes} bytes, above its ${ceiling}-byte ceiling — shrink the artifact; never widen the ceiling to make a run pass`);
    this.name = "DistrictBudgetExceededError";
  }
}

/**
 * Throws `DistrictBudgetExceededError` when `bytes` is above `ceiling`;
 * exactly at the ceiling passes. Mirrors `assertWithinPageBudget`'s body and
 * its "shrink the artifact, never widen the ceiling" message.
 *
 * Publish-time enforcement is `scripts/publishDistricts.ts`'s job (10-06 wires
 * this in before `putObject`); this module only owns the numbers.
 */
export function assertWithinDistrictBudget(key: string, bytes: number, ceiling: number): void {
  if (bytes > ceiling) throw new DistrictBudgetExceededError(key, bytes, ceiling);
}

// ---------------------------------------------------------------------------
// The `json budget` block
// ---------------------------------------------------------------------------

const BUDGET_BLOCK_PATTERN = /```json budget\r?\n([\s\S]*?)\r?\n```/;

export class PublishBudgetParseError extends Error {
  constructor(reason: string) {
    super(`payloadBudget: could not read the machine-readable "json budget" block from ${PUBLISH_BUDGET_DOC_PATH} — ${reason}`);
    this.name = "PublishBudgetParseError";
  }
}

export interface PublishBudgetPageEntry {
  count: number;
  medianBytes: number;
  p95Bytes: number;
  maxBytes: number;
  budgetMaxBytes: number;
  largestKey: string;
}

export interface PublishBudget {
  measuredAt: string;
  run: string;
  pages: Record<string, PublishBudgetPageEntry>;
  /** The as-of families' stats, present once a run has published them (quick task 261005-5g0). */
  asOf?: Record<string, PublishBudgetPageEntry>;
}

/** Parses the fenced `json budget` block; a missing or non-JSON block is a named `PublishBudgetParseError`, never a silent skip. */
export function parsePublishBudget(markdown: string): PublishBudget {
  const match = BUDGET_BLOCK_PATTERN.exec(markdown);
  if (!match) {
    throw new PublishBudgetParseError(`no fenced \`\`\`json budget block found`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (err) {
    throw new PublishBudgetParseError(`the block did not parse as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed as PublishBudget;
}

export interface RenderPublishBudgetParams {
  readonly measuredAt: string;
  readonly run: string;
  readonly pages: Partial<Record<PageKind, PageKindSizeStats>>;
  /** The as-of families' stats. Absent (or empty) when the run published none, which writes no `asOf` section. */
  readonly asOf?: Partial<Record<AsOfFamily, PageKindSizeStats>>;
}

function budgetEntry(stats: PageKindSizeStats, budgetMaxBytes: number): PublishBudgetPageEntry {
  return {
    count: stats.count,
    medianBytes: stats.medianBytes,
    p95Bytes: stats.p95Bytes,
    maxBytes: stats.maxBytes,
    budgetMaxBytes,
    largestKey: stats.largestKey,
  };
}

/**
 * Renders the fenced block: 2-space-indented JSON, keys in the committed
 * order (measuredAt, run, pages; kinds teams/team/events/event/compare; each
 * kind's count, medianBytes, p95Bytes, maxBytes, budgetMaxBytes, largestKey),
 * ceilings taken from `PAGE_BUDGET_MAX_BYTES`. Throws when any kind is
 * missing — a partial run must not overwrite the full-run record.
 *
 * Then, when the run published as-of objects, an `asOf` section in the same
 * entry shape, families in `AS_OF_FAMILIES` order, ceilings from
 * `AS_OF_BUDGET_MAX_BYTES`. A run that published some families but not all
 * throws for the same reason.
 */
export function renderPublishBudgetBlock(params: RenderPublishBudgetParams): string {
  const pages: Record<string, PublishBudgetPageEntry> = {};
  for (const kind of BUDGET_PAGE_KINDS) {
    const stats = params.pages[kind];
    if (stats === undefined) {
      throw new Error(`renderPublishBudgetBlock: the run measured no "${kind}" objects — a budget block needs all of ${BUDGET_PAGE_KINDS.join(", ")}`);
    }
    pages[kind] = budgetEntry(stats, PAGE_BUDGET_MAX_BYTES[kind]);
  }
  const block: PublishBudget = { measuredAt: params.measuredAt, run: params.run, pages };
  const asOfStats = params.asOf ?? {};
  if (Object.keys(asOfStats).length > 0) {
    const asOf: Record<string, PublishBudgetPageEntry> = {};
    for (const family of AS_OF_FAMILIES) {
      const stats = asOfStats[family];
      if (stats === undefined) {
        throw new Error(`renderPublishBudgetBlock: the run published as-of objects but none of family "${family}" — the asOf section needs all of ${AS_OF_FAMILIES.join(", ")}`);
      }
      asOf[family] = budgetEntry(stats, AS_OF_BUDGET_MAX_BYTES[family]);
    }
    block.asOf = asOf;
  }
  return "```json budget\n" + JSON.stringify(block, null, 2) + "\n```";
}

/** Replaces the existing fenced block in `markdown` with `block`, leaving every byte outside the fence unchanged. */
export function replacePublishBudgetBlock(markdown: string, block: string): string {
  const match = /```json budget\r?\n[\s\S]*?\r?\n```/.exec(markdown);
  if (!match) {
    throw new PublishBudgetParseError(`no fenced \`\`\`json budget block found to replace`);
  }
  return markdown.slice(0, match.index) + block + markdown.slice(match.index + match[0].length);
}
