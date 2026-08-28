import { useMemo } from "react";
import { EventMatchTable, EventMatchTableSkeleton } from "./EventMatchTable.js";
import { computeEventAxisDomain, isElimCompLevel, mergeEventMatches } from "./eventMatchAxis.js";
import { QUALS_EMPTY_STATE_BODY } from "./QualsTab.js";
import { EmptyState } from "../StateViews.js";
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
 * Renders `EmptyState` (no table, no axis header, no scroll region) when the
 * merged row list is empty — 239 of the corpus's 1,581 events (15%) carry
 * zero elimination matches, the single most common absent-data shape on this
 * page, not a defensive branch. Renders the full table for an event with
 * zero PLAYED but some scheduled elimination matches — empty means zero
 * elimination matches at all, never "none played yet".
 *
 * The body is IMPORTED from `QualsTab.tsx`'s exported `QUALS_EMPTY_STATE_BODY`
 * rather than retyped — 07-12 exported it exactly so this tab renders the
 * identical Copywriting Contract sentence rather than a paraphrase. The
 * `QUALS_` prefix reads oddly on this tab and that is deliberate: the
 * sentence is shared by contract, and renaming or relocating it would mean
 * editing a dependency's shipped export and its test file for a purely
 * cosmetic gain, against the real risk of turning a green suite red.
 *
 * The sentence actually fits THIS tab BETTER than it fits Quals — its
 * not-yet-published framing is exactly right for the dominant case here (an
 * event mid-schedule whose bracket does not exist yet), and the
 * Championship-Finals case that made the sentence slightly wrong on the
 * Quals tab does not arise here, since a Championship Finals event has a
 * full 15-16 row elimination slate.
 */
export function ElimsTab({ artifact, season }: ElimsTabProps) {
  const rows = useMemo(() => mergeEventMatches(artifact.matches, artifact.upcoming, isElimCompLevel), [artifact]);
  const domain = useMemo(() => computeEventAxisDomain(rows), [rows]);

  if (rows.length === 0) {
    const eventName = artifact.name ?? artifact.eventKey;
    return <EmptyState heading={`No matches found for ${eventName}`} body={QUALS_EMPTY_STATE_BODY} />;
  }

  return (
    <div data-testid="elims-table-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
      <EventMatchTable rows={rows} domain={domain} season={season} />
    </div>
  );
}
