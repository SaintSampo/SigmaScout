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

/** The corpus's own key format -> the plain team number, e.g. `"frc1114"` -> `1114`. Throws `InvalidTeamKeyError` on a key that does not match `/^frc\d+$/`. */
export function teamNumberFromKey(teamKey: string): number {
  const match = TEAM_KEY_PATTERN.exec(teamKey);
  if (match === null) {
    throw new InvalidTeamKeyError(teamKey);
  }
  return Number.parseInt(match[1]!, 10);
}
