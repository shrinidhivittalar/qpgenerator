#!/usr/bin/env python3
"""
Extract a page range from a PDF and save as a new PDF.
Usage: python extract_pages.py <input.pdf> <output.pdf> <start_page> <end_page>
Pages are 0-indexed, end_page is inclusive.
"""
import sys
import fitz

src        = sys.argv[1]
dst        = sys.argv[2]
start_page = int(sys.argv[3])
end_page   = int(sys.argv[4])

doc = fitz.open(src)
out = fitz.open()
out.insert_pdf(doc, from_page=start_page, to_page=min(end_page, doc.page_count - 1))
out.save(dst)
