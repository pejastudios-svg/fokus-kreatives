#!/usr/bin/env node
/**
 * Migration runner. Applies SQL files from sql/migrations/ in alphabetical
 * order, tracking which ones have already been applied in a
 * public.schema_migrations table.
 *
 * Commands:
 *   tsx scripts/migrate.ts            apply pending migrations
 *   tsx scripts/migrate.ts status     list pending without applying
 *   tsx scripts/migrate.ts baseline   mark all current files as applied
 *                                     without running them (use once,
 *                                     after the first install, to record
 *                                     the migrations you already ran by
 *                                     hand)
 *
 * Each migration is applied inside a single transaction so a failure
 * leaves the database in a consistent state. Files whose contents change
 * after being applied are flagged as drift and the runner refuses to
 * continue - create a new migration instead of editing an applied one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import postgres from 'postgres'

const MIGRATIONS_DIR = join(process.cwd(), 'sql', 'migrations')

type Command = 'apply' | 'status' | 'baseline'

interface MigrationFile {
  filename: string
  hash: string
  contents: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function listMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return files.map((filename) => {
    const contents = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    return { filename, contents, hash: sha256(contents) }
  })
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error(
      '[migrate] SUPABASE_DB_URL is not set. Add it to .env.local.\n' +
        '          Get the value from Supabase Dashboard -> Connect ->\n' +
        '          Transaction pooler (port 6543) or Session pooler (port 5432).',
    )
    process.exit(1)
  }

  const arg = process.argv[2] ?? 'apply'
  if (!['apply', 'status', 'baseline'].includes(arg)) {
    console.error(`[migrate] unknown command: ${arg}`)
    console.error('          use one of: apply | status | baseline')
    process.exit(1)
  }
  const command = arg as Command

  let sql: ReturnType<typeof postgres>
  try {
    // Supabase's poolers and direct connection both require SSL. The
    // default 'prefer' mode sometimes drops the connection mid-handshake,
    // surfacing as ECONNRESET. 'require' forces TLS up front.
    //
    // prepare:false keeps the script compatible with Supabase's transaction
    // pooler (port 6543) in case anyone ever points SUPABASE_DB_URL at it.
    // Session pooler / direct connections ignore this flag.
    sql = postgres(url, {
      onnotice: () => {},
      max: 1,
      prepare: false,
      // Supabase's poolers serve a self-signed root cert internally; Node's
      // default validator rejects the chain. We're connecting to a known
      // Supabase hostname over TLS, so the connection is still encrypted -
      // we just skip the chain-of-trust check. Same as `sslmode=no-verify`
      // or how the Supabase CLI / supabase-js handle it.
      ssl: { rejectUnauthorized: false },
    })
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('Invalid URL')) {
      console.error('[migrate] SUPABASE_DB_URL could not be parsed as a URL.')
      console.error(
        '          The most common cause is special characters in the password.\n' +
          '          Percent-encode them in the connection string:\n' +
          '            ?   ->  %3F\n' +
          '            !   ->  %21\n' +
          '            @   ->  %40\n' +
          '            #   ->  %23\n' +
          '            /   ->  %2F\n' +
          '            :   ->  %3A\n' +
          '          Or reset the password to one without special characters.',
      )
      process.exit(1)
    }
    throw err
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename   text PRIMARY KEY,
        hash       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT NOW()
      )
    `

    const applied = await sql<{ filename: string; hash: string }[]>`
      SELECT filename, hash FROM public.schema_migrations
    `
    const appliedByName = new Map(applied.map((r) => [r.filename, r.hash]))

    const files = listMigrationFiles()
    const pending: MigrationFile[] = []
    const drifted: { filename: string; appliedHash: string; currentHash: string }[] = []
    for (const f of files) {
      const recorded = appliedByName.get(f.filename)
      if (recorded === undefined) {
        pending.push(f)
      } else if (recorded !== f.hash) {
        drifted.push({ filename: f.filename, appliedHash: recorded, currentHash: f.hash })
      }
    }

    if (drifted.length > 0) {
      console.error('\n[migrate] DRIFT: these migration files were edited after being applied:')
      for (const d of drifted) {
        console.error(`   - ${d.filename}`)
        console.error(`       applied hash: ${d.appliedHash.slice(0, 12)}...`)
        console.error(`       current hash: ${d.currentHash.slice(0, 12)}...`)
      }
      console.error(
        '\n          Revert the file or create a NEW migration with the change.\n' +
          '          Editing an already-applied migration is never safe.\n',
      )
      process.exit(1)
    }

    if (command === 'status') {
      console.log(`[migrate] total:   ${files.length}`)
      console.log(`[migrate] applied: ${files.length - pending.length}`)
      console.log(`[migrate] pending: ${pending.length}`)
      if (pending.length > 0) {
        console.log('\n          Pending:')
        for (const f of pending) console.log(`            - ${f.filename}`)
      }
      return
    }

    if (command === 'baseline') {
      if (pending.length === 0) {
        console.log('[migrate] nothing to baseline - all migrations already recorded.')
        return
      }
      console.log(
        `[migrate] baselining ${pending.length} migration(s) WITHOUT running them:`,
      )
      for (const f of pending) {
        await sql`
          INSERT INTO public.schema_migrations (filename, hash)
          VALUES (${f.filename}, ${f.hash})
          ON CONFLICT (filename) DO NOTHING
        `
        console.log(`   - ${f.filename}`)
      }
      console.log('[migrate] done. New migrations from this point will run normally.')
      return
    }

    // apply
    if (pending.length === 0) {
      console.log('[migrate] nothing to apply - schema is up to date.')
      return
    }
    console.log(`[migrate] applying ${pending.length} migration(s):`)
    for (const f of pending) {
      process.stdout.write(`   - ${f.filename} ... `)
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(f.contents)
          await tx`
            INSERT INTO public.schema_migrations (filename, hash)
            VALUES (${f.filename}, ${f.hash})
          `
        })
        console.log('OK')
      } catch (err) {
        console.log('FAILED')
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    }
    console.log('[migrate] all migrations applied.')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
