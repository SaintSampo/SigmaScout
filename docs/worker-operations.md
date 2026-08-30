# Operating the live-update Worker

`sigmascout-worker` polls TBA once a minute for events that are currently live, advances each
affected team's algorithm state in D1, and rewrites only the artifacts that actually moved in R2.
A tick with nothing live reads one small manifest from KV and stops there, spending zero TBA
requests — which is what makes ~1,440 invocations a day free during the ten months of the year no
event is running. Everything the browser reads is a precomputed R2 object served over a custom
domain, so page traffic never touches this Worker.

Deployed at `https://sigmascout-worker.jrw4561.workers.dev`. Read path: `https://sigmascout.org`.

---

## Deploying

Deploys are **manual, by hand**. There is no deploy-on-push, deliberately (D-27): an accidental
merge to `main` during a live event must not be able to redeploy the thing currently keeping the
site fresh. Auto-deploy is a recorded deferred idea in `04-CONTEXT.md`, gated on the replay rig
being able to gate it.

```bash
pnpm worker:deploy          # from the repo root
```

or equivalently, from `apps/worker`:

```bash
npx wrangler deploy
```

Confirm afterwards:

```bash
npx wrangler deployments list        # a current deployment at 100%
```

The deploy output must print `schedule: * * * * *` and list three bindings — `MANIFEST` (KV), `DB`
(D1), `ARTIFACTS` (R2). If a binding is missing, stop: the tick will fail every minute against a
binding that is not there.

**Check the entrypoint before deploying.** `apps/worker/wrangler.toml` must have
`main = "src/scheduled.ts"`. `src/bundleSmoke.ts` is kept in the repo as a re-runnable proof that
`ml-matrix` bundles and executes in the Workers runtime, and it was briefly the entrypoint during
Phase 4 — deploying with it wired up would put a linear-algebra smoke test on a one-minute
production cron.

---

## Secrets

`TBA_API_KEY` is a **Worker secret**, set once against the deployed Worker. The deployed Worker
cannot read the local `.env`, and putting the value in `wrangler.toml` would commit it — that file
is tracked in git.

Set or rotate it without ever rendering the value:

```bash
cd apps/worker
TBA=$(grep -E '^TBA_API_KEY=' ../../.env | cut -d= -f2- | tr -d '\r')
printf '%s' "$TBA" | npx wrangler secret put TBA_API_KEY
unset TBA
```

Piping via stdin matters: passing a secret as a command-line argument puts it in the process list
and your shell history.

Confirm by **name only** — this never prints a value:

```bash
npx wrangler secret list
```

Standing rule: no key ever appears in `wrangler.toml`, a log line, a published artifact, a commit
message, or a test assertion. See `scripts/secrets-boundary.test.ts`, which enforces the local half
of this, and `.claude/CLAUDE.md` § Conventions for why passing that test is not by itself evidence
that secrets were handled correctly.

---

## Database

Migrations live in `apps/worker/migrations/`. Apply to local and remote separately:

```bash
cd apps/worker
npx wrangler d1 migrations apply sigmascout-state --local
npx wrangler d1 migrations apply sigmascout-state --remote
```

**Then confirm the tables actually exist.** This is not optional:

```bash
npx wrangler d1 execute sigmascout-state --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expect `algorithm_state` and `event_cursor` among the results. The reason to check: `wrangler
deploy` and `tsc` both pass cleanly against an empty database. A missing table is not a build
error — it is a tick that fails every minute in production, and nothing upstream of the failure
will have warned you.

---

## Re-baselining

The offline run is the authority for live state (D-12). Re-baselining overwrites whatever the
Worker has accumulated, correcting incremental drift rather than letting it compound across a
season. It is a **manual operation run before and after an event weekend** — see
[`publish-budget.md`](publish-budget.md) for why it is manual rather than scheduled.

```bash
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-vpr.sql
```
As of plan 07-17, `pnpm publish:seasons` includes offseason and preseason events (`--include-offseason`) in both the published set and the walk-forward stream — an operator running this command is entitled to know its scope changed.

The third seed file's name follows the algorithm's own registry id (`publish.ts`'s
`seed-${algorithm.id}.sql`) — renamed from `seed-sigma1.sql` by plan 07-16 (D-04/D-05). This
instruction describes the file a FUTURE `pnpm publish:seasons` run produces; see the transition
note under "Live folding tier" below for what has and has not landed yet.

Skipping it breaks nothing — the site stays up and approximately fresh. It just means any drift
between the Worker's incremental folding and a from-scratch offline replay goes uncorrected until
the next run.

**A re-baseline that also bumps an algorithm's code version orphans the prior generation in R2.**
`pnpm publish:seasons` only ever `PUT`s the keys it is asked to build under the CURRENT
`{id}@{version}` — it has no cascading delete, so a version bump (e.g. a bug fix that changes an
algorithm's `codeVersion`) leaves every object under the OLD version's prefix sitting in R2
unreferenced by the manifest, still counting against the 10 GB free tier. This does NOT require a
Worker redeploy or a D1 re-seed on its own — D1's `algorithm_state` rows are keyed by
`algorithm_id` alone, never `algorithm_id@version`, so they carry over unchanged. It DOES require a
follow-up R2 cleanup pass — see `docs/publish-budget.md`'s "Version-retirement procedure" (under
its "Delete pass" sections) for the routine `--supersedes-live` invocation. Two full generations
coexisting is not itself a site-breaking problem (the manifest, and therefore every reader,
resolves only the current version), but it is a real, measured 66% chunk of the free tier — worth
reclaiming before the next version bump would push past it.

---

## Live folding tier (quick task 260822-wqt)

**D-04/D-05 (plans 07-16/07-18/07-19) transition — FINISHED, observed rather than declared.** The
tracked config (`LIVE_ALGORITHM_IDS = "vpr"` in `apps/worker/wrangler.toml`) went live on
2026-08-29 when plan 07-19 Task 3 ran `pnpm worker:deploy` — see the new dated deploy record below
for the deployed version id and the deploy output's confirmed vars/bindings. Every reader now
agrees: the publisher writes under `vpr@`, the deployed browser requests `vpr@` exclusively
(07-18), the deployed Worker folds `vpr` live (this record), the algorithms manifest names exactly
three ids with the retired one dropped (`v1/manifest/algorithms.json`, generation
`47d020a4-1a16-4331-bd70-ce2f468bf2d1`, unchanged by the collapse), and the retired identity now
carries zero objects in R2 under its own prefix (before/after stratified census, 07-19 Task 3/4)
and zero rows in remote D1 (`GROUP BY` read-back, 07-19 Task 3/4). The historical measurements below this note,
taken under the pre-rename identity, remain history — new measurements are recorded in their own
dated sections, never overwriting the old ones.

**Only the published algorithm folds live.** `apps/worker/wrangler.toml`'s `[vars]
LIVE_ALGORITHM_IDS` is the single place that is configured — a plain tracked value, visible in
git, following `TBA_BASE_URL`'s own precedent in the same block. Change it there, never anywhere
else.

**Why.** `processEvent`'s `estimatedCost` for ONE ordinary 3v3 match (6 touched teams) is 18 with
the published algorithm alone vs. 50 with all three published algorithms, against ~41 subrequests
actually available per tick (`SUBREQUEST_CAP` 50, `SUBREQUEST_RESERVE` 4, minus the tick's own
fixed costs). With all three live the event defers every tick, forever — measured on the deployed
Worker during plan 04-07 under the pre-rename identity `sigma1` [pre-rename] and recorded in
[`publish-budget.md`](publish-budget.md)'s "Worker runtime budget (D-21/D-23, plan 04-07)" section;
this task's own numbers below reconfirm it on the same criterion, also measured under the
pre-rename identity `sigma1` [pre-rename].

**`opr` and `epa` remain FULLY PUBLISHED** (D-03) — every page and the Compare page still read
them; `packages/harness/publish.ts`, `packages/harness/manifests.ts` and the algorithms manifest
are untouched by this. They refresh only at the manual pre/post-event-weekend re-baseline above,
**not** on the cron. During an event weekend their numbers are as of the last re-baseline — that is
expected behavior, not a bug.

**Adding a second id to `LIVE_ALGORITHM_IDS` is gated** by
`apps/worker/test/liveAlgorithmTier.test.ts`, which recomputes the same budget arithmetic
`processEvent` uses. Re-measure on a deployed Worker before changing the tracked value; do not
raise the test's threshold to make a wider tier pass.

**Verified 2026-08-23, all measurements below under the pre-rename identity `sigma1` [pre-rename] —
plan 07-16 renamed the identity afterward without re-running this verification, since the rename
moves no predicted number and folds no different match** (`apps/worker/test/liveAlgorithmTier.test.ts`'s
tracked-tier assertion flipped to `"sigma1,epa,opr"` [pre-rename] and observed to fail on the
arithmetic-naming message, then reverted — see that test file and its own commit):

- Deployed version `77fca208-753f-4a4b-9f91-98e32c0e1717` (tracked config). `wrangler deploy`'s
  output listed both `env.TBA_BASE_URL` and `env.LIVE_ALGORITHM_IDS ("sigma1")` [pre-rename]
  alongside the `MANIFEST`/`DB`/`ARTIFACTS` bindings and `schedule: * * * * *`.
- Idle ticks on that version: 3 consecutive `"ok":true`, `eventsConsidered:0`, `subrequestsUsed:1`,
  CPU 5–6 ms — no `live-tier-defaulted` warn line, confirming the tracked var reached the deployed
  Worker.
- A real fold, driven via the replay rig (`--event 2026cmptx --algorithm sigma1` [pre-rename]
  `--match-limit 2 --live-trigger cron`) against version `6cbe6d50-c556-49df-a2f6-551030e4ed01` (the
  rig's fixture-pointed deploy): both matches folded with **zero timeouts** —
  `"eventsAdvanced":1,"eventsDeferred":0` on both advancing ticks, `subrequestsUsed` 24 then 26
  (comfortably under 46), CPU 42 ms then 208 ms (n=2). Freshness: 49,586 ms and 60,083 ms
  end-to-end (fixture reveal → published artifact), median/p95/max reported by the rig as
  49,586/60,083/60,083 ms — this includes the real one-minute cron's own scheduling jitter
  (`--live-trigger cron`), not just write-path latency.
- After the mandatory post-rig re-baseline (`pnpm publish:seasons` + the three seed imports), the
  algorithms manifest still lists `opr`, `epa`, `sigma1` [pre-rename], and an `opr` and an `epa`
  event artifact for `2026cmptx` are both still retrievable from R2 — the published set (D-03) is
  intact.

**A real bug found running this verification, fixed alongside it — also measured under the
pre-rename identity `sigma1` [pre-rename].** Cold-starting the published algorithm alone (no league
row of its own yet, `opr`/`epa` already seeded) deterministically deserialized `opr`'s league row
as its own state and crashed every tick — a pre-existing SQL operator-precedence bug in
`readScopedState` (`apps/worker/src/stateStore.ts`), unrelated to the live-tier filter itself but
only ever exercised by cold-starting one algorithm in isolation, exactly what this task needed to
verify. See that file's own comment and `apps/worker/test/readScopedStateSql.test.ts`
for the fix and its regression test.

Two new rows for this section's symptoms are added to the "When something is wrong" table below.

---

## Live-fold deploy — 2026-08-29, plan 07-19 Task 3 (the transition above, finished)

Deployed version `638da16c-d538-4551-b3a0-a2757a77061f`, confirmed at 100% by `npx wrangler
deployments list`. `pnpm worker:deploy`'s output listed `env.LIVE_ALGORITHM_IDS ("vpr")` alongside
`env.TBA_BASE_URL`, all three bindings (`MANIFEST`, `DB`, `ARTIFACTS`), and `schedule: * * * * *`.
Four consecutive post-deploy ticks (taken by the plan orchestrator, immediately after the deploy)
reported `"ok":true`, `eventsConsidered:0`, no `live-tier-defaulted` warn line, and no
`EmptyLiveAlgorithmTierError` — the tracked var reached the deployed Worker and it resolved its
module set against the (still four-entry, at that point) manifest correctly. The manifest was then
collapsed to three entries (`pnpm manifest:algorithms --drop-id sigma1`) and three further ticks
after the collapse were also `"ok":true` — the deployed Worker tolerates the manifest narrowing to
exactly the ids it folds.

**Known issue, discovered re-verifying this record, NOT fixed by plan 07-19 (out of scope — no
`apps/worker` source change is authorized in that plan).** Re-tailing the SAME deployed version
(`638da16c-d538-4551-b3a0-a2757a77061f`) several hours later, on 2026-08-29 at approximately
13:57–20:00 (two separate capture windows), **every single tick observed — 7 of 7 across both
windows — returned `outcome: "exceededCpu"`, `cpuTime: 10` (pinned exactly at the free-plan CPU
budget), and an EMPTY `logs` array**, meaning the tick's own `console.log("tick", ...)` line never
executed. This contradicts the four/three healthy ticks recorded immediately above, taken on the
same version shortly after deploy. Nothing about R2 or D1's state changed between the two
observations in a way that should affect an IDLE tick's cost (an idle tick's early-exit path reads
one live-windows manifest and returns before touching D1 or any algorithm state at all — see
`runTick`'s "Step 1" comment in `apps/worker/src/scheduled.ts`), and no event was live during
either observation window. The most likely explanation, offered here as an unconfirmed hypothesis
rather than a diagnosis: this Worker's bundle (which statically imports all of
`packages/core/algorithms/sigma1`, several thousand lines grown across Phase 3) has had its
cold-start CPU cost creep upward across Phase 7's accumulated commits, and an isolate evicted after
several idle hours now cold-starts consistently over the 10 ms budget, where the 2026-08-22
baseline measured only an occasional 13–14 ms cold start (itself already close to the limit, and
already flagged there as an open question whether the platform enforces it uniformly). **Routed
forward as a new, high-priority tracked finding** — see
`.planning/todos/pending/worker-tick-exceeds-cpu-budget.md` — rather than fixed or investigated
further here.

### Diagnosed, 2026-08-29 — the two paragraphs above are superseded

The cold-start hypothesis offered above is **wrong**, and so is the premise it rested on. Both are
left in place because the way they misled is itself the lesson. Full investigation:
`.planning/debug/worker-tick-exceeds-cpu-budget.md`.

- **"No event was live during either observation window" was FALSE.** The operator judged liveness
  by "is a real competition happening". The Worker judges it by the live-windows manifest, and the
  deployed manifest said two events were live: `2026azscor` and `2026scsc`. Both were `inferred`
  windows guessed from `start_date` for offseason events with zero matches in the corpus — the
  event was not running and had no schedule, so nothing an operator could see contradicted the
  assumption. **When asking "was anything live?", read the manifest, never the calendar.**
- **"The tick's own `console.log` never executed, so it died before handler code" was an unsound
  inference.** `scheduled.ts` emits its only success line as the LAST statement of the tick. An
  empty `logs` array proves the tick did not FINISH, not that it did not START. A 2026-08-29T21:55Z
  capture then caught a surviving tick logging `eventsConsidered: 2` at `cpuTime: 38` — the tick
  was running the full live path all along.

Root cause was an AND-gate, both legs now fixed:

| Leg | What | Fix |
|---|---|---|
| A (structural, latent) | The tick Zod-validated all 1,581 windows — 1,542 of them permanently closed — before asking whether any was live. 3.4–3.9 ms cold on a desktop; the 5–9 ms this doc already recorded below for an idle tick. A 1-minute cron on the free plan pays the cold price nearly every tick. | `liveWindows.ts` `loadLiveEventsAt` validates the envelope, prefilters on the interval, then schema-parses only live entries. `buildLiveWindowsManifest` also stops emitting windows that had already closed when it ran. |
| B (trigger, data) | `buildLiveWindowsManifest` guessed a 4-day window from `start_date` for any event with zero matches — 200 of them. Two opened on 2026-08-28, so the tick stopped taking its `liveEvents.length === 0` early exit and ran a ~38 ms live path against a 10 ms budget. | `buildLiveWindowsManifest` emits no window for a zero-match event. |

**Operational contract this creates — read before an event weekend.** An event is folded live only
if its matches are in the corpus. There is no longer a blind fallback window, so **ingest an event
before it runs, then `pnpm publish:seasons`.** This is not onerous: TBA publishes match schedules
well ahead of an event, and `sort_time` falls back to `predicted_time ?? time`, so a
merely-scheduled event already produces a real, measured window. The "`eventsConsidered: 0` all
weekend" row in the troubleshooting table below is the symptom to watch for, and re-running
`pnpm publish:seasons` is still the fix.

### How the CPU budget is actually enforced — corrected 2026-08-29

This project spent an entire investigation assuming the free plan kills any invocation at exactly
10 ms. **It does not, and that assumption misdirected hours of work.** The constant is right; the
enforcement model was not.

10 ms is the *configured* CPU limit for a Cron Trigger on Workers Free — confirmed by direct fetch
of Cloudflare's [limits page](https://developers.cloudflare.com/workers/platform/limits/) on
**2026-08-29**, and `apps/worker/wrangler.toml` sets no `[limits]` / `cpu_ms` override, so the
platform default applies. But Cloudflare documents, in that same section:

> Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs
> over the configured limit. If your Worker starts hitting the limit consistently, its execution
> will be terminated according to the limit configured.

This Worker's own numbers prove it independently of the docs. Version `638da16c` returned
`outcome: "ok"` at `cpuTime: 38` (21:55:44Z) and was killed at `cpuTime: 10` **sixty seconds
later**, on identical code and an identical manifest. No single threshold explains both.

Everything this Worker has ever recorded:

| outcome | observed `cpuTime` (ms) | where |
|---|---|---|
| `ok` | 5, 6, 7, 8, 9 (median 7, n=10) — plus a **14 ms** cold start in the same run | 2026-08-22, v`5a8e0a6f`, idle |
| `ok` | 5–6 (n=3) | 2026-08-23, v`77fca208`, idle |
| `ok` | **42**, then **208** | 2026-08-23, v`6cbe6d50`, real folds via the replay rig |
| `ok` | **38** | 2026-08-29T21:55:44Z, v`638da16c`, full live path |
| `ok` | 17, 21, 30 | 2026-08-29, v`6c9c93dd`, full live path, post-fix |
| `exceededCpu` | **exactly 10, on all 11 observations** — never 9, never 11 | 2026-08-29, v`638da16c` |

**How to read a `cpuTime` number, given that:**

- A kill always reports exactly 10 because the invocation is *terminated at* the configured limit.
  The reading is consumption truncated by the kill — not a measurement of what the tick wanted.
- **One tick over 10 ms is not a defect.** Infrequent overruns get absorbed. That is all the 14 ms
  cold start and the 42/208 ms rig folds ever were.
- **Every tick over 10 ms is a defect, and it is the one that takes the site down.** The operative
  boundary is not "a tick costs more than 10 ms" but "***every*** tick costs more than 10 ms".
  That is exactly the transition the 2026-08-28 outage made: a week of 5–9 ms idle ticks, then
  every tick on a 38 ms live path, then 100% termination — with no deploy in between.
- Design against 10 ms. **Never design against the flexibility.** Its size, scope and replenishment
  rate are undocumented and unmeasured here, and the 208 ms success is the least-explained reading
  in the table above.

**Startup time is a separate budget — module init is not charged to the invocation.** Cloudflare
allows **1 second** of startup time (limits page, "Worker startup time"), validated at deploy time
as error `10021`; `wrangler deploy` prints the measured value. This Worker reports **76 ms**, well
inside it. The proof that init is not billed to the tick is arithmetic rather than documentary: a
tick completed at `cpuTime: 38`, which is impossible if 76 ms of init came out of the same budget.

---

## Fixed and verified — 2026-08-29, version `6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3`

`pnpm worker:deploy`: upload 933.39 KiB / gzip 154.48 KiB, **Worker Startup Time 76 ms**, triggers
deployed, no upload exception and no `ManifestValidationError` against the artifact already in R2.

Three consecutive ticks on a bounded tail: **all `outcome: "ok"`, `exceptions: []`**, at `cpuTime`
**21 / 30 / 17 ms** (wall 709 / 1250 / 635 ms), two carrying full `"ok":true` log lines with
`subrequestsUsed: 8`.

**Why this verifies the fix and not the calendar.** Every one of those ticks reported
`eventsConsidered: 2` — the two phantom windows were *still in the deployed artifact* and the tick
was *still running the full live path* that measured 38 ms before the fix. Leg B, and the
build-time half of leg A, only land on the next `pnpm publish:seasons`. So the read-path fix
**alone** took a 38 ms path down to 17–30 ms, on live traffic, with the trigger still armed — and
it was captured before the two windows expired on their own (2026-09-01 and 2026-09-02), after
which no observation could have separated the fix from the calendar. **That window is now closed:
this is the only such measurement that will ever exist.**

**Still outstanding, and deliberately not blocking:** `pnpm publish:seasons` republishes the
live-windows manifest, which is what actually removes the 200 `inferred` entries and the 1,542
permanently-closed windows from the artifact. That is *recurrence prevention*, not verification of
the fix. It rides along with the republish already queued for the demo-team exclusion workstream.

---

## Before an event: ingest it, or it will not live-fold

**Operational contract, in force since 2026-08-29.** An event must be in the corpus with at least
one match before the Worker will ever poll it live. There is no automatic discovery any more.

Until 2026-08-29 the manifest builder synthesised a blind 4-day `inferred` window from an event's
`start_date` whenever that event had zero matches in the corpus, so a brand-new event could be
picked up without anything being ingested first. That guess is what caused the outage recorded
above: 200 events carried one, two of them opened for offseason events that were not running, and
every cron tick died `exceededCpu` for days. `buildLiveWindowsManifest` no longer emits them.

What replaces it is the ordinary ingest → republish cycle, and it is sufficient **because TBA
publishes match schedules days before an event runs**. `sort_time` falls back to
`predicted_time ?? time`, so a merely-SCHEDULED event with no played matches already yields a
real, measured window — you do not have to wait for the event to start.

What this means in practice, given there is **no cron-scheduled ingest** (`.github/workflows/`
has only `push`/`pull_request`/`workflow_dispatch` triggers — every ingest is run by hand):

```bash
# Before an event you want live-folded, once its TBA schedule is published:
pnpm ingest --event <eventKey>     # or a full pass
pnpm publish:seasons               # rebuilds live-windows.json with a real window
```

Skip that and the event simply will not update live — the Worker never learns it exists. This is a
deliberate trade: a missed live-fold is a visible staleness bug you can fix by running two
commands, whereas the blind window was an invisible, self-inflicted, recurring outage.

Check what the Worker currently believes is live:

```bash
curl -s https://data.sigmascout.org/v1/manifest/live-windows.json | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const n=Date.now();
    console.log("windows:",j.windows.length,"live now:",j.windows.filter(w=>w.startMs<=n&&n<w.endMs).length);})'
```

A count of `0` is normal out of season — it means no event has future scheduled matches in the
corpus, not that anything is broken.

---

## Watching it

```bash
cd apps/worker
npx wrangler tail sigmascout-worker --format json
```

Every invocation emits exactly one structured line:

```json
{"msg":"tick","ok":true,"durationMs":152,"eventsConsidered":0,"eventsAdvanced":0,
 "eventsDeferred":0,"eventsFailed":0,"tbaRequests":0,"subrequestsUsed":1,"globalRebuildRan":false}
```

That is a healthy idle tick: nothing live, one KV read, zero TBA requests. A failing tick logs
`"ok":false` with an `error` field and is recorded as a failed invocation in the dashboard.

Retained logs, CPU time and subrequest counts are in the dashboard under **Workers & Pages →
sigmascout-worker → Observability**. Observability is enabled at `head_sampling_rate = 1.0` in
`wrangler.toml`; at ~1,440 events/day sampling would save nothing worth the blind spots.

Measured idle-tick cost (10 consecutive invocations, 2026-08-22, version `5a8e0a6f`): CPU median
**7 ms**, range 5–9 ms, with a **14 ms** cold start; wall time median 168 ms; 1 subrequest; 0 TBA
requests. All ten returned `ok`.

Two things about that line were missed at the time, and both are worth naming. First, a *do-nothing*
tick spending 5–9 ms of a 10 ms budget is not a healthy baseline — it is a defect with no headroom,
and it was half the 2026-08-28 outage. Second, the **14 ms cold start that returned `ok`** was, under
the flat-ceiling model everyone was working from, an impossible observation; it was written down as
an open question rather than pulled on. It was in fact the first visible evidence of the isolate
flexibility described under ["How the CPU budget is actually enforced"](#how-the-cpu-budget-is-actually-enforced--corrected-2026-08-29)
above. An observation your model says is impossible is the most valuable one you have.

---

## When something is wrong

| Symptom | Likely cause | First thing to check |
|---|---|---|
| Artifacts stale during a live event | Cron not firing, or the event is outside its manifest window | `wrangler tail` — are ticks arriving ~60 s apart at all? If yes, check `eventsConsidered` in the log line: `0` during a live event means the live-windows manifest doesn't think anything is live |
| Ticks arriving but `eventsConsidered: 0` all weekend | The live-windows manifest went stale — nothing has republished it | Fetch `https://sigmascout.org/v1/manifest/live-windows.json` and check its `computedAt`. Fix by re-running `pnpm publish:seasons` |
| `"ok":false` in the tick log | A tick is throwing | Read the `error` field, then check `subrequestsUsed` on the surrounding ticks first — the subrequest cap is the most likely limit to be hit before anything else |
| `eventsDeferred` climbing every tick | Subrequest budget saturated; events are being pushed to later ticks | Expected under load and self-correcting — the rotation offset guarantees a deferred event is attempted earlier next tick. If it never drains, more events are live than one tick can serve |
| Predictions look wrong but ticks are healthy | Live state has drifted from the offline authority | Re-baseline (above). The offline snapshot always wins; never hand-edit D1 rows |
| No logs at all in `wrangler tail` | Either nothing is firing, or a version without logging is deployed | `wrangler deployments list` — confirm the current version is at or after `0210df9e`'s deploy. Before that commit the Worker logged nothing, and a silent tail meant nothing either way |
| `opr` or `epa` metrics look stale mid-event while `vpr` updates | Expected — only `vpr` folds live (see "Live folding tier" above) | `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; refresh via a re-baseline (above) |
| A `live-tier-defaulted` warn line in the tail | `LIVE_ALGORITHM_IDS` did not reach the deployed Worker (e.g. a `--var` deploy that did not carry tracked vars through) | Redeploy from tracked config with `pnpm worker:deploy` and confirm the deploy output lists both `TBA_BASE_URL` and `LIVE_ALGORITHM_IDS` |
| `outcome: "exceededCpu"` with an empty `logs` array on **every** tick | The tick is *consistently* over the 10 ms CPU budget. It is reaching the handler and dying before its final log line — it is **not** dying in module init (that is a separate 1-second budget) | `eventsConsidered` on any tick that does survive. If non-zero, fetch `https://data.sigmascout.org/v1/manifest/live-windows.json` and see what the Worker thinks is live — **read the manifest, never the calendar**. Read "How the CPU budget is actually enforced" above before drawing any conclusion from a single high `cpuTime` |

---

## Rolling back

```bash
cd apps/worker
npx wrangler rollback
```

**Rolling back the Worker does not roll back D1 state.** Code and state are separate: a rollback
reverts the tick logic, but whatever that logic already folded into `algorithm_state` stays folded.
If the state itself is suspect, re-baseline from the offline snapshot — that is the only supported
way to correct it, and it is authoritative by design.

---

## Site hosting and R2 CORS (plan 05-01)

The site (`apps/web`) and the artifact bucket live on **two different hostnames on purpose**
(D-17, amended 2026-08-24). Cloudflare Pages project **`sigmascout-web`**, production alias
`https://sigmascout-web.pages.dev`, custom domains **`https://sigmascout.org`** (canonical) and
**`https://www.sigmascout.org`**. Artifacts are served from **`https://data.sigmascout.org`**, an R2
custom domain with no compute in the path (Phase 4 D-25, which names no hostname and is unaffected).

**Why the apex serves the site.** D-17 originally gave the apex to R2 and put the site on `www`.
That left `https://sigmascout.org` — the address people actually type — returning a Cloudflare 404,
because R2 serves objects by path and has no `/` or `/teams` object. The Blue Alliance and Statbotics
both serve from their apex; matching that convention is worth more than leaving the naked domain
dead. Swapped 2026-08-24, within D-17's own stated reversibility envelope ("DNS + one CORS origin
string").

**Why not one hostname.** An R2 custom domain claims the *whole* hostname it's attached to — it
cannot share a hostname with a Pages project without a proxy Worker sitting in front of every
artifact read, and NAV-06 rules out any compute in that path. Two hostnames costs one CORS policy;
sharing one costs a Worker on every read.

**The CORS policy.** `infra/r2-cors.json` is the tracked source of truth — this file holds no
credential, only public origin strings. `origins` lists the **site's** origins (apex, `www`, and the
Pages production alias) — not the artifact host. Per D-18, a wildcard origin is forbidden even
though the data itself is public. Re-apply it after any change:

```bash
npx wrangler r2 bucket cors set sigmascout-artifacts --file infra/r2-cors.json --force
npx wrangler r2 bucket cors list sigmascout-artifacts   # confirm what R2 actually stored
```

**Preview deploys are deliberately not allow-listed.** Every Cloudflare Pages preview gets its own
per-deployment hostname (`https://<hash>.sigmascout-web.pages.dev`), and CORS origins can't be
wildcarded per D-18 — so a preview's artifact fetches will fail CORS by design. Test a preview
build against a local artifact fixture (`VITE_ARTIFACT_ORIGIN` override, see
`apps/web/src/lib/artifactOrigin.ts`), or measure against the stable production alias instead.

---

## Replay rig (plan 04-07)

`scripts/replayRig.ts` drives a real historical event through the deployed `sigmascout-worker`'s
real `scheduled()` path, over HTTPS, to measure freshness (D-20/SC-2) and prove online/offline
equivalence (D-14). It substitutes for TBA with a **second, minimal Worker**,
`apps/worker/src/fixtureServer.ts` / `wrangler.fixture.toml`, deployed separately as
`sigmascout-fixture-rig`, serving real-corpus-derived TBA-shaped JSON from the SAME
`sigmascout-artifacts` R2 bucket under a `fixtures/` prefix.

**The override is a plain, tracked config value, never a back door.** `apps/worker/wrangler.toml`'s
`[vars]` block declares `TBA_BASE_URL`, defaulting to the real TBA base — visible in git, not a
secret. The rig substitutes the fixture Worker's URL for the duration of one measurement run via a
deploy-time flag only, never by editing the tracked file:

```bash
cd apps/worker
npx wrangler deploy --var "TBA_BASE_URL:https://fixture-rig.sigmascout.org"
# ... run the rig ...
npx wrangler deploy   # restores the tracked default — the rig itself does this in a try/finally
```

**The fixture Worker needs its own custom domain, not a `*.workers.dev` URL.** A `fetch()` from
inside one Worker to another Worker's `*.workers.dev` subdomain is intercepted by Cloudflare's own
`workers.dev` zone and returns a bare 404 rather than routing to the target script — discovered
running this plan's own first real rig experiment (see `04-07-SUMMARY.md`). `wrangler.fixture.toml`
routes `sigmascout-fixture-rig` to `fixture-rig.sigmascout.org` instead — a custom domain on the
same zone R2's own custom domain (`sigmascout.org`) already uses, which has no such restriction.

**Deploying/updating the fixture Worker:**

```bash
cd apps/worker
npx wrangler deploy --config wrangler.fixture.toml
```

**Running the rig:**

```bash
npx tsx --env-file=.env scripts/replayRig.ts \
  --event <a real historical event key, e.g. 2026cmptx> \
  --worker-url https://sigmascout-worker.jrw4561.workers.dev \
  --fixture-url https://fixture-rig.sigmascout.org \
  --algorithm opr,epa,vpr \
  --mode both \
  --live-trigger cron \
  --out reports/replay-rig/<name>.json
```

Prefer `pnpm replay:rig -- <flags>` for the identical `tsx --env-file=.env` invocation, spelled once
in `package.json`.

**`--live-trigger manual`'s `/cdn-cgi/handler/scheduled` route did not work against the real
deployed Worker in this project's own testing** (a bare 404, Cloudflare error 1042) — this appears to
be a `wrangler dev --test-scheduled`-only local-development feature, not a route Cloudflare exposes
on a genuinely deployed Worker's public edge. `--live-trigger cron` (the default recommendation for
a real run) is what this project actually uses: it waits for the REAL one-minute cron to pick up
each revealed match, which is also the ONLY run that measures the platform's own scheduling jitter
(D-20's own framing already preferred this run). The `manual` code path is kept in the rig (it warns
and continues rather than failing outright on the 404) in case a future Cloudflare change or account
configuration makes it work — do not delete it as dead code without re-testing first.

**What the rig necessarily mutates on the deployed Worker (and why it is safe):**

- `--event`'s scope in `algorithm_state`/`event_cursor` is reset to a cold start, and the SAME
  event's already-published R2 artifacts (`v1/event/...`, `v1/team/...`) are deleted too — every
  corpus event has already been published once by `pnpm publish:seasons`, so resetting D1 state
  alone is not a cold start: the deployed Worker's merge logic reads the EXISTING published artifact
  first, and a freshness poll would find every match "already there" from the ORIGINAL publish, not
  from anything the rig drove. This was a real bug this plan's own first live run caught.
- The real `v1/manifest/live-windows.json` gains one temporary window for `--event`.
- The production Worker is redeployed twice per session (fixture URL, then the tracked default).

**All of this is undone by the next re-baseline** (`pnpm publish:seasons` + the three `wrangler d1
execute --file` seed imports, see "Re-baselining" above) — a rig session should always be followed
by one, not just for hygiene but as the actual restore mechanism for the manifest and any touched
published artifacts.
