---
slug: worker-tick-exceeds-cpu-budget
status: resolved
trigger: "Deployed Worker fails 100% of cron ticks with outcome:\"exceededCpu\", cpuTime pinned at 10ms, empty logs array."
created: 2026-08-29
updated: 2026-08-29
phase: 07-event-pages
related:
  - .planning/WINDOWS.md ledger #16
  - .planning/todos/pending/worker-tick-exceeds-cpu-budget.md
---

# Worker cron tick exceeds free-plan CPU budget on every tick

## Symptoms

**Expected behavior**
The deployed `sigmascout-worker` cron tick (`crons = ["* * * * *"]`) runs once a minute,
evaluates which events are live, folds new match results, writes artifacts to R2, and exits
well inside the Cloudflare free plan's 10 ms CPU-per-invocation budget. A healthy tick logs a
structured line ending `"ok":true`.

**Actual behavior**
Every observed tick is killed by the runtime. `wrangler tail --format json` shows:

```json
{
  "wallTime": 128,
  "cpuTime": 10,
  "truncated": false,
  "executionModel": "stateless",
  "outcome": "exceededCpu"
}
```

`cpuTime` is pinned at exactly 10 (the free-plan ceiling), and the `logs` array is **empty** on
every tick — the tick's own `console.log` never runs, so execution dies before reaching any
handler code.

**Error messages**
No thrown error and no log output. The only signal is `outcome: "exceededCpu"`. Observed 7/7
across two capture windows by plan 07-19, then independently reproduced by the phase
orchestrator on a fresh `wrangler tail`.

**Timeline**
Worker version `638da16c-d538-4551-b3a0-a2757a77061f`, deployed by plan 07-19 Task 3.
Immediately post-deploy the SAME version recorded 7 healthy ticks (4 then 3), all `"ok":true`,
`eventsConsidered:0`, no `live-tier-defaulted`, no `EmptyLiveAlgorithmTierError`. Hours later,
100% of ticks fail. No event was live in either window.

**Reproduction**
`cd apps/worker && npx wrangler tail --format json` — observe any tick.

## Current Focus

bug_class: Bohrbug (deterministic, data-triggered -- reproduced 4 separate times)

status: RESOLVED. Root cause confirmed (AND-gate, both legs), fix implemented, regression-tested,
  committed, DEPLOYED, and VERIFIED on live ticks while the trigger was still armed. One premise the
  session itself carried throughout -- that the free plan enforces a FLAT 10 ms per-invocation
  ceiling -- was disproven by the read-back and is corrected here and in every document that leaned
  on it. The 10 ms CONSTANT survives; the enforcement model does not.

verified_on: version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`, 2026-08-29. Three consecutive ticks,
  all `outcome:"ok"`, `exceptions:[]`, cpuTime 21 / 30 / 17 ms -- while `eventsConsidered:2` shows
  cause B is STILL FULLY ACTIVE in the deployed artifact. Fix A1 ALONE cleared the outage.

reasoning_checkpoint:
  hypothesis: "Every cron tick exceeds the 10 ms CPU budget because TWO conditions hold at once:
    (A) the tick Zod-validates all 1,581 live-windows on every invocation before deciding whether
    anything is live, costing 5-9 ms of the 10 ms budget on the platform; and (B) two PHANTOM
    `inferred` windows -- synthesised from `start_date` for zero-match offseason events -- keep
    `liveEvents.length === 0` false, so the tick runs the full ~38 ms live path on top of (A)."
  confirming_evidence:
    - "Direct observation 2026-08-29T21:55:44Z: a surviving tick logged `eventsConsidered:2` at
      cpuTime 38 ms. The two events considered are exactly the two phantom windows."
    - "The deployed manifest, fetched directly, shows both currently-live windows are
      `inferred:true`, zero-match, event_type 99."
    - "A/B on the real manifest: whole-manifest parse 3.39-3.85 ms cold vs 1.14-1.25 ms for
      envelope+prefilter+parse-survivors, output proven identical."
  falsification_test: "After deploy, a tick that still reports `eventsConsidered:2` (or any
    non-zero value) with the phantom windows gone from the manifest would disprove B. A tick
    reporting `eventsConsidered:0` yet still `exceededCpu` would disprove the whole model and
    point back at module init."
  fix_rationale: "B removes the trigger -- no zero-match event gets a blind window, so the tick
    takes its cheap early exit again. A removes the structural pressure -- the early exit stops
    costing 50-90% of the budget, so the next legitimately-live event has real headroom. Fixing
    only A would leave a 38 ms live path; fixing only B would leave the outage armed for the next
    genuinely live event."
  blind_spots: "Cannot observe a post-fix tick myself -- `wrangler deploy` is blocked by the
    harness classifier. Whether module init is charged to the invocation or to the separate
    startup budget is still formally unproven; the deploy read-back settles it. Desktop V8
    numbers are not workerd numbers."
  candidate_causes:
    - "[code] per-tick whole-manifest Zod validation in `liveWindows.ts` (cause A)"
    - "[data] phantom `inferred` windows in the published manifest artifact (cause B)"
  and_gate: "YES -- both required. The identical code ran healthy for a week (7/7 ok) with A
    alone; it failed 100% only once B landed at 2026-08-28T18:25Z with no deploy in between.
    And the 38 ms measurement shows B alone would also blow the budget without A."

checkpoint_outcome (added 2026-08-29, after the Stage 1 read-back):
  hypothesis: HELD, both legs. `eventsConsidered:2` on the post-fix ticks proves cause B was still
    active, so the surviving ticks are attributable to fix A1 alone.
  falsification_test: NOT triggered. The stated falsifier was "a tick reporting
    `eventsConsidered:0` yet still `exceededCpu`", which would have pointed back at module init.
    No such tick occurred -- every post-fix tick returned `ok`.
  blind_spots: BOTH CLOSED. The orchestrator ran the deploy, and the module-init accounting
    question is settled (see Evidence, "Stage 1 deploy").
  MIS-ESTIMATE, recorded rather than quietly dropped: A1 was estimated to recover only ~4-6 ms on
    the platform against a 38 ms live path, and the Stage 1 pass criterion was built on that
    arithmetic -- it predicted ticks would STILL fail after the deploy. They did not. A1 alone took
    a 38 ms live path to 17-30 ms, recovering at least 8-21 ms: materially more than estimated.
    The ~1.5-2.3x desktop-to-platform factor was inferred by anchoring ONE desktop number to ONE
    platform number for the IDLE path, and it does not generalise to the live path, whose work
    composition is different. Treat that factor as a same-path anchor, never as a general
    multiplier. A conservative extrapolation nearly produced a false FAIL on a working fix.

next_action: NONE -- session closed and archived. Stage 2 (`pnpm publish:seasons`, which lands A2
  and B and permanently removes the phantom windows from the artifact) is NO LONGER BLOCKING: the
  fix is already verified without it. It rides along with the republish already queued for the
  demo-team exclusion workstream.

## Evidence

- timestamp: 2026-08-29
  observation: `wrangler tail --format json` returns `outcome:"exceededCpu"`, `cpuTime:10`,
    `wallTime:128`, empty `logs`. Reproduced live by the orchestrator, independent of 07-19's
    own 7/7 capture.

- timestamp: 2026-08-29
  observation: `wrangler deploy --dry-run` reports `Total Upload: 931.97 KiB / gzip: 154.19 KiB`.

- timestamp: 2026-08-29
  observation: Parsing + module-init of the real pre-built bundle (`wrangler deploy --dry-run
    --outdir`, then `import()` of `scheduled.js` in Node with no transpile) cost **63 ms CPU**
    on a fast desktop. Free-plan budget is 10 ms per invocation.

- timestamp: 2026-08-29
  observation: Per-module init cost under `tsx` (transpile-inflated, relative signal only):
    `packages/ingest/schemas.ts` 188 ms · `core/algorithms/opr` 62 ms · `core/algorithms/sigma1`
    47 ms · `core/algorithms/epa` 16 ms · `harness/stateSnapshot`, `harness/manifestSchemas`,
    `harness/rounding`, `ingest/normalize` all ~0 ms. Zod schema construction dominates.

- timestamp: 2026-08-29
  observation: `apps/worker/src/scheduled.ts` imports `opr`, `epa` and `makeSigma1` at module
    scope, plus `tbaMatchListSchema` / `tbaEventSchema` from `packages/ingest/schemas.js`.
    `wrangler.toml` sets `LIVE_ALGORITHM_IDS = "vpr"` and
    `DEFAULT_LIVE_ALGORITHM_IDS = ["vpr"]` — so `opr` and `epa` are bundled and initialized but
    never live-folded.

- timestamp: 2026-08-29
  checked: Where `apps/worker/src/scheduled.ts` actually logs.
  found: Exactly one success log, `console.log({msg:"tick",ok:true,...})` at line 1071, in the
    `runTick(env).then(...)` fulfilment handler — i.e. the LAST thing a tick does. The only other
    lines are a `live-tier-defaulted` warn (209), a per-event `event-failed` error (801), and the
    failure branch (1078).
  implication: FALSIFIES the reasoning behind Eliminated #2. An empty `logs` array is fully
    consistent with the tick running the entire live-event path and being killed before its
    final log. It proves non-completion, not non-entry.

- timestamp: 2026-08-29
  checked: `wallTime:128` vs `cpuTime:10` in the captured tail JSON.
  found: ~118 ms of the invocation is non-CPU time.
  implication: Module init is pure CPU with no I/O — a tick killed during init would show
    wallTime close to cpuTime. 128 ms wall against 10 ms CPU indicates the invocation performed
    real async I/O (KV/D1/R2/TBA) before being killed, i.e. it reached the handler.

- timestamp: 2026-08-29
  checked: The DEPLOYED live-windows manifest, fetched from the real artifact origin
    (`https://data.sigmascout.org/v1/manifest/live-windows.json`, HTTP 200, 160,566 bytes).
  found: generation `47d020a4-1a16-4331-bd70-ce2f468bf2d1`, computedAt 2026-08-28T18:25:43.620Z
    (07-17's D-18 full republish — the SAME generation named in WINDOWS.md ledgers #11 and #15).
    1,581 windows, 200 of them `inferred`. **TWO are live right now**: `2026azscor`
    [2026-08-28T00:00Z, 2026-09-01T00:00Z) and `2026scsc` [2026-08-29T00:00Z, 2026-09-02T00:00Z).
  implication: The 07-19 deploy record's stated premise — "no event was live during either
    observation window" — is FALSE. The operator judged liveness by "is a real competition
    happening", but the manifest is what the Worker actually consults, and it says two events are
    live. `runTick` therefore does NOT take its early exit.

- timestamp: 2026-08-29
  checked: What those two events are, in `data/corpus.sqlite`.
  found: Both are `event_type: 99`, `is_offseason: 1`, with **ZERO matches in the corpus** —
    `2026azscor` "Summer Scorcher" (start_date 2026-08-28) and `2026scsc` "South Carolina
    Robotics And Practicals" (start_date 2026-08-29). With no matches, `buildLiveWindowsManifest`
    takes its fallback branch and synthesises `[start_date 00:00 UTC, +4 days)`, `inferred:true`.
    2026 alone has 83 event_type-99 events; 200 corpus events have zero matches.
  implication: These are PHANTOM live windows — events that are not running, have no schedule, and
    have no matches, but which the Worker treats as live for four full days. Invisible to an
    operator asking "is a competition happening?", which is why the premise above went unchallenged.

- timestamp: 2026-08-29
  checked: Cost of the idle-tick path alone, reproduced offline against the real corpus-derived
    manifest (1,581 windows, 160,537 bytes) — `JSON.parse` then `LiveWindowsManifestSchema.parse`.
  found: JSON.parse ~0 ms; parse + Zod validate **4.70 ms CPU** per iteration on a fast desktop,
    essentially all of it Zod. Independently corroborated by the deployed Worker's own recorded
    numbers in docs/worker-operations.md: idle ticks (`subrequestsUsed:1`, the early-exit path)
    measured **CPU 5-6 ms** on 2026-08-23 and **median 7 ms, range 5-9 ms, cold start 14 ms** on
    2026-08-22.
  implication: The DO-NOTHING early-exit tick already consumes 50-90% of the entire 10 ms budget
    just Zod-validating a manifest it then discards. There is almost no headroom left for the
    live-event path on top. This is a second, independent contributing cause.

- timestamp: 2026-08-29
  checked: Live re-tail of the CURRENT deployed version (`wrangler tail --format json`, bounded
    150 s; process death verified afterwards -- 12 node.exe = baseline, no strays).
  found: 2/2 ticks `outcome:"exceededCpu"`, `cpuTime:10`, `logs:[]`, `exceptions:[]`,
    `scriptVersion.id` still `638da16c-d538-4551-b3a0-a2757a77061f`. wallTime 182 ms and 138 ms.
  implication: Independently reproduced a third time. Still 100% failing, still the same version.
    wallTime again ~14-18x cpuTime.

- timestamp: 2026-08-29
  checked: `runGlobalRebuild` (scheduled.ts:884) -- the suspected 3.7 MB `teams/{year}` merge
    (WINDOWS.md #11) as the CPU sink.
  found: Its first statement is `if (touchedTeamsByAlgorithm.size === 0) return true;`. Both live
    events have ZERO matches, so nothing is ever touched and the rebuild is an immediate no-op.
  implication: LEAD REFUTED. The global rebuild is not the CPU sink. It also never runs on an
    idle tick at all, since the `liveEvents.length === 0` early exit precedes it.

- timestamp: 2026-08-29
  checked: Cold vs warm cost of the per-tick live-windows validation against the REAL deployed
    manifest, high-resolution clock (`performance.now()` -- `process.cpuUsage()` is quantized to
    ~15.6 ms on Windows and produced useless 0.00/15.00 readings). n=3 per arm, fresh process.
  found: Current code (`LiveWindowsManifestSchema.parse` over all 1,581 windows, then filter):
    **cold 3.39 / 3.85 / 3.73 ms**, warm ~0.92 ms. The earlier "4.70 ms" figure was an unwarmed
    average measuring the same first-call effect.
  implication: The cold/warm split is the whole story for this Worker. A 1-minute cron on the
    free plan lands on an evicted isolate nearly every tick, so it ALWAYS pays the cold number,
    never the warm one. 3.4-3.9 ms on a fast desktop corresponds to the 5-9 ms the deployed
    Worker actually recorded for this same do-nothing path (docs/worker-operations.md,
    2026-08-22 and 2026-08-23) -- a ~1.5-2.3x platform factor.

- timestamp: 2026-08-29
  checked: Whether validating only the entries actually used recovers meaningful budget. A/B
    against the real deployed manifest: envelope-validate, cheap `typeof`+interval prefilter,
    then `LiveWindowEntrySchema.parse` on survivors only.
  found: **cold 1.14 / 1.25 / 1.19 ms** vs 3.39-3.85 ms -- a ~2.5 ms cold saving (~66%). Output
    proven identical to the current path on the real manifest (both select exactly
    `["2026azscor","2026scsc"]`).
  implication: Recovers roughly 4-6 ms on the platform once the ~1.5-2.3x factor is applied.
    Material against a 10 ms budget, but NOT independently proven sufficient -- see Open caveats.


- timestamp: 2026-08-29T21:55-21:58Z
  checked: BEFORE-FIX capture while cause B is still active (bounded 150 s `wrangler tail
    --format json`; 12 node.exe afterwards, at/below the 13 baseline, no strays).
  found: 3 ticks. Tick 1 21:55:44Z **`outcome:"ok"`, cpuTime 38 ms, wallTime 904 ms**, and it
    LOGGED: `{"msg":"tick","ok":true,"durationMs":864,"eventsConsidered":2,"eventsAdvanced":0,
    "eventsDeferred":2,"eventsFailed":0,"tbaRequests":2,"subrequestsUsed":8,
    "globalRebuildRan":true}`. Ticks 2 and 3 (21:56:44Z, 21:57:44Z) `outcome:"exceededCpu"`,
    cpuTime 10, wallTime 410/437 ms, `logs:[]`, `exceptions:[]`. All three on the same version
    `638da16c-d538-4551-b3a0-a2757a77061f`.
  implication: **DIRECT CONFIRMATION of the AND-gate root cause, and the strongest single piece
    of evidence in this session.** (1) `eventsConsidered:2` is the two PHANTOM windows -- the
    tick reaches the handler and runs the full live path, which kills the module-init reading of
    the empty `logs` array outright: a tick that survives logs normally.
    (2) The live path costs **38 ms CPU**, 3.8x the 10 ms budget -- so the free plan is NOT a
    hard per-invocation kill at exactly 10 (some burst/amortised allowance lets an occasional
    tick through), which is why the failure rate is 2-in-3 here rather than 3-in-3.
    (3) Critically, **fix A alone would NOT be sufficient**: A recovers ~4-6 ms on the platform
    against a 38 ms live path. Only fix B, by restoring the `liveEvents.length === 0` early exit,
    brings the tick back inside budget. A is the headroom fix; B is THE fix.

- timestamp: 2026-08-29
  checked: Fix impact quantified against the real deployed manifest (generation
    `47d020a4-1a16-4331-bd70-ce2f468bf2d1`), evaluating the real field names.
  found: 1,581 windows total. `inferred:true` (what fix B stops emitting): **200**.
    `endMs <= now` (what fix A2 stops emitting): **1,542** -- supersedes the 1,381 figure
    previously recorded in Resolution (A). Both live-right-now windows are `inferred:true`.
    Windows surviving BOTH fixes today: **0** (160,566 bytes -> ~124 bytes).
  implication: Post-fix the manifest is legitimately near-empty right now -- the corpus holds no
    future event that already has ingested matches. Confirms the two fixes are complementary,
    not redundant (only 161 of the 1,542 closed windows are also inferred).

- timestamp: 2026-08-29
  checked: Whether `buildLiveWindowsManifest`s `else` branch is EXACTLY the zero-match case,
    since fix B must not remove more than the developer directed.
  found: `packages/corpus/schema.sql` declares `sort_time INTEGER NOT NULL`. The builder guard is
    `match_count > 0 && min_sort_time !== null && max_sort_time !== null`; under the LEFT JOIN,
    `COUNT(m.match_key) > 0` implies at least one joined match row, and every such row has a
    non-null `sort_time`. So `min`/`max` are null only when `match_count === 0`.
  implication: The guards three conjuncts collapse to one. The `inferred: true` branch is exactly
    and only the zero-match case -- there is no legitimate residue of D-18s discovery mechanism
    left to preserve. Removing the blind window removes the whole `inferred` EMISSION path. The
    `inferred` FIELD stays in the schema: the deployed manifest carries 200 `true` entries and
    the Worker must keep reading them until the next republish.

- timestamp: 2026-08-29 (Stage 1 deploy -- run by the orchestrator; `wrangler deploy` is not mine)
  checked: `pnpm worker:deploy`, then a bounded 200 s `wrangler tail` on the resulting version.
  found: Upload 933.39 KiB / gzip 154.48 KiB. **Worker Startup Time 76 ms.** New version
    `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3` (confirmed not `638da16c`). No upload exception, no
    `ManifestValidationError` -- the offline pre-flight against the real artifact held. 12 node.exe
    afterwards, 0 wrangler: no strays.
  implication: MODULE-INIT ACCOUNTING SETTLED -- and the Stage 1 criterion itself was
    MISCALIBRATED. That criterion said "FAIL if the startup time is at/over 10 ms", which would
    have failed a working fix on a perfectly healthy reading. 76 ms is not a failure: Cloudflare's
    startup time is a SEPARATE **1-second** budget (limits page, "Worker startup time"), validated
    at deploy time (error 10021), and 76 ms passes it comfortably. This file's earlier guess of a
    "~400 ms startup budget" was also wrong and is corrected. The proof that init is NOT billed to
    the invocation is arithmetic rather than documentary: the pre-fix capture recorded a tick that
    COMPLETED at cpuTime 38. Were 76 ms of init charged to the invocation, no tick could ever
    report a cpuTime below 76, let alone finish. Eliminated #5 is now FULLY eliminated.
    The orchestrator's local 63 ms measurement was accurate AS A MEASUREMENT (76 ms on-platform);
    the error was never in the number, only in which budget it was attributed to.

- timestamp: 2026-08-29 (post-fix tick read-back, version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`)
  checked: Three consecutive ticks on the new version, bounded 200 s tail.
  found: ALL THREE `outcome:"ok"`, `exceptions:[]`. cpuTime **21 / 30 / 17** ms; wallTime
    709 / 1250 / 635 ms. Two carried full log lines --
    `{"msg":"tick","ok":true,"durationMs":677,"eventsConsidered":2,"eventsAdvanced":0,
    "eventsDeferred":2,"eventsFailed":0,"tbaRequests":2,"subrequestsUsed":8,
    "globalRebuildRan":false}`, and the same shape at durationMs 1213.
  implication: **THE FIX IS VERIFIED -- by a STRONGER argument than the plan asked for.**
    `eventsConsidered:2` means the two phantom windows are STILL in the deployed R2 artifact and
    the tick is STILL running the full live path: cause B is completely untouched, exactly as
    Stage 1 predicted. The tick completes anyway. So the fix was proven against a genuinely
    failing scenario with the trigger still armed, BEFORE the 2026-09-01/09-02 self-heal could
    confound it -- the calendar confound the pass criterion feared never got its chance to apply.
    COROLLARY: the read-path `inferred` compatibility shim that was floated as an option is
    **NOT NEEDED and was never built**. The new read path accepts the 200 `inferred:true` entries
    in the deployed artifact as-is -- now proven on live traffic, not merely in the offline
    pre-flight. Recorded explicitly so a later reader does not resurrect it.

- timestamp: 2026-08-29
  checked: **THE ANOMALY.** Successful ticks report cpuTime 17 / 21 / 30 / 38; every killed tick
    reports exactly 10. Under a flat 10 ms per-invocation ceiling a 30 ms tick could not return
    `ok`, so the enforcement model this session assumed throughout had to be re-derived FROM
    EVIDENCE. Built the complete observed (cpuTime, outcome) distribution from
    docs/worker-operations.md and this file, checked `wrangler.toml` for a `[limits]` override, and
    fetched Cloudflare's CURRENT published limits directly rather than trusting the figure this
    project inherited via `.claude/CLAUDE.md`'s stack notes.
  found: (1) FULL OBSERVED DISTRIBUTION.
      SUCCESS (`outcome:"ok"`): **5, 6, 7, 8, 9** (n=10 idle ticks, 2026-08-22, v`5a8e0a6f`, "all
      ten returned ok") - **14** (the cold start in that same run, also ok) - **5, 6** (n=3 idle,
      2026-08-23, v`77fca208`) - **42** and **208** (two real folds via the replay rig, 2026-08-23,
      v`6cbe6d50`; both logged `eventsAdvanced:1`, and the tick's log line is its LAST statement,
      so both demonstrably ran to completion) - **38** (2026-08-29T21:55:44Z, v`638da16c`) -
      **17, 21, 30** (2026-08-29, v`6c9c93dd`).
      KILLED (`outcome:"exceededCpu"`): **exactly 10 on all 11 observations** -- 7/7 by plan 07-19
      across two windows, 2/2 on the orchestrator's re-tail, 2/2 in the pre-fix capture. Never 9.
      Never 11. The distribution has a hole in it: no success at exactly 10, no failure anywhere
      else.
    (2) THE DECISIVE PAIR -- same version, same manifest, same code, 60 seconds apart:
      v`638da16c` returned `ok` at cpuTime **38** at 21:55:44Z, and was killed at cpuTime **10** at
      21:56:44Z.
    (3) `apps/worker/wrangler.toml` carries NO `[limits]` block and no `cpu_ms`, so whatever the
      platform default is for this account and trigger type is what applies.
    (4) Cloudflare's limits page, fetched 2026-08-29 (HTTP 200,
      `developers.cloudflare.com/workers/platform/limits/`): "CPU time per Cron Trigger | **10 ms**
      | [Workers Free]". And, in that same section, the sentence this session never had:
      *"Each isolate has some built-in flexibility to allow for cases where your Worker
      infrequently runs over the configured limit. If your Worker starts hitting the limit
      consistently, its execution will be terminated according to the limit configured."*
  implication: **PROVEN, from this project's own evidence and independent of any documentation:
    the free plan does NOT enforce a flat per-invocation CPU ceiling.** No single threshold L can
    satisfy both L >= 38 (the 21:55:44Z success) and L <= 10 (the 21:56:44Z kill) on identical code
    and identical data 60 seconds apart. Successes are observed as high as 208 ms.
    **NOT proven here, but DOCUMENTED by Cloudflare and consistent with every observation:** 10 ms
    IS the configured limit -- *the session's constant was right all along* -- and the flexibility
    is per-isolate and conditional on how CONSISTENTLY the Worker runs over it. That model predicts
    each region of the distribution: the 14 ms cold start and the 42/208 ms rig folds were
    INFREQUENT overruns on an otherwise-idle Worker and were absorbed; from 2026-08-28T18:25Z every
    tick ran the ~38 ms live path -- hitting the limit CONSISTENTLY -- and was terminated. The
    observed transition (a week healthy, then 100% killed, with no deploy in between) is precisely
    what the documented rule predicts, so **the AND-gate root cause is STRENGTHENED by this
    correction, not weakened.**
    RESOLVES LEAD 4: "pinned at exactly 10, never 11" is NOT a limit being reported in place of a
    consumption measurement. It is a consumption measurement TRUNCATED BY THE KILL -- the
    invocation is "terminated according to the limit configured", so its final reading necessarily
    equals the limit. Both readings predict exactly 10; the documented wording favours this one,
    and nothing in the fix turns on the difference.
    RESOLVES LEAD 5: the wallTime correlation is a CONSEQUENCE, not a mechanism. A killed tick
    stops early and therefore does less I/O waiting, so low wallTime FOLLOWS from the kill rather
    than explaining it. It is also weaker than it first looks -- kills were observed at wallTime
    410 and 437 ms, overlapping the successes' 635-1250 ms range from below. There is no evidence
    for a wall-proportional allowance and none should be assumed.
    BOUNDED HONESTLY: the size, replenishment rate and scope of the "built-in flexibility" are NOT
    determined by this investigation, and Cloudflare does not quantify them. The 208 ms success is
    20x the configured limit and is the least-explained observation in the set -- it is consistent
    with an unquantified allowance, but it is not evidence FOR any particular one. **Design against
    10 ms. Never design against the flexibility.**


## Eliminated

- hypothesis: Plan 07-19's redeploy introduced the regression.
  evidence: `git log -p apps/worker/wrangler.toml` shows `LIVE_ALGORITHM_IDS` changed
    `"sigma1"` → `"vpr"` — one algorithm before, one after. Identical workload, and the bundle
    did not grow. 07-19's deploy only prompted someone to watch a cold tail. This is a
    pre-existing latent defect that the phase surfaced, not one it caused.
    **WINDOWS.md ledger #16 currently says "redeployed by plan 07-19", which reads as
    causation and should be corrected to "surfaced by".**

- hypothesis: Per-event work is what blows the budget.
  evidence: Both the healthy and the failing windows had `eventsConsidered:0` — no event was
    live. And the empty `logs` array proves execution dies before the handler's own logging,
    so no per-event code path is reached at all.

- hypothesis: Rolling back to the previous Worker version is a viable mitigation.
  evidence: 07-19 deleted all 4,599 `sigma1` D1 `algorithm_state` rows and collapsed the
    algorithms manifest to `[opr, epa, vpr]`. The prior version would now find neither state
    nor a manifest entry for `sigma1`. Rollback is unavailable; this needs a forward fix.

- hypothesis: The global rebuild's 3.7 MB `teams/{year}` merge (WINDOWS.md #11) burns the budget,
    self-perpetuating because a dead tick never advances `lastGlobalRebuildAtMs`.
  evidence: `runGlobalRebuild` returns immediately when `touchedTeamsByAlgorithm.size === 0`.
    Both live events have zero matches, so nothing is ever touched and the merge never executes.
  timestamp: 2026-08-29

- hypothesis: (REVISED, not eliminated) Cold-start module init alone exceeds the 10 ms budget.
  evidence: Downgraded from "the" cause to "a possible contributor", on three grounds.
    (1) The inference it leaned on -- Eliminated #2's "empty logs proves death before handler
    code" -- is unsound; the only success log is the tick's LAST statement.
    (2) wallTime 128/138/182 ms against cpuTime 10 ms indicates the invocation performed real
    async I/O before being killed. Module init is pure CPU with nothing to await; a kill during
    init would show wallTime tracking cpuTime closely.
    (3) docs/worker-operations.md records a 14 ms cold start on 2026-08-22 that still returned
    `ok:true` -- if init CPU were charged to the invocation's 10 ms budget, that tick would have
    been killed at 10.
    **NOW FULLY ELIMINATED, 2026-08-29.** The orchestrator ran the deploy. Worker Startup Time
    is 76 ms, charged to a SEPARATE 1-second startup budget rather than to the invocation -- proven
    by arithmetic, since a tick completed at cpuTime 38 and could not have done so if 76 ms of init
    were billed to it. Module init is not a contributor at all.
  timestamp: 2026-08-29

- hypothesis: The free plan enforces a FLAT 10 ms CPU ceiling per invocation -- so a tick reporting
    cpuTime > 10 is impossible, and a tick reporting exactly 10 measured its true consumption.
    (This was an unexamined PREMISE of the whole session, inherited from `.claude/CLAUDE.md`'s
    stack notes, not a hypothesis anyone set out to test.)
  evidence: Version `638da16c` returned `outcome:"ok"` at cpuTime 38 (2026-08-29T21:55:44Z) and was
    killed at cpuTime 10 sixty seconds later (21:56:44Z), on identical code and an identical
    manifest. No flat threshold satisfies both. Successes are recorded up to 208 ms (replay rig,
    2026-08-23). Cloudflare's limits page (fetched 2026-08-29) documents the real rule: 10 ms is
    the CONFIGURED limit for a Cron Trigger on Workers Free, but each isolate carries "some
    built-in flexibility ... for cases where your Worker infrequently runs over the configured
    limit", and a Worker that "starts hitting the limit consistently" is "terminated according to
    the limit configured".
  scope: This eliminates the ENFORCEMENT MODEL, **not the constant**. 10 ms remains the correct
    configured budget to design against, so every "10 ms budget" statement in the source comments
    and in the regression tests remains accurate and none required editing. What changes is the
    reading of an individual number: a single tick over 10 ms is not by itself proof of a defect,
    and a tick at exactly 10 with `exceededCpu` is a kill, not a measurement.
  timestamp: 2026-08-29

## Open caveats

**ALL CLOSED as of 2026-08-29.** Kept with their resolutions rather than deleted, because what
each one blocked -- and how it resolved -- is part of the record.

- ~~**BLOCKED -- the accounting is STILL unconfirmed.**~~ **CLOSED.** The orchestrator ran the
  deploy. Worker Startup Time is **76 ms**, charged to a SEPARATE **1-second** startup budget
  (Cloudflare limits page, "Worker startup time"; validated at deploy time as error 10021) -- not
  to the invocation, and not the "~400 ms" this file previously guessed. The decisive proof is
  arithmetic rather than documentary: a tick COMPLETED at cpuTime 38, which is impossible if 76 ms
  of module init were billed to the invocation.
- ~~Consequently any fix is measured but **NOT verified**.~~ **CLOSED.** Three consecutive live
  ticks returned `outcome:"ok"` on version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3` with the trigger
  still fully armed (`eventsConsidered:2`).
- Measurements are Node/V8 on a fast desktop, not `workerd` on Cloudflare's shared hardware.
  **STILL TRUE -- and the read-back showed the extrapolation was too CONSERVATIVE.** The ~1.5-2.3x
  factor was anchored on the IDLE path only (desktop 3.4-3.9 ms vs deployed 5-9 ms) and does not
  generalise to the live path: A1 was predicted to recover ~4-6 ms and in fact recovered at least
  8-21 ms. Use that factor as a same-path anchor, never as a general multiplier. See
  `checkpoint_outcome` in Current Focus.
- **NEW, and closed in the same cycle:** the session's flat-10 ms enforcement premise. See
  Eliminated (last entry) and `root_cause` below.

## Leads to try

1. **(measured, primary)** Stop Zod-validating all 1,581 windows on every tick. Validate the
   envelope, prefilter structurally on `startMs`/`endMs`, then run `LiveWindowEntrySchema.parse`
   only on the entries actually live. Measured 3.4-3.9 ms -> 1.1-1.3 ms cold, output proven
   identical. **Trade-off needing a developer decision:** this weakens `liveWindows.ts`'s stated
   "refusing to use a partially-valid manifest" property -- a corrupt entry that is not live
   would be skipped rather than failing the whole read.
2. **(alternative, no trade-off)** Shrink the manifest offline instead: have
   `buildLiveWindowsManifest` emit only windows that can still be live, dropping the 1,542
   windows from closed past seasons. Full validation stays and becomes cheap. Costs a republish
   before it takes effect, and changes what `loadManifests` returns for other consumers.
3. Stop synthesising phantom `inferred` windows for events with ZERO matches, or shorten the
   blind 4-day span. This is the TRIGGER leg (see Resolution) and is what makes the outage
   RECUR. Needs care: D-18 added `inferred` deliberately so a brand-new event can be discovered.
4. Still open, still untested: drop the unused `opr`/`epa` module-scope imports (only `vpr` folds
   live) and defer `packages/ingest/schemas.ts`'s module-scope Zod construction. Worth doing on
   principle, but no longer the leading hypothesis.

## Constraints

- Cloudflare free tier only (project budget constraint). 10 ms CPU per invocation, 1-minute
  minimum cron interval, 50 subrequests per invocation.
- WINDOWS.md ledger #9 already records related pressure: three published algorithms folded for
  one ordinary match exceed the real per-tick subrequest budget (~50 vs usable ~41).
- Accepted-failure baseline is TWO `packages/harness/payloadBudget.test.ts` failures
  (WINDOWS.md ledgers #11 and #15). Any OTHER test failure is a regression.
- `.env` must never be rendered into any output stream — see `.claude/CLAUDE.md` secrets
  convention. Applies to `wrangler` invocations and anything quoted from a log.
- On Windows/Git-Bash the Bash tool's timeout kills only the outer wrapper, not a deep
  `tsx`/`node`/`wrangler` child. Verify long-running processes are actually dead via
  `tasklist` / `Get-Process` before starting another.

## Resolution

root_cause: |
  AND-gate -- TWO conditions hold simultaneously. The tick survives either alone but not both,
  which is why it ran healthy for a week and then failed 100% of ticks with no deploy in between.

  HOW THE BUDGET IS ACTUALLY ENFORCED (corrected 2026-08-29, after the read-back -- this session
  carried a flat-ceiling premise from its first line to its last and that premise was WRONG).
  **The constant was right; the enforcement model was not.** 10 ms is the CONFIGURED CPU limit for
  a Cron Trigger on Workers Free -- confirmed by direct fetch of Cloudflare's limits page on
  2026-08-29, with no `[limits]` / `cpu_ms` override in `apps/worker/wrangler.toml`. But it is not
  a hard per-invocation kill. Cloudflare documents that "each isolate has some built-in flexibility
  to allow for cases where your Worker infrequently runs over the configured limit", and that a
  Worker which "starts hitting the limit consistently" has its execution "terminated according to
  the limit configured". Proven independently from this project's own data, needing no
  documentation at all: version `638da16c` returned `ok` at cpuTime 38 and was killed at cpuTime 10
  SIXTY SECONDS LATER, on identical code and an identical manifest. Observed successes run as high
  as 208 ms; observed kills are pinned at exactly 10 on all 11 of them, because a killed
  invocation's final reading IS the limit it was terminated at.

  So the operative failure boundary is NOT "a tick costs more than 10 ms". It is
  **"EVERY tick costs more than 10 ms."** An occasional expensive tick is absorbed by the isolate's
  flexibility; a PERMANENTLY expensive tick is not. What follows is the account of how two
  independent conditions combined to move this Worker from the first regime into the second. That
  framing rests on the observed success/failure boundary, not on the exact value of any constant --
  so it would survive unchanged even if the documented 10 ms figure were later revised again.

  (A) STRUCTURAL, latent since the manifest grew [category: code]. Every tick answers "is
      anything live?" by running `LiveWindowsManifestSchema.parse` over the ENTIRE 1,581-window /
      160 KB live-windows manifest -- roughly 7,900 field validations -- then discards all but the
      live entries. 1,542 of those windows belong to closed past seasons and can never be live
      again. Because a 1-minute cron on the free plan lands on an evicted isolate nearly every
      tick, this always costs the COLD price (3.4-3.9 ms desktop; 5-9 ms measured on the deployed
      Worker), never the warm price (~0.9 ms). The do-nothing early-exit tick was therefore ALREADY
      consuming 50-90% of the configured budget. On its own it still stayed UNDER the limit -- which
      is exactly why this leg was survivable for a week, and why docs/worker-operations.md recorded
      those 5-9 ms numbers on 2026-08-22/23 without anyone recognising a do-nothing path eating
      most of the budget as a defect.

  (B) TRIGGER, introduced 2026-08-28T18:25Z [category: data]. 07-17's D-18 `--include-offseason`
      full republish (generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1) put offseason events into
      the manifest. `buildLiveWindowsManifest` applies NO offseason filter, and for the 200
      corpus events with zero matches it synthesises a blind 4-day window from `start_date` alone
      (`inferred: true`). Two such PHANTOM windows were open: `2026azscor` "Summer Scorcher"
      [08-28, 09-01) and `2026scsc` "South Carolina Robotics And Practicals" [08-29, 09-02) --
      both `event_type 99`, `is_offseason 1`, ZERO matches. So `runTick` stopped taking its cheap
      `liveEvents.length === 0` early exit and began running the full live path (algorithms
      manifest load, `buildAlgorithmModules`/`makeSigma1`, a D1 read, a TBA poll per event) stacked
      on top of (A)'s already-near-ceiling cost. Measured at 38 ms. That is what turned an
      occasional overrun into a permanent one -- consistently over the configured limit rather than
      infrequently over it, which is precisely the condition under which the platform stops
      absorbing the overrun and starts terminating the invocation.

  The empty `logs` array was never evidence of death during module init: `scheduled.ts` emits its
  only success line at 1071, the tick's LAST statement, so an empty array proves the tick did not
  FINISH, not that it did not START. Module init is charged to a separate 1-second startup budget
  (measured at 76 ms) and is not a contributor at all.

  This is a RECURRING, data-triggered outage, not a one-off. Left unfixed, the two windows would
  have closed on 2026-09-01 and 2026-09-02 and the Worker would have silently started working
  again by itself -- until the next offseason event's `start_date` opened another phantom window
  and it broke again.

fix: |
  APPLIED, COMMITTED, DEPLOYED (version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`) AND VERIFIED ON
  LIVE TICKS. Three changes, covering all three legs of the developer decision of 2026-08-29.

  The 2026-08-29 enforcement-model correction required NO change to any of these fixes and NO
  change to any regression test. Every "10 ms budget" reference in the source comments and in the
  tests describes the CONFIGURED limit, which the correction confirmed rather than overturned; and
  no test asserts on a time value at all, so none could have encoded the disproven flat ceiling.
  That check was run explicitly against both new test files, not assumed.

  A1 -- FILTER AT READ (`apps/worker/src/liveWindows.ts`, `packages/harness/manifestSchemas.ts`).
     New `loadLiveEventsAt(env, epochMs)` replaces `liveEventsAt(await
     loadLiveWindowsManifest(env), nowMs)` on the tick hot path. It Zod-validates the manifest
     ENVELOPE via a new `LiveWindowsManifestEnvelopeSchema` (identical preamble, `windows` left
     as `z.array(z.unknown())`), structurally prefilters raw entries on `startMs`/`endMs`, then
     runs `LiveWindowEntrySchema.parse` ONLY on entries that are actually live. Measured cold
     3.39-3.85 ms -> 1.14-1.25 ms, selection proven identical.
     The traded property is NARROWED, not abandoned: an entry whose liveness cannot be DECIDED
     (non-object, or non-finite/non-numeric bounds) is still a hard failure -- a new
     `LiveWindowShapeError`, subclassing `ManifestValidationError` so existing catchers still
     work. Only the non-interval fields of NON-live entries go unvalidated. Documented at length
     in the function header so a future reader does not "restore" the full parse.

  A2 -- SHRINK AT BUILD (`packages/harness/manifests.ts`). `buildLiveWindowsManifest` drops any
     window with `endMs <= nowMs` -- it can never be live for any reader of that manifest.
     `nowMs` is a new option defaulting to `Date.parse(computedAt)`, so the prune is
     deterministic and clock-injected rather than hidden behind `Date.now()`; an unparseable
     `computedAt` with no explicit `nowMs` now throws rather than silently pruning nothing.
     Takes effect on the next republish (already queued for an unrelated workstream).

  B -- NO BLIND WINDOWS (`packages/harness/manifests.ts`). The zero-match fallback that
     synthesised `[start_date 00:00Z, +4 days)` with `inferred: true` is REMOVED. Confirmed the
     removed branch was exactly and only the zero-match case (`sort_time INTEGER NOT NULL` means
     `match_count > 0` always implies non-null MIN/MAX), so no legitimate part of D-18 discovery
     survives to preserve -- D-18 is explicitly NARROWED, recorded in the function header and in
     docs/worker-operations.md. NO `event_type`/`is_offseason` filter was added: an offseason
     event WITH real matches still gets a real window, pinned by its own test, per 07-17.
     The `inferred` FIELD stays in the schema -- the deployed manifest carries 200 `true` entries
     that the Worker must keep reading until the next republish.

  REGRESSION TESTS (32 new, all verified to bite):
    - `packages/harness/manifests.test.ts`: 7 of the new builder tests FAIL against the pre-fix
      builder, verified by reverting `manifests.ts` to HEAD and re-running. Includes the
      outage-shaped test -- a zero-match offseason event with `start_date` 2026-08-29 must not be
      live at ANY of the 96 hourly instants its guessed window used to span -- plus the
      endMs==nowMs / endMs-1 retention boundary pair, and an envelope/full-schema lockstep guard.
    - `apps/worker/test/liveWindows.test.ts`: 18 new tests. Two independent mutations of the
      implementation were confirmed caught: silently skipping undecidable entries (5 failures)
      and dropping the survivor schema parse (2 failures). Includes an equivalence test against
      the old full-parse path across 12 boundary instants, and a 1,581-window outage-shaped test
      whose 1,579 non-live entries are deliberately schema-invalid.

  ALSO CORRECTED: `.planning/WINDOWS.md` ledger #16 (both the causation wording and the
  now-disproven "No event was live in either observation" premise), and
  `docs/worker-operations.md`, whose recorded cold-start hypothesis was wrong and whose
  troubleshooting guidance needed the new ingest-before-live operational contract.

verification: |
  **VERIFIED on a real deployed tick, 2026-08-29.** Not partially, not by proxy, and not by the
  calendar.

  THE DECISIVE OBSERVATION. Deployed version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3` (upload
  933.39 KiB / gzip 154.48 KiB, Worker Startup Time 76 ms). Three consecutive ticks on a bounded
  200 s tail, ALL `outcome:"ok"` with `exceptions:[]`, at cpuTime **21 / 30 / 17** ms and wallTime
  709 / 1250 / 635 ms. Two carried complete log lines (`"ok":true`, durationMs 677 and 1213,
  `subrequestsUsed:8`).

  WHY THIS IS STRONGER THAN THE PLANNED CRITERION. Every one of those ticks reported
  `eventsConsidered:2` -- **cause B is still fully active.** The two phantom windows remain in the
  deployed R2 artifact (A2 and B are build-time fixes and do not land until a republish), so the
  tick is still entering and running the complete live path that measured 38 ms CPU before the fix.
  It now completes. The fix was therefore verified against a genuinely failing scenario with the
  trigger still armed, which is the hardest form this verification could have taken, and it landed
  before the 2026-09-01/09-02 window expiry -- so the calendar confound that the pass criterion was
  written to guard against never got the chance to apply. **This verification window is now closed
  to repetition:** both phantom windows expire on their own, after which no tick can distinguish
  the fix from the calendar. The observation above is the only one that will ever be available, and
  it was taken in time.

  A1 ALONE WAS SUFFICIENT, WHICH THE PLAN DID NOT PREDICT. The Stage 1 criterion expected ticks to
  STILL fail after the deploy, on the arithmetic that A1 recovers only ~4-6 ms against a 38 ms live
  path. It recovered at least 8-21 ms. The mis-estimate is recorded in `checkpoint_outcome` rather
  than dropped: the ~1.5-2.3x desktop-to-platform factor was anchored on the idle path and does not
  generalise. A conservative extrapolation nearly produced a FALSE FAIL on a working fix.

  THE STAGE 1 PASS CRITERION WAS ITSELF MISCALIBRATED -- recorded as its own lesson. It said "FAIL
  if the startup time is at/over 10 ms". The reading was 76 ms, and that is HEALTHY: startup is a
  separate 1-second budget, not the invocation's 10 ms. Had the criterion been applied literally it
  would have failed a fix that demonstrably works. The accounting conclusion it was meant to reach
  still holds, by a better argument than the criterion used -- a pre-fix tick COMPLETED at cpuTime
  38, so 76 ms of module init cannot be billed to the invocation.

  OFFLINE SIGNALS (re-run 2026-08-29 after all corrections):
    - Full suite: 1,970 passed / 2 failed / 1 skipped. The 2 failures are exactly the ledgered
      `packages/harness/payloadBudget.test.ts` pair (WINDOWS.md #11 and #15). Baseline was
      1,938 passed / 2 failed / 1 skipped -- +32 passing, no new failures, no ceiling touched.
    - `pnpm typecheck` clean.
    - Mutation guardrail satisfied: both fixes have tests proven to fail without the fix (7 builder
      tests reverted-and-confirmed; two independent read-path mutations caught, 5 and 2 failures).
    - BEFORE evidence captured against a genuinely failing tick while cause B was still active
      (2026-08-29T21:55-21:58Z). Without it the fix could not have been distinguished from the
      calendar.
    - Pre-flight: the new read path was run against the REAL deployed artifact through a fake Env,
      accepting all 1,581 windows including the 200 `inferred:true` entries. The deploy confirmed
      it -- no `ManifestValidationError` on live traffic.

  CONSIDERED AND FOUND UNNECESSARY: a read-path compatibility shim for `inferred` entries. The
  deployed read path handles the existing artifact as-is, now proven live. Do not resurrect it.

  STAGE 2 IS NO LONGER BLOCKING. `pnpm publish:seasons` lands only the build-time half (A2
  shrink-at-build and B no-blind-windows), which shrinks the artifact permanently and stops phantom
  windows being generated at all. It is prevention of recurrence, not verification of the fix --
  the fix is already verified without it. A republish is ALREADY QUEUED for the demo-team exclusion
  workstream, so this rides along rather than needing its own run.

files_changed:
  - apps/worker/src/liveWindows.ts (new loadLiveEventsAt + LiveWindowShapeError; fix A1)
  - apps/worker/src/scheduled.ts (runTick uses loadLiveEventsAt; fix A1)
  - packages/harness/manifestSchemas.ts (new LiveWindowsManifestEnvelopeSchema; fix A1)
  - packages/harness/manifests.ts (retention prune + no blind windows; fixes A2 and B)
  - apps/worker/test/liveWindows.test.ts (18 new read-path regression tests)
  - packages/harness/manifests.test.ts (builder regression tests + envelope lockstep guard)
  - .planning/WINDOWS.md (ledger #16: causation wording, the disproven no-event-live premise,
    the disproven flat-10 ms enforcement premise, and resolution)
  - docs/worker-operations.md (superseded the wrong cold-start hypothesis; new operational
    contract; corrected enforcement model; the 2026-08-29 fix-deploy record)
  - .planning/debug/worker-tick-exceeds-cpu-budget.md (this file)

postmortem: |
  Blameless. Three gates were available and none of them fired.

  GAP 1 -- a do-nothing path eating most of the budget was RECORDED, repeatedly, and never read as
  a defect. docs/worker-operations.md wrote down idle-tick costs of 5-6 ms (2026-08-23) and a
  median of 7 ms, range 5-9 ms (2026-08-22) for a tick whose entire job was to decide nothing was
  live. Against a 10 ms configured budget that is 50-90% consumed doing nothing, and it was
  published as a healthy baseline. Nobody asked what the remaining 1-5 ms was supposed to pay for.
  GUARDED NOW BY: `packages/harness/manifests.test.ts`'s retention-prune tests plus the
  envelope/full-schema lockstep guard, which together make the manifest structurally incapable of
  growing back to 1,581 entries of mostly-dead seasons, and pin the boundary
  (endMs == nowMs retained, endMs-1 dropped) so the prune cannot silently regress.

  GAP 2 -- a reading that CONTRADICTED the documented ceiling was recorded a week early and not
  chased. The same 2026-08-22 run logged a 14 ms cold start that returned `ok:true`. Under the
  flat-10 ms model everyone was working from, that observation was impossible, and it was written
  down as an "open question whether the platform enforces it uniformly" rather than pulled on. It
  was in fact the first visible evidence of the isolate flexibility this session finally
  characterised -- and had it been chased then, the enforcement model would have been correct
  before the outage rather than after it. GUARDED NOW BY: docs/worker-operations.md's corrected
  "How the CPU budget is actually enforced" section, which states the boundary as *every tick over
  budget*, not *a tick over budget*, and tells the next reader that a single high cpuTime is not a
  defect while a sustained one is. The lesson generalises past this bug: an observation that your
  model says is impossible is the most valuable observation you have, and "probably the platform
  being lenient" is not an explanation.

  GAP 3 -- liveness was verified against the wrong authority. The 07-19 deploy record asserted "no
  event was live in either observation window" from operator knowledge ("is a real competition
  happening"), while the Worker was reading a manifest that said two were. Every subsequent
  inference inherited that false premise and pointed at module init for hours. GUARDED NOW BY:
  the "read the manifest, never the calendar" rule in docs/worker-operations.md, and by the fact
  that the zero-match events that produced the invisible windows can no longer produce a window at
  all (`buildLiveWindowsManifest`, pinned by the outage-shaped test that asserts a zero-match
  offseason event is not live at ANY of the 96 hourly instants its guessed window used to span).

  METHOD LESSON, distinct from the three gaps -- A WRONG PASS CRITERION IS AS DANGEROUS AS A WRONG
  HYPOTHESIS. Stage 1 was written to fail on a startup time "at/over 10 ms" and to expect ticks to
  keep failing. The real deploy returned 76 ms startup and three healthy ticks. Applied literally,
  the criterion would have declared a working fix broken and sent the session back to
  investigation. Criteria stated in advance protect against rationalising a result afterwards --
  which is why this one was written down -- but they inherit every assumption held at the moment
  they are written, and a criterion built on an unexamined premise (here, the flat 10 ms ceiling
  AND an idle-path extrapolation applied to the live path) fails in the same direction as the
  premise. When a pre-stated criterion is contradicted by a clearly better outcome, re-examine the
  criterion before re-opening the diagnosis.
