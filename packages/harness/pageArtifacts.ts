/**
 * Published page-artifact key scheme and Zod schemas (D-01/D-02/D-04, plan
 * 04-01 Task 3). These are the world-readable JSON files R2 serves directly
 * to the client (`packages/harness/r2Client.ts`'s `putObject`) — a different
 * contract from `packages/harness/artifact.ts`'s `HarnessArtifactSchema`
 * (the harness's own internal scoring artifact, never published). The two
 * are versioned independently: `PAGE_ARTIFACT_SCHEMA_VERSION` starts at 1
 * regardless of where `ARTIFACT_SCHEMA_VERSION` currently sits, because they
 * have different consumers (a browser fetching a page vs. this repo's own
 * harness tooling) and must be free to evolve on separate schedules.
 */
import { z } from "zod";

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

const ComponentPredictionSchema = z.object({
  mean: z.number(),
  variance: z.number().optional(),
});

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

/** D-08: filled by plan 04-02; this tracer always emits an empty array. Same match-row shape as `EventMatchSchema` minus the actuals, since an upcoming match has none yet. */
const EventUpcomingMatchSchema = z.object({
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
});

/**
 * The one page schema this tracer needs: one event's played matches (with
 * predictions vs. actuals) plus its upcoming matches (empty for this tracer,
 * per D-08). `generation`/`computedAt` are D-04's stamp — required, not
 * optional, so a mixed-generation read is detectable rather than silent.
 */
export const EventArtifactSchema = z.object({
  schemaVersion: z.literal(PAGE_ARTIFACT_SCHEMA_VERSION),
  /** D-04: a short opaque string identifying the publish run that produced this object. */
  generation: z.string().min(1),
  /** D-04: ISO timestamp of when this object was computed. */
  computedAt: z.string().min(1),
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  eventKey: z.string().min(1),
  season: z.number().int(),
  matches: z.array(EventMatchSchema),
  upcoming: z.array(EventUpcomingMatchSchema),
});

export type EventArtifact = z.infer<typeof EventArtifactSchema>;
