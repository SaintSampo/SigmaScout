---
id: presim-all-seasons-handoff
created: 2026-10-05
source: session of 2026-09-29 to 2026-10-05 (quick 260929-mkn, debug epa-presim-pricing-slow, quick 261004-v3h)
priority: medium
---

# Pre-schedule simulation for every season: handoff

## The goal

Jacob wants the Simulation tab's "Before schedule release" stop on every season's event pages. Today
only 2026 events have it. The stop reads a small pre-computed file per event and algorithm (the
"presim sidecar", `v1/presim/{eventKey}/{algorithm}@{version}.json`), built offline by
`pnpm publish:seasons`.

Coverage is one setting: `--presim-from-season 2026` in the `publish:seasons` script in
`package.json`. Setting it to 2016 turns on every season. Nothing else in the publisher or the client
depends on the year. The only question left is how long the rebuild then takes, and that has not been
measured on the current code.

Nothing from this work is pushed, published or deployed. Coverage is still 2026 only.

## 2026-10-05: steps 1 to 3 done

- **Step 1 done.** The all-seasons dry run ran on current code (commit 5e047e98). Command:
  `npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2016 --dry-run --skip-state`.
  Started 01:12, finished 03:56 on 2026-10-05. Log: `reports/presim-allyears/dryrun-20261005.out.log`
  (local, gitignored).
- **Measured figures.**
  - Total wall clock 9,822.6 s (2 h 44 min).
  - EPA sidecars 3,982 s and SPR sidecars 5,046 s, each summed over seasons.
  - 2026 alone: EPA sidecars 518.4 s and SPR sidecars 534.1 s.
  - 3,336 presim sidecars, median 7,792 bytes, p95 19,125, max 42,582.
  - The whole publish: 108,661 objects and 4,192,395,808 bytes.
- **Comparison.** The earlier all-seasons dry run at bd040e70 (before both speed fixes) took 7.85 h.
  A 2026-only full publish took about 31 minutes (1,871 s on 2026-09-19). The dry run uploads
  nothing, so the real publish's wall clock also includes R2 upload time this run did not measure.
- **The offseason worry in "Read this first" did not happen.** Offseason events get no sidecar (the
  explicit gate added by quick 261004-uyc), so the sidecar count did not grow by half again.
- **Step 2 done.** Jacob approved turning it on on 2026-10-05, after this measurement.
- **Step 3 done in quick task 261005-kzs.** `package.json`'s `publish:seasons` now passes
  `--presim-from-season 2016`. `DEFAULT_PRESCHEDULE_FROM_SEASON` was left at 2026 because
  `publish.test.ts` does not assert it (the drift tripwire only checks the script's flag). The
  comment above that constant, the `preSchedule.ts` header, `docs/simulation-architecture.md`
  section 3, and the `docs/publish-budget.md` bullet were corrected.
- **Still open.** The live site serves 2026-only sidecars until step 4's publish runs (main session,
  Jacob's go-ahead in the moment). Step 5 is unchanged.

## Read this first: the timings below are stale

On 2026-10-04 another session (quick 261004-uyc, commits 558adb9f and 3515159f) made offseason events
ranking-point events and bumped SPR to 10.0.0. Event type 99 is now in `EVENT_TYPE_TIERS`
(`packages/core/rankingPoints/constants.ts`), so offseason events now get presim sidecars. Every
timing in this file was taken while they were skipped.

The corpus holds 926 offseason events across 2016 to 2026 (111 of them in 2026) against 1,918 that
were eligible before. Expect roughly half again as many sidecars, less whatever the other skips
remove (roster outside the generator's range, cancelled events, events with no qualification
matches). No run has counted them.

## What is settled

Each of these was measured. Do not redo or re-propose them without new evidence.

| Question | Answer | Evidence |
|---|---|---|
| Can the browser compute it instead of the offline build? | No. The browser reproduces the offline histograms exactly, but a 75-team event takes 80.6 s to reach 1,000 schedules at a 4x CPU slowdown and 135.1 s at 6x. | `.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md` |
| Why was EPA's sidecar pass so slow? | `epa.predict` copied the whole team map on every call that named a team with no match yet that season. Fixed in 973e06e5. All 418 sidecars of 2026 were byte-identical before and after (checked with `diff -rq` by the orchestrator). | `.planning/debug/resolved/epa-presim-pricing-slow.md` |
| Can schedule generation be faster without changing output? | Yes, done. `generateSchedule` is about 4.8x faster (93d400fd) and a golden-digest test pins its output for 17 shapes (7ac8dc25). The executor reported 418 of 418 sidecars byte-identical. | `.planning/quick/261004-v3h-presim-schedule-generation-speedup-and-f/261004-v3h-FINDINGS.md` |
| Can the bake use fewer than 1,000 schedules? | No. See the table below. More draws per schedule do not make up for fewer schedules. | same FINDINGS, Part B |
| Is an on-disk schedule cache worth building? | No. After the rewrite, generation is 5.8% of a season's sidecar seconds. | same FINDINGS, Part A |

Fewer schedules, measured on SPR 9.0.0 for 2026txmca, 2026casnd and 2026joh, ten pairs of
independent builds per count. Each cell compares two builds of the same event that differ only in
their random schedules and draws.

| Schedules | Teams whose median rank moved 1.0 or less | Largest move of any team |
|---|---|---|
| 300 | 84.7% | 3.25 ranks |
| 500 | 90.4% | 2.42 |
| 750 | 95.1% | 2.31 |
| 1,000 (shipped) | 96.6% | 2.11 |
| 2,000 | 99.6% | 1.66 |

The bars were fixed before measuring: at least 95% within 1.0 and no team above 2.0. Only 2,000
passes both. The 75-team event drives the result; the 27 and 40 team events pass at 300 to 500.
`PRESIM_SCHEDULE_COUNT` is unchanged at 1000. Changing it is Jacob's decision and would need a new
SPR version and a new EPA version, because it changes published numbers.

Also settled, from earlier work: the field-averaged shortcut that skips sampling fails badly
(`docs/models/field-averaged-presim.md`), and Jacob has ruled that changed published numbers always
ship under a new algorithm version.

## Timings on record

All were taken before the offseason change. Treat them as lower bounds.

| Run | Code | Result |
|---|---|---|
| All seasons, cutoff 2016, dry run | bd040e70, before both fixes | 7.85 h total. EPA sidecars 6.57 h, SPR sidecars 1.07 h. |
| 2026 only, old generator | after the EPA fix | EPA sidecars 1,189.5 s, SPR 591.5 s |
| 2026 only, new generator | after both fixes | EPA sidecars 853.6 s, SPR 635.4 s, 418 sidecars |

The two 2026 runs shared the machine with other jobs, so their seconds are rough.

The per-algorithm `sidecars` timer is not like for like. EPA runs before SPR, so EPA's figure
includes generating the schedule shapes both use and SPR's does not. A comment at the timer in
`packages/harness/publish.ts` says so.

A full publish with 2026-only sidecars took 1,871 s on 2026-09-19, before EPA had sidecars at all.

## Outstanding work, in order

1. **Time an all-seasons rebuild on the current code.** This is the number the decision needs.
   Run it as a dry run, which uploads nothing:

   ```
   npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2016 --dry-run --skip-state
   ```

   - Do not add `--write-budget`. It rewrites `docs/publish-budget.md`.
   - `--skip-state` stops it overwriting the local D1 seed files under `reports/publish/`.
   - It runs for hours. Start it detached with PowerShell `Start-Process` and redirect output to a
     log; background Bash jobs get killed on this machine.
   - The `timing:` lines print only when the run ends. For progress, watch for
     `publish: season YYYY [opr]: N matches replayed`, which marks the start of each season.
   - Compare against the same command with `--presim-from-season 2026` if you need the extra cost
     as a difference and not an absolute.

2. **Take the result to Jacob.** If the extra time is acceptable, go to step 3. If it is not, the
   untried lever is building sidecars for several events at once on worker threads. Each event's
   sidecar is independent, so the output can stay byte-identical. The profile also puts `roundPmf`'s
   decimal shifting at 12.7% of sidecar time; nobody has looked at whether that can be cut.

3. **Turn it on.** Change `--presim-from-season 2026` to `2016` in `package.json`. Keep the flag
   explicit: a test in `packages/harness/publish.test.ts` fails if it is deleted or set later than
   the latest published season. `DEFAULT_PRESCHEDULE_FROM_SEASON` in `packages/harness/publish.ts`
   is the fallback value; run that test file after the change and move the constant too if the test
   asks for it. Then update the three places that say coverage starts at 2026:
   - `apps/web/src/lib/api/preSchedule.ts`, the header comment ("defaulting to 2026")
   - `docs/simulation-architecture.md`, section 3's client read path ("pre-2026 season")
   - `docs/publish-budget.md`, the "Gated by `--presim-from-season`" bullet. The JSON block lower
     in that file is rewritten by the publish itself.

4. **Publish.** This writes to the live site's data, so it needs Jacob's go-ahead in the moment. Run
   it from the main session, not a subagent, because subagents have no network. `pnpm rebaseline`
   runs the whole chain in a safe order (ingest, Worker deploy, `publish:seasons`, seed, verify,
   prune); `docs/worker-operations.md` describes it.

5. **Record the browser result.** Jacob reopened browser pricing on 2026-09-29 and the measurement
   closed it again. Neither `.planning/todos/completed/price-the-preschedule-simulation-in-the-browser.md`
   nor `docs/simulation-architecture.md` section 5 mentions the reopening or the result. Section 5's
   Option B also still argues from a matrix decomposition that SPR's ranking-point odds stopped
   using on 2026-09-14. Add the measured result to both.

## Things to check before trusting them

- **What is live.** SPR 10.0.0 was committed by another session and I do not know whether it has been
  published. Read `https://data.sigmascout.org/v1/manifest/algorithms.json` before assuming which
  versions the site serves.
- **Unpushed commits.** `main` was 35 commits ahead of `origin/main` when this note was committed,
  from several sessions. Pushing
  deploys the site and ships all of them. Ask Jacob first and check `gh run list` afterwards; the
  deploy does not wait for tests.
- **Demo robots in a roster.** The spike's roster rule gave 2026txmca 27 teams, not its 18 real ones,
  because nine demo robots (frc9991 to frc9999) appear in its playoff matches. I did not check
  whether the published sidecar for that event has the same 27. If it does, that event's
  pre-schedule simulation includes nine robots that never played a qualification match.
- **EPA with fewer schedules.** The table above is SPR only. EPA's was not measured.
- **Byte identity under SPR 10.0.0.** Both identity proofs ran on the tree before SPR 10.0.0. They
  show my changes did not alter output there. The generator's golden test passes at the current head
  (43 tests, run 2026-10-05).
- **Numbers I did not rerun.** The 418 of 418 result for the generator rewrite and the root test run
  (7,431 passed, 1 skipped) are the executor's report. The debug session also planned a separate
  revert-and-reconfirm check that never ran; the old-code run stands in for it.
- **A stale comment.** The comment above `PRESIM_SCHEDULE_COUNT` in `packages/harness/publish.ts`
  quotes a retired measurement (10.61 ranks at 20 schedules, 1.17 at 1,000). The new measurement
  found 2.11 at 1,000 with ten pairs across three events.
- **Worker.** The live Worker imports the same `epa.ts`. The fix changes no numbers, and it has not
  been deployed; it will ride the next Worker deploy.

## Where things are

Committed, all unpushed:

- Browser spike: 950c461f, b81a1071, 0433e0a8, 2bfae95d. Scripts `scripts/browserPresimPricing.ts`,
  `scripts/measureBrowserPresimPricing.ts`.
- EPA fix: 973e06e5, 14bfeac1.
- Generator and schedule count: 7ac8dc25, 93d400fd, 1e112145, 5c78b3a1, f62462e3, 25ce4cc3.

Local only, gitignored, on Jacob's machine:

- `reports/presim-allyears/dryrun.out.log`: the 7.85 h run's full log.
- `experiments/261004-v3h/`: the probe that builds sidecars with a pinned generation and timestamp
  so two trees can be compared byte for byte (`presimProbe.mts`), the schedule-count driver
  (`scheduleCount.mts`), the generator sweep (`structureSweep.mts`) and each run's arguments
  (`*.args.txt`), logs and sidecar bodies.
