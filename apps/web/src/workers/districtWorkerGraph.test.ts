/**
 * What each district Worker chunk and the main thread's district modules may
 * reach (quick task 261005-5g0), by a static scan of VALUE imports (an
 * `import type` is erased and never bundled, so it is not an edge here).
 *
 * - The LIVE Worker entry never reaches the as-of pricer, the bake, the
 *   schedule generator or the artifact schemas: its chunk stays what it was.
 * - The main thread's district data modules never reach them either.
 * - The AS-OF Worker entry reaches the pricer and the bake (so this scan is
 *   not vacuous) and no Node built-in, so it builds for the browser.
 *
 * The Simulation tab's two Worker chunks (Part 4) are held to the same rules:
 * the default entry, which every EPA, OPR, forward and fallback run loads,
 * reaches none of the as-of pricer; the as-of entry reaches it and no Node
 * built-in; the tab's main thread modules reach neither the pricer nor the
 * as-of job.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const HARNESS = resolve(ROOT, "packages", "harness");

/** One `import`/`export ... from` statement that is not `import type`/`export type`, on one line or several. */
const VALUE_IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)(?![ \t]+type\b)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

function valueImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];
  const pattern = new RegExp(VALUE_IMPORT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) if (match[1] !== undefined) out.push(match[1]);
  return out;
}

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function reach(entry: string): { files: Set<string>; nodeBuiltins: string[] } {
  const files = new Set<string>();
  const nodeBuiltins: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of valueImports(file)) {
      if (specifier.startsWith("node:")) nodeBuiltins.push(`${file} -> ${specifier}`);
      const next = resolveSpecifier(file, specifier);
      if (next !== undefined && !files.has(next)) queue.push(next);
    }
  }
  return { files, nodeBuiltins };
}

const HEAVY = ["asOfPricing.ts", "districtBake.ts", "preSchedule.ts", "generatedSchedules.ts", "pageArtifacts.ts", "asOfState.ts"].map((name) => resolve(HARNESS, name));

describe("the district Worker chunks and the main thread", () => {
  it("the Live Worker entry reaches none of the as-of pricer, the bake, the generator or the schemas", () => {
    const { files } = reach(resolve(HERE, "districtSimulation.worker.ts"));
    expect(files.has(resolve(HERE, "districtSimulationProtocol.ts"))).toBe(true);
    expect(HEAVY.filter((file) => files.has(file))).toEqual([]);
    expect(files.has(resolve(HERE, "districtAsOfJob.ts"))).toBe(false);
  });

  it("the main thread's district data hooks reach none of the pricer, the bake or the generator", () => {
    for (const entry of ["useDistrictLedgerData.ts", "districtRunAssembly.ts", "useDistrictSimulationRun.ts", "useAsOfRewind.ts", "asOfRewind.ts"]) {
      const { files } = reach(resolve(HERE, "..", "components", "districts", entry));
      const heavy = ["asOfPricing.ts", "districtBake.ts", "preSchedule.ts", "generatedSchedules.ts"].map((name) => resolve(HARNESS, name));
      expect(heavy.filter((file) => files.has(file)), entry).toEqual([]);
      expect(files.has(resolve(HERE, "districtAsOfJob.ts")), entry).toBe(false);
    }
  });

  it("the as-of Worker entry reaches the pricer and the bake, and no Node built-in", () => {
    const { files, nodeBuiltins } = reach(resolve(HERE, "districtAsOfSimulation.worker.ts"));
    expect(files.has(resolve(HARNESS, "asOfPricing.ts"))).toBe(true);
    expect(files.has(resolve(HARNESS, "districtBake.ts"))).toBe(true);
    expect(nodeBuiltins).toEqual([]);
  });
});

describe("the Simulation tab's Worker chunks and the main thread", () => {
  it("the default simulation Worker entry reaches none of the as-of pricer, the schemas or the as-of job", () => {
    const { files } = reach(resolve(HERE, "simulation.worker.ts"));
    expect(files.has(resolve(HERE, "simulationProtocol.ts"))).toBe(true);
    expect(HEAVY.filter((file) => files.has(file))).toEqual([]);
    expect(files.has(resolve(HERE, "simulationAsOfJob.ts"))).toBe(false);
    expect(files.has(resolve(HERE, "asOfBlockGuards.ts"))).toBe(false);
  });

  it("the as-of simulation Worker entry reaches the pricer and the shared guards, and no Node built-in", () => {
    const { files, nodeBuiltins } = reach(resolve(HERE, "simulationAsOf.worker.ts"));
    expect(files.has(resolve(HARNESS, "asOfPricing.ts"))).toBe(true);
    expect(files.has(resolve(HERE, "asOfBlockGuards.ts"))).toBe(true);
    expect(nodeBuiltins).toEqual([]);
  });

  it("the tab's main thread modules reach neither the pricer nor the as-of job", () => {
    for (const entry of ["SimulationTab.tsx", "useSimulationRun.ts", "simulationAsOf.ts"]) {
      const { files } = reach(resolve(HERE, "..", "components", "event", entry));
      expect(files.has(resolve(HARNESS, "asOfPricing.ts")), entry).toBe(false);
      expect(files.has(resolve(HERE, "simulationAsOfJob.ts")), entry).toBe(false);
    }
    // Not vacuous: the scan does reach the run hook's Worker factory and the loader's resolver.
    expect(reach(resolve(HERE, "..", "components", "event", "useSimulationRun.ts")).files.has(resolve(HERE, "createSimulationWorker.ts"))).toBe(true);
    expect(reach(resolve(HERE, "..", "components", "event", "SimulationTab.tsx")).files.has(resolve(HARNESS, "asOfLookup.ts"))).toBe(true);
  });
});
