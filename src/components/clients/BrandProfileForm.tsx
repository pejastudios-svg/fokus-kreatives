'use client'

import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { normalizeBrandProfile, type BrandProfile } from './brandProfile'

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}: <span className="font-semibold">{value}</span>/5</label>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
        className="w-full"
      />
    </div>
  )
}

export function BrandProfileForm({
  value,
  onChange,
}: {
  value?: Partial<BrandProfile> | null
  onChange: (next: BrandProfile) => void
}) {
 const bp = normalizeBrandProfile(value)

  const set = <K extends keyof BrandProfile>(key: K, nextValue: BrandProfile[K]) => {
    onChange({ ...bp, [key]: nextValue })
  }

  return (
    <div className="space-y-6">
      {/* Business */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Brand Foundations</h3>
          <p className="text-sm text-gray-500 mt-1">This feeds the AI with structured brand context (mission, differentiation, offer).</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Why does your business exist? (Mission)</label>
            <textarea
              value={bp.business.mission}
              onChange={(e) => set('business', { ...bp.business, mission: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Share your mission..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Where do you want to be in 3-5 years? (Vision)</label>
            <textarea
              value={bp.business.vision}
              onChange={(e) => set('business', { ...bp.business, vision: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Describe your vision..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What problem do you solve?</label>
            <textarea
              value={bp.business.problem_solved}
              onChange={(e) => set('business', { ...bp.business, problem_solved: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Describe the problem..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">What makes you different?</label>
              <textarea
                value={bp.business.differentiation}
                onChange={(e) => set('business', { ...bp.business, differentiation: e.target.value })}
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                placeholder="Unique value proposition..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">What’s your signature offer?</label>
              <textarea
                value={bp.business.signature_offer}
                onChange={(e) => set('business', { ...bp.business, signature_offer: e.target.value })}
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                placeholder="Describe your core offer..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target Audience */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Target Audience</h3>
          <p className="text-sm text-gray-500 mt-1">Psychographics matter: fears, desires, objections, triggers.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Age range"
            value={bp.audience.age_range}
            onChange={(e) => set('audience', { ...bp.audience, age_range: e.target.value })}
            placeholder="e.g., 25-45"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
            <select
              value={bp.audience.gender}
              onChange={(e) =>
  set('audience', {
    ...bp.audience,
    gender: e.target.value as BrandProfile['audience']['gender'],
  })
}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
            >
              <option value="unspecified">Unspecified / Mixed</option>
              <option value="male">Mostly male</option>
              <option value="female">Mostly female</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>

          <Input
            label="Where are they located?"
            value={bp.audience.location}
            onChange={(e) => set('audience', { ...bp.audience, location: e.target.value })}
            placeholder="e.g., USA, Global, Urban areas"
          />

          <Input
            label="What do they do for work?"
            value={bp.audience.work_roles}
            onChange={(e) => set('audience', { ...bp.audience, work_roles: e.target.value })}
            placeholder="Job titles or roles"
          />

          <Input
            label="Family situation"
            value={bp.audience.family_situation}
            onChange={(e) => set('audience', { ...bp.audience, family_situation: e.target.value })}
            placeholder="e.g., Parents, Single, Married"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Core values (what they care about)</label>
              <textarea
                value={bp.audience.core_values}
                onChange={(e) => set('audience', { ...bp.audience, core_values: e.target.value })}
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                placeholder="Their values..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Biggest fears</label>
              <textarea
                value={bp.audience.fears}
                onChange={(e) => set('audience', { ...bp.audience, fears: e.target.value })}
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                placeholder="What keeps them up at night..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Biggest desires</label>
            <textarea
              value={bp.audience.desires}
              onChange={(e) => set('audience', { ...bp.audience, desires: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Their aspirations..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Where do they hang out online?</label>
            <textarea
              value={bp.audience.hangouts}
              onChange={(e) => set('audience', { ...bp.audience, hangouts: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Platforms, communities..."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Top 5 Pain Points</label>
            {bp.audience.pain_points.map((p, idx) => (
              <Input
                key={idx}
                label={`Pain Point ${idx + 1}`}
                value={p}
                onChange={(e) => {
                  const copy = [...bp.audience.pain_points] as BrandProfile['audience']['pain_points']
                  copy[idx] = e.target.value
                  set('audience', { ...bp.audience, pain_points: copy })
                }}
              />
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"> What have they already tried that didn&apos;t work? </label>
            <textarea
              value={bp.audience.tried_failed}
              onChange={(e) => set('audience', { ...bp.audience, tried_failed: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Previous solutions..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Objections</label>
            <textarea
              value={bp.audience.objections}
              onChange={(e) => set('audience', { ...bp.audience, objections: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="Their hesitations..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What makes them say “YES!”?</label>
            <textarea
              value={bp.audience.yes_triggers}
              onChange={(e) => set('audience', { ...bp.audience, yes_triggers: e.target.value })}
              rows={3}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              placeholder="What converts them..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Voice */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Brand Voice & Personality</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Personality traits (comma-separated)"
            value={bp.voice.traits}
            onChange={(e) => set('voice', { ...bp.voice, traits: e.target.value })}
            placeholder="e.g., Professional, Friendly, Bold"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SliderRow label="Casual" value={bp.voice.casualness} onChange={(v) => set('voice', { ...bp.voice, casualness: v })} />
            <SliderRow label="Funny" value={bp.voice.funny} onChange={(v) => set('voice', { ...bp.voice, funny: v })} />
            <SliderRow label="Enthusiastic" value={bp.voice.enthusiastic} onChange={(v) => set('voice', { ...bp.voice, enthusiastic: v })} />
            <SliderRow label="Emotional" value={bp.voice.emotional} onChange={(v) => set('voice', { ...bp.voice, emotional: v })} />
            <SliderRow label="Irreverent" value={bp.voice.irreverent} onChange={(v) => set('voice', { ...bp.voice, irreverent: v })} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry jargon?</label>
              <select
                value={bp.voice.uses_jargon}
                onChange={(e) =>
  set('voice', {
    ...bp.voice,
    uses_jargon: e.target.value as BrandProfile['voice']['uses_jargon'],
  })
}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              >
                <option value="no">No</option>
                <option value="sometimes">Sometimes</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Share personal stories?</label>
              <select
                value={bp.voice.shares_personal_stories}
                onChange={(e) =>
  set('voice', {
    ...bp.voice,
    shares_personal_stories:
      e.target.value as BrandProfile['voice']['shares_personal_stories'],
  })
}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              >
                <option value="no">No</option>
                <option value="sometimes">Sometimes</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Profanity level</label>
              <select
                value={bp.voice.profanity_level}
                onChange={(e) =>
  set('voice', {
    ...bp.voice,
    profanity_level:
      e.target.value as BrandProfile['voice']['profanity_level'],
  })
}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              >
                <option value="none">None</option>
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <Input
            label="How do you address your audience?"
            value={bp.voice.address_audience_as}
            onChange={(e) => set('voice', { ...bp.voice, address_audience_as: e.target.value })}
            placeholder="e.g., You, We, Friends, Community"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Signature Phrases (3)</label>
              {bp.voice.signature_phrases.map((p, idx) => (
                <Input
                  key={idx}
                  label={`Phrase ${idx + 1}`}
                  value={p}
                  onChange={(e) => {
                    const copy = [...bp.voice.signature_phrases] as BrandProfile['voice']['signature_phrases']
                    copy[idx] = e.target.value
                    set('voice', { ...bp.voice, signature_phrases: copy })
                  }}
                />
              ))}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Forbidden Words/Phrases (3)</label>
              {bp.voice.forbidden_words.map((p, idx) => (
                <Input
                  key={idx}
                  label={`Word/Phrase ${idx + 1}`}
                  value={p}
                  onChange={(e) => {
                    const copy = [...bp.voice.forbidden_words] as BrandProfile['voice']['forbidden_words']
                    copy[idx] = e.target.value
                    set('voice', { ...bp.voice, forbidden_words: copy })
                  }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content Strategy */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Content Strategy</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary content goal</label>
            <select
              value={bp.content_strategy.primary_content_goal}
              onChange={(e) =>
  set('content_strategy', {
    ...bp.content_strategy,
    primary_content_goal:
      e.target.value as BrandProfile['content_strategy']['primary_content_goal'],
  })
}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
            >
              <option value="leads">Generate leads</option>
              <option value="authority">Build authority</option>
              <option value="followers">Grow followers</option>
              <option value="engagement">Boost engagement</option>
              <option value="education">Educate audience</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Desired action after content</label>
            <select
              value={bp.content_strategy.desired_action}
              onChange={(e) =>
  set('content_strategy', {
    ...bp.content_strategy,
    desired_action:
      e.target.value as BrandProfile['content_strategy']['desired_action'],
  })
}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
            >
              <option value="follow">Follow</option>
              <option value="dm">DM</option>
              <option value="comment_keyword">Comment keyword</option>
              <option value="book_call">Book call</option>
              <option value="visit_website">Visit website</option>
            </select>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Content Pillars (up to 5)</p>
            {bp.content_strategy.content_pillars.map((p, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <Input
                  label={`Pillar ${idx + 1} name`}
                  value={p.name}
                  onChange={(e) => {
                    const next = [...bp.content_strategy.content_pillars]
                    next[idx] = { ...next[idx], name: e.target.value }
                    set('content_strategy', { ...bp.content_strategy, content_pillars: next })
                  }}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">What this pillar covers</label>
                  <textarea
                    value={p.covers}
                    onChange={(e) => {
                      const next = [...bp.content_strategy.content_pillars]
                      next[idx] = { ...next[idx], covers: e.target.value }
                      set('content_strategy', { ...bp.content_strategy, content_pillars: next })
                    }}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Why it matters</label>
                  <textarea
                    value={p.why_it_matters}
                    onChange={(e) => {
                      const next = [...bp.content_strategy.content_pillars]
                      next[idx] = { ...next[idx], why_it_matters: e.target.value }
                      set('content_strategy', { ...bp.content_strategy, content_pillars: next })
                    }}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Positioning + Collaboration */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Positioning & Collaboration</h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Market position</label>
              <select
                value={bp.positioning.market_position}
                onChange={(e) =>
  set('positioning', {
    ...bp.positioning,
    market_position:
      e.target.value as BrandProfile['positioning']['market_position'],
  })
}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              >
                <option value="premium">Premium</option>
                <option value="mid_tier">Mid-tier</option>
                <option value="budget">Budget-friendly</option>
                <option value="value_based">Value-based</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">How you want to be perceived</label>
              <select
                value={bp.positioning.perception}
                onChange={(e) =>
  set('positioning', {
    ...bp.positioning,
    perception: e.target.value as BrandProfile['positioning']['perception'],
  })
}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
              >
                <option value="industry_leader">Industry leader</option>
                <option value="rising_star">Rising star</option>
                <option value="accessible_expert">Accessible expert</option>
                <option value="innovative_disruptor">Innovative disruptor</option>
                <option value="trusted_guide">Trusted guide</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Collaboration style</label>
            <select
              value={bp.final.collaboration_style}
              onChange={(e) =>
  set('final', {
    ...bp.final,
    collaboration_style:
      e.target.value as BrandProfile['final']['collaboration_style'],
  })
}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white"
            >
              <option value="hands_on">Very hands-on (approve everything)</option>
              <option value="collaborative">Collaborative (review + feedback)</option>
              <option value="hands_off">Hands-off (trust the process)</option>
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}