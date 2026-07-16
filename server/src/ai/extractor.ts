import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

// ponytail: scanned PDF → OCR deferred; only images get OCR. Add pdf2pic+ghostscript when PDF→OCR is needed.
export async function extractText(buffer: Buffer, mimetype = 'application/pdf'): Promise<string> {
  if (IMAGE_TYPES.has(mimetype)) {
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    const t = text.trim();
    if (t.length === 0) throw new Error('EXTRACTION_FAILED');
    return t;
  }

  let result: { text: string };
  try {
    result = await pdfParse(buffer);
  } catch {
    throw new Error('EXTRACTION_FAILED');
  }
  const text = result.text.trim();
  if (text.length < 100) throw new Error('SCANNED_PDF');
  return text;
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch {
    throw new Error('EXTRACTION_FAILED');
  }
  const text = result.value.trim();
  if (text.length === 0) throw new Error('EXTRACTION_FAILED');
  return text;
}
