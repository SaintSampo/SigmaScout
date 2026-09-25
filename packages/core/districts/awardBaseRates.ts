/**
 * DISTRICT AWARD BASE RATES — per season, the chance a team earns any award
 * points at a regular district event and the distribution of how many, bucketed
 * by how decorated the team already was and whether it is a rookie.
 *
 * 10-CONTEXT.md's "Awards (Jacob): base rates by decoration bucket" is the
 * authority: per-season, walk-forward, buckets of prior judged awards (none /
 * one or two / three or more) crossed with rookie status, the chance of any
 * award points plus the distribution over 0/5/8/10/13/15+, pinned by a test.
 *
 * 10-04 draws the award category from `awardBaseRate` inside a Web Worker and
 * 10-06 bakes the same lookup's output. NEITHER restates a rate and neither
 * recomputes one from the corpus. Zero runtime imports and no I/O, for exactly
 * that reason.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every literal below was written from the printed output of:
 *
 *     npx tsx scripts/measureDistrictAwardBaseRates.ts
 *     pnpm measure:district-award-base-rates
 *
 * run on 2026-09-25. They are not hand-typed and not remembered. The
 * corpus-guarded describe in `scripts/measureDistrictAwardBaseRates.test.ts`
 * re-measures every registered season and asserts each pmf within 1e-6 and each
 * `n` exactly, so an ingest or a rule change turns that test red rather than
 * leaving a stale table looking true.
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD IN BOTH HALVES
 * ---------------------------------------------------------------------------
 *
 * A team's decoration bucket at a season-Y event counts only judged awards from
 * seasons strictly before Y, AND the rates registered for season Y are fit only
 * on team-events from seasons strictly before Y. Both halves are pinned by
 * their own leak test, on fixtures chosen so a leak CHANGES the answer. One
 * leak test covering only the feature half would leave the larger half — the
 * table itself, which is the thing that ships — unproven.
 *
 * ---------------------------------------------------------------------------
 * SCOPE: THE DISTRICT TIER ONLY
 * ---------------------------------------------------------------------------
 *
 * Measured from `district_rankings.event_points_raw`'s `award_points`
 * component, keeping only entries whose OWN `district_cmp` boolean is false.
 * `pointModel.ts`'s header names the trap directly: inferring the tier by
 * joining to `events` and testing `event_type == 2` yields the dcmp figure
 * wearing the district tier's name.
 *
 * ---------------------------------------------------------------------------
 * HONEST NULL: THE FALLBACK HIERARCHY NAMES THE RUNG IT USED
 * ---------------------------------------------------------------------------
 *
 * A cell with fewer than `MIN_CELL_OBSERVATIONS` team-events is reported
 * CANNOT BE SCORED by the script and is ABSENT from the tables here. The lookup
 * then falls back up three ordered rungs and returns which one it landed on:
 *
 *   1. `"cell"`          — the exact (decoration bucket, rookie state) cell.
 *   2. `"bucket-pooled"` — the decoration bucket pooled across rookie states.
 *   3. `"season-pooled"` — the whole season pooled.
 *
 * A fabricated rate for a thin cell is the exact failure the honest-null
 * discipline exists to prevent, and a SILENT fallback is a fabricated rate
 * wearing the cell's name. `source` travelling back with every result is what
 * makes the difference visible to 10-07's drawer.
 *
 * NOT IN SCOPE, per 10-CONTEXT.md: Impact and Rookie All Star ordering tables.
 * And no award prediction anywhere near `locks.ts` — a Locked verdict stays a
 * guarantee. This table prices a blue cell; it never moves a status.
 */

/** How decorated a team already was, by its count of prior judged awards. */
export type DecorationBucket = "none" | "one-or-two" | "three-or-more";

/** The three buckets in print order. */
export const DECORATION_BUCKETS: readonly DecorationBucket[] = ["none", "one-or-two", "three-or-more"];

/**
 * A team's rookie status in the scored season. `"unknown"` is its OWN state,
 * never folded into `"veteran"`: TBA reports a null `rookie_year` for real
 * teams, and folding an absence into a value is a guess.
 */
export type RookieState = "rookie" | "veteran" | "unknown";

/** The three rookie states in print order. */
export const ROOKIE_STATES: readonly RookieState[] = ["rookie", "veteran", "unknown"];

/**
 * Award types that are NOT judged awards and therefore never count toward a
 * team's decoration bucket:
 *
 *   1  Winner              — won on the field, not before a judge.
 *   2  Finalist            — likewise. Both are already named
 *                            `REFERENCE_ONLY_AWARD_TYPES` upstream in
 *                            `scripts/measureAwardPredictability.ts`.
 *  14  Highest Rookie Seed — earned by qualification seeding, a ranking
 *                            outcome rather than a judged one.
 *
 * Asserted by SET EQUALITY in the test, so an addition or a removal fails
 * loudly rather than quietly shifting a third of the population's bucket.
 */
export const NON_JUDGED_AWARD_TYPES: ReadonlySet<number> = new Set([1, 2, 14]);

/**
 * The award-point values a district-tier team-event can take, in order. Index 5
 * means "15 OR MORE": 15 is `pointModel.ts`'s declared district-tier award
 * ceiling and the highest stack ever observed, but the bin is open on the right
 * so a future stack cannot silently fall outside the support.
 */
export const AWARD_POINT_SUPPORT: readonly number[] = [0, 5, 8, 10, 13, 15];

/**
 * The minimum team-events a cell needs before a rate is stated for it.
 *
 * 100 rather than a rounder number with no reason: the support has six bins, so
 * at 100 observations a bin holding 10% of the mass rests on ten events, which
 * is the thinnest evidence this project is willing to render as a percentage on
 * a blue cell. Below it the cell prints CANNOT BE SCORED and the lookup falls
 * back up the stated hierarchy.
 */
export const MIN_CELL_OBSERVATIONS = 100;

/** Thrown for a season this module carries no table for — never a silent default. */
export class UnknownAwardBaseRateSeasonError extends Error {
  constructor(season: number) {
    super(
      `awardBaseRates: no district award base-rate table for season ${season} (registered: ${DISTRICT_AWARD_BASE_RATE_SEASONS.join(", ")}) — refusing to guess a rate for an unregistered season`
    );
    this.name = "UnknownAwardBaseRateSeasonError";
  }
}

/** One measured distribution: the observation count it rests on and the pmf over `AWARD_POINT_SUPPORT`. */
export interface AwardPointDistribution {
  readonly n: number;
  readonly pmf: readonly number[];
}

/** Which rung of the fallback hierarchy a lookup landed on. */
export type AwardBaseRateSource = "cell" | "bucket-pooled" | "season-pooled";

/** What `awardBaseRate` returns. `source` is part of the value, never a detail the caller cannot see. */
export interface AwardBaseRateResult extends AwardPointDistribution {
  readonly source: AwardBaseRateSource;
}

/** One season's measured tables. A cell below `MIN_CELL_OBSERVATIONS` is absent, not zeroed. */
export interface SeasonAwardBaseRates {
  /** Keyed `${DecorationBucket}|${RookieState}`. Absent means CANNOT BE SCORED. */
  readonly cells: Readonly<Record<string, AwardPointDistribution>>;
  /** Keyed by `DecorationBucket`, pooled across rookie states. */
  readonly bucketPooled: Readonly<Record<string, AwardPointDistribution>>;
  /** The whole season's district-tier team-events, pooled. */
  readonly seasonPooled: AwardPointDistribution;
}

/** The cell key, in one place so the script and the module cannot disagree about it. */
export function cellKey(bucket: DecorationBucket, rookieState: RookieState): string {
  return `${bucket}|${rookieState}`;
}

/**
 * Prior judged awards to decoration bucket. The two boundaries (0 to 1 and 2 to
 * 3) are asserted explicitly in the test, because an off-by-one there silently
 * relabels a third of the population.
 */
export function decorationBucket(priorJudgedAwardCount: number): DecorationBucket {
  if (priorJudgedAwardCount <= 0) return "none";
  if (priorJudgedAwardCount <= 2) return "one-or-two";
  return "three-or-more";
}

/**
 * A team's rookie state in `season`. `null`/`undefined` is `"unknown"` and is
 * reported separately — never folded into `"veteran"`.
 */
export function rookieStateFor(rookieYear: number | null | undefined, season: number): RookieState {
  if (rookieYear === null || rookieYear === undefined || !Number.isFinite(rookieYear)) return "unknown";
  return rookieYear >= season ? "rookie" : "veteran";
}

/**
 * An observed `award_points` value to its support index, or `undefined` for a
 * value the support does not model. `undefined` is the honest signal: silently
 * rounding an unmodelled value into a neighbouring bucket is how a real data
 * shape disappears, so the script reports every one in an UNMODELLED VALUES
 * census instead.
 *
 * Anything at or above 15 is index 5, the open-on-the-right top bin.
 */
export function awardPointsBucketIndex(points: number): number | undefined {
  if (!Number.isFinite(points)) return undefined;
  if (points >= 15) return AWARD_POINT_SUPPORT.length - 1;
  const index = AWARD_POINT_SUPPORT.indexOf(points);
  return index === -1 ? undefined : index;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MEASURED TABLES
// Written from the printed output of the command named in this file's header.
// ═══════════════════════════════════════════════════════════════════════════

const DISTRICT_AWARD_BASE_RATES: Readonly<Record<number, SeasonAwardBaseRates>> = {
  2019: {
    cells: {
      "none|rookie": { n: 847, pmf: [0.5371900826446281, 0.2585596221959858, 0.20070838252656434, 0.0023612750885478157, 0.0011806375442739079, 0] },
      "none|veteran": { n: 4307, pmf: [0.7534246575342466, 0.20664035291386115, 0.013930810308799628, 0.022985837009519387, 0.0018574413745066172, 0.0011609008590666356] },
      "one-or-two|veteran": { n: 1847, pmf: [0.6247969680563076, 0.3194369247428262, 0.023280996210070383, 0.028695181375203032, 0.0027070925825663237, 0.0010828370330265296] },
      "three-or-more|veteran": { n: 1213, pmf: [0.28606760098928274, 0.4971145919208574, 0.07089859851607584, 0.12448474855729597, 0.010717230008244023, 0.010717230008244023] },
    },
    bucketPooled: {
      "none": { n: 5154, pmf: [0.7178890182382616, 0.21517268141249515, 0.0446255335661622, 0.01959642995731471, 0.0017462165308498253, 0.0009701202949165697] },
      "one-or-two": { n: 1847, pmf: [0.6247969680563076, 0.3194369247428262, 0.023280996210070383, 0.028695181375203032, 0.0027070925825663237, 0.0010828370330265296] },
      "three-or-more": { n: 1213, pmf: [0.28606760098928274, 0.4971145919208574, 0.07089859851607584, 0.12448474855729597, 0.010717230008244023, 0.010717230008244023] },
    },
    seasonPooled: { n: 8214, pmf: [0.6331872412953494, 0.28025322619917215, 0.04370586803019236, 0.03713172632091551, 0.003287070854638422, 0.0024348672997321647] },
  },
  2020: {
    cells: {
      "none|rookie": { n: 1153, pmf: [0.5099739809193409, 0.27580225498699046, 0.21075455333911536, 0.0017346053772766695, 0.0017346053772766695, 0] },
      "none|veteran": { n: 5235, pmf: [0.776313276026743, 0.19063992359121298, 0.011461318051575931, 0.019102196752626553, 0.0015281757402101242, 0.0009551098376313276] },
      "one-or-two|veteran": { n: 2882, pmf: [0.6616932685634975, 0.2904233171408744, 0.021859819569743234, 0.022900763358778626, 0.002081887578070784, 0.001040943789035392] },
      "three-or-more|veteran": { n: 2463, pmf: [0.30004060089321966, 0.5140073081607796, 0.061713357693869264, 0.10840438489646773, 0.008120178643930167, 0.007714169711733658] },
    },
    bucketPooled: {
      "none": { n: 6388, pmf: [0.728240450845335, 0.20601127113337508, 0.04743268628678773, 0.015967438948027553, 0.0015654351909830933, 0.0007827175954915466] },
      "one-or-two": { n: 2882, pmf: [0.6616932685634975, 0.2904233171408744, 0.021859819569743234, 0.022900763358778626, 0.002081887578070784, 0.001040943789035392] },
      "three-or-more": { n: 2463, pmf: [0.30004060089321966, 0.5140073081607796, 0.061713357693869264, 0.10840438489646773, 0.008120178643930167, 0.007714169711733658] },
    },
    seasonPooled: { n: 11733, pmf: [0.6220063069973579, 0.2914003238728373, 0.0441489815051564, 0.037074916901048326, 0.003068268984914344, 0.002301201738685758] },
  },
  2022: {
    cells: {
      "none|rookie": { n: 1227, pmf: [0.4979625101874491, 0.2787286063569682, 0.2200488997555012, 0.0016299918500407497, 0.0016299918500407497, 0] },
      "none|veteran": { n: 5487, pmf: [0.7811190085657007, 0.1871696737743758, 0.010934937124111536, 0.018407144158921085, 0.001457991616548205, 0.000911244760342628] },
      "one-or-two|veteran": { n: 3191, pmf: [0.6684424945158257, 0.28705734879348166, 0.02005640864932623, 0.02162331557505484, 0.001880288310874334, 0.000940144155437167] },
      "three-or-more|veteran": { n: 3096, pmf: [0.30749354005167956, 0.49547803617571057, 0.05910852713178295, 0.12403100775193798, 0.007428940568475452, 0.006459948320413436] },
    },
    bucketPooled: {
      "none": { n: 6714, pmf: [0.7293714626154304, 0.20390229371462615, 0.049151027703306524, 0.015341078343759309, 0.0014894250819183796, 0.0007447125409591898] },
      "one-or-two": { n: 3191, pmf: [0.6684424945158257, 0.28705734879348166, 0.02005640864932623, 0.02162331557505484, 0.001880288310874334, 0.000940144155437167] },
      "three-or-more": { n: 3096, pmf: [0.30749354005167956, 0.49547803617571057, 0.05910852713178295, 0.12403100775193798, 0.007428940568475452, 0.006459948320413436] },
    },
    seasonPooled: { n: 13001, pmf: [0.6139527728636259, 0.29374663487424046, 0.044381201446042615, 0.042765941081455275, 0.0029997692485193446, 0.0021536804861164525] },
  },
  2023: {
    cells: {
      "none|rookie": { n: 1335, pmf: [0.4891385767790262, 0.2846441947565543, 0.22322097378277153, 0.00149812734082397, 0.00149812734082397, 0] },
      "none|veteran": { n: 6073, pmf: [0.7828091552774576, 0.18491684505186892, 0.013173061090070805, 0.016795652889840276, 0.0014819693726329656, 0.0008233163181294253] },
      "one-or-two|veteran": { n: 3907, pmf: [0.6915792167903763, 0.2700281545943179, 0.01817251087791144, 0.01791656002047607, 0.0015357051446122344, 0.0007678525723061172] },
      "three-or-more|veteran": { n: 4540, pmf: [0.3433920704845815, 0.48744493392070487, 0.05726872246696035, 0.10242290748898679, 0.005066079295154185, 0.004405286343612335] },
    },
    bucketPooled: {
      "none": { n: 7408, pmf: [0.7298866090712743, 0.20288876889848811, 0.05102591792656588, 0.014038876889848811, 0.0014848812095032398, 0.0006749460043196544] },
      "one-or-two": { n: 3907, pmf: [0.6915792167903763, 0.2700281545943179, 0.01817251087791144, 0.01791656002047607, 0.0015357051446122344, 0.0007678525723061172] },
      "three-or-more": { n: 4540, pmf: [0.3433920704845815, 0.48744493392070487, 0.05726872246696035, 0.10242290748898679, 0.005066079295154185, 0.004405286343612335] },
    },
    seasonPooled: { n: 15855, pmf: [0.6097760958688111, 0.3009145380006307, 0.04471775465152949, 0.04030274361400189, 0.002522863450015768, 0.0017660044150110375] },
  },
  2024: {
    cells: {
      "none|rookie": { n: 1538, pmf: [0.46749024707412223, 0.29453836150845253, 0.235370611183355, 0.0013003901170351106, 0.0013003901170351106, 0] },
      "none|veteran": { n: 6540, pmf: [0.7920489296636085, 0.1779816513761468, 0.012232415902140673, 0.015596330275229359, 0.0013761467889908258, 0.0007645259938837921] },
      "one-or-two|veteran": { n: 4725, pmf: [0.7134391534391534, 0.2529100529100529, 0.01650793650793651, 0.015238095238095238, 0.0012698412698412698, 0.0006349206349206349] },
      "three-or-more|veteran": { n: 6198, pmf: [0.36027750887383025, 0.48806066473055826, 0.055340432397547594, 0.08938367215230719, 0.0037108744756373024, 0.003226847370119393] },
    },
    bucketPooled: {
      "none": { n: 8078, pmf: [0.730255013617232, 0.2001733102253033, 0.05471651398861104, 0.012874473879673186, 0.001361723198811587, 0.0006189650903689032] },
      "one-or-two": { n: 4725, pmf: [0.7134391534391534, 0.2529100529100529, 0.01650793650793651, 0.015238095238095238, 0.0012698412698412698, 0.0006349206349206349] },
      "three-or-more": { n: 6198, pmf: [0.36027750887383025, 0.48806066473055826, 0.055340432397547594, 0.08938367215230719, 0.0037108744756373024, 0.003226847370119393] },
    },
    seasonPooled: { n: 19001, pmf: [0.6053891900426294, 0.3071943581916741, 0.045418662175674966, 0.03841903057733803, 0.002105152360402084, 0.0014736066522814588] },
  },
  2025: {
    cells: {
      "none|rookie": { n: 1798, pmf: [0.46273637374860954, 0.2953281423804227, 0.2397107897664071, 0.0011123470522803114, 0.0011123470522803114, 0] },
      "none|veteran": { n: 6947, pmf: [0.7976104793436015, 0.17417590326759752, 0.01151576219951058, 0.01468259680437599, 0.0012955232474449402, 0.0007197351374694113] },
      "one-or-two|veteran": { n: 5524, pmf: [0.7304489500362057, 0.23986241853729182, 0.01448225923244026, 0.013577118030412744, 0.0010861694424330196, 0.0005430847212165098] },
      "three-or-more|veteran": { n: 8053, pmf: [0.37563640879175464, 0.4842915683596175, 0.05438966844654166, 0.08034272941760834, 0.0028560784800695394, 0.002483546504408295] },
    },
    bucketPooled: {
      "none": { n: 8745, pmf: [0.728759291023442, 0.19908519153802173, 0.058433390508862204, 0.011892510005717553, 0.0012578616352201257, 0.0005717552887364208] },
      "one-or-two": { n: 5524, pmf: [0.7304489500362057, 0.23986241853729182, 0.01448225923244026, 0.013577118030412744, 0.0010861694424330196, 0.0005430847212165098] },
      "three-or-more": { n: 8053, pmf: [0.37563640879175464, 0.4842915683596175, 0.05438966844654166, 0.08034272941760834, 0.0028560784800695394, 0.002483546504408295] },
    },
    seasonPooled: { n: 22322, pmf: [0.6017829943553445, 0.3120688110384374, 0.046098019890690796, 0.03700385270137085, 0.0017919541259743751, 0.0012543678881820626] },
  },
  2026: {
    cells: {
      "none|rookie": { n: 2042, pmf: [0.4764936336924584, 0.2713026444662096, 0.25024485798237023, 0.0009794319294809011, 0.0009794319294809011, 0] },
      "none|veteran": { n: 7335, pmf: [0.8009543285616906, 0.1721881390593047, 0.011042944785276074, 0.013905930470347648, 0.001226993865030675, 0.0006816632583503749] },
      "one-or-two|veteran": { n: 6349, pmf: [0.7393290281934163, 0.23421011182863444, 0.012915419751141912, 0.012127894156560088, 0.0009450307134981887, 0.00047251535674909436] },
      "three-or-more|veteran": { n: 10060, pmf: [0.384493041749503, 0.48389662027833, 0.05328031809145129, 0.07405566600397614, 0.0022862823061630217, 0.0019880715705765406] },
    },
    bucketPooled: {
      "none": { n: 9377, pmf: [0.7302975365255412, 0.1937719953076677, 0.06313319825103977, 0.011090967260317799, 0.0011730830756105364, 0.0005332195798229711] },
      "one-or-two": { n: 6349, pmf: [0.7393290281934163, 0.23421011182863444, 0.012915419751141912, 0.012127894156560088, 0.0009450307134981887, 0.00047251535674909436] },
      "three-or-more": { n: 10060, pmf: [0.384493041749503, 0.48389662027833, 0.05328031809145129, 0.07405566600397614, 0.0022862823061630217, 0.0019880715705765406] },
    },
    seasonPooled: { n: 25786, pmf: [0.5976111068021407, 0.3169161560536725, 0.046924687815093465, 0.03591095943535252, 0.001551229349259288, 0.0010858605444815017] },
  },
};

/** Every season this module carries a table for — derived from the table's own keys, never a second hand-typed list. */
export const DISTRICT_AWARD_BASE_RATE_SEASONS: readonly number[] = Object.keys(DISTRICT_AWARD_BASE_RATES)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * The award-point distribution for one (season, decoration bucket, rookie
 * state), falling back up the stated hierarchy and reporting which rung it
 * landed on. Throws `UnknownAwardBaseRateSeasonError` for an unregistered
 * season rather than returning a plausible default.
 */
export function awardBaseRate(season: number, bucket: DecorationBucket, rookieState: RookieState): AwardBaseRateResult {
  const table = DISTRICT_AWARD_BASE_RATES[season];
  if (table === undefined) throw new UnknownAwardBaseRateSeasonError(season);

  const cell = table.cells[cellKey(bucket, rookieState)];
  if (cell !== undefined) return { ...cell, source: "cell" };

  const pooled = table.bucketPooled[bucket];
  if (pooled !== undefined) return { ...pooled, source: "bucket-pooled" };

  return { ...table.seasonPooled, source: "season-pooled" };
}

/**
 * The chance of ANY award points, derived from the pmf rather than stored
 * beside it — so a blue cell's two numbers cannot disagree.
 */
export function anyAwardProbability(pmf: readonly number[]): number {
  return 1 - (pmf[0] ?? 0);
}

/**
 * The CONDITIONAL median award-point value, given that the team earns any at
 * all: the median of the pmf renormalized over the non-zero support.
 * `undefined` when the conditional distribution has no mass, which is the
 * honest answer rather than 0.
 *
 * EVEN-MASS TIE-BREAK, stated here rather than left to whichever comparison
 * operator got written: when the cumulative mass reaches EXACTLY 0.5 at a
 * support point, the LOWER of the two straddling values is returned. A median
 * shown beside a team's name has to be a value the team could actually earn,
 * and of the two equally-defensible answers the lower one never overstates.
 */
export function conditionalMedianPoints(pmf: readonly number[]): number | undefined {
  let mass = 0;
  for (let i = 1; i < AWARD_POINT_SUPPORT.length; i++) mass += pmf[i] ?? 0;
  if (mass <= 0) return undefined;

  let cumulative = 0;
  for (let i = 1; i < AWARD_POINT_SUPPORT.length; i++) {
    cumulative += (pmf[i] ?? 0) / mass;
    if (cumulative >= 0.5) return AWARD_POINT_SUPPORT[i];
  }
  return AWARD_POINT_SUPPORT[AWARD_POINT_SUPPORT.length - 1];
}
