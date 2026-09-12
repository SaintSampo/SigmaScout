/**
 * Unit tests for `measureAwardPredictability.ts` (quick task 260912-5n8 T3).
 * Synthetic fixtures only — no test here opens the corpus, and no test here
 * touches the network.
 *
 * THE LEAK TESTS ARE THE LOAD-BEARING ONES. This whole probe is worthless if a
 * scored season's fit or features can see that season's own data: an in-sample
 * number would look like an answer and be none. Two independent leak tests
 * pin it — one on the feature builder's input set directly, one end-to-end
 * through `runExperiment` — because this project's failure log already records
 * what a missing evaluation guard costs.
 */
import { describe, expect, it } from "vitest";
import {
  FEATURE_COUNT,
  THIN_PRIOR_INSTANCES,
  argmaxIndex,
  buildAwardInstances,
  buildCandidatePools,
  buildFeatures,
  buildPriorHistory,
  compareTeamKeys,
  fitConditionalLogit,
  isPredictable,
  isThinPrior,
  isTop1Hit,
  modalAwardNames,
  NOISE_MARGIN_PP,
  pickByWeights,
  pickMostDecorated,
  pickStrongest,
  priorAnyCount,
  priorInstancesOfType,
  priorTypeCount,
  priorTypeLastYear,
  randomExpectedTop1,
  replayPreEventRatings,
  runExperiment,
  selectPriorInstances,
  teamNumber,
  toTrainInstance,
  verdictMarginPp,
  type AwardInstance,
  type AwardRowInput,
  type EventMetaInput,
  type ReplayMatch,
  type ReplayModel,
} from "./measureAwardPredictability.js";

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

function run(world: ReturnType<typeof syntheticWorld>, fitIterations = 60) {
  return runExperiment({
    instances: world.instances,
    census: emptyCensusFixture(),
    poolsByEvent: world.poolsByEvent,
    ratingsByEvent: world.ratingsByEvent,
    awardNames: new Map(),
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
  const cell = (n: number, model: number, b1: number, b2: number) => ({
    n,
    poolSum: n * 40,
    recipSum: n,
    modelHits: model,
    b1Hits: b1,
    b2Hits: b2,
    b0Expected: n / 40,
    unreachable: 0,
    thinPriorRows: 0,
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
});
