/**
 * Two describes: the first pure and synthetic, running everywhere including CI;
 * the second corpus-guarded with `existsSync` plus an explicit `it.skip`.
 *
 * THE SINGLE MOST IMPORTANT ASSERTION IN THE PURE HALF is that a captain is
 * SEEDED from the real `picks[0]` and never derived, and that an event whose
 * captain holds an unremarkable qual rank is NOT skipped. This measurement's
 * first draft turned "the captains are the top eight by rank" into an event
 * gate; the corpus says that equality holds at 3 of 491 events, so the gate
 * would have skipped 488 of them and reported a confident percentage computed
 * over 3.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, type EventAllianceSelection } from "../packages/corpus/db.js";
import { parseSeasons } from "./scriptHelpers.js";
import {
  captainsFromRealAlliances,
  coinBaselineForTurn,
  committedAtTurn,
  draftTurns,
  emptyCensus,
  exactAgreement,
  MEASURED_CAPTAIN_SLOTS,
  MEASURED_CAPTAIN_WINDOW,
  MEASURED_COMMAND,
  MEASURED_EIGHT_ALLIANCE_EVENTS,
  MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM,
  MEASURED_EVENTS_WITHOUT_BOUNDARY_SPR,
  MEASURED_EXACT_AGREEMENT,
  MEASURED_EXCLUDED_EVENT_KEYS,
  MEASURED_FIRST_PICK_COIN_FLOOR,
  MEASURED_FIRST_PICK_EXACT_AGREEMENT,
  MEASURED_FIRST_PICK_TOP3_AGREEMENT,
  MEASURED_FIRST_PICK_TURNS,
  MEASURED_MEAN_MODEL_RANK,
  MEASURED_MEDIAN_MODEL_RANK,
  MEASURED_NAIVE_CORRECT_SLOTS,
  MEASURED_NAIVE_SET_EQUAL_EVENTS,
  MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR,
  MEASURED_P90_MODEL_RANK,
  MEASURED_PICK_ORDER_EVENTS_SCORED,
  MEASURED_PICK_ORDER_WARMUP_FROM,
  MEASURED_PICK_ORDER_WINDOW,
  MEASURED_PICK_TURNS,
  MEASURED_POOLED_COIN_FLOOR,
  MEASURED_PROGRESSIVE_CORRECT_SLOTS,
  MEASURED_PROGRESSIVE_MISSES,
  MEASURED_PROGRESSIVE_PERFECT_EVENTS,
  MEASURED_SECOND_PICK_COIN_FLOOR,
  MEASURED_SECOND_PICK_EXACT_AGREEMENT,
  MEASURED_SECOND_PICK_TOP3_AGREEMENT,
  MEASURED_SECOND_PICK_TURNS,
  MEASURED_TOP3_AGREEMENT,
  MEASURED_USABLE_EVENTS,
  measureCaptainHalf,
  measurePickOrderHalf,
  modelOrderingAtTurn,
  modelRankOfRealPick,
  modelRankStats,
  naiveTopEightCaptains,
  pooledCoinFloor,
  progressiveCaptainFor,
  progressiveMisses,
  realPickAtTurn,
  scoreEventCaptains,
  scoreEventPickOrder,
  top3Agreement,
  type TurnResult,
} from "./measureSelectionAgreement.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

// ───────────────────────────── fixtures ─────────────────────────────

function alliance(allianceNumber: number, picks: string[]): EventAllianceSelection {
  return { allianceNumber, name: null, picks, record: null };
}

/** `frcN` is at qual rank N, for N from 1 to `count`. */
function ranks(count: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i <= count; i++) map.set(`frc${i}`, i);
  return map;
}

function turn(round: 1 | 2, allianceNumber: number, modelRank: number, availableCount: number): TurnResult {
  return { eventKey: "2026test", season: 2026, round, allianceNumber, modelRank, availableCount };
}

// ───────────────────────────── the pure describe ─────────────────────────────

describe("draftTurns — the real serpentine order", () => {
  it("yields sixteen turns: round one 1 through 8 ascending, round two 8 through 1 DESCENDING", () => {
    expect(draftTurns(8)).toEqual([
      { round: 1, allianceNumber: 1 },
      { round: 1, allianceNumber: 2 },
      { round: 1, allianceNumber: 3 },
      { round: 1, allianceNumber: 4 },
      { round: 1, allianceNumber: 5 },
      { round: 1, allianceNumber: 6 },
      { round: 1, allianceNumber: 7 },
      { round: 1, allianceNumber: 8 },
      { round: 2, allianceNumber: 8 },
      { round: 2, allianceNumber: 7 },
      { round: 2, allianceNumber: 6 },
      { round: 2, allianceNumber: 5 },
      { round: 2, allianceNumber: 4 },
      { round: 2, allianceNumber: 3 },
      { round: 2, allianceNumber: 2 },
      { round: 2, allianceNumber: 1 },
    ]);
  });
});

describe("captains are SEEDED from the real draft, never derived", () => {
  it("returns each alliance's real picks[0] in alliance_number order, asserting nothing about its rank", () => {
    const alliances = [alliance(1, ["frc1", "frc2"]), alliance(2, ["frc3", "frc4"]), alliance(3, ["frc14", "frc5"])];
    expect(captainsFromRealAlliances(alliances)).toEqual(["frc1", "frc3", "frc14"]);
  });

  it("an alliance-3 captain at qual rank 14 IS the seeded captain and its event is NOT skipped", () => {
    // This is the single assertion that would have failed this measurement's
    // first draft, which gated an event on its captain set equalling ranks 1-8.
    const rankByTeam = ranks(30);
    const alliances = [alliance(1, ["frc1", "frc2"]), alliance(2, ["frc3", "frc4"]), alliance(3, ["frc14", "frc5"])];
    const census = emptyCensus();
    const slots = scoreEventCaptains("2026test", 2026, alliances, rankByTeam, census);
    expect(slots).toHaveLength(3);
    expect(slots[2]!.realCaptain).toBe("frc14");
    expect(slots[2]!.realCaptainRank).toBe(14);
  });
});

describe("the PROGRESSIVE captain rule, teacher-forced on the real commitment schedule", () => {
  it("returns the unallied team with the LOWEST rank number, and undefined when every ranked team is allied", () => {
    const rankByTeam = ranks(3);
    expect(progressiveCaptainFor(rankByTeam, new Set())).toBe("frc1");
    expect(progressiveCaptainFor(rankByTeam, new Set(["frc1"]))).toBe("frc2");
    expect(progressiveCaptainFor(rankByTeam, new Set(["frc1", "frc2", "frc3"]))).toBeUndefined();
  });

  it("is CORRECT where ranks 1 through 8 would be wrong: alliance 1 takes rank 2, so alliance 2's captain is rank 3", () => {
    const rankByTeam = ranks(40);
    const alliances = [
      alliance(1, ["frc1", "frc2", "frc20"]),
      alliance(2, ["frc3", "frc4", "frc21"]),
      alliance(3, ["frc5", "frc6", "frc22"]),
      alliance(4, ["frc7", "frc8", "frc23"]),
      alliance(5, ["frc9", "frc10", "frc24"]),
      alliance(6, ["frc11", "frc12", "frc25"]),
      alliance(7, ["frc13", "frc14", "frc26"]),
      alliance(8, ["frc15", "frc16", "frc27"]),
    ];
    const census = emptyCensus();
    const slots = scoreEventCaptains("2026test", 2026, alliances, rankByTeam, census);

    // The progressive rule is right at every slot.
    expect(slots.every((s) => s.progressivePrediction === s.realCaptain)).toBe(true);
    expect(slots[1]!.progressivePrediction).toBe("frc3");

    // The naive rule predicts rank 2 for alliance 2 — a team that is already
    // allied as alliance 1's first pick — and is wrong at seven of eight slots.
    const naive = naiveTopEightCaptains(rankByTeam, 8);
    expect(naive[1]).toBe("frc2");
    const naiveCorrect = slots.filter((s) => s.naivePrediction === s.realCaptain).length;
    const progressiveCorrect = slots.filter((s) => s.progressivePrediction === s.realCaptain).length;
    expect(naiveCorrect).toBeLessThan(progressiveCorrect);
    expect(naiveCorrect).toBe(1);
  });

  it("the commitment SCHEDULE is load-bearing: marking every captain allied up front changes the answer", () => {
    const rankByTeam = ranks(40);
    const allAlliedUpFront = new Set(["frc1", "frc3", "frc5"]);
    // On the real schedule, alliance 2's turn sees only alliance 1's captain and
    // first pick committed, so the prediction is rank 3.
    expect(progressiveCaptainFor(rankByTeam, new Set(["frc1", "frc2"]))).toBe("frc3");
    // Committing every captain up front instead yields rank 2 — a different,
    // wrong answer. The schedule is pinned, not incidental.
    expect(progressiveCaptainFor(rankByTeam, allAlliedUpFront)).toBe("frc2");
  });
});

describe("the NAIVE top-eight rule is a labelled BASELINE, never a gate", () => {
  it("returns ranks 1 through allianceCount ascending", () => {
    expect(naiveTopEightCaptains(ranks(20), 8)).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8"]);
  });

  it("scoring it removes no event from any population", () => {
    const rankByTeam = ranks(40);
    const alliances = [alliance(1, ["frc1", "frc2"]), alliance(2, ["frc3", "frc4"])];
    const census = emptyCensus();
    const slots = scoreEventCaptains("2026test", 2026, alliances, rankByTeam, census);
    // Every alliance produced a slot; nothing was filtered by the naive arm.
    expect(slots).toHaveLength(alliances.length);
    expect(census.eventsNotEightAlliance).toBe(0);
    expect(census.eventsWithUnrankedRosterTeam).toBe(0);
  });
});

describe("teacher forcing on the pick-order half", () => {
  const alliances = [
    alliance(1, ["frcA1", "frcB1", "frcC1"]),
    alliance(2, ["frcA2", "frcB2", "frcC2"]),
    alliance(3, ["frcA3", "frcB3", "frcC3"]),
  ];

  it("at alliance n's round-one turn, a FUTURE captain is still AVAILABLE", () => {
    const committed = committedAtTurn(alliances, { round: 1, allianceNumber: 1 });
    expect([...committed].sort()).toEqual(["frcA1"]);
    // Alliance 2's and 3's captains are not yet determined at that moment.
    expect(committed.has("frcA2")).toBe(false);
    expect(committed.has("frcA3")).toBe(false);
  });

  it("at alliance 2's round-one turn, alliance 1's captain AND first pick are committed", () => {
    const committed = committedAtTurn(alliances, { round: 1, allianceNumber: 2 });
    expect([...committed].sort()).toEqual(["frcA1", "frcA2", "frcB1"]);
  });

  it("at a round-two turn, every captain, every first pick and the LATER alliances' second picks are committed", () => {
    const committed = committedAtTurn(alliances, { round: 2, allianceNumber: 2 });
    expect([...committed].sort()).toEqual(["frcA1", "frcA2", "frcA3", "frcB1", "frcB2", "frcB3", "frcC3"]);
    // Alliance 2's own second pick is the thing being predicted, so it is not committed.
    expect(committed.has("frcC2")).toBe(false);
  });

  it("a team the real draft took at an earlier turn is absent from the pool at a later one, even if the model preferred it", () => {
    const pool = ["frcA1", "frcA2", "frcA3", "frcB1", "frcB2", "frcB3", "frcC1", "frcC2", "frcC3"];
    const totals = new Map(pool.map((t, i) => [t, 100 - i]));
    // The model would prefer frcB1 (the highest total after the captains) at
    // alliance 2's first-pick turn, but the real draft took it at turn 1.
    const committed = committedAtTurn(alliances, { round: 1, allianceNumber: 2 });
    const available = pool.filter((t) => !committed.has(t));
    expect(available).not.toContain("frcB1");
    expect(modelOrderingAtTurn(available, totals)[0]).not.toBe("frcB1");
  });

  it("a round-one turn scores picks[1] and a round-two turn scores picks[2]; the captain is never scored as a model pick", () => {
    expect(realPickAtTurn(alliances, { round: 1, allianceNumber: 1 })).toBe("frcB1");
    expect(realPickAtTurn(alliances, { round: 2, allianceNumber: 1 })).toBe("frcC1");
    expect(realPickAtTurn(alliances, { round: 1, allianceNumber: 1 })).not.toBe("frcA1");
  });
});

describe("the model's ordering is total and deterministic", () => {
  it("sorts by descending total and breaks an exact tie by ASCENDING TEAM KEY", () => {
    const totals = new Map([
      ["frcB", 50],
      ["frcA", 50],
      ["frcC", 60],
    ]);
    expect(modelOrderingAtTurn(["frcB", "frcA", "frcC"], totals)).toEqual(["frcC", "frcA", "frcB"]);
  });

  it("breaks a three-way tie the same way", () => {
    const totals = new Map([
      ["frcC", 10],
      ["frcA", 10],
      ["frcB", 10],
    ]);
    expect(modelOrderingAtTurn(["frcC", "frcB", "frcA"], totals)).toEqual(["frcA", "frcB", "frcC"]);
  });
});

describe("modelRankOfRealPick", () => {
  it("is 1 for an exact hit and the 1-based position otherwise", () => {
    expect(modelRankOfRealPick(["frcA", "frcB", "frcC"], "frcA")).toBe(1);
    expect(modelRankOfRealPick(["frcA", "frcB", "frcC"], "frcC")).toBe(3);
  });

  it("is the honest absent signal — never a number — when the real pick is not in the pool at all", () => {
    expect(modelRankOfRealPick(["frcA", "frcB"], "frcZ")).toBeUndefined();
  });
});

describe("the agreement metrics and their floor", () => {
  // Ranks 1, 3, 5, 2 — chosen so the two round breakouts and the pooled figure
  // are three DIFFERENT numbers; a fixture where they coincide cannot show that
  // the rounds are accumulated separately.
  const results = [turn(1, 1, 1, 40), turn(1, 2, 3, 39), turn(2, 8, 5, 30), turn(2, 7, 2, 29)];

  it("exactAgreement and top3Agreement return the hand-computed shares", () => {
    expect(exactAgreement(results)).toBeCloseTo(1 / 4, 12);
    expect(top3Agreement(results)).toBeCloseTo(3 / 4, 12);
  });

  it("both return undefined — never NaN — for an empty set", () => {
    expect(exactAgreement([])).toBeUndefined();
    expect(top3Agreement([])).toBeUndefined();
  });

  it("the no-information floor is 1 / availableCount, and the pooled floor is the mean of the per-turn floors", () => {
    expect(coinBaselineForTurn(40)).toBeCloseTo(0.025, 12);
    expect(coinBaselineForTurn(0)).toBe(0);
    expect(pooledCoinFloor(results)).toBeCloseTo((1 / 40 + 1 / 39 + 1 / 30 + 1 / 29) / 4, 12);
    expect(pooledCoinFloor([])).toBeUndefined();
  });

  it("modelRankStats returns the hand-computed mean, median and p90", () => {
    // sorted ranks: 1, 2, 3, 5 — mean 2.75, median (2 + 3) / 2 = 2.5, p90 index ceil(3.6)-1 = 3 → 5
    const stats = modelRankStats(results)!;
    expect(stats.mean).toBeCloseTo(2.75, 12);
    expect(stats.median).toBeCloseTo(2.5, 12);
    expect(stats.p90).toBe(5);
  });

  it("first-pick and second-pick turns are accumulated separately and never pooled silently", () => {
    const first = results.filter((r) => r.round === 1);
    const second = results.filter((r) => r.round === 2);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    // Three distinct numbers: 50% on first picks, 0% on second picks, 25% pooled.
    expect(exactAgreement(first)).toBeCloseTo(0.5, 12);
    expect(exactAgreement(second)).toBe(0);
    expect(exactAgreement(first)).not.toBe(exactAgreement(results));
    expect(exactAgreement(second)).not.toBe(exactAgreement(results));
  });
});

describe("every named counter, asserted separately", () => {
  it("alliancesMissingFirstPick fires for an alliance carrying fewer than two picks", () => {
    const census = emptyCensus();
    scoreEventCaptains("2026test", 2026, [alliance(1, ["frc1"])], ranks(10), census);
    expect(census.alliancesMissingFirstPick).toBe(1);
  });

  it("alliancesWithUnrankedCaptain is its own DIAGNOSTIC count and does not remove the slot", () => {
    const census = emptyCensus();
    const slots = scoreEventCaptains("2026test", 2026, [alliance(1, ["frcUnranked", "frc2"])], ranks(10), census);
    expect(census.alliancesWithUnrankedCaptain).toBe(1);
    expect(slots).toHaveLength(1);
  });

  it("secondPickTurnsAbsent fires for an alliance with no third pick, and removes the event from nothing", () => {
    const census = emptyCensus();
    const alliances = [alliance(1, ["frcA1", "frcB1"]), alliance(2, ["frcA2", "frcB2", "frcC2"])];
    const pool = ["frcA1", "frcA2", "frcB1", "frcB2", "frcC2", "frcD"];
    const totals = new Map(pool.map((t, i) => [t, 100 - i]));
    const turns = scoreEventPickOrder("2026test", 2026, alliances, pool, totals, census);
    expect(census.secondPickTurnsAbsent).toBe(1);
    // The event still contributes its other turns.
    expect(turns.length).toBeGreaterThan(0);
  });

  it("turnsUnmodelled fires when the real pick is not in the candidate pool at all", () => {
    const census = emptyCensus();
    const alliances = [alliance(1, ["frcA1", "frcOffRoster", "frcC1"])];
    const pool = ["frcA1", "frcC1", "frcD"];
    const totals = new Map(pool.map((t, i) => [t, 100 - i]));
    scoreEventPickOrder("2026test", 2026, alliances, pool, totals, census);
    expect(census.turnsUnmodelled).toBeGreaterThan(0);
  });

  it("the census carries every named counter, and NOT one that removes an event on the basis of how its captains rank", () => {
    const keys = Object.keys(emptyCensus());
    for (const named of [
      "eventsNotEightAlliance",
      "eventsWithUnrankedRosterTeam",
      "alliancesWithUnrankedCaptain",
      "alliancesMissingFirstPick",
      "secondPickTurnsAbsent",
      "eventsWithoutBoundarySpr",
      "turnsUnmodelled",
    ]) {
      expect(keys).toContain(named);
    }
    expect(keys.some((k) => /promoted|topEight|captainRank/i.test(k))).toBe(false);
  });

  it("progressiveMisses names each miss by event key and alliance number", () => {
    const census = emptyCensus();
    const slots = scoreEventCaptains("2026milac", 2026, [alliance(1, ["frc9", "frc2"])], ranks(10), census);
    expect(progressiveMisses(slots)).toEqual(["2026milac alliance 1"]);
  });
});

describe("the recorded constants are internally consistent", () => {
  it("every recorded rate is finite and in [0, 1]", () => {
    for (const rate of [
      MEASURED_EXACT_AGREEMENT,
      MEASURED_TOP3_AGREEMENT,
      MEASURED_FIRST_PICK_EXACT_AGREEMENT,
      MEASURED_SECOND_PICK_EXACT_AGREEMENT,
      MEASURED_FIRST_PICK_TOP3_AGREEMENT,
      MEASURED_SECOND_PICK_TOP3_AGREEMENT,
      MEASURED_POOLED_COIN_FLOOR,
      MEASURED_FIRST_PICK_COIN_FLOOR,
      MEASURED_SECOND_PICK_COIN_FLOOR,
    ]) {
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it("BOTH windows are specs parseSeasons accepts, and the command names both", () => {
    expect(parseSeasons(MEASURED_CAPTAIN_WINDOW).length).toBeGreaterThan(0);
    expect(parseSeasons(MEASURED_PICK_ORDER_WINDOW).length).toBeGreaterThan(0);
    expect(MEASURED_COMMAND).toContain(`--captain-seasons ${MEASURED_CAPTAIN_WINDOW}`);
    expect(MEASURED_COMMAND).toContain(`--seasons ${MEASURED_PICK_ORDER_WINDOW}`);
    expect(MEASURED_COMMAND).toContain(`--warmup-from ${MEASURED_PICK_ORDER_WARMUP_FROM}`);
  });

  it("the captain-slot numerators never exceed their denominator, and the two naive denominators are distinct", () => {
    expect(MEASURED_PROGRESSIVE_CORRECT_SLOTS).toBeLessThanOrEqual(MEASURED_CAPTAIN_SLOTS);
    expect(MEASURED_NAIVE_CORRECT_SLOTS).toBeLessThanOrEqual(MEASURED_CAPTAIN_SLOTS);
    expect(MEASURED_NAIVE_SET_EQUAL_EVENTS).toBeLessThanOrEqual(MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR);
    expect(MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR).not.toBe(MEASURED_USABLE_EVENTS);
  });

  it("the event census adds up: usable events plus exclusions equal the eight-alliance population", () => {
    expect(MEASURED_USABLE_EVENTS + MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM).toBe(MEASURED_EIGHT_ALLIANCE_EVENTS);
    expect(MEASURED_EXCLUDED_EVENT_KEYS).toHaveLength(MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM);
  });
});

// ───────────────────────── the corpus-guarded describe ─────────────────────────

describe("fresh measurement against the recorded constants", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest:alliances && pnpm ingest:rankings) first`, () => {});
    return;
  }

  it("reproduces every recorded CAPTAIN constant EXACTLY, and the population clears its floors", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    const census = emptyCensus();
    let captain: ReturnType<typeof measureCaptainHalf>;
    try {
      captain = measureCaptainHalf(db, parseSeasons(MEASURED_CAPTAIN_WINDOW), census);
    } finally {
      db.close();
    }

    const progressiveCorrect = captain.slots.filter((s) => s.progressivePrediction === s.realCaptain).length;
    const naiveCorrect = captain.slots.filter((s) => s.naivePrediction === s.realCaptain).length;

    // Integer equality, no tolerance: this half is pure SQL and integer
    // arithmetic, so a tolerance would only hide a real change.
    expect(captain.slots.length).toBe(MEASURED_CAPTAIN_SLOTS);
    expect(progressiveCorrect).toBe(MEASURED_PROGRESSIVE_CORRECT_SLOTS);
    expect(captain.perfectEventsProgressive).toBe(MEASURED_PROGRESSIVE_PERFECT_EVENTS);
    expect(captain.usableEvents).toBe(MEASURED_USABLE_EVENTS);
    expect(census.eventsWithUnrankedRosterTeam).toBe(MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM);
    expect([...captain.excludedEventKeys].sort()).toEqual([...MEASURED_EXCLUDED_EVENT_KEYS].sort());
    expect(progressiveMisses(captain.slots)).toEqual([...MEASURED_PROGRESSIVE_MISSES]);
    expect(naiveCorrect).toBe(MEASURED_NAIVE_CORRECT_SLOTS);
    expect(captain.naiveSetEqualEvents).toBe(MEASURED_NAIVE_SET_EQUAL_EVENTS);
    expect(captain.naiveSetEqualityDenominator).toBe(MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR);

    // Population FLOORS, so a future ingest regression that shrinks the scan
    // turns this red instead of quietly proving less. A pin that passes on four
    // events pins nothing; a pin that passes on three is what a captain-rank
    // gate would have produced.
    expect(captain.usableEvents).toBeGreaterThanOrEqual(485);
    expect(captain.slots.length).toBeGreaterThanOrEqual(3880);
    expect(captain.slots.length - progressiveCorrect).toBeLessThanOrEqual(1);
    expect(captain.perfectEventsProgressive).toBeGreaterThanOrEqual(484);
    expect(census.eventsWithUnrankedRosterTeam).toBe(6);
  });

  it("reproduces every recorded PICK-ORDER constant within its tolerance, and the population clears its floors", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    const census = emptyCensus();
    let pick: ReturnType<typeof measurePickOrderHalf>;
    try {
      pick = measurePickOrderHalf(db, parseSeasons(MEASURED_PICK_ORDER_WINDOW), MEASURED_PICK_ORDER_WARMUP_FROM, census);
    } finally {
      db.close();
    }

    const first = pick.turns.filter((t) => t.round === 1);
    const second = pick.turns.filter((t) => t.round === 2);
    const stats = modelRankStats(pick.turns)!;

    expect(pick.turns.length).toBe(MEASURED_PICK_TURNS);
    expect(first.length).toBe(MEASURED_FIRST_PICK_TURNS);
    expect(second.length).toBe(MEASURED_SECOND_PICK_TURNS);
    expect(pick.eventsScored).toBe(MEASURED_PICK_ORDER_EVENTS_SCORED);
    expect(census.eventsWithoutBoundarySpr).toBe(MEASURED_EVENTS_WITHOUT_BOUNDARY_SPR);

    // The replay is deterministic, so the tolerance covers float drift only.
    expect(exactAgreement(pick.turns)!).toBeCloseTo(MEASURED_EXACT_AGREEMENT, 4);
    expect(top3Agreement(pick.turns)!).toBeCloseTo(MEASURED_TOP3_AGREEMENT, 4);
    expect(exactAgreement(first)!).toBeCloseTo(MEASURED_FIRST_PICK_EXACT_AGREEMENT, 4);
    expect(exactAgreement(second)!).toBeCloseTo(MEASURED_SECOND_PICK_EXACT_AGREEMENT, 4);
    expect(top3Agreement(first)!).toBeCloseTo(MEASURED_FIRST_PICK_TOP3_AGREEMENT, 4);
    expect(top3Agreement(second)!).toBeCloseTo(MEASURED_SECOND_PICK_TOP3_AGREEMENT, 4);
    expect(stats.mean).toBeCloseTo(MEASURED_MEAN_MODEL_RANK, 3);
    expect(stats.median).toBe(MEASURED_MEDIAN_MODEL_RANK);
    expect(stats.p90).toBe(MEASURED_P90_MODEL_RANK);
    expect(pooledCoinFloor(pick.turns)!).toBeCloseTo(MEASURED_POOLED_COIN_FLOOR, 4);
    expect(pooledCoinFloor(first)!).toBeCloseTo(MEASURED_FIRST_PICK_COIN_FLOOR, 4);
    expect(pooledCoinFloor(second)!).toBeCloseTo(MEASURED_SECOND_PICK_COIN_FLOOR, 4);

    // Population floors.
    expect(pick.turns.length).toBeGreaterThanOrEqual(700);
    expect(first.length).toBeGreaterThanOrEqual(300);
    expect(second.length).toBeGreaterThanOrEqual(300);
    // The named counters plus the scored turns account for every turn the
    // serpentine order presents: sixteen per scored event.
    expect(
      pick.turns.length + census.turnsUnmodelled + census.secondPickTurnsAbsent + census.alliancesMissingFirstPick
    ).toBe(pick.eventsScored * 16);
  });
});
