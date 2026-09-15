/**
 * The team page's view of one event's matches, with the live event artifact
 * laid over the published team artifact (260915-m4j, LD-2).
 *
 * WHY. The team artifact is written offline, and during a live event the
 * Worker rewrites it too, but only the event artifact carries the state block
 * the browser prices upcoming matches from. So for an event that is still
 * live, the team page reads that event's artifact (the same query the event
 * page uses) and takes its played results and priced upcoming rows from it.
 *
 * Pure module, no React. Rows are plain objects; nothing is mutated.
 */
import type { EventPageArtifact } from "../../lib/eventPricing.js";
import { isPricedUpcomingRow } from "../../lib/eventPricing.js";
import { compareEventMatchRows, type EventMatchRow } from "../event/eventMatchAxis.js";
import type { TeamSeasonEvent, TeamSeasonMatch } from "./matchAxis.js";

type EventPlayedRow = EventPageArtifact["matches"][number];
type EventUpcomingRow = EventPageArtifact["upcoming"][number];

export interface OverlayTeamEventMatchesInput {
  readonly teamKey: string;
  readonly event: Pick<TeamSeasonEvent, "eventKey" | "matches">;
  /** The event's resolved artifact, or `undefined` while it is pending, failed, or not fetched at all. */
  readonly eventArtifact: EventPageArtifact | undefined;
}

function isPlayed(row: { actualWinner?: unknown }): boolean {
  return row.actualWinner !== undefined;
}

function involves(row: { redTeams: readonly string[]; blueTeams: readonly string[] }, teamKey: string): boolean {
  return row.redTeams.includes(teamKey) || row.blueTeams.includes(teamKey);
}

/** Every field `TeamSeasonMatchSchema` shares with the event row schemas, copied only when defined, so absent stays absent. */
const SHARED_ROW_KEYS = [
  "setNumber",
  "matchNumber",
  "sortTime",
  "redTeams",
  "blueTeams",
  "predictedWinner",
  "pRedWin",
  "predictedRedScore",
  "predictedBlueScore",
  "redScoreVarianceOwn",
  "blueScoreVarianceOwn",
  "redMatchBandVariance",
  "blueMatchBandVariance",
  "redRpPmf",
  "blueRpPmf",
  "redBonusRp",
  "blueBonusRp",
  "actualWinner",
  "actualRedScore",
  "actualBlueScore",
  "coldStart",
  "actualRedRp",
  "actualBlueRp",
  "actualRedBonusRp",
  "actualBlueBonusRp",
  "video",
] as const;

/** A team-shaped row from an event row: identity from the event artifact, every shared field copied verbatim. */
function teamRowFromEventRow(row: EventPlayedRow | EventUpcomingRow, artifact: EventPageArtifact): TeamSeasonMatch {
  const out: Record<string, unknown> = {
    matchKey: row.matchKey,
    season: artifact.season,
    eventKey: artifact.eventKey,
    compLevel: row.compLevel,
    algorithmId: artifact.algorithmId,
    algorithmVersion: artifact.algorithmVersion,
  };
  const source = row as unknown as Record<string, unknown>;
  for (const key of SHARED_ROW_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out as unknown as TeamSeasonMatch;
}

/** An upcoming match nobody could price: schedule fields only, no prediction keys. */
function unpricedTeamRow(row: EventUpcomingRow, artifact: EventPageArtifact): TeamSeasonMatch {
  return {
    matchKey: row.matchKey,
    season: artifact.season,
    eventKey: artifact.eventKey,
    compLevel: row.compLevel,
    algorithmId: artifact.algorithmId,
    algorithmVersion: artifact.algorithmVersion,
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    ...(row.sortTime !== undefined ? { sortTime: row.sortTime } : {}),
    redTeams: row.redTeams,
    blueTeams: row.blueTeams,
  };
}

/** `compareEventMatchRows` needs only the ordering fields; event rows always carry them. */
function orderingRow(row: EventPlayedRow | EventUpcomingRow, played: boolean): EventMatchRow {
  return {
    matchKey: row.matchKey,
    compLevel: row.compLevel,
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    redTeams: row.redTeams,
    blueTeams: row.blueTeams,
    ...(row.sortTime !== undefined ? { sortTime: row.sortTime } : {}),
    played,
  };
}

/**
 * One event's display rows for `teamKey`:
 *
 * (a) The team rows are deduped by match key: a played row beats an unplayed
 *     one, otherwise the first is kept, at the first one's position.
 * (b) With no event artifact, that deduped list is returned in published order.
 * (c) Each played event row involving the team replaces a missing or unplayed
 *     team row, as a team-shaped row.
 * (d) Each upcoming event row involving the team, whose match is played in
 *     neither source, replaces the team row by precedence: the browser-priced
 *     team row; else, for a published-priced row, the team artifact's own row
 *     (or one mapped from the event row); else an unpriced display row.
 * (e) Team rows the event artifact does not mention are kept.
 * (f) Replacements stay in place; event-only matches are appended in
 *     `compareEventMatchRows` order.
 */
export function overlayTeamEventMatches({ teamKey, event, eventArtifact }: OverlayTeamEventMatchesInput): TeamSeasonMatch[] {
  // (a)
  const rows: TeamSeasonMatch[] = [];
  const indexByKey = new Map<string, number>();
  for (const match of event.matches) {
    const index = indexByKey.get(match.matchKey);
    if (index === undefined) {
      indexByKey.set(match.matchKey, rows.length);
      rows.push(match);
    } else if (!isPlayed(rows[index]!) && isPlayed(match)) {
      rows[index] = match;
    }
  }

  // (b)
  if (eventArtifact === undefined) return rows;

  const appended: { row: TeamSeasonMatch; order: EventMatchRow }[] = [];
  const place = (matchKey: string, row: TeamSeasonMatch, order: EventMatchRow): void => {
    const index = indexByKey.get(matchKey);
    if (index !== undefined) {
      rows[index] = row;
    } else {
      appended.push({ row, order });
    }
  };

  // (c)
  const playedInEvent = new Set<string>();
  for (const played of eventArtifact.matches) {
    playedInEvent.add(played.matchKey);
    if (!involves(played, teamKey)) continue;
    const index = indexByKey.get(played.matchKey);
    if (index !== undefined && isPlayed(rows[index]!)) continue;
    place(played.matchKey, teamRowFromEventRow(played, eventArtifact), orderingRow(played, true));
  }

  // (d)
  for (const upcoming of eventArtifact.upcoming) {
    if (!involves(upcoming, teamKey) || playedInEvent.has(upcoming.matchKey)) continue;
    const index = indexByKey.get(upcoming.matchKey);
    const teamRow = index !== undefined ? rows[index]! : undefined;
    if (teamRow !== undefined && isPlayed(teamRow)) continue;

    const browserPriced = eventArtifact.upcomingTeamRows?.[upcoming.matchKey];
    const display =
      browserPriced !== undefined
        ? browserPriced
        : isPricedUpcomingRow(upcoming)
          ? (teamRow ?? teamRowFromEventRow(upcoming, eventArtifact))
          : unpricedTeamRow(upcoming, eventArtifact);
    place(upcoming.matchKey, display, orderingRow(upcoming, false));
  }

  // (e) is implicit: untouched rows stay where they are. (f)
  appended.sort((a, b) => compareEventMatchRows(a.order, b.order));
  return [...rows, ...appended.map((entry) => entry.row)];
}
