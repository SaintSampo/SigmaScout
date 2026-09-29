---
phase: 07-event-pages
plan: 19
subsystem: infra
tags: [cloudflare-r2, cloudflare-d1, cloudflare-workers, wrangler, algorithm-rename, cleanup]

requires:
  - phase: 07-event-pages
    provides: "07-16 renamed the algorithm identity in source; 07-17 published the full D-18 schema under the renamed vpr@ prefix; 07-18 moved the deployed client onto vpr@ exclusively"
provides:
  - "Zero sigma1@ objects in R2 and zero algorithm_id='sigma1' rows in remote D1 — the live third of the standing D-05 assertion, proven by before/after census and D1 read-back"
  - "The deployed Worker folds the renamed vpr identity (version 638da16c-d538-4551-b3a0-a2757a77061f)"
  - "A three-entry algorithms manifest (opr, epa, vpr) — the transitional fourth entry dropped"
  - "A re-runnable absence assertion (scripts/verifySubsetPublish.ts's expectAbsent entries) proving the retired id stays gone"
  - "docs/publish-budget.md and docs/worker-operations.md rewritten to say what was observed, with the delete-pass cost recorded"
  - "Three new tracked findings routed forward: the offseason-inclusive accuracy re-measurement, the developer-directed 9970-9999 demo-team exclusion, and a newly-discovered Worker CPU-budget regression"
affects: [07-20, future-accuracy-remeasurement, future-worker-perf-work]

actuals:
  tokens: 25874
  tasks: 4
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Destructive one-off ops tools live as committed scripts/*.ts, never as ad-hoc shell commands — refuse-by-default on the live set, hard count-band abort, credential-free census as the only trustworthy evidence of effect (deleteObject's 404-as-success contract makes exit code alone worthless)"
    - "Doc-only delete-pass sections are added dated and beside prior runs, never overwriting a frozen measurement record"

key-files:
  created:
    - scripts/deleteRetiredAlgorithmObjects.ts
    - scripts/deleteRetiredAlgorithmObjects.test.ts
    - .planning/todos/pending/exclude-offseason-demo-teams.md
    - .planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md
    - .planning/todos/pending/worker-tick-exceeds-cpu-budget.md
  modified:
    - scripts/verifySubsetPublish.ts
    - packages/harness/algorithmIdentity.test.ts
    - docs/publish-budget.md
    - docs/worker-operations.md
    - package.json
    - .planning/WINDOWS.md

key-decisions:
  - "Ordering is derived, not chosen: Worker deploy before manifest collapse (the deployed Worker writes artifacts under whichever id it folds and resolves modules through a manifest filter that throws when empty), collapse before D1 delete before R2 delete (reversible before irreversible; the fastest, most instantly-verifiable irreversible step first)"
  - "The R2 key enumeration is a deliberate superset (19,261 keys) over the actual existing population (~18,502 estimated, reconciled below) — an over-enumerated key costs one 404, an under-enumerated one is a permanent orphan"
  - "The delete pass's own exit code is never treated as evidence — the only proof of effect is a before/after stratified census over the same 60 sampled keys, credential-free, cache-busted"
  - "Corrected 07-17's unverified Class-A attribution for DeleteObject: Cloudflare's own pricing page (fetched live) lists it as a Free operation, not Class A or B"
  - "A genuinely new production finding (the deployed Worker exceeding its CPU budget on 100% of ticks captured hours after redeploy) was discovered while re-verifying the Live folding tier record; NOT fixed (apps/worker source is explicitly out of scope for this plan) and routed forward as a new WINDOWS.md ledger entry and a new todo"

patterns-established:
  - "A destructive ops tool's own success report (exit 0, a tally printed) is never the evidence a deletion happened — only an independent, credential-free, cache-busted before/after observation over the same sampled keys is"

requirements-completed: [EVNT-02, EVNT-03, EVNT-04, EVNT-05, EVNT-06]

coverage:
  - id: D1
    description: "Zero objects carrying the retired algorithm segment remain in R2 and zero rows carrying it remain in D1 — the live third of the standing D-05 assertion"
    verification:
      - kind: other
        ref: "pnpm verify:subset (35 entries, 0 failing) and pnpm verify:subset --team-only (7 entries, 1 pre-existing non-defect finding unrelated to this plan, documented in 07-17-SUMMARY.md)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The delete pass's effect proven by a before/after stratified census over the same 60 sampled keys, never by the pass's own exit code"
    verification:
      - kind: other
        ref: "reports/publish/07-19-census-before.json (48/60 present) vs reports/publish/07-19-census-after.json (0/60 present), same 60 keys"
        status: pass
    human_judgment: false
  - id: D3
    description: "The four production mutations ran in the derived order, each confirmed by read-back before the next began"
    verification:
      - kind: other
        ref: "npx wrangler deployments list (638da16c at 100%); public manifest fetch (3 ids, generation unchanged); D1 GROUP BY read-back (3 ids, live counts unchanged); delete.log (19,261/19,261 issued)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every phase document required to say the rename had not finished now says what was observed, with the establishing number"
    verification:
      - kind: other
        ref: "docs/publish-budget.md delete-pass section; docs/worker-operations.md Live-fold deploy record; algorithmIdentity.test.ts header"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every finding routed forward by 07-17 (and one newly discovered by this plan) lands as a tracked file, not a sentence that evaporates"
    verification: []
    human_judgment: true
    rationale: "Whether the routed findings (accuracy re-measurement scope, the demo-team exclusion's cost, and the newly-discovered Worker CPU regression) are prioritized correctly against other project work is a human planning decision, not a pass/fail test"

duration: "~50min (this continuation); Task 1 executed in an earlier session (predecessor, ~02:13-02:45); the R2 delete pass itself ran unattended ~03:21-03:23, unreported until this continuation picked it up"
completed: 2026-08-29
status: complete
---

# Phase 07 Plan 19: Cleanup — the one-way door Summary

**Deleted 19,261 enumerated `sigma1@` R2 keys and 4,599 retired D1 rows, redeployed the Worker onto the renamed `vpr` live-fold tier, and proved all of it by a before/after census rather than by any command's exit code — while discovering, and routing forward rather than fixing, a newly-observed Worker CPU-budget regression.**

## Performance

- **This continuation:** ~50 min (re-confirming Task 3's already-executed steps 1-3, executing/re-verifying step 4, all of Task 4)
- **Task 1 (predecessor, an earlier session):** committed `cc0630ab`, ~02:13-02:45 local
- **Task 3's R2 delete pass:** ran unattended ~03:21-03:23 local (per the log file's own NTFS creation/last-write timestamps) — executed by a predecessor session that was interrupted before it could report back or commit; this continuation discovered it complete on disk and independently re-verified every claim before trusting it
- **Tasks:** 4/4 complete (Task 1 tracer, Task 2 gate — both by predecessors; Task 3 sequence, Task 4 verification — this continuation)
- **Commits:** 5 (`cc0630ab`, `3abaab34`, `be4610f5`, `5afe4037`, plus this plan-metadata commit)

## Accomplishments

- **The live third of the standing D-05 assertion is proven, not declared.** `pnpm verify:subset` exits 0 with all 15 flipped `expectAbsent` entries GREEN (were RED at Task 1's close) and the two live-id presence controls (opr/epa at `2024casf`) still GREEN — the diff between Task 1's red run and this run is the whole proof.
- **19,261 enumerated R2 keys issued a `deleteObject` call** (`reports/publish/07-19-delete.log`, 19,261/19,261 `-> ok`, zero non-ok lines), proven effective by a stratified 60-key before/after census over the SAME sampled keys: 48/60 present before, 0/60 present after.
- **4,599 retired D1 rows deleted** (`league` 1 + `team` 4,598) by an exact-equality `DELETE`, confirmed by a `GROUP BY` read-back showing exactly three algorithm ids afterward with the three live ids' row counts unchanged from their pre-delete values.
- **The Worker redeployed onto the renamed live-fold tier** (version `638da16c-d538-4551-b3a0-a2757a77061f`, `env.LIVE_ALGORITHM_IDS` carrying `vpr`), and the algorithms manifest collapsed to three entries with its generation unchanged.
- **Corrected a measurement 07-17 flagged as unverified**: Cloudflare's own R2 pricing page (fetched live) lists `DeleteObject` as a Free operation, not Class A as 07-17 assumed — the 19,261 deletes this pass issued cost zero against either the Class A or Class B monthly allowance.
- **A genuinely new production finding, discovered and routed forward rather than fixed.** Re-tailing the same deployed Worker version hours after the redeploy showed 100% of observed ticks (7/7 across two capture windows) failing with `outcome:"exceededCpu"` and empty logs — contradicting the healthy ticks recorded immediately post-deploy. `apps/worker` source changes are explicitly out of scope for this plan, so this is documented, ledgered (`.planning/WINDOWS.md` #16), and routed to a new todo, not investigated to a fix.
- **WINDOWS.md ledger #13 closed** — the code fix landed in Task 1; only the ledger row was stale, now corrected to `resolved`.
- **Three new tracked findings** land as `.planning/todos/pending/` files with their measured figures, and three discharged todos moved to `completed/`.

## Task Commits

1. **Task 1: TRACER — the delete path proven end to end, both refusals fired, absence assertions RED** — `cc0630ab` (predecessor session)
2. **Task 2: GATE — developer approved `approve-full-cleanup`** — answered by the developer (no commit of its own; recorded in Task 3's precondition)
3. **Task 3: The sequence — deploy, collapse, delete D1 rows, delete R2 objects** — `3abaab34` (feat, `--allow-empty`: mutates R2/D1/a Cloudflare deployment plus gitignored `reports/`, no tracked file)
4. **Task 4: The live third proven, budget re-baselined, phase docs finished** — `be4610f5` (feat)
5. **Follow-up: ledger the newly-discovered Worker CPU-budget finding** — `5afe4037` (docs)

**Plan metadata:** (this commit, forthcoming)

## Files Created/Modified

- `scripts/deleteRetiredAlgorithmObjects.ts` — the one-off cleanup tool (Task 1, predecessor): `enumerateRetiredKeys`, `RETIRED_KEY_COUNT_BOUNDS`, `RefusedLiveAlgorithmIdError`, `EnumerationOutOfBoundsError`, `KeySegmentMismatchError`, the probe round-trip, the stratified census, the bounded-concurrency delete pass
- `scripts/deleteRetiredAlgorithmObjects.test.ts` — the refusal/enumeration-shape gate (Task 1, predecessor)
- `scripts/verifySubsetPublish.ts` — 15 event entries and the retired team entries flipped to `expectAbsent` with a required literal `version` (Task 1, predecessor); the `2025isios` seed correction closing WINDOWS.md ledger #13 also landed here (Task 1)
- `package.json` — one added script, `cleanup:retired-objects`
- `docs/publish-budget.md` — new dated delete-pass section (three distinct counts, the reconciled over-enumeration, the corrected Free-operation billing class, post-cleanup storage/D1 figures); machine-readable block and every earlier run's figures byte-identical
- `docs/worker-operations.md` — the D-04/D-05 transition rewritten to the finished state; a new dated deploy record; the newly-discovered CPU-budget finding documented as a known issue
- `packages/harness/algorithmIdentity.test.ts` — header rewritten to record all three thirds landed, with the live third's observed counts and date; exclusion list/pinned length/marker cap unchanged
- `.planning/WINDOWS.md` — ledger #13 closed (`resolved`); ledger #16 added (the new CPU-budget finding)
- `.planning/todos/pending/exclude-offseason-demo-teams.md`, `remeasure-accuracy-record-offseason-inclusion.md`, `worker-tick-exceeds-cpu-budget.md` — new
- `.planning/todos/completed/publish-match-predictive-variance.md`, `republish-playoff-bonus-arrays.md`, `static-shell-first-paint.md` — moved from `pending/`, each naming the plan that discharged it

## Read-back evidence (Task 3, all four steps re-confirmed by this continuation)

**Step 1 — Worker deploy.** `npx wrangler deployments list` shows version `638da16c-d538-4551-b3a0-a2757a77061f` at 100%. `apps/worker/wrangler.toml`'s tracked `main = "src/scheduled.ts"` and `LIVE_ALGORITHM_IDS = "vpr"` were confirmed by reading (never modified). Per the orchestrator's own record of the deploy moment: the deploy output listed `env.LIVE_ALGORITHM_IDS ("vpr")` alongside `env.TBA_BASE_URL` and the `MANIFEST`/`DB`/`ARTIFACTS` bindings and `schedule: * * * * *`; 4 post-deploy ticks then 3 more after the manifest collapse all reported `"ok":true, eventsConsidered:0`, no `live-tier-defaulted`, no `EmptyLiveAlgorithmTierError`.

**Step 2 — manifest collapse.** Fetched fresh with a cache-buster: `v1/manifest/algorithms.json` carries exactly three entry ids (`opr`, `epa`, `vpr`), generation unchanged at `47d020a4-1a16-4331-bd70-ce2f468bf2d1` from 07-17's run — `composeManifest` preserves it, so an unchanged generation confirms nothing but a drop happened.

**Step 3 — D1 delete.** Re-ran the identical `GROUP BY` predicate this continuation, fresh:

```
epa    league  1
epa    team    4773
opr    event   247
opr    league  1
opr    team    3746
vpr    league  1
vpr    team    4773
```

Exactly three algorithm ids; `sigma1` entirely absent. Matches the orchestrator's own pre-delete count (`league` 1 + `team` 4,598 = 4,599) and post-delete `DELETE` result (`changes: 4599`) exactly. `npx wrangler d1 info sigmascout-state` reports **27 MB** against the 500 MB free-tier ceiling (≈5.4% used).

**Step 4 — R2 delete (this continuation's primary responsibility).** Before touching anything: confirmed no stray `node`/`tsx`/`wrangler` processes related to the delete tool were running (`tasklist` + `Get-CimInstance Win32_Process` command-line inspection — the 12 `node.exe` processes present were all unrelated dev servers from a different project and this repo's own `pnpm --filter web dev`, none matching `deleteRetiredAlgorithmObjects`/`tsx`/`wrangler`). The delete log (`reports/publish/07-19-delete.log`, 19,280 lines: 19,261 `DELETE ... -> ok` + 19 progress lines every 1,000 keys, zero non-ok lines) showed the pass had already run to completion (NTFS creation `2026-08-29T03:21:29-04:00`, last write `2026-08-29T03:23:15-04:00`, ≈1 min 46 sec). Verified this was genuinely effective — not merely a clean exit code — by re-running `pnpm cleanup:retired-objects --census-only` fresh, over the SAME 60 keys `reports/publish/07-19-census-before.json` sampled (confirmed identical key lists): **0/60 present**, down from **48/60 present** before. Materialized the result at the plan's required path, `reports/publish/07-19-census-after.json`.

**Reconciling the over-enumeration.** The 60-key sample's 12 pre-delete absences concentrated entirely in the `event` kind (12/25 sampled `event` keys, 48%; 0/25 `team` keys and 0/10 `teams`/`events` keys absent). Extrapolating that per-kind rate — 48% of the full 1,581 `event` keys, 0% of the remaining 17,680 — projects **≈759 event keys absent**, for an estimated **≈18,502 objects actually existing** before the pass. That is a ≈1.5% difference from RESEARCH.md's independent ≈18,222 estimate — within the expected neighbourhood once the concentration is accounted for, not the "wildly different" split that would demand a halt.

## Decisions Made

- **The delete pass's own exit code was never treated as the evidence.** The primary proof throughout Task 3/4 is the credential-free, cache-busted before/after census over the same sampled keys — exactly as the plan's own first prohibition requires.
- **Corrected, not merely re-confirmed, 07-17's DeleteObject billing-class attribution.** Cloudflare's own pricing page (fetched live, 2026-08-29) states `DeleteObject` is a **Free operation**, listed separately from both Class A (`PutObject`, `ListObjects`, …) and Class B (`GetObject`, `HeadObject`, …). 07-17's Class-A guess was wrong; this pass's 19,261 deletes cost nothing against either allowance.
- **A newly-discovered production finding was routed forward, not fixed.** Re-verifying the "Live folding tier" record for Task 4 surfaced that the SAME deployed Worker version, hours after the healthy post-deploy ticks were recorded, is now failing 100% of observed ticks with `outcome:"exceededCpu"`. Fixing it would require an `apps/worker` source change, which this plan's scope boundary explicitly prohibits ("No source change under ... apps/worker"). Documented in `docs/worker-operations.md`, ledgered as `.planning/WINDOWS.md` #16, and routed to `.planning/todos/pending/worker-tick-exceeds-cpu-budget.md`.
- **The predecessor's manual re-implementation of the post-delete census (`reports/publish/07-19-census-manual.json`) was superseded, not trusted as-is.** This continuation re-ran the census fresh, independently, before relying on it — the file's own timestamp (03:32, shortly after the delete pass) was consistent with, but not sufficient proof of, current state hours later.
- **Attribution correction for WINDOWS.md ledger #13's resolution.** The correction note in this plan's own prompt did not specify which plan fixed the stale `2025isios` seed; reading `scripts/verifySubsetPublish.ts`'s own inline comment showed it was corrected by **plan 07-19 Task 1** (the predecessor), not 07-14 as initially drafted — corrected before committing.
- **Two new todos created beyond the plan's explicit list** (`remeasure-accuracy-record-offseason-inclusion.md` and `worker-tick-exceeds-cpu-budget.md`), per the plan's own must_haves.truths requirement that every finding 07-17 routed forward (or newly discovered here) lands as a tracked file rather than a SUMMARY sentence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a `docs/worker-operations.md` edit that briefly regressed the standing D-05 identity sweep**
- **Found during:** Task 4, running `pnpm test` after the doc edits
- **Issue:** My own new "Live-fold deploy" section wrote the literal string `` retired `sigma1@` `` (the id immediately followed by `@`), which matches `algorithmIdentity.test.ts`'s identity-shaped pattern for the retired id and is not one of that file's marker-exempted comment lines (this is prose in a Markdown doc, not a source comment) — `pnpm vitest run packages/harness/algorithmIdentity.test.ts` failed with a genuine new violation.
- **Fix:** Reworded the sentence to describe "the retired identity ... under its own prefix" without the `id@` adjacency, preserving the same factual content.
- **Files modified:** `docs/worker-operations.md`
- **Verification:** `pnpm vitest run packages/harness/algorithmIdentity.test.ts` back to 6/6 passing; full `pnpm test` back to the exact accepted baseline (1938 passed / 2 failed / 1 skipped).
- **Committed in:** `be4610f5` (part of Task 4's commit — caught and fixed before committing, never landed broken)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a bug in my own draft, caught by the plan's own test suite before commit)
**Impact on plan:** No scope creep; the fix is a wording change to prose I had just written, verified against the exact same gate the plan requires green.

## Issues Encountered

- **A genuine Worker production regression, unrelated to this plan's own changes but discovered while verifying its own claims.** Documented at length in "Decisions Made" and `docs/worker-operations.md` — resolved by routing forward (ledger #16, new todo), not by investigating to root cause, per this plan's explicit `apps/worker` source-change prohibition.
- **A commit-boundary imprecision, disclosed rather than silently accepted.** `git mv`'s auto-staging meant the three todo-directory renames (Task 4 work) landed in the Task 3 boundary commit (`3abaab34`) rather than Task 4's (`be4610f5`) — a `git mv` executed before the corresponding content edits were staged. No data was lost or duplicated; every file is in the correct final location and every edit is in a commit, just not perfectly task-partitioned. Not re-done via amend per this project's own git discipline (prefer new commits).
- **The predecessor's post-delete census used a different output filename than the plan specifies.** `scripts/deleteRetiredAlgorithmObjects.ts`'s `--census-only` mode (as built by Task 1) hardcodes its output to `reports/publish/07-19-census-manual.json`, not the `07-19-census-after.json` name Task 4's own action text names. Rather than edit the already-committed, already-tested tool (out of Task 4's declared file list), this continuation ran the census fresh and materialized the result under BOTH the tool's own name and the plan's required `07-19-census-after.json` path (a plain file copy — `reports/` is gitignored, so this is a local-artifact naming reconciliation, not a tracked-file conflict).

## Next Phase Readiness

- **07-20 can proceed against genuinely final pages.** The retired identity carries zero objects in R2 and zero rows in D1; the deployed manifest and Worker both agree on exactly three algorithm ids.
- **Three tracked findings await a future plan's attention**, none blocking 07-20: the offseason-inclusive accuracy re-measurement, the developer-directed exclusion of 30 fake demo-team keys (explicitly sequenced to land BEFORE 07-20 per the developer's own instruction — **flagged here as a scheduling note for the orchestrator**, since this plan did not implement it), and the newly-discovered Worker CPU-budget regression.
- **The Worker CPU-budget finding is the one item with genuine operational risk** if a real live event occurs before it is fixed — see `.planning/todos/pending/worker-tick-exceeds-cpu-budget.md` for the full detail and a suggested fix direction (lazy-import the algorithm modules past the idle-tick early return).

## Self-Check: PASSED

- `scripts/deleteRetiredAlgorithmObjects.ts` — FOUND
- `scripts/verifySubsetPublish.ts`'s `expectAbsent` entries — FOUND (verified via `pnpm verify:subset` output)
- `reports/publish/07-19-census-after.json` — FOUND
- `.planning/todos/pending/exclude-offseason-demo-teams.md` — FOUND
- `.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md` — FOUND
- `.planning/todos/pending/worker-tick-exceeds-cpu-budget.md` — FOUND
- `.planning/todos/completed/publish-match-predictive-variance.md`, `republish-playoff-bonus-arrays.md`, `static-shell-first-paint.md` — FOUND
- Commit `cc0630ab` — FOUND (`git log --oneline --all | grep cc0630ab`)
- Commit `3abaab34` — FOUND
- Commit `be4610f5` — FOUND
- Commit `5afe4037` — FOUND

---
*Phase: 07-event-pages*
*Completed: 2026-08-29*
