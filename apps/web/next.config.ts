import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.6', '172.31.3.122'],
  output: 'standalone',
  poweredByHeader: false,
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: securityHeaders(
          process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api/v1',
          {
            development: process.env.NODE_ENV === 'development',
          },
        ),
      },
    ]),
};

export default nextConfig;
