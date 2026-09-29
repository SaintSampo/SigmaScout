# SigmaScout

## What This Is

SigmaScout (sigmascout.org) is an FRC (FIRST Robotics Competition) match-prediction website — the goal is to be the absolute best FRC match predictor available. It presents teams, events, and predictions the way statbotics.io does, but faster and with honest uncertainty: SPR metrics are displayed as `X ± Y`, predictions update within minutes of new match results, and every algorithm's accuracy is measured and published. Built for the FRC community: students, mentors, and scouts.

This is a clean-slate rebuild (v3). Prior implementations exist only in git history (tag `v2-poc`) and must not be consulted or ported — see REBUILD_SPEC.md "Clean slate" section. The only inheritance is the failure log.

## Core Value

Predictions that are *measurably* better than Statbotics — proven by walk-forward backtests scored on winner accuracy first and Brier second — delivered on pages that load fast.

## Current State

**v1.0 Launch shipped 2026-09-29** (13 phases, 118 plans; [MILESTONES.md](MILESTONES.md), [audit](milestones/v1.0-MILESTONE-AUDIT.md)). Live generation b2bfe488 publishes opr 6.0.0, epa 13.0.0 and spr 9.0.0 over a ten-season corpus (2016–2020, 2022–2026). A Cloudflare Worker on Workers Paid polls TBA every minute and folds all three algorithms live; 47 probe windows cover the fall offseason. Roughly 218k lines of TypeScript across apps/web, apps/worker and the pipeline packages.

## Requirements

### Validated (v1.0)

- ✓ Evaluation harness: walk-forward, predict-before-update backtests with Brier and winner accuracy, every algorithm head to head — v1.0
- ✓ Three published algorithms (event-scoped OPR, reimplemented EPA, SPR) selectable in the UI and scored in the harness — v1.0
- ✓ Variance-carrying Kalman-family model (SPR) with parameters from an offline search on 2016–2022 and a validated within-season adaptation — v1.0
- ✓ Algorithm versioning: every published number is keyed by algorithm and version, and changed numbers ship under a new version — v1.0
- ✓ Rank-point prediction with per-season RP rules (analytic pmfs, SPR only) — v1.0
- ✓ Data pipeline from TBA API v3 with ETag caching, versioned R2 artifacts, and a live Worker — v1.0 (live freshness wired, not yet observed in production; see Active)
- ✓ Teams page, Events page (week/country/state/district filters), Team page, Event page tabs including the 1,000-run rank simulation — v1.0
- ✓ Compare page with per-algorithm per-year accuracy and calibration — v1.0
- ✓ Global UI: ribbon (Teams / Events / Locks / Methodology), algorithm and year selectors, search, deep links, mobile and desktop — v1.0
- ✓ District points ledger (Road to District Champs) and Champ Locks with a simulated cutoff — v1.0 (Phase 10)

### Active (carried from the v1.0 audit)

- [ ] Observe a real live fold and district refresh, and re-measure freshness under SPR (closes DATA-04)
- [ ] Confirm September's R2 Class A write count against the free allowance and set a full-publish cadence rule if needed (DATA-05)
- [ ] Resolve Phase 9 clause 2: show RP accuracy or stop publishing `rpCalibration`
- [ ] Fix `score.ts` headline eligibility for SPR's selection seasons, and say on the site which seasons are no longer held out
- [ ] Put an algorithm version in district artifact keys (ALGO-06)
- [ ] Re-issue the drifted requirement text (ALGO-03/04/08, TEAM-05, EVNT-07, EVAL-05, NAV-01, DATA-04/05) in the next milestone's requirements

### Out of Scope

- Porting any pre-v3 code, models, or tuned values — clean-slate mandate; independent re-derivation only (REBUILD_SPEC.md)
- **2021 is a permanent exclusion, not a deferral** — the at-home/remote season had no conventional 3v3 alliance matches, so there is nothing for a match predictor to ingest or score (recorded user decision, 2026-09-03)
- Paid infrastructure beyond Workers Paid — R2, Pages and KV stay within free allowances; respect TBA rate limits
- Client-side season recomputation — Statbotics' recalculate-in-browser approach is explicitly rejected; the browser runs only simulations
- User accounts / personalization — not part of the product vision
- Ensembles of EPA and SPR — improve SPR itself (standing decision)

## Context

- **Data source:** The Blue Alliance API v3 (a TBA API key exists in the repo's untracked `.env`). ETag-aware caching is recommended by TBA and counts as independent best practice, not a port. The Statbotics API has been down since 2026-09-13; the EPA comparison page shows the September 4 pull.
- **EPA baseline is reimplemented** from TBA data (walk-forward capable at any point in time), within about 0.26 pp of Statbotics on average.
- **Failure log from prior attempts** (constraints, not designs — full text in REBUILD_SPEC.md): no evaluation harness existed; an unidentifiable 4D model collapsed; outcome leakage must be structurally impossible (predict strictly before update); never recompute per request; docs must track the shipped model; tests are not optional; keep generated artifacts out of git.
- **Live updating:** a standalone Cloudflare Worker on a 1-minute cron polls TBA, keeps per-team state in D1, and merges live rows into R2 through the same row builders as the offline publisher. Pages refetch every 60 s during live events.
- **Season timing:** the 2026 season is complete; fall 2026 offseason events are the first live exposure, and the 2027 season is the first full live target (including the first district weekend).

## Constraints

- **Tech stack**: React + Vite + Tailwind CSS, hosted on Cloudflare Pages — user-specified
- **Budget**: Workers Paid since 2026-09-22 (30 s CPU / 10,000 subrequests per invocation); R2, Pages and KV stay within their free allowances; respect TBA API rate limits — hobby project economics
- **Performance**: page load speed is the top UX priority; ship compact precomputed data; modern web features — user-specified
- **Freshness**: new match results reflected on-site within ~1–3 minutes during events
- **Methodology**: all prediction evaluation must be walk-forward with predict-before-update sequencing — failure log
- **Provenance**: no consultation or porting of pre-v3 implementations — clean-slate mandate

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Freshness target ~1–3 min via scheduled TBA polling | Fast enough to feel live during events without webhook/server complexity | ⚠️ Revisit — wired end to end (1-minute Worker tick, all three algorithms fold live, 60 s page refetch) but no production fold observed at v1.0 close; the only latency figure (58.9 s) predates SPR |
| v1 covers seasons 2022–2026 | Modern era, rich score breakdowns, enough backtest history without ballooning scope | ✓ Held (Phase 2) — all five seasons have reconciled component maps and are scored end-to-end. Extended 2026-09-04 (quick tasks 260903-4fs, 260904-nt4): the corpus now covers seven seasons, 2019, 2020, 2022–2026, with 2021 permanently excluded (no conventional 3v3 alliance matches); all seven carry reconciled component maps and RP rule modules and are scored end-to-end |
| v1 algorithms: Sigma1 + OPR + reimplemented EPA | Compare page needs real baselines; reimplemented EPA works walk-forward and substantiates the Statbotics comparison | ✓ Held, with Sigma1 replaced — the premier slot went Sigma1 → VPR → BPR → SPR; published set is opr/epa/spr since 2026-09-12, all selectable in the UI |
| RP prediction + simulation for all covered seasons | Headline features; per-season RP rules accepted as v1 scope | ✓ Good (narrowed) — analytic closed-form RP pmfs (Phase 9, spr 9.0.0 cold-start prior); RP odds and the simulation are SPR-only since 260913-it4 |
| Sigma1 tuning: offline optimizer + online within-season adaptation ("Both") | Online-only hides hand-picked meta-parameters and is unfalsifiable; the harness validates the adaptation itself | Superseded — Sigma1 and its optimizer were deleted 2026-09-13; SPR's parameters are frozen from a 2016–2022 search, and ALGO-05 was cleared for SPR by a pre-registered on/off test (260914-ndu) |
| EPA reimplemented, not pulled from Statbotics API | Walk-forward at any time point, self-contained pipeline; drift risk mitigated by spot-checks | ✓ Held (Phase 2, closed by quick task 260904-4aa) — the Statbotics API blocker resolved, and a committed, re-runnable per-team tolerance check now exists (`scripts/epaVsStatbotics.ts`, `packages/harness/epaStatboticsCompare.ts`). SC-2 is met at the tolerance recorded in `data/baselines/epa-vs-statbotics-2026-09.json`; verdict and caveats in `docs/models/epa-vs-statbotics.md`, including that offseason-inclusive agreement is measurably looser than offseason-excluded agreement (see its "comparability boundary" section) |
| Clean-slate rebuild; only the failure log carries over | Prior tech debt; independent re-derivation allowed, inheritance not | ✓ Good — v1.0 shipped without consulting pre-v3 code |
| OPR is event-scoped: one fit per event over qualification matches, no ridge | FRC and TBA/Statbotics mean event-scoped OPR; a season-pooled ridge variant published under the name `OPR` would be a different quantity than readers expect | ✓ Held (Phase 3.2) — `opr.ts` matches TBA’s own `matchstats_helper.py`; the retired season-pooled baseline is preserved as committed fingerprints and the new baseline is measurably weaker (holdout Brier 0.212/0.221 vs 0.167/0.177), which `docs/models/opr-baseline-change.md` states outright |
| SPR is the premier algorithm (id `spr`) | Improve one model rather than blend; the id cutover ran with no downtime | ✓ Good — spr 9.0.0 live at v1.0 close |
| Never ensemble EPA and SPR; new knobs must be inert at default and earn promotion | Blends hide which model is right and bloat parameters | ✓ Good — standing rule |
| Any change to published numbers ships under a new algorithm version; only the current version is kept | Versioned keys are what make ALGO-06 honest | ✓ Good — held for every republish since 2026-09-14; district keys are the exception (audit N2) |
| Week 0 (event type 100) is predicted but never folded; offseason still folds | Week 0 is scrimmage-grade data | ✓ Good (260919) |
| Buy Workers Paid (2026-09-22) | The free plan's 10 ms CPU and 50 subrequests forced a single live algorithm | ✓ Good — the 2026-09-23 re-architecture deleted ~20k lines and folds all three algorithms live |
| Release 2023–2026 from the SPR holdout (2026-09-14) | Needed to test ALGO-05 on post-design seasons | ⚠️ Revisit — later model acceptances used those seasons, and the home podium does not say they are no longer held out |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-29 after the v1.0 milestone. Validated list rewritten from the shipped site; Sigma1-era decisions marked superseded; budget constraint updated for Workers Paid; Active now holds the audit's carry-overs.*
