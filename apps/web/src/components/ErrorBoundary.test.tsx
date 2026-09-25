/**
 * The reusable render-error boundary (phase 10 review, WR-09).
 *
 * React logs every caught render error to `console.error` by design, so each
 * throwing test silences that one channel for its own duration — silencing it
 * globally would hide a genuine React warning from every other test in this
 * suite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.js";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("render refused");
  return <p data-testid="child">the child rendered</p>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders its children untouched when nothing throws, adding no wrapper element of its own", () => {
    render(
      <div data-testid="parent">
        <ErrorBoundary resource="the ledger tab">
          <Boom shouldThrow={false} />
        </ErrorBoundary>
      </div>,
    );

    const parent = screen.getByTestId("parent");
    const child = screen.getByTestId("child");
    // A keyed Fragment, never a wrapper div: the child is the parent's own
    // direct child, so wrapping a subtree in this boundary cannot change that
    // subtree's layout or its sibling structure.
    expect(child.parentElement).toBe(parent);
  });

  it("catches a throw during a child's render and renders the site's ErrorState instead of a blank subtree", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary resource="the Road to District Champs tab">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Couldn't load the Road to District Champs tab.")).toBeDefined();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("reports the caught error to `onError` rather than swallowing it", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    render(
      <ErrorBoundary resource="the ledger tab" onError={onError}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe("render refused");
  });

  it("Retry re-attempts the children's render and calls `onRetry` for a caller that also wants to refetch", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const attempted = vi.fn();
    const onRetry = vi.fn();
    function CountingBoom(): never {
      attempted();
      throw new Error("render refused");
    }

    render(
      <ErrorBoundary resource="the ledger tab" onRetry={onRetry}>
        <CountingBoom />
      </ErrorBoundary>,
    );
    const attemptsBeforeRetry = attempted.mock.calls.length;
    expect(attemptsBeforeRetry).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(attempted.mock.calls.length).toBeGreaterThan(attemptsBeforeRetry);
    // A retry against UNCHANGED data throws again and lands back on the error
    // view. That is the honest outcome, not a bug: the boundary's job is to
    // contain the refusal, not to invent a value the assembly refused to build.
    expect(screen.getByText("Couldn't load the ledger tab.")).toBeDefined();
  });
});
