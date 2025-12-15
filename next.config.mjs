/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Allow production builds even if there are TS errors (we manually run tsc).
    ignoreBuildErrors: true,
  },
  images: {
    // Allow Next/Image to load from your logo host
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'silly-blue-r3z2xucguf.edgeone.app',
        pathname: '/**',
      },
    ],
    // Alternatively, you could use:
    // domains: ['silly-blue-r3z2xucguf.edgeone.app'],
  },
}

export default nextConfig