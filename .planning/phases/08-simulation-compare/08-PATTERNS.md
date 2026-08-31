# Phase 8: Simulation & Compare - Pattern Map

**Mapped:** 2026-08-30
**Files analyzed:** 14 new/modified files (per CONTEXT.md/RESEARCH.md's explicit + implied file list)
**Analogs found:** 12 / 14 (2 have no analog — first-of-kind, flagged below)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/lib/searchParams.ts` (`EVENT_TABS` edit) | config (const array + enum) | request-response | same file, existing `EVENT_TABS` tuple | exact (self-edit) |
| `apps/web/src/routes/event.$eventKey.tsx` (add 6th tab) | route/controller | request-response | same file's existing `elims`/`alliances` tab wiring | exact (self-edit) |
| `apps/web/src/components/event/SimulationTab.tsx` (new) | component | request-response + event-driven (Worker messages) | `apps/web/src/components/event/ElimsTab.tsx` | role-match (tab-panel shape); no Worker analog exists |
| `apps/web/src/workers/simulation.worker.ts` (new) | worker/service | event-driven (postMessage) | **none in this repo** | no analog — first Web Worker, confirmed absent |
| `packages/core/algorithms/simulation/rankSimulation.ts` (new) | utility (pure leaf module) | transform/batch | `packages/core/algorithms/sigma1/rp/constants.ts` (structural analog: leaf module under `packages/core/algorithms/`, browser-safe) + `packages/core/algorithms/sigma1/rp/distribution.ts` (Monte Carlo loop shape) | role-match |
| `apps/web/src/lib/simQuantile.ts` (new) | utility | transform | sketch source `continuousQuantile()` (not app code — a design-skill reference implementation to port verbatim) | exact (port target named by UI-SPEC) |
| `apps/web/src/lib/simAxis.ts` (new) | config (geometry constants) | transform | `apps/web/src/components/team/matchAxis.ts` | exact |
| `apps/web/src/routes/compare.tsx` (replaced wholesale) | route/controller | request-response | `apps/web/src/routes/event.$eventKey.tsx` (query wiring, pending/error/populated branch order) | role-match |
| `apps/web/src/components/compare/AccuracyTable.tsx` (new, name TBD) | component | request-response | `apps/web/src/components/event/ElimsTab.tsx` (table-shaped tab content) | role-match |
| `apps/web/src/components/compare/CalibrationChart.tsx` (new, name TBD) | component (Recharts) | request-response | `apps/web/src/components/team/MetricHistoryChart.tsx` | exact (only Recharts chart in the app) |
| `apps/web/src/routes/compare.test.tsx` (new) | test | request-response | `apps/web/src/routes/event.$eventKey.test.tsx` | exact |
| `packages/harness/pageArtifacts.ts` (`EventMatchSchema` edit) | model/schema | CRUD (schema validation) | same file's `EventUpcomingMatchSchema` (lines ~351-380) | exact (mirror target named by D-03) |
| `packages/harness/publish.ts` (`buildEventArtifact`'s `matches` row builder edit) | service (assembly function) | batch/transform | same file's `upcoming` row builder (lines 538-560) | exact (2-line mirror, verified) |
| `scripts/measureRewindGap.ts` (new, D-02) | utility (one-off script) | batch | `scripts/replayRig.ts` (category analog, not read this session — named by RESEARCH as the sibling one-off measurement script) | role-match, no analog read (out of Read budget; RESEARCH.md Pattern 6 already gives the full recipe from primitives) |

## Pattern Assignments

### `apps/web/src/lib/searchParams.ts` — `EVENT_TABS` edit

**Analog:** same file, current state (verified live, lines 221-257).

Current array and its doc comment:
```typescript
export const EVENT_TABS = ["insights", "breakdown", "quals", "alliances", "elims"] as const;
export const DEFAULT_EVENT_TAB = "insights";
```
**Change required:** add `"simulation"` as the sixth (and last) element. `DEFAULT_EVENT_TAB` stays `"insights"` — do not touch it. `EventSearchSchema`'s `tab: z.enum(EVENT_TABS).catch(DEFAULT_EVENT_TAB)` needs no other change; the enum widens automatically from the `as const` tuple.

### `apps/web/src/routes/event.$eventKey.tsx` — 6th tab registration

**Analog:** same file's existing 5-tab wiring (verified live, lines 1-43, 118-350).

**Imports pattern** (lines 1-17) — every tab component is imported by name alongside its `*Skeleton` sibling:
```typescript
import { ElimsTab, ElimsTabSkeleton } from "../components/event/ElimsTab.js";
```
Add: `import { SimulationTab, SimulationTabSkeleton } from "../components/event/SimulationTab.js";`

**Registration array** (line 43) — grows by one, appended last (matching D-04/CONTEXT's expected ordering, "sixth, after Elims"):
```typescript
const REGISTERED_EVENT_TABS: readonly EventTab[] = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"];
```

**Plain-disabled tab pattern (D-04 reuses D-17 verbatim)** — the exact code to copy, verified live (lines 314-328):
```typescript
{/*
  D-17: `disabled` alone is the whole treatment — no title, no
  accessible-description reference, no icon, no badge, no custom
  class. `apps/web/src/components/ui/tabs.tsx` already removes
  pointer events and halves opacity for a disabled trigger; Radix
  supplies the disabled semantics. The Copywriting Contract's own
  row for this element reads that there is no copy at all.
*/}
<TabsTrigger
  value="alliances"
  disabled={isAlliancesDisabled}
  className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]"
>
  Alliances
</TabsTrigger>
```
For Simulation, the disabled boolean is `algorithmId !== "vpr"` (D-04: VPR-only) rather than a data-shape check like `isAlliancesDisabled` — a plain derived boolean from the `algorithm` search param already in scope in `EventPage`, not a query-derived one. **Do not gate it on query state** the way `isAlliancesDisabled` is gated (that gating exists specifically to avoid asserting a claim about unresolved/placeholder data — the VPR-only rule needs no such gate, since it depends only on the already-resolved `algorithm` param).

`resolveActiveTab` (lines 55-59) needs a matching branch:
```typescript
if (tab === "alliances" && isAlliancesDisabled) return DEFAULT_EVENT_TAB;
```
→ add `if (tab === "simulation" && isSimulationDisabled) return DEFAULT_EVENT_TAB;`

**Per-tab render-content function pattern** (lines 219-231, 246-258) — every tab follows this exact shape, calling the shared `renderTabState` helper:
```typescript
function renderElimsContent() {
  return renderTabState({
    is404, error, isPending, data, eventKey, season,
    onRetry: () => void refetch(),
    renderPending: () => <ElimsTabSkeleton />,
    renderPopulated: (artifact) => <ElimsTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
  });
}
```
Copy verbatim for `renderSimulationContent`, swapping in `SimulationTab`/`SimulationTabSkeleton`. Add the matching `<TabsContent value="simulation" data-testid="simulation-panel" ...>{renderSimulationContent()}</TabsContent>` beside the other five (line ~346-348 region).

### `apps/web/src/components/event/SimulationTab.tsx` (new)

**Analog:** `apps/web/src/components/event/ElimsTab.tsx` (verified live, full file, 93 lines) — for the tab-panel shape only (props interface, `Skeleton` export, `EmptyState` branch), **not** for its content, which is unrelated (a match table vs. a Worker-driven simulation).

**Props interface pattern** (lines 33-37):
```typescript
export interface ElimsTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}
```
Mirror this shape for `SimulationTabProps`.

**Skeleton export pattern** (lines 39-53) — a named `*Skeleton` component with no props, matching the panel's own footprint so pending/populated states don't jump:
```typescript
export function ElimsTabSkeleton() {
  return (
    <div data-testid="elims-table-scroll" className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <EventMatchTableSkeleton rowCount={ELIMS_SKELETON_ROW_COUNT} />
    </div>
  );
}
```

**Empty-state branch pattern** (lines 78-85):
```typescript
export function ElimsTab({ artifact, season }: ElimsTabProps) {
  const rows = useMemo(() => mergeEventMatches(artifact.matches, artifact.upcoming, isElimCompLevel), [artifact]);
  if (rows.length === 0) {
    const eventName = artifact.name ?? artifact.eventKey;
    return <EmptyState heading={`No matches found for ${eventName}`} body={QUALS_EMPTY_STATE_BODY} />;
  }
  return ( /* populated */ );
}
```
`SimulationTab` needs the UI-SPEC's own empty-state copy ("No qualification matches to simulate") in the same branch position, gated on zero `qm` rows.

**Worker lifecycle — no analog in this repo; RESEARCH.md's own guidance is the pattern to follow instead:**
- Construct the `Worker` lazily, inside the "Run simulation" button's click handler — never at module scope or on mount (Pitfall 1: a component test that never clicks Run must never need a `Worker` mock).
- Call `worker.terminate()` in a `useEffect` cleanup on unmount (security/DoS note in RESEARCH.md's Security Domain section).
- Type the worker file's `self`/`postMessage`/`onmessage` surface with small local interfaces — do NOT add `"WebWorker"` to `apps/web/tsconfig.json`'s shared `lib` array (Pitfall 2: conflicts with the existing `DOM` lib project-wide).

### `apps/web/src/workers/simulation.worker.ts` (new) — NO ANALOG

Confirmed absent: `apps/web` has no Web Worker today (08-CONTEXT.md D-07, independently re-confirmed by RESEARCH.md's search). This is real new-pattern work, not a copy job. Use RESEARCH.md's own worked example (Architecture Patterns, "System Architecture Diagram" + Pattern 2/3) as the only available reference:
- Message-in: `{ startMatchIndex, matches subset, baselines }`.
- Message-out: progress messages every N draws, then a final result message.
- The Worker body should be thin — `onmessage` → call `simulateRanks()` from `packages/core/algorithms/simulation/rankSimulation.ts` → `postMessage(result)`. All real math lives in the pure leaf module below, not in the worker file itself.

### `packages/core/algorithms/simulation/rankSimulation.ts` (new)

**Analog:** `packages/core/algorithms/sigma1/rp/constants.ts` (structural precedent: a leaf module directly under `packages/core/algorithms/`, checked by `browserSafeSchemas.test.ts` for Node-builtin imports only, importable from both Node and browser) + `packages/core/algorithms/sigma1/rp/distribution.ts` (the Monte Carlo per-draw loop shape — NOT importable directly, since it pulls in `ml-matrix` at module scope; copy the *shape* of its loop, never its import).

**Required test-registry entry, verified live** (`packages/harness/browserSafeSchemas.test.ts` lines 43-46, 150-157):
```typescript
const RP_CONSTANTS_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "sigma1", "rp", "constants.ts");
// ...
it("never reaches a Node built-in import from packages/core/algorithms/sigma1/rp/constants.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/algorithms/, plan 06.1-08 Task 3, G-06.1-26)", () => {
  const { nodeBuiltinViolations, visited } = scan([RP_CONSTANTS_ENTRY_POINT]);
  expect(visited.has(RP_CONSTANTS_ENTRY_POINT)).toBe(true);
  if (nodeBuiltinViolations.length > 0) {
    const detail = nodeBuiltinViolations.map((v) => `${v.file} imports "${v.specifier}"`).join("; ");
    expect.fail(`Node built-in import(s) reachable from packages/core/algorithms/sigma1/rp/constants.ts: ${detail}`);
  }
});
```
**Planner obligation (RESEARCH.md, binding):** add a sixth entry-point constant (e.g. `RANK_SIMULATION_ENTRY_POINT = resolve(HERE, "..", "core", "algorithms", "simulation", "rankSimulation.ts")`) and a mirrored `it(...)` block, exactly this shape, for the new module.

**Core simulation shape** — RESEARCH.md's own worked implementation (Code Examples section) is the concrete pattern to build from; it already follows this repo's typed-array-accumulator convention (`Int32Array`/`Float64Array`, no per-draw allocations) seen elsewhere in `rp/distribution.ts`'s own Monte Carlo loop. Do not re-derive `drawCategorical`/`mulberry32` — copy `mulberry32` verbatim a third time (already a 2x-copied convention in this repo per RESEARCH's "Don't Hand-Roll" table: `packages/harness/identifiability.ts` and `rp/distribution.ts` both carry it).

### `apps/web/src/lib/simQuantile.ts` (new)

**Analog:** not app code — the sketch source at `.claude/skills/sketch-findings-sigmascout/sources/005-rank-distribution/index.html:149-162`, named explicitly by UI-SPEC as the port target. Port verbatim (RESEARCH.md's Pattern 3 already reproduces the exact function body); do not reimplement the R type-7 estimator from scratch — sketch 005 measured and fixed real defects in this exact math, and a fresh implementation risks reintroducing them.

### `apps/web/src/lib/simAxis.ts` (new)

**Analog:** `apps/web/src/components/team/matchAxis.ts` — UI-SPEC's own Spacing Scale section states this explicitly ("mirroring `matchAxis.ts`'s own 'every derived position comes from one computed source' discipline") and even reuses `PLOT_W = 470` verbatim from that file. Follow `matchAxis.ts`'s convention of one `x(value, ...)` pure function that all rendering derives positions from — never a second hand-tuned position computed elsewhere.

### `apps/web/src/routes/compare.tsx` (replaced wholesale)

**Analog:** `apps/web/src/routes/event.$eventKey.tsx` for the query-wiring and branch-order convention (verified live, lines 118-244) — NOT for the tab strip (Compare has no tabs).

**Query pattern to copy** (lines 130-135):
```typescript
const { data, isPending, error, refetch, isPlaceholderData } = useQuery({
  ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
  enabled: isValidKey && version !== undefined,
  placeholderData: keepPreviousData,
});
```
Compare needs 5 such queries (one per season, 2022-2026) or one query fetching all 5 `v1/compare/{year}.json` files — RESEARCH.md's Compare page data shape section confirms these are already-published, independent per-year files; the planner should decide fan-out vs. sequential based on `eventQueryOptions`-style `queryOptions` helper conventions already used elsewhere (not reproduced here — see `apps/web/src/lib/api/event.js`, not read this session, for the exact `queryOptions` factory shape to mirror per-year).

**Branch-order pattern to copy** (`renderTabState`, lines 77-116) — 404/error/pending/populated in that fixed order — is the same order the Compare page's own error/loading/populated states should follow (per D-10/UI-SPEC's canonical Error-state pattern), even though Compare has no per-tab branching, just one page-level branch.

**Artifact fetch, built through `artifactUrl()`:**
```typescript
import { artifactUrl } from "../lib/artifactOrigin.js";
// artifactUrl(`v1/compare/${year}.json`)
```
`artifactOrigin.ts` (verified live, full file) is the ONLY place a host string may appear — every fetcher, including Compare's new one, must build its URL through `artifactUrl()`, never a literal `https://data.sigmascout.org` string of its own.

### `apps/web/src/components/compare/AccuracyTable.tsx` (new)

**Analog:** `apps/web/src/components/event/ElimsTab.tsx`'s table-shaped-panel structure (props interface + populated/empty branches) — role-match only; the actual column/bolding logic (D-11's near-tie rule) has no analog anywhere in this codebase and must be built fresh per UI-SPEC's exact worked arithmetic (rounded-display tie for Brier; naive-combined-SE tie for Winner Accuracy).

### `apps/web/src/components/compare/CalibrationChart.tsx` (new)

**Analog:** `apps/web/src/components/team/MetricHistoryChart.tsx` (verified live, lines 1-90) — this is the ONLY Recharts chart in the entire app, so it is the load-bearing pattern for every Recharts convention this phase's chart must follow:

**Import pattern** (lines 23-27):
```typescript
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, XAxis, YAxis } from "recharts";
```
For Compare's calibration chart, swap `ComposedChart`/`Area` for a plain `LineChart` (3 series + 1 dashed reference line, no band) per UI-SPEC's Compare Page Contract.

**Critical sizing pattern — do not use `ResponsiveContainer`** (doc comment, lines 13-21):
```
Sizing: NOT `ResponsiveContainer` — Recharts' own `ResizeObserver`-driven
auto-sizing never resolves under jsdom (this repo's stubbed
`ResizeObserver` never calls back, per `src/test/setup.ts`'s own comment)
... a `useLayoutEffect` reads the container's real width where one exists
(a real browser) and falls back to `DEFAULT_CHART_WIDTH` where one does
not (jsdom always measures 0)
```
This is a load-bearing, test-environment-driven constraint — copy the `useLayoutEffect` + `DEFAULT_CHART_WIDTH` fallback pattern (lines 23, 45) verbatim in shape for the calibration chart, or its component test will render a zero-width chart under jsdom.

**Dynamic-import-to-keep-Recharts-out-of-eager-bundle pattern** (doc comment line 3-4): `MetricHistoryTab.tsx` dynamically `import()`s the chart module so Recharts stays out of the eager bundle (D-14, Phase 6). The Compare page should follow the same convention for its calibration chart if bundle-size discipline from that prior decision still applies (not explicitly re-stated by 08-CONTEXT.md/UI-SPEC, but it is this repo's only precedent for how a Recharts-bearing component is loaded).

**Coupled-geometry axis pattern** (lines 49-87, `computeYAxisWidth`/`formatYAxisTick`): axis tick strings and axis width are derived from ONE shared domain-values source, never independently hand-tuned — apply the same discipline to the calibration chart's x/y axes and its sparse-bin point-radius scaling (chart-craft.md's binding rule, restated by UI-SPEC for this exact chart).

### `apps/web/src/routes/compare.test.tsx` (new) — D-10 parity test

**Analog:** `apps/web/src/routes/event.$eventKey.test.tsx` (verified live, lines 1-90) — the established route-level component-test convention.

**Route-tree construction pattern** (lines 69-85), copy verbatim in shape:
```typescript
function renderEventRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const eventRoute = EventRouteImport.update({
    id: "/event/$eventKey",
    path: "/event/$eventKey",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([eventRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
```
For `/compare`, swap `EventRouteImport`/`id`/`path` for the real exported `Route` from `compare.tsx` — same "test the REAL exported Route object, not a re-implementation" discipline the doc comment states (lines 1-9).

**Fetch-mocking pattern** (lines 46-67): build a fixture-returning `Response` via `new Response(JSON.stringify(...), { status: 200 })`, assigned to `global.fetch = vi.fn(...)`. **Departure from this existing convention, per D-10:** Compare's fixture must be the REAL committed bytes of a published `v1/compare/{year}.json` (fetched once from `https://data.sigmascout.org/v1/compare/2026.json` and committed under a new `__fixtures__/` directory), not a hand-typed inline object literal like `eventArtifactResponse()` above. This is confirmed as the first committed-JSON-fixture test in `apps/web` — no other `*.test.tsx` file in this repo does this (RESEARCH.md Pattern 7, verified by search).

**Assertion discipline (D-10's whole point):** every assertion must derive its expected value FROM the fixture object at test-run time (e.g. `compareFixture.slices.find(...).brierScore.toFixed(4)`), never a second hand-typed literal — that is what makes this a parity proof rather than an assertion that can silently drift from the fixture.

### `packages/harness/pageArtifacts.ts` — `EventMatchSchema` edit (D-03)

**Analog:** same file's `EventUpcomingMatchSchema` (lines ~351-380, per RESEARCH.md Pattern 4, verified live) — the exact two optional fields plus their `.refine(isValidPmf, ...)` pair already exist there and must be copied onto `EventMatchSchema`.

**Required schema-shape change:** `EventMatchSchema` is currently a bare `z.object({...})`; it needs the same two optional fields (`redRpPmf`/`blueRpPmf`) that `EventUpcomingMatchSchema` already carries, plus the same `.refine(isValidPmf, ...)` calls, converting it from a bare object schema to a `.refine()`-chained schema — the same shape `EventUpcomingMatchSchema` and `TeamSeasonMatchSchema` already use.

**D-12 addition, same republish:** `actualRedRp`/`actualBlueRp` mirror onto `EventMatchSchema` from `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp` (verified live at `pageArtifacts.ts:516-518`) — `actualRedRp` is `.nullable()` (D-12: `null` means "not derivable," never coerced to `0`).

### `packages/harness/publish.ts` — `buildEventArtifact`'s `matches` builder edit (D-03)

**Analog:** same file's `upcoming` row builder, immediately below the `matches` builder (verified live, lines 538-560).

**The exact 2-line mirror, verified live** — `matches` builder (lines 496-536) currently ends at `actualBlueScore: match.blueScore,` (line 535) with no pmf fields; `upcoming` builder (lines 558-559) already has:
```typescript
redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
```
Add these two lines to the `matches` map's return object (after line 535), using the exact same `prediction` variable already in scope in that closure. No new computation — `prediction.redRpPmf`/`prediction.blueRpPmf` already exist on every `predict()` call, played or unplayed.

**Rounding:** reuse `ROUNDING_RULE.pmf` (= `5`, verified live in `packages/harness/rounding.ts` lines 32-35, 96-101) via the existing `roundPmf()` function (lines 191-217) — no new `ROUNDING_RULE` entry needed. The file's own header comment already names "Phase 8 draws ranking points from these repeatedly across a 1000-run simulation" as the reason for this rule's 5-decimal precision — it was written anticipating this exact field.

## Shared Patterns

### Plain-disabled tab treatment (D-04/D-17)
**Source:** `apps/web/src/routes/event.$eventKey.tsx` lines 314-328 (verified live, reproduced in full above under the route-file pattern assignment).
**Apply to:** the `simulation` `TabsTrigger`, gated on `algorithmId !== "vpr"` rather than a query-derived boolean.

### Artifact fetch via `artifactUrl()`
**Source:** `apps/web/src/lib/artifactOrigin.ts` (verified live, full file, 20 lines).
**Apply to:** every new fetcher this phase — the Compare page's 5 per-year artifact fetches, and the D-10 test fixture's original one-time download.

### Route-level component test convention
**Source:** `apps/web/src/routes/event.$eventKey.test.tsx` lines 69-85 (route-tree construction) + lines 46-67 (fetch mocking via `global.fetch = vi.fn(...)` returning `new Response(...)`).
**Apply to:** `compare.test.tsx`, with the one documented departure (real committed fixture bytes instead of an inline literal, per D-10).

### Rounding only at the publish boundary
**Source:** `packages/harness/rounding.ts`'s `ROUNDING_RULE` table and `roundPmf()`.
**Apply to:** `publish.ts`'s edited `matches` row builder (D-03) — reuse `ROUNDING_RULE.pmf` unchanged; do not add a new rule or round anywhere else in the pipeline.

### Browser-safe leaf module registration
**Source:** `packages/harness/browserSafeSchemas.test.ts` lines 43-46, 150-157 (`RP_CONSTANTS_ENTRY_POINT` pattern).
**Apply to:** the new `packages/core/algorithms/simulation/rankSimulation.ts` — add a sixth entry-point constant and a mirrored `it(...)` block checking only for Node-builtin imports (not the broader "never reaches `packages/core/algorithms/`" rule, which applies only to the two original schema entry points).

### Recharts jsdom-safe sizing
**Source:** `apps/web/src/components/team/MetricHistoryChart.tsx` lines 13-21, 23, 45 (`useLayoutEffect` + `DEFAULT_CHART_WIDTH` fallback, never `ResponsiveContainer`).
**Apply to:** the Compare page's calibration `LineChart` component.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/web/src/workers/simulation.worker.ts` | worker | event-driven (postMessage) | `apps/web` has zero Web Workers today (08-CONTEXT.md D-07, independently re-confirmed live this session) — this is the app's first. RESEARCH.md's own Architecture Patterns/Code Examples sections are the only available reference; there is no in-repo file to copy from. Planner should budget this as genuinely new infrastructure work, including the Vite `new Worker(new URL(...), { type: "module" })` bundling setup and the hand-rolled mock `Worker` test class (RESEARCH.md's "Don't Hand-Roll" table, Pitfall 1). |
| `scripts/measureRewindGap.ts` | utility/script | batch | No existing script produces a frozen-prediction set (every existing harness entry point predicts-then-updates). RESEARCH.md's Pattern 6 already supplies the full recipe built from four existing exported primitives (`buildSeasonStream`, `WalkForwardSimulator.runAll`, `selectMatchesChronological`, `algorithm.predict()` called without `update()`) — treat that recipe as the spec, since no single existing file demonstrates the "frozen, never updated" call pattern end to end. |

## Metadata

**Analog search scope:** `apps/web/src/routes/`, `apps/web/src/components/event/`, `apps/web/src/components/team/`, `apps/web/src/lib/`, `packages/harness/`, `packages/core/algorithms/`
**Files scanned/read live this session:** `08-CONTEXT.md`, `08-RESEARCH.md`, `08-UI-SPEC.md`, `searchParams.ts`, `event.$eventKey.tsx`, `event.$eventKey.test.tsx`, `compare.tsx`, `artifactOrigin.ts`, `ElimsTab.tsx`, `MetricHistoryChart.tsx`, `publish.ts` (targeted ranges), `rounding.ts` (targeted ranges), `browserSafeSchemas.test.ts` (targeted ranges)
**Pattern extraction date:** 2026-08-30
