import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";
import { PromotedVersionSchema } from "./promote.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { selectedOnSeasonsFor } from "./selectionProvenance.js";

/**
 * Read independently of `selectionProvenance.ts`'s own path construction —
 * this is what actually proves the module reads the SAME committed file
 * `cli.ts`/`publish.ts` load for `vpr`, rather than merely asserting a value
 * this test also computed the same (wrong) way.
 */
const INDEPENDENTLY_RESOLVED_VPR_VERSION_PATH = join(
  "data",
  "algorithm-versions",
  `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`
);

function readCommittedVprProvenance() {
  const raw: unknown = JSON.parse(readFileSync(INDEPENDENTLY_RESOLVED_VPR_VERSION_PATH, "utf8"));
  return PromotedVersionSchema.parse(raw);
}

describe("selectedOnSeasonsFor", () => {
  it("vpr's selected-on seasons deep-equal the committed version file's own provenance.tuneSeasons", () => {
    const committed = readCommittedVprProvenance();
    const result = selectedOnSeasonsFor(["vpr"]);
    expect(result.vpr).toEqual(committed.provenance.tuneSeasons);
  });

  it("opr and epa — never-tuned baselines — come back with an explicit empty array each, not an omission", () => {
    const result = selectedOnSeasonsFor(["opr", "epa"]);
    expect(result.opr).toEqual([]);
    expect(result.epa).toEqual([]);
  });

  it("an unregistered algorithm id throws, naming the id", () => {
    expect(() => selectedOnSeasonsFor(["not-a-real-algorithm"])).toThrow(/not-a-real-algorithm/);
  });

  it("resolves the SAME version identity resolvePublishAlgorithms(undefined) resolves for vpr — guards against a second, drifting resolution", () => {
    const committed = readCommittedVprProvenance();
    const resolved = resolvePublishAlgorithms(undefined);
    const vprModule = resolved.find((m) => m.id === "vpr");
    expect(vprModule).toBeDefined();
    expect(vprModule!.version).toBe(committed.version);
  });
});
