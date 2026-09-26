---
sketch: 022
name: champ-locks-ledger
question: "The Champ Locks tab is still the old ranked table with a status chip. Sketch 021's ledger just shipped next to it with a quarter of a day's refinements. What does the Champ Locks tab look like as the same ledger, with District points and DCMP points as the two rows per team instead of event one and event two?"
winner: null
tags: [districts, locks, champ-locks, dcmp, district-points, histograms, simulation, slider, awards]
---

# Sketch 022: Champ Locks ledger

## Design Question

Jacob, 2026-09-25: "the district locks tab just got a huge makeover. mockup a champs lock tab that
copies all the improvements. the main change needed is instead of a team having event 1 and event
two, each team should have the two rows: Districts Points, and DCMP Points."

The Road to District Champs tab shipped as the sketch 021 ledger and then took thirteen quick tasks
of refinement in one day. The Champ Locks tab beside it is still the pre-Phase-10 table: rank, team,
current points, max attainable, status, sent by, points still needed, with per-event columns behind a
toggle. This sketch rebuilds it as the same ledger, so a reader who has learned one tab has learned
both, and answers the one structural question: what are the two rows when the tier above has one
event instead of two?

## How to View

open .planning/sketches/022-champ-locks-ledger/index.html

Also published as an artifact: https://claude.ai/artifact/AojyCVpKQDkU1AN7fGcoRJ

The sketch default is "DCMP quals done" (position 32 of 35): every District points row is grey and
final, the DCMP Qualification cells are grey, and DCMP Alliance selection, Playoffs and Awards are
blue. Drag "Rewind to" back into the district season to see the District points row turn blue and the
DCMP row turn conditional. Click any blue cell.

## Variants

Both variants are the same table. They differ only in how the DCMP row reads while a team's place in
the District Championship field is still open.

- **A: DCMP row conditional** — the row label carries the one chance ("~62% to be there") and the
  four cells print what the team would earn *if there*. Only the grand total folds the chance in. A
  reader can add the Subtotal cells toward the grand total and understand why they do not quite reach
  it, because the label says so once.
- **B: DCMP row folded** — every DCMP cell already includes the chance of not being there, so
  "~28% award" means the award and the trip both. Each cell is honest alone, but the "if there"
  amounts disappear and a team on the DCMP bubble reads as weak at everything.

Once the DCMP has started the two variants are identical: the field is a fact, a team outside it gets
an em dash in every DCMP cell and "not in the field" under the row label, and its grand total is its
district points.

## What the sketch copies from the shipped ledger

Everything the Road to District Champs tab gained between sketch 021 and the end of 2026-09-25,
by quick task where one owns it:

- **Column order** Team, Status, Grand total, then the row label, its Subtotal, then the four
  categories (260925-mju). The grand total spans both rows beside the status.
- **Sort by the median predicted grand total**, with that position as the `#` in the team meta line.
- **Cell forms** from `pointSummary.ts`: a bold `~median` with `likely a–b` beneath for Qualification
  and the totals; a chance with a conditional amount for the lumpy three. Every blue figure carries the
  tilde. No plus-minus anywhere.
- **The playoff headline** reads `top 4 ~66%` / `~39 if top 4` (260925-uf8). The DCMP threshold is
  21 points, the district row's is 7.
- **The alliance selection route** names the likelier route first, `captain ~70%` or `picked ~44%`,
  with `~27 if in` beneath (260925-w4y).
- **Outcome lists in the drawer** for the DCMP Alliance selection, Playoffs and Awards cells, on
  the shipped labels (Wins the event, Finalist, Third place, Fourth place; Impact, Rookie All Star,
  One judged award, No award; Captain, First pick, Second pick, Not selected), each with the thin
  64px mark. A veteran's Rookie All Star row is omitted. Never a stacked award (260925-uf8).
- **The grand total drawer** draws its plot once, with Today's line dashed on it, and puts a
  contribution list beside it instead of a second copy of the same histogram (260925-uf8). Here the
  list has two rows, District points and DCMP points, and the DCMP row shows the chance it is
  weighted by.
- **The chance line** under In range and Out of range chips only, `62% chance`, never above 99,
  `<5% chance` below the floor (260925-rpj). Locked and Locked out never carry a number.
- **Status chips as filters** with district-wide counts, the definitions row, the cell key with the
  likely/tilde explainer, verbatim from `districtLedgerCopy.ts`.
- **The rewind slider**: thumb follows the hand, one commit after a 160 ms pause, jump chips, tick
  rail with every week and a second row for a label that would overprint (260925-m7e).
- **One-based weeks**, "Wk 1" not "wk 0" (260925-opv). Short event names.
- **Hairline rules only**: a solid line between teams, a dashed line between a team's two rows.
- **The caveat and the provenance sentence** as one paragraph under the controls card.
- **Locked · award** for a judged award. This sketch adds **Locked · winner** for the DCMP winning
  alliance, which also qualifies for the FIRST Championship and which the district tier never has.

## The two rows

**District points** sums the team's two district events per category, so Qualification runs 0 to
44, Alliance selection 0 to 32, Playoffs 0 to 60, Awards 0 to 30, Subtotal 0 to 166. The row's small
line names both events with their week and stage ("Bonney Lake Wk 1 · final"). A cell is grey only
when that category is final at both events; otherwise it is the convolution of one earned value and
one prediction, or two predictions. This is the same information the Road to District Champs tab
holds per event, collapsed to one row.

**DCMP points** is the District Championship's four categories at the 3x weight: Qualification 0 to
66, Alliance selection 0 to 48, Playoffs 0, 21, 39, 60, 90, Awards 0, 15, 24, 30, 45, Subtotal 0 to
249. The row's small line is the DCMP stage, or the chance of being in the field (A), or "not in the
field".

The grand total runs 0 to 425 (166 + 249 + a 10 point rookie bonus).

## Statuses at the FIRST Championship tier

The five words and the definitions are the shipped ones. The rule is `locks.ts` with the artifact's
`cmpSlots` (21 for PNW 2026): every award-qualified team leaves the points pool and consumes one
slot; a team is Locked when fewer than the remaining slots' worth of pool teams can still reach its
floor; Locked out when at least that many pool teams sit above its ceiling; In range or Out of range
by its rank under the median projection. At "Now" the sketch reproduces the artifact exactly: 12
Locked on points, 8 Locked by award (3 winner, 5 award), 104 Locked out, the two teams tied at 182
split In range / Out of range, and Today's line reads 182, the artifact's own `cmpCutLinePoints`.

Award-qualified at this tier means the DCMP winning alliance once playoffs are done, and Impact,
Engineering Inspiration or Rookie All Star at the DCMP once awards are posted. A district-event Impact
win qualifies a team for the DCMP, not the Championship, so it does not lock anyone here.

## Data

Real `data/fixtures/phase10/district-2026pnw.json` (generation 2026-09-14): eight district events and
the District Championship all played, 126 teams, 51 in the DCMP field. Every grey number is TBA's.
**Every blue figure is a sketch simulation, not a published quantity**: sketch 021's strength shaped
guess per category, and for the DCMP the same shapes on a strength read from the team's rank inside
the field, at the 3x weight, convolved. The chance of being in the field before the DCMP starts is the
share of the team's district grand total above the projected fiftieth team, a stand in for the shipped
advancement chance. The real implementation reuses the shipped joint draw for every open district
event and runs it once more on the DCMP field, conditioned on who made it.

## Feasibility

Almost everything here is the shipped machinery pointed at one more event. The District points row is
the shipped per-event ledger summed per category, which is a convolution of distributions the tab
already holds. The DCMP row is `simulateDistrictEvent` on the DCMP event artifact with
`maxEventPoints(season, "dcmp")` for the ceilings, which `pointModel.ts` already publishes. Once the
DCMP has started that is the whole story. Before it starts there are two real pieces of work:

1. **Who is in the field.** The shipped advancement chance (260925-rpj) already ranks every team's
   district grand total against every other's in the Worker. Its per-run output says which fifty
   teams made it in each run; today only the marginal per team is kept.
2. **The DCMP field's own strength.** Before the DCMP starts, a team's DCMP prediction depends on who
   else is there. The honest version runs the DCMP draw per district run on that run's field. The
   cheap version, which this sketch draws, uses the median field. The difference is small for teams
   near the top and matters most for exactly the bubble teams variant A is designed around.

Nothing in this tab feeds the `locks.ts` guarantee; the chance sits beside the status, never inside it.

## What to Look For

- Does "District points" as one row lose anything the two event rows carried? The event names and
  stages are on the small line, and the per-event breakdown is one tab away.
- In A, is the chance on the row label enough, or does the eye read the DCMP cells as unconditional
  anyway? Drag to "After week 3" and read a bubble team's DCMP row aloud.
- In B, does "~28% award" read as one thing or two?
- Is "Source" the right column header for the row label? "Event" no longer fits and "Points" repeats
  every other header.
- Whether the grand total's contribution list should print the field chance as its own row rather
  than as a note on the DCMP row.
