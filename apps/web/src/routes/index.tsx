/**
 * The home page (2026-09-01, user decision H2 "proof first" + podium): the
 * site argues its case before anything else. The hero states the claim, the
 * podium shows pooled 2024–2026 winner accuracy for all three published
 * algorithms — computed at run time from the same `v1/compare/{year}.json`
 * artifacts the Compare page reads, never a hand-typed number — and three
 * CTAs route into the tool.
 *
 * Fast-load discipline (NAV-06): three small compare artifacts fetch in
 * parallel behind the CDN; the hero and CTAs render immediately, the podium
 * area holds a fixed-height skeleton while pending and simply hides on
 * error (the front door never shows a page-level failure for a decorative
 * proof block — the Compare page is the canonical home of these numbers).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchBox } from "../components/search/SearchBox.js";
import { compareQueryOptions } from "../lib/api/compare.js";
import { PODIUM_SEASONS, pooledAccuracyPodium, type PodiumEntry } from "../lib/homePodium.js";
import { algorithmDisplayLabel } from "../components/ribbon/AlgorithmSelect.js";

export const Route = createFileRoute("/")({
  component: HomePage,
});

export const HOME_PODIUM_TESTID = "home-podium";

const MEDAL_CLASSES = ["podium-step--gold", "podium-step--silver", "podium-step--bronze"] as const;
const MEDAL_LABELS = ["1st", "2nd", "3rd"] as const;
/** Step heights, best tallest — classic podium geometry (gold center handled by the render order below). */
const MEDAL_HEIGHTS_PX = [132, 104, 84] as const;

function PodiumStep({ entry, place }: { entry: PodiumEntry; place: 0 | 1 | 2 }) {
  return (
    <div className="flex w-[104px] flex-col items-center justify-end gap-[var(--spacing-xs)]" data-testid={`podium-${entry.algorithmId}`}>
      <span className="numeric-cell text-role-heading text-[var(--color-text-primary)]">{`${(entry.accuracy * 100).toFixed(1)}%`}</span>
      <div className={`podium-step ${MEDAL_CLASSES[place]} w-full`} style={{ height: MEDAL_HEIGHTS_PX[place] }}>
        <span className="text-role-label">{MEDAL_LABELS[place]}</span>
        <span className="text-role-body font-semibold">{algorithmDisplayLabel(entry.algorithmId)}</span>
      </div>
    </div>
  );
}

/** Exported for `index.test.tsx` only — the podium is the one part of this route with a data-shape failure mode worth testing in isolation, and rendering it alone needs a `QueryClientProvider` and nothing else. */
export function Podium() {
  const results = useQueries({
    queries: PODIUM_SEASONS.map((year) => compareQueryOptions({ year })),
  });
  const pending = results.some((r) => r.isPending);
  const failed = results.some((r) => r.isError);

  if (pending) {
    return (
      <div data-testid={HOME_PODIUM_TESTID} className="flex items-end justify-center gap-[var(--spacing-sm)]" aria-hidden="true">
        <Skeleton className="h-[104px] w-[104px]" />
        <Skeleton className="h-[132px] w-[104px]" />
        <Skeleton className="h-[84px] w-[104px]" />
      </div>
    );
  }
  if (failed) return null;

  // CR-01 (review 260902): `pooledAccuracyPodium` throws by design on a
  // malformed input — a missing `combined` slice, a zero pooled
  // `scoredCount`. Guarding only `failed` above honoured this block's stated
  // contract for FETCH errors alone; a well-formed HTTP 200 whose combined
  // slice is absent for one algorithm (exactly the drift a republish can
  // introduce) took the throw path instead and replaced the site's front
  // door with a router-level error surface.
  //
  // The guard belongs at THIS call site rather than in the helper or in a new
  // error boundary, because the contract that differs is the call site's, not
  // the helper's. Compare wants the loud failure and the tests assert it; only
  // the front door wants the block hidden, and only the caller knows which of
  // the two it is — pushing the decision into `homePodium.ts` would make the
  // helper silently wrong for its other consumer. An error boundary would be a
  // blunter instrument in the opposite direction: it would swallow every
  // render bug in its subtree under the same "no podium" outcome, converting
  // real breakage into invisible absence. A `try` around the one call that can
  // throw catches exactly the condition the contract names and nothing else.
  let podium: PodiumEntry[];
  try {
    // WR-03 (260902-post-phase08-ungoverned-ui/REVIEW.md): `useQueries`
    // preserves input order, so `PODIUM_SEASONS[index]` is exactly the year
    // that query fetched — pairing them here (rather than re-deriving a year
    // from the fetched data, which the artifact does not carry) is what lets
    // `pooledAccuracyPodium` assert each slice against the season its own
    // caller asked for.
    podium = pooledAccuracyPodium(results.map((r, index) => ({ season: PODIUM_SEASONS[index]!, artifact: r.data! })));
  } catch {
    return null;
  }
  // The medal layout below indexes places 0-2 unconditionally while the
  // source array's length is `PUBLISHED_ALGORITHM_IDS.length`. Adding a fourth
  // or dropping to two algorithms is a plain constant edit with no compile
  // error here, so the length is checked rather than assumed.
  if (podium.length < 3) return null;

  // Classic podium layout: silver left, gold center, bronze right.
  const ordered: { entry: PodiumEntry; place: 0 | 1 | 2 }[] = [
    { entry: podium[1]!, place: 1 },
    { entry: podium[0]!, place: 0 },
    { entry: podium[2]!, place: 2 },
  ];
  // WR-03 (260902-post-phase08-ungoverned-ui/REVIEW.md): the caption used to
  // read the LEADER's scored count alone and caption ALL THREE entries with
  // it, claiming "each" regardless of whether the other two actually shared
  // that count. They are NOT guaranteed to: `pooledAccuracyPodium` accumulates
  // each algorithm's scored count independently (a season with a null
  // `winnerAccuracy` for one algorithm is skipped for THAT algorithm alone,
  // per `homePodium.ts`), so "each" is not a safe claim in general even
  // though — verified at plan time — it happens to be true of every
  // currently published artifact. Collect the distinct counts and only claim
  // "each" when there really is exactly one; otherwise render the honest
  // min-max range.
  const scoredCounts = podium.map((entry) => entry.scoredCount);
  const uniqueScoredCounts = Array.from(new Set(scoredCounts));
  const scoredCaption =
    uniqueScoredCounts.length === 1
      ? `${uniqueScoredCounts[0]!.toLocaleString("en-US")} matches each`
      : `${Math.min(...scoredCounts).toLocaleString("en-US")}–${Math.max(...scoredCounts).toLocaleString("en-US")} matches`;

  return (
    <div data-testid={HOME_PODIUM_TESTID} className="flex flex-col items-center gap-[var(--spacing-sm)]">
      <div className="flex items-end justify-center gap-[var(--spacing-sm)]">
        {ordered.map(({ entry, place }) => (
          <PodiumStep key={entry.algorithmId} entry={entry} place={place} />
        ))}
      </div>
      <p className="text-role-label text-[var(--color-text-muted)]">
        {`Winner accuracy, ${PODIUM_SEASONS[0]}–${PODIUM_SEASONS[PODIUM_SEASONS.length - 1]} pooled · ${scoredCaption}, scored walk-forward`}
      </p>
    </div>
  );
}

/**
 * Cross-route search carry — the same documented escape hatch `Ribbon.tsx`'s
 * `preserveSearch` uses (see that function's doc comment): the target
 * routes' sort/filter params all carry `.catch()` defaults, so returning the
 * current params unchanged is identity behavior at runtime.
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col items-center gap-[var(--spacing-2xl)] p-[var(--spacing-lg)] pt-[var(--spacing-2xl)] text-center">
      <div className="flex flex-col items-center gap-[var(--spacing-md)]">
        <h1 className="text-role-display text-[var(--color-text-primary)]" style={{ fontSize: "2rem", letterSpacing: "-0.015em", textWrap: "balance" }}>
          Match predictions you can check.
        </h1>
        <p className="text-role-body max-w-[42rem] text-[var(--color-text-muted)]">
          Every SigmaScout rating ships with honest uncertainty: a value ± one standard deviation. Every
          algorithm&apos;s accuracy is measured walk-forward and published next to the baselines it beats.
        </p>
      </div>

      {/* Round-2 user request: a search bar ON the page, not only in the
          ribbon ("find your team" is still the most common arrival intent).
          `className="w-full"` fills this centered container, fixing the
          off-center fixed-width box the user reported. */}
      <div className="w-full max-w-[36rem]">
        <SearchBox className="w-full" />
      </div>

      <Podium />

      <div className="flex flex-wrap items-center justify-center gap-[var(--spacing-sm)]">
        <Link
          to="/teams"
          search={preserveSearch}
          className="rounded-[var(--radius)] bg-[var(--color-accent)] px-[var(--spacing-lg)] py-[var(--spacing-sm)] text-role-body font-semibold text-white"
        >
          Browse teams
        </Link>
        <Link
          to="/events"
          search={preserveSearch}
          className="rounded-[var(--radius)] bg-[var(--color-accent)] px-[var(--spacing-lg)] py-[var(--spacing-sm)] text-role-body font-semibold text-white"
        >
          This week&apos;s events
        </Link>
        <Link
          to="/compare"
          search={preserveSearch}
          className="rounded-[var(--radius)] bg-[var(--color-accent)] px-[var(--spacing-lg)] py-[var(--spacing-sm)] text-role-body font-semibold text-white"
        >
          See the methodology
        </Link>
      </div>
    </main>
  );
}
