---
phase: quick-260929-mkn
plan: 01
subsystem: measurement
tags: [presim, browser, pricing, chromium, spr, spike]
status: complete
requires: []
provides:
  - scripts/browserPresimPricing.ts (browser-safe presim pricer, measurement only)
  - scripts/measureBrowserPresimPricing.ts (Node driver: extract, tracer, node, browser, bundle, summarize)
  - 260929-mkn-results.json and 260929-mkn-FINDINGS.md
affects: []
tech-stack:
  added: []
  patterns: [esbuild JS API via createRequire from tsx, Playwright chromium via createRequire from apps/web, CDP CPU throttle, abort-all network route]
key-files:
  created:
    - scripts/browserPresimPricing.ts
    - scripts/browserPresimPricing.test.ts
    - scripts/measureBrowserPresimPricing.ts
    - .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json
    - .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md
  modified: []
decisions:
  - "No-go as a replacement for the baked sidecar: 75-team n=1000 is 80.6 s at 4x and 135.1 s at 6x, over the pre-registered 15 s line; parity holds but generation, not pricing, is 86 to 88% of wall time"
metrics:
  completed: 2026-09-29
  tasks: 3
  commits: 3
---

# Quick 260929-mkn: browser presim pricing, measured

**Pricing the pre-schedule simulation in the browser reproduces the Node bake exactly, and pricing is cheap, but schedule generation dominates and puts the 75-team event at 80.6 s (4x) to 135.1 s (6x) for 1000 schedules: no-go as a sidecar replacement.**

## What was built
- A browser-safe pricer (uncached production composition and a per-alliance cached arm), chunked runPresim, cache-effect and component micro-loops; bundled with esbuild (platform browser) and run in headless Chromium with every request aborted (0 network attempts).
- A Node driver that extracts the replayed pre-event state (spr 9.0.0, Sigma carry and RP cold prior on) for three finished 2026 events and the Node bake's reference histograms.

## Results
- Parity: identical in all four arm/engine combinations for 2026txmca (27 published-roster teams, 18 real), 2026casnd (40) and 2026joh (75); 0 of 241,000 matches differ between arms.
- Cache effect (median cached/uncached ratio): 0.61 to 0.66 (27 teams), 0.73 to 0.82 (40), 0.93 to 1.00 (75) at K=200; hit rate at 1000 schedules 95.9%, 93.8%, 73.7%.
- Bytes: per-event payload gzip 1.3, 2.4, 8.0 KB against rebuilt sidecar 2.0, 3.7, 10.3 KB; bundle 89 KB gzip (327 KB of the 409 KB raw is zod); shipped structures for 1000 schedules 132, 326, 592 KB gzip.
- Time to 1000 schedules (Chromium 1x / 4x / 6x): 2.3 / 10.0 / 18.5 s (27), 6.5 / 29.5 / 46.3 s (40), 16.1 / 80.6 / 135.1 s (75). Generation is 76 to 88% of wall time.

## Deviations from Plan
- 2026txmca's published roster is 27 (nine demo robots from playoff matches), not 18; matchesPerTeam is 8. Followed the plan's roster rule; not checked against a live sidecar.
- page.evaluate switched to expression strings (function-string form returned undefined).
- Added a bundle phase and a size-only zod-stubbed bundle bound; added --only/--suffix options for the second joh run.
- joh at 4x and 6x hit the 240 s cap (2,600 and 1,800 schedules); uncached 4x/6x per-event totals are K=200 x5, flagged extrapolated.

## Known Stubs
None.

## Self-Check: PASSED
Commits 950c461f, b81a1071, 0433e0a8 verified present by the orchestrator; vitest 3/3; scope gate 0 foreign files.
