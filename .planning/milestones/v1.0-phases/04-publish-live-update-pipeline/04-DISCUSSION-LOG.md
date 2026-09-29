# Phase 4: Publish & Live Update Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 4-publish-live-update-pipeline
**Areas discussed:** Artifact shape & version keying, Where live state lives, What the 1–3 min refresh actually touches, How freshness & budgets get proven, Publish & serving

---

## Preliminary — infrastructure fact

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, account exists | Cloudflare account set up; R2 bucket / Worker / token can be created as needed | ✓ |
| No, not yet | Phase needs an explicit setup step; early plans run against local emulation | |
| Account exists but untouched | Account from something else, nothing provisioned for SigmaScout | |

**User's choice:** Yes, account exists
**Notes:** Planning can assume real deployment targets. Nothing in the repo referenced Cloudflare — no wrangler config, `.env` held only `TBA_API_KEY`.

---

## Artifact shape & version keying

### Unit of a published artifact

| Option | Description | Selected |
|--------|-------------|----------|
| One file per page | `teams/{year}`, `team/{key}/{year}`, `events/{year}`, `event/{key}`, `compare/{year}` — one page render = one fetch; ~3,750 team files + ~310 event files per season | ✓ |
| Page files + slim search index | Same, but lists split into a tiny index (number/name/key) plus the full metrics payload | |
| Event-centric, teams assembled client-side | ~310 files/season, no duplication, but a team page becomes 2–6 fetches | |

**User's choice:** One file per page
**Notes:** Chosen against the project's stated top UX priority (page load speed).

### Algorithm version keying

| Option | Description | Selected |
|--------|-------------|----------|
| Version in the path, one file each | `/{year}/{algo}@{version}/...` — smallest first paint; dropdown switch is a second CDN-cached fetch | ✓ |
| One file, all algorithms inside | Instant dropdown switching; ~7× payload tax on first paint | |
| Hybrid — promoted inline, others alongside | One-fetch first paint plus sibling files; two artifact shapes to keep in sync | |

**User's choice:** Version in the path, one file each

### Published algorithm set

| Option | Description | Selected |
|--------|-------------|----------|
| Shipped set only | OPR + EPA + promoted Sigma1; the four Phase 2 variants stay harness-only | ✓ |
| Shipped set + all archived promoted versions | Every past promoted version published forever | |
| Everything in the registry | All 7 entries, 7× write volume | |

**User's choice:** Shipped set only

### Preventing half-updated reads

| Option | Description | Selected |
|--------|-------------|----------|
| Stable paths + generation stamp | Overwrite in place; `generation`/`computedAt` inside each artifact makes skew visible | ✓ |
| Immutable versioned paths + pointer | No mixed reads ever, but the pointer needs 1,440 writes/day against KV's 1,000/day cap | |
| Stable paths, no stamp | Simplest; no skew detection at all | |

**User's choice:** Stable paths + generation stamp

### Payload budget enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Committed budget + failing test | Budget file names max compressed size per artifact kind; test measures real artifacts | ✓ |
| Measured and documented, not gated | Sizes reported into `docs/`; nothing breaks | |
| Gate the outliers only | Hard test on the teams table and the 292-match team page; documentation elsewhere | |

**User's choice:** Committed budget + failing test

### Numeric precision

| Option | Description | Selected |
|--------|-------------|----------|
| Round at publish, document the rule | ~3× payload saving; unrounded values stay in harness artifacts so digests are untouched | ✓ |
| Full precision everywhere | Nothing lost; payload tax for digits no page displays | |
| Round metrics, keep probabilities full | Guards Phase 8's simulation draws from rounding drift | |

**User's choice:** Round at publish, document the rule

### Team-season file contents

| Option | Description | Selected |
|--------|-------------|----------|
| Everything the team page renders | Season stats, per-event sections, every match prediction vs actual, metric history | ✓ |
| Summary file + per-event detail files | Constant small first paint; expanding an event is a round-trip | |
| Everything, with history downsampled | Guards the 292-match tail specifically | |

**User's choice:** Everything the team page renders

### Scheduled-match simulation parameters

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 4 publishes them | Win probability + RP pmf for upcoming matches; Phase 8 builds only the sampling loop | ✓ |
| Phase 8 adds them later | Narrower phase; Phase 8 must reopen pipeline, schema, and cron path | |
| Phase 4 publishes, RP distribution deferred | Ships win probability now, defers the pmf pending the 10 ms Monte Carlo check | |

**User's choice:** Phase 4 publishes them
**Notes:** Directly pulls 03-CONTEXT D-11's Monte Carlo CPU question onto this phase's cron path.

---

## Where live state lives

**Measurements presented before the questions:** Sigma1 per-team state ~2 KB → ~7.5 MB per season; OPR's `IncrementalInverse` at 3,750 teams = 4096² × 8 B = **134 MB**, against a Worker's 128 MB isolate limit, with an O(N²) ≈ 16.8M-op rank-1 update per match.

### OPR during a live event

| Option | Description | Selected |
|--------|-------------|----------|
| Offline-only, stamped as stale | Honors 03 D-04's frozen baseline; OPR doesn't move during an event | |
| Event-scoped OPR for the live path | N=64, trivial CPU; but a different estimator from the scored baseline | ✓ |
| Drop OPR from live artifacts entirely | No stale numbers; dropdown option disappears mid-event | |

**User's choice:** Event-scoped OPR — then, on the follow-up naming question, escalated to: *"I don't want season-pooled OPR ever. All OPR should be event scoped like statbotics and TBA."*
**Notes:** This overturns the OPR half of 03-CONTEXT D-04 (rated `costly`, "every SC-3 number is measured against these baselines"). The concern was stated once and in full: event OPR is a **weaker** baseline than season-pooled, and Sigma1 currently loses holdout winner accuracy to season-pooled OPR on both holdout seasons — so a win against the new baseline must not be mistakable for the goalpost move 03 D-02 forbade. The user reaffirmed. Sequencing and record-keeping were then decided explicitly (below) so the change is recorded rather than silent.

### Sequencing the OPR baseline change

| Option | Description | Selected |
|--------|-------------|----------|
| Insert Phase 3.2 before Phase 4 | Swap, re-run 2022–2026, re-issue figures; Phase 4 publishes correct numbers | ✓ |
| Do it as the first plan inside Phase 4 | Fewer boundaries; no success criterion would verify a headline-claim change | |
| Publish event-OPR now, re-run later | Fastest to live; two OPRs under one name in the interim | |

**User's choice:** Insert Phase 3.2 before Phase 4

### Fate of existing season-pooled OPR results

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as recorded history, not as the baseline | Both numbers and the reason stay in `docs/models/` | ✓ |
| Publish both baselines side by side, permanently | Strongest honesty; keeps the 3-hour season-pooled solve alive indefinitely | |
| Replace outright | Cleanest codebase; published comparison silently changes meaning | |

**User's choice:** Keep as recorded history, not as the baseline

### Where per-team live state lives

| Option | Description | Selected |
|--------|-------------|----------|
| D1, overriding CLAUDE.md | Row per (team, season, version); 100k writes/day | |
| R2, one object per team | Keeps CLAUDE.md's topology; 42 round-trips per tick | |
| R2 for state, D1 only for bookkeeping | Bulk in R2, small mutable bookkeeping in D1 | |
| Research it before locking | Lock the requirement, let research verify current limits | ✓ |

**User's choice:** Research it before locking
**Notes:** Locked requirement recorded regardless — per-team granular reads, never a whole-league load. Research must also reconcile CLAUDE.md's "no D1 in v1" against ARCHITECTURE.md's D1 assumption.

### Live-state ownership and correction

Re-asked after the user replied *"I want more info on this, I feel like this should be automatic."* A plain-language explanation was given first: all three options are automatic at run time; they differ on who is the *authority* and whether anything corrects drift.

| Option | Description | Selected |
|--------|-------------|----------|
| Offline snapshot + scheduled re-baseline | Offline pipeline is the authority; re-baseline overwrites drift | ✓ |
| Offline snapshot, no scheduled re-baseline | Traceable to one starting point; no correction mechanism | |
| Worker bootstraps itself | No handoff artifact; mid-season teams cold-start from a prior | |

**User's choice:** Offline snapshot + scheduled re-baseline

### Proving live matches offline

| Option | Description | Selected |
|--------|-------------|----------|
| Replay equivalence test | Same historical event through both paths; assert artifacts match | ✓ |
| Periodic offline re-baseline, no test | Drift corrected but never observed | |
| Both — test plus re-baseline | Belt and braces | |

**User's choice:** Replay equivalence test

---

## What the 1–3 min refresh actually touches

**Measurements presented:** 38 peak concurrent events; ~3.5 matches/min globally; 50 subrequests/invocation; 5 cron triggers; rewriting the year Teams table ≈ the whole 10 ms budget.

### Tick write scope

| Option | Description | Selected |
|--------|-------------|----------|
| Event + affected teams only; globals on a slower cadence | Watched pages fresh in 1–3 min; season ranking lags by minutes | ✓ |
| Everything every tick, including global tables | Full consistency; likely cannot fit at all | |
| Event + teams now, globals recomputed offline only | Simplest cron; Teams page could be a day stale | |

**User's choice:** Event + affected teams only; globals on a slower cadence

### Idle behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Always 1-min, early-exit when nothing is live | ~1,440 near-zero invocations/day vs a 100k/day budget | ✓ |
| Season-scoped cron expressions | Cleaner resource story; hardcoded calendar goes stale | |
| Two triggers: fast during season, slow otherwise | Hedges calendar risk; uses 2 of 5 triggers | |

**User's choice:** Always 1-min, early-exit when nothing is live

### Liveness detection

| Option | Description | Selected |
|--------|-------------|----------|
| Offline pipeline publishes a live-windows manifest | Zero TBA subrequests on discovery | ✓ |
| Worker polls TBA's events list | Always current; spends subrequests every tick | |
| Manifest, with a TBA cross-check on a slow beat | Cheap fast path, self-correcting slow path | |

**User's choice:** Offline pipeline publishes a live-windows manifest

### Polling structure vs the 50-subrequest cap

Re-asked after the user challenged the premise: *"if we hit the limit, what is the risk? Won't the requests just catch up when they can? or is there more risk?"* Answered: the cap is a hard throw, not a throttle; with stable iteration order the same tail events are **permanently starved**, not delayed. Also surfaced: a 304 costs the same subrequest as a 200; the 10 ms limit is CPU time, not wall-clock; and whether R2/D1 binding calls count toward the 50 was flagged as unverified.

| Option | Description | Selected |
|--------|-------------|----------|
| Rotating offset + explicit per-tick cap | Bounded delay instead of starvation | |
| Shard across staggered cron triggers | Every event polled every minute; burns triggers | |
| Both — shard and rotate within each shard | Cannot starve under any load | |
| Decide after research settles the binding question | Lock the requirement; pick the mechanism against verified limits | ✓ |

**User's choice:** Decide after research settles the binding question
**Notes:** Locked requirement recorded — no event may be systematically starved; degradation must be a bounded delay.

---

## How freshness & budgets get proven

**Facts presented:** live offseason events available soon (`2026azscor` 2026-08-28, `2026scsc` 2026-08-29, ~99 more in September).

### Proving SC-2 freshness

| Option | Description | Selected |
|--------|-------------|----------|
| Replay rig in CI + live offseason confirmation | Repeatable and real | |
| Replay rig only | Deterministic, CI-gateable; doesn't exercise TBA latency or cron jitter | ✓ |
| Live offseason event only | Maximally real; not repeatable, not a gate | |

**User's choice:** Replay rig only
**Notes:** The accepted gap (no real TBA latency, no real cron jitter) is recorded in CONTEXT.md D-20 rather than left implicit. A live offseason confirmation remains available but is not required to close SC-2.

### CPU measurement

| Option | Description | Selected |
|--------|-------------|----------|
| Deployed Worker under replayed load | Cloudflare's own reporting — the number the platform enforces | ✓ |
| Instrumented local timing + production spot-check | Faster loop; local proxy and platform accounting can disagree | |
| Both, with the local proxy as the CI gate | Fast gate plus authoritative figure | |

**User's choice:** Deployed Worker under replayed load
**Notes:** Consistent with "replay rig only" — the rig drives the *deployed* Worker, so real R2 latency and real Cloudflare execution are exercised.

### TBA politeness

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the throttle and counter in the Worker | 100 ms spacing, `TbaRequestCounter`; ~3.8 s wall clock costs no CPU | ✓ |
| Parallel fetches, counted but unthrottled | Faster wall clock; 38-request burst every minute at a volunteer service | |
| Bounded concurrency — a few at a time | Middle path; needs its own tuning decision | |

**User's choice:** Reuse the throttle and counter in the Worker

### Recording measured numbers

| Option | Description | Selected |
|--------|-------------|----------|
| A committed budget doc, same as the payload budget | One `docs/` file; phase verification checks against it | ✓ |
| In the phase SUMMARY only | No new doc; operating budget buried in planning history | |
| Committed doc + machine-readable budget file | Documented and asserted numbers can't drift apart | |

**User's choice:** A committed budget doc

---

## Publish & serving

**Facts presented:** corpus 336 MB, `reports/` 3.5 GB, both gitignored; published side ≈ 56k objects ≈ 1.4 GB against R2's 10 GB free storage.

### Who uploads artifacts

| Option | Description | Selected |
|--------|-------------|----------|
| Local CLI command | Runs where the corpus already is; token in the existing untracked `.env` | ✓ |
| CI, with the corpus stored in R2 | Re-baseline runs without a laptop; corpus current in two places | |
| Local for backfill, CI for re-baseline | Each job where its data is; two publish paths to keep identical | |

**User's choice:** Local CLI command
**Notes:** Creates a tension with the scheduled re-baseline (D-12) — recorded explicitly in CONTEXT.md as something the planner must resolve, not assume away.

### Serving path

| Option | Description | Selected |
|--------|-------------|----------|
| R2 custom domain, no compute | Zero Worker requests per read; 100k/day cap never applies | ✓ |
| Thin read Worker or Pages Function | More control; every uncached read spends a Worker request | |
| Custom domain now, read layer if needed | Free read path; add compute against a measured need | |

**User's choice:** R2 custom domain, no compute

### Caching

| Option | Description | Selected |
|--------|-------------|----------|
| Short max-age + ETag revalidation | ~60 s + 304s; pairs with stable paths + generation stamp | ✓ |
| Long cache + purge on write | Max hit rate; purge call per write, missed purge is stale forever | |
| Split by liveness | Long immutable for finished seasons, short for live; depends on the manifest | |

**User's choice:** Short max-age + ETag revalidation

### Worker deployment

| Option | Description | Selected |
|--------|-------------|----------|
| Manual wrangler deploy, documented | No CI credentials; no accidental redeploy mid-event | ✓ |
| Auto-deploy on push to main | No repo/runtime drift; Cloudflare token in GitHub | |
| Manual now, automate after it's stable | Avoids automating a moving design | |

**User's choice:** Manual wrangler deploy, documented

---

## Claude's Discretion

- Per-field numeric precision under D-06.
- Monte Carlo vs deterministic numerical integration for D-08's scheduled-match RP distribution.
- The slower cadence for D-16's global-table rebuild.
- State snapshot serialization format and version keying.
- Wave/plan decomposition across precompute, Worker, storage, serving, and the replay rig.
- Location and shape of the D-23 budget doc, and whether it shares a source with D-05's budget test.

## Deferred Ideas

- A thin read Worker or Pages Function in front of R2 — add only against a measured need.
- CI-based publishing with a corpus snapshot in R2 — the natural resolution of the D-12/D-24 tension.
- Auto-deploy of the Worker on push to main.
- A slim search index split out of the year-wide Teams table — revisit in Phase 5.
- Cache policy split by liveness.
- Publishing all archived promoted versions indefinitely.
- Statbotics external-validation channel (`WINDOWS.md` #1/#2) — still Phase 8.
