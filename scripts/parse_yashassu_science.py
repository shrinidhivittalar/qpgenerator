"""
Yashassu Science Question Bank (2022-23)
DDPI Office, Department of School Education, Ramanagara

Parses 13 chapters from the 125-page PDF.
Pages  1-62: question bank  (parsed)
Pages 63-125: model key answers (skipped on sight of "Model Key Answer")

Chapter structure per chapter:
  I.   Multiple Choice Questions (1 mark each) — MCQ with A/B/C/D options
  II.  One-mark short answers
  III. Two-mark answers
  IV.  Three-mark answers
  V.   Four-mark answers
  VI.  Five-mark answers   (some chapters)

QID format : SYB_{chapter_num:02d}_{q_num:03d}
Source tag  : "yashassu_science"
"""

import fitz
import re
import json
import os
import sys

PDF_PATH   = r"C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.pdf"
OUTPUT_DIR = r"D:\Internship\qpgenerator\parsed_output_yashassu_science"
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")


def setup_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)


# ── Regexes ───────────────────────────────────────────────────────────────────

CHAPTER_RE = re.compile(
    r'Chapter[-\s]*(\d+)\s*[:]\s*(.+)',
    re.IGNORECASE,
)

# "I. Multiple Choice Questions. (One-mark questions.)"
# "II. Answer the following. (1 Mark)"
# Captures the roman numeral and the mark count from the heading
SECT_ROMAN_RE = re.compile(
    r'^(I{1,3}V?|IV|V?I{0,3})\.\s+',
)
# Find mark count inside section heading
SECT_MARK_RE = re.compile(
    r'(\d+)\s*marks?'
    r'|(?:\bone\b).*mark'
    r'|(?:\btwo\b).*mark'
    r'|(?:\bthree\b).*mark'
    r'|(?:\bfour\b).*mark'
    r'|(?:\bfive\b).*mark',
    re.IGNORECASE,
)
MARK_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5}

# Question start: "1.   text"  or  "35  text" (rare no-period variant)
Q_RE  = re.compile(r'^(\d{1,3})\.\s{1,}(.+)', re.DOTALL)
Q_RE2 = re.compile(r'^(\d{1,3})\s{3,}(.+)', re.DOTALL)

# MCQ option lines: "A. text", "(A) text", "A) text"
MCQ_A_LINE_RE = re.compile(r'^\(?A\)?[.)\s]\s*(.*)$', re.IGNORECASE)
# Split MCQ block on B/C/D labels (multiple space-separated format or newline format)
MCQ_BCD_SPLIT_RE = re.compile(r'\s+\(?([B-D])\)?[.)\s]\s*', re.IGNORECASE)

# Stop parsing at model answers
ANSWER_KEY_RE = re.compile(r'Model\s+(Key\s+)?Ans', re.IGNORECASE)

# Page footer "-N-"
PAGE_FOOTER_RE = re.compile(r'^\s*-\s*\d+\s*-\s*$')

# Tags to strip from question text
DIFF_TAG_RE = re.compile(
    r'\s*\{[A-Za-z]\}\s*'            # {E}, {A}, {D}
    r'|\s*\((?:SUP|MAIN|JUNE|MAR|APR|SEP)[^)]*\)\s*'  # (SUP-2019), (MAIN-2021) etc.
    r'|\s*\(20\d\d\)\s*',            # bare year tags
    re.IGNORECASE,
)

FIGURE_KW_RE = re.compile(
    r'\b(figure|fig\b|diagram|circuit|graph|shown|given|adjoining|following'
    r'|draw|label|observe|below|above|table)\b',
    re.IGNORECASE,
)

MIN_IMG_PX  = 50
_PAD_X      = 15    # x-padding around image bbox when clipping
_PAD_Y      = 10    # y-padding for simple y-clip
FIGURE_DPI  = 150

# ── Image helpers ─────────────────────────────────────────────────────────────

_LABEL_MAX_CHARS = 20

def get_text_y_ranges(page):
    """Return sorted (y0, y1) pairs for substantial text blocks."""
    ranges = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, _, bt = b
        stripped = text.strip()
        if bt == 0 and stripped and len(stripped) > _LABEL_MAX_CHARS:
            ranges.append((y0, y1))
    ranges.sort()
    return ranges


def figure_region(page, img_bbox):
    """Clip rect for a figure: tight x on the image, gap-based y."""
    bx0, img_top, bx1, img_bottom = img_bbox
    pr = page.rect

    # Tight x-clip — avoids capturing adjacent text columns
    clip_x0 = max(pr.x0, bx0 - _PAD_X)
    clip_x1 = min(pr.x1, bx1 + _PAD_X)

    # Gap-based y-clip — finds nearest text blocks above/below
    text_ranges = get_text_y_ranges(page)
    gap_top    = pr.y0
    gap_bottom = pr.y1

    for y0, y1 in text_ranges:
        if y1 <= img_top + 2:
            gap_top = max(gap_top, y1)
        elif y0 >= img_bottom - 2:
            gap_bottom = min(gap_bottom, y0)
            break

    gap_top    = min(gap_top,    img_top)
    gap_bottom = max(gap_bottom, img_bottom)

    # Cap: never extend more than 50px beyond the image's own edges
    gap_top    = max(gap_top,    img_top    - 50)
    gap_bottom = min(gap_bottom, img_bottom + 50)

    return fitz.Rect(clip_x0, gap_top, clip_x1, gap_bottom)


def get_page_images(page):
    """Return {img_top, img_bottom, rect} for non-tiny images (no solution filter needed)."""
    seen   = set()
    images = []
    for info in page.get_image_info(xrefs=True):
        w, h = info["width"], info["height"]
        if w < MIN_IMG_PX or h < MIN_IMG_PX:
            continue
        bbox = info["bbox"]
        rect = figure_region(page, bbox)
        key  = (round(rect.x0), round(rect.y0), round(rect.x1), round(rect.y1))
        if key in seen:
            continue
        seen.add(key)
        images.append({"img_top": bbox[1], "img_bottom": bbox[3], "rect": rect})
    return images


def save_image(page, rect, label):
    try:
        pix      = page.get_pixmap(clip=rect, dpi=FIGURE_DPI)
        filename = f"{label}.png"
        pix.save(os.path.join(IMAGES_DIR, filename))
        return filename
    except Exception:
        return None


# ── Text helpers ──────────────────────────────────────────────────────────────

_BARE_ROMAN_RE = re.compile(r'^([IVX]+)\.\s*$')           # UPPERCASE only (I. II. III. ...)
_BARE_QNUM_RE  = re.compile(r'^(\d{1,3})[.)]\s*$')        # "34." or "34)" (period required)
# Note: bare numbers WITHOUT period (like "35") are NOT preprocessed — too many false positives
# from difficulty-table cells which are also bare numbers.

def preprocess_page_text(raw: str) -> str:
    """Join lines where question number (with period) or roman section header appears alone.

    PDF blocks sometimes split the label onto one line and the content onto the next:
        'III.\\nAnswer the following (Two-mark questions)\\n\\n36.\\nList out...'
    After preprocessing this becomes one line each:
        'III. Answer the following (Two-mark questions)'
        '36. List out...'
    """
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


def clean_line(line: str) -> str:
    """Strip page footers, difficulty tags, and exam-session tags."""
    s = line.strip()
    if PAGE_FOOTER_RE.match(s):
        return ""
    s = DIFF_TAG_RE.sub("", s)
    return s.strip()


def parse_mark_count(heading: str) -> int:
    """Extract mark count from a section heading string."""
    m = re.search(r'(\d+)\s*marks?', heading, re.IGNORECASE)
    if m:
        return int(m.group(1))
    for word, n in MARK_WORDS.items():
        if re.search(rf'\b{word}\b', heading, re.IGNORECASE):
            return n
    return 1   # default (MCQ sections)


def parse_mcq_options(raw: str):
    """
    Given a string that starts with 'A.' or '(A)' and contains all 4 MCQ options,
    return [opt_A, opt_B, opt_C, opt_D] or None.
    """
    # Strip leading 'A.' / '(A)' / 'A) '
    a_stripped = re.sub(r'^\(?A\)?[.)\s]+', '', raw, count=1, flags=re.IGNORECASE)
    # Split the rest on B/C/D labels
    parts = MCQ_BCD_SPLIT_RE.split(a_stripped)
    # parts = [A_text, "B", B_text, "C", C_text, "D", D_text]  (labels are capture groups)
    opts = [parts[0].strip()]
    i = 1
    while i + 1 < len(parts):
        opts.append(parts[i + 1].strip())
        i += 2
    if len(opts) != 4:
        return None
    return [re.sub(r'\s+', ' ', o).strip() for o in opts]


def classify_question(text: str, has_figure: bool, options) -> str:
    if has_figure:
        return "figure_based"
    if options:
        return "mcq"
    if re.search(r'\b(?:i\)|ii\)|iii\)|iv\)|a\)|b\)|c\)|\(i\)|\(ii\)|\(a\)|\(b\))', text, re.IGNORECASE):
        return "multi_part"
    return "text"


# ── Main parser ───────────────────────────────────────────────────────────────

def safe_print(*args):
    try:
        print(*args)
    except UnicodeEncodeError:
        print(*(str(a).encode("ascii", errors="replace").decode() for a in args))


def parse(doc):
    questions   = {}   # qid -> question dict
    manifest    = []
    fig_counter = {}   # qid -> int

    done = False

    current_chapter_num  = 0
    current_chapter_name = ""
    current_marks        = 1
    in_mcq_section       = False   # True when section I is active

    current_qid    = None
    accumulating   = False
    in_options     = False   # collecting MCQ option lines
    option_lines   = []      # raw lines for MCQ options

    def qid_for(ch, qn):
        return f"SYB_{ch:02d}_{qn:03d}"

    def finalize_options():
        """Flush option_lines into the current question."""
        nonlocal in_options, option_lines
        if not in_options or not option_lines or current_qid not in questions:
            in_options   = False
            option_lines = []
            return
        raw  = " ".join(option_lines)
        opts = parse_mcq_options(raw)
        if opts:
            questions[current_qid]["options"] = opts
        in_options   = False
        option_lines = []

    def finalize_current():
        """Clean up the in-progress question."""
        finalize_options()
        if current_qid not in questions:
            return
        q    = questions[current_qid]
        text = DIFF_TAG_RE.sub("", q["text"])
        text = re.sub(r'\s+', ' ', text).strip()
        q["text"] = text

    for page_num in range(doc.page_count):
        if done:
            break

        page      = doc[page_num]
        raw_text  = page.get_text("text", sort=True)
        page_imgs = get_page_images(page)

        lines    = preprocess_page_text(raw_text).splitlines()
        line_idx = 0

        while line_idx < len(lines):
            line     = lines[line_idx]
            stripped = clean_line(line)
            line_idx += 1

            if not stripped:
                continue

            # Stop at model answers section
            if ANSWER_KEY_RE.search(stripped):
                finalize_current()
                done = True
                break

            # ── Chapter header ─────────────────────────────────────────────
            cm = CHAPTER_RE.match(stripped)
            if cm:
                finalize_current()
                current_chapter_num  = int(cm.group(1))
                current_chapter_name = cm.group(2).strip()
                current_marks        = 1
                in_mcq_section       = False
                current_qid          = None
                accumulating         = False
                continue

            if not current_chapter_num:
                continue

            # ── Section header (I. / II. / III. / ...) ────────────────────
            rm = SECT_ROMAN_RE.match(stripped)
            if rm:
                roman = rm.group(1).upper()
                finalize_current()
                current_marks     = parse_mark_count(stripped)
                in_mcq_section    = (roman == 'I')
                current_qid       = None
                accumulating      = False
                continue

            # ── MCQ option line (starts with A. / (A) / A) ) ──────────────
            if MCQ_A_LINE_RE.match(stripped):
                if in_options:
                    # Already collecting: another question's "A." line → start fresh
                    # (can happen if options spill across a page boundary)
                    option_lines.append(stripped)
                elif accumulating and current_qid and in_mcq_section:
                    finalize_options()
                    in_options = True
                    option_lines.append(stripped)
                continue

            # ── Question start — MUST be checked BEFORE option continuation ─
            # If in_options=True and we see "2.  text", finalize_current()
            # (which calls finalize_options()) before starting the new question.
            qm = Q_RE.match(stripped) or Q_RE2.match(stripped)
            if qm:
                finalize_current()
                q_num = int(qm.group(1))
                qid   = qid_for(current_chapter_num, q_num)

                current_qid  = qid
                accumulating = True

                if qid not in questions:
                    questions[qid] = {
                        "qid":         qid,
                        "number":      q_num,
                        "text":        qm.group(2).strip(),
                        "type":        "text",
                        "options":     None,
                        "marks":       current_marks,
                        "has_figure":  False,
                        "has_table":   False,
                        "images":      [],
                        "tables":      [],
                        "chapter":     current_chapter_name,
                        "chapter_num": current_chapter_num,
                        "source":      "yashassu_science",
                    }
                continue

            # ── MCQ option continuation (B/C/D lines and free text) ────────
            if in_options:
                option_lines.append(stripped)
                continue

            # ── Continuation text for current question ────────────────────
            if accumulating and current_qid:
                if SECT_ROMAN_RE.match(stripped) or CHAPTER_RE.match(stripped):
                    line_idx -= 1
                    continue
                q = questions.get(current_qid)
                if q:
                    q["text"] += " " + stripped

        # ── Assign images to questions on this page ───────────────────────
        if not page_imgs or not current_chapter_num:
            continue

        # Scan blocks to map question-start y → qid for this page.
        # Use block-level line merging to handle split "34.\nQuestion text" blocks.
        q_y_entries = []
        for b in page.get_text("blocks"):
            _, y0, _, _, raw_b, _, bt = b
            if bt != 0:
                continue
            block_lines = preprocess_page_text(raw_b).splitlines()
            for ln in block_lines:
                s = clean_line(ln)
                qm = Q_RE.match(s) or Q_RE2.match(s)
                if qm and current_chapter_num:
                    qn  = int(qm.group(1))
                    qid = qid_for(current_chapter_num, qn)
                    if qid in questions:
                        q_y_entries.append((y0, qid))
                        break
        q_y_entries.sort()

        for img in page_imgs:
            img_top = img["img_top"]
            matched_qid = None
            for y, qid in q_y_entries:
                if y <= img_top + 5:
                    matched_qid = qid
                else:
                    break
            if matched_qid is None and q_y_entries:
                matched_qid = q_y_entries[0][1]
            if matched_qid is None:
                continue

            q = questions.get(matched_qid)
            if q is None:
                continue

            fig_counter[matched_qid] = fig_counter.get(matched_qid, 0) + 1
            fig_num  = fig_counter[matched_qid]
            fid      = f"{matched_qid}_F{fig_num}"
            filename = save_image(page, img["rect"], fid)
            if filename:
                q["images"].append({
                    "fid":    fid,
                    "file":   filename,
                    "width":  round(img["rect"].width),
                    "height": round(img["rect"].height),
                })
                q["has_figure"] = True
                manifest.append({
                    "fid":     fid,
                    "qid":     matched_qid,
                    "chapter": q["chapter"],
                    "page":    page_num + 1,
                    "file":    filename,
                    "q_text":  q["text"][:100].replace("\n", " "),
                })
                safe_print(
                    f"  {fid:25s}  page {page_num+1:3d}  ->  {filename}"
                )

    finalize_current()

    # Post-process
    for q in questions.values():
        q["text"] = re.sub(r'\s+', ' ', q["text"]).strip()
        q["type"] = classify_question(q["text"], q["has_figure"], q["options"])

    return questions, manifest


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    setup_dirs()
    doc = fitz.open(PDF_PATH)
    safe_print(f"Parsing {doc.page_count} pages: {os.path.basename(PDF_PATH)}\n")

    questions, manifest = parse(doc)
    doc.close()

    # Stats
    by_type = {}
    by_ch   = {}
    by_mark = {}
    for q in questions.values():
        by_type[q["type"]] = by_type.get(q["type"], 0) + 1
        ch = q["chapter"]
        by_ch[ch]   = by_ch.get(ch, 0) + 1
        m = q["marks"]
        by_mark[m]  = by_mark.get(m, 0) + 1

    safe_print(f"\nTotal questions : {len(questions)}")
    safe_print(f"Total images    : {len(manifest)}")
    safe_print("\nBy type:")
    for t, n in sorted(by_type.items()):
        safe_print(f"  {t:20s}: {n}")
    safe_print("\nBy chapter:")
    for ch, n in sorted(by_ch.items(), key=lambda x: x[1], reverse=True):
        safe_print(f"  {ch[:45]:45s}: {n}")
    safe_print("\nBy marks:")
    for m, n in sorted(by_mark.items()):
        safe_print(f"  {m} mark(s): {n}")

    # Write output
    q_path = os.path.join(OUTPUT_DIR, "questions.json")
    m_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(q_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)
    with open(m_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    safe_print(f"\nQuestions -> {q_path}")
    safe_print(f"Manifest  -> {m_path}")
    safe_print(f"Images    -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
