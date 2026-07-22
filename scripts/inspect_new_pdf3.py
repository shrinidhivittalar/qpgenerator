import fitz, re, sys
sys.stdout.reconfigure(encoding='utf-8')

PDF = r'C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf'
doc = fitz.open(PDF)

# Check pages 60-70 to understand structure after page 63
for pg in [59, 62, 63, 64, 65, 66, 67]:
    page = doc[pg]
    text = page.get_text("text", sort=True)
    print(f"\n=== PAGE {pg+1} ===")
    for line in text.splitlines()[:30]:
        if line.strip():
            print(f"  {repr(line.strip()[:110])}")

# Also check question numbering for a chapter
print("\n\n=== Q NUMBERING sample (Ch1, pages 1-5) ===")
Q_RE = re.compile(r'^(\d+)[.)]\s+\S')
for pg in range(5):
    page = doc[pg]
    text = page.get_text("text", sort=True)
    for line in text.splitlines():
        s = line.strip()
        if Q_RE.match(s):
            print(f"  p{pg+1}  {repr(s[:80])}")

doc.close()
