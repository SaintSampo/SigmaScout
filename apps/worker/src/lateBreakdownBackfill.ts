/**
 * The late score breakdown backfill (quick task 261017-doy).
 *
 * WHY THIS EXISTS. TBA posts a match's score before its `score_breakdown`
 * lands, and at an offseason event the gap between the two can run from
 * seconds to a long while. The tick folds a match the first time it sees it
 * played (`splitEventMatches`), and from then on the match sits at or before
 * the fold cursor, where no later poll normalizes it again. A match folded in
 * that gap was published with `actualRedRp`/`actualBlueRp` of `null` and
 * `actualRedBonusRp`/`actualBlueBonusRp` of `null`, and stayed that way for the
 * rest of the event: the Quals tab showed no ranking points for it, and a
 * rewind simulation's summed baseline excluded it. Seen live at 2026ncfay on
 * 2026-10-17, where 16 of 24 played qualification rows carried no ranking
 * points while TBA's own match pages showed every breakdown.
 *
 * WHAT IT DOES. On every poll that returns a full match list (a 200), for each
 * live algorithm's event artifact: find the published PLAYED rows at or before
 * the cursor that still have a gap, normalize ONLY those matches from the raw
 * list (the breakdown's `JSON.stringify` cost is paid per gap row, never per
 * match), and fill in what is now derivable. A filled row's team artifacts get
 * the same rows patched. Nothing about the fold changes: the algorithm state
 * folded those matches without a breakdown and is not re-folded here. A fact
 * that is still not derivable stays `null`, exactly as the row contract says
 * (`pageArtifacts.ts`, `actualRedRp`).
 *
 * WHAT IT NEVER DOES. Overwrite a published number with a different number: a
 * value is written into a `null` or absent field only. Fail the tick: every
 * R2 read or write here is wrapped by the caller, and a throw costs the
 * backfill alone.
 *
 * Pure parts (`rowHasBreakdownGap`, `lateBreakdownFactsFor`, `patchRowsWithLateBreakdowns`)
 * are exported for the unit test; the I/O orchestration lives in `scheduled.ts`.
 */
import { isPlayed, normalizeMatch } from "../../../packages/ingest/normalize.js";
import type { TbaMatch } from "../../../packages/ingest/schemas.js";
import { actualBonusFlagsForMatch, type ActualBonusFlags } from "../../../packages/harness/publishedRows.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { isBonusRpCompLevel } from "../../../packages/core/rankingPoints/constants.js";
import type { CompLevel } from "../../../packages/core/algorithms/types.js";

/** The fields the backfill reads and may write on a published played row, event or team-season. */
export interface BreakdownPatchableRow {
  readonly matchKey: string;
  readonly compLevel: CompLevel;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly actualWinner?: unknown;
  readonly actualRedRp?: number | null;
  readonly actualBlueRp?: number | null;
  readonly actualRedBonusRp?: readonly boolean[] | null;
  readonly actualBlueBonusRp?: readonly boolean[] | null;
}

/** What one raw match can now supply to a row published without it. */
export interface LateBreakdownFacts {
  readonly actualRedRp: number | null;
  readonly actualBlueRp: number | null;
  /** `undefined` = the field does not belong on this row at all (playoff match, no rule module); `null` = still not derivable. */
  readonly actualBonusFlags: ActualBonusFlags | null | undefined;
}

/**
 * A PLAYED row has a gap when a fact TBA may still supply is `null` or absent.
 * An unplayed row (no `actualWinner`) never has one: its actuals do not exist
 * yet and the fold will write them when it does.
 */
export function rowHasBreakdownGap(row: BreakdownPatchableRow): boolean {
  if (row.actualWinner === undefined) return false;
  if (row.actualRedRp == null || row.actualBlueRp == null) return true;
  return isBonusRpCompLevel(row.compLevel) && (row.actualRedBonusRp == null || row.actualBlueBonusRp == null);
}

/**
 * The facts the raw list can supply for the given match keys, computed for a
 * key only when its raw match is played and carries a breakdown. A key with no
 * such raw match has no entry, and a caller treats a missing entry as "nothing
 * new". `eventType` is the tick's resolved value for the event (`-1` when the
 * detail fetch failed, which makes the bonus flags `null` through
 * `isRpEligibleEventType`, never a guess).
 */
export function lateBreakdownFactsFor(
  rawMatches: readonly TbaMatch[],
  matchKeys: Iterable<string>,
  season: number,
  eventType: number,
  eventStartDateIso: string
): Map<string, LateBreakdownFacts> {
  const rawByKey = new Map(rawMatches.map((m) => [m.key, m]));
  const ruleModule = RP_RULE_MODULES[season];
  const facts = new Map<string, LateBreakdownFacts>();
  for (const matchKey of matchKeys) {
    const raw = rawByKey.get(matchKey);
    if (raw === undefined || !isPlayed(raw) || raw.score_breakdown == null) continue;
    const normalized = normalizeMatch(raw, eventStartDateIso);
    facts.set(matchKey, {
      actualRedRp: normalized.redRpEarned,
      actualBlueRp: normalized.blueRpEarned,
      actualBonusFlags: actualBonusFlagsForMatch(
        { compLevel: normalized.compLevel, eventType, hasScoreBreakdown: normalized.hasScoreBreakdown, scoreBreakdownRaw: normalized.scoreBreakdownRaw },
        ruleModule
      ),
    });
  }
  return facts;
}

export interface LateBreakdownPatch<Row extends BreakdownPatchableRow> {
  /** The same array reference when nothing changed, else a new array whose patched rows are new objects. */
  readonly rows: readonly Row[];
  /** The keys of the rows that changed, in row order. */
  readonly patchedKeys: readonly string[];
}

/**
 * Fills `null`/absent actual ranking-point fields on played rows from `facts`.
 * A field that already holds a value is never touched, a `null` fact never
 * replaces anything, and a row the facts cannot improve is returned as the
 * same object. Bonus arrays are copied, never aliased, and are written only
 * on a bonus-bearing competition level, exactly as `eventMatchBonusRpFields`
 * publishes them.
 */
export function patchRowsWithLateBreakdowns<Row extends BreakdownPatchableRow>(
  rows: readonly Row[],
  facts: ReadonlyMap<string, LateBreakdownFacts>
): LateBreakdownPatch<Row> {
  let out: Row[] | undefined;
  const patchedKeys: string[] = [];
  rows.forEach((row, index) => {
    if (!rowHasBreakdownGap(row)) return;
    const fact = facts.get(row.matchKey);
    if (fact === undefined) return;
    const next: Record<string, unknown> = {};
    if (row.actualRedRp == null && typeof fact.actualRedRp === "number") next["actualRedRp"] = fact.actualRedRp;
    if (row.actualBlueRp == null && typeof fact.actualBlueRp === "number") next["actualBlueRp"] = fact.actualBlueRp;
    if (isBonusRpCompLevel(row.compLevel) && fact.actualBonusFlags != null && (row.actualRedBonusRp == null || row.actualBlueBonusRp == null)) {
      if (row.actualRedBonusRp == null) next["actualRedBonusRp"] = [...fact.actualBonusFlags.red];
      if (row.actualBlueBonusRp == null) next["actualBlueBonusRp"] = [...fact.actualBonusFlags.blue];
    }
    if (Object.keys(next).length === 0) return;
    if (out === undefined) out = [...rows];
    out[index] = { ...row, ...next } as Row;
    patchedKeys.push(row.matchKey);
  });
  return out === undefined ? { rows, patchedKeys } : { rows: out, patchedKeys };
}
