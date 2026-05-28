export type SeriesLabel = 'Day' | 'Part' | 'Episode' | 'Chapter' | 'Lesson'
export type SeriesFormat = 'longform' | 'short' | 'carousel' | 'story' | 'engagement'
export type SeriesFraming = 'lessons' | 'progress' | 'challenge' | 'step-by-step' | 'freeform'
export type SeriesBeatType =
  | 'lesson'
  | 'story'
  | 'progress'
  | 'tip'
  | 'mistake'
  | 'win'
  | 'belief'

export interface SeriesQuestion {
  id: string
  text: string
  entry_index: number
  beat_type: SeriesBeatType
  anchor_field?: string
  anchor_value?: string
  placeholder?: string
  /** True for the single framing question that becomes the series INTRO.
   *  The intro sits at entry_index 0, has no beat/anchor, and is rendered and
   *  prompted differently from the per-day entries. */
  is_intro?: boolean
}

export interface SeriesForm {
  id: string
  client_id: string
  token: string
  title: string
  series_label: SeriesLabel
  series_length: number
  format: SeriesFormat
  framing: SeriesFraming | null
  questions: SeriesQuestion[]
  cta_text: string | null
  brand_line: string | null
  submitted_at: string | null
  created_at: string
}

export interface SeriesAnswer {
  id: string
  series_form_id: string
  client_id: string
  question_id: string
  question_text: string
  entry_index: number
  answer: string
  created_at: string
}

export const SERIES_LABELS: SeriesLabel[] = ['Day', 'Part', 'Episode', 'Chapter', 'Lesson']
export const SERIES_FORMATS: { id: SeriesFormat; label: string }[] = [
  { id: 'longform', label: 'Long-form (10-15 min YouTube)' },
  { id: 'short', label: 'Short-form (45-60 sec)' },
  { id: 'carousel', label: 'Carousel (10 slides)' },
  { id: 'engagement', label: 'Engagement Reel (text-only)' },
  { id: 'story', label: 'Story (1-4 IG slides)' },
]
export const SERIES_FRAMINGS: { id: SeriesFraming; label: string; description: string }[] = [
  {
    id: 'lessons',
    label: 'Lessons series',
    description: 'Each entry teaches one new lesson - "30 lessons by 30" style.',
  },
  {
    id: 'progress',
    label: 'Progress update series',
    description: 'One big goal, each entry is a progress update toward it.',
  },
  {
    id: 'challenge',
    label: 'Challenge series',
    description: 'Daily challenge updates, each entry shows where you are in it.',
  },
  {
    id: 'step-by-step',
    label: 'Step-by-step series',
    description: 'Each entry is a tutorial step that builds toward one outcome.',
  },
  {
    id: 'freeform',
    label: 'Freeform',
    description: 'Custom framing - the AI infers the throughline from the title.',
  },
]
