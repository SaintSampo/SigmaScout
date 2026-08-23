# Publish budget

## What this document is

This is the measured cost of publishing SigmaScout's data and keeping it fresh: how big each
published page is, how much of Cloudflare's free tier one full publish spends, and what it takes
to keep live state correct given publishing runs on one local machine (D-23). Every figure below
names the run that produced it — the exact command, the date, and the artifact count — so a number
here can be checked against a real run, not merely believed (D-23's own requirement). The Payload
budget table's `budgetMaxBytes` column is read directly by
`packages/harness/payloadBudget.test.ts`, via the machine-readable block at the bottom of this
file — there is exactly one source for these numbers, not two files that could quietly drift apart.

## Payload budget (D-05)

Measured from a real full publish of all five seasons (2022-2026) across all three shipped
algorithms (opr, epa, sigma1):

```
pnpm publish:seasons
```

Run completed 2026-08-22, `06:31:08Z`-`06:45:49Z` (~14 min 41 sec wall clock), producing 54,671
page objects plus 2 manifests (54,673 total `PUT`s), 2,274,047,079 bytes (≈2.12 GiB).

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key |
|---|---:|---:|---:|---:|---|
| `teams/{year}` | 15 | 1,361,992 | 2,721,887 | 2,721,887 | `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` |
| `team/{teamKey}/{year}` | 51,693 | 30,228 | 98,239 | 287,264 | `v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json` |
| `events/{year}` | 15 | 51,879 | 58,362 | 58,362 | `v1/events/2025/sigma1@2.0.0+tuned-2026-08.json` |
| `event/{eventKey}` | 2,943 | 81,358 | 169,830 | 276,105 | `v1/event/2024new/sigma1@2.0.0+tuned-2026-08.json` |
| `compare/{year}` | 5 | 14,017 | — | 14,121 | `v1/compare/2026.json` |
| `manifest/live-windows` | 1 | — | — | — | `v1/manifest/live-windows.json` |
| `manifest/algorithms` | 1 | — | — | — | `v1/manifest/algorithms.json` |

`(count 15 = 5 seasons × 3 algorithms; count 5 for compare = one file per year, algorithm-unscoped
per D-02's documented exception; the manifest rows are single objects with no distribution to
summarize.)`

D-05 names two artifacts explicitly as the ones most at risk of a payload regression, since page
load speed is this project's top stated UX priority:

- **The year-wide teams table** (`teams/{year}`) topped out at **2,721,887 bytes** (≈2.60 MiB),
  for `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` — Sigma1's richer per-team metric set (value
  + spread per component, more components than OPR/EPA) makes it the heaviest of the three
  algorithms' teams files for the same season.
- **The 292-match team page** (`team/{teamKey}/{year}`) topped out at **287,264 bytes** (≈281
  KiB), for `v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json` — frc118, a long-running,
  high-activity team, consistent with 04-CONTEXT.md's measured "max 292 matches per team per
  season" fact.

**Compressed figures — a genuine finding, not an omission.** `curl -I -H "Accept-Encoding: br,
gzip"` against the largest teams file returned `HTTP/1.1 200`, `Content-Length: 2721887`, and **no
`Content-Encoding` header at all** — the plain `r2.dev` public URL used for this measurement does
not apply in-transit compression; `%{size_download}` measured with `Accept-Encoding` sent was
identical to the raw byte count (2,721,887 bytes both ways). D-25's eventual custom-domain
deployment, proxied through Cloudflare's edge, may compress these objects in transit the way a
zone-proxied domain does — that figure is **unmeasured** until a custom domain is actually in
front of this bucket, and should be re-measured then rather than assumed. What this run confirms
is that the RAW byte counts in the table above are exactly what a client fetches today.

## Storage and write volume (DATA-05)

One full publish (`pnpm publish:seasons`, this run):

| Metric | Local counter (this run) | Free-tier allowance | Headroom |
|---|---:|---:|---|
| Objects written | 54,673 (54,671 page objects + 2 manifests) | — | — |
| Bytes written | 2,274,047,079 (≈2.12 GiB) | 10 GB storage | ≈78.9% of the allowance unused after this run |
| Class-A operations (PUTs) | 54,673 | 1,000,000/month | ≈5.47% of one month's allowance for one full publish |

**These are the LOCAL counter's numbers, not the Cloudflare dashboard's.** Per
`04-VALIDATION.md`'s own Manual-Only Verifications table, R2 storage total and Class-A operation
count as billed are account-level Cloudflare metrics that can only be read from the dashboard by a
human with account access — this automated run has no dashboard access and does not fabricate that
cross-check. **The dashboard read-back remains an open manual step**, tracked here rather than
silently marked done: after this run, a human should open the Cloudflare R2 dashboard for the
`sigmascout-artifacts` bucket and record the dashboard's own object count / storage total / Class-A
count alongside the local numbers above, since the two can differ (multipart uploads, retries, and
prior runs' objects all count toward the dashboard figure but not this run's local counter).

## Re-baseline cadence (the D-12/D-24 resolution)

The re-baseline that overwrites live state is a **manual, human-triggered operation**, run before
and after an event weekend — not an automated schedule. D-24 makes publishing a local CLI command
against the 336 MB `data/corpus.sqlite`, which lives on one machine; a "scheduled" job that only
runs when that machine's laptop happens to be open is not actually scheduled. This plan takes
option (a) from `04-CONTEXT.md`'s own two: state the cadence plainly as manual, rather than
implying automation D-24 does not provide.

**The commands, run in this order:**

```bash
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-sigma1.sql
```

**Historical note (corrected by plan 04-08):** before plan 04-08's league-row reshape (D-13), only
the `opr` step above could actually complete. `epa` and `sigma1`'s `emitSeedSql` step threw
`SeedRowTooLargeError` — their league rows carried per-team `priorSeasonRatings` data, each over
D1's 100,000-byte per-statement limit as a single row — so this four-command cadence was written
down here as if it worked for all three algorithms while only ever actually completing for one.
All three commands completed successfully for the first time on plan 04-08's 2026-08-22 run (see
"State-row shape" below).

`pnpm publish:seasons` writes the three `seed-{algorithmId}.sql` files to
`reports/publish/` (gitignored, local only) as a side effect — the three `wrangler d1 execute`
calls are what actually applies them, and they are **not run automatically by `publish:seasons`
itself**, matching D-12's "the offline run is the authority, so a re-baseline overwrites in place"
design: a human decides when the overwrite happens.

**Consequence if skipped:** the Worker keeps advancing incrementally from whatever live state it
last had. Nothing breaks — the site stays up and stays approximately fresh — but any drift between
the Worker's incremental folding and a from-scratch offline replay is not corrected until the next
manual re-baseline run. This is the accepted tradeoff of a local-corpus publishing model, not a
defect to be silently automated away.

**The follow-on that would make this genuinely scheduled:** CI-based publishing — a corpus
snapshot pushed to R2, a GitHub Actions job that pulls it and runs the publish pipeline on a real
cron schedule — is recorded in `04-CONTEXT.md`'s Deferred Ideas as the resolution if manual
re-baselining proves impractical in practice. This plan does not build it; the local-CLI path above
is what ships.

## Baseline provenance (D-09/D-10/D-11)

The published `opr` algorithm is **event-scoped OPR** (`opr@3.0.0+baseline`) — a fit over one
event's qualification matches only, matching what TBA and Statbotics both publish and what the FRC
community understands the term "OPR" to mean. The retired **season-pooled** OPR implementation
(one ridge-regularized fit per team, pooled across a whole season) remains recorded as history, not
deleted, in [`docs/models/opr-baseline-change.md`](models/opr-baseline-change.md) and
[`docs/models/sigma1-tuning-results.md`](models/sigma1-tuning-results.md). Event-scoped OPR is a
**weaker** baseline than the retired season-pooled one — it sees only one event's handful of
matches rather than a team's whole season — and that is stated here explicitly so a Sigma1 result
measured against it is read honestly, not mistaken for a moved goalpost (D-11).

## State-row shape (D-13, plan 04-08)

Before this plan, three of the state store's `scopeKind: "league"` rows held per-team maps that
belong in `scopeKind: "team"` rows instead — measured against the real corpus, 2026-08-22 (the
`sigma1`/`epa` figures from this plan's own objective text; the `opr` figure independently
re-confirmed by a read-back query run immediately before this plan's re-seed):

| Algorithm | League row before | Offending per-team map |
|---|---:|---|
| sigma1 | 259,174 bytes (≈253.1 KB) | `priorSeasonRatings` (`lastSeason`/`yearBefore`, ≈245.8 KB of the row) |
| epa | 251,995 bytes (≈246.0 KB) | `priorSeasonRatings` (`lastSeason`/`yearBefore`) |
| opr | 86,974 bytes (≈84.9 KB) | `lastEventByTeam` |

D1's hard per-statement cap is 100,000 bytes; sigma1's and epa's league rows were each roughly
2.5x that cap as a single SQL tuple, so `wrangler d1 execute --file` could never import them —
`pnpm publish:seasons` exited 1 for both algorithms on every run before this plan. Only `opr` (the
smallest offender) had ever been successfully seeded: 210 rows, RETIRED shape, seeded 2026-08-22,
still the only rows present in remote D1 immediately before this plan's re-seed.

Plan 04-08 moved every one of these per-team maps into `scopeKind: "team"` rows — a union type,
so a team may carry current-season state, a prior-season rating, or both, and a team known only
via a prior-season rating still gets its own row rather than being dropped — and added an explicit
`snapshotShapeVersion` to every league payload, so a RETIRED-shape row (exactly the 210 `opr` rows
already sitting in production) fails loudly (`LeagueRowShapeVersionError`) if read by the reshaped
deserializer, rather than being silently parsed with its per-team data discarded.

### League rows: before vs. after, measured against the real 2022-2026 corpus

Run: `pnpm publish:seasons` (`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026`),
completed 2026-08-22 ~20:04:55Z, ~14 min wall clock. Seed files:
`reports/publish/seed-{opr,epa,sigma1}.sql`.

| Algorithm | League row before | League row after | Reduction |
|---|---:|---:|---:|
| opr | 86,974 bytes | 26 bytes | −99.97% |
| epa | 251,995 bytes | 179 bytes | −99.93% |
| sigma1 | 259,174 bytes | 7,465 bytes | −97.12% |
| **Total (3 algorithms)** | **598,143 bytes (≈584 KB)** | **7,670 bytes** | **−98.72%** |

All three are at or under `MAX_LEAGUE_ROW_BYTES` (16,384 bytes). sigma1's 7,465-byte league row —
the largest of the three, since it alone carries genuine per-component league aggregates
(`componentMean`/`componentConsistency`/`rpVariableMean`) — leaves roughly 2.2x headroom under
that budget.

### Seed emission: no `SeedRowTooLargeError`, for the first time for epa and sigma1

`pnpm publish:seasons` exited **0** on this run. Longest emitted statement, per seed file — all
comfortably under D1's real 100,000-byte per-statement limit:

| Algorithm | Statements (1 DELETE + N INSERT) | Longest statement (bytes) |
|---|---:|---:|
| opr | 34 (33 INSERT) | 90,050 |
| epa | 32 (31 INSERT) | 90,101 |
| sigma1 | 220 (219 INSERT) | 90,034 |

All three sit roughly 9.9–10 KB under D1's real 100,000-byte cap — the "~10 KB of headroom"
`emitSeedSql`'s own doc comment reserves for the `INSERT ... VALUES` prefix and trailing semicolon
sitting on top of the 90,000-byte per-tuple accumulation budget, exactly as designed. (epa's
90,101-byte longest statement is, honestly, a handful of bytes over the nominal 90,000
`maxStatementLength` config value itself — the accumulator bounds tuple bytes, not the final
assembled statement's own `INSERT INTO ... VALUES ` prefix — but it is nowhere near D1's real
100,000-byte enforced limit, which is the property that actually determines import success.)

### Import: all three algorithms present in remote D1, verified by read-back

All three seed files imported cleanly into remote `sigmascout-state`
(`npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-{id}.sql`, run in
order opr, epa, sigma1), 2026-08-22 ~20:05–20:08Z. Read-back
(`SELECT algorithm_id, scope_kind, COUNT(*), MAX(LENGTH(state_json)) ... GROUP BY algorithm_id,
scope_kind`), same run:

| algorithm_id | scope_kind | rows | max bytes |
|---|---|---:|---:|
| epa | league | 1 | 179 |
| epa | team | 4,598 | 495 |
| opr | event | 209 | 18,135 |
| opr | league | 1 | 26 |
| opr | team | 3,699 | 29 |
| sigma1 | league | 1 | 7,465 |
| sigma1 | team | 4,598 | 4,760 |

`opr` has both `event` rows (its per-event OPR fit, D-09, unchanged by this plan) and `team` rows
(`lastEventByTeam`'s per-team bookkeeping, moved here by this plan). `epa` and `sigma1` each have
`team` rows only, matching their own `scopeKind` shape. This unblocks plan 04-07's Task 2
precondition — a seeded D1 — for all three published algorithms, not just `opr`.

### Re-seed, not migrate

This was a re-seed (a clean DELETE-then-INSERT overwrite per algorithm), not a migration, for four
reasons:

1. `emitSeedSql`'s output already begins with `DELETE FROM algorithm_state WHERE algorithm_id =
   '<id>'` — a re-seed is a clean overwrite by construction, not something a migration script would
   need to separately orchestrate.
2. D-12 makes the offline run the authority: live state is derived data, meant to be overwritten by
   a fresh replay rather than incrementally migrated in place.
3. The only rows in remote D1 before this plan were `opr`'s 210 rows (seeded 2026-08-22), and
   nothing had advanced them incrementally since — no event has been live — so there was no
   incremental progress a migration would have needed to preserve.
4. A migration would have to be written, tested, and kept around forever to serve a one-time
   transition of derived data. No new file under `apps/worker/migrations/` was needed either — the
   schema is unchanged (`scope_kind` already admitted a `'team'` value; this plan changes only what
   PAYLOAD `sigma1`/`epa`/`opr` store there, never the table shape).

### Worker deploy and re-measured idle-tick CPU (D-21)

Order matters and is stated explicitly: **the Worker was deployed before the re-seed.** A Worker
running this plan's reshaped `deserializeState` meeting the 210 pre-existing `opr` rows in the
RETIRED shape would throw `LeagueRowShapeVersionError` loudly on any tick that tried to fold that
event — the correct failure mode, since a retired-shape Worker meeting the newly-reshaped rows
instead would have silently read an empty per-team map. No event was live during the
deploy-to-reseed window, so no tick actually attempted an `opr` fold against the stale rows in
practice; the ordering is what makes that failure loud rather than silent, had one been live.

Deploy: `pnpm worker:deploy`, 2026-08-22 ~23:49:17Z, from commit `752b0747` (this plan's Task 2 —
Tasks 1 and 2 were both already committed at deploy time). Version
`8d1919c6-e8d7-4490-a583-bcb6bb46e691`. Deploy output confirmed `schedule: * * * * *` and all three
bindings (`MANIFEST`, `DB`, `ARTIFACTS`); `wrangler deployments list` confirmed it at 100%.

Re-measured the same way the baseline below was taken: `npx wrangler tail sigmascout-worker
--format json`, 12 consecutive invocations, version `8d1919c6-e8d7-4490-a583-bcb6bb46e691`, all
`outcome: ok`:

| | CPU time | Wall time |
|---|---|---|
| Median (all 12) | 7 ms | 160 ms |
| Range (all 12) | 5–13 ms | 152–192 ms |
| First captured invocation | 13 ms | 192 ms |
| Median, excluding first | 7 ms | — |
| Range, excluding first | 5–12 ms | — |

Compare against the pre-change baseline (`docs/worker-operations.md`, version `5a8e0a6f`, n=10, all
`ok`): median **7 ms**, range **5–9 ms**, cold start **14 ms**. The median is identical. The range
is close but not identical (this run's 5–13 ms is slightly wider than the baseline's 5–9 ms — most
likely ordinary jitter at this sample size; every sample returned a genuine `outcome: ok`, not a
regression signal). The first-captured invocation's 13 ms sits close to the baseline's 14 ms
cold-start figure. Note, honestly: "cold start" here — in both this measurement and the baseline it
is compared against — means "the first invocation captured after this version's deploy," not a
value read from an explicit platform-exposed cold-start flag; `wrangler tail`'s JSON output carries
no such field.

**What this figure does and does not show (measurement honesty).** The idle path (`runTick`'s
"nothing live" early exit) performs exactly one KV read and loads NO algorithm state at all — it
never calls `readScopedState`/`deserializeState`, so it cannot exercise the parse this plan
removes. This re-measurement is a **no-regression check only**: the reshape did not make the idle
path slower. It is **not** evidence that a WORKING tick (one that actually folds a live match and
parses team-scoped state) got any CPU cheaper — that claim is not made here, and the working-tick
CPU measurement remains plan 04-07's job. The measured saving THIS plan proves is at the row level,
not the CPU level: **≈584 KB of league-row JSON down to 7,670 bytes total, across the three
algorithms** (table above) — a real, measured number, but a storage-shape number, not a
CPU-timing one.

Also unresolved, carried forward from the baseline and not settled by this measurement either: the
13 ms/14 ms first-invocation figures both returned `outcome: ok` against the documented 10 ms
free-plan CPU budget. Whether the platform actually enforces that budget, and against what, remains
an open question this plan does not answer.

## Worker runtime budget (D-21/D-23)

| Metric | Median | Worst case |
|---|---|---|
| CPU time per tick | pending — measured in plan 04-07 | pending — measured in plan 04-07 |
| Subrequests per tick | pending — measured in plan 04-07 | pending — measured in plan 04-07 |
| TBA requests per event-day | pending — measured in plan 04-07 | pending — measured in plan 04-07 |
| KV writes per day | pending — measured in plan 04-07 | pending — measured in plan 04-07 |

This table is deliberately present and empty rather than omitted — it makes the outstanding
Worker-runtime measurement visible instead of implied. Plan 04-04 (this plan) closes the
per-page-payload and R2-write-volume halves of DATA-05's measured-budget requirement; the Worker
CPU and peak-tick subrequest halves remain open and are plan 04-07's job.

## The machine-readable block

`packages/harness/payloadBudget.test.ts` parses this exact block — the tables above are the human
rendering of these same numbers, not a second source.

```json budget
{
  "measuredAt": "2026-08-22T06:45:49Z",
  "run": "pnpm publish:seasons (tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026)",
  "pages": {
    "teams": {
      "count": 15,
      "medianBytes": 1361992,
      "p95Bytes": 2721887,
      "maxBytes": 2721887,
      "budgetMaxBytes": 3500000,
      "largestKey": "v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json"
    },
    "team": {
      "count": 51693,
      "medianBytes": 30228,
      "p95Bytes": 98239,
      "maxBytes": 287264,
      "budgetMaxBytes": 375000,
      "largestKey": "v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json"
    },
    "events": {
      "count": 15,
      "medianBytes": 51879,
      "p95Bytes": 58362,
      "maxBytes": 58362,
      "budgetMaxBytes": 75000,
      "largestKey": "v1/events/2025/sigma1@2.0.0+tuned-2026-08.json"
    },
    "event": {
      "count": 2943,
      "medianBytes": 81358,
      "p95Bytes": 169830,
      "maxBytes": 276105,
      "budgetMaxBytes": 350000,
      "largestKey": "v1/event/2024new/sigma1@2.0.0+tuned-2026-08.json"
    },
    "compare": {
      "count": 5,
      "medianBytes": 14017,
      "p95Bytes": 14121,
      "maxBytes": 14121,
      "budgetMaxBytes": 20000,
      "largestKey": "v1/compare/2026.json"
    }
  }
}
```
