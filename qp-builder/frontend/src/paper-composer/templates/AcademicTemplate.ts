import css from '../styles/print.css?raw'

export interface TemplateParts {
  title:            string   // document <title>
  headerHtml:       string   // bordered header box (school / exam / metadata)
  instructionsHtml: string   // general instructions block (empty string if none)
  sectionsHtml:     string   // all paper sections
  footerHtml:       string   // end-of-paper footer line
}

/**
 * Standard academic paper template.
 *
 * Document order:
 *   1. Header box         (school → exam → metadata)
 *   2. Instructions block (GENERAL INSTRUCTIONS + numbered list) — if present
 *   3. Sections           (Section I … Section N)
 *   4. Footer             (prepared by / * * *)
 *
 * Page numbers are injected by CSS @page @bottom-center — not by JavaScript.
 *
 * ── Adding a new template ─────────────────────────────────────────────────
 * 1. Copy this file, rename (e.g. KarnatakaTemplate.ts).
 * 2. Import a different or extended CSS file (or augment this one).
 * 3. Reorder / restyle the TemplateParts to match the target board format.
 * 4. In composer.ts, add a `template` option and switch to the new function.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function academicTemplate(parts: TemplateParts): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${parts.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <style>${css}</style>
</head>
<body>
  ${parts.headerHtml}
  ${parts.instructionsHtml}
  <main>
    ${parts.sectionsHtml}
  </main>
  ${parts.footerHtml}
</body>
</html>`
}
