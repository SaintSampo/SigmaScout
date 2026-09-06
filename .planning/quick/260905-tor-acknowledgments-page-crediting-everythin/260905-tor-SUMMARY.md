---
quick_id: 260905-tor
phase: quick-260905-tor
plan: "01"
status: complete
subsystem: methodology
tags: [acknowledgments, methodology, credits, routing]
dependency graph:
  requires: []
  provides: ["/methodology/acknowledgments route", "ACKNOWLEDGMENTS_ENTRIES content constant"]
  affects: ["methodologyCardData.ts", "MethodologyCards.tsx"]
tech-stack:
  added: []
  patterns: ["content-as-data with file-header claim citations (vprGuideContent.ts pattern)", "outbound anchor inside <h2> for shared accessible name"]
key-files:
  created:
    - apps/web/src/components/methodology/acknowledgmentsContent.ts
    - apps/web/src/components/methodology/AcknowledgmentsPage.tsx
    - apps/web/src/routes/methodology.acknowledgments.tsx
    - apps/web/src/routes/methodology.acknowledgments.test.tsx
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
decisions:
  - "Third methodology card ordered last (Intro to VPR, Algorithm accuracy, Acknowledgments); hub grid widened from md:grid-cols-2 to md:grid-cols-3, mobile stays single-column"
  - "Outbound anchor lives inside each credit's <h2> (not beside it) so heading role and link role share one accessible name, matching what the route test asserts"
  - "Built-with section renders package display names as a comma-joined sentence, no outbound links (per plan's 'no outbound links needed there')"
actuals:
  tokens: 42000
  tasks: 2
  commits: 2
metrics:
  duration: "~35min"
  completed: 2026-09-06
---

# Phase quick-260905-tor Plan 01: Acknowledgments page crediting everything SigmaScout is built on Summary

Added `/methodology/acknowledgments`, reachable from a third card on the `/methodology` hub,
crediting The Blue Alliance, Statbotics, FRC Locks, FIRST, and the open-source stack by name with
working outbound links and specific statements of what each contributed — full prose shipped in
this task, gated by a route test that checks names, links, negative content rules, and a
manifest-backed package list.

## What backs each of the five credits

- **The Blue Alliance** — `packages/ingest/tbaClient.ts` header (sixteen TBA capabilities,
  `TBA_BASE`), its `THROTTLE_INTERVAL_MS`/ETag handling, `.claude/CLAUDE.md` Sources (TBA's
  "Efficiently Querying the TBA API" post), `apps/web/src/components/team/SeasonHeader.tsx`'s
  `https://www.thebluealliance.com/team/{teamNumber}` link, `apps/web/src/components/event/EventHeader.tsx`'s
  `TBA_EVENT_URL_PREFIX`.
- **Statbotics** — `.planning/PROJECT.md` line 5 (site framing), `apps/web/src/components/ribbon/AlgorithmSelect.tsx`'s
  `EPA_STATBOTICS_FULL_NAME` ("EPA Statbotics 5.0"), `.planning/PROJECT.md` Key Decisions row
  "EPA reimplemented, not pulled from Statbotics API", `docs/models/epa-vs-statbotics.md`,
  `docs/models/epa-divergences.md`, `packages/harness/statbotics.ts` (D-04 reference row).
- **FRC Locks** — `.planning/quick/260905-lic-districts-page-as-fourth-ribbon-page-wit/260905-lic-PLAN.md`
  ("frclocks.com is a reference for the concept only... Do not fetch, scrape or consult frclocks
  for values") and that task's SUMMARY ("frclocks.com was consulted for the concept only; no value
  came from it"). frclocks.com was NOT fetched or opened while executing this task, per the plan's
  explicit instruction.
- **FIRST** — `.planning/STATE.md`'s recorded human confirmation of ranking-point thresholds against
  the 2025 FRC Game Manual Sec 6.5.4 Table 6-2 and the 2026 FRC Game Manual Sec 6.5.3 Tables 6-4/6-5;
  the district point model citation in the 260905-lic plan.
- **Open-source stack** — `apps/web/package.json` dependencies/devDependencies, read live by the
  route test at test time (not hand-verified once and left to drift).

All five claim sets are also restated, verbatim in substance, in `acknowledgmentsContent.ts`'s own
file header, matching `vprGuideContent.ts`'s discipline.

## Content changes from the plan

None — no claim from the plan's `<the_content_this_page_must_carry>` section was changed, softened,
or dropped. All four page-wide prohibitions (no better-than claim, no accuracy figure, no
licence/terms claim, no sponsor mention) were honored as written, and Task 2 gates the first three
negatively.

## ACKNOWLEDGMENTS_PACKAGES — final list

All seven of the plan's suggested packages resolved against `apps/web/package.json` with no
substitution needed:

| package | label |
|---|---|
| `react` | React |
| `vite` | Vite |
| `tailwindcss` | Tailwind CSS |
| `@tanstack/react-router` | TanStack Router |
| `@tanstack/react-query` | TanStack Query |
| `recharts` | Recharts |
| `zod` | Zod |

No suggested package failed the manifest gate.

## Three-up card grid

Kept as specified — `MethodologyCards.tsx`'s grid changed from `md:grid-cols-2` to `md:grid-cols-3`
with the mobile branch unchanged (single column via the unprefixed `grid`). No conflict was found
with the sketch-findings-sigmascout skill's guidance; the existing `.event-card` treatment
(border/shadow-only hover, no green fill) was reused verbatim for the third card, and the skill's
green-is-ink-not-paint / accent-means-interactive rules are already satisfied by that treatment.
Visual confirmation of how the three-up row reads at desktop width is the subject of the pending
Task 3 checkpoint below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Package-manifest test used the wrong import.meta.url pattern**
- **Found during:** Task 2, first test run
- **Issue:** `readFileSync(new URL("../../package.json", import.meta.url), "utf8")` threw
  `TypeError: The URL must be of scheme file` under this repo's Vitest transform — the plan's
  suggested pattern did not match how `import.meta.url` resolves in this project's test runtime.
- **Fix:** Switched to this repo's established pattern (`favicon.test.ts`, `MetricValue.test.tsx`,
  `theme.scrollbar.test.ts`, `comparePalette.test.ts`, `simAxis.test.ts`): `dirname(fileURLToPath(import.meta.url))`
  + `resolve(...)`, both from `node:path`/`node:url`, rather than passing `import.meta.url` directly
  as a `new URL()` base to `readFileSync`.
- **Files modified:** `apps/web/src/routes/methodology.acknowledgments.test.tsx`
- **Commit:** `499d3c81`

No other deviations. Plan executed as written otherwise.

## Auth Gates

None encountered.

## Known Stubs

None. Every credit ships full, non-placeholder prose; the "Built with open source" section names
real packages verified against `apps/web/package.json` at test time.

## Threat Flags

None — every new surface (four outbound anchors, one internal `Link`, one static content module)
was already covered by this plan's own `<threat_model>` (T-tor-01 through T-tor-05), and Task 2's
tests gate T-tor-01 (rel/target) and T-tor-02 (no licence/terms/superiority claim) directly.

## Verification

1. `cd apps/web && npx vite build` — succeeded; regenerated `routeTree.gen.ts` contains
   `/methodology/acknowledgments` (9 occurrences, gitignored/untracked, not committed).
2. `cd apps/web && npx tsc --noEmit -p tsconfig.json` — clean, both after Task 1 and after Task 2.
3. `cd apps/web && npx vitest run` — **89 test files / 1356 tests passed**, printed counts read
   directly from output (never inferred from exit status, per the project's recorded
   `timeout+pnpm false green` pitfall — no `timeout` or `pnpm` wrapper was used for any test
   invocation in this task).
4. `git status` after each commit showed no unstaged leftovers in the committed files; explicit
   `git diff --diff-filter=D` checks on both commits show zero deletions.
5. **Task 3 (human visual verification) is PENDING.** Not run, not approved, not fabricated. The
   dev server was not started as part of this execution — a human needs to run `npx vite` from
   `apps/web` and step through the seven checks in the plan's `how-to-verify` (three-up grid at
   desktop width, mobile single-column stacking, page reads as finished prose, all five outbound/
   internal links work, green rule holds).

## Concurrent-session note

Two unrelated concurrent-session artifacts were present in the working tree during this execution
and were left untouched, per instruction: `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/`
(untracked directory) and an earlier report of a modification to
`packages/core/algorithms/sigma1/rp/state.ts` (not present in `git status` at either commit point
in this session — no interaction with it was needed or performed). Every commit in this plan staged
files by explicit path only; no `git add -A`/`-u` and no `git stash` was used at any point.

## Self-Check: PASSED

- FOUND: apps/web/src/components/methodology/acknowledgmentsContent.ts
- FOUND: apps/web/src/components/methodology/AcknowledgmentsPage.tsx
- FOUND: apps/web/src/routes/methodology.acknowledgments.tsx
- FOUND: apps/web/src/routes/methodology.acknowledgments.test.tsx
- FOUND: apps/web/src/components/methodology/methodologyCardData.ts (modified)
- FOUND: apps/web/src/components/methodology/MethodologyCards.tsx (modified)
- FOUND commit 7848bdbd in git log
- FOUND commit 499d3c81 in git log
