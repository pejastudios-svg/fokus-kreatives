import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'silly-blue-r3z2xucguf.edgeone.app',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;