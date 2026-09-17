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
 * `?phaseBSkip=` splits THAT arm into seven independently switchable Phase B
 * components (see `resolvePhaseBArm`), and `?phaseBTeams=0` is the team half's
 * own ablation root; `?phaseBUpcoming=scheduled` reshapes the fetched
 * artifact's upcoming rows into the shape the live tick actually reads back.
 * Both default to the pre-existing behaviour, so every arm measured before
 * they existed stays comparable.
 *
 * `?chunk=teams` (added 2026-09-17) is a DIFFERENT KIND of arm from every one
 * above: not an ablation of this tick, but an emulation of what ONE HALF of a
 * SPLIT tick would cost as its own invocation. Phase B's team half is 7.6 ms
 * as an INCREMENT inside an already-warm invocation; a separate invocation
 * pays its own start-up, so that figure is a lower bound, not an answer. The
 * teams chunk reconstructs its merge inputs from the PUBLISHED event
 * artifact's own played rows and touches D1 ZERO times — the property
 * `stateProbe.test.ts` Group 11 asserts behaviourally. `chunk` is OFF by
 * default, and `chunk=event` is recognized but inert (see `resolveChunkArm`).
 * Runbook: `docs/worker-operations.md`, "Pre-event probe".
 *
 * SCOPE: Phase A (state read, fold, serialize, discard) plus, under
 * `phaseB=1`, an emulation of Phase B's merge/splice/stringify, plus, under
 * `chunk=teams`, a D1-free teams-only consumer emulation that replaces both.
 * Never the TBA poll, the KV manifest read, the global rebuild, a second
 * concurrent event or any R2 write.
 * Runbook: `docs/worker-operations.md`, "Pre-event probe".
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
import { artifactKey, type LiveEventArtifact, type TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";
// The tick's OWN read guards, imported for the same reason `artifactMerge.ts`
// is: the probe prices the path production runs, never a copy or a superseded
// version of it. That module imports only types and one constant, so it adds
// no write helper to the probe's import graph (Group 1 walks it).
import { checkLiveEventArtifactShape, checkTeamSeasonArtifactShape } from "./artifactShapeCheck.js";
import type { ParsedBonusSides } from "../../../packages/harness/publishedRows.js";
import { SigmaScoreAccumulator, usesSigmaScore, publishesRankingPoints, sigmaMatchBandVariance, SIGMA_METRIC_KEY } from "../../../packages/harness/sigmaScore.js";
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

// ---------------------------------------------------------------------------
// `phaseBSkip`: seven independently switchable Phase B components, layered on
// top of `phaseB`, following the SAME conventions `rpSkip` uses above
// (canonical order, dependency roots that force their dependents off, an
// unrecognized token that skips NOTHING and says so, a retired-name registry).
// See `runSprPhaseB`'s doc comment for exactly which tick operation each name
// gates.
//
// THE TEAM HALF'S ROOT IS `phaseBTeams=0`, NOT A COMPONENT NAME. There is no
// `teamParse` token and there never was: the team loop's `JSON.parse` is what
// the loop exists to run, so the only way to remove it is to run zero
// iterations. Do not go looking for a `teamParse` — `phaseBTeams=0` is it.
// ---------------------------------------------------------------------------

/** Canonical order. `eventParse` is the event half's dependency root; `eventMerge` and `teamMerge` are each a root for their own stringify. */
const PHASE_B_ARM_COMPONENT_NAMES = [
  "eventParse",
  "eventValidate",
  "eventMerge",
  "eventStringify",
  "teamValidate",
  "teamMerge",
  "teamStringify",
] as const;
type PhaseBArmComponentName = (typeof PHASE_B_ARM_COMPONENT_NAMES)[number];

/**
 * Phase B component names that USED to gate real work and no longer do.
 * EMPTY TODAY, and present on purpose: `rpSkip` learned the hard way that a
 * retired name falling through to the "unrecognized" path silently discards
 * every OTHER valid name in the same list. When a Phase B component is
 * retired, it goes here with its reason — it does not just disappear.
 */
const PHASE_B_ARM_RETIRED_COMPONENT_NAMES = [] as const;
type PhaseBArmRetiredComponentName = (typeof PHASE_B_ARM_RETIRED_COMPONENT_NAMES)[number];

/** Why each retired name reports NOT APPLICABLE, quoted verbatim into the warning. Empty while the registry is. */
const PHASE_B_ARM_RETIRED_REASONS: Record<PhaseBArmRetiredComponentName, string> = {};

interface PhaseBArmRan {
  readonly eventParse: boolean;
  readonly eventValidate: boolean;
  readonly eventMerge: boolean;
  readonly eventStringify: boolean;
  readonly teamValidate: boolean;
  readonly teamMerge: boolean;
  readonly teamStringify: boolean;
}

interface PhaseBArmResolution {
  readonly id: string;
  readonly ran: PhaseBArmRan;
  readonly warnings: readonly string[];
}

const PHASE_B_ARM_ALL: PhaseBArmRan = {
  eventParse: true,
  eventValidate: true,
  eventMerge: true,
  eventStringify: true,
  teamValidate: true,
  teamMerge: true,
  teamStringify: true,
};

/** Splits on commas, trims, drops empties, matches case-insensitively against the seven live names and the (currently empty) retired set. A name in neither set is REPORTED, never guessed at. */
function parsePhaseBSkipTokens(raw: string | null): {
  skipped: Set<PhaseBArmComponentName>;
  retired: PhaseBArmRetiredComponentName[];
  unknown: string[];
} {
  if (raw === null || raw.trim() === "") return { skipped: new Set(), retired: [], unknown: [] };
  const byLower = new Map<string, PhaseBArmComponentName>(PHASE_B_ARM_COMPONENT_NAMES.map((name) => [name.toLowerCase(), name]));
  const retiredByLower = new Map<string, PhaseBArmRetiredComponentName>(
    (PHASE_B_ARM_RETIRED_COMPONENT_NAMES as readonly PhaseBArmRetiredComponentName[]).map((name) => [String(name).toLowerCase(), name])
  );
  const skipped = new Set<PhaseBArmComponentName>();
  const retired: PhaseBArmRetiredComponentName[] = [];
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

/** One warning per retired name: recognized, changed nothing, and here is why. */
function retiredPhaseBComponentWarnings(phaseBSkipRawTrimmed: string, retired: readonly PhaseBArmRetiredComponentName[]): string[] {
  return retired.map(
    (name) =>
      `phaseBSkip="${phaseBSkipRawTrimmed}" names "${String(name)}", which is NOT APPLICABLE at this tick shape: ${PHASE_B_ARM_RETIRED_REASONS[name]}. It was recognized and changed nothing; every other name in the list applied normally`
  );
}

/**
 * `ran` from a validated skip set, with the three dependency rules:
 *   - `eventParse` is the event half's ROOT: without a parsed object there is
 *     nothing to validate, merge or stringify, so all three are forced off.
 *   - `eventMerge` forces `eventStringify` off: there is no merged object to
 *     serialize.
 *   - `teamMerge` forces `teamStringify` off, for the same reason.
 * `teamValidate` has no dependents — the team loop's own `JSON.parse` runs
 * either way (the team half's root is `phaseBTeams=0`).
 */
function derivePhaseBArmRan(skipped: ReadonlySet<PhaseBArmComponentName>): PhaseBArmRan {
  const eventParse = !skipped.has("eventParse");
  const eventMerge = eventParse && !skipped.has("eventMerge");
  const teamMerge = !skipped.has("teamMerge");
  return {
    eventParse,
    eventValidate: eventParse && !skipped.has("eventValidate"),
    eventMerge,
    eventStringify: eventMerge && !skipped.has("eventStringify"),
    teamValidate: !skipped.has("teamValidate"),
    teamMerge,
    teamStringify: teamMerge && !skipped.has("teamStringify"),
  };
}

/** The names an id lists: canonical order, minus any a skipped ROOT already made moot (naming them changes nothing further, so an id must not pretend they did). */
function displayedPhaseBSkippedNames(skipped: ReadonlySet<PhaseBArmComponentName>): PhaseBArmComponentName[] {
  const parseSkipped = skipped.has("eventParse");
  const eventMergeSkipped = parseSkipped || skipped.has("eventMerge");
  const teamMergeSkipped = skipped.has("teamMerge");
  return PHASE_B_ARM_COMPONENT_NAMES.filter((name) => {
    if (!skipped.has(name)) return false;
    if (parseSkipped && (name === "eventValidate" || name === "eventMerge" || name === "eventStringify")) return false;
    if (eventMergeSkipped && name === "eventStringify") return false;
    if (teamMergeSkipped && name === "teamStringify") return false;
    return true;
  });
}

/** The arm id: "all", or "skip:a,b,c" in canonical order. There is no "none": `phaseBSkip` cannot turn the team half off — only `phaseBTeams=0` can. */
function buildPhaseBArmId(skipped: ReadonlySet<PhaseBArmComponentName>): string {
  const displayed = displayedPhaseBSkippedNames(skipped);
  return displayed.length === 0 ? "all" : `skip:${displayed.join(",")}`;
}

/**
 * Pure resolver for `phaseBSkip`, layered under `phaseB` exactly as
 * `resolveRpArm` layers `rpSkip` under `rp`. `phaseB` off always wins: the
 * emulation does not run at all, so nothing was ablated and the id stays
 * "all"; a supplied `phaseBSkip` gets a warning saying it had no effect.
 *
 * A dependent forced off by a skipped ROOT is NAMED in the warning, never left
 * silently off — that is the whole difference between an arm a reader can
 * attribute a `cpuTime` to and one they cannot.
 */
export function resolvePhaseBArm(phaseBEnabled: boolean, phaseBSkipRaw: string | null): PhaseBArmResolution {
  const phaseBSkipRawTrimmed = phaseBSkipRaw?.trim() ?? "";
  const supplied = phaseBSkipRawTrimmed !== "";

  if (!phaseBEnabled) {
    return {
      id: "all",
      ran: PHASE_B_ARM_ALL,
      warnings: supplied
        ? [`phaseBSkip="${phaseBSkipRawTrimmed}" was ignored because phaseB is off — the Phase B emulation did not run at all, so there was nothing to ablate`]
        : [],
    };
  }

  const { skipped, retired, unknown } = parsePhaseBSkipTokens(phaseBSkipRaw);
  const retiredWarnings = retiredPhaseBComponentWarnings(phaseBSkipRawTrimmed, retired);

  if (unknown.length > 0) {
    return {
      id: "all",
      ran: PHASE_B_ARM_ALL,
      warnings: [
        `phaseBSkip="${phaseBSkipRawTrimmed}" names unrecognized component(s) ${unknown.map((t) => `"${t}"`).join(", ")} — valid names are ${PHASE_B_ARM_COMPONENT_NAMES.join(", ")} (the team half's root is phaseBTeams=0, not a component name) — NO component was skipped`,
        ...retiredWarnings,
      ],
    };
  }

  const ran = derivePhaseBArmRan(skipped);
  const id = buildPhaseBArmId(skipped);

  if (id === "all") return { id, ran, warnings: retiredWarnings };

  const skippedNames = displayedPhaseBSkippedNames(skipped);
  const forcedOff = PHASE_B_ARM_COMPONENT_NAMES.filter((name) => !ran[name] && !skipped.has(name));
  const ranNames = PHASE_B_ARM_COMPONENT_NAMES.filter((name) => ran[name]);
  return {
    id,
    ran,
    warnings: [
      `phaseBSkip="${phaseBSkipRawTrimmed}" — PARTIALLY ABLATED PHASE B ARM "${id}": skipped ${skippedNames.join(",")}${
        forcedOff.length > 0 ? `; FORCED OFF as dependents of a skipped root: ${forcedOff.join(",")}` : ""
      }; ran ${ranNames.length > 0 ? ranNames.join(",") : "(nothing)"}. Compare this cpuTime against an otherwise-identical phaseB=1 run`,
      ...retiredWarnings,
    ],
  };
}

// ---------------------------------------------------------------------------
// `phaseBUpcoming`: which SHAPE the fetched event artifact's `upcoming` rows
// are in before the measured region sees them.
// ---------------------------------------------------------------------------

/** The seven keys `EventScheduledMatchSchema` accepts, in `buildEventScheduledRow`'s own order. `sortTime` is omitted when the source row carries none, exactly as the tick omits it. */
const PHASE_B_SCHEDULED_ROW_KEYS = ["matchKey", "compLevel", "setNumber", "matchNumber", "sortTime", "redTeams", "blueTeams"] as const;

type PhaseBUpcomingShape = "published" | "scheduled";
const PHASE_B_UPCOMING_SHAPES = ["published", "scheduled"] as const;

/**
 * `phaseBUpcoming`. DEFAULTS to `published` — the shape the public artifact
 * actually carries today — so every arm measured before this param existed
 * stays comparable. An unrecognized value runs the PUBLISHED shape and warns,
 * rather than silently measuring the other shape.
 */
function parsePhaseBUpcomingParam(raw: string | null): { shape: PhaseBUpcomingShape; unrecognized: string | undefined } {
  if (raw === null || raw.trim() === "") return { shape: "published", unrecognized: undefined };
  const v = raw.trim().toLowerCase();
  if (v === "published") return { shape: "published", unrecognized: undefined };
  if (v === "scheduled") return { shape: "scheduled", unrecognized: undefined };
  return { shape: "published", unrecognized: raw.trim() };
}

/**
 * One `upcoming` row mapped down to the schedule-only shape the Worker itself
 * writes (`buildEventScheduledRow` in `artifactMerge.ts`). Every priced key is
 * DROPPED, which is the point: under `LiveEventArtifactSchema.upcoming`'s union
 * a schedule-only row fails `EventUpcomingMatchSchema` on four missing required
 * keys before `EventScheduledMatchSchema` accepts it, and that failure is what
 * the live tick pays on every upcoming row on every tick after the first.
 */
function toScheduleOnlyUpcomingRow(row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PHASE_B_SCHEDULED_ROW_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// `chunk`: which HALF of a SPLIT tick to emulate as its own invocation.
//
// EVERY OTHER ARM IN THIS FILE ABLATES THIS TICK. This one does not: it prices
// a tick that does not exist yet. `runPhaseBAndReport` writes the event
// artifact and then loops the touched teams doing read guard ->
// `mergeTeamSeasonArtifact` -> write, so a split puts the boundary exactly
// there — chunk one ends after the event write, chunk two is that loop. The
// consumer chunk reads the event artifact chunk one just wrote, which already
// carries this tick's newly played rows, and that is what makes a D1-FREE
// second chunk plausible at all.
//
// `teams` is the arm with a second code path. `event` deliberately is NOT:
// `phaseB=1&phaseBTeams=0` already runs Phase A plus the event half with zero
// team merges, which is the cron-side shape, so `chunk=event` is recognized,
// changes nothing, and says which arm to run instead.
//
// OFF BY DEFAULT, so every arm measured on 2026-09-15 and 2026-09-17 keeps its
// meaning and its pinned counters.
// ---------------------------------------------------------------------------

const CHUNK_ARM_IDS = ["off", "teams", "event"] as const;
type ChunkArmId = (typeof CHUNK_ARM_IDS)[number];
/** The values an operator may type. `off` is reached by ABSENCE, never by name, so it is not listed to a reader who mistyped. */
const CHUNK_REQUESTABLE_IDS = ["teams", "event"] as const;

/** Why `chunk=event` reports itself inert, quoted verbatim into its warning — the same treatment a RETIRED `rpSkip` name gets, for the same reason: a recognized name that changes nothing must SAY so rather than be mistaken for a typo. */
const CHUNK_EVENT_INERT_REASON =
  "the cron-side chunk is ALREADY measured by the existing no-team-artifacts arm — run phaseB=1&phaseBTeams=0 for it, the arm the measurement rig calls pbTeams0, which runs the full Phase A fold plus the event half of Phase B with zero team merges. Two differences from a real cron chunk, both immaterial to cpuTime: that arm also issues one team-artifact GET the real chunk would not, and fetch is I/O, billed as subrequests rather than CPU; and it does not pay the queue send a real chunk would";

interface ChunkArmResolution {
  readonly id: ChunkArmId;
  readonly warnings: readonly string[];
}

/**
 * Pure resolver for `chunk`, following the conventions `rp`, `phaseB` and
 * `phaseBUpcoming` already use: absent or empty is OFF; an UNRECOGNIZED value
 * changes NOTHING and warns (never silently measured as one of the real arms);
 * a recognized-but-inert value carries its own reason string.
 */
export function resolveChunkArm(raw: string | null): ChunkArmResolution {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { id: "off", warnings: [] };
  const v = trimmed.toLowerCase();
  if (v === "teams") return { id: "teams", warnings: [] };
  if (v === "event") {
    return {
      id: "event",
      warnings: [`chunk=event is RECOGNIZED and INERT: it adds no second code path and moved no counter. ${CHUNK_EVENT_INERT_REASON}`],
    };
  }
  return {
    id: "off",
    warnings: [
      `chunk="${trimmed}" is not a recognized value (valid values are ${CHUNK_REQUESTABLE_IDS.join(", ")}; absent is off) — NOTHING was skipped and the normal path ran unchanged; re-run with chunk=teams if the teams-only consumer emulation was intended`,
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
  /** The resolved Phase B ablation arm: `phaseB` layered under `phaseBSkip`'s seven components (see `resolvePhaseBArm`). */
  readonly phaseBArm: PhaseBArmResolution;
  /** Which shape the fetched event artifact's `upcoming` rows are put in before the measured region (see `parsePhaseBUpcomingParam`). */
  readonly phaseBUpcoming: PhaseBUpcomingShape;
  /** A `phaseBUpcoming=` value that was neither `published` nor `scheduled`, surfaced as a warning. */
  readonly phaseBUpcomingUnrecognized: string | undefined;
  /** Whether `phaseBUpcoming=` was supplied at all, so a request that supplies it with `phaseB` off can be told it had no effect. */
  readonly phaseBUpcomingRawSupplied: boolean;
  /**
   * `undefined` = not supplied; the default (the real touched-team count) is
   * only knowable after the fold. THIS IS THE TEAM HALF'S ABLATION ROOT:
   * `phaseBTeams=0` is how the team half is removed, because `phaseBSkip` has
   * no `teamParse` token (the loop's `JSON.parse` is what the loop is).
   */
  readonly phaseBTeamsRaw: number | undefined;
  readonly phaseBEventOverride: string | undefined;
  /** The resolved split-tick chunk arm (see `resolveChunkArm`). `off` unless a `chunk=` value asked otherwise; only `teams` has a second code path. */
  readonly chunkArm: ChunkArmResolution;
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
  const phaseBArm = resolvePhaseBArm(phaseB.enabled, search.get("phaseBSkip"));
  const phaseBUpcoming = parsePhaseBUpcomingParam(search.get("phaseBUpcoming"));
  const phaseBTeamsRaw = parseOptionalIntParam(search.get("phaseBTeams"));
  const phaseBEventOverride = search.get("phaseBEvent")?.trim() || undefined;
  const chunkArm = resolveChunkArm(search.get("chunk"));
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
    phaseBArm,
    phaseBUpcoming: phaseBUpcoming.shape,
    phaseBUpcomingUnrecognized: phaseBUpcoming.unrecognized,
    phaseBUpcomingRawSupplied: (search.get("phaseBUpcoming")?.trim() ?? "") !== "",
    phaseBTeamsRaw,
    phaseBEventOverride,
    chunkArm,
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

/** A `chunk=teams` step that failed, carried to the response as `chunk.error` with every counter left at 0 and the response a 500 — so the driver's warm-up gate aborts rather than recording an arm that measured nothing. */
class ProbeChunkError extends Error {
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
  /**
   * `upcoming` rows rewritten to the schedule-only shape by
   * `phaseBUpcoming=scheduled`. 0 under the default `published` shape. The
   * reshape runs BEFORE the ablated region and in EVERY arm, including the one
   * that skips `eventParse`, so it cancels in that arm's difference.
   */
  readonly eventUpcomingReshapedRows: number;
  /** Bytes of the reshaped event text actually fed to the measured region; 0 under the default `published` shape, where the fetched text is used as-is. */
  readonly reshapedEventTextBytes: number;
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
   * `JSON.parse` calls on the team artifact text — one per loop iteration, so
   * this equals `phaseBTeams` in EVERY arm, including `phaseBSkip=teamValidate`
   * (the schema validation sits on top of the parse and is reported separately
   * by `params.phaseBArm.ran.teamValidate`). `phaseBTeams=0` is the team half's
   * ablation root, and this reads 0 there.
   *
   * The probe parses ONE team's fetched bytes N times: that prices N parses of
   * a realistically-sized artifact, but a real tick parses N DIFFERENT teams'
   * artifacts of similar size. Do not read this as N distinct teams.
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
  eventUpcomingReshapedRows: 0,
  reshapedEventTextBytes: 0,
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

/**
 * What a `chunk=teams` invocation did — the whole response for that arm, since
 * it runs no discovery, no read, no deserialize and no fold.
 *
 * THERE IS DELIBERATELY NO D1-CALL COUNTER HERE. The arm makes no D1 call, so a
 * hardcoded `0` would be decoration that could not fail; the real evidence is
 * `stateProbe.test.ts` Group 11's assertion that the fake database's recorded
 * SQL list is EMPTY by equality.
 */
interface ChunkResult {
  /** False whenever `chunk` was not `teams`, and false on any failure before the first merge. Every counter below is 0 when this is false. */
  readonly ran: boolean;
  /** One event GET plus one team GET. A real consumer would issue one event GET plus one GET PER TEAM — 13 for a twelve-team chunk; see this arm's own re-parse caveat. */
  readonly artifactsFetched: number;
  readonly eventArtifactBytes: number;
  readonly teamArtifactBytes: number;
  /** `matches[]` rows the published event artifact carried — what the chunk READ, not what it rebuilt. */
  readonly publishedPlayedRowsRead: number;
  /** Rows actually rebuilt into a `MatchResult`: `min(folded, publishedPlayedRowsRead)`. */
  readonly matchesReconstructed: number;
  readonly predictionsReconstructed: number;
  /** Reconstructed predictions carrying BOTH RP pmfs. A zero here means the published rows are thinner than what `allPhaseB` merges and the comparison is invalid. */
  readonly predictionsWithRpPmf: number;
  /** Reconstructed predictions carrying at least one published Match Band variance. Same "a zero invalidates the comparison" reading as above. */
  readonly predictionsWithBand: number;
  /** Rebuilt matches whose PUBLISHED rosters were replaced by the probe's own `rosterAt` cycle, so this arm merges the same twelve pinned teams `allPhaseB` merges. A real consumer would keep the published rosters. */
  readonly rostersSubstituted: number;
  /** Which route the score-breakdown gap was answered by — see `runTeamsChunk`'s header. `none` when the arm did not run. */
  readonly bonusFlagRoute: string;
  /** Rows whose published actual-bonus boolean arrays were inverted back through the season rule module's `bonusNames`. */
  readonly bonusFlagArraysInverted: number;
  /** Matches whose `PlayedRowFacts.actualBonusFlags` came back a real record rather than `null`/absent — what the inversion actually bought. */
  readonly matchesWithActualBonusFlags: number;
  readonly playedRowFactsBuilt: number;
  /** Merged teams that had a non-empty `metrics` record on the event artifact's own `teams[]` row (per F-7). */
  readonly teamsWithPublishedMetrics: number;
  /** Merged teams whose event-artifact `teams[]` row carried a published Sigma entry, which is where `sigmaAfterTick` comes from without D1. */
  readonly teamsWithPublishedSigma: number;
  /** `JSON.parse` calls on the team artifact text — one per loop iteration, so it equals `phaseBTeams`. `phaseBTeams=0` is this loop's root here exactly as it is for Phase B, and reads 0. */
  readonly teamParsesRun: number;
  readonly teamMergesRun: number;
  /** New `metricHistory` rows the merges produced, summed — the observable proof each merge wrote this tick's rows rather than returning its input. */
  readonly mergedTeamRows: number;
  /** Summed `JSON.stringify(mergedTeam).length` over every team merge. */
  readonly mergedTeamBytes: number;
  /** Every field the chunk had to DEFAULT rather than read off the published played row, as data rather than as an unstated assumption. See this arm's enumerating warning for which of them the merge path actually reads. */
  readonly unreconstructedFields: readonly string[];
  readonly error?: { readonly name: string; readonly message: string };
}

const CHUNK_ZEROS = {
  ran: false,
  artifactsFetched: 0,
  eventArtifactBytes: 0,
  teamArtifactBytes: 0,
  publishedPlayedRowsRead: 0,
  matchesReconstructed: 0,
  predictionsReconstructed: 0,
  predictionsWithRpPmf: 0,
  predictionsWithBand: 0,
  rostersSubstituted: 0,
  bonusFlagRoute: "none",
  bonusFlagArraysInverted: 0,
  matchesWithActualBonusFlags: 0,
  playedRowFactsBuilt: 0,
  teamsWithPublishedMetrics: 0,
  teamsWithPublishedSigma: 0,
  teamParsesRun: 0,
  teamMergesRun: 0,
  mergedTeamRows: 0,
  mergedTeamBytes: 0,
  unreconstructedFields: [] as readonly string[],
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
    /** The resolved Phase B component arm: `id` ("all" | "skip:a,b,c") plus which of the seven components actually ran. Read this before trusting a `cpuTime` — a typo in `phaseBSkip` skips nothing. */
    readonly phaseBArm: { readonly id: string; readonly ran: PhaseBArmRan };
    /** Which shape the fetched event artifact's `upcoming` rows were in. A `scheduled` arm's ABSOLUTE cpuTime is not comparable to a `published` arm's — only its within-shape difference is. */
    readonly phaseBUpcoming: PhaseBUpcomingShape;
    readonly phaseBTeams: number;
    readonly phaseBEvent: string;
    /**
     * Which SPLIT-TICK chunk this invocation emulated: `off` (every arm that
     * existed before 2026-09-17), `teams`, or the recognized-inert `event`.
     * READ THIS BEFORE ATTRIBUTING A cpuTime: a `teams` request runs a
     * completely different path from every other arm, and the `rp`/`rpArm`/
     * `phaseB`/`phaseBArm` echoes beside it then describe params that were
     * PARSED but never used.
     */
    readonly chunk: ChunkArmId;
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
  readonly chunk: ChunkResult;
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
 *   fetch the published event artifact -> `checkLiveEventArtifactShape` ->
 *   `playedRowFactsFor` -> `mergeEventArtifact` (which splices the `state`
 *   block) -> `JSON.stringify` -> N x (`checkTeamSeasonArtifactShape` ->
 *   `mergeTeamSeasonArtifact` -> `JSON.stringify`) -> discard everything.
 *
 * THOSE TWO GUARD CALLS WERE `LiveEventArtifactSchema.parse` AND
 * `TeamSeasonArtifactSchema.parse` UNTIL 260915-t7o's fix F2 replaced the
 * tick's read-side zod parses with `artifactShapeCheck.ts`'s O(1) structural
 * guards. The probe follows the tick, always — a probe that kept calling zod
 * here would price a read path production no longer runs, which is the one
 * thing this file exists not to do. CONSEQUENCE FOR THE MEASUREMENT: the
 * `eventValidate` and `teamValidate` arms still gate the read-path validation
 * step, but that step is now the guard, not the schema parse. A before/after
 * comparison of those two arms across the F2 commit is therefore a measurement
 * OF F2 ITSELF (zod parse vs structural guard), not two measurements of the
 * same work — `measure/arms.mjs` says so at each affected difference.
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
 *
 * `ran` — the resolved `phaseBSkip` component set (see `resolvePhaseBArm`) —
 * gates seven of those operations independently:
 *     1. `eventParse`: `JSON.parse` of the (possibly reshaped) event text.
 *        ROOT of the event half: without it there is no object to validate,
 *        merge or stringify, so all three are forced off
 *     2. `eventValidate`: `checkLiveEventArtifactShape` (was
 *        `LiveEventArtifactSchema.parse` before 260915-t7o fix F2 — see above).
 *        When skipped, the raw `JSON.parse` output is CAST and fed straight to
 *        the merge, which is the trade the read-path fix already made permanent
 *     3. `eventMerge`: `mergeEventArtifact`, the state-block splice included.
 *        Forces `eventStringify` off
 *     4. `eventStringify`: `JSON.stringify(mergedEvent)`
 *     5. `teamValidate`: `checkTeamSeasonArtifactShape` (was
 *        `TeamSeasonArtifactSchema.parse` before fix F2), per team. The loop's
 *        own `JSON.parse` runs either way
 *     6. `teamMerge`: `mergeTeamSeasonArtifact`. Forces `teamStringify` off
 *     7. `teamStringify`: `JSON.stringify(mergedTeam)`
 *
 * THE TEAM HALF'S ROOT IS `phaseBTeams=0`, not a component name — see
 * `PHASE_B_ARM_COMPONENT_NAMES`' own comment. To make that root honest the
 * team `JSON.parse` lives INSIDE the loop (it used to run once before it, so
 * `phaseBTeams=0` still reported one parse); at `phaseBTeams=12` the total is
 * unchanged, because 1 + 11 and 0 + 12 are the same twelve parses.
 *
 * `playedRowFactsFor` RUNS IN EVERY ARM, regardless of every skip above, so it
 * cancels in every difference. It is not gateable and is not meant to be: it
 * is Phase A's own output being shaped, not a read-path cost.
 *
 * `phaseBUpcoming=scheduled` REBUILDS the fetched event text's `upcoming` rows
 * into the schedule-only shape the Worker itself writes — and therefore reads
 * back on every tick after the first — BEFORE any of the seven components. It
 * runs in every arm, including the `eventParse`-skipped one, so the reshape's
 * own cost cancels in that arm's difference. Its absolute `cpuTime` is NOT
 * comparable to a `published` arm's; only a within-shape difference is, and the
 * response says so.
 *
 * ONE ASYMMETRY, DELIBERATE AND REPORTED: the state-block synthesis. When
 * `eventParse` runs, a block is synthesized only if the published artifact
 * carried none — today's behaviour, untouched. When `eventParse` is SKIPPED
 * there is no parsed object to ask, so the synthesis runs unconditionally, so
 * that out of season (where no published artifact carries a block, and both
 * arms therefore synthesize) the term cancels exactly in `eventHalf`. In season,
 * where the full arm would synthesize nothing, the skipped arm still pays one
 * and `eventHalf` is UNDER-stated by that term. `stateBlockSynthesized` reports
 * which case ran.
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
  readonly ran: PhaseBArmRan;
  readonly upcomingShape: PhaseBUpcomingShape;
}): Promise<{ result: PhaseBResult; warnings: string[] }> {
  const { origin, phaseBEventKey, eventKey, season, eventType, teamKeys, sprRows, phaseA, phaseBTeams, ran, upcomingShape } = params;
  const warnings: string[] = [];

  const firstTeamKey = teamKeys[0];
  if (firstTeamKey === undefined) {
    throw new ProbePhaseBError("EmptyRoster", "phaseB needs at least one discovered team key to build a team-artifact key");
  }

  const eventText = await fetchArtifactText(origin, artifactKey({ page: "event", eventKey: phaseBEventKey, algorithmId: "spr", version: spr.version }));
  const teamText = await fetchArtifactText(origin, artifactKey({ page: "team", teamKey: firstTeamKey, year: season, algorithmId: "spr", version: spr.version }));

  // The reshape: before every gated component, in every arm, so its own cost
  // cancels in whichever difference the caller takes.
  let measuredEventText = eventText;
  let eventUpcomingReshapedRows = 0;
  let reshapedEventTextBytes = 0;
  if (upcomingShape === "scheduled") {
    try {
      const raw = JSON.parse(eventText) as Record<string, unknown>;
      const rows = Array.isArray(raw.upcoming) ? raw.upcoming : [];
      const reshaped = rows.map(toScheduleOnlyUpcomingRow);
      eventUpcomingReshapedRows = reshaped.length;
      // Spread-then-override keeps `upcoming` in its original key position, so
      // the reshaped text differs from the fetched one in row CONTENT only.
      measuredEventText = JSON.stringify({ ...raw, upcoming: reshaped });
      reshapedEventTextBytes = measuredEventText.length;
    } catch (err) {
      throw new ProbePhaseBError("EventUpcomingReshapeFailed", err instanceof Error ? err.message : String(err));
    }
    warnings.push(
      `phaseBUpcoming=scheduled — the fetched event artifact's ${eventUpcomingReshapedRows} upcoming row(s) were rewritten to the seven schedule-only keys the Worker itself writes, so the parse below prices the shape the LIVE tick reads back rather than the published one. This arm's ABSOLUTE cpuTime is NOT comparable to a published-shape arm's — the reshape itself costs CPU and the payload size changes. Only a difference between two scheduled-shape arms is`
    );
  }

  let parsedEvent: LiveEventArtifact | undefined;
  if (ran.eventParse) {
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(measuredEventText);
    } catch (err) {
      throw new ProbePhaseBError("EventArtifactParseFailed", err instanceof Error ? err.message : String(err));
    }
    // Component `eventValidate`: SINCE 260915-t7o's fix F2 this gates
    // `checkLiveEventArtifactShape`, the tick's OWN read guard, because the
    // tick no longer zod-parses here — see this function's header. When off,
    // the raw parse output is CAST, exactly as before.
    if (ran.eventValidate) {
      const guarded = checkLiveEventArtifactShape(rawEvent);
      if (guarded === undefined) {
        throw new ProbePhaseBError(
          "EventArtifactShapeRejected",
          "checkLiveEventArtifactShape rejected the fetched event artifact — the tick would bootstrap over it, so this arm would price a merge the live tick never runs"
        );
      }
      parsedEvent = guarded;
    } else {
      parsedEvent = rawEvent as LiveEventArtifact;
    }
  }

  const eventStateBlockPresent = parsedEvent?.state !== undefined;
  let existingEvent: LiveEventArtifact | undefined = parsedEvent;
  let stateBlockSynthesized = false;
  if (!eventStateBlockPresent) {
    // Measuring the merge without a block would under-price the one term the
    // browser-pricing work actually GREW, so a block is synthesized instead.
    // With `eventParse` skipped there is nothing to attach it to, but it is
    // still BUILT (see this function's header: that is what makes the
    // eventHalf difference cancel out of season).
    let synthesized: LiveEventArtifact["state"];
    try {
      synthesized = buildEventStateBlock(sprRows, teamKeys);
    } catch (err) {
      throw new ProbePhaseBError("StateBlockSynthesisFailed", err instanceof Error ? err.message : String(err));
    }
    if (parsedEvent !== undefined) existingEvent = { ...parsedEvent, state: synthesized };
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

  // Component `eventMerge`. Skipping it leaves every merged-event counter at 0
  // and forces `eventStringify` off — there is nothing to serialize.
  let mergedEvent: { state?: { rows?: readonly unknown[] }; upcoming?: readonly unknown[]; matches?: readonly unknown[] } | undefined;
  if (ran.eventMerge) {
    mergedEvent = mergeEventArtifact({
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
  }

  // Component `eventStringify`.
  const mergedEventBytes = ran.eventStringify && mergedEvent !== undefined ? JSON.stringify(mergedEvent).length : 0;

  let teamParsesRun = 0;
  let teamMergesRun = 0;
  let mergedTeamBytes = 0;
  for (let i = 0; i < phaseBTeams; i++) {
    const teamKey = teamKeys[i % teamKeys.length]!;
    // The SAME fetched bytes, re-parsed: see this function's header for why
    // that is a realistic parse cost but not N distinct teams. The parse lives
    // HERE, inside the loop, so `phaseBTeams=0` really does report zero.
    let rawTeam: unknown;
    try {
      rawTeam = JSON.parse(teamText);
    } catch (err) {
      throw new ProbePhaseBError("TeamArtifactParseFailed", err instanceof Error ? err.message : String(err));
    }
    // Component `teamValidate`: SINCE 260915-t7o's fix F2 this gates
    // `checkTeamSeasonArtifactShape`, the tick's OWN read guard, because the
    // tick no longer zod-parses here — see this function's header for what that
    // means for a cross-version comparison of this arm. When off, the raw parse
    // output is CAST, exactly as before.
    let existingTeam: TeamSeasonArtifact;
    if (ran.teamValidate) {
      const guarded = checkTeamSeasonArtifactShape(rawTeam);
      if (guarded === undefined) {
        throw new ProbePhaseBError(
          "TeamArtifactShapeRejected",
          "checkTeamSeasonArtifactShape rejected the fetched team artifact — the tick would bootstrap over it, so this arm would price a merge the live tick never runs"
        );
      }
      existingTeam = guarded;
    } else {
      existingTeam = rawTeam as TeamSeasonArtifact;
    }
    teamParsesRun++;
    if (!ran.teamMerge) continue;
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
    teamMergesRun++;
    // Component `teamStringify`.
    if (ran.teamStringify) mergedTeamBytes += JSON.stringify(mergedTeam).length;
  }

  return {
    result: {
      ran: true,
      eventArtifactBytes: eventText.length,
      teamArtifactBytes: teamText.length,
      eventUpcomingReshapedRows,
      reshapedEventTextBytes,
      eventStateBlockPresent,
      stateBlockSynthesized,
      playedRowFactsBuilt: playedRowFacts.size,
      mergedEventBytes,
      mergedEventStateBlockPresent: mergedEvent?.state !== undefined,
      mergedEventStateRows: mergedEvent?.state?.rows?.length ?? 0,
      mergedEventUpcomingRows: mergedEvent?.upcoming?.length ?? 0,
      mergedEventPlayedRows: mergedEvent?.matches?.length ?? 0,
      teamParsesRun,
      teamMergesRun,
      mergedTeamBytes,
    },
    warnings,
  };
}

// ===========================================================================
// THE SPLIT-TICK TEAMS CHUNK (`chunk=teams`, 2026-09-17).
//
// Below `runSprPhaseB` on purpose: Group 7 slices the region between the
// `function runSprFold(` and `async function runSprPhaseB(` declarations and
// pins its call names by equality in BOTH directions, so anything placed
// between them would break that snapshot. This is Phase-B-adjacent work and
// belongs here, after it.
// ===========================================================================

/**
 * Every field the chunk has to DEFAULT rather than read off the published
 * played row, reported as data so the message-payload-versus-D1 question is
 * answered by the instrument rather than by a planner's assumption.
 *
 * Fixed order, pinned by `stateProbe.test.ts` Group 11. Membership was checked
 * field by field against `EventMatchSchema` (`packages/harness/pageArtifacts.ts`)
 * and against what `mergeTeamSeasonArtifact` and `playedRowFactsFor` actually
 * read (`apps/worker/src/artifactMerge.ts`).
 */
const CHUNK_UNRECONSTRUCTED_FIELDS: readonly string[] = [
  "match.redSurrogates",
  "match.blueSurrogates",
  "match.redDqs",
  "match.blueDqs",
  "match.week",
  "match.hasScoreBreakdown",
  "match.scoreBreakdownRaw",
  "prediction.variance",
  "prediction.redComponents",
  "prediction.blueComponents",
  "prediction.redOutcomeRp",
  "prediction.blueOutcomeRp",
  "playedRowFacts.reportedSortTime",
];

/** The route taken for the score breakdown, echoed as `chunk.bonusFlagRoute` so the decision is visible in every response rather than buried in this file. */
const CHUNK_BONUS_FLAG_ROUTE = "invert-published-actual-bonus-arrays";

/**
 * A non-null placeholder for the `MatchResult.scoreBreakdownRaw` that the
 * published row does not carry. It is NEVER PARSED: `actualBonusFlagsForMatch`
 * short-circuits to the caller-supplied `parsedSides` before it would touch
 * this string. It exists only because that function's three-way gate reads
 * `hasScoreBreakdown` and `scoreBreakdownRaw !== null` BEFORE it looks at
 * `parsedSides`, so a consumer holding already-derived flags still has to
 * satisfy the gate. That requirement IS the finding — it is reported, not
 * hidden, and it is not a reason to reach for D1 (D1 holds no breakdown
 * either).
 */
const CHUNK_BREAKDOWN_PLACEHOLDER = "{}";

/**
 * THE TEAMS CHUNK: what the consumer half of a split tick would cost as its
 * own invocation.
 *
 * It emulates a queue consumer that was handed a pointer (event key, match
 * keys, team keys) and nothing else:
 *
 *   GET the published event artifact -> `JSON.parse` ->
 *   `checkLiveEventArtifactShape` -> rebuild a `MatchResult` and a
 *   `Prediction` per played row -> `playedRowFactsFor` -> N x (`JSON.parse` a
 *   team artifact -> `checkTeamSeasonArtifactShape` ->
 *   `mergeTeamSeasonArtifact` -> `JSON.stringify`) -> discard everything.
 *
 * NO D1 READ, NO DESERIALIZE, NO FOLD. `runProbe` routes this arm BEFORE
 * discovery and BEFORE the read/deserialize loop, so not one statement is ever
 * prepared; Group 11 asserts the fake database's recorded SQL list is empty.
 *
 * THE MERGE IS THE TICK'S OWN. `mergeTeamSeasonArtifact` and
 * `playedRowFactsFor` are imported from `artifactMerge.ts`, the module the
 * tick itself calls. A copy would price a fiction.
 *
 * FOUR PLACES THIS IS A FLOOR OR A SUBSTITUTION, ALL REPORTED:
 *   1. The rebuilt predictions are re-rounded from ALREADY-ROUNDED published
 *      numbers. The merge's own rounding then runs over them a second time.
 *      That costs the same CPU; it is a fidelity note, not a blocker.
 *   2. The published rosters are REPLACED by the probe's own `rosterAt` cycle,
 *      so this arm merges the same twelve pinned teams `allPhaseB` merges and
 *      the two cpuTimes are comparable. A real consumer would keep them.
 *   3. As in `runSprPhaseB`, ONE team's fetched bytes are re-parsed N times.
 *      That prices N parses of a realistic artifact; a real consumer parses N
 *      different teams'. The team half stays a floor.
 *   4. The score breakdown: see `CHUNK_BREAKDOWN_PLACEHOLDER`.
 *
 * THE SCORE-BREAKDOWN ROUTE, chosen and reported. `playedRowFactsFor` derives
 * `actualBonusFlags` through `actualBonusFlagsForMatch`, which needs either a
 * breakdown to parse or a pre-parsed `ParsedBonusSides`. The published row
 * carries NEITHER — it carries the ANSWER, `actualRedBonusRp`/
 * `actualBlueBonusRp`, as boolean arrays ordered by the season rule module's
 * `bonusNames`. This chunk INVERTS those arrays back into the per-side record
 * `ParsedBonusSides` holds, which is the route that keeps the published bonus
 * columns on the merged rows. `chunk.bonusFlagArraysInverted` and
 * `chunk.matchesWithActualBonusFlags` report what it bought.
 */
async function runTeamsChunk(params: {
  readonly origin: string;
  readonly eventArtifactKey: string;
  readonly fallbackSeason: number;
  readonly fallbackEventType: number;
  readonly teamKeys: readonly string[];
  readonly folded: number;
  readonly chunkTeamsRaw: number | undefined;
}): Promise<{ result: ChunkResult; chunkTeams: number; warnings: string[] }> {
  const { origin, eventArtifactKey, fallbackSeason, fallbackEventType, teamKeys, folded, chunkTeamsRaw } = params;
  const warnings: string[] = [];

  const firstTeamKey = teamKeys[0];
  if (firstTeamKey === undefined) {
    throw new ProbeChunkError("ChunkEmptyRoster", "chunk=teams needs at least one team key to build a team-artifact key");
  }

  const eventText = await fetchArtifactText(origin, eventArtifactKey);

  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(eventText);
  } catch (err) {
    throw new ProbeChunkError("ChunkEventArtifactParseFailed", err instanceof Error ? err.message : String(err));
  }
  const guarded = checkLiveEventArtifactShape(rawEvent);
  if (guarded === undefined) {
    throw new ProbeChunkError(
      "ChunkEventArtifactShapeRejected",
      "checkLiveEventArtifactShape rejected the fetched event artifact — the tick would bootstrap over it, so this chunk would price a merge the live tick never runs"
    );
  }

  const publishedPlayedRows = guarded.matches;
  if (publishedPlayedRows.length === 0) {
    throw new ProbeChunkError(
      "ChunkNoPublishedPlayedRows",
      "the published event artifact carries no played rows, so a teams-only consumer has nothing to reconstruct — point chunk=teams at an event whose artifact has played matches rather than recording a chunk that merged nothing"
    );
  }

  // The artifact's own top-level facts, per F-3 and F-7: `eventType` is
  // optional on the schema (artifacts published before 260915-isq carry none),
  // so both fall back to the request's params rather than to a sentinel.
  const artifactSeason = typeof guarded.season === "number" ? guarded.season : fallbackSeason;
  const artifactEventType = typeof guarded.eventType === "number" ? guarded.eventType : fallbackEventType;
  const artifactEventKey = typeof guarded.eventKey === "string" && guarded.eventKey.length > 0 ? guarded.eventKey : eventArtifactKey;
  const ruleModule = RP_RULE_MODULES[artifactSeason];

  const rebuiltMatches: MatchResult[] = [];
  const rebuiltPredictions = new Map<string, Prediction>();
  const rebuiltBands = new Map<string, MatchBand>();
  const observedBonusSides = new Map<string, ParsedBonusSides>();
  const foldedFacts: { matchKey: string; videoKey: string | null }[] = [];
  let predictionsWithRpPmf = 0;
  let predictionsWithBand = 0;
  let rostersSubstituted = 0;
  let bonusFlagArraysInverted = 0;

  const rowsToRebuild = Math.min(folded, publishedPlayedRows.length);
  for (let i = 0; i < rowsToRebuild; i++) {
    const row = publishedPlayedRows[i]!;

    // The bonus inversion, per this function's header. Both sides must be
    // present, non-null and the season's own length; anything else leaves the
    // flags out entirely, which is the same `null` a real consumer would get.
    let parsedSides: ParsedBonusSides | undefined;
    const redActual = row.actualRedBonusRp;
    const blueActual = row.actualBlueBonusRp;
    if (
      ruleModule !== undefined &&
      Array.isArray(redActual) &&
      Array.isArray(blueActual) &&
      redActual.length === ruleModule.bonusNames.length &&
      blueActual.length === ruleModule.bonusNames.length
    ) {
      const red: Record<string, boolean> = {};
      const blue: Record<string, boolean> = {};
      ruleModule.bonusNames.forEach((bonusName, index) => {
        red[bonusName] = redActual[index] === true;
        blue[bonusName] = blueActual[index] === true;
      });
      parsedSides = { red, blue };
      bonusFlagArraysInverted++;
    }

    // The roster substitution (floor note 2), counted and warned below.
    const roster = rosterAt(teamKeys, i);
    rostersSubstituted++;

    const match: MatchResult = {
      matchKey: row.matchKey,
      eventKey: artifactEventKey,
      compLevel: row.compLevel,
      setNumber: row.setNumber,
      matchNumber: row.matchNumber,
      redTeams: roster.red,
      blueTeams: roster.blue,
      // DEFAULTED, not read: the published row carries no surrogate or DQ
      // list. `mergeTeamSeasonArtifact` reads neither, so this costs the
      // measurement nothing — it is in the reported list because a reader
      // must not have to take that on trust.
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      eventType: artifactEventType,
      week: null,
      winner: row.actualWinner,
      redScore: row.actualRedScore,
      blueScore: row.actualBlueScore,
      redRpEarned: row.actualRedRp ?? null,
      blueRpEarned: row.actualBlueRp ?? null,
      hasScoreBreakdown: parsedSides !== undefined,
      scoreBreakdownRaw: parsedSides !== undefined ? CHUNK_BREAKDOWN_PLACEHOLDER : null,
    };

    const prediction: Prediction = {
      winner: row.predictedWinner,
      pRedWin: row.pRedWin,
      redScore: row.predictedRedScore,
      blueScore: row.predictedBlueScore,
      ...(row.redScoreVarianceOwn !== undefined ? { redScoreVarianceOwn: row.redScoreVarianceOwn } : {}),
      ...(row.blueScoreVarianceOwn !== undefined ? { blueScoreVarianceOwn: row.blueScoreVarianceOwn } : {}),
      ...(row.redRpPmf !== undefined ? { redRpPmf: row.redRpPmf } : {}),
      ...(row.blueRpPmf !== undefined ? { blueRpPmf: row.blueRpPmf } : {}),
      ...(row.redBonusRp !== undefined ? { redBonusRp: row.redBonusRp } : {}),
      ...(row.blueBonusRp !== undefined ? { blueBonusRp: row.blueBonusRp } : {}),
    };
    // Counted off the REBUILT objects, never off the source row: a counter
    // that reads the row would keep reporting a healthy number while the
    // reconstruction beside it silently dropped the field.
    if (prediction.redRpPmf !== undefined && prediction.blueRpPmf !== undefined) predictionsWithRpPmf++;

    const band: MatchBand = {
      ...(row.redMatchBandVariance !== undefined ? { red: row.redMatchBandVariance } : {}),
      ...(row.blueMatchBandVariance !== undefined ? { blue: row.blueMatchBandVariance } : {}),
    };
    if (band.red !== undefined || band.blue !== undefined) predictionsWithBand++;

    rebuiltMatches.push(match);
    rebuiltPredictions.set(match.matchKey, prediction);
    rebuiltBands.set(match.matchKey, band);
    if (parsedSides !== undefined) observedBonusSides.set(match.matchKey, parsedSides);
    foldedFacts.push({ matchKey: match.matchKey, videoKey: row.video ?? null });
  }

  // The tick's OWN function. `rawMatches` is empty exactly as it is in
  // `runSprPhaseB`: `reportedSortTime` is derived only from a TBA-shaped raw
  // match, which no published artifact carries, so it comes back `undefined`
  // and the merge falls back to the row's already-published `sortTime` — the
  // tick's own documented degradation for a match TBA reports no time for.
  const playedRowFacts = playedRowFactsFor(artifactSeason, [], foldedFacts, rebuiltMatches, observedBonusSides);
  let matchesWithActualBonusFlags = 0;
  for (const facts of playedRowFacts.values()) {
    if (facts.actualBonusFlags !== null && facts.actualBonusFlags !== undefined) matchesWithActualBonusFlags++;
  }

  // Per F-7: each team's metrics and Sigma come off the event artifact's own
  // `teams[]` rows, which `mergeEventArtifact` wrote there. Rounded, and a
  // live tick's own rows carry no `percentile` — both losses, neither of them
  // read by the team merge.
  const publishedMetrics = new Map<string, Record<string, TeamMetric>>();
  const publishedSigma = new Map<string, number>();
  for (const teamRow of guarded.teams) {
    const metrics: Record<string, TeamMetric> = {};
    for (const [metricKey, metric] of Object.entries(teamRow.metrics)) {
      // The Sigma entry travels separately as `sigmaAfterTick`, exactly as it
      // does in the tick — carrying it inside `metrics` too would double it.
      if (metricKey === SIGMA_METRIC_KEY) continue;
      metrics[metricKey] = { value: metric.value, ...(metric.spread !== undefined ? { spread: metric.spread } : {}) };
    }
    publishedMetrics.set(teamRow.teamKey, metrics);
    const sigma = teamRow.metrics[SIGMA_METRIC_KEY]?.value;
    if (sigma !== undefined) publishedSigma.set(teamRow.teamKey, sigma);
  }

  const touchedTeams = [...new Set(rebuiltMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
  const matchIndexByKey = new Map<string, number>();
  for (const m of rebuiltMatches) matchIndexByKey.set(m.matchKey, matchIndexByKey.size);

  // The default is the teams the RECONSTRUCTED rows touch — there is no Phase A
  // touched-team count in this arm. `phaseBTeams=0` is this loop's root too.
  const chunkTeams = Math.min(MAX_TEAM_COUNT, Math.max(0, chunkTeamsRaw ?? touchedTeams.length));

  const teamText = await fetchArtifactText(origin, artifactKey({ page: "team", teamKey: firstTeamKey, year: artifactSeason, algorithmId: "spr", version: spr.version }));

  let teamParsesRun = 0;
  let teamMergesRun = 0;
  let mergedTeamRows = 0;
  let mergedTeamBytes = 0;
  let teamsWithPublishedMetrics = 0;
  let teamsWithPublishedSigma = 0;
  for (let i = 0; i < chunkTeams; i++) {
    const teamKey = touchedTeams.length > 0 ? touchedTeams[i % touchedTeams.length]! : teamKeys[i % teamKeys.length]!;
    let rawTeam: unknown;
    try {
      rawTeam = JSON.parse(teamText);
    } catch (err) {
      throw new ProbeChunkError("ChunkTeamArtifactParseFailed", err instanceof Error ? err.message : String(err));
    }
    const existingTeam = checkTeamSeasonArtifactShape(rawTeam);
    if (existingTeam === undefined) {
      throw new ProbeChunkError(
        "ChunkTeamArtifactShapeRejected",
        "checkTeamSeasonArtifactShape rejected the fetched team artifact — the tick would bootstrap over it, so this chunk would price a merge the live tick never runs"
      );
    }
    teamParsesRun++;

    const teamMetrics = publishedMetrics.get(teamKey);
    if (teamMetrics !== undefined && Object.keys(teamMetrics).length > 0) teamsWithPublishedMetrics++;
    const sigmaAfterTick = publishedSigma.get(teamKey);
    if (sigmaAfterTick !== undefined) teamsWithPublishedSigma++;

    const teamMatches = rebuiltMatches.filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey));
    const priorHistoryRows = existingTeam.metricHistory.length;
    const mergedTeam = mergeTeamSeasonArtifact({
      existing: existingTeam,
      teamKey,
      season: artifactSeason,
      algorithmId: "spr",
      algorithmVersion: spr.version,
      eventKey: artifactEventKey,
      matches: teamMatches,
      predictions: rebuiltPredictions,
      metrics: teamMetrics ?? {},
      matchIndexByKey,
      bands: rebuiltBands,
      playedRowFacts,
      stamp: PROBE_MERGE_STAMP,
      sigmaAfterTick,
    }) as { metricHistory?: readonly unknown[] };
    teamMergesRun++;
    mergedTeamRows += (mergedTeam.metricHistory?.length ?? 0) - priorHistoryRows;
    mergedTeamBytes += JSON.stringify(mergedTeam).length;
  }

  warnings.push(
    `chunk=teams — TEAMS-ONLY CONSUMER EMULATION: no D1 read, no deserialize and no fold ran anywhere in this request, so every fold counter reads 0 by construction and is NOT a measurement of the fold. The rp/rpArm/phaseB/phaseBArm echoes beside this are params the probe parsed but NOT used by this arm. Its ABSOLUTE cpuTime is the figure to read, not a difference — unusual for this probe — and absolutes are comparable only within the reused-isolate stratum`
  );
  warnings.push(
    `chunk=teams substituted the rosters of ${rostersSubstituted} reconstructed match(es) with the probe's own rosterAt cycle over the teams= override, so this arm merges the same ${touchedTeams.length} pinned teams the allPhaseB arm merges and the two cpuTimes are comparable. A real consumer would keep the published rosters. It also re-parses ONE team's fetched bytes ${teamParsesRun} time(s) rather than ${teamParsesRun} different teams', so the team half here is a FLOOR, exactly as it is under phaseB=1`
  );
  warnings.push(
    `chunk=teams answered the score-breakdown gap by route "${CHUNK_BONUS_FLAG_ROUTE}": the published actualRedBonusRp/actualBlueBonusRp boolean arrays were inverted back through the season rule module's bonusNames into the per-side record ParsedBonusSides holds, for ${bonusFlagArraysInverted} of ${rowsToRebuild} reconstructed match(es), and ${matchesWithActualBonusFlags} match(es) ended up with real actualBonusFlags. The two match fields that gate it are set to satisfy actualBonusFlagsForMatch, whose hasScoreBreakdown/scoreBreakdownRaw check runs BEFORE it looks at parsedSides; the placeholder string is never parsed. D1 is NOT an alternative route here — it holds no score breakdown either`
  );
  warnings.push(
    `chunk=teams — ${CHUNK_UNRECONSTRUCTED_FIELDS.length} field(s) could NOT be taken off the published played row and were DEFAULTED: ${CHUNK_UNRECONSTRUCTED_FIELDS.join(", ")}. Of those the merge path actually READS three. match.hasScoreBreakdown and match.scoreBreakdownRaw: gate fields only, satisfied by the inversion route above, so nothing extra is needed. prediction.variance: published on the TEAM-season row but NOT on the event played row, so the merged team row loses it — a message payload carrying this tick's own prediction would supply it, or a republish would add the field to the event row. playedRowFacts.reportedSortTime: playedRowFactsFor derives it only from a TBA-shaped raw match, so the published sortTime cannot reach it; the merge falls back to the row's already-published sortTime, and a message payload carrying the tick's own TBA poll would supply the rest. The other ten are never read by mergeTeamSeasonArtifact at all. NET: no D1 read answers any of them — a small pointer message plus the published artifact is enough`
  );

  return {
    result: {
      ran: true,
      artifactsFetched: 2,
      eventArtifactBytes: eventText.length,
      teamArtifactBytes: teamText.length,
      publishedPlayedRowsRead: publishedPlayedRows.length,
      matchesReconstructed: rebuiltMatches.length,
      predictionsReconstructed: rebuiltPredictions.size,
      predictionsWithRpPmf,
      predictionsWithBand,
      rostersSubstituted,
      bonusFlagRoute: CHUNK_BONUS_FLAG_ROUTE,
      bonusFlagArraysInverted,
      matchesWithActualBonusFlags,
      playedRowFactsBuilt: playedRowFacts.size,
      teamsWithPublishedMetrics,
      teamsWithPublishedSigma,
      teamParsesRun,
      teamMergesRun,
      mergedTeamRows,
      mergedTeamBytes,
      unreconstructedFields: CHUNK_UNRECONSTRUCTED_FIELDS,
    },
    chunkTeams,
    warnings,
  };
}

/**
 * The whole response for a `chunk=teams` request. It NEVER takes a `ProbeEnv`:
 * that is how "prepares zero D1 statements" is enforced structurally here
 * rather than by care, and why `runProbe` routes to it before discovery and
 * before the read/deserialize loop.
 */
async function buildTeamsChunkResponse(params: ProbeParams): Promise<{ responseBody: ProbeResponseBody; ok: boolean }> {
  const teamKeys = (params.teamsOverride ?? []).slice(0, params.teamCount);
  const eventKey = params.eventOverride ?? "";
  const chunkEventKey = params.phaseBEventOverride ?? eventKey;

  let chunk: ChunkResult = { ...CHUNK_ZEROS };
  let chunkTeams = Math.max(0, params.phaseBTeamsRaw ?? 0);
  const warnings: string[] = [];

  if (params.teamsOverride === undefined || params.eventOverride === undefined) {
    // NEVER a fallback to discovery: that is two `ORDER BY scope_key` scans of
    // `algorithm_state`, about 2,100 rows read apiece, and the zero-D1
    // property is the whole reason this arm exists.
    chunk = {
      ...CHUNK_ZEROS,
      error: {
        name: "ChunkOverridesRequired",
        message:
          "chunk=teams requires BOTH a teams= roster override and an event= override, and it will NOT fall back to discovery — discovery is two D1 scans, and this arm exists to touch D1 zero times. Re-run with both supplied",
      },
    };
  } else if (params.artifactOrigin === undefined) {
    chunk = {
      ...CHUNK_ZEROS,
      error: {
        name: "ArtifactOriginRejected",
        message: `artifactOrigin="${params.artifactOriginRejected}" was rejected (it must parse as an https: origin) — the probe did NOT fall back to ${DEFAULT_ARTIFACT_ORIGIN}, so nothing was fetched and chunk=teams measured nothing`,
      },
    };
  } else {
    try {
      const outcome = await runTeamsChunk({
        origin: params.artifactOrigin,
        eventArtifactKey: artifactKey({ page: "event", eventKey: chunkEventKey, algorithmId: "spr", version: spr.version }),
        fallbackSeason: params.season,
        fallbackEventType: params.eventType,
        teamKeys,
        folded: params.folded,
        chunkTeamsRaw: params.phaseBTeamsRaw,
      });
      chunk = outcome.result;
      chunkTeams = outcome.chunkTeams;
      warnings.push(...outcome.warnings);
    } catch (err) {
      chunk = {
        ...CHUNK_ZEROS,
        error: { name: err instanceof Error ? err.name : "UnknownError", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  const ok = chunk.error === undefined;

  return {
    responseBody: {
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
        // Empty on purpose: nothing was read and nothing was deserialized.
        algorithms: [],
        phaseB: params.phaseBEnabled,
        phaseBArm: { id: params.phaseBArm.id, ran: params.phaseBArm.ran },
        phaseBUpcoming: params.phaseBUpcoming,
        phaseBTeams: chunkTeams,
        phaseBEvent: chunkEventKey,
        chunk: "teams",
        artifactOrigin: params.artifactOrigin ?? null,
      },
      discovery: { teamKeysFound: 0, eventKeyFound: undefined, queries: 0 },
      algorithms: [],
      fold: { ...FOLD_ZEROS },
      phaseB: { ...PHASE_B_ZEROS },
      chunk,
      warnings,
    },
    ok,
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

  // THE TEAMS CHUNK IS ROUTED HERE, before discovery and before the
  // read/deserialize loop — the only placement that makes "prepares zero D1
  // statements" true rather than merely intended. `env` is not passed on, so
  // no edit inside that path can reach the binding at all.
  if (params.chunkArm.id === "teams") {
    return await buildTeamsChunkResponse(params);
  }

  // Discovery is SKIPPED when both overrides are supplied. Each discovery query is an
  // `ORDER BY scope_key` scan over `algorithm_state` — about 2,100 rows read apiece, against a
  // 5,000,000 rows/day free-tier cap. A measurement campaign on 2026-09-15 spent 5.5M rows in one
  // UTC day on discovery alone and exhausted the account's D1 reads, which fails every subsequent
  // read INCLUDING a live tick's. With both overrides given, discovery's answer is reported but
  // never used, so it is pure cost: ~2 rows read per request instead of ~4,200.
  const discoverySkipped = params.teamsOverride !== undefined && params.eventOverride !== undefined;
  const discoveredTeamKeys = discoverySkipped ? [] : await discoverRoster(env.DB, params.teamCount);
  const discoveredEventKey = discoverySkipped ? undefined : await discoverEventKey(env.DB);

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
          ran: params.phaseBArm.ran,
          upcomingShape: params.phaseBUpcoming,
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
    // phaseBSkip's own warnings (unknown token, a partially ablated arm with
    // its forced dependents named, or the phaseB-is-off notice).
    ...params.phaseBArm.warnings,
    ...(params.phaseBUpcomingUnrecognized !== undefined
      ? [
          `phaseBUpcoming="${params.phaseBUpcomingUnrecognized}" is not a recognized value (${PHASE_B_UPCOMING_SHAPES.join(" | ")}) — the PUBLISHED shape ran, unreshaped; re-run with phaseBUpcoming=scheduled if the live row shape was intended`,
        ]
      : []),
    ...(!params.phaseBEnabled && params.phaseBUpcomingRawSupplied
      ? [`phaseBUpcoming= was ignored because phaseB is off — no artifact was fetched, so there were no upcoming rows to reshape`]
      : []),
    ...(params.artifactOriginRejected !== undefined
      ? [`artifactOrigin="${params.artifactOriginRejected}" was REJECTED — an override must parse as an https: origin, and the probe never silently falls back to ${DEFAULT_ARTIFACT_ORIGIN}`]
      : []),
    ...phaseBWarnings,
    // `chunk`'s own warnings: an unrecognized value that skipped nothing, or
    // the recognized-inert `event`. The `teams` arm never reaches here — it
    // returned above, before discovery.
    ...params.chunkArm.warnings,
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
      phaseBArm: { id: params.phaseBArm.id, ran: params.phaseBArm.ran },
      phaseBUpcoming: params.phaseBUpcoming,
      phaseBTeams,
      phaseBEvent: phaseBEventKey,
      chunk: params.chunkArm.id,
      artifactOrigin: params.artifactOrigin ?? null,
    },
    discovery: {
      teamKeysFound: discoveredTeamKeys.length,
      eventKeyFound: discoveredEventKey,
      queries: discoverySkipped ? 0 : 2,
    },
    algorithms,
    fold,
    phaseB,
    // Never runs outside the `chunk=teams` route above, so it is always at
    // rest here — and it is reported anyway, so a reader never has to know
    // which arm omits which block.
    chunk: { ...CHUNK_ZEROS },
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
