/**
 * A small, deterministic two-season corpus for the as-of capture tests
 * (quick task 261005-5g0): a 2023 warmup event (the cold start, so the 2024
 * season starts from a carried SPR state and a Sigma carry) and a 2024 season
 * shaped to exercise everything the as-of format has to get right.
 *
 *   - Two concurrent week 1 events sharing six teams, with one sort_time
 *     shared across them, so the cross-event tie order is exercised.
 *   - Week 2 events, one with a demo robot (`frc9970`) beside real teams, one
 *     still in progress (scheduled, unplayed qualification rows).
 *   - A championship division and its finals parent interleaved, so a team
 *     plays the division, then the parent, then the division again: two
 *     segments at one event.
 *   - A week 3 event whose schedule has landed and nothing is played, which
 *     gets a pre-schedule sidecar when presim is on for 2024.
 *
 * Every 2024 played match carries a real-shaped 2024 breakdown (the RP
 * threshold variables vary), so the RP beliefs, the population and the mean
 * shift all move. Every played sort_time other than the one deliberate tie is
 * unique, so a cut at any played row is an exact instant for the oracle.
 */
import type { CorpusEvent, CorpusMatch } from "../../ingest/normalize.js";

/** A seeded generator, so the corpus is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const team = (n: number): string => `frc${n}`;
const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => team(from + i));

function event(eventKey: string, year: number, eventType: number, startDate: string, week: number | null): CorpusEvent {
  return { eventKey, year, eventType, isOffseason: false, startDate, name: eventKey, week, country: "USA", stateProv: "MI", districtKey: eventType === 1 ? "fim" : null };
}

function breakdown2024(rand: () => number, redScore: number, blueScore: number): string {
  const side = (score: number) => {
    const onStage = Math.floor(rand() * 4);
    const stagePoints = onStage * 3 + Math.floor(rand() * 3);
    const notes = 4 + Math.floor(rand() * 18);
    return {
      totalPoints: score,
      foulPoints: Math.floor(rand() * 6),
      adjustPoints: 0,
      autoAmpNoteCount: Math.floor(rand() * 3),
      autoSpeakerNoteCount: Math.floor(rand() * 4),
      teleopAmpNoteCount: Math.floor(notes / 3),
      teleopSpeakerNoteCount: notes - Math.floor(notes / 3),
      teleopSpeakerNoteAmplifiedCount: Math.floor(rand() * 3),
      endGameTotalStagePoints: stagePoints,
      endGameRobot1: onStage > 0 ? "StageLeft" : "None",
      endGameRobot2: onStage > 1 ? "StageRight" : "None",
      endGameRobot3: onStage > 2 ? "CenterStage" : "None",
      coopertitionBonusAchieved: false,
      melodyBonusAchieved: notes >= 18,
      ensembleBonusAchieved: stagePoints >= 10 && onStage >= 2,
      melodyBonusThresholdCoop: 15,
      melodyBonusThresholdNonCoop: 18,
      ensembleBonusStagePointsThreshold: 10,
      ensembleBonusOnStageRobotsThreshold: 2,
    };
  };
  return JSON.stringify({ red: side(redScore), blue: side(blueScore) });
}

interface MatchSpec {
  readonly eventKey: string;
  readonly compLevel: CorpusMatch["compLevel"];
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly sortTime: number;
  readonly red: readonly string[];
  readonly blue: readonly string[];
  readonly played: boolean;
  readonly breakdown: boolean;
}

function toMatch(spec: MatchSpec, rand: () => number): CorpusMatch {
  const key = spec.compLevel === "qm" ? `${spec.eventKey}_qm${spec.matchNumber}` : `${spec.eventKey}_${spec.compLevel}${spec.setNumber}m${spec.matchNumber}`;
  const redScore = spec.played ? 40 + Math.floor(rand() * 80) : null;
  const blueScore = spec.played ? 40 + Math.floor(rand() * 80) : null;
  const winner = redScore === null || blueScore === null ? null : redScore > blueScore ? "red" : redScore < blueScore ? "blue" : "tie";
  return {
    matchKey: key,
    eventKey: spec.eventKey,
    compLevel: spec.compLevel,
    matchNumber: spec.matchNumber,
    setNumber: spec.setNumber,
    sortTime: spec.sortTime,
    redTeams: [...spec.red],
    blueTeams: [...spec.blue],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner,
    winnerImputed: false,
    redScore,
    blueScore,
    redRpEarned: winner === null ? null : winner === "red" ? 2 : winner === "tie" ? 1 : 0,
    blueRpEarned: winner === null ? null : winner === "blue" ? 2 : winner === "tie" ? 1 : 0,
    hasScoreBreakdown: spec.played && spec.breakdown,
    scoreBreakdownRaw: spec.played && spec.breakdown && redScore !== null && blueScore !== null ? breakdown2024(rand, redScore, blueScore) : null,
    videoKey: null,
  };
}

/** `count` qualification matches over `roster`, each team in roughly the same number, alliances reshuffled per match. */
function quals(rand: () => number, eventKey: string, roster: readonly string[], count: number, firstTime: number, stepMs: number, options: { playedThrough?: number; breakdown?: boolean } = {}): MatchSpec[] {
  const out: MatchSpec[] = [];
  for (let n = 0; n < count; n++) {
    const shuffled = [...roster].sort(() => rand() - 0.5);
    out.push({
      eventKey,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: n + 1,
      sortTime: firstTime + n * stepMs,
      red: shuffled.slice(0, 3),
      blue: shuffled.slice(3, 6),
      played: options.playedThrough === undefined || n < options.playedThrough,
      breakdown: options.breakdown ?? true,
    });
  }
  return out;
}

export interface AsOfFixture {
  readonly events: readonly CorpusEvent[];
  /** Every match, played and scheduled, both seasons. */
  readonly matches: readonly CorpusMatch[];
}

const MINUTE = 60_000;

/** The fixture corpus's events and matches. Pure and deterministic. */
export function asOfFixture(): AsOfFixture {
  const rand = mulberry32(5_100_052);
  const t2023 = Date.parse("2023-03-04T15:00:00.000Z");
  const wk1 = Date.parse("2024-03-02T15:00:00.000Z");
  const wk2 = Date.parse("2024-03-09T15:00:00.000Z");
  const cmp = Date.parse("2024-04-18T15:00:00.000Z");
  const wk3 = Date.parse("2024-03-16T15:00:00.000Z");

  const events = [
    event("2023warm", 2023, 0, "2023-03-03", 0),
    event("2024aaa", 2024, 1, "2024-03-01", 0),
    event("2024bbb", 2024, 1, "2024-03-01", 0),
    event("2024ccc", 2024, 1, "2024-03-08", 1),
    event("2024ddd", 2024, 1, "2024-03-08", 1),
    event("2024eee", 2024, 1, "2024-03-15", 2),
    event("2024cmpdiv", 2024, 3, "2024-04-17", null),
    event("2024cmp", 2024, 4, "2024-04-17", null),
  ];

  const specs: MatchSpec[] = [
    // 2023: one cold-start event over the same teams, no breakdowns (Sigma carry only).
    ...quals(rand, "2023warm", range(1, 18), 18, t2023, 7 * MINUTE, { breakdown: false }),
    // Week 1: two concurrent events sharing frc7-frc12, offset by 3 minutes.
    ...quals(rand, "2024aaa", range(1, 12), 14, wk1, 7 * MINUTE),
    ...quals(rand, "2024bbb", range(7, 18), 14, wk1 + 3 * MINUTE, 7 * MINUTE),
  ];
  // The deliberate tie: 2024bbb qm5 shares 2024aaa qm5's sort_time.
  const tie = specs.find((m) => m.eventKey === "2024bbb" && m.matchNumber === 5)!;
  specs[specs.indexOf(tie)] = { ...tie, sortTime: specs.find((m) => m.eventKey === "2024aaa" && m.matchNumber === 5)!.sortTime };
  specs.push(
    { eventKey: "2024aaa", compLevel: "sf", setNumber: 1, matchNumber: 1, sortTime: wk1 + 200 * MINUTE, red: range(1, 3), blue: range(4, 6), played: true, breakdown: true },
    { eventKey: "2024aaa", compLevel: "f", setNumber: 1, matchNumber: 1, sortTime: wk1 + 230 * MINUTE, red: range(1, 3), blue: range(7, 9), played: true, breakdown: true },
    { eventKey: "2024bbb", compLevel: "f", setNumber: 1, matchNumber: 1, sortTime: wk1 + 241 * MINUTE, red: range(13, 15), blue: range(16, 18), played: true, breakdown: true },
    // Week 2: one event with a demo robot, one in progress (qm9 onward scheduled, unplayed).
    ...quals(rand, "2024ccc", [...range(1, 6), ...range(13, 18)], 12, wk2, 7 * MINUTE),
    ...quals(rand, "2024ddd", [...range(7, 11), "frc9970"], 8, wk2 + 2 * MINUTE, 7 * MINUTE, { playedThrough: 6 }),
    // Week 3: the schedule has landed, nothing played.
    ...quals(rand, "2024eee", range(1, 12), 10, wk3, 7 * MINUTE, { playedThrough: 0 }),
    // Championship: division qm1-3, then the parent's final, then division qm4-6.
    ...quals(rand, "2024cmpdiv", range(1, 12), 3, cmp, 7 * MINUTE),
    { eventKey: "2024cmp", compLevel: "f", setNumber: 1, matchNumber: 1, sortTime: cmp + 25 * MINUTE, red: range(1, 3), blue: range(4, 6), played: true, breakdown: true }
  );
  const later = quals(rand, "2024cmpdiv", range(1, 12), 3, cmp + 40 * MINUTE, 7 * MINUTE).map((m) => ({ ...m, matchNumber: m.matchNumber + 3 }));
  specs.push(...later);

  return { events, matches: specs.map((spec) => toMatch(spec, rand)) };
}
