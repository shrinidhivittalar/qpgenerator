import type { TableEntry } from '../../types'
import { escHtml } from '../../utils'

/**
 * Renders data tables for table-based questions.
 * Multiple tables in one question are separated by a centred "— OR —" divider,
 * which is the standard format for alternative-choice questions.
 */
export function buildTablesHtml(tables: TableEntry[]): string {
  if (!tables.length) return ''

  return tables.map((tbl, ti) => {
    const or = ti > 0 ? `<div class="or-divider">— OR —</div>` : ''

    const thead = '<tr>' +
      tbl.headers.map(h => `<th>${escHtml(h)}</th>`).join('') +
      '</tr>'

    const tbody = tbl.rows.map(row =>
      '<tr>' +
      tbl.headers.map(h => `<td>${escHtml(row[h] ?? '')}</td>`).join('') +
      '</tr>'
    ).join('')

    return `${or}<table class="q-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`
  }).join('\n')
}
