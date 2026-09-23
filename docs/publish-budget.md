# Publish budget

## What this document is

The standing budget for publishing SigmaScout's data: the per-page byte ceilings, how uploads are
paced, what one full publish spends of Cloudflare's free tier, and the manual re-baseline runbook.

- **The machine-readable block at the bottom is machine-written.** `pnpm publish:seasons` passes
  `--write-budget`, which replaces that block with the run's own measurements after a successful
  run. Nothing in it is transcribed by hand. Narrow ad-hoc `pnpm publish:artifacts` runs do not pass
  the flag and never overwrite it.
- **The ceilings live in code.** `PAGE_BUDGET_MAX_BYTES` in `packages/harness/publishBudget.ts` is
  the one home for them. `publishSeasons` asserts every page-kind object against it before that
  object is recorded or queued for upload, in `--dry-run` and real runs alike.
- **Every dated run log lives in git history.** Past run write-ups, investigations, delete passes
  and ceiling-change entries were removed from this file on 2026-09-13; read them with
  `git log -p docs/publish-budget.md`.

## Payload budget (D-05)

| Page kind | Key shape | `budgetMaxBytes` |
|---|---|---:|
| `teams` | `v1/teams/{year}/{algorithm}@{version}.json` | 3,500,000 |
| `team` | `v1/team/{teamKey}/{year}/{algorithm}@{version}.json` | 500,000 |
| `events` | `v1/events/{year}/{algorithm}@{version}.json` | 108,000 |
| `event` | `v1/event/{eventKey}/{algorithm}@{version}.json` | 350,000 |
| `compare` | `v1/compare/{year}.json` | 20,000 |

**Enforcement.** An object above its ceiling throws `PublishBudgetExceededError` before it is
uploaded. Uploads overlap building, so objects from earlier (season, algorithm) blocks may already
be in R2 when a later object fails — the same exposure as any mid-run network failure, and the
next successful run overwrites those version-addressed keys in place. `--dry-run` is therefore the
complete budget pre-flight.

**Changing a ceiling.** Edit `PAGE_BUDGET_MAX_BYTES`. `packages/harness/payloadBudget.test.ts` fails
until the `budgetMaxBytes` values in the block below agree with the constant; update the block (by
the next `pnpm publish:seasons`, or by hand to the constant's values). That test also carries its
own absolute ceilings (`TEAMS_PAGE_ABSOLUTE_MAX_BYTES`, `TEAM_PAGE_ABSOLUTE_MAX_BYTES`,
`EVENT_PAGE_ABSOLUTE_MAX_BYTES`), which sit at or above the constant as a structural backstop.

**Standing rule: never widen a ceiling to make a run pass.** Shrink the artifact instead. The one
deliberate exception on record: the `team` ceiling was raised 400,000 -> 500,000 on 2026-09-09 on
Jacob's explicit instruction, because re-fit movement alone was about to exceed the remaining
headroom.

## Upload concurrency

`publishSeasons` uploads through a bounded queue while it keeps building: the default is 48
concurrent PUTs (`--concurrency N` overrides it), and at most twice that many bodies are queued or
in flight at once. `packages/harness/r2Client.ts` retries transient failures (5xx, 429, 408,
network errors) with exponential backoff; a put that still fails after those retries fails the run.

PUTs ran cleanly at concurrency 16 for every committed publish before 2026-09-13. R2 DELETEs, by
contrast, hit sustained `429 Too Many Requests` at concurrency 16 (and 4) during a cleanup pass.
The first real publish at 48 should be attended: if it shows sustained retries, re-run with
`--concurrency 16`.

## The `presim` pre-schedule sidecar (quick task 260905-tll)

`v1/presim/{eventKey}/{algorithmId}@{version}.json` carries the pre-schedule rank simulation's
baked result for one event.

- **It is not a `PageKind`.** It has its own key function, its own size-summary line, no
  `budgetMaxBytes` ceiling, and no `pages.presim` row in the block below. The live Worker's artifact
  writer is keyed on `PageKind`, so it cannot clobber a sidecar.
- **SPR only.** A sidecar is built only for an algorithm that publishes ranking points.
- **1,000 schedules x 50 draws.** Each sidecar is priced from 1,000 seeded synthetic qualification
  schedules at 50 draws each; the published body carries `scheduleCount` and the baked
  distribution, not the priced schedules.
- **Gated by `--presim-from-season`** (`pnpm publish:seasons` passes 2026) and by RP-eligible event
  types. `--write-budget` records the run's sidecar count and median/p95/max sizes in the block's
  `run` string.

## Storage and write volume (DATA-05)

| Resource | Allowance | One full publish |
|---|---:|---|
| R2 storage | 10 GB | about 4.2 GB of page objects (`totalBytes` in the block's `run` string) |
| R2 Class-A operations (PUTs, lists) | 1,000,000 / month | one PUT per object, about 109,000 |
| R2 Class-B operations (GETs) | 10,000,000 / month | none — publishing does not read R2 |

**The R2 allowances above are NOT raised by Workers Paid.** The account moved to Workers Paid on
2026-09-22, which raised CPU and subrequests per invocation and nothing about R2. R2 is where this
project's real ceilings are, and a publish is not the only writer against them.

### The live Worker writes against the same 1,000,000 (quick task 260923-3w6)

Since 260923-3w6 the cron tick writes a per-team artifact on every fold, alongside the event artifact
and the `teams/{year}` rebuild. Driven by MATCHES FOLDED rather than by ticks — a tick with nothing new
writes nothing — the peak-season-month estimate from `260923-1tu-FINDINGS.md` item C5 is:

| Writer | Basis | Peak month |
|---|---|---:|
| Team artifacts | ~18k matches/season x 6 teams x 3 algorithms over ~2.5 months | ~130,000 |
| Event artifacts | one per algorithm per folded match | ~25,000 |
| `teams/{year}` rebuilds | 3 per touched tick, ~4.3k touched ticks | ~13,000 |
| Two full publishes | 109,000 each | ~218,000 |
| **Total** | | **~390,000 of 1,000,000** |

Viable with margin, and the margin is spent mostly on republishes: **about 35 percent of the month's
budget is two `pnpm publish:seasons` runs.** That is the reason `pnpm rebaseline` is not scheduled and
`pnpm publish:stubs` (about 120 writes) exists for adding new events. The growth axis that is genuinely
capped is the number of PUBLISHED ALGORITHMS — each is ~1.4 GB and ~36,000 objects — not the live tick.

The per-team write also replaced two things that cost R2 nothing but cost page loads: the event
artifact's ephemeral `live` block (about the rows of every match folded so far, carried in every event
page fetch) and one `v1/live-roster/{eventKey}.json` object per promoted event. Neither is written any
more; stale roster objects from before 2026-09-23 sit read-only until a prune. Quick task 260923-3w7
deleted the browser code that read both, plus the `state` block's own reader: an event page no longer
downloads a lazy pricer chunk, and a robot page makes one artifact fetch instead of one per live event
it attends.

**These are the local counter's numbers, not the Cloudflare dashboard's.** Billed storage and
operation counts are account-level metrics only a human with dashboard access can read. They can
differ from a run's own counter: retries, multipart uploads and objects left by earlier runs count
toward the dashboard but not the local figure.

## Re-baseline cadence (the D-12/D-24 resolution)

The re-baseline that overwrites live state is a **manual, human-triggered operation**, run before
and after an event weekend — not an automated schedule. D-24 makes publishing a local CLI command
against `data/corpus.sqlite`, which lives on one machine; a "scheduled" job that only runs when
that machine happens to be on is not actually scheduled.

**The commands, run in this order:**

```bash
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-spr.sql
```

`pnpm publish:seasons` writes the three `seed-{algorithmId}.sql` files to `reports/publish/`
(gitignored, local only) as a side effect — the `wrangler d1 execute` calls are what actually
apply them, and they are **not run automatically by `publish:seasons` itself**, matching D-12's
"the offline run is the authority, so a re-baseline overwrites in place" design: a human decides
when the overwrite happens.

**Consequence if skipped:** the Worker keeps advancing incrementally from whatever live state it
last had. Nothing breaks — the site stays up and stays approximately fresh — but any drift between
the Worker's incremental folding and a from-scratch offline replay is not corrected until the next
manual re-baseline run. This is the accepted tradeoff of a local-corpus publishing model, not a
defect to be silently automated away.

**The follow-on that would make this genuinely scheduled:** CI-based publishing — a corpus
snapshot pushed to R2, a GitHub Actions job that pulls it and runs the publish pipeline on a real
cron schedule — is recorded in `04-CONTEXT.md`'s Deferred Ideas as the resolution if manual
re-baselining proves impractical in practice.

## Cleaning up superseded generations

Objects under versions or generations the live manifest no longer names are removed with
`pnpm cleanup:r2-generations`, which selects keys from a FULL bucket listing and verifies with a
second full listing afterwards. Never drive a bulk delete from a sampled census: a sample
misreported what the bucket held four times before the list-driven tool replaced it.

## Worker runtime budget (D-21/D-23, plan 04-07)

> **Historical — measured under the free plan, retired 2026-09-22.** Every figure and formula
> evaluation below was measured when `SUBREQUEST_CAP` was 50 and the platform's per-invocation CPU
> limit was 10 ms. The account moved to Workers Paid on 2026-09-22 (10,000 subrequests and 30 s CPU
> per invocation), so the "cannot fit" finding below no longer describes the deployed Worker's
> actual headroom — a tick with `estimatedCost` 50 fits inside 10,000 with enormous room to spare.
> The measurement tables and the reasoning that produced them are kept as the record of what was
> observed and how; read the arithmetic that follows as history, not as a current constraint.
>
> **And the machinery itself is now GONE (quick task 260923-3w4, 2026-09-23).** `SUBREQUEST_CAP`,
> `SUBREQUEST_RESERVE`, `usableCap`, `estimateEventSubrequestCost`, the `status: "deferred"` event
> outcome and the `eventsDeferred` tick-log field named below no longer exist anywhere in the
> Worker — there is no cap to check, nothing to defer, and no `eventsDeferred` to watch climb. Every
> symbol below is a name from the deleted design, not something to grep for. `subrequestsUsed`
> survives as telemetry and is the only field of this family a current tick logs.

**The headline finding (historical, measured on the free plan): the per-tick subrequest budget
could not accommodate an ordinary 3v3 match folded across all three published algorithms —
measured directly, repeatedly, on the deployed Worker, not derived from the code alone.**
`processEvent`'s own `estimatedCost` formula (`1 + 1 +
algorithmCount*2 + algorithmCount*2*(1+touchedTeams.length)`) evaluates to **50** for the smallest
possible real case — one newly-completed 3v3 match (6 touched teams) across `opr`+`epa`+`sigma1`
(`algorithmCount=3`) — against a **usable budget of 46** on the free plan (`SUBREQUEST_CAP` 50
minus `SUBREQUEST_RESERVE` 4), and the tick's own fixed costs (manifest reads, tick-meta read, the
per-event cursor read and poll) consumed roughly 5 more before that check ran, leaving **~41
actually available**. 50 > 41: the event **deferred every single tick, forever**, for as long as
all three algorithms were live simultaneously under that free-plan cap — confirmed by direct,
repeated observation below, not inferred. This was 04-RESEARCH.md's own Pitfall 1 warning realized
in production: the ~46-49 subrequest estimate it called "typical, not worst-case" turned out to
already exceed the real usable budget for the most ordinary live match there was.

**Run:** `scripts/replayRig.ts` against the deployed `sigmascout-worker`
(`https://sigmascout-worker.jrw4561.workers.dev`), real historical event `2026cmptx` (16 matches,
16 real teams), 2026-08-23, `--live-trigger cron` throughout (see the plan's own SUMMARY for why
`--live-trigger manual`'s `/cdn-cgi/handler/scheduled` route was tried and found unavailable on a
genuinely deployed Worker). CPU/subrequest figures below are read directly from `wrangler tail
sigmascout-worker --format json` during these runs — the platform's own per-invocation reporting,
the same method `docs/worker-operations.md`'s pre-existing idle-tick baseline (plan 04-08) already
used, not a local simulation (D-21's own prohibition).

### Observed tick shapes, all three real and reproduced live

**Instrument (read this before comparing any figure below to the 10 ms limit).** "CPU time" here
means the `cpuTime` field of the `wrangler tail --format json` trace event — the same quantity
Cloudflare enforces the 10 ms free-plan limit against. It is NOT wall time (`wallTime`, dominated by
awaiting I/O) and NOT the tick's own `durationMs` log field (measured with `Date.now()` across
`await` boundaries, which the Workers runtime freezes during synchronous execution — so it can
never be a CPU figure). Any future row here must name which field it read.

| Tick shape | CPU time (`cpuTime`) | Wall time | Subrequests | TBA requests | Outcome |
|---|---:|---:|---:|---:|---|
| Idle (nothing live) | **median 7 ms, range 5–10, one 14 ms cold start** (n=19) | ~162–212 ms | 1 | 0 | `eventsConsidered:0` |
| Considered, deferred (3 algorithms, 1 new 3v3 match — the case above) | unverified — see correction below | ~700–870 ms | 6 | 1 | `eventsDeferred:1` |
| Considered, **advanced** (1 algorithm — `opr` — alone, 1 new 3v3 match, full fold + 7 R2 writes) | unverified — see correction below | 6,682 ms | 24 | 2 | `eventsAdvanced:1` |

> **Correction (2026-08-23).** This table originally recorded idle CPU as "10–18 ms (n≈14)",
> deferred as "11–18 ms", and advanced as "35 ms (n=1)". The idle figure was re-measured directly
> from `cpuTime` on deployed version `cfdafca8` across two independent samples (n=10 and n=9,
> every invocation `outcome: ok`, no `exceededCpu` in any trace) and came in at **median 7 ms,
> max 10 ms, zero invocations over the limit** — comfortably inside the 10 ms ceiling rather than
> 1.8× over it. The original range matches neither `cpuTime` nor `wallTime` nor `durationMs` from
> the same traces, so its provenance could not be reconstructed; it is withdrawn rather than
> reinterpreted. The deferred and advanced rows came from the same unattributable source and are
> marked unverified until re-measured against `cpuTime` — the advanced row especially, since a tick
> doing seven sequential R2 round-trips is exactly the shape where a wall-time-for-CPU-time
> substitution would be largest (its 6,682 ms wall time against a claimed 35 ms "CPU" is itself the
> tell). Absence of `exceededCpu` across every trace captured to date is a positive-reporting
> instrument returning negative, not merely "nothing broke".

The **advanced** row is the only one that actually did the expensive work (Phase A fold for one
algorithm + Phase B: 1 event artifact + 6 team artifacts, each read-then-write) — it is the closest
this measurement gets to a genuine "worst realistic single-algorithm tick," and its single sample
(n=1) is stated as such, not inflated into a false median. **A true 3-algorithm worst-case tick's
CPU time was never observed, because the tick never reaches the expensive Phase A/B work at all —
it deferred every time before doing anything beyond the poll.** Reporting a CPU figure for that
shape would be fabricating a number for work the platform never actually performed; the honest
figure is that it is unmeasurable under current production settings, and the reason why is itself
the finding.

### Why the originally-planned 38-event/207-match fixture was not additionally run live

`04-RESEARCH.md`'s Pattern 1 table and this phase's `04-CONTEXT.md` both frame the worst case as
many *concurrent* events (the corpus's real measured peak: 38 events live on 2026-03-21, a busiest
hour of 207 matches, a busiest single minute of 10 events each contributing exactly one new match).
Reproducing that shape live was scoped and a real fixture (10 real 2025-03-22 matches, one per
event, from the corpus's actual busiest minute) was built for it
(`scripts/_worstCaseTick.ts`, an uncommitted one-off measurement tool). It was not additionally run:
the single-event result above already answers the question it exists to ask. Every additional
concurrent live event adds its own `estimatedCost` against the exact same shared per-tick budget —
if **one** event with all three algorithms cannot fit inside 41 remaining subrequests, no number of
additional concurrent events changes that arithmetic in the deferring event's favor; they can only
themselves also defer. Running the 10-event fixture live would have cost real additional production
time to demonstrate `eventsDeferred` climbing to 10 instead of 1 — a strictly implied, not a
separately informative, result. If a future measurement disagrees with this reasoning (for instance
because a fix changes the per-algorithm cost shape), the fixture script is committed-adjacent
(deleted before this plan's final commit, reconstructable from this doc's own description) and
should be re-run then.

### What would have to change

**Historical — the free-plan constraint these levers were weighed against is retired 2026-09-22.**
The options below were evaluated against a 50-subrequest cap that no longer applies; none of them
was acted on, and none needs to be now that a single event's `estimatedCost` of 50 fits easily
inside the paid plan's 10,000. Kept as the record of what was considered.

The measured deferral was not a one-off — it was deterministic and structural for the free plan's
`SUBREQUEST_CAP`/`SUBREQUEST_RESERVE`/estimate-formula combination. Reducing the estimate's
dominant term (`algorithmCount*2*(1+touchedTeams.length)` — Phase B's per-team, per-algorithm
read+write) is the highest-leverage lever available without an architectural change:
- **Batch Phase B's per-team artifact reads/writes** the same way Phase A's state read/write
  already is (`stateStore.ts`'s `readScopedState`/`writeScopedState`, one D1 statement regardless of
  team count) — R2 has no native multi-object batch `get`/`put`, so this would need a genuine design
  change (e.g., folding all touched teams into a single per-event "touched teams" object rather than
  one R2 object per team), which is an architectural change this plan does not make unilaterally.
- **Raise `SUBREQUEST_RESERVE`'s headroom claim downward** (i.e., trust more of the real 50-cap) —
  already at its documented minimum per the then-`subrequestBudget.ts`'s own comment (that module is
  `subrequestCounter.ts` since 2026-09-23 and holds no reserve at all); not much room here.
- **Publish fewer algorithms simultaneously live**, or fold algorithms across more than one tick
  (partial-Phase-A-per-tick) — both are real architectural options a future plan should evaluate
  against this measured number, not something this plan decides unilaterally.

This is reported as a **finding for the next plan to act on**, not softened, and not fixed here —
Rule 4 (architectural change) applies, and this plan's own scope is measurement, not redesign.

### CPU/subrequest table (D-21/D-23)

| Metric | Median | Worst case |
|---|---|---|
| CPU time per tick | 10–18 ms (idle/deferred shapes, n≈16) | **Unmeasurable for the 3-algorithm shape — see above.** 35 ms is the one measured sample of a genuine single-algorithm fold (n=1). |
| Subrequests per tick | 1 (idle) / 6 (deferred) | 24 (single-algorithm fold, n=1, the most expensive tick shape actually observed) |
| TBA requests per event-day | 0 (idle, ~10 months/year) | 1–2 per live tick once an event is live (measured); a full live event-day extrapolation was not performed (no genuinely live event occurred during this measurement window) |
| KV writes per day | **0, measured directly** — `env.MANIFEST.get` on the live-windows manifest key returned 404 (no value) throughout this entire phase's testing (verified via `wrangler kv key get`, 2026-08-22/23); `liveWindows.ts`'s KV-primary/R2-fallback design was real code, but nothing in this project ever WROTE to KV at all — every read ever observed fell through to R2. **Acted on 2026-09-23:** quick task 260923-3w4 deleted the KV binding, the `MANIFEST` field and the KV leg of `readManifestText`, on exactly this measurement. The row is kept because the finding is what justified the deletion. | n/a |

**Prediction vs. measurement:** `04-RESEARCH.md`'s Pattern 1 predicted ~46–49 subrequests at the
38-event peak, calling it a per-event average rather than a worst case (its own Pitfall 1). The
measured `estimatedCost` for the smallest real single-event case is **50** — inside, not below, that
predicted range, and the prediction's own caveat (this is typical, not worst-case) is confirmed
exactly: the real worst case is not merely "at" the predicted figure, it **exceeds the actually
usable budget** once the tick's own fixed costs are subtracted. The research's arithmetic held; its
own warning about what that arithmetic meant is what this measurement confirms.

**R2 Class-A operations / KV write count from the Cloudflare dashboard: not read.** This automated
run has no browser/dashboard access — the same limitation plan 04-04's own budget section already
recorded for its R2 write-volume figures ("these are the LOCAL counter's numbers, not the
dashboard's"). The `subrequestsUsed` figures above are the Worker's own self-reported count via
`wrangler tail`, which is real platform telemetry (not a local simulation) but is not the same thing
as an account-level Cloudflare dashboard total. **This remains an open manual step**, tracked here
rather than silently marked done, exactly as plan 04-04 tracked its own equivalent gap.


## The machine-readable block

`packages/harness/payloadBudget.test.ts` and `packages/harness/publish.test.ts` parse this exact
block. `pnpm publish:seasons` rewrites it (`--write-budget`); its `budgetMaxBytes` values must equal
`PAGE_BUDGET_MAX_BYTES`.

```json budget
{
  "measuredAt": "2026-09-21T05:38:41.802Z",
  "run": "tsx packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2026 --write-budget -- generation 8caca9d2-5793-46f9-a3dc-718a77a26efc, 109000 objects, 3917416157 bytes total, 214 presim sidecars (median 6855 B, p95 16005 B, max 23831 B), 2026-09-21T05:05:49.885Z to 2026-09-21T05:38:41.802Z (0h32m52s)",
  "pages": {
    "teams": {
      "count": 30,
      "medianBytes": 913274,
      "p95Bytes": 1371940,
      "maxBytes": 1500082,
      "budgetMaxBytes": 3500000,
      "largestKey": "v1/teams/2026/epa@12.0.0+baseline.json"
    },
    "team": {
      "count": 101397,
      "medianBytes": 28833,
      "p95Bytes": 82213,
      "maxBytes": 262261,
      "budgetMaxBytes": 500000,
      "largestKey": "v1/team/frc3538/2024/spr@7.0.0+baseline.json"
    },
    "events": {
      "count": 30,
      "medianBytes": 68675,
      "p95Bytes": 84108,
      "maxBytes": 84109,
      "budgetMaxBytes": 108000,
      "largestKey": "v1/events/2025/epa@12.0.0+baseline.json"
    },
    "event": {
      "count": 7533,
      "medianBytes": 54164,
      "p95Bytes": 105766,
      "maxBytes": 228914,
      "budgetMaxBytes": 350000,
      "largestKey": "v1/event/2016micmp/spr@7.0.0+baseline.json"
    },
    "compare": {
      "count": 10,
      "medianBytes": 14588,
      "p95Bytes": 14748,
      "maxBytes": 14748,
      "budgetMaxBytes": 20000,
      "largestKey": "v1/compare/2026.json"
    }
  }
}
```
