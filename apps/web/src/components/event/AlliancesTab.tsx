/**
 * The Alliances tab: one row per published alliance in TBA's own seed
 * order, columns Alliance # / Captain / Pick 1 / Pick 2 / Pick 3 / Combined
 * Total / Record. This is the ONLY component in the application that
 * computes a number rather than rendering a published one. It is
 * legitimate here (unlike the identical move on Breakdown) because an
 * alliance's cross-team covariance is zero by the model's own construction
 * — no cross-team covariance model exists in this codebase, so there is
 * nothing to consult — whereas a component group's off-diagonal terms are
 * real and unpublished.
 *
 * Drops every nickname (team numbers only); pick-column indices map
 * directly to TBA's own `picks` array (index 1 is the FIRST additional
 * pick, not "Pick 2"); each pick carries its own tiered total metric; the
 * Combined Total carries a client-side approximate tier (the 3x heuristic,
 * `@/lib/allianceTierApproximation`); the published playoff Record column
 * renders alongside it.
 */
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import type { DisplayMetric } from "@/components/MetricValue";
import { TotalSigmaValue } from "@/components/TotalSigmaValue";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import { buildTeamValuePercentilePoints, estimateCombinedTier, type AllianceApproxTier } from "@/lib/allianceTierApproximation";
import type { EventPageArtifact } from "../../lib/eventPricing.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { allianceSigmaBandVariance, sigmaMatchBandVariance, SIGMA_METRIC_KEY, usesSigmaScore } from "../../../../../packages/harness/sigmaScore.js";

type EventTeam = EventPageArtifact["teams"][number];
type EventAlliance = NonNullable<EventPageArtifact["alliances"]>[number];

/**
 * Only the first three picks enter the combined arithmetic. A
 * fourth/backup pick is displayed on the row but excluded from the sum so
 * the column stays comparable across rows — an alliance with a backup and
 * one without would otherwise render two differently-sized sums under the
 * identical header.
 */
export const ALLIANCE_COMBINED_PICK_COUNT = 3;

/**
 * One alliance pick's own published total metric, as rendered — the same
 * `{value, spread}` `MetricValue` already consumes, widened with the
 * optional `percentile` `EventTeamSchema.metrics` also carries: this tab
 * tiers each pick's OWN total by its own exact published percentile, never
 * by the alliance's approximate combined one.
 */
interface AlliancePickTotal extends DisplayMetric {
  percentile?: number;
}

/**
 * One pick's own published Sigma Score — the same `{value, percentile}`
 * shape `AlliancePickTotal` carries, read from the team's own
 * `SIGMA_METRIC_KEY` metrics entry. `undefined` for every OPR/EPA pick and
 * for an SPR pick this event's artifact does not resolve one for.
 */
interface AlliancePickSigma {
  value: number;
  percentile?: number;
}

/**
 * One alliance pick, as rendered — identity fields never invented, `total`
 * left `undefined` when the artifact does not resolve one. There is no
 * name field on this interface at all (team numbers only).
 */
export interface AlliancePick {
  teamKey: string;
  teamNumber: number;
  total: AlliancePickTotal | undefined;
  /** This pick's own Sigma Score, rendered as the right half of its total's split pill (`TotalSigmaValue`). */
  sigma: AlliancePickSigma | undefined;
}

/** One alliance's row model. `combinable` mirrors whether `combined` is defined — one fact, not two independently-consulted ones. */
export interface AllianceRow {
  allianceNumber: number;
  picks: AlliancePick[];
  combined: DisplayMetric | undefined;
  combinable: boolean;
  /**
   * The 3x heuristic approximate tier for `combined` — `undefined` when
   * `combined` itself is `undefined`, or when this event publishes no team
   * with a percentile to interpolate against. NEVER an exact tier; see
   * `@/lib/allianceTierApproximation`'s header comment for the full method.
   */
  combinedApproxTier: AllianceApproxTier | undefined;
  /**
   * The neutral, untiered `±` for the Combined Total pill's Sigma half —
   * `sqrt(3 * (a^2 + b^2 + c^2))` over the first three picks' own Sigma
   * Scores, the SAME Match Band formula every SPR match row draws, computed
   * through the shipping `allianceSigmaBandVariance`/`sigmaMatchBandVariance`
   * helpers. ALL OR NOTHING, like `combined` itself: `undefined` unless
   * `combined` is defined AND every one of the first
   * `ALLIANCE_COMBINED_PICK_COUNT` picks carries a `sigma` entry — a partial
   * band would understate the alliance's true miss.
   */
  combinedSigma: number | undefined;
  /**
   * TBA's own reported playoff win-loss-tie record for this alliance,
   * sourced from `EventAllianceSchema.record`. `undefined` for an honest
   * absence (no playoff bracket has run yet, or an unrecognised
   * `playoff_type` shape) — never a fabricated `0-0-0`.
   */
  record: { wins: number; losses: number; ties: number } | undefined;
}

/**
 * `σ_alliance = √(σ₁² + σ₂² + σ₃²)` over the first three picks' published
 * totals — standard deviations are never added. Three robots at ±10 give
 * ±17.3, not ±30. The `spread` values summed here are total predictive
 * standard deviations (`√(P + R)`), not consistency values.
 *
 * All-or-nothing: returns `undefined` when ANY of the three entries is
 * absent — never a sum over the present subset. A partial sum would render
 * in the identical shape, column and precision as a complete one while
 * being roughly a third low, destroying cross-row comparability.
 *
 * The value's absence and the spread's absence are two independent rules
 * over the same cell: given a value, the ± renders only when all three
 * resolved entries publish a spread; otherwise the summed value renders
 * bare — two kinds of absence are never conflated. The square root is
 * applied exactly once, to the summed variances, never to an individual
 * term. No default of zero ever stands in for an absent published value —
 * that would make an alliance with a missing pick look catastrophically
 * weak rather than unknown.
 *
 * INDEPENDENCE ASSUMPTION, STATED: this `√(Σσ²)` combination assumes ZERO
 * covariance between the three picks' own variances — a cross-team
 * correlation term is never added, only each team's own variance, squared
 * and summed. No cross-team covariance model exists in this codebase to
 * consult; building one would be new modelling work, not a lookup (the
 * Auto/Teleop/Endgame phase tiles in `metricGroups.ts` made the opposite
 * choice and fund that work instead). Consequence, stated plainly: every
 * real correlation between alliance partners (shared field conditions, a
 * defender suppressing the opponent, a partner breaking down) is positive,
 * so the published σ here is a FLOOR — the true uncertainty is at least
 * this large. This comment is the ONLY place that says so; there is no
 * on-page disclosure of this assumption.
 */
export function combineAlliancePicks(totals: readonly (DisplayMetric | undefined)[]): DisplayMetric | undefined {
  // PROHIBITION: never sum over a present subset when fewer than three
  // entries resolve — no arity-flexible sum. Both a sub-three-pick alliance
  // and a pick whose team has no metrics row in this artifact return
  // `undefined` here, through the SAME rule, with no special case for either.
  if (totals.length !== ALLIANCE_COMBINED_PICK_COUNT || totals.some((total) => total === undefined)) {
    return undefined;
  }
  const resolved = totals as DisplayMetric[];
  // PROHIBITION: never default an absent published value to 0 here or
  // anywhere else in this file — that would silently replace an honest
  // "unknown" with a false "weak".
  const value = resolved.reduce((sum, total) => sum + total.value, 0);
  // Spread (the algorithm's own confidence) must never reach the screen in
  // any form. The Combined Total's neutral Sigma band is built separately,
  // from the three picks' Sigma Scores, at `buildAllianceRows`'s
  // `combinedSigma` field — this function stays the pure value sum.
  return { value };
}

/** Ascending `allianceNumber`, exact ties broken by ascending first-pick team key — a TOTAL order that never depends on the sort engine's stability. */
function byAllianceNumberThenFirstPick(a: EventAlliance, b: EventAlliance): number {
  if (a.allianceNumber !== b.allianceNumber) return a.allianceNumber - b.allianceNumber;
  const firstA = a.picks[0] ?? "";
  const firstB = b.picks[0] ?? "";
  return firstA < firstB ? -1 : firstA > firstB ? 1 : 0;
}

/**
 * Looks a pick's team key up in the artifact's `teams` array. A key with no
 * row keeps its number (from the key's own digits) — there is no name to
 * lose on a missing row; the identity carried is the team number alone,
 * never invented.
 */
function pickFromTeamKey(teamKey: string, teams: readonly EventTeam[]): AlliancePick {
  const teamRow = teams.find((candidate) => candidate.teamKey === teamKey);
  const teamNumber = teamRow?.teamNumber ?? teamNumberFromKey(teamKey);
  return {
    teamKey,
    teamNumber,
    total: teamRow?.metrics[TOTAL_KEY],
    // Read straight off the same team row's own published `sigma` metrics
    // entry — the event artifact's own standings — never a second lookup.
    sigma: teamRow?.metrics[SIGMA_METRIC_KEY],
  };
}

/**
 * `buildAllianceRows(artifact, algorithmId)`: maps each published alliance to
 * an `AllianceRow`, ordered by ascending `allianceNumber` (never array
 * index). `picks` is read positionally — there is no field for the leader
 * position or the reserve robot, so a parallel field on `AllianceRow` would
 * be a copy that can drift. Also computes the combined total's approximate
 * tier (against the FULL event roster, not just this alliance's three
 * picks — `estimateCombinedTier`'s own contract) and carries the
 * alliance's published playoff record straight through.
 */
/**
 * The Combined Total's neutral band, all or nothing over the first
 * `ALLIANCE_COMBINED_PICK_COUNT` picks — `undefined` unless every one of
 * them carries a `sigma` entry. Built entirely from the shipping
 * `allianceSigmaBandVariance`/`sigmaMatchBandVariance` helpers (the SAME
 * two functions the Match Band drawn on every SPR match row composes).
 */
function combinedSigmaBand(picks: readonly AlliancePick[]): number | undefined {
  const leading = picks.slice(0, ALLIANCE_COMBINED_PICK_COUNT);
  if (leading.length !== ALLIANCE_COMBINED_PICK_COUNT || leading.some((pick) => pick.sigma === undefined)) {
    return undefined;
  }
  const roster = leading.map((pick) => pick.teamKey);
  const byTeam = new Map(leading.map((pick) => [pick.teamKey, (pick.sigma as AlliancePickSigma).value]));
  const variance = sigmaMatchBandVariance(ALLIANCE_COMBINED_PICK_COUNT, allianceSigmaBandVariance(roster, byTeam));
  return variance === undefined ? undefined : Math.sqrt(variance);
}

export function buildAllianceRows(artifact: EventPageArtifact, algorithmId: string): AllianceRow[] {
  void algorithmId; // reserved for signature symmetry with the column builder
  const alliances = artifact.alliances ?? [];
  const ordered = [...alliances].sort(byAllianceNumberThenFirstPick);
  const tierPoints = buildTeamValuePercentilePoints(artifact.teams);

  return ordered.map((alliance) => {
    const picks = alliance.picks.map((teamKey) => pickFromTeamKey(teamKey, artifact.teams));
    const combined = combineAlliancePicks([picks[0]?.total, picks[1]?.total, picks[2]?.total]);
    return {
      allianceNumber: alliance.allianceNumber,
      picks,
      combined,
      combinable: combined !== undefined,
      combinedApproxTier: combined !== undefined ? estimateCombinedTier(combined.value, tierPoints) : undefined,
      combinedSigma: combined !== undefined ? combinedSigmaBand(picks) : undefined,
      record: alliance.record,
    };
  });
}

/**
 * True only when the artifact's `alliances` key is present AND its array
 * has at least one entry. Absent and empty are distinguishable at the
 * artifact level, but this deliberately collapses them, accepting that the
 * page cannot tell "alliance selection has not happened yet" from "this
 * event has no recorded alliances".
 */
export function hasAllianceData(artifact: EventPageArtifact): boolean {
  return artifact.alliances !== undefined && artifact.alliances.length > 0;
}

/**
 * The approximate-tier disclosure, surfaced as the `title`/`aria-label` of
 * the labelled `role="group"` wrapping a tiered Combined Total — never a
 * bolted-on banner, quiet and consistent with the design language. Cites
 * the same reasoning `@/lib/allianceTierApproximation.ts`'s header comment
 * gives in full.
 */
export const ALLIANCE_APPROX_TIER_DISCLOSURE =
  "Approximate tier: no percentile is published for a 3-team sum, so this is estimated by dividing the combined total by 3 and comparing that to this event's own single-team totals.";

/**
 * The incomplete-combination notice. Pluralizes the alliance noun's verb
 * and possessive correctly for a count of one, so a grammar bug in a line
 * that exists to explain missing data does not read as carelessness
 * precisely where care is being claimed.
 */
export function alliancesIncompleteNotice(incomplete: number, total: number, algorithmLabel: string): string {
  const isSingular = incomplete === 1;
  const verb = isSingular ? "is" : "are";
  const possessive = isSingular ? "its" : "their";
  return `${incomplete} of ${total} alliances ${verb} missing a combined value because one of ${possessive} first three picks has no published ${algorithmLabel} total.`;
}

/**
 * `formatAllianceRecord(record)`: wins-losses-ties joined by hyphens,
 * mirroring `InsightsTab.tsx`'s `formatEventRecord` (restated, not
 * imported, following that function's own precedent of copying across the
 * event/ module boundary). `undefined` returns the EMPTY STRING: an event
 * with no playoff bracket yet, or an unrecognised `status` shape, are both
 * honest absences, and an empty string is that absence rendered honestly —
 * never a fabricated `0-0-0`.
 */
export function formatAllianceRecord(record: { wins: number; losses: number; ties: number } | undefined): string {
  if (record === undefined) return "";
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/**
 * The column labels. `picks[1]`/`picks[2]` map to TBA's own `picks` array,
 * where index 1 is the FIRST additional pick — not "Pick 2". "Backup" is
 * labelled "Pick 3" (the backup robot is FRC's third overall pick) — the
 * column id `pickBackup` is unchanged (external e2e tests key off it), only
 * its header label. Index 5 (Combined Total) varies by algorithm —
 * "Combined Total ± Sigma" under a Sigma-enabled algorithm, "Combined
 * Total" otherwise — so this is a FUNCTION of `algorithmId`, read by both
 * the live table and the skeleton, rather than a static tuple either could
 * drift from.
 */
function alliancesColumnHeaders(algorithmId: string): readonly [string, string, string, string, string, string, string] {
  return [
    "Alliance #",
    "Captain",
    "Pick 1",
    "Pick 2",
    "Pick 3",
    usesSigmaScore(algorithmId) ? "Combined Total ± Sigma" : "Combined Total",
    "Record",
  ];
}

/**
 * Pick-column widths, measured against real published totals. A pick
 * cell's content is `teamNumber` + the 8px gap + the pick's tiered total.
 * `PICK_COLUMN_WIDTH_SIGMA_PX` (214) covers a pick cell rendering the split
 * pill (`TotalSigmaValue`) under a Sigma-enabled algorithm: `teamNumber`
 * (51.88px) + 8px gap + pill (130.31px, worst case "425.67" | "±92.00") +
 * 16px cell padding + 6px cross-browser font-hinting buffer.
 * `PICK_COLUMN_WIDTH_SPREADLESS_PX` (150 — EPA/OPR): neither publishes
 * Sigma, so the pick cell stays a bare boxed value at 65.16px.
 */
export const PICK_COLUMN_WIDTH_SIGMA_PX = 214;
export const PICK_COLUMN_WIDTH_SPREADLESS_PX = 150;

function pickColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? PICK_COLUMN_WIDTH_SIGMA_PX : PICK_COLUMN_WIDTH_SPREADLESS_PX;
}

/**
 * Combined Total column widths, same measurement pass as the pick columns
 * above. `CombinedCell` carries no team-number span — it is a single
 * `TotalSigmaValue`, so its content is exactly one pill's rendered width.
 * `COMBINED_COLUMN_WIDTH_SIGMA_PX` (180): the combined cell renders the
 * split pill with the neutral Sigma band as its right half (worst case
 * "1024.22" | "±235.26", 148.47px boxed); the "COMBINED TOTAL ± SIGMA"
 * header needs 178.34px and is the binding constraint.
 * `COMBINED_COLUMN_WIDTH_SPREADLESS_PX` (128 — EPA/OPR): neither publishes
 * Sigma, so the combined cell stays a bare boxed value, bound by the
 * "COMBINED TOTAL" header (123.53px).
 */
export const COMBINED_COLUMN_WIDTH_SIGMA_PX = 180;
export const COMBINED_COLUMN_WIDTH_SPREADLESS_PX = 128;

function combinedColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? COMBINED_COLUMN_WIDTH_SIGMA_PX : COMBINED_COLUMN_WIDTH_SPREADLESS_PX;
}

/**
 * The backup ("Pick 3"/`pickBackup`) column's width gates on
 * `usesSigmaScore` — `BackupCell` renders the same split pill `PickCell`
 * does. `BACKUP_COLUMN_WIDTH_SIGMA_PX` (274): `teamNumber` (51.88px) + 8px
 * gap + pill (130.31px) + 8px gap + "(backup)" label (52.11px) + padding +
 * buffer, measured for the ONE-backup-per-row case (more than one backup
 * wraps). `BACKUP_COLUMN_WIDTH_PX` (240) is the other algorithms' width,
 * which never carries a Sigma pill.
 */
export const BACKUP_COLUMN_WIDTH_SIGMA_PX = 274;
export const BACKUP_COLUMN_WIDTH_PX = 240;

function backupColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? BACKUP_COLUMN_WIDTH_SIGMA_PX : BACKUP_COLUMN_WIDTH_PX;
}

/** Registered once, module-level: only column sizing is registered. No column is frozen at any width. */
const features = tableFeatures({ columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, AllianceRow>();

/**
 * One pick's team number plus its own tiered total metric — no nickname
 * renders alongside the number.
 *
 * `gap-[var(--spacing-sm)]` (8px, up from `--spacing-xs`'s 4px) gives the
 * number and its metric deliberate separation, within
 * `PICK_COLUMN_WIDTH_SIGMA_PX`'s own measured budget.
 *
 * The pick's own total renders through `TotalSigmaValue`, tiered on its own
 * percentile, with its own published Sigma Score (`pick.sigma`) as the
 * pill's right half — degrading to a plain tier-boxed value, unchanged,
 * whenever `pick.sigma` is `undefined` (every OPR/EPA pick, and an SPR pick
 * this event has none for).
 */
function PickCell({ pick, season, algorithm }: { pick: AlliancePick | undefined; season: number; algorithm: PublishedAlgorithmId }) {
  if (pick === undefined) {
    return <span className="numeric-cell"></span>;
  }
  return (
    <Link
      to="/team/$teamNumber"
      params={{ teamNumber: String(pick.teamNumber) }}
      search={{ year: season, algorithm, tab: "overview" }}
      className="flex items-center gap-[var(--spacing-sm)]"
    >
      <span className="numeric-cell">{pick.teamNumber}</span>
      <TotalSigmaValue
        total={pick.total}
        totalTier={tierForPercentile(pick.total?.percentile)}
        sigma={pick.sigma !== undefined ? { value: pick.sigma.value, tier: tierForPercentile(pick.sigma.percentile) } : undefined}
      />
    </Link>
  );
}

/**
 * Renders EVERY entry from position 3 onward, never index 3 alone —
 * `EventAllianceSchema.picks` declares a minimum of one entry and no
 * maximum, and a render that read only one further position would silently
 * erase a real team from the only published account of this event's
 * alliance selection. Renders the same `TotalSigmaValue` pill as
 * `PickCell`, same degrade rule.
 */
function BackupCell({ picks, season, algorithm }: { picks: AlliancePick[]; season: number; algorithm: PublishedAlgorithmId }) {
  if (picks.length === 0) {
    return <span className="numeric-cell"></span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-[var(--spacing-sm)]">
      {picks.map((pick) => (
        <Link
          key={pick.teamKey}
          to="/team/$teamNumber"
          params={{ teamNumber: String(pick.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          // Same gap widening as PickCell's identical inner Link.
          className="flex items-center gap-[var(--spacing-sm)]"
        >
          <span className="numeric-cell">{pick.teamNumber}</span>
          <TotalSigmaValue
            total={pick.total}
            totalTier={tierForPercentile(pick.total?.percentile)}
            sigma={pick.sigma !== undefined ? { value: pick.sigma.value, tier: tierForPercentile(pick.sigma.percentile) } : undefined}
          />
          <span className="text-role-label text-[var(--color-text-muted)]">{"(backup)"}</span>
        </Link>
      ))}
    </span>
  );
}

/**
 * The Combined Total cell: the published `√(Σσ²)` value through
 * `TotalSigmaValue`, tiered by the 3x heuristic's APPROXIMATE percentile
 * when one is available, plus a small, quiet marker disclosing the
 * approximation — never a loud banner. The disclosure attaches whenever a
 * tier BOX is actually drawn (Common draws the hairline ring too, and its
 * tier is just as approximate as any other, so it is disclosed on the same
 * terms). It carries `role="group"` plus `title` and `aria-label` so it
 * reaches a mouse-hover reader and a screen-reader user alike (mirrors
 * `BonusRpDots.tsx`'s own role+title+aria-label trio).
 *
 * `sigma` is the ROW's `combinedSigma` (`buildAllianceRows`'s all-or-nothing
 * `√(3 * ΣSigma²)` band), passed with `neutral: true` — there is no
 * percentile for a three-team band, so `TotalSigmaValue` gives it the
 * untiered slate half rather than inventing a tier. `undefined` degrades
 * the cell to the plain `TotalSigmaValue` no-sigma path.
 */
function CombinedCell({ metric, approx, sigma }: { metric: DisplayMetric | undefined; approx: AllianceApproxTier | undefined; sigma: number | undefined }) {
  const boxed = approx !== undefined;
  // No visible "≈" glyph. The tier is still a 3x-heuristic APPROXIMATION
  // (see `@/lib/allianceTierApproximation`), so the disclosure survives
  // invisibly — hover/assistive tech reach it via the cell's own
  // title/aria-label whenever a box is drawn.
  //
  // `role="group"` is load-bearing, not decoration. A <span> with no role
  // maps to `role="generic"`, on which `aria-label` is a PROHIBITED
  // attribute under ARIA 1.2 / ARIA-in-HTML — browsers drop it from the
  // accessibility tree, so an unrooted label announces nothing and `title`
  // (hover-only, unreachable on touch) becomes the whole disclosure. The
  // role is conditional for the same reason the label is: an unboxed cell
  // has no approximation to disclose and must not announce an empty group.
  return (
    <span
      role={boxed ? "group" : undefined}
      className="flex items-center gap-[var(--spacing-xs)]"
      title={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
      aria-label={boxed ? ALLIANCE_APPROX_TIER_DISCLOSURE : undefined}
    >
      <TotalSigmaValue total={metric} totalTier={approx?.tier} sigma={sigma !== undefined ? { value: sigma, neutral: true } : undefined} />
    </span>
  );
}

/**
 * True when at least one row's fourth-or-later pick is present — the sole
 * signal `buildAllianceColumns` uses to decide whether `pickBackup` renders
 * at all, since it is dead space on every event without a backup robot,
 * which is most of them. Computed over the WHOLE table, not per-row: an
 * event where only some alliances carry a backup still shows the column
 * (with a blank cell on the rows that lack one) — a column that disappears
 * when it should appear is the worse bug.
 */
function hasAnyBackupPick(rows: readonly AllianceRow[]): boolean {
  return rows.some((row) => row.picks.slice(ALLIANCE_COMBINED_PICK_COUNT).length > 0);
}

function buildAllianceColumns(algorithmId: string, season: number, showBackupColumn: boolean) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` — the same loose-cast escape hatch
  // every sibling tab already uses for a value the type system widened to
  // plain `string` crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const headers = alliancesColumnHeaders(algorithmId);

  return columnHelper.columns([
    columnHelper.accessor("allianceNumber", {
      id: "allianceNumber",
      header: headers[0],
      // 88: the uppercase 11px "ALLIANCE #" header's own intrinsic text is
      // 72px plus 16px cell padding — no ellipsis renders at 88.
      size: 88,
      cell: (info) => <span className="numeric-cell">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.picks[0], {
      id: "pick0",
      header: headers[1],
      // Per-metric-column width pattern — see `pickColumnWidth`'s own doc
      // comment for the measured derivation.
      size: pickColumnWidth(algorithmId),
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor((row) => row.picks[1], {
      id: "pick1",
      header: headers[2],
      size: pickColumnWidth(algorithmId),
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor((row) => row.picks[2], {
      id: "pick2",
      header: headers[3],
      size: pickColumnWidth(algorithmId),
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    // Included only when `hasAnyBackupPick` found one — `AlliancesTabSkeleton`
    // below cannot know this and always renders all seven, deliberately
    // (see its own doc comment).
    ...(showBackupColumn
      ? [
          columnHelper.accessor((row) => row.picks.slice(ALLIANCE_COMBINED_PICK_COUNT), {
            id: "pickBackup",
            header: headers[4],
            // `backupColumnWidth` gates on `usesSigmaScore` — see that
            // function's own doc comment.
            size: backupColumnWidth(algorithmId),
            cell: (info) => <BackupCell picks={info.getValue()} season={season} algorithm={algorithm} />,
          }),
        ]
      : []),
    columnHelper.accessor("combined", {
      id: "combined",
      header: headers[5],
      // `combinedColumnWidth`'s own doc comment has the measured derivation.
      size: combinedColumnWidth(algorithmId),
      cell: (info) => <CombinedCell metric={info.getValue()} approx={info.row.original.combinedApproxTier} sigma={info.row.original.combinedSigma} />,
    }),
    columnHelper.accessor("record", {
      id: "record",
      header: headers[6],
      // 72: header "RECORD" needs 66px, widest content ("6-4-1" etc.) needs
      // 62px — 72 covers both with cell padding to spare.
      size: 72,
      cell: (info) => <span className="numeric-cell">{formatAllianceRecord(info.getValue())}</span>,
    }),
  ]);
}

export interface AlliancesTabProps {
  artifact: EventPageArtifact;
  algorithmId: string;
  season: number;
}

export const ALLIANCES_SKELETON_ROW_COUNT = 6;

/**
 * The pending state's placeholder — inside the same scroll-region wrapper
 * shape the populated tab uses. Always renders the full seven-header set,
 * `pickBackup` included, even though the populated tab hides that column
 * when no alliance has a backup pick: the skeleton cannot know the data
 * yet, and a placeholder that guessed wrong would shift the layout twice —
 * once when the guess is wrong, once when the real column count lands.
 * Rendering all seven every time is one layout shift, not two.
 */
export function AlliancesTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  void season;
  // The Combined Total header varies by algorithm too (`alliancesColumnHeaders`,
  // the same derivation the live table uses), so nothing shifts once real
  // data lands under a Sigma-enabled algorithm.
  const headers = alliancesColumnHeaders(algorithmId);
  return (
    <div data-testid="alliances-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
        <TableHeader>
          <TableRow>
            {headers.map((label) => (
              <TableHead key={label} className="text-role-label truncate">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <SkeletonRows rows={ALLIANCES_SKELETON_ROW_COUNT} columns={headers.length} />
        </TableBody>
      </table>
    </div>
  );
}

/**
 * The Alliances tab: a six- or seven-column table (the seventh,
 * `pickBackup`, renders only when at least one alliance actually has a
 * backup pick — most events do not) in its own native scroll region (a DOM
 * SIBLING of the tab strip's own scroll region, never its ancestor or
 * descendant), and an incomplete-combination notice when (and only when)
 * at least one row cannot combine. Reads no match array of any kind and
 * performs no arithmetic on any published quantity other than
 * `combineAlliancePicks`'s three-term combination and the client-side 3x
 * tier approximation. Every string originating in the published artifact
 * renders as a plain JSX text node or a `title` attribute value — never
 * through a raw-markup sink.
 */
export function AlliancesTab({ artifact, algorithmId, season }: AlliancesTabProps) {
  const rows = useMemo(() => buildAllianceRows(artifact, algorithmId), [artifact, algorithmId]);
  const showBackupColumn = useMemo(() => hasAnyBackupPick(rows), [rows]);
  const columns = useMemo(() => buildAllianceColumns(algorithmId, season, showBackupColumn), [algorithmId, season, showBackupColumn]);

  const table = useTable({ features, columns, data: rows });

  const incompleteCount = rows.filter((row) => !row.combinable).length;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <div data-testid="alliances-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        {/*
          `table-layout: fixed`, matching every other event table
          (Insights/Breakdown/TeamsTable): every pick cell renders only a
          team number plus a bounded metric cell (`MetricValue` or
          `TotalSigmaValue`'s pill) whose width is bounded by CSS
          (`.metric-tier`'s own `min-width`, `.metric-pill`'s own halves,
          never free-growing text), so there is no longer a reason for
          `auto` layout's free growth.

          `width` is the EXACT sum of the column sizes
          (`table.getTotalSize()`), never `100%`: with `width: "100%"` +
          `minWidth: table.getTotalSize()` (the pattern
          Insights/Breakdown/TeamsTable still use), shrinking this tab's
          columns below the content area lets `100%` win over `minWidth`,
          and `table-layout: fixed` redistributes the freed space
          proportionally BACK across every column, silently undoing the
          whole point of tightening it. An explicit pixel `width` is
          simultaneously the floor (the wrapper's own `overflow-x-auto`
          still engages below it) and the ceiling (never stretches past it).
        */}
        <table style={{ width: table.getTotalSize(), tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    data-testid={`alliances-header-${header.column.id}`}
                    className="text-role-label truncate"
                    style={{
                      width: header.getSize(),
                      background: "var(--color-bg-surface)",
                    }}
                  >
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="alliances-row" data-alliance-number={row.original.allianceNumber}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} data-testid={`alliances-cell-${cell.column.id}`} className="text-role-body">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      {incompleteCount > 0 && (
        <div
          data-testid="alliances-incomplete-notice"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-inset)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{alliancesIncompleteNotice(incompleteCount, rows.length, algorithmDisplayLabel(algorithmId as PublishedAlgorithmId))}</span>
        </div>
      )}
    </div>
  );
}
