---
quick_id: 260914-liz
type: quick
autonomous: true
resolves_todo: e2e-suite-stale-against-live-site
---

# 260914-liz: resolve the stale e2e findings

Resolve exactly the failures listed in `.planning/todos/pending/e2e-suite-stale-against-live-site.md`. Do not look for, or fix, anything else (user instruction: "do not find any new findings").

## Evidence (read-only, on disk)

- A fresh run against the current deploy (530fba08, deploy workflow success) failed 40 and passed 147. The full log is `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/5084c558-8583-40c8-8798-8c91dab02553/scratchpad/liz/e2e-before.txt`. Strip ANSI codes with `sed 's/\x1b\[[0-9;]*m//g'`.
- Playwright wrote a page snapshot for every failure: `apps/web/test-results/*/error-context.md`. It shows the live DOM/ARIA tree at the moment of failure, so use it to see what the site actually renders. The screenshots in the same folders are PNGs; read them with the Read tool.
- The deployed site is built from HEAD's `apps/web/src`, so the source at HEAD is the ground truth for the current UI.

## Rules

- **Stale or regression:** for each failure, decide whether the spec is stale (the UI changed deliberately: a commit, a unit test or a sketch finding shows the new behaviour) or the site regressed.
  - Stale: update the spec to the current deliberate behaviour and keep the spec's intent.
  - Regression: fix the site code minimally, with a unit test if one sits next to it, and say so in the report.
- Never weaken an assertion just to pass. If a check's premise is gone (the behaviour it guarded no longer exists by design), delete only that test or assertion, and give the reason in the report.
- Load `Skill("sketch-findings-sigmascout")` before touching any layout, tab-strip or table expectation.
- Executors have NO network: do not run Playwright against any server. Verify with `npx tsc --noEmit -p apps/web/tsconfig.json` (0 errors), `cd apps/web && npx playwright test --list` (the count only changes by tests you deleted on purpose), and web vitest for any site file you change. The orchestrator re-runs the live suite and sends failures back.
- Main checkout, other sessions may be active: ownership check per file, commit only with explicit `-- <paths>`, retry once on index.lock, no push, never read .env, no writes to `.planning/`. Return the report as text.
- Commit subjects: `test(260914-liz): ...` for spec updates, `fix(260914-liz): ...` for site fixes. Trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

<tasks>

<task type="auto">
  <name>T1 (parallel with T2): desktop failures</name>
  <files>apps/web/e2e/deep-link.spec.ts, apps/web/e2e/static-shell.spec.ts, apps/web/e2e/event-live-artifact.spec.ts, plus site files only if a regression is proven</files>
  <action>
  - **deep-link :37, :63, :93, :115:** the h1 expectation `Teams — 2022` / `Events — 2025` does not match the live `Teams 2022` / `Events 2025`. Find the commit that changed the heading and match it.
  - **static-shell :41:** `getByRole('banner').getByText('SigmaScout')` has count 0. Find how the wordmark renders now (image, aria-label, visually hidden?) and assert the "exactly once, no duplicate shell" intent against that.
  - **event-live-artifact :79 (2024vabrb):** an empty Pick 3 or Backup cell renders `""`, not `—`. Check AlliancesTab's empty-cell rule and its unit tests.
  - **event-live-artifact :318 (2022ilpe):** the label is read from the row's first `span`, which is a team number since the match-table column reorder (21703441). Select the round label by testid or role instead.
  - **event-live-artifact :187 (alliance-uncertainty gap):** it was measured on VPR and widens under SPR. Read what it computes. Decide whether the premise still exists under the current Match Band definition (display-only band = sqrt(rosterSize x sum Sigma^2), SPR only; win odds keep their own variance). If the property is not something the current model claims, delete the test and give the reason. Otherwise report exactly what the model does claim.
  </action>
  <done>All 7 desktop failures addressed; tsc 0; playwright --list consistent; report returned.</done>
</task>

<task type="auto">
  <name>T2 (parallel with T1): phone-width failures (phone-390 and pixel-10)</name>
  <files>apps/web/e2e/event-scroll-regions.spec.ts, apps/web/e2e/tab-strip-alignment.spec.ts, apps/web/e2e/tab-strip-trigger-sizing.spec.ts, apps/web/e2e/table-layout-quality.spec.ts, plus site files only if a regression is proven</files>
  <action>
  - **Tab strip first:** start with the event tab strip. Work out its current tab set and order, whether it still overflows at 390px, and its alignment. One change there probably explains :375, :420, :232, tab-strip-alignment :21 and tab-strip-trigger-sizing :43.
  - **Remaining failures:** event-scroll-regions :84 (E5 Quals 2023cur and 2025flta), :199 (simulation table drag), :335 (E4, 16 Breakdown header columns), and table-layout-quality :316 (a full data column visible at scroll 0, for Insights 2023cur, Breakdown 2024new and TeamsTable 2024).
  - **Per failure:** read its error message in the log, then the error-context.md snapshot.
  - **Regression check:** a check whose premise is "the strip overflows" can only be deleted when the strip no longer overflows by design. If it no longer overflows because tabs were removed, that design is fine; if it is because of a layout break, that is a regression.
  </action>
  <done>All phone failures addressed; tsc 0; playwright --list consistent; report returned.</done>
</task>

</tasks>

## Orchestrator close-out

1. If any site code changed, push so it deploys, then re-run the live suite across the four deployed projects. Send any failure back to its executor. Repeat until green, or until only items the user must decide remain.
2. Run the full root vitest plus web tsc.
3. Write SUMMARY.md, move the todo to completed, append the STATE row, commit, push. Then wind down.
