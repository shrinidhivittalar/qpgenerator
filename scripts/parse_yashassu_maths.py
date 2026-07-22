"""
Yashassu Question Bank (2022-23) — Mathematics
DDPI Office, Department of School Education, Ramanagara

Parses all 15 units from the 123-page PDF question bank.

Structure:
  Pages 1-10:   Preamble + "VERY IMPORTANT FORMULAE / STATEMENTS"
  Page 11+:     Unit questions (numbers restart at 1 per unit)
                  UNIT – N : CHAPTER NAME
                    1 Mark Questions (MCQ)
                    1 Mark Questions (VSA)
                    2 Marks Questions (SA)
                    3 Marks Questions (LA-1)
                    ...
  Page ~110+:   Practice question sets (skipped)

Key challenges handled:
  - Math symbols are garbled (PDF encoding) — kept as-is
  - Solution blocks embedded in question text — stripped at "Solution :"
  - Answer key blocks ("Ans 1)D 2)A ...") — skipped
  - MCQ options in fragmented text blocks — joined then split on A)/B)/C)/D)
  - Images interleaved with questions — assigned by y-position
"""

import fitz
import re
import json
import os
import sys

PDF_PATH   = r"C:\Users\shrin\Downloads\eng math.pdf"
OUTPUT_DIR = r"D:\Internship\qpgenerator\parsed_output_yashassu_maths"
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")


def setup_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)


# ── Regexes ───────────────────────────────────────────────────────────────────

# "UNIT – 1 : ARITHMETIC PROGRESSION", "Unit-8: REAL NUMBERS", etc.
UNIT_RE = re.compile(
    r'UNIT\s*[-–]\s*(\d+)\s*[:\s]+(.+)',
    re.IGNORECASE,
)

# "1 Mark Questions (MCQ)", "3 Marks Questions (LA-1)", "4 or 5 Marks...", etc.
MARK_SECT_RE = re.compile(
    r'(\d+)(?:\s*/\s*\d+|\s+or\s+\d+)?\s*Marks?\s+Questions?\s*(?:\([^)]+\))?',
    re.IGNORECASE,
)

# Question line opening: "1) text", "23) text" — at start of a line
Q_LINE_RE = re.compile(r'^(\d{1,3})\)\s+(.+)', re.DOTALL)

# Answer key block: "Ans       1)D   2)A ..."
ANS_RE = re.compile(r'^Ans\s+\d', re.IGNORECASE)

# "Solution :" signals the start of a worked solution — everything after is stripped
SOLUTION_RE = re.compile(r'Solution\s*:', re.IGNORECASE)

# Practice question sets at the end of the bank — stop processing here
PRACTICE_RE = re.compile(r'Practice\s+Questions?\s*:\s*Set', re.IGNORECASE)

# MCQ options in the text — split on capital-letter option labels
MCQ_OPT_SPLIT_RE = re.compile(r'\s+([B-D])\)\s+')

FIGURE_KW_RE = re.compile(
    r'\b(figure|fig\b|diagram|graph|shown|given|adjoining|following|draw)\b',
    re.IGNORECASE,
)

MIN_IMG_PX = 50
MARGIN_X   = 36
FIGURE_DPI = 150

# ── Page content helpers ───────────────────────────────────────────────────────

_LABEL_MAX_CHARS = 25   # geometry letter labels (A, B, O …) are too short to fence figures

def get_text_y_ranges(page):
    ranges = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, _, block_type = b
        stripped = text.strip()
        if block_type == 0 and stripped and len(stripped) > _LABEL_MAX_CHARS:
            ranges.append((y0, y1))
    ranges.sort()
    return ranges


_PAD_X = 15   # pixels of padding around the image's own x-bbox when clipping

def figure_region(page, img_bbox, text_ranges):
    bx0, img_top, bx1, img_bottom = img_bbox
    pr         = page.rect
    gap_top    = pr.y0
    gap_bottom = pr.y1
    for y0, y1 in text_ranges:
        if y1 <= img_top + 2:
            gap_top = max(gap_top, y1)
        elif y0 >= img_bottom - 2:
            gap_bottom = min(gap_bottom, y0)
            break
    gap_top    = min(gap_top, img_top)
    gap_bottom = max(gap_bottom, img_bottom)
    # Use the image's own x-extent (+ small padding) instead of full page width.
    # This prevents question text in the left column from bleeding into right-side diagrams.
    clip_x0 = max(pr.x0, bx0 - _PAD_X)
    clip_x1 = min(pr.x1, bx1 + _PAD_X)
    return fitz.Rect(clip_x0, gap_top, clip_x1, gap_bottom)


def save_image(page, rect, label):
    try:
        pix      = page.get_pixmap(clip=rect, dpi=FIGURE_DPI)
        filename = f"{label}.png"
        pix.save(os.path.join(IMAGES_DIR, filename))
        return filename
    except Exception:
        return None


def _solution_ys(page):
    """Y-positions of text blocks that contain 'Solution :' on this page."""
    ys = []
    for b in page.get_text("blocks"):
        _, y0, _, _, text, _, bt = b
        if bt == 0 and SOLUTION_RE.search(text):
            ys.append(y0)
    return sorted(ys)


def _question_ys(page):
    """Y-positions of text blocks that open a numbered question on this page."""
    ys = []
    for b in page.get_text("blocks"):
        _, y0, _, _, text, _, bt = b
        if bt == 0:
            for line in text.splitlines():
                if Q_LINE_RE.match(line.strip()):
                    ys.append(y0)
                    break
    return sorted(ys)


def get_page_images(page):
    """Return list of {img_top, img_bottom, rect} for question-figure images on the page.

    Skips:
      - Tiny images (< MIN_IMG_PX on either side)
      - Images that appear below a 'Solution :' block with no new question in between
        (those are worked-solution diagrams, not question figures)
    """
    text_ranges = get_text_y_ranges(page)
    sol_ys  = _solution_ys(page)
    q_ys    = _question_ys(page)

    seen   = set()
    images = []
    for info in page.get_image_info(xrefs=True):
        w, h = info["width"], info["height"]
        if w < MIN_IMG_PX or h < MIN_IMG_PX:
            continue
        bbox       = info["bbox"]
        img_top    = bbox[1]
        img_bottom = bbox[3]

        # Skip if the image sits below a Solution: block that has no
        # subsequent question number between that Solution: and the image.
        is_solution_fig = False
        for sol_y in sol_ys:
            if sol_y < img_top:
                has_q_between = any(sol_y < qy < img_top for qy in q_ys)
                if not has_q_between:
                    is_solution_fig = True
                    break
        if is_solution_fig:
            continue

        rect = figure_region(page, bbox, text_ranges)
        key  = (round(rect.x0), round(rect.y0), round(rect.x1), round(rect.y1))
        if key in seen:
            continue
        seen.add(key)
        images.append({"img_top": img_top, "img_bottom": img_bottom, "rect": rect})
    return images


# ── Text cleaning ─────────────────────────────────────────────────────────────

def clean_page_text(raw: str) -> str:
    """Remove the two repeating page headers from every page's text."""
    # "2022-23 \n Yashassu - Question Bank"
    raw = re.sub(r'2022-23\s*\nYashassu\s*-\s*Question\s*Bank', '', raw, flags=re.IGNORECASE)
    # "DDPI  Office ... Ramanagara \nPage  N"
    raw = re.sub(r'DDPI\s+Office[^\n]*\n[^\n]*\nPage\s+\d+', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'DDPI\s+Office[^\n]*Page\s+\d+', '', raw, flags=re.IGNORECASE)
    return raw


def strip_solution(text: str) -> str:
    """Cut question text at 'Solution :' so worked answers are not ingested."""
    m = SOLUTION_RE.search(text)
    if m:
        text = text[:m.start()]
    return text.strip()


def extract_mcq_options(text: str):
    """
    If text contains MCQ options (A) ... B) ... C) ... D) ...), split them out.
    Returns (stem, [opt_A, opt_B, opt_C, opt_D]) or (text, None).
    """
    # Find where 'A)' option starts
    a_match = re.search(r'\bA\)\s+', text)
    if not a_match:
        return text, None

    stem     = text[:a_match.start()].strip()
    opts_raw = text[a_match.start():]
    # Split on B), C), D) option labels
    parts    = MCQ_OPT_SPLIT_RE.split(opts_raw)
    # parts[0] = "A) opt_a text", parts[1] = "B", parts[2] = "opt_b text", ...
    # After split on B)/C)/D), we get: [A_text, "B", B_text, "C", C_text, "D", D_text]
    opts = [re.sub(r'^A\)\s*', '', parts[0]).strip()]
    i = 1
    while i < len(parts) - 1:
        opts.append(parts[i + 1].strip())
        i += 2

    # Need exactly 4 options; bail out if we got something weird
    if len(opts) != 4:
        return text, None

    # Clean each option
    opts = [re.sub(r'\s+', ' ', o).strip() for o in opts]
    return stem, opts


def classify_question(text: str, has_figure: bool, options) -> str:
    if has_figure:
        return "figure_based"
    if options:
        return "mcq"
    if re.search(r'\bi\)\s|\bii\)\s|\ba\)\s|\b\(i\)|\b\(a\)', text, re.IGNORECASE):
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
    manifest    = []   # figure + table manifest
    fig_counter = {}   # qid -> int

    in_questions   = False   # True after first UNIT header
    done           = False   # True after Practice Questions section

    current_unit_num  = 0
    current_unit_name = ""
    current_marks     = 1
    current_q_num     = None   # int question number within current unit
    current_qid       = None   # e.g. "YBM_01_001"
    accumulating      = False  # True while building current question text

    def qid_for(unit_num, q_num):
        return f"YBM_{unit_num:02d}_{q_num:03d}"

    def finalize_current():
        """Clean up and finalise the in-progress question."""
        if current_qid not in questions:
            return
        q    = questions[current_qid]
        text = strip_solution(q["text"])
        stem, opts = extract_mcq_options(text)
        if opts:
            q["text"]    = stem
            q["options"] = opts
        else:
            q["text"] = re.sub(r'\s+', ' ', text).strip()
        q["text"] = re.sub(r'\n{3,}', '\n\n', q["text"]).strip()

    for page_num in range(doc.page_count):
        if done:
            break

        page      = doc[page_num]
        raw_text  = page.get_text("text", sort=True)
        page_text = clean_page_text(raw_text)

        # Collect images on this page for later assignment
        page_images = get_page_images(page)

        # ── Process text line by line ─────────────────────────────────────
        lines = page_text.splitlines()
        line_idx = 0

        while line_idx < len(lines):
            line     = lines[line_idx]
            stripped = line.strip()
            line_idx += 1

            if not stripped:
                continue

            # Stop at practice question sets
            if PRACTICE_RE.search(stripped):
                finalize_current()
                done = True
                break

            # ── Unit header ────────────────────────────────────────────────
            um = UNIT_RE.match(stripped)
            if um:
                finalize_current()
                current_unit_num  = int(um.group(1))
                # The unit name may have the mark-section label on the same line
                # e.g. "UNIT – 1 : ARITHMETIC PROGRESSION    1 Mark Questions (MCQ)"
                unit_tail = um.group(2).strip()
                mm = MARK_SECT_RE.search(unit_tail)
                if mm:
                    current_unit_name = unit_tail[:mm.start()].strip().rstrip(' -:')
                    current_marks     = int(mm.group(1))
                else:
                    current_unit_name = unit_tail.strip().rstrip(' -:')
                in_questions   = True
                current_q_num  = None
                current_qid    = None
                accumulating   = False
                continue

            if not in_questions:
                continue

            # ── Mark section header ────────────────────────────────────────
            mm = MARK_SECT_RE.match(stripped)
            if mm:
                finalize_current()
                current_marks  = int(mm.group(1))
                current_qid    = None
                accumulating   = False
                continue

            # ── Answer key block — skip ────────────────────────────────────
            if ANS_RE.match(stripped):
                # Skip lines until blank or next question/section
                while line_idx < len(lines):
                    nxt = lines[line_idx].strip()
                    line_idx += 1
                    if not nxt:
                        break
                    if Q_LINE_RE.match(nxt) or MARK_SECT_RE.match(nxt) or UNIT_RE.match(nxt):
                        line_idx -= 1
                        break
                finalize_current()
                current_qid  = None
                accumulating = False
                continue

            # ── Question start: "N) text…" ─────────────────────────────────
            qm = Q_LINE_RE.match(stripped)
            if qm:
                finalize_current()
                q_num         = int(qm.group(1))
                current_q_num = q_num
                current_qid   = qid_for(current_unit_num, q_num)
                accumulating  = True

                if current_qid not in questions:
                    questions[current_qid] = {
                        "qid":        current_qid,
                        "number":     q_num,
                        "text":       qm.group(2).strip(),
                        "type":       "text",
                        "options":    None,
                        "marks":      current_marks,
                        "has_figure": False,
                        "has_table":  False,
                        "images":     [],
                        "tables":     [],
                        "chapter":    current_unit_name,
                        "chapter_num": current_unit_num,
                        "source":     "yashassu",
                    }
                continue

            # ── Continuation text for current question ────────────────────
            if accumulating and current_qid:
                # Stop accumulating if this line looks like a new section header
                if MARK_SECT_RE.match(stripped) or UNIT_RE.match(stripped):
                    line_idx -= 1
                    continue
                # Stop if it's an answer key
                if ANS_RE.match(stripped):
                    line_idx -= 1
                    continue
                q   = questions.get(current_qid)
                if q:
                    q["text"] += "\n" + stripped

        # ── Assign images to questions on this page ───────────────────────
        if not in_questions or not page_images:
            continue

        # Build a map: y-position → qid for questions that have text on this page
        # We do this by scanning the sorted page text for question openings
        q_y_entries = []   # [(y_of_question_start, qid)]
        for b in page.get_text("blocks"):
            x0, y0, x1, y1, text, _, block_type = b
            if block_type != 0:
                continue
            t = clean_page_text(text.strip())
            for ln in t.splitlines():
                ln = ln.strip()
                qm = Q_LINE_RE.match(ln)
                if qm and current_unit_num:
                    qn  = int(qm.group(1))
                    qid = qid_for(current_unit_num, qn)
                    if qid in questions:
                        q_y_entries.append((y0, qid))
                        break
        q_y_entries.sort()

        for img in page_images:
            img_top = img["img_top"]
            # Find the question whose text block is immediately above this image
            matched_qid = None
            for y, qid in q_y_entries:
                if y <= img_top + 5:
                    matched_qid = qid
                else:
                    break
            if matched_qid is None and q_y_entries:
                matched_qid = q_y_entries[0][1]   # fallback: first q on page
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
                    "fid":      fid,
                    "qid":      matched_qid,
                    "chapter":  q["chapter"],
                    "page":     page_num + 1,
                    "file":     filename,
                    "q_text":   q["text"][:100].replace("\n", " "),
                })

    # Finalize last question
    finalize_current()

    # Post-process: classify types and clean text
    for q in questions.values():
        q["text"] = re.sub(r'\n{3,}', '\n\n', q["text"]).strip()
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

    sorted_qs = dict(sorted(questions.items()))

    # ── Stats ─────────────────────────────────────────────────────────────
    total     = len(sorted_qs)
    mcq       = sum(1 for q in sorted_qs.values() if q["type"] == "mcq")
    text_q    = sum(1 for q in sorted_qs.values() if q["type"] == "text")
    fig_q     = sum(1 for q in sorted_qs.values() if q["type"] == "figure_based")
    multi_q   = sum(1 for q in sorted_qs.values() if q["type"] == "multi_part")
    with_imgs = sum(1 for q in sorted_qs.values() if q["has_figure"])

    by_unit: dict[str, int] = {}
    for q in sorted_qs.values():
        by_unit[q["chapter"]] = by_unit.get(q["chapter"], 0) + 1

    safe_print(f"{'='*65}")
    safe_print(f"Total questions parsed  : {total}")
    safe_print(f"  MCQ                   : {mcq}")
    safe_print(f"  Text / short answer   : {text_q}")
    safe_print(f"  Figure-based          : {fig_q}")
    safe_print(f"  Multi-part            : {multi_q}")
    safe_print(f"  With images           : {with_imgs}")
    safe_print(f"{'='*65}")
    safe_print("Questions per unit:")
    for chapter, count in by_unit.items():
        safe_print(f"  {chapter:<45} {count:>3}")
    safe_print(f"{'='*65}\n")

    # ── Sample output ─────────────────────────────────────────────────────
    safe_print("Sample (first 3 per unit):")
    prev_chapter = None
    shown = 0
    for qid, q in sorted_qs.items():
        if q["chapter"] != prev_chapter:
            prev_chapter = q["chapter"]
            shown = 0
            safe_print(f"\n  [{q['chapter']}]")
        if shown >= 3:
            continue
        shown += 1
        opts_tag = f" [{len(q['options'])} opts]" if q["options"] else ""
        img_tag  = f" [{len(q['images'])} img]"  if q["images"]  else ""
        marks_tag = f" [{q['marks']}M]"
        preview  = q["text"][:80].replace("\n", " ")
        safe_print(f"    {qid}{marks_tag}{opts_tag}{img_tag}  {preview}...")

    # ── Manifest ──────────────────────────────────────────────────────────
    if manifest:
        safe_print(f"\n{'='*65}")
        safe_print("Figure manifest:")
        for e in manifest:
            safe_print(f"  {e['fid']}  page {e['page']}  ->  {e['file']}")
            safe_print(f"           Q: {e['q_text'][:70]}...")

    # ── Save ──────────────────────────────────────────────────────────────
    q_path = os.path.join(OUTPUT_DIR, "questions.json")
    m_path = os.path.join(OUTPUT_DIR, "manifest.json")

    with open(q_path, "w", encoding="utf-8") as f:
        json.dump(sorted_qs, f, ensure_ascii=False, indent=2)
    with open(m_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    safe_print(f"\nQuestions -> {q_path}")
    safe_print(f"Manifest  -> {m_path}")
    safe_print(f"Images    -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
