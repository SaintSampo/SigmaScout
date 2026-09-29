---
phase: 10-district-points-ledger
plan: 09
subsystem: operations
status: complete
completed: 2026-09-25
tags: [deploy, publish, manifest, ci, e2e, district-points]
requires:
  - phase: 10
    provides: "plans 10-01 to 10-08, every SUMMARY complete, repo-root suite green"
provides:
  - "Worker version 44f15512 live with the district refresh pass"
  - "district artifacts republished under generation 2026-09-25T15:47:20.912Z"
  - "live windows manifest carrying districtKey on every window"
  - "main pushed and both CI workflows green; live e2e green including the new district spec"
key-files:
  modified:
    - docs/publish-budget.md
    - .planning/STATE.md
    - apps/web/e2e/districts-ledger.spec.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
decisions:
  - "Deployed from the main checkout at e0fd02c9 with only .planning/sketches paths dirty (another session's, outside the bundle) rather than from a detached worktree; the bundle is identical."
  - "The three district e2e failures on the first live run were spec drift (stage-only slider at now, hidden not absent champ panel, the Table wrapper owns the scroller) plus one real defect (the sticky Team cell wider than the 390px scrollport). Both fixed in cf809985 before the record."
  - "The sticky cell defect is a Chromium alignment rule, not a sticky failure: a sticky box wider than its scrollport aligns by its far edge. The Team cell's inner column is capped at min(56vw, 260px) and the nickname truncates."
owed:
  - "No real district fold observed: no district event is live in late September. The manifest carrying districtKey is eligibility, never evidence that the pass works end to end."
  - "apps/web/e2e/** is typechecked by neither tsconfig (10-08's named follow up)."
  - "DistrictLocksTab.tsx and districtLocksHeaderStats.ts still carry an unused district arm (10-07's named follow up)."
---

# Plan 10-09: Operator gates, run from the main context

**Every gate passed in the load bearing order: local proof, Worker deploy, tick health, district republish, manifest, push, CI, live e2e, record.** One fix commit was needed after the first live e2e run.

## Task 1: local proof and tree inventory

- `git rev-parse --git-dir` printed `.git`. `git status --short` held only `.planning/sketches/MANIFEST.md` (modified) and `.planning/sketches/020-locks-page-reimagined/` (untracked), another session's, never staged.
- Repo root `npx vitest run`: 280 files, 6,263 passed, 1 skipped, 0 failed. All three `tsc --noEmit` runs (root, apps/web, apps/worker) printed nothing.
- `main..origin/main` empty; `origin/main..main` held 72 commits, every one from this session (sketch 021 quick task and Phase 10 plans 10-01 to 10-08). HEAD e0fd02c9.

## Task 2: Worker deploy

- `npx wrangler deploy` from apps/worker at e0fd02c9, 15:40:33Z to 15:40:41Z. Upload 1150.10 KiB (gzip 205.84 KiB), startup 77 ms. Bindings exactly `env.DB` (D1 sigmascout-state) and `env.ARTIFACTS` (R2 sigmascout-artifacts); vars `TBA_BASE_URL` and `LIVE_ALGORITHM_IDS ("opr,epa,spr")`; `schedule: * * * * *`.
- Version ID `44f15512-df25-48bd-8d53-0e842172f897`; `deployments list` shows it current at 100%, created 15:40:39Z. Previous current version was 43ed9472 (2026-09-15).

## Task 3: tick health

- 150 s tail: three ticks, each `ok:true`, cpuTime 10, 12, 11 ms, `districtsConsidered`, `districtsRefreshed`, `districtsUnchanged`, `districtsFailed` all 0, no `state-generation-mismatch`, no `LeagueRowShapeVersionError`. The pass was inert at that point because the manifest did not yet carry `districtKey`.

## Task 4: corpus freshness and the district republish

- Ingest 2026: 363 requests (334 not modified, 29 fresh). Districts: 14 districts, 2,130 ranking rows, 150 district events. Alliances: 337 events, all cache hits, one 404 (2026cascc). Awards: 150 district events, all cache hits.
- Dry run clean, no budget error, 0 bake eligible events in every season (all events in the past).
- `pnpm publish:districts` 15:47:19Z to 15:47:49Z, exit 0, generation `2026-09-25T15:47:20.912Z`. 2026: 14 districts, 2,593,758 bytes, 0 sidecars. Largest object `2026fim` 641,981 bytes (531 teams, 1,210 per team); largest per team `2025fsc` 1,414.
- Live content with an Origin header: `v1/districts/2026.json` 200, JSON, `Access-Control-Allow-Origin` present, generation as above, 14 districts. `2026pnw`: 126 teams, 126 with per event `state`, 126 with `awardProfile`, `awardBaseRates` 6 rows measured through 2025, no `bakedEvents`. `2026fim`: 530 of 531 with state. `2025ne`: 190 of 191, base rates measured through 2024.

## Task 5: the live windows manifest

- BEFORE: schemaVersion 1, generation `6c6585d0-f292-4939-944d-374fb3f27ce7`, 52 windows, 0 with the `districtKey` field, 7 live now, 52 inferred.
- Dry run: 52 rebuilt against 52, generation identical, 0 carry a district key, 52 explicit null, 51 probe windows.
- Real write 15:48:45Z: "wrote v1/manifest/live-windows.json reusing generation 6c6585d0". One object, no generation minted, no seed, no prune. `rebaseline`, `publish:seasons` and `publish:stubs` were not run.
- AFTER (15:50:06Z, past the 60 s edge TTL): field on 52 of 52 windows, 0 non null, generation unchanged; the automated check passed. Post write tick: ok, four counters present at 0.

## Task 6: push and CI

- Pushed 0c23e6b9..e0fd02c9 at 15:50:09Z. Test run 36156850808 success; deploy run 36156850846 success including "Verify the live assets the way a browser requests them", done 15:52:36Z.

## Task 7: live e2e, and the one fix

- First run at 15:52:53Z: district spec 4 passed, 6 failed (three titles on both projects); full family 283 passed with the same 6 failures.
- Triage, measured on the live site: the slider holds 33 positions at now (four stage steps per event, no artifact loaded on a finished district) and grows to 549 after a rewind, with the URL and readout updating; the champ panel is mounted and hidden with no children; the shared Table component's own wrapper is the scroller (table 1445px in a 340px wrapper) and the outer card never overflows. Three spec premises fixed.
- One real defect: the sticky Team cell was 360px wide inside the 340px scrollport, so Chromium aligned its far edge and it slid from x 25 to x 4. Fixed by capping the cell's inner column at min(56vw, 260px) with a truncating nickname. District component tests 158 passed, web tsc clean.
- Fix commit cf809985 pushed; Test 36157968026 and Deploy 36157968031 both success, done 16:03:34Z.
- Rerun 16:03:45Z: district spec 10 of 10 on desktop and phone-390 (sticky cell x 25 before and after; region 1319 vs 340). Full family 289 passed, 0 failed, done 16:06:08Z.
- Real browser look at desktop and 390px: no page errors, no ± glyph, tab labelled Road to District Champs, chips Prequalified 0, Locked 50, In range 0, Out of range 0, Locked out 76, today's line floor 56, 0 of 1,008 open cells, grey earned cells with TBA's numbers.

## Task 8: the record

- `docs/publish-budget.md` gained the production run table beside 10-06's local numbers and the re baseline cadence names `pnpm publish:live-windows`. The machine readable `json budget` block is untouched.
- `.planning/STATE.md` Session Continuity carries the operator line (no pipe characters).

## Not proven here

No district event is live, so the Worker's district refresh has not folded a real rankings change in production. The next live district weekend is the first real test; the runbook in `docs/worker-operations.md` names the counters and log lines to watch.
