---
id: vpr-retirement-make-features-algorithm-agnostic
created: 2026-09-08
source: quick task 260908-5wd — analysis for dropping VPR, written after the Swing Factor / band layer shipped
resolves_phase:
priority: high
---

# Making VPR's three privileges algorithm-agnostic

The developer's framing from the Swing Factor work applies here too: there is the ALGORITHM
(level 1, predicts scores) and there are SIGMASCOUT'S FEATURES (level 2, built on top and computed
identically for every algorithm). VPR is currently special in three ways, and each is a level-2
feature that got built inside level 1.

The Swing Factor / band work is the template: it moved a VPR-only display quantity to a
pipeline-computed field every algorithm carries, and deleted the special case.

---

## 1. Live updates for every algorithm — blocked by a HARD budget wall, with a clean way through

**The wall is arithmetic, not effort.** `estimateEventSubrequestCost` (`scheduled.ts:814`):

```
cost(n, teams) = 2 + n*2 + n*2*(1 + teams)
                 ^          ^
                 |          Phase B: 1 event artifact + 1 per team, READ AND WRITE, per algorithm
                 Phase A: state read + write, per algorithm
```

Usable per event is **41** (cap 50 − reserve 4 − tick fixed 3 − event preflight 2). At a typical
6 touched teams:

| algorithms per tick | cost | fits in 41? |
|---|---|---|
| 1 | 18 | yes |
| **2** | **34** | **yes** |
| 3 | 50 | no |
| 4 | 66 | no |

So "all four fold on every tick" is **impossible** without changing the I/O shape. The dominant
term is `n*2*(1+teams)` — per-team artifact reads and writes — and R2 has no batch API, so it
cannot be collapsed the way `stateStore`'s D1 access already is (one subrequest for 21 keys).

**The way through: rotate algorithms across ticks rather than folding all of them every tick.**
Two per tick fits comfortably at 34. With four algorithms that gives every algorithm a fold every
**2 minutes**, against a stated freshness target of ~1–3 minutes. The Worker already has the
machinery — it rotates EVENTS with a no-starvation guarantee (`scheduled.test.ts:546`), and the
same discipline applies to algorithms.

Design notes if this is built:
- Rotate on a persisted cursor, not on `Date.now() % n` — a tick that defers must not skip an
  algorithm's turn, which is exactly what the event rotation's no-starvation test already pins.
- The per-tick cost check in `liveAlgorithmTier.test.ts:407` asserts against `ids.length`; it
  becomes an assertion against the per-tick ROTATION SIZE, not the tier size. Keep the
  counterfactual that 3-per-tick overflows — it is the reason the rotation exists.
- Freshness becomes `rotationPeriod × cronInterval`. State that in `worker-operations.md` rather
  than letting a reader assume every algorithm is a minute fresh.

**CPU is the second constraint and is thinner than the subrequest budget.** Idle ticks already run
5–9 ms against a 10 ms limit, and real folds have been measured at 17–38 ms
(`worker-operations.md:289-337`). Two algorithms per tick roughly doubles the fold work. The rule
recorded there is that ONE tick over budget is absorbed but EVERY tick over budget takes the site
down, so this needs measuring on a real fold before it is trusted — not assuming.

---

## 2 and 3 — the simulation sidecar and the RP predictor are ONE piece of work

These look like two items and are one, because the sidecar depends on the RP predictor.

**The sidecar is already algorithm-agnostic.** `packages/harness/preSchedule.ts`'s
`buildPreScheduleSidecarForEvent` is generic over algorithms via an injected `predict` closure —
pure, no corpus read, no model import. It is not the blocker.

**The blocker is that the RP predictor lives inside Sigma1.** `Prediction.redRpPmf`/`blueRpPmf` are
populated only by `sigma1/index.ts` (via `predictAllianceRpMoments` and `RP_RULE_MODULES`), so a
simulation for OPR/EPA/BPR has no ranking-point distribution to draw from and the Simulation tab is
plain-disabled for them (D-04).

**What the Swing Factor work just unblocked.** `predictAllianceRpMoments` needs a score MEAN and a
score VARIANCE. Until now only VPR and BPR had a variance at all, which is precisely why RP was
VPR-only. Every algorithm now publishes a per-alliance variance — the swing band — so the input
that was missing exists.

**Verify before committing to this, because it may not be sufficient.** The RP rules likely need
more than an alliance total: a bonus criterion phrased over auto or endgame points needs
COMPONENT-level predictions, and OPR publishes only `total`. Check `RP_RULE_MODULES` for what each
season's rules actually read. Three possible outcomes, and the answer decides the shape:
- Rules need only the total and its variance → RP generalises cleanly to all four algorithms.
- Rules need components → it generalises to the algorithms that publish components (EPA, BPR, VPR)
  and not to OPR, which is an honest limit to state rather than paper over.
- Rules need Sigma1's per-team covariance specifically → the level-2 rewrite is bigger, and the
  right move is a SigmaScout-layer RP model built on published fields only, mirroring
  `swingFactor.ts`.

**Recommended shape either way:** a new `packages/harness/rankingPoints.ts` at the same level as
`swingFactor.ts` — computed at publish time from published fields, for every algorithm, and
published as its own field rather than reached for inside a model. Then `sigma1/rp/` is deleted
with VPR instead of being ported.

---

## Suggested order

1. **Defect 2 of the live-match plan** (the Worker's swing accumulator, shape bump 9 → 10). It has
   to ride a re-seed, and the VPR retirement forces one anyway.
2. **The RP investigation above** — cheap, decides the shape of the biggest remaining piece, and
   its answer determines whether the Simulation tab can be offered for OPR at all.
3. **Algorithm rotation** for live updates, measured on a real fold before being trusted.
4. **Retire VPR** once nothing above still needs it.

Do 1 and 3 in the same deploy if possible: both touch the Worker's tick, and both want the re-seed.
