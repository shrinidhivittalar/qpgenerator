"""
One-time script: tag every science question in MongoDB with subject_area
(Physics | Chemistry | Biology) based on its chapter name.

Gemini classifies all unique chapter names in one call, then we bulk-update.
Run from repo root:
    python scripts/tag_subject_area.py [--dry-run]
"""

import json, os, sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne, UpdateMany
import google.generativeai as genai

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

DRY_RUN = "--dry-run" in sys.argv

CLASSIFY_PROMPT = """\
You are classifying Karnataka SSLC Class 10 Science chapters into their subject area.

Classify each of the following chapter names as exactly one of:
  Physics | Chemistry | Biology

Return ONLY a JSON object mapping each chapter name to its subject area.
Example: {{"Electricity": "Physics", "Life Processes": "Biology"}}

Chapters to classify:
{chapters}
"""

FALLBACK_MAP = {
    # NCERT Class 10 Science chapters by number
    "Chapter 1":  "Chemistry",   # Chemical Reactions and Equations
    "Chapter 2":  "Chemistry",   # Acids, Bases and Salts
    "Chapter 3":  "Chemistry",   # Metals and Non-metals
    "Chapter 4":  "Chemistry",   # Carbon and its Compounds
    "Chapter 5":  "Chemistry",   # Periodic Classification
    "Chapter 6":  "Biology",     # Life Processes
    "Chapter 7":  "Biology",     # Control and Coordination
    "Chapter 8":  "Biology",     # How do Organisms Reproduce?
    "Chapter 9":  "Biology",     # Heredity and Evolution
    "Chapter 10": "Physics",     # Light – Reflection and Refraction
    "Chapter 11": "Physics",     # Human Eye and Colourful World
    "Chapter 12": "Physics",     # Electricity
    "Chapter 13": "Physics",     # Magnetic Effects of Electric Current
    "Chapter 14": "Physics",     # Sources of Energy
    "Chapter 15": "Biology",     # Our Environment
    "Chapter 16": "Biology",     # Management of Natural Resources
}


def classify_chapters(chapters: list[str]) -> dict[str, str]:
    """Ask Gemini to classify chapter names → Physics/Chemistry/Biology."""
    # Seed with fallback map for "Chapter N" entries
    result = {}
    to_classify = []

    for ch in chapters:
        if ch in FALLBACK_MAP:
            result[ch] = FALLBACK_MAP[ch]
        else:
            to_classify.append(ch)

    if not to_classify:
        return result

    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.0-flash"))

    chapter_list = "\n".join(f"- {c}" for c in to_classify)
    resp = model.generate_content(
        CLASSIFY_PROMPT.format(chapters=chapter_list),
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    classified = json.loads(resp.text.strip())
    result.update(classified)
    return result


def main():
    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI not set in .env")

    col = MongoClient(uri)["qp_builder"]["questions"]

    # Find all science questions (subject contains 'science', or source like 'yashassu_science' etc.)
    # We match broadly: any question whose subject is 'science'
    science_filter = {"subject": "science"}
    total = col.count_documents(science_filter)
    print(f"Found {total} science questions in MongoDB\n")

    # Get unique chapters
    pipeline = [
        {"$match": science_filter},
        {"$group": {"_id": "$chapter"}},
    ]
    unique_chapters = [
        doc["_id"] for doc in col.aggregate(pipeline)
        if doc["_id"]  # skip null/empty
    ]
    no_chapter_count = col.count_documents({**science_filter, "chapter": None})

    print(f"Unique chapters found: {len(unique_chapters)}")
    for ch in sorted(unique_chapters):
        print(f"  - {ch}")
    print(f"Questions with no chapter: {no_chapter_count}")
    print()

    if not unique_chapters:
        print("No chapters to classify — nothing to do.")
        return

    # Classify
    print("Classifying chapters with Gemini...")
    mapping = classify_chapters(unique_chapters)
    print("\nClassification result:")
    for ch, area in sorted(mapping.items()):
        print(f"  {ch!r:45s} -> {area}")
    print()

    # Warn about any unclassified
    unclassified = [ch for ch in unique_chapters if ch not in mapping]
    if unclassified:
        print(f"WARNING: {len(unclassified)} chapters not classified:")
        for ch in unclassified:
            print(f"  - {ch}")
        print()

    if DRY_RUN:
        print("DRY RUN — no changes written to MongoDB.")
        return

    # Bulk update
    from pymongo import UpdateMany
    ops = []
    for chapter, subject_area in mapping.items():
        ops.append(UpdateMany(
            {"subject": "science", "chapter": chapter},
            {"$set": {"subject_area": subject_area}},
        ))

    # Questions with no chapter get subject_area = None (leave unset / don't overwrite)
    if ops:
        result = col.bulk_write(ops, ordered=False)
        print(f"Updated {result.modified_count} questions with subject_area field.")
    else:
        print("No updates to apply.")

    # Verify
    counts = {}
    for area in ["Physics", "Chemistry", "Biology"]:
        counts[area] = col.count_documents({"subject": "science", "subject_area": area})
    untagged = col.count_documents({"subject": "science", "subject_area": {"$exists": False}})
    print("\nVerification:")
    for area, count in counts.items():
        print(f"  {area}: {count} questions")
    print(f"  Untagged (no chapter): {untagged} questions")


if __name__ == "__main__":
    main()
