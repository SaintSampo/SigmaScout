/**
 * IMPACT AND ROOKIE ALL STAR ORDERING TABLES — per season, the chance a team
 * wins Impact given its POSITION in its event's most-decorated ordering, and
 * the chance a rookie wins Rookie All Star given its position among that
 * event's rookies. Plus the RESIDUAL award-point table those two probabilities
 * are layered on, so nothing is counted twice.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Two measurements (quick tasks `260912-5n8` and `260912-l8t`) found that the
 * best available predictor of Impact is the SORT "most decorated team present"
 * and of Rookie All Star the SORT "most decorated rookie present" — both
 * beating a fitted conditional logit, on the berth-deciding stratum and
 * everywhere else. Their own stated limitation was that a sort EMITS NO
 * PROBABILITY. This module is that missing calibration layer: the sort's
 * position becomes the lookup key and the measured win rate at that position
 * becomes the probability.
 *
 * `awardBaseRates.ts` prices a team's award cell from its decoration BUCKET,
 * which is the bucket's average. A team that is the single most decorated in
 * its field is priced here from what the corpus says about that position
 * instead.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every literal below was written from the printed output of:
 *
 *     npx tsx scripts/measureAwardOrderingTables.ts
 *     pnpm measure:award-ordering-tables
 *
 * run on 2026-09-25. They are not hand-typed and not remembered. The
 * corpus-guarded describe in `scripts/measureAwardOrderingTables.test.ts`
 * re-measures every registered season and asserts each `p` within 1e-9 and
 * each `n` exactly, so an ingest or a rule change turns that test red rather
 * than leaving a stale table looking true.
 *
 * ---------------------------------------------------------------------------
 * THE DECOMPOSITION, STATED ONCE
 * ---------------------------------------------------------------------------
 *
 * A district-tier team-event's award points decompose EXACTLY as
 *
 *     award_points = 10 x [won Impact] + 8 x [won Rookie All Star] + residual
 *
 * and the residual is MEASURED that way, per team-event, rather than derived
 * by algebra from an aggregate. That matters: subtracting an aggregate share
 * from a six-bin pmf has no unique answer once awards stack (15 is 10 plus 5,
 * 13 is 8 plus 5), and a subtraction that can go negative is not a
 * distribution.
 *
 * The draw composes the three: Bernoulli(Impact) from the ordering table,
 * Bernoulli(Rookie All Star) from the rookie ordering table, and a categorical
 * draw from the residual table. Because the mean is linear,
 *
 *     E[10 I + 8 R + residual] = 10 P(I) + 8 P(R) + E[residual] = E[award_points]
 *
 * EXACTLY whenever the two Bernoulli probabilities equal the population's own
 * rates. `awardOrderingTables.test.ts` asserts that identity on the committed
 * tables rather than asserting it in a comment.
 *
 * The two point values are MEASURED, not remembered: the script tabulates
 * `award_points` over team-events whose ONLY judged award was Impact (and
 * likewise Rookie All Star) and prints the census. See
 * `IMPACT_AWARD_POINTS`.
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD IN BOTH HALVES
 * ---------------------------------------------------------------------------
 *
 * A team's decoration at a season-S event counts only judged awards from
 * seasons strictly before S, AND the table registered for season Y is fit only
 * on district-tier events from seasons strictly before Y. Both halves carry
 * their own leak test on a fixture where the leak CHANGES the answer.
 *
 * ---------------------------------------------------------------------------
 * THE STATED FALLBACK
 * ---------------------------------------------------------------------------
 *
 *   1. A position inside the table with enough observations -> `"position"`.
 *   2. A position beyond the table, or one below the observation bar ->
 *      `"tail"`, the pooled remainder.
 *   3. A season with NO table -> this module is not consulted at all and the
 *      caller keeps the `awardBaseRates.ts` path exactly as it was. That is
 *      `hasAwardOrderingTables`' whole job, and the ledger's award histogram
 *      is then bit-identical to the pre-ordering one.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ORDERING LEAVES ON THE TABLE, MEASURED
 * ---------------------------------------------------------------------------
 *
 * The ordering here uses ONE number per team: total prior judged awards.
 * `scripts/measureAwardPredictability.ts`'s own ordering sorts on prior wins
 * of THE SAME AWARD TYPE first and falls back to the total. The script
 * measures both and prints the stronger one as REFERENCE ONLY, NOT SHIPPED.
 *
 * Season 2026, position 1: this module's ordering 17.99% (136 of 756), the
 * award-type-first ordering 26.06% (197 of 756). An 8.1 percentage point gap,
 * and it is real rather than noise on that n.
 *
 * It is not shipped because closing it needs a SECOND per-team count
 * (`priorImpactWins`) on every district artifact, and that is a payload and
 * scope decision rather than a modelling one. The gap is recorded here so it
 * cannot be rediscovered as a surprise.
 *
 * NO AWARD PREDICTION EVER REACHES `locks.ts`. A Locked verdict stays a
 * guarantee. This module prices a blue cell; it never moves a status. Read the
 * import list: nothing here imports `locks.ts` and nothing here exports a
 * verdict.
 */

import {
  AWARD_POINT_SUPPORT,
  cellKey,
  type AwardBaseRateResult,
  type AwardPointDistribution,
  type DecorationBucket,
  type RookieState,
} from "./awardBaseRates.js";

/** TBA's award type for the Impact award (Chairman's Award before 2022). */
export const IMPACT_AWARD_TYPE = 0;

/** TBA's award type for the Rookie All Star award. */
export const ROOKIE_ALL_STAR_AWARD_TYPE = 10;

/**
 * District points for the Impact award, and for Rookie All Star.
 *
 * MEASURED, NOT REMEMBERED. `pnpm measure:award-ordering-tables` prints an
 * AWARD POINT VALUES census over team-events whose only judged award was that
 * one, and the corpus-guarded test asserts the census's modal value equals the
 * constant below. A remembered constant is exactly the kind of number this
 * project's failure log is a log of.
 */
export const IMPACT_AWARD_POINTS = 10;
/** See `IMPACT_AWARD_POINTS`. */
export const ROOKIE_ALL_STAR_AWARD_POINTS = 8;

/**
 * How many Impact positions carry their own row before the pooled tail. Ten
 * because `260912-5n8` measured the most-decorated ordering's top-10 recall at
 * 84.9% — beyond that the ordering has said almost everything it has to say,
 * and a per-position row out at 30 would be a rate on a handful of wins.
 */
export const MAX_IMPACT_POSITION = 10;

/**
 * How many Rookie All Star positions carry their own row before the pooled
 * tail. Three rather than ten: a district event's rookie block is small, so a
 * fourth position is thin at most events and the tail is the honest home for
 * it.
 */
export const MAX_ROOKIE_ALL_STAR_POSITION = 3;

/**
 * The minimum district-tier attendees an event needs before it contributes to
 * the ordering tables at all.
 *
 * `MAX_IMPACT_POSITION + 1`, so every contributing event fills all ten
 * positions AND the tail. That is what makes the ten per-position rates
 * COMPARABLE: a smaller field would put an observation in position 1's
 * denominator that position 10 never sees, and the resulting gradient would be
 * partly a gradient in how many events reach that far down.
 *
 * IT IS ALSO A REAL DATA GUARD, and this is the measured reason rather than
 * the tidy one. Measured 2026-09-25 over all 951 district-tier events in the
 * corpus: 72 sit below this bar (70 with a single attendee, one with two, one
 * with eight), they are overwhelmingly 2020's cancelled events, and AN
 * ATTENDEE WON IMPACT AT ALL 72. A one-attendee "field" is not a field — it is
 * the Impact winner's points row and nothing else — so including them hands
 * position 1 seventy guaranteed wins and inflates it by about seven
 * percentage points. The bar removes 7.6% of events and the whole of that
 * artifact.
 */
export const MIN_ORDERED_FIELD_SIZE = MAX_IMPACT_POSITION + 1;

/**
 * The minimum observations a POSITION needs before a probability is stated for
 * it. The same 100 `awardBaseRates.ts`'s `MIN_CELL_OBSERVATIONS` sets, for the
 * same reason and deliberately not imported: these are two different
 * populations (team-events there, event-positions here) that happen to share a
 * bar, and importing would make a later change to one silently change the
 * other.
 */
export const MIN_POSITION_OBSERVATIONS = 100;

/** Thrown for a season this module carries no ordering table for — never a silent default. */
export class UnknownAwardOrderingSeasonError extends Error {
  constructor(season: number) {
    super(
      `awardOrderingTables: no ordering table for season ${season} (registered: ${AWARD_ORDERING_SEASONS.join(", ")}) — call hasAwardOrderingTables first and keep the base-rate path`
    );
    this.name = "UnknownAwardOrderingSeasonError";
  }
}

/** One measured position: the observation count it rests on and the win rate at that position. */
export interface OrderingPositionRate {
  readonly n: number;
  readonly p: number;
}

/** Which rung of the ordering fallback a lookup landed on. Part of the value, never a detail the caller cannot see. */
export type AwardOrderingSource = "position" | "tail";

/** What `impactOrderingProbability` and `rookieAllStarOrderingProbability` return. */
export interface AwardOrderingResult extends OrderingPositionRate {
  readonly source: AwardOrderingSource;
}

/** One season's measured ordering tables and the residual table they are layered on. */
export interface SeasonAwardOrderingTables {
  /** Index `k - 1` is position `k`. `null` means the position is below the observation bar and falls to the tail. */
  readonly impact: readonly (OrderingPositionRate | null)[];
  /** Positions beyond `MAX_IMPACT_POSITION`, pooled. */
  readonly impactTail: OrderingPositionRate;
  /** Index `j - 1` is rookie position `j`. `null` falls to the tail. */
  readonly rookieAllStar: readonly (OrderingPositionRate | null)[];
  /** Rookie positions beyond `MAX_ROOKIE_ALL_STAR_POSITION`, pooled. */
  readonly rookieAllStarTail: OrderingPositionRate;
  /** Keyed `${DecorationBucket}|${RookieState}`. Absent means below the bar. */
  readonly residualCells: Readonly<Record<string, AwardPointDistribution>>;
  /** Keyed by `DecorationBucket`, pooled across rookie states. */
  readonly residualBucketPooled: Readonly<Record<string, AwardPointDistribution>>;
  /** The whole prior population's residual, pooled. */
  readonly residualSeasonPooled: AwardPointDistribution;
}

/**
 * A team's number, parsed from its `frcNNNN` key. `Number.MAX_SAFE_INTEGER`
 * for a key that does not parse, so an unparseable key sorts LAST rather than
 * winning a tie it has no claim to.
 */
export function teamNumberFromKey(teamKey: string): number {
  const match = /^frc(\d+)$/.exec(teamKey);
  if (match === null) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(match[1]!, 10);
}

/** One attendee, as the ordering sees it. */
export interface OrderingEntry {
  readonly teamKey: string;
  /** Judged awards won in seasons STRICTLY BEFORE the event's own season. */
  readonly priorJudgedAwards: number;
}

/**
 * THE ORDERING, in one place so the measurement script, the published table
 * and the ledger draw cannot disagree about it: prior judged award count
 * DESCENDING, ties broken by ASCENDING TEAM NUMBER, and the key itself as the
 * final total key so the sort is a total order and never depends on the input
 * array's incoming order.
 *
 * The ascending-team-number tie break is stated rather than assumed: it is the
 * same tie break `scripts/measureAwardPredictability.ts`'s `compareDecoration`
 * applies, and the measured tables below were produced under it. Reversing it
 * would silently change every position-1 probability.
 *
 * Returns the team keys in order; position `k` is index `k - 1`.
 */
export function orderFieldByDecoration(entries: readonly OrderingEntry[]): string[] {
  return [...entries]
    .sort((a, b) => {
      if (a.priorJudgedAwards !== b.priorJudgedAwards) return b.priorJudgedAwards - a.priorJudgedAwards;
      const na = teamNumberFromKey(a.teamKey);
      const nb = teamNumberFromKey(b.teamKey);
      if (na !== nb) return na < nb ? -1 : 1;
      return a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0;
    })
    .map((entry) => entry.teamKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MEASURED TABLES
// Written from the printed output of the command named in this file's header.
// ═══════════════════════════════════════════════════════════════════════════

const AWARD_ORDERING_TABLES: Readonly<Record<number, SeasonAwardOrderingTables>> = {
  2019: {
    impact: [
      { n: 230, p: 0.16956521739130434 },
      { n: 230, p: 0.12173913043478261 },
      { n: 230, p: 0.1 },
      { n: 230, p: 0.08695652173913043 },
      { n: 230, p: 0.08695652173913043 },
      { n: 230, p: 0.06521739130434782 },
      { n: 230, p: 0.05652173913043478 },
      { n: 230, p: 0.043478260869565216 },
      { n: 230, p: 0.013043478260869565 },
      { n: 230, p: 0.04782608695652174 },
    ],
    impactTail: { n: 5914, p: 0.00524179912073047 },
    rookieAllStar: [
      { n: 211, p: 0.2985781990521327 },
      { n: 178, p: 0.29775280898876405 },
      { n: 147, p: 0.1360544217687075 },
    ],
    rookieAllStarTail: { n: 311, p: 0.11254019292604502 },
    residualCells: {
      "none|rookie": { n: 847, pmf: [0.7378984651711924, 0.2597402597402597, 0, 0.0023612750885478157, 0, 0] },
      "none|veteran": { n: 4307, pmf: [0.7668911074994196, 0.2078012537729278, 0.013930810308799628, 0.009519387044346413, 0.0018574413745066172, 0] },
      "one-or-two|veteran": { n: 1847, pmf: [0.6404981050351922, 0.32051976177585273, 0.023280996210070383, 0.012994044396318355, 0.0027070925825663237, 0] },
      "three-or-more|veteran": { n: 1213, pmf: [0.3734542456718879, 0.5078318219291014, 0.07089859851607584, 0.03709810387469085, 0.010717230008244023, 0] },
    },
    residualBucketPooled: {
      "none": { n: 5154, pmf: [0.7621265036864571, 0.21633682576639504, 0.011641443538998836, 0.008343034536282498, 0.0015521924718665113, 0] },
      "one-or-two": { n: 1847, pmf: [0.6404981050351922, 0.32051976177585273, 0.023280996210070383, 0.012994044396318355, 0.0027070925825663237, 0] },
      "three-or-more": { n: 1213, pmf: [0.3734542456718879, 0.5078318219291014, 0.07089859851607584, 0.03709810387469085, 0.010717230008244023, 0] },
    },
    residualSeasonPooled: { n: 8214, pmf: [0.6773800827854882, 0.28280983686389094, 0.023009495982468955, 0.013635256878500122, 0.003165327489651814, 0] },
  },
  2020: {
    impact: [
      { n: 330, p: 0.18484848484848485 },
      { n: 330, p: 0.14242424242424243 },
      { n: 330, p: 0.10606060606060606 },
      { n: 330, p: 0.08787878787878788 },
      { n: 330, p: 0.08484848484848485 },
      { n: 330, p: 0.0696969696969697 },
      { n: 330, p: 0.048484848484848485 },
      { n: 330, p: 0.03939393939393939 },
      { n: 330, p: 0.015151515151515152 },
      { n: 330, p: 0.03636363636363636 },
    ],
    impactTail: { n: 8433, p: 0.004743270484999407 },
    rookieAllStar: [
      { n: 303, p: 0.33663366336633666 },
      { n: 249, p: 0.2891566265060241 },
      { n: 205, p: 0.13658536585365855 },
    ],
    rookieAllStarTail: { n: 396, p: 0.10858585858585859 },
    residualCells: {
      "none|rookie": { n: 1153, pmf: [0.7207285342584562, 0.2775368603642671, 0, 0.0017346053772766695, 0, 0] },
      "none|veteran": { n: 5235, pmf: [0.7873925501432665, 0.19159503342884432, 0.011461318051575931, 0.008022922636103151, 0.0015281757402101242, 0] },
      "one-or-two|veteran": { n: 2882, pmf: [0.6734906315058987, 0.2914642609299098, 0.021859819569743234, 0.011103400416377515, 0.002081887578070784, 0] },
      "three-or-more|veteran": { n: 2463, pmf: [0.37718229801055625, 0.5217214778725132, 0.061713357693869264, 0.03126268777913114, 0.008120178643930167, 0] },
    },
    residualBucketPooled: {
      "none": { n: 6388, pmf: [0.7753600500939261, 0.20710707576706325, 0.00939261114589856, 0.0068879148403256105, 0.0012523481527864746, 0] },
      "one-or-two": { n: 2882, pmf: [0.6734906315058987, 0.2914642609299098, 0.021859819569743234, 0.011103400416377515, 0.002081887578070784, 0] },
      "three-or-more": { n: 2463, pmf: [0.37718229801055625, 0.5217214778725132, 0.061713357693869264, 0.03126268777913114, 0.008120178643930167, 0] },
    },
    residualSeasonPooled: { n: 11733, pmf: [0.6667518963606921, 0.29387198499957384, 0.023438165856984574, 0.013040143185885963, 0.002897809596863547, 0] },
  },
  2022: {
    impact: [
      { n: 365, p: 0.18904109589041096 },
      { n: 365, p: 0.14246575342465753 },
      { n: 365, p: 0.1095890410958904 },
      { n: 365, p: 0.09315068493150686 },
      { n: 365, p: 0.09315068493150686 },
      { n: 365, p: 0.06575342465753424 },
      { n: 365, p: 0.052054794520547946 },
      { n: 365, p: 0.03561643835616438 },
      { n: 365, p: 0.0136986301369863 },
      { n: 365, p: 0.03287671232876712 },
    ],
    impactTail: { n: 9279, p: 0.0045263498221791145 },
    rookieAllStar: [
      { n: 332, p: 0.35843373493975905 },
      { n: 274, p: 0.291970802919708 },
      { n: 217, p: 0.1382488479262673 },
    ],
    rookieAllStarTail: { n: 404, p: 0.10643564356435643 },
    residualCells: {
      "none|rookie": { n: 1227, pmf: [0.7180114099429503, 0.280358598207009, 0, 0.0016299918500407497, 0, 0] },
      "none|veteran": { n: 5486, pmf: [0.7918337586584032, 0.1881152023332118, 0.01093693036820999, 0.007655851257746992, 0.0014582573824279985, 0] },
      "one-or-two|veteran": { n: 3190, pmf: [0.6796238244514107, 0.28808777429467086, 0.02006269592476489, 0.010344827586206896, 0.0018808777429467085, 0] },
      "three-or-more|veteran": { n: 3026, pmf: [0.38830138797091873, 0.5135492399206874, 0.06047587574355585, 0.03007270323859881, 0.00760079312623926, 0] },
    },
    residualBucketPooled: {
      "none": { n: 6713, pmf: [0.7783405332936094, 0.2049754208252644, 0.008937881722031879, 0.006554446596156711, 0.0011917175629375838, 0] },
      "one-or-two": { n: 3190, pmf: [0.6796238244514107, 0.28808777429467086, 0.02006269592476489, 0.010344827586206896, 0.0018808777429467085, 0] },
      "three-or-more": { n: 3026, pmf: [0.38830138797091873, 0.5135492399206874, 0.06047587574355585, 0.03007270323859881, 0.00760079312623926, 0] },
    },
    residualSeasonPooled: { n: 12929, pmf: [0.662696264212236, 0.29770283857993657, 0.02374506922422461, 0.012994044396318355, 0.0028617835872843996, 0] },
  },
  2023: {
    impact: [
      { n: 461, p: 0.18004338394793926 },
      { n: 461, p: 0.14316702819956617 },
      { n: 461, p: 0.11496746203904555 },
      { n: 461, p: 0.08676789587852494 },
      { n: 461, p: 0.09327548806941431 },
      { n: 461, p: 0.06073752711496746 },
      { n: 461, p: 0.049891540130151846 },
      { n: 461, p: 0.03253796095444685 },
      { n: 461, p: 0.015184381778741865 },
      { n: 461, p: 0.03036876355748373 },
    ],
    impactTail: { n: 11165, p: 0.00483654276757725 },
    rookieAllStar: [
      { n: 384, p: 0.3567708333333333 },
      { n: 301, p: 0.27906976744186046 },
      { n: 231, p: 0.15151515151515152 },
    ],
    rookieAllStarTail: { n: 416, p: 0.10576923076923077 },
    residualCells: {
      "none|rookie": { n: 1332, pmf: [0.7124624624624625, 0.28603603603603606, 0, 0.0015015015015015015, 0, 0] },
      "none|veteran": { n: 6072, pmf: [0.7957839262187089, 0.18593544137022397, 0.010046113306982872, 0.00691699604743083, 0.0013175230566534915, 0] },
      "one-or-two|veteran": { n: 3904, pmf: [0.7010758196721312, 0.27100409836065575, 0.017930327868852458, 0.008452868852459017, 0.0015368852459016393, 0] },
      "three-or-more|veteran": { n: 4467, pmf: [0.41661070069397804, 0.49966420416386836, 0.05820461159614954, 0.02037161405865234, 0.00514886948735169, 0] },
    },
    residualBucketPooled: {
      "none": { n: 7404, pmf: [0.7807941653160454, 0.20394381415451107, 0.008238789843327932, 0.005942733657482442, 0.0010804970286331713, 0] },
      "one-or-two": { n: 3904, pmf: [0.7010758196721312, 0.27100409836065575, 0.017930327868852458, 0.008452868852459017, 0.0015368852459016393, 0] },
      "three-or-more": { n: 4467, pmf: [0.41661070069397804, 0.49966420416386836, 0.05820461159614954, 0.02037161405865234, 0.00514886948735169, 0] },
    },
    residualSeasonPooled: { n: 15775, pmf: [0.6579397781299524, 0.30427892234548337, 0.024786053882725832, 0.010649762282091918, 0.0023454833597464342, 0] },
  },
  2024: {
    impact: [
      { n: 555, p: 0.17297297297297298 },
      { n: 555, p: 0.13873873873873874 },
      { n: 555, p: 0.11891891891891893 },
      { n: 555, p: 0.07747747747747748 },
      { n: 555, p: 0.0972972972972973 },
      { n: 555, p: 0.06486486486486487 },
      { n: 555, p: 0.04864864864864865 },
      { n: 555, p: 0.03783783783783784 },
      { n: 555, p: 0.016216216216216217 },
      { n: 555, p: 0.02882882882882883 },
    ],
    impactTail: { n: 13371, p: 0.0053847879739735245 },
    rookieAllStar: [
      { n: 462, p: 0.37445887445887444 },
      { n: 357, p: 0.2913165266106443 },
      { n: 266, p: 0.14661654135338345 },
    ],
    rookieAllStarTail: { n: 450, p: 0.10666666666666667 },
    residualCells: {
      "none|rookie": { n: 1535, pmf: [0.7029315960912053, 0.29576547231270356, 0, 0.0013029315960912053, 0, 0] },
      "none|veteran": { n: 6539, pmf: [0.8040984860070347, 0.17892644135188868, 0.009328643523474537, 0.006423000458785747, 0.0012234286588163328, 0] },
      "one-or-two|veteran": { n: 4722, pmf: [0.7217280813214739, 0.25370605675561203, 0.016306649724692927, 0.00698856416772554, 0.0012706480304955528, 0] },
      "three-or-more|veteran": { n: 6125, pmf: [0.4284081632653061, 0.4969795918367347, 0.056, 0.014857142857142857, 0.0037551020408163266, 0] },
    },
    residualBucketPooled: {
      "none": { n: 8074, pmf: [0.7848649987614565, 0.20113945999504582, 0.0075551151845429775, 0.005449591280653951, 0.0009908347783007183, 0] },
      "one-or-two": { n: 4722, pmf: [0.7217280813214739, 0.25370605675561203, 0.016306649724692927, 0.00698856416772554, 0.0012706480304955528, 0] },
      "three-or-more": { n: 6125, pmf: [0.4284081632653061, 0.4969795918367347, 0.056, 0.014857142857142857, 0.0037551020408163266, 0] },
    },
    residualSeasonPooled: { n: 18921, pmf: [0.6537180910099889, 0.31002589715131335, 0.025421489350457165, 0.008879023307436182, 0.0019554991808043974, 0] },
  },
  2025: {
    impact: [
      { n: 653, p: 0.17457886676875958 },
      { n: 653, p: 0.13169984686064318 },
      { n: 653, p: 0.11638591117917305 },
      { n: 653, p: 0.0781010719754977 },
      { n: 653, p: 0.09494640122511486 },
      { n: 653, p: 0.06738131699846861 },
      { n: 653, p: 0.05053598774885146 },
      { n: 653, p: 0.04134762633996937 },
      { n: 653, p: 0.027565084226646247 },
      { n: 653, p: 0.026033690658499236 },
    ],
    impactTail: { n: 15712, p: 0.005409877800407332 },
    rookieAllStar: [
      { n: 548, p: 0.3740875912408759 },
      { n: 419, p: 0.2935560859188544 },
      { n: 310, p: 0.15806451612903225 },
    ],
    rookieAllStarTail: { n: 518, p: 0.10810810810810811 },
    residualCells: {
      "none|rookie": { n: 1795, pmf: [0.7025069637883008, 0.29637883008356547, 0, 0.0011142061281337048, 0, 0] },
      "none|veteran": { n: 6946, pmf: [0.8089547941261157, 0.17506478548805068, 0.00878203282464728, 0.006046645551396487, 0.001151742009789807, 0] },
      "one-or-two|veteran": { n: 5521, pmf: [0.7380909255569643, 0.240536134758196, 0.014309001992392682, 0.005977178047455171, 0.0010867596449918493, 0] },
      "three-or-more|veteran": { n: 7980, pmf: [0.43972431077694235, 0.4911027568922306, 0.05488721804511278, 0.011403508771929825, 0.0028822055137844613, 0] },
    },
    residualBucketPooled: {
      "none": { n: 8741, pmf: [0.7870952980208215, 0.19997711932273196, 0.006978606566754376, 0.005033748998970369, 0.0009152270907218854, 0] },
      "one-or-two": { n: 5521, pmf: [0.7380909255569643, 0.240536134758196, 0.014309001992392682, 0.005977178047455171, 0.0010867596449918493, 0] },
      "three-or-more": { n: 7980, pmf: [0.43972431077694235, 0.4911027568922306, 0.05488721804511278, 0.011403508771929825, 0.0028822055137844613, 0] },
    },
    residualSeasonPooled: { n: 22242, pmf: [0.6503012319036058, 0.3144950993615682, 0.025986871684201062, 0.007553277582951173, 0.0016635194676737704, 0] },
  },
  2026: {
    impact: [
      { n: 756, p: 0.17989417989417988 },
      { n: 756, p: 0.13095238095238096 },
      { n: 756, p: 0.11772486772486772 },
      { n: 756, p: 0.08068783068783068 },
      { n: 756, p: 0.08994708994708994 },
      { n: 756, p: 0.06481481481481481 },
      { n: 756, p: 0.05026455026455026 },
      { n: 756, p: 0.03968253968253968 },
      { n: 756, p: 0.031746031746031744 },
      { n: 756, p: 0.023809523809523808 },
    ],
    impactTail: { n: 18146, p: 0.005565964950953378 },
    rookieAllStar: [
      { n: 645, p: 0.3813953488372093 },
      { n: 486, p: 0.28600823045267487 },
      { n: 349, p: 0.18051575931232092 },
    ],
    rookieAllStarTail: { n: 559, p: 0.11627906976744186 },
    residualCells: {
      "none|rookie": { n: 2039, pmf: [0.7268268759195684, 0.2721922511034821, 0, 0.000980872976949485, 0, 0] },
      "none|veteran": { n: 7334, pmf: [0.8116989364603218, 0.1730297245704936, 0.008453776929370058, 0.005726752113444232, 0.00109080992637033, 0] },
      "one-or-two|veteran": { n: 6346, pmf: [0.7462968799243618, 0.23479357075323037, 0.012763945792625275, 0.0052001260636621496, 0.0009454774661203908, 0] },
      "three-or-more|veteran": { n: 9987, pmf: [0.44557925302893764, 0.4893361369780715, 0.053669770701912485, 0.009111845399018725, 0.0023029938920596776, 0] },
    },
    residualBucketPooled: {
      "none": { n: 9373, pmf: [0.7932358903232689, 0.1946015149898645, 0.006614744478822149, 0.00469433479142217, 0.0008535154166222128, 0] },
      "one-or-two": { n: 6346, pmf: [0.7462968799243618, 0.23479357075323037, 0.012763945792625275, 0.0052001260636621496, 0.0009454774661203908, 0] },
      "three-or-more": { n: 9987, pmf: [0.44557925302893764, 0.4893361369780715, 0.053669770701912485, 0.009111845399018725, 0.0023029938920596776, 0] },
    },
    residualSeasonPooled: { n: 25706, pmf: [0.6465805648486734, 0.3190305765191006, 0.026414066754843226, 0.006535439197074613, 0.0014393526803080992, 0] },
  },
};

/** Every season this module carries tables for — derived from the table's own keys, never a second hand-typed list. */
export const AWARD_ORDERING_SEASONS: readonly number[] = Object.keys(AWARD_ORDERING_TABLES)
  .map(Number)
  .sort((a, b) => a - b);

/** Whether this module can price `season` at all. The caller keeps the base-rate path when it cannot. */
export function hasAwardOrderingTables(season: number): boolean {
  return AWARD_ORDERING_TABLES[season] !== undefined;
}

/** One season's whole table set, for a caller that needs to publish it. Throws for an unregistered season. */
export function awardOrderingTables(season: number): SeasonAwardOrderingTables {
  const tables = AWARD_ORDERING_TABLES[season];
  if (tables === undefined) throw new UnknownAwardOrderingSeasonError(season);
  return tables;
}

function positionRate(
  rows: readonly (OrderingPositionRate | null)[],
  tail: OrderingPositionRate,
  position: number
): AwardOrderingResult {
  const row = position >= 1 && position <= rows.length ? rows[position - 1] : undefined;
  if (row === undefined || row === null) return { ...tail, source: "tail" };
  return { ...row, source: "position" };
}

/**
 * The chance the team at `position` in its event's most-decorated ordering
 * wins Impact. Position is 1-based. Beyond the table, or below the observation
 * bar, the pooled tail — and `source` says which.
 */
export function impactOrderingProbability(season: number, position: number): AwardOrderingResult {
  const tables = awardOrderingTables(season);
  return positionRate(tables.impact, tables.impactTail, position);
}

/**
 * The chance the rookie at `position` among its event's rookies wins Rookie
 * All Star. Position is 1-based within the ROOKIE BLOCK, never within the
 * whole field.
 *
 * HONEST ABOUT WHAT THIS ORDERING IS. Every true rookie has zero prior judged
 * awards by definition, so `orderFieldByDecoration` restricted to rookies
 * reduces to ASCENDING TEAM NUMBER among them. The measured per-position rates
 * below are therefore mostly the answer to "one of the k rookies in this
 * field", and the gap between position 1 and position 2 is how much the team
 * number ordering itself is worth. That is visible in the numbers rather than
 * argued in prose.
 */
export function rookieAllStarOrderingProbability(season: number, position: number): AwardOrderingResult {
  const tables = awardOrderingTables(season);
  return positionRate(tables.rookieAllStar, tables.rookieAllStarTail, position);
}

/**
 * The RESIDUAL award-point distribution for one (season, decoration bucket,
 * rookie state) — the base rate with the Impact and Rookie All Star mass
 * removed, measured directly rather than subtracted.
 *
 * Falls back up the same three rungs `awardBaseRate` does and reports which
 * one it landed on, reusing that module's own `AwardBaseRateResult` so a
 * caller handles one shape rather than two.
 */
export function awardResidualRate(
  season: number,
  bucket: DecorationBucket,
  rookieState: RookieState
): AwardBaseRateResult {
  const tables = awardOrderingTables(season);

  const cell = tables.residualCells[cellKey(bucket, rookieState)];
  if (cell !== undefined) return { ...cell, source: "cell" };

  const pooled = tables.residualBucketPooled[bucket];
  if (pooled !== undefined) return { ...pooled, source: "bucket-pooled" };

  return { ...tables.residualSeasonPooled, source: "season-pooled" };
}

/**
 * The mean of a pmf over `AWARD_POINT_SUPPORT`. Exported because it is the
 * quantity the decomposition identity is asserted on, and a second copy of it
 * inside the test would be a second chance to get it wrong.
 */
export function meanSupportPoints(pmf: readonly number[]): number {
  let mean = 0;
  for (let i = 0; i < AWARD_POINT_SUPPORT.length; i++) mean += AWARD_POINT_SUPPORT[i]! * (pmf[i] ?? 0);
  return mean;
}
