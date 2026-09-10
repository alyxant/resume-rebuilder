"use client";

import { useState, useEffect } from "react";
import ResumeUploader from "@/components/ResumeUploader";
import JobDescriptionInput from "@/components/JobDescriptionInput";
import TailorView from "@/components/TailorView";
import { TailorResult, BaseResumeInfo } from "@/lib/docx/types";
import type { ExportReport } from "@/lib/ats/types";
import { buildExportFilename } from "@/lib/export/filename";

type AppStep = "upload" | "tailoring" | "review";

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [resume, setResume] = useState<BaseResumeInfo | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingBase, setIsLoadingBase] = useState(true);
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);

  // Reload the saved base resume so it never has to be re-uploaded.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/base-resume");
        if (!response.ok) return;
        const { baseResume } = await response.json();
        if (!cancelled && baseResume) setResume(baseResume);
      } catch {
        // No saved resume is a normal first-run state, not an error.
      } finally {
        if (!cancelled) setIsLoadingBase(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = (data: BaseResumeInfo | null) => {
    setResume(data);
    setError("");
  };

  const handleTailor = async () => {
    if (!resume || !jobDescription.trim()) {
      setError("Please upload a resume and provide a job description.");
      return;
    }

    if (!resume.canRevise || !resume.docxBase64) {
      setError(
        resume.revisionBlockedReason ??
          "This resume cannot be revised without altering its formatting."
      );
      return;
    }

    setIsProcessing(true);
    setError("");
    setExportReport(null);
    setStep("tailoring");

    try {
      const response = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docxBase64: resume.docxBase64,
          jobDescription,
          companyName: companyName || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to tailor resume");
      }

      const result: TailorResult = await response.json();
      setTailorResult(result);

      // Show whatever the server settled on, so the company naming the export
      // is visible and correctable rather than decided invisibly.
      const detected = result.jobMeta?.company?.trim();
      if (detected && !companyName.trim()) setCompanyName(detected);

      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async (acceptedSections: TailorResult["sections"]) => {
    if (!resume?.docxBase64) return;

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docxBase64: resume.docxBase64,
          tailoredSections: acceptedSections,
          // Lets the server score coverage against the exported text.
          jobDescription,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to export resume");
      }

      const { pdfBase64, report } = (await response.json()) as {
        pdfBase64: string;
        report: ExportReport;
      };
      setExportReport(report);

      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const resolvedCompany =
        companyName.trim() || tailorResult?.jobMeta?.company || "";
      a.download = buildExportFilename(resume.fileName, resolvedCompany);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  // Clears the job, not the resume — the saved base resume persists across
  // applications and is removed explicitly from the uploader.
  const handleStartOver = () => {
    setStep("upload");
    setJobDescription("");
    setCompanyName("");
    setTailorResult(null);
    setExportReport(null);
    setError("");
  };

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Resume Rebuilder
            </h1>
            <p className="text-sm text-muted">
              AI-powered resume tailoring for ATS optimization
            </p>
          </div>
          {step !== "upload" && (
            <button
              onClick={handleStartOver}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3">
          <div className="max-w-6xl mx-auto text-sm text-danger">{error}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {step === "upload" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Resume Upload */}
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Your Resume</h2>
                <p className="text-sm text-muted">
                  Saved and reloaded automatically. .docx keeps your formatting
                  intact through tailoring.
                </p>
              </div>
              <ResumeUploader
                onUpload={handleUpload}
                uploadedResume={resume}
                isLoading={isLoadingBase}
              />
            </div>

            {/* Right: Job Description */}
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Job Description</h2>
                <p className="text-sm text-muted">
                  Paste the job description or provide a URL
                </p>
              </div>
              <JobDescriptionInput
                jobDescription={jobDescription}
                onJobDescriptionChange={setJobDescription}
                companyName={companyName}
                onCompanyNameChange={setCompanyName}
              />
            </div>

            {/* Tailor Button */}
            <div className="lg:col-span-2 flex justify-center pt-4">
              <button
                onClick={handleTailor}
                disabled={
                  !resume?.canRevise || !jobDescription.trim() || isProcessing
                }
                className="px-8 py-3 bg-primary text-white rounded-lg font-medium
                  hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors text-lg"
              >
                Tailor My Resume
              </button>
            </div>
          </div>
        )}

        {step === "tailoring" && (
          <div className="flex flex-col items-center justify-center py-24 space-y-6">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Tailoring your resume...</p>
              <p className="text-sm text-muted">
                Analyzing job requirements and optimizing for ATS keywords
              </p>
            </div>
          </div>
        )}

        {step === "review" && tailorResult && (
          <TailorView
            result={tailorResult}
            exportReport={exportReport}
            onExport={handleExport}
            onStartOver={handleStartOver}
          />
        )}
      </div>
    </main>
  );
}
