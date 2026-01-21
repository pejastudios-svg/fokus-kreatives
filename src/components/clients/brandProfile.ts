export type BrandProfile = {
  business: {
    mission: string
    vision: string
    problem_solved: string
    differentiation: string
    signature_offer: string
  }

  audience: {
    age_range: string
    gender: 'unspecified' | 'male' | 'female' | 'mixed'
    location: string
    work_roles: string
    family_situation: string
    core_values: string
    fears: string
    desires: string
    hangouts: string
    pain_points: [string, string, string, string, string]
    tried_failed: string
    objections: string
    yes_triggers: string
  }

  voice: {
    traits: string
    casualness: 1 | 2 | 3 | 4 | 5
    funny: 1 | 2 | 3 | 4 | 5
    enthusiastic: 1 | 2 | 3 | 4 | 5
    emotional: 1 | 2 | 3 | 4 | 5
    irreverent: 1 | 2 | 3 | 4 | 5
    uses_jargon: 'no' | 'sometimes' | 'yes'
    shares_personal_stories: 'no' | 'sometimes' | 'yes'
    profanity_level: 'none' | 'light' | 'medium' | 'high'
    signature_phrases: [string, string, string]
    forbidden_words: [string, string, string]
    address_audience_as: string
  }

  visual: {
    colors: {
      primary: string
      secondary: string
      accent: string
      vibe: 'modern' | 'minimal' | 'bold' | 'warm' | 'luxury' | 'playful' | 'corporate'
    }
    typography: {
      primary_font: string
      secondary_font: string
      personality: 'clean' | 'bold' | 'classic' | 'playful' | 'modern'
    }
    style: {
      photo_video_style: 'lifestyle' | 'cinematic' | 'studio' | 'ugc' | 'documentary' | 'minimal'
      graphic_style: 'minimal' | 'bold' | 'clean' | 'editorial' | 'playful'
      editing_color_treatment: 'warm' | 'cool' | 'high_contrast' | 'clean' | 'moody'
    }
  }

  content_strategy: {
    content_pillars: Array<{
      name: string
      covers: string
      why_it_matters: string
    }>
    primary_content_goal: 'leads' | 'authority' | 'followers' | 'engagement' | 'education'
    desired_action: 'follow' | 'dm' | 'comment_keyword' | 'book_call' | 'visit_website'
    evergreen_topics: [string, string, string, string, string]
    myths: [
      { myth: string; truth: string },
      { myth: string; truth: string },
      { myth: string; truth: string },
    ]
    hot_takes: [string, string, string]
    must_include: {
      step_by_step: boolean
      educational_value: boolean
      call_to_actions: boolean
      personal_stories: boolean
      client_testimonials: boolean
      behind_the_scenes: boolean
      industry_insights: boolean
      specific_data_numbers: boolean
    }
    never_do: {
      income_claims: boolean
      name_competitors: boolean
      aggressive_sales: boolean
      overnight_results: boolean
      political: boolean
      fear_tactics: boolean
      overly_promotional: boolean
    }
    off_limits_topics: [string, string, string]
  }

  legal: {
    disclaimers: string
    compliance_requirements: string
  }

  competitors: [
    { name_or_handle: string; follower_count: string; does_well: string; does_poorly: string; differentiate: string },
    { name_or_handle: string; follower_count: string; does_well: string; does_poorly: string; differentiate: string },
    { name_or_handle: string; follower_count: string; does_well: string; does_poorly: string; differentiate: string },
  ]

  positioning: {
    market_position: 'premium' | 'mid_tier' | 'budget' | 'value_based'
    perception: 'industry_leader' | 'rising_star' | 'accessible_expert' | 'innovative_disruptor' | 'trusted_guide'
  }

  final: {
    excited: string
    nervous: string
    anything_else: string
    collaboration_style: 'hands_on' | 'collaborative' | 'hands_off'
  }
}

export function defaultBrandProfile(): BrandProfile {
  return {
    business: {
      mission: '',
      vision: '',
      problem_solved: '',
      differentiation: '',
      signature_offer: '',
    },
    audience: {
      age_range: '',
      gender: 'unspecified',
      location: '',
      work_roles: '',
      family_situation: '',
      core_values: '',
      fears: '',
      desires: '',
      hangouts: '',
      pain_points: ['', '', '', '', ''],
      tried_failed: '',
      objections: '',
      yes_triggers: '',
    },
    voice: {
      traits: '',
      casualness: 3,
      funny: 3,
      enthusiastic: 3,
      emotional: 3,
      irreverent: 3,
      uses_jargon: 'sometimes',
      shares_personal_stories: 'sometimes',
      profanity_level: 'none',
      signature_phrases: ['', '', ''],
      forbidden_words: ['', '', ''],
      address_audience_as: 'You',
    },
    visual: {
      colors: {
        primary: '#2B79F7',
        secondary: '#1E54B7',
        accent: '#143A80',
        vibe: 'modern',
      },
      typography: {
        primary_font: '',
        secondary_font: '',
        personality: 'modern',
      },
      style: {
        photo_video_style: 'documentary',
        graphic_style: 'clean',
        editing_color_treatment: 'clean',
      },
    },
    content_strategy: {
      content_pillars: [
        { name: '', covers: '', why_it_matters: '' },
        { name: '', covers: '', why_it_matters: '' },
        { name: '', covers: '', why_it_matters: '' },
      ],
      primary_content_goal: 'leads',
      desired_action: 'book_call',
      evergreen_topics: ['', '', '', '', ''],
      myths: [
        { myth: '', truth: '' },
        { myth: '', truth: '' },
        { myth: '', truth: '' },
      ],
      hot_takes: ['', '', ''],
      must_include: {
        step_by_step: true,
        educational_value: true,
        call_to_actions: true,
        personal_stories: true,
        client_testimonials: false,
        behind_the_scenes: true,
        industry_insights: true,
        specific_data_numbers: false,
      },
      never_do: {
        income_claims: true,
        name_competitors: true,
        aggressive_sales: true,
        overnight_results: true,
        political: true,
        fear_tactics: true,
        overly_promotional: true,
      },
      off_limits_topics: ['', '', ''],
    },
    legal: {
      disclaimers: '',
      compliance_requirements: '',
    },
    competitors: [
      { name_or_handle: '', follower_count: '', does_well: '', does_poorly: '', differentiate: '' },
      { name_or_handle: '', follower_count: '', does_well: '', does_poorly: '', differentiate: '' },
      { name_or_handle: '', follower_count: '', does_well: '', does_poorly: '', differentiate: '' },
    ],
    positioning: {
      market_position: 'value_based',
      perception: 'trusted_guide',
    },
    final: {
      excited: '',
      nervous: '',
      anything_else: '',
      collaboration_style: 'collaborative',
    },
  }
}

// --- ADD THIS BELOW defaultBrandProfile() ---

type Myth = { myth: string; truth: string }
type Competitor = {
  name_or_handle: string
  follower_count: string
  does_well: string
  does_poorly: string
  differentiate: string
}

function tuple3(values: readonly string[] | undefined, fallback: [string, string, string]): [string, string, string] {
  return [values?.[0] ?? fallback[0], values?.[1] ?? fallback[1], values?.[2] ?? fallback[2]]
}

function tuple5(
  values: readonly string[] | undefined,
  fallback: [string, string, string, string, string],
): [string, string, string, string, string] {
  return [
    values?.[0] ?? fallback[0],
    values?.[1] ?? fallback[1],
    values?.[2] ?? fallback[2],
    values?.[3] ?? fallback[3],
    values?.[4] ?? fallback[4],
  ]
}

function mythsTuple(values: readonly Myth[] | undefined, fallback: [Myth, Myth, Myth]): [Myth, Myth, Myth] {
  return [
    { ...fallback[0], ...(values?.[0] ?? {}) },
    { ...fallback[1], ...(values?.[1] ?? {}) },
    { ...fallback[2], ...(values?.[2] ?? {}) },
  ]
}

function competitorsTuple(
  values: readonly Competitor[] | undefined,
  fallback: [Competitor, Competitor, Competitor],
): [Competitor, Competitor, Competitor] {
  return [
    { ...fallback[0], ...(values?.[0] ?? {}) },
    { ...fallback[1], ...(values?.[1] ?? {}) },
    { ...fallback[2], ...(values?.[2] ?? {}) },
  ]
}

/**
 * Takes possibly incomplete data (from DB, API, loading state)
 * and returns a FULL BrandProfile with all nested objects present.
 */
export function normalizeBrandProfile(input?: Partial<BrandProfile> | null): BrandProfile {
  const d = defaultBrandProfile()
  const v = input ?? {}

  return {
    ...d,
    ...v,

    business: { ...d.business, ...v.business },

    audience: {
      ...d.audience,
      ...v.audience,
      pain_points: tuple5(v.audience?.pain_points, d.audience.pain_points),
    },

    voice: {
      ...d.voice,
      ...v.voice,
      signature_phrases: tuple3(v.voice?.signature_phrases, d.voice.signature_phrases),
      forbidden_words: tuple3(v.voice?.forbidden_words, d.voice.forbidden_words),
    },

    visual: {
      colors: { ...d.visual.colors, ...v.visual?.colors },
      typography: { ...d.visual.typography, ...v.visual?.typography },
      style: { ...d.visual.style, ...v.visual?.style },
    },

    content_strategy: {
      ...d.content_strategy,
      ...v.content_strategy,

      // content_pillars is a normal Array, so just fall back if missing
      content_pillars: v.content_strategy?.content_pillars ?? d.content_strategy.content_pillars,

      evergreen_topics: tuple5(v.content_strategy?.evergreen_topics, d.content_strategy.evergreen_topics),
      hot_takes: tuple3(v.content_strategy?.hot_takes, d.content_strategy.hot_takes),
      off_limits_topics: tuple3(v.content_strategy?.off_limits_topics, d.content_strategy.off_limits_topics),
      myths: mythsTuple(v.content_strategy?.myths, d.content_strategy.myths),

      must_include: { ...d.content_strategy.must_include, ...v.content_strategy?.must_include },
      never_do: { ...d.content_strategy.never_do, ...v.content_strategy?.never_do },
    },

    legal: { ...d.legal, ...v.legal },

    competitors: competitorsTuple(v.competitors, d.competitors),

    positioning: { ...d.positioning, ...v.positioning },

    final: { ...d.final, ...v.final },
  }
}
