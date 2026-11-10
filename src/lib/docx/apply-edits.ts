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

/**
 * Apply accepted edits and render, guaranteeing the page layout is unchanged.
 *
 * The original is rendered first to establish a template-specific baseline.
 * Candidate edits are then added one at a time. This matters: comparing only
 * the final document's total line count can miss one bullet wrapping when a
 * different edit happens to remove a line. Per-edit rendering prevents those
 * changes from cancelling each other out.
 *
 * No assumptions are made about fonts, margins, tables, bullet glyphs, or
 * section names. The actual rendered PDF is the authority for every template.
 */
export async function applyEditsLayoutSafe(
  sourceBuffer: Buffer,
  tailoredSections: TailoredSection[]
): Promise<AppliedEdits> {
  const baseline = await measureLayout(renderPdf(sourceBuffer));

  if (baseline.pageCount !== 1) {
    throw new Error(
      `The source resume renders as ${baseline.pageCount} pages. ` +
        "Use a one-page DOCX before tailoring so the exporter can preserve that limit."
    );
  }

  const proposed = collectReplacements(tailoredSections);
  const accepted = new Map<string, string>();
  const dropped: string[] = [];
  let final = baseline;
  let docxBuffer = sourceBuffer;
  let pdfBuffer = renderPdf(sourceBuffer);

  for (const [original, replacement] of proposed) {
    // A model-generated newline is never allowed to create a second visual
    // line inside an edited bullet or skills row.
    if (/[\r\n\v\f]/.test(replacement)) {
      dropped.push(original);
      continue;
    }

    const candidate = new Map(accepted);
    candidate.set(original, replacement);
    const archive = await parseDocx(sourceBuffer);
    const candidateDocx = await assembleDocx(archive, candidate);
    const candidatePdf = renderPdf(candidateDocx);
    const candidateLayout = await measureLayout(candidatePdf);
    const regression = findRegression(final, candidateLayout, replacement);

    if (regression) {
      console.warn(
        `[export] ${regression.kind} (${regression.before} → ${regression.after}); ` +
          `dropping edit: "${replacement.slice(0, 60)}..."`
      );
      dropped.push(original);
      continue;
    }

    accepted.set(original, replacement);
    docxBuffer = candidateDocx;
    pdfBuffer = candidatePdf;
    final = candidateLayout;
  }

  return {
    docxBuffer,
    pdfBuffer,
    applied: [...accepted.keys()],
    dropped,
    baseline,
    final,
    regression: null,
  };
}
