import type {
  Requirement,
  CoverageStatus,
  CoverageReport,
  RequirementCoverage,
} from "./types";

/**
 * Deterministic keyword coverage. No model is involved: a requirement counts
 * only when its text literally appears in the resume, so a score can never be
 * inflated by an LLM's opinion of its own work.
 */

/** Fold away the cosmetic differences between a JD and a resume. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, "-") // dash variants
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "Enterprise Resource Planning (ERP)" also matches as the bare phrase or the
 * bare acronym, which is how the two forms actually appear in resumes.
 */
export function expandAcronyms(term: string): string[] {
  const forms = new Set<string>([term]);
  const match = term.match(/^(.*?)\s*\(([A-Za-z][A-Za-z0-9./+-]{1,9})\)\s*(.*)$/);

  if (match) {
    const [, before, acronym, after] = match;
    const spelled = `${before} ${after}`.replace(/\s+/g, " ").trim();
    if (spelled) forms.add(spelled);
    const acronymPhrase = `${acronym} ${after}`.replace(/\s+/g, " ").trim();
    forms.add(acronymPhrase);
    forms.add(acronym);
  }

  return [...forms].filter((f) => f.length > 0);
}

/**
 * Match on token boundaries so "API" doesn't fire inside "rapid". A hit that
 * exists only mid-token — "SQL" inside "MySQL" — is reported as partial, since
 * it's related evidence but not the term the recruiter searched for.
 */
function findPhrase(
  haystack: string,
  phrase: string
): { status: Exclude<CoverageStatus, "missing">; index: number } | null {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return null;

  // Allow any whitespace run between the phrase's own tokens.
  const pattern = normalizedPhrase
    .split(" ")
    .map(escapeRegex)
    .join("\\s+");

  const bounded = new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`);
  const boundedHit = bounded.exec(haystack);
  if (boundedHit) return { status: "covered", index: boundedHit.index };

  // A mid-token hit only counts as partial when it aligns to one edge of the
  // word: "SQL" ending "MySQL" is real evidence, but "API" buried inside
  // "rapid" is a coincidence that would otherwise inflate the score.
  const loose = new RegExp(pattern, "g");
  let hit: RegExpExecArray | null;
  while ((hit = loose.exec(haystack)) !== null) {
    const start = hit.index;
    const end = start + hit[0].length;
    const startsWord = start === 0 || !/[a-z0-9]/.test(haystack[start - 1]);
    const endsWord = end >= haystack.length || !/[a-z0-9]/.test(haystack[end]);
    if (startsWord || endsWord) return { status: "partial", index: start };
  }

  return null;
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

const STATUS_RANK: Record<CoverageStatus, number> = {
  covered: 2,
  partial: 1,
  missing: 0,
};

export type ScoredSection = { sectionName: string; fullText: string };

/**
 * Score a requirement set against resume sections. Sections are searched in
 * order so the reported location is the first place a term genuinely appears.
 */
export function scoreCoverage(
  requirements: Requirement[],
  sections: ScoredSection[]
): CoverageReport {
  const normalizedSections = sections.map((s) => ({
    sectionName: s.sectionName,
    original: s.fullText,
    normalized: normalize(s.fullText),
  }));

  const results: RequirementCoverage[] = requirements.map((requirement) => {
    const surfaceForms = [
      ...new Set([
        ...expandAcronyms(requirement.term),
        ...requirement.variants.flatMap(expandAcronyms),
      ]),
    ];

    let best: RequirementCoverage = { requirement, status: "missing" };

    for (const section of normalizedSections) {
      for (const form of surfaceForms) {
        const hit = findPhrase(section.normalized, form);
        if (!hit) continue;
        if (STATUS_RANK[hit.status] <= STATUS_RANK[best.status]) continue;

        best = {
          requirement,
          status: hit.status,
          matchedVariant: form,
          foundInSection: section.sectionName,
          snippet: snippetAround(section.normalized, hit.index, form.length),
        };

        if (best.status === "covered") break;
      }
      if (best.status === "covered") break;
    }

    return best;
  });

  // Must-haves count double; a partial hit earns half credit.
  const weightOf = (r: Requirement) => (r.priority === "must-have" ? 2 : 1);
  const creditOf = (s: CoverageStatus) =>
    s === "covered" ? 1 : s === "partial" ? 0.5 : 0;

  const totalWeight = requirements.reduce((sum, r) => sum + weightOf(r), 0);
  const earned = results.reduce(
    (sum, r) => sum + weightOf(r.requirement) * creditOf(r.status),
    0
  );

  return {
    score: totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100),
    covered: results.filter((r) => r.status === "covered").length,
    partial: results.filter((r) => r.status === "partial").length,
    missing: results.filter((r) => r.status === "missing").length,
    total: results.length,
    results,
  };
}
