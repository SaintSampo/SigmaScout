/**
 * Proves that TBA's real 2022-2026 `/event/{key}/rankings` responses satisfy
 * the premise Task 1's guard encodes (D-18.6, `07-VALIDATION.md`'s D-18.6
 * row): that `sort_order_info[0].name` is stable as `"Ranking Score"` across
 * seasons and event types, and that the rest of the widened
 * `normalizeEventRankings` contract (record pass-through, ranking-score
 * nullability, empty-array handling) holds against real data, not just the
 * offline fixtures `rankings.test.ts` pins.
 *
 * Two independent gates guard this file, and NEITHER is ever allowed to
 * become a silent pass — each reports a named `it.skip` stating exactly
 * what is missing:
 *   - `CORPUS_AVAILABLE`: `data/corpus.sqlite` must exist locally (used only
 *     to resolve, per season, the highest-match-count event — the real
 *     TBA fetch never touches it, and the corpus is opened read-only and
 *     closed before any network call).
 *   - `LIVE_TBA_AVAILABLE`: `TBA_API_KEY` must be present in `process.env`.
 *
 * Documented invocation (`.claude/CLAUDE.md`'s Secrets-handling convention):
 *
 *   set -a; . ./.env; set +a; pnpm vitest run packages/ingest/rankingsLive.test.ts
 *
 * The key is read ONLY from `process.env["TBA_API_KEY"]` and passed only
 * into `fetchEventRankings`'s `TbaClientContext`. It never appears in a log
 * line, a test name, a skip message, or an assertion message — this file
 * contains zero `console.*` calls anywhere on its executed path.
 *
 * Deliberately NOT covered here: the null-body response shape.
 * RESEARCH.md Question 1's 40-event live sample observed none, so no fixed
 * event key can reliably reproduce one on demand. That contract is pinned
 * offline by `rankings.test.ts`'s existing null-body cases, and was
 * separately measured live at 50 null-body events during 06.1-04's full
 * corpus ingest — a reasoned exclusion, not an oversight.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { normalizeEventRankings } from "./rankings.js";
import { tbaEventRankingsResponseSchema, type TbaEventRankingsResponse } from "./schemas.js";
import { fetchEventRankings, TbaRequestCounter, type TbaClientContext } from "./tbaClient.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

const TBA_API_KEY_VALUE = process.env["TBA_API_KEY"];
const LIVE_TBA_AVAILABLE = typeof TBA_API_KEY_VALUE === "string" && TBA_API_KEY_VALUE.length > 0;

/**
 * The fixed sample: five seasons, one corpus-resolved event each (the
 * highest-match-count event of that season — the event most certain to
 * have a populated ranking, which is what makes the position-0 assertion
 * non-vacuous), plus two explicitly named events that RESEARCH.md Question
 * 1 verified live return a non-null body with an empty `rankings` array —
 * the highest-match-count Championship Finals event of a season with no
 * qualification ranking, and a preseason event with zero matches. Kept as
 * a module-level readonly structure so the sample is auditable at a glance
 * and cannot grow implicitly.
 */
const SEASONS = [2022, 2023, 2024, 2025, 2026] as const;
const EMPTY_ARRAY_EVENT_KEYS = ["2025cmptx", "2022ispr"] as const;

/**
 * Resolves one season's highest-match-count event from the corpus's OWN
 * `matches`/`events` tables. The secondary `ORDER BY event_key ASC` is not
 * decoration — it is what makes the selection deterministic across runs
 * when two events tie on match count, matching 06.1-01's established
 * deterministic-pair-selection discipline.
 */
function resolveHighestMatchCountEvent(db: Corpus, year: number): string {
  const row = db
    .prepare(
      `SELECT e.event_key AS eventKey, COUNT(m.match_key) AS matchCount
       FROM events e
       JOIN matches m ON m.event_key = e.event_key
       WHERE e.year = ?
       GROUP BY e.event_key
       ORDER BY matchCount DESC, e.event_key ASC
       LIMIT 1`
    )
    .get(year) as { eventKey: string; matchCount: number } | undefined;
  if (!row) {
    throw new Error(`No event with at least one match found in the corpus for season ${year}`);
  }
  return row.eventKey;
}

describe("rankingsLive — the D-18.6 guard's premise against real TBA responses (plan 07-04 Task 2)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run the ingest pipeline (pnpm ingest) to generate it`, () => {});
    return;
  }
  if (!LIVE_TBA_AVAILABLE) {
    it.skip(
      "skipped: TBA_API_KEY is not set in process.env — run " +
        "`set -a; . ./.env; set +a; pnpm vitest run packages/ingest/rankingsLive.test.ts`",
      () => {}
    );
    return;
  }

  const counter = new TbaRequestCounter();
  const ctx: TbaClientContext = { apiKey: TBA_API_KEY_VALUE as string, counter };
  const seasonEventKeys = new Map<number, string>();
  const parsedByEventKey = new Map<string, TbaEventRankingsResponse>();

  beforeAll(async () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      for (const year of SEASONS) {
        seasonEventKeys.set(year, resolveHighestMatchCountEvent(db, year));
      }
    } finally {
      db.close();
    }

    // Deduplicate before fetching (defense in depth against a season's
    // resolved event accidentally colliding with one of the two fixed
    // empty-array events) so the request count this test makes is never
    // more than the size of the deduplicated set.
    const eventKeysToFetch = new Set<string>([...seasonEventKeys.values(), ...EMPTY_ARRAY_EVENT_KEYS]);

    for (const eventKey of eventKeysToFetch) {
      // No cachedEtag argument — every call must return a fresh 200 body,
      // never a bodyless 304.
      const result = await fetchEventRankings(ctx, eventKey, undefined);
      if (result.status === 304) {
        throw new Error(`Unexpected 304 for ${eventKey} — this test never supplies a cached ETag`);
      }
      parsedByEventKey.set(eventKey, tbaEventRankingsResponseSchema.parse(result.body));
    }
  }, 60000);

  it(
    "makes at most seven /event/{key}/rankings requests total (T-07-04-04's own bound — a free, volunteer-run service)",
    () => {
      expect(counter.total).toBeLessThanOrEqual(7);
    },
    30000
  );

  for (const year of SEASONS) {
    it(
      `season ${year}'s corpus-resolved highest-match-count event has a populated ranking and asserts "Ranking Score" at position 0`,
      () => {
        const eventKey = seasonEventKeys.get(year);
        expect(eventKey).toBeDefined();
        const parsed = parsedByEventKey.get(eventKey as string);

        // Precondition: this event must actually have rankings, or an
        // assertion about position 0 below would be vacuous.
        expect(parsed).not.toBeNull();
        expect(parsed?.rankings.length).toBeGreaterThan(0);

        // Asserted against a LITERAL, deliberately NOT the exported
        // sort-order-name constant `rankings.ts` defines: this test exists
        // to check TBA's real vocabulary against our expectation, and
        // importing our own constant would make it assert that a value
        // equals itself — it would go green on the day someone renames the
        // constant to match a drifted TBA, instead of catching the drift.
        expect(parsed?.sort_order_info[0]?.name).toBe("Ranking Score");

        // Exercises the real production path (guard included), not a
        // reimplementation of its reads.
        const normalized = normalizeEventRankings(parsed as TbaEventRankingsResponse, eventKey as string);
        expect(normalized).toHaveLength(parsed?.rankings.length ?? -1);
      },
      30000
    );
  }

  it(
    "every recordWins/recordLosses/recordTies across all five populated samples is a non-negative integer, and at least one row has recordWins > 0",
    () => {
      let sawPositiveWins = false;
      for (const year of SEASONS) {
        const eventKey = seasonEventKeys.get(year) as string;
        const parsed = parsedByEventKey.get(eventKey) as TbaEventRankingsResponse;
        const normalized = normalizeEventRankings(parsed, eventKey);
        for (const record of normalized) {
          expect(Number.isInteger(record.recordWins)).toBe(true);
          expect(Number.isInteger(record.recordLosses)).toBe(true);
          expect(Number.isInteger(record.recordTies)).toBe(true);
          expect(record.recordWins).toBeGreaterThanOrEqual(0);
          expect(record.recordLosses).toBeGreaterThanOrEqual(0);
          expect(record.recordTies).toBeGreaterThanOrEqual(0);
          if (record.recordWins > 0) sawPositiveWins = true;
        }
      }
      expect(sawPositiveWins).toBe(true);
    },
    30000
  );

  it(
    "at least one rankingScore across all five populated samples is a finite non-integral number — the fact that makes ranking_score REAL rather than INTEGER the correct column type",
    () => {
      let sawNonIntegral = false;
      for (const year of SEASONS) {
        const eventKey = seasonEventKeys.get(year) as string;
        const parsed = parsedByEventKey.get(eventKey) as TbaEventRankingsResponse;
        const normalized = normalizeEventRankings(parsed, eventKey);
        for (const record of normalized) {
          if (record.rankingScore !== null && Number.isFinite(record.rankingScore) && !Number.isInteger(record.rankingScore)) {
            sawNonIntegral = true;
          }
        }
      }
      expect(sawNonIntegral).toBe(true);
    },
    30000
  );

  it(
    "for each row of each populated sample, recordWins equals the raw parsed entry's record.wins at the same array index — passed through, never recomputed",
    () => {
      for (const year of SEASONS) {
        const eventKey = seasonEventKeys.get(year) as string;
        const parsed = parsedByEventKey.get(eventKey) as TbaEventRankingsResponse;
        const normalized = normalizeEventRankings(parsed, eventKey);
        expect(normalized).toHaveLength(parsed?.rankings.length ?? -1);
        normalized.forEach((record, i) => {
          expect(record.recordWins).toBe(parsed?.rankings[i]?.record.wins);
          expect(record.recordLosses).toBe(parsed?.rankings[i]?.record.losses);
          expect(record.recordTies).toBe(parsed?.rankings[i]?.record.ties);
        });
      }
    },
    30000
  );

  it(
    "2025cmptx (Championship Finals) and 2022ispr (preseason) each return a non-null body with an empty rankings array, and normalizeEventRankings returns [] without throwing for both",
    () => {
      for (const eventKey of EMPTY_ARRAY_EVENT_KEYS) {
        const parsed = parsedByEventKey.get(eventKey);
        expect(parsed).not.toBeNull();
        expect(parsed?.rankings).toEqual([]);
        expect(() => normalizeEventRankings(parsed as TbaEventRankingsResponse, eventKey)).not.toThrow();
        expect(normalizeEventRankings(parsed as TbaEventRankingsResponse, eventKey)).toEqual([]);
      }
    },
    30000
  );
});
