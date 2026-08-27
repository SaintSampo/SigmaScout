# Phase 7: Event Pages - Pattern Map

**Mapped:** 2026-08-27
**Files analyzed:** ~24 new/modified files (route, 5 tab components, event axis lib, api fetcher, ingest pair, corpus migration, publisher/schema changes, cross-cutting rename+display changes)
**Analogs found:** 22 / 24 (2 have no close analog — Alliances tab combined-math, D-18 D1 cleanup script)

This phase spans three tiers (client route, ingest, publish/schema) plus a repo-wide rename
sweep. Sections are grouped by tier to match RESEARCH.md's structure.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/routes/event.$eventKey.tsx` | route (page shell + tabs) | request-response | `apps/web/src/routes/team.$teamNumber.tsx` | exact |
| `apps/web/src/lib/api/event.ts` | service (fetcher) | request-response | `apps/web/src/lib/api/team.ts` / `events.ts` | exact |
| `apps/web/src/components/event/InsightsTab.tsx` | component (table) | CRUD/read | `apps/web/src/components/teams-table/{columns.tsx,TeamsTable.tsx}` | role-match |
| `apps/web/src/components/event/BreakdownTab.tsx` | component (table) | CRUD/read | `apps/web/src/components/teams-table/{columns.tsx,TeamsTable.tsx}` | role-match |
| `apps/web/src/components/event/QualsTab.tsx` | component (table/plot) | transform + read | `apps/web/src/components/team/MatchTable.tsx` | exact |
| `apps/web/src/components/event/ElimsTab.tsx` | component (table/plot) | transform + read | `apps/web/src/components/team/MatchTable.tsx` | exact |
| `apps/web/src/components/event/AlliancesTab.tsx` | component (table + client math) | transform + read | `apps/web/src/components/teams-table/` (table shape) + `sigma1/index.ts:688` (the √ sum math) | partial (no existing "combine N teams client-side" component) |
| `apps/web/src/components/event/eventMatchAxis.ts` | utility (pure domain math) | transform | `apps/web/src/components/team/matchAxis.ts` | exact |
| `packages/ingest/schemas.ts` (+`tbaAllianceResponseSchema`, extend `tbaEventRankingSchema`) | model/schema | request-response (validation) | `packages/ingest/schemas.ts`'s existing `tbaEventRankingsResponseSchema`/`tbaAllianceSchema` (same file) | exact |
| `packages/ingest/alliances.ts` | service (normalize) | transform | `packages/ingest/rankings.ts` | exact |
| `packages/ingest/alliances.test.ts` | test | — | `packages/ingest/rankings.test.ts` | exact |
| `packages/ingest/cli.ts` (+`ingestSeasonAlliancesOnly`, extend `ingestSeasonRankingsOnly`) | service (CLI/ingest orchestration) | event-driven / batch | `packages/ingest/cli.ts`'s existing `ingestSeasonRankingsOnly` (same file) | exact |
| `packages/corpus/schema.sql` (+`event_alliances` table) | migration | batch | `event_rankings`/`team_media` (`CREATE TABLE IF NOT EXISTS`, same file) | exact |
| `packages/corpus/db.ts` (+ranking record/sort_order columns) | migration | batch | `hasEventLocationColumns`/`EVENT_LOCATION_COLUMNS` (same file, lines 106-121) | exact |
| `packages/harness/pageArtifacts.ts` (`EventArtifactSchema` += name/dates/location/week/alliances; `EventMatchSchema`/`EventUpcomingMatchSchema` += variance; `EventTeamSchema` += rank/record/rp) | model/schema | request-response (validation) | same file's `TeamSeasonMatchSchema` (already carries `redScoreVarianceOwn`/`blueScoreVarianceOwn`, Phase 6 D-01) | exact |
| `packages/harness/publish.ts` (`buildEventArtifact`, `buildEventTeamsStanding` restructure, alliances assembly, includeOffseason CLI flag) | service (pipeline assembly) | batch | same file's `buildEventArtifact`/`buildEventTeamsStanding`/`publishSeasons` (already exist, being extended) | exact |
| `packages/core/algorithms/sigma1/index.ts` (line ~1002 `spread` redefinition) | service (model core) | transform | same file's line 688 `redScoreVarianceOwn` (`P + R` already computed there) | exact |
| VPR rename sweep (~24 files, see below) | cross-cutting | — | n/a — enumerated, not pattern-copied | n/a |
| `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` | doc | — | itself (rewrite in place) | n/a |
| `data/algorithm-versions/sigma1@*.json` → `vpr@*.json` | config/data | — | itself (rename + internal `id` field edit) | exact |
| D1 cleanup (`wrangler d1 execute ... DELETE FROM algorithm_state WHERE algorithm_id='sigma1'`) | migration (one-off) | batch | none — new one-off ops script | no analog |
| `.planning/ROADMAP.md` SC-1 edit (D-19) | doc | — | itself | n/a |

---

## Pattern Assignments

### `apps/web/src/routes/event.$eventKey.tsx` (route)

**Analog:** `apps/web/src/routes/team.$teamNumber.tsx` (full file read, 179 lines)

**Route + search validation** (lines 1-26):
```typescript
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { TEAM_TABS, TeamSearchSchema } from "../lib/searchParams.js";
...
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: TeamSearchSchema,
  component: TeamPage,
});
```
For the event route: `createFileRoute("/event/$eventKey")`, a new `EventSearchSchema` (in `searchParams.ts`, alongside `TeamSearchSchema`/`TEAM_TABS`) defining `EVENT_TABS = ["insights","breakdown","quals","alliances","elims"] as const` and a `?tab=` param, mirroring `TEAM_TABS`/`TeamSearchSchema` exactly.

**Route-param validity guard** (lines 28-29, 54-56, 70-76) — no fetch fires for a nonsense param:
```typescript
const TEAM_NUMBER_PATTERN = /^\d+$/;
...
const isValidTeamNumber = TEAM_NUMBER_PATTERN.test(teamNumberParam) && Number.parseInt(teamNumberParam, 10) > 0;
...
if (!isValidTeamNumber) {
  return <div className="p-[var(--spacing-lg)]"><p ...>{`"${teamNumberParam}" is not a valid team number.`}</p></div>;
}
```
Event route needs an analogous (looser — event keys are alphanumeric like `2026casf`) guard before firing `useQuery`.

**Query wiring, algorithm-version gate, keepPreviousData** (lines 62-68):
```typescript
const version = useAlgorithmVersion(algorithm);
const { data, isPending, error, refetch } = useQuery({
  ...teamQueryOptions({ teamKey, year, algorithmId: algorithm, version: version ?? "" }),
  enabled: isValidTeamNumber && version !== undefined,
  placeholderData: keepPreviousData,
});
```
Copy verbatim, swapping `teamQueryOptions` for the new `eventQueryOptions` (see `event.ts` below) and the enabled-guard for the event-key validity check.

**404 vs other-error split** (lines 86-101) — reuse verbatim; an event with no published artifact (offseason gap, Pitfall 1) should degrade like the team page's year-mismatch case, not crash:
```typescript
const is404 = error instanceof ArtifactFetchError && error.status === 404;
...
if (error) {
  return <ErrorState resource={`team ${teamNumber}`} year={year} onRetry={() => void refetch()} />;
}
```

**Tab strip + handleTabChange + `Tabs`/`TabsList`/`TabsTrigger`** (lines 78-84, 138-178) — reuse verbatim, extended to 5 triggers, the 5th (Alliances) getting Radix's native `disabled` prop per D-17:
```tsx
function handleTabChange(value: string) {
  const nextTab = value as TeamTab;
  void navigate({ search: (prev) => ({ ...prev, tab: nextTab }) });
}
...
<Tabs value={tab} onValueChange={handleTabChange}>
  <TabsList variant="line" className="border-b border-[var(--color-border)]">
    <TabsTrigger value="overview" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
      Overview
    </TabsTrigger>
    ...
  </TabsList>
  <TabsContent value="overview" ...>{renderOverviewContent()}</TabsContent>
</Tabs>
```
07-UI-SPEC.md additionally requires the tab strip itself to be a THIRD, independent `overflow-x-auto` scroll region (siblings, never nested) — this is new relative to the team page (which never needed the strip itself to scroll, only 2 tabs). Wrap `<TabsList>` in a `div` carrying `min-w-0 overflow-x-auto` with `scrollbar-width: none` (mirrors `EventSection.tsx`'s scroll-region CSS, see Shared Patterns below), not inside any table's own scroll region.

**Content-width constraint** (lines 140-149) — reuse verbatim, same `max-w-[1200px]` wrapper and its documented rationale (fixed 470px plot width math), unless the widest Insights/Breakdown table changes that calculus (check post-build).

---

### `apps/web/src/lib/api/event.ts` (fetcher)

**Analog:** `apps/web/src/lib/api/team.ts` (full file, 56 lines) — `events.ts` is the same shape one level shallower (no `teamKey`-style single-entity param), read for cross-check.

**Full pattern to mirror** (`team.ts` lines 19-55):
```typescript
import { artifactKey, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchTeamArtifactParams {
  teamKey: string;
  year: number;
  algorithmId: string;
  version: string;
}

export async function fetchTeamArtifact({ teamKey, year, algorithmId, version }: FetchTeamArtifactParams): Promise<TeamSeasonArtifact> {
  const key = artifactKey({ page: "team", teamKey, year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("team", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = TeamSeasonArtifactSchema.parse(body);
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError("team", year, err);
  }
}

export function teamQueryOptions(params: FetchTeamArtifactParams) {
  return {
    queryKey: ["team", params.teamKey, params.year, params.algorithmId, params.version] as const,
    queryFn: () => fetchTeamArtifact(params),
  };
}
```
For `event.ts`: swap `teamKey`→`eventKey`, `page: "team"`→`page: "event"`, `TeamSeasonArtifactSchema`/`TeamSeasonArtifact`→`EventArtifactSchema`/`EventArtifact`, queryKey prefix `"event"`. Import depth is identical (`apps/web/src/lib/api/` → repo root, 5 levels up, confirmed in both analogs' own header comments).

---

### `apps/web/src/components/event/InsightsTab.tsx` and `BreakdownTab.tsx` (tables)

**Analog:** `apps/web/src/components/teams-table/columns.tsx` + `TeamsTable.tsx` (Pattern 2 in RESEARCH.md, verified lines cited there)

**Pinned-column + column-builder skeleton** (`teams-table/columns.tsx` lines 24, 34-35, 86-97):
```typescript
export const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"] as const;
export const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, TeamRow>();
...
return columnHelper.columns([
  columnHelper.accessor("rank", { header: "Rank", size: 56 }),
  columnHelper.accessor("teamNumber", { ... }),
  columnHelper.accessor("nickname", { ... }),
  ...(metricKeysFor(algorithmId, season).map((key) =>
    columnHelper.accessor((row) => row.metrics[key], { ... })
  )),
]);
```
Insights reuses `PINNED_COLUMN_IDS` verbatim (`["rank","teamNumber","nickname"]`); Breakdown pins only `["teamNumber","nickname"]` (D-11: no rank column at all) — a one-line change to the pinned-id array, same builder shape otherwise. Breakdown's metric-column set is `metricKeysFor(algorithmId, season)` (`apps/web/src/lib/metricKeys.ts`) — the SAME function `columns.tsx` line 113 already calls, not a Breakdown-specific list (UI-SPEC's explicit instruction).

**Sticky positioning** (`TeamsTable.tsx` lines 133-214) — reuse the exact `position: sticky` + pinning-feature-offset mechanism, no new CSS scheme.

**Row-model / ranking** — `apps/web/src/components/teams-table/rowModel.ts:98-110` is the D-20 rename site (always ranks by selected algorithm's Total). Insights/Breakdown do NOT reuse this row model directly — D-07 sorts by `event_rankings` rank (or VPR-fallback per D-08); D-11 sorts by VPR rank — but the algorithm-driven sort key naming convention (and the fact this is a SERVER-DETERMINED order, not a clickable-to-resort column, per UI-SPEC's Accent section) should mirror `rowModel.ts`'s existing "always rank by selected algorithm's Total" precedent for the fallback case.

**Reused primitives, not rebuilt:** `MetricValue` (`apps/web/src/components/MetricValue.tsx`) for every tier-boxed numeric cell; `TierKeyRow` (`apps/web/src/components/team/TierKeyRow.tsx`) once above each table; `tierForPercentile` (`apps/web/src/lib/tiers.ts`); `METRIC_GROUPS` (`apps/web/src/lib/metricGroups.ts`) for Insights' Auto/Teleop/Endgame columns.

---

### `apps/web/src/components/event/QualsTab.tsx` and `ElimsTab.tsx` (match plot tables)

**Analog:** `apps/web/src/components/team/MatchTable.tsx` (the shipped sketch-003 variant C table) + `apps/web/src/components/team/matchAxis.ts`

Both new tabs are `MatchTable.tsx` generalized from a team-season domain to a per-tab event domain (RESEARCH.md's own framing, confirmed by CONTEXT.md's Reusable Assets list). Key deltas from the analog:
- Drop the "this team's" bold-highlight rule (line 205's `± {sd}` styling context) — no team is privileged on an event page; every team-number cell renders at Body 14/400 weight (UI-SPEC Quals tab section).
- `redScoreVarianceOwn`/`blueScoreVarianceOwn` — the field the whole band/tick geometry is drawn from (`MatchTable.tsx:205`'s `sd = √redScoreVarianceOwn`) — does not yet exist on `EventMatchSchema`/`EventUpcomingMatchSchema` (D-18 item 3 adds it; RESEARCH.md Anti-Pattern flags this explicitly, `pageArtifacts.ts:246-262` confirmed absent).
- Bonus-RP dots: `apps/web/src/components/team/BonusRpDots.tsx`, gated by `isBonusRpCompLevel(compLevel)` — reuse verbatim on Quals (`qm` rows), never render true dots on Elims (playoffs, always false).
- `matchLabel()` (already produces `"Semifinal 3-2"`, `"Final 1-1"`) reused verbatim for Elims' round label, no new formatting function.

**Analog for the axis math:** `apps/web/src/components/team/matchAxis.ts` — `AxisDomain`/`allianceMarkPositions`/`MATCH_GEOMETRY`/`computeAxisDomain(events: readonly TeamSeasonEvent[])`, scoped to the team-page domain `[VERIFIED: matchAxis.ts:15-16,125]`. Write a new sibling `apps/web/src/components/event/eventMatchAxis.ts` reusing the SAME exported geometry constants and helper shapes but operating over `EventMatchSchema`/`EventUpcomingMatchSchema` rows — a fresh domain per D-12 (Quals and Elims get their OWN separate axis, not shared with each other or with the team page). Do not hand-roll a second geometry constant set — `BAND_H=8`/`DOT_H=12`/`TICK_H=14`/`PLOT_H=44`/`PLOT_W=470` are locked pixel values shared across the whole app.

**Scroll-region pattern (also feeds the tab strip, see Shared Patterns):** `apps/web/src/components/team/EventSection.tsx:10-19`:
```tsx
<div data-testid={`match-table-scroll-${event.eventKey}`}
     className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
```
Every flex/grid ancestor of the scroller carries `min-w-0`; the scroller is a single native `overflow-x-auto` element with `touch-pan-x`/`overscroll-x-contain`, never fused with page vertical scroll.

**Client-side merge (D-13):** no direct analog exists (the artifact keeps `matches[]`/`upcoming[]` separate on the wire by design) — this is new logic: interleave by `sortTime`/`matchNumber`, following the same "unplayed row draws bands+tick, no actual dot" treatment `MatchTable.tsx` already implements for the team page's own scheduled-match rows (06-CONTEXT D-08).

---

### `apps/web/src/components/event/AlliancesTab.tsx`

**No close existing analog for the combined-value arithmetic** — this is genuinely new client-side computation. The authoritative formula to copy is in `packages/core/algorithms/sigma1/index.ts` around line 688:
```typescript
const redScoreVarianceOwn = redPosteriorSum + redCovarianceTotal;
const blueScoreVarianceOwn = bluePosteriorSum + blueCovarianceTotal;
```
This is the `P + R` sum construction D-01/D-15 both reference — an alliance's combined variance is the SAME `Σ(P+R)` pattern, just summing the three picked teams' own already-published `spread²` values client-side: `σ_alliance = √(σ₁² + σ₂² + σ₃²)`. `MetricValue.tsx` renders the result with no `tier` prop (bare `MetricValue`, its existing `undefined`-tier no-op path — no new component code needed there).

**Table shape:** reuse the same TanStack-table-with-team-links pattern as Insights (team-number cells linking to `/team/{teamNumber}` — same link construction `teams-table/columns.tsx`'s `teamNumber` column already uses), but this table is small (≤8 rows) and fixed-column (no pinning/scrolling concern per UI-SPEC's E7 "overflow — dismissed").

---

### `packages/ingest/alliances.ts` and `alliances.test.ts`

**Analog:** `packages/ingest/rankings.ts` (36 lines, full file read) + `packages/ingest/rankings.test.ts` (133 lines, full file read) — RESEARCH.md explicitly names this pair as the template.

**Normalize function shape to mirror** (`rankings.ts` lines 1-36):
```typescript
import type { TbaEventRankingsResponse } from "./schemas.js";

export interface NormalizedEventRanking {
  teamKey: string;
  rank: number;
  totalTeams: number;
}

export function normalizeEventRankings(response: TbaEventRankingsResponse | null): NormalizedEventRanking[] {
  if (response === null || response.rankings.length === 0) return [];
  const totalTeams = response.rankings.length;
  return response.rankings.map((r) => ({ teamKey: r.team_key, rank: r.rank, totalTeams }));
}
```
For `alliances.ts`: same null/empty tri-state handling (RESEARCH.md Q2 confirmed the identical three-state contract live — null body, empty array, populated array), a pure function with no I/O and no corpus import ("mirrors `media.ts`'s shape" per the analog's own header comment). New response type comes from the new `tbaAllianceResponseSchema` in `schemas.ts` (distinct from the existing per-match `tbaAllianceSchema` at line 57 — do not conflate).

**Test structure to mirror** (`rankings.test.ts` full file) — one fixture-factory function per shape (`allianceEntry(overrides)`, `alliancesResponse(overrides)`, matching `rankingEntry`/`rankingsResponse`'s pattern at lines 12-40), then `describe` blocks for: schema parse (null body doesn't throw, populated response with N picks including 4-team, drifted-payload throws loudly), and `describe("normalizeEventAlliances", ...)` mirroring lines 98-133's cases (populated→N records, null→`[]`, empty array→`[]` as a SEPARATE case from null, preserves ordering/`picks` verbatim). Concretely test the two REAL findings from RESEARCH.md's live probe: `name` sometimes ABSENT (not `""`) — assert the normalize function's fallback naming does NOT assume presence; and `picks` length 3 or 4 with no separate `backup` field — assert 4th pick surfaces as `picks[3]`, not a renamed field.

---

### `packages/ingest/cli.ts` (`ingestSeasonAlliancesOnly`, extend `ingestSeasonRankingsOnly`)

**Analog:** the existing `ingestSeasonRankingsOnly` in the SAME file `[VERIFIED: packages/ingest/cli.ts:356-417]`. Mirror its exact tally discipline — `populatedCount`/`nullBodyCount`/`emptyRankingsCount`/`cacheHitCount` — for the new alliances ingest function rather than inventing a new state model (RESEARCH.md's Don't-Hand-Roll table, same conclusion). Extend `ingestSeasonRankingsOnly` itself to also read+store `sort_orders`/`record` (currently fetched but discarded per `schemas.ts:120`'s doc comment).

---

### `packages/corpus/schema.sql` (+`event_alliances` table) and `packages/corpus/db.ts` (+ranking columns)

**Analog for the new table:** `event_rankings`'s own doc comment `[VERIFIED: packages/corpus/schema.sql:78-108]` — "Additive `CREATE TABLE IF NOT EXISTS`, matching `team_media`'s precedent exactly... this is a brand-new table, no prior rows, no migration needed." Copy this comment convention and the `CREATE TABLE IF NOT EXISTS event_alliances (...)` shape directly from `event_rankings`'s own DDL.

**Analog for the new columns on `event_rankings`:** `EVENT_LOCATION_COLUMNS`/`hasEventLocationColumns` in `db.ts` `[VERIFIED: packages/corpus/db.ts:106-121]`:
```typescript
const EVENT_LOCATION_COLUMNS: readonly [string, string][] = [
  ["name", "TEXT"], ["week", "INTEGER"], ["country", "TEXT"],
  ["state_prov", "TEXT"], ["district_key", "TEXT"],
];
export function hasEventLocationColumns(db: Corpus): boolean {
  const columns = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
  const existing = new Set(columns.map((column) => column.name));
  return EVENT_LOCATION_COLUMNS.every(([name]) => existing.has(name));
}
// inside openCorpus():
if (!hasEventLocationColumns(db)) {
  for (const [name, sqlType] of EVENT_LOCATION_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${sqlType}`);
  }
}
```
Write an analogous `EVENT_RANKING_RECORD_COLUMNS`/`hasEventRankingRecordColumns` pair for `record_wins`/`record_losses`/`record_ties` + the RP `sort_orders[0]` column on `event_rankings`. This is the SAFE case per the analog's own doc comment: new source fields, honestly `NULL` until next ingest, never a derived value.

---

### `packages/harness/pageArtifacts.ts` (schema additions)

**Analog for variance fields:** `TeamSeasonMatchSchema` already carries `redScoreVarianceOwn`/`blueScoreVarianceOwn` (Phase 6 D-01) — copy that field pair's shape onto `EventMatchSchema` (line 246-262) and `EventUpcomingMatchSchema` (line 265-289).

**Current `EventMatchSchema`** (lines 246-262, full — this is what gets extended):
```typescript
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
```

**Current `EventTeamSchema`** (lines 292-297, full — extended with rank/record/rp per D-18 item 6):
```typescript
const EventTeamSchema = z.object({
  teamKey: z.string().min(1),
  teamNumber: z.number().int().optional(),
  nickname: z.string().optional(),
  metrics: MetricsRecordSchema,
});
```

**`TeamMetricSchema`** — the D-01/D-02 redefinition site, doc comment must be rewritten (D-03 obligation):
```typescript
// Current (line 152-155), to be corrected — the doc comment's "deliberately distinct... never merged" claim is exactly what D-01 supersedes:
/** D-27: one team's named metric — a value with an optional consistency spread. Mirrors `packages/core/algorithms/types.ts`'s `TeamMetric`. The consistency `spread` here and an alliance-total predictive `variance` elsewhere are deliberately distinct fields (D-09/D-10) — never merged. */
const TeamMetricSchema = z.object({
  value: z.number(), // (implied; not shown in this excerpt)
  spread: z.number().optional(),
});
```
No schema shape change needed (still `spread: z.number().optional()`) — only the doc comment and the VALUE assembled at `sigma1/index.ts` change. Line 152 and the file header rule at line 30 (`* - The two meanings of \`±\` stay separate (02-CONTEXT D-09/D-10)`) are the two doc sites D-03 names as binding rewrite targets.

**`EventArtifactSchema`** (lines 651-659) — the extension point for D-18 item 8 (identity) and item 7 (alliances):
```typescript
export const EventArtifactSchema = AlgorithmScopedPreambleSchema.extend({
  eventKey: ...,
  season: ...,
  matches: z.array(EventMatchSchema),
  upcoming: z.array(EventUpcomingMatchSchema),
  teams: z.array(EventTeamSchema),
});
```
Add `name`, `startDate`, `location` (nullable, matching Events-list's own `locationText`/week-badge null-handling), `week` (nullable), and `alliances: z.array(EventAllianceSchema)` (new nested schema: `{ allianceNumber, picks: string[], captain, name?: string }` — mirroring the raw TBA shape's optional `name`, per RESEARCH.md's live-confirmed absent-key finding).

---

### `packages/harness/publish.ts` (`buildEventArtifact`, `buildEventTeamsStanding`, CLI flag)

**Current `buildEventArtifact`** (lines 262-317, full function) — the funnel D-18 items 3/5/7/8 all extend:
```typescript
export function buildEventArtifact(params: BuildEventArtifactParams): EventArtifact {
  const matches = params.predictions.map(({ match, prediction }) => ({
    matchKey: match.matchKey, compLevel: match.compLevel, ...
    predictedWinner: prediction.winner, pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore), predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponents(prediction.redComponents), blueComponents: roundComponents(prediction.blueComponents),
    actualWinner: match.winner, actualRedScore: match.redScore, actualBlueScore: match.blueScore,
  }));
  ...
  const teams = (params.teams ?? []).map((t) => ({
    teamKey: t.teamKey, teamNumber: t.teamNumber, nickname: t.nickname,
    metrics: roundTeamMetricRecord(t.metrics),
  }));
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION, generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId, algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey, season: params.season,
    matches, upcoming, teams,
  };
  return EventArtifactSchema.parse(candidate);
}
```
Add `redScoreVarianceOwn`/`blueScoreVarianceOwn` to the `matches`/`upcoming` map bodies (sourced from `prediction`, same field the team-artifact builder already reads per Phase 6 D-01), add `name`/`startDate`/`location`/`week` and `alliances` to `candidate`. **The "parses through its Zod schema before returning" rule is load-bearing** — keep the final `EventArtifactSchema.parse(candidate)` call as the last line, unchanged in position.

**`buildEventTeamsStanding`** (lines 862-871, full function) — the D-10 restructure site:
```typescript
function buildEventTeamsStanding(
  metricsByTeam: TeamMetrics,
  teamKeys: readonly string[],
  teamInfo: ReadonlyMap<string, TeamInfo>
): EventTeamStandingInput[] {
  return teamKeys.map((teamKey) => {
    const info = teamInfoOrFallback(teamInfo, teamKey);
    return { teamKey, teamNumber: info.teamNumber, nickname: info.nickname, metrics: metricsByTeam[teamKey] ?? {} };
  });
}
```
Called twice (lines 1394, 1626), both currently fed the SAME season-final `metricsByTeam`. RESEARCH.md Q3's proven fix: thread a per-event state map (captured via the existing `onMatchComplete` hook, same seam `metricHistory`/D-28 already uses) into this call site — `metricsByTeam` becomes a per-event lookup, not one shared value. Merge pattern for the value/percentile split: mirror `withHistoryPercentiles` `[VERIFIED: packages/harness/publish.ts:187-196]`, which already merges an as-of-event value with a season-final percentile for `metricHistory` rows in plan 06.1-05 — same merge shape, new call site.

**`PublishSeasonsOptions`** (lines 887-898) already has `includeOffseason?: boolean` (line 894) — it is simply never surfaced on the CLI. **`main()`'s `parseArgs`** (lines 1674-1684) is the site to extend:
```typescript
const { values } = parseArgs({
  options: {
    event: { type: "string" }, algorithm: { type: "string" }, bucket: { type: "string" },
    "dry-run": { type: "boolean" }, seasons: { type: "string" }, concurrency: { type: "string" },
    "skip-state": { type: "boolean" },
  },
});
```
Add `"include-offseason": { type: "boolean" }` here, thread `values["include-offseason"] === true` through `runSeasonsCliMode` into `publishSeasons({ ..., includeOffseason })` — this is Pitfall 1's fix, a prerequisite for the D-18 republish to reach the D-08 offseason events at all.

---

### `packages/core/algorithms/sigma1/index.ts` (`spread` redefinition, D-01/D-02)

**The value already exists** (line ~688, inside the per-match prediction path):
```typescript
const redScoreVarianceOwn = redPosteriorSum + redCovarianceTotal;
const blueScoreVarianceOwn = bluePosteriorSum + blueCovarianceTotal;
```
This is `P + R` for a MATCH already. **The site that needs to change** (line ~1000-1002, inside `teamMetrics()`'s per-team assembly):
```typescript
perTeam[name] = { value, spread: Math.sqrt(shrunkVariance) };
...
perTeam[TOTAL_METRIC_KEY] = { value: total, spread: Math.sqrt(totalVariance) };
```
`shrunkVariance`/`totalVariance` here are currently the D-09 consistency quantity (R only). D-01/D-02 require `spread = √(P + R)` — i.e., the SAME construction as `redScoreVarianceOwn` above, but for one team's own component/total, not an alliance. The planner must locate (or introduce) this team's own `P` (posterior predictive variance) term alongside the already-computed consistency `R` term and sum them before the `Math.sqrt(...)` call at both `perTeam[name]` sites. D-03: `R` keeps being computed and stored internally (do not delete `shrunkVariance`/`totalVariance` — only stop publishing them as `spread`).

---

## Shared Patterns

### Fetch → Zod parse → TanStack Query (every new artifact fetcher)
**Source:** `apps/web/src/lib/api/team.ts` (full file), `apps/web/src/lib/api/events.ts` (full file) — byte-identical shape, only schema/params/query-key differ.
**Apply to:** `apps/web/src/lib/api/event.ts` (new).
```typescript
const res = await fetch(artifactUrl(key));
if (!res.ok) throw new ArtifactFetchError(<page>, year, res.status);
const body: unknown = await res.json();
try {
  const parsed = <Schema>.parse(body);
  markArtifactParsed();
  return parsed;
} catch (err) {
  throw new ArtifactValidationError(<page>, year, err);
}
```

### Additive nullable-column corpus migration
**Source:** `packages/corpus/db.ts:106-121` (`EVENT_LOCATION_COLUMNS`/`hasEventLocationColumns`).
**Apply to:** `event_rankings`'s new record/RP columns (D-18 item 6). New source fields only — never a derived/recomputed value (that case throws and demands a rebuild, per the same file's `winner_imputed` counter-example).

### `CREATE TABLE IF NOT EXISTS` for brand-new tables
**Source:** `packages/corpus/schema.sql:78-108` (`event_rankings`'s own doc comment, citing `team_media`'s precedent).
**Apply to:** the new `event_alliances` table (D-18 item 7) — no migration guard needed, no prior rows.

### Native horizontal-scroll region (`overflow-x-auto` + `touch-pan-x` + `overscroll-x-contain`, every ancestor `min-w-0`)
**Source:** `apps/web/src/components/team/EventSection.tsx:10-19`.
**Apply to:** Quals/Elims tab tables, Insights/Breakdown's non-pinned column region, AND the 5-tab strip itself (new this phase) — three independent scroll regions that are DOM siblings, never nested inside one another (07-UI-SPEC.md's explicit resolution of Open Question 5).

### Null/empty/populated tri-state ingest tallying
**Source:** `packages/ingest/cli.ts:356-417` (`ingestSeasonRankingsOnly`'s `populatedCount`/`nullBodyCount`/`emptyRankingsCount`/`cacheHitCount`).
**Apply to:** the new `ingestSeasonAlliancesOnly` — RESEARCH.md confirmed live that `/alliances` needs the identical three-state handling (null body / empty array / populated), same PD-02 precedent.

### Parse-through-schema-before-return
**Source:** every `build*Artifact` function in `packages/harness/publish.ts` (e.g., `buildEventArtifact`'s final `return EventArtifactSchema.parse(candidate);`).
**Apply to:** any extension of `buildEventArtifact` — the parse call must remain the last line so an invalid artifact can never reach `putObject`.

### Deep relative imports with explicit `.js`, no workspace alias
**Source:** every fetcher/schema import observed (`../../../../../packages/harness/pageArtifacts.js` etc.).
**Apply to:** all new files under `apps/web/src/` and `packages/ingest/`, `packages/harness/` — there is no `@sigmascout/*` alias anywhere in this repo.

---

## VPR Rename Sweep — Enumerated File List (D-04/D-05, budget for planner)

CONTEXT.md's own D-05 names only 4 sites (registry, `PUBLISHED_ALGORITHM_IDS`, `apps/worker/src/scheduled.ts`, the two `data/algorithm-versions/*.json` files). RESEARCH.md's live grep found the blast radius is materially wider. **Non-test source files referencing `sigma1`/`Sigma1`** (grep re-run this session, confirms RESEARCH.md's count):

```
apps/web/src/components/team/MatchTable.tsx
apps/web/src/components/team/BonusRpDots.tsx
apps/web/src/lib/bonusRp.ts
apps/web/src/lib/metricGroups.ts
apps/web/src/lib/metricKeys.ts
apps/web/src/lib/searchParams.ts        <- DEFAULT_ALGORITHM: PublishedAlgorithmId = "sigma1" (line 27) — the exact
                                             fallback D-05's own safety argument depends on; MUST change to "vpr"
apps/web/src/lib/query-client.ts
apps/web/src/lib/api/manifests.ts
apps/web/src/components/ribbon/AlgorithmSelect.tsx
apps/worker/src/stateStore.ts
apps/worker/src/scheduled.ts            <- DEFAULT_LIVE_ALGORITHM_IDS = ["sigma1"] (line 146), already named in D-05
apps/worker/src/env.ts
apps/worker/src/bundleSmoke.ts
apps/worker/wrangler.toml
apps/worker/migrations/0001_algorithm_state.sql
packages/harness/manifests.ts
packages/harness/cli.ts
packages/harness/publishedAlgorithms.ts  <- PUBLISHED_ALGORITHM_IDS, already named in D-05
packages/harness/manifestSchemas.ts
packages/harness/promote.ts              <- confirms algorithmId NOT in the digest (safe rename)
docs/models/*.md, docs/publish-budget.md, docs/worker-operations.md, docs/first-paint-measurement.md
  (7 files under docs/ — historical/measurement docs; D-05 does not require rewriting docs describing
  what WAS measured under the old name, but forward-looking claims should be checked)
data/algorithm-versions/sigma1@2.0.0+tracer-check.json  -> vpr@2.0.0+tracer-check.json (rename + internal "id" field)
data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json -> vpr@2.0.0+tuned-2026-08.json (rename + internal "id" field)
```
Plus e2e specs (test files, excluded from the above list but will need query/assertion updates): `apps/web/e2e/touch-scroll.spec.ts`, `static-shell.spec.ts`, `no-page-pan.spec.ts`, `team-page.spec.ts`, `deep-link.spec.ts`.

**Additional non-source-file target with no file-search analog:** the remote D1 database `sigmascout-state` stores `algorithm_id = 'sigma1'` as ROW DATA — confirmed via `docs/publish-budget.md`'s read-back table (`sigma1 | league | 1 | 7,465`, `sigma1 | team | 4,598 | 4,760`). A `vpr` reseed does NOT auto-remove these rows (the reseed's own `DELETE FROM algorithm_state WHERE algorithm_id = '<id>'` clause is scoped to the id being reseeded). **No existing script performs this cleanup** — plan a new one-off `wrangler d1 execute sigmascout-state --remote --command "DELETE FROM algorithm_state WHERE algorithm_id = 'sigma1'"` (or equivalent), run once as part of the rename pass. This is the one item in this phase's whole file list with **no analog at all**.

**Planner action, per RESEARCH.md:** budget a full-repo grep-and-sweep task, not a fixed enumerated list taken as exhaustive — treat the list above as a floor, re-grep before considering the sweep done.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Alliances combined-variance client math (inside `AlliancesTab.tsx`) | transform | No existing component sums N published `spread` values client-side; nearest conceptual analog is the pipeline-side `redScoreVarianceOwn` sum at `sigma1/index.ts:688`, but that runs in the pipeline, not the browser — this is genuinely new (cheap, 3-term) client code. |
| D1 `sigma1` row cleanup script | migration (one-off ops) | No prior D1 cleanup script exists in this repo; nearest analog (`emitSeedSql`'s `DELETE FROM algorithm_state WHERE algorithm_id = '<id>'`) is scoped to reseeding, not cleanup of an orphaned old id — write a small new one-off, not reused code. |

---

## Metadata

**Analog search scope:** `apps/web/src/{routes,components,lib}`, `packages/{ingest,harness,corpus,core/algorithms/sigma1}`, plus a repo-wide grep for the VPR rename blast radius (excluding `*.test.*` and `.planning/`).
**Files scanned (read in full or targeted range):** `team.$teamNumber.tsx` (full), `lib/api/team.ts` (full), `lib/api/events.ts` (full), `ingest/rankings.ts` (full), `ingest/rankings.test.ts` (full), `harness/publish.ts` (targeted: 250-320, 862-901, 1673-1710), `harness/pageArtifacts.ts` (targeted: 1-80, 235-300, schema summary lines), `core/algorithms/sigma1/index.ts` (targeted: ~680-700, ~995-1010), `teams-table/columns.tsx` (targeted header lines), `corpus/db.ts`/`schema.sql` (cited via RESEARCH.md's own `[VERIFIED]` line ranges, cross-checked).
**Pattern extraction date:** 2026-08-27
