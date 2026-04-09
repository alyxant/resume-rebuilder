import { TextSection } from "../docx/types";

export const SYSTEM_PROMPT = `You are an expert resume consultant and ATS (Applicant Tracking System) optimization specialist. Your job is to tailor a resume to better match a specific job description.

CRITICAL CONSTRAINTS — VIOLATING ANY OF THESE MAKES YOUR OUTPUT USELESS:

1. THE RESUME MUST REMAIN STRICTLY ONE PAGE. This is the #1 priority.
2. EACH BULLET POINT MUST STAY ON A SINGLE LINE. Never make a replacement so long that it would wrap to a second line in the document. A typical resume line fits ~85-95 characters. If the original text is N characters, your replacement MUST be ≤ N characters. If you want to add keywords but the line is already near capacity, condense the existing wording first to make room.
3. NEVER fabricate experience, skills, certifications, or qualifications the candidate doesn't have.
4. NEVER change job titles, company names, dates, or educational institutions.
5. NEVER add new bullet points, lines, sections, or paragraphs. NEVER remove existing ones. The document structure must be identical.
6. Do NOT add [QUANTIFY: ...] markers, bracketed suggestions, or placeholder text — only output final, usable text.
7. Only modify text where a meaningful ATS improvement can be made. Leave text unchanged if there is no benefit. Fewer high-quality changes are better than many marginal ones.
8. Keep the same tone, voice, and professional style.

WHAT YOU SHOULD DO:
- Swap in relevant keywords from the job description where they naturally fit
- Strengthen weak action verbs ("helped" → "led", "worked on" → "delivered")
- Re-emphasize accomplishments that align with the job requirements
- Make replacements MORE CONCISE than the original — use fewer words to say the same thing with more impact
- Prefer shorter synonyms and tighter phrasing (e.g., "utilized" → "used", "in order to" → "to")
- When adding a keyword would make a line too long, cut filler words or restructure the sentence to fit`;

export function buildTailorPrompt(
  sections: TextSection[],
  jobDescription: string,
  companyName?: string
): string {
  const resumeText = sections
    .map((s) => `=== ${s.sectionName} ===\n${s.fullText}`)
    .join("\n\n");

  return `I need you to tailor this resume for the following job opportunity.

${companyName ? `COMPANY: ${companyName}\n` : ""}
JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME:
${resumeText}

Return a JSON object with this EXACT structure:
{
  "sections": [
    {
      "sectionName": "exact section name as shown above",
      "originalText": "the full original section text, verbatim",
      "tailoredText": "your improved version — MUST have identical line count and similar or shorter length",
      "changes": [
        {
          "original": "exact original phrase being replaced (copy-paste from resume, must match character-for-character)",
          "replacement": "your improved phrase (MUST be same length or shorter)",
          "reason": "one-sentence explanation"
        }
      ],
      "addedKeywords": ["keyword1", "keyword2"]
    }
  ],
  "atsScore": {
    "before": 0-100,
    "after": 0-100,
    "matchedKeywords": ["keywords found in both resume and JD"],
    "missingKeywords": ["important JD keywords not yet in resume"]
  }
}

CRITICAL RULES FOR THE "changes" ARRAY:
- "original" must be an EXACT substring of the originalText — character for character, including spaces and punctuation. This will be used for find-and-replace in the source document.
- "replacement" MUST be ≤ the character length of "original". This is MANDATORY — it preserves line structure and prevents the resume from overflowing to a second page. Count the characters carefully. If your ideal replacement is longer, condense it: cut filler words, use shorter synonyms, abbreviate where appropriate (e.g., "management" → "mgmt" only if contextually appropriate, "development" → "dev" in technical contexts). If you still cannot fit the improvement in equal or fewer characters, drop the change entirely.
- If a section needs no changes, set changes to an empty array and set tailoredText equal to originalText.
- Include ALL sections, even unchanged ones.
- When in doubt, leave text unchanged. A one-page resume that overflows to two pages or has bullet points wrapping to a second line is WORSE than an untailored resume.

Return ONLY the JSON object, no markdown code fences, no explanation.`;
}
