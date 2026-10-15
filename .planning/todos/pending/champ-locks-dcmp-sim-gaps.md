---
id: champ-locks-dcmp-sim-gaps
created: 2026-10-15
source: quick 261007-mxf, 261014-j4i (the two known limits of the closed todo champ-locks-now-dcmp-bake)
priority: medium
due: before the 2027 season (item 1 shows at every season start, item 2 at each divisioned DCMP in April)
---

# Champ Locks DCMP simulation: two open gaps

Since 261007-mxf (rewound stops) and 261014-j4i (Now), the Champ Locks tab simulates an unstarted District Championship over the teams the District Locks tab shows as Locked, Prequalified or In range. Two cases still fall short. Both fall back to an honest reading, so neither is a wrong number on the page.

## 1. No DCMP in the data before registrations

At the start of a live season a district's championship has no event key on the artifact until a team's row carries it, so `dcmpEventKeysFor` (`champLedgerRows.ts`) is empty. With no key there is nothing to plan the bake under, at a rewound stop or at Now (`asOfNowChampionshipApplies` in `asOfRewind.ts`). The tab then reads the field rank estimate (`hypotheticalDcmp.ts`) and "not yet priced".

Fix idea: a synthetic championship key, or the real TBA event key fetched ahead of registrations, to plan and fold the generated championship under.

## 2. Divisioned and two championship districts are simulated as one event

FIM, NE, ONT and TX play their championship in divisions, and 2026 California had two championships. The bake runs ONE eight alliance event over the whole field, so alliance selection and playoff points come from a single bracket.

Fix idea: a rule that assigns each simulated team to a division (or a championship) before the bake, then one generated event per division plus the finals.

## 3. Small: tighten the live view methodology sentence

261014-j4i had to fit the live view paragraph in `apps/web/src/components/methodology/districtLedgerContent.ts` into three sentences (the voice test's cap), so its first sentence runs long. The wording is pinned by a test in `districtLedgerContent.test.ts`; change both together.
