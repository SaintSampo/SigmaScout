# API Coverage — The Blue Alliance API v3 + Cloudflare platform bindings

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
>
> Two external surfaces are integrated by Phase 4: **The Blue Alliance API v3**
> (read-only, polled by the cron Worker per D-22, and already wrapped by
> `packages/ingest/tbaClient.ts` since Phase 1) and the **Cloudflare Workers
> platform bindings** (R2, D1, KV, Cron Triggers). Capability ids are prefixed by
> surface so both live in one validated table.
>
> The deterministic detector (`api-coverage.cjs`) returned `detected: false` when
> run against the ROADMAP Phase 4 section + `04-CONTEXT.md` at plan time — the
> trigger vocabulary did not land in that prose. This matrix is authored anyway,
> because the phase demonstrably integrates both surfaces and a matrix authored at
> plan time is cheaper than a blocked seal.

| capability | decision | reason |
|---|---|---|
| tba:status | INTEGRATE | |
| tba:teams-paged | INTEGRATE | |
| tba:team-detail | INTEGRATE | |
| tba:events-list-by-year | INTEGRATE | |
| tba:event-detail | INTEGRATE | |
| tba:event-teams | INTEGRATE | |
| tba:event-matches | INTEGRATE | |
| tba:match-detail | INTEGRATE | |
| tba:etag-conditional-requests | INTEGRATE | |
| tba:request-throttling | INTEGRATE | |
| tba:event-rankings | OPT-OUT | not needed — SigmaScout derives ranking-point standings from its own corpus RP fields; consuming TBA's precomputed ranking table would put two ranking definitions under one name. Revisit in Phase 7 if the Event page needs the official table verbatim. |
| tba:event-alliances | OPT-OUT | not needed yet — elimination alliance selection is not modeled in v1; Phase 8's rank simulation is quals-only. |
| tba:event-oprs | OPT-OUT | explicitly out of scope — TBA's own OPR is an external-validation channel, and `WINDOWS.md` #1/#2 place external validation in Phase 8, not here. |
| tba:event-predictions | OPT-OUT | explicitly out of scope — SigmaScout publishes its own predictions; ingesting TBA's would make provenance ambiguous on exactly the pages this phase exists to feed. |
| tba:event-district-points | OPT-OUT | not needed — district points are not part of the v1 page set (`teams`, `team`, `events`, `event`, `compare`). |
| tba:district-list-and-rankings | OPT-OUT | not needed — same reason; no district page exists in v1. |
| tba:awards | OPT-OUT | not needed — no awards surface in the v1 spec. |
| tba:media | OPT-OUT | not needed — no media surface in v1; page-load speed is the stated top UX priority and media payloads work against it. |
| tba:team-years-participated | OPT-OUT | not needed — the published corpus already knows which seasons a team appears in, from its own match rows. |
| tba:zebra-motionworks | OPT-OUT | not needed — tracking data is not an input to any shipped algorithm (OPR, EPA, Sigma1). |
| tba:trusted-write-api | OPT-OUT | explicitly out of scope — SigmaScout is strictly read-only against TBA; write access would require event-owner credentials it neither has nor wants. |
| tba:webhooks | OPT-OUT | not needed yet — D-17/D-18 chose scheduled polling with an offline-published live-windows manifest; a webhook receiver would need a public HTTP endpoint and event-owner registration. Revisit only against a measured freshness shortfall. |
| cloudflare-r2:put-object | INTEGRATE | |
| cloudflare-r2:get-object | INTEGRATE | |
| cloudflare-r2:http-metadata-cache-control | INTEGRATE | |
| cloudflare-r2:custom-domain-read | INTEGRATE | |
| cloudflare-r2:list-objects | OPT-OUT | not needed — every read path in this phase addresses a known, precomputed key (D-01); listing is a Class-A op with no consumer. |
| cloudflare-r2:multipart-upload | OPT-OUT | not needed — the largest published artifact is the year-wide teams table, far under the single-PUT ceiling. |
| cloudflare-r2:conditional-onlyif | OPT-OUT | not needed yet — D-04 overwrites artifacts in place at stable paths with a `generation` stamp inside; there is no compare-and-set requirement on artifact writes. |
| cloudflare-d1:prepare-bind-all | INTEGRATE | |
| cloudflare-d1:batch | INTEGRATE | |
| cloudflare-d1:migrations-apply | INTEGRATE | |
| cloudflare-d1:execute-file-import | INTEGRATE | |
| cloudflare-d1:time-travel-restore | OPT-OUT | not needed — live state is re-derivable at any moment from the offline-published snapshot (D-12), which is a stronger recovery story than point-in-time restore. |
| cloudflare-kv:get | INTEGRATE | |
| cloudflare-kv:put | INTEGRATE | |
| cloudflare-kv:list | OPT-OUT | not needed — KV holds a handful of named manifest pointers (D-18); nothing enumerates them. |
| cloudflare-workers:scheduled-handler | INTEGRATE | |
| cloudflare-workers:cron-triggers | INTEGRATE | |
| cloudflare-workers:fetch-handler | OPT-OUT | explicitly out of scope — D-25 puts no compute in the read path; a thin read Worker is a recorded Deferred Idea, added only against a measured need. |
| cloudflare-workers:secrets | INTEGRATE | |
| cloudflare-workers:durable-objects | OPT-OUT | not needed — evaluated in `04-RESEARCH.md` § Alternatives Considered and rejected for v1: D1's batched multi-row API already meets D-13's per-team-granular-read requirement without actor-model addressing. Documented as the fallback if D1's per-invocation query ceiling proves insufficient. |
| cloudflare-workers:queues | OPT-OUT | not needed — deferral under subrequest pressure is handled by D-15's in-tick rotation and the next cron tick, not by an external queue. |
| cloudflare-workers:tail-workers | OPT-OUT | not needed — D-21's CPU and subrequest figures are read from Workers Observability's built-in invocation reporting, which requires no custom tail consumer. |
