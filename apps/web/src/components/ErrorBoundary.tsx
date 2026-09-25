/**
 * The site's one REUSABLE render-error boundary.
 *
 * WHY A CLASS. React still offers no hook equivalent of
 * `getDerivedStateFromError`/`componentDidCatch`, so a class component is the
 * only way to catch an exception thrown during a child's render. This repo
 * carries no `react-error-boundary` dependency, and `MetricHistoryTab.tsx`
 * already keeps a file-scoped class for its lazy-chunk failure; this one is
 * the general case, for a subtree whose PURE assembly is documented as
 * throwing.
 *
 * WHY IT EXISTS AT ALL (phase 10 review, WR-09). The Road to District Champs
 * tab calls three functions that each document themselves as refusing rather
 * than fabricating — `convolveDistrictGrandTotal`
 * (`NegativeDistrictShiftError`), `maxEventPoints`
 * (`UnknownDistrictSeasonError`) and `pointCellSummary`
 * (`EmptyDistributionError`) — and all three run inside a render-path
 * `useMemo`. Refusing to fabricate a value is right. Letting the refusal reach
 * React's renderer is not: an uncaught throw there unmounts the whole route
 * subtree, so the entire Locks page goes blank rather than the one tab that
 * could not be built.
 *
 * WHAT IT RENDERS: the site's own `ErrorState`, the same view a failed
 * artifact fetch renders, so a reader sees one failure vocabulary and not two.
 *
 * THE RETRY re-mounts the children with a fresh `resetKey`. A retry against
 * unchanged data throws again and lands back here — which is honest, and is
 * exactly what a reader wants when the refusal was caused by a transient
 * upstream state (a partially loaded artifact set) rather than by the data
 * itself.
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./StateViews.js";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** The `ErrorState` noun, e.g. `"the Road to District Champs tab"` — the same slot a failed fetch fills. */
  resource: string;
  /** Called after the boundary resets, for a caller that wants to refetch as well as re-render. */
  onRetry?: () => void;
  /**
   * Called with the caught error, for a test or a future telemetry hook. The
   * boundary itself logs nothing: a `console.error` here would double every
   * React-reported render error in the browser console.
   */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  resetKey: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private handleRetry = (): void => {
    this.setState((previous) => ({ hasError: false, resetKey: previous.resetKey + 1 }));
    this.props.onRetry?.();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorState resource={this.props.resource} onRetry={this.handleRetry} />;
    }
    // A KEYED FRAGMENT, not a wrapper element: the key forces a fresh mount on
    // retry (so a subtree that threw part-way through its own mount is rebuilt
    // rather than resumed from a half state) while adding no DOM node of its
    // own, so wrapping a subtree in this boundary cannot change that subtree's
    // own layout or its parent/sibling structure.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
