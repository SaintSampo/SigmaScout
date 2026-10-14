---
phase: quick-261014-mii
plan: 01
status: complete
outcome: closed negative, no shipped odds changed
completed: 2026-10-14
commits:
  - 39664d5a
key_decisions:
  - "No district award table change ships: every candidate failed the pre registered bar (A1 Brier and A2 per class gaps)."
  - "Jacob 2026-10-14: one award model for district events and DCMPs, not two. District events move onto the DCMP slate model in a follow up task."
---

# Quick task 261014-mii: district award odds (closed negative)

## What shipped

Only Task 1 (39664d5a): the scorer's snapshot gates (A1 to A5), the frozen review classes, reliability bins, the Impact row audit, and the new definitions as pure additions. No odds on the site changed. Tasks 2 and 3 did not land.

## What was tried

Every candidate was scored walk forward 2023 to 2026 with `pnpm score:award-model`, against the shipped district model (Brier 0.2039, flat guess 0.2444). The pass bar was set before scoring: A1 Brier lower, A2 every frozen review class gap smaller, A3 Impact row equals the Impact draw, A4 and A5 the DCMP gates.

| Candidate | District Brier | A2 | Note |
|---|---|---|---|
| Shipped | 0.2039 | | three or more gap 0.77, rookies 4.75 |
| W+L+F: 3 award season window, 18 district point award types, single highest award fold | 0.1898 | FAIL | three or more under by 6.3 |
| W+L+F+C: plus the residual measured only on team events that won neither Impact nor RAS | 0.1893 | FAIL | rookies over by 7.4 (2025 and 2026), three or more under by 3.4 |
| W+L+F+C+S: plus a declared season award list | 0.1900 | FAIL | every reliability bin under |
| L+F+C: bug fixes alone, no window | 0.2048 | FAIL, and A1 FAIL | every class over |

A3, A4 and A5 passed for every candidate.

## What was learned

- **C is a real bug in the shipped model.** The residual ("won nothing else") is measured over every team event, Impact and RAS winners included, so it double counts "no award" for teams likely to win Impact. Fixing it alone raises every class.
- **Decoration drift is real.** Counting awards back to the corpus start (2016) makes "no prior awards" mean different things in different seasons. A 3 season window fixes the drift but loses real information about long decorated teams.
- **FIRST changes the award list.** Rookie Inspiration (type 15) ended after 2024 and Rising All Star (type 83, 93% to veterans) began in 2025 ([FIRST award updates for 2025](https://community.firstinspires.org/award-updates-for-the-2025-season)). A per team rate learned on earlier seasons overstates 2025 and 2026 rookies about 3x on the residual. Rookies per event did not grow (census refuted that hypothesis).
- **Stacked awards** (two 5 point awards at one district event) happened 168 times, all 2016 to 2020, 158 with the Safety Award. The shipped residual prices them as Impact (525 predicted district Impact wins vs 408 real; the Impact draw alone is 390).
- **Individual awards** (Dean's List, Woodie Flowers, Volunteer, Wildcard) count toward decoration today. The 18 point paying team award types reproduce TBA's award points for all 29,871 district team events with 0 mismatches.

The root cause behind all of it: the district model is a per team rate learned from earlier seasons, which cannot follow changes in the field or in FIRST's award list. The DCMP slate model (261014-i8i: a known count of each award per event, shared among eligible teams by measured lifts) is not exposed to that.

## Saved work (outside the repo)

Patches in `patches/` beside this file: `mii-task2.patch` (W+L+F), `mii-task2b.patch` (+C), `mii-task2c.patch` (+S), `mii-task2d.patch` (L+F+C), plus the rookie and season award censuses. The BEFORE snapshot and score are in this directory.

## Follow ups

- Move district events onto the DCMP slate model, so one model prices both tiers (Jacob, 2026-10-14). Set its pass bar before scoring.
- Methodology copy still describes the per team model; update it with whatever ships.
