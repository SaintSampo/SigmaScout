---
quick_id: 260923-1tu
status: complete
date: 2026-09-23
---

# Summary: Workers Paid re-architecture audit

Audit only; no source files changed. Findings in `260923-1tu-FINDINGS.md`.

## What was found

- The plan raised the per-tick CPU cap from 10 ms to 30 s and subrequests from 50 to 10,000, but **R2 is unchanged** (1M Class A writes and 10 GB per month) and is now the binding resource. A rebaseline costs ~109k writes; storage sits at 4.3 GB.
- Seven ranked changes: reverse browser pricing and delete the state block (~2,900 lines, 36 KB off every live event page); delete the state-probe Worker (~7,000 lines, 34% of Worker source plus tests); delete the subrequest deferral machinery, probe cap and rebuild interval (~500 lines, Teams page fresh every minute); delete KV (never written to); reinstate per-team tick writes and delete the live block and three browser derivations (~2,200 lines, ~130k R2 writes in a peak month); widen the live tier to opr, epa, spr (version bumps); add a Cache Rule on the R2 custom domain (zero lines).
- Not recommended: moving the rank simulation server-side (sidecar is already 6.9 KB median and the per-match run is click-driven), migrating D1 to Durable Objects, merging Pages into Workers Static Assets now.
- Sequencing spends one rebaseline: pure deletions first, then the pricing reversal plus team writes plus tier widening in a single republish.

## Decisions (Jacob, 2026-09-23)

1. **Deletions, all of it:** the state-probe Worker (`stateProbe.ts`, its test, `wrangler.probe.toml`), the subrequest deferral and budget machinery, `MAX_PROBES_PER_TICK`, `GLOBAL_REBUILD_INTERVAL_MS`, and the KV binding. The rotation and the advance claim stay.
2. **Reverse both:** the Worker prices upcoming matches again and writes team artifacts on the tick; the state block, the live block, browser pricing, the team overlay and browser standings are deleted. One republish, numbers unchanged.
3. **Widen the live tier to opr, epa, spr:** bump opr and epa, widen `LIVE_ALGORITHM_IDS`, fix `liveAlgorithmTier.test.ts:516`, ride the same rebaseline as decision 2.
4. **Simulation stays in the browser;** correct `docs/simulation-architecture.md`'s stale sidecar sizes.

Still owed by Jacob in the dashboard: a Cache Rule with a 60 s edge TTL on `data.sigmascout.org`.

Follow-on order, to spend one rebaseline: decision 1 as pure deletions and a Worker deploy, then
decisions 2 and 3 together with a single `pnpm rebaseline`, then docs.
