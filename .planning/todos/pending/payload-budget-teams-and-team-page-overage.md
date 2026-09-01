---
id: payload-budget-teams-and-team-page-overage
created: 2026-09-01
source: quick task 260901-is2 Task 6 whole-suite run — pre-existing failures, surfaced not caused
resolves_phase:
priority: high
---

# `payloadBudget.test.ts`: the teams table and the 292-match team page are over budget

## Status: PRE-EXISTING, not caused by 260901-is2

Two tests in `packages/harness/payloadBudget.test.ts` fail, and did so **before** quick task
260901-is2 began. Verified, not assumed:

```
git diff --stat c6085aa5 HEAD -- packages/harness/payloadBudget.test.ts docs/publish-budget.md
# empty — both files are byte-identical to the pre-task commit
```

`c6085aa5` is the commit 260901-is2 branched from. Neither file is in that task's
`files_modified` list, and neither was touched by any of its six commits. The last commits to
touch them are `8967291f` and `33071fd0`, both from plan 08-05. The failures are inherited.

They are filed here rather than fixed inline because 260901-is2's scope was four model
correctness changes, and because the honest fix is a re-measurement plus a decision, not an
edit.

## The failures, exactly as read from the suite output

**1. Internal consistency — `teams` page kind**

```
AssertionError: teams: maxBytes (3704776) should be <= budgetMaxBytes (3500000):
  expected 3704776 to be less than or equal to 3500000
  packages/harness/payloadBudget.test.ts:177
```

Over by **204,776 bytes (+5.85%)**. `largestKey`: `v1/teams/2024/vpr@2.1.0+tuned-2026-08.json`.

**2. Absolute ceiling — `team` page kind**

```
AssertionError: team page maxBytes (675956) exceeded the absolute ceiling (600000) —
  the team page grew structurally bigger, not just noisier; shrink it or deliberately
  raise this bound alongside a re-measured budget
  packages/harness/payloadBudget.test.ts:201
```

Over the absolute bound (`TEAM_PAGE_ABSOLUTE_MAX_BYTES = 600_000`) by **75,956 bytes
(+12.66%)**, and over its own committed `budgetMaxBytes` of 375,000 by **300,956 bytes
(+80.3%)**. `largestKey`: `v1/team/frc3538/2024/vpr@2.1.0+tuned-2026-08.json` — D-05's named
292-match outlier.

Note failure 1 masks failure 2's internal-consistency half: the consistency test loops page
kinds and throws on `teams` first, so `team`'s 675,956-vs-375,000 breach is only visible via
the separate absolute-ceiling test. Expect a third failure to surface once `teams` is fixed.

## What is actually wrong

`docs/publish-budget.md`'s committed `json budget` block records measurements
(`measuredAt: 2026-08-31T19:39:13Z`) that **exceed the ceilings recorded in the same block**.
The budget is self-contradictory as committed: a measurement pass updated the measured values
without the corresponding ceilings ever being re-decided or the growth triaged.

The block's own `run` note claims plan 08-05's D-03/D-12 republish "moved only the event page
kind (327,172 -> 342,405 bytes max, +4.66%, same largestKey)". That claim is inconsistent with
`teams` and `team` sitting far over budgets that were presumably satisfied when they were set,
so **the first job is to find out when each actually crossed** — the `redRpPmf`/`blueRpPmf`
and `actualRedRp`/`actualBlueRp` additions are the obvious suspects for the team page, but
that is a hypothesis, not a finding.

## Do NOT simply raise the numbers

Raising `budgetMaxBytes` to 3,750,000 / 700,000 (or `TEAM_PAGE_ABSOLUTE_MAX_BYTES` to 700,000)
turns the suite green in one edit and destroys the only mechanism that notices the site is
getting slower. Page load speed is the project's **top UX priority** and a stated constraint;
the budget is a real constraint, not a test-hygiene artifact. Silently relaxing a ceiling to
make a failing test pass is exactly the failure mode this project's failure log names, and
the test's own message anticipates it: *"shrink it or deliberately raise this bound alongside
a re-measured budget"* — "deliberately", and "alongside a re-measurement", are both load-bearing.

A ~3.7 MB JSON for one year's teams table is a real user-facing cost even after Brotli.

## What "done" looks like

1. **Attribute the growth before deciding anything.** For each of the two page kinds, identify
   which fields account for the increase — measure a real artifact's field-level byte
   breakdown rather than reasoning from the schema. Name the commit/plan that introduced them.
2. **Try to shrink first.** The teams table is the strongest candidate: D-04/D-06.1's
   percentile widening deliberately kept `teamsRows` on the unwidened `metricsByTeam`
   (`packages/harness/publish.ts:1731-1735`), so if something has since widened it, that is a
   regression against a recorded decision. Numeric precision, redundant per-row keys, and
   fields no client reads are the usual wins.
3. **Only then re-decide the ceilings**, in the same change as a fresh
   `pnpm publish:seasons` re-measurement, with the new numbers written into
   `docs/publish-budget.md`'s `run` note alongside *why* the ceiling moved and what was tried
   first. `budgetMaxBytes` and the in-test absolute bounds must end up mutually consistent
   (`maxBytes <= budgetMaxBytes <= absolute bound`), which they currently are not.
4. Measured page-load impact of the largest artifact is stated — a byte count nobody has
   converted to a load time is not a decision input.
5. All of `payloadBudget.test.ts` green, including the internal-consistency failure that
   surfaces once `teams` clears.

## Related

- `docs/publish-budget.md` — the machine-readable `json budget` block; this test's ONLY input
- `packages/harness/payloadBudget.test.ts:103-123` — `TEAMS_PAGE_ABSOLUTE_MAX_BYTES` (5,000,000),
  `TEAM_PAGE_ABSOLUTE_MAX_BYTES` (600,000), `EVENT_PAGE_ABSOLUTE_MAX_BYTES` (350,000) and the
  reasoning for each
- [[regenerate-published-artifacts-post-is2]] — **sequencing:** that republish re-measures the
  budget anyway. Doing the attribution work here first means the re-measurement lands with
  ceilings that were decided rather than back-filled.
