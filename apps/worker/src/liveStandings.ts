/**
 * THE LIVE EVENT'S COUNTED STANDINGS, computed inside the tick that folds the
 * matches they are counted from.
 *
 * WHERE THIS CAME FROM, AND WHY IT MOVED. This derivation was written for the
 * BROWSER (`apps/web/src/lib/liveStandings.ts`, quick task 260921-q2s), because
 * the tick that folded a match every minute never refetched TBA's rankings:
 * `teams[].rank`/`record`/`rp` stayed frozen at publish time (or absent
 * entirely on a Worker-promoted stub event) while `matches[]` kept growing, so
 * the page that polled the artifact counted the standings itself. Quick task
 * 260923-3w7 moved it here unchanged in arithmetic. The tick already holds
 * every played qualification row it needs, it writes the artifact anyway, and a
 * derivation that runs once per fold beats the same derivation re-run in every
 * reader's browser on every poll.
 *
 * THE TRIGGER CHANGED SHAPE, NOT MEANING. The browser fired on
 * `artifact.live !== undefined` — "this artifact carries matches the published
 * standings do not account for" — and nothing emits a `live` block any more
 * (quick task 260923-3w6). Here the equivalent statement is structural: this
 * runs from `mergeEventArtifact`, which runs only when the tick folded
 * something, over the merged `matches` array that already includes what it just
 * folded. The marker this module still emits (`EventArtifactSchema.standings`)
 * is a different thing entirely — not a trigger the next reader re-derives from,
 * but a PUBLISHED statement to that reader that the standings below were
 * counted here rather than taken from TBA. The alternative the browser
 * header warned against must never be adopted here either — comparing a counted
 * appearance total against the published record total is UNSOUND, because a
 * surrogate appearance makes the counted total exceed TBA's surrogate-adjusted
 * record total even on a finished, fully published event.
 *
 * WHAT A REPUBLISH DOES. The offline publisher writes TBA's own official
 * standings, overwriting everything counted here, exactly as it did when the
 * derivation lived in the browser and a republish erased the `live` block that
 * triggered it.
 *
 * WORKER-SAFE: no `zod` at runtime, no writer, no corpus. Two imports: the
 * published marker's TYPE, and the rounding rule the published Ranking Score
 * already uses.
 */
import type { EventStandingsMarker } from "../../../packages/harness/pageArtifacts.js";
import { ROUNDING_RULE, roundTo } from "../../../packages/harness/rounding.js";

/** A team's counted win/loss/tie record over qualification rows only — see the module header for the scoping rule. */
export interface CountedRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/**
 * One team's counted standing. `rp`/`rank` are present only when the whole
 * result is `ranked` (see `CountedStandings.ranked`) — a records-only result
 * never carries an invented rank.
 */
export interface CountedStandingsRow {
  readonly record: CountedRecord;
  readonly rp?: number;
  readonly rank?: number;
}

/**
 * `ranked` is false when `rpOutcomeRp` is absent, or when any played
 * qualification row is missing a numeric bonus RP for either alliance —
 * ranking points are all-or-nothing for the whole event (see
 * `deriveEventStandings`'s doc comment). `rows` is keyed by team key and covers
 * the pool: the union of the artifact's `teams` and every team key appearing in
 * a played qualification row.
 */
export interface CountedStandings {
  readonly ranked: boolean;
  readonly rows: ReadonlyMap<string, CountedStandingsRow>;
}

/** The fields this derivation reads off one merged played row. Nothing else on a published row is touched. */
export interface StandingsMatchRow {
  readonly compLevel: string;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly actualWinner?: "red" | "blue" | "tie";
  readonly actualRedRp?: number | null;
  readonly actualBlueRp?: number | null;
}

/** The fields this derivation reads off one merged standings row. */
export interface StandingsTeamRow {
  readonly teamKey: string;
  readonly teamNumber?: number;
  readonly rank?: number;
}

export interface DeriveEventStandingsInput {
  readonly matches: readonly StandingsMatchRow[];
  readonly teams: readonly StandingsTeamRow[];
  /** The season's win/tie outcome ranking points, as the artifact publishes them. Absent for a season or algorithm that publishes none. */
  readonly rpOutcomeRp?: { readonly win: number; readonly tie: number };
}

const TEAM_NUMBER_PATTERN = /^frc(\d+)$/;

/**
 * A locally guarded parse, deliberately NOT a throwing `frc{digits}` parser: a
 * letter-suffixed key such as `frc5199B` is real at offseason events. Returns
 * `undefined` for any key this pattern does not match.
 */
function guardedTeamNumberFromKey(teamKey: string): number | undefined {
  const match = TEAM_NUMBER_PATTERN.exec(teamKey);
  return match === null ? undefined : Number.parseInt(match[1]!, 10);
}

/** Prefers the team row's own `teamNumber`, falls back to a guarded parse of the key. */
function resolveTeamNumber(teamKey: string, teamNumberByKey: ReadonlyMap<string, number | undefined>): number | undefined {
  const fromRow = teamNumberByKey.get(teamKey);
  if (fromRow !== undefined) return fromRow;
  return guardedTeamNumberFromKey(teamKey);
}

/**
 * The final tiebreak beyond the ranking-point average: ascending team number
 * when either side resolves one, a key with no resolvable number sorting last,
 * and ascending key string when neither side resolves one.
 *
 * Beyond the ranking-point average, our tiebreak is team number, so an exact
 * tie may order differently from TBA's official season tiebreakers, which need
 * score-breakdown fields this artifact does not carry. A played row also
 * carries no surrogate field and no disqualification field, so a surrogate
 * appearance is counted here where TBA excludes it, and a disqualified team is
 * credited its outcome ranking points where TBA credits zero. Those are this
 * derivation's two known divergences from TBA's own published order; no field
 * is invented to fix them.
 */
function compareTeamNumberTiebreak(aKey: string, bKey: string, teamNumberByKey: ReadonlyMap<string, number | undefined>): number {
  const aNumber = resolveTeamNumber(aKey, teamNumberByKey);
  const bNumber = resolveTeamNumber(bKey, teamNumberByKey);
  if (aNumber !== undefined && bNumber !== undefined) return aNumber - bNumber;
  if (aNumber !== undefined) return -1;
  if (bNumber !== undefined) return 1;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

interface Tally {
  wins: number;
  losses: number;
  ties: number;
  /** Total ranking points credited to this team — accumulated unconditionally during the scan; only ever READ when the scan finished `ranked`. */
  rpTotal: number;
}

function creditAppearance(tally: Tally, outcome: "win" | "loss" | "tie", rpEarned: number): void {
  if (outcome === "win") tally.wins += 1;
  else if (outcome === "tie") tally.ties += 1;
  else tally.losses += 1;
  tally.rpTotal += rpEarned;
}

function allianceOutcome(actualWinner: StandingsMatchRow["actualWinner"], side: "red" | "blue"): "win" | "loss" | "tie" {
  if (actualWinner === "tie") return "tie";
  return actualWinner === side ? "win" : "loss";
}

/**
 * Counts each qualification-row team's record and (when the event's data is
 * complete enough to be honest about it) ranking-point average and rank, from
 * the merged played rows alone. Returns `undefined` when there is no played
 * qualification row at all.
 *
 * Ranking points are ALL OR NOTHING for the whole event: the result is `ranked`
 * only when `rpOutcomeRp` is present AND every played qualification row carries
 * a numeric bonus RP for both alliances. A `null` or absent bonus is a real gap
 * in TBA's data and is never coerced to zero, so a single gap makes the WHOLE
 * result unranked (records only) rather than producing a rank built on an
 * invented zero.
 *
 * The ranking pool is the union of the team keys in `teams` and the team keys
 * appearing in a played qualification row. A pool member with no appearance
 * gets a zero record and, when ranked, zero ranking points — it naturally sorts
 * last since ranking points are never negative.
 */
export function deriveEventStandings(input: DeriveEventStandingsInput): CountedStandings | undefined {
  const qualRows = input.matches.filter((row) => row.compLevel === "qm");
  if (qualRows.length === 0) return undefined;

  const rpOutcomeRp = input.rpOutcomeRp;
  let ranked = rpOutcomeRp !== undefined;

  const tallies = new Map<string, Tally>();
  function tallyFor(teamKey: string): Tally {
    let tally = tallies.get(teamKey);
    if (tally === undefined) {
      tally = { wins: 0, losses: 0, ties: 0, rpTotal: 0 };
      tallies.set(teamKey, tally);
    }
    return tally;
  }

  for (const row of qualRows) {
    // A played row carries no surrogate field and no disqualification field
    // (see the tiebreak's own doc comment for the consequence).
    if (typeof row.actualRedRp !== "number" || typeof row.actualBlueRp !== "number") ranked = false;

    const redOutcome = allianceOutcome(row.actualWinner, "red");
    const blueOutcome = allianceOutcome(row.actualWinner, "blue");
    const redOutcomeRp = rpOutcomeRp === undefined ? 0 : redOutcome === "win" ? rpOutcomeRp.win : redOutcome === "tie" ? rpOutcomeRp.tie : 0;
    const blueOutcomeRp = rpOutcomeRp === undefined ? 0 : blueOutcome === "win" ? rpOutcomeRp.win : blueOutcome === "tie" ? rpOutcomeRp.tie : 0;
    const redBonusRp = typeof row.actualRedRp === "number" ? row.actualRedRp : 0;
    const blueBonusRp = typeof row.actualBlueRp === "number" ? row.actualBlueRp : 0;
    const redRp = redOutcomeRp + redBonusRp;
    const blueRp = blueOutcomeRp + blueBonusRp;

    for (const teamKey of row.redTeams) creditAppearance(tallyFor(teamKey), redOutcome, redRp);
    for (const teamKey of row.blueTeams) creditAppearance(tallyFor(teamKey), blueOutcome, blueRp);
  }

  // The pool also includes every rostered team with no appearance at all.
  for (const team of input.teams) tallyFor(team.teamKey);

  const rows = new Map<string, CountedStandingsRow>();

  if (!ranked) {
    for (const [teamKey, tally] of tallies) {
      rows.set(teamKey, { record: { wins: tally.wins, losses: tally.losses, ties: tally.ties } });
    }
    return { ranked: false, rows };
  }

  const teamNumberByKey = new Map<string, number | undefined>();
  for (const team of input.teams) teamNumberByKey.set(team.teamKey, team.teamNumber);

  const entries = [...tallies.entries()].map(([teamKey, tally]) => {
    const appearances = tally.wins + tally.losses + tally.ties;
    // Sorted on the UNROUNDED average so two teams separated in the third
    // decimal are not collapsed into a tie.
    const average = appearances > 0 ? tally.rpTotal / appearances : 0;
    return { teamKey, tally, average };
  });

  entries.sort((a, b) => {
    if (a.average !== b.average) return b.average - a.average;
    return compareTeamNumberTiebreak(a.teamKey, b.teamKey, teamNumberByKey);
  });

  entries.forEach((entry, index) => {
    rows.set(entry.teamKey, {
      record: { wins: entry.tally.wins, losses: entry.tally.losses, ties: entry.tally.ties },
      rp: roundTo(entry.average, ROUNDING_RULE.rankingPoints),
      rank: index + 1,
    });
  });

  return { ranked: true, rows };
}

/**
 * `teams` with each row in the counted pool carrying its counted standing, and
 * the `standings` marker the artifact publishes to say so.
 *
 * `teams` comes back as the SAME ARRAY REFERENCE, and `standings` as
 * `undefined`, when there is nothing to apply — no derivation
 * (`deriveEventStandings` returned `undefined`), or a records-only result that
 * would sit beside a rank frozen at publish time. That second case is
 * deliberate: a freshly counted record beside a stale published rank is
 * internally inconsistent, so the rows are left untouched rather than partially
 * patched, and the marker must then stay absent too — an artifact whose
 * standings are still TBA's must never claim otherwise.
 *
 * A `teams[]` row not in the derived pool is left untouched. Nothing is
 * mutated. Rows keep their positions, so a tick never reorders the standings
 * table — `rank` is a field on the row, never the row's index.
 */
export function withCountedStandings<T extends StandingsTeamRow>(params: {
  readonly matches: readonly StandingsMatchRow[];
  readonly teams: readonly T[];
  readonly rpOutcomeRp?: { readonly win: number; readonly tie: number };
}): { readonly teams: readonly T[]; readonly standings?: EventStandingsMarker } {
  const derived = deriveEventStandings(params);
  if (derived === undefined) return { teams: params.teams };

  const alreadyPublishedRank = params.teams.some((team) => team.rank !== undefined);
  if (!derived.ranked && alreadyPublishedRank) return { teams: params.teams };

  const teams = params.teams.map((team) => {
    const row = derived.rows.get(team.teamKey);
    if (row === undefined) return team;
    return derived.ranked ? { ...team, record: row.record, rp: row.rp, rank: row.rank } : { ...team, record: row.record };
  });
  return { teams, standings: { source: "tick-counted", ranked: derived.ranked } };
}
