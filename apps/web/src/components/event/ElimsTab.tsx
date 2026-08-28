import { useMemo } from "react";
import { EventMatchTable, EventMatchTableSkeleton } from "./EventMatchTable.js";
import { computeEventAxisDomain, isElimCompLevel, mergeEventMatches } from "./eventMatchAxis.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The Elims tab (EVNT-06, D-14, 07-13-PLAN.md): every elimination match of
 * this event — `compLevel` in the closed set `ef`/`qf`/`sf`/`f`, selected by
 * 07-12's `isElimCompLevel` and by no filter written here — as ONE FLAT LIST
 * with NO bracket grouping, each round labelled by `matchLabel()`'s existing
 * output. There is no bracket because the structure genuinely cannot be
 * recovered from the published fields: from 2023 on, `compLevel` is `sf` for
 * nearly every playoff match (2025 alone publishes 3,923 `sf` rows against 5
 * `qf`), so a round would have to be inferred from set-number ordering, and
 * 2022's best-of-three bracket needs an entirely different path. CONTEXT.md's
 * Deferred Ideas carries the bracket; a partial one drawn from an inference
 * would be pixel-identical to a real one while being wrong in a way the
 * reader cannot detect.
 *
 * Otherwise this is `QualsTab.tsx`'s sibling with one predicate swapped: the
 * same D-13 client-side merge, the same D-12 fresh-per-tab axis domain (an
 * elimination alliance's own score range sits mostly ABOVE a qualification
 * alliance's — measured `2025mnmi`: quals [28, 196], elims [91, 225] — so a
 * shared domain would crowd this tab into the plot's right-hand edge), and
 * `EventMatchTable` consumed completely unchanged: every bonus-RP dot on
 * every elimination row renders `unknown` because `isBonusRpCompLevel`
 * (already applied inside that table) returns `false` for all four
 * elimination levels — playoffs award no bonus RP, so `unknown` here is this
 * tab's NORMAL state, not a degraded one.
 */
export interface ElimsTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

const ELIMS_SKELETON_ROW_COUNT = 6;

/**
 * The pending state's placeholder — the same scroll-region wrapper shape the
 * populated tab uses (mirrors `QualsTabSkeleton`), so the pending and
 * populated states share a footprint and the panel does not jump when data
 * lands.
 */
export function ElimsTabSkeleton() {
  return (
    <div data-testid="elims-table-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
      <EventMatchTableSkeleton rowCount={ELIMS_SKELETON_ROW_COUNT} />
    </div>
  );
}

/**
 * Task 1's tracer scope: the filter, the D-13 merge, the D-12 domain and the
 * table, drawn entirely from 07-12's exports. Task 2 adds the empty-state
 * branch for the 15% of corpus events with zero elimination matches.
 */
export function ElimsTab({ artifact, season }: ElimsTabProps) {
  const rows = useMemo(() => mergeEventMatches(artifact.matches, artifact.upcoming, isElimCompLevel), [artifact]);
  const domain = useMemo(() => computeEventAxisDomain(rows), [rows]);

  return (
    <div data-testid="elims-table-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
      <EventMatchTable rows={rows} domain={domain} season={season} />
    </div>
  );
}
