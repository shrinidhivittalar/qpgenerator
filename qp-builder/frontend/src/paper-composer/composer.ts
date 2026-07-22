/**
 * Paper Composer — public entry point.
 *
 * Architecture:
 *   PaperItem[] + PaperConfiguration
 *           ↓
 *   composer.ts          ← groups items into sections, orchestrates components
 *           ↓
 *   components/          ← Header, Instructions, Section, Question, MCQ, Figure, Table, Footer
 *           ↓
 *   templates/           ← AcademicTemplate (active) | Karnataka | CBSE (future)
 *           ↓
 *   styles/print.css     ← A4 layout, Times New Roman, typography scale, page numbers
 *           ↓
 *   complete <!doctype html> string
 *
 * Intentionally isolated:
 *   ✗  knows nothing about PDF parsing, MongoDB, AI, or question extraction
 *   ✓  receives only PaperItem[] and PaperConfiguration
 *   ✓  returns a self-contained HTML string ready for window.open() + print
 */

import type { PaperItem, PaperConfiguration, PaperSection } from '../types'
import { escHtml } from '../utils'
import { buildHeaderHtml }                    from './components/Header'
import { buildInstructionsHtml }              from './components/Instructions'
import { buildSectionHtml, type SectionData } from './components/Section'
import { buildFooterHtml }                    from './components/Footer'
import { academicTemplate }                   from './templates/AcademicTemplate'

// ── Section grouping ──────────────────────────────────────────────────────────
// Questions are grouped by marks value (ascending) so Section I always has the
// lowest-mark questions (typically 1-mark MCQs) and later sections increase.
// Within each section, the user's original selection order is preserved.

function sectionInstruction(marks: number, items: PaperItem[]): string {
  const hasMcq = items.some(i => i.type === 'mcq')
  if (marks === 1 && hasMcq) return 'Choose the correct answer from the alternatives given.'
  if (marks === 1)           return 'Answer the following. (1 mark each)'
  if (marks === 2)           return 'Answer the following questions.'
  if (marks === 3)           return 'Answer the following questions.'
  return 'Answer the following questions in detail.'
}

function groupIntoSections(items: PaperItem[]): SectionData[] {
  const byMarks = new Map<number, PaperItem[]>()
  for (const item of items) {
    if (!byMarks.has(item.marks)) byMarks.set(item.marks, [])
    byMarks.get(item.marks)!.push(item)
  }
  return [...byMarks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([marks, sectionItems], idx) => ({
      index:       idx,
      marks,
      items:       sectionItems,
      instruction: sectionInstruction(marks, sectionItems),
    }))
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ComposerOptions {
  imgBase:     string   // base URL for question images (Supabase or local Flask)
  paperTitle?: string   // fallback <title> if config has no school/exam name
}

export function composePaper(
  items:        PaperItem[],
  config:       PaperConfiguration,
  opts:         ComposerOptions,
  userSections: PaperSection[] = [],
): string {
  const computedMarks = items.reduce((s, i) => s + i.marks, 0)

  let sections: SectionData[]
  if (userSections.length > 0) {
    sections = userSections.map((sec, idx) => {
      const secItems = items.filter(i => i.sectionId === sec.id)
      return {
        index:       idx,
        marks:       sec.marksPerQ,
        items:       secItems,
        instruction: sec.instruction || sectionInstruction(sec.marksPerQ, secItems),
        title:       sec.title,
      }
    })
    const unsectioned = items.filter(i => !i.sectionId || !userSections.find(s => s.id === i.sectionId))
    if (unsectioned.length > 0) {
      sections.push({
        index:       sections.length,
        marks:       unsectioned[0].marks,
        items:       unsectioned,
        instruction: sectionInstruction(unsectioned[0].marks, unsectioned),
      })
    }
  } else {
    sections = groupIntoSections(items)
  }

  const showHeaders   = sections.length > 1  // single-section: no Section I heading

  // Each component renders its own HTML string independently
  const headerHtml       = buildHeaderHtml(config, { computedMarks, questionCount: items.length })
  const instructionsHtml = buildInstructionsHtml(config.instructions ?? [])
  const footerHtml       = buildFooterHtml(config)

  // Sections share a global question counter so numbering is continuous
  // across Section I → II → III (e.g. Q1–Q8, Q9–Q16, Q17–Q20)
  let nextNum = 1
  const sectionsHtml = sections.map(sec => {
    const result = buildSectionHtml(sec, nextNum, opts.imgBase, showHeaders)
    nextNum = result.nextNum
    return result.html
  }).join('\n')

  const title = escHtml(
    config.schoolName || config.examName || opts.paperTitle || 'Question Paper'
  )

  return academicTemplate({ title, headerHtml, instructionsHtml, sectionsHtml, footerHtml })
}
