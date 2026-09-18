/**
 * THE NARROW STRUCTURAL READ GUARD — what the live tick uses instead of a
 * second `zod` parse of an object that was already validated on its way in.
 *
 * THE TRADE, stated plainly, because this file gives something up:
 *
 *   GIVEN UP: a second full validation of an already-validated object.
 *     `artifactWriter.ts`'s `writeArtifactObject` calls `schema.parse(artifact)`
 *     before `JSON.stringify` and before `budget.tryConsume`, on EVERY put, on
 *     both the live Worker and the offline `r2Client.ts`. So every object in R2
 *     was schema-validated by whichever writer wrote it. The read-side parse
 *     this module replaces was therefore validating the same object a second
 *     time, on the tick whose CPU budget is the thing under pressure. Measured
 *     2026-09-15 by the state probe: ~14.6 ms for the twelve team parses and
 *     ~5.1 ms for the one event parse, out of a ~23 ms Phase B.
 *
 *   KEPT: `writeArtifactObject`'s `schema.parse`, untouched. It runs before the
 *     put and before the budget consume, so a malformed object still never
 *     reaches R2 and a validation failure still costs zero subrequests.
 *     Whatever a browser fetches is still the output of a full schema parse.
 *
 *   CHANGED: WHEN a corrupt artifact is detected — at WRITE rather than at
 *     READ. That is why `scheduled.ts`'s `writeArtifactWithBootstrapRetry`
 *     exists: the read-side parse used to degrade a corrupt artifact to a
 *     bootstrap merge, and `TeamSeasonArtifactSchema` has no `.catch`, so
 *     without the retry one corrupt published team artifact would stop that
 *     team publishing PERMANENTLY. The retry moves that degradation to the
 *     write side, where the failure now surfaces.
 *
 * WHAT EACH GUARD CHECKS, AND WHY IT IS EXACTLY THAT: every check below
 * corresponds to a dereference the corresponding merge in `artifactMerge.ts`
 * performs WITHOUT a guard of its own. Nothing more is checked, and the rows of
 * `matches`/`upcoming`/`teams` are deliberately NOT walked — an O(1) check is
 * the entire point, and a bad row inside an otherwise well-shaped artifact is
 * caught at the write boundary like any other malformed output.
 *
 * THE ONE PLACE THIS IS NOT O(1), and why: `state.rows` and `events` ARE
 * walked, with a `typeof` test per entry. `spliceEventStateBlock` dereferences
 * `row.scopeKind` on every state row, and `mergeTeamSeasonArtifact` reads
 * `e.eventKey`/`e.matches` on every event entry; a non-object entry there
 * throws a raw `TypeError`, which `maintainedStateBlock`'s
 * `EventStateBlockError`-only catch rethrows and the tick's blanket catch
 * swallows — costing the whole event its publish, every tick, forever. Both
 * arrays are bounded by roster size (~43) and by a team's event count (~10)
 * respectively, never by match count, so this stays a rounding error next to
 * the deep per-row validation it replaces.
 *
 * WORKER-SAFE: this module imports nothing but types and one constant. It must
 * never gain a runtime dependency on `zod`, on the tick, or on any writer —
 * adding one would put the cost back.
 */
import { PAGE_ARTIFACT_SCHEMA_VERSION, type LiveEventArtifact, type TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";

/** A non-null, non-array object — the only thing a spread or a property read can be given safely. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `schemaVersion` rule, mirrored from `PagePreambleSchema`
 * (`z.literal(PAGE_ARTIFACT_SCHEMA_VERSION)`) rather than invented here — a
 * stricter or looser rule would make the guard and the writer disagree about
 * which objects are readable at all.
 */
function hasCurrentSchemaVersion(value: Record<string, unknown>): boolean {
  return value.schemaVersion === PAGE_ARTIFACT_SCHEMA_VERSION;
}

/**
 * Whether a `state` value can be handed to `spliceEventStateBlock` at all: an
 * object, with an array of objects at `rows`. The block's CONTENTS are not
 * checked — `spliceEventStateBlock` re-checks its own invariants (one league
 * row, matching algorithm id/version, current shape version) and throws
 * `EventStateBlockError`, which `maintainedStateBlock` already catches, logs
 * and degrades to no block.
 */
function isSpliceableStateBlock(state: unknown): boolean {
  if (!isObject(state)) return false;
  const { rows } = state;
  if (!Array.isArray(rows)) return false;
  for (const row of rows) {
    if (!isObject(row)) return false;
  }
  return true;
}

/**
 * Whether a `live` value can be handed to `mergeEventLiveBlock` at all: an
 * object, with an array at `rows`. The rows' CONTENTS are deliberately NOT
 * walked — an O(1) check is the entire point of this module, and the rows are
 * the one part of the block that scales with match count. A bad ROW survives
 * into the merge, is carried by reference into the merged body, and is caught
 * at the write boundary by `LiveEventArtifactSchema.parse` like any other
 * malformed output.
 *
 * `metricKeys` is not checked either: `mergeEventLiveBlock` reads it only
 * through `sameKeyHeader`, whose `.length`/`.every` on a non-array would throw
 * — but a block with an array at `rows` and no array at `metricKeys` is not a
 * shape anything this pipeline writes, and adding the check would not make the
 * guard cheaper or the failure quieter. It fails the same way any other
 * corrupt block does: at the write.
 */
function isLiveBlock(live: unknown): boolean {
  if (!isObject(live)) return false;
  return Array.isArray(live.rows);
}

/**
 * The live event artifact as `mergeEventArtifact` needs it, or `undefined`
 * when the object cannot be merged — in which case the caller bootstraps,
 * exactly as a failed read-side `LiveEventArtifactSchema.parse` made it.
 *
 * A malformed `state` block is NOT a rejection. `EventArtifactSchema.state` is
 * `EventStateBlockSchema.optional().catch(undefined)`: today a bad block costs
 * the BLOCK, not the artifact's whole published history. This mirrors that by
 * returning the object with `state` removed. Rejecting instead would turn a
 * one-key problem into a full history loss on every tick — a behaviour change
 * the read-side parse never had.
 *
 * A malformed `live` block (quick task 260918-16t) is handled IDENTICALLY and
 * for the identical reason: `LiveEventArtifactSchema.live` is
 * `EventLiveBlockSchema.optional().catch(undefined)`, so a bad block costs the
 * BLOCK. Rejecting the artifact instead would cost the event its whole
 * published history on EVERY tick for as long as the bad block sat in R2 —
 * turning an ephemeral, self-healing key into a permanent outage.
 */
export function checkLiveEventArtifactShape(value: unknown): LiveEventArtifact | undefined {
  if (!isObject(value)) return undefined;
  if (!hasCurrentSchemaVersion(value)) return undefined;
  // `mergeEventArtifact` iterates all three unguarded: `existing.upcoming` and
  // `existing.matches` for their published `sortTime`s, `existing.teams` for
  // the standings rows it replaces in place.
  if (!Array.isArray(value.matches) || !Array.isArray(value.upcoming) || !Array.isArray(value.teams)) return undefined;
  const stateMalformed = value.state !== undefined && !isSpliceableStateBlock(value.state);
  const liveMalformed = value.live !== undefined && !isLiveBlock(value.live);
  if (stateMalformed || liveMalformed) {
    const withoutBlocks: Record<string, unknown> = { ...value };
    if (stateMalformed) delete withoutBlocks.state;
    if (liveMalformed) delete withoutBlocks.live;
    return withoutBlocks as LiveEventArtifact;
  }
  return value as LiveEventArtifact;
}

/**
 * The team-season artifact as `mergeTeamSeasonArtifact` needs it, or
 * `undefined` when the object cannot be merged.
 *
 * `seasonStats` and each event entry's `matches` are the two the merge
 * dereferences with no optional chain at all (`artifactMerge.ts`'s
 * `existing?.seasonStats.record` and `existingEvents[eventIndex]!.matches`);
 * `events` and `metricHistory` are spread, which throws on a non-iterable.
 */
export function checkTeamSeasonArtifactShape(value: unknown): TeamSeasonArtifact | undefined {
  if (!isObject(value)) return undefined;
  if (!hasCurrentSchemaVersion(value)) return undefined;

  const { seasonStats } = value;
  if (!isObject(seasonStats) || !isObject(seasonStats.record)) return undefined;

  const { events } = value;
  if (!Array.isArray(events)) return undefined;
  for (const entry of events) {
    if (!isObject(entry) || !Array.isArray(entry.matches)) return undefined;
  }

  if (!Array.isArray(value.metricHistory)) return undefined;
  return value as TeamSeasonArtifact;
}
