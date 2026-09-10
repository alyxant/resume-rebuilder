import { NextRequest, NextResponse } from "next/server";
import { parseDocx } from "@/lib/docx/parser";
import { extractTextRuns, groupRunsIntoSections } from "@/lib/docx/text-extractor";
import { tailorResume } from "@/lib/ai/tailor";
import { extractRequirements } from "@/lib/ats/requirements";
import { getProvider } from "@/lib/ai/provider";
import { extractCompany } from "@/lib/ats/company";
import { scoreCoverage } from "@/lib/ats/coverage";
import type { TextSection } from "@/lib/docx/types";

/** Apply a section's tailored text so coverage can be scored on the result. */
function projectTailored(
  sections: TextSection[],
  tailored: { sectionName: string; tailoredText: string }[]
): { sectionName: string; fullText: string }[] {
  const byName = new Map(tailored.map((t) => [t.sectionName, t.tailoredText]));
  return sections.map((s) => ({
    sectionName: s.sectionName,
    fullText: byName.get(s.sectionName) ?? s.fullText,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { docxBase64, jobDescription, companyName } = body;

    if (!docxBase64 || !jobDescription) {
      return NextResponse.json(
        { error: "Missing resume data or job description" },
        { status: 400 }
      );
    }

    // Re-parse the DOCX to get sections
    const buffer = Buffer.from(docxBase64, "base64");
    const archive = await parseDocx(buffer);
    const runs = extractTextRuns(archive.documentXml);
    const sections = groupRunsIntoSections(runs);

    // Tailoring and requirement extraction depend only on the inputs, so they
    // can run concurrently — but a rate-limited provider may silently degrade
    // one of a concurrent pair, and a throttled tailoring call returns an
    // empty edit list rather than an error. On those providers, correctness
    // beats the few seconds concurrency would save.
    const safeExtract = () =>
      extractRequirements(jobDescription).catch((error) => {
        // Scoring is additive; never fail a tailoring run over it.
        console.error("Requirement extraction failed:", error);
        return null;
      });

    let result;
    let requirements;
    if (getProvider().prefersSerialCalls) {
      requirements = await safeExtract();
      result = await tailorResume(sections, jobDescription, companyName);
    } else {
      [result, requirements] = await Promise.all([
        tailorResume(sections, jobDescription, companyName),
        safeExtract(),
      ]);
    }

    // Settle the hiring company here rather than in the browser, so it is
    // resolved the same way whether the description was pasted, fetched from a
    // URL, or posted directly to this route. Order is most-trustworthy first:
    // what the user typed, then a deterministic read of the posting, then the
    // model's own answer as a backstop for postings the parser can't crack.
    const resolvedCompany =
      companyName?.trim() ||
      extractCompany(jobDescription) ||
      result.jobMeta?.company?.trim() ||
      undefined;

    result.jobMeta = { ...result.jobMeta, company: resolvedCompany };
    if (resolvedCompany) {
      console.log(`[tailor] company resolved: ${resolvedCompany}`);
    } else {
      console.warn("[tailor] no company found — export will omit the suffix");
    }

    // Measure coverage deterministically. "Before" is the untouched resume;
    // "projected" assumes every proposed edit survives — the export step
    // reports the verified number once drops are known.
    if (requirements) {
      result.requirements = requirements;
      result.coverageBefore = scoreCoverage(requirements, sections);
      result.coverageProjected = scoreCoverage(
        requirements,
        projectTailored(sections, result.sections)
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailor error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to tailor resume";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
