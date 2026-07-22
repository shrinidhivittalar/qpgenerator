import katex from 'katex'

type Segment =
  | { type: 'text';    content: string }
  | { type: 'inline';  content: string }
  | { type: 'display'; content: string }

/**
 * Restore LaTeX commands mangled by JSON's built-in escape processing.
 * When an LLM outputs  \times  inside a JSON string, the JSON parser sees  \t
 * (a recognised escape for TAB) and converts it to an actual TAB character,
 * silently discarding the backslash. Same for  \frac  (\f = form-feed) etc.
 * We detect those corrupted sequences and put the backslash back.
 *
 * In JS regex literals  \t  /  \f  /  \n  match the real control characters,
 * so the patterns below match exactly the corrupted bytes.
 */
function fixJsonMangledLatex(s: string): string {
  return s
    // \t escape → TAB ;  LaTeX commands starting with  t
    .replace(/\times/g,          '\\times')
    .replace(/\theta/g,          '\\theta')
    .replace(/\text\{/g,         '\\text{')
    .replace(/\textbf\{/g,       '\\textbf{')
    .replace(/\textit\{/g,       '\\textit{')
    // \f escape → form-feed;  commands starting with  f
    .replace(/\frac\{/g,         '\\frac{')
    .replace(/\frac([^{])/g,     '\\frac$1')
    // \n escape → newline;  commands starting with  n  (only in math-like contexts)
    .replace(/\neq/g,            '\\neq')
}

/**
 * Fix human-readable quote marks that the LLM sometimes encodes as LaTeX commands.
 * Works on text that still has literal backslashes (properly stored).
 */
function fixLatexQuotes(s: string): string {
  return s
    .replace(/\\text\{\\textquotesingle\}/g, "'")
    .replace(/\\text\{\\textquoteright\}/g,  "'")
    .replace(/\\text\{\\textquoteleft\}/g,   '‘')
    .replace(/\\text\{\\textquotedbl\}/g,    '"')
    .replace(/\\textquotesingle/g,           "'")
}

/**
 * Auto-wrap bare \times / \cdot / \div chains that appear outside $...$
 * in math-expression context (digits on both sides).
 * e.g.  "52\times 2"  →  "$52\times 2$"
 */
function wrapBareMath(s: string): string {
  // Protect existing $...$ blocks, only touch the gaps between them
  const parts = s.split(/(\$\$?[^$]+?\$\$?)/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part   // inside existing $...$ — leave alone
    return part.replace(
      /\d[\d.]*(?:\s*\\(?:times|cdot|div|pm)\s*\d[\d.]*)+/g,
      (m) => `$${m.trim()}$`,
    )
  }).join('')
}

function preprocessText(raw: string): string {
  return wrapBareMath(fixLatexQuotes(fixJsonMangledLatex(raw)))
}

function parseSegments(text: string): Segment[] {
  const processed = preprocessText(text)
  const segments: Segment[] = []
  const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(processed)) !== null) {
    if (match.index > last)
      segments.push({ type: 'text', content: processed.slice(last, match.index) })

    const raw = match[0]
    if (raw.startsWith('$$'))
      segments.push({ type: 'display', content: raw.slice(2, -2).trim() })
    else
      segments.push({ type: 'inline', content: raw.slice(1, -1).trim() })

    last = match.index + raw.length
  }

  if (last < processed.length)
    segments.push({ type: 'text', content: processed.slice(last) })

  return segments
}

function renderLatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode:  display,
      throwOnError: false,
      trust:        false,
      strict:       false,
    })
  } catch {
    return `<span style="color:red;font-family:monospace">${latex}</span>`
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/\n/g, '<br/>')
}

// Use this in plain HTML contexts (e.g. the print/export function)
export function mathToHtml(text: string): string {
  return parseSegments(text)
    .map(seg =>
      seg.type === 'text'
        ? escapeHtml(seg.content)
        : renderLatex(seg.content, seg.type === 'display')
    )
    .join('')
}

interface Props {
  text:       string
  className?: string
}

export function MathText({ text, className }: Props) {
  const segments = parseSegments(text)

  // Fast path — no math; use preprocessed content so quote/TAB fixes apply
  if (segments.length === 1 && segments[0].type === 'text')
    return <span className={className}>{segments[0].content}</span>

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: mathToHtml(text) }}
    />
  )
}
