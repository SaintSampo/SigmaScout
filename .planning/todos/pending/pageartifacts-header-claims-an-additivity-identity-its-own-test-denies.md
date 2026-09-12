---
id: pageartifacts-header-claims-an-additivity-identity-its-own-test-denies
created: 2026-09-08
retitled: 2026-09-12
source: measured during quick task 260908-5wd (then titled `match-band-calibration-and-the-broken-additivity-identity`); cut to this one item by the 2026-09-12 backlog triage, which sized it as the highest-value extra-small in the backlog
priority: medium
---

# `pageArtifacts.ts`'s header states as an ENFORCED RULE an identity its own test asserts is false

**Size: extra-small. It is prose, in four places, and it costs nothing but care to fix.** No
decision is owed and no measurement is needed to act.

This is the project's founding failure mode — documentation asserting a property of a model that
stopped being true — sitting in a file header, in the schema package, describing a guarantee the
test file it names denies in the same repo.

## The contradiction, verified at HEAD

**The claim.** `packages/harness/pageArtifacts.ts:20` opens "Two rules apply to every schema in this
file and are **enforced by** `pageArtifacts.test.ts` **rather than left to convention**", and line 37
gives the second rule as:

> (`redScoreVarianceOwn` equals the sum of its three teams' `TeamMetric.spread` squares, **by
> construction**)

**The test named as the enforcer asserts the opposite.** `packages/harness/pageArtifacts.test.ts`,
in `describe("TeamSeasonMatchSchema — D-01 own-variance…")`:

> `it("parses a row with redScoreVarianceOwn set and variance unset — **the two are different
> quantities, neither implies the other**")`

**The model says so too, in capitals.** `packages/core/algorithms/sigma1/index.ts:1555`:

> THE ALLIANCE-ADDITIVITY IDENTITY IS STILL GONE, AND IT IS STILL A REAL COST. … The published
> spread and `predict()`'s variance are different quantities and **have been since 5.0.0**.

`sigma1.test.ts` pins the break as an **inequality**, so the two paths cannot be re-coupled by
accident. The model is behaving exactly as its authors intended. **The prose is what is wrong**, and
it has been wrong for three majors.

## Where the false claim lives — four sites, not two

The triage sized this as "two prose blocks". It is four. All must move together or the next reader
finds the surviving one and believes it:

| # | Site | What it says |
|---|---|---|
| 1 | `packages/harness/pageArtifacts.ts:20` + `:37-38` | the file-header rule, and the word **"enforced"** |
| 2 | `packages/harness/pageArtifacts.ts:381-382` | "Under this file's header rule (D-01) it equals the sum of its three teams' published `TeamMetric.spread` squares — the additivity…" |
| 3 | `packages/harness/pageArtifacts.ts:807-809` | "this field equals the sum of its three teams' `TeamMetric.spread` squares, **by construction**, per this file's…" |
| 4 | `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md:25` | "the site becomes internally consistent **by construction, not by discipline**" |

**Site 4 is the one that costs the most and is easiest to forget.** That skill reference is
auto-loaded during UI implementation on this project, so it is literally what the next person
building an uncertainty surface reads before writing any code. A false invariant there propagates
into new code rather than merely misinforming a reader. **Fix it in the same change as sites 1-3.**

## What the correct wording has to say

Not merely "this may not hold" — the honest statement is stronger and more useful:

- `TeamMetric.spread` and `redScoreVarianceOwn` are **different quantities**, deliberately, since
  Sigma1 5.0.0. Neither implies the other.
- The break is **pinned as an inequality** by `sigma1.test.ts`, so re-coupling them by accident is
  itself a test failure. That is a real guarantee and is worth stating in place of the false one.
- What `pageArtifacts.test.ts` actually enforces about these fields is that they may appear
  independently — which is the opposite of what the header credits it with.

## One thing to settle while rewriting, and NOT to assume

**The magnitude is in doubt and this todo does not assert one.** The measurement in this file's
history (10,016 alliance observations: ratio mean 0.927, **median 0.837**, 5th/95th 0.427/1.741,
only 1.9% within 1% of 1.0) was taken against **`vpr@11.0.0`, a retired algorithm**. The same
session's later BPR measurement — in the "2026-09-08 UPDATE" section preserved in git history —
recorded **median 1.02** for `bpr@1.0.0`, i.e. close to true.

So the ~15%-at-the-median framing the triage carried forward is the **VPR** number. It may well not
describe the premier algorithm today.

**This changes nothing about whether to fix the prose.** A header claiming a test enforces something
it denies is wrong at any magnitude, and it is wrong about `sigma1/index.ts` regardless. But **do not
write a replacement that quotes a magnitude** unless it has been re-measured on `bpr@3.0.0` first.
Swapping one unverified number for another is this same failure with a different value.

## What left this todo on 2026-09-12, and where it went

This file used to carry Findings A through E and three open items. It is now this one item.

- **Its old item 2** — "the team page still draws VPR-only bands" — is **CLOSED**, and was already
  reported closed by `swing-score-audit`'s F8: bands are published for every algorithm now and
  `apps/web/src/lib/allianceBand.ts` is gone. That is the status line F8 asked this file for.
- **Its old item 3** — Findings B (the band is ~8% too wide), C (the +0.12σ / ~+8.9-point centring
  bias) and E (the population-level asymmetry) — **moved to `swing-score-audit`**, which measures
  the same quantities correctly and post-Sigma, and already carries per-algorithm coverage figures
  this file predates.
- **Finding D** (two different `±` under one name) went with them; it is a labelling decision and
  `swing-score-audit`'s F7 is where the two quantities are now compared.

Full prior text is in git history under the old filename,
`match-band-calibration-and-the-broken-additivity-identity.md`.
