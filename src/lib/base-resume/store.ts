import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

export type BaseResumeFormat = "docx" | "pdf";

export type BaseResumeMeta = {
  fileName: string;
  format: BaseResumeFormat;
  savedAt: string;
  /** Where the file was imported from, for the user's reference. */
  sourcePath?: string;
};

export type BaseResume = {
  meta: BaseResumeMeta;
  buffer: Buffer;
};

const STORE_DIR = join(process.cwd(), ".base-resume");
const META_PATH = join(STORE_DIR, "meta.json");

function filePath(format: BaseResumeFormat): string {
  return join(STORE_DIR, `resume.${format}`);
}

/**
 * Only DOCX can be revised with the original formatting intact. The export
 * pipeline edits text in place inside word/document.xml, which leaves every
 * style, margin, tab stop, and line break exactly as authored. A PDF stores
 * glyphs at fixed coordinates with subset-embedded fonts, so substituting text
 * of a different width overlaps neighbouring runs instead of reflowing — it
 * cannot be revised without altering the layout.
 */
export function canRevise(format: BaseResumeFormat): boolean {
  return format === "docx";
}

export function loadBaseResume(): BaseResume | null {
  if (!existsSync(META_PATH)) return null;

  try {
    const meta = JSON.parse(readFileSync(META_PATH, "utf8")) as BaseResumeMeta;
    const path = filePath(meta.format);
    if (!existsSync(path)) return null;
    return { meta, buffer: readFileSync(path) };
  } catch {
    return null;
  }
}

export function saveBaseResume(
  buffer: Buffer,
  meta: Omit<BaseResumeMeta, "savedAt">
): BaseResumeMeta {
  mkdirSync(STORE_DIR, { recursive: true });

  // Clear any previously saved resume in the other format so the store never
  // holds two candidates.
  for (const format of ["docx", "pdf"] as const) {
    const stale = filePath(format);
    if (format !== meta.format && existsSync(stale)) rmSync(stale);
  }

  const saved: BaseResumeMeta = { ...meta, savedAt: new Date().toISOString() };
  writeFileSync(filePath(meta.format), buffer);
  writeFileSync(META_PATH, JSON.stringify(saved, null, 2));
  return saved;
}

export function clearBaseResume(): void {
  if (existsSync(STORE_DIR)) rmSync(STORE_DIR, { recursive: true, force: true });
}
