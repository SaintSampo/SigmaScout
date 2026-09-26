---
quick_id: 260925-w4y
date: 2026-09-25
description: >-
  Alliance selection readability: the bold line names the likelier route
  (captain or picked), an outcome list in the drawer, exact captain points once
  quals are done
status: complete
owed:
  - "The 1440 screenshot pass over the selection cell (route-chance form and settled form) and the selection drawer was never captured; the recipe and the two fixture positions are recorded under Screenshots below."
---

# Alliance selection readability — summary

Jacob queued this straight after 260925-uf8. The Alliance selection cell printed
`~80% picked / ~12 if picked`, where "picked" silently counted captains too, so the
cell answered a question nobody asked and never said which route the team was on.

All five items ship. Qualification, the status rule, the lock math, the reservation
and the pooled lock are untouched: `measure:ledger-tenets` reports **4,022
positions, 921,658 team-positions, 130,718 Locked displays, 190,854 Locked out,
26,604 slots held back, 213 pooled-only locks, both tenets 0** — identical to
260925-pl6 and to 260925-uf8.

Commits: `252bf644`, `fc423707`, `d219357e`, `57c8db31` (tasks 3 and 4 landed in one
commit; their edits interleave in the same four files).

## 1. The points histogram could never have answered this

**A captain and a first pick earn the SAME points at one alliance number.**
`selectionPoints.ts` measured both as `17 - allianceNumber` over 20,209 corpus
rows, so the selection histogram's bin at 16 holds alliance 1's captain and
alliance 1's first pick together, and no reading of that array can separate them.
`chanceOfAnyPoints` on it is the chance of ANY selection points — captain plus
first pick plus second pick — which is what the cell was printing under the word
"picked". A team that captains in 70 runs of a hundred and is picked in 12 read as
"~82% picked", which is true of nothing a reader would call being picked.

The route was already known inside the draw: it is how `selection[teamI]` gets its
value. It was being thrown away.

`ledgerSimulation.ts` now reports it. Per team, per TBA pick slot (0 captain, 1
first pick, 2 second pick, 3 backup robot): the draw count, the point range those
draws produced, the single alliance number every such draw agreed on, and the range
that slot CAN pay at this event's alliance count — the last read off the module's
own `districtSelectionPoints` table, so no point value is a literal and the dcmp
weight comes from the phase's single weight source. Plus the not-selected count,
and `rankingFixed`.

**No randomness is consumed and no seeded output moved.** The draft is
deterministic given the ranking and the ratings, so this is pure observation: all
97 shipped `ledgerSimulation.test.ts` cases stayed green through the change, and 11
new ones pin the arithmetic — every team's four slots plus not-selected sum to the
draw count exactly, and the three drafted slots' share equals
`chanceOfAnyPoints(selectionPoints)` to twelve places.

**`rankingFixed` is reported rather than inferred**, because it changes what an
absent route MEANS. With no remaining matches every draw shares one finishing
order, so a route no run took is impossible and the alliance number a route landed
on is a fact; with matches still to play the same absence is only "none of these
1,000 runs". `remainingMatches.length === 0` is the module's own expression of a
finished qualification stage, so this is that fact forwarded and not a fifth flag.

**The measured fixture needed replacing for two of the new cases.** The shipped
`inputFor` fixture separates every team by a whole ranking point over ten played
matches, so its order barely budges and every team takes ONE route in every draw —
measured, not assumed: zero teams with two routes. A tight fixture (every team
within one ranking point, two played matches, forty remaining rows) is what
produces a route and an alliance number the runs disagree on.

## 2. The bold line names the likelier route

| what the runs say | bold | small |
|---|---|---|
| captaining is likelier than being picked | `captain ~70%` | `~12 if in` |
| the two picks together beat captaining | `picked ~44%` | `~12 if in` |
| above the shipped 99.5% chance-form threshold | `~12` | `likely 12.0–12.0`, or the settled line below |
| the ranking is fixed and every run agreed | `~12` | `captain, alliance 5` |
| a team no run selected | `picked ~0%` | none |
| the routes are unknown (a baked event) | `~80% picked` | `~12 if picked`, byte for byte as today |

The comparison is captain against PICKED, where picked is the first pick plus the
second pick — the two routes a team reaches by being chosen rather than by ranking
high enough to choose. The larger is the headline and a tie reads as picked, which
is the shipped word. The route goes first, exactly as the Playoffs cell's milestone
does since 260925-uf8.

The small line is the SAME conditional median the shipped cell printed; only its
clause changed, from `if picked` to `if in`, because the bold line no longer covers
both routes. `DISTRICT_LEDGER_CHANCE_WORDS.alliance` is untouched and still ships —
it is what a route-less cell prints — and a test pins it, because changing that
pair would change what a baked cell says without changing what its number means.

**The 99.5% rule is untouched.** Above it the cell keeps the median form, which is
how "once quals are done the eight captains print their exact points" falls out for
free: with the ranking settled a captain is a captain in every draw, the chance is
1, and the distribution is a point mass. What changed is the small line, which used
to read `likely 12.0–12.0` — a percentile range whose two ends are the same number.
It now names the route and the alliance.

**The settled line covers a first pick and a second pick too**, on the same terms
and for the same reason. This goes one step past the item's wording, which named
the captain case; a deterministic first pick printing `likely 15.0–15.0` would have
been left standing for no reason anyone could defend.

**The settled line requires `rankingFixed`.** A cell whose runs unanimously make a
team alliance 1's captain while matches are still to play prints the chance, not the
caption: unanimous runs are still a prediction, and only a settled ranking makes the
draft a statement. That restriction is what earns the line its missing tilde.

## 3. The outcome list in the drawer

Clicking an Alliance selection cell now lists its routes, the way the Playoffs and
Awards cells have since 260925-uf8: captain, first pick, second pick, not selected,
each with its chance and its points. The grand total plot stays beside it.

The points are the range the RUNS produced (a captain at 9 to 16, a second pick at
1 to 8), or a single value where the runs pin it, or — for a route no run took —
the range that route CAN pay, never a fabricated zero. A printed 0 on a captain row
would read as "captaining pays nothing".

**Ruled out means ruled out by the RANKING**, on exactly the terms the playoff list
means ruled out by the bracket. With the ranking fixed the draft is deterministic,
so a route no run took cannot happen and its row is omitted: a settled captain has
exactly one row, a non-captain has no captain row, and an unselected team has only
its own. With matches still to play the same zero stays, so the list's length does
not move with the draws.

**A backup robot is a structural omission**, like a veteran's Rookie All Star row:
the draft this site models fills three slots per alliance and never a fourth, so a
0% backup row would offer a reader an outcome the runs cannot produce. It IS listed
where a supplied alliance set produced one, which is a fact rather than a
prediction.

`districtSelectionUnaccountedMass` is the diagnostic that keeps this honest — the
same instrument `districtOutcomeUnaccountedMass` is for the two lumpy categories.
It is exactly zero across six route shapes including the backup case, so a route
dropped from the list or double counted shows up there rather than as a list that
quietly fails to add to a hundred.

`DistrictOutcomeList` gained one optional `pointsHigh`, so the shipped playoff and
award rows render byte for byte. The points column reads `9 to 16`, never a dash:
a dash between two numbers on this tab means a percentile range and these are not
percentiles. No `±` anywhere.

## 4. The wiring, and what an unstarted event does instead

`districtSimulationProtocol.ts` forwards `DistrictLedgerResult` **unreshaped**, so
there was no message field to add — the only thing that boundary can get wrong is
carrying a value a structured clone drops. The new test asserts equality AFTER a
`structuredClone` in both directions, and checks by hand that the `undefined`
alliance number of an untaken route survives as a KEY, which `toEqual` alone would
not have caught.

**The baked path has no routes, and that is disclosed rather than absorbed.**
`distributionsFromPreSim` decodes pmfs and nothing else, so an unstarted event
cannot say whether a team is likelier to captain an alliance or to be picked onto
one. Its cell keeps today's `~80% picked / ~12 if picked` wording with the pmf's own
chance and keeps its histogram, and the event is named in
`gaps.eventsWithUnknownSelectionRoutes`. A component test renders that path and
asserts both the shipped wording and the shipped plot. **An unstarted event's
Alliance selection cell therefore reads differently from a started one's, on
purpose: the two numbers are different numbers.**

The row layer carries the routes, the distribution's OWN denominator and
`rankingFixed` as one object on the open cell, and a test pins the denominator as
equal to the distribution's — that equality is what makes the list and the headline
shares of one set of runs rather than two things that happen to agree.

## 5. Methodology

One paragraph in `districtLedgerContent.ts`: the cell names the likelier of the two
routes, the points alone cannot separate a captain from a first pick because they
earn the same amount on the same alliance, and a settled ranking prints the exact
points and the alliance. The outcome-list paragraph beside it now names the third
cell that renders one and says the ranking rules rows out as well as the bracket —
a page still describing two lists when three ship is the same drift this repo's
failure log opens with. The voice gate passes: flat third person, no dash
characters, three sentences, no new measured figure to pin.

## Verification

- `npx vitest run` from the repo root: **293 files, 6,728 passed, 1 skipped**.
  The first full run reported one failure — a `waitFor` timeout in the advancement
  chance describe, a file that passed 74/74 on its own immediately before and
  after. The main session committed `cca73281 test(web): the chance tests wait 15 s
  for the mock Worker's joint draw`, which is that same flake.
- `npx tsc --noEmit` at the root and for `apps/web`, `apps/worker` and
  `apps/web/tsconfig.e2e.json`: **all four clean**.
- `npx tsx scripts/measureLedgerTenets.ts`: both tenets **0**, every total
  identical to 260925-pl6.
- New coverage: **11** core ledger-simulation cases, **1** protocol case, **7** row
  cases, **19** outcome cases, **7** copy cases, **7** component cases. One shipped
  component test was narrowed rather than deleted — "keeps the shipped histogram on
  Qualification, Alliance selection and the event total" now names Qualification
  and the event total, with a comment saying why Alliance selection left it and
  where the route-less case is covered instead.
- The component tests needed a **thirty-team** fixture: the shipped 24-team roster
  fills eight three-team alliances EXACTLY, so every team is selected in every draw
  and the cell is pinned in the median form with every route wording hidden behind
  the 99.5% fallback. Six teams have to miss out for the chance form to exist at
  all. On that fixture, quals done gives exactly 8 captains, 8 first picks, 8 second
  picks and 6 teams reading `picked ~0%`.
- No `±` in any new string; colours unchanged (the list reuses `--sim-hist-bar`);
  every existing `data-testid` kept and none added; `package.json` untouched; no
  network beyond localhost; no publish, no deploy; `.env` never read.
- After the push (main session): CI Test and Pages deploy green on `cca73281`, and
  the live `districts-ledger.spec.ts` passed 10/10 against the deployed site.

## Screenshots — NOT TAKEN

**This is the one item of the task that did not land.** The recipe was rebuilt and
the servers were running when the session ended; no shot was captured and there are
no paths to record.

What is established, for whoever picks it up:

- 260925-uf8's doctored fixture tree survived in the executor session's scratchpad
  (`.../04f3ffd4-5db9-4a50-8e61-363d6723b0e6/scratchpad/fixtures`), along with
  `fixtureServer.cjs` and `shoot.mjs`.
- The recipe: `node fixtureServer.cjs ./fixtures 4319`, then `vite build` in
  `apps/web` with `VITE_ARTIFACT_ORIGIN=http://127.0.0.1:4319`, then
  `vite preview --port 4318`. Both were verified by CONTENT and both are now
  stopped (ports 4318 and 4319 refuse connections).
- **`vite preview` will not survive a `(cmd &)` background start from the Bash
  tool** — it logs its banner and is dead by the next call. It stays up when
  started detached through PowerShell `Start-Process` against
  `apps/web/node_modules/.bin/vite.CMD` (NOT `npx`, which fails with "%1 is not a
  valid Win32 application").
- **The two positions the shots need are identified.** The fixture's `2026wayak`
  carries `alliancesPicked:false` with all 54 qualification rows played in its event
  artifact, so at "now" its Alliance selection column is the SETTLED form
  (`~12captain, alliance 3`) and its drawer is the one-row list.
  `?at=2026wayak:m:2026wayak_qm30` rewinds inside those quals, which reopens the
  ranking and gives the route-chance form and the four-row list. `2026wasno` is the
  same shape.
- `apps/web/dist` in this checkout is now a FIXTURE build pointed at
  `http://127.0.0.1:4319`. It is gitignored and cannot reach a deploy, but rebuild
  before any local preview or the page will look broken.

## Notes for a deploy

1. **No artifact shape changed and nothing new is published.** Every number here is
   computed in the visitor's browser from fields already on the wire; the Worker
   result gained two fields that never leave the browser.
2. **No seeded output moved.** The routes consume no randomness, so a published
   baked pmf and a live browser run are the same quantities they were before this
   task.
3. **An unstarted event's Alliance selection cell keeps the old wording** until it
   starts. That is the baked sidecar's own limit, not a bug, and it is disclosed as
   `eventsWithUnknownSelectionRoutes`.
