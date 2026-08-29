---
slug: worker-tick-exceeds-cpu-budget
status: awaiting_human_verify
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

status: root cause CONFIRMED and re-verified. All three developer-directed fixes implemented,
  regression-tested and committed. Awaiting the deploy read-back the orchestrator must run.

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

next_action: DEPLOY READ-BACK. The orchestrator runs `pnpm worker:deploy` then a bounded
  `wrangler tail`, and reports back (a) the reported Worker Startup Time and (b) the post-fix
  tick `outcome` and `cpuTime`. NOTE the two-stage criterion in Resolution.verification: ticks are
  EXPECTED to still fail after the deploy alone, because A2 and B do not take effect until the
  live-windows manifest is republished. Full verification requires that republish, and must land
  before 2026-09-01 or the calendar confounds it.

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
    NOT fully eliminated: the confirming `wrangler deploy` "Worker Startup Time" reading was
    BLOCKED by the harness permission classifier and remains unrun. See Open caveats.
  timestamp: 2026-08-29

## Open caveats

- **BLOCKED -- the accounting is STILL unconfirmed.** `wrangler deploy` (which prints "Worker
  Startup Time") and `wrangler d1 execute --remote` (which would read the `__scheduler_meta__`
  cursor row) were both refused by the harness permission classifier. Only read-only
  `wrangler whoami`, `wrangler deploy --dry-run` and `wrangler tail` were permitted, and
  `--dry-run` does NOT report startup time -- that number is produced server-side on a real
  upload. So whether module init is charged to the invocation's 10 ms or to Cloudflare's separate
  ~400 ms startup budget remains UNPROVEN, exactly as it was at the start of this session.
- Consequently any fix is measured but **NOT verified**: no fix-acceptance signal can be
  satisfied without a deploy plus a `wrangler tail` read-back showing `ok:true`.
- Measurements are Node/V8 on a fast desktop, not `workerd` on Cloudflare's shared hardware. The
  ~1.5-2.3x platform factor is inferred by anchoring the desktop cold number (3.4-3.9 ms) to the
  deployed Worker's own recorded number for the identical path (5-9 ms), not directly measured.

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

  (A) STRUCTURAL, latent since the manifest grew [category: code]. Every tick answers "is
      anything live?" by running `LiveWindowsManifestSchema.parse` over the ENTIRE 1,581-window /
      160 KB live-windows manifest -- roughly 7,900 field validations -- then discards all but
      the live entries. 1,542 of those windows belong to closed past seasons and can never be
      live again. Because a 1-minute cron on the free plan lands on an evicted isolate nearly
      every tick, this always costs the COLD price (3.4-3.9 ms desktop; 5-9 ms measured on the
      deployed Worker), never the warm price (~0.9 ms). The do-nothing early-exit tick was
      therefore ALREADY consuming 50-90% of the entire 10 ms budget.
      docs/worker-operations.md recorded those 5-9 ms numbers on 2026-08-22/23 without
      recognising them as a defect.

  (B) TRIGGER, introduced 2026-08-28T18:25Z [category: data]. 07-17's D-18 `--include-offseason`
      full republish (generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1) put offseason events into
      the manifest. `buildLiveWindowsManifest` applies NO offseason filter, and for the 200
      corpus events with zero matches it synthesises a blind 4-day window from `start_date` alone
      (`inferred: true`). Two such PHANTOM windows are open right now -- `2026azscor` "Summer
      Scorcher" [08-28, 09-01) and `2026scsc` "South Carolina Robotics And Practicals"
      [08-29, 09-02) -- both `event_type 99`, `is_offseason 1`, ZERO matches. So `runTick` stopped
      taking its cheap `liveEvents.length === 0` early exit and began running the full live path
      (algorithms manifest load, `buildAlgorithmModules`/`makeSigma1`, a D1 read, a TBA poll per
      event) stacked on top of (A)'s already-near-ceiling cost. That exceeds 10 ms.

  The empty `logs` array was never evidence of death during module init: `scheduled.ts` emits its
  only success line at 1071, the tick's LAST statement, so an empty array proves the tick did not
  FINISH, not that it did not START. wallTime 128-182 ms against cpuTime 10 ms further indicates
  real async I/O ran before the kill.

  This is a RECURRING, data-triggered outage, not a one-off. The two windows close 2026-09-01 and
  2026-09-02, at which point the Worker will silently start working again by itself -- until the
  next offseason event's `start_date` opens another phantom window and it breaks again.

fix: |
  APPLIED AND COMMITTED, NOT YET DEPLOYED. Three changes, covering all three legs of the
  developer decision of 2026-08-29.

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
  PARTIAL -- implemented, tested and committed; AWAITING THE DEPLOY READ-BACK. This is the
  correct terminal state for this cycle, not a failure.

  Satisfied here:
    - Full suite: 1,970 passed / 2 failed / 1 skipped. The 2 failures are exactly the ledgered
      `packages/harness/payloadBudget.test.ts` pair (WINDOWS.md #11 and #15). Baseline was
      1,938 passed / 2 failed / 1 skipped -- +32 passing, no new failures, no ceiling touched.
    - `pnpm typecheck` clean.
    - Mutation guardrail satisfied: both fixes have tests proven to fail without the fix.
    - BEFORE evidence captured against a genuinely failing tick while cause B was still active
      (2026-08-29T21:55-21:58Z, see Evidence). Without it the fix could not have been
      distinguished from the calendar, since both phantom windows close 2026-09-01/09-02.

  NOT satisfied, and not satisfiable by this agent:
    - No real tick has been observed returning `ok:true` under the fixed code. `wrangler deploy`
      is refused by the harness permission classifier; the orchestrator runs it.
    - The module-init accounting question (invocation budget vs the separate ~400 ms startup
      budget) is still formally unproven. The deploy prints Worker Startup Time and settles it.
      It no longer blocks anything: a surviving tick at cpuTime 38 carrying a full log line
      already proves init is not what kills the tick.

  PRE-FLIGHT (run 2026-08-29, offline, before handing the deploy back): the NEW read path was
  executed against the REAL deployed artifact through a fake Env. It accepts all 1,581 windows
  including the 200 `inferred: true` entries, and its selection agrees with the old full-parse
  path at every probe instant tested (now, -1d, +1d, +3d, +10d), returning
  [2026azscor, 2026scsc] today and [] after both phantom windows expire. So the deploy will not
  throw a ManifestValidationError against the artifact currently in R2.

  PASS CRITERION for the read-back, stated in advance so it cannot be rationalised afterwards.
  READ THE TWO STAGES SEPARATELY -- conflating them will make a working fix look broken:

    STAGE 1, deploy alone (A1 only; A2 and B are inert until a republish).
      The two phantom windows are STILL in the deployed R2 artifact, so a tick will still enter
      the live path. A1 recovers only the manifest-validation slice: ~2.5 ms desktop, ~4-6 ms on
      the platform after the 1.5-2.3x factor, against a live path measured at 38 ms CPU.
      **Ticks are therefore EXPECTED TO STILL FAIL with outcome:"exceededCpu" at this stage.**
      That is not a failed fix -- it is arithmetic, and it is exactly why B (which only lands on
      a republish) is the decisive leg rather than A.
      What Stage 1 must actually establish:
        - PASS: the deploy succeeds, reports a Worker Startup Time, and the tail shows the NEW
          version id with `exceptions: []`. No NEW failure mode -- specifically no
          ManifestValidationError and no `"ok":false` line.
        - FAIL: any exception, or a tick logging `"ok":false`, or a startup time at/over 10 ms
          (which would resurrect module init as a real contributor rather than a dead lead).
        - The Worker Startup Time reading also settles the one question left formally open all
          session: whether module init is charged to the invocation's 10 ms or to Cloudflare's
          separate ~400 ms startup budget.

    STAGE 2, after the live-windows manifest is republished (`pnpm publish:seasons` -- the run
    already queued for the unrelated workstream; there is no manifest-only publish path, the
    manifest is written by the `--seasons` run when `skipState` is false).
      This is where A2 and B take effect and the phantom windows leave the artifact.
        - PASS: ticks report `outcome:"ok"` with a log line carrying `"ok":true` AND
          `eventsConsidered:0` -- the early exit restored -- at a cpuTime comfortably under 10.
        - FAIL: `eventsConsidered` still non-zero (B did not take effect -- check the republished
          artifact's `generation` and confirm it contains no `inferred: true` entries), or
          `outcome:"exceededCpu"` on a tick that reports `eventsConsidered:0` (which would mean
          the idle path is STILL over budget and A1 was insufficient on its own).

    CALENDAR CONFOUND -- the reason the BEFORE evidence was captured today. Both phantom windows
    expire on their own at 2026-09-01T00:00Z and 2026-09-02T00:00Z. After that the deployed
    Worker starts returning `ok:true` REGARDLESS of whether any of this was fixed. Any read-back
    taken after 2026-09-02 therefore cannot distinguish the fix from the calendar and must not be
    counted as verification. If verification slips past that date, the honest options are to
    re-verify against the next zero-match event's window or to rely on the offline regression
    tests, and to say which was done.


files_changed:
  - apps/worker/src/liveWindows.ts (new loadLiveEventsAt + LiveWindowShapeError; fix A1)
  - apps/worker/src/scheduled.ts (runTick uses loadLiveEventsAt; fix A1)
  - packages/harness/manifestSchemas.ts (new LiveWindowsManifestEnvelopeSchema; fix A1)
  - packages/harness/manifests.ts (retention prune + no blind windows; fixes A2 and B)
  - apps/worker/test/liveWindows.test.ts (18 new read-path regression tests)
  - packages/harness/manifests.test.ts (builder regression tests + envelope lockstep guard)
  - .planning/WINDOWS.md (ledger #16: causation wording AND the disproven no-event-live premise)
  - docs/worker-operations.md (superseded the wrong cold-start hypothesis; new operational contract)
