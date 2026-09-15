/**
 * READ-ONLY PRE-EVENT STATE PROBE, a separate Worker (`wrangler.probe.toml`)
 * that answers before an event, not in front of visitors:
 *
 *   1. Can the deployed bundle deserialize the rows in live D1? That depends
 *      on which `STATE_SNAPSHOT_SHAPE_VERSION` was deployed, so only the
 *      deployed runtime can settle it.
 *   2. What does a tick that folds the ranking-point path cost in real CPU
 *      time? An idle tick never reads a league row, so its `cpuTime` cannot say.
 *   3. What does Phase B's artifact merge cost — the read-parse-merge-splice-
 *      stringify path that the browser-pricing work made BIGGER, by putting a
 *      `state` block of tens of KB into every live event artifact? (`phaseB=1`.)
 *
 * WRITE GUARANTEE, two layers: R2 and KV are structurally unwritable (their
 * bindings are absent from `wrangler.probe.toml`). D1 is NOT: Workers has no
 * read-only D1 binding, so "never writes D1" is enforced only by
 * `test/stateProbe.test.ts` (import graph, comment-stripped source scan,
 * fake-D1 write count). THIS FILE MUST NEVER:
 *   - call `writeScopedState` / `writeEventCursor` / any `artifactWriter.ts`
 *     export, or import `scheduled.ts` (that pulls the write helpers into
 *     the import graph). Phase B's merge is imported from `artifactMerge.ts`
 *     instead, which exists for exactly this reason: the probe prices Phase B
 *     by calling the tick's OWN merge functions, never a copy of them;
 *   - issue an outbound request through anything but `fetchArtifactText`
 *     below — one call site, `method: "GET"`, no request body, protocol
 *     asserted `https:`. The artifact origin is read, never mutated;
 *   - time itself with `Date.now()`/`performance.now()`: Cloudflare freezes
 *     both between I/O operations, so it would report `durationMs: 0`.
 *     Timing is the runtime's `cpuTime`, read off `wrangler tail`.
 *
 * Hence `probeSelectionsFor` duplicates `scheduled.ts`'s `selectionsFor`,
 * pinned equal by `stateProbe.test.ts`.
 *
 * ARMS: `?rp=0` skips exactly the tick's Phase A ranking-point operations
 * (mean shift included; list in `runSprFold`), so their CPU share is measured
 * as a difference between two runs. `rp` absent is ON. `?rpSkip=` further
 * splits that arm into five independently switchable RP components (see
 * `resolveRpArm`), so a single component's cost can be attributed rather than
 * the whole RP path at once. `?phaseB=1` adds the Phase B emulation on top;
 * it is OFF by default, so every RP arm is unchanged by its existence.
 * Runbook: `docs/worker-operations.md`, "Pre-event probe".
 *
 * SCOPE: Phase A (state read, fold, serialize, discard) plus, under
 * `phaseB=1`, an emulation of Phase B's merge/splice/stringify. Never the TBA
 * poll, the KV manifest read, the global rebuild, a second concurrent event or
 * any R2 write. Runbook: `docs/worker-operations.md`, "Pre-event probe".
 */
import {
  readScopedState,
  selectChangedRows,
  MAX_SCOPE_KEYS_PER_READ,
  type ScopeSelection,
  type StateRow,
} from "./stateStore.js";
import {
  mergeEventArtifact,
  mergeTeamSeasonArtifact,
  playedRowFactsFor,
  type MatchBand,
  type PlayedRowFacts,
  type ScheduledMatchFacts,
  type Stamp,
} from "./artifactMerge.js";
import {
  deserializeState,
  serializeState,
  readSigmaBeliefs,
  readSigmaPopulation,
  readRpBeliefs,
  readRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  withRpBeliefs,
  withRpMeanShift,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateStamp,
} from "../../../packages/harness/stateSnapshot.js";
import { buildEventStateBlock } from "../../../packages/harness/eventStatePricing.js";
import {
  artifactKey,
  LiveEventArtifactSchema,
  TeamSeasonArtifactSchema,
  type LiveEventArtifact,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import type { ParsedBonusSides } from "../../../packages/harness/publishedRows.js";
import { SigmaScoreAccumulator, usesSigmaScore, publishesRankingPoints, sigmaMatchBandVariance } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../../../packages/core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { isDemoTeamKey } from "../../../packages/core/algorithms/demoTeams.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import type { SprState } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult, type Prediction, type TeamMetric } from "../../../packages/core/algorithms/types.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/manifestSchemas.js";

// `opr`/`epa` are dispatched by id in the deserialize loop below; referenced
// here so all three published algorithms stay in the graph on purpose.
void opr;
void epa;

/** The probe's entire binding surface, declared locally (not `./env.js`'s `Env`) so no edit can reach bindings `wrangler.probe.toml` does not declare. */
interface ProbeEnv {
  readonly DB: D1Database;
}

// ---------------------------------------------------------------------------
// Defaults and clamps
// ---------------------------------------------------------------------------

const DEFAULT_SEASON = 2026;
const DEFAULT_EVENT_TYPE = 0; // TBA event_type 0 = Regional, RP-eligible.
/** Peak realistic tick roster size. */
const DEFAULT_TEAM_COUNT = 21;
const DEFAULT_FOLDED = 2;
const DEFAULT_UPCOMING = 60;
/** `folded + upcoming` ceiling, so a query string cannot price unboundedly many synthetic matches. */
const MAX_FOLDED_PLUS_UPCOMING = 200;
/** The opr selection spends one key on its event row, so the team side of any selection this probe builds must leave room for it. */
const MAX_TEAM_COUNT = MAX_SCOPE_KEYS_PER_READ - 1;
/** The public artifact origin. A GET here reads exactly what a visitor's browser reads; no credential exists that could make it a write. */
const DEFAULT_ARTIFACT_ORIGIN = "https://data.sigmascout.org";

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, parseIntParam(raw, fallback)));
}

/** `undefined` when the param is absent or empty, so a caller can distinguish "not supplied" from a supplied `0`. */
function parseOptionalIntParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** `rp`, the ablation arm. Unrecognized values are ON with a warning, so a typo is never silently measured as the other arm; absent is ON. */
const RP_ON_VALUES = new Set(["1", "on", "true", "yes"]);
const RP_OFF_VALUES = new Set(["0", "off", "false", "no"]);

function parseRpParam(raw: string | null): { enabled: boolean; unrecognized: string | undefined } {
  if (raw === null || raw.trim() === "") return { enabled: true, unrecognized: undefined };
  const v = raw.trim().toLowerCase();
  if (RP_OFF_VALUES.has(v)) return { enabled: false, unrecognized: undefined };
  if (RP_ON_VALUES.has(v)) return { enabled: true, unrecognized: undefined };
  return { enabled: true, unrecognized: raw.trim() };
}

/**
 * `phaseB`, the Phase B emulation arm. OFF by default (absent or empty), so
 * every RP arm's response is unchanged by this param's existence. An
 * UNRECOGNIZED value runs ON and warns, matching `rp`'s rule that a typo is
 * never silently measured as the cheaper arm.
 */
function parsePhaseBParam(raw: string | null): { enabled: boolean; unrecognized: string | undefined } {
  if (raw === null || raw.trim() === "") return { enabled: false, unrecognized: undefined };
  const v = raw.trim().toLowerCase();
  if (RP_OFF_VALUES.has(v)) return { enabled: false, unrecognized: undefined };
  if (RP_ON_VALUES.has(v)) return { enabled: true, unrecognized: undefined };
  return { enabled: true, unrecognized: raw.trim() };
}

/**
 * `artifactOrigin`. The default is the public data origin; an override is
 * REJECTED (never silently replaced by the default) unless it parses and its
 * protocol is `https:`, so no query string can point the probe's one outbound
 * request at a plaintext or non-HTTP scheme.
 */
function parseArtifactOriginParam(raw: string | null): { origin: string | undefined; rejected: string | undefined } {
  if (raw === null || raw.trim() === "") return { origin: DEFAULT_ARTIFACT_ORIGIN, rejected: undefined };
  const candidate = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { origin: undefined, rejected: candidate };
  }
  if (parsed.protocol !== "https:") return { origin: undefined, rejected: candidate };
  return { origin: parsed.origin, rejected: undefined };
}

// ---------------------------------------------------------------------------
// `rpSkip`: five independently switchable RP components, layered on top of
// `rp`, plus one RETIRED name that no longer describes any work this tick
// does. See `runSprFold`'s doc comment for exactly which tick operations each
// live name gates.
// ---------------------------------------------------------------------------

/** Canonical order: `resume` is the dependency root — every other name is one of its dependents. */
const RP_ARM_COMPONENT_NAMES = ["resume", "foldedPmf", "formula", "observe", "beliefs"] as const;
type RpArmComponentName = (typeof RP_ARM_COMPONENT_NAMES)[number];

/**
 * Component names that USED to gate real work and no longer do, kept
 * recognized so an operator (or a stale runbook) naming one gets told why it
 * is inert rather than having it silently mistaken for a typo — which would
 * take the "NO component was skipped" path and quietly discard the OTHER,
 * valid names in the same list.
 */
const RP_ARM_RETIRED_COMPONENT_NAMES = ["upcomingPmf"] as const;
type RpArmRetiredComponentName = (typeof RP_ARM_RETIRED_COMPONENT_NAMES)[number];

/** Why each retired name reports NOT APPLICABLE, quoted verbatim into the warning. */
const RP_ARM_RETIRED_REASONS: Record<RpArmRetiredComponentName, string> = {
  upcomingPmf:
    "the tick no longer prices upcoming matches at all — the browser-pricing work (260915-isq) deleted the upcoming RP pricing loop from processEvent's Phase A, and the browser prices those matches from the event artifact's state block instead",
};

interface RpArmRan {
  readonly resume: boolean;
  readonly foldedPmf: boolean;
  readonly formula: boolean;
  readonly observe: boolean;
  readonly beliefs: boolean;
}

interface RpArmResolution {
  readonly id: string;
  readonly ran: RpArmRan;
  readonly warnings: readonly string[];
}

const RP_ARM_ALL: RpArmRan = { resume: true, foldedPmf: true, formula: true, observe: true, beliefs: true };
const RP_ARM_NONE: RpArmRan = { resume: false, foldedPmf: false, formula: false, observe: false, beliefs: false };

/** Splits `raw` on commas, trims, drops empties, and matches case-insensitively against the five live names and the retired ones. A retired name is RECOGNIZED (never `unknown`); a name in neither set is reported, never guessed at. */
function parseRpSkipTokens(raw: string | null): { skipped: Set<RpArmComponentName>; retired: RpArmRetiredComponentName[]; unknown: string[] } {
  if (raw === null || raw.trim() === "") return { skipped: new Set(), retired: [], unknown: [] };
  const byLower = new Map<string, RpArmComponentName>(RP_ARM_COMPONENT_NAMES.map((name) => [name.toLowerCase(), name]));
  const retiredByLower = new Map<string, RpArmRetiredComponentName>(RP_ARM_RETIRED_COMPONENT_NAMES.map((name) => [name.toLowerCase(), name]));
  const skipped = new Set<RpArmComponentName>();
  const retired: RpArmRetiredComponentName[] = [];
  const unknown: string[] = [];
  for (const token of raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)) {
    const canonical = byLower.get(token.toLowerCase());
    if (canonical !== undefined) {
      skipped.add(canonical);
      continue;
    }
    const retiredName = retiredByLower.get(token.toLowerCase());
    if (retiredName !== undefined) {
      if (!retired.includes(retiredName)) retired.push(retiredName);
      continue;
    }
    unknown.push(token);
  }
  return { skipped, retired, unknown };
}

/** One warning per retired name: it is recognized, it changes nothing, and here is why it no longer describes any work. */
function retiredComponentWarnings(rpSkipRawTrimmed: string, retired: readonly RpArmRetiredComponentName[]): string[] {
  return retired.map(
    (name) =>
      `rpSkip="${rpSkipRawTrimmed}" names "${name}", which is NOT APPLICABLE at this tick shape: ${RP_ARM_RETIRED_REASONS[name]}. It was recognized and changed nothing; every other name in the list applied normally`
  );
}

/** `ran` from a validated skip set. Without `resume`, every other component is off — there is nothing left for them to feed. */
function deriveRpArmRan(skipped: ReadonlySet<RpArmComponentName>): RpArmRan {
  if (skipped.has("resume")) return RP_ARM_NONE;
  const foldedPmf = !skipped.has("foldedPmf");
  return {
    resume: true,
    foldedPmf,
    // Moot once the only pmf loop does not call rpFieldsFor at all — nothing for `formula` to gate.
    formula: foldedPmf && !skipped.has("formula"),
    observe: !skipped.has("observe"),
    beliefs: !skipped.has("beliefs"),
  };
}

/** The arm id: "all", "none", or "skip:a,b,c" in canonical order. A RETIRED name never appears — an id must describe what actually ran. `formula` is dropped from the listing once the pmf loop is already skipped, since requesting it changes nothing further. */
function buildRpArmId(skipped: ReadonlySet<RpArmComponentName>, ran: RpArmRan): string {
  if (!ran.resume) return "none";
  const displayed = displayedSkippedNames(skipped);
  return displayed.length === 0 ? "all" : `skip:${displayed.join(",")}`;
}

/** The skipped names an id or warning lists: canonical order, minus a `formula` that the pmf skip already made moot. */
function displayedSkippedNames(skipped: ReadonlySet<RpArmComponentName>): RpArmComponentName[] {
  const pmfSkipped = skipped.has("foldedPmf");
  return RP_ARM_COMPONENT_NAMES.filter((name) => skipped.has(name) && !(name === "formula" && pmfSkipped));
}

/**
 * Pure resolver for both ablation params: `rp` (whole-path on/off, existing)
 * layered under `rpSkip` (five independently switchable components, plus the
 * retired names). `rp=0` always wins — every component is off regardless of
 * `rpSkip`, and the existing `rp=0` warning (built by `buildWarnings`) is
 * untouched; this function only adds a second warning when `rpSkip` was also
 * supplied, so the caller knows it had no effect.
 *
 * A retired name contributes its own warning and NOTHING else: it does not
 * change the arm id, the `ran` set or any counter, and it never suppresses the
 * other names in the same list.
 */
export function resolveRpArm(rpRaw: string | null, rpSkipRaw: string | null): RpArmResolution {
  const rp = parseRpParam(rpRaw);
  const rpSkipRawTrimmed = rpSkipRaw?.trim() ?? "";
  const rpSkipSupplied = rpSkipRawTrimmed !== "";

  if (!rp.enabled) {
    return {
      id: "none",
      ran: RP_ARM_NONE,
      warnings: rpSkipSupplied
        ? [`rpSkip="${rpSkipRawTrimmed}" was ignored because rp=0 already turns every RP component off`]
        : [],
    };
  }

  const { skipped, retired, unknown } = parseRpSkipTokens(rpSkipRaw);
  const retiredWarnings = retiredComponentWarnings(rpSkipRawTrimmed, retired);

  if (unknown.length > 0) {
    return {
      id: "all",
      ran: RP_ARM_ALL,
      warnings: [
        `rpSkip="${rpSkipRawTrimmed}" names unrecognized component(s) ${unknown.map((t) => `"${t}"`).join(", ")} — valid names are ${RP_ARM_COMPONENT_NAMES.join(", ")} — NO component was skipped`,
        ...retiredWarnings,
      ],
    };
  }

  const ran = deriveRpArmRan(skipped);
  const id = buildRpArmId(skipped, ran);

  if (id === "all") return { id, ran, warnings: retiredWarnings };

  if (id === "none") {
    return {
      id,
      ran,
      warnings: [
        `rpSkip="${rpSkipRawTrimmed}" — ABLATED ARM "${id}": resume was skipped, so every dependent component (foldedPmf, formula, observe, beliefs) was forced off. Compare this cpuTime against an otherwise-identical rp=1 run`,
        ...retiredWarnings,
      ],
    };
  }

  const skippedNames = displayedSkippedNames(skipped);
  const ranNames = RP_ARM_COMPONENT_NAMES.filter((name) => ran[name]);
  return {
    id,
    ran,
    warnings: [
      `rpSkip="${rpSkipRawTrimmed}" — PARTIALLY ABLATED ARM "${id}": skipped ${skippedNames.join(",")}; ran ${ranNames.join(",")}. Compare this cpuTime against an otherwise-identical rp=1 run`,
      ...retiredWarnings,
    ],
  };
}

function parseTeamsParam(raw: string | null): readonly string[] | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return keys.length > 0 ? keys : undefined;
}

/**
 * `algorithms=spr` narrows the read+deserialize loop to the live tier, which is
 * what a real tick loads (`DEFAULT_LIVE_ALGORITHM_IDS`). Absent or empty reads
 * every published algorithm, as before. Unknown ids are ignored and warned;
 * `spr` is always kept, because the fold cannot run without it.
 */
function parseAlgorithmsParam(raw: string | null): { ids: readonly string[]; warnings: readonly string[] } {
  if (raw === null || raw.trim() === "") return { ids: PUBLISHED_ALGORITHM_IDS, warnings: [] };
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const known = new Set<string>(PUBLISHED_ALGORITHM_IDS);
  const warnings: string[] = [];
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) warnings.push(`algorithms= named unknown id(s) ${JSON.stringify(unknown)}; ignored (accepted: ${PUBLISHED_ALGORITHM_IDS.join(", ")})`);
  const kept = new Set(requested.filter((id) => known.has(id)));
  if (!kept.has("spr")) {
    kept.add("spr");
    warnings.push(`algorithms= omitted spr; spr was added back because the fold needs it`);
  }
  return { ids: PUBLISHED_ALGORITHM_IDS.filter((id) => kept.has(id)), warnings };
}

interface ProbeParams {
  readonly season: number;
  readonly eventType: number;
  readonly eventOverride: string | undefined;
  readonly teamsOverride: readonly string[] | undefined;
  readonly teamCount: number;
  readonly folded: number;
  /**
   * The number of synthetic STILL-UPCOMING matches in the event's schedule.
   * Since 260915-isq the tick prices none of them, so this costs Phase A
   * nothing; it sizes Phase B's schedule-only row rebuild and decides whether
   * the `state` block is kept (a block is dropped once no upcoming match is
   * left). Same query string as before the browser-pricing work, measuring a
   * different tick.
   */
  readonly upcoming: number;
  /** The raw `rp=` on/off flag, kept separate from `rpArm` for the existing `rp=0` warning, which must fire only for THIS flag, never for an `rpSkip=resume` arm that reaches the same "none" id by a different route. */
  readonly rpEnabled: boolean;
  /** An `rp=` value that was neither on nor off, surfaced as a warning. */
  readonly rpUnrecognized: string | undefined;
  /** The resolved ablation arm: `rp` layered under `rpSkip`'s five components (see `resolveRpArm`). */
  readonly rpArm: RpArmResolution;
  /** The algorithms read and deserialized (see `parseAlgorithmsParam`). */
  readonly algorithms: { readonly ids: readonly string[]; readonly warnings: readonly string[] };
  readonly phaseBEnabled: boolean;
  readonly phaseBUnrecognized: string | undefined;
  /** `undefined` = not supplied; the default (the real touched-team count) is only knowable after the fold. */
  readonly phaseBTeamsRaw: number | undefined;
  readonly phaseBEventOverride: string | undefined;
  /** `undefined` when an `artifactOrigin=` override was REJECTED — never silently replaced by the default. */
  readonly artifactOrigin: string | undefined;
  readonly artifactOriginRejected: string | undefined;
}

function parseParams(url: URL): ProbeParams {
  const search = url.searchParams;
  const season = clampInt(search.get("season"), DEFAULT_SEASON, 1992, 2100);
  const eventType = parseIntParam(search.get("eventType"), DEFAULT_EVENT_TYPE);
  const eventOverride = search.get("event")?.trim() || undefined;
  const teamsOverride = parseTeamsParam(search.get("teams"));
  const teamCount = clampInt(search.get("teamCount"), DEFAULT_TEAM_COUNT, 0, MAX_TEAM_COUNT);
  let folded = clampInt(search.get("folded"), DEFAULT_FOLDED, 0, MAX_FOLDED_PLUS_UPCOMING);
  let upcoming = clampInt(search.get("upcoming"), DEFAULT_UPCOMING, 0, MAX_FOLDED_PLUS_UPCOMING);
  if (folded + upcoming > MAX_FOLDED_PLUS_UPCOMING) {
    upcoming = Math.max(0, MAX_FOLDED_PLUS_UPCOMING - folded);
  }
  const rpRaw = search.get("rp");
  const rp = parseRpParam(rpRaw);
  const rpArm = resolveRpArm(rpRaw, search.get("rpSkip"));
  const algorithms = parseAlgorithmsParam(search.get("algorithms"));
  const phaseB = parsePhaseBParam(search.get("phaseB"));
  const phaseBTeamsRaw = parseOptionalIntParam(search.get("phaseBTeams"));
  const phaseBEventOverride = search.get("phaseBEvent")?.trim() || undefined;
  const origin = parseArtifactOriginParam(search.get("artifactOrigin"));
  return {
    season,
    eventType,
    eventOverride,
    teamsOverride,
    teamCount,
    folded,
    upcoming,
    rpEnabled: rp.enabled,
    rpUnrecognized: rp.unrecognized,
    rpArm,
    algorithms,
    phaseBEnabled: phaseB.enabled,
    phaseBUnrecognized: phaseB.unrecognized,
    phaseBTeamsRaw,
    phaseBEventOverride,
    artifactOrigin: origin.origin,
    artifactOriginRejected: origin.rejected,
  };
}

// Discovery reads scope keys only, never state_json. It is overhead a real
// tick never pays, so it is counted separately in `discovery`.

interface DiscoveryRow {
  readonly scope_kind: string;
  readonly scope_key: string;
}

async function discoverRoster(db: D1Database, limit: number): Promise<readonly string[]> {
  if (limit <= 0) return [];
  const { results } = await db
    .prepare(`SELECT scope_kind, scope_key FROM algorithm_state WHERE algorithm_id = 'spr' AND scope_kind = 'team' ORDER BY scope_key LIMIT ?`)
    .bind(limit)
    .all<DiscoveryRow>();
  return results.map((r) => r.scope_key);
}

async function discoverEventKey(db: D1Database): Promise<string | undefined> {
  const row = await db
    .prepare(`SELECT scope_kind, scope_key FROM algorithm_state WHERE algorithm_id = 'opr' AND scope_kind = 'event' ORDER BY scope_key LIMIT 1`)
    .first<DiscoveryRow>();
  return row?.scope_key;
}

// probeSelectionsFor duplicates `scheduled.ts`'s `selectionsFor` (see the
// header); `stateProbe.test.ts` asserts deep-equal output.

/** Mirrors `scheduled.ts`'s `EVENT_SCOPED_ALGORITHM_IDS`. */
const PROBE_EVENT_SCOPED_ALGORITHM_IDS = new Set(["opr"]);

export function probeSelectionsFor(algorithmId: string, eventKey: string, touchedTeams: readonly string[]): ScopeSelection[] {
  const selections: ScopeSelection[] = [];
  if (PROBE_EVENT_SCOPED_ALGORITHM_IDS.has(algorithmId)) {
    selections.push({ scopeKind: "event", scopeKeys: [eventKey] });
  }
  selections.push({ scopeKind: "team", scopeKeys: touchedTeams });
  return selections;
}

// ---------------------------------------------------------------------------
// The one outbound request this Worker may make.
// ---------------------------------------------------------------------------

/** A phaseB step that failed, carried to the response as `phaseB.error` with every counter left at 0. */
class ProbePhaseBError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * THE ONLY outbound-request call site in this file. Asserts `https:` before
 * issuing a `GET` with no request body, so the artifact origin is read with a
 * method that cannot mutate it. The response BODY never reaches the probe's
 * own response — only its byte length does.
 *
 * Fetching is I/O, which Cloudflare does not bill as CPU, so these bytes cost
 * `cpuTime` nothing; the parses that follow are what Phase B actually pays.
 */
async function fetchArtifactText(origin: string, key: string): Promise<string> {
  const url = new URL(key, origin.endsWith("/") ? origin : `${origin}/`);
  if (url.protocol !== "https:") {
    throw new ProbePhaseBError("ArtifactOriginNotHttps", `refusing to request ${url.protocol}//… — the probe reads the artifact origin over https only`);
  }
  const response = await globalThis.fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new ProbePhaseBError("ArtifactFetchFailed", `GET ${key} returned ${response.status}`);
  }
  return await response.text();
}

// ---------------------------------------------------------------------------
// Synthetic match fixtures, 2026-shaped. Another `season` folds no observed
// thresholds and must warn (see `buildResponse`).
// ---------------------------------------------------------------------------

const SYNTHETIC_RED_SCORE = 120;
const SYNTHETIC_BLUE_SCORE = 95;
const SYNTHETIC_RED_HUB = 140;
const SYNTHETIC_RED_TOWER = 50;
const SYNTHETIC_BLUE_HUB = 110;
const SYNTHETIC_BLUE_TOWER = 38;

/** The 2026 score-breakdown shape `rp2026.parse` reads (same shape as `scheduled.rp.test.ts`'s `breakdownOf`). */
function synthesizeBreakdown(): unknown {
  const side = (hub: number, tower: number) => ({
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  });
  return { red: side(SYNTHETIC_RED_HUB, SYNTHETIC_RED_TOWER), blue: side(SYNTHETIC_BLUE_HUB, SYNTHETIC_BLUE_TOWER) };
}

/**
 * Rosters cycled 6 at a time from `teamKeys`, so every team carries beliefs.
 * Wraps when fewer than 6 (already warned); a team on both alliances is still
 * a valid, if unrealistic, input.
 */
function rosterAt(teamKeys: readonly string[], index: number): { red: string[]; blue: string[] } {
  const n = teamKeys.length;
  if (n === 0) return { red: [], blue: [] };
  const start = (index * 6) % n;
  const picks: string[] = [];
  for (let i = 0; i < 6; i++) picks.push(teamKeys[(start + i) % n]!);
  return { red: picks.slice(0, 3), blue: picks.slice(3, 6) };
}

function buildPlayedMatch(eventKey: string, eventType: number, matchNumber: number, red: readonly string[], blue: readonly string[]): MatchResult {
  return {
    matchKey: `${eventKey}_probe_qm${matchNumber}`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: red,
    blueTeams: blue,
    // Stated explicitly, not omitted — an omitted DQ list reads as harmless
    // and is not.
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType,
    week: null,
    winner: SYNTHETIC_RED_SCORE > SYNTHETIC_BLUE_SCORE ? "red" : "blue",
    redScore: SYNTHETIC_RED_SCORE,
    blueScore: SYNTHETIC_BLUE_SCORE,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify(synthesizeBreakdown()),
  };
}

/**
 * One synthetic STILL-UPCOMING match, in the schedule-only shape the tick
 * hands `mergeEventArtifact` since 260915-isq. Nothing prices it: it exists so
 * Phase B rebuilds a realistically long `upcoming` array and keeps the `state`
 * block alive.
 */
function buildScheduledMatch(eventKey: string, matchNumber: number, red: readonly string[], blue: readonly string[]): ScheduledMatchFacts {
  return {
    matchKey: `${eventKey}_probe_qm${matchNumber}`,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: [...red],
    blueTeams: [...blue],
  };
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface AlgorithmProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly leagueRowPresent: boolean;
  readonly rowsRead: { readonly league: number; readonly team: number; readonly event: number };
  readonly snapshotShapeVersionObserved?: unknown;
  readonly algorithmVersion?: string;
  readonly generation?: string;
  readonly computedAt?: string;
  readonly error?: { readonly name: string; readonly message: string };
}

interface FoldResult {
  readonly algorithmId: "spr";
  readonly matchesFolded: number;
  /** Synthetic still-upcoming matches in the schedule. NOT a count of matches priced: since 260915-isq the tick prices none, and neither does this probe. */
  readonly upcomingScheduled: number;
  /** Two per folded match (one per alliance). Folded-only, because the upcoming loop is gone. */
  readonly bandsProduced: number;
  readonly rpPmfsProduced: number;
  readonly rpObservedFolds: number;
  /** Matches whose per-side `bonusFlags` Phase A captured BEFORE `rp.fold`, mirroring the tick's `observedBonusSides`. 0 whenever the RP path is ablated. */
  readonly rpBonusSidesCaptured: number;
  /** Residuals the mean shift booked in the played loop, summed over every variable. */
  readonly rpMeanShiftObservations: number;
  /** Alliances whose moments the mean shift actually moved. 0 before the warmup or with a cold roster. */
  readonly rpMeanShiftedAlliances: number;
  /** The `resume` component: the resumed belief map's size, or 0 when `resume` did not run. */
  readonly rpBeliefTeamsResumed: number;
  /** Incremented inside `rpFieldsFor` once every gate has passed, before `momentsFor` — independent of `formula`. */
  readonly rpGatesOpened: number;
  /** The `beliefs` component: the size of the map passed to `withRpBeliefs`, or 0 when `beliefs` did not run. */
  readonly rpBeliefTeamsAttached: number;
  /** The `beliefs` component: whether `withRpMeanShift` ran. */
  readonly rpMeanShiftAttached: boolean;
  readonly changedRowsDiscarded: number;
  readonly error?: { readonly name: string; readonly message: string };
}

/** Every `FoldResult` counter at rest, spread into the three early-return paths so no field can be forgotten on one of them. */
const FOLD_ZEROS = {
  algorithmId: "spr",
  matchesFolded: 0,
  upcomingScheduled: 0,
  bandsProduced: 0,
  rpPmfsProduced: 0,
  rpObservedFolds: 0,
  rpBonusSidesCaptured: 0,
  rpMeanShiftObservations: 0,
  rpMeanShiftedAlliances: 0,
  rpBeliefTeamsResumed: 0,
  rpGatesOpened: 0,
  rpBeliefTeamsAttached: 0,
  rpMeanShiftAttached: false,
  changedRowsDiscarded: 0,
} as const;

/**
 * What the Phase A mirror hands the Phase B emulation — the same values
 * `processEvent` puts into its `PerAlgorithmFold` and passes to
 * `runPhaseBAndReport`.
 */
interface PhaseAOutput {
  readonly foldedMatches: readonly MatchResult[];
  readonly scheduledMatches: readonly ScheduledMatchFacts[];
  readonly newPredictions: ReadonlyMap<string, Prediction>;
  readonly newBands: ReadonlyMap<string, MatchBand>;
  readonly touchedTeams: readonly string[];
  readonly realTouchedTeams: readonly string[];
  readonly touchedMetrics: Record<string, Record<string, TeamMetric>>;
  readonly touchedSigma: ReadonlyMap<string, number>;
  readonly observedBonusSides: ReadonlyMap<string, ParsedBonusSides>;
  /** The rows `selectChangedRows` produced — retained as a VALUE, not just a count, because Phase B splices them into the event's `state` block. */
  readonly changedRows: readonly StateRow[];
  readonly matchIndexByKey: ReadonlyMap<string, number>;
}

interface PhaseBResult {
  /** False whenever `phaseB` was off, and false on any failure before the first merge. Every counter below is 0 when this is false. */
  readonly ran: boolean;
  /** Bytes of the fetched event artifact. Fetch is I/O, so these bytes cost `cpuTime` nothing; the parse that follows does. */
  readonly eventArtifactBytes: number;
  readonly teamArtifactBytes: number;
  /** Whether the PUBLISHED event artifact already carried a `state` block. Out of season it will not: blocks attach only to events with a schedule current within 7 days. */
  readonly eventStateBlockPresent: boolean;
  /** Whether the probe had to synthesize a block before merging. A synthesized block is sized by `teamCount`, so the merge below is a FLOOR for a 42-team regional, never a ceiling. */
  readonly stateBlockSynthesized: boolean;
  readonly playedRowFactsBuilt: number;
  /** `JSON.stringify(mergedEvent).length` — the real serialization cost a tick pays before the R2 put. */
  readonly mergedEventBytes: number;
  /** The observable proof the splice ran: the merged object still carries a `state` block. */
  readonly mergedEventStateBlockPresent: boolean;
  readonly mergedEventStateRows: number;
  readonly mergedEventUpcomingRows: number;
  readonly mergedEventPlayedRows: number;
  /**
   * Schema parses of a team artifact. The probe parses ONE team's fetched
   * bytes N times: that prices N parses of a realistically-sized artifact, but
   * a real tick parses N DIFFERENT teams' artifacts of similar size. Do not
   * read this as N distinct teams.
   */
  readonly teamParsesRun: number;
  readonly teamMergesRun: number;
  /** Summed `JSON.stringify(mergedTeam).length` over every team merge. */
  readonly mergedTeamBytes: number;
  readonly error?: { readonly name: string; readonly message: string };
}

const PHASE_B_ZEROS = {
  ran: false,
  eventArtifactBytes: 0,
  teamArtifactBytes: 0,
  eventStateBlockPresent: false,
  stateBlockSynthesized: false,
  playedRowFactsBuilt: 0,
  mergedEventBytes: 0,
  mergedEventStateBlockPresent: false,
  mergedEventStateRows: 0,
  mergedEventUpcomingRows: 0,
  mergedEventPlayedRows: 0,
  teamParsesRun: 0,
  teamMergesRun: 0,
  mergedTeamBytes: 0,
} as const;

interface ProbeResponseBody {
  readonly ok: boolean;
  readonly shapeVersionExpected: number;
  readonly params: {
    readonly season: number;
    readonly eventType: number;
    readonly event: string;
    readonly teams: readonly string[];
    readonly teamCount: number;
    readonly folded: number;
    /** Synthetic still-upcoming matches; since 260915-isq this sizes Phase B, not a Phase A pricing loop. */
    readonly upcoming: number;
    /** The whole-path ablation arm, echoed so a `cpuTime` from `wrangler tail` is never attributed to the wrong arm. Always equal to `rpArm.ran.resume`. */
    readonly rp: boolean;
    /** The resolved component arm: `id` ("all" | "none" | "skip:a,b,c") plus which of the five components actually ran. Read this before trusting a `cpuTime` — a typo in `rpSkip` skips nothing. */
    readonly rpArm: { readonly id: string; readonly ran: RpArmRan };
    /** The algorithms read and deserialized. `algorithms=spr` matches the live tick. */
    readonly algorithms: readonly string[];
    /** Whether the Phase B emulation ran. Two arms can share an `rpArm.id` and differ only here. */
    readonly phaseB: boolean;
    readonly phaseBTeams: number;
    readonly phaseBEvent: string;
    /** `null` when an `artifactOrigin=` override was rejected — the default is never silently substituted. */
    readonly artifactOrigin: string | null;
  };
  readonly discovery: {
    readonly teamKeysFound: number;
    readonly eventKeyFound: string | undefined;
    readonly queries: number;
  };
  readonly algorithms: readonly AlgorithmProbeResult[];
  readonly fold: FoldResult;
  readonly phaseB: PhaseBResult;
  readonly warnings: readonly string[];
}

/** A literal, never a clock read. The serializers require a stamp; the probe's rows are discarded, so its value is inert. */
const PROBE_STAMP: StateStamp = { generation: "probe", computedAt: "1970-01-01T00:00:00.000Z" };
/** The same literal in the merge's own stamp shape, for the identical reason: the merged artifacts are stringified and thrown away. */
const PROBE_MERGE_STAMP: Stamp = { generation: "probe", computedAt: "1970-01-01T00:00:00.000Z" };

async function readAndDeserializeAll(
  db: D1Database,
  eventKey: string,
  teamKeys: readonly string[],
  algorithmIds: readonly string[]
): Promise<{ algorithms: AlgorithmProbeResult[]; sprRows: StateRow[] | undefined; sprState: SprState | undefined }> {
  const algorithms: AlgorithmProbeResult[] = [];
  let sprRows: StateRow[] | undefined;
  let sprState: SprState | undefined;

  for (const algorithmId of algorithmIds) {
    const rowsRead = { league: 0, team: 0, event: 0 };
    let leagueRowPresent = false;
    try {
      const selections = probeSelectionsFor(algorithmId, eventKey, teamKeys);
      const rows = await readScopedState(db, algorithmId, selections);
      for (const row of rows) rowsRead[row.scopeKind]++;
      const leagueRow = rows.find((row) => row.scopeKind === "league");
      leagueRowPresent = leagueRow !== undefined;

      if (leagueRow === undefined) {
        // NEVER cold-start via initState here: that would measure a fiction.
        algorithms.push({
          id: algorithmId,
          ok: false,
          leagueRowPresent,
          rowsRead,
          error: {
            name: "NoLeagueRow",
            message: `no scopeKind:"league" row present for algorithm "${algorithmId}" — this is not yet seeded, or the probe's discovered/overridden scope keys named no seeded row; deserializeState was NOT called`,
          },
        });
        continue;
      }

      let snapshotShapeVersionObserved: unknown;
      try {
        snapshotShapeVersionObserved = (JSON.parse(leagueRow.stateJson) as Record<string, unknown>).snapshotShapeVersion;
      } catch {
        // If this parse fails, deserializeState below fails identically and
        // surfaces the real error.
      }

      const state = deserializeState(algorithmId, rows);
      algorithms.push({
        id: algorithmId,
        ok: true,
        leagueRowPresent,
        rowsRead,
        snapshotShapeVersionObserved,
        algorithmVersion: leagueRow.algorithmVersion,
        generation: leagueRow.generation,
        computedAt: leagueRow.computedAt,
      });

      if (algorithmId === "spr") {
        sprRows = rows;
        sprState = state as SprState;
      }
    } catch (err) {
      algorithms.push({
        id: algorithmId,
        ok: false,
        leagueRowPresent,
        rowsRead,
        error: {
          name: err instanceof Error ? err.name : "UnknownError",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { algorithms, sprRows, sprState };
}

// ===========================================================================
// PHASE A MIRROR — everything from here to the `runSprPhaseB` declaration
// below is the probe's mirror of `processEvent`'s Phase A loop, and nothing
// else is. `stateProbe.test.ts` Group 7 slices exactly this region (between
// the `function runSprFold(` and `async function runSprPhaseB(` declarations)
// and pins its call names by EQUALITY in both directions, so a call the tick
// gains and a call the tick DROPS both fail. Keep the boundary sharp: put
// Phase B work below the marker, never here.
// ===========================================================================

/**
 * The fold, `spr` only (matching `wrangler.toml`'s `LIVE_ALGORITHM_IDS`), in
 * a live tick's order: resume Sigma/RP accumulators, derive the touched
 * roster, price `folded` played matches (predict, band, RP fields, update,
 * fold, capture the observed bonus flags, talent), build the still-upcoming
 * schedule rows WITHOUT pricing them, read the touched metrics/Sigma, then
 * serialize and select the changed rows.
 *
 * THE UPCOMING LOOP IS GONE, deliberately (260915-isq). `processEvent` no
 * longer prices a single upcoming match: the browser prices them from the
 * event artifact's `state` block. A probe that kept pricing them would be
 * measuring code that no longer exists, which is exactly the drift this
 * function was re-mirrored to repair. `upcoming=` now sizes Phase B's
 * schedule-only row rebuild instead, reported as `upcomingScheduled`.
 *
 * `ran` — the resolved `rpSkip` component set (see `resolveRpArm`) — gates the
 * ranking-point operations independently:
 *     1. `resume`: the accumulator resume (the `publishesRankingPoints` gate,
 *        `RP_RULE_MODULES[season]`, `readRpBeliefs`, `RpMomentsAccumulator.fromBeliefs`,
 *        `rpKnownTeams`, `readRpMeanShift`, `RpMeanShiftAccumulator.fromState`) —
 *        unlike `scheduled.ts`, which builds `readRpBeliefs`/`rpKnownTeams`
 *        unconditionally, both stay inside this gate here: removing RP removes
 *        the accumulator they exist to seed, so ablating the accumulator must
 *        ablate them too, or the arm difference bills RP for work it did not
 *        cause. Without `resume`, every other component is off (`resolveRpArm`'s
 *        dependency rule)
 *     2. `foldedPmf`: whether `rpFieldsFor` is called at all
 *     3. `formula`: inside `rpFieldsFor`, everything from `analyticRpPmf` onward
 *        (the gates, `momentsFor` x2, `rosterIsFullyWarm` x2 and the mean shift
 *        `apply` x2 still run either way; `rpGatesOpened` counts the gate pass,
 *        independent of `formula`)
 *     4. `observe`: `rpMeanShift.observeMatch`, then `foldObservedRp` — which
 *        also means the `observedBonusSides` capture, exactly as in the tick,
 *        where the capture lives inside `foldObservedRp`
 *     5. `beliefs`: `withRpBeliefs` and `withRpMeanShift`
 * Every arm keeps every `displayBandFor` call (`bandsProduced` must match
 * across arms, asserted by `stateProbe.test.ts`), predict/update, the Sigma
 * fold, the talent read, the touched metrics/Sigma read, the schedule-row
 * build and `serializeState` with the Sigma passengers.
 *
 * The other deliberate divergence from the tick, also long-standing:
 * `probeSelectionsFor` is a pinned copy of `selectionsFor` (see the file
 * header), because importing `scheduled.ts` would destroy the no-write
 * guarantee.
 */
function runSprFold(
  sprRows: StateRow[],
  sprState: SprState,
  eventKey: string,
  eventType: number,
  season: number,
  teamKeys: readonly string[],
  folded: number,
  upcoming: number,
  ran: RpArmRan
): { fold: FoldResult; phaseA: PhaseAOutput | undefined } {
  if (teamKeys.length === 0) {
    return {
      fold: {
        ...FOLD_ZEROS,
        // Phrased without a bracketed clause on purpose: Group 7 extracts call
        // names from this region with a regex, and `word (` inside a string
        // literal reads as a call name and pollutes the pinned snapshot.
        error: { name: "EmptyRoster", message: "no teams are available: discovery found none and no teams= override was supplied — cannot build synthetic matches" },
      },
      phaseA: undefined,
    };
  }

  try {
    // Resumed from the rows just read, as a real tick resumes.
    const sigma = usesSigmaScore("spr") ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(sprRows), readSigmaPopulation(sprRows)) : undefined;
    // One alliance's win-odds variance, mirroring scheduled.ts's accessor name; `rpFieldsFor` reads it, `displayBandFor` derives the published band from it.
    const winOddsVarianceFor = (roster: readonly string[]): number | undefined => (sigma === undefined ? undefined : sigma.bandVarianceFor(roster));
    // The published Match Band, through the same helper the offline SigmaScoutLayer uses. OPR/EPA publish none (sigma undefined).
    const displayBandFor = (
      view: { redTeams: readonly string[]; blueTeams: readonly string[] },
      redWinOddsVariance: number | undefined,
      blueWinOddsVariance: number | undefined
    ): MatchBand => {
      if (sigma === undefined) return {};
      const red = sigmaMatchBandVariance(view.redTeams.length, redWinOddsVariance);
      const blue = sigmaMatchBandVariance(view.blueTeams.length, blueWinOddsVariance);
      return { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) };
    };

    // Indexed lookup, never `rpRuleModuleForSeason` (which throws): an
    // unregistered season, or an algorithm that publishes no RP, yields no
    // accumulator and a warning. Gating here (component `resume`) disables
    // every other component, all of which guard on `rp`/`rpMeanShift`.
    const rpRuleModule = ran.resume && publishesRankingPoints("spr") ? RP_RULE_MODULES[season] : undefined;
    const rpBeliefs = ran.resume ? readRpBeliefs(sprRows) : undefined;
    const rp = rpRuleModule !== undefined && rpBeliefs !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
    // Mirrors `scheduled.ts`'s resume, gated with the accumulator so ablating `resume` ablates it too.
    const rpMeanShift = rp !== undefined && rpRuleModule !== undefined ? RpMeanShiftAccumulator.fromState(rpRuleModule, readRpMeanShift(sprRows)) : undefined;
    const rpKnownTeams = new Set(rpBeliefs?.keys() ?? []);
    // The `resume` component's own counter: independent of every downstream skip.
    const rpBeliefTeamsResumed = rpBeliefs?.size ?? 0;

    let bandsProduced = 0;
    let rpPmfsProduced = 0;
    let rpObservedFolds = 0;
    let rpMeanShiftedAlliances = 0;
    let rpGatesOpened = 0;
    const shiftObservationTotal = (): number =>
      rpMeanShift === undefined ? 0 : Object.values(rpMeanShift.toState().variables).reduce((total, v) => total + v.count, 0);
    const shiftObservationsAtResume = shiftObservationTotal();

    const rpFieldsFor = (
      view: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: MatchResult["compLevel"] },
      prediction: Prediction,
      redBandVariance: number | undefined,
      blueBandVariance: number | undefined
    ): Partial<Prediction> => {
      if (rp === undefined || rpRuleModule === undefined || rpMeanShift === undefined) return {};
      if (!isRpEligibleEventType(view.eventType)) return {};
      if (redBandVariance === undefined || blueBandVariance === undefined) return {};
      // The partial-roster gate, mirroring `scheduled.ts`: part of what the
      // probe measures, not overhead to strip.
      for (const teamKey of [...view.redTeams, ...view.blueTeams]) {
        if (!rpKnownTeams.has(teamKey)) return {};
      }
      // Every gate passed: counted here, before `momentsFor`, independent of `formula`.
      rpGatesOpened++;

      // The mean shift per alliance, fully-warm rosters only. `apply` returns
      // its input unchanged when it shifts nothing, which the counter reads.
      // Still runs when `formula` is ablated — only `analyticRpPmf` onward is skipped.
      const redMoments = rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance);
      const blueMoments = rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance);
      const red = rpMeanShift.apply(redMoments, rosterIsFullyWarm(rp, view.redTeams));
      const blue = rpMeanShift.apply(blueMoments, rosterIsFullyWarm(rp, view.blueTeams));
      if (red !== redMoments) rpMeanShiftedAlliances++;
      if (blue !== blueMoments) rpMeanShiftedAlliances++;

      if (!ran.formula) return {};

      const pmf = analyticRpPmf({
        red,
        blue,
        ruleModule: rpRuleModule,
        eventType: view.eventType,
        compLevel: view.compLevel,
        pRedWin: prediction.pRedWin,
      });

      const decomposition: Partial<Prediction> =
        pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
          ? {
              matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
              redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
              blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
              redBonusRpPmf: pmf.redBonusPmf,
              blueBonusRpPmf: pmf.blueBonusPmf,
            }
          : {};

      return {
        redRpPmf: pmf.redPmf,
        blueRpPmf: pmf.bluePmf,
        ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
        ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        ...decomposition,
      };
    };

    /**
     * The per-side `bonusFlags` `foldObservedRp` below already parsed, by
     * match key — the tick's own `observedBonusSides`, a pure pass-through to
     * Phase B's `playedRowFactsFor` so publishing the actual bonus flags costs
     * no second breakdown parse against the tick's CPU budget.
     */
    const observedBonusSides = new Map<string, ParsedBonusSides>();

    /** Mirrors `scheduled.ts`'s `foldObservedRp`, including its skip-on-parse-failure try/catch and its capture of each side's flags BEFORE the fold, so a throwing fold cannot lose them. */
    const foldObservedRp = (result: MatchResult): void => {
      if (rp === undefined || rpRuleModule === undefined) return;
      if (!isRpEligibleEventType(result.eventType)) return;
      if (!result.hasScoreBreakdown || result.scoreBreakdownRaw === null) return;
      let redBonusFlags: Readonly<Record<string, boolean>> | undefined;
      let blueBonusFlags: Readonly<Record<string, boolean>> | undefined;
      for (const side of ["red", "blue"] as const) {
        try {
          const parsed = rpRuleModule.parse(JSON.parse(result.scoreBreakdownRaw), side, result.eventType);
          if (side === "red") redBonusFlags = parsed.bonusFlags;
          else blueBonusFlags = parsed.bonusFlags;
          rp.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
          rpObservedFolds++;
        } catch {
          // A breakdown this season's module cannot parse contributes
          // nothing rather than failing the probe.
        }
      }
      observedBonusSides.set(result.matchKey, { red: redBonusFlags, blue: blueBonusFlags });
      for (const teamKey of [...result.redTeams, ...result.blueTeams]) rpKnownTeams.add(teamKey);
    };

    // Built up front, mirroring `scheduled.ts`'s own `touchedTeams` derivation
    // ahead of its Phase A loop: the sorted unique teams the folded synthetic
    // matches touch. `realTouchedTeams` strips demo keys, like the tick's copy.
    const foldedMatches: MatchResult[] = [];
    for (let i = 0; i < folded; i++) {
      const roster = rosterAt(teamKeys, i);
      foldedMatches.push(buildPlayedMatch(eventKey, eventType, i + 1, roster.red, roster.blue));
    }
    const touchedTeams = [...new Set(foldedMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
    const realTouchedTeams = touchedTeams.filter((teamKey) => !isDemoTeamKey(teamKey));

    // The still-upcoming schedule, built but NEVER priced — the tick's own
    // behaviour since 260915-isq. `rosterAt` keeps cycling so each row carries
    // a real roster, which is what Phase B's row rebuild walks.
    const scheduledMatches: ScheduledMatchFacts[] = [];
    for (let i = 0; i < upcoming; i++) {
      const roster = rosterAt(teamKeys, folded + i);
      scheduledMatches.push(buildScheduledMatch(eventKey, folded + i + 1, roster.red, roster.blue));
    }

    let state = sprState;
    let matchesFolded = 0;
    // Mirrors `scheduled.ts`'s `newBands`/`newPredictions`; Phase B reads both.
    const newBands = new Map<string, MatchBand>();
    const newPredictions = new Map<string, Prediction>();
    for (const result of foldedMatches) {
      const prediction = spr.predict(state, toLeakProofUpcoming(result));
      const redWinOddsVariance = winOddsVarianceFor(result.redTeams);
      const blueWinOddsVariance = winOddsVarianceFor(result.blueTeams);
      if (redWinOddsVariance !== undefined) bandsProduced++;
      if (blueWinOddsVariance !== undefined) bandsProduced++;
      newBands.set(result.matchKey, displayBandFor(result, redWinOddsVariance, blueWinOddsVariance));
      // Component `foldedPmf`: when off, `rpFieldsFor` is never called — only its own work disappears.
      const fields = ran.foldedPmf ? rpFieldsFor(result, prediction, redWinOddsVariance, blueWinOddsVariance) : {};
      newPredictions.set(result.matchKey, { ...prediction, ...fields });
      // One increment per match: `rpFieldsFor`'s gates are all-or-nothing
      // per match. `stateProbe.test.ts` pins this to `folded`.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;

      state = spr.update(state, result);
      sigma?.foldMatch(result, prediction);
      // Component `observe`: both the mean-shift residual booking and the
      // threshold fold below are skipped together, mirroring `scheduled.ts`'s
      // order (after the RP fields, before the threshold fold).
      if (ran.observe && rp !== undefined) rpMeanShift?.observeMatch(rp, result);
      if (ran.observe) foldObservedRp(result);
      // Talent after the fold, from the post-update state, as `scheduled.ts` orders it.
      if (sigma !== undefined) {
        const roster2 = [...result.redTeams, ...result.blueTeams];
        const metrics = spr.teamMetrics(state, roster2);
        for (const teamKey of roster2) {
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) sigma.observeTalent(teamKey, total);
        }
      }
      matchesFolded++;
    }

    // Read-only, zero subrequests, same instant as `scheduled.ts`'s copy.
    const touchedMetrics = spr.teamMetrics(state, touchedTeams);
    const touchedSigma = new Map<string, number>();
    if (sigma !== undefined) {
      for (const teamKey of realTouchedTeams) touchedSigma.set(teamKey, sigma.sigmaFor(teamKey));
    }

    // Serialize and discard: building the write payload is real tick CPU, but
    // the rows are never written.
    let candidateRows = serializeState("spr", spr.version, state, PROBE_STAMP);
    // Component `beliefs`: the write-back passengers only. `resume` (the read
    // side) is a separate component and stays gated above.
    let rpBeliefTeamsAttached = 0;
    if (ran.beliefs && rp !== undefined) {
      const beliefsByTeam = rp.beliefsByTeam();
      candidateRows = withRpBeliefs(candidateRows, beliefsByTeam);
      rpBeliefTeamsAttached = beliefsByTeam.size;
    }
    let rpMeanShiftAttached = false;
    if (ran.beliefs && rpMeanShift !== undefined) {
      candidateRows = withRpMeanShift(candidateRows, rpMeanShift.toState());
      rpMeanShiftAttached = true;
    }
    if (sigma !== undefined) {
      candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
    }
    // `selectChangedRows` is a pure comparison with no write helper in its
    // graph. The ROWS are retained, not just their count: Phase B splices them
    // into the event artifact's `state` block, exactly as the tick does.
    const changedRows = selectChangedRows(sprRows, candidateRows);

    const matchIndexByKey = new Map<string, number>();
    for (const m of foldedMatches) matchIndexByKey.set(m.matchKey, matchIndexByKey.size);
    for (const m of scheduledMatches) matchIndexByKey.set(m.matchKey, matchIndexByKey.size);

    const rpMeanShiftObservations = shiftObservationTotal() - shiftObservationsAtResume;
    return {
      fold: {
        algorithmId: "spr",
        matchesFolded,
        upcomingScheduled: scheduledMatches.length,
        bandsProduced,
        rpPmfsProduced,
        rpObservedFolds,
        rpBonusSidesCaptured: observedBonusSides.size,
        rpMeanShiftObservations,
        rpMeanShiftedAlliances,
        rpBeliefTeamsResumed,
        rpGatesOpened,
        rpBeliefTeamsAttached,
        rpMeanShiftAttached,
        changedRowsDiscarded: changedRows.length,
      },
      phaseA: {
        foldedMatches,
        scheduledMatches,
        newPredictions,
        newBands,
        touchedTeams,
        realTouchedTeams,
        touchedMetrics,
        touchedSigma,
        observedBonusSides,
        changedRows,
        matchIndexByKey,
      },
    };
  } catch (err) {
    return {
      fold: {
        ...FOLD_ZEROS,
        error: { name: err instanceof Error ? err.name : "UnknownError", message: err instanceof Error ? err.message : String(err) },
      },
      phaseA: undefined,
    };
  }
}

// ===========================================================================
// END OF THE PHASE A MIRROR. Everything below this marker is Phase B, which
// `processEvent` runs in `runPhaseBAndReport`, NOT in its Phase A loop — so
// Group 7's probe-side call-name snapshot must not see any of it. The
// `async function runSprPhaseB(` declaration on the next lines is the slice's
// end marker; do not rename it without updating that test.
// ===========================================================================

/**
 * The Phase B emulation, in the tick's own order and through the tick's OWN
 * functions (`artifactMerge.ts`, imported by both), never a copy:
 *
 *   fetch the published event artifact -> `LiveEventArtifactSchema.parse` ->
 *   `playedRowFactsFor` -> `mergeEventArtifact` (which splices the `state`
 *   block) -> `JSON.stringify` -> N x (`TeamSeasonArtifactSchema.parse` ->
 *   `mergeTeamSeasonArtifact` -> `JSON.stringify`) -> discard everything.
 *
 * TWO PLACES THIS IS A FLOOR, NOT A FAITHFUL PRICE, both reported:
 *   1. Out of season no published event carries a `state` block (blocks attach
 *      only to events with a schedule current within 7 days), so the probe
 *      synthesizes one from the rows it read. That block is sized by
 *      `teamCount`, so it under-prices a 42-team regional.
 *   2. The N team merges parse ONE team's fetched bytes N times. That prices N
 *      parses of a realistic artifact; a real tick parses N different teams'.
 *
 * Any failure throws, leaving every counter at 0 and the response 500, so the
 * driver's warm-up gate aborts rather than recording an arm that measured
 * nothing.
 */
async function runSprPhaseB(params: {
  readonly origin: string;
  readonly phaseBEventKey: string;
  readonly eventKey: string;
  readonly season: number;
  readonly eventType: number;
  readonly teamKeys: readonly string[];
  readonly sprRows: readonly StateRow[];
  readonly phaseA: PhaseAOutput;
  readonly phaseBTeams: number;
}): Promise<{ result: PhaseBResult; warnings: string[] }> {
  const { origin, phaseBEventKey, eventKey, season, eventType, teamKeys, sprRows, phaseA, phaseBTeams } = params;
  const warnings: string[] = [];

  const firstTeamKey = teamKeys[0];
  if (firstTeamKey === undefined) {
    throw new ProbePhaseBError("EmptyRoster", "phaseB needs at least one discovered team key to build a team-artifact key");
  }

  const eventText = await fetchArtifactText(origin, artifactKey({ page: "event", eventKey: phaseBEventKey, algorithmId: "spr", version: spr.version }));
  const teamText = await fetchArtifactText(origin, artifactKey({ page: "team", teamKey: firstTeamKey, year: season, algorithmId: "spr", version: spr.version }));

  let parsedEvent: LiveEventArtifact;
  try {
    parsedEvent = LiveEventArtifactSchema.parse(JSON.parse(eventText));
  } catch (err) {
    throw new ProbePhaseBError("EventArtifactParseFailed", err instanceof Error ? err.message : String(err));
  }

  const eventStateBlockPresent = parsedEvent.state !== undefined;
  let existingEvent: LiveEventArtifact = parsedEvent;
  let stateBlockSynthesized = false;
  if (!eventStateBlockPresent) {
    // Measuring the merge without a block would under-price the one term the
    // browser-pricing work actually GREW, so a block is synthesized instead.
    try {
      existingEvent = { ...parsedEvent, state: buildEventStateBlock(sprRows, teamKeys) };
    } catch (err) {
      throw new ProbePhaseBError("StateBlockSynthesisFailed", err instanceof Error ? err.message : String(err));
    }
    stateBlockSynthesized = true;
    warnings.push(
      `phaseB synthesized the event's state block: the published artifact for "${phaseBEventKey}" carried none (out of season no event does — blocks attach only to events with a schedule current within 7 days). A synthesized block is sized by teamCount (${teamKeys.length} rows), so the merge cost below is a FLOOR for a ~42-team regional, never a ceiling`
    );
  }

  const playedRowFacts = playedRowFactsFor(
    season,
    [],
    // The probe's folded matches carry no TBA video key; the narrowed
    // signature lets them be passed with no TBA fixture at all.
    phaseA.foldedMatches.map((m) => ({ matchKey: m.matchKey, videoKey: null })),
    phaseA.foldedMatches,
    phaseA.observedBonusSides
  );

  const mergedEvent = mergeEventArtifact({
    existing: existingEvent,
    eventKey,
    season,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    eventType,
    newlyFolded: phaseA.foldedMatches,
    newPredictions: phaseA.newPredictions,
    stillUpcoming: phaseA.scheduledMatches,
    touchedTeams: phaseA.touchedTeams,
    touchedMetrics: phaseA.touchedMetrics,
    newBands: phaseA.newBands,
    writtenRows: phaseA.changedRows,
    playedRowFacts,
    stamp: PROBE_MERGE_STAMP,
  }) as { state?: { rows?: readonly unknown[] }; upcoming?: readonly unknown[]; matches?: readonly unknown[] };

  const mergedEventBytes = JSON.stringify(mergedEvent).length;

  let parsedTeam: TeamSeasonArtifact;
  try {
    parsedTeam = TeamSeasonArtifactSchema.parse(JSON.parse(teamText));
  } catch (err) {
    throw new ProbePhaseBError("TeamArtifactParseFailed", err instanceof Error ? err.message : String(err));
  }

  let teamParsesRun = 1;
  let teamMergesRun = 0;
  let mergedTeamBytes = 0;
  for (let i = 0; i < phaseBTeams; i++) {
    const teamKey = teamKeys[i % teamKeys.length]!;
    // The SAME fetched bytes, re-parsed: see this function's header for why
    // that is a realistic parse cost but not N distinct teams.
    const existingTeam = i === 0 ? parsedTeam : TeamSeasonArtifactSchema.parse(JSON.parse(teamText));
    if (i > 0) teamParsesRun++;
    const teamMatches = phaseA.foldedMatches.filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey));
    const mergedTeam = mergeTeamSeasonArtifact({
      existing: existingTeam,
      teamKey,
      season,
      algorithmId: "spr",
      algorithmVersion: spr.version,
      eventKey,
      matches: teamMatches,
      predictions: phaseA.newPredictions,
      metrics: phaseA.touchedMetrics[teamKey] ?? {},
      matchIndexByKey: phaseA.matchIndexByKey,
      bands: phaseA.newBands,
      playedRowFacts,
      stamp: PROBE_MERGE_STAMP,
      sigmaAfterTick: phaseA.touchedSigma.get(teamKey),
    });
    mergedTeamBytes += JSON.stringify(mergedTeam).length;
    teamMergesRun++;
  }

  return {
    result: {
      ran: true,
      eventArtifactBytes: eventText.length,
      teamArtifactBytes: teamText.length,
      eventStateBlockPresent,
      stateBlockSynthesized,
      playedRowFactsBuilt: playedRowFacts.size,
      mergedEventBytes,
      mergedEventStateBlockPresent: mergedEvent.state !== undefined,
      mergedEventStateRows: mergedEvent.state?.rows?.length ?? 0,
      mergedEventUpcomingRows: mergedEvent.upcoming?.length ?? 0,
      mergedEventPlayedRows: mergedEvent.matches?.length ?? 0,
      teamParsesRun,
      teamMergesRun,
      mergedTeamBytes,
    },
    warnings,
  };
}

function buildWarnings(params: {
  season: number;
  folded: number;
  upcoming: number;
  eventOverrideSupplied: boolean;
  discoveredEventKey: string | undefined;
  resolvedEventKey: string;
  requestedTeamCount: number;
  resolvedTeamCount: number;
  fold: FoldResult;
  /** The raw `rp=` flag — NOT `rpArm.ran.resume` — so this fires only for the literal `rp=0` case, never for an `rpSkip=resume` arm, which carries its own warning from `resolveRpArm`. */
  rpEnabled: boolean;
  rpUnrecognized: string | undefined;
  /** The resolved arm id. The generic "every RP pmf was suppressed" warning below is scoped to "all": a partial or fully-ablated `rpSkip` arm already explains its own zero via `resolveRpArm`'s warning, and stacking both would break the "exactly one warning" contract Group 8 pins. */
  armId: string;
}): string[] {
  const warnings: string[] = [];
  const { season, folded, eventOverrideSupplied, discoveredEventKey, resolvedEventKey, requestedTeamCount, resolvedTeamCount, fold, rpEnabled, rpUnrecognized, armId } = params;

  if (rpUnrecognized !== undefined) {
    warnings.push(
      `rp="${rpUnrecognized}" is not a recognized value (on: 1/on/true/yes; off: 0/off/false/no) — the RP path ran ENABLED; re-run with rp=0 if the ablated arm was intended`
    );
  }
  if (!rpEnabled) {
    warnings.push(
      `rp=0 — ABLATED ARM: the ranking-point additions (the RpMomentsAccumulator resume, rpFieldsFor, foldObservedRp, and the withRpBeliefs passenger) and shape 16's mean shift (resume, apply, observeMatch, withRpMeanShift) were all skipped. Bands, the played predict loop and the Sigma fold still ran, because they are not part of the ranking-point path. Compare this cpuTime against an otherwise-identical rp=1 run; it is not a measurement of the tick as deployed`
    );
  }
  if (!eventOverrideSupplied && discoveredEventKey === undefined) {
    warnings.push(
      `no discovered opr event-scoped row found; falling back to event key "${resolvedEventKey}", which carries no accumulated OPR history for this event`
    );
  }
  if (RP_RULE_MODULES[season] === undefined) {
    warnings.push(`season ${season} has no registered RP rule module — RP folding is fully suppressed; rpPmfsProduced/rpObservedFolds of 0 here are not a measurement of the RP path`);
  } else if (season !== 2026) {
    warnings.push(`season ${season} !== 2026 — this probe's synthetic scoreBreakdownRaw is built in the 2026 shape rp2026.parse reads, so a different season's rule module will fold zero observed thresholds from it`);
  }
  if (resolvedTeamCount < requestedTeamCount) {
    warnings.push(`roster smaller than requested: found/used ${resolvedTeamCount} team(s) against a requested teamCount of ${requestedTeamCount} — the fold below prices a smaller roster than a real tick's peak`);
  }
  // In an ablated arm a 0 here is the requested outcome, already explained by
  // that arm's own warning — so this generic one is scoped to "all".
  // Scoped to `folded` alone now: upcoming matches are no longer priced, so a
  // run with folded=0 has no pmf to produce and nothing to report.
  if (armId === "all" && fold.error === undefined && folded > 0 && fold.rpPmfsProduced === 0) {
    warnings.push(`rpPmfsProduced is 0 — every RP pmf was suppressed (the partial-roster gate, an ineligible event type, or no registered rule module); the reported cpuTime is NOT evidence about the RP path`);
  }
  if (fold.error === undefined && folded > 0 && fold.bandsProduced === 0) {
    warnings.push(`bandsProduced is 0 — no Sigma band was produced for any roster; the band-dependent RP gate above never opened, so the reported cpuTime under-prices a real tick`);
  }

  return warnings;
}

async function runProbe(request: Request, env: ProbeEnv): Promise<{ responseBody: ProbeResponseBody; ok: boolean }> {
  const url = new URL(request.url);
  const params = parseParams(url);

  // Discovery always runs, even with overrides, so `discovery` reports what D1 holds.
  const discoveredTeamKeys = await discoverRoster(env.DB, params.teamCount);
  const discoveredEventKey = await discoverEventKey(env.DB);

  const eventKey = params.eventOverride ?? discoveredEventKey ?? `${params.season}probe`;
  const teamKeys = (params.teamsOverride ?? discoveredTeamKeys).slice(0, params.teamCount);

  const { algorithms, sprRows, sprState } = await readAndDeserializeAll(env.DB, eventKey, teamKeys, params.algorithms.ids);

  const folded =
    sprRows !== undefined && sprState !== undefined
      ? runSprFold(sprRows, sprState, eventKey, params.eventType, params.season, teamKeys, params.folded, params.upcoming, params.rpArm.ran)
      : {
          fold: {
            ...FOLD_ZEROS,
            error: { name: "SprNotDeserialized", message: "spr state was not available — see algorithms[] for the read/deserialize failure; the fold was skipped rather than measuring a fiction" },
          },
          phaseA: undefined,
        };
  const fold: FoldResult = folded.fold;

  // The default is the real touched-team count, which only the fold knows.
  const phaseBTeams = Math.min(MAX_TEAM_COUNT, Math.max(0, params.phaseBTeamsRaw ?? folded.phaseA?.realTouchedTeams.length ?? 0));
  const phaseBEventKey = params.phaseBEventOverride ?? eventKey;

  let phaseB: PhaseBResult = { ...PHASE_B_ZEROS };
  const phaseBWarnings: string[] = [];
  if (params.phaseBEnabled) {
    if (params.artifactOrigin === undefined) {
      phaseB = {
        ...PHASE_B_ZEROS,
        error: {
          name: "ArtifactOriginRejected",
          message: `artifactOrigin="${params.artifactOriginRejected}" was rejected (it must parse as an https: origin) — the probe did NOT fall back to ${DEFAULT_ARTIFACT_ORIGIN}, so nothing was fetched and phaseB measured nothing`,
        },
      };
    } else if (folded.phaseA === undefined || sprRows === undefined) {
      phaseB = {
        ...PHASE_B_ZEROS,
        error: { name: "PhaseANotAvailable", message: "phaseB was requested but Phase A produced no output — see fold.error; the merge was skipped rather than measuring a fiction" },
      };
    } else {
      try {
        const outcome = await runSprPhaseB({
          origin: params.artifactOrigin,
          phaseBEventKey,
          eventKey,
          season: params.season,
          eventType: params.eventType,
          teamKeys,
          sprRows,
          phaseA: folded.phaseA,
          phaseBTeams,
        });
        phaseB = outcome.result;
        phaseBWarnings.push(...outcome.warnings);
      } catch (err) {
        phaseB = {
          ...PHASE_B_ZEROS,
          error: { name: err instanceof Error ? err.name : "UnknownError", message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
  }

  const warnings = [
    ...buildWarnings({
      season: params.season,
      folded: params.folded,
      upcoming: params.upcoming,
      eventOverrideSupplied: params.eventOverride !== undefined,
      discoveredEventKey,
      resolvedEventKey: eventKey,
      requestedTeamCount: params.teamCount,
      resolvedTeamCount: teamKeys.length,
      fold,
      rpEnabled: params.rpEnabled,
      rpUnrecognized: params.rpUnrecognized,
      armId: params.rpArm.id,
    }),
    // rpSkip's own warnings (unknown token, partial/full ablation, a retired
    // component name, or the rp=0-override notice) — kept separate so the rp=0
    // warning above always sorts first when both fire.
    ...params.rpArm.warnings,
    ...params.algorithms.warnings,
    ...(params.phaseBUnrecognized !== undefined
      ? [`phaseB="${params.phaseBUnrecognized}" is not a recognized value (on: 1/on/true/yes; off: 0/off/false/no) — the Phase B emulation ran ENABLED; re-run with phaseB=0 if the cheaper arm was intended`]
      : []),
    ...(params.artifactOriginRejected !== undefined
      ? [`artifactOrigin="${params.artifactOriginRejected}" was REJECTED — an override must parse as an https: origin, and the probe never silently falls back to ${DEFAULT_ARTIFACT_ORIGIN}`]
      : []),
    ...phaseBWarnings,
  ];

  const ok = algorithms.every((a) => a.ok) && fold.error === undefined && phaseB.error === undefined;

  const responseBody: ProbeResponseBody = {
    ok,
    shapeVersionExpected: STATE_SNAPSHOT_SHAPE_VERSION,
    params: {
      season: params.season,
      eventType: params.eventType,
      event: eventKey,
      teams: teamKeys,
      teamCount: params.teamCount,
      folded: params.folded,
      upcoming: params.upcoming,
      rp: params.rpArm.ran.resume,
      rpArm: { id: params.rpArm.id, ran: params.rpArm.ran },
      algorithms: params.algorithms.ids,
      phaseB: params.phaseBEnabled,
      phaseBTeams,
      phaseBEvent: phaseBEventKey,
      artifactOrigin: params.artifactOrigin ?? null,
    },
    discovery: {
      teamKeysFound: discoveredTeamKeys.length,
      eventKeyFound: discoveredEventKey,
      queries: 2,
    },
    algorithms,
    fold,
    phaseB,
    warnings,
  };

  return { responseBody, ok };
}

/**
 * Requests this isolate has served, logged (never put in the body, so repeated
 * runs stay byte-identical). `isolateRequest=1` on a slow `cpuTime` means a
 * brand-new isolate; a higher count means a reused isolate that still ran cold.
 */
let isolateRequestsServed = 0;

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    isolateRequestsServed++;
    console.log(`isolateRequest=${isolateRequestsServed}`);
    const { responseBody, ok } = await runProbe(request, env);
    return new Response(JSON.stringify(responseBody), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler<ProbeEnv>;
