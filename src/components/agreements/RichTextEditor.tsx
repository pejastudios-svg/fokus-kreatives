'use client'

// Word-processor style editor for agreements: a paper page you type on
// directly, with a floating pill toolbar (formatting tools on the left,
// the page's action buttons docked on the right) and an "Insert field"
// menu that drops placeholder chips into the text.
//
// Inline formatting uses execCommand, but block-level tools (H1/H2/Aa)
// and clear-formatting do direct DOM surgery: execCommand's formatBlock
// and removeFormat are unreliable across browsers and leave styled spans
// behind, which is why those buttons used to look dead.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link2,
  RemoveFormatting,
  ChevronDown,
  Braces,
  Type,
  Copy,
  Pencil,
  Unlink,
  Baseline,
  Highlighter,
  Pipette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ListChecks,
  Minus,
  Plus,
  Search,
  ChevronUp,
  X,
  Undo2,
  Redo2,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { AGREEMENT_DOC_CSS, DOC_FONTS, DOC_FONTS_URL } from './docStyles'

export interface PlaceholderDef {
  key: string
  label: string
}

interface Props {
  value: string
  onChange: (html: string) => void
  placeholders: PlaceholderDef[]
  /** Identity of the document being edited (draft/template id). External
   *  content loads ONLY when this changes - never mid-session. */
  docKey?: string
  /** Action buttons docked at the right end of the toolbar pill. */
  actions?: ReactNode
}

const BLOCK_TAGS = /^(H1|H2|H3|H4|P|DIV|BLOCKQUOTE|PRE|LI)$/

// Swatches picked to read well on the white document page.
const TEXT_COLORS = [
  '#111827', '#374151', '#6B7280', '#9CA3AF', '#B91C1C',
  '#DC2626', '#EA580C', '#D97706', '#CA8A04', '#15803D',
  '#16A34A', '#0D9488', '#0891B2', '#1D4ED8', '#2563EB',
  '#4F46E5', '#7C3AED', '#9333EA', '#DB2777', '#E11D48',
]
const HIGHLIGHT_COLORS = [
  '#FEF08A', '#FDE68A', '#FED7AA', '#FFEDD5', '#FECACA',
  '#FFE4E6', '#FBCFE8', '#F5D0FE', '#DDD6FE', '#EDE9FE',
  '#C7D2FE', '#BFDBFE', '#A5F3FC', '#CFFAFE', '#99F6E4',
  '#BBF7D0', '#D9F99D', '#ECFCCB', '#E5E7EB', '#D1D5DB',
]

/** Replace an element with its own children. */
function unwrap(el: Element) {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}

function nearestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let n: Node | null = node
  while (n && n !== root) {
    if (n instanceof HTMLElement && BLOCK_TAGS.test(n.tagName)) return n
    n = n.parentNode
  }
  return null
}

/** Leaf block elements the current selection actually covers. */
function selectedBlocks(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return []
  const range = sel.getRangeAt(0)
  const start = nearestBlock(range.startContainer, root)
  const end = nearestBlock(range.endContainer, root)
  if (start && (start === end || !end)) return [start]
  let blocks: HTMLElement[] = []
  root.querySelectorAll('h1,h2,h3,h4,p,div,blockquote,pre,li').forEach((el) => {
    if (
      range.intersectsNode(el) &&
      !el.querySelector('h1,h2,h3,h4,p,div,blockquote,pre,li')
    ) {
      blocks.push(el as HTMLElement)
    }
  })
  // Drop blocks the selection only TOUCHES at a zero-width boundary.
  // Dragging to a line's end parks the selection at the START of the next
  // block - formatting must not bleed into it (nor into a block whose very
  // end is where the selection begins).
  if (blocks.length > 1) {
    blocks = blocks.filter((el) => {
      if (end && (el === end || end.contains(el))) {
        const pre = document.createRange()
        pre.selectNodeContents(end)
        pre.setEnd(range.endContainer, range.endOffset)
        if (pre.toString() === '') return false
      }
      if (start && (el === start || start.contains(el))) {
        const post = document.createRange()
        post.selectNodeContents(start)
        post.setStart(range.startContainer, range.startOffset)
        if (post.toString() === '') return false
      }
      return true
    })
  }
  if (blocks.length === 0 && start) return [start]
  return blocks
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

const NON_PARA_BLOCKS = /^(UL|OL|TABLE|HR)$/

/** Typed + pasted content often leaves text nodes and inline spans sitting
 *  DIRECTLY under the editor root with no paragraph around them. The block
 *  tools can't retag what isn't a block - the old "Aa/Tx do nothing" bug -
 *  so wrap those loose runs into <p> first. Selection follows the moved
 *  nodes automatically. */
function wrapLooseInlines(root: HTMLElement) {
  const isBlockish = (n: Node) =>
    n instanceof HTMLElement &&
    (BLOCK_TAGS.test(n.tagName) || NON_PARA_BLOCKS.test(n.tagName))
  let run: Node[] = []
  const flush = (before: Node | null) => {
    if (run.length === 0) return
    const meaningful = run.some(
      (n) => !(n instanceof Text) || (n.textContent || '').trim() !== '',
    )
    if (!meaningful) {
      run = []
      return
    }
    const p = document.createElement('p')
    root.insertBefore(p, before)
    for (const n of run) p.appendChild(n)
    run = []
  }
  for (const n of Array.from(root.childNodes)) {
    if (isBlockish(n)) flush(n)
    else run.push(n)
  }
  flush(null)
}

function makeCheckbox(): HTMLElement {
  const box = document.createElement('span')
  box.setAttribute('data-checkbox', '')
  box.setAttribute('contenteditable', 'false')
  return box
}

/** Structural invariants for checklists, enforced on EVERY change:
 *  a checkbox exists exactly once, as the first child of a checklist <li>;
 *  every checklist <li> has one; empty checklist <ul>s are removed. Edits
 *  that drag boxes around (merges, splits, clears) get repaired here, and
 *  the CSS gate hides anything mid-flight. */
function sanitizeChecklists(root: HTMLElement) {
  Array.from(root.querySelectorAll('[data-checkbox]')).forEach((box) => {
    const li = box.parentElement
    const valid =
      li?.tagName === 'LI' &&
      li.parentElement?.hasAttribute('data-checklist') &&
      li.firstChild === box
    if (!valid) box.remove()
  })
  Array.from(root.querySelectorAll('ul[data-checklist] > li')).forEach((li) => {
    const first = li.firstChild
    if (!(first instanceof HTMLElement && first.hasAttribute('data-checkbox'))) {
      li.insertBefore(makeCheckbox(), li.firstChild)
    }
    if (!li.hasAttribute('data-checked')) li.setAttribute('data-checked', 'false')
    // An item holding only its checkbox needs a <br> so it keeps a line box
    // and its absolute checkbox can never paint over the line below.
    if (li.childNodes.length === 1) li.appendChild(document.createElement('br'))
  })
  Array.from(root.querySelectorAll('ul[data-checklist]')).forEach((ul) => {
    if (!ul.querySelector('li')) ul.remove()
  })
}

/** Two identical lists sitting directly next to each other read as one -
 *  merge them (this is what deleting the line between two lists produces). */
function mergeAdjacentLists(root: HTMLElement) {
  Array.from(root.querySelectorAll('ul, ol')).forEach((list) => {
    const next = list.nextElementSibling
    if (
      next &&
      next.tagName === list.tagName &&
      next.hasAttribute('data-checklist') === list.hasAttribute('data-checklist')
    ) {
      while (next.firstChild) list.appendChild(next.firstChild)
      next.remove()
    }
  })
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// execCommand treats chips (contenteditable=false) as inert islands and
// skips them, so every inline tool mirrors its effect onto chips by hand.
const INLINE_CMDS = new Set(['bold', 'italic', 'underline', 'strikeThrough'])

function chipsInSelection(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return []
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-ph]')).filter((chip) =>
    range.intersectsNode(chip),
  )
}

/** True when the selection touches text OUTSIDE chips. When it does not,
 *  execCommand was a no-op and the chips themselves decide the toggle. */
function selectionHasEditableText(root: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (!range.intersectsNode(n)) continue
    if ((n.parentElement as HTMLElement | null)?.closest('[data-ph]')) continue
    if ((n.textContent || '').length > 0) return true
  }
  return false
}

function chipHasInline(chip: HTMLElement, command: string): boolean {
  if (command === 'bold') return chip.style.fontWeight !== ''
  if (command === 'italic') return chip.style.fontStyle === 'italic'
  if (command === 'underline') return chip.style.textDecorationLine.includes('underline')
  if (command === 'strikeThrough') return chip.style.textDecorationLine.includes('line-through')
  return false
}

function setChipInline(chip: HTMLElement, command: string, on: boolean) {
  // Chips sit at weight 600 by default, so bold goes to 800 to read clearly.
  if (command === 'bold') chip.style.fontWeight = on ? '800' : ''
  else if (command === 'italic') chip.style.fontStyle = on ? 'italic' : ''
  else {
    const line = command === 'underline' ? 'underline' : 'line-through'
    const cur = chip.style.textDecorationLine.split(/\s+/).filter(Boolean)
    const next = on ? (cur.includes(line) ? cur : [...cur, line]) : cur.filter((l) => l !== line)
    chip.style.textDecorationLine = next.join(' ')
  }
}

export function RichTextEditor({ value, onChange, placeholders, docKey, actions }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<
    | 'fields'
    | 'fonts'
    | 'link'
    | 'textColor'
    | 'highlight'
    | 'blocks'
    | 'lists'
    | 'align'
    | 'find'
    | 'mFormat'
    | 'mParagraph'
    | 'mInsert'
    | null
  >(null)
  const [findQuery, setFindQuery] = useState('')
  const [findTotal, setFindTotal] = useState(0)
  const [findIdx, setFindIdx] = useState(0)
  const [fontSizePx, setFontSizePx] = useState(15)
  // Size field draft while the user types into it (null = not editing).
  const [sizeDraft, setSizeDraft] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [fontQuery, setFontQuery] = useState('')
  const [active, setActive] = useState<Record<string, boolean>>({})
  // Floating mini-toolbar shown when hovering a link in the document.
  const [hoverLink, setHoverLink] = useState<{ el: HTMLAnchorElement; top: number; left: number } | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menusRef = useRef<HTMLDivElement>(null)
  // Last selection inside the editor. Clicking toolbar menus moves focus,
  // so commands restore this before acting - it's what keeps "Insert field"
  // landing inline at the caret instead of somewhere else.
  const savedRangeRef = useRef<Range | null>(null)
  // Link being edited via the hover toolbar (vs creating a new one).
  const editingLinkRef = useRef<HTMLAnchorElement | null>(null)
  // While the font menu is open, hovering an option applies it to the
  // selection as a live preview (one undo entry) - reverted unless picked.
  const fontPreviewActive = useRef(false)

  // ----- undo / redo -----
  // The browser's native undo stack can't follow our DOM surgery (fields,
  // headings, checklists, sanitizing) - that's what made Cmd+Z corrupt the
  // document. The editor owns a snapshot history instead: changes batch
  // into steps (400ms), capped at 100 entries.
  const historyRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 })
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false })

  const pushHistoryNow = useCallback((html: string) => {
    const h = historyRef.current
    if (h.stack[h.idx] === html) return
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push(html)
    if (h.stack.length > 100) h.stack.shift()
    h.idx = h.stack.length - 1
    setHistState({ canUndo: h.idx > 0, canRedo: false })
  }, [])

  // External content loads ONLY when the document identity changes (mount,
  // or opening a different draft/template). It must NEVER track `value`:
  // the parent echoes our own emitted html back, and any rewrite of
  // innerHTML during a live session (e.g. while focus is in a toolbar
  // input) detaches the caret and saved selection - the visible block
  // looks fine but keystrokes go to dead nodes and "typing stops".
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value
      savedRangeRef.current = null
      historyRef.current = { stack: [], idx: -1 }
    }
    if (historyRef.current.stack.length === 0 && value) {
      const t = setTimeout(() => pushHistoryNow(value), 0)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menusRef.current && !menusRef.current.contains(e.target as Node)) {
        // Closing the font menu by clicking away must also revert any
        // hovered-but-not-picked font preview.
        if (fontPreviewActive.current) {
          document.execCommand('undo')
          fontPreviewActive.current = false
        }
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Caret tracking + tool highlighting. Extracted so actions that change
  // formatting WITHOUT moving the selection (alignment, lists, headings)
  // can refresh the badges too - selectionchange alone never fires then.
  const refreshActiveStates = useCallback(() => {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
        // Real selection activity back in the canvas ends any toolbar hold.
        const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
        highlights?.delete?.('fk-selhold')
        const range = sel.getRangeAt(0)
        savedRangeRef.current = range.cloneRange()
        // Keep the size widget showing the size of the selected text. Resolve
        // the node AT the range start - when a resize re-selects its spans,
        // the start container is the parent block, and measuring the parent
        // would stomp the just-applied size back to the old value.
        let n: Node | null = range.startContainer
        if (n instanceof HTMLElement && range.startOffset < n.childNodes.length) {
          n = n.childNodes[range.startOffset]
        }
        const el = n instanceof HTMLElement ? n : n?.parentElement || null
        if (el) {
          const px = Math.round(parseFloat(getComputedStyle(el).fontSize))
          if (px > 0) setFontSizePx(px)
        }
      }
      try {
        // Walk up from the caret so list/heading buttons light up whenever
        // the selection sits inside content with that tool's attributes.
        let listKind: 'ul' | 'ol' | 'check' | null = null
        let heading = ''
        let n: Node | null = sel?.anchorNode || null
        while (n && n !== editorRef.current) {
          if (n instanceof HTMLElement) {
            if (!listKind && n.tagName === 'LI') {
              const pl = n.parentElement
              if (pl?.hasAttribute('data-checklist')) listKind = 'check'
              else if (pl?.tagName === 'OL') listKind = 'ol'
              else if (pl?.tagName === 'UL') listKind = 'ul'
            }
            if (!heading && /^(H1|H2)$/.test(n.tagName)) heading = n.tagName
          }
          n = n.parentNode
        }
        setActive({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strikeThrough: document.queryCommandState('strikeThrough'),
          ul: listKind === 'ul',
          ol: listKind === 'ol',
          check: listKind === 'check',
          h1: heading === 'H1',
          h2: heading === 'H2',
          alignLeft: document.queryCommandState('justifyLeft'),
          alignCenter: document.queryCommandState('justifyCenter'),
          alignRight: document.queryCommandState('justifyRight'),
          alignFull: document.queryCommandState('justifyFull'),
        })
      } catch {
        /* queryCommandState can throw on detached selections */
      }
  }, [])

  useEffect(() => {
    const onSel = () => refreshActiveStates()
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [refreshActiveStates])

  const serialize = useCallback(() => {
    const el = editorRef.current
    if (!el) return ''
    // Keep the document structurally sound on every change.
    sanitizeChecklists(el)
    mergeAdjacentLists(el)
    // Find-highlight marks are a view-only overlay - never save them.
    if (el.querySelector('mark[data-find]')) {
      const clone = el.cloneNode(true) as HTMLElement
      Array.from(clone.querySelectorAll('mark[data-find]')).forEach(unwrap)
      return clone.innerHTML
    }
    return el.innerHTML
  }, [])

  const emit = useCallback(() => {
    if (!editorRef.current) return
    const html = serialize()
    onChange(html)
    if (histTimer.current) clearTimeout(histTimer.current)
    histTimer.current = setTimeout(() => pushHistoryNow(html), 400)
    // Every action lands here - keep the toolbar badges in sync even when
    // the selection itself didn't move (alignment, list toggles, ...).
    refreshActiveStates()
  }, [onChange, serialize, pushHistoryNow, refreshActiveStates])

  // ----- selection hold -----
  // While focus sits in a toolbar input, the browser drops the editor's
  // native selection. Repaint it with the CSS Custom Highlight API (no DOM
  // mutation) so the text stays visibly selected until the user actually
  // clicks back into the canvas - same as Docs. No-ops on old browsers.
  const clearSelectionHold = useCallback(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    highlights?.delete?.('fk-selhold')
  }, [])

  const holdSelection = useCallback(() => {
    // Only needed while focus is OUTSIDE the editor - with focus inside,
    // the native selection paints itself.
    if (document.activeElement === editorRef.current) return
    const r = savedRangeRef.current
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
      .Highlight
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    if (!r || r.collapsed || !HighlightCtor || !highlights) return
    highlights.set('fk-selhold', new HighlightCtor(r.cloneRange()))
  }, [])

  /** Re-select a span of transformed blocks (and remember it), so applying
   *  a block tool never throws the user's highlight away. */
  const selectAcross = useCallback((first: HTMLElement, last: HTMLElement) => {
    const r = document.createRange()
    const skipBox =
      first.firstChild instanceof HTMLElement && first.firstChild.hasAttribute('data-checkbox')
    r.setStart(first, skipBox ? 1 : 0)
    r.setEnd(last, last.childNodes.length)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    savedRangeRef.current = r.cloneRange()
  }, [])

  const restoreSelection = useCallback(() => {
    clearSelectionHold()
    const r = savedRangeRef.current
    if (!r) return
    // A range whose nodes left the document (block replaced/removed) must
    // never be restored - commands would run against dead nodes and look
    // like the editor swallowed the action.
    const anchor = r.commonAncestorContainer
    if (!anchor.isConnected || !editorRef.current?.contains(anchor)) {
      savedRangeRef.current = null
      return
    }
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }, [clearSelectionHold])

  const applyHistory = useCallback(
    (html: string) => {
      const root = editorRef.current
      if (!root) return
      root.innerHTML = html
      savedRangeRef.current = null
      clearSelectionHold()
      root.focus()
      placeCaretAtEnd(root)
      onChange(html)
      const h = historyRef.current
      setHistState({ canUndo: h.idx > 0, canRedo: h.idx < h.stack.length - 1 })
      refreshActiveStates()
    },
    [onChange, clearSelectionHold, refreshActiveStates],
  )

  const undo = useCallback(() => {
    if (histTimer.current) clearTimeout(histTimer.current)
    // Capture any change still waiting on the batch timer first.
    pushHistoryNow(serialize())
    const h = historyRef.current
    if (h.idx <= 0) return
    h.idx--
    applyHistory(h.stack[h.idx])
  }, [pushHistoryNow, serialize, applyHistory])

  const redo = useCallback(() => {
    const h = historyRef.current
    if (h.idx >= h.stack.length - 1) return
    h.idx++
    applyHistory(h.stack[h.idx])
  }, [applyHistory])

  const exec = useCallback(
    (command: string, arg?: string) => {
      const root = editorRef.current
      root?.focus()
      document.execCommand(command, false, arg)
      if (root && INLINE_CMDS.has(command)) {
        const chips = chipsInSelection(root)
        if (chips.length > 0) {
          let on = false
          try {
            on = document.queryCommandState(command)
          } catch {
            /* detached selection */
          }
          if (!selectionHasEditableText(root)) {
            on = !chips.every((c) => chipHasInline(c, command))
          }
          chips.forEach((c) => setChipInline(c, command, on))
        }
      }
      emit()
    },
    [emit],
  )

  // H1 / H2 / Aa: swap the selected blocks' tags directly. For Aa (normal
  // text) also strip font-size/line-height overrides - pasted headings
  // usually carry styled spans that would otherwise keep their size and
  // make the conversion look like it did nothing.
  const setBlockTag = useCallback(
    (tag: 'h1' | 'h2' | 'p') => {
      const root = editorRef.current
      if (!root) return
      root.focus()
      restoreSelection()
      wrapLooseInlines(root)
      const blocks = selectedBlocks(root)
      if (blocks.length === 0) {
        document.execCommand('formatBlock', false, `<${tag}>`)
        emit()
        return
      }
      let first: HTMLElement | null = null
      let last: HTMLElement | null = null
      for (const b of blocks) {
        if (b.tagName === 'LI') continue // keep list structure intact
        const el = document.createElement(tag)
        while (b.firstChild) el.appendChild(b.firstChild)
        b.replaceWith(el)
        Array.from(el.querySelectorAll<HTMLElement>('[style]')).forEach((d) => {
          if (d.hasAttribute('data-ph')) return
          d.style.fontSize = ''
          d.style.lineHeight = ''
          if (tag !== 'p') d.style.fontWeight = ''
        })
        if (!first) first = el
        last = el
      }
      if (first && last) selectAcross(first, last)
      emit()
    },
    [emit, restoreSelection, selectAcross],
  )

  // Tx: strip inline styles/tags in the touched blocks, then reset the
  // block itself to a normal paragraph. Placeholder chips stay but lose
  // any formatting, like the rest of the text.
  const clearFormatting = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    root.focus()
    restoreSelection()
    wrapLooseInlines(root)
    const blocks = selectedBlocks(root)
    if (blocks.length === 0) return
    let first: HTMLElement | null = null
    let last: HTMLElement | null = null
    for (const b of blocks) {
      b.removeAttribute('style')
      Array.from(b.querySelectorAll<HTMLElement>('[style]')).forEach((el) => {
        el.removeAttribute('style')
      })
      Array.from(b.querySelectorAll('font, b, strong, i, em, u, strike, s')).forEach(unwrap)
      Array.from(b.querySelectorAll('span:not([data-ph])')).forEach(unwrap)
      if (b.tagName !== 'P' && b.tagName !== 'LI') {
        const p = document.createElement('p')
        while (b.firstChild) p.appendChild(b.firstChild)
        b.replaceWith(p)
        if (!first) first = p
        last = p
      } else {
        if (!first) first = b
        last = b
      }
    }
    if (first && last) selectAcross(first, last)
    emit()
  }, [emit, restoreSelection, selectAcross])

  const previewFont = useCallback(
    (fontValue: string) => {
      const root = editorRef.current
      if (!root) return
      root.focus()
      restoreSelection()
      if (fontPreviewActive.current) {
        document.execCommand('undo')
        fontPreviewActive.current = false
      }
      if (fontValue) {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) {
          document.execCommand('fontName', false, fontValue)
          fontPreviewActive.current = true
        }
      }
    },
    [restoreSelection],
  )

  const clearFontPreview = useCallback(() => {
    if (fontPreviewActive.current) {
      document.execCommand('undo')
      fontPreviewActive.current = false
    }
  }, [])

  const setFont = useCallback(
    (fontValue: string) => {
      const root = editorRef.current
      if (!root) return
      clearFontPreview()
      root.focus()
      restoreSelection()
      if (fontValue) {
        document.execCommand('fontName', false, fontValue)
        chipsInSelection(root).forEach((c) => {
          c.style.fontFamily = fontValue
        })
      } else {
        // Default: peel font-family off the touched blocks.
        for (const b of selectedBlocks(root)) {
          b.style.fontFamily = ''
          Array.from(b.querySelectorAll<HTMLElement>('[style]')).forEach((el) => {
            el.style.fontFamily = ''
          })
          Array.from(b.querySelectorAll('font[face]')).forEach(unwrap)
        }
      }
      setOpenMenu(null)
      setFontQuery('')
      emit()
      holdSelection()
    },
    [emit, restoreSelection, clearFontPreview, holdSelection],
  )

  // ----- checklist -----
  // Converts the selected blocks into checklist items. Clicking the box
  // toggles data-checked (grey + strikethrough via the doc CSS); Enter
  // continues the list, Enter on an empty item exits it.
  const insertChecklist = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    root.focus()
    restoreSelection()
    wrapLooseInlines(root)
    const blocks = selectedBlocks(root)
    if (blocks.length === 0) return
    let firstLi: HTMLElement | null = null
    let lastLi: HTMLElement | null = null

    // Inside a bullet/numbered list: the checklist REPLACES that list.
    const memberLis = blocks.filter(
      (b) => b.tagName === 'LI' && !b.parentElement?.hasAttribute('data-checklist'),
    )
    if (memberLis.length > 0) {
      const lists = Array.from(new Set(memberLis.map((li) => li.parentElement!)))
      for (const list of lists) {
        const ul = document.createElement('ul')
        ul.setAttribute('data-checklist', '')
        Array.from(list.children).forEach((item) => {
          const li = document.createElement('li')
          li.setAttribute('data-checked', 'false')
          li.appendChild(makeCheckbox())
          while (item.firstChild) li.appendChild(item.firstChild)
          ul.appendChild(li)
          if (!firstLi) firstLi = li
          lastLi = li
        })
        list.replaceWith(ul)
      }
    } else {
      const plain = blocks.filter((b) => b.tagName !== 'LI')
      if (plain.length === 0) return
      const ul = document.createElement('ul')
      ul.setAttribute('data-checklist', '')
      plain[0].parentNode?.insertBefore(ul, plain[0])
      for (const b of plain) {
        const li = document.createElement('li')
        li.setAttribute('data-checked', 'false')
        li.appendChild(makeCheckbox())
        while (b.firstChild) li.appendChild(b.firstChild)
        ul.appendChild(li)
        b.remove()
        if (!firstLi) firstLi = li
        lastLi = li
      }
    }
    if (firstLi && lastLi) selectAcross(firstLi, lastLi)
    setOpenMenu(null)
    emit()
  }, [emit, restoreSelection, selectAcross])

  // Clicking the page's empty padding (target is the page itself, not a
  // text block) used to let the browser guess - often dumping the caret at
  // the very start of the document. Canvas rule: the caret goes to the END
  // of the nearest line above the click, where writing can continue.
  const onEditorMouseDown = useCallback((e: React.MouseEvent) => {
    const root = editorRef.current
    if (!root || e.target !== root) return
    const blocks = Array.from(root.children).filter(
      (b): b is HTMLElement => b instanceof HTMLElement,
    )
    if (blocks.length === 0) return
    let target: HTMLElement | null = null
    for (const b of blocks) {
      if (e.clientY >= b.getBoundingClientRect().top) target = b
      else break
    }
    if (!target) target = blocks[0]
    e.preventDefault()
    root.focus()
    placeCaretAtEnd(target)
  }, [])

  const onEditorClick = useCallback(
    (e: React.MouseEvent) => {
      const box = (e.target as HTMLElement).closest?.('[data-checkbox]')
      if (!box) return
      const li = box.closest('li')
      if (!li) return
      e.preventDefault()
      li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true')
      emit()
    },
    [emit],
  )

  const onEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Editor-owned history replaces the (incoherent) native undo stack.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      const root = editorRef.current
      const sel = window.getSelection()
      if (!root || !sel || sel.rangeCount === 0) return

      const findLi = (checklistOnly: boolean): HTMLElement | null => {
        let node: Node | null = sel.anchorNode
        while (node && node !== root) {
          if (
            node instanceof HTMLElement &&
            node.tagName === 'LI' &&
            (!checklistOnly || node.parentElement?.hasAttribute('data-checklist'))
          ) {
            return node
          }
          node = node.parentNode
        }
        return null
      }

      // Backspace on an EMPTY list item (any list type), Docs-style: the
      // bullet clears and leaves a plain empty line in its place, splitting
      // the list. The next backspace merges up; adjacent identical lists
      // re-join automatically via mergeAdjacentLists.
      if (e.key === 'Backspace') {
        const li = findLi(false)
        if (!li) {
          // Step 2 of the Docs flow: backspace on the EMPTY line that an
          // emptied bullet left behind merges it upward. Chrome's default
          // merge misfires against checklist items (their first child is
          // non-editable), so handle it for every list type ourselves.
          const block = nearestBlock(sel.anchorNode, root)
          if (
            block &&
            block.tagName === 'P' &&
            (block.textContent || '').trim() === '' &&
            block.previousElementSibling &&
            /^(UL|OL)$/.test(block.previousElementSibling.tagName)
          ) {
            e.preventDefault()
            const prevList = block.previousElementSibling as HTMLElement
            const lastLi = prevList.querySelector(':scope > li:last-child') as HTMLElement | null
            block.remove()
            if (lastLi) placeCaretAtEnd(lastLi)
            emit()
          }
          return
        }
        // Docs behavior: backspace with NOTHING before the caret in the
        // item (start of item, or an empty item - including the first item
        // a list was started from) removes the bullet/checkbox and turns
        // the item into a plain paragraph in place, keeping its text.
        const r0 = sel.getRangeAt(0)
        if (!r0.collapsed) return
        const before = document.createRange()
        before.selectNodeContents(li)
        before.setEnd(r0.startContainer, r0.startOffset)
        const beforeFrag = before.cloneContents()
        Array.from(beforeFrag.querySelectorAll('[data-checkbox]')).forEach((b) => b.remove())
        if ((beforeFrag.textContent || '').trim() !== '') return // mid-text: default
        e.preventDefault()
        const list = li.parentElement as HTMLElement
        const after: Element[] = []
        let sib = li.nextElementSibling
        while (sib) {
          after.push(sib)
          sib = sib.nextElementSibling
        }
        const p = document.createElement('p')
        Array.from(li.childNodes).forEach((n) => {
          if (n instanceof HTMLElement && n.hasAttribute('data-checkbox')) return
          p.appendChild(n)
        })
        if (!p.firstChild) p.appendChild(document.createElement('br'))
        list.parentNode?.insertBefore(p, list.nextSibling)
        if (after.length > 0) {
          const tail = list.cloneNode(false) as HTMLElement
          after.forEach((x) => tail.appendChild(x))
          p.parentNode?.insertBefore(tail, p.nextSibling)
        }
        li.remove()
        if (!list.querySelector('li')) list.remove()
        const r = document.createRange()
        r.setStart(p, 0)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
        emit()
        return
      }

      if (e.key !== 'Enter' || e.shiftKey) return
      const li = findLi(true)
      if (!li) return
      e.preventDefault()
      const textLeft = (li.textContent || '').trim()
      const ul = li.parentElement as HTMLElement
      if (!textLeft) {
        // Empty item: exit the checklist into a fresh paragraph.
        const p = document.createElement('p')
        p.appendChild(document.createElement('br'))
        ul.parentNode?.insertBefore(p, ul.nextSibling)
        li.remove()
        if (ul.children.length === 0) ul.remove()
        const r = document.createRange()
        r.setStart(p, 0)
        r.collapse(true)
        sel.removeAllRanges()
        sel.addRange(r)
      } else {
        // Split: everything after the caret moves into the new item.
        const newLi = document.createElement('li')
        newLi.setAttribute('data-checked', 'false')
        const box = document.createElement('span')
        box.setAttribute('data-checkbox', '')
        box.setAttribute('contenteditable', 'false')
        newLi.appendChild(box)
        const r = sel.getRangeAt(0)
        const tail = document.createRange()
        tail.setStart(r.startContainer, r.startOffset)
        tail.setEndAfter(li.lastChild as Node)
        newLi.appendChild(tail.extractContents())
        // An item holding only its checkbox has no line box - give the
        // caret a <br> to live on so it doesn't drift to the row above.
        if ((newLi.textContent || '').trim() === '') {
          newLi.appendChild(document.createElement('br'))
        }
        ul.insertBefore(newLi, li.nextSibling)
        const caret = document.createRange()
        caret.setStart(newLi, 1) // right after the checkbox
        caret.collapse(true)
        sel.removeAllRanges()
        sel.addRange(caret)
      }
      emit()
    },
    [emit, undo, redo],
  )

  // ----- font size -----
  // execCommand only knows sizes 1-7, so apply 7 as a marker and rewrite
  // the resulting <font> tags into precise pixel spans.
  const applyFontSizePx = useCallback(
    (px: number) => {
      const root = editorRef.current
      if (!root) return
      const clamped = Math.min(96, Math.max(8, px))
      root.focus()
      restoreSelection()
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setFontSizePx(clamped)
        return
      }
      const chips = chipsInSelection(root)
      document.execCommand('fontSize', false, '7')
      chips.forEach((c) => {
        c.style.fontSize = `${clamped}px`
      })
      const spans: HTMLElement[] = []
      Array.from(root.querySelectorAll('font[size="7"]')).forEach((f) => {
        const span = document.createElement('span')
        span.style.fontSize = `${clamped}px`
        while (f.firstChild) span.appendChild(f.firstChild)
        f.replaceWith(span)
        spans.push(span)
      })
      // Re-select the resized text and re-save the range, so +/- can be
      // tapped repeatedly without the selection collapsing after each step.
      // A chip-only selection produces no font tags; it is already styled.
      if (spans.length > 0) {
        const range = document.createRange()
        range.setStartBefore(spans[0])
        range.setEndAfter(spans[spans.length - 1])
        sel.removeAllRanges()
        sel.addRange(range)
        savedRangeRef.current = range.cloneRange()
      }
      setFontSizePx(clamped)
      emit()
    },
    [emit, restoreSelection],
  )

  // ----- find in document -----
  const clearFind = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    Array.from(root.querySelectorAll('mark[data-find]')).forEach(unwrap)
    root.normalize()
    setFindTotal(0)
    setFindIdx(0)
  }, [])

  const focusMatch = useCallback((idx: number) => {
    const root = editorRef.current
    if (!root) return
    const marks = Array.from(root.querySelectorAll('mark[data-find]'))
    marks.forEach((m, i) => {
      if (i === idx) m.setAttribute('data-current', '')
      else m.removeAttribute('data-current')
    })
    marks[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFindIdx(idx)
  }, [])

  const runFind = useCallback(
    (query: string) => {
      const root = editorRef.current
      if (!root) return
      Array.from(root.querySelectorAll('mark[data-find]')).forEach(unwrap)
      root.normalize()
      const ql = query.toLowerCase()
      if (!ql) {
        setFindTotal(0)
        setFindIdx(0)
        return
      }
      // Collect matches first - wrapping while walking would invalidate
      // the walker. Reverse order keeps earlier offsets valid per node.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const hits: { node: Text; index: number }[] = []
      let tn: Node | null
      while ((tn = walker.nextNode())) {
        const text = (tn.textContent || '').toLowerCase()
        let from = 0
        let at: number
        while ((at = text.indexOf(ql, from)) !== -1) {
          hits.push({ node: tn as Text, index: at })
          from = at + ql.length
        }
      }
      for (let i = hits.length - 1; i >= 0; i--) {
        const { node, index } = hits[i]
        const r = document.createRange()
        r.setStart(node, index)
        r.setEnd(node, index + ql.length)
        const mark = document.createElement('mark')
        mark.setAttribute('data-find', '')
        try {
          r.surroundContents(mark)
        } catch {
          /* match spans element boundaries - skip it */
        }
      }
      const total = root.querySelectorAll('mark[data-find]').length
      setFindTotal(total)
      if (total > 0) focusMatch(0)
      else setFindIdx(0)
    },
    [focusMatch],
  )

  const closeFind = useCallback(() => {
    clearFind()
    setFindQuery('')
    setOpenMenu((m) => (m === 'find' ? null : m))
  }, [clearFind])

  // Cmd/Ctrl+F opens in-document search instead of the browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpenMenu('find')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Text color / highlight. Default ("none") strips that style from the
  // touched blocks rather than painting an explicit value.
  const applyColor = useCallback(
    (kind: 'text' | 'highlight', color: string, keepOpen = false) => {
      const root = editorRef.current
      if (!root) return
      root.focus()
      restoreSelection()
      if (color) {
        const chips = chipsInSelection(root)
        if (kind === 'text') {
          document.execCommand('foreColor', false, color)
          chips.forEach((c) => {
            c.style.color = color
          })
        } else {
          // Chrome/Firefox use hiliteColor; Safari only knows backColor.
          if (!document.execCommand('hiliteColor', false, color)) {
            document.execCommand('backColor', false, color)
          }
          chips.forEach((c) => {
            c.style.backgroundColor = color
          })
        }
      } else {
        for (const b of selectedBlocks(root)) {
          const strip = (el: HTMLElement) => {
            if (kind === 'text') el.style.color = ''
            else el.style.backgroundColor = ''
          }
          strip(b)
          Array.from(b.querySelectorAll<HTMLElement>('[style]')).forEach(strip)
          if (kind === 'text') {
            Array.from(b.querySelectorAll('font[color]')).forEach(unwrap)
          }
        }
      }
      // The custom <input type=color> applies live while its native picker
      // is open - closing the menu would unmount it mid-pick. Focus stays
      // in the picker, so repaint the hold overlay or dragging through
      // colors LOOKS like it deselected the text (foreColor has no visible
      // background of its own, unlike highlight).
      if (!keepOpen) setOpenMenu(null)
      emit()
      holdSelection()
    },
    [emit, restoreSelection, holdSelection],
  )

  // Rainbow "Custom" swatch row used by both color menus.
  const customColorRow = (kind: 'text' | 'highlight') => (
    <label className="mt-1.5 flex items-center gap-2 px-1 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
        <Pipette className="h-3.5 w-3.5" />
      </span>
      Custom
      <input
        type="color"
        className="sr-only"
        onChange={(e) => applyColor(kind, e.target.value, true)}
      />
    </label>
  )

  // ----- links -----

  // Opens the link popover. With a selection, its text prefills the Text
  // field; with just a caret, a brand-new link gets inserted on Apply.
  const openLink = useCallback(() => {
    editingLinkRef.current = null
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      setLinkText(sel.toString())
    } else {
      setLinkText('')
    }
    setLinkUrl('')
    setOpenMenu('link')
  }, [])

  const applyLink = useCallback(() => {
    const raw = linkUrl.trim()
    const text = linkText.trim()
    if (!raw) {
      setOpenMenu(null)
      return
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (editingLinkRef.current) {
      const a = editingLinkRef.current
      a.setAttribute('href', href)
      if (text && text !== a.textContent) a.textContent = text
      editingLinkRef.current = null
    } else {
      editorRef.current?.focus()
      restoreSelection()
      // insertHTML replaces the selection (or inserts at the caret), so the
      // Text field works for both relabeling a selection and new links.
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${escapeAttr(href)}">${escapeAttr(text || raw)}</a>`,
      )
    }
    setOpenMenu(null)
    setHoverLink(null)
    emit()
  }, [linkUrl, linkText, emit, restoreSelection])

  const cancelHoverHide = () => {
    if (hoverHideTimer.current) {
      clearTimeout(hoverHideTimer.current)
      hoverHideTimer.current = null
    }
  }

  const scheduleHoverHide = () => {
    cancelHoverHide()
    hoverHideTimer.current = setTimeout(() => setHoverLink(null), 350)
  }

  const onEditorMouseOver = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null
    if (!a || !editorRef.current?.contains(a)) return
    cancelHoverHide()
    const wrap = canvasRef.current
    if (!wrap) return
    const aRect = a.getBoundingClientRect()
    const wRect = wrap.getBoundingClientRect()
    setHoverLink({
      el: a,
      top: aRect.top - wRect.top - 40,
      left: Math.max(0, aRect.left - wRect.left),
    })
  }, [])

  const copyHoverLink = useCallback(() => {
    if (!hoverLink) return
    void navigator.clipboard.writeText(hoverLink.el.href)
    toast.success('Link copied.')
    setHoverLink(null)
  }, [hoverLink])

  const editHoverLink = useCallback(() => {
    if (!hoverLink) return
    editingLinkRef.current = hoverLink.el
    setLinkUrl(hoverLink.el.getAttribute('href') || '')
    setLinkText(hoverLink.el.textContent || '')
    setOpenMenu('link')
    setHoverLink(null)
  }, [hoverLink])

  const removeHoverLink = useCallback(() => {
    if (!hoverLink) return
    unwrap(hoverLink.el)
    setHoverLink(null)
    emit()
  }, [hoverLink, emit])

  // ----- fields -----

  // Direct Range insertion: execCommand('insertHTML') liked to break to a
  // new line around non-editable spans, so the chip is placed into the DOM
  // at the exact caret position instead.
  const insertField = useCallback(
    (ph: PlaceholderDef) => {
      const root = editorRef.current
      if (!root) return
      root.focus()
      restoreSelection()
      const sel = window.getSelection()
      let range: Range | null = null
      if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0)
        range.deleteContents()
      } else {
        // No caret anywhere: append inside the last block on the page.
        const lastBlock = root.lastElementChild as HTMLElement | null
        range = document.createRange()
        range.selectNodeContents(lastBlock || root)
        range.collapse(false)
      }
      const chip = document.createElement('span')
      chip.setAttribute('data-ph', ph.key)
      chip.setAttribute('contenteditable', 'false')
      chip.textContent = ph.label
      const space = document.createTextNode(' ')
      range.insertNode(space)
      range.insertNode(chip)
      const after = document.createRange()
      after.setStartAfter(space)
      after.collapse(true)
      sel?.removeAllRanges()
      sel?.addRange(after)
      setOpenMenu(null)
      emit()
    },
    [emit, restoreSelection],
  )

  const btnCls = (isActive?: boolean) =>
    `p-1.5 rounded-full transition-colors ${
      isActive
        ? 'bg-[#2B79F7] text-white'
        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
    }`

  const menuPanelCls =
    'absolute left-0 top-full mt-2 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg py-1 z-30'

  // Mobile panels anchor to the toolbar pill itself (it is the positioned
  // ancestor) and center under it, so they can never run off-screen the way
  // button-anchored popovers did on small widths.
  const mobilePanelCls =
    'absolute left-1/2 -translate-x-1/2 top-full mt-2 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg py-1 z-30'

  // ----- shared fragments (desktop toolbar + mobile grouped panels) -----

  const inlineToggles = (
    <>
      <button type="button" title="Bold" className={btnCls(active.bold)} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" title="Italic" className={btnCls(active.italic)} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" title="Underline" className={btnCls(active.underline)} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
        <Underline className="h-4 w-4" />
      </button>
      <button type="button" title="Strikethrough" className={btnCls(active.strikeThrough)} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('strikeThrough')}>
        <Strikethrough className="h-4 w-4" />
      </button>
    </>
  )

  const undoRedoButtons = (
    <>
      <button
        type="button"
        title="Undo (Cmd+Z)"
        className={`${btnCls()} disabled:opacity-35`}
        disabled={!histState.canUndo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={undo}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Redo (Cmd+Shift+Z)"
        className={`${btnCls()} disabled:opacity-35`}
        disabled={!histState.canRedo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={redo}
      >
        <Redo2 className="h-4 w-4" />
      </button>
    </>
  )

  const paletteJsx = (kind: 'text' | 'highlight') => (
    <>
      <button
        type="button"
        className="w-full text-left px-1 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyColor(kind, '')}
      >
        {kind === 'text' ? 'Default' : 'None'}
      </button>
      <div className="grid grid-cols-5 gap-1.5 mt-1">
        {(kind === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS).map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            style={{ backgroundColor: c }}
            className="h-6 w-6 rounded-full border border-black/10 hover:scale-110 transition-transform"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyColor(kind, c)}
          />
        ))}
      </div>
      {customColorRow(kind)}
    </>
  )

  // Commit a typed size. The editor selection survives the focus move via
  // savedRangeRef - applyFontSizePx restores it before resizing.
  const commitSizeDraft = () => {
    if (sizeDraft == null) return
    const v = parseInt(sizeDraft, 10)
    setSizeDraft(null)
    if (!Number.isNaN(v)) applyFontSizePx(v)
  }

  const sizeWidgetJsx = (
    <div className="flex items-center gap-0.5 px-1">
      <button
        type="button"
        title="Decrease font size"
        className={btnCls()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyFontSizePx(fontSizePx - 1)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        value={sizeDraft ?? String(fontSizePx)}
        onFocus={() => setSizeDraft(String(fontSizePx))}
        onChange={(e) => setSizeDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitSizeDraft()
          }
          if (e.key === 'Escape') setSizeDraft(null)
        }}
        onBlur={commitSizeDraft}
        title="Font size - type a number and press Enter"
        className="w-9 rounded-md border border-[var(--border-primary)] bg-transparent px-1 py-0.5 text-center text-xs font-semibold text-[var(--text-primary)] tabular-nums outline-none focus:border-[#2B79F7]"
      />
      <button
        type="button"
        title="Increase font size"
        className={btnCls()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyFontSizePx(fontSizePx + 1)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  const alignButtonsJsx = (
    <>
      {(
        [
          ['justifyLeft', AlignLeft, 'Align left', 'alignLeft'],
          ['justifyCenter', AlignCenter, 'Center', 'alignCenter'],
          ['justifyRight', AlignRight, 'Align right', 'alignRight'],
          ['justifyFull', AlignJustify, 'Justify', 'alignFull'],
        ] as const
      ).map(([cmd, Icon, label, stateKey]) => (
        <button
          key={cmd}
          type="button"
          title={label}
          className={btnCls(active[stateKey])}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec(cmd)
            setOpenMenu(null)
          }}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </>
  )

  const findPanelJsx = (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={findQuery}
        onChange={(e) => {
          setFindQuery(e.target.value)
          runFind(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && findTotal > 0) {
            e.preventDefault()
            focusMatch((findIdx + 1) % findTotal)
          }
          if (e.key === 'Escape') closeFind()
        }}
        placeholder="Find in document"
        className="min-w-0 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
      />
      <span className="shrink-0 text-[11px] text-[var(--text-tertiary)] tabular-nums">
        {findTotal > 0 ? `${findIdx + 1}/${findTotal}` : '0/0'}
      </span>
      <button
        type="button"
        title="Previous"
        className={btnCls()}
        disabled={findTotal === 0}
        onClick={() => focusMatch((findIdx - 1 + findTotal) % findTotal)}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Next"
        className={btnCls()}
        disabled={findTotal === 0}
        onClick={() => focusMatch((findIdx + 1) % findTotal)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Close" className={btnCls()} onClick={closeFind}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  const fieldsListJsx = (
    <>
      {placeholders.length === 0 ? (
        <p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">No lead fields found yet.</p>
      ) : (
        placeholders.map((ph) => (
          <button
            key={ph.key}
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertField(ph)}
          >
            {ph.label}
            <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">
              {'{{'}{ph.key}{'}}'}
            </span>
          </button>
        ))
      )}
    </>
  )

  // Mobile "Insert" group needs the same selection capture the link button
  // does, without opening the desktop link popover.
  const openMobileInsert = () => {
    editingLinkRef.current = null
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      setLinkText(sel.toString())
    } else {
      setLinkText('')
    }
    setLinkUrl('')
    setOpenMenu('mInsert')
  }

  return (
    <div>
      { }
      <link rel="stylesheet" href={DOC_FONTS_URL} />
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_DOC_CSS }} />

      {/* Floating pill toolbar, centered tools. Sticks below the page's
          sticky action row (h-[52px]). */}
      <div className="sticky top-[52px] z-20 mx-auto max-w-[816px]">
        <div
          ref={menusRef}
          // Any toolbar input taking focus repaints the editor selection as
          // a hold overlay, so highlighted text never LOOKS deselected
          // while the toolbar is being used.
          onFocusCapture={holdSelection}
          className="relative rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-sm px-2.5 py-1.5"
        >
          {/* Desktop: every tool visible, centered */}
          <div className="hidden sm:flex w-full items-center justify-center gap-0.5 flex-wrap">
          {undoRedoButtons}

          <span className="mx-1 h-5 w-px bg-[var(--border-primary)]" />

          {inlineToggles}

          <span className="mx-1 h-5 w-px bg-[var(--border-primary)]" />

          {/* Text style group: headings + normal text */}
          <div className="relative">
            <button
              type="button"
              title="Text style"
              className={`${btnCls(active.h1 || active.h2)} flex items-center gap-1 px-2 text-[13px] font-bold leading-none`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'blocks' ? null : 'blocks')}
            >
              Aa <ChevronDown className="h-3 w-3" />
            </button>
            {openMenu === 'blocks' && (
              <div className={`${menuPanelCls} w-44`}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 text-lg font-extrabold hover:bg-[var(--bg-tertiary)] ${active.h1 ? 'text-[#2B79F7] bg-[#2B79F7]/10' : 'text-[var(--text-primary)]'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBlockTag('h1')
                    setOpenMenu(null)
                  }}
                >
                  Heading 1
                </button>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 text-base font-bold hover:bg-[var(--bg-tertiary)] ${active.h2 ? 'text-[#2B79F7] bg-[#2B79F7]/10' : 'text-[var(--text-primary)]'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBlockTag('h2')
                    setOpenMenu(null)
                  }}
                >
                  Heading 2
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBlockTag('p')
                    setOpenMenu(null)
                  }}
                >
                  Normal text
                </button>
              </div>
            )}
          </div>

          {/* Font picker */}
          <div className="relative">
            <button
              type="button"
              title="Font"
              className={`${btnCls()} flex items-center gap-1 px-2`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'fonts' ? null : 'fonts')}
            >
              <Type className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {openMenu === 'fonts' && (
              <div
                className={`${menuPanelCls} w-60`}
                onMouseLeave={clearFontPreview}
              >
                <div className="px-2 pb-1.5 pt-0.5">
                  <input
                    autoFocus
                    value={fontQuery}
                    onChange={(e) => setFontQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        clearFontPreview()
                        setOpenMenu(null)
                        setFontQuery('')
                      }
                    }}
                    placeholder="Search fonts"
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {DOC_FONTS.filter((f) =>
                    f.label.toLowerCase().includes(fontQuery.trim().toLowerCase()),
                  ).map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                      style={f.value ? { fontFamily: f.value } : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => previewFont(f.value)}
                      onClick={() => setFont(f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Text color */}
          <div className="relative">
            <button
              type="button"
              title="Text color"
              className={btnCls()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'textColor' ? null : 'textColor')}
            >
              <Baseline className="h-4 w-4" />
            </button>
            {openMenu === 'textColor' && (
              <div className={`${menuPanelCls} w-44 px-2.5 py-2`}>{paletteJsx('text')}</div>
            )}
          </div>

          {/* Highlight */}
          <div className="relative">
            <button
              type="button"
              title="Highlight"
              className={btnCls()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'highlight' ? null : 'highlight')}
            >
              <Highlighter className="h-4 w-4" />
            </button>
            {openMenu === 'highlight' && (
              <div className={`${menuPanelCls} w-44 px-2.5 py-2`}>{paletteJsx('highlight')}</div>
            )}
          </div>

          <span className="mx-1 h-5 w-px bg-[var(--border-primary)]" />

          {/* Lists group */}
          <div className="relative">
            <button
              type="button"
              title="Lists"
              className={`${btnCls(active.ul || active.ol || active.check)} flex items-center gap-1 px-2`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'lists' ? null : 'lists')}
            >
              <List className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {openMenu === 'lists' && (
              <div className={`${menuPanelCls} w-44`}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] ${active.ul ? 'text-[#2B79F7] bg-[#2B79F7]/10' : 'text-[var(--text-primary)]'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    exec('insertUnorderedList')
                    setOpenMenu(null)
                  }}
                >
                  <List className="h-4 w-4" /> Bulleted list
                </button>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] ${active.ol ? 'text-[#2B79F7] bg-[#2B79F7]/10' : 'text-[var(--text-primary)]'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    exec('insertOrderedList')
                    setOpenMenu(null)
                  }}
                >
                  <ListOrdered className="h-4 w-4" /> Numbered list
                </button>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] ${active.check ? 'text-[#2B79F7] bg-[#2B79F7]/10' : 'text-[var(--text-primary)]'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={insertChecklist}
                >
                  <ListChecks className="h-4 w-4" /> Checklist
                </button>
              </div>
            )}
          </div>

          {/* Alignment group */}
          <div className="relative">
            <button
              type="button"
              title="Align"
              className={`${btnCls(active.alignCenter || active.alignRight || active.alignFull)} flex items-center gap-1 px-2`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'align' ? null : 'align')}
            >
              <AlignLeft className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {openMenu === 'align' && (
              <div className={`${menuPanelCls} flex items-center gap-0.5 px-1.5 py-1`}>
                {alignButtonsJsx}
              </div>
            )}
          </div>

          {/* Font size */}
          {sizeWidgetJsx}

          {/* Link popover */}
          <div className="relative">
            <button type="button" title="Add link" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={openLink}>
              <Link2 className="h-4 w-4" />
            </button>
            {openMenu === 'link' && (
              <div className={`${menuPanelCls} w-72 px-3 py-2.5 space-y-2`}>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1">Text</p>
                  <input
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        applyLink()
                      }
                      if (e.key === 'Escape') setOpenMenu(null)
                    }}
                    placeholder="Text to display"
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1">Link</p>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          applyLink()
                        }
                        if (e.key === 'Escape') setOpenMenu(null)
                      }}
                      placeholder="Paste or type a link"
                      className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                    />
                    <button
                      type="button"
                      onClick={applyLink}
                      className="rounded-full bg-[#2B79F7] text-white text-xs font-semibold px-3 py-1.5 hover:opacity-90"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button type="button" title="Clear formatting - strip bold, fonts, sizes and colors from the selection" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={clearFormatting}>
            <RemoveFormatting className="h-4 w-4" />
          </button>

          {/* Insert field */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenMenu(openMenu === 'fields' ? null : 'fields')}
            >
              <Braces className="h-3.5 w-3.5" />
              Insert field
              <ChevronDown className="h-3 w-3" />
            </button>
            {openMenu === 'fields' && (
              <div className={`${menuPanelCls} w-56 max-h-64 overflow-y-auto`}>{fieldsListJsx}</div>
            )}
          </div>

          {/* Find in document (also Cmd/Ctrl+F) */}
          <div className="relative">
            <button
              type="button"
              title="Find in document (Cmd+F)"
              className={btnCls(openMenu === 'find')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (openMenu === 'find' ? closeFind() : setOpenMenu('find'))}
            >
              <Search className="h-4 w-4" />
            </button>
            {openMenu === 'find' && (
              <div className={`${menuPanelCls} w-72 px-2.5 py-2`}>{findPanelJsx}</div>
            )}
          </div>

          {/* Page actions docked on the right */}
          {actions && (
            <div className="ml-auto flex items-center gap-1.5 pl-2">{actions}</div>
          )}
          </div>

          {/* Mobile: similar tools collapse into grouped panels so the
              pill never looks squished. */}
          <div className="flex sm:hidden w-full items-center justify-center gap-1">
            {undoRedoButtons}
            {/* Format group: inline styles + colors */}
            <div>
              <button
                type="button"
                title="Format"
                className={`${btnCls(openMenu === 'mFormat' || active.bold || active.italic || active.underline || active.strikeThrough)} flex items-center gap-1 px-2`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpenMenu(openMenu === 'mFormat' ? null : 'mFormat')}
              >
                <Bold className="h-4 w-4" />
                <ChevronDown className="h-3 w-3" />
              </button>
              {openMenu === 'mFormat' && (
                <div className={`${mobilePanelCls} w-64 px-3 py-2.5 space-y-2`}>
                  <div className="flex items-center justify-center gap-1">{inlineToggles}</div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    Text color
                  </p>
                  {paletteJsx('text')}
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    Highlight
                  </p>
                  {paletteJsx('highlight')}
                </div>
              )}
            </div>

            {/* Paragraph group: styles, font, size, align, lists */}
            <div>
              <button
                type="button"
                title="Paragraph"
                className={`${btnCls(openMenu === 'mParagraph' || active.h1 || active.h2 || active.ul || active.ol || active.check)} flex items-center gap-1 px-2 text-[13px] font-bold leading-none`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpenMenu(openMenu === 'mParagraph' ? null : 'mParagraph')}
              >
                Aa <ChevronDown className="h-3 w-3" />
              </button>
              {openMenu === 'mParagraph' && (
                <div className={`${mobilePanelCls} w-64 px-3 py-2.5 space-y-2.5`}>
                  <div className="flex items-center gap-1">
                    <button type="button" className={`${btnCls()} text-[13px] font-bold px-2`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setBlockTag('h1'); setOpenMenu(null) }}>
                      H1
                    </button>
                    <button type="button" className={`${btnCls()} text-[13px] font-bold px-2`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setBlockTag('h2'); setOpenMenu(null) }}>
                      H2
                    </button>
                    <button type="button" className={`${btnCls()} text-[13px] font-semibold px-2`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setBlockTag('p'); setOpenMenu(null) }}>
                      Aa
                    </button>
                    {sizeWidgetJsx}
                  </div>
                  <select
                    defaultValue=""
                    onChange={(e) => setFont(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none"
                  >
                    <option value="" disabled>
                      Font...
                    </option>
                    {DOC_FONTS.map((f) => (
                      <option key={f.label} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">{alignButtonsJsx}</div>
                  <div className="flex items-center gap-1">
                    <button type="button" title="Bulleted list" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={() => { exec('insertUnorderedList'); setOpenMenu(null) }}>
                      <List className="h-4 w-4" />
                    </button>
                    <button type="button" title="Numbered list" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={() => { exec('insertOrderedList'); setOpenMenu(null) }}>
                      <ListOrdered className="h-4 w-4" />
                    </button>
                    <button type="button" title="Checklist" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={insertChecklist}>
                      <ListChecks className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Insert group: link + fields */}
            <div>
              <button
                type="button"
                title="Insert"
                className={`${btnCls(openMenu === 'mInsert')} flex items-center gap-1 px-2`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (openMenu === 'mInsert' ? setOpenMenu(null) : openMobileInsert())}
              >
                <Braces className="h-4 w-4 text-[#2B79F7]" />
                <ChevronDown className="h-3 w-3" />
              </button>
              {openMenu === 'mInsert' && (
                <div className={`${mobilePanelCls} w-72 px-3 py-2.5 space-y-2`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    Link
                  </p>
                  <input
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Text to display"
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="Paste or type a link"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                    />
                    <button
                      type="button"
                      onClick={applyLink}
                      className="rounded-full bg-[#2B79F7] text-white text-xs font-semibold px-3 py-1.5 hover:opacity-90"
                    >
                      Apply
                    </button>
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    Insert field
                  </p>
                  <div className="-mx-3 max-h-40 overflow-y-auto">{fieldsListJsx}</div>
                </div>
              )}
            </div>

            {/* Clear formatting + find stay top-level */}
            <button type="button" title="Clear formatting" className={btnCls()} onMouseDown={(e) => e.preventDefault()} onClick={clearFormatting}>
              <RemoveFormatting className="h-4 w-4" />
            </button>
            <div>
              <button
                type="button"
                title="Find in document"
                className={btnCls(openMenu === 'find')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (openMenu === 'find' ? closeFind() : setOpenMenu('find'))}
              >
                <Search className="h-4 w-4" />
              </button>
              {openMenu === 'find' && (
                <div className={`${mobilePanelCls} w-[22rem] px-2.5 py-2`}>{findPanelJsx}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The paper. Letter-proportioned, grows with content, whole window
          scrolls (no inner scrollbar - that's what made it look cut off). */}
      <div
        ref={canvasRef}
        className="relative pt-5 pb-10"
        onMouseDown={(e) => {
          if (e.target !== canvasRef.current) return
          e.preventDefault()
          const root = editorRef.current
          if (!root) return
          root.focus()
          placeCaretAtEnd(root)
        }}
      >
        {/* Link hover toolbar: copy / edit / remove */}
        {hoverLink && (
          <div
            className="absolute z-30 flex items-center gap-0.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-md px-1.5 py-1"
            style={{ top: hoverLink.top, left: hoverLink.left }}
            onMouseEnter={cancelHoverHide}
            onMouseLeave={scheduleHoverHide}
          >
            <button type="button" title="Copy link" className={btnCls()} onClick={copyHoverLink}>
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Edit link" className={btnCls()} onClick={editHoverLink}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Remove link" className={btnCls()} onClick={removeHoverLink}>
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="agreement-doc agreement-page mx-auto outline-none"
          onInput={emit}
          onBlur={emit}
          onMouseDown={onEditorMouseDown}
          onClick={onEditorClick}
          onKeyDown={onEditorKeyDown}
          onMouseOver={onEditorMouseOver}
          onMouseLeave={scheduleHoverHide}
        />
      </div>
    </div>
  )
}
