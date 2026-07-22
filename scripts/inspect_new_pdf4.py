import fitz, re, sys
sys.stdout.reconfigure(encoding='utf-8')

PDF = r'C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf'
doc = fitz.open(PDF)

# Inspect pages with images: p3(idx2), p8(idx7), p15(idx14), p16(idx15), p17(idx16)
for pg in [2, 7, 14, 15, 16, 21, 22]:
    page = doc[pg]
    pr   = page.rect
    imgs = [i for i in page.get_image_info(xrefs=True) if i['width']>=50 and i['height']>=50]
    if not imgs:
        continue
    print(f"\n=== PAGE {pg+1} ({pr.x1:.0f}x{pr.y1:.0f}) ===")
    print("TEXT BLOCKS (key ones):")
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, text, _, bt = b
        if bt == 0 and text.strip():
            t = text.strip()[:80]
            print(f"  x={x0:.0f}-{x1:.0f}  y={y0:.0f}-{y1:.0f}  {repr(t)}")
    print("IMAGES:")
    for i in imgs:
        bb = i['bbox']
        print(f"  x={bb[0]:.0f}-{bb[2]:.0f}  y={bb[1]:.0f}-{bb[3]:.0f}  size={i['width']}x{i['height']}")

doc.close()
