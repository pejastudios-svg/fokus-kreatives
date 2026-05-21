// Next.js calls register() once per server process boot. We use it to
// run a schema drift check in dev so that if a migration file is
// committed but not applied to the database, we see a loud warning in
// the terminal before the first request fails.
//
// Production deploys skip the check - migrations should run as part of
// the deploy pipeline, and the check adds startup latency we don't want
// on serverless cold-starts.

export async function register() {
  if (process.env.NODE_ENV !== 'development') return
  // Lazy import keeps prod cold-start out of the picture - the module
  // is never loaded outside dev.
  const { runDriftCheck } = await import('./lib/db/driftCheck')
  // Fire and forget. Don't block server startup if Supabase is slow;
  // any failure inside surfaces via console.warn.
  void runDriftCheck()
}
