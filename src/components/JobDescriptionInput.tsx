"use client";

import { useState, useEffect, useRef } from "react";
import { Link, Loader2, Sparkles } from "lucide-react";
import { extractCompany } from "@/lib/ats/company";

type Props = {
  jobDescription: string;
  onJobDescriptionChange: (value: string) => void;
  companyName: string;
  onCompanyNameChange: (value: string) => void;
};

export default function JobDescriptionInput({
  jobDescription,
  onJobDescriptionChange,
  companyName,
  onCompanyNameChange,
}: Props) {
  const [jobUrl, setJobUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [fetchWarning, setFetchWarning] = useState("");

  // Remembers what we filled in, so a value the user typed is never replaced.
  const autoFilled = useRef<string | null>(null);
  // A company published as structured data outranks anything parsed from prose.
  const fromStructuredData = useRef(false);

  // Read the employer straight out of a pasted description. It names the
  // exported file, and waiting for the model to report it would mean no
  // company until after tailoring finishes.
  useEffect(() => {
    if (!jobDescription.trim() || fromStructuredData.current) return;
    const userOwnsField =
      companyName.trim().length > 0 && companyName !== autoFilled.current;
    if (userOwnsField) return;

    const detected = extractCompany(jobDescription);
    if (detected && detected !== companyName) {
      autoFilled.current = detected;
      onCompanyNameChange(detected);
    }
  }, [jobDescription, companyName, onCompanyNameChange]);

  const handleFetchUrl = async () => {
    if (!jobUrl.trim()) return;

    setIsFetching(true);
    setFetchError("");
    setFetchWarning("");

    try {
      const response = await fetch("/api/parse-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to fetch job posting");
      }

      const data = await response.json();
      onJobDescriptionChange(data.text);

      // Postings published as structured data name their employer, which is
      // more reliable than asking the model to spot it — and it drives the
      // exported filename.
      if (data.company && !companyName.trim()) {
        autoFilled.current = data.company;
        fromStructuredData.current = true;
        onCompanyNameChange(data.company);
      }
      if (data.warning) setFetchWarning(data.warning);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch URL"
      );
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Company Name */}
      <div>
        <label
          htmlFor="company"
          className="block text-sm font-medium mb-1.5"
        >
          Company Name{" "}
          <span className="text-muted font-normal">(optional)</span>
        </label>
        <input
          id="company"
          type="text"
          value={companyName}
          onChange={(e) => {
            // Typing takes ownership of the field from either auto-fill source.
            autoFilled.current = null;
            fromStructuredData.current = false;
            onCompanyNameChange(e.target.value);
          }}
          placeholder="e.g., Google, Stripe, etc."
          className="w-full px-3 py-2 border border-border rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            placeholder:text-muted/50"
        />
        {companyName && companyName === autoFilled.current && (
          <p className="text-xs text-muted mt-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Detected from the job description — names your exported file. Edit
            if it&apos;s wrong.
          </p>
        )}
      </div>

      {/* URL Fetch */}
      <div>
        <label className="block text-sm font-medium mb-1.5">
          Job Posting URL{" "}
          <span className="text-muted font-normal">(optional)</span>
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              placeholder="https://..."
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
                placeholder:text-muted/50"
            />
          </div>
          <button
            onClick={handleFetchUrl}
            disabled={!jobUrl.trim() || isFetching}
            className="px-4 py-2 bg-accent border border-border rounded-lg text-sm font-medium
              hover:bg-border/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
              flex items-center gap-2"
          >
            {isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Fetch"
            )}
          </button>
        </div>
        {fetchError && (
          <p className="text-xs text-danger mt-1">{fetchError}</p>
        )}
        {fetchWarning && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            {fetchWarning}
          </p>
        )}
      </div>

      {/* Job Description Textarea */}
      <div>
        <label
          htmlFor="jobDesc"
          className="block text-sm font-medium mb-1.5"
        >
          Job Description
        </label>
        <textarea
          id="jobDesc"
          value={jobDescription}
          onChange={(e) => onJobDescriptionChange(e.target.value)}
          placeholder="Paste the full job description here..."
          rows={14}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-y
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            placeholder:text-muted/50 font-mono leading-relaxed"
        />
        <p className="text-xs text-muted mt-1">
          {jobDescription.length > 0
            ? `${jobDescription.length.toLocaleString()} characters`
            : "Include the full description for best results"}
        </p>
      </div>
    </div>
  );
}
