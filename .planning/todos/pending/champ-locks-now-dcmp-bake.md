---
id: champ-locks-now-dcmp-bake
created: 2026-10-07
source: quick 261007-mxf
priority: medium
---

# Bake the DCMP over the Locked plus In range field at the Now position too

## Why this matters

Quick task 261007-mxf made every rewound Champ Locks stop before the District Championship price the championship from a simulated field: the teams the District Locks tab shows as Locked, Prequalified or In range at the stop, baked once in the Web Worker over generated schedules at the stop's as-of state (`useSimulatedDcmpBake.ts`). Teams outside that field read "out of range" with a labelled district only grand total.

The Now position was left on purpose (CONTEXT decision): until the DCMP field is a fact it still prices the championship from the walk-forward field rank estimate (`hypotheticalDcmp.ts`) and reads "not yet priced" in the four category cells. So the same district reads two different ways depending on whether the reader is rewound by one step or at Now.

## What to do

1. Add a DCMP only as-of bake at the Now position, for the window before the field is a fact: plan the championship GENERATED over every district team at the live cut, then bake it over the shown Locked plus In range field, exactly as a rewound stop does.
2. Do NOT route the live district events through the as-of path. The Now pricing of live district events stays the shipped Live assembly (`assembleLiveDistrictEvents`), byte for byte; only the championship joins the as-of path.
3. Keep `hypotheticalDcmp.ts` and `scripts/measureChampCutoff.ts` as they are: the champ cutoff tuning still reads the estimate.
4. Retire "not yet priced" at Now once this lands, everywhere except the instant before the bake's inputs resolve.

## Known limits of 261007-mxf

- **A district whose championship is not on the artifact yet** (the live season before registrations) keeps the estimate at rewound stops too. `dcmpEventKeysFor` is empty there, so there is no event key to plan the bake under. A fix needs a synthetic championship key (or the TBA event key fetched ahead of registrations) to plan and fold under.
- **A divisioned championship (FIM) or a two championship district (2026 California)** is simulated as ONE eight alliance event over the whole field, so alliance selection and playoff points are drawn from one bracket. A per division simulation needs a rule that assigns each simulated team to a division before the bake.
