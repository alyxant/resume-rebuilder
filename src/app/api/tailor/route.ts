import { NextRequest, NextResponse } from "next/server";
import { parseDocx } from "@/lib/docx/parser";
import { extractTextRuns, groupRunsIntoSections } from "@/lib/docx/text-extractor";
import { tailorResume } from "@/lib/ai/tailor";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { docxBase64, jobDescription, companyName } = body;

    if (!docxBase64 || !jobDescription) {
      return NextResponse.json(
        { error: "Missing resume data or job description" },
        { status: 400 }
      );
    }

    // Re-parse the DOCX to get sections
    const buffer = Buffer.from(docxBase64, "base64");
    const archive = await parseDocx(buffer);
    const runs = extractTextRuns(archive.documentXml);
    const sections = groupRunsIntoSections(runs);

    // Send to Claude for tailoring
    const result = await tailorResume(sections, jobDescription, companyName);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailor error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to tailor resume";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
