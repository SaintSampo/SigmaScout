---
id: 260912-iur
slug: add-an-rp-ablation-flag-to-the-state-pro
created: 2026-09-12
kind: quick
status: planned
---

# Add an RP-ablation flag to the state probe

## Why

`rp-fold-exceeds-worker-cpu-budget` says a realistic mid-quals tick costs **13 ms p50 / 28 ms p90**
in Phase A alone against a **10 ms sustained** budget. A standing pre-season gate
(`docs/worker-operations.md`) now forbids opening any live window until that closes.

Before choosing among four unpriced fix directions, one cheap thing is owed. Phase 9 verification
established, via `git log -S`, that **the expensive upcoming-repricing loop predates Phase 9**
(`dabe9acd`) — Phase 9 only added `analyticRpPmf` *into* an already-costly loop. So **Phase 9's own
share of the overrun is currently an inference, not a number**, and sealing or fixing on an
inference is this project's named failure mode.

`apps/worker/src/stateProbe.ts` already takes `folded` and `upcoming` counts. It has no RP on/off
flag. Adding one turns the inference into a measurement, and aims the eventual fix at the real
dominant term rather than the assumed one.

## Task 1 — establish what Phase 9 actually added, from git, not from assumption

**Do this first and let it drive Task 2.** Do not guess which operations are Phase 9's.

Determine, from history, exactly which per-match operations Phase 9 introduced into the live tick's
Phase A. Useful starting points: `git log -S analyticRpPmf -- apps/worker/src/scheduled.ts`,
`git log -S rpFieldsFor`, the Phase 9 plan summaries under
`.planning/phases/09-analytic-ranking-points-browser-side-simulation/` (D-21 is the live-Worker RP
deliverable), and `dabe9acd`/`63596da3` for what the loop looked like before.

Write the finding into the SUMMARY as a short list: *these operations are Phase 9's; these predate
it.* The ablation must skip **exactly** the first set. In particular, decide on evidence — not on
plausibility — whether each of these is Phase 9's or pre-existing: the `bandFor` calls, `rpFieldsFor`,
`foldObservedRp`, and the `RpMomentsAccumulator` resume.

## Task 2 — the flag

Add an `rp` query parameter to the probe, parsed alongside `folded`/`upcoming` in the same options
struct (`parseIntParam`/`clampInt` are at `stateProbe.ts:136-143`, the parse is at `:166-177`).

- **Default ON.** `rp` absent must leave the probe's behaviour and output byte-identical to today,
  so the existing measurements stay comparable. Pin that with a test.
- When off, skip exactly the operations Task 1 identified, in **both** the folded loop
  (`:562-594`) and the upcoming loop (`:597-610`).
- Report the flag's value in the JSON response so a result can never be misread as the wrong arm.

**The counter needs care.** `rpPmfsProduced` is asserted by `stateProbe.test.ts` **by equality**
against `folded + upcoming`, and its own comment explains that one-increment-per-match is what makes
that threshold meaningful. With RP off it is 0 by construction. Update the test to pin **both** arms
rather than loosening the assertion to an inequality — a `>= 0` assertion would pass vacuously.

## Task 3 — preserve the probe's guarantees

These are held by `apps/worker/test/stateProbe.test.ts` and must not weaken:

- the probe's transitive import graph must still not reach `scheduled.ts` or `artifactWriter.ts`
- no write helpers; no banned write/timing identifiers in the comment-stripped source
- `wrangler.probe.toml` shape unchanged: no R2, no KV, no triggers, exactly one D1 binding
- `probeSelectionsFor` stays deep-equal to the real `selectionsFor`

If adding the flag would require importing anything new from `scheduled.ts`, **stop and report** —
that means the design is wrong, not that the test should change.

## Verify

- Full suite from the **repo root** (`npx vitest run`), never from `apps/web`.
- Both typechecks: root `tsc --noEmit` returns clean while real `apps/web` errors exist, so run the
  `apps/web` tsconfig too.
- Never wrap a command as `timeout <n> pnpm <cmd>` — it swallows output and exits 0 regardless.

## Out of scope

Do **not** deploy the probe, run it, or touch live D1 — that is network work and runs from the main
context afterwards. Do **not** change `apps/worker/src/scheduled.ts`; this task measures the tick,
it does not fix it. Do **not** open a live window. Do not read or print `.env`.

## Constraints

`git add -- <explicit path>`, never `git add -A` (incident `f0c7af48`). A concurrent session is
active on this checkout and has already corrupted `.planning/STATE.md` once today — **do not touch
STATE.md**; the orchestrator owns that row. Re-read the tail of any file before editing it.
