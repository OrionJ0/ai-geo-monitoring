import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    AI_GEO_BUILD_REVISION: process.env.AI_GEO_BUILD_REVISION || '',
  },
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    proxyTimeout: 610_000,
  },
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    const API_BASE_URL = (
      process.env.API_BASE_URL || 'http://127.0.0.1:3002'
    ).replace(/\/+$/, '');

    return [
      {
        source: '/api/:path*',
        destination: `${API_BASE_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
