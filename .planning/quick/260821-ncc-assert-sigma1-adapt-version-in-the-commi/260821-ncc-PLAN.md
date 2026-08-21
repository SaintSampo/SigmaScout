---
phase: quick-260821-ncc
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - packages/harness/baselineFingerprint.test.ts
autonomous: true
requirements:
  - A-01

estimate:
  tokens: 15000
  raw_tokens: 10000
  tasks: 1
  confidence: high
---

# Quick Task 260821-ncc — Assert `sigma1-adapt` version in the committed fingerprint test

<objective>
Close advisory A-01 from `.planning/phases/03.2-.../03.2-SECURITY.md` by turning a
process-based mitigation into a structural one.

Threat T-03.2-13 is a SPOOFING risk with a silent failure mode: `packages/harness/cli.ts:263`
resolves `loadSearchWinnerSigma1("sigma1-adapt", ON_SEARCH_ARTIFACT_PATH, "tune-joint-on-winner")
?? algorithm`. When the **gitignored** `reports/tune-joint-on.json` is absent — which is the
default state of any fresh git worktree — that `??` silently falls back, and `sigma1-adapt`
resolves to `2.0.0+defaults-adapt` instead of the published `2.0.0+tune-joint-on-winner`. The run
still succeeds. The numbers still look plausible. They are a different algorithm's numbers.

This actually happened during phase 3.2 plan 03.2-03 and was caught by hand before the committed
run. Nothing in CI would have caught it. The committed test at
`packages/harness/baselineFingerprint.test.ts:184-191` asserts the five algorithm **ids** and the
**version of `opr`**, but never asserts `sigma1-adapt`'s version — so an identical regression on a
future re-run would pass the suite.

Add the missing assertion so the committed record cannot silently hold a fallback algorithm under
the published identity.
</objective>

<task_1>
**Add a `sigma1-adapt` version assertion to the event-scoped fingerprint suite.**

File: `packages/harness/baselineFingerprint.test.ts`

Follow the existing sibling test at lines 184-191 (`the event-scoped fingerprint's opr entry reads
3.0.0+baseline …`) exactly — same `readFileSync`/`BaselineFingerprintSchema.parse` shape, same
`.find(...)` lookup, same constants (`BASELINES_DIR`, `EVENT_SCOPED_FINGERPRINT_FILE`). Do not
refactor the neighbouring tests, do not extract a shared helper, and do not add a `beforeAll`.
The duplication in this file is deliberate: each test names the specific claim it protects.

Assert:

```ts
expect(parsed.algorithms.find((a) => a.id === "sigma1-adapt")?.version)
  .toBe("2.0.0+tune-joint-on-winner");
```

Name the test so a future reader hitting a failure understands the failure mode immediately —
that the value it guards against (`2.0.0+defaults-adapt`) is what a MISSING gitignored
`reports/tune-joint-on.json` silently produces, not a typo. Reference T-03.2-13 and A-01.

**Acceptance:**
- `pnpm test` passes at 700/700 (currently 699; this adds exactly one test).
- `pnpm typecheck` clean.
- The new test FAILS if the expected string is changed to `2.0.0+defaults-adapt` — verify this
  by temporarily flipping the expectation, observing the failure, and reverting. This proves the
  test actually binds; do not skip this check, and do not commit the flipped state.
- `git diff --exit-code data/baselines/ data/diagnostics/ data/algorithm-versions/` exits 0.
</task_1>

<constraints>
- ONLY `packages/harness/baselineFingerprint.test.ts` may be modified. This is a test-only change.
- Do NOT modify `packages/harness/cli.ts`. Changing the `??` fallback itself is a behavioural
  change to algorithm resolution, out of scope for this task, and would need its own plan.
- Do NOT modify anything under `data/baselines/`, `data/diagnostics/`, or
  `data/algorithm-versions/` — frozen provenance and a CI digest bit-freeze.
- Do NOT regenerate `reports/` — gitignored, likely absent, and not needed.
</constraints>
