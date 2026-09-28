import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.6'],
  output: 'standalone',
  poweredByHeader: false,
};

export default nextConfig;
