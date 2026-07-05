// False positives are expected (ALL-CAPS pull-quotes, section labels that
// aren't chapters) and false negatives are inevitable (headings conveyed
// only through font size/weight, which plain-text extraction discards).
// This heuristic is a best-effort first pass; Stage 1d's human review step
// is the intended gate for filtering noise — do not try to make the regex
// perfect from plain text alone.

// Reliable structural patterns — chapter/unit/section with optional dash separators.
// Used both as candidates and as a TOC-detection signal: a page with >= 2
// structural matches is almost certainly a table of contents, not a chapter start.
const STRUCTURE_PATTERNS = [
  /^chapter\s*[-–]?\s*\d+/i,     // "Chapter 1", "Chapter – 2", "Chapter - 3"
  /^unit\s*[-–]?\s*\d+/i,        // "Unit 1", "Unit – 1:", "Unit - 2 :"
  /^section\s*[-–\s]*[A-Z]$/i,   // "SECTION A", "SECTION - B" (standalone, $ required)
];

// Broader patterns for documents that lack chapter/unit/section structure.
// These have higher false-positive rates, so they are only applied in the
// fallback pass when STRUCTURE_PATTERNS yield < 2 candidates.
const FALLBACK_PATTERNS = [
  ...STRUCTURE_PATTERNS,
  /^\d+\.\s+[A-Z]/,         // "1. Photosynthesis"
  /^[A-Z][A-Z\s]{4,60}$/,  // ALL CAPS short standalone line (no punctuation)
];

export function detectHeadingsHeuristic(
  pages: string[],
): { title: string; pageIndex: number }[] {
  // ── Pass 1: structured patterns only, with TOC-page skip ──────────────────
  // If a page contains >= 2 lines that match STRUCTURE_PATTERNS it is almost
  // certainly a table of contents listing multiple chapters — skip the whole
  // page so we don't pick up TOC entries instead of real chapter starts.
  const structuredCandidates = collectCandidates(pages, STRUCTURE_PATTERNS, true);

  // If the document has clear chapter/unit/section structure, return those
  // results directly. Numbered-list and ALL-CAPS patterns are intentionally
  // suppressed here to avoid false positives from exam questions and pull-quotes
  // that are common in textbooks with real chapter headings.
  if (structuredCandidates.length >= 2) return structuredCandidates;

  // ── Pass 2: fallback to all patterns ─────────────────────────────────────
  // Used for documents without explicit chapter/unit structure (e.g. exam
  // papers with Section A/B, or documents whose only headings are ALL-CAPS).
  // TOC-skip is not applied here because such documents rarely have TOC pages.
  return collectCandidates(pages, FALLBACK_PATTERNS, false);
}

function collectCandidates(
  pages: string[],
  patterns: RegExp[],
  skipTocPages: boolean,
): { title: string; pageIndex: number }[] {
  const candidates: { title: string; pageIndex: number }[] = [];

  pages.forEach((pageText, pageIndex) => {
    const lines = pageText
      .split(/\n|\.\s{2,}/)
      .map(l => l.trim())
      .filter(Boolean);

    if (skipTocPages) {
      // Count how many short lines match the structured patterns.
      // >= 2 means this page lists multiple chapters → it's a TOC or index.
      const structuredCount = lines.filter(
        l => l.length <= 80 && STRUCTURE_PATTERNS.some(p => p.test(l)),
      ).length;
      if (structuredCount >= 2) return;
    }

    for (const line of lines) {
      if (line.length > 80) continue; // body paragraphs are long; headings are short
      if (patterns.some(p => p.test(line))) {
        candidates.push({ title: line, pageIndex });
        break; // one heading candidate per page is enough signal
      }
    }
  });

  return candidates;
}
