"""
Fix question types in MongoDB for yashassu_science:
  - has_figure=True, type!=mcq  →  type = "figure_based"
  - questions with data tables   →  type = "table_based", has_table=True, tables=[...]

Run: python scripts/fix_question_types.py
"""

import re, os, sys
from pathlib import Path
from html.parser import HTMLParser
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

MD_FILE = Path(r"C:\Users\shrin\Downloads\6dace2a0-e355-11f0-8703-0a5e36bc6706-6-130.md")

CHAPTER_RE     = re.compile(r"^#{1,2} Chapter-(\d+):", re.MULTILINE)
QNUM_RE        = re.compile(r"^(\d{1,3})[.\s]\s*\S")
TABLE_RE        = re.compile(r"<table>.*?</table>", re.DOTALL)
MODEL_ANS_RE    = re.compile(r"Model\s+(Key\s+)?Ans", re.IGNORECASE)
DIFFICULTY_RE   = re.compile(r"Difficulty level", re.IGNORECASE)


# ── HTML table parser ─────────────────────────────────────────────────────────

class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._current_row: list[str] = []
        self._current_cell = ""
        self._in_cell = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._current_row = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._current_cell = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self._current_row.append(self._current_cell.strip())
            self._in_cell = False
        elif tag == "tr":
            if self._current_row:
                self.rows.append(self._current_row)

    def handle_data(self, data):
        if self._in_cell:
            self._current_cell += data


def parse_html_table(html: str) -> dict | None:
    """Convert <table> HTML to {headers, rows} dict. Returns None if invalid."""
    p = TableParser()
    p.feed(html)
    if len(p.rows) < 2:
        return None
    headers = p.rows[0]
    rows = [dict(zip(headers, row)) for row in p.rows[1:]]
    return {"headers": headers, "rows": rows}


# ── Markdown walker ───────────────────────────────────────────────────────────

def find_table_questions(md_text: str) -> dict:
    """
    Returns {qid: [TableEntry, ...]} for every question-data table found.
    Skips chapter-level difficulty tables.
    """
    m = MODEL_ANS_RE.search(md_text)
    if m:
        md_text = md_text[:m.start()]

    boundaries = [(m.start(), int(m.group(1))) for m in CHAPTER_RE.finditer(md_text)]
    if not boundaries:
        return {}

    result = {}

    for i, (start, ch_num) in enumerate(boundaries):
        end     = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(md_text)
        ch_text = md_text[start:end]
        lines   = ch_text.splitlines()

        current_q   = None
        tbl_counter = {}

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            qm = QNUM_RE.match(stripped)
            if qm:
                current_q = int(qm.group(1))
                continue

            if "<table>" in stripped and current_q is not None:
                # Skip chapter difficulty tables
                if DIFFICULTY_RE.search(stripped):
                    continue

                parsed = parse_html_table(stripped)
                if not parsed:
                    continue

                qid = f"SYB_{ch_num:02d}_{current_q:03d}"
                tbl_counter[qid] = tbl_counter.get(qid, 0) + 1
                tid = f"{qid}_T{tbl_counter[qid]}"

                entry = {"tid": tid, "qid": qid, **parsed}
                result.setdefault(qid, []).append(entry)

    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    md_text = MD_FILE.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {MD_FILE.name}\n")

    table_map = find_table_questions(md_text)
    print(f"Table-based questions found: {list(table_map.keys())}")

    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI not set")

    col = MongoClient(uri)["qp_builder"]["questions"]

    # 1. figure_based: has_figure=True and not mcq
    res = col.update_many(
        {"source": "yashassu_science", "has_figure": True, "type": {"$ne": "mcq"}},
        {"$set": {"type": "figure_based"}},
    )
    print(f"\nfigure_based: {res.modified_count} updated")

    # 2. table_based
    t_updated = 0
    for qid, tables in table_map.items():
        res = col.update_one(
            {"qid": qid},
            {"$set": {"type": "table_based", "has_table": True, "tables": tables}},
        )
        if res.matched_count:
            t_updated += 1
            print(f"  table_based: {qid}  ({len(tables)} table(s))")
        else:
            print(f"  WARN: {qid} not found in MongoDB")

    print(f"\ntable_based: {t_updated} updated")

    # Summary
    print("\n=== Type distribution (yashassu_science) ===")
    for doc in col.aggregate([
        {"$match": {"source": "yashassu_science"}},
        {"$group": {"_id": "$type", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]):
        print(f"  {doc['_id']}: {doc['count']}")


if __name__ == "__main__":
    main()
