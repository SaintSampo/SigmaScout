---
status: pending
phase: 09-analytic-ranking-points-browser-side-simulation
source: [09-VERIFICATION.md]
started: 2026-09-12
updated: 2026-09-12
---

## Current Test

Test 2 — one human looking at `/methodology/compare`. Test 1 is waived by decision, below.

## Tests

### 1. The live Worker folds ranking points during a real event — WAIVED BY DECISION, with a condition
expected: During a live window, played qualification rows carry `redRpPmf`/`blueRpPmf` written by the Worker rather than the offline publisher, `deserializeState` reads the shape-15 rows the 2026-09-12 seed wrote, and `cpuTime` stays off the 10 ms pin across a sustained window.
why_human: There is no live event and there will not be one before the season. `v1/manifest/live-windows.json` returns `"windows":[]`, so every cron tick since the seed returns before reading a league row — a `cpuTime` of ~1 ms that looks healthy and proves nothing.
result: **WAIVED 2026-09-12 by Jacob.** A phase may not be gated on the FRC calendar. What is proven without an event: the stripping defect is structurally fixed and held by a non-vacuous live-vs-offline digest parity test across all three algorithms; the deployed bundle deserialized live shape-15 rows across 60+ invocations of the read-only state probe (quick task `260912-3e6`), warnings empty. What is NOT proven is the sustained CPU cost, and that is re-homed to a standing gate rather than dropped — see `docs/worker-operations.md`, "Pre-season gate". **No live window may be opened until `rp-fold-exceeds-worker-cpu-budget` closes.** That gate, not this waiver, is what makes sealing honest: the 2026-08-28 precedent was every tick dying `exceededCpu` for days with no banner.

### 2. The RP calibration scorecard, on real glass — /methodology/compare, desktop and phone, ~2 minutes
expected: The RP calibration section renders; predicted-vs-observed reads as an honest self-assessment rather than a scoreboard; no axis clips; no band renders inverted; a difference too small to call reads as a tie rather than a defeat; labels survive ~400px width; contrast holds in both themes. Live 2019 `completeRocket` should read predicted 0.000 against observed 0.047 — if that embarrassing pair is visible and legible, the surface is doing its job.
why_human: This shipped in plan 09-01 with no browser available, so F1's closure currently rests on the artifact carrying the right numbers, not on the page showing them. Those are different claims. The e2e suite cannot substitute: 19 of 20 spec files navigate with `?algorithm=vpr`, which `searchParams.ts:66` silently catches to the default — so they assert against a different algorithm than they name, and `compare-narrow-legibility.spec.ts:137` asserts a `compare-calibration-card-vpr` that cannot exist. The harness is dead, not merely stale (reviving it is its own board item).
result: (pending — Jacob)

## Notes

Phase 9 is sealed with test 2 outstanding. That is deliberate and it is recorded here rather than
in `STATE.md`, because a STATE seal line freezes at seal time while this frontmatter stays true.
Test 2 gates nothing else; it is a confirmation that a shipped surface reads correctly, and holding
a phase seal on two minutes of someone's attention is the drag pattern this seal exists to stop.
