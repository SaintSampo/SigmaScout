# Milestones

## v1.0 Launch (Shipped: 2026-09-29)

**Delivered:** sigmascout.org, an FRC match predictor with three published algorithms (OPR, EPA, SPR), per-team `X ± Y` uncertainty, event and team pages, a rank simulation, district and championship locks, and a Compare page scoring every algorithm walk-forward. Pages are fed from precomputed R2 artifacts and a live Cloudflare Worker.

**Phases completed:** 13 phases (1–10, including inserted 3.1, 3.2 and 6.1), 118 plans, 332 tasks
**Timeline:** 2026-08-12 (tag `v2-poc`) → 2026-09-29, 2,756 commits, ~218k lines of TypeScript
**Closeout type:** override_closeout. Phase 9 verification still reads gaps_found (clause 2). Known verification overrides: 14 open artifacts plus DATA-04/DATA-05 partial (see STATE.md Deferred Items).
**Audit:** [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md) — tech_debt, requirements 36/38, integration 7/7, flows 6/6

**Key accomplishments:**

- **Walk-forward evaluation harness.** Predict-before-update backtests over a ten-season corpus (2016–2020, 2022–2026; 2021 permanently excluded) score Brier and winner accuracy with calibration. The same numbers feed the published Compare page by construction.
- **Three published algorithms, each versioned.** Event-scoped OPR matches TBA's computation, and EPA is reimplemented from TBA data. SPR, the premier Kalman-family model, was selected on 2016–2022 and carries mean ± spread. Every change to published numbers ships under a new version: opr 6.0.0, epa 13.0.0 and spr 9.0.0 at close.
- **Analytic ranking points.** Closed-form per-season RP pmfs replaced the Monte Carlo draw, and bonus odds are now within about 1.17x of observed. A cold-start prior and Sigma carry went into spr 9.0.0, and the browser runs a 1,000-draw rank simulation from any start match.
- **Publish pipeline plus a live Worker.** About 109k versioned R2 objects are published per generation. The Worker polls TBA every minute and folds all three algorithms live on Workers Paid, with probe windows and self-sufficient promoted events. The live rows come from the publisher's own builders.
- **The site.** Teams, Events, Team, Event (Insights, Breakdown, Quals, Alliances, Elims, Simulation), Compare and Methodology pages, a pine-green design system with rarity-tier colours, mobile and desktop, and a 60 s refetch during live events.
- **District and championship locks.** The Road to District Champs ledger (Phase 10) and the Champ Locks ledger with a simulated cutoff.

### Known Gaps

- **DATA-04 (partial):** the live freshness path is wired and tested, but no production fold has been observed yet. The first live event weekend closes it, along with Phase 10 UAT test 2's live half.
- **DATA-05 (partial):** September's R2 Class A write count is probably over the 1M/month free allowance (about 10 full publishes). Confirm in the Cloudflare dashboard.
- **Phase 9 clause 2:** the RP scorecard was removed from the Compare page (a7017b45) but `rpCalibration` is still measured and published.
- **Published honesty:** `score.ts` headline eligibility rests on a false premise (SPR's 2016–2022 selection seasons are flagged headline-eligible). Seasons 2023–2026 have since been used for model acceptance.
- **ALGO-06 keying:** district artifacts carry no algorithm version in their keys.
- **Requirement text drift** in 8 IDs; see the archived requirements and audit.

---
