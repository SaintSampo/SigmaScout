---
id: methodology-swing-page-describes-a-hidden-metric
created: 2026-09-10
source: quick task 260910-u7g shipping Sigma Score for BPR; the page was found during the consumer inventory
resolves_phase:
priority: high
---

# `/methodology/swing` now explains a number the site no longer shows

`apps/web/src/components/methodology/SwingPage.tsx` and `swingContent.ts` are a full public
explainer titled **"Swing Score and the match band"** — five figures, seven sections, written for a
tenth grader, with its own voice-gated content-as-data test.

As of 2026-09-10 it describes a metric that **no surface displays**:

- BPR shows **Sigma Score**, a different estimator on a different scale (Sigma reports an honest 1σ;
  Swing printed 1.92σ, so the same robot reads roughly twice as large under Swing).
- OPR and EPA show **no consistency figure at all** — the developer's decision was "show nothing for
  OPR and EPA", not "keep Swing for them".

Swing Factor still exists and is still computed: it drives OPR's and EPA's **match bands**. But the
per-team Swing Score the page teaches a reader to read off a team page is gone from every surface.

**This is the project's named original sin** — documentation describing a model the site no longer
runs. It is worth fixing promptly rather than carrying.

## Specific things the page now gets wrong

| Page claim | Reality |
|---|---|
| "Teams on this site carry a number called Swing" | They carry Sigma (BPR) or nothing (OPR/EPA) |
| "It has its own column in the Teams list and its own tile at the top of a team page, both labelled Swing" | Both are labelled **Sigma**, and only for BPR |
| "It is worked out for every algorithm the site publishes, OPR, EPA and BPR" | The published per-team figure is BPR-only |
| "Multiply the spread by 1.92 so the answer reads in points" | Sigma's scale is 1.0 |
| "It needs at least two played matches" | Sigma always has a figure; its prior answers before any evidence |
| "A Swing Score of exactly 0 is a real answer" | Sigma cannot reach 0 — the prior forbids it, deliberately |

The **match band** half of the page (squares add, three robots at ±10 give ±17.32, reading the band)
stays true in shape for both metrics — that arithmetic is unchanged.

## Options

1. **Rewrite as "Sigma Score and the match band".** Most honest, most work. The measured material to
   draw on is in `.planning/quick/260910-u7g-.../260910-u7g-SUMMARY.md` and `sigmaScore.ts`'s header,
   and the estimator's own story (a Bayesian prior from talent, two half-lives, why a near-zero
   reading is impossible) is genuinely more explainable than Swing's was.
2. **Retire the page** and drop its Methodology link until a replacement exists. Cheap, and leaves
   the site with no explanation of a headline number.

Option 1 is recommended. Note the page has a strict voice gate enforced at runtime over the exported
string VALUES (`swingContent.test.ts`): **no dash characters at all**, short declarative sentences,
numbers carry units and sample size. Any rewrite has to satisfy it.

## Sequencing

Independent of the republish — this is a web-only change and deploys with the site. It can land
before or after the Sigma data goes live, but the longer it waits the longer the site explains a
number nobody can see.
