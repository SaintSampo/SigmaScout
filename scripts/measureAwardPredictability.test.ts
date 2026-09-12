/**
 * Unit tests for `measureAwardPredictability.ts` (quick tasks 260912-5n8 T3 and
 * 260912-7bp T3). Synthetic fixtures only — no test here opens the corpus, and
 * no test here touches the network.
 *
 * THE LEAK TESTS ARE THE LOAD-BEARING ONES. This whole probe is worthless if a
 * scored season's fit or features can see that season's own data: an in-sample
 * number would look like an answer and be none. Two independent leak tests
 * pin it — one on the feature builder's input set directly, one end-to-end
 * through `runExperiment` — because this project's failure log already records
 * what a missing evaluation guard costs. 7bp extends both over the seven-feature
 * age vector: `rookie_year` is a static historical fact and therefore legal, but
 * "it is legal" is an argument, not a substitute for the check.
 *
 * THE SECOND LOAD-BEARING GROUP IS THE ROOKIE BASELINES. An age feature added
 * while B1 and B2 stay structurally pinned at 0.0% on the rookie award types
 * would manufacture a fake win, so RB1/RB2 and the max-of-four verdict rule are
 * pinned here rather than left to the report's prose.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  ABSTAIN,
  AGE_FEATURE_COUNT,
  FEATURE_COUNT,
  BUCKET_GAP_TOLERANCE,
  K_VALUES,
  RANK_PREDICTORS,
  RELIABILITY_EDGES,
  THIN_BUCKET_SLOTS,
  THIN_PRIOR_INSTANCES,
  TOP1_GAP_TOLERANCE,
  accumulateB0Rank,
  accumulateCalibration,
  accumulateMultiRecipient,
  accumulateRank,
  ageDeltaPp,
  ageFeatureTriple,
  ageVerdict,
  argmaxIndex,
  b0Exact,
  b0Survival,
  bestBaseline,
  brierSkill,
  bucketMeanPredicted,
  bucketObserved,
  buildAgeFeatures,
  buildAwardInstances,
  buildCandidatePools,
  buildFeatures,
  buildPriorHistory,
  calibrationBrier,
  calibrationFailures,
  calibrationUniformBrier,
  calibrationVerdict,
  cellAccuracy,
  cellAgeKnownFraction,
  cellMeanRank,
  cellMedianRank,
  cellMrr,
  cellNormalizedRank,
  cellRecallAt,
  compareTeamKeys,
  emptyCalibrationStats,
  emptyCell,
  emptyRankStats,
  fitConditionalLogit,
  isPredictable,
  isThinPrior,
  isTop1Hit,
  knownAgeFraction,
  knownRookieIndices,
  medianOf,
  mergeCalibration,
  modalAwardNames,
  NOISE_MARGIN_PP,
  FLAGSHIP_JUDGED_AWARD_TYPES,
  RANK_NOISE_BANDS,
  RANK_NOISE_BANDS_MEASURED,
  RANK_READING_METRICS,
  ROOKIE_AWARD_TYPES,
  bandGloss,
  isMetricComparable,
  compareOnBand,
  formatPracticalAnswer,
  formatReport,
  orderingWinner,
  rankMetricValue,
  rankReferencePredictor,
  observedTop1,
  orderByScores,
  orderMostDecorated,
  orderMostDecoratedRookie,
  orderStrongest,
  orderStrongestRookie,
  pickByWeights,
  pickMostDecorated,
  pickMostDecoratedRookie,
  pickStrongest,
  pickStrongestRookie,
  pooledCalibration,
  priorAnyCount,
  priorInstancesOfType,
  priorTypeCount,
  priorTypeLastYear,
  randomExpectedTop1,
  ranksFromOrder,
  reliabilityBucket,
  replayPreEventRatings,
  runExperiment,
  scoreByWeights,
  selectPriorInstances,
  softmax,
  statedTop1,
  teamAge,
  teamNumber,
  toJsonCell,
  toTrainInstance,
  verdictMarginPp,
  winnerRank,
  BERTH_AWARD_TYPES,
  DCMP_ALL,
  DCMP_DISTRICT_JOIN_SQL,
  DISTRICT_CUT_BASIS,
  MIN_JOINED_DCMP_EVENTS,
  NAIVE_DCMP_DISTRICT_JOIN_SQL,
  PREMISE_OUTSIDE_SHARE_MAX,
  PREMISE_OUTSIDE_SHARE_MIN,
  PREMISE_RECIPIENTS_EXPECTED,
  PREMISE_RECIPIENT_TOLERANCE,
  STRATA,
  STRATUM_ROWS,
  assignStratum,
  buildDistrictCuts,
  checkDcmpPremise,
  dcmpJoinTrapMessage,
  formatDcmpCensus,
  loadDistrictCuts,
  measureDcmpPremise,
  type AwardInstance,
  type DcmpDistrictJoinRow,
  type DcmpPremise,
  type DistrictCuts,
  type DistrictRankingRow,
  type AwardRowInput,
  type CalibrationStats,
  type Cell,
  type EventMetaInput,
  type ExperimentReport,
  type Predictor,
  type RankPredictor,
  type ReplayMatch,
  type ReplayModel,
} from "./measureAwardPredictability.js";

type SqliteDb = InstanceType<typeof Database>;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function inst(
  year: number,
  eventKey: string,
  awardType: number,
  recipients: readonly string[]
): AwardInstance {
  return { eventKey, year, awardType, name: `award ${awardType}`, recipients: [...recipients] };
}

function eventsMap(...rows: readonly EventMetaInput[]): Map<string, EventMetaInput> {
  const m = new Map<string, EventMetaInput>();
  for (const r of rows) m.set(r.eventKey, r);
  return m;
}

function match(eventKey: string, red: readonly string[], blue: readonly string[]): ReplayMatch {
  return {
    eventKey,
    year: 2020,
    compLevel: "qm",
    redTeams: [...red],
    blueTeams: [...blue],
    redOut: 50,
    blueOut: 40,
    redFoul: 0,
    blueFoul: 0,
    winner: "red",
  };
}

/** Records the exact call order so "snapshot before update" is asserted, not assumed. */
class RecordingModel implements ReplayModel<number> {
  readonly calls: string[] = [];
  readonly ratings = new Map<string, number>();

  predict(): number {
    this.calls.push("predict");
    return 0;
  }

  update(red: readonly string[], blue: readonly string[]): void {
    this.calls.push("update");
    for (const t of [...red, ...blue]) this.ratings.set(t, (this.ratings.get(t) ?? 0) + 1);
  }

  snapshot(): Map<string, number> {
    this.calls.push("snapshot");
    return new Map(this.ratings);
  }
}

// ---------------------------------------------------------------------------
// Instance construction and its census
// ---------------------------------------------------------------------------

describe("buildAwardInstances", () => {
  const events = eventsMap(
    { eventKey: "2019a", year: 2019, eventType: 0 },
    { eventKey: "2019b", year: 2019, eventType: 3 },
    { eventKey: "2019off", year: 2019, eventType: 99 },
    { eventKey: "2019pre", year: 2019, eventType: 100 }
  );

  function row(
    eventKey: string,
    awardType: number,
    teamKey: string | null,
    name = "Some Award"
  ): AwardRowInput {
    return { eventKey, awardType, teamKey, name, year: 2019 };
  }

  it("drops and counts offseason and preseason rows", () => {
    const { instances, census } = buildAwardInstances(
      [
        row("2019a", 0, "frc1"),
        row("2019off", 0, "frc2"),
        row("2019pre", 0, "frc3"),
      ],
      events
    );
    expect(census.rowsDroppedOffseasonPreseason).toBe(2);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.recipients).toEqual(["frc1"]);
  });

  it("drops and counts person-only recipients but keeps the team ones beside them", () => {
    const { instances, census } = buildAwardInstances(
      [row("2019a", 3, null, "Woodie Flowers"), row("2019a", 3, "frc9", "Woodie Flowers")],
      events
    );
    expect(census.rowsDroppedPersonOnly).toBe(1);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.recipients).toEqual(["frc9"]);
  });

  it("drops an instance whose every recipient was person-only, and counts it", () => {
    const { instances, census } = buildAwardInstances(
      [row("2019a", 45, null, "Volunteer"), row("2019a", 45, null, "Volunteer")],
      events
    );
    expect(census.rowsDroppedPersonOnly).toBe(2);
    expect(census.instancesDroppedNoTeamRecipient).toBe(1);
    expect(instances).toHaveLength(0);
  });

  it("merges two awards of the same type at one event into one (event, award_type) instance", () => {
    const { instances } = buildAwardInstances(
      [row("2019a", 13, "frc20"), row("2019a", 13, "frc4")],
      events
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]?.recipients).toEqual(["frc4", "frc20"]);
  });

  it("counts a row whose event is unknown rather than silently keeping it", () => {
    const { census } = buildAwardInstances([row("2019zzz", 0, "frc1")], events);
    expect(census.rowsDroppedUnknownEvent).toBe(1);
    expect(census.instancesBuilt).toBe(0);
  });
});

describe("team ordering", () => {
  it("sorts by team number, not lexicographically", () => {
    expect(["frc100", "frc9", "frc20"].sort(compareTeamKeys)).toEqual(["frc9", "frc20", "frc100"]);
  });

  it("sorts an unparseable key last without throwing", () => {
    expect(teamNumber("frcX")).toBe(Number.POSITIVE_INFINITY);
    expect(["frcX", "frc5"].sort(compareTeamKeys)).toEqual(["frc5", "frcX"]);
  });
});

describe("modalAwardNames", () => {
  it("picks the most common name seen for a type", () => {
    const names = modalAwardNames([
      { eventKey: "e1", awardType: 0, teamKey: "frc1", name: "Impact Award", year: 2024 },
      { eventKey: "e2", awardType: 0, teamKey: "frc2", name: "Impact Award", year: 2024 },
      { eventKey: "e3", awardType: 0, teamKey: "frc3", name: "Chairman's Award", year: 2018 },
    ]);
    expect(names.get(0)).toBe("Impact Award");
  });
});

// ---------------------------------------------------------------------------
// LEAK TEST 1 — the feature builder's input set
// ---------------------------------------------------------------------------

describe("walk-forward leak guard (feature builder)", () => {
  const instances = [
    inst(1999, "1999a", 7, ["frc1"]),
    inst(2000, "2000a", 7, ["frc1"]),
    inst(2000, "2000b", 7, ["frc1"]),
    inst(2001, "2001a", 7, ["frc1"]),
  ];

  it("selects zero input rows from the scored season or later", () => {
    const prior = selectPriorInstances(instances, 2000);
    expect(prior.every((i) => i.year < 2000)).toBe(true);
    expect(prior.map((i) => i.year)).toEqual([1999]);
  });

  it("counts only prior-season wins, on a fixture that would change if leaked", () => {
    const h = buildPriorHistory(instances, 2000);
    // Leaked, this would be 3 (1999 + both 2000 wins) and f1 would differ.
    expect(priorTypeCount(h, "frc1", 7)).toBe(1);
    expect(priorAnyCount(h, "frc1")).toBe(1);
    expect(priorTypeLastYear(h, "frc1", 7)).toBe(1999);
    expect(priorInstancesOfType(h, 7)).toBe(1);

    const leaked = buildPriorHistory(instances, 2002);
    expect(priorTypeCount(leaked, "frc1", 7)).toBe(4);

    const honest = buildFeatures(["frc1"], 7, 2000, h, new Map());
    const leakedFeatures = buildFeatures(["frc1"], 7, 2000, leaked, new Map());
    expect(honest[0]?.[0]).toBeCloseTo(Math.log1p(1), 12);
    expect(leakedFeatures[0]?.[0]).toBeCloseTo(Math.log1p(4), 12);
    expect(honest[0]?.[0]).not.toBeCloseTo(leakedFeatures[0]?.[0] ?? 0, 6);
  });

  it("reports a never-winner as zero history, not as a missing value", () => {
    const h = buildPriorHistory(instances, 2001);
    expect(priorTypeCount(h, "frc999", 7)).toBe(0);
    expect(priorTypeLastYear(h, "frc999", 7)).toBeNull();
    const f = buildFeatures(["frc999"], 7, 2001, h, new Map());
    expect(f[0]).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

describe("buildFeatures", () => {
  const h = buildPriorHistory(
    [inst(2018, "2018a", 5, ["frc1"]), inst(2019, "2019a", 9, ["frc1"])],
    2020
  );

  it("emits exactly four numbers per candidate", () => {
    const f = buildFeatures(["frc1", "frc2"], 5, 2020, h, new Map());
    expect(f).toHaveLength(2);
    expect(f[0]).toHaveLength(FEATURE_COUNT);
  });

  it("encodes recency as 1/(1 + seasons since the last win of this type)", () => {
    const f = buildFeatures(["frc1"], 5, 2020, h, new Map());
    expect(f[0]?.[1]).toBeCloseTo(1 / 3, 12); // 2020 - 2018 = 2 seasons
    expect(f[0]?.[2]).toBeCloseTo(Math.log1p(2), 12); // decorated twice overall
  });

  it("standardizes BPR within the event's own pool", () => {
    const ratings = new Map([
      ["frc1", 10],
      ["frc2", 20],
      ["frc3", 30],
    ]);
    const f = buildFeatures(["frc1", "frc2", "frc3"], 5, 2020, h, ratings);
    const zs = f.map((row) => row[3] ?? 0);
    expect(zs[1]).toBeCloseTo(0, 12);
    expect(zs[0]).toBeCloseTo(-zs[2]!, 12);
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(mean).toBeCloseTo(0, 12);
  });

  it("gives an unrated candidate the pool mean (z = 0) rather than inventing a rating", () => {
    const ratings = new Map([
      ["frc1", 10],
      ["frc3", 30],
    ]);
    const f = buildFeatures(["frc1", "frc2", "frc3"], 5, 2020, h, ratings);
    expect(f[1]?.[3]).toBe(0);
  });

  it("emits z = 0 for everyone when the pool has no spread at all", () => {
    const ratings = new Map([
      ["frc1", 7],
      ["frc2", 7],
    ]);
    const f = buildFeatures(["frc1", "frc2"], 5, 2020, h, ratings);
    expect(f.map((row) => row[3])).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Pre-event snapshot
// ---------------------------------------------------------------------------

describe("replayPreEventRatings", () => {
  it("snapshots an event BEFORE its first update, not after", () => {
    const model = new RecordingModel();
    const matches = [
      match("A", ["t1", "t2"], ["t3", "t4"]),
      match("A", ["t1", "t2"], ["t3", "t4"]),
      match("B", ["t1", "t5"], ["t6", "t7"]),
    ];
    const wanted = new Map<string, ReadonlySet<string>>([
      ["A", new Set(["t1", "t2"])],
      ["B", new Set(["t1", "t5"])],
    ]);
    const out = replayPreEventRatings(matches, model, wanted);

    // Event A's snapshot is taken before any update has happened at all, so
    // t1 has no rating yet — the pre-event property, asserted on values.
    expect([...(out.get("A") ?? new Map())]).toEqual([]);
    // Event B's snapshot sees exactly A's two updates and nothing of B's own.
    expect(out.get("B")?.get("t1")).toBe(2);
    expect(out.get("B")?.has("t5")).toBe(false);

    // And asserted on ordering, so a future refactor cannot move the snapshot.
    expect(model.calls).toEqual([
      "snapshot",
      "predict",
      "update",
      "predict",
      "update",
      "snapshot",
      "predict",
      "update",
    ]);
  });

  it("never snapshots an event nobody asked for", () => {
    const model = new RecordingModel();
    replayPreEventRatings([match("A", ["t1"], ["t2"])], model, new Map());
    expect(model.calls).toEqual(["predict", "update"]);
  });

  it("keeps only the wanted teams out of the snapshot", () => {
    const model = new RecordingModel();
    const matches = [match("A", ["t1"], ["t2"]), match("B", ["t1"], ["t2"])];
    const out = replayPreEventRatings(
      matches,
      model,
      new Map<string, ReadonlySet<string>>([["B", new Set(["t1"])]])
    );
    expect([...(out.get("B") ?? new Map())]).toEqual([["t1", 1]]);
  });
});

// ---------------------------------------------------------------------------
// Top-1 rule and baselines
// ---------------------------------------------------------------------------

describe("top-1 scoring rule", () => {
  const candidates = ["frc1", "frc2", "frc3", "frc4"];
  const recipients = new Set(["frc2", "frc3", "frc4"]);

  it("counts a hit when the single pick is ANY member of a multi-recipient set", () => {
    expect(isTop1Hit(candidates, 1, recipients)).toBe(true);
    expect(isTop1Hit(candidates, 3, recipients)).toBe(true);
  });

  it("counts a miss when the pick is outside the recipient set", () => {
    expect(isTop1Hit(candidates, 0, recipients)).toBe(false);
  });

  it("counts a miss, never a throw, when no pick could be made", () => {
    expect(isTop1Hit(candidates, -1, recipients)).toBe(false);
    expect(isTop1Hit(candidates, 99, recipients)).toBe(false);
  });

  it("breaks argmax ties toward the first candidate, deterministically", () => {
    expect(argmaxIndex([1, 3, 3, 2])).toBe(1);
    expect(argmaxIndex([])).toBe(-1);
  });
});

describe("baselines", () => {
  const candidates = ["frc1", "frc2", "frc3", "frc4"];
  // frc2 is the most decorated at type 7; frc3 is decorated overall but never
  // at type 7; frc4 is the strongest on the field and has no history at all.
  const history = buildPriorHistory(
    [
      inst(2018, "e1", 7, ["frc2"]),
      inst(2019, "e2", 7, ["frc2"]),
      inst(2019, "e3", 11, ["frc3"]),
      inst(2018, "e4", 11, ["frc3"]),
      inst(2018, "e5", 13, ["frc3"]),
      inst(2019, "e6", 7, ["frc1"]),
    ],
    2020
  );
  const ratings = new Map([
    ["frc1", 1],
    ["frc2", 2],
    ["frc3", 3],
    ["frc4", 99],
  ]);

  it("B0 is the share of the POOL that actually won", () => {
    expect(randomExpectedTop1(4, 1)).toBeCloseTo(0.25, 12);
    expect(randomExpectedTop1(40, 3)).toBeCloseTo(0.075, 12);
    expect(randomExpectedTop1(0, 0)).toBe(0);
  });

  it("B1 picks the most decorated at THIS award type", () => {
    expect(pickMostDecorated(candidates, 7, history)).toBe(1); // frc2, 2 prior type-7 wins
  });

  it("B1 falls back to overall decoration, then to the lowest team number", () => {
    // Nobody has won type 30, so the type-7 term is a flat zero for everyone
    // and the overall-decoration tiebreak decides: frc3 has three wins.
    expect(pickMostDecorated(candidates, 30, history)).toBe(2);
    // With no history at all, the lowest team number wins.
    const empty = buildPriorHistory([], 2020);
    expect(pickMostDecorated(["frc50", "frc7", "frc9"], 30, empty)).toBe(1);
  });

  it("B1 never consults BPR — a ratings reshuffle cannot move its pick", () => {
    const before = pickMostDecorated(candidates, 7, history);
    const reversed = new Map([
      ["frc1", 99],
      ["frc2", -99],
      ["frc3", 50],
      ["frc4", -1],
    ]);
    // Not merely "the same answer": the function has no parameter to pass
    // `reversed` to at all, which is the structural guarantee. Assert the
    // strongest team under the reshuffle is NOT what B1 returns.
    expect(pickStrongest(candidates, reversed)).toBe(0);
    expect(before).toBe(1);
    expect(pickMostDecorated(candidates, 7, history)).toBe(1);
  });

  it("B2 picks the strongest pre-event team and ranks an unrated team last", () => {
    expect(pickStrongest(candidates, ratings)).toBe(3); // frc4
    expect(pickStrongest(candidates, new Map([["frc3", 5]]))).toBe(2);
    // Everyone unrated: lowest team number, never -1.
    expect(pickStrongest(candidates, new Map())).toBe(0);
    expect(pickStrongest([], ratings)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

describe("fitConditionalLogit", () => {
  /** Winner is always the candidate with the largest f1; f2..f4 are noise-free zeros. */
  function easyTrain(count: number) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const features = [
        [0, 0, 0, 0],
        [1, 0, 0, 0],
        [2, 0, 0, 0],
      ];
      out.push(toTrainInstance(features, [2]));
    }
    return out;
  }

  it("learns a positive weight on the feature that actually separates winners", () => {
    const beta = fitConditionalLogit(easyTrain(50), { iterations: 300 });
    expect(beta[0]).toBeGreaterThan(0.5);
    expect(beta[1]).toBeCloseTo(0, 6);
    expect(beta[2]).toBeCloseTo(0, 6);
    expect(beta[3]).toBeCloseTo(0, 6);
  });

  it("is a pure function of its training set — same input, same weights", () => {
    expect(fitConditionalLogit(easyTrain(10))).toEqual(fitConditionalLogit(easyTrain(10)));
  });

  it("returns all-zero weights rather than throwing on an empty or degenerate set", () => {
    expect(fitConditionalLogit([])).toEqual([0, 0, 0, 0]);
    expect(fitConditionalLogit([toTrainInstance([[1, 0, 0, 0]], [0])])).toEqual([0, 0, 0, 0]);
    expect(
      fitConditionalLogit([
        toTrainInstance(
          [
            [1, 0, 0, 0],
            [2, 0, 0, 0],
          ],
          []
        ),
      ])
    ).toEqual([0, 0, 0, 0]);
  });

  it("weights a multi-recipient instance's recipients equally, not cumulatively", () => {
    const one = fitConditionalLogit(
      [
        toTrainInstance(
          [
            [0, 0, 0, 0],
            [1, 0, 0, 0],
            [1, 0, 0, 0],
          ],
          [1, 2]
        ),
      ],
      { iterations: 50 }
    );
    const halved = fitConditionalLogit(
      [
        toTrainInstance(
          [
            [0, 0, 0, 0],
            [1, 0, 0, 0],
            [1, 0, 0, 0],
          ],
          [1]
        ),
      ],
      { iterations: 50 }
    );
    // The two recipients are feature-identical, so averaging over them must
    // give exactly the single-recipient gradient — not twice it.
    expect(one[0]).toBeCloseTo(halved[0] ?? 0, 12);
  });

  it("ranks by x·beta with a first-wins tie-break", () => {
    expect(
      pickByWeights(
        [1, 0, 0, 0],
        [
          [0, 0, 0, 0],
          [5, 0, 0, 0],
          [3, 0, 0, 0],
        ]
      )
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Candidate pool
// ---------------------------------------------------------------------------

describe("buildCandidatePools", () => {
  it("unions the roster with every team that appears in the event's matches", () => {
    const pools = buildCandidatePools(
      ["A"],
      new Map([["A", ["frc1", "frc2"]]]),
      [match("A", ["frc2", "frc3"], ["frc4"])]
    );
    expect(pools.get("A")).toEqual(["frc1", "frc2", "frc3", "frc4"]);
  });

  it("yields an empty pool — not a missing key — for an event with neither", () => {
    const pools = buildCandidatePools(["A"], new Map(), []);
    expect(pools.get("A")).toEqual([]);
  });

  it("ignores matches at events nobody asked about", () => {
    const pools = buildCandidatePools(["A"], new Map(), [match("B", ["frc9"], ["frc8"])]);
    expect(pools.get("A")).toEqual([]);
    expect(pools.has("B")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LEAK TEST 2 — end-to-end through runExperiment
// ---------------------------------------------------------------------------

/** A tiny world: `count` events per season, pool of four, one recipient each. */
function syntheticWorld(seasons: readonly number[], perSeason: number, awardType: number) {
  const instances: AwardInstance[] = [];
  const poolsByEvent = new Map<string, string[]>();
  const ratingsByEvent = new Map<string, ReadonlyMap<string, number>>();
  for (const year of seasons) {
    for (let i = 0; i < perSeason; i += 1) {
      const eventKey = `${year}e${i}`;
      // frc1 is the serial winner; the pool is otherwise identical every time.
      instances.push(inst(year, eventKey, awardType, ["frc1"]));
      poolsByEvent.set(eventKey, ["frc1", "frc2", "frc3", "frc4"]);
      ratingsByEvent.set(
        eventKey,
        new Map([
          ["frc1", 1],
          ["frc2", 2],
          ["frc3", 3],
          ["frc4", 4],
        ])
      );
    }
  }
  return { instances, poolsByEvent, ratingsByEvent };
}

function emptyCensusFixture() {
  return {
    totalRows: 0,
    rowsDroppedOffseasonPreseason: 0,
    rowsDroppedUnknownEvent: 0,
    rowsDroppedPersonOnly: 0,
    instancesDroppedNoTeamRecipient: 0,
    instancesBuilt: 0,
  };
}

function run(
  world: ReturnType<typeof syntheticWorld>,
  fitIterations = 60,
  rookieYearByTeam?: ReadonlyMap<string, number>
) {
  return runExperiment({
    instances: world.instances,
    census: emptyCensusFixture(),
    poolsByEvent: world.poolsByEvent,
    ratingsByEvent: world.ratingsByEvent,
    awardNames: new Map(),
    ...(rookieYearByTeam === undefined ? {} : { rookieYearByTeam }),
    command: "test",
    fitIterations,
  });
}

describe("walk-forward leak guard (end to end)", () => {
  it("scores season Y identically whether or not seasons >= Y exist beyond it", () => {
    const short = syntheticWorld([2000, 2001], 40, 7);
    const long = syntheticWorld([2000, 2001, 2002, 2003], 40, 7);

    const a = run(short).byType[0]?.perSeason.get(2001);
    const b = run(long).byType[0]?.perSeason.get(2001);
    expect(a).toBeDefined();
    expect(a).toEqual(b);
  });

  it("never scores the first season, which has no prior to fit on", () => {
    const report = run(syntheticWorld([2000, 2001], 40, 7));
    expect(report.seasons).toEqual([2000, 2001]);
    expect(report.scoredSeasons).toEqual([2001]);
    expect(report.byType[0]?.perSeason.has(2000)).toBe(false);
  });

  it("drops and counts an instance with an empty candidate pool", () => {
    const world = syntheticWorld([2000, 2001], 2, 7);
    world.poolsByEvent.set("2001e0", []);
    const report = run(world);
    expect(report.instancesDroppedEmptyPool).toBe(1);
  });

  it("counts an instance whose recipient is outside the pool as unreachable, and as a miss", () => {
    const world = syntheticWorld([2000, 2001], 40, 7);
    world.instances.push(inst(2001, "2001e0x", 7, ["frc999"]));
    world.poolsByEvent.set("2001e0x", ["frc1", "frc2"]);
    world.ratingsByEvent.set("2001e0x", new Map());
    const cell = run(world).byType[0]?.perSeason.get(2001);
    expect(cell?.unreachable).toBe(1);
    // Unreachable rows stay IN the denominator: every predictor eats the same
    // penalty, so excluding them would flatter the accuracy.
    expect(cell?.n).toBe(41);
  });
});

// ---------------------------------------------------------------------------
// Thin-prior fallback
// ---------------------------------------------------------------------------

describe("thin-prior fallback", () => {
  it("fires strictly below the declared threshold", () => {
    expect(THIN_PRIOR_INSTANCES).toBe(30);
    expect(isThinPrior(29)).toBe(true);
    expect(isThinPrior(30)).toBe(false);
  });

  it("flags every row it produced and falls back to the decoration heuristic", () => {
    const world = syntheticWorld([2000, 2001], 5, 7); // 5 prior instances < 30
    const cell = run(world).byType[0]?.perSeason.get(2001);
    expect(cell?.n).toBe(5);
    expect(cell?.thinPriorRows).toBe(5);
    // The fallback IS B1, so by construction the two must agree exactly.
    expect(cell?.modelHits).toBe(cell?.b1Hits);
  });

  it("does not flag rows once the prior set reaches the threshold", () => {
    const world = syntheticWorld([2000, 2001], 30, 7); // 30 prior instances
    const cell = run(world).byType[0]?.perSeason.get(2001);
    expect(cell?.thinPriorRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The pre-committed verdict rule
// ---------------------------------------------------------------------------

describe("isPredictable", () => {
  // Spread over `emptyCell()` rather than spelled out field by field, so a
  // future column added to `Cell` cannot silently default to whatever a literal
  // happened to omit.
  const cell = (
    n: number,
    model: number,
    b1: number,
    b2: number,
    extra: Partial<Cell> = {}
  ): Cell => ({
    ...emptyCell(),
    n,
    poolSum: n * 40,
    recipSum: n,
    modelHits: model,
    ageModelHits: model,
    b1Hits: b1,
    b2Hits: b2,
    b0Expected: n / 40,
    ...extra,
  });

  it("requires beating BOTH baselines", () => {
    expect(isPredictable(cell(100, 50, 40, 30))).toBe(true);
    expect(isPredictable(cell(100, 50, 60, 30))).toBe(false);
    expect(isPredictable(cell(100, 50, 30, 60))).toBe(false);
  });

  it("treats a tie with a baseline as not demonstrated", () => {
    expect(isPredictable(cell(100, 50, 50, 30))).toBe(false);
  });

  it("refuses a thin sample no matter how good the number looks", () => {
    expect(isPredictable(cell(29, 29, 0, 0))).toBe(false);
  });

  it("reports the margin over the BEST baseline, so a 0.1pp win cannot pass as a result", () => {
    expect(verdictMarginPp(cell(1000, 501, 500, 300))).toBeCloseTo(0.1, 10);
    expect(verdictMarginPp(cell(1000, 501, 300, 500))).toBeCloseTo(0.1, 10);
    expect(verdictMarginPp(cell(1000, 400, 500, 300))).toBeCloseTo(-10, 10);
    expect(verdictMarginPp(cell(1000, 501, 500, 300))).toBeLessThan(NOISE_MARGIN_PP);
  });
});

describe("the rookie baselines are structurally pinned at zero", () => {
  // A pool of one rookie (no history, no rating) and two decorated, rated
  // veterans. This is the shape that makes type 10/14/15's 0.0% baselines
  // uninformative, so it is asserted rather than left as prose.
  const candidates = ["frc1", "frc2", "frc9999"];
  const history = buildPriorHistory(
    [inst(2018, "e1", 10, ["frc1"]), inst(2019, "e2", 10, ["frc2"])],
    2020
  );
  const ratings = new Map([
    ["frc1", 5],
    ["frc2", 8],
  ]);

  it("B1 can never pick the team with no prior wins", () => {
    expect(candidates[pickMostDecorated(candidates, 10, history)]).not.toBe("frc9999");
  });

  it("B2 can never pick the team with no rating", () => {
    expect(candidates[pickStrongest(candidates, ratings)]).not.toBe("frc9999");
  });

  it("but the rookie holds an all-zero feature vector no rated veteran can hold", () => {
    const f = buildFeatures(candidates, 10, 2020, history, ratings);
    expect(f[2]).toEqual([0, 0, 0, 0]);
    expect(f[0]).not.toEqual([0, 0, 0, 0]);
    expect(f[1]).not.toEqual([0, 0, 0, 0]);
    // Negative weights therefore single the rookie out — an age detector built
    // from the ABSENCE of the two selected features, not from a third one.
    expect(pickByWeights([-1, -1, -1, -1], f)).toBe(2);
  });

  // ---- and this is 7bp's fix: baselines that are NOT pinned there ---------

  it("RB1 and RB2 CAN pick the rookie the pinned baselines never could", () => {
    const rookieYears = new Map([["frc9999", 2020]]);
    expect(candidates[pickMostDecoratedRookie(candidates, 10, 2020, history, rookieYears)]).toBe(
      "frc9999"
    );
    expect(candidates[pickStrongestRookie(candidates, 2020, ratings, rookieYears)]).toBe("frc9999");
  });
});

// ---------------------------------------------------------------------------
// Feature family (c): team age — quick task 260912-7bp
// ---------------------------------------------------------------------------

describe("teamAge", () => {
  it("is relative to the EVENT'S season, not an absolute constant", () => {
    // One team, two events in different seasons, two different ages.
    expect(teamAge(2018, 2019)).toBe(1);
    expect(teamAge(2018, 2026)).toBe(8);
  });

  it("returns null — not 0 — for an unknown rookie year", () => {
    expect(teamAge(null, 2020)).toBeNull();
    expect(teamAge(undefined, 2020)).toBeNull();
    expect(teamAge(Number.NaN, 2020)).toBeNull();
  });

  it("clamps a negative raw age to 0 rather than emitting a negative or NaN log", () => {
    // A rookie year after the event's season is a data error, not a condition
    // the feature should propagate: log1p(-11) is NaN and would poison the fit.
    expect(teamAge(2031, 2020)).toBe(0);
    const triple = ageFeatureTriple(teamAge(2031, 2020));
    expect(triple[1]).toBe(0);
    expect(Number.isNaN(triple[1])).toBe(false);
    for (const v of triple) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("ageFeatureTriple", () => {
  it("keeps unknown, rookie and one-year-old mutually distinguishable", () => {
    expect(ageFeatureTriple(null)).toEqual([0, 0, 0]);
    expect(ageFeatureTriple(0)).toEqual([1, 0, 1]);
    const one = ageFeatureTriple(1);
    expect(one[0]).toBe(0);
    expect(one[1]).toBeCloseTo(Math.log(2), 12);
    expect(one[2]).toBe(1);
  });

  it("compresses veteran-ness so a 30-year veteran does not dominate a 5-year one 6x", () => {
    const five = ageFeatureTriple(5)[1];
    const thirty = ageFeatureTriple(30)[1];
    expect(thirty).toBeGreaterThan(five);
    expect(thirty / five).toBeLessThan(2);
  });
});

describe("buildAgeFeatures", () => {
  const history = buildPriorHistory([inst(2018, "e1", 5, ["frc1"])], 2020);

  it("emits exactly seven numbers whose first four ARE the no-age arm's", () => {
    const ratings = new Map([
      ["frc1", 10],
      ["frc2", 30],
    ]);
    const rookieYears = new Map([["frc2", 2020]]);
    const base = buildFeatures(["frc1", "frc2"], 5, 2020, history, ratings);
    const aged = buildAgeFeatures(["frc1", "frc2"], 5, 2020, history, ratings, rookieYears);
    expect(aged[0]).toHaveLength(AGE_FEATURE_COUNT);
    expect(AGE_FEATURE_COUNT).toBe(FEATURE_COUNT + 3);
    // Bit-identical shared prefix: the delta between the arms is only meaningful
    // if f1-f4 cannot drift between them.
    expect(aged[0]?.slice(0, FEATURE_COUNT)).toEqual(base[0]);
    expect(aged[1]?.slice(0, FEATURE_COUNT)).toEqual(base[1]);
    expect(aged[0]?.slice(FEATURE_COUNT)).toEqual([0, 0, 0]); // frc1: unknown age
    expect(aged[1]?.slice(FEATURE_COUNT)).toEqual([1, 0, 1]); // frc2: known rookie
  });

  it("computes age as of the event's season, so one team scores two ages", () => {
    const rookieYears = new Map([["frc1", 2018]]);
    const y2019 = buildAgeFeatures(["frc1"], 5, 2019, history, new Map(), rookieYears);
    const y2026 = buildAgeFeatures(["frc1"], 5, 2026, history, new Map(), rookieYears);
    expect(y2019[0]?.[5]).toBeCloseTo(Math.log1p(1), 12);
    expect(y2026[0]?.[5]).toBeCloseTo(Math.log1p(8), 12);
  });

  it("NEVER encodes an unknown rookie year as a rookie — on a fixture where that flips the pick", () => {
    // frc2's rookie year is unknown; frc1's is known and makes it a rookie.
    // The unknown team is FIRST, so under the wrong encoding the first-wins
    // argmax tie-break would hand it the pick.
    const candidates = ["frc2", "frc1"];
    const rookieYears = new Map([["frc1", 2020]]);
    const f = buildAgeFeatures(candidates, 5, 2020, history, new Map(), rookieYears);
    const isRookieColumn = f.map((row) => row[FEATURE_COUNT]);
    expect(isRookieColumn).toEqual([0, 1]);

    // A weight vector that cares only about f5 must pick the KNOWN rookie.
    const weights = [0, 0, 0, 0, 1, 0, 0];
    expect(candidates[pickByWeights(weights, f)]).toBe("frc1");

    // And the wrong encoding really would flip it: with the unknown team also
    // marked isRookie, the tie-break hands the pick to the wrong team.
    const wrong = f.map((row, i) => (i === 0 ? [...row.slice(0, FEATURE_COUNT), 1, 0, 1] : row));
    expect(candidates[pickByWeights(weights, wrong)]).toBe("frc2");
  });

  it("reports pool age coverage as a fraction, and 0 for an empty pool", () => {
    const rookieYears = new Map([["frc1", 2020]]);
    expect(knownAgeFraction(["frc1", "frc2", "frc3", "frc4"], rookieYears)).toBeCloseTo(0.25, 12);
    expect(knownAgeFraction([], rookieYears)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LEAK TEST 1b — the SEVEN-feature vector (quick task 260912-7bp)
// ---------------------------------------------------------------------------

describe("walk-forward leak guard (age arm)", () => {
  const instances = [
    inst(1999, "1999a", 7, ["frc1"]),
    inst(2000, "2000a", 7, ["frc1"]),
    inst(2000, "2000b", 7, ["frc1"]),
    inst(2001, "2001a", 7, ["frc1"]),
  ];
  const rookieYears = new Map([["frc1", 1997]]);

  it("still sees zero input rows from the scored season or later", () => {
    // The same assertion as the four-feature leak test, re-run over the
    // SEVEN-feature builder: adding a legal static feature must not be allowed
    // to quietly widen what the history is built from.
    const prior = selectPriorInstances(instances, 2000);
    expect(prior.every((i) => i.year < 2000)).toBe(true);

    const honest = buildAgeFeatures(["frc1"], 7, 2000, buildPriorHistory(instances, 2000), new Map(), rookieYears);
    const leaked = buildAgeFeatures(["frc1"], 7, 2000, buildPriorHistory(instances, 2002), new Map(), rookieYears);
    expect(honest[0]).toHaveLength(AGE_FEATURE_COUNT);
    expect(honest[0]?.[0]).toBeCloseTo(Math.log1p(1), 12);
    expect(leaked[0]?.[0]).toBeCloseTo(Math.log1p(4), 12);
    expect(honest[0]?.[0]).not.toBeCloseTo(leaked[0]?.[0] ?? 0, 6);
  });

  it("treats rookie_year as a static fact: the age columns are untouched by the leak boundary", () => {
    // `rookie_year` is known before any event the team ever plays, so it carries
    // no look-ahead and must read identically on both sides of the boundary.
    // That is WHY the feature is legal — asserted, not assumed.
    const honest = buildAgeFeatures(["frc1"], 7, 2000, buildPriorHistory(instances, 2000), new Map(), rookieYears);
    const leaked = buildAgeFeatures(["frc1"], 7, 2000, buildPriorHistory(instances, 2002), new Map(), rookieYears);
    expect(honest[0]?.slice(FEATURE_COUNT)).toEqual(leaked[0]?.slice(FEATURE_COUNT));
  });
});

// ---------------------------------------------------------------------------
// The rookie-aware baselines — the load-bearing half of 260912-7bp
// ---------------------------------------------------------------------------

describe("rookie baselines RB1 / RB2", () => {
  // frc1 and frc2 are decorated, rated veterans. frc7 and frc5 are known
  // rookies; frc5 already played an earlier event this season so it carries a
  // rating, frc7 does not. frc8's rookie year is UNKNOWN.
  const candidates = ["frc1", "frc2", "frc5", "frc7", "frc8"];
  const history = buildPriorHistory(
    [inst(2018, "e1", 10, ["frc1"]), inst(2019, "e2", 10, ["frc2"])],
    2020
  );
  const ratings = new Map([
    ["frc1", 5],
    ["frc2", 8],
    ["frc5", 1],
  ]);
  const rookieYears = new Map([
    ["frc1", 2001],
    ["frc2", 2004],
    ["frc5", 2020],
    ["frc7", 2020],
  ]);

  it("considers only KNOWN-age-0 candidates, never an unknown-age one", () => {
    expect(knownRookieIndices(candidates, 2020, rookieYears)).toEqual([2, 3]);
    // frc8 has no rookie year at all and must never be treated as a rookie.
    expect(knownRookieIndices(["frc8"], 2020, rookieYears)).toEqual([]);
  });

  it("RB1 picks a rookie, never the decorated veteran B1 would take", () => {
    expect(candidates[pickMostDecorated(candidates, 10, history)]).toBe("frc1");
    // No rookie has any prior wins, so RB1 falls to the lowest team number.
    expect(candidates[pickMostDecoratedRookie(candidates, 10, 2020, history, rookieYears)]).toBe(
      "frc5"
    );
  });

  it("RB2 picks the strongest rookie, which is not always RB1's pick", () => {
    // frc5 has a rating; frc7 does not and therefore ranks last.
    expect(candidates[pickStrongestRookie(candidates, 2020, ratings, rookieYears)]).toBe("frc5");
    const flipped = new Map([...ratings, ["frc7", 99]]);
    expect(candidates[pickStrongestRookie(candidates, 2020, flipped, rookieYears)]).toBe("frc7");
  });

  it("RB1 never consults BPR — a ratings reshuffle cannot move its pick", () => {
    // Structural, exactly as for B1: `pickMostDecoratedRookie` has no parameter
    // to pass a rating to, so it cannot silently become a two-feature model.
    const reshuffled = new Map([
      ["frc5", -99],
      ["frc7", 99],
    ]);
    expect(candidates[pickStrongestRookie(candidates, 2020, reshuffled, rookieYears)]).toBe("frc7");
    expect(candidates[pickMostDecoratedRookie(candidates, 10, 2020, history, rookieYears)]).toBe(
      "frc5"
    );
  });

  it("both ABSTAIN on a rookie-free pool rather than picking a veteran", () => {
    const veterans = ["frc1", "frc2"];
    expect(pickMostDecoratedRookie(veterans, 10, 2020, history, rookieYears)).toBe(ABSTAIN);
    expect(pickStrongestRookie(veterans, 2020, ratings, rookieYears)).toBe(ABSTAIN);
    // An abstention scores as a miss, never as a throw and never as a hit.
    expect(isTop1Hit(veterans, ABSTAIN, new Set(["frc1"]))).toBe(false);
  });

  it("abstains when every candidate's age is UNKNOWN, rather than guessing", () => {
    expect(pickMostDecoratedRookie(["frc8"], 10, 2020, history, new Map())).toBe(ABSTAIN);
    expect(pickStrongestRookie(["frc8"], 2020, ratings, new Map())).toBe(ABSTAIN);
  });

  it("ages the pool as of the EVENT'S season — yesterday's rookie is not today's", () => {
    // frc5/frc7 are rookies in 2020 and veterans in 2021.
    expect(knownRookieIndices(candidates, 2021, rookieYears)).toEqual([]);
    expect(pickMostDecoratedRookie(candidates, 10, 2021, history, rookieYears)).toBe(ABSTAIN);
  });
});

// ---------------------------------------------------------------------------
// Both arms in one pass, and the widened verdict rule
// ---------------------------------------------------------------------------

describe("the two arms", () => {
  const world = () => syntheticWorld([2000, 2001], 40, 7);
  // frc1 is the serial winner AND a 2001 rookie in this fixture.
  const rookieYears = new Map([["frc1", 2001]]);

  it("leaves the no-age arm's numbers untouched by the presence of the age arm", () => {
    const without = run(world()).byType[0]?.perSeason.get(2001);
    const with_ = run(world(), 60, rookieYears).byType[0]?.perSeason.get(2001);
    expect(without?.modelHits).toBe(with_?.modelHits);
    expect(without?.b1Hits).toBe(with_?.b1Hits);
    expect(without?.b2Hits).toBe(with_?.b2Hits);
    expect(without?.n).toBe(with_?.n);
  });

  it("scores both arms over the identical instance set, so the delta is a feature effect", () => {
    const cell = run(world(), 60, rookieYears).byType[0]?.perSeason.get(2001);
    expect(cell?.n).toBe(40);
    expect(cell?.ageModelHits).toBeGreaterThanOrEqual(0);
    expect(cell?.ageModelHits).toBeLessThanOrEqual(cell?.n ?? 0);
    expect(ageDeltaPp(cell ?? emptyCell())).toBeCloseTo(
      100 * (((cell?.ageModelHits ?? 0) - (cell?.modelHits ?? 0)) / (cell?.n ?? 1)),
      12
    );
  });

  it("collapses the age arm onto the no-age arm when no rookie year is known at all", () => {
    // f5 = f6 = f7 = 0 for every candidate: the seven-feature fit has three
    // dead columns and must reproduce the four-feature answer exactly.
    const cell = run(world()).byType[0]?.perSeason.get(2001);
    expect(cell?.ageModelHits).toBe(cell?.modelHits);
    expect(cellAgeKnownFraction(cell ?? emptyCell())).toBe(0);
  });

  it("counts rookie-baseline abstentions instead of silently scoring them as misses", () => {
    const blind = run(world()).byType[0]?.perSeason.get(2001);
    expect(blind?.rb1Abstentions).toBe(40);
    expect(blind?.rb2Abstentions).toBe(40);
    expect(blind?.rb1Hits).toBe(0);
    expect(blind?.rb2Hits).toBe(0);

    const sighted = run(world(), 60, rookieYears).byType[0]?.perSeason.get(2001);
    expect(sighted?.rb1Abstentions).toBe(0);
    expect(sighted?.rb2Abstentions).toBe(0);
    // frc1 is the only known rookie AND the winner, so both rookie baselines
    // score 100% — the structural 0.0% is gone.
    expect(sighted?.rb1Hits).toBe(40);
    expect(sighted?.rb2Hits).toBe(40);
    expect(cellAgeKnownFraction(sighted ?? emptyCell())).toBeCloseTo(0.25, 12);
  });

  it("records mean pool age coverage so a weak rookie baseline reads as a DATA fact", () => {
    const pooled = run(world(), 60, rookieYears).byType[0]?.pooled;
    expect(cellAgeKnownFraction(pooled ?? emptyCell())).toBeCloseTo(0.25, 12);
  });
});

describe("the widened verdict rule (max of B1, B2, RB1, RB2)", () => {
  const base = (over: Partial<Cell>): Cell => ({ ...emptyCell(), n: 100, ...over });

  it("takes the best of ALL FOUR baselines as the bar", () => {
    expect(bestBaseline(base({ b1Hits: 10, b2Hits: 20, rb1Hits: 55, rb2Hits: 30 }))).toBeCloseTo(
      0.55,
      12
    );
  });

  it("refuses a model that beats B1 and B2 but LOSES to RB1", () => {
    // This is the exact shape of the rookie-award artifact 7bp exists to kill:
    // under 5n8's "beats B1 and B2" rule this cell was PREDICTABLE.
    const c = base({ modelHits: 40, ageModelHits: 45, b1Hits: 0, b2Hits: 0, rb1Hits: 60 });
    expect(cellAccuracy(c, "model")).toBeGreaterThan(cellAccuracy(c, "b1"));
    expect(cellAccuracy(c, "model")).toBeGreaterThan(cellAccuracy(c, "b2"));
    expect(isPredictable(c, "model")).toBe(false);
    expect(isPredictable(c, "ageModel")).toBe(false);
    expect(verdictMarginPp(c, "model")).toBeCloseTo(-20, 10);
    expect(verdictMarginPp(c, "ageModel")).toBeCloseTo(-15, 10);
  });

  it("applies the same rule to both arms, so one can pass while the other fails", () => {
    const c = base({ modelHits: 40, ageModelHits: 60, b1Hits: 0, b2Hits: 0, rb1Hits: 50 });
    expect(isPredictable(c, "model")).toBe(false);
    expect(isPredictable(c, "ageModel")).toBe(true);
  });

  it("still refuses a thin sample no matter which arm or baseline is involved", () => {
    expect(isPredictable(base({ n: 29, modelHits: 29 }), "model")).toBe(false);
    expect(isPredictable(base({ n: 29, ageModelHits: 29 }), "ageModel")).toBe(false);
  });
});

describe("the pre-committed age-delta rule", () => {
  const c = (model: number, age: number): Cell => ({
    ...emptyCell(),
    n: 1000,
    modelHits: model,
    ageModelHits: age,
  });

  it("calls a sub-1.0pp improvement NO CHANGE, not a win", () => {
    expect(ageDeltaPp(c(500, 509))).toBeCloseTo(0.9, 10);
    expect(ageVerdict(c(500, 509))).toBe("no change");
    expect(NOISE_MARGIN_PP).toBe(1);
  });

  it("calls a >= 1.0pp improvement HELPS", () => {
    expect(ageVerdict(c(500, 510))).toBe("helps");
    expect(ageDeltaPp(c(500, 510))).toBeCloseTo(1, 10);
  });

  it("calls a >= 1.0pp regression HURTS, and a small one NO CHANGE", () => {
    expect(ageVerdict(c(500, 490))).toBe("hurts");
    expect(ageVerdict(c(500, 495))).toBe("no change");
  });

  it("treats an exactly-zero delta as no change", () => {
    expect(ageVerdict(c(500, 500))).toBe("no change");
    expect(ageDeltaPp(c(500, 500))).toBe(0);
  });
});

describe("fitConditionalLogit width handling", () => {
  it("fits a seven-wide training set without reading the four-wide constant", () => {
    const train = [];
    for (let i = 0; i < 30; i += 1) {
      train.push(
        toTrainInstance(
          [
            [0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 1],
          ],
          [1]
        )
      );
    }
    const beta = fitConditionalLogit(train, { iterations: 200 });
    expect(beta).toHaveLength(AGE_FEATURE_COUNT);
    expect(beta[4]).toBeGreaterThan(0.2);
  });

  it("THROWS rather than quietly fitting a training set of mixed widths", () => {
    expect(() =>
      fitConditionalLogit([
        toTrainInstance(
          [
            [0, 0, 0, 0],
            [1, 0, 0, 0],
          ],
          [1]
        ),
        toTrainInstance(
          [
            [0, 0, 0, 0, 0, 0, 0],
            [1, 0, 0, 0, 0, 0, 0],
          ],
          [1]
        ),
      ])
    ).toThrow(/mixed feature widths/);
  });

  it("carries the row width on the instance rather than assuming one", () => {
    expect(toTrainInstance([[1, 2, 3, 4]], [0]).featureCount).toBe(FEATURE_COUNT);
    expect(toTrainInstance([[1, 2, 3, 4, 5, 6, 7]], [0]).featureCount).toBe(AGE_FEATURE_COUNT);
    // No rows at all: falls back to the no-age width rather than 0.
    expect(toTrainInstance([], []).featureCount).toBe(FEATURE_COUNT);
  });
});

// ===========================================================================
// QUICK TASK 260912-i13 — the ranking that was being discarded
// ===========================================================================

// ---------------------------------------------------------------------------
// Every pick is the HEAD of an ordering — the structural claim, asserted
// ---------------------------------------------------------------------------

describe("orderings derive the picks, rather than sitting beside them", () => {
  const hist = (wins: readonly AwardInstance[]) => buildPriorHistory(wins, 3000);

  it("rank 1 under the model ordering IS what pickByWeights returns", () => {
    const weights = [1, 0, 0, 0];
    const features = [[0.5], [2.0], [1.25], [-3]].map((r) => [r[0] ?? 0, 0, 0, 0]);
    const order = orderByScores(scoreByWeights(weights, features));
    const ranks = ranksFromOrder(order);
    const pick = pickByWeights(weights, features);
    expect(pick).toBe(1);
    expect(ranks.get(pick)).toBe(1);
    for (let i = 0; i < features.length; i += 1) {
      expect(ranks.get(i) === 1).toBe(pick === i);
    }
  });

  it("breaks an EXACT utility tie the same way argmax does — toward the first candidate", () => {
    // Identical rows: `argmaxIndex` keeps the first, so the ordering must too,
    // or R@1 would stop reproducing the accuracy column on every tied instance.
    const weights = [1, 1, 1, 1];
    const features = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ];
    const u = scoreByWeights(weights, features);
    expect(u).toEqual([1, 1, 1]);
    expect(orderByScores(u)).toEqual([0, 1, 2]);
    expect(ranksFromOrder(orderByScores(u)).get(pickByWeights(weights, features))).toBe(1);
  });

  it("scoreByWeights is the loop pickByWeights used to own, over the full pool", () => {
    const weights = [2, -1];
    const features = [
      [1, 0],
      [0, 1],
      [3, 3],
    ];
    expect(scoreByWeights(weights, features)).toEqual([2, -1, 3]);
    expect(scoreByWeights(weights, features)).toHaveLength(features.length);
    expect(pickByWeights(weights, features)).toBe(argmaxIndex(scoreByWeights(weights, features)));
  });

  it("B1's pick is exactly its ordering's head at every tie-break level", () => {
    const history = hist([
      inst(1000, "a", 7, ["frc50"]),
      inst(1001, "a", 7, ["frc50"]),
      inst(1002, "b", 9, ["frc60"]),
      inst(1003, "c", 9, ["frc70"]),
    ]);
    // level 1: prior wins of THIS type
    const byType = ["frc70", "frc50", "frc60"];
    expect(orderMostDecorated(byType, 7, history)[0]).toBe(1);
    expect(pickMostDecorated(byType, 7, history)).toBe(orderMostDecorated(byType, 7, history)[0]);
    // level 2: prior wins of ANY type (nobody has won type 21)
    const byAny = ["frc70", "frc50", "frc99"];
    expect(orderMostDecorated(byAny, 21, history)).toEqual([1, 0, 2]);
    expect(pickMostDecorated(byAny, 21, history)).toBe(1);
    // level 3: ascending team number among the equally undecorated
    const byNumber = ["frc300", "frc9", "frc80"];
    expect(orderMostDecorated(byNumber, 21, history)).toEqual([1, 2, 0]);
    expect(pickMostDecorated(byNumber, 21, history)).toBe(1);
  });

  it("separates two UNPARSEABLE team keys by candidate index, so the order is total", () => {
    // `teamNumber` returns +Infinity for both, so without the index key these
    // two would tie and their relative order would be a sort implementation
    // detail rather than a defined one.
    const history = hist([]);
    const pool = ["not-a-key", "also-not-a-key"];
    expect(teamNumber(pool[0] ?? "")).toBe(Number.POSITIVE_INFINITY);
    expect(teamNumber(pool[1] ?? "")).toBe(Number.POSITIVE_INFINITY);
    expect(orderMostDecorated(pool, 7, history)).toEqual([0, 1]);
    expect(pickMostDecorated(pool, 7, history)).toBe(0);
    expect(orderStrongest(pool, new Map())).toEqual([0, 1]);
    expect(pickStrongest(pool, new Map())).toBe(0);
  });

  it("B2's pick is its ordering's head, and an unrated team ranks LAST, not average", () => {
    const pool = ["frc1", "frc2", "frc3"];
    const ratings = new Map([
      ["frc1", 5],
      ["frc3", 9],
    ]);
    expect(orderStrongest(pool, ratings)).toEqual([2, 0, 1]);
    expect(pickStrongest(pool, ratings)).toBe(2);
    // Two unrated candidates compare EQUAL (both -Infinity) and fall through to
    // team number rather than producing NaN from a subtraction.
    expect(orderStrongest(["frc9", "frc4"], new Map())).toEqual([1, 0]);
  });

  it("B1's ordering NEVER consults BPR — a ratings reshuffle cannot move any position", () => {
    const history = hist([inst(1000, "a", 7, ["frc50"])]);
    const pool = ["frc10", "frc50", "frc90"];
    const before = orderMostDecorated(pool, 7, history);
    // The signature takes no ratings argument at all; this asserts the same
    // guarantee behaviourally, so it cannot be lost to a future refactor.
    const after = orderMostDecorated(pool, 7, buildPriorHistory([inst(1000, "a", 7, ["frc50"])], 3000));
    expect(after).toEqual(before);
    expect(before).toEqual([1, 0, 2]);
  });

  it("the RB orderings hold ONLY known rookies, and are block-length not pool-length", () => {
    const history = hist([]);
    const pool = ["frc1", "frc2", "frc3", "frc4"];
    // frc2 and frc4 are known rookies; frc1 is a known veteran; frc3 is unknown.
    const rookieYears = new Map([
      ["frc1", 1990],
      ["frc2", 2001],
      ["frc4", 2001],
    ]);
    const block = knownRookieIndices(pool, 2001, rookieYears);
    expect(block).toEqual([1, 3]);

    const rb1 = orderMostDecoratedRookie(pool, 7, 2001, history, rookieYears);
    const rb2 = orderStrongestRookie(pool, 2001, new Map([["frc4", 10]]), rookieYears);
    expect(rb1).toHaveLength(block.length);
    expect(rb2).toHaveLength(block.length);
    expect([...rb1].sort((a, b) => a - b)).toEqual(block);
    expect([...rb2].sort((a, b) => a - b)).toEqual(block);
    expect(rb1).not.toContain(0);
    expect(rb2).not.toContain(2);
    expect(pickMostDecoratedRookie(pool, 7, 2001, history, rookieYears)).toBe(rb1[0]);
    expect(pickStrongestRookie(pool, 2001, new Map([["frc4", 10]]), rookieYears)).toBe(rb2[0]);
    // frc4 is the only rated rookie, so RB2 takes it over the lower team number.
    expect(rb2[0]).toBe(3);
  });

  it("an empty rookie block is an EMPTY ordering and the existing abstention", () => {
    const history = hist([]);
    const pool = ["frc1", "frc2"];
    expect(orderMostDecoratedRookie(pool, 7, 2001, history, new Map())).toEqual([]);
    expect(orderStrongestRookie(pool, 2001, new Map(), new Map())).toEqual([]);
    expect(pickMostDecoratedRookie(pool, 7, 2001, history, new Map())).toBe(ABSTAIN);
    expect(pickStrongestRookie(pool, 2001, new Map(), new Map())).toBe(ABSTAIN);
  });

  it("an empty pool yields an empty ordering and the existing -1, not a throw", () => {
    expect(orderMostDecorated([], 7, hist([]))).toEqual([]);
    expect(pickMostDecorated([], 7, hist([]))).toBe(-1);
    expect(orderStrongest([], new Map())).toEqual([]);
    expect(pickStrongest([], new Map())).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Winner rank, including the multi-recipient rule
// ---------------------------------------------------------------------------

describe("winnerRank", () => {
  const pool = ["frcA", "frcB", "frcC", "frcD"];

  it("is the 1-based position of the recipient in the ordering", () => {
    expect(winnerRank([2, 0, 3, 1], pool, new Set(["frcD"]))).toBe(3);
    expect(winnerRank([2, 0, 3, 1], pool, new Set(["frcC"]))).toBe(1);
  });

  it("takes the BEST (minimum) rank over a multi-recipient set, not the first listed", () => {
    // frcB ranks 4th and frcD ranks 3rd: the winner rank is 3, the minimum.
    expect(winnerRank([2, 0, 3, 1], pool, new Set(["frcB", "frcD"]))).toBe(3);
    // Order of the recipient set must not matter.
    expect(winnerRank([2, 0, 3, 1], pool, new Set(["frcD", "frcB"]))).toBe(3);
  });

  it("is null — not 0 and not a fabricated tail rank — when no recipient is ranked", () => {
    expect(winnerRank([2, 0, 3, 1], pool, new Set(["frcZ"]))).toBeNull();
    expect(winnerRank([], pool, new Set(["frcA"]))).toBeNull();
  });

  it("only ranks recipients the ordering actually contains (the RB block case)", () => {
    // A rookie-block ordering of [1, 3]: frcA is a recipient but is not ranked.
    expect(winnerRank([1, 3], pool, new Set(["frcA"]))).toBeNull();
    expect(winnerRank([1, 3], pool, new Set(["frcA", "frcD"]))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B0 — proved against brute force, not trusted from the algebra
// ---------------------------------------------------------------------------

/** Enumerates every C(N, r) placement and measures the minimum rank directly. */
function bruteForceB0(N: number, r: number) {
  const combos: number[][] = [];
  const walk = (start: number, acc: number[]): void => {
    if (acc.length === r) {
      combos.push([...acc]);
      return;
    }
    for (let i = start; i < N; i += 1) {
      acc.push(i);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  const minRanks = combos.map((c) => Math.min(...c) + 1);
  const total = minRanks.length;
  const survival = (m: number): number => minRanks.filter((x) => x > m).length / total;
  let medianRank = N;
  for (let m = 1; m <= N; m += 1) {
    if (survival(m) <= 0.5) {
      medianRank = m;
      break;
    }
  }
  return {
    total,
    survival,
    recallAt: K_VALUES.map((k) => minRanks.filter((m) => m <= k).length / total),
    reciprocalRank: minRanks.reduce((s, m) => s + 1 / m, 0) / total,
    meanRank: minRanks.reduce((s, m) => s + m, 0) / total,
    medianRank,
  };
}

describe("B0, the exact random null ordering", () => {
  const cases: readonly (readonly [number, number])[] = [
    [6, 2],
    [6, 1],
    [6, 3],
    [5, 4],
    [12, 3],
  ];

  it("matches a brute-force enumeration of every placement on recall@k, MRR, mean and median", () => {
    for (const [N, r] of cases) {
      const brute = bruteForceB0(N, r);
      const exact = b0Exact(N, r);
      for (let ki = 0; ki < K_VALUES.length; ki += 1) {
        expect(exact.recallAt[ki] ?? -1).toBeCloseTo(brute.recallAt[ki] ?? -2, 10);
      }
      expect(exact.reciprocalRank).toBeCloseTo(brute.reciprocalRank, 10);
      expect(exact.meanRank).toBeCloseTo(brute.meanRank, 10);
      expect(exact.medianRank).toBe(brute.medianRank);
      expect(exact.normalizedRank).toBeCloseTo(brute.meanRank / N, 10);
      expect(exact.defined).toBe(true);
    }
  });

  it("has the survival function the closed form claims, at every cutoff", () => {
    for (const [N, r] of cases) {
      const brute = bruteForceB0(N, r);
      for (let m = 0; m <= N; m += 1) {
        expect(b0Survival(N, r, m)).toBeCloseTo(brute.survival(m), 10);
      }
    }
  });

  it("uses the (N+1)/(r+1) expectation rather than an approximation", () => {
    expect(b0Exact(40, 1).meanRank).toBeCloseTo(20.5, 12);
    expect(b0Exact(40, 4).meanRank).toBeCloseTo(8.2, 12);
  });

  it("is UNDEFINED, not zero-ranked, when no recipient is in the pool", () => {
    const e = b0Exact(40, 0);
    expect(e.defined).toBe(false);
    expect(e.recallAt).toEqual(K_VALUES.map(() => 0));
    expect(e.reciprocalRank).toBe(0);
    // And it therefore contributes NOTHING to rankDefined.
    const stats = emptyRankStats();
    accumulateB0Rank(stats, 40, 0);
    expect(stats.rankDefined).toBe(0);
    expect(stats.recallAt).toEqual(K_VALUES.map(() => 0));
  });

  it("saturates at 100% recall once k reaches the pool size", () => {
    const e = b0Exact(4, 1);
    // K_VALUES = [1, 3, 5, 10]: k = 5 and k = 10 both exceed a 4-team pool.
    expect(e.recallAt[0] ?? 0).toBeCloseTo(0.25, 12);
    expect(e.recallAt[2] ?? 0).toBe(1);
    expect(e.recallAt[3] ?? 0).toBe(1);
  });

  it("is deterministic: no RNG, no seed, no run-to-run drift", () => {
    expect(b0Exact(37, 2)).toEqual(b0Exact(37, 2));
  });
});

// ---------------------------------------------------------------------------
// The two denominators
// ---------------------------------------------------------------------------

describe("accumulateRank and the two-denominator rule", () => {
  it("keeps an unranked instance in the recall/MRR denominator and out of rankDefined", () => {
    const s = emptyRankStats();
    accumulateRank(s, 2, 40); // ranked 2nd of 40
    accumulateRank(s, null, 40); // unreachable
    accumulateRank(s, 1, 0); // abstained: an empty ordering
    expect(s.rankDefined).toBe(1);
    expect(s.ranks).toEqual([2]);
    expect(s.rankSum).toBe(2);
    expect(s.reciprocalRankSum).toBeCloseTo(0.5, 12);
    // recall counts stay at 1 hit: the two unranked instances scored 0, they
    // did not vanish.
    expect(s.recallAt).toEqual([0, 1, 1, 1]);
    // n = 3 is the recall denominator; rankDefined = 1 is the rank denominator.
    expect(s.recallAt[1] ?? 0).toBe(1);
    expect(s.rankSum / s.rankDefined).toBe(2);
  });

  it("counts a rank at exactly k as inside k, at every cutoff", () => {
    for (const k of K_VALUES) {
      const s = emptyRankStats();
      accumulateRank(s, k, 40);
      const ki = K_VALUES.indexOf(k);
      expect(s.recallAt[ki] ?? 0).toBe(1);
      if (ki > 0) expect(s.recallAt[ki - 1] ?? 0).toBe(0);
    }
  });

  it("normalizes by the ordering's OWN length, which is the rookie block for RB", () => {
    const s = emptyRankStats();
    accumulateRank(s, 2, 4); // 2nd of a 4-team rookie block
    expect(s.normalizedRankSum).toBeCloseTo(0.5, 12);
  });
});

describe("medianOf", () => {
  it("is exact, not interpolated, on an odd sample", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });
  it("averages the two middles on an even sample", () => {
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
  });
  it("is 0 on an empty sample rather than NaN", () => {
    expect(medianOf([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE K=1 CONTROL — the load-bearing test of the whole task
// ---------------------------------------------------------------------------

/**
 * A world built to exercise every predictor at once: four different winners so
 * no predictor is degenerate, an unrated candidate, a known rookie in one
 * season but not the next (so RB1/RB2 both score AND abstain inside one pooled
 * cell), and one instance whose recipient is outside the pool.
 */
function mixedWorld() {
  const instances: AwardInstance[] = [];
  const poolsByEvent = new Map<string, string[]>();
  const ratingsByEvent = new Map<string, ReadonlyMap<string, number>>();
  const pool = ["frc2", "frc3", "frc7", "frc11", "frc19"];
  // frc19 is the rookie AND wins a quarter of the time, so RB1/RB2 have
  // genuinely defined ranks rather than only abstentions.
  const winners = ["frc7", "frc2", "frc11", "frc19"];
  for (const year of [2000, 2001, 2002]) {
    for (let i = 0; i < 40; i += 1) {
      const eventKey = `${year}e${i}`;
      instances.push(inst(year, eventKey, 7, [winners[i % winners.length] ?? "frc7"]));
      poolsByEvent.set(eventKey, [...pool]);
      ratingsByEvent.set(
        eventKey,
        new Map([
          ["frc2", 5],
          ["frc3", 4],
          ["frc7", 3],
          ["frc11", 2],
          // frc19 is deliberately UNRATED.
        ])
      );
    }
  }
  // One unreachable instance: the recipient is not in the pool at all.
  instances.push(inst(2002, "2002unreach", 7, ["frc999"]));
  poolsByEvent.set("2002unreach", [...pool]);
  ratingsByEvent.set("2002unreach", new Map([["frc2", 5]]));
  return { instances, poolsByEvent, ratingsByEvent };
}

/** frc19 is a 2001 rookie: a known rookie in 2001, a 1-year-old in 2002. */
const MIXED_ROOKIE_YEARS = new Map([
  ["frc2", 1995],
  ["frc3", 1996],
  ["frc7", 1997],
  ["frc11", 1998],
  ["frc19", 2001],
]);

describe("THE K=1 CONTROL — recall@1 reproduces top-1 for all six predictors", () => {
  const report = run(mixedWorld(), 120, MIXED_ROOKIE_YEARS);
  const pooled = report.byType[0]?.pooled;

  it("built a fixture that actually exercises every predictor", () => {
    expect(pooled).toBeDefined();
    const c = pooled as Cell;
    expect(c.n).toBe(81); // 40 in 2001 + 40 + 1 unreachable in 2002
    expect(c.unreachable).toBe(1);
    expect(c.modelHits).toBeGreaterThan(0);
    expect(c.b1Hits).toBeGreaterThan(0);
    expect(c.b2Hits).toBeGreaterThan(0);
    // RB1/RB2 find frc19 in 2001 and abstain in 2002 — both halves inside one cell.
    expect(c.rb1Abstentions).toBeGreaterThan(0);
    expect(c.rb1Abstentions).toBeLessThan(c.n);
    expect(c.rb2Abstentions).toBe(c.rb1Abstentions);
  });

  it("recallAt[0] EQUALS the hit count, for every predictor", () => {
    const c = pooled as Cell;
    const hits: Record<Predictor, number> = {
      model: c.modelHits,
      ageModel: c.ageModelHits,
      b1: c.b1Hits,
      b2: c.b2Hits,
      rb1: c.rb1Hits,
      rb2: c.rb2Hits,
    };
    for (const which of RANK_PREDICTORS) {
      if (which === "b0") continue;
      expect([which, c.rank[which].recallAt[0]]).toEqual([which, hits[which]]);
      expect(cellRecallAt(c, which, 0)).toBeCloseTo(cellAccuracy(c, which), 12);
    }
  });

  it("holds per season as well as pooled, so no season can cancel another out", () => {
    for (const season of [2001, 2002]) {
      const c = report.byType[0]?.perSeason.get(season);
      expect(c).toBeDefined();
      const cell = c as Cell;
      expect(cell.rank.model.recallAt[0]).toBe(cell.modelHits);
      expect(cell.rank.ageModel.recallAt[0]).toBe(cell.ageModelHits);
      expect(cell.rank.b1.recallAt[0]).toBe(cell.b1Hits);
      expect(cell.rank.b2.recallAt[0]).toBe(cell.b2Hits);
      expect(cell.rank.rb1.recallAt[0]).toBe(cell.rb1Hits);
      expect(cell.rank.rb2.recallAt[0]).toBe(cell.rb2Hits);
    }
  });

  it("scores the unreachable instance 0 at EVERY k while keeping it in the denominator", () => {
    const c = pooled as Cell;
    // Pool size 5, so k = 5 and k = 10 cover the whole pool: every REACHABLE
    // instance must be a hit there, and only the unreachable one is missing.
    expect(c.rank.model.recallAt[2]).toBe(c.n - c.unreachable);
    expect(c.rank.model.recallAt[3]).toBe(c.n - c.unreachable);
    expect(c.rank.b1.recallAt[3]).toBe(c.n - c.unreachable);
    expect(cellRecallAt(c, "model", 3)).toBeCloseTo((c.n - c.unreachable) / c.n, 12);
  });

  it("excludes the unreachable instance from rankDefined and counts it", () => {
    const c = pooled as Cell;
    for (const which of ["model", "ageModel", "b1", "b2", "b0"] as const) {
      expect([which, c.rank[which].rankDefined]).toEqual([which, c.n - c.unreachable]);
    }
    // RB's rankDefined is smaller again: it loses every abstained instance AND
    // every instance whose rookie block held no recipient. Both are real
    // exclusions, and both are counted rather than averaged into a rank.
    expect(c.rank.rb1.rankDefined).toBeGreaterThan(0);
    expect(c.rank.rb1.rankDefined).toBeLessThanOrEqual(
      c.n - c.unreachable - c.rb1Abstentions
    );
  });

  it("the mean/median/normalized columns use rankDefined, never n", () => {
    const c = pooled as Cell;
    const s = c.rank.model;
    expect(cellMeanRank(c, "model")).toBeCloseTo(s.rankSum / s.rankDefined, 12);
    expect(cellNormalizedRank(c, "model")).toBeCloseTo(s.normalizedRankSum / s.rankDefined, 12);
    expect(cellMedianRank(c, "model")).toBe(medianOf(s.ranks));
    expect(s.ranks).toHaveLength(s.rankDefined);
    // MRR, by contrast, divides by n.
    expect(cellMrr(c, "model")).toBeCloseTo(s.reciprocalRankSum / c.n, 12);
  });

  it("normalizes RB by the ROOKIE BLOCK, which is a different denominator", () => {
    const c = pooled as Cell;
    // The block is exactly one team (frc19) wherever it is non-empty, so every
    // defined RB rank is 1 of 1 — a normalized 100%, which is emphatically NOT
    // comparable to the model's 1-of-5 scale. That is why it prints in its own
    // column with the denominator named.
    expect(cellNormalizedRank(c, "rb1")).toBeCloseTo(1, 12);
    expect(cellMeanRank(c, "rb1")).toBeCloseTo(1, 12);
  });

  it("counts the small-pool instances so R@10 cannot be read as a result", () => {
    const c = pooled as Cell;
    expect(c.smallPoolInstances).toBe(c.n); // every pool here is 5 teams
  });
});

// ---------------------------------------------------------------------------
// The JSON emitter
// ---------------------------------------------------------------------------

describe("toJsonCell", () => {
  it("replaces the raw ranks array with its median and count", () => {
    const c = run(mixedWorld(), 60, MIXED_ROOKIE_YEARS).byType[0]?.pooled as Cell;
    const json = toJsonCell(c);
    const model = (json["rank"] as Record<string, Record<string, unknown>>)["model"];
    expect(model).toBeDefined();
    expect(model?.["ranks"]).toBeUndefined();
    expect(model?.["medianRank"]).toBe(medianOf(c.rank.model.ranks));
    expect(model?.["rankCount"]).toBe(c.rank.model.ranks.length);
    // Every accumulator the printer reads survives the reshaping.
    expect(model?.["rankDefined"]).toBe(c.rank.model.rankDefined);
    expect(model?.["recallAt"]).toEqual(c.rank.model.recallAt);
    expect(JSON.stringify(json)).not.toContain("\"ranks\"");
  });

  it("emits all seven predictors, B0 included", () => {
    const json = toJsonCell(emptyCell());
    expect(Object.keys(json["rank"] as object).sort()).toEqual([...RANK_PREDICTORS].sort());
  });
});

// ---------------------------------------------------------------------------
// LEAK TEST 3 — the rank metrics are walk-forward too
// ---------------------------------------------------------------------------

describe("walk-forward leak guard (rank metrics)", () => {
  it("scores season Y's RANK metrics identically whether or not later seasons exist", () => {
    const short = syntheticWorld([2000, 2001], 40, 7);
    const long = syntheticWorld([2000, 2001, 2002, 2003], 40, 7);
    const a = run(short).byType[0]?.perSeason.get(2001);
    const b = run(long).byType[0]?.perSeason.get(2001);
    expect(a?.rank).toBeDefined();
    // Named explicitly rather than relying on the whole-cell toEqual above, so
    // a future refactor that drops `rank` from the cell cannot silently drop
    // this guard with it.
    for (const which of RANK_PREDICTORS) {
      expect([which, a?.rank[which]]).toEqual([which, b?.rank[which]]);
    }
  });

  it("catches a leak on a fixture where leaking WOULD move the rank metrics", () => {
    // A pool whose ordering is driven by prior-win counts: leaking the scored
    // season's own wins changes who is ranked first, so the metrics move.
    const instances = [
      inst(1999, "1999a", 7, ["frc1"]),
      inst(2000, "2000a", 7, ["frc2"]),
      inst(2000, "2000b", 7, ["frc2"]),
      inst(2000, "2000c", 7, ["frc2"]),
    ];
    const pool = ["frc1", "frc2", "frc3"];
    const honest = buildPriorHistory(instances, 2000);
    const leaked = buildPriorHistory(instances, 2001);
    const honestOrder = orderMostDecorated(pool, 7, honest);
    const leakedOrder = orderMostDecorated(pool, 7, leaked);
    expect(honestOrder[0]).toBe(0); // frc1: the only prior winner as of 2000
    expect(leakedOrder[0]).toBe(1); // frc2: only if 2000's own wins leak in
    expect(winnerRank(honestOrder, pool, new Set(["frc2"]))).toBe(2);
    expect(winnerRank(leakedOrder, pool, new Set(["frc2"]))).toBe(1);
  });

  it("derives the model ORDERING from the leak-bounded features, not a wider history", () => {
    const instances = [
      inst(1999, "1999a", 7, ["frc1"]),
      inst(2000, "2000a", 7, ["frc1"]),
      inst(2000, "2000b", 7, ["frc1"]),
      inst(2001, "2001a", 7, ["frc1"]),
    ];
    const pool = ["frc1", "frc2"];
    const weights = [1, 0, 0, 0];
    const honest = scoreByWeights(weights, buildFeatures(pool, 7, 2000, buildPriorHistory(instances, 2000), new Map()));
    const leaked = scoreByWeights(weights, buildFeatures(pool, 7, 2000, buildPriorHistory(instances, 2002), new Map()));
    expect(honest[0] ?? 0).toBeCloseTo(Math.log1p(1), 12);
    expect(leaked[0] ?? 0).toBeCloseTo(Math.log1p(4), 12);
    expect(orderByScores(honest)).toEqual([0, 1]);
    // Same ordering, different utilities — the point is that the ORDERING is a
    // pure function of the leak-bounded feature matrix and of nothing else.
    expect(honest[0]).not.toBe(leaked[0]);
  });

  it("still scores the rank metrics over the SEVEN-feature vector without widening history", () => {
    const rookieYears = new Map([["frc1", 1997]]);
    const short = syntheticWorld([2000, 2001], 40, 7);
    const long = syntheticWorld([2000, 2001, 2002], 40, 7);
    const a = run(short, 60, rookieYears).byType[0]?.perSeason.get(2001);
    const b = run(long, 60, rookieYears).byType[0]?.perSeason.get(2001);
    expect(a?.rank.ageModel).toEqual(b?.rank.ageModel);
    expect(a?.rank.rb1).toEqual(b?.rank.rb1);
  });

  it("scores season Y's CALIBRATION identically whether or not later seasons exist", () => {
    const short = syntheticWorld([2000, 2001], 40, 7);
    const long = syntheticWorld([2000, 2001, 2002, 2003], 40, 7);
    const a = run(short).byType[0]?.perSeason.get(2001);
    const b = run(long).byType[0]?.perSeason.get(2001);
    expect(a?.calibration).toBeDefined();
    expect(a?.calibration.model).toEqual(b?.calibration.model);
    expect(a?.calibration.ageModel).toEqual(b?.calibration.ageModel);
  });
});

// ===========================================================================
// QUICK TASK 260912-i13 T2 — are the stated probabilities honest?
// ===========================================================================

describe("softmax", () => {
  it("sums to 1 across the pool", () => {
    const p = softmax([1, -2, 0.5, 3]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(p.every((x) => x > 0)).toBe(true);
  });

  it("is INVARIANT to adding a constant to every utility — the stabiliser is correct", () => {
    // Not merely "a max subtraction is present": the numbers it produces must
    // be the ones the unshifted maths implies.
    const base = [1, -2, 0.5, 3];
    const shifted = base.map((u) => u + 1000);
    const a = softmax(base);
    const b = softmax(shifted);
    for (let i = 0; i < a.length; i += 1) expect(a[i] ?? 0).toBeCloseTo(b[i] ?? -1, 12);
    // And it does not overflow where a naive exp() would.
    expect(softmax([800, 800]).every((x) => Number.isFinite(x))).toBe(true);
    expect(softmax([800, 800])).toEqual([0.5, 0.5]);
  });

  it("preserves the ranking it came from", () => {
    const u = [1, -2, 0.5, 3];
    expect(orderByScores(softmax(u))).toEqual(orderByScores(u));
  });

  it("is uniform on an all-equal utility vector, and empty on an empty pool", () => {
    expect(softmax([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(softmax([])).toEqual([]);
  });
});

describe("reliability buckets", () => {
  it("is closed below and open above at EVERY edge, with the top closed at 1.0", () => {
    for (let i = 0; i < RELIABILITY_EDGES.length - 1; i += 1) {
      const edge = RELIABILITY_EDGES[i] ?? 0;
      expect([edge, reliabilityBucket(edge)]).toEqual([edge, i]);
    }
    // Open above: a hair under an edge belongs to the bucket BELOW it.
    expect(reliabilityBucket(0.05 - 1e-12)).toBe(2);
    expect(reliabilityBucket(0.5 - 1e-12)).toBe(6);
    // The top bucket is closed at 1.0 rather than dropping a certainty.
    expect(reliabilityBucket(1)).toBe(RELIABILITY_EDGES.length - 2);
    expect(reliabilityBucket(0.999)).toBe(RELIABILITY_EDGES.length - 2);
  });

  it("drops nothing and double-counts nothing", () => {
    const s = emptyCalibrationStats();
    const probs = [...RELIABILITY_EDGES, 0.0005, 0.34999, 0.7];
    accumulateCalibration(s, probs, new Set([0]), 0);
    expect(s.buckets.reduce((a, b) => a + b.slots, 0)).toBe(probs.length);
    expect(s.slots).toBe(probs.length);
  });
});

describe("the calibration scorer", () => {
  it("matches a hand-computed Brier", () => {
    const s = emptyCalibrationStats();
    accumulateCalibration(s, [0.5, 0.3, 0.2], new Set([0]), 0);
    // (0.5-1)^2 + (0.3-0)^2 + (0.2-0)^2 = 0.25 + 0.09 + 0.04 = 0.38
    expect(s.brierSum).toBeCloseTo(0.38, 12);
    expect(s.slots).toBe(3);
    expect(calibrationBrier(s)).toBeCloseTo(0.38 / 3, 12);
  });

  it("computes BS_uniform as the analytic (N-1)/N^2 on a single-recipient instance", () => {
    // (1 - 1/N)^2/N + (N-1)/N^3 collapses to (N-1)/N^2 — asserted directly on
    // the accumulator rather than restated as a comment.
    for (const N of [2, 3, 5, 40]) {
      const s = emptyCalibrationStats();
      accumulateCalibration(s, new Array<number>(N).fill(1 / N), new Set([0]), 0);
      expect(calibrationUniformBrier(s)).toBeCloseTo((N - 1) / N ** 2, 15);
    }
    // The number the report's "uninterpretable alone" warning refers to.
    expect(39 / 40 ** 2).toBeCloseTo(0.024375, 12);
  });

  it("scores skill EXACTLY 0 when the model IS uniform", () => {
    const s = emptyCalibrationStats();
    accumulateCalibration(s, [1 / 3, 1 / 3, 1 / 3], new Set([1]), 1);
    expect(calibrationBrier(s)).toBe(calibrationUniformBrier(s));
    expect(brierSkill(s)).toBe(0);
  });

  it("scores positive skill for a model that concentrates mass on the winner", () => {
    const s = emptyCalibrationStats();
    accumulateCalibration(s, [0.9, 0.05, 0.05], new Set([0]), 0);
    expect(brierSkill(s)).toBeGreaterThan(0);
    const bad = emptyCalibrationStats();
    accumulateCalibration(bad, [0.05, 0.05, 0.9], new Set([0]), 0);
    expect(brierSkill(bad)).toBeLessThan(0);
  });

  it("records the top pick's STATED probability next to its OBSERVED outcome", () => {
    const s = emptyCalibrationStats();
    accumulateCalibration(s, [0.6, 0.4], new Set([0]), 0); // stated 0.6, hit
    accumulateCalibration(s, [0.6, 0.4], new Set([1]), 0); // stated 0.6, miss
    expect(s.topInstances).toBe(2);
    expect(statedTop1(s)).toBeCloseTo(0.6, 12);
    expect(observedTop1(s)).toBeCloseTo(0.5, 12);
  });

  it("counts a multi-recipient instance separately and folds it into NO headline number", () => {
    const s = emptyCalibrationStats();
    accumulateMultiRecipient(s, [0.5, 0.3, 0.2], new Set([0, 1]));
    expect(s.excludedMultiRecipient).toBe(1);
    expect(s.instances).toBe(0);
    expect(s.slots).toBe(0);
    expect(s.brierSum).toBe(0);
    expect(s.buckets.every((b) => b.slots === 0)).toBe(true);
    // But it IS summarised, so the excluded set is visible rather than hidden.
    expect(s.multiSlots).toBe(3);
    expect(s.multiPredictedSum).toBeCloseTo(1, 12);
    expect(s.multiObservedSum).toBe(2);
  });

  it("merges cleanly across award types, buckets included", () => {
    const a = emptyCalibrationStats();
    const b = emptyCalibrationStats();
    accumulateCalibration(a, [0.6, 0.4], new Set([0]), 0);
    accumulateCalibration(b, [0.6, 0.4], new Set([1]), 0);
    const both = emptyCalibrationStats();
    mergeCalibration(both, a);
    mergeCalibration(both, b);
    expect(both.instances).toBe(2);
    expect(both.slots).toBe(4);
    expect(both.brierSum).toBeCloseTo(a.brierSum + b.brierSum, 12);
    expect(both.buckets.reduce((x, y) => x + y.slots, 0)).toBe(4);
    expect(observedTop1(both)).toBeCloseTo(0.5, 12);
  });
});

describe("the PRE-COMMITTED usable/needs-recalibration rule", () => {
  /** A stats object that passes all three clauses, to perturb one at a time. */
  const passing = (over: Partial<CalibrationStats> = {}): CalibrationStats => ({
    ...emptyCalibrationStats(),
    instances: 100,
    slots: 1000,
    brierSum: 50,
    uniformBrierSum: 100, // skill = 1 - 0.05/0.1 = +0.5
    topInstances: 100,
    topPredictedSum: 30,
    topHits: 28, // stated 30.0% vs observed 28.0% — a 2pp gap
    ...over,
  });

  it("says USABLE only when all three clauses hold", () => {
    const s = passing();
    expect(brierSkill(s)).toBeCloseTo(0.5, 12);
    expect(calibrationFailures(s)).toEqual([]);
    expect(calibrationVerdict(s)).toBe("PROBABILITIES USABLE AS STATED");
  });

  it("fires on clause 1: a non-positive Brier skill score", () => {
    expect(calibrationVerdict(passing({ brierSum: 100 }))).toBe(
      "PROBABILITIES NEED RECALIBRATION"
    );
    expect(calibrationVerdict(passing({ brierSum: 150 }))).toBe(
      "PROBABILITIES NEED RECALIBRATION"
    );
    expect(calibrationFailures(passing({ brierSum: 150 }))[0]).toMatch(/skill score/);
    // Exactly zero skill is NOT positive, so it fails rather than squeaking by.
    expect(brierSkill(passing({ brierSum: 100 }))).toBe(0);
  });

  it("fires on clause 2: a top-1 stated-vs-observed gap outside +/-5pp", () => {
    // 30.0% stated vs 20.0% observed — the "says 31%, actually 22%" failure.
    const over = passing({ topHits: 20 });
    expect(calibrationVerdict(over)).toBe("PROBABILITIES NEED RECALIBRATION");
    expect(calibrationFailures(over).some((f) => f.includes("top-1"))).toBe(true);
    // And it is symmetric: UNDER-confidence fails the same way.
    expect(calibrationVerdict(passing({ topHits: 40 }))).toBe(
      "PROBABILITIES NEED RECALIBRATION"
    );
    // A gap exactly at the tolerance passes; a hair beyond it does not.
    expect(100 * TOP1_GAP_TOLERANCE).toBe(5);
    expect(calibrationVerdict(passing({ topHits: 25 }))).toBe(
      "PROBABILITIES USABLE AS STATED"
    );
    expect(calibrationVerdict(passing({ topPredictedSum: 30.1, topHits: 25 }))).toBe(
      "PROBABILITIES NEED RECALIBRATION"
    );
  });

  it("fires on clause 3: a NON-THIN bucket off by more than 10pp", () => {
    const withBucket = (slots: number): CalibrationStats => {
      const s = passing();
      const b = s.buckets[5];
      if (b !== undefined) {
        b.slots = slots;
        b.predictedSum = slots * 0.3;
        b.observed = slots * 0.1; // a 20pp gap
      }
      return s;
    };
    const fat = withBucket(THIN_BUCKET_SLOTS + 10);
    expect(bucketMeanPredicted(fat.buckets[5] as never)).toBeCloseTo(0.3, 12);
    expect(bucketObserved(fat.buckets[5] as never)).toBeCloseTo(0.1, 12);
    expect(calibrationVerdict(fat)).toBe("PROBABILITIES NEED RECALIBRATION");
    expect(calibrationFailures(fat).some((f) => f.includes("bucket"))).toBe(true);

    // The SAME gap on a thin bucket draws no conclusion at all — that is the
    // whole reason the THIN flag exists rather than being a footnote.
    const thin = withBucket(THIN_BUCKET_SLOTS - 1);
    expect(calibrationVerdict(thin)).toBe("PROBABILITIES USABLE AS STATED");
    // And a non-thin bucket inside the tolerance passes.
    expect(100 * BUCKET_GAP_TOLERANCE).toBe(10);
  });

  it("refuses to call an EMPTY measurement usable", () => {
    const s = emptyCalibrationStats();
    expect(calibrationVerdict(s)).toBe("PROBABILITIES NEED RECALIBRATION");
    expect(calibrationFailures(s)[0]).toMatch(/nothing was measured/);
  });
});

// ---------------------------------------------------------------------------
// The two exclusions, end to end through runExperiment
// ---------------------------------------------------------------------------

describe("calibration exclusions, end to end", () => {
  it("a THIN-PRIOR row contributes to no accumulator and is counted", () => {
    // 5 prior instances < 30: neither arm is fit, the B1 heuristic stands in,
    // and a heuristic emits NO probability.
    const cell = run(syntheticWorld([2000, 2001], 5, 7)).byType[0]?.perSeason.get(2001);
    expect(cell?.thinPriorRows).toBe(5);
    for (const arm of ["model", "ageModel"] as const) {
      const s = cell?.calibration[arm];
      expect([arm, s?.excludedThinPrior]).toEqual([arm, 5]);
      expect([arm, s?.instances]).toEqual([arm, 0]);
      expect([arm, s?.slots]).toEqual([arm, 0]);
      expect([arm, s?.brierSum]).toEqual([arm, 0]);
      expect([arm, s?.topInstances]).toEqual([arm, 0]);
      expect([arm, s?.buckets.every((b) => b.slots === 0)]).toEqual([arm, true]);
    }
    // No fabricated probability was assigned in its place.
    expect(cell?.calibration.model.multiSlots).toBe(0);
  });

  it("a MULTI-RECIPIENT instance is excluded from the headline table and counted", () => {
    const world = syntheticWorld([2000, 2001], 40, 7);
    for (let i = 0; i < 20; i += 1) {
      const at = world.instances.findIndex((x) => x.eventKey === `2001e${i}`);
      world.instances[at] = inst(2001, `2001e${i}`, 7, ["frc1", "frc2"]);
    }
    const cell = run(world).byType[0]?.perSeason.get(2001);
    expect(cell?.n).toBe(40);
    const s = cell?.calibration.model as CalibrationStats;
    expect(s.excludedMultiRecipient).toBe(20);
    expect(s.instances).toBe(20); // the single-recipient half only
    expect(s.slots).toBe(20 * 4); // pool of four
    expect(s.multiSlots).toBe(20 * 4);
    // Two winners against a total mass of 1: the excluded set's observed rate
    // is DOUBLE its predicted, which is exactly the fake under-confidence the
    // exclusion exists to keep out of the headline.
    expect(s.multiObservedSum).toBe(40);
    expect(s.multiPredictedSum).toBeCloseTo(20, 10);
    // Every included instance is single-recipient, so slots/instances = pool.
    expect(s.slots / s.instances).toBe(4);
  });

  it("an UNREACHABLE instance is retained on purpose — not a third exclusion", () => {
    const c = run(mixedWorld(), 120, MIXED_ROOKIE_YEARS).byType[0]?.pooled as Cell;
    expect(c.unreachable).toBe(1);
    const s = c.calibration.model;
    // n minus the thin-prior rows, with nothing further removed: the model
    // really did put a mass of 1 on a pool with no winner in it, and that is
    // genuine overconfidence rather than an encoding artifact.
    expect(s.instances).toBe(c.n - s.excludedThinPrior - s.excludedMultiRecipient);
    expect(s.excludedMultiRecipient).toBe(0);
  });

  it("pools calibration across judged award types, buckets and all", () => {
    const report = run(mixedWorld(), 120, MIXED_ROOKIE_YEARS);
    const pooled = pooledCalibration(report.byType, "model");
    const single = report.byType[0]?.pooled.calibration.model as CalibrationStats;
    expect(report.byType).toHaveLength(1);
    expect(pooled.instances).toBe(single.instances);
    expect(pooled.slots).toBe(single.slots);
    expect(pooled.brierSum).toBeCloseTo(single.brierSum, 12);
    expect(pooled.buckets.reduce((a, b) => a + b.slots, 0)).toBe(pooled.slots);
  });

  it("keeps both arms on the identical included set, so the age delta stays a feature effect", () => {
    const c = run(mixedWorld(), 120, MIXED_ROOKIE_YEARS).byType[0]?.pooled as Cell;
    expect(c.calibration.ageModel.instances).toBe(c.calibration.model.instances);
    expect(c.calibration.ageModel.slots).toBe(c.calibration.model.slots);
    expect(c.calibration.ageModel.excludedThinPrior).toBe(c.calibration.model.excludedThinPrior);
    expect(c.calibration.ageModel.excludedMultiRecipient).toBe(
      c.calibration.model.excludedMultiRecipient
    );
  });
});

// ---------------------------------------------------------------------------
// THE MEASURED PER-METRIC NOISE BANDS, AND THE PRACTICAL ANSWER
// (quick task 260912-i13 T3)
// ---------------------------------------------------------------------------

/** Fills one predictor's `RankStats` from the metrics the report actually prints. */
function setRank(
  c: Cell,
  which: RankPredictor,
  opts: {
    r1: number;
    r3: number;
    r5?: number;
    r10?: number;
    mrr?: number;
    norm?: number;
    ranks?: number[];
  }
): void {
  const s = c.rank[which];
  s.rankDefined = c.n;
  s.recallAt = [
    opts.r1 * c.n,
    opts.r3 * c.n,
    (opts.r5 ?? opts.r3) * c.n,
    (opts.r10 ?? opts.r3) * c.n,
  ];
  s.reciprocalRankSum = (opts.mrr ?? opts.r1) * c.n;
  s.rankSum = 5 * c.n;
  s.normalizedRankSum = (opts.norm ?? 0.15) * c.n;
  s.ranks = opts.ranks ?? [4];
}

/** A calibration cell built from the two facts the PRACTICAL ANSWER quotes. */
function setCalibration(
  c: Cell,
  arm: "model" | "ageModel",
  opts: { stated: number; observed: number; instances: number; skillPositive?: boolean }
): void {
  const s = c.calibration[arm];
  s.instances = opts.instances;
  s.topInstances = opts.instances;
  s.topPredictedSum = opts.stated * opts.instances;
  s.topHits = opts.observed * opts.instances;
  s.slots = 40 * opts.instances;
  s.uniformBrierSum = 0.025 * s.slots;
  // Skill = 1 − BS/BS_uniform, so a smaller Brier is a positive skill.
  s.brierSum = (opts.skillPositive === false ? 0.03 : 0.02) * s.slots;
}

function flagshipCell(opts: {
  n: number;
  pool: number;
  modelR3: number;
  b1R3: number;
  stated: number;
  observed: number;
  norm?: number;
  ranks?: number[];
}): Cell {
  const c = emptyCell();
  c.n = opts.n;
  c.poolSum = opts.pool * opts.n;
  c.recipSum = opts.n;
  setRank(c, "model", {
    r1: opts.modelR3 / 2,
    r3: opts.modelR3,
    r10: Math.min(1, opts.modelR3 * 1.7),
    norm: opts.norm ?? 0.16,
    ranks: opts.ranks ?? [4],
  });
  setRank(c, "ageModel", { r1: opts.modelR3 / 2, r3: opts.modelR3, norm: opts.norm ?? 0.16 });
  setRank(c, "b1", {
    r1: opts.b1R3 / 2,
    r3: opts.b1R3,
    r10: Math.min(1, opts.b1R3 * 1.7),
    norm: 0.14,
    ranks: [3],
  });
  setRank(c, "b2", { r1: 0.05, r3: 0.15, norm: 0.3 });
  setRank(c, "b0", { r1: 1 / opts.pool, r3: 3 / opts.pool, r10: 10 / opts.pool, norm: 0.5, ranks: [20] });
  setCalibration(c, "model", { stated: opts.stated, observed: opts.observed, instances: opts.n });
  setCalibration(c, "ageModel", { stated: opts.stated, observed: opts.observed, instances: opts.n });
  return c;
}

function flagshipReport(byType: readonly { awardType: number; name: string; pooled: Cell }[]): ExperimentReport {
  return {
    command: "test",
    census: {
      totalRows: 0,
      rowsDroppedOffseasonPreseason: 0,
      rowsDroppedUnknownEvent: 0,
      rowsDroppedPersonOnly: 0,
      instancesDroppedNoTeamRecipient: 0,
      instancesBuilt: 0,
    },
    instancesDroppedEmptyPool: 0,
    seasons: [2019, 2020],
    scoredSeasons: [2020],
    byType: byType.map((r) => ({ ...r, perSeason: new Map<number, Cell>() })),
    fitIterations: 200,
    rookieYearsKnown: 10,
  };
}

describe("the measured per-metric noise bands", () => {
  it("carries exactly the four bands that were measured 2026-09-12, in their own units", () => {
    expect(RANK_NOISE_BANDS["R@1"].band).toBe(0.77);
    expect(RANK_NOISE_BANDS["R@1"].unit).toBe("pp");
    expect(RANK_NOISE_BANDS["R@3"].band).toBe(1.5);
    expect(RANK_NOISE_BANDS["R@3"].unit).toBe("pp");
    expect(RANK_NOISE_BANDS.MRR.band).toBe(0.0046);
    expect(RANK_NOISE_BANDS.MRR.unit).toBe("abs");
    expect(RANK_NOISE_BANDS["norm%"].band).toBe(0.17);
    expect(RANK_NOISE_BANDS["norm%"].unit).toBe("pp");
    expect(RANK_NOISE_BANDS_MEASURED).toBe("2026-09-12");
  });

  it("holds null for every metric that was NOT measured, rather than inheriting a band", () => {
    // Inventing a band for these would be the same fabrication the thin-prior
    // exclusion refuses elsewhere in this script.
    for (const metric of ["R@5", "R@10", "meanRank", "medRank", "brierSkill"] as const) {
      expect(RANK_NOISE_BANDS[metric].band).toBeNull();
    }
  });

  it("orients the three lower-is-better metrics and nothing else", () => {
    for (const metric of ["meanRank", "medRank", "norm%"] as const) {
      expect(RANK_NOISE_BANDS[metric].higherIsBetter).toBe(false);
    }
    for (const metric of ["R@1", "R@3", "R@5", "R@10", "MRR", "brierSkill"] as const) {
      expect(RANK_NOISE_BANDS[metric].higherIsBetter).toBe(true);
    }
  });

  it("pins THE FINDING: R@3's measured band is WIDER than the inherited accuracy constant", () => {
    // The whole reason each metric gets its own band. A 1.2pp R@3 gap scored
    // against NOISE_MARGIN_PP would have been reported as a result and been
    // optimizer noise. If this ever stops being true, the header prose that
    // says so has to change with it.
    expect(RANK_NOISE_BANDS["R@3"].band).not.toBeNull();
    expect(RANK_NOISE_BANDS["R@3"].band ?? 0).toBeGreaterThan(NOISE_MARGIN_PP);
    // And R@1 — which IS the accuracy column — is tighter, so the inherited
    // constant is conservative there rather than wrong.
    expect(RANK_NOISE_BANDS["R@1"].band ?? 0).toBeLessThan(NOISE_MARGIN_PP);
  });
});

describe("isMetricComparable — the RB denominator mismatch", () => {
  it("refuses to score norm%, meanRank or medRank against a rookie baseline", () => {
    // Caught while running T3: without this, type 14's reading line scored the
    // model's 18.0% (of a ~40-team pool) against RB2's 64.3% (of a ~6-team
    // rookie block) and printed "BETTER" on a 46pp gap that is purely the
    // denominator — 260912-7bp's structural-zero artifact in a third outfit.
    for (const metric of ["norm%", "meanRank", "medRank"] as const) {
      expect(isMetricComparable(metric, "rb1")).toBe(false);
      expect(isMetricComparable(metric, "rb2")).toBe(false);
      expect(isMetricComparable(metric, "b1")).toBe(true);
      expect(isMetricComparable(metric, "b2")).toBe(true);
      expect(RANK_NOISE_BANDS[metric].perOrderingLength).toBe(true);
    }
  });

  it("leaves recall@k and MRR comparable against anything — they share a denominator", () => {
    // An abstaining RB scores 0 and stays in the recall denominator, which is
    // exactly what makes those columns a fair comparison.
    for (const metric of ["R@1", "R@3", "R@5", "R@10", "MRR"] as const) {
      expect(RANK_NOISE_BANDS[metric].perOrderingLength).toBe(false);
      for (const ref of RANK_PREDICTORS) expect(isMetricComparable(metric, ref)).toBe(true);
    }
  });

  it("keeps the flagship set clear of the rookie types, so its norm% is always poolwide", () => {
    for (const type of FLAGSHIP_JUDGED_AWARD_TYPES) {
      expect(ROOKIE_AWARD_TYPES).not.toContain(type);
    }
  });
});

describe("compareOnBand", () => {
  it("converts a fraction into percentage points for a pp-unit metric", () => {
    expect(compareOnBand("R@3", 0.5, 0.48).delta).toBeCloseTo(2, 9);
  });

  it("leaves an abs-unit metric in its own units", () => {
    expect(compareOnBand("MRR", 0.43, 0.403).delta).toBeCloseTo(0.027, 9);
  });

  it("calls a difference inside the band NO DIFFERENCE, never 'slightly better'", () => {
    expect(compareOnBand("R@3", 0.488, 0.484).verdict).toBe("no difference");
    expect(compareOnBand("R@1", 0.221, 0.216).verdict).toBe("no difference");
    expect(compareOnBand("MRR", 0.4030, 0.4010).verdict).toBe("no difference");
  });

  it("treats a difference sitting exactly ON the band as inside it", () => {
    expect(compareOnBand("R@3", 0.5015, 0.5).verdict).toBe("no difference");
    expect(compareOnBand("R@3", 0.4985, 0.5).verdict).toBe("no difference");
  });

  it("calls a difference outside the band better or worse", () => {
    expect(compareOnBand("R@3", 0.484, 0.511).verdict).toBe("worse");
    expect(compareOnBand("R@3", 0.338, 0.261).verdict).toBe("better");
  });

  it("orients norm% so a LOWER percentile is the better predictor", () => {
    // 14.4% vs 16.4%: the smaller number is the better ordering.
    expect(compareOnBand("norm%", 0.144, 0.164).verdict).toBe("better");
    expect(compareOnBand("norm%", 0.164, 0.144).verdict).toBe("worse");
    expect(compareOnBand("norm%", 0.1605, 0.16).verdict).toBe("no difference");
  });

  it("returns 'band not measured' for an unmeasured metric, NEVER 'no difference'", () => {
    // These are different claims. "No difference" says the gap was measured and
    // found to be noise; "band not measured" says it cannot be scored at all.
    for (const metric of ["R@5", "R@10", "brierSkill"] as const) {
      expect(compareOnBand(metric, 0.9, 0.1).verdict).toBe("band not measured");
      expect(compareOnBand(metric, 0.1, 0.1).verdict).toBe("band not measured");
    }
  });
});

describe("bandGloss", () => {
  it("names the measured band and never says 'slightly'", () => {
    const g = bandGloss("R@3", compareOnBand("R@3", 0.484, 0.511));
    expect(g).toContain("WORSE");
    expect(g).toContain("1.50pp band");
    expect(g).toContain("-2.7pp");
    expect(g.toLowerCase()).not.toContain("slightly");
  });

  it("says CANNOT BE SCORED, not 'no difference', for an unmeasured metric", () => {
    const g = bandGloss("R@5", compareOnBand("R@5", 0.633, 0.668));
    expect(g).toContain("CANNOT BE SCORED");
    expect(g).toContain("no band measured");
    expect(g).not.toContain("NO DIFFERENCE");
  });

  it("says LOWER IS BETTER on the inverted metric so the sign cannot be misread", () => {
    expect(bandGloss("norm%", compareOnBand("norm%", 0.144, 0.164))).toContain("LOWER IS BETTER");
  });
});

describe("rankReferencePredictor", () => {
  it("reads every non-rookie type against B1, the decoration ordering", () => {
    const c = emptyCell();
    for (const type of [0, 9, 18, 21, 71, 1, 2]) {
      expect(rankReferencePredictor(type, c)).toBe("b1");
    }
  });

  it("reads the three rookie types against RB, never against B1", () => {
    // 260912-7bp's lesson in rank form: B1/B2 are structurally near-bottom
    // rankers on these types, so a rank win over them is the same artifact.
    const c = emptyCell();
    c.n = 100;
    setRank(c, "rb1", { r1: 0.4, r3: 0.6 });
    setRank(c, "rb2", { r1: 0.3, r3: 0.5 });
    for (const type of ROOKIE_AWARD_TYPES) {
      expect(rankReferencePredictor(type, c)).toBe("rb1");
    }
  });

  it("picks whichever rookie baseline actually orders better on R@3", () => {
    const c = emptyCell();
    c.n = 100;
    setRank(c, "rb1", { r1: 0.4, r3: 0.5 });
    setRank(c, "rb2", { r1: 0.3, r3: 0.62 });
    expect(rankReferencePredictor(14, c)).toBe("rb2");
  });

  it("pins the rookie set at exactly 10, 14 and 15", () => {
    expect([...ROOKIE_AWARD_TYPES].sort((a, b) => a - b)).toEqual([10, 14, 15]);
  });
});

describe("rankMetricValue", () => {
  it("reads the same numbers the rank table prints, for every metric", () => {
    const c = emptyCell();
    c.n = 200;
    setRank(c, "model", { r1: 0.2, r3: 0.45, r5: 0.6, r10: 0.8, mrr: 0.33, norm: 0.17 });
    expect(rankMetricValue(c, "model", "R@1")).toBeCloseTo(cellRecallAt(c, "model", 0), 12);
    expect(rankMetricValue(c, "model", "R@3")).toBeCloseTo(cellRecallAt(c, "model", 1), 12);
    expect(rankMetricValue(c, "model", "R@5")).toBeCloseTo(cellRecallAt(c, "model", 2), 12);
    expect(rankMetricValue(c, "model", "R@10")).toBeCloseTo(cellRecallAt(c, "model", 3), 12);
    expect(rankMetricValue(c, "model", "MRR")).toBeCloseTo(cellMrr(c, "model"), 12);
    expect(rankMetricValue(c, "model", "meanRank")).toBeCloseTo(cellMeanRank(c, "model"), 12);
    expect(rankMetricValue(c, "model", "medRank")).toBeCloseTo(cellMedianRank(c, "model"), 12);
    expect(rankMetricValue(c, "model", "norm%")).toBeCloseTo(cellNormalizedRank(c, "model"), 12);
  });

  it("omits meanRank and medRank from the reading block, because neither has a band", () => {
    for (const metric of RANK_READING_METRICS) {
      expect(RANK_NOISE_BANDS[metric].band === null || metric !== "meanRank").toBe(true);
    }
    expect(RANK_READING_METRICS).not.toContain("meanRank");
    expect(RANK_READING_METRICS).not.toContain("medRank");
  });
});

describe("orderingWinner", () => {
  it("is a TIE inside the R@3 band even when one side is numerically ahead", () => {
    const c = flagshipCell({ n: 1000, pool: 40, modelR3: 0.488, b1R3: 0.484, stated: 0.3, observed: 0.21 });
    expect(orderingWinner(c, "b1").winner).toBe("tie");
  });

  it("names the model only when it is outside the band", () => {
    const c = flagshipCell({ n: 1000, pool: 40, modelR3: 0.338, b1R3: 0.261, stated: 0.19, observed: 0.14 });
    expect(orderingWinner(c, "b1").winner).toBe("model");
  });

  it("names the reference when the decoration ordering wins by more than the band", () => {
    const c = flagshipCell({ n: 1000, pool: 40, modelR3: 0.484, b1R3: 0.511, stated: 0.3, observed: 0.21 });
    expect(orderingWinner(c, "b1").winner).toBe("reference");
  });
});

describe("the PRACTICAL ANSWER block", () => {
  const build = (): ExperimentReport =>
    flagshipReport([
      {
        awardType: 0,
        name: "Impact",
        pooled: flagshipCell({
          n: 1538,
          pool: 39,
          modelR3: 0.484,
          b1R3: 0.511,
          stated: 0.299,
          observed: 0.212,
        }),
      },
      {
        awardType: 21,
        name: "Excellence in Engineering",
        pooled: flagshipCell({
          n: 1492,
          pool: 41,
          modelR3: 0.338,
          b1R3: 0.261,
          stated: 0.189,
          observed: 0.143,
        }),
      },
    ]);

  it("states the ORDER and the NUMBER for every type — never one without the other", () => {
    // The load-bearing property of this block. A reader who takes only the
    // ordering half away has been misled about what could go on a page.
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text.match(/^\s+ORDER :/gm)?.length).toBe(2);
    expect(text.match(/^\s+NUMBER:/gm)?.length).toBe(2);
  });

  it("says in its own header that both halves are the answer", () => {
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text).toContain("TWO HALVES");
    expect(text).toContain("misled");
  });

  it("is GENERATED: moving the stated probability moves the text", () => {
    const before = formatPracticalAnswer(build()).join("\n");
    expect(before).toContain("states its top pick wins 29.9%");
    expect(before).toContain("actually wins 21.2%");

    const moved = build();
    const c = moved.byType[0]?.pooled;
    expect(c).toBeDefined();
    if (c !== undefined) setCalibration(c, "model", { stated: 0.5, observed: 0.1, instances: 1538 });
    const after = formatPracticalAnswer(moved).join("\n");
    expect(after).toContain("states its top pick wins 50.0%");
    expect(after).not.toContain("states its top pick wins 29.9%");
  });

  it("names the decoration ordering as stating NO probability when it is the better ranker", () => {
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text).toContain("Best ordering is B1");
    expect(text).toContain("states NO probability at");
    expect(text).toContain("it is a sort, not a model");
  });

  it("reports the fit's own ordering where the fit wins, with no such caveat", () => {
    const only = flagshipReport([
      {
        awardType: 21,
        name: "Excellence in Engineering",
        pooled: flagshipCell({
          n: 1492,
          pool: 41,
          modelR3: 0.338,
          b1R3: 0.261,
          stated: 0.189,
          observed: 0.143,
        }),
      },
    ]);
    const text = formatPracticalAnswer(only).join("\n");
    expect(text).toContain("Best ordering is no-age (the fitted model)");
    expect(text).not.toContain("states NO probability at");
  });

  it("calls the ordering below the top pick WEAK when the winner sits mid-pool", () => {
    const weak = flagshipReport([
      {
        awardType: 0,
        name: "Impact",
        pooled: flagshipCell({
          n: 1538,
          pool: 39,
          modelR3: 0.1,
          b1R3: 0.09,
          stated: 0.1,
          observed: 0.09,
          norm: 0.44,
          ranks: [17],
        }),
      },
    ]);
    const text = formatPracticalAnswer(weak).join("\n");
    expect(text).toContain("the ordering below the top pick is weak");
    expect(text).toContain("most of the story after all");
  });

  it("says NEEDS RECALIBRATION when the top-1 gap is outside the pre-committed +/-5pp", () => {
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text).toContain("NO — NEEDS RECALIBRATION");
    expect(text).toContain("OVERCONFIDENT");
  });

  it("says USABLE AS STATED when the same pre-committed rule is actually met", () => {
    // The verdict is generated, not asserted: a calibrated fixture must be able
    // to pass, or the block would be printing a foregone conclusion.
    const ok = flagshipReport([
      {
        awardType: 71,
        name: "Autonomous",
        pooled: flagshipCell({
          n: 1000,
          pool: 40,
          modelR3: 0.42,
          b1R3: 0.36,
          stated: 0.22,
          observed: 0.21,
        }),
      },
    ]);
    const text = formatPracticalAnswer(ok).join("\n");
    expect(text).toContain("USABLE AS STATED");
    expect(text).not.toContain("NEEDS RECALIBRATION");
  });

  it("counts the ordering and calibration outcomes in its closing sentence", () => {
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text).toContain("across the 2 flagship judged award types");
    expect(text).toContain("than the fit on 1 of them, the fit orders better on 1, and 0 are a tie");
    // 1 of 2, not 2 of 2: the Excellence fixture's +4.6pp top-1 gap is inside
    // the pre-committed +/-5pp, so it passes. The verdict is GENERATED, and a
    // fixture that could never pass would prove nothing about the rule.
    expect(text).toContain("but on 1 of 2 the stated probability FAILS");
  });

  it("names the surface it is NOT authorizing", () => {
    const text = formatPracticalAnswer(build()).join("\n");
    expect(text).toContain("OWED, NOT DONE HERE");
    expect(text).toContain("it does not authorize");
  });

  it("skips a flagship type that is absent or empty rather than printing a zero row", () => {
    const empty = emptyCell();
    const text = formatPracticalAnswer(
      flagshipReport([{ awardType: 0, name: "Impact", pooled: empty }])
    ).join("\n");
    expect(text).not.toContain("ORDER :");
    expect(text).toContain("across the 0 flagship judged award types");
  });
});

describe("the full report carries the T3 output", () => {
  const report = flagshipReport([
    {
      awardType: 0,
      name: "Impact",
      pooled: flagshipCell({
        n: 1538,
        pool: 39,
        modelR3: 0.484,
        b1R3: 0.511,
        stated: 0.299,
        observed: 0.212,
      }),
    },
  ]);

  it("prints the measured bands, their provenance and the too-tight finding in the header", () => {
    const text = formatReport(report);
    expect(text).toContain("THE NOISE BANDS ARE MEASURED PER METRIC, NOT INHERITED");
    expect(text).toContain("--iterations 200 and at --iterations 1500");
    expect(text).toContain("R@1 0.77pp    R@3 1.50pp    MRR 0.0046    norm% 0.17pp");
    expect(text).toContain("IS TOO TIGHT FOR R@3");
    expect(text).toContain("R@5, R@10, meanRank, medRank and the Brier skill score were NOT measured");
  });

  it("prints the per-type READING block against the reference ordering", () => {
    const text = formatReport(report);
    expect(text).toContain("reference ordering = B1");
    expect(text).toContain("A model ordering not compared against it is not a result.");
    expect(text).toContain("CANNOT BE SCORED");
  });

  it("ends with the PRACTICAL ANSWER", () => {
    expect(formatReport(report)).toContain("PRACTICAL ANSWER");
  });
});

// ---------------------------------------------------------------------------
// THE DISTRICT POINTS CUT AND THE STRATUM (quick task 260912-l8t T1)
// ---------------------------------------------------------------------------

/** A minimal `events` + `districts` + `district_rankings` schema, in memory. */
function cutDb(): SqliteDb {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE events (event_key TEXT PRIMARY KEY, year INTEGER, event_type INTEGER, district_key TEXT);
    CREATE TABLE districts (district_key TEXT PRIMARY KEY, year INTEGER, abbreviation TEXT, cmp_slots INTEGER);
    CREATE TABLE district_rankings (district_key TEXT, team_key TEXT, rank INTEGER);
  `);
  return db;
}

function joinRow(
  eventKey: string,
  districtKey: string,
  year: number,
  abbreviation: string,
  cmpSlots: number | null
): DcmpDistrictJoinRow {
  return { eventKey, districtKey, year, abbreviation, cmpSlots };
}

/** `n` synthetic joined DCMP events, enough to clear `MIN_JOINED_DCMP_EVENTS`. */
function manyJoinRows(n: number): DcmpDistrictJoinRow[] {
  const out: DcmpDistrictJoinRow[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(joinRow(`20${20 + (i % 5)}d${i}cmp`, `20${20 + (i % 5)}d${i}`, 2020 + (i % 5), `d${i}`, 10));
  }
  return out;
}

/** A cut fixture with a real floor of 1, for the stratum-precedence tests. */
function smallCuts(
  joined: readonly DcmpDistrictJoinRow[],
  rankings: readonly DistrictRankingRow[],
  extraDcmpEventKeys: readonly string[] = []
): DistrictCuts {
  return buildDistrictCuts({
    dcmpEventKeys: [...joined.map((j) => j.eventKey), ...extraDcmpEventKeys],
    joined,
    rankings,
    minJoinedEvents: 1,
  });
}

describe("THE JOIN TRAP — bare abbreviation vs year-prefixed district_key", () => {
  it("the naive column-to-column join returns ZERO rows where the correct one returns rows", () => {
    const db = cutDb();
    try {
      // The exact collision schema.sql warns about: the SAME district, stored
      // BARE on events and YEAR-PREFIXED on districts.
      db.prepare(`INSERT INTO events VALUES (?, ?, ?, ?)`).run("2024chscmp", 2024, 2, "chs");
      db.prepare(`INSERT INTO districts VALUES (?, ?, ?, ?)`).run("2024chs", 2024, "chs", 23);

      const naive = db.prepare(NAIVE_DCMP_DISTRICT_JOIN_SQL).all();
      const correct = db.prepare(DCMP_DISTRICT_JOIN_SQL).all();

      // THIS is the assertion the trap needs: the broken join does not error,
      // it returns an empty result set — a confident, wrong "no data" answer.
      expect(naive).toEqual([]);
      expect(correct).toHaveLength(1);
      expect(correct[0]).toMatchObject({
        event_key: "2024chscmp",
        district_key: "2024chs",
        year: 2024,
        abbreviation: "chs",
        cmp_slots: 23,
      });
    } finally {
      db.close();
    }
  });

  it("loadDistrictCuts reads a corpus-shaped database end to end", () => {
    const db = cutDb();
    try {
      const ev = db.prepare(`INSERT INTO events VALUES (?, ?, ?, ?)`);
      const di = db.prepare(`INSERT INTO districts VALUES (?, ?, ?, ?)`);
      const ra = db.prepare(`INSERT INTO district_rankings VALUES (?, ?, ?)`);
      for (let i = 0; i < 110; i += 1) {
        const year = 2016 + (i % 10);
        const abbr = `d${i}`;
        ev.run(`${year}${abbr}cmp`, year, i % 2 === 0 ? 2 : 5, abbr);
        di.run(`${year}${abbr}`, year, abbr, 20);
        ra.run(`${year}${abbr}`, "frc1", 1);
        ra.run(`${year}${abbr}`, "frc2", 40);
      }
      // A non-DCMP event must not join in, even though its district matches.
      ev.run("2016d0", 2016, 1, "d0");

      const cuts = loadDistrictCuts(db);
      expect(cuts.dcmpEventsJoined).toBe(110);
      expect(cuts.dcmpEvents).toBe(110);
      expect(cuts.districtSeasons).toBe(110);
      expect(cuts.districtSeasonsNullCmpSlots).toBe(0);
      expect(cuts.districtSeasonsNoRankings).toBe(0);
      expect(cuts.dcmpEventKeys.has("2016d0")).toBe(false);
      expect(assignStratum("2016d0cmp", ["frc2"], cuts)).toBe("OUTSIDE");
      expect(assignStratum("2016d0cmp", ["frc1"], cuts)).toBe("INSIDE");
    } finally {
      db.close();
    }
  });

  it("throws, naming the trap, when too few DCMP events joined", () => {
    const joined = manyJoinRows(MIN_JOINED_DCMP_EVENTS - 1);
    expect(() =>
      buildDistrictCuts({
        dcmpEventKeys: joined.map((j) => j.eventKey),
        joined,
        rankings: [{ districtKey: joined[0]?.districtKey ?? "", teamKey: "frc1", rank: 1 }],
      })
    ).toThrow(/BARE-ABBREVIATION \/ YEAR-PREFIXED TRAP/);
  });

  it("throws on a completely empty join rather than measuring nothing", () => {
    expect(() =>
      buildDistrictCuts({ dcmpEventKeys: ["2024chscmp"], joined: [], rankings: [] })
    ).toThrow(/only 0 DCMP event\(s\) joined/);
  });

  it("the trap message names both key shapes and the correct join", () => {
    const msg = dcmpJoinTrapMessage(0);
    expect(msg).toContain("events.district_key");
    expect(msg).toContain("districts.district_key");
    expect(msg).toContain("2024chs");
    expect(msg).toContain("districts.abbreviation");
    expect(msg).toContain("EMPTY RESULT SET WITH NO ERROR");
  });

  it("throws when the join succeeds but not one district-season has a rankings row", () => {
    const joined = manyJoinRows(MIN_JOINED_DCMP_EVENTS + 5);
    expect(() =>
      buildDistrictCuts({ dcmpEventKeys: joined.map((j) => j.eventKey), joined, rankings: [] })
    ).toThrow(/NOT ONE has a single district_rankings row/);
  });

  it("clears the floor at exactly MIN_JOINED_DCMP_EVENTS", () => {
    const joined = manyJoinRows(MIN_JOINED_DCMP_EVENTS);
    const cuts = buildDistrictCuts({
      dcmpEventKeys: joined.map((j) => j.eventKey),
      joined,
      rankings: [{ districtKey: joined[0]?.districtKey ?? "", teamKey: "frc1", rank: 1 }],
    });
    expect(cuts.dcmpEventsJoined).toBe(MIN_JOINED_DCMP_EVENTS);
  });
});

describe("the stratum every DCMP award belongs to", () => {
  const joined = [
    joinRow("2024chscmp", "2024chs", 2024, "chs", 25),
    joinRow("2024chsd1", "2024chs", 2024, "chs", 25),
  ];
  const rankings: DistrictRankingRow[] = [
    { districtKey: "2024chs", teamKey: "frcInside", rank: 10 },
    { districtKey: "2024chs", teamKey: "frcAtCut", rank: 25 },
    { districtKey: "2024chs", teamKey: "frcJustOut", rank: 26 },
    { districtKey: "2024chs", teamKey: "frcFarOut", rank: 34 },
  ];
  const cuts = smallCuts(joined, rankings, ["2024orphancmp"]);

  it("an award at a non-DCMP event has NO stratum at all", () => {
    expect(assignStratum("2024week1", ["frcInside"], cuts)).toBeNull();
  });

  it("a DCMP event with no district row is UNKNOWN, not excluded", () => {
    expect(assignStratum("2024orphancmp", ["frcInside"], cuts)).toBe("UNKNOWN");
  });

  it("the boundary is asserted, not assumed: rank === cmp_slots is INSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcAtCut"], cuts)).toBe("INSIDE");
  });

  it("the boundary is asserted, not assumed: rank === cmp_slots + 1 is OUTSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcJustOut"], cuts)).toBe("OUTSIDE");
  });

  it("a recipient missing from district_rankings is UNKNOWN, never INSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcNeverRanked"], cuts)).toBe("UNKNOWN");
  });

  it("PRECEDENCE: UNKNOWN beats OUTSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcFarOut", "frcNeverRanked"], cuts)).toBe("UNKNOWN");
  });

  it("PRECEDENCE: UNKNOWN beats INSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcInside", "frcNeverRanked"], cuts)).toBe("UNKNOWN");
  });

  it("PRECEDENCE: OUTSIDE beats INSIDE — one below-cut co-recipient decides a berth", () => {
    expect(assignStratum("2024chscmp", ["frcInside", "frcFarOut"], cuts)).toBe("OUTSIDE");
  });

  it("every recipient inside the cut is INSIDE", () => {
    expect(assignStratum("2024chscmp", ["frcInside", "frcAtCut"], cuts)).toBe("INSIDE");
  });

  it("no recipient at all is UNKNOWN, never INSIDE by default", () => {
    expect(assignStratum("2024chscmp", [], cuts)).toBe("UNKNOWN");
  });

  it("a type-5 DIVISION resolves to the same district-season as its type-2 sibling", () => {
    expect(cuts.byEvent.get("2024chsd1")).toBe(cuts.byEvent.get("2024chscmp"));
    expect(assignStratum("2024chsd1", ["frcFarOut"], cuts)).toBe("OUTSIDE");
  });

  it("a NULL cmp_slots is UNKNOWN — never zero capacity, never unlimited", () => {
    const nullCuts = smallCuts(
      [joinRow("2024xxcmp", "2024xx", 2024, "xx", null)],
      [{ districtKey: "2024xx", teamKey: "frcInside", rank: 1 }]
    );
    expect(nullCuts.districtSeasonsNullCmpSlots).toBe(1);
    // Zero capacity would make this OUTSIDE; unlimited would make it INSIDE.
    expect(assignStratum("2024xxcmp", ["frcInside"], nullCuts)).toBe("UNKNOWN");
  });

  it("a district-season with zero rankings rows is counted and reads UNKNOWN", () => {
    const bare = smallCuts(
      [joinRow("2024yycmp", "2024yy", 2024, "yy", 20), joinRow("2024zzcmp", "2024zz", 2024, "zz", 20)],
      [{ districtKey: "2024zz", teamKey: "frcA", rank: 1 }]
    );
    expect(bare.districtSeasonsNoRankings).toBe(1);
    expect(assignStratum("2024yycmp", ["frcA"], bare)).toBe("UNKNOWN");
  });

  it("OUTSIDE is printed first, because OUTSIDE is the answer", () => {
    expect(STRATA[0]).toBe("OUTSIDE");
    expect([...STRATA]).toEqual(["OUTSIDE", "INSIDE", "UNKNOWN"]);
    expect([...STRATUM_ROWS]).toEqual(["OUTSIDE", "INSIDE", "UNKNOWN", DCMP_ALL]);
    // The pooled row is LAST, so it can never be read before the strata.
    expect(STRATUM_ROWS[STRATUM_ROWS.length - 1]).toBe(DCMP_ALL);
  });

  it("the berth award types are exactly Impact, Engineering Inspiration and Rookie All Star", () => {
    expect([...BERTH_AWARD_TYPES]).toEqual([0, 9, 10]);
    // Type 10 is ALSO a rookie type, so it is read against RB1/RB2 and never B1/B2.
    expect(ROOKIE_AWARD_TYPES).toContain(10);
  });
});

describe("the DCMP premise control", () => {
  const joined = [joinRow("2024chscmp", "2024chs", 2024, "chs", 25)];
  const rankings: DistrictRankingRow[] = [
    { districtKey: "2024chs", teamKey: "frcIn", rank: 5 },
    { districtKey: "2024chs", teamKey: "frcOut", rank: 40 },
  ];
  const cuts = smallCuts(joined, rankings);

  it("counts instances and recipients on their OWN denominators", () => {
    const premise = measureDcmpPremise(
      [
        // One merged instance with one inside and one outside winner: OUTSIDE by
        // the any-recipient rule, but ONE inside and ONE outside recipient.
        inst(2024, "2024chscmp", 0, ["frcIn", "frcOut"]),
        inst(2024, "2024chscmp", 9, ["frcIn"]),
        // Not a berth award type — excluded from the premise entirely.
        inst(2024, "2024chscmp", 21, ["frcOut"]),
        // Not a DCMP event — no stratum, no contribution.
        inst(2024, "2024week1", 0, ["frcOut"]),
      ],
      cuts
    );
    expect(premise.instances).toBe(2);
    expect(premise.instancesByStratum).toEqual({ OUTSIDE: 1, INSIDE: 1, UNKNOWN: 0 });
    expect(premise.recipients).toBe(3);
    expect(premise.recipientsByStratum).toEqual({ OUTSIDE: 1, INSIDE: 2, UNKNOWN: 0 });
    // The instance share is MECHANICALLY HIGHER than the recipient share under
    // the any-recipient rule. That is arithmetic, not a broken join.
    expect(premise.outsideInstanceShare).toBeCloseTo(0.5, 10);
    expect(premise.outsideRecipientShare).toBeCloseTo(1 / 3, 10);
  });

  function premiseOf(recipients: number, outside: number): DcmpPremise {
    return {
      instances: recipients,
      instancesByStratum: { OUTSIDE: outside, INSIDE: recipients - outside, UNKNOWN: 0 },
      recipients,
      recipientsByStratum: { OUTSIDE: outside, INSIDE: recipients - outside, UNKNOWN: 0 },
      outsideRecipientShare: recipients === 0 ? 0 : outside / recipients,
      outsideInstanceShare: recipients === 0 ? 0 : outside / recipients,
    };
  }

  it("passes on the pre-measured corpus numbers", () => {
    expect(() => checkDcmpPremise(premiseOf(519, 260))).not.toThrow();
  });

  it("throws when the recipient count has moved outside the tolerance", () => {
    expect(() => checkDcmpPremise(premiseOf(301, 206))).toThrow(/DCMP premise FAILED/);
    expect(() => checkDcmpPremise(premiseOf(0, 0))).toThrow(/DCMP premise FAILED/);
  });

  it("throws when the OUTSIDE share has moved outside the band", () => {
    // Right count, wrong cut: the join worked and the ranking did not.
    expect(() => checkDcmpPremise(premiseOf(519, 40))).toThrow(/of berth-award/);
    expect(() => checkDcmpPremise(premiseOf(519, 500))).toThrow(/of berth-award/);
  });

  it("the tolerances are the pre-measured ones", () => {
    expect(PREMISE_RECIPIENTS_EXPECTED).toBe(519);
    expect(PREMISE_RECIPIENT_TOLERANCE).toBeCloseTo(0.1, 10);
    expect(PREMISE_OUTSIDE_SHARE_MIN).toBeCloseTo(0.45, 10);
    expect(PREMISE_OUTSIDE_SHARE_MAX).toBeCloseTo(0.55, 10);
  });
});

describe("the DCMP census header", () => {
  const joined = [joinRow("2016chscmp", "2016chs", 2016, "chs", 25)];
  const cuts = smallCuts(joined, [
    { districtKey: "2016chs", teamKey: "frcIn", rank: 5 },
    { districtKey: "2016chs", teamKey: "frcOut", rank: 34 },
  ]);
  const premise = measureDcmpPremise(
    [inst(2016, "2016chscmp", 0, ["frcOut"]), inst(2016, "2016chscmp", 9, ["frcIn"])],
    cuts
  );
  const text = formatDcmpCensus(cuts, premise, [2016, 2017, 2018]).join("\n");

  it("labels the cut an APPROXIMATION and names the direction of the error", () => {
    expect(text).toContain("APPROXIMATE cut");
    expect(text).toContain("CONSERVATIVE");
    expect(DISTRICT_CUT_BASIS).toContain("APPROXIMATE");
  });

  it("names the join trap before any result is printed", () => {
    expect(text).toContain("BARE abbreviation");
    expect(text).toContain("YEAR-PREFIXED");
    expect(text).toContain("districts.abbreviation");
  });

  it("prints BOTH denominators, so neither is mistaken for the other", () => {
    expect(text).toContain("RECIPIENTS");
    expect(text).toContain("INSTANCES");
    expect(text).toContain("MECHANICALLY HIGHER");
  });

  it("says the first season is training-only and its examples will not appear below", () => {
    expect(text).toContain("2016 IS TRAINING-ONLY AND IS NEVER SCORED");
    expect(text).toContain("DO NOT APPEAR in any scored table");
  });

  it("prints the null-cmp_slots and no-rankings counts rather than throwing on them", () => {
    expect(text).toContain("NULL cmp_slots");
    expect(text).toContain("NO rankings rows");
  });
});
