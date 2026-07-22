"""
Question Paper Parser — Mathematics Edition
Extracts text questions and image-based questions from the Karnataka SSLC
Mathematics model question paper (2024-25, English Medium, Set 1).

Adapted from parse_qp.py (Science paper parser).

Key differences from the Science parser:
  - PDF code is 81-E (was 83-E)
  - Page header pattern is "81-E  \nN" (not "N\n83-E")
  - Section headers are Roman numerals: I., II., III., IV., V., VI.
    (the Science paper used "PART – A / B / C" style headers)
  - Cover page has "General Instructions to the Candidate" — same sentinel
  - Questions start at section "I." (first Roman-numeral section header)
"""

import fitz          # PyMuPDF
import pdfplumber     # table detection
import json
import re
import os


PDF_PATH  = r"C:\Users\shrin\Downloads\Karnataka SSLC Model Question Paper 2025 Maths English Medium Set 1.pdf"
OUTPUT_DIR = r"D:\Internship\qpgenerator\parsed_output_maths"
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")


def setup_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)


# Matches a question number at the START of a string: "4.", "14.", "38."
# Allows optional whitespace/newline after the dot (including end-of-string)
Q_NUM_RE = re.compile(r"^(\d{1,2})\.(\s|$)")

# Roman-numeral section header: "I.", "II.", "III.", "IV.", "V.", "VI."
# (optionally followed by whitespace or newline)
SECTION_HDR_RE = re.compile(r"^(I{1,3}V?|VI?)\.(\s|$)")

# Page header: "81-E  \n2" or "81-E  \n10"
PAGE_HDR_RE = re.compile(r"^81-E\s*\n?\s*\d{1,2}")

# Cover-page sentinel — everything before and including this is skipped
INSTRUCTIONS_SENTINEL = "General Instructions to the Candidate"


def split_by_question_numbers(text):
    """
    Split a multi-question text block into segments.
    E.g. "13. foo\n14. bar" -> [(13, "13. foo"), (14, "14. bar")]
    Returns [(q_num_int_or_None, segment_text), ...]
    """
    parts = re.split(r"(?m)(?=^\d{1,2}\.\s)", text)
    result = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = Q_NUM_RE.match(part)
        if m:
            result.append((int(m.group(1)), part))
        else:
            result.append((None, part))
    return result


def get_text_y_ranges(page):
    """Return sorted list of (y_top, y_bottom) for every non-empty text block."""
    ranges = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, _, block_type = b
        if block_type == 0 and text.strip():
            ranges.append((y0, y1))
    ranges.sort()
    return ranges


def figure_region_for_image(page, img_y, text_ranges):
    """
    Given an image's top y-coord and all text block y-ranges on the page,
    return the full figure region rect: from the bottom of the last text block
    ABOVE the image to the top of the first text block BELOW it.

    This captures both raster images AND surrounding vector graphics
    (geometry lines, axes, arrows, labels drawn as PDF paths).
    """
    page_rect = page.rect
    margin_x = 36  # ~0.5 inch left/right margin trim

    gap_top    = page_rect.y0
    gap_bottom = page_rect.y1

    for (y0, y1) in text_ranges:
        if y1 <= img_y:       # block is entirely above the image
            gap_top = max(gap_top, y1)
        elif y0 > img_y:      # block is below the image
            gap_bottom = min(gap_bottom, y0)
            break

    return fitz.Rect(
        page_rect.x0 + margin_x,
        gap_top,
        page_rect.x1 - margin_x,
        gap_bottom,
    )


def extract_page_content(page):
    """
    Returns content blocks sorted by y position.
    Each block: {"type": "text"|"image", "y": float, ...}
    Image blocks carry a pre-computed `figure_rect` for full-figure rendering.
    """
    text_ranges = get_text_y_ranges(page)
    blocks = []

    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, block_no, block_type = b
        if block_type != 0:
            continue
        stripped = text.strip()
        if stripped:
            blocks.append({"type": "text", "y": y0, "text": stripped})

    seen_figure_rects = set()  # deduplicate: one figure per gap region
    for img_info in page.get_image_info(xrefs=True):
        bbox  = img_info["bbox"]
        img_y = bbox[1]
        fig_rect = figure_region_for_image(page, img_y, text_ranges)
        key = (round(fig_rect.y0), round(fig_rect.y1))
        if key in seen_figure_rects:
            continue  # same gap already registered (e.g. two images in one diagram)
        seen_figure_rects.add(key)
        blocks.append({
            "type": "image",
            "y": img_y,
            "figure_rect": fig_rect,
            "width":  img_info["width"],
            "height": img_info["height"],
        })

    blocks.sort(key=lambda b: b["y"])
    return blocks


def save_image(page, block, label):
    """
    Render the full figure region (text gap) at 150 DPI so both raster images
    and surrounding vector graphics (geometry lines, graph axes, arrows) are
    captured correctly.
    """
    try:
        pix = page.get_pixmap(clip=block["figure_rect"], dpi=150)
        filename  = f"{label}.png"
        filepath  = os.path.join(IMAGES_DIR, filename)
        pix.save(filepath)
        return filename
    except Exception:
        return None


FIGURE_KEYWORDS = re.compile(
    r"\b(figure|fig|diagram|graph|table|image|observe|shown|given below|above|in the figure)\b",
    re.IGNORECASE,
)


def normalize_table(raw_rows):
    """
    Convert pdfplumber raw rows to a clean {headers, rows} dict.

    pdfplumber returns tables in reading order. Two orientations exist:
      Vertical   (header row first):  [['H1','H2'], ['v1','v2'], ...]
      Horizontal (header col first):  [['H1','v1','v2'], ['H2','v1','v2'], ...]

    We detect horizontal layout when there are only 2 rows AND the first
    column looks like labels (not numbers). In that case we transpose.
    """
    if not raw_rows:
        return {"headers": [], "rows": []}

    def looks_like_label(cell):
        """True if cell is non-numeric (likely a header label)."""
        return bool(cell and not re.match(r"^[\d\s\.\-–]+$", cell.strip()))

    # Heuristic: horizontal table when row count <= 3 and first column is labels
    is_horizontal = (
        len(raw_rows) <= 3
        and all(looks_like_label(row[0]) for row in raw_rows if row)
    )

    if is_horizontal:
        # Each raw row: [header, val1, val2, ...]
        headers = [row[0] for row in raw_rows if row]
        num_cols = max(len(row) for row in raw_rows) - 1
        rows = []
        for col_idx in range(num_cols):
            row_dict = {}
            for raw_row in raw_rows:
                h = raw_row[0] if raw_row else ""
                v = raw_row[col_idx + 1] if len(raw_row) > col_idx + 1 else ""
                row_dict[h] = (v or "").strip()
            rows.append(row_dict)
        return {"headers": headers, "rows": rows}
    else:
        # Standard vertical table: first row is headers
        headers = [str(c or "").strip() for c in raw_rows[0]]
        rows = []
        for raw_row in raw_rows[1:]:
            row_dict = {headers[i]: str(raw_row[i] or "").strip()
                        for i in range(min(len(headers), len(raw_row)))}
            rows.append(row_dict)
        return {"headers": headers, "rows": rows}


def extract_page_tables(plumber_page):
    """
    Return list of {table_data, y_top} for every table on this pdfplumber page.
    y_top is in PDF points from the top of the page (same origin as fitz).
    """
    results = []
    for table in plumber_page.find_tables():
        bbox   = table.bbox          # (x0, top, x1, bottom) — pdfplumber top-origin
        y_top  = bbox[1]
        raw    = table.extract()
        if raw:
            results.append({"table_data": normalize_table(raw), "y_top": y_top})
    return results


def new_question(num):
    return {
        "qid": f"Q{num:02d}",
        "number": num,
        "text": "",
        "images": [],
        "tables": [],
        "has_figure": False,
        "has_table": False,
    }


def parse_questions(doc, pdf_path):
    questions = {}
    manifest  = []
    current_q         = None
    questions_started = False
    fig_counters      = {}   # {q_num: count of figures so far}
    tbl_counters      = {}   # {q_num: count of tables so far}
    orphan_images     = []
    plumber_pdf       = pdfplumber.open(pdf_path)

    def add_text_to_current(text):
        if current_q is not None and text:
            questions[current_q]["text"] += text + "\n"

    def handle_image_block(block, page_num, page):
        if current_q is None:
            orphan_images.append({"page": page_num + 1, "bbox": list(block["figure_rect"])})
            return
        fig_counters[current_q] = fig_counters.get(current_q, 0) + 1
        fig_num  = fig_counters[current_q]
        qid      = questions[current_q]["qid"]
        fid      = f"{qid}_F{fig_num}"       # e.g. Q04_F1, Q37_F2
        filename = save_image(page, block, fid)
        if filename:
            fig   = block["figure_rect"]
            entry = {
                "fid":    fid,
                "file":   filename,
                "width":  round(fig.width),
                "height": round(fig.height),
            }
            questions[current_q]["images"].append(entry)
            questions[current_q]["has_figure"] = True
            manifest.append({
                "fid":                   fid,
                "qid":                   qid,
                "question_number":       current_q,
                "page":                  page_num + 1,
                "file":                  filename,
                "width":                 round(fig.width),
                "height":                round(fig.height),
                "question_text_snippet": "",   # filled after parsing
            })

    for page_num in range(doc.page_count):
        page          = doc[page_num]
        plumber_page  = plumber_pdf.pages[page_num]
        blocks        = extract_page_content(page)
        page_tables   = extract_page_tables(plumber_page) if questions_started else []

        for block in blocks:
            # ---------- image block ----------
            if block["type"] == "image":
                if questions_started:
                    handle_image_block(block, page_num, page)
                continue

            text = block["text"]

            # Skip page headers ("81-E  \n2", "81-E  \n10", …)
            if PAGE_HDR_RE.match(text):
                continue

            # Skip the "[ Turn over" footer
            if text.strip().endswith("[ Turn over"):
                continue

            # ---------- pre-questions section (cover page) ----------
            if not questions_started:
                if INSTRUCTIONS_SENTINEL in text:
                    # Still on the cover/instructions page; keep skipping
                    continue
                # Skip numbered instruction items (1.–5.) on the cover page
                if Q_NUM_RE.match(text):
                    continue
                # The first Roman-numeral section header signals real content
                if SECTION_HDR_RE.match(text):
                    questions_started = True
                    # fall through so the section header is processed below
                else:
                    continue

            # ---------- body section headers (I., II., …) — skip ----------
            if SECTION_HDR_RE.match(text):
                continue

            # ---------- normal question content ----------
            # A single text block may contain multiple question starts
            # e.g. "13. foo\n14. bar" — split them apart
            segments = split_by_question_numbers(text)

            for q_num, segment in segments:
                if q_num is not None:
                    current_q = q_num
                    if current_q not in questions:
                        questions[current_q] = new_question(current_q)
                    questions[current_q]["text"] += segment + "\n"
                else:
                    add_text_to_current(segment)

        # ---- Process tables for this page ----
        # Tables are matched to the question active at their y-position.
        # We build a snapshot of (y_bottom_of_question_text, q_num) to do
        # the mapping without re-parsing blocks a second time.
        if page_tables and questions_started:
            # Build a y-sorted list of (text_block_y, current_q_at_that_point)
            # by replaying only text blocks that are question starts or continuations.
            q_y_map = []  # list of (y, q_num) — last text block for each question on this page
            active = current_q  # current_q after processing all blocks on this page
            for b in sorted(extract_page_content(page), key=lambda x: x["y"]):
                if b["type"] != "text":
                    continue
                segs = split_by_question_numbers(b["text"])
                for qn, _ in segs:
                    if qn is not None:
                        active = qn
                q_y_map.append((b["y"], active))

            for tbl in page_tables:
                y = tbl["y_top"]
                # Find the question active just above this table
                matched_q = None
                for (by, bq) in q_y_map:
                    if by <= y:
                        matched_q = bq
                    else:
                        break
                if matched_q is None:
                    continue
                if matched_q not in questions:
                    questions[matched_q] = new_question(matched_q)
                tbl_counters[matched_q] = tbl_counters.get(matched_q, 0) + 1
                tbl_num = tbl_counters[matched_q]
                qid = questions[matched_q]["qid"]
                tid = f"{qid}_T{tbl_num}"          # e.g. Q29_T1, Q29_T2
                table_entry = {
                    "tid":   tid,
                    "qid":   qid,
                    **tbl["table_data"],
                }
                questions[matched_q]["tables"].append(table_entry)
                questions[matched_q]["has_table"] = True
                manifest.append({
                    "tid":                   tid,
                    "qid":                   qid,
                    "question_number":       matched_q,
                    "page":                  page_num + 1,
                    "type":                  "table",
                    "headers":               tbl["table_data"]["headers"],
                    "row_count":             len(tbl["table_data"]["rows"]),
                    "question_text_snippet": "",   # filled after parsing
                    "keyword_match":         None,
                })

    plumber_pdf.close()

    # Clean up text and backfill manifest snippets + keyword check
    for q in questions.values():
        q["text"] = re.sub(r"\n{3,}", "\n\n", q["text"]).strip()
    for entry in manifest:
        q = questions.get(entry["question_number"])
        entry["question_text_snippet"] = (q["text"][:120].replace("\n", " ") if q else "")
        entry["keyword_match"] = bool(FIGURE_KEYWORDS.search(q["text"]) if q else False)

    return questions, manifest, orphan_images


def classify_question(q):
    text       = q["text"]
    text_lower = text.lower()
    if q["has_figure"]:
        return "figure_based"
    if q.get("has_table"):
        return "table_based"
    if re.search(r"\(A\).*\(B\)", text, re.DOTALL):
        return "mcq"
    if re.search(r"\bi\)\s|\bii\)\s|\ba\)\s", text_lower):
        return "multi_part"
    return "text"


def safe_print(text):
    """Print, replacing characters that can't be encoded in the console codec."""
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def main():
    # Make stdout UTF-8 safe on Windows consoles
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    setup_dirs()
    doc = fitz.open(PDF_PATH)
    safe_print(f"Parsing {doc.page_count} pages from: {os.path.basename(PDF_PATH)}\n")

    questions, manifest, orphan_images = parse_questions(doc, PDF_PATH)

    for q in questions.values():
        q["type"] = classify_question(q)

    sorted_questions = dict(sorted(questions.items()))

    total      = len(sorted_questions)
    with_imgs  = sum(1 for q in sorted_questions.values() if q["has_figure"])
    with_tbls  = sum(1 for q in sorted_questions.values() if q.get("has_table"))
    mcq        = sum(1 for q in sorted_questions.values() if q["type"] == "mcq")
    multi      = sum(1 for q in sorted_questions.values() if q["type"] == "multi_part")
    text_only  = sum(1 for q in sorted_questions.values() if q["type"] == "text")
    fig_based  = sum(1 for q in sorted_questions.values() if q["type"] == "figure_based")
    tbl_based  = sum(1 for q in sorted_questions.values() if q["type"] == "table_based")

    safe_print(f"{'='*65}")
    safe_print(f"Total questions parsed  : {total}")
    safe_print(f"  MCQ                   : {mcq}")
    safe_print(f"  Multi-part            : {multi}")
    safe_print(f"  Text / short answer   : {text_only}")
    safe_print(f"  Figure-based          : {fig_based}")
    safe_print(f"  Table-based           : {tbl_based}")
    safe_print(f"{'='*65}\n")

    for num, q in sorted_questions.items():
        img_tag = f" [{len(q['images'])} img]" if q["images"] else ""
        preview = q["text"][:90].replace("\n", " ")
        safe_print(f"  Q{num:2d} [{q['type']:<14}]{img_tag}  {preview}...")

    # --- Manifest summary ---
    safe_print(f"\n{'='*65}")
    safe_print("Manifest (figures + tables):")
    for entry in manifest:
        if entry.get("type") == "table":
            safe_print(f"  {entry['tid']}  ->  table  (page {entry['page']}, {entry['row_count']} rows, headers: {entry['headers']})")
            safe_print(f"          Q: {entry['question_text_snippet'][:80]}...")
        else:
            kw = "[keyword match]" if entry.get("keyword_match") else "[NO keyword -- CHECK]"
            safe_print(f"  {entry['fid']}  ->  {entry['file']}  (page {entry['page']})  {kw}")
            safe_print(f"          Q: {entry['question_text_snippet'][:80]}...")

    # --- Cross-validation warnings ---
    warnings = []
    for entry in manifest:
        if not entry["keyword_match"]:
            warnings.append(
                f"  WARNING: {entry['fid']} linked to Q{entry['question_number']} "
                f"but question text has no figure keyword. Possible mismatch."
            )
    for o in orphan_images:
        warnings.append(f"  WARNING: Orphan image on page {o['page']} — not linked to any question.")

    if warnings:
        safe_print(f"\n{'='*65}")
        safe_print("VALIDATION WARNINGS:")
        for w in warnings:
            safe_print(w)
    else:
        safe_print("\nValidation: all figures have keyword matches. No issues found.")

    # --- Save outputs ---
    questions_path = os.path.join(OUTPUT_DIR, "questions.json")
    manifest_path  = os.path.join(OUTPUT_DIR, "manifest.json")

    with open(questions_path, "w", encoding="utf-8") as f:
        json.dump(sorted_questions, f, ensure_ascii=False, indent=2)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    safe_print(f"\nQuestions -> {questions_path}")
    safe_print(f"Manifest  -> {manifest_path}")
    safe_print(f"Images    -> {IMAGES_DIR}")
    doc.close()


if __name__ == "__main__":
    main()
