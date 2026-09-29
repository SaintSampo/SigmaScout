# 260929-mkn findings: pricing the pre-schedule simulation in the browser

All numbers come from `260929-mkn-results.json` in this directory, produced by `scripts/measureBrowserPresimPricing.ts`. Every cell is a single run unless marked otherwise. Every extrapolation is labelled "extrapolated".

## 1. Answer

No-go as a replacement for the baked sidecar. Parity holds (the browser reproduces the Node bake's histograms exactly), but generating and pricing 1,000 schedules for the 75-team event takes 80.6 s at 4x and 135.1 s at 6x, far above the 15 s phone-hostile line set in advance. Pricing is not the cost: it is 6.6% of wall time at 1x and 8.3% at 4x for that event (1.07 of 16.10 s, 6.66 of 80.55 s). Schedule generation is 88% and 86% of it. The baked sidecar stays as the zero-compute first paint. If browser pricing is wanted anyway, run it progressively (first render at 150 schedules, refine at 300 and 1000, cancelable, wall-time capped) and expect the generation cost to stay unless pairing structures are shipped.

## 2. What was measured on

| Event | Published roster | Quals | Matches per team | As-of (first played match) |
|---|---|---|---|---|
| 2026txmca | 27 | 36 | 8 | 2026-03-13T18:07:11Z |
| 2026casnd | 40 | 80 | 12 | 2026-03-21T17:29:02Z |
| 2026joh | 75 | 125 | 10 | 2026-04-30T13:05:39Z |

2026txmca has 18 real teams. Its published-style roster is 27 because playoff matches carry nine demo robots (frc9991 to frc9999), and the roster rule (every team in every played and scheduled match, all comp levels) counts them. That also puts its matches per team at 8, where the 18 real teams would give 12. The rung-2 doc measured it at 18 teams. I followed the roster rule in the plan and did not check it against a live sidecar body, so whether production really publishes a 27-team, 8-per-team txmca sidecar is an open question, not a finding. 2026casnd is the finished RP-eligible 2026 event closest to 40 teams (ties to the lowest event key).

State: spr `9.0.0+baseline`, the pre-event walk-forward state rebuilt by `buildDistrictPricingState` cut at each event's first played match, over 2016-2020 and 2022-2025 then 2026, with the Sigma carry and the RP cold prior on. This is equivalent to the publisher's pre-event snapshot up to matches sharing that exact timestamp. It was not read from R2. The reference is `buildPreScheduleArtifact` at 1,000 schedules x 50 draws on the same state.

Host: AMD Ryzen 5 7600X (12 logical CPUs), Windows 11, Node v24.15.0, Chromium 151.0.7922.34 headless (Playwright 1.62.1), esbuild 0.28.2. Throttle is CDP `Emulation.setCPUThrottlingRate` on the page main thread of a desktop host. 4x is Lighthouse's mobile preset and 6x is read as a low-end phone; both are approximations. A fixed in-page busy loop confirmed the rate took effect (median of three: 51 to 60 ms at 1x, 212 to 220 ms at 4x, 384 to 393 ms at 6x). The whole pipeline slowed by more than the nominal rate: at the 1,000-schedule checkpoint, wall time was 4.3 to 5.0x the 1x time at "4x" and 7.1 to 8.4x at "6x".

## 3. Factoring

Read from the code, confirmed by parity (section 7).

Alliance-level (depends on one alliance's three teams only, cacheable by the unordered triple):
- inside `spr.predict`: `viewOfMap` (rating mean and variance) and `redScore = mu * scale / 3`
- the filler's `allianceSigmaBandVariance`, `momentsFor`, `meanShift.apply` with `rosterIsFullyWarm`, and `allianceBonusRpPmf` (marginal fit, lattice, bonus convolution)

Match-level (needs both alliances or the win probability):
- inside `spr.predict`: `pRedWin` from the two alliance views
- `matchOutcomeDistribution`, the two outcome pmfs, `convolvePmf` with each cached bonus pmf, the normalization and length checks, and `roundPmf` on both pmfs

SPR predict was not cached. `viewOfMap` is not exported, and caching it would mean editing `packages/`, which this spike may not do. Its measured cost bounds what caching it could save: 1.9 to 2.5 us per match in Chromium 1x, against 10.4 to 11.1 us for a whole uncached call (warm reps, all three events). The alliance-level share of predict is smaller than that, so the saving is below the bound.

Component costs, microseconds, 200 schedules, whole-loop timings:

| Event | Engine | SPR predict / match | Alliance pieces / unique alliance | combineMatch / match | roundPmf x2 / match |
|---|---|---|---|---|---|
| txmca | Chromium 1x | 2.53 | 4.96 | 1.15 | 3.39 |
| txmca | Node | 2.35 | 6.68 | 2.06 | 9.15 |
| casnd | Chromium 1x | 2.05 | 4.63 | 1.96 | 3.70 |
| casnd | Node | 2.34 | 5.81 | 2.27 | 9.56 |
| joh | Chromium 1x | 1.88 | 3.36 | 1.28 | 3.14 |
| joh | Node | 1.77 | 4.57 | 1.59 | 9.57 |

The plan expected `allianceBonusRpPmf` to be the bulk. It is 3 to 7 us per unique alliance, so a cache removes at most two of those per match, and the floor with a perfect cache is predict + combine + round, about 6.3 us per match in Chromium 1x for the 75-team event. `roundPmf` is the single largest per-match piece and cannot be cached (it runs on the match-level combine output).

## 4. Q1: pricing cost and the cache

P1 per-call microseconds (K=200 schedules, U,C,U,C,U,C interleaved in the same process or page, reps in run order). Ratio is cached/uncached; the effect is the median of the three within-run ratios, with the range.

| Event | Engine | Uncached us/call (3 reps) | Cached us/call (3 reps) | Median ratio [range] |
|---|---|---|---|---|
| txmca | Node | 23.4 / 24.3 / 24.3 | 15.1 / 16.1 / 17.9 | 0.663 [0.648, 0.735] |
| txmca | Chromium 1x | 13.6 / 10.8 / 10.9 | 7.1 / 6.7 / 6.6 | 0.609 [0.518, 0.621] |
| txmca | Chromium 4x | 62.0 / 49.3 / 56.7 | 32.4 / 30.8 / 38.1 | 0.625 [0.523, 0.671] |
| txmca | Chromium 6x | 143.0 / 106.9 / 107.7 | 74.5 / 65.8 / 73.0 | 0.616 [0.521, 0.678] |
| casnd | Node | 24.2 / 24.4 / 24.0 | 19.4 / 17.4 / 17.5 | 0.728 [0.714, 0.804] |
| casnd | Chromium 1x | 13.5 / 10.8 / 11.1 | 8.4 / 9.4 / 8.2 | 0.734 [0.623, 0.867] |
| casnd | Chromium 4x | 55.1 / 46.6 / 45.4 | 41.9 / 33.6 / 42.7 | 0.762 [0.721, 0.939] |
| casnd | Chromium 6x | 119.1 / 96.8 / 96.2 | 78.3 / 80.3 / 78.9 | 0.820 [0.657, 0.830] |
| joh | Node | 18.5 / 19.3 / 18.9 | 18.3 / 17.6 / 19.1 | 0.988 [0.908, 1.013] |
| joh | Chromium 1x | 11.8 / 10.4 / 10.4 | 10.5 / 10.2 / 9.6 | 0.932 [0.891, 0.979] |
| joh | Chromium 4x | 69.0 / 60.1 / 59.3 | 62.5 / 59.1 / 61.6 | 0.983 [0.907, 1.040] |
| joh | Chromium 6x | 122.0 / 99.2 / 98.7 | 103.7 / 99.9 / 98.4 | 0.997 [0.850, 1.006] |

The first uncached rep in Chromium is 13 to 26% slower than the next two (cold JIT). Absolute microseconds are one machine's numbers.

The cache helps a lot on the 27-team event and not at all on the 75-team event at K=200, because at 200 schedules most alliances in a 75-team event have not repeated yet:

| Event | Distinct alliances C(N,3) | K=200 unique / slots (hit rate) | K=1000 unique / slots (hit rate) |
|---|---|---|---|
| txmca | 2,925 | 2,906 / 14,400 (79.8%) | 2,925 / 72,000 (95.9%) |
| casnd | 9,880 | 9,521 / 32,000 (70.2%) | 9,880 / 160,000 (93.8%) |
| joh | 67,525 | 35,380 / 50,000 (29.2%) | 65,871 / 250,000 (73.7%) |

Per-event pricing total at 1,000 schedules, milliseconds, pricing only (no generation, no draws):

| Event | Engine | Uncached | Cached |
|---|---|---|---|
| txmca | Node | 912 (measured) | 535 direct at K=1000, 467 in the progressive run |
| txmca | Chromium 1x | 431 (measured) | 235 direct, 286 progressive |
| txmca | Chromium 4x | 2,043 (extrapolated: K=200 median-rep ms x 5) | 1,181 progressive |
| txmca | Chromium 6x | 3,879 (extrapolated) | 2,388 progressive |
| casnd | Node | 1,937 (measured) | 1,242 direct, 1,260 progressive |
| casnd | Chromium 1x | 859 (measured) | 522 direct, 598 progressive |
| casnd | Chromium 4x | 3,730 (extrapolated) | 2,901 progressive |
| casnd | Chromium 6x | 7,744 (extrapolated) | 4,469 progressive |
| joh | Node | 2,482 (measured) | 1,615 direct, 1,932 progressive |
| joh | Chromium 1x | 1,371 (measured) | 1,013 direct, 1,067 progressive |
| joh | Chromium 4x | 7,514 (extrapolated) | 6,655 progressive |
| joh | Chromium 6x | 12,404 (extrapolated) | 10,907 progressive |

The progressive figure is the price phase of the 1,000-schedule checkpoint in a fresh page (cold JIT, pricing interleaved with draws), so it differs from the direct warm figure. In wall-clock terms the cache is worth little: for the 75-team event at 1x it saves about 0.36 s of a 16.1 s run.

## 5. Q2: bytes

Per-event payload (the minimal browser pricing inputs: roster, SPR state tuples, Sigma, RP beliefs, population summary, mean shift) beside the same event's rebuilt sidecar body (bytes):

| Event | Payload raw | gzip | brotli | Rebuilt sidecar raw | gzip | brotli |
|---|---|---|---|---|---|---|
| txmca | 3,698 | 1,335 | 1,158 | 4,157 | 1,958 | 1,622 |
| casnd | 6,111 | 2,384 | 2,066 | 8,122 | 3,655 | 3,044 |
| joh | 21,078 | 8,005 | 6,818 | 23,777 | 10,327 | 8,841 |

The 2026-09-29 publish run's 211 sidecars: median 7,145 B, p95 15,983 B, max 23,806 B, raw UTF-8. The payload is a little smaller than the sidecar it would replace (about 22 to 35% smaller gzipped), so per-event bytes are not the obstacle.

Pricing bundle (esbuild, minified, iife, platform browser, target es2022), paid once per session if lazy loaded: 408,913 B raw, 89,007 B gzip, 74,625 B brotli. 327 KB of the 409 KB of module bytes is zod, pulled in because every season's rule module and breakdown schema imports it at load. Largest inputs by bytes in output: zod core schemas (31,819), zod classic schemas (22,520), `packages/core/rankingPoints/analyticPmf.ts` (10,859), zod core util (10,631), zod core api (10,124). A size-only build with zod stubbed (never executed, so a bound and not a shippable bundle) is 81,702 B raw, 24,394 B gzip, 21,093 B brotli.

Shipping pairing structures instead of generating them, 1,000 structures at six bytes per match:

| Event | Matches per schedule | Raw | gzip |
|---|---|---|---|
| txmca | 36 | 216,000 | 131,909 |
| casnd | 80 | 480,000 | 326,267 |
| joh | 125 | 750,000 | 592,385 |

That is about 57 times the 75-team sidecar's gzip bytes. Structures do not compress well because they are shuffled pairings. Scaling to 300 schedules would be about 178 KB gzip for the 75-team event (derived, linear).

## 6. Q3: time to a stable table

Cached arm, generation included, 50 draws per schedule, fresh page (cold JIT), main thread. Seconds to reach each count, with the generate / price / draw split in the parentheses. `cap` marks the 240 s stop; cells after it were not reached.

2026joh (75 teams):

| Engine | 150 | 300 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|
| Node | 3.00 (2.38/0.43/0.19) | 5.85 (4.77/0.75/0.33) | 18.61 (15.61/1.93/1.07) | 36.61 | 72.79 (62.06/6.65/4.08) |
| Chromium 1x | 2.57 (2.19/0.24/0.14) | 4.97 (4.29/0.40/0.27) | 16.10 (14.18/1.07/0.86) | 32.05 | 63.70 (56.51/3.64/3.55) |
| Chromium 1x run 2 | 2.57 | 5.00 | 16.16 | 31.94 | 63.57 |
| Chromium 4x | 11.72 (9.89/1.18/0.65) | 23.11 (19.73/2.11/1.27) | 80.55 (69.33/6.66/4.56) | 190.23 (164.10/15.57/10.55) | cap at 2,600 |
| Chromium 6x | 21.09 (17.62/2.35/1.12) | 41.70 (35.21/4.28/2.21) | 135.06 (117.01/10.91/7.14) | cap at 1,800 | cap at 1,800 |

2026casnd (40 teams):

| Engine | 150 | 300 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|
| Node | 1.23 | 2.39 | 8.37 (6.44/1.26/0.68) | 16.87 | 33.80 |
| Chromium 1x | 1.13 | 2.09 | 6.50 (5.41/0.60/0.49) | 12.68 | 25.43 |
| Chromium 4x | 4.68 | 8.91 | 29.50 (24.46/2.90/2.14) | 57.80 | 116.95 |
| Chromium 6x | 7.64 | 14.47 | 46.27 (38.62/4.47/3.19) | 97.07 | 201.85 |

2026txmca (27 teams, 18 real):

| Engine | 150 | 300 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|
| Node | 0.45 | 0.82 | 2.60 (1.82/0.47/0.31) | 5.56 | 11.46 |
| Chromium 1x | 0.39 | 0.73 | 2.31 (1.75/0.29/0.27) | 4.50 | 8.84 |
| Chromium 4x | 1.64 | 3.10 | 10.04 (7.72/1.18/1.14) | 19.70 | 39.54 |
| Chromium 6x | 3.07 | 5.82 | 18.48 (14.04/2.39/2.05) | 36.76 | 74.45 |

Run-to-run spread, the one cell run twice (joh, Chromium 1x): 16.10 vs 16.16 s at 1,000 and 63.70 vs 63.57 s at 4,000, under 1%.

Rung-2 binding floor by schedule count (pooled clause 1, from `docs/models/rung2-generated-schedules.md`): n=150 50.0%, n=300 62.7%, n=1000 81.1% (worst team 1.17 ranks), n=2000 91.8%, n=4000 98.4%. The shipped-at-the-time n=20 reference was 27.0% with the worst team 10.61 ranks. The bar is 95% and the doc reaches it only at about 4,000. So a table that is stable in the doc's sense needs thousands of schedules, and at 4x the 75-team event reaches 2,000 in 190 s and cannot reach 4,000 inside 240 s.

Generation is the bulk: 88% of wall time at 1,000 for the 75-team event at 1x (14.18 of 16.10 s), 86% at 4x, 83% for casnd at 1x, 76% for txmca at 1x. If pairing structures were shipped, what is left is price plus draw, derived from the split above (derived, not measured as a separate run), in seconds:

| Event | Engine | 150 | 300 | 1000 |
|---|---|---|---|---|
| joh | Chromium 1x | 0.38 | 0.67 | 1.93 |
| joh | Chromium 4x | 1.83 | 3.38 | 11.22 |
| joh | Chromium 6x | 3.47 | 6.49 | 18.05 |
| casnd | Chromium 4x | 1.01 | 1.67 | 5.04 |
| casnd | Chromium 6x | 1.49 | 2.53 | 7.66 |

## 7. Parity

Parity means the baked histograms (roster by rank, 1,000 schedules x 50 draws, same seeds and same state) are cell-for-cell equal to `buildPreScheduleArtifact`'s.

| Event | Node uncached | Node cached | Chromium 1x uncached | Chromium 1x cached | Matches whose rounded pmfs differ between arms |
|---|---|---|---|---|---|
| txmca | identical | identical | identical | identical | 0 of 36,000 |
| casnd | identical | identical | identical | identical | 0 of 80,000 |
| joh | identical | identical | identical | identical | 0 of 125,000 (max absolute pmf difference 0) |

Every browser run reported zero network attempts. The sorted-triple cache key can hand a permutation pieces computed in another float order; that did not survive rounding in any of the 241,000 priced matches compared. A DIFF would have meant an output change, which ships under a new spr version (a changed published number does).

## 8. Recommendation

P2 (parity) passed in every arm and engine, so a plain go was available on that gate. P3 (the deciding number is the 75-team event's wall time to n=1000, cached, generation included) lands in the phone-hostile band at both throttles:

- 4x: 80.6 s, over 15 s.
- 6x: 135.1 s, over 15 s.
- For reference, 1x on this desktop is already 16.1 s, and the two smaller events at 4x are 29.5 s (casnd) and 10.0 s (txmca, the only 4x cell in the 3 to 15 s band).

So the frame's answer is no-go for generating and pricing 1,000 schedules in the browser. Payload is fine (gzip below the sidecar's for every event, plus one lazy bundle of 89 KB gzip, or about 24 KB if the zod dependency were cut), and pricing is cheap, but generation is not, and shipping structures instead costs 592 KB gzip for the 75-team event.

Plan, if browser pricing is pursued anyway:
- Keep today's baked sidecar as the zero-compute first paint. It already holds 1,000 x 50 draws.
- Browser refinement is progressive and cancelable. First render at 150 schedules (1.6 s for txmca and 11.7 s for joh at 4x, 21 s at 6x), then 300 (3.1 s and 23.1 s at 4x), then 1,000 (10.0 s and 80.6 s at 4x). Stop at 1,000 or a wall-time cap, whichever comes first. Do not offer 4,000: it is unreachable for the 75-team event inside 240 s at 4x.
- Only a lower count is honest for large events: 150 schedules is a 50.0% binding floor, 300 is 62.7%, so a browser table below 1,000 would be visibly noisier than the sidecar it refines. It needs to show what it is.
- Cheapening generation is the lever that matters, and either route changes something: shipping structures moves bytes (592 KB gzip per 1,000 for 75 teams), and a lighter generator changes the published histograms, which ships under a new spr version.

## 9. Not measured

- Worker-thread throttling. Production would run in a Web Worker; this spike ran on the page main thread, where CDP throttling applies, and did not measure a worker.
- Real phone hardware. 4x and 6x are desktop CPU throttles, and the whole pipeline slowed by more than the nominal rate.
- Events above 76 teams.
- Cold JIT on first load beyond what the first 50-schedule chunk shows. Each progressive run used a fresh page, so its first chunk carries cold JIT, but code-cache and network effects of a real first visit are not represented (all requests were aborted).
- Anything the cap cut short: joh at 4x stopped at 2,600 schedules (2,000 recorded, 4,000 not reached), joh at 6x stopped at 1,800 (1,000 recorded, 2,000 and 4,000 not reached).
- Uncached totals at 4x and 6x for pricing-only were not run at K=1000; they are K=200 median-rep milliseconds times five and flagged extrapolated.
- Whether the published txmca sidecar really carries nine demo robots in its roster (see section 2).
