import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Montserrat, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { ServiceWorkerBoot } from '@/components/notifications/ServiceWorkerBoot'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
})

// IBM Plex Sans/Mono are scoped to the new dashboard surfaces (CRM
// dashboard for now). Loaded as CSS variables so individual pages can
// opt in via `font-[var(--font-plex-sans)]` without leaking the font
// across the rest of the app.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

// The apple-touch-icon is generated at build time by
// `src/app/apple-icon.tsx` (Next.js file convention) - it composites
// the logo onto a brand-blue square so iOS doesn't fall back to a
// black background when it processes the transparent PNG. Don't list
// `icons.apple` here or iOS may pick the raw transparent URL instead
// of the generated padded version.
const LOGO_URL =
  'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'

export const metadata: Metadata = {
  title: 'Fokus Kreatives',
  description: 'Content Creation & Lead Generation Platform',
  // manifest -> Install-as-PWA on desktop browsers + Android.
  // appleWebApp -> iOS Add-to-Home-Screen flow, which is the
  // prerequisite for iOS 16.4+ Web Push.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Fokus',
    startupImage: undefined,
  },
  icons: {
    icon: [
      { url: LOGO_URL, type: 'image/png' },
    ],
    shortcut: [LOGO_URL],
  },
}

export const viewport: Viewport = {
  themeColor: '#2B79F7',
}

// Runs synchronously before React hydrates so the correct theme class is on
// <html> by the time the first paint happens. Without this, dark-mode users
// would briefly see the light theme on every page load. Defaults to dark.
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('fk-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Added suppressHydrationWarning to ignore extension injections like 'webcrx'
    <html
      lang="en"
      className={`${montserrat.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <ThemeProvider>
          {/* Boots the service worker on the first render of any
              authenticated page + listens for "click a notification"
              messages from the SW so we can navigate the SPA without
              forcing a full reload. */}
          <ServiceWorkerBoot />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}