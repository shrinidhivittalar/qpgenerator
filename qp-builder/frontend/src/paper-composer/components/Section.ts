import type { PaperItem } from '../../types'
import { buildQuestionHtml } from './Question'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export interface SectionData {
  index:       number    // 0-based; maps to ROMAN[index] for the label
  marks:       number    // marks per question in this section
  items:       PaperItem[]
  instruction: string    // e.g. "Choose the correct answer from the alternatives given."
  title?:      string    // user-defined title; overrides "Section I/II..." when set
}

export interface SectionResult {
  html:    string
  nextNum: number  // global question counter after this section exits
}

/**
 * Renders one paper section.
 *
 * With header (multi-section papers):
 *
 *   SECTION I                                    8 × 1 = 8
 *   Choose the correct answer from the alternatives given.
 *   ──────────────────────────────────────────────────────
 *   1.  [question]   (1)
 *   2.  [question]   (1)
 *   ...
 *
 * Without header (single-section papers — showHeader = false):
 *   questions numbered sequentially with no section heading.
 *
 * @param showHeader  false omits the .sec-head block entirely
 */
export function buildSectionHtml(
  sec:        SectionData,
  startNum:   number,
  imgBase:    string,
  showHeader: boolean,
): SectionResult {
  const subtotal = sec.items.length * sec.marks
  const label    = sec.title ?? `Section ${ROMAN[sec.index] ?? String(sec.index + 1)}`

  const secHead = showHeader ? `
  <div class="sec-head">
    <div class="sec-top">
      <span class="sec-label">${label}</span>
      <span class="sec-formula">${sec.items.length} × ${sec.marks} = ${subtotal}</span>
    </div>
    <div class="sec-instruction">${sec.instruction}</div>
    <hr class="sec-rule">
  </div>` : ''

  let num = startNum
  const questions = sec.items
    .map(item => buildQuestionHtml(item, num++, imgBase))
    .join('\n')

  return {
    html:    `<section class="paper-section">${secHead}\n${questions}</section>`,
    nextNum: num,
  }
}
