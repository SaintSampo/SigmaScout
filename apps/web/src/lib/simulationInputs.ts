import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";
import type { SimMatchInput, SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { mergeEventMatches, isQualCompLevel, type EventMatchRow } from "../components/event/eventMatchAxis.js";

/**
 * The pure assembly layer between a parsed event artifact and 08-03's
 * `simulateRanks` core (08-11-PLAN.md Task 1). Answers the two questions
 * `rankSimulation.ts` deliberately refused to own: which qualification rows
 * are "remaining" from a chosen start match (D-13), and what each team has
 * already earned going into that start match (D-12). No React import, no
 * Web Worker, no call to `simulateRanks` anywhere in this file — it only
 * assembles that function's future arguments.
 */

/**
 * The number of Monte Carlo draws every simulation run performs. This exact
 * value has FOUR render sites across the phase: the Copywriting Contract's
 * picker hint (`START_MATCH_PICKER_HINT`, `StartMatchPicker.tsx`), this
 * module's own scope-line text (`simulationScopeText`), and 08-13's
 * in-progress counter and completion summary. Every one of those sites
 * imports this constant rather than retyping the digits, so a future change
 * to the draw count cannot land in three places and miss a fourth.
 */
export const SIMULATION_DRAWS = 1000;

/**
 * The four paths a team's already-earned-RP baseline can take, recorded per
 * team so a disagreement between the two arithmetic paths is attributable
 * rather than anonymous (D-12's own "the two paths must never be described
 * as if they were the same computation").
 *
 * - `ranking-score-with-record` — TBA's `rp` (Ranking Score), converted to a
 *   total using TBA's own reported `record` as the denominator (PD-02).
 * - `ranking-score-with-appearances` — the same conversion, falling back to
 *   this team's counted prefix APPEARANCES as the denominator because
 *   `record` was absent (PD-02's documented second fallback).
 * - `summed-actual-rp` — no Ranking Score was usable for this quantity (D-12
 *   rule 2): the sum of this team's own per-match actual RP across the
 *   played qualification rows strictly before the start.
 * - `no-played-matches` — this team has zero played qualification
 *   appearances before the start (D-12 rule 3); its baseline is 0 and 0
 *   regardless of whether `rp` happens to be present.
 */
export type BaselineSource =
  | "ranking-score-with-record"
  | "ranking-score-with-appearances"
  | "summed-actual-rp"
  | "no-played-matches";

/** The complete, assembled input to one `simulateRanks` call, plus the two honesty gaps D-12/D-13 require to be disclosed rather than absorbed silently. */
export interface SimulationInputs {
  readonly startMatchKey: string;
  /** PD-08: true when any qualification row at or after the start index is played — not merely the start row's own `played` flag. See `isRewindStart`'s own doc comment for why the two differ. */
  readonly isRewindStart: boolean;
  readonly remainingMatches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  /** Qualification rows at or after the start that carried no usable pmf pair (D-12 PD-05) — excluded from `remainingMatches`, never given a fabricated distribution. Sorted for a stable order. */
  readonly excludedMatchKeys: readonly string[];
  /** Team keys whose prefix baseline was built from at least one `null` actual-RP value (PD-04) — the sum and count both exclude that match, so the baseline is known-incomplete rather than silently depressed. Sorted for a stable order. */
  readonly incompleteBaselineTeamKeys: readonly string[];
  /** Per-team provenance for the baseline above — see `BaselineSource`. */
  readonly baselineSources: ReadonlyMap<string, BaselineSource>;
}

/**
 * Every `qm` row at the event, drawn from `matches[]` and `upcoming[]`
 * together, in `compareEventMatchRows` order (a key present in both arrays
 * collapses to the played row). This is the SAME ordering source
 * `StartMatchPicker.tsx` renders from, because a picker that displays one
 * order while this module slices a different one would take the reader's
 * chosen index and simulate a different set of matches than the one shown.
 */
export function buildQualRows(artifact: EventArtifact): EventMatchRow[] {
  return mergeEventMatches(artifact.matches, artifact.upcoming, isQualCompLevel);
}

/** The index of the row whose `matchKey` matches `startMatchKey`, or -1 when absent. */
export function findStartIndex(rows: readonly EventMatchRow[], startMatchKey: string): number {
  return rows.findIndex((row) => row.matchKey === startMatchKey);
}

/**
 * PD-08: "rewind" is defined as "at least one played qualification row lies
 * at or after the start," not as "the selected row is played." The two
 * agree on every ordinary event, but `compareEventMatchRows` can order an
 * unplayed row ahead of a played one (its own leading timestamp-presence
 * split), so the start row's own `played` flag alone would miss that shape.
 * The condition this predicate names is the one that actually creates D-01's
 * overconfidence problem: a later match's stored prediction absorbed a
 * result the simulation is pretending has not happened yet.
 */
export function isRewindStart(rows: readonly EventMatchRow[], startIndex: number): boolean {
  for (let i = startIndex; i < rows.length; i++) {
    if (rows[i]!.played) return true;
  }
  return false;
}

/**
 * The `matchKey` of the first genuinely-unplayed row, or `null` when every
 * row is played (the common case — 41 of 1,353 corpus events have any
 * unplayed qualification match at all) or the list is empty. A rewind
 * default the reader did not choose would be an unexplained starting point
 * on the other 97%, so no default is offered there.
 */
export function defaultStartMatchKey(rows: readonly EventMatchRow[]): string | null {
  const row = rows.find((candidate) => !candidate.played);
  return row ? row.matchKey : null;
}

type RawQualRow = EventArtifact["matches"][number] | EventArtifact["upcoming"][number];

/**
 * A `matchKey` -> raw-row index over the qualification rows of
 * `artifact.matches`/`artifact.upcoming`, applying the SAME
 * played-supersedes-scheduled collapse `mergeEventMatches` applies (upcoming
 * rows loaded first, played rows loaded second so a shared key resolves to
 * the played row). This index exists because `EventMatchRow` deliberately
 * carries no pmf pair or actual-RP pair (08-09's PD-05) — those two fields
 * are what this module needs and `eventMatchAxis.ts`'s shared row type does
 * not carry.
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

/** True for a played row's `actualRedRp`/`actualBlueRp`: `EventUpcomingMatchSchema` carries no such field at all, so an upcoming row is structurally never asked this question. */
function isPlayedRawRow(row: RawQualRow): row is EventArtifact["matches"][number] {
  return "actualRedRp" in row;
}

/**
 * Assembles the complete, honest input to one `simulateRanks` call for a
 * chosen start match, or `null` when `startMatchKey` is not among this
 * event's qualification rows (PD-06's resolve-to-none rule — never a thrown
 * error, never a guess at a neighbouring match).
 *
 * ---
 *
 * **The unit conversion this module exists to get right (PD-01/PD-02/PD-03,
 * 08-03's own PD-02).** `EventTeamSchema.rp` (`pageArtifacts.ts`'s own doc
 * comment) is TBA's Ranking Score, a per-match AVERAGE. `SimTeamBaseline
 * .earnedRpSum` (`rankSimulation.ts`'s own doc comment) is a TOTAL. A caller
 * that forwards the average unconverted mis-ranks the entire field by a
 * factor of each team's match count, and no test on either side of that
 * boundary would catch it alone — 08-03's tests pass on self-consistent
 * inputs and this module's own tests would pass on a plausible-looking map.
 * The conversion below is the one place that gap is closed: `rp` is
 * multiplied by TBA's own played-match denominator (D-12's own reason for
 * preferring rule 1 at all — that denominator already accounts for
 * surrogate appearances and disqualifications) and rounded to the nearest
 * integer.
 *
 * **The nearest-integer step is a recovery, not a tolerance.** `rp` is
 * rounded exactly once at the publish boundary, to `ROUNDING_RULE
 * .rankingPoints` (2 decimals), so `rp * denominator` differs from the true
 * integer total by at most `0.005 * denominator`. Every per-match RP value
 * is a non-negative integer (`actualRedRp`/`actualBlueRp` are
 * `z.number().int()`), so the true total is itself an integer, and rounding
 * the product to the nearest integer recovers it EXACTLY whenever the error
 * is under 0.5 — true for any denominator below 100, far above any real FRC
 * qualification schedule.
 *
 * **The two precedence paths are not the same computation (D-12, restated
 * here as a contract).** Rule 1 reconstructs an integer total from TBA's
 * surrogate- and DQ-adjusted average. Rule 2 sums this module's own
 * per-match actual-RP reads and reproduces none of that adjustment. Rule 2
 * is used only where TBA published no Ranking Score to disagree with, which
 * bounds but does not remove the exposure — the two must never be described,
 * in code or in copy, as interchangeable.
 *
 * **D-13's boundary.** This module reads no offseason, surrogate or
 * quarantine flag anywhere, because the event artifact carries none of
 * those (they live on the corpus `matches` table and the Compare artifact's
 * `exclusionCounts`). The only reason a qualification row at or after the
 * start is ever left out of `remainingMatches` is that it carries no
 * ranking-point distribution to draw from (PD-05) — an absence of data, not
 * a classification of the row.
 */
export function buildSimulationInputs(artifact: EventArtifact, startMatchKey: string): SimulationInputs | null {
  const rows = buildQualRows(artifact);
  const startIndex = findStartIndex(rows, startMatchKey);
  if (startIndex === -1) return null;

  const rawIndex = buildRawQualRowIndex(artifact);
  const rewind = isRewindStart(rows, startIndex);

  // Step 1: the remaining set (D-13) — every row from the start index
  // onward, excluded only when it carries no usable pmf pair (PD-05). Never
  // a fabricated distribution.
  const remainingMatches: SimMatchInput[] = [];
  const excludedMatchKeys: string[] = [];
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i]!;
    const raw = rawIndex.get(row.matchKey);
    const redPmf = raw?.redRpPmf;
    const bluePmf = raw?.blueRpPmf;
    if (redPmf !== undefined && redPmf.length > 0 && bluePmf !== undefined && bluePmf.length > 0) {
      remainingMatches.push({
        redTeamKeys: row.redTeams,
        blueTeamKeys: row.blueTeams,
        redRpPmf: redPmf,
        blueRpPmf: bluePmf,
      });
    } else {
      excludedMatchKeys.push(row.matchKey);
    }
  }

  // Step 2: the prefix accumulation (D-12) — every PLAYED row strictly
  // before the start index, walked once per alliance. `appearances` tracks
  // every team that showed up in a played prefix row regardless of whether
  // its actual RP was recorded; `counted`/`sum` track only the matches whose
  // actual RP was a real number (PD-04).
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
      } else if (actualRp === null) {
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

  // Step 3: every team referenced by a simulated match, PLUS every rostered
  // team, gets a baseline (RESEARCH assumption A2) — this is what makes
  // 08-03's UnknownTeamKeyError unreachable in front of a visitor.
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

    // D-12 rule 3: zero played prefix appearances, regardless of `rp`.
    if (appearances === 0) {
      baselines.push({ teamKey, earnedRpSum: 0, matchesPlayed: 0 });
      baselineSources.set(teamKey, "no-played-matches");
      continue;
    }

    const team = teamsByKey.get(teamKey);

    // D-12 rule 1, scoped by PD-01 to the quantity it actually answers: only
    // when no played qualification row lies at or after the start does
    // end-of-event Ranking Score describe "RP as of the start match."
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

    // D-12 rule 2: the summed fallback, used both for a genuine rewind start
    // and for an event where TBA published no Ranking Score at all.
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
