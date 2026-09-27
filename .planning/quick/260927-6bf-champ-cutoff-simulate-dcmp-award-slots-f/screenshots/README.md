# Champ Locks simulated cutoff, 2026-09-27

Five shots of the Champ Locks tab at 1440 wide, taken with no network. The built app
(`apps/web/dist`, commit 52883284 plus the chip width tweak in the Task 3 commit) was served by
`vite preview` on a local port, and every `/v1/**` request was answered by a Playwright route
handler:

- `v1/manifest/algorithms.json`: a stand in manifest naming `spr@7.0.0+baseline`, the version the
  phase 10 event fixtures carry.
- `v1/districts/2026.json` and `v1/district/2026{fnc,pnw}.json`: `data/local-publish/districts`,
  which carry `state` blocks and award profiles.
- `v1/event/2026{wa,or}*.json` and `v1/district-presim/2026pnw/*.json`: `data/fixtures/phase10`.
- Everything else: 404. That includes all seven FNC event artifacts and `2026pncmp`, none of which
  exist locally.

| File | Position | Stat line | Backtest, same position | Chips |
| --- | --- | --- | --- | --- |
| `fnc-end-of-district-1440.png` | `2026ncpem:awards` (After week 4, end of the district season) | Predicted cutoff ~217, no likely range | 217 (193 to 243) against the published 231 | Prequalified 0, Locked 0, In range 10, Out of range 42, Locked out 38 |
| `pnw-end-of-district-1440.png` | `2026waahs:awards` (After week 4, end of the district season) | Predicted cutoff ~186, no likely range | 186 (163 to 205) against the published 182 | Prequalified 0, Locked 0, In range 15, Out of range 36, Locked out 75 |
| `pnw-end-of-district-pending-1440.png` | `2026waahs:awards`, captured while the champ run is held | Predicted cutoff pending | (the same run, before it lands) | In range and Out of range print an em dash, Locked out 75 is already there, and every contending team reads the neutral Pending chip |
| `pnw-season-start-1440.png` | `season-start` | Predicted cutoff ~165, no likely range | 165 (143 to 188), the earlier position line, n = 1 season, not gated | Prequalified 0, Locked 0, In range 12, Out of range 114, Locked out 0 |
| `fnc-now-settled-1440.png` | Now (the DCMP awards are posted) | Cutoff 224, the shipped midpoint rule, no tilde and no range | Not a backtest position: nothing is drawn once the awards post | Locked 15, Locked out 75, In range 0, Out of range 0 |

What each shot shows beyond the stat line:

- **No "district only" anywhere on any rewound shot.** Every DCMP row prices its Subtotal from the
  walk forward estimate (`~138 likely 55.7 to 243.0` for the top of both districts) and its four
  category cells read "not yet priced". The real DCMP roster is never read at a rewound position,
  which is finding 3.
- **The earned figure is the total at the position.** FNC's 3506 reads "150 earned" at the end of
  the district season (its published `pointTotal` includes DCMP points earned later), and every PNW
  team reads its rookie bonus alone at season start, "0 earned" for 1540. That is finding 4.
- **The likely range is not rendered** for the simulated line, per Jacob's 2026-09-27 ruling. The
  grand total cells keep their own per team likely ranges, which are a different quantity.
- **Every stat line walked `pending` then the figure**, with no intermediate number, on all three
  rewound positions (recorded by the harness).
- **2026orore simulates.** At season start all eight PNW district events are simulated in the
  browser, 2026orore included, with zero "not available" cells. Before the zero award profile rule
  its guest team frc3669 refused the whole event. The 165 matches the backtest's earlier position
  line after the same rule.
- The Pending chip measures 88 px, the Out of range chip's own width, so the Status column does not
  change size when the call settles.

## What could not be rendered offline

- **A position with the District Championship priced and its field still open**, where the real
  DCMP event prediction takes over from the estimate for registered teams at the live position. It
  needs a `2026pncmp` event artifact or presim sidecar, and the local set has neither. The
  component tests cover it with a synthetic artifact and the real Worker protocol.
- **A No call render in a real browser.** No local artifact reaches a terminal refusal. The
  component test forces a Worker error and pins the No call chip and the stat line's reason.
- **FNC before week 4.** Every earlier FNC position needs the FNC event artifacts, which are not
  local.
