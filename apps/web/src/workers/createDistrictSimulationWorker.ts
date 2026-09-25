/**
 * The Vite bundling seam and the SINGLE definition site of the district
 * worker's URL and its `{ type: "module" }` option. No component may write
 * `new Worker(...)` itself — every construction goes through this factory,
 * and `useDistrictSimulationRun.ts` is its only caller.
 *
 * Two facts about THIS FILE'S OWN SHAPE that must not be "fixed" by a later
 * consistency pass, carried forward verbatim from
 * `createSimulationWorker.ts` because both apply here unchanged:
 *
 * - The `new URL("./districtSimulation.worker.ts", import.meta.url)`
 *   expression must sit INLINE inside the `new Worker(...)` call. Vite's own
 *   documentation makes worker detection conditional on exactly that static
 *   shape — hoisting the URL into a `const` first makes Vite treat it as an
 *   ordinary static asset URL instead of a worker entry, and the built app
 *   then ships a `Worker` that never actually runs (silently: no build error,
 *   just a dead worker chunk that is never emitted at all).
 * - The `.ts` source extension on that URL is a deliberate, narrow exception
 *   to this repo's usual `.js`-extension local-import convention. This is not
 *   a module specifier TypeScript resolves; it is a URL LITERAL Vite resolves
 *   against the source tree at build time, so writing `.js` here resolves to a
 *   file that does not exist.
 *
 * The lifecycle contract the district run hook is bound by:
 *
 * - Construct LAZILY, inside the effect that needs it — never at module scope
 *   and never on mount, so a component test that never reaches a run never
 *   needs a `Worker` mock.
 * - Wrap the construction call in `try`/`catch`: an unsupported browser throws
 *   HERE, synchronously from the constructor, rather than posting an `error`
 *   message.
 * - Call `.terminate()` on every terminal message, and again in a `useEffect`
 *   cleanup on unmount as a backstop.
 * - Cancel a run by calling `.terminate()`, never by posting a message — the
 *   event loop never returns to its own message queue mid-run.
 */
export function createDistrictSimulationWorker(): Worker {
  return new Worker(new URL("./districtSimulation.worker.ts", import.meta.url), { type: "module" });
}
