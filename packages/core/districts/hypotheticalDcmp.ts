/**
 * THE DISTRICT CHAMPIONSHIP ESTIMATE BY FIELD RANK, walk-forward (quick task
 * 260927-6bf).
 *
 * Before a District Championship starts, nothing on a rewound page may name
 * its roster: TBA registrations are future knowledge there. So a team's DCMP
 * points are estimated from how teams at the SAME PLACE in past championship
 * fields scored, and its chance of being on the winning alliance from how
 * often teams at that place won. Only seasons strictly before the one shown
 * are read, which is what makes a rewound page, and the backtest that
 * measured it, walk-forward.
 *
 * Also here: the per DCMP award counts the champ run draws against (anchored
 * on the district's previous season), and the walk-forward tuning setting the
 * page reads for each season.
 *
 * PURE AND BROWSER SAFE. The history and the tuning are generated modules
 * (`dcmpHistory.generated.ts`, `champCutoffTuning.generated.ts`) written by
 * `scripts/measureChampCutoff.ts`; nothing here reads a file.
 */
import { maxEventPoints } from "./pointModel.js";
import { districtTierWeight } from "./qualPoints.js";
import { IMPACT_AWARD_POINTS, ROOKIE_ALL_STAR_AWARD_POINTS } from "./awardOrderingTables.js";
import { DCMP_HISTORY } from "./dcmpHistory.generated.js";
import { CHAMP_CUTOFF_TUNING } from "./champCutoffTuning.generated.js";

/** Equal field rank buckets the observations are pooled into. */
export const HYPOTHETICAL_DCMP_BUCKETS = 10;

/** A table whose thinnest bucket holds fewer observations than this is refused rather than printed. */
export const HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS = 30;

// ---------------------------------------------------------------------------
// The history shape (the generated module imports these as types)
// ---------------------------------------------------------------------------

/** One field rank bucket of one season: every attendee's DCMP total, sorted ascending, and how many of them won. */
export interface DcmpHistoryBucket {
  readonly totals: readonly number[];
  readonly wins: number;
}

/** One district's District Championship award census for one season: distinct recipients per judged award type. */
export interface DcmpDistrictAwardCounts {
  readonly cmpSlots: number;
  /** Award type 0. */
  readonly impact: number;
  /** Award type 9. */
  readonly engineeringInspiration: number;
  /** Award type 10. */
  readonly rookieAllStar: number;
  /**
   * The most judged awards worth `JUDGED_AWARD_BASE_POINTS` times the DCMP
   * weight that ONE of this district's dcmp tier events gave out that season
   * (quick task 261009-2tr). Per EVENT, so a divisioned championship's
   * divisions are read one at a time, which is what keeps the measured 12
   * rather than a summed 48. `dcmpJudgedAwardCeiling` reads it.
   */
  readonly judgedAwards: number;
}

export interface DcmpHistorySeason {
  /** Exactly `HYPOTHETICAL_DCMP_BUCKETS` buckets, bucket 0 the top of the field. */
  readonly buckets: readonly DcmpHistoryBucket[];
  /** Keyed by district CODE, the district key without its four digit year. */
  readonly districts: Readonly<Record<string, DcmpDistrictAwardCounts>>;
}

/** `season -> that season's observations`. */
export type DcmpHistory = Readonly<Record<number, DcmpHistorySeason>>;

// ---------------------------------------------------------------------------
// Field ranks
// ---------------------------------------------------------------------------

/** One team as a field rank sees it: its district projection and its chance of being in the field. */
export interface FieldRankTeam {
  readonly teamKey: string;
  readonly projection: number;
  readonly fieldChance: number;
}

const RANK_EPSILON = 1e-9;

/**
 * The normalized field rank `q` in (0, 1), ONE function for training and for
 * application. For team i:
 *
 *   q = (sum of fieldChance of OTHER teams with a strictly higher projection
 *        + half the fieldChance of OTHER teams tied with it + 0.5)
 *       / max(sum of every team's fieldChance, 1)
 *
 * clamped into (0, 1). At field chance 1 for every team this is
 * `(rank - 0.5) / N` with ties halved, which is how the training observations
 * are ranked.
 */
export function normalizedFieldRanks(teams: readonly FieldRankTeam[]): Map<string, number> {
  let total = 0;
  for (const team of teams) total += team.fieldChance;
  const denominator = Math.max(total, 1);
  const out = new Map<string, number>();
  for (let i = 0; i < teams.length; i++) {
    const self = teams[i]!;
    let above = 0;
    for (let j = 0; j < teams.length; j++) {
      if (j === i) continue;
      const other = teams[j]!;
      if (other.projection > self.projection) above += other.fieldChance;
      else if (other.projection === self.projection) above += other.fieldChance / 2;
    }
    const q = (above + 0.5) / denominator;
    out.set(self.teamKey, Math.min(Math.max(q, RANK_EPSILON), 1 - RANK_EPSILON));
  }
  return out;
}

/** The bucket a field rank falls in, 0 for the top of the field. */
export function hypotheticalDcmpBucketIndex(q: number): number {
  const index = Math.floor(q * HYPOTHETICAL_DCMP_BUCKETS);
  return Math.min(Math.max(index, 0), HYPOTHETICAL_DCMP_BUCKETS - 1);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export interface HypotheticalDcmpTableBucket {
  /** Every observation, sorted ascending. */
  readonly totals: readonly number[];
  readonly wins: number;
}

export interface HypotheticalDcmpTable {
  /** The season the table prices. Every observation is from a season strictly before it. */
  readonly season: number;
  readonly fitSeasons: readonly number[];
  /** One whole District Championship's point ceiling in `season`. */
  readonly ceiling: number;
  readonly buckets: readonly HypotheticalDcmpTableBucket[];
}

const tableMemo = new Map<number, HypotheticalDcmpTable | undefined>();

/**
 * The DCMP estimate table for `season`, accumulated over every season STRICTLY
 * BEFORE it. `undefined` when no earlier season exists, when any bucket holds
 * fewer than `HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS` observations, or when
 * `season` carries no registered point ceiling. Memoized per season for the
 * shipped history.
 */
export function hypotheticalDcmpTable(season: number, history: DcmpHistory = DCMP_HISTORY): HypotheticalDcmpTable | undefined {
  const memoized = history === DCMP_HISTORY;
  if (memoized && tableMemo.has(season)) return tableMemo.get(season);
  const table = buildTable(season, history);
  if (memoized) tableMemo.set(season, table);
  return table;
}

function buildTable(season: number, history: DcmpHistory): HypotheticalDcmpTable | undefined {
  const fitSeasons = Object.keys(history)
    .map(Number)
    .filter((year) => year < season)
    .sort((a, b) => a - b);
  if (fitSeasons.length === 0) return undefined;
  let ceiling: number;
  try {
    const maxima = maxEventPoints(season, "dcmp");
    ceiling = maxima.qual + maxima.alliance + maxima.elim + maxima.award;
  } catch {
    return undefined;
  }
  const totals: number[][] = Array.from({ length: HYPOTHETICAL_DCMP_BUCKETS }, () => []);
  const wins = new Array<number>(HYPOTHETICAL_DCMP_BUCKETS).fill(0);
  for (const year of fitSeasons) {
    const entry = history[year]!;
    entry.buckets.forEach((bucket, index) => {
      totals[index]!.push(...bucket.totals);
      wins[index]! += bucket.wins;
    });
  }
  if (totals.some((bucket) => bucket.length < HYPOTHETICAL_DCMP_MIN_BUCKET_OBSERVATIONS)) return undefined;
  return {
    season,
    fitSeasons,
    ceiling,
    buckets: totals.map((bucket, index) => ({ totals: [...bucket].sort((a, b) => a - b), wins: wins[index]! })),
  };
}

/** One team's estimated DCMP part, in the one distribution representation. */
export interface HypotheticalDcmpPart {
  readonly counts: Float64Array;
  readonly denominator: number;
  readonly winChance: number;
}

function medianOf(sorted: readonly number[]): number {
  const middle = sorted.length >>> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The DCMP part for a team at field rank `q`: the bucket's DCMP totals as a
 * pmf, and the bucket's win share.
 *
 * `spreadScale` (the pre-registered tuning knob K3) widens the observations
 * about the bucket MEDIAN before the pmf is built: each value `v` becomes
 * `round(median + spreadScale * (v - median))`, clamped into
 * `[0, table.ceiling]`. At 1 the pmf is the bucket itself. The win chance is
 * unchanged by it.
 */
export function hypotheticalDcmpPart(table: HypotheticalDcmpTable, q: number, spreadScale = 1): HypotheticalDcmpPart {
  if (!Number.isFinite(spreadScale) || spreadScale <= 0) throw new RangeError(`hypotheticalDcmpPart: spreadScale must be positive, got ${String(spreadScale)}`);
  const bucket = table.buckets[hypotheticalDcmpBucketIndex(q)]!;
  const median = medianOf(bucket.totals);
  const values = bucket.totals.map((value) =>
    Math.min(Math.max(spreadScale === 1 ? value : Math.round(median + spreadScale * (value - median)), 0), table.ceiling)
  );
  let top = 0;
  for (const value of values) top = Math.max(top, value);
  const counts = new Float64Array(top + 1);
  for (const value of values) counts[value] = counts[value]! + 1;
  return { counts, denominator: values.length, winChance: bucket.wins / values.length };
}

// ---------------------------------------------------------------------------
// Award counts
// ---------------------------------------------------------------------------

/** The three judged DCMP award types the champ run draws, in the order it draws them. */
export const DCMP_DRAWN_AWARD_TYPES = [0, 9, 10] as const;

export type DcmpDrawnAwardType = (typeof DCMP_DRAWN_AWARD_TYPES)[number];

const COUNT_FIELD: Readonly<Record<DcmpDrawnAwardType, keyof Omit<DcmpDistrictAwardCounts, "cmpSlots">>> = {
  0: "impact",
  9: "engineeringInspiration",
  10: "rookieAllStar",
};

/** How many of each judged award a district's DCMP gives out, and where the number came from. */
export interface DcmpAwardCountAnchor {
  readonly counts: Readonly<Record<DcmpDrawnAwardType, number>>;
  /** `previousSeason`: the district's own most recent earlier season. `sizeBand`: the five nearest districts by `cmpSlots`. `none`: no earlier season at all. */
  readonly source: "previousSeason" | "sizeBand" | "none";
  /** The season the `previousSeason` anchor was read from. */
  readonly fromSeason?: number;
}

/** A district key without its four digit year: `2026fnc` -> `fnc`. */
export function districtCode(districtKey: string): string {
  return districtKey.replace(/^\d{4}/, "");
}

const SIZE_BAND_NEIGHBOURS = 5;

function medianRoundedHalfUp(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.floor(medianOf(sorted) + 0.5);
}

/**
 * The per type ANCHOR counts for a district's DCMP in `season`: the district's
 * most recent season before `season`, or else, over every district entry from
 * earlier seasons, the median of the five nearest by `|cmpSlots - entry.cmpSlots|`
 * (ties to the more recent season), rounded half up. Never the season shown.
 */
export function dcmpAwardCounts(
  season: number,
  districtKey: string,
  cmpSlots: number,
  history: DcmpHistory = DCMP_HISTORY
): DcmpAwardCountAnchor {
  const code = districtCode(districtKey);
  const earlier = Object.keys(history)
    .map(Number)
    .filter((year) => year < season)
    .sort((a, b) => b - a);
  for (const year of earlier) {
    const entry = history[year]!.districts[code];
    if (entry === undefined) continue;
    return { counts: countsOf(entry), source: "previousSeason", fromSeason: year };
  }
  const pool: { year: number; code: string; entry: DcmpDistrictAwardCounts }[] = [];
  for (const year of earlier) {
    for (const [otherCode, entry] of Object.entries(history[year]!.districts)) pool.push({ year, code: otherCode, entry });
  }
  if (pool.length === 0) return { counts: { 0: 0, 9: 0, 10: 0 }, source: "none" };
  const nearest = nearestBySlots(pool, cmpSlots).slice(0, SIZE_BAND_NEIGHBOURS);
  const counts = {} as Record<DcmpDrawnAwardType, number>;
  for (const type of DCMP_DRAWN_AWARD_TYPES) counts[type] = medianRoundedHalfUp(nearest.map(({ entry }) => entry[COUNT_FIELD[type]]));
  return { counts, source: "sizeBand" };
}

function countsOf(entry: DcmpDistrictAwardCounts): Record<DcmpDrawnAwardType, number> {
  return { 0: entry.impact, 9: entry.engineeringInspiration, 10: entry.rookieAllStar };
}

/**
 * Per type, the MOST a DCMP has been seen to give out — the count the champ
 * tier's slot RESERVATION reads (quick task 261006-3gg). `dcmpAwardCounts`
 * above is an anchor for a prediction; this is a ceiling for a guarantee, and
 * the two are deliberately different numbers.
 *
 * Over every earlier season of the history: the district's OWN entries, and
 * the five nearest entries by `|cmpSlots - entry.cmpSlots|` (the same band
 * `dcmpAwardCounts` falls back to, taken as a maximum rather than a median).
 * Both sets always contribute, so a district that grew an award between
 * seasons (FNC's Rookie All Star went 1 to 2 for 2023) is covered by the band
 * where its own past is not. Never the season shown.
 */
export interface DcmpAwardCountCeiling {
  readonly counts: Readonly<Record<DcmpDrawnAwardType, number>>;
  /** The earlier seasons the district's own entries were read from, most recent first. Empty for a district with no history. */
  readonly ownSeasons: readonly number[];
  /** How many size band entries contributed, at most five. Zero when the history holds no earlier season at all. */
  readonly sizeBandEntries: number;
}

export function dcmpAwardCountCeilings(
  season: number,
  districtKey: string,
  cmpSlots: number,
  history: DcmpHistory = DCMP_HISTORY
): DcmpAwardCountCeiling {
  const code = districtCode(districtKey);
  const earlier = Object.keys(history)
    .map(Number)
    .filter((year) => year < season)
    .sort((a, b) => b - a);
  const counts: Record<DcmpDrawnAwardType, number> = { 0: 0, 9: 0, 10: 0 };
  const fold = (entry: DcmpDistrictAwardCounts): void => {
    const observed = countsOf(entry);
    for (const type of DCMP_DRAWN_AWARD_TYPES) counts[type] = Math.max(counts[type], observed[type]);
  };
  const ownSeasons: number[] = [];
  const pool: { year: number; code: string; entry: DcmpDistrictAwardCounts }[] = [];
  for (const year of earlier) {
    for (const [otherCode, entry] of Object.entries(history[year]!.districts)) {
      pool.push({ year, code: otherCode, entry });
      if (otherCode === code) {
        ownSeasons.push(year);
        fold(entry);
      }
    }
  }
  const nearest = nearestBySlots(pool, cmpSlots).slice(0, SIZE_BAND_NEIGHBOURS);
  for (const { entry } of nearest) fold(entry);
  return { counts, ownSeasons, sizeBandEntries: nearest.length };
}

// ---------------------------------------------------------------------------
// The judged award ceiling (quick task 261009-2tr, CONTEXT D3)
// ---------------------------------------------------------------------------

/** District points for one judged award at a district event: every award other than Impact, Engineering Inspiration and Rookie All Star that pays at all. */
export const JUDGED_AWARD_BASE_POINTS = 5;
/** District points for the Engineering Inspiration award at a district event. */
export const ENGINEERING_INSPIRATION_AWARD_POINTS = 8;

/** What one judged award pays at a District Championship in `season`: 15 at the 3x weight. */
export function dcmpJudgedAwardPoints(season: number): number {
  return JUDGED_AWARD_BASE_POINTS * districtTierWeight(season, "dcmp");
}

export interface DcmpJudgedAwardCountInput {
  readonly season: number;
  /** Every team's award points at one dcmp tier event, summed. */
  readonly awardPointsTotal: number;
  readonly impact: number;
  readonly engineeringInspiration: number;
  readonly rookieAllStar: number;
}

/**
 * How many judged awards one dcmp tier event gave out: its award points total
 * minus the consuming awards at their weighted values, over one judged award's
 * value. THROWS on a negative or non whole remainder rather than rounding: a
 * remainder that does not divide means an award value this module does not
 * know, and refusing to guess is the only safe answer for a guarantee's input.
 */
export function dcmpJudgedAwardCount(input: DcmpJudgedAwardCountInput): number {
  const weight = districtTierWeight(input.season, "dcmp");
  const consuming =
    weight *
    (IMPACT_AWARD_POINTS * input.impact +
      ENGINEERING_INSPIRATION_AWARD_POINTS * input.engineeringInspiration +
      ROOKIE_ALL_STAR_AWARD_POINTS * input.rookieAllStar);
  const remainder = input.awardPointsTotal - consuming;
  const judged = remainder / dcmpJudgedAwardPoints(input.season);
  if (remainder < 0 || !Number.isInteger(judged)) {
    throw new RangeError(
      `dcmpJudgedAwardCount: ${String(input.awardPointsTotal)} award points in ${String(input.season)} leave ${String(remainder)} after the consuming awards, which is not a whole number of ${String(dcmpJudgedAwardPoints(input.season))} point judged awards`
    );
  }
  return judged;
}

/**
 * The margin over the most judged awards ever seen at one dcmp tier event.
 * Measured over `data/local-publish/districts`: 2023 to 2026 gave 11 or 12 at
 * every single event championship; divisions give 12 each; 2019 gave 13 at
 * chs, fma, fnc, in, isr, ne, pch and pnw, and at one dcmp tier event of fim,
 * ont and tx, so every 2019 entry of the history reads 13. The margin covers
 * one more than ever seen.
 */
export const JUDGED_AWARD_CEILING_MARGIN = 1;

/**
 * K for the Champ Locks joint proof (`champJointLock.ts`): the most judged
 * awards any one dcmp tier event has given out, over EVERY season and district
 * entry of the history, plus `JUDGED_AWARD_CEILING_MARGIN`. Not banded by
 * district, because FIRST's DCMP award slate is uniform, and not walk forward,
 * because it is a ceiling for a guarantee rather than a prediction. This is 14,
 * not the 13 CONTEXT D3 expected: the history runs back to 2016 and the 2019
 * championships reached 13 (261009-2tr planner reading 10).
 */
export function dcmpJudgedAwardCeiling(history: DcmpHistory = DCMP_HISTORY): number {
  let most = 0;
  for (const season of Object.values(history)) {
    for (const entry of Object.values(season.districts)) most = Math.max(most, entry.judgedAwards);
  }
  return most + JUDGED_AWARD_CEILING_MARGIN;
}

/** `dcmpAwardCounts`' own size band order: distance by `cmpSlots`, ties to the more recent season, then by code. */
function nearestBySlots<T extends { year: number; code: string; entry: DcmpDistrictAwardCounts }>(pool: readonly T[], cmpSlots: number): T[] {
  return [...pool].sort((a, b) => {
    const distance = Math.abs(cmpSlots - a.entry.cmpSlots) - Math.abs(cmpSlots - b.entry.cmpSlots);
    if (distance !== 0) return distance;
    if (a.year !== b.year) return b.year - a.year;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** K2: a count fixed at the anchor, or the anchor plus a season over season change drawn from history. */
export type ChampCutoffCountMode = "fixed" | "drawn";

/**
 * Per type, a weights array INDEXED BY COUNT that sums to 1.
 *
 * `fixed` is a point mass at the anchor. `drawn` is the anchor plus a change
 * drawn from the empirical distribution of that type's season over season
 * changes, over every pair of consecutive available seasons of one district
 * code where BOTH seasons are before `season`; clamped at 0 with the mass
 * there folded together. `drawn` with no such pair falls back to `fixed`.
 */
export function dcmpAwardCountDistribution(
  season: number,
  districtKey: string,
  cmpSlots: number,
  countMode: ChampCutoffCountMode,
  history: DcmpHistory = DCMP_HISTORY
): Readonly<Record<DcmpDrawnAwardType, readonly number[]>> {
  const anchor = dcmpAwardCounts(season, districtKey, cmpSlots, history);
  const changes = countMode === "drawn" ? seasonOverSeasonChanges(season, history) : undefined;
  const out = {} as Record<DcmpDrawnAwardType, number[]>;
  for (const type of DCMP_DRAWN_AWARD_TYPES) {
    const base = anchor.counts[type];
    const typeChanges = changes?.[type] ?? [];
    if (typeChanges.length === 0) {
      const weights = new Array<number>(base + 1).fill(0);
      weights[base] = 1;
      out[type] = weights;
      continue;
    }
    let top = 0;
    for (const change of typeChanges) top = Math.max(top, base + change);
    const weights = new Array<number>(Math.max(top, 0) + 1).fill(0);
    for (const change of typeChanges) {
      const count = Math.max(base + change, 0);
      weights[count]! += 1 / typeChanges.length;
    }
    out[type] = weights;
  }
  return out;
}

function seasonOverSeasonChanges(season: number, history: DcmpHistory): Record<DcmpDrawnAwardType, number[]> {
  const seasonsByCode = new Map<string, number[]>();
  for (const year of Object.keys(history).map(Number).filter((y) => y < season).sort((a, b) => a - b)) {
    for (const code of Object.keys(history[year]!.districts)) {
      const list = seasonsByCode.get(code) ?? [];
      list.push(year);
      seasonsByCode.set(code, list);
    }
  }
  const out: Record<DcmpDrawnAwardType, number[]> = { 0: [], 9: [], 10: [] };
  for (const code of [...seasonsByCode.keys()].sort()) {
    const years = seasonsByCode.get(code)!;
    for (let i = 1; i < years.length; i++) {
      const before = history[years[i - 1]!]!.districts[code]!;
      const after = history[years[i]!]!.districts[code]!;
      for (const type of DCMP_DRAWN_AWARD_TYPES) out[type].push(after[COUNT_FIELD[type]] - before[COUNT_FIELD[type]]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pre-registered tuning grid (Jacob, 2026-09-27)
// ---------------------------------------------------------------------------

/** K1: how the judged award candidates are weighted. */
export type ChampCutoffWeighting = "uniform" | "decoration";

export interface ChampCutoffSetting {
  readonly weighting: ChampCutoffWeighting;
  readonly countMode: ChampCutoffCountMode;
  /** K3: `hypotheticalDcmpPart`'s spread scale. */
  readonly spreadScale: number;
}

/** The K3 grid, ascending. */
export const CHAMP_CUTOFF_SPREAD_SCALES = [1.0, 1.15, 1.3, 1.5, 1.75] as const;

/**
 * THE WHOLE GRID, fixed before any run and in its pre-registered order: K1,
 * then K2, then K3 ascending. The first entry is the untuned default. Nothing
 * outside it may be tuned; adding a knob is a new plan.
 */
export const CHAMP_CUTOFF_TUNING_GRID: readonly ChampCutoffSetting[] = (["uniform", "decoration"] as const).flatMap((weighting) =>
  (["fixed", "drawn"] as const).flatMap((countMode) => CHAMP_CUTOFF_SPREAD_SCALES.map((spreadScale) => ({ weighting, countMode, spreadScale })))
);

/** The untuned default: uniform weighting, fixed counts, no widening. */
export const CHAMP_CUTOFF_DEFAULT_SETTING: ChampCutoffSetting = CHAMP_CUTOFF_TUNING_GRID[0]!;

/** One season's walk-forward selection, as `--write-tuning` recorded it. */
export interface ChampCutoffTuningEntry {
  readonly season: number;
  readonly setting: ChampCutoffSetting;
  /** The backtestable seasons the setting was selected on — every one strictly before `season`. */
  readonly fitSeasons: readonly number[];
  /** How many district seasons the fit set held. */
  readonly fitCount: number;
  /** The selected setting's printed range coverage over the fit set, a share in [0, 1]; null for an empty fit set. */
  readonly fitCoverage: number | null;
  /** The selected setting's mean absolute error over the fit set; null for an empty fit set. */
  readonly fitMae: number | null;
}

/**
 * The tuning setting the page uses for `season`: that season's own entry, the
 * latest entry for a later season, or the default for an earlier one.
 */
export function champCutoffTuning(season: number, tuning: readonly ChampCutoffTuningEntry[] = CHAMP_CUTOFF_TUNING): ChampCutoffTuningEntry {
  const sorted = [...tuning].sort((a, b) => a.season - b.season);
  const exact = sorted.find((entry) => entry.season === season);
  if (exact !== undefined) return exact;
  const latest = sorted[sorted.length - 1];
  if (latest !== undefined && season > latest.season) return latest;
  return { season, setting: CHAMP_CUTOFF_DEFAULT_SETTING, fitSeasons: [], fitCount: 0, fitCoverage: null, fitMae: null };
}
