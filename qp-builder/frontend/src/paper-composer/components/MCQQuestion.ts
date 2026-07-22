import { mathToHtml } from '../../components/MathText'

const LETTERS = ['A', 'B', 'C', 'D']

/**
 * Renders MCQ options with automatic column-count selection.
 *
 * 2-column (short options, ≤ 45 raw characters):
 *   A. Option one text      B. Option two text
 *   C. Option three text    D. Option four text
 *
 * 1-column fallback (any option longer than 45 chars):
 *   A. This is a longer option that would not fit neatly beside another.
 *   B. Another option that wraps across the line.
 *
 * The threshold is checked against the raw text length (HTML tags stripped)
 * to avoid being fooled by KaTeX-rendered math strings.
 *
 * CSS classes used (defined in print.css):
 *   .mcq-grid          — shared container
 *   .mcq-2col          — applies grid-template-columns: 1fr 1fr
 *   .mcq-1col          — single-column block stacking
 *   .mcq-opt           — individual option (flex: letter + text)
 *   .mcq-letter        — bold letter label (A, B, C, D)
 */
export function buildMcqOptionsHtml(options: string[]): string {
  const opts = options.slice(0, 4)
  if (!opts.length) return ''

  // Strip HTML/LaTeX tags to measure display width, not markup length
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\$[^$]+\$/g, 'x')
  const maxLen    = Math.max(...opts.map(o => stripTags(o).length))
  const twoCol    = maxLen <= 45

  const cells = opts.map((o, i) => `
    <div class="mcq-opt">
      <span class="mcq-letter">${LETTERS[i]}.</span>
      <span>${mathToHtml(o)}</span>
    </div>`)

  const gridClass = twoCol ? 'mcq-grid mcq-2col' : 'mcq-grid mcq-1col'
  return `<div class="${gridClass}">${cells.join('')}</div>`
}
