'use client'

const COLORS = ['#2B79F7', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4']

// Precomputed ONCE at module load (not during render) so React's purity
// rule is satisfied - Math.random() must not run while rendering. A fixed
// layout per session is imperceptible for confetti, and since this only
// ever mounts after a user action (never during SSR) there's no hydration
// concern.
const PIECES = Array.from({ length: 90 }, (_, i) => {
  const size = 6 + Math.random() * 6
  const style: React.CSSProperties = {
    left: `${Math.random() * 100}%`,
    width: `${size}px`,
    height: `${size * 0.5}px`,
    backgroundColor: COLORS[i % COLORS.length],
    animationDelay: `${Math.random() * 0.4}s`,
    animationDuration: `${2.2 + Math.random() * 1.6}s`,
  }
  return { id: i, style }
})

/** Lightweight, dependency-free confetti burst. Renders a fixed full-screen
 *  overlay of colored pieces that fall + spin once. Mount it conditionally
 *  (e.g. while a celebration is showing); unmounting removes the pieces. */
export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden" aria-hidden="true">
      {PIECES.map((p) => (
        <span key={p.id} className="confetti-piece" style={p.style} />
      ))}
    </div>
  )
}
