import { createClient as createServiceClient } from '@supabase/supabase-js'

import type {
  ContentBucket,
  ContentFormat,
  ContentFormatType,
  FormatBeat,
  FormatMadLib,
  HookPattern,
  ReferenceScript,
} from './types'

export type {
  ContentBucket,
  ContentFormat,
  ContentFormatType,
  ContentPillar,
  FormatBeat,
  FormatMadLib,
  HookPattern,
  ReferenceScript,
} from './types'
export { buildFormatPromptBlock } from './promptBlock'

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Row shape Supabase hands back. jsonb columns arrive as `unknown` until
// normalized; everything else maps 1:1 to the migration.
type Row = Omit<ContentFormat, 'strategy_beats' | 'mad_libs' | 'hook_patterns' | 'reference_scripts'> & {
  strategy_beats: unknown
  mad_libs: unknown
  hook_patterns?: unknown
  reference_scripts?: unknown
}

function normalize(row: Row): ContentFormat {
  return {
    ...row,
    strategy_beats: Array.isArray(row.strategy_beats) ? (row.strategy_beats as FormatBeat[]) : [],
    mad_libs: Array.isArray(row.mad_libs) ? (row.mad_libs as FormatMadLib[]) : [],
    hook_patterns: Array.isArray(row.hook_patterns) ? (row.hook_patterns as HookPattern[]) : [],
    reference_scripts: Array.isArray(row.reference_scripts) ? (row.reference_scripts as ReferenceScript[]) : [],
  }
}

export interface ListFormatsFilter {
  content_type?: ContentFormatType
  bucket?: ContentBucket
  is_active?: boolean
}

export async function listFormats(filter: ListFormatsFilter = {}): Promise<ContentFormat[]> {
  const supabase = admin()
  let query = supabase.from('content_formats').select('*')

  if (filter.content_type) query = query.eq('content_type', filter.content_type)
  if (filter.bucket) query = query.eq('bucket', filter.bucket)
  if (filter.is_active !== undefined) query = query.eq('is_active', filter.is_active)

  const { data, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => normalize(row as Row))
}

export async function getFormatBySlug(slug: string): Promise<ContentFormat | null> {
  const supabase = admin()
  const { data, error } = await supabase
    .from('content_formats')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return data ? normalize(data as Row) : null
}

export async function getFormatById(id: string): Promise<ContentFormat | null> {
  const supabase = admin()
  const { data, error } = await supabase
    .from('content_formats')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? normalize(data as Row) : null
}
