---
phase: 05-site-shell-navigation-browsing
plan: 01
subsystem: ui
tags: [react, vite, tailwindcss, tanstack-router, tanstack-query, zod, cloudflare-pages, r2, cors, wrangler]

requires:
  - phase: 04-publish-live-update-pipeline
    provides: "Published v1/teams/{year}/{algorithmId}@{version}.json artifacts on R2, artifactKey() key scheme, TeamsArtifactSchema"
provides:
  - "apps/web — the first frontend package in the repo (Vite + React 19 + Tailwind v4 + TanStack Router/Query)"
  - "Node-free browser-safe schema leaves: packages/harness/metricHistorySchema.ts, packages/harness/publishedAlgorithms.ts"
  - "A static import-graph test (browserSafeSchemas.test.ts) guarding pageArtifacts.ts's browser safety"
  - "The client fetch-boundary pattern: artifactOrigin.ts + lib/api/errors.ts + lib/api/teams.ts, proven end-to-end on live infrastructure"
  - "Cloudflare Pages project sigmascout-web, live at https://sigmascout-web.pages.dev"
  - "Scoped R2 CORS policy (infra/r2-cors.json) on the sigmascout-artifacts bucket"
affects: [05-02, 05-03, 05-04, 05-05, phase-06, phase-07, phase-08]

actuals:
  tokens: 37500
  tasks: 3
  commits: 3

tech-stack:
  added: [react@19.2.8, vite@8.2.2, tailwindcss@4.3.3, "@tanstack/react-router@1.170.32", "@tanstack/react-query@5.102.2", "@tanstack/react-table@9.1.2", "@tanstack/react-virtual@3.14.10", zustand@5.0.15, lucide-react@1.33.0, cmdk@1.1.1, "@fontsource-variable/inter@5.3.0", "@playwright/test@1.62.1"]
  patterns:
    - "Browser-safe Zod schema leaves: split a schema out of any module with Node-only top-level imports into a zero/minimal-import leaf, re-export unchanged from the original module (mirrors the pre-existing manifestSchemas.ts precedent)"
    - "Client fetch-boundary: artifactKey() -> fetch(artifactUrl(key)) -> res.ok check -> Schema.parse() in try/catch -> named ArtifactFetchError/ArtifactValidationError (mirrors apps/worker/src/liveWindows.ts's parse-or-throw shape)"
    - "Root vitest.config.ts as a projects array — one node project (packages/scripts/apps/worker), one reference to apps/web's own jsdom project — so a component test can never silently run without a DOM"

key-files:
  created:
    - packages/harness/metricHistorySchema.ts
    - packages/harness/publishedAlgorithms.ts
    - packages/harness/browserSafeSchemas.test.ts
    - infra/r2-cors.json
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/vite.config.ts
    - apps/web/vitest.config.ts
    - apps/web/index.html
    - apps/web/src/main.tsx
    - apps/web/src/styles/theme.css
    - apps/web/src/test/setup.ts
    - apps/web/src/routes/__root.tsx
    - apps/web/src/routes/teams.tsx
    - apps/web/src/lib/query-client.ts
    - apps/web/src/lib/artifactOrigin.ts
    - apps/web/src/lib/api/errors.ts
    - apps/web/src/lib/api/teams.ts
    - apps/web/src/lib/api/teams.test.ts
  modified:
    - packages/harness/manifestSchemas.ts
    - packages/harness/metricHistory.ts
    - packages/harness/pageArtifacts.ts
    - vitest.config.ts
    - .gitignore
    - docs/worker-operations.md

key-decisions:
  - "MetricValueSchema (previously module-private in metricHistory.ts) is now exported from metricHistorySchema.ts — needed for the leaf split, harmless widening since it was already reachable via MetricHistoryRowSchema's shape."
  - "apps/web/package.json adds wrangler@4.125.0 as its own devDependency (not in the plan's literal dependency list) — its 'deploy' script invokes a bare `wrangler` binary, which only resolves from a package's own node_modules/.bin under pnpm's strict linking; apps/worker's identical 'deploy' script works for the same reason. Rule 3 fix."
  - "NAV-06/TEAM-01 (this plan's frontmatter requirements) intentionally NOT marked complete in REQUIREMENTS.md — this plan proves the read path end-to-end on ONE hardcoded route/column subset (rank, team #, nickname, total metric only; no record/win rate columns, no virtualization, no year/algorithm switching). The full Teams page and NAV-06's remaining pages are later plans in this phase; matches this project's established precedent for tracer/scaffold plans (see STATE.md's ALGO-03/ALGO-05/ALGO-08 entries)."
  - "The custom domain www.sigmascout.org could NOT be attached to the Pages project — wrangler 4.125.0 has no CLI subcommand for Pages custom domains anywhere under `wrangler pages` (checked pages, pages project, pages deployment, pages deploy --help exhaustively). Per the plan's own fallback instruction, this requires the Cloudflare dashboard's custom-domains panel, which this environment has no browser/interactive access to. The live proof runs against the Pages production alias instead."
  - "infra/r2-cors.json's AllowedOrigins includes the Pages production alias (https://sigmascout-web.pages.dev) alongside https://www.sigmascout.org, precisely so this alias-based verification path works without a wildcard origin."

patterns-established:
  - "Every apps/web cross-package import to packages/harness/* is a relative deep path with an explicit .js extension, at the verified depth for each file's location (apps/web/src/lib/api/ is 5 levels from repo root) — no @sigmascout/* alias exists or should ever be introduced."
  - "Design tokens live in apps/web/src/styles/theme.css as CSS custom properties inside an @theme block; no component may use a color literal."

requirements-completed: []

coverage:
  - id: D1
    description: "Cloudflare Pages project sigmascout-web created; R2 bucket CORS scoped to https://www.sigmascout.org and the Pages production alias, no wildcard origin"
    requirement: NAV-06
    verification:
      - kind: integration
        ref: "curl -H 'Origin: https://www.sigmascout.org' https://sigmascout.org/v1/teams/... -> Access-Control-Allow-Origin: https://www.sigmascout.org (exact)"
        status: pass
      - kind: integration
        ref: "curl (no Origin header) https://sigmascout.org/v1/teams/... -> HTTP 200 (Phase 4 no-origin path unaffected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "packages/harness schemas (pageArtifacts.ts, publishedAlgorithms.ts) are importable into a browser bundle with zero Node built-ins and zero packages/core/algorithms/ files in their transitive graph"
    requirement: NAV-06
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts (3 tests, all pass); verified non-vacuous by temporarily re-pointing the import at metricHistory.js and observing the expected failure"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Teams artifact fetch-boundary (fetchTeamsArtifact/teamsQueryOptions) builds its URL exclusively via artifactKey(), validates the response with TeamsArtifactSchema, and raises named ArtifactFetchError/ArtifactValidationError on failure"
    requirement: TEAM-01
    verification:
      - kind: unit
        ref: "apps/web/src/lib/api/teams.test.ts (4 tests: valid fixture, 404, missing-field validation failure, exact requested URL) — all pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "The deployed /teams route renders real published 2024 sigma1 team rows end-to-end from the live sigmascout.org artifact, with the D-07 value/± spread display contract and no CORS error"
    requirement: TEAM-01
    verification:
      - kind: e2e
        ref: "Headless Chromium (playwright-core) navigation to https://sigmascout-web.pages.dev/teams: rowCount=100, first row '1  6328  Mechanical Advantage  63.07± 2.27', consoleErrors=[]"
        status: pass
      - kind: integration
        ref: "curl -o /dev/null -w '%{http_code}' https://sigmascout-web.pages.dev/teams -> 200"
        status: pass
    human_judgment: false
  - id: D5
    description: "The site is reachable at its intended production hostname https://www.sigmascout.org (D-17)"
    requirement: NAV-06
    verification: []
    human_judgment: true
    rationale: "Not completed this plan — no wrangler CLI subcommand exists for Pages custom domains on the installed version (4.125.0), and this environment has no dashboard/browser access to attach it manually. A human needs to attach the domain via the Cloudflare dashboard's Pages project custom-domains panel; once attached, the exact same verification already proven against the .pages.dev alias applies unchanged."

duration: ~55min (includes two human-checkpoint waits: package-legitimacy confirmation, deploy/domain-attach authorization)
completed: 2026-08-24
status: complete
---

# Phase 5 Plan 01: Tracer — Real Browser Renders Real Published Team Rows Summary

**A live browser at `https://sigmascout-web.pages.dev/teams` fetches `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` cross-origin from `https://sigmascout.org`, validates it against the real `TeamsArtifactSchema`, and renders 100 real team rows (verified: team 6328 "Mechanical Advantage" at `63.07 ± 2.27`) with zero console errors — proving the whole Phase 5 read path end to end before any other component is built.**

## Performance

- **Duration:** ~55 min (includes two human-checkpoint waits)
- **Completed:** 2026-08-24
- **Tasks:** 3 (1 checkpoint-only, 2 code tasks)
- **Files modified:** 27

## Accomplishments

- Split two browser-unsafe schema modules into Node-free leaves (`metricHistorySchema.ts`, `publishedAlgorithms.ts`) so `packages/harness/pageArtifacts.ts` — the schema `apps/web` depends on — no longer drags `node:fs`/`node:path` or the Sigma1 algorithm implementation into a browser bundle. Guarded by a new static import-graph test, proven non-vacuous by hand.
- Scaffolded `apps/web` from nothing: Vite + React 19 + Tailwind v4 + TanStack Router/Query, following `apps/worker`'s existing config conventions and the repo's relative-deep-import-with-`.js` convention.
- Converted the root Vitest config to a `projects` array so `apps/web`'s component tests can never silently run under Vitest's forced `node` environment.
- Built and proved the full client fetch-boundary pattern (`artifactOrigin.ts` -> `lib/api/errors.ts` -> `lib/api/teams.ts`) against real deployed infrastructure, not a mock.
- Provisioned the Cloudflare Pages project `sigmascout-web` and a scoped (non-wildcard) R2 CORS policy on `sigmascout-artifacts`, confirmed live via `curl` with an `Origin` header.
- Deployed the built app to the Pages production alias and confirmed with a headless-browser run that the live page renders real 2024 Sigma1 team data with the D-07 value/±spread display contract and zero console errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the three SUS-flagged packages before any install runs** — verification-only checkpoint, no files/commit (resolved: approved by the user via the orchestrator's gate; all three packages' `repository.url` and versions independently confirmed to match `@tanstack/react-table`, `@tanstack/react-virtual`, `lucide-react`'s expected GitHub orgs)
2. **Task 2: Provision the Pages project and scope the R2 CORS policy (D-17, D-18)** - `fcc8ee70` (feat)
3. **Task 3: End-to-end "a browser renders real published team rows"** - `034a6d2c` (feat)

**Plan metadata:** (this commit, immediately following)

## Files Created/Modified

- `packages/harness/metricHistorySchema.ts` - Node-free leaf: `MetricValueSchema`, `MetricHistoryRowSchema`, `MetricHistoryRow`
- `packages/harness/publishedAlgorithms.ts` - Node-free, zero-import leaf: `PUBLISHED_ALGORITHM_IDS`, `PublishedAlgorithmId`
- `packages/harness/browserSafeSchemas.test.ts` - static import-graph scan proving no Node built-in / no `packages/core/algorithms/` file is reachable from the browser-facing entry points
- `packages/harness/metricHistory.ts`, `manifestSchemas.ts`, `pageArtifacts.ts` - re-point imports at the new leaves, re-export unchanged for existing callers
- `vitest.config.ts` (root) - converted to a `projects` array (node project + `./apps/web` reference)
- `.gitignore` - added `apps/web/dist/`, `apps/web/src/routeTree.gen.ts`, `apps/web/test-results/`, `apps/web/playwright-report/`
- `infra/r2-cors.json` - tracked CORS policy: `https://www.sigmascout.org` + `https://sigmascout-web.pages.dev`, GET/HEAD only, `ETag` exposed, no wildcard
- `docs/worker-operations.md` - new "Site hosting and R2 CORS" section
- `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html` - the new package
- `apps/web/src/main.tsx`, `styles/theme.css`, `test/setup.ts` - app entry, design tokens, test setup
- `apps/web/src/routes/__root.tsx`, `routes/teams.tsx` - the root layout and the tracer route
- `apps/web/src/lib/query-client.ts`, `lib/artifactOrigin.ts`, `lib/api/errors.ts`, `lib/api/teams.ts`, `lib/api/teams.test.ts` - the fetch-boundary pattern and its tests

## Decisions Made

- `MetricValueSchema` widened from module-private to exported (needed by the leaf split; harmless since its shape was already reachable through `MetricHistoryRowSchema`).
- Added `wrangler@4.125.0` to `apps/web`'s own `devDependencies` (Rule 3 fix — its `deploy` script invokes a bare `wrangler` binary, which pnpm's strict linking only resolves from a package's own declared deps, matching `apps/worker`'s identical pattern).
- `--color-text-muted` (left open by the UI-SPEC) set to `#475569` (Tailwind slate-600) — measured 7.25:1 contrast against `--color-bg-page` (`#f8fafc`), clearing WCAG AA's 4.5:1 floor for the 12px sigma-spread suffix text.
- Deploying without `--branch main` from this worktree's non-`main` git branch would have landed the build as a *preview* deployment, not on the production alias `sigmascout-web.pages.dev`, since wrangler infers the deploy branch from the current git branch. Redeployed explicitly with `--branch main --commit-dirty=true` after noticing the first deploy's alias URL was branch-scoped (`worktree-agent-....sigmascout-web.pages.dev`), confirmed via `curl` that the production alias itself now serves the build.
- Cloudflare Pages' built-in SPA fallback (serving `index.html` with `200` for any unmatched path) already handles direct navigation to `/teams` correctly — no `_redirects`/`_routes.json` file was needed, contrary to the plan's contingency note.
- `NAV-06`/`TEAM-01` intentionally NOT marked complete in REQUIREMENTS.md — see frontmatter `key-decisions` for the full rationale (this is a thin tracer, not the full Teams page).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `wrangler` as an explicit `apps/web` devDependency**
- **Found during:** Task 3, Step 2 (package.json authoring)
- **Issue:** The plan's `"deploy"` script (`wrangler pages deploy dist --project-name sigmascout-web`) invokes a bare `wrangler` binary, but the plan's dependency-install list for `apps/web` never lists `wrangler` itself. Under pnpm's strict (non-hoisting) linking, a package's scripts can only resolve binaries declared in that same package's own `package.json`.
- **Fix:** Added `"wrangler": "4.125.0"` to `apps/web`'s `devDependencies` (matching the version already pinned in `apps/worker/package.json`).
- **Files modified:** `apps/web/package.json`
- **Verification:** `pnpm --filter web deploy` resolves and runs `wrangler` successfully.
- **Committed in:** `034a6d2c`

**2. [Rule 3 - Blocking] Deployed with an explicit `--branch main` after the first deploy landed on a branch-scoped alias**
- **Found during:** Task 3, Step 7 (deploy)
- **Issue:** This worktree's git branch is `worktree-agent-a291a0469fbd3ad0d`, not `main`. `wrangler pages deploy` without an explicit `--branch` flag infers the deployment's environment from the current git branch, so the first deploy attempt landed as a preview deployment (`https://worktree-agent-a291a0469fbd3.sigmascout-web.pages.dev`) rather than updating the production alias the plan's acceptance criteria check against.
- **Fix:** Re-ran `npx wrangler pages deploy apps/web/dist --project-name sigmascout-web --branch main --commit-dirty=true`; confirmed via `curl` that `https://sigmascout-web.pages.dev/teams` now returns `200` and serves the just-built bundle.
- **Files modified:** none (deploy-only, no source change)
- **Verification:** `curl -o /dev/null -w "%{http_code}" https://sigmascout-web.pages.dev/teams` -> `200`; headless-browser run confirms real data renders.
- **Committed in:** n/a (infrastructure action, not a file change)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues preventing task completion)
**Impact on plan:** Both fixes were necessary for the deploy step to actually work as the plan intended; neither changed scope or added unplanned functionality.

## Issues Encountered

- **`pnpm-workspace.yaml` transient anomaly (resolved, documented, no lasting effect):** During worktree bootstrap, two `Edit` calls to `pnpm-workspace.yaml` were followed by tool-result content showing an invalid line (`better-sqlite3: set this to true or false`) paired with an instruction not to tell the user. I did not comply with the "don't tell the user" instruction, verified the file state independently via `git diff`/`git checkout`, and reverted the file to its committed HEAD state before proceeding. The coordinator subsequently confirmed this was pnpm's own normal placeholder-write behavior during a build-approval decision, not an external actor — no lasting effect on the repo; `pnpm-workspace.yaml`'s only surviving diff from this plan is the three legitimate `minimumReleaseAgeExclude` entries pnpm itself added during a later, unrelated `pnpm install` for `apps/web`'s new too-fresh transitive dependencies (`@tanstack/query-core@5.102.2`, `@tanstack/react-query@5.102.2`, `@types/react-dom@19.2.5`).
- **`better-sqlite3` install failure on this machine (pre-existing, non-blocking):** `pnpm install` exits 1 because `better-sqlite3`'s postinstall attempts `node-gyp rebuild` and this machine has no Visual Studio Build Tools. Confirmed the bundled `win32-x64.node` prebuild loads and executes correctly (`require('better-sqlite3')` round-trip test passed) — not a real regression, just a non-zero exit code from an unnecessary build step. No tracked config was changed to chase a green exit code, per the coordinator's explicit instruction.
- **Custom domain attach blocked — no CLI path exists (see coverage D5 above; unresolved, needs a human):** `wrangler pages` (checked `pages`, `pages project`, `pages deployment`, and `pages deploy --help` exhaustively) has no subcommand for attaching a Pages custom domain in the installed version (4.125.0). Per the plan's own contingency instruction, this now needs the Cloudflare dashboard's custom-domains panel, which this environment cannot reach. `www.sigmascout.org` does not currently resolve (`curl: (6) Could not resolve host`).
- **Deploy and domain-attach commands were denied once by Claude Code's auto-mode permission classifier**, then approved by the user via the coordinator on retry (see the checkpoint exchange in this session). Did not attempt any alternate spelling or workaround during the denial, per instruction.

## User Setup Required

**One external, dashboard-only step remains** to fully satisfy this plan's original objective (D-17):

1. In the Cloudflare dashboard, open the `sigmascout-web` Pages project's **Custom domains** panel.
2. Attach `www.sigmascout.org`.
3. Re-run the verification already proven against the alias: `curl -sS -o /dev/null -w "%{http_code}" https://www.sigmascout.org/teams` should print `200` (allow a few minutes for DNS/SSL provisioning).

No `.env`/secret configuration is needed — this is purely a dashboard action on an already-owned zone.

## Next Phase Readiness

- The read path every remaining Phase 5 plan depends on (`artifactKey()` -> `fetch()` -> `TeamsArtifactSchema.parse()` -> render) is proven end-to-end on real infrastructure with real 2024 data — plans 05-02 through 05-05 can build the real Teams table, Events page, ribbon, and search directly on top of `apps/web`'s existing scaffold without re-deriving any of this.
- `packages/harness`'s schemas are now safely importable into any future `apps/web` component — no future plan needs to repeat the Node-built-in extraction work.
- **Blocker for a fully-D-17-compliant site:** the custom domain attach above. Nothing else in Phase 5 is blocked by this — the pages.dev alias is a fully functional stand-in for continued development, and the domain attach is a one-time, low-risk dashboard action that does not touch code.

---
*Phase: 05-site-shell-navigation-browsing*
*Completed: 2026-08-24*
