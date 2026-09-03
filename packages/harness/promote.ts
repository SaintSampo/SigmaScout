/**
 * D-13/D-14/D-15: explicit version promotion. A search evaluation
 * (`tune.ts`'s `reports/tune-*.json`, gitignored) is an EXPERIMENT, not a
 * version — it becomes one only through this script: reads the winning
 * parameter set, validates it, replays it on a bounded deterministic slice,
 * hashes the full-precision prediction stream, and writes a committed,
 * schema-valid version file under `data/algorithm-versions/` (the one
 * deliberate exception to `data/`'s otherwise-gitignored convention, per
 * `.gitignore`'s `data/*` + negation).
 *
 * Same standalone-script shape as `identifiability.ts`/`tune.ts`:
 * `parseArgs`, `async function main()`, an entry-point guard.
 *
 * ## `--set-param key=value` (repeatable), and what it is NOT for
 *
 * A search artifact records the winner of the search that was actually run.
 * Sometimes a single parameter has to be re-selected AFTER that search — the
 * motivating case (quick task 260901-is2, D-Q2) is `linkC`, which had to move
 * once the R estimator changed underneath it, without re-running the whole
 * joint search. `--set-param linkC=0.5` is how that divergence is expressed.
 *
 * Three properties make this auditable rather than a back door:
 *
 *   1. `--set-param` REQUIRES `--provenance-note`. An unexplained divergence
 *      from the search winner is exactly what this mechanism must not enable,
 *      so the human sentence is not optional decoration — it is the gate.
 *   2. The override changes the INPUT to a real replay. The digest is then
 *      produced by that replay, exactly as for any other promotion. A digest
 *      is NEVER hand-edited (`DigestSchema.predictionStreamSha256`'s own doc
 *      comment, and `digest.test.ts`'s prohibition) — this flag does not
 *      create an exception to that, it feeds the same machinery different
 *      parameters.
 *   3. Whenever any override is present the written file records
 *      `provenance.paramOverrides` (machine-readable), `provenance.note`
 *      (the human sentence), and `provenance.objectiveAppliesToPromotedParams:
 *      false`. That last field is what stops an overridden set from READING
 *      like a fresh tune: `provenance.objective` is the SEARCH winner's
 *      objective, and with an override it no longer describes the shipped
 *      parameter set. Recording that as a machine-readable fact is the whole
 *      point — the alternative (hand-authoring a derived search artifact
 *      under the gitignored `reports/`) would produce a committed file
 *      indistinguishable from a genuine search result.
 *
 * This is NOT a tuner: it applies exactly the values given, searches nothing,
 * and measures nothing. It is NOT a way to reshape a search result into a
 * claim — an override that violates a cross-parameter invariant is rejected
 * by `Sigma1ParamsSchema` (via `PromotedVersionSchema`) before anything is
 * written. A promotion with no overrides writes provenance byte-identical to
 * a pre-`--set-param` promotion: all three fields stay absent.
 *
 * ## `--from-version <path>`, and why `--from` could not be used
 *
 * `--from` reads a SEARCH ARTIFACT. `--from-version` reads a committed
 * VERSION FILE instead. Exactly one of the two is required. Introduced by
 * quick task 260901-trz for the `SIGMA1_CODE_VERSION` 3.0.0 -> 4.0.0 shape
 * change, where `--from` was not merely inconvenient but WRONG, for two
 * independent reasons:
 *
 *   1. `Sigma1ParamsSchema` is `z.strictObject` and D-T1 renamed five fields.
 *      Every candidate inside the retired search artifacts records the OLD
 *      absolute names, so `Sigma1ParamsSchema.parse(winnerCandidate.params)`
 *      throws before `--set-param` is ever consulted. A search artifact
 *      written under one parameter shape simply cannot be promoted under
 *      another.
 *   2. More seriously: the shipped `linkC = 0.5` exists ONLY as a
 *      `--set-param` override recorded in the committed version file. The
 *      search artifact's own winner carries 1.2398..., which the D-Q2 R
 *      estimator made stale. Re-promoting from the search artifact would have
 *      silently DROPPED a correction that is currently live on the site.
 *
 * The rejected alternative — hand-authoring a new-shape search artifact under
 * the gitignored `reports/` — is exactly what quick task 260901-is2 Task 4
 * rejected, and for the same reason: the resulting committed file would read
 * as a fresh tune.
 *
 * A `--from-version` promotion CARRIES FORWARD `searchArtifact`, `objective`,
 * `tuneSeasons`, `seed`, `survivors` and `losoSummary` from the source file
 * unchanged — they describe the search that produced the source parameter set,
 * which is still the honest lineage — and ADDS `derivedFromVersion` (the
 * source file's own `version` string) and `paramShapeMigration` (a
 * machine-readable tag naming the map applied). It sets
 * `objectiveAppliesToPromotedParams: false` UNCONDITIONALLY, even with no
 * `--set-param`: the recorded objective was computed by a DIFFERENT code
 * version, so it does not describe the shipped set. That is a stronger
 * statement than the `--set-param` case, not a weaker one.
 *
 * A SHAPE CHANGE IS NOT REQUIRED for any of the above. The 5.0.0 -> 6.0.0 bump
 * (quick task 260903-5dp, D-N3) went through this path with the parameter shape
 * completely unchanged — the code version had to move because the OUTPUT moved,
 * which is D-13's rule, and re-promoting through a real replay is what proves
 * the digest still reproduces. That promotion records `derivedFromVersion` and
 * `objectiveAppliesToPromotedParams: false` like any other, but NO
 * `paramShapeMigration`, since naming a no-op map would be a false provenance
 * entry. `--from-version` is therefore the tool for "the code changed" as much
 * as for "the shape changed".
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  SIGMA1_PARAM_KEYS,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "../core/algorithms/sigma1/params.js";
import {
  Legacy4Sigma1ParamsSchema,
  Legacy6Sigma1ParamsSchema,
  LegacyAbsoluteSigma1ParamsSchema,
  migrate4to5,
  migrate6to7,
  migrateAbsoluteToScaleRelative,
  SIGMA1_3_TO_4_MIGRATION_TAG,
  SIGMA1_4_TO_5_MIGRATION_TAG,
  SIGMA1_6_TO_7_MIGRATION_TAG,
} from "./legacyParams.js";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../corpus/db.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

const HeadlineMetricSchema = z.object({
  season: z.number().int(),
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
});

const ProvenanceSchema = z.object({
  /** Which search produced the promoted parameter set (D-14: provenance a version must carry). */
  searchArtifact: z.string().min(1),
  corpusIdentity: z.string().min(1),
  promotedAt: z.string().min(1),
  objective: z.number(),
  tuneSeasons: z.array(z.number().int()),
  /**
   * D-14 (plan 03-05 Task 3): the full provenance a JOINT-stage promotion
   * carries — "which search produced this, on which corpus, scoring what"
   * answerable from the file alone. All OPTIONAL so the pre-existing
   * tracer-stage promotion (03-01's `vpr@2.0.0+tracer-check.json`, renamed by
   * plan 07-16, D-04/D-05, from its pre-rename filename
   * `sigma1@2.0.0+tracer-check.json` [pre-rename] — which
   * never ran the screen or the joint search and therefore has no seed,
   * survivor list, or LOSO summary to report) keeps validating unchanged —
   * every field below IS populated for a joint-stage promotion.
   */
  searchArtifactSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  objectiveDefinition: z.string().min(1).optional(),
  evaluationCount: z.number().int().nonnegative().optional(),
  seed: z.number().int().optional(),
  screenArtifact: z.string().min(1).optional(),
  survivors: z.array(z.string()).optional(),
  losoSummary: z.unknown().optional(),
  adaptationMode: z.enum(["on", "off"]).optional(),
  /**
   * The `--set-param` audit trail (quick task 260901-is2 Task 4). All three
   * OPTIONAL, and populated ONLY when at least one override was applied, so
   * an unoverridden promotion writes provenance byte-identical to a
   * pre-`--set-param` one and every already-committed version file keeps
   * validating unchanged.
   */
  /** Machine-readable: exactly the `key=value` overrides applied on top of the search winner's parameter set, e.g. `{ "linkC": 0.5 }`. */
  paramOverrides: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  /** The `--provenance-note` sentence: WHY the shipped set diverges from the search winner. Required by the CLI whenever `paramOverrides` is present. */
  note: z.string().min(1).optional(),
  /**
   * Written as `false` whenever any override is present. `objective` above
   * is the SEARCH winner's objective value; once a parameter has been
   * overridden post-search, that number no longer describes the parameter
   * set this file actually ships. Recording that as a machine-readable fact
   * is what keeps an overridden promotion from reading like a fresh tune.
   */
  objectiveAppliesToPromotedParams: z.boolean().optional(),
  /**
   * The `--from-version` audit trail (quick task 260901-trz). Both OPTIONAL,
   * and populated ONLY by a `--from-version` promotion, so every
   * already-committed version file keeps validating unchanged.
   */
  /** The `version` string of the committed version file this promotion was derived FROM — e.g. `"3.0.0+tuned-2026-08"`. */
  derivedFromVersion: z.string().min(1).optional(),
  /** A machine-readable tag naming the parameter-shape map applied on the way (`legacyParams.ts`'s `SIGMA1_3_TO_4_MIGRATION_TAG`), or absent when the source file already used the current shape. */
  paramShapeMigration: z.string().min(1).optional(),
});

const DigestSchema = z.object({
  sliceSeason: z.number().int(),
  /** RECORDED, not re-derivable — re-running the slice later is a data read, never a re-query whose answer could change as the corpus grows. */
  sliceEventKeys: z.array(z.string().min(1)).min(1),
  sliceMatchCount: z.number().int().nonnegative(),
  /** D-16: "unchanged" means bitwise identical — this hash is the assertion target `digest.test.ts` re-derives, never hand-edited to make a failing reproduction pass (must_haves.prohibitions). */
  predictionStreamSha256: z.string().regex(/^[0-9a-f]{64}$/),
  headlineMetrics: z.array(HeadlineMetricSchema),
});

/** D-13's committed version-file shape: a code version paired with a named, committed parameter set, plus the provenance and digest that make it SC-5-reproducible. */
export const PromotedVersionSchema = z.object({
  id: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  params: Sigma1ParamsSchema,
  provenance: ProvenanceSchema,
  digest: DigestSchema,
});

export type PromotedVersion = z.infer<typeof PromotedVersionSchema>;

/**
 * 03-REVIEW IN-01: the minimal load-bearing shape of a `tune.ts` search
 * artifact, validated at the read boundary in BOTH this file and `cli.ts`'s
 * `loadSearchWinnerVpr` — a truncated or hand-edited artifact fails with a
 * named ZodError instead of a raw `TypeError` on `.find`. Deliberately
 * narrow and `.passthrough()`-tolerant (matching `baselineFingerprint.ts`'s
 * read-schema idiom): provenance-only fields stay unvalidated; the winning
 * candidate's `params` are separately parsed through `Sigma1ParamsSchema`
 * at each call site, exactly as before.
 */
export const TuneSearchOutputMinimalSchema = z
  .object({
    winnerIndex: z.number().int(),
    candidates: z.array(z.object({ index: z.number().int(), params: z.unknown() }).passthrough()),
  })
  .passthrough();

/**
 * D-15/D-16's digest: one line per prediction, `JSON.stringify([matchKey,
 * pRedWin, redScore, blueScore])`, newline-joined, SHA-256 hashed to a
 * lowercase hex string. `JSON.stringify`'s own number formatting is the
 * shortest round-trippable form and is spec-determined — never rounded,
 * `toFixed`'d, or truncated, since this digest is the only thing standing
 * between a real reproduction and a plausible-looking one.
 */
export function computePredictionStreamDigest(records: readonly PredictionRecord[]): string {
  const lines = records.map((r) =>
    JSON.stringify([r.match.matchKey, r.prediction.pRedWin, r.prediction.redScore, r.prediction.blueScore])
  );
  const serialized = lines.join("\n");
  return createHash("sha256").update(serialized).digest("hex");
}

/** One applied `--set-param`, as it is recorded in `provenance.paramOverrides`. */
export type ParamOverrides = Readonly<Record<string, number | boolean>>;

/**
 * Parses `--set-param` specs (`"key=value"`) into the override record that
 * is BOTH applied to the parameter set and written to
 * `provenance.paramOverrides` — one parse, so the file can never claim an
 * override it did not apply (or apply one it did not record).
 *
 * Validation is deliberately about the SPEC, not about cross-parameter
 * invariants: an unknown key, a non-numeric/non-finite number, or a
 * non-boolean value for the one boolean field throws here, immediately and
 * by name. Whether the RESULTING set is internally consistent (D-07's
 * process-noise ordering, T-03-06's clamp, D-04's carry-weight ranges) is
 * `Sigma1ParamsSchema`'s job and is enforced downstream by
 * `PromotedVersionSchema.parse` on the validate-then-write boundary — no new
 * invariant call site is added here, because the strengthened schema already
 * does that work for every construction path.
 *
 * Which field is boolean is read off `DEFAULT_SIGMA1_PARAMS`'s own runtime
 * types rather than a hand-typed list, so adding a second boolean parameter
 * to `Sigma1Params` cannot silently leave this function behind.
 */
export function parseParamOverrides(specs: readonly string[]): ParamOverrides {
  const overrides: Record<string, number | boolean> = {};
  for (const spec of specs) {
    const separator = spec.indexOf("=");
    if (separator <= 0) {
      throw new Error(`--set-param expects "key=value", got "${spec}"`);
    }
    const key = spec.slice(0, separator).trim();
    const rawValue = spec.slice(separator + 1).trim();
    if (!(SIGMA1_PARAM_KEYS as readonly string[]).includes(key)) {
      throw new Error(`--set-param: unknown parameter "${key}". Valid keys: ${SIGMA1_PARAM_KEYS.join(", ")}`);
    }
    const currentValue = DEFAULT_SIGMA1_PARAMS[key as keyof Sigma1Params];
    if (typeof currentValue === "boolean") {
      if (rawValue !== "true" && rawValue !== "false") {
        throw new Error(`--set-param: "${key}" is a boolean parameter and accepts only "true" or "false", got "${rawValue}"`);
      }
      overrides[key] = rawValue === "true";
      continue;
    }
    // `Number("")` is 0, which would silently promote `--set-param linkC=`
    // into a real value — rejected explicitly rather than by the finiteness
    // check, which would not catch it.
    if (rawValue === "") {
      throw new Error(`--set-param: "${key}" was given an empty value`);
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`--set-param: "${key}" must be a finite number, got "${rawValue}"`);
    }
    overrides[key] = parsed;
  }
  return overrides;
}

/**
 * Applies `--set-param` specs on top of a validated parameter set. Pure (no
 * corpus, no filesystem, no replay) and exported so the override semantics
 * are testable on their own — `main` is not exported, so without this
 * boundary the only way to exercise a typo'd key would be a full corpus run.
 *
 * The returned object is NOT re-validated here on purpose; see
 * `parseParamOverrides`'s note on where invariant enforcement lives.
 */
export function applyParamOverrides(params: Sigma1Params, specs: readonly string[]): Sigma1Params {
  const overrides = parseParamOverrides(specs);
  return { ...params, ...overrides } as Sigma1Params;
}

/**
 * The bounded, deterministic slice: event keys in `season` with
 * `is_offseason = 0` having at least 60 played `qm` matches with
 * `has_score_breakdown = 1`, `ORDER BY event_key ASC LIMIT limit`. Returned
 * (and RECORDED in the promoted version file) rather than re-queried at
 * reproduction time, so a growing corpus can never silently change which
 * events a committed digest was computed over.
 */
function resolveSliceEventKeys(db: Corpus, season: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT e.event_key AS event_key
       FROM events e
       JOIN matches m ON m.event_key = e.event_key
       WHERE e.year = ? AND e.is_offseason = 0 AND m.winner IS NOT NULL
         AND m.comp_level = 'qm' AND m.has_score_breakdown = 1
       GROUP BY e.event_key
       HAVING COUNT(*) >= 60
       ORDER BY e.event_key ASC
       LIMIT ?`
    )
    .all(season, limit) as { event_key: string }[];
  return rows.map((row) => row.event_key);
}

function parseSliceSeason(spec: string): number {
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season) || String(season).length !== 4) {
    throw new Error(`--slice-season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

function parseSliceEvents(spec: string): number {
  const n = Number.parseInt(spec, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--slice-events must be a positive integer, got "${spec}"`);
  }
  return n;
}

interface TuneSearchCandidate {
  readonly index: number;
  readonly params: unknown;
  readonly objective: number;
}

/**
 * Wide enough to describe either `tune.ts` output shape (`--stage tracer`
 * or `--stage screen`/`--stage joint`) — every joint-specific field is
 * optional so this interface (and the provenance built from it) degrades
 * gracefully for a non-joint search artifact.
 */
/**
 * A codeVersion-tolerant read of a committed version file for
 * `--from-version`: identical to `PromotedVersionSchema` except that `params`
 * is left UNVALIDATED here, because which schema validates it depends on the
 * file's own `codeVersion` (a 3.0.0 file's params are the retired absolute
 * shape, which the current `Sigma1ParamsSchema` rejects outright). The params
 * are then parsed by exactly one of `LegacyAbsoluteSigma1ParamsSchema` (then
 * migrated) or `Sigma1ParamsSchema` — never neither, and never leniently.
 */
const SourceVersionSchema = z.object({
  id: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  version: z.string().min(1),
  params: z.unknown(),
  provenance: ProvenanceSchema,
  digest: DigestSchema,
});

/** Everything a promotion needs to know about where its parameter set came from, whichever of the two source flags produced it. */
export interface PromotionSource {
  /** The validated, pre-`--set-param` parameter set, in the CURRENT shape. */
  readonly params: Sigma1Params;
  /** What goes into `provenance` verbatim (minus the `--set-param` block, which `main` adds). */
  readonly provenance: Omit<z.infer<typeof ProvenanceSchema>, "corpusIdentity" | "promotedAt">;
}

interface TuneSearchOutput {
  readonly stage?: string;
  readonly seasons: readonly number[];
  readonly winnerIndex: number;
  readonly candidates: readonly TuneSearchCandidate[];
  readonly evals?: number;
  readonly seed?: number;
  readonly survivorsPath?: string;
  readonly survivors?: readonly string[];
  readonly loso?: unknown;
  readonly adaptation?: "on" | "off";
}

/**
 * Which of the two mutually exclusive source flags this invocation names, and
 * the path it resolves to. Exported and PURE (no filesystem, no corpus) so
 * the exactly-one rule is testable without a full promotion run — the same
 * reason `parseParamOverrides`/`applyParamOverrides` are exported.
 *
 * Exactly one source is required. BOTH would mean two different parameter
 * sets with no stated precedence, and silently preferring one would make the
 * committed file's lineage a coin flip; NEITHER means no parameter set at
 * all. `--adaptation on|off` is a shorthand that fills in `--from` only.
 */
export function resolvePromotionSourcePath(
  from: string | undefined,
  fromVersion: string | undefined,
  adaptationSpec: string | undefined
): { readonly kind: "search-artifact" | "version-file"; readonly path: string } {
  const fromPath = from ?? (adaptationSpec !== undefined ? join("reports", `tune-joint-${adaptationSpec}.json`) : undefined);
  if (fromPath !== undefined && fromVersion !== undefined) {
    throw new Error(
      "--from and --from-version are alternatives: pass exactly one. --from reads a search artifact; --from-version reads a committed version file."
    );
  }
  if (fromVersion !== undefined) return { kind: "version-file", path: fromVersion };
  if (fromPath !== undefined) return { kind: "search-artifact", path: fromPath };
  throw new Error(
    "one of --from (e.g. --from reports/tune-tracer.json, or --adaptation on|off) or --from-version (e.g. --from-version data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json) is required"
  );
}

/** The pre-existing `--from` path, unchanged in behaviour and lifted out of `main` so the two sources sit side by side. */
function loadFromSearchArtifact(fromPath: string): PromotionSource {
  const searchArtifactRaw = readFileSync(fromPath, "utf8");
  // D-14/T-03-15: the search artifact's own content hash, recorded in
  // provenance so the promoted file names exactly the bytes it was derived
  // from — a hand-edited search log between the search and the promotion
  // produces a hash mismatch rather than a silent substitution.
  const searchArtifactSha256 = createHash("sha256").update(searchArtifactRaw).digest("hex");
  // 03-REVIEW IN-01: validate the load-bearing shape before the cast — the
  // cast then only widens to the optional provenance fields `.passthrough()`
  // already preserved at runtime.
  const searchOutput = TuneSearchOutputMinimalSchema.parse(JSON.parse(searchArtifactRaw)) as unknown as TuneSearchOutput;
  const winnerCandidate = searchOutput.candidates.find((c) => c.index === searchOutput.winnerIndex);
  if (!winnerCandidate) {
    throw new Error(`promote: ${fromPath} has no candidate at winnerIndex ${searchOutput.winnerIndex}`);
  }

  // T-03-08's mitigation: an unknown key, a missing key, or a NaN/Infinity
  // value in the search output's winning parameter set throws here, before
  // it can ever reach a committed version file. D-11 / 03-REVIEW WR-01: this
  // same parse now also enforces the cross-parameter invariants folded into
  // `Sigma1ParamsSchema` itself — no new call was added at this site, the
  // strengthened schema is enough.
  return {
    params: Sigma1ParamsSchema.parse(winnerCandidate.params),
    provenance: {
      searchArtifact: fromPath,
      objective: winnerCandidate.objective,
      tuneSeasons: [...searchOutput.seasons],
      // D-14 (plan 03-05 Task 3): the full joint-stage provenance -- every
      // field below is populated whenever the search artifact actually
      // carries it (a `--stage joint` log always does; a bare tracer log
      // does not, and these simply stay undefined for that case, matching
      // `ProvenanceSchema`'s own optional fields).
      searchArtifactSha256,
      objectiveDefinition: "mean tune-season brierScore (combined compLevelView), minimized (D-01)",
      evaluationCount: searchOutput.evals ?? searchOutput.candidates.length,
      seed: searchOutput.seed,
      screenArtifact: searchOutput.survivorsPath,
      survivors: searchOutput.survivors ? [...searchOutput.survivors] : undefined,
      losoSummary: searchOutput.loso,
      adaptationMode: searchOutput.adaptation,
    },
  };
}

/**
 * The `--from-version` path (quick task 260901-trz) — see this file's header
 * for why it exists and what it may NOT be replaced by.
 *
 * The source file's `codeVersion` decides which schema validates its params.
 * A file at the CURRENT `SIGMA1_CODE_VERSION` is parsed by
 * `Sigma1ParamsSchema` and promoted as-is; an OLDER file is parsed by ITS OWN
 * frozen schema and mapped by that shape's own migration
 * (`Legacy6Sigma1ParamsSchema` + `migrate6to7` for 6.x AND 5.x — one shape,
 * two versions, since the 5->6 bump moved no field —
 * `Legacy4Sigma1ParamsSchema` + `migrate4to5` for 4.x,
 * `LegacyAbsoluteSigma1ParamsSchema` + `migrateAbsoluteToScaleRelative` for
 * 3.x). Each retired shape gets a schema of its own, never an edit to an
 * existing one — that rule is what keeps an already-migrated file's meaning
 * from changing retroactively. A file claiming a codeVersion NEWER than this
 * code is refused outright rather than guessed at — there is no map from a
 * shape this code has never seen.
 *
 * Every provenance field describing the SEARCH carries forward unchanged: it
 * still honestly describes the search that produced the source parameter set.
 * What is ADDED is the fact that this file is one migration removed from that
 * search — `derivedFromVersion`, `paramShapeMigration`, and an unconditional
 * `objectiveAppliesToPromotedParams: false`.
 */
export function loadFromVersionFile(fromVersionPath: string): PromotionSource {
  const raw: unknown = JSON.parse(readFileSync(fromVersionPath, "utf8"));
  const sourceVersion = SourceVersionSchema.parse(raw);

  let params: Sigma1Params;
  let paramShapeMigration: string | undefined;
  if (sourceVersion.codeVersion === SIGMA1_CODE_VERSION) {
    params = Sigma1ParamsSchema.parse(sourceVersion.params);
  } else if (sourceVersion.codeVersion.startsWith("6.") || sourceVersion.codeVersion.startsWith("5.")) {
    // D-Y1/D-Y3 (quick task 260903-750): 6.0.0 -> 7.0.0 DROPS
    // `varianceOprRidge` and ADDS `swingHalfLifeMatches`/`swingScale`, because
    // the estimator behind every published `±` changed from a per-event
    // variance decomposition to each team's own recency-weighted swing.
    //
    // ONE branch for 6.x and 5.x, which is not a shortcut but the shape's own
    // history: `legacyParams.ts` records that the 5->6 bump moved no field at
    // all, so `Legacy6Sigma1ParamsSchema` describes both versions exactly and a
    // separate 5.x branch would be the same schema under a second name. The
    // 5.x branch this replaces did no mapping (the CURRENT schema then
    // validated a 5.x file directly); that stopped being true the moment 7.0.0
    // changed the field set, so both versions now route through the same map.
    //
    // A `paramShapeMigration` TAG IS RECORDED HERE, and the contrast with the
    // branch this replaces is the point. That one deliberately recorded NO tag,
    // on the grounds that naming a no-op migration would put a false entry in
    // every promoted file's provenance. This hop genuinely drops a field and
    // adds two, so a tag is the honest statement rather than a decorative one —
    // the rule was never "prefer no tag", it was "the tag must be true".
    params = migrate6to7(Legacy6Sigma1ParamsSchema.parse(sourceVersion.params));
    paramShapeMigration = SIGMA1_6_TO_7_MIGRATION_TAG;
  } else if (sourceVersion.codeVersion.startsWith("4.")) {
    // D-V4 (quick task 260902-varopr): 4.0.0 -> 5.0.0. Its own frozen schema,
    // BESIDE the 3.x one rather than replacing it — see `legacyParams.ts`.
    //
    // The TAG names TWO hops now, because `migrate4to5` composes through
    // `migrate6to7` rather than duplicating it (a 4.0.0 set is a 6.0.0-shaped
    // set minus one field). It really does traverse both maps, so recording
    // only the first would understate what happened to the file — the same
    // "the tag must be true" rule the 6.x branch above states and the 3.x
    // branch below has followed since 5.0.0.
    params = migrate4to5(Legacy4Sigma1ParamsSchema.parse(sourceVersion.params));
    paramShapeMigration = `${SIGMA1_4_TO_5_MIGRATION_TAG}+${SIGMA1_6_TO_7_MIGRATION_TAG}`;
  } else if (sourceVersion.codeVersion.startsWith("3.")) {
    // CHAINED, one hop per map: 3.0.0 -> 4.0.0 -> 5.0.0 -> 7.0.0. Each
    // migration knows only about the shape immediately after its own, so adding
    // 5.0.0 did not require editing the 3.x map's field-by-field conversion at
    // all — only composing onto it here — and adding 7.0.0 did not require
    // editing this line at all, because the new hop composed inside
    // `migrate4to5`. `legacyParams.ts`'s header records why this chaining was
    // unavoidable rather than optional.
    params = migrate4to5(migrateAbsoluteToScaleRelative(LegacyAbsoluteSigma1ParamsSchema.parse(sourceVersion.params)));
    paramShapeMigration = `${SIGMA1_3_TO_4_MIGRATION_TAG}+${SIGMA1_4_TO_5_MIGRATION_TAG}+${SIGMA1_6_TO_7_MIGRATION_TAG}`;
  } else {
    throw new Error(
      `promote --from-version: ${fromVersionPath} records codeVersion "${sourceVersion.codeVersion}", for which this code has no ` +
        `parameter-shape map (current is "${SIGMA1_CODE_VERSION}"; 6.x and 5.x share one retired shape, and 4.x/3.x are the other two migratable shapes). Refusing to guess at a shape it has never seen.`
    );
  }

  return {
    params,
    provenance: {
      // Carried FORWARD, unchanged: these describe the search that produced
      // the source parameter set, and that lineage is still the honest one.
      searchArtifact: sourceVersion.provenance.searchArtifact,
      objective: sourceVersion.provenance.objective,
      tuneSeasons: [...sourceVersion.provenance.tuneSeasons],
      searchArtifactSha256: sourceVersion.provenance.searchArtifactSha256,
      objectiveDefinition: sourceVersion.provenance.objectiveDefinition,
      evaluationCount: sourceVersion.provenance.evaluationCount,
      seed: sourceVersion.provenance.seed,
      screenArtifact: sourceVersion.provenance.screenArtifact,
      survivors: sourceVersion.provenance.survivors ? [...sourceVersion.provenance.survivors] : undefined,
      losoSummary: sourceVersion.provenance.losoSummary,
      adaptationMode: sourceVersion.provenance.adaptationMode,
      // Also carried forward, and this one is load-bearing: `paramOverrides`
      // and `note` record how the SOURCE parameter set diverged from its
      // search winner, and every such divergence SURVIVES the migration — it
      // is still present in the set this file ships. `tuned-2026-08`'s
      // `linkC = 0.5` is the motivating case: it exists nowhere else (the
      // search artifact's winner records the stale 1.2398...), so dropping
      // the note here would leave the shipped value with no recorded reason
      // once the source file is retired. `main` MERGES any `--set-param` this
      // promotion applies on top of these rather than replacing them.
      paramOverrides: sourceVersion.provenance.paramOverrides,
      note: sourceVersion.provenance.note,
      // ADDED: what this promotion did on top of that lineage.
      derivedFromVersion: sourceVersion.version,
      paramShapeMigration,
      // UNCONDITIONAL, even with no `--set-param`, and a STRONGER statement
      // than the override case: `objective` above was computed by a DIFFERENT
      // code version, on a DIFFERENTLY-SHAPED parameter set. It does not
      // describe the set this file ships, and recording that as a
      // machine-readable fact is what keeps a migrated promotion from reading
      // like a fresh tune.
      objectiveAppliesToPromotedParams: false,
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      "from-version": { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      "slice-season": { type: "string" },
      "slice-events": { type: "string" },
      adaptation: { type: "string" },
      "code-version": { type: "string" },
      "set-param": { type: "string", multiple: true },
      "provenance-note": { type: "string" },
    },
  });

  // Task 4 (quick task 260901-is2): the two flags are a PAIR. An override
  // with no explanation is the thing this mechanism must not enable, and a
  // note with no override would be silently dropped from the written file
  // (the three provenance fields are populated only when overrides exist) —
  // so refuse both halves of the mismatch rather than half-honouring either.
  const setParamSpecs = values["set-param"] ?? [];
  const provenanceNote = values["provenance-note"]?.trim();
  if (setParamSpecs.length > 0 && (provenanceNote === undefined || provenanceNote === "")) {
    throw new Error(
      "--set-param requires --provenance-note: a promoted parameter set that diverges from its search winner must say why, in the committed file"
    );
  }
  if (setParamSpecs.length === 0 && provenanceNote !== undefined && provenanceNote !== "") {
    throw new Error("--provenance-note is only recorded alongside --set-param (there is no divergence for it to explain)");
  }

  // D-14 (plan 03-05 Task 3): `--adaptation on|off` names WHICH of the two
  // equal-budget joint searches to promote FROM by defaulting `--from` to
  // its matching log — `--from` still wins if given explicitly, so a
  // non-joint (e.g. tracer) artifact can still be promoted without ever
  // naming `--adaptation`.
  const adaptationSpec = values.adaptation;
  if (adaptationSpec !== undefined && adaptationSpec !== "on" && adaptationSpec !== "off") {
    throw new Error(`--adaptation must be "on" or "off", got "${adaptationSpec}"`);
  }
  const sourceSpec = resolvePromotionSourcePath(values.from, values["from-version"], adaptationSpec);
  const paramSetName = values.name;
  if (!paramSetName) throw new Error("--name is required (the paramSetName half of D-13's {codeVersion}+{paramSetName} identity)");
  // D-04/D-05 (plan 07-16): a future promotion's default id is the renamed
  // published identity, so an operator who omits `--id` stamps a version
  // file the current registry/publisher/manifest chain actually resolves.
  const id = values.id ?? "vpr";
  const codeVersion = values["code-version"] ?? SIGMA1_CODE_VERSION;
  const sliceSeason = values["slice-season"] !== undefined ? parseSliceSeason(values["slice-season"]) : COLD_START_SEASON;
  const sliceEvents = values["slice-events"] !== undefined ? parseSliceEvents(values["slice-events"]) : 3;

  const source: PromotionSource =
    sourceSpec.kind === "version-file" ? loadFromVersionFile(sourceSpec.path) : loadFromSearchArtifact(sourceSpec.path);
  const searchedParams = source.params;
  // Task 4 (quick task 260901-is2): `--set-param` is applied to the VALIDATED
  // source set, so an override is always a delta against a set that was
  // itself well-formed. The overridden result is re-validated by
  // `PromotedVersionSchema.parse` at the validate-then-write boundary below —
  // an override that breaks a cross-parameter invariant throws there, before
  // anything reaches disk.
  const paramOverrides = setParamSpecs.length > 0 ? parseParamOverrides(setParamSpecs) : undefined;
  const overriddenParams: Sigma1Params = paramOverrides ? applyParamOverrides(searchedParams, setParamSpecs) : searchedParams;
  // Task 3's own instruction: the search fixes `rpMonteCarloDraws: 0` for
  // speed (plan 03-03 proved this never moves `pRedWin`/predicted scores),
  // but the PROMOTED, SHIPPED parameter set must restore the versioned draw
  // count — shipping a version whose `params` says "0 draws" would describe
  // a configuration that was never actually run in production. Re-validated
  // below (`Sigma1ParamsSchema.parse` runs again inside `PromotedVersionSchema`)
  // so the file that is actually written is the one that was actually checked.
  const params: Sigma1Params = { ...overriddenParams, rpMonteCarloDraws: DEFAULT_SIGMA1_PARAMS.rpMonteCarloDraws };

  const db = openCorpusReadOnly(CORPUS_PATH);
  let sliceEventKeys: string[];
  let records: PredictionRecord[];
  try {
    sliceEventKeys = resolveSliceEventKeys(db, sliceSeason, sliceEvents);
    if (sliceEventKeys.length === 0) {
      throw new Error(
        `promote: no events in season ${sliceSeason} meet the bounded-slice criteria (>= 60 played qm matches with a score breakdown)`
      );
    }

    const stream = selectMatchesChronological(db, { year: sliceSeason, excludeOffseason: true }).filter((match) =>
      sliceEventKeys.includes(match.eventKey)
    );

    const algorithm = makeSigma1({ id, linkMode: "predictive-variance", params, paramSetName });
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const simulator = new WalkForwardSimulator(stream);
    records = simulator.run(algorithm, teams);
  } finally {
    db.close();
  }

  const predictionStreamSha256 = computePredictionStreamDigest(records);

  const predictions: HarnessPredictionInput[] = records.map((r) => ({
    matchKey: r.match.matchKey,
    season: sliceSeason,
    // D-T6 (quick task 260901-trz): carried for downstream event-blocked
    // resampling — see `HarnessPredictionInput.eventKey`'s own doc comment.
    eventKey: r.match.eventKey,
    compLevel: r.match.compLevel,
    algorithmId: id,
    pRedWin: r.prediction.pRedWin,
    predictedRedScore: r.prediction.redScore,
    predictedBlueScore: r.prediction.blueScore,
    actualWinner: r.match.winner,
    isOffseason: false,
    isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
  }));
  // D-2 (quick task 260903-krp): a deliberately bounded single-season slice —
  // `headlineEligible` is never read below (only `brierScore`/
  // `winnerAccuracy` are), so the narrow `[sliceSeason]` set is not mistaken
  // for a headline claim.
  // D-2 (quick task 260903-n2o): the sentinel — this bounded digest slice
  // claims no eligibility at all.
  const slices = aggregateScores(predictions, {
    corpusSeasons: [sliceSeason],
    selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED,
  });
  const combinedSlice = slices.find((s) => s.compLevelView === "combined" && s.season === sliceSeason);
  const headlineMetrics = combinedSlice
    ? [{ season: sliceSeason, brierScore: combinedSlice.brierScore, winnerAccuracy: combinedSlice.winnerAccuracy }]
    : [];

  const version = `${codeVersion}+${paramSetName}`;

  const candidate: PromotedVersion = {
    id,
    codeVersion,
    paramSetName,
    version,
    params,
    provenance: {
      ...source.provenance,
      corpusIdentity: CORPUS_PATH,
      promotedAt: new Date().toISOString(),
      // Task 4 (quick task 260901-is2): populated as a group, and ONLY when
      // an override was actually applied — a no-override promotion writes
      // provenance byte-identical to a pre-`--set-param` one. `false` is
      // hardcoded rather than computed because the condition for writing
      // this block IS "an override exists", and an override is exactly what
      // makes the recorded `objective` stop describing the shipped set.
      //
      // Quick task 260901-trz: MERGED with, never replacing, any block
      // carried forward by `--from-version` (see `loadFromVersionFile`). A
      // replace would silently drop an EARLIER divergence that is still
      // present in the shipped set — exactly the `linkC = 0.5` failure this
      // whole `--from-version` path exists to avoid. This promotion's own
      // overrides win on a key collision, which is correct: it applied them
      // last. Two notes are joined rather than one discarded.
      ...(paramOverrides
        ? {
            paramOverrides: { ...source.provenance.paramOverrides, ...paramOverrides },
            note:
              source.provenance.note !== undefined
                ? `${source.provenance.note}\n\n${provenanceNote}`
                : provenanceNote,
            objectiveAppliesToPromotedParams: false as const,
          }
        : {}),
    },
    digest: {
      sliceSeason,
      sliceEventKeys,
      sliceMatchCount: records.length,
      predictionStreamSha256,
      headlineMetrics,
    },
  };

  // Validate-then-write (buildArtifact's own discipline, artifact.ts:107-112):
  // throws rather than persisting a malformed version.
  const validated = PromotedVersionSchema.parse(candidate);
  const serialized = JSON.stringify(validated, null, 2);

  // T-03-04: this path opens the corpus read-only and makes no network
  // call, so the TBA API key is never legitimately in scope here — but the
  // same refusal writeArtifact already implements (artifact.ts:140) is
  // applied anyway, defense in depth against an env leaking in unexpectedly.
  const apiKey = process.env["TBA_API_KEY"];
  if (apiKey && serialized.includes(apiKey)) {
    throw new Error("Refusing to write promoted version: serialized output contains a secret value.");
  }

  mkdirSync(ALGORITHM_VERSIONS_DIR, { recursive: true });
  const outPath = join(ALGORITHM_VERSIONS_DIR, `${id}@${version}.json`);
  writeFileSync(outPath, serialized, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`  digest: ${predictionStreamSha256}`);
  // A migrated promotion must be as loud in the terminal as an overridden one.
  if (source.provenance.derivedFromVersion !== undefined) {
    console.log(`  derivedFromVersion: ${source.provenance.derivedFromVersion}`);
    console.log(`  paramShapeMigration: ${source.provenance.paramShapeMigration ?? "(none — source already used the current shape)"}`);
    // The shape half of this warning is only true when a map actually ran. A
    // same-shape promotion (5.0.0 -> 6.0.0) must not print a claim about a
    // reshaping that did not happen — the code-version half is what is always
    // true, and overstating it here is how a terminal log stops being evidence.
    console.log(
      source.provenance.paramShapeMigration !== undefined
        ? `  NOTE: provenance.objective was computed by a DIFFERENT code version on a DIFFERENTLY-SHAPED parameter set.`
        : `  NOTE: provenance.objective was computed by a DIFFERENT code version (the parameter shape is unchanged).`
    );
  }
  console.log(`  slice: season ${sliceSeason}, ${sliceEventKeys.length} events, ${records.length} matches`);
  // Task 4: a promotion that silently applied an override must be
  // impossible to miss in the terminal, not merely discoverable by reading
  // the written file afterwards.
  if (paramOverrides) {
    const rendered = Object.entries(paramOverrides)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ");
    console.log(`  paramOverrides (--set-param): ${rendered}`);
    console.log(`  provenance note: ${provenanceNote}`);
    console.log(`  NOTE: provenance.objective describes the SEARCH winner, NOT this overridden parameter set.`);
  }
  // T-03-17: a promotion whose slice differs from the last one extracted
  // leaves digest.test.ts's committed fixture stale until this command is
  // re-run — print it explicitly so that can never happen silently.
  console.log(`  If this version's slice is new or changed, refresh the CI fixture:`);
  console.log(`    pnpm tsx packages/harness/fixtures/extract-digest-slice.ts --version ${outPath}`);
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from a test) must never have the side effect
// of running a real corpus replay or writing a version file.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("promote failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
