# Phase 10: District points ledger - Pattern Map

**Mapped:** 2026-09-25
**Files analyzed:** 11
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/districts/ledgerSimulation.ts` (or similar; core joint Monte Carlo: qual/selection/playoff draws) | service (pure math) | batch/event-driven (Monte Carlo draw loop) | `packages/core/algorithms/simulation/rankSimulation.ts` | exact |
| `scripts/measureAwardBaseRates.ts` (walk-forward award base-rate table generator) | utility (offline script) | batch (corpus scan, walk-forward) | `scripts/measureAwardPredictability.ts` | exact |
| `packages/harness/pageArtifacts.ts` additions: `DistrictTeamEventPointsSchema` gains 4 booleans (qualPlayed/alliancesPicked/playoffsDone/awardsPosted), new sidecar schema for baked pmfs | model/config (Zod schema) | transform (schema-as-spec) | `packages/harness/pageArtifacts.ts` (existing `DistrictTeamSchema`/`DistrictArtifactSchema`, lines ~1960-2044) | exact |
| `packages/harness/publish.ts` district artifact builder (new fields, baked pmfs, award tables) | service (pipeline builder) | transform/batch | `scripts/publishDistricts.ts` (the existing district artifact publisher script) | exact |
| `apps/worker/src/scheduled.ts` district-rankings refresh step | route/controller (cron tick step) | request-response (ETag conditional poll) | existing per-tick steps in `scheduled.ts` using `tbaPoll.ts`'s conditional fetch | role-match |
| `apps/web/src/components/districts/DistrictLedger.tsx` (replaces `DistrictLocksTab.tsx`) | component | request-response + client compute | `apps/web/src/components/districts/DistrictLocksTab.tsx` | exact |
| `apps/web/src/workers/districtSimulation.worker.ts` | worker (Web Worker entry) | event-driven (postMessage) | `apps/web/src/workers/simulation.worker.ts` | exact |
| `apps/web/src/workers/districtSimulationProtocol.ts` | service (message protocol + orchestration) | event-driven | `apps/web/src/workers/simulationProtocol.ts` | exact |
| `apps/web/src/workers/createDistrictSimulationWorker.ts` | utility (worker lifecycle) | event-driven | `apps/web/src/workers/createSimulationWorker.ts` | exact |
| `apps/web/src/lib/api/districtLedger.ts` (or extend `districts.ts`) | hook/service (data fetcher) | request-response (fetch+Zod) | `apps/web/src/lib/api/districts.ts` | exact |
| `apps/web/src/components/methodology/districtLedgerContent.ts` (or awards subsection additions) | content-as-data module | transform | `apps/web/src/components/methodology/awardsContent.ts` | exact |

## Pattern Assignments

### `packages/core/districts/ledgerSimulation.ts` (service, batch Monte Carlo)

**Analog:** `packages/core/algorithms/simulation/rankSimulation.ts`

**Module header discipline** (lines 1-46): a browser-safe leaf module, zero runtime imports, no DOM/Node built-in — has exactly two callers (browser Web Worker, Node control script). State the coupled-draw decomposition explanation up front the same way this file documents red/blue RP coupling.

**PRNG reuse** (lines 38-46):
```typescript
export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}
```
Import `mulberry32` and `drawCategorical` from `rankSimulation.ts` directly rather than reimplementing — the ledger simulation is explicitly documented (CONTEXT.md) as "one joint run" that calls `simulateRanks` itself for the ranking, then extends with selection/bracket. Do not duplicate the PRNG.

**Validation-before-loop pattern** (lines 187-262): validate every pmf/vector once before the draw loop (`assertValidPmf`, `assertFiniteVector`, `assertOutcomeVectorLength`), throwing typed errors (`InvalidPmfError`, `UnknownTeamKeyError`) rather than producing a plausible-but-wrong result. Follow this exactly for the new selection-model and bracket inputs (SPR alliance means/variances).

**Result shape for structured-clone across the Worker boundary** (lines 152-164):
```typescript
export interface SimResult {
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
  readonly draws: number;
}
```
The new joint result (qual, selection, playoff per team, event total, grand total) should use `Map<string, Int32Array>` histograms the same way — `Map`/`Int32Array` are both structured-cloneable, required for zero-conversion `postMessage`.

**Accumulator-outside-loop pattern** (lines 264-268, 295-299): allocate `Float64Array`/`Int32Array` accumulators once outside the draw loop, reset in place at the top of each draw — no per-draw allocation. Apply this to captain/pick/bracket accumulators too, given 1000 draws must stay under a second.

---

### `packages/core/districts/pointModel.ts` and `locks.ts` (reference only, no changes expected but ceilings must be reused)

**Analog:** self (already shipped)

The new selection/bracket point model must call `maxEventPoints(season, tier)` for ceilings (22/16/30/15, ×3 at dcmp) rather than hardcoding a second copy — this is explicitly named in CONTEXT.md ("ceilings 22 / 16 / 30 / 15 from `packages/core/districts/pointModel.ts`"). `UnknownDistrictSeasonError` pattern (lines 42-50) should be reused for any new season-registered table (award base-rate tables, DCMP weight) — throw rather than silently default.

---

### `scripts/measureAwardBaseRates.ts` (utility, offline walk-forward script)

**Analog:** `scripts/measureAwardPredictability.ts`

**Walk-forward leak boundary** (lines 27-40, 293-320):
```typescript
export function selectPriorInstances(
  instances: readonly AwardInstance[],
  beforeYear: number
): AwardInstance[] {
  return instances.filter((i) => i.year < beforeYear);
}

export function buildPriorHistory(
  instances: readonly AwardInstance[],
  beforeYear: number
): PriorHistory {
  // ... builds only from instances with year < beforeYear
}
```
The new base-rate-by-decoration-bucket table must use this exact "strictly less than scored year" filter, pinned by a leak test exactly as `measureAwardPredictability.test.ts` does. CONTEXT.md requires this literally ("Measured from the corpus using only seasons before the scored season, pinned by a test").

**Credential-free / offline discipline** (lines 56-64): reads `data/corpus.sqlite` read-only, no network, no `.env`. Reuse `openCorpusReadOnly` from `packages/corpus/db.js`.

**Bucket definition to reuse conceptually**: `priorAnyCount`/`priorTypeCount` (lines 322-336) already compute "prior wins of any type" — the new script buckets teams by `none / one-two / three-or-more` prior judged awards using this same counting infrastructure, crossed with rookie status via `teamAge`/`ageFeatureTriple` (lines 536-564).

**Output-table discipline**: follow the file's own pattern of a stated `PRACTICAL ANSWER` block and per-award-type table so the pipeline output is directly citable by `awardsContent.ts`-style methodology copy (walk-forward table of P(any award | bucket, rookie) and distribution over 0/5/8/10/13/15+).

---

### `packages/harness/pageArtifacts.ts` schema additions

**Analog:** existing `DistrictTeamEventPointsSchema` / `DistrictArtifactSchema` (lines 1960-2044)

**Additive-fields-no-version-bump discipline** (repeated file-wide convention, e.g. lines 1147, 1377, 1413, 1427, 1519, 1596, 1640, 1667, 1870): `PAGE_ARTIFACT_SCHEMA_VERSION` (line 64) stays unchanged for new fields that don't change previously-published numbers; only changed published numbers ship under a new version — per CONTEXT.md's process rule and the file's own established doc-comment convention. Add a comment at each new field site explaining why the version is not bumped, matching the existing style.

**Booleans-not-derived-client-side pattern**: the four new per-team-per-event booleans (qual matches played/total, alliances picked, playoffs done, awards posted) should be added directly to `DistrictTeamEventPointsSchema` (lines 1960-1971) as the Worker/publisher already compute them at fold time — never inferred client-side. Follow the doc-comment discipline already present (e.g. `dcmpSlots`/`cmpSlots` nullable doc comment, lines 1941-1946) stating the honest-null vs guessed-value distinction.

**Sidecar-vs-inline decision by measured bytes**: `DistrictArtifactSchema` already documents itself as "deliberately NOT algorithm-scoped" (line 2032) with reasoning mirrored from `CompareArtifactSchema`. If baked pmfs go on a sidecar (Claude's discretion per CONTEXT.md), follow the existing presim sidecar pattern at `v1/presim/{eventKey}/{algorithmId}@{version}.json` (search near line 2047 "Pre-schedule rank-simulation sidecar") for key-naming and schema-extension conventions.

---

### `packages/harness/publish.ts` (or `scripts/publishDistricts.ts`) district builder

**Analog:** `scripts/publishDistricts.ts`

Read this file directly before extending — it is the existing entry point that calls `DistrictArtifactSchema.parse` today (per grep) and should gain: award base-rate table lookups, baked per-team pmf computation for unstarted events, and the four new booleans. Preserve its existing walk-forward / corpus-read discipline.

---

### `apps/worker/src/scheduled.ts` district rankings refresh

**Analog:** existing per-tick TBA poll steps in `scheduled.ts`, built on `apps/worker/src/tbaPoll.ts`

**ETag conditional pattern** (`tbaPoll.ts` lines ~10, 38, 67):
```typescript
// tbaFetch's conditional-request (ETag) handling
type TbaPollResult =
  | { readonly status: "ok"; readonly etag: string | undefined; readonly matches: readonly unknown[] };
```
The new district-rankings step must call the same `tbaFetch`-style conditional request against `/district/{key}/rankings`, one request per live district per tick, republishing `v1/district/{key}.json` only when rankings changed — exactly the pattern CONTEXT.md specifies. Follow `liveWindows.ts` for "which districts currently have a live window" gating, and `artifactWriter.ts`/`artifactMerge.ts` for the incremental-write pattern other tick steps use. The Worker must NOT simulate (CONTEXT.md, "Cloudflare Worker: never simulates").

---

### `apps/web/src/components/districts/DistrictLedger.tsx`

**Analog:** `apps/web/src/components/districts/DistrictLocksTab.tsx`

**Component header discipline** (lines 1-44 of the analog): document ownership of what renders where, status-to-chip mapping, and the caveat text pattern up front, matching this file's own extensive doc comment style.

**Status chip class mapping pattern** (lines 79-103):
```typescript
const STATUS_LABEL: Record<LockVerdict["status"], string> = {
  locked: "Locked",
  lockedAward: "Locked (Award)",
  prequalified: "Prequalified",
  eliminated: "Out of range",
  contending: "Contending",
  unknown: "Capacity not published",
};

const STATUS_CHIP_MODIFIER: Partial<Record<LockVerdict["status"], string>> = {
  locked: "lock-status-chip--locked",
  lockedAward: "lock-status-chip--locked-award",
  eliminated: "lock-status-chip--eliminated",
  prequalified: "lock-status-chip--prequalified",
};

function statusChipClass(status: LockVerdict["status"]): string | undefined {
  const modifier = STATUS_CHIP_MODIFIER[status];
  return modifier === undefined ? undefined : cn("lock-status-chip", modifier);
}
```
CONTEXT.md's five statuses (Prequalified/Locked/In range/Out of range/Locked out) map onto this exact `Record`-lookup-plus-`cn()`-modifier pattern; add a new `lock-status-chip--locked-out` token-backed modifier for the red chip (never a literal hex — dataviz palette validator must run).

**Honest-em-dash-never-fabricated-zero pattern** (lines 270-274):
```typescript
function EventComponentCell({ eventPoints, component }: { eventPoints: DistrictEventPoints | undefined; component: "qual" | "alliance" | "elim" | "award" }) {
  if (eventPoints === undefined) return <>—</>;
  return <>{formatPoints(eventPoints[component])}</>;
}
```
Apply the same discipline to grey (finished) vs blue (open) cell rendering — a grey cell is always a single earned integer, never fabricated.

**Table structure with sticky column / horizontal scroll** (lines 316-427): reuse the `data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain` wrapper and `Table`/`TableHeader`/`TableBody` composition exactly — this is "the shipped table pattern with its scroll arbitration" CONTEXT.md references.

**Also reuse:** `apps/web/src/components/event/RankDistributionTable.tsx` and `rankRows.ts`'s `continuousQuantile` for the "likely a to b" band text and histogram drawer (per CONTEXT.md's Specific Ideas), not duplicated here since not yet read — planner should point executors at it directly.

---

### `apps/web/src/workers/districtSimulation.worker.ts` / `districtSimulationProtocol.ts` / `createDistrictSimulationWorker.ts`

**Analogs:** `apps/web/src/workers/simulation.worker.ts`, `simulationProtocol.ts`, `createSimulationWorker.ts`

**Thin entry / fat protocol split** (`simulation.worker.ts` lines 1-53): the worker entry file must stay a three-statement forwarder — `self` typed locally (never adding `"WebWorker"` to `apps/web/tsconfig.json`'s `lib`, per the file's own fact 1), all arithmetic lives in the protocol module because jsdom implements no `Worker` API and nothing in the entry file is reachable by Vitest:
```typescript
const scope = self as unknown as SimulationWorkerScope;
scope.onmessage = (event) => {
  runSimulationJob(event.data, (message) => {
    scope.postMessage(message);
  });
};
```

**Request/response message contract** (`simulationProtocol.ts` lines 40-97): mirror `SimulationRequest`/`SimulationProgressMessage`/`SimulationResultMessage`/`SimulationErrorMessage` shape exactly, including the "randomness crosses as a number, worker constructs its own `mulberry32(seed)`" rule (lines 49-57) — no function may cross `postMessage` (not structured-cloneable).

**Chunked-progress-is-exact-not-approximate discipline** (lines 121-193): `runSimulationJob`'s chunking guarantee (N chunked calls sharing one rng instance produce identical histograms to one big call) must hold for the new joint draw too — write the equivalent test (`districtSimulationProtocol.test.ts` Test 4 analog) asserting this against the core directly.

**Untrusted-input validation boundary** (lines 107-119):
```typescript
export function isSimulationRequest(value: unknown): value is SimulationRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "run") return false;
  ...
}
```
Add ceilings analogous to `MAX_SIMULATION_DRAWS`/`MAX_SIMULATION_MATCHES` (lines 26-29) for the new request shape (alliances/bracket size bounds).

**Cancellation-is-terminate()-not-a-message** (`simulation.worker.ts` lines 31-36): reuse this contract; `createDistrictSimulationWorker.ts` should mirror `createSimulationWorker.ts`'s unmount-terminate lifecycle contract exactly.

---

### `apps/web/src/lib/api/districtLedger.ts`

**Analog:** `apps/web/src/lib/api/districts.ts`

**Fetch → Zod parse → typed result pattern** (lines 25-98):
```typescript
export async function fetchDistrictArtifact({ districtKey, year }: FetchDistrictArtifactParams): Promise<DistrictArtifact> {
  const key = districtDetailKey(districtKey);
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError(`district ${districtKey}`, year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = DistrictArtifactSchema.parse(body);
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError(`district ${districtKey}`, year, err);
  }
}

export function districtQueryOptions(params: FetchDistrictArtifactParams) {
  return {
    queryKey: ["district", params.districtKey] as const,
    queryFn: () => fetchDistrictArtifact(params),
  };
}
```
If the district ledger reads the existing `DistrictArtifact` (extended, no new fetcher needed) this file needs no changes beyond the schema extension flowing through automatically. If a sidecar is chosen (baked pmfs), add a parallel fetcher function following this exact shape, plus lazy per-event-artifact loading hooks (new) modeled on `apps/web/src/lib/api/event.ts`'s fetcher for loading "only the event artifacts it needs" (CONTEXT.md, Claude's Discretion) — read `event.ts` if planner needs the event-artifact-loading shape.

**60s live-poll gate**: `liveEvent.ts` rules (referenced in CONTEXT.md) govern the `refetchInterval` gating for TanStack Query on this same 60s floor while any district event is current — reuse rather than reinvent.

---

### `apps/web/src/components/methodology/districtLedgerContent.ts` (awards + selection model methodology copy)

**Analog:** `apps/web/src/components/methodology/awardsContent.ts`

**Content-as-data + runtime voice gate pattern** (lines 1-60):
```typescript
export const AWARDS_PAGE_TITLE = "Predicting awards";
export const AWARDS_LEAD = "SigmaScout tested whether FRC awards can be predicted. ...";
export const AWARDS_SECTION_IDS = ["the-goal", "the-model", "our-results"] as const;
export interface AwardsTable {
  readonly caption?: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
```
Voice rules (lines 14-21) are binding: no dash characters anywhere (not hyphen/en dash/em dash — "no matter what" not "regardless—"), flat third-person, no explanatory "how/why" sentences unless essential. The voice gate runs at runtime over exported string VALUES via a test, not a source grep — write the equivalent test for the new content module. Every number stated must trace to a committed script's output (line 25: "EVERY NUMBER HERE TRACES TO COMMITTED CODE") — here, `pnpm measure:award-base-rates` (new script) output and the selection model's measured agreement rate against `event_alliances`.

---

## Shared Patterns

### Walk-forward / no-lookahead discipline
**Source:** `scripts/measureAwardPredictability.ts` lines 27-40, 293-320 (`selectPriorInstances`, `buildPriorHistory`)
**Apply to:** the new award base-rate script, and any selection-model parameter fit against `event_alliances`.
```typescript
export function selectPriorInstances(
  instances: readonly AwardInstance[],
  beforeYear: number
): AwardInstance[] {
  return instances.filter((i) => i.year < beforeYear);
}
```

### Honest null / never-guess discipline
**Source:** `packages/core/districts/pointModel.ts` lines 42-50 (`UnknownDistrictSeasonError`), `packages/core/districts/locks.ts` lines 96-103 (`slots: null` → `"unknown"` status, never a guessed capacity)
**Apply to:** every new schema field and every new season-keyed table — throw a typed error for an unregistered season/district rather than defaulting silently.

### Schema-version discipline (additive vs breaking)
**Source:** `packages/harness/pageArtifacts.ts`, `PAGE_ARTIFACT_SCHEMA_VERSION` doc-comment convention repeated at ~10 sites
**Apply to:** every new field on `DistrictTeamEventPointsSchema`/`DistrictArtifactSchema` — comment each addition explaining why the version is or is not bumped, per the file's own established pattern and CONTEXT.md's process rule.

### Zero-conversion structured-clone across the Worker boundary
**Source:** `apps/web/src/workers/simulationProtocol.ts` lines 60-97 (`Map<string, Int32Array>`, no rng functions crossing `postMessage`)
**Apply to:** the district joint-draw result shape and request shape.

### Token-only colour, dataviz palette validator
**Source:** CONTEXT.md process rules; `DistrictLocksTab.tsx` lines 93-103 (`STATUS_CHIP_MODIFIER` + CSS custom-property-backed classes, no literal hex)
**Apply to:** the new "Locked out" red status chip and every other new colour use on the ledger tab. Run the dataviz palette validator before adding any new palette entry.

## No Analog Found

None — every file in scope has a close, recently-modified analog in the codebase (see table above). The one genuinely new concept — a joint qual+selection+playoff Monte Carlo draw producing correlated per-category histograms — is still built by composing two existing analogs (`rankSimulation.ts`'s draw/validate/accumulate structure plus `simulationProtocol.ts`'s chunked-progress Worker orchestration), so no file lacks a pattern to start from.

## Metadata

**Analog search scope:** `packages/core/districts/`, `packages/core/algorithms/simulation/`, `packages/harness/`, `apps/worker/src/`, `apps/web/src/components/districts/`, `apps/web/src/workers/`, `apps/web/src/lib/api/`, `apps/web/src/components/methodology/`, `scripts/`
**Files scanned:** ~30 (globbed), 9 read in full or substantial part
**Pattern extraction date:** 2026-09-25
