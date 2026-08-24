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
 *   - The two meanings of `±` stay separate (02-CONTEXT D-09/D-10). A
 *     `TeamMetric.spread` (consistency) and an alliance-total predictive
 *     `variance` are different quantities and keep distinct field names in
 *     every schema — never merged into one `uncertainty` field.
 */
import { z } from "zod";
import { MetricHistoryRowSchema } from "./metricHistorySchema.js";

/** Bumped whenever a published page artifact's shape changes in a way a client consumer must know about. Independent of `packages/harness/artifact.ts`'s `ARTIFACT_SCHEMA_VERSION` — see file header. */
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
// Shared metric/record shapes (D-27, D-09/D-10)
// ---------------------------------------------------------------------------

/** D-27: one team's named metric — a value with an optional consistency spread. Mirrors `packages/core/algorithms/types.ts`'s `TeamMetric`. The consistency `spread` here and an alliance-total predictive `variance` elsewhere are deliberately distinct fields (D-09/D-10) — never merged. */
const TeamMetricSchema = z.object({
  value: z.number(),
  spread: z.number().optional(),
});

/** Component name -> that team's metric, per `AlgorithmModule.teamMetrics` (D-27). */
const MetricsRecordSchema = z.record(z.string(), TeamMetricSchema);

/** Win/loss/tie counts as three integer fields, never a formatted string. */
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

/** One component's predicted contribution to an alliance's score (D-24). Mirrors `packages/core/algorithms/types.ts`'s `ComponentPrediction`. */
const ComponentPredictionSchema = z.object({
  mean: z.number(),
  variance: z.number().optional(),
});

/** D-10: a discrete pmf's sum tolerance — the same 1e-9 bound `packages/harness/predictions.ts`'s `PredictionRecordSchema` enforces, applied identically here so a published pmf can never drift looser than the sidecar that fed it. */
const RP_PMF_SUM_TOLERANCE = 1e-9;

function isValidPmf(pmf: readonly number[] | undefined): boolean {
  if (pmf === undefined) return true; // omitted entirely — valid, means "not modeled"
  if (pmf.length === 0) return false; // an empty array is never a valid distribution
  const sum = pmf.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 1) <= RP_PMF_SUM_TOLERANCE;
}

/** One played match's prediction-vs-actual row. Field names match `packages/harness/predictions.ts`'s `PredictionRecordSchema` so a reader never has to translate between the sidecar and the published file. */
const EventMatchSchema = z.object({
  matchKey: z.string().min(1),
  compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
  setNumber: z.number().int(),
  matchNumber: z.number().int(),
  redTeams: z.array(z.string()),
  blueTeams: z.array(z.string()),
  predictedWinner: z.enum(["red", "blue"]),
  pRedWin: z.number(),
  predictedRedScore: z.number(),
  predictedBlueScore: z.number(),
  redComponents: z.record(z.string(), ComponentPredictionSchema).optional(),
  blueComponents: z.record(z.string(), ComponentPredictionSchema).optional(),
  actualWinner: z.enum(["red", "blue", "tie"]),
  actualRedScore: z.number(),
  actualBlueScore: z.number(),
});

/** D-08: an upcoming match's full predicted-parameters shape — what Phase 8's rank simulation consumes, published here rather than recomputed there. `redRpPmf`/`blueRpPmf` are omitted entirely (never an empty array) for an algorithm that does not model RP, matching `Prediction`'s existing convention. */
const EventUpcomingMatchSchema = z
  .object({
    matchKey: z.string().min(1),
    compLevel: z.enum(["qm", "ef", "qf", "sf", "f"]),
    setNumber: z.number().int(),
    matchNumber: z.number().int(),
    redTeams: z.array(z.string()),
    blueTeams: z.array(z.string()),
    predictedWinner: z.enum(["red", "blue"]),
    pRedWin: z.number(),
    predictedRedScore: z.number(),
    predictedBlueScore: z.number(),
    redComponents: z.record(z.string(), ComponentPredictionSchema).optional(),
    blueComponents: z.record(z.string(), ComponentPredictionSchema).optional(),
    redRpPmf: z.array(z.number()).optional(),
    blueRpPmf: z.array(z.number()).optional(),
  })
  .refine((row) => isValidPmf(row.redRpPmf), {
    message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueRpPmf), {
    message: "blueRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueRpPmf"],
  });

/** D-07: a team competing at an event, carrying its current metrics — the event page's standings-style table. */
const EventTeamSchema = z.object({
  teamKey: z.string().min(1),
  teamNumber: z.number().int().optional(),
  nickname: z.string().optional(),
  metrics: MetricsRecordSchema,
});

/** The prediction-vs-actual fields from `packages/harness/predictions.ts`'s `PredictionRecordSchema`, reconstructed locally (that schema is a `ZodEffects` from its own `.refine()` calls and cannot be `.extend()`-ed) plus `redTeams`/`blueTeams`, since a team-season artifact's per-match row needs the alliance rosters `PredictionRecordSchema` itself does not carry. */
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
    redComponents: z.record(z.string(), ComponentPredictionSchema),
    blueComponents: z.record(z.string(), ComponentPredictionSchema),
    variance: z.number().optional(),
    redRpPmf: z.array(z.number()).optional(),
    blueRpPmf: z.array(z.number()).optional(),
    actualWinner: z.enum(["red", "blue", "tie"]),
    actualRedScore: z.number(),
    actualBlueScore: z.number(),
    redTeams: z.array(z.string()),
    blueTeams: z.array(z.string()),
  })
  .refine((row) => isValidPmf(row.redRpPmf), {
    message: "redRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["redRpPmf"],
  })
  .refine((row) => isValidPmf(row.blueRpPmf), {
    message: "blueRpPmf, when present, must be non-empty and sum to 1 within 1e-9",
    path: ["blueRpPmf"],
  });

// ---------------------------------------------------------------------------
// TeamsArtifactSchema — v1/teams/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

/**
 * D-05's first at-risk artifact (~3,750 rows). Kept as narrow as a sortable
 * table actually needs — anything a row does not need for the teams table
 * belongs on the team page (`TeamSeasonArtifactSchema`) instead.
 */
const TeamsTableRowSchema = RecordAndMetricsSchema.extend({
  teamKey: z.string().min(1),
  teamNumber: z.number().int(),
  nickname: z.string(),
  eventCount: z.number().int().nonnegative(),
  matchCount: z.number().int().nonnegative(),
});

export const TeamsArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  season: z.number().int(),
  teams: z.array(TeamsTableRowSchema),
});

export type TeamsArtifact = z.infer<typeof TeamsArtifactSchema>;

// ---------------------------------------------------------------------------
// TeamSeasonArtifactSchema — v1/team/{teamKey}/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

const TeamSeasonEventSchema = z.object({
  eventKey: z.string().min(1),
  eventName: z.string(),
  startDate: z.string(),
  matches: z.array(TeamSeasonMatchSchema),
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
  seasonStats: RecordAndMetricsSchema,
  events: z.array(TeamSeasonEventSchema),
  /** D-28: the team's metric-history series, one row per match, using `MetricHistoryRowSchema`'s own field names (reused directly, not re-derived) so the team page's plot never has to translate between the sidecar and the published file. */
  metricHistory: z.array(MetricHistoryRowSchema),
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
 * The one page schema plan 04-01's tracer needed, widened by plan 04-02
 * Task 2 to carry `upcoming`'s real D-08 shape and a standings-style
 * `teams` list, and by plan 04-04 Task 1 to make `teams` REQUIRED (never
 * optional) — `publish.ts`'s `buildEventArtifact` now populates it for
 * every event artifact it assembles, defaulting to an empty array only for
 * an event that genuinely has no team data in this run's scope, never
 * omitting the key entirely. Left optional, "not populated yet" and "this
 * event genuinely has no teams" were indistinguishable, and the event
 * page's standings table would have rendered empty instead of failing
 * loudly on a real gap. `matches` is unchanged from the 04-01 tracer's
 * shape.
 */
export const EventArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: z.string().min(1),
  season: z.number().int(),
  matches: z.array(EventMatchSchema),
  upcoming: z.array(EventUpcomingMatchSchema),
  teams: z.array(EventTeamSchema),
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
});

/** One algorithm's `ScoreSlice` figures for one season/compLevel view — raw numbers only (D-21); no field here may be a delta or judgement between two algorithms' slices. */
const CompareSliceSchema = z.object({
  algorithmId: z.string().min(1),
  season: z.number().int(),
  seasonLabel: z.enum(["tune", "holdout"]),
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
