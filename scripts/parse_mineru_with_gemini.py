"""
Parse Yashassu Science Question Bank from MinerU markdown output using Gemini.

Input:  MinerU output folder (contains .md + images/)
Output: questions.json in parsed_output_yashassu_science/
        images copied to   parsed_output_yashassu_science/images/
"""

import json
import os
import re
import shutil
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

MINERU_DIR = Path(r"C:\Users\shrin\Downloads\6dace2a0_e355_11f0_8703_0a5e36bc6706_6_130")
OUTPUT_DIR = Path(r"D:\Internship\qpgenerator\parsed_output_yashassu_science")
IMAGES_DIR = OUTPUT_DIR / "images"
SOURCE_TAG = "yashassu_science"

load_dotenv(Path(r"D:\Internship\qpgenerator\qp-builder\.env"))

api_key = os.getenv("GEMINI_API_KEY")
model_name = os.getenv("GEMINI_MODEL")
if not api_key:
    raise SystemExit("ERROR: GEMINI_API_KEY not set in .env")

genai.configure(api_key=api_key)

PROMPT = """\
You are parsing a Karnataka SSLC Science question bank (Yashassu series, 2022-23).
The markdown below contains multiple chapters of questions followed by a "Model Key Answer" section — STOP before that section.

Extract every question and return a JSON array. Each object must have exactly these fields:

{
  "chapter_num": <int>,
  "chapter": <string — chapter name only, strip the "Chapter-N: " prefix>,
  "number": <int — question number within its chapter and section>,
  "marks": <int — from the section heading: "One-mark" → 1, "Two-mark" → 2, "Three-mark" → 3, "Four-mark" → 4, "Five-mark" → 5>,
  "text": <string — question text with LaTeX preserved; strip options and difficulty tag only>,
  "options": <array of 4 strings for MCQ with LaTeX preserved, null for non-MCQ; strip "A. / B. / C. / D." labels>,
  "difficulty": <string "E"/"A"/"D" from the {E}/{A}/{D} tag — present on ALL question types, null if absent>,
  "type": <"mcq" if options present, "text" otherwise>,
  "has_figure": <true if the question text references an image (contains "![") in the markdown>
}

Rules:
- PRESERVE ALL LATEX. Convert LaTeX delimiters to KaTeX format:
    \\[ ... \\]  →  $$ ... $$   (display / block math)
    \\( ... \\)  →  $ ... $     (inline math)
  Keep all LaTeX commands intact inside the delimiters (\\mathrm, \\frac, \\rightarrow, subscripts, etc.).
  Chemical formulas like \\mathrm{Fe_2O_3} must stay as LaTeX — do NOT convert them to plain text.
- The tags {E}, {A}, {D} are ALWAYS difficulty levels (E = Easy, A = Average, D = Difficult).
  They are NEVER answer keys. This document does NOT contain embedded answer keys for MCQs.
- Remove ALL {X} difficulty tags from the "text" field.
- Do NOT include option labels ("A.", "B.", etc.) inside the options array — just the plain text.
- Stop parsing when you encounter "Model Key Answer" or "Model Answer" in the markdown.
- Return ONLY the raw JSON array — no markdown code fences, no explanation.

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


def build_questions_dict(questions: list) -> dict:
    result = {}
    for q in questions:
        ch  = q["chapter_num"]
        num = q["number"]
        qid = f"SYB_{ch:02d}_{num:03d}"
        result[qid] = {
            "qid":         qid,
            "number":      num,
            "text":        q.get("text", "").strip(),
            "type":        q.get("type", "text"),
            "options":     q.get("options"),
            "difficulty":  q.get("difficulty"),
            "marks":       q.get("marks", 1),
            "has_figure":  q.get("has_figure", False),
            "has_table":   False,
            "images":      [],
            "tables":      [],
            "chapter":     q.get("chapter", ""),
            "chapter_num": ch,
            "source":      SOURCE_TAG,
        }
    return result


CHAPTER_RE = re.compile(r"^#{1,2} Chapter-\d+:", re.MULTILINE)
MODEL_ANSWER_RE = re.compile(r"Model\s+(Key\s+)?Ans", re.IGNORECASE)


def split_chapters(md_text: str) -> list[tuple[int, str]]:
    """Split markdown into [(chapter_num, chapter_text), ...], stopping before model answers."""
    # Find where model answers start and trim
    m = MODEL_ANSWER_RE.search(md_text)
    if m:
        md_text = md_text[:m.start()]

    boundaries = [m.start() for m in CHAPTER_RE.finditer(md_text)]
    if not boundaries:
        return [(0, md_text)]

    chunks = []
    for i, start in enumerate(boundaries):
        end = boundaries[i + 1] if i + 1 < len(boundaries) else len(md_text)
        chunk = md_text[start:end].strip()
        # Extract chapter number from heading
        num_match = re.match(r"# Chapter-(\d+):", chunk)
        ch_num = int(num_match.group(1)) if num_match else (i + 1)
        chunks.append((ch_num, chunk))
    return chunks


def parse_chapter(model, ch_num: int, ch_text: str) -> list:
    response = model.generate_content(
        PROMPT + ch_text,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    raw = strip_fences(response.text)
    questions = json.loads(raw)
    return questions


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Copy images from MinerU output so Supabase upload script can find them
    src_images = MINERU_DIR / "images"
    if src_images.exists():
        imgs = list(src_images.glob("*"))
        for img in imgs:
            shutil.copy2(img, IMAGES_DIR / img.name)
        print(f"Copied {len(imgs)} images -> {IMAGES_DIR}")
    else:
        print("No images folder found in MinerU output.")

    md_file = find_md_file(MINERU_DIR)
    md_text = md_file.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {md_file.name}")

    chapters = split_chapters(md_text)
    print(f"Found {len(chapters)} chapters\n")

    gemini = genai.GenerativeModel(model_name)
    all_questions = []

    for ch_num, ch_text in chapters:
        heading = ch_text.splitlines()[0]
        print(f"  Processing {heading[:70]}...")
        try:
            qs = parse_chapter(gemini, ch_num, ch_text)
            all_questions.extend(qs)
            print(f"    -> {len(qs)} questions")
        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"\nTotal extracted: {len(all_questions)} questions")

    questions_dict = build_questions_dict(all_questions)

    # Stats
    by_type  = {}
    by_ch    = {}
    by_marks = {}
    for q in questions_dict.values():
        by_type[q["type"]]    = by_type.get(q["type"], 0) + 1
        by_ch[q["chapter"]]   = by_ch.get(q["chapter"], 0) + 1
        by_marks[q["marks"]]  = by_marks.get(q["marks"], 0) + 1

    print(f"\nBy type  : {by_type}")
    print(f"By marks : {dict(sorted(by_marks.items()))}")
    print(f"\nBy chapter:")
    for ch, n in sorted(by_ch.items()):
        print(f"  {ch[:55]:55s}: {n}")

    out_path = OUTPUT_DIR / "questions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions_dict, f, ensure_ascii=False, indent=2)

    print(f"\nQuestions -> {out_path}")
    print(f"Images    -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
