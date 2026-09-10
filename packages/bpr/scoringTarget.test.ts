/**
 * Cross-module identity for BPR's scoring-target corrections.
 *
 * Two independently sealed implementations exist for the same rule: the
 * offline research model (`packages/bpr/data.ts`) and the shipped port
 * (`packages/core/algorithms/bpr.ts`) — each independently auditable against
 * its own git blob under `packages/bpr/sealedPaths.ts`'s `SEALED_CODE_PATHS`.
 * This test is the only thing preventing the two `correctionsOf`
 * implementations from drifting apart: it feeds one shared payload table
 * through both exports and asserts the results are deeply equal.
 */
import { describe, expect, it } from "vitest";
import { correctionsOf as correctionsOfData } from "./data.js";
import { correctionsOf as correctionsOfPort } from "../core/algorithms/bpr.js";

const PAYLOADS: readonly { name: string; raw: string | null }[] = [
  { name: "null raw", raw: null },
  {
    name: "well-formed, nonzero both sides",
    raw: '{"red":{"foulPoints":8,"adjustPoints":-15},"blue":{"foulPoints":0,"adjustPoints":150}}',
  },
  { name: "malformed JSON", raw: "{not json" },
  { name: "keys absent on both sides", raw: '{"red":{},"blue":{}}' },
  {
    name: "wrong types (null and string)",
    raw: '{"red":{"adjustPoints":null},"blue":{"adjustPoints":"12"}}',
  },
  { name: "JSON null literal", raw: "null" },
  { name: "JSON array", raw: "[]" },
  { name: "both alliances null", raw: '{"red":null,"blue":null}' },
  {
    name: "one alliance well-formed, other absent",
    raw: '{"red":{"foulPoints":3,"adjustPoints":6}}',
  },
];

describe("correctionsOf: research model and shipped port agree", () => {
  for (const { name, raw } of PAYLOADS) {
    it(`agrees on: ${name}`, () => {
      expect(correctionsOfData(raw)).toEqual(correctionsOfPort(raw));
    });
  }
});
