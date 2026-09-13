/**
 * The Alliances tab (EVNT-05, 07-14-PLAN.md): one row per published alliance
 * in TBA's own seed order, columns Alliance # / Captain / Pick 1 / Pick 2 /
 * Pick 3 / Combined Total / Record. This is the ONLY component in the
 * application that computes a number rather than rendering a published
 * one — the authority is D-15, not convenience. It is legitimate here
 * (while 07-01 forbids the identical move on Breakdown) because an
 * alliance's cross-team covariance is zero by the model's own construction
 * — the retired Sigma1 core (deleted by quick task 260913-it4)'s covariance module header stated the
 * model's covariance is between a single team's own components and never
 * between teams — whereas a component group's off-diagonal terms are real
 * and unpublished (D-11's `phaseAuto`/`phaseTeleop`/`phaseEndgame`
 * reasoning).
 *
 * 07-UAT.md G-8 (real-device UAT, plan 07-21) rebuilt this tab: dropped
 * every nickname (team numbers only), corrected the pick-column labels
 * (`picks[1]` had been mislabelled "Pick 2" — it is the FIRST pick), added
 * each pick's own tiered total metric, added a client-side approximate tier
 * for the Combined Total (the 3x heuristic, `@/lib/allianceTierApproximation`),
 * documented the independence assumption `combineAlliancePicks` already made
 * (the arithmetic itself is UNCHANGED), and added the published playoff
 * Record column. See that gap's write-up for the full before/after.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import type { DisplayMetric } from "@/components/MetricValue";
import { TotalSigmaValue } from "@/components/TotalSigmaValue";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { useIsMobile } from "@/lib/breakpoints";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import { buildTeamValuePercentilePoints, estimateCombinedTier, type AllianceApproxTier } from "@/lib/allianceTierApproximation";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { allianceSigmaBandVariance, sigmaMatchBandVariance, SIGMA_METRIC_KEY, usesSigmaScore } from "../../../../../packages/harness/sigmaScore.js";

type EventTeam = EventArtifact["teams"][number];
type EventAlliance = NonNullable<EventArtifact["alliances"]>[number];

/**
 * D-16: only the first three picks enter the combined arithmetic. A
 * fourth/backup pick is displayed on the row but excluded from the sum so
 * the column stays comparable across rows — an alliance with a backup and
 * one without would otherwise render two differently-sized sums under the
 * identical header.
 */
export const ALLIANCE_COMBINED_PICK_COUNT = 3;

/**
 * One alliance pick's own published total metric, as rendered — the same
 * `{value, spread}` `MetricValue` already consumes, widened with the
 * optional `percentile` `EventTeamSchema.metrics` also carries (G-8): this
 * tab tiers each pick's OWN total by its own exact published percentile,
 * never by the alliance's approximate combined one.
 */
interface AlliancePickTotal extends DisplayMetric {
  percentile?: number;
}

/**
 * One pick's own published Sigma Score, quick task 260913-jkp — the same
 * `{value, percentile}` shape `AlliancePickTotal` carries, read from the
 * team's own `SIGMA_METRIC_KEY` metrics entry. `undefined` for every OPR/EPA
 * pick and for an SPR pick this event's artifact does not resolve one for.
 */
interface AlliancePickSigma {
  value: number;
  percentile?: number;
}

/**
 * One alliance pick, as rendered — identity fields never invented, `total`
 * left `undefined` when the artifact does not resolve one. G-8 drops
 * `nickname` entirely (team numbers only, developer decision from
 * real-device UAT) — there is no longer a name field on this interface at
 * all, not merely an unrendered one.
 */
export interface AlliancePick {
  teamKey: string;
  teamNumber: number;
  total: AlliancePickTotal | undefined;
  /** Quick task 260913-jkp: this pick's own Sigma Score, rendered as the right half of its total's split pill (`TotalSigmaValue`). */
  sigma: AlliancePickSigma | undefined;
}

/** One alliance's row model. `combinable` mirrors whether `combined` is defined — one fact, not two independently-consulted ones (07-11's own discriminant precedent). */
export interface AllianceRow {
  allianceNumber: number;
  picks: AlliancePick[];
  combined: DisplayMetric | undefined;
  combinable: boolean;
  /**
   * G-8's 3x heuristic approximate tier for `combined` — `undefined` when
   * `combined` itself is `undefined` (nothing to tier), or when this event
   * publishes no team with a percentile to interpolate against at all. This
   * is NEVER an exact tier; see `@/lib/allianceTierApproximation`'s header
   * comment for the full method and why one cannot be published instead.
   */
  combinedApproxTier: AllianceApproxTier | undefined;
  /**
   * Quick task 260913-jkp, CONTEXT "Alliances Combined Total": the neutral,
   * untiered `±` for the Combined Total pill's Sigma half — `sqrt(3 * (a^2 +
   * b^2 + c^2))` over the first three picks' own Sigma Scores, the SAME
   * Match Band formula every SPR match row draws, computed through the
   * shipping `allianceSigmaBandVariance`/`sigmaMatchBandVariance` helpers
   * (never re-typed arithmetic). ALL OR NOTHING, like `combined` itself:
   * `undefined` unless `combined` is defined AND every one of the first
   * `ALLIANCE_COMBINED_PICK_COUNT` picks carries a `sigma` entry — a partial
   * band would understate the alliance's true miss the same way a partial
   * `combined` sum would.
   */
  combinedSigma: number | undefined;
  /**
   * TBA's own reported playoff win-loss-tie record for this alliance (G-8),
   * sourced from `EventAllianceSchema.record`. `undefined` for an honest
   * absence (no playoff bracket has run yet, or a `playoff_type` shape the
   * pipeline's `parseAllianceRecord` does not recognise) — never a
   * fabricated `0-0-0`.
   */
  record: { wins: number; losses: number; ties: number } | undefined;
}

/**
 * D-15's exact arithmetic: `σ_alliance = √(σ₁² + σ₂² + σ₃²)` over the first
 * three picks' published totals — standard deviations are never added.
 * Three robots at ±10 give ±17.3, not ±30 (D-15's own worked example). The
 * `spread` values summed here are total predictive standard deviations under
 * 07-06's redefinition of the field to `√(P + R)`, not the consistency
 * values the field carried before that plan — this arithmetic is only
 * honest because 07-06 landed first.
 *
 * All-or-nothing: returns `undefined` when ANY of the three entries is
 * absent — never a sum over the present subset. A partial sum would render
 * in the identical shape, column and precision as a complete one while being
 * roughly a third low, and D-16's own stated purpose (keeping the column
 * comparable across rows) is precisely what a variable-arity sum destroys.
 * Two measured causes reach this branch: an alliance with fewer than three
 * picks (all ten such corpus rows sit at `2022vabrb`/`2024vabrb`, each
 * running five two-pick alliances), and a pick whose team has no metrics row
 * in this artifact (live at `2024cmptx`, where two of eight alliances have
 * this at the third pick because an Einstein alliance's members qualified at
 * a division event).
 *
 * The value's absence and the spread's absence are two independent rules
 * over the same cell: given a value, the ± renders only when all three
 * resolved entries publish a spread; otherwise the summed value renders bare
 * (mirrors `07-07-PLAN.md`'s PD-04 — two kinds of absence are never
 * conflated). The square root is applied exactly once, to the summed
 * variances, and never to an individual term. No default of zero ever
 * stands in for an absent published value — that would make an alliance
 * with a missing pick look catastrophically weak rather than unknown.
 *
 * INDEPENDENCE ASSUMPTION, STATED (07-UAT.md G-8, developer decision
 * 2026-08-30): this `√(Σσ²)` combination assumes ZERO covariance between
 * the three picks' own variances — a cross-team correlation term is never
 * added, only each team's own variance, squared and summed. This is not an
 * incidental gap in this one function: the retired Sigma1 core's covariance
 * module header stated the model computes covariance only
 * among a SINGLE team's own components (`covEwmaAlpha`/`covShrinkage`
 * govern that per-team fold) and never between teammates — D-06 of Phase 2
 * rules out a cross-team latent structure entirely, so there is no existing
 * quadratic form over an inter-team covariance matrix this function could
 * consult even if it wanted to; building one would be new modelling work,
 * not a lookup. The developer chose to accept this independence assumption
 * here rather than fund that work — the SAME trade-off
 * `apps/web/src/lib/metricGroups.ts`'s header records being resolved the
 * OTHER way for the Auto/Teleop/Endgame phase tiles (there, the pipeline
 * was widened to compute the true quadratic-form variance instead of
 * assuming independence). Consequence, stated plainly: every real
 * correlation between alliance partners (shared field conditions, a
 * defender suppressing the opponent, a partner breaking down) is positive,
 * so the published σ here is a FLOOR — the true uncertainty is at least
 * this large. This comment is now the ONLY place that says so: the on-page
 * disclosure that used to restate this in the reader's own words
 * (`ALLIANCES_INDEPENDENCE_CAVEAT`, beneath the table) was retired
 * 2026-09-02 — user decision during UAT of quick task 260902-i8i, executed
 * in 260902-ixg, `07-UI-SPEC.md`'s D-15 row marked retired accordingly. The
 * arithmetic and the assumption it makes are UNCHANGED; only the on-page
 * disclosure is gone.
 */
export function combineAlliancePicks(totals: readonly (DisplayMetric | undefined)[]): DisplayMetric | undefined {
  // PROHIBITION: never sum over a present subset when fewer than three
  // entries resolve — no arity-flexible sum. The two measured causes that
  // reach this branch are a sub-three-pick alliance (2022vabrb/2024vabrb,
  // ten corpus rows, each running five two-pick alliances) and a pick whose
  // team has no metrics row in this artifact (live at 2024cmptx, two of
  // eight alliances, at the third pick). Both return `undefined` here,
  // through the SAME rule, with no special case for either cause.
  if (totals.length !== ALLIANCE_COMBINED_PICK_COUNT || totals.some((total) => total === undefined)) {
    return undefined;
  }
  const resolved = totals as DisplayMetric[];
  // PROHIBITION: never default an absent published value to 0 here or
  // anywhere else in this file. A missing term defaulted to zero would make
  // an alliance with a missing pick render as catastrophically weak rather
  // than unknown. IN-05 (260902-post-phase08-ungoverned-ui/REVIEW.md):
  // corrects this comment's own prior claim that it is "the opposite of the
  // em-dash this function returns above" — this function returns
  // `undefined` above, not an em-dash (the em-dash, where one appears, is
  // rendered by a CALLER formatting an absent value, not by this function).
  // The argument stands unchanged under the correction: defaulting to zero
  // would silently replace an honest "unknown" with a false "weak".
  const value = resolved.reduce((sum, total) => sum + total.value, 0);
  // The combined `±` this used to return was the quadrature sum of the three
  // picks' `spread` — the ALGORITHM's own confidence — and it is gone
  // (2026-09-09): spread must never reach the screen in any form.
  //
  // The right replacement is built from the three picks' SIGMA SCORES, the
  // same per-team terms the Match Band drawn on every SPR match row sums —
  // wired at `buildAllianceRows`'s own `combinedSigma` field (quick task
  // 260913-jkp), not here: this function stays the pure value sum, and the
  // Combined Total's neutral band rides alongside it on `AllianceRow` rather
  // than folding into this return type.
  return { value };
}

/** Ascending `allianceNumber`, exact ties broken by ascending first-pick team key — a TOTAL order that never depends on the sort engine's stability (EVNT-05 adjacency). */
function byAllianceNumberThenFirstPick(a: EventAlliance, b: EventAlliance): number {
  if (a.allianceNumber !== b.allianceNumber) return a.allianceNumber - b.allianceNumber;
  const firstA = a.picks[0] ?? "";
  const firstB = b.picks[0] ?? "";
  return firstA < firstB ? -1 : firstA > firstB ? 1 : 0;
}

/**
 * Looks a pick's team key up in the artifact's `teams` array. A key with no
 * row keeps its number (from the key's own digits) — G-8 drops nicknames
 * entirely, so there is no name to lose on a missing row anymore; the
 * identity carried is the team number alone, never invented.
 */
function pickFromTeamKey(teamKey: string, teams: readonly EventTeam[]): AlliancePick {
  const teamRow = teams.find((candidate) => candidate.teamKey === teamKey);
  const teamNumber = teamRow?.teamNumber ?? teamNumberFromKey(teamKey);
  return {
    teamKey,
    teamNumber,
    total: teamRow?.metrics[TOTAL_KEY],
    // Quick task 260913-jkp: read straight off the same team row's own
    // published `sigma` metrics entry — the event artifact's own standings
    // (publish.ts's `buildEventTeamsStanding`), never a second lookup.
    sigma: teamRow?.metrics[SIGMA_METRIC_KEY],
  };
}

/**
 * `buildAllianceRows(artifact, algorithmId)`: maps each published alliance to
 * an `AllianceRow`, ordered by ascending `allianceNumber` (never array
 * index). `picks` is read positionally — 07-07's PD-02 declares no field for
 * the leader position or the reserve robot, so a parallel field on
 * `AllianceRow` would be a copy that can drift. G-8 additionally computes
 * the combined total's approximate tier (against the FULL event roster, not
 * just this alliance's three picks — `estimateCombinedTier`'s own contract)
 * and carries the alliance's published playoff record straight through.
 */
/**
 * Quick task 260913-jkp: the Combined Total's neutral band, all or nothing
 * over the first `ALLIANCE_COMBINED_PICK_COUNT` picks — `undefined` unless
 * every one of them carries a `sigma` entry. Built entirely from the
 * shipping `allianceSigmaBandVariance`/`sigmaMatchBandVariance` helpers
 * (the SAME two functions the Match Band drawn on every SPR match row
 * composes), never a re-typed sum of squares.
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

export function buildAllianceRows(artifact: EventArtifact, algorithmId: string): AllianceRow[] {
  void algorithmId; // reserved for signature symmetry with the column builder; the row model does not vary by algorithm beyond which metrics the artifact already carries
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
 * D-17: true only when the artifact's `alliances` key is present AND its
 * array has at least one entry. Absent and empty are distinguishable at the
 * artifact level (07-08's PD-03 emits the key iff the caller consulted the
 * corpus, and `[]` iff the corpus held zero rows) — D-17 deliberately
 * collapses them, accepting that the page cannot tell "alliance selection
 * has not happened yet" from "this event has no recorded alliances".
 * Corpus-wide: 175 null-body events and 51 empty-array events against 1,355
 * populated — roughly one event page in seven carries a disabled trigger.
 */
export function hasAllianceData(artifact: EventArtifact): boolean {
  return artifact.alliances !== undefined && artifact.alliances.length > 0;
}

/**
 * G-8's approximate-tier disclosure, surfaced as the `title`/`aria-label` of
 * the labelled `role="group"` wrapping a tiered Combined Total (never a
 * bolted-on banner — "quiet and consistent with the design language" per the
 * sketch-findings skill's stated direction; the small visible marker this
 * used to hang off was removed by user request 2026-09-01, and the group role
 * is what keeps the label exposed without it). Cites the same reasoning
 * `@/lib/allianceTierApproximation.ts`'s header comment gives in full.
 */
export const ALLIANCE_APPROX_TIER_DISCLOSURE =
  "Approximate tier: no percentile is published for a 3-team sum, so this is estimated by dividing the combined total by 3 and comparing that to this event's own single-team totals.";

/**
 * The incomplete-combination notice (Task 2, Claude's Discretion — no
 * Copywriting Contract row exists for this sentence). Pluralizes the
 * alliance noun's verb and possessive correctly for a count of one, so a
 * grammar bug in a line that exists to explain missing data does not read as
 * carelessness precisely where care is being claimed.
 */
export function alliancesIncompleteNotice(incomplete: number, total: number, algorithmLabel: string): string {
  const isSingular = incomplete === 1;
  const verb = isSingular ? "is" : "are";
  const possessive = isSingular ? "its" : "their";
  return `${incomplete} of ${total} alliances ${verb} missing a combined value because one of ${possessive} first three picks has no published ${algorithmLabel} total.`;
}

/**
 * `formatAllianceRecord(record)`: wins-losses-ties joined by hyphens,
 * mirroring `apps/web/src/components/event/InsightsTab.tsx`'s
 * `formatEventRecord` (restated, not imported, following that function's
 * own established precedent of copying across the event/ module boundary
 * rather than reaching into a sibling tab file) — G-8's alliance-level
 * counterpart. IN-05 (260902-post-phase08-ungoverned-ui/REVIEW.md): corrects
 * this comment's own prior claim that `undefined` renders "a single
 * em-dash" — it does not; it returns the EMPTY STRING below. The argument
 * this comment exists to preserve still holds under the correction: an
 * event with no playoff bracket yet, or a `status` shape
 * `parseAllianceRecord` does not recognise, are both honest absences, and an
 * empty string is that absence rendered honestly — never a fabricated
 * `0-0-0`.
 */
export function formatAllianceRecord(record: { wins: number; losses: number; ties: number } | undefined): string {
  if (record === undefined) return "";
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/**
 * G-8: the corrected column labels. `picks[1]`/`picks[2]` had been rendered
 * under the headers "Pick 2"/"Pick 3" — off by one against TBA's own
 * `picks` array, where index 1 is the FIRST additional pick. Treated as a
 * correctness fix, not cosmetics. "Backup" is renamed "Pick 3" (the backup
 * robot is FRC's third overall pick) — the column id `pickBackup` is
 * unchanged (external e2e tests key off it), only its header label moves.
 *
 * Quick task 260913-jkp: index 5 (Combined Total) now varies by algorithm —
 * "Combined Total ± Sigma" under a Sigma-enabled algorithm, "Combined Total"
 * otherwise — so this is a FUNCTION of `algorithmId`, read by both the live
 * table and the skeleton, rather than a static tuple either could drift from.
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
 * D-7 pick-column widths (2026-09-04, quick task 260904-5zg), measured live
 * against the deployed 2026mrcmp EPA/VPR rosters plus a full-corpus sweep of
 * every 2026 alliance's real published totals (a throwaway measurement
 * script, deleted before this task's commit). A pick cell's content is
 * `teamNumber` + the widened `--spacing-sm` gap (8px, see `PickCell`'s own
 * comment) + the pick's tiered total.
 *
 * Quick task 260913-jkp RETIRES the VPR-era spread gate
 * (`algorithmPublishesSpread`) in favour of `usesSigmaScore`: the pick cell
 * now renders the split pill (`TotalSigmaValue`), whose width is what needs
 * headroom, not a per-metric algorithm spread (which no algorithm has
 * published since VPR's 2026-09-09 retirement). `PICK_COLUMN_WIDTH_SIGMA_PX`
 * (214) replaces the old spread-carrying `PICK_COLUMN_WIDTH_PX` (190): a
 * pick cell's content is `teamNumber` (51.88px) + the 8px gap + the pill
 * itself (130.31px, `TotalSigmaValue.tsx`'s own measurement block, worst
 * case "425.67" | "±92.00"). 51.88 + 8 + 130.31 = 190.19px content + 16px
 * `TableCell` `p-2` padding + 6px cross-browser font-hinting buffer =
 * 212.19, rounded up to 214.
 *
 * `PICK_COLUMN_WIDTH_SPREADLESS_PX` (150, unchanged — EPA/OPR): neither
 * publishes Sigma, so the pick cell stays a bare boxed value at 65.16px (the
 * same measured width `METRIC_COLUMN_WIDTH_SPREADLESS_PX` derives from).
 * 51.88 + 8 + 65.16 = 125.04px content + 16px padding + 6px buffer = 147.04,
 * rounded up to 150.
 */
export const PICK_COLUMN_WIDTH_SIGMA_PX = 214;
export const PICK_COLUMN_WIDTH_SPREADLESS_PX = 150;

function pickColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? PICK_COLUMN_WIDTH_SIGMA_PX : PICK_COLUMN_WIDTH_SPREADLESS_PX;
}

/**
 * D-7 Combined Total column widths, same measurement pass as the pick
 * columns above. `CombinedCell` carries no team-number span — it is a
 * single `TotalSigmaValue`, so its content is exactly one pill's rendered
 * width, no gap to add.
 *
 * Quick task 260913-jkp: `COMBINED_COLUMN_WIDTH_SIGMA_PX` (180) replaces the
 * old spread-carrying `COMBINED_COLUMN_WIDTH_PX` (130) — the combined cell
 * now renders the split pill too, with the neutral Sigma band as its right
 * half. The real worst case is `TotalSigmaValue.tsx`'s own measured "1024.22"
 * | "±235.26" pill, 148.47px boxed. The "COMBINED TOTAL ± SIGMA" header needs
 * 178.34px (measured against the real `.th-cell-label` uppercase treatment,
 * including its own padding) and binds ahead of the value's own 148.47 + 16 +
 * 6 = 170.47px — 178.34 rounded up to 180.
 *
 * `COMBINED_COLUMN_WIDTH_SPREADLESS_PX` (128, unchanged — EPA/OPR): neither
 * publishes Sigma, so the combined cell stays a bare boxed value, and the
 * live-measured "COMBINED TOTAL" header (123.53px including its own padding)
 * remains the binding constraint, unchanged from before this task.
 */
export const COMBINED_COLUMN_WIDTH_SIGMA_PX = 180;
export const COMBINED_COLUMN_WIDTH_SPREADLESS_PX = 128;

function combinedColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? COMBINED_COLUMN_WIDTH_SIGMA_PX : COMBINED_COLUMN_WIDTH_SPREADLESS_PX;
}

/**
 * Quick task 260913-jkp: the backup ("Pick 3"/`pickBackup`) column's width
 * also now gates on `usesSigmaScore` rather than the retired spread
 * predicate — `BackupCell` renders the same split pill `PickCell` does.
 * `BACKUP_COLUMN_WIDTH_SIGMA_PX` (274): `teamNumber` (51.88px) + the 8px gap
 * + the pill (130.31px) + the 8px gap + the "(backup)" label (52.11px,
 * measured live at 12px/600 weight) = 242.30px content + 16px padding + 6px
 * buffer = 264.30 — measured for the ONE-backup-per-row case (the width
 * case; more than one backup wraps, as it did before this task), rounded up
 * to 274 for a clean number with a couple of spare pixels. The other
 * algorithms' backup width (240, unchanged) never carried a Sigma pill and
 * needs no re-derivation.
 */
export const BACKUP_COLUMN_WIDTH_SIGMA_PX = 274;
export const BACKUP_COLUMN_WIDTH_PX = 240;

function backupColumnWidth(algorithmId: string): number {
  return usesSigmaScore(algorithmId) ? BACKUP_COLUMN_WIDTH_SIGMA_PX : BACKUP_COLUMN_WIDTH_PX;
}

/**
 * Registered once, module-level (05-04-SUMMARY.md's v9 API note, restated by
 * every sibling tab's own header comment): pinning offsets require
 * `columnSizingFeature` registered alongside `columnPinningFeature`, or
 * `getStart`/`getSize` do not exist at all. At/above the breakpoint nothing
 * is pinned — at seven columns there is no leading group worth freezing.
 * Below `MOBILE_BREAKPOINT_PX` the single `Alliance #` column pins
 * (07-UI-REVIEW priority fix 2): this tab's own stated purpose — "which
 * alliance is strongest" — requires reading Combined Total, which sits four
 * columns past a 390px viewport's edge with nothing anchoring which row the
 * reader is on. One 84px 2-digit column is cheap, and mirrors the
 * identity-pinning pattern already proven safe on Insights/Breakdown/Teams
 * (G-1/G-2/G-11).
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, AllianceRow>();

/**
 * One pick's team number plus its own tiered total metric — G-8 drops the
 * nickname this cell used to render alongside the number.
 *
 * `gap-[var(--spacing-sm)]` (D-7, 260904-5zg, up from `--spacing-xs`): the
 * user's own complaint — "EPA is too close to team number" — was a real,
 * measured 4px gap; live-measured against the deployed 2026mrcmp EPA/VPR
 * rosters, doubling it to 8px gives the number and its metric deliberate
 * separation without threatening `PICK_COLUMN_WIDTH_SIGMA_PX`'s own measured
 * budget (that constant's own doc comment accounts for this exact gap).
 *
 * Quick task 260913-jkp: the pick's own total renders through
 * `TotalSigmaValue`, tiered on its own percentile, with its own published
 * Sigma Score (`pick.sigma`) as the pill's right half — degrading to a plain
 * tier-boxed value, unchanged, whenever `pick.sigma` is `undefined` (every
 * OPR/EPA pick, and an SPR pick this event has none for).
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
 * alliance selection. G-8 adds the same tiered total metric `PickCell`
 * renders, dropping the nickname this cell never carried in the first
 * place. Quick task 260913-jkp: the same `TotalSigmaValue` pill as
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
          // Same D-7 gap widening as PickCell's identical inner Link.
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
 * The Combined Total cell (G-8; widened quick task 260904-7rt, sketch 008
 * winner C): the published `√(Σσ²)` value through `TotalSigmaValue`, tiered
 * by the 3x heuristic's APPROXIMATE percentile when one is available, plus
 * a small, quiet marker disclosing the approximation — never a loud banner,
 * matching the sketch-findings skill's "serious tool, more alive" direction.
 * The disclosure attaches whenever a tier BOX is actually drawn. Before
 * 260904-7rt, Common drew no box at all, so there was nothing to qualify
 * there; post-260904-7rt a Common combined total now draws the hairline
 * ring too, and its tier is just as approximate as any other, so it is
 * disclosed on the same terms — the rule ("disclose whenever a box is
 * drawn") did not change, only which tiers draw one. It carries
 * `role="group"` plus `title` and `aria-label` so it reaches a mouse-hover
 * reader and a screen-reader user alike (mirrors `BonusRpDots.tsx`'s own
 * role+title+aria-label trio).
 *
 * Quick task 260913-jkp, CONTEXT "Alliances Combined Total": `sigma` is the
 * ROW's `combinedSigma` (`buildAllianceRows`'s all-or-nothing `√(3 * ΣSigma²)`
 * band), passed with `neutral: true` — there is no percentile for a
 * three-team band, so `TotalSigmaValue` gives it the untiered slate half
 * rather than inventing a tier. `undefined` degrades the cell to today's
 * plain `TotalSigmaValue` no-sigma path, byte-identical to before this task.
 */
function CombinedCell({ metric, approx, sigma }: { metric: DisplayMetric | undefined; approx: AllianceApproxTier | undefined; sigma: number | undefined }) {
  const boxed = approx !== undefined;
  // 2026-09-01 (user request): the visible "≈" glyph is gone. The tier is
  // still a 3x-heuristic APPROXIMATION (see `@/lib/allianceTierApproximation`),
  // so the disclosure survives invisibly — hover/assistive tech reach it via
  // the cell's own title/aria-label whenever a box is drawn.
  //
  // CR-02 (review 260902): `role="group"` is load-bearing, not decoration. A
  // <span> with no role maps to `role="generic"`, on which `aria-label` is a
  // PROHIBITED attribute under ARIA 1.2 / ARIA-in-HTML — browsers drop it from
  // the accessibility tree, so the label announced nothing at all and `title`
  // (hover-only, unreachable on touch) was the whole disclosure in practice.
  // `BonusRpDots.tsx:58` supplies the role alongside its label, which is
  // exactly what makes THAT label expose; this comment used to claim it
  // mirrored that pairing while omitting the one attribute that carries it.
  // The role is conditional for the same reason the label is: an unboxed cell
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
 * at all (Task 2, quick task 260902-ixg). Measured on `2026iscmp`: the
 * column was 240px wide and empty in all 8 of 8 rows — dead space on every
 * event without a backup robot, which is most of them. Computed over the
 * WHOLE table, not per-row: an event where only some alliances carry a
 * backup still shows the column (with a blank cell on the rows that lack
 * one) — a column that disappears when it should appear is the worse bug.
 */
function hasAnyBackupPick(rows: readonly AllianceRow[]): boolean {
  return rows.some((row) => row.picks.slice(ALLIANCE_COMBINED_PICK_COUNT).length > 0);
}

function buildAllianceColumns(algorithmId: string, season: number, showBackupColumn: boolean) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) — the same loose-cast
  // escape hatch every sibling tab already uses for a value the type system
  // widened to plain `string` crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;
  const headers = alliancesColumnHeaders(algorithmId);

  return columnHelper.columns([
    columnHelper.accessor("allianceNumber", {
      id: "allianceNumber",
      header: headers[0],
      // 88 (Task 3, 260902-ixg), not 112 and not the 84 that truncated (the
      // 2026-09-01 report that produced 112): the uppercase 11px
      // "ALLIANCE #" header's own intrinsic text is 72px plus 16px cell
      // padding — 88 is exactly its requirement with nothing to spare.
      // Verified live: no ellipsis renders at 88.
      size: 88,
      cell: (info) => <span className="numeric-cell">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.picks[0], {
      id: "pick0",
      header: headers[1],
      // D-1's `metricColumnWidth` predicate, reused here (`pickColumnWidth`,
      // 260904-5zg) — see that constant's own doc comment for the measured
      // derivation.
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
    // Task 2 (260902-ixg): included only when `hasAnyBackupPick` found one —
    // `AlliancesTabSkeleton` below cannot know this and always renders all
    // seven, deliberately (see its own doc comment).
    ...(showBackupColumn
      ? [
          columnHelper.accessor((row) => row.picks.slice(ALLIANCE_COMBINED_PICK_COUNT), {
            id: "pickBackup",
            header: headers[4],
            // Quick task 260913-jkp: `backupColumnWidth` gates on `usesSigmaScore`
            // — see that function's own doc comment.
            size: backupColumnWidth(algorithmId),
            cell: (info) => <BackupCell picks={info.getValue()} season={season} algorithm={algorithm} />,
          }),
        ]
      : []),
    columnHelper.accessor("combined", {
      id: "combined",
      header: headers[5],
      // D-7 (260904-5zg): down from the pre-existing 160 — `combinedColumnWidth`'s
      // own doc comment has the full-corpus measured derivation.
      size: combinedColumnWidth(algorithmId),
      cell: (info) => <CombinedCell metric={info.getValue()} approx={info.row.original.combinedApproxTier} sigma={info.row.original.combinedSigma} />,
    }),
    columnHelper.accessor("record", {
      id: "record",
      header: headers[6],
      // 72 (Task 3, 260902-ixg), not 100: header "RECORD" needs 66px,
      // widest content ("4-3-0" etc.) needs 62px — 72 covers both with cell
      // padding to spare. Re-measured for D-7 (260904-5zg) against a
      // full-corpus sweep of every 2026 alliance record: the real worst case
      // is still single-digit-per-field ("6-4-1", 5 characters) — 72 already
      // covers it, unchanged.
      size: 72,
      cell: (info) => <span className="numeric-cell">{formatAllianceRecord(info.getValue())}</span>,
    }),
  ]);
}

export interface AlliancesTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

export const ALLIANCES_SKELETON_ROW_COUNT = 6;

/**
 * The pending state's placeholder — inside the same scroll-region wrapper
 * shape the populated tab uses. Always renders the full seven-header set,
 * `pickBackup` included, even though the populated tab (Task 2, 260902-ixg)
 * hides that column when no alliance has a backup pick: the skeleton cannot
 * know the data yet, and a placeholder that guessed wrong would shift the
 * layout twice — once when the guess is wrong, once when the real column
 * count lands. Rendering all seven every time is one layout shift, not two.
 */
export function AlliancesTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  void season;
  // Quick task 260913-jkp: the Combined Total header now varies by
  // algorithm too (`alliancesColumnHeaders`, the same derivation the live
  // table uses), so nothing shifts once real data lands under a
  // Sigma-enabled algorithm.
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
 * The Alliances tab: a six- or seven-column table (Task 2, 260902-ixg: the
 * seventh, `pickBackup`, renders only when at least one alliance in the
 * table actually has a backup pick — most events do not) in its own native
 * scroll region (a DOM SIBLING of the tab strip's own scroll region, never
 * its ancestor or descendant — D-15's independence caveat that used to sit
 * beneath it was retired 2026-09-02, quick task 260902-ixg, see
 * 07-UI-SPEC.md), and Task 2's incomplete-combination notice when (and only
 * when) at least one row cannot combine. Reads no match array of any kind
 * and performs no arithmetic on any published quantity other than
 * `combineAlliancePicks`'s three-term combination and G-8's client-side 3x
 * tier approximation. Every string originating in the published artifact
 * renders as a plain JSX text node or a `title` attribute value — never
 * through a raw-markup sink.
 */
export function AlliancesTab({ artifact, algorithmId, season }: AlliancesTabProps) {
  const rows = useMemo(() => buildAllianceRows(artifact, algorithmId), [artifact, algorithmId]);
  const showBackupColumn = useMemo(() => hasAnyBackupPick(rows), [rows]);
  const columns = useMemo(() => buildAllianceColumns(algorithmId, season, showBackupColumn), [algorithmId, season, showBackupColumn]);

  // 07-UI-REVIEW priority fix 2: pin the identity column below the sitewide
  // breakpoint only — see the `features` doc comment above for the rationale.
  const isNarrow = useIsMobile();
  const columnPinning = useMemo(() => ({ start: isNarrow ? ["allianceNumber"] : [], end: [] }), [isNarrow]);

  const table = useTable({ features, columns, data: rows, state: { columnPinning } });

  const incompleteCount = rows.filter((row) => !row.combinable).length;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <div data-testid="alliances-table-scroll" className="data-card w-fit max-w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        {/*
          07-UAT.md G-1 originally left this table on `table-layout: auto`,
          because the pick columns relied on auto layout's free growth to
          show a full nickname — measured live, that growth was hiding a
          real flex/`min-width:0` truncation gap underneath. G-8 (2026-08-30,
          real-device UAT) drops the nickname entirely, which removes the
          reason `auto` was chosen: every pick cell now renders only a team
          number plus a bounded metric cell (`MetricValue`, or, since quick
          task 260913-jkp under a Sigma-enabled algorithm, `TotalSigmaValue`'s
          pill) whose width is bounded by CSS (`.metric-tier`'s own
          `min-width: 80px`, `.metric-pill`'s own halves, never free-growing
          text).
          Re-evaluated and switched to `table-layout: fixed` here, matching
          every other event table (Insights/Breakdown/TeamsTable, G-1's own
          fix). Since 07-UI-REVIEW fix 2 this table pins `Alliance #` below
          the breakpoint, so `fixed` is now load-bearing the same way it is
          on Insights: it keeps the pinned column's sticky `left` offset in
          sync with where its neighbour actually renders (G-1's own lesson).

          Task 3 (260902-ixg): `width` is the EXACT sum of the column sizes
          (`table.getTotalSize()`), never `100%`. Live-measured regression:
          with `width: "100%"` + `minWidth: table.getTotalSize()` (the
          pattern Insights/Breakdown/TeamsTable still use, where the column
          sum is close enough to the page's available width that this never
          surfaces), shrinking this tab's columns below the ~1150px content
          area let `100%` win over `minWidth`, and `table-layout: fixed`
          redistributed the freed space proportionally BACK across every
          column — the 88px Alliance # column rendered at 113.7px live,
          silently undoing the whole point of tightening it. An explicit
          pixel `width` is simultaneously the floor (the wrapper's own
          `overflow-x-auto` still engages below it, unchanged) and the
          ceiling (never stretches past it) — exactly what "tightened
          spacing" means for a table this small.
        */}
        <table style={{ width: table.getTotalSize(), tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const pinned = header.column.getIsPinned() === "start";
                  return (
                    <TableHead
                      key={header.id}
                      data-testid={`alliances-header-${header.column.id}`}
                      className="text-role-label truncate"
                      style={{
                        width: header.getSize(),
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? header.getStart("start") : undefined,
                        zIndex: pinned ? 4 : 3,
                        background: "var(--color-bg-surface)",
                      }}
                    >
                      <table.FlexRender header={header} />
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="alliances-row" data-alliance-number={row.original.allianceNumber}>
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned() === "start";
                  return (
                    <TableCell
                      key={cell.id}
                      data-testid={`alliances-cell-${cell.column.id}`}
                      className="text-role-body"
                      style={{
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? cell.column.getStart("start") : undefined,
                        zIndex: pinned ? 1 : undefined,
                        background: pinned ? "var(--color-bg-surface)" : undefined,
                      }}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
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
