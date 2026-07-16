#!/usr/bin/env python3
"""
Textbook PDF parser — called by Node via child_process.spawn.

Usage:
    python parse_textbook.py <pdf_path> [groq_model]

GROQ_API_KEY is read from the environment (inherited from the Node process).
Stdout: single JSON object
Stderr: progress/debug messages (ignored by Node)
Exit 0 on success, 1 on error (Node checks exit code).
"""

import json
import os
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF


# ── Regex patterns (ported from chapterHeuristics.ts) ─────────────────────────

STRUCTURE_PATTERNS = [
    re.compile(r'^chapter\s*[-–]?\s*\d+', re.IGNORECASE),
    re.compile(r'^unit\s*[-–]?\s*\d+', re.IGNORECASE),
    re.compile(r'^section\s*[-–\s]*[A-Z]$', re.IGNORECASE),
]

FALLBACK_PATTERNS = STRUCTURE_PATTERNS + [
    re.compile(r'^\d+\.\s+[A-Z]'),
    re.compile(r'^[A-Z][A-Z\s]{4,60}$'),
]


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_pages(doc: fitz.Document) -> list[str]:
    pages = []
    for page in doc:
        text = page.get_text("text")          # preserves layout reasonably well
        pages.append(text.strip())
    return pages


# ── Bookmark-based detection ──────────────────────────────────────────────────

def extract_outline(doc: fitz.Document) -> list[dict] | None:
    toc = doc.get_toc(simple=True)           # [[level, title, page], ...]
    if not toc:
        return None
    # Keep only top-level entries (level == 1)
    top = [{"title": t, "pageNumber": p} for lvl, t, p in toc if lvl == 1]
    if len(top) < 2:
        return None
    return sorted(top, key=lambda x: x["pageNumber"])


# ── Heuristic detection ───────────────────────────────────────────────────────

def collect_candidates(pages: list[str], patterns: list[re.Pattern], skip_toc: bool) -> list[dict]:
    candidates = []
    for page_index, page_text in enumerate(pages):
        lines = [l.strip() for l in re.split(r'\n|\.\s{2,}', page_text) if l.strip()]

        if skip_toc:
            structured_count = sum(
                1 for l in lines
                if len(l) <= 80 and any(p.search(l) for p in STRUCTURE_PATTERNS)
            )
            if structured_count >= 2:
                continue

        for line in lines:
            if len(line) > 80:
                continue
            if any(p.search(line) for p in patterns):
                candidates.append({"title": line, "pageIndex": page_index})
                break   # one candidate per page

    return candidates


def detect_headings_heuristic(pages: list[str]) -> list[dict]:
    structured = collect_candidates(pages, STRUCTURE_PATTERNS, skip_toc=True)
    if len(structured) >= 2:
        return structured
    return collect_candidates(pages, FALLBACK_PATTERNS, skip_toc=False)


# ── LLM fallback ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You scan textbook text for chapter or unit heading titles "
    "(e.g. \"Chapter 3: Cell Structure\", \"Unit 5\"). List EVERY heading-like "
    "title that appears in this excerpt, exactly as written.\n"
    "If none appear, respond with exactly: NONE\n"
    "Return one heading per line, nothing else — no numbering, no commentary."
)

CHUNK_SIZE = 12_000
OVERLAP    =  1_500


def detect_headings_llm(full_text: str, api_key: str, model: str) -> list[dict]:
    try:
        from groq import Groq
    except ImportError:
        print("groq package not installed — LLM fallback unavailable", file=sys.stderr)
        return []

    client = Groq(api_key=api_key)
    chunks = []
    i = 0
    while i < len(full_text):
        chunks.append({"text": full_text[i:i + CHUNK_SIZE], "offset": i})
        i += CHUNK_SIZE - OVERLAP

    candidates = []
    full_text_lower = full_text.lower()

    for chunk in chunks:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": chunk["text"]},
                ],
                temperature=0,
            )
            raw = (resp.choices[0].message.content or "").strip()
            if not raw or raw == "NONE":
                continue
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                idx = full_text.find(line, chunk["offset"])
                if idx == -1:
                    idx = full_text_lower.find(line.lower(), chunk["offset"])
                if idx != -1:
                    candidates.append({"title": line, "approxCharOffset": idx})
        except Exception as e:
            print(f"LLM chunk error: {e}", file=sys.stderr)

    # Dedupe overlapping region hits
    candidates.sort(key=lambda c: c["approxCharOffset"])
    deduped = []
    for c in candidates:
        if not deduped or c["approxCharOffset"] - deduped[-1]["approxCharOffset"] > 200:
            deduped.append(c)

    return deduped


# ── Title resolution (ported from chapterTitles.ts) ──────────────────────────

def clean_title(value: str) -> str:
    value = re.sub(r'\s+', ' ', value)
    value = re.sub(r'^[\s:;,.\-]+|[\s:;,.\-]+$', '', value)
    return value.strip()


def format_title(value: str) -> str:
    cleaned = clean_title(value)
    if not cleaned:
        return cleaned
    letters = re.sub(r'[^A-Za-z]', '', cleaned)
    upper   = re.sub(r'[^A-Z]', '', letters)
    mostly_upper = len(letters) > 0 and len(upper) / len(letters) > 0.8
    if not mostly_upper:
        return cleaned
    titled = cleaned.lower()
    titled = re.sub(r'\b[a-z]', lambda m: m.group().upper(), titled)
    titled = re.sub(r'\b(And|Or|Of|In|To|The|A|An)\b', lambda m: m.group().lower(), titled)
    # Ensure first char is uppercase
    return titled[0].upper() + titled[1:] if titled else titled


def is_generic_marker(value: str) -> bool:
    return bool(
        re.match(r'^\d+$', value) or
        re.match(r'^(?:chapter|unit)\s*[-–]?\s*\d+[A-Za-z]?$', value, re.IGNORECASE) or
        re.match(r'^section\s*[-–\s]*[A-Z]$', value, re.IGNORECASE)
    )


def is_likely_title(value: str) -> bool:
    if not value or len(value) < 3 or len(value) > 100:
        return False
    if not re.search(r'[A-Za-z]', value):
        return False
    if is_generic_marker(value):
        return False
    if re.match(r'^(?:contents|index|preface|introduction to the book|questions?|exercises?)$', value, re.IGNORECASE):
        return False
    if re.match(r'^(?:page|figure|table|class|grade|std\.?|standard)\s+\d+', value, re.IGNORECASE):
        return False
    if re.match(r'^(?:section|part|unit)\s+\d', value, re.IGNORECASE):
        return False
    words = value.split()
    if len(words) > 12:
        return False
    # Reject single-word ALL-CAPS strings — these are almost always subject /
    # book-title headers (HISTORY, GEOGRAPHY, SCIENCE…), not chapter names.
    if len(words) == 1 and value == value.upper() and len(value) > 3:
        return False
    return True


def extract_real_title(value: str) -> str | None:
    if not value:
        return None
    m = re.match(r'^(?:chapter|unit)\s*[-–]?\s*\d+[A-Za-z]?\s*(?:[:.\-–]\s*|\s+)(.+)$', value, re.IGNORECASE)
    if m:
        return format_title(m.group(1))
    m = re.match(r'^\d+(?:\.\d+)?\s*(?:[:.\-–]\s*|\s+)(.+)$', value)
    if m:
        return format_title(m.group(1))
    if is_generic_marker(value):
        return None
    return None


def resolve_chapter_title(detected_title: str, source_text: str) -> str:
    cleaned = clean_title(detected_title)
    t = extract_real_title(cleaned)
    if t:
        return t
    if is_likely_title(cleaned):
        return format_title(cleaned)

    lines = source_text.splitlines()

    # Find the first chapter/unit/number marker line in the source text.
    # For bookmark detection the source starts at the page boundary, which may
    # include subject-name headers BEFORE the chapter heading, so we must skip
    # everything up to and including the marker before we start looking for
    # the real chapter title.
    CHAP_LINE = re.compile(
        r'^(?:chapter|unit|ch\.?)\s*[-–]?\s*\d+[A-Za-z]?'
        r'|^\d+\s*$',
        re.IGNORECASE,
    )
    search_start = 0
    for i, raw in enumerate(lines[:40]):
        line = clean_title(raw)
        if not line:
            continue
        if CHAP_LINE.match(line) or is_generic_marker(line):
            search_start = i + 1   # start scanning AFTER this marker
            break

    # Scan lines from search_start for a meaningful title.
    for raw in lines[search_start:search_start + 60]:
        line = clean_title(raw)
        if not line:
            continue
        if is_generic_marker(line):
            continue
        t = extract_real_title(line)
        if t:
            return t
        if is_likely_title(line):
            return format_title(line)

    return cleaned or "Untitled chapter"


# ── Main ──────────────────────────────────────────────────────────────────────

def page_index_to_char_offset(pages: list[str], page_index: int) -> int:
    offset = 0
    for i in range(min(page_index, len(pages))):
        offset += len(pages[i]) + 2   # +2 for '\n\n' separator
    return offset


def main():
    sys.stdout.reconfigure(encoding='utf-8')

    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_textbook.py <pdf_path> [groq_model]"}))
        sys.exit(1)

    pdf_path  = sys.argv[1]
    model     = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    api_key   = os.environ.get("GROQ_API_KEY", "")

    if not Path(pdf_path).exists():
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Could not open PDF: {e}"}))
        sys.exit(1)

    pages = extract_pages(doc)
    full_text = "\n\n".join(pages)

    if len(full_text.strip()) < 100:
        print(json.dumps({"error": "Could not extract readable text from this PDF. It may be a scanned image."}))
        sys.exit(1)

    # Build char offset table
    page_offsets = []
    offset = 0
    for page in pages:
        page_offsets.append(offset)
        offset += len(page) + 2

    # --- Detection ---
    outline = extract_outline(doc)
    if outline:
        method = "bookmark"
        raw_candidates = [
            {"title": o["title"], "startOffset": page_index_to_char_offset(pages, o["pageNumber"] - 1)}
            for o in outline
        ]
    else:
        heuristic = detect_headings_heuristic(pages)
        if len(heuristic) >= 2:
            method = "heuristic"
            raw_candidates = []
            for h in heuristic:
                page_start = page_index_to_char_offset(pages, h["pageIndex"])
                title_pos  = pages[h["pageIndex"]].find(h["title"])
                start = page_start + title_pos if title_pos != -1 else page_start
                raw_candidates.append({"title": h["title"], "startOffset": start})
        else:
            method = "llm"
            llm_hits = detect_headings_llm(full_text, api_key, model)
            raw_candidates = [{"title": d["title"], "startOffset": d["approxCharOffset"]} for d in llm_hits]

    if not raw_candidates:
        print(json.dumps({"error": "Could not detect any chapter structure in this textbook."}))
        sys.exit(1)

    # Assign endOffsets
    candidates = []
    for i, c in enumerate(raw_candidates):
        end = raw_candidates[i + 1]["startOffset"] if i + 1 < len(raw_candidates) else len(full_text)
        candidates.append({
            "tempId":          f"draft-{i}",
            "suggestedTitle":  resolve_chapter_title(c["title"], full_text[c["startOffset"]:end]),
            "suggestedNumber": i + 1,
            "startOffset":     c["startOffset"],
            "endOffset":       end,
            "preview":         full_text[c["startOffset"]:c["startOffset"] + 300],
            "wordCount":       len(full_text[c["startOffset"]:end].split()),
        })

    doc.close()

    print(json.dumps({
        "method":      method,
        "pages":       pages,
        "pageOffsets": page_offsets,
        "candidates":  candidates,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
