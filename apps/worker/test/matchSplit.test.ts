/**
 * THE PROOF THAT THE TRIM IS OUTPUT-IDENTICAL (quick task 260921-vzf).
 *
 * `splitEventMatches` skips `normalizeMatch` — and therefore the
 * `JSON.stringify(score_breakdown)` — for every match at or before the fold
 * cursor and for every still-upcoming match. That is only safe if it produces
 * exactly what normalizing everything produced. This file diffs the production
 * path against `splitEventMatchesNormalizeAll`, the retained reference
 * implementation, over one ~100-match fixture at five cursor positions, on
 * every quantity the cursor contract and the published artifacts can see:
 * the event order, the newly-folded set and its full normalized contents, the
 * derived `lastFoldedMatchKey`, the derived touched-team array, and the
 * upcoming rows both as `ScheduledMatchFacts` and as the
 * `buildEventScheduledRow` output that actually lands in an artifact.
 *
 * The fixture is built so ORDERING DECIDES rather than happens to work: a row
 * with no TBA time at all (the composite `sortTime` fallback), an `sf` set and
 * an `f` match at the same instant (comp-level play order decides), two rows
 * tying on every field above `matchKey` (the defensive final tie-break
 * decides), and the whole list supplied out of order.
 *
 * The normalize COUNT is asserted, not inferred: the module is wrapped with a
 * counter, so "the trim actually trims" is a measured fact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const normalizeCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../../packages/ingest/normalize.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../packages/ingest/normalize.js")>();
  return {
    ...actual,
    normalizeMatch: (...args: Parameters<typeof actual.normalizeMatch>) => {
      normalizeCalls.count += 1;
      return actual.normalizeMatch(...args);
    },
  };
});

import { splitEventMatches, splitEventMatchesNormalizeAll, type EventMatchSplit } from "../src/matchSplit.js";
import { buildEventScheduledRow } from "../src/artifactMerge.js";
import { foldedCutoffIndex, hasAlreadyFolded } from "../src/stateStore.js";
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";

const EVENT_KEY = "2026casj";
// The `window.startMs` approximation `processEvent` passes, in the same shape.
const EVENT_START_ISO = new Date(Date.parse("2026-03-05T00:00:00.000Z")).toISOString();
const BASE_TIME_SEC = 1_772_900_000;

/**
 * A raw TBA match, modelled on `scheduled.rowParity.test.ts`'s helper of the
 * same name and DELIBERATELY NOT IMPORTED FROM IT — a test fixture is not an
 * API, and two suites sharing one fixture is how a fixture quietly grows
 * parameters neither suite wanted.
 */
interface TbaFixture {
  readonly key: string;
  readonly compLevel: "qm" | "sf" | "f";
  readonly setNumber?: number;
  readonly matchNumber: number;
  /** `undefined` = derive from `matchNumber`; `null` = no TBA time at all (composite fallback). */
  readonly actualTimeSec?: number | null;
  readonly predictedTimeSec?: number | null;
  readonly scheduledTimeSec?: number | null;
  readonly played?: boolean;
  readonly redScore?: number;
  readonly blueScore?: number;
  readonly winningAlliance?: "red" | "blue" | "";
  readonly redTeams?: readonly string[];
  readonly blueTeams?: readonly string[];
  readonly redSurrogates?: readonly string[];
  readonly redDqs?: readonly string[];
  readonly blueDqs?: readonly string[];
  readonly videos?: readonly { type: string; key: string }[];
  readonly breakdown?: unknown;
}

function breakdownSide(rp: number, seed: number) {
  return {
    rp,
    autoTowerPoints: seed % 17,
    endGameTowerPoints: seed % 23,
    hubScore: { totalCount: 100 + (seed % 90), cycles: [seed, seed + 1, seed + 2] },
    energizedAchieved: seed % 2 === 0,
    superchargedAchieved: seed % 5 === 0,
    traversalAchieved: seed % 3 === 0,
  };
}

function tbaMatch(f: TbaFixture): unknown {
  const played = f.played ?? true;
  const seed = f.matchNumber;
  const redScore = played ? (f.redScore ?? 120 + (seed % 40)) : null;
  const blueScore = played ? (f.blueScore ?? 110 + (seed % 37)) : null;
  return {
    key: f.key,
    event_key: EVENT_KEY,
    comp_level: f.compLevel,
    set_number: f.setNumber ?? 1,
    match_number: f.matchNumber,
    time: f.scheduledTimeSec === undefined ? null : f.scheduledTimeSec,
    predicted_time: f.predictedTimeSec === undefined ? null : f.predictedTimeSec,
    actual_time: f.actualTimeSec === undefined ? BASE_TIME_SEC + seed * 600 : f.actualTimeSec,
    winning_alliance: f.winningAlliance ?? (played ? "red" : ""),
    alliances: {
      red: {
        team_keys: f.redTeams ?? [`frc${100 + seed}`, `frc${200 + seed}`, `frc${300 + seed}`],
        surrogate_team_keys: f.redSurrogates ?? [],
        dq_team_keys: f.redDqs ?? [],
        score: redScore,
      },
      blue: {
        team_keys: f.blueTeams ?? [`frc${400 + seed}`, `frc${500 + seed}`, `frc${600 + seed}`],
        surrogate_team_keys: [],
        dq_team_keys: f.blueDqs ?? [],
        score: blueScore,
      },
    },
    ...(f.videos !== undefined ? { videos: f.videos } : {}),
    score_breakdown: f.breakdown === undefined ? { red: breakdownSide(4, seed), blue: breakdownSide(1, seed + 7) } : f.breakdown,
  };
}

/**
 * ~100 matches: a played qualification prefix, an unplayed qualification tail,
 * a played playoff bracket, and the ordering/content oddities named in this
 * file's header. Supplied deliberately out of order.
 */
function buildFixture(): readonly TbaMatch[] {
  const raw: unknown[] = [];

  // 1..60: played quals. Content oddities are sprinkled through the prefix so
  // they land inside the folded window at several cursor positions.
  for (let n = 1; n <= 60; n += 1) {
    const extras: Partial<TbaFixture> = {};
    if (n === 7) Object.assign(extras, { redScore: 99, blueScore: 99, winningAlliance: "" }); // a tie
    if (n === 11) Object.assign(extras, { redScore: 140, blueScore: 88, winningAlliance: "" }); // imputed winner
    if (n === 17) Object.assign(extras, { breakdown: null }); // no score breakdown at all
    if (n === 23) {
      Object.assign(extras, {
        videos: [
          { type: "tba", key: `${EVENT_KEY}_qm23` },
          { type: "youtube", key: "abc123XYZ90?t=42" },
        ],
      });
    }
    if (n === 29) Object.assign(extras, { redSurrogates: [`frc${100 + n}`], redDqs: [`frc${300 + n}`] });
    if (n === 31) Object.assign(extras, { blueDqs: [`frc${400 + n}`, `frc${500 + n}`] });
    if (n === 37) Object.assign(extras, { actualTimeSec: null, predictedTimeSec: null, scheduledTimeSec: null }); // composite fallback
    if (n === 41) Object.assign(extras, { actualTimeSec: null, predictedTimeSec: BASE_TIME_SEC + 41 * 600 }); // predicted_time leg
    if (n === 43) Object.assign(extras, { actualTimeSec: null, predictedTimeSec: null, scheduledTimeSec: BASE_TIME_SEC + 43 * 600 }); // scheduled leg
    if (n === 47) Object.assign(extras, { breakdown: { red: { rp: 32.5 }, blue: { tba_rpEarned: 2 } } }); // non-integer rp degrades
    raw.push(tbaMatch({ key: `${EVENT_KEY}_qm${n}`, compLevel: "qm", matchNumber: n, ...extras }));
  }

  // TWO ROWS TYING ON EVERY FIELD ABOVE `matchKey`: same sortTime, same comp
  // level, same set, same match number. Only the defensive `localeCompare`
  // tie-break can separate them, and both paths must break it identically.
  raw.push(tbaMatch({ key: `${EVENT_KEY}_qm60b`, compLevel: "qm", matchNumber: 60, actualTimeSec: BASE_TIME_SEC + 60 * 600 }));

  // 61..85: unplayed quals (TBA's two unplayed shapes: null, and the -1 sentinel).
  for (let n = 61; n <= 85; n += 1) {
    raw.push(
      tbaMatch({
        key: `${EVENT_KEY}_qm${n}`,
        compLevel: "qm",
        matchNumber: n,
        played: false,
        actualTimeSec: null,
        predictedTimeSec: BASE_TIME_SEC + n * 600,
        ...(n % 3 === 0 ? { redScore: -1, blueScore: -1 } : {}),
      })
    );
  }
  // The -1 sentinel shape, which `isPlayed` must read as unplayed the same way
  // `normalizeMatch` does.
  raw.push(
    tbaMatch({
      key: `${EVENT_KEY}_qm86`,
      compLevel: "qm",
      matchNumber: 86,
      played: true,
      redScore: -1,
      blueScore: -1,
      winningAlliance: "",
      actualTimeSec: null,
      predictedTimeSec: BASE_TIME_SEC + 86 * 600,
    })
  );

  // A PLAYED `sf` SET AND A PLAYED `f` AT THE SAME INSTANT AS AN `sf`, so
  // comp-level play order — not the timestamp — decides.
  const PLAYOFF_TIME = BASE_TIME_SEC + 90 * 600;
  for (let set = 1; set <= 4; set += 1) {
    raw.push(tbaMatch({ key: `${EVENT_KEY}_sf${set}m1`, compLevel: "sf", setNumber: set, matchNumber: 1, actualTimeSec: PLAYOFF_TIME }));
  }
  raw.push(tbaMatch({ key: `${EVENT_KEY}_f1m1`, compLevel: "f", setNumber: 1, matchNumber: 1, actualTimeSec: PLAYOFF_TIME }));
  raw.push(tbaMatch({ key: `${EVENT_KEY}_f1m2`, compLevel: "f", setNumber: 1, matchNumber: 2, actualTimeSec: PLAYOFF_TIME, played: false }));

  // DELIBERATELY OUT OF ORDER: a deterministic shuffle, so neither path can
  // pass by inheriting the input order.
  const shuffled = [...raw];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = (i * 7 + 3) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return tbaMatchListSchema.parse(shuffled);
}

const FIXTURE = buildFixture();

/** Exactly `processEvent`'s own derivations off a split, so the test compares what the tick actually uses. */
function derive(split: EventMatchSplit) {
  return {
    orderedMatchKeys: split.orderedMatchKeys,
    newlyFolded: split.newlyFolded,
    stillUpcoming: split.stillUpcoming,
    touchedTeams: [...new Set(split.newlyFolded.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort(),
    lastFoldedMatchKey: split.newlyFolded.length === 0 ? null : split.newlyFolded[split.newlyFolded.length - 1]!.matchKey,
    scheduledRows: split.stillUpcoming.map((m) => buildEventScheduledRow(m, undefined)),
    scheduledRowsWithSortTime: split.stillUpcoming.map((m, i) => buildEventScheduledRow(m, 1_700_000_000_000 + i)),
  };
}

// The five cursor positions, resolved against the reference path's own order so
// "the first / middle / last played match" means what it says.
const REFERENCE_ORDER = splitEventMatchesNormalizeAll(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: null });
const ALL_PLAYED_KEYS = REFERENCE_ORDER.newlyFolded.map((m) => m.matchKey);

const CURSORS: { readonly name: string; readonly lastFoldedMatchKey: string | null }[] = [
  { name: "nothing folded yet (null cursor)", lastFoldedMatchKey: null },
  { name: "the first ordered match", lastFoldedMatchKey: REFERENCE_ORDER.orderedMatchKeys[0]! },
  { name: "the middle of the played prefix (the realistic mid-event tick)", lastFoldedMatchKey: ALL_PLAYED_KEYS[Math.floor(ALL_PLAYED_KEYS.length / 2)]! },
  { name: "the last played match (nothing newly folded)", lastFoldedMatchKey: ALL_PLAYED_KEYS[ALL_PLAYED_KEYS.length - 1]! },
  { name: "an anchor absent from this tick's list", lastFoldedMatchKey: `${EVENT_KEY}_qm9999` },
];

beforeEach(() => {
  normalizeCalls.count = 0;
});

describe("splitEventMatches — the fixture itself is worth trusting", () => {
  it("is ~100 matches with a played prefix, an unplayed tail and a playoff bracket", () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(90);
    expect(REFERENCE_ORDER.newlyFolded.length).toBeGreaterThan(50);
    expect(REFERENCE_ORDER.stillUpcoming.length).toBeGreaterThan(20);
    expect(REFERENCE_ORDER.newlyFolded.length + REFERENCE_ORDER.stillUpcoming.length).toBe(FIXTURE.length);
  });

  it("makes ordering decide: comp-level play order puts the finals last, after every sf", () => {
    const keys = REFERENCE_ORDER.orderedMatchKeys;
    expect(keys[keys.length - 1]).toBe(`${EVENT_KEY}_f1m2`);
    expect(keys.indexOf(`${EVENT_KEY}_f1m1`)).toBeGreaterThan(keys.indexOf(`${EVENT_KEY}_sf4m1`));
  });

  it("makes the matchKey tie-break decide: two rows tie on every field above it", () => {
    const a = REFERENCE_ORDER.orderedMatchKeys.indexOf(`${EVENT_KEY}_qm60`);
    const b = REFERENCE_ORDER.orderedMatchKeys.indexOf(`${EVENT_KEY}_qm60b`);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBe(a + 1);
  });

  it("exercises the content branches the trim skips for folded matches", () => {
    const byKey = new Map(REFERENCE_ORDER.newlyFolded.map((m) => [m.matchKey, m]));
    expect(byKey.get(`${EVENT_KEY}_qm7`)!.winner).toBe("tie");
    expect(byKey.get(`${EVENT_KEY}_qm11`)!.winnerImputed).toBe(true);
    expect(byKey.get(`${EVENT_KEY}_qm17`)!.hasScoreBreakdown).toBe(false);
    expect(byKey.get(`${EVENT_KEY}_qm23`)!.videoKey).toBe("abc123XYZ90?t=42");
    expect(byKey.get(`${EVENT_KEY}_qm29`)!.redSurrogates).toEqual([`frc${100 + 29}`]);
    expect(byKey.get(`${EVENT_KEY}_qm31`)!.blueDqs).toHaveLength(2);
    expect(byKey.get(`${EVENT_KEY}_qm47`)!.redRpEarned).toBeNull();
    expect(byKey.get(`${EVENT_KEY}_qm47`)!.blueRpEarned).toBe(2);
  });

  it("treats both unplayed shapes — null and the -1 sentinel — as upcoming", () => {
    const upcomingKeys = new Set(REFERENCE_ORDER.stillUpcoming.map((m) => m.matchKey));
    expect(upcomingKeys.has(`${EVENT_KEY}_qm86`)).toBe(true);
    expect(upcomingKeys.has(`${EVENT_KEY}_qm63`)).toBe(true);
  });
});

describe.each(CURSORS)("splitEventMatches vs the reference, cursor = $name", ({ lastFoldedMatchKey }) => {
  const cursor = { lastFoldedMatchKey };

  it("agrees on every quantity the cursor contract and the artifacts can see", () => {
    const trimmed = derive(splitEventMatches(FIXTURE, EVENT_START_ISO, cursor));
    const reference = derive(splitEventMatchesNormalizeAll(FIXTURE, EVENT_START_ISO, cursor));

    expect(trimmed.orderedMatchKeys).toEqual(reference.orderedMatchKeys);
    expect(trimmed.newlyFolded).toEqual(reference.newlyFolded);
    expect(trimmed.stillUpcoming).toEqual(reference.stillUpcoming);
    expect(trimmed.touchedTeams).toEqual(reference.touchedTeams);
    expect(trimmed.lastFoldedMatchKey).toBe(reference.lastFoldedMatchKey);
    expect(trimmed.scheduledRows).toEqual(reference.scheduledRows);
    expect(trimmed.scheduledRowsWithSortTime).toEqual(reference.scheduledRowsWithSortTime);
  });

  it("agrees down to the breakdown text of every folded match", () => {
    const trimmed = splitEventMatches(FIXTURE, EVENT_START_ISO, cursor);
    const reference = splitEventMatchesNormalizeAll(FIXTURE, EVENT_START_ISO, cursor);
    expect(trimmed.newlyFolded.map((m) => m.scoreBreakdownRaw)).toEqual(reference.newlyFolded.map((m) => m.scoreBreakdownRaw));
  });

  it("normalizes exactly the matches it folds, and the reference normalizes all of them", () => {
    normalizeCalls.count = 0;
    const trimmed = splitEventMatches(FIXTURE, EVENT_START_ISO, cursor);
    const trimmedNormalizes = normalizeCalls.count;

    normalizeCalls.count = 0;
    const reference = splitEventMatchesNormalizeAll(FIXTURE, EVENT_START_ISO, cursor);
    const referenceNormalizes = normalizeCalls.count;

    expect(trimmedNormalizes).toBe(trimmed.newlyFolded.length);
    expect(referenceNormalizes).toBe(FIXTURE.length);
    expect(reference.newlyFolded.length).toBe(trimmed.newlyFolded.length);
  });

  it("agrees with hasAlreadyFolded on every match in the list", () => {
    const { orderedMatchKeys } = splitEventMatches(FIXTURE, EVENT_START_ISO, cursor);
    const cutoff = foldedCutoffIndex(cursor, orderedMatchKeys);
    for (let i = 0; i < orderedMatchKeys.length; i += 1) {
      expect(i <= cutoff).toBe(hasAlreadyFolded(cursor, orderedMatchKeys[i]!, orderedMatchKeys));
    }
  });
});

describe("the cursor positions mean what their names say", () => {
  it("the null cursor folds every played match", () => {
    const split = splitEventMatches(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: null });
    expect(split.newlyFolded.length).toBe(ALL_PLAYED_KEYS.length);
  });

  it("the last-played cursor folds nothing", () => {
    const split = splitEventMatches(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: ALL_PLAYED_KEYS[ALL_PLAYED_KEYS.length - 1]! });
    expect(split.newlyFolded).toEqual([]);
    expect(normalizeCalls.count).toBe(0);
  });

  it("an absent anchor degrades to nothing-folded-yet rather than throwing", () => {
    const split = splitEventMatches(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: `${EVENT_KEY}_qm9999` });
    expect(split.newlyFolded.length).toBe(ALL_PLAYED_KEYS.length);
    expect(foldedCutoffIndex({ lastFoldedMatchKey: `${EVENT_KEY}_qm9999` }, split.orderedMatchKeys)).toBe(-1);
  });

  it("the mid-event cursor leaves a small tail to fold, which is the case the trim is for", () => {
    const anchor = ALL_PLAYED_KEYS[ALL_PLAYED_KEYS.length - 2]!;
    const split = splitEventMatches(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: anchor });
    expect(split.newlyFolded.map((m) => m.matchKey)).toEqual([ALL_PLAYED_KEYS[ALL_PLAYED_KEYS.length - 1]!]);
    expect(normalizeCalls.count).toBe(1);
  });

  it("every unplayed match is republished regardless of where the cursor sits", () => {
    const counts = CURSORS.map((c) => splitEventMatches(FIXTURE, EVENT_START_ISO, { lastFoldedMatchKey: c.lastFoldedMatchKey }).stillUpcoming.length);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(REFERENCE_ORDER.stillUpcoming.length);
  });
});
