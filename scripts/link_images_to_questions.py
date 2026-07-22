"""
Link MinerU images to their questions in MongoDB.

Parses the markdown to find which image hash appears after which question number,
builds qid → [image_url, ...] mapping, then patches the MongoDB documents.
"""

import re, os, sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

MINERU_DIR   = Path(r"C:\Users\shrin\Downloads\6dace2a0_e355_11f0_8703_0a5e36bc6706_6_130")
SUPABASE_IMG = os.getenv("VITE_SUPABASE_IMAGES_URL", "").rstrip("/")
IMG_PREFIX   = "science/yashassu_science"

CHAPTER_RE = re.compile(r"^#{1,2} Chapter-(\d+):", re.MULTILINE)
IMAGE_RE    = re.compile(r"!\[.*?\]\(images/([^)]+)\)")
# Matches "35 text" or "35. text" or "35.text"
QNUM_RE     = re.compile(r"^(\d{1,3})[.\s]\s*\S")
MODEL_ANS   = re.compile(r"Model\s+(Key\s+)?Ans", re.IGNORECASE)


def find_md_file(folder: Path) -> Path:
    for f in folder.glob("*.md"):
        return f
    raise FileNotFoundError(f"No .md file in {folder}")


def parse_image_links(md_text: str) -> dict:
    """
    Returns {qid: [image_filename, ...]} by walking each chapter line by line.
    """
    # Stop before model answers
    m = MODEL_ANS.search(md_text)
    if m:
        md_text = md_text[:m.start()]

    # Find chapter boundaries
    boundaries = [(m.start(), int(m.group(1))) for m in CHAPTER_RE.finditer(md_text)]
    if not boundaries:
        return {}

    mapping = {}   # qid -> [filename, ...]

    for i, (start, ch_num) in enumerate(boundaries):
        end       = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(md_text)
        ch_text   = md_text[start:end]
        lines     = ch_text.splitlines()

        current_q = None

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # New question number detected
            qm = QNUM_RE.match(stripped)
            if qm:
                current_q = int(qm.group(1))
                continue

            # Image reference — assign to current question
            im = IMAGE_RE.search(stripped)
            if im and current_q is not None:
                qid      = f"SYB_{ch_num:02d}_{current_q:03d}"
                filename = im.group(1)
                mapping.setdefault(qid, [])
                if filename not in mapping[qid]:
                    mapping[qid].append(filename)

    return mapping


def build_image_entry(filename: str, idx: int, qid: str) -> dict:
    url = f"{SUPABASE_IMG}/{IMG_PREFIX}/{filename}"
    ext = filename.rsplit(".", 1)[-1]
    return {
        "fid":  f"{qid}_F{idx}",
        "file": filename,
        "url":  url,
    }


def main():
    md_file  = find_md_file(MINERU_DIR)
    md_text  = md_file.read_text(encoding="utf-8")
    print(f"Read {len(md_text):,} chars from {md_file.name}")

    mapping = parse_image_links(md_text)
    print(f"Found image links for {len(mapping)} questions:")
    for qid, files in sorted(mapping.items()):
        print(f"  {qid}: {len(files)} image(s)")

    if not mapping:
        print("No image links found — nothing to update.")
        return

    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI not set")

    col = MongoClient(uri)["qp_builder"]["questions"]

    updated = 0
    for qid, filenames in mapping.items():
        images = [build_image_entry(fn, i + 1, qid) for i, fn in enumerate(filenames)]
        result = col.update_one(
            {"qid": qid},
            {"$set": {"images": images, "has_figure": True}},
        )
        if result.matched_count:
            updated += 1
        else:
            print(f"  WARN: {qid} not found in MongoDB")

    print(f"\nUpdated {updated} documents. Done.")


if __name__ == "__main__":
    main()
