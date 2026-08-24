---
id: static-shell-first-paint
created: 2026-08-24
source: phase 05 wave 5 (D-19 close-out)
resolves_phase:
priority: high
---

# Paint the shell without waiting for JS

## What

Put real markup — a static shell or skeleton (ribbon frame, page chrome, table
placeholder) — into `apps/web/index.html`, so first paint does not depend on the
JS bundle downloading, parsing and executing.

## Why

`apps/web` is a pure client-rendered SPA. **Nothing paints at all until ~600 KB
of JS executes.** The LCP element is the ribbon's wordmark, which cannot render
until React hydrates. Measured on the shipped build (real CDP throttling, 4x CPU,
median of three runs — see `docs/first-paint-measurement.md`'s fourth entry):

| Network profile | Teams LCP |
|---|---:|
| Congested venue (1.6 Mbps / 150 ms) | ~4064 ms |
| Decent LTE (10 Mbps / 40 ms) | ~1100 ms |
| Good wifi (40 Mbps / 15 ms) | ~656 ms |

NAV-06's locked threshold is 2500 ms, so the congested-venue case fails by a wide
margin. SigmaScout's users are in arenas with thousands of people sharing wifi —
that row is the representative case for a competition weekend, not the pessimistic
outlier.

## Why not code splitting

Already tried and reverted in plan 05-08 (`51ad41d6`, reverted by `29364417`).
Route-level splitting defers only ~11 KB on Teams because the weight is in the
shared vendor chunk, not the route — and it buys an extra serialized round trip,
making Teams **slower on every profile measured** (+80/+44/+12 ms). Splitting
reshuffles which JS blocks the paint; it cannot make paint independent of JS.
Do not re-attempt it as a fix for this.

## Acceptance

Re-measure with the same method as `docs/first-paint-measurement.md`'s fourth
entry (both builds, real CDP throttling, median of three) and record a
before/after. The congested-venue profile is the one that has to move.

## Related

- `docs/first-paint-measurement.md` — four dated entries, full methodology
- D-19 in `.planning/phases/05-site-shell-navigation-browsing/05-CONTEXT.md`
- D-03 (deferred search-index split) is a **separate** question about artifact
  size, not bundle size — do not conflate them
