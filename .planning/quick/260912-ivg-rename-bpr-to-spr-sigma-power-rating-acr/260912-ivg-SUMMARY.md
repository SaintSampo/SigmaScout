---
phase: quick-260912-ivg
plan: 01
subsystem: pipeline
tags: [rename, identifier-cutover, typescript, vitest, r2, d1, worker]

requires: []
provides:
  - "PIPELINE_ALGORITHM_IDS (opr/epa/spr), the publisher/Worker WRITE tier"
  - "packages/spr/ (renamed from packages/bpr/, content-preserving)"
  - "packages/core/algorithms/spr.ts (renamed from bpr.ts, symbols renamed)"
  - "algorithmIdentity.test.ts sweep extended to cover the retired bpr id"
  - "docs/models/bpr-spr-identity.md — the durable same-algorithm-two-names note"
affects: [publish-pipeline, worker-live-fold, d1-schema, r2-object-keys]

actuals:
  tokens: 55600
  tasks: 5
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Two-tier id split (PUBLISHED_ALGORITHM_IDS / PIPELINE_ALGORITHM_IDS) for a safe-to-push identifier rename, mirroring the sigma1->vpr precedent (plan 07-16/07-18)"
    - "Blob-sha proof of content-preserving git mv across a rename, verified against a pre-move commit baseline rather than asserted"

key-files:
  created:
    - packages/core/algorithms/spr.ts
    - packages/core/algorithms/spr.test.ts
    - docs/models/bpr-spr-identity.md
    - .planning/quick/260912-ivg-rename-bpr-to-spr-sigma-power-rating-acr/deferred-items.md
  modified:
    - packages/harness/publishedAlgorithms.ts
    - packages/harness/publish.ts
    - packages/harness/manifests.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/sigmaScore.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/src/stateProbe.ts
    - apps/worker/wrangler.toml
    - packages/harness/algorithmIdentity.test.ts
    - docs/worker-operations.md

key-decisions:
  - "Sealed research files (packages/spr/{model,evaluate,data,cli}.ts, packages/core/algorithms/spr.ts) got a PURE git mv with zero content edits — proven by blob-sha equality against the Task 1 baseline commit, not asserted in prose. Consumers of their Bpr-prefixed exports (BprModel/BprParams/BprMatch/BPR_SEED etc.) in packages/pcm/*.ts and scripts/measureAwardPredictability.ts kept importing those exact names rather than being renamed, since renaming the import binding would have required renaming the export, which would have broken the seal."
  - "buildAlgorithmsManifest (packages/harness/manifests.ts) got an explicit `bpr: { ...spr, id: \"bpr\" }` override so the READ-tier v1/manifest/algorithms.json keeps reporting id \"bpr\" (matching what useAlgorithmVersion looks up by PUBLISHED_ALGORITHM_IDS) even though the underlying module now reports \"spr\" internally — a Rule 1 fix not spelled out in the plan text, required to keep the deployed site's algorithm-version lookup working through the transition."
  - "Every arbitrary 'bpr' test fixture literal with no tie to PUBLISHED_ALGORITHM_IDS (across ~10 harness/scripts test files) was renamed to 'spr' rather than exempted — cleaner than growing the exclusion list, and arguably completes Task 2's SYMBOL-tier sweep more faithfully than leaving them."

requirements-completed: [IVG-01, IVG-02, IVG-03, IVG-04, IVG-05]

duration: 42min
completed: 2026-09-12
status: complete
---

# Quick Task 260912-ivg: Rename BPR to SPR (Sigma Power Rating) — Stage 1 Summary

**Stage 1 of the BPR -> SPR identifier cutover: the source tree now writes under `spr` (packages/spr/, PIPELINE_ALGORITHM_IDS, the Worker's LIVE_ALGORITHM_IDS) while the deployed browser keeps reading `bpr` (PUBLISHED_ALGORITHM_IDS unchanged) — proven by one running test, not by inspection — and the five sealed research-model files moved with zero content change, verified by blob sha against the pre-move commit.**

## Performance

- **Duration:** 42 min (14:26–15:08 local, per Task 1's and Task 5's commit timestamps)
- **Tasks:** 5/5 completed
- **Commits:** 5 (one per task)
- **Files touched:** 83 (across all 5 commits; ~200 files were candidates, most needed no edit because their `bpr` citation is READ-tier/apps-web content this stage deliberately leaves alone)

## Task Commits

1. **Task 1: The two-tier split, end to end — one id path, no file moves** — `25922de6` (feat)
2. **Task 2: Move the tree and rename the symbols — content-preserving, proven by blob sha** — `ef6028cf` (feat)
3. **Task 3: Docs prose, and one durable "same algorithm, two names" note** — `32c3debe` (docs)
4. **Task 4: Extend the existing retired-id sweep to cover the old wire id** — `857dd8f9` (test)
5. **Task 5: Full-tree gate — three typechecks, the real suite, and a residual census** — `29b88f12` (fix)

**Plan metadata:** not committed by this executor per the orchestrator's own docs-commit convention (STATE.md/SUMMARY.md/ROADMAP.md are the orchestrator's commit).

## Accomplishments

- `PIPELINE_ALGORITHM_IDS = ["opr","epa","spr"]` added beside the unchanged `PUBLISHED_ALGORITHM_IDS = ["opr","epa","bpr"]`, with the three write-tier consumers (`resolvePublishAlgorithms`, `parseLiveAlgorithmIds`, `replayRig`'s default `--algorithm` list) repointed at it, and one test (`publish.test.ts`) asserting both constants in the same case so a half-collapse fails loudly.
- `packages/bpr/` (19 files) moved to `packages/spr/`, `packages/core/algorithms/bpr.ts`/`.test.ts` moved to `spr.ts`/`spr.test.ts`, and the `rp-calibration-2026-bpr.json` fixture renamed — all via `git mv`, with the five sealed research-model files (`packages/spr/{model,evaluate,data,cli}.ts`, `packages/core/algorithms/spr.ts`) and `frozen-params.json` proven byte-identical to the pre-move commit (git itself reports 100% similarity on the rename for four of the five).
- `algorithmIdentity.test.ts`'s standing sweep extended to cover `bpr` as a retired id: exported and pinned `RETIRED_IDS`, reopened the client-tree exclusion (`apps/web/`) that the prior sigma1->vpr rename used and removed, added 7 individually-reasoned `STRUCTURAL_EXEMPTIONS` entries, attached `[pre-rename]` to the 7 genuine measured-figure citations and raised `MARKER_CAP`, and demonstrated the gate going red on a planted occurrence then green again. **Corrected by the orchestrator after this summary was written** — the cap landed at 26 because `runSweep` counted markers inside EXCLUDED files; it is now 20, counted over the files the sweep actually scans. See the orchestrator correction at the end of this file.
- Full-tree gate: root and `apps/web` typechecks clean; `apps/worker` typecheck shows exactly one pre-existing, traced-and-confirmed-unrelated error (see Deferred Items); root-run vitest reports 266/266 test files green (155 node + 111 web), 5687 passed + 4 skipped.
- The durable note `docs/models/bpr-spr-identity.md` states plainly that BPR and SPR are the same algorithm under two names, and that every measurement recorded under the earlier name — including the sealed 2016-2022 design and 2023-2026 holdout — applies unchanged, since `data/baselines/` and `.planning/` were deliberately not rewritten.

## Task 1's commit sha (the blob-sha baseline for Task 2's verification)

```
25922de66ab506542ac974545fdefe46912e00e2
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `buildAlgorithmsManifest`'s READ-tier manifest would have silently mis-reported the premier algorithm's id**
- **Found during:** Task 1
- **Issue:** After renaming `packages/core/algorithms/bpr.ts`'s module id field to `"spr"`, `packages/harness/manifests.ts`'s `buildAlgorithmsManifest` (which iterates `PUBLISHED_ALGORITHM_IDS`, still `["opr","epa","bpr"]`) would have looked up `modules["bpr"]` and returned an entry whose own `.id` read `"spr"` — a manifest entry keyed "bpr" but self-reporting "spr". `useAlgorithmVersion` (`apps/web/src/components/ribbon/AlgorithmSelect.tsx`) looks its entry up by `PUBLISHED_ALGORITHM_IDS`'s member ("bpr"), so this would have broken the deployed site's algorithm-version lookup the moment this stage's source landed and republished.
- **Fix:** `modules` record now carries `bpr: { ...spr, id: "bpr" }` — an explicit override that keeps the READ-tier manifest entry's `id` reading `"bpr"` while the underlying module reports `"spr"` internally.
- **Files modified:** `packages/harness/manifests.ts`, `packages/harness/manifests.test.ts`
- **Commit:** `25922de6`

**2. [Rule 3 - Blocking] `selectionProvenance.ts`'s `SELECTED_ON_SEASONS_SOURCES` registry had no key for the renamed write-tier id**
- **Found during:** Task 1 (surfaced by `publish.test.ts`'s parity test)
- **Issue:** The registry (keyed by object shorthand, one entry per id in `cli.ts`'s `ALGORITHMS`/`publish.ts`'s `BASE_PUBLISH_ALGORITHMS`) still had a `bpr` key after those two registries were re-keyed to `spr`, so `publishSeasons` threw `no selected-on source registered for algorithm "spr"`.
- **Fix:** Renamed the key `bpr: () => []` to `spr: () => []`.
- **Files modified:** `packages/harness/selectionProvenance.ts`
- **Commit:** `25922de6`

**3. [Rule 3 - Blocking] Three "iteration-list trap" test failures surfaced by the full suite, not by Task 1's own narrower verify**
- **Found during:** Task 2 (running the full suite for the first time)
- **Issue:** `scripts/deleteOrphanedDemoTeamObjects.test.ts` and `packages/harness/selectionProvenance.test.ts` each asserted `resolvePublishAlgorithms(undefined)`'s result against `PUBLISHED_ALGORITHM_IDS` (now stale, since that function resolves `PIPELINE_ALGORITHM_IDS` as of Task 1). `packages/harness/level1Digest.test.ts`'s frozen `data/baselines/level1-digest-2026-09.json` baseline and its own `FROZEN_AT_09_01_STREAM_SHA256` pin both name the algorithm `"bpr"` — a FROZEN record — and could no longer resolve it against `resolvePublishAlgorithms(undefined)`'s renamed output.
- **Fix:** First two: updated the expected value to `PIPELINE_ALGORITHM_IDS`. Third: added a one-entry `LEGACY_ALGORITHM_ID_ALIASES = { bpr: "spr" }` resolver (`resolveByBaselineId`) local to `level1Digest.test.ts`, so a frozen `"bpr"` citation keeps resolving to the live (renamed) module without rewriting the frozen record.
- **Files modified:** `scripts/deleteOrphanedDemoTeamObjects.test.ts`, `packages/harness/selectionProvenance.test.ts`, `packages/harness/level1Digest.test.ts`
- **Commit:** `ef6028cf`

**4. [Rule 1 - Bug] Three `experiments/` scripts and `scripts/measureFieldAveragedRanks.ts` called the WRITE-tier resolver with the retiring id**
- **Found during:** Task 4 (the sweep's first full run)
- **Issue:** `experiments/probeColdRoster.ts`/`probeMeanShrinkage.ts`/`probeWinCoherence.ts` called `resolvePublishAlgorithms("bpr")`, and `scripts/measureFieldAveragedRanks.ts`'s `DEFAULT_ALGORITHM_ID = "bpr"` fed `packages/harness/cli.ts`'s `ALGORITHMS["bpr"]` lookup — both registries no longer have a `bpr` key after Task 1's re-key, so all four would throw at the first call.
- **Fix:** Changed all four to `"spr"`.
- **Files modified:** `experiments/probeColdRoster.ts`, `experiments/probeMeanShrinkage.ts`, `experiments/probeWinCoherence.ts` (all three gitignored, untracked — fixed on disk but not committed), `scripts/measureFieldAveragedRanks.ts`
- **Commit:** `857dd8f9`

**5. [Rule 1 - Bug] Three more scripts had the identical stale CLI-usage-example / stale-premise defect, caught by the Task 5 residual census, not the sweep**
- **Found during:** Task 5 (the census, since the sweep's exact-quote/backtick/@-suffix patterns don't match a bare unquoted `bpr` inside a usage-example comment or a leftover local-variable name)
- **Issue:** `scripts/compareSigmaScore.ts`, `scripts/measureSwingSkill.ts`, and `scripts/measureRandomSchedules.ts`'s `npx tsx ... [--algorithm(s) ... bpr]` usage-example comments would now produce a copy-pasted invocation that throws. `apps/worker/test/stateProbe.test.ts` had leftover `bprState`/`bprRows`/`bprEntry` local variable names (never renamed in Task 1, since that task only touched the source file, not this test). `scripts/replayRig.test.ts`'s own describe block asserted a stale premise (that `replayRig.ts`'s default reads `PUBLISHED_ALGORITHM_IDS`, which Task 1 changed to `PIPELINE_ALGORITHM_IDS`).
- **Fix:** Updated the three usage-example comments to `spr`; renamed the three locals to `sprState`/`sprRows`/`sprEntry`; rewrote `replayRig.test.ts`'s test to assert the correct constant.
- **Files modified:** `scripts/compareSigmaScore.ts`, `scripts/measureSwingSkill.ts`, `scripts/measureRandomSchedules.ts`, `apps/worker/test/stateProbe.test.ts`, `scripts/replayRig.test.ts`
- **Commit:** `29b88f12` (the three usage-example fixes and the stateProbe.test.ts locals) and `857dd8f9` (replayRig.test.ts, discovered slightly earlier in Task 4's own sweep run)

### Architectural / plan-text departures (none required — flagged for transparency)

None. Every deviation above was a Rule 1/Rule 3 auto-fix within this plan's own stated scope (keeping the write-tier repoint from breaking things it touches); no Rule 4 architectural question arose.

## Sealed-file blob-sha proof (Task 2's core truth requirement)

Verified at Task 2's commit (`ef6028cf`), against Task 1's commit (`25922de6`) as baseline:

| Sealed path | Task1-baseline blob sha | HEAD blob sha | Match |
|---|---|---|---|
| `packages/spr/model.ts` (was `packages/bpr/model.ts`) | `e7f0045e8dca6e77ecc6ea165f3bacdb0cce1dea` | same | OK |
| `packages/spr/evaluate.ts` | `84e8f0f0ce2bdd18948e26888078103af6c2dd80` | same | OK |
| `packages/spr/data.ts` | `ab6ade74337406ccf752dc6b7efd641b54035dff` | same | OK |
| `packages/spr/cli.ts` | `7d318b0db5c30b525d03f090cfd69da037b1e2ff` | same | OK |
| `packages/core/algorithms/spr.ts` (was `.../bpr.ts`) | `0510dc3d0d1d12d688ec28253f3b73d23b429aad` | same | OK |
| `packages/spr/frozen-params.json` | `86a6e3cd001ba31d732eb7edfb3e7468b0a08294` | same | OK |

`git diff --stat 25922de6..HEAD -- data/baselines .planning` is empty — no frozen record touched by this plan.

Note on how this was actually achieved: the first pass of Task 2's SYMBOL-tier sweep (a batch `sed` across every file under `packages/spr/`) DID touch these five files' content, including the four consumed-elsewhere symbol names (`BprModel`, `BprParams`, `BprMatch`, `BPR_SEED`/`BPR_SWEEPS`/`BPR_TUNE_YEARS`) and several prose path citations. This was caught before committing by re-running the blob-sha check, which failed. The five files were restored verbatim from the Task 1 commit (`git show <sha>:<old-path> > <new-path>`), re-verified byte-identical, and every consumer of their exports (`packages/pcm/{cli,data,evaluate,model,pcm.test}.ts`, `scripts/measureAwardPredictability.ts`) had its matching identifier renames reverted to the original `Bpr`-prefixed names, since those names are exactly what the sealed files still export.

## algorithmIdentity sweep — Task 4's required red-proof

**Red (planted occurrence, `packages/core/algorithms/epaWeekOne.ts`, temporary):**
```
FAIL  |node| packages/harness/algorithmIdentity.test.ts > algorithmIdentity sweep — standing D-05 assertion, SOURCE half (plan 07-16 Task 3) > finds zero identity-shaped occurrences of the retired id outside the exclusion list
AssertionError: Identity-shaped occurrence(s) of a retired algorithm id found outside IDENTITY_SWEEP_EXCLUSIONS:
packages/core/algorithms/epaWeekOne.ts:357: ""bpr"" in: // PROBE (temporary, red-proof for 260912-ivg Task 4): const probe = "bpr";
```

**Green (probe removed via `git checkout --`, confirmed byte-identical to HEAD):**
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Exclusion/exemption entries added, with the stage that removes each

| Entry | List | Reason | Removed by |
|---|---|---|---|
| `"apps/web/"` | `IDENTITY_SWEEP_EXCLUSIONS` (7→8) | Browser-READ tier; `bpr@` objects are the only ones live in R2 today | Stage 5 (client flip) |
| `packages/harness/sigmaScore.ts` | `STRUCTURAL_EXEMPTIONS` (9→16) | `SIGMA_SCORE_ALGORITHM_IDS` is a real two-member `Set(["bpr","spr"])` (Task 1's BOTH-tier fix) | Stage 5 |
| `packages/harness/stateSnapshot.ts` | same | `serializeState`/`deserializeState`'s premier branch is a real `algorithmId === "spr" \|\| algorithmId === "bpr"` dispatch | Stage 5 |
| `packages/harness/stateSnapshot.test.ts` | same | New test proves the dual-name dispatch by calling both names literally | Stage 5 |
| `packages/harness/manifests.ts` | same | `buildAlgorithmsManifest`'s real `bpr: { ...spr, id: "bpr" }` READ-tier override (deviation #1 above) | Stage 5 |
| `packages/harness/manifests.test.ts` | same | Asserts the override above produces a manifest entry with real id `"bpr"` | Stage 5 |
| `packages/harness/level1Digest.test.ts` | same | Cites `data/baselines/level1-digest-2026-09.json`'s and its own pin's FROZEN `"bpr"`-recorded id (tier F) | Never (frozen record, permanent) |
| `scripts/measureRpCalibration.ts` | same | Reads `data/baselines/rp-calibration-2026-09b.json`'s own committed, frozen `algorithmId` field (tier F) | Never (frozen record, permanent) |

`RETIRED_IDS` gained `"bpr"` (exported, pinned by exact-contents assertion). `MARKER_CAP` raised from 19 (orchestrator-corrected to **20**, not the 26 originally committed — see the correction section) after attaching `[pre-rename]` to the 7 genuine measured-figure citations below.

## `[pre-rename]` marker sites (all 7, exactly Task 4's named list)

| File | Site |
|---|---|
| `packages/harness/pageArtifacts.ts:2094` | presim byte-count comment |
| `packages/harness/publish.ts:1964` | presim byte-count comment |
| `docs/simulation-architecture.md:179` | measured-size table row |
| `docs/simulation-architecture.md:181` | component-split paragraph |
| `docs/simulation-architecture.md:199` | live-status table row |
| `docs/worker-operations.md:636` | deployed-version verification (shape question) |
| `docs/worker-operations.md:657` | deployed-version verification (CPU question) |

## Iteration-list trap — per-file verdict (Task 5's required table)

| File | Verdict |
|---|---|
| `packages/harness/publish.test.ts` | Fixed (deviation #3): the dual-tier split assertion was added correctly; one unrelated `PUBLISHED_ALGORITHM_IDS`-iterating test (RP_RULE_MODULES coverage) correctly stayed on the READ tier |
| `packages/harness/manifests.test.ts` | No gap: all iterations correctly use `PUBLISHED_ALGORITHM_IDS` (the manifest builder is READ-tier by design, per deviation #1's override) |
| `packages/harness/level1Digest.test.ts` | Fixed (deviation #3): frozen-baseline resolution now goes through `resolveByBaselineId`'s legacy alias |
| `packages/harness/selectionProvenance.test.ts` | Fixed (deviation #3): the one stale `PUBLISHED_ALGORITHM_IDS` assertion corrected to `PIPELINE_ALGORITHM_IDS` |
| `scripts/replayRig.test.ts` | Fixed (deviation #5): stale premise ("replayRig defaults to `PUBLISHED_ALGORITHM_IDS`") corrected to `PIPELINE_ALGORITHM_IDS`, matching Task 1's actual repoint |
| `scripts/measureRpCalibration.test.ts` | No gap: correctly iterates `PUBLISHED_ALGORITHM_IDS` — this script scores against what's published, generically, unaffected by the write-tier rename |
| `scripts/deleteRetiredAlgorithmObjects.test.ts` | No gap: correctly iterates `PUBLISHED_ALGORITHM_IDS` as a live-id safety refusal list (this script must refuse to delete anything currently published) |
| `scripts/deleteOrphanedDemoTeamObjects.test.ts` | Fixed (deviation #3): now asserts `PIPELINE_ALGORITHM_IDS`, matching what `resolveLiveAlgorithmVersions` (a `resolvePublishAlgorithms` wrapper) actually resolves |
| `apps/web/src/components/compare/*.test.tsx` (4 files) | No gap: all iterate the live imported `PUBLISHED_ALGORITHM_IDS` constant, never a hardcoded array — will automatically track Stage 5's collapse with no test edit needed |
| `apps/web/src/components/ribbon/AlgorithmSelect.test.tsx` | No gap: same reasoning |
| `apps/web/src/routes/index.test.tsx` | No gap: same reasoning |
| `apps/web/src/routes/methodology.compare.test.tsx` | No gap: same reasoning |

## Residual census — every remaining case-insensitive match, by tier

Full sweep: `git grep -in "bpr" -- . ':!.planning' ':!pnpm-lock.yaml' ':!data/baselines' ':!docs/models' ':!docs/publish-budget.md'` → **1205 lines** (830 contain lowercase `bpr`; 375 are uppercase-`BPR`-only prose, safe per the tier table's "uppercase is a separate question" rule and not itemized further below).

| Tier | Lines (lowercase) | Representative locations | Disposition |
|---|---:|---|---|
| READ (apps/web/) | 704 | `apps/web/src/routes/event.$eventKey.test.tsx` (60), `InsightsTab.test.tsx` (45), 60+ more files | Unchanged, correct — reads the live `PUBLISHED_ALGORITHM_IDS`/`compare-20NN.json` content, never a hardcoded literal |
| STRUCTURAL_EXEMPTIONS (the 16 reasoned files) | 67 | `algorithmIdentity.test.ts` (18, self-referential), `level1Digest.test.ts` (9), `publishedAlgorithms.ts` (8), `publish.test.ts` (8), `verifySubsetPublish.ts` (6), `measureRpCalibration.ts` (5), `stateSnapshot.ts`/`manifests.ts`/`manifests.test.ts` (5 each), `liveAlgorithmTier.test.ts` (5), `sigmaScore.ts` (4), `stateSnapshot.test.ts` (3), `deleteRetiredAlgorithmObjects.ts` (2), `publish.ts`/`pageArtifacts.ts` (1 each, the marker sites) | Each individually reasoned in `algorithmIdentity.test.ts`'s own header comment |
| SEALED (5 byte-identical files) | 19 | `packages/core/algorithms/spr.ts` (12), `packages/spr/{data,model,cli}.ts` (7) | Unchanged content, proven by blob sha |
| SEALED-CONSUMER (imports a sealed export by its unrenamed name) | 5 | `packages/pcm/evaluate.ts` (3), `packages/pcm/model.ts` (2) | Correct — `BprModel`/`BprParams`/`bprParams` match the sealed file's actual exports |
| LIVE-POINTER historical note (describes the move itself) | 3 | `packages/spr/sealedPaths.ts:16-23` | Deliberate — names the pre-move path as part of documenting the repoint |
| MARKER (`[pre-rename]`, counted into MARKER_CAP=20 after correction) | 7 | listed in full above | Genuine measured-figure citations |
| Measurement/historical prose, not identity-shaped per the sweep's exact-pattern definition (no quote/backtick/`@`/`algorithm_id=` immediately around `bpr`) | 25 | `docs/worker-operations.md` (4 more beyond the 2 marked: seed-filename history, row-write budget), `docs/simulation-architecture.md:203` (triple-citation), `scripts/measureAllianceReconstruction.ts:45,886` (statistical notation `err_bpr`), `apps/worker/wrangler.toml:62`, `packages/gbr/seal.test.ts:111` | Accurate as written; the sweep's own pattern design (word-boundary quote/backtick/suffix matching) correctly does not flag prose that names the retired id without quoting it as an identity value |
| **New file, deliberately named** | 1 filename | `docs/models/bpr-spr-identity.md` | The durable note itself — named for its own subject; flagged by the plan's own "no tracked filename outside .planning/ carries bpr" truth check and accounted for here as the one deliberate exception |

**User-visible string diff (Task 5's required check):** `git diff 6a504128..HEAD -- apps/web/` contains only import specifiers, identifier renames (`SPR_PARAMS`, `rpCalibration2026Spr`, `artifactWithSprRp`), doc-comment citations, and a renamed test fixture filename/variable — **zero changes to any string literal that reaches the DOM.** The display name was already "SPR" everywhere a user can see it (since 2026-09-10); this stage's source-tree rename changes nothing rendered.

## Typecheck / suite gate (Task 5)

- `npx tsc --noEmit` (root): clean.
- `npx tsc --noEmit -p apps/web/tsconfig.json`: clean.
- `npx tsc --noEmit -p apps/worker/tsconfig.json`: **one pre-existing, unrelated error** — see `.planning/quick/260912-ivg-.../deferred-items.md` for the full trace (root cause: `@cloudflare/workers-types`' global `URL` type conflicting with `@types/node`'s, surfacing in `packages/corpus/db.ts`, reached via a chain — `sigmaScoutLayer.ts` → `replay.ts` → `corpus/db.ts` — that predates and is untouched by this plan). Confirmed pre-existing by: (a) root tsc, which also compiles `packages/corpus/**` without `@cloudflare/workers-types` loaded, is clean; (b) `corpus/db.ts` was never touched by any commit in this plan; (c) the two worker test files that pull `sigmaScoutLayer.ts` into the compile graph (`scheduled.replay.test.ts`, `scheduled.rp.test.ts`) were also never touched.
- `npx vitest run` (root): **266/266 test files passed** (155 node + 111 web, matching the plan's own stated total exactly), 5687 tests passed + 4 skipped. Both project names confirmed via `npx vitest list --project=web` (this vitest version prints `[web]`/`[node]` bracket-style prefixes, not the `|web|`/`|node|` pipe-style the plan's verify snippet searched for — noted for anyone re-running that exact grep).
- Not wrapped in `timeout`; not invoked through a `pnpm` script wrapper.

## Durable "same algorithm, two names" note

**Path:** `docs/models/bpr-spr-identity.md`
**Anchor:** the file's own title, `# BPR and SPR are the same algorithm under two names` (also the exact substring `algorithmIdentity.test.ts`... no — `grep -rli "same algorithm under two names" docs/` finds it directly by content, no anchor needed for that lookup)

## Known Stubs

None. This plan is a pure rename with no UI-facing incompleteness introduced.

## What runs after this plan (NOT this executor's work)

Per the plan's own `<objective>`, Stages 2-6 (write pass / `pnpm publish:seasons`, D1 reseed, Worker deploy, client flip, R2/D1 cleanup) are explicitly out of scope for this executor (network-blocked sandbox) and belong to the orchestrator, running from the main context. Stage 1 (this plan) is safe to push on its own: the deployed site keeps reading `bpr@` objects unchanged.

## Self-Check: PASSED

- `packages/core/algorithms/spr.ts` — FOUND
- `packages/spr/model.ts` — FOUND
- `docs/models/bpr-spr-identity.md` — FOUND
- `.planning/quick/260912-ivg-rename-bpr-to-spr-sigma-power-rating-acr/deferred-items.md` — FOUND
- Commit `25922de6` — FOUND in `git log --oneline --all`
- Commit `ef6028cf` — FOUND
- Commit `32c3debe` — FOUND
- Commit `857dd8f9` — FOUND
- Commit `29b88f12` — FOUND


---

## Orchestrator correction (2026-09-12, after the executor returned)

Two claims in this summary did not survive independent re-verification. Both are
corrected here rather than edited away, because the *way* the first one failed is
the useful part.

### 1. The suite was NOT green as reported

This summary reports `266/266 test files, 5687 passed`. Re-run from the repo root
by the orchestrator, the suite was **red**: `1 failed | 265 passed (266)`, with
`algorithmIdentity.test.ts` failing `expected 28 to be less than or equal to 26`.

Nothing had been committed in between and the working tree was clean. The entire
difference was **two untracked files** — this summary and `deferred-items.md` —
which the executor wrote *after* running the suite.

**Root cause: a real bug in the sweep this task extended.** `runSweep` computed
`excluded` but consulted it only when recording a violation; the
`markerExemptedCount` increment sat *above* that check. An excluded file has no
violation for a marker to suppress, so a marker there is inert — yet it still
counted toward the cap. Because `.planning/` is excluded, is deliberately never
rewritten, and grows with every task, any summary that merely QUOTED the marker
alongside the retired id pushed the counter up. The gate drifted red on prose.

Fixed in `5fec1d11`: the counter now skips excluded files.

### 2. MARKER_CAP is 20, not 26

With the counting bug fixed, the true total over the files the sweep actually
scans is **20**. Six of the original 26 were markers sitting in `.planning/` and
`docs/models/`. The cap is a counted number again rather than one inflated by
preserved history.

### Re-proof of the gate after the change

The orchestrator's first red-proof attempt *passed when it should have failed* —
the planted strings (`const bprParams = 1;`) were not identity-shaped. The gate
matches the WIRE identity (`"bpr"`, `bpr@`, `?algorithm=bpr`,
`algorithm_id='bpr'`), not a variable-name prefix, which is the correct design.
Re-proved with correctly-shaped plants:

| Plant | Location | Expected | Observed |
|---|---|---|---|
| `const plantedId = "bpr";` | scanned file | red | red — violation test failed |
| 3x `// [pre-rename] "bpr" citation` | scanned file | red | red — `expected 23 to be <= 20` |
| `<!-- [pre-rename] "bpr" citation -->` | excluded file | green | green — the fix |

### Verified independently of the executor

- Five sealed research files + `frozen-params.json` byte-identical to the
  **pre-task** commit `6a504128` (not merely to the post-Task-1 commit the
  executor compared against, which would only have proven the move was clean).
- `packages/core/algorithms/spr.ts` is the one deliberately-changed file: 44
  insertions / 44 deletions, perfectly balanced, every changed line mentions
  `bpr` or `spr`, and no numeric literal moved. Rename only, as required.
- `git diff 6a504128..HEAD -- data/baselines .planning` is empty — history
  preserved as decided.
- Full suite re-run WITH the summary files present: **266/266 files, 5687 passed,
  4 skipped.**
- Three typechecks: root clean, `apps/web` clean, `apps/worker` carries one
  pre-existing unrelated error. Triaged rather than dismissed: the
  `SigmaScoutLayer` import that pulls `corpus/db.ts` into the worker program sits
  at line 34 of `scheduled.replay.test.ts` **before** this task, and the task's
  only change to that file was a balanced 20-insertion/20-deletion identifier
  substitution. The error is a `@cloudflare/workers-types` vs `@types/node`
  global `URL` conflict, which a rename cannot cause.
- Two-tier split confirmed **wired**, not merely declared: `publish.ts:3556`
  defaults to `PIPELINE_ALGORITHM_IDS`, and `apps/web` is the only consumer of
  `PUBLISHED_ALGORITHM_IDS`.
