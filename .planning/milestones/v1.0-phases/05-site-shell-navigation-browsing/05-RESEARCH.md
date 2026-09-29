# Phase 5: Site Shell — Navigation & Browsing - Research

**Researched:** 2026-08-23
**Domain:** Client-rendered React SPA (TanStack Router/Query) reading precomputed JSON artifacts from Cloudflare R2, with a virtualized 3,750-row table that must scroll on two axes under touch
**Confidence:** MEDIUM-HIGH — stack versions and in-repo artifact contracts are [VERIFIED]; the touch-scroll virtualization pattern and first-paint threshold are reasoned from official docs plus [CITED] web sources and are flagged for a small pre-build spike rather than presented as settled

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The Teams page renders **all ~3,750 teams in one continuous virtualized
  scroll**, ranked, sortable — not paged, not truncated to a top-N. Only the visible
  rows exist in the DOM. Matches the FRC convention (Statbotics and TBA both present
  one big sortable table rather than paging), and avoids the "where is my team"
  hunting that pagination forces. — **Reversibility:** reversible — a rendering
  choice local to one component.
- **D-02:** The browser makes **one fetch for the whole `teams/{year}` artifact**,
  exactly as Phase 4's D-01 intends. Sorting, filtering and searching are then local
  with no further requests. Measured artifact size: **1,361,992 B median, 2,721,887 B
  max** (~250–400 KB on the wire after compression). — **Reversibility:** reversible
  — the split escape hatch below remains available without republishing anything
  already shipped.
- **D-03:** **The slim search-index split stays deferred.** Phase 4's D-01 rejected
  splitting lists into a search index but explicitly flagged it for "revisit in Phase 5
  if the search box proves slow on the full table." That condition is not yet
  evidenced. Build the single-fetch version, **measure real first-paint and
  first-keystroke latency on a phone**, and introduce a published index artifact only
  if measurement shows it is needed. A new artifact kind means changing Phase 4's
  publisher and a full republish — do not pay that on speculation. — **Reversibility:**
  reversible — additive if later needed.
- **D-04:** On mobile the table keeps **every column, reached by horizontal scroll** —
  TEAM-01's number, name, rank, metric(s), record and win rate all remain present.
  Chosen over tap-to-expand rows and per-team cards because it is what TBA and
  Statbotics both do, so it matches what an FRC user expects on a phone.
  **Known implementation risk for research to solve, not discover:** a horizontal
  scroll region nested inside a virtualized vertical scroll makes the two touch
  gestures compete, and most virtualization libraries assume a single scroll axis.
  This needs a deliberate solution (e.g. a virtualizer that supports a fixed header
  plus horizontal overflow, or freezing the rank/team columns), not a default.
  — **Reversibility:** reversible.
- **D-05:** **Statbotics' information architecture, SigmaScout's own visual language.**
  Page structure, groupings and column choices stay familiar enough that an FRC person
  relearns nothing; palette, typography and density are distinct so the site does not
  read as a clone. — **Reversibility:** costly — this sets the visual contract
  every component in Phases 5–8 inherits.
- **D-06:** **Light theme only for now; dark deferred to a later phase.**
  **Engineering requirement attached to this decision:** all colors are defined as CSS
  custom properties (design tokens) from the first component, never as literals.
  — **Reversibility:** reversible if the token discipline holds; costly if it does not.
- **D-07:** **Sigma-family uncertainty is always visible in tables, at secondary
  weight** — `88.2 ±3.1` with the band in lighter/smaller type. — **Reversibility:** reversible.
- **D-08:** **Instant dropdown of top matches as the user types**, keyboard-navigable,
  Enter jumps to the top hit. Results span both teams and events. — **Reversibility:** reversible.
- **D-09:** **Matching is number-prefix plus name-substring.** `1114` matches 1114,
  11140, 11141; `simb` matches Simbotics anywhere in the name; `silicon` matches
  Silicon Valley Regional. — **Reversibility:** reversible.
- **D-10:** **Lazy-fetch the missing artifact on first search use.** NAV-03 requires
  search to reach teams *and* events from anywhere, but only one list is resident on
  any given page. On first focus or keystroke, fetch whichever is absent — the events
  artifact is small (~58 KB). Measure whether that first-keystroke delay is actually
  perceptible; only if it is does D-03's published index become justified.
  — **Reversibility:** reversible.
- **D-11:** **A year change preserves filters, sort and column state, and shows an
  honest empty state when the new year has no matches** — naming why, with a one-click
  clear. — **Reversibility:** reversible.
- **D-12:** **Year change on an event page maps to the same event code in the target
  year if it exists, otherwise lands on that year's Events list** with a brief note.
  — **Reversibility:** reversible.
- **D-13:** **An algorithm change holds position exactly** — same page, same scroll
  offset, same filters, same sort field where that field exists under the new
  algorithm — and only the values change. Note the edge the planner must handle:
  algorithms expose different metrics, so a sort on a column the new algorithm does
  not publish has to fall back to rank order rather than error. — **Reversibility:** reversible.
- **D-14 (defaulted, override at planning time if wrong):** **The URL carries year,
  algorithm, current view, sort field/direction, and active filters** — so a filtered,
  sorted table is shareable, not just the page. TanStack Router's typed search params
  are the mechanism. — **Reversibility:** costly — shared links outlive the code that made them.
- **D-15 (defaulted):** **Events filtering on mobile uses a collapsible filter sheet**
  rather than four inline dropdowns, with the active filter count visible on the
  trigger. — **Reversibility:** reversible.
- **D-16 (defaulted):** **First load shows a skeleton table**, not a spinner and not a
  blank page — header, ribbon and column headers render immediately from the shell
  while the artifact downloads. — **Reversibility:** reversible.

### Claude's Discretion

CONTEXT.md names no section explicitly titled "Claude's Discretion." The three
"defaulted by the builder (override at planning time if wrong)" decisions — D-14, D-15,
D-16 above — are the closest equivalent: sensible defaults the builder chose that the
planner is free to revisit if research or planning surfaces a reason to.

### Deferred Ideas (OUT OF SCOPE)

- **A published slim search index** (`v1/search/{year}.json` or similar) — deferred
  under D-03/D-10 until measurement shows the single-fetch path is too slow. Requires
  a new artifact kind in Phase 4 and a full republish.
- **Dark theme** — deferred under D-06. The token discipline is what keeps it cheap.
- **Surfacing per-algorithm freshness in the UI** (e.g. "sigma1 updated 40s ago,
  opr as of last re-baseline") — real information, but it is a new capability rather
  than part of browsing, and it needs a design of its own.

### Constraints Carried In

- **NAV-06 is the governing constraint:** pages render from precomputed artifacts,
  fast load is the top priority, and **no season statistics are recomputed in the
  browser**. Sorting and filtering already-published rows is presentation, not
  recomputation, and is allowed. Deriving a metric the artifact does not carry is not.
- **Phase 4 D-01 (costly to reverse):** one file per page the site renders.
- **Phase 4 D-02 (one-way):** algorithm version rides in the path, one file per
  `(page, year, algorithm@version)`. The algorithm dropdown keys on these paths.
- **Phase 4 D-25:** the browser reads artifacts from `https://sigmascout.org` — an R2
  custom domain with no compute in the path. Page traffic never touches the Worker.
- **Phase 4 D-26:** artifacts are served with `Cache-Control: public, max-age=60` and
  an ETag; conditional re-requests return 304. Client caching should cooperate with
  this rather than defeat it.
- **Stack is fixed** (`.claude/CLAUDE.md`): React 19 + Vite + Tailwind v4, TanStack
  Router for typed search params, TanStack Query for fetching, Zustand only for the
  small non-URL remainder, Recharts when charts arrive in Phase 6.
- **Live tier is sigma1-only.** `opr` and `epa` are fully published but refresh at the
  manual re-baseline rather than on the cron. The algorithm dropdown must not imply all
  three are equally live.
</user_constraints>

## Summary

Phase 5 is greenfield: `apps/web` does not exist. Everything it needs to read already exists and is [VERIFIED] by reading the actual Zod schemas in `packages/harness/pageArtifacts.ts` and `packages/harness/manifestSchemas.ts` — `TeamsArtifactSchema`, `EventsArtifactSchema`, and the algorithms/live-windows manifests. The three open questions CONTEXT.md flagged are answered below with code-level evidence: (1) the Teams table's touch-scroll risk has a concrete, named DOM/CSS solution (one native scroll container, `position: sticky` for pinned columns and the header — never nested scroll regions) that the UI-SPEC already selected (TanStack Table + TanStack Virtual), but no official example proves the three-way combination (row virtualization + column pinning + touch) at once, so a small, cheap spike is recommended as the first task rather than skipped; (2) first-paint measurement gets a runnable procedure (Lighthouse's mobile profile — Moto G Power emulation, Slow-4G throttling — against a deployed Pages preview, LCP as the metric, a locked-in 2.5s "good" threshold sourced from Google's own Core Web Vitals guidance) with an explicit decision rule tied to D-03; (3) the sort-fallback table is built from the real `teamMetrics()` implementations in `opr.ts`/`epa.ts`/`sigma1/index.ts` — OPR publishes only `total`, EPA and Sigma1 publish an *identical*, season-dependent component-key set (same `componentMapForSeason` source) plus `total`, and Sigma1 alone carries `spread`. A finding CONTEXT.md's D-13 did not name: because that key set is season-dependent, not just algorithm-dependent, the *same* fallback mechanism is also needed on a plain YEAR change while staying on EPA or Sigma1, not only on an algorithm switch — the planner should implement one shared fallback function, not two.

One architectural gap surfaced during research that CONTEXT.md does not address: `apps/web`'s eventual hosting domain relative to `https://sigmascout.org` (the R2 custom domain Phase 4's D-25 fixed as the read path) is undecided. R2 does not send CORS headers by default; if Pages ends up on a different origin than `sigmascout.org`, every artifact fetch will fail with a CORS error in the browser until an R2 CORS policy (or a same-origin routing rule) is added. This needs a decision before Wave 1 writes its first `fetch()` call — see Pitfall 1.

**Primary recommendation:** Scaffold `apps/web` with Vite + React 19 + Tailwind v4 + TanStack Router/Query, initialize shadcn against the confirmed preset, and open with a one-file spike proving TanStack Table's column pinning composes with TanStack Virtual's row virtualization under real touch input (iOS Safari + Android Chrome) before building the real ~3,750-row Teams table on top of that pattern.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ribbon nav, year/algorithm dropdowns, search box | Browser / Client | — | Pure UI chrome, no server round-trip beyond the one-time algorithms manifest fetch |
| URL state (year, algorithm, view, sort, filters) | Browser / Client (TanStack Router search params) | — | NAV-05 requires deep-linkability; router owns URL parsing/serialization, never a server session |
| Teams/Events artifact fetch, cache, revalidation | Browser / Client (TanStack Query) | CDN / Static (R2 + Cloudflare edge cache) | Client issues conditional GETs; R2's `Cache-Control`/ETag (Phase 4 D-26) does the heavy lifting so most reads never leave the edge |
| Table sort/filter/search-match logic | Browser / Client | — | NAV-06 forbids recomputing season statistics server-side or client-side; sorting/filtering already-published rows is presentation, explicitly allowed |
| Artifact computation (metrics, records, win rates) | Database / Storage (R2, written by the Phase 4 pipeline) | — | Out of this phase's scope entirely — NAV-06's governing constraint |
| Static asset hosting (JS/CSS bundle, fonts) | CDN / Static (Cloudflare Pages) | — | Vite build output, no SSR |
| Live-algorithm identity | API / Backend (Worker-authored manifests) | Browser / Client (reads manifest, does not compute) | `PUBLISHED_ALGORITHM_IDS`/`LIVE_ALGORITHM_IDS` are decided in the Worker/pipeline; the client only renders what the manifest says |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | Top ribbon navigates to Teams, Events, and Compare | TanStack Router file-based routes + a persistent root layout route; see Architecture Patterns |
| NAV-02 | Prominent global dropdowns select algorithm and year, re-slicing every page | Root-route `validateSearch` (Zod) shares `year`/`algorithm` across child routes; shadcn `Select` per UI-SPEC; see Code Examples |
| NAV-03 | Search bar finds teams and events | D-08/D-09/D-10 decisions plus shadcn `command` (cmdk); Pitfall 3 covers the matching-logic risk |
| NAV-04 | All pages usable on mobile and desktop | Tailwind v4 responsive utilities; D-04/D-15 mobile patterns; Pitfall 2 covers the touch-scroll risk |
| NAV-05 | Deep-linkable URLs: year, algorithm, current view encoded | TanStack Router typed search params (D-14); see Code Examples |
| NAV-06 | Render from precomputed artifacts, fast load priority, no client recomputation | `TeamsArtifactSchema`/`EventsArtifactSchema` [VERIFIED] carry every field TEAM-01/EVNT-01 need pre-computed; Validation Architecture section defines the fast-load measurement |
| TEAM-01 | Teams page: team #, name, rank, metric(s), record, win rate, ranked by selected algorithm | `TeamsArtifactSchema.teams[]` [VERIFIED] carries `teamNumber`, `nickname`, `record`, `metrics` (win rate is `wins/(wins+losses+ties)`, computed client-side from the published `record` — presentation, not recomputation); sort-fallback table below resolves the algorithm-dependent column set |
| EVNT-01 | Events page: all events for year, sortable/filterable by week, country, state, district | `EventsArtifactSchema.events[]` [VERIFIED] carries `week`; `country`/`stateProv`/`districtKey` are a **blocking Phase 4 prerequisite** not yet in the schema — see Pitfall 4 |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / react-dom | 19.2.8 [VERIFIED: npm registry] | UI library | Fixed by `.claude/CLAUDE.md`; current npm `latest` matches the CLAUDE.md-pinned `19.2.x` |
| vite | 8.2.2 [VERIFIED: npm registry] | Build tool / dev server | Fixed by CLAUDE.md; matches `8.2.x` |
| tailwindcss + `@tailwindcss/vite` | 4.3.3 [VERIFIED: npm registry] | Styling, CSS-first config | Fixed by CLAUDE.md; matches `4.3.x` |
| @tanstack/react-router | 1.170.32 [VERIFIED: npm registry] | Typed client-side routing + search params | Fixed by CLAUDE.md (D-14's mechanism); matches `1.170.x` |
| @tanstack/react-query | 5.102.2 [VERIFIED: npm registry] | Fetch/cache/revalidate artifacts | Fixed by CLAUDE.md; matches `5.101.x`+ |
| zustand | 5.0.15 [VERIFIED: npm registry] | Non-URL UI state only (filter-sheet open/closed) | Fixed by CLAUDE.md; matches `5.0.x` |
| @tanstack/react-table | 9.1.2 [ASSUMED — package legitimacy verdict SUS, see audit below] | Column definitions + column pinning for the Teams table | Selected by 05-UI-SPEC.md to resolve D-04's touch-scroll risk; same TanStack family already in the fixed stack, no new dependency family |
| @tanstack/react-virtual | 3.14.10 [ASSUMED — package legitimacy verdict SUS, see audit below] | Row virtualizer over the ~3,750-row array | Selected by 05-UI-SPEC.md alongside `react-table`; TanStack's own documented pairing for virtualized + pinned tables |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 1.33.0 [ASSUMED — package legitimacy verdict SUS, see audit below] | Icon set | UI-SPEC's icon library choice |
| cmdk (via shadcn `command`) | 1.1.1 [VERIFIED: npm registry] | Keyboard-navigable command/search palette | Backs shadcn's `command` block, which D-08's instant search dropdown is built on |
| class-variance-authority | 0.7.1 [VERIFIED: npm registry] | Variant-driven component styling | shadcn-generated components depend on this by convention |
| tailwind-merge | 3.6.0 [VERIFIED: npm registry] | Merge conflicting Tailwind classes safely | shadcn `cn()` utility dependency |
| clsx | 2.1.1 [VERIFIED: npm registry] | Conditional className composition | shadcn `cn()` utility dependency |
| @fontsource-variable/inter | 5.3.0 [VERIFIED: npm registry] | Self-hosted variable Inter font | UI-SPEC's font choice, avoids a Google Fonts network request |
| @testing-library/react | 16.3.x [ASSUMED — not independently re-verified this session, CLAUDE.md-pinned] | Component tests | CLAUDE.md fixed stack |
| @playwright/test | 1.62.x [ASSUMED — not independently re-verified this session, CLAUDE.md-pinned] | E2E smoke tests, including the real touch-scroll spike proof | CLAUDE.md fixed stack; Playwright's mobile device emulation (`playwright.devices['iPhone 13']` / `'Pixel 7'`) is the practical way to script the D-04 touch spike repeatably |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TanStack Table + TanStack Virtual for the Teams table | `react-window` + hand-rolled sticky columns | UI-SPEC already resolved this in favor of the TanStack pairing (keeps one library family, gets column pinning API for free); `react-window` has no first-class pinning API, more hand-rolled CSS |
| Native `overflow: auto` two-axis scroll on one container | Two nested scroll containers (outer vertical, inner horizontal) | The nested approach is the one D-04 explicitly warns against — see Pitfall 2 |
| Lighthouse mobile-profile throttling for first-paint measurement | Real physical mid-range phone on venue wifi | Real-device testing is the gold standard but not repeatable/CI-able for a hobby project; Lighthouse throttling is the industry-standard reproducible stand-in — see Validation Architecture |

**Installation:**
```bash
# from repo root, apps/web does not exist yet
mkdir apps/web && cd apps/web
pnpm create vite@latest . -- --template react-ts
pnpm add @tanstack/react-router @tanstack/react-query @tanstack/react-table @tanstack/react-virtual zustand
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @tanstack/router-plugin
npx shadcn@latest init   # preset: base color neutral, CSS variables on, radius 0.375rem
npx shadcn@latest add select command sheet badge skeleton button separator table
pnpm add lucide-react @fontsource-variable/inter
```

**Version verification:** every table row above marked `[VERIFIED: npm registry]` was checked live via `npm view <package> version` during this research session (2026-08-23); the three TanStack-family additions not already in CLAUDE.md's stack table were additionally run through the package-legitimacy gate (see below).

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------------------|-----------|--------------|---------|-------------|
| @tanstack/react-table | npm | 2026-08-09 (14 days old at research time) | 18,960,805/wk | github.com/TanStack/table | SUS (`too-new`) | Flagged — see note below |
| @tanstack/react-virtual | npm | 2026-08-18 (5 days old) | 22,385,091/wk | github.com/TanStack/virtual | SUS (`too-new`) | Flagged — see note below |
| lucide-react | npm | 2026-08-19 (4 days old) | 96,075,259/wk | github.com/lucide-icons/lucide | SUS (`too-new`) | Flagged — see note below |
| cmdk | npm | 2025-03-14 | 45,754,877/wk | github.com/pacocoursey/cmdk | OK | Approved |
| @fontsource-variable/inter | npm | 2026-07-19 | 3,289,928/wk | github.com/fontsource/font-files | OK | Approved |
| class-variance-authority | npm | 2024-11-26 | 64,252,913/wk | github.com/joe-bell/cva | OK | Approved |
| tailwind-merge | npm | 2026-05-10 | 82,587,051/wk | github.com/dcastil/tailwind-merge | OK | Approved |
| clsx | npm | 2024-04-23 | 120,733,077/wk | github.com/lukeed/clsx | OK | Approved |

**Packages removed due to `[SLOP]` verdict:** none.

**Packages flagged as suspicious `[SUS]`:** `@tanstack/react-table`, `@tanstack/react-virtual`, `lucide-react` — all three flagged solely on the `too-new` signal (most recent published version is within the legitimacy gate's freshness window), **not** on low downloads or a missing source repo. All three sit at 18.9M–96M weekly downloads and resolve to the well-known TanStack/lucide-icons GitHub orgs already used elsewhere in this stack (TanStack Router/Query are the fixed stack). This reads as a false-positive-prone signal for actively-maintained monorepo packages that ship frequent point releases, not a real hallucination/slopsquat risk — but per the Package Legitimacy Protocol the verdict stands as recorded. **The planner must add a `checkpoint:human-verify` task before the `pnpm add` step that installs these three**, confirming the installed version resolves to the expected GitHub org/repo (a 10-second `npm view <pkg> repository.url` check is sufficient).

*No package in this phase's dependency set was discovered via WebSearch/training-data-only provenance without a registry+repo cross-check; every package above was checked live against the npm registry this session.*

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────┐
                          │  Cloudflare Pages (apps/web static build) │
                          │  React 19 SPA, client-rendered only       │
                          └───────────────┬───────────────────────────┘
                                          │
            ┌─────────────────────────────┼──────────────────────────────┐
            │                             │                              │
            ▼                             ▼                              ▼
   ┌─────────────────┐         ┌───────────────────────┐      ┌─────────────────────┐
   │ TanStack Router  │         │  TanStack Query        │      │  Zustand (small,     │
   │ URL <-> {year,   │◄───────►│  fetch/cache artifacts  │      │  non-URL UI state:    │
   │ algorithm, view, │  reads  │  staleTime/refetchIvl   │      │  filter-sheet open)   │
   │ sort, filters}   │  search │                          │      └─────────────────────┘
   └────────┬─────────┘  params └──────────┬──────────────┘
            │                              │
            │ renders                      │ GET (conditional, ETag)
            ▼                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  https://sigmascout.org  — R2 custom domain (Phase 4 D-25)    │
   │  v1/teams/{year}/{algo}@{version}.json                        │
   │  v1/events/{year}/{algo}@{version}.json                       │
   │  v1/manifest/algorithms.json, v1/manifest/live-windows.json   │
   │  Cache-Control: public, max-age=60 + ETag (Phase 4 D-26)      │
   │  NO compute in this path — pure R2 object read                │
   └──────────────────────────────────────────────────────────────┘
            ▲
            │ written by (out of this phase's scope)
   ┌──────────────────────────────────────────────────────────────┐
   │  Phase 4 pipeline (offline publish) + Worker cron (live fold) │
   └──────────────────────────────────────────────────────────────┘

   Client-side flow for the Teams page (TEAM-01):
   URL search params ──► TanStack Query fetches teams/{year}/{alg}@{v}.json (one request, D-02)
        │                        │
        │                        ▼
        │              TanStack Table builds columns from the SELECTED algorithm's
        │              declared component keys (never inspects row data — UI-SPEC)
        │                        │
        │                        ▼
        │              TanStack Virtual virtualizes the ~3,750 rows over ONE native
        │              scroll container; pinned columns render as `position: sticky`
        │                        │
        └─────────► local sort/filter/search (no further network request, NAV-06)
```

### Recommended Project Structure

```
apps/web/
├── src/
│   ├── routes/                 # TanStack Router file-based routes
│   │   ├── __root.tsx          # ribbon, validateSearch for year/algorithm (shared)
│   │   ├── teams.tsx            # TEAM-01
│   │   ├── events.tsx           # EVNT-01
│   │   └── compare.tsx          # placeholder until Phase 8
│   ├── routeTree.gen.ts         # auto-generated by @tanstack/router-plugin — gitignored
│   ├── components/
│   │   ├── ui/                  # shadcn-generated primitives (select, command, sheet, ...)
│   │   ├── ribbon/
│   │   ├── teams-table/         # TanStack Table + Virtual composition lives here
│   │   ├── events-list/
│   │   └── search/
│   ├── lib/
│   │   ├── api/                 # fetchers + Zod parse of TeamsArtifactSchema/EventsArtifactSchema
│   │   ├── query-client.ts
│   │   └── search-index.ts      # D-08/D-09 matching logic (Pitfall 3)
│   ├── stores/                  # Zustand — filter-sheet UI state only
│   ├── styles/
│   │   └── theme.css            # Tailwind v4 @theme tokens, mirrors 05-UI-SPEC.md's tables
│   └── main.tsx
├── index.html
├── vite.config.ts               # @tailwindcss/vite + @tanstack/router-plugin/vite plugins
├── tsconfig.json                # extends ../../tsconfig.json, adds DOM lib + jsx — mirrors apps/worker's pattern
├── vitest.config.ts             # SEPARATE from root — needs environment: "jsdom", root config forces "node"
└── package.json
```

**Why a separate `vitest.config.ts` is required, not optional:** the root `vitest.config.ts` [VERIFIED: vitest.config.ts:1-10] already globs `apps/**/*.test.ts` but sets `environment: "node"` — `"import { defineConfig } from \"vitest/config\";\n\nexport default defineConfig({\n  test: {\n    include: [\"packages/**/*.test.ts\", \"scripts/**/*.test.ts\", \"apps/**/*.test.ts\"],\n    environment: \"node\",\n    globals: false,\n    passWithNoTests: true,\n  },\n});\n"`. Any `@testing-library/react` test placed under `apps/web` will run in that config with a `node` environment (no DOM) unless `apps/web` gets its own Vitest project/config with `environment: "jsdom"`. Wire this before the first component test, not after one mysteriously fails with "document is not defined".

**Why `apps/web/tsconfig.json` needs its own file, not the root one:** the root `tsconfig.json` [VERIFIED: tsconfig.json:1-16] `include`s only `["packages/**/*.ts", "scripts/**/*.ts", "vitest.config.ts"]` — `apps/**` is absent. `apps/worker/tsconfig.json` [VERIFIED: apps/worker/tsconfig.json:1-7] is the established pattern to copy: `"{\n  \"extends\": \"../../tsconfig.json\",\n  \"compilerOptions\": {\n    \"types\": [\"@cloudflare/workers-types\", \"node\"]\n  },\n  \"include\": [\"src/**/*.ts\", \"test/**/*.ts\"]\n}\n"`. `apps/web/tsconfig.json` should extend root the same way, override `lib`/`jsx`/`moduleResolution` for a Vite React app, and set its own `include`.

### Pattern 1: Root-route shared search params (NAV-02, NAV-05, D-14)

**What:** `year` and `algorithm` (plus `view`) are validated once at the root route with Zod via `validateSearch`, then every child route inherits and can extend them.
**When to use:** Any global control (the two dropdowns) that must re-slice whatever page is currently showing.
**Example (pattern shape — confirmed against official TanStack Router docs' `validateSearch` + Zod integration and the "Share Search Parameters Across Routes" guide):**
```typescript
// src/routes/__root.tsx
import { createRootRoute } from "@tanstack/react-router";
import { z } from "zod";

export const RootSearchSchema = z.object({
  year: z.coerce.number().int().default(CURRENT_SEASON),
  algorithm: z.enum(["opr", "epa", "sigma1"]).default("sigma1"),
});

export const Route = createRootRoute({
  validateSearch: RootSearchSchema,
  component: RootLayout,
});

// src/routes/teams.tsx — extends, does not replace, the root schema
const TeamsSearchSchema = RootSearchSchema.extend({
  sort: z.string().optional(),       // metric key; empty = TOTAL_METRIC_KEY
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
```
When navigating between routes, preserve inherited params with the function-updater form (`search: (prev) => ({ ...prev, sort: "hubShift1" })`) rather than an object literal, or a route change silently drops `year`/`algorithm` — this is the single most common way NAV-05's deep-link promise gets broken in practice.

### Pattern 2: One scroll container, sticky pinning — the D-04 touch-scroll answer

**What:** The Teams table uses exactly ONE native scrolling DOM element (`overflow: auto` on both axes) that TanStack Virtual's `useVirtualizer` also treats as its `getScrollElement`. Vertical virtualization repositions rows with `transform: translateY(...)` inside a tall spacer; horizontal scroll happens natively because the row's total rendered width (sum of every column's width) exceeds the container width. Pinned columns (`rank`, `teamNumber`, `nickname` per the UI-SPEC) get `position: sticky; left: <offset>px` computed from TanStack Table's `column.getStart('left')`, and the header row gets `position: sticky; top: 0`.

**The one non-negotiable rule:** never nest a horizontally-scrolling inner `<div>` inside the vertically-virtualized outer container. Two separate `overflow` regions is exactly the shape that makes iOS Safari and Android Chrome fight over which element owns an ambiguous-direction touch drag — a single element scrolling on both axes has no such ambiguity, because there is only one scroll target for the browser's native touch-scroll physics to resolve against.

**When to use:** Any table needing both vertical virtualization and horizontal overflow with frozen leading columns — this phase's Teams table is the only instance, but the pattern generalizes to Phase 6/7's per-algorithm tables too.

**Example (composition shape, confirmed against TanStack's own `column-pinning/sticky` and `virtualized-rows` official examples — no official example combines all three, see the spike note below):**
```typescript
// src/components/teams-table/TeamsTable.tsx
const parentRef = useRef<HTMLDivElement>(null);

const table = useReactTable({
  data: teams,
  columns,
  state: { columnPinning: { left: ["rank", "teamNumber", "nickname"] } },
  getCoreRowModel: getCoreRowModel(),
});

const rowVirtualizer = useVirtualizer({
  count: table.getRowModel().rows.length,
  getScrollElement: () => parentRef.current,   // SAME element the table scrolls in
  estimateSize: () => 40,                       // fixed row height — see Pitfall 2 (Android)
  overscan: 10,
});

// render: <div ref={parentRef} style={{ overflow: "auto", height: "..." }}>
//   <table style={{ width: table.getTotalSize() }}>
//     <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>...</thead>
//     <tbody style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
//       {rowVirtualizer.getVirtualItems().map(virtualRow => {
//         const row = table.getRowModel().rows[virtualRow.index];
//         return <tr key={row.id} style={{ position: "absolute", transform: `translateY(${virtualRow.start}px)` }}>
//           {row.getVisibleCells().map(cell => {
//             const pinned = cell.column.getIsPinned();
//             return <td style={pinned ? { position: "sticky", left: cell.column.getStart("left"), background: "var(--color-bg)" } : undefined}>
//               {flexRender(cell.column.columnDef.cell, cell.getContext())}
//             </td>;
//           })}
//         </tr>;
//       })}
//     </tbody>
//   </table>
// </div>
```

**Recommended spike before building the real table (D-04's own text: "not a default").** No official TanStack example proves row-virtualization + column-pinning + touch together in one demo. Build a throwaway single-file component — ~50 fake rows, ~12 fake columns (2026's real column count, see Priority Target 3 below), 3 pinned leading columns — using exactly the composition above, and manually verify on a real iOS Safari device and a real Android Chrome device (or Playwright's `devices['iPhone 13']`/`devices['Pixel 7']` emulation as a scripted proxy) that: (a) vertical drag virtualizes smoothly, (b) horizontal drag on the scrollable (non-pinned) region never gets hijacked by the vertical virtualizer, (c) pinned columns stay visually fixed with an opaque background during both scroll directions (see Pitfall 2's bleed-through note). This is a sub-hour spike; treat it as the first task of whichever plan owns the Teams table, before the real ~3,750-row/12-column build.

### Pattern 3: Algorithm/year-aware column derivation + sort fallback (D-13, Priority Target 3)

**What:** The Teams table's column SET is derived from the selected algorithm's declared `teamMetrics` output for the selected year — never from inspecting a row. Read directly from the real implementations:

- **OPR** [VERIFIED: packages/core/algorithms/opr.ts:286-299] — `"  teamMetrics(state: OprState, teams?: readonly string[]): TeamMetrics {\n    const requestedTeams = teams ?? [...state.lastEventByTeam.keys()];\n    const result: TeamMetrics = {};\n    for (const team of requestedTeams) {\n      const eventKey = state.lastEventByTeam.get(team);\n      if (eventKey === undefined) continue;\n      const rating = state.perEvent.get(eventKey)?.ratings.get(team);\n      if (rating === undefined) continue;\n      result[team] = { [TOTAL_METRIC_KEY]: { value: rating } };\n    }\n    return result;\n  },"` — publishes **only `total`**, never a `spread`.
- **EPA** [VERIFIED: packages/core/algorithms/epa.ts:513-530] — `"function teamMetrics(state: EpaState, teams?: readonly string[]): TeamMetrics {\n  ...\n    const perTeam: Record<string, { value: number }> = {};\n    let total = 0;\n    for (const [name, value] of Object.entries(components)) {\n      perTeam[name] = { value };\n      total += value;\n    }\n    perTeam[TOTAL_METRIC_KEY] = { value: total };\n    result[team] = perTeam;\n  }\n  return result;\n}"` — publishes one entry per learned component (season-dependent, see below) plus `total`, **never a `spread`**.
- **Sigma1** [VERIFIED: packages/core/algorithms/sigma1/index.ts:948-979] — `"function teamMetrics(state: Sigma1State, teams: readonly string[] | undefined, params: Sigma1Params): TeamMetrics {\n  ...\n      perTeam[name] = { value, spread: Math.sqrt(shrunkVariance) };\n    }\n    const totalVariance = Math.max(params.minConsistencyVariance, teamTotalVariance(teamState.covariance));\n    perTeam[TOTAL_METRIC_KEY] = { value: total, spread: Math.sqrt(totalVariance) };\n    result[team] = perTeam;\n  }\n  return result;\n}"` — publishes one entry per learned component **plus `spread`**, plus `total` **plus `spread`**.
- `TOTAL_METRIC_KEY` [VERIFIED: packages/core/algorithms/types.ts:120] — `"export const TOTAL_METRIC_KEY = \"total\";"` — the one key every algorithm guarantees.

**The critical shared-source fact:** EPA and Sigma1 both derive their per-season component keys from the SAME function, `componentMapForSeason(season).components` [VERIFIED: packages/core/algorithms/breakdown/index.ts:50-58, called at packages/core/algorithms/epa.ts:445 and packages/core/algorithms/sigma1/index.ts (imports `componentMapForSeason`, line 37)]. That means **for a fixed year, EPA and Sigma1 always expose the identical column-key set** — only OPR's set differs (it has none beyond `total`). Concrete worked examples, both [VERIFIED] by reading the season file:

| Season | Own-field components [VERIFIED: source] | Plus `foulsCommitted` | Plus `total` | Column count (EPA/Sigma1) |
|--------|-------------------------------------------|------------------------|---------------|----------------------------|
| 2022 | `autoTaxi, autoCargo, teleopCargo, endgame, adjust` [VERIFIED: packages/core/algorithms/breakdown/2022.ts:53-58 — `"const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, keyof z.infer<typeof SideBreakdownSchema>>> = {\n  autoTaxi: \"autoTaxiPoints\",\n  autoCargo: \"autoCargoPoints\",\n  teleopCargo: \"teleopCargoPoints\",\n  endgame: \"endgamePoints\",\n  [ADJUST_COMPONENT]: \"adjustPoints\",\n};"`] | yes | yes | 7 |
| 2026 | `autoTower, endGameTower, hubAuto, hubTransition, hubShift1, hubShift2, hubShift3, hubShift4, hubEndgame, adjust` [VERIFIED: packages/core/algorithms/breakdown/2026.ts:73-84 — `"const OWN_FIELD_COMPONENT_MAP: Readonly<Record<string, (side: Side2026) => number>> = {\n  autoTower: (side) => side.autoTowerPoints,\n  endGameTower: (side) => side.endGameTowerPoints,\n  hubAuto: (side) => side.hubScore.autoPoints,\n  hubTransition: (side) => side.hubScore.transitionPoints,\n  hubShift1: (side) => side.hubScore.shift1Points,\n  hubShift2: (side) => side.hubScore.shift2Points,\n  hubShift3: (side) => side.hubScore.shift3Points,\n  hubShift4: (side) => side.hubScore.shift4Points,\n  hubEndgame: (side) => side.hubScore.endgamePoints,\n  [ADJUST_COMPONENT]: (side) => side.adjustPoints,\n};"`] | yes | yes | 12 |

**Sort-fallback rule (resolves Open Question 3 concretely):**

1. On an **algorithm** switch: if the current sort key is not in the new algorithm's declared key set, fall back to `TOTAL_METRIC_KEY` descending, preserve direction, rewrite the `sort` search param. Given the shared-source fact above, this only ever actually fires switching *to or from OPR* — an EPA↔Sigma1 switch at a fixed year never needs the fallback, since their key sets are always identical.
2. **Not named by D-13, but the same code path is needed:** on a plain **year** change (D-11) while staying on EPA or Sigma1, the component key set can *also* change, because `componentMapForSeason` is per-season (2022's 7 keys vs. 2026's 12 keys above are proof). The exact same fallback function must run on both the D-11 year-change path and the D-13 algorithm-change path — implement it once (e.g. `resolveSortKey(newTeamMetricsKeys, currentSort)`), call it from both places, not as two independent implementations that could drift.

### Anti-Patterns to Avoid

- **Nested horizontal-scroll-inside-vertical-virtualized-scroll:** the exact shape D-04 warns against; causes iOS/Android touch-gesture conflicts. Use Pattern 2's single-container approach instead.
- **Deriving Teams table columns from row data:** UI-SPEC is explicit that columns come from the algorithm's declared `teamMetrics` keys, never from inspecting what a row happens to have — a row missing a declared component renders an em-dash, the column itself never disappears.
- **Two independent sort-fallback implementations** (one for algorithm switches, one for year switches) — see Pattern 3 above; they must share one function.
- **Re-rounding Sigma values client-side:** `05-UI-SPEC.md`'s Typography section is explicit that values arrive already rounded to 2 decimals (`packages/harness/rounding.ts`'s D-06 rule) — `toFixed(2)` is for restoring trailing zeros JSON dropped, never a new rounding operation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Virtualized table with pinned columns | A custom scroll-sync/pinning implementation | TanStack Table's `columnPinning` state + TanStack Virtual's `useVirtualizer` (Pattern 2) | Column pinning's sticky-offset math (`column.getStart('left')`) and virtualization's scroll-position bookkeeping are both easy to get subtly wrong under fast scroll; both libraries are already battle-tested and in the fixed stack family |
| Debounced/instant search matching over ~3,750+ rows | A fuzzy-matching library or a hand-rolled Levenshtein/trie | Plain `.filter()` with the number-prefix + substring rule D-09 already locked (no fuzzy matching decision to make) | D-09 explicitly rejected fuzzy matching; a simple prefix/substring scan over an in-memory array of a few thousand items is fast enough with no library at all — see Pitfall 3 for the one real risk (input escaping) |
| URL search-param serialization/parsing | Hand-rolled `URLSearchParams` get/set logic scattered across components | TanStack Router's `validateSearch` + Zod (Pattern 1) | Centralizes the type at the root route; a hand-rolled version is exactly how "the dropdown and the URL disagree" bugs happen, which CLAUDE.md names as the reason TanStack Router was chosen |
| Conditional-request caching cooperation | A custom `If-None-Match` fetch wrapper | TanStack Query's default `fetch()`-based query function plus the browser's native HTTP cache, both of which already understand the R2-set `ETag`/`Cache-Control` headers (Phase 4 D-26) | The browser's own HTTP cache already does the 304 dance for a plain `fetch()`; TanStack Query's `staleTime` layer is orthogonal and about avoiding even the conditional request, not about parsing cache headers by hand |

**Key insight:** every "hard part" of this phase — sticky+virtualized scrolling, typed URL state, conditional caching — already has a first-class library in the fixed stack built for exactly that problem. The actual custom code this phase writes is thin: column derivation from `teamMetrics`, the sort-fallback function, and the search-match predicate.

## Runtime State Inventory

Not applicable — this is a greenfield phase (`apps/web` does not exist), not a rename/refactor/migration. Skipped per the trigger condition.

## Common Pitfalls

### Pitfall 1: R2 CORS is undecided and will silently break every artifact fetch
**What goes wrong:** `apps/web`'s Cloudflare Pages deployment domain relative to `https://sigmascout.org` (the R2 custom domain Phase 4's D-25 fixed as the artifact read path) is not decided anywhere in the tree — confirmed by grep across `REBUILD_SPEC.md`, `docs/worker-operations.md`, and Phase 4's planning artifacts. If Pages ends up on a different origin (e.g. `sigmascout.pages.dev` or `app.sigmascout.org`) than `sigmascout.org` itself, every `fetch()` to the R2-served JSON will fail a browser CORS preflight, because **R2 does not send `Access-Control-Allow-Origin` headers by default** [CITED: developers.cloudflare.com R2 CORS docs, cross-checked via community reports of custom-domain CORS issues requiring a Transform Rule].
**Why it happens:** R2's default behavior assumes same-origin or API-token access; browser `fetch()` from a different origin triggers CORS enforcement that R2 doesn't satisfy unless a CORS policy is explicitly applied to the bucket (or a Cloudflare Transform Rule adds the header at the edge).
**How to avoid:** Decide the domain topology before Wave 1's first `fetch()` call. Two viable options: (a) put Pages on `sigmascout.org` itself with a path-based routing rule so `sigmascout.org/v1/*` still resolves to the R2 bucket (same-origin, no CORS needed) — cleanest if the routing rule is straightforward to add; or (b) keep Pages on its own subdomain/`.pages.dev` and add an explicit R2 CORS policy (`PUT .../?cors` with `AllowedOrigins` naming the Pages domain). This is a **checkpoint:human-verify decision**, not a default the planner should silently pick — flag it as an early planning-time question.
**Warning signs:** Every artifact `fetch()` in the browser console showing a CORS error with no network-tab response body, working fine from `curl`/Node (server-side requests aren't subject to CORS) — this exact "works everywhere except the actual browser" signature is diagnostic.

### Pitfall 2: Two-axis touch scroll — the D-04 risk, concretely
**What goes wrong:** If the Teams table implementation drifts from Pattern 2 (e.g., a well-meaning refactor wraps the horizontally-scrolling body in its own `<div style={{overflow-x: auto}}>` nested inside the vertically-virtualized outer container "to keep the header simpler"), iOS Safari and Android Chrome intermittently steal the wrong axis mid-drag — a diagonal-ish swipe becomes unpredictable about whether it scrolls the row list or the columns.
**Why it happens:** Nested `overflow` regions create two separate scroll-event targets; the browser's gesture-recognition heuristics for "which element owns this touchmove" are not perfectly reliable across engines, and iOS Safari specifically has a long history of momentum-scroll/scroll-chaining quirks with nested scroll containers.
**How to avoid:** Pattern 2's single-container rule, sticky positioning (not a second scroll region) for pinned columns and the header, and the pre-build spike named there. A secondary, purely-visual failure mode to also test in the spike: pinned-column cells need an **opaque background**, or unpinned content scrolling underneath will visibly bleed through the "frozen" column during a scroll — set `background: var(--color-bg-page)` (or the row's actual background) on every sticky cell, not `transparent`.
**Warning signs:** Manual touch testing shows the vertical list "stutters" or "jumps" when a horizontal drag is in progress, or a pinned column visibly shows scrolling content behind it.

### Pitfall 3: Unescaped user input in the search-match predicate
**What goes wrong:** D-09's matching rule ("number-prefix plus name-substring") is simple enough that an implementer may reach for a `RegExp` built directly from the raw search-box input (e.g. `new RegExp(query, "i")`) to do the substring match. Since the query is arbitrary user-typed text, a string like `(a+)+$` or similar catastrophic-backtracking pattern typed into the search box becomes a live regex against the browser's own main thread on every keystroke.
**Why it happens:** `String.prototype.includes()`/`startsWith()` and `RegExp` both "just work" for the demo case (`"simb"` in `"Simbotics"`); the regex path only breaks once a user (or an automated scanner/pen-test) types regex metacharacters.
**How to avoid:** Use plain `String.prototype.includes()`/`.startsWith()` for both the number-prefix and name-substring rules — D-09 does not require regex at all, and the plain string methods are both correct and immune to ReDoS by construction. If case-insensitive comparison is needed, lowercase both sides with `.toLowerCase()` rather than an `"i"`-flagged regex.
**Warning signs:** A code review sees `new RegExp(userInput, ...)` anywhere in the search path — treat this as a hard stop until confirmed not user-input-derived.

### Pitfall 4: Events filter columns don't exist yet — a blocking cross-phase dependency
**What goes wrong:** `EventsArtifactSchema`'s row shape [VERIFIED: packages/harness/pageArtifacts.ts:339-351] — `"const EventsListRowSchema = z.object({\n  eventKey: z.string().min(1),\n  name: z.string(),\n  eventType: z.number().int(),\n  isOffseason: z.boolean(),\n  startDate: z.string(),\n  week: z.number().int().nullable(),\n  teamCount: z.number().int().nonnegative(),\n  matchCount: z.number().int().nonnegative(),\n  playedMatchCount: z.number().int().nonnegative(),\n});"` — carries no `country`, `stateProv`, or `districtKey` field. EVNT-01 requires filtering by all three. Building the Events filter UI against the current schema will hit a wall immediately.
**Why it happens:** These fields exist on TBA's `event` object but were never added to Phase 4's publish step — the UI-SPEC's own "Cross-phase prerequisite (blocking)" section already names this and requires amending `EventsArtifactSchema`/`buildEventsArtifact` and republishing before Events-filter work starts.
**How to avoid:** Sequence a Phase-4-touching task (schema amendment + republish of `events/{year}` artifacts) as an explicit early wave, before any Events-filter component is built. This is not new data gathering — TBA already exposes `event.country`/`event.state_prov`/`event.district`.
**Warning signs:** None needed — this is a known, already-documented gap; the risk is only in sequencing it late.

### Pitfall 5: `vitest.config.ts` inheriting `environment: "node"` silently breaks component tests
**What goes wrong:** A `@testing-library/react` test dropped under `apps/web/` runs under the root config's `environment: "node"` [VERIFIED: vitest.config.ts:6, quoted in Recommended Project Structure above] unless `apps/web` defines its own environment. `render()` calls fail with `document is not defined` or similar, in a way that looks like a testing-library setup problem rather than a config-scoping problem.
**How to avoid:** Give `apps/web` its own `vitest.config.ts` (or a root `vitest.workspace.ts` entry) setting `environment: "jsdom"` (or `happy-dom`) scoped to `apps/web/**/*.test.tsx`, before the first component test is written.

## Code Examples

### TanStack Query setup against the Phase 4 serving endpoint (NAV-06, secondary research target)

```typescript
// src/lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Finished-season artifacts change at most once per manual re-baseline
      // (opr/epa) — long staleTime is correct and cheap. A LIVE event's
      // sigma1-scoped pages override this per-query with refetchInterval
      // (see below); the default here is the "quiet" case.
      staleTime: 5 * 60 * 1000, // 5 min
      retry: 1,
    },
  },
});

// src/lib/api/teams.ts
import { TeamsArtifactSchema } from "@sigmascout/harness/pageArtifacts"; // exact import path TBD at scaffold time — packages/harness is a workspace member
import { artifactKey } from "@sigmascout/harness/pageArtifacts";

export async function fetchTeamsArtifact(year: number, algorithmId: string, version: string) {
  const key = artifactKey({ page: "teams", year, algorithmId, version });
  const res = await fetch(`https://sigmascout.org/${key}`); // native fetch cooperates with
                                                              // the browser HTTP cache's own
                                                              // ETag/304 handling automatically
  if (!res.ok) throw new Error(`teams artifact fetch failed: ${res.status}`);
  return TeamsArtifactSchema.parse(await res.json()); // validate at the fetch boundary
}

// A live-event page (Team/Event detail, Phase 6/7) would instead pass:
// useQuery({ queryKey: [...], queryFn: ..., refetchInterval: 60_000 })
// scoped ONLY to sigma1 pages, matching Phase 4's LIVE_ALGORITHM_IDS=sigma1 scoping —
// Phase 5's Teams/Events pages are not per-team/per-event live-tick targets, so this
// phase does not need refetchInterval by default; note it here for Phase 6/7's benefit.
```

### Tailwind v4 `@theme` tokens mirroring 05-UI-SPEC.md's tables

```css
/* src/styles/theme.css */
@import "tailwindcss";

@theme {
  /* Color — from 05-UI-SPEC.md's Color table, D-06's token-discipline requirement */
  --color-bg-page: #F8FAFC;      /* slate-50, dominant 60% */
  --color-bg-surface: #F1F5F9;   /* slate-100, secondary 30%, ribbon/filter-sheet/cards */
  --color-accent: #4F46E5;       /* indigo-600, 10% — interactive/active only, never body text */
  --color-destructive: #DC2626;  /* red-600 — error states only, never a primary-action fill */
  --color-text-muted: /* exact value TBD — used for the Sigma spread suffix, Label 12/400 */;

  /* Spacing scale — from 05-UI-SPEC.md's Spacing Scale table */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --spacing-3xl: 64px;

  /* Radius — shadcn preset confirmed 2026-08-23 */
  --radius: 0.375rem;
}
```
*(Vite plugin wiring [CITED: tailwindcss.com/blog/tailwindcss-v4, cross-checked via multiple 2026 setup guides]: `import tailwindcss from "@tailwindcss/vite"` in `vite.config.ts`'s `plugins` array, plus a single `@import "tailwindcss";` line in the app's entry CSS — no `postcss.config.js`, no `tailwind.config.js`, no `autoprefixer` needed for a standard Vite setup.)*

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `tailwind.config.js` JS-based theme config | CSS-first `@theme` directive in a plain CSS file | Tailwind v4.0 (this project is on 4.3.x) | Design tokens live in CSS, not JS — matches this phase's CSS-custom-property discipline (D-06) natively rather than requiring a JS-to-CSS-var bridge |
| `react-window`/hand-rolled virtualization for large tables | TanStack Virtual + TanStack Table's column-pinning API composed together | Ongoing TanStack ecosystem convergence (both libraries share the same maintainer org and API philosophy) | One library family instead of two, first-class pinning support |
| `cacheTime` (React Query v4 naming) | `gcTime` (React Query v5 naming) | TanStack Query v5 | Cosmetic rename only — same behavior, relevant if any v4-era blog post/example is consulted during implementation |

**Deprecated/outdated:** None specific to this phase's stack surfaced during research — every library recommended above is the current major version already fixed by CLAUDE.md or freshly verified against the npm registry.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `@tanstack/react-table`, `@tanstack/react-virtual`, and `lucide-react` are legitimate despite the `too-new` SUS verdict (based on download counts + known GitHub orgs, not independently confirmed via an official announcement) | Package Legitimacy Audit | Low — the planner's required `checkpoint:human-verify` task before install catches a genuine slopsquat; the download-count/repo evidence makes a false positive far more likely than a real one |
| A2 | Domain topology for `apps/web` relative to `sigmascout.org` is unresolved and requires a human decision, not a default this research picked | Pitfall 1 | Medium — if the planner silently assumes same-origin and it isn't, every artifact fetch fails at first deploy; flagged explicitly as a pre-Wave-1 decision point, not silently defaulted |
| A3 | A 2.5s LCP threshold (Google's Core Web Vitals "good" boundary) is the right number to gate D-03's search-index-split decision, rather than a number derived from FRC-specific user expectations | Validation Architecture | Low-Medium — it's a well-established industry default, but CONTEXT.md never named a number itself; if the actual answer should be stricter (e.g. venue wifi is worse than Slow-4G) the threshold may need revisiting after a first real measurement |
| A4 | `sigma1@2.0.0+tuned-2026-08`'s 2024 teams artifact (2,721,887 B, the measured max) remains the correct "worst case" artifact to use for the first-paint measurement — no larger one has since been published | Validation Architecture | Low — sourced directly from `docs/publish-budget.md`'s committed, test-enforced budget figures; would only be wrong if a later season materially exceeds it |
| A5 | The exact import path for `TeamsArtifactSchema`/`artifactKey` from `apps/web` (shown as `@sigmascout/harness/pageArtifacts` in Code Examples) is illustrative, not a confirmed workspace package name/export map | Code Examples | Low — `packages/harness` is a real pnpm workspace member; the planner should confirm the actual package name/exports field at scaffold time rather than copy the illustrative import path literally |

## Open Questions

1. **Domain topology for `apps/web` vs. `sigmascout.org`.**
   - What we know: Phase 4's D-25 fixed `https://sigmascout.org` as the R2 read path; R2 has no CORS headers by default; `apps/web` has no assigned domain anywhere in the tree yet.
   - What's unclear: whether Pages will share the `sigmascout.org` origin (via a routing rule) or live elsewhere (requiring an R2 CORS policy).
   - Recommendation: resolve this as a checkpoint:human-verify decision in Wave 1, before the first `fetch()` call is written — see Pitfall 1.

2. **Whether the D-03/D-10 measurement (Validation Architecture, below) will actually show the single-fetch approach is fast enough.**
   - What we know: the runnable procedure and threshold are defined below.
   - What's unclear: the actual number, since nothing has been built yet to measure.
   - Recommendation: run the measurement procedure as an early Wave-1/Wave-2 task (as soon as a real Teams page exists against real or fixture data), not deferred to the end of the phase, so a "yes, build the search-index split" verdict doesn't arrive after everything else is already built assuming it isn't needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Vite dev server, pnpm scripts | ✓ (repo already runs Node-based tooling) | 24.x LTS per CLAUDE.md | — |
| pnpm | Workspace install | ✓ (root `package.json` pins `packageManager: pnpm@11.21.0`) | 11.21.0 | — |
| Cloudflare Pages project for `apps/web` | Hosting the built SPA | ✗ — not yet provisioned (greenfield) | — | Must be created as part of this phase's scaffolding, alongside the domain-topology decision in Pitfall 1 |
| `https://sigmascout.org` R2-served artifacts | Every fetch this phase makes | ✓ — confirmed live and serving with `Cache-Control`/ETag by Phase 4's own UAT [VERIFIED: `.planning/phases/04-publish-live-update-pipeline/04-UAT.md:26`] | — | — |
| Real iOS Safari / Android Chrome devices (or BrowserStack/Playwright emulation) for the D-04 touch spike | Pattern 2's spike | Not verified this session — assume Playwright's built-in device emulation (`@playwright/test`, already CLAUDE.md-fixed) as the available fallback if a physical device lab isn't on hand | — | Playwright device emulation is a reasonable stand-in for the spike; a physical-device spot-check remains the higher-confidence option if available |

**Missing dependencies with no fallback:** none — the Cloudflare Pages project itself is a "must create" scaffolding step, not a blocker.

**Missing dependencies with fallback:** physical touch-device access (fallback: Playwright emulation).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x (root-pinned) for unit/component logic; `@testing-library/react` 16.3.x for component behavior; `@playwright/test` 1.62.x for the touch-scroll spike and deep-link E2E proof — all three [ASSUMED — CLAUDE.md-pinned, not re-verified this session beyond the root Vitest version already confirmed elsewhere in this repo] |
| Config file | none yet — `apps/web/vitest.config.ts` is a Wave 0 gap (see Pitfall 5) |
| Quick run command | `pnpm --filter web test -- --run <file>` (once `apps/web/package.json` exists with a `test` script matching the worker's pattern) |
| Full suite command | `pnpm test` (root script already runs `vitest run` across the whole workspace glob) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| NAV-05 | URL round-trip: set year/algorithm/sort/filters, serialize to URL, parse back, state matches | unit | `vitest run src/routes/__root.test.ts` | ❌ Wave 0 |
| NAV-02 | Changing year/algorithm dropdown re-slices the current page's data (not just triggers a refetch that never resolves) | integration (`@testing-library/react` + a mocked TanStack Query fetcher) | `vitest run src/components/ribbon/*.test.tsx` | ❌ Wave 0 |
| TEAM-01 (D-13 sort fallback) | Algorithm switch onto OPR with a component-column sort active falls back to `total` descending, preserves direction | unit | `vitest run src/lib/resolveSortKey.test.ts` | ❌ Wave 0 |
| TEAM-01 (D-11 + season component drift) | Year switch while on EPA/Sigma1 with a sort key absent from the new season's component map falls back correctly (Pattern 3's "not named by D-13" finding) | unit | `vitest run src/lib/resolveSortKey.test.ts` (same file, additional cases) | ❌ Wave 0 |
| D-04 touch scroll | Vertical virtualized scroll and horizontal pinned-column scroll never steal each other's gesture on real/emulated touch | manual-only (spike), then E2E once built | Playwright `devices['iPhone 13']`/`devices['Pixel 7']` scripted drag sequences | ❌ Wave 0 — this is the spike itself |
| NAV-06 (fast load) | First paint of the largest real Teams artifact stays under the locked threshold | measurement, not source assertion — see procedure below | `npx lighthouse <preview-url>/teams --preset=perf --emulated-form-factor=mobile --throttling-method=simulate --output=json` | ❌ Wave 0 (needs a deployed preview to point at) |
| EVNT-01 filters | Filter option lists derive from the fetched Events artifact's distinct values; a null field is excluded from the option list, never bucketed as "Unknown" | unit | `vitest run src/components/events-list/filters.test.ts` | ❌ Wave 0 |
| D-09 search matching | Number-prefix + substring rule; regex-metacharacter input in the query box does not crash or hang | unit (include an adversarial-input case per Pitfall 3) | `vitest run src/lib/search-index.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `vitest run <file>` from the map above.
- **Per wave merge:** `pnpm test` (full workspace suite).
- **Phase gate:** full suite green, plus the Lighthouse measurement run at least once against a real deployed Pages preview before `/gsd-verify-work`.

### First-paint measurement procedure (Priority Target 2 — resolves the "measure, don't guess" requirement)

**Tooling:** Lighthouse (`npx lighthouse`, CLI or `lighthouse-ci`), run against a **deployed Cloudflare Pages preview URL** (not `localhost` — real network path, real Cloudflare edge compression/caching behavior) serving the Teams page for the heaviest real artifact.

**Throttling profile:** Lighthouse's current default mobile-performance profile [CITED, cross-checked across multiple 2025/2026 sources]: **4× CPU slowdown + "Slow 4G" network shape (150ms RTT, 1.6Mbps down / 750Kbps up)**, which Lighthouse documents as simulating a Moto-G-Power-class device. This is the standard, reproducible stand-in for "mid-range phone on typical venue wifi" named in the objective — use `--throttling-method=simulate` (the default, deterministic) rather than `devtools` throttling for CI-repeatability.

**Device class:** Moto G Power emulation (Lighthouse's built-in default) is the mid-range-phone stand-in. If a physical device is available, a spot-check on a real mid-range Android phone over real venue-grade wifi is a valuable secondary data point but not required for the automated gate.

**Metric:** **LCP (Largest Contentful Paint)**, not FCP — FCP only proves *something* painted (could be the skeleton, per D-16), while LCP tracks when the largest visible content (realistically, the table's populated first screenful of rows once the artifact resolves) is on screen. Additionally capture a **custom mark** via the Performance API: `performance.mark("artifact-parsed")` immediately after `TeamsArtifactSchema.parse()` resolves, and `performance.mark("first-rows-rendered")` after the virtualizer's first paint — `performance.measure()` between these two isolates parse+render time from network time, which matters for deciding whether a slow number is a network problem (favors the D-03 split) or a render problem (favors a virtualization fix instead).

**Threshold, locked in before measuring (per the objective's "define up front" requirement):** **LCP ≤ 2.5 seconds**, sourced from Google's own Core Web Vitals "good" threshold — the standard, citable industry number for "this page feels fast," and consistent with NAV-06's framing of load speed as the top priority.

**Procedure:**
1. Deploy `apps/web` to a Cloudflare Pages preview (real edge, real compression).
2. Seed/point the Teams page at the real (or a byte-identical fixture of the) largest published `teams/{year}` artifact — `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`, the measured max at **2,721,887 bytes** [VERIFIED: docs/publish-budget.md:28 — `"| `teams/{year}` | 15 | 1,361,992 | 2,721,887 | 2,721,887 | `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` |"`].
3. Run `npx lighthouse <preview-url>/teams?year=2024&algorithm=sigma1 --preset=perf --emulated-form-factor=mobile --throttling-method=simulate --output=json --output-path=./lighthouse-teams.json` three times; take the median LCP (Lighthouse's own recommended practice for noise reduction).
4. Cross-check with the custom `artifact-parsed`→`first-rows-rendered` `performance.measure()` duration from a real run (via DevTools Performance panel or a logged `console.table` in a temporary debug build).

**Decision rule (ties directly to D-03):**
- Median LCP ≤ 2.5s → **D-03's deferred search-index split stays deferred**, as CONTEXT.md's default already assumes.
- Median LCP > 2.5s: first confirm Cloudflare's automatic gzip/brotli compression is actually active on the response (`Content-Encoding` header present, response body materially smaller than the raw 2.7MB) before concluding the artifact itself is the problem — a missing-compression misconfiguration is a one-line fix, not a reason to build a new artifact kind. If compression is confirmed active and LCP still exceeds 2.5s, **D-03's split becomes justified** — file it as a Phase-4-touching follow-up task rather than building it speculatively inside this phase.

**Secondary threshold — first-keystroke search latency (D-10's stated concern):** target **under 100ms** from keystroke to updated dropdown results, per the RAIL performance model's "respond in under 100ms to feel instant" guideline [CITED, well-established web performance guidance]. Measure via `performance.mark`/`performance.measure` bracketing the `onChange` handler through the re-render, on the same throttled-CPU profile. If this exceeds 100ms with the events artifact lazy-fetched in (D-10), that is the signal that D-03's split (or at minimum debouncing) is needed for search specifically, independent of the Teams-page LCP verdict above.

### Wave 0 Gaps
- [ ] `apps/web/vitest.config.ts` with `environment: "jsdom"` — see Pitfall 5.
- [ ] `apps/web/tsconfig.json` extending root, mirroring `apps/worker/tsconfig.json`'s pattern.
- [ ] `src/lib/resolveSortKey.ts` + its test file — the shared D-11/D-13 fallback function named in Pattern 3.
- [ ] A deployed Cloudflare Pages preview environment to point Lighthouse at (needed before the NAV-06 measurement can run at all).
- [ ] The domain-topology decision from Pitfall 1, resolved before the first real `fetch()` call is written.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | No accounts/auth surface exists or is planned (REQUIREMENTS.md's "Out of Scope" table excludes user accounts entirely) |
| V3 Session Management | No | Stateless SPA, no session |
| V4 Access Control | No | All published artifacts are public read-only data by design (R2 custom domain, no auth gate) |
| V5 Input Validation | Yes | Zod validation at two boundaries: (1) every fetched artifact is `.parse()`d against its schema before use (already the pattern `packages/harness` uses server-side; mirror it client-side), (2) `validateSearch` Zod-parses every URL search param before it reaches a component — an untrusted, user-editable input surface (a pasted/hand-edited URL) |
| V6 Cryptography | No | No secrets, no crypto operations in this phase's browser code |
| V14 Configuration | Yes | Cloudflare Pages should ship reasonable default security headers (`X-Content-Type-Options: nosniff` at minimum); no CSP is currently specified anywhere in the tree — worth a deliberate decision (even "no CSP yet, revisit later") rather than an accidental omission |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| ReDoS via user-controlled regex in the search box (Pitfall 3) | Denial of Service | Plain `String.includes()`/`.startsWith()`, never `new RegExp(userInput)` |
| Malformed/adversarial URL search params (hand-edited deep link) causing a crash or unexpected app state | Tampering | `validateSearch`'s Zod schema rejects/coerces invalid input at the router boundary before it reaches any component — never trust a raw `URLSearchParams` value directly in render logic |
| Cross-origin data exfiltration via a misconfigured overly-permissive R2 CORS policy (`AllowedOrigins: "*"`) | Information Disclosure (low severity here — the data is already public) | Scope any R2 CORS policy (Pitfall 1) to the actual Pages origin, not a wildcard, even though the underlying data is public — narrow-scoping is free and avoids surprising the R2 bucket into serving arbitrary third-party sites |
| A malformed artifact (schema drift, corrupted publish) rendering `NaN`/`undefined` into the UI as if it were a real number | Tampering / Repudiation of data integrity | The client-side `.parse()` against the same Zod schemas the pipeline uses (V5 above) turns a silent bad-render into a loud, visible error state — matches this project's existing "validate at the fetch boundary" convention from `.claude/CLAUDE.md` |

## Sources

### Primary (HIGH confidence)
- `packages/harness/pageArtifacts.ts`, `packages/harness/manifestSchemas.ts` — read directly, full file, this session
- `packages/core/algorithms/opr.ts`, `epa.ts`, `sigma1/index.ts`, `types.ts`, `breakdown/index.ts`, `breakdown/2022.ts`, `breakdown/2026.ts` — read directly, cited line ranges, this session
- `docs/publish-budget.md`, `.planning/phases/04-publish-live-update-pipeline/04-UAT.md`, `04-VERIFICATION.md` — read directly, this session
- `vitest.config.ts`, `tsconfig.json`, `apps/worker/tsconfig.json`, `apps/worker/package.json`, `apps/worker/wrangler.toml`, `pnpm-workspace.yaml`, root `package.json` — read directly, this session
- npm registry (`npm view <pkg> version`, live queries this session) for every package version cited `[VERIFIED: npm registry]`
- `.planning/phases/05-site-shell-navigation-browsing/05-UI-SPEC.md` — approved UI design contract, read directly, this session (not re-litigated, implementation-researched)

### Secondary (MEDIUM confidence)
- TanStack Table/Virtual official docs and examples (`tanstack.com/table/...`, GitHub discussion `TanStack/virtual#872`) — column pinning + virtualization pattern, WebSearch-surfaced official-domain results
- TanStack Router official docs (`tanstack.com/router/.../search-params`, `.../share-search-params-across-routes`) — `validateSearch` + Zod pattern
- `tailwindcss.com/blog/tailwindcss-v4` and cross-checked 2025/2026 setup guides — `@tailwindcss/vite` + `@theme` CSS-first config
- `developers.cloudflare.com/workers/static-assets/routing/single-page-application/` (via WebSearch) — Cloudflare Pages SPA fallback default behavior
- Cloudflare R2 CORS documentation and community reports (via WebSearch) — custom-domain CORS caveat
- Lighthouse mobile-throttling-profile documentation/community writeups (via WebSearch) — Moto G Power / Slow-4G default profile

### Tertiary (LOW confidence)
- None presented as authoritative without a MEDIUM+ cross-check above; every LOW-confidence WebSearch finding was either upgraded via an official-domain source in the same search or explicitly flagged `[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version number checked live against the npm registry this session; the three new TanStack/lucide additions carry a documented SUS flag with a required human-verify gate, not silently accepted
- Architecture (artifact schemas, sort-fallback table, project structure): HIGH — built from reading real source files with cited line ranges and verbatim quotes, not from prose or training memory
- Touch-scroll pattern (Pitfall 2 / Pattern 2): MEDIUM — the DOM/CSS mechanism is well-documented individually (pinning docs, virtualization docs) but the three-way combination has no official worked example, hence the explicit spike recommendation rather than a "just build it" instruction
- First-paint threshold/procedure: MEDIUM — the measurement tooling and threshold are industry-standard and citable, but the actual number for this app is unmeasured until the procedure is run for real

**Research date:** 2026-08-23
**Valid until:** 2026-09-22 (30 days — stack versions move at a normal pace; the in-repo artifact-schema findings are stable until Phase 4's schema next changes, which the Events-filter prerequisite already anticipates)
