// Structured logger for supabase-js / PostgREST errors.
//
// When a Supabase call fails the default console.error shows the error
// object but not WHAT we were trying to do. Today's bug (Postgres 42703
// "column does not exist") took 90 minutes to diagnose partly because
// the error message didn't say which table or which call shape produced
// it. This helper closes that gap.
//
// Usage:
//   const { data, error } = await supabase.from('X').update({...}).eq(...)
//   if (error) {
//     logDbError(error, { op: 'update', table: 'X', context: { slotId } })
//     // ...then throw / return as the caller decides
//   }
//
// PG error codes worth recognizing on sight:
//   42703 - undefined_column        (column does not exist - migration?)
//   42P01 - undefined_table         (table missing - migration?)
//   23505 - unique_violation        (constraint violation)
//   23503 - foreign_key_violation
//   PGRST202 - PostgREST function not found (RPC migration didn't apply)
//   PGRST116 - schema cache miss    (run NOTIFY pgrst, 'reload schema')

interface SupabaseLikeError {
  code?: string | number
  message?: string
  details?: string | null
  hint?: string | null
}

interface DbErrorContext {
  /** What operation was attempted: 'update' | 'select' | 'insert' | 'rpc' | etc. */
  op: string
  /** Table or RPC name involved. */
  table: string
  /** Free-form context: id being updated, filter args, RPC params. */
  context?: Record<string, unknown>
}

const KNOWN_CODES: Record<string, string> = {
  '42703': 'undefined_column - column does not exist. Did a migration not apply? Try `npm run db:migrate:status`.',
  '42P01': 'undefined_table - table does not exist. Did a migration not apply?',
  '23505': 'unique_violation - a value collides with an existing row on a unique constraint.',
  '23503': 'foreign_key_violation - referenced row does not exist.',
  PGRST202: 'function not found in PostgREST. Run NOTIFY pgrst, \'reload schema\' or wait ~30s for auto-reload.',
  PGRST116: 'schema cache miss in PostgREST. Run NOTIFY pgrst, \'reload schema\'.',
}

export function logDbError(err: SupabaseLikeError, ctx: DbErrorContext): void {
  const codeStr = err.code !== undefined ? String(err.code) : ''
  const hint = codeStr && KNOWN_CODES[codeStr] ? KNOWN_CODES[codeStr] : null

  // Single multi-line console.error so the lines stay grouped in the
  // server log even under heavy concurrent traffic.
  const lines = [
    `[db-error] ${ctx.op} on ${ctx.table}`,
    `   code:    ${codeStr || '(none)'}`,
    `   message: ${err.message || '(none)'}`,
  ]
  if (err.details) lines.push(`   details: ${err.details}`)
  if (err.hint) lines.push(`   pg-hint: ${err.hint}`)
  if (hint) lines.push(`   ↳ ${hint}`)
  if (ctx.context && Object.keys(ctx.context).length > 0) {
    lines.push(`   context: ${JSON.stringify(ctx.context)}`)
  }
  console.error(lines.join('\n'))
}
