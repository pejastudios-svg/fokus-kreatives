'use client'

import { useEffect } from 'react'

// global-error wraps the root layout, so it must define its own <html> and
// <body>. This is the last-resort fallback when even the root layout itself
// crashes - we keep it ultra-minimal and self-contained, with no global CSS
// dependencies, so it can render even if `globals.css` failed to load.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', error, error.digest ? `(digest: ${error.digest})` : '')
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          backgroundColor: '#0A0F18',
          color: '#E5E7EB',
        }}
      >
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div
            style={{
              margin: '0 auto 20px',
              height: 56,
              width: 56,
              borderRadius: '9999px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#EF4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            !
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 6px' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: '#9CA3AF', margin: '0 0 20px' }}>
            We hit an unexpected snag. You can retry, or refresh the page in a moment.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                backgroundColor: '#2B79F7',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #1F2937',
                color: '#D1D5DB',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
