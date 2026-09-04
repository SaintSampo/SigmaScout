# Quick Task 260903-tk6: close the four surviving review findings - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Task Boundary

An adversarial review of quick task `260903-n2o` raised 22 findings; 19 were refuted and **3
survived**, plus a fourth the orchestrator verified independently. All four share one root cause:

**the eligibility mechanism is correct, but nothing would catch it breaking.**

The matrix itself was verified by hand against the real corpus and version file and still holds —
`vpr` eligible on {2025, 2026}, `epa`/`opr` on {2022–2026}. None of these findings says the rule is
wrong. They say the pins are weak, and in one case that the flag currently describes a parameter
set that is not the one running.

</domain>

<decisions>
## The four findings — LOCKED, all four in scope

### F-1 — `cli.ts:777` has ZERO coverage (CRITICAL, confirmed empirically)

`260903-n2o` closed the false-green at `publish.ts` and left an identical one at `cli.ts`.
`runSeasonsMode` (`cli.ts:750`) is **not exported**, no test imports it, and
`cli.season-carry.test.ts` exercises only the exported `runSeasons`, which never calls
`aggregateScores`. A reviewer reverted **both** new arguments — `corpusSeasons: seasons` and an
all-`[]` map — and got **788/788 harness tests passing**. That call site feeds `buildArtifact` →
`renderHtmlReport`, which stamps the headline badges.

**Preferred fix: extract the pair ONCE and use it at both call sites.** `cli.ts:777` and
`publish.ts:1517/1987` independently build the same
`{corpusSeasons: selectCorpusSeasons(db), selectedOnSeasons: selectedOnSeasonsFor(ids)}`. That
duplication is precisely why fixing one left the other exposed. One shared helper means one thing
to test and one thing to revert-proof.

The test must fail under BOTH reverts, and the executor must confirm that by actually applying
each revert, observing red, and restoring — not by assuming.

### F-2 — `vpr-adapt`'s provenance disagrees with the running params, LIVE (MAJOR, confirmed by execution)

`vprAdaptSelectedOnSeasons` (`selectionProvenance.ts:85`) gates on three conditions: file exists,
JSON parses, shape validates. `loadSearchWinnerVpr` (`cli.ts:205`) — which decides what actually
runs — gates on **five**, the extra two being a `winnerIndex` match and
`Sigma1ParamsSchema.safeParse(winner.params)`. That last one is documented at `cli.ts:206-224` as
the NORMAL post-version-bump state on a developer machine.

Measured on this checkout:

    module actually scored:   vpr-adapt @ 7.0.0+defaults-adapt   (untuned DEFAULTS)
    provenance claims:        selectedOn = [2022, 2023, 2024]    (from a stale Aug-16 artifact)

So the flag describes a parameter set that is not running. **This is the same
two-independently-derived-resolutions bug the whole `260903-n2o` task existed to close, one level
down** — and `selectionProvenance.ts`'s own header claims a test guards against exactly this,
while `selectionProvenance.test.ts` has no `vpr-adapt` case at all.

**Preferred fix: make disagreement STRUCTURALLY IMPOSSIBLE, not merely tested.** Have the
provenance resolution and the params resolution share ONE decision — e.g. `vprAdaptSelectedOnSeasons`
delegates to the same helper `loadSearchWinnerVpr` uses, returning `[]` exactly when that returns
undefined. Aligning two separate condition lists is an acceptable fallback ONLY if sharing is
genuinely impractical, and then a test must pin their agreement including the stale-artifact case
that is live right now.

Also correct the false doc comment at `selectionProvenance.ts:80-83` asserting the two already agree.

### F-3 — `publish.test.ts:2186` is insensitive to the regression that matters (MAJOR)

The test publishes `algorithms: [opr]` only, and `opr`'s registry entry is a hardcoded `() => []`.
So `selectedOnSeasonsFor(["opr"])` and a hand-built `{opr: []}` are byte-identical on that path —
**deleting `selectionProvenance.ts`'s entire contribution keeps the test green.** Only the
degenerate `{}` reverts it, and that reddens via `aggregateScores`' missing-key throw, not via any
eligibility value.

Repo-wide, **no test asserts `headlineEligible` for `vpr` in a published compare artifact.**

Fix: assert `vpr`'s published eligibility against the real provenance-derived matrix — 2022/2023/2024
ineligible, 2025/2026 eligible. The test must redden when `selectedOnSeasonsFor` is replaced by an
all-`[]` map, and the executor must confirm that by applying the mutation, observing red, and
restoring.

### F-4 — `docs/models/sigma1-sensitivity-screen.md:33` asserts three deleted mechanisms in present tense (verified by the orchestrator)

> "Holdout blindness: structural, not conventional — `tune.ts` refuses any requested season in
> `HOLDOUT_SEASONS` before any corpus read, independently re-checks every requested season via
> `seasonSplit`, and re-checks every produced score slice for `seasonLabel`/`headlineEligible`
> after scoring."

`HOLDOUT_SEASONS`, `seasonSplit` and `seasonLabel` are all deleted. This is the project's own named
historical failure — documentation describing a model that no longer exists.

**Scope note, verified by the orchestrator:** this is the ONLY doc naming the deleted mechanisms.
Five other `docs/models/*.md` mention "holdout" as dated prose recording measurements taken under
the old scheme — that is legitimate history and **must not be rewritten**.

The screen itself is a dated historical record, so the honest fix is to mark what was true AT THE
TIME and point at the current scheme — not to claim the old guards still run, and not to pretend
the screen used the new one.

</decisions>

<specifics>
## Specific Ideas

**Do NOT change the eligibility matrix.** `vpr` → {2025, 2026}; `epa`/`opr` → {2022–2026}. If any
of these fixes moves a value, the fix is wrong. F-2 may legitimately change `vpr-adapt`'s
selected-on set (that is the point), but no OTHER algorithm may move.

**Verify the working tree is clean before you start and after you finish.** The review's own
verification agents applied reverts to prove their claims and one did not clean up — the
orchestrator found `cli.ts` modified and a stray `packages/harness/__probe.test.ts` left behind, and
restored both. Run `git status --porcelain` first; if any tracked file is modified before you begin,
stop and report rather than committing someone else's experiment.

**The revert-confirmation discipline is the point of F-1 and F-3.** A test that "should" catch a
regression but was never observed failing under it is exactly what produced these findings. Apply
each named revert, observe RED in printed output, restore, then commit.

**Known traps** (project memory): never `timeout <n> pnpm <cmd>` — it swallows output and exits 0.
Run `npx vitest run` from the REPO ROOT. Run `npx tsc --noEmit` separately inside `apps/web`; the
root tsconfig only covers `packages/**`/`scripts/**`.

**Fixtures** `apps/web/src/routes/__fixtures__/compare-*.json` must NOT change.

**Do NOT** run a tuning search, promote, publish, or full harness replay.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/260903-n2o-.../260903-n2o-SUMMARY.md` — the task under review
- `packages/harness/selectionProvenance.ts` — F-2's subject; its header claims a guard that does not exist
- `packages/harness/cli.ts:205-224` — `loadSearchWinnerVpr`'s five gates, and the comment describing the stale-artifact state as normal
- `packages/harness/cli.ts:750-780` — `runSeasonsMode`, unexported and uncovered
- `packages/harness/publish.ts:1517,1987` — the duplicated pair F-1 should unify

</canonical_refs>
