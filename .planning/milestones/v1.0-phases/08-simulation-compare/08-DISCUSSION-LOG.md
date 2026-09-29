# Phase 8: Simulation & Compare - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-30
**Phase:** 08-simulation-compare
**Areas discussed:** Simulation inputs & leakage, Rank distribution display, Compare page tune vs holdout, Compare depth + proving parity

---

## Gray area selection

All four offered areas were selected for discussion.

---

## Simulation inputs & leakage

**First pass — user declined the option list and asked for a ranked recommendation instead.**

User's response to the initial four options: *"I want your honest opinion on this one. Im
including this feature because statbotics does. the constrais are saving extra data vs
simulation accuracy. rank 3 solutions on thise constraints. I want to find the best
middleground."*

Options were re-derived and costed against the two named constraints (bytes vs accuracy),
then re-presented as a ranking:

| Option | Added bytes | Worst-case artifact | Rank | Selected |
|--------|-------------|---------------------|------|----------|
| Stored predictions + RP pmfs on played matches, gap measured in-phase | +84 B/match | ~340,000 of 350,000 | #1 | ✓ |
| Sidecar checkpoint artifact (~10 checkpoints, snap backward) | ~38 KB/event, separate object | untouched | #2 | |
| Pre-event frozen set inline on the event artifact | +174 B/match | ~354,261 — over budget | #3 | |
| Freeze at every possible start point | ~950 KB/event | dead | ruled out | |
| Publish per-match team state | n/a | does not solve it (D-11 covariance rule) | ruled out | |

**User's choice:** #1 + measure the gap.
**Notes:** Recommendation rested partly on an unverified understanding that Statbotics'
own simulation uses present-day ratings throughout, i.e. more hindsight than option #1.
This was flagged as unverified at decision time and is recorded as such in CONTEXT.md.
Ceiling stated and accepted: the live/forward case is exact by construction; only
historical rewind is approximate.

---

## Algorithm gating for the Simulation tab

| Option | Description | Selected |
|--------|-------------|----------|
| Disabled with a reason | Greyed tab that explains simulation needs RP distributions, which only VPR produces | |
| Plain-disabled, follow D-17 | Visible, greyed, unclickable, no explanation — matches the Alliances tab exactly | ✓ |
| Auto-switch to VPR | Opening the tab mutates the global algorithm dropdown | |

**User's choice:** Plain-disabled, follow D-17.
**Notes:** Accepts the known cost that a user on OPR gets no hint that switching to VPR
would enable the tab, in exchange for one consistent event-page rule.

---

## Rank distribution display

| Option | Description | Selected |
|--------|-------------|----------|
| Median + 10–90 band + P(captain) | Percentile band, plus probability of making the alliance-captain cutoff | |
| Add a per-row histogram | The above plus a sparkline showing full distribution shape, revealing bimodality | ✓ |
| Mean ± SD + P(captain) | Site's existing ± idiom; advised against — band can run below rank 1, and collides with D-01 | |

**User's choice:** Add a per-row histogram — **then amended mid-discussion to drop the
captain probability entirely.**

**Amendment, verbatim:** *"I dont actually care about how close teams are to ranking top
8, dont include that feature."*

**Notes:** Dropping the cutoff column also removed a complication surfaced during
discussion — the captain cutoff is not universally 8 (1,193 of 1,355 corpus events run 8
alliances, but 104 run 4 and 22 run 6), so the column would have needed a per-event
threshold. Percentile bands were chosen over mean ± SD on two substantive grounds: rank is
bounded and skewed (mean 3.0 with SD 4.0 gives a band of −1.0 to 7.0), and Phase 7's D-01
reserves the `±` glyph for 1 SD of full predictive variance, which a rank spread is not.

---

## Simulation runtime and progress

| Option | Description | Selected |
|--------|-------------|----------|
| Web Worker + committed benchmark | Regression-testable runtime recorded in the repo | |
| Web Worker + on-page timing | Elapsed time shown to the user after a run | ✓ |
| Both | Benchmark for CI plus visible timing for the user | |

**User's choice:** Web Worker + on-page timing, **extended mid-discussion to include live
progress during the run.**

**Amendment, verbatim:** *"I love the timer idea. lets have some kind of way to indicate
live progress too, and then they see the total time running the sim took."*

**Notes:** Accepted consequence recorded — no committed benchmark means runtime is not
regression-testable and varies by device. CONTEXT.md carries a planner note to capture one
representative runtime into the phase SUMMARY so ROADMAP SC-2's "recorded" has a durable
home.

---

## Compare page: tune vs holdout

**First pass — user rejected all three options and challenged the premise.**

User's response: *"I want to revisit the nessecity of tune vs holdout seasons. I really
feel like there should be no difference. I get that it is a check on overfitting, but I
really want a more clever solution."*

Rolling-origin tuning was researched and presented as the standard clever solution, along
with a ceiling that had not previously been stated: no temporally honest scheme can make
all five seasons headline-eligible, because 2022 has nothing before it. Realistic ceiling
is 3–4 headline seasons, not 5. Its costs were established (four hyperparameter searches,
four parameter sets, collision with Phase 3's single-promoted-version digest CI gate,
re-measurement of SC-3 and every published artifact) and it was judged out of Phase 8's
fence.

Re-presented as two questions:

**Presentation for Phase 8:**

| Option | Description | Selected |
|--------|-------------|----------|
| One uniform table + methodology note | All five seasons identical, split disclosed once with the no-overfitting evidence | ✓ |
| Uniform table, small per-row marker | Uniform, but distinction recoverable per row | |
| Grouped by tune/holdout | The original strict-EVAL-04 presentation | |

**User's choice:** One uniform table + methodology note.
**Notes:** Earned by the data rather than asserted — VPR's holdout Briers (0.1617, 0.1501)
sit inside its tune range (0.1592–0.1761) and its single best season is a holdout one, so
the fixed split is demonstrably not flattering VPR.

**Disposition of the rolling-origin idea:**

| Option | Description | Selected |
|--------|-------------|----------|
| New phase after v1.0 | Full methodology upgrade, planned properly | ✓ |
| Backlog item, decide later | Written up but unsequenced | |
| Drop it | Close the question | |

**User's choice:** New phase after v1.0.

---

## Compare page depth

| Option | Description | Selected |
|--------|-------------|----------|
| Headline + match-type split | Accuracy, Brier, and the qual/elim/combined split | |
| Add calibration curves | The above plus 10-bin calibration per algorithm-year | |
| Everything, including exclusions | The above plus exclusion counts and their disclosure | ✓ |

**User's choice:** Everything, including exclusions.
**Notes:** Discussion established that offseason matches *feed the model* but are *excluded
from scoring*, which is why `exclusionCounts.offseason` reads 5,915 for 2025 while the
Brier figures already reflect the offseason-inclusive stream. CONTEXT.md carries an explicit
wording constraint so the page does not misdescribe this as "offseason events are ignored".

---

## Parity check mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Playwright against live artifact | Fetches real R2 bytes, renders, asserts on the DOM | |
| Component test against fixture | Vitest, hermetic, fast | ✓ |
| Both | Full coverage of both failure modes | |

**User's choice:** *"do whatever takes the least time"* — resolved to the Vitest component
test against a committed copy of a real published artifact.
**Notes:** Limitation recorded in CONTEXT.md — this proves the page is faithful to the
artifact, not that the published artifact matches what the harness produced. The existing
`apps/web/e2e/event-live-artifact.spec.ts` is named as the pattern to copy if that coverage
is wanted later.

---

## Claude's Discretion

- Position and phone behaviour of the six-tab strip once `simulation` is added
- The start-match picker's form (dropdown, slider, or click-a-row)
- Whether the simulation auto-runs on tab open or waits for a button
- The rank axis domain and shared-scale computation
- Compare page layout and how the three compLevel views are switched
- Calibration curve rendering and its plain-language explainer
- Depth-within-current-system polish on both new surfaces (`ui-polish-pass.md` question 1
  only; the base-palette question stays deferred)

## Deferred Ideas

- **Rolling-origin hyperparameter tuning** — promoted to its own phase after v1.0
- **Sidecar checkpoint simulation artifact** — runner-up to the chosen simulation input
  approach; revisit if the D-02 measurement shows a large rewind-overconfidence gap
- **Elimination-bracket simulation and alliance-selection prediction** — outside SC-1's
  qualification-only fence
- **`publish-as-of-match-team-metrics.md`** — reviewed, not folded; rejected as a freeze
  enabler on substantive grounds (D-11 covariance rule), original purpose still open
