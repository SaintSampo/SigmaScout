---
phase: 06-team-pages
plan: 06
subsystem: data-pipeline
tags: [publish, r2, payload-budget, republish, compression, brotli]

# Dependency graph
requires:
  - phase: 06-team-pages
    provides: "06-02's widened schemas, 06-03's filled team_media corpus table, and 06-04's publisher wiring for D-01..D-05 (all fields populated but never republished to R2 until this plan)"
provides:
  - "Every published team, teams, events, event and compare object for 2022-2026 across opr/epa/sigma1 now carries D-01..D-05: own predicted-score variance, actual RP, per-metric percentile, robotImageUrl, activeYears, scheduled-match rows, and the real event name — confirmed live over the network, not just from the run's own log"
  - "docs/publish-budget.md re-measured from THIS real run: the team/{teamKey}/{year} payload distribution (max 304,862B, +6.13% vs the 287,264B pre-Phase-6 baseline, 18.70% headroom under the 375,000B budget), plus a reversed compression finding (data.sigmascout.org now applies Brotli in transit, unlike the plain r2.dev URL the prior measurement used)"
  - "packages/harness/payloadBudget.test.ts's machine-readable-block-derived assertions pass against the re-measured numbers, with no budgetMaxBytes value edited"
affects: [06-05, 06-07, 06-08, 06-09]

# Actuals (#2632)
actuals:
  tokens: 2825
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Long-running (>10min) foreground pipeline commands run via run_in_background plus an until-loop poll on log-file growth and a PowerShell Get-CimInstance process-liveness check (Windows tasklist truncates commandline args, CimInstance does not) — used because pnpm's node-gyp install pre-check and the plan's own explicit 'no narrower-scope rehearsal' instruction (season-boundary state carry) both rule out the alternatives"

key-files:
  created: []
  modified:
    - docs/publish-budget.md
    - packages/harness/payloadBudget.test.ts

key-decisions:
  - "Ran the full 2022-2026/opr+epa+sigma1 publish as ONE foreground-launched background process rather than splitting by season — the plan explicitly forbids a narrower-scope rehearsal because a single-season run starts every algorithm cold instead of carrying state across the season boundary, which would overwrite live artifacts with cold-start numbers that disagree with the harness. Environment-notes option (a) (season-by-season) was therefore not applicable here despite being the generally-preferred pattern; option (b) (background + poll) was used instead, with process liveness confirmed via an untruncated `Get-CimInstance Win32_Process` query (not `tasklist`, which truncates long command lines) rather than trusting `$!`'s PID under Git Bash on Windows."
  - "Compression finding reversed, not merely re-confirmed: the 2026-08-24 baseline found no in-transit compression against the plain r2.dev URL; this run measured the real data.sigmascout.org custom domain and found Content-Encoding: br applied (~87% size reduction) — recorded as a genuine finding, matching docs/publish-budget.md's own prior note that this was 'unmeasured until a custom domain is actually in front of this bucket.'"
  - "No budgetMaxBytes value was edited anywhere (JSON block or absolute-ceiling test constants) — the team page's new 304,862B max still clears its 375,000B budget with 18.70% headroom, so no overage needed reporting; only the measured max/median/p95/largestKey figures and the doc comment's cited numbers were updated to match this run."

patterns-established: []

requirements-completed: [TEAM-02, TEAM-03, TEAM-04, TEAM-05]

coverage:
  - id: D1
    description: "pnpm publish:seasons ran exactly once for real against R2, all 2022-2026 seasons x opr/epa/sigma1, exit 0, object count landing exactly on the projected 54,671 page objects + 2 manifests (54,673 total PUTs) — an exact match, not merely within 1%"
    requirement: "TEAM-02"
    verification:
      - kind: integration
        ref: "real `node node_modules/tsx/dist/cli.mjs --env-file=.env packages/harness/publish.ts --seasons 2022-2026` run, 2026-08-25 18:49:10Z-19:10:49Z (21m39s wall clock); printed summary: objects=54671 totalBytes=2454511888, team max=304862B key=v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json"
        status: pass
    human_judgment: false
  - id: D2
    description: "A live unauthenticated fetch against https://data.sigmascout.org confirms robotImageUrl, activeYears, a per-metric percentile, redScoreVarianceOwn/blueScoreVarianceOwn on a Sigma1 match, actualRedRp/actualBlueRp on a played match, and a real event name (not an event-key-pattern string) all reached R2 — not merely the local assembly"
    requirement: "TEAM-05"
    verification:
      - kind: integration
        ref: "the plan's own literal <verify> node -e fetch script against v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json, plus a follow-up fetch confirming robotImageUrl=https://i.imgur.com/A0CFArb.jpeg..., activeYears=[2022,2023,2024,2025,2026], first event name='FIT District Katy Event' (not '2024txkat'), actualRedRp=0/actualBlueRp=2 and redScoreVarianceOwn=525.0961/blueScoreVarianceOwn=390.7705 on a played match"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/publish-budget.md's payload table, delta subsection, and machine-readable block all re-measured from this real run; packages/harness/payloadBudget.test.ts passes (10/10) against the new numbers with no budgetMaxBytes edited"
    requirement: "TEAM-03"
    verification:
      - kind: unit
        ref: "node node_modules/vitest/vitest.mjs run packages/harness/payloadBudget.test.ts — 10/10 passed; git diff docs/publish-budget.md shows no budgetMaxBytes value line changed (only prose sentences mentioning the term)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full workspace test suite and typecheck stay green after both doc/test edits, confirming no regression introduced by the re-measurement pass"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "node node_modules/vitest/vitest.mjs run — 92 files / 1209 tests passed; node node_modules/typescript/bin/tsc --noEmit — clean"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 6: Spend the Republish and Re-measure the Payload Budget Summary

**The phase's one authorized full republish ran for real — 54,673 PUTs, 21m39s, exactly matching plan 06-04's dry-run projection — carrying D-01..D-05's five team-page fields live and confirmed over the network, with `docs/publish-budget.md` re-measured and a reversed compression finding (Brotli now applies on the real custom domain).**

## Performance

- **Duration:** ~35 min (publish run itself ~22 min wall clock; the remainder is context loading, live-fetch verification, doc/test updates, and full-suite/typecheck confirmation)
- **Tasks:** 2 (2/2 complete)
- **Files modified:** 2

## Accomplishments

- **Ran `pnpm publish:seasons` for real, exactly once**, against the live R2 bucket — all five seasons (2022-2026), all three shipped algorithms (opr, epa, sigma1). 21 minutes 39 seconds wall clock (18:49:10Z-19:10:49Z), object count **54,671 page objects + 2 manifests = 54,673 total PUTs** — an exact match to the projected count, not merely within the plan's 1% tolerance, confirming this phase's fields changed bytes, not object count.
- **Confirmed the live result over the network**, not just the run's own log: `v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json` fetched from `https://data.sigmascout.org` carries `robotImageUrl` (a real `i.imgur.com` URL), `activeYears: [2022,2023,2024,2025,2026]`, a real event name (`"FIT District Katy Event"`, not the opaque key `2024txkat`), and a played match with `actualRedRp: 0` / `actualBlueRp: 2` and `redScoreVarianceOwn: 525.0961` / `blueScoreVarianceOwn: 390.7705`.
- **Re-measured `docs/publish-budget.md`** from this real run: the `team/{teamKey}/{year}` row moved from the pre-Phase-6 287,264-byte baseline to **304,862 bytes** (+17,598 bytes, +6.13%) — landing exactly on plan 06-04's dry-run projection, since both runs exercise the identical assembly path over unchanged corpus data. 70,138 bytes (18.70%) of headroom remains under the 375,000-byte budget. Every other page kind (`teams/{year}`, `events/{year}`, `event/{eventKey}`, `compare/{year}`) is byte-identical to the 2026-08-24 run, since D-01..D-05 only touch the per-team artifact.
- **Reversed the prior compression finding.** The 2026-08-24 baseline (measured against the plain `r2.dev` URL) found no in-transit compression at all. This run measured the real `https://data.sigmascout.org` custom domain and found `Content-Encoding: br` applied automatically by Cloudflare's edge — the teams table compresses 2,721,887 → 347,596 bytes (−87.2%), the team page 304,862 → 40,529 bytes (−86.7%). Recorded as a genuine new finding, not an assumption.
- **`packages/harness/payloadBudget.test.ts` passes 10/10** against the re-measured machine-readable block, with `budgetMaxBytes` untouched everywhere (verified by `git diff` — the only lines containing that string are new prose sentences, not JSON value changes).
- Full workspace suite (92 files / 1209 tests) and `tsc --noEmit` both stayed green after the doc/test edits.

## Task Commits

Task 1 (running the real republish and confirming it live) produced no repository file changes — the publish writes to R2, not this git repository, and the live-fetch verification is read-only. It is documented here as the operational record; only Task 2's doc/test edits produced a commit:

1. **Task 2: Re-measure the payload budget and keep the automated gate honest** - `d73c757e` (test)

_No plan-metadata docs commit for STATE.md/ROADMAP.md — this executor was explicitly instructed not to touch them; the orchestrator updates both after the wave completes. This SUMMARY.md is committed separately._

## Files Created/Modified

- `docs/publish-budget.md` — payload table's `team/{teamKey}/{year}` row replaced with this run's real median/p95/max/largest-key; new "Team-page delta (D-01..D-05, plan 06-06)" subsection stating the +6.13%/18.70%-headroom movement and the reversed compression finding (raw vs. Brotli-compressed byte table for two objects); storage/write-volume section updated with this run's real bytes-written and Class-A percentage, with the prior run's figures kept alongside for comparison; machine-readable block's `measuredAt`/`run`/`pages.team.{medianBytes,p95Bytes,maxBytes}` updated to this run's real numbers, every `budgetMaxBytes` value left untouched
- `packages/harness/payloadBudget.test.ts` — the doc comment above `TEAMS_PAGE_ABSOLUTE_MAX_BYTES`/`TEAM_PAGE_ABSOLUTE_MAX_BYTES` updated to cite this run's date and the new 304,862-byte team-page measured max (was 287,264), with a note on the delta and remaining headroom; no assertion logic or absolute-ceiling constant changed

## Decisions Made

- **Ran the full publish as one background-launched process, not season-by-season**, despite the environment notes' general preference for season-narrowing where the flag exists. The plan's own action text explicitly forbids this rehearsal pattern here: a single-season `--seasons` invocation starts every algorithm cold instead of carrying state across the season boundary, which would overwrite live artifacts with cold-start numbers that disagree with the harness. The 21m39s run exceeds a single foreground Bash call's 10-minute ceiling, so it was launched via `nohup ... &` + `disown`, then polled across three sequential foreground Bash calls checking log-file growth and (once, to confirm liveness) an untruncated `Get-CimInstance Win32_Process` query — `tasklist` was tried first and returned unfiltered/truncated results that could not identify the specific `publish.ts` process by command line; `Get-CimInstance` could.
- **Compression finding is reported as reversed, not re-confirmed**, because it genuinely is: the prior measurement's own text already flagged this as unmeasured pending a real custom domain, and this run supplies that measurement for the first time, with a different (opposite) result.
- **No `budgetMaxBytes` value changed anywhere** — the team page's new 304,862-byte max clears its 375,000-byte budget with clear headroom, so this run required no overage report; the plan's honesty requirement ("a budget edited to fit the measurement stops being a gate") was not tested by this run's actual numbers, but the constraint was still respected throughout (verified explicitly via `git diff | grep budgetMaxBytes`).

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were met without needing a Rule 1-4 auto-fix.

## Issues Encountered

- **`pnpm publish:seasons` (the plan's literal command) routes through `pnpm run`**, which on this machine trips the documented `pnpm install`/`better-sqlite3` node-gyp pre-check failure. Invoked the equivalent command directly instead — `node node_modules/tsx/dist/cli.mjs --env-file=.env packages/harness/publish.ts --seasons 2022-2026` — matching the established pattern plan 06-04 already used for its dry-run, and matching this session's own environment notes.
- **A first attempt to background-launch and immediately `tail` the log file in the same Bash call failed** (`tail: cannot open ''` — the `$LOGFILE` variable was empty in that call's later statements, cause not fully diagnosed, possibly a Git-Bash-on-Windows job-control quirk around `&`/`disown` in a single multi-statement script). Recovered immediately by re-reading the log file directly by its literal path in the next tool call — no time lost, no risk to the run itself (the background process had already started correctly, confirmed by the log file's existence and growing size).
- **`tasklist //FI "IMAGENAME eq node.exe"` and `wmic process where "name='node.exe'" get ProcessId,CommandLine`** both returned either unfiltered or empty results when trying to confirm the specific `publish.ts` process was alive (this repo's dev environment runs many unrelated `node.exe` processes). `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine"` piped through `grep -i "publish.ts"` reliably found and confirmed the real process (PID 16948) by its full command line, and confirmed its absence (process exited cleanly) once the run completed.

## User Setup Required

None — no external service configuration required. `.env`'s TBA key and R2 credential pair were never read, printed, or interpolated; the real publish reached both only via the established `tsx --env-file=.env` pattern. `git status --porcelain .env` reported nothing (clean/untouched) both before and after the run.

## Next Phase Readiness

- Every field D-01..D-05 added is now live and fetchable from `https://data.sigmascout.org`, proven by a real network fetch, not merely a dry-run projection or the publisher's own log. TEAM-02/TEAM-03/TEAM-04/TEAM-05 are marked complete in this plan's frontmatter — this is the plan that makes those requirements user-visible on the real published data, closing out the pattern 06-02/06-03/06-04 deliberately left `requirements-completed: []` for.
- `docs/publish-budget.md` and `packages/harness/payloadBudget.test.ts` both reflect the real, current state of the published data — any future phase's own re-measurement should treat this run's numbers (not the 2026-08-24 pre-Phase-6 baseline) as the current starting point.
- `reports/publish/seed-{opr,epa,sigma1}.sql` were written as a side effect of this run (gitignored, not committed) but were NOT applied to remote D1 via `wrangler d1 execute` — that is a separate, manual re-baseline cadence step documented in `docs/publish-budget.md`'s own "Re-baseline cadence" section and was outside this plan's declared scope (this plan's `<tasks>` cover the R2 publish and the payload-budget re-measurement only, not the D1 state re-seed).
- No blockers for the remaining Phase 6 client-side plans (06-05, 06-07, 06-08, 06-09) — every field they read is now live on the wire at its final, real byte size, so any client-side measurement (e.g. first-paint, bundle-size work) against real fetched data will see accurate numbers rather than dry-run projections.

## Self-Check: PASSED

- `docs/publish-budget.md` — FOUND, modified as described, `payloadBudget.test.ts`'s 10 assertions pass against it.
- `packages/harness/payloadBudget.test.ts` — FOUND, doc-comment updated.
- Commit `d73c757e` — FOUND in `git log --oneline`.
- Live artifact fetch (`v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json` from `https://data.sigmascout.org`) — re-confirmed present and carrying every named field at the time this SUMMARY was written.

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
