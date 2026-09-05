# Deferred items — 260905-phf

Out-of-scope discoveries found while running this task's own required
`npx vitest run` (full repo suite). None are caused by this task's changes;
none were fixed here, per the Scope Boundary rule.

## 1. Two pre-existing timeout flakes in `packages/harness`

- `packages/harness/algorithmIdentity.test.ts` > "the marker-exempted line
  count is at most the cap — the escape hatch cannot be widened quietly"
- `packages/harness/seasonParamSets.test.ts` > "replaying 2022 then 2023
  (first 2 events each) through a plain makeSigma1 module and through the
  facade over a uniform map produces byte-identical prediction streams"

Both fail with `Error: Test timed out in 5000ms`, not an assertion failure.
Neither test imports or exercises any file this task touched (routes,
ribbon, methodology components). Re-running the full suite across this
session showed the pass/fail count shift run to run (188-189 files passing,
3-6 tests failing) with the same two harness tests recurring — consistent
with CPU-load-driven timeout flakiness under a heavily loaded machine
during this session (a second concurrent GSD session was also running
build/test commands throughout), not a regression this task introduced.

## 2. `DistrictLocksTab.test.tsx` — owned by a concurrent session

A second GSD session was actively editing
`apps/web/src/components/districts/DistrictLocksTab.tsx`,
`DistrictLocksTab.test.tsx`, `districtLocksHeaderStats.ts/.test.ts`, and
`apps/web/src/styles/theme.css` throughout this task's execution window
(quick task 260905-lic, Task R2b — committed as `03046f93` mid-session, with
further uncommitted edits after that). One of their in-progress tests
intermittently failed on a full-suite run; this task never modified any of
those files and this failure is entirely theirs to track.

See this SUMMARY's "Concurrent-session incident" section for the fuller
account of the `git stash` recovery this collision required.

## 3. `apps/web/.tanstack/` is untracked and not gitignored

Predates this session (present at the very first `git status --short` this
task ran, before any file was touched). It's TanStack Router's dev/build
temp-file cache (`.tanstack/tmp/<hash>-<hash>` files with no stable names) —
clearly generated, disposable output, matching this repo's own
keep-generated-artifacts-out-of-git convention (`reports/` in `.gitignore`).
Not added to `.gitignore` here since it's outside this task's declared file
scope and touching shared repo config during an active concurrent-session
window seemed like unnecessary risk. A one-line `.gitignore` addition
(`apps/web/.tanstack/`) would close this.
