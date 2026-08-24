import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { teamsQueryOptions } from "../lib/api/teams.js";
import { ArtifactFetchError, ArtifactValidationError } from "../lib/api/errors.js";
import { markFirstRowsRendered, measureParseToPaint } from "../lib/perfMarks.js";

export const Route = createFileRoute("/teams")({
  component: TeamsPage,
});

/** Restores trailing-zero digits JSON serialization dropped — never a new rounding operation. Values arrive already rounded to 2 decimals (packages/harness/rounding.ts's D-06 rule). */
function formatMetric(value: number): string {
  return value.toFixed(2);
}

function TeamsPage() {
  // Hard-coded for the tracer (plan 05-01 Task 3) — parameterized by the
  // year/algorithm dropdowns in plan 05-05.
  const { data, isPending, error } = useQuery(teamsQueryOptions({ year: 2024, algorithmId: "sigma1", version: "2.0.0+tuned-2026-08" }));

  // 05-VALIDATION.md's "Measurement Gate (NAV-06)" — the render side of the
  // parse-to-paint split. This effect runs after every render, including the
  // pending-state (skeleton) render, but only marks/logs once `data` is
  // present — which is exactly the render that actually commits populated
  // rows below, never the "Loading teams…" branch. Guarded against the
  // specific `data` reference (not a plain boolean) so a future artifact
  // reload (year/algorithm change, plan 05-05) marks and logs again rather
  // than firing only once for the component's whole lifetime.
  const markedDataRef = useRef<typeof data>(undefined);
  useEffect(() => {
    if (!data || markedDataRef.current === data) return;
    markedDataRef.current = data;
    markFirstRowsRendered();
    const durationMs = measureParseToPaint();
    console.log(JSON.stringify({ event: "teams-parse-to-paint", season: data.season, durationMs }));
  }, [data]);

  if (isPending) {
    return (
      <div className="p-[var(--spacing-lg)] text-[14px] text-[var(--color-text-primary)]">Loading teams…</div>
    );
  }

  if (error) {
    const resource = error instanceof ArtifactFetchError || error instanceof ArtifactValidationError ? error.resource : "teams";
    const year = error instanceof ArtifactFetchError || error instanceof ArtifactValidationError ? error.year : 2024;
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-[14px] text-[var(--color-destructive)]">
          Couldn&apos;t load {resource} for {year}.
        </p>
        <p className="text-[14px] text-[var(--color-text-muted)]">Check your connection and try again.</p>
      </div>
    );
  }

  const rows = [...data.teams].sort((a, b) => (b.metrics.total?.value ?? 0) - (a.metrics.total?.value ?? 0)).slice(0, 100);

  return (
    <div className="p-[var(--spacing-lg)]">
      <h1 className="mb-[var(--spacing-md)] text-[20px] font-semibold leading-[1.2] text-[var(--color-text-primary)]">Teams — {data.season}</h1>
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-[var(--color-bg-surface)] text-[12px] font-semibold leading-[1.3]">
            <th className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left">Rank</th>
            <th className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left">Team #</th>
            <th className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left">Nickname</th>
            <th className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const total = row.metrics.total;
            return (
              <tr key={row.teamKey} className="bg-[var(--color-bg-page)]">
                <td className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)]">{index + 1}</td>
                <td className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)]">{row.teamNumber}</td>
                <td className="px-[var(--spacing-md)] py-[var(--spacing-sm)]">{row.nickname}</td>
                <td className="numeric-cell px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right">
                  {total === undefined ? null : (
                    <>
                      <span className="text-[var(--color-text-primary)]">{formatMetric(total.value)}</span>
                      {total.spread !== undefined && (
                        <span className="ml-[var(--spacing-xs)] text-[12px] font-normal text-[var(--color-text-muted)]">± {formatMetric(total.spread)}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
