/**
 * One tick's worth of an event's matches, split on the fold cursor.
 *
 * WHY THIS MODULE EXISTS (quick task 260921-vzf). `processEvent` used to
 * `normalizeMatch` every match TBA returned, on every 200, and then throw most
 * of that work away: an event mid-week returns its whole match list every
 * poll, but only the one or two matches past the cursor are ever folded, and an
 * upcoming match's published row carries nothing but schedule fields. The
 * expensive part of `normalizeMatch` is `JSON.stringify(score_breakdown)` — the
 * breakdown is the bulk of a TBA match body, and the tick was re-serializing
 * all of it, every minute, for matches it had already folded hours ago.
 *
 * THE IDENTITY CONTRACT. `splitEventMatches` (the production path) and
 * `splitEventMatchesNormalizeAll` (the reference implementation, the previous
 * behaviour lifted as-is) are guaranteed to agree, at every cursor position, on:
 *
 *   - `orderedMatchKeys` — the event's total order, element for element;
 *   - `newlyFolded` — the same matches, in the same order, as whole
 *     `CorpusMatch` objects with identical contents down to the
 *     `scoreBreakdownRaw` text;
 *   - the derived `lastFoldedMatchKey` and the derived touched-team array;
 *   - `stillUpcoming` — the same matches in the same order, with the same six
 *     schedule fields, and so the same `buildEventScheduledRow` output.
 *
 * EXACTLY ONE THING IS ALLOWED TO DIFFER: how much work was performed for
 * matches that were already folded. The production path normalizes
 * `newlyFolded.length` matches; the reference path normalizes all of them.
 * Anything else that differs is a defect, and `test/matchSplit.test.ts` is the
 * thing that says so.
 *
 * THE TWO CONTRACTS THIS FILE MUST NOT FORK. Ordering is
 * `compareCorpusMatchOrder`, imported and never reimplemented — it is the
 * shared contract with the offline publisher's `selectMatchesChronological`,
 * and a cursor written by one and read by the other only means something if
 * both sides agree on the order. The cursor test is `foldedCutoffIndex`,
 * imported for the same reason: `hasAlreadyFolded` is now defined in terms of
 * that same function, so the production path and the reference path resolve the
 * anchor through one rule rather than two copies of it.
 */
import { compareCorpusMatchOrder, matchOrderFacts, normalizeMatch, type CorpusMatch, type MatchOrderFacts } from "../../../packages/ingest/normalize.js";
import type { TbaMatch } from "../../../packages/ingest/schemas.js";
import type { ScheduledMatchFacts } from "./artifactMerge.js";
import { foldedCutoffIndex, hasAlreadyFolded, type EventCursor } from "./stateStore.js";

/** What a tick needs out of its poll: the event's order, what it must fold now, and what is still to come. */
export interface EventMatchSplit {
  /** Every match at the event in the shared cursor order — the list `hasAlreadyFolded` and the cursor are meaningful against. */
  readonly orderedMatchKeys: readonly string[];
  /** Played matches strictly after the cursor's anchor, in order. The ONLY matches that are fully normalized on the production path. */
  readonly newlyFolded: readonly CorpusMatch[];
  /** Every unplayed match, in order, projected onto the schedule fields a published upcoming row carries. Never cursor-filtered. */
  readonly stillUpcoming: readonly ScheduledMatchFacts[];
}

/** The six fields `buildEventScheduledRow` writes, read straight off the raw TBA alliances — no winner, no breakdown, no video. */
function scheduledFactsFromRaw(facts: MatchOrderFacts, raw: TbaMatch): ScheduledMatchFacts {
  return {
    matchKey: facts.matchKey,
    compLevel: facts.compLevel,
    setNumber: facts.setNumber,
    matchNumber: facts.matchNumber,
    redTeams: raw.alliances.red.team_keys,
    blueTeams: raw.alliances.blue.team_keys,
  };
}

/** The same six fields off an already-normalized corpus row, so both paths return the same type. */
function scheduledFactsFromCorpus(match: CorpusMatch): ScheduledMatchFacts {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: match.redTeams,
    blueTeams: match.blueTeams,
  };
}

/**
 * THE PRODUCTION PATH: order the whole list from cheap scalar facts, resolve
 * the cursor's anchor ONCE, and run the full `normalizeMatch` on exactly the
 * played matches positioned after it.
 *
 * `matchOrderFacts` reads only the fields `compareCorpusMatchOrder` sorts on
 * plus `isPlayed`; it never touches `score_breakdown` or `videos`. Splitting on
 * `played` rather than on `normalizeMatch(...).winner !== null` is legal
 * because those two predicates are the same predicate — see `matchOrderFacts`'s
 * doc comment in `packages/ingest/normalize.ts` and the equivalence suite in
 * `normalize.test.ts` that fails if they ever drift.
 */
export function splitEventMatches(
  rawMatches: readonly TbaMatch[],
  eventStartDateIso: string,
  cursor: Pick<EventCursor, "lastFoldedMatchKey">
): EventMatchSplit {
  const entries = rawMatches.map((raw) => ({ facts: matchOrderFacts(raw, eventStartDateIso), raw }));
  entries.sort((a, b) => compareCorpusMatchOrder(a.facts, b.facts));

  const orderedMatchKeys = entries.map((e) => e.facts.matchKey);
  // ONE anchor lookup for the whole tick, instead of the two `indexOf` scans
  // per played match the old `hasAlreadyFolded` filter paid.
  const cutoff = foldedCutoffIndex(cursor, orderedMatchKeys);

  const newlyFolded: CorpusMatch[] = [];
  const stillUpcoming: ScheduledMatchFacts[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (!entry.facts.played) {
      // Never cursor-filtered: every unplayed match is republished every tick.
      stillUpcoming.push(scheduledFactsFromRaw(entry.facts, entry.raw));
    } else if (i > cutoff) {
      newlyFolded.push(normalizeMatch(entry.raw, eventStartDateIso));
    }
  }

  return { orderedMatchKeys, newlyFolded, stillUpcoming };
}

/**
 * THE REFERENCE IMPLEMENTATION: `processEvent`'s behaviour before 260921-vzf,
 * lifted verbatim — normalize everything, sort the normalized rows, filter with
 * `hasAlreadyFolded`, project the unplayed rows onto the same six fields.
 *
 * IT HAS NO PRODUCTION CALLER ON PURPOSE. It is the oracle
 * `test/matchSplit.test.ts` diffs `splitEventMatches` against at five cursor
 * positions — the only thing that proves the trim is output-identical rather
 * than merely believed to be. (It was also the `normalize=all` baseline arm of
 * the CPU probe's `normalize=` measurement; quick task 260923-3w4 deleted that
 * probe along with every other CPU-ms instrument, so the oracle role is now the
 * whole reason.)
 *
 * Delete it and the change becomes unverifiable. "It has no callers" is not a
 * reason to remove it; it is the design.
 */
export function splitEventMatchesNormalizeAll(
  rawMatches: readonly TbaMatch[],
  eventStartDateIso: string,
  cursor: Pick<EventCursor, "lastFoldedMatchKey">
): EventMatchSplit {
  const normalized = rawMatches.map((m) => normalizeMatch(m, eventStartDateIso));
  const orderedMatches = [...normalized].sort(compareCorpusMatchOrder);
  const orderedMatchKeys = orderedMatches.map((m) => m.matchKey);

  const newlyFolded = orderedMatches.filter((m) => m.winner !== null && !hasAlreadyFolded(cursor, m.matchKey, orderedMatchKeys));
  const stillUpcoming = orderedMatches.filter((m) => m.winner === null).map(scheduledFactsFromCorpus);

  return { orderedMatchKeys, newlyFolded, stillUpcoming };
}
