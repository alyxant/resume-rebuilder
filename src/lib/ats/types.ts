/** A single thing the job description asks for. */
export type Requirement = {
  /** Canonical form, e.g. "Purchase Order (PO) management". */
  term: string;
  /** Alternate surface forms to accept as a match. */
  variants: string[];
  category: "tool" | "skill" | "credential" | "responsibility";
  priority: "must-have" | "nice-to-have";
  /** Verbatim quote from the JD. Verified against the source before use. */
  evidence: string;
};

export type CoverageStatus = "covered" | "partial" | "missing";

export type RequirementCoverage = {
  requirement: Requirement;
  status: CoverageStatus;
  /** Which surface form actually matched. */
  matchedVariant?: string;
  /** Section the match was found in. */
  foundInSection?: string;
  /** Surrounding text, for showing the user where it landed. */
  snippet?: string;
};

export type CoverageReport = {
  /** 0-100, weighted by requirement priority. */
  score: number;
  covered: number;
  partial: number;
  missing: number;
  total: number;
  results: RequirementCoverage[];
};

export type ParseabilitySeverity = "high" | "medium" | "low";

export type ParseabilityFinding = {
  id: string;
  severity: ParseabilitySeverity;
  title: string;
  detail: string;
  /** Text from the document demonstrating the problem. */
  evidence?: string;
};

export type ParseabilityReport = {
  findings: ParseabilityFinding[];
  /** Count of high-severity findings — the ones that can hide content. */
  blocking: number;
};

/** What the export route reports back alongside the finished PDF. */
export type ExportReport = {
  appliedEdits: number;
  /** Edits removed because they would have broken the page layout. */
  droppedEdits: string[];
  /** Coverage measured on the text actually present in the exported PDF. */
  verifiedCoverage?: CoverageReport;
};
