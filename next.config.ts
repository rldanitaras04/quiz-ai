import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['pdfjs-dist', 'pdf-parse'],
  experimental: {
    serverActions: {
      // Default is 1MB, which killed avatar uploads before uploadAvatar could
      // apply its own check. The app-level cap is 2 MB (see MAX_AVATAR_BYTES);
      // this sits above it so a legal 2 MB file plus multipart overhead still
      // reaches the action, and an over-sized file comes back as our own
      // message instead of a raw framework "Body exceeded …" runtime error.
      bodySizeLimit: '3mb',
    },
  },
};

export default nextConfig;
