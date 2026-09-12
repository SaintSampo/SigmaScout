---
id: flaky-seasonparamsets-equivalence-gate
created: 2026-09-07
source: observed during quick task 260907-203 follow-up (Compare floor move)
resolves_phase:
priority: medium
---

# Intermittent failure: seasonParamSets D-4 equivalence gate, Leg B

`packages/harness/seasonParamSets.test.ts` fails **intermittently** in full repo-root runs:

```
FAIL |node| packages/harness/seasonParamSets.test.ts
  > D-4 equivalence gate, Leg B (evidence, not the bar): the season-boundary differential
  > replaying 2022 then 2023 (first 2 events each) through a plain makeSigma1 module
    and through the facade over a uniform map produces byte-identical prediction streams
```

## What was actually observed, 2026-09-07

| run | result |
|---|---|
| `npx vitest run` (full, repo root) | **FAILED** |
| `npx vitest run` (full, repo root) x3 more | passed |
| `npx vitest run packages/harness/seasonParamSets.test.ts` x3 | passed |

So: **1 failure in 4 full runs, 0 failures in 3 isolated runs.** The assertion text beyond the
test name was not captured — the three attempts to reproduce it for detail all passed. That is
the main gap; the next person to see it should grab the full failure output immediately.

## Why this is worth chasing rather than retrying

The assertion is a **byte-identical prediction-stream comparison**. A deterministic replay
producing different bytes intermittently is either:

1. a genuine nondeterminism in the replay path (shared mutable state between the plain module
   and the facade, or iteration-order dependence), which would be a real correctness bug and
   would also undermine every promoted version's `predictionStreamSha256` digest; or
2. a resource/timeout artifact under full-suite parallelism — this test opens the ~700 MB
   corpus while ~200 other files run, and a timeout can surface as a failed assertion rather
   than a clean timeout message.

(2) is more likely given it passes in isolation, but (1) has consequences serious enough that
"it passed on retry" is not an acceptable resolution. Note this project has already been bitten
by a green suite hiding a real divergence (see the Worker typecheck "cosmetic" drift that turned
out to be a live/offline DQ divergence).

## Relevant recent change

`seasonParamSets.test.ts` was edited on 2026-09-07 by the `rolling-2026-09e` re-pin: its
uniform-map season list widened 7 -> 10 entries. The failing leg replays only 2022 and 2023
(first 2 events each), so the widening should not touch it directly — but the file as a whole
got heavier, which is consistent with hypothesis (2).

## First steps

1. Run the full suite in a loop until it fails, capturing complete output (`npx vitest run
   2>&1 | tee`), to get the actual diff or timeout message. Do NOT use `timeout N pnpm ...` —
   it swallows output and exits 0.
2. If it is a real byte difference, diff the two streams and find the first differing record.
3. If it is a timeout, raise this test's own timeout or mark the file to run serially rather
   than widening a global timeout.

---

## A SECOND full-run-only flake, observed 2026-09-08: `algorithmIdentity.test.ts`

Same signature, different test. `packages/harness/algorithmIdentity.test.ts` passes in isolation
(6/6, repeatedly) but fails intermittently in a full `npx vitest run`, and **a different assertion
fails each time** — once "finds zero identity-shaped occurrences of the retired id", once "the
marker-exempted line count is at most the cap".

That pattern — isolation-green, full-run-red, varying assertion — points at the sweep reading files
that change underneath it. It walks the WHOLE repo from the root with `readdirSync`
(`algorithmIdentity.test.ts:271`), skipping only `node_modules`, `.git`, `dist`, `reports`,
`corpus`, `.wrangler`, `test-results`, `playwright-report`. Anything else another process writes
during the run is in scope, including `.planning/`.

**Ruled out on 2026-09-08:** it was not the swing-factor work — that change added zero
`[pre-rename]` markers (`git diff HEAD~2 HEAD | grep -c '^+.*\[pre-rename\]'` → 0) — and there were
no git worktrees to double-count. An untracked, un-ignored empty `scratch_probe/` directory exists
at the repo root and is NOT in the skip list; worth watching as a candidate if it ever has content
during a run.

Concurrent sessions are the likeliest cause, since this repo is routinely worked by several at once.
**Do not treat a full-run failure here as a code defect without first re-running the file in
isolation.**

---

## CLOSED 2026-09-12 — both halves resolved, and the second one moved out rather than closed

Closed as part of the 2026-09-12 backlog triage (`.planning/triage-2026-09-12.md` §3), which
verified every pending todo against HEAD.

**The `seasonParamSets` D-4 Leg B flake: FIXED.** `1a7bd4c1` ("test: green the suite — a stale VPR
pin and two 5s timeouts") gave this file and `algorithmIdentity.test.ts` explicit timeouts; the
diagnosis recorded there is hypothesis (2) above, not (1): these tests were never wrong, only slow,
and only under full-suite parallel load. `4bdb7717` then **generalised the fix repo-wide** —
`vitest.config.ts:33` now sets `testTimeout: 30_000` for the whole node project, with a comment
saying explicitly that patching whichever test lost the race is whack-a-mole and the 5s default is
simply wrong for this repo's node half. Verified at HEAD: `STATE`/config read directly, one
`testTimeout` in the tree, value `30_000`.

Consequence for this file's "First steps" section: it is retired. Per `1a7bd4c1`'s own record, the
"re-run in isolation before treating a full-run failure as a defect" workaround no longer applies —
**treat a full-run failure as a defect.**

**The second half — `algorithmIdentity.test.ts` reading the whole repo — did NOT close here; it
moved.** That concern (the sweep walks the repo root with `readdirSync` and can read files another
concurrent session is writing) lives on as its own pending todo,
`algorithm-identity-sweep-reads-all-of-data`. Note when picking that one up that it argues against a
5s timeout that no longer exists — it needs its urgency rewritten against the 30s default before it
is acted on.

**Note the contradiction this file leaves in git history, deliberately.** Its 2026-09-08 section says
"do not treat a full-run failure here as a code defect without first re-running the file in
isolation." `1a7bd4c1` (2026-09-09) retires exactly that workaround. The later record wins; the
earlier one is preserved above as written rather than edited, because the drift between them is the
reason this triage happened.
