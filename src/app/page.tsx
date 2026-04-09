"use client";

import { useState } from "react";
import ResumeUploader from "@/components/ResumeUploader";
import JobDescriptionInput from "@/components/JobDescriptionInput";
import TailorView from "@/components/TailorView";
import { TailorResult } from "@/lib/docx/types";

type UploadedResume = {
  sections: { sectionName: string; fullText: string; runCount: number }[];
  docxBase64: string;
  fileName: string;
};

type AppStep = "upload" | "tailoring" | "review";

const FILLER_WORDS = new Set(["the", "a", "an", "of", "and", "&", "inc", "inc.", "llc", "co", "co.", "corp", "corp.", "ltd", "ltd.", "group", "holdings"]);

function abbreviateCompany(name: string): string {
  const words = name.split(/\s+/).filter((w) => !FILLER_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return name.slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  // Take first letter of each significant word
  return words.map((w) => w[0].toUpperCase()).join("");
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [resume, setResume] = useState<UploadedResume | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpload = (data: UploadedResume) => {
    setResume(data);
    setError("");
  };

  const handleTailor = async () => {
    if (!resume || !jobDescription.trim()) {
      setError("Please upload a resume and provide a job description.");
      return;
    }

    setIsProcessing(true);
    setError("");
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
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async (acceptedSections: TailorResult["sections"]) => {
    if (!resume) return;

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docxBase64: resume.docxBase64,
          tailoredSections: acceptedSections,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to export resume");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = resume.fileName.replace(/\.docx$/i, "");
      const abbrev = companyName.trim()
        ? abbreviateCompany(companyName.trim())
        : "TL";
      a.download = `${baseName} ${abbrev}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const handleStartOver = () => {
    setStep("upload");
    setResume(null);
    setJobDescription("");
    setCompanyName("");
    setTailorResult(null);
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
                  Upload your base resume in .docx format
                </p>
              </div>
              <ResumeUploader onUpload={handleUpload} uploadedResume={resume} />
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
                disabled={!resume || !jobDescription.trim() || isProcessing}
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
            onExport={handleExport}
            onStartOver={handleStartOver}
          />
        )}
      </div>
    </main>
  );
}
