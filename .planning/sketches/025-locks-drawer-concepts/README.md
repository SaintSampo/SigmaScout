---
sketch: 025
name: locks-drawer-concepts
question: "Clicking a blue cell on either Locks tab opens a drawer of captions, tables and histograms that is hard to read. What should the click open, if it shows only what the reader actually needs?"
winner: "A"
tags: [districts, locks, champ-locks, drawer, histograms, outcome-list, popover, copy]
---

# Sketch 025: What a blue cell opens

## Design Question

Jacob, 2026-10-06, with a screenshot of the Champ Locks grand total drawer for 9032: "when I click a
blue box on a locks page, a dropdown shows text, tables, and histograms. they look terrible and are
hard to read. way too much text. hard to know what is going on. focus on what the user actually needs
to see. it should be functional but look good."

The shipped drawer puts the clicked cell's plot or outcome list beside the grand total's plot, and under
each a caption of two or three sentences from `districtLedgerCopy.ts`. On the grand total it is four
paragraphs. Nothing on it says, in one line, what the reader clicked to find out: how many points, how
sure, and where that sits against the cutoff.

Three concepts, each a different answer to "what opens":

## How to View

open .planning/sketches/025-locks-drawer-concepts/index.html

Also published as an artifact: https://claude.ai/artifact/GooEBP35651hX14bHcszpg

Two teams: 9032, a sure thing at #1, and 4915, a bubble team at #38 whose grand total is bimodal
(29% of runs it misses the DCMP field and stays on 112; the cutoff sits inside the other lump). Click
any blue cell. 4915 is the case every concept has to survive.

## Variants

- **A: Verdict first** — the drawer stays, but reads top down as an answer. An eyebrow names the cell,
  one sentence answers the question ("Qualifies in 57 of 100 runs." / "Out before the top four in 69 of
  100 runs."), two or three figure tiles back it (median, likely, cutoff; or most likely outcome and
  chance of points), and one chart shows it: the histogram with the cutoff labelled on it and the
  cutoff's own likely zone hatched, or the outcome list as labelled bars. No explanatory copy at
  all: Jacob dropped the disclosure on 2026-10-06. The grand total adds a single line of where the
  points come from. The 426-bin axis is drawn in 5-point bins so the bars have width.
- **B: Build-up bar** — no histogram. The grand total is one bar on the 0 to 425 scale: a grey segment
  for points earned, a blue one for points predicted, the likely range as a whisker beneath, and the
  cutoff as a dashed rule with its likely zone hatched across the bar. The headline is the margin in
  the median run ("~10 points above the line"). Subtotal and qualification cells are a range bar with
  the median tick and a row of category chips. Outcome cells are one proportion bar, so "69% out early"
  is visible as most of the bar, with the list beneath as its key. A striped blue segment means
  "if in the field".
- **C: Popover** — nothing opens under the table. A card of about 320px anchors to the clicked cell:
  the cell name and event, the figure large with its likely range, a strip (band, median tick, cutoff)
  with the axis ends and the cutoff labelled, one line of context, and for outcome cells up to five
  rows with a ten-dot chance meter. The table never reflows and the row stays in view. Esc or a click
  elsewhere closes it.

All three share: the headline sentence vocabulary, integer rounding in the drawer (the cell keeps one
decimal), "likely = 8 of 10 runs" stated once, and blue for prediction / grey for earned, the same
rule as the cells.

## Data

Sketch simulation, not published quantities. 9032's grey numbers are the screenshot's. Every blue
figure is a synthetic distribution shaped to the screenshot's cells: 9032's DCMP subtotal and grand
total are narrow normals, its qualification is a lump at the 66 cap, its alliance selection and
playoffs are near-certain. 4915 is built to be awkward: a 29% spike at its district total plus a
wide normal, so its grand total is bimodal and its median, likely range and chance all come from the
same counts (chart craft: derive coupled values from one source). The cutoff is 213, likely 199 to
228, on every drawer.

## What to Look For

- Which concept answers "am I in?" fastest on 4915's grand total, and does it stay honest about the
  29% of runs where 4915 is not in the field at all? A draws it (the spike at 112), B stripes it, C
  prints it.
- B has no histogram. Is anything lost that the ledger needs, or was the histogram only ever there to
  carry the median and the band?
- C at phone width: the drawer concepts open inside the horizontally scrolling table, so on a phone
  the drawer is as wide as the table; C is the only one that fits the screen. Is that enough reason
  on its own?
- A's and C's headline for a losing outcome ("Out before the top four in 69 of 100 runs") is blunt.
  Sketch 020's rule was never to tell a kid they are out; this is a chance, not a verdict, but check
  how it reads aloud.
- Whether "How this is computed" needs to exist in the drawer at all, or belongs on the methodology
  page with one link.

## Decisions on A after the pick (2026-10-06)

- The "How this is computed" disclosure is gone, and the note line reads only "likely = 8 of 10 runs".
- Every histogram axis draws the same 1px crisp bar gap, and a bin under half a pixel is not drawn.
- The team column is not sticky. The shipped ledger pins it with `TEAM_CELL_CLASS`; Jacob wants it unpinned.
