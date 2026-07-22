import type { PaperConfiguration } from '../../types'
import { escHtml } from '../../utils'

export interface HeaderStats {
  computedMarks: number
  questionCount: number
}

/**
 * Renders the paper header as a bordered box using CSS classes from print.css.
 *
 * Structure:
 *   .paper-header
 *     .ph-identity     → school name (dominant) + board (muted)
 *     .ph-rule         → thin horizontal separator
 *     .ph-title-block  → exam name (secondary) + academic year (muted)
 *     .ph-meta         → two rows:
 *                          row 1: Class | Subject | Section
 *                          row 2: Date  | Duration | Maximum Marks
 *                          [optional: Chapters]
 *
 * Instructions are intentionally excluded here — they live in Instructions.ts
 * as a separate block, placed after the header by the template.
 * This lets different templates position instructions differently
 * (inside the box for traditional format, outside for modern format).
 */
export function buildHeaderHtml(
  config: PaperConfiguration,
  stats:  HeaderStats,
): string {
  const esc          = escHtml
  const displayMarks = config.totalMarks || stats.computedMarks

  // ── Identity block (school + board) ──────────────────────────────────────
  const identityHtml = (config.schoolName || config.boardName) ? `
  <div class="ph-identity">
    ${config.schoolName ? `<div class="ph-school">${esc(config.schoolName)}</div>` : ''}
    ${config.boardName  ? `<div class="ph-board">${esc(config.boardName)}</div>`   : ''}
  </div>
  <hr class="ph-rule">` : ''

  // ── Title block (exam name + year) ────────────────────────────────────────
  const titleHtml = `
  <div class="ph-title-block">
    <div class="ph-exam">${esc(config.examName || 'Question Paper')}</div>
    ${config.academicYear ? `<div class="ph-year">${esc(config.academicYear)}</div>` : ''}
  </div>`

  // ── Metadata rows ─────────────────────────────────────────────────────────
  // Row 1: classification (Class / Subject / Section)
  const row1 = [
    config.className && `Class: ${config.className}`,
    config.subject   && `Subject: ${config.subject}`,
    config.section   && `Section: ${config.section}`,
  ].filter(Boolean) as string[]

  // Row 2: logistics (Date / Duration / Max Marks)
  const row2 = [
    config.date   && `Date: ${config.date}`,
    config.duration && `Duration: ${config.duration}`,
    displayMarks    && `Maximum Marks: ${displayMarks}`,
  ].filter(Boolean) as string[]

  const metaRowHtml = (fields: string[]) =>
    fields.length > 0
      ? `<div class="ph-meta-row">${fields.map(f => `<span>${esc(f)}</span>`).join('')}</div>`
      : ''

  // Fallback when no classification/logistics provided
  const fallbackRow = (row1.length === 0 && row2.length === 0)
    ? `<div class="ph-meta-row">
         <span>Total Marks: ${displayMarks}</span>
         <span>Questions: ${stats.questionCount}</span>
       </div>`
    : ''

  const chaptersHtml = config.chapters
    ? `<div class="ph-chapters">Chapters: ${esc(config.chapters)}</div>`
    : ''

  const metaHtml = `
  <div class="ph-meta">
    ${metaRowHtml(row1)}
    ${metaRowHtml(row2)}
    ${fallbackRow}
    ${chaptersHtml}
  </div>`

  return `<header class="paper-header">
  ${identityHtml}
  ${titleHtml}
  ${metaHtml}
</header>`
}
