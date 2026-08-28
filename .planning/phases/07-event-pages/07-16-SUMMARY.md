---
phase: 07-event-pages
plan: 16
subsystem: prediction-pipeline
tags: [rename, algorithm-identity, harness, worker, publish, r2, d1, vitest]

requires:
  - phase: 07-event-pages
    provides: "07-09's --include-offseason publish restructure, 07-10's real-data subset publish under sigma1@ keys, 07-15's Ribbon/EventHeader wiring the client currently reads"
provides:
  - "Every publisher/Worker-write-side source of the published algorithm identity renamed sigma1 -> vpr (registry entries, the two committed promoted version files, the promoted-override chain, the manifest builder, the publisher's module table, the replay rig's default set, the Worker's live-fold tier)"
  - "PIPELINE_ALGORITHM_IDS (packages/harness/publishedAlgorithms.ts) — the publisher/Worker-facing tier, added beside the unchanged, still-browser-facing PUBLISHED_ALGORITHM_IDS for the duration of the rename transition window"
  - "packages/harness/algorithmIdentity.test.ts — the standing D-05 assertion's SOURCE half: a repo-wide filesystem walk asserting no identity-shaped occurrence of the retired id survives outside a short, length-asserted exclusion list"
  - "docs/worker-operations.md updated to state the transition's actual position (tracked config says vpr; deployed Worker and browser still read the pre-rename identity until 07-19/07-18)"
affects: ["07-17 (the write pass that publishes the first real vpr@ objects)", "07-18 (the client cutover that flips PUBLISHED_ALGORITHM_IDS/DEFAULT_ALGORITHM and deletes PIPELINE_ALGORITHM_IDS + the apps/web exclusion entry)", "07-19 (deletes retired sigma1@ R2 objects and algorithm_id='sigma1' D1 rows, redeploys the Worker)"]

actuals:
  tokens: 53433
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Two-tier algorithm-id constant during a rename transition window: PUBLISHED_ALGORITHM_IDS (browser-read, unchanged) beside PIPELINE_ALGORITHM_IDS (publisher/Worker-write, renamed) in one zero-import leaf module"
    - "Repo-wide identity sweep as a runnable test (filesystem walk + a short, length-asserted exclusion list + a line-scoped [pre-rename] marker honoured only on a comment/prose line) rather than a one-time grep"

key-files:
  created:
    - packages/harness/algorithmIdentity.test.ts
  modified:
    - packages/core/algorithms/sigma1/index.ts
    - packages/harness/cli.ts
    - packages/harness/manifests.ts
    - packages/harness/manifestSchemas.ts
    - packages/harness/promote.ts
    - packages/harness/publish.ts
    - packages/harness/publishedAlgorithms.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/wrangler.toml
    - apps/web/src/lib/searchParams.ts (comment-only)
    - docs/worker-operations.md
    - data/algorithm-versions/vpr@2.0.0+tuned-2026-08.json (git mv from sigma1@...)
    - data/algorithm-versions/vpr@2.0.0+tracer-check.json (git mv from sigma1@...)

key-decisions:
  - "Followed the plan's PD-01 through PD-08 exactly as written — two-tier id constant, identity-vs-implementation rename boundary, four harness-only variants renamed, searchParams.ts comment-only edit, PD-05 marker convention, filesystem-walk sweep, dry-run-only proof, no checkpoint on the one-way rating"
  - "Extended STRUCTURAL_EXEMPTIONS (a list separate from the plan's own 8-entry IDENTITY_SWEEP_EXCLUSIONS) for six cases the tier-based exclusions do not reach — see 'Hits outside the three tiers' below"
  - "Raised MARKER_CAP from 12 to 13 against the real re-grep count — all 13 are genuine measured/historical citations, documented in the test's own comment (flagged assumption 4 explicitly authorizes this)"
  - "Rule 2 fix: corrected two stale doc comments (packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/params.ts) that still named the pre-rename registry exports (sigma1, sigma1SeasonSd, sigma1NormalCdf, sigma1Defaults) after Task 1's rename — found live by Task 3's own re-grep, not in the plan's enumerated file list"
  - "Rule 2 fix: packages/harness/stateSnapshot.ts's serializeState doc comment still named the pre-rename id in its dispatch description — corrected"
  - "Left EVNT-02 through EVNT-06 Pending in REQUIREMENTS.md — this plan renders nothing (probe coverage ledger: 0 primary edges owned), matching every prior 07-xx pipeline/schema plan's precedent of marking these complete only at the rendering plan"

patterns-established:
  - "A rename's identity-vs-implementation boundary is recorded in a doc comment at the rename site itself, not only in planning docs — packages/core/algorithms/sigma1/index.ts now explains in-line why the directory keeps its pre-rename name"

requirements-completed: []

coverage:
  - id: D1
    description: "The published algorithm identity (registry entry, two committed version files, promoted-override chain, manifest builder, publisher's module table) renamed sigma1 -> vpr, proven bit-identical by the unmodified digest.test.ts gate"
    verification:
      - kind: unit
        ref: "packages/harness/digest.test.ts (unchanged, green)"
        status: pass
      - kind: unit
        ref: "packages/harness/manifests.test.ts#buildAlgorithmsManifest — D-03's published set"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts#resolvePublishAlgorithms — D-03/D-04/D-05 rename"
        status: pass
    human_judgment: false
  - id: D2
    description: "The browser tier (PUBLISHED_ALGORITHM_IDS, DEFAULT_ALGORITHM, AlgorithmSelect.tsx, e2e specs) is untouched — the deployed site keeps reading the sigma1@ objects 07-10 published"
    verification:
      - kind: unit
        ref: "git diff --numstat apps/web (exactly one file, comment-only diff)"
        status: pass
      - kind: unit
        ref: "pnpm --filter web test (626 tests, all pre-existing, unweakened)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The standing D-05 assertion's SOURCE half: no identity-shaped occurrence of the retired id survives outside a reasoned, length-asserted exclusion list"
    verification:
      - kind: unit
        ref: "packages/harness/algorithmIdentity.test.ts (6 tests, all pass; deliberately-induced failure observed and quoted below)"
        status: pass
    human_judgment: false

duration: ~70min
completed: 2026-08-28
status: complete
---

# Phase 07 Plan 16: Pipeline-side Sigma1 -> VPR rename Summary

**Renamed the published algorithm identity from `sigma1` to `vpr` across the registry, the two committed promoted version files, the harness/publisher/Worker resolution chain, and a new repo-wide standing assertion — while leaving every byte the deployed browser reads untouched.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3
- **Files modified:** 43 (across 3 commits)

## Accomplishments

- Renamed the registry entries in `packages/core/algorithms/sigma1/index.ts` (`sigma1` -> `vpr`, `sigma1SeasonSd` -> `vprSeasonSd`, `sigma1NormalCdf` -> `vprNormalCdf`, `sigma1Defaults` -> `vprDefaults`, `sigma1Adaptive` -> `vprAdaptive`), `git mv`'d the two committed promoted version files, and rewired `cli.ts`/`manifests.ts`/`manifestSchemas.ts`/`promote.ts`/`publish.ts`'s promoted-override, manifest-builder and publish-module chains — all bit-identical per the unedited `digest.test.ts` gate.
- Installed `PIPELINE_ALGORITHM_IDS` beside the unchanged `PUBLISHED_ALGORITHM_IDS` (PD-01) and repointed the three publisher/Worker-side default/validation call sites (`resolvePublishAlgorithms`, `parseLiveAlgorithmIds`, `replayRig.ts`'s default `--algorithm` list) to it, leaving the browser tier untouched.
- Re-grepped the whole tracked tree, closed what it found beyond `07-PATTERNS.md`'s enumeration, and shipped `packages/harness/algorithmIdentity.test.ts` — a filesystem-walk test that fails on any identity-shaped survival of `sigma1` (or its four harness-only variants) outside a reasoned exclusion list.
- Verified via a real `--dry-run` publish that the next real run emits `v1/event/2022alhu/vpr@2.0.0+tuned-2026-08.json` and that the retired id now throws `Unknown algorithm for publish: "sigma1" (known: opr, epa, vpr)` instead of resolving silently.

## Task Commits

1. **Task 1: The published identity — registry entries, the two promoted version files, and every site that resolves them** - `a38acb7a`
2. **Task 2: The two-tier id constant, and the Worker's write-side identity** - `4f26740b`
3. **Task 3: The full-repo sweep, the standing D-05 assertion, and the forward-looking runbook** - `56373b77`

## Files Created/Modified

Created:
- `packages/harness/algorithmIdentity.test.ts` - the standing D-05 assertion's SOURCE half (filesystem walk + exclusion list + STRUCTURAL_EXEMPTIONS + marker convention)

Modified (representative — 43 total, full list in the three commits above):
- `packages/core/algorithms/sigma1/index.ts` - registry rename + identity-vs-implementation doc comment
- `data/algorithm-versions/vpr@2.0.0+{tuned-2026-08,tracer-check}.json` - `git mv`'d, one field (`id`) changed
- `packages/harness/{cli,manifests,manifestSchemas,promote,publish}.ts` - promoted-override/manifest/publish chain rename
- `packages/harness/publishedAlgorithms.ts` - added `PIPELINE_ALGORITHM_IDS`/`PipelineAlgorithmId`
- `apps/worker/src/{scheduled,env,stateStore}.ts`, `apps/worker/wrangler.toml`, `apps/worker/migrations/0001_algorithm_state.sql` - Worker write-side identity
- `scripts/replayRig.ts` - default `--algorithm` list
- `apps/web/src/lib/searchParams.ts` - comment-only (PD-04)
- `docs/worker-operations.md` - transition-position paragraph, instruction lines updated, record lines marked
- ~20 `*.test.ts` files updated for the renamed identity (imports, id literals, new TDD cases)

## Decisions Made

- Applied PD-01 through PD-08 as written (see frontmatter `key-decisions` for the two extensions beyond the plan's literal text: `STRUCTURAL_EXEMPTIONS` and the raised marker cap).
- Left EVNT-02 through EVNT-06 Pending — matches the established 07-02..07-15 precedent that a rename-level/pipeline plan does not claim a requirement only the rendering plan fulfills.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment-terminator collision in the new identity-vs-implementation doc comment**
- **Found during:** Task 1
- **Issue:** The first draft of `index.ts`'s new doc comment used markdown emphasis (`*is*/*produces*/*resolves*`), and `*/` inside a `/** */` block prematurely closed the comment, breaking the parser (`vite:oxc` transform error at `index.ts:1250`).
- **Fix:** Reworded to `IS, PRODUCES, or RESOLVES` (no asterisks).
- **Files modified:** `packages/core/algorithms/sigma1/index.ts`
- **Committed in:** `a38acb7a`

**2. [Rule 1 - Bug] A literal NUL byte was embedded into algorithmIdentity.test.ts by the file-write tool**
- **Found during:** Task 3
- **Issue:** A doc comment describing the NUL-byte/replacement-character binary-detection heuristic via inline escape-sequence text caused the write tool to embed an actual `0x00` byte into the source file, making it register as binary to `grep` and making `looksBinary`'s own `indexOf("")` check vacuously true (flagging every file as binary).
- **Fix:** Stripped the stray byte and rewrote the heuristic using `String.fromCharCode(0)` / `String.fromCharCode(0xfffd)` instead of any inline escape-sequence text, so the source file itself never carries a literal control byte.
- **Files modified:** `packages/harness/algorithmIdentity.test.ts`
- **Committed in:** `56373b77`

**3. [Rule 2 - Missing critical] Two stale doc comments left over from Task 1's own rename, found live by Task 3's re-grep**
- **Found during:** Task 3
- **Issue:** `packages/core/algorithms/sigma1/index.ts`'s file-header doc comment and `packages/core/algorithms/sigma1/params.ts`'s two doc comments still named the pre-rename registry exports (`sigma1`, `sigma1SeasonSd`, `sigma1NormalCdf`, `sigma1Defaults`) after Task 1 renamed the actual exports — a genuine miss, not a deliberate PD-05 measurement citation.
- **Fix:** Updated to name the renamed exports, with a one-line rename attribution.
- **Files modified:** `packages/core/algorithms/sigma1/index.ts`, `packages/core/algorithms/sigma1/params.ts`
- **Committed in:** `56373b77`

**4. [Rule 2 - Missing critical] `packages/harness/stateSnapshot.ts`'s serializeState doc comment named the pre-rename id**
- **Found during:** Task 3
- **Issue:** A forward-looking dispatch-behavior doc comment (not a measurement) still said `sigma1` — this file is not in the plan's declared `files_modified` list (a newly-found tier-P hit).
- **Fix:** Updated to `vpr`, with attribution to plan 07-16.
- **Files modified:** `packages/harness/stateSnapshot.ts`
- **Committed in:** `56373b77`

**5. [Rule 2 - Missing critical] Extended the sweep's exclusion mechanism with STRUCTURAL_EXEMPTIONS, beyond the plan's literal 8-entry IDENTITY_SWEEP_EXCLUSIONS**
- **Found during:** Task 3
- **Issue:** The plan's 8 tier-based exclusions (P/C/F) do not reach six genuine, non-leftover hits the re-grep found: (a) the sweep test's own source, which must cite the retired ids literally to define its patterns; (b) `browserSafeSchemas.test.ts` citing `"sigma1"` only as an individual path-segment argument to `resolve()` — an implementation directory name (PD-02), not an identity value; (c) `publishedAlgorithms.ts`'s `PUBLISHED_ALGORITHM_IDS` value itself — PD-01's own named dual-tier file, whose browser-facing constant lives outside `apps/web/`; (d) `baselineFingerprint.test.ts` asserting against `data/baselines/opr-event-scoped-2026-08.json`'s own frozen (tier F) content; (e) `scripts/verifySubsetPublish.ts`, which verifies currently-published reality against the live public origin (tier C in substance, but the script lives outside `apps/web/`); (f) `publish.test.ts`'s own Test 9, a NEGATIVE assertion proving the retired id is now rejected — citing the id it rejects is proof of the rename, not a leftover of it.
- **Fix:** Added a second, small, separately-reasoned `STRUCTURAL_EXEMPTIONS` list (6 entries, each with its own comment), kept distinct from `IDENTITY_SWEEP_EXCLUSIONS` so that list's own length-8 assertion (about tier classification) stays meaningful.
- **Files modified:** `packages/harness/algorithmIdentity.test.ts`; the found-versus-enumerated table below records each hit against its tier.
- **Committed in:** `56373b77`

**6. [Rule 2 - Missing critical] Raised MARKER_CAP from 12 to 13**
- **Found during:** Task 3
- **Issue:** The real re-grep marked 13 genuine measured/historical citations with `[pre-rename]` (the original 12 was an estimate from before the full sweep ran, per flagged assumption 4).
- **Fix:** Raised the cap to 13 with the reason recorded in the test's own comment, per flagged assumption 4's explicit allowance ("raise it in a visible diff with a reason... never widen a file exclusion instead").
- **Files modified:** `packages/harness/algorithmIdentity.test.ts`
- **Committed in:** `56373b77`

---

**Total deviations:** 6 auto-fixed (2 Rule 1 bugs, 4 Rule 2 missing-critical/scope-completions)
**Impact on plan:** All six were necessary for the rename to be actually complete and the sweep gate to be actually true rather than tuned to pass. No architectural change, no scope creep beyond closing what the plan's own required re-grep found.

## Issues Encountered

None beyond the deviations above.

## Found-versus-enumerated sweep table (outline assumption 8)

`07-PATTERNS.md`'s enumeration named roughly 24 files as the expected rename surface. The Task 3 re-grep, run against the post-Task-1/2 tree, found identity-shaped hits (after exclusions) in 43 files actually touched across this plan's three commits, plus 6 additional files requiring a `STRUCTURAL_EXEMPTIONS` entry rather than an edit. Counts:

- **Files enumerated by PATTERNS.md:** ~24
- **Files found needing an actual edit:** 43 (matches the plan's own frontmatter `files_modified` count plus `packages/core/algorithms/sigma1/params.ts` and `packages/harness/stateSnapshot.ts`, both newly found)
- **Files found but not enumerated (needing an edit):** 2 (`params.ts`, `stateSnapshot.ts` — both Rule 2 fixes above)
- **Files found needing a STRUCTURAL_EXEMPTIONS entry (no edit, reasoned exception):** 6 (listed in Deviation 5 above)

Tier classification of everything the re-grep touched:
- **Tier P (fixed):** `packages/core/algorithms/sigma1/index.ts`, `params.ts`, `packages/harness/{cli,manifests,manifestSchemas,promote,publish,publishedAlgorithms,stateSnapshot,percentiles}.ts`, `packages/harness/fixtures/extract-digest-slice.ts`, `apps/worker/src/{scheduled,env,stateStore}.ts`, `apps/worker/wrangler.toml`, `apps/worker/migrations/0001_algorithm_state.sql`, `scripts/replayRig.ts`, and ~20 `*.test.ts` files.
- **Tier C (07-18's, unchanged here):** `apps/web/src/lib/searchParams.ts` (comment-only edit is this plan's own tier-P-adjacent slice of it, per PD-04); every other `apps/web/**` file is untouched — see `<handoff_to_07_18>` in the plan, unchanged from what it already enumerated.
- **Tier F (frozen, untouched):** `docs/models/*.md`, `docs/first-paint-measurement.md`, `docs/publish-budget.md`, `data/baselines/*.json`.
- **Neither tier, structurally exempted (see Deviation 5):** the six files listed there.

No tier-C file was found that is missing from the plan's own `<handoff_to_07_18>` list.

## Deliberately-induced failure of algorithmIdentity.test.ts

Added a scratch file `packages/harness/scratchSweepDemo.ts` containing `export const demoLeftover = "sigma1";`, ran the suite, observed the failure naming the exact file, line and matched text, then deleted the scratch file and re-ran to confirm green:

```
FAIL  |node| packages/harness/algorithmIdentity.test.ts > algorithmIdentity sweep — standing D-05 assertion, SOURCE half (plan 07-16 Task 3) > finds zero identity-shaped occurrences of the retired id outside the exclusion list
AssertionError: Identity-shaped occurrence(s) of a retired algorithm id found outside IDENTITY_SWEEP_EXCLUSIONS:
packages/harness/scratchSweepDemo.ts:1: ""sigma1"" in: export const demoLeftover = "sigma1";
```

## One observed RED failure per task (TDD)

- **Task 1** (`manifests.test.ts`'s Test 1, before the rename): `expect(manifest.algorithms.map((a) => a.id)).toEqual([opr.id, epa.id, "vpr"])` failed with `AssertionError: expected [ 'opr', 'epa', 'sigma1' ] to deeply equal [ 'opr', 'epa', 'vpr' ]` against the pre-Task-1 tree.
- **Task 2** (`liveAlgorithmTier.test.ts`'s renamed-tier case, before Task 2's rewiring): `parseLiveAlgorithmIds("vpr")` threw `UnknownLiveAlgorithmIdError: parseLiveAlgorithmIds: "vpr" is not a published algorithm id (accepted: opr, epa, sigma1)` before `PIPELINE_ALGORITHM_IDS` existed.
- **Task 3**: the deliberately-induced sweep failure above.

## Before/after version-file fields (id changed, everything else byte-identical)

| File | id (before) | id (after) | codeVersion | paramSetName | version |
|---|---|---|---|---|---|
| `vpr@2.0.0+tuned-2026-08.json` | `sigma1` | `vpr` | `2.0.0` (unchanged) | `tuned-2026-08` (unchanged) | `2.0.0+tuned-2026-08` (unchanged) |
| `vpr@2.0.0+tracer-check.json` | `sigma1` | `vpr` | `2.0.0` (unchanged) | `tracer-check` (unchanged) | `2.0.0+tracer-check` (unchanged) |

`git diff -M --stat data/algorithm-versions/` shows both as renames (98%/99% similarity, exactly one changed line each).

## Confirmations

- `pnpm vitest run packages/harness/digest.test.ts` green; `git diff --numstat packages/harness/digest.test.ts` reports no change.
- `git diff --numstat apps/web` lists exactly one path (`apps/web/src/lib/searchParams.ts`); `git diff -U0` on it touches only lines starting with `*`.
- `git diff --numstat docs/publish-budget.md docs/first-paint-measurement.md docs/models data/baselines` reports no change.
- Final `[pre-rename]` marker count: 13, against the cap of 13 (raised from 12, see Deviation 6).

## Dry-run publish emitted key sample

```
$ pnpm tsx packages/harness/publish.ts --event 2022alhu --algorithm vpr --dry-run
[dry-run] Would publish "v1/event/2022alhu/vpr@2.0.0+tuned-2026-08.json" (128551 bytes) to bucket "sigmascout-artifacts" — no upload performed.

$ pnpm tsx packages/harness/publish.ts --event 2022alhu --algorithm sigma1 --dry-run
publish:artifacts failed: Unknown algorithm for publish: "sigma1" (known: opr, epa, vpr)
```

## User Setup Required

None - no external service configuration required. Every command run in this plan was `--dry-run`, a local test, or a typecheck; no credential was read, no R2 write occurred, no D1 statement ran, no Worker was deployed.

## Next Phase Readiness

- 07-17 can now run its write pass: the publisher writes under `vpr`, the manifest and artifact key cannot disagree (T-07-16-01 closed by construction), and the two-tier constant means 07-17's write is purely additive.
- 07-18 has a complete, unchanged `<handoff_to_07_18>` enumeration to work from, plus the one new file (`packages/harness/algorithmIdentity.test.ts`) whose `apps/web/` exclusion entry it must delete.
- 07-19 has the Worker's `wrangler.toml` already pointing at `vpr` (inert until redeploy) and the D1/R2 deletion targets named in `publishedAlgorithms.ts`'s own doc comment.
- No blockers. The one pre-existing, WINDOWS.md-ledgered failure (`payloadBudget.test.ts`'s teams/{year} ceiling, ledger #11) is unrelated to this plan and untouched by it.

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED
- SUMMARY.md exists on disk at the expected path.
- All three task commit hashes (a38acb7a, 4f26740b, 56373b77) found in git log.
