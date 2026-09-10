/**
 * Recover the hiring company from raw job-description text.
 *
 * Postings fetched by URL usually carry the employer in structured data, but a
 * pasted description has nothing but prose. Company names are heavily repeated
 * in that prose and almost always appear at least once beside a legal suffix,
 * which together make a reliable enough signal to name the exported file
 * without waiting on — or paying for — a model call.
 */

const LEGAL_SUFFIX =
  "(?:Inc|Incorporated|LLC|L\\.L\\.C|PLC|Ltd|Limited|Corp|Corporation|Co|GmbH|N\\.V|S\\.A|AB|AG|Pty|LP|LLP)";

/** A capitalized name token: "D.R.", "Horton", "O'Neil", "AT&T", "3M". */
const TOKEN = "[A-Z0-9][A-Za-z0-9.&'’-]*";

/**
 * Separator between tokens of one name. Deliberately not `\s`, which spans
 * newlines and would happily splice a heading onto the name below it
 * ("2603803\n\nDescription\n\nD.R. Horton").
 */
const SEP = "[ \\t]+";

/** Words that look like a company beside a suffix but identify nothing. */
const GENERIC = new Set([
  "the",
  "a",
  "an",
  "our",
  "this",
  "that",
  "we",
  "us",
  "it",
  "and",
  "or",
  "for",
  "with",
  "at",
  "by",
  "to",
  "in",
  "of",
  "please",
  "about",
  "join",
  "company",
  "employer",
  "client",
  "organization",
  "team",
  "group",
  "position",
  "role",
  "job",
  "description",
  "qualifications",
  "responsibilities",
  "benefits",
  "requirements",
  "summary",
  "overview",
  // A legal suffix on its own names nobody. "D.R. Horton, Inc. is currently
  // looking for…" otherwise offers "Inc." as the candidate, because the comma
  // cuts the real name off from the phrase that follows.
  "inc",
  "incorporated",
  "llc",
  "plc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "lp",
  "llp",
  "ab",
  "ag",
  "pty",
  "nv",
  "sa",
]);

/**
 * Words that mark a phrase as a job title, section heading, or location rather
 * than an employer. These repeat as often as a company name does, so frequency
 * alone can't tell them apart.
 */
const TITLE_WORDS =
  /\b(analyst|manager|engineer|specialist|coordinator|director|associate|intern|assistant|representative|supervisor|technician|developer|designer|consultant|officer|lead|senior|junior|full|part|time|apply|remote|hybrid|onsite|location|locations|salary|posted|share|save|search|jobs?|careers?|home|sign|skip|main|content)\b/i;

function isGeneric(name: string): boolean {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 || words.every((w) => GENERIC.has(w));
}

/** Drop a leading article so "The Home Depot" and "Home Depot" agree. */
function trimArticle(name: string): string {
  return name.replace(/^(?:the|a|an)\s+/i, "").trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * How often a candidate is referred to anywhere in the posting.
 *
 * Whole-word only: a plain substring scan counts "inc" inside "including",
 * "increase", and "principally", which is enough noise to outrank the real
 * employer.
 */
function mentionCount(text: string, candidate: string): number {
  const needle = normalize(candidate);
  if (!needle) return 0;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g");
  return (normalize(text).match(pattern) ?? []).length;
}

type Candidate = { name: string; score: number };

function addCandidate(
  into: Map<string, Candidate>,
  rawName: string,
  weight: number,
  text: string
): void {
  const name = trimArticle(rawName.replace(/[,\s]+$/, "").trim());
  if (name.length < 2 || isGeneric(name)) return;
  // A single bare token is only credible if the posting repeats it.
  const mentions = mentionCount(text, name);
  if (mentions === 0) return;

  const key = normalize(name);
  const score = weight + mentions;
  const existing = into.get(key);
  if (!existing || score > existing.score) {
    into.set(key, { name, score: Math.max(score, existing?.score ?? 0) });
  }
}

export function extractCompany(text: string): string | null {
  if (!text || text.trim().length < 40) return null;

  // Only the opening of a posting reliably introduces the employer; later
  // mentions are boilerplate ("...serve customers and increase the goodwill
  // and profit of the company").
  const opening = text.slice(0, 1500);
  const candidates = new Map<string, Candidate>();

  // Strongest signal: a name sitting beside a legal suffix.
  const legal = new RegExp(
    `\\b((?:${TOKEN}${SEP}){0,3}${TOKEN}),?${SEP}${LEGAL_SUFFIX}\\b\\.?`,
    "g"
  );
  for (const match of text.matchAll(legal)) {
    addCandidate(candidates, match[1], 6, text);
  }

  // "<Company> is currently looking for…", "<Company> is hiring…"
  const hiring = new RegExp(
    `\\b((?:${TOKEN}${SEP}){0,3}${TOKEN})${SEP}is${SEP}(?:currently${SEP})?(?:looking|seeking|hiring|searching)`,
    "g"
  );
  for (const match of opening.matchAll(hiring)) {
    addCandidate(candidates, match[1], 5, text);
  }

  // "Join <Company>", "About <Company>", "Careers at <Company>". The lead-in
  // is spelled with explicit case classes rather than the /i flag, which would
  // also make TOKEN's leading [A-Z] match lowercase and swallow whole phrases
  // ("join a fast-paced team" → "a fast-paced team").
  const intro = new RegExp(
    `\\b(?:[Jj]oin|[Aa]bout|[Cc]areers?${SEP}at|[Ww]elcome${SEP}to)${SEP}((?:${TOKEN}${SEP}){0,3}${TOKEN})`,
    "g"
  );
  for (const match of opening.matchAll(intro)) {
    addCandidate(candidates, match[1], 3, text);
  }

  // Last resort: many postings introduce the employer with no legal suffix and
  // no hiring verb ("Stripe is a financial infrastructure platform"). What the
  // employer *does* have is repetition — it recurs through the posting while a
  // job title or location generally does not.
  if (candidates.size === 0) {
    // Subject position is the discriminator. An employer is what a sentence is
    // *about* — "Stripe is a financial infrastructure platform" — whereas a
    // section heading or requirement only ever appears as an object
    // ("Experience with Python"). Frequency alone matched both.
    const subject = new RegExp(
      `\\b((?:${TOKEN}${SEP}){0,2}${TOKEN})${SEP}(?:is|was|has|offers|provides|operates|serves|employs|delivers)\\b`,
      "g"
    );
    for (const match of opening.matchAll(subject)) {
      const name = match[1];
      if (isGeneric(trimArticle(name))) continue;
      if (TITLE_WORDS.test(name)) continue;
      // A job board labels its location field; anything sitting behind that
      // label is a place, not the employer.
      if (new RegExp(`locations?\\s+${name}`, "i").test(text)) continue;
      // Three sightings distinguishes an employer from a capitalized noun that
      // happens to appear twice.
      if (mentionCount(text, name) >= 3) {
        addCandidate(candidates, name, 2, text);
      }
    }
  }

  if (candidates.size === 0) return null;

  const best = [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.name.length - b.name.length
  )[0];

  return best.score >= 4 ? best.name : null;
}
