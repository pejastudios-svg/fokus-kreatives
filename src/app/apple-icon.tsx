// iOS home-screen icon generated at build time.
//
// Next.js maps this file to /apple-icon and emits the matching
// <link rel="apple-touch-icon" sizes="180x180" /> tag automatically -
// so we DON'T need to list it in `metadata.icons.apple` anymore.
//
// What this fixes: the raw logo PNG has a transparent background
// and fills the entire 1:1 frame. iOS uses the image as-is (no
// padding, no auto-background), so the home-screen icon ended up
// with a black fill and the logo cropped to the edges. By compositing
// the logo onto a brand-blue square with breathing room here, the
// resulting icon looks intentional and matches the system style.

import { ImageResponse } from 'next/og'

// iOS expects 180x180 for modern iPhones. iPad slots will scale it
// down. Listing one size is enough.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const LOGO_URL =
  'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'

export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Brand blue. iOS rounds the corners itself; we draw a
          // square. Setting a solid background prevents the
          // "transparent + black fallback" look entirely.
          background: '#2B79F7',
        }}
      >
        {/* Logo at ~66% of the canvas leaves a comfortable margin
            so iOS' corner-radius mask doesn't clip into it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO_URL}
          alt=""
          width={120}
          height={120}
          style={{ objectFit: 'contain' }}
        />
      </div>
    ),
    size,
  )
}
