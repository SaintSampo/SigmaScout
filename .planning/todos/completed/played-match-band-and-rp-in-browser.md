---
id: played-match-band-and-rp-in-browser
created: 2026-09-21
source: tick inventory during quick task 260921-q2s (Jacob's staleness and Worker CPU push)
priority: low
---

> **STATUS 2026-09-22: CLOSED.** The Cloudflare account moved to Workers Paid on 2026-09-22,
> raising the per-invocation CPU budget from 10 ms to 30 s and the per-invocation subrequest limit
> from 50 to 10,000. The constraint this todo existed to work around is gone: this todo's whole
> premise was reclaiming first-call formula cost against a tight CPU budget, and the Worker is no
> longer CPU-constrained. No observation and no experiment is owed.
>
> Everything below this block is retained as a measurement record, not as live work.

# The Worker still prices band and RP odds for each just-played match

Browser pricing (2026-09-15) moved every UPCOMING match out of the Worker. The folded loop still
calls `displayBandFor` and `rpFieldsFor` to `analyticRpPmf` per newly played match, to stamp the
pre-match band and RP pmf on the played row. Both are display only; `algorithm.update` needs
neither. The component profile found the formula's cost is first-call work paid again on every
cold tick, so removing the last call sites removes that code path from the Worker entirely. The
folded-loop RP term measured 2.6 plus or minus 2.3 ms, below resolution, so the size of the win is
unknown.

## What it would take

The browser cannot price a played match from the current state block, because the block has
already been spliced with post-fold rows. The tick would have to ship the six teams' pre-fold
state rows (and the league row) per played match, for example beside the `live` rows. That adds
bytes to a body the tick stringifies every time, which is the cost the sidecar experiment showed
can exceed the saving.

## Guardrails

- This is NOT browser-side folding (closed negative twice, see `browser-relay-closed`). The Worker
  still folds everything; only display pricing of the played row moves.
- The win probability stays Worker-computed: it is the published, scored prediction and `predict`
  is cheap.
- Pre-register a within-run arm difference (fold with and without the two calls, with the extra
  bytes included) before building anything. If the difference is not resolved, close this.
