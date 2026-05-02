'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'fk-theme'
const DEFAULT_THEME: Theme = 'dark'

function applyClass(theme: Theme) {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  html.classList.remove('light', 'dark')
  html.classList.add(theme)
}

/**
 * Reads the user's theme preference from localStorage and applies the class
 * to <html> for both Tailwind dark: utilities and the CSS-variable system in
 * globals.css. Pairs with the inline script in app/layout.tsx that runs
 * pre-hydration to avoid a flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy init: on first client render, read whichever class the inline
  // bootstrap script in layout.tsx already applied to <html>. The bootstrap
  // runs before hydration so this is the source of truth.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return DEFAULT_THEME
    return document.documentElement.classList.contains('light') ? 'light' : 'dark'
  })

  // After mount, fetch the user's persisted preference from the server. If
  // it differs from what's currently on <html> (e.g. user changed it on
  // another device), apply the server value. We skip the fetch if the user
  // isn't signed in - that returns 401 and we just keep using localStorage.
  const fetchedRef = useRef(false)
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void (async () => {
      try {
        const res = await fetch('/api/me/preferences', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        const serverTheme = data?.preferences?.theme as Theme | undefined
        if (serverTheme && serverTheme !== theme) {
          setThemeState(serverTheme)
          applyClass(serverTheme)
          try {
            window.localStorage.setItem(STORAGE_KEY, serverTheme)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* signed-out or offline - no problem */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      window.localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore storage errors (private mode, etc.) */
    }
    applyClass(t)
    // Fire-and-forget save to the server. The Settings page also calls
    // PATCH directly when the user clicks a theme card - this covers the
    // case where some other surface flips the theme too.
    void fetch('/api/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {
      /* silent - localStorage covers the gap */
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Provider absent (e.g., during static rendering of a public page) -
    // fall back to the default and treat setters as no-ops so callers
    // don't need to defensively check.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      toggleTheme: () => {},
    }
  }
  return ctx
}
