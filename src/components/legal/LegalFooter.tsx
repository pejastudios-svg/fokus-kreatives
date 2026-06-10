// Tiny footer with the public policy links. Dropped onto auth surfaces
// (login, invite/activation) and the settings pages so the policies that
// app-marketplace reviews point at are reachable from inside the product too.

export function LegalFooter({
  className = 'text-[var(--text-tertiary)]',
}: {
  /** Override to retint for the surface (e.g. text-white/70 on the gradient). */
  className?: string
}) {
  return (
    <p className={`text-center text-[11px] ${className}`}>
      <a href="/privacy" className="hover:underline">Privacy Policy</a>
      <span className="mx-1.5">·</span>
      <a href="/terms" className="hover:underline">Terms of Use</a>
      <span className="mx-1.5">·</span>
      <a href="/support" className="hover:underline">Support</a>
    </p>
  )
}
