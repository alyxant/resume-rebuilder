import { NextRequest, NextResponse } from "next/server";
import { parseDocx, assembleDocx } from "@/lib/docx/parser";
import { TailoredSection } from "@/lib/docx/types";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const tempFiles: string[] = [];

  try {
    const body = await request.json();
    const { docxBase64, tailoredSections } = body as {
      docxBase64: string;
      tailoredSections: TailoredSection[];
    };

    if (!docxBase64 || !tailoredSections) {
      return NextResponse.json(
        { error: "Missing resume data or tailored sections" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(docxBase64, "base64");
    const archive = await parseDocx(buffer);

    // Build a map of original text → tailored text for direct XML replacement
    const replacements = new Map<string, string>();
    for (const section of tailoredSections) {
      if (section.tailoredText === section.originalText) continue;

      for (const change of section.changes) {
        if (change.original && change.replacement && change.original !== change.replacement) {
          // Truncate replacement to original length to preserve line structure
          const trimmed =
            change.replacement.length > change.original.length
              ? change.replacement.slice(0, change.original.length)
              : change.replacement;
          replacements.set(change.original, trimmed);
        }
      }
    }

    // Assemble modified DOCX using direct string replacement on raw XML
    const outputBuffer = await assembleDocx(archive, replacements);

    // Convert DOCX to PDF using LibreOffice
    const id = randomUUID();
    const tempDocx = join(tmpdir(), `resume-${id}.docx`);
    const tempPdf = join(tmpdir(), `resume-${id}.pdf`);
    tempFiles.push(tempDocx, tempPdf);

    writeFileSync(tempDocx, outputBuffer);

    const soffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    execSync(
      `"${soffice}" --headless --convert-to pdf --outdir "${tmpdir()}" "${tempDocx}"`,
      { timeout: 30000 }
    );

    if (!existsSync(tempPdf)) {
      throw new Error("PDF conversion failed — output file not found");
    }

    const pdfBuffer = readFileSync(tempPdf);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="tailored-resume.pdf"',
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export tailored resume" },
      { status: 500 }
    );
  } finally {
    for (const f of tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
