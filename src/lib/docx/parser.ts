import JSZip from "jszip";
import { parseStringPromise } from "xml2js";

export type DocxArchive = {
  zip: JSZip;
  rawDocumentXml: string;
  documentXml: Record<string, unknown>;
};

export async function parseDocx(buffer: Buffer): Promise<DocxArchive> {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }
  const rawDocumentXml = await documentFile.async("string");
  const documentXml = await parseStringPromise(rawDocumentXml, {
    explicitArray: true,
    preserveChildrenOrder: true,
    xmlns: false,
  });
  return { zip, documentXml, rawDocumentXml };
}

/**
 * Assemble the final DOCX by doing direct string replacements on the raw XML.
 * This avoids xml2js Builder which corrupts namespace declarations,
 * attribute ordering, and self-closing tags.
 */
export async function assembleDocx(
  archive: DocxArchive,
  textReplacements: Map<string, string>
): Promise<Buffer> {
  let xml = archive.rawDocumentXml;

  for (const [original, replacement] of textReplacements) {
    // Escape for XML text content
    const escapedReplacement = escapeXml(replacement);
    // Replace the exact original text within <w:t> elements
    xml = replaceTextInXml(xml, original, escapedReplacement);
  }

  archive.zip.file("word/document.xml", xml);
  const output = await archive.zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return output;
}

/**
 * Find a text string that may be spread across one or more <w:t> elements
 * within the same paragraph, and replace it. We work at the paragraph level
 * to handle text split across multiple runs.
 */
function replaceTextInXml(
  xml: string,
  searchText: string,
  replacementText: string
): string {
  // Strategy: find each <w:p ...>...</w:p> paragraph block,
  // extract all its <w:t> text, check if searchText appears,
  // and if so, do a targeted replacement within the run structure.

  const paragraphRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let result = xml;
  let match;

  // Collect all paragraphs and their positions
  const paragraphs: { text: string; start: number; end: number }[] = [];
  while ((match = paragraphRegex.exec(xml)) !== null) {
    paragraphs.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Process paragraphs in reverse order so positions don't shift
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i];
    const plainText = extractPlainTextFromParagraph(para.text);
    if (!plainText.includes(searchText)) continue;

    // Do the replacement within this paragraph's runs
    const newPara = replacePlainTextInParagraph(
      para.text,
      searchText,
      replacementText
    );
    if (newPara !== para.text) {
      result =
        result.slice(0, para.start) + newPara + result.slice(para.end);
      break; // Only replace first occurrence to avoid over-replacement
    }
  }

  return result;
}

/**
 * Extract all plain text from a paragraph XML string by pulling <w:t> contents.
 */
function extractPlainTextFromParagraph(paraXml: string): string {
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let text = "";
  let m;
  while ((m = textRegex.exec(paraXml)) !== null) {
    text += m[1];
  }
  return unescapeXml(text);
}

/**
 * Replace searchText within a paragraph's <w:t> elements.
 * If the text is in a single <w:t>, replace directly.
 * If split across runs, put the replacement in the first matching run
 * and empty subsequent runs that were part of the match.
 */
function replacePlainTextInParagraph(
  paraXml: string,
  searchText: string,
  replacementText: string
): string {
  // Collect all <w:t> positions and their text
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  const textNodes: {
    fullMatch: string;
    content: string;
    start: number;
    end: number;
  }[] = [];
  let m;
  while ((m = textRegex.exec(paraXml)) !== null) {
    textNodes.push({
      fullMatch: m[0],
      content: unescapeXml(m[1]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Check if searchText lives entirely in one <w:t>
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    if (node.content.includes(searchText)) {
      const newContent = node.content.replace(searchText, replacementText);
      const newTag = buildWtTag(newContent);
      return (
        paraXml.slice(0, node.start) + newTag + paraXml.slice(node.end)
      );
    }
  }

  // Text might be split across multiple <w:t> runs — concatenate and find
  let accumulated = "";
  for (let startIdx = 0; startIdx < textNodes.length; startIdx++) {
    accumulated = "";
    for (let endIdx = startIdx; endIdx < textNodes.length; endIdx++) {
      accumulated += textNodes[endIdx].content;
      if (accumulated.includes(searchText)) {
        // Found it across runs startIdx..endIdx
        // Put replacement in first run, empty the rest
        let result = paraXml;
        // Process in reverse to maintain positions
        for (let j = endIdx; j >= startIdx; j--) {
          const node = textNodes[j];
          let newContent: string;
          if (j === startIdx) {
            // First run: rebuild with replaced text
            const before = textNodes
              .slice(startIdx, endIdx + 1)
              .map((n) => n.content)
              .join("");
            newContent = before.replace(searchText, replacementText);
          } else {
            // Subsequent runs: empty them
            newContent = "";
          }
          const newTag = buildWtTag(newContent);
          result =
            result.slice(0, node.start) + newTag + result.slice(node.end);
        }
        return result;
      }
    }
  }

  return paraXml;
}

function buildWtTag(content: string): string {
  const escaped = escapeXml(content);
  if (
    content.startsWith(" ") ||
    content.endsWith(" ") ||
    content.includes("  ")
  ) {
    return `<w:t xml:space="preserve">${escaped}</w:t>`;
  }
  return `<w:t>${escaped}</w:t>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
