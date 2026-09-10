import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

function libreOfficeCommand(): string {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH;

  const candidates =
    process.platform === "win32"
      ? [
          `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\LibreOffice\\program\\soffice.exe`,
          `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\LibreOffice\\program\\soffice.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
        : [];

  return candidates.find(existsSync) ?? "soffice";
}

export type Layout = {
  pageCount: number;
  /** One entry per rendered visual line, in reading order. */
  lines: string[];
};

/** Render a DOCX to PDF with LibreOffice and return the PDF bytes. */
export function renderPdf(docxBuffer: Buffer): Buffer {
  const id = randomUUID();
  const docxPath = join(/* turbopackIgnore: true */ tmpdir(), `resume-${id}.docx`);
  const pdfPath = join(/* turbopackIgnore: true */ tmpdir(), `resume-${id}.pdf`);

  try {
    writeFileSync(docxPath, docxBuffer);
    try {
      execFileSync(
        libreOfficeCommand(),
        ["--headless", "--convert-to", "pdf", "--outdir", tmpdir(), docxPath],
        { timeout: 60000, stdio: "ignore" }
      );
    } catch (error) {
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === "ENOENT") {
        throw new Error(
          "LibreOffice is required for PDF export. Install it, restart the app, " +
            "or set LIBREOFFICE_PATH to the full path to soffice.exe."
        );
      }
      throw error;
    }

    if (!existsSync(pdfPath)) {
      throw new Error("PDF conversion failed — output file not found");
    }
    return readFileSync(pdfPath);
  } finally {
    for (const f of [docxPath, pdfPath]) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

/**
 * Measure how a rendered PDF actually lays out: how many pages it occupies and
 * how many visual lines it breaks into. Text extraction preserves one entry per
 * rendered line, so a bullet that wraps to a second line shows up here as an
 * extra entry — which is exactly the regression we need to catch.
 */
export async function measureLayout(pdfBuffer: Buffer): Promise<Layout> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });

  try {
    const result = await parser.getText();
    const lines = result.text
      .split("\n")
      .map((l) => l.trim())
      // LibreOffice emits a page-break marker line per page; drop it so line
      // counts compare cleanly across renders.
      .filter((l) => l.length > 0 && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));

    return { pageCount: result.pages?.length ?? result.total ?? 1, lines };
  } finally {
    await parser.destroy?.();
  }
}

export async function measureDocx(docxBuffer: Buffer): Promise<Layout> {
  return measureLayout(renderPdf(docxBuffer));
}

export type LayoutRegression = {
  kind: "page-growth" | "line-growth";
  before: number;
  after: number;
};

/**
 * Compare a tailored layout against the original. Any growth in page count or
 * visual line count means text wrapped or overflowed — the resume's line
 * structure changed, which is precisely what must never happen.
 */
export function findRegression(
  before: Layout,
  after: Layout
): LayoutRegression | null {
  if (after.pageCount > before.pageCount) {
    return {
      kind: "page-growth",
      before: before.pageCount,
      after: after.pageCount,
    };
  }
  if (after.lines.length > before.lines.length) {
    return {
      kind: "line-growth",
      before: before.lines.length,
      after: after.lines.length,
    };
  }
  return null;
}
