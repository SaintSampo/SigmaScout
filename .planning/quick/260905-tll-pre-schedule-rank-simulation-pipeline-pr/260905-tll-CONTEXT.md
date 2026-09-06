# Quick Task 260905-tll: Pre-schedule rank simulation - Context

**Gathered:** 2026-09-05
**Status:** Ready for planning

<domain>
## Task Boundary

Pre-schedule rank simulation: the pipeline prices K synthetic qual schedules for each event
with the exact Sigma1/VPR RP model and publishes them (plus a baked default simulation
result) as a sidecar to the event artifact. The event page's Simulation tab shows the baked
pre-schedule result as its default view, gains a "Before schedule release" slider stop, and
its run button becomes "Update simulation". Scheduleless events get a full event page for
the first time (roster from the corpus `event_teams` table).

</domain>

<decisions>
## Implementation Decisions

### Product reframe (user-specified, locked)
- The baked pre-schedule simulation result is **the default view of the Simulation tab for
  every covered event, always** — including events with schedules, live events, and
  completed events. First paint requires zero client compute.
- The slider's leftmost stop is **"Before schedule release"** (before the Qual 1 stop).
  Selecting it and hitting the button re-displays the baked result — the client engine does
  NOT run for this stop.
- All other slider stops (Qual 1 … Qual N) run the existing client-side engine on demand.
  The button label changes from "Run simulation" to **"Update simulation"**.

### Pricing home (user-decided earlier this session)
- All match pricing happens pipeline-side with the exact joint-covariance RP model.
  Phase 7 D-11 ("combined figures are computed where the covariance lives, never
  client-side") remains fully respected. No Statbotics-style browser approximation.

### Coverage
- **Current season (2026) onward now; architecture must support backfilling all seasons
  later** (user: "eventually I want all seasons"). Do not hardcode the season cutoff deep in
  the pipeline — make it a parameter.
- Sidecars for events that already have schedules/results (e.g. the completed 2026 season)
  are priced with **walk-forward pre-event state** (state as of just before the event's
  first qual match), not current state — consistent with the project's walk-forward
  methodology constraint.
- For events with no schedule yet, price with current (latest) state; regenerate on each
  full publish while no real schedule exists; **freeze the sidecar once the real schedule
  lands in the corpus** (it becomes the honest "what we knew before schedule release"
  snapshot).

### Sidecar contents
- K = 20 synthetic schedules, each: match list of {red trio, blue trio, redRpPmf, blueRpPmf}
  in the same pmf encoding real matches already use.
- Plus the **baked default result**: the precomputed rank distribution per team (the same
  shape the client engine outputs), so the tab renders instantly with no client compute.
- Lazy-loaded: fetched when the Simulation tab opens, not with the main event artifact.

### Schedule templates (Claude's discretion, announced to user; REVISED after research)
- RESEARCH CORRECTION: the cheesy-arena license is NOT MIT and does not permit
  redistribution in a public repo. Do NOT vendor the CSVs into git. Instead: runtime
  fetch-with-cache into the gitignored `data/schedule-templates/` directory (covered by the
  existing `data/*` gitignore rule), Statbotics-style. The orchestrator has already
  downloaded all 1,330 templates and will populate the cache locally — executors need no
  network. Pipeline code must fail loudly with a "run the fetch script" message if a needed
  template is missing from the cache.
- Matches-per-team: use the actual value when the real schedule is known (historical
  backfill); otherwise 12 (10 for championship divisions) — the Statbotics convention.
  NOTE: cheesy-arena's own convention is truncation, `int(6 * qualMatches / teams)`, not
  rounding — match cheesy-arena.
- Team counts without an exact template: use the nearest template / split trick (Statbotics
  splits >100-team fields into two blocks).
- Per-simulated-schedule team-to-slot assignment is a seeded shuffle (deterministic
  republishes).

### Scheduleless event pages
- Full pre-schedule page: once TBA lists registered teams (corpus `event_teams`), publish an
  event artifact with roster + as-of-now team metrics, live Simulation tab (baked default),
  and "schedule not yet released" empty states on the other tabs.
- RESEARCH FINDING (discretion, announced to user): `event_teams` is currently populated
  only for district events (150/310 of 2026; ingest fetch sits inside the --districts-only
  loop at packages/ingest/cli.ts:736). Widen the ingest to fetch registered teams for ALL
  events so the pre-schedule page deliverable is not district-only.
- publish.ts today skips events with zero predictions and zero upcoming matches and derives
  rosters only from match rosters; both change. The single-event mode's "No completed
  matches" throw also needs the scheduleless branch.

### Worker (live cron) — explicitly out of scope for compute
- The Worker never generates or regenerates sidecars and never runs simulations (10ms CPU
  budget; Phase 7 incident). It must simply not clobber or delete existing sidecars when it
  republishes event artifacts during live events.

### Claude's Discretion
- Sidecar artifact key naming/versioning, Zod schema shape, and byte-format details (follow
  existing positional-encoding conventions in pageArtifacts.ts).
- Exact draw split for the baked result (e.g. 1000 draws spread 50 per schedule).
- UI copy for pre-schedule states, subject to sketch-findings-sigmascout rules (load that
  skill for any UI work).
- Client draw counts when "Update simulation" runs from a qual-match stop (unchanged
  behavior).

</decisions>

<specifics>
## Specific Ideas

- Statbotics is the direct reference implementation for the product shape: slider min = -1
  rendered as "Before Schedule Release", schedule templates fetched per (teams, matches)
  from cheesy-arena, team-to-slot shuffle per draw. See their
  frontend/src/pagesContent/event/[event_id]/{simulation.tsx,worker.ts}. We differ by
  pricing with the exact model pipeline-side (K=20 priced schedules) instead of an
  independence approximation in the browser.
- User quote defining button behavior: "if they set the slider back to pre-schedule and hit
  update, then the site just pulls up the baked result again."

</specifics>

<canonical_refs>
## Canonical References

- .planning/phases/07-event-pages/ D-11 (combined figures computed where covariance lives)
- .planning/phases/08-simulation-compare/08-CONTEXT.md D-01 (byte budget; sidecar was the
  recorded runner-up)
- docs/models/rewind-overconfidence-gap.md (existing rewind-honesty caveat; pre-schedule
  sidecars priced with walk-forward pre-event state avoid the analogous gap for historical
  events)
- https://github.com/Team254/cheesy-arena (schedules/ CSV templates, MIT)
- https://github.com/avgupta456/statbotics (reference UX)

</canonical_refs>
