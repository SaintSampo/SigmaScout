/**
 * The single home for the `frc{number}` corpus-key convention (06-RESEARCH.md
 * Pitfall 4). `/team/{number}`'s route param is D-15's deliberately plain
 * team number — the internal corpus key format (`"frc1114"`,
 * `packages/corpus/db.test.ts:372`, `docs/publish-budget.md`'s own
 * `v1/team/frc118/2024/...` key) never leaks into a shareable URL. This is
 * the ONLY module in `apps/web` that knows the `frc` prefix; every other
 * module that needs a team key goes through `toTeamKey`, never a repeated
 * inline template literal.
 */
import { isRealPublishedTeamKey } from "../../../../packages/harness/teamRanks.js";

/** The corpus's own team-key prefix — FRC-specific to this TBA-derived corpus, not a general convention. */
export const TEAM_KEY_PREFIX = "frc";

const TEAM_KEY_PATTERN = /^frc(\d+)$/;

/**
 * Named error class (this repo's no-bare-error convention,
 * `apps/web/src/lib/api/errors.ts`'s doc comment) for a team key that does
 * not match the `frc{digits}` shape.
 */
export class InvalidTeamKeyError extends Error {
  constructor(teamKey: string) {
    super(`teamNumberFromKey: "${teamKey}" does not match the expected "${TEAM_KEY_PREFIX}{number}" shape`);
    this.name = "InvalidTeamKeyError";
  }
}

/** The route param (plain team number) -> the corpus's own key format, e.g. `1114` -> `"frc1114"`. */
export function toTeamKey(teamNumber: number): string {
  return `frc${teamNumber}`;
}

/**
 * Whether a corpus team key names a REAL, competing FRC team registration
 * (2026-09-01, user report: "long names like 5199 don't show up in the teams
 * list"). Two published key shapes are not real teams and are excluded from
 * every MODEL-DERIVED surface — the Teams list, the team page's own rank
 * cards, and search — matching the decision already recorded for the
 * 9970-9999 "Off-Season Demo Team" block
 * (`.planning/todos/completed/exclude-offseason-demo-teams.md`), including
 * its carve-out: EVENT pages still show whoever actually played, so this
 * predicate is deliberately not applied there.
 *
 * 1. LETTER-SUFFIXED keys (`frc5199B`, `frc1165C`) — a team's second robot,
 *    entered at offseason events only. TBA publishes no nickname for them,
 *    and `teamNumber` is the PARENT's number, so they render as a nameless
 *    duplicate of a real team. Measured across the published artifacts:
 *    43-54 such rows per season. The concrete report that surfaced this:
 *    `frc5199B` sat at RANK 3 of all 2024 on 15 offseason matches at one
 *    event (Tidal Tumble, `eventType` 99), directly above real teams with
 *    ninety-plus official matches.
 * 2. `frc0` — a zero-numbered row carrying no matches and no `total` metric
 *    at all (present in 2024 only). FRC team numbers start at 1.
 *
 * Quick task 260905-ldu: this rule's implementation now lives in
 * `packages/harness/teamRanks.ts`'s `isRealPublishedTeamKey` — the offline
 * pipeline needs the identical rule to build its published rank pools, and a
 * single shared home is what keeps this predicate from drifting into two
 * copies. Re-exported here under its original name so every existing call
 * site in this codebase stays unchanged.
 */
export const isRealTeamKey = isRealPublishedTeamKey;

/** The corpus's own key format -> the plain team number, e.g. `"frc1114"` -> `1114`. Throws `InvalidTeamKeyError` on a key that does not match `/^frc\d+$/`. */
export function teamNumberFromKey(teamKey: string): number {
  const match = TEAM_KEY_PATTERN.exec(teamKey);
  if (match === null) {
    throw new InvalidTeamKeyError(teamKey);
  }
  return Number.parseInt(match[1]!, 10);
}
