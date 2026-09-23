import type {
  SimMatchInput,
  SimMatchOutcomeInput,
  SimTeamBaseline,
} from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { mergeEventMatches, isQualCompLevel, type EventMatchRow } from "../components/event/eventMatchAxis.js";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The pure assembly layer between a parsed event artifact and
 * `simulateRanks` (rankSimulation.ts): which qualification rows are
 * "remaining" from a chosen start match, and what each team has already
 * earned going into that start match. No React import, no Web Worker, no
 * call to `simulateRanks` anywhere in this file — it only assembles that
 * function's future arguments.
 */

/** The number of Monte Carlo draws every simulation run performs. Every render site (picker hint, in-progress counter, completion summary) imports this constant rather than retyping the digits. */
export const SIMULATION_DRAWS = 1000;

/**
 * The four paths a team's already-earned-RP baseline can take, recorded per
 * team so a disagreement between the two arithmetic paths is attributable —
 * the two must never be described as if they were the same computation.
 *
 * - `ranking-score-with-record` — TBA's `rp` (Ranking Score), converted to a
 *   total using TBA's own reported `record` as the denominator.
 * - `ranking-score-with-appearances` — the same conversion, falling back to
 *   this team's counted prefix appearances because `record` was absent.
 * - `summed-actual-rp` — no Ranking Score was usable: the sum of this team's
 *   own per-match actual RP across the played qualification rows strictly
 *   before the start.
 * - `no-played-matches` — zero played qualification appearances before the
 *   start; baseline is 0 and 0 regardless of whether `rp` is present.
 */
export type BaselineSource =
  | "ranking-score-with-record"
  | "ranking-score-with-appearances"
  | "summed-actual-rp"
  | "no-played-matches";

/** The complete, assembled input to one `simulateRanks` call, plus the two honesty gaps that must be disclosed rather than absorbed silently. */
export interface SimulationInputs {
  readonly startMatchKey: string;
  /** True when any qualification row at or after the start index is played — not merely the start row's own `played` flag. See `isRewindStart`'s own doc comment for why the two differ. */
  readonly isRewindStart: boolean;
  readonly remainingMatches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  /** Qualification rows at or after the start that carried no usable pmf pair — excluded from `remainingMatches`, never given a fabricated distribution. Sorted for a stable order. */
  readonly excludedMatchKeys: readonly string[];
  /** Team keys whose prefix baseline was built from at least one `null` actual-RP value — the sum and count both exclude that match, so the baseline is known-incomplete rather than silently depressed. Sorted for a stable order. */
  readonly incompleteBaselineTeamKeys: readonly string[];
  /** Per-team provenance for the baseline above — see `BaselineSource`. */
  readonly baselineSources: ReadonlyMap<string, BaselineSource>;
}

/**
 * Every `qm` row at the event, drawn from `matches[]` and `upcoming[]`
 * together, in `compareEventMatchRows` order (a key present in both arrays
 * collapses to the played row) — the SAME ordering source
 * `StartMatchPicker.tsx` renders from, so the picker's displayed order and
 * this module's sliced order never disagree.
 */
export function buildQualRows(artifact: EventArtifact): EventMatchRow[] {
  return mergeEventMatches(artifact.matches, artifact.upcoming, isQualCompLevel);
}

/** The index of the row whose `matchKey` matches `startMatchKey`, or -1 when absent. */
export function findStartIndex(rows: readonly EventMatchRow[], startMatchKey: string): number {
  return rows.findIndex((row) => row.matchKey === startMatchKey);
}

/**
 * "Rewind" means "at least one played qualification row lies at or after the
 * start," not "the selected row is played." The two agree on every ordinary
 * event, but `compareEventMatchRows` can order an unplayed row ahead of a
 * played one, so the start row's own `played` flag alone would miss that
 * shape — and miss the case where a later match's stored prediction absorbed
 * a result the simulation is pretending has not happened yet.
 */
export function isRewindStart(rows: readonly EventMatchRow[], startIndex: number): boolean {
  for (let i = startIndex; i < rows.length; i++) {
    if (rows[i]!.played) return true;
  }
  return false;
}

/**
 * The `matchKey` of the first genuinely-unplayed row, or `null` when every
 * row is played (the common case) or the list is empty. A rewind default the
 * reader did not choose would be an unexplained starting point, so no
 * default is offered there.
 */
export function defaultStartMatchKey(rows: readonly EventMatchRow[]): string | null {
  // A running event defaults to where the event actually is — the first
  // match that has not been played, so the default run simulates exactly the
  // remaining schedule.
  const firstUnplayed = rows.find((candidate) => !candidate.played);
  if (firstUnplayed) return firstUnplayed.matchKey;
  // A finished event has no unplayed match; it defaults to the first
  // qualification match, so a completed event opens on a full-event rewind.
  return rows[0]?.matchKey ?? null;
}

type RawQualRow = EventArtifact["matches"][number] | EventArtifact["upcoming"][number];

/**
 * A `matchKey` -> raw-row index over the qualification rows, applying the
 * same played-supersedes-scheduled collapse `mergeEventMatches` applies.
 * Exists because `EventMatchRow` deliberately carries no pmf pair or
 * actual-RP pair — this module needs both and the shared row type does not
 * carry them.
 */
function buildRawQualRowIndex(artifact: EventArtifact): Map<string, RawQualRow> {
  const raw = new Map<string, RawQualRow>();
  for (const match of artifact.upcoming) {
    if (!isQualCompLevel(match.compLevel)) continue;
    raw.set(match.matchKey, match);
  }
  for (const match of artifact.matches) {
    if (!isQualCompLevel(match.compLevel)) continue;
    raw.set(match.matchKey, match);
  }
  return raw;
}

/**
 * True for a played row. Discriminates on `actualWinner` — required on
 * every `EventMatchSchema` row and structurally absent from
 * `EventUpcomingMatchSchema` — never on the optional `actualRedRp` pair: a
 * pre-republish artifact's played rows carry `actualWinner` but not
 * `actualRedRp`, and keying on the optional field would silently reclassify
 * them as upcoming. On such rows `actualRedRp` reads `undefined`, which
 * `accumulateAlliance` treats as an appearance with unknowable RP credit
 * (known-incomplete).
 */
function isPlayedRawRow(row: RawQualRow): row is EventArtifact["matches"][number] {
  return "actualWinner" in row;
}

/**
 * Assembles the complete, honest input to one `simulateRanks` call for a
 * chosen start match, or `null` when `startMatchKey` is not among this
 * event's qualification rows — never a thrown error, never a guess at a
 * neighbouring match.
 *
 * The unit conversion this function exists to get right: `EventTeamSchema.rp`
 * is TBA's Ranking Score, a per-match average, while `SimTeamBaseline
 * .earnedRpSum` is a total. `rp` is multiplied by TBA's own played-match
 * denominator (already surrogate/DQ-adjusted) and rounded to the nearest
 * integer — a recovery, not a tolerance: `rp` is rounded once at publish to 2
 * decimals, so `rp * denominator` differs from the true integer total by at
 * most `0.005 * denominator`, and rounding the product recovers that integer
 * exactly for any denominator under 100 (far above a real qualification
 * schedule).
 *
 * The two baseline precedence paths are not the same computation: the
 * Ranking Score path reconstructs a total from TBA's adjusted average; the
 * summed-actual-RP path (used only where TBA published no Ranking Score)
 * reproduces none of that adjustment. Never describe the two as
 * interchangeable.
 */
export function buildSimulationInputs(artifact: EventArtifact, startMatchKey: string): SimulationInputs | null {
  const rows = buildQualRows(artifact);
  const startIndex = findStartIndex(rows, startMatchKey);
  if (startIndex === -1) return null;

  const rawIndex = buildRawQualRowIndex(artifact);
  const rewind = isRewindStart(rows, startIndex);

  // Step 1: the remaining set — every row from the start index onward,
  // excluded only when it carries no usable pmf pair. Never a fabricated
  // distribution.
  const remainingMatches: SimMatchInput[] = [];
  const excludedMatchKeys: string[] = [];
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i]!;
    const indexed = rawIndex.get(row.matchKey);
    // Every indexed row — played or upcoming — is priced by construction since
    // quick task 260923-3w7: `EventMatchSchema` and `EventUpcomingMatchSchema`
    // both require the four prediction fields, and the schedule-only shape the
    // live Worker wrote between 260915-isq and 260923-3w6 is gone. A row still
    // falls into `excludedMatchKeys` when it carries no usable pmf PAIR, which
    // is a different and still-real condition (an OPR/EPA artifact, or one
    // published before the pmf fields existed).
    const raw = indexed;
    const redPmf = raw?.redRpPmf;
    const bluePmf = raw?.blueRpPmf;
    if (redPmf !== undefined && redPmf.length > 0 && bluePmf !== undefined && bluePmf.length > 0) {
      // A row enters `remainingMatches` on its total-pmf pair alone.
      // `outcome` is attached additionally, only when the complete
      // decomposition is present; requiring it for inclusion would empty
      // `remainingMatches` for every event published before a full republish.
      const outcomePmf = raw?.matchOutcomePmf;
      const redBonusRpPmf = raw?.redBonusRpPmf;
      const blueBonusRpPmf = raw?.blueBonusRpPmf;
      const outcome: SimMatchOutcomeInput | undefined =
        outcomePmf !== undefined &&
        outcomePmf.length > 0 &&
        redBonusRpPmf !== undefined &&
        redBonusRpPmf.length > 0 &&
        blueBonusRpPmf !== undefined &&
        blueBonusRpPmf.length > 0 &&
        artifact.rpOutcomeRp !== undefined
          ? {
              outcomePmf,
              // Order is [red win, tie, blue win], per EventMatchSchema
              // .matchOutcomePmf's doc comment in pageArtifacts.ts.
              redOutcomeRp: [artifact.rpOutcomeRp.win, artifact.rpOutcomeRp.tie, 0],
              blueOutcomeRp: [0, artifact.rpOutcomeRp.tie, artifact.rpOutcomeRp.win],
              redBonusRpPmf,
              blueBonusRpPmf,
            }
          : undefined;
      remainingMatches.push({
        redTeamKeys: row.redTeams,
        blueTeamKeys: row.blueTeams,
        redRpPmf: redPmf,
        blueRpPmf: bluePmf,
        ...(outcome !== undefined ? { outcome } : {}),
      });
    } else {
      excludedMatchKeys.push(row.matchKey);
    }
  }

  // The prefix accumulation: every played row strictly before the start
  // index, walked once per alliance. `appearances` tracks every team that
  // showed up regardless of whether its actual RP was recorded; `counted`/
  // `sum` track only the matches whose actual RP was a real number.
  const prefixAppearances = new Map<string, number>();
  const prefixCounted = new Map<string, number>();
  const prefixSum = new Map<string, number>();
  const incompleteTeamKeys = new Set<string>();

  const accumulateAlliance = (teamKeys: readonly string[], actualRp: number | null | undefined): void => {
    for (const teamKey of teamKeys) {
      prefixAppearances.set(teamKey, (prefixAppearances.get(teamKey) ?? 0) + 1);
      if (typeof actualRp === "number") {
        prefixSum.set(teamKey, (prefixSum.get(teamKey) ?? 0) + actualRp);
        prefixCounted.set(teamKey, (prefixCounted.get(teamKey) ?? 0) + 1);
      } else {
        // `null` or `undefined`: the appearance is real but its RP credit is
        // unknowable from these bytes, so the baseline is known-incomplete
        // rather than quietly 0.
        incompleteTeamKeys.add(teamKey);
      }
    }
  };

  for (let i = 0; i < startIndex; i++) {
    const row = rows[i]!;
    if (!row.played) continue;
    const raw = rawIndex.get(row.matchKey);
    if (raw === undefined || !isPlayedRawRow(raw)) continue;
    accumulateAlliance(row.redTeams, raw.actualRedRp);
    accumulateAlliance(row.blueTeams, raw.actualBlueRp);
  }

  // Every team referenced by a simulated match, plus every rostered team,
  // gets a baseline — makes `simulateRanks`' UnknownTeamKeyError unreachable
  // in front of a visitor.
  const teamsByKey = new Map(artifact.teams.map((team) => [team.teamKey, team]));
  const allTeamKeys = new Set<string>(teamsByKey.keys());
  for (const match of remainingMatches) {
    for (const teamKey of match.redTeamKeys) allTeamKeys.add(teamKey);
    for (const teamKey of match.blueTeamKeys) allTeamKeys.add(teamKey);
  }

  const baselines: SimTeamBaseline[] = [];
  const baselineSources = new Map<string, BaselineSource>();

  for (const teamKey of allTeamKeys) {
    const appearances = prefixAppearances.get(teamKey) ?? 0;

    // Zero played prefix appearances, regardless of `rp`.
    if (appearances === 0) {
      baselines.push({ teamKey, earnedRpSum: 0, matchesPlayed: 0 });
      baselineSources.set(teamKey, "no-played-matches");
      continue;
    }

    const team = teamsByKey.get(teamKey);

    // Scoped to the quantity it actually answers: only when no played
    // qualification row lies at or after the start does end-of-event Ranking
    // Score describe "RP as of the start match."
    if (!rewind && team?.rp !== undefined) {
      const hasRecord = team.record !== undefined;
      const denominator = hasRecord ? team.record!.wins + team.record!.losses + team.record!.ties : appearances;
      baselines.push({
        teamKey,
        earnedRpSum: Math.round(team.rp * denominator),
        matchesPlayed: denominator,
      });
      baselineSources.set(teamKey, hasRecord ? "ranking-score-with-record" : "ranking-score-with-appearances");
      continue;
    }

    // The summed fallback, used both for a genuine rewind start and for an
    // event where TBA published no Ranking Score at all.
    baselines.push({
      teamKey,
      earnedRpSum: prefixSum.get(teamKey) ?? 0,
      matchesPlayed: prefixCounted.get(teamKey) ?? 0,
    });
    baselineSources.set(teamKey, "summed-actual-rp");
  }

  excludedMatchKeys.sort();
  const incompleteBaselineTeamKeys = [...incompleteTeamKeys].sort();

  return {
    startMatchKey,
    isRewindStart: rewind,
    remainingMatches,
    baselines,
    excludedMatchKeys,
    incompleteBaselineTeamKeys,
    baselineSources,
  };
}
