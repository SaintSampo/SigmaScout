---
name: sigmascout-retune-republish
description: Run the full Sigma1/VPR rolling-origin re-tune and R2 republish end-to-end, unattended. Use when the user asks to "retune", "re-tune and republish", or refresh the promoted parameter sets after a model change. Runs for hours without operator input — every decision is pre-committed.
---

# SigmaScout: retune and republish, unattended

Run the complete rolling-origin hyperparameter re-tune, promote whatever clears the
pre-committed acceptance bar, and republish R2 — start to finish, in one session,
**without stopping for input at any point**. The operator may be asleep. That is the
design condition, not an edge case.

## The non-interruption contract (read first, it overrides habit)

1. **Never call AskUserQuestion, never checkpoint, never pause "to confirm".** Every
   decision this workflow needs is pre-committed below. If a situation arises that the
   rules genuinely do not cover, pick the conservative option (keep-incumbent / skip the
   step / don't publish), record what you chose and why in the run report, and continue.
2. **Never end the turn while work remains.** Long jobs run via Bash
   `run_in_background: true`; you are re-invoked when they finish. Between waves, start
   the next wave. There is no point in this workflow where "wait for the user" is correct.
3. **"Nothing cleared" is a successful outcome, not a failure.** If all ten verdicts are
   keep-incumbent, record the negative result, skip promotion and republish, commit the
   report, and finish. Do not re-run the search hoping for a different answer.
4. **If a step fails unrecoverably** (corpus missing, publish credentials rejected),
   finish every step that doesn't depend on it, then write a `BLOCKED:` section into the
   run report saying exactly what failed and what remains. That report is the handoff —
   not a question left hanging in the transcript.
5. **Never spawn subagents for any step.** Executor subagents' sandbox blocks ALL network
   Bash (publishes, live-origin checks) — and the tune steps need background-process
   monitoring only the main context can do. Everything runs inline.

## Authoritative references

- Run record + rationale for every rule below:
  `.planning/todos/completed/retune-sigma1-rolling-origin.md` (both dated runs)
- Republish ordering + budget rules:
  `.planning/todos/completed/republish-after-adjust-model-change.md`
- Stage semantics: header comment of `packages/harness/tune.ts`
- Current live pin: `packages/harness/promotedVersionPath.ts` — **read this at runtime**;
  never hardcode a version filename from this skill or an old record.

## Phase 0 — preconditions (minutes)

- `data/corpus.sqlite` exists and is non-trivially sized.
- `.env` exists (needed for publish only). **Never Read/cat it** — presence check only.
- Note the current `SIGMA1_CODE_VERSION` (`packages/core/algorithms/sigma1/params.ts`)
  and the current pin in `promotedVersionPath.ts`. The incumbent for acceptance is the
  LIVE pinned version file, passed via `--incumbent`.
- Start a dated run report at `reports/retune-<YYMMDD>-run-report.md`. Append to it as
  each phase lands — it must be complete even if the session dies.

## Phase 1 — sensitivity screen (once, ~tens of minutes)

```
tsx packages/harness/tune.ts --stage screen --seasons 2019,2020 --values 5 --batch 4 \
  --out reports/sensitivity-screen-<YYMMDD>.json
```

Run in background, redirect stdout to a log file, monitor by **output-file growth /
mtime — a quiet log is NOT proof a run died** (project memory). Pre-committed rules:

- Survivors = knobs the screen marks live. If `carryPriorYearShare` measures range
  exactly 0 (unreachable on this window — known, expected), force it into the survivor
  set and record the override in the report, as both prior runs did.
- Do not add or remove any other knob by judgment. The elim-R knobs stay excluded per
  `SEARCH_EXCLUSIONS` (2026-09-05 negative result — do not re-include).

## Phase 2 — joint tune, 5 origins × 2 arms (the long part: hours)

Origins: **2022, 2023, 2024, 2025, 2026**. Arms: `--adaptation off` and `on`, identical
budgets. **2027 is deliberately NOT an acceptance origin** (no matches → no verdict);
its ungated preseason `--seasons` job is out of scope here.

```
tsx packages/harness/tune.ts --stage joint --origin <YEAR> --adaptation <off|on> \
  --evals 40 --batch 4 --survivors reports/sensitivity-screen-<YYMMDD>.json \
  --incumbent <live pinned version file from promotedVersionPath.ts> \
  --out reports/tune-joint-<arm>-origin<YEAR>.json
```

- Run in **waves** to respect memory (~1.6–2.6 GB per process): wave 1 = 2022/2023/2024
  (both arms), wave 2 = 2025/2026 (both arms), matching the prior runs. Background each
  process; start wave 2 only when wave 1's processes have exited.
- If one run dies, restart it **once**; if it dies again, mark that origin/arm
  `NO-VERDICT (run failed)` in the report and continue with the rest.
- Append each verdict (origin, arm, verdict, delta Brier, bar, delta SE) to the run
  report as it lands, in the same table format as the prior runs.

## Phase 3 — acceptance decisions (pre-committed, zero judgment)

- An origin promotes **only** if `decideAcceptance` says ACCEPTED. keep-incumbent means
  that origin keeps its live set — no action, no retry.
- If **both** arms of an origin are accepted, the **larger delta Brier wins**.
- Never compare these numbers to a previous run's table (different model era /
  incumbent — the run record explains why). The only comparison that exists is the one
  `--incumbent` already made.

## Phase 4 — promotion (only if ≥1 origin accepted)

```
tsx packages/harness/promote.ts --name <rolling-YYYY-MM[suffix]> \
  --per-season "<acceptedYear>=search:reports/tune-joint-<arm>-origin<year>.json" \
  --per-season "<all other seasons>=version:<live pinned version file>"
```

- Name: next suffix in the `rolling-YYYY-MM`, `…b`, `…c` sequence.
- Re-pin `packages/harness/promotedVersionPath.ts` to the new file.
- Refresh whatever the promotion breaks by contract: the CI digest slice fixture,
  `selectionProvenance.test.ts`'s literal, `baselineFingerprint.test.ts`'s exact-set
  census (count only ever goes up). The failing tests name themselves — fix exactly
  those, nothing speculative.
- Run the harness suite from the **repo root** (`npx vitest run` — never
  `timeout N pnpm …`, which swallows output and exits 0; verify by output, not exit
  code). All green before Phase 5. If red and not fixable by the contract updates
  above, **do not publish** — record BLOCKED and finish the report instead.

## Phase 5 — republish (only if Phase 4 promoted, or code version changed since last publish)

Order is **load-bearing**: artifacts before manifest, or the site 404s.

1. `pnpm publish:seasons` — full R2 artifact republish. Long; background it, monitor
   the log. Runs from the main context (network).
2. `pnpm manifest:algorithms` — only after 1 completes successfully.
3. **Transcribe the publish-budget summary by hand** into `docs/publish-budget.md`'s
   dated log, same format as prior entries — the command prints it but does NOT write
   it, and the budget tests stay red until you do (project memory).
4. Verify by content: read the manifest back from the live origin and confirm it
   advertises the new version string.

## Phase 6 — record and commit

- Finish the run report; append the new verdict table to
  `.planning/todos/completed/retune-sigma1-rolling-origin.md` in the style of the prior
  dated runs.
- Commit atomically with **explicit paths only** (`git add <path> …`, never `git add
  -A` — concurrent sessions leave unrelated modified files; f0c7af48 absorbed foreign
  edits exactly this way). Conventional message, one commit per logical unit
  (promotion, docs, republish records).
- If `.planning/STATE.md` has a Quick Tasks table and this ran as a quick task, append
  the row via the `quick-tasks-append` helper (no raw `|` in the description).

## Known traps (each one bit a prior session)

| Trap | Rule |
|---|---|
| `timeout N pnpm <cmd>` exits 0 with no output | use `npx vitest run` / direct `tsx`, judge by output |
| Quiet log read as "run died" | check output-file mtime + size before declaring death |
| Subagent sandbox blocks network | publishes and live checks run inline, main context |
| publish-budget "auto-written" | it never is — transcribe manually |
| `git add -A` in a shared checkout | stage explicit paths only |
| Cross-era Brier comparisons | only the `--incumbent` comparison is valid |
| Elim-R weighting looks tempting | closed negative 2026-09-05; do not re-include |
