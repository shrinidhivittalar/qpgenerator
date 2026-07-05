import { describe, it, expect } from 'vitest';
import { detectHeadingsHeuristic } from '../chapterHeuristics.js';

// ────────────────────────────────────────────────────────────────────────────
// Pass 1: structured patterns (chapter / unit / section)
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — clear heading markers (Pass 1)', () => {
  it('detects "Chapter N" headings and returns correct 0-based page indices (TC-HEU-01)', () => {
    const pages = [
      'Chapter 1\nPhotosynthesis converts sunlight into chemical energy.',
      'Normal body text without any heading. Cells are the basic unit.',
      'Chapter 2\nCell respiration releases ATP from glucose.',
      'More body text about enzymes and catalysts.',
      'Chapter 3\nGenetics and DNA replication mechanisms.',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ title: 'Chapter 1', pageIndex: 0 });
    expect(result[1]).toEqual({ title: 'Chapter 2', pageIndex: 2 });
    expect(result[2]).toEqual({ title: 'Chapter 3', pageIndex: 4 });
  });

  it('detects "Unit N" headings', () => {
    const pages = [
      'Unit 1\nIntroduction to organic chemistry.',
      'Unit 2\nAliphatic compounds and their properties.',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ title: 'Unit 1', pageIndex: 0 });
    expect(result[1]).toEqual({ title: 'Unit 2', pageIndex: 1 });
  });

  it('detects "Unit – N" and "Unit - N" dash-separated formats (TC-HEU-07)', () => {
    // Real CBSE textbooks use em-dash and hyphen separators in unit headings.
    const pages = [
      'Unit – 1:   Revisiting AI Project Cycle & Ethical Frameworks',
      'Body text about ethical AI and project lifecycle management.',
      'Unit - 2 :   Advanced Concepts of Modeling in AI',
      'Body text about advanced modeling.',
      'UNIT   3:   Evaluating Models',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(3);
    expect(result[0].pageIndex).toBe(0);
    expect(result[1].pageIndex).toBe(2);
    expect(result[2].pageIndex).toBe(4);
    // Dash-format titles are returned verbatim
    expect(result[0].title).toMatch(/^unit\s*[-–]/i);
  });

  it('picks only the first matching line per page — one candidate per page', () => {
    const pages = [
      // Both "Chapter 1" and "Chapter 2" appear but only the first is taken
      'Chapter 1\nChapter 2\nSome body text.',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Chapter 1');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TOC-page skip: pages with >= 2 structural matches are table-of-contents pages
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — TOC page skipping (TC-HEU-08)', () => {
  it('skips a TOC page listing multiple units and detects the real unit start pages', () => {
    // Pages 0-1: table of contents (multiple unit refs → skip)
    // Pages 2,4,6: real unit start pages (one unit heading each → detect)
    const pages = [
      // TOC page listing Unit 1, 2, 3, 4
      'Unit 1: Introduction\nUnit 2: Advanced\nUnit 3: Evaluation\nUnit 4: Statistics',
      // TOC continuation listing Unit 5, 6
      'Unit 5: Computer Vision\nUnit 6: NLP',
      // Actual Unit 1 start
      'Unit 1: Introduction\nLesson Title: What is AI?\nSummary: Students explore AI basics.',
      'Body text for unit 1. Long paragraphs about AI concepts.',
      // Actual Unit 2 start
      'Unit 2: Advanced Concepts\nLesson Title: Modeling\nSummary: Advanced techniques.',
      'Body text for unit 2. Detailed content about ML models.',
      // Actual Unit 3 start
      'Unit 3: Evaluation\nLesson Title: Metrics\nSummary: Evaluation strategies.',
    ];

    const result = detectHeadingsHeuristic(pages);

    // Pages 0 and 1 (TOC) must be skipped; pages 2, 4, 6 are the real starts
    expect(result).toHaveLength(3);
    expect(result.map(r => r.pageIndex)).toEqual([2, 4, 6]);
  });

  it('does not skip a page with only 1 structural match (real chapter start)', () => {
    const pages = [
      'Unit 1: Introduction to Chemistry\nLesson content follows here.',
      'Body text page.',
      'Unit 2: Advanced Chemistry\nMore detailed content about bonds.',
    ];

    const result = detectHeadingsHeuristic(pages);

    // Neither page has >= 2 structural matches, so neither is skipped
    expect(result).toHaveLength(2);
    expect(result[0].pageIndex).toBe(0);
    expect(result[1].pageIndex).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Pass 2: fallback to numbered-list and ALL-CAPS (no chapter/unit structure)
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — fallback patterns (Pass 2)', () => {
  it('detects numbered-title format "N. Title" when no structured headings exist (TC-HEU-02)', () => {
    const pages = [
      '1. Photosynthesis\nLight-dependent and light-independent reactions.',
      '2. Cellular Respiration\nGlycolysis, Krebs cycle, oxidative phosphorylation.',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('1. Photosynthesis');
    expect(result[1].title).toBe('2. Cellular Respiration');
  });

  it('suppresses numbered-list false positives when structured (unit) headings exist (TC-HEU-09)', () => {
    // When a document has real unit headings, Pass 1 succeeds and Pass 2 is never run.
    // Numbered exam questions in the same document must NOT appear as candidates.
    const pages = [
      'Unit 1: Introduction\nLesson content here.',
      '1. What is the primary function of mitochondria?\n(A) Photosynthesis (B) ATP synthesis',
      'Unit 2: Advanced Topics\nDetailed lesson content for advanced students.',
      '2. Identify the correct statement about DNA replication.',
    ];

    const result = detectHeadingsHeuristic(pages);

    // Only unit headings — no numbered exam questions
    expect(result).toHaveLength(2);
    expect(result.every(r => /^unit/i.test(r.title))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SECTION A / Section-B style headings (Indian exam papers, CBSE PDFs)
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — section-based headings (TC-HEU-06)', () => {
  it('detects "SECTION - A" and "SECTION - B" standalone headings', () => {
    const pages = [
      // Page with body text that also embeds "Section-B." in a sentence — should
      // NOT match (trailing "." prevents the $ anchor from firing).
      'General Instructions:\nThis paper has two sections: Section-A &\nSection-B.\nSECTION - A\n(Objective Type Questions)',
      'Body text of section A. Questions about employability skills.',
      'SECTION - B\n(Subjective Type Questions)',
    ];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ title: 'SECTION - A', pageIndex: 0 });
    expect(result[1]).toEqual({ title: 'SECTION - B', pageIndex: 2 });
  });

  it('does NOT match "Section-B." with trailing period (in-sentence fragment)', () => {
    const pages = ['This paper covers Section-B. Read all instructions.'];
    expect(detectHeadingsHeuristic(pages)).toHaveLength(0);
  });

  it('matches "Section A" (space-separated, no dash)', () => {
    const pages = ['Section A\nObjective questions follow.', 'Section B\nSubjective questions follow.'];
    const result = detectHeadingsHeuristic(pages);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Section A');
    expect(result[1].title).toBe('Section B');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// No heading content
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — no heading-like content', () => {
  it('returns empty array when no page contains a heading pattern (TC-HEU-03)', () => {
    const pages = [
      'The mitochondria is often called the powerhouse of the cell.',
      'Enzymes are biological catalysts that speed up chemical reactions.',
      'Darwin proposed the theory of natural selection in 1859.',
    ];

    expect(detectHeadingsHeuristic(pages)).toHaveLength(0);
  });

  it('returns empty array for an empty pages array', () => {
    expect(detectHeadingsHeuristic([])).toHaveLength(0);
  });

  it('skips lines longer than 80 characters even if they would otherwise match (TC-HEU-04)', () => {
    const longChapterLine = 'Chapter 1 ' + 'x'.repeat(75); // > 80 chars total
    const pages = [longChapterLine];

    expect(detectHeadingsHeuristic(pages)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Known limitation: ALL-CAPS false positives (fallback pass only)
// ────────────────────────────────────────────────────────────────────────────
describe('detectHeadingsHeuristic — known ALL-CAPS false positives', () => {
  it('KNOWN LIMITATION: a short ALL-CAPS pull-quote matches in fallback pass (TC-HEU-05)', () => {
    // A bolded pull-quote like "GREAT MINDS THINK ALIKE" satisfies the
    // /^[A-Z][A-Z\s]{4,60}$/ pattern. Plain-text extraction loses font
    // size/weight information, so this is not eliminable with regex alone.
    // This fallback-pass detection only fires when the document has no
    // chapter/unit/section structure. Stage 1d's review step is the intended
    // gate for these false positives.
    const pages = ['GREAT MINDS THINK ALIKE'];

    const result = detectHeadingsHeuristic(pages);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('GREAT MINDS THINK ALIKE');
    // Asserting length 1 here is intentional — we are DOCUMENTING the known
    // false-positive behaviour, not treating it as a test failure.
  });

  it('does NOT false-positive on an ALL-CAPS sentence longer than 80 chars', () => {
    const longCaps = 'THE COMPLETE HISTORY OF ANCIENT CIVILISATIONS FROM MESOPOTAMIA TO CLASSICAL GREECE';
    expect(longCaps.length).toBeGreaterThan(80);

    const pages = [longCaps];

    expect(detectHeadingsHeuristic(pages)).toHaveLength(0);
  });
});
