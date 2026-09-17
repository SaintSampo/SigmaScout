---
sketch: 016
name: epa-vs-statbotics-rewrite
question: "How should the Our EPA vs Statbotics' EPA page be cut down: trimmed cards, one comparison table, or results first with a plain list?"
winner: "B"
tags: [copy, methodology, epa, statbotics, de-ai, tables]
---

# Sketch 016: EPA vs Statbotics Rewrite

## Design Question
Third page in the methodology "de-AI" pass (after 014 Acknowledgments and 015 awards). Jacob made
four edits directly, committed as e4522e55 before this sketch:

- new lead paragraph in his words
- Ranking points and Offseason events cards removed
- "Statbotics had the higher winner accuracy in all N measured seasons" sentence deleted
- provenance line now "SigmaScout EPA measured with EPA <version> on <long date>."

This sketch rewrites everything else: the shared list, the five remaining difference cards and
the head to head intro. No hyphen or dash characters in any new copy (the page's own test only
bans em and en dashes today; the live copy still has hyphens such as "S-shaped").

## How to View
open .planning/sketches/016-epa-vs-statbotics-rewrite/index.html

## Variants
- **Now** — the page as committed after Jacob's edits, the word count baseline.
- **A: Same page, trimmed** — same sections and cards, one sentence per side, no component change.
- **B: One comparison table** — cards become one table (topic, Statbotics, SigmaScout, note);
  shared list becomes one paragraph. Needs the cards block swapped for a table.
- **C: Results first, plain list** — head to head table moves to the top, differences become five
  bullets, shared items one closing sentence.

## What to Look For
- Whether the Statbotics / SigmaScout side by side labelling is worth the card chrome.
- Whether results belong first (C), since the lead promises "how much the differences change
  match predictions".
- What each version drops: the Israeli district exception, the per season list of score data
  fixes, the "why a winner pick cannot flip" explanation.

## Implementation notes for whichever wins
- `epaComparisonContent.test.ts` pins: shared list phrases ("one third", "logistic", "70 percent",
  "30 percent", "40 percent"), per card facts ("week 1", "never changes a winner pick", 75.2 /
  74.0 / 73.5, "250", "have not been adopted", "deliberate"), and that only those three decimals
  appear. All three variants keep every one of these.
- B and C change structure, so the card id pins, note label pins and the route test's card DOM
  order check need rewriting with them.
- Head to head numbers in the mock were read from the live artifact on 2026-09-16.

## Outcome (2026-09-17)
**Winner: B, one comparison table, with C's one idea: "How much it matters" goes first.** Section
order shipped: results, same on both sites, where they differ. The five cards became a four
column table (topic, Statbotics, SigmaScout, note) and the shared list became one paragraph.
The content test now bans the hyphen minus as well as the en and em dash, and gained a gate
against any "more accurate" style verdict sentence, since Jacob deleted the one the page had.

Pattern across 014, 015 and 016: flat third person, one sentence per fact, tables over prose
for anything comparative, results before explanation.
