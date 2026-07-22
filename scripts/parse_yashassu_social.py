"""
Parse Yashassu Social Science Question Bank from MinerU markdown using Gemini.

Input:  C:\\Users\\shrin\\Downloads\\social\\  (MinerU output folder)
Output: parsed_output_yashassu_social/questions.json

Coverage (from this PDF):
  History          — Chapters 1-9
  Political Science — Chapters 1-4
  Sociology        — Chapters 1-3 (Ch 3 partial in PDF)

Chapter structure per chapter:
  I.   Four alternatives (MCQ)           — 1 mark each
  II.  Answer in a sentence              — 1 mark each
  III. Answer in 2-4 sentences/points   — 2 marks each
  IV.  Answer in 6-8 sentences/points   — 3 marks each

Global chapter numbering (used in QIDs):
  History          Ch 1-9  → global 01-09
  Political Science Ch 1-4 → global 10-13
  Sociology        Ch 1-3  → global 14-16

QID format : YSS_{global_chapter_num:02d}_{q_num:03d}
Source tag  : "yashassu_social"
"""

import json, os, re, shutil, sys
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

MINERU_DIR = Path(r"C:\Users\shrin\Downloads\social")
OUTPUT_DIR = Path(r"D:\Internship\qpgenerator\parsed_output_yashassu_social")
IMAGES_DIR = OUTPUT_DIR / "images"
SOURCE_TAG = "yashassu_social"
QID_PREFIX = "YSS"

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

api_key    = os.getenv("GEMINI_API_KEY")
model_name = os.getenv("GEMINI_MODEL")
if not api_key:
    sys.exit("ERROR: GEMINI_API_KEY not set in .env")

genai.configure(api_key=api_key)

# Subject → offset added to local chapter_num to get global_chapter_num
SUBJECT_OFFSET = {
    "History":           0,
    "Political Science": 9,
    "Sociology":         13,
}

PROMPT = """\
You are parsing a Karnataka SSLC 10th Standard Social Science question bank
(Yashassu / DIET Haveri series, 2025-26).
The markdown below contains ONE chapter of questions.

Extract EVERY question and return a JSON array. Each object must have EXACTLY these fields:

{
  "subject":      <string — one of "History", "Political Science", "Sociology">,
  "chapter_num":  <int — chapter number within the subject (1-9 for History, 1-4 for PS, 1-3 for Sociology)>,
  "chapter_name": <string — chapter name, e.g. "THE ADVENT OF EUROPEANS TO INDIA">,
  "number":       <int — question number within this chapter>,
  "marks":        <int — derived from the section heading:
                      Section I  (Four alternatives / MCQ)         → 1
                      Section II (Answer in a sentence)             → 1
                      Section III (Answer in 2-4 sentences/points)  → 2
                      Section IV (Answer in 6-8 sentences/points)   → 3
                  If a section says "3/4 Marks" use 3. If "2/3 Marks" use 2.>,
  "text":         <string — question text ONLY; strip exam-year tags like (June-2022),
                  (April-2024), (September-2020), (Sep-2021), (A2017), (Mar-2019),
                  (BC 2022), (P-1 2024), (M-4-25), (State-2025), (2025 Paper-1), (Easy) etc.;
                  if question has "/" alternatives keep ONLY the part before the first "/">,
  "options":      <array of 4 strings for MCQ — strip A) B) C) D) / a) b) c) d) labels,
                  keep just the option text; null for non-MCQ questions>,
  "type":         <"mcq" if options is non-null, "text" otherwise>
}

Critical rules:
- Skip the Learning Outcomes table, cover page content, and bare subject-header lines
  (e.g. "## POLITICAL SCIENCE", "## HISTORY").
- Section headings that start with roman numerals (I., II., III., IV.) are NOT questions —
  do NOT emit them. They only tell you the marks for the questions that follow.
- Question numbering is CONTINUOUS across sections within a chapter (Section II questions
  continue from where Section I left off — they do NOT restart at 1).
- Some lines contain MULTIPLE questions packed onto one line, e.g.:
    "7. What is public administration? 8. Who used the term...? 9. Who appoints...?"
  Split each into its own question object with correct "number".
- Exam-year tags appear in many formats — strip the entire bracketed expression:
    (June-2022)  (April-2024)  (March 2020)  (September-2020)  (Sep-2021)
    (A2017)  (Jun2016)  (BC 2022)  (P-1 2024)  (M-4-25)  (Mar-2019)
    (State-2025)  (2025 Paper-1)  (Easy)  (W1-2024)  (RA Po 2016)
    (SEFT-19-20)  (Mar-1 2021)  (Mar 1, March 2, June 2016, P 2024)  etc.
- For questions with "/" alternatives
    e.g. "22. What were the conditions of Subsidiary Alliance? / The Alliance weakened rulers. How?"
  use ONLY the text before the first "/". Trim trailing whitespace.
- MCQ options use A) B) C) D) or a) b) c) d) format (sometimes (A) (B) (C) (D)).
  Strip the label entirely; keep just the option text.
- Return ONLY the raw JSON array — no markdown fences, no explanation.

Markdown:
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def find_md_file(folder: Path) -> Path:
    for f in folder.glob("*.md"):
        return f
    raise FileNotFoundError(f"No .md file in {folder}")


def strip_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


def repair_json(s: str) -> str:
    """Fix bare backslashes that aren't valid JSON escapes."""
    HEX  = set('0123456789abcdefABCDEF')
    SAFE = set('"\\\/bfnrt')
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt in SAFE:
                result.append(s[i]); result.append(nxt); i += 2
            elif nxt == 'u' and i + 5 < len(s) and all(c in HEX for c in s[i+2:i+6]):
                result.append(s[i]); result.append(nxt); i += 2
            else:
                result.append('\\\\'); i += 1
        else:
            result.append(s[i]); i += 1
    return ''.join(result)


# ── Chapter splitter ──────────────────────────────────────────────────────────

# History: "# History Chapter 1: ..." or "## History Chapter 8 : ..."
_HIST_RE = re.compile(
    r'^#{1,3}\s+History\s+Chapter\s*(\d+)\s*[:\s]+(.+)',
    re.IGNORECASE,
)
# Political Science with prefix: "## POLITICAL SCIENCE : Chapter 2. ..."
#   also handles "::" (triple colon seen in Ch 3)
_PS_FULL_RE = re.compile(
    r'^#{1,3}\s+POLITICAL\s+SCIENCE\s*:+\s*Chapter\s*(\d+)\.\s*(.+)',
    re.IGNORECASE,
)
# Political Science bare (after subject-switch header): "## Chapter 1. ..."
_PS_BARE_RE = re.compile(
    r'^#{1,3}\s+Chapter\s*(\d+)\.\s*(.+)',
    re.IGNORECASE,
)
# Sociology: "## SOCIOLOGY Chapter 1 : ..." or "## SOCIOLOGY: Chapter 2. ..."
_SOC_RE = re.compile(
    r'^#{1,3}\s+SOCIOLOGY[:\s]+Chapter\s*(\d+)\s*[.:\s]+(.+)',
    re.IGNORECASE,
)
# Bare subject-change marker: "## POLITICAL SCIENCE"
_PS_SUBJ_RE = re.compile(r'^#{1,3}\s+POLITICAL\s+SCIENCE\s*$', re.IGNORECASE)


def _parse_header(line: str, current_subject: str):
    """Return (subject, chapter_num, chapter_name) or None."""
    m = _HIST_RE.match(line)
    if m:
        return ("History", int(m.group(1)), m.group(2).strip().rstrip(":").strip())

    m = _PS_FULL_RE.match(line)
    if m:
        return ("Political Science", int(m.group(1)), m.group(2).strip())

    m = _SOC_RE.match(line)
    if m:
        return ("Sociology", int(m.group(1)), m.group(2).strip().rstrip(":").strip())

    # Bare "## Chapter N." only valid when we're already inside Political Science
    if current_subject == "Political Science":
        m = _PS_BARE_RE.match(line)
        if m:
            return ("Political Science", int(m.group(1)), m.group(2).strip())

    return None


def split_chapters(md_text: str):
    """
    Returns [(subject, chapter_num, chapter_name, chapter_md_text), ...]
    Skips everything before the first chapter header (cover page / learning outcomes).
    """
    chapters        = []
    current_subject = "History"
    current_chapter = None   # (subject, chapter_num, chapter_name)
    current_lines   = []

    for line in md_text.splitlines():
        stripped = line.strip()

        # Bare subject-change header
        if _PS_SUBJ_RE.match(stripped):
            current_subject = "Political Science"
            continue

        result = _parse_header(stripped, current_subject)
        if result:
            if current_chapter is not None:
                subj, cn, cname = current_chapter
                chapters.append((subj, cn, cname, "\n".join(current_lines).strip()))
            current_subject = result[0]
            current_chapter = result
            current_lines   = [line]
        elif current_chapter is not None:
            current_lines.append(line)

    if current_chapter is not None:
        subj, cn, cname = current_chapter
        chapters.append((subj, cn, cname, "\n".join(current_lines).strip()))

    return chapters


# ── Gemini ────────────────────────────────────────────────────────────────────

def parse_chapter(gemini, subject, chapter_num, chapter_name, chapter_text):
    response = gemini.generate_content(
        PROMPT + chapter_text,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    raw = strip_fences(response.text)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(repair_json(raw))


# ── Dict builder ──────────────────────────────────────────────────────────────

def build_questions_dict(questions: list) -> dict:
    result = {}
    seen   = {}

    for q in questions:
        subj    = q.get("subject", "")
        ch_num  = q.get("chapter_num", 0)
        q_num   = q.get("number", 0)
        glob_ch = SUBJECT_OFFSET.get(subj, 0) + ch_num

        key          = (glob_ch, q_num)
        seen[key]    = seen.get(key, 0) + 1
        suffix       = f"_{seen[key]}" if seen[key] > 1 else ""
        qid          = f"{QID_PREFIX}_{glob_ch:02d}_{q_num:03d}{suffix}"

        result[qid] = {
            "qid":                qid,
            "number":             q_num,
            "text":               q.get("text", "").strip(),
            "type":               q.get("type", "text"),
            "options":            q.get("options"),
            "difficulty":         None,
            "marks":              q.get("marks", 1),
            "has_figure":         False,
            "has_table":          False,
            "images":             [],
            "tables":             [],
            "chapter":            q.get("chapter_name", ""),
            "chapter_num":        ch_num,
            "global_chapter_num": glob_ch,
            "sub_subject":        subj,
            "source":             SOURCE_TAG,
        }

    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Copy images from MinerU output
    src_images = MINERU_DIR / "images"
    if src_images.exists():
        imgs = list(src_images.glob("*"))
        for img in imgs:
            shutil.copy2(img, IMAGES_DIR / img.name)
        print(f"Copied {len(imgs)} images -> {IMAGES_DIR}")

    md_file = find_md_file(MINERU_DIR)
    md_text = md_file.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {md_file.name}\n")

    chapters = split_chapters(md_text)
    print(f"Found {len(chapters)} chapters (cover page / learning outcomes skipped):\n")
    for subj, cn, cname, ctext in chapters:
        g = SUBJECT_OFFSET.get(subj, 0) + cn
        print(f"  [{subj}] Ch {cn} (global {g:02d}): {cname[:55]}  ({len(ctext):,} chars)")

    gemini        = genai.GenerativeModel(model_name)
    all_questions = []

    print()
    for subj, cn, cname, ctext in chapters:
        g = SUBJECT_OFFSET.get(subj, 0) + cn
        label = f"[{subj}] Ch {cn} (global {g:02d}): {cname[:40]}"
        print(f"  Parsing {label}...")
        try:
            qs = parse_chapter(gemini, subj, cn, cname, ctext)
            for q in qs:
                q.setdefault("subject",      subj)
                q.setdefault("chapter_num",  cn)
                q.setdefault("chapter_name", cname)
            all_questions.extend(qs)
            print(f"    -> {len(qs)} questions")
        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"\nTotal extracted: {len(all_questions)} questions")
    questions_dict = build_questions_dict(all_questions)

    # ── Stats ──
    by_subject = {}
    by_chapter = {}
    by_marks   = {}
    by_type    = {}
    for q in questions_dict.values():
        s  = q["sub_subject"]
        ch = f"[{s}] Ch {q['chapter_num']}: {q['chapter']}"
        by_subject[s]           = by_subject.get(s, 0) + 1
        by_chapter[ch]          = by_chapter.get(ch, 0) + 1
        by_marks[q["marks"]]    = by_marks.get(q["marks"], 0) + 1
        by_type[q["type"]]      = by_type.get(q["type"], 0) + 1

    print(f"\nBy subject : {by_subject}")
    print(f"\nBy chapter:")
    for ch, n in sorted(by_chapter.items()):
        print(f"  {ch[:70]:70s}: {n}")
    print(f"\nBy marks : {dict(sorted(by_marks.items()))}")
    print(f"By type  : {by_type}")

    out_path = OUTPUT_DIR / "questions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions_dict, f, ensure_ascii=False, indent=2)

    print(f"\nQuestions -> {out_path}")
    print(f"Images    -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
