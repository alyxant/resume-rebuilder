import { getProvider } from "./provider";
import { SYSTEM_PROMPT, buildTailorPrompt } from "./prompts";
import { parseJsonResponse } from "./json";
import type {
  TextSection,
  TailorResult,
  TailoredSection,
  TailorChange,
  ATSScore,
  JobMeta,
} from "../docx/types";

/** What the model returns: only the lines it wants to change. */
type RawChange = TailorChange & {
  sectionName?: string;
  addedKeywords?: string[];
};

type RawResponse = {
  changes?: RawChange[];
  atsScore?: Partial<ATSScore>;
  jobMeta?: JobMeta;
};

/**
 * Rebuild full sections from the resume we parsed plus the edits the model
 * proposed.
 *
 * The model is deliberately not asked to echo the resume back. Transcribing
 * every section verbatim cost the bulk of the response — and generation time —
 * to restate text the server already holds. Reconstructing here is faster and
 * strictly more accurate: originalText comes from the actual document rather
 * than from a model retyping it, so a section can never drift from its source.
 */
function reconstructSections(
  sections: TextSection[],
  changes: RawChange[]
): TailoredSection[] {
  const bySection = new Map<string, RawChange[]>();
  for (const change of changes) {
    const key = change.sectionName ?? "";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(change);
  }

  return sections.map((section) => {
    const originalText = section.fullText;
    const proposed = bySection.get(section.sectionName) ?? [];

    const accepted: TailorChange[] = [];
    const addedKeywords = new Set<string>();
    let tailoredText = originalText;

    for (const change of proposed) {
      if (!change.original || !change.replacement) continue;
      if (change.original === change.replacement) continue;

      // Must be locatable by exact find-and-replace in the real section text.
      if (!tailoredText.includes(change.original)) {
        console.warn(
          `[tailor] Dropping change: original not found in "${section.sectionName}": "${change.original.slice(0, 60)}..."`
        );
        continue;
      }

      // Same length budget the export route enforces (prompt asks for ±10%).
      const maxLength = Math.ceil(change.original.length * 1.25) + 10;
      if (change.replacement.length > maxLength) {
        console.warn(
          `[tailor] Dropping change: replacement too long (${change.replacement.length} > ${maxLength}) in "${section.sectionName}"`
        );
        continue;
      }

      tailoredText = tailoredText.replace(change.original, change.replacement);
      accepted.push({
        original: change.original,
        replacement: change.replacement,
        reason: change.reason,
      });
      for (const keyword of change.addedKeywords ?? []) addedKeywords.add(keyword);
    }

    return {
      sectionName: section.sectionName,
      originalText,
      tailoredText,
      changes: accepted,
      addedKeywords: [...addedKeywords],
    };
  });
}

export async function tailorResume(
  sections: TextSection[],
  jobDescription: string,
  companyName?: string
): Promise<TailorResult> {
  const provider = getProvider();
  const userPrompt = buildTailorPrompt(sections, jobDescription, companyName);

  const startedAt = Date.now();
  const response = await provider.complete({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 16000,
    // Latency tracks output tokens almost exactly, and reasoning tokens were
    // most of the wait. SYSTEM_PROMPT already specifies this task tightly;
    // measured against it, low effort is ~2x faster than medium and lands
    // *more* JD keywords, because extra deliberation mostly second-guesses
    // rules the prompt already states.
    effort: "low",
    json: true,
  });

  console.log(
    `[tailor] ${Date.now() - startedAt}ms · ${provider.name}/${response.servedBy ?? provider.model} · ` +
      `in ${response.inputTokens ?? "?"} tok · out ${response.outputTokens ?? "?"} tok`
  );

  const raw = parseJsonResponse<RawResponse>(response.text);
  if (!Array.isArray(raw.changes)) {
    throw new Error("Invalid response structure: missing changes array");
  }

  return {
    sections: reconstructSections(sections, raw.changes),
    // Advisory only — coverage is computed from the exported text.
    atsScore: {
      matchedKeywords: raw.atsScore?.matchedKeywords ?? [],
      missingKeywords: raw.atsScore?.missingKeywords ?? [],
    },
    jobMeta: raw.jobMeta,
  };
}
