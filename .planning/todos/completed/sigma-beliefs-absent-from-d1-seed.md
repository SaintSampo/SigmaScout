# The D1 seed does not carry the Sigma Score beliefs, and never has

**Found:** during plan 09-08's planning pass, re-verified against HEAD during its execution (2026-09-11).
**Filed by:** plan 09-08 (D-21), which deliberately did NOT fix it. See "Why not fixed here" below.
**Severity:** high — a silent live/offline divergence in BPR's published match bands.
**Status:** pending.

## The defect

`packages/harness/publish.ts`'s seed-emission block applies `withSwingBeliefs` (and, as of
plan 09-08, `withRpBeliefs`) and nothing else. It does **not** apply `withSigmaBeliefs` or
`withSigmaPopulation`.

It could not, even if asked: `SigmaScoutLayer` exposes **no accessor for the Sigma beliefs at
all**. It has `swingBeliefs()` and now `rpVariableBeliefs()`, but nothing returning the Sigma
Score accumulator's raw running state or its population statistics.

`withSigmaBeliefs` and `withSigmaPopulation` are called in **exactly one place in the whole
repository** — the Worker's own tick write path in `apps/worker/src/scheduled.ts`. Verify with:

```bash
grep -rn "withSigmaBeliefs\|withSigmaPopulation" --include=*.ts . | grep -v "\.test\.\|stateSnapshot.ts"
```

## How it got here

Quick task `260910-wg8` wired the RESUME half (`readSigmaBeliefs`/`readSigmaPopulation` in the
Worker) and the Worker's own PERSIST half, and left the SEED half unwritten. Its SUMMARY
describes the remaining work as "seed-and-deploy", which reads as purely operational — that
phrasing is why this was easy to miss for a month.

## The consequence

A Worker resumed from a **fresh** seed has no Sigma beliefs and no Sigma population. It therefore:

1. Cold-starts every team's Sigma Score from the flat prior, and
2. Silently falls back to the flat talent prior (`MIN_POPULATION_FOR_TALENT_PRIOR`) because the
   population statistics are absent.

It then computes BPR's match bands from that flat prior until its own ticks have folded enough
matches to recover — while the offline publisher computed the same matches' bands from the whole
season. Live and offline disagree on every band, with **no error, no NaN and no malformed row**:
both sides look perfectly healthy and only the numbers differ.

This is the exact failure the shape 10 -> 11 bump was made to prevent, reintroduced through the
**seed** rather than through the **shape**. The shape check cannot catch it: the seeded row
declares the current shape and is structurally valid — it is simply missing an optional passenger
key, which `readSigmaBeliefs` correctly reads as "no history".

**It is latent only because nothing is live.** It goes live the moment a seed-and-deploy happens
and an event starts folding.

## The fix shape

The three-line mirror of what plan 09-08 just did for RP:

1. Add a `sigmaBeliefs()` accessor (and a population accessor) to `SigmaScoutLayer`, modelled on
   its own `swingBeliefs()` / `rpVariableBeliefs()` — raw running state, not a finished figure,
   including single-observation teams.
2. Build the per-algorithm map in `publish.ts` beside `finalSeasonSwing` / `finalSeasonRp`, from
   the same `layers` map and therefore the same offseason-inclusive population.
3. Chain `withSigmaBeliefs` / `withSigmaPopulation` into the seed-row construction before
   `emitSeedSql`.

Note that the population is a **league-row** value, so step 3 is not a pure copy of the RP case —
`withSigmaPopulation` targets `scopeKind: "league"`.

## Verification it needs

The **band-stream digest**, not the RP digest — `apps/worker/test/scheduled.replay.test.ts`
already has the band arm, and `apps/worker/test/scheduled.rp.test.ts`'s two-arm construction
(prior event seeds, live event resumes) is the pattern to copy.

## Why plan 09-08 did not fix it

It is a **different feature's seed wiring with a different verification**. Plan 09-08's scope is
ranking points, its digest is the RP pmf stream, and its state-shape bump is about RP beliefs.
Silently widening a Worker RP plan into a Sigma plan is how scope becomes untraceable, and the
fix belongs with the band digest rather than the RP one.

**It is urgent in one specific sense:** 09-10's republish plus 09-08's seed-and-deploy is
precisely the event that takes this from latent to live. If a seed is happening anyway, this is
cheap to fix first — and plan 09-08's Task 4 checkpoint briefing surfaces it for exactly that
reason.

---

## RESOLVED 2026-09-11

Fixed in commits `af09b23d` (wiring) and `062bb36e` (tests), during Phase 9 — surfaced by plan
09-08, which filed it rather than fixing it inline, and then authorized by the developer ahead of
the pending D1 seed-and-deploy.

`SigmaScoutLayer.sigmaBeliefs()` / `.sigmaPopulation()` now expose what `SigmaScoreAccumulator`
already held (`beliefsByTeam()` existed at `sigmaScore.ts:507` and was simply unreachable from the
layer), and `publish.ts` chains `withSigmaBeliefs` into the team rows and `withSigmaPopulation`
into the league row beside the existing Swing and RP passengers.

No shape-version change — both keys pre-existed; shape stays 15.

**Proven non-vacuous by three mutations**, each restored. The load-bearing one: forcing
`sigmaPopulation()` to return `undefined` produced *different bands from the same beliefs* — the
live/offline divergence this todo describes, reproduced in miniature.

Without it, a Worker resumed from a fresh seed would have cold-started BPR's bands from the flat
prior while serving fully-warmed artifacts, with both sides looking healthy.
