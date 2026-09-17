---
sketch: 018
name: what-is-spr
question: "What should one short 'What is SPR?' page look like, replacing both 'What SPR measures' and 'Sigma Score and the match band'?"
winner: "A"
tags: [copy, methodology, spr, sigma, match-band, de-ai, tables]
---

# Sketch 018: What is SPR?

## Design Question
Fifth page in the methodology "de-AI" pass (014 to 017). Jacob called the two existing pages "a
real mess" and asked for both to be deleted and replaced by one shorter, more human page. They
hold about 3,100 words of copy (`sprContent.ts` 674, `sigmaContent.ts` 2,404) plus six figures
drawn by an 800 line `SigmaPage.tsx`.

All three variants keep the same handful of facts: SPR is points per match added to the alliance
score with fouls removed; it is derived from alliance scores only; the strongest robot counts
1.36 / 0.95 / 0.68 so three SPRs do not add up the way three OPRs do; Sigma is match to match
movement, one standard deviation, never zero; the match band held about 7 in 10 results across
2024 to 2026; Sigma and the band are SPR only; within one match the three robots share one miss.
No hyphen or dash characters in any copy.

## How to View
open .planning/sketches/018-what-is-spr/index.html

## Variants
- **A: Five short sections** — flat prose, headings and paragraphs only, about 230 words.
- **B: Read a real row** — starts from "62.41 ± 8.10", three small tables (reading the number, SPR
  vs OPR vs EPA, reading a match row) and one drawn example match row. The only variant with a
  figure; reuses the awards page table block.
- **C: Questions and answers** — every heading is a question, every answer two sentences or
  fewer; keeps the scouting advice about low and high Sigma.

## What to Look For
- Whether any figure is worth keeping (only B keeps one).
- Whether the OPR / EPA side by side belongs here or is already covered by the accuracy and EPA
  pages.
- All three drop how Sigma is computed and the whole "How it was tested" section.

## Implementation notes for whichever wins
- Title "What is SPR?" contains `?`, a regular expression metacharacter. `methodologyCardData.ts`
  documents that card titles must carry none because `methodology.index.test.tsx` builds a
  `RegExp` from them, and `awardsContent.test.ts` style tests assert it. That hub test needs an
  escape helper (or the title loses the question mark).
- Route plan: keep `/methodology/spr` as the new page and delete `/methodology/sigma` with a
  redirect to it, so existing links and bookmarks survive. Anything linking to
  `/methodology/sigma` (check `SprPage.tsx`, team and event pages, e2e specs) moves to `/spr`.
- Deletes: `sigmaContent.ts`, `SigmaPage.tsx`, their tests, the sigma route and its test, and the
  old `sprContent.ts` body. The rank weights must stay computed from `SPR_PARAMS` (w2, w3), not
  typed, as `sprContent.ts` does today.
- The hub loses one card (six become five); `methodologyCardData.test.ts` pins the order by
  equality.
- "Sigma did better under OPR and SPR and worse under EPA" is from the old Sigma page's own text.

## Outcome (2026-09-17)
**Winner: A, five short sections, cut to four by Jacob.** He pasted back final copy: the lead plus
"What the number is", "The strongest robot counts most", "The ± next to it" and "The bars on a
match row". He dropped "What it cannot do", the "never zero" paragraph and the link to the accuracy
page, and wrote "~7 in 10". Only edit on top of his text: "three SPRs" capitalised.

Shipped: `sprContent.ts` and `SprPage.tsx` rewritten (no links, rank weights still derived from
`SPR_PARAMS`); `sigmaContent.ts`, `SigmaPage.tsx` and their tests deleted; `/methodology/sigma` is
now a redirect to `/methodology/spr`; the hub goes from six cards to five and the hub test escapes
card titles so "What is SPR?" can keep its question mark.
