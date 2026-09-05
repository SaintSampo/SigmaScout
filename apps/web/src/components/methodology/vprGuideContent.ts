/**
 * Content-as-data for the `/methodology/vpr` explainer (quick task
 * 260905-phf). `VprGuide.tsx` maps this array to `<section>` elements — the
 * single source of section titles and body prose, so `methodology.vpr.test.tsx`
 * can iterate this constant structurally rather than hand-typing a second copy.
 *
 * This module's scaffolding is filled in by Task 2, which owns the real
 * prose and the fixed, source-cited claim list it must cover.
 */
export interface VprGuideSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const VPR_GUIDE_SECTIONS: readonly VprGuideSection[] = [];
