# Champ Locks tab, 2026-09-26

Eight shots, four positions at 1440x1600 and at 390x1400. Taken with no network: the built
app was served from `apps/web/dist` by a local static server and every `/v1/**` request was
answered from `data/fixtures/phase10` by a Playwright route handler.

**The fixture is `district-2026pnw.json`, generation 2026-09-14.** It predates three fields the
publisher emits today: `state` blocks, `awardProfile` and `bakedEvents`. Where a shot needed one
of them, it is stamped on in the harness and the file name says so. Every point value, award,
roster, slot count and cut line in these shots is the published one.

| File | Position | What it shows |
| --- | --- | --- |
| `now-both-tiers-final-{1440,390}.png` | Now, with an all-final `state` block stamped on all nine events | The acceptance render. 126 teams, two rows each, Today's line 182, chips `Locked 20 / In range 1 / Out of range 1 / Locked out 104`, `Locked · winner` on 2046 and 2910, `Locked · award` on 9023, and the em dash in all five DCMP cells of the 75 teams that never went. Every number is TBA's own. |
| `district-season-as-published-{1440,390}.png` | Now, fixture exactly as published | The HONEST degradation of a pre-phase-10 artifact: no `state` blocks means nothing is started, no `bakedEvents` means no sidecar is fetched, so every district cell reads "not available" and every DCMP cell reads "not yet priced". The same artifact renders the same way on the District Locks tab today. |
| `rewound-into-the-district-season-{1440,390}.png` | After week 2, all-final states stamped | The rewind rail runs through all eight district events. The DCMP is unpriced (no `2026pncmp` event artifact or presim sidecar exists in the fixture set), so the DCMP row reads "not yet priced" and the grand total is labelled "district only". The district cells read "not available" because the fixture carries no `awardProfile` and the Awards category is open at this position. |
| `rewound-predicted-award-profile-standin-{1440,390}.png` | After week 2, all-final states AND a STAND-IN `awardProfile` on every team | Layout only. The stand-in (`bucket: "none"`, veteran, no prior judged awards) is NOT the published profile, so the blue figures here are not the published predictions. It exists to show the predicted layout: blue boxed cells with `~median` and `likely a-b`, `~99% to be there` on the DCMP row label, "district only" under the grand total. About 32 teams still refuse per team and print "not available", which is the stand-in's own doing. |

## What was not reachable

**A position with the District Championship priced and its field still open.** That needs a
`2026pncmp` event artifact or a `2026pnw/2026pncmp` presim sidecar, and the fixture set carries
neither. The component test `ChampLocksLedger.test.tsx` covers that position instead, with a
synthetic artifact and the real Worker protocol.
