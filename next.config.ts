import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Router cache: hold dynamic Route segments in memory for 60s and
  // static for 5 min after navigation. When the user clicks back, Next
  // renders the cached RSC payload instantly instead of refetching the
  // server. Client-side `fetch()` calls inside pages still run normally
  // (those need SWR / react-query for cross-mount caching).
  experimental: {
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  images: {
    // FIX: Add your Supabase project domain here so profile pics can load
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google Auth images
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com', // GitHub Auth images
      },
      {
        protocol: 'https',
        hostname: 'silly-blue-r3z2xucguf.edgeone.app', // Your logo host
      },
      {
        protocol: 'https',
        hostname: 'rxlheqpronnukvlenhwc.supabase.co', // ✅ NEW: Your Supabase Storage
      },
    ],
  },
}

export default nextConfig