# Deferred: 260904-7id's republish and Worker deploy (Task 3, held)

## Why this is parked

Task 3's `checkpoint:decision` ("republish now, or hold until quick task 260904-5px
finishes?") was pre-answered by the user: **HOLD the republish.** At the time the
checkpoint was written, the stated reason was that 260904-5px was mid-flight (only Task 1
of three committed) and a republish now would guarantee a second republish once 5px
finished its remaining work.

**That reason is now STALE and should not be trusted by a future reader.** By the time
this quick task actually executed, 260904-5px had fully landed — all three of its tasks
are committed (`215b0c34` Task 1 fouls-exclusion, `f0c7af48` Task 2 elimination discount,
`b845a58b`/`1d40b4c0` Task 3 ribbon rename + docs), it has its own SUMMARY, and
`.planning/STATE.md` records it complete. 260904-6a1 (adjust-pinning) is also fully
landed. So the ORIGINAL blocking condition ("5px unfinished") has actually resolved on
its own — but the user's HOLD instruction for THIS session was explicit and unconditional
("HOLD the republish... Do NOT run any publish/deploy command"), so the republish stayed
parked regardless of whether its original justification still held. Do not re-derive "5px
is still blocking this" from the plan text alone — verify current git log / STATE.md
first, exactly as this note now records.

## What actually shipped in this task (already committed, already live in the branch's code — NOT live on the site)

- `packages/core/algorithms/epa.ts`: `teamMetrics()` publishes `phaseAuto`/`phaseTeleop`/
  `phaseEndgame` as value-only entries, summed from `componentsInGroup`. EPA's version
  stays `5.0.0+baseline` (D-2's no-bump reasoning, proven by unchanged baseline
  fingerprints).
- `apps/web/src/lib/metricKeys.ts`: `publishesGroupMetrics("epa")` now `true`.
- Client-side: the Teams grouped view, team-page phase tiles, and event Insights columns
  all read the published tier when present; `withDerivedGroupMetrics` survives as the
  stale-artifact fallback.
- **None of this is visible on the live site.** The live manifest (checked read-only,
  credential-free, at task execution time) is still:
  ```
  generation: 4ba99e89-b196-4f88-90c7-3bc1ffae3de9
  computedAt: 2026-09-04T08:07:20.010Z
  opr@4.0.0+baseline, epa@2.0.0+baseline, vpr@7.0.0+rolling-2026-09
  ```
  Live EPA artifacts carry `epa@2.0.0+baseline` — no group entries at all, from BEFORE
  even 5px's fouls-exclusion and 6a1's adjust-pinning changes, let alone this task's group
  publication. A visitor today sees none of this work.

## The parked ship checklist (verbatim intent from the plan's Task 3, unmodified)

When the republish is authorized, in order:

1. **Pre-flight.**
   - Zero publish processes already in flight — an untruncated, self-excluding
     `Get-CimInstance Win32_Process` filter for `publish.ts`.
   - Re-check the live manifest's `generation` against **whatever is live AT THAT TIME**
     — do not assume it is still `4ba99e89-b196-4f88-90c7-3bc1ffae3de9`; that was this
     task's own read, and other sessions may have published since. A different generation
     means another publish landed — stop and report rather than layering on top of an
     unknown run.
   - `git status --porcelain` clean under `packages/`, `apps/worker/`, `scripts/`;
     record `git rev-parse HEAD` — the publish and the Worker deploy must come from the
     same commit.
2. **Run the republish once, backgrounded, never a retry:**
   `npx tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason`
   Expect ~18-25 minutes, ~56,776+ PUTs (this task adds 3 new metric keys per EPA team/row,
   slightly larger than the last recorded run). If it appears to die, verify via
   `Get-CimInstance` and advancing `teams/{year}` generations before concluding anything —
   do not restart, do not patch a subset of seasons (`publishSeasons` bridges season state
   only within one call).
3. **Verify the shipped bytes against the credential-free public origin:**
   - `npx tsx scripts/verifySubsetPublish.ts` — 0 failing, exactly one distinct generation.
   - `v1/manifest/algorithms.json` names `epa@5.0.0+baseline` (unchanged from this task's
     branch — no EPA version bump happened here) and whatever `vpr`/`opr` versions are
     current at publish time.
   - `v1/teams/2026/epa@5.0.0+baseline.json`'s `metricKeys` preamble contains the three
     group keys; at least one row's slot for one of them is the three-element tiered form.
   - Pick a large EPA team artifact, record its byte size, confirm
     `seasonStats.metrics.phaseAuto` carries a percentile.
4. **Redeploy the Worker from the SAME commit** (`scheduled.ts` writes artifact keys from
   its own bundled `algorithm.version`, not the manifest's — a stale bundle would keep
   writing to keys the client no longer fetches):
   `pnpm worker:deploy`
   Confirm `git rev-parse HEAD` unchanged from the pre-flight recording.
5. **Render one production proof** (D-5, closing the loop this task's LOCAL preview
   already validated the mechanism for): Teams grouped EPA view showing a real tier box on
   Auto/Teleop/Endgame, screenshotted against the deployed site or a local page pointed at
   `VITE_ARTIFACT_ORIGIN=https://data.sigmascout.org`.
6. **Transcribe the publish summary into `docs/publish-budget.md` by hand** — the command
   prints it but does not write it. New dated section, same format every prior entry uses:
   exact command, generation, object count, byte total, wall clock, concurrent-process
   check, per-page-kind table with the change versus the last recorded run, and a plain
   statement of what changed (EPA's three published phase-group metrics — this task — PLUS
   the now-already-committed-but-unshipped 5px fouls-exclusion/elimination-discount and
   6a1's adjust-pinning, all THREE of which are still only live under `epa@2.0.0+baseline`
   today). If any page kind's measured max exceeds its committed `budgetMaxBytes`, report
   the number and stop — do not raise a budget to make a gate pass.
7. **Update `.planning/todos/pending/republish-after-adjust-model-change.md`**: mark this
   item done, naming the run's generation. This task's own group-metrics change is a NEW
   reason this republish is owed, in addition to the fouls/elimination/adjust reasons
   already on file there — do not lose that when marking it resolved.

## What this republish will ship, all at once (first live appearance of ALL of it)

- **260904-5px** (fully landed in code, never shipped): EPA's no-foul `total`
  (`epa@3.0.0` equivalent change), Statbotics' elimination-match discount
  (`epa@5.0.0` equivalent change). Ribbon label "EPA Statbotics 5.0" is ALREADY
  version-gated and will self-activate the moment the manifest reports `epa@5.x`.
- **260904-6a1** (fully landed in code, never shipped): `adjust` pinned at 0 for every
  team in both EPA and Sigma1/VPR; adjust-zeroed-ruling alliances excluded from both
  algorithms' observations.
- **260904-7id** (this task, fully landed in code, never shipped): EPA's
  `phaseAuto`/`phaseTeleop`/`phaseEndgame` published as first-class, tiered metrics.

A single republish is therefore the FIRST live ship of four separate quick tasks' worth of
EPA/VPR model and publish-surface changes, not just this one.

## Local visual proof already completed (in lieu of the held republish)

Screenshots under `../shots/`:
- `teams-grouped-epa.png` — Teams page, 2026, EPA algorithm, grouped view. Real amber
  (legendary-tier) boxes on every visible Auto/Teleop/Endgame cell, produced by a LOCAL
  run of the real `publishSeasons` pipeline (season 2026 only, r2Client mocked so no
  network/credentials were used) served from a throwaway static file server, with the
  running dev server's `VITE_ARTIFACT_ORIGIN` pointed at it.
- `team-88-phase-tiles.png` — Team 88 (TJ²) page, 2026, EPA algorithm. Real tier boxes
  (legendary Auto/Endgame, epic Teleop, epic Total) on the SeasonHeader phase tiles.

This proves the mechanism end-to-end (pipeline computes the group, publish attaches the
tier, client renders it) without touching production. The republish above is what makes
this visible to an actual visitor.
