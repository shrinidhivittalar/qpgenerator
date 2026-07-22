import fitz, sys
sys.stdout.reconfigure(encoding='utf-8')

PDF = r'C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf'
doc = fitz.open(PDF)
print(f"Pages: {doc.page_count}")

# Sample first few pages for structure
for pg in range(min(8, doc.page_count)):
    page = doc[pg]
    pr   = page.rect
    text = page.get_text("text", sort=True)
    print(f"\n=== PAGE {pg+1} ({pr.x1:.0f}x{pr.y1:.0f}) ===")
    for line in text.splitlines()[:40]:
        if line.strip():
            print(f"  {repr(line.strip()[:100])}")

doc.close()
