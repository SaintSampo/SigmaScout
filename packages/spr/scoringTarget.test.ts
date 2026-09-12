/**
 * Cross-module identity for BPR's scoring-target corrections.
 *
 * Two independently sealed implementations exist for the same rule: the
 * offline research model (`packages/spr/data.ts`) and the shipped port
 * (`packages/core/algorithms/spr.ts`) — each independently auditable against
 * its own git blob under `packages/spr/sealedPaths.ts`'s `SEALED_CODE_PATHS`.
 * This test is the only thing preventing the two `correctionsOf`
 * implementations from drifting apart: it feeds one shared payload table
 * through both exports and asserts the results are deeply equal.
 */
import { describe, expect, it } from "vitest";
import { correctionsOf as correctionsOfData } from "./data.js";
import { correctionsOf as correctionsOfPort } from "../core/algorithms/spr.js";
import {
  ADJUST_COMPONENT,
  BREAKDOWN_REGISTERED_SEASONS,
  componentMapForSeason,
} from "../core/algorithms/breakdown/index.js";

/**
 * One shared table drives both the cross-module identity requirement and the
 * malformed-yields-zero requirement: a payload added here is automatically
 * checked from both directions rather than needing a second edit.
 */
const PAYLOADS: readonly { name: string; raw: string | null; expectZero: boolean }[] = [
  { name: "null raw", raw: null, expectZero: true },
  {
    name: "well-formed, nonzero both sides",
    raw: '{"red":{"foulPoints":8,"adjustPoints":-15},"blue":{"foulPoints":0,"adjustPoints":150}}',
    expectZero: false,
  },
  { name: "malformed JSON", raw: "{not json", expectZero: true },
  { name: "keys absent on both sides", raw: '{"red":{},"blue":{}}', expectZero: true },
  {
    name: "wrong types (null and string)",
    raw: '{"red":{"adjustPoints":null},"blue":{"adjustPoints":"12"}}',
    expectZero: true,
  },
  { name: "JSON null literal", raw: "null", expectZero: true },
  { name: "JSON array", raw: "[]", expectZero: true },
  { name: "both alliances null", raw: '{"red":null,"blue":null}', expectZero: true },
  {
    name: "one alliance well-formed, other absent",
    raw: '{"red":{"foulPoints":3,"adjustPoints":6}}',
    expectZero: false,
  },
];

const ZERO = { redFoul: 0, blueFoul: 0, redAdjust: 0, blueAdjust: 0 };

describe("correctionsOf: research model and shipped port agree (requirement c)", () => {
  for (const { name, raw } of PAYLOADS) {
    it(`agrees on: ${name}`, () => {
      expect(correctionsOfData(raw)).toEqual(correctionsOfPort(raw));
    });
  }
});

describe("correctionsOf: malformed or missing breakdown yields zero, never throws (requirement b)", () => {
  for (const { name, raw, expectZero } of PAYLOADS.filter((p) => p.expectZero)) {
    it(`${name}: research model returns four zeros`, () => {
      expect(correctionsOfData(raw)).toEqual(ZERO);
    });
    it(`${name}: shipped port returns four zeros`, () => {
      expect(correctionsOfPort(raw)).toEqual(ZERO);
    });
  }
});

describe("ADJUST_COMPONENT is mapped for every registered season (requirement d)", () => {
  // Pins the premise of the shallow read: `adjust` is a real mapped
  // component in every registered season, so a season that stopped carrying
  // `adjustPoints` fails here rather than silently subtracting zero forever.
  // Iterates BREAKDOWN_REGISTERED_SEASONS, never a hardcoded season list, so
  // registering a new season extends this suite without a second edit.
  for (const season of BREAKDOWN_REGISTERED_SEASONS) {
    it(`season ${season}`, () => {
      expect(componentMapForSeason(season).components).toContain(ADJUST_COMPONENT);
    });
  }
});
