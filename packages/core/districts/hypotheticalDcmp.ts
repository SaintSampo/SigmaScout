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
  pool.sort((a, b) => {
    const distance = Math.abs(cmpSlots - a.entry.cmpSlots) - Math.abs(cmpSlots - b.entry.cmpSlots);
    if (distance !== 0) return distance;
    if (a.year !== b.year) return b.year - a.year;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
  const nearest = pool.slice(0, SIZE_BAND_NEIGHBOURS);
  const counts = {} as Record<DcmpDrawnAwardType, number>;
  for (const type of DCMP_DRAWN_AWARD_TYPES) counts[type] = medianRoundedHalfUp(nearest.map(({ entry }) => entry[COUNT_FIELD[type]]));
  return { counts, source: "sizeBand" };
}

function countsOf(entry: DcmpDistrictAwardCounts): Record<DcmpDrawnAwardType, number> {
  return { 0: entry.impact, 9: entry.engineeringInspiration, 10: entry.rookieAllStar };
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
