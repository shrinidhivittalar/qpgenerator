import fitz, re, sys
sys.stdout.reconfigure(encoding='utf-8')

PDF = r'C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf'
doc = fitz.open(PDF)

CHAPTER_RE = re.compile(r'Chapter[-\s]*(\d+)\s*[:]\s*(.+)', re.IGNORECASE)
SECTION_RE = re.compile(r'^(I{1,3}V?|IV|V?I{0,3})\.\s+(.+?)\s*\((.+?mark[^)]*)\)', re.IGNORECASE)
Q_RE       = re.compile(r'^(\d+)\.\s+\S')  # "1.   text"

chapters    = []
sections    = []
q_counts    = {}  # chapter_num -> count
img_pages   = []

for pg in range(doc.page_count):
    page = doc[pg]
    text = page.get_text("text", sort=True)

    for line in text.splitlines():
        s = line.strip()
        m = CHAPTER_RE.match(s)
        if m:
            chapters.append((pg+1, int(m.group(1)), m.group(2).strip()))

        sm = SECTION_RE.match(s)
        if sm:
            sections.append((pg+1, s[:80]))

    # images on page
    imgs = [i for i in page.get_image_info(xrefs=True)
            if i['width'] >= 50 and i['height'] >= 50]
    if imgs:
        img_pages.append((pg+1, len(imgs)))

print("=== CHAPTERS ===")
for pg, num, name in chapters:
    print(f"  p{pg:3d}  Ch{num}: {name}")

print("\n=== SECTIONS (first 30) ===")
for pg, s in sections[:30]:
    print(f"  p{pg:3d}  {s}")

print(f"\n=== PAGES WITH IMAGES ({len(img_pages)} pages) ===")
for pg, n in img_pages[:20]:
    print(f"  p{pg:3d}  {n} image(s)")

doc.close()
