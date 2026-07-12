/**
 * Converts text containing inline LaTeX ($...$) to an array of TextRun | Math
 * nodes for use in docx paragraphs.
 *
 * Handles the LaTeX subset common in Class X math exam papers:
 *   - Superscripts / subscripts: x^2, a_{n+1}, x^{n+1}
 *   - Fractions: \frac{a}{b}
 *   - Radicals: \sqrt{x}, \sqrt[3]{x}
 *   - Named functions: \sin, \cos, \tan, \log, \ln …
 *   - Greek letters: \theta, \pi, \alpha …
 *   - Common symbols: \times, \pm, \leq, \angle …
 *   - Brackets: \left( \right), ( ), [ ]
 */

import {
  Math as DocxMath,
  MathFraction,
  MathFunction,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  TextRun,
  type IRunOptions,
} from 'docx';

// ── Symbol tables ─────────────────────────────────────────────────────────────

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', varpi: 'π', rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', star: '★',
  leq: '≤', geq: '≥', le: '≤', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', sim: '∼', cong: '≅', equiv: '≡', propto: '∝',
  angle: '∠', measuredangle: '∡', triangle: '△', square: '□',
  infty: '∞', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  because: '∵', therefore: '∴', implies: '⟹',
  rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⟺',
  uparrow: '↑', downarrow: '↓',
  parallel: '∥', perp: '⊥', circ: '°',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', nexists: '∄',
  neg: '¬', land: '∧', lor: '∨',
  nabla: '∇', partial: '∂', hbar: 'ℏ',
  mathbb: '',  // handled separately
};

const TRIG = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup', 'inf',
  'det', 'gcd', 'lcm', 'mod', 'arg',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

type MC =
  | InstanceType<typeof MathRun>
  | InstanceType<typeof MathFraction>
  | InstanceType<typeof MathRadical>
  | InstanceType<typeof MathSuperScript>
  | InstanceType<typeof MathSubScript>
  | InstanceType<typeof MathSubSuperScript>
  | InstanceType<typeof MathFunction>
  | InstanceType<typeof MathRoundBrackets>
  | InstanceType<typeof MathSquareBrackets>;

// ── Parser ────────────────────────────────────────────────────────────────────

class LatexParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): MC[] {
    return this.parseSeq();
  }

  private ch(): string { return this.src[this.pos] ?? ''; }
  private eat(): string { return this.src[this.pos++] ?? ''; }

  private skip(): void {
    while (this.pos < this.src.length && /[ \t]/.test(this.src[this.pos])) this.pos++;
  }

  // Parse a sequence of math nodes until end or stop char.
  private parseSeq(stop?: string): MC[] {
    const out: MC[] = [];
    while (this.pos < this.src.length) {
      this.skip();
      if (!this.ch() || (stop && this.ch() === stop)) break;

      // Inline group {…} — parse contents and check for trailing ^ / _
      if (this.ch() === '{') {
        this.eat();
        const inner = this.parseSeq('}');
        if (this.ch() === '}') this.eat();
        out.push(...this.withScripts(inner));
        continue;
      }

      const atom = this.parseAtom();
      if (atom === null) break;
      out.push(...this.withScripts([atom]));
    }
    return out;
  }

  // Wrap a base with any trailing ^ / _ scripts.
  private withScripts(base: MC[]): MC[] {
    this.skip();
    let sup: MC[] | undefined;
    let sub: MC[] | undefined;

    if (this.ch() === '^') { this.eat(); sup = this.parseArg(); this.skip(); }
    if (this.ch() === '_') { this.eat(); sub = this.parseArg(); this.skip(); }
    // Reverse order: _ before ^
    if (!sup && this.ch() === '^') { this.eat(); sup = this.parseArg(); }

    if (sup && sub) return [new MathSubSuperScript({ children: base, superScript: sup, subScript: sub })];
    if (sup)        return [new MathSuperScript({ children: base, superScript: sup })];
    if (sub)        return [new MathSubScript({ children: base, subScript: sub })];
    return base;
  }

  // Parse a single non-group atom.
  private parseAtom(): MC | null {
    const c = this.ch();
    if (!c || c === '}') return null;

    if (c === '\\') return this.parseCommand();

    if (c === '(') {
      this.eat();
      const inner = this.parseSeq(')');
      if (this.ch() === ')') this.eat();
      return new MathRoundBrackets({ children: inner });
    }

    if (c === '[') {
      this.eat();
      const inner = this.parseSeq(']');
      if (this.ch() === ']') this.eat();
      return new MathSquareBrackets({ children: inner });
    }

    // Skip alignment char
    if (c === '&') { this.eat(); return new MathRun(' '); }

    this.eat();
    return new MathRun(c);
  }

  // Parse an argument: {group} or a single atom.
  private parseArg(): MC[] {
    this.skip();
    if (this.ch() === '{') {
      this.eat();
      const inner = this.parseSeq('}');
      if (this.ch() === '}') this.eat();
      return inner;
    }
    const atom = this.parseAtom();
    return atom ? [atom] : [new MathRun('')];
  }

  // Parse optional [n] argument (for \sqrt[n]{…}).
  private parseOptional(): MC[] | undefined {
    this.skip();
    if (this.ch() !== '[') return undefined;
    this.eat();
    const inner = this.parseSeq(']');
    if (this.ch() === ']') this.eat();
    return inner.length > 0 ? inner : undefined;
  }

  private parseCommand(): MC | null {
    this.eat(); // consume '\'

    // Read alphabetic command name
    let name = '';
    while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
      name += this.eat();
    }

    // Skip single trailing space after command (LaTeX convention)
    if (this.src[this.pos] === ' ') this.eat();

    if (!name) {
      // Special escaped char
      const c = this.eat();
      const map: Record<string, string> = { '{': '{', '}': '}', '\\': '\n', ',': ' ', ';': ' ', '!': '', '|': '|' };
      return new MathRun(map[c] ?? c);
    }

    if (GREEK[name])   return new MathRun(GREEK[name]);
    if (SYMBOLS[name]) return new MathRun(SYMBOLS[name]);

    if (name === 'frac') {
      const numerator   = this.parseArg();
      const denominator = this.parseArg();
      return new MathFraction({ numerator, denominator });
    }

    if (name === 'sqrt') {
      const degree   = this.parseOptional();
      const children = this.parseArg();
      return new MathRadical({ children, degree });
    }

    if (TRIG.has(name)) {
      return new MathFunction({
        name:     [new MathRun(name)],
        children: [],
      });
    }

    if (name === 'text' || name === 'mathrm' || name === 'mathit' || name === 'mathbf' || name === 'mathsf') {
      const arg = this.parseArg();
      return arg.length === 1 ? arg[0] : (arg[0] ?? new MathRun(''));
    }

    if (name === 'left') {
      const bracket = this.eat(); // ( [ | etc.
      const inner   = this.parseUntilRight();
      return bracket === '[' ? new MathSquareBrackets({ children: inner })
                             : new MathRoundBrackets({ children: inner });
    }

    if (name === 'right') {
      this.eat(); // consume closing bracket char — handled by parseUntilRight
      return null;
    }

    // Unknown — render as literal text
    return new MathRun('\\' + name);
  }

  private parseUntilRight(): MC[] {
    const out: MC[] = [];
    while (this.pos < this.src.length) {
      if (this.src.startsWith('\\right', this.pos)) break;
      this.skip();
      if (!this.ch()) break;
      if (this.ch() === '{') {
        this.eat();
        const inner = this.parseSeq('}');
        if (this.ch() === '}') this.eat();
        out.push(...this.withScripts(inner));
      } else {
        const atom = this.parseAtom();
        if (atom) out.push(...this.withScripts([atom]));
      }
    }
    return out;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a LaTeX string (no delimiters) to an array of Math components.
 */
function latexToComponents(latex: string): MC[] {
  return new LatexParser(latex.trim()).parse();
}

/**
 * Split text on $…$ delimiters and return an array of TextRun | Math nodes.
 * Preserves non-math text as styled TextRun instances.
 */
// Scan text for $…$ math regions. A `$` only opens a math region when the
// content up to the NEXT `$` looks like LaTeX (has \, ^, _, {, } or is short
// with no English words). Currency amounts like `$8000` never open a region.
//
// This must NOT use a greedy regex like /\$([^$]+)\$/ because that would swallow
// `$8000. If she gets an annual increment of $500` as one big match.
function splitOnMathDollar(
  text: string,
): Array<{ kind: 'text' | 'math'; content: string }> {
  const segments: Array<{ kind: 'text' | 'math'; content: string }> = [];
  let i = 0;
  let textStart = 0;

  while (i < text.length) {
    if (text[i] !== '$') { i++; continue; }

    // Found a `$`. Look for the closing `$`.
    const openPos = i;
    let j = openPos + 1;
    while (j < text.length && text[j] !== '$') j++;

    if (j >= text.length) {
      // No closing $ — treat the rest as plain text and stop.
      break;
    }

    const inner = text.slice(openPos + 1, j);

    // Decide if `inner` is LaTeX or currency/plain text.
    const hasLatexSyntax = /[\\^_{}]/.test(inner);
    const isPureNumber   = /^\d[\d,.]*$/.test(inner.trim());
    const isShortExpr    = inner.length <= 25 && !/\s[a-zA-Z]{3,}/.test(inner);
    const isLatex        = hasLatexSyntax || (!isPureNumber && isShortExpr);

    if (isLatex) {
      // Flush pending plain text
      if (openPos > textStart) {
        segments.push({ kind: 'text', content: text.slice(textStart, openPos) });
      }
      segments.push({ kind: 'math', content: inner });
      i = j + 1;
      textStart = i;
    } else {
      // Not LaTeX — skip this `$` and continue scanning from the next character.
      // Do NOT consume the closing `$`; it might open a future math region.
      i = openPos + 1;
    }
  }

  // Remaining plain text
  if (textStart < text.length) {
    segments.push({ kind: 'text', content: text.slice(textStart) });
  }

  return segments;
}

export function renderTextWithMath(
  text: string,
  runOptions: IRunOptions = {},
): (InstanceType<typeof TextRun> | InstanceType<typeof DocxMath>)[] {
  if (!text.includes('$')) {
    return [new TextRun({ text, ...runOptions })];
  }

  const result: (InstanceType<typeof TextRun> | InstanceType<typeof DocxMath>)[] = [];

  for (const seg of splitOnMathDollar(text)) {
    if (seg.kind === 'text') {
      if (seg.content) result.push(new TextRun({ text: seg.content, ...runOptions }));
    } else {
      const children = latexToComponents(seg.content);
      if (children.length > 0) result.push(new DocxMath({ children }));
    }
  }

  return result;
}
