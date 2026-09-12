import { NextResponse } from "next/server";
import {
  loadBaseResume,
  loadBaseResumeSummary,
} from "@/lib/base-resume/store";

/**
 * Fast startup path. It deliberately avoids importing DOCX and PDF parsers,
 * which are expensive for the development server to compile on a cold start.
 */
export async function GET() {
  if (!loadBaseResume()) {
    return NextResponse.json({ baseResume: null, needsAnalysis: false });
  }

  const baseResume = loadBaseResumeSummary();
  return NextResponse.json({
    baseResume,
    needsAnalysis: baseResume === null,
  });
}
