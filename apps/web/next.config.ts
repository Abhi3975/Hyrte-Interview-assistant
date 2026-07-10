import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Proxy API calls to the NestJS gateway in dev; in prod the CDN/ingress
  // routes /api to the API service directly.
  async rewrites() {
    const api = process.env.API_BASE_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
