---
id: methodology-limits-table-count
created: 2026-10-05
source: quick 261005-04t
priority: low
---

# The District Points methodology page says seven limits and lists eight

On `/methodology/district-points`, the last section's paragraph and its table caption both say
seven limits. The table has eight rows.

Source: `apps/web/src/components/methodology/districtLedgerContent.ts`.

Fix the count in the two sentences, or drop the number from them so it cannot drift again. Found
while planning quick 261005-04t and left alone there on purpose: that task adds three paragraphs
to the page and touches nothing else on it.
