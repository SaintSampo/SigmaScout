/**
 * BPR data loading. Reads raw TBA facts out of the corpus and nothing else —
 * deliberately independent of packages/harness so this model's design stays
 * uncontaminated by parameters fitted on the 2023-2026 holdout.
 */
import Database from "better-sqlite3";

export interface BprMatch {
  matchKey: string;
  eventKey: string;
  year: number;
  compLevel: string;
  sortTime: number;
  /** TBA competition week, 0-indexed (week 0 is "Week 1"); null for champs. */
  week: number | null;
  redTeams: string[];
  blueTeams: string[];
  /** Foul-adjusted alliance output: totalPoints - foulPoints. */
  redOut: number;
  blueOut: number;
  /** Unadjusted alliance score, kept so foul-adjustment itself is ablatable. */
  redRaw: number;
  blueRaw: number;
  /** Foul points *awarded to* this alliance, i.e. conceded by the opponent. */
  redFoul: number;
  blueFoul: number;
  winner: "red" | "blue" | "tie";
}

interface RawRow {
  match_key: string;
  event_key: string;
  year: number;
  comp_level: string;
  sort_time: number;
  week: number | null;
  red_teams: string;
  blue_teams: string;
  red_score: number;
  blue_score: number;
  winner: string;
  sb: string | null;
}

function foulOf(breakdown: unknown, side: "red" | "blue"): number {
  if (breakdown === null || typeof breakdown !== "object") return 0;
  const alliance = (breakdown as Record<string, unknown>)[side];
  if (alliance === null || typeof alliance !== "object") return 0;
  const fp = (alliance as Record<string, unknown>).foulPoints;
  return typeof fp === "number" && Number.isFinite(fp) ? fp : 0;
}

/**
 * Every played, non-offseason match in global chronological order. Ordering is
 * by sort_time across all events at once (events overlap in the calendar), with
 * match_key as a deterministic tiebreak so a run is reproducible.
 */
export function loadMatches(corpusPath: string): BprMatch[] {
  const db = new Database(corpusPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare<[], RawRow>(
        `select m.match_key, m.event_key, e.year, m.comp_level, m.sort_time, e.week,
                m.red_teams, m.blue_teams, m.red_score, m.blue_score, m.winner,
                m.score_breakdown_raw as sb
           from matches m
           join events e using(event_key)
          where e.is_offseason = 0
            and e.event_type <> 100
            and m.winner is not null
            and m.red_score is not null
            and m.blue_score is not null
          order by m.sort_time asc, m.match_key asc`,
      )
      .all();

    const out: BprMatch[] = [];
    for (const r of rows) {
      const breakdown: unknown = r.sb === null ? null : JSON.parse(r.sb);
      const redFoul = foulOf(breakdown, "red");
      const blueFoul = foulOf(breakdown, "blue");
      const winner = r.winner === "red" || r.winner === "blue" ? r.winner : "tie";
      out.push({
        matchKey: r.match_key,
        eventKey: r.event_key,
        year: r.year,
        compLevel: r.comp_level,
        sortTime: r.sort_time,
        week: r.week,
        redTeams: JSON.parse(r.red_teams) as string[],
        blueTeams: JSON.parse(r.blue_teams) as string[],
        redOut: r.red_score - redFoul,
        blueOut: r.blue_score - blueFoul,
        redRaw: r.red_score,
        blueRaw: r.blue_score,
        redFoul,
        blueFoul,
        winner,
      });
    }
    return out;
  } finally {
    db.close();
  }
}
