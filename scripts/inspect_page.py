import fitz, sys
sys.stdout.reconfigure(encoding='utf-8')
doc = fitz.open(r'C:\Users\shrin\Downloads\eng math.pdf')

for pg in [34, 17, 44]:   # pages 35 (circles), 18 (triangles), 45 (constructions)
    page = doc[pg]
    pr   = page.rect
    print(f'\n=== PAGE {pg+1}  page_rect=({pr.x0:.0f},{pr.y0:.0f})-({pr.x1:.0f},{pr.y1:.0f}) ===')
    print('TEXT BLOCKS:')
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, text, _, bt = b
        if bt == 0 and text.strip():
            print(f'  x={x0:.0f}-{x1:.0f}  y={y0:.0f}-{y1:.0f}  chars={len(text.strip()):3d}  {repr(text.strip()[:60])}')
    print('IMAGES:')
    for info in page.get_image_info(xrefs=True):
        bbox = info['bbox']
        print(f'  x={bbox[0]:.0f}-{bbox[2]:.0f}  y={bbox[1]:.0f}-{bbox[3]:.0f}  size={info["width"]}x{info["height"]}')

doc.close()
