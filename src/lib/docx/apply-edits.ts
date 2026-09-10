import { parseDocx, assembleDocx } from "./parser";
import {
  renderPdf,
  measureLayout,
  findRegression,
  type Layout,
  type LayoutRegression,
} from "./layout";
import type { TailoredSection } from "./types";

export type AppliedEdits = {
  docxBuffer: Buffer;
  pdfBuffer: Buffer;
  /** Edits that survived into the rendered document. */
  applied: string[];
  /** Edits removed because they would have changed the page layout. */
  dropped: string[];
  baseline: Layout;
  final: Layout;
  /** Non-null only if a safe result could not be reached. */
  regression: LayoutRegression | null;
};

/** Build the candidate edit set from the sections the user accepted. */
function collectReplacements(
  tailoredSections: TailoredSection[]
): Map<string, string> {
  const replacements = new Map<string, string>();

  for (const section of tailoredSections) {
    if (section.tailoredText === section.originalText) continue;

    for (const change of section.changes) {
      if (
        change.original &&
        change.replacement &&
        change.original !== change.replacement
      ) {
        replacements.set(change.original, change.replacement);
      }
    }
  }

  return replacements;
}

/** Longest first — the biggest growth is the likeliest cause of a wrap. */
function byGrowthDescending(
  replacements: Map<string, string>
): [string, string][] {
  return [...replacements.entries()].sort(
    (a, b) => b[1].length - b[0].length - (a[1].length - a[0].length)
  );
}

/**
 * Apply accepted edits and render, guaranteeing the page layout is unchanged.
 *
 * The original is rendered first to establish a baseline, then each candidate
 * is rendered and compared. If anything wrapped onto a new line or spilled to a
 * new page, the largest remaining edit is dropped and the process repeats — a
 * slightly less-tailored resume beats one whose formatting broke. Because each
 * pass removes one edit, the untouched original is always reachable.
 */
export async function applyEditsLayoutSafe(
  sourceBuffer: Buffer,
  tailoredSections: TailoredSection[]
): Promise<AppliedEdits> {
  const baseline = await measureLayout(renderPdf(sourceBuffer));

  const replacements = collectReplacements(tailoredSections);
  const dropped: string[] = [];
  const maxAttempts = replacements.size + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const archive = await parseDocx(sourceBuffer);
    const docxBuffer = await assembleDocx(archive, replacements);
    const pdfBuffer = renderPdf(docxBuffer);
    const final = await measureLayout(pdfBuffer);

    // With no edits left to test, the untouched original is trivially safe.
    const regression =
      replacements.size === 0 ? null : findRegression(baseline, final);

    if (!regression) {
      return {
        docxBuffer,
        pdfBuffer,
        applied: [...replacements.keys()],
        dropped,
        baseline,
        final,
        regression: null,
      };
    }

    const [worst] = byGrowthDescending(replacements);
    console.warn(
      `[export] ${regression.kind} (${regression.before} → ${regression.after}); ` +
        `dropping edit: "${worst[1].slice(0, 60)}..."`
    );
    replacements.delete(worst[0]);
    dropped.push(worst[0]);
  }

  throw new Error("Could not produce a layout-safe resume");
}
