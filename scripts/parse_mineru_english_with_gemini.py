"""
Parse Yashassu English Question Bank from MinerU markdown using Gemini.

Input:  C:\\Users\\shrin\\Downloads\\english\\  (MinerU output folder)
Output: parsed_output_yashassu_english/questions.json

Key differences from science/maths parsers:
  - Chapters = individual lessons/poems (not numbered units)
  - Question types: mcq, analogy, grammar, text, comprehension, essay, letter
  - MCQ questions have multiple sub-parts (all kept in text, options=null)
  - Marks extracted from section headings: (1 Mark), (2 Marks) etc.
  - Difficulty from (Comp/Easy), [K/E], (Exp/Diff) style tags
  - No question images - cover page image at line 1 is skipped
  - Lesson boundaries: LEARNING OUTCOMES: / bullet blocks (U+F0B7) / # POEM headings
"""

import json, os, re, sys
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

MINERU_DIR = Path(r"C:\Users\shrin\Downloads\english")
OUTPUT_DIR = Path(r"D:\Internship\qpgenerator\parsed_output_yashassu_english")
SOURCE_TAG = "yashassu_english"
QID_PREFIX = "YBE"

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

api_key    = os.getenv("GEMINI_API_KEY")
model_name = os.getenv("GEMINI_MODEL")
if not api_key:
    sys.exit("ERROR: GEMINI_API_KEY not set in .env")

genai.configure(api_key=api_key)

# Unicode bullets MinerU uses: U+F0B7 (Wingdings), U+F076 (Wingdings alt)
BULLET_RE  = re.compile(r"^[•●]")
HEADING_RE = re.compile(r"^#{1,3}\s+(?:POEM|PROSE)\b", re.IGNORECASE)
LEARN_RE   = re.compile(r"^LEARNING OUTCOMES:", re.IGNORECASE)

PROMPT = """\
You are parsing a Karnataka SSLC 10th Standard English question bank (Yashassu / DIET series, 2025-26).
The markdown below contains ONE lesson's questions. The lesson number is given above the markdown.

Extract EVERY numbered question and return a JSON array. Each object must have EXACTLY these fields:

{
  "lesson_num":   <int - the lesson number provided at the top>,
  "lesson_name":  <string - lesson/poem title inferred from context, e.g. "A Wrong Man in a Workers' Paradise">,
  "number":       <int - the main question number (1, 2, 3...), NOT sub-part labels like i, ii, iii>,
  "marks":        <int - from the section heading directly above this question:
                   "(1 Mark)"->1, "(2 Marks)"->2, "(3 Marks)"->3, "(4 Marks)"->4, "(5 Marks)"->5>,
  "text":         <string - the COMPLETE question text including ALL sub-parts (i, ii, iii...) and their
                   A) B) C) D) options if MCQ. Strip difficulty tags like (Comp/Easy), [K/E], (Exp/Diff),
                   (June 2015), (March 2024), [March 2025] etc. from the text.>,
  "type":         <string - determined by the section heading:
                   "mcq"           : "Four alternatives are given" / "Choose the correct alternative"
                   "analogy"       : "Observe the relationship" / complete the pair
                   "grammar"       : "Rewrite as directed" sections (voice, degrees, reported speech)
                   "text"          : short/long answer questions ("Answer in a sentence", "2-3 sentences",
                                     "5-6 sentences", "7-8 sentences", "Explain with reference to context")
                   "comprehension" : passage comprehension ("Read the following passage")
                   "essay"         : "Write an essay"
                   "letter"        : "Write a letter">,
  "difficulty":   <"Easy" | "Average" | "Difficult" | null
                   (Comp/Easy), [K/E], /E  -> "Easy"
                   (Comp/Avg), [Comp/A], /A -> "Average"
                   (Exp/Diff), [Exp/D], /D  -> "Difficult"
                   No tag present           -> null>,
  "options":      null
}

Critical rules:
- Each NUMBERED question (1, 2, 3...) is ONE entry - keep ALL sub-parts (i, ii, iii...) in "text".
  Example: Q1 with 6 fill-in-blank parts each with A) B) C) D) = ONE entry, not 6 entries.
- Do NOT split sub-parts into separate questions.
- Skip the learning outcomes bullet section at the top.
- Skip section headings like "## I. Four alternatives are given..." - not questions.
- The "text" field includes sub-parts AND answer options; strip only difficulty/exam-year tags.
- For essay/letter questions (Q71, Q72 type): keep the full list of topics as ONE question.
- Question numbers may use "1." or "1)" or "1 " formats - all the same question number.
- Return ONLY the raw JSON array - no markdown fences, no explanation.

Lesson number: {lesson_num}

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


def split_lessons(md_text: str) -> list[tuple[int, str]]:
    """
    Returns [(lesson_num, lesson_text), ...].
    Skips cover page (everything before first boundary).

    Boundaries:
      1. "LEARNING OUTCOMES:" line        -> lesson 1
      2. First U+F0B7 bullet in a block   -> subsequent lessons
      3. "# POEM/PROSE" heading           -> explicitly headed lessons
         (sets in_bullet_block so following bullets don't create another boundary)
    """
    lines      = md_text.splitlines(keepends=True)
    boundaries = []
    char_pos   = 0
    in_bullet_block      = False
    skip_next_bullets    = False  # set after heading to absorb the following bullet block

    for line in lines:
        stripped = line.strip()

        if stripped and BULLET_RE.match(stripped):
            if not skip_next_bullets and not in_bullet_block:
                boundaries.append(char_pos)
            in_bullet_block = True
        elif LEARN_RE.match(stripped):
            boundaries.append(char_pos)
            in_bullet_block   = False
            skip_next_bullets = False
        elif HEADING_RE.match(stripped):
            boundaries.append(char_pos)
            in_bullet_block   = False
            skip_next_bullets = True   # heading's own bullet block should not count as new lesson
        elif stripped:
            if in_bullet_block:
                skip_next_bullets = False  # bullet block just ended; clear the skip flag
            in_bullet_block = False

        char_pos += len(line)

    if not boundaries:
        return []

    lessons = []
    for i, start in enumerate(boundaries):
        end = boundaries[i + 1] if i + 1 < len(boundaries) else len(md_text)
        lessons.append((i + 1, md_text[start:end].strip()))

    return lessons


def parse_lesson(gemini, lesson_num: int, lesson_text: str) -> list:
    prompt = PROMPT.replace("{lesson_num}", str(lesson_num))
    response = gemini.generate_content(
        prompt + lesson_text,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    raw = strip_fences(response.text)
    return json.loads(raw)


def build_questions_dict(questions: list) -> dict:
    result = {}
    seen   = {}

    for q in questions:
        lesson = q.get("lesson_num", 0)
        num    = q.get("number", 0)

        key = (lesson, num)
        seen[key] = seen.get(key, 0) + 1
        suffix = f"_{seen[key]}" if seen[key] > 1 else ""

        qid = f"{QID_PREFIX}_{lesson:02d}_{num:03d}{suffix}"

        result[qid] = {
            "qid":         qid,
            "number":      num,
            "text":        q.get("text", "").strip(),
            "type":        q.get("type", "text"),
            "options":     None,
            "difficulty":  q.get("difficulty"),
            "marks":       q.get("marks", 1),
            "has_figure":  False,
            "has_table":   False,
            "images":      [],
            "tables":      [],
            "chapter":     q.get("lesson_name", ""),
            "chapter_num": lesson,
            "source":      SOURCE_TAG,
        }

    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    md_file = find_md_file(MINERU_DIR)
    md_text = md_file.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {md_file.name}")

    lessons = split_lessons(md_text)
    print(f"Found {len(lessons)} lessons (cover page skipped):\n")
    for l_num, l_text in lessons:
        preview = next(
            (ln.strip() for ln in l_text.splitlines()
             if ln.strip() and not BULLET_RE.match(ln.strip())),
            ""
        )
        print(f"  Lesson {l_num}: {len(l_text):,} chars  |  {preview[:70]}")

    gemini        = genai.GenerativeModel(model_name)
    all_questions = []

    print()
    for lesson_num, lesson_text in lessons:
        print(f"  Parsing Lesson {lesson_num}...")
        try:
            qs = parse_lesson(gemini, lesson_num, lesson_text)
            for q in qs:
                q.setdefault("lesson_num", lesson_num)
            all_questions.extend(qs)
            print(f"    -> {len(qs)} questions")
        except Exception as e:
            print(f"    ERROR: {e}")
            import traceback; traceback.print_exc()

    print(f"\nTotal extracted: {len(all_questions)} questions")
    questions_dict = build_questions_dict(all_questions)

    # Stats
    by_lesson = {}
    by_type   = {}
    by_marks  = {}
    for q in questions_dict.values():
        label = f"Lesson {q['chapter_num']}: {q['chapter']}"
        by_lesson[label]     = by_lesson.get(label, 0) + 1
        by_type[q["type"]]   = by_type.get(q["type"], 0) + 1
        by_marks[q["marks"]] = by_marks.get(q["marks"], 0) + 1

    print("\nBy lesson:")
    for l, n in sorted(by_lesson.items()):
        print(f"  {l[:75]:75s}: {n}")
    print(f"\nBy type  : {by_type}")
    print(f"By marks : {dict(sorted(by_marks.items()))}")

    out_path = OUTPUT_DIR / "questions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions_dict, f, ensure_ascii=False, indent=2)

    print(f"\nQuestions -> {out_path}")


if __name__ == "__main__":
    main()
