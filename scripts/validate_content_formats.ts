/**
 * Validates the public.content_formats rows after seeding.
 * Spec: docs/content_planner_buildout.md section 9.9.
 *
 * Run with: npx tsx scripts/validate_content_formats.ts
 *
 * Checks:
 *   - Total count = 35; per-content-type counts match the spec
 *   - Every row has non-empty description, starting_point, secret_sauce, gating_rule
 *   - strategy_beats is a non-empty array of { label, description }
 *   - mad_libs is a non-empty array of { beat, lines: [string] }
 *   - target_length_min <= target_length_max (both null is OK)
 *   - bucket is a valid enum
 *   - pillar, when set, is a valid enum
 *   - slug matches ^<content_type>\\.[a-z0-9_]+$
 *
 * Exits non-zero with a summary on any failure.
 */

import { listFormats } from '../src/lib/contentFormats'
import type { ContentFormat, ContentBucket, ContentPillar } from '../src/lib/contentFormats'

const VALID_BUCKETS: ContentBucket[] = ['storytelling', 'educational', 'opinion', 'proof_community']
const VALID_PILLARS: ContentPillar[] = ['educational', 'storytelling', 'authority', 'series', 'doubledown']
const EXPECTED_COUNTS: Record<string, number> = {
  short_form: 19,
  engagement_reel: 6,
  carousel: 5,
  story: 5,
}

const errors: string[] = []

function check(condition: boolean, msg: string): void {
  if (!condition) errors.push(msg)
}

async function main(): Promise<void> {
  const rows: ContentFormat[] = await listFormats()

  check(rows.length === 35, `Expected 35 rows, got ${rows.length}`)

  const counts: Record<string, number> = { short_form: 0, engagement_reel: 0, carousel: 0, story: 0 }
  const slugs = new Set<string>()

  for (const row of rows) {
    const ctx = `[${row.slug || row.id}]`

    // slug shape
    if (!row.slug) {
      errors.push(`${ctx} missing slug`)
    } else {
      if (!/^(short_form|engagement_reel|carousel|story)\.[a-z0-9_]+$/.test(row.slug)) {
        errors.push(`${ctx} slug shape invalid (expect <content_type>.<snake_case>)`)
      }
      if (slugs.has(row.slug)) errors.push(`${ctx} duplicate slug`)
      slugs.add(row.slug)
    }

    // content_type counts
    if (row.content_type in counts) counts[row.content_type]++
    else errors.push(`${ctx} unexpected content_type '${row.content_type}'`)

    // text fields
    check(!!row.description?.trim(), `${ctx} description empty`)
    check(!!row.starting_point?.trim(), `${ctx} starting_point empty`)
    check(!!row.secret_sauce?.trim(), `${ctx} secret_sauce empty`)
    check(!!row.gating_rule?.trim(), `${ctx} gating_rule empty`)

    // strategy_beats
    if (!Array.isArray(row.strategy_beats) || row.strategy_beats.length === 0) {
      errors.push(`${ctx} strategy_beats must be a non-empty array`)
    } else {
      for (const [i, b] of row.strategy_beats.entries()) {
        if (!b || typeof b !== 'object') {
          errors.push(`${ctx} strategy_beats[${i}] not an object`)
          continue
        }
        if (!b.label?.trim()) errors.push(`${ctx} strategy_beats[${i}].label empty`)
        if (!b.description?.trim()) errors.push(`${ctx} strategy_beats[${i}].description empty`)
      }
    }

    // mad_libs
    if (!Array.isArray(row.mad_libs) || row.mad_libs.length === 0) {
      errors.push(`${ctx} mad_libs must be a non-empty array`)
    } else {
      for (const [i, m] of row.mad_libs.entries()) {
        if (!m || typeof m !== 'object') {
          errors.push(`${ctx} mad_libs[${i}] not an object`)
          continue
        }
        if (!m.beat?.trim()) errors.push(`${ctx} mad_libs[${i}].beat empty`)
        if (!Array.isArray(m.lines) || m.lines.length === 0) {
          errors.push(`${ctx} mad_libs[${i}].lines must be a non-empty array`)
        } else {
          for (const [j, line] of m.lines.entries()) {
            if (typeof line !== 'string' || !line.trim()) {
              errors.push(`${ctx} mad_libs[${i}].lines[${j}] empty / non-string`)
            }
          }
        }
      }
    }

    // length bounds
    if (row.target_length_min !== null && row.target_length_max !== null) {
      if (row.target_length_min > row.target_length_max) {
        errors.push(`${ctx} target_length_min (${row.target_length_min}) > target_length_max (${row.target_length_max})`)
      }
    }

    // bucket
    if (!VALID_BUCKETS.includes(row.bucket)) {
      errors.push(`${ctx} bucket '${row.bucket}' not in [${VALID_BUCKETS.join(', ')}]`)
    }

    // pillar (nullable)
    if (row.pillar !== null && !VALID_PILLARS.includes(row.pillar)) {
      errors.push(`${ctx} pillar '${row.pillar}' not in [${VALID_PILLARS.join(', ')}]`)
    }
  }

  // counts per content_type
  for (const [type, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[type] !== expected) {
      errors.push(`content_type=${type} expected ${expected}, got ${counts[type]}`)
    }
  }

  if (errors.length === 0) {
     
    console.log(`PASS - ${rows.length} content_formats validated.`)
    for (const [type, n] of Object.entries(counts)) {
       
      console.log(`  ${type.padEnd(16)} ${n}`)
    }
    process.exit(0)
  }

   
  console.log(`FAIL - ${errors.length} issue(s):`)
  for (const e of errors) {
     
    console.log(`  ${e}`)
  }
  process.exit(1)
}

main().catch((err) => {
   
  console.error('FAIL - script error:', err)
  process.exit(2)
})
