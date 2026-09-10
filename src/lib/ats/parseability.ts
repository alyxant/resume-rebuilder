import type { DocxArchive } from "../docx/parser";
import { detectSectionName } from "../docx/text-extractor";
import type { ParseabilityFinding, ParseabilityReport } from "./types";

/**
 * Structural audit of a .docx, independent of any job description.
 *
 * Keyword coverage is worthless if the parser can't read the file in the first
 * place. Every check here targets a construct that makes an ATS drop, reorder,
 * or merge content — the failure mode that hid this resume's own Experience
 * heading inside a table.
 */

const BULLET_GLYPHS = /[●•▪‣◦]/;
const EDUCATION_SIGNALS =
  /\b(universit|college|b\.?s\.?|b\.?a\.?|bachelor|master|m\.?b\.?a\.?|gpa|degree|minor)\b/i;

function paragraphsOf(xml: string): string[] {
  return xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? [];
}

function textOf(paragraphXml: string): string {
  const parts = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
  return parts
    .map((m) => m[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Bullets typed inline rather than split into their own paragraphs. */
function countLeadingBullets(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (!BULLET_GLYPHS.test(text[i])) continue;
    const before = text.slice(0, i).trimEnd();
    // A real bullet opens the paragraph or follows a finished sentence; a glyph
    // between short items ("JavaScript • Node.js") is a separator, not a bullet.
    if (before.length === 0 || /[.!?;:]$/.test(before)) count++;
  }
  return count;
}

const MONTH =
  "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_RE = new RegExp(`${MONTH}\\s+\\d{4}|\\b(?:19|20)\\d{2}\\b`, "gi");
const RANGE_RE = /[–—-]|\bto\b|\bpresent\b|\bcurrent\b|\bongoing\b/i;

function looksLikeHeading(paragraphXml: string, text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (BULLET_GLYPHS.test(trimmed)) return false;
  if (!/<w:b\/>/.test(paragraphXml)) return false;
  // Headings don't carry dates or contact details.
  if (/\d{4}/.test(trimmed) || trimmed.includes("@")) return false;
  // Section headings are terse; longer bold lines are employer/school entries.
  if (trimmed.split(/\s+/).length > 4) return false;
  return true;
}

/**
 * An entry line pairs a title with a date. A paragraph holding nothing but a
 * date is a table cell fragment or a graduation date, not an open-ended range.
 */
function hasSubstantiveTextBesidesDate(text: string, date: string): boolean {
  return text.replace(date, "").replace(/[^A-Za-z]/g, "").length >= 12;
}

export async function auditParseability(
  archive: DocxArchive
): Promise<ParseabilityReport> {
  const xml = archive.rawDocumentXml;
  const findings: ParseabilityFinding[] = [];

  // --- Layout tables -------------------------------------------------------
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  if (tables.length > 0) {
    const enclosed = tables.map(textOf).join(" ").replace(/\s+/g, " ").trim();
    findings.push({
      id: "layout-table",
      severity: "high",
      title: `${tables.length} layout table${tables.length === 1 ? "" : "s"} in the document`,
      detail:
        "Many ATS parsers read table cells out of order, merge them, or skip " +
        "them entirely. Any section heading inside a table can be lost, which " +
        "causes the content beneath it to be filed under the wrong section. " +
        "Rebuild these rows with tab stops instead.",
      evidence: enclosed.slice(0, 220) + (enclosed.length > 220 ? "…" : ""),
    });
  }

  // --- Text boxes ----------------------------------------------------------
  if (/<w:txbxContent>/.test(xml)) {
    findings.push({
      id: "text-box",
      severity: "high",
      title: "Content inside a text box",
      detail:
        "Text boxes sit outside the main document flow and are frequently " +
        "invisible to resume parsers. Move this text into ordinary paragraphs.",
    });
  }

  // --- Multi-column layout -------------------------------------------------
  const cols = xml.match(/<w:cols[^>]*w:num="(\d+)"/);
  if (cols && Number(cols[1]) > 1) {
    findings.push({
      id: "multi-column",
      severity: "high",
      title: `Page uses ${cols[1]} columns`,
      detail:
        "Multi-column layouts are commonly flattened left-to-right across the " +
        "page, interleaving unrelated lines into nonsense.",
    });
  }

  // --- Contact details stranded in a header/footer -------------------------
  const headerFooterNames = Object.keys(archive.zip.files).filter((name) =>
    /^word\/(header|footer)\d*\.xml$/.test(name)
  );
  for (const name of headerFooterNames) {
    const content = await archive.zip.file(name)!.async("string");
    const text = textOf(content);
    const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
    const hasPhone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(text);
    if (hasEmail || hasPhone) {
      findings.push({
        id: `contact-in-${name.includes("header") ? "header" : "footer"}`,
        severity: "high",
        title: "Contact details live in the page header or footer",
        detail:
          "Parsers routinely ignore headers and footers, so an email or phone " +
          "number placed there can be dropped — leaving a resume nobody can " +
          "reply to. Move contact details into the body of the page.",
        evidence: text.trim().slice(0, 120),
      });
      break;
    }
  }

  // --- Per-paragraph checks ------------------------------------------------
  const mergedBullets: string[] = [];
  const openEndedDates: string[] = [];
  const manualBullets: string[] = [];
  const unknownHeadings: string[] = [];

  // Everything above the first real section heading is the contact block —
  // the candidate's own name is bold and terse, but it isn't a section.
  let pastHeaderBlock = false;

  for (const paragraph of paragraphsOf(xml)) {
    const text = textOf(paragraph);
    const trimmed = text.trim();
    if (!trimmed) continue;

    if (detectSectionName(trimmed)) pastHeaderBlock = true;

    if (countLeadingBullets(trimmed) > 1) {
      mergedBullets.push(trimmed.slice(0, 100));
    }

    if (BULLET_GLYPHS.test(trimmed[0] ?? "") && !/<w:numPr>/.test(paragraph)) {
      manualBullets.push(trimmed.slice(0, 60));
    }

    const dates = trimmed.match(DATE_RE) ?? [];
    if (
      dates.length === 1 &&
      !RANGE_RE.test(trimmed.slice(trimmed.indexOf(dates[0]))) &&
      !EDUCATION_SIGNALS.test(trimmed) &&
      hasSubstantiveTextBesidesDate(trimmed, dates[0])
    ) {
      openEndedDates.push(trimmed.slice(0, 100));
    }

    if (
      pastHeaderBlock &&
      looksLikeHeading(paragraph, trimmed) &&
      !detectSectionName(trimmed)
    ) {
      unknownHeadings.push(trimmed);
    }
  }

  if (mergedBullets.length > 0) {
    findings.push({
      id: "merged-bullets",
      severity: "medium",
      title: `${mergedBullets.length} paragraph${mergedBullets.length === 1 ? "" : "s"} containing multiple bullets`,
      detail:
        "These bullets share one paragraph instead of standing on their own. " +
        "A parser may merge them into a single run-on line, and editing one " +
        "shifts where the others wrap — so tailored edits here are more likely " +
        "to be dropped by the layout check.",
      evidence: mergedBullets[0] + "…",
    });
  }

  if (openEndedDates.length > 0) {
    findings.push({
      id: "open-ended-date",
      severity: "medium",
      title: `${openEndedDates.length} entr${openEndedDates.length === 1 ? "y has" : "ies have"} a start date with no end date`,
      detail:
        "A single date with no end date or “Present” gives parsers nothing to " +
        "compute duration from, so the role or project may contribute zero " +
        "months of experience.",
      evidence: openEndedDates[0],
    });
  }

  if (manualBullets.length > 0) {
    findings.push({
      id: "manual-bullets",
      severity: "low",
      title: `${manualBullets.length} bullet${manualBullets.length === 1 ? "" : "s"} typed as plain characters`,
      detail:
        "These use a typed glyph rather than Word list formatting. It parses " +
        "acceptably, but real lists survive format conversion more reliably.",
      evidence: manualBullets[0],
    });
  }

  if (unknownHeadings.length > 0) {
    findings.push({
      id: "unknown-heading",
      severity: "low",
      title: `${unknownHeadings.length} unrecognized section heading${unknownHeadings.length === 1 ? "" : "s"}`,
      detail:
        "These don't match a standard resume section name, so a parser — and " +
        "this app's own tailoring step — may file the content beneath them " +
        "under the previous section.",
      evidence: unknownHeadings.join(", ").slice(0, 160),
    });
  }

  return {
    findings,
    blocking: findings.filter((f) => f.severity === "high").length,
  };
}
