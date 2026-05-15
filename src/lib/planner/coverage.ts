// Coverage math: distribute slots across the 4 buckets per the brand's
// content_stage targets. Boost under-represented buckets in scoring.

import type { ContentBucket } from '@/lib/contentFormats/types'
import {
  STAGE_TARGETS,
  ZERO_COVERAGE,
  type ContentStage,
  type CoverageSnapshot,
  type PlannerSlotRow,
  bucketKey,
} from './types'

export interface CoverageInputs {
  stage: ContentStage
  /** Per-brand overrides. Null fields fall back to stage defaults. */
  overrides?: Partial<CoverageSnapshot> | null
  /**
   * Slots already in the horizon at the moment this is computed. Each slot
   * carries the format's bucket so we can tally without re-reading content_formats.
   */
  slotsBuckets: ContentBucket[]
}

export function effectiveTargets(
  stage: ContentStage,
  overrides?: Partial<CoverageSnapshot> | null,
): CoverageSnapshot {
  const base = STAGE_TARGETS[stage]
  if (!overrides) return base
  return {
    storytelling: overrides.storytelling ?? base.storytelling,
    educational: overrides.educational ?? base.educational,
    opinion: overrides.opinion ?? base.opinion,
    proof_community: overrides.proof_community ?? base.proof_community,
  }
}

/** Tally bucket distribution as percentages of total. Empty -> all zero. */
export function tallyCoverage(slotsBuckets: ContentBucket[]): CoverageSnapshot {
  if (slotsBuckets.length === 0) return { ...ZERO_COVERAGE }
  const counts = { ...ZERO_COVERAGE }
  for (const b of slotsBuckets) counts[bucketKey(b)] += 1
  const total = slotsBuckets.length
  return {
    storytelling: (counts.storytelling / total) * 100,
    educational: (counts.educational / total) * 100,
    opinion: (counts.opinion / total) * 100,
    proof_community: (counts.proof_community / total) * 100,
  }
}

/**
 * coverage_need component for the scoring algorithm. The bigger the gap
 * between target_pct and current_pct in a bucket, the higher the boost
 * for formats in that bucket.
 *
 * Formula per the spec: (target_pct - current_pct) * 0.5, capped at 10,
 * floored at 0.
 */
export function coverageNeed(
  bucket: ContentBucket,
  current: CoverageSnapshot,
  target: CoverageSnapshot,
): number {
  const k = bucketKey(bucket)
  const gap = target[k] - current[k]
  const raw = gap * 0.5
  return Math.max(0, Math.min(10, raw))
}

/** Helper for the calendar UI - returns a coverage report combining tally + targets. */
export function coverageReport(input: CoverageInputs): {
  current: CoverageSnapshot
  target: CoverageSnapshot
  delta: CoverageSnapshot
} {
  const target = effectiveTargets(input.stage, input.overrides)
  const current = tallyCoverage(input.slotsBuckets)
  const delta: CoverageSnapshot = {
    storytelling: current.storytelling - target.storytelling,
    educational: current.educational - target.educational,
    opinion: current.opinion - target.opinion,
    proof_community: current.proof_community - target.proof_community,
  }
  return { current, target, delta }
}

export function bucketOfSlots(slots: PlannerSlotRow[], formatBuckets: Map<string, ContentBucket>): ContentBucket[] {
  const out: ContentBucket[] = []
  for (const s of slots) {
    if (!s.format_id) continue
    const b = formatBuckets.get(s.format_id)
    if (b) out.push(b)
  }
  return out
}
