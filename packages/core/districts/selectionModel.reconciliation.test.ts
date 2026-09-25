/**
 * Corpus reconciliation of the DRAFT RULE `ledgerSimulation.ts` runs in the
 * browser — the test that licenses the progressive captain walk, and the one
 * that makes this plan's single largest model claim a measurement rather than
 * an assertion.
 *
 * Mirrors `reconciliation.test.ts`'s harness exactly: the `existsSync` corpus
 * guard pair, `openCorpusReadOnly` inside `try`/`finally`, an explicit
 * `it.skip` naming the missing path and the ingest command rather than a
 * silent pass, and a terminal non-vacuous count assertion. THIS TEST SKIPS
 * WHERE `data/corpus.sqlite` IS ABSENT, WHICH IS CI, AND A GREEN SKIP IS NOT
 * A PASS — `ledgerSimulation.test.ts` is the pure half that runs everywhere
 * and it is load-bearing, not a formality.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES, AND WHY IT IS TEACHER-FORCED
 * ---------------------------------------------------------------------------
 *
 * At each of an event's eight alliance turns, the expected captain is the
 * lowest-rank-numbered team in `event_rankings` not yet allied. It is scored
 * against the REAL draft state so far — the real captains and the real first
 * picks are what get removed from the pool before the next turn, never the
 * model's own choices. Teacher forcing is what makes the number measure the
 * RULE rather than measure cascade: a single early miss would otherwise
 * invalidate every later turn at that event and the figure would describe
 * error propagation instead of the rule's accuracy. 10-02's pick-order
 * measurement applies the same discipline, which is what makes the two numbers
 * comparable.
 *
 * ---------------------------------------------------------------------------
 * THE NAIVE RULE IS SCORED BESIDE IT, ON PURPOSE
 * ---------------------------------------------------------------------------
 *
 * 10-04's own brief said "captains = top eight by that ranking". Measured, that
 * rule is right at 3 of 491 events. Scoring it HERE, in the same run, next to
 * the rule it lost to, is what stops a future editor from "simplifying" the
 * progressive walk back into a top-eight slice: the measurement of the wrong
 * rule lives beside the right one, and the simplification turns this file red.
 *
 * Populations are pinned with FLOORS and exclusions with CEILINGS, so a later
 * legitimate ingest can only strengthen the result while a regression that
 * shrinks the scan turns the test red rather than quietly proving less.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../corpus/db.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const SKIP_MESSAGE = `skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:events, pnpm ingest:rankings, pnpm ingest:alliances) first; a skipped reconciliation proves nothing`;

/** The first season of the eight-alliance double-elimination format, and this scan's floor. */
const FIRST_SEASON = 2023;
/** The alliance count this scan is scoped to — every regular district event since 2023 runs it. */
const EIGHT = 8;

/**
 * Fact 1, measured read-only against `data/corpus.sqlite` on 2026-09-25 while
 * planning 10-04 and reproduced exactly by this file on execution. Floors for
 * populations, ceilings for exclusions and misses.
 */
const MIN_CAPTAIN_SLOTS = 3_880;
const MIN_CORRECT_CAPTAIN_SLOTS = 3_879;
const MIN_USABLE_EVENTS = 485;
const MIN_PERFECT_EVENTS = 484;
const MAX_EXCLUDED_EVENTS = 6;
const MAX_MISSES = 1;
/** The single permitted miss, named so a DIFFERENT one fails rather than passing as "still one miss". */
const KNOWN_MISS = { eventKey: "2026milac", allianceNumber: 8, expected: "frc6087", real: "frc7768" } as const;
/** The naive "captains are the eight lowest rank numbers" rule's measured event-match count, as a CEILING. */
const MAX_NAIVE_MATCHES = 3;
/** The measured second-pick rank gradient's end-to-end spread: 24.83 at alliance 1 against 20.10 at alliance 8. */
const MIN_SECOND_PICK_RANK_SPREAD = 4.0;

interface AllianceRow {
  event_key: string;
  alliance_number: number;
  picks: string;
}

interface RankingRow {
  event_key: string;
  team_key: string;
  rank: number;
}

interface CaptainMiss {
  eventKey: string;
  allianceNumber: number;
  expected: string;
  expectedRank: number;
  real: string;
  realRank: number | undefined;
}

interface ReconciliationResult {
  eightAllianceEvents: number;
  usableEvents: number;
  excludedEvents: string[];
  perfectEvents: number;
  captainSlots: number;
  correctCaptainSlots: number;
  misses: CaptainMiss[];
  naiveMatchedEvents: number;
  secondPickMeanRank: (number | undefined)[];
  secondPickCount: number[];
}

function reconcile(): ReconciliationResult {
  const db = openCorpusReadOnly(CORPUS_PATH);
  let allianceRows: AllianceRow[];
  let rankingRows: RankingRow[];
  try {
    allianceRows = db
      .prepare(
        `SELECT ea.event_key, ea.alliance_number, ea.picks
         FROM event_alliances ea
         JOIN events e ON e.event_key = ea.event_key
         WHERE e.year >= ? AND e.district_key IS NOT NULL
         ORDER BY ea.event_key, ea.alliance_number`
      )
      .all(FIRST_SEASON) as AllianceRow[];
    rankingRows = db
      .prepare(
        `SELECT er.event_key, er.team_key, er.rank
         FROM event_rankings er
         JOIN events e ON e.event_key = er.event_key
         WHERE e.year >= ? AND e.district_key IS NOT NULL`
      )
      .all(FIRST_SEASON) as RankingRow[];
  } finally {
    db.close();
  }

  const alliancesByEvent = new Map<string, AllianceRow[]>();
  for (const row of allianceRows) {
    let rows = alliancesByEvent.get(row.event_key);
    if (rows === undefined) {
      rows = [];
      alliancesByEvent.set(row.event_key, rows);
    }
    rows.push(row);
  }
  const ranksByEvent = new Map<string, Map<string, number>>();
  for (const row of rankingRows) {
    let ranks = ranksByEvent.get(row.event_key);
    if (ranks === undefined) {
      ranks = new Map<string, number>();
      ranksByEvent.set(row.event_key, ranks);
    }
    ranks.set(row.team_key, row.rank);
  }

  const result: ReconciliationResult = {
    eightAllianceEvents: 0,
    usableEvents: 0,
    excludedEvents: [],
    perfectEvents: 0,
    captainSlots: 0,
    correctCaptainSlots: 0,
    misses: [],
    naiveMatchedEvents: 0,
    secondPickMeanRank: new Array<number | undefined>(EIGHT + 1).fill(undefined),
    secondPickCount: new Array<number>(EIGHT + 1).fill(0),
  };
  const secondPickRankSum = new Array<number>(EIGHT + 1).fill(0);

  for (const [eventKey, rows] of alliancesByEvent) {
    if (rows.length !== EIGHT) continue;
    result.eightAllianceEvents++;
    const ranks = ranksByEvent.get(eventKey) ?? new Map<string, number>();
    const picks = rows.map((row) => JSON.parse(row.picks) as string[]);

    // The serpentine direction's evidence, measured over EVERY eight-alliance
    // event rather than only the usable ones — a second pick with no ranking
    // row is skipped per slot, which is what produces the 491/490/488/485
    // per-alliance counts rather than a uniform one.
    rows.forEach((row, index) => {
      const secondPick = picks[index]![2];
      if (secondPick === undefined) return;
      const rank = ranks.get(secondPick);
      if (rank === undefined) return;
      secondPickRankSum[row.alliance_number]! += rank;
      result.secondPickCount[row.alliance_number]! += 1;
    });

    // EXCLUDED AND COUNTED, never silently dropped: an uncounted exclusion is
    // how a scan quietly shrinks. Six events carry a rostered team in the
    // first three pick slots with no `event_rankings` row at all.
    let missingRankRow = false;
    for (const alliancePicks of picks) {
      for (let slot = 0; slot < 3 && slot < alliancePicks.length; slot++) {
        if (!ranks.has(alliancePicks[slot]!)) missingRankRow = true;
      }
    }
    if (missingRankRow) {
      result.excludedEvents.push(eventKey);
      continue;
    }
    result.usableEvents++;

    // THE TEACHER-FORCED WALK.
    const allied = new Set<string>();
    let eventPerfect = true;
    for (let index = 0; index < EIGHT; index++) {
      const allianceNumber = rows[index]!.alliance_number;
      let expected: string | undefined;
      let expectedRank = Number.POSITIVE_INFINITY;
      for (const [team, rank] of ranks) {
        if (allied.has(team)) continue;
        if (rank < expectedRank) {
          expectedRank = rank;
          expected = team;
        }
      }
      const realCaptain = picks[index]![0]!;
      result.captainSlots++;
      if (expected === realCaptain) {
        result.correctCaptainSlots++;
      } else {
        eventPerfect = false;
        result.misses.push({
          eventKey,
          allianceNumber,
          expected: expected ?? "(no unallied team)",
          expectedRank,
          real: realCaptain,
          realRank: ranks.get(realCaptain),
        });
      }
      // The REAL draft state, not the model's: the real captain and the real
      // first pick leave the pool before the next turn.
      allied.add(realCaptain);
      const realFirstPick = picks[index]![1];
      if (realFirstPick !== undefined) allied.add(realFirstPick);
    }
    if (eventPerfect) result.perfectEvents++;

    // THE NAIVE RULE, scored in the same run over the same event.
    const eightLowestRanks = [...ranks.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, EIGHT)
      .map(([team]) => team);
    const realCaptains = new Set(picks.map((alliancePicks) => alliancePicks[0]!));
    if (eightLowestRanks.length === EIGHT && eightLowestRanks.every((team) => realCaptains.has(team))) {
      result.naiveMatchedEvents++;
    }
  }

  for (let allianceNumber = 1; allianceNumber <= EIGHT; allianceNumber++) {
    const count = result.secondPickCount[allianceNumber]!;
    result.secondPickMeanRank[allianceNumber] = count > 0 ? secondPickRankSum[allianceNumber]! / count : undefined;
  }

  return result;
}

describe("the progressive captain rule, reconciled against every 2023-plus eight-alliance district event", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(SKIP_MESSAGE, () => {});
    return;
  }

  const result = reconcile();

  it("scans a non-vacuous population — every floor and every ceiling asserted, not printed", () => {
    expect(result.usableEvents).toBeGreaterThan(0);
    expect(result.usableEvents).toBeGreaterThanOrEqual(MIN_USABLE_EVENTS);
    expect(result.captainSlots).toBeGreaterThanOrEqual(MIN_CAPTAIN_SLOTS);
    expect(result.perfectEvents).toBeGreaterThanOrEqual(MIN_PERFECT_EVENTS);
    expect(result.excludedEvents.length).toBeLessThanOrEqual(MAX_EXCLUDED_EVENTS);
  });

  it(`reproduces the real captain at at least ${MIN_CORRECT_CAPTAIN_SLOTS} of ${MIN_CAPTAIN_SLOTS} slots, teacher-forced`, () => {
    if (result.misses.length > MAX_MISSES) {
      const detail = result.misses
        .map(
          (miss) =>
            `${miss.eventKey} alliance ${miss.allianceNumber}: expected ${miss.expected} (rank ${miss.expectedRank}), real ${miss.real} (rank ${String(miss.realRank)})`
        )
        .join("; ");
      expect.fail(`${result.misses.length} captain misses, above the permitted ${MAX_MISSES}: ${detail}`);
    }
    expect(result.correctCaptainSlots).toBeGreaterThanOrEqual(MIN_CORRECT_CAPTAIN_SLOTS);
  });

  it("the single permitted miss is 2026milac alliance 8 — one decline, one event", () => {
    expect(result.misses).toHaveLength(1);
    const miss = result.misses[0]!;
    const detail = `${miss.eventKey} alliance ${miss.allianceNumber}: expected ${miss.expected} (rank ${miss.expectedRank}), real ${miss.real} (rank ${String(miss.realRank)})`;
    expect(`${miss.eventKey}|${miss.allianceNumber}|${miss.expected}|${miss.real}`, detail).toBe(
      `${KNOWN_MISS.eventKey}|${KNOWN_MISS.allianceNumber}|${KNOWN_MISS.expected}|${KNOWN_MISS.real}`
    );
  });

  it(`the naive "captains are the eight lowest rank numbers" rule matches at most ${MAX_NAIVE_MATCHES} events — the wrong rule measured beside the right one`, () => {
    expect(result.naiveMatchedEvents).toBeLessThanOrEqual(MAX_NAIVE_MATCHES);
    // And the progressive rule is better by a wide margin on the same events,
    // so "simplify the walk into a slice" is a measurable regression rather
    // than a matter of taste.
    expect(result.perfectEvents).toBeGreaterThan(result.naiveMatchedEvents * 100);
  });

  it("the second-pick rank gradient is non-increasing from alliance 1 to alliance 8, with a spread that only a serpentine round two can produce", () => {
    const means: number[] = [];
    for (let allianceNumber = 1; allianceNumber <= EIGHT; allianceNumber++) {
      const mean = result.secondPickMeanRank[allianceNumber];
      expect(mean, `alliance ${allianceNumber} has no measured second-pick mean rank`).toBeDefined();
      means.push(mean!);
    }
    for (let i = 1; i < means.length; i++) {
      expect(means[i]!, `alliance ${i + 1}'s mean second-pick rank (${means[i]!}) exceeds alliance ${i}'s (${means[i - 1]!})`).toBeLessThanOrEqual(
        means[i - 1]!
      );
    }
    expect(means[0]! - means[EIGHT - 1]!).toBeGreaterThanOrEqual(MIN_SECOND_PICK_RANK_SPREAD);
  });

  it("the excluded events are counted and named", () => {
    expect(result.excludedEvents.length).toBeLessThanOrEqual(MAX_EXCLUDED_EVENTS);
    expect(result.eightAllianceEvents).toBe(result.usableEvents + result.excludedEvents.length);
  });
});
