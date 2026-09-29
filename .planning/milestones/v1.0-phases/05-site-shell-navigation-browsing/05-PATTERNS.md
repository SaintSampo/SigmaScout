# Phase 5: Site Shell — Navigation & Browsing - Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 24 (scaffolding + shell + Teams/Events browsing surfaces)
**Analogs found:** 13 structural / cross-cutting analogs / 11 marked NEW (no analog exists in this repo)

**Critical correction to RESEARCH.md Assumption A5:** `packages/harness` and `packages/core` have **no `package.json`** — they are NOT pnpm workspace members with an importable package name. Every existing consumer (`apps/worker/src/*.ts`) imports them via **relative deep paths with an explicit `.js` extension** (NodeNext resolution), e.g.:

```typescript
// apps/worker/src/artifactWriter.ts:26
} from "../../../packages/harness/pageArtifacts.js";

// apps/worker/src/liveWindows.ts:35
import { AlgorithmsManifestSchema, LiveWindowsManifestSchema, isLiveAt, ... } from "../../../packages/harness/manifestSchemas.js";

// apps/worker/src/bundleSmoke.ts:28-33
import { opr } from "../../../packages/core/algorithms/opr.js";
import type { MatchResult, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
```

There is **no `@sigmascout/harness` import path anywhere in this repo.** RESEARCH.md's Code Examples section used `@sigmascout/harness/pageArtifacts` as an *illustrative* path only — do not copy it literally. `apps/web/src/lib/api/*.ts` must import with the same relative-deep-path + `.js`-extension convention as `apps/worker/src/*.ts` does, adjusted for `apps/web/src/lib/api/`'s own depth from repo root (`../../../../packages/harness/pageArtifacts.js`). Confirm the exact relative depth at scaffold time once the real file exists. Vite/Vitest under `moduleResolution: "bundler"` may tolerate omitting `.js`, but matching the existing convention exactly (including the extension) is the safer default and keeps `tsc --noEmit` consistent with the rest of the repo.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/package.json` | config | — | `apps/worker/package.json` | exact (structural) |
| `apps/web/tsconfig.json` | config | — | `apps/worker/tsconfig.json` | exact (structural) |
| `apps/web/vitest.config.ts` | config | — | root `vitest.config.ts` | role-match (must diverge: `environment: "jsdom"`) |
| `pnpm-workspace.yaml` (modify: none needed, already globs `apps/*`) | config | — | itself | exact — no edit required, confirm only |
| `src/lib/api/teams.ts` | service (fetcher) | request-response | `apps/worker/src/liveWindows.ts` (`loadLiveWindowsManifest`/`readManifestText`/`parseManifest`) | role-match |
| `src/lib/api/events.ts` | service (fetcher) | request-response | `apps/worker/src/liveWindows.ts` (same) | role-match |
| `src/lib/api/manifests.ts` | service (fetcher) | request-response | `apps/worker/src/liveWindows.ts` | role-match |
| `src/lib/resolveSortKey.ts` | utility | transform | `packages/core/algorithms/opr.ts` / `epa.ts` / `sigma1/index.ts` (`teamMetrics()`) — read for the real key sets, not copied as fetch/error code | role-match (data source only) |
| `src/lib/search-index.ts` | utility | transform | none — NEW, no matching-predicate code exists in repo | NEW |
| `src/routes/__root.tsx` | route/provider | request-response | none — first TanStack Router root route in repo | NEW |
| `src/routes/teams.tsx` | route | request-response | none — first TanStack Router route in repo | NEW |
| `src/routes/events.tsx` | route | request-response | none | NEW |
| `src/routes/compare.tsx` (placeholder) | route | request-response | none | NEW |
| `src/components/ribbon/*.tsx` | component | request-response | none — first React component in repo | NEW |
| `src/components/teams-table/TeamsTable.tsx` | component | CRUD (client-local sort/filter) | none — first virtualized table in repo | NEW |
| `src/components/events-list/EventsList.tsx` | component | CRUD (client-local filter) | none | NEW |
| `src/components/search/SearchBox.tsx` | component | request-response | none | NEW |
| `src/stores/filterSheet.ts` | store (Zustand) | event-driven | none — first Zustand store in repo | NEW |
| `src/styles/theme.css` | config (design tokens) | — | none — first Tailwind v4 `@theme` block in repo | NEW |
| `src/lib/query-client.ts` | config | — | none — first TanStack Query client in repo | NEW |
| `vite.config.ts` (apps/web) | config | — | `apps/worker/wrangler.toml` (sibling app config, different tool) | partial — different build tool family, structure only |
| `packages/harness/pageArtifacts.ts` (read-only — schema source, not modified this phase) | model (Zod schema) | — | itself | exact — this IS the analog for client Zod validation |

## Pattern Assignments

### `apps/web/package.json` (config)

**Analog:** `apps/worker/package.json` — read in full:

```json
{
  "name": "worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:fixture": "wrangler deploy --config wrangler.fixture.toml"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.20260822.1",
    "wrangler": "4.125.0"
  }
}
```

**Copy:** `"name"` (use `"web"`, matching the bare `"worker"` convention — not `@sigmascout/web`, since no package in this repo is scoped), `"version": "0.0.0"`, `"private": true`, `"type": "module"`, the `"test": "vitest run"` and `"typecheck": "tsc --noEmit -p tsconfig.json"` script shape. Add `"dev": "vite dev"` / `"build": "vite build"` / `"preview": "vite preview"` in the same slot pattern `apps/worker` uses for its own runtime commands (`dev`/`deploy`).

### `apps/web/tsconfig.json` (config)

**Analog:** `apps/worker/tsconfig.json`, read in full:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Copy:** the `extends: "../../tsconfig.json"` root-relative pattern and the `include` array shape. Diverge deliberately: `types` becomes `["vite/client"]` not `["@cloudflare/workers-types", "node"]`; `compilerOptions` must add `"jsx": "react-jsx"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"moduleResolution": "bundler"` (Vite's own resolution mode, not `NodeNext`) — the root `tsconfig.json`'s `"module": "NodeNext"` / `"moduleResolution": "NodeNext"` are correct for `apps/worker`'s Workers runtime but wrong for a Vite-bundled browser app; `apps/web/tsconfig.json` should override both. `include` should be `["src/**/*.ts", "src/**/*.tsx"]` (no `test/` dir if Vitest co-locates `*.test.tsx` under `src/`).

### `apps/web/vitest.config.ts` (config)

**Analog:** root `vitest.config.ts`, read in full:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: true,
  },
});
```

**Do not rely on this file for `apps/web` component tests.** It already globs `apps/**/*.test.ts` but forces `environment: "node"` (RESEARCH.md Pitfall 5, confirmed by direct read this session). `apps/web/vitest.config.ts` must be its own file: same `defineConfig` shape, `include: ["src/**/*.test.ts", "src/**/*.test.tsx"]`, `environment: "jsdom"`, `globals: false` (match root convention — no implicit globals), `passWithNoTests: true`. `.test.tsx` files under `apps/web/src` will otherwise be picked up twice (once by root's node-env config, once by web's own) unless the root `include` glob is narrowed or `apps/web` is excluded from it — flag this as a planner decision: either narrow root's glob to `apps/{worker}/**` explicitly, or add `exclude` to one config so `apps/web/**` is owned by exactly one Vitest config.

### `src/lib/api/teams.ts`, `events.ts`, `manifests.ts` (service, request-response)

**Analog:** `apps/worker/src/liveWindows.ts` lines 1-77 — this is the only existing "fetch a published artifact/manifest, `.parse()` it, throw a named error on failure" pattern in the repo, even though it reads from KV/R2 bindings rather than `fetch()`. Copy the **shape**, not the binding calls:

```typescript
// apps/worker/src/liveWindows.ts:42-77 — named error classes + parse-or-throw shape
export class ManifestReadError extends Error {
  constructor(name: string, key: string) {
    super(`loadManifests: "${name}" manifest not found at KV or R2 key "${key}" — has the offline publish step run yet?`);
    this.name = "ManifestReadError";
  }
}

export class ManifestValidationError extends Error {
  constructor(name: string, cause: unknown) {
    super(`loadManifests: "${name}" manifest failed schema validation — refusing to use a partially-valid manifest: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ManifestValidationError";
  }
}

function parseManifest<T>(name: string, schema: { parse(input: unknown): T }, text: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ManifestValidationError(name, err);
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    throw new ManifestValidationError(name, err);
  }
}
```

**Apply this shape to the client fetchers:** a named `ArtifactFetchError`/`ArtifactValidationError` pair, `fetch()` → check `res.ok` → `.json()` → `Schema.parse()` inside a try/catch that rethrows as the named validation error — never a bare `throw new Error(...)`. This directly satisfies the UI-SPEC's Teams/Events table `error` state requirement (retry button, named `{resource}` in the copy) and RESEARCH.md's V5 input-validation requirement (validate at the fetch boundary, mirroring the server-side convention).

**Real import target (corrects RESEARCH.md A5):**
```typescript
// packages/harness/pageArtifacts.ts — the real exported names to import
import { TeamsArtifactSchema, EventsArtifactSchema, artifactKey, type TeamsArtifact, type EventsArtifact } from "../../../../packages/harness/pageArtifacts.js";
```
`artifactKey({ page: "teams", year, algorithmId, version })` [pageArtifacts.ts:110-127] builds the exact R2 path (`v1/teams/{year}/{algorithmId}@{version}.json`); do not hand-build the path string.

**Manifest key names to reuse verbatim** (`apps/worker/src/liveWindows.ts:39-40`):
```typescript
export const LIVE_WINDOWS_MANIFEST_KEY = "v1/manifest/live-windows.json";
export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";
```

### `src/lib/resolveSortKey.ts` (utility, transform)

**Analog (data source, not code shape):** the real `teamMetrics()` implementations — read directly this session, exact key sets confirmed:

- **OPR** [packages/core/algorithms/opr.ts:286-299] — publishes **only** `TOTAL_METRIC_KEY` (`"total"`), never a `spread`.
- **EPA** [packages/core/algorithms/epa.ts:513-530] — one entry per `componentMapForSeason(season).components` key **plus** `total`, never `spread`.
- **Sigma1** [packages/core/algorithms/sigma1/index.ts:948-979] — same component-key set as EPA (same `componentMapForSeason` source) **plus `spread`** on every entry including `total`.
- `TOTAL_METRIC_KEY = "total"` [packages/core/algorithms/types.ts:120] — the one key every algorithm guarantees; fallback target.
- Season-dependent component sets [packages/core/algorithms/breakdown/2022.ts:53-58 (5 keys), packages/core/algorithms/breakdown/2026.ts:73-84 (10 keys)] — confirms the key set is per-season, not just per-algorithm (RESEARCH.md Pattern 3's "not named by D-13" finding: the same fallback function must fire on a plain year change too, not only an algorithm switch).

**Implement once, call from both the D-11 (year change) and D-13 (algorithm change) paths** — RESEARCH.md is explicit this must not be two independent implementations.

### `src/components/teams-table/TeamsTable.tsx` (component, CRUD — client-local sort/filter)

**No analog exists in this repo** — first virtualized/pinned table. Do not force-fit an analog. Build directly from UI-SPEC's own composition snippet (05-UI-SPEC.md lines 54-62, RESEARCH.md Pattern 2 lines 344-389) — TanStack Table `columnPinning` + TanStack Virtual `useVirtualizer` sharing **one** native scroll container (`getScrollElement` = the same `<div>` the pinned columns render inside via `position: sticky`). RESEARCH.md's own worked composition example is the closest thing to a pattern this phase has; treat it as the spec, not a codebase analog. **Required first task per RESEARCH.md:** a throwaway single-file spike (~50 fake rows, ~12 fake columns, 3 pinned) proving the pinning+virtualization+touch combination works before the real ~3,750-row build.

### `apps/web/vite.config.ts` (config)

**Analog:** structurally closest is `apps/worker/wrangler.toml` (the sibling app's own build/runtime config file) only in the sense of "each app owns its own build config at its own root" — the tool and shape are unrelated (Vite vs Wrangler). Treat as **NEW**; build directly from RESEARCH.md's confirmed plugin list: `@tailwindcss/vite` + `@tanstack/router-plugin/vite` in the `plugins` array, no `postcss.config.js`/`tailwind.config.js`/`autoprefixer` needed for Tailwind v4.

## Shared Patterns

### Zod validation at the fetch boundary
**Source:** `packages/harness/pageArtifacts.ts` (schema definitions, read in full — `TeamsArtifactSchema` at line 298, `EventsArtifactSchema` at line 353, `TeamMetricSchema` at line 153, `RecordSchema` at line 162) + `apps/worker/src/liveWindows.ts:42-77` (the parse-or-throw shape).
**Apply to:** every file under `src/lib/api/`.
```typescript
// TeamMetricSchema — packages/harness/pageArtifacts.ts:153-156
const TeamMetricSchema = z.object({
  value: z.number(),
  spread: z.number().optional(),
});
// MetricsRecordSchema — component name -> that team's metric, packages/harness/pageArtifacts.ts:159
const MetricsRecordSchema = z.record(z.string(), TeamMetricSchema);
```
Client code must render a bare value with no `±` suffix when `spread` is `undefined` (OPR/EPA rows) — this is a schema-level fact (`spread` is `.optional()`), not a UI guess.

### Named error classes over bare `throw new Error(...)`
**Source:** `packages/harness/pageArtifacts.ts:89-96` (`MissingVersionSeparatorError`) and `apps/worker/src/liveWindows.ts:42-54` (`ManifestReadError`, `ManifestValidationError`).
**Apply to:** all `src/lib/api/*.ts` fetchers — every thrown error in this repo's existing code is a named `class X extends Error` with a `name` field set in the constructor, never an inline `new Error("...")`. Match this convention for `ArtifactFetchError`/`ArtifactValidationError`.

### Relative deep-import convention (no `@sigmascout/*` workspace alias exists)
**Source:** `apps/worker/src/artifactWriter.ts:26`, `apps/worker/src/liveWindows.ts:35`, `apps/worker/src/bundleSmoke.ts:28-33` — confirmed by grep, zero matches for any `@sigmascout/*` import anywhere in the repo.
**Apply to:** every `apps/web` file importing from `packages/harness/*` or `packages/core/*` — use relative paths with explicit `.js` extensions, matching NodeNext-style resolution already used repo-wide. Confirm the exact `../../../` depth at scaffold time (depends on final file location under `apps/web/src/...`).

### `artifactKey()` — never hand-build R2 paths
**Source:** `packages/harness/pageArtifacts.ts:104-127`.
**Apply to:** every fetcher in `src/lib/api/`. `artifactKey({ page: "teams" | "events" | ...  })` is the single source of truth for the URL path segment under `v1/`; hand-building `v1/teams/${year}/${alg}@${version}.json` string literals anywhere in `apps/web` would drift from Phase 4's key scheme the moment it changes.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/routes/__root.tsx`, `src/routes/teams.tsx`, `src/routes/events.tsx`, `src/routes/compare.tsx` | route | request-response | First TanStack Router usage in the repo — no prior route files exist anywhere. Build from RESEARCH.md Pattern 1 (`validateSearch` + Zod, `RootSearchSchema.extend(...)`), not from a codebase analog. |
| `src/components/**/*.tsx` (ribbon, teams-table, events-list, search) | component | request-response / CRUD | First React components in the repo — `apps/web` is the first frontend package. No JSX exists anywhere else in the tree. |
| `src/stores/filterSheet.ts` | store | event-driven | First Zustand usage in the repo. |
| `src/styles/theme.css` | config (design tokens) | — | First Tailwind v4 `@theme` CSS-first config block in the repo — build directly from 05-UI-SPEC.md's Color/Spacing/Typography tables (already transcribed into RESEARCH.md's Code Examples section, lines ~507-533). |
| `src/lib/query-client.ts` | config | — | First TanStack Query client in the repo. |
| `src/lib/search-index.ts` | utility | transform | No existing search/matching predicate code anywhere in the repo (server-side or client-side). Build directly from D-09's rule (`String.prototype.includes()`/`.startsWith()`, never `new RegExp(userInput)` — RESEARCH.md Pitfall 3). |

## Metadata

**Analog search scope:** `apps/worker/src/**`, `apps/worker/*.json|*.toml`, `packages/harness/**`, `packages/core/algorithms/**`, root config files (`package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-workspace.yaml`).
**Files scanned:** ~15 read directly (full or targeted ranges) this session; grep sweep confirmed zero `@sigmascout/*` imports and zero existing React/JSX/TanStack files anywhere in the repo.
**Pattern extraction date:** 2026-08-23
