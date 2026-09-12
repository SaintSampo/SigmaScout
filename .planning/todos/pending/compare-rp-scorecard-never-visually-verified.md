---
id: compare-rp-scorecard-never-visually-verified
created: 2026-09-12
source: session audit 2026-09-12 — carried verbally since the scorecard shipped, never filed
resolves_phase: 9
priority: medium
---

# The RP calibration scorecard shipped to the Compare page without anyone looking at it

`ranking-points-audit.md` records finding **F1** as CLOSED — "calibration scorecard live on the
Compare page, `rpCalibration` in every compare slice". The data side of that is verified. **The
rendering was never seen by a human or a browser**, because no browser was available in the session
that shipped it, and it has not been checked since.

So the closure of F1 rests on the artifact containing the right numbers, not on the page showing
them correctly. Those are different claims.

## Why this is not paranoia

The scorecard is a **published** surface on a page whose whole job is honest self-assessment. The
specific things that go wrong in an unviewed chart are exactly the things the project's own sketch
findings exist to prevent: an axis that clips, a band that renders inverted, a tie that reads as a
defeat, a label that overflows at narrow width, a colour pair that fails contrast. None of those
fail a test, and none of them show up in the artifact.

## What blocks it

Playwright is **not installed** in this repo — `node_modules/@playwright` is absent and there is no
`playwright` entry in `package.json`, despite the stack notes listing `@playwright/test` as an
optional addition. So there is currently no way for an agent to check this at all. It is either a
human looking at the page, or installing Playwright first.

The local recipe for viewing real data is already known: set `VITE_ARTIFACT_ORIGIN` to the local
origin so the `/v1` proxy activates (R2 CORS blocks localhost directly), and use a fresh port on
each restart.

## The work

Open the Compare page against live artifacts, look at the RP scorecard, and check it against
`Skill("sketch-findings-sigmascout")` — which carries the decided palette, the uncertainty-display
rules, and the chart-craft mechanics each learned by getting it wrong in a sketch first. Then either
confirm F1's closure honestly or file what is wrong.

If it is easier to install Playwright and screenshot it than to do it by hand, that is a reasonable
first step and would unblock every future visual check too.

Related: [[ranking-points-audit]].
