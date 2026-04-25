/**
 * Structural validator for long-form package scripts.
 *
 * Asserts the output has the required bracket sections, the right point
 * count, sequential POINT labels, and every body point has the full
 * CONTEXT / APPLICATION / FRAMING / RE-HOOK label set. Anything the regex
 * sanitizer can't reliably repair lands here and triggers a single retry.
 */

export interface StructuralIssue {
  code: string
  detail: string
}

const REQUIRED_SECTIONS = [
  '[TITLE]',
  '[OUTLINE]',
  '[INTRO]',
  '[BODY]',
  '[OUTRO]',
  '[CTA]',
  '[DESCRIPTION]',
] as const

export function validateLongformStructure(text: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  const t = text || ''

  for (const tag of REQUIRED_SECTIONS) {
    if (!t.includes(tag)) {
      issues.push({ code: 'missing_section', detail: `Missing required section ${tag}. Every long-form output MUST have all of: ${REQUIRED_SECTIONS.join(', ')}.` })
    }
  }

  const outlineSection = extractSection(t, '[OUTLINE]', '[INTRO]')
  const outlineBullets = (outlineSection.match(/^\s*[*•\-]\s+POINT:/gim) || []).length

  const bodySection = extractSection(t, '[BODY]', '[OUTRO]')
  const bodyHeaders = bodySection.match(/^\s*POINT\s+\d+[:.\-]/gim) || []
  const bodyCount = bodyHeaders.length

  if (outlineBullets && (outlineBullets < 3 || outlineBullets > 4)) {
    issues.push({ code: 'outline_count', detail: `[OUTLINE] has ${outlineBullets} bullet points. It MUST have exactly 3 or 4, never more.` })
  }
  if (bodyCount && (bodyCount < 3 || bodyCount > 4)) {
    issues.push({ code: 'body_count', detail: `[BODY] has ${bodyCount} POINT headers. It MUST have exactly 3 or 4, never more. Group sub-steps inside APPLICATION instead of adding more top-level points.` })
  }
  if (outlineBullets && bodyCount && outlineBullets !== bodyCount) {
    issues.push({ code: 'count_mismatch', detail: `[OUTLINE] has ${outlineBullets} bullets but [BODY] has ${bodyCount} POINT headers. OUTLINE count MUST equal BODY count.` })
  }

  bodyHeaders.forEach((h, i) => {
    const m = h.match(/POINT\s+(\d+)/i)
    if (!m) return
    const labeled = parseInt(m[1], 10)
    if (labeled !== i + 1) {
      issues.push({ code: 'nonsequential_labels', detail: `BODY point labels must be sequential 1, 2, 3, 4 in reading order. Saw "${h.trim()}" at position ${i + 1}. The 2-1-3-4 rule reorders points by STRENGTH internally; the output numbering is always sequential.` })
    }
  })

  const metaPointIssue = detectMetaPointOne(bodySection)
  if (metaPointIssue) issues.push(metaPointIssue)

  const points = splitBodyIntoPoints(bodySection)
  points.forEach((section, i) => {
    const n = i + 1
    const isLast = i === points.length - 1
    if (!/\bCONTEXT\s*:/i.test(section)) {
      issues.push({ code: 'missing_context', detail: `POINT ${n} is missing the CONTEXT: label.` })
    }
    if (!/\bAPPLICATION\s*:/i.test(section)) {
      issues.push({ code: 'missing_application', detail: `POINT ${n} is missing the APPLICATION: label.` })
    }
    if (!/\bFRAMING\s*:/i.test(section)) {
      issues.push({ code: 'missing_framing', detail: `POINT ${n} is missing the FRAMING: label. FRAMING must appear on its own line AFTER APPLICATION with 2-3 sentences on why this mechanic matters for the viewer's real problem. It is never skipped or merged into APPLICATION.` })
    }
    if (!isLast && !/\bRE[-\s]?HOOK\s*:/i.test(section)) {
      issues.push({ code: 'missing_rehook', detail: `POINT ${n} is missing the RE-HOOK: label. Every body point EXCEPT the final one must end with a single-sentence RE-HOOK tease.` })
    }
    if (isLast && /\bRE[-\s]?HOOK\s*:/i.test(section)) {
      issues.push({ code: 'extra_rehook', detail: `POINT ${n} is the final body point and MUST NOT include a RE-HOOK: label. Only points 1 through N-1 have RE-HOOK; the last flows straight into [OUTRO].` })
    }
    if (/\bCONTEXT\s*:/i.test(section) && /\bAPPLICATION\s*:/i.test(section) && /\bFRAMING\s*:/i.test(section)) {
      const ci = section.search(/\bCONTEXT\s*:/i)
      const ai = section.search(/\bAPPLICATION\s*:/i)
      const fi = section.search(/\bFRAMING\s*:/i)
      if (!(ci < ai && ai < fi)) {
        issues.push({ code: 'out_of_order_labels', detail: `POINT ${n} has CONTEXT / APPLICATION / FRAMING in the wrong order. Required order: CONTEXT → APPLICATION → FRAMING → RE-HOOK.` })
      }
    }
  })

  return issues
}

function extractSection(text: string, startTag: string, endTag: string): string {
  const startIdx = text.indexOf(startTag)
  if (startIdx < 0) return ''
  const afterStart = startIdx + startTag.length
  const endIdx = text.indexOf(endTag, afterStart)
  if (endIdx < 0) return text.slice(afterStart)
  return text.slice(afterStart, endIdx)
}

function splitBodyIntoPoints(bodyText: string): string[] {
  const parts = bodyText.split(/^\s*POINT\s+\d+[:.\-]/gim)
  return parts.slice(1)
}

const META_POINT_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'is', 'are', 'was', 'were', 'be', 'been',
  'in', 'on', 'by', 'with', 'from', 'at', 'as', 'that', 'this', 'these', 'those',
  'your', 'our', 'their', 'his', 'her', 'its', 'my', 'you', 'we', 'they', 'it',
  'how', 'why', 'what', 'when', 'where', 'who', 'which',
  'not', 'but', 'so', 'if', 'then', 'than',
  'point', 'points', 'step', 'steps', 'way', 'ways',
])

const UMBRELLA_WORDS = new Set([
  'pattern', 'system', 'framework', 'method', 'blueprint', 'process',
  'sequence', 'approach', 'strategy', 'formula', 'map', 'roadmap',
  'playbook', 'recipe', 'engine', 'machine',
])

function titleHasUmbrellaWord(title: string): boolean {
  const tokens = (title.toLowerCase().match(/\b[a-z]+\b/g) || [])
  return tokens.some((t) => UMBRELLA_WORDS.has(t))
}

function titleKeywords(title: string): string[] {
  const tokens = (title.toLowerCase().match(/\b[a-z][a-z-]{2,}\b/g) || [])
  return tokens.filter((w) => !META_POINT_STOPWORDS.has(w))
}

function extractPointTitles(bodyText: string): string[] {
  const matches = bodyText.match(/^\s*POINT\s+\d+\s*[:.\-]\s*([^\n]+)/gim) || []
  return matches.map((line) => line.replace(/^\s*POINT\s+\d+\s*[:.\-]\s*/i, '').trim())
}

function extractApplicationText(pointSection: string): string {
  const start = pointSection.search(/\bAPPLICATION\s*:/i)
  if (start < 0) return ''
  const rest = pointSection.slice(start)
  const end = rest.search(/\bFRAMING\s*:/i)
  if (end < 0) return rest
  return rest.slice(0, end)
}

/**
 * Detect POINT 1 walking through the territory of POINTS 2..N.
 *
 * Heuristic: for each later POINT's title, check whether POINT 1's APPLICATION
 * mentions at least one distinctive (non-stopword) keyword from that title.
 * If POINT 1's APPLICATION "touches" half or more of the other POINTs' titles,
 * it's almost certainly a meta-summary of them and should be replaced.
 */
function detectMetaPointOne(bodyText: string): StructuralIssue | null {
  const titles = extractPointTitles(bodyText)
  if (titles.length < 3) return null

  const points = splitBodyIntoPoints(bodyText)
  if (!points.length) return null
  const point1App = extractApplicationText(points[0]).toLowerCase()
  if (!point1App) return null

  const touched: { title: string; via: string[] }[] = []
  for (let i = 1; i < titles.length; i++) {
    const keywords = titleKeywords(titles[i])
    const hits = keywords.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(point1App))
    if (hits.length) touched.push({ title: titles[i], via: hits })
  }

  const threshold = Math.ceil((titles.length - 1) / 2)
  if (touched.length >= threshold && titleHasUmbrellaWord(titles[0])) {
    const touchedList = touched.map((t) => `"${t.title}" (via ${t.via.slice(0, 3).map((w) => `"${w}"`).join(', ')})`).join('; ')
    const otherTitles = titles.slice(1).map((t) => `"${t}"`).join(', ')
    return {
      code: 'meta_point_one',
      detail: `CRITICAL STRUCTURAL FAILURE: POINT 1 ("${titles[0]}") is a META-POINT — an umbrella/pattern/framework that POINTS 2+ are sub-mechanics of. Its APPLICATION references ${touched.length} of the other ${titles.length - 1} POINT titles: ${touchedList}. This is the #1 failure mode in this system and it is UNACCEPTABLE.\n\nTO FIX: (1) DELETE POINT 1 entirely — its title, its CONTEXT, its APPLICATION, its FRAMING, its RE-HOOK. Do NOT rename it. Do NOT rewrite it. DELETE IT. (2) RENUMBER: old POINT 2 becomes new POINT 1, old POINT 3 becomes POINT 2, old POINT 4 becomes POINT 3. Your current POINTs are ${otherTitles}. (3) ADD A NEW FINAL POINT covering a distinct, specific mechanic NOT already covered by the existing points and NOT an umbrella over them. Its title MUST NOT contain the words: pattern, system, framework, method, blueprint, process, sequence, approach, strategy, formula, map, roadmap, playbook, recipe, engine, machine. (4) Update [OUTLINE] and [DESCRIPTION] to match the new point list. (5) Update the intro's Plan beat to preview the new point titles.`,
    }
  }
  return null
}

export function formatIssuesForRetry(issues: StructuralIssue[]): string {
  if (!issues.length) return ''
  const bullets = issues.map((i) => `- ${i.detail}`).join('\n')
  return `YOUR PREVIOUS ATTEMPT had these structural problems. Fix ALL of them on this pass while keeping every other rule in the system prompt:\n${bullets}`
}

export function validateCarouselStructure(text: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  const t = text || ''
  const required = ['[ANGLE]', '[CAPTION]', '[HASHTAGS]']
  for (const tag of required) {
    if (!t.includes(tag)) {
      issues.push({ code: 'missing_section', detail: `Missing required section ${tag}. Every carousel MUST include all of: [CAROUSEL N of 10], [ANGLE], 10 slides, [CAPTION], [HASHTAGS].` })
    }
  }
  if (!/\[CAROUSEL\s+\d+\s+of\s+\d+\]/i.test(t)) {
    issues.push({ code: 'missing_header', detail: `Missing or malformed [CAROUSEL N of 10] header. It MUST appear at the top in that exact form.` })
  }
  const slides = (t.match(/^\s*Slide\s+\d+\s*:/gim) || []).length
  if (slides !== 10) {
    issues.push({ code: 'slide_count', detail: `Found ${slides} slides. The spec is EXACTLY 10 slides — not fewer, not more. Expand the teaching beat with concrete examples or breakdowns from the long-form until there are exactly 10 slides. Do NOT pad by restating the same point.` })
  }
  const slideLabels = t.match(/^\s*Slide\s+(\d+)\s*:/gim) || []
  slideLabels.forEach((h, i) => {
    const m = h.match(/Slide\s+(\d+)/i)
    if (!m) return
    const labeled = parseInt(m[1], 10)
    if (labeled !== i + 1) {
      issues.push({ code: 'nonsequential_slides', detail: `Slides must be numbered sequentially 1, 2, 3, … in reading order. Saw "${h.trim()}" at position ${i + 1}.` })
    }
  })
  const hashMatch = t.match(/\[HASHTAGS\][\s\S]*$/i)
  if (hashMatch) {
    const tags = (hashMatch[0].match(/#[A-Za-z0-9_]+/g) || [])
    if (tags.length < 12 || tags.length > 18) {
      issues.push({ code: 'hashtag_count', detail: `[HASHTAGS] has ${tags.length} tags. It MUST have 12–18 unique tags.` })
    }
    const lower = tags.map((x) => x.toLowerCase())
    if (new Set(lower).size !== lower.length) {
      issues.push({ code: 'duplicate_hashtags', detail: `[HASHTAGS] contains duplicates. All tags must be unique.` })
    }
  }
  return issues
}

export function validateReelStructure(text: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  const t = text || ''
  const required = ['[ANGLE]', '[SCENES]', '[CAPTION]', '[HASHTAGS]']
  for (const tag of required) {
    if (!t.includes(tag)) {
      issues.push({ code: 'missing_section', detail: `Missing required section ${tag}. Every reel MUST include: [REEL N of 10], [ANGLE], [WHY THIS WORKS], [FORMAT], [LENGTH], [PACING], [SCENES], [CAPTION], [HASHTAGS].` })
    }
  }
  if (!/\[REEL\s+\d+\s+of\s+\d+\]/i.test(t)) {
    issues.push({ code: 'missing_header', detail: `Missing or malformed [REEL N of 10] header.` })
  }
  const scenesBlock = extractSectionFrom(t, '[SCENES]', '[CAPTION]')
  const scenes = (scenesBlock.match(/^\s*Scene\s+\d+\b/gim) || []).length
  if (scenes < 1 || scenes > 4) {
    issues.push({ code: 'scene_count', detail: `Found ${scenes} scenes in [SCENES]. The spec is 1–4 scenes — most reels are 2–3.` })
  }
  const sceneLabels = scenesBlock.match(/^\s*Scene\s+(\d+)\b/gim) || []
  sceneLabels.forEach((h, i) => {
    const m = h.match(/Scene\s+(\d+)/i)
    if (!m) return
    const labeled = parseInt(m[1], 10)
    if (labeled !== i + 1) {
      issues.push({ code: 'nonsequential_scenes', detail: `Scenes must be numbered sequentially 1, 2, 3, … in reading order. Saw "${h.trim()}" at position ${i + 1}.` })
    }
  })
  const hashMatch = t.match(/\[HASHTAGS\][\s\S]*$/i)
  if (hashMatch) {
    const tags = (hashMatch[0].match(/#[A-Za-z0-9_]+/g) || [])
    if (tags.length < 8 || tags.length > 14) {
      issues.push({ code: 'hashtag_count', detail: `[HASHTAGS] has ${tags.length} tags. Reels require 8–14 unique tags.` })
    }
    const lower = tags.map((x) => x.toLowerCase())
    if (new Set(lower).size !== lower.length) {
      issues.push({ code: 'duplicate_hashtags', detail: `[HASHTAGS] contains duplicates. All tags must be unique.` })
    }
  }
  return issues
}

export function validateStoryStructure(text: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  const t = text || ''
  const required = ['[ANGLE]', '[SLIDES]']
  for (const tag of required) {
    if (!t.includes(tag)) {
      issues.push({ code: 'missing_section', detail: `Missing required section ${tag}. Every story MUST include: [STORY N of 10], [ANGLE], [SLIDES] (1–4 slides).` })
    }
  }
  if (!/\[STORY\s+\d+\s+of\s+\d+\]/i.test(t)) {
    issues.push({ code: 'missing_header', detail: `Missing or malformed [STORY N of 10] header.` })
  }
  const slidesBlock = extractSectionFrom(t, '[SLIDES]', '[OPTIONAL STICKER]')
  const slides = (slidesBlock.match(/^\s*Slide\s+\d+\b/gim) || []).length
  if (slides < 1 || slides > 4) {
    issues.push({ code: 'slide_count', detail: `Found ${slides} slides in [SLIDES]. The spec is 1–4 — most stories are 2–3.` })
  }
  return issues
}

function extractSectionFrom(text: string, startTag: string, endTag: string): string {
  const startIdx = text.indexOf(startTag)
  if (startIdx < 0) return ''
  const afterStart = startIdx + startTag.length
  const endIdx = text.indexOf(endTag, afterStart)
  if (endIdx < 0) return text.slice(afterStart)
  return text.slice(afterStart, endIdx)
}
