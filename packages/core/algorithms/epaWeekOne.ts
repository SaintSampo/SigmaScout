/**
 * Statbotics' WEEK 1 population, and the single place this project writes
 * down what "week 1" means in corpus terms (quick task 260911-j2w Task 2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS: THE OFF-BY-ONE
 * ---------------------------------------------------------------------------
 * `backend/src/data/avg.py` computes EVERY season-level `Year` aggregate
 * Statbotics reads — `score_mean`, `score_sd`, `no_foul_mean`, `foul_mean`,
 * and all ten `comp_*_mean` slots — from one filtered list
 * (`docs/models/statbotics-breakdown-reference.md` §20, verbatim):
 *
 *     week_one_matches = [
 *         m for m in matches if m.week == 1 and m.status == MatchStatus.COMPLETED
 *     ]
 *
 * Its filter is `week == 1`. **This corpus stores TBA's week 0-INDEXED**:
 * `packages/corpus/schema.sql` and `packages/bpr/data.ts` both record that
 * corpus week 0 is competition "Week 1", and the corpus itself confirms it —
 * 2024's `week = 0` events run 2024-02-24 to 2024-03-03, which is FRC's own
 * Week 1, while `week = 1` events do not begin until 2024-03-05.
 *
 * So **Statbotics' week 1 is this corpus's `week === 0`.**
 *
 * Getting that backwards is the whole risk of adopting these constants,
 * because nothing visibly fails when you do. The model still runs, the
 * ratings still look plausible, every downstream assertion still passes, and
 * the reproduction is silently calibrated on the wrong week. That is why the
 * mapping is a named constant with a corpus-backed test
 * (`epaWeekOne.test.ts`) rather than an inline `=== 0` at the read site.
 *
 * ---------------------------------------------------------------------------
 * THE NULL-WEEK POLICY
 * ---------------------------------------------------------------------------
 * Championship, preseason and offseason events all carry `week = null` in this
 * corpus. In 2024 that is 143 events and 6,255 played matches, and the bucket
 * is HETEROGENEOUS: its start dates span 2024-02-03 to 2024-12-27, so some
 * null-week play happens BEFORE week 1 and some happens long after.
 *
 * **A null-week match is never part of the week-1 population, and never
 * triggers the week-1 freeze.** It is neither week 1 nor "after week 1"; it is
 * unplaced, and treating unplaced play as either would be a guess. Every
 * consumer of this module must apply that rule, which is why
 * `isStatboticsWeekOne` takes `number | null` rather than `number` and
 * answers `false` for `null` explicitly.
 *
 * This module must stay importable by the Cloudflare Worker: no Node-only
 * APIs, no better-sqlite3, no Cloudflare bindings.
 */

/**
 * The value of `UpcomingMatch.week` that corresponds to Statbotics'
 * `m.week == 1`. See this module's header for the 0-indexing evidence; do not
 * inline this as a literal anywhere, and do not "fix" it to 1.
 */
export const STATBOTICS_WEEK_ONE_CORPUS_WEEK = 0;

/**
 * True when this match belongs to the population Statbotics averages its
 * `Year` aggregates over.
 *
 * `null` (an event TBA gives no competition week for) is NOT week 1 — see the
 * null-week policy in this module's header.
 */
export function isStatboticsWeekOne(week: number | null): boolean {
  return week === STATBOTICS_WEEK_ONE_CORPUS_WEEK;
}
