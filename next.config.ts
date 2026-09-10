import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse loads a pdfjs worker from disk at runtime; bundling it breaks
  // that lookup, so both must resolve from node_modules.
  serverExternalPackages: ["jszip", "pdf-parse", "pdfjs-dist"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
