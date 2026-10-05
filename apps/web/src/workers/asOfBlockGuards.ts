/**
 * THE AS-OF BLOCK'S SHAPE GUARDS (quick task 261005-5g0), shared by the two
 * protocols that carry as-of state across a Worker boundary: the Locks tabs'
 * `districtSimulationProtocol.ts` and the Simulation tab's
 * `simulationAsOfJob.ts`. One copy, so the two requests are checked with the
 * same strictness and cannot drift apart.
 *
 * Checked by hand, with no schema library and no import at all, because
 * `districtSimulationProtocol.ts` is part of the Live district Worker chunk and
 * the main bundle, neither of which carries `asOfState.ts`'s schemas.
 */

/** Upper bound on an as-of block's `vars.length`: a season's RP rule module names a handful of threshold variables. */
export const MAX_AS_OF_VARS = 16;

/** Robots on one alliance of a remaining row: three, or four in the oldest seasons' rare surrogate shapes. */
const MAX_AS_OF_ALLIANCE = 4;

/**
 * `asOfState.ts`'s `asOfLeagueLength`, restated: importing that module would
 * bring its schemas (and the schema library) into the Live Worker chunk and the
 * main bundle. `districtAsOfJob.test.ts` pins the two equal.
 */
export function asOfLeagueTupleLength(varCount: number): number {
  return 5 + 5 * varCount;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteTuple(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

/** `AsOfTeamTupleSchema`'s shape, checked by hand so the Worker carries no schema library for it. */
export function isAsOfTeamTuple(value: unknown, varCount: number): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const [sprPart, sigmaPart, varsPart] = value as unknown[];
  if (sprPart !== null && !isFiniteTuple(sprPart, 4)) return false;
  if (sigmaPart !== null && !isFiniteTuple(sigmaPart, 5)) return false;
  if (varsPart === null) return true;
  if (!Array.isArray(varsPart) || varsPart.length > varCount) return false;
  return varsPart.every((part) => part === null || isFiniteTuple(part, 4));
}

function isTeamList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_AS_OF_ALLIANCE && value.every((teamKey) => typeof teamKey === "string" && teamKey.length > 0);
}

/** One remaining qualification row (`UpcomingMatch`) as an as-of block carries it. */
export function isAsOfRow(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.matchKey !== "string" || row.matchKey.length === 0) return false;
  if (typeof row.eventKey !== "string" || row.eventKey.length === 0) return false;
  if (row.compLevel !== "qm") return false;
  if (!Number.isInteger(row.setNumber) || !Number.isInteger(row.matchNumber) || !Number.isInteger(row.eventType)) return false;
  if (row.week !== null && !Number.isInteger(row.week)) return false;
  return isTeamList(row.redTeams) && isTeamList(row.blueTeams) && isTeamList(row.redSurrogates) && isTeamList(row.blueSurrogates);
}

/**
 * The model part every as-of block shares: the season, its threshold
 * variables, the league tuple sized for them, and at most `maxTeams` keyed team
 * tuples. Numeric validity beyond finiteness is `buildAsOfPricer`'s own typed
 * refusal.
 */
export function isAsOfModelBlock(block: Record<string, unknown>, maxTeams: number): boolean {
  if (!Number.isInteger(block.season)) return false;
  if (!Array.isArray(block.vars) || block.vars.length > MAX_AS_OF_VARS || !block.vars.every((name) => typeof name === "string")) return false;
  if (!Array.isArray(block.league) || block.league.length !== asOfLeagueTupleLength(block.vars.length) || !block.league.every(isFiniteNumber)) return false;
  if (!Array.isArray(block.teams) || block.teams.length > maxTeams) return false;
  for (const entry of block.teams) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    if (typeof entry[0] !== "string" || entry[0].length === 0) return false;
    if (!isAsOfTeamTuple(entry[1], block.vars.length)) return false;
  }
  return true;
}
