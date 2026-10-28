import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A 10 MB DOCX becomes roughly 13.4 MB after base64 encoding and is posted
  // back to the tailoring/export routes. Proxy otherwise buffers only 10 MB.
  experimental: {
    proxyClientMaxBodySize: "20mb",
  },
  // pdf-parse loads a pdfjs worker from disk at runtime; bundling it breaks
  // that lookup, so both must resolve from node_modules.
  serverExternalPackages: ["jszip", "pdf-parse", "pdfjs-dist"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
