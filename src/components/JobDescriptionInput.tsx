"use client";

import { useState } from "react";
import { Link, Loader2 } from "lucide-react";

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

  const handleFetchUrl = async () => {
    if (!jobUrl.trim()) return;

    setIsFetching(true);
    setFetchError("");

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
          onChange={(e) => onCompanyNameChange(e.target.value)}
          placeholder="e.g., Google, Stripe, etc."
          className="w-full px-3 py-2 border border-border rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            placeholder:text-muted/50"
        />
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
