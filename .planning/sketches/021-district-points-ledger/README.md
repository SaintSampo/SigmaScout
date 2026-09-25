---
sketch: 021
name: district-points-ledger
question: "The Road to District Champs page has two jobs: show the district points a team has earned and predict the ones still open, per event and per category, with a slider that rewinds the district to any point in the season. Should that be a ledger table, team cards, or a table with the histograms drawn in the cells?"
winner: null
tags: [districts, locks, district-points, histograms, simulation, slider, awards]
---

# Sketch 021: District points ledger

## Design Question

Sketch 020 went four rounds on "is my team in, and how likely" and stalled on a quantity the
pipeline does not publish (an advancement chance). Jacob reframed the page on 2026-09-25: it has
two jobs, show the district points already earned and predict the ones still to come. Points come
from four sources per event (qualification rank, alliance selection, playoffs, awards), every team
has two district events, so a team is eight cells. Finished cells are grey and carry the earned
number. Open cells are blue, carry the 10th to 90th percentile, and open a histogram when clicked.
An event total and a grand total sit beside them. The page also carries the shipped status
(Prequalified, Locked, In range, Out of range, Ineligible) and a slider that rewinds the district
the way the Simulation tab rewinds an event: to any match, and across alliance selection, playoffs
and awards.

## How to View

open .planning/sketches/021-district-points-ledger/index.html

Also published as an artifact: https://claude.ai/artifact/9yjeRCMN13tD8XbmQBMKzZ

Drag "Rewind to" or use the jump buttons. The sketch default is the end of week 2 (six of eight
events final, two upcoming), so both greys and blues are on screen. Click any blue cell.

## Variants

- **A: Ledger table** — Jacob's spreadsheet made real. Two rows per team (one per event), four
  category cells, an event total, a grand total spanning both rows, a status chip. Blue cells open
  a drawer under the team with that cell's histogram beside the grand total histogram. Sticky first
  column, horizontal scroll inside the card at phone width (the shipped table pattern).
- **B: Team cards** — the same eight cells as small chips, but each event is a bar on one 0 to 83
  scale: solid grey for points earned, a blue band from the 10th to the 90th percentile of the
  event total, a tick at the median, a thin rail out to the event ceiling. The grand total bar
  carries today's line. Stacks to one column on a phone with no sideways scroll. The histogram
  opens inside the card.
- **C: Histograms in the cell** — A with the click removed for the overview. Every open cell draws
  its histogram inline on that column's fixed scale (0 to 22, 0 to 16, 0 to 30, 0 to 15, 0 to 83),
  band under the bars, range printed beneath. Click still enlarges. Costs row height and needs the
  column header to carry the scale, which it does.

All three share: the slider, the five status chips as filters with live counts, the earned/open
cell key, and the grey/blue rule (grey = a single earned number, blue = a printed range plus a
click affordance, so the two never rely on hue alone).

## The slider

Positions are week by stage: for each of weeks 0 to 3, quals at a quarter, half, three quarters,
done, then alliance selection, playoffs, awards. Both events of a weekend move together in the
sketch. The real page should step by match across the district's interleaved timeline, exactly as
the Simulation tab does within one event; the week granularity here is only so the sketch stays
small. Rewinding a finished event turns its later categories blue again, and recomputes the
status with the shipped locks rule: floor = earned, ceiling = earned plus every open category's
ceiling (22, 16, 30, 15), 50 slots, an Impact winner consuming a slot only when it would not
qualify on points anyway. At "Now" the sketch reproduces the artifact's 50 locked and 76 out of
range.

## Data

Real `v1/district/2026pnw.json` (generation 2026-09-14), all eight district events played. Every
grey number is TBA's. **Every blue range is a sketch simulation, not a published quantity**: a
strength-shaped guess per category (a normal on the qual scale that tightens as quals are played,
a pick probability times a normal for selection, a five-point playoff pmf, and award base rates
taken from this district's own actual award point distribution, 56% none / 37% five / 3% eight /
3% ten), convolved into the event total and again into the grand total. The real implementation
draws the four categories jointly (see Feasibility), which the sketch does not.

Prequalified and Ineligible show zero teams. The district artifact carries no `ineligible` status
today and the district tier has no prequalified teams; both chips are on the page so the vocabulary
is complete, and the README below names what the data would need.

## Feasibility: a histogram for every category

Short answer: yes for all four, and three of the four fall out of one joint Monte Carlo draw the
browser already knows how to run. Awards need a small published lookup, not a model.

**Qualification points.** Already there. The rank simulation gives a per-team rank histogram
(`simulateRanks`, baked in the presim sidecar for unplayed events, run in the browser Web Worker
for events in progress). Qual points are a fixed function of rank and field size (the district
point model's inverse error function formula, capped at 22), so the qual pmf is the rank histogram
pushed through that function. Zero new modelling.

**Alliance selection.** Simulate inside the same draw. Each run already yields a full ranking.
Captains are the top eight by that ranking; picks follow a selection model. The simplest honest one
is greedy by SPR with declines ignored, which can be measured against `event_alliances` in the
corpus (how often the pick order follows SPR rank) before it ships. Points are the manual's table:
17 minus the alliance number for the captain and first pick, 9 minus the alliance number for the
second pick, so the selection pmf lives on 0 and 1 to 16. Per run it is a handful of array
operations.

**Playoffs.** Simulate the double elimination bracket inside the same draw from the selected
alliances. SPR prices any three-robot alliance against any other in the browser today (the
embedded state block that prices upcoming matches). Thirteen matches per run, each a win
probability from two alliance means and variances. Points are per bracket exit (0, 7, 13, 20,
30), so the pmf has five bins.

**Why one joint draw.** The three on-field categories are strongly coupled: a team that ranks
first is a captain, captains face weaker opponents early, and so on. Three independent pmfs
convolved together overstate the spread and put mass on impossible combinations (rank 20 with a
first-pick 16). One run produces (qual, selection, playoff) together, the event total is that sum,
and the histogram of each category is the marginal of the same runs. Cost per run is dominated by
the rank simulation the site already pays for; selection and a 13-match bracket add a few
microseconds. 1,000 runs stays well under a second in a Web Worker.

**Awards.** The methodology page's finding is the constraint: the best predictor is a sort, not a
fit, and it emits no probability. The suggestion is to publish a calibration table for the sort,
not a model. Concretely:

- For Impact (10 points, and it locks the team), the corpus already gives "how often the top pick
  wins" by list position: 24.5% top pick, 51.1% top 3, 84.9% top 10 for the most decorated team
  present. Turn that into a walk-forward table of P(win | position in the most-decorated ordering,
  field size), roughly ten bins. A team's Impact probability is a lookup on its position at that
  event.
- For Rookie All Star (8 points), the same table over the most-decorated-rookie ordering, which is
  the one award where the sort is strong (62.8% top pick on berth-deciding cases).
- For Engineering Inspiration (8 points), the sort is weak (21.3% top 3 against 11.7% random), so
  use the base rate by decoration bucket only.
- For every other judged award (5 points each), a base rate by decoration bucket (none, one or
  two, three or more prior judged awards) measured walk-forward per season.

The award pmf per team per event is then a small mixture over 0, 5, 8, 10, 13, 15 and above from
those four independent draws. It is calibrated by construction because every entry is an observed
frequency, it never names a winner, and it never feeds the `locks.ts` guarantee (the award probe's
standing rule). The tables are a few hundred numbers per season and can ride on the districts index
artifact. Until they exist, the honest fallback is the district's own actual award point
distribution, which is what the sketch draws.

**Event and grand totals.** The event total is the per-run sum, so its histogram comes free. The
grand total is the convolution of two event totals plus rookie bonus, which is exact because a
team's two events share no matches. An advancement chance (sketch 020's missing number) needs the
line's own distribution, which needs every event in the district simulated in the same run set. It
is reachable from this design but is a second step, not part of this page's two jobs.

## Where the work runs: browser, pipeline, or the Cloudflare Worker

- **Pipeline (offline, publish time):** the award calibration tables per season, the selection
  model's measured parameters, and baked per-team pmfs for events that have not started (the presim
  sidecar already bakes rank histograms per team; adding selection, playoff and award marginals
  is about 60 numbers per team per event, byte-small). The district page's first paint is then zero
  compute for every unstarted event.
- **Browser (Web Worker, on demand):** everything for an event in progress, and every slider move.
  The event page already runs the rank simulation this way from the event artifact plus the
  embedded SPR state block, and the district page loads that event artifact lazily. A district has
  at most two or three events live on a weekend, so at most three event artifacts and three
  simulations per view. The slider rewinds by re-running with a different start match, as the
  Simulation tab does today; rewinding into alliance selection or playoffs just drops those actuals
  and lets the joint draw produce them.
- **Cloudflare Worker (the tick):** nothing new. The tick folds match results and republishes the
  event artifact; it does not simulate, and it should not start. Per-tick simulation for every
  live district would burn CPU on a schedule nobody is looking at, while the browser only pays when
  someone opens the page. Workers Paid removed the budget argument but not the freshness one: a
  browser simulation from the latest artifact is always at least as fresh as anything the tick
  could have baked.

The one open data question is the district artifact itself: today it lists each team's two
events but nothing about their state. The page needs, per event, the played match count, whether
alliances are picked, whether playoffs are done, and whether awards are posted, so it knows which
cells are grey. Those four booleans per event belong on the district artifact (the Worker already
knows them at fold time).

## Language rules the sketch follows

- The five statuses are Jacob's words: Prequalified, Locked, In range, Out of range, Ineligible.
  "Locked · award" when an award is the reason. The data status `eliminated` is never printed.
- A range is written out, "10th–90th: 11.8–21.0", one decimal, never with a ± (sketch 005).
- Green means locked, purple means prequalified, blue means still open and clickable, grey means
  earned and final. No red anywhere.

## What to Look For

- Does the grey/blue split read at a glance, or does the eye need the range text to tell them
  apart? The two cells differ in fill, in content (a number vs a range) and in affordance.
- In A, is the drawer under the team the right place for the histogram, or should it be a side
  panel that stays put while you click across cells?
- In B, do the four chips under the bar earn their place, or is the bar alone enough with a click
  to expand?
- In C, is the row height worth it? On a 126 team district this is a long page.
- Drag the slider into week 3 quals and watch the Qualification cell tighten. Then rewind to
  "Wk 2 alliances" and check that Sammamish and SunDome playoffs and awards turn blue.
