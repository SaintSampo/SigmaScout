/**
 * The Alliances tab (EVNT-05, 07-14-PLAN.md): one row per published alliance
 * in TBA's own seed order, columns Alliance # / Captain / Pick 1 / Pick 2 /
 * Pick 3 / Combined Total / Record. This is the ONLY component in the
 * application that computes a number rather than rendering a published
 * one — the authority is D-15, not convenience. It is legitimate here
 * (while 07-01 forbids the identical move on Breakdown) because an
 * alliance's cross-team covariance is zero by the model's own construction
 * — `packages/core/algorithms/sigma1/covariance.ts`'s header states the
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
import { MetricValue, type DisplayMetric } from "@/components/MetricValue";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { teamNumberFromKey } from "@/lib/teamKey";
import { tierForPercentile } from "@/lib/tiers";
import { buildTeamValuePercentilePoints, estimateCombinedTier, type AllianceApproxTier } from "@/lib/allianceTierApproximation";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

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
 * incidental gap in this one function: `packages/core/algorithms/sigma1/
 * covariance.ts`'s own header states the model computes covariance only
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
 * this large. `ALLIANCES_INDEPENDENCE_CAVEAT` below says so in the reader's
 * own words, unconditionally, beneath the table.
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
  // than unknown — the opposite of the em-dash this function returns above.
  const value = resolved.reduce((sum, total) => sum + total.value, 0);
  const allSpreadsPresent = resolved.every((total) => total.spread !== undefined);
  if (!allSpreadsPresent) {
    return { value };
  }
  // The square root is applied EXACTLY ONCE, to the summed variances —
  // never to an individual term and never twice. Sum in full floating point
  // from the published values: no rounding, re-rounding or rescaling of any
  // input, and no rounding of the intermediate sum — `MetricValue` restores
  // display digits at the end and the pipeline already rounded once at the
  // publish boundary.
  const varianceSum = resolved.reduce((sum, total) => sum + total.spread! * total.spread!, 0);
  return { value, spread: Math.sqrt(varianceSum) };
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
 * 07-UI-SPEC.md's Copywriting Contract D-15 row, verbatim — the ONLY place
 * this sentence appears in source. Unconditional page content: never a
 * tooltip, never a title attribute, never behind a disclosure.
 * `packages/core/algorithms/sigma1/covariance.ts`'s own header states the
 * model's covariance is never between teams, so the zero cross-team
 * covariance this arithmetic assumes is the model's construction rather than
 * an unpublished quantity; every real correlation between teammates is
 * positive, so the published σ is a floor. UNCHANGED by G-8 — the
 * arithmetic behind it did not change, only its documentation did (see
 * `combineAlliancePicks`'s own doc comment).
 */
export const ALLIANCES_INDEPENDENCE_CAVEAT =
  "Combined values assume each robot's performance is independent of its alliance partners. Real alliances are not fully independent, so the true uncertainty is likely larger than shown.";

/**
 * G-8's approximate-tier disclosure, surfaced as a `title`/`aria-label` on
 * the small marker next to a tiered Combined Total (never a bolted-on
 * banner — "quiet and consistent with the design language" per the
 * sketch-findings skill's stated direction). Cites the same reasoning
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
 * counterpart. `undefined` renders a single em-dash: an event with no
 * playoff bracket yet, or a `status` shape `parseAllianceRecord` does not
 * recognise, are both honest absences, never a fabricated `0-0-0`.
 */
export function formatAllianceRecord(record: { wins: number; losses: number; ties: number } | undefined): string {
  if (record === undefined) return "—";
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/**
 * G-8: the corrected column labels. `picks[1]`/`picks[2]` had been rendered
 * under the headers "Pick 2"/"Pick 3" — off by one against TBA's own
 * `picks` array, where index 1 is the FIRST additional pick. Treated as a
 * correctness fix, not cosmetics. "Backup" is renamed "Pick 3" (the backup
 * robot is FRC's third overall pick) — the column id `pickBackup` is
 * unchanged (external e2e tests key off it), only its header label moves.
 */
const ALLIANCES_COLUMN_HEADERS = ["Alliance #", "Captain", "Pick 1", "Pick 2", "Pick 3", "Combined Total", "Record"] as const;

/**
 * Registered once, module-level (05-04-SUMMARY.md's v9 API note, restated by
 * every sibling tab's own header comment): pinning offsets require
 * `columnSizingFeature` registered alongside `columnPinningFeature`, or
 * `getStart`/`getSize` do not exist at all. Pin nothing here — at seven
 * columns there is no leading group worth freezing.
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, AllianceRow>();

/** One pick's team number plus its own tiered total metric — G-8 drops the nickname this cell used to render alongside the number. */
function PickCell({ pick, season, algorithm }: { pick: AlliancePick | undefined; season: number; algorithm: PublishedAlgorithmId }) {
  if (pick === undefined) {
    return <span className="numeric-cell">{"—"}</span>;
  }
  return (
    <Link
      to="/team/$teamNumber"
      params={{ teamNumber: String(pick.teamNumber) }}
      search={{ year: season, algorithm, tab: "overview" }}
      className="flex items-center gap-[var(--spacing-xs)]"
    >
      <span className="numeric-cell">{pick.teamNumber}</span>
      <MetricValue metric={pick.total} tier={tierForPercentile(pick.total?.percentile)} />
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
 * place.
 */
function BackupCell({ picks, season, algorithm }: { picks: AlliancePick[]; season: number; algorithm: PublishedAlgorithmId }) {
  if (picks.length === 0) {
    return <span className="numeric-cell">{"—"}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-[var(--spacing-sm)]">
      {picks.map((pick) => (
        <Link
          key={pick.teamKey}
          to="/team/$teamNumber"
          params={{ teamNumber: String(pick.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          className="flex items-center gap-[var(--spacing-xs)]"
        >
          <span className="numeric-cell">{pick.teamNumber}</span>
          <MetricValue metric={pick.total} tier={tierForPercentile(pick.total?.percentile)} />
          <span className="text-role-label text-[var(--color-text-muted)]">{"(backup)"}</span>
        </Link>
      ))}
    </span>
  );
}

/**
 * The Combined Total cell (G-8): the published `√(Σσ²)` value/spread through
 * `MetricValue`, tiered by the 3x heuristic's APPROXIMATE percentile when
 * one is available, plus a small, quiet marker disclosing the
 * approximation — never a loud banner, matching the sketch-findings skill's
 * "serious tool, more alive" direction. The marker renders only when a tier
 * BOX is actually drawn (Common renders no box at all, so there is nothing
 * for the marker to qualify); it carries both `title` and `aria-label` so
 * the disclosure reaches a mouse-hover reader and a screen-reader user
 * alike (mirrors `BonusRpDots.tsx`'s own title+aria-label pairing).
 */
function CombinedCell({ metric, approx }: { metric: DisplayMetric | undefined; approx: AllianceApproxTier | undefined }) {
  const boxed = approx !== undefined && approx.tier !== "common";
  return (
    <span className="flex items-center gap-[var(--spacing-xs)]">
      <MetricValue metric={metric} tier={approx?.tier} />
      {boxed && (
        <span
          data-testid="alliances-combined-approx-marker"
          className="text-role-label text-[var(--color-text-muted)]"
          title={ALLIANCE_APPROX_TIER_DISCLOSURE}
          aria-label={ALLIANCE_APPROX_TIER_DISCLOSURE}
        >
          {"≈"}
        </span>
      )}
    </span>
  );
}

function buildAllianceColumns(algorithmId: string, season: number) {
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) — the same loose-cast
  // escape hatch every sibling tab already uses for a value the type system
  // widened to plain `string` crossing a component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;

  return columnHelper.columns([
    columnHelper.accessor("allianceNumber", {
      id: "allianceNumber",
      header: ALLIANCES_COLUMN_HEADERS[0],
      size: 84,
      cell: (info) => <span className="numeric-cell">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.picks[0], {
      id: "pick0",
      header: ALLIANCES_COLUMN_HEADERS[1],
      size: 190,
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor((row) => row.picks[1], {
      id: "pick1",
      header: ALLIANCES_COLUMN_HEADERS[2],
      size: 190,
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor((row) => row.picks[2], {
      id: "pick2",
      header: ALLIANCES_COLUMN_HEADERS[3],
      size: 190,
      cell: (info) => <PickCell pick={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor((row) => row.picks.slice(ALLIANCE_COMBINED_PICK_COUNT), {
      id: "pickBackup",
      header: ALLIANCES_COLUMN_HEADERS[4],
      size: 240,
      cell: (info) => <BackupCell picks={info.getValue()} season={season} algorithm={algorithm} />,
    }),
    columnHelper.accessor("combined", {
      id: "combined",
      header: ALLIANCES_COLUMN_HEADERS[5],
      size: 160,
      cell: (info) => <CombinedCell metric={info.getValue()} approx={info.row.original.combinedApproxTier} />,
    }),
    columnHelper.accessor("record", {
      id: "record",
      header: ALLIANCES_COLUMN_HEADERS[6],
      size: 100,
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

/** The pending state's placeholder — the seven real headers above skeleton rows, inside the same scroll-region wrapper shape the populated tab uses. */
export function AlliancesTabSkeleton({ algorithmId, season }: { algorithmId: string; season: number }) {
  void algorithmId;
  void season;
  return (
    <div data-testid="alliances-table-scroll" className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
        <TableHeader>
          <TableRow>
            {ALLIANCES_COLUMN_HEADERS.map((label) => (
              <TableHead key={label} className="text-role-label truncate">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <SkeletonRows rows={ALLIANCES_SKELETON_ROW_COUNT} columns={ALLIANCES_COLUMN_HEADERS.length} />
        </TableBody>
      </table>
    </div>
  );
}

/**
 * The Alliances tab: the seven-column table in its own native scroll region
 * (a DOM SIBLING of the tab strip's own scroll region, never its ancestor or
 * descendant), D-15's independence caveat unconditionally beneath it, and
 * Task 2's incomplete-combination notice when (and only when) at least one
 * row cannot combine. Reads no match array of any kind and performs no
 * arithmetic on any published quantity other than `combineAlliancePicks`'s
 * three-term combination and G-8's client-side 3x tier approximation. Every
 * string originating in the published artifact renders as a plain JSX text
 * node or a `title` attribute value — never through a raw-markup sink.
 */
export function AlliancesTab({ artifact, algorithmId, season }: AlliancesTabProps) {
  const rows = useMemo(() => buildAllianceRows(artifact, algorithmId), [artifact, algorithmId]);
  const columns = useMemo(() => buildAllianceColumns(algorithmId, season), [algorithmId, season]);

  const table = useTable({ features, columns, data: rows });

  const incompleteCount = rows.filter((row) => !row.combinable).length;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <div data-testid="alliances-table-scroll" className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        {/*
          07-UAT.md G-1 originally left this table on `table-layout: auto`,
          because the pick columns relied on auto layout's free growth to
          show a full nickname — measured live, that growth was hiding a
          real flex/`min-width:0` truncation gap underneath. G-8 (2026-08-30,
          real-device UAT) drops the nickname entirely, which removes the
          reason `auto` was chosen: every pick cell now renders only a team
          number plus a `MetricValue` whose width is bounded by CSS
          (`.metric-tier`'s own `min-width: 80px`, never free-growing text).
          Re-evaluated and switched to `table-layout: fixed` here, matching
          every other event table (Insights/Breakdown/TeamsTable, G-1's own
          fix) — this table has no pinned columns, so there is no
          sticky-offset defect either layout choice could introduce or fix;
          the only property in play is declared-vs-actual column width, and
          `fixed` makes them equal by construction.
        */}
        <table style={{ width: "100%", tableLayout: "fixed", minWidth: table.getTotalSize(), borderCollapse: "separate", borderSpacing: 0 }}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} data-testid={`alliances-header-${header.column.id}`} className="text-role-label truncate" style={{ width: header.getSize() }}>
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
      <p data-testid="alliances-independence-caveat" className="text-role-body text-[var(--color-text-muted)]">
        {ALLIANCES_INDEPENDENCE_CAVEAT}
      </p>
      {incompleteCount > 0 && (
        <div
          data-testid="alliances-incomplete-notice"
          className="flex items-center gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-surface)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-body text-[var(--color-text-muted)]"
        >
          <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{alliancesIncompleteNotice(incompleteCount, rows.length, algorithmDisplayLabel(algorithmId as PublishedAlgorithmId))}</span>
        </div>
      )}
    </div>
  );
}
