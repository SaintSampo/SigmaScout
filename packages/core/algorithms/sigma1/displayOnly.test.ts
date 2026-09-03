/**
 * THE DISPLAY-ONLY INSTRUMENT (quick task 260902-varopr, D-V4).
 *
 * D-V4 locks the whole variance-decomposition task to one constraint:
 * `predict()` and `update()` must be BITWISE unchanged, and only
 * `teamMetrics`'s published `spread` may move. A "predict is unchanged" claim
 * verified after the fact by re-reading a diff is not a measurement. This file
 * is the measurement.
 *
 * It replays a fixed synthetic multi-event stream through `vpr` and pins two
 * things against a committed fixture:
 *
 *   1. The exact prediction stream — `[matchKey, pRedWin, redScore,
 *      blueScore]` per match, which is precisely the tuple
 *      `promote.ts`'s `computePredictionStreamDigest` hashes, reproduced here
 *      on a synthetic stream so the gate runs with no corpus present.
 *   2. A SHA-256 over the post-fold filter state, and a second one over the
 *      state after a `carrySeason` boundary — every field of `update()`'s
 *      accumulated result except the deliberately-excluded list below.
 *
 * ---------------------------------------------------------------------------
 * THE FIXTURE IS EVIDENCE. DO NOT REGENERATE IT TO MAKE A LATER TASK PASS.
 * ---------------------------------------------------------------------------
 *
 * `fixtures/display-only-baseline.json` was generated ONCE, from the code as
 * it stood BEFORE any of this task's changes (commit boundary: quick task
 * 260902-varopr Task 1). Its entire purpose is to be the thing a display-only
 * change is judged against. Regenerating it because a later task turned it red
 * destroys the only thing it is for, and leaves the project with a green suite
 * and no evidence at all — the exact shape of failure this project's own
 * failure log records.
 *
 * Borrowing `digest.test.ts`'s wording, because the discipline is identical: a
 * mismatch here is a finding about the code, not a fixture to refresh.
 *
 * Regeneration (only ever legitimate when the EXCLUSION LIST itself changes,
 * and then only in the same commit that changes it, with the reason recorded):
 *
 *     SIGMA1_WRITE_DISPLAY_ONLY_BASELINE=1 pnpm vitest run \
 *       packages/core/algorithms/sigma1/displayOnly.test.ts
 *
 * The default path only ever READS the fixture.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE STATE HASH COVERS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 *
 * The hash is taken over `packages/harness/stateSnapshot.ts`'s own
 * `serializeState` output rather than a second, hand-rolled canonicalizer —
 * that function already sorts every plain object's keys recursively and
 * converts every `Map` to a key-sorted entry array, which is exactly the
 * discipline a state hash needs so property insertion order can never flip the
 * result. Each row's `stateJson` is therefore ALREADY canonical; this file
 * parses it, deletes the excluded keys (deletion never reorders the survivors,
 * and `JSON.parse` preserves the canonical order it was given), and hashes the
 * concatenation.
 *
 * THE EXCLUSION LIST IS THIS TEST'S WHOLE CONTRACT: everything NOT named below
 * is frozen, and a change to any of it is a change to `update()`.
 *
 *   - `contributionStats` — Task 2 RETIRES commit 96e38754's never-published
 *     per-match contribution fold. It is excluded because it is about to be
 *     deleted, not because it is allowed to drift.
 *   - `lastContribution` — same fold, same reason.
 *   - `perEventVariance` (as `scopeKind: "event"` rows) — Task 4 ADDED the
 *     variance-decomposition accumulator to `Sigma1State` and serialized it as
 *     event-scoped rows. New state that publishes nothing is legitimately new;
 *     the point of this test is that adding it moves nothing else. RETIRED at
 *     7.0.0 (quick task 260903-750) along with the estimator itself — the
 *     exclusion is kept as a no-op so a re-added event row would still be
 *     silently ignored rather than silently hashed, and so this entry's history
 *     survives its subject.
 *   - `swing` — quick task 260903-750 REPLACES that accumulator with one
 *     running number per team per metric key, living on the TEAM row. Excluded
 *     for exactly the reason `perEventVariance` was: it is new state that
 *     `predict()` and `update()`'s filter math never read, and the whole claim
 *     under test is that adding it moves nothing else.
 *
 *     THE FIXTURE WAS NOT REGENERATED FOR IT, and that is the load-bearing
 *     half. With `swing` excluded, the SAME committed
 *     `display-only-baseline.json` — generated once, before 260902-varopr —
 *     still reproduces both state hashes character for character. Two
 *     successive display-estimator swaps have now been judged against one
 *     unregenerated baseline, which is the strongest form of the claim this
 *     file exists to make and is strictly stronger than a refreshed fixture
 *     could ever be.
 *   - `snapshotShapeVersion` — a SERIALIZER version, not filter state. Tasks 2
 *     and 4 each bump it (4 -> 5 -> 6), and 260903-750 bumps it again (6 -> 7),
 *     precisely because the stored field set changed; letting that number into
 *     the hash would make this test report a storage-format bump as though it
 *     were a prediction change.
 *
 * Nothing else may be added to this list without a recorded reason, and adding
 * a field to it to make a red test green is the prohibited move above under a
 * different name.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeState } from "../../../harness/stateSnapshot.js";
import { vpr } from "./index.js";
import type { MatchResult, SeasonBoundary, UpcomingMatch } from "../types.js";
import type { Sigma1State } from "./index.js";

const FIXTURE_PATH = join(
  "packages",
  "core",
  "algorithms",
  "sigma1",
  "fixtures",
  "display-only-baseline.json"
);

const WRITE_MODE = process.env["SIGMA1_WRITE_DISPLAY_ONLY_BASELINE"] === "1";

/**
 * Excluded from the state hash. See this file's header for the reason attached
 * to each — the list is the contract, so it lives beside the code that applies
 * it rather than only in prose.
 */
const EXCLUDED_TEAM_FIELDS = ["contributionStats", "lastContribution", "swing"] as const;
const EXCLUDED_LEAGUE_FIELDS = ["snapshotShapeVersion"] as const;
/** Task 4's `perEventVariance` serialized as its own scope kind; excluded wholesale. A NO-OP since 7.0.0 (Sigma1 emits no event rows) and kept deliberately — see the header. */
const EXCLUDED_SCOPE_KINDS = new Set<string>(["event"]);

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32 — the same small, well-mixed 32-bit PRNG
 * `packages/harness/identifiability.ts`, `packages/harness/tune.ts` and
 * `sigma1/rp/distribution.ts` all cite to the same source. COPIED here with
 * this citation rather than imported across a module boundary, matching
 * `innovationVariance.test.ts`'s own precedent: a fixture generator must not
 * silently change because a shared helper was refactored.
 *
 * `Math.random` is never used in this file. A fixture generated from an
 * unseeded stream would be unreproducible by construction.
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, two uniforms per call. Standard normal; callers scale. */
function makeGaussian(rng: () => number): () => number {
  return () => {
    const u1 = 1 - rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

// ---------------------------------------------------------------------------
// The synthetic stream
// ---------------------------------------------------------------------------

/**
 * The twelve 2024 components a team contributes to, paired with the raw
 * `score_breakdown` field each parses from (`breakdown/2024.ts`'s
 * `OWN_FIELD_COMPONENT_MAP`). `foulsCommitted` is held at 0 throughout: it is
 * cross-attributed from the OPPONENT's `foulPoints` (D-04), so synthetic noise
 * on it would model a quantity that is not this team's own performance.
 */
const COMPONENT_FIELDS = [
  "autoLeavePoints",
  "autoAmpNotePoints",
  "autoSpeakerNotePoints",
  "teleopAmpNotePoints",
  "teleopSpeakerNotePoints",
  "teleopSpeakerNoteAmplifiedPoints",
  "endGameOnStagePoints",
  "endGameParkPoints",
  "endGameHarmonyPoints",
  "endGameNoteInTrapPoints",
  "endGameSpotLightBonusPoints",
  "adjustPoints",
] as const;

const COMPONENT_COUNT = COMPONENT_FIELDS.length;

/** `rp/2024.ts`'s own schema's required fields. Held constant: no assertion here is about RP thresholds. */
const RP_PLACEHOLDER_FIELDS = {
  autoAmpNoteCount: 0,
  autoSpeakerNoteCount: 0,
  teleopAmpNoteCount: 0,
  teleopSpeakerNoteCount: 0,
  teleopSpeakerNoteAmplifiedCount: 0,
  endGameTotalStagePoints: 0,
  endGameRobot1: "None",
  endGameRobot2: "None",
  endGameRobot3: "None",
  coopertitionBonusAchieved: false,
  melodyBonusAchieved: false,
  ensembleBonusAchieved: false,
  melodyBonusThresholdCoop: 0,
  melodyBonusThresholdNonCoop: 0,
  ensembleBonusStagePointsThreshold: 0,
  ensembleBonusOnStageRobotsThreshold: 0,
};

const EVENT_A = "2024disa";
const EVENT_B = "2024disb";
/**
 * The one team that plays at BOTH events. Present because a cross-event
 * appearance is the only thing that exercises `applyTeamProcessNoise`'s
 * event-BOUNDARY `q` branch inside a single season, and because Task 4's
 * event-partitioned accumulator has to keep two independent rows for it.
 */
const SHARED_TEAM = "frc9999";
/** 39 own teams + the shared team = 40 per event, a realistic regional width for Task 4's solve. */
const TEAMS_PER_EVENT = 40;
const ROUNDS_PER_EVENT = 20;

interface SynthMatch {
  readonly matchKey: string;
  readonly eventKey: string;
  readonly matchNumber: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redSurrogates: readonly string[];
  readonly blueSurrogates: readonly string[];
  readonly redDqs: readonly string[];
  readonly blueDqs: readonly string[];
  readonly redComponents: readonly number[];
  readonly blueComponents: readonly number[];
  /** D-05's fallback path: a real match whose `score_breakdown` is absent. */
  readonly breakdownNull: boolean;
  /** Overrides the summed component total, for the whole-alliance-DQ-zero row. */
  readonly redScoreOverride?: number;
}

/**
 * Builds two CONCURRENT events whose matches are interleaved into one
 * chronological stream — deliberately, and it is load-bearing for what comes
 * after this task: an event-partitioned accumulator (Task 4) can pass
 * accidentally on a single-event stream, because "partition by event" and
 * "reset on event change" are indistinguishable there. Interleaving is what
 * tells them apart, and it is also what `replay.ts`'s `buildSeasonStream`
 * actually produces from a real season.
 */
function buildStream(seed: number): { teams: string[]; matches: SynthMatch[] } {
  const rng = makeRng(seed);
  const gaussian = makeGaussian(rng);

  const poolFor = (prefix: string): string[] => [
    ...Array.from({ length: TEAMS_PER_EVENT - 1 }, (_, i) => `frc${prefix}${String(i).padStart(2, "0")}`),
    SHARED_TEAM,
  ];
  const poolA = poolFor("1");
  const poolB = poolFor("2");
  const teams = [...new Set([...poolA, ...poolB])];

  const trueComponentMean = new Map<string, number>();
  for (const team of teams) {
    // 24..96 points per match, split evenly across components so the
    // components stay uncorrelated in the mean as well as in the noise.
    trueComponentMean.set(team, (24 + rng() * 72) / COMPONENT_COUNT);
  }
  // A genuine 3-25 point spread in per-match consistency, so the stream is a
  // realistic exercise for the decomposition Task 3 introduces (this test
  // itself asserts nothing about spreads — that is `varianceOpr.recovery.
  // test.ts`'s job).
  const trueSigma = new Map<string, number>();
  for (const team of teams) trueSigma.set(team, 3 + rng() * 22);

  const sideTotals = (sideTeams: readonly string[]): number[] =>
    Array.from({ length: COMPONENT_COUNT }, () =>
      sideTeams.reduce(
        (sum, team) =>
          sum + trueComponentMean.get(team)! + (gaussian() * trueSigma.get(team)!) / Math.sqrt(COMPONENT_COUNT),
        0
      )
    );

  const perEvent = new Map<string, SynthMatch[]>([
    [EVENT_A, []],
    [EVENT_B, []],
  ]);

  for (const [eventKey, pool] of [
    [EVENT_A, poolA],
    [EVENT_B, poolB],
  ] as const) {
    const list = perEvent.get(eventKey)!;
    for (let round = 0; round < ROUNDS_PER_EVENT; round++) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (let m = 0; m + 6 <= shuffled.length; m += 6) {
        const redTeams = shuffled.slice(m, m + 3);
        const blueTeams = shuffled.slice(m + 3, m + 6);
        const matchNumber = list.length + 1;
        list.push({
          matchKey: `${eventKey}_qm${matchNumber}`,
          eventKey,
          matchNumber,
          redTeams,
          blueTeams,
          redSurrogates: [],
          blueSurrogates: [],
          redDqs: [],
          blueDqs: [],
          redComponents: sideTotals(redTeams),
          blueComponents: sideTotals(blueTeams),
          breakdownNull: false,
        });
      }
    }
  }

  // The three special rows, each patched onto an ALREADY-GENERATED match so
  // the underlying draw sequence is untouched (patching after generation keeps
  // every other match's numbers identical to a stream without them):
  //
  //   - an ENTIRELY SURROGATE alliance and a WHOLE-ALLIANCE-DQ-ZERO alliance,
  //     both of which must fold NOTHING at all. Task 4's accumulator has to
  //     skip exactly the same two rows the Kalman update already skips, and
  //     the only way to notice it did not is for both to be in the stream.
  //   - a match with NO `score_breakdown`, which takes D-05's proportional
  //     fallback with `FALLBACK_NOISE_MULTIPLIER` applied.
  const patch = (eventKey: string, index: number, changes: Partial<SynthMatch>): void => {
    const list = perEvent.get(eventKey)!;
    list[index] = { ...list[index]!, ...changes };
  };
  const listA = perEvent.get(EVENT_A)!;
  const listB = perEvent.get(EVENT_B)!;
  patch(EVENT_A, 40, { redSurrogates: [...listA[40]!.redTeams] });
  patch(EVENT_A, 55, { redDqs: [...listA[55]!.redTeams], redScoreOverride: 0 });
  patch(EVENT_B, 33, { breakdownNull: true });
  patch(EVENT_B, 61, { blueSurrogates: [...listB[61]!.blueTeams] });

  // Interleave: one round of A, one round of B, repeatedly. 6 matches per
  // round per event, 20 rounds each -> 120 matches per event, 240 total.
  const matches: SynthMatch[] = [];
  const perRound = 6;
  for (let round = 0; round < ROUNDS_PER_EVENT; round++) {
    matches.push(...listA.slice(round * perRound, (round + 1) * perRound));
    matches.push(...listB.slice(round * perRound, (round + 1) * perRound));
  }

  return { teams, matches };
}

function rawBreakdown(m: SynthMatch): string {
  const side = (components: readonly number[]): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...RP_PLACEHOLDER_FIELDS };
    COMPONENT_FIELDS.forEach((field, i) => {
      out[field] = components[i]!;
    });
    out["foulPoints"] = 0;
    return out;
  };
  return JSON.stringify({ red: side(m.redComponents), blue: side(m.blueComponents) });
}

function toMatchResult(m: SynthMatch): MatchResult {
  const redScore = m.redScoreOverride ?? m.redComponents.reduce((a, b) => a + b, 0);
  const blueScore = m.blueComponents.reduce((a, b) => a + b, 0);
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: m.matchNumber,
    redTeams: [...m.redTeams],
    blueTeams: [...m.blueTeams],
    redSurrogates: [...m.redSurrogates],
    blueSurrogates: [...m.blueSurrogates],
    redDqs: [...m.redDqs],
    blueDqs: [...m.blueDqs],
    winner: redScore === blueScore ? "tie" : redScore > blueScore ? "red" : "blue",
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: !m.breakdownNull,
    scoreBreakdownRaw: m.breakdownNull ? null : rawBreakdown(m),
    eventType: 0,
  };
}

function toUpcoming(m: SynthMatch): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: m.matchNumber,
    redTeams: [...m.redTeams],
    blueTeams: [...m.blueTeams],
    redSurrogates: [...m.redSurrogates],
    blueSurrogates: [...m.blueSurrogates],
    eventType: 0,
  };
}

// ---------------------------------------------------------------------------
// The replay + the two hashed quantities
// ---------------------------------------------------------------------------

type PredictionTuple = [string, number, number, number];

/**
 * `serializeState`'s rows, projected down to the frozen field set and hashed.
 * See this file's header for why the projection is a DELETION from an
 * already-canonical string rather than a second canonicalizer.
 */
function hashState(state: Sigma1State): string {
  const rows = serializeState("vpr", "display-only-baseline", state, {
    generation: "display-only",
    computedAt: "1970-01-01T00:00:00.000Z",
  });
  const parts: string[] = [];
  for (const row of rows) {
    if (EXCLUDED_SCOPE_KINDS.has(row.scopeKind)) continue;
    const payload = JSON.parse(row.stateJson) as Record<string, unknown>;
    if (row.scopeKind === "league") {
      for (const field of EXCLUDED_LEAGUE_FIELDS) delete payload[field];
    } else {
      const current = payload["current"] as Record<string, unknown> | undefined;
      if (current) for (const field of EXCLUDED_TEAM_FIELDS) delete current[field];
    }
    parts.push(`${row.scopeKind} ${row.scopeKey} ${JSON.stringify(payload)}`);
  }
  return createHash("sha256").update(parts.join(""), "utf8").digest("hex");
}

interface Baseline {
  readonly note: string;
  readonly seed: number;
  readonly matchCount: number;
  readonly teamCount: number;
  readonly predictions: readonly PredictionTuple[];
  readonly postFoldStateSha256: string;
  readonly postCarryStateSha256: string;
}

const SEED = 20260902;

function replay(): Baseline {
  const { teams, matches } = buildStream(SEED);
  let state = vpr.initState(teams);
  const predictions: PredictionTuple[] = [];
  for (const m of matches) {
    // WALK-FORWARD: predict from the pre-fold state, then fold. Reversing
    // these two lines is the leak this project's failure log names, and it
    // would silently change every tuple below.
    const prediction = vpr.predict(state, toUpcoming(m));
    predictions.push([m.matchKey, prediction.pRedWin, prediction.redScore, prediction.blueScore]);
    state = vpr.update(state, toMatchResult(m));
  }
  const postFoldStateSha256 = hashState(state);

  // The season boundary. Both Task 2 (which deletes fields `carrySeason`
  // initializes) and Task 4 (which adds one it must RESET) touch this path, so
  // the carried state gets its own hash rather than riding inside the one
  // above where a change to it could cancel out against a change to the fold.
  const boundary: SeasonBoundary = { fromSeason: 2024, toSeason: 2025, isColdStart: false };
  // `carrySeason` is optional on `AlgorithmModule`; Sigma1 always provides it
  // (`sigma1.test.ts`'s own call sites use the same non-null assertion).
  const carried = vpr.carrySeason!(state, boundary);
  const postCarryStateSha256 = hashState(carried);

  return {
    note:
      "Generated ONCE from pre-change code by quick task 260902-varopr Task 1. " +
      "A mismatch is a finding about the code, not a fixture to refresh — see displayOnly.test.ts's header.",
    seed: SEED,
    matchCount: matches.length,
    teamCount: teams.length,
    predictions,
    postFoldStateSha256,
    postCarryStateSha256,
  };
}

describe("display-only guard (D-V4): predict() and update() are bitwise frozen", () => {
  const actual = replay();

  if (WRITE_MODE) {
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    it("WROTE the baseline fixture (SIGMA1_WRITE_DISPLAY_ONLY_BASELINE=1) — rerun without the env var to assert against it", () => {
      expect(existsSync(FIXTURE_PATH)).toBe(true);
    });
    return;
  }

  const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Baseline;

  it("the fixture is not vacuous: a non-zero match count and team count", () => {
    // A generator that silently degenerated to an empty replay would satisfy
    // every equality assertion below trivially. These two lines are what stop
    // that from reading as a pass.
    expect(expected.matchCount).toBeGreaterThan(0);
    expect(expected.teamCount).toBeGreaterThan(0);
    expect(actual.matchCount).toBe(expected.matchCount);
    expect(actual.teamCount).toBe(expected.teamCount);
    expect(actual.predictions.length).toBe(expected.matchCount);
  });

  it("reproduces the committed prediction stream bitwise ([matchKey, pRedWin, redScore, blueScore])", () => {
    // The identical tuple `computePredictionStreamDigest` hashes — so this is
    // the same gate `digest.test.ts` applies to the committed version files,
    // run on a synthetic stream that needs no corpus.
    expect(actual.predictions).toEqual(expected.predictions);
  });

  it("reproduces the committed post-fold filter-state hash", () => {
    expect(actual.postFoldStateSha256).toBe(expected.postFoldStateSha256);
  });

  it("reproduces the committed post-carrySeason state hash", () => {
    expect(actual.postCarryStateSha256).toBe(expected.postCarryStateSha256);
  });
});
