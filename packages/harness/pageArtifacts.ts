/**
 * Published page-artifact key scheme and Zod schemas (D-01/D-02/D-04, plan
 * 04-01 Task 3; widened to all five page kinds by plan 04-02 Task 2). These
 * are the world-readable JSON files R2 serves directly to the client
 * (`packages/harness/r2Client.ts`'s `putObject`) — a different contract
 * from `packages/harness/artifact.ts`'s `HarnessArtifactSchema` (the
 * harness's own internal scoring artifact, never published). The two are
 * versioned independently: `PAGE_ARTIFACT_SCHEMA_VERSION` starts at 1
 * regardless of where `ARTIFACT_SCHEMA_VERSION` currently sits, because
 * they have different consumers (a browser fetching a page vs. this repo's
 * own harness tooling) and must be free to evolve on separate schedules.
 *
 * Every schema below shares one top-level preamble
 * (`PagePreambleSchema`/`AlgorithmScopedPreambleSchema`), factored into a
 * reusable Zod object so it cannot drift between pages: `schemaVersion`,
 * `generation` and `computedAt` (D-04's stamp, required not optional — a
 * mixed-generation read must be detectable) plus, for the four
 * algorithm-scoped pages, `algorithmId`/`algorithmVersion`.
 *
 * Two rules apply to every schema in this file and are enforced by
 * `pageArtifacts.test.ts` rather than left to convention:
 *
 *   - Raw numbers only (02-CONTEXT D-21). No schema declares a field that is
 *     a delta between two algorithms, a rank position derived from a
 *     comparison, or a boolean/string judgement about which algorithm did
 *     better. `CompareArtifactSchema` publishes each algorithm's own raw
 *     `ScoreSlice` figures side by side; the Compare page computes any
 *     comparison at render time.
 *   - There is exactly ONE uncertainty quantity on this site (superseded,
 *     Phase 7 plan 07-06, D-01/D-02/D-03 — the prior rule required a
 *     `TeamMetric.spread`/predictive-`variance` split and is rejected
 *     outright): one standard deviation of full predictive variance. Every
 *     schema in this file expresses that SAME quantity, at the aggregation
 *     level its field names — `TeamMetric.spread` at the per-team-per-metric
 *     level, `redScoreVarianceOwn`/`blueScoreVarianceOwn` at the
 *     per-alliance level — related by summing squares
 *     (`redScoreVarianceOwn` equals the sum of its three teams'
 *     `TeamMetric.spread` squares, by construction). D-03: the underlying
 *     consistency term (R) stays computed internally and is never given its
 *     own published field under any name.
 */
import { z } from "zod";
import { MetricHistoryRowSchema } from "./metricHistorySchema.js";

/**
 * Bumped whenever a published page artifact's shape changes in a way a
 * client consumer must know about. Independent of
 * `packages/harness/artifact.ts`'s `ARTIFACT_SCHEMA_VERSION` — see file
 * header.
 *
 * NOT bumped by quick task 260902-pbc's removal of `redComponents`/
 * `blueComponents` from `EventMatchSchema`/`EventUpcomingMatchSchema`/
 * `TeamSeasonMatchSchema` — a repo-wide grep found zero readers of the field
 * anywhere in `apps/web`, and the removal is safety-compatible in both
 * directions without a version bump: a pre-removal artifact still HAS the
 * keys and parses fine (neither schema is `.strict()`, so the now-unlisted
 * keys are simply ignored), and a post-removal artifact simply omits keys no
 * schema requires anymore. This is a strictly SAFER change than D-02's own
 * precedent (Phase 7 plan 07-06), which redefined `TeamMetric.spread`'s
 * MEANING under the same name without a version bump either — that one
 * accepted a real (bounded, `max-age=60`) risk of a stale reader
 * misinterpreting a value; this one has no reader to misinterpret anything
 * at all. The per-alliance-per-match component predictions themselves are
 * unchanged in the model (`packages/core/algorithms/types.ts`'s
 * `ComponentPrediction`, still returned by `sigma1/index.ts` and `epa.ts`'s
 * `predict()`) — only the published artifact stopped carrying them.
 */
export const PAGE_ARTIFACT_SCHEMA_VERSION = 1;

/** The five page kinds `artifactKey` builds a key for. */
export type PageKind = "teams" | "team" | "events" | "event" | "compare";

interface TeamsPageParams {
  page: "teams";
  year: number;
  algorithmId: string;
  version: string;
}
interface TeamPageParams {
  page: "team";
  teamKey: string;
  year: number;
  algorithmId: string;
  version: string;
}
interface EventsPageParams {
  page: "events";
  year: number;
  algorithmId: string;
  version: string;
}
interface EventPageParams {
  page: "event";
  eventKey: string;
  algorithmId: string;
  version: string;
}
/**
 * `compare` is the deliberate exception with no algorithm segment: it is the
 * head-to-head page, so it is scoped to the whole published algorithm set
 * rather than to one member of it.
 */
interface ComparePageParams {
  page: "compare";
  year: number;
}

export type ArtifactKeyParams = TeamsPageParams | TeamPageParams | EventsPageParams | EventPageParams | ComparePageParams;

/**
 * Splits an algorithm's `version` string on its FIRST `+`, mirroring
 * `packages/harness/artifact.ts`'s module-private `splitAlgorithmVersion`
 * discipline (that function is not exported, so this is a deliberate,
 * intentionally small reimplementation, not a bypass of it). Throws a named
 * error when the `+` separator is absent, so a version string that lost
 * D-13's `{codeVersion}+{paramSetName}` shape fails at key-build time
 * instead of publishing to a path nothing will ever fetch.
 */
export class MissingVersionSeparatorError extends Error {
  constructor(algorithmId: string, version: string) {
    super(
      `artifactKey: algorithm "${algorithmId}"'s version "${version}" does not carry D-13's "{codeVersion}+{paramSetName}" shape (no "+" found)`
    );
    this.name = "MissingVersionSeparatorError";
  }
}

function assertVersionShape(algorithmId: string, version: string): void {
  if (!version.includes("+")) {
    throw new MissingVersionSeparatorError(algorithmId, version);
  }
}

/**
 * D-01/D-02: builds the versioned R2 key for one of the five published page
 * kinds, always under a literal `v1/` prefix — the cheap escape hatch that
 * makes a future layout change additive rather than destructive (see
 * 04-01-PLAN.md's `<reversibility>` note on Task 3).
 */
export function artifactKey(params: ArtifactKeyParams): string {
  switch (params.page) {
    case "teams":
      assertVersionShape(params.algorithmId, params.version);
      return `v1/teams/${params.year}/${params.algorithmId}@${params.version}.json`;
    case "team":
      assertVersionShape(params.algorithmId, params.version);
      return `v1/team/${params.teamKey}/${params.year}/${params.algorithmId}@${params.version}.json`;
    case "events":
      assertVersionShape(params.algorithmId, params.version);
      return `v1/events/${params.year}/${params.algorithmId}@${params.version}.json`;
    case "event":
      assertVersionShape(params.algorithmId, params.version);
      return `v1/event/${params.eventKey}/${params.algorithmId}@${params.version}.json`;
    case "compare":
      return `v1/compare/${params.year}.json`;
  }
}

// ---------------------------------------------------------------------------
// Shared preamble (D-04)
// ---------------------------------------------------------------------------

/** Every published page artifact's top-level stamp. Required, never optional — D-04. */
const PagePreambleSchema = z.object({
  schemaVersion: z.literal(PAGE_ARTIFACT_SCHEMA_VERSION),
  /** D-04: a short opaque string identifying the publish run that produced this object. */
  generation: z.string().min(1),
  /** D-04: ISO timestamp of when this object was computed. */
  computedAt: z.string().min(1),
});

/** The four algorithm-scoped pages' preamble: `PagePreambleSchema` plus the algorithm identity. `CompareArtifactSchema` deliberately does NOT extend this — see its own doc comment. */
const AlgorithmScopedPreambleSchema = PagePreambleSchema.extend({
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Shared metric/record shapes (D-27, D-01/D-02/D-03 — plan 07-06)
// ---------------------------------------------------------------------------

/**
 * D-27, redefined by D-01/D-02 (plan 07-06): one team's named metric — a
 * value with an optional `spread`. Mirrors `packages/core/algorithms/
 * types.ts`'s `TeamMetric`. `spread` is one standard deviation of that
 * team's FULL predictive variance for that metric (`√(P + R)`) — D-03 keeps
 * the underlying consistency term (R) computed internally but never
 * publishes it under this or any other name. The schema shape here is
 * deliberately UNCHANGED by that redefinition — same optional-number type,
 * same field name, no `PAGE_ARTIFACT_SCHEMA_VERSION` bump (D-02) —
 * including D-02's accepted risk that a browser holding a pre-republish
 * artifact renders the old (R-alone) quantity under the new meaning until
 * the next republish, a window bounded by Phase 4 D-26's `max-age=60`.
 */
/** The D-17 rarity-tier vocabulary, factored out so `TeamMetricSchema.tier` and 260902-pbe's `PositionalMetricEntrySchema` (below, teams-table row only) share one literal set rather than two copies that could drift. */
const TEAM_METRIC_TIERS = ["rare", "epic", "legendary"] as const;

const TeamMetricSchema = z.object({
  value: z.number(),
  spread: z.number().optional(),
  /**
   * D-04 (Phase 6): this team's percentile rank, in the closed interval
   * [0, 100], on THIS metric among the full season team pool for this
   * (algorithm, season) pair — never over a visible subset (e.g. a sorted
   * table's currently-rendered page, or an event's roster). Optional:
   * omitted until the pipeline's percentile pass (`publish.ts`, plan
   * 06-04) actually populates it, and permanently absent for any metric a
   * future algorithm adds that the pass has not been extended to cover.
   * Feeds `colour-and-tiers.md`'s rarity-tier boxes (Common 0-50 / Rare
   * 50-75 / Epic 75-95 / Legendary 95-100).
   */
  percentile: z.number().min(0).max(100).optional(),
  /**
   * The rarity tier this metric falls in — the compact alternative to
   * `percentile`, and the ONLY one the teams-table artifact carries.
   *
   * Both express the same fact, and that duplication is a deliberate,
   * measured size decision rather than an oversight. The teams artifact is
   * this project's largest (2024/sigma1: ~369KB gzipped over the wire), and
   * page-load speed is the top stated UX priority. Measured on that exact
   * artifact: adding `percentile` to every metric costs +42% gzipped;
   * adding `tier` instead, omitted for Common, costs +10% — for an
   * identical rendered result, because the table only ever consumes the
   * tier. The per-team artifact is small and keeps the full `percentile`,
   * which the team page needs anyway.
   *
   * OMITTED for Common (percentile < 50), which is deliberately unboxed —
   * so absence means "Common or unranked", exactly the cases that render no
   * tier box. Never write "common" explicitly; that is pure payload for a
   * no-op.
   */
  tier: z.enum(TEAM_METRIC_TIERS).optional(),
});

/** One team's decoded metric, exactly `TeamMetricSchema`'s inferred shape — declared as a standalone type because `TeamMetricSchema` itself is module-private, and 260902-pbe's positional encode/decode helpers below need to name it. */
type PublishedTeamMetric = z.infer<typeof TeamMetricSchema>;

/** Component name -> that team's metric, per `AlgorithmModule.teamMetrics` (D-27). */
const MetricsRecordSchema = z.record(z.string(), TeamMetricSchema);

/** `MetricsRecordSchema`'s inferred type, named for reuse by 260902-pbe's decode path below. */
type MetricsRecordOut = z.infer<typeof MetricsRecordSchema>;

/**
 * The single definition of the D-17 rarity cuts (Common 0-50 / Rare 50-75 /
 * Epic 75-95 / Legendary 95-100). `apps/web/src/lib/tiers.ts` delegates to
 * this rather than restating the thresholds, so the tier the pipeline
 * publishes and the tier the client derives from a percentile can never
 * disagree.
 *
 * Returns `undefined` for Common and for any out-of-range or absent input —
 * every case that renders no tier box.
 */
export function publishedTierForPercentile(percentile: number | undefined): "rare" | "epic" | "legendary" | undefined {
  if (percentile === undefined) return undefined;
  if (percentile < 0 || percentile > 100) return undefined;
  if (percentile >= 95) return "legendary";
  if (percentile >= 75) return "epic";
  if (percentile >= 50) return "rare";
  return undefined;
}

/**
 * D-18 item 8, PD-01, plan 07-07 Task 3: composes an event's single display
 * location string from TBA's `state_prov`/`country` columns, reproducing
 * `apps/web/src/components/events-list/EventsList.tsx`'s `locationText`
 * composition exactly — `"{stateProv}, {country}"` when both are present,
 * the single present value when one is `null`, and `null` when both are
 * `null`. The em-dash a reader sees for that last case is deliberately NOT
 * this function's output — that is a rendering decision `EventsList.tsx`'s
 * own `cellText` already owns, applied by its caller as `?? "—"`. 07-08
 * calls this to populate `EventArtifactSchema.location`; 07-15 should make
 * `EventsList.tsx`'s `locationText` delegate to this same function as
 * `composeEventLocation(event.stateProv, event.country) ?? "—"`, so the
 * event page and the Events list can never print different locations for
 * one event. This is the same single-sourcing reason
 * `publishedTierForPercentile` above gives in its own doc comment — one
 * exported composer, not two independently-drifting implementations.
 */
export function composeEventLocation(stateProv: string | null, country: string | null): string | null {
  if (stateProv !== null && country !== null) return `${stateProv}, ${country}`;
  if (stateProv !== null) return stateProv;
  if (country !== null) return country;
  return null;
}

/** Win/loss/tie counts as three integer fields, never a formatted string. */
/**
 * A team's win-loss-tie record over OFFICIAL play only, as of quick task
 * 260908-615 — offseason (TBA event type 99) and preseason Week-0 (type 100)
 * results do not appear in these counts, on either surface that carries this
 * shape. The scoping predicate is `isOfficialEventType`
 * (`packages/core/algorithms/eventTypes.ts`), the same one the Teams-list
 * metric snapshot, the team-page header and the live Worker's incremental
 * merge all read.
 *
 * Those matches are NOT hidden: a team-season artifact's own `events` and
 * `metricHistory` arrays remain fully offseason-inclusive, so an offseason
 * event keeps its section, its match rows and its rating movement. Only the
 * summary counts are scoped.
 */
const RecordSchema = z.object({
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
});

/** The record+metrics shape shared by a teams-table row and a team-season artifact's `seasonStats`. */
const RecordAndMetricsSchema = z.object({
  record: RecordSchema,
  metrics: MetricsRecordSchema,
});

// ---------------------------------------------------------------------------
// Shared match-row building blocks
// ---------------------------------------------------------------------------

/** D-10: a discrete pmf's sum tolerance — the same 1e-9 bound `packages/harness/predictions.ts`'s `PredictionRecordSchema` enforces, applied identically here so a published pmf can never drift looser than the sidecar that fed it. */
const RP_PMF_SUM_TOLERANCE = 1e-9;

function isValidPmf(pmf: readonly number[] | undefined): boolean {
  if (pmf === undefined) return true; // omitted entirely — valid, means "not modeled"
  if (pmf.length === 0) return false; // an empty array is never a valid distribution
  const sum = pmf.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 1) <= RP_PMF_SUM_TOLERANCE;
}

/**
 * One played match's prediction-vs-actual row. Field names match
 * `packages/harness/predictions.ts`'s `PredictionRecordSchema` so a reader
 * never has to translate between the sidecar and the published file — as of
 * D-03/D-12 (plan 08-02) this includes the ranking-point distribution pair
 * and the actual-ranking-point pair, closing the one divergence that
 * remained: the sidecar carried both pairs on a played record from the
 * start, and this published row did not, until now.
 */
const EventMatchSchema = z
  .object({
    matchKey: z.string().min(1),
    compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
    setNumber: z.number().int(),
    matchNumber: z.number().int(),
    /**
     * D-13, plan 07-07 Task 1: this match's chronological sort key, in epoch
     * seconds — the same field and the same spelling as
     * `TeamSeasonMatchSchema.sortTime` (see its doc comment for the
     * epoch-seconds unit and the played-row-shows-actual-time semantics, not
     * restated here). It does two jobs on an event page: it is the ordering
     * key D-13's client-side merge of `matches[]` and `upcoming[]` sorts on —
     * the two arrays remain two distinct arrays on the wire so Phase 8's
     * simulation input is untouched, which means the browser has no other
     * basis for interleaving them — and, on an UPCOMING row specifically, it is
     * additionally the value displayed in the Actual column as a scheduled
     * time (a played row's Actual column shows `actualRedScore`/
     * `actualBlueScore` instead). Optional, and deliberately never
     * `.nullable()`: `matches.sort_time` is `NOT NULL` in
     * `packages/corpus/schema.sql`, so a null is not a representable source
     * state and accepting one here would invent a third case D-13's merge
     * would then have to handle for no reason. `undefined` means only "this
     * artifact predates the field" — 07-12 found no match row in the live
     * `2024casf` artifact carrying this key. 07-08 sources this from
     * `selectScheduledMatchTimes` (`packages/harness/publish.ts`), which
     * already runs for the team artifact; no new corpus query is needed.
     */
    sortTime: z.number().int().optional(),
    redTeams: z.array(z.string()),
    blueTeams: z.array(z.string()),
    predictedWinner: z.enum(["red", "blue"]),
    pRedWin: z.number(),
    predictedRedScore: z.number(),
    predictedBlueScore: z.number(),
    /**
     * D-18 item 3, plan 07-07 Task 1: this alliance's own predicted-score
     * variance — the same quantity, under the same field name, that
     * `TeamSeasonMatchSchema.redScoreVarianceOwn` has carried since Phase 6
     * (see that field's doc comment for the full contract; not restated
     * here). Left `undefined` by OPR and EPA, neither of which models an
     * alliance-level own variance — following `TeamSeasonMatchSchema.variance`'s
     * own optional convention. Rounded exactly once, at the publish boundary,
     * at `ROUNDING_RULE.variance` (`rounding.ts`); the call itself belongs to
     * 07-08. Under this file's header rule (D-01) it equals the sum of its
     * three teams' published `TeamMetric.spread` squares — the additivity
     * identity plan 07-06 pinned against `predict()`'s own output — which is
     * what makes the Alliances tab's combined uncertainty (07-14) and the
     * Elims band (07-13) the same number rather than two numbers that happen
     * to agree.
     */
    redScoreVarianceOwn: z.number().optional(),
    /** D-18 item 3, plan 07-07 Task 1: the blue alliance's counterpart to `redScoreVarianceOwn` — see its doc comment for the full contract. */
    blueScoreVarianceOwn: z.number().optional(),
    /**
     * SIGMASCOUT-LAYER match band (quick task 260908-5wd): this alliance's
     * variance as `Σ its three teams' Swing Factor²`, walk-forward as of this
     * match — so a match's band never uses matches that came after it.
     *
     * DELIBERATELY DISTINCT FROM `redScoreVarianceOwn`, which is the
     * ALGORITHM's own predictive variance and is published only by the
     * algorithms that model one (VPR, BPR — never OPR or EPA). This field is
     * the scouting-heuristic layer built on top of whatever the algorithm
     * predicted, computed identically for EVERY algorithm from nothing but its
     * predicted and actual scores. See `packages/harness/swingFactor.ts` for
     * the two-level split and the measured constants.
     *
     * Absent for the opening matches of a team's season, where no roster member
     * yet has the two observations a centred swing needs — an honest "we do not
     * know yet" rather than a fabricated width. Rounded once, at the publish
     * boundary, at `ROUNDING_RULE.variance`.
     */
    redSwingBandVariance: z.number().optional(),
    /** The blue alliance's counterpart to `redSwingBandVariance` — see its doc comment for the full contract. */
    blueSwingBandVariance: z.number().optional(),
    /**
     * D-03, plan 08-02 Task 1: this alliance's predicted distribution over
     * its TOTAL ranking points for this match — index `i` is the predicted
     * probability that this alliance earns exactly `i` ranking points, with
     * win, tie and bonus ranking points already folded into the domain by
     * `analyticRpPmf`'s closed form (plan 09-04 — this used to read "the
     * harness's own joint Monte Carlo draw", a module this repo no longer
     * has). This is NOT a per-bonus
     * marginal like `TeamSeasonMatchSchema.redBonusRp`/`redBonusRp` — see
     * `TeamSeasonMatchSchema.redRpPmf` and `redBonusRp` for the fuller
     * statement of that distinction, not restated here. Omitted entirely
     * (never an empty array) for an algorithm that does not model ranking
     * points — every OPR and EPA row. Validated non-empty and summing to 1
     * within this file's shared `RP_PMF_SUM_TOLERANCE` by the refines below.
     * Rounded exactly once, at the publish boundary, at `ROUNDING_RULE.pmf`
     * (`rounding.ts`), through the existing `roundPmf` — the call itself
     * belongs to plan 08-02. This is the input Phase 8's client-side
     * 1000-draw rank simulation draws from for every match at or after a
     * chosen start match, which is why it must exist on a PLAYED row and not
     * only an upcoming one — a rewind start match is the common case (1,312
     * of 1,353 corpus events have no unplayed qualification match at all).
     */
    redRpPmf: z.array(z.number()).optional(),
    /** D-03, plan 08-02 Task 1: the blue alliance's counterpart to `redRpPmf` — see its doc comment for the full contract. */
    blueRpPmf: z.array(z.number()).optional(),
    /**
     * D-15, plan 09-07 — THE SINGLE DEFINITION SITE of the index order every
     * consumer of the RP decomposition cites rather than re-deriving:
     * `matchOutcomePmf[0]` is the probability the red alliance wins,
     * `[1]` a tie, `[2]` a blue win. This is the win/tie half of the RP
     * decomposition `redRpPmf`/`blueRpPmf` were convolved from — published
     * so the rank simulation can draw a match's outcome ONCE instead of
     * drawing each alliance's total independently (today's independent
     * draws let both alliances "win" the same draw). Carries three entries
     * at EVERY configuration; the tie entry is ~0 until D-14's discrete
     * score-margin tie model is selected, so the shape never changes when
     * the model does.
     *
     * OPTIONAL for the same live-artifact reason as `redRpPmf`, following
     * `CompareExclusionCountsSchema.coldStart`'s precedent: this is a LIVE,
     * R2-served shape whose already-published objects predate this field. A
     * required key would fail to parse every one of them and blank the
     * Simulation tab in production before 09-10's republish. Absence
     * genuinely means "this artifact predates the decomposition" and MUST
     * render as absent, never coerced to a default — a reader that
     * substitutes one would silently invent a favourite.
     */
    matchOutcomePmf: z.array(z.number()).optional(),
    /**
     * D-15, plan 09-07: the red alliance's distribution over its BONUS
     * ranking points ONLY — `analyticRpPmf`'s `redBonusPmf`, sums to 1
     * (unlike `redBonusRp` below, a per-bonus MARGINAL that does not).
     * Distinct by name from BOTH neighbours: `redRpPmf` above is the RP
     * TOTAL distribution (win/tie RP and bonus RP already folded in);
     * `redBonusRp` below is a per-bonus marginal whose entries do not sum to
     * 1; this is a distribution over the bonus-RP count alone, independent
     * of the match outcome. Optional for the same live-artifact reason as
     * `matchOutcomePmf`.
     */
    redBonusRpPmf: z.array(z.number()).optional(),
    /** The blue alliance's counterpart to `redBonusRpPmf` — see its doc comment for the full contract. */
    blueBonusRpPmf: z.array(z.number()).optional(),
    /**
     * Quick 260905-jj8 (todo `event-per-bonus-rp-publish`): the red
     * alliance's predicted per-bonus MARGINALS — the exact quantity, under
     * the exact name and positional-alignment contract,
     * `TeamSeasonMatchSchema.redBonusRp` has carried since Phase 06.1 (see
     * that field's doc comment; not restated here). NOT a distribution:
     * never routed through `isValidPmf`. Omitted entirely for a
     * non-qualification match, an algorithm that models no ranking points,
     * or an artifact predating this field — the absence is what the
     * Quals-tab dots render as `unknown`.
     */
    redBonusRp: z.array(z.number().min(0).max(1)).optional(),
    /** Quick 260905-jj8: the blue alliance's counterpart to `redBonusRp` — see `TeamSeasonMatchSchema.redBonusRp` for the full contract. */
    blueBonusRp: z.array(z.number().min(0).max(1)).optional(),
    actualWinner: z.enum(["red", "blue", "tie"]),
    actualRedScore: z.number(),
    actualBlueScore: z.number(),
    /**
     * D-01/D-03 (quick task 260909-t5q): true iff every one of this match's
     * six robots was making its corpus-global first appearance — the SAME
     * stamp `packages/harness/replay.ts`'s `WalkForwardSimulator` attached to
     * this match's `PredictionRecord`, carried through unchanged to the
     * artifact. Present ONLY when `true`, omitted otherwise — mirrors
     * `redSwingBandVariance`'s presence-means-something convention above,
     * rather than a boolean written `false` on the overwhelming majority of
     * rows. Read by both match tables' Call column to render the neutral
     * em-dash with a distinct accessible label; see
     * `TeamSeasonMatchSchema.coldStart` for the mirror on the team-season
     * side.
     */
    coldStart: z.literal(true).optional(),
    /**
     * D-12, plan 08-02 Task 2: this alliance's actual bonus ranking points
     * for this match — the same quantity under the same name that
     * `TeamSeasonMatchSchema.actualRedRp` has carried since Phase 6 (see that
     * field's doc comment for the full provenance through the ingest's
     * ranking-point extraction, not restated here). Three published states,
     * none conflated: the key **absent** entirely means this artifact
     * predates the field; an explicit **`null`** means the fact is not
     * derivable from the available data; a present **integer**, including a
     * real `0`, is TBA's own reported bonus RP for that alliance. `null` is
     * never coerced to `0` — a coerced zero would be a positive claim that
     * an alliance earned no ranking points, and D-12's summed fallback then
     * sums exactly these values into a team's already-earned baseline on the
     * events where TBA's own Ranking Score is absent, which are precisely
     * the events where the data is weakest. It is an integer count published
     * unrounded, with no `ROUNDING_RULE` entry. It is explicitly NOT the
     * same quantity as `EventTeamSchema.rp`, which is TBA's Ranking Score, a
     * per-match AVERAGE, a real number, rounded at its own
     * `ROUNDING_RULE.rankingPoints` — the two share three letters and
     * nothing else, and D-12's precedence rule reads one when the other is
     * absent, so a reader who conflates them will implement the wrong
     * fallback. D-12's summed fallback (owned by 08-11) consumes this field
     * across a team's played qualification rows only when `EventTeamSchema
     * .rp` is absent, with a `null` contributing nothing to that sum while
     * marking the team's baseline as known-incomplete.
     */
    actualRedRp: z.number().int().nullable().optional(),
    /** D-12, plan 08-02 Task 2: the blue alliance's counterpart to `actualRedRp` — see its doc comment for the full three-state contract. */
    actualBlueRp: z.number().int().nullable().optional(),
    /**
     * Quick 260905-jj8: the algorithm-independent ACTUAL per-bonus outcome —
     * the exact three-state contract (absent / explicit `null` /
     * present array) `TeamSeasonMatchSchema.actualRedBonusRp` documents in
     * full; not restated here. `null` is NEVER coerced to an all-false
     * array, for that field's own stated reason.
     */
    actualRedBonusRp: z.array(z.boolean()).nullable().optional(),
    /** Quick 260905-jj8: the blue alliance's counterpart to `actualRedBonusRp` — see `TeamSeasonMatchSchema.actualRedBonusRp` for the full three-state contract. */
    actualBlueBonusRp: z.array(z.boolean()).nullable().optional(),
    /**
     * Quick task 260906-7eu: the raw YouTube video key TBA published for this
     * match, as `packages/ingest/normalize.ts`'s `normalizeMatch` extracted
     * it — verbatim, including any trailing timestamp suffix. Omitted
     * entirely (never published empty) rather than `.nullable()`: absence is
     * the single state meaning "no video", whether because TBA has genuinely
     * published none for this match or because this artifact predates the
     * field — one representation, so no reader has to handle two. Carries no
     * `ROUNDING_RULE` entry because it is not a number. Deliberately NOT
     * added to `EventUpcomingMatchSchema`: an unplayed match has no video, so
     * the field there would be published weight that is always absent.
     */
    video: z.string().min(1).optional(),
  })
  .refine((row) => isValidPmf(row.redRpPmf), {
    message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueRpPmf), {
    message: "blueRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueRpPmf"],
  })
  .refine((row) => isValidPmf(row.matchOutcomePmf), {
    message: "matchOutcomePmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["matchOutcomePmf"],
  })
  .refine((row) => isValidPmf(row.redBonusRpPmf), {
    message: "redBonusRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redBonusRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueBonusRpPmf), {
    message: "blueBonusRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueBonusRpPmf"],
  })
  .refine(
    (row) => {
      const arrays = [row.redBonusRp, row.blueBonusRp, row.actualRedBonusRp, row.actualBlueBonusRp];
      // Absence, not emptiness, represents absent data — mirrors
      // TeamSeasonMatchSchema's identical refine verbatim.
      return arrays.every((array) => array === undefined || array === null || array.length > 0);
    },
    {
      message:
        "redBonusRp/blueBonusRp/actualRedBonusRp/actualBlueBonusRp, when present as an array, must be non-empty — absence (an omitted key), not emptiness, represents absent data",
      path: ["redBonusRp"],
    }
  )
  .refine(
    (row) => {
      if (row.redBonusRp === undefined || row.blueBonusRp === undefined) return true;
      return row.redBonusRp.length === row.blueBonusRp.length;
    },
    {
      message: "redBonusRp and blueBonusRp, when both present, must have equal length — both alliances share one season's bonus set",
      path: ["redBonusRp"],
    }
  )
  .refine(
    (row) => {
      if (row.actualRedBonusRp === undefined || row.actualRedBonusRp === null) return true;
      if (row.actualBlueBonusRp === undefined || row.actualBlueBonusRp === null) return true;
      return row.actualRedBonusRp.length === row.actualBlueBonusRp.length;
    },
    {
      message:
        "actualRedBonusRp and actualBlueBonusRp, when both present and non-null, must have equal length — both alliances share one season's bonus set",
      path: ["actualRedBonusRp"],
    }
  );

/**
 * D-08: an upcoming (not-yet-played) match's full predicted-parameters
 * shape. `redRpPmf`/`blueRpPmf` are omitted entirely (never an empty array)
 * for an algorithm that does not model RP, matching `Prediction`'s existing
 * convention — see `EventMatchSchema.redRpPmf` for the shared contract, not
 * restated here.
 *
 * D-03, plan 08-02 Task 3: corrected division of labour — Phase 8's rank
 * simulation reads BOTH this array and `EventMatchSchema`'s, not this one
 * alone. A rewind start match that has already been played is the COMMON
 * case (1,312 of 1,353 corpus events have no unplayed qualification match
 * at all), so `EventMatchSchema`'s played rows are the simulation's primary
 * input on nearly every browsable event; this array remains exactly what it
 * has always been, the shape for a genuinely not-yet-played match, and is
 * the exact and leak-free input for the live case (D-01).
 */
const EventUpcomingMatchSchema = z
  .object({
    matchKey: z.string().min(1),
    compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
    setNumber: z.number().int(),
    matchNumber: z.number().int(),
    /** D-13, plan 07-07 Task 1: see `EventMatchSchema.sortTime`'s doc comment for the full contract — same field, same spelling, same two jobs (ordering key and, here, the value this UPCOMING row's Actual column displays as a scheduled time). */
    sortTime: z.number().int().optional(),
    redTeams: z.array(z.string()),
    blueTeams: z.array(z.string()),
    predictedWinner: z.enum(["red", "blue"]),
    pRedWin: z.number(),
    predictedRedScore: z.number(),
    predictedBlueScore: z.number(),
    /** D-18 item 3, plan 07-07 Task 1: see `EventMatchSchema.redScoreVarianceOwn`/`blueScoreVarianceOwn`'s doc comments for the full contract — same fields, same spelling, same optional-when-OPR/EPA convention. */
    redScoreVarianceOwn: z.number().optional(),
    blueScoreVarianceOwn: z.number().optional(),
    /**
     * SIGMASCOUT-LAYER match band (quick task 260908-5wd): this alliance's
     * variance as `Σ its three teams' Swing Factor²`, walk-forward as of this
     * match — so a match's band never uses matches that came after it.
     *
     * DELIBERATELY DISTINCT FROM `redScoreVarianceOwn`, which is the
     * ALGORITHM's own predictive variance and is published only by the
     * algorithms that model one (VPR, BPR — never OPR or EPA). This field is
     * the scouting-heuristic layer built on top of whatever the algorithm
     * predicted, computed identically for EVERY algorithm from nothing but its
     * predicted and actual scores. See `packages/harness/swingFactor.ts` for
     * the two-level split and the measured constants.
     *
     * Absent for the opening matches of a team's season, where no roster member
     * yet has the two observations a centred swing needs — an honest "we do not
     * know yet" rather than a fabricated width. Rounded once, at the publish
     * boundary, at `ROUNDING_RULE.variance`.
     */
    redSwingBandVariance: z.number().optional(),
    /** The blue alliance's counterpart to `redSwingBandVariance` — see its doc comment for the full contract. */
    blueSwingBandVariance: z.number().optional(),
    redRpPmf: z.array(z.number()).optional(),
    blueRpPmf: z.array(z.number()).optional(),
    /** D-15, plan 09-07 — see `EventMatchSchema.matchOutcomePmf` for the full contract; this is the sibling on a not-yet-played row, following the same optional-when-live-artifact convention as `redRpPmf` above. */
    matchOutcomePmf: z.array(z.number()).optional(),
    /** D-15, plan 09-07 — see `EventMatchSchema.redBonusRpPmf` for the full contract. */
    redBonusRpPmf: z.array(z.number()).optional(),
    /** The blue alliance's counterpart to `redBonusRpPmf` — see `EventMatchSchema.redBonusRpPmf` for the full contract. */
    blueBonusRpPmf: z.array(z.number()).optional(),
    /** Quick 260905-jj8: predicted per-bonus marginals for a not-yet-played qualification match — see `TeamSeasonMatchSchema.redBonusRp` for the full contract (positional alignment, never a pmf, omitted for non-`qm`/non-RP algorithms). */
    redBonusRp: z.array(z.number().min(0).max(1)).optional(),
    /** Quick 260905-jj8: the blue counterpart to `redBonusRp` above. */
    blueBonusRp: z.array(z.number().min(0).max(1)).optional(),
  })
  .refine((row) => isValidPmf(row.redRpPmf), {
    message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueRpPmf), {
    message: "blueRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueRpPmf"],
  })
  .refine((row) => isValidPmf(row.matchOutcomePmf), {
    message: "matchOutcomePmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["matchOutcomePmf"],
  })
  .refine((row) => isValidPmf(row.redBonusRpPmf), {
    message: "redBonusRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redBonusRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueBonusRpPmf), {
    message: "blueBonusRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueBonusRpPmf"],
  })
  .refine(
    (row) => {
      const arrays = [row.redBonusRp, row.blueBonusRp];
      return arrays.every((array) => array === undefined || array.length > 0);
    },
    {
      message: "redBonusRp/blueBonusRp, when present, must be non-empty — absence (an omitted key), not emptiness, represents absent data",
      path: ["redBonusRp"],
    }
  )
  .refine(
    (row) => {
      if (row.redBonusRp === undefined || row.blueBonusRp === undefined) return true;
      return row.redBonusRp.length === row.blueBonusRp.length;
    },
    {
      message: "redBonusRp and blueBonusRp, when both present, must have equal length — both alliances share one season's bonus set",
      path: ["redBonusRp"],
    }
  );

/** D-07: a team competing at an event, carrying its current metrics — the event page's standings-style table. */
const EventTeamSchema = z.object({
  teamKey: z.string().min(1),
  teamNumber: z.number().int().optional(),
  nickname: z.string().optional(),
  /**
   * D-18 item 6, D-07, plan 07-07 Task 2: this team's official rank at this
   * event, sourced from `event_rankings.rank` through
   * `selectEventRankingsForSeason` (`packages/corpus/db.ts`). Optional for
   * two independent reasons: 259 of 1,581 corpus events have no ranking
   * rows at all (D-08's measured count), and a pre-republish artifact
   * predates the field entirely. Absence is never synthesized and never
   * zero — D-08's fallback ordering is rendered by 07-11 and must never be
   * written INTO this field: a model-derived position placed under a name
   * that asserts official provenance is a false attribution the reader has
   * no way to detect. `rank`, `record` and `rp` are independently
   * optional; a half-present set is a REAL state (an `event_rankings` row
   * written before 07-04's widened ingest carries a rank with a NULL
   * record and a NULL ranking score), so there is deliberately no
   * cross-field `.refine()` here — matching
   * `TeamSeasonEventSchema.rank`'s own stated choice (PD-05).
   */
  rank: z.number().int().positive().optional(),
  /**
   * D-18 item 6, D-07, plan 07-07 Task 2: TBA's own reported record for
   * this team at this event, which accounts for disqualifications and
   * surrogate appearances — never a tally this pipeline counted from
   * `matches[]` (D-18 item 6's own stated reason for requiring TBA as the
   * source). Reuses `RecordSchema`'s existing three integers; never a
   * formatted string. Rendering is 07-11's.
   */
  record: RecordSchema.optional(),
  /**
   * D-18 item 6, D-07, plan 07-07 Task 2: TBA's Ranking Score,
   * `sort_orders[0]`, guarded at ingest by 07-04's
   * `sort_order_info[0].name === "Ranking Score"` assertion and stored in
   * the corpus column `ranking_score` (07-02) — recording that naming hop
   * explicitly here, at this end as well as the storage end, so the column
   * and the field cannot quietly become two different facts. It is a
   * per-match average and therefore a REAL rather than an integer count.
   * Rounded exactly once, at the publish boundary, at
   * `ROUNDING_RULE.rankingPoints`. It is explicitly NOT the same quantity
   * as `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`, which are
   * integer bonus-RP counts published unrounded — the two share three
   * letters and nothing else, and a reader who conflates them will misread
   * both.
   */
  rp: z.number().optional(),
  metrics: MetricsRecordSchema,
});

/**
 * The prediction-vs-actual fields from `packages/harness/predictions.ts`'s
 * `PredictionRecordSchema`, reconstructed locally (that schema is a
 * `ZodEffects` from its own `.refine()` calls and cannot be `.extend()`-ed)
 * plus `redTeams`/`blueTeams`, since a team-season artifact's per-match row
 * needs the alliance rosters `PredictionRecordSchema` itself does not carry.
 *
 * Phase 6 (D-01/D-02/D-09, TEAM-04/TEAM-05) widens this row for the team
 * page: every field added below is `.optional()`, so a team artifact
 * published before this phase's republish still parses (see this file's
 * header rule and the D-09 note directly below). None of the new fields is
 * rounded a second time here — rounding happens once, at
 * `packages/harness/publish.ts`'s publish boundary.
 */
const TeamSeasonMatchSchema = z
  .object({
    matchKey: z.string().min(1),
    season: z.number().int(),
    eventKey: z.string().min(1),
    compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
    algorithmId: z.string().min(1),
    algorithmVersion: z.string().min(1),
    predictedWinner: z.enum(["red", "blue"]),
    pRedWin: z.number(),
    predictedRedScore: z.number(),
    predictedBlueScore: z.number(),
    variance: z.number().optional(),
    /**
     * D-01 (Phase 6), redefined by D-01/D-02 (plan 07-06): each alliance's
     * OWN predicted-score variance — mirrors `packages/core/algorithms/
     * types.ts`'s `Prediction.redScoreVarianceOwn`/`blueScoreVarianceOwn`.
     * This is NOT the same quantity as `variance` above (the red+blue SUM,
     * the win-probability denominator) — that distinction stays real and
     * unaffected. It IS, since plan 07-06, the alliance-level aggregation of
     * exactly the SAME quantity a `TeamMetric.spread` elsewhere in this file
     * carries at the per-team level: this field equals the sum of its three
     * teams' `TeamMetric.spread` squares, by construction, per this file's
     * header rule. Populated by Sigma1, left `undefined` by OPR/EPA (neither
     * models an alliance-level own variance), following `variance`'s own
     * optional convention above. Reuses `ROUNDING_RULE.variance` unchanged
     * at the publish boundary — same physical quantity, same existing rule,
     * no new rounding rule needed.
     */
    redScoreVarianceOwn: z.number().optional(),
    /** D-01 (Phase 6): the blue alliance's counterpart to `redScoreVarianceOwn` — see its doc comment for the full contract. */
    blueScoreVarianceOwn: z.number().optional(),
    /**
     * SIGMASCOUT-LAYER match band (quick task 260908-5wd): this alliance's
     * variance as `Σ its three teams' Swing Factor²`, walk-forward as of this
     * match — so a match's band never uses matches that came after it.
     *
     * DELIBERATELY DISTINCT FROM `redScoreVarianceOwn`, which is the
     * ALGORITHM's own predictive variance and is published only by the
     * algorithms that model one (VPR, BPR — never OPR or EPA). This field is
     * the scouting-heuristic layer built on top of whatever the algorithm
     * predicted, computed identically for EVERY algorithm from nothing but its
     * predicted and actual scores. See `packages/harness/swingFactor.ts` for
     * the two-level split and the measured constants.
     *
     * Absent for the opening matches of a team's season, where no roster member
     * yet has the two observations a centred swing needs — an honest "we do not
     * know yet" rather than a fabricated width. Rounded once, at the publish
     * boundary, at `ROUNDING_RULE.variance`.
     */
    redSwingBandVariance: z.number().optional(),
    /** The blue alliance's counterpart to `redSwingBandVariance` — see its doc comment for the full contract. */
    blueSwingBandVariance: z.number().optional(),
    redRpPmf: z.array(z.number()).optional(),
    blueRpPmf: z.array(z.number()).optional(),
    // D-09 (Phase 6): relaxed from required to optional so an unplayed
    // (scheduled but not yet played) match is structurally representable —
    // TEAM-04's "section per attended OR UPCOMING event" is otherwise
    // unbuildable. The type-level "a match always has a result" guarantee
    // this relaxation removes is replaced below by a cross-field `.refine()`
    // (not deleted): a row carrying any one of these three must carry all
    // three; a row carrying none of them is a valid unplayed match. See
    // `06-CONTEXT.md` D-09 and `06-02-PLAN.md`'s Task 3 for the test that
    // proves this rule actually fires when removed.
    actualWinner: z.enum(["red", "blue", "tie"]).optional(),
    actualRedScore: z.number().optional(),
    actualBlueScore: z.number().optional(),
    /** D-01/D-03 (quick task 260909-t5q): the mirror of `EventMatchSchema.coldStart` — see its doc comment for the full contract. */
    coldStart: z.literal(true).optional(),
    /**
     * D-02 (Phase 6): actual bonus ranking points, sourced from
     * `MatchResult.redRpEarned`/`blueRpEarned` (`packages/core/algorithms/
     * types.ts`). Resolved null contract (RESEARCH.md A5, verified against
     * `packages/ingest/normalize.ts`'s `extractRp`, NOT `rp/constants.ts` —
     * this field is populated at ingest time from TBA's raw
     * `score_breakdown.{color}.rp`, before Sigma1's RP rule modules ever
     * see the match): `null` means "not derivable from the available data"
     * — either the match has no `score_breakdown` at all
     * (`hasScoreBreakdown: false`, e.g. an unplayed match) or a present
     * breakdown is missing the `rp`/`tba_rpEarned` field entirely. It is
     * NEVER coerced from `null` to `0`, and it does NOT mean "this event
     * tier has no RP rules" — TBA reports a real `rp` value (commonly `0`)
     * for every played match regardless of tier, including elimination
     * matches (`ELIMINATION_RP_TOTAL`, `rp/constants.ts`). A genuine
     * integer `0` is therefore a meaningfully different, more informative
     * value than `null` and must never be conflated with it. Bonus RP is
     * always a non-negative integer count, never rounded at the publish
     * boundary (asserted by a schema-level `.int()` rather than a new
     * `ROUNDING_RULE` entry).
     */
    actualRedRp: z.number().int().nullable().optional(),
    /** D-02 (Phase 6): the blue alliance's counterpart to `actualRedRp` — see its doc comment for the full null contract. */
    actualBlueRp: z.number().int().nullable().optional(),
    /**
     * Phase 06.1 (F-06-1, PD-04): each entry is the predicted PROBABILITY
     * that the red alliance earns the bonus at the SAME INDEX of that
     * season's bonus-name list (`RpRuleModule.bonusNames`) — a positional
     * array pinned client-side by an existing passing test, not a keyed
     * record (measured payload cost: ~124 bytes/match row for the array vs
     * ~238 for the record, plan 06.1-02's PD-04). These are independent
     * per-bonus MARGINALS: they do NOT sum to 1, and must never be routed
     * through `isValidPmf`/the pmf rounding path below — that redistribution
     * is only meaningful for a distribution required to sum to 1. This is a
     * DIFFERENT quantity from `redRpPmf` above, which is a distribution over
     * the RP TOTAL, not a per-bonus marginal. Omitted entirely (never
     * published as an empty array) when `analyticRpPmf` did not run for
     * this match (plan 09-04 — the zero-draws fast path this doc comment
     * used to name is GONE; a closed form has no draw count to skip) — a
     * non-qualification competition level, an RP-ineligible event type, or
     * an algorithm that does not model ranking points at all. Rounded
     * exactly once, at the publish boundary, at `ROUNDING_RULE.probability`.
     */
    redBonusRp: z.array(z.number().min(0).max(1)).optional(),
    /** Phase 06.1 (F-06-1): the blue alliance's counterpart to `redBonusRp` — see its doc comment for the full contract. */
    blueBonusRp: z.array(z.number().min(0).max(1)).optional(),
    /**
     * Phase 06.1 (F-06-3, PD-10): the algorithm-independent ACTUAL per-bonus
     * outcome, positionally aligned to the same season bonus-name list
     * `redBonusRp` uses. Three distinct published states, never conflated:
     *   - the key **absent** entirely: this artifact predates the field, or
     *     the season has no registered RP rule module (no bonus vocabulary
     *     to publish at all).
     *   - an explicit **`null`**: the pipeline looked and the fact is not
     *     derivable — the match has no `score_breakdown`, its breakdown
     *     threw on parse, or its event type is RP-ineligible.
     *   - a **present array**: a real per-bonus answer, one boolean per
     *     entry of that season's bonus-name list.
     * `null` is NEVER coerced to an all-false array — an all-false array
     * would be a POSITIVE claim that every bonus was missed, which the data
     * does not support when the true answer is simply unknown. This is the
     * exact same reason `actualRedRp` above is never coerced from `null` to
     * `0`.
     */
    actualRedBonusRp: z.array(z.boolean()).nullable().optional(),
    /** Phase 06.1 (F-06-3): the blue alliance's counterpart to `actualRedBonusRp` — see its doc comment for the full three-state contract. */
    actualBlueBonusRp: z.array(z.boolean()).nullable().optional(),
    /**
     * D-08/TEAM-04 (Phase 6): the Match column's human label — today
     * derivable only by parsing the opaque `matchKey`, the same class of
     * mistake `eventName: eventKey` already shipped (06-RESEARCH.md
     * Pitfall 1). Published directly instead of re-derived client-side.
     */
    setNumber: z.number().int().optional(),
    /** D-08/TEAM-04 (Phase 6): see `setNumber`'s doc comment. */
    matchNumber: z.number().int().optional(),
    /**
     * D-08 (Phase 6): this match's chronological sort key, in epoch
     * seconds — used for ORDERING every row (played and unplayed alike),
     * and additionally DISPLAYED as the Actual column's value for an
     * unplayed row only (a played row's Actual column instead shows
     * `actualRedScore`/`actualBlueScore`). For a played row this is the
     * match's actual start time, not its scheduled time.
     */
    sortTime: z.number().int().optional(),
    redTeams: z.array(z.string()),
    blueTeams: z.array(z.string()),
    /** Quick task 260906-7eu: see `EventMatchSchema.video`'s doc comment for the full contract — same field, same spelling, same absence-means-no-video convention. */
    video: z.string().min(1).optional(),
  })
  .refine((row) => isValidPmf(row.redRpPmf), {
    message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueRpPmf), {
    message: "blueRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueRpPmf"],
  })
  .refine(
    (row) => {
      const defined = [row.actualWinner !== undefined, row.actualRedScore !== undefined, row.actualBlueScore !== undefined];
      const definedCount = defined.filter(Boolean).length;
      // All three defined (a played match) or none defined (a valid
      // unplayed match) — anything in between is an inconsistent row.
      return definedCount === 0 || definedCount === 3;
    },
    {
      message:
        "a played match (any one of actualWinner/actualRedScore/actualBlueScore defined) must carry all three; an unplayed match must carry none of them",
      path: ["actualWinner"],
    }
  )
  .refine(
    (row) => {
      const arrays = [row.redBonusRp, row.blueBonusRp, row.actualRedBonusRp, row.actualBlueBonusRp];
      // Absence, not emptiness, is the representation for absent data — any
      // of the four per-bonus arrays, when present (including a present
      // `null`, which is not an array and is skipped here), must be
      // non-empty.
      return arrays.every((array) => array === undefined || array === null || array.length > 0);
    },
    {
      message:
        "redBonusRp/blueBonusRp/actualRedBonusRp/actualBlueBonusRp, when present as an array, must be non-empty — absence (an omitted key), not emptiness, represents absent data",
      path: ["redBonusRp"],
    }
  )
  .refine(
    (row) => {
      if (row.redBonusRp === undefined || row.blueBonusRp === undefined) return true;
      return row.redBonusRp.length === row.blueBonusRp.length;
    },
    {
      message: "redBonusRp and blueBonusRp, when both present, must have equal length — both alliances share one season's bonus set",
      path: ["redBonusRp"],
    }
  )
  .refine(
    (row) => {
      if (row.actualRedBonusRp === undefined || row.actualRedBonusRp === null) return true;
      if (row.actualBlueBonusRp === undefined || row.actualBlueBonusRp === null) return true;
      return row.actualRedBonusRp.length === row.actualBlueBonusRp.length;
    },
    {
      message:
        "actualRedBonusRp and actualBlueBonusRp, when both present and non-null, must have equal length — both alliances share one season's bonus set",
      path: ["actualRedBonusRp"],
    }
  );

// ---------------------------------------------------------------------------
// TeamsArtifactSchema — v1/teams/{year}/{algorithmId}@{version}.json
//
// 260902-pbe: the teams artifact's `metrics` field is encoded POSITIONALLY —
// see the payload-budget attribution this quick task resolves
// (`.planning/todos/pending/payload-budget-teams-and-team-page-overage.md`):
// the 17 metric key strings repeated across ~3,549 rows cost 979,248 B
// (26.4%) of the artifact on their own. `MetricsRecordSchema` above is
// SHARED by the team-season `seasonStats` and the event artifact's
// standings row — this encoding applies to the teams-table row ONLY, so
// neither of those two other consumers changes shape at all.
//
// Two schemas exist for exactly this reason:
//   - `TeamsArtifactWireSchema` validates the WIRE shape as written/read —
//     a row's `metrics` is EITHER the pre-existing object-form record
//     (back-compat: production serves this shape until the later republish)
//     OR the new positional array. It does NOT decode; `publish.ts`'s
//     `buildTeamsArtifact` and `apps/worker/src/scheduled.ts`'s
//     `runGlobalRebuild` both validate-and-return THIS schema's shape,
//     because that returned object is exactly what gets `JSON.stringify`'d
//     to R2 — decoding it here would silently undo the entire wire saving.
//   - `TeamsArtifactSchema` wraps the wire schema with a `.transform()` that
//     DECODES every row's `metrics` to the one canonical record-form shape
//     every other consumer already expects, regardless of which shape was
//     actually on the wire. `apps/web`'s `fetchTeamsArtifact` and
//     `rowModel.ts`'s `buildTeamRows` both parse/read through THIS schema,
//     so neither needed a functional change for this task — decoding both
//     shapes happens once, here, at the schema boundary.
// ---------------------------------------------------------------------------

/**
 * 260902-pbe: one team's one metric, encoded positionally for the
 * teams-table row. Four states, chosen by array length so the shape stays
 * unambiguous without a discriminant field:
 *
 *   - `null` — this metric is absent for this row entirely (the published
 *     key set the declared metric list allows is a per-algorithm union, not
 *     a guarantee every row carries every key) — never confused with a
 *     metric that IS present but carries no `spread`.
 *   - `[value]` — present, no `spread`, no `tier`. Every OPR row, and most
 *     EPA rows, are length-1 (D-07: neither models an alliance/team-level
 *     own variance, so "no spread" is normal, not an error). As of quick
 *     task 260904-7id (D-1) this is no longer true for EPA's THREE group
 *     metrics (`phaseAuto`/`phaseTeleop`/`phaseEndgame`): those carry a
 *     season-wide percentile/tier from the publish pipeline exactly like any
 *     other tiered metric, so they occupy the three-element form below
 *     instead — EPA's raw components and `total` are unaffected and stay
 *     length-1.
 *   - `[value, spread]` — present with a real `spread` (including a
 *     genuine `0`, which is a real measured spread and never coerced from
 *     "absent"), no `tier` (Common, which renders unboxed — see
 *     `TeamMetricSchema.tier`'s own doc comment).
 *   - `[value, spread | null, tier]` — a boxed tier. The middle slot is
 *     `null` when this metric has a tier but no spread (carries tier's
 *     presence without inventing a spread), and the real number otherwise —
 *     `null` here is unambiguous with a real `0` because they are never the
 *     same JSON value.
 */
const PositionalMetricEntrySchema = z.union([
  z.null(),
  z.tuple([z.number()]),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number().nullable(), z.enum(TEAM_METRIC_TIERS)]),
]);

type PositionalMetricEntry = z.infer<typeof PositionalMetricEntrySchema>;

/**
 * Encodes one team's one metric into its positional wire slot (see
 * `PositionalMetricEntrySchema`'s doc comment for the four-state contract).
 * `undefined` (key absent from the row's metrics record) encodes to `null`,
 * matching the decode side's own absent-vs-present-zero distinction.
 *
 * Throws on a metric carrying `percentile` — the teams-table row has never
 * published `percentile` (`publish.ts`'s `withPublishedTiers` replaces it
 * with `tier` before a metric ever reaches this row; `apps/worker/src/
 * scheduled.ts`'s incremental rebuild never computes one at all), and this
 * positional encoding has no slot for it. A future caller that started
 * attaching a percentile to a teams row would need this encoding extended
 * deliberately — silently dropping the field here would be a real, silent
 * loss of a real published quantity.
 */
export function encodeTeamMetricEntry(metric: PublishedTeamMetric | undefined): PositionalMetricEntry {
  if (metric === undefined) return null;
  if (metric.percentile !== undefined) {
    throw new Error(
      "encodeTeamMetricEntry: the teams-table positional encoding has no slot for `percentile` — only `tier` is ever published on a teams row (see this function's doc comment)"
    );
  }
  if (metric.tier !== undefined) {
    return [metric.value, metric.spread ?? null, metric.tier];
  }
  if (metric.spread !== undefined) {
    return [metric.value, metric.spread];
  }
  return [metric.value];
}

/** The exact inverse of `encodeTeamMetricEntry` — `undefined` for `null` (absent), otherwise the reconstructed metric object. */
export function decodeTeamMetricEntry(entry: PositionalMetricEntry): PublishedTeamMetric | undefined {
  if (entry === null) return undefined;
  if (entry.length === 1) return { value: entry[0] };
  if (entry.length === 2) return { value: entry[0], spread: entry[1] };
  const [value, spread, tier] = entry;
  return { value, ...(spread !== null ? { spread } : {}), tier };
}

/**
 * Encodes one team's full metrics record into the positional array aligned
 * to `metricKeys` — index `i` of the result is `metricKeys[i]`'s slot for
 * this row, per `encodeTeamMetricEntry`.
 */
export function encodeTeamsRowMetrics(metrics: Readonly<Record<string, PublishedTeamMetric>>, metricKeys: readonly string[]): PositionalMetricEntry[] {
  return metricKeys.map((key) => encodeTeamMetricEntry(metrics[key]));
}

/** The exact inverse of `encodeTeamsRowMetrics` — a metric key whose slot decodes to `undefined` (absent) is omitted from the result entirely, never written as a key with an `undefined` value. */
export function decodeTeamsRowMetrics(entries: readonly PositionalMetricEntry[], metricKeys: readonly string[]): MetricsRecordOut {
  const result: MetricsRecordOut = {};
  metricKeys.forEach((key, index) => {
    const decoded = decodeTeamMetricEntry(entries[index] ?? null);
    if (decoded !== undefined) result[key] = decoded;
  });
  return result;
}

/**
 * The ordered metric-key union across a set of teams-table rows' metrics
 * records, first-seen order (stable within one call, since a JS object's
 * own string-key enumeration order is insertion order) — used by
 * `publish.ts`'s `buildTeamsArtifact` and `apps/worker/src/scheduled.ts`'s
 * `runGlobalRebuild` to derive ONE artifact's `metricKeys` preamble from
 * whatever rows it is about to write, rather than hardcoding a
 * per-algorithm list here that this file (a plain Zod schema module) has no
 * business owning.
 */
export function deriveMetricKeyOrder(metricsRecords: readonly Readonly<Record<string, unknown>>[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const record of metricsRecords) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

/**
 * D-05's first at-risk artifact (~3,750 rows). Kept as narrow as a sortable
 * table actually needs — anything a row does not need for the teams table
 * belongs on the team page (`TeamSeasonArtifactSchema`) instead.
 *
 * Deliberately does NOT extend `RecordAndMetricsSchema` (unlike before
 * 260902-pbe) — that shared schema's `metrics` field is fixed to
 * `MetricsRecordSchema`'s object form, and this row's `metrics` must accept
 * the positional array too. `record` still reuses the shared `RecordSchema`
 * unchanged.
 */
const TeamsTableRowRawSchema = z.object({
  teamKey: z.string().min(1),
  teamNumber: z.number().int(),
  nickname: z.string(),
  /**
   * Distinct OFFICIAL events this team played (quick task 260908-615 —
   * see `RecordSchema`'s own comment for the scoping rule and why the
   * offseason data is still present elsewhere in the artifact). A team whose
   * only play was offseason publishes `0` here and still gets a row.
   */
  eventCount: z.number().int().nonnegative(),
  /** OFFICIAL matches played — same scoping as `eventCount` above. */
  matchCount: z.number().int().nonnegative(),
  record: RecordSchema,
  /**
   * SIGMASCOUT-LAYER Swing Factor (quick task 260908-5wd): how much this team's
   * share of its alliance's score swings from match to match, recency-weighted
   * (6-match half-life) and centred on the team's own mean so a MODEL that is
   * consistently wrong about a robot does not read as a robot that is
   * inconsistent.
   *
   * A scouting heuristic layered on top of the algorithm, not a term in it, and
   * computed identically for OPR, EPA, BPR and VPR from nothing but predicted
   * and actual scores — which is why every algorithm has one. Distinct from
   * `TeamMetric.spread`, which is the ALGORITHM's own uncertainty about its
   * rating and exists only for algorithms that model one.
   *
   * Absent for a team with fewer than two played matches: one observation
   * cannot separate model bias from robot swing. Season-final, and rounded once
   * at the publish boundary at `ROUNDING_RULE.metric`. See
   * `packages/harness/swingFactor.ts` for the estimator and its measured
   * constants (including the honest r ≈ 0.59 ceiling).
   */
  swingFactor: z.number().optional(),
  metrics: z.union([MetricsRecordSchema, z.array(PositionalMetricEntrySchema)]),
  /**
   * Quick task 260905-ttv: this team's INFERRED home region
   * (`teamRanks.ts`'s `deriveTeamRegions` — the corpus carries no team
   * addresses, so a consumer must never present these as TBA ground truth).
   * Additive optional fields on one page kind are backward-compatible for
   * every reader, matching the precedent `EventsListRowSchema` and
   * `TeamSeasonArtifactSchema.ranks` already set (and the one quick task
   * 260905-ldu set one day earlier for this same artifact family) — so
   * `PAGE_ARTIFACT_SCHEMA_VERSION` is deliberately NOT bumped for this
   * change. Absent on a pre-republish artifact, or on any team whose region
   * is not derivable; never `null` or `""`.
   */
  country: z.string().optional(),
  stateProv: z.string().optional(),
  districtKey: z.string().optional(),
});

export const TeamsArtifactWireSchema = AlgorithmScopedPreambleSchema.extend({
  season: z.number().int(),
  /**
   * 260902-pbe: the ordered key list every row's POSITIONAL `metrics` array
   * aligns to, carried once here instead of once per row — the entire
   * saving this encoding buys. Optional: absent on a back-compat,
   * object-form artifact (every row's `metrics` is a record, so there is
   * nothing to align), required — enforced by the `.refine()` below, not by
   * this field's own type — on any artifact carrying even one positional
   * row.
   */
  metricKeys: z.array(z.string()).optional(),
  teams: z.array(TeamsTableRowRawSchema),
}).refine(
  (artifact) =>
    artifact.teams.every(
      (row) => !Array.isArray(row.metrics) || (artifact.metricKeys !== undefined && row.metrics.length === artifact.metricKeys.length)
    ),
  {
    message: "a team row with positional (array) metrics requires the artifact's top-level metricKeys list, sized to match that row's array length",
    path: ["metricKeys"],
  }
);

export type TeamsArtifactWire = z.infer<typeof TeamsArtifactWireSchema>;

type TeamsTableRowRaw = z.infer<typeof TeamsTableRowRawSchema>;
type DecodedTeamsTableRow = Omit<TeamsTableRowRaw, "metrics"> & { metrics: MetricsRecordOut };

/** Decodes one wire-shaped teams-table row's `metrics` to the canonical record-form — an object-form row passes through unchanged, a positional row decodes against `metricKeys` (guaranteed defined for any array-form row by `TeamsArtifactWireSchema`'s own `.refine()`, which runs before this ever sees the row). A concrete (non-generic) parameter type, deliberately — a generic constrained on `{ metrics: ... }` left the `.transform()` callback below inferring `{}` for each row under this file's `noUncheckedIndexedAccess`/`verbatimModuleSyntax` config, silently erasing every other row field from `TeamsArtifact`'s exported type. */
function decodeTeamsTableRow(row: TeamsTableRowRaw, metricKeys: readonly string[] | undefined): DecodedTeamsTableRow {
  if (!Array.isArray(row.metrics)) return { ...row, metrics: row.metrics };
  return { ...row, metrics: decodeTeamsRowMetrics(row.metrics, metricKeys!) };
}

/**
 * `metricKeys` is deliberately DROPPED from the decoded output (via
 * destructuring it out, never spread back in) — it is a wire-level
 * implementation detail of the positional encoding, not a fact any
 * consumer of the DECODED artifact needs: every row's `metrics` is already
 * a keyed record after this transform runs, so nothing downstream ever
 * looks the key list up separately. Keeping it would also make
 * `TeamsArtifactSchema.parse(objectForm)` and `TeamsArtifactSchema.parse(
 * positionalForm)` disagree on an object-form and a positional artifact
 * encoding the SAME data — exactly the equivalence this task's own safety
 * argument rests on (see `pageArtifacts.test.ts`).
 */
export const TeamsArtifactSchema = TeamsArtifactWireSchema.transform(({ metricKeys, ...artifact }) => ({
  ...artifact,
  teams: artifact.teams.map((row) => decodeTeamsTableRow(row, metricKeys)),
}));

export type TeamsArtifact = z.infer<typeof TeamsArtifactSchema>;

// ---------------------------------------------------------------------------
// TeamSeasonArtifactSchema — v1/team/{teamKey}/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

const TeamSeasonEventSchema = z.object({
  eventKey: z.string().min(1),
  eventName: z.string(),
  startDate: z.string(),
  matches: z.array(TeamSeasonMatchSchema),
  /**
   * TEAM-04/F-06-3 (plan 06.1-01): this team's TBA-computed standing at this
   * event, sourced from `event_rankings` (`packages/corpus/db.ts`'s
   * `selectEventRankingsForSeason`, filled by TBA's
   * `/event/{key}/rankings`). Optional, following `robotImageUrl`'s own
   * convention: an artifact published before this phase's republish must
   * still parse. Absence means no ranking data was published for this
   * event — never synthesised, never zero. `rank`/`totalTeams` always
   * appear together or not at all (enforced at the ingest/publish
   * boundary, not by a schema-level `.refine()` here — the render layer
   * additionally treats a half-present pair as absent).
   */
  rank: z.number().int().positive().optional(),
  /** TEAM-04/F-06-3 (plan 06.1-01): the size of the ranked pool `rank` is drawn from — see `rank`'s doc comment for the full contract. */
  totalTeams: z.number().int().positive().optional(),
});

/**
 * Quick task 260905-ldu: one World/Country/District/State rank card's worth
 * of data, mirroring `packages/harness/teamRanks.ts`'s `TeamRankScope` —
 * that module computes the value, this schema is only the wire contract for
 * it. `value` is the RAW published scope value (country string, district
 * abbreviation, state-prov abbreviation); it is omitted for `world`, and
 * reader-facing formatting (e.g. `districtDisplayName`) is the client's job,
 * never done here.
 */
const TeamSeasonRankSchema = z.object({
  scope: z.enum(["world", "country", "district", "state"]),
  value: z.string().optional(),
  rank: z.number().int().positive(),
  total: z.number().int().positive(),
});

/**
 * D-07: everything the team page renders in one object. This is D-05's
 * second at-risk artifact (the 292-match outlier) — per D-07 that is the
 * budget test's problem to police, not a reason to split the file; a later
 * reader should not "fix" this by splitting it further.
 */
export const TeamSeasonArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  teamKey: z.string().min(1),
  teamNumber: z.number().int(),
  nickname: z.string(),
  season: z.number().int(),
  seasonStats: RecordAndMetricsSchema.extend({
    /**
     * Quick task 260908-wpo: which basis produced this object's `metrics`.
     * - `"last-official-match"` — this team's metrics as of its own LAST
     *   OFFICIAL (non-offseason, non-Week-0) match, the same snapshot the
     *   Teams list and the team-page header ("As of last official match")
     *   already show. Carried by every team with at least one official match.
     * - `"season-final"` — this team's season-final metrics, which keep
     *   learning through offseason/preseason play. Used ONLY as the fallback
     *   for a team with NO official play at all, so an offseason-only team's
     *   page never publishes an empty metrics object.
     *
     * Scoped to `metrics` alone: `metricHistory` on this same artifact stays
     * season-final regardless of this field's value.
     *
     * Optional at parse — `.optional()` here, not required — so an artifact
     * published before quick task 260908-wpo (whose `seasonStats.metrics`
     * was unconditionally season-final, with no field naming that) still
     * parses during the republish window rather than hard-failing every
     * CDN-cached pre-republish artifact. Mandatory on the write side instead:
     * `buildTeamSeasonArtifact` requires a basis from every caller.
     */
    metricsBasis: z.enum(["last-official-match", "season-final"]).optional(),
  }),
  /**
   * SIGMASCOUT-LAYER Swing Factor (quick task 260908-5wd): how much this team's
   * share of its alliance's score swings from match to match, recency-weighted
   * (6-match half-life) and centred on the team's own mean so a MODEL that is
   * consistently wrong about a robot does not read as a robot that is
   * inconsistent.
   *
   * A scouting heuristic layered on top of the algorithm, not a term in it, and
   * computed identically for OPR, EPA, BPR and VPR from nothing but predicted
   * and actual scores — which is why every algorithm has one. Distinct from
   * `TeamMetric.spread`, which is the ALGORITHM's own uncertainty about its
   * rating and exists only for algorithms that model one.
   *
   * Absent for a team with fewer than two played matches: one observation
   * cannot separate model bias from robot swing. Season-final, and rounded once
   * at the publish boundary at `ROUNDING_RULE.metric`. See
   * `packages/harness/swingFactor.ts` for the estimator and its measured
   * constants (including the honest r ≈ 0.59 ceiling).
   */
  swingFactor: z.number().optional(),
  events: z.array(TeamSeasonEventSchema),
  /** D-28: the team's metric-history series, one row per match, using `MetricHistoryRowSchema`'s own field names (reused directly, not re-derived) so the team page's plot never has to translate between the sidecar and the published file. */
  metricHistory: z.array(MetricHistoryRowSchema),
  /**
   * D-03 (Phase 6, TEAM-02): the pipeline-resolved robot image URL for this
   * team/season, from TBA's `/team/{key}/media/{year}` — a `preferred`
   * photo-bearing entry where flagged, otherwise the first photo-bearing
   * entry (never TBA's `avatar` media kind, which carries an inline
   * `base64Image`, not a usable `direct_url`). Optional: measured ~25% of
   * real teams have no eligible photo at all, and the client must render a
   * fallback tile for both that case and any not-yet-republished artifact.
   */
  robotImageUrl: z.string().url().optional(),
  /**
   * D-05 (Phase 6, D-18): the seasons this team is known to have competed
   * in, feeding the team page's constrained year dropdown. Optional and
   * deliberately NOT relied upon as if always present: its absence (a
   * not-yet-republished artifact, or a genuinely never-populated team) is a
   * valid state the client must handle by falling back to the
   * unconstrained global year list — this is what keeps a partial artifact
   * from wrongly narrowing the dropdown (D-19's empty-state bootstrap
   * note).
   */
  activeYears: z.array(z.number().int()).optional(),
  /**
   * Quick task 260905-ldu: this team's World/Country/District/State rank
   * cards for this algorithm/season, at most one entry per scope (world,
   * country, district, state), in that order. Optional following the same
   * argument `activeYears`/`robotImageUrl` above already make: absence is a
   * valid state a client must handle, because a browser can hold an
   * artifact published before this field existed — it renders zero cards,
   * never a placeholder. PAGE_ARTIFACT_SCHEMA_VERSION is deliberately NOT
   * bumped for this, matching `EventsListRowSchema`'s own recorded
   * precedent: an additive optional field on one page kind is
   * backward-compatible for every reader.
   */
  ranks: z.array(TeamSeasonRankSchema).max(4).optional(),
});

export type TeamSeasonArtifact = z.infer<typeof TeamSeasonArtifactSchema>;

// ---------------------------------------------------------------------------
// EventsArtifactSchema — v1/events/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

/**
 * plan 05-02 (EVNT-01): `country`, `stateProv` and `districtKey` are new
 * here. PAGE_ARTIFACT_SCHEMA_VERSION is deliberately NOT bumped for this —
 * additive nullable fields on one page kind are backward-compatible for any
 * reader, and this phase is the artifact's only consumer. A decision, not
 * an oversight.
 */
const EventsListRowSchema = z.object({
  eventKey: z.string().min(1),
  name: z.string(),
  eventType: z.number().int(),
  isOffseason: z.boolean(),
  startDate: z.string(),
  /** The FRC competition week; `null` when it cannot be derived. */
  week: z.number().int().nullable(),
  teamCount: z.number().int().nonnegative(),
  matchCount: z.number().int().nonnegative(),
  /** Together with `matchCount`, makes an in-progress event visible without a separate liveness field. */
  playedMatchCount: z.number().int().nonnegative(),
  /** From TBA's `country` field (plan 05-02, EVNT-01); `null` means the event genuinely has no recorded country. */
  country: z.string().nullable(),
  /** From TBA's `state_prov` field (plan 05-02, EVNT-01); `null` means the event genuinely has no recorded state/province. */
  stateProv: z.string().nullable(),
  /** From TBA's `district.abbreviation` field (plan 05-02, EVNT-01); `null` means the event genuinely is not part of a district. */
  districtKey: z.string().nullable(),
});

export const EventsArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  season: z.number().int(),
  events: z.array(EventsListRowSchema),
});

export type EventsArtifact = z.infer<typeof EventsArtifactSchema>;

// ---------------------------------------------------------------------------
// EventArtifactSchema — v1/event/{eventKey}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

/**
 * D-18 item 7, D-15, D-16, plan 07-07 Task 3: one playoff alliance's
 * selection at an event. Declared module-private, matching every other row
 * schema in this file — nothing outside this module needs the schema
 * object itself, only `EventArtifact`'s inferred type.
 *
 * `allianceNumber` is TBA's own 1-based seed position, carried explicitly
 * rather than implied by array index so seed order survives any
 * re-serialization, sort or filter between the publisher and the browser.
 * It is never parsed out of `name`, because `name` is absent entirely at
 * some events (live-observed at `2024wvrox`).
 *
 * `name` is omitted when TBA sent none — the published shape stays
 * isomorphic to the source shape, an absent key for an absent name, never
 * an empty string and never a synthesized label; choosing a display
 * fallback is 07-14's decision to make from an honest absence.
 *
 * `picks` is TBA's own ordered array: entry 0 is the alliance captain,
 * entries 1 and 2 are the second and third picks, and a fourth entry where
 * present is the reserve robot TBA lists with no field of its own. This
 * schema declares no field named for either of those two positions —
 * both ARE positions in this one array, and a parallel field would be a
 * copy that can drift from it (PD-02). The constraint that matters most:
 * D-16 excludes the fourth pick from 07-14's combined arithmetic so the
 * column stays comparable across rows — it does not exclude that team from
 * the record of who was on the alliance, so truncating `picks` to three
 * anywhere in this pipeline would erase a real team's competition result
 * from the only published account of that event's selection.
 *
 * `record` (07-UAT.md G-8, plan 07-21): this alliance's playoff win-loss-tie
 * record, sourced from TBA's own `status` object
 * (`event_alliances.status_raw`) via `packages/corpus/db.ts`'s
 * `parseAllianceRecord`. Optional for the same two reasons `EventTeamSchema
 * .record` already states: a real absence (no playoff bracket has run yet,
 * or a `playoff_type` shape this pipeline has not modelled) and the
 * pre-republish window. Reuses `RecordSchema` unchanged — the identical
 * `{wins, losses, ties}` shape, never a formatted string.
 */
const EventAllianceSchema = z.object({
  allianceNumber: z.number().int().positive(),
  name: z.string().min(1).optional(),
  picks: z.array(z.string().min(1)).min(1),
  record: RecordSchema.optional(),
});

/**
 * The one page schema plan 04-01's tracer needed, widened by plan 04-02
 * Task 2 to carry `upcoming`'s real D-08 shape and a standings-style
 * `teams` list, and by plan 04-04 Task 1 to make `teams` REQUIRED (never
 * optional) — `publish.ts`'s `buildEventArtifact` now populates it for
 * every event artifact it assembles, defaulting to an empty array only for
 * an event that genuinely has no team data in this run's scope, never
 * omitting the key entirely. Left optional, "not populated yet" and "this
 * event genuinely has no teams" were indistinguishable, and the event
 * page's standings table would have rendered empty instead of failing
 * loudly on a real gap. `matches` has since widened past the 04-01 tracer's
 * shape — see the 07-07 and 08-02 paragraphs below for the two rounds of
 * additive widening it has carried.
 *
 * D-18 items 7/8, plan 07-07 Task 3 widen this with the event's own
 * identity (`name`/`startDate`/`location`/`week`) and its playoff alliance
 * selection (`alliances`). `PAGE_ARTIFACT_SCHEMA_VERSION` is deliberately
 * NOT bumped for these additions (D-02) — additive, optional fields on one
 * page kind are backward-compatible for any reader, matching
 * `EventsListRowSchema`'s own EVNT-01 precedent in this same file (plan
 * 05-02) for the identical class of change.
 *
 * D-03/D-12, plan 08-02 widen `matches` a second time with each played
 * row's ranking-point distribution pair (`redRpPmf`/`blueRpPmf`) and actual
 * ranking-point pair (`actualRedRp`/`actualBlueRp`) — both additive and
 * optional (the pmf pair) or nullable-and-optional (the actual-RP pair), so
 * a pre-republish artifact carrying neither still parses. Again no
 * `PAGE_ARTIFACT_SCHEMA_VERSION` bump, for the same reason the 07-07
 * additions needed none. `matches` and `upcoming` remain two distinct
 * arrays on the wire — Phase 7's D-13 split is preserved, and this plan
 * widens the played array rather than merging it into the upcoming one.
 *
 * `name`/`startDate` are optional but never null: TBA has both for any real
 * event, and 07-08 falls back to the event key exactly as
 * `buildEventsArtifact` already does for the events list — `undefined` here
 * can only mean the artifact predates the field.
 *
 * `location`/`week` are optional AND nullable: `undefined` means the same
 * as above, while `null` is the honest published answer for an event with
 * genuinely no recorded location or no derivable competition week — the
 * same shape `EventsListRowSchema` already uses for these two source
 * columns, plus the optionality the pre-republish window needs. `location`
 * is composed once, in the pipeline, through `composeEventLocation`
 * exported above (PD-01) — never two raw `stateProv`/`country` fields here,
 * so the event page and the Events list can never disagree about one
 * event's location string.
 *
 * `alliances` is optional for the pre-republish window only: 07-08 must
 * always emit the key after the republish, and 07-14's disabled-tab
 * predicate treats an absent key and an empty array identically because
 * both are live-observed real absences — a null TBA body at `2022ispr` and
 * an empty array at `2025bc` and `2026wvrox`, the latter being events that
 * ran qualification matches and published rankings but never held an
 * alliance selection at all.
 */
export const EventArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  name: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  location: z.string().min(1).nullable().optional(),
  week: z.number().int().nullable().optional(),
  matches: z.array(EventMatchSchema),
  upcoming: z.array(EventUpcomingMatchSchema),
  teams: z.array(EventTeamSchema),
  alliances: z.array(EventAllianceSchema).optional(),
  /**
   * D-15, plan 09-07: this season's own win/tie ranking-point constants
   * (`RpRuleModule.winRp`/`.tieRp` — 2/1 in 2016-2024, 3/1 in 2025-2026),
   * published ONCE PER ARTIFACT rather than once per row — one fact about a
   * season, one representation of it. A consumer composes the index-aligned
   * outcome-RP vectors from these against the order pinned on
   * `EventMatchSchema.matchOutcomePmf`: `[win, tie, 0]` for red, `[0, tie,
   * win]` for blue. Placing it here rather than importing the rule module
   * into the browser is deliberate — it is the whole reason this field
   * exists rather than a client-side season lookup table. Optional for the
   * same live-artifact reason as `matchOutcomePmf`.
   */
  rpOutcomeRp: z.object({ win: z.number(), tie: z.number() }).optional(),
});

export type EventArtifact = z.infer<typeof EventArtifactSchema>;

// ---------------------------------------------------------------------------
// CompareArtifactSchema — v1/compare/{year}.json
// ---------------------------------------------------------------------------

/** One algorithm's identity as published on the Compare page — mirrors `packages/harness/artifact.ts`'s module-private `AlgorithmDescriptorSchema` shape (that schema is not exported, so this is a deliberate small reimplementation, not a bypass). */
const CompareAlgorithmSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
});

const CompareCalibrationBinSchema = z.object({
  binStart: z.number(),
  binEnd: z.number(),
  meanPredicted: z.number().nullable(),
  observedFrequency: z.number().nullable(),
  count: z.number().int().nonnegative(),
});

const CompareExclusionCountsSchema = z.object({
  offseason: z.number().int().nonnegative(),
  surrogateAffected: z.number().int().nonnegative(),
  missingResult: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  /**
   * D-02/D-04 (quick task 260909-t5q): see `packages/harness/score.ts`'s
   * `ExclusionCounts.coldStart` doc comment for the full contract. OPTIONAL
   * here on purpose, UNLIKE `packages/harness/artifact.ts`'s own
   * `ExclusionCountsSchema` counterpart — this is a LIVE, R2-served artifact
   * shape, and D-04 defers the republish that would add this key to every
   * already-published slice. A required key would fail to parse every one
   * of today's four-key live artifacts and blank the Compare page in
   * production before any republish happens. Absence genuinely means "this
   * artifact predates the field" and MUST render as absent
   * (`coverageRows.ts`'s `SharedCount`'s `absent` variant), never coerced to
   * zero — pinned by `apps/web/src/lib/api/compare.compat.test.ts`.
   */
  coldStart: z.number().int().nonnegative().optional(),
});

/** One published bonus's calibration figures (F1, D-09, D-11) — one entry per bonus that scored at least one (alliance, bonus) observation this season/algorithm; a bonus with zero observations is OMITTED here rather than emitted with `NaN` figures (T-09-04). */
const CompareRpBonusSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
  meanPredicted: z.number(),
  observedFrequency: z.number(),
  brierScore: z.number(),
});

/**
 * The RP scorecard's wire shape (F1, D-09, D-11) — one per (season,
 * algorithm), attached to the matching `qualification` slice by
 * `buildCompareArtifact`.
 *
 * Task 2 Step 5 (2026-09-11): this shape ORIGINALLY also carried a
 * `reliabilityBins` array (reusing `CompareCalibrationBinSchema`, pooling
 * every bonus's observations into one set of buckets) — measured, real bytes
 * showed attaching it pushed `compare-2016.json` to 21,260 bytes against the
 * committed 20,000-byte `budgetMaxBytes` (`docs/publish-budget.md`), 2016
 * carrying three algorithms' worth of RP calibration. Per this plan's own
 * pre-committed remedy (shrink the block, never raise the budget),
 * `reliabilityBins` was dropped here: nothing on `/methodology/compare`
 * ever read it (the section renders per-bonus deviation bars from `bonuses`
 * alone), so it was pure wire cost with no consumer. The per-bonus
 * `bonuses` array — the one thing the headline sentence and D-09's per-bonus
 * acceptance bar both need — is unaffected.
 */
const CompareRpCalibrationSchema = z.object({
  scoredCount: z.number().int().nonnegative(),
  bonuses: z.array(CompareRpBonusSchema),
});

/**
 * `CompareRpCalibrationSchema` is deliberately module-private (unlike most
 * schemas in this file) — only this inferred TYPE is exported. Nothing
 * outside this module constructs its own instance of the schema; a caller
 * needing to validate one (`publish.ts`'s `RpCalibrationMeasurementSchema`)
 * declares a structurally-identical schema of its own rather than importing
 * this one, and both are exercised against the SAME real emitted record
 * fixture (`apps/web/src/routes/__fixtures__/rp-calibration-2026-bpr.json`)
 * in their respective test files, which is what keeps them from silently
 * drifting apart.
 */
export type CompareRpCalibration = z.infer<typeof CompareRpCalibrationSchema>;

/** One algorithm's `ScoreSlice` figures for one season/compLevel view — raw numbers only (D-21); no field here may be a delta or judgement between two algorithms' slices. */
const CompareSliceSchema = z.object({
  algorithmId: z.string().min(1),
  season: z.number().int(),
  /**
   * The retired tune/holdout `seasonLabel` sat here as an OPTIONAL vestige
   * (D-4, quick task 260903-krp) while live 5.0.0 artifacts still carried
   * the key. The 2026-09-04 republish (epa@5.0.0 / vpr@8.0.0+rolling-2026-09b)
   * replaced every producer of that key, so the field is now DELETED, not
   * optional — the D-1 sequencing rule in
   * `rolling-origin-hyperparameter-tuning` said the deletion rides the
   * republish, and this is that deletion. Archived 5.0.0-era artifacts still
   * parse (this schema is not `.strict()`, so Zod strips the unknown key);
   * they just no longer read the retired key through.
   * `apps/web/src/lib/api/compare.compat.test.ts` pins exactly that.
   */
  headlineEligible: z.boolean(),
  compLevelView: z.enum(["qualification", "elimination", "combined"]),
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
  tieCount: z.number().int().nonnegative(),
  noCallCount: z.number().int().nonnegative(),
  exclusionCounts: CompareExclusionCountsSchema,
  candidateCount: z.number().int().nonnegative(),
  calibrationBins: z.array(CompareCalibrationBinSchema),
  /**
   * F1/D-09/D-11 (phase 09 plan 09-01): the RP scorecard's per-bonus
   * accuracy for this algorithm/season. OPTIONAL here on purpose, following
   * `CompareExclusionCountsSchema.coldStart`'s precedent exactly — this is a
   * LIVE, R2-served artifact shape (`v1/compare/{year}.json`), and a
   * required key would fail to parse every already-published slice and
   * blank the Compare page in production before this phase's republish
   * lands. Absence genuinely means "this artifact predates the field" and
   * MUST render as absent (`RP_CALIBRATION_ABSENT_TEXT` on the Compare
   * page), never coerced to zero — pinned by
   * `apps/web/src/lib/api/compare.compat.test.ts`.
   *
   * Hangs off the SLICE, not the artifact: bonus ranking points exist only
   * in QUALIFICATION matches (no elimination/combined bonus RP exists to
   * measure), so only a slice whose `compLevelView` is `"qualification"`
   * ever carries this key — `buildCompareArtifact`'s `attachRpCalibration`
   * enforces that.
   */
  rpCalibration: CompareRpCalibrationSchema.optional(),
});

/**
 * The head-to-head page. Deliberately NOT algorithm-scoped — the single
 * documented exception to D-02's one-file-per-algorithm rule, because this
 * file's entire purpose is putting the published algorithms side by side.
 * It therefore does not extend `AlgorithmScopedPreambleSchema` and carries
 * no top-level `algorithmId`/`algorithmVersion`; `algorithms` names every
 * algorithm the file covers instead.
 */
export const CompareArtifactSchema = PagePreambleSchema.extend({
  algorithms: z.array(CompareAlgorithmSchema).min(1),
  slices: z.array(CompareSliceSchema),
});

export type CompareArtifact = z.infer<typeof CompareArtifactSchema>;

// ---------------------------------------------------------------------------
// Districts artifacts — v1/districts/{year}.json, v1/district/{districtKey}.json
// (quick task 260905-lic Task 2; widened by revision R2a)
// ---------------------------------------------------------------------------

/**
 * REVISION R2a SCHEMA-VERSION NOTE: this revision's plan text called for
 * bumping `PAGE_ARTIFACT_SCHEMA_VERSION`. That constant is declared ONCE at
 * the top of this file and shared, via `z.literal(PAGE_ARTIFACT_SCHEMA_VERSION)`,
 * by EVERY page kind's preamble — teams, team, events, event, compare AND
 * districts alike. Bumping it would make every already-published artifact of
 * every OTHER page kind fail its `schemaVersion` literal check the moment a
 * client fetches it, until the entire site (not just districts) is
 * republished — disproportionate to, and unrelated to, this revision's
 * scope. This file's own established convention for exactly this situation
 * (`EventsListRowSchema`'s EVNT-01 note, `TeamSeasonArtifactSchema`'s `ranks`
 * note, `EventArtifactSchema`'s D-18/D-03 notes — all citing "additive,
 * optional fields on one page kind are backward-compatible for any reader")
 * is followed instead: every field this revision adds below
 * (`qualifyingAwards`, `allocationNote`) is additive, and the two new
 * `status` enum literals (`"lockedAward"`, `"prequalified"`) carry the same
 * bounded, already-accepted risk D-02's own precedent names explicitly — a
 * stale cached client reading a freshly-published artifact within the
 * `max-age=60` window. District artifacts are refreshed only by an offline,
 * infrequent manual publish (this file's own header, unchanged), so that
 * window is narrow. No version bump here; flagged in this revision's return
 * to the orchestrator so a real bump (and the full-site republish it would
 * force) can be chosen deliberately if wanted.
 */

/**
 * `districtsIndexKey`/`districtDetailKey` are declared as their OWN exported
 * functions and deliberately NOT added to `PageKind`/`ArtifactKeyParams`
 * above. `PageKind` is the union `apps/worker/src/artifactWriter.ts`'s
 * exhaustive `SCHEMA_BY_PAGE` record and `publish.ts`'s per-season size
 * budget are both keyed on — district artifacts are neither live-written by
 * the Worker (F-07/context: "District artifacts are refreshed only by an
 * offline `pnpm ingest:districts` + `pnpm publish:districts`. The live
 * Worker cron does not touch them.") nor part of a per-season replay.
 * Widening `PageKind` here would force a Worker change that buys nothing.
 * These two keys follow the `v1/manifest/*.json` precedent instead —
 * published keys that live outside `PageKind` on purpose (see
 * `scripts/publishAlgorithmsManifest.ts`'s `ALGORITHMS_MANIFEST_KEY`).
 */
export function districtsIndexKey(year: number): string {
  return `v1/districts/${year}.json`;
}

/** `districtKey` is TBA's own year-prefixed key (e.g. `"2026fnc"`) — see `packages/corpus/schema.sql`'s `districts` table doc comment for the full distinction from `events.district_key`'s bare abbreviation. */
export function districtDetailKey(districtKey: string): string {
  return `v1/district/${districtKey}.json`;
}

/**
 * The district/champ lock verdict `packages/core/districts/locks.ts`'s
 * `computeLocksWithQualifiers` returns, plus the season's current cut-line
 * point total — shared by every team's `districtLock`/`champLock` entry
 * below. Widened by revision R2a (`260905-lic-RESEARCH-awards.md`) from the
 * original four-way `status` to six: `"lockedAward"` (an award already
 * guarantees this team a slot, regardless of its own points standing) and
 * `"prequalified"` (a curated FIRST Championship pre-qualification — champ
 * lock only, never district lock) join `locked`/`eliminated`/`contending`/
 * `unknown`.
 *
 * `allocationNote` is the honest "not modeled" flag for a district-year the
 * ordinary cut-line math does not apply to at all (research: `2025fsc`'s
 * documented five-explicit-invite exception) — `null` for every ordinary
 * district-year. Present on BOTH `districtLock` and `champLock` (mirroring
 * `cutLinePoints`'s own per-team-duplicated-but-district-wide-constant
 * shape) even though the one district-year this currently applies to only
 * special-cases the champ tier — a future special case could apply to
 * either lock, and this schema does not want to special-case which field
 * carries the note.
 */
const DistrictLockVerdictSchema = z.object({
  status: z.enum(["locked", "lockedAward", "prequalified", "eliminated", "contending", "unknown"]),
  pointsToLock: z.number().int().nonnegative().nullable(),
  threatCount: z.number().int().nonnegative(),
  /** The point total currently sitting at the slot-th rank for this lock's capacity — `null` when capacity (`slots`) is not published, mirroring `pointsToLock`'s own null contract. */
  cutLinePoints: z.number().nullable(),
  /** revision R2a: `"special allocation — not modeled"` for a district-year the ordinary points/award-slot model does not apply to at all (currently only `2025fsc`'s champ lock, `packages/core/districts/qualification.ts`'s `specialAllocationNote`); `null` for every ordinary district-year. */
  allocationNote: z.string().nullable(),
});

/** One district's summary row on the districts index — `dcmpSlots`/`cmpSlots` are nullable, mirroring `packages/corpus/schema.sql`'s `districts` table: `null` is "TBA published no `official_advancement_counts`", never a guessed zero. */
const DistrictsIndexRowSchema = z.object({
  districtKey: z.string().min(1),
  abbreviation: z.string().min(1),
  displayName: z.string().min(1),
  dcmpSlots: z.number().int().nonnegative().nullable(),
  cmpSlots: z.number().int().nonnegative().nullable(),
  teamCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});

/** `v1/districts/{year}.json` — the district picker's data source. Deliberately NOT algorithm-scoped (extends `PagePreambleSchema`, not `AlgorithmScopedPreambleSchema`) — district point data has no algorithm dependency at all, matching `CompareArtifactSchema`'s own reasoning for the identical choice. */
export const DistrictsIndexArtifactSchema = PagePreambleSchema.extend({
  year: z.number().int(),
  districts: z.array(DistrictsIndexRowSchema),
});

export type DistrictsIndexArtifact = z.infer<typeof DistrictsIndexArtifactSchema>;

/** One event's per-component district point breakdown for one team — TBA's own reported values, verbatim, never collapsed into an event total alone (must_haves: every source of district points stays individually readable). */
const DistrictTeamEventPointsSchema = z.object({
  eventKey: z.string().min(1),
  eventName: z.string(),
  week: z.number().int().nullable(),
  tier: z.enum(["district", "dcmp"]),
  qual: z.number(),
  alliance: z.number(),
  elim: z.number(),
  award: z.number(),
  total: z.number(),
});

/** One event still ahead of a team this season, and the max points still attainable there (`pointModel.ts`'s declared ceiling for that event's tier). */
const DistrictTeamRemainingEventSchema = z.object({
  eventKey: z.string().min(1),
  eventName: z.string(),
  week: z.number().int().nullable(),
  tier: z.enum(["district", "dcmp"]),
  maxPoints: z.number(),
});

/**
 * One award recipiency relevant to district/champ qualification (revision
 * R2a, research Q1/Q4/Q5) — `packages/core/districts/qualification.ts`'s
 * `isQualificationRelevantAward`/`isAwardOnly`/`awardDisplayName` govern
 * which award records appear here and how each is labelled. Populated from
 * district-tier events (`award_type` 0/9/10, with 9/10 always `awardOnly:
 * true`) and DCMP-tier events (`award_type` 0/1/9/10, always `awardOnly:
 * false`) alike — `eventKey` is how a reader distinguishes which tier (and
 * therefore which Locks tab) an entry belongs to, by cross-referencing
 * `eventPoints`/`remainingEvents`' own `tier` field for that same
 * `eventKey`, rather than this schema duplicating a `tier` field of its own.
 */
const DistrictQualifyingAwardSchema = z.object({
  eventKey: z.string().min(1),
  awardType: z.number().int(),
  label: z.string().min(1),
  awardOnly: z.boolean(),
});

/** One team's full district-points standing, breakdown, qualifying awards and both lock verdicts. */
const DistrictTeamSchema = z.object({
  teamKey: z.string().min(1),
  teamNumber: z.number().int().optional(),
  nickname: z.string().optional(),
  rank: z.number().int().positive(),
  pointTotal: z.number(),
  rookieBonus: z.number(),
  adjustments: z.number(),
  eventPoints: z.array(DistrictTeamEventPointsSchema),
  remainingEvents: z.array(DistrictTeamRemainingEventSchema),
  maxRemainingDistrict: z.number(),
  maxRemainingChamp: z.number(),
  /** revision R2a — every award recipiency this team holds that is relevant to district or champ qualification, district-tier and DCMP-tier events alike. `[]` when the team holds none. */
  qualifyingAwards: z.array(DistrictQualifyingAwardSchema),
  districtLock: DistrictLockVerdictSchema,
  champLock: DistrictLockVerdictSchema,
});

/** The Insights tab's lean summary (must_haves: "ships lean" — no charts, no algorithm-scoped join). */
const DistrictInsightsSchema = z.object({
  teamCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  dcmpCutLinePoints: z.number().nullable(),
  cmpCutLinePoints: z.number().nullable(),
  districtLockedCount: z.number().int().nonnegative(),
  districtEliminatedCount: z.number().int().nonnegative(),
  champLockedCount: z.number().int().nonnegative(),
  champEliminatedCount: z.number().int().nonnegative(),
});

/** `v1/district/{districtKey}.json` — one district's full Breakdown/District-Locks/Champ-Locks/Insights data. Deliberately NOT algorithm-scoped, matching `DistrictsIndexArtifactSchema`'s own reasoning above. */
export const DistrictArtifactSchema = PagePreambleSchema.extend({
  districtKey: z.string().min(1),
  year: z.number().int(),
  abbreviation: z.string().min(1),
  displayName: z.string().min(1),
  dcmpSlots: z.number().int().nonnegative().nullable(),
  cmpSlots: z.number().int().nonnegative().nullable(),
  teams: z.array(DistrictTeamSchema),
  insights: DistrictInsightsSchema,
});

export type DistrictArtifact = z.infer<typeof DistrictArtifactSchema>;

// ---------------------------------------------------------------------------
// Pre-schedule rank-simulation sidecar — v1/presim/{eventKey}/{algorithmId}@{version}.json
// (quick task 260905-tll Task 1, PD-01)
// ---------------------------------------------------------------------------

/**
 * `preScheduleKey` is declared as its OWN exported function and
 * deliberately NOT added to `PageKind`/`ArtifactKeyParams` above, following
 * `districtsIndexKey`/`districtDetailKey`'s precedent immediately above
 * (PD-01). Three consequences fall out of that single choice at once:
 * `apps/worker/src/artifactWriter.ts`'s exhaustive `SCHEMA_BY_PAGE`-keyed
 * writer structurally cannot address (and therefore cannot clobber or
 * delete) a sidecar the Worker must never regenerate (C-18 — the Worker
 * never simulates); `packages/harness/payloadBudget.test.ts`'s own
 * `PAGE_KINDS` list stays untouched, so the sidecar lives outside the
 * machine-readable size-budget block on purpose; and the event artifact's
 * reachable 350,000-byte ceiling is never approached, because the sidecar
 * is a separate, lazily-fetched object rather than new bytes on the event
 * page's own key. `PAGE_ARTIFACT_SCHEMA_VERSION` is NOT bumped — this
 * file's established convention (the districts note above) is that an
 * additive new artifact kind never bumps it.
 *
 * This function is the ONE spelling of the sidecar key, imported by BOTH
 * `packages/harness/publish.ts` (the writer) and
 * `apps/web/src/lib/api/preSchedule.ts` (the reader) — two spellings would
 * be a silent permanent 404.
 */
export function preScheduleKey(params: { eventKey: string; algorithmId: string; version: string }): string {
  assertVersionShape(params.algorithmId, params.version);
  return `v1/presim/${params.eventKey}/${params.algorithmId}@${params.version}.json`;
}

/**
 * One synthetic qualification match inside a pre-schedule sidecar, in the
 * compact roster-index encoding: `r`/`b` are three-element arrays of
 * indices into the artifact's own `roster`, never team keys — the roster
 * defines the index space once and every match row reuses it.
 */
const PreScheduleMatchSchema = z.object({
  /** Red alliance: three roster indices (zero-based positions in this artifact's `roster`). */
  r: z.array(z.number().int()).length(3),
  /** Blue alliance: three roster indices — same encoding as `r`. */
  b: z.array(z.number().int()).length(3),
  /**
   * The red alliance's predicted ranking-point pmf, `P(RP = i)` at index
   * `i` — exactly the same physical quantity, in the same encoding and at
   * the same `ROUNDING_RULE.pmf` precision, as `EventMatchSchema`'s own
   * `redRpPmf` above. Required here (never optional): a sidecar exists
   * ONLY for algorithms that model ranking points; an RP-less algorithm
   * gets no sidecar at all rather than one with holes.
   */
  rp: z.array(z.number()),
  /** The blue alliance's counterpart to `rp` — same quantity, same encoding, same `ROUNDING_RULE.pmf` precision as `EventMatchSchema.blueRpPmf`. */
  bp: z.array(z.number()),
});

/**
 * The pre-schedule rank-simulation sidecar (C-04/C-08/C-09): K synthetic
 * qualification schedules priced by the exact joint-covariance RP model,
 * plus the baked default rank distribution the Simulation tab renders on
 * first paint with zero client compute. The four refinements below are the
 * publish-boundary guarantee that makes `MalformedRankHistogramError` in
 * `apps/web/src/components/event/rankRows.ts` unreachable in front of a
 * visitor — the client deliberately does NOT re-derive these bounds
 * (T-tll-02/T-tll-03).
 */
export const PreScheduleArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** How this sidecar was priced (PD-02): walk-forward pre-event state when the corpus shows the event's schedule has landed, current (season-final) state when it has not. */
  pricedFrom: z.enum(["pre-event-walk-forward", "current-state"]),
  matchesPerTeam: z.number().int().positive(),
  /** The team keys that define the index space for every `r`/`b` array and every baked histogram below — sorted ascending by the builder, so republishes are byte-stable regardless of corpus row order. */
  roster: z.array(z.string().min(1)).min(1),
  schedules: z
    .array(
      z.object({
        /** The seed that reproduces this schedule's team-to-slot shuffle (C-14/T-tll-06) — published so any sidecar can be regenerated and compared. */
        seed: z.number().int(),
        matches: z.array(PreScheduleMatchSchema).min(1),
      })
    )
    .min(1),
  baked: z.object({
    /** Total simulated draws across all schedules (`scheduleCount * drawsPerSchedule`) — every histogram below sums to exactly this. */
    draws: z.number().int().positive(),
    /** One per-rank draw-count histogram per roster team, in roster order, each of length `roster.length` — index `rank - 1` holds the count of draws finishing at that rank. */
    histograms: z.array(z.array(z.number().int())).min(1),
  }),
})
  .refine(
    (artifact) =>
      artifact.schedules.every((schedule) => schedule.matches.every((match) => isValidPmf(match.rp) && isValidPmf(match.bp))),
    { message: "every `rp` and `bp` must be a valid pmf (non-empty, sums to 1 within the shared 1e-9 tolerance)" }
  )
  .refine(
    (artifact) =>
      artifact.schedules.every((schedule) =>
        schedule.matches.every((match) =>
          [...match.r, ...match.b].every((index) => index >= 0 && index < artifact.roster.length)
        )
      ),
    { message: "every roster index in every `r`/`b` must lie in [0, roster.length)" }
  )
  .refine((artifact) => new Set(artifact.roster).size === artifact.roster.length, {
    // Without this, the "makes MalformedRankHistogramError unreachable"
    // guarantee below is FALSE rather than merely unenforced: the client
    // decodes the roster into a Map keyed by team key, so a duplicate
    // collapses two entries into one, `rankHistograms.size` comes out below
    // `roster.length`, and every histogram then fails rankRows.ts's
    // length check — in front of a reader. Today's writers happen not to
    // emit duplicates; this is what makes that a guarantee instead of a
    // coincidence.
    message: "`roster` must not contain duplicate team keys — the client indexes baked histograms by team key",
  })
  .refine((artifact) => artifact.baked.histograms.length === artifact.roster.length, {
    message: "`baked.histograms` must carry exactly one histogram per roster team (histograms.length === roster.length)",
  })
  .refine(
    (artifact) =>
      artifact.baked.histograms.every(
        (histogram) =>
          histogram.length === artifact.roster.length &&
          histogram.reduce((total, count) => total + count, 0) === artifact.baked.draws
      ),
    {
      message:
        "every baked histogram must have length roster.length and sum exactly to baked.draws — the guarantee that makes rankRows.ts's MalformedRankHistogramError unreachable",
    }
  );

export type PreScheduleArtifact = z.infer<typeof PreScheduleArtifactSchema>;

/**
 * THE FIELD-AVERAGED pre-schedule sidecar (plan 09-09 rung 1; D-16, D-17).
 *
 * WHAT THIS REPLACES. `PreScheduleArtifactSchema` above carries K priced
 * synthetic schedules plus a baked rank histogram per team. This carries ONE
 * per-match pmf per team, and nothing else. D-16 names why the schedules were
 * never the thing that was needed: the 20 of them were a MONTE CARLO
 * APPROXIMATION OF AN EXPECTATION OVER SCHEDULE RANDOMNESS — the same insight
 * as the RP pmf, one level up — so if schedule randomness is averaged away in
 * the end, what is needed is the DISTRIBUTION A RANDOM SCHEDULE INDUCES, and
 * that has a closed form.
 *
 * `perTeamPmf[i]` is `roster[i]`'s FIELD-AVERAGED distribution over its own
 * alliance's TOTAL ranking points in ONE qualification match — NOT its season
 * total. The consumer convolves `matchesPerTeam` copies of it
 * (`seasonTotalPmf`, `packages/core/rankingPoints/fieldAveraged.ts`) to get
 * the season total. Publishing the per-match form rather than the season total
 * is a size decision with a measured basis: the per-match pmf is roughly seven
 * entries and the season total is roughly seventy-three.
 *
 * `seed` and `draws` are published so the offline builder, the measurement
 * script and the browser all run `simulateRanks(matches, baselines, draws,
 * mulberry32(seed))` on identical inputs and get IDENTICAL histograms. That
 * identity is a test, not a hope.
 *
 * THE HONEST CAVEATS (D-16 requires these wherever this ships): the
 * field-averaged form assumes a team's matches are near-independent, and it
 * washes out coupling from teams that share specific matches — AND, IN THE
 * SAME BREATH, the 20-schedule form washed that same coupling out BY DESIGN,
 * averaging over 20 independent shuffles precisely so no particular pairing
 * survived into the published band. It is a shared property of both forms, not
 * a defect unique to this one. The composition-induced spread is treated as
 * Gaussian, the same approximation class used elsewhere here.
 *
 * WHICH OF THE OLD SCHEMA'S REFINEMENTS SURVIVE, NAMED RATHER THAN LEFT TO A
 * DIFF:
 *   - the valid-pmf refine SURVIVES, widened from `rp`/`bp` to every
 *     `perTeamPmf` entry, calling the file's EXISTING shared `isValidPmf` and
 *     its existing tolerance — no second pmf tolerance is introduced;
 *   - the duplicate-roster-key refine SURVIVES, load-bearing for exactly the
 *     reason its original comment gives: the client indexes by team key, so a
 *     duplicate collapses two entries into one;
 *   - a length refine is ADDED (`perTeamPmf.length === roster.length`) — a
 *     short or long array desynchronises team keys from distributions, so
 *     every band is attributed to the wrong team with no error anywhere;
 *   - the roster-index bounds refine is GONE because it has no referent —
 *     there are no `r`/`b` arrays here;
 *   - the two `baked` refinements are GONE for the same reason — there is no
 *     baked block. The properties they guaranteed (one histogram per roster
 *     team, each of length `roster.length`, each summing to `draws`) did not
 *     disappear: they MOVED to the client, where the histograms are now
 *     computed, and are asserted there
 *     (`apps/web/src/lib/preScheduleResult.test.ts`).
 *
 * `preScheduleKey` is UNCHANGED by this plan — same function, same
 * `v1/presim/{eventKey}/{algorithmId}@{version}.json` key form. The
 * algorithm-id segment moving off retired `vpr` is plan 09-10's Delta A and is
 * not touched here.
 */
export const FieldAveragedPreScheduleArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** How this sidecar was priced (PD-02) — unchanged in meaning from the schedule-based schema above. */
  pricedFrom: z.enum(["pre-event-walk-forward", "current-state"]),
  /** How many qualification matches each team plays. The consumer convolves this many copies of its `perTeamPmf` entry for the season total. */
  matchesPerTeam: z.number().int().positive(),
  /** The team keys that define the index space for `perTeamPmf` — sorted ascending by the builder, so republishes are byte-stable regardless of corpus row order. */
  roster: z.array(z.string().min(1)).min(1),
  /** One PER-MATCH total-RP pmf per roster team, in roster order. See this schema's doc comment: per-match, never the season total. */
  perTeamPmf: z.array(z.array(z.number())).min(1),
  /** The draw count the consumer runs `simulateRanks` for — published so all three consumers produce identical histograms. */
  draws: z.number().int().positive(),
  /** The seed the consumer runs `simulateRanks` with — published for the same reason as `draws`. */
  seed: z.number().int(),
})
  .refine((artifact) => artifact.perTeamPmf.length === artifact.roster.length, {
    message: "`perTeamPmf` must carry exactly one pmf per roster team (perTeamPmf.length === roster.length)",
  })
  .refine((artifact) => artifact.perTeamPmf.every((pmf) => isValidPmf(pmf)), {
    message: "every `perTeamPmf` entry must be a valid pmf (non-empty, sums to 1 within the shared 1e-9 tolerance)",
  })
  .refine((artifact) => new Set(artifact.roster).size === artifact.roster.length, {
    message: "`roster` must not contain duplicate team keys — the client indexes per-team distributions by team key",
  });

export type FieldAveragedPreScheduleArtifact = z.infer<typeof FieldAveragedPreScheduleArtifactSchema>;

// ---------------------------------------------------------------------------
// EPA vs Statbotics comparison — v1/methodology/epa-vs-statbotics.json
// (quick task 260908-n5o)
// ---------------------------------------------------------------------------

/**
 * `epaComparisonKey` is declared as its OWN exported function and
 * deliberately NOT added to `PageKind`/`ArtifactKeyParams` above — following
 * `districtsIndexKey`/`districtDetailKey`/`preScheduleKey`'s precedent
 * earlier in this file. Two reasons fall out of that one choice: the Worker
 * never writes this artifact (an offline re-measurement, published manually,
 * exactly like the districts artifacts and unlike anything the live cron
 * touches), so widening `PageKind` would force a Worker change for a key it
 * must never address; and this measurement is a single CROSS-SEASON document
 * (2022-2026 in one object, not year-scoped), so
 * `packages/harness/payloadBudget.test.ts`'s per-season size budget does not
 * apply to it — it has no "season" of its own to budget against.
 *
 * This function is the ONE spelling of the key, imported by BOTH
 * `scripts/publishEpaComparison.ts` (the writer) and
 * `apps/web/src/lib/api/epaComparison.ts` (the reader) — two spellings would
 * be a silent permanent 404, exactly as `preScheduleKey`'s own doc comment
 * warns.
 */
export function epaComparisonKey(): string {
  return "v1/methodology/epa-vs-statbotics.json";
}

/**
 * One season's per-team agreement statistics between our EPA and Statbotics'
 * own. `basis` names the ONE quantity this row measures rather than the row
 * disappearing into an unlabelled number: a reader of the raw artifact can
 * tell what it measures without consulting a doc.
 *
 * Revision 260908-n5o (same-day, post-ship): this replaced a two-arm design
 * — `includeOffseason: true/false`, one row per season per arm — measured
 * against each team's SEASON-FINAL total. That design was retired because
 * it measured a quantity nobody is shown anywhere on this site. Every
 * visible surface (the Teams list, the top of a team page) shows a team's
 * total as of its own LAST OFFICIAL match
 * (`packages/harness/publish.ts`'s `lastOfficialMetricsByTeam`), and
 * `frc7769`/2026/`epa@6.0.0+baseline` is the measurement that caught it:
 * that quantity was 313.95 everywhere a visitor sees it, while the
 * season-final, offseason-inclusive total this schema used to carry was
 * 251.37 — a materially different number for any team with offseason play.
 * `basis: "last-official-match"` is the ONE literal this field can carry
 * today; a future second basis would be a deliberate, separate decision,
 * not a silent second arm sharing this array again.
 */
const EpaComparisonAgreementRowSchema = z.object({
  season: z.number().int(),
  basis: z.literal("last-official-match"),
  joinedCount: z.number().int().nonnegative(),
  ordinaryLeastSquaresSlope: z.number(),
  pearson: z.number(),
  meanAbsoluteDifference: z.number(),
});

/**
 * One season's winner-prediction head-to-head: our own figures next to
 * Statbotics' own published season figures. `ourWinnerAccuracy`/
 * `ourBrierScore` are nullable, mirroring `packages/harness/score.ts`'s
 * `ScoreSlice` contract; `statboticsBrierScore` is nullable too, mirroring
 * `packages/harness/statbotics.ts`'s `StatboticsReference.mse` optionality.
 */
const EpaComparisonHeadToHeadRowSchema = z.object({
  season: z.number().int(),
  ourWinnerAccuracy: z.number().nullable(),
  ourBrierScore: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
  statboticsWinnerAccuracy: z.number(),
  statboticsBrierScore: z.number().nullable(),
  statboticsCapturedAt: z.string().min(1),
  statboticsFetched: z.boolean(),
});

/**
 * `v1/methodology/epa-vs-statbotics.json` — the EPA-vs-Statbotics explainer
 * page's one published artifact (quick task 260908-n5o). Deliberately NOT
 * algorithm-scoped (extends `PagePreambleSchema`, not
 * `AlgorithmScopedPreambleSchema`) — there is no algorithm SEGMENT here (this
 * document measures exactly one algorithm, EPA, always), matching
 * `CompareArtifactSchema`'s and `DistrictsIndexArtifactSchema`'s own
 * reasoning for the identical choice. `epaVersion` below carries the version
 * identity instead, at the object level — the field
 * `scripts/publishEpaComparison.ts`'s own composition gate checks for
 * equality across both arm reports before ever composing this object, which
 * is what makes a mixed-model-version publish impossible rather than merely
 * discouraged.
 *
 * `agreement` is ONE row per season, each carrying its own `basis` (see
 * `EpaComparisonAgreementRowSchema`'s own doc comment for why this is a
 * revision away from an earlier two-arm design, not the original shape).
 *
 * `measuredAt`/`epaVersion`/`minMatches` are the provenance stamp:
 * `measuredAt` is when the underlying harness run was measured (distinct
 * from the inherited `computedAt`, which is when THIS publish composed the
 * object), `epaVersion` is what makes a mixed-version publish detectable,
 * and `minMatches` records which min-matches arm `agreement`'s figures were
 * filtered to.
 *
 * `PAGE_ARTIFACT_SCHEMA_VERSION` is NOT bumped — this file's established
 * convention (the districts/pre-schedule notes above) is that an additive
 * new artifact kind never bumps it.
 */
export const EpaComparisonArtifactSchema = PagePreambleSchema.extend({
  measuredAt: z.string().min(1),
  epaVersion: z.string().min(1),
  minMatches: z.number().int().positive(),
  agreement: z.array(EpaComparisonAgreementRowSchema),
  headToHead: z.array(EpaComparisonHeadToHeadRowSchema),
});

export type EpaComparisonArtifact = z.infer<typeof EpaComparisonArtifactSchema>;
