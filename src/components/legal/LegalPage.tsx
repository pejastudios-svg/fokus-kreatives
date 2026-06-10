/* eslint-disable @next/next/no-img-element */

// Shared shell for the public legal / info pages (/privacy, /terms,
// /support, /zoom-guide). These exist primarily to satisfy app-marketplace
// listing requirements (Zoom, Google OAuth branding) and are intentionally
// static, readable, and theme-aware.

const LOGO = 'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-secondary)]">
      <header
        className="px-6 py-5"
        style={{ background: 'linear-gradient(135deg,#2B79F7 0%,#1E54B7 55%,#143A80 100%)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <img src={LOGO} alt="Fokus Kreativez" className="h-8 w-auto object-contain" />
          <span className="text-white font-bold text-lg">Fokus Kreativez</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
        {updated && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1">Last updated: {updated}</p>
        )}
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <footer className="max-w-3xl mx-auto px-6 pb-10 text-xs text-[var(--text-tertiary)]">
        © {new Date().getFullYear()} Fokus Kreativez ·{' '}
        <a href="/privacy" className="hover:underline">Privacy</a> ·{' '}
        <a href="/terms" className="hover:underline">Terms</a> ·{' '}
        <a href="/support" className="hover:underline">Support</a>
      </footer>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  )
}
