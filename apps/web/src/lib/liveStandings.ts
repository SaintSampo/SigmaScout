/**
 * BROWSER-DERIVED LIVE STANDINGS (260921-q2s): the one place a live event's
 * record/RP/rank are counted from played qualification rows, because the
 * Worker tick that folds those rows every minute never refetches TBA's
 * rankings — `teams[].rank`/`record`/`rp` stay frozen at publish time (or
 * absent entirely on a Worker-promoted stub event) while `matches[]` keeps
 * growing. The browser already polls the artifact every 60 s and already
 * holds every played qualification row, so it counts the standings itself.
 *
 * THE TRIGGER is `artifact.live !== undefined`, and ONLY that — never a
 * count-based heuristic. `EventLiveBlockSchema`'s own doc comment defines
 * `rows` as "one row per match folded since the last republish", and the
 * key is declared only on `LiveEventArtifactSchema` while the offline
 * publisher writes through `EventArtifactSchema`, which strips unknown
 * keys. So the key's presence is a precise, self-cleaning statement that
 * this artifact carries matches the published standings do not account
 * for, and a republish erases it with no timestamp comparison anywhere.
 * The alternative this file must NEVER be changed to use — comparing a
 * counted appearance total against the published record total, and
 * deriving when the counted total is larger — is UNSOUND: a surrogate
 * appearance makes the counted total exceed TBA's surrogate-adjusted
 * record total even on a finished, fully published event, so that
 * comparison would fire falsely across ordinary history.
 *
 * NO REACT HERE, and no import from `apps/web/src/components` — this is
 * the pure data layer `eventPricing.ts` (the artifact entry point) and
 * `InsightsTab.tsx` (the reader) both sit on top of.
 */
import type { LiveEventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/** The subset of `LiveEventArtifact` this derivation reads — every field is reached by indexed access off the harness type, never a new harness export. */
export type LiveStandingsInput = Pick<LiveEventArtifact, "live" | "matches" | "teams" | "rpOutcomeRp">;

type LiveMatchRow = LiveEventArtifact["matches"][number];

/** A team's counted win/loss/tie record over qualification rows only — see the module header for the scoping rule. */
export interface LiveStandingsRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/**
 * One team's counted standing. `rp`/`rank` are present only when the whole
 * result is `ranked` (see `LiveStandingsResult.ranked`) — a records-only
 * result never carries an invented rank.
 */
export interface LiveStandingsRow {
  readonly record: LiveStandingsRecord;
  readonly rp?: number;
  readonly rank?: number;
}

/**
 * `ranked` is false when `artifact.rpOutcomeRp` is absent, or when any
 * played qualification row is missing a numeric bonus RP for either
 * alliance — ranking points are all-or-nothing for the whole event (see
 * `deriveLiveEventStandings`'s doc comment). `rows` is keyed by team key
 * and covers the pool: the union of `artifact.teams` and every team key
 * appearing in a played qualification row.
 */
export interface LiveStandingsResult {
  readonly ranked: boolean;
  readonly rows: ReadonlyMap<string, LiveStandingsRow>;
}

/** The marker `withDerivedLiveStandings` stamps onto the returned artifact — never published, browser-derived only. */
export interface LiveStandingsMarker {
  readonly source: "live-derived";
  readonly ranked: boolean;
}

const TEAM_NUMBER_PATTERN = /^frc(\d+)$/;

/**
 * A locally guarded parse, deliberately NOT `teamKey.ts`'s
 * `teamNumberFromKey` — that function THROWS on a key that does not match
 * `frc{digits}`, and a letter-suffixed key such as `frc5199B` is real at
 * offseason events. Returns `undefined` for any key this pattern does not
 * match, rather than throwing.
 */
function guardedTeamNumberFromKey(teamKey: string): number | undefined {
  const match = TEAM_NUMBER_PATTERN.exec(teamKey);
  return match === null ? undefined : Number.parseInt(match[1]!, 10);
}

/** Prefers the team row's own published `teamNumber`, falls back to a guarded parse of the key. */
function resolveTeamNumber(teamKey: string, teamNumberByKey: ReadonlyMap<string, number | undefined>): number | undefined {
  const fromRow = teamNumberByKey.get(teamKey);
  if (fromRow !== undefined) return fromRow;
  return guardedTeamNumberFromKey(teamKey);
}

/**
 * The final tiebreak beyond the ranking-point average: ascending team
 * number when either side resolves one, a key with no resolvable number
 * sorting last, and ascending key string when neither side resolves one.
 *
 * Beyond the ranking-point average, our tiebreak is team number, so an
 * exact tie may order differently from TBA's official season tiebreakers,
 * which need score-breakdown fields this artifact does not carry. A played
 * row also carries no surrogate field and no disqualification field, so a
 * surrogate appearance is counted here where TBA excludes it, and a
 * disqualified team is credited its outcome ranking points where TBA
 * credits zero. Those are this derivation's two known divergences from
 * TBA's own published order; no field is invented to fix them.
 */
function compareTeamNumberTiebreak(aKey: string, bKey: string, teamNumberByKey: ReadonlyMap<string, number | undefined>): number {
  const aNumber = resolveTeamNumber(aKey, teamNumberByKey);
  const bNumber = resolveTeamNumber(bKey, teamNumberByKey);
  if (aNumber !== undefined && bNumber !== undefined) return aNumber - bNumber;
  if (aNumber !== undefined) return -1;
  if (bNumber !== undefined) return 1;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/** Mirrors `packages/harness/rounding.ts`'s `ROUNDING_RULE.rankingPoints` (2 decimals) — mirrored rather than imported, following `InsightsTab.tsx`'s own `INSIGHTS_RP_DECIMALS` precedent, because `rounding.ts`'s own header states that module is for building published artifacts, not for the client. A future change to `ROUNDING_RULE.rankingPoints` must be mirrored here. */
const LIVE_RP_ROUNDING_DECIMALS = 2;

function round(value: number): number {
  const factor = 10 ** LIVE_RP_ROUNDING_DECIMALS;
  return Math.round(value * factor) / factor;
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

function allianceOutcome(actualWinner: LiveMatchRow["actualWinner"], side: "red" | "blue"): "win" | "loss" | "tie" {
  if (actualWinner === "tie") return "tie";
  return actualWinner === side ? "win" : "loss";
}

/**
 * Counts each qualification-row team's record and (when the event's data
 * is complete enough to be honest about it) ranking-point average and rank,
 * from `artifact.matches` alone. Returns `undefined` when `artifact.live`
 * is undefined (see the module header for why that is the only trigger),
 * or when the artifact holds no played qualification row at all.
 *
 * Ranking points are ALL OR NOTHING for the whole event: the result is
 * `ranked` only when `artifact.rpOutcomeRp` is present AND every played
 * qualification row carries a numeric bonus RP for both alliances. A
 * `null` or absent bonus is a real gap in TBA's data and is never coerced
 * to zero, so a single gap makes the WHOLE result unranked (records only)
 * rather than producing a rank built on an invented zero.
 *
 * The ranking pool is the union of the team keys in `artifact.teams` and
 * the team keys appearing in a played qualification row. A pool member
 * with no appearance gets a zero record and, when ranked, zero ranking
 * points — it naturally sorts last since ranking points are never
 * negative.
 */
export function deriveLiveEventStandings(artifact: LiveStandingsInput): LiveStandingsResult | undefined {
  if (artifact.live === undefined) return undefined;

  const qualRows = artifact.matches.filter((row) => row.compLevel === "qm");
  if (qualRows.length === 0) return undefined;

  let ranked = artifact.rpOutcomeRp !== undefined;
  const rpOutcomeRp = artifact.rpOutcomeRp;

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
    // A played row carries no surrogate field and no disqualification
    // field (see the tiebreak's own doc comment for the consequence).
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
  for (const team of artifact.teams) tallyFor(team.teamKey);

  const rows = new Map<string, LiveStandingsRow>();

  if (!ranked) {
    for (const [teamKey, tally] of tallies) {
      rows.set(teamKey, { record: { wins: tally.wins, losses: tally.losses, ties: tally.ties } });
    }
    return { ranked: false, rows };
  }

  const teamNumberByKey = new Map<string, number | undefined>();
  for (const team of artifact.teams) teamNumberByKey.set(team.teamKey, team.teamNumber);

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
      rp: round(entry.average),
      rank: index + 1,
    });
  });

  return { ranked: true, rows };
}

/**
 * Applies `deriveLiveEventStandings` to `artifact.teams`, or returns the
 * SAME OBJECT REFERENCE when there is nothing to apply — no derivation
 * (`deriveLiveEventStandings` returned `undefined`), or a records-only
 * result that would sit beside a rank frozen at publish time. That second
 * case is deliberate: a freshly counted record beside a stale published
 * rank is internally inconsistent, so the whole artifact is left untouched
 * rather than partially patched.
 *
 * When it applies, every `teams[]` row not in the derived pool is left
 * untouched, `allianceTeams` is left untouched (those teams never took the
 * field and are not the standings pool), nothing is mutated, and a
 * `standings` marker is attached naming the source and whether the result
 * is ranked. Plain objects only, no `Map` and no class, so TanStack's
 * structural sharing keeps references stable across a 60 s poll that
 * changes nothing.
 */
export function withDerivedLiveStandings<T extends LiveStandingsInput>(artifact: T): T {
  const derived = deriveLiveEventStandings(artifact);
  if (derived === undefined) return artifact;

  const alreadyPublishedRank = artifact.teams.some((team) => team.rank !== undefined);
  if (!derived.ranked && alreadyPublishedRank) return artifact;

  const teams = artifact.teams.map((team) => {
    const row = derived.rows.get(team.teamKey);
    if (row === undefined) return team;
    return derived.ranked ? { ...team, record: row.record, rp: row.rp, rank: row.rank } : { ...team, record: row.record };
  });

  const standings: LiveStandingsMarker = { source: "live-derived", ranked: derived.ranked };

  // T is constrained to `LiveStandingsInput`'s four fields; `teams` stays
  // the same element shape and `standings` is the exact additive,
  // optional field `EventPageArtifact` (eventPricing.ts) declares for it —
  // a boundary-safe narrowing back to T, the same class of cast
  // `InsightsTab.tsx`'s own `algorithmId as PublishedAlgorithmId` already
  // uses for a value widened to a plain type crossing a module boundary.
  return { ...artifact, teams, standings } as T;
}
