"""Debug: show raw lines around Ch9 (pages 48-52) and check CHAPTER_RE matching."""
import fitz, re, sys
sys.stdout.reconfigure(encoding='utf-8')

PDF = r'C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf'
doc = fitz.open(PDF)

CHAPTER_RE = re.compile(r'Chapter[-\s]*(\d+)\s*[:]\s*(.+)', re.IGNORECASE)
_BARE_ROMAN_RE = re.compile(r'^([IVX]+)\.\s*$')
_BARE_QNUM_RE  = re.compile(r'^(\d{1,3})[.)]\s*$')
ANSWER_KEY_RE = re.compile(r'Model\s+(Key\s+)?Ans', re.IGNORECASE)
PAGE_FOOTER_RE = re.compile(r'^\s*-\s*\d+\s*-\s*$')
DIFF_TAG_RE = re.compile(
    r'\s*\{[A-Za-z]\}\s*'
    r'|\s*\((?:SUP|MAIN|JUNE|MAR|APR|SEP)[^)]*\)\s*'
    r'|\s*\(20\d\d\)\s*', re.IGNORECASE)

def preprocess_page_text(raw):
    lines = raw.splitlines()
    result = []
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            result.append(lines[i])
            i += 1
            continue
        is_bare_roman = bool(_BARE_ROMAN_RE.match(s))
        is_bare_qnum  = bool(_BARE_QNUM_RE.match(s))
        if is_bare_roman or is_bare_qnum:
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                next_s = lines[j].strip()
                if (next_s
                        and not _BARE_ROMAN_RE.match(next_s)
                        and not _BARE_QNUM_RE.match(next_s)
                        and not CHAPTER_RE.match(next_s)
                        and not ANSWER_KEY_RE.search(next_s)):
                    result.append(f"{s} {next_s}")
                    i = j + 1
                    continue
        result.append(lines[i])
        i += 1
    return '\n'.join(result)

def clean_line(line):
    s = line.strip()
    if PAGE_FOOTER_RE.match(s):
        return ""
    s = DIFF_TAG_RE.sub("", s)
    return s.strip()

# Pages 48-52 raw (Ch9 should start around page 50)
print("=== Raw blocks around Ch9 start ===")
for pg in range(47, 53):
    page = doc[pg]
    raw  = page.get_text("text", sort=True)
    print(f"\n--- PAGE {pg+1} ---")
    for line in raw.splitlines()[:20]:
        s = line.strip()
        if not s:
            continue
        match = "CHAPTER_RE_MATCH" if CHAPTER_RE.match(s) else ""
        print(f"  {match:18s} {repr(s[:90])}")

print("\n\n=== Preprocessed blocks around Ch9 ===")
for pg in range(47, 53):
    page = doc[pg]
    raw  = page.get_text("text", sort=True)
    pp   = preprocess_page_text(raw)
    print(f"\n--- PAGE {pg+1} ---")
    for line in pp.splitlines()[:20]:
        s = line.strip()
        if not s:
            continue
        match = "CHAPTER_RE_MATCH" if CHAPTER_RE.match(clean_line(line)) else ""
        print(f"  {match:18s} {repr(s[:90])}")

doc.close()
