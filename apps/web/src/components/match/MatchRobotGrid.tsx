import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricValue } from "@/components/MetricValue";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { METRIC_GROUPS } from "../../lib/metricGroups.js";
import { TOTAL_KEY } from "../../lib/metricKeys.js";
import { metricDisplayLabel } from "../../lib/metricLabels.js";
import { tierForPercentile } from "../../lib/tiers.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import type { PreMatchBasis, PreMatchMetrics } from "../../lib/preMatchMetrics.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/**
 * The match page's six-robot grid (260909-tiq-PLAN.md Task 2, D-02). A PURE
 * function of its props — no fetching inside this component, so its test
 * needs no query client; `match.$matchKey.tsx` is the one place that fetches
 * the six team-season artifacts and builds `byTeamKey`.
 *
 * Reuses `SeasonHeader.tsx`'s robot-image Avatar pattern verbatim (D-02): the
 * error-triggered fallback branch, where `AvatarImage` is rendered only when
 * `robotImageUrl` is present and Radix itself swaps to `AvatarFallback` on
 * any load failure.
 */
export interface MatchRobotRecord {
  artifact?: TeamSeasonArtifact;
  preMatch?: PreMatchMetrics;
  isPending: boolean;
}

export interface MatchRobotGridProps {
  redTeams: readonly string[];
  blueTeams: readonly string[];
  byTeamKey: Readonly<Record<string, MatchRobotRecord>>;
  season: number;
  algorithm: PublishedAlgorithmId;
}

/** Combined as-of wording when all six cards agree on one basis. */
const COMBINED_BASIS_NOTE: Readonly<Record<PreMatchBasis, string>> = {
  "before-this-match": "These are each team's ratings going into this match.",
  "latest-played": "This match has not been played yet; these are each team's ratings as of its most recent played match.",
};

/** Per-card as-of wording, used only when the six cards disagree on basis (never alongside the combined note). */
const PER_CARD_BASIS_NOTE: Readonly<Record<PreMatchBasis, string>> = {
  "before-this-match": "As of immediately before this match",
  "latest-played": "As of its most recent played match",
};

const NO_PRE_MATCH_METRICS_NOTE = "No pre-match metrics for this team.";

/** A roster key's displayed number, falling back to the raw key when it does not match the `frc{number}` shape — the same construction `EventMatchTable.tsx`'s own `rosterNumberLabel` uses. */
function robotNumberLabel(teamKey: string): string {
  try {
    return `${teamNumberFromKey(teamKey)}`;
  } catch {
    return teamKey;
  }
}

function robotNickname(artifact: MatchRobotRecord["artifact"], numberLabel: string): string {
  if (artifact === undefined || artifact.nickname === "") return `Team ${numberLabel}`;
  return artifact.nickname;
}

interface MetricCellSpec {
  key: string;
  label: string;
}

/** `METRIC_GROUPS` then `TOTAL_KEY`, matching `SeasonHeader.tsx`'s own tile order — Auto, Teleop, Endgame, Total. */
const METRIC_CELLS: readonly MetricCellSpec[] = [
  ...METRIC_GROUPS.map((group) => ({ key: group.metricKey, label: group.label })),
  { key: TOTAL_KEY, label: metricDisplayLabel(TOTAL_KEY) },
];

function RobotMetricCells({ preMatch, isPending }: { preMatch: PreMatchMetrics | undefined; isPending: boolean }) {
  if (isPending) {
    return (
      <div className="flex flex-wrap gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-xs)]">
        {METRIC_CELLS.map((cell) => (
          <div key={cell.key} className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
            <span className="text-role-label text-[var(--color-text-muted)]">{cell.label}</span>
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-xs)]">
      {METRIC_CELLS.map((cell) => {
        const entry = preMatch?.metrics[cell.key];
        return (
          <div key={cell.key} className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
            <span className="text-role-label text-[var(--color-text-muted)]">{cell.label}</span>
            {/* Plan-wide rule 3: `metric` and `tier` ONLY — no `swingScore`, ever, on this page. */}
            <MetricValue metric={entry} tier={tierForPercentile(entry?.percentile)} />
          </div>
        );
      })}
      {preMatch === undefined && <p className="text-role-label text-[var(--color-text-muted)] basis-full">{NO_PRE_MATCH_METRICS_NOTE}</p>}
    </div>
  );
}

function RobotCard({
  teamKey,
  side,
  record,
  season,
  algorithm,
  showPerCardBasisNote,
}: {
  teamKey: string;
  side: "red" | "blue";
  record: MatchRobotRecord;
  season: number;
  algorithm: PublishedAlgorithmId;
  showPerCardBasisNote: boolean;
}) {
  const numberLabel = robotNumberLabel(teamKey);
  const nickname = robotNickname(record.artifact, numberLabel);

  return (
    <div data-testid={`robot-card-${teamKey}`} className={cn("data-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)]")}>
      <div className="flex min-w-0 items-center gap-[var(--spacing-sm)]">
        {/* Robot image (D-02) — the identical error-triggered fallback branch
            `SeasonHeader.tsx` renders: `AvatarImage` only when
            `robotImageUrl` is present, Radix itself swaps to
            `AvatarFallback` on any load failure. */}
        <Avatar className="size-16 shrink-0 rounded-[var(--radius)] after:rounded-[var(--radius)]">
          {record.artifact?.robotImageUrl !== undefined && (
            <AvatarImage src={record.artifact.robotImageUrl} alt={`${nickname} robot photo`} className="rounded-[var(--radius)]" />
          )}
          <AvatarFallback
            role="img"
            aria-label={`No robot photo available for team ${numberLabel}`}
            className="rounded-[var(--radius)] bg-[var(--color-bg-surface)]"
          />
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <Link
            to="/team/$teamNumber"
            params={{ teamNumber: numberLabel }}
            search={{ year: season, algorithm, tab: "overview" }}
            className={cn("numeric-cell text-role-body hover:underline", side === "red" ? "text-[var(--alliance-red)]" : "text-[var(--alliance-blue)]")}
          >
            {numberLabel}
          </Link>
          <span title={nickname} className="text-role-label min-w-0 truncate text-[var(--color-text-muted)]">
            {nickname}
          </span>
        </div>
      </div>
      {showPerCardBasisNote && record.preMatch !== undefined && (
        <span className="text-role-label text-[var(--color-text-muted)]">{PER_CARD_BASIS_NOTE[record.preMatch.basis]}</span>
      )}
      <RobotMetricCells preMatch={record.preMatch} isPending={record.isPending} />
    </div>
  );
}

export function MatchRobotGrid({ redTeams, blueTeams, byTeamKey, season, algorithm }: MatchRobotGridProps) {
  const allKeys = [...redTeams, ...blueTeams];
  const resolvedBases = allKeys
    .map((key) => byTeamKey[key]?.preMatch)
    .filter((preMatch): preMatch is PreMatchMetrics => preMatch !== undefined)
    .map((preMatch) => preMatch.basis);
  const uniqueBases = new Set(resolvedBases);
  // Exactly one distinct basis among the resolved cards -> one shared
  // combined line. Two distinct bases -> the combined line is withheld and
  // each card states its own (the `showPerCardBasisNote` branch below). Zero
  // resolved cards -> nothing extra to say; each card's own pending skeleton
  // or "no pre-match metrics" note already communicates the absence.
  const combinedBasis = uniqueBases.size === 1 ? [...uniqueBases][0] : undefined;
  const basesDisagree = uniqueBases.size > 1;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      {combinedBasis !== undefined && (
        <p data-testid="match-robot-grid-as-of" className="text-role-label text-[var(--color-text-muted)]">
          {COMBINED_BASIS_NOTE[combinedBasis]}
        </p>
      )}
      <div className="grid grid-cols-1 gap-[var(--spacing-sm)] sm:grid-cols-2 lg:grid-cols-3">
        {redTeams.map((teamKey) => (
          <RobotCard
            key={teamKey}
            teamKey={teamKey}
            side="red"
            record={byTeamKey[teamKey] ?? { isPending: false }}
            season={season}
            algorithm={algorithm}
            showPerCardBasisNote={basesDisagree}
          />
        ))}
        {blueTeams.map((teamKey) => (
          <RobotCard
            key={teamKey}
            teamKey={teamKey}
            side="blue"
            record={byTeamKey[teamKey] ?? { isPending: false }}
            season={season}
            algorithm={algorithm}
            showPerCardBasisNote={basesDisagree}
          />
        ))}
      </div>
    </div>
  );
}
