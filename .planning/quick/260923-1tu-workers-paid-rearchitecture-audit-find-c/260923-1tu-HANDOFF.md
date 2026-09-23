# Handoff: Workers Paid re-architecture, night of 2026-09-23

Written for Jacob, to run in the morning. Everything below is committed on `main`; the last
20 commits (from `f0da5088`) are deliberately NOT pushed. Read "Why the push is held" before
pushing anything.

## What landed tonight (five quick tasks, all green at every commit)

| Task | What | Lines |
|---|---|---:|
| 260923-3w9 | `docs/simulation-architecture.md` corrected; simulation stays in the browser | docs |
| 260923-3w4 | State-probe Worker, subrequest budget and deferral, probe cap, 10-minute rebuild interval, and KV deleted. Worker touches only D1 and R2 | about -7,400 |
| 260923-3w6 | Worker prices upcoming matches and writes team artifacts again; `state` block, `live` block and live roster no longer emitted; browser-relay scripts deleted | about -4,700 |
| 260923-3w7 | Web drops browser pricing, the team overlay and derived standings; the tick counts standings; one event schema | about -3,500 |
| 260923-3w8 | Live tier widened to opr, epa, spr; opr 6.0.0 and epa 13.0.0; level-1 digests byte-unchanged | +385 |
| 260923-3x0 | `tierCuts` published on team-season artifacts so live-folded robot-page rows keep their tier | +607 |

Whole night, audit HEAD `08384620` to now: **142 files, +6,044 / -19,927**.
Final verification at HEAD: `npx vitest run` from the repo root and all three `tsc` projects; see
the last STATE.md rows and each task's SUMMARY.md for the pasted output.

## Why the push is held

The new web schema rejects the schedule-only upcoming rows that the currently DEPLOYED Worker
(pre-3w6) still writes during a live fold. Pushing `main` deploys the web through Pages. If that
happens before the Worker is deployed and an event goes live, every live event page fails to parse.
Two probe windows open 2026-09-24 12:00 UTC (`2026miwyo`, `2026nhgc`).

The Worker deploy itself was denied to me by the auto-mode classifier as a production deploy, and
`pnpm rebaseline` runs that same deploy internally, so both are yours.

## The morning sequence, in this order

1. `git status` to confirm only your sketch files are dirty, then from the repo root:

   ```bash
   pnpm rebaseline
   ```

   It runs ingest, **Worker deploy, then publish** (that order matters), the four seed files with
   `seed-cursors.sql` last, verify, prune. Expect the deploy to print
   `env.LIVE_ALGORITHM_IDS ("opr,epa,spr")` and exactly two bindings, `DB` and `ARTIFACTS`. Expect
   the manifest to name `opr@6.0.0+baseline`, `epa@13.0.0+baseline`, `spr@7.0.0+baseline`. R2
   storage peaks around 7.2 GB while both opr and epa generations coexist; the run writes about
   109,000 Class A operations. Prune will say NOT pruned (six-hour recent-write guard); run
   `pnpm rebaseline --from prune` after that window to reclaim about 2.8 GB.

2. Commit `docs/publish-budget.md` if the publish rewrote its budget block.

3. Push, then watch CI:

   ```bash
   git push origin main
   gh run list --limit 2
   ```

   Verify the Pages deploy with an `Origin` header or a real browser (the 2026-09-17 cache-poisoning
   lesson), then rerun the Playwright specs against the live site.

4. `wrangler tail` for a minute or two. `state-generation-mismatch` means the seed did not land
   (`pnpm rebaseline --from seed`). `LeagueRowShapeVersionError` naming opr or epa means a partial
   seed. `upcoming-pricing-failed` is the one new warning line. No real fold has ever been observed
   in production, so the first live event after this is the first time all three algorithms fold
   against real data; the two offseason events this weekend are the first chance.

5. Dashboard, any time: add a Cache Rule on `data.sigmascout.org` with a 60 s edge TTL (JSON is not
   edge-cached by default, so every page view is an R2 read today), and delete the now-unbound KV
   namespace `f051554d9d60407097959b92aca51109`.

## Known follow-ups, none blocking

- `SeasonHeader` on the robot page tiers its season tiles from a published percentile, which a live
  tick drops, so those tiles thin during live folding. Pre-existing, cheap to close the same way
  3x0 closed `EventSection` (pass `artifact.tierCuts`, use `resolveMetricTier`).
- The percentile NUMBER for a live-folded row is still absent (`live-merges-drop-percentiles.md`);
  the compact-pool direction is now feasible on the tick.
- History wart: commit `94268898` ("docs(quick-260923-3w9): summary") also carries the three probe
  file deletions, because my summary commit swept up the other agent's staged index. The tree is
  right; `224d7d84`'s body records it.
- `docs/worker-operations.md` still has a few struck-through historical paragraphs rather than
  deletions; fine to trim later.
