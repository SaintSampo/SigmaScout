/**
 * Harness-side corpus-index builder for D-01's cold-start predicate (quick
 * task 260909-t5q). This is the ONE place a corpus-global played-match
 * stream is turned into a `packages/core/scoring/coldStart.ts` index — every
 * production simulator construction that has a corpus handle open calls
 * this rather than re-deriving the stream itself.
 *
 * Two facts belong here rather than in a scattered comment at each call
 * site:
 *
 *   1. `selectMatchesChronological` already restricts to PLAYED matches via
 *      its `winner IS NOT NULL` clause — no separate filter is needed here.
 *   2. Offseason and preseason matches are INCLUDED here on purpose. D-01
 *      defines "unseen" as "anywhere in the ingested corpus", and a team's
 *      offseason debut is still a debut. Including them can only SHRINK the
 *      cold-start set (an offseason match that would otherwise look like a
 *      team's first appearance instead marks that team as already seen for
 *      whatever official match comes next) — never grow it.
 *
 * Memoized per corpus handle in a module-level `WeakMap` so the several
 * production call sites within one process do not each pay a full-corpus
 * chronological scan.
 */
import { buildColdStartIndex } from "../core/scoring/coldStart.js";
import { selectMatchesChronological, type Corpus } from "../corpus/db.js";

const indexByCorpus = new WeakMap<Corpus, ReadonlySet<string>>();

/** The corpus-global cold-start index for `db`, memoized per corpus handle — see this module's header for the query's scope. */
export function corpusColdStartIndex(db: Corpus): ReadonlySet<string> {
  const cached = indexByCorpus.get(db);
  if (cached !== undefined) return cached;

  // No `year` filter (corpus-global, not season-scoped) and no
  // `excludeOffseason` (see this module's header, point 2).
  const wholeCorpusPlayedStream = selectMatchesChronological(db, {});
  const index = buildColdStartIndex(wholeCorpusPlayedStream);
  indexByCorpus.set(db, index);
  return index;
}
