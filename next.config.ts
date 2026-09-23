import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['pdfjs-dist', 'pdf-parse'],
};

export default nextConfig;
