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
export function computeSizeStats(records: readonly PublishedObjectRecord[]): Partial<Record<PageKind, PageKindSizeStats>> {
  const byKind = new Map<PageKind, PublishedObjectRecord[]>();
  for (const record of records) {
    const list = byKind.get(record.pageKind) ?? [];
    list.push(record);
    byKind.set(record.pageKind, list);
  }
  const result: Partial<Record<PageKind, PageKindSizeStats>> = {};
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
}

/**
 * Renders the fenced block: 2-space-indented JSON, keys in the committed
 * order (measuredAt, run, pages; kinds teams/team/events/event/compare; each
 * kind's count, medianBytes, p95Bytes, maxBytes, budgetMaxBytes, largestKey),
 * ceilings taken from `PAGE_BUDGET_MAX_BYTES`. Throws when any kind is
 * missing — a partial run must not overwrite the full-run record.
 */
export function renderPublishBudgetBlock(params: RenderPublishBudgetParams): string {
  const pages: Record<string, PublishBudgetPageEntry> = {};
  for (const kind of BUDGET_PAGE_KINDS) {
    const stats = params.pages[kind];
    if (stats === undefined) {
      throw new Error(`renderPublishBudgetBlock: the run measured no "${kind}" objects — a budget block needs all of ${BUDGET_PAGE_KINDS.join(", ")}`);
    }
    pages[kind] = {
      count: stats.count,
      medianBytes: stats.medianBytes,
      p95Bytes: stats.p95Bytes,
      maxBytes: stats.maxBytes,
      budgetMaxBytes: PAGE_BUDGET_MAX_BYTES[kind],
      largestKey: stats.largestKey,
    };
  }
  const block: PublishBudget = { measuredAt: params.measuredAt, run: params.run, pages };
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
