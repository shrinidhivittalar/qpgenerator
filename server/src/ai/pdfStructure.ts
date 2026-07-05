type PDFTextItem = {
  str:       string;
  hasEOL?:   boolean;   // pdfjs-dist 3.x: true when this item ends a line
  transform?: number[]; // [a,b,c,d,tx,ty] — ty is the vertical baseline position
};

type PDFPage = {
  getTextContent: () => Promise<{ items: PDFTextItem[] }>;
};

type PDFDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PDFPage>;
  getOutline: () => Promise<OutlineNode[] | null>;
  getDestination: (id: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: unknown) => Promise<number>;
};

type OutlineNode = {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
};

async function getPdfjs(): Promise<{ getDocument: (opts: unknown) => { promise: Promise<PDFDocumentProxy> } }> {
  const lib = await import('pdfjs-dist/legacy/build/pdf.js');
  const pdfjsLib = (lib as any).default ?? lib;
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }
  return pdfjsLib;
}

export async function extractTextPerPage(buffer: Buffer): Promise<string[]> {
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    let text = '';
    let prevY: number | null = null;
    let prevHasEOL = false;

    for (const item of content.items) {
      if (!item.str) {
        // Empty items can still carry hasEOL; track it so the next real item
        // gets a newline prefix if warranted.
        if (item.hasEOL) prevHasEOL = true;
        continue;
      }
      if (text !== '') {
        // hasEOL is the authoritative signal (pdfjs-dist 3.x+). Fall back to
        // vertical-position delta when hasEOL is absent (some PDF generators
        // don't emit EOL markers in the content stream).
        const isNewLine =
          prevHasEOL ||
          (item.transform != null && prevY !== null && Math.abs(item.transform[5] - prevY) > 5);
        text += isNewLine ? '\n' : ' ';
      }
      prevHasEOL = item.hasEOL === true;
      if (item.transform != null) prevY = item.transform[5];
      text += item.str;
    }

    pages.push(text.trim());
  }

  return pages;
}

export async function extractOutline(
  buffer: Buffer,
): Promise<{ title: string; pageNumber: number }[] | null> {
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const outline = await doc.getOutline();

  if (!outline || outline.length === 0) return null;

  const resolved: { title: string; pageNumber: number }[] = [];
  for (const entry of outline) {
    const pageNumber = await resolveDestPageNumber(doc, entry.dest);
    if (pageNumber !== null) {
      resolved.push({ title: entry.title, pageNumber });
    }
  }

  if (resolved.length < 2) return null;
  return resolved.sort((a, b) => a.pageNumber - b.pageNumber);
}

async function resolveDestPageNumber(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  if (!dest) return null;

  let explicitDest: unknown[];
  if (typeof dest === 'string') {
    const resolved = await doc.getDestination(dest);
    if (!resolved) return null;
    explicitDest = resolved;
  } else if (Array.isArray(dest)) {
    explicitDest = dest;
  } else {
    return null;
  }

  if (explicitDest.length === 0) return null;

  const pageRef = explicitDest[0];
  try {
    const pageIndex = await doc.getPageIndex(pageRef);
    return pageIndex + 1;
  } catch {
    return null;
  }
}
