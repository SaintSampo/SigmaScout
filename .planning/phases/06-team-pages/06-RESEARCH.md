# Phase 6: Team Pages - Research

**Researched:** 2026-08-25
**Domain:** Client-rendered team detail page (React/TanStack) + pipeline publisher additions (Zod schema + Sigma1 wiring) + nested-touch-scroll UI pattern + first-paint budget
**Confidence:** HIGH on codebase facts (all verified by direct `Read` this session, cited by path:line), MEDIUM on TBA API facts (primary-source OpenAPI spec fetched directly, not independently cross-checked by a second source), MEDIUM-LOW on the touch-gesture technique's real-device behavior (CSS mechanism is documented; iOS Safari enforcement has known historical gaps that only a device lab closes).

## Summary

Phase 6 is two intertwined jobs: (1) a pipeline change that adds five fields to an
already-published, already-massive artifact (`TeamSeasonArtifactSchema`) via one funnel
function (`buildTeamSeasonArtifact`, `packages/harness/publish.ts:320`), and (2) a client
page that reads those fields. The pipeline side is more tractable than CONTEXT's framing
suggests: three of the five additions (D-01 own-variance, D-02 actual RP, D-05 activeYears)
are wiring changes over data the pipeline already computes or already has access to — no new
modelling. D-03 (robot photo) needs one new TBA client call, already confirmed ETag-capable
by TBA's own OpenAPI spec. D-04 (percentile) is the only one requiring genuinely new
computation, and it has an exact, clean insertion point: right after `metricsByTeam` is
computed once per algorithm/season (`publish.ts:855`), before it's reused by both the teams
artifact and the per-team loop.

A second, unrelated defect was found during this pass and must be fixed as part of this
phase regardless of D-01…D-05: `buildTeamSeasonArtifact`'s per-event loop publishes
`eventName: eventKey` — the event's opaque key, not its real name — even though the exact
same `eventMeta` lookup one line below already carries `.name` (`publish.ts:955-960`). This
directly breaks TEAM-04/E5's "each section header shows event name + date" requirement and
must be corrected in the same publisher pass, not treated as pre-existing and out of scope.

On the client side, the highest-risk item (D-10, nested touch scroll) is a **different and
more tractable shape** than Phase 5's D-04, not a repeat of it — Phase 5 solved a harder
problem (a virtualized list needing exactly one native-scrolling element) by fusing both
scroll axes into one element with sticky pinned columns. Phase 6's per-event match tables
are small and unvirtualized (bounded match counts per event), so the correct pattern is N
independent native `overflow-x: auto` regions nested inside a normally-flowing, vertically
scrolling page — a well-documented CSS problem (`touch-action: pan-x` +
`overscroll-behavior-x: contain` + a pinned leading column), with one already-encountered,
concrete regression to guard against explicitly: Phase 5's `no-page-pan.spec.ts` records a
real shipped bug where a flex child without `min-w-0` let a nested horizontal-scroll
region's content width leak into `document.documentElement.scrollWidth`, making the *whole
page* pannable sideways. That bug recurs more easily in Phase 6 because it repeats once per
event section instead of once per page.

On first paint, the todo's own diagnosis is confirmed correct by the codebase
(`apps/web/index.html` is an empty shell, `main.tsx` does a plain `createRoot(...).render(...)`
CSR mount) — nothing paints until the JS bundle executes, and route-level code splitting was
already tried, measured, and reverted. The only remaining lever matching the todo's own
prescription is authored static markup (the ribbon wordmark, page chrome) placed directly in
`index.html` with critical CSS inlined, so the LCP element paints from raw HTML before
React hydrates.

**Primary recommendation:** Sequence the publisher/schema wave first (fix the eventName bug
in the same pass), landing the constrained-year-dropdown and percentile-computation work at
their natural insertion points named above; build the per-event match table as N independent
native `overflow-x: auto` regions (never a virtualizer) with `touch-action: pan-x` +
`overscroll-behavior-x: contain` + `min-w-0` audited on every flex ancestor, and treat the
static-shell first-paint fix as a page-shell-only change (no route splitting) verified with
the existing four-entry measurement method.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Team artifact schema/publish (D-01…D-05, eventName fix) | Data Pipeline (Node, offline) | — | `packages/harness/publish.ts` runs offline; nothing here executes in the browser or the Worker |
| Robot-photo resolution (D-03) | Data Pipeline / Ingest | — | `packages/ingest/tbaClient.ts` runs offline against TBA; the URL is baked into the published artifact, never fetched client-side (rejected explicitly in D-03) |
| Percentile computation (D-04) | Data Pipeline | — | Requires the full team pool for a season, already assembled in `publish.ts`'s per-algorithm loop; NAV-06 forbids doing this in the browser |
| Team route rendering, tab state, chart | Browser / Client | — | Pure client-rendered SPA (CLAUDE.md), no SSR; TanStack Router owns `?tab=`/year/algorithm |
| Constrained year dropdown (D-18) | Browser / Client | — | Reads `activeYears` off the already-fetched team artifact; no new fetch |
| Static-shell first paint | CDN / Static (`index.html`) | Browser / Client (hydration) | The fix is authored markup shipped as part of the static `dist/index.html` Cloudflare Pages serves, not a Worker or SSR concern |
| Artifact serving | CDN / Static (R2 custom domain) | — | Unchanged from Phase 4/5 — `https://data.sigmascout.org`, no compute in the path |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions (D-01…D-19, full text in `06-CONTEXT.md` — summarized here for planner reference; do not re-litigate)

- **D-01:** Publish each alliance's OWN predicted-score variance separately (currently only the
  red+blue sum is published). Sourced from values Sigma1 already computes and discards
  (`sigma1/index.ts`).
- **D-02:** Carry actual RP through to the published match row (currently only predicted RP is
  published).
- **D-03:** Pipeline resolves and publishes a robot image URL via TBA's
  `/team/{key}/media/{year}`; ~25% of teams have none — planner's discretion how to render the
  fallback.
- **D-04:** Publish a per-metric percentile per team (pipeline-computed, not client-derived).
- **D-05:** Publish `activeYears` on the team artifact.
- **D-06:** Shared score axis domain is per team-season (this team's own range), computed across
  the whole season including scheduled matches — not just played matches.
- **D-07:** Red always on top; this team's own alliance is marked in place (Claude's discretion:
  bolded team numbers, not row tint — resolved in UI-SPEC).
- **D-08:** A scheduled match uses the same row shape, both bands + ticks drawn at full weight, no
  actual dot; Actual column shows scheduled time.
- **D-09:** Single match list per event; `actualWinner`/`actualRedScore`/`actualBlueScore` become
  optional on `TeamSeasonMatchSchema`, replaced by a validation rule (a played match must carry
  scores) enforced as a test, not a type.
- **D-10:** Mobile uses horizontal scroll per event section — the single highest-risk item in this
  phase; inherits Phase 5 D-04's declared risk, but recurs once per event section.
- **D-11:** Metric-history chart shows Total only (not per-component).
- **D-12:** Chart x-axis is the team's own match sequence (1…n), not `metricHistory[].matchIndex`
  (season-wide index) directly; event boundaries marked, exact form is Claude's discretion.
- **D-13:** No spread band on OPR/EPA — draw a plain line, no explanatory copy.
- **D-14:** Recharts, dynamically imported behind the chart tab only — NOT a repeat of D-19's
  failed route split (different bundle-weight shape, must still be measured).
- **D-15:** Route is `/team/{number}` — plain team number, not `frc{number}`. Year/algorithm ride
  as search params.
- **D-16:** Tab is a URL search param, `?tab=…`.
- **D-17:** Season header shows Total + every component, tier-boxed (unlike the Teams table, where
  the sorted Total column is deliberately left unboxed).
- **D-18 (user-originated):** On a team page, the global year dropdown lists only years that team
  actually competed (`activeYears`) — a deliberate, scoped exception to Phase 5 D-11/D-12's
  "year dropdown options never change per page" rule.
- **D-19:** Empty state (wrong year) keeps the page, explains, offers the team's active years as
  links — never a silent redirect.

### Claude's Discretion

- Fallback treatment for the ~25% of teams with no robot photo (D-03).
- How the team's own alliance is marked within a red-on-top row (D-07) — **UI-SPEC already
  resolved this: bolded team numbers**, not row tint.
- Exact form of the chart's event-boundary marker (D-12) — **UI-SPEC already resolved this:
  alternating tinted vertical bands with a truncating event-name label**, not a plain divider.
- Whether the season header's component grid is a stat row, compact table, or chips — **UI-SPEC
  already resolved this: a tier-boxed grid**, per D-17.

### Deferred Ideas (OUT OF SCOPE)

- Per-component metric trajectories on the chart (D-11 ships Total only; additive later).
- Explaining the missing variance band on OPR/EPA (D-13, locked as silent).
- Revisiting the base palette (`ui-polish-pass.md`'s question 2) — only "depth within the current
  system" (question 1) is in scope.
- Cross-team comparison of match-plot bar positions — foreclosed by D-06's per-team domain.
- Surfacing per-algorithm freshness — still not part of this phase.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEAM-02 | Team page shows name, robot image for the year, TBA link | D-03's TBA media schema (verified below); `Avatar` shadcn primitive per UI-SPEC |
| TEAM-03 | Season stats: record, win rate, metrics | Already published (`seasonStats`, `TeamSeasonArtifactSchema` — verified unchanged); D-04's percentile addition needed for D-17's tier boxes |
| TEAM-04 | Section per attended/upcoming event; finished events show metrics as captured when the event ended | D-09's schema relaxation + validation-rule replacement (below); the `eventName` bug fix (below) blocks this requirement's "event name" display today |
| TEAM-05 | Per-match: both alliances, predicted winner/confidence/scores, predicted RP ± variance, actual scores, actual RP | D-01 (own-variance) + D-02 (actual RP) — both verified as wiring gaps, not new modelling, below |
| TEAM-06 | Second tab: metric plot with match x-axis, variance band for Sigma | D-11/D-12/D-13/D-14 (Recharts dynamic import), `metricHistory[]` already published and browser-safe (verified below) |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Stack is fixed: React 19.2.x, Vite 8.2.x, Tailwind v4, TanStack Router (typed search params —
  shareable state lives in the URL, never Zustand), TanStack Query, Recharts 3.10.x (dynamically
  imported), Zod 4.x for schemas.
- **NAV-06 (binding, restated by D-04's own reasoning):** no season statistics computed in the
  browser. Percentile computation belongs in the pipeline, not the client.
- No `@sigmascout/*` workspace alias exists — every cross-package import in `apps/web` is a deep
  relative path with an explicit `.js` extension (verified: `apps/web/src/lib/api/teams.ts:17`,
  `apps/web/src/lib/metricKeys.ts:21`).
- R2 is the primary artifact store; no compute in the client's read path; artifacts served from
  `https://data.sigmascout.org` (Phase 5 D-17a).
- Secrets rule: never `Read`/`cat`/`echo` `.env`; use `tsx --env-file=.env ...` for any TBA API key
  experimentation. No TBA key value appears anywhere in this document.

## Standard Stack

### Core (unchanged from Phase 5, already installed)

| Library | Version (installed, verified `apps/web/package.json`) | Purpose |
|---------|---------|---------|
| react / react-dom | 19.2.8 | UI |
| @tanstack/react-router | 1.170.32 | Routing, typed search params |
| @tanstack/react-query | 5.102.2 | Data fetching/caching |
| zod | (workspace root, used by `packages/harness`) | Schema validation |

### New this phase

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | **3.10.1** `[VERIFIED: npm registry — npm view recharts version, 2026-08-25]` | Metric-history chart (Total line + variance band) | CLAUDE.md-fixed dependency, no vetting gate applies (UI-SPEC "Registry Safety" section). Package-legitimacy check below. |

**Installation:**
```bash
pnpm --filter web add recharts
```

**Version verification:** `npm view recharts version` → `3.10.1`, published 2026-07-25
`[VERIFIED: npm registry]`. `npm view recharts dist-tags` confirms `latest: 3.10.1`, matching
CLAUDE.md's pinned `3.10.x`.

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm recharts`:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| recharts | npm | published 2026-07-25 (this version); package itself is long-established | 58,565,909/week | `github.com/recharts/recharts` | **OK** | Approved |

No `postinstall` script (`signals.postinstall: null`). No packages removed or flagged suspicious
this phase — `recharts` is the only new external dependency, and it is also a CLAUDE.md-fixed
choice, not a discovery via WebSearch/training data, so it does not need the `[ASSUMED]` gate the
package-provenance rule applies to search-discovered packages.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ OFFLINE PIPELINE (packages/harness, packages/ingest — Node, local)   │
│                                                                        │
│  TBA API ──fetch──▶ ingest/tbaClient.ts (+ NEW: fetchTeamMedia)      │
│    │                        │                                        │
│    │                        ▼                                        │
│    │              corpus/db.ts (SQLite, ETag cache: http_cache)      │
│    │                        │                                        │
│    ▼                        ▼                                        │
│  publish.ts: publishSeasons()                                        │
│    │  1. NEW: pre-pass over ALL seasons → activeYears per team (D-05)│
│    │  2. per season, per algorithm:                                  │
│    │       metricsByTeam = algorithm.teamMetrics(...)                │
│    │       NEW: withPercentiles(metricsByTeam, teamsThisSeason) (D-04)│
│    │       buildTeamsArtifact(...)        → teams/{year}/{algo}.json │
│    │       buildTeamSeasonArtifact(...)   → team/{key}/{year}/{algo}.json
│    │         (per event: FIX eventName bug; NEW D-01/D-02/D-03 fields)│
│    │         (metricHistory[] — already published, browser-safe)     │
│    └──────────────────────────────────────────────────────────────  │
│                        │ putObject (R2 PUT)                          │
└────────────────────────┼──────────────────────────────────────────── ┘
                          ▼
              R2 bucket, served at https://data.sigmascout.org
              (Cache-Control public max-age=60, ETag; no compute)
                          │
                          ▼ fetch() + Zod .parse()
┌─────────────────────────────────────────────────────────────────────┐
│ BROWSER (apps/web — pure client-rendered SPA, Vite build)             │
│                                                                        │
│  index.html (NEW: static shell markup, critical CSS) ──paints──▶ LCP │
│    │ (script module, deferred)                                       │
│    ▼                                                                  │
│  main.tsx → createRoot(#root).render(<RouterProvider/>)              │
│    │                                                                  │
│    ▼                                                                  │
│  /team/$teamNumber route (NEW)                                       │
│    │  validateSearch: TeamSearchSchema (year, algorithm, tab)         │
│    │  YearSelect (MODIFIED: route-aware, constrained via activeYears) │
│    │  fetchTeamArtifact() → teamKey = `frc${teamNumber}` → artifactKey│
│    ▼                                                                  │
│  Overview tab                          Metric History tab             │
│    season header (tier-boxed grid)       Recharts (dynamic import)   │
│    N × event section                       Total line + band         │
│      match table (native overflow-x,       x-axis = own match seq   │
│      touch-action: pan-x, pinned col)      event-boundary bands      │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions only)

```
apps/web/src/
├── routes/
│   └── team.$teamNumber.tsx        # NEW — /team/{number}, validateSearch TeamSearchSchema
├── lib/api/
│   └── team.ts                     # NEW — mirrors teams.ts exactly (fetch+Zod+TanStack Query)
├── components/
│   ├── team/
│   │   ├── SeasonHeader.tsx        # NEW — identity, image, TBA link, tier-boxed grid (D-17)
│   │   ├── EventSection.tsx        # NEW — one per event, owns its own overflow-x scroller
│   │   ├── MatchTable.tsx          # NEW — the band/tick/dot anatomy, shared axis per event
│   │   └── MetricHistoryChart.tsx  # NEW — dynamically imported, Recharts ComposedChart
│   └── ribbon/
│       └── YearSelect.tsx          # MODIFIED — route-aware constrained option list (D-18)
packages/harness/
├── pageArtifacts.ts                # MODIFIED — TeamSeasonMatchSchema, TeamMetricSchema, TeamSeasonArtifactSchema
├── publish.ts                      # MODIFIED — buildTeamSeasonArtifact + eventName fix + percentile pre-pass + activeYears pre-pass
├── rounding.ts                     # MODIFIED — ROUNDING_RULE entries for new fields (variance already exists at 4 decimals)
packages/core/algorithms/
├── types.ts                        # MODIFIED — Prediction interface gains redScoreVarianceOwn/blueScoreVarianceOwn
└── sigma1/index.ts                 # MODIFIED — predict()'s return object actually includes the two new fields
packages/ingest/
└── tbaClient.ts                    # MODIFIED — new fetchTeamMedia(ctx, teamKey, year, cachedEtag?)
```

### Pattern 1: Mirror the existing artifact-fetcher pattern exactly

**What:** `apps/web/src/lib/api/teams.ts` is the template: `artifactKey({page:...})` → `fetch` →
`Schema.parse()` → typed result, plus a `xQueryOptions()` helper for TanStack Query.
**Verified:** `apps/web/src/lib/api/teams.ts:17-53`, full text read this session.
**Team route difference:** `artifactKey({ page: "team", teamKey, year, algorithmId, version })`
needs `teamKey`, not the raw route param — see Pitfall "team number vs team key" below.

```typescript
// Source: apps/web/src/lib/api/teams.ts (verified, adapt for team.ts)
import { artifactKey, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchTeamArtifactParams { teamKey: string; year: number; algorithmId: string; version: string }

export async function fetchTeamArtifact({ teamKey, year, algorithmId, version }: FetchTeamArtifactParams): Promise<TeamSeasonArtifact> {
  const key = artifactKey({ page: "team", teamKey, year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) throw new ArtifactFetchError("team", year, res.status);
  const body: unknown = await res.json();
  try {
    return TeamSeasonArtifactSchema.parse(body);
  } catch (err) {
    throw new ArtifactValidationError("team", year, err);
  }
}
```

### Pattern 2: The publisher's `metricsByTeam` reuse point is where D-04 belongs

**Verified:** `packages/harness/publish.ts:852-878`. `metricsByTeam` is computed once per
(algorithm, season) at line 855 (`algorithm.teamMetrics(state, teamsThisSeason)`), then reused
unchanged both by `teamsRows` (line 869, feeds `teams/{year}` artifact) and by the per-team loop's
`seasonStats.metrics` (line 974, feeds `team/{key}/{year}` artifact). This is the single point
where a percentile-augmenting pass can run once and be consumed by both artifact kinds without
duplicating the ranking computation.

```typescript
// Illustrative shape, not verified against a committed implementation (none exists yet):
function withPercentiles(
  metricsByTeam: Record<string, TeamMetrics>,
  teamKeys: readonly string[]
): Record<string, TeamMetrics> {
  const metricNames = new Set<string>();
  for (const key of teamKeys) for (const name of Object.keys(metricsByTeam[key] ?? {})) metricNames.add(name);
  const percentileByTeamByMetric = new Map<string, Map<string, number>>();
  for (const name of metricNames) {
    const values = teamKeys
      .map((k) => ({ k, v: metricsByTeam[k]?.[name]?.value }))
      .filter((e): e is { k: string; v: number } => e.v !== undefined)
      .sort((a, b) => a.v - b.v);
    values.forEach((entry, i) => {
      const pct = (i / Math.max(1, values.length - 1)) * 100;
      if (!percentileByTeamByMetric.has(entry.k)) percentileByTeamByMetric.set(entry.k, new Map());
      percentileByTeamByMetric.get(entry.k)!.set(name, pct);
    });
  }
  // ... merge percentileByTeamByMetric back onto a copy of metricsByTeam
}
```

The exact percentile formula (rank/(n-1) vs. a different convention, tie handling) is an **open
question** — see below; `colour-and-tiers.md`'s own worked example (p50=39.2, p75=74.4, p95=167.8
on the real 2026 field) should be reproduced by whatever formula is chosen, as a regression check.

### Pattern 3: The constrained year dropdown must become route-aware (D-18)

**Verified:** `apps/web/src/components/ribbon/YearSelect.tsx` (full file read) is currently
route-agnostic — it renders `SEASONS` (a static list) with no fetch and no per-route logic.
`AlgorithmSelect.tsx`'s `useAlgorithmOptions()` (same file, lines 39-46) is the "upgrade in
place, never remount" precedent UI-SPEC's E3 row cites: it merges a fetched manifest **over** a
build-time constant, rendering all three algorithm ids from first paint and improving the
label once the manifest resolves — the same pattern the team page needs for `activeYears`.

```typescript
// Illustrative — mirrors useAlgorithmOptions' merge-over-constant shape:
function useConstrainedYears(): readonly number[] {
  const { pathname } = useLocation();
  const isTeamRoute = pathname.startsWith("/team/");
  const teamArtifact = useQuery({ ...teamQueryOptionsForCurrentRoute(), enabled: isTeamRoute });
  if (!isTeamRoute || !teamArtifact.data) return SEASONS; // unconstrained fallback (loading/error/non-team route)
  return teamArtifact.data.activeYears ?? SEASONS;
}
```

**Circularity risk to flag for the planner:** `YearSelect` is mounted once at the root layout
(above the route tree), so it cannot cleanly call `Route.useSearch()` for the team route's own
typed params. The existing components solve this with a loose `useSearch({ strict: false })` cast
(`YearSelect.tsx:35`, `AlgorithmSelect.tsx:81`) — the same escape hatch applies here, plus reading
`useLocation()` or `useMatches()` to detect "am I on a team route" without a strict route type.

### Anti-Patterns to Avoid

- **Deriving percentile client-side from the teams artifact.** Explicitly rejected by D-04 (NAV-06
  + the 1.4–2.7 MB download cost for one row). Do not "just compute it in the component" even
  though the teams artifact is technically reachable.
- **A second scrolling element per event that also tries to own vertical scroll.** The page's
  vertical scroll must stay the plain document/body scroll (or one shell-level container) — do
  not build a per-event or per-page custom vertical virtualizer for Phase 6 (match counts per
  event and event counts per team are both small; Phase 5's virtualizer solved a ~3,750-row
  problem this page does not have).
- **Treating D-01's "not yet published" gap as a data problem.** It is not — `sigma1/index.ts`
  already computes the exact two numbers (verified below); the gap is that `predict()`'s return
  object never includes them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chart with a shaded uncertainty band | A custom SVG/Canvas line+band renderer | Recharts `ComposedChart` (`Area` + `Line`) | CLAUDE.md-fixed choice; composable Area+Line directly matches the variance-band requirement |
| Percentile/rank computation | An ad-hoc client-side loop over the teams artifact | Pipeline-side pass at the `metricsByTeam` insertion point (Pattern 2 above) | NAV-06 forbids client recomputation; the pipeline already has the full team pool in memory at the right moment |
| ETag conditional caching for the new TBA media call | A bespoke cache layer for this one endpoint | `packages/corpus/db.ts`'s existing generic `http_cache` table (`readEtag`/`writeEtag`, keyed by URL) | Already works for every other TBA endpoint (`tbaClient.ts`'s `fetchTeamDetail` etc.); the media endpoint needs zero new caching infrastructure, only a new `fetchTeamMedia` function following the same `tbaFetch(...)` call shape |

**Key insight:** almost everything Phase 6's publisher side needs already exists somewhere in
the pipeline (variance numbers computed and discarded, RP already on `MatchResult`, ETag caching
already generic) — the work is wiring, not invention, except for D-04's percentile pass, which is
genuinely new but has one clean insertion point.

## Common Pitfalls

### Pitfall 1: `eventName` currently publishes the event KEY, not the name — a real, pre-existing bug

**What goes wrong:** `TeamSeasonEventSchema.eventName` is populated with `eventKey` verbatim
(`packages/harness/publish.ts:959`: `eventName: eventKey, // corpus has no event-name column — see events-row comment above`).
**Verified false today:** the comment is stale. The exact same function's `eventsRows` (feeding
`events/{year}` artifact) at `publish.ts:898` already reads `e.name ?? e.event_key` from
`eventMeta`, and the per-team loop at `publish.ts:956` (`const meta = eventMeta.find((e) => e.event_key === eventKey)`)
already has that same `meta` object in scope one line above the bug — `meta?.name ?? eventKey` is
a one-line fix using data already present in the loop.
**Why it happens:** the team-season loop predates Phase 5's EVNT-01 work, which added the `name`
column read to the sibling `eventsRows` builder but never propagated the fix here.
**How to avoid:** fix `eventName: meta?.name ?? eventKey` as part of this phase's publisher wave —
it blocks TEAM-04/UI-SPEC E5's "each section header shows event name + date" from ever showing a
real name.
**Warning signs:** a shipped team page whose event section headings are opaque strings like
`2024casj` instead of `"Sacramento Regional"`.

### Pitfall 2: `sigma1/index.ts:684` is not the exact line CONTEXT names, and the numbers are LOCAL VARIABLES, not on the `Prediction` object

**What goes wrong:** CONTEXT's D-01 cites "`sigma1/index.ts:684`" for
`redScoreVarianceOwn`/`blueScoreVarianceOwn`. Verified by direct read: the actual computation is
at **lines 685-686** (`const redScoreVarianceOwn = redPosteriorSum + redCovarianceTotal;` /
`const blueScoreVarianceOwn = bluePosteriorSum + blueCovarianceTotal;`), immediately below
`const ruleModule = rpRuleModuleForSeason(season);` at line 684 — a one-line citation offset, not
a wrong claim. More important: these are **local variables inside `predict()`**, used only to
call `predictAllianceRpMoments` (lines 687-688) for the RP pmf — they are **never attached to the
returned `Prediction` object**. The `return { ... }` block at `index.ts:719-736` includes
`winner, pRedWin, redScore, blueScore, variance, redComponents, blueComponents, redRpPmf?, blueRpPmf?`
and nothing else — `[VERIFIED: packages/core/algorithms/sigma1/index.ts:719-736]`.
**Why it happens:** the values were only ever needed transiently for the RP calculation; nobody
needed them published until now.
**How to avoid:** the planner must (1) widen `packages/core/algorithms/types.ts`'s `Prediction`
interface (currently lines 74-100, verified — only a combined `variance?: number` exists, no
per-alliance own-variance field) with two new optional fields, (2) have `predict()`'s return
object actually include them, (3) add the fields to `TeamSeasonMatchSchema`
(`pageArtifacts.ts:249-279`), (4) wire `buildTeamSeasonArtifact` (`publish.ts:325-349`) to round
and pass them through — OPR/EPA leave them `undefined` (never compute alliance-level own variance,
matching the existing optional-field convention for `variance`/`redComponents`).
**Warning signs:** a schema change with no corresponding `predict()` return-shape change will
silently publish `undefined` for every match, passing Zod validation (the fields are optional)
while showing nothing on the page — this must be caught by a test asserting the field is present
and non-`undefined` for at least one real Sigma1 match, not just schema-shape validation.

### Pitfall 3: Actual RP is already on `MatchResult` — do not treat D-02 as requiring new ingest work

**What goes wrong:** assuming D-02 needs a new TBA field or corpus column.
**Verified:** `packages/core/algorithms/types.ts:50-51` — `MatchResult` (which extends
`UpcomingMatch`) already carries `redRpEarned: number | null` / `blueRpEarned: number | null`.
`buildTeamSeasonArtifact`'s per-match mapping (`publish.ts:325-349`) receives
`{ match, prediction }: PredictionRecord` (verified `PredictionRecord.match: MatchResult`,
`packages/harness/replay.ts:30-33`), so `match.redRpEarned`/`match.blueRpEarned` are already
in scope inside the exact function that needs to publish them.
**How to avoid:** this is a pure schema+publisher wiring change — add
`actualRedRp`/`actualBlueRp` (exact names TBD by planner) to `TeamSeasonMatchSchema`, map from
`match.redRpEarned`/`match.blueRpEarned` (both nullable — decide whether `null` maps to
schema-`null`/omitted/0, and be explicit, since a null RP on a match with no RP rules for that
event tier is meaningfully different from "RP not yet carried through").
**Warning signs:** a plan task that includes "modify ingest/tbaClient.ts for D-02" is solving a
problem that does not exist — the data is already present two layers up from ingest.

### Pitfall 4: Team number in the URL is NOT the artifact's `teamKey`

**What goes wrong:** treating `/team/1114`'s `1114` as directly usable in `artifactKey({ page: "team", teamKey: ... })`.
**Verified:** `pageArtifacts.ts:117` builds `v1/team/${params.teamKey}/${params.year}/...` where
`teamKey` is the corpus's own key format — confirmed `"frc254"`/`"frc118"`/`"frc1114"` style via
`packages/corpus/db.test.ts:372` (`upsertTeam(db, { teamKey: "frc254", ... })`) and
`docs/publish-budget.md`'s own largest-object key (`v1/team/frc118/2024/...`). D-15 deliberately
chose the *route* to be the plain number (`/team/1114`, not `/team/frc1114`) specifically to keep
the internal key out of shareable URLs.
**How to avoid:** the route component must construct `teamKey = \`frc${teamNumber}\`` before
calling `artifactKey`/`fetchTeamArtifact` — a one-line but easy-to-miss conversion. Note this
`frc` prefix convention is FRC-specific to this corpus's TBA-derived keys and should be a named
constant/helper, not a repeated literal.

### Pitfall 5: `min-w-0` omission on flex ancestors — an already-shipped regression, more likely to recur here

**What goes wrong:** a nested horizontal-scroll region's intrinsic content width (the match
table's declared ~470px) forces a flex-child ancestor that has not set `min-width: 0` to grow
past its container, which propagates all the way to `document.documentElement.scrollWidth`,
making the **entire page** pannable sideways — not just the intended region.
**Verified as a real, previously-shipped bug, not a hypothetical:** `apps/web/e2e/no-page-pan.spec.ts`'s
own header: "Raised at plan 05-08's real-device sign-off: on a 390px phone the document was 459px
wide, so a horizontal drag panned the whole page instead of scrolling the table... root cause was
flex children refusing to shrink below their content (no `min-w-0`)."
**Why it happens more in Phase 6:** the Teams table has exactly one such region per page; Phase 6
has one per event section (2-6+ per team-season), so there are 2-6+ independent places this bug
can reappear, and it only needs to happen once to break the whole page.
**How to avoid:** audit every flex/grid ancestor of each event section's match-table scroller for
`min-width: 0` (Tailwind's `min-w-0`), and extend `no-page-pan.spec.ts`'s existing assertion
pattern (`document.documentElement.scrollWidth <= clientWidth`) to a team page with **multiple**
event sections rendered, not just one — a single-event fixture would not have caught the
original bug's shape and would not catch a per-section regression either.
**Warning signs:** `document.documentElement.scrollWidth > clientWidth` on a team page; visually,
the whole page including the header shifts sideways on a horizontal drag instead of just one
table region.

### Pitfall 6: `touch-action: pan-x` is not fully reliable on iOS Safari

**What goes wrong:** assuming `touch-action: pan-x` on the horizontal scroller, verified passing
in a Chromium/Playwright CDP touch-emulation test, means the gesture arbitration also works
correctly on a real iPhone.
**Evidence (web search, cross-referenced against MDN and a W3C pointerevents issue thread,
`[CITED: developer.mozilla.org/en-US/docs/Web/CSS/touch-action; github.com/w3c/pointerevents/issues/303]`,
MEDIUM confidence — not independently re-verified against a real device this session):** Safari's
historical `touch-action` support has been incomplete for directional values in nested-scroll
scenarios — an interactive region with a directional `touch-action` value inside a
different-axis outer scroller has been documented to receive a spurious `pointercancel` on iOS
Safari during a horizontal panning gesture unless the drag starts very cleanly on-axis.
`overscroll-behavior-x: contain` (the companion property preventing scroll chaining) has broader
support (`[CITED]`: "available across browsers since September 2022" per MDN) but Safari's
implementation has had known rough edges.
**How to avoid:** do not treat a passing Playwright/CDP touch-emulation test as proof this works
on iOS Safari — it drives Chromium's (or WebKit-build's) touch dispatcher, not necessarily
identical to a real iPhone's gesture recognizer. Explicitly schedule a real-device manual check
(`checkpoint:human-verify`) for the two-alliance match table on at least one real iOS device with
at least two adjacent event sections scrolled, per CONTEXT's own "highest-risk item" framing.
**Warning signs:** on a real iPhone, a horizontal drag inside a match table occasionally scrolls
the page instead, or a diagonal drag "sticks" to the wrong axis.

### Pitfall 7: `metricHistory[].matchIndex` is season-wide, not per-team — plotting it directly leaves gaps

**What goes wrong:** using `matchIndex` as the chart's x-axis value directly.
**Verified:** `packages/harness/metricHistorySchema.ts:28` — `matchIndex`'s own doc comment:
"This team's position in the season's chronological match stream — the same total order
`buildSeasonStream` produces, not a per-team match count." A team that plays fewer matches than
the season's overall stream length would show large gaps between points if `matchIndex` is used
directly as an x-coordinate (D-12 already states this outcome explicitly).
**How to avoid:** derive the x-axis as `1..n` over this team's own `metricHistory` array **in
its existing array order** (already per-team, already chronological for that team specifically —
confirmed by the field's own filtering: `MetricHistoryRowSchema.teamKey` scopes each row to one
team, and `TeamSeasonArtifactSchema.metricHistory` is already this team's own array, not the
season-wide one) — do not re-sort or re-index by the raw `matchIndex` value; use the array
position instead. `eventKey` is present on each row (`metricHistorySchema.ts:25`), which is
enough to derive event-boundary markers by detecting `eventKey` changes across consecutive rows,
without a second lookup into `events[]` for grouping (only for the display name).

## Code Examples

### TBA media endpoint — verified schema (official OpenAPI spec, fetched directly this session)

`[CITED: raw.githubusercontent.com/the-blue-alliance/the-blue-alliance/main/src/backend/web/static/swagger/api_v3.json,
fetched 2026-08-25]` — this is TBA's own source-of-truth spec file (the one that generates
`thebluealliance.com/apidocs/v3`), not a third-party summary.

**Endpoint:** `GET /team/{team_key}/media/{year}` — confirmed ETag-capable:
```json
// api_v3.json paths./team/{team_key}/media/{year}.get (excerpt, verified)
{
  "parameters": [{ "$ref": "#/components/parameters/If-None-Match" }, ...],
  "responses": {
    "200": { "headers": { "Cache-Control": {...}, "ETag": {...} }, "content": {"application/json": {"schema": {"type":"array","items":{"$ref":"#/components/schemas/Media"}}}} },
    "304": { "$ref": "#/components/responses/NotModified" }
  }
}
```
This confirms the existing generic `http_cache` ETag pattern (`packages/corpus/db.ts:590-602`)
applies unchanged — no new caching mechanism needed.

**`Media` schema (`components.schemas.Media_Base`, verified):**
```json
{
  "required": ["type", "foreign_key", "team_keys"],
  "properties": {
    "type": { "enum": ["youtube","cdphotothread","imgur","facebook-profile","youtube-channel",
      "twitter-profile","github-profile","instagram-profile","periscope-profile","gitlab-profile",
      "grabcad","instagram-image","external-link","avatar","onshape","cd-thread"] },
    "foreign_key": { "type": "string" },
    "preferred": { "type": "boolean", "description": "True if the media is of high quality." },
    "team_keys": { "type": "array", "items": { "type": "string" } },
    "direct_url": { "type": "string", "description": "Direct URL to the media." },
    "view_url": { "type": "string" }
  }
}
```

**Important, verified detail CONTEXT's own summary does not spell out:** `preferred` is **not**
in the `required` list, and `direct_url` is also not required — both are present only on some
media items. The `"avatar"` type is a **separate media kind** from a robot photo: its variant
(`Media_Avatar_Extras`) carries `details.base64Image` (an inline base64 image), not a
`direct_url` — this is the 40×40 logo case CONTEXT's D-03 already distinguishes from a robot
photo. **Photo-bearing types for a robot picture are `imgur`, `cdphotothread`,
`instagram-image`** (and possibly others depending on what teams actually upload) — the
selection algorithm must filter to an allowlist of photo-bearing `type` values before applying
"preferred, else first," or it risks picking a `youtube`/social-profile-link entry that has no
usable image URL at all. **This filtering step is not named in CONTEXT and is a real
implementation detail the planner must add.**

```typescript
// Source: packages/ingest/tbaClient.ts:124-131 (verified existing pattern to mirror)
export function fetchTeamDetail(
  ctx: TbaClientContext,
  teamKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/team/${teamKey}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

// New function to add, following the identical shape:
export function fetchTeamMedia(
  ctx: TbaClientContext,
  teamKey: string,
  year: number,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/team/${teamKey}/media/${year}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}
```

### Cost of running the media call across the corpus

`docs/publish-budget.md` line 32: `team/{teamKey}/{year}` count is **51,693** across "5 seasons ×
3 algorithms," meaning distinct (team, year) pairs = 51,693 / 3 = **17,231** — the true number of
media calls needed (media is not algorithm-scoped, one fetch per team-year, reused across all 3
algorithm publishes). `packages/ingest/tbaClient.ts:28` — `THROTTLE_INTERVAL_MS = 100` (enforced
per-request, unconditionally, including on cache-hit 304 responses, since the throttle wraps
`tbaFetch` itself before the conditional-request check). **17,231 × 100ms ≈ 28.7 minutes** added
to a full ingest run — every run, not just the first, since ETag caching saves bandwidth but not
request count or the throttle wait. `[VERIFIED: packages/ingest/tbaClient.ts:28, docs/publish-budget.md:32]`
— this is a real, recurring pipeline-runtime cost, not a one-time cost, and should be stated to
the user as such rather than assumed negligible.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Route-level code splitting to fix first paint | Static shell markup in `index.html` | Phase 5 D-19 close-out, 2026-08-24 (`docs/first-paint-measurement.md` fourth entry) | Splitting is explicitly forbidden as a fix for this phase's static-shell todo — do not re-propose it |
| Client-derives tier/percentile from a downloaded artifact | Pipeline computes and publishes percentile | This phase, D-04 | NAV-06 compliance; avoids downloading 1.4-2.7MB to tier one row |

**Deprecated/outdated:** the `eventName: eventKey` line in `publish.ts:959` and its stale comment
"corpus has no event-name column" are both outdated relative to Phase 5's EVNT-01 work — see
Pitfall 1.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact field names for D-01's two new variance fields, D-02's two RP fields, and D-04's percentile field are undecided (CONTEXT explicitly leaves them "exact field name TBD by planner") | Standard Stack / Code Examples | Low — purely a naming choice, easy to change before first publish, costly only after a real republish per D-01/D-02's own "costly to reverse" framing |
| A2 | The percentile formula (`rank / (n-1) * 100`, illustrative in Pattern 2) is not specified anywhere in CONTEXT or the sketch findings beyond the worked example's output numbers | Architecture Patterns / Pattern 2 | Medium — a different formula (e.g., `(rank+0.5)/n`) shifts every team's tier boundary slightly; should be checked against `colour-and-tiers.md`'s p50=39.2/p75=74.4/p95=167.8 reference numbers for the 2026 field as a regression test once real data is available |
| A3 | `touch-action: pan-x` + `overscroll-behavior-x: contain` + a pinned leading `position: sticky` column is presented as the recommended technique, but has not been built or tested this session — it is a synthesis of Phase 5's proven sticky-column CSS technique plus web-search-sourced (not hands-on-verified) touch-action/overscroll-behavior behavior | Common Pitfalls 6, Validation Architecture | High if iOS Safari's gesture arbitration does not behave as the CSS spec implies — this is exactly why a `checkpoint:human-verify` on a real device is recommended rather than treating a passing Playwright/CDP test as sufficient |
| A4 | Whether Media items with `type: "cdphotothread"` reliably carry a directly-usable `direct_url`, or require assembling a URL from `details.image_partial` (schema shows `image_partial` as a required detail field distinct from `direct_url`) was not tested against a real TBA response this session (no live API call was made, per the secrets-handling constraint on experimenting with the key) | Code Examples (TBA media schema) | Medium — if `cdphotothread` entries commonly lack a usable `direct_url`, the picking algorithm should either exclude that type from the photo allowlist or handle the `image_partial` reconstruction, which is unspecified here |
| A5 | `MatchResult.redRpEarned`/`blueRpEarned` being `null` is assumed to mean "no RP rules applied to this match's event tier" or "not yet computed" — the exact semantics of `null` vs. a real `0` were not traced through `rp/constants.ts`'s tier logic this session | Common Pitfalls 3 | Medium — publishing a bare `null` as `actualRedRp: null` without checking whether that's distinguishable from "RP rules apply but zero were earned" could misrepresent a match |

**Note:** most claims in this document are `[VERIFIED]` via direct `Read` of the cited file/line
this session, not `[ASSUMED]` — the assumptions above are specifically the gaps CONTEXT itself
left open (A1) or where this session's tools stopped short of a live/hands-on check (A3, A4, A5).

## Open Questions

1. **Should the Teams table's non-Total component columns also gain tier boxes, per
   `colour-and-tiers.md`'s own "tier the component columns everywhere" guidance?**
   - What we know: `colour-and-tiers.md` (the binding sketch-findings reference) states tiers
     should apply to component columns "everywhere," including "mixed sets (Event pages, Team
     pages, Compare, search results)" — arguably including the Teams table's non-sorted columns.
   - What's unclear: `06-CONTEXT.md`'s Phase Boundary only lists "wiring the search box and Teams
     table to the new route" as in-scope Teams-table work — no mention of adding tier boxes there.
   - Recommendation: treat this as out of scope for Phase 6 unless the planner/user explicitly
     pulls it in; flag it as a natural Phase 7/8 follow-up once D-04's percentile field exists on
     `TeamsArtifactSchema` too (it currently is only planned for `TeamSeasonArtifactSchema`).

2. **Does `TeamsArtifactSchema`'s `TeamsTableRowSchema` also need the percentile field, or only
   `TeamSeasonArtifactSchema`?**
   - What we know: D-04/D-17's stated need is the team page's header grid only.
   - What's unclear: if a future phase (see Open Question 1) wants Teams-table tier boxes, the
     percentile pass would need to also populate `TeamsArtifactTeamInput.metrics`, which the
     `withPercentiles` insertion point (Pattern 2) naturally could do at the same time for free
     (it already computes ranks across the same `teamsThisSeason` pool) — but doing so now is
     scope creep beyond what CONTEXT authorizes.
   - Recommendation: implement `withPercentiles` to run once and be reusable for both consumers
     structurally, but only wire the *team* artifact's consumption of it in this phase, so the
     capability exists without expanding this phase's published-schema surface further than D-04
     names.

3. **Exact null semantics for `MatchResult.redRpEarned`/`blueRpEarned`** — see Assumption A5;
   should be resolved by reading `packages/core/algorithms/sigma1/rp/constants.ts` and the RP
   rule modules before finalizing D-02's schema field types (nullable vs. omitted-when-absent).

## Environment Availability

No new external tool/service dependency this phase beyond what Phase 4/5 already established
(TBA API access, Cloudflare R2/Pages, Node 24, pnpm). The one new capability — TBA's
`/team/{key}/media/{year}` endpoint — is part of the same TBA API v3 the pipeline already calls
successfully; no separate availability check needed beyond the existing `TBA_API_KEY` env var
(already configured per Phase 1, per this project's Conventions section — never read its value).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| TBA API v3 `/team/{key}/media/{year}` | D-03 | ✓ (same host, same auth header pattern as all existing calls) | v3 | — |
| recharts | D-14/TEAM-06 | Needs `pnpm --filter web add recharts` | 3.10.1 | — |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit/component, root `vitest.config.ts` + workspace packages), Playwright (`apps/web/playwright.config.ts`, e2e) |
| Config file | `vitest.config.ts` (root); `apps/web/playwright.config.ts` |
| Quick run command | `pnpm --filter web test` (Vitest, includes component tests) |
| Full suite command | `pnpm test` (root Vitest across all packages) + `pnpm --filter web test:e2e` (Playwright, requires a deployed/served build per existing e2e specs' own preconditions) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEAM-02 | Robot image renders or fallback tile shows for ~25% no-photo case | component | `pnpm --filter web test -- SeasonHeader` | ❌ Wave 0 |
| TEAM-03 | Season stats render from `seasonStats` | component | `pnpm --filter web test -- SeasonHeader` | ❌ Wave 0 |
| TEAM-04 | Event section headings show real names (Pitfall 1 fix) | unit (pipeline) | `pnpm test -- publish.test` (extend existing `packages/harness/publish.test.ts`) | Partial — file exists, needs new case |
| TEAM-04 | Optional-actual-fields validation rule (D-09 replacement guarantee) | unit (schema) | `pnpm test -- pageArtifacts.test` (extend existing `packages/harness/pageArtifacts.test.ts`) | Partial — file exists, needs new case |
| TEAM-05 | `redScoreVarianceOwn`/`blueScoreVarianceOwn` present and non-`undefined` for a real Sigma1 match | unit | `pnpm test -- sigma1` (extend `packages/core/algorithms/sigma1/*.test.ts`) | Partial |
| TEAM-05 | Actual RP round-trips from `MatchResult` to published artifact | unit | `pnpm test -- publish.test` | Partial |
| TEAM-06 | Chart x-axis uses array position, not raw `matchIndex` | component | `pnpm --filter web test -- MetricHistoryChart` | ❌ Wave 0 |
| D-10 (highest risk) | Horizontal drag scrolls only the event's table; vertical drag scrolls the page; document never gains horizontal overflow across ≥2 event sections | e2e (Playwright, real CDP touch dispatch) | `pnpm --filter web test:e2e -- touch-scroll` (extend `apps/web/e2e/touch-scroll.spec.ts`) + extend `apps/web/e2e/no-page-pan.spec.ts` with a multi-event team-page route | Partial — both files exist, need team-page cases |
| D-10 (real-device gap) | iOS Safari gesture arbitration | manual (`checkpoint:human-verify`) | N/A — real device required | N/A |
| Static-shell first paint | Congested-venue LCP improves and clears 2.5s threshold | manual measurement | Reuse `docs/first-paint-measurement.md`'s fourth-entry method exactly (both builds, real CDP throttling, 4x CPU, median of 3) | Method exists; needs a fifth dated entry for the shell change |
| D-14 (Recharts deferral) | Chart-tab bundle is genuinely deferred and route-specific, unlike D-19's reverted route split | manual measurement | Same real-network A/B method as `docs/first-paint-measurement.md`'s fourth entry, applied to the chart tab's `import()` specifically | Method exists as a pattern; needs a new dated entry |
| Publish budget | Team artifact stays under `budgetMaxBytes: 375000` after D-01…D-05 additions | automated | `pnpm test -- payloadBudget` (existing `packages/harness/payloadBudget.test.ts`, re-run after a real `pnpm publish:seasons`) | ✓ exists, needs re-run with new fields |

### Sampling Rate

- **Per task commit:** `pnpm --filter web test` (component/unit) and `pnpm test` (pipeline
  packages) for whichever side changed.
- **Per wave merge:** full suite (`pnpm test` + `pnpm --filter web test:e2e`) plus a real
  `pnpm publish:seasons` re-run before trusting `payloadBudget.test.ts`'s numbers.
- **Phase gate:** all of the above green, plus the two manual measurements (first paint,
  D-10 real-device) recorded as dated entries in `docs/first-paint-measurement.md` before
  `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/web/src/lib/api/team.ts` + a test mirroring `apps/web/src/lib/api/teams.ts`'s own
      (implied) fetch/parse tests — none exists yet for the team fetcher since it doesn't exist.
- [ ] Component test files for `SeasonHeader.tsx`, `EventSection.tsx`, `MatchTable.tsx`,
      `MetricHistoryChart.tsx` — none exist (components don't exist yet).
- [ ] Extend `packages/harness/publish.test.ts` with: (a) the `eventName` fix regression case,
      (b) a case proving `redScoreVarianceOwn`/`blueScoreVarianceOwn` round-trip through
      `buildTeamSeasonArtifact`, (c) a case proving actual RP round-trips.
- [ ] Extend `packages/harness/pageArtifacts.test.ts` with the D-09 validation-rule test (a
      played match without scores fails; an unplayed match without scores passes).
- [ ] Extend `apps/web/e2e/no-page-pan.spec.ts` and `apps/web/e2e/touch-scroll.spec.ts` with a
      team-page route carrying ≥2 event sections.
- [ ] A percentile-formula unit test with a small synthetic team pool, checked against
      `colour-and-tiers.md`'s real-field worked numbers as a sanity bound (not exact match,
      since that reference used the real corpus, not a synthetic fixture).

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` (`.planning/config.json`, verified).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No user accounts exist or are planned (REQUIREMENTS.md "Out of Scope") |
| V3 Session Management | No | Stateless, no sessions |
| V4 Access Control | No | All published data is public by design (R2 objects served with no auth) |
| V5 Input Validation | **Yes** | Zod schemas at every boundary — `TeamSeasonArtifactSchema.parse()` on fetch (already the established pattern, `teams.ts:36`); `TeamSearchSchema` validates/`catch()`s every URL param before use (mirrors `TeamsSearchSchema`'s existing pattern, `searchParams.ts:71-76`) |
| V6 Cryptography | No | No credential storage or transmission on the client; the TBA API key lives only in the offline pipeline's `.env`, never shipped to the browser (this is exactly why D-03 rejected the browser-direct TBA media fetch option — see CONTEXT) |
| V13 (implicit, API/data) | Yes | R2 CORS policy already scopes `AllowedOrigins` to the site's own origins (Phase 5 D-18) — unchanged this phase, no new endpoint added client-side |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/hand-edited URL search params (`?tab=`, `?year=`) reaching render logic unvalidated | Tampering | `TeamSearchSchema` with `.catch()` fallbacks for every field, matching the existing `RootSearchSchema`/`TeamsSearchSchema` pattern (`searchParams.ts:43-50`) — never trust a raw `Route.useSearch()` value without having passed through `validateSearch` |
| A malformed/partial published artifact (bad publish run, network truncation) rendering as if valid | Tampering / Information Disclosure (partial data shown as complete) | `TeamSeasonArtifactSchema.parse()` on every fetch — already the established pattern; a parse failure must route to the existing `ArtifactValidationError` → error state, never a partial silent render |
| The TBA API key leaking into the client bundle via the D-03 "browser-direct" option that was considered and rejected | Information Disclosure | Already correctly avoided by CONTEXT's D-03 decision — the pipeline resolves the photo URL offline and publishes only the resulting public image URL, never the key or an authenticated request path, to the browser |
| Exact-name TBA media type confusion (e.g., an `avatar` type's inline `base64Image` accidentally used as if it were a `direct_url` string) | Tampering (data-shape) — not a security vulnerability per se, but a real correctness/DoS-adjacent risk (rendering a giant base64 string as an `<img src>` attribute, or a `type: undefined` string being treated as a URL) | Explicit type-allowlist filtering (Pitfall/Code Examples above) before ever reading `direct_url`; never assume every array entry has a usable image URL |

## Sources

### Primary (HIGH confidence — `[VERIFIED]`, direct `Read`/tool output this session)

- `packages/core/algorithms/sigma1/index.ts` (lines 640-737) — D-01's own-variance computation and
  return-shape gap
- `packages/core/algorithms/sigma1/covariance.ts` (lines 1-60) — the per-team covariance model
- `packages/core/algorithms/types.ts` (lines 1-100) — `Prediction`/`MatchResult` shapes, actual RP
  already present
- `packages/harness/pageArtifacts.ts` (full file) — every published schema, D-09's required-field
  claim confirmed
- `packages/harness/metricHistorySchema.ts` (full file) — `matchIndex`'s season-wide semantics
- `packages/harness/rounding.ts` (full file) — `ROUNDING_RULE`, tie-breaking contract
- `packages/harness/browserSafeSchemas.test.ts` (full file) — the Node-built-in import guard
- `packages/harness/publish.ts` (lines 1-100, 250-400, 720-1001) — `buildTeamSeasonArtifact`, the
  `metricsByTeam` reuse point, and the `eventName` bug
- `docs/publish-budget.md` (full file) — payload budget numbers, team-year count
- `docs/first-paint-measurement.md` (full file) — all four dated entries and methodology
- `.planning/todos/pending/static-shell-first-paint.md` (full file)
- `apps/web/src/components/teams-table/TeamsTable.tsx` (full file) — Phase 5's actual shipped
  single-scroll-element pattern
- `apps/web/e2e/touch-scroll.spec.ts` (full file) — the real-touch-drag CDP test pattern
- `apps/web/e2e/no-page-pan.spec.ts` (full file) — the shipped `min-w-0` regression and its test
- `apps/web/src/lib/api/teams.ts`, `apps/web/src/components/MetricValue.tsx`,
  `apps/web/src/lib/metricKeys.ts`, `apps/web/src/components/ribbon/YearSelect.tsx`,
  `apps/web/src/components/ribbon/AlgorithmSelect.tsx`, `apps/web/src/lib/searchParams.ts`,
  `apps/web/src/routes/teams.tsx` (all full files) — every client-side pattern cited above
- `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts` (full files) — confirms
  plain CSR mount, no current SSR/prerender mechanism, no active route splitting
- `packages/ingest/tbaClient.ts` (lines 1-131) — existing TBA client pattern, `fetchTeamDetail`
- `packages/corpus/db.ts` (lines 580-610) — generic ETag cache table
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`,
  `security_asvs_level: 1`
- `npm view recharts version` / `dist-tags` — 3.10.1 confirmed current
- `gsd-tools query package-legitimacy check --ecosystem npm recharts` — OK verdict

### Secondary (MEDIUM confidence — `[CITED]`, official primary source fetched directly, single source)

- `raw.githubusercontent.com/the-blue-alliance/the-blue-alliance/main/src/backend/web/static/swagger/api_v3.json`
  — TBA's own OpenAPI spec (the literal file that generates their public API docs), fetched
  2026-08-25: the `/team/{team_key}/media/{year}` endpoint definition, `Media`/`Media_Base` schema,
  ETag/`If-None-Match`/304 support confirmed structurally, not by a live authenticated call
  (secrets-handling constraint honored — no API key used or referenced).

### Tertiary (LOW-MEDIUM confidence — `[CITED]`/web search, cross-referenced but not hands-on verified)

- MDN `touch-action` and `overscroll-behavior-x` pages, and
  `github.com/w3c/pointerevents/issues/303` — iOS Safari's historical directional-`touch-action`
  gaps in nested-scroll scenarios. Not independently re-tested against a real device this
  session — see Pitfall 6 and Assumption A3.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — recharts version/legitimacy directly verified via npm/registry tooling
- Architecture (pipeline wiring, D-01/D-02/D-05 gaps): HIGH — every claim traced to an exact
  file:line this session
- Architecture (D-04 percentile insertion point): HIGH for the insertion point, MEDIUM for the
  exact formula (not specified in any binding document)
- Pitfalls (`eventName` bug, `min-w-0` regression, `teamKey` vs. team number): HIGH — all
  independently discovered/confirmed by direct code reading, not restated from CONTEXT
- Pitfalls (iOS Safari touch-action behavior): MEDIUM-LOW — web search only, flagged explicitly
  for real-device verification, not treated as settled
- TBA media API shape: MEDIUM — primary source (TBA's own spec file) but not cross-checked
  against a second independent source or a live call

**Research date:** 2026-08-25
**Valid until:** 30 days for the codebase-derived facts (stable unless another phase touches the
same files); the TBA API schema facts are stable (TBA's v3 API has been stable for years) but
should be re-confirmed with one real (non-secret-echoing) call during implementation, per
Assumption A4.
