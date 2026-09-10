import { NextRequest, NextResponse } from "next/server";
import { applyEditsLayoutSafe } from "@/lib/docx/apply-edits";
import { sectionsFromPlainText } from "@/lib/docx/text-extractor";
import { extractRequirements } from "@/lib/ats/requirements";
import { scoreCoverage } from "@/lib/ats/coverage";
import type { TailoredSection } from "@/lib/docx/types";
import type { ExportReport } from "@/lib/ats/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { docxBase64, tailoredSections, jobDescription } = body as {
      docxBase64: string;
      tailoredSections: TailoredSection[];
      jobDescription?: string;
    };

    if (!docxBase64 || !tailoredSections) {
      return NextResponse.json(
        { error: "Missing resume data or tailored sections" },
        { status: 400 }
      );
    }

    const sourceBuffer = Buffer.from(docxBase64, "base64");
    const result = await applyEditsLayoutSafe(sourceBuffer, tailoredSections);

    const report: ExportReport = {
      appliedEdits: result.applied.length,
      droppedEdits: result.dropped,
    };

    // Score the text as it exists in the rendered PDF — after every edit that
    // was filtered for length or dropped to protect the layout. This is the
    // only number that describes the file the user actually downloads.
    if (jobDescription?.trim()) {
      try {
        const requirements = await extractRequirements(jobDescription);
        const exportedText = result.final.lines.join("\n");
        report.verifiedCoverage = scoreCoverage(
          requirements,
          sectionsFromPlainText(exportedText)
        );
      } catch (error) {
        // A scoring failure must never cost the user their resume.
        console.error("Verified coverage failed:", error);
      }
    }

    return NextResponse.json({
      pdfBase64: result.pdfBuffer.toString("base64"),
      report,
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export tailored resume" },
      { status: 500 }
    );
  }
}
