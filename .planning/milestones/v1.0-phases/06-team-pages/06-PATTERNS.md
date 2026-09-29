# Phase 6: Team Pages - Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 20 (client team-page surfaces + pipeline publisher/schema additions)
**Analogs found:** 14 with a real codebase analog / 6 marked NEW (no prior instance in this repo)

**Corrections to CONTEXT.md/RESEARCH.md line citations, verified this session:**
- D-01's `sigma1/index.ts:684` (CONTEXT) is a one-line offset — the real local variables are
  `redScoreVarianceOwn`/`blueScoreVarianceOwn` at the two lines directly below
  `const ruleModule = rpRuleModuleForSeason(season);`, confirmed never on the returned
  `Prediction` object (`return { winner, pRedWin, redScore, blueScore, variance, redComponents,
  blueComponents, redRpPmf?, blueRpPmf? }` — no own-variance field).
- `TeamSeasonMatchSchema` is at `packages/harness/pageArtifacts.ts:249-279`, a `.refine()`-chained
  `ZodEffects` (matches RESEARCH.md's note that it cannot be `.extend()`-ed — a D-09 relaxation
  must rebuild the object literal, not `.extend()` it, same constraint `PredictionRecordSchema`
  already has).
- `eventName: eventKey` bug confirmed live at `packages/harness/publish.ts:958` today (`eventName:
  eventKey, // corpus has no event-name column — see events-row comment above`), even though
  `meta` (the fix's data source) is already in scope one line above it in the same loop.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/lib/api/team.ts` | service (fetcher) | request-response | `apps/web/src/lib/api/teams.ts` | exact |
| `apps/web/src/routes/team.$teamNumber.tsx` | route | request-response | `apps/web/src/routes/teams.tsx` | role-match |
| `apps/web/src/lib/searchParams.ts` (modify: add `TeamSearchSchema`) | utility (schema) | — | `TeamsSearchSchema`/`EventsSearchSchema` in the same file | exact |
| `apps/web/src/components/team/SeasonHeader.tsx` | component | request-response | `apps/web/src/components/teams-table/columns.tsx` (cell composition) + `MetricValue.tsx` | role-match |
| `apps/web/src/components/team/EventSection.tsx` | component | request-response | `apps/web/src/components/teams-table/TeamsTable.tsx` (scroll-region ownership) | partial — different scroll shape, see below |
| `apps/web/src/components/team/MatchTable.tsx` | component | request-response | `apps/web/src/components/teams-table/columns.tsx` (cell/column composition) | partial |
| `apps/web/src/components/team/MetricHistoryChart.tsx` | component | streaming (client render of static series) | none — first Recharts usage in repo | NEW |
| `apps/web/src/components/StateViews.tsx` (modify: no new component, reuse `EmptyState`/`ErrorState`) | component | — | itself | exact |
| `apps/web/src/components/Skeletons.tsx` (modify: add event-section/header skeleton shapes) | component | — | itself (`SkeletonRows`) | exact |
| `apps/web/src/components/ribbon/YearSelect.tsx` (modify) | component | request-response | `apps/web/src/components/ribbon/AlgorithmSelect.tsx` (`useAlgorithmOptions` merge-over-constant) | exact |
| `apps/web/src/components/search/SearchBox.tsx` (modify) | component | request-response | itself (`handleSelectTeam`, `SearchNavigate` type) | exact |
| `apps/web/src/components/teams-table/columns.tsx` (modify: team/nickname cells become links) | component | request-response | itself | exact |
| `packages/harness/pageArtifacts.ts` (modify) | model (Zod schema) | — | itself (`TeamSeasonMatchSchema`, `TeamSeasonEventSchema`, `TeamMetricSchema`) | exact |
| `packages/harness/publish.ts` (modify: `buildTeamSeasonArtifact`, `eventName` fix, percentile/activeYears passes) | service (pipeline assembly) | batch | itself | exact |
| `packages/harness/rounding.ts` (modify: new `ROUNDING_RULE` entries) | config | — | itself | exact |
| `packages/core/algorithms/types.ts` (modify: `Prediction` gains two optional fields) | model | — | itself | exact |
| `packages/core/algorithms/sigma1/index.ts` (modify: `predict()` return includes own-variance) | service | transform | itself | exact |
| `packages/ingest/tbaClient.ts` (modify: add `fetchTeamMedia`) | service | request-response | itself (`fetchTeamDetail`) | exact |
| `packages/harness/publish.test.ts` (modify) | test | — | itself | exact |
| `packages/harness/pageArtifacts.test.ts` (modify) | test | — | itself | exact |
| `apps/web/e2e/no-page-pan.spec.ts` / `touch-scroll.spec.ts` (modify) | test | — | itself | exact |

## Pattern Assignments

### `apps/web/src/lib/api/team.ts` (service, request-response)

**Analog:** `apps/web/src/lib/api/teams.ts` (full file, 54 lines) — copy verbatim shape, only the
schema/params/query-key change.

```typescript
// Source: apps/web/src/lib/api/teams.ts:17-53 — mirror exactly
import { artifactKey, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchTeamArtifactParams { teamKey: string; year: number; algorithmId: string; version: string }

export async function fetchTeamArtifact({ teamKey, year, algorithmId, version }: FetchTeamArtifactParams): Promise<TeamSeasonArtifact> {
  const key = artifactKey({ page: "team", teamKey, year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) throw new ArtifactFetchError("team", year, res.status);
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

**Import depth confirmed:** `apps/web/src/lib/api/` is 5 segments below repo root — the same
`../../../../../packages/harness/...` depth `teams.ts` already uses; `team.ts` sits in the same
directory so the depth is identical, not one shallower.

**Divergence from the analog (Pitfall 4, verified):** the route param is a plain team number
(`1114`), but `artifactKey({ page: "team", teamKey, ... })` needs the corpus key format
(`"frc1114"`, confirmed via `packages/corpus/db.test.ts:372` and `docs/publish-budget.md`'s
`v1/team/frc118/2024/...` key). The route component — not this fetcher — must do
`teamKey = \`frc${teamNumber}\`` before calling `teamQueryOptions`; name it as a constant/helper
(e.g. `toTeamKey(teamNumber: number)`), not a repeated inline template literal.

### `apps/web/src/routes/team.$teamNumber.tsx` (route, request-response)

**Analog:** `apps/web/src/routes/teams.tsx` (full file, 113 lines) for the `validateSearch` +
`useQuery` + `keepPreviousData` + parse-to-paint mark shape; `YearSelect.tsx`'s
`useSearch({ strict: false })` cast for any cross-route read needed inside child components.

```typescript
// Source: apps/web/src/routes/teams.tsx:13-16, 37-41 — mirror the route+query wiring
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: TeamSearchSchema,
  component: TeamPage,
});
// ...
const { data, isPending, error, refetch } = useQuery({
  ...teamQueryOptions({ teamKey, year, algorithmId: algorithm, version: version ?? "" }),
  enabled: version !== undefined,
  placeholderData: keepPreviousData,
});
```

**`TeamSearchSchema` — extend `RootSearchSchema`, same file as `TeamsSearchSchema`/`EventsSearchSchema`:**

```typescript
// Model directly on searchParams.ts:71-76 (TeamsSearchSchema) and :176-183 (EventsSearchSchema)
export const TeamSearchSchema = RootSearchSchema.extend({
  tab: z.enum(["overview", "history"]).catch("overview"),
});
export type TeamSearch = z.infer<typeof TeamSearchSchema>;
```
D-16 needs no `sort`/`sortDir` field at all — do not extend those in; a bare `tab` field is the
entire delta from `RootSearchSchema`.

**Route param → `teamKey` conversion belongs here** (Pitfall 4): read `Route.useParams().teamNumber`,
coerce to a number, build `teamKey` via the shared helper before calling `teamQueryOptions`.

### `apps/web/src/components/team/SeasonHeader.tsx` (component, request-response)

**Analogs:** `apps/web/src/components/MetricValue.tsx` (full file, 44 lines) for the `X ± Y`
primitive reused verbatim inside the tier box; `apps/web/src/components/teams-table/columns.tsx`
lines 47-58 for the record/win-rate string formatters (`formatRecord`, `formatWinRate` — copy the
same tiny pure functions rather than re-deriving); the shadcn `Avatar` primitive (new this phase,
per UI-SPEC) for the robot image + built-in fallback slot.

```typescript
// Reuse MetricValue.tsx:28-44 unchanged for every grid cell:
<MetricValue metric={seasonStats.metrics[key]} />
// D-17's tier box wraps this same primitive — background/foreground/padding only,
// never a different type scale (06-UI-SPEC.md Typography section, explicit).
```

```typescript
// Reuse columns.tsx:51-58 verbatim (copy, don't import from teams-table — different module):
function formatWinRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}
```

**Tier lookup is new this phase** — no analog exists for mapping a percentile to
`--tier-rare-bg`/`--tier-epic-bg`/`--tier-legendary-bg` (Common has no token, plain cell). Build a
small pure function `tierForPercentile(pct: number | undefined): "rare" | "epic" | "legendary" | undefined`
per `colour-and-tiers.md`'s cuts (50/75/95) and apply as a CSS class, mirroring how `MetricValue`
already applies `className` via `cn()`.

### `apps/web/src/components/team/EventSection.tsx` + `MatchTable.tsx` (component, request-response)

**No exact analog — D-10's shape is deliberately different from `TeamsTable.tsx`'s single
page-wide virtualized scroller (RESEARCH.md's own framing: "a different and more tractable shape,
not a repeat of Phase 5 D-04").** `TeamsTable.tsx` is still the right reference for **two**
specific sub-patterns, copied, not the whole component:

1. **Sticky pinned leading column via `position: sticky` + explicit `left` offset**
   (`TeamsTable.tsx:143-156, 205-219`) — reuse the identical CSS shape (`position: sticky`,
   `left: header.getStart("start")`/`cell.column.getStart("start")`, opaque `background`) for
   each event's own pinned "Match # / alliance team numbers" column, but scoped to **one native
   `overflow-x: auto` `<div>` per event section**, not one shared table-wide scroller. Each
   `EventSection` owns and renders its own `MatchTable`'s scroll container independently.
2. **`data-testid="teams-table-scroll"` naming convention** — mirror it per-section
   (`data-testid={`match-table-scroll-${eventKey}`}`) so `no-page-pan.spec.ts`'s existing
   `document.documentElement.scrollWidth <= clientWidth` assertion pattern extends cleanly to
   "N independent scrollers, zero page-level overflow," and `touch-scroll.spec.ts`'s
   `touchDrag` helper can target each one by testid the same way.

**`min-w-0` audit is the concrete, must-not-skip step (Pitfall 5, a real shipped regression):**
`no-page-pan.spec.ts`'s own header names the root cause verbatim — "flex children refusing to
shrink below their content (no `min-w-0`)." Every flex/grid ancestor of each event section's
`overflow-x: auto` region needs Tailwind's `min-w-0` class, following the existing repo convention
at `Ribbon.tsx:78,99,109,119` and `AlgorithmSelect.tsx:102` (`className="flex min-w-0 ..."`). This
is now needed 2-6+ times per team page (once per event section) instead of once per page.

```css
/* touch-action / overscroll-behavior — new to this repo, not previously used anywhere;
   RESEARCH.md Pitfall 6 flags iOS Safari reliability as MEDIUM-LOW confidence,
   schedule a checkpoint:human-verify rather than trusting CDP touch emulation alone */
touch-action: pan-x;
overscroll-behavior-x: contain;
```

**Row anatomy (band/tick/dot) has no codebase analog at all** — it is defined entirely by
`06-CONTEXT.md`'s D-06/D-07/D-08 and `uncertainty-display.md`'s locked geometry constants
(`BAND_H=8`, `DOT_H=12`, `TICK_H=14`, `PLOT_H=44`, `Y_RED=12`/`Y_BLUE=24`, per 06-UI-SPEC.md's
Spacing Scale exceptions). Compute every derived `top` from one function
(`centre = yBand + BAND_H / 2`) — this exact bug (independently-derived `top` values drifting
apart) already shipped once in a sketch per the UI-SPEC's own warning.

**Alliance color tokens, use verbatim, do not invent new hex values:**
```css
--alliance-red: #DC2626;   --alliance-red-soft: rgba(220, 38, 38, .30);
--alliance-blue: #2563EB;  --alliance-blue-soft: rgba(37, 99, 235, .30);
--loser-ink: #94A3B8;
```

### `apps/web/src/components/team/MetricHistoryChart.tsx` (component, streaming/client-render)

**No analog — first Recharts usage in the repo.** Build from RESEARCH.md's Don't-Hand-Roll table
(`ComposedChart` with `Area` + `Line`) and D-14's dynamic-import requirement:

```typescript
// Dynamic import gated on the chart tab opening (D-14) — no existing repo precedent for this
// exact code-split shape; RESEARCH.md is explicit this is NOT a repeat of the reverted D-19
// route-level split (05-CONTEXT.md), since Recharts is used by exactly one tab.
const MetricHistoryChart = lazy(() => import("./MetricHistoryChart"));
```

X-axis derivation (Pitfall 7, verified): use the team's own `metricHistory` array's **position**
(`index + 1`), never the row's `matchIndex` field directly (that field is season-wide, confirmed
by `packages/harness/metricHistorySchema.ts:28`'s own doc comment). Event-boundary detection: walk
consecutive rows and mark a boundary wherever `eventKey` changes — `metricHistorySchema.ts:25`
already carries `eventKey` per row, so no second `events[]` lookup is needed for grouping (only
for the display label).

### `apps/web/src/components/ribbon/YearSelect.tsx` (modify)

**Analog:** `AlgorithmSelect.tsx`'s `useAlgorithmOptions()` (same file family) — the "upgrade in
place, never remount" precedent UI-SPEC's E3 row cites directly.

```typescript
// Current YearSelect.tsx:34-49 (full component, unconstrained) — extend, don't replace
const search = useSearch({ strict: false }) as YearChangeableSearch;
const navigate = useNavigate() as unknown as CrossRouteNavigate;
// NEW: merge activeYears over SEASONS when on a team route, same "loose cast + graceful
// fallback" shape AlgorithmSelect.tsx:81 already uses for its own manifest-dependent options.
```
D-18's circularity risk (documented in RESEARCH.md Pattern 3): `YearSelect` mounts at the root
layout, above the route tree, so it cannot use `Route.useSearch()` for the team route's own typed
params — use `useLocation()`/`useMatches()` to detect "am I on a team route," same escape-hatch
class as the existing `useSearch({ strict: false })` cast one line above.

### `apps/web/src/components/search/SearchBox.tsx` (modify)

**Analog:** itself — `handleSelectTeam` at line 221 and the `SearchNavigate` type at line 52.

```typescript
// Current, line 52 — narrow union that must widen:
type SearchNavigate = (opts: { to: "/teams" | "/events"; search: (prev: Record<string, unknown>) => Record<string, unknown> }) => Promise<void>;
// Current, line 221 — the one call site D-15/D-16 repoint:
void navigate({ to: "/teams", search: (prev) => ({ ...prev, year: search.year, algorithm: search.algorithm }) });
```
Widen the union to `"/teams" | "/events" | "/team/$teamNumber"`, and change the team-hit handler's
`to`/`search` to build `/team/{teamNumber}` with `year`/`algorithm` preserved (D-15's route
excludes `frc`-prefix keys, so pass the plain number here, matching the route's own param shape).

### `apps/web/src/components/teams-table/columns.tsx` (modify)

**Analog:** itself — the `nickname` column's `cell` renderer (lines 73-81) is the pattern to wrap
in a `Link`; the `teamNumber` column (line 72) currently has no custom `cell`, needs one added.

```typescript
// Current nickname cell shape, columns.tsx:73-81 — wrap this pattern in a router Link,
// preserving the existing truncate+title treatment, do not replace it:
columnHelper.accessor("nickname", {
  header: "Nickname", size: 220,
  cell: (info) => (
    <span title={info.getValue()} className="block max-w-full">{info.getValue()}</span>
  ),
}),
```

### Publisher: `packages/harness/publish.ts` `buildTeamSeasonArtifact` (service, batch)

**Analog:** itself — the function's existing per-match mapping (lines ~320-349) and the
`eventName` bug site (line 958, verified live today).

```typescript
// Existing bug, publish.ts:958 (verified today) — the one-line fix:
eventName: eventKey, // WRONG — meta is already in scope one line below, use meta?.name ?? eventKey
```

```typescript
// Existing per-match field mapping, publish.ts:320-349 — the exact insertion points for
// D-01 (own-variance) and D-02 (actual RP): add alongside the existing `variance` line and
// the existing `actualWinner`/`actualRedScore`/`actualBlueScore` lines respectively.
variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
// NEW, same shape: redScoreVarianceOwn / blueScoreVarianceOwn, optional, OPR/EPA leave undefined
actualWinner: match.winner,
actualRedScore: match.redScore,
actualBlueScore: match.blueScore,
// NEW: actualRedRp: match.redRpEarned, actualBlueRp: match.blueRpEarned (both already on
// MatchResult per types.ts:47-48 — no ingest change needed, Pitfall 3)
```

**`metricsByTeam` reuse point for D-04 (percentile), verified insertion line:** `publish.ts:855`
(`metricsByTeam = algorithm.teamMetrics(...)`), consumed unchanged by `teamsRows` (~line 869) and
the per-team loop's `seasonStats.metrics` (~line 974) — a `withPercentiles(metricsByTeam,
teamsThisSeason)` pass belongs exactly at this reuse point, run once per (algorithm, season), so
both consumers see it without duplicating the ranking computation.

### `packages/harness/pageArtifacts.ts` (modify)

**Analog:** itself — every existing field on `TeamSeasonMatchSchema` (lines 249-279) and
`TeamSeasonArtifactSchema` (lines 322-331) is the shape new fields must match (required vs
`.optional()`, `z.number()` vs `z.number().int()`).

```typescript
// TeamSeasonMatchSchema — add alongside the existing `variance` field (same optionality pattern):
redScoreVarianceOwn: z.number().optional(),
blueScoreVarianceOwn: z.number().optional(),
actualRedRp: z.number().nullable().optional(),   // exact null-vs-omitted semantics: RESEARCH.md A5 — resolve against rp/constants.ts before finalizing
actualBlueRp: z.number().nullable().optional(),
// D-09: relax these three from required to optional (cannot .extend() — .refine() chain,
// rebuild the object literal per the existing isValidPmf() refine pattern at lines 272-279):
actualWinner: z.enum(["red", "blue", "tie"]).optional(),
actualRedScore: z.number().optional(),
actualBlueScore: z.number().optional(),
// NEW cross-field .refine(): a played match (has actualWinner) must carry both scores —
// mirrors the existing isValidPmf()-style refine, moves the guarantee from type to test (D-09).
```

```typescript
// TeamSeasonArtifactSchema — add alongside existing top-level fields (line 322-331):
robotImageUrl: z.string().optional(),      // D-03, ~25% of teams have none
activeYears: z.array(z.number().int()),    // D-05
```

```typescript
// TeamMetricSchema (line 153-156) — D-04's percentile field, same file, shared by both
// TeamsArtifactSchema and TeamSeasonArtifactSchema (RESEARCH.md Open Question 2: wire
// only the team artifact's CONSUMPTION this phase, per CONTEXT's scope):
const TeamMetricSchema = z.object({
  value: z.number(),
  spread: z.number().optional(),
  percentile: z.number().min(0).max(100).optional(),  // NEW
});
```

### `packages/harness/rounding.ts` (modify)

**Analog:** itself — `ROUNDING_RULE` (lines 62-64+) already has `metric: 2`, `score: 2`, and a
`variance` entry (referenced by `publish.ts:349`'s `roundTo(prediction.variance,
ROUNDING_RULE.variance)`, confirmed live). D-01's two new own-variance fields reuse
`ROUNDING_RULE.variance` unchanged — same physical quantity, same existing rounding rule, no new
entry needed. D-02's actual RP fields need a new entry (RP is an integer count, likely
`ROUNDING_RULE.rp = 0` or left unrounded as an already-integer value from `MatchResult` — decide
based on whether `redRpEarned`/`blueRpEarned` are guaranteed integral, verify against
`rp/constants.ts` per RESEARCH.md A5). D-04's percentile needs its own new entry (likely 1 decimal,
matching `colour-and-tiers.md`'s worked example precision — p50=39.2, not p50=39.20000001).

### `packages/core/algorithms/types.ts` + `sigma1/index.ts` (modify)

**Analog:** itself — `Prediction`'s existing optional-field convention (`variance?`,
`redComponents?`, `redRpPmf?` — all lines ~74-100) is the exact pattern the two new fields follow.

```typescript
// types.ts — add two fields, same optionality convention as `variance` above it:
redScoreVarianceOwn?: number;
blueScoreVarianceOwn?: number;
```

```typescript
// sigma1/index.ts's predict() return block (currently lines ~719-730) — the two local
// variables already computed two lines above (Pitfall 2 corrected citation) just need
// adding to the return object, unchanged elsewhere:
return {
  winner: pRedWin >= 0.5 ? "red" : "blue",
  pRedWin, redScore, blueScore, variance, redComponents, blueComponents,
  redScoreVarianceOwn, blueScoreVarianceOwn,   // NEW — already local vars, no new computation
  ...(rpResult.redPmf.length > 0 ? { redRpPmf: rpResult.redPmf } : {}),
  ...(rpResult.bluePmf.length > 0 ? { blueRpPmf: rpResult.bluePmf } : {}),
};
```
OPR/EPA's `predict()` never sets these two fields — they simply stay `undefined`, matching how
`variance`/`redComponents` are already selectively populated per algorithm.

### `packages/ingest/tbaClient.ts` (modify)

**Analog:** itself — `fetchTeamDetail` (lines 124-131, verified) is the exact shape to copy for
the new media call; ETag caching needs zero new infrastructure (`packages/corpus/db.ts`'s generic
`http_cache` table, `readEtag`/`writeEtag`, already keyed by URL).

```typescript
// Source: packages/ingest/tbaClient.ts:124-131 — existing pattern
export function fetchTeamDetail(ctx: TbaClientContext, teamKey: string, cachedEtag?: string): Promise<TbaFetchResult> {
  return tbaFetch(`/team/${teamKey}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}
// NEW, identical shape:
export function fetchTeamMedia(ctx: TbaClientContext, teamKey: string, year: number, cachedEtag?: string): Promise<TbaFetchResult> {
  return tbaFetch(`/team/${teamKey}/media/${year}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}
```
`THROTTLE_INTERVAL_MS = 100` (line 28) applies unconditionally, including on 304s — the media call
adds ~17,231 requests (distinct team-year pairs) ≈ 28.7 min per full ingest run, every run, not
just the first (RESEARCH.md, verified against `docs/publish-budget.md:32`). Photo-type allowlist
(`imgur`, `cdphotothread`, `instagram-image` — NOT `avatar`, which carries inline `base64Image`,
not a `direct_url`) is new selection logic with no repo precedent; filter before applying
"preferred, else first."

## Shared Patterns

### Named error classes over bare `throw new Error(...)`
**Source:** `apps/web/src/lib/api/errors.ts` (`ArtifactFetchError`, `ArtifactValidationError`,
already used by `teams.ts`/`events.ts`).
**Apply to:** `team.ts` — reuse the same two classes unchanged, just pass `"team"` as the resource
tag; do not create new error classes for the team fetcher.

### Zod validation at the fetch boundary, parse-before-return at the assembly boundary
**Source:** `packages/harness/pageArtifacts.ts` (schemas) + `publish.ts`'s "assembly functions
parse through their Zod schema before returning" convention (T-04-22, confirmed still true at
`buildTeamSeasonArtifact`'s own `const candidate = {...}` → parse pattern).
**Apply to:** every new field in `TeamSeasonMatchSchema`/`TeamSeasonArtifactSchema`, and
`buildTeamSeasonArtifact`'s continued parse-before-return after D-01…D-05 land.

### Deep relative imports with explicit `.js`, no `@sigmascout/*` alias
**Source:** confirmed again this session — `apps/web/src/lib/api/teams.ts:17`,
`apps/web/src/lib/searchParams.ts:15`. Still zero matches for any `@sigmascout/*` import
repo-wide.
**Apply to:** `team.ts`, and any new pipeline module importing across `packages/harness`/`packages/core`.

### "Upgrade in place, never remount" for a data-dependent control
**Source:** `AlgorithmSelect.tsx`'s `useAlgorithmOptions()`.
**Apply to:** `YearSelect.tsx`'s D-18 constrained-years merge — render the unconstrained/global
list first, narrow once `activeYears` resolves, never unmount/remount the `Select`.

### Sticky pinned column via `position: sticky` + `getStart("start")`
**Source:** `apps/web/src/components/teams-table/TeamsTable.tsx:143-156, 205-219`.
**Apply to:** `MatchTable.tsx`'s pinned leading column, scoped per-event-section instead of
page-wide (see EventSection/MatchTable pattern assignment above for the scoping delta).

### `min-w-0` on every flex ancestor of a horizontal-scroll region
**Source:** `apps/web/e2e/no-page-pan.spec.ts`'s own header (documents a real shipped bug) +
`Ribbon.tsx`/`AlgorithmSelect.tsx`'s existing `min-w-0` usage as the fix convention.
**Apply to:** every ancestor of `EventSection`'s per-event scroller — this is the single highest-
priority regression-prevention item in the phase (recurs 2-6+× per page instead of once).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/src/components/team/MetricHistoryChart.tsx` | component | streaming/client-render | First Recharts usage anywhere in the repo — build from RESEARCH.md's `ComposedChart` (Area+Line) guidance, not a codebase analog. |
| `apps/web/src/components/team/MatchTable.tsx`'s band/tick/dot row anatomy | component | request-response | No prior interval/uncertainty-band chart exists in this repo — build directly from `uncertainty-display.md`'s locked geometry constants and 06-UI-SPEC.md's Spacing Scale exceptions section, not from any existing component. |
| Percentile computation (`withPercentiles`, publish.ts) | utility | batch/transform | Genuinely new computation (RESEARCH.md Pattern 2) — no existing rank/percentile pass anywhere in `packages/harness`; the illustrative shape in RESEARCH.md is a starting point, not a verified implementation. |
| TBA media photo-type allowlist filter | utility | transform | No existing media-type filtering logic in `packages/ingest` — every other TBA client call consumes team/event/match detail shapes directly, never a heterogeneous `type`-discriminated array needing an allowlist. |
| `touch-action: pan-x` + `overscroll-behavior-x: contain` CSS combination | — | — | Not used anywhere in the repo today (`TeamsTable.tsx`'s single-scroller pattern relies purely on one native scroll element, no directional touch-action tuning). MEDIUM-LOW confidence per RESEARCH.md Pitfall 6 — schedule a real-device `checkpoint:human-verify`. |

## Metadata

**Analog search scope:** `apps/web/src/lib/api/**`, `apps/web/src/routes/**`,
`apps/web/src/components/**` (ribbon, teams-table, search, MetricValue, StateViews, Skeletons),
`packages/harness/pageArtifacts.ts`, `packages/harness/publish.ts`, `packages/harness/rounding.ts`,
`packages/core/algorithms/types.ts`, `packages/core/algorithms/sigma1/index.ts`,
`packages/ingest/tbaClient.ts`, `apps/web/e2e/*.spec.ts`.
**Files scanned:** 18 read directly (full or targeted ranges) this session, plus 2 grep sweeps
(`min-w-0` usage, `SearchNavigate`/`handleSelectTeam` call site).
**Pattern extraction date:** 2026-08-25
