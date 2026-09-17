---
quick_id: 260917-1zs
status: complete
date: 2026-09-17
commits: [d8a20404, 1624505c, 9d879923]
verdict: NO-GO
serves_todo: rp-fold-exceeds-worker-cpu-budget
---

# 260917-1zs: Price the frozen-metrics event row — NO-GO

Priced offline against the real corpus, with the bar committed to git **before** any number existed
(`git log` on the todo proves the ordering).

## Verdict: NO-GO, 4 of 7 conditions missed

Best encoding (positional with a per-artifact key header, percentile only on a team's last row at the
event) — the cheapest shape that loses nothing published today:

| Condition | Threshold | Measured | |
|---|---|---|---|
| largest event file | ≤ 280,000 B | **294,382 B** (`2016micmp`) | MISS +5% |
| p95 event file | ≤ 175,000 B | **190,786 B** | MISS +9% |
| 2-event robot page | ≤ 45 KB | 42.8 KB | met |
| 5-event robot page | ≤ 110 KB | **135.6 KB** | MISS +23% |
| worst-case robot page | ≤ 220 KB | **226.5 KB** | MISS +3% |
| storage below the freed ~2.9 GB | ≥ 1.5 GB below | 2.588 GB below | met |
| every audited field recoverable | nothing lost | **2 fields NOT CARRIED** | MISS |

Row-embedded and per-team-timeline encodings are not options at all: at 429 KB and 455 KB they blow
the hard 350 KB ceiling.

## The finding that reframes the design

**The robot page's regression is caused mostly by the event files' existing content, not by the
frozen metrics.** `frc254`'s five 2026 event files already cost **74.9 KB brotli today**. Even if the
frozen row were free, that robot's page would be ~73 KB against today's 10.7 KB — a 6.8x regression
before anything is added.

The structural cause: **a robot page that reads event files downloads every other team's matches at
each of its events.** A robot at a 75-team division pays for all 75 teams' rows to read its own six.
No encoding touches that.

## Sigma is not the problem

Sigma is in the priced set, confirmed against the schema: a per-match sigma entry carries `{value}`
only — no percentile, no spread — matching the UI shipped today. Its cost is **~8 bytes per team per
match**: 44–49 B per played row, 4.8% of a 5-event robot's wire, ~26 MB bucket-wide. Removing it
entirely still misses three conditions.

## What it buys and what it costs

- **Storage improves either way:** −2.6 GB. A robot index measures ~1 KB against a ~29 KB team
  artifact, so shrinking team files removes ~97% of them.
- **The match page improves a lot:** its six team-artifact fetches (~65 KB, 6 requests) collapse to
  zero extra.
- **The robot page, the Metric History tab and `officialSnapshot` all get worse**, and the many-event
  robot worst: cost becomes linear in event count where today's single artifact is sublinear.
- **Two serial hops instead of one** on a cold link — the index must arrive before it names the event
  files. Prefetch buys the hop back for in-app navigation only, never for a shared URL, and never
  touches the bytes.

## Two fields nothing would carry

- `TeamSeasonMatchSchema.variance` — free to lose: never written, never read.
- `MetricHistoryRow.matchIndex` — published, read by nothing in production web, and not
  reconstructible from event files. The chronological *order* is reconstructible; the absolute index
  would leave the published contract.

## Narrower sets that would pass, and what they cost

- **End-of-event rows only** clears every byte condition (max 240 KB, 5-event robot 87 KB) but
  deletes the input to the Metric History chart and to pre-match metrics — it buys the bar by
  deleting two features.
- **Total + Sigma, no spread, no phase components** clears the robot conditions and the p95, and
  misses the max by 6,608 bytes on exactly one event out of 442 priced. It costs the per-event
  Auto/Teleop/Endgame tiles.

## What this pricing does NOT say

**Nothing about the Worker.** It is a byte price only. The 7.6 ms team-half saving is carried over
unchanged and is **gross, not net**: the event artifact grows 1.5–1.8x under this shape, and writing
six teams' frozen rows into it every tick has its own merge and stringify cost. A shape that removes
7.6 ms and adds back an unmeasured amount is not yet known to be a win on the number this work exists
to move.

Also: only SPR was priced (the storage extrapolation over-estimates, flattering the one condition
that passes); brotli q11 is a calibrated proxy, matching two known wire figures within 2%; no
browser-side decode cost was measured.

## Instrument

`scripts/priceFrozenEventRow.ts` runs the real publisher in dry-run against the corpus and reads
bodies through a new **inert** `artifactSink` hook (the only shipped-code change; `publish.test.ts`
and `payloadBudget.test.ts` pass unchanged at 232/232). A static test asserts the script imports no
R2 client, never calls `fetch`, never reads `process.env`, and never teaches `--env-file` — it needs
no secrets at all.

**Calibration:** it measured `2016micmp` at 228,978 B against the published 228,971 B, and the 7-byte
difference is fully explained by this run's longer generation marker. Residual: 0 B.

## Verification

258 tests pass (baseline 232 before the sink); three typechecks clean; four mutations applied by
hand, each observed failing and reverted. A process note worth keeping: `git checkout --` does not
revert an untracked file, so mutation testing on new files needs an explicit backup — the mutations
stacked before this was caught from the rising failure counts.
