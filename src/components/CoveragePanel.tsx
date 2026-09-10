"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Target, Check, X, AlertCircle } from "lucide-react";
import type { CoverageReport, CoverageStatus } from "@/lib/ats/types";

type Props = {
  before?: CoverageReport;
  /** Assumes every proposed edit survives; replaced by `verified` after export. */
  projected?: CoverageReport;
  /** Measured on the text in the downloaded PDF. */
  verified?: CoverageReport;
  droppedEdits?: number;
};

const STATUS_STYLE: Record<
  CoverageStatus,
  { label: string; chip: string; icon: typeof Check }
> = {
  covered: {
    label: "Covered",
    chip: "bg-green-100 text-green-800",
    icon: Check,
  },
  partial: {
    label: "Partial",
    chip: "bg-amber-100 text-amber-800",
    icon: AlertCircle,
  },
  missing: { label: "Missing", chip: "bg-red-100 text-red-800", icon: X },
};

// Missing first: that's the half the user can still act on.
const STATUS_ORDER: CoverageStatus[] = ["missing", "partial", "covered"];

function ScoreTile({
  label,
  report,
  delta,
  tone,
}: {
  label: string;
  report?: CoverageReport;
  delta?: number;
  tone: "muted" | "good";
}) {
  return (
    <div className="bg-white border border-border rounded-xl p-5">
      <p className="text-sm text-muted mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <span
          className={`text-3xl font-bold ${tone === "good" ? "text-success" : "text-foreground"}`}
        >
          {report ? `${report.score}%` : "—"}
        </span>
        {report && delta !== undefined && delta !== 0 && (
          <span
            className={`text-sm mb-1 ${delta > 0 ? "text-success" : "text-danger"}`}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </div>
      {report && (
        <p className="text-xs text-muted mt-1">
          {report.covered} of {report.total} requirements covered
          {report.partial > 0 ? ` · ${report.partial} partial` : ""}
        </p>
      )}
    </div>
  );
}

export default function CoveragePanel({
  before,
  projected,
  verified,
  droppedEdits = 0,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // Once the file exists, report what's in it — not what we hoped for.
  const after = verified ?? projected;
  const afterLabel = verified ? "Verified After" : "Projected After";

  if (!before && !after) return null;

  const delta =
    before && after ? Math.round(after.score - before.score) : undefined;

  const sorted = after
    ? [...after.results].sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
          (a.requirement.priority === b.requirement.priority
            ? 0
            : a.requirement.priority === "must-have"
              ? -1
              : 1)
      )
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScoreTile label="Coverage Before" report={before} tone="muted" />
        <ScoreTile
          label={afterLabel}
          report={after}
          delta={delta}
          tone="good"
        />
      </div>

      {!verified && projected && (
        <p className="text-xs text-muted">
          Projected assumes every proposed edit survives. The verified number
          appears after export, once any layout-unsafe edits are dropped.
        </p>
      )}

      {droppedEdits > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          {droppedEdits} edit{droppedEdits === 1 ? " was" : "s were"} skipped to
          protect your one-page layout — the text would have wrapped onto a new
          line.
        </div>
      )}

      {after && after.results.length > 0 && (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-5 py-3 hover:bg-accent transition-colors"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
            <Target className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">
              Requirement breakdown
            </span>
            <span className="text-xs text-muted ml-auto">
              {after.missing} missing · {after.partial} partial ·{" "}
              {after.covered} covered
            </span>
          </button>

          {expanded && (
            <div className="border-t border-border divide-y divide-border">
              {sorted.map((item, i) => {
                const style = STATUS_STYLE[item.status];
                const Icon = style.icon;
                return (
                  <div key={`${item.requirement.term}-${i}`} className="px-5 py-3">
                    <div className="flex items-start gap-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1 ${style.chip}`}
                      >
                        <Icon className="w-3 h-3" />
                        {style.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {item.requirement.term}
                          {item.requirement.priority === "must-have" && (
                            <span className="ml-2 text-xs text-danger font-normal">
                              required
                            </span>
                          )}
                        </p>
                        {item.status === "missing" ? (
                          <p className="text-xs text-muted mt-0.5">
                            Not found in your resume. Only add it if your
                            experience genuinely supports it.
                          </p>
                        ) : (
                          <p className="text-xs text-muted mt-0.5">
                            Matched{" "}
                            <span className="font-mono">
                              “{item.matchedVariant}”
                            </span>
                            {item.foundInSection && ` in ${item.foundInSection}`}
                            {item.status === "partial" &&
                              " — appears inside a longer word, which a recruiter's search may not match."}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
