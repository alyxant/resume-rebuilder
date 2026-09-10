import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";
import { parseDocx } from "@/lib/docx/parser";
import {
  extractTextRuns,
  groupRunsIntoSections,
  sectionsFromPlainText,
} from "@/lib/docx/text-extractor";
import { TextSection } from "@/lib/docx/types";
import { auditParseability } from "@/lib/ats/parseability";
import type { ParseabilityReport } from "@/lib/ats/types";
import {
  loadBaseResume,
  saveBaseResume,
  clearBaseResume,
  canRevise,
  BaseResumeFormat,
  BaseResumeMeta,
} from "@/lib/base-resume/store";

function formatOf(fileName: string): BaseResumeFormat | null {
  if (/\.docx$/i.test(fileName)) return "docx";
  if (/\.pdf$/i.test(fileName)) return "pdf";
  return null;
}

async function readSections(
  buffer: Buffer,
  format: BaseResumeFormat
): Promise<TextSection[]> {
  if (format === "docx") {
    const archive = await parseDocx(buffer);
    return groupRunsIntoSections(extractTextRuns(archive.documentXml));
  }

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const { text } = await parser.getText();
    return sectionsFromPlainText(text);
  } finally {
    await parser.destroy?.();
  }
}

async function describe(meta: BaseResumeMeta, buffer: Buffer) {
  const sections = await readSections(buffer, meta.format);
  const revisable = canRevise(meta.format);

  // Structural readability is a property of the file, not of any job, so it is
  // reported as soon as a resume is saved. Only DOCX exposes the structure the
  // audit inspects.
  let parseability: ParseabilityReport | null = null;
  if (meta.format === "docx") {
    try {
      parseability = await auditParseability(await parseDocx(buffer));
    } catch (error) {
      console.error("Parseability audit failed:", error);
    }
  }

  return {
    parseability,
    fileName: meta.fileName,
    format: meta.format,
    savedAt: meta.savedAt,
    sourcePath: meta.sourcePath,
    canRevise: revisable,
    // Only DOCX carries the formatting the export pipeline edits in place.
    docxBase64: revisable ? buffer.toString("base64") : null,
    revisionBlockedReason: revisable
      ? null
      : "Saved as reference only. A PDF stores text at fixed coordinates, so " +
        "revising it would shift the layout and break lines. Save the .docx " +
        "this PDF was exported from to enable tailoring.",
    sections: sections.map((s) => ({
      sectionName: s.sectionName,
      fullText: s.fullText,
      runCount: s.runs.length,
    })),
  };
}

export async function GET() {
  const stored = loadBaseResume();
  if (!stored) return NextResponse.json({ baseResume: null });

  try {
    return NextResponse.json({
      baseResume: await describe(stored.meta, stored.buffer),
    });
  } catch (error) {
    console.error("Base resume read error:", error);
    return NextResponse.json(
      { error: "Saved base resume could not be parsed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let buffer: Buffer;
    let fileName: string;
    let sourcePath: string | undefined;

    if (contentType.includes("application/json")) {
      // Import straight from a path on disk, so a resume already on the
      // machine can be saved without a round trip through the browser.
      const { path } = (await request.json()) as { path?: string };
      if (!path) {
        return NextResponse.json({ error: "No path provided" }, { status: 400 });
      }
      if (!existsSync(path)) {
        return NextResponse.json(
          { error: `No file at ${path}` },
          { status: 404 }
        );
      }
      buffer = readFileSync(path);
      fileName = basename(path);
      sourcePath = path;
    } else {
      const formData = await request.formData();
      const file = formData.get("resume") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
    }

    const format = formatOf(fileName);
    if (!format) {
      return NextResponse.json(
        { error: "Base resume must be a .docx or .pdf file" },
        { status: 400 }
      );
    }

    // Parse before saving so a corrupt file never becomes the stored base.
    await readSections(buffer, format);

    const meta = saveBaseResume(buffer, { fileName, format, sourcePath });
    return NextResponse.json({ baseResume: await describe(meta, buffer) });
  } catch (error) {
    console.error("Base resume save error:", error);
    return NextResponse.json(
      { error: "Failed to save base resume. Ensure the file is valid." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  clearBaseResume();
  return NextResponse.json({ baseResume: null });
}
