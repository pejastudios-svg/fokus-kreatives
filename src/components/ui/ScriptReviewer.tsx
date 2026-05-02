'use client'

import { useState } from 'react'
import { Copy, Check, ListChecks, X as XIcon } from 'lucide-react'

export type ScriptKind =
  | 'longform'
  | 'short'
  | 'carousel'
  | 'reel'
  | 'engagement'
  | 'story'
  | 'text'

interface ScriptReviewerProps {
  value: string
  onChange: (next: string) => void
  kind?: ScriptKind
  className?: string
  /** Override the textarea min-height. Defaults to 400px. */
  minHeight?: number
  /**
   * Hide the built-in Copy button. Use this when the parent component
   * already exposes a Copy action (e.g. in the package flow where the
   * ResultCard header has its own Copy button).
   */
  hideCopy?: boolean
}

/**
 * Editable script viewer with a side checklist of AI tells, structural
 * rules, and analysis-label cleanup. Used in both individual content
 * creation and the package flow so a human reviewer can clean the AI
 * output before saving / copying out.
 *
 * Edits flow back through `onChange` immediately, so the parent's state
 * always reflects what's in the textarea. There's no explicit save button
 * inside this component; saving (to DB or clipboard) is the parent's job.
 */
export function ScriptReviewer({
  value,
  onChange,
  kind,
  className,
  minHeight = 400,
  hideCopy = false,
}: ScriptReviewerProps) {
  const [showChecklist, setShowChecklist] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignored, copy failure is rare and not worth a toast here
    }
  }

  return (
    <div className={`flex flex-col lg:flex-row gap-3 ${className || ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              showChecklist
                ? 'border-[#2B79F7] text-[#2B79F7] bg-[#E8F0FE]'
                : 'border-[var(--border-primary)] hover:border-[#2B79F7] hover:text-[#2B79F7]'
            }`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            Review checklist
          </button>
          {!hideCopy && (
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[var(--border-primary)] hover:border-[#2B79F7] hover:text-[#2B79F7]"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
            Edits stay in the box. They get used the moment you copy or save.
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{ minHeight }}
          className="w-full max-h-[640px] p-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
        />
      </div>

      {showChecklist && (
        <ReviewChecklistPanel
          kind={kind}
          onClose={() => setShowChecklist(false)}
        />
      )}
    </div>
  )
}

function ReviewChecklistPanel({
  kind,
  onClose,
}: {
  kind?: ScriptKind
  onClose: () => void
}) {
  return (
    <aside className="lg:w-96 shrink-0 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 max-h-[640px] overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">How to review this script</h4>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          aria-label="Close checklist"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)] leading-snug mb-4">
        Walk through these in order. The model does most of the work, but it
        leaks the same handful of patterns, and a 60-second pass is what
        separates a script that sounds real from one people scroll past.
      </p>

      <Section title="1. Check the structure first">
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug mb-2">
          Before you read the actual lines, scan that every section header
          is doing its job. The model sometimes glues a header to the end of
          the previous paragraph, like{' '}
          <code className="text-[10px] bg-[var(--bg-tertiary)] px-1 rounded">
            ...understood. [CTA]
          </code>
          . When that happens the section stops reading as a separate beat.
          Move it to its own line with a blank line above and below.
        </p>
        <Item>
          Each <code>[SECTION_TAG]</code> sits on its own line, with a blank
          line above and below.
        </Item>
        <Item>
          <code>Slide N:</code> and <code>Frame N:</code> are also headers.
          The slide or frame content should be on the line BELOW, never glued
          to the header.
        </Item>
        <Item>
          Each tag appears exactly once. If you see <code>[CTA]</code> mid
          paragraph AND at the bottom, delete the inline one.
        </Item>
        <KindStructure kind={kind} />
      </Section>

      <Section title="2. Strip the analysis labels before client delivery">
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug mb-2">
          For longform scripts, you&apos;ll see internal labels like{' '}
          <code>CONTEXT:</code>, <code>APPLICATION:</code>,{' '}
          <code>FRAMING:</code>, <code>RE-HOOK:</code>, and{' '}
          <code>POINT N:</code> inside the body. Those are for you, not for
          the client. They help you confirm each beat does its job.{' '}
          <strong className="text-[var(--text-primary)]">
            Remove every one of them before sending the script over.
          </strong>{' '}
          The client only needs the prose.
        </p>
        <Item>
          Strip <code>CONTEXT:</code>, <code>APPLICATION:</code>,{' '}
          <code>FRAMING:</code>, <code>RE-HOOK:</code>,{' '}
          <code>POINT N:</code> labels.
        </Item>
        <Item>
          Strip <code>[OUTLINE]</code> if present (analysis only).
        </Item>
        <Item>
          Keep the bracket section tags the client expects:{' '}
          <code>[HOOK]</code>, <code>[CTA]</code>, etc., depending on what
          the client uses for their format.
        </Item>
      </Section>

      <Section title="3. Hunt the AI tells">
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug mb-2">
          These are the patterns that scream &ldquo;AI wrote this.&rdquo; Skim
          every paragraph and rewrite each one as a direct, positive claim or
          delete it.
        </p>
        <Item>
          <strong>&ldquo;isn&apos;t X, it&apos;s Y&rdquo;</strong> /{' '}
          <strong>&ldquo;you&apos;re not just X, you&apos;re Y&rdquo;</strong>
          . The single biggest tell. Cut the negation, keep only the positive
          half. Example fix: &ldquo;Your intro isn&apos;t a greeting, it&apos;s a
          5-part sequence&rdquo; becomes &ldquo;Your intro is a 5-part sequence.&rdquo;
        </Item>
        <Item>
          <strong>Rhetorical fragment-questions</strong> used as transitions:{' '}
          <code>&ldquo;The result?&rdquo;</code>,{' '}
          <code>&ldquo;The kicker?&rdquo;</code>,{' '}
          <code>&ldquo;Honestly?&rdquo;</code>,{' '}
          <code>&ldquo;Look,&rdquo;</code>,{' '}
          <code>&ldquo;Here&apos;s the thing&rdquo;</code>. Just say the next
          sentence. The transition is implied.
        </Item>
        <Item>
          <strong>&ldquo;Here&apos;s the truth / secret / wild truth&rdquo;</strong>
          . Same family. Drop the preamble; keep the claim.
        </Item>
        <Item>
          <strong>Paired or tripled adjectives</strong> like{' '}
          <code>&ldquo;consistent, engaging content&rdquo;</code> or{' '}
          <code>&ldquo;clear, valuable, actionable&rdquo;</code>. Pick the
          stronger one and cut the others.
        </Item>
        <Item>
          <strong>Em-dashes</strong>, the longer dash. Looks like this:
          &ldquo;The pattern &mdash; the one I use every day &mdash; just
          works.&rdquo; Replace with commas, periods, or recast the sentence.
          Plain hyphens in compound modifiers (5-part, lead-generating) are
          fine and stay.
        </Item>
        <Item>
          <strong>AI cliché vocab</strong>:{' '}
          <code>&ldquo;game-changer&rdquo;</code>,{' '}
          <code>&ldquo;leveraging&rdquo;</code>,{' '}
          <code>&ldquo;captivated&rdquo;</code>,{' '}
          <code>&ldquo;journey&rdquo;</code>,{' '}
          <code>&ldquo;pulling back the curtain&rdquo;</code>,{' '}
          <code>&ldquo;dive in&rdquo;</code>,{' '}
          <code>&ldquo;unlock&rdquo;</code>. Swap each for the plainest word
          the creator would actually say.
        </Item>
        <Item>
          <strong>Tag-question filler</strong> at the end of a sentence:{' '}
          <code>&ldquo;..., right?&rdquo;</code>. Convert to a period.
        </Item>
        <Item>
          <strong>Setup-payoff lines</strong> like{' '}
          <code>&ldquo;Here&apos;s why this matters:&rdquo;</code> or{' '}
          <code>&ldquo;The reason is simple:&rdquo;</code>. Cut the setup,
          keep the actual sentence.
        </Item>
      </Section>

      <Section title="4. Read it out loud (or in your head)">
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug mb-2">
          Does it sound like the creator talking, or like a polished blog
          post? If a sentence sounds like a LinkedIn comment, kill it.
        </p>
        <Item>
          Contractions everywhere (don&apos;t, won&apos;t, gonna,
          you&apos;re, I&apos;m). No &ldquo;do not,&rdquo; &ldquo;will not,&rdquo;
          &ldquo;going to.&rdquo;
        </Item>
        <Item>
          Sentence length varies. Three sentences in a row at similar length
          is a tell. Mix a 3-word fragment with a 22-word run.
        </Item>
        <Item>
          No invented numbers, clients, dates, results, or social proof that
          weren&apos;t in the brief. If you didn&apos;t give the AI a stat, it
          shouldn&apos;t be using one.
        </Item>
      </Section>

      <Section title="5. Final pass">
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug mb-2">
          The polish layer. Catch the little stuff that makes the script feel
          unfinished.
        </p>
        <Item>
          CTA matches the brief. If a verbatim CTA was given, it should
          appear word-for-word.
        </Item>
        <Item>
          Hashtags don&apos;t repeat, no glued tags like{' '}
          <code>#tipstips</code> or <code>#contentcontent</code>.
        </Item>
        <Item>
          Caption ends on a question or a hook. Generic closers like
          &ldquo;Stop X and start Y today&rdquo; should be rewritten.
        </Item>
      </Section>
    </aside>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-5 last:mb-0">
      <h5 className="text-xs font-semibold text-[var(--text-primary)] mb-1.5">{title}</h5>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[11px] text-[var(--text-secondary)] leading-snug">
      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#2B79F7] shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function KindStructure({ kind }: { kind?: ScriptKind }) {
  if (!kind) return null
  const map: Record<ScriptKind, string[]> = {
    longform: [
      '[TITLE]',
      '[HOOK]',
      '[SETUP]',
      '[ANTICIPATION]',
      '[TEACH]',
      '[REHOOK]',
      '[PAYOFF]',
      '[CTA]',
      '[PUBLISHING PACK] (HEADER, CAPTION, HASHTAGS)',
    ],
    short: [
      '[TITLE]',
      '[HOOK]',
      '[REHOOK]',
      '[CONNECT]',
      '[ENEMY]',
      '[REHOOK 2]',
      '[RELATE]',
      '[CLOSE]',
      '[CTA]',
      '[RELOOP]',
      '[PUBLISHING PACK]',
    ],
    reel: [
      'Same as short: hook, rehook, connect, enemy, close, CTA, reloop, then publishing pack.',
    ],
    carousel: [
      '[TITLE]',
      'Slide 1: hook',
      'Slide 2: rehook or promise',
      'Slides 3 to N-2: one idea per slide',
      'Second-to-last slide: framework summary',
      'Last slide: CTA',
      '[PUBLISHING PACK]',
    ],
    engagement: [
      '[TITLE]',
      '[TRIGGER]',
      '[CONTEXT]',
      '[BAIT]',
      '[ON-SCREEN TEXT]',
      '[CTA]',
      '[PUBLISHING PACK]',
    ],
    story: [
      '[TITLE]',
      'Frame 1 (Hook)',
      'Frame 2 (Value)',
      'Frame 3 (Rehook)',
      'Frame 4 (CTA)',
      'Frame 5 (Poll/Question), optional',
    ],
    text: ['[TITLE]', '[POST]'],
  }
  const sections = map[kind]
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-primary)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
        Required for this format
      </div>
      <ul className="space-y-0.5 text-[11px] text-[var(--text-secondary)]">
        {sections.map((s, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-[var(--text-tertiary)]">•</span>
            <code className="font-mono">{s}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}
