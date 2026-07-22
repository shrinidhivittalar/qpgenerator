import type { PaperItem } from '../../types'
import { cleanText } from '../../utils'
import { mathToHtml } from '../../components/MathText'
import { buildMcqOptionsHtml }  from './MCQQuestion'
import { buildImagesHtml }      from './FigureQuestion'
import { buildTablesHtml }      from './DescriptiveQuestion'

/**
 * Renders a single question in examination paper format.
 *
 * Layout:
 *   num.   Question text that may span multiple lines          (marks)
 *          [MCQ options in 2-col or 1-col, auto-detected]
 *          [Figure image, max-height constrained]
 *          [Data table / OR-separated tables]
 *
 * CSS class `.question` has `page-break-inside: avoid; break-inside: avoid`
 * so the entire question stays on one page unless it is taller than one page.
 *
 * Type routing:
 *   mcq          → buildMcqOptionsHtml  (smart 2-col / 1-col grid)
 *   figure_based → buildImagesHtml      (block img below text)
 *   table_based  → buildTablesHtml      (bordered table with OR divider)
 *   text / multi_part / custom → question text only
 */
export function buildQuestionHtml(
  item:    PaperItem,
  num:     number,
  imgBase: string,
): string {
  const text = mathToHtml(cleanText(item.text))

  const options = (item.type === 'mcq' && !item.isRephrased && item.options?.length)
    ? buildMcqOptionsHtml(item.options)
    : ''

  const images = buildImagesHtml(item.images, imgBase, item.subject, item.source)
  const tables = buildTablesHtml(item.tables)

  return `<div class="question">
  <span class="q-num">${num}.</span>
  <div class="q-content">
    <span>${text}</span>${options}${images}${tables}
  </div>
  <span class="q-marks">(${item.marks})</span>
</div>`
}
