import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pdfjs-dist before any import of pdfStructure so the dynamic import
// inside getPdfjs() sees the mock rather than the real library.
vi.mock('pdfjs-dist/legacy/build/pdf.js', () => {
  const getDocument = vi.fn();
  return {
    default: {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument,
    },
    __mockGetDocument: getDocument,
  };
});

async function getDocumentMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('pdfjs-dist/legacy/build/pdf.js');
  return (mod as any).__mockGetDocument as ReturnType<typeof vi.fn>;
}

import { extractTextPerPage, extractOutline } from '../pdfStructure.js';

// Any Buffer works — pdfjs is fully mocked, so only the mock's return value matters.
const DUMMY_BUFFER = Buffer.from('PDF mock bytes');

function makeDoc(overrides: {
  numPages?: number;
  pageTexts?: string[];
  outline?: any[] | null;
  getDestinationFn?: (name: string) => Promise<unknown[] | null>;
  getPageIndexFn?: (ref: unknown) => Promise<number>;
}) {
  const {
    numPages = 0,
    pageTexts = [],
    outline = null,
    getDestinationFn = async () => null,
    getPageIndexFn = async () => { throw new Error('unknown ref'); },
  } = overrides;

  return {
    numPages,
    getPage: vi.fn().mockImplementation((i: number) => Promise.resolve({
      getTextContent: () => Promise.resolve({
        items: (pageTexts[i - 1] ?? `Page ${i} text`).split(' ').map(str => ({ str })),
      }),
    })),
    getOutline: vi.fn().mockResolvedValue(outline),
    getDestination: vi.fn().mockImplementation(getDestinationFn),
    getPageIndex: vi.fn().mockImplementation(getPageIndexFn),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// extractTextPerPage
// ────────────────────────────────────────────────────────────────────────────
describe('extractTextPerPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an array with one entry per page, each non-empty (TC-PDF-01)', async () => {
    const getDocument = await getDocumentMock();
    const doc = makeDoc({
      numPages: 3,
      pageTexts: [
        'Photosynthesis converts light to sugar',
        'Cell respiration releases ATP energy',
        'DNA replication is semiconservative',
      ],
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const pages = await extractTextPerPage(DUMMY_BUFFER);

    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('Photosynthesis');
    expect(pages[1]).toContain('ATP');
    expect(pages[2]).toContain('DNA');
    expect(pages.every(p => p.length > 0)).toBe(true);
  });

  it('passes buffer as Uint8Array to getDocument (TC-PDF-02)', async () => {
    const getDocument = await getDocumentMock();
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(makeDoc({ numPages: 0 })) });

    await extractTextPerPage(DUMMY_BUFFER);

    const arg = getDocument.mock.calls[0][0] as { data: unknown };
    expect(arg.data).toBeInstanceOf(Uint8Array);
  });

  it('returns empty array for a zero-page document (TC-PDF-03)', async () => {
    const getDocument = await getDocumentMock();
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(makeDoc({ numPages: 0 })) });

    const pages = await extractTextPerPage(DUMMY_BUFFER);

    expect(pages).toHaveLength(0);
  });

  it('inserts newlines where pdfjs marks hasEOL=true (TC-PDF-10)', async () => {
    const getDocument = await getDocumentMock();
    const doc = makeDoc({ numPages: 1 });
    doc.getPage.mockResolvedValueOnce({
      getTextContent: () => Promise.resolve({
        items: [
          { str: 'Chapter 1', hasEOL: true },
          { str: 'Introduction to Chemistry', hasEOL: false },
        ],
      }),
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const pages = await extractTextPerPage(DUMMY_BUFFER);

    expect(pages[0]).toBe('Chapter 1\nIntroduction to Chemistry');
  });

  it('inserts newlines from vertical position changes when hasEOL is absent (TC-PDF-11)', async () => {
    const getDocument = await getDocumentMock();
    const doc = makeDoc({ numPages: 1 });
    // transform is [a, b, c, d, tx, ty] — ty at index 5 is the baseline y-position.
    // Difference of 20 units between items → clearly different lines.
    doc.getPage.mockResolvedValueOnce({
      getTextContent: () => Promise.resolve({
        items: [
          { str: 'Chapter 2', transform: [1, 0, 0, 1, 50, 700] },
          { str: 'Cell Biology', transform: [1, 0, 0, 1, 50, 680] },
          { str: 'and Genetics', transform: [1, 0, 0, 1, 120, 680] },
        ],
      }),
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const pages = await extractTextPerPage(DUMMY_BUFFER);

    // y-diff of 20 → newline between first and second item.
    // y-diff of 0 → space between "Cell Biology" and "and Genetics" (same line).
    expect(pages[0]).toBe('Chapter 2\nCell Biology and Genetics');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractOutline — no bookmarks
// ────────────────────────────────────────────────────────────────────────────
describe('extractOutline — PDF with no bookmarks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when getOutline() returns null (TC-PDF-04)', async () => {
    const getDocument = await getDocumentMock();
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(makeDoc({ numPages: 10, outline: null })) });

    expect(await extractOutline(DUMMY_BUFFER)).toBeNull();
  });

  it('returns null when getOutline() returns an empty array (TC-PDF-05)', async () => {
    const getDocument = await getDocumentMock();
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(makeDoc({ numPages: 10, outline: [] })) });

    expect(await extractOutline(DUMMY_BUFFER)).toBeNull();
  });

  it('returns null when only 1 entry resolves (fewer than 2 needed) (TC-PDF-06)', async () => {
    const getDocument = await getDocumentMock();
    const pageRef = { num: 0, gen: 0 };
    const doc = makeDoc({
      numPages: 5,
      outline: [{ title: 'Only Chapter', dest: [pageRef] }],
      getPageIndexFn: async (ref) => (ref === pageRef ? 0 : (() => { throw new Error(); })()),
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    expect(await extractOutline(DUMMY_BUFFER)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractOutline — PDF with bookmarks (explicit dest array)
// ────────────────────────────────────────────────────────────────────────────
describe('extractOutline — PDF with clear top-level bookmarks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns entries sorted ascending by pageNumber with non-empty titles (TC-PDF-07)', async () => {
    const getDocument = await getDocumentMock();

    // Use shared ref objects so identity checks work in getPageIndexFn
    const ref0  = { num: 0,  gen: 0 };
    const ref14 = { num: 14, gen: 0 };
    const ref29 = { num: 29, gen: 0 };

    const doc = makeDoc({
      numPages: 45,
      outline: [
        { title: 'Chapter 3: Genetics',     dest: [ref29, { name: 'Fit' }] },
        { title: 'Chapter 1: Cell Biology', dest: [ref0,  { name: 'Fit' }] },
        { title: 'Chapter 2: Evolution',    dest: [ref14, { name: 'Fit' }] },
      ],
      getPageIndexFn: async (ref) => {
        if (ref === ref0)  return 0;
        if (ref === ref14) return 14;
        if (ref === ref29) return 29;
        throw new Error('Unknown ref');
      },
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const outline = await extractOutline(DUMMY_BUFFER);

    expect(outline).not.toBeNull();
    expect(outline!).toHaveLength(3);
    expect(outline!.map(e => e.pageNumber)).toEqual([1, 15, 30]);
    expect(outline![0].title).toBe('Chapter 1: Cell Biology');
    expect(outline![1].title).toBe('Chapter 2: Evolution');
    expect(outline![2].title).toBe('Chapter 3: Genetics');
    expect(outline!.every(e => e.title.length > 0)).toBe(true);
  });

  it('resolves named string destinations via getDestination (TC-PDF-08)', async () => {
    const getDocument = await getDocumentMock();

    const refIntro   = { num: 0, gen: 0 };
    const refMethods = { num: 9, gen: 0 };
    const refResults = { num: 14, gen: 0 };

    const doc = makeDoc({
      numPages: 20,
      outline: [
        { title: 'Introduction', dest: 'intro'   },
        { title: 'Methodology',  dest: 'methods' },
        { title: 'Results',      dest: 'results' },
      ],
      getDestinationFn: async (name) => {
        if (name === 'intro')   return [refIntro,   { name: 'XYZ' }];
        if (name === 'methods') return [refMethods, { name: 'XYZ' }];
        if (name === 'results') return [refResults, { name: 'XYZ' }];
        return null;
      },
      getPageIndexFn: async (ref) => {
        if (ref === refIntro)   return 0;
        if (ref === refMethods) return 9;
        if (ref === refResults) return 14;
        throw new Error('Unknown ref');
      },
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const outline = await extractOutline(DUMMY_BUFFER);

    expect(outline).not.toBeNull();
    expect(outline!.map(e => e.pageNumber)).toEqual([1, 10, 15]);
    expect(outline!.map(e => e.title)).toEqual(['Introduction', 'Methodology', 'Results']);
  });

  it('excludes entries where getPageIndex throws; returns null if fewer than 2 remain (TC-PDF-09)', async () => {
    const getDocument = await getDocumentMock();

    const goodRef = { num: 0, gen: 0 };
    const badRef  = { num: 99, gen: 0 };

    const doc = makeDoc({
      numPages: 10,
      outline: [
        { title: 'Valid Chapter',  dest: [goodRef] },
        { title: 'Broken Chapter', dest: [badRef]  },
      ],
      getPageIndexFn: async (ref) => {
        if (ref === goodRef) return 0;
        throw new Error('Page index unavailable');
      },
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    // Only 1 entry resolves — below the minimum of 2
    expect(await extractOutline(DUMMY_BUFFER)).toBeNull();
  });
});
