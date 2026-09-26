---
quick_id: 260925-rpj
date: 2026-09-25
description: Advancement chance per team on the Road to District Champs tab
status: planned
---

# Advancement chance per team

Give every **In range** and **Out of range** team a chance of qualifying on district
points, computed from ONE district wide run set inside the existing district Web Worker,
printed under its status chip, consistent with the verdicts, and stated on the
methodology page.

## The number

For `SIMULATION_DRAWS` (1,000) runs under `DEFAULT_SIMULATION_SEED`, draw every team's
grand total from the grand total distribution the browser already holds for it (the
convolution of its event pmfs plus the rookie bonus; a finished team is a point mass at
its earned total). Rank the points race per run and count the runs in which the team sits
inside the points slots.

The slot count is `locks.ts`'s own `lockSlots`: `dcmpSlots` minus the consuming award
qualifiers at this position minus the reserved pending Impact slots. The pool is
`locks.ts`'s own narrowed pool. Both come from the SAME derivation
`computeLocksWithQualifiers` used, so the chance and the verdict can never see different
slot counts.

Ties at the last slot count as OUT (the lock rule's own tie philosophy, applied the other
way round): a team is inside a run when the number of OTHER pool teams whose drawn total
is `>=` its own is `< lockSlots`.

Two consistency facts this choice buys, each pinned by a test:

- a ceiling locked team reads 100% in every run (its floor already beats every rival that
  could reach it, and `lockSlots` is the count its lock was proved against);
- a locked out team reads 0% in every run (`lockSlots <= pointsSlots`, and at least
  `pointsSlots` rivals' floors sit strictly above its ceiling).

## Consistency with the verdicts (binding)

Locked, `Locked · award` and Prequalified print no chance. Locked out prints no chance.
Only In range and Out of range print one. A run set that contradicts a verdict (a Locked
team below 100%, a Locked out team above 0% — reachable only through the POOLED lock,
whose conservation argument the independent draws do not honour) is counted in `gaps` and
never printed.

## Independence, stated

Totals are drawn independently. Inside one event two teams cannot both be captain one, so
the true joint is correlated. The methodology paragraph says so in one sentence and the
grand total drawer caption says the chance rests on this distribution.

## Printing (sketch 020's language rules)

Never above 99 (print `99%`), never a number under 5 (print `<5%`), never the word
eliminated. One line under the chip, `71% chance`, in the Team cell's small muted meta
style, through the copy module with pinned strings. The stat line gains nothing.

## Tasks

1. **`packages/core/districts/locks.ts`** — export `pointsRaceSlots(teamKeys, slots,
   qualifiers, reservedSlots)` returning `{ poolKeys, pointsSlots, lockSlots }`, and
   rewrite the private `qualifierPool` to delegate to it so there is exactly one
   derivation. No verdict moves.
2. **`packages/core/districts/advancementChance.ts`** (new, browser safe, typed arrays,
   deterministic) — `advancementChances(inputs, draws, seed)`. Inverse CDF draw per team
   per run from one `mulberry32` stream salted away from the ledger's two; per run a
   counting histogram over the integer totals and one suffix pass, so the whole run set is
   O(draws x (teams + maxTotal)). Refuses rather than fabricates: an empty distribution, a
   non positive denominator, a duplicate team key, an out of range draw count.
3. **`apps/web/src/workers/districtSimulationProtocol.ts`** — a second request type
   (`chance`), its bound-and-shape validator, `runDistrictAdvancementChanceJob`, and a
   `runDistrictWorkerJob` dispatcher on `message.type`. The worker entry forwards into the
   dispatcher (still exactly once, still no arithmetic).
4. **`apps/web/src/components/districts/districtLedgerStatus.ts`** — expose
   `awardQualified` and `prequalified` on the status model, so the chance request is built
   from the verdicts' own qualifier sets rather than a second derivation.
5. **`apps/web/src/components/districts/districtLedgerChances.ts`** (new, pure) —
   `buildAdvancementChanceRequest` (returns `undefined` for an unpublished capacity, a
   pending run, or ANY unavailable grand total: a ranking over an incomplete field is not
   the line's own distribution) and `reconcileAdvancementChances` (printable map + gaps).
6. **`apps/web/src/components/districts/useDistrictAdvancementChance.ts`** (new) — the
   second Worker lifecycle, mirroring `useDistrictSimulationRun`: construct lazily inside
   the effect, terminate on the terminal message, unmount cleanup as a backstop, and post
   NOTHING when there is no request.
7. **`districtLedgerCopy.ts`** — `districtLedgerChanceLine`, the two thresholds, and the
   grand total drawer's chance caption replacing the "this page does not compute" one.
8. **`DistrictLedger.tsx`** — the line under the chip, and the drawer caption only where a
   chance is actually printed.
9. **`methodology/districtLedgerContent.ts`** — one paragraph, at most three sentences, no
   dash characters: what the chance is, that the totals are drawn independently, and that
   it never overrides a lock.

## Tests

Pure: analytic two team one slot fixture within Monte Carlo tolerance; ties count as out;
determinism under one seed; a locked out team never reads above zero; a ceiling locked
team reads exactly 1; every refusal. Protocol: the new message round trips through
`structuredClone` and a malformed one is refused by name. Component: the line prints only
for In range and Out of range, respects 99 and `<5%`, and is absent on a finished
district. Copy: the strings are pinned. Methodology: the voice gate passes.

## Constraints

Repo root `npx vitest run` green, four tsconfigs clean, `pnpm measure:ledger-tenets` still
zero on both tenets (the chance touches no verdict), no `±`, token only colours, every
existing `data-testid` kept, `package.json` untouched, no network.
