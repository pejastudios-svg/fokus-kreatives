import type { Metadata } from 'next'
import './globals.css'
import { Montserrat } from 'next/font/google'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Fokus Kreatives',
  description: 'Content Creation & Lead Generation Platform',
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
    <html lang="en" className={montserrat.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}