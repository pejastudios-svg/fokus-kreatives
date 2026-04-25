import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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