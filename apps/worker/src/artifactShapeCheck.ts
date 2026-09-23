/**
 * THE NARROW STRUCTURAL READ GUARD — what the live tick uses instead of a
 * second `zod` parse of an object that was already validated on its way in.
 *
 * THE TRADE, stated plainly, because this file gives something up:
 *
 *   GIVEN UP: a second full validation of an already-validated object.
 *     `artifactWriter.ts`'s `writeArtifactObject` calls `schema.parse(artifact)`
 *     before `JSON.stringify` and before the subrequest is counted, on EVERY
 *     put, on both the live Worker and the offline `r2Client.ts`. So every object in R2
 *     was schema-validated by whichever writer wrote it. The read-side parse
 *     this module replaces was therefore validating the same object a second
 *     time, on the tick whose CPU budget is the thing under pressure. Measured
 *     2026-09-15 by the since-deleted CPU probe: ~14.6 ms for the twelve team parses and
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
 * THE ONE PLACE THIS IS NOT O(1), and why: a team artifact's `events` IS walked,
 * with a `typeof` test per entry, because `mergeTeamSeasonArtifact` reads
 * `e.eventKey`/`e.matches` on every entry and a non-object entry there throws a
 * raw `TypeError` that the tick's blanket catch swallows — costing the whole team
 * its publish, every tick, forever. The array is bounded by a team's event count
 * (~10), never by match count, so this stays a rounding error next to the deep
 * per-row validation it replaces. (The event artifact's `state.rows` was walked
 * for the same reason until quick task 260923-3w7; nothing walks that block now.)
 *
 * WORKER-SAFE: this module imports nothing but types and one constant. It must
 * never gain a runtime dependency on `zod`, on the tick, or on any writer —
 * adding one would put the cost back.
 */
import { PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact, type TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";

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
 * The live event artifact as `mergeEventArtifact` needs it, or `undefined`
 * when the object cannot be merged — in which case the caller bootstraps,
 * exactly as a failed read-side `EventArtifactSchema.parse` made it.
 *
 * NEITHER STALE BLOCK NEEDS A GUARD ANY MORE (quick task 260923-3w7). `state`
 * had one (and `live` had another) because something downstream WALKED the
 * block's rows: a non-object row threw a raw `TypeError` out through the tick's
 * blanket catch, costing the event its publish every tick forever. Nothing walks
 * either block now — `mergeEventArtifact` destructures both straight out of
 * `existing` and never dereferences them, and neither key is declared on the
 * schema, so `writeArtifactObject`'s `schema.parse` strips whatever a
 * pre-reversal artifact carried. A malformed block is inert, not degraded, which
 * is strictly safer than the tolerance it replaces.
 */
export function checkLiveEventArtifactShape(value: unknown): EventArtifact | undefined {
  if (!isObject(value)) return undefined;
  if (!hasCurrentSchemaVersion(value)) return undefined;
  // `mergeEventArtifact` iterates all three unguarded: `existing.upcoming` and
  // `existing.matches` for their published `sortTime`s, `existing.teams` for
  // the standings rows it replaces in place.
  if (!Array.isArray(value.matches) || !Array.isArray(value.upcoming) || !Array.isArray(value.teams)) return undefined;
  return value as EventArtifact;
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
