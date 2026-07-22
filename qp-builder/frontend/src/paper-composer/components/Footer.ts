import type { PaperConfiguration } from '../../types'
import { escHtml } from '../../utils'

/**
 * Renders the end-of-paper footer line.
 *
 * Left  — optional "Prepared by" / custom footer text
 * Right — "* * *" end-of-paper marker
 *
 * Page numbers ("Page N of M") are handled separately by the CSS
 * `@page { @bottom-center { content: counter(page) ... } }` rule in print.css,
 * which places them in the page margin on every printed page without
 * requiring JavaScript or per-page HTML elements.
 *
 * Future fields that could be added here (kept in mind, not implemented):
 *   - Generated on: date/time stamp
 *   - Version: e.g. "Draft v2"
 *   - Confidential watermark trigger
 *   - School logo (small, right-aligned)
 */
export function buildFooterHtml(config: PaperConfiguration): string {
  const left = config.footerText ? escHtml(config.footerText) : ''
  return `<footer class="paper-footer">
  <span>${left}</span>
  <span>* * *</span>
</footer>`
}
