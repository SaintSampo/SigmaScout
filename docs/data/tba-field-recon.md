# TBA / Statbotics Field Reconnaissance

**Generated:** 2026-08-13T04:01:26.393Z
**Produced by:** `scripts/recon-tba-fields.ts` (`pnpm recon:tba`) — answers RESEARCH.md Open Questions 1 and 2 for Plans 03 and 05.

## Question 1: Per-match ranking-point field in `score_breakdown` (2022-2026)

RESEARCH.md observed `tba_rpEarned` for 2016/2017 but could not confirm coverage for 2022-2026. Below: one sampled qualification match per season, checking for a computed per-match RP total field under either the legacy name `tba_rpEarned` or the current name `rp`.

| Season | Event | Match | Computed RP field present | Field name | Notes |
|---|---|---|---|---|---|
| 2022 | 2022flwp | 2022flwp_qm1 | YES | rp | Found computed RP total field "rp" among 40 top-level score_breakdown.red keys (value observed: red=2). |
| 2023 | 2023isde1 | 2023isde1_qm1 | YES | rp | Found computed RP total field "rp" among 37 top-level score_breakdown.red keys (value observed: red=2). |
| 2024 | 2024isde1 | 2024isde1_qm1 | YES | rp | Found computed RP total field "rp" among 52 top-level score_breakdown.red keys (value observed: red=0). |
| 2025 | 2025isde1 | 2025isde1_qm1 | YES | rp | Found computed RP total field "rp" among 33 top-level score_breakdown.red keys (value observed: red=5). |
| 2026 | 2026tuis | 2026tuis_qm1 | YES | rp | Found computed RP total field "rp" among 23 top-level score_breakdown.red keys (value observed: red=3). |

**What Plans 03 and 05 must do with this:** A computed per-match RP total field is present for every sampled season 2022-2026 — named `rp` in every sampled 2022-2026 season observed here (TBA's legacy `tba_rpEarned` name was not seen in this sample; `rp` is the current equivalent). Plan 03 can normalize RP awards as a direct field read from `score_breakdown.{color}.rp` (falling back to `tba_rpEarned` if a future season reverts to that name), no season-specific bonus-rule logic required in Phase 1.

## Question 2: Statbotics per-season accuracy endpoint

URL shapes attempted (against a representative year) and observed HTTP status:

| URL | Status |
|---|---|
| `https://api.statbotics.io/v3/year/2024` | 500 |
| `https://api.statbotics.io/v2/year/2024` | 404 |
| `https://api.statbotics.io/v3/years/2024` | 404 |

**Resolution failed** after 3 shape attempts — none returned a body containing an EPA-like field.

**What Plan 05 must do with this:** D-04's reference row must use a dated, manually-sourced constant instead of a live fetch. Constant capture date to use: 2026-08-13 (the date this recon was run) — source the actual published per-season Statbotics accuracy numbers manually and cite that date in the report.
