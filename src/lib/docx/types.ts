import type {
  Requirement,
  CoverageReport,
  ParseabilityReport,
} from "../ats/types";

export type TextRun = {
  id: string;
  paragraphIndex: number;
  runIndex: number;
  text: string;
  sectionHint: string;
};

export type TextSection = {
  sectionName: string;
  runs: TextRun[];
  fullText: string;
};

export type ParsedDocx = {
  sections: TextSection[];
  allRuns: TextRun[];
  rawXml: string;
};

export type TailorChange = {
  original: string;
  replacement: string;
  reason: string;
};

export type TailoredSection = {
  sectionName: string;
  originalText: string;
  tailoredText: string;
  changes: TailorChange[];
  addedKeywords: string[];
};

/**
 * The model's advisory keyword read. Numeric scoring deliberately lives in
 * src/lib/ats/coverage.ts, computed from the text that actually ships — a model
 * grading its own edits can't be trusted, and can't see what was dropped later.
 */
export type ATSScore = {
  matchedKeywords: string[];
  missingKeywords: string[];
};

export type JobMeta = {
  company?: string;
};

/** A resume saved to disk and reloaded on every visit. */
export type BaseResumeInfo = {
  fileName: string;
  format: "docx" | "pdf";
  savedAt: string;
  sourcePath?: string;
  /** False for PDFs, which cannot be revised without shifting the layout. */
  canRevise: boolean;
  /** Present only when the resume can be revised. */
  docxBase64: string | null;
  revisionBlockedReason: string | null;
  /** Structural readability audit; null for PDFs, which expose no structure. */
  parseability: ParseabilityReport | null;
  sections: { sectionName: string; fullText: string; runCount: number }[];
};

export type TailorResult = {
  sections: TailoredSection[];
  atsScore: ATSScore;
  jobMeta?: JobMeta;
  /** Requirements extracted from the JD, attached server-side. */
  requirements?: Requirement[];
  /** Coverage of the untouched resume. */
  coverageBefore?: CoverageReport;
  /** Coverage assuming every proposed edit survives to export. */
  coverageProjected?: CoverageReport;
};
