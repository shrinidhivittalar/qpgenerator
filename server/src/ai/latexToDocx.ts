/**
 * Converts text containing inline LaTeX ($...$) to an array of TextRun nodes.
 *
 * Math spans are rendered as italicised plain text with Unicode substitutions
 * (x², √(x), α, ≤, …) rather than OMML. This is intentional: mixing DocxMath
 * nodes with TextRun nodes in a Paragraph requires the docx file to declare the
 * OOXML math namespace relationship, which the docx library does not reliably
 * emit in inline context — causing Word to report the file as corrupted.
 * Unicode-substituted italic text is readable, never corrupts, and matches the
 * style used in most printed Indian board exam papers anyway.
 */

import { TextRun, type IRunOptions } from 'docx';

// ── Symbol tables ─────────────────────────────────────────────────────────────

const SUPERSCRIPTS: Record<string, string> = {
  '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴',
  '5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',
  'n':'ⁿ','i':'ⁱ','a':'ᵃ','b':'ᵇ','c':'ᶜ',
  '+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾',
};

const SUBSCRIPTS: Record<string, string> = {
  '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄',
  '5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
  'n':'ₙ','i':'ᵢ','a':'ₐ','e':'ₑ','o':'ₒ',
  '+':'₊','-':'₋','=':'₌','(':'₍',')':'₎',
};

const COMMANDS: Record<string, string> = {
  // Greek
  alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', varepsilon:'ε',
  zeta:'ζ', eta:'η', theta:'θ', vartheta:'θ', iota:'ι', kappa:'κ',
  lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', pi:'π', rho:'ρ', sigma:'σ',
  tau:'τ', upsilon:'υ', phi:'φ', varphi:'φ', chi:'χ', psi:'ψ', omega:'ω',
  Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ',
  Pi:'Π', Sigma:'Σ', Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
  // Operators / symbols
  times:'×', div:'÷', pm:'±', mp:'∓', cdot:'·',
  leq:'≤', geq:'≥', le:'≤', ge:'≥', neq:'≠', ne:'≠',
  approx:'≈', sim:'~', cong:'≅', equiv:'≡', propto:'∝',
  angle:'∠', triangle:'△', infty:'∞', ldots:'…', cdots:'⋯',
  because:'∵', therefore:'∴',
  rightarrow:'→', leftarrow:'←', Rightarrow:'⇒', Leftarrow:'⇐',
  leftrightarrow:'↔', Leftrightarrow:'⟺', implies:'⟹',
  uparrow:'↑', downarrow:'↓',
  parallel:'∥', perp:'⊥', circ:'°',
  in:'∈', notin:'∉', subset:'⊂', subseteq:'⊆',
  cup:'∪', cap:'∩', forall:'∀', exists:'∃',
  nabla:'∇', partial:'∂',
  // Trig / functions — render as plain text
  sin:'sin', cos:'cos', tan:'tan', sec:'sec', csc:'csc', cot:'cot',
  arcsin:'arcsin', arccos:'arccos', arctan:'arctan',
  sinh:'sinh', cosh:'cosh', tanh:'tanh',
  log:'log', ln:'ln', exp:'exp', lim:'lim',
  max:'max', min:'min', sup:'sup', inf:'inf',
  det:'det', gcd:'gcd', lcm:'lcm', mod:'mod', arg:'arg',
  // Misc
  sqrt:'√',
};

// ── LaTeX → plain Unicode text ────────────────────────────────────────────────

function latexToPlainText(latex: string): string {
  let s = latex.trim();

  // \frac{num}{den} → (num)/(den)
  s = s.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    (_, num, den) => `(${latexToPlainText(num)})/(${latexToPlainText(den)})`);

  // \sqrt[n]{x} → ⁿ√(x)
  s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]*)\}/g,
    (_, n, x) => `${latexToPlainText(n)}√(${latexToPlainText(x)})`);

  // \sqrt{x} → √(x)
  s = s.replace(/\\sqrt\{([^{}]*)\}/g,
    (_, x) => `√(${latexToPlainText(x)})`);

  // \sqrt x (no braces, single char) → √x
  s = s.replace(/\\sqrt\s+(\S)/g, (_, c) => `√${c}`);

  // \left( … \right)  /  \left[ … \right]
  s = s.replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')');
  s = s.replace(/\\left\s*\[/g, '[').replace(/\\right\s*\]/g, ']');
  s = s.replace(/\\left\s*\|/g, '|').replace(/\\right\s*\|/g, '|');

  // \text{…} / \mathrm{…} etc — strip wrapper
  s = s.replace(/\\(?:text|mathrm|mathit|mathbf|mathsf|operatorname)\{([^{}]*)\}/g, '$1');

  // Named commands
  s = s.replace(/\\([a-zA-Z]+)/g, (match, name) => COMMANDS[name] ?? match);

  // Superscripts: ^{expr} or ^c
  s = s.replace(/\^\{([^{}]+)\}/g, (_, inner) => {
    return [...latexToPlainText(inner)].map(c => SUPERSCRIPTS[c] ?? c).join('');
  });
  s = s.replace(/\^([A-Za-z0-9])/g, (_, c) => SUPERSCRIPTS[c] ?? `^${c}`);

  // Subscripts: _{expr} or _c
  s = s.replace(/_\{([^{}]+)\}/g, (_, inner) => {
    return [...latexToPlainText(inner)].map(c => SUBSCRIPTS[c] ?? c).join('');
  });
  s = s.replace(/_([A-Za-z0-9])/g, (_, c) => SUBSCRIPTS[c] ?? `_${c}`);

  // Strip remaining braces used for grouping
  s = s.replace(/[{}]/g, '');

  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ').trim();

  return s;
}

// ── Dollar-sign splitter ──────────────────────────────────────────────────────
// Splits text on $…$ delimiters. A `$` only opens a math region when the inner
// content looks like LaTeX (has \, ^, _, {, } or is short with no English words).
// Currency amounts like `$8000` or `$500` are never treated as math.

function splitOnMathDollar(text: string): Array<{ kind: 'text' | 'math'; content: string }> {
  const segments: Array<{ kind: 'text' | 'math'; content: string }> = [];
  let i = 0;
  let textStart = 0;

  while (i < text.length) {
    if (text[i] !== '$') { i++; continue; }

    const openPos = i;
    let j = openPos + 1;
    while (j < text.length && text[j] !== '$') j++;

    if (j >= text.length) break; // no closing $ — treat rest as plain text

    const inner = text.slice(openPos + 1, j);

    const hasLatexSyntax = /[\\^_{}]/.test(inner);
    const isPureNumber   = /^\d[\d,.]*$/.test(inner.trim());
    const isShortExpr    = inner.length <= 25 && !/\s[a-zA-Z]{3,}/.test(inner);
    const isLatex        = hasLatexSyntax || (!isPureNumber && isShortExpr);

    if (isLatex) {
      if (openPos > textStart) {
        segments.push({ kind: 'text', content: text.slice(textStart, openPos) });
      }
      segments.push({ kind: 'math', content: inner });
      i = j + 1;
      textStart = i;
    } else {
      i = openPos + 1;
    }
  }

  if (textStart < text.length) {
    segments.push({ kind: 'text', content: text.slice(textStart) });
  }

  return segments;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderTextWithMath(
  text: string,
  runOptions: IRunOptions = {},
): InstanceType<typeof TextRun>[] {
  if (!text) return [];
  if (!text.includes('$')) {
    return [new TextRun({ text, ...runOptions })];
  }

  const result: InstanceType<typeof TextRun>[] = [];

  for (const seg of splitOnMathDollar(text)) {
    if (seg.kind === 'text') {
      if (seg.content) result.push(new TextRun({ text: seg.content, ...runOptions }));
    } else {
      const plain = latexToPlainText(seg.content);
      if (plain) result.push(new TextRun({ text: plain, ...runOptions, italics: true }));
    }
  }

  return result;
}
