# Quick Task 260912-ivg: Rename BPR to SPR (Sigma Power Rating) - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Task Boundary

Rename BPR to SPR (Sigma Power Rating) everywhere it makes sense — user-facing
text, code identifiers, the file tree, and the published data — with exceptions
only for genuinely critical infrastructure.

`SPR` already exists as the DISPLAY name (the `/methodology/spr` route,
`sprContent.ts`, `SprPage.tsx`, team-table column headers, `metricGroups.ts`).
What still carries `bpr` is the IDENTIFIER layer: `packages/bpr/`,
`packages/core/algorithms/bpr.ts`, ~198 non-planning files, and the wire id
`"bpr"` embedded in R2 object keys, the URL search param, the KV manifest, and
D1's `algorithm_id` column.

There is no `spr` wire-id collision — `spr` currently appears only as a route
slug and content-section id.

</domain>

<decisions>
## Implementation Decisions

### Scope of the rename — FULL CUTOVER (Jacob, 2026-09-12)

The rename crosses the wire-identifier boundary. `PUBLISHED_ALGORITHM_IDS`
becomes `["opr", "epa", "spr"]`, R2 objects become `v1/.../spr@<version>.json`,
D1 rows become `algorithm_id = 'spr'`, and the Worker folds live under `spr`.

This was offered against a source-tree-only alternative and the full cutover was
chosen deliberately, after being told it is the four-plan `sigma1` -> `vpr`
operation rather than a quick task. Proceeding as instructed.

### Historical record — LEFT AS-IS (Jacob, 2026-09-12)

Do NOT rewrite:
- anything under `.planning/` (quick-task history, plans, summaries, STATE.md rows)
- `data/baselines/` file CONTENT
- sealed/frozen provenance stamps that record what was measured under the name BPR
  (`packages/bpr/frozen-params.json`, `sealedPaths.ts`, holdout provenance comments)

These are an audit trail of what was measured and when. Renaming them
retroactively would falsify the record the sealed 2016-2022 / 2023-2026 holdout
depends on. Add a short note that BPR and SPR are the same algorithm under two
names, rather than editing the history to read as though it was always SPR.

### Concurrent session in stateProbe.ts — TAKE THE FILE OVER (Jacob, 2026-09-12)

Quick task `260912-iur` (plan committed `eb3a87bf` at 13:35, no SUMMARY, absent
from STATE.md) holds 102 uncommitted lines in `apps/worker/src/stateProbe.ts`,
adding an `?rp=` ablation arm. That file must be renamed (`runBprFold` and ~10
other references).

Decision: rename it along with everything else and carry the uncommitted `iur`
edits into this task's commits. This is a deliberate, recorded commingling of two
tasks — NOT the silent absorb that produced `f0c7af48`. The `iur` session will
hit conflicts; that was accepted.

### Who runs the cutover — THIS SESSION, END TO END (Jacob, 2026-09-12)

Source rename, republish, D1 reseed, Worker redeploy, client flip, and `bpr@`
cleanup all run in this session from the main context. Jacob is hands-off.

Network operations MUST run from the main context — executor subagents' sandbox
denies all network Bash (including `pnpm publish:seasons`).

</decisions>

<specifics>
## Specific Ideas

### The staging is load-bearing, not ceremony

Cloudflare Pages deploys on push. A single-step flip of
`PUBLISHED_ALGORITHM_IDS` to `spr` would deploy a browser that requests
`v1/teams/2026/spr@3.0.0.json` before any such object exists — a site-wide 404.
The transition therefore uses the same two-tier split the `sigma1` -> `vpr`
rename used (documented in `packages/harness/publishedAlgorithms.ts`):

1. **SOURCE** — rename the tree. Publisher/Worker WRITE tier says `spr`; the
   browser-READ tier still says `bpr`. Safe to push: the deployed site keeps
   reading the `bpr@` objects that still exist.
2. **WRITE PASS** — republish. `spr@` objects land in R2 alongside `bpr@`.
   Artifacts before manifest — that ordering is load-bearing. This republish also
   discharges the presim republish already recorded as OWED in STATE.md row 131.
3. **D1 RESEED** — insert `algorithm_id = 'spr'` rows.
4. **WORKER DEPLOY** — `LIVE_ALGORITHM_IDS=spr`.
5. **CLIENT FLIP** — collapse the two tiers back into one. Push; Pages deploys;
   the browser now reads `spr@`.
6. **CLEANUP** — delete `bpr@` R2 objects and `algorithm_id='bpr'` D1 rows, with
   a before/after census as the evidence (a deletion's own exit code is not
   evidence).

### Known operational hazards to respect

- D1 seed `--file` needs `.env`'s token; `--command` needs its ABSENCE. ~4 seed
  passes/day trips the 100k row-write cap.
- Never render `.env` contents into any output stream.
- `publish.ts --event` replays its season from nothing — never use it here.
- `git mv` after an `Edit` can silently drop the edited content; `git status`
  after every commit that renames a file.
- Test scope differs by cwd: vitest from `apps/web` sees ~77 files, from the repo
  root ~167. Run from the root.
- Root `tsc --noEmit` misses `apps/web`; run the web tsconfig too.
- Tests that ITERATE a hardcoded id list will silently skip the renamed id; only
  equality pins fail loudly. Check `algorithmIdentity.test.ts`, the compare
  fixtures, and the publish lists.
- `publish:seasons` prints its budget summary but does NOT write
  `docs/publish-budget.md` — transcribe it manually or the tests stay red.

### The identity sweep guard

`packages/harness/algorithmIdentity.test.ts` is a standing full-tree scan that
fails on identity-shaped occurrences of a retired id outside a short, pinned,
length-asserted exclusion list. It currently guards `sigma1`. Retiring `bpr`
should extend that same mechanism rather than invent a second one.

</specifics>

<canonical_refs>
## Canonical References

- `packages/harness/publishedAlgorithms.ts` — the published-id registry, and the
  best written account of how the `sigma1` -> `vpr` two-tier rename was staged.
- `packages/harness/algorithmIdentity.test.ts` — the SOURCE/CLIENT/LIVE split and
  the standing retired-id sweep.
- `packages/harness/pageArtifacts.ts:140` — `artifactKey()`, where the algorithm
  id enters the R2 key.
- `apps/worker/migrations/0001_algorithm_state.sql` — D1 `algorithm_state`,
  keyed `(algorithm_id, scope_kind, scope_key)`, re-baselined by
  DELETE-then-INSERT.
- `scripts/verifySubsetPublish.ts` — the re-runnable live-absence check, and
  where `expectAbsent` entries for the retired id belong.
- `Skill("sigmascout-retune-republish")` — the unattended republish runbook.

</canonical_refs>

