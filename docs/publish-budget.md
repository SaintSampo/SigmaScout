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
