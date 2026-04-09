import { NextRequest, NextResponse } from "next/server";
import { parseDocx } from "@/lib/docx/parser";
import { extractTextRuns, groupRunsIntoSections } from "@/lib/docx/text-extractor";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("resume") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (
      !file.name.endsWith(".docx") &&
      file.type !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return NextResponse.json(
        { error: "Please upload a .docx file" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const archive = await parseDocx(buffer);
    const runs = extractTextRuns(archive.documentXml);
    const sections = groupRunsIntoSections(runs);

    // Store the raw buffer as base64 for later reassembly
    const base64Docx = buffer.toString("base64");

    return NextResponse.json({
      sections: sections.map((s) => ({
        sectionName: s.sectionName,
        fullText: s.fullText,
        runCount: s.runs.length,
      })),
      docxBase64: base64Docx,
      fileName: file.name,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to parse resume. Ensure it is a valid .docx file." },
      { status: 500 }
    );
  }
}
