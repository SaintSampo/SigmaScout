---
id: 260913-it4
slug: tear-out-swing-score-and-the-retired-vpr
description: Tear out the retired per-robot consistency accumulator and the retired VPR/Sigma1 core; OPR and EPA publish no ranking-point odds; the rank simulation is SPR-only
created: 2026-09-13
completed: 2026-09-13
status: complete
phase: quick-260913-it4
plan: 01
subsystem: pipeline, worker, web, docs
tags: [spr, ranking-points, simulation, cleanup, equivalence]
requires: []
provides:
  - packages/harness/predictionStreamDigest.ts (computePredictionStreamDigest, relocated verbatim)
  - packages/harness/sigmaScore.ts (allianceSigmaBandVariance, publishesRankingPoints)
  - packages/harness/consistencyMetric.ts (consistencyMetricByTeam, required metricKey)
  - scripts/scriptHelpers.ts (parseSeasons, equalCountBuckets)
affects: [publish.ts, sigmaScoutLayer.ts, apps/worker scheduled tick, stateSnapshot, Compare RP cards, Simulation tab copy, SPR methodology]
commits:
  - 167eab64 refactor(260913-it4): remove the retired VPR/Sigma1 core and its tuning machinery
  - 094667e9 refactor(260913-it4): remove the retired consistency accumulator; OPR and EPA publish no ranking-point odds
  - bcc929cb docs(260913-it4): SPR-only ranking points copy, web cleanup, docs
  - (orchestrator docs commit) plan, summary, STATE row, and the todo moves
restore_point: fce1bcb51f91b72b6e2d4d23d6d7e6dc815d0c98
key-decisions:
  - "Retired per-robot consistency accumulator deleted outright, no replacement variance (Jacob, 2026-09-13)"
  - "OPR and EPA publish no ranking-point odds; rank simulation is SPR-only (Jacob, 2026-09-13)"
  - "Retired VPR/Sigma1 core and its tune/promote/search machinery removed (Jacob, 2026-09-13)"
  - "No state/schema/manifest version bump; legacy keys stripped or ignored on read; no D1 reseed required"
metrics:
  tasks: 3
  commits: 4
---

# Quick Task 260913-it4: Tear out Swing Score and the retired VPR — Summary

Removed from the repo:

- the retired VPR/Sigma1 core
- its tuning and promotion tooling
- the retired per-robot consistency accumulator

OPR and EPA now publish no ranking-point odds, so the rank simulation works under SPR only, and the web
copy says so. A full 2026 walk-forward replay (20,408 matches per algorithm, offline, cold start) proves
that every winner prediction for OPR, EPA and SPR is byte-identical to the pre-change tree. So is every
SPR ranking-point, band, pre-schedule and seed output.

## Task 1: Retired VPR/Sigma1 core removed (`167eab64`, 127 files, +468 / -28,349)

- Built the scratchpad capture/compare tool (offline, read-only corpus, 2026 season with offseason, cold
  start) and captured the `before` baseline at `fce1bcb5`. The SPR determinism re-capture passed.
- `computePredictionStreamDigest` moved verbatim into `packages/harness/predictionStreamDigest.ts`.
  `level1Digest.test.ts` reproduces its committed baseline, which is unedited.
- Deleted:
  - `packages/core/algorithms/sigma1/` and the five promoted version files
  - tune/promote/search/legacy-params/seasonParamSets/acceptance/objectiveDefinition, plus their tests
  - the VPR-only scripts and the unimported `apps/web/src/lib/rewindGap.ts`
  - the package.json scripts `tune`, `promote`, `measure:rewind-gap`, `reparam:equivalence`, and the
    `.gitignore` exception
- VPR removed from cli, publish, selectionProvenance, manifestSchemas, manifests, the Worker and
  replayRig. `serializeState`/`deserializeState` now throw on an unknown algorithm id (new test).
  replayRig previously built a Sigma1 module for any id other than opr/epa, including spr; it now has an
  explicit spr branch.
- `extract-digest-slice.ts` re-pointed at `data/baselines/level1-digest-2026-09.json`. The CI comment
  now names `level1Digest.test.ts`. The docs/models measurement records got path wording and a dated
  deletion line; no numbers changed.
- Gate: compare before vs after-vpr, `--expect identical`: **EQUIVALENCE: PASS** (27/27 streams).

## Task 2: Retired consistency accumulator removed; OPR/EPA RP odds off (`094667e9`, 48 files, +1,199 / -3,087)

- Relocated under new names:
  - `allianceSigmaBandVariance` and `publishesRankingPoints` into `sigmaScore.ts`
  - `consistencyMetricByTeam` (required `metricKey`) into `consistencyMetric.ts`
  - `parseSeasons` and `equalCountBuckets` into `scripts/scriptHelpers.ts`
  - the RP half-life provenance (walk-forward over 275,172 team-matches, 2024-2026) into
    `empiricalMoments.ts`
- `SigmaScoutLayer` is now Sigma-only. The RP accumulator is built only when `publishesRankingPoints`.
- publish.ts: the D1 seed chain lost the retired passenger, and `attachRpCalibration` skips algorithms
  that publish no RP.
- Worker tick and stateProbe: the retired accumulator is gone, win-odds variance comes from Sigma only,
  and the RP accumulator is gated on `publishesRankingPoints`.
- stateSnapshot: the shape-10 passenger was removed without a bump. A new test proves a row with an
  extra unknown key deserializes identically.
- The SPR RP digest literal is unedited and passing. The OPR/EPA RP digest pins became absence
  assertions.
- Deleted: the consistency-accumulator and metric modules and their tests, the skill-measurement script
  and its test, the Sigma-comparison script, and their package.json scripts.
- Gate: compare before vs after-swing, `--expect rp-off-for-non-sigma`: **EQUIVALENCE: PASS**. Root vitest
  248 files / 5332 passed / 1 skipped. Three typechecks clean.

## Task 3: Web copy, cleanup, docs, todos (`bcc929cb`, 31 files, +177 / -262)

- **Copy corrected to be true under every rating:**
  - `SIMULATION_UNAVAILABLE_BODY` is now: "This event's matches don't carry the predicted ranking-point
    distributions the simulation needs. Not every rating publishes them, and offseason events never
    carry them, since they sit outside the ranking-point model." It names no algorithm. The D-04
    prohibition test stays green, and a new test renders an OPR artifact's unavailable heading and body.
  - The first paragraph of the SPR methodology "What it does not do" section was replaced. The "no
    ranking-point model" fact-gate phrase is kept.
  - The Compare page RP cards are built only for `PUBLISHED_ALGORITHM_IDS.filter(publishesRankingPoints)`.
    An equality pin sets that to `["spr"]`, and a new test shows a stale artifact holding OPR/EPA RP
    records renders only the SPR card.
- **Web cleanup:**
  - Comments reworded by concept.
  - Renames: `swingCard` to `sigmaCard`, `LevelAndSwingFigure` to `LevelAndSigmaFigure`, figure id
    `level-and-swing` to `level-and-sigma`.
  - Tests that only existed for retired keys or the word were deleted: 7 deleted, 3 added.
  - Tier and sort tests were retitled onto sigma with every number unchanged.
- **Docs and skill reference reworded by concept:**
  - `publish-budget.md`, including the `run` prose string inside its json block, numbers unchanged
  - `simulation-architecture.md`
  - `worker-operations.md`: the `bandsProduced` row now matches the new probe text
  - `rp-layer-config-arms.md`
  - sketch-findings `uncertainty-display.md`
- **Todos:**
  - `swing-score-audit.md` and `remove-swing-from-sigma1-core.md` moved to `completed/` with a dated
    RESOLVED note.
  - `vpr-retirement-make-features-algorithm-agnostic.md` stays pending with a 2026-09-13 STATUS note:
    step 4 done, sections 2-3 superseded by the SPR-only decision, section 1 (live updates for every
    algorithm) still open.
- Final gate: pipeline code has not changed since the after-swing capture (`git diff --quiet 094667e9
  HEAD -- packages scripts apps/worker` passes), so the compare was re-run into `compare-final.txt`:
  **EQUIVALENCE: PASS**.

## Equivalence (before = `fce1bcb5`)

| Rating | Identical to before | Expected change | Result |
|---|---|---|---|
| opr | winner, played-core, upcoming-core, played-band, upcoming-band | RP-bearing lines 16,595 before; 0 after (played, upcoming, presim); line counts 20,408/20,408; RP seed beliefs 0 | PASS |
| epa | same five streams | same as opr | PASS |
| spr | winner, played-core, upcoming-core, played-band, upcoming-band, played-rp, upcoming-rp, presim-rp, seed | none | PASS |

SPR sha256, identical in every capture (before, before-repeat, after-vpr, after-swing, final):

- winner/core: `01d9c599a4ba919fc641cf9c088e911318deb35ab285876cebc80840e80a3287`
- played-rp: `6b581d92e53e2d250e50da3c6cdd2436ddc4ccd1cbd651c12071aecf6e40d4fb`
- upcoming-rp: `9d38663dab041bf4999028f08c10e0c3668ecabd037d4830c591bcf0f7e88500`
- played-band: `5d28064062dccf389b49d49c0bc1ea25f5640c92096161114ff60823f065173e`
- upcoming-band: `88ffe41e3ca9a97119accb650a803e51946726c8bdedaf83b8d587ca440cf245`
- presim-rp: `04f3db500d6b2618f3317f4e2e9492be7747e6734e44ae34f63f47204d025c73`
- seed: `c3d9ffae9ef38fade3a790ce9d252dcf70ca3d5b7941fdb31f1174aa6131e7f7`

OPR winner `f92d395002e2697ff94da2d3f3cbcb40edf8e6e5ddfada5b7c70d8d8dce65265` and EPA winner
`41d9e37f98a9f2ba1b82e47b173482812a7010e03ca50f6cfa2ab9f7776d728f` were identical in every capture. Full
transcripts: `compare-before-before-repeat.txt`, `compare-before-after-vpr.txt`,
`compare-before-after-swing.txt`, `compare-final.txt` in the session scratchpad.

## Verification

| Check | Result |
|---|---|
| Final equivalence (`compare-final.txt`) | EQUIVALENCE: PASS |
| Root `npx vitest run` (final) | Test Files 249 passed (249); Tests 5330 passed, 1 skipped (5331). The count includes one test file another session added concurrently |
| `npx tsc --noEmit` / `-p apps/web` / `-p apps/worker` | all clean |
| Gate 1: `git grep -il swing` over packages apps scripts docs data package.json .claude/skills | only `apps/web/src/routes/methodology.sigma.test.tsx`, lines 100-106, the kept rendered-page guard |
| Gate 2: `git grep -n "algorithms/sigma1"` outside .planning and the retune skill | no hits |
| `data/baselines` and `digest-slice.json` vs fce1bcb5 | unchanged |
| STATE_SNAPSHOT_SHAPE_VERSION / PAGE_ARTIFACT_SCHEMA_VERSION / MANIFEST_SCHEMA_VERSION | 15 / 1 / 1, unchanged |
| Published / deployed / reseeded / pushed | nothing |

## D1 / wire compatibility

- No shape bump: `STATE_SNAPSHOT_SHAPE_VERSION` stays 15, and the page artifact and manifest schema
  versions stay 1.
- Legacy fields are dropped on read by design:
  - every page-artifact and manifest zod schema is non-strict, so unknown keys are stripped
  - every state deserializer reads named fields, so a D1 row still carrying the retired passenger reads
    identically (pinned by test)
- Unknown algorithm ids now throw in `serializeState`/`deserializeState` and the Worker, instead of
  silently being treated as Sigma1.
- **No D1 reseed is required.** The first tick that touches a team rewrites its row without the passenger,
  inside the batch it already sends.

## Named gate exceptions

1. `apps/web/src/routes/methodology.sigma.test.tsx`: the rendered-page guard proving the published
   /methodology/sigma page contains no form of the retired word. Kept verbatim.
2. `.claude/skills/sigmascout-retune-republish/`: left untouched by instruction and excluded from gate 2.
3. `.planning/`: history, excluded.

## Deviations from Plan

1. **Another session's commit swept up the todo moves, then released them.**
   - While Task 3 had its todo moves staged, another session's `git commit` swept them into its commit
     `13c4af25` (ribbon nav links).
   - That session later rewrote the commit as `d52e5ced` with only its own Ribbon files, which returned
     the todo moves to the index.
   - They land in this task's orchestrator docs commit. The final history is clean.
2. **`docs/publish-budget.md` `run` string reworded.** Commit 69b349ae, another session's 260913-g66 ship
   record that landed after planning, put the retired wire key names into that string. Only those phrases
   were reworded, by concept. Numbers were verified unchanged against 69b349ae, and the tests that parse
   the block pass.
3. **Extra stale-comment fixes beyond the named lines:**
   - `SimulationTab.tsx`, alongside a new OPR unavailable-state test
   - Task 1's comment rewording in 14 files flagged by the path gate
4. **`scripts/measureRpMeanDeficit.test.ts`** built a layer with no algorithm id. It now builds for `spr`,
   because a layer with no id has no RP.
5. **Test coverage added.** The demo and DQ-zero skip-rule cases were ported to `sigmaScore.test.ts`,
   because the deleted test file held their only coverage.

## Follow-ups (main context; subagents have no network)

1. **Republish** (`pnpm publish:seasons`) so R2 drops the OPR/EPA ranking-point fields and OPR/EPA
   pre-schedule sidecars. SPR numbers must not move, per the equivalence gate. Until then, live OPR/EPA
   artifacts still carry pmfs.
2. **Worker deploy.** The bundle no longer carries the Sigma1 core or the retired accumulator.
3. **Web ship** (push). Check `origin/main..main` first; other sessions' commits ride along.
4. **D1:** no reseed required. Optionally check for and delete any `vpr` state rows.
5. **R2:** after republish, `pnpm cleanup:r2-generations` for stale OPR/EPA presim sidecars and any
   remaining `vpr@` objects.
6. **`apps/web/e2e` specs** (21 files, including the simulation specs) still use `algorithm=vpr`. They were
   not edited: the simulation specs need an SPR-only premise, not a param swap.

## Flags for Jacob

- `.claude/skills/sigmascout-retune-republish/` and the Project Skills blurb in `.claude/CLAUDE.md` now
  describe deleted machinery (tune/promote/acceptance). Both were left untouched by instruction.
- `paramsSeason` is still required by the manifest builder but is vestigial.
- `data/baselines/rp-calibration-2026-09b.json` still holds OPR/EPA records. They are filtered out when
  attached.
- `rp-fold-exceeds-worker-cpu-budget` may be affected, because one fold left the Worker tick. Unmeasured;
  no claim made.
- `cold-start-chain-gates-rp-pmfs-measured` and `ranking-points-audit` may be partly superseded by the
  SPR-only decision; not moved.
- Restore point for everything deleted: `fce1bcb51f91b72b6e2d4d23d6d7e6dc815d0c98`.
