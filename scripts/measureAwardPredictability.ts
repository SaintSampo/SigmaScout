/**
 * Can FRC awards be predicted, and at what accuracy? (quick task 260912-5n8 T3)
 *
 * A FEASIBILITY PROBE, not a model and not a shipped surface. The deliverable
 * is a table of measured top-1 accuracies next to their baselines. Nothing here
 * is promoted, nothing renders, nothing is tuned.
 *
 * ---------------------------------------------------------------------------
 * EXACTLY TWO FEATURE FAMILIES
 * ---------------------------------------------------------------------------
 *
 *   (a) PRIOR AWARD HISTORY — how often and how recently this team has won
 *       this award before, plus how decorated it is overall. PRIOR SEASONS
 *       ONLY.
 *   (b) PRE-EVENT ON-FIELD STRENGTH — the team's BPR rating going into the
 *       event.
 *
 * Team age / veteran status and event context were considered and DELIBERATELY
 * NOT SELECTED. They must not be added, and must not be smuggled back in as a
 * derived quantity ("seasons since first appearance", event week/district/
 * country). The direct consequence is that Rookie All Star (type 10), Rookie
 * Inspiration (15) and Highest Rookie Seed (14) are HANDICAPPED: without an age
 * feature the model cannot see which candidates are rookies, so it is being
 * asked to pick a rookie out of a pool in which rookies are invisible. That
 * handicap showing up in the result IS the finding. Do not special-case those
 * types, do not exclude them, do not add `rookie_year` "just for them".
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD IS MANDATORY AND IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 *
 * For a scored season Y, BOTH the fitted coefficients AND every prior-award
 * count come from seasons strictly less than Y. The first scored season is the
 * second season present in the corpus (2016 has no prior, so it is training
 * data only). 2022's prior set is 2016-2020 — the 2021 gap is real, not an
 * off-by-one. A model fit on all seasons and scored in-sample is not an
 * acceptable answer to this question, and `measureAwardPredictability.test.ts`
 * pins that with a leak test rather than a comment.
 *
 * The ONE thing that is legitimately in-season is the BPR rating: it is a
 * PRE-EVENT rating, snapshotted at the event's first match before the model
 * updates on it, so it is built only from matches that had already been played
 * when the awards were judged. That is past information, not future
 * information, and it is exactly what the plan asks for.
 *
 * ---------------------------------------------------------------------------
 * THE BPR REPLAY DOES NOT TOUCH `runEval`
 * ---------------------------------------------------------------------------
 *
 * `replayPreEventRatings` below is this script's OWN chronological loop. It
 * mirrors `packages/bpr/evaluate.ts`'s `runEval` sequencing exactly — predict
 * strictly before update, every match in the shared total order, no exclusions
 * from the state stream (a surrogate-affected match leaves the SCOREBOARD, not
 * the state) — but `runEval` is a scoring function and this is not scoring
 * matches, so it is mirrored rather than modified. `evaluate.ts` is read-only
 * reference material here.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Reads `data/corpus.sqlite` READ-ONLY and makes no network request, uses no
 * environment variable and touches no credential of any kind. Its
 * `package.json` entry deliberately omits `--env-file`, placing it with the
 * other corpus-only offline scripts. `.env` is never read, printed or
 * interpolated.
 *
 * NOTE: the corpus mutation that feeds this script (`event_awards_all`, quick
 * task 260912-5n8 T1/T2) is gitignored and does NOT travel via git. Any other
 * checkout must run the T2 backfill itself before this script has anything to
 * measure.
 *
 * Usage:
 *   npx tsx scripts/measureAwardPredictability.ts [--json] [--iterations 200]
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import {
  openCorpusReadOnly,
  selectEventAwardsAllForYear,
  selectEventTeamsForEvents,
  type Corpus,
} from "../packages/corpus/db.js";
import { loadMatches } from "../packages/bpr/data.js";
import { BprModel, DEFAULTS, type BprParams } from "../packages/bpr/model.js";
import { isOfficialEventType } from "../packages/core/algorithms/eventTypes.js";

export const CORPUS_PATH = "data/corpus.sqlite";
export const BPR_PARAMS_PATH = "packages/bpr/frozen-params.json";

/**
 * Award types printed in their own REFERENCE-ONLY section: 1 Winner and
 * 2 Finalist. These are the on-field elimination result, they are already the
 * match predictors' domain, they carry 3-4 recipients per instance and they
 * will score high. They are a sanity check that the rig works. Presenting
 * either as the headline judged-award result would be dishonest.
 */
export const REFERENCE_ONLY_AWARD_TYPES: ReadonlySet<number> = new Set([1, 2]);

/**
 * Below this many PRIOR instances of an award type, the conditional logit is
 * not fit at all and the decoration heuristic is used instead, with every row
 * it produced flagged `thin-prior`. Not tuned — a tuned feasibility probe
 * answers a different question.
 */
export const THIN_PRIOR_INSTANCES = 30;

/** f1..f4. Four numbers, two families, nothing else. */
export const FEATURE_COUNT = 4;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One stored `event_awards_all` recipient row, narrowed to what this script reads. */
export interface AwardRowInput {
  readonly eventKey: string;
  readonly awardType: number;
  readonly teamKey: string | null;
  readonly name: string;
  readonly year: number;
}

/** One `events` row, narrowed to what this script reads. */
export interface EventMetaInput {
  readonly eventKey: string;
  readonly year: number;
  readonly eventType: number;
}

/**
 * The unit of prediction: ONE `(event, award_type)` pair for every award
 * actually given at an in-scope event with at least one TEAM recipient.
 *
 * Two awards of the same type at one event (distinct `award_index`) are merged
 * into a single instance whose recipient set is their union — the plan defines
 * the unit as `(event, award_type)`, and splitting them would make the same
 * event-award count twice.
 */
export interface AwardInstance {
  readonly eventKey: string;
  readonly year: number;
  readonly awardType: number;
  readonly name: string;
  /** Team keys only, deduped, ascending by team number. */
  readonly recipients: readonly string[];
}

/** Every exclusion, counted. An unreported exclusion flatters the accuracy. */
export interface InstanceCensus {
  totalRows: number;
  /** Rows on an offseason (99) or preseason (100) event. */
  rowsDroppedOffseasonPreseason: number;
  /** Rows whose event has no `events` row at all. Expected: 0. */
  rowsDroppedUnknownEvent: number;
  /**
   * Rows with `team_key IS NULL` — a person-only recipient. Woodie Flowers,
   * Volunteer and the person half of Dean's List are individual awards and are
   * not team-prediction targets.
   */
  rowsDroppedPersonOnly: number;
  /** `(event, award_type)` groups whose every row was person-only. */
  instancesDroppedNoTeamRecipient: number;
  instancesBuilt: number;
}

const emptyCensus = (): InstanceCensus => ({
  totalRows: 0,
  rowsDroppedOffseasonPreseason: 0,
  rowsDroppedUnknownEvent: 0,
  rowsDroppedPersonOnly: 0,
  instancesDroppedNoTeamRecipient: 0,
  instancesBuilt: 0,
});

/** `frc254` -> 254. Anything unparseable sorts last. */
export function teamNumber(teamKey: string): number {
  const m = /^frc(\d+)$/.exec(teamKey);
  if (m === null) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Ascending team number, then lexicographic on the raw key. Total and stable. */
export function compareTeamKeys(a: string, b: string): number {
  const na = teamNumber(a);
  const nb = teamNumber(b);
  if (na !== nb) return na < nb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Groups raw award rows into scoreable instances, dropping — and COUNTING —
 * offseason/preseason events, person-only recipients, and groups left with no
 * team recipient at all.
 */
export function buildAwardInstances(
  rows: readonly AwardRowInput[],
  eventsByKey: ReadonlyMap<string, EventMetaInput>
): { instances: AwardInstance[]; census: InstanceCensus } {
  const census = emptyCensus();
  interface Group {
    eventKey: string;
    year: number;
    awardType: number;
    name: string;
    teams: Set<string>;
  }
  const groups = new Map<string, Group>();

  for (const row of rows) {
    census.totalRows += 1;
    const meta = eventsByKey.get(row.eventKey);
    if (meta === undefined) {
      census.rowsDroppedUnknownEvent += 1;
      continue;
    }
    if (!isOfficialEventType(meta.eventType)) {
      census.rowsDroppedOffseasonPreseason += 1;
      continue;
    }
    const key = `${row.eventKey}|${row.awardType}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = {
        eventKey: row.eventKey,
        year: meta.year,
        awardType: row.awardType,
        name: row.name,
        teams: new Set<string>(),
      };
      groups.set(key, g);
    }
    if (row.teamKey === null) {
      census.rowsDroppedPersonOnly += 1;
      continue;
    }
    g.teams.add(row.teamKey);
  }

  const instances: AwardInstance[] = [];
  for (const g of groups.values()) {
    if (g.teams.size === 0) {
      census.instancesDroppedNoTeamRecipient += 1;
      continue;
    }
    instances.push({
      eventKey: g.eventKey,
      year: g.year,
      awardType: g.awardType,
      name: g.name,
      recipients: [...g.teams].sort(compareTeamKeys),
    });
  }
  // Deterministic order, independent of Map insertion order.
  instances.sort(
    (a, b) =>
      a.year - b.year ||
      (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0) ||
      a.awardType - b.awardType
  );
  census.instancesBuilt = instances.length;
  return { instances, census };
}

// ---------------------------------------------------------------------------
// Feature family (a): prior award history — PRIOR SEASONS ONLY
// ---------------------------------------------------------------------------

/**
 * Prior-award counts as of the start of `beforeYear`. Built ONLY from
 * instances with `year < beforeYear`; that filter is the leak boundary and is
 * asserted directly by the test suite.
 */
export interface PriorHistory {
  readonly beforeYear: number;
  /** `${teamKey}|${awardType}` -> count of prior wins. */
  readonly typeCount: ReadonlyMap<string, number>;
  /** `${teamKey}|${awardType}` -> most recent prior season won. */
  readonly typeLastYear: ReadonlyMap<string, number>;
  /** teamKey -> count of prior wins of ANY award type. */
  readonly anyCount: ReadonlyMap<string, number>;
  /** awardType -> number of prior INSTANCES of that award type. */
  readonly instancesByType: ReadonlyMap<number, number>;
}

/**
 * The only rows any season-Y feature is allowed to see. Exported separately
 * from `buildPriorHistory` so the leak test can assert on the input set itself
 * rather than only on a derived count.
 */
export function selectPriorInstances(
  instances: readonly AwardInstance[],
  beforeYear: number
): AwardInstance[] {
  return instances.filter((i) => i.year < beforeYear);
}

export function buildPriorHistory(
  instances: readonly AwardInstance[],
  beforeYear: number
): PriorHistory {
  const typeCount = new Map<string, number>();
  const typeLastYear = new Map<string, number>();
  const anyCount = new Map<string, number>();
  const instancesByType = new Map<number, number>();

  for (const inst of selectPriorInstances(instances, beforeYear)) {
    instancesByType.set(inst.awardType, (instancesByType.get(inst.awardType) ?? 0) + 1);
    for (const team of inst.recipients) {
      const k = `${team}|${inst.awardType}`;
      typeCount.set(k, (typeCount.get(k) ?? 0) + 1);
      const last = typeLastYear.get(k);
      if (last === undefined || inst.year > last) typeLastYear.set(k, inst.year);
      anyCount.set(team, (anyCount.get(team) ?? 0) + 1);
    }
  }
  return { beforeYear, typeCount, typeLastYear, anyCount, instancesByType };
}

export function priorTypeCount(h: PriorHistory, team: string, awardType: number): number {
  return h.typeCount.get(`${team}|${awardType}`) ?? 0;
}

export function priorTypeLastYear(h: PriorHistory, team: string, awardType: number): number | null {
  return h.typeLastYear.get(`${team}|${awardType}`) ?? null;
}

export function priorAnyCount(h: PriorHistory, team: string): number {
  return h.anyCount.get(team) ?? 0;
}

export function priorInstancesOfType(h: PriorHistory, awardType: number): number {
  return h.instancesByType.get(awardType) ?? 0;
}

// ---------------------------------------------------------------------------
// Feature family (b): pre-event on-field strength
// ---------------------------------------------------------------------------

/** The subset of `BprMatch` the replay reads. `BprMatch` satisfies it structurally. */
export interface ReplayMatch {
  readonly eventKey: string;
  readonly year: number;
  readonly compLevel: string;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redOut: number;
  readonly blueOut: number;
  readonly redFoul: number;
  readonly blueFoul: number;
  readonly winner: "red" | "blue" | "tie";
}

/**
 * The subset of `BprModel` the replay drives. Structural, so the test suite
 * can pass a recording fake and assert the snapshot lands BEFORE the first
 * update — the single property that makes the strength feature pre-event.
 */
export interface ReplayModel<P> {
  predict(red: readonly string[], blue: readonly string[], year: number, isElim: boolean): P;
  update(
    red: readonly string[],
    blue: readonly string[],
    year: number,
    redOut: number,
    blueOut: number,
    redFoul: number,
    blueFoul: number,
    outcome: number,
    isElim: boolean,
    pred: P
  ): void;
  snapshot(): Map<string, number>;
}

/**
 * One chronological pass over the whole match stream, mirroring
 * `packages/bpr/evaluate.ts`'s `runEval` sequencing: predict strictly before
 * update, every match, no exclusion from the state stream.
 *
 * At the FIRST match of each wanted event — before that match's `update` — the
 * model is snapshotted for that event's candidate teams. The rating is
 * therefore pre-event by construction: every match folded into it was played
 * before this event began.
 *
 * Only the wanted teams are kept, because a full `snapshot()` of every team
 * retained for all ~2,800 events would be a large multiple of the data this
 * script actually consumes. A candidate with no rating yet (never played) is
 * ABSENT from the returned map rather than present with a fabricated default —
 * `buildFeatures` gives it the pool's mean (z = 0, "no information") instead of
 * inventing a strength for it.
 */
export function replayPreEventRatings<P>(
  matches: readonly ReplayMatch[],
  model: ReplayModel<P>,
  wanted: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const seenEvents = new Set<string>();

  for (const m of matches) {
    if (!seenEvents.has(m.eventKey)) {
      seenEvents.add(m.eventKey);
      const want = wanted.get(m.eventKey);
      if (want !== undefined) {
        const snap = model.snapshot();
        const picked = new Map<string, number>();
        for (const team of want) {
          const r = snap.get(team);
          if (r !== undefined) picked.set(team, r);
        }
        out.set(m.eventKey, picked);
      }
    }
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
    model.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      m.redOut,
      m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      pred
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The feature vector: four numbers, two families, nothing else
// ---------------------------------------------------------------------------

/**
 * f1  log1p(prior wins of THIS award type)          — history
 * f2  recency 1/(1 + seasons since last win), 0 if never — history
 * f3  log1p(prior wins of ANY award type)           — history (decoration)
 * f4  pre-event BPR, standardized WITHIN this event's pool — on-field strength
 *
 * f1-f3 are three encodings of the one selected history feature. f4 is
 * standardized within the event so a 2016 rating and a 2026 rating are never
 * compared on a drifting absolute scale. A candidate with no rating gets z = 0
 * — the pool's own mean — which states "no information", not "average team",
 * and is the honest encoding of an unrated candidate under a within-pool
 * standardization.
 *
 * INTERPRETIVE HAZARD, MEASURED — READ THIS BEFORE BELIEVING THE ROOKIE ROWS.
 * A true rookie has no prior awards (f1 = f2 = f3 = 0) AND has never played, so
 * it carries no BPR rating and lands on f4 = 0 as well. Its feature vector is
 * therefore EXACTLY `[0, 0, 0, 0]` — a value no veteran can hold, since any
 * veteran with a rating has a nonzero within-pool z almost surely. The fit can
 * learn negative weights and pick that all-zero vector out, which is an
 * IMPLICIT AGE DETECTOR assembled from the ABSENCE of the two selected
 * features rather than from a third feature.
 *
 * That is why type 10 / 14 / 15 score 12-18% here against baselines of exactly
 * 0.0%: B1 can never pick a rookie (no prior wins) and B2 can never pick one
 * (no rating, ranked last), so those two baselines are structurally pinned at
 * zero and beating them proves nothing. No age feature was added — the plan's
 * prohibition is honoured literally — but the handicap the plan expected to
 * see is NOT what these numbers measure, and they must not be read as "the
 * model predicts rookie awards".
 *
 * Returns one row per candidate, in the order candidates were supplied.
 */
export function buildFeatures(
  candidates: readonly string[],
  awardType: number,
  year: number,
  history: PriorHistory,
  ratings: ReadonlyMap<string, number>
): number[][] {
  const rated: number[] = [];
  for (const team of candidates) {
    const r = ratings.get(team);
    if (r !== undefined && Number.isFinite(r)) rated.push(r);
  }
  let mean = 0;
  let sd = 0;
  if (rated.length > 0) {
    for (const r of rated) mean += r;
    mean /= rated.length;
    let v = 0;
    for (const r of rated) v += (r - mean) ** 2;
    sd = Math.sqrt(v / rated.length);
  }
  const usableSd = sd > 1e-9;

  const out: number[][] = [];
  for (const team of candidates) {
    const nType = priorTypeCount(history, team, awardType);
    const last = priorTypeLastYear(history, team, awardType);
    const nAny = priorAnyCount(history, team);
    const r = ratings.get(team);
    const z = r === undefined || !Number.isFinite(r) || !usableSd ? 0 : (r - mean) / sd;
    out.push([
      Math.log1p(nType),
      last === null ? 0 : 1 / (1 + Math.max(0, year - last)),
      Math.log1p(nAny),
      z,
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The model: a per-award-type conditional logit over the event's pool
// ---------------------------------------------------------------------------

/**
 * One fitting example: the flattened feature matrix of an event's candidate
 * pool plus the indices of the candidates that actually won.
 */
export interface TrainInstance {
  /** Row-major, length `candidateCount * FEATURE_COUNT`. */
  readonly features: readonly number[];
  readonly candidateCount: number;
  /** Indices into the candidate pool. Multi-recipient awards carry several. */
  readonly winnerIdx: readonly number[];
}

export function toTrainInstance(
  features: readonly (readonly number[])[],
  winnerIdx: readonly number[]
): TrainInstance {
  const flat: number[] = [];
  for (const row of features) {
    for (let d = 0; d < FEATURE_COUNT; d += 1) flat.push(row[d] ?? 0);
  }
  return { features: flat, candidateCount: features.length, winnerIdx: [...winnerIdx] };
}

export interface FitOptions {
  iterations?: number;
  learningRate?: number;
  /** Ridge stabilizer, scaled by 1/n. Prevents divergence; NOT a tuned knob. */
  l2?: number;
}

/**
 * Plain gradient ascent on the conditional-logit log-likelihood. The
 * likelihood a MULTI-RECIPIENT award contributes is the MEAN log-probability
 * over its recipients against the one shared pool — each recipient is an
 * equally weighted positive, so a 4-recipient Winner instance does not count
 * four times as much as a 1-recipient judged award.
 *
 * Deliberately not tuned and deliberately not clever: a feasibility probe that
 * needed a tuned optimizer would be answering a different question. Starts at
 * beta = 0 every time, so the fit is a pure function of its training set.
 */
export function fitConditionalLogit(
  train: readonly TrainInstance[],
  opts: FitOptions = {}
): number[] {
  const iterations = opts.iterations ?? 200;
  const lr = opts.learningRate ?? 0.5;
  const l2 = opts.l2 ?? 1;
  const beta = new Array<number>(FEATURE_COUNT).fill(0);

  const usable = train.filter((t) => t.candidateCount >= 2 && t.winnerIdx.length > 0);
  if (usable.length === 0) return beta;

  const grad = new Array<number>(FEATURE_COUNT).fill(0);
  const scale = 1 / usable.length;
  const probs: number[] = [];

  for (let it = 0; it < iterations; it += 1) {
    grad.fill(0);
    for (const inst of usable) {
      const k = inst.candidateCount;
      const f = inst.features;
      probs.length = k;
      let max = Number.NEGATIVE_INFINITY;
      for (let j = 0; j < k; j += 1) {
        let u = 0;
        const base = j * FEATURE_COUNT;
        for (let d = 0; d < FEATURE_COUNT; d += 1) u += (beta[d] ?? 0) * (f[base + d] ?? 0);
        probs[j] = u;
        if (u > max) max = u;
      }
      let sum = 0;
      for (let j = 0; j < k; j += 1) {
        const e = Math.exp((probs[j] ?? 0) - max);
        probs[j] = e;
        sum += e;
      }
      const invSum = sum > 0 ? 1 / sum : 0;
      const invW = 1 / inst.winnerIdx.length;
      for (const wi of inst.winnerIdx) {
        const base = wi * FEATURE_COUNT;
        for (let d = 0; d < FEATURE_COUNT; d += 1) {
          grad[d] = (grad[d] ?? 0) + invW * (f[base + d] ?? 0);
        }
      }
      for (let j = 0; j < k; j += 1) {
        const p = (probs[j] ?? 0) * invSum;
        if (p === 0) continue;
        const base = j * FEATURE_COUNT;
        for (let d = 0; d < FEATURE_COUNT; d += 1) {
          grad[d] = (grad[d] ?? 0) - p * (f[base + d] ?? 0);
        }
      }
    }
    for (let d = 0; d < FEATURE_COUNT; d += 1) {
      const b = beta[d] ?? 0;
      beta[d] = b + lr * ((grad[d] ?? 0) * scale - l2 * scale * b);
    }
  }
  return beta;
}

/** First-wins argmax. Deterministic given a deterministic candidate order. */
export function argmaxIndex(values: readonly number[]): number {
  let best = -1;
  let bestV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? Number.NEGATIVE_INFINITY;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

/** The model's top-1 pick: argmax of x·beta over the pool. */
export function pickByWeights(
  weights: readonly number[],
  features: readonly (readonly number[])[]
): number {
  const u = features.map((row) => {
    let s = 0;
    for (let d = 0; d < FEATURE_COUNT; d += 1) s += (weights[d] ?? 0) * (row[d] ?? 0);
    return s;
  });
  return argmaxIndex(u);
}

// ---------------------------------------------------------------------------
// Baselines. An accuracy with no baseline is not a result.
// ---------------------------------------------------------------------------

/**
 * B0 RANDOM — the expected top-1 of a uniform pick from the pool, which is the
 * share of the POOL that actually won. Recipients that are not in the pool are
 * excluded from the numerator because a uniform pick from the pool cannot
 * select them; using the raw recipient count would hand the random baseline
 * credit for picks it is incapable of making.
 */
export function randomExpectedTop1(poolSize: number, recipientsInPool: number): number {
  return poolSize > 0 ? recipientsInPool / poolSize : 0;
}

/**
 * B1 MOST-DECORATED-TEAM-PRESENT — rank by prior wins of THIS award type, then
 * by prior wins of any type, then ascending team number.
 *
 * Tie-breaking on BPR is FORBIDDEN here. It would silently make B1 a
 * two-feature model and stop it being a baseline at all, and the "does the fit
 * beat either feature alone?" reading would quietly stop meaning anything. The
 * signature takes no ratings argument so the mistake cannot be made.
 */
export function pickMostDecorated(
  candidates: readonly string[],
  awardType: number,
  history: PriorHistory
): number {
  let best = -1;
  let bestType = -1;
  let bestAny = -1;
  let bestNum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const team = candidates[i];
    if (team === undefined) continue;
    const t = priorTypeCount(history, team, awardType);
    const a = priorAnyCount(history, team);
    const n = teamNumber(team);
    if (t > bestType || (t === bestType && (a > bestAny || (a === bestAny && n < bestNum)))) {
      best = i;
      bestType = t;
      bestAny = a;
      bestNum = n;
    }
  }
  return best;
}

/**
 * B2 STRONGEST-TEAM-PRESENT — rank by pre-event BPR alone, ascending team
 * number on ties. A free single-feature ablation: together with B1 it says
 * whether the fit beats either selected feature used by itself. An unrated
 * candidate ranks last rather than being handed a fabricated rating.
 */
export function pickStrongest(
  candidates: readonly string[],
  ratings: ReadonlyMap<string, number>
): number {
  let best = -1;
  let bestR = Number.NEGATIVE_INFINITY;
  let bestNum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const team = candidates[i];
    if (team === undefined) continue;
    const r = ratings.get(team);
    const v = r === undefined || !Number.isFinite(r) ? Number.NEGATIVE_INFINITY : r;
    const n = teamNumber(team);
    if (best === -1 || v > bestR || (v === bestR && n < bestNum)) {
      best = i;
      bestR = v;
      bestNum = n;
    }
  }
  return best;
}

/**
 * TOP-1 SCORING RULE, stated once and applied everywhere:
 *
 *   A predictor emits exactly ONE team from the event's candidate pool. The
 *   prediction is CORRECT if and only if that single team is a member of the
 *   event-award's actual recipient set.
 *
 * Multi-recipient awards (Winner and Finalist carry 3-4 teams) are therefore
 * EASIER than single-recipient ones at equal pool size, which is precisely why
 * they are reported in a separate reference-only section instead of alongside
 * the judged awards.
 */
export function isTop1Hit(
  candidates: readonly string[],
  pickIndex: number,
  recipients: ReadonlySet<string>
): boolean {
  if (pickIndex < 0 || pickIndex >= candidates.length) return false;
  const team = candidates[pickIndex];
  return team !== undefined && recipients.has(team);
}

export function isThinPrior(priorInstanceCount: number): boolean {
  return priorInstanceCount < THIN_PRIOR_INSTANCES;
}

// ---------------------------------------------------------------------------
// The experiment
// ---------------------------------------------------------------------------

export interface Cell {
  n: number;
  poolSum: number;
  recipSum: number;
  modelHits: number;
  b1Hits: number;
  b2Hits: number;
  b0Expected: number;
  /** Instances where NO recipient was in the candidate pool — unhittable. */
  unreachable: number;
  /** Instances scored by the thin-prior decoration fallback rather than a fit. */
  thinPriorRows: number;
}

const emptyCell = (): Cell => ({
  n: 0,
  poolSum: 0,
  recipSum: 0,
  modelHits: 0,
  b1Hits: 0,
  b2Hits: 0,
  b0Expected: 0,
  unreachable: 0,
  thinPriorRows: 0,
});

export interface AwardTypeReport {
  awardType: number;
  name: string;
  pooled: Cell;
  perSeason: Map<number, Cell>;
}

export interface ExperimentReport {
  command: string;
  census: InstanceCensus;
  /** Instances whose candidate pool was empty; excluded and counted. */
  instancesDroppedEmptyPool: number;
  /** Seasons present in the award data, ascending. */
  seasons: number[];
  /** Seasons actually scored — every season except the first (no prior). */
  scoredSeasons: number[];
  byType: AwardTypeReport[];
  fitIterations: number;
}

/** `acc(cell)` helpers, so the printer and the JSON never disagree. */
export function cellAccuracy(c: Cell, which: "model" | "b1" | "b2"): number {
  if (c.n === 0) return 0;
  const hits = which === "model" ? c.modelHits : which === "b1" ? c.b1Hits : c.b2Hits;
  return hits / c.n;
}

export function cellRandom(c: Cell): number {
  return c.n === 0 ? 0 : c.b0Expected / c.n;
}

/**
 * The pre-committed verdict rule, written down before any number was seen: an
 * award type counts as PREDICTABLE only if the model's pooled top-1 beats BOTH
 * B1 and B2 with pooled n >= 30. Anything else is "not demonstrated" — not
 * "promising", not "directionally positive".
 */
export function isPredictable(c: Cell): boolean {
  return (
    c.n >= THIN_PRIOR_INSTANCES &&
    cellAccuracy(c, "model") > cellAccuracy(c, "b1") &&
    cellAccuracy(c, "model") > cellAccuracy(c, "b2")
  );
}

/**
 * How far the model beat its BEST baseline, in percentage points. The verdict
 * rule is a STRICT INEQUALITY with no margin, so a type can pass it on a 0.1pp
 * gap that is pure optimizer noise.
 *
 * Measured 2026-09-12: raising `--iterations` from 200 to 1500 moved every
 * pooled accuracy by at most 0.6pp — the fit is converged — but that was still
 * enough to FLIP two verdicts (type 27 Imagery in, type 17 Quality out). This
 * number is printed beside every PREDICTABLE line so a sub-1pp "win" cannot be
 * read as a result. Anything under about 1pp here is a coin flip, not a
 * finding, whichever side of the inequality it happens to land on.
 */
export function verdictMarginPp(c: Cell): number {
  return 100 * (cellAccuracy(c, "model") - Math.max(cellAccuracy(c, "b1"), cellAccuracy(c, "b2")));
}

/** Below this margin, a PREDICTABLE verdict is optimizer noise and says so in the output. */
export const NOISE_MARGIN_PP = 1;

function addCell(target: Cell, poolSize: number, recipInPool: number, recipTotal: number): void {
  target.n += 1;
  target.poolSum += poolSize;
  target.recipSum += recipTotal;
  target.b0Expected += randomExpectedTop1(poolSize, recipInPool);
  if (recipInPool === 0) target.unreachable += 1;
}

interface PreparedInstance {
  readonly instance: AwardInstance;
  readonly candidates: readonly string[];
  readonly recipientSet: ReadonlySet<string>;
  readonly recipientsInPool: number;
  readonly features: number[][];
  readonly ratings: ReadonlyMap<string, number>;
  readonly history: PriorHistory;
  readonly train: TrainInstance;
}

/**
 * Runs the whole walk-forward experiment over already-loaded inputs. Kept free
 * of any database handle so the corpus read and the measurement stay separable.
 */
export function runExperiment(input: {
  instances: readonly AwardInstance[];
  census: InstanceCensus;
  poolsByEvent: ReadonlyMap<string, readonly string[]>;
  ratingsByEvent: ReadonlyMap<string, ReadonlyMap<string, number>>;
  awardNames: ReadonlyMap<number, string>;
  command: string;
  fitIterations?: number;
}): ExperimentReport {
  const fitIterations = input.fitIterations ?? 200;
  const seasons = [...new Set(input.instances.map((i) => i.year))].sort((a, b) => a - b);
  const scoredSeasons = seasons.slice(1);

  // One history per season, built strictly from earlier seasons. The map is
  // keyed by the season the history is FOR, and `beforeYear` is carried inside
  // the object so a misuse is visible rather than silent.
  const historyBefore = new Map<number, PriorHistory>();
  for (const y of seasons) historyBefore.set(y, buildPriorHistory(input.instances, y));

  // Every instance's feature matrix is built against the history of its OWN
  // season — never the scored season's — so one precomputation serves both
  // roles (training example in every later season, scored row in its own) and
  // no feature can drift between the two.
  const prepared: PreparedInstance[] = [];
  let instancesDroppedEmptyPool = 0;
  for (const instance of input.instances) {
    const candidates = input.poolsByEvent.get(instance.eventKey) ?? [];
    if (candidates.length === 0) {
      instancesDroppedEmptyPool += 1;
      continue;
    }
    const history = historyBefore.get(instance.year);
    if (history === undefined) continue;
    const ratings = input.ratingsByEvent.get(instance.eventKey) ?? new Map<string, number>();
    const features = buildFeatures(candidates, instance.awardType, instance.year, history, ratings);
    const recipientSet = new Set(instance.recipients);
    const winnerIdx: number[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const team = candidates[i];
      if (team !== undefined && recipientSet.has(team)) winnerIdx.push(i);
    }
    prepared.push({
      instance,
      candidates,
      recipientSet,
      recipientsInPool: winnerIdx.length,
      features,
      ratings,
      history,
      train: toTrainInstance(features, winnerIdx),
    });
  }

  const byTypeSeason = new Map<number, PreparedInstance[]>();
  for (const p of prepared) {
    const list = byTypeSeason.get(p.instance.awardType);
    if (list === undefined) byTypeSeason.set(p.instance.awardType, [p]);
    else list.push(p);
  }

  const reports = new Map<number, AwardTypeReport>();
  for (const [awardType, list] of byTypeSeason) {
    const first = list[0];
    reports.set(awardType, {
      awardType,
      name: input.awardNames.get(awardType) ?? first?.instance.name ?? `type ${awardType}`,
      pooled: emptyCell(),
      perSeason: new Map<number, Cell>(),
    });
  }

  for (const season of scoredSeasons) {
    for (const [awardType, list] of byTypeSeason) {
      const scored = list.filter((p) => p.instance.year === season);
      if (scored.length === 0) continue;
      const report = reports.get(awardType);
      if (report === undefined) continue;

      const trainPool = list.filter((p) => p.instance.year < season);
      const priorInstances = trainPool.length;
      const thin = isThinPrior(priorInstances);
      const weights = thin
        ? null
        : fitConditionalLogit(
            trainPool.map((p) => p.train),
            { iterations: fitIterations }
          );

      let cell = report.perSeason.get(season);
      if (cell === undefined) {
        cell = emptyCell();
        report.perSeason.set(season, cell);
      }

      for (const p of scored) {
        // THIN-PRIOR FALLBACK: below 30 prior instances the conditional logit
        // is not fit at all and the decoration heuristic stands in. Every row
        // it produced is flagged, because a "model" number that is really B1
        // wearing the model's name would make the comparison meaningless.
        const modelPick =
          weights === null
            ? pickMostDecorated(p.candidates, awardType, p.history)
            : pickByWeights(weights, p.features);
        const b1Pick = pickMostDecorated(p.candidates, awardType, p.history);
        const b2Pick = pickStrongest(p.candidates, p.ratings);

        for (const target of [cell, report.pooled]) {
          addCell(target, p.candidates.length, p.recipientsInPool, p.instance.recipients.length);
          if (isTop1Hit(p.candidates, modelPick, p.recipientSet)) target.modelHits += 1;
          if (isTop1Hit(p.candidates, b1Pick, p.recipientSet)) target.b1Hits += 1;
          if (isTop1Hit(p.candidates, b2Pick, p.recipientSet)) target.b2Hits += 1;
          if (thin) target.thinPriorRows += 1;
        }
      }
    }
  }

  const byType = [...reports.values()]
    .filter((r) => r.pooled.n > 0)
    .sort((a, b) => b.pooled.n - a.pooled.n || a.awardType - b.awardType);

  return {
    command: input.command,
    census: input.census,
    instancesDroppedEmptyPool,
    seasons,
    scoredSeasons,
    byType,
    fitIterations,
  };
}

// ---------------------------------------------------------------------------
// Corpus read
// ---------------------------------------------------------------------------

interface EventRow {
  event_key: string;
  year: number;
  event_type: number;
}

interface YearRow {
  year: number;
}

export function loadEventMeta(db: Corpus): Map<string, EventMetaInput> {
  const rows = db
    .prepare(`SELECT event_key, year, event_type FROM events`)
    .all() as EventRow[];
  const out = new Map<string, EventMetaInput>();
  for (const r of rows) {
    out.set(r.event_key, { eventKey: r.event_key, year: r.year, eventType: r.event_type });
  }
  return out;
}

export function loadAwardRows(db: Corpus): AwardRowInput[] {
  const years = (
    db.prepare(`SELECT DISTINCT year FROM event_awards_all ORDER BY year ASC`).all() as YearRow[]
  ).map((r) => r.year);
  const out: AwardRowInput[] = [];
  for (const year of years) {
    for (const row of selectEventAwardsAllForYear(db, year)) {
      out.push({
        eventKey: row.eventKey,
        awardType: row.awardType,
        teamKey: row.teamKey,
        name: row.name,
        year: row.year,
      });
    }
  }
  return out;
}

/** The most common human name seen for each award type, for the report's label column. */
export function modalAwardNames(rows: readonly AwardRowInput[]): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  for (const r of rows) {
    let m = counts.get(r.awardType);
    if (m === undefined) {
      m = new Map<string, number>();
      counts.set(r.awardType, m);
    }
    m.set(r.name, (m.get(r.name) ?? 0) + 1);
  }
  const out = new Map<number, string>();
  for (const [type, m] of counts) {
    let best = "";
    let bestN = -1;
    for (const [name, n] of [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (n > bestN) {
        best = name;
        bestN = n;
      }
    }
    out.set(type, best);
  }
  return out;
}

/**
 * CANDIDATE POOL = the event's `event_teams` roster UNION every team appearing
 * in that event's matches. The union rather than either alone: a roster can be
 * missing for an older event, and a team can be on a roster without ever
 * playing (withdrawn, or awards-only attendance).
 */
export function buildCandidatePools(
  eventKeys: readonly string[],
  rosters: ReadonlyMap<string, readonly string[]>,
  matches: readonly ReplayMatch[]
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const key of eventKeys) sets.set(key, new Set<string>());
  for (const key of eventKeys) {
    const roster = rosters.get(key);
    if (roster === undefined) continue;
    const s = sets.get(key);
    if (s === undefined) continue;
    for (const team of roster) s.add(team);
  }
  for (const m of matches) {
    const s = sets.get(m.eventKey);
    if (s === undefined) continue;
    for (const t of m.redTeams) s.add(t);
    for (const t of m.blueTeams) s.add(t);
  }
  const out = new Map<string, string[]>();
  for (const [key, s] of sets) out.set(key, [...s].sort(compareTeamKeys));
  return out;
}

export function loadBprParams(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

function cellLine(label: string, c: Cell, pooled: boolean): string {
  const flags: string[] = [];
  if (pooled && c.n < THIN_PRIOR_INSTANCES) flags.push("THIN-n");
  if (c.thinPriorRows > 0) flags.push(`thin-prior:${c.thinPriorRows}`);
  if (pooled && isPredictable(c)) flags.push("PREDICTABLE");
  return (
    `    ${label.padEnd(8)}${String(c.n).padStart(6)}` +
    `${(c.poolSum / Math.max(1, c.n)).toFixed(1).padStart(7)}` +
    `${(c.recipSum / Math.max(1, c.n)).toFixed(2).padStart(7)}` +
    `${pct(cellAccuracy(c, "model")).padStart(9)}` +
    `${pct(cellRandom(c)).padStart(8)}` +
    `${pct(cellAccuracy(c, "b1")).padStart(8)}` +
    `${pct(cellAccuracy(c, "b2")).padStart(8)}` +
    `${String(c.unreachable).padStart(8)}  ` +
    flags.join(" ")
  );
}

const HEADER =
  "    season       n   pool  recip    model      B0      B1      B2  unreach  flags";

function printTypeBlock(r: AwardTypeReport): string[] {
  const lines: string[] = [];
  lines.push(`  type ${String(r.awardType).padStart(3)}  ${r.name}`);
  lines.push(HEADER);
  for (const season of [...r.perSeason.keys()].sort((a, b) => a - b)) {
    const c = r.perSeason.get(season);
    if (c === undefined) continue;
    lines.push(cellLine(String(season), c, false));
  }
  lines.push(cellLine("POOLED", r.pooled, true));
  lines.push("");
  return lines;
}

export function formatReport(report: ExperimentReport): string {
  const lines: string[] = [];
  lines.push("AWARD PREDICTABILITY — walk-forward top-1, two feature families only");
  lines.push(`  ${report.command}`);
  lines.push("");
  lines.push("Features: f1 log1p(prior wins of this type), f2 recency of last win of this type,");
  lines.push("          f3 log1p(prior wins of any type), f4 pre-event BPR z-scored within pool.");
  lines.push("Walk-forward: season Y's fit and every prior count come from seasons < Y only.");
  lines.push(
    `Verdict rule (pre-committed): PREDICTABLE = pooled model beats BOTH B1 and B2 with n >= ${THIN_PRIOR_INSTANCES}.`
  );
  lines.push("Top-1 rule: one predicted team; correct iff it is in the actual recipient set.");
  lines.push("");
  lines.push("Census");
  lines.push(`  award rows read:                       ${report.census.totalRows}`);
  lines.push(`  rows dropped — offseason/preseason:    ${report.census.rowsDroppedOffseasonPreseason}`);
  lines.push(`  rows dropped — unknown event:          ${report.census.rowsDroppedUnknownEvent}`);
  lines.push(`  rows dropped — person-only recipient:  ${report.census.rowsDroppedPersonOnly}`);
  lines.push(`  instances dropped — no team recipient: ${report.census.instancesDroppedNoTeamRecipient}`);
  lines.push(`  instances dropped — empty pool:        ${report.instancesDroppedEmptyPool}`);
  lines.push(`  instances built:                       ${report.census.instancesBuilt}`);
  lines.push(`  seasons present:                       ${report.seasons.join(", ")}`);
  lines.push(
    `  seasons scored:                        ${report.scoredSeasons.join(", ")}  (first season is prior-only)`
  );
  lines.push(`  gradient-ascent iterations per fit:     ${report.fitIterations}`);
  lines.push("");

  const judged = report.byType.filter((r) => !REFERENCE_ONLY_AWARD_TYPES.has(r.awardType));
  const reference = report.byType.filter((r) => REFERENCE_ONLY_AWARD_TYPES.has(r.awardType));

  lines.push("===========================================================================");
  lines.push("JUDGED AWARDS");
  lines.push("===========================================================================");
  lines.push("");
  for (const r of judged) lines.push(...printTypeBlock(r));

  lines.push("===========================================================================");
  lines.push("REFERENCE ONLY — Winner (1) and Finalist (2)");
  lines.push("");
  lines.push("These are the on-field elimination result and already the match predictors'");
  lines.push("domain. They carry 3-4 recipients per instance and they score high. They are");
  lines.push("a sanity check that the rig works, NOT a judged-award claim.");
  lines.push("===========================================================================");
  lines.push("");
  for (const r of reference) lines.push(...printTypeBlock(r));

  const verdict = judged.filter((r) => isPredictable(r.pooled));
  lines.push("===========================================================================");
  lines.push("VERDICT (judged awards only, pre-committed rule)");
  lines.push("===========================================================================");
  if (verdict.length === 0) {
    lines.push("  NOT DEMONSTRATED for every judged award type.");
  } else {
    for (const r of verdict) {
      const margin = verdictMarginPp(r.pooled);
      const noise = margin < NOISE_MARGIN_PP ? "  <-- MARGIN IS NOISE" : "";
      lines.push(
        `  PREDICTABLE  type ${r.awardType} ${r.name}: model ${pct(cellAccuracy(r.pooled, "model"))} ` +
          `vs B1 ${pct(cellAccuracy(r.pooled, "b1"))} / B2 ${pct(cellAccuracy(r.pooled, "b2"))} ` +
          `/ B0 ${pct(cellRandom(r.pooled))} on n=${r.pooled.n}, margin ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}pp${noise}`
      );
    }
    lines.push("");
    lines.push(
      `  Every other judged type is NOT DEMONSTRATED — not "promising", not "directionally positive".`
    );
  }
  lines.push("");
  lines.push(
    `  A margin under ${NOISE_MARGIN_PP.toFixed(1)}pp is OPTIMIZER NOISE, not a result. Raising --iterations`
  );
  lines.push("  from 200 to 1500 moves pooled accuracy by at most 0.6pp (the fit is converged) and");
  lines.push("  that is still enough to flip any verdict sitting inside that band, in either direction.");
  lines.push("");
  lines.push("  Rookie All Star (10), Rookie Inspiration (15) and Highest Rookie Seed (14) are");
  lines.push("  HANDICAPPED BY DESIGN: no team-age feature was selected. Their numbers are reported");
  lines.push("  with the handicap named and are not retried with an age feature.");
  lines.push("");
  lines.push("  But do NOT read their PREDICTABLE verdicts as a result. Both baselines are");
  lines.push("  STRUCTURALLY PINNED AT 0.0% there — B1 cannot pick a team with no prior wins, and");
  lines.push("  B2 cannot pick a team with no rating — so beating them proves nothing. What the fit");
  lines.push("  found is the all-zero feature vector that only a never-played, never-decorated team");
  lines.push("  can hold: an age detector assembled from the ABSENCE of the two selected features.");
  lines.push("  See `buildFeatures`' interpretive-hazard note.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const emitJson = args.includes("--json");
  const iterIdx = args.indexOf("--iterations");
  const fitIterations = iterIdx >= 0 ? Number.parseInt(args[iterIdx + 1] ?? "200", 10) : 200;
  const command = `npx tsx scripts/measureAwardPredictability.ts${emitJson ? " --json" : ""}`;

  const db = openCorpusReadOnly(CORPUS_PATH);
  let report: ExperimentReport;
  try {
    const eventsByKey = loadEventMeta(db);
    const rows = loadAwardRows(db);
    const awardNames = modalAwardNames(rows);
    const { instances, census } = buildAwardInstances(rows, eventsByKey);

    const eventKeys = [...new Set(instances.map((i) => i.eventKey))].sort();
    const rosters = selectEventTeamsForEvents(db, eventKeys);

    // ONE match load, used for both the candidate pool and the BPR replay, so
    // the pool and the rating can never be built from two different populations.
    const matches = loadMatches(CORPUS_PATH);
    const poolsByEvent = buildCandidatePools(eventKeys, rosters, matches);

    const wanted = new Map<string, ReadonlySet<string>>();
    for (const [key, pool] of poolsByEvent) wanted.set(key, new Set(pool));

    const model = new BprModel(loadBprParams(BPR_PARAMS_PATH));
    const ratingsByEvent = replayPreEventRatings(matches, model, wanted);

    report = runExperiment({
      instances,
      census,
      poolsByEvent,
      ratingsByEvent,
      awardNames,
      command,
      fitIterations,
    });
  } finally {
    db.close();
  }

  console.log(formatReport(report));
  if (emitJson) {
    console.log(
      `\n${JSON.stringify(
        {
          ...report,
          byType: report.byType.map((r) => ({
            awardType: r.awardType,
            name: r.name,
            pooled: r.pooled,
            perSeason: Object.fromEntries(r.perSeason),
          })),
        },
        null,
        2
      )}`
    );
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (err) {
    console.error(
      "measureAwardPredictability failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }
}
