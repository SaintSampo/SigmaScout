# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Launch

**Shipped:** 2026-09-29
**Phases:** 13 | **Plans:** 118 | **Tasks:** 332 | **Commits:** 2,756 (from `v2-poc`, 2026-08-12)

### What Was Built
- A walk-forward, predict-before-update evaluation harness over a ten-season TBA corpus, feeding the published Compare page by construction.
- Three versioned algorithms (event-scoped OPR, reimplemented EPA, SPR), with analytic ranking-point pmfs and a 1,000-draw browser rank simulation.
- A publish pipeline of about 109k versioned R2 objects per generation, plus a live Worker that folds all three algorithms every minute on Workers Paid.
- The site: Teams, Events, Team, Event (six tabs), Compare, Methodology, District Locks and Champ Locks, on mobile and desktop.

### What Worked
- **Measurement first.** Building the harness before any model meant every model change was a number, and it let several ideas close cleanly as negative results: GBDT, elim weighting, phase-component prediction, the browser relay.
- **Pre-registered acceptance bars.** Rule A (ship only when accuracy AND Brier both improve), PREREG files and within-run arm differences kept tuning honest and stopped noise from being read as progress.
- **Quick tasks for remediation.** After Phase 9 most work ran as `/gsd-quick` tasks, which kept the pace up without replanning whole phases.
- **Sketch first for UI.** Sketches with screenshots in the loop settled visual decisions before code: the palette, the Match Band, the ledgers.
- **Re-deriving agent claims.** Audits that re-ran tests and curled live artifacts caught false-clean reports twice, including the row-parity gap.

### What Was Inefficient
- **The premier model churned** (Sigma1 → VPR → BPR → SPR) along with its tooling, and later deletions (tune/promote, Swing, harness CLI) left requirement text and code headers drifting behind. 8 requirement IDs had stale text at close.
- **Free-tier constraints drove large amounts of work.** CPU budgets, subrequest caps, the pre-season gate and browser-side folding all went away within a day of buying Workers Paid (~20k lines deleted).
- **Concurrent sessions in one checkout** caused absorbed foreign edits, pushes of other sessions' commits and stale STATE reads. It needed explicit-path staging and origin checks as standing habits.
- **False greens:** `timeout … pnpm` swallowing output, the vitest scope trap (77 vs 167 files, which hid an 8-day red CI), root tsc missing apps/web, and Windows-only passes with Linux CI red.
- **Phase 9's verification was never reconciled** with its seal amendments, and 8 of 13 phases lack an authoritative Nyquist verdict.

### Patterns Established
- Every change to published numbers ships under a new algorithm version, and only the current version is kept.
- Verify deploys by content with an Origin header, never by status code alone.
- Run long network jobs detached (Start-Process plus a PID/log Monitor). Subagents cannot reach the network, so publishes, pushes and live checks run from the main context.
- `pnpm rebaseline` as the one command for ingest, deploy, publish, seed, verify and prune; deploy the Worker before a republish.
- Test production lookups with literal ids after any rename; equality pins, not iteration over hardcoded lists.

### Key Lessons
1. Price the infrastructure plan against the architecture early. A one-day budget decision would have saved weeks of constraint-driven design.
2. When a model or tool is deleted, re-issue the requirement text and code headers in the same change, or the audit inherits the drift.
3. A passing exit code is not evidence. Read the output, check CI after every push, and verify live artifacts by content.
4. Holdout seasons are a published promise. Once they are used for acceptance, say so on the site in the same change.

### Cost Observations
- Model mix and session count were not tracked this milestone.
- Notable: haiku executors bailed on heavy plans and once committed a stub SUMMARY. Opus and sonnet became the executor floor.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | not tracked | 13 | Measurement-first harness; quick-task remediation after Phase 9; Workers Paid re-architecture |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 7,127 passing (305 files) | not measured | — |

### Top Lessons (Verified Across Milestones)

1. (Needs a second milestone to cross-validate.)
