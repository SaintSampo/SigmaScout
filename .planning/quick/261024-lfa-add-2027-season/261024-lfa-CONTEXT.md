# Quick Task 261024-lfa: Add the 2027 season to the site (events and dropdown only) - Context

**Gathered:** 2026-10-24
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob: "2027 event assignments are out. they might change but lets go ahead and add 2027 to the site
(keep 2026 the default) I want to be able to run simulations and predict locks for 2027."

After the inventory (see `261024-lfa-RESEARCH.md`) Jacob was told that simulations and Locks need
per-season game rules that do not exist until kickoff (January 2027), and chose the narrower scope:

- **2027 ships as events, rosters and the year dropdown only.** No provisional copy of 2026's rules.
  No 2027 RP rule module, no 2027 score-breakdown component map, no 2027 district point model,
  bracket, pay rule or award list. Simulations and Locks for 2027 come in January under a later task.
- **2026 stays the default season** everywhere (year dropdown, URL fallback, Compare).
- **Jacob runs the publish himself.** This task leaves the code committed and ONE documented command
  (or short sequence) ready. Do not start a publish, a Worker deploy or a push from this task.

</domain>

<decisions>
## Implementation Decisions

### Scope of what 2027 shows (decided by Jacob, 2026-10-24)
- Year dropdown lists 2027 above 2026; 2026 remains the default selection and the URL fallback.
- Events page for 2027: every official 2027 event with name, dates, week, district, and a team count
  taken from the registered roster when no matches exist.
- Event page for a 2027 event: name, dates, roster. No ratings, no predictions, no sidecar. Every tab
  that needs the game (Simulation, Locks, standings/predictions) must show an honest, plain-language
  empty state ("The 2027 game is not out yet" style; very plain words, no jargon), never a spinner,
  a crash, or a 404 in the console that the UI treats as an error.
- Teams page for 2027 and Compare for 2027: not required. Whatever renders must be honest and must
  not fetch artifacts that will never exist (Compare must not request a 2027 file). Team pages do not
  list 2027 in their year strip (no matches yet), which is acceptable.

### Hard rules
- **Publish-then-reveal.** `CURRENT_SEASON` moves to 2027 only after the 2027 artifacts are verified
  on the live origin by content. Code may be prepared so that the reveal is a one-line change (or a
  flag), but the committed default in this task must keep the site rendering exactly as today until
  Jacob's publish has landed. Make the reveal step explicit in the handoff.
- **Throw-by-design registries stay strict.** `componentMapForSeason`, `rpRuleModuleForSeason`,
  the district point model and the award slate keep throwing for 2027. The fix is at the call sites
  that reach them for a season with no matches, not a 2027 entry that borrows 2026.
- **The D1 seed must remain the 2026 state.** Live 2026 offseason events run through early November
  and the Worker resumes from the seeded state. Publishing 2027 must not carry algorithm state into
  2027 or re-seed D1 from a 2027 state. A season with no matches and no registered rules gets no
  algorithm replay, no carry, no sidecars and no seed.
- **The Worker must never promote a 2027 event to live folding while 2027 has no RP rule module or
  component map.** 2027 probe windows (Feb to April 2027) are fine to publish only if that guard
  exists and is tested; otherwise leave 2027 out of the live-windows manifest for now.
- **No full rebaseline is required by design if it can be avoided.** Prefer a release recipe that
  writes only 2027 objects plus the manifests that must list them, so Jacob's run is minutes, not
  three hours, and does not freeze live folding. If the artifact layout forces a full run, say so
  plainly in the handoff with the duration and the "no live window open" condition.
- Every season list test that pins by equality gets a deliberate edit; every hardcoded iteration
  list that would silently skip 2027 is converted to the registry-driven shape or given a pin (see
  the iteration-list trap in RESEARCH.md section 5).
- Version bumps only where published numbers change. This task changes no model output, so no
  algorithm version bump is expected. Do not bump versions for layout-only additions.
- Secrets: never render `.env`. Use `tsx --env-file=.env` or `set -a; . ./.env; set +a`.

### Claude's Discretion
- How the "roster-only season" is represented in the publisher (flag, derived from registry absence,
  or both), as long as the behaviour above holds and is tested.
- Whether `event_teams` reconciliation (removing withdrawn teams for future events) is done now or
  recorded as a follow-up todo. Rosters will shift between now and March.
- Exact empty-state copy, subject to the plain-language rule.

</decisions>

<specifics>
## Specific Ideas

- Live facts from The Blue Alliance on 2026-10-24: 216 official 2027 events (61 regionals, 129
  district events, 14 district championships, 10 DCMP divisions), 1 offseason, 1 preseason. Dates
  2027-02-28 to 2027-04-16. No championship or division events yet. 15 districts, including both
  `2027tx` and `2027fit` keys (check how the district key list handles that). District rankings are
  `null`; district team lists exist (`/district/2027fim/teams` has 515 teams). Event rosters are
  partial (21 to 23 teams on sampled regionals; `2027micmp` has 0).
- Live-windows manifest generation `bcbab12f` has 17 offseason probe windows open this weekend and
  six more opening 2026-10-29. Do not schedule anything that freezes live folding.
- Jacob's standing preferences: plain words, short sentences, no task ids in UI copy; decisions in
  AskUserQuestion not prose; "stop leaving work for me to do" (the handoff must be one command and a
  verification, not a checklist of edits).

</specifics>

<canonical_refs>
## Canonical References

- `261024-lfa-RESEARCH.md` in this directory (full registry inventory with file:line).
- `.planning/todos/pending/locks-first-live-2027-watch.md` items 8 and 11 (2027 rules work owed in
  January; out of scope here, do not start it).
- `docs/worker-operations.md` (deploy-before-publish ordering, live gate).
- `docs/publish-budget.md` (budget block is rewritten by `--write-budget`; commit after a run).
- `apps/web/src/lib/seasons.ts` header (publish-then-reveal rule, 2021 permanent exclusion).

</canonical_refs>
