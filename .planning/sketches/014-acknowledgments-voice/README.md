---
sketch: 014
name: acknowledgments-voice
question: "What voice should the Acknowledgments page use so it is shorter and reads like a human wrote it?"
winner: "A"
tags: [copy, methodology, acknowledgments, voice, de-ai]
---

# Sketch 014: Acknowledgments Voice

## Design Question
The live `/methodology/acknowledgments` copy is accurate but over-explains and reads as machine
written. Which voice should replace it? This is a **copy** sketch: layout, section structure and
the `acknowledgmentsContent.ts` shape are held constant so only the words differ.

Hard constraint from Jacob: **no hyphen characters anywhere in the shipped copy** (the sketch
checks each variant in the browser for hyphens and dashes and shows the count).

Number 013 was skipped on purpose: it belonged to the deleted Champ Locks header sketch.

## How to View
open .planning/sketches/014-acknowledgments-voice/index.html

## Variants
- **Current (live)** — what ships today, as the baseline for word count.
- **A: Statbotics tone** — third person, flat, factual, one sentence per fact. Tone is from recall
  of Statbotics' About blurbs; statbotics.io returned 403 to a direct fetch.
- **B: Jacob's voice** — first person singular, blunt, slightly self deprecating, modeled on
  Jacob's own messages. The only variant that says "I".
- **C: Thank you notes** — each credit addressed directly to the credited project ("you").
  Shortest; drops the how and why details.

## What to Look For
- Does "I" (variant B) suit a public page, or should the site stay institutional?
- Which dropped facts matter: the reason the EPA rewrite exists, how light calling works.
- The prohibitions in `acknowledgmentsContent.ts` still hold in all three: no claim of beating a
  credited project, no accuracy figures, no licence claims, FIRST disclaimer kept.
- Every variant keeps the entry shape (`name`, `href`, `paragraphs`) and the accuracy link under
  Statbotics, so `methodology.acknowledgments.test.tsx` should survive a swap unchanged.

## Outcome (2026-09-16)
**Winner: A, Statbotics tone, trimmed further by Jacob.** He cut the TBA light calling paragraph,
the "Thanks to each of them" line, and rewrote the Statbotics opener to "set the standard for FRC
match prediction. SigmaScout is heavily influenced by it." Shipped to `acknowledgmentsContent.ts`.
Takeaway for the next methodology pages: flat third person, one sentence per fact, cut every
sentence that explains how or why unless a reader would miss it.
