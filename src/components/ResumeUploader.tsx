"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  FileText,
  Check,
  AlertTriangle,
  Trash2,
  ScanSearch,
} from "lucide-react";
import { BaseResumeInfo } from "@/lib/docx/types";
import type { ParseabilitySeverity } from "@/lib/ats/types";

const SEVERITY_STYLE: Record<ParseabilitySeverity, string> = {
  high: "border-red-200 bg-red-50 text-red-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-border bg-accent text-muted",
};

type Props = {
  onUpload: (data: BaseResumeInfo | null) => void;
  uploadedResume: BaseResumeInfo | null;
  isLoading: boolean;
};

function savedWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default function ResumeUploader({
  onUpload,
  uploadedResume,
  isLoading,
}: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setIsUploading(true);
      setUploadError("");

      try {
        const formData = new FormData();
        formData.append("resume", file);

        // Saving and uploading are the same action: the resume you provide
        // becomes the stored base, reloaded automatically next time.
        const response = await fetch("/api/base-resume", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Upload failed");
        }

        const { baseResume } = await response.json();
        onUpload(baseResume);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to save base resume"
        );
      } finally {
        setIsUploading(false);
      }
    },
    [onUpload]
  );

  const handleRemove = useCallback(async () => {
    setUploadError("");
    try {
      await fetch("/api/base-resume", { method: "DELETE" });
      onUpload(null);
    } catch {
      setUploadError("Failed to remove saved resume");
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/pdf": [".pdf"],
    },
    maxFiles: 1,
    multiple: false,
  });

  const busy = isUploading || isLoading;
  const blocked = uploadedResume && !uploadedResume.canRevise;

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? "border-primary bg-blue-50" : "border-border hover:border-primary/50 hover:bg-accent"}
          ${uploadedResume && !blocked ? "border-success bg-green-50" : ""}
          ${blocked ? "border-amber-400 bg-amber-50" : ""}
          ${busy ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-3">
          {busy ? (
            <>
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted">
                {isLoading ? "Loading saved resume..." : "Saving resume..."}
              </p>
            </>
          ) : uploadedResume ? (
            <>
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  blocked ? "bg-amber-100" : "bg-green-100"
                }`}
              >
                {blocked ? (
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                ) : (
                  <Check className="w-6 h-6 text-success" />
                )}
              </div>
              <div>
                <p
                  className={`font-medium ${blocked ? "text-amber-700" : "text-success"}`}
                >
                  {uploadedResume.fileName}
                </p>
                <p className="text-sm text-muted mt-1">
                  Saved {savedWhen(uploadedResume.savedAt)} ·{" "}
                  {uploadedResume.sections.length} sections · Click or drag to
                  replace.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted" />
              </div>
              <div>
                <p className="font-medium">
                  {isDragActive
                    ? "Drop your resume here"
                    : "Drag & drop your base resume"}
                </p>
                <p className="text-sm text-muted mt-1">
                  or click to browse. Saved for next time. .docx or .pdf.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {uploadError && <p className="text-sm text-danger">{uploadError}</p>}

      {blocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Saved for reference — tailoring is unavailable
          </p>
          <p className="text-sm text-amber-700">
            {uploadedResume.revisionBlockedReason}
          </p>
        </div>
      )}

      {uploadedResume?.parseability &&
        uploadedResume.parseability.findings.length > 0 && (
          <div className="bg-white border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-muted flex items-center gap-2">
              <ScanSearch className="w-4 h-4" />
              Machine readability
              {uploadedResume.parseability.blocking > 0 && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded-full">
                  {uploadedResume.parseability.blocking} blocking
                </span>
              )}
            </h3>
            <p className="text-xs text-muted">
              How well an applicant tracking system can read this file. Keywords
              don&apos;t help if the parser can&apos;t see them.
            </p>
            <div className="space-y-2">
              {uploadedResume.parseability.findings.map((finding) => (
                <div
                  key={finding.id}
                  className={`rounded-lg border px-3 py-2 ${SEVERITY_STYLE[finding.severity]}`}
                >
                  <p className="text-sm font-medium">{finding.title}</p>
                  <p className="text-xs mt-1 opacity-90">{finding.detail}</p>
                  {finding.evidence && (
                    <p className="text-xs mt-1.5 font-mono opacity-75 break-words">
                      {finding.evidence}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      {uploadedResume?.parseability &&
        uploadedResume.parseability.findings.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <p className="text-sm text-green-800 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              No structural problems found — this file should parse cleanly.
            </p>
          </div>
        )}

      {uploadedResume && (
        <div className="bg-white border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-muted flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Detected Sections
            </h3>
            <button
              onClick={handleRemove}
              className="text-xs text-muted hover:text-danger transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {uploadedResume.sections.map((section) => (
              <span
                key={section.sectionName}
                className="text-xs px-2.5 py-1 bg-accent rounded-full text-foreground"
              >
                {section.sectionName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
