import { NextRequest, NextResponse } from "next/server";

/**
 * Fetch a job posting and recover its text.
 *
 * Most major boards (Greenhouse, Lever, Workday, LinkedIn) publish a schema.org
 * JobPosting blob, which is far cleaner than scraping rendered HTML. Falling
 * back to tag-stripping is a last resort: on a JS-rendered page it can return
 * a navigation shell with no job text at all, so that case is reported rather
 * than passed downstream to be scored against silently.
 */

const JD_SIGNALS =
  /responsibilit|requirement|qualification|experience|what you.ll do|about the role/i;
const MIN_USABLE_LENGTH = 400;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // Chrome, not content — dropping these keeps nav links and cookie
      // banners out of the keyword pool.
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      // Keep block boundaries as newlines so bullet lists stay separated.
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

type JobPosting = {
  text: string;
  title?: string;
  company?: string;
};

/** Walk a JSON-LD payload, which may be a graph or an array, for a JobPosting. */
function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("JobPosting")) return record;

  if (record["@graph"]) return findJobPosting(record["@graph"]);
  return null;
}

function extractJsonLd(html: string): JobPosting | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeEntities(block[1].trim()));
    } catch {
      continue; // A malformed block shouldn't abort the search.
    }

    const posting = findJobPosting(parsed);
    if (!posting) continue;

    const description = posting["description"];
    if (typeof description !== "string" || description.trim() === "") continue;

    const org = posting["hiringOrganization"];
    const company =
      org && typeof org === "object"
        ? (org as Record<string, unknown>)["name"]
        : undefined;

    return {
      text: htmlToText(description),
      title: typeof posting["title"] === "string" ? posting["title"] : undefined,
      company: typeof company === "string" ? company : undefined,
    };
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status}` },
        { status: 400 }
      );
    }

    const html = await response.text();
    const structured = extractJsonLd(html);
    const posting: JobPosting = structured ?? { text: htmlToText(html) };
    const source = structured ? "json-ld" : "html";

    // A page that rendered its posting client-side leaves us holding chrome.
    // Say so, rather than letting the scorer grade navigation text. A JSON-LD
    // hit is a deliberate publication of the posting, so a terse one is
    // trustworthy; scraped HTML has to clear a much higher bar.
    const tooShort = posting.text.length < (structured ? 120 : MIN_USABLE_LENGTH);
    const warning =
      tooShort || !JD_SIGNALS.test(posting.text)
        ? "This page didn't yield readable job text — it may load the posting with JavaScript. Paste the description manually for accurate results."
        : undefined;

    return NextResponse.json({
      text: posting.text.slice(0, 20000),
      title: posting.title,
      company: posting.company,
      source,
      warning,
    });
  } catch (error) {
    console.error("Parse job error:", error);
    return NextResponse.json(
      { error: "Failed to fetch and parse the job posting" },
      { status: 500 }
    );
  }
}
