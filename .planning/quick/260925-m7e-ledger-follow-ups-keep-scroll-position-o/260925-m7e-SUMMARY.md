---
id: 260925-m7e
slug: ledger-follow-ups-keep-scroll-position-o
kind: quick
status: complete
completed: 2026-09-25
subsystem: apps/web
key-files:
  modified:
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/styles/theme.css
decisions:
  - "The pre-2026 rewind was not broken in the data path: headless drives of 2025pnw and 2024fim through the real year switch, district pick and drag loaded artifacts and reopened 788 and 3,035 cells with no errors. The visible fault was the scroll reset on every navigation, fixed with resetScroll false on both ledger navigations."
  - "Tick labels are never dropped now: a label within 10% of its printed neighbour moves to a second row (data-row 1, 13px lower). Jump chips were already adaptive (2026fim shows After week 0 to 5)."
  - "The tilde goes before BOTH bold forms (~22 and ~92% play) because Jacob asked for every blue box; the legend explainer was reworded so ~ no longer claims to mean only the typical amount."
owed:
  - "Verify on the deployed site that a blue box click and a slider drag keep the scroll position (the router option is set; the live check is the proof)."
---

# Quick task 260925-m7e: scroll position, every week tick, tilde on every prediction

**Three small fixes, 182 district tests green, web typecheck clean.**

- `DistrictLedgerNavigate` gained `resetScroll?: boolean`; `handleCellToggle` and
  `handlePositionChange` pass `resetScroll: false`.
- `timelineTicks` prints every chip-derived tick and assigns `row` 0 or 1; the rail is 26px
  tall with row 1 offset 13px.
- `openCellLines` prefixes "~" on both bold forms; three test regexes and the legend copy pin
  the new text.

Verification after deploy: the live district spec on both projects, and a headless scroll check
that clicking a blue cell far down the page leaves `window.scrollY` unchanged.
