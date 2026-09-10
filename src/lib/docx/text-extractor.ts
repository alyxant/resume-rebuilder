import type { TextRun, TextSection } from "./types";

const SECTION_KEYWORDS = [
  "summary",
  "objective",
  "experience",
  "work experience",
  "professional experience",
  "employment",
  "education",
  "skills",
  "technical skills",
  "core competencies",
  "certifications",
  "certificates",
  "projects",
  "leadership",
  "additional information",
  "awards",
  "honors",
  "publications",
  "references",
  "volunteer",
  "languages",
  "interests",
  "activities",
  "professional summary",
  "career summary",
  "profile",
  "qualifications",
  "achievements",
  "accomplishments",
];

export function detectSectionName(text: string): string | null {
  const cleaned = text.trim().toLowerCase().replace(/[:\-–—]/g, "").trim();
  for (const keyword of SECTION_KEYWORDS) {
    if (cleaned === keyword || cleaned.startsWith(keyword + " ")) {
      return keyword
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return null;
}

function isHeadingStyle(paragraph: Record<string, unknown>): boolean {
  const pPr = (paragraph as Record<string, unknown[]>)["w:pPr"];
  if (!pPr || !Array.isArray(pPr) || pPr.length === 0) return false;
  const props = pPr[0] as Record<string, unknown[]>;
  const pStyle = props?.["w:pStyle"];
  if (pStyle && Array.isArray(pStyle) && pStyle.length > 0) {
    const styleVal = (pStyle[0] as Record<string, Record<string, string>>)?.$
      ?.["w:val"];
    if (styleVal && /heading/i.test(styleVal)) return true;
  }
  return false;
}

function extractRunText(run: Record<string, unknown>): string {
  const texts = (run as Record<string, unknown[]>)["w:t"];
  if (!texts || !Array.isArray(texts)) return "";
  return texts
    .map((t) => {
      if (typeof t === "string") return t;
      if (typeof t === "object" && t !== null && "_" in t)
        return (t as Record<string, string>)._;
      return "";
    })
    .join("");
}

function getParagraphText(paragraph: Record<string, unknown>): string {
  const runs = (paragraph as Record<string, unknown[]>)["w:r"];
  if (!runs || !Array.isArray(runs)) return "";
  return runs.map((r) => extractRunText(r as Record<string, unknown>)).join("");
}

/**
 * Collect every paragraph in document order, descending into tables.
 *
 * Word resumes routinely lay out sections with tables, and a heading stranded
 * inside one would otherwise be invisible — leaving the content that follows it
 * attributed to the previous section.
 */
function collectParagraphs(
  node: Record<string, unknown>
): Record<string, unknown>[] {
  const children = node["$$"] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(children)) {
    // No ordered-children metadata: fall back to direct paragraphs only.
    const direct = node["w:p"];
    return Array.isArray(direct) ? (direct as Record<string, unknown>[]) : [];
  }

  const paragraphs: Record<string, unknown>[] = [];
  for (const child of children) {
    const name = child["#name"];
    if (name === "w:p") {
      paragraphs.push(child);
    } else if (name === "w:tbl" || name === "w:tr" || name === "w:tc") {
      paragraphs.push(...collectParagraphs(child));
    }
  }
  return paragraphs;
}

export function extractTextRuns(
  documentXml: Record<string, unknown>
): TextRun[] {
  const runs: TextRun[] = [];
  const body = getBody(documentXml);
  if (!body) return runs;

  const paragraphs = collectParagraphs(body);
  if (paragraphs.length === 0) return runs;

  let currentSection = "Header";

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx] as Record<string, unknown>;
    const paraText = getParagraphText(para);
    const detectedSection = detectSectionName(paraText);
    const isHeading = isHeadingStyle(para);

    if (detectedSection || (isHeading && paraText.trim().length > 0)) {
      currentSection = detectedSection || paraText.trim();
    }

    const paraRuns = (para as Record<string, unknown[]>)["w:r"];
    if (!paraRuns || !Array.isArray(paraRuns)) continue;

    for (let rIdx = 0; rIdx < paraRuns.length; rIdx++) {
      const run = paraRuns[rIdx] as Record<string, unknown>;
      const text = extractRunText(run);
      if (text.length === 0) continue;

      runs.push({
        id: `p${pIdx}-r${rIdx}`,
        paragraphIndex: pIdx,
        runIndex: rIdx,
        text,
        sectionHint: currentSection,
      });
    }
  }

  return runs;
}

/**
 * Group already-flat text (a PDF's extracted lines) into the same section shape
 * the DOCX path produces, so both formats render identically in the UI.
 */
export function sectionsFromPlainText(text: string): TextSection[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));

  const sections: TextSection[] = [];
  let currentName = "Header";
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({
      sectionName: currentName,
      runs: [],
      fullText: currentLines.join("\n"),
    });
    currentLines = [];
  };

  for (const line of lines) {
    const detected = detectSectionName(line);
    if (detected) {
      flush();
      currentName = detected;
      continue;
    }
    currentLines.push(line);
  }
  flush();

  return sections;
}

export function groupRunsIntoSections(runs: TextRun[]): TextSection[] {
  const sectionMap = new Map<string, TextRun[]>();
  const sectionOrder: string[] = [];

  for (const run of runs) {
    if (!sectionMap.has(run.sectionHint)) {
      sectionMap.set(run.sectionHint, []);
      sectionOrder.push(run.sectionHint);
    }
    sectionMap.get(run.sectionHint)!.push(run);
  }

  return sectionOrder.map((sectionName) => {
    const sectionRuns = sectionMap.get(sectionName)!;
    const fullText = buildSectionText(sectionRuns);
    return { sectionName, runs: sectionRuns, fullText };
  });
}

function buildSectionText(runs: TextRun[]): string {
  let result = "";
  let lastParagraphIndex = -1;

  for (const run of runs) {
    if (run.paragraphIndex !== lastParagraphIndex && lastParagraphIndex !== -1) {
      result += "\n";
    }
    result += run.text;
    lastParagraphIndex = run.paragraphIndex;
  }

  return result;
}

function getBody(
  documentXml: Record<string, unknown>
): Record<string, unknown> | null {
  const doc = documentXml["w:document"] as Record<string, unknown[]>;
  if (!doc) {
    // Try without namespace prefix
    const keys = Object.keys(documentXml);
    for (const key of keys) {
      if (key.includes("document")) {
        const d = documentXml[key] as Record<string, unknown[]>;
        const bodyKey = Object.keys(d).find((k) => k.includes("body"));
        if (bodyKey && Array.isArray(d[bodyKey]) && d[bodyKey].length > 0) {
          return d[bodyKey][0] as Record<string, unknown>;
        }
      }
    }
    return null;
  }
  const body = doc["w:body"];
  if (!body || !Array.isArray(body) || body.length === 0) return null;
  return body[0] as Record<string, unknown>;
}
