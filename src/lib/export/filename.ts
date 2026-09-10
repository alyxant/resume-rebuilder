/**
 * Build a short, scannable filename for an exported resume.
 *
 * These pile up in a downloads folder one per application, so the goal is a
 * name that stays distinguishable at a glance without running long: the
 * candidate's name, and the part of the company name that actually identifies
 * it. Version noise from the source file ("2026", "(1)", "(editable)") carries
 * no meaning here and is dropped.
 */

/** Legal-entity suffixes and leading articles that don't identify a company. */
const COMPANY_NOISE =
  /\b(?:inc|incorporated|llc|l\.l\.c|plc|ltd|limited|co|corp|corporation|company|gmbh|s\.a|n\.v|ag|ab|pty|lp|llp|holdings|group|the)\b\.?/gi;

/** "2026", "(1)", "(editable)", "copy", "final", "v2" — file bookkeeping. */
const BASE_NOISE =
  /\((?:\d+|editable|copy|final|draft|new|updated)\)|\b(?:19|20)\d{2}\b|\bv\d+\b|\b(?:copy|final|draft|updated)\b/gi;

/** Strip characters no filesystem should be asked to hold, and tidy spacing. */
export function sanitizeForFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Anthony Ha Resume 2026 (1)" → "Anthony Ha Resume" */
export function cleanBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.(docx|pdf)$/i, "");
  const cleaned = sanitizeForFilename(
    withoutExtension.replace(BASE_NOISE, " ")
  ).replace(/[-–—\s]+$/, "");
  return cleaned || "Resume";
}

/**
 * Reduce a company to the word that identifies it.
 *
 * "Skyward Specialty Insurance" → "Skyward"; "JPMorgan Chase & Co" →
 * "JPMorgan". A very short leading token is kept with its neighbour so an
 * abbreviation like "GE Aerospace" doesn't collapse to something unreadable.
 */
export function shortCompany(company: string): string {
  const cleaned = sanitizeForFilename(
    company
      .replace(COMPANY_NOISE, " ")
      .replace(/[&,]/g, " ")
      .replace(/\s+/g, " ")
  );

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length === 0) return "";

  // An initialism identifies nothing on its own — "D.R. Horton" and
  // "GE Aerospace" need their second word, while "Acme Freight" doesn't.
  const first = words[0];
  const needsPartner = first.includes(".") || first.length <= 3;
  const short = needsPartner && words[1] ? `${first} ${words[1]}` : first;

  // Never let a trailing abbreviation dot run into the file extension.
  return short.replace(/\.+$/, "").slice(0, 24);
}

export function buildExportFilename(
  sourceFileName: string,
  company: string | undefined
): string {
  const base = cleanBaseName(sourceFileName);
  const suffix = company ? shortCompany(company) : "";
  return suffix ? `${base} - ${suffix}.pdf` : `${base}.pdf`;
}
