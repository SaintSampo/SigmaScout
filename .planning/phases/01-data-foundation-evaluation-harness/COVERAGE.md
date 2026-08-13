# API Coverage — The Blue Alliance API v3 + Statbotics

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Detector fired on Phase 1 scope (`TBA API v3 ingestion`). Two external services are in scope:
> TBA v3 (read-only, the corpus source) and Statbotics (read-only, the D-04 reference row).

## The Blue Alliance API v3 (read)

| capability | decision | reason |
|---|---|---|
| status (`GET /status`) | INTEGRATE | |
| teams-list (`GET /teams/{year}/{page}`) | INTEGRATE | |
| team-detail (`GET /team/{key}`) | INTEGRATE | |
| events-list (`GET /events/{year}`) | INTEGRATE | |
| event-detail (`GET /event/{key}`) | INTEGRATE | |
| event-teams (`GET /event/{key}/teams`) | INTEGRATE | |
| event-matches (`GET /event/{key}/matches`) | INTEGRATE | |
| match-detail (`GET /match/{key}`) | INTEGRATE | |
| team-events (`GET /team/{key}/events/{year}`) | OPT-OUT | redundant — the same team↔event edges are already derived from event-teams; a second fetch path costs TBA requests for zero new data |
| team-matches (`GET /team/{key}/matches/{year}`) | OPT-OUT | redundant — every match is already ingested via event-matches; per-team refetch would multiply request volume against a volunteer-run free service |
| team-media (`GET /team/{key}/media/{year}`) | OPT-OUT | not needed yet — robot images are TEAM-02, scoped to Phase 6 |
| team-social-media | OPT-OUT | explicitly out of scope — no v1 requirement references social links |
| team-awards | OPT-OUT | explicitly out of scope — no v1 requirement references awards |
| team-years-participated | OPT-OUT | redundant — derivable from the ingested corpus |
| team-robots | OPT-OUT | explicitly out of scope — no v1 requirement references robot names |
| team-districts | OPT-OUT | redundant — district membership rides on the event object already ingested |
| event-rankings | OPT-OUT | not needed yet — actual rank is only compared against in EVNT-07 rank simulation, Phase 8 |
| event-alliances | OPT-OUT | not needed yet — alliance selection is EVNT-05, Phase 7 |
| event-awards | OPT-OUT | explicitly out of scope — no v1 requirement references awards |
| event-oprs (TBA's own OPR) | OPT-OUT | deliberately excluded — ALGO-01 requires OUR walk-forward OPR; TBA's is a batch end-of-event value whose use as a feature would leak outcomes into a walk-forward run |
| event-predictions / event-insights | OPT-OUT | deliberately excluded — TBA's own predictions would contaminate an independent baseline the harness is meant to score honestly |
| event-district-points | OPT-OUT | explicitly out of scope — no v1 requirement references district points |
| match-zebra (Zebra MotionWorks) | OPT-OUT | explicitly out of scope — sparse historical coverage, no v1 requirement |
| districts-list / district-events / district-rankings | OPT-OUT | not needed yet — district filtering is EVNT-01, Phase 5, and the district key rides on the event object |
| webhooks / trusted (write) API | OPT-OUT | explicitly out of scope — this is a read-only pipeline; no write scope is requested or needed |

## Statbotics (read)

| capability | decision | reason |
|---|---|---|
| year-summary (per-season EPA accuracy: `epa_acc` / `epa_mse`) | INTEGRATE | |
| team / team-year endpoints | OPT-OUT | deliberately excluded — D-04 needs only the per-season reference row; pulling team-level Statbotics values risks our metrics being derived from theirs instead of independently computed (clean-slate + independent-baseline mandate) |
| event / match endpoints | OPT-OUT | deliberately excluded — same independence reason as team endpoints |

---
*Produced at plan time for Phase 1. Validated at `verify:pre` by `api-coverage.verify-pre`.*
