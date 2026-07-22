import type { TemplateParts } from './AcademicTemplate'

/**
 * Karnataka SSLC / KSEEB examination paper template.  [NOT YET IMPLEMENTED]
 *
 * Differences from AcademicTemplate that this template will handle:
 *   - KSEEB / SSLC logo and seal placeholder in the header
 *   - Bilingual section labels ("ಭಾಗ I / Section I") for Kannada medium papers
 *   - Specific compulsory-instruction wording mandated by KSEEB
 *   - QR code block in the top-right corner of the header
 *   - "Register Number / ನೋಂದಣಿ ಸಂಖ್ಯೆ" box printed in the header
 *   - Two-column question layout for certain section types
 *   - Board-mandated footer with exam code and date
 *
 * To activate: pass `template: 'karnataka'` to composePaper() once implemented.
 */
export function karnatakaTemplate(_parts: TemplateParts): string {
  throw new Error('KarnatakaTemplate is not yet implemented. Use academicTemplate for now.')
}
