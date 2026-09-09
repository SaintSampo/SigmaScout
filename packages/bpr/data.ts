/**
 * BPR data loading.
 *
 * Reads the match stream through `packages/corpus/db.ts`'s
 * `selectMatchesChronological` — the SAME selector, the SAME exclusions and
 * the SAME total order that produce every historical OPR/EPA/VPR figure.
 *
 * This file used to run its own SQL, and the divergence was real rather than
 * cosmetic (quick task 260908-vqr, F-12): the private query dropped
 * `event_type = 100` and any row with a null score, so BPR was scored on a
 * population no other algorithm was scored on and its numbers were not
 * comparable to anything. Measured 2026-09-09: six design-era events and five
 * holdout-era events carry `event_type = 100` while `is_offseason = 0`, worth
 * 149 and 151 matches respectively — matches the shared harness KEEPS.
 *
 * The model's DESIGN still stays independent of `packages/harness`: nothing
 * fitted on the 2023-2026 holdout is imported here. `packages/corpus` is a
 * parameterless reader of raw TBA facts, so pointing at it contaminates
 * nothing — it removes a private population, it does not add a tuned one.
 */
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";

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
  /**
   * D-07 surrogate slots, carried straight through from the corpus. A match
   * with a surrogate on either alliance is excluded from SCORING by
   * `evaluate.ts` (the shared harness's own rule) while still being predicted
   * and updated on, so the exclusion moves the scoreboard and never the state.
   */
  redSurrogates: string[];
  blueSurrogates: string[];
  /** TBA `dq_team_keys`, carried through so a DQ policy stays expressible. */
  redDqs: string[];
  blueDqs: string[];
  /** TBA event type. 2/3/4 are the championship levels; carried for slicing. */
  eventType: number;
}

function foulOf(breakdown: unknown, side: "red" | "blue"): number {
  if (breakdown === null || typeof breakdown !== "object") return 0;
  const alliance = (breakdown as Record<string, unknown>)[side];
  if (alliance === null || typeof alliance !== "object") return 0;
  const fp = (alliance as Record<string, unknown>).foulPoints;
  return typeof fp === "number" && Number.isFinite(fp) ? fp : 0;
}

interface EventRow {
  event_key: string;
  year: number;
  week: number | null;
}

interface SortRow {
  match_key: string;
  sort_time: number;
}

/**
 * Rows the shared selector KEEPS but whose score columns are null, so
 * `selectMatchesChronological`'s `?? 0` would silently feed the model a
 * zero-point alliance. Reported by `loadMatches` rather than filtered, because
 * a nonzero count is a corpus finding to explain, not a row to hide.
 */
export interface LoadDiagnostics {
  /** Matches with a winner but a null red or blue score. Expected: 0. */
  nullScoreWithWinner: number;
}

let lastDiagnostics: LoadDiagnostics = { nullScoreWithWinner: 0 };

/** Diagnostics from the most recent `loadMatches` call. */
export function loadDiagnostics(): LoadDiagnostics {
  return lastDiagnostics;
}

/**
 * Every played, non-offseason match in the shared total order (sort time, then
 * event key, then competition-level play order, then set, then match number).
 *
 * The ordering is the selector's, not this file's: a lexicographic match-key
 * tiebreak — which is what this file used to apply — can place `qm10` before
 * `qm9`, so the two orderings genuinely differ on any event that reaches a
 * two-digit match number.
 */
export function loadMatches(corpusPath: string): BprMatch[] {
  const db = openCorpusReadOnly(corpusPath);
  try {
    const rows = selectMatchesChronological(db, { excludeOffseason: true });

    const events = new Map<string, { year: number; week: number | null }>();
    for (const e of db
      .prepare<[], EventRow>(`select event_key, year, week from events`)
      .all()) {
      events.set(e.event_key, { year: e.year, week: e.week });
    }

    const sortTimes = new Map<string, number>();
    for (const s of db
      .prepare<[], SortRow>(`select match_key, sort_time from matches`)
      .all()) {
      sortTimes.set(s.match_key, s.sort_time);
    }

    // Counted, never filtered — see LoadDiagnostics.
    const nullScoreWithWinner = (
      db
        .prepare<[], { c: number }>(
          `select count(*) as c
             from matches m
             join events e using(event_key)
            where e.is_offseason = 0
              and m.winner is not null
              and (m.red_score is null or m.blue_score is null)`,
        )
        .get() ?? { c: 0 }
    ).c;
    lastDiagnostics = { nullScoreWithWinner };

    const out: BprMatch[] = [];
    for (const r of rows) {
      const meta = events.get(r.eventKey);
      if (meta === undefined) {
        // Unreachable: the selector inner-joins events, so every row has one.
        throw new Error(`bpr/data: no events row for ${r.eventKey}`);
      }
      const breakdown: unknown =
        r.scoreBreakdownRaw === null ? null : JSON.parse(r.scoreBreakdownRaw);
      const redFoul = foulOf(breakdown, "red");
      const blueFoul = foulOf(breakdown, "blue");
      out.push({
        matchKey: r.matchKey,
        eventKey: r.eventKey,
        year: meta.year,
        compLevel: r.compLevel,
        sortTime: sortTimes.get(r.matchKey) ?? 0,
        week: meta.week,
        redTeams: [...r.redTeams],
        blueTeams: [...r.blueTeams],
        redOut: r.redScore - redFoul,
        blueOut: r.blueScore - blueFoul,
        redRaw: r.redScore,
        blueRaw: r.blueScore,
        redFoul,
        blueFoul,
        winner: r.winner,
        redSurrogates: [...r.redSurrogates],
        blueSurrogates: [...r.blueSurrogates],
        redDqs: [...r.redDqs],
        blueDqs: [...r.blueDqs],
        eventType: r.eventType,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * The shared harness's D-07 rule: a match with a surrogate on either alliance
 * is excluded from SCORING. Exported so `evaluate.ts`, the reconciliation
 * script and any slicing analysis apply one definition rather than three.
 */
export function isSurrogateAffected(m: BprMatch): boolean {
  return m.redSurrogates.length > 0 || m.blueSurrogates.length > 0;
}
