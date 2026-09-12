/**
 * Can FRC awards be predicted, and at what accuracy? (quick task 260912-5n8 T3)
 *
 * A FEASIBILITY PROBE, not a model and not a shipped surface. The deliverable
 * is a table of measured top-1 accuracies next to their baselines. Nothing here
 * is promoted, nothing renders, nothing is tuned.
 *
 * ---------------------------------------------------------------------------
 * TWO ARMS, RUN IN ONE PASS, PRINTED SIDE BY SIDE (quick task 260912-7bp)
 * ---------------------------------------------------------------------------
 *
 * The NO-AGE ARM is 5n8's original four features, unchanged — same encodings,
 * same fit, same defaults — over exactly two families:
 *
 *   (a) PRIOR AWARD HISTORY — how often and how recently this team has won
 *       this award before, plus how decorated it is overall. PRIOR SEASONS
 *       ONLY.
 *   (b) PRE-EVENT ON-FIELD STRENGTH — the team's BPR rating going into the
 *       event.
 *
 * The AGE ARM adds ONE further family and nothing else:
 *
 *   (c) TEAM AGE AS OF THE EVENT'S SEASON — `eventYear - rookie_year`, as
 *       `isRookie`, `log1p(age)` and an explicit `ageKnown` flag.
 *
 * Event context (week / district / country) remains DELIBERATELY NOT SELECTED
 * and must not be smuggled in. The deliverable of this script is the DELTA
 * between the two arms per award type, which is why the no-age arm is kept
 * intact rather than "upgraded": a new absolute number with nothing to subtract
 * from answers a different question.
 *
 * ---------------------------------------------------------------------------
 * THE ROOKIE-AWARD ARTIFACT, AND THE BASELINES THAT KILL IT
 * ---------------------------------------------------------------------------
 *
 * In 5n8 the three rookie award types (10 Rookie All Star, 14 Highest Rookie
 * Seed, 15 Rookie Inspiration) showed large apparent model wins. All three were
 * ARTIFACTS: B1 cannot pick a team with no prior wins and B2 cannot pick a team
 * with no rating, so BOTH baselines are STRUCTURALLY PINNED at exactly 0.0%
 * there and beating them proves nothing.
 *
 * Handing the model an explicit age feature while leaving those baselines at
 * zero would repeat the identical fallacy in reverse and manufacture a much
 * LARGER fake win. So the age feature never ships alone: RB1
 * (`pickMostDecoratedRookie`) and RB2 (`pickStrongestRookie`) land beside it,
 * and the pre-committed verdict rule is "beats the BEST of B1, B2, RB1, RB2"
 * — applied to BOTH arms, so one rule scores both and the comparison means
 * something. A rookie award can no longer be won against a structural zero.
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

/** f1..f4. The NO-AGE arm: four numbers, two families, nothing else. */
export const FEATURE_COUNT = 4;

/** f1..f7. The AGE arm: the same four, plus the three age numbers. */
export const AGE_FEATURE_COUNT = 7;

/**
 * The cutoffs `recall@k` is reported at (quick task 260912-i13).
 *
 * `k = 1` is not decoration: because an unreachable or abstaining instance stays
 * in the recall denominator and scores 0, `recall@1` is BY CONSTRUCTION identical
 * to the top-1 accuracy the same predictor already reported. That identity is the
 * control for the whole ranking extension — it is asserted as a test, and if it
 * ever fails the ranking work has moved the fit and nothing downstream is
 * trustworthy.
 */
export const K_VALUES = [1, 3, 5, 10] as const;

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
 * That is why type 10 / 14 / 15 scored 12-18% in 5n8 against baselines of
 * exactly 0.0%: B1 can never pick a rookie (no prior wins) and B2 can never
 * pick one (no rating, ranked last), so those two baselines are structurally
 * pinned at zero and beating them proves nothing.
 *
 * 260912-7bp does NOT fix that by deleting the hazard — this function is
 * unchanged. It fixes it by adding baselines that are NOT pinned at zero
 * (`pickMostDecoratedRookie`, `pickStrongestRookie`) and scoring both arms
 * against the best of all four. The all-zero vector is still findable; it just
 * no longer wins by default.
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
// Feature family (c): team age AS OF THE EVENT'S SEASON (quick task 260912-7bp)
// ---------------------------------------------------------------------------

/**
 * Age in seasons at the time of the event: `eventYear - rookieYear`, clamped at
 * zero.
 *
 * RELATIVE TO THE EVENT'S SEASON, NEVER ABSOLUTE. A 2019 event and a 2026 event
 * must see different ages for the same team, and a feature built from the
 * team's age *today* would be a look-ahead dressed as a constant.
 *
 * Returns `null` — not 0, and not a guess — when the rookie year is unknown.
 * `null` is the input that makes `ageKnown` false downstream; conflating it
 * with 0 would encode every unknown team as a rookie, which is the single most
 * dangerous error available here.
 *
 * The clamp at 0 exists for data errors only (a rookie year after the event's
 * season). A negative age would otherwise produce `log1p` of a negative number
 * — `NaN` for age < -1 — and silently poison the whole fit.
 */
export function teamAge(
  rookieYear: number | null | undefined,
  eventYear: number
): number | null {
  if (rookieYear === null || rookieYear === undefined || !Number.isFinite(rookieYear)) return null;
  return Math.max(0, eventYear - rookieYear);
}

/**
 * f5  isRookie   — 1 if the age is KNOWN and equals 0, else 0
 * f6  log1p(age) — monotone veteran-ness, compressed so a 30-year veteran does
 *                  not dominate a 5-year one by six times
 * f7  ageKnown   — 1 if `rookie_year` is non-null, else 0
 *
 * THE THREE ENCODINGS ARE MUTUALLY DISAMBIGUATING, WHICH IS THE WHOLE POINT:
 *
 *   unknown age       -> [0, 0,       0]
 *   known rookie      -> [1, 0,       1]
 *   known 1-year-old  -> [0, log 2,   1]
 *
 * `f7` is not decoration. Without it, an unknown-age team and a known rookie
 * would BOTH read `[0, 0]` on f5/f6 in every respect the fit can see except the
 * one that matters, and the unknowns would inflate exactly the rookie rows this
 * task exists to de-flatter.
 */
export function ageFeatureTriple(age: number | null): [number, number, number] {
  if (age === null) return [0, 0, 0];
  return [age === 0 ? 1 : 0, Math.log1p(age), 1];
}

/**
 * The AGE ARM's seven-number vector: `buildFeatures`' four, then f5-f7.
 *
 * Built by CALLING `buildFeatures` rather than by reimplementing it, so the two
 * arms can never drift apart on f1-f4 — the delta between them is this script's
 * deliverable, and it is only meaningful if the shared prefix is bit-identical.
 *
 * `rookieYears` holds ONLY teams whose `rookie_year` is non-null; an absent key
 * means "unknown", never "rookie".
 */
export function buildAgeFeatures(
  candidates: readonly string[],
  awardType: number,
  year: number,
  history: PriorHistory,
  ratings: ReadonlyMap<string, number>,
  rookieYears: ReadonlyMap<string, number>
): number[][] {
  const base = buildFeatures(candidates, awardType, year, history, ratings);
  const out: number[][] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const team = candidates[i];
    const row = base[i] ?? [0, 0, 0, 0];
    const age = teamAge(team === undefined ? null : rookieYears.get(team), year);
    out.push([...row, ...ageFeatureTriple(age)]);
  }
  return out;
}

/** Fraction of the candidate pool whose `rookie_year` is known. */
export function knownAgeFraction(
  candidates: readonly string[],
  rookieYears: ReadonlyMap<string, number>
): number {
  if (candidates.length === 0) return 0;
  let known = 0;
  for (const team of candidates) if (rookieYears.get(team) !== undefined) known += 1;
  return known / candidates.length;
}

// ---------------------------------------------------------------------------
// The model: a per-award-type conditional logit over the event's pool
// ---------------------------------------------------------------------------

/**
 * One fitting example: the flattened feature matrix of an event's candidate
 * pool plus the indices of the candidates that actually won.
 */
export interface TrainInstance {
  /** Row-major, length `candidateCount * featureCount`. */
  readonly features: readonly number[];
  readonly candidateCount: number;
  /**
   * Width of one row: 4 in the no-age arm, 7 in the age arm.
   *
   * Carried ON THE INSTANCE rather than read from a module constant, because
   * both arms are now fit in the SAME pass. A module-level width would make it
   * possible for one arm's fit to silently read the other's dimension and
   * truncate or zero-pad its features without failing — which would look like a
   * measured result and be none.
   */
  readonly featureCount: number;
  /** Indices into the candidate pool. Multi-recipient awards carry several. */
  readonly winnerIdx: readonly number[];
}

export function toTrainInstance(
  features: readonly (readonly number[])[],
  winnerIdx: readonly number[]
): TrainInstance {
  const featureCount = features[0]?.length ?? FEATURE_COUNT;
  const flat: number[] = [];
  for (const row of features) {
    for (let d = 0; d < featureCount; d += 1) flat.push(row[d] ?? 0);
  }
  return {
    features: flat,
    candidateCount: features.length,
    featureCount,
    winnerIdx: [...winnerIdx],
  };
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
  // The width comes from the training set itself, so the no-age and age arms
  // can be fit by the same function in the same pass. Mixing widths in one
  // training set is a programming error, not a data condition, so it THROWS
  // rather than quietly fitting the narrower of the two.
  const featureCount = train[0]?.featureCount ?? FEATURE_COUNT;
  for (const t of train) {
    if (t.featureCount !== featureCount) {
      throw new Error(
        `fitConditionalLogit: mixed feature widths (${featureCount} vs ${t.featureCount}) — ` +
          `the no-age and age arms must never share a training set`
      );
    }
  }
  const beta = new Array<number>(featureCount).fill(0);

  const usable = train.filter((t) => t.candidateCount >= 2 && t.winnerIdx.length > 0);
  if (usable.length === 0) return beta;

  const grad = new Array<number>(featureCount).fill(0);
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
        const base = j * featureCount;
        for (let d = 0; d < featureCount; d += 1) u += (beta[d] ?? 0) * (f[base + d] ?? 0);
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
        const base = wi * featureCount;
        for (let d = 0; d < featureCount; d += 1) {
          grad[d] = (grad[d] ?? 0) + invW * (f[base + d] ?? 0);
        }
      }
      for (let j = 0; j < k; j += 1) {
        const p = (probs[j] ?? 0) * invSum;
        if (p === 0) continue;
        const base = j * featureCount;
        for (let d = 0; d < featureCount; d += 1) {
          grad[d] = (grad[d] ?? 0) - p * (f[base + d] ?? 0);
        }
      }
    }
    for (let d = 0; d < featureCount; d += 1) {
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

/**
 * The model's UTILITY VECTOR: `u_i = x_i · beta` for EVERY candidate in the
 * pool (quick task 260912-i13).
 *
 * This loop is 5n8's, lifted verbatim out of `pickByWeights` rather than
 * written beside it. That is the structural point: `pickByWeights` is now
 * DEFINED as the argmax of this vector, so the ranking and the top-1 pick
 * cannot disagree — the k=1 control reproduces the existing accuracy
 * mechanically rather than by assertion.
 *
 * The dot product runs over `weights.length`, not a module constant, so the
 * same function scores a 4-wide no-age vector and a 7-wide age vector without
 * either arm being able to read the other's width.
 */
export function scoreByWeights(
  weights: readonly number[],
  features: readonly (readonly number[])[]
): number[] {
  return features.map((row) => {
    let s = 0;
    for (let d = 0; d < weights.length; d += 1) s += (weights[d] ?? 0) * (row[d] ?? 0);
    return s;
  });
}

/**
 * The model's top-1 pick: argmax of x·beta over the pool. Derived from
 * `scoreByWeights`, never computed separately.
 */
export function pickByWeights(
  weights: readonly number[],
  features: readonly (readonly number[])[]
): number {
  return argmaxIndex(scoreByWeights(weights, features));
}

// ---------------------------------------------------------------------------
// Orderings: the ranking that was already being computed and thrown away
// ---------------------------------------------------------------------------

/** NaN is not an ordering position. It sorts with the unrated, at the bottom. */
function orderable(x: number | undefined): number {
  return x === undefined || Number.isNaN(x) ? Number.NEGATIVE_INFINITY : x;
}

/**
 * Candidate indices sorted by `(value desc, candidate index asc)`.
 *
 * That second key is the SAME total order `argmaxIndex`'s first-wins tie-break
 * already implies, which is what makes `rank(i) === 1` equivalent to
 * "`argmaxIndex` returned `i`" for any vector of finite utilities. The
 * comparison is written as `a > b ? -1 : 1` rather than `b - a` so two
 * `-Infinity` entries compare EQUAL and fall through to the index key instead
 * of producing `NaN`.
 */
export function orderByScores(values: readonly number[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < values.length; i += 1) idx.push(i);
  idx.sort((a, b) => {
    const va = orderable(values[a]);
    const vb = orderable(values[b]);
    if (va !== vb) return va > vb ? -1 : 1;
    return a - b;
  });
  return idx;
}

/** 1-based rank by position in the ordering. Absent index = not ranked at all. */
export function ranksFromOrder(order: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let pos = 0; pos < order.length; pos += 1) {
    const i = order[pos];
    if (i !== undefined && !out.has(i)) out.set(i, pos + 1);
  }
  return out;
}

/**
 * THE WINNER'S RANK UNDER AN ORDERING = the BEST (minimum) rank among the
 * recipients that appear in it. `null` when no recipient appears at all.
 *
 * Winner and Finalist carry 3-4 recipients, so "the winner's rank" is otherwise
 * ambiguous. The minimum is the natural choice and it is also the GENEROUS one:
 * `recall@k` is MECHANICALLY INFLATED for a multi-recipient award, because more
 * recipients means more chances to land inside k. That is one more reason types
 * 1 and 2 stay in the reference-only section and headline nothing.
 */
export function winnerRank(
  order: readonly number[],
  candidates: readonly string[],
  recipients: ReadonlySet<string>
): number | null {
  for (let pos = 0; pos < order.length; pos += 1) {
    const i = order[pos];
    if (i === undefined) continue;
    const team = candidates[i];
    if (team !== undefined && recipients.has(team)) return pos + 1;
  }
  return null;
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
export function orderMostDecorated(
  candidates: readonly string[],
  awardType: number,
  history: PriorHistory
): number[] {
  const idx: number[] = [];
  for (let i = 0; i < candidates.length; i += 1) if (candidates[i] !== undefined) idx.push(i);
  idx.sort((a, b) => compareDecoration(candidates, awardType, history, a, b));
  return idx;
}

/**
 * The comparator `pickMostDecorated` has always implemented — prior wins of
 * THIS type desc, prior wins of ANY type desc, team number asc — plus
 * CANDIDATE INDEX asc as a final key.
 *
 * That last key is not cosmetic. `teamNumber` returns `+Infinity` for an
 * unparseable key, so two unparseable keys TIE under `compareTeamKeys`' numeric
 * half; without an index key the ordering would not be total and the sort's
 * behaviour on those two would be an implementation detail rather than a
 * defined one.
 */
function compareDecoration(
  candidates: readonly string[],
  awardType: number,
  history: PriorHistory,
  a: number,
  b: number
): number {
  const ta = candidates[a] ?? "";
  const tb = candidates[b] ?? "";
  const ca = priorTypeCount(history, ta, awardType);
  const cb = priorTypeCount(history, tb, awardType);
  if (ca !== cb) return cb - ca;
  const aa = priorAnyCount(history, ta);
  const ab = priorAnyCount(history, tb);
  if (aa !== ab) return ab - aa;
  const na = teamNumber(ta);
  const nb = teamNumber(tb);
  if (na !== nb) return na < nb ? -1 : 1;
  return a - b;
}

export function pickMostDecorated(
  candidates: readonly string[],
  awardType: number,
  history: PriorHistory
): number {
  return orderMostDecorated(candidates, awardType, history)[0] ?? -1;
}

/**
 * B2 STRONGEST-TEAM-PRESENT — rank by pre-event BPR alone, ascending team
 * number on ties. A free single-feature ablation: together with B1 it says
 * whether the fit beats either selected feature used by itself. An unrated
 * candidate ranks last rather than being handed a fabricated rating.
 */
export function orderStrongest(
  candidates: readonly string[],
  ratings: ReadonlyMap<string, number>
): number[] {
  const idx: number[] = [];
  for (let i = 0; i < candidates.length; i += 1) if (candidates[i] !== undefined) idx.push(i);
  idx.sort((a, b) => compareStrength(candidates, ratings, a, b));
  return idx;
}

/**
 * `pickStrongest`'s comparator — pre-event BPR desc, UNRATED LAST (never a
 * fabricated rating), team number asc — with candidate index asc as the final
 * key, for the same totality reason as `compareDecoration`.
 *
 * An unrated candidate is `-Infinity`, so two unrated candidates compare EQUAL
 * and fall through to team number rather than producing `NaN` from a
 * subtraction.
 */
function compareStrength(
  candidates: readonly string[],
  ratings: ReadonlyMap<string, number>,
  a: number,
  b: number
): number {
  const ta = candidates[a] ?? "";
  const tb = candidates[b] ?? "";
  const ra = ratingOrLast(ratings.get(ta));
  const rb = ratingOrLast(ratings.get(tb));
  if (ra !== rb) return ra > rb ? -1 : 1;
  const na = teamNumber(ta);
  const nb = teamNumber(tb);
  if (na !== nb) return na < nb ? -1 : 1;
  return a - b;
}

function ratingOrLast(r: number | undefined): number {
  return r === undefined || !Number.isFinite(r) ? Number.NEGATIVE_INFINITY : r;
}

export function pickStrongest(
  candidates: readonly string[],
  ratings: ReadonlyMap<string, number>
): number {
  return orderStrongest(candidates, ratings)[0] ?? -1;
}

/**
 * ABSTENTION. A rookie baseline returns this when the pool contains no team
 * whose age is KNOWN to be 0 — there is no rookie for it to point at, so it
 * points at nobody.
 *
 * `isTop1Hit` already scores a negative index as a miss, so an abstention costs
 * the baseline the instance in the numerator while staying in the denominator
 * alongside every other predictor. It is ALSO counted separately, because "this
 * baseline abstained on 90% of instances" and "this baseline guessed wrong on
 * 90% of instances" are different facts about the world and must not average
 * into one number that reads as the second.
 */
export const ABSTAIN = -1;

/**
 * Indices of the candidates whose age is KNOWN and equal to 0 at this event's
 * season. Unknown age is never included — encoding an unknown as a rookie is
 * exactly the error that would inflate the rows these baselines exist to score
 * honestly.
 */
export function knownRookieIndices(
  candidates: readonly string[],
  year: number,
  rookieYears: ReadonlyMap<string, number>
): number[] {
  const out: number[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const team = candidates[i];
    if (team === undefined) continue;
    if (teamAge(rookieYears.get(team), year) === 0) out.push(i);
  }
  return out;
}

/**
 * RB1 MOST-DECORATED ROOKIE PRESENT — B1 restricted to the known-rookie subset:
 * rank by prior wins of THIS award type, then prior wins of any type, then
 * ascending team number. Abstains when the pool holds no known rookie.
 *
 * THIS IS THE BASELINE THAT KILLS THE ROOKIE ARTIFACT. B1 is structurally
 * pinned at 0.0% on award types 10/14/15 because it can never pick a team with
 * no prior wins; RB1 is not, because it only ever considers teams that HAVE no
 * prior wins. A model that beats B1 there has beaten a zero; a model that beats
 * RB1 there has beaten a real predictor.
 *
 * Like `pickMostDecorated`, it takes NO ratings argument, so the "silently
 * becomes a two-feature model" mistake is unavailable at the signature level.
 */
/**
 * RB1's ordering: `compareDecoration` restricted to the known-rookie block.
 *
 * ITS LENGTH IS THE BLOCK SIZE, NOT THE POOL SIZE. No tail of non-rookies is
 * invented below the rookies — RB1 does not rank a veteran at all, and an
 * ordering that quietly appended them would hand RB1 rank positions it never
 * claimed and make its normalized percentile look like the model's. An empty
 * block is the existing abstention, expressed as an empty ordering.
 */
export function orderMostDecoratedRookie(
  candidates: readonly string[],
  awardType: number,
  year: number,
  history: PriorHistory,
  rookieYears: ReadonlyMap<string, number>
): number[] {
  const idx = knownRookieIndices(candidates, year, rookieYears).filter(
    (i) => candidates[i] !== undefined
  );
  idx.sort((a, b) => compareDecoration(candidates, awardType, history, a, b));
  return idx;
}

export function pickMostDecoratedRookie(
  candidates: readonly string[],
  awardType: number,
  year: number,
  history: PriorHistory,
  rookieYears: ReadonlyMap<string, number>
): number {
  return orderMostDecoratedRookie(candidates, awardType, year, history, rookieYears)[0] ?? ABSTAIN;
}

/**
 * RB2 STRONGEST ROOKIE PRESENT — B2 restricted to the known-rookie subset:
 * rank by pre-event BPR alone, ascending team number on ties, an unrated
 * candidate last. Abstains when the pool holds no known rookie.
 *
 * Not redundant with RB1 even though most rookies carry no history: a rookie
 * that already played an earlier event in its rookie season DOES carry a
 * pre-event BPR at its second event, so the two baselines genuinely disagree
 * wherever a rookie has taken the field before.
 */
/** RB2's ordering: `compareStrength` restricted to the known-rookie block, block-length. */
export function orderStrongestRookie(
  candidates: readonly string[],
  year: number,
  ratings: ReadonlyMap<string, number>,
  rookieYears: ReadonlyMap<string, number>
): number[] {
  const idx = knownRookieIndices(candidates, year, rookieYears).filter(
    (i) => candidates[i] !== undefined
  );
  idx.sort((a, b) => compareStrength(candidates, ratings, a, b));
  return idx;
}

export function pickStrongestRookie(
  candidates: readonly string[],
  year: number,
  ratings: ReadonlyMap<string, number>,
  rookieYears: ReadonlyMap<string, number>
): number {
  return orderStrongestRookie(candidates, year, ratings, rookieYears)[0] ?? ABSTAIN;
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
// Rank metrics, and THE TWO DENOMINATORS (quick task 260912-i13)
// ---------------------------------------------------------------------------

/**
 * THE TWO DENOMINATORS, STATED ONCE AND APPLIED TO ALL SEVEN PREDICTORS.
 * Getting this wrong is what would silently break the k=1 control.
 *
 *   recall@k, MRR          -> denominator is EVERY scored instance (`n`).
 *                             An instance with no reachable recipient, or one a
 *                             rookie baseline abstained on, STAYS IN and scores
 *                             0. That is what makes `recall@1` identical to the
 *                             predictor's existing top-1 accuracy.
 *   mean / median rank,    -> denominator is `rankDefined` only. An instance
 *   normalized percentile     with no recipient in the ordering is EXCLUDED and
 *                             COUNTED, because "the winner ranked 37th" and
 *                             "the winner was not in the list at all" are
 *                             different facts and averaging them would invent a
 *                             rank that was never assigned.
 *
 * `rankDefined` = instances where at least one recipient appears in THAT
 * predictor's ordering. For the two model arms, B1 and B2 that is
 * `n - unreachable`. For RB1/RB2 it is instances whose rookie block is
 * non-empty AND contains a recipient.
 */
export interface RankStats {
  /** Instances where at least one recipient appeared in this predictor's ordering. */
  rankDefined: number;
  /** Parallel to `K_VALUES`. Counts over ALL `n`, so an unranked instance scores 0. */
  recallAt: number[];
  /** Σ 1/rank over ALL `n`; an unranked instance contributes 0. */
  reciprocalRankSum: number;
  /** Σ rank over `rankDefined` only. */
  rankSum: number;
  /** Σ rank/orderingLength over `rankDefined` only. */
  normalizedRankSum: number;
  /**
   * Every defined winner rank, for an EXACT median rather than an interpolated
   * one. The `--json` emitter replaces this array with the computed median and
   * its count — see `toJsonCell`.
   */
  ranks: number[];
}

export const emptyRankStats = (): RankStats => ({
  rankDefined: 0,
  recallAt: K_VALUES.map(() => 0),
  reciprocalRankSum: 0,
  rankSum: 0,
  normalizedRankSum: 0,
  ranks: [],
});

/**
 * Folds one instance into a predictor's rank stats.
 *
 * `rank === null` (no recipient in the ordering) or an empty ordering (a rookie
 * baseline's abstention) scores 0 at every k and contributes 0 to the MRR sum,
 * while staying in the `n` denominator — and is excluded from every
 * `rankDefined` accumulator.
 */
export function accumulateRank(
  stats: RankStats,
  rank: number | null,
  orderingLength: number
): void {
  if (rank === null || orderingLength <= 0) return;
  stats.rankDefined += 1;
  for (let ki = 0; ki < K_VALUES.length; ki += 1) {
    if (rank <= (K_VALUES[ki] ?? 0)) stats.recallAt[ki] = (stats.recallAt[ki] ?? 0) + 1;
  }
  stats.reciprocalRankSum += 1 / rank;
  stats.rankSum += rank;
  stats.normalizedRankSum += rank / orderingLength;
  stats.ranks.push(rank);
}

/**
 * B0 — THE RANDOM NULL ORDERING, COMPUTED EXACTLY AND NEVER SAMPLED.
 *
 * No RNG, no seed, no run-to-run drift: two runs of this script produce the
 * same B0 to the last digit, so a B0 movement can never be mistaken for a
 * model movement.
 *
 * `S(m)` is the probability that ALL `r` recipients rank strictly worse than
 * `m` under a uniformly random ordering of `N` candidates —
 * `Π_{j=0}^{r-1} (N−m−j)/(N−j)`, i.e. `C(N−m, r) / C(N, r)`, clamped at 0. With
 * `r = 0` the empty product is 1, which is the right answer: a random ordering
 * can never hit a recipient that is not in the pool.
 */
export function b0Survival(poolSize: number, recipientsInPool: number, m: number): number {
  if (recipientsInPool <= 0) return 1;
  let s = 1;
  for (let j = 0; j < recipientsInPool; j += 1) {
    const den = poolSize - j;
    const num = poolSize - m - j;
    if (den <= 0) return 0;
    if (num <= 0) return 0;
    s *= num / den;
  }
  return s;
}

/** The closed forms this script's B0 row is built from. Proved against brute force in the tests. */
export interface B0Exact {
  /** Parallel to `K_VALUES`: `1 − S(k)`, and 1 once `k >= N`. */
  recallAt: number[];
  /** `Σ_{m=1}^{N−r+1} (1/m)·(S(m−1) − S(m))`. */
  reciprocalRank: number;
  /** `(N+1)/(r+1)` — the exact expectation of the minimum of `r` draws from `N`. */
  meanRank: number;
  /** The smallest `m` with `S(m) <= 0.5`. */
  medianRank: number;
  /** `meanRank / N`. */
  normalizedRank: number;
  /** False when no recipient is in the pool — B0 has no rank there either. */
  defined: boolean;
}

export function b0Exact(poolSize: number, recipientsInPool: number): B0Exact {
  const N = poolSize;
  const r = recipientsInPool;
  if (N <= 0 || r <= 0) {
    return {
      recallAt: K_VALUES.map(() => 0),
      reciprocalRank: 0,
      meanRank: 0,
      medianRank: 0,
      normalizedRank: 0,
      defined: false,
    };
  }
  const recallAt = K_VALUES.map((k) => (k >= N ? 1 : 1 - b0Survival(N, r, k)));
  let reciprocalRank = 0;
  let prev = b0Survival(N, r, 0); // = 1
  for (let m = 1; m <= N - r + 1; m += 1) {
    const s = b0Survival(N, r, m);
    reciprocalRank += (prev - s) / m;
    prev = s;
  }
  let medianRank = N - r + 1;
  for (let m = 1; m <= N - r + 1; m += 1) {
    if (b0Survival(N, r, m) <= 0.5) {
      medianRank = m;
      break;
    }
  }
  const meanRank = (N + 1) / (r + 1);
  return {
    recallAt,
    reciprocalRank,
    meanRank,
    medianRank,
    normalizedRank: meanRank / N,
    defined: true,
  };
}

/**
 * Folds B0's exact expectations into a `RankStats`, so the reference row and
 * the six real predictors share one shape and one printer.
 *
 * Its `recallAt` entries are EXPECTED counts (fractional) rather than integer
 * hit counts, over the identical `n` denominator — so dividing by `n` yields
 * the exact expected recall, which is what the column means for every row.
 * `ranks` holds one exact per-instance MEDIAN, so the pooled `medRank` column
 * is the median of the instance-wise medians.
 */
export function accumulateB0Rank(stats: RankStats, poolSize: number, recipientsInPool: number): void {
  const e = b0Exact(poolSize, recipientsInPool);
  if (!e.defined) return;
  stats.rankDefined += 1;
  for (let ki = 0; ki < K_VALUES.length; ki += 1) {
    stats.recallAt[ki] = (stats.recallAt[ki] ?? 0) + (e.recallAt[ki] ?? 0);
  }
  stats.reciprocalRankSum += e.reciprocalRank;
  stats.rankSum += e.meanRank;
  stats.normalizedRankSum += e.normalizedRank;
  stats.ranks.push(e.medianRank);
}

/** Exact median of an unsorted sample; the mean of the two middles on an even count. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] ?? 0;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

// ---------------------------------------------------------------------------
// The experiment
// ---------------------------------------------------------------------------

/**
 * One (award type, season) or pooled tally. BOTH ARMS SHARE ONE CELL, so they
 * share one denominator `n` and are scored over the identical instance set —
 * the delta between `modelHits` and `ageModelHits` is therefore a pure feature
 * effect and never a population difference.
 */
export interface Cell {
  n: number;
  poolSum: number;
  recipSum: number;
  /** NO-AGE arm (f1-f4) top-1 hits — 5n8's model, unchanged. */
  modelHits: number;
  /** AGE arm (f1-f7) top-1 hits. */
  ageModelHits: number;
  b1Hits: number;
  b2Hits: number;
  /** RB1 most-decorated-rookie-present. An abstention is a miss here. */
  rb1Hits: number;
  /** RB2 strongest-rookie-present. An abstention is a miss here. */
  rb2Hits: number;
  /** Instances where RB1 found no known rookie in the pool at all. */
  rb1Abstentions: number;
  /** Instances where RB2 found no known rookie in the pool at all. */
  rb2Abstentions: number;
  b0Expected: number;
  /**
   * Sum over instances of the fraction of the candidate pool with a KNOWN
   * `rookie_year`. Divided by `n` it is the mean age coverage — printed so a
   * weak rookie baseline can be read as a DATA problem rather than mistaken for
   * a modelling one.
   */
  ageKnownSum: number;
  /** Instances where NO recipient was in the candidate pool — unhittable. */
  unreachable: number;
  /** Instances scored by the thin-prior decoration fallback rather than a fit. */
  thinPriorRows: number;
  /**
   * Instances whose candidate pool holds fewer than 10 teams. Printed because
   * `recall@10` on a 6-team pool is trivially 100% and a reader must be able to
   * see how much of the column is that rather than a result.
   */
  smallPoolInstances: number;
  /**
   * ONE `RankStats` PER PREDICTOR, not a scatter of fields (quick task
   * 260912-i13). Both arms still share this one cell and therefore one
   * denominator, exactly as the accuracy columns do.
   */
  rank: Record<RankPredictor, RankStats>;
}

export const emptyCell = (): Cell => ({
  n: 0,
  poolSum: 0,
  recipSum: 0,
  modelHits: 0,
  ageModelHits: 0,
  b1Hits: 0,
  b2Hits: 0,
  rb1Hits: 0,
  rb2Hits: 0,
  rb1Abstentions: 0,
  rb2Abstentions: 0,
  b0Expected: 0,
  ageKnownSum: 0,
  unreachable: 0,
  thinPriorRows: 0,
  smallPoolInstances: 0,
  rank: {
    model: emptyRankStats(),
    ageModel: emptyRankStats(),
    b1: emptyRankStats(),
    b2: emptyRankStats(),
    rb1: emptyRankStats(),
    rb2: emptyRankStats(),
    b0: emptyRankStats(),
  },
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
  /**
   * Teams with a non-null `rookie_year` in the corpus. Zero here means the age
   * arm is a no-op wearing a seven-feature name, so it is reported rather than
   * left for the reader to infer from a flat delta column.
   */
  rookieYearsKnown: number;
}

/** The two fitted arms. */
export type Arm = "model" | "ageModel";

/** Every scoreable predictor in the report. */
export type Predictor = Arm | "b1" | "b2" | "rb1" | "rb2";

/**
 * The six scoreable predictors plus the exact random null. B0 is a REFERENCE
 * ROW, never a verdict participant — the bar is still the best of B1/B2/RB1/RB2.
 */
export type RankPredictor = Predictor | "b0";

/**
 * Print order for the rank block. B1 is listed IMMEDIATELY beside the two arms
 * by design: the load-bearing requirement of 260912-i13 is that a model
 * ordering is never shown without the decoration ordering next to it, because a
 * ranking compared only against random would look spectacular everywhere and
 * mean nothing. That is 7bp's structural-zero lesson in rank form.
 */
export const RANK_PREDICTORS: readonly RankPredictor[] = [
  "model",
  "ageModel",
  "b1",
  "b2",
  "rb1",
  "rb2",
  "b0",
];

/** `acc(cell)` helpers, so the printer and the JSON never disagree. */
export function cellAccuracy(c: Cell, which: Predictor): number {
  if (c.n === 0) return 0;
  const hits =
    which === "model"
      ? c.modelHits
      : which === "ageModel"
        ? c.ageModelHits
        : which === "b1"
          ? c.b1Hits
          : which === "b2"
            ? c.b2Hits
            : which === "rb1"
              ? c.rb1Hits
              : c.rb2Hits;
  return hits / c.n;
}

export function cellRandom(c: Cell): number {
  return c.n === 0 ? 0 : c.b0Expected / c.n;
}

// --- rank accessors: one place, so the printer and the JSON never disagree ---

/** `recall@K_VALUES[kIndex]`. Denominator is ALL `n` — see `RankStats`. */
export function cellRecallAt(c: Cell, which: RankPredictor, kIndex: number): number {
  if (c.n === 0) return 0;
  return (c.rank[which].recallAt[kIndex] ?? 0) / c.n;
}

/** Mean reciprocal rank. Denominator is ALL `n`; an unranked instance contributes 0. */
export function cellMrr(c: Cell, which: RankPredictor): number {
  return c.n === 0 ? 0 : c.rank[which].reciprocalRankSum / c.n;
}

/** Mean winner rank over `rankDefined` only. */
export function cellMeanRank(c: Cell, which: RankPredictor): number {
  const s = c.rank[which];
  return s.rankDefined === 0 ? 0 : s.rankSum / s.rankDefined;
}

/** Exact median winner rank over `rankDefined` only. */
export function cellMedianRank(c: Cell, which: RankPredictor): number {
  return medianOf(c.rank[which].ranks);
}

/**
 * Mean of `winnerRank / orderingLength` over `rankDefined` only.
 *
 * Pools average ~40 teams but vary widely by event, so a raw rank is not
 * comparable across events and this is the form that is. FOR RB1/RB2 THE
 * DIVISOR IS THE ROOKIE-BLOCK SIZE, NOT THE POOL SIZE — a different
 * denominator, printed in its own column with the denominator named in the
 * header, because it is NOT comparable to the model's and the output must not
 * let a reader assume it is.
 */
export function cellNormalizedRank(c: Cell, which: RankPredictor): number {
  const s = c.rank[which];
  return s.rankDefined === 0 ? 0 : s.normalizedRankSum / s.rankDefined;
}

/** Mean fraction of the candidate pool whose `rookie_year` is known. */
export function cellAgeKnownFraction(c: Cell): number {
  return c.n === 0 ? 0 : c.ageKnownSum / c.n;
}

/**
 * The bar BOTH arms have to clear: the best of the four baselines.
 *
 * Taking the MAX over all four — not over B1 and B2 alone — is the single
 * change that makes a rookie-award verdict mean anything, because RB1 and RB2
 * are not structurally pinned at zero there.
 */
export function bestBaseline(c: Cell): number {
  return Math.max(
    cellAccuracy(c, "b1"),
    cellAccuracy(c, "b2"),
    cellAccuracy(c, "rb1"),
    cellAccuracy(c, "rb2")
  );
}

/**
 * The pre-committed verdict rule, written down before any number was seen: an
 * award type counts as PREDICTABLE only if the named arm's pooled top-1 beats
 * the BEST OF ALL FOUR baselines (B1, B2, RB1, RB2) with pooled n >= 30.
 * Anything else is "not demonstrated" — not "promising", not "directionally
 * positive".
 *
 * 5n8's rule was "beats B1 and B2". 7bp widened it to all four and applies the
 * widened rule to BOTH arms, so the no-age and age numbers are scored by one
 * rule and their comparison means something. This is what stops a rookie award
 * being "won" against two baselines that are structurally incapable of scoring
 * above zero there.
 */
export function isPredictable(c: Cell, arm: Arm = "model"): boolean {
  return c.n >= THIN_PRIOR_INSTANCES && cellAccuracy(c, arm) > bestBaseline(c);
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
export function verdictMarginPp(c: Cell, arm: Arm = "model"): number {
  return 100 * (cellAccuracy(c, arm) - bestBaseline(c));
}

/** Below this margin, a PREDICTABLE verdict is optimizer noise and says so in the output. */
export const NOISE_MARGIN_PP = 1;

/**
 * What adding the age family bought on this cell, in percentage points. THIS IS
 * THE DELIVERABLE — a new absolute accuracy with nothing to subtract from would
 * be answering a different question.
 */
export function ageDeltaPp(c: Cell): number {
  return 100 * (cellAccuracy(c, "ageModel") - cellAccuracy(c, "model"));
}

/**
 * The pre-committed reading of that delta. The SAME noise discipline 5n8 applied
 * to verdict margins applies here: raising `--iterations` from 200 to 1500 moves
 * pooled accuracy by up to 0.6pp, so a sub-1.0pp difference between two fits is
 * optimizer noise, not a feature effect.
 *
 * A delta inside the band prints as "no change" — never as "promising", never as
 * "directionally positive". That is the whole point of pre-committing it.
 */
export function ageVerdict(c: Cell): "helps" | "hurts" | "no change" {
  const d = ageDeltaPp(c);
  if (d >= NOISE_MARGIN_PP) return "helps";
  if (d <= -NOISE_MARGIN_PP) return "hurts";
  return "no change";
}

function addCell(
  target: Cell,
  poolSize: number,
  recipInPool: number,
  recipTotal: number,
  ageKnownFraction: number
): void {
  target.n += 1;
  target.poolSum += poolSize;
  target.recipSum += recipTotal;
  target.b0Expected += randomExpectedTop1(poolSize, recipInPool);
  target.ageKnownSum += ageKnownFraction;
  if (recipInPool === 0) target.unreachable += 1;
  if (poolSize < 10) target.smallPoolInstances += 1;
  accumulateB0Rank(target.rank.b0, poolSize, recipInPool);
}

interface PreparedInstance {
  readonly instance: AwardInstance;
  readonly candidates: readonly string[];
  readonly recipientSet: ReadonlySet<string>;
  readonly recipientsInPool: number;
  /** NO-AGE arm, 4 wide. */
  readonly features: number[][];
  /** AGE arm, 7 wide, sharing f1-f4 with `features` by construction. */
  readonly ageFeatures: number[][];
  readonly ratings: ReadonlyMap<string, number>;
  readonly history: PriorHistory;
  readonly train: TrainInstance;
  readonly ageTrain: TrainInstance;
  readonly ageKnownFraction: number;
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
  /**
   * teamKey -> TBA's `rookie_year`, NON-NULL ENTRIES ONLY. An absent key means
   * "unknown age", never "rookie". Optional: omitted, the age arm sees
   * `f5 = f6 = f7 = 0` for every candidate and collapses onto the no-age arm,
   * which is the honest degenerate behaviour for a corpus that has not been
   * backfilled.
   */
  rookieYearByTeam?: ReadonlyMap<string, number>;
  command: string;
  fitIterations?: number;
}): ExperimentReport {
  const fitIterations = input.fitIterations ?? 200;
  const rookieYears = input.rookieYearByTeam ?? new Map<string, number>();
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
    const ageFeatures = buildAgeFeatures(
      candidates,
      instance.awardType,
      instance.year,
      history,
      ratings,
      rookieYears
    );
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
      ageFeatures,
      ratings,
      history,
      train: toTrainInstance(features, winnerIdx),
      ageTrain: toTrainInstance(ageFeatures, winnerIdx),
      ageKnownFraction: knownAgeFraction(candidates, rookieYears),
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
      // BOTH ARMS ARE FIT ON THE SAME TRAINING POOL, in the same pass, with the
      // same iteration count and the same untouched defaults. The only thing
      // that differs between them is the width of the feature vector — which is
      // what makes the delta attributable to the age family and to nothing else.
      const weights = thin
        ? null
        : fitConditionalLogit(
            trainPool.map((p) => p.train),
            { iterations: fitIterations }
          );
      const ageWeights = thin
        ? null
        : fitConditionalLogit(
            trainPool.map((p) => p.ageTrain),
            { iterations: fitIterations }
          );

      let cell = report.perSeason.get(season);
      if (cell === undefined) {
        cell = emptyCell();
        report.perSeason.set(season, cell);
      }

      for (const p of scored) {
        // THIN-PRIOR FALLBACK: below 30 prior instances neither conditional
        // logit is fit at all and the decoration heuristic stands in for both
        // arms. Every row it produced is flagged, because a "model" number that
        // is really B1 wearing the model's name would make the comparison
        // meaningless — and a DELTA computed between two copies of B1 is a
        // guaranteed, meaningless zero.
        //
        // EVERY PICK IS THE HEAD OF AN ORDERING, never computed beside one.
        // That is what makes `recall@1` reproduce the existing accuracy column
        // mechanically rather than by assertion (quick task 260912-i13). In the
        // thin-prior case the model's ORDERING is B1's ordering too, for the
        // same reason its pick is B1's pick — anything else would make the k=1
        // control disagree with the accuracy it is meant to reproduce.
        const b1Order = orderMostDecorated(p.candidates, awardType, p.history);
        const b2Order = orderStrongest(p.candidates, p.ratings);
        const rb1Order = orderMostDecoratedRookie(
          p.candidates,
          awardType,
          p.instance.year,
          p.history,
          rookieYears
        );
        const rb2Order = orderStrongestRookie(
          p.candidates,
          p.instance.year,
          p.ratings,
          rookieYears
        );
        const modelScores = weights === null ? null : scoreByWeights(weights, p.features);
        const ageScores = ageWeights === null ? null : scoreByWeights(ageWeights, p.ageFeatures);
        const modelOrder = modelScores === null ? b1Order : orderByScores(modelScores);
        const ageModelOrder = ageScores === null ? b1Order : orderByScores(ageScores);

        const b1Pick = b1Order[0] ?? -1;
        const b2Pick = b2Order[0] ?? -1;
        const rb1Pick = rb1Order[0] ?? ABSTAIN;
        const rb2Pick = rb2Order[0] ?? ABSTAIN;
        const modelPick = modelScores === null ? b1Pick : argmaxIndex(modelScores);
        const ageModelPick = ageScores === null ? b1Pick : argmaxIndex(ageScores);

        const orders: Record<Predictor, readonly number[]> = {
          model: modelOrder,
          ageModel: ageModelOrder,
          b1: b1Order,
          b2: b2Order,
          rb1: rb1Order,
          rb2: rb2Order,
        };

        for (const target of [cell, report.pooled]) {
          addCell(
            target,
            p.candidates.length,
            p.recipientsInPool,
            p.instance.recipients.length,
            p.ageKnownFraction
          );
          if (isTop1Hit(p.candidates, modelPick, p.recipientSet)) target.modelHits += 1;
          if (isTop1Hit(p.candidates, ageModelPick, p.recipientSet)) target.ageModelHits += 1;
          if (isTop1Hit(p.candidates, b1Pick, p.recipientSet)) target.b1Hits += 1;
          if (isTop1Hit(p.candidates, b2Pick, p.recipientSet)) target.b2Hits += 1;
          // An abstention scores as a miss (isTop1Hit rejects a negative index)
          // AND is counted, so "never had a rookie to point at" is never read as
          // "pointed at the wrong team".
          if (rb1Pick === ABSTAIN) target.rb1Abstentions += 1;
          else if (isTop1Hit(p.candidates, rb1Pick, p.recipientSet)) target.rb1Hits += 1;
          if (rb2Pick === ABSTAIN) target.rb2Abstentions += 1;
          else if (isTop1Hit(p.candidates, rb2Pick, p.recipientSet)) target.rb2Hits += 1;
          if (thin) target.thinPriorRows += 1;

          // The ranking that used to be discarded at `argmaxIndex`. B0 was
          // already folded in by `addCell`, exactly and without an RNG.
          for (const which of RANK_PREDICTORS) {
            if (which === "b0") continue;
            const order = orders[which];
            accumulateRank(
              target.rank[which],
              winnerRank(order, p.candidates, p.recipientSet),
              order.length
            );
          }
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
    rookieYearsKnown: rookieYears.size,
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

interface RookieYearRow {
  team_key: string;
  rookie_year: number | null;
}

/**
 * teamKey -> `rookie_year`, NON-NULL ROWS ONLY (quick task 260912-7bp).
 *
 * A team TBA reports no rookie year for is ABSENT from the map rather than
 * present with a fabricated value. Absence is what `teamAge` turns into `null`
 * and `ageFeatureTriple` turns into `f7 = 0` — the unknown encoding. Storing a
 * placeholder here would encode every unknown team as a rookie, which is the
 * one error that would inflate exactly the rows this task exists to de-flatter.
 *
 * `rookie_year` is a STATIC HISTORICAL FACT, known before any event a team ever
 * plays, so reading the whole table at once introduces no look-ahead: there is
 * no season in which a 1997 rookie's rookie year was not already 1997. That is
 * why this one load is not partitioned by season the way `buildPriorHistory` is
 * — and the leak test still runs over the seven-feature vector, because "it is
 * legal" is an argument, not a substitute for the check.
 */
export function loadRookieYears(db: Corpus): Map<string, number> {
  const rows = db
    .prepare(`SELECT team_key, rookie_year FROM teams`)
    .all() as RookieYearRow[];
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.rookie_year === null || !Number.isFinite(r.rookie_year)) continue;
    out.set(r.team_key, r.rookie_year);
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
const signedPp = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}pp`;

function cellLine(label: string, c: Cell, pooled: boolean): string {
  const flags: string[] = [];
  if (pooled && c.n < THIN_PRIOR_INSTANCES) flags.push("THIN-n");
  if (c.thinPriorRows > 0) flags.push(`thin-prior:${c.thinPriorRows}`);
  if (pooled && isPredictable(c, "model")) flags.push("PREDICTABLE(no-age)");
  if (pooled && isPredictable(c, "ageModel")) flags.push("PREDICTABLE(+age)");
  return (
    `    ${label.padEnd(8)}${String(c.n).padStart(6)}` +
    `${(c.poolSum / Math.max(1, c.n)).toFixed(1).padStart(7)}` +
    `${(c.recipSum / Math.max(1, c.n)).toFixed(2).padStart(7)}` +
    `${pct(cellAccuracy(c, "model")).padStart(9)}` +
    `${pct(cellAccuracy(c, "ageModel")).padStart(8)}` +
    `${signedPp(ageDeltaPp(c)).padStart(9)}` +
    `${pct(cellRandom(c)).padStart(8)}` +
    `${pct(cellAccuracy(c, "b1")).padStart(8)}` +
    `${pct(cellAccuracy(c, "b2")).padStart(8)}` +
    `${pct(cellAccuracy(c, "rb1")).padStart(8)}` +
    `${pct(cellAccuracy(c, "rb2")).padStart(8)}` +
    `${pct(cellAgeKnownFraction(c)).padStart(8)}` +
    `${String(c.unreachable).padStart(9)}  ` +
    flags.join(" ")
  );
}

/**
 * Built from the same `padStart` widths the rows use rather than hand-aligned,
 * so a column can never silently drift out from under its own header.
 */
const HEADER =
  `    ${"season".padEnd(8)}${"n".padStart(6)}${"pool".padStart(7)}${"recip".padStart(7)}` +
  `${"no-age".padStart(9)}${"+age".padStart(8)}${"delta".padStart(9)}${"B0".padStart(8)}` +
  `${"B1".padStart(8)}${"B2".padStart(8)}${"RB1".padStart(8)}${"RB2".padStart(8)}` +
  `${"ageKn".padStart(9)}${"unreach".padStart(9)}  flags`;

const RANK_LABEL: Record<RankPredictor, string> = {
  model: "no-age",
  ageModel: "+age",
  b1: "B1",
  b2: "B2",
  rb1: "RB1",
  rb2: "RB2",
  b0: "B0",
};

/**
 * Built from the same `padStart` widths the rank rows use, for the same reason
 * `HEADER` is.
 */
const RANK_HEADER =
  `    ${"pred".padEnd(8)}` +
  K_VALUES.map((k) => `R@${k}`.padStart(8)).join("") +
  `${"MRR".padStart(8)}${"meanRank".padStart(9)}${"medRank".padStart(8)}` +
  `${"norm%".padStart(8)}${"rankDef".padStart(9)}  notes`;

function rankLine(which: RankPredictor, c: Cell): string {
  const notes: string[] = [];
  if (which === "rb1" || which === "rb2") notes.push("norm% is of the ROOKIE BLOCK, not the pool");
  if (which === "b0") notes.push("exact expectation, never sampled — reference row, not a verdict");
  return (
    `    ${RANK_LABEL[which].padEnd(8)}` +
    K_VALUES.map((_, ki) => pct(cellRecallAt(c, which, ki)).padStart(8)).join("") +
    `${cellMrr(c, which).toFixed(3).padStart(8)}` +
    `${cellMeanRank(c, which).toFixed(1).padStart(9)}` +
    `${cellMedianRank(c, which).toFixed(1).padStart(8)}` +
    `${pct(cellNormalizedRank(c, which)).padStart(8)}` +
    `${String(c.rank[which].rankDefined).padStart(9)}  ` +
    notes.join(" ")
  );
}

/**
 * The RANK block: pooled only. Per-season rank rows would be seven predictors
 * times ten seasons per award type and would drown the output.
 */
function printRankBlock(c: Cell): string[] {
  const lines: string[] = [];
  lines.push(
    `    RANK (pooled). recall/MRR denominator = every scored instance (n=${c.n});` +
      ` meanRank/medRank/norm% denominator = rankDef.`
  );
  lines.push(
    `    ${c.unreachable} unreachable instance(s) score 0 at every k and are EXCLUDED from rankDef;` +
      ` an RB abstention is the same.`
  );
  lines.push(
    `    ${c.smallPoolInstances}/${c.n} instance(s) have a pool under 10 teams — R@10 is trivially` +
      ` 100% on those, so read that column against this count.`
  );
  lines.push(RANK_HEADER);
  for (const which of RANK_PREDICTORS) lines.push(rankLine(which, c));
  return lines;
}

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
  const c = r.pooled;
  const verdict = ageVerdict(c);
  const gloss =
    verdict === "no change"
      ? `NO CHANGE (inside the ${NOISE_MARGIN_PP.toFixed(1)}pp noise band)`
      : verdict === "helps"
        ? "AGE HELPS"
        : "AGE HURTS";
  lines.push(`    age effect (pooled): ${signedPp(ageDeltaPp(c))} — ${gloss}`);
  lines.push(
    `    rookie baselines: RB1 abstained on ${c.rb1Abstentions}/${c.n} instances, ` +
      `RB2 on ${c.rb2Abstentions}/${c.n}; mean pool age coverage ${pct(cellAgeKnownFraction(c))}`
  );
  lines.push("");
  lines.push(...printRankBlock(c));
  lines.push("");
  return lines;
}

export function formatReport(report: ExperimentReport): string {
  const lines: string[] = [];
  lines.push("AWARD PREDICTABILITY — walk-forward top-1, two arms side by side");
  lines.push(`  ${report.command}`);
  lines.push("");
  lines.push("NO-AGE arm (f1-f4, unchanged from 260912-5n8):");
  lines.push("  f1 log1p(prior wins of this type), f2 recency of last win of this type,");
  lines.push("  f3 log1p(prior wins of any type), f4 pre-event BPR z-scored within pool.");
  lines.push("AGE arm (f1-f7) adds, with age = eventYear - rookie_year clamped at 0:");
  lines.push("  f5 isRookie (known age == 0), f6 log1p(age), f7 ageKnown.");
  lines.push("  Unknown rookie_year is [0,0,0] on f5-f7 — NEVER encoded as a rookie.");
  lines.push("Walk-forward: season Y's fit and every prior count come from seasons < Y only.");
  lines.push("  Both arms are fit on the same pool, same iterations, same defaults; the only");
  lines.push("  difference is the feature width, so the delta is the age family and nothing else.");
  lines.push("");
  lines.push("Baselines:  B1 most-decorated present     B2 strongest present (pre-event BPR)");
  lines.push("           RB1 most-decorated ROOKIE     RB2 strongest ROOKIE   (both may abstain)");
  lines.push(
    `Verdict rule (pre-committed): PREDICTABLE = pooled arm beats the BEST of B1, B2, RB1, RB2`
  );
  lines.push(
    `  with n >= ${THIN_PRIOR_INSTANCES}. RB1/RB2 exist so a rookie award cannot be "won" against a structural 0.0%.`
  );
  lines.push(
    `Age rule (pre-committed): age HELPS only at >= ${NOISE_MARGIN_PP.toFixed(1)}pp. Under that is NO CHANGE, not "promising".`
  );
  lines.push("Top-1 rule: one predicted team; correct iff it is in the actual recipient set.");
  lines.push("");
  lines.push("RANK BLOCK (quick task 260912-i13) — the ordering the model already computed:");
  lines.push("  Every ordering is DERIVED from the pick that was already being made, never built");
  lines.push("  beside it, so R@1 is by construction the same number as the accuracy column above");
  lines.push("  it. If those two ever disagree, the ranking work has moved the fit and NOTHING");
  lines.push("  downstream is trustworthy — diagnose, do not explain.");
  lines.push("  B1's FULL ORDERING is printed beside the model's on every rank metric. A model");
  lines.push("  ranking compared only against random is not a result: random loses everywhere.");
  lines.push("  The two denominators: recall@k and MRR keep every instance and score an");
  lines.push("  unreachable or abstained one 0; meanRank/medRank/norm% exclude it and count it.");
  lines.push("  norm% = winnerRank / orderingLength. For RB1/RB2 the divisor is the ROOKIE BLOCK,");
  lines.push("  a different denominator that is NOT comparable to the model's.");
  lines.push("  THE ROOKIE TYPES (10, 14, 15) ARE READ AGAINST RB1/RB2, NEVER B1/B2 — B1 and B2");
  lines.push("  are structurally near-bottom rankers there for the same reason they are pinned at");
  lines.push("  0.0% on top-1, and a rank 'win' over them is 260912-7bp's artifact in new clothes.");
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
  lines.push(`  teams with a known rookie_year:        ${report.rookieYearsKnown}`);
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
  lines.push("");
  lines.push("AND THEIR RANK METRICS ARE MECHANICALLY INFLATED ON TOP OF THAT. Winner rank is");
  lines.push("the BEST rank among 3-4 recipients, so recall@k has three or four chances to land");
  lines.push("inside k where a judged award has one. That is a second, independent reason these");
  lines.push("two types headline nothing.");
  lines.push("===========================================================================");
  lines.push("");
  for (const r of reference) lines.push(...printTypeBlock(r));

  const verdictLine = (r: AwardTypeReport, arm: Arm): string => {
    const margin = verdictMarginPp(r.pooled, arm);
    const noise = margin < NOISE_MARGIN_PP ? "  <-- MARGIN IS NOISE" : "";
    return (
      `  PREDICTABLE  type ${r.awardType} ${r.name}: ${arm === "model" ? "no-age" : "+age"} ` +
      `${pct(cellAccuracy(r.pooled, arm))} vs best baseline ${pct(bestBaseline(r.pooled))} ` +
      `(B1 ${pct(cellAccuracy(r.pooled, "b1"))} / B2 ${pct(cellAccuracy(r.pooled, "b2"))} / ` +
      `RB1 ${pct(cellAccuracy(r.pooled, "rb1"))} / RB2 ${pct(cellAccuracy(r.pooled, "rb2"))}) ` +
      `on n=${r.pooled.n}, margin ${signedPp(margin)}${noise}`
    );
  };

  lines.push("===========================================================================");
  lines.push("VERDICT (judged awards only, pre-committed rule: beat the BEST of all four)");
  lines.push("===========================================================================");
  for (const arm of ["model", "ageModel"] as const) {
    const verdict = judged.filter((r) => isPredictable(r.pooled, arm));
    lines.push("");
    lines.push(`  ${arm === "model" ? "NO-AGE ARM (f1-f4)" : "AGE ARM (f1-f7)"}`);
    if (verdict.length === 0) {
      lines.push("    NOT DEMONSTRATED for every judged award type.");
    } else {
      for (const r of verdict) lines.push(verdictLine(r, arm));
      lines.push(
        `    Every other judged type is NOT DEMONSTRATED — not "promising", not "directionally positive".`
      );
    }
  }

  lines.push("");
  lines.push("===========================================================================");
  lines.push("WHAT AGE BOUGHT (the deliverable: +age minus no-age, per judged award type)");
  lines.push("===========================================================================");
  const helped = judged.filter((r) => ageVerdict(r.pooled) === "helps");
  const hurt = judged.filter((r) => ageVerdict(r.pooled) === "hurts");
  const flat = judged.filter((r) => ageVerdict(r.pooled) === "no change");
  for (const r of [...helped, ...hurt].sort((a, b) => ageDeltaPp(b.pooled) - ageDeltaPp(a.pooled))) {
    lines.push(
      `  ${ageVerdict(r.pooled) === "helps" ? "HELPS " : "HURTS "} type ${r.awardType} ${r.name}: ` +
        `${pct(cellAccuracy(r.pooled, "model"))} -> ${pct(cellAccuracy(r.pooled, "ageModel"))} ` +
        `(${signedPp(ageDeltaPp(r.pooled))}) on n=${r.pooled.n}`
    );
  }
  lines.push(
    `  NO CHANGE on ${flat.length} of ${judged.length} judged types (delta inside the ` +
      `${NOISE_MARGIN_PP.toFixed(1)}pp noise band): ${flat.map((r) => r.awardType).join(", ")}`
  );
  lines.push("");
  lines.push(
    `  A margin — or an age delta — under ${NOISE_MARGIN_PP.toFixed(1)}pp is OPTIMIZER NOISE, not a result.`
  );
  lines.push("  Raising --iterations from 200 to 1500 moves pooled accuracy by at most 0.6pp (the fit");
  lines.push("  is converged) and that is still enough to flip anything sitting inside that band, in");
  lines.push("  either direction. The same band therefore governs the age delta: an age arm that beats");
  lines.push(`  the no-age arm by under ${NOISE_MARGIN_PP.toFixed(1)}pp is two fits disagreeing, not a feature working.`);
  lines.push("");
  lines.push("  THE ROOKIE TYPES — 10 Rookie All Star, 14 Highest Rookie Seed, 15 Rookie Inspiration.");
  lines.push("  In 5n8 both baselines were STRUCTURALLY PINNED AT 0.0% there: B1 cannot pick a team");
  lines.push("  with no prior wins, B2 cannot pick a team with no rating. Beating a structural zero");
  lines.push("  proved nothing, and the apparent wins were artifacts of the all-zero feature vector.");
  lines.push("  RB1 and RB2 are not pinned there, so those rows now carry a baseline that can score:");
  for (const type of [10, 14, 15]) {
    const r = report.byType.find((x) => x.awardType === type);
    if (r === undefined) continue;
    const c = r.pooled;
    lines.push(
      `    type ${type} ${r.name}: no-age ${pct(cellAccuracy(c, "model"))} / +age ` +
        `${pct(cellAccuracy(c, "ageModel"))} vs B1 ${pct(cellAccuracy(c, "b1"))} / ` +
        `B2 ${pct(cellAccuracy(c, "b2"))} / RB1 ${pct(cellAccuracy(c, "rb1"))} / ` +
        `RB2 ${pct(cellAccuracy(c, "rb2"))} on n=${c.n}`
    );
  }
  lines.push("");
  lines.push("  If RB1 beats either arm on those types, THAT is the result — exactly the way 5n8");
  lines.push("  reported that the fit lost to B1 on the flagship judged awards.");
  return lines.join("\n");
}

/**
 * A `Cell` reshaped for `--json`.
 *
 * `RankStats.ranks` is REPLACED by its computed median and its count. Kept raw,
 * the pooled arrays carry roughly 366,000 integers across every award type and
 * predictor, which would make the `--json` output unreadable and effectively
 * unusable — and they carry no fact the median and the count do not, because
 * every other rank metric is already a sum accumulated beside them. The median
 * is computed HERE from the full sample rather than estimated downstream, so
 * dropping the array loses nothing.
 */
export function toJsonCell(c: Cell): Record<string, unknown> {
  const rank: Record<string, unknown> = {};
  for (const which of RANK_PREDICTORS) {
    const s = c.rank[which];
    rank[which] = {
      rankDefined: s.rankDefined,
      recallAt: s.recallAt,
      reciprocalRankSum: s.reciprocalRankSum,
      rankSum: s.rankSum,
      normalizedRankSum: s.normalizedRankSum,
      medianRank: medianOf(s.ranks),
      rankCount: s.ranks.length,
    };
  }
  return { ...c, rank };
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

    const rookieYearByTeam = loadRookieYears(db);

    report = runExperiment({
      instances,
      census,
      poolsByEvent,
      ratingsByEvent,
      awardNames,
      rookieYearByTeam,
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
            pooled: toJsonCell(r.pooled),
            perSeason: Object.fromEntries(
              [...r.perSeason].map(([season, cell]) => [season, toJsonCell(cell)])
            ),
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
