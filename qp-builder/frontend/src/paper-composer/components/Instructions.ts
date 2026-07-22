import { escHtml } from '../../utils'

/**
 * Renders the General Instructions as a standalone labeled block,
 * placed below the header box by the template.
 *
 * Output structure:
 *   .paper-instructions
 *     .instr-label     → "GENERAL INSTRUCTIONS" (small caps, uppercase, muted)
 *     ol.instr-list    → numbered instruction lines
 *
 * Separated from Header.ts so templates can:
 *   a) place instructions outside the bordered header box (AcademicTemplate)
 *   b) place them inside the box below the metadata (traditional format)
 *   c) omit them or render them on a cover page
 */
export function buildInstructionsHtml(instructions: string[]): string {
  const items = instructions.filter(Boolean)
  if (!items.length) return ''

  const listItems = items
    .map(i => `    <li>${escHtml(i)}</li>`)
    .join('\n')

  return `<div class="paper-instructions">
  <div class="instr-label">General Instructions</div>
  <ol class="instr-list">
${listItems}
  </ol>
</div>`
}
