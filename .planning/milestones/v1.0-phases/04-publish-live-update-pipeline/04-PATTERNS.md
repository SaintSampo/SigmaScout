# Phase 4: Publish & Live Update Pipeline - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 18 (new/modified, drawn from RESEARCH.md's "Recommended Project Structure" + CONTEXT.md decisions)
**Analogs found:** 9 exact/role-match / 18 total (the rest are genuinely NEW — `apps/worker` does not exist yet)

**Repo shape note:** This is a single-`package.json` pnpm workspace (root `package.json` holds all deps; `packages/*` have no per-package manifests, just `.ts` files run via `tsx`). `apps/worker` will be the **first** package with its own `package.json` (Cloudflare Workers require an isolated build/deploy unit) — say so explicitly in the plan rather than copying the no-manifest convention.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/worker/wrangler.toml` | config | event-driven | none in-repo | NEW (conceptual precedent: `packages/corpus/schema.sql` as "the declarative shape a runtime binds to") |
| `apps/worker/package.json` | config | — | root `package.json` | role-match (first per-package manifest in the repo) |
| `apps/worker/src/scheduled.ts` | controller (cron entrypoint) | event-driven | `packages/harness/cli.ts` (`main()`) | role-match |
| `apps/worker/src/liveWindows.ts` | service | request-response (read one manifest object) | `packages/harness/cli.ts`'s `applyPromotedOverrides`/`warnIfNewerPromotedSigma1` (reads one pinned/committed pointer, decides behavior) | role-match |
| `apps/worker/src/tbaPoll.ts` | service (thin wrapper) | request-response | `packages/ingest/tbaClient.ts` | exact (imported, not reimplemented) |
| `apps/worker/src/stateStore.ts` | service (D1 batched read/write) | CRUD | `packages/corpus/db.ts` (`selectMatchesChronological`, upsert helpers) | role-match |
| `apps/worker/migrations/0001_team_state.sql` | migration | CRUD (schema definition) | `packages/corpus/schema.sql` | exact |
| `apps/worker/src/artifactWriter.ts` | service (R2 read/write, path builders) | CRUD / file-I/O | `packages/harness/artifact.ts` (validate-on-write discipline) | role-match |
| `apps/worker/src/subrequestBudget.ts` | utility | transform (bookkeeping) | `packages/ingest/tbaClient.ts`'s `TbaRequestCounter` | role-match |
| `apps/worker/test/scheduled.replay.test.ts` | test | event-driven | `packages/harness/replay.season.test.ts` + `packages/harness/replay.multiAlgorithm.test.ts` | role-match |
| `packages/harness/publish.ts` (NEW) | service (offline precompute → R2/D1 seed) | batch / transform | `packages/harness/cli.ts` (season-loop + `buildArtifact` orchestration) | exact |
| Page-artifact Zod schemas (e.g. `packages/harness/pageArtifacts.ts` or similar, exact filename Claude's discretion) | model / schema | transform | `packages/harness/artifact.ts` (`HarnessArtifactSchema`) | exact |
| Live-windows manifest builder (part of `publish.ts` or its own module) | service | batch | `packages/corpus/db.ts` (event/calendar queries) | role-match |
| D-12 state-snapshot serializer (part of `publish.ts`) | service (serialize per-team state) | file-I/O / batch | `packages/harness/cli.ts`'s `promote.ts`-style version-file writer (`data/algorithm-versions/*.json`) | role-match |
| `docs/publish-budget.md` (D-23 budget doc, exact path Claude's discretion) | config/doc | — | `docs/models/sigma1-tuning-results.md` (measured-numbers-with-provenance doc pattern) | role-match |
| Payload-budget test (D-05) | test | transform (assertion over real artifacts) | `packages/harness/digest.test.ts` / `packages/harness/baselineFingerprint.test.ts` (measures a real artifact against a committed expectation) | exact |
| Replay-equivalence test (D-14) | test | event-driven | `packages/harness/replay.multiAlgorithm.test.ts` | exact |
| `.claude/CLAUDE.md` (edit: reconcile D1 "What NOT to Use" scoping per D-13) | config/doc | — | n/a (doc edit, not a code file) | n/a |

## Pattern Assignments

### `apps/worker/src/tbaPoll.ts` (service, request-response)

**Analog:** `packages/ingest/tbaClient.ts` — reuse wholesale, do not reimplement (D-22).

**Imports/exports to reuse verbatim** (`packages/ingest/tbaClient.ts:26,33-59,71-95,145-152`):
```typescript
export const THROTTLE_INTERVAL_MS = 100;

export class TbaRequestCounter {
  #cacheHits = 0;
  #fresh = 0;
  recordCacheHit(): void { this.#cacheHits++; }
  recordFresh(): void { this.#fresh++; }
  get cacheHits(): number { return this.#cacheHits; }
  get fresh(): number { return this.#fresh; }
  get total(): number { return this.#cacheHits + this.#fresh; }
}

export async function tbaFetch(
  path: string, apiKey: string, cachedEtag: string | undefined, counter?: TbaRequestCounter
): Promise<TbaFetchResult> { /* throttle() then fetch() with If-None-Match */ }

export function fetchEventMatches(ctx: TbaClientContext, eventKey: string, cachedEtag?: string) {
  return tbaFetch(`/event/${eventKey}/matches`, ctx.apiKey, cachedEtag, ctx.counter);
}
```

**Worker-specific wrapper shape:** `tbaPoll.ts` imports `tbaFetch`/`fetchEventMatches`/`TbaRequestCounter` from `packages/ingest/tbaClient.ts` unchanged and adds only what's Worker-specific: reading `env.TBA_API_KEY` (Cloudflare secret, set via `wrangler secret put`, D-27) and mapping the per-tick set of live event keys to calls. **Never** copy-paste the throttle/ETag logic — `packages/ingest/tbaClient.ts` has no Node-only imports (no `fs`, no `better-sqlite3`) so it already satisfies `packages/core/isomorphic.test.ts`'s constraint and is directly importable by `apps/worker`.

**Error handling pattern** (`tbaClient.ts:90-91`):
```typescript
if (!res.ok) {
  throw new Error(`TBA request failed: ${path} -> HTTP ${res.status}`);
}
```
Apply the same throw-on-non-ok/non-304 discipline; the Worker's `scheduled()` should catch this per-event so one failing event does not abort the whole tick (mirrors D-15's bounded-delay-never-omission requirement).

---

### `apps/worker/src/scheduled.ts` (controller, event-driven)

**Analog:** `packages/harness/cli.ts`'s `main()` orchestration shape — read args/config, resolve algorithms via `ALGORITHMS`/`applyPromotedOverrides`, run the loop, write output. No direct code to copy (this is a new runtime, `ScheduledController`/`Env` types from `@cloudflare/workers-types`), but the **orchestration discipline** carries over:

**Promoted-version resolution pattern** (`packages/harness/cli.ts:100,124,193,252-260`):
```typescript
export const ALGORITHMS: Record<string, AlgorithmModule<any>> = { /* ...7 entries... */ };

const PROMOTED_SIGMA1_VERSION_PATH = join("data", "algorithm-versions", "sigma1@2.0.0+tuned-2026-08.json");

export function applyPromotedOverrides(algorithms: AlgorithmModule<any>[]): AlgorithmModule<any>[] {
  return algorithms.map((algorithm) => {
    if (algorithm.id === "sigma1") {
      warnIfNewerPromotedSigma1(ALGORITHM_VERSIONS_DIR, PROMOTED_SIGMA1_VERSION_PATH);
      return loadPromotedSigma1("sigma1", PROMOTED_SIGMA1_VERSION_PATH) ?? algorithm;
    }
    return algorithm;
  });
}
```
`scheduled.ts` must resolve the promoted Sigma1 version **the same way** — either by importing this function directly (if `packages/harness` stays Node-only-safe to import from, verify no `better-sqlite3`/`fs` leaks through `cli.ts`'s top level) or by re-deriving the identical rule against a bundled/embedded copy of the pinned version file. Do not invent a second promoted-version resolution rule — that is exactly ARCHITECTURE.md Anti-Pattern 2.

**Step ordering (Pitfall 3, D-12/D-14):** `update()` → D1 write → R2 artifact write, never the reverse. No in-repo analog enforces this exact ordering elsewhere; it is new but should be structured as a single linear async function with early-return per step failure, not a Promise.all race.

---

### `apps/worker/src/stateStore.ts` (service, CRUD, batched)

**Analog (schema shape):** `packages/corpus/schema.sql` — declarative `CREATE TABLE IF NOT EXISTS`, one row per entity, JSON-serialized blob columns for structured data (mirrors `matches.red_teams TEXT` storing a JSON array).

**Migration file pattern** (`packages/corpus/schema.sql:1-9,19,39`):
```sql
CREATE TABLE IF NOT EXISTS teams (
  team_key TEXT PRIMARY KEY,
  team_number INTEGER NOT NULL,
  nickname TEXT
);
-- ...
  score_breakdown_raw TEXT,         -- exact TBA JSON, verbatim (D-05)
```
`apps/worker/migrations/0001_team_state.sql` should follow the same convention: `PRIMARY KEY (algorithm_id, team_key)`, a `state_json TEXT NOT NULL` blob column (mirrors the corpus's verbatim-JSON-in-TEXT-column pattern for `score_breakdown_raw`), plus a `computed_at`/`generation` stamp column (D-04's stamp-inside-the-artifact discipline extended to state rows).

**Batched read/write — no in-repo analog** (D1 binding did not exist before this phase). RESEARCH.md's illustrative shape is the best available reference:
```typescript
const { results } = await env.DB.prepare(
  `SELECT team_key, state_json FROM team_state WHERE algorithm_id = ? AND team_key IN (${placeholders})`
).bind("sigma1", ...touchedTeams).all(); // 1 subrequest

await env.DB.batch(
  updatedTeams.map((t) =>
    env.DB.prepare(
      `INSERT INTO team_state (algorithm_id, team_key, state_json) VALUES (?, ?, ?)
       ON CONFLICT(algorithm_id, team_key) DO UPDATE SET state_json = excluded.state_json`
    ).bind("sigma1", t.teamKey, JSON.stringify(t.state))
  )
); // 1 subrequest for the whole batch
```
Treat a failed `batch()` as "none of these teams advanced this tick" (Pitfall 2) — no partial-success handling.

**What state gets serialized** — `packages/core/algorithms/sigma1/index.ts:151-174` (`Sigma1State`) and `:125-136` (`Sigma1TeamState`) define exactly what a per-team row's `state_json` blob must round-trip: `beliefs`, `covariance` (2D array), `consistency`, `matchCount`, `lastEventKey`, `innovationStats` — plus the algorithm-level `Sigma1League`/`componentOrder`/`allianceScoreStats` that is NOT per-team (needs its own row or a singleton `league_state` table, since D-13 only locks per-team granularity, not "no shared state at all"). EPA's carried-rating shape (`carryover.ts`) and OPR's post-3.2 event-scoped state (`opr.ts`, small ~32 KB per D-09) are the other two state.json shapes `stateStore.ts` must support — one `algorithm_id` column value each.

---

### `apps/worker/src/artifactWriter.ts` (service, CRUD/file-I/O)

**Analog:** `packages/harness/artifact.ts` — the validate-on-write discipline, not the artifact shape itself (that shape is `HarnessArtifactSchema`, the harness's own scoring artifact; page-shaped artifacts are new schemas following the same pattern).

**Schema-is-the-spec pattern** (`packages/harness/artifact.ts:100-109`):
```typescript
export const HarnessArtifactSchema = z.object({
  schemaVersion: z.number().int(),
  provenance: ProvenanceSchema,
  algorithms: z.array(AlgorithmDescriptorSchema).min(1),
  slices: z.array(ScoreSliceSchema),
  statboticsReferences: z.array(StatboticsReferenceSchema),
});
export type HarnessArtifact = z.infer<typeof HarnessArtifactSchema>;
```
Every page-shaped artifact (`teams/{year}`, `team/{teamKey}/{year}`, `events/{year}`, `event/{eventKey}`, `compare/{year}`) needs its own Zod schema following this exact top-level shape convention: `schemaVersion`, a provenance/stamp block (D-04's `generation`/`computedAt`), then the page-specific payload. Validate **before** every R2 `put()` — throw rather than publish malformed data (mirrors `artifact.ts`'s file-header rationale). RESEARCH.md's illustrative `TeamSeasonArtifactSchema` (Code Examples section) is a starting shape for the team-season file, extended per D-07's contract (season stats, per-event sections, every match prediction vs actual, metric-history series).

**Version-splitting pattern to reuse for D-02's path scheme** (`packages/harness/artifact.ts:128-140`):
```typescript
function splitAlgorithmVersion(id: string, version: string): { codeVersion: string; paramSetName: string } {
  const separatorIndex = version.indexOf("+");
  if (separatorIndex === -1) {
    throw new Error(`buildArtifact: algorithm "${id}"'s version "${version}" does not carry D-13's "{codeVersion}+{paramSetName}" shape (no "+" found)`);
  }
  // ...
}
```
D-02's `{page}/{year|teamKey}/{algorithmId}@{version}.json` path builder should reuse this same fail-loudly-on-malformed-version-string discipline rather than assuming the `+` separator is always present.

**No R2-put wrapper analog exists in-repo** (writes today go to local `data/`/`reports/` via `node:fs`, e.g. `packages/harness/artifact.ts:22,` `mkdirSync`/`writeFileSync`). `artifactWriter.ts`'s R2 `put()` calls are genuinely new; the closest conceptual precedent is `packages/harness/artifact.ts`'s `mkdirSync`+`writeFileSync` pairing at its bottom (not shown above — validate object, then persist, same order).

---

### `packages/harness/publish.ts` (NEW, service, batch/transform)

**Analog:** `packages/harness/cli.ts`'s overall shape — reads the corpus, drives `WalkForwardSimulator` per season/algorithm, resolves promoted versions via `applyPromotedOverrides`, builds/validates an artifact, writes it out.

**Corpus access pattern** (`packages/corpus/db.ts`, imported by `packages/harness/replay.ts:16`):
```typescript
import { selectMatchesChronological, type Corpus } from "../corpus/db.js";
```
`publish.ts` opens the corpus read-only (mirrors `packages/harness/cli.ts`'s existing `openCorpusReadOnly`-style call, not shown in the excerpted range but present at `cli.ts`'s top — the planner should grep `cli.ts` for the exact open-corpus call site when writing this plan) and drives the same `buildSeasonStream`/`WalkForwardSimulator.run` primitives `replay.ts` exposes:
```typescript
// packages/harness/replay.ts:16-17 (import shape) — reuse toLeakProofUpcoming,
// buildSeasonStream, WalkForwardSimulator.run, onMatchComplete unchanged.
```
This is the offline half of D-08's leak-proof scheduled-match prediction requirement — `publish.ts` must route every prediction (including for not-yet-played matches) through the same `toLeakProofUpcoming` Proxy `replay.ts` already enforces, not a second ad-hoc "don't peek" convention.

**Output:** `publish.ts` produces THREE things in one offline run (per the System Architecture Diagram): page-shaped R2 artifacts (validated via the new page-artifact Zod schemas above), the D-18 live-windows manifest (small KV-bound object derived from the corpus's event calendar), and the D-12 live-state snapshot (per-team state blobs for D1 bulk import via `wrangler d1 execute --file`). Treat each as a distinct serialization step following `artifact.ts`'s validate-then-write order.

---

### Test files (D-05 payload budget, D-14 replay equivalence)

**Analog:** `packages/harness/digest.test.ts` and `packages/harness/baselineFingerprint.test.ts` — "measure a real artifact/output against a committed expectation, fail loudly on drift" is the established make-a-misreading-fail-a-test pattern (03 D-12, 03.1 D-16) this project already uses; `replay.multiAlgorithm.test.ts`/`replay.season.test.ts` are the closest analog for driving `WalkForwardSimulator` end-to-end in a test.

No excerpt pulled (large, session-budget-conscious) — the planner should read `packages/harness/digest.test.ts`'s assertion shape directly when writing the D-05 budget test's plan, and `replay.multiAlgorithm.test.ts`'s driver shape for D-14's equivalence test.

---

## Shared Patterns

### TBA politeness (throttle + ETag + counter)
**Source:** `packages/ingest/tbaClient.ts` (whole file, 192 lines — small enough to import directly)
**Apply to:** `apps/worker/src/tbaPoll.ts` only (single call site by design; D-22 forbids a second implementation)

### Validate-on-write for every published artifact
**Source:** `packages/harness/artifact.ts` (`HarnessArtifactSchema` + `buildArtifact`'s throw-on-malformed-input discipline)
**Apply to:** `packages/harness/publish.ts`'s page-artifact writers, `apps/worker/src/artifactWriter.ts`'s R2 `put()` wrapper, and the D1 state-row writer in `stateStore.ts`

### Leak-proof upcoming-match handling
**Source:** `packages/harness/replay.ts`'s `toLeakProofUpcoming` (Proxy over `MatchResult` denying `OUTCOME_KEYS`)
**Apply to:** Both `publish.ts` (offline scheduled-match predictions, D-08) and `apps/worker/src/scheduled.ts` (online predict-before-update path) — must be the SAME function imported from `packages/harness/replay.ts`, not reimplemented in the Worker (verify `replay.ts` itself stays Worker-importable, or extract `toLeakProofUpcoming` + `OUTCOME_KEYS` into `packages/core` if `replay.ts` pulls in Node-only corpus code — this is a decision the planner must make explicitly, flagged here since it wasn't resolved in CONTEXT.md/RESEARCH.md)

### Committed-digest / measured-numbers-with-provenance docs
**Source:** `docs/models/sigma1-tuning-results.md` (measured figures, each with the run that produced it)
**Apply to:** D-23's budget doc — every number (CPU/tick, R2/KV write volume, TBA request counts, payload sizes) needs the same "figure + provenance" shape, not a bare number.

### Secrets-boundary discipline
**Source:** `scripts/secrets-boundary.test.ts` (git-ignore check, tracked-file check, hash-compare `.env` vs `.env.example`, never print the real value)
**Apply to:** D-24's Cloudflare API token — extend this exact test (or a sibling test in the same file) to cover a new `CLOUDFLARE_API_TOKEN` (or similarly named) key in the same `.env`/`.env.example` pair, following the identical hash-compare-never-print pattern.

### Isomorphic (Worker-importable) boundary enforcement
**Source:** `packages/core/isomorphic.test.ts` (fitness test scanning for forbidden Node-only import specifiers, e.g. `/^better-sqlite3$/`)
**Apply to:** Anything `apps/worker` imports from `packages/core` or `packages/ingest`/`packages/harness` — RESEARCH.md's Pitfall 5 flags `ml-matrix` as unverified against the actual Workers bundler; the planner should extend or add a parallel fitness-test-style check (or a real `wrangler dev` build smoke test) rather than trust the existing Node-scoped test alone.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/worker/wrangler.toml` | config | event-driven | First Cloudflare Worker in the repo; no prior `wrangler.toml` exists. Closest conceptual precedent: `packages/corpus/schema.sql` as "declarative binding surface a runtime reads," but the actual TOML shape has no in-repo analog — use RESEARCH.md's Code Examples section (`apps/worker/wrangler.toml` illustrative block) as the starting point. |
| `apps/worker/package.json` | config | — | First per-package manifest; the rest of the repo is single-root-manifest. Model on the root `package.json`'s `scripts`/`devDependencies` shape (add `wrangler`, `@cloudflare/workers-types` per RESEARCH.md's Installation block), scoped down to what `apps/worker` actually needs. |
| `apps/worker/migrations/0001_team_state.sql` | migration | CRUD | No D1 database existed before this phase. Schema pattern borrowed from `packages/corpus/schema.sql` (see Pattern Assignments above) but the migration-file mechanics (`wrangler d1 migrations`) are entirely new tooling. |
| `apps/worker/src/subrequestBudget.ts` | utility | transform | D-15/D-19's rotation/cap bookkeeping has no existing analog — RESEARCH.md's own "Key insight" names this as "the one genuinely new piece of engineering... which has no existing analog to reuse." `TbaRequestCounter` (tally-and-expose-getters shape) is the nearest structural cousin, cited above, but the actual rotation/deferral logic must be designed fresh. |
| D1 batched read/write calls (inside `stateStore.ts`) | — | CRUD | D1 binding is new to this repo; RESEARCH.md's own code sample is explicitly labeled "Illustrative shape, not verified against a real D1 schema this session." |
| Replay rig driving a **deployed** Worker's `/cdn-cgi/handler/scheduled` route (D-20) | test/tooling | event-driven | No prior code in this repo drives a deployed Cloudflare endpoint from a test/script; `packages/harness/replay.ts`'s `WalkForwardSimulator` is reused for the *offline* comparison half only, per RESEARCH.md Pattern 3. |

## Metadata

**Analog search scope:** `packages/core/algorithms/*`, `packages/core/algorithms/sigma1/*`, `packages/harness/*`, `packages/ingest/*`, `packages/corpus/*`, `scripts/*`, root `package.json`/`pnpm-workspace.yaml`
**Files read this session:** `packages/ingest/tbaClient.ts` (full), `packages/harness/artifact.ts` (lines 1-140), `packages/core/algorithms/types.ts` (full), `packages/harness/replay.ts` (lines 1-60), `scripts/secrets-boundary.test.ts` (full), `pnpm-workspace.yaml` (full), `packages/core/algorithms/sigma1/index.ts` (lines 120-200), `packages/corpus/schema.sql` (full), `packages/harness/cli.ts` (grep only, targeted lines), root `package.json`
**Pattern extraction date:** 2026-08-21
