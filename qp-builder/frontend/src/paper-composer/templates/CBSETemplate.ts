import type { TemplateParts } from './AcademicTemplate'

/**
 * CBSE / NCERT examination paper template.  [NOT YET IMPLEMENTED]
 *
 * Differences from AcademicTemplate that this template will handle:
 *   - Section labels are letters (A, B, C, D, E) not Roman numerals
 *   - Standard CBSE section naming: "Very Short Answer / Short Answer /
 *     Long Answer / Case-Based Questions / Source-Based Questions"
 *   - Internal choice questions printed with "OR" between paired questions
 *   - Competency-based question indicators (★ / CBQ tag)
 *   - School code + exam code in the header (right-aligned)
 *   - "General Instructions" printed outside the header box (below it)
 *   - Specific CBSE-mandated instruction wording
 *   - Marks per section shown as "Section A: 1 × 20 = 20 marks" prose style
 *
 * To activate: pass `template: 'cbse'` to composePaper() once implemented.
 */
export function cbseTemplate(_parts: TemplateParts): string {
  throw new Error('CBSETemplate is not yet implemented. Use academicTemplate for now.')
}
