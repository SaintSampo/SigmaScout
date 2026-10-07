---
id: locks-loading-cells-read-not-available
created: 2026-10-07
source: quick 261007-3ik
priority: low
---

# Loading Locks cells read "not available" for about two seconds

## What is wrong

On both Locks tabs, clicking Season start (or any rewound stop from Live) widens the fetch set to
every started event. While those event artifacts load and the as-of run has not landed, every open
cell prints the unavailable word, the same word an event with no published data gets. The Status
column and the predicted cutoff already read Pending at that moment, so the table contradicts
itself for a moment.

Measured 2026-10-07 in a headless Chromium against live 2026pnw data, sampling every two seconds
after the click: at 2 s every cell was `kind: "unavailable"` with the status "Pending"; from 4 s on
the cells were open with distributions and the status read In range.

## Where

`apps/web/src/components/districts/districtLedgerRows.ts`, the open category branch: an open
category whose distribution is not in the map yet returns `{ kind: "unavailable" }`. The same
branch serves a genuinely unpublished event, so the row builder cannot tell loading from missing.

## Why it is not a trivial fix

`DistrictLedgerCell` has three kinds: `final`, `open`, `unavailable`. A loading cell needs a fourth
(or an `unavailable` with a reason) plus copy in `districtLedgerCopy.ts`, a cell style, the Champ
tab's union in `champLedgerRows.ts`, and tests on both tabs. The row builder would also need to
know the run is pending (`useDistrictLedgerData`'s `runPending`, or `asOf.status === "loading"`),
which it does not receive today.

## Closed

Closed 2026-10-07 by quick task 261007-4qr, commit 2607ee7c (the row builder and renderer half in
d0f98653).

The unavailable cell variant gained an optional `pending: true` rather than a fourth kind, and
`buildDistrictLedgerRows` and `buildChampLedgerRows` take a `distributionsPending` option that sets
it on an open cell, event total, subtotal or grand total with no distribution yet. Each tab computes
that option from `artifacts.isLoading || data.isLoading || data.runPending`, the same expression that
holds the Status column at Pending, and `LedgerCell` and `GrandTotalContent` print "pending" with
`data-cell="pending"` for it. An event the run refused, or one with no published data, still prints
"not available".
