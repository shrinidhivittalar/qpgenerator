export const mkUid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Strips leading original number and collapses split MCQ options ("(A) \ntext" -> "(A) text")
export function cleanText(text: string): string {
  return text
    .replace(/^\d{1,2}\.\s*/, '')
    .replace(/\(([A-D])\)\s*\n\s*/g, '($1) ')
    .trim()
}

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','to','of','in','on','at','by','for','with',
  'from','as','or','and','but','not','it','its','this','that','these',
  'those','what','which','who','how','why','when','where',
])

function tokenize(text: string): Set<string> {
  // Preserve LaTeX content as opaque tokens before stripping special chars.
  // e.g. $x^2+1$ -> "x21", $\ce{H2SO4}$ -> "h2so4" — so math differs are detected.
  const processed = text
    .toLowerCase()
    .replace(/\$\\ce\{([^}]+)\}/g, (_, c) => ' ' + c.replace(/[^a-z0-9]/g, '') + ' ')
    .replace(/\$([^$\n]+)\$/g,     (_, m) => ' ' + m.replace(/[^a-z0-9]/g, '') + ' ')
    .replace(/[^a-z0-9\s]/g, ' ')

  return new Set(
    processed.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )
}

// Jaccard similarity between two question texts (0-1)
export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (!setA.size || !setB.size) return 0
  const intersection = [...setA].filter(w => setB.has(w)).length
  const union = new Set([...setA, ...setB]).size
  return intersection / union
}

