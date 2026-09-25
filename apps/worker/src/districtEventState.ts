/**
 * The four per-event state facts the district ledger paints a cell grey or
 * blue from, derived from the match list the tick ALREADY fetched and paid
 * for. Pure: no I/O, no `env`, no `fetch`, no clock.
 *
 * `10-CONTEXT.md`'s "The four state facts, sourced" is the contract; each
 * fact's source and its honest answer when the evidence is ABSENT:
 *
 *  - `qualMatchesPlayed` — how many `qm` rows have actually been played,
 *    decided by `isPlayed` (`packages/ingest/normalize.ts`: both alliances
 *    carry a non-null, non-negative score). Imported, never re-written, so the
 *    Worker has exactly ONE definition of played. Absent evidence answers 0,
 *    which is honest: no row played is genuinely zero played.
 *  - `qualMatchesTotal` — the qualification schedule's length, i.e. the number
 *    of `qm` rows. NO `qm` ROW AT ALL ANSWERS `null`, NOT `0`: TBA publishes
 *    the schedule as matches, so an absent schedule is "unknown length", and a
 *    `0` there would render as a complete-but-empty event. Playoff rows never
 *    count toward it.
 *  - `alliancesPicked` — true when some NON-qual row carries a non-empty
 *    `team_keys` on BOTH alliances. A bracket row TBA has created but not yet
 *    filled has an empty side; that is a placeholder, not a selection, so it
 *    does not flip the fact. Absent evidence answers false.
 *  - `playoffsDone` — true only when there is at least one non-qual row, EVERY
 *    non-qual row is played, AND some `f` row names a winner (`"red"` or
 *    `"blue"`). A tied finals awaiting its replay is played-but-undecided and
 *    answers false; an event with no playoff rows answers false, because an
 *    ABSENT playoff is not a completed one.
 *
 * DELIBERATELY FOUR FIELDS, NOT FIVE. `DistrictEventStateSchema`
 * (`packages/harness/pageArtifacts.ts`) also carries `awardsPosted`, and that
 * fact cannot be derived from a match list at all — `10-RESEARCH.md` Pitfall 4
 * records that rankings carry no award-recipient detail either. A module that
 * returned a placeholder for it would be guessing, so `awardsPosted` is
 * resolved by `districtRefresh.ts` from a conditional `/event/{key}/awards`
 * request instead, and this module never mentions it.
 *
 * `scripts/publishDistricts.ts` (10-06) derives the same five fields from the
 * corpus rather than from a match list. The rules above are the statement the
 * two producers must agree on.
 */
import { isPlayed } from "../../../packages/ingest/normalize.js";
import type { TbaMatch } from "../../../packages/ingest/schemas.js";

/** The four facts a match list can answer. See this module's header for each one's rule and its absent-evidence answer. */
export interface MatchDerivedEventState {
  readonly qualMatchesPlayed: number;
  readonly qualMatchesTotal: number | null;
  readonly alliancesPicked: boolean;
  readonly playoffsDone: boolean;
}

export function deriveMatchDerivedEventState(matches: readonly TbaMatch[]): MatchDerivedEventState {
  let qualCount = 0;
  let qualPlayed = 0;
  let nonQualCount = 0;
  let nonQualUnplayed = 0;
  let alliancesPicked = false;
  let finalsDecided = false;

  for (const match of matches) {
    if (match.comp_level === "qm") {
      qualCount++;
      if (isPlayed(match)) qualPlayed++;
      continue;
    }

    nonQualCount++;
    if (!isPlayed(match)) nonQualUnplayed++;
    if (match.alliances.red.team_keys.length > 0 && match.alliances.blue.team_keys.length > 0) alliancesPicked = true;
    if (match.comp_level === "f" && (match.winning_alliance === "red" || match.winning_alliance === "blue")) finalsDecided = true;
  }

  return {
    qualMatchesPlayed: qualPlayed,
    qualMatchesTotal: qualCount === 0 ? null : qualCount,
    alliancesPicked,
    playoffsDone: nonQualCount > 0 && nonQualUnplayed === 0 && finalsDecided,
  };
}
