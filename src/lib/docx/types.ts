export type TextRun = {
  id: string;
  paragraphIndex: number;
  runIndex: number;
  text: string;
  sectionHint: string;
};

export type TextSection = {
  sectionName: string;
  runs: TextRun[];
  fullText: string;
};

export type ParsedDocx = {
  sections: TextSection[];
  allRuns: TextRun[];
  rawXml: string;
};

export type TailorChange = {
  original: string;
  replacement: string;
  reason: string;
};

export type TailoredSection = {
  sectionName: string;
  originalText: string;
  tailoredText: string;
  changes: TailorChange[];
  addedKeywords: string[];
};

export type ATSScore = {
  before: number;
  after: number;
  matchedKeywords: string[];
  missingKeywords: string[];
};

export type TailorResult = {
  sections: TailoredSection[];
  atsScore: ATSScore;
};
