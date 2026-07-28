import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  experimental: {
    proxyTimeout: 300_000,
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
