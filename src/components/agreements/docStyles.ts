/**
 * Shared document typography for agreement bodies. Tailwind's preflight
 * strips heading/list styles, so anywhere we render stored agreement HTML
 * (editor, compose preview, public signing page) gets this block under the
 * `agreement-doc` class to make it read like a real document.
 */

/** Fonts offered in the editor. Google-hosted ones load via DOC_FONTS_URL
 *  on every surface that renders agreement HTML, so a font chosen in the
 *  editor looks identical on the signing page. The `g` field is the
 *  Google Fonts family slug; system fonts omit it. */
const FONT_DEFS: { label: string; stack: string; g?: string }[] = [
  // Sans
  { label: 'Montserrat', stack: 'Montserrat, Arial, sans-serif' },
  { label: 'Inter', stack: 'Inter, Arial, sans-serif', g: 'Inter' },
  { label: 'Poppins', stack: 'Poppins, Arial, sans-serif', g: 'Poppins' },
  { label: 'Roboto', stack: 'Roboto, Arial, sans-serif', g: 'Roboto' },
  { label: 'Open Sans', stack: '"Open Sans", Arial, sans-serif', g: 'Open+Sans' },
  { label: 'Lato', stack: 'Lato, Arial, sans-serif', g: 'Lato' },
  { label: 'Raleway', stack: 'Raleway, Arial, sans-serif', g: 'Raleway' },
  { label: 'Work Sans', stack: '"Work Sans", Arial, sans-serif', g: 'Work+Sans' },
  { label: 'DM Sans', stack: '"DM Sans", Arial, sans-serif', g: 'DM+Sans' },
  { label: 'Manrope', stack: 'Manrope, Arial, sans-serif', g: 'Manrope' },
  { label: 'Nunito', stack: 'Nunito, Arial, sans-serif', g: 'Nunito' },
  { label: 'Rubik', stack: 'Rubik, Arial, sans-serif', g: 'Rubik' },
  { label: 'Karla', stack: 'Karla, Arial, sans-serif', g: 'Karla' },
  { label: 'Mulish', stack: 'Mulish, Arial, sans-serif', g: 'Mulish' },
  { label: 'Archivo', stack: 'Archivo, Arial, sans-serif', g: 'Archivo' },
  { label: 'Space Grotesk', stack: '"Space Grotesk", Arial, sans-serif', g: 'Space+Grotesk' },
  { label: 'Quicksand', stack: 'Quicksand, Arial, sans-serif', g: 'Quicksand' },
  { label: 'Josefin Sans', stack: '"Josefin Sans", Arial, sans-serif', g: 'Josefin+Sans' },
  { label: 'Oswald', stack: 'Oswald, Arial, sans-serif', g: 'Oswald' },
  { label: 'Source Sans 3', stack: '"Source Sans 3", Arial, sans-serif', g: 'Source+Sans+3' },
  // Serif
  { label: 'Lora', stack: 'Lora, Georgia, serif', g: 'Lora' },
  { label: 'Merriweather', stack: 'Merriweather, Georgia, serif', g: 'Merriweather' },
  { label: 'Playfair Display', stack: '"Playfair Display", Georgia, serif', g: 'Playfair+Display' },
  { label: 'EB Garamond', stack: '"EB Garamond", Garamond, serif', g: 'EB+Garamond' },
  { label: 'Libre Baskerville', stack: '"Libre Baskerville", Georgia, serif', g: 'Libre+Baskerville' },
  { label: 'Source Serif 4', stack: '"Source Serif 4", Georgia, serif', g: 'Source+Serif+4' },
  { label: 'Crimson Pro', stack: '"Crimson Pro", Georgia, serif', g: 'Crimson+Pro' },
  { label: 'PT Serif', stack: '"PT Serif", Georgia, serif', g: 'PT+Serif' },
  { label: 'Bitter', stack: 'Bitter, Georgia, serif', g: 'Bitter' },
  { label: 'Spectral', stack: 'Spectral, Georgia, serif', g: 'Spectral' },
  { label: 'Cormorant Garamond', stack: '"Cormorant Garamond", Garamond, serif', g: 'Cormorant+Garamond' },
  { label: 'Zilla Slab', stack: '"Zilla Slab", Georgia, serif', g: 'Zilla+Slab' },
  { label: 'Alegreya', stack: 'Alegreya, Georgia, serif', g: 'Alegreya' },
  { label: 'Noto Serif', stack: '"Noto Serif", Georgia, serif', g: 'Noto+Serif' },
  // Mono + system
  { label: 'JetBrains Mono', stack: '"JetBrains Mono", "Courier New", monospace', g: 'JetBrains+Mono' },
  { label: 'Georgia', stack: 'Georgia, serif' },
  { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { label: 'Garamond', stack: 'Garamond, "Times New Roman", serif' },
  { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Courier New', stack: '"Courier New", Courier, monospace' },
]

export const DOC_FONTS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  ...FONT_DEFS.map((f) => ({ label: f.label, value: f.stack })),
]

export const DOC_FONTS_URL =
  'https://fonts.googleapis.com/css2?' +
  FONT_DEFS.filter((f) => f.g)
    .map((f) => `family=${f.g}:wght@400;700`)
    .join('&') +
  '&display=swap'
export const AGREEMENT_DOC_CSS = `
.agreement-doc {
  font-size: 15px;
  line-height: 1.75;
  color: #1f2937;
  word-break: break-word;
}
.agreement-doc h1 {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.3;
  margin: 18px 0 10px;
  color: #111827;
}
.agreement-doc h2 {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  margin: 16px 0 8px;
  color: #111827;
}
.agreement-doc p {
  margin: 0 0 10px;
}
.agreement-doc ul, .agreement-doc ol {
  margin: 0 0 10px;
  padding-left: 26px;
}
.agreement-doc ul { list-style: disc; }
.agreement-doc ol { list-style: decimal; }
.agreement-doc li { margin: 3px 0; }
.agreement-doc a {
  color: #2B79F7;
  text-decoration: underline;
}
.agreement-doc b, .agreement-doc strong { font-weight: 700; }
/* Checklists: checkbox toggles in the editor; checked items grey + strike.
   HARD GATE: a checkbox renders ONLY as the first child of a checklist
   item. Anywhere else (dragged out by edits, merges, splits) it is
   display:none, so a stray box can never paint outside the list. The
   editor also strips strays from the markup on every change. */
.agreement-doc [data-checkbox] { display: none; }
.agreement-doc ul[data-checklist] { list-style: none; padding-left: 4px; }
.agreement-doc ul[data-checklist] > li {
  position: relative;
  padding-left: 26px;
  margin: 4px 0;
  /* An emptied item must keep a line box: with zero height its absolute
     checkbox would paint over the line below. */
  min-height: 1.6em;
}
.agreement-doc ul[data-checklist] > li > [data-checkbox]:first-child {
  position: absolute;
  left: 0;
  top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid #9ca3af;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
  color: #ffffff;
  cursor: pointer;
  user-select: none;
}
.agreement-doc li[data-checked="true"] {
  color: #9ca3af;
  text-decoration: line-through;
}
.agreement-doc li[data-checked="true"] [data-checkbox] {
  background: #2B79F7;
  border-color: #2B79F7;
}
.agreement-doc li[data-checked="true"] [data-checkbox]::after { content: '✓'; }
/* In-document find highlights (editor only; stripped from saved HTML). */
.agreement-doc mark[data-find] { background: #fde68a; color: inherit; padding: 0; }
.agreement-doc mark[data-find][data-current] { background: #f59e0b; }
/* Selection hold: painted via the CSS Custom Highlight API while focus is
   in a toolbar input, so the selected text stays visibly highlighted until
   the user actually clicks elsewhere on the canvas (Docs behavior). */
::highlight(fk-selhold) { background: rgba(43, 121, 247, 0.3); }
/* The paper itself: US Letter proportions, document-grade margins, grows
   with content. Shared by the editor, the compose preview and the public
   signing page so all three read as the same physical document. */
.agreement-page {
  width: 100%;
  max-width: 816px;
  min-height: 1056px;
  background: #ffffff;
  border: 1px solid #e5e3df;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px rgba(15, 23, 42, 0.06);
  padding: 72px 64px 96px;
}
@media (max-width: 640px) {
  .agreement-page {
    padding: 40px 24px 64px;
    min-height: 70vh;
  }
}
.agreement-doc [data-ph] {
  display: inline-block;
  background: #EAF2FE;
  color: #1E54B7;
  border: 1px solid #BFD7FB;
  border-radius: 6px;
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}
`
