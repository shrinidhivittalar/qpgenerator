from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from pathlib import Path
import google.generativeai as genai
from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime, timezone
import fitz  # PyMuPDF
import json, os, re, uuid, tempfile

load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="")
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20 MB upload limit
CORS(app)

BASE = Path(__file__).parent.parent

# ── MongoDB ───────────────────────────────────────────────────────────────────
_mongo      = MongoClient(os.getenv("MONGODB_URI"))
_db         = _mongo["qp_builder"]
qs_col      = _db["questions"]   # static question banks
uploads_col = _db["uploads"]     # user-uploaded papers

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ── Supabase (optional — image upload skipped if not configured) ──────────────
try:
    from supabase import create_client as _sb_create
    _supabase = _sb_create(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_SERVICE_KEY", ""),
    ) if os.getenv("SUPABASE_URL") else None
except Exception:
    _supabase = None

SUPABASE_BUCKET = "QPGen-images"
_IMG_MIME = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "gif": "image/gif"}
MIN_IMG_PX = 80   # skip decorative images / icons smaller than this

# ── Parse prompts (paper-type hints) ─────────────────────────────────────────

LATEX_RULE = (
    "MATH FORMATTING — convert ALL mathematical expressions to LaTeX inline ($...$):\n"
    "• Fractions: n(n+1)/2 → $\\frac{n(n+1)}{2}$\n"
    "• Powers/exponents: x2 or x² → $x^{2}$, 2n → $2^{n}$\n"
    "• Subscripts: a1, b2 → $a_{1}$, $b_{2}$\n"
    "• Roots: √x, √(a²+b²) → $\\sqrt{x}$, $\\sqrt{a^{2}+b^{2}}$\n"
    "• Multiplication: 52 × 2 → $52 \\times 2$  (wrap the WHOLE expression, not just the symbol)\n"
    "• Not-equal: ≠ → $\\neq$\n"
    "• Ratios/proportions: a/b → $\\frac{a}{b}$\n"
    "• Trigonometry: sin30°, cos²θ → $\\sin 30°$, $\\cos^{2}\\theta$\n"
    "• Chemical formulas: H2SO4 → $\\ce{H2SO4}$\n"
    "Plain prose sentences do NOT need LaTeX. Only wrap math expressions.\n"
    "NEVER use \\text{\\textquotesingle} or \\text{\\textquotedbl} — write ' and \" directly."
)

PARSE_PROMPTS: dict[str, str] = {
    "sslc_qp": f"""\
Extract questions from this Karnataka SSLC question paper chunk. Return ONLY a JSON array.
Each item: {{"number":<int>,"text":<full question text>,"type":"mcq"|"figure_based"|"text","options":null|["<full text of option A>","<full text of option B>","<full text of option C>","<full text of option D>"]}}

Type rules:
- "mcq": question has (A)(B)(C)(D) answer choices → "options" MUST contain the FULL TEXT of each choice, e.g. ["volt (V)", "ampere (A)", "coulomb (C)", "ohm meter (Ωm)"]
- "figure_based": question references a figure/diagram/circuit/graph or asks to draw something → "options": null
- "text": everything else → "options": null

Structure rules (CRITICAL):
- ONE numbered question (1., 2., 3. …) = ONE JSON item, regardless of how many sub-parts it has
- Sub-parts labeled a/b or i/ii/iii: keep ALL sub-parts in the single "text" field of that item — do NOT split them into multiple items
- OR alternatives: append the full OR text to the same item's "text" field, joined with " OR " — do NOT create a separate item for the OR alternative
- Do NOT number sub-parts or OR alternatives as separate questions

Skip ONLY:
- Page headers/footers (83-E, 81-E, page numbers)
- Section/part labels (PART A, PART B, SECTION I, Roman numeral headers like "I.", "II.", "III." that are section labels not question numbers)
- Mark allocations (3×1=3, 2x4=8, etc.)
- General instructions at the top of the paper

Include EVERY numbered question. Keep original wording exactly.
{LATEX_RULE}

Text:
""",
    "textbook": f"""\
Extract exercise and in-text questions from this textbook passage. Return ONLY a JSON array.
Each item: {{"number":<int>,"text":<full question>,"type":"mcq"|"figure_based"|"text","options":null|["A","B","C","D"]}}
Rules: mcq=has multiple-choice options; figure_based=mentions figure/diagram; text=everything else.
Look for sections labelled Exercises, Questions, Activities, or Think and Discuss.
Skip chapter titles, body text, and explanations — only questions.
{LATEX_RULE}

Text:
""",
    "generic": f"""\
Extract exam questions from the text. Return ONLY a JSON array, no other text.
Each item: {{"number":<int>,"text":<full question text>,"type":"mcq"|"figure_based"|"text","options":null|["<full text of option A>","<full text of option B>","<full text of option C>","<full text of option D>"]}}
Rules:
- mcq = has (A)(B)(C)(D) choices → options array contains FULL TEXT of each choice (not just letters)
- figure_based = references figure/diagram or asks to draw
- text = everything else → options: null
- ONE numbered question = ONE item; keep sub-parts (a/b/c) together in "text"; include OR alternatives in the same "text" field
Skip headers/footers/instructions/mark allocations. Keep original wording.
{LATEX_RULE}

Text:
""",
}


# ── Subjects ──────────────────────────────────────────────────────────────────

@app.get("/api/subjects")
def get_subjects():
    # Aggregate unique subject/source combos and their counts from questions collection
    pipeline = [
        {"$group": {
            "_id":   {"subject": "$subject", "source": "$source"},
            "count": {"$sum": 1},
        }}
    ]
    result: dict[str, dict[str, int]] = {}
    for doc in qs_col.aggregate(pipeline):
        subj = doc["_id"]["subject"]
        src  = doc["_id"]["source"]
        result.setdefault(subj, {})[src] = doc["count"]
    return jsonify(result)


# ── Uploaded papers list ──────────────────────────────────────────────────────

@app.get("/api/uploads")
def list_uploads():
    docs = uploads_col.find({}, {"_id": 0, "upload_id": 1, "name": 1, "question_count": 1})
    return jsonify([
        {"id": d["upload_id"], "name": d["name"], "count": d["question_count"]}
        for d in docs
    ])


# ── Rename an uploaded paper ──────────────────────────────────────────────────

@app.patch("/api/uploads/<upload_id>")
def rename_upload(upload_id):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    uploads_col.update_one({"upload_id": upload_id}, {"$set": {"name": name}})
    return jsonify({"ok": True})


# ── Questions ─────────────────────────────────────────────────────────────────

@app.get("/api/questions/<subject>/<source>")
def get_questions(subject, source):
    if subject == "uploaded":
        doc = uploads_col.find_one({"upload_id": source}, {"_id": 0, "questions": 1})
        return jsonify(doc["questions"] if doc else [])

    qs = list(qs_col.find({"subject": subject, "source": source}, {"_id": 0}))
    return jsonify(qs)


# ── Upload & parse ────────────────────────────────────────────────────────────

FIGURE_HINT_RE = re.compile(
    r'\b(figure|diagram|observe|given figure|following figure|below figure|adjacent|circuit|graph)\b',
    re.IGNORECASE,
)

CHUNK_SIZE    = 6000   # chars per Gemini call — smaller chunks → fewer questions per call → less output token pressure
CHUNK_OVERLAP = 800    # overlap so questions at chunk boundaries always appear in at least one full chunk
MAX_CHUNKS    = 45     # covers large textbook banks up to ~234 000 chars (~120+ pages)


def _decode_unicode_escapes(s: str) -> str:
    """Decode \\uXXXX sequences the LLM sometimes outputs as literal text."""
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)


def _salvage_partial_json(raw: str) -> list[dict]:
    """Extract complete JSON objects from a truncated array string."""
    items: list[dict] = []
    depth = 0
    start = None
    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    obj = json.loads(raw[start:i + 1])
                    if isinstance(obj, dict):
                        items.append(obj)
                except json.JSONDecodeError:
                    pass
                start = None
    return items


def _call_groq_chunk(text_chunk: str, paper_type: str, chunk_idx: int = 0) -> list[dict]:
    prompt = PARSE_PROMPTS.get(paper_type, PARSE_PROMPTS["generic"])
    gem  = genai.GenerativeModel(MODEL)
    resp = gem.generate_content(
        prompt + text_chunk,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            max_output_tokens=8192,
            temperature=0.05,
        ),
    )
    raw    = resp.text.strip()
    finish = resp.candidates[0].finish_reason.name if resp.candidates else "UNKNOWN"
    print(f"[chunk {chunk_idx}] finish={finish!r}  raw_len={len(raw)}  preview={raw[:120]!r}")

    try:
        items = json.loads(raw)
        if isinstance(items, list):
            print(f"[chunk {chunk_idx}] parse ok → {len(items)} items")
            return _postprocess_items(items)
    except json.JSONDecodeError as e:
        print(f"[chunk {chunk_idx}] JSON parse failed: {e}")
        if finish == "MAX_TOKENS":
            salvaged = _salvage_partial_json(raw)
            print(f"[chunk {chunk_idx}] salvaged {len(salvaged)} items from truncated output")
            if salvaged:
                return _postprocess_items(salvaged)

    return []


def _postprocess_items(items: list) -> list[dict]:
    """Decode unicode escapes on text/options fields."""
    for item in items:
        if isinstance(item.get("text"), str):
            item["text"] = _decode_unicode_escapes(item["text"])
        if isinstance(item.get("options"), list):
            item["options"] = [_decode_unicode_escapes(o) for o in item["options"]]
    return items


# Imperative / interrogative words that signal an actual question or task.
_QUESTION_VERB_RE = re.compile(
    r'\b(find|prove|solve|calculate|show|draw|write|express|determine|evaluate|'
    r'construct|verify|obtain|derive|discuss|divide|check|mention|name|define|'
    r'list|explain|analyse|analyze|observe|convert|identify|state|choose|clarify|'
    r'what|which|how|why|when|where|who)\b',
    re.IGNORECASE,
)

# Definition phrasings that mark reference statements, not questions.
_DEFINITION_RE = re.compile(
    r'\bis called\b|\bare called\b|\bis given by\b|\bis defined as\b|\bis a special case\b',
    re.IGNORECASE,
)


def _is_reference_statement(text: str, q_type: str, options) -> bool:
    """
    True when an extracted item is a formula / definition / theorem statement from a
    reference section (e.g. the "VERY IMPORTANT FORMULAE / STATEMENTS" block of a
    textbook) rather than an actual question. Conservative — only flags high-confidence
    non-questions so genuine questions are never dropped.
    """
    t = (text or "").strip()
    if not t:
        return True
    # MCQ with options is always a real question.
    if q_type == "mcq" and options:
        return False
    # Explicit question mark or an imperative/interrogative verb → real question.
    if "?" in t or _QUESTION_VERB_RE.search(t):
        return False
    # Definition phrasing → reference statement.
    if _DEFINITION_RE.search(t):
        return True
    # Bare formula / relation (=, ≤, ≥) with no task verb → reference statement.
    if re.search(r'[=≤≥]', t):
        return True
    # Named theorem / criterion / lemma / algorithm / postulate intro → statement.
    if ":" in t and re.search(
        r'\b(theorem|criterion|lemma|algorithm|postulate|identit)\w*\b', t, re.IGNORECASE
    ):
        return True
    return False


def parse_paper(full_text: str, paper_type: str) -> tuple[list[dict], list[str]]:
    """
    Parse paper text into raw question list using up to 2 Groq calls.
    Returns (raw_questions, warnings).
    """
    import time

    warnings: list[str] = []

    # Split into chunks with overlap so questions aren't cut at boundaries
    step = CHUNK_SIZE - CHUNK_OVERLAP
    chunks = [full_text[i: i + CHUNK_SIZE] for i in range(0, len(full_text), step)]
    chunks = chunks[:MAX_CHUNKS]
    if len(full_text) > MAX_CHUNKS * step:
        warnings.append(
            f"Paper is very long ({len(full_text)} chars). "
            f"Only the first ~{MAX_CHUNKS * CHUNK_SIZE // 1000}k characters were parsed."
        )

    seen_texts: set[str] = set()
    raw_questions: list[dict] = []

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        if i > 0:
            time.sleep(1.5)  # pace calls to respect free-tier TPM
        try:
            items = _call_groq_chunk(chunk, paper_type, chunk_idx=i)
        except Exception as e:
            warnings.append(f"Parse error on section {i + 1}: {str(e)[:120]}")
            continue

        for item in items:
            text = (item.get("text") or "").strip()
            if not text or len(text) < 4:
                continue

            # Dedup by text content — LLM renumbers questions in each chunk so
            # number-based dedup drops all but the first chunk's questions
            text_key = text[:80].lower()
            if text_key in seen_texts:
                continue
            seen_texts.add(text_key)

            q_type = item.get("type", "text")
            if q_type not in ("mcq", "figure_based", "text"):
                q_type = "text"

            # Skip formula / definition / theorem statements from reference sections
            # so they never enter the question bank.
            if _is_reference_statement(text, q_type, item.get("options")):
                print(f"[parse] skipped reference statement: {text[:70]!r}")
                continue

            if q_type == "text" and FIGURE_HINT_RE.search(text):
                q_type = "figure_based"
            raw_questions.append({
                "number":  len(raw_questions) + 1,  # renumber sequentially after dedup
                "text":    text,
                "type":    q_type,
                "options": item.get("options"),
            })

    if len(raw_questions) < 3:
        warnings.append(
            f"Only {len(raw_questions)} question(s) extracted — the PDF may be scanned, "
            "in an unusual format, or mostly non-text."
        )

    return raw_questions, warnings


# ── Image extraction helpers ──────────────────────────────────────────────────

# Matches lines like "6.", "6)", "Q6.", "Q.6" at the start of a text block
_Q_NUM_RE = re.compile(r'^\s*(?:Q\.?\s*)?(\d{1,2})\s*[\.\)]\s*\S', re.IGNORECASE)

FIGURE_DPI    = 150   # render resolution for figure clips
MARGIN_X      = 36    # ~0.5 inch left/right trim when clipping figure regions


# A text block only counts as a figure boundary if it's a real line of prose,
# not a short diagram label ("Glass prism", "N", "incident ray", "60°", …).
# Otherwise labels inside a diagram crop the figure to a thin sliver.
_LABEL_MAX_CHARS = 25


def _text_y_ranges(page) -> list[tuple[float, float, bool]]:
    """Sorted (y_top, y_bottom, is_prose) for every non-empty text block."""
    ranges = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, _, block_type = b
        t = text.strip()
        if block_type == 0 and t:
            is_prose = len(t) >= _LABEL_MAX_CHARS
            ranges.append((y0, y1, is_prose))
    ranges.sort()
    return ranges


def _figure_region(page, img_top: float, img_bottom: float, text_ranges: list) -> fitz.Rect:
    """
    Return a clip rect spanning the full image plus any gap up to the nearest
    *prose* text block above and below it. Short diagram labels are ignored so
    interior/adjacent labels never crop the figure. The rect is always at least
    as tall as the image itself.
    Rendering this region at FIGURE_DPI captures both raster images AND vector
    graphics (geometry lines, axes, circuit paths) in that gap.
    """
    pr         = page.rect
    gap_top    = pr.y0
    gap_bottom = pr.y1

    for y0, y1, is_prose in text_ranges:
        if not is_prose:
            continue                       # skip short labels
        if y1 <= img_top + 2:
            gap_top = max(gap_top, y1)     # last prose above the image
        elif y0 >= img_bottom - 2:
            gap_bottom = min(gap_bottom, y0)  # first prose below the image
            break

    # Never crop the image itself — clamp the gap around its full extent.
    gap_top    = min(gap_top, img_top)
    gap_bottom = max(gap_bottom, img_bottom)

    return fitz.Rect(pr.x0 + MARGIN_X, gap_top, pr.x1 - MARGIN_X, gap_bottom)


def extract_layout_items(doc) -> list[dict]:
    """
    Return text and image items interleaved in reading order across all pages.

    Text blocks come from get_text("blocks") so each block keeps its y-position,
    allowing correct interleaving with image positions for figure assignment.
    (The LLM full-text is built separately with sort=True for math reading order.)

    Images are rendered as figure-region clips at FIGURE_DPI so that vector
    graphics (geometry, circuits, graph axes) are captured alongside raster images.
    """
    items: list[dict] = []

    for page in doc:
        text_ranges = _text_y_ranges(page)
        page_blocks: list[dict] = []

        # ── individual text blocks with y-positions (for correct interleaving) ──
        for b in page.get_text("blocks"):
            x0, y0, x1, y1, text, _block_num, block_type = b
            if block_type == 0 and text.strip():
                page_blocks.append({"type": "text", "y": y0, "text": text.strip()})

        # ── image blocks (rendered as figure-region clips) ───────────────────
        seen: set[tuple[int, int]] = set()
        for img_info in page.get_image_info(xrefs=True):
            bbox       = img_info["bbox"]
            img_y      = bbox[1]      # top, used for reading-order sort
            img_bottom = bbox[3]      # bottom, for full-height clipping
            w     = img_info["width"]
            h     = img_info["height"]
            if w < MIN_IMG_PX or h < MIN_IMG_PX:
                continue
            clip = _figure_region(page, img_y, img_bottom, text_ranges)
            key  = (round(clip.y0), round(clip.y1))
            if key in seen:
                continue  # two images in same gap → render once
            seen.add(key)
            try:
                pix  = page.get_pixmap(clip=clip, dpi=FIGURE_DPI)
                data = pix.tobytes("png")
                page_blocks.append({
                    "type": "image",
                    "y":    img_y,
                    "data": data,
                    "ext":  "png",
                    "w":    pix.width,
                    "h":    pix.height,
                })
            except Exception:
                continue

        # ── table blocks ──────────────────────────────────────────────────────
        try:
            for tbl in page.find_tables().tables:
                x0, y0, x1, y1 = tbl.bbox
                rows_data = tbl.extract()
                if not rows_data or len(rows_data) < 2:
                    continue
                headers = [str(c or '').strip() for c in rows_data[0]]
                if not any(headers):
                    continue
                data_rows = [
                    {h: str(row[j] or '').strip()
                     for j, h in enumerate(headers) if h}
                    for row in rows_data[1:]
                    if any(cell for cell in row)
                ]
                if not data_rows:
                    continue
                page_blocks.append({
                    "type":    "table",
                    "y":       y0,
                    "headers": headers,
                    "rows":    data_rows,
                })
        except Exception:
            pass   # find_tables() not available in older PyMuPDF builds

        # sort all blocks on this page by vertical position
        page_blocks.sort(key=lambda b: b["y"])
        for b in page_blocks:
            if b["type"] == "text":
                items.append({"type": "text", "text": b["text"]})
            elif b["type"] == "table":
                items.append({"type": "table",
                               "headers": b["headers"], "rows": b["rows"]})
            else:
                items.append({"type": "image", "data": b["data"],
                               "ext": b["ext"], "w": b["w"], "h": b["h"]})

    return items


_Q_NUM_RE_LOOSE = re.compile(r'^\s*(?:Q\.?\s*)?(\d{1,2})\s*[\.\)]\s*$', re.IGNORECASE)


def _find_q_num(line: str, q_nums: set) -> int | None:
    """Return the question number if the line opens a new question, else None."""
    stripped = line.strip()
    m = _Q_NUM_RE.match(stripped) or _Q_NUM_RE_LOOSE.match(stripped)
    if m:
        num = int(m.group(1))
        if num in q_nums:
            return num
    return None


def assign_images_to_questions(layout_items: list[dict], questions: list[dict]) -> dict[int, list[dict]]:
    """
    Walk layout items in order. When a text block opens a new question number,
    subsequent images are assigned to that question until the next question starts.
    Images appearing before any question is opened are held as 'pending' and assigned
    to the next question that opens (handles figures placed above question text in PDF).
    """
    q_nums    = {q["number"] for q in questions}
    image_map = {q["number"]: [] for q in questions}
    current_q: int | None = None
    pending:   list[dict] = []   # images seen before any question opens

    img_items  = [i for i in layout_items if i["type"] == "image"]
    text_items = [i for i in layout_items if i["type"] == "text"]
    print(f"[assign] {len(text_items)} text blocks, {len(img_items)} image blocks, q_nums={sorted(q_nums)[:10]}...")

    for item in layout_items:
        if item["type"] == "text":
            for line in item["text"].splitlines():
                num = _find_q_num(line, q_nums)
                if num is not None:
                    current_q = num
                    print(f"[assign] → Q{num} opened")
                    if pending:
                        image_map[current_q].extend(pending)
                        print(f"[assign] flushed {len(pending)} pending image(s) → Q{current_q}")
                        pending.clear()
                    break
        elif item["type"] == "image":
            print(f"[assign] image found, current_q={current_q}")
            if current_q is not None:
                image_map[current_q].append(item)
            else:
                pending.append(item)

    # Any images still pending (no question ever opened after them) — attach to first q
    if pending and q_nums:
        first_q = min(q_nums)
        image_map[first_q].extend(pending)
        print(f"[assign] {len(pending)} orphaned image(s) → Q{first_q} (fallback)")

    assigned = {k: len(v) for k, v in image_map.items() if v}
    print(f"[assign] result: {assigned}")
    return image_map


def assign_tables_to_questions(layout_items: list[dict], questions: list[dict]) -> dict[int, list[dict]]:
    """
    Walk layout items in order and assign table blocks to questions.
    Same pending-flush logic as assign_images_to_questions.
    """
    q_nums    = {q["number"] for q in questions}
    table_map = {q["number"]: [] for q in questions}
    current_q: int | None = None
    pending:   list[dict] = []

    for item in layout_items:
        if item["type"] == "text":
            for line in item["text"].splitlines():
                num = _find_q_num(line, q_nums)
                if num is not None:
                    current_q = num
                    if pending:
                        table_map[current_q].extend(pending)
                        pending.clear()
                    break
        elif item["type"] == "table":
            if current_q is not None:
                table_map[current_q].append(item)
            else:
                pending.append(item)

    if pending and q_nums:
        table_map[min(q_nums)].extend(pending)

    assigned = {k: len(v) for k, v in table_map.items() if v}
    if assigned:
        print(f"[assign_tables] result: {assigned}")
    return table_map


def upload_question_images(upload_id: str, image_map: dict[int, list[dict]]) -> dict[int, list[dict]]:
    """
    Upload per-question images to Supabase under uploaded/<upload_id>/.
    Returns {q_num: [{fid, file}]} with only questions that have images.
    Gracefully skips if Supabase is not configured or upload fails.
    """
    print(f"[upload_images] supabase={'ok' if _supabase else 'NOT CONFIGURED'}")
    if not _supabase:
        return {}

    result: dict[int, list[dict]] = {}
    for q_num, images in image_map.items():
        if not images:
            continue
        refs: list[dict] = []
        for idx, img in enumerate(images):
            ext      = img["ext"]
            filename = f"Q{q_num:02d}_{idx + 1}.{ext}"
            path     = f"uploaded/{upload_id}/{filename}"
            print(f"[upload_images] uploading {path} ({len(img['data'])} bytes)...")
            try:
                _supabase.storage.from_(SUPABASE_BUCKET).upload(
                    path=path,
                    file=img["data"],
                    file_options={
                        "content-type": _IMG_MIME.get(ext, "image/png"),
                        "upsert": "true",
                    },
                )
                refs.append({"fid": f"Q{q_num:02d}_{idx + 1}", "file": filename})
                print(f"  [upload_images] ✓ Q{q_num} img{idx + 1} uploaded OK")
            except Exception as e:
                print(f"  [upload_images] ✗ Q{q_num} img{idx + 1} FAILED: {e}")
        if refs:
            result[q_num] = refs

    print(f"[upload_images] final refs: { {k: len(v) for k, v in result.items()} }")
    return result


@app.post("/api/upload")
def upload_qp():
    """Parse PDF and return raw questions for user review — does NOT save to DB."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename or not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    paper_type = request.form.get("paper_type", "generic")
    if paper_type not in PARSE_PROMPTS:
        paper_type = "generic"

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        f.save(tmp.name)
        tmp.close()

        doc          = fitz.open(tmp.name)
        layout_items = extract_layout_items(doc)
        n_pages      = doc.page_count

        # Build full_text with sort=True for better math reading order (LLM input)
        # Done before doc.close() since extract_layout_items now uses get_text("blocks")
        full_text = "\n".join(
            page.get_text("text", sort=True).strip()
            for page in doc
        )
        doc.close()
        avg_chars = len(full_text) / max(n_pages, 1)
        print(f"[upload] pages={n_pages}  total_chars={len(full_text)}  avg_chars_per_page={avg_chars:.1f}")

        if avg_chars < 20:
            return jsonify({
                "error": (
                    "This looks like a scanned PDF (very little extractable text). "
                    "Only text-based PDFs are supported."
                )
            }), 422

        name = Path(f.filename).stem
        raw_questions, warnings = parse_paper(full_text, paper_type)
        print(f"[upload] parse_paper → {len(raw_questions)} questions, warnings={warnings}")

        if not raw_questions:
            return jsonify({"error": "No questions could be extracted from this PDF."}), 422

        # Generate upload_id at parse time so image paths are consistent at confirm time
        upload_id = uuid.uuid4().hex[:8]

        # Assign images/tables to questions by layout position
        image_map  = assign_images_to_questions(layout_items, raw_questions)
        table_map  = assign_tables_to_questions(layout_items, raw_questions)
        image_refs = upload_question_images(upload_id, image_map)

        # Attach image refs and inline tables to raw questions
        for q in raw_questions:
            q["images"] = image_refs.get(q["number"], [])
            raw_tbls = table_map.get(q["number"], [])
            # Only keep a table whose header text actually appears in the question.
            # Tables assigned purely by layout position (e.g. reference/formula tables
            # near a statement) don't reference the question and are dropped.
            text_lc = q["text"].lower()

            def _table_belongs(t: dict) -> bool:
                headers = [str(h).strip().lower() for h in (t.get("headers") or []) if str(h).strip()]
                return any(len(h) > 2 and h in text_lc for h in headers)

            kept_tbls = [t for t in raw_tbls if _table_belongs(t)]
            dropped = len(raw_tbls) - len(kept_tbls)
            if dropped:
                print(f"[upload] dropped {dropped} stray table(s) not referenced in Q{q['number']} text")

            q["tables"] = [
                {
                    "tid":     f"Q{q['number']:02d}_T{j + 1}",
                    "headers": t["headers"],
                    "rows":    t["rows"],
                }
                for j, t in enumerate(kept_tbls)
            ]
            if q["tables"]:
                if q["type"] == "text":
                    q["type"] = "table_based"
                # Strip inline table data that the LLM echoed into the question
                # text, while preserving OR alternative stems.
                #
                # Algorithm: locate each table's first header in the text
                # (searching forward from the previous hit to handle duplicate
                # headers like two "Class interval" tables in an OR question).
                # Then rebuild the text as:
                #   stem1 [OR stem2] [OR stem3 …]
                # where each stemN is the text just before that table's header.
                text = q["text"]
                headers = [(t["headers"] or [""])[0].strip() for t in q["tables"]]
                positions: list[int] = []
                search_from = 0
                for h in headers:
                    if h and len(h) > 2:
                        pos = text.lower().find(h.lower(), search_from)
                        if pos > max(10, search_from):
                            positions.append(pos)
                            search_from = pos + len(h)
                        else:
                            positions.append(-1)
                    else:
                        positions.append(-1)

                if positions and positions[0] > 10:
                    result = text[:positions[0]].rstrip(" :,\n")
                    for i in range(1, len(positions)):
                        if positions[i] == -1:
                            continue
                        segment = text[positions[i - 1]:positions[i]]
                        or_m = re.search(r'(?i)\bOR\b', segment)
                        if or_m:
                            or_tail = segment[or_m.start():].rstrip(" :,\n")
                            result = result + " " + or_tail
                    q["text"] = result.strip()

        img_count = sum(len(v) for v in image_refs.values())
        tbl_count = sum(len(v) for v in table_map.values() if v)
        if img_count:
            warnings = [f"{img_count} figure(s) extracted and attached."] + warnings
        if tbl_count:
            warnings = [f"{tbl_count} table(s) extracted and attached."] + warnings

        return jsonify({
            "upload_id": upload_id,
            "name":      name,
            "raw":       raw_questions,
            "warnings":  warnings,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp.name)


@app.post("/api/upload/confirm")
def confirm_upload():
    """Save user-reviewed questions to MongoDB after the review step."""
    data      = request.get_json(force=True)
    name      = (data.get("name") or "").strip()
    raw_items = data.get("questions", [])
    upload_id = (data.get("upload_id") or "").strip() or uuid.uuid4().hex[:8]
    img_counts = {str(i+1): len(q.get("images") or []) for i, q in enumerate(raw_items) if q.get("images")}
    print(f"[confirm] upload_id={upload_id!r}  questions={len(raw_items)}  img_counts={img_counts}")

    if not name:
        return jsonify({"error": "name required"}), 400
    if not raw_items:
        return jsonify({"error": "questions required"}), 400

    questions = []
    for i, item in enumerate(raw_items):
        q_text = (item.get("text") or "").strip()
        if not q_text or len(q_text) < 5:
            continue
        q_type = item.get("type", "text")
        if q_type not in ("mcq", "figure_based", "text"):
            q_type = "text"
        if q_type == "text" and FIGURE_HINT_RE.search(q_text):
            q_type = "figure_based"
        options = item.get("options")
        if not isinstance(options, list):
            options = None
        qid = f"UP_{upload_id}_Q{i + 1:02d}"

        raw_images = item.get("images") or []
        images = [
            {"fid": img["fid"], "file": img["file"], "width": 0, "height": 0}
            for img in raw_images
            if isinstance(img, dict) and img.get("fid") and img.get("file")
        ]

        raw_tables = item.get("tables") or []
        tables = [
            {
                "tid":     tbl["tid"],
                "qid":     qid,
                "headers": tbl["headers"],
                "rows":    tbl["rows"],
            }
            for tbl in raw_tables
            if isinstance(tbl, dict)
            and tbl.get("tid") and tbl.get("headers") is not None and tbl.get("rows") is not None
        ]

        if tables and q_type == "text":
            q_type = "table_based"

        questions.append({
            "qid":         qid,
            "number":      item.get("number", i + 1),
            "text":        q_text,
            "type":        q_type,
            "options":     options,
            "has_figure":  q_type == "figure_based" or bool(images),
            "has_table":   bool(tables),
            "images":      images,
            "tables":      tables,
            "source":      "uploaded",
            "chapter":     None,
            "chapter_num": None,
            "section":     None,
        })

    if not questions:
        return jsonify({"error": "No valid questions to save"}), 422

    uploads_col.insert_one({
        "upload_id":      upload_id,
        "name":           name,
        "question_count": len(questions),
        "questions":      questions,
        "created_at":     datetime.now(timezone.utc),
    })

    return jsonify({
        "id":        upload_id,
        "name":      name,
        "count":     len(questions),
        "questions": questions,
    })



# ── Delete an uploaded paper ─────────────────────────────────────────────────

@app.delete("/api/uploads/<upload_id>")
def delete_upload(upload_id):
    result = uploads_col.delete_one({"upload_id": upload_id})
    if result.deleted_count == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})


# ── Delete a static question source (subject + source) ───────────────────────

@app.delete("/api/questions/<subject>/<source>")
def delete_question_source(subject, source):
    result = qs_col.delete_many({"subject": subject, "source": source})
    return jsonify({"ok": True, "deleted": result.deleted_count})


# ── Edit a single question inside an uploaded paper ───────────────────────────

@app.patch("/api/uploads/<upload_id>/questions/<qid>")
def update_upload_question(upload_id, qid):
    data    = request.get_json(force=True)
    updates = {}

    if "text" in data:
        text = (data["text"] or "").strip()
        if len(text) < 5:
            return jsonify({"error": "text too short"}), 400
        updates["questions.$[q].text"] = text

    if "type" in data:
        q_type = data["type"]
        if q_type not in ("mcq", "figure_based", "text"):
            return jsonify({"error": "invalid type"}), 400
        updates["questions.$[q].type"]       = q_type
        updates["questions.$[q].has_figure"] = q_type == "figure_based"

    if not updates:
        return jsonify({"error": "nothing to update"}), 400

    result = uploads_col.update_one(
        {"upload_id": upload_id},
        {"$set": updates},
        array_filters=[{"q.qid": qid}],
    )
    if result.matched_count == 0:
        return jsonify({"error": "upload not found"}), 404
    return jsonify({"ok": True})


# ── Delete a single question inside an uploaded paper ────────────────────────

@app.delete("/api/uploads/<upload_id>/questions/<qid>")
def delete_upload_question(upload_id, qid):
    result = uploads_col.update_one(
        {"upload_id": upload_id},
        {
            "$pull": {"questions": {"qid": qid}},
            "$inc":  {"question_count": -1},
        },
    )
    if result.matched_count == 0:
        return jsonify({"error": "upload not found"}), 404
    return jsonify({"ok": True})


# ── Rephrase ──────────────────────────────────────────────────────────────────

_LATEX_PRESERVE = (
    "Preserve all LaTeX notation exactly as-is — "
    "keep $\\ce{...}$ for chemical formulas, $...$ for math expressions. "
    "Do not convert them to plain text."
)

REPHRASE_PROMPTS = {
    "mcq": (
        "You are an experienced teacher. Rephrase this multiple choice question. "
        "Reword the question stem AND all four options, but keep the same correct answer. "
        "Return ONLY the rephrased question in this exact format — "
        "question stem on the first line, then each option on its own line as (A) ..., (B) ..., (C) ..., (D) ... "
        f"No explanations, no preamble. {_LATEX_PRESERVE}"
    ),
    "figure_based": (
        "You are an experienced teacher. Rephrase this question which refers to a diagram or figure. "
        "Keep all references to the figure or diagram intact. Use different wording but preserve the exact meaning. "
        f"Return ONLY the rephrased question — no explanations, no preamble. {_LATEX_PRESERVE}"
    ),
    "table_based": (
        "You are an experienced teacher. Rephrase this question which refers to a data table. "
        "Keep all references to the table intact. Use different wording but preserve the exact meaning. "
        f"Return ONLY the rephrased question — no explanations, no preamble. {_LATEX_PRESERVE}"
    ),
    "default": (
        "You are an experienced teacher. Rephrase the exam question below "
        "using different wording while keeping the exact same meaning, "
        "difficulty level, and subject matter. "
        f"Return ONLY the rephrased question — no explanations, no preamble. {_LATEX_PRESERVE}"
    ),
}


@app.post("/api/rephrase")
def rephrase():
    data  = request.get_json(force=True)
    text  = (data.get("text")  or "").strip()
    qtype = (data.get("type")  or "default").strip()
    if not text:
        return jsonify({"error": "no text"}), 400
    system_prompt = REPHRASE_PROMPTS.get(qtype, REPHRASE_PROMPTS["default"])
    try:
        gem  = genai.GenerativeModel(MODEL, system_instruction=system_prompt)
        resp = gem.generate_content(
            text,
            generation_config=genai.GenerationConfig(
                max_output_tokens=300,
                temperature=0.75,
            ),
        )
        return jsonify({"rephrased": resp.text.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Blueprint parser ─────────────────────────────────────────────────────────

_BLUEPRINT_PROMPT = """\
Extract the chapter-wise marks distribution table from the text below.
Return ONLY a JSON array where each object represents one chapter row (skip the Total row).
Each object:
{
  "chapter": "<English chapter name only — not Kannada>",
  "marks_1": <int, number of 1-mark questions, 0 if blank>,
  "marks_2": <int, number of 2-mark questions, 0 if blank>,
  "marks_3": <int, number of 3-mark questions, 0 if blank>,
  "marks_4": <int, number of 4-mark questions, 0 if blank>,
  "marks_5": <int, number of 5-mark questions, 0 if blank>
}
Skip any row that is a section heading, total row, or has no question counts.
Text:
"""


def _english_chapter(raw: str) -> str:
    """Pull the English chapter name out of a bilingual (Kannada+English) cell."""
    for line in reversed(raw.splitlines()):
        if len(re.findall(r'[A-Za-z]', line)) >= 3:
            return line.strip()
    ascii_only = re.sub(r'[^\x00-\x7f]', ' ', raw)
    return re.sub(r'\s+', ' ', ascii_only).strip()


def _blueprint_from_table(doc) -> list[dict] | None:
    """
    Extract the chapter-wise marks distribution structurally from the grid table.
    Columns are mapped by header text ("1 Mark", "2 Mark", …) so the 1-mark
    column is never dropped or misaligned. Returns row dicts, or None if no
    usable table is found (caller then falls back to the LLM).
    """
    for page in doc:
        try:
            tables = page.find_tables().tables
        except Exception:
            return None
        for tbl in tables:
            try:
                rows = tbl.extract()
            except Exception:
                continue
            if not rows or len(rows) < 3:
                continue

            # Locate the header row (has ≥2 cells mentioning "mark").
            header_idx = None
            for i, r in enumerate(rows[:4]):
                joined = " ".join(str(c or "").lower() for c in r)
                if joined.count("mark") >= 2:
                    header_idx = i
                    break
            if header_idx is None:
                continue

            header = [str(c or "").lower() for c in rows[header_idx]]
            mark_cols: dict[int, int] = {}
            for n in range(1, 6):
                for j, h in enumerate(header):
                    if re.search(rf'\b{n}\s*mark', h):
                        mark_cols[n] = j
                        break
            chap_col = next(
                (j for j, h in enumerate(header) if "chapter" in h or "name" in h),
                None,
            )
            if len(mark_cols) < 3 or chap_col is None:
                continue

            def cell_int(cells: list, n: int) -> int:
                j = mark_cols.get(n)
                if j is None or j >= len(cells):
                    return 0
                m = re.search(r'\d+', cells[j])
                return int(m.group()) if m else 0

            out: list[dict] = []
            for r in rows[header_idx + 1:]:
                cells   = [str(c or "").strip() for c in r]
                chapter = _english_chapter(cells[chap_col]) if chap_col < len(cells) else ""
                if not chapter or "total" in chapter.lower():
                    continue
                row = {
                    "chapter": chapter,
                    "marks_1": cell_int(cells, 1),
                    "marks_2": cell_int(cells, 2),
                    "marks_3": cell_int(cells, 3),
                    "marks_4": cell_int(cells, 4),
                    "marks_5": cell_int(cells, 5),
                }
                if sum(row[k] for k in ("marks_1", "marks_2", "marks_3", "marks_4", "marks_5")):
                    out.append(row)
            if out:
                print(f"[blueprint] structural table parse → {len(out)} chapters, mark cols={mark_cols}")
                return out
    return None


@app.post("/api/parse-blueprint")
def parse_blueprint():
    f = request.files.get("file")
    if not f or not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "PDF file required"}), 400

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        f.save(tmp.name)
        tmp.close()
        doc = fitz.open(tmp.name)

        # Try robust structural extraction first (handles bilingual grids
        # without the LLM dropping the 1-mark column).
        rows = _blueprint_from_table(doc)

        if rows is None:
            print("[blueprint] structural parse failed — falling back to LLM")
            full_text = "\n".join(page.get_text() for page in doc)
            doc.close()
            gem  = genai.GenerativeModel(MODEL)
            resp = gem.generate_content(
                _BLUEPRINT_PROMPT + full_text,
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    max_output_tokens=2000,
                    temperature=0.0,
                ),
            )
            rows = json.loads(resp.text.strip())
        else:
            doc.close()

        if not isinstance(rows, list):
            return jsonify({"error": "Could not parse blueprint table"}), 422

        # Compute totals
        total_q = sum(
            r.get("marks_1", 0) + r.get("marks_2", 0) + r.get("marks_3", 0) +
            r.get("marks_4", 0) + r.get("marks_5", 0)
            for r in rows
        )
        total_m = sum(
            r.get("marks_1", 0) * 1 + r.get("marks_2", 0) * 2 + r.get("marks_3", 0) * 3 +
            r.get("marks_4", 0) * 4 + r.get("marks_5", 0) * 5
            for r in rows
        )
        return jsonify({"rows": rows, "total_questions": total_q, "total_marks": total_m})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp.name)


# ── Chapter classifier ───────────────────────────────────────────────────────

@app.post("/api/classify-questions")
def classify_questions():
    """
    Given a list of {qid, text} and a list of chapter names,
    return {qid -> chapter} for each question.
    One Gemini call for all questions at once.
    """
    data     = request.get_json(force=True)
    questions = data.get("questions", [])   # [{qid, text}, ...]
    chapters  = data.get("chapters",  [])   # ["Real Numbers", "Polynomials", ...]

    if not questions or not chapters:
        return jsonify({"error": "questions and chapters required"}), 400

    chapters_list = "\n".join(f"- {c}" for c in chapters)
    q_lines = "\n".join(
        f'{i}: {q["text"][:200]}'
        for i, q in enumerate(questions)
    )

    prompt = f"""\
You are a curriculum expert. Classify each question below into exactly one chapter from the given list.
Return ONLY a JSON object mapping the question index (0-based integer as string) to the chapter name (exactly as written in the list).
If a question does not clearly belong to any chapter, pick the closest one — never leave it unclassified.

Chapters:
{chapters_list}

Questions:
{q_lines}

Return format: {{"0": "Chapter Name", "1": "Chapter Name", ...}}
"""
    try:
        gem  = genai.GenerativeModel(MODEL)
        resp = gem.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                max_output_tokens=4000,
                temperature=0.0,
            ),
        )
        index_map: dict[str, str] = json.loads(resp.text.strip())
        # Convert index → qid
        result = {
            questions[int(idx)]["qid"]: chapter
            for idx, chapter in index_map.items()
            if idx.isdigit() and int(idx) < len(questions)
        }
        return jsonify({"classifications": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Static frontend ───────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_app(path):
    return send_file(Path(__file__).parent / "static" / "index.html")


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5050))
    print(f"\n  QP Builder API -> http://localhost:{port}/api/subjects")
    print(f"  Frontend dev  -> http://localhost:5174\n")
    app.run(debug=True, port=port, host="0.0.0.0", use_reloader=False)
