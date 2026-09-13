---
id: 260912-tm8
slug: write-the-award-prediction-methodology-p
kind: quick
status: complete
completed: 2026-09-12
subsystem: apps/web, scripts
key-files:
  added:
    - apps/web/src/components/methodology/awardsContent.ts
    - apps/web/src/components/methodology/awardsContent.test.ts
    - apps/web/src/components/methodology/AwardsPage.tsx
    - apps/web/src/routes/methodology.awards.tsx
    - apps/web/src/routes/methodology.awards.test.tsx
    - scripts/measureAwardQualificationImpact.ts
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/methodologyCardData.test.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
    - package.json
    - .planning/todos/pending/quick-tasks-append-corrupts-state-frontmatter.md
decisions:
  - "The write up is a real site route, /methodology/awards, following the /methodology/sigma precedent exactly: content as data in awardsContent.ts, the same section markup and tokens as SigmaPage.tsx minus its figures, and the same binding voice rules (no dash characters at all, numbers carry units and sample size, no summarising closer)."
  - "EVERY NUMBER ON THE PAGE TRACES TO COMMITTED CODE. Several headline figures (the 1.8% versus 9.3% qualification split, repeat rates, concentration, Impact rate by age) had only ever been produced by throwaway scripts in a session scratch directory. A public page citing numbers nobody can reproduce is what the published honesty rule forbids, so those analyses were consolidated into scripts/measureAwardQualificationImpact.ts (pnpm measure:award-qualification-impact) and rerun. Every figure reproduced exactly."
  - "The hub card goes FIFTH, so Acknowledgments stays last. METHODOLOGY_CARDS is destructured positionally, so the union, the entry, the destructure and the equality pin in methodologyCardData.test.ts were changed together."
  - "The page states that the site shows no award predictions, and awardsContent.test.ts pins that sentence, so the page cannot be read as a feature announcement."
  - "awardsContent.test.ts pins 57 measured figures as substrings. If a script is rerun and a number moves, that test failing is correct: update the prose and the list together."
  - "Executed directly by the orchestrator, with no separate PLAN.md and no planner or executor subagents: a single content page following a direct precedent, written by the session that produced every result it reports, at the end of that session. Called out rather than implied."
owed:
  - "NOT PUSHED. Committed locally only. Cloudflare Pages auto deploys from main, so pushing publishes this page to the live site - that is the developer's call, and another concurrent session could push these commits along with its own."
  - "NO RENDERED VISUAL CHECK was done. The page uses markup and tokens identical to /methodology/sigma and the build, both typechecks and the DOM tests pass, but nobody has looked at it in a browser. The hub grid also went from five cards to six (two full rows of three at lg)."
  - "scripts/measureAwardQualificationImpact.ts is NOT unit tested. Every figure depends on the gitignored corpus, so no fixture could pin them. Its header says so."
  - "COLLISION WATCH: concurrent quick task 260912-tib is rewriting /methodology/epa-vs-statbotics and its CONTEXT says the EPA card's title and blurb 'may be reworded'. That edits methodologyCardData.ts, the same file this task changed. tib keeps the EPA card's position, and this task did not move it, so the two should compose, but tib must build on this commit rather than a snapshot from before it."
  - "Calibration on the district championship berth strata is still unmeasured (carried from 260912-l8t)."
---

# Quick task 260912-tm8: the award prediction methodology page

Commit: `d2bb41f9` (page, script, card wiring). Docs follow in a separate commit.

Wrote `/methodology/awards`, a plain language write up of the four award research tasks run
today (`5n8`, `7bp`, `i13`, `l8t`), and added it to the methodology hub.

## What the page says

Nine sections, each stating measured numbers with their sample sizes:

1. **What we measured** — 41,869 award records, ten seasons, every official event.
2. **How it was tested** — walk forward, a fitted model against a simple "most decorated team"
   rule, and gaps inside chance reported as no real difference.
3. **Past winners win again** — top 10% of teams hold 48.7% of judged awards; Impact repeats
   61.4% of the time, the Judges' Award 21.5%.
4. **The simple rule beat the model** — on Impact, Engineering Inspiration and Safety. The model
   won only Excellence in Engineering and Autonomous, and Autonomous is the one award where the
   robot rating clearly matters.
5. **Team age** — older teams win Impact more (3.85% against 0.65% per appearance), but age adds
   nothing once past wins are counted.
6. **A short list works better than one pick** — the Impact winner is in the simple rule's top 3
   51.1% of the time and its top 10 84.9%.
7. **The percentages are too confident** — plain language first, per the design findings.
8. **What it means for qualifying** — awards decide 1.8% of district championship spots but 9.3%
   of district Championship spots, and those Championship spots can be predicted.
9. **What it cannot do** — measurements, not a feature; judges see things the data cannot.

## Four corrections this task made to the earlier record

**1. The scored count was mislabelled in earlier summaries.** 30,516 is the number of award
instances *built*, and it includes 2016, which is training only. The number actually *scored*
across 2017 to 2026 is **28,033**. `260912-5n8`'s SUMMARY and the session's reports called 30,516
"scored". Every percentage is unaffected — they were always computed per award type over scored
seasons — but the headline count was wrong, and the page now states both numbers correctly.

**2. "Most decorated rookie" is really "lowest team number".** The rookie baseline's comparator
is past wins of this award, then past wins of any award, then lowest team number. Past wins only
count earlier seasons and a true rookie has none, so on rookies the rule reduces to picking the
lowest numbered rookie. `260912-7bp` and `260912-l8t` described it by its code name. The page
describes what was actually measured: **the lowest numbered rookie won Rookie All Star in 62.8% of
district championship cases that decided a Championship spot.**

**3. 259 against 260.** `measureAwardQualificationImpact.ts` counts 259 of 519 berth awards
outside the points cut; `260912-l8t`'s stratifier counts 260. One ranks by point total with a team
key tiebreak, the other by TBA's own `rank`. They differ at a single tie. The page cites 259, from
the script that computes it.

**4. Three STATE.md corruptions today were this session's append script, not the helper.** See
the next section.

## The STATE.md corruption, attributed correctly

Commit `3afabbec` banned `gsd-tools quick-tasks-append` after four STATE.md corruptions, and its
todo named mixed LF/CRLF line endings as the lead. **Three of those four were this session's
hand written append script**, and the todo now says so:

| incident | commit | task |
|---|---|---|
| 1 | `88cac8f5` | 260912-7bp |
| 3 | `17b6c2b0` | 260912-i13 |
| 4 | `a103ec69` | 260912-l8t |

Each blob has a blank line 1 and this session's own quick task row on line 2, where `---` belonged.
The mechanism was reproduced against the clean parent `21a15b5a`: the script anchored on the
previous row with a template literal regex whose `\|` escapes were lost to shell quoting, turning
the anchor into an alternation that matches at **character index 0**. The script's
`if (!re.test(s)) exit` guard passed *because* the regex was broken — an alternation always matches.

The LF/CRLF lead is a red herring for these: measured with `node`, the working copy, `HEAD` and all
three blobs are pure LF. (Git Bash `grep $'\r$'` and `cat -A` disagree with each other on this
machine and should not be trusted for this.) The helper does have a separate, real bug, seen first
hand this session: it mis-parsed flags into `| 132 | --id |` and overwrote `last_activity_desc`
with a concurrent session's description.

This task's own STATE row was appended with plain string line matching, no regex. Of the four
checks in the `.claude/CLAUDE.md` recipe, **two pass and two cannot pass on this file even at
`HEAD`**:

- frontmatter parses: **pass**
- both `---` delimiters present: **pass**
- no duplicate row number: **fails at `HEAD` already** — rows 66, 88 and 91 each appear twice
  (lines 453/488, 490/491, 494/495)
- every numbered row has 5 cells: **fails at `HEAD` already** — rows 1 to 9 at lines 49 to 60
  have 4, but they belong to a different table, not the Quick Tasks table

The insert was verified by **delta against `HEAD`** instead: identical duplicates, identical 4 cell
rows, and exactly one new numbered row (106 to 107), row 139, unique, 5 cells, directly after row
138, none above the closing `---`. The pre-existing duplicates were **not** renumbered: other
sessions are writing STATE.md concurrently, and renumbering would collide. As written, the recipe's
checks 3 and 4 will fail for every future append until those rows are repaired, and check 4 needs
scoping to the Quick Tasks table.

## Verification

- Targeted: `awardsContent.test.ts`, `methodology.awards.test.tsx`, `methodologyCardData.test.ts`,
  `methodology.index.test.tsx` — **4 files, 29 tests, all pass**. The hub test renders six links.
- Full suite, repo root `npx vitest run`: **267 of 269 files pass, 5,782 tests pass, 4 skipped**.
  The 18 failures are all in `packages/harness/r2ClientList.test.ts` (untracked) and
  `packages/harness/r2ClientRetry.test.ts` (modified in the working tree mid run) — concurrent task
  `260912-tay`'s test first R2 work. No path this task touched is in `packages/harness`.
- `vite build`: succeeds; the regenerated route tree includes `/methodology/awards`. The chunk size
  warning is pre existing.
- `tsc --noEmit -p apps/web/tsconfig.json`: clean.
- Root `tsc --noEmit`: errors only in `r2ClientList.test.ts`, none in any file this task touched.
- `pnpm measure:award-qualification-impact`: runs and reproduces every figure the scratch analyses
  produced.
