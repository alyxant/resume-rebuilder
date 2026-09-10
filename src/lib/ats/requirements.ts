import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getProvider } from "../ai/provider";
import { parseJsonResponse } from "../ai/json";
import { normalize } from "./coverage";
import type { Requirement } from "./types";

/**
 * Turn a job description into a typed requirement list.
 *
 * The model supplies vocabulary only — never a score. Every requirement must
 * carry a verbatim quote from the posting, and any whose quote is not actually
 * present is discarded by code below. A requirement that survives but doesn't
 * belong can only ever read as "missing", which lowers the score, so the
 * failure direction is safe.
 */

const CACHE_DIR = join(process.cwd(), ".ats-cache");

/**
 * Bump whenever EXTRACTION_PROMPT changes materially — it is part of the cache
 * key, so old entries retire instead of masking the new behaviour.
 */
const EXTRACTION_VERSION = "v2";

const EXTRACTION_PROMPT = `You extract hiring requirements from a job description. You do NOT judge or score any resume — you are building a vocabulary list.

For each distinct thing the posting asks for, emit one requirement:

- "term": the canonical name, using the POSTING'S OWN wording and capitalization. If the posting spells out an acronym, keep the combined form, e.g. "Enterprise Resource Planning (ERP)".
  CRITICAL: a term must be a SHORT, SEARCHABLE phrase of 1-5 words that could plausibly appear verbatim in a resume bullet. Never a full sentence or clause. Strip quantities and framing: "2+ years of supply chain experience" yields the term "supply chain experience" — the "2+ years" belongs in evidence, not the term. "Ability to build reporting in Excel and Tableau" yields separate terms "Excel" and "Tableau", not the whole phrase. A term nobody would write verbatim on a resume is a bad term.
- "variants": other surface forms a resume might legitimately use for the SAME thing — abbreviations, plurals, common synonyms, verb forms. Example: for "Purchase Order (PO) management" → ["purchase orders", "PO management", "managing purchase orders"]. Do not add loosely related concepts.
- "category": "tool" (named software/platform), "skill" (a technique or competency), "credential" (degree, certification, clearance, years-of-experience), or "responsibility" (a duty the role performs).
- "priority": "must-have" if the posting frames it as required/minimum/essential; "nice-to-have" if preferred/bonus/plus.
- "evidence": a VERBATIM quote from the posting, copied character-for-character, containing this requirement. This is validated by exact string matching — a quote that is paraphrased, reworded, or reconstructed WILL be rejected and the requirement discarded.

Rules:
- Extract 8-20 requirements. Prefer the ones a recruiter would actually search for.
- One concept per requirement. Do not bundle "Excel and Tableau" into one entry.
- Skip boilerplate: benefits, EEO statements, company mission, "team player", "fast-paced environment".
- Skip anything not stated in the posting. Never infer requirements from the industry.

Return ONLY a JSON object, no prose and no markdown fences:
{"requirements":[{"term":"...","variants":["..."],"category":"...","priority":"...","evidence":"..."}]}`;

/**
 * Cache identity includes the model that produced the entry.
 *
 * Extraction quality is strongly model-dependent: a weaker model emits terms
 * like "Excel proficiency" where a stronger one emits "Excel", and no resume
 * matches the former. Keying on the job description alone let a single run on
 * a weak model poison the score for every later run on every provider.
 */
function cachePathFor(jobDescription: string, modelKey: string): string {
  const hash = createHash("sha256")
    .update(EXTRACTION_VERSION + " " + modelKey + " " + normalize(jobDescription))
    .digest("hex")
    .slice(0, 32);
  return join(CACHE_DIR, hash + ".json");
}

function readCache(path: string): Requirement[] | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Requirement[];
  } catch {
    return null;
  }
}

const VALID_CATEGORIES = new Set([
  "tool",
  "skill",
  "credential",
  "responsibility",
]);

/**
 * Keep only requirements whose evidence genuinely appears in the posting.
 * Whitespace is normalized on both sides first, since a model reflowing a
 * quote across lines is a formatting artifact rather than a fabrication.
 */
export function validateRequirements(
  candidates: unknown,
  jobDescription: string
): Requirement[] {
  if (!Array.isArray(candidates)) return [];
  const haystack = normalize(jobDescription);
  const seen = new Set<string>();
  const kept: Requirement[] = [];

  for (const raw of candidates) {
    const candidate = raw as Partial<Requirement>;
    if (typeof candidate.term !== "string" || candidate.term.trim() === "") continue;
    if (typeof candidate.evidence !== "string") continue;

    const evidence = normalize(candidate.evidence);
    if (evidence.length < 8 || !haystack.includes(evidence)) {
      console.warn(
        `[requirements] Dropping "${candidate.term}" — evidence not found in the posting`
      );
      continue;
    }

    const key = normalize(candidate.term);
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push({
      term: candidate.term.trim(),
      variants: Array.isArray(candidate.variants)
        ? candidate.variants.filter((v): v is string => typeof v === "string")
        : [],
      category: VALID_CATEGORIES.has(candidate.category as string)
        ? (candidate.category as Requirement["category"])
        : "skill",
      priority:
        candidate.priority === "nice-to-have" ? "nice-to-have" : "must-have",
      evidence: candidate.evidence.trim(),
    });
  }

  return kept;
}

export async function extractRequirements(
  jobDescription: string
): Promise<Requirement[]> {
  const provider = getProvider();
  const cachePath = cachePathFor(
    jobDescription,
    provider.name + "/" + provider.model
  );
  const cached = readCache(cachePath);
  if (cached) return cached;

  const response = await provider.complete({
    system: EXTRACTION_PROMPT,
    user: `JOB DESCRIPTION:\n\n${jobDescription}`,
    maxTokens: 8192,
    // Straightforward extraction against an explicit spec — it doesn't need
    // deep deliberation, and this runs on every new posting.
    effort: "low",
    json: true,
  });

  const parsed = parseJsonResponse<{ requirements?: unknown }>(response.text);
  const requirements = validateRequirements(parsed.requirements, jobDescription);

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(requirements, null, 2));

  return requirements;
}
