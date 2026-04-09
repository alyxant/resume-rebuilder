import { getAnthropicClient } from "./client";
import { SYSTEM_PROMPT, buildTailorPrompt } from "./prompts";
import { TextSection, TailorResult } from "../docx/types";

export async function tailorResume(
  sections: TextSection[],
  jobDescription: string,
  companyName?: string
): Promise<TailorResult> {
  const client = getAnthropicClient();
  const userPrompt = buildTailorPrompt(sections, jobDescription, companyName);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Extract JSON from the response (handle markdown code blocks)
  let jsonStr = textBlock.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  const result = JSON.parse(jsonStr.trim()) as TailorResult;

  // Validate structure
  if (!result.sections || !Array.isArray(result.sections)) {
    throw new Error("Invalid response structure: missing sections array");
  }
  if (!result.atsScore) {
    throw new Error("Invalid response structure: missing atsScore");
  }

  return result;
}
