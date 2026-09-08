/**
 * Stage 1 probe: which VPR parameters actually move 2026 winner accuracy?
 *
 * Deliberately NOT a new tuner. It replays a fixed set of parameter
 * configurations and reports, for each, 2026 accuracy plus the event-blocked
 * PAIRED standard error of its delta against the shipped 2026 baseline.
 *
 * Three things differ from `tune.ts --stage screen`, and all three are the
 * point of this script existing:
 *   1. it scores 2026, the season we care about, not 2019/2020;
 *   2. it reports ACCURACY, not Brier;
 *   3. it sweeps around the SHIPPED 2026 parameter values, not around
 *      defaults — so "this knob is dead" means dead where the model actually
 *      operates, rather than dead at a point the model never visits.
 *
 * The replay loop mirrors `tune.ts`'s own `runBoundedSeasons` (same
 * `buildSeasonStream` / `WalkForwardSimulator` / `seasonBoundaryFor`
 * primitives, same carry-state handling). It is duplicated rather than
 * imported because that function is module-private; this is a throwaway
 * diagnostic and must not require editing a committed file to run.
 */
import { openCorpusReadOnly, type Corpus } from "../../../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../../../packages/harness/replay.js";
import { seasonBoundaryFor } from "../../../packages/harness/seasonBoundary.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput } from "../../../packages/harness/score.js";
import { buildEventAccuracyBlocks, accuracyDeltaStandardError, type EventAccuracyBlock } from "../../../packages/harness/tune.js";
import { SIGMA1_SEARCH_SPACE, screenGridFor, type SearchableParamKey } from "../../../packages/harness/searchSpace.js";
import { makeSigma1 } from "../../../packages/core/algorithms/sigma1/index.js";
import { Sigma1ParamsSchema, DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../../../packages/core/algorithms/sigma1/params.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import type { AlgorithmModule } from "../../../packages/core/algorithms/types.js";
import { readFileSync, writeFileSync } from "node:fs";

// Set from --season / --replay in main(). Every origin scores its OWN shipped
// parameter set as the baseline, so a per-origin verdict compares like with
// like rather than against 2026's parameters.
let REPLAY_SEASONS: readonly number[] = [2024, 2025, 2026];
let SCORE_SEASON = 2026;

interface Config {
  readonly id: string;
  /** `null` marks the EPA reference module rather than a Sigma1 parameter set. */
  readonly params: Sigma1Params | null;
  readonly knob: string;
  readonly value: number | null;
}

function shippedParams(versionPath: string, season: number): Sigma1Params {
  const file = JSON.parse(readFileSync(versionPath, "utf8"));
  const entry = file.paramSetsBySeason?.[String(season)];
  if (!entry) throw new Error(`no paramSetsBySeason entry for ${season} in ${versionPath}`);
  return Sigma1ParamsSchema.parse(entry.params);
}

/** One corpus pass evaluating every algorithm in `algorithms` simultaneously. */
async function replayBatch(db: Corpus, algorithms: readonly AlgorithmModule<any>[]) {
  const all: (HarnessPredictionInput & { actualRedScore: number; actualBlueScore: number })[] = [];
  let liveStates = new Map<string, unknown>();

  for (const [seasonIdx, season] of REPLAY_SEASONS.entries()) {
    const boundary = seasonBoundaryFor(REPLAY_SEASONS, seasonIdx);
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart) {
      const carried = new Map<string, unknown>();
      for (const algorithm of algorithms) {
        const prior = liveStates.get(algorithm.id);
        if (algorithm.carrySeason && prior !== undefined) carried.set(algorithm.id, algorithm.carrySeason(prior, boundary));
      }
      initialStates = carried;
    }

    const stream = buildSeasonStream(db, season, { includeOffseason: false });
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const records = new WalkForwardSimulator(stream).runAll(algorithms, teams, initialStates);

    for (const r of records) {
      all.push({
        matchKey: r.match.matchKey,
        season,
        actualRedScore: r.match.redScore,
        actualBlueScore: r.match.blueScore,
        eventKey: r.match.eventKey,
        compLevel: r.match.compLevel,
        algorithmId: r.algorithmId,
        pRedWin: r.prediction.pRedWin,
        predictedRedScore: r.prediction.redScore,
        predictedBlueScore: r.prediction.blueScore,
        actualWinner: r.match.winner,
        isOffseason: false,
        isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
      });
    }
    liveStates = new Map(records.finalStates);
  }
  return all;
}

interface Measured {
  readonly id: string;
  readonly knob: string;
  readonly value: number | null;
  readonly accuracy: number | null;
  readonly brier: number | null;
  readonly blocks: EventAccuracyBlock[];
}

async function measure(db: Corpus, configs: readonly Config[], batchSize: number): Promise<Measured[]> {
  const out: Measured[] = [];
  for (let i = 0; i < configs.length; i += batchSize) {
    const chunk = configs.slice(i, i + batchSize);
    const algorithms = chunk.map((c) =>
      c.params === null ? { ...epa, id: c.id } : makeSigma1({ id: c.id, linkMode: "predictive-variance", params: c.params })
    );
    const predictions = await replayBatch(db, algorithms);
    // Score ONLY the origin season; the earlier seasons exist to carry state in.
    const originOnly = predictions.filter((p) => p.season === SCORE_SEASON);
    const slices = aggregateScores(originOnly, { corpusSeasons: [SCORE_SEASON], selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED });
    for (const c of chunk) {
      const slice = slices.find((s) => s.algorithmId === c.id && s.season === SCORE_SEASON && s.compLevelView === "combined");
      out.push({
        id: c.id,
        knob: c.knob,
        value: c.value,
        accuracy: slice?.winnerAccuracy ?? null,
        brier: slice?.brierScore ?? null,
        blocks: buildEventAccuracyBlocks(originOnly, c.id),
      });
    }
    console.log(`[probe] ${Math.min(i + batchSize, configs.length)}/${configs.length} configs measured`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback?: string): string => {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  };

  const versionPath = arg("version", "data/algorithm-versions/vpr@10.0.0+rolling-2026-09d.json");
  SCORE_SEASON = Number(arg("season", "2026"));
  REPLAY_SEASONS = arg("replay", "2024,2025,2026").split(",").map(Number);
  if (!REPLAY_SEASONS.includes(SCORE_SEASON)) {
    throw new Error(`--replay (${REPLAY_SEASONS.join(",")}) must contain --season ${SCORE_SEASON}`);
  }
  const valueCount = Number(arg("values", "5"));
  const batchSize = Number(arg("batch", "6"));
  const outPath = arg("out");

  const baseline = shippedParams(versionPath, SCORE_SEASON);
  const configs: Config[] = [
    { id: "baseline", params: baseline, knob: "__baseline__", value: null },
    { id: "epa", params: null, knob: "__epa__", value: null },
  ];

  // `--mode procnoise`: the two process-noise terms swept TOGETHER.
  //
  // They cannot be tested one at a time. `isValidParamSet` and the Zod schema
  // both enforce `processNoiseEventBoundaryRel > processNoiseWithinEventRel`,
  // and on 2026 that constraint BOUND: the top of the within-event bound was
  // rejected as invalid while the accuracy trend was still climbing, so the
  // one-at-a-time sweep stopped short of the model's actual preference rather
  // than at it. A constraint that truncates a sweep is indistinguishable from
  // a flat knob unless you move both sides of it at once.
  //
  // Two families, so a result cannot be an artifact of either choice:
  //   ratio-N : boundary pinned at N x within, sliding both up together
  //   fixed-B : boundary held at a large good value, within swept underneath
  if (args.includes("--mode") && arg("mode") === "procnoise") {
    const WITHIN = [0.0002, 0.0005, 0.001, 0.002, 0.004, 0.008];
    const add = (id: string, within: number, boundary: number): void => {
      const parsed = Sigma1ParamsSchema.safeParse({
        ...baseline,
        processNoiseWithinEventRel: within,
        processNoiseEventBoundaryRel: boundary,
      });
      if (!parsed.success) {
        console.log(`[probe] SKIP ${id}: ${parsed.error.issues[0]?.message ?? "unknown"}`);
        return;
      }
      configs.push({ id, params: parsed.data, knob: "__procnoise__", value: within });
    };
    for (const w of WITHIN) {
      for (const ratio of [3, 10]) add(`ratio${ratio}#w=${w}`, w, w * ratio);
      // Boundary held at the value 2026's own one-at-a-time sweep preferred,
      // so this family asks "given a good boundary, how high does within want
      // to go?" -- skipped automatically wherever it would violate ordering.
      add(`fixedB#w=${w}`, w, 0.00778);
    }
    console.log(`[probe] procnoise mode: ${configs.length} configs`);
    const db = openCorpusReadOnly("data/corpus.sqlite");
    const measured = await measure(db, configs, batchSize);
    const base = measured.find((m) => m.id === "baseline");
    const epaRef = measured.find((m) => m.id === "epa");
    if (!base || base.accuracy === null || !epaRef || epaRef.accuracy === null) throw new Error("missing reference");
    const rows = measured.map((m) => ({
      id: m.id,
      within: m.value,
      accuracy: m.accuracy,
      brier: m.brier,
      accuracyDelta: m.accuracy !== null ? m.accuracy - base.accuracy! : null,
      pairedSe: m.id === "baseline" ? 0 : accuracyDeltaStandardError(m.blocks, base.blocks),
      deltaVsEpa: m.accuracy !== null ? m.accuracy - epaRef.accuracy! : null,
    }));
    writeFileSync(
      outPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), probe: "stage1d-procnoise", versionPath, scoreSeason: SCORE_SEASON, shippedWithin: baseline.processNoiseWithinEventRel, shippedBoundary: baseline.processNoiseEventBoundaryRel, rows }, null, 2)
    );
    console.log(`
shipped within=${baseline.processNoiseWithinEventRel} boundary=${baseline.processNoiseEventBoundaryRel}`);
    console.log(`config			accuracy	delta		sigma	brier`);
    for (const r of rows) {
      const sig = r.pairedSe > 0 ? (r.accuracyDelta! / r.pairedSe).toFixed(2) : "-";
      console.log(`${r.id.padEnd(22)}	${r.accuracy?.toFixed(5)}	${r.accuracyDelta! >= 0 ? "+" : ""}${r.accuracyDelta?.toFixed(5)}	${sig}	${r.brier?.toFixed(5)}`);
    }
    return;
  }

  // `--mode combos`: joint pins rather than a one-at-a-time sweep. Answers the
  // question leave-one-out structurally cannot -- whether a group of knobs
  // that are each individually flat are also flat TOGETHER.
  //
  // Every pin below is the knob's IDENTITY value (the behaviour that remains
  // once the field is deleted and its mechanism hardcoded off), NOT its
  // `DEFAULT_SIGMA1_PARAMS` value. Those differ, and the difference is
  // load-bearing: `carryMeanReversion`'s default is 0.4, but deleting the
  // mean-reversion mechanism leaves 0. Pinning to the default would measure a
  // model nobody is proposing to ship.
  if (args.includes("--mode") && arg("mode") === "combos") {
    const IDENTITY = {
      variance: { linkC: 1, covEwmaAlpha: DEFAULT_SIGMA1_PARAMS.covEwmaAlpha },
      adaptation: { adaptationEnabled: false },
      deadKnobs: { minConsistencyVarianceRel: 0.0001, maxTeamKalmanGain: 1 },
      carryDamping: { carryMeanReversion: 0, carryVarianceFactor: 1, carryEvidenceRate: 0 },
    } as const;
    const combos: Record<string, Partial<Sigma1Params>> = {
      "pin-variance": { ...IDENTITY.variance },
      "no-adaptation": { ...IDENTITY.adaptation },
      "pin-dead": { ...IDENTITY.adaptation, ...IDENTITY.deadKnobs },
      "pin-carry-damping": { ...IDENTITY.carryDamping },
      minimal: { ...IDENTITY.variance, ...IDENTITY.adaptation, ...IDENTITY.deadKnobs, ...IDENTITY.carryDamping },
      "minimal+shrink": {
        ...IDENTITY.variance,
        ...IDENTITY.adaptation,
        ...IDENTITY.deadKnobs,
        ...IDENTITY.carryDamping,
        attributionShrinkage: 0.9,
      },
      "baseline+shrink": { attributionShrinkage: 0.9 },
    };
    for (const [name, patch] of Object.entries(combos)) {
      const parsed = Sigma1ParamsSchema.safeParse({ ...baseline, ...patch });
      if (!parsed.success) {
        console.log(`[probe] SKIP combo ${name}: ${parsed.error.issues[0]?.message ?? "unknown"}`);
        continue;
      }
      configs.push({ id: name, params: parsed.data, knob: "__combo__", value: null });
    }
    console.log(`[probe] combos mode: ${configs.length} configs`);
    const db = openCorpusReadOnly("data/corpus.sqlite");
    const measured = await measure(db, configs, batchSize);
    const base = measured.find((m) => m.id === "baseline");
    if (!base || base.accuracy === null) throw new Error("baseline produced no measurement");
    // EPA is the bar that actually matters, so every config is reported
    // against BOTH references with its own paired SE. Deriving the
    // config-vs-EPA interval from the config-vs-baseline and
    // baseline-vs-EPA intervals would be wrong -- those two deltas are
    // correlated (they share the baseline's own prediction stream), so their
    // standard errors do not combine.
    const epaRef = measured.find((m) => m.id === "epa");
    if (!epaRef || epaRef.accuracy === null) throw new Error("epa reference produced no measurement");
    const rows = measured.map((m) => ({
      id: m.id,
      accuracy: m.accuracy,
      brier: m.brier,
      accuracyDelta: m.accuracy !== null ? m.accuracy - base.accuracy! : null,
      pairedSe: m.id === "baseline" ? 0 : accuracyDeltaStandardError(m.blocks, base.blocks),
      deltaVsEpa: m.accuracy !== null ? m.accuracy - epaRef.accuracy! : null,
      pairedSeVsEpa: m.id === "epa" ? 0 : accuracyDeltaStandardError(m.blocks, epaRef.blocks),
    }));
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), probe: "stage1-combos", versionPath, scoreSeason: SCORE_SEASON, rows }, null, 2));
    console.log(`\nconfig\t\t\taccuracy\tdVsShip\t\tseShip\t\tdVsEPA\t\tseEPA\t\tsigmaEPA\tbrier`);
    for (const r of rows) {
      const sigma = r.pairedSeVsEpa > 0 ? (r.deltaVsEpa! / r.pairedSeVsEpa).toFixed(2) : "-";
      console.log(
        `${r.id.padEnd(20)}\t${r.accuracy?.toFixed(5)}\t${r.accuracyDelta! >= 0 ? "+" : ""}${r.accuracyDelta?.toFixed(5)}\t${r.pairedSe.toFixed(5)}\t${r.deltaVsEpa! >= 0 ? "+" : ""}${r.deltaVsEpa?.toFixed(5)}\t${r.pairedSeVsEpa.toFixed(5)}\t${sigma}\t\t${r.brier?.toFixed(5)}`
      );
    }
    return;
  }

  // `--explicit "knobA=1,2,3;knobB=4,5"` replaces the registered-bound grid with
  // hand-chosen values. This exists because three parameters measured their
  // OPTIMUM AT A BOUND EDGE (attributionShrinkage and minConsistencyVarianceRel
  // both peak at their declared max on 2025), which means the registered bound
  // -- not the data -- is what is choosing the value. A sweep that stops where
  // the search space stops cannot tell you the search space is too small.
  const explicit = new Map<string, number[]>();
  if (args.includes("--explicit")) {
    for (const clause of arg("explicit").split(";")) {
      const [name, values] = clause.split("=");
      explicit.set(name.trim(), values.split(",").map(Number));
    }
  }

  const knobFilter = args.indexOf("--knobs") >= 0 ? new Set(arg("knobs").split(",")) : null;
  const keys = (
    explicit.size > 0
      ? ([...explicit.keys()] as SearchableParamKey[])
      : (Object.keys(SIGMA1_SEARCH_SPACE) as SearchableParamKey[])
  ).filter((k) => knobFilter === null || knobFilter.has(k));
  for (const key of keys) {
    const grid = explicit.get(key) ?? screenGridFor(key, valueCount);
    for (const [gi, value] of grid.entries()) {
      const candidate = { ...baseline, [key]: value };
      // A grid point that violates a cross-parameter invariant (e.g. the
      // within-event <= event-boundary process-noise ordering) is REPORTED as
      // skipped, never silently dropped -- a silently narrowed sweep reads as
      // "this knob is flat" when it was actually never tested there.
      const parsed = Sigma1ParamsSchema.safeParse(candidate);
      if (!parsed.success) {
        console.log(`[probe] SKIP ${key}=${value} (invariant violation: ${parsed.error.issues[0]?.message ?? "unknown"})`);
        continue;
      }
      configs.push({ id: `${key}#${gi}`, params: parsed.data, knob: key, value });
    }
  }

  console.log(`[probe] baseline=${versionPath} season=${SCORE_SEASON} replay=${REPLAY_SEASONS.join(",")}`);
  console.log(`[probe] ${configs.length} configs over ${keys.length} knobs at ${valueCount} values each, batch ${batchSize}`);

  const db = openCorpusReadOnly("data/corpus.sqlite");
  const measured = await measure(db, configs, batchSize);

  const base = measured.find((m) => m.id === "baseline");
  if (!base) throw new Error("baseline config produced no measurement");

  const rows = measured.map((m) => ({
    id: m.id,
    knob: m.knob,
    value: m.value,
    accuracy: m.accuracy,
    brier: m.brier,
    accuracyDelta: m.accuracy !== null && base.accuracy !== null ? m.accuracy - base.accuracy : null,
    pairedSe: m.id === "baseline" ? 0 : accuracyDeltaStandardError(m.blocks, base.blocks),
  }));

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        probe: "stage1-sensitivity",
        versionPath,
        scoreSeason: SCORE_SEASON,
        replaySeasons: REPLAY_SEASONS,
        valueCount,
        baselineAccuracy: base.accuracy,
        baselineBrier: base.brier,
        rows,
      },
      null,
      2
    )
  );
  console.log(`[probe] wrote ${outPath}`);

  // Per-knob summary: the accuracy SPAN across the knob's entire bound,
  // against the largest paired SE seen on that knob.
  const byKnob = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.knob.startsWith("__")) continue;
    const list = byKnob.get(r.knob) ?? [];
    list.push(r);
    byKnob.set(r.knob, list);
  }
  const summary = [...byKnob.entries()]
    .map(([knob, list]) => {
      const accs = list.map((r) => r.accuracy).filter((v): v is number => v !== null);
      const span = Math.max(...accs) - Math.min(...accs);
      const maxSe = Math.max(...list.map((r) => r.pairedSe));
      return { knob, span, maxSe, ratio: maxSe > 0 ? span / maxSe : Infinity, points: list.length };
    })
    .sort((a, b) => b.ratio - a.ratio);

  console.log(`\nbaseline 2026 accuracy: ${base.accuracy?.toFixed(5)}  brier: ${base.brier?.toFixed(5)}`);
  const epaRow = rows.find((r) => r.id === "epa");
  console.log(`EPA      2026 accuracy: ${epaRow?.accuracy?.toFixed(5)}  brier: ${epaRow?.brier?.toFixed(5)}`);
  console.log(`\nknob\taccSpan\tmaxPairedSE\tspan/SE\tpoints`);
  for (const s of summary) {
    console.log(`${s.knob}\t${s.span.toFixed(5)}\t${s.maxSe.toFixed(5)}\t${s.ratio.toFixed(2)}\t${s.points}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
