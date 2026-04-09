"use client";

import { useState } from "react";
import { TailorResult, TailoredSection } from "@/lib/docx/types";
import {
  Check,
  X,
  Download,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Target,
} from "lucide-react";

type Props = {
  result: TailorResult;
  onExport: (sections: TailoredSection[]) => void;
  onStartOver: () => void;
};

export default function TailorView({ result, onExport, onStartOver }: Props) {
  // Track which sections are accepted (all accepted by default)
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    result.sections.forEach((s) => {
      initial[s.sectionName] = true;
    });
    return initial;
  });

  // Track which sections are expanded
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    result.sections.forEach((s) => {
      initial[s.sectionName] = s.changes.length > 0;
    });
    return initial;
  });

  const [isExporting, setIsExporting] = useState(false);

  const toggleAccepted = (sectionName: string) => {
    setAccepted((prev) => ({ ...prev, [sectionName]: !prev[sectionName] }));
  };

  const toggleExpanded = (sectionName: string) => {
    setExpanded((prev) => ({ ...prev, [sectionName]: !prev[sectionName] }));
  };

  const handleExport = async () => {
    setIsExporting(true);
    const acceptedSections = result.sections.map((s) => ({
      ...s,
      // If rejected, use original text
      tailoredText: accepted[s.sectionName] ? s.tailoredText : s.originalText,
    }));
    await onExport(acceptedSections);
    setIsExporting(false);
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;
  const totalChanges = result.sections.reduce(
    (sum, s) => sum + s.changes.length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header with ATS Score */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ATS Score Before */}
        <div className="bg-white border border-border rounded-xl p-5">
          <p className="text-sm text-muted mb-1">ATS Score Before</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-danger">
              {result.atsScore.before}%
            </span>
          </div>
        </div>

        {/* ATS Score After */}
        <div className="bg-white border border-border rounded-xl p-5">
          <p className="text-sm text-muted mb-1">ATS Score After</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-success">
              {result.atsScore.after}%
            </span>
            <span className="text-sm text-success mb-1">
              +{result.atsScore.after - result.atsScore.before}
            </span>
          </div>
        </div>

        {/* Changes Summary */}
        <div className="bg-white border border-border rounded-xl p-5">
          <p className="text-sm text-muted mb-1">Changes</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold">{totalChanges}</span>
            <span className="text-sm text-muted mb-1">
              across {result.sections.length} sections
            </span>
          </div>
        </div>
      </div>

      {/* Keywords */}
      <div className="bg-white border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Keyword Analysis</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted mb-2 uppercase tracking-wide">
              Matched Keywords
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.atsScore.matchedKeywords.map((kw) => (
                <span
                  key={kw}
                  className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted mb-2 uppercase tracking-wide">
              Still Missing
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.atsScore.missingKeywords.length > 0 ? (
                result.atsScore.missingKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded-full"
                  >
                    {kw}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted">
                  All key terms covered!
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section-by-Section Changes */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
          Section Changes ({acceptedCount}/{result.sections.length} accepted)
        </h3>

        {result.sections.map((section) => {
          const hasChanges = section.changes.length > 0;
          const isAccepted = accepted[section.sectionName];
          const isExpanded = expanded[section.sectionName];

          return (
            <div
              key={section.sectionName}
              className={`bg-white border rounded-xl overflow-hidden transition-colors
                ${isAccepted ? "border-success/30" : "border-border"}`}
            >
              {/* Section Header */}
              <div className="flex items-center px-4 py-3 gap-3">
                <button
                  onClick={() => toggleExpanded(section.sectionName)}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {section.sectionName}
                    </span>
                    {hasChanges ? (
                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                        {section.changes.length} change
                        {section.changes.length !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-muted rounded-full">
                        No changes
                      </span>
                    )}
                    {section.addedKeywords.length > 0 && (
                      <span className="text-xs text-success">
                        +{section.addedKeywords.length} keywords
                      </span>
                    )}
                  </div>
                </div>

                {hasChanges && (
                  <button
                    onClick={() => toggleAccepted(section.sectionName)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                      ${
                        isAccepted
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-gray-100 text-muted hover:bg-gray-200"
                      }`}
                  >
                    {isAccepted ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Accepted
                      </>
                    ) : (
                      <>
                        <X className="w-3.5 h-3.5" /> Rejected
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Section Details */}
              {isExpanded && hasChanges && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {section.changes.map((change, i) => (
                    <div key={i} className="text-sm space-y-1">
                      <div className="flex gap-2">
                        <span className="text-danger font-mono text-xs mt-0.5 shrink-0">
                          -
                        </span>
                        <span className="text-danger/80 line-through">
                          {change.original}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-success font-mono text-xs mt-0.5 shrink-0">
                          +
                        </span>
                        <span className="text-success/80">
                          {change.replacement}
                        </span>
                      </div>
                      <p className="text-xs text-muted pl-4 italic">
                        {change.reason}
                      </p>
                    </div>
                  ))}

                  {section.addedKeywords.length > 0 && (
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-xs text-muted mb-1">
                        Added keywords:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {section.addedKeywords.map((kw) => (
                          <span
                            key={kw}
                            className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={onStartOver}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Start Over
        </button>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg font-medium
            hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {isExporting ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Download Tailored Resume
        </button>
      </div>
    </div>
  );
}
