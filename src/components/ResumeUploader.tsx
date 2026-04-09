"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Check } from "lucide-react";

type UploadedResume = {
  sections: { sectionName: string; fullText: string; runCount: number }[];
  docxBase64: string;
  fileName: string;
};

type Props = {
  onUpload: (data: UploadedResume) => void;
  uploadedResume: UploadedResume | null;
};

export default function ResumeUploader({ onUpload, uploadedResume }: Props) {
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

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Upload failed");
        }

        const data = await response.json();
        onUpload(data);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload resume"
        );
      } finally {
        setIsUploading(false);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
    },
    maxFiles: 1,
    multiple: false,
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? "border-primary bg-blue-50" : "border-border hover:border-primary/50 hover:bg-accent"}
          ${uploadedResume ? "border-success bg-green-50" : ""}
          ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-3">
          {uploadedResume ? (
            <>
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="font-medium text-success">
                  {uploadedResume.fileName}
                </p>
                <p className="text-sm text-muted mt-1">
                  {uploadedResume.sections.length} sections detected. Click or
                  drag to replace.
                </p>
              </div>
            </>
          ) : isUploading ? (
            <>
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted">Parsing resume...</p>
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
                    : "Drag & drop your resume"}
                </p>
                <p className="text-sm text-muted mt-1">
                  or click to browse. Accepts .docx files only.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {uploadError && (
        <p className="text-sm text-danger">{uploadError}</p>
      )}

      {/* Section Preview */}
      {uploadedResume && (
        <div className="bg-white border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-muted mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Detected Sections
          </h3>
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
