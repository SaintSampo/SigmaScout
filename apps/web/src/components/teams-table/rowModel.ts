/**
 * Pure row construction, ranking, win-rate derivation and the deterministic
 * sort for the Teams table (Task 1, 05-06-PLAN.md). Imports no React and no
 * TanStack anything — this file is a plain data transform over the published
 * `TeamsArtifact` (`packages/harness/pageArtifacts.ts`'s teams-table row),
 * consumed by `columns.tsx`/`TeamsTable.tsx` (Task 2) and `routes/teams.tsx`
 * (Task 3).
 *
 * 260902-pbe: on the WIRE, a row's `metrics` may be encoded positionally (an
 * array aligned to the artifact's top-level `metricKeys` list) rather than
 * the keyed record shown below — this file never sees that shape. Decoding
 * both the positional form and the pre-existing (pre-republish) object form
 * back to the one canonical `Record<string, TeamMetric>` happens once, in
 * `pageArtifacts.ts`'s `TeamsArtifactSchema` itself (a `.transform()` on the
 * wire schema), before `fetchTeamsArtifact` ever returns. `TeamMetrics`
 * below is that decoded shape — nothing in this file changed for the
 * positional encoding to exist.
 *
 * Nothing here derives a statistic the artifact does not carry beyond
 * NAV-06's own permitted class of presentation arithmetic. `winRate` is
 * arithmetic over three published integers; as of 2026-09-04 (quick task
 * 260904-5zg, D-2/D-3/D-4), `row.metrics` is ALSO no longer purely "exactly
 * as published" — `withDerivedGroupMetrics` (lib/metricGroups.ts) adds a
 * value-only `phaseAuto`/`phaseTeleop`/`phaseEndgame` entry, summed from
 * PUBLISHED component values, for any algorithm that has components but no
 * published group metric (EPA today). It is the same class of arithmetic
 * `winRate` already performs here — exact, never defaulting, rounding or
 * rescaling an input — and it NEVER overwrites a published group entry
 * (VPR's honest, covariance-derived spread/percentile survive untouched).
 * Ranking still keys off `TOTAL_KEY`, which no derivation ever touches, so
 * ranking itself is unaffected.
 */
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import { compareTeamsByTotal } from "../../../../../packages/harness/teamRanks.js";
import { withDerivedGroupMetrics } from "../../lib/metricGroups.js";
import { isRealTeamKey } from "../../lib/teamKey.js";
import type { Tier } from "../../lib/tiers.js";

export type TeamRecord = TeamsArtifact["teams"][number]["record"];
export type TeamMetrics = TeamsArtifact["teams"][number]["metrics"];
export type SortDirection = "asc" | "desc";

/**
 * One Teams-table row, derived once per artifact load. `rank` is computed
 * here — the team's position ordered by the total metric descending with
 * ascending team number as the tie-break — and is NEVER recomputed by
 * `sortTeamRows`. That choice makes rank a stable property of the
 * algorithm-and-year pair: sorting by a component column changes the row
 * ORDER without renumbering anyone, matching the behaviour this table's
 * users already expect from comparable FRC tools.
 *
 * Quick task 260905-ldu: the ranking rule itself now lives in
 * `packages/harness/teamRanks.ts`'s `compareTeamsByTotal` — the SAME
 * comparator the offline pipeline uses to publish each team's World rank
 * card. A single shared implementation is what makes this table's rank and
 * the published per-team World rank incapable of disagreeing.
 */
export interface TeamRow {
  teamKey: string;
  teamNumber: number;
  nickname: string;
  record: TeamRecord;
  /** Zero-to-one fraction, or `null` when the record's three counts sum to zero — a rate over zero matches is undefined, never a coerced zero. */
  winRate: number | null;
  /** The published metrics record, exactly as fetched — a key the declared set contains but this row lacks is simply absent here, never defaulted. */
  metrics: TeamMetrics;
  /**
   * This team's SWING SCORE, published per row since 2026-09-08. The ONLY
   * quantity the Total column may render as a `±` — the metrics above also
   * carry the algorithm's own `spread`, which must never reach the screen.
   * Absent for a team with fewer than two played matches.
   */
  sigmaScore?: number;
  /**
   * Quick task 260909-tgf: the Swing column's rarity tier, sourced from the
   * published `swing` metric entry (`SWING_METRIC_KEY` in `team.metrics`),
   * NEVER derived here from `swingScore`. `undefined` means the pipeline has
   * not ranked this team's swing at all (a pre-republish artifact, or a
   * live-worker-rebuilt row) — see `buildTeamRows`'s own comment for the
   * two-branch distinction that produces this value.
   */
  sigmaTier?: Tier;
  rank: number;
}

/**
 * `winRate(record)`: the fraction of matches won, or `null` when the three
 * counts sum to zero. Returns the raw fraction — percentage formatting is
 * the column's business, not this model's. The null case is the one this
 * project would otherwise ship as a not-a-number, because a zero-match team
 * is not a hypothetical in a real season.
 */
export function winRate(record: TeamRecord): number | null {
  const totalMatches = record.wins + record.losses + record.ties;
  if (totalMatches === 0) return null;
  return record.wins / totalMatches;
}

/** Ascending team-number comparator — the one deterministic tie-break both `buildTeamRows`'s ranking and `sortTeamRows` share, so re-sorts, reloads and algorithm switches always land on the same row order. */
function byTeamNumberAscending(a: { teamNumber: number }, b: { teamNumber: number }): number {
  return a.teamNumber - b.teamNumber;
}

/**
 * Reserved sort key for the win-rate column (Task 2, 05-06-PLAN.md — "sortable
 * for every metric column plus win rate"). Not a metric key: win rate lives on
 * `TeamRow.winRate`, never inside the published `metrics` record, so
 * `sortTeamRows` special-cases this one string sentinel to read that field
 * instead of indexing `metrics`. `columns.tsx`'s win-rate column id and any
 * caller's "valid sort keys" set both reference this same constant, never a
 * re-typed literal.
 */
export const WIN_RATE_SORT_KEY = "winRate";

/**
 * Quick task 260909-tgf: `TeamRow.swingTier`'s two-branch derivation, pulled
 * into its own function with an explicit `Tier | undefined` return type so
 * the `"common"` fallback keeps its literal type rather than widening to
 * plain `string` inside the larger object-literal `.map()` in `buildTeamRows`
 * below (a bare inline `?? "common"` there loses the literal union under
 * this file's `noUncheckedIndexedAccess`/`verbatimModuleSyntax` config).
 */
function deriveSigmaTier(entry: { tier?: "rare" | "epic" | "legendary" } | undefined): Tier | undefined {
  if (entry === undefined) return undefined;
  return entry.tier ?? "common";
}

/** The numeric value `sortTeamRows` compares for a given row and key — `TeamRow.winRate` for the reserved sentinel, otherwise the published metric's value. A `null` win rate (zero-match team) is treated as absent for sorting purposes, same as a missing metric key. */
function sortValueFor(row: TeamRow, key: string): number | undefined {
  if (key === WIN_RATE_SORT_KEY) {
    return row.winRate ?? undefined;
  }
  return row.metrics[key]?.value;
}

/**
 * `buildTeamRows(artifact, algorithmId)`: maps each published row to a
 * `TeamRow`, computing `winRate` and `rank` once. `algorithmId` is part of
 * this function's contract (mirroring `columns.tsx`'s `buildColumns`) even
 * though ranking itself is algorithm-agnostic — every algorithm guarantees
 * `TOTAL_KEY` (D-27), so the total metric is always the correct ranking
 * axis regardless of which algorithm produced the artifact.
 */
export function buildTeamRows(artifact: TeamsArtifact, algorithmId: string): TeamRow[] {
  void algorithmId; // reserved for signature symmetry with buildColumns; ranking itself is algorithm-agnostic (see doc comment above)
  // Non-real team keys are dropped BEFORE ranking (2026-09-01) — see
  // `lib/teamKey.ts`'s `isRealTeamKey` for what they are and why. Filtering
  // here rather than at render is what keeps `rank` honest: an offseason
  // B-team held rank 3 of all 2024, pushing every real team below it down
  // one place.
  const unranked = artifact.teams.filter((team) => isRealTeamKey(team.teamKey)).map((team) => ({
    teamKey: team.teamKey,
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    record: team.record,
    winRate: winRate(team.record),
    // Quick task 260909-tgf: TWO BRANCHES, deliberately kept separate --
    // this is the single most "fixable-back-to-wrong" line in this file.
    //
    // Branch 1 (entry present): the published `swing` metric entry
    // (`SWING_METRIC_KEY` in `team.metrics`) IS the source of truth for both
    // the value and the tier. `entry.tier ?? "common"` is correct HERE
    // because the entry's PRESENCE proves the pipeline ranked this team's
    // swing -- Common is omitted from the wire purely for size (the same
    // argument `columns.tsx`'s existing metric cells already make), so its
    // absence on a present entry means "ranked, Common tier," never
    // "unranked."
    //
    // Branch 2 (entry absent): falls back to the top-level `swingFactor`
    // field for the VALUE only, and `swingTier` stays UNDEFINED. The entry
    // can be absent for two reasons -- a pre-republish artifact (this
    // task's own commit, before the developer's `pnpm publish:seasons`
    // run) or a live-worker-rebuilt row (`apps/worker/src/scheduled.ts`
    // writes only the top-level field and computes no percentiles at all)
    // -- and in NEITHER case does the pipeline know this team's tier.
    // Coalescing to `"common"` here would be a positive false claim about a
    // team the pipeline has not actually ranked.
    // SIGMA SCORE, from the published `sigma` metric entry and NOTHING ELSE.
    //
    // The old `?? team.swingFactor` fallback is deliberately GONE. That field
    // still exists on OPR/EPA rows and on any pre-republish BPR row, and it
    // holds a SWING FACTOR — a different estimator on a different scale
    // (Swing prints 1.92 sigma, Sigma prints an honest 1 sigma, so the same
    // robot reads roughly twice as large under Swing). Falling back to it
    // would print a Swing number under a "Sigma" heading, which is not a
    // degraded answer but a wrong one.
    //
    // The consequence is intended: until the pipeline republishes, and for
    // every algorithm outside `SIGMA_SCORE_ALGORITHM_IDS`, this is `undefined`
    // and the column renders nothing.
    sigmaScore: team.metrics[SIGMA_METRIC_KEY]?.value,
    sigmaTier: deriveSigmaTier(team.metrics[SIGMA_METRIC_KEY]),
    // Published metrics widened with any derivable group entries this
    // algorithm/season combination supports (D-2/D-3/D-4) — see this
    // module's own header comment. `sortValueFor` reads `row.metrics[key]`
    // directly, so a derived `phaseAuto` is sortable exactly like a
    // published one.
    metrics: withDerivedGroupMetrics(team.metrics, artifact.season),
  }));

  // Quick task 260905-ldu: `compareTeamsByTotal` (shared with
  // `packages/harness/publish.ts`'s published World rank) replaces the
  // total-descending sort body that used to live here inline.
  const ranked = [...unranked].sort(compareTeamsByTotal);

  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * `sortTeamRows(rows, key, direction)`: sorts by the metric value at `key`,
 * placing rows missing that key last REGARDLESS of direction, with ascending
 * team number as the final tie-break so the result is a total order — the
 * same order every time, without relying on the engine's sort-stability
 * guarantee. Never touches `rank`: rank is a property of the artifact, not
 * of the current sort.
 */
export function sortTeamRows(rows: readonly TeamRow[], key: string, direction: SortDirection): TeamRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA = sortValueFor(a, key);
    const valueB = sortValueFor(b, key);
    if (valueA === undefined && valueB === undefined) return byTeamNumberAscending(a, b);
    if (valueA === undefined) return 1;
    if (valueB === undefined) return -1;
    if (valueA !== valueB) return sign * (valueA - valueB);
    return byTeamNumberAscending(a, b);
  });
}
