import type { ImageEntry } from '../../types'
import { escHtml } from '../../utils'

/**
 * Renders question figures as block images directly below the question text.
 * Images are constrained to max-height:220px to avoid dominating a single page.
 */
export function buildImagesHtml(
  images:  ImageEntry[],
  imgBase: string,
  subject: string,
  source:  string,
): string {
  if (!images.length) return ''

  return images.map(img =>
    `<img class="q-image"
          src="${imgBase}/${escHtml(subject)}/${escHtml(source)}/${escHtml(img.file)}"
          alt="Figure"/>`
  ).join('\n')
}
