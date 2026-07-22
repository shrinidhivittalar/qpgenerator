"""
Parse Yashassu Maths Question Bank from MinerU markdown using Gemini.

Input:  C:\\Users\\shrin\\Downloads\\maths\\  (MinerU output folder)
Output: parsed_output_yashassu_maths/questions.json

Key differences from science parser:
  - Chapter headings: "UNIT1:" / "UNIT 2 :" (inconsistent spacing)
  - Difficulty: inline (Easy) / (Average) / (Difficult), often with exam year prefix
  - MCQ options: A) B) C) D)  not  A. B. C. D.
  - Marks section: "(1 Mark)" / "(2/3 Marks)" in section heading
  - Multiple questions sometimes on one line; some questions split across lines
  - Cover page + contents table must be skipped (everything before first UNIT heading)
"""

import json, os, re, shutil, sys
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

MINERU_DIR = Path(r"C:\Users\shrin\Downloads\maths")
OUTPUT_DIR = Path(r"D:\Internship\qpgenerator\parsed_output_yashassu_maths")
IMAGES_DIR = OUTPUT_DIR / "images"
SOURCE_TAG = "yashassu_maths"
QID_PREFIX = "YBM"

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

api_key    = os.getenv("GEMINI_API_KEY")
model_name = os.getenv("GEMINI_MODEL")
if not api_key:
    sys.exit("ERROR: GEMINI_API_KEY not set in .env")

genai.configure(api_key=api_key)

# Matches: "## UNIT1: REAL NUMBERS" or "# UNIT 2 : POLYNOMIALS"
UNIT_RE = re.compile(
    r"^#{1,2}\s+UNIT\s*(\d+)\s*[:\s]\s*(.+)",
    re.MULTILINE | re.IGNORECASE,
)

PROMPT = """\
You are parsing a Karnataka SSLC 10th Standard Mathematics question bank (Yashassu / DIET Chitradurga series, 2025-26).
The markdown below contains ONE unit/chapter of questions.

Extract EVERY question and return a JSON array. Each object must have EXACTLY these fields:

{
  "unit_num":   <int — unit/chapter number>,
  "unit_name":  <string — unit name, e.g. "REAL NUMBERS">,
  "number":     <int — question number within this unit>,
  "marks":      <int — from the section heading:
                    "(1 Mark)"   → 1
                    "(2/3 Marks)"→ 2
                    "(3 Marks)"  → 3
                    "(4 Marks)"  → 4
                    If a section says "2/3 Marks", use 2.>,
  "text":       <string — question text only; strip difficulty label and exam-year tag; preserve ALL LaTeX>,
  "options":    <array of 4 strings for MCQ (strip "A)" "B)" "C)" "D)" labels — just the text); null for non-MCQ; preserve LaTeX in options>,
  "difficulty": <"Easy" | "Average" | "Difficult" — extracted from the difficulty label; null if absent>,
  "type":       <"mcq" if options present, "text" otherwise>,
  "has_figure": <true if the question references an image (contains "![") in the markdown>
}

Critical rules:
- Skip the Learning Points section, difficulty distribution table, and any cover/index content at the top.
- The difficulty label appears as:
    (Easy) / (Average) / (Difficult)          — standalone
    (MQP-2025 : Easy) / (SLP-2024 : Average) — with exam tag prefix
    (April-2024 : Difficult)                  — with month/year prefix
    (July-2022, Average)                      — with comma separator
  Extract ONLY the word Easy / Average / Difficult. Strip the entire label from "text".
- Exam-year tags like "(MQP-2025)", "(SLP-2024)", "(Aug - 2024)", "(June-2023)" etc. that appear
  WITHOUT a difficulty word must also be stripped from "text".
- MCQ options use A) B) C) D) format (sometimes (A) (B) (C) (D)). Strip the label, keep just the text.
- Some lines contain MULTIPLE questions ("29. ... (Easy) 30. ... (Easy)") — split them correctly.
- Some questions are split across two lines — join them into one text field.
- PRESERVE ALL LaTeX: convert \\(...\\) → $...$ and \\[...\\] → $$...$$ exactly as in science parser.
- Do NOT include the section headings (e.g. "I. Four alternatives...") as questions.
- Return ONLY the raw JSON array — no markdown fences, no explanation.

Markdown:
"""


def find_md_file(folder: Path) -> Path:
    for f in folder.glob("*.md"):
        return f
    raise FileNotFoundError(f"No .md file in {folder}")


def strip_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


def repair_json_backslashes(s: str) -> str:
    """
    Fix unescaped backslashes in LaTeX that Gemini emits as single \\ in JSON strings.
    Handles \\u in LaTeX (e.g. \\underline) which JSON misreads as a unicode escape.
    """
    HEX = set('0123456789abcdefABCDEF')
    SAFE = set('"\\\/bfnrt')
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt in SAFE:
                result.append(s[i]);  result.append(nxt);  i += 2
            elif nxt == 'u' and i + 5 < len(s) and all(c in HEX for c in s[i+2:i+6]):
                # valid unicode escape like A
                result.append(s[i]);  result.append(nxt);  i += 2
            else:
                # invalid escape — double the backslash
                result.append('\\\\');  i += 1
        else:
            result.append(s[i]);  i += 1
    return ''.join(result)


def split_units(md_text: str) -> list[tuple[int, str, str]]:
    """
    Returns [(unit_num, unit_name, unit_text), ...]
    Skips everything before the first UNIT heading (cover page / contents).
    """
    matches = list(UNIT_RE.finditer(md_text))
    if not matches:
        return []

    units = []
    for i, m in enumerate(matches):
        unit_num  = int(m.group(1))
        unit_name = m.group(2).strip().rstrip(":")
        start     = m.start()
        end       = matches[i + 1].start() if i + 1 < len(matches) else len(md_text)
        units.append((unit_num, unit_name, md_text[start:end].strip()))

    return units


def parse_unit(gemini, unit_num: int, unit_name: str, unit_text: str) -> list:
    response = gemini.generate_content(
        PROMPT + unit_text,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    raw = strip_fences(response.text)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(repair_json_backslashes(raw))


def build_questions_dict(questions: list) -> dict:
    result = {}
    seen   = {}   # (unit_num, number) → count, to handle duplicate q_nums across sections

    for q in questions:
        unit = q.get("unit_num", 0)
        num  = q.get("number", 0)

        key = (unit, num)
        seen[key] = seen.get(key, 0) + 1
        suffix = f"_{seen[key]}" if seen[key] > 1 else ""

        qid = f"{QID_PREFIX}_{unit:02d}_{num:03d}{suffix}"

        result[qid] = {
            "qid":        qid,
            "number":     num,
            "text":       q.get("text", "").strip(),
            "type":       q.get("type", "text"),
            "options":    q.get("options"),
            "difficulty": q.get("difficulty"),
            "marks":      q.get("marks", 1),
            "has_figure": q.get("has_figure", False),
            "has_table":  False,
            "images":     [],
            "tables":     [],
            "chapter":    q.get("unit_name", ""),
            "chapter_num": unit,
            "source":     SOURCE_TAG,
        }

    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Copy images
    src_images = MINERU_DIR / "images"
    if src_images.exists():
        imgs = list(src_images.glob("*"))
        for img in imgs:
            shutil.copy2(img, IMAGES_DIR / img.name)
        print(f"Copied {len(imgs)} images -> {IMAGES_DIR}")

    md_file = find_md_file(MINERU_DIR)
    md_text = md_file.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {md_file.name}")

    units = split_units(md_text)
    print(f"Found {len(units)} units (cover page skipped):\n")
    for u_num, u_name, u_text in units:
        print(f"  Unit {u_num}: {u_name}  ({len(u_text):,} chars)")

    gemini      = genai.GenerativeModel(model_name)
    all_questions = []

    print()
    for unit_num, unit_name, unit_text in units:
        print(f"  Parsing Unit {unit_num}: {unit_name}...")
        try:
            qs = parse_unit(gemini, unit_num, unit_name, unit_text)
            # Ensure unit_num and unit_name are set (Gemini might miss them)
            for q in qs:
                q.setdefault("unit_num",  unit_num)
                q.setdefault("unit_name", unit_name)
            all_questions.extend(qs)
            print(f"    -> {len(qs)} questions")
        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"\nTotal extracted: {len(all_questions)} questions")
    questions_dict = build_questions_dict(all_questions)

    # Stats
    by_unit  = {}
    by_type  = {}
    by_marks = {}
    for q in questions_dict.values():
        ch = f"Unit {q['chapter_num']}: {q['chapter']}"
        by_unit[ch]          = by_unit.get(ch, 0) + 1
        by_type[q["type"]]   = by_type.get(q["type"], 0) + 1
        by_marks[q["marks"]] = by_marks.get(q["marks"], 0) + 1

    print(f"\nBy unit:")
    for u, n in sorted(by_unit.items()):
        print(f"  {u[:60]:60s}: {n}")
    print(f"\nBy type  : {by_type}")
    print(f"By marks : {dict(sorted(by_marks.items()))}")

    out_path = OUTPUT_DIR / "questions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions_dict, f, ensure_ascii=False, indent=2)

    print(f"\nQuestions -> {out_path}")
    print(f"Images    -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
