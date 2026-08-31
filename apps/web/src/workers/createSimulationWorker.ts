/**
 * The Vite bundling seam and the SINGLE definition site of the worker URL
 * and the `{ type: "module" }` option. No component may write
 * `new Worker(...)` itself — every construction goes through this factory.
 *
 * Two facts about THIS FILE'S OWN SHAPE that must not be "fixed" by a later
 * consistency pass:
 *
 * - The `new URL("./simulation.worker.ts", import.meta.url)` expression
 *   must sit INLINE inside the `new Worker(...)` call. Vite's own
 *   documentation makes worker detection conditional on exactly that static
 *   shape — hoisting the URL into a `const` first makes Vite treat it as an
 *   ordinary static asset URL instead of a worker entry, and the built app
 *   then ships a `Worker` that never actually runs (silently: no build
 *   error, just a dead worker chunk that is never emitted at all).
 * - The `.ts` source extension on that URL is a deliberate, narrow
 *   exception to this repo's usual `.js`-extension local-import convention
 *   (every other local import in `apps/web` — `./routeTree.gen.js`,
 *   `../../../../packages/core/.../constants.js` — uses `.js`). This is not
 *   a module specifier TypeScript resolves; it is a URL LITERAL Vite
 *   resolves against the source tree at build time, so writing `.js` here
 *   resolves to a file that does not exist.
 *
 * The lifecycle contract 08-13's Run handler is bound by, stated here
 * because this is the file its executor will read:
 *
 * - Construct LAZILY, inside the "Run simulation" click handler — never at
 *   module scope and never on mount (RESEARCH.md Pitfall 1: a component
 *   test that never clicks Run must never need a `Worker` mock).
 * - Call `.terminate()` in a `useEffect` cleanup on unmount.
 * - Wrap the construction call in `try`/`catch`: an unsupported browser
 *   throws HERE, synchronously from the constructor, rather than posting an
 *   `error` message — this is the construction half of UI-SPEC's S2 error
 *   state.
 * - Cancel a run by calling `.terminate()`, never by posting a message
 *   (PD-06) — the draw loop never returns to its own message queue mid-run,
 *   so a `cancel` message could never be read in time.
 */
export function createSimulationWorker(): Worker {
  return new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
}
