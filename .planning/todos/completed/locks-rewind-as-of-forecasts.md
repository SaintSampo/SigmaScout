---
id: locks-rewind-as-of-forecasts
created: 2026-10-05
source: quick 261005-04t
priority: medium
---

# A rewound Locks view predicts with later knowledge, and the size of that is unmeasured

## What happens today

Both Locks tabs can be rewound to an earlier point in the season. A rewound view prices the events
that were still ahead at that point with:

- the odds this site published just before each of their matches, and
- each team's rating from the END of that event.

So a view rewound to week one predicts week four with ratings that already know weeks two and
three. Its predictions know more than a forecast actually made at that point could.

Quick 261005-04t says so on screen (a note under the picker on both tabs) and on the Methodology
page. It quotes no figure, because there is none to quote.

## What has been measured, and what has not

The only measurement is inside ONE event: `docs/models/rewind-overconfidence-gap.md`, the event
page's rewind. ACROSS WEEKS, which is the case the Locks tabs are in, the gap is unmeasured.

## Two ways forward

1. Measure the gap across weeks. Compare a rewound view's advancement chances at week N against
   what a forecast frozen at week N would have said, over the seasons the corpus holds.
2. Publish true as of date forecasts from stored weekly snapshots, so a rewound view reads what
   was actually predicted then. The main checkout already holds two such snapshots:
   `data/local-publish/districts-asof0307` and `data/local-publish/districts-asof0404`.

The first tells us whether the second is worth its storage and publish cost.

## Closed (2026-10-05)

Shipped by quick task 261005-5g0. A rewound Locks view is now a true as-of forecast: the state is
captured per match at fold (offline publisher and live Worker) and rebuilt in the browser at the
stop, so every match still ahead is priced from the ratings and odds as they stood then. The rewind
note and the Methodology sentences saying a rewound view knows more are gone.

The stored weekly snapshots option (way forward 2) was rejected: Jacob wants no script that runs
weekly or on any other period. How well a rewound stop predicts across weeks (way forward 1) is
still unmeasured.
